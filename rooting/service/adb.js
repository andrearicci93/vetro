'use strict';

// Minimal ADB/SDB wire protocol client (CNXN -> OPEN -> WRTE/OKAY/CLSE).
// sdbd authorizes by developer host IP, not by key: this client never handles AUTH.

const net = require('net');
// Node 4.4 (Tizen 5.5 and older) cannot parse destructuring.
const EventEmitter = require('events').EventEmitter;
const Duplex = require('stream').Duplex;

const COMMANDS = ['SYNC', 'OPEN', 'CNXN', 'AUTH', 'OKAY', 'CLSE', 'WRTE']
    .reduce((all, name) => { all[name] = Buffer.from(name).readUInt32LE(0); return all; }, {});
const NAMES = {};
Object.keys(COMMANDS).forEach((n) => { NAMES[COMMANDS[n]] = n; });

const HEADER_BYTES = 24;
const MAX_PAYLOAD = 4096;
const KEEPALIVE_MS = 30000;

const nameOf = (c) => NAMES[c] || ('0x' + (c >>> 0).toString(16));
const magicFor = (c) => (c ^ 0xFFFFFFFF) >>> 0;

function checksum(data) {
    if (!data) return 0;
    let total = 0;
    for (let i = 0; i < data.length; i++) total = (total + data[i]) & 0xFFFFFFFF;
    return total;
}

function encodePacket(command, arg1, arg2, payload) {
    const data = (typeof payload === 'string')
        ? Buffer.concat([Buffer.from(payload), Buffer.from([0])])
        : payload;
    const length = data ? data.length : 0;
    const packet = Buffer.alloc(HEADER_BYTES + length);
    packet.writeUInt32LE(command, 0);
    packet.writeUInt32LE(arg1, 4);
    packet.writeUInt32LE(arg2, 8);
    packet.writeUInt32LE(length, 12);
    packet.writeUInt32LE(checksum(data), 16);
    packet.writeUInt32LE(magicFor(command), 20);
    if (length > 0) data.copy(packet, HEADER_BYTES);
    return packet;
}

function decodeHeader(header) {
    return {
        command: header.readUInt32LE(0),
        arg1: header.readUInt32LE(4),
        arg2: header.readUInt32LE(8),
        dataLength: header.readUInt32LE(12),
        dataCheck: header.readUInt32LE(16),
        magic: header.readUInt32LE(20),
        data: null
    };
}

class Stream extends Duplex {
    constructor(connection, localId) {
        super();
        this._connection = connection;
        this._localId = localId;
        this._remoteId = -1;
        this._queue = [];
        this._inFlight = null;
        this.once('open', () => this._flush());
    }
    localId() { return this._localId; }
    remoteId() { return this._remoteId; }
    _write(chunk, _enc, done) {
        const limit = this._connection.maxPayload();
        if (chunk.length <= limit) {
            this._queue.push({ chunk, done });
        } else {
            for (let at = 0; at < chunk.length; at += limit) {
                const last = at + limit >= chunk.length;
                this._queue.push({ chunk: chunk.slice(at, at + limit), done: last ? done : null });
            }
        }
        this._flush();
    }
    _flush() {
        if (this._remoteId === -1 || this._inFlight || this._queue.length === 0) return;
        const next = this._queue.shift();
        const chunk = next.chunk;
        const done = next.done;
        this._inFlight = done || function () {};
        this._connection._send(COMMANDS.WRTE, this._localId, this._remoteId, chunk);
    }
    _acknowledge() {
        const done = this._inFlight;
        this._inFlight = null;
        if (done) done();
        this._flush();
    }
    _read() {}
    close() { this._connection._closeStream(this); }
}

