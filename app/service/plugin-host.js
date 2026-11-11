'use strict';
// Plugin host (API 1): the framework other people build on. A plugin is a folder
// in the plugin directory with a manifest.json and an entry file (docs/plugins.md):
//
//   manifest: { id, name, version, apiVersion: 1, permissions: ['exec'], main: 'index.js',
//               ui: { label } (optional: a page in the dashboard sidebar while it runs),
//               intercepts: [{ appId, label }] (optional: launcher tiles of those apps start this plugin's launch(appId)) }
//   index.js: module.exports = function (ctx) { return { start, stop, status, route } }
//
// Most of Vetro's own features are not plugins yet; the launcher is the first bundled one (bundled: true, see
// docs/PLUGIN-ARCHITECTURE.md). The host owns the lifecycle of the ones
// that are added and keeps a failing plugin from taking Vetro down:
// every call into a plugin is guarded, a plugin that keeps failing is switched
// off, and a start that never completes makes the next boot come up in safe mode.
// Plain ES5 on purpose: the TV runs Node 4.4 (no worker_threads, no vm sandbox
// worth the name), so this is fault isolation, not a security boundary.

var fs = require('fs');
var crypto = require('crypto');
var path = require('path');
// Regular expressions compiled once at module load, not on every call.
var PLUGIN_PATH_RE = /^\/plugins(?:\/([^\/]+)(?:\/(.*))?)?$/;
var SESSION_SUB_RE = /^s\//;
var SESSION_API_RE = /^s\/([0-9a-f]{32})\/(api(?:\/.*)?)$/;
var API_SUB_RE = /^api(?:\/(.*))?$/;

var API_VERSION = 1;
var PERMISSIONS = ['exec'];
var ID_RE = /^[a-z][a-z0-9-]{1,31}$/;
var APP_ID_RE = /^[A-Za-z0-9_.-]{1,120}$/;
var CONTROL_RE = /[\u0000-\u001f\u007f<>]/;
var INTERCEPT_MAX = 3;
var LAUNCH_MS = 120000;
var RESERVED = ['install', 'resume', 'developer'];
var SESSION_MS = 8 * 3600000, SESSION_MAX = 20;
var BUNDLE_MAX_FILES = 20, BUNDLE_MAX_BYTES = 512 * 1024;
var FILE_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;

// "intercepts": the apps whose launcher tile this plugin takes over, each with the name the Plugins page shows. Optional, and
// not a permission, so a plugin that has it still loads on a Vetro that does not know it (unknown manifest keys are ignored).
function checkIntercepts(list, who) {
    if (list == null) return;
    if (!Array.isArray(list) || !list.length || list.length > INTERCEPT_MAX) throw new Error(who + 'intercepts must be a list of 1-' + INTERCEPT_MAX + ' apps');
    var seen = {};
    for (var i = 0; i < list.length; i++) {
        var a = list[i];
        if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Error(who + 'intercepts[' + i + '] must be an object with appId and label');
        if (typeof a.appId !== 'string' || !APP_ID_RE.test(a.appId) || /^\.+$/.test(a.appId)) throw new Error(who + 'intercepts[' + i + '].appId must be a Tizen app id');
        if (typeof a.label !== 'string' || !a.label.trim() || a.label.length > 24 || CONTROL_RE.test(a.label)) throw new Error(who + 'intercepts[' + i + '].label must be 1-24 characters of plain text');
        if (seen[a.appId]) throw new Error(who + 'intercepts lists ' + a.appId + ' twice');
        seen[a.appId] = true;
    }
}

function copyIntercepts(list) {
    return (list || []).map(function (a) { return { appId: a.appId, label: a.label }; });
}

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
    checkIntercepts(m.intercepts, '');
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
// Module paths and stack traces carry the real path (symlinks resolved), so every spelling of the folder is compared: the
// plain one, the folder's own real path while it exists, and its real parent plus its name (still known after it was deleted).
function pathsOf(folder) {
    var plain = path.resolve(folder), out = [plain];
    function add(p) { if (out.indexOf(p) < 0) out.push(p); }
    try { add(fs.realpathSync(plain)); } catch (e) { /* not there */ }
    try { add(path.join(fs.realpathSync(path.dirname(plain)), path.basename(plain))); } catch (e) { /* parent not there */ }
    return out.map(function (p) { return p + path.sep; });
}
function forgetModules(folder) {
    var prefixes = Array.isArray(folder) ? folder : pathsOf(folder);
    Object.keys(require.cache).forEach(function (k) {
        for (var i = 0; i < prefixes.length; i++) if (k.indexOf(prefixes[i]) === 0) { delete require.cache[k]; return; }
    });
}

