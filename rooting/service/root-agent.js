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
// The agent runs one command at a time, ends it at its timeout and answers at once. GRACE_MS is how long that answer may take
// after the timeout before the caller is told; a late answer still frees the channel. Only an agent silent for LATE_MAX_MS more
// is taken for stuck, and the channel is closed: a relaunch through sdb costs seconds and every command fails meanwhile, and a
// command answering late is one way two diagnostics exports (2026-11-20) may have lost the channel. The agent may answer late when
// a process the command started outside its process group keeps stdout open: it waits for the end of the output after the kill.
var GRACE_MS = 5000;
var LATE_MAX_MS = 30000;

// A refused or lost command carries a fixed code (app/service/exec-error.js CODES), so a diagnostics report says why a section is
// missing: a timed-out command closes the channel and every command after it fails until the agent is back.
function coded(message, code) { var e = new Error(message); e.code = code; return e; }
// Closes a socket from this side, keeping the first reason for the diagnostics (an agent that closes by itself reads as "closed").
function drop(socket, reason) { if (!socket.vetroDrop) socket.vetroDrop = reason; socket.destroy(); }

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
    // How the channel has fared, for the diagnostics: answers that came after the caller had given up, and why each agent was lost.
    this.channel = {lateAnswers: 0, lateMaxMs: 0, busyRefusals: 0, drops: []};
    this.graceMs = opts.graceMs || GRACE_MS;        // shorter only in tests
    this.lateMaxMs = opts.lateMaxMs || LATE_MAX_MS;
}

RootAgentServer.prototype.dropped = function (reason, timeoutMs) {
    this.channel.drops.push({at: Date.now(), reason: reason, timeoutMs: timeoutMs || null});
    if (this.channel.drops.length > 6) this.channel.drops.shift();
};

RootAgentServer.prototype.note = function (what) {
    this.log.push({ at: Date.now(), what: String(what) });
    if (this.log.length > 20) this.log.shift();
};

RootAgentServer.prototype.start = function (cb) {
    var self = this;
    this._server = net.createServer(function (socket) {
        self._handle(socket);
    });
    this._server.on('error', function (e) { if (self.onClose) self.onClose(e); });
    this._server.listen(this.port, this.bindHost, function () {
        self._listeningPort = self._server.address().port;
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
            self.note('frame too large'); drop(socket, 'frame-too-large'); return;
        }
        while ((idx = buf.indexOf('\n')) !== -1) {
            if (idx > MAX_FRAME_BYTES) { self.note('frame too large'); drop(socket, 'frame-too-large'); return; }
            var line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            if (!line) continue;

            var payload;
            try { payload = self._verify(line, nonce); }
            catch (e) { self.note('auth frame rejected: ' + (e.message || e)); drop(socket, 'bad-frame'); return; }

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
                self._conn = new RootAgentConnection(socket, self.secret, nonce, ident, self.channel, {graceMs: self.graceMs, lateMaxMs: self.lateMaxMs});
                if (self.onConnect) self.onConnect(self._conn);
                continue;
            }

            // after auth, frames are handled by the connection
            if (self._conn) self._conn._onFrame(payload);
        }
        if (buf.length > MAX_FRAME_BYTES) { self.note('frame too large'); drop(socket, 'frame-too-large'); }
    });

    socket.on('error', function (e) { self.note('socket error: ' + (e.message || e)); });
    socket.on('close', function () {
        clearTimeout(authTimer);
        if (self._conn && self._conn._socket === socket) {
            var stuck = self._conn.stuck;
            self.dropped(socket.vetroDrop || 'closed', stuck ? stuck.timeoutMs : null);
            self._conn._failPending(coded('root agent disconnected', 'no-root-agent'));
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
    if (!this._conn) return Promise.reject(coded('no root agent connected', 'no-root-agent'));
    return this._conn.execute(command, timeoutMs);
};

RootAgentServer.prototype.close = function () {
    if (this._conn) {
        this._conn._failPending(new Error('root agent server closed'));
        try { this._conn._socket.destroy(); } catch (e) {}
        this._conn = null;
    }
    if (this._server) { try { this._server.close(); } catch (e) {} this._server = null; }
};

// --- connection (server side, one agent) ----------------------------------
function RootAgentConnection(socket, secret, nonce, identity, channel, limits) {
    this._socket = socket;
    this._secret = secret;
    this._nonce = nonce;
    this.identity = identity;
    this._sequence = 0;
    this._pending = {}; // seq -> job, the one command the agent is running
    this._queue = [];   // commands not sent yet: the agent would only start them after the current one
    this._current = null;
    this.stuck = null;  // the command the channel was closed for
    this._channel = channel || {lateAnswers: 0, lateMaxMs: 0, busyRefusals: 0, drops: []};
    this._graceMs = (limits && limits.graceMs) || GRACE_MS;
    this._lateMaxMs = (limits && limits.lateMaxMs) || LATE_MAX_MS;
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
            if (this._current === p) this._current = null;
            if (f.length !== 6 || !/^-?[0-9]+$/.test(f[2]) || !/^[01]$/.test(f[3])) {
                p.reject(new Error('invalid root agent result'));
                drop(this._socket, 'bad-result');
                return;
            }
            if (p.lateAt) {
                // The caller was already told the command timed out; the answer only frees the channel.
                var lateMs = Date.now() - p.lateAt;
                this._channel.lateAnswers++;
                if (lateMs > this._channel.lateMaxMs) this._channel.lateMaxMs = lateMs;
            } else {
                p.resolve({
                    exit_code: parseInt(f[2], 10),
                    timed_out: f[3] === '1',
                    stdout: Buffer.from(f[4], 'base64').toString('utf8'),
                    stderr: Buffer.from(f[5], 'base64').toString('utf8')
                });
            }
            this._pump();
        }
    } else if (f[0] === 'PONG') {
        var s = f[1], pr = this._pending[s];
        if (pr) { delete this._pending[s]; clearTimeout(pr.timer); pr.resolve(f); }
    }
};

