'use strict';
// Plugin host (API 1): the framework other people build on. A plugin is a folder
// in the plugin directory with a manifest.json and an entry file (docs/plugins.md):
//
//   manifest: { id, name, version, apiVersion: 1, permissions: ['exec'], main: 'index.js',
//               ui: { label } (optional: a page in the dashboard sidebar while it runs) }
//   index.js: module.exports = function (ctx) { return { start, stop, status, route } }
//
// Vetro's own features are not plugins. The host owns the lifecycle of the ones
// that are added and keeps a failing plugin from taking Vetro down:
// every call into a plugin is guarded, a plugin that keeps failing is switched
// off, and a start that never completes makes the next boot come up in safe mode.
// Plain ES5 on purpose: the TV runs Node 4.4 (no worker_threads, no vm sandbox
// worth the name), so this is fault isolation, not a security boundary.

var fs = require('fs');
var crypto = require('crypto');
var path = require('path');

var API_VERSION = 1;
var PERMISSIONS = ['exec'];
var ID_RE = /^[a-z][a-z0-9-]{1,31}$/;
var RESERVED = ['install', 'resume'];
var BUNDLE_MAX_FILES = 20, BUNDLE_MAX_BYTES = 512 * 1024;
var FILE_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;

// Manifest rules shared by the loader, the installer and `vetro-plugin.cjs pack/check`.
function checkManifest(m) {
    var id = m && m.id;
    if (!ID_RE.test(id || '') || RESERVED.indexOf(id) >= 0) throw new Error('Invalid plugin id');
    if (m.apiVersion !== API_VERSION) throw new Error('Unsupported plugin API ' + m.apiVersion + ' (this Vetro runs API ' + API_VERSION + ')');
    if (m.name != null && (typeof m.name !== 'string' || !m.name || m.name.length > 40)) throw new Error('name must be 1-40 characters');
    if (m.version != null && (typeof m.version !== 'string' || !m.version || m.version.length > 24)) throw new Error('version must be a string of 1-24 characters');
    var perms = m.permissions == null ? [] : m.permissions;
    if (!Array.isArray(perms)) throw new Error('permissions must be a list');
    for (var i = 0; i < perms.length; i++) if (PERMISSIONS.indexOf(perms[i]) < 0) throw new Error('Unknown permission ' + perms[i]);
    if (m.description != null && (typeof m.description !== 'string' || m.description.length > 160)) throw new Error('description must be a string of up to 160 characters');
    if (m.author != null && (typeof m.author !== 'string' || m.author.length > 60)) throw new Error('author must be a string of up to 60 characters');
    if (m.ui != null && (typeof m.ui.label !== 'string' || !m.ui.label || m.ui.label.length > 24)) throw new Error('ui.label must be 1-24 characters');
    if (m.main != null && (typeof m.main !== 'string' || !FILE_RE.test(m.main))) throw new Error('main must be a file name inside the plugin folder');
}

// A whole bundle object (parsed JSON): manifest, file names, sizes, entry file. Returns the file names.
function checkBundle(b) {
    if (!b || b.format !== 'vetro-plugin' || b.version !== 1 || !b.manifest || !b.files || typeof b.files !== 'object') {
        throw new Error('Not a plugin bundle (format vetro-plugin, version 1)');
    }
    checkManifest(b.manifest);
    var names = Object.keys(b.files), total = 0;
    if (!names.length || names.length > BUNDLE_MAX_FILES) throw new Error('A bundle holds 1 to ' + BUNDLE_MAX_FILES + ' files');
    for (var j = 0; j < names.length; j++) {
        if (!FILE_RE.test(names[j]) || names[j] === 'manifest.json' || typeof b.files[names[j]] !== 'string') throw new Error('Invalid file entry: ' + names[j]);
        total += Buffer.byteLength(b.files[names[j]]);
    }
    if (total > BUNDLE_MAX_BYTES) throw new Error('Bundle is larger than ' + (BUNDLE_MAX_BYTES / 1024) + ' KB');
    if (typeof b.files[b.manifest.main || 'index.js'] !== 'string') throw new Error('Entry file ' + (b.manifest.main || 'index.js') + ' is missing');
    return names;
}

