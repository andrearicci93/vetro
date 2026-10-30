'use strict';
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
    var m = /^MemAvailable:\s+(\d+)\s*kB/m.exec(meminfo || '');
    return m ? Math.round(Number(m[1]) / 1024) : null;
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
        root: {mode: (deps.platform || {}).mode || null, connected: agent.connected === true},
        input: {enabled: preference.enabled === true, connected: policy.connected === true},
        launcher: {installed: launcher.installed === true, enabled: launcher.enabled === true,
            running: typeof launcher.running === 'boolean' ? launcher.running : null,
            failures: launcher.failures || 0, hasError: launcher.error === true},
        memory: {availableMb: availableMb(deps.meminfo)}
    };
}

module.exports = {address: address, availableMb: availableMb, build: build};
