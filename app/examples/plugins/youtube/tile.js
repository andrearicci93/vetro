'use strict';
// Makes Samsung's YouTube button (Home tile, remote key, voice, casting) open the patched app.
//
// All of them start the wrapper app 9Ur5IzDKqV.TizenYouTube, which starts the YouTube app with the flags kept in one row of the
// web app service's database (/opt/dbspace/.webappservice.db, table widgetinfo, column reserved_string_6; the same text is also
// in the app's config.xml and in the package database, but neither is read when the app starts - checked on a Q80A, fw 2310.0).
// This module appends the proxy and content flags to that column and takes them off again. The change is a suffix, so undoing it needs no saved copy: it cuts the suffix off.
//
// Safety rules, in order of importance:
//  - The proxy list ends in direct://: with the proxy down YouTube still opens, just unpatched.
//  - A write is a compare-and-swap (it only happens if the row still holds the value that was read), so a change made by
//    Samsung or by someone else in between is never overwritten.
//  - Only that one row of that one app is touched, and only when it holds a plain printable value without quotes.
//  - Whoever calls apply() decides when the row may be patched (proxy listening, certificate and script ready); this module
//    only knows how.

var setup = require('./setup.js');

var DB = '/opt/dbspace/.webappservice.db';
var WRAPPER = '9Ur5IzDKqV.TizenYouTube';      // the row's tizen_id
var COLUMN = 'reserved_string_6';
var ORIGINAL_START = '--base_url=https://www.youtube.com/tv';      // what Samsung's value starts with: anything else is not ours to edit
// The most characters the TV passes on to the YouTube app from this value (checked on a Q80A: it cuts at 127, silently, so a longer
// value loses its last flags and the app starts without --content, and without trusting the plugin's certificate).
var MAX_VALUE = 127;

// Samsung's own value already has ORIGINAL_START, which is also what the app does without it (its default address), so there is no
// room for both that and our flags. Patching takes ORIGINAL_START out and appends ours; un-patching takes ours out and puts
// ORIGINAL_START back in front. Nothing is saved: the one string that is removed is a constant.

// Our two flags wherever they sit in the value (a firmware that appends its own flag after them must not hide them).
var OURS = '--content=' + setup.CONTENT;
var SUFFIX_RE = new RegExp(' --proxy=[0-9.]+:\\d{1,5},direct:// --content=' + setup.CONTENT.replace(/[^A-Za-z0-9_]/g, '\\$&') + '(?= |$)', 'g');

