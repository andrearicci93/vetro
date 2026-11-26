'use strict';
// A small HTTPS client for the proxy. Node 12.4 on the TV cannot raise its HTTP header limit (the option arrived in
// 12.17), and YouTube's response headers are bigger than the default 8 KB, so http.request fails with
// HPE_HEADER_OVERFLOW. This one reads the response head by hand. Plain ES5.

var net = require('net');
var tls = require('tls');
var PassThrough = require('stream').PassThrough;

var HAS_AUTO_FAMILY = typeof net.setDefaultAutoSelectFamily === 'function';
var CHUNK_SIZE_RE = /^[0-9a-fA-F]{1,16}[ \t]*(?:;[^\r\n]*)?$/;
var NO_CACHE_HEADERS = { 'if-none-match': 1, 'if-modified-since': 1, 'if-match': 1, 'if-unmodified-since': 1, 'range': 1 };
var RETRYABLE_CODES = {
    ECONNRESET: 1, ECONNREFUSED: 1, EPIPE: 1, ETIMEDOUT: 1,
    EHOSTUNREACH: 1, ENETUNREACH: 1, EAI_AGAIN: 1, ENOTFOUND: 1, ERR_SOCKET_CLOSED: 1
};

function bytes(n) { return Buffer.alloc ? Buffer.alloc(n) : new Buffer(n); }

// Turns a chunked body into plain bytes written to `out`. Feed it with write(buffer).
function Dechunk(out) {
    var buf = bytes(0), state = 'size', left = 0;
    this.complete = function () { return state === 'done'; };
    this.write = function (d) {
        buf = Buffer.concat([buf, d]);
        for (;;) {
            if (state === 'size') {
                var i = buf.indexOf('\r\n');
                if (i < 0) {
                    if (buf.length > 1024) { state = 'bad'; if (out.abort) out.abort(new Error('chunk header too long')); }
                    return;
                }
                var line = buf.slice(0, i).toString('binary');
                buf = buf.slice(i + 2);
                if (!CHUNK_SIZE_RE.test(line)) { state = 'bad'; if (out.abort) out.abort(new Error('bad chunk size')); return; }
                left = parseInt(line.split(';')[0], 16);
                if (left !== left || left < 0) { state = 'bad'; if (out.abort) out.abort(new Error('bad chunk size')); return; }
                if (left === 0) { state = 'done'; if (!out.destroyed && out.writable) out.end(); return; }
                state = 'data';
            } else if (state === 'data') {
                if (!buf.length) return;
                var n = Math.min(left, buf.length);
                if (!out.destroyed && out.writable) out.write(buf.slice(0, n));
                buf = buf.slice(n);
                left -= n;
                if (left === 0) state = 'crlf';
            } else if (state === 'crlf') {
                if (buf.length < 2) return;
                if (buf[0] !== 13 || buf[1] !== 10) { state = 'bad'; if (out.abort) out.abort(new Error('bad chunk delimiter')); return; }
                buf = buf.slice(2);
                state = 'size';
            } else return;
        }
    };
}

// Headers that describe one hop, not the message: never forwarded in either direction.
var HOP = { 'connection': 1, 'proxy-connection': 1, 'keep-alive': 1, 'te': 1, 'upgrade': 1, 'transfer-encoding': 1,
    'content-length': 1, 'proxy-authorization': 1, 'proxy-authenticate': 1, 'trailer': 1 };

// Header names listed in a Connection header describe this hop only.
function nominated(value) {
    var out = {};
    String(value || '').split(',').forEach(function (t) { t = t.trim().toLowerCase(); if (t) out[t] = 1; });
    return out;
}

// "HTTP/1.1 200 OK\r\nA: b" -> {status, headers, chunked, length}. Header names are lower case, repeated ones become arrays.
// A chunked body is reported with chunked:true and without its transfer-encoding and content-length headers. `length` is the
// declared body length, or -1 when there is none to rely on.
function parseHead(text) {
    var lines = text.split('\r\n'), m = /^HTTP\/1\.[01] (\d{3})/.exec(lines[0]);
    var out = { status: m ? parseInt(m[1], 10) : 0, headers: {}, chunked: false, length: -1 }, hop = {};
    for (var i = 1; i < lines.length; i++) {
        var j = lines[i].indexOf(':');
        if (j < 1) continue;
        var k = lines[i].slice(0, j).toLowerCase(), v = lines[i].slice(j + 1).replace(/^\s+/, '').replace(/\s+$/, '');
        if (k === 'transfer-encoding') { if (/chunked/i.test(v)) out.chunked = true; continue; }
        if (k === 'connection') { var n = nominated(v); Object.keys(n).forEach(function (t) { hop[t] = 1; }); continue; }
        if (k === 'keep-alive' || k === 'proxy-connection') continue;
        if (out.headers[k] === undefined) out.headers[k] = v;
        else if (Array.isArray(out.headers[k])) out.headers[k].push(v);
        else out.headers[k] = [out.headers[k], v];
    }
    Object.keys(hop).forEach(function (t) { delete out.headers[t]; });
    var cl = out.headers['content-length'];
    if (cl !== undefined) {
        var vals = Array.isArray(cl) ? cl : [cl], ok = vals.every(function (x) { return /^\d{1,15}$/.test(x) && x === vals[0]; });
        if (ok && !out.chunked) { out.length = parseInt(vals[0], 10); out.headers['content-length'] = vals[0]; }
        if (out.chunked || !ok) delete out.headers['content-length'];
    }
    return out;
}

