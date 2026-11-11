'use strict';

// Node port of the SamsungTvRootAgent protocol (server side).
//
// SamsungTvRootAgent.dll runs as uid 0 (launched by the archive-root chain),
// calls setsid() to detach from the launch.sh teardown, then connects back to
// this server on TCP and replies to authenticated commands. This gives /exec
// and /debloat a persistent root channel that does not race launch.sh.
//
// Protocol (mirrors samsung_tv_root/root_agent.py):
//   - server greeting:  "SAMSUNG-TV-ROOT/1\t<nonce hex>\n"
//   - frames:           "payload\tauthenticator\n" where
//                       authenticator = hex(HMAC-SHA256(secret, nonce || 0x00 || payload))
//   - agent AUTH:       "AUTH\tpid\tuid\teuid\tgid\tegid\tcap_eff\t<smack b64>"
//   - server EXEC:      "EXEC\tseq\ttimeout_ms\t<cmd b64>"
//   - agent RESULT:     "RESULT\tseq\texitcode\ttimedout\t<stdout b64>\t<stderr b64>"

var net = require('net');
var crypto = require('crypto');

var PROTOCOL_VERSION = 'SAMSUNG-TV-ROOT/1';
var MAX_FRAME_BYTES = 8 * 1024 * 1024;
var MAX_PENDING = 32;

function RootAgentServer(opts) {
    opts = opts || {};
    this.bindHost = opts.bindHost || '127.0.0.1';
    this.port = opts.port || 0;
    this.secret = opts.secret || crypto.randomBytes(32); // Buffer, 32+ bytes
    this.onConnect = opts.onConnect;    // (conn) -> void
    this.onClose = opts.onClose;        // () -> void
    this._server = null;
    this._conn = null;
    this._listeningPort = 0;
    this.log = [];   // why each connection was rejected; shown in /status
}

RootAgentServer.prototype.note = function (what) {
    this.log.push({ at: Date.now(), what: String(what) });
    if (this.log.length > 20) this.log.shift();
};

RootAgentServer.prototype.start = function (cb) {
    var self = this;
    var listener = net.createServer(function (socket) {
        self._handle(socket);
    });
    this._server = listener;
    listener.on('error', function (e) { if (self._server === listener && self.onClose) self.onClose(e); });
    listener.listen(this.port, this.bindHost, function () {
        if (self._server !== listener) { try { listener.close(); } catch (e) {} return; }
        self._listeningPort = listener.address().port;
        if (cb) cb(self._listeningPort);
    });
    return this;
};

RootAgentServer.prototype.listeningPort = function () { return this._listeningPort; };

RootAgentServer.prototype._handle = function (socket) {
    var self = this;
    if (this._conn) { this.note('second connection while one agent is active'); socket.destroy(); return; }

    var nonce = crypto.randomBytes(32);
    socket.write(PROTOCOL_VERSION + '\t' + nonce.toString('hex') + '\n');

    var buf = '';
    var authed = false;

    // the agent must AUTH within 10s; a silent peer is dropped (the host tool
    // uses the same DEFAULT_COMMAND_TIMEOUT for the AUTH frame)
    var authTimer = setTimeout(function () {
        if (!authed) socket.destroy();
    }, 10000);

    socket.on('data', function (chunk) {
        buf += chunk.toString('utf8');
        var idx;
        if (buf.length > MAX_FRAME_BYTES && buf.indexOf('\n') === -1) {
            self.note('frame too large'); socket.destroy(); return;
        }
        while ((idx = buf.indexOf('\n')) !== -1) {
            if (idx > MAX_FRAME_BYTES) { self.note('frame too large'); socket.destroy(); return; }
            var line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            if (!line) continue;

            var payload;
            try { payload = self._verify(line, nonce); }
            catch (e) { self.note('auth frame rejected: ' + (e.message || e)); socket.destroy(); return; }

            if (!authed) {
                // expect AUTH with a full root identity (same require_root as
                // the host tool: a non-root "agent" must never be accepted)
                var af = payload.split('\t');
                if (af.length !== 8 || af[0] !== 'AUTH' || self._conn
                    || !/^[1-9][0-9]*$/.test(af[1])
                    || !af.slice(2, 6).every(function (v) { return v === '0'; })) {
                    self.note('invalid AUTH identity or competing agent');
                    socket.destroy();
                    return;
                }
                var ident = {
                    pid: parseInt(af[1], 10),
                    uid: parseInt(af[2], 10),
                    euid: parseInt(af[3], 10),
                    gid: parseInt(af[4], 10),
                    egid: parseInt(af[5], 10),
                    cap_eff: af[6],
                    smack: Buffer.from(af[7] || '', 'base64').toString('utf8')
                };
                if (ident.uid !== 0 || ident.euid !== 0 || ident.gid !== 0 || ident.egid !== 0) {
                    self.note('non-root agent uid=' + ident.uid + ' euid=' + ident.euid);
                    socket.destroy();
                    return;
                }
                authed = true;
                clearTimeout(authTimer);
                self._conn = new RootAgentConnection(socket, self.secret, nonce, ident);
                if (self.onConnect) self.onConnect(self._conn);
                continue;
            }

            // after auth, frames are handled by the connection
            if (self._conn) self._conn._onFrame(payload);
        }
        if (buf.length > MAX_FRAME_BYTES) { self.note('frame too large'); socket.destroy(); }
    });

    socket.on('error', function (e) { self.note('socket error: ' + (e.message || e)); });
    socket.on('close', function () {
        clearTimeout(authTimer);
        if (self._conn && self._conn._socket === socket) {
            self._conn._failPending(new Error('root agent disconnected'));
            self._conn = null;
            if (self.onClose) self.onClose();
        } else if (!authed) {
            self.note('connection closed before auth');
        }
    });
};

