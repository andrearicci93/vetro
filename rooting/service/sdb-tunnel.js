'use strict';

// Lets a PC on the LAN run `sdb connect <tv-ip>:<port>` and use the TV's own
// sdbd (push, install, shell, forward) without Developer Mode's Host PC IP
// pointing at that PC. Every relayed client still reaches sdbd from 127.0.0.1
// (this process's own loopback), which is the host sdbd already trusts; nothing
// here changes what sdbd authorizes.
//
// The Q80A's sdbd accepts only ONE host connection at a time: a second socket
// is accepted and closed before CNXN. A plain per-client byte relay therefore
// cannot give the PC and Vetro simultaneous access. This server keeps a single
// upstream SDB connection to sdbd and multiplexes every client's streams over
// it, rewriting only the local stream ids (arg0 on client->device packets,
// arg1 on device->client packets). CNXN is answered locally, so sdbd sees one
// handshake no matter how many clients are connected.
//
// sdbd is a shared resource: while this server holds its one host connection,
// no other app on the TV (TV-Store, for one) can reach it. The upstream is
// therefore opened on the first client CNXN and released again once the last
// client is gone and a short grace period has passed (IDLE_RELEASE_MS), so a
// burst of Vetro operations does not reconnect every time. The next CNXN opens
// it again. A client that stays connected keeps the upstream held.
//
// SDB clients do not carry Vetro's HTTP pairing token. Keep the listener on
// loopback by default. The integration binds one shared listener with remote
// admission off until its persisted dashboard toggle is enabled; off revokes
// remote clients without interrupting local streams (see SECURITY.md).

var net = require('net');
var SDB_PORT = require('./sdb.js').SDB_PORT;

var NAMES = ['SYNC', 'OPEN', 'CNXN', 'AUTH', 'OKAY', 'CLSE', 'WRTE'];
var CMD = {};
var MAGIC = {};
NAMES.forEach(function (name) {
    CMD[name] = Buffer.from(name).readUInt32LE(0);
    MAGIC[CMD[name]] = (CMD[name] ^ 0xffffffff) >>> 0;
});

var HEADER_BYTES = 24;
var MAX_PAYLOAD = 4096;
// The SDK's file-sync client sends a DATA/DONE envelope in the same WRTE as its
// file bytes (4111 bytes for a 4095-byte file), even when CNXN advertises 4096.
// This is a framing safety bound, not the negotiated write size. Relay those
// vendor frames with a finite allocation limit. Split writes before forwarding
// to the legacy upstream, which still enforces our 4096-byte negotiation.
var MAX_FRAME_BYTES = 1024 * 1024;
var VERSION = 0x01000000;
var FIRST_STREAM_ID = 0x40000000;
var IDLE_RELEASE_MS = 3000;

function alloc(length) {
    return Buffer.alloc ? Buffer.alloc(length) : new Buffer(length);
}

function checksum(data) {
    var total = 0;
    for (var i = 0; i < data.length; i++) total = (total + data[i]) & 0xffffffff;
    return total;
}

function encode(command, arg0, arg1, payload) {
    var data = (typeof payload === 'string')
        ? Buffer.concat([Buffer.from(payload), Buffer.from([0])])
        : (payload || alloc(0));
    var length = data.length;
    var packet = alloc(HEADER_BYTES + length);
    packet.writeUInt32LE(command, 0);
    packet.writeUInt32LE(arg0 >>> 0, 4);
    packet.writeUInt32LE(arg1 >>> 0, 8);
    packet.writeUInt32LE(length, 12);
    packet.writeUInt32LE(checksum(data), 16);
    packet.writeUInt32LE(MAGIC[command], 20);
    if (length) data.copy(packet, HEADER_BYTES);
    return packet;
}

function decodeAll(buffer) {
    var packets = [];
    var offset = 0;
    while (buffer.length - offset >= HEADER_BYTES) {
        var command = buffer.readUInt32LE(offset);
        var magic = buffer.readUInt32LE(offset + 20);
        if (((command ^ 0xffffffff) >>> 0) !== magic) return { bad: true };
        var length = buffer.readUInt32LE(offset + 12);
        if (length > MAX_FRAME_BYTES) return { bad: true };
        if (buffer.length - offset < HEADER_BYTES + length) break;
        packets.push({
            command: command,
            arg0: buffer.readUInt32LE(offset + 4),
            arg1: buffer.readUInt32LE(offset + 8),
            payload: buffer.slice(offset + HEADER_BYTES, offset + HEADER_BYTES + length)
        });
        offset += HEADER_BYTES + length;
    }
    return { bad: false, packets: packets, rest: buffer.slice(offset) };
}