// The request head as bytes. `headers` is a Node-style object (lower case names). The body length is always declared.
function buildRequest(opts, bodyLength) {
    var lines = [opts.method + ' ' + opts.path + ' HTTP/1.1'], hop = {};
    Object.keys(opts.headers || {}).forEach(function (k) { if (k.toLowerCase() === 'connection') { var v = opts.headers[k]; hop = nominated(Array.isArray(v) ? v.join(',') : v); } });
    Object.keys(opts.headers || {}).forEach(function (k) {
        var key = k.toLowerCase();
        if (HOP[key] || hop[key]) return;
        if (key === 'accept-encoding' && opts.identity) return;
        if (opts.noCache && NO_CACHE_HEADERS[key]) return;
        var v = opts.headers[k];
        (Array.isArray(v) ? v : [v]).forEach(function (x) {
            if (/[\r\n]/.test(String(x))) return;           // never let a value start a second header
            lines.push(key + ': ' + x);
        });
    });
    if (opts.identity) lines.push('accept-encoding: identity');
    if (bodyLength || (opts.method !== 'GET' && opts.method !== 'HEAD')) lines.push('content-length: ' + bodyLength);
    lines.push('connection: close');
    return lines.join('\r\n') + '\r\n\r\n';
}

function isRetryableError(err) {
    if (!err) return false;
    if (err.code && RETRYABLE_CODES[err.code]) return true;
    return err.message === 'closed before a response';
}

