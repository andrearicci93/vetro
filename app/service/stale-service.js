'use strict';
// Upgrading from an older Vetro (0.3.x) can leave the OLD service running: the package is replaced, the old process is
// not ended, and it keeps answering on the port with the old version. The new service then cannot listen, and the TV page,
// which shows the service's version, still says the old one. This finds out who holds the port and, only when it is an
// OLDER Vetro (it says so itself on /status), ends it. A holder that is anything else (tizen-youtube and TizenTube also
// use 8099) is never touched.
var fs = require('fs');
var http = require('http');

var SEMVER = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;

function older(a, b) {
    var x = SEMVER.exec(a), y = SEMVER.exec(b);
    if (!x || !y) return false;
    for (var i = 1; i <= 3; i++) { if (Number(x[i]) !== Number(y[i])) return Number(x[i]) < Number(y[i]); }
    return false;
}

// What the listener on the port says about itself: its Vetro version, or null when it is not a Vetro (or does not answer).
function probeVersion(port, host, timeoutMs) {
    return new Promise(function (resolve) {
        var done = false;
        function finish(v) { if (!done) { done = true; resolve(v); } }
        var req = http.get({host: host || '127.0.0.1', port: port, path: '/status', timeout: timeoutMs || 2000}, function (res) {
            var body = '';
            res.setEncoding('utf8');
            res.on('data', function (d) { if (body.length < 65536) body += d; });
            res.on('end', function () {
                try {
                    var j = JSON.parse(body);
                    // A Vetro answers {mode, app: {version, sourceRevision, ...}}; anything else is somebody else's service.
                    var ok = j && typeof j === 'object' && typeof j.mode === 'string' && j.app && typeof j.app === 'object' &&
                        typeof j.app.version === 'string' && SEMVER.test(j.app.version) && 'sourceRevision' in j.app;
                    finish(ok ? j.app.version : null);
                } catch (e) { finish(null); }
            });
            res.on('error', function () { finish(null); });
        });
        req.on('timeout', function () { req.destroy(); finish(null); });
        req.on('error', function () { finish(null); });
    });
}

// The pids that listen on a TCP port, from /proc (no external command, nothing to install on the TV).
function listeningPids(port, procDir) {
    procDir = procDir || '/proc';
    var inodes = {};
    ['net/tcp', 'net/tcp6'].forEach(function (f) {
        var text;
        try { text = fs.readFileSync(procDir + '/' + f, 'utf8'); } catch (e) { return; }
        text.split('\n').slice(1).forEach(function (line) {
            var c = line.trim().split(/\s+/);
            // c[1] local address "HEX:PORT", c[3] state (0A = LISTEN), c[9] socket inode
            if (c.length < 10 || c[3] !== '0A') return;
            var p = parseInt(c[1].split(':')[1], 16);
            if (p === port && c[9] && c[9] !== '0') inodes['socket:[' + c[9] + ']'] = true;
        });
    });
    if (!Object.keys(inodes).length) return [];
    var pids = [];
    var names;
    try { names = fs.readdirSync(procDir); } catch (e) { return []; }
    names.forEach(function (n) {
        if (!/^\d+$/.test(n)) return;
        var fds;
        try { fds = fs.readdirSync(procDir + '/' + n + '/fd'); } catch (e) { return; }
        for (var i = 0; i < fds.length; i++) {
            var link;
            try { link = fs.readlinkSync(procDir + '/' + n + '/fd/' + fds[i]); } catch (e) { continue; }
            if (inodes[link]) { pids.push(Number(n)); return; }
        }
    });
    return pids;
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// Ends the older Vetro that holds `port`. Resolves {ended: true, version, pid} or {ended: false, reason, ...}.
function endOlderService(port, ownVersion, options) {
    options = options || {};
    var host = options.host || '127.0.0.1';
    var kill = options.kill || function (pid, sig) { process.kill(pid, sig); };
    var find = options.listeningPids || function (p) { return listeningPids(p); };
    var probe = options.probe || function () { return probeVersion(port, host, 2000); };
    return probe().then(function (version) {
        if (!version) return {ended: false, reason: 'not-vetro'};
        if (!older(version, ownVersion)) return {ended: false, reason: 'not-older', version: version};
        var pids = find(port).filter(function (p) { return p !== process.pid; });
        if (!pids.length) return {ended: false, reason: 'pid-unknown', version: version};
        if (pids.length > 1) return {ended: false, reason: 'several-holders', version: version};
        var pid = pids[0];
        try { kill(pid, 'SIGTERM'); } catch (e) { return {ended: false, reason: 'kill-refused', version: version, pid: pid, error: e.code || e.message}; }
        // Give it a moment to leave; the port is free once it stops answering.
        var waitMs = options.waitMs == null ? 3000 : options.waitMs;
        function gone() { return find(port).indexOf(pid) < 0; }
        function poll(left) {
            if (gone()) return Promise.resolve(true);
            if (left <= 0) return Promise.resolve(false);
            return sleep(100).then(function () { return poll(left - 100); });
        }
        return poll(waitMs).then(function (ok) {
            if (ok) return {ended: true, version: version, pid: pid};
            try { kill(pid, 'SIGKILL'); } catch (e) { return {ended: false, reason: 'kill-refused', version: version, pid: pid, error: e.code || e.message}; }
            return poll(1000).then(function (ok2) { return ok2 ? {ended: true, version: version, pid: pid, forced: true} : {ended: false, reason: 'still-running', version: version, pid: pid}; });
        });
    });
}

module.exports = {endOlderService: endOlderService, probeVersion: probeVersion, listeningPids: listeningPids, older: older};
