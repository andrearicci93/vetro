'use strict';

// Apps removed through Vetro stay removed: one global switch in Quick settings.
//
// Idea, mechanism and first implementation by zabique (https://github.com/zabique/vetro, branch fork/extras, MIT),
// who found and tested it on a QN85A. This version adds the global switch, the store id read before an uninstall and
// a slower backstop, and was checked against the Q80A firmware files only (see the notes below).
//
// At the source: webappservice keeps the store ids of recommended apps the user uninstalled through Samsung's own
// UI in WASConfigTable RESERVED_19 (comma list, written by its uninstaller CTWebAppInstaller::t_UninstallPost ->
// CWASUtil::UpdateUninstalledRecommendedApps), and its app sync (CAppSyncList::m_CompareApps, when RESERVED_18 says
// removableByCountry "true", as it does on the Q80A) skips them. An uninstall with pkgcmd (Vetro, App Manager) never
// lands there, so the sync puts the "preinstall" app back. sync() records the listed packages' store ids as Samsung's
// uninstaller would, and later takes off only ids Vetro added itself. Switching off takes them all off again.
//
// Backstop: check() uninstalls a listed package that is installed anyway and logs it in the history (empty while the
// source fix holds). Only removable, non-system packages are touched, never Vetro itself. This also removes an app
// the user installs again on purpose, so "Allow again" comes first. The state lives outside the app, so it survives a
// Vetro reinstall.
//
// On by default. Until an app is removed the list is empty and nothing touches Samsung's database.
//
// Not tested on a running Q80A: the schema and the config rows were read from the firmware dump (rollback-journal
// mode, so there are no -wal/-shm files for the chown to miss), the write into Samsung's live database has not been
// tried there.

var fs = require('fs');

var STORE = '/opt/usr/home/owner/share/vetro-keep-removed.json';
var PKG_DB = '/opt/dbspace/.pkgmgr_parser.db';
var WAS_DB = '/opt/dbspace/.webappservice.db';
var WAS_BACKUP = '/opt/usr/home/owner/share/vetro-webappservice.db.bak';
var KEY = 'RESERVED_19';
var ID = /^[A-Za-z0-9_.-]{1,64}$/;
var NEVER = /^vetrotvapp(\.|$)/;
var OWNER_UID = 5001;   // owner on the Q80A (/etc/passwd of the firmware); the database is chowned back to it

function wrap(s) { return 'echo ' + Buffer.from(s).toString('base64') + ' | base64 -d | sh'; }
function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
function splitIds(s) { return uniq(String(s || '').split(',').map(function (x) { return x.trim(); }).filter(function (x) { return ID.test(x); })); }

function clean(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (p) {
        if (typeof p !== 'string' || !ID.test(p)) throw Error('Invalid package id: ' + String(p).slice(0, 64));
        if (NEVER.test(p)) throw Error(p + ' cannot be kept removed');
        if (out.indexOf(p) < 0) out.push(p);
    });
    return out;
}

function quoted(list) { return list.map(function (p) { return "'" + p + "'"; }).join(','); }

// One line per listed package that is installed: I|<package>|<removable>|<system>.
function installedScript(list) {
    return 'sqlite3 -readonly ' + PKG_DB + ' "SELECT \'I|\'||package||\'|\'||package_removable||\'|\'||package_system FROM package_info WHERE package IN (' + quoted(list) + ');"';
}

function parseInstalled(text) {
    return String(text || '').replace(/\r/g, '').split('\n').map(function (l) { return l.split('|'); })
        .filter(function (f) { return f[0] === 'I' && ID.test(f[1] || ''); })
        .map(function (f) { return { packageId: f[1], removable: f[2] === 'true', system: f[3] === 'true' }; });
}

// M|<package>|<store id> per listed package Samsung knows (store apps only), then C|<RESERVED_19>.
function sourceReadScript(list) {
    var lines = [];
    if (list.length) lines.push('sqlite3 -readonly ' + WAS_DB + ' "SELECT \'M|\'||pkgname||\'|\'||id FROM widgetinfo WHERE install_type!=\'user\' AND pkgname IN (' + quoted(list) + ');" || exit 1');
    lines.push('v=$(sqlite3 -readonly ' + WAS_DB + ' "SELECT value FROM WASConfigTable WHERE name=\'' + KEY + '\';") || exit 1', 'echo "C|$v"');
    return lines.join('\n');
}

function parseSource(text) {
    var o = { map: {}, current: null };
    String(text || '').replace(/\r/g, '').split('\n').forEach(function (l) {
        var f = l.split('|');
        if (f[0] === 'M' && ID.test(f[1] || '') && ID.test(f[2] || '')) o.map[f[1]] = f[2];
        else if (f[0] === 'C') o.current = splitIds(f.slice(1).join('|'));
    });
    return o;
}