RootAgentServer.prototype._verify = function (line, nonce) {
    var sep = line.lastIndexOf('\t');
    if (sep === -1) throw new Error('no authenticator');
    var payload = line.slice(0, sep);
    var observed = line.slice(sep + 1);
    var expected = crypto.createHmac('sha256', this.secret)
        .update(nonce).update('\x00').update(payload, 'utf8').digest('hex');
    if (!/^[a-f0-9]{64}$/.test(observed)) throw new Error('invalid authenticator');
    if (!crypto.timingSafeEqual(Buffer.from(observed, 'hex'), Buffer.from(expected, 'hex'))) {
        throw new Error('auth failed');
    }
    return payload;
};

RootAgentServer.prototype.execute = function (command, timeoutMs) {
    if (!this._conn) return Promise.reject(new Error('no root agent connected'));
    return this._conn.execute(command, timeoutMs);
};

RootAgentServer.prototype.close = function () {
    this._listeningPort = 0;
    if (this._conn) {
        this._conn._failPending(new Error('root agent server closed'));
        try { this._conn._socket.destroy(); } catch (e) {}
        this._conn = null;
    }
    if (this._server) { try { this._server.close(); } catch (e) {} this._server = null; }
};

// --- connection (server side, one agent) ----------------------------------
function RootAgentConnection(socket, secret, nonce, identity) {
    this._socket = socket;
    this._secret = secret;
    this._nonce = nonce;
    this.identity = identity;
    this._sequence = 0;
    this._pending = {}; // seq -> { resolve, reject }
}

RootAgentConnection.prototype._send = function (payload) {
    var mac = crypto.createHmac('sha256', this._secret)
        .update(this._nonce).update('\x00').update(payload, 'utf8').digest('hex');
    this._socket.write(payload + '\t' + mac + '\n');
};

RootAgentConnection.prototype._onFrame = function (payload) {
    var f = payload.split('\t');
    if (f[0] === 'RESULT' && f.length >= 6) {
        var seq = f[1];
        var p = this._pending[seq];
        if (p) {
            delete this._pending[seq];
            clearTimeout(p.timer);
            if (f.length !== 6 || !/^-?[0-9]+$/.test(f[2]) || !/^[01]$/.test(f[3])) {
                p.reject(new Error('invalid root agent result'));
                this._socket.destroy();
                return;
            }
            p.resolve({
                exit_code: parseInt(f[2], 10),
                timed_out: f[3] === '1',
                stdout: Buffer.from(f[4], 'base64').toString('utf8'),
                stderr: Buffer.from(f[5], 'base64').toString('utf8')
            });
        }
    } else if (f[0] === 'PONG') {
        var s = f[1], pr = this._pending[s];
        if (pr) { delete this._pending[s]; clearTimeout(pr.timer); pr.resolve(f); }
    }
};

RootAgentConnection.prototype._failPending = function (error) {
    var pending = this._pending;
    this._pending = {};
    Object.keys(pending).forEach(function (seq) {
        clearTimeout(pending[seq].timer);
        pending[seq].reject(error);
    });
};

RootAgentConnection.prototype.execute = function (command, timeoutMs) {
    var self = this;
    timeoutMs = timeoutMs == null ? 30000 : timeoutMs;
    if (typeof command !== 'string' || !command.trim() || Buffer.byteLength(command) > 65536) {
        return Promise.reject(new Error('invalid or oversized command'));
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
        return Promise.reject(new Error('invalid command timeout'));
    }
    if (self._socket.destroyed) return Promise.reject(new Error('root agent disconnected'));
    if (Object.keys(self._pending).length >= MAX_PENDING) return Promise.reject(new Error('root agent busy'));
    return new Promise(function (resolve, reject) {
        var seq = ++self._sequence;
        var timer = setTimeout(function () {
            if (self._pending[seq]) {
                delete self._pending[seq];
                reject(new Error('root agent execute timeout; command outcome unknown'));
                // Do not reuse a channel whose command may still be running.
                self._socket.destroy();
            }
        }, timeoutMs + 5000);
        self._pending[seq] = { resolve: resolve, reject: reject, timer: timer };
        try {
            var b64 = Buffer.from(command, 'utf8').toString('base64');
            self._send('EXEC\t' + seq + '\t' + timeoutMs + '\t' + b64);
        } catch (e) {
            clearTimeout(timer);
            delete self._pending[seq];
            reject(e);
            self._socket.destroy();
        }
    });
};

module.exports = { RootAgentServer };
