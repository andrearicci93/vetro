'use strict';
// Standalone adapter: feature development requires no device integration.
var running = false;
function unavailable(operation) {
    var error = new Error(operation + ': TV platform adapter unavailable');
    error.submitted = false;
    return Promise.reject(error);
}
module.exports = {
    start: function () { running = true; },
    stop: function () { running = false; },
    status: function () { return {mode: 'app-only', running: running,
        self: {pid: process.pid, node: process.version}, prepared: false, attempts: [], agent: {connected: false}}; },
    sdbAccess: function () { return {available:false, enabled:false, active:false, port:null}; },
    setSdbAccess: function () { return unavailable('SDB access'); },
    execute: function () { return unavailable('execute'); },
    install: function () { return unavailable('install'); },
    setApplicationsEnabled: function () { return unavailable('application state'); }
};