function PluginHost(opts) {
    opts = opts || {};
    this.dir = opts.dir;                       // writable root, one sub folder per plugin
    this.execute = opts.execute || null;       // agent command runner, only lent to plugins asking for 'exec'
    this.maxErrors = opts.maxErrors || 3;      // consecutive failures before a plugin is switched off
    this.stableMs = opts.stableMs == null ? 60000 : opts.stableMs;
    this.registry = opts.registry || null;     // URL of the plugin list the dashboard shows
    this.external = opts.external !== false;   // load plugin folders from dir
    // Public key of the plugin list (PEM), a different key from the one that signs Vetro updates. Without it
    // signatures cannot be checked; unsigned installs still require Developer mode.
    this.registryKey = opts.registryKey || null;
    // Developer mode lets unsigned code run inside the service, so a build can forbid it altogether: in app-only
    // mode nobody signs in, and anyone on the network could otherwise switch it on and install a plugin.
    this.developerAllowed = typeof opts.developerAllowed === 'function' ? opts.developerAllowed : function () { return true; };
    this.services = opts.services || {};        // what Vetro lends to bundled plugins only (ctx.vetro)
    this.entries = Object.create(null);
    this.order = [];
    this.listeners = [];                       // see onInterceptChange
    this.safeMode = false;
    this.started = false;
    this.stableTimer = null;
    this.sessions = Object.create(null);       // plugin id -> { token: expiry }, see _openSession
}

PluginHost.API_VERSION = API_VERSION;

PluginHost.prototype._file = function (name) { return path.join(this.dir, name); };

