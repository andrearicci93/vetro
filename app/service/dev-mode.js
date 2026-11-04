'use strict';
var execError = require('./exec-error.js');
// Developer Mode, as the TV's Apps > 12345 screen stores it (read on QN75LS03B, T-PTMAKUC-1720.7, 2026-11-04):
//   db/sdk/develop/mode  Int32   1 on, 0 off
//   db/sdk/develop/ip    String  the Host PC IP
// The TV's SDB service reads both when it starts, so a new Host PC IP takes effect only after a restart.
//
// Vetro's own root helper is started through that SDB service, which only answers the Host PC IP: with anything
// other than 127.0.0.1 the helper does not connect after the restart, and Vetro cannot change the value back.
// The remote then has to (Apps, 12345). The dashboard says so before it writes.
var MODE_KEY = 'db/sdk/develop/mode', IP_KEY = 'db/sdk/develop/ip', SELF = '127.0.0.1';
// The restart runs in the background a few seconds later, so the answer reaches the browser first.
var REBOOT = '( sleep 3; /usr/sbin/reboot ) </dev/null >/dev/null 2>&1 &';

function wrap(s) { return 'echo ' + Buffer.from(s).toString('base64') + ' | base64 -d | sh'; }
function check(r) { if (r.exit_code || r.timed_out) throw execError.failed(r, r.stderr || r.stdout || 'Developer Mode unavailable'); return r.stdout || ''; }

// Dotted IPv4 only, each part 0-255 without leading zeros. The value goes into a shell command, so nothing else passes.
function validIp(ip) {
    if (typeof ip !== 'string' || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
    return ip.split('.').every(function (p) { return (p === '0' || p[0] !== '0') && Number(p) <= 255; });
}

function parse(out) {
    var mode = /db\/sdk\/develop\/mode, value = (-?\d+) \(Int32\)/.exec(out), ip = /db\/sdk\/develop\/ip, value = (.*) \(String\)/.exec(out);
    if (!mode || !ip) throw execError.coded('unreadable', 'Developer Mode values unreadable');
    var v = ip[1].trim();
    return { enabled: mode[1] === '1', mode: Number(mode[1]), hostIp: v, selfHosted: v === SELF, keys: { mode: MODE_KEY, ip: IP_KEY } };
}

function DevMode(execute) { this.execute = execute; this.busy = false; }

DevMode.prototype.read = function () {
    return this.execute(wrap('vconftool get ' + MODE_KEY + ' 2>&1\nvconftool get ' + IP_KEY + ' 2>&1'), 6000).then(function (r) { return parse(check(r)); });
};

// Writes the Host PC IP, reads it back, and restarts the TV when asked. A failed read-back puts the old value back.
DevMode.prototype.change = function (ip, reboot) {
    var self = this;
    if (!validIp(ip)) return Promise.reject(Error('Host PC IP must be an IPv4 address such as 192.168.1.20'));
    if (typeof reboot !== 'boolean') return Promise.reject(Error('Invalid restart choice'));
    if (this.busy) return Promise.reject(Error('Developer Mode change already in progress'));
    this.busy = true;
    function set(v) { return self.execute(wrap("vconftool set -f -t string " + IP_KEY + " '" + v + "'"), 6000).then(check); }
    var before;
    return this.read().then(function (s) {
        before = s;
        if (!s.enabled) throw Error('Developer Mode is off on the TV; turn it on from Apps, 12345 first');
        if (s.hostIp === ip) return s;
        if (!validIp(s.hostIp) && s.hostIp !== '') throw Error('Current Host PC IP unreadable');
        return set(ip).then(function () { return self.read(); }).then(function (after) {
            if (after.hostIp !== ip) throw Error('Host PC IP not confirmed');
            return after;
        }).catch(function (e) {
            return set(before.hostIp).then(function () { return self.read(); }).then(function (restored) {
                throw Error(e.message + ' · ' + (restored.hostIp === before.hostIp ? 'previous value restored' : 'restore not confirmed'));
            }, function () { throw Error(e.message + ' · restore not confirmed'); });
        });
    }).then(function (after) {
        var result = Object.assign({}, after, { previous: before.hostIp, changed: before.hostIp !== ip, rebooting: false });
        if (!reboot) return result;
        return self.execute(wrap(REBOOT), 6000).then(check).then(function () { result.rebooting = true; return result; });
    }).finally(function () { self.busy = false; });
};

module.exports = { DevMode: DevMode, validIp: validIp, SELF: SELF, MODE_KEY: MODE_KEY, IP_KEY: IP_KEY };
