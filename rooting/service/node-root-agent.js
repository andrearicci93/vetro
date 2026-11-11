'use strict';
// External-root agent using the TV's signed Node runtime. No listening socket
// and no child_process: an independently launched shell owns process creation.
require(require('fs').existsSync(__dirname + '/compat.js') ? './compat.js' : '../../app/service/compat.js').install();
var fs = require('fs');
var net = require('net');
var crypto = require('crypto');
var MAX_FRAME = 128 * 1024;
var MAX_OUTPUT = 1024 * 1024;

function identity() {
    var text = fs.readFileSync('/proc/self/status', 'utf8');
    var caps = /^CapEff:\s*([a-fA-F0-9]+)$/m.exec(text);
    return {pid: process.pid, uid: process.getuid(), euid: process.geteuid(),
        gid: process.getgid(), egid: process.getegid(), cap_eff: caps ? caps[1] : '',
        smack: fs.readFileSync('/proc/self/attr/current', 'utf8').trim()};
}

function requireRoot(id) {
    if (id.uid !== 0 || id.euid !== 0 || id.gid !== 0 || id.egid !== 0) {
        throw new Error('A privileged bootstrap must launch this agent as UID/GID 0');
    }
}

function mac(secret, nonce, payload) {
    return crypto.createHmac('sha256', secret).update(nonce).update('\x00').update(payload, 'utf8').digest('hex');
}

// Exposed for protocol fixtures. The executable always uses real process IDs.
function session(socket, secret, id, executor) {
    requireRoot(id);
    if (typeof executor !== 'function') throw new Error('Expected a private shell executor');
    var nonce = null, buffered = '', sequence = 0, queue = [], active = null, stopped = false;
    var helloTimer = setTimeout(function () { socket.destroy(); }, 10000);
    socket.setEncoding('utf8');
    function send(payload) { if (!stopped) socket.write(payload + '\t' + mac(secret, nonce, payload) + '\n'); }
    function finish() {
        if (stopped) return;
        stopped = true;
        clearTimeout(helloTimer);
        queue = [];
        if (active) {
            if (active.cancel) active.cancel();
        }
        if (executor && executor.close) executor.close();
        secret.fill(0);
    }
    function next() {
        if (stopped || active || !queue.length) return;
        var task = queue.shift();
        if (executor) {
            active = {cancel: null};
            try {
                var cancel = executor(task, function (result) {
                    active = null;
                    send('RESULT\t' + task.seq + '\t' + result.exit_code + '\t' + (result.timed_out ? '1' : '0') + '\t' +
                        Buffer.from(result.stdout).toString('base64') + '\t' + Buffer.from(result.stderr).toString('base64'));
                    next();
                });
                if (active) active.cancel = cancel;
            } catch (e) { finish(); socket.destroy(); }
            return;
        }
    }
    function lineReceived(line) {
        if (!nonce) {
            var hello = /^SAMSUNG-TV-ROOT\/1\t([0-9a-f]{64})$/.exec(line);
            if (!hello) throw new Error('Invalid server greeting');
            nonce = Buffer.from(hello[1], 'hex');
            clearTimeout(helloTimer);
            send(['AUTH', id.pid, id.uid, id.euid, id.gid, id.egid, id.cap_eff,
                Buffer.from(id.smack).toString('base64')].join('\t'));
            return;
        }
        var split = line.lastIndexOf('\t'), payload = line.slice(0, split), observed = line.slice(split + 1);
        if (split < 0 || !/^[0-9a-f]{64}$/.test(observed) ||
            !crypto.timingSafeEqual(Buffer.from(observed, 'hex'), Buffer.from(mac(secret, nonce, payload), 'hex'))) {
            throw new Error('Invalid command authentication');
        }
        var fields = payload.split('\t'), seq = Number(fields[1]);
        if (!/^[1-9][0-9]*$/.test(fields[1] || '') || !Number.isInteger(seq) || seq > 9007199254740991 || seq <= sequence) {
            throw new Error('Invalid or replayed command sequence');
        }
        sequence = seq;
        if (fields[0] === 'PING' && fields.length === 2) { send('PONG\t' + seq + '\t0\t0\t0\t0'); return; }
        if (fields[0] === 'SHUTDOWN' && fields.length === 2) { send('BYE\t' + seq); socket.end(); finish(); return; }
        if (fields[0] !== 'EXEC' || fields.length !== 4 || !/^[1-9][0-9]*$/.test(fields[2])) throw new Error('Invalid command frame');
        var timeout = Number(fields[2]), bytes = Buffer.from(fields[3], 'base64');
        if (timeout > 120000 || !bytes.length || bytes.length > 65536 || bytes.toString('base64') !== fields[3] ||
            bytes.indexOf(0) !== -1 || !bytes.toString('utf8').trim() || queue.length >= 32) throw new Error('Invalid command bounds');
        queue.push({seq: seq, timeout: timeout, command: bytes.toString('utf8')});
        next();
    }
    socket.on('data', function (chunk) {
        if (stopped) return;
        buffered += chunk;
        try {
            var end;
            while ((end = buffered.indexOf('\n')) >= 0) {
                if (end > MAX_FRAME) throw new Error('Frame too large');
                var line = buffered.slice(0, end); buffered = buffered.slice(end + 1);
                lineReceived(line);
                if (stopped) return;
            }
            if (buffered.length > MAX_FRAME) throw new Error('Frame too large');
        } catch (e) { finish(); socket.destroy(); }
    });
    socket.on('error', finish);
    socket.on('close', finish);
    return {close: function () { finish(); socket.destroy(); }};
}

function main(args) {
    var configPath = args[0];
    if (args.length !== 3 || !configPath || configPath.charAt(0) !== '/') throw new Error('Expected config, private runtime and worker PID');
    var stat = fs.lstatSync(configPath);
    if (!stat.isFile() || (stat.mode & 63) !== 0 || stat.size > 8192) throw new Error('Config must be a private regular file');
    var config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    requireRoot(identity());
    if (config.host !== '127.0.0.1' || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535 ||
        typeof config.secret !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(config.secret) ||
        !Number.isInteger(config.lifetimeMs) || config.lifetimeMs < 1000 || config.lifetimeMs > 7200000) throw new Error('Invalid session config');
    var executor = require('./shell-executor.js').create(args[1], Number(args[2]));
    var secret = Buffer.from(config.secret, 'base64');
    fs.unlinkSync(configPath);
    var socket = net.connect({host: config.host, port: config.port});
    var timer = setTimeout(function () { socket.destroy(); }, config.lifetimeMs);
    var peer = session(socket, secret, identity(), executor);
    socket.once('close', function () { clearTimeout(timer); });
    process.once('SIGTERM', function () { peer.close(); clearTimeout(timer); });
    process.once('SIGINT', function () { peer.close(); clearTimeout(timer); });
}

module.exports = {session: session, identity: identity, main: main};
if (require.main === module) {
    try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
