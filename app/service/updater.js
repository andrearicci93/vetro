'use strict';
// Self-update: replaces Vetro's own files from a signed update bundle, with a rollback if the new version does not come up.
// ES5 on purpose (Node 4.4 on the TV). See docs/UPDATING.md.
//
// The Samsung package signature is not involved: with the root agent the files are replaced in place, so an update needs
// neither the owner's certificate nor Host PC IP. What stands in for the package signature is the bundle's own signature:
// the manifest is signed (RSA-SHA256) by the maintainer's offline key and the public half is built into the package
// (update-key.js). A bundle that is not signed by that key is refused, wherever it was downloaded from.
//
// Bundle: { format: 'vetro-update', v: 1, manifest: '<JSON text>', signature: '<base64>', files: { path: '<base64>' } }
// Manifest: { format, v, version, shell, files: { path: { sha256, size } } }
// "shell" is the revision of what a file swap cannot change (config.xml: privileges, service flags). A bundle with a higher
// shell than the installed one needs a full reinstall and is refused here.
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var FORMAT = 'vetro-update';
var MAX_FILES = 300;
var MAX_BYTES = 12 * 1024 * 1024;
var WAIT_SECONDS = 240;    // the watchdog waits this long for the new version to confirm itself
// Only these paths can be replaced. config.xml, signatures and anything else of the package stay as installed.
var ALLOWED = /^(?:service\/[A-Za-z0-9_.-]+\.js|native\/[A-Za-z0-9_.\/-]+|payload\/[A-Za-z0-9_.-]+|index\.html|icon\.png)$/;
var DIR = /^\/[A-Za-z0-9_.\/-]+$/;
var VERSION = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;
var SERVICE_ID = 'vetrotvapp.svc';

function fail(message, code) { var e = new Error(message); if (code) e.code = code; return e; }
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function okPath(name) {
    return typeof name === 'string' && ALLOWED.test(name) && !name.split('/').some(function (s) { return s === '' || s === '.' || s === '..'; });
}
function compare(a, b) {
    var x = VERSION.exec(a), y = VERSION.exec(b);
    if (!x || !y) return null;
    for (var i = 1; i <= 3; i++) if (+x[i] !== +y[i]) return +x[i] < +y[i] ? -1 : 1;
    return 0;
}
function mkdirp(dir) {
    if (fs.existsSync(dir)) return;
    mkdirp(path.dirname(dir));
    try { fs.mkdirSync(dir); } catch (e) { if (!fs.existsSync(dir)) throw e; }
}
function rmrf(target) {
    var st;
    try { st = fs.lstatSync(target); } catch (e) { return; }
    if (st.isDirectory()) {
        fs.readdirSync(target).forEach(function (n) { rmrf(path.join(target, n)); });
        fs.rmdirSync(target);
    } else fs.unlinkSync(target);
}
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; } }
function writeJson(file, value) {
    var temp = file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(value) + '\n');
    fs.renameSync(temp, file);
}
function sq(v) { if (!/^[A-Za-z0-9_.\/-]+$/.test(v)) throw fail('Unsafe path'); return "'" + v + "'"; }

// The TV's UEP refuses to run a shell script FILE that is not signed ("the file is NOT signed"), but runs text given to
// `sh -c`. So nothing is ever written to disk and executed: detached jobs are passed inline, as base64 to keep quoting simple.
function detached(script) {
    return 'setsid sh -c "$(echo ' + Buffer.from(script, 'utf8').toString('base64') + ' | base64 -d)" >/dev/null 2>&1 </dev/null &';
}