// Node caches modules by path: without this a removed and re-installed plugin would run its old code.
function forgetModules(folder) {
    var parent = path.dirname(path.resolve(folder));
    try { parent = fs.realpathSync(parent); } catch (e) { /* keep the plain path */ }
    var prefix = path.join(parent, path.basename(folder)) + path.sep;
    Object.keys(require.cache).forEach(function (k) { if (k.indexOf(prefix) === 0) delete require.cache[k]; });
}

function PluginHost(opts) {
    opts = opts || {};
    this.dir = opts.dir;                       // writable root, one sub folder per plugin
    this.execute = opts.execute || null;       // agent command runner, only lent to plugins asking for 'exec'
    this.maxErrors = opts.maxErrors || 3;      // consecutive failures before a plugin is switched off
    this.stableMs = opts.stableMs == null ? 60000 : opts.stableMs;
    this.registry = opts.registry || null;     // URL of the plugin list the dashboard shows
    this.external = opts.external !== false;   // load plugin folders from dir
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

// Plugins come from folders, never from the network: whoever puts one there has
// shell access to the TV already. Nothing runs until it is switched on.
PluginHost.prototype._loadExternal = function () {
    var names;
    try { names = fs.readdirSync(this.dir); } catch (e) { return; }
    names.sort();
    for (var i = 0; i < names.length; i++) {
        var id = names[i], folder = path.join(this.dir, id);
        var isDir = false;
        try { isDir = fs.statSync(folder).isDirectory(); } catch (e) { /* skip */ }
        if (!isDir || id.charAt(0) === '.' || this.entries[id]) continue;
        try {
            this._loadFolder(id, folder);
        } catch (e) {
            this.entries[id] = {
                def: { id: id, name: id, apiVersion: null, permissions: [] }, instance: null,
                state: 'invalid', errors: 0, lastError: String(e && e.message || e), defaultEnabled: false
            };
            this.order.push(id);
        }
    }
};

PluginHost.prototype._loadFolder = function (id, folder) {
    var manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8')); }
    catch (e) { throw new Error('manifest.json missing or not valid JSON'); }
    if (manifest.id !== id) throw new Error('manifest id must match the folder name');
    checkManifest(manifest);
    var main = path.resolve(folder, manifest.main || 'index.js');
    if (main.indexOf(path.resolve(folder) + path.sep) !== 0) throw new Error('main must stay inside the plugin folder');
    if (!fs.existsSync(main)) throw new Error('entry file ' + (manifest.main || 'index.js') + ' is missing');
    // The code is only read when the plugin is switched on: installing, listing or booting
    // with it switched off never executes anything from the plugin.
    var create = function (ctx) {
        var mod = require(main);
        var make = typeof mod === 'function' ? mod : mod && mod.create;
        if (typeof make !== 'function') throw new Error('entry file must export a function');
        return make(ctx);
    };
    this.register({
        id: id, name: manifest.name, version: manifest.version, description: manifest.description, author: manifest.author, apiVersion: manifest.apiVersion,
        permissions: manifest.permissions, ui: manifest.ui, create: create
    });
};

function rmrf(target) {
    var st;
    try { st = fs.lstatSync(target); } catch (e) { return; }
    if (st.isDirectory()) {
        fs.readdirSync(target).forEach(function (n) { rmrf(path.join(target, n)); });
        fs.rmdirSync(target);
    } else fs.unlinkSync(target);
}

// A bundle is one text file: { format: 'vetro-plugin', version: 1, manifest, files: { name: text } }.
// Text only on purpose (no binaries, no native code), small, and hashed as received.
// expectedSha256 is optional; when given (from the plugin list) a mismatch is refused.
// The plugin lands switched off; nothing in it runs until the user turns it on.
PluginHost.prototype.install = function (raw, expectedSha256) {
    var sha = crypto.createHash('sha256').update(raw).digest('hex');
    if (expectedSha256 && String(expectedSha256).toLowerCase() !== sha) throw new Error('SHA-256 does not match the expected value');
    var b;
    try { b = JSON.parse(raw); } catch (e) { throw new Error('Not a plugin bundle (invalid JSON)'); }
    var names = checkBundle(b), m = b.manifest, id = m.id;
    var existing = this.entries[id];
    if (existing && existing.instance) throw new Error('Switch the plugin off before updating it');

    var staging = path.join(this.dir, '.install-' + id), target = path.join(this.dir, id);
    try { fs.mkdirSync(this.dir); } catch (e) { /* exists */ }
    rmrf(staging);
    fs.mkdirSync(staging);
    try {
        names.forEach(function (n) {
            var parts = n.split('/');
            for (var k = 1; k < parts.length; k++) {
                try { fs.mkdirSync(path.join(staging, parts.slice(0, k).join('/'))); } catch (e) { /* exists */ }
            }
            fs.writeFileSync(path.join(staging, n), b.files[n]);
        });
        fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
        // An update keeps what the plugin saved (config.json) and can be rolled back.
        try { fs.writeFileSync(path.join(staging, 'config.json'), fs.readFileSync(path.join(target, 'config.json')), { mode: 384 }); } catch (e) { /* first install */ }
    } catch (e) {
        rmrf(staging);
        throw e;
    }
    var backup = path.join(this.dir, '.previous-' + id);
    rmrf(backup);
    try {
        if (fs.existsSync(target)) fs.renameSync(target, backup);
        fs.renameSync(staging, target);
    } catch (e) {
        rmrf(staging);
        if (!fs.existsSync(target) && fs.existsSync(backup)) fs.renameSync(backup, target);
        throw e;
    }
    rmrf(backup);
    forgetModules(target);
    // New code replaces the old in this process (the module cache was cleared), so no restart is needed.
    // The plugin comes back switched off, as after a first install: the user decides to run the new version.
    var at = existing ? this.order.indexOf(id) : -1;
    if (existing) {
        delete this.entries[id];
        this.order.splice(at, 1);
        var state = this._readState();
        state.enabled[id] = false;
        this._writeState(state);
    }
    try {
        this._loadFolder(id, target);
    } catch (e) {
        this.entries[id] = {
            def: { id: id, name: id, apiVersion: null, permissions: [] }, instance: null,
            state: 'invalid', errors: 0, lastError: String(e && e.message || e), defaultEnabled: false
        };
        this.order.push(id);
    }
    if (at >= 0) this.order.splice(at, 0, this.order.pop());
    return { id: id, sha256: sha, updated: !!existing, plugin: this.status(id) };
};

PluginHost.prototype.remove = function (id) {
    var entry = this.entries[id];
    if (!entry) throw new Error('Unknown plugin');
    if (entry.instance) throw new Error('Switch the plugin off before removing it');
    rmrf(path.join(this.dir, id));
    forgetModules(path.join(this.dir, id));
    var state = this._readState();
    delete state.enabled[id];
    this._writeState(state);
    delete this.entries[id];
    this.order.splice(this.order.indexOf(id), 1);
    return { ok: true };
};

PluginHost.prototype.register = function (def) {
    if (!def || !ID_RE.test(def.id || '') || RESERVED.indexOf(def.id) >= 0) throw new Error('Invalid plugin id');
    if (this.entries[def.id]) throw new Error('Duplicate plugin: ' + def.id);
    if (def.apiVersion !== API_VERSION) throw new Error(def.id + ': unsupported plugin API ' + def.apiVersion);
    if (typeof def.create !== 'function') throw new Error(def.id + ': create() missing');
    var perms = def.permissions == null ? [] : def.permissions;
    if (!Array.isArray(perms)) throw new Error(def.id + ': permissions must be a list');
    for (var i = 0; i < perms.length; i++) {
        if (PERMISSIONS.indexOf(perms[i]) < 0) throw new Error(def.id + ': unknown permission ' + perms[i]);
    }
    if (def.ui != null && (typeof def.ui.label !== 'string' || !def.ui.label || def.ui.label.length > 24)) {
        throw new Error(def.id + ': ui.label must be 1-24 characters');
    }
    this.entries[def.id] = {
        def: def, instance: null, state: 'stopped', errors: 0, lastError: null,
        defaultEnabled: def.defaultEnabled === true
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
PluginHost.prototype._guard = function (entry, fn, diagnostic) {
    try {
        var out = fn();
        if (!diagnostic) entry.errors = 0;      // a status poll must not hide a route that keeps failing
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
        this._halt(entry);                    // give a half-started plugin the chance to release what it grabbed
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
        if (this.external) this._loadExternal();      // metadata only: nothing of the plugins runs
        for (var s = 0; s < this.order.length; s++) {
            var held = this.entries[this.order[s]];
            if (held.state !== 'invalid') held.state = 'suspended';
        }
        return this.list();
    }
    try {
        fs.mkdirSync(this.dir);
    } catch (e) { /* exists */ }
    try { fs.writeFileSync(this._file('starting'), String(Date.now())); } catch (e) { /* no marker, no safe mode */ }
    if (this.external) this._loadExternal();
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
    if (entry.state === 'invalid') throw new Error('Plugin is invalid: ' + entry.lastError);
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
        detail = this._guard(entry, function () { return entry.instance.status(); }, true) || null;
    }
    var enabled = this._readState().enabled[id];
    return {
        id: id,
        name: entry.def.name || id,
        ui: entry.def.ui ? { label: entry.def.ui.label } : null,
        version: entry.def.version || null,
        description: entry.def.description || null,
        author: entry.def.author || null,
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
PluginHost.prototype.handle = function (req, res, pathname, json, readBody) {
    var m = /^\/plugins(?:\/([^\/]+)(?:\/(.*))?)?$/.exec(pathname);
    if (!m) return false;
    var id = m[1], sub = m[2];
    if (!id) {
        if (req.method !== 'GET') json(res, { error: 'Method not allowed' }, 405);
        else json(res, { apiVersion: API_VERSION, safeMode: this.safeMode, dir: this.dir, registry: this.registry, plugins: this.list() });
        return true;
    }
    if (id === 'install') {
        if (req.method !== 'POST' || !readBody) { json(res, { error: 'Method not allowed' }, 405); return true; }
        var host = this;
        readBody(req, function (body, err) {
            if (err) return json(res, { ok: false, error: err.message }, err.statusCode || 400);
            try { json(res, Object.assign({ ok: true }, host.install(body, req.headers && req.headers['x-vetro-sha256']))); }
            catch (e) { json(res, { ok: false, error: e.message }, 400); }
        }, BUNDLE_MAX_BYTES + 4096);
        return true;
    }
    if (id === 'resume') {
        if (req.method !== 'POST') json(res, { error: 'Method not allowed' }, 405);
        else json(res, this.resume());
        return true;
    }
    var entry = this.entries[id];
    if (!entry) { json(res, { error: 'Unknown plugin' }, 404); return true; }
    if (sub === 'remove') {
        if (req.method !== 'POST') json(res, { error: 'Method not allowed' }, 405);
        else {
            try { json(res, this.remove(id)); }
            catch (e) { json(res, { ok: false, error: e.message }, 409); }
        }
        return true;
    }
    if (sub === 'enable' || sub === 'disable') {
        if (req.method !== 'POST') json(res, { error: 'Method not allowed' }, 405);
        else {
            try { json(res, { ok: true, plugin: this.setEnabled(id, sub === 'enable') }); }
            catch (e) { json(res, { ok: false, error: e.message }, 409); }
        }
        return true;
    }
    if (sub === undefined || sub === '') {
        json(res, this.status(id));
        return true;
    }
    var api = /^api(?:\/(.*))?$/.exec(sub);
    if (!api) { json(res, { error: 'Not found' }, 404); return true; }
    if (req.method === 'OPTIONS' && req.headers && req.headers.origin === 'null') {
        // CORS preflight from a sandboxed plugin page (opaque origin) so it can POST JSON.
        res.writeHead(204, { 'Access-Control-Allow-Origin': 'null', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600', 'Vary': 'Origin' });
        res.end();
        return true;
    }
    if (!entry.instance || !entry.instance.route) { json(res, { error: 'Plugin not running' }, 503); return true; }
    var handled = false;
    // A plugin page is untrusted content: sandboxed even when opened on its own, and
    // readable by the sandboxed dashboard frame (opaque origin) through CORS.
    res.setHeader('Content-Security-Policy', 'sandbox allow-scripts');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.headers && req.headers.origin === 'null') {
        res.setHeader('Access-Control-Allow-Origin', 'null');
        res.setHeader('Vary', 'Origin');
    }
    this._guard(entry, function () { handled = entry.instance.route(req, res, api[1] || '') !== false; });
    if (!handled && !res.headersSent) {
        json(res, { error: entry.state === 'failed' ? 'Plugin failed: ' + entry.lastError : 'Not found' }, entry.state === 'failed' ? 503 : 404);
    }
    return true;
};

module.exports = { PluginHost: PluginHost, API_VERSION: API_VERSION, BUNDLE_MAX_BYTES: BUNDLE_MAX_BYTES, checkManifest: checkManifest, checkBundle: checkBundle };