function validPort(port) {
    return typeof port === 'number' && isFinite(port) &&
        Math.floor(port) === port && port >= 0 && port <= 65535;
}

function Client(socket, pool) {
    this.socket = socket;
    this.pool = pool;
    this.buffer = alloc(0);
    this.cnxn = false;
    this.streams = new Map();
    var self = this;
    socket.on('data', function (chunk) {
        self.buffer = Buffer.concat([self.buffer, chunk]);
        self.drain();
    });
    socket.on('error', function (e) {
        self.pool.log('sdb client error: ' + (e && e.message || e));
        socket.destroy();
    });
    socket.on('close', function () { self.pool.removeClient(self); });
}

Client.prototype.writePacket = function (command, arg0, arg1, payload) {
    if (this.socket.destroyed) return;
    this.socket.write(encode(command, arg0, arg1, payload));
};

Client.prototype.drain = function () {
    var decoded = decodeAll(this.buffer);
    if (decoded.bad) { this.socket.destroy(); return; }
    this.buffer = decoded.rest;
    for (var i = 0; i < decoded.packets.length; i++) {
        this.pool.onClientPacket(this, decoded.packets[i]);
    }
};

function Pool(host, port, log, idleMs) {
    this.host = host;
    this.port = port;
    this.log = log;
    this.idleMs = idleMs;
    this.idleTimer = null;
    this.socket = null;
    this.ready = false;
    this.buffer = alloc(0);
    this.queued = [];
    this.streams = new Map();
    this.clients = new Set();
    this.nextId = FIRST_STREAM_ID;
    this.banner = null;
}

// The first client's CNXN payload becomes the upstream banner, so sdbd sees the
// same host features it saw through a direct connection. Later clients get the
// device banner back but cannot renegotiate the shared upstream.
Pool.prototype.startUpstream = function (payload) {
    if (this.socket) return;
    var self = this;
    var socket = net.connect(this.port, this.host);
    this.socket = socket;
    this.ready = false;
    socket.on('connect', function () {
        socket.write(encode(CMD.CNXN, VERSION, MAX_PAYLOAD, payload || 'host::'));
    });
    socket.on('data', function (chunk) {
        self.buffer = Buffer.concat([self.buffer, chunk]);
        self.drainUpstream();
    });
    socket.on('error', function (e) {
        self.log('sdb upstream error: ' + (e && e.message || e));
        self.reset();
    });
    socket.on('close', function () { self.reset(); });
};

Pool.prototype.reset = function () {
    this.cancelIdle();
    var socket = this.socket;
    this.socket = null;
    this.ready = false;
    this.buffer = alloc(0);
    this.queued = [];
    this.streams.clear();
    this.banner = null;
    var clients = this.clients;
    this.clients = new Set();
    clients.forEach(function (client) {
        client.streams.clear();
        client.socket.destroy();
    });
    if (socket) { try { socket.destroy(); } catch (e) {} }
};

Pool.prototype.cancelIdle = function () {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
};

// Give sdbd back once nobody is connected. reset() also drops the cached banner
// and any half-open handshake, so the next CNXN starts from a clean upstream.
Pool.prototype.scheduleIdle = function () {
    var self = this;
    this.cancelIdle();
    if (!this.socket || this.clients.size > 0) return;
    this.idleTimer = setTimeout(function () {
        self.idleTimer = null;
        if (self.clients.size > 0 || !self.socket) return;
        self.log('sdb tunnel idle, releasing sdbd');
        self.reset();
    }, this.idleMs);
    if (this.idleTimer && typeof this.idleTimer.unref === 'function') this.idleTimer.unref();
};

Pool.prototype.addClient = function (socket) {
    this.cancelIdle();
    var client = new Client(socket, this);
    this.clients.add(client);
    return client;
};

