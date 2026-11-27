'use strict';
// Keep TV-Store's service starting with the TV (Quick settings, Experimental).
//
// TV-Store (github.com/Apps2Samsung/TV-Store) asks for on-boot in its config.xml, so that it can update apps while it is closed.
// Some firmware drops that flag when the package is installed, and drops it again at every update of TV-Store, because every
// install registers the service anew: the service then never starts by itself. With this switch on, Vetro reads the flag of
// A2STVStore.sdbservice in the package database and puts it back to true when it reads anything else, at every start of Vetro and
// then every CHECK_MS. TV-Store's own Settings (Update while TV-Store is closed) says whether the TV started its service by itself.
//
// It changes that one value of that one app: it downloads, signs and installs nothing, and it leaves auto-restart alone. The write
// is the one the Task manager and selfStartup() do for any service (component-actions.js): the global database, BEGIN IMMEDIATE,
// read back. The TV reads the flag when it starts, so a flag set now counts from the next start of the TV.
//
// Where on-boot is kept, the service runs from the start of the TV on and its port (8077) is open in the home network, also with
// every switch of TV-Store off (TV-Store #158). That is why this is a choice of the owner and off by default.
//
// Off puts the flag back the way the firmware had it (false) only when Vetro was the one that turned it on, and never touches a
// flag the firmware kept by itself.
//
// Idea and first implementation as a Shard by PatrickSt1991 (Apps2Samsung/TV-Store#159, andrearicci93/vetro-plugins#47),
// brought into Vetro as a setting.
var fs = require('fs');
var atomicFile = require('./atomic-file.js');

var FILE = '/opt/usr/home/owner/share/vetro-tvstore-onboot.json';
var APP_ID = 'A2STVStore.sdbservice';
var DB = '/opt/dbspace/.pkgmgr_parser.db';
var CHECK_MS = 30 * 60000;

function wrap(s) { return 'echo ' + Buffer.from(s).toString('base64') + ' | base64 -d | sh'; }

// One line out: F|<value> for the flag of the service ("true", "false", or nothing when TV-Store's service is not registered).
// Quoting: the app id is a constant of this file, never user input.
var READ = 'sqlite3 -readonly -cmd ".timeout 5000" ' + DB + ' "SELECT app_onboot FROM package_app_info WHERE app_id=\'' + APP_ID + '\';" 2>/dev/null';
function readScript() { return 'v=$(' + READ + '); echo "F|$v"\ntrue'; }
// set: only when the flag reads something other than the wanted value. The result line says what was there before (was) and after.
function writeScript(value) {
    return 'was=$(' + READ + ')\n' +
        'if [ -n "$was" ] && [ "$was" != "' + value + '" ]; then\n' +
        '  sqlite3 -bail -cmd ".timeout 5000" ' + DB + ' "BEGIN IMMEDIATE; UPDATE package_app_info SET app_onboot=\'' + value + '\' WHERE app_id=\'' + APP_ID + '\'; COMMIT;" >/dev/null 2>&1\n' +
        'fi\n' +
        'now=$(' + READ + ')\n' +
        'echo "F|$now|$was"\ntrue';
}

function TvStoreOnboot(deps) {
    this.execute = deps.execute;
    this.file = deps.file || FILE;
    this.busy = false;
}

TvStoreOnboot.prototype.load = function () {
    try {
        var j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        return {on: j.on === true, changed: j.changed === true};
    } catch (e) { return {on: false, changed: false}; }
};
TvStoreOnboot.prototype.chosen = function () { return this.load().on; };
TvStoreOnboot.prototype.save = function (state) {
    try { atomicFile.write(fs, this.file, JSON.stringify({on: state.on === true, changed: state.changed === true})); }
    catch (e) { throw new Error('The setting could not be saved: ' + e.message); }
};

// {installed, value}: value is the flag as the database has it ('true', 'false'), null when the service is not registered.
TvStoreOnboot.prototype.run = function (script) {
    return this.execute(wrap(script), 15000).then(function (r) {
        if (!r || r.exit_code || r.timed_out) throw new Error('The TV did not answer');
        var m = /^F\|([^|\n]*)(?:\|([^\n]*))?$/m.exec(String(r.stdout || ''));
        if (!m) throw new Error('The TV did not answer');
        return {value: m[1] === '' ? null : m[1], was: m[2] === undefined || m[2] === '' ? null : m[2]};
    });
};

// What the switch shows: unknown (TV-Store is not on this TV and nothing was chosen), off, partial (chosen but the flag is not on),
// on. installed says whether TV-Store's service is registered.
TvStoreOnboot.prototype.status = function (got) {
    var s = this.load(), installed = got.value !== null;
    if (!s.on) return {status: installed ? 'off' : 'unknown', installed: installed, flag: got.value};
    return {status: installed && got.value === 'true' ? 'on' : 'partial', installed: installed, flag: got.value};
};

TvStoreOnboot.prototype.read = function () {
    var self = this;
    return this.run(readScript()).then(function (got) { return self.status(got); });
};

// The choice is saved first: it must hold even when the TV does not answer. on: put the flag on now. off: put it back only if Vetro
// had turned it on.
TvStoreOnboot.prototype.apply = function (on) {
    // A rejection, never a throw: the caller chains on it.
    var self = this;
    return Promise.resolve().then(function () { return self.applyNow(on); });
};
TvStoreOnboot.prototype.applyNow = function (on) {
    var self = this, s = this.load();
    if (on === true) {
        this.save({on: true, changed: s.changed});
        return this.run(writeScript('true')).then(function (got) {
            var wrote = got.was !== null && got.was !== 'true' && got.value === 'true';
            if (wrote) self.save({on: true, changed: true});
            var st = self.status(got);
            st.wrote = wrote;
            return st;
        });
    }
    this.save({on: false, changed: false});
    // Off is read back as off, also where TV-Store is not on the TV (the switch then reads unknown: there is nothing to show).
    if (!s.changed) return this.read().then(function (st) { st.status = 'off'; st.wrote = false; return st; });
    return this.run(writeScript('false')).then(function (got) {
        var st = self.status(got);
        st.status = 'off';
        st.wrote = got.was === 'true' && got.value === 'false';
        return st;
    });
};

// At every start of Vetro and every CHECK_MS: only while chosen, only when the flag is not on; a flag that is on is not written.
// Never throws: the caller is a timer.
TvStoreOnboot.prototype.tick = function () {
    var self = this;
    if (this.busy || !this.chosen()) return Promise.resolve(null);
    this.busy = true;
    return this.run(writeScript('true')).then(function (got) {
        if (got.was !== null && got.was !== 'true' && got.value === 'true') self.save({on: true, changed: true});
        return self.status(got);
    }).catch(function () { return null; }).then(function (r) { self.busy = false; return r; });
};

module.exports = {TvStoreOnboot: TvStoreOnboot, FILE: FILE, APP_ID: APP_ID, CHECK_MS: CHECK_MS, writeScript: writeScript, readScript: readScript};
