'use strict';

// Home app order: the ordered list stored in the CoBA ".appLayerCache" file
// under the csfs data dir (or the home.media one on TVs with the new Home). Each line is a section item:
//   s/livetv@<source>        live TV source (TV Plus, RF, ...)
//   d/webapp@<packageId|storeId>  web application
// The file shape is: <version>\n<entries...>\nEOFC OBA\n (some firmwares: EOFCOBA). The Home reads it to
// order the app row; reordering = rewriting the entries. A backup is kept and
// restore() puts it back. Applying a change needs the Home/CoBA host to reload.

var BASE = '/opt/usr/home/owner/apps_rw/com.samsung.tv.csfs/data';
var BASE_NEW_HOME = '/opt/usr/home/owner/apps_rw/com.samsung.tv.home.media/data';
// Shell prelude: D is the first data dir that holds a cache file, the csfs one when neither does.
var PICK_DIR = 'D=' + BASE + '\nfor c in ' + BASE + ' ' + BASE_NEW_HOME + '; do if [ -f "$c/.appLayerCache.1" ] || [ -f "$c/.appLayerCache.2" ]; then D=$c; break; fi; done\n';
var FILES = ['.appLayerCache.1', '.appLayerCache.2'];
var TERM = 'EOFC OBA';
// Some firmwares (e.g. T-PTMDDEUC-1400.1) write the terminator without the space.
var TERMS = ['EOFC OBA', 'EOFCOBA'];
var MAX = 300;
// Type part: letters, digits, "_" and "." (physical inputs use e.g. "source.layer.hdmi").
var ENTRY = /^[sd]\/[A-Za-z0-9_.]+@[^\s]+$/;

function wrap(script) { return 'echo ' + Buffer.from(script).toString('base64') + ' | base64 -d | sh'; }
function check(r) { if (r.exit_code || r.timed_out) throw Error(r.stderr || r.stdout || 'Home order unavailable'); return r.stdout || ''; }

function parse(text) {
    var lines = String(text || '').replace(/\r/g, '').split('\n');
    if (lines.length < 3) throw Error('Unrecognized Home order');
    var end = lines.findIndex(function (l) { return TERMS.indexOf(l.trim()) >= 0; });
    if (end < 0) throw Error('Home order terminator missing');
    var version = lines[0].trim();
    if (!/^\d+$/.test(version)) throw Error('Unrecognized Home order version');
    var entries = lines.slice(1, end).map(function (l) { return l.trim(); }).filter(Boolean);
    if (entries.length > MAX) throw Error('Too many Home order entries');
    validate(entries);
    return { version: version, entries: entries, term: lines[end].trim() };
}

function validate(entries) {
    if (!Array.isArray(entries) || entries.length > MAX) throw Error('Invalid order');
    entries.forEach(function (e) { if (!ENTRY.test(e)) throw Error('Invalid Home order entry: ' + e); });
}

function render(order) {
    validate(order.entries);
    return order.version + '\n' + order.entries.join('\n') + '\n' + (TERMS.indexOf(order.term) >= 0 ? order.term : TERM) + '\n';
}

function sameSet(a, b) {
    if (a.length !== b.length) return false;
    var x = a.slice().sort().join('\n'), y = b.slice().sort().join('\n');
    return x === y;
}

function Order(execute) { this.execute = execute; this.busy = false; }

Order.prototype.read = function () {
    var script = PICK_DIR + 'cat "$D/' + FILES[0] + '" 2>/dev/null || cat "$D/' + FILES[1] + '" 2>/dev/null';
    return this.execute(wrap(script), 8000).then(function (r) {
        var order = parse(check(r));
        order.file = null; // Fallback read does not identify the selected cache.
        return order;
    });
};

// entries must be a permutation of the current ones (reorder only, no add/remove).
Order.prototype.write = function (entries) {
    var self = this;
    if (this.busy) return Promise.reject(Error('Home order change already in progress'));
    this.busy = true;
    return this.read().then(function (cur) {
        validate(entries);
        if (!sameSet(cur.entries, entries)) throw Error('Entries must be unchanged, only reordered');
        var payload = Buffer.from(render({ version: cur.version, entries: entries, term: cur.term })).toString('base64');
        var script = transactionScript(payload, false);
        self.transactionStarted = true;
        return self.execute(wrap(script), 10000).then(function (r) {
            check(r);
            return self.read();
        }).then(function (o) { if (JSON.stringify(o.entries)!==JSON.stringify(entries)) throw Error('Written order not confirmed by readback'); o.saved = true; return o; });
    }).catch(function (e) {
        if (!self.transactionStarted) throw e;
        return self.execute(wrap(rollbackScript()), 10000).then(function (r) { check(r); throw Error(e.message + ' · previous caches restored'); }, function (restoreError) { throw Error(e.message + ' · restore failed: ' + restoreError.message); });
    }).finally(function () { self.busy = false; self.transactionStarted = false; });
};

function rollbackScript() {
    return 'set -e\n' + PICK_DIR + 'for f in ' + FILES.join(' ') + '; do if [ -f "$D/$f.vetro-txn" ]; then cp -p "$D/$f.vetro-txn" "$D/$f.vetro-tmp"; mv -f "$D/$f.vetro-tmp" "$D/$f"; elif [ -f "$D/$f.vetro-missing" ]; then rm -f "$D/$f"; fi; done';
}
function transactionScript(payload, restoring) {
    var prepare = 'set -e\n' + PICK_DIR + 'for f in ' + FILES.join(' ') + '; do rm -f "$D/$f.vetro-txn" "$D/$f.vetro-missing"; if [ -f "$D/$f" ]; then cp -p "$D/$f" "$D/$f.vetro-txn"; [ -f "$D/$f.vetro-bak" ] || cp -p "$D/$f" "$D/$f.vetro-bak"; else touch "$D/$f.vetro-missing"; fi; done\n';
    if (restoring) prepare += 'for f in ' + FILES.join(' ') + '; do [ -f "$D/$f.vetro-bak" ] || { echo "Backup Home incompleto" >&2; exit 1; }; done\n';
    var fill = restoring ? 'cp -p "$D/$f.vetro-bak" "$D/$f.vetro-tmp"' : 'if [ -f "$D/$f" ]; then cp -p "$D/$f" "$D/$f.vetro-tmp"; else touch "$D/$f.vetro-tmp"; fi; echo ' + payload + ' | base64 -d > "$D/$f.vetro-tmp"';
    return prepare + 'committed=0\ntrap \'if [ "$committed" != 1 ]; then for f in ' + FILES.join(' ') + '; do if [ -f "$D/$f.vetro-txn" ]; then cp -p "$D/$f.vetro-txn" "$D/$f"; elif [ -f "$D/$f.vetro-missing" ]; then rm -f "$D/$f"; fi; done; fi\' EXIT\nfor f in ' + FILES.join(' ') + '; do ' + fill + '; done\nfor f in ' + FILES.join(' ') + '; do mv -f "$D/$f.vetro-tmp" "$D/$f"; done\ncommitted=1\necho OK';
}
Order.prototype.restore = function () {
    var self = this;
    if (this.busy) return Promise.reject(Error('Home order change already in progress'));
    this.busy = true;
    return this.execute(wrap(transactionScript(null, true)), 10000).then(function (r) { check(r); return self.read(); }).finally(function () { self.busy = false; });
};

module.exports = { transactionScript: transactionScript, rollbackScript: rollbackScript, Order: Order, parse: parse, render: render, validate: validate, BASE: BASE, FILES: FILES, TERM: TERM };
