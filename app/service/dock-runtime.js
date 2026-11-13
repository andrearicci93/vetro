'use strict';
var presence = require('./presence.js');
var actions = require('./component-actions.js');
function checked(result) {
    if (!result || result.exit_code || result.timed_out) throw Error('Running apps unavailable');
    return result.stdout || '';
}
function components(rows, running) {
    return running.map(function (process) {
        var row = rows.find(function (a) { return a.appId === process.appId; });
        if (!row) return null;
        var reason = null;
        try { actions.validate({action: 'stop', appId: row.appId}, rows); }
        catch (e) { reason = e.message; }
        return {appId: row.appId, pid: process.pid, name: row.name || row.appId,
            service: row.component === 'svc' || row.component === 'service' || process.status === 8,
            matches: rows.filter(function (a) { return a.appId === row.appId || !!row.packageId && a.packageId === row.packageId; }).map(function (a) { return a.appId; }),
            canStop: !reason, reason: reason, autorestart: row.autorestart === true};
    }).filter(Boolean);
}
function Runtime(options) {
    this.execute = options.execute;
    this.inventory = options.inventory;
    this.sleep = options.sleep || function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
    this.pending = null;
}
Runtime.prototype.running = function () {
    return this.execute(presence.COMMAND, 8000).then(checked).then(presence.applications);
};
Runtime.prototype.snapshot = function () {
    if (this.pending) return this.pending;
    var self = this;
    this.pending = Promise.all([this.inventory(false), this.running()]).then(function (result) {
        if (result[0].registryError) throw Error('App inventory unavailable');
        return {components: components(result[0].apps, result[1]), collectedAt: Date.now()};
    }).finally(function () { self.pending = null; });
    return this.pending;
};
Runtime.prototype.stop = function (request) {
    var self = this, row;
    if (!request || !Number.isSafeInteger(request.pid) || request.pid <= 0) return Promise.reject(Error('Invalid running app identity'));
    return this.inventory(true).then(function (inventory) {
        if (inventory.registryError) throw Error('App inventory unavailable; no command sent');
        row = actions.validate({action: 'stop', appId: request.appId}, inventory.apps);
        return self.running();
    }).then(function (running) {
        var current = running.filter(function (p) { return p.appId === row.appId; });
        if (!current.length) return {ok: true, verified: true, message: 'Already stopped'};
        if (!current.some(function (p) { return p.pid === request.pid; })) throw Error('The app restarted. Open its options again.');
        return self.execute(actions.command({action: 'stop'}, row), 10000).then(function (result) {
            // Verify a concurrent exit or automatic restart; never retry a stop.
            return self.sleep(350).then(function () { return self.running(); }).then(function (after) {
                var still = after.filter(function (p) { return p.appId === row.appId; });
                if (!still.length) return {ok: true, verified: true, message: 'Stopped'};
                if (still.every(function (p) { return p.pid !== request.pid; })) return {ok: false, verified: false, message: 'The component restarted automatically'};
                return {ok: false, verified: false, message: result && !result.exit_code && !result.timed_out ? 'The component is still running' : 'Could not stop this component'};
            });
        });
    });
};
module.exports = {Runtime: Runtime, components: components};
