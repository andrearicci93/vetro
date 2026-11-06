'use strict';
// Regular expressions compiled once at module load, not on every call.
var AVAILABLE_MB_RE = /^MemAvailable:\s+(\d+)\s*kB/m;
// GET /screen: the few facts the TV screen (index.html) shows. Everything is read in memory or from /proc;
// the only root command is the launcher's pid check, and only while the launcher is on.

function address(interfaces) {
    var names = Object.keys(interfaces || {}), i, j, list;
    for (i = 0; i < names.length; i++) {
        list = interfaces[names[i]] || [];
        for (j = 0; j < list.length; j++) if (list[j].family === 'IPv4' && !list[j].internal) return list[j].address;
    }
    return null;
}

function availableMb(meminfo) {
    var m = AVAILABLE_MB_RE.exec(meminfo || '');
    return m ? Math.round(Number(m[1]) / 1024) : null;
}

// Why root is not connected, from what the root adapter recorded (rooting/service/platform.js), so the TV screen can say
// what to do instead of always "reinstall" (#99, #91, #75):
//   unsupported  the runtime cannot run the root agent (Node 4.4 on Tizen 4 and 5.5): app only, reinstalling will not help
//   prepare      the agent files could not be prepared
//   sdb          the TV refused or closed its local developer connection (the code says how, e.g. sdbClosed)
//   agent        the helper was started but never called back
//   starting     no verdict yet: no attempt, or a single one (in flight, or refused once)
// code is the last connection code; only a short word in a fixed shape leaves the service.
function rootReason(p) {
    p = p || {};
    if (p.mode !== 'tv-integration' || (p.agent || {}).connected === true) return null;
    if (p.unsupported === true) return {reason: 'unsupported', code: null};
    if (p.prepareError) return {reason: 'prepare', code: null};
    var launches = (Array.isArray(p.attempts) ? p.attempts : []).filter(function (a) { return a && a.phase === 'launch'; });
    var last = launches[launches.length - 1], m = last && /^fail:([A-Za-z]{1,24})$/.exec(last.connect || '');
    // Right after a start the port may not be open yet: one refusal is not a verdict, two in a row are.
    if (m && launches.length > 1) return {reason: 'sdb', code: m[1]};
    if (last && last.connect === 'ok' && launches.length > 1) return {reason: 'agent', code: null};
    return {reason: 'starting', code: null};
}

// deps: version, port, platform (platform.status()), input (the input snapshot), launcher
// ({installed, enabled, failures, error, running}), meminfo (text), interfaces (os.networkInterfaces()).
function build(deps) {
    var agent = (deps.platform || {}).agent || {}, policy = (deps.input || {}).policy || {}, preference = (deps.input || {}).preference || {};
    var launcher = deps.launcher || {};
    return {
        version: deps.version,
        port: deps.port,
        address: address(deps.interfaces),
        root: Object.assign({mode: (deps.platform || {}).mode || null, connected: agent.connected === true}, rootReason(deps.platform)),
        input: {enabled: preference.enabled === true, connected: policy.connected === true},
        launcher: {installed: launcher.installed === true, enabled: launcher.enabled === true,
            running: typeof launcher.running === 'boolean' ? launcher.running : null,
            failures: launcher.failures || 0, hasError: launcher.error === true},
        memory: {availableMb: availableMb(deps.meminfo)}
    };
}

module.exports = {address: address, availableMb: availableMb, build: build, rootReason: rootReason};
