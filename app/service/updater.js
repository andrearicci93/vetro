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
// Regular expressions compiled once at module load, not on every call.
var SAFE_PATH_RE = /^[A-Za-z0-9_.\/-]+$/;
var SHA256_RE = /^[0-9a-f]{64}$/;
var BUILD_INFO_RE = /module\.exports = (\{[\s\S]*\});\s*$/;
var DEFAULT_PORT_RE = /\b8099\b/g;
// The launcher and the tuner are separate processes that keep running the old binary until stopped; a change to either one restarts the native parts.
var DOCK_PATH_RE = /^native\/(?:dock|tuner)\//;

var FORMAT = 'vetro-update';
var MAX_FILES = 300;
var MAX_BYTES = 12 * 1024 * 1024;
var WAIT_SECONDS = 240;    // the watchdog waits this long for the new version to confirm itself
// Only these paths can be replaced. config.xml, signatures and anything else of the package stay as installed.
// payload/ takes subfolders (payload/net6) since 0.7.0; 0.5.x refuses them, so release.cjs keeps them out for now (#226).
var ALLOWED = /^(?:service\/[A-Za-z0-9_.-]+\.js|native\/[A-Za-z0-9_.\/-]+|payload\/[A-Za-z0-9_.\/-]+|index\.html|icon\.png)$/;
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
function sq(v) { if (!SAFE_PATH_RE.test(v)) throw fail('Unsafe path'); return "'" + v + "'"; }

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
        v.update(b.manifest, 'utf8');
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
        if (!meta || !SHA256_RE.test(meta.sha256) || typeof text !== 'string') throw fail('File missing from the update: ' + n);
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
    var m = BUILD_INFO_RE.exec(buf.toString('utf8'));
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
        canRollBack: this._backupFits(readJson(this._file('backup.json')))
    };
};
// The saved files belong to one update: from one version to another. After Vetro is installed again with another version
// (the update folder outlives an install), putting them back would lay an older version's files over the new package and
// delete files it needs, with no watchdog behind it. So a backup counts only while this version is one of its two ends.
Updater.prototype._backupFits = function (meta) {
    if (!meta) return false;
    var v = this.buildInfo.version;
    return !v || typeof meta.from !== 'string' || typeof meta.to !== 'string' || meta.from === v || meta.to === v;
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

// The port the package was installed for, read from its config.xml (the access origin of the TV page). Apps2Samsung writes
// a chosen port into the package's files but not into build-info.js, and a self-update never replaces config.xml: it is
// the one place that still names the port after the service's files were swapped for ones built for 8099. Null when the
// file says 8099 or cannot be understood.
var ACCESS_PORT_RE = /<access\s+origin="http:\/\/127\.0\.0\.1:(\d{4,5})"/;
function packagePort(configXml) {
    var m = ACCESS_PORT_RE.exec(String(configXml || '')), port = m ? Number(m[1]) : 0;
    return port >= 1024 && port <= 65535 && port !== 8099 && port !== 8001 && port !== 8002 ? port : null;
}

// What is specific to this installation survives the update: a port chosen at install time.
Updater.prototype._adapt = function (files) {
    var port = this.buildInfo.port, out = {};
    Object.keys(files).forEach(function (n) { out[n] = files[n]; });
    if (port && port !== 8099) {
        if (out['index.html']) out['index.html'] = Buffer.from(out['index.html'].toString('utf8').replace(DEFAULT_PORT_RE, String(port)));
        var info = out['service/build-info.js'] && parseBuildInfo(out['service/build-info.js']);
        if (info) { info.port = port; out['service/build-info.js'] = renderBuildInfo(info); }
    }
    return out;
};

// An update that was applied but has not confirmed itself yet (or been rolled back by the watchdog) owns the staging
// folder, the backup and the pending record. A second apply would overwrite the backup of the ORIGINAL files with the
// first update's files. The record lives on disk, so this also holds after a service restart; it stops counting once
// the watchdog's waiting time (plus a margin) has passed, so a record left behind by a dead watchdog cannot block
// updates forever. rollback() stays allowed: it is the way out of this state.
Updater.prototype._pendingUpdate = function () {
    var pending = readJson(this._file('pending.json'));
    if (!pending) return null;
    var at = typeof pending.at === 'number' ? pending.at : 0;
    return Date.now() - at < this.waitSteps * 2000 + 60000 ? pending : null;
};

Updater.prototype.apply = function (raw, expectedSha256) {
    var self = this;
    if (this.busy) return Promise.reject(fail('An update is already in progress', 'busy'));
    if (this._pendingUpdate()) return Promise.reject(fail('The previous update is still waiting for its confirmation. Wait for Vetro to restart, or go back to the previous version', 'pending'));
    var parsed;
    try {
        parsed = this._read(raw, expectedSha256);
        if (!parsed.newer) throw fail('This version is not newer than the installed one', 'not-newer');
    } catch (e) { return Promise.reject(e); }
    if (!parsed.changed.length) return Promise.resolve({ ok: true, changed: 0, note: 'Nothing to change' });
    this.busy = true;
    var from = this.buildInfo.version, to = parsed.manifest.version, changed = parsed.changed;
    var dock = changed.some(function (n) { return DOCK_PATH_RE.test(n); });
    return Promise.resolve().then(function () {
        // The script is built first: if it cannot be (an unsafe path), nothing is staged or saved.
        var existing = changed.filter(function (n) { return fs.existsSync(path.join(self.installDir, n)); });
        var added = changed.filter(function (n) { return existing.indexOf(n) < 0; });
        var hashes = {};
        changed.forEach(function (n) { hashes[n] = sha256(parsed.files[n]); });
        var script = self._applyScript(from, to, changed, existing, added, hashes, dock);
        var staging = self._file('staging');
        rmrf(staging);
        mkdirp(staging);
        changed.forEach(function (n) {
            mkdirp(path.dirname(path.join(staging, n)));
            fs.writeFileSync(path.join(staging, n), parsed.files[n]);
        });
        writeJson(self._file('backup.json.next'), { from: from, to: to, files: existing, added: added, dock: dock });
        return self.execute(script, 120000);
    }).then(function (r) {
        if (!r || r.exit_code !== 0 || r.timed_out) throw fail('The files could not be replaced' + (r && r.stderr ? ': ' + String(r.stderr).trim().slice(0, 200) : ''), 'apply-failed');
        return { ok: true, from: from, to: to, changed: changed.length, restarting: true,
            note: 'Vetro restarts in a few seconds; if the new version does not start it is put back automatically' };
    }).then(function (res) { self.busy = false; return res; }, function (e) { self.busy = false; throw e; });
};

// Everything the root shell needs is inline: it never reads a list from the work folder. Staged files are checked
// against the hashes of the verified bundle just before they are copied.
// The list of files is written once, as a shell variable, and each step is a loop over its words (`set -- $L`, see overList:
// no pipe, whose loop would run in a subshell that an `exit` only leaves, and no here-document, which bash writes to a
// temporary file that the TV might not let the root shell create). The root agent takes 64 KiB per command; 0.7.0 repeated each
// path about ten times (about 1 KB per changed file), this costs about 150 bytes per file, so a bundle of MAX_FILES fits
// (rooting/tests/update-size.test.cjs measures both).
// What the script leaves on disk (backup/, backup.json, pending.json, ok-*, rolled-back) is the same as 0.7.0's: the
// watchdog of a 0.7.0 that installs this version, and a Go back from here over an update 0.7.0 applied, both rely on it.
// Every name passed the bundle's okPath and every hash is hex, so nothing in the lists needs quoting or can expand.
Updater.prototype._applyScript = function (from, to, changed, existing, added, hashes, dock) {
    var I = sq(this.installDir), W = sq(this.workDir);
    // One line per changed file: hash, e (it exists here and is saved first) or a (added), its path. The folder is taken
    // from the path in the loop (FOLDER), which needs no dirname binary.
    var list = changed.map(function (n) {
        if (!SHA256_RE.test(hashes[n] || '')) throw fail('Bad hash for ' + n);
        return hashes[n] + ' ' + (existing.indexOf(n) >= 0 ? 'e' : 'a') + ' ' + listName(n);
    });
    var lines = ['set -e', 'I=' + I, 'W=' + W, 'S="$W/staging"', 'B="$W/backup"',
        'rm -rf "$B"; mkdir -p "$B"; rm -f "$W"/ok-* "$W/pending.json" "$W/backup.json"',
        "L='" + list.join('\n') + "'"];
    lines.push.apply(lines, overList('L', ['h', 'k', 'n'], [
        '[ "$(sha256sum "$S/$n" | cut -d" " -f1)" = "$h" ] || { echo "staged file changed: $n" >&2; exit 3; }']));
    lines.push.apply(lines, overList('L', ['h', 'k', 'n'], ['[ "$k" = e ] || continue', FOLDER, 'mkdir -p "$B/$d"; cp -p "$I/$n" "$B/$n"']));
    // The list of what Go back restores appears only now, with the backup it names: a script that never ran (the TV busy, the agent
    // gone) or stopped before this line leaves no list, so Go back is not offered over files of an older update.
    lines.push('mv -f "$W/backup.json.next" "$W/backup.json"');
    // If a copy fails half way (disk full, a read-only folder) the files already replaced are put back at once, because no
    // watchdog exists yet at this point and a mix of old and new files would otherwise stay until the next restart. The loop
    // stops at the first failure and the undo puts back every saved file and removes every added one and every .vnew; each
    // undo step ends in `|| :` so that one failure there cannot stop the others under `set -e`.
    lines.push('f=0');
    lines.push.apply(lines, overList('L', ['h', 'k', 'n'], [
        FOLDER,
        'mkdir -p "$I/$d" && cp "$S/$n" "$I/$n.vnew" && chmod 644 "$I/$n.vnew" && mv -f "$I/$n.vnew" "$I/$n" || { f=1; break; }']));
    lines.push('if [ "$f" = 1 ]; then');
    lines.push.apply(lines, overList('L', ['h', 'k', 'n'], [
        'if [ "$k" = e ]; then cp -p "$B/$n" "$I/$n.vnew" && mv -f "$I/$n.vnew" "$I/$n" || :; else rm -f "$I/$n" || :; fi',
        'rm -f "$I/$n.vnew" || :']));
    lines.push('echo "copy failed: the previous files were put back" >&2; exit 4', 'fi');
    lines.push("echo '" + JSON.stringify({ from: from, to: to, dock: dock, at: Date.now() }) + "' > \"$W/pending.json\"");
    lines.push(detached(this._watchdog(to, existing, added, dock)), detached('sleep 3; ' + this.restartCommand), 'exit 0');
    return lines.join('\n') + '\n';
};

// A name for a list line: the same characters sq() allows, so it splits on spaces and expands to nothing.
function listName(n) { if (!SAFE_PATH_RE.test(n)) throw fail('Unsafe path'); return n; }
// The folder of $n in $d ("." for a file at the top, as path.dirname gives).
var FOLDER = 'case "$n" in */*) d="${n%/*}" ;; *) d=. ;; esac';
// A loop over the list in variable `name`, taken as words (`set -f`: no globbing; every word is a hex hash, a one-letter
// flag or a safe path, so the default IFS splits it exactly), `vars.length` words at a time, with `body` lines inside.
// `continue`, `break` and `exit` work as in any loop: it runs in the script's own shell.
function overList(name, vars, body) {
    var take = vars.map(function (v, i) { return v + '=$' + (i + 1); }).join(' ') + '; shift ' + vars.length;
    return ['set -f; set -- $' + name, 'while [ $# -ge ' + vars.length + ' ]; do', '  ' + take]
        .concat(body.map(function (l) { return '  ' + l; }), ['done']);
}

// Waits for the new version to confirm itself (confirm() below); otherwise puts the old files back and restarts.
Updater.prototype._watchdog = function (to, existing, added, dock) {
    var lines = ['#!/bin/sh', 'I=' + sq(this.installDir), 'W=' + sq(this.workDir), 'B="$W/backup"', 'i=0',
        'while [ "$i" -lt ' + this.waitSteps + ' ]; do', '  [ -f "$W/ok-' + to + '" ] && exit 0', '  sleep 2; i=$((i+1))', 'done',
        // One last look after the final sleep: a confirm written in the last two seconds must not be rolled back.
        '[ -f "$W/ok-' + to + '" ] && exit 0'];
    lines.push.apply(lines, this._restoreLines(existing, added));
    if (dock && this.dockStopCommand) lines.push(this.dockStopCommand);
    lines.push('echo rolled-back > "$W/rolled-back"', this.restartCommand);
    return lines.join('\n');
};
// Puts back the saved files ($B) over the installed ones ($I) and removes the added ones, in a loop over one list (e = saved,
// a = added). It behaves as 0.7.0's `cp && mv` line per file did: under the Go back's `set -e` a failed copy is passed over
// and a failed move stops the script (the `if` keeps a failed copy of the LAST file from failing the whole loop).
Updater.prototype._restoreLines = function (existing, added) {
    var list = existing.map(function (n) { return 'e ' + listName(n); }).concat(added.map(function (n) { return 'a ' + listName(n); }));
    return ["R='" + list.join('\n') + "'"].concat(overList('R', ['k', 'n'], [
        'case "$k" in',
        '    e) if cp -p "$B/$n" "$I/$n.vnew"; then mv -f "$I/$n.vnew" "$I/$n"; fi ;;',
        '    a) rm -f "$I/$n" ;;',
        'esac']));
};

// The script of the manual Go back (rollback below), from the saved list.
Updater.prototype._rollbackScript = function (meta) {
    var lines = ['set -e', 'I=' + sq(this.installDir), 'W=' + sq(this.workDir), 'B="$W/backup"', 'rm -f "$W"/ok-* "$W/pending.json"']
        .concat(this._restoreLines(meta.files, meta.added));
    // The launcher's and tuner's stop lines must not end Go back: under `set -e` one failed step (systemctl reset-failed on their
    // transient unit, which is gone once stopped, exits 1) left the files put back but no result written and no restart (seen on a
    // Q80A, 2026-11-22). In an `||` list `set -e` does not apply, so the stop is best effort, as in the watchdog.
    if (meta.dock === true && this.dockStopCommand) lines.push('{', this.dockStopCommand, '} || true');
    lines.push("echo '" + JSON.stringify({ state: 'rolled-back', from: meta.to, to: meta.from, at: Date.now() }) + "' > \"$W/result.json\"",
        detached('sleep 3; ' + this.restartCommand), 'exit 0');
    return lines.join('\n') + '\n';
};

// Manual way back to the files saved before the last update.
Updater.prototype.rollback = function () {
    var meta = readJson(this._file('backup.json'));
    if (!meta || !Array.isArray(meta.files) || !Array.isArray(meta.added)) return Promise.reject(fail('There is no previous version to go back to', 'no-backup'));
    if (!meta.files.concat(meta.added).every(okPath)) return Promise.reject(fail('The saved list is not valid', 'bad-backup'));
    if (!this._backupFits(meta)) return Promise.reject(fail('The saved files are from another version of Vetro (' + meta.from + ' to ' + meta.to + '), not from this one', 'other-backup'));
    if (this.busy) return Promise.reject(fail('An update is already in progress', 'busy'));
    var self = this;
    var script;
    try { script = this._rollbackScript(meta); } catch (e) { return Promise.reject(e); }
    this.busy = true;
    return this.execute(script, 60000).then(function (r) {
        if (!r || r.exit_code !== 0 || r.timed_out) throw fail('The previous files could not be put back', 'rollback-failed');
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

module.exports = { Updater: Updater, packagePort: packagePort, verifyBundle: verifyBundle, compare: compare, okPath: okPath, sha256: sha256,
    parseBuildInfo: parseBuildInfo, ALLOWED: ALLOWED, FORMAT: FORMAT };