// The RESERVED_19 Vetro wants: Samsung's entries stay, the listed apps' ids join, ids Vetro added for apps that
// are no longer listed leave. Also returns which ids are Vetro's from now on.
function plan(current, listedIds, ownedBefore) {
    var drop = ownedBefore.filter(function (id) { return listedIds.indexOf(id) < 0; });
    var want = uniq(current.filter(function (id) { return drop.indexOf(id) < 0; }).concat(listedIds));
    var owned = listedIds.filter(function (id) { return current.indexOf(id) < 0 || ownedBefore.indexOf(id) >= 0; });
    return { want: want, owned: owned };
}

function sourceWriteScript(ids) {
    var v = ids.join(',');
    if (!/^[A-Za-z0-9_.,-]*$/.test(v)) throw Error('Unsafe store id list');
    return [
        'set -e',
        '[ -f ' + WAS_BACKUP + ' ] || cp -p ' + WAS_DB + ' ' + WAS_BACKUP,
        'sqlite3 ' + WAS_DB + ' "INSERT OR REPLACE INTO WASConfigTable(name,value) VALUES(\'' + KEY + '\',\'' + v + '\');"',
        'chown ' + OWNER_UID + ':users ' + WAS_DB + ' ' + WAS_DB + '-journal 2>/dev/null || true',
        'echo "C|$(sqlite3 -readonly ' + WAS_DB + ' "SELECT value FROM WASConfigTable WHERE name=\'' + KEY + '\';")"'
    ].join('\n');
}

function KeepRemoved(execute, opts) {
    opts = opts || {};
    this.execute = execute;
    this.path = opts.path || STORE;
    this.onRemoved = opts.onRemoved || function () { return Promise.resolve(); };
    this.now = opts.now || function () { return Date.now(); };
    this.busy = null;
    this.rerun = null;
    this.last = { at: 0, removed: [], skipped: [], error: null, source: null };
}

KeepRemoved.prototype.read = function () {
    // On until the user switches it off: with an empty list nothing is read from or written to Samsung's database.
    var s = { enabled: true, packages: [], storeIds: {}, owned: [], history: [] };
    try {
        var j = JSON.parse(fs.readFileSync(this.path, 'utf8'));
        s.enabled = j.enabled !== false;
        s.packages = clean(j.packages);
        Object.keys(j.storeIds || {}).forEach(function (p) { if (ID.test(p) && ID.test(String(j.storeIds[p]))) s.storeIds[p] = String(j.storeIds[p]); });
        s.owned = splitIds((Array.isArray(j.owned) ? j.owned : []).join(','));
        s.history = Array.isArray(j.history) ? j.history.slice(-50) : [];
    } catch (e) { /* no file yet */ }
    return s;
};

KeepRemoved.prototype.write = function (s) {
    var tmp = this.path + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ enabled: s.enabled === true, packages: s.packages, storeIds: s.storeIds, owned: s.owned, history: s.history.slice(-50) }, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, this.path);
};

KeepRemoved.prototype.enabled = function () { return this.read().enabled; };
KeepRemoved.prototype.list = function () { return this.read().packages; };

// Every reinstall the backstop had to undo, kept across restarts: stays empty while the source fix holds.
KeepRemoved.prototype.history = function () { return this.read().history; };

// What the restore plan needs: whether the switch is on and how many ids in Samsung's list are Vetro's.
KeepRemoved.prototype.state = function () { var s = this.read(); return { enabled: s.enabled, owned: s.owned.length }; };

// What the dashboard shows.
KeepRemoved.prototype.summary = function () {
    var s = this.read();
    return { enabled: s.enabled, packages: s.packages, last: this.last, history: s.history };
};

// action: 'add' | 'remove' | 'set' on the list. Returns the new list. The list is kept while the switch is off.
KeepRemoved.prototype.change = function (action, packages) {
    var s = this.read(), given = clean(packages);
    if (action === 'add') s.packages = clean(s.packages.concat(given));
    else if (action === 'remove') s.packages = s.packages.filter(function (p) { return given.indexOf(p) < 0; });
    else if (action === 'set') s.packages = given;
    else throw Error('Unknown action');
    this.write(s);
    return s.packages;
};

KeepRemoved.prototype.setEnabled = function (on) {
    if (typeof on !== 'boolean') throw Error('Invalid state');
    var s = this.read();
    s.enabled = on;
    this.write(s);
    return on;
};

