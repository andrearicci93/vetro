'use strict';
// Plugin host (API 1). Internal modules, today only the ones shipped with Vetro,
// register through one small interface instead of being wired into main.js:
//
//   { id, name, version, apiVersion: 1, permissions: ['exec', ...],
//     create(ctx) -> { start(), stop(), status(), route(req, res, sub) } }
//
// The host owns the lifecycle and keeps a failing plugin from taking Vetro down:
// every call into a plugin is guarded, a plugin that keeps failing is switched
// off, and a start that never completes makes the next boot come up in safe mode.
// Plain ES5 on purpose: the TV runs Node 4.4 (no worker_threads, no vm sandbox
// worth the name), so this is fault isolation, not a security boundary.

var fs = require('fs');
var path = require('path');

var API_VERSION = 1;
var PERMISSIONS = ['exec'];
var ID_RE = /^[a-z][a-z0-9-]{1,31}$/;

function PluginHost(opts) {
    opts = opts || {};
    this.dir = opts.dir;                       // writable root, one sub folder per plugin
    this.execute = opts.execute || null;       // agent command runner, only lent to plugins asking for 'exec'
    this.maxErrors = opts.maxErrors || 3;      // consecutive failures before a plugin is switched off
    this.stableMs = opts.stableMs == null ? 60000 : opts.stableMs;
    this.entries = Object.create(null);
    this.order = [];
    this.safeMode = false;
    this.started = false;
    this.stableTimer = null;
}

PluginHost.API_VERSION = API_VERSION;

PluginHost.prototype._file = function (name) { return path.join(this.dir, name); };

PluginHost.prototype._readState = function () {
    try {
        var s = JSON.parse(fs.readFileSync(this._file('plugins.json'), 'utf8'));
        return { enabled: s && typeof s.enabled === 'object' && s.enabled || {}, suspended: !!(s && s.suspended) };
    } catch (e) { return { enabled: {}, suspended: false }; }
};

PluginHost.prototype._writeState = function (state) {
    try {
        fs.mkdirSync(this.dir);
    } catch (e) { /* already there */ }
    var temp = this._file('plugins.json.tmp');
    fs.writeFileSync(temp, JSON.stringify(state) + '\n');
    fs.renameSync(temp, this._file('plugins.json'));
};

PluginHost.prototype.register = function (def) {
    if (!def || !ID_RE.test(def.id || '')) throw new Error('Invalid plugin id');
    if (this.entries[def.id]) throw new Error('Duplicate plugin: ' + def.id);
    if (def.apiVersion !== API_VERSION) throw new Error(def.id + ': unsupported plugin API ' + def.apiVersion);
    if (typeof def.create !== 'function') throw new Error(def.id + ': create() missing');
    var perms = def.permissions || [];
    for (var i = 0; i < perms.length; i++) {
        if (PERMISSIONS.indexOf(perms[i]) < 0) throw new Error(def.id + ': unknown permission ' + perms[i]);
    }
    this.entries[def.id] = {
        def: def, instance: null, state: 'stopped', errors: 0, lastError: null,
        defaultEnabled: def.defaultEnabled !== false
    };
    this.order.push(def.id);
    return this;
};

