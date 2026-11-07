'use strict';
// The proxy YouTube is started with (--proxy). Everything is a plain tunnel except www.youtube.com, which is opened with
// the plugin's own certificate (trusted only by the YouTube app this plugin starts) so the /tv page can get its script.
// Without a certificate or without the script it only tunnels: YouTube then runs unpatched instead of breaking.
// Listens on 127.0.0.2 (Chromium sends 127.0.0.1 around a proxy).
//
// This code runs inside Vetro's process, so nothing may throw out of an event handler: every callback goes through guard(),
// every socket has an error listener, every connection has a timeout, and the number of connections is capped.

var net = require('net');
var tls = require('tls');
var http = require('http');
var client = require('./tls-client.js');
var inject = require('./inject.js');

var MAX_BODY = 8 * 1024 * 1024;
var MAX_CONNECTIONS = 300;
var IDLE_MS = 5 * 60 * 1000;           // a connection that carries nothing for this long is closed
var CONNECT_MS = 20 * 1000;            // time allowed to reach a host

// opts: host, port, log(msg), leaf() -> {key, cert} | null, script() -> {body, version} | null, onPage({injected, bytes}), maxConnections
function createProxy(opts) {
    var server = null, ready = false, tlsServer = null, httpServer = null, leafCert = null, tunnels = 0, opened = 0, live = 0, refused = 0;
    var socks = {}, nextId = 1, waiters = [];                // every open socket, so that close(true) can end them
    var cap = opts.maxConnections || MAX_CONNECTIONS;

    function guard(fn, onError) {
        return function () {
            try { return fn.apply(this, arguments); }
            catch (e) { try { opts.log('internal error: ' + (e && e.message)); if (onError) onError(e); } catch (x) { /* nothing more to do */ } }
        };
    }
    function drop(sock) { try { sock.destroy(); } catch (e) { /* closed */ } }
    function track(sock) {
        live++;
        var gone = false, id = nextId++;
        socks[id] = sock;
        sock.on('close', function () { if (!gone) { gone = true; live--; delete socks[id]; } });
        sock.on('error', function () { /* the close that follows is handled */ });
        sock.setTimeout(IDLE_MS, function () { drop(sock); });
    }

    function handle(req, res) {
        var abortUpstream = null;
        res.on('error', function () { /* the app went away */ });
        req.on('error', function () { if (abortUpstream) abortUpstream(); });
        res.on('close', function () { if (abortUpstream) abortUpstream(); });
        var fail = function () { try { if (!res.headersSent) res.writeHead(502, { 'content-length': 0 }); res.end(); } catch (e) { drop(res.socket || req.socket); } };

        var host = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
        if (!inject.MITM_HOSTS[host]) { res.writeHead(421, { 'content-length': 0 }); res.end(); return; }
        if (req.url.split('?')[0] === inject.SCRIPT_PATH) {
            var s = opts.script();
            if (req.method !== 'GET' || !s) { res.writeHead(404, { 'content-length': 0 }); res.end(); return; }
            res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'content-length': s.body.length, 'cache-control': 'no-store' });
            res.end(s.body);
            return;
        }
        var tv = req.method === 'GET' && inject.isTvPage(req.url) && !!opts.script();
        var chunks = [], size = 0, over = false;
        req.on('data', function (c) { size += c.length; if (size > MAX_BODY) { over = true; return; } chunks.push(c); });
        req.on('end', guard(function () {
            if (over) { res.writeHead(413, { 'content-length': 0 }); res.end(); return; }
            var h = client.request({ host: host, method: req.method, path: req.url, headers: req.headers, identity: tv }, Buffer.concat(chunks), guard(function (err, r) {
                if (err) { opts.log('upstream ' + host + ' failed: ' + err.message); fail(); return; }
                var type = String(r.headers['content-type'] || '');
                if (!tv || r.status !== 200 || type.indexOf('text/html') < 0) {
                    res.writeHead(r.status, inject.passHeaders(r.headers));
                    r.body.on('error', function () { drop(res.socket); });
                    r.body.pipe(res);
                    return;
                }
                var parts = [], total = 0;
                r.body.on('data', function (c) { total += c.length; if (total <= MAX_BODY) parts.push(c); });
                r.body.on('error', function () { fail(); });
                r.body.on('end', guard(function () {
                    if (total > MAX_BODY) { fail(); return; }
                    var s2 = opts.script();
                    var page = inject.rewritePage(Buffer.concat(parts).toString('utf8'), inject.scriptTag(s2 ? s2.version : '0'));
                    var out = Buffer.from ? Buffer.from(page.html, 'utf8') : new Buffer(page.html, 'utf8');
                    res.writeHead(200, inject.pageHeaders(r.headers, out.length));
                    res.end(out);
                    opts.log('TV page rewritten (' + out.length + ' bytes' + (page.injected ? '' : ', no </body>: tag appended') + ')');
                    if (opts.onPage) opts.onPage({ injected: true, bytes: out.length });
                }, fail));
            }, fail));
            abortUpstream = function () { h.abort(); };
        }, fail));
    }

    // One shared TLS and HTTP server for every opened connection; rebuilt when the certificate changes.
    function ensureTls() {
        var leaf = opts.leaf();
        if (!leaf) return null;
        if (tlsServer && leafCert === leaf.cert) return tlsServer;
        httpServer = http.createServer(guard(handle, null));
        httpServer.on('clientError', function (e, sock) { opts.log('client error: ' + (e && e.code || e)); drop(sock); });
        tlsServer = tls.createServer({ key: leaf.key, cert: leaf.cert });
        tlsServer.on('secureConnection', guard(function (s) { track(s); httpServer.emit('connection', s); }));
        tlsServer.on('tlsClientError', function (e) { opts.log('TLS refused by the app: ' + (e && e.message)); });
        tlsServer.on('error', function () { /* per connection errors are on the sockets */ });
        leafCert = leaf.cert;
        return tlsServer;
    }

    var HEAD_MAX = 8192;

    function onConnection(c) {
        if (live >= cap) { refused++; drop(c); return; }
        track(c);
        var buf = Buffer.alloc ? Buffer.alloc(0) : new Buffer(0), started = false;
        c.on('data', guard(function onData(d) {
            if (started) return;
            buf = Buffer.concat([buf, d]);
            var end = buf.indexOf('\r\n\r\n');
            if (end < 0) {
                if (buf.length > HEAD_MAX) { started = true; c.end('HTTP/1.1 400 Bad Request\r\nconnection: close\r\ncontent-length: 0\r\n\r\n'); }
                return;                                    // the rest of the request has not arrived yet
            }
            started = true;
            c.removeListener('data', onData);
            c.pause();
            var rest = buf.slice(end + 4);
            connect(c, buf.slice(0, end).toString('binary').split('\r\n')[0], rest);
        }));
    }

    function connect(c, line, rest) {
        var m = /^CONNECT ([^ :\[\]]+):(\d{1,5}) HTTP\/1\.[01]$/.exec(line);
        if (!m) { c.end('HTTP/1.1 502 Bad Gateway\r\nconnection: close\r\ncontent-length: 0\r\n\r\n'); return; }
        var host = m[1].toLowerCase(), port = parseInt(m[2], 10);
        if (port < 1 || port > 65535) { c.end('HTTP/1.1 400 Bad Request\r\nconnection: close\r\ncontent-length: 0\r\n\r\n'); return; }
        if (port === 443 && inject.MITM_HOSTS[host] && opts.script() && !rest.length) {
            var t = ensureTls();
            if (t) {
                opened++;
                c.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                t.emit('connection', c);
                c.resume();
                return;
            }
        }
        tunnels++;
        var up = net.connect(port, host);
        track(up);
        up.setTimeout(CONNECT_MS, guard(function () { if (!up.connecting) return; drop(up); drop(c); }));
        up.on('connect', guard(function () {
            up.setTimeout(IDLE_MS, function () { drop(up); });
            c.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (rest.length) up.write(rest);
            c.pipe(up); up.pipe(c);
            c.resume();
        }));
        up.on('error', function () { drop(c); });
        c.on('close', function () { drop(up); });
        up.on('close', function () { drop(c); });
    }

    return {
        listen: function (cb) {
            if (server) { if (ready) cb(null); else waiters.push(cb); return; }
            var s = net.createServer(guard(onConnection)), done = false;
            server = s; ready = false;
            s.on('error', function (e) { if (!done) { done = true; cb(e); waiters.splice(0).forEach(function (w) { w(e); }); } else opts.log('proxy error: ' + e.message); if (server === s) { server = null; ready = false; } });
            s.on('close', function () { if (server === s) { server = null; ready = false; } });
            s.listen(opts.port, opts.host, function () { if (!done && server === s) { done = true; ready = true; cb(null); waiters.splice(0).forEach(function (w) { w(null); }); } else if (!done) { done = true; try { s.close(); } catch (e) { /* closed */ } var err = new Error('closed while starting'); cb(err); waiters.splice(0).forEach(function (w) { w(err); }); } });
        },
        // Stops listening. Connections that are already open are left to finish on their own (a YouTube that is running keeps
        // working), unless `hard` is set: then they are cut as well.
        close: function (hard) {
            var s = server;
            server = null; ready = false;
            if (s) { try { s.close(); } catch (e) { /* closed */ } }
            tlsServer = null; httpServer = null; leafCert = null;
            if (hard) Object.keys(socks).forEach(function (id) { drop(socks[id]); });
        },
        listening: function () { return !!server && ready; },
        stats: function () { return { tunnels: tunnels, opened: opened, live: live, refused: refused }; }
    };
}

module.exports = { createProxy: createProxy, MAX_CONNECTIONS: MAX_CONNECTIONS };
