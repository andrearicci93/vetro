'use strict';

// Client for the TV's own LAN remote API (the one used by SmartThings-like
// controllers): WebSocket on :8001 (ws) or :8002 (wss, self-signed) at
// /api/v2/channels/samsung.remote.control. The first connection shows a pairing
// prompt on the TV; the returned token can be stored and reused. Node 12 has no
// WebSocket client, so this is a minimal dependency-free RFC 6455 one.

var net = require('net');
var tls = require('tls');
var crypto = require('crypto');
// Regular expressions compiled once at module load, not on every call.
var UPGRADE_OK_RE = /^HTTP\/1\.1 101/;

var APP_NAME = 'Vetro';

function buildPath(name, token) {
    return '/api/v2/channels/samsung.remote.control?name=' +
        Buffer.from(name || APP_NAME).toString('base64') + (token ? '&token=' + encodeURIComponent(token) : '');
}

function keyFrame(key) {
    return JSON.stringify({method: 'ms.remote.control', params: {
        Cmd: 'Click', DataOfCmd: key, Option: 'false', TypeOfRemote: 'SendRemoteKey'}});
}

function launchFrame(appId) {
    return JSON.stringify({method: 'ms.channel.emit', params: {
        event: 'ed.apps.launch', to: 'host', data: {action_type: 'NATIVE_LAUNCH', appId: appId}}});
}

// Client-to-server frame: FIN + opcode, masked payload.
function encodeFrame(text, opcode) {
    var payload = Buffer.from(text, 'utf8');
    var n = payload.length;
    var head = n < 126 ? Buffer.alloc(2) : Buffer.alloc(4);
    head[0] = 0x80 | (opcode || 1);
    if (n < 126) head[1] = 0x80 | n;
    else { head[1] = 0x80 | 126; head.writeUInt16BE(n, 2); }
    var mask = crypto.randomBytes(4), body = Buffer.alloc(n);
    for (var i = 0; i < n; i++) body[i] = payload[i] ^ mask[i % 4];
    return Buffer.concat([head, mask, body]);
}

// Extracts complete server frames from buf. Returns {frames, rest}.
function decodeFrames(buf) {
    var frames = [];
    for (;;) {
        if (buf.length < 2) break;
        var len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) break; len = buf.readUInt32BE(6); off = 10; }
        if (buf.length < off + len) break;
        frames.push({opcode: buf[0] & 0x0f, data: buf.slice(off, off + len)});
        buf = buf.slice(off + len);
    }
    return {frames: frames, rest: buf};
}

// Opens the channel, waits for ms.channel.connect, sends the frames, closes.
// opts: {host, port (8001|8002), token, timeoutMs}. Resolves {token, sent}.
function send(opts, frames) {
    return new Promise(function (resolve, reject) {
        var secure = opts.port === 8002;
        var socket = (secure ? tls : net).connect(
            secure ? {host: opts.host, port: 8002, rejectUnauthorized: false} : {host: opts.host, port: opts.port || 8001});
        var key = crypto.randomBytes(16).toString('base64');
        var buf = Buffer.alloc(0), upgraded = false, done = false, token = opts.token || null;
        var timer = setTimeout(function () { finish(new Error('remote API timeout')); }, opts.timeoutMs || 10000);
        function finish(err, value) {
            if (done) return;
            done = true; clearTimeout(timer);
            try { if (!err && upgraded) socket.write(encodeFrame('', 8)); socket.destroy(); } catch (e) { /* closed */ }
            if (err) reject(err); else resolve(value);
        }
        socket.on('error', function (e) { finish(e); });
        socket.on('close', function () { finish(new Error('connection closed')); });
        socket.on(secure ? 'secureConnect' : 'connect', function () {
            socket.write('GET ' + buildPath(APP_NAME, token) + ' HTTP/1.1\r\nHost: ' + opts.host + ':' + (opts.port || 8001) +
                '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ' + key + '\r\n\r\n');
        });
        socket.on('data', function (chunk) {
            buf = Buffer.concat([buf, chunk]);
            if (!upgraded) {
                var end = buf.indexOf('\r\n\r\n');
                if (end === -1) return;
                if (!UPGRADE_OK_RE.test(buf.toString('latin1', 0, end))) return finish(new Error('websocket upgrade refused'));
                upgraded = true; buf = buf.slice(end + 4);
            }
            var d = decodeFrames(buf); buf = d.rest;
            d.frames.forEach(function (f) {
                if (f.opcode !== 1) return;
                var msg; try { msg = JSON.parse(f.data.toString('utf8')); } catch (e) { return; }
                if (msg.event === 'ms.channel.connect') {
                    if (msg.data && msg.data.token) token = String(msg.data.token);
                    frames.forEach(function (fr) { socket.write(encodeFrame(fr)); });
                    setTimeout(function () { finish(null, {token: token, sent: frames.length}); }, 300);
                } else if (msg.event === 'ms.channel.unauthorized') {
                    finish(new Error('TV denied the pairing request'));
                }
            });
        });
    });
}

module.exports = {buildPath: buildPath, keyFrame: keyFrame, launchFrame: launchFrame,
    encodeFrame: encodeFrame, decodeFrames: decodeFrames, send: send};