// One config file per plugin, in its own folder. Plugins never see another plugin's path.
PluginHost.prototype._context = function (entry) {
    var host = this, id = entry.def.id, dir = path.join(this.dir, id);
    var allowed = (entry.def.permissions || []).indexOf('exec') >= 0 && host.execute;
    return {
        id: id,
        dir: dir,
        config: {
            get: function () {
                try { return JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')); } catch (e) { return {}; }
            },
            set: function (value) {
                try { fs.mkdirSync(host.dir); } catch (e) { /* exists */ }
                try { fs.mkdirSync(dir); } catch (e) { /* exists */ }
                var temp = path.join(dir, 'config.json.tmp');
                fs.writeFileSync(temp, JSON.stringify(value) + '\n', { mode: 384 });
                fs.renameSync(temp, path.join(dir, 'config.json'));
            }
        },
        execute: function (cmd, timeout) {
            if (!allowed) return Promise.reject(new Error(id + ' has no exec permission'));
            return host.execute(cmd, timeout);
        }
    };
};

// Runs fn(instance) and turns a throw into a counted failure instead of a crash.
PluginHost.prototype._guard = function (entry, fn) {
    try {
        var out = fn();
        entry.errors = 0;
        return out;
    } catch (e) {
        this._fail(entry, e);
        return undefined;
    }
};

PluginHost.prototype._fail = function (entry, e) {
    entry.errors++;
    entry.lastError = String(e && e.message || e);
    if (entry.errors >= this.maxErrors && entry.state !== 'failed') {
        this._halt(entry);
        entry.state = 'failed';
    }
};

PluginHost.prototype._halt = function (entry) {
    var inst = entry.instance;
    entry.instance = null;
    try { if (inst && inst.stop) inst.stop(); } catch (e) { /* already failing */ }
};

PluginHost.prototype._startEntry = function (entry) {
    if (entry.instance) return;
    try {
        entry.instance = entry.def.create(this._context(entry));
        if (entry.instance.start) entry.instance.start();
        entry.state = 'running';
        entry.errors = 0;
        entry.lastError = null;
    } catch (e) {
        entry.instance = null;
        entry.state = 'failed';
        entry.errors = this.maxErrors;
        entry.lastError = String(e && e.message || e);
    }
};

PluginHost.prototype.start = function () {
    if (this.started) return this.list();
    this.started = true;
    var state = this._readState();
    var interrupted = false;
    try { interrupted = fs.existsSync(this._file('starting')); } catch (e) { /* treated as clean */ }
    if (interrupted && !state.suspended) {
        state.suspended = true;
        try { this._writeState(state); } catch (e) { /* best effort */ }
    }
    try { fs.unlinkSync(this._file('starting')); } catch (e) { /* none */ }
    this.safeMode = state.suspended;
    if (this.safeMode) {
        for (var s = 0; s < this.order.length; s++) this.entries[this.order[s]].state = 'suspended';
        return this.list();
    }
    try {
        fs.mkdirSync(this.dir);
    } catch (e) { /* exists */ }
    try { fs.writeFileSync(this._file('starting'), String(Date.now())); } catch (e) { /* no marker, no safe mode */ }
    for (var i = 0; i < this.order.length; i++) {
        var entry = this.entries[this.order[i]];
        var flag = state.enabled[entry.def.id];
        if (flag == null ? entry.defaultEnabled : flag) this._startEntry(entry);
    }
    var host = this;
    this.stableTimer = setTimeout(function () { host.markStable(); }, this.stableMs);
    if (this.stableTimer.unref) this.stableTimer.unref();
    return this.list();
};

// Boot survived long enough: the next boot does not need to be careful.
PluginHost.prototype.markStable = function () {
    try { fs.unlinkSync(this._file('starting')); } catch (e) { /* none */ }
};

PluginHost.prototype.stop = function () {
    if (this.stableTimer) clearTimeout(this.stableTimer);
    for (var i = 0; i < this.order.length; i++) {
        var entry = this.entries[this.order[i]];
        this._halt(entry);
        if (entry.state === 'running') entry.state = 'stopped';
    }
    this.markStable();
    this.started = false;
};

PluginHost.prototype.setEnabled = function (id, on) {
    var entry = this.entries[id];
    if (!entry) throw new Error('Unknown plugin');
    var state = this._readState();
    state.enabled[id] = !!on;
    this._writeState(state);
    if (this.safeMode) return this.status(id);
    if (on) {
        entry.errors = 0;
        this._startEntry(entry);
    } else {
        this._halt(entry);
        entry.state = 'stopped';
    }
    return this.status(id);
};

// Leaves safe mode; plugins start again on the next boot.
PluginHost.prototype.resume = function () {
    var state = this._readState();
    state.suspended = false;
    this._writeState(state);
    return { ok: true, restartRequired: this.safeMode };
};

PluginHost.prototype.get = function (id) {
    var entry = this.entries[id];
    return entry && entry.instance || null;
};

PluginHost.prototype.status = function (id) {
    var entry = this.entries[id];
    if (!entry) return null;
    var detail = null;
    if (entry.instance && entry.instance.status) {
        detail = this._guard(entry, function () { return entry.instance.status(); }) || null;
    }
    var enabled = this._readState().enabled[id];
    return {
        id: id,
        name: entry.def.name || id,
        version: entry.def.version || null,
        apiVersion: entry.def.apiVersion,
        permissions: (entry.def.permissions || []).slice(),
        enabled: enabled == null ? entry.defaultEnabled : enabled,
        state: entry.state,
        errors: entry.errors,
        lastError: entry.lastError,
        detail: detail
    };
};

PluginHost.prototype.list = function () {
    var out = [];
    for (var i = 0; i < this.order.length; i++) out.push(this.status(this.order[i]));
    return out;
};

// Plugin routes live under /plugins/<id>/api/...; the host keeps
// /plugins, /plugins/resume and /plugins/<id>/(enable|disable) for itself, so a
// plugin cannot shadow a Vetro route or another plugin's.
// Returns true when the request belonged to the host.
PluginHost.prototype.handle = function (req, res, pathname, json) {
    var m = /^\/plugins(?:\/([^\/]+)(?:\/(.*))?)?$/.exec(pathname);
    if (!m) return false;
    var id = m[1], sub = m[2];
    if (!id) {
        if (req.method !== 'GET') json(res, { error: 'Method not allowed' }, 405);
        else json(res, { apiVersion: API_VERSION, safeMode: this.safeMode, plugins: this.list() });
        return true;
    }
    if (id === 'resume') {
        if (req.method !== 'POST') json(res, { error: 'Method not allowed' }, 405);
        else json(res, this.resume());
        return true;
    }
    var entry = this.entries[id];
    if (!entry) { json(res, { error: 'Unknown plugin' }, 404); return true; }
    if (sub === 'enable' || sub === 'disable') {
        if (req.method !== 'POST') json(res, { error: 'Method not allowed' }, 405);
        else json(res, { ok: true, plugin: this.setEnabled(id, sub === 'enable') });
        return true;
    }
    if (sub === undefined || sub === '') {
        json(res, this.status(id));
        return true;
    }
    var api = /^api(?:\/(.*))?$/.exec(sub);
    if (!api) { json(res, { error: 'Not found' }, 404); return true; }
    if (!entry.instance || !entry.instance.route) { json(res, { error: 'Plugin not running' }, 503); return true; }
    var handled = false;
    this._guard(entry, function () { handled = entry.instance.route(req, res, api[1] || '') !== false; });
    if (!handled && !res.headersSent) {
        json(res, { error: entry.state === 'failed' ? 'Plugin failed: ' + entry.lastError : 'Not found' }, entry.state === 'failed' ? 503 : 404);
    }
    return true;
};

module.exports = { PluginHost: PluginHost, API_VERSION: API_VERSION };