// Reads and checks a bundle without touching the disk. Returns { manifest, files: { path: Buffer }, sha256 }.
function verifyBundle(raw, publicKey) {
    if (!publicKey) throw fail('This build has no update signing key, so it cannot be updated from here', 'no-key');
    var b;
    try { b = JSON.parse(raw); } catch (e) { throw fail('Not an update bundle (invalid JSON)'); }
    if (!b || b.format !== FORMAT || b.v !== 1 || typeof b.manifest !== 'string' || typeof b.signature !== 'string' || !b.files || typeof b.files !== 'object') {
        throw fail('Not an update bundle');
    }
    var signed;
    try {
        var v = crypto.createVerify('RSA-SHA256');
        v.update(b.manifest);
        signed = v.verify(publicKey, b.signature, 'base64');
    } catch (e) { signed = false; }
    if (!signed) throw fail('The update is not signed by the Vetro release key', 'bad-signature');
    var m;
    try { m = JSON.parse(b.manifest); } catch (e) { throw fail('Invalid manifest'); }
    if (!m || m.format !== FORMAT || m.v !== 1 || !VERSION.test(m.version) || !(m.shell >= 1) || !m.files || typeof m.files !== 'object') throw fail('Invalid manifest');
    var names = Object.keys(m.files);
    if (!names.length || names.length > MAX_FILES) throw fail('Invalid manifest: file count');
    var files = {}, total = 0;
    names.forEach(function (n) {
        if (!okPath(n)) throw fail('Path not allowed in an update: ' + n);
        var meta = m.files[n], text = b.files[n];
        if (!meta || !/^[0-9a-f]{64}$/.test(meta.sha256) || typeof text !== 'string') throw fail('File missing from the update: ' + n);
        var buf = Buffer.from(text, 'base64');
        total += buf.length;
        if (total > MAX_BYTES) throw fail('The update is too large');
        if (buf.length !== meta.size || sha256(buf) !== meta.sha256) throw fail('File does not match the signed manifest: ' + n, 'bad-hash');
        files[n] = buf;
    });
    Object.keys(b.files).forEach(function (n) { if (!m.files[n]) throw fail('File not listed in the signed manifest: ' + n); });
    return { manifest: m, files: files };
}

// build-info.js is a small generated module: module.exports = {...};
function parseBuildInfo(buf) {
    var m = /module\.exports = (\{[\s\S]*\});\s*$/.exec(buf.toString('utf8'));
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch (e) { return null; }
}
function renderBuildInfo(info) {
    return Buffer.from("'use strict';\nmodule.exports = " + JSON.stringify(info) + ';\n');
}

function Updater(opts) {
    this.publicKey = opts.publicKey || null;
    this.installDir = opts.installDir;
    this.workDir = opts.workDir;
    this.buildInfo = opts.buildInfo || {};
    this.execute = opts.execute;
    // Where the dashboard looks for update-index.json and the bundle it names (a folder URL ending in /).
    this.source = opts.source || null;
    // Shell text that stops the launcher (dock). Used when an update that changed the launcher's files is put back:
    // the dock is a separate process that keeps running the old binary until it is stopped, then the service starts it again.
    this.dockStopCommand = opts.dockStopCommand || null;
    // Measured on the Q80A: killing the service is enough, the platform starts it again within about 3 seconds.
    // The second part only matters if that did not happen (auto-restart flag off).
    this.restartCommand = opts.restartCommand ||
        ('app_launcher -k ' + SERVICE_ID + ' >/dev/null 2>&1; sleep 8; app_launcher -S 2>/dev/null | grep -q "' + SERVICE_ID + ' (" || app_launcher -s ' + SERVICE_ID + ' >/dev/null 2>&1');
    this.waitSteps = Math.max(1, Math.ceil((opts.waitSeconds || WAIT_SECONDS) / 2));
    this.busy = false;
    if (!DIR.test(this.installDir || '') || !DIR.test(this.workDir || '')) throw fail('Unsafe update folders');
}

Updater.prototype._file = function (n) { return path.join(this.workDir, n); };
Updater.prototype.status = function () {
    return {
        configured: !!this.publicKey,
        source: this.source,
        version: this.buildInfo.version || null,
        shell: this.buildInfo.shell || 1,
        busy: this.busy,
        pending: readJson(this._file('pending.json')),
        last: readJson(this._file('result.json')),
        canRollBack: !!readJson(this._file('backup.json'))
    };
};

// What a bundle would change here, without applying it.
Updater.prototype.check = function (raw, expectedSha256) {
    var parsed = this._read(raw, expectedSha256);
    return { ok: true, from: this.buildInfo.version, to: parsed.manifest.version, newer: parsed.newer, changed: parsed.changed.length };
};

Updater.prototype._read = function (raw, expectedSha256) {
    if (expectedSha256 && String(expectedSha256).toLowerCase() !== sha256(Buffer.from(raw, 'utf8'))) throw fail('SHA-256 does not match the expected value');
    var parsed = verifyBundle(raw, this.publicKey), m = parsed.manifest;
    var order = compare(m.version, this.buildInfo.version || '0.0.0');
    if (order === null) throw fail('Unknown version format');
    if (m.shell > (this.buildInfo.shell || 1)) throw fail('This version changes the package itself (permissions or service settings): install it again with Apps2Samsung', 'needs-reinstall');
    parsed.newer = order > 0;
    parsed.files = this._adapt(parsed.files);
    var dir = this.installDir;
    parsed.changed = Object.keys(parsed.files).filter(function (n) {
        try { return sha256(fs.readFileSync(path.join(dir, n))) !== sha256(parsed.files[n]); } catch (e) { return true; }
    }).sort();
    return parsed;
};