class Connection extends EventEmitter {
    constructor(host, port, log) {
        super();
        this._log = log || function () {};
        this._socket = net.connect(port, host);
        this._streams = new Map();
        this._nextStreamId = 12345;
        this._handshakeDone = false;
        this._maxPayload = MAX_PAYLOAD;
        this._header = null;
        this._awaitingHeader = true;
        this._connected = false;
        if (this._socket.setKeepAlive) this._socket.setKeepAlive(true, KEEPALIVE_MS);
        this._socket.on('readable', () => this._drain());
        this._socket.on('error', (e) => this._abandon(e));
        this._socket.on('close', () => this._abandon());
        this._socket.on('connect', () => {
            this._connected = true;
            this._send(COMMANDS.CNXN, 0x01000000, MAX_PAYLOAD, 'host::');
        });
    }
    maxPayload() { return this._maxPayload; }
    _drain() {
        for (;;) {
            if (this._awaitingHeader) {
                const header = this._socket.read(HEADER_BYTES);
                if (!header) return;
                this._header = decodeHeader(header);
                if (this._header.magic !== magicFor(this._header.command)) return this._fatal('ESDBFRAMING', 'bad magic');
                if (this._header.dataLength > MAX_PAYLOAD) return this._fatal('ESDBFRAMING', 'oversized payload');
                if (this._header.dataLength === 0) this._dispatch(this._header);
                else this._awaitingHeader = false;
            } else {
                const data = this._socket.read(this._header.dataLength);
                if (!data) return;
                if (checksum(data) !== this._header.dataCheck) return this._fatal('ESDBFRAMING', 'bad checksum');
                this._header.data = data;
                this._dispatch(this._header);
                this._awaitingHeader = true;
            }
        }
    }
    _fatal(code, msg) { this._socket.destroy(Object.assign(new Error(msg), { code })); }
    close() {
        this._streams.forEach((s) => this._closeStream(s));
        this._socket.removeAllListeners('readable');
        this._socket.on('data', () => {});
        this._socket.end();
    }
    _closeStream(stream) {
        if (!this._streams.has(stream.localId())) return;
        this._streams.delete(stream.localId());
        if (this._handshakeDone) this._send(COMMANDS.CLSE, stream.localId(), stream.remoteId() === -1 ? 0 : stream.remoteId());
        stream.push(null);
        stream.end();
    }
    _abandon(cause) {
        if (this._streams.size === 0) return;
        const error = cause || Object.assign(new Error('sdbd closed'), { code: 'ESDBCLOSED' });
        const streams = Array.from(this._streams.values());
        this._streams.clear();
        streams.forEach((stream) => {
            if (stream.listenerCount('error') > 0) stream.emit('error', error);
            stream.push(null);
            stream.end();
        });
    }
    _dispatch(packet) {
        const stream = this._streams.get(packet.arg2);
        switch (packet.command) {
            case COMMANDS.CNXN:
                this._maxPayload = Math.min(MAX_PAYLOAD, packet.arg2 || MAX_PAYLOAD);
                this._handshakeDone = true;
                this.emit('connect');
                break;
            case COMMANDS.AUTH:
                this._fatal('ESDBAUTH', 'sdbd asked for key auth (type ' + packet.arg1 + ')');
                break;
            case COMMANDS.OKAY:
                if (!stream) break;
                if (stream._remoteId === -1) { stream._remoteId = packet.arg1; stream.emit('open'); }
                else stream._acknowledge();
                break;
            case COMMANDS.WRTE:
                if (!stream) break;
                stream.push(packet.data);
                this._send(COMMANDS.OKAY, stream.localId(), stream.remoteId());
                break;
            case COMMANDS.CLSE:
                if (!stream) break;
                stream.push(null);
                stream.end();
                this._streams.delete(packet.arg2);
                break;
            default:
                this._log('sdbd sent ' + nameOf(packet.command));
                break;
        }
    }
    _send(command, arg1, arg2, payload) {
        if (!this._connected) { this._socket.once('connect', () => this._send(command, arg1, arg2, payload)); return; }
        this._socket.write(encodePacket(command, arg1, arg2, payload));
    }
    createStream(service) {
        const stream = new Stream(this, this._nextStreamId++);
        this._streams.set(stream.localId(), stream);
        const open = () => this._send(COMMANDS.OPEN, stream.localId(), 0, service);
        if (this._handshakeDone) open();
        else this.once('connect', open);
        return stream;
    }
}

module.exports = { Connection, createStream: (host, port, log) => new Connection(host, port, log) };