Pool.prototype.sendBanner = function (client) {
    client.pendingCnxn = false;
    client.writePacket(CMD.CNXN, this.banner.arg0, this.banner.arg1, this.banner.payload);
};

Pool.prototype.clientHandshake = function (client, packet) {
    client.cnxn = true;
    if (!this.socket) {
        this.startUpstream(packet.payload && packet.payload.length ? packet.payload : null);
    }
    if (this.ready && this.banner) this.sendBanner(client);
    else client.pendingCnxn = true;
};

Pool.prototype.removeClient = function (client) {
    this.clients.delete(client);
    var self = this;
    client.streams.forEach(function (upstreamId) {
        var stream = self.streams.get(upstreamId);
        self.streams.delete(upstreamId);
        if (stream && self.ready && self.socket && self.socket.writable) {
            self.socket.write(encode(CMD.CLSE, upstreamId, stream.remoteId < 0 ? 0 : stream.remoteId, null));
        }
    });
    client.streams.clear();
    this.scheduleIdle();
};

Pool.prototype.sendUpstream = function (packet) {
    if (this.ready && this.socket && this.socket.writable) this.socket.write(packet);
    else this.queued.push(packet);
};

Pool.prototype.drainUpstream = function () {
    var decoded = decodeAll(this.buffer);
    if (decoded.bad) { this.reset(); return; }
    this.buffer = decoded.rest;
    for (var i = 0; i < decoded.packets.length; i++) {
        this.onUpstreamPacket(decoded.packets[i]);
    }
};

Pool.prototype.onUpstreamPacket = function (packet) {
    var stream;
    switch (packet.command) {
        case CMD.CNXN:
            this.ready = true;
            this.banner = packet;
            var queued = this.queued;
            this.queued = [];
            for (var i = 0; i < queued.length; i++) this.sendUpstream(queued[i]);
            var self = this;
            this.clients.forEach(function (client) {
                if (client.pendingCnxn) self.sendBanner(client);
            });
            break;
        case CMD.AUTH:
            this.log('sdbd asked for key authentication; closing tunnel clients');
            this.reset();
            break;
        case CMD.OKAY:
            stream = this.streams.get(packet.arg1);
            if (!stream) break;
            if (stream.remoteId < 0) stream.remoteId = packet.arg0;
            if (stream.pendingWrite) {
                if (stream.pendingWrite.offset < stream.pendingWrite.payload.length) {
                    this.writeFragment(packet.arg1, stream);
                    break;
                }
                stream.pendingWrite = null;
            }
            stream.client.writePacket(CMD.OKAY, packet.arg0, stream.clientId, null);
            break;
        case CMD.WRTE:
            stream = this.streams.get(packet.arg1);
            if (!stream) break;
            // Do not auto-ack: the client owns flow control and will send its
            // own OKAY, which this relay forwards onto the shared upstream.
            stream.client.writePacket(CMD.WRTE, packet.arg0, stream.clientId, packet.payload);
            break;
        case CMD.CLSE:
            stream = this.streams.get(packet.arg1);
            if (!stream) break;
            stream.client.streams.delete(stream.clientId);
            this.streams.delete(packet.arg1);
            stream.client.writePacket(CMD.CLSE, packet.arg0, stream.clientId, null);
            break;
        default:
            this.log('sdbd sent ' + packet.command);
            break;
    }
};

// One client WRTE earns one OKAY, after every upstream fragment was acknowledged.
Pool.prototype.writeFragment = function (id, stream) {
    var pending = stream.pendingWrite;
    var end = Math.min(pending.offset + MAX_PAYLOAD, pending.payload.length);
    var data = pending.payload.slice(pending.offset, end);
    pending.offset = end;
    this.sendUpstream(encode(CMD.WRTE, id, pending.remoteId, data));
};