// What is specific to this installation survives the update: a port chosen at install time.
Updater.prototype._adapt = function (files) {
    var port = this.buildInfo.port, out = {};
    Object.keys(files).forEach(function (n) { out[n] = files[n]; });
    if (port && port !== 8099) {
        if (out['index.html']) out['index.html'] = Buffer.from(out['index.html'].toString('utf8').replace(/\b8099\b/g, String(port)));
        var info = out['service/build-info.js'] && parseBuildInfo(out['service/build-info.js']);
        if (info) { info.port = port; out['service/build-info.js'] = renderBuildInfo(info); }
    }
    return out;
};

Updater.prototype.apply = function (raw, expectedSha256) {
    var self = this;
    if (this.busy) return Promise.reject(fail('An update is already in progress', 'busy'));
    var parsed;
    try {
        parsed = this._read(raw, expectedSha256);
        if (!parsed.newer) throw fail('This version is not newer than the installed one', 'not-newer');
    } catch (e) { return Promise.reject(e); }
    if (!parsed.changed.length) return Promise.resolve({ ok: true, changed: 0, note: 'Nothing to change' });
    this.busy = true;
    var from = this.buildInfo.version, to = parsed.manifest.version, changed = parsed.changed;
    var dock = changed.some(function (n) { return /^native\/dock\//.test(n); });
    return Promise.resolve().then(function () {
        var staging = self._file('staging');
        rmrf(staging);
        mkdirp(staging);
        changed.forEach(function (n) {
            mkdirp(path.dirname(path.join(staging, n)));
            fs.writeFileSync(path.join(staging, n), parsed.files[n]);
        });
        var existing = changed.filter(function (n) { return fs.existsSync(path.join(self.installDir, n)); });
        var added = changed.filter(function (n) { return existing.indexOf(n) < 0; });
        writeJson(self._file('backup.json'), { from: from, to: to, files: existing, added: added, dock: dock });
        var hashes = {};
        changed.forEach(function (n) { hashes[n] = sha256(parsed.files[n]); });
        return self.execute(self._applyScript(from, to, changed, existing, added, hashes, dock), 120000);
    }).then(function (r) {
        if (!r || r.exit_code || r.timed_out) throw fail('The files could not be replaced' + (r && r.stderr ? ': ' + String(r.stderr).trim().slice(0, 200) : ''), 'apply-failed');
        return { ok: true, from: from, to: to, changed: changed.length, restarting: true,
            note: 'Vetro restarts in a few seconds; if the new version does not start it is put back automatically' };
    }).then(function (res) { self.busy = false; return res; }, function (e) { self.busy = false; throw e; });
};

// Everything the root shell needs is inline: it never reads a list from the work folder. Staged files are checked
// against the hashes of the verified bundle just before they are copied.
Updater.prototype._applyScript = function (from, to, changed, existing, added, hashes, dock) {
    var I = sq(this.installDir), W = sq(this.workDir);
    var lines = ['set -e', 'I=' + I, 'W=' + W, 'S="$W/staging"', 'B="$W/backup"',
        'rm -rf "$B"; mkdir -p "$B"; rm -f "$W"/ok-* "$W/pending.json"'];
    changed.forEach(function (n) {
        lines.push('[ "$(sha256sum "$S/' + n + '" | cut -d" " -f1)" = "' + hashes[n] + '" ] || { echo "staged file changed: ' + n + '" >&2; exit 3; }');
    });
    existing.forEach(function (n) { lines.push('mkdir -p "$B/' + path.dirname(n) + '"; cp -p "$I/' + n + '" "$B/' + n + '"'); });
    changed.forEach(function (n) {
        lines.push('mkdir -p "$I/' + path.dirname(n) + '"; cp "$S/' + n + '" "$I/' + n + '.vnew" && chmod 644 "$I/' + n + '.vnew" && mv -f "$I/' + n + '.vnew" "$I/' + n + '"');
    });
    lines.push("echo '" + JSON.stringify({ from: from, to: to, dock: dock, at: Date.now() }) + "' > \"$W/pending.json\"");
    lines.push(detached(this._watchdog(to, existing, added, dock)), detached('sleep 3; ' + this.restartCommand), 'exit 0');
    return lines.join('\n') + '\n';
};

// Waits for the new version to confirm itself (confirm() below); otherwise puts the old files back and restarts.
Updater.prototype._watchdog = function (to, existing, added, dock) {
    var lines = ['#!/bin/sh', 'I=' + sq(this.installDir), 'W=' + sq(this.workDir), 'B="$W/backup"', 'i=0',
        'while [ "$i" -lt ' + this.waitSteps + ' ]; do', '  [ -f "$W/ok-' + to + '" ] && exit 0', '  sleep 2; i=$((i+1))', 'done'];
    lines.push.apply(lines, this._restoreLines(existing, added));
    if (dock && this.dockStopCommand) lines.push(this.dockStopCommand);
    lines.push('echo rolled-back > "$W/rolled-back"', this.restartCommand);
    return lines.join('\n');
};
Updater.prototype._restoreLines = function (existing, added) {
    var lines = [];
    existing.forEach(function (n) { lines.push('cp -p "$B/' + n + '" "$I/' + n + '.vnew" && mv -f "$I/' + n + '.vnew" "$I/' + n + '"'); });
    added.forEach(function (n) { lines.push('rm -f "$I/' + n + '"'); });
    return lines;
};

// Manual way back to the files saved before the last update.
Updater.prototype.rollback = function () {
    var meta = readJson(this._file('backup.json'));
    if (!meta || !Array.isArray(meta.files) || !Array.isArray(meta.added)) return Promise.reject(fail('There is no previous version to go back to', 'no-backup'));
    if (!meta.files.concat(meta.added).every(okPath)) return Promise.reject(fail('The saved list is not valid', 'bad-backup'));
    if (this.busy) return Promise.reject(fail('An update is already in progress', 'busy'));
    var self = this;
    this.busy = true;
    var lines = ['set -e', 'I=' + sq(this.installDir), 'W=' + sq(this.workDir), 'B="$W/backup"', 'rm -f "$W"/ok-* "$W/pending.json"']
        .concat(this._restoreLines(meta.files, meta.added));
    if (meta.dock === true && this.dockStopCommand) lines.push(this.dockStopCommand);
    lines.push("echo '" + JSON.stringify({ state: 'rolled-back', from: meta.to, to: meta.from, at: Date.now() }) + "' > \"$W/result.json\"",
        detached('sleep 3; ' + this.restartCommand), 'exit 0');
    return this.execute(lines.join('\n') + '\n', 60000).then(function (r) {
        if (!r || r.exit_code || r.timed_out) throw fail('The previous files could not be put back', 'rollback-failed');
        return { ok: true, from: meta.to, to: meta.from, restarting: true };
    }).then(function (res) { self.busy = false; return res; }, function (e) { self.busy = false; throw e; });
};

// Called once after every start, when the root agent has connected: the new version is up and in charge.
// Without this the watchdog started by apply() puts the old version back.
Updater.prototype.confirm = function (extra) {
    var pending = readJson(this._file('pending.json'));
    if (!pending) return null;
    var now = this.buildInfo.version, result;
    if (pending.to === now) {
        try { fs.writeFileSync(this._file('ok-' + now), String(Date.now()) + '\n'); } catch (e) { return null; }
        result = { state: 'updated', from: pending.from, to: now, at: Date.now() };
        if (extra) result.dock = extra;
        try { rmrf(this._file('staging')); } catch (e) { /* kept for the next update */ }
    } else {
        result = { state: 'rolled-back', from: pending.to, to: now, at: Date.now() };
    }
    try { writeJson(this._file('result.json'), result); fs.unlinkSync(this._file('pending.json')); } catch (e) { /* reported next time */ }
    return result;
};

// What a new version does once it is up: the launcher is a separate process, so if the update changed its files it is
// restarted here (restartDock() resolves 'restarted' or 'off', or rejects if it will not start). Only then does the
// version confirm itself. A launcher that will not start leaves it unconfirmed and the watchdog puts everything back,
// the launcher's files included.
Updater.prototype.finish = function (restartDock) {
    var self = this, pending = readJson(this._file('pending.json'));
    if (!pending) return Promise.resolve(null);
    if (pending.to !== this.buildInfo.version || pending.dock !== true || typeof restartDock !== 'function') return Promise.resolve(this.confirm());
    return Promise.resolve().then(restartDock).then(function (how) {
        return self.confirm(how || 'restarted');
    }, function (e) {
        self.lastDockError = e && e.message || String(e);
        return null;
    });
};

module.exports = { Updater: Updater, verifyBundle: verifyBundle, compare: compare, okPath: okPath, sha256: sha256,
    parseBuildInfo: parseBuildInfo, ALLOWED: ALLOWED, FORMAT: FORMAT };