// request({host, port, method, path, headers, identity, noCache, timeout, retries}, bodyBuffer, cb)
// cb(err) once, or cb(null, {status, headers, body}) where body is a readable stream of the decoded payload.
// The stream ends normally only when the whole body arrived (declared length reached, last chunk seen, or a close for a body
// with neither); anything shorter ends with an 'error' event, never with a quiet 'end'. A slow reader pauses the socket.
// Returns {abort()}: closes the connection (used when whoever asked has gone away).
// Nothing here may throw out of an event handler: this runs inside Vetro's process.
function request(opts, body, cb) {
    body = body || bytes(0);
    var timeoutMs = opts.timeout || 30000;
    var retriesLeft = typeof opts.retries === 'number' ? opts.retries : ((opts.method === 'GET' || opts.method === 'HEAD') ? 1 : 0);
    var sock = null, retryTimer = null, aborted = false, settled = false, ended = false;
    var payload = new PassThrough();
    payload.on('error', function () { /* the reader went away */ });

    var paused = false, blocked = false;
    payload.on('drain', function () {
        blocked = false;
        if (paused) {
            paused = false;
            try { if (sock) { sock.setTimeout(timeoutMs); sock.resume(); } } catch (e) { /* closed */ }
        }
    });

    function kill() { try { if (sock) sock.destroy(); } catch (x) { /* closed */ } }
    function complete() { if (ended) return; ended = true; try { payload.end(); } catch (e) { /* closed */ } }
    function broken(e) {
        if (ended) return;
        ended = true;
        try { payload.emit('error', e); } catch (x) { /* nobody listens */ }
        try { if (typeof payload.destroy === 'function') payload.destroy(); } catch (y) { /* closed */ }
    }

    function attempt() {
        if (aborted || settled) return;
        var cur = null, head = bytes(0), headDone = false, dech = null;
        var expect = -1, got = 0, bodyless = false, curFailed = false;
        paused = false; blocked = false;
        var sink = {
            writable: true, destroyed: false,
            end: function () { complete(); kill(); },
            abort: function (e) { broken(e); kill(); },
            write: function (d) { if (!ended && !payload.write(d)) blocked = true; }
        };
        function fail(e) {
            if (curFailed) return;
            curFailed = true;
            var err = e instanceof Error ? e : new Error(String(e));
            if (aborted) { kill(); return; }
            if (settled) { broken(err); kill(); return; }
            kill();
            if (!headDone && retriesLeft > 0 && isRetryableError(err)) {
                retriesLeft--;
                retryTimer = setTimeout(function () { retryTimer = null; attempt(); }, 50);
                if (retryTimer && retryTimer.unref) retryTimer.unref();
                return;
            }
            settled = true;
            cb(err);
        }
        function guard(fn) { return function () { if (sock !== cur) return; try { return fn.apply(this, arguments); } catch (e) { fail(e); } }; }
        function feed(d) {
            if (bodyless || ended) return;
            if (dech) dech.write(d);
            else if (expect >= 0) {
                var n = Math.min(d.length, expect - got);
                if (n > 0) sink.write(n === d.length ? d : d.slice(0, n));
                got += n;
                if (got >= expect) { complete(); kill(); return; }
            } else sink.write(d);
            if (blocked && !paused && !ended) { paused = true; try { cur.setTimeout(0); cur.pause(); } catch (e) { /* closed */ } }
        }
        function closed() {
            if (!headDone) { fail(new Error('closed before a response')); return; }
            if (ended) return;
            if (dech || expect >= 0) broken(new Error('response cut short'));
            else complete();
        }
        var tlsOpts = { host: opts.host, port: opts.port || 443, servername: opts.host };
        if (HAS_AUTO_FAMILY) tlsOpts.autoSelectFamily = true;
        try { cur = tls.connect(tlsOpts); sock = cur; }
        catch (e) { setImmediate(function () { fail(e); }); return; }
        cur.setTimeout(timeoutMs, guard(function () {
            if (paused) return;                                  // waiting for the reader, not for the server
            fail(new Error('timeout talking to ' + opts.host));
        }));
        cur.on('error', guard(fail));
        cur.on('secureConnect', guard(function () {
            cur.write(buildRequest(opts, body.length));
            if (body.length) cur.write(body);
        }));
        cur.on('data', guard(function (d) {
            if (headDone) { feed(d); return; }
            head = Buffer.concat([head, d]);
            var parsed = null, rest = null;
            for (;;) {
                var i = head.indexOf('\r\n\r\n');
                if (i < 0) { if (head.length > 4 * 1024 * 1024) fail(new Error('response head too large')); return; }
                parsed = parseHead(head.slice(0, i).toString('binary'));
                rest = head.slice(i + 4);
                if (parsed.status < 100 || parsed.status > 599) { fail(new Error('not an HTTP response')); return; }
                if (parsed.status === 101) { fail(new Error('unexpected protocol switch')); return; }
                if (parsed.status < 200) { head = rest; continue; }       // 100 Continue, 103 Early Hints: not the answer yet
                break;
            }
            headDone = true;
            bodyless = opts.method === 'HEAD' || parsed.status === 204 || parsed.status === 304;
            if (parsed.chunked) dech = new Dechunk(sink);
            else expect = parsed.length;
            settled = true;
            cb(null, { status: parsed.status, headers: parsed.headers, body: payload });
            if (bodyless || expect === 0) { complete(); kill(); return; }
            if (rest.length) feed(rest);
        }));
        cur.on('end', guard(closed));
        cur.on('close', guard(closed));
    }

    attempt();
    return {
        abort: function () {
            aborted = true;
            settled = true;
            if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
            kill();
            broken(new Error('aborted'));
        }
    };   // whoever asked has gone: no callback
}

// GET host/path and collect the body (at most maxBytes). cb(err, buffer, status)
function fetchBuffer(host, path, maxBytes, cb) {
    var done = false, req = null;
    function finish(e, parts, status) {
        if (done) return;
        done = true;
        if (e && req) req.abort();
        if (e) cb(e); else cb(null, Buffer.concat(parts), status);
    }
    req = request({ host: host, method: 'GET', path: path, headers: { host: host, 'user-agent': 'vetro-youtube-plugin' }, identity: true }, null, function (err, r) {
        if (err) return finish(err);
        var parts = [], size = 0;
        r.body.on('data', function (c) { size += c.length; if (size > maxBytes) { finish(new Error('response too large')); return; } parts.push(c); });
        r.body.on('end', function () { finish(null, parts, r.status); });
        r.body.on('error', finish);
    });
}

module.exports = { Dechunk: Dechunk, parseHead: parseHead, buildRequest: buildRequest, request: request, fetchBuffer: fetchBuffer, HOP: HOP };