// Before Vetro uninstalls a package: Samsung's row (and with it the store id) can be gone afterwards, so the id is read
// now and kept. Never rejects; an app without a store id simply has only the backstop.
KeepRemoved.prototype.learn = function (packageId) {
    var self = this, list;
    try { list = clean([packageId]); } catch (e) { return Promise.resolve(false); }
    if (!this.read().enabled) return Promise.resolve(false);
    return this.execute(wrap(sourceReadScript(list)), 15000).then(function (r) {
        var src = parseSource(r.stdout), id = src.map[list[0]];
        if (r.exit_code || r.timed_out || !id) return false;
        var s = self.read();
        s.storeIds[list[0]] = id;
        self.write(s);
        return true;
    }).catch(function () { return false; });
};

// Brings RESERVED_19 in line with the list (an empty one while the switch is off). Resolves {ids, changed}.
KeepRemoved.prototype.sync = function () {
    var self = this, s = this.read(), listed = s.enabled ? s.packages : [];
    if (!listed.length && !s.owned.length) return Promise.resolve({ ids: null, changed: false });
    return this.execute(wrap(sourceReadScript(listed)), 15000).then(function (r) {
        var src = parseSource(r.stdout);
        if (r.exit_code || r.timed_out || !src.current) throw Error('Samsung app registry unavailable');
        // A store id, once seen, is remembered: the sync must keep skipping the app even if its row goes.
        var storeIds = Object.assign({}, s.storeIds);
        listed.forEach(function (p) { var id = src.map[p] || s.storeIds[p]; if (id) storeIds[p] = id; });
        var listedIds = uniq(listed.map(function (p) { return storeIds[p]; }).filter(Boolean));
        var pl = plan(src.current, listedIds, s.owned);
        // Merge into the state as it is now: the switch or the list may have changed while the TV was being read.
        var save = function () { var cur = self.read(); cur.storeIds = Object.assign({}, cur.storeIds, storeIds); cur.owned = pl.owned; self.write(cur); };
        if (pl.want.join(',') === src.current.join(',')) { save(); return { ids: pl.want, changed: false }; }
        return self.execute(wrap(sourceWriteScript(pl.want)), 15000).then(function (w) {
            var got = parseSource(w.stdout).current;
            if (w.exit_code || !got || got.join(',') !== pl.want.join(',')) throw Error(KEY + ' not written');
            save();
            return { ids: pl.want, changed: true };
        });
    });
};

// Source fix, then the backstop (only while the switch is on). Resolves {removed, skipped, error, source}.
KeepRemoved.prototype.check = function () {
    var self = this;
    // A run in flight read the switch before a change that came after it: wait for it, then run once more with the
    // new state (every caller that arrives meanwhile shares that one rerun).
    if (this.busy) {
        if (!this.rerun) this.rerun = this.busy.catch(function () {}).then(function () { self.rerun = null; return self.check(); });
        return this.rerun;
    }
    this.busy = this.sync().then(function (src) { return { ids: src.ids, changed: src.changed, error: null }; },
        function (e) { return { ids: null, changed: false, error: e.message }; }).then(function (source) {
        var list = self.read().enabled ? self.list() : [];
        if (!list.length) return { at: self.now(), removed: [], skipped: [], error: null, source: source };
        return self.execute(wrap(installedScript(list)), 15000).then(function (r) {
            if (r.exit_code || r.timed_out) throw Error(r.stderr || 'Package list unavailable');
            var found = parseInstalled(r.stdout), removed = [], skipped = [];
            return found.reduce(function (p, pkg) {
                return p.then(function () {
                    if (!pkg.removable || pkg.system) { skipped.push({ packageId: pkg.packageId, reason: 'not removable' }); return; }
                    return self.execute('pkgcmd -u -n ' + pkg.packageId, 60000).then(function (u) {
                        if (u.exit_code === 0) removed.push(pkg.packageId);
                        else skipped.push({ packageId: pkg.packageId, reason: (u.stderr || u.stdout || 'uninstall failed').trim().split('\n').pop() });
                    });
                });
            }, Promise.resolve()).then(function () {
                if (removed.length) {
                    var s = self.read();
                    s.history.push({ at: self.now(), removed: removed });
                    self.write(s);
                }
                return (removed.length ? self.onRemoved(removed).catch(function () {}) : Promise.resolve()).then(function () {
                    return { at: self.now(), removed: removed, skipped: skipped, error: null, source: source };
                });
            });
        }).catch(function (e) { return { at: self.now(), removed: [], skipped: [], error: e.message, source: source }; });
    }).then(function (res) {
        self.busy = null;
        self.last = res;
        return res;
    });
    return this.busy;
};

module.exports = {
    KeepRemoved: KeepRemoved, installedScript: installedScript, parseInstalled: parseInstalled, clean: clean,
    sourceReadScript: sourceReadScript, parseSource: parseSource, plan: plan, sourceWriteScript: sourceWriteScript, STORE: STORE, KEY: KEY
};