// Printable ASCII only, and none of the characters a shell or SQL string could be broken with.
function plain(v) { return typeof v === 'string' && v.length > 0 && v.length < 600 && /^[\x20-\x7e]+$/.test(v) && !/['"\\$`]/.test(v); }

function isPatched(value) { SUFFIX_RE.lastIndex = 0; return SUFFIX_RE.test(String(value)); }

// Does the text still carry our flags (even in a form this module will not edit)?
function hasOurs(value) { return String(value).indexOf(OURS) >= 0; }

// The value without our flags and with ORIGINAL_START back in front (a value that is not patched comes back unchanged).
function original(value) {
    var v = String(value);
    if (!isPatched(v)) return v;
    v = v.replace(SUFFIX_RE, '').replace(/^ +/, '');
    return v.indexOf(ORIGINAL_START) === 0 ? v : ORIGINAL_START + (v ? ' ' + v : '');
}

// The value that starts the app through the proxy: Samsung's flags without ORIGINAL_START, then ours (an older suffix is
// replaced, never doubled). Returns null when it would not fit.
function patched(value, proxyHost, proxyPort) {
    var rest = original(value);
    if (rest.indexOf(ORIGINAL_START) === 0) rest = rest.slice(ORIGINAL_START.length).replace(/^ +/, '');
    var out = (rest ? rest + ' ' : '') + setup.proxyArgs(proxyHost, proxyPort);
    return out.length <= MAX_VALUE ? out : null;
}

var WHERE = "tizen_id='" + WRAPPER + "'";

// Prints the value, or nothing; one line per row (more than one row is reported by the caller as unexpected).
function readScript(db) {
    var d = db || DB;
    return '[ -f "' + d + '" ] || { echo "Error: no package database"; exit 0; }\n' +
        'sqlite3 -cmd ".timeout 8000" "' + d + '" "select ' + COLUMN + ' from widgetinfo where ' + WHERE + ';" 2>&1';
}

// Compare-and-swap. Prints swapped | changed (the row no longer held `from`) | failed.
function swapScript(from, to, db) {
    if (!plain(from) || !plain(to)) throw new Error('refusing to write a value that is not plain printable text');
    var d = db || DB;
    return [
        'DB="' + d + '"',
        '[ -f "$DB" ] || { echo failed; exit 0; }',
        'OWN=$(stat -c %u:%g "$DB" 2>/dev/null)',
        'N=$(sqlite3 -cmd ".timeout 8000" "$DB" "update widgetinfo set ' + COLUMN + "='" + to + "' where " + WHERE + ' and ' + COLUMN + "='" + from + "'; select changes();\" 2>/dev/null) || { echo failed; exit 0; }",
        'if [ "$N" = "1" ]; then',
        '  [ -n "$OWN" ] && chown "$OWN" "$DB" "$DB-journal" 2>/dev/null; echo swapped',
        'else echo changed; fi'
    ].join('\n');
}

// state: 'original' | 'patched' | 'absent' (no such row: another firmware) | 'foreign' (a value this module will not edit, without our flags)
// | 'stuck' (our flags are in a value this module will not edit) | 'error'
function classify(output) {
    var text = String(output || '').replace(/\r/g, '');
    var lines = text.split('\n').filter(function (l) { return l.length; });
    if (!lines.length) return { state: 'absent', value: null };
    if (lines.length > 1 || /^(Error|sqlite3:|Parse error)/i.test(lines[0]) || /database is locked/i.test(text)) return { state: 'error', value: null, detail: lines[0].slice(0, 120) };
    var v = lines[0];
    if (!plain(v)) return hasOurs(v) ? { state: 'stuck', value: null } : { state: 'foreign', value: null };
    if (isPatched(v)) return { state: 'patched', value: v, valid: v.indexOf(ORIGINAL_START) === 0 || v.indexOf('--base_url=') < 0 };
    if (hasOurs(v)) return { state: 'stuck', value: null };
    return v.indexOf(ORIGINAL_START) === 0 ? { state: 'original', value: v } : { state: 'foreign', value: null };
}

// execute(shellText, timeoutMs) -> Promise<{stdout}>, already wrapped for the TV by the caller.
function read(execute, db) {
    return execute(readScript(db), 15000).then(function (r) { return classify(r && r.stdout); });
}

function swap(execute, from, to, db) {
    return execute(swapScript(from, to, db), 20000).then(function (r) {
        var out = String((r && r.stdout) || '');
        return /^swapped$/m.test(out) ? 'swapped' : /^changed$/m.test(out) ? 'changed' : 'failed';
    });
}

// Makes the row hold the patched value for this proxy. Resolves to the state afterwards: 'patched' | 'absent' | 'foreign' | 'stuck' | 'error' | 'raced'.
function apply(execute, proxyHost, proxyPort, db) {
    return read(execute, db).then(function (cur) {
        if (cur.state !== 'original' && cur.state !== 'patched') return cur.state;
        if (cur.valid === false) return 'foreign';
        var want = patched(cur.value, proxyHost, proxyPort);
        if (want === null) return 'foreign';                        // would not fit in what the TV passes on
        if (want === cur.value) return 'patched';
        return swap(execute, cur.value, want, db).then(function (r) { return r === 'swapped' ? 'patched' : r === 'changed' ? 'raced' : 'error'; });
    });
}

// Takes the suffix off. Resolves to 'original' | 'absent' | 'foreign' | 'stuck' | 'error' | 'raced'. Only 'original', 'absent' and 'foreign' mean no flag of ours is left.
function restore(execute, db) {
    return read(execute, db).then(function (cur) {
        if (cur.state === 'original') return 'original';
        if (cur.state !== 'patched') return cur.state;
        return swap(execute, cur.value, original(cur.value), db).then(function (r) { return r === 'swapped' ? 'original' : r === 'changed' ? 'raced' : 'error'; });
    });
}

module.exports = { MAX_VALUE: MAX_VALUE, hasOurs: hasOurs, DB: DB, WRAPPER: WRAPPER, COLUMN: COLUMN, plain: plain, isPatched: isPatched, original: original, patched: patched,
    readScript: readScript, swapScript: swapScript, classify: classify, read: read, apply: apply, restore: restore };
