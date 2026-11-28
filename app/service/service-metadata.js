'use strict';
// Declare Samsung's `allow.bgservice` metadata for Vetro's own service in the package registry (#344).
//
// On Tizen 10 firmware from about build 1242 the service launcher (`wrt-service-launcher`) refuses to run a service package that has
// none of a short list of Samsung metadata keys: it logs "does not have valid service metadata" and exits. Boot and auto-restart go
// through that launcher, so without the key Vetro's service does not start with the TV, and after the TV ends it (it does so after
// 10 minutes without the app's screen, with or without the key) it stays down until the app is opened. With the key the launcher accepts
// the package and the service comes back by itself within seconds. Static analysis of the firmware (wiki 2026-11-28-wrt-service-lifecycle-1245)
// and a test build by the reporter of #344 on an S85H; not tried on a TV by us.
//
// Putting the key in config.xml would need a new install (the update would have to raise `shell`), so a TV on an older Vetro could not
// update itself in the app. The registry is what the launcher reads, and Vetro already corrects its own startup flags there
// (component-actions.js selfStartup), so this adds one row to the same database once the root agent is connected:
// package_app_app_metadata(app_id, md_key, md_value), for `vetrotvapp.svc`. A package that already carries the key (installed from a config.xml
// that has it) is left alone.
//
// Only where it can matter: the row is added only when the launcher on this TV contains the key (older firmware does not, and the
// row would do nothing there). It changes nothing else, installs nothing, and is idempotent. A reinstall that regenerates the registry
// loses the row; the next start of Vetro adds it again.
var KEY = 'http://samsung.com/tv/metadata/allow.bgservice';
var APP_ID = 'vetrotvapp.svc';
var DB = '/opt/dbspace/.pkgmgr_parser.db';
var LAUNCHER = '/usr/bin/wrt-service-launcher';

function wrap(s) { return 'echo ' + Buffer.from(s).toString('base64') + ' | base64 -d | sh'; }

// One line out: B|unsupported, B|unregistered, or B|<rows before>|<rows after> (rows of the key in Vetro's package).
// Quoting: every value is a constant of this file (the paths can be replaced by the tests), never user input.
function script(o) {
    o = o || {};
    var db = o.db || DB, launcher = o.launcher || LAUNCHER;
    var has = "SELECT count(*) FROM package_app_app_metadata m JOIN package_app_info i ON i.app_id=m.app_id WHERE m.md_key='" + KEY +
        "' AND i.package=(SELECT package FROM package_app_info WHERE app_id='" + APP_ID + "');";
    return 'if ! grep -a -q "allow.bgservice" \'' + launcher + '\' 2>/dev/null; then echo "B|unsupported"; exit 0; fi\n' +
        'Q() { sqlite3 -readonly -cmd ".timeout 5000" \'' + db + '\' "$1" 2>/dev/null; }\n' +
        'reg=$(Q "SELECT count(*) FROM package_app_info WHERE app_id=\'' + APP_ID + '\';")\n' +
        'if [ "$reg" != "1" ]; then echo "B|unregistered"; exit 0; fi\n' +
        'had=$(Q "' + has + '")\n' +
        'if [ "$had" = "0" ]; then\n' +
        '  sqlite3 -bail -cmd ".timeout 5000" \'' + db + '\' "BEGIN IMMEDIATE; INSERT OR IGNORE INTO package_app_app_metadata(app_id,md_key,md_value) VALUES(\'' +
        APP_ID + '\',\'' + KEY + '\',\'true\'); COMMIT;" >/dev/null 2>&1\n' +
        'fi\n' +
        'now=$(Q "' + has + '")\n' +
        'echo "B|$had|$now"\ntrue';
}

// state: unsupported (the launcher does not know the key), unregistered (Vetro's service is not in the registry), present (the key was
// already there), added (written now and read back), failed (the write did not stick).
function parse(stdout) {
    var m = /^B\|(unsupported|unregistered)$/m.exec(String(stdout || ''));
    if (m) return {state: m[1]};
    m = /^B\|(\d+)\|(\d+)$/m.exec(String(stdout || ''));
    if (!m) throw new Error('The TV did not answer');
    var had = Number(m[1]), now = Number(m[2]);
    return {state: had > 0 ? 'present' : now > 0 ? 'added' : 'failed'};
}

// Never throws: a rejection when the TV does not answer, a result otherwise.
function apply(execute, o) {
    return Promise.resolve().then(function () {
        return execute(wrap(script(o)), 15000);
    }).then(function (r) {
        if (!r || r.exit_code || r.timed_out) throw new Error('The TV did not answer');
        return parse(r.stdout);
    });
}

module.exports = {KEY: KEY, APP_ID: APP_ID, script: script, parse: parse, apply: apply, wrap: wrap};