PluginHost.prototype._readState = function () {
    try {
        var s = JSON.parse(fs.readFileSync(this._file('plugins.json'), 'utf8'));
        return { enabled: s && typeof s.enabled === 'object' && s.enabled || {}, suspended: !!(s && s.suspended),
            developer: !!(s && s.developer), trust: s && typeof s.trust === 'object' && s.trust || {} };
    } catch (e) { return { enabled: {}, suspended: false, developer: false, trust: {} }; }
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
    if (!this.entries[id]) forgetModules(folder);   // a new entry always reads the files that are there now
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
        permissions: manifest.permissions, ui: manifest.ui, intercepts: manifest.intercepts, create: create
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
PluginHost.prototype.install = function (raw, expectedSha256, signature) {
    // Node 4 defaults string crypto input to binary; catalog bundles are UTF-8.
    var sha = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
    if (expectedSha256 && String(expectedSha256).toLowerCase() !== sha) throw new Error('SHA-256 does not match the expected value');
    var b;
    try { b = JSON.parse(raw); } catch (e) { throw new Error('Not a plugin bundle (invalid JSON)'); }
    var names = checkBundle(b), m = b.manifest, id = m.id;
    var existing = this.entries[id];
    if (existing && existing.def.bundled) throw new Error(id + ' is part of Vetro and cannot be replaced by a bundle');
    if (existing && existing.instance) throw new Error('Switch the plugin off before updating it');
    var trust = this._trustFor(id, m.version, sha, signature);

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
    var after = this._readState();
    after.trust[id] = trust;
    this._writeState(after);
    return { id: id, sha256: sha, updated: !!existing, trust: trust, plugin: this.status(id) };
};

// Where a bundle comes from, as far as it can be shown: 'registry' (the plugin list's key signed this exact id, version
// and hash), 'file' (installed in Developer mode, or from a build without a list key). A signature shows that the bundle
// is the one the list published; it says nothing about what the code does.
function signedText(id, version, sha) { return 'vetro-plugin\n' + id + '\n' + version + '\n' + sha; }
PluginHost.prototype._trustFor = function (id, version, sha, signature) {
    if (signature) {
        if (!this.registryKey) throw new Error('This build has no plugin list key, so a signature cannot be checked');
        var ok = false;
        try {
            var v = crypto.createVerify('RSA-SHA256');
            v.update(signedText(id, version, sha));
            ok = v.verify(this.registryKey, String(signature), 'base64');
        } catch (e) { ok = false; }
        if (!ok) throw new Error('The signature does not match the plugin list key');
        return 'registry';
    }
    if (!this.developerAllowed()) {
        throw new Error('This plugin is not signed by the plugin list. Unsigned plugins are not allowed in this build, which has no sign-in.');
    }
    if (!this._readState().developer) {
        throw new Error('This plugin is not signed by the plugin list. Switch on Developer mode to install it anyway.');
    }
    return 'file';
};

PluginHost.prototype.remove = function (id) {
    var entry = this.entries[id];
    if (!entry) throw new Error('Unknown plugin');
    if (entry.def.bundled) throw new Error(id + ' is part of Vetro and cannot be removed');
    if (entry.instance) throw new Error('Switch the plugin off before removing it');
    var prefixes = pathsOf(path.join(this.dir, id));   // before the folder is gone, so its real path is still known
    rmrf(path.join(this.dir, id));
    forgetModules(prefixes);
    var state = this._readState();
    delete state.enabled[id];
    delete state.trust[id];
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
    checkIntercepts(def.intercepts, def.id + ': ');
    // A bundled plugin ships in the Vetro package: on unless its definition says otherwise.
    this.entries[def.id] = {
        def: def, instance: null, state: 'stopped', errors: 0, lastError: null,
        defaultEnabled: def.bundled === true ? def.defaultEnabled !== false : def.defaultEnabled === true
    };
    this.order.push(def.id);
    return this;
};

// One config file per plugin, in its own folder. Plugins never see another plugin's path.
PluginHost.prototype._context = function (entry) {
    var host = this, id = entry.def.id, dir = path.join(this.dir, id);
    var allowed = (entry.def.permissions || []).indexOf('exec') >= 0 && host.execute;
    var ctx = {
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
    // Services of the shell are lent to the plugins that ship with Vetro, not to third parties (docs/PLUGIN-ARCHITECTURE.md).
    if (entry.def.bundled) ctx.vetro = host.services;
    return ctx;
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
    // A bundled plugin is counted but never switched off: it has no switch on the Plugins page to turn it back on.
    if (entry.errors >= this.maxErrors && entry.state !== 'failed' && !entry.def.bundled) {
        this._halt(entry);
        entry.state = 'failed';
    }
};

// A plugin page runs in a sandboxed frame with an opaque origin: the browser sends no cookie and no
// dashboard sign-in key with its requests. The signed-in dashboard asks for a session instead: a random
// token in the page's own URL (/plugins/<id>/s/<token>/api/...), so relative URLs keep working. It
// opens that plugin's routes and nothing else, expires, and ends when the plugin is switched off.
PluginHost.prototype._openSession = function (id) {
    var now = Date.now(), set = this.sessions[id] || (this.sessions[id] = Object.create(null));
    Object.keys(set).forEach(function (t) { if (set[t] < now) delete set[t]; });
    var live = Object.keys(set);
    if (live.length >= SESSION_MAX) delete set[live[0]];
    var token = crypto.randomBytes(16).toString('hex');
    set[token] = now + SESSION_MS;
    return token;
};

PluginHost.prototype._sessionOk = function (id, token) {
    var set = this.sessions[id];
    return !!(set && set[token] > Date.now());
};

PluginHost.prototype._halt = function (entry) {
    delete this.sessions[entry.def.id];
    var inst = entry.instance;
    entry.instance = null;
    try { if (inst && inst.stop) inst.stop(); } catch (e) { /* already failing */ }
    if (inst) this._interceptsChanged(entry);
};

// An exception that nothing caught: a timer or socket callback of a plugin runs outside every guard above, and an
// uncaught exception ends the whole process. main.js asks here first. When the stack points into a running plugin's folder,
// that plugin is stopped and marked failed (one such crash is enough: its callback cannot be guarded) and Vetro goes on.
// Returns false for anything else, so a bug in Vetro itself still ends the process as before.
PluginHost.prototype.handleCrash = function (error) {
    var stack = String(error && error.stack || '');
    if (!stack || !this.dir) return false;
    for (var i = 0; i < this.order.length; i++) {
        var entry = this.entries[this.order[i]];
        if (!entry || !entry.instance || entry.def.bundled) continue;
        var inside = pathsOf(path.join(this.dir, entry.def.id)).some(function (prefix) { return stack.indexOf(prefix) >= 0; });
        if (!inside) continue;
        entry.errors = this.maxErrors;
        entry.lastError = String(error && error.message || error);
        this._halt(entry);
        entry.state = 'failed';
        return true;
    }
    return false;
};

PluginHost.prototype._startEntry = function (entry) {
    if (entry.instance) return;
    try {
        entry.instance = entry.def.create(this._context(entry));
        if (entry.instance.start) entry.instance.start();
        entry.state = 'running';
        entry.errors = 0;
        entry.lastError = null;
        this._interceptsChanged(entry);
    } catch (e) {
        this._halt(entry);                    // give a half-started plugin the chance to release what it grabbed
        entry.state = 'failed';
        entry.errors = this.maxErrors;
        entry.lastError = String(e && e.message || e);
    }
};

// --- plugins that take over a launcher tile (manifest "intercepts") -------------------------------------------------------
// A plugin claims an app by listing it in its manifest and exporting launch(appId) (a Promise). The claim only counts while the
// plugin is running, so switching it off gives the tile back. Two running plugins on one app: neither wins, the tile launches
// the app as before and both plugins' entries say so.

PluginHost.prototype._claimants = function (appId) {
    var ids = [];
    for (var i = 0; i < this.order.length; i++) {
        var entry = this.entries[this.order[i]];
        if (!entry || !entry.instance || entry.state !== 'running') continue;
        var list = entry.def.intercepts || [];
        for (var j = 0; j < list.length; j++) if (list[j].appId === appId) { ids.push(entry.def.id); break; }
    }
    return ids;
};

PluginHost.prototype._conflictsOf = function (id) {
    var entry = this.entries[id], out = [];
    if (!entry || !entry.instance || entry.state !== 'running') return out;
    var list = entry.def.intercepts || [];
    for (var j = 0; j < list.length; j++) if (this._claimants(list[j].appId).length > 1) out.push(list[j].appId);
    return out;
};

// {appId: {plugin, label}} for the apps with exactly one running claimant that can launch. The launcher builds its list from this.
PluginHost.prototype.intercepted = function () {
    var out = {};
    for (var i = 0; i < this.order.length; i++) {
        var entry = this.entries[this.order[i]];
        if (!entry || !entry.instance || entry.state !== 'running' || typeof entry.instance.launch !== 'function') continue;
        var list = entry.def.intercepts || [];
        for (var j = 0; j < list.length; j++) {
            if (this._claimants(list[j].appId).length === 1) out[list[j].appId] = { plugin: entry.def.id, label: list[j].label };
        }
    }
    return out;
};

// Starts the app through the plugin that claims it. Always resolves: {handled: true, plugin} when the plugin started it, else
// {handled: false, reason} and the caller starts the app itself (a failing or slow plugin must not leave a dead tile).
PluginHost.prototype.launch = function (appId) {
    var host = this, ids = this._claimants(appId);
    if (ids.length !== 1) return Promise.resolve({ handled: false, reason: ids.length ? 'Several plugins claim ' + appId : 'No plugin claims ' + appId });
    var entry = this.entries[ids[0]];
    if (typeof entry.instance.launch !== 'function') return Promise.resolve({ handled: false, reason: ids[0] + ' has no launch()' });
    return new Promise(function (resolve) {
        var done = false, timer = null;
        function finish(result) {
            if (done) return;
            done = true;
            if (timer) clearTimeout(timer);
            resolve(result);
        }
        timer = setTimeout(function () { finish({ handled: false, reason: ids[0] + ' did not answer in time' }); }, host.launchMs || LAUNCH_MS);
        if (timer.unref) timer.unref();
        var out;
        try { out = entry.instance.launch(appId); }
        catch (e) { entry.lastError = String(e && e.message || e); finish({ handled: false, reason: entry.lastError }); return; }
        Promise.resolve(out).then(function (r) {
            finish(r === false ? { handled: false, reason: ids[0] + ' declined' } : { handled: true, plugin: ids[0] });
        }, function (e) {
            entry.lastError = String(e && e.message || e);
            finish({ handled: false, reason: entry.lastError });
        });
    });
};

// fn() runs after a running plugin that claims apps starts or stops, so the launcher can rebuild its list. A plugin that listens
// must not throw; one that does is ignored.
PluginHost.prototype.onInterceptChange = function (fn) {
    if (typeof fn === 'function') this.listeners.push(fn);
};

PluginHost.prototype._interceptsChanged = function (entry) {
    if (!entry.def.intercepts || !this.listeners.length) return;
    for (var i = 0; i < this.listeners.length; i++) { try { this.listeners[i](); } catch (e) { /* the listener's problem */ } }
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
            // Safe mode protects against code nobody checked. A bundled plugin is Vetro's own and keeps running.
            if (held.def.bundled) { if (state.enabled[held.def.id] !== false) this._startEntry(held); continue; }
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
    if (entry.def.bundled && !on) throw new Error(id + ' is part of Vetro: use its own switch');
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
    var st = this._readState(), enabled = st.enabled[id];
    return {
        id: id,
        name: entry.def.name || id,
        ui: entry.def.ui ? { label: entry.def.ui.label } : null,
        version: entry.def.version || null,
        description: entry.def.description || null,
        author: entry.def.author || null,
        apiVersion: entry.def.apiVersion,
        permissions: (entry.def.permissions || []).slice(),
        intercepts: copyIntercepts(entry.def.intercepts),
        interceptConflicts: this._conflictsOf(id),
        bundled: !!entry.def.bundled,
        trust: entry.def.bundled ? 'bundled' : st.trust[id] || 'folder',
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

// Calls a plugin's route on behalf of Vetro itself, for the old URLs that bundled plugins keep answering (/dock, ...).
// Not a plugin page: no sandbox headers. If the plugin is not running the caller gets 503 and the reason.
PluginHost.prototype.dispatch = function (id, req, res, sub, json) {
    var entry = this.entries[id];
    if (!entry || !entry.def.bundled) { json(res, { error: 'Unknown bundled plugin' }, 404); return true; }
    if (!entry.instance || !entry.instance.route) {
        json(res, { error: entry.def.name + ' is not running' + (entry.lastError ? ': ' + entry.lastError : '') }, 503);
        return true;
    }
    var handled = false;
    this._guard(entry, function () { handled = entry.instance.route(req, res, sub) !== false; });
    if (!handled && !res.headersSent) {
        if (entry.errors) json(res, { error: entry.def.name + ' failed: ' + entry.lastError }, 500);
        else json(res, { error: 'Not found' }, 404);
    }
    return true;
};

// Plugin routes live under /plugins/<id>/api/...; the host keeps
// /plugins, /plugins/resume and /plugins/<id>/(enable|disable) for itself, so a
// plugin cannot shadow a Vetro route or another plugin's.
// Returns true when the request belonged to the host.
PluginHost.prototype.handle = function (req, res, pathname, json, readBody) {
    var m = PLUGIN_PATH_RE.exec(pathname);
    if (!m) return false;
    var id = m[1], sub = m[2];
    if (!id) {
        if (req.method !== 'GET') json(res, { error: 'Method not allowed' }, 405);
        else {
            var all = this.list();      // once: every status() call counts an error from a plugin whose status() throws
            json(res, { apiVersion: API_VERSION, safeMode: this.safeMode, dir: this.dir, registry: this.registry,
                signed: !!this.registryKey, developer: this._readState().developer && this.developerAllowed(), developerAllowed: this.developerAllowed(),
                plugins: all.filter(function (p) { return !p.bundled; }), bundled: all.filter(function (p) { return p.bundled; }) });
        }
        return true;
    }
    if (id === 'install') {
        if (req.method !== 'POST' || !readBody) { json(res, { error: 'Method not allowed' }, 405); return true; }
        var host = this;
        readBody(req, function (body, err) {
            if (err) return json(res, { ok: false, error: err.message }, err.statusCode || 400);
            try { json(res, Object.assign({ ok: true }, host.install(body, req.headers && req.headers['x-vetro-sha256'], req.headers && req.headers['x-vetro-signature']))); }
            catch (e) { json(res, { ok: false, error: e.message }, 400); }
        }, BUNDLE_MAX_BYTES + 4096);
        return true;
    }
    if (id === 'developer') {
        if (req.method !== 'POST' || !readBody) { json(res, { error: 'Method not allowed' }, 405); return true; }
        var self = this;
        readBody(req, function (body, err) {
            if (err) return json(res, { ok: false, error: err.message }, err.statusCode || 400);
            var p;
            try { p = JSON.parse(body); } catch (e) { return json(res, { ok: false, error: 'Invalid JSON' }, 400); }
            if (!p || typeof p.on !== 'boolean') return json(res, { ok: false, error: 'Send {"on": true|false}' }, 400);
            if (p.on && !self.developerAllowed()) {
                return json(res, { ok: false, error: 'Developer mode is not available in this build: it has no sign-in, so anyone on the network could use it to run code.' }, 403);
            }
            var state = self._readState();
            state.developer = p.on;
            self._writeState(state);
            json(res, { ok: true, developer: p.on });
        });
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
    if (sub === 'session') {
        if (req.method !== 'POST') json(res, { error: 'Method not allowed' }, 405);
        else if (!entry.instance || !entry.instance.route) json(res, { ok: false, error: 'Plugin not running' }, 409);
        else json(res, { ok: true, path: '/plugins/' + id + '/s/' + this._openSession(id) + '/api/ui' });
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
    if (sub !== undefined && SESSION_SUB_RE.test(sub)) {
        var scoped = SESSION_API_RE.exec(sub);
        if (!scoped || !this._sessionOk(id, scoped[1])) { json(res, { error: 'This plugin page has expired: open it again from the dashboard' }, 401); return true; }
        sub = scoped[2];
    }
    var api = API_SUB_RE.exec(sub);
    if (!api) { json(res, { error: 'Not found' }, 404); return true; }
    if (req.method === 'OPTIONS' && req.headers && req.headers.origin === 'null') {
        // CORS preflight from a sandboxed plugin page (opaque origin) so it can POST JSON.
        res.writeHead(204, { 'Access-Control-Allow-Origin': 'null', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600', 'Vary': 'Origin' });
        res.end();
        return true;
    }
    if (!entry.instance || !entry.instance.route) { json(res, { error: 'Plugin not running' }, 503); return true; }
    var handled = false, errorsBefore = entry.errors;
    // A plugin page is untrusted content: sandboxed even when opened on its own, and
    // readable by the sandboxed dashboard frame (opaque origin) through CORS.
    res.setHeader('Content-Security-Policy', 'sandbox allow-scripts');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.headers && req.headers.origin === 'null') {
        res.setHeader('Access-Control-Allow-Origin', 'null');
        res.setHeader('Vary', 'Origin');
    }
    this._guard(entry, function () { handled = entry.instance.route(req, res, api[1] || '') !== false; });
    if (!handled && !res.headersSent) {
        // A route that threw says so (500) instead of looking like a missing route (404), which hid the first failures.
        if (entry.state === 'failed') json(res, { error: 'Plugin failed: ' + entry.lastError }, 503);
        else if (entry.errors > errorsBefore) json(res, { error: 'Plugin error: ' + entry.lastError }, 500);
        else json(res, { error: 'Not found' }, 404);
    }
    return true;
};

module.exports = { PluginHost: PluginHost, signedText: signedText, API_VERSION: API_VERSION, BUNDLE_MAX_BYTES: BUNDLE_MAX_BYTES, checkManifest: checkManifest, checkBundle: checkBundle, checkIntercepts: checkIntercepts, INTERCEPT_MAX: INTERCEPT_MAX };