RootAgentConnection.prototype._failPending = function (error) {
    var pending = this._pending, queue = this._queue;
    this._pending = {};
    this._queue = [];
    this._current = null;
    Object.keys(pending).forEach(function (seq) {
        clearTimeout(pending[seq].timer);
        pending[seq].reject(error);
    });
    queue.forEach(function (job) { clearTimeout(job.timer); job.reject(error); });
};

// Sends the next waiting command once the agent has answered the one before (or the channel is free). The timer of a command
// starts when it is sent: before, a command queued behind a slow one ran out of time without having started.
RootAgentConnection.prototype._pump = function () {
    var self = this;
    if (this._current || !this._queue.length || this._socket.destroyed) return;
    var job = this._queue.shift();
    clearTimeout(job.timer);
    var seq = ++this._sequence;
    this._current = job;
    this._pending[seq] = job;
    job.timer = setTimeout(function () {
        if (self._pending[seq] !== job) return;
        job.lateAt = Date.now();
        job.reject(coded('root agent execute timeout; command outcome unknown', 'command-timeout'));
        job.timer = setTimeout(function () {
            if (self._pending[seq] !== job) return;
            self.stuck = {timeoutMs: job.timeoutMs};
            drop(self._socket, 'command-timeout');
        }, self._lateMaxMs);
    }, job.timeoutMs + self._graceMs);
    try {
        var b64 = Buffer.from(job.command, 'utf8').toString('base64');
        this._send('EXEC\t' + seq + '\t' + job.timeoutMs + '\t' + b64);
    } catch (e) {
        clearTimeout(job.timer);
        delete this._pending[seq];
        this._current = null;
        job.reject(e);
        drop(this._socket, 'send-failed');
    }
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
    if (self._socket.destroyed) return Promise.reject(coded('root agent disconnected', 'no-root-agent'));
    if (self._queue.length + (self._current ? 1 : 0) >= MAX_PENDING) {
        self._channel.busyRefusals++;
        return Promise.reject(coded('root agent busy', 'agent-busy'));
    }
    return new Promise(function (resolve, reject) {
        var job = {command: command, timeoutMs: timeoutMs, resolve: resolve, reject: reject, timer: null, lateAt: 0};
        // A command still waiting behind a late one gives up in its own time and leaves the channel alone.
        job.timer = setTimeout(function () {
            var i = self._queue.indexOf(job);
            if (i < 0) return;
            self._queue.splice(i, 1);
            self._channel.busyRefusals++;
            reject(coded('root agent busy: an earlier command has not answered yet', 'agent-busy'));
        }, timeoutMs + self._graceMs);
        self._queue.push(job);
        self._pump();
    });
};

module.exports = { RootAgentServer, GRACE_MS: GRACE_MS, LATE_MAX_MS: LATE_MAX_MS };