Pool.prototype.onClientPacket = function (client, packet) {
    var upstreamId;
    switch (packet.command) {
        case CMD.CNXN:
            // Terminate the handshake here: sdbd allows one host connection.
            this.clientHandshake(client, packet);
            break;
        case CMD.OPEN:
            upstreamId = this.nextId++;
            this.streams.set(upstreamId, { client: client, clientId: packet.arg0, remoteId: -1 });
            client.streams.set(packet.arg0, upstreamId);
            this.sendUpstream(encode(CMD.OPEN, upstreamId, 0, packet.payload));
            break;
        case CMD.WRTE:
            upstreamId = client.streams.get(packet.arg0);
            if (upstreamId === undefined) break;
            var stream = this.streams.get(upstreamId);
            if (stream.pendingWrite) { client.socket.destroy(); break; }
            stream.pendingWrite = {payload: packet.payload, offset: 0, remoteId: packet.arg1};
            this.writeFragment(upstreamId, stream);
            break;
        case CMD.OKAY:
            upstreamId = client.streams.get(packet.arg0);
            if (upstreamId === undefined) break;
            this.sendUpstream(encode(CMD.OKAY, upstreamId, packet.arg1, null));
            break;
        case CMD.CLSE:
            upstreamId = client.streams.get(packet.arg0);
            if (upstreamId === undefined) break;
            client.streams.delete(packet.arg0);
            this.streams.delete(upstreamId);
            this.sendUpstream(encode(CMD.CLSE, upstreamId, packet.arg1, null));
            break;
        default:
            this.log('sdb client sent ' + packet.command);
            break;
    }
};

Pool.prototype.close = function () {
    this.cancelIdle();
    var clients = this.clients;
    this.clients = new Set();
    clients.forEach(function (client) { client.streams.clear(); client.socket.destroy(); });
    var socket = this.socket;
    this.socket = null;
    this.ready = false;
    if (socket) { try { socket.destroy(); } catch (e) {} }
};

function TunnelServer(opts) {
    opts = opts || {};
    this.port = opts.port === undefined ? 0 : opts.port;
    this.bindHost = opts.bindHost || '127.0.0.1';
    this.lanEnabled = opts.lanEnabled === true;
    this.remoteClients = new Set();
    this.sdbHost = opts.sdbHost || '127.0.0.1';
    this.sdbPort = opts.sdbPort || SDB_PORT;
    this.log = opts.log || function () {};
    this.idleMs = opts.idleMs === undefined ? IDLE_RELEASE_MS : opts.idleMs;
    this._server = null;
    this._pool = null;
}

// The same pool and local client sockets stay alive when LAN access changes.
// Refuse remote clients before parsing any SDB frame, and revoke existing ones on off.
TunnelServer.prototype.acceptClient = function (client) {
    var self = this, address = client.remoteAddress;
    var local = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
    if (!local) {
        if (!this.lanEnabled) { client.destroy(); return; }
        this.remoteClients.add(client);
        client.on('close', function () { self.remoteClients.delete(client); });
    }
    this._pool.addClient(client);
};
TunnelServer.prototype.setLan = function (enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Invalid SDB access state');
    this.lanEnabled = enabled;
    if (!enabled) {
        this.remoteClients.forEach(function (client) { client.destroy(); });
        this.remoteClients.clear();
    }
};

TunnelServer.prototype.start = function (cb) {
    var self = this;
    var called = false;
    function done(err, port) {
        if (called) return;
        called = true;
        if (cb) cb(err, port);
    }

    if (!validPort(this.port) || !validPort(this.sdbPort)) {
        process.nextTick(function () {
            done(new Error('invalid tunnel port: ' + self.port + ' (sdb ' + self.sdbPort + ')'));
        });
        return this;
    }

    this._pool = new Pool(this.sdbHost, this.sdbPort, this.log, this.idleMs);
    this._server = net.createServer(function (client) {
        // One multiplexed upstream for every client: sdbd sees a single host
        // connection, while each client keeps its own CNXN and stream ids.
        self.acceptClient(client);
    });
    this._server.on('error', function (e) { done(e); });
    this._server.listen(this.port, this.bindHost, function () {
        var port = self._server.address().port;
        self.log('sdb tunnel listening on ' + self.bindHost + ':' + port);
        done(null, port);
    });
    return this;
};

TunnelServer.prototype.close = function () {
    this.setLan(false);
    if (this._pool) { this._pool.close(); this._pool = null; }
    if (this._server) { try { this._server.close(); } catch (e) {} this._server = null; }
};

module.exports = { TunnelServer: TunnelServer };