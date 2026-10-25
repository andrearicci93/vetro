'use strict';
// Quick wins that are not app groups: each one is a single, reversible change that frees memory
// or stops the TV from changing itself. Verified against the Q80A firmware (T-NKM2DEUC-2301.1)
// by reading its files; the effect of each change on a running TV has not been measured.
//
//   firmware  Support > Software Update > Auto update. A vconf int: 1 = on, 0 = off.
//   multiscreen  Samsung's own unit com.samsung.tv.multiscreen.service has ConditionPathExists=! on
//             .../data/disable_preloading, so that file stops the preload at boot. The first Multi View
//             after that starts cold. Nothing is replaced: removing the file puts everything back.
//   ambient   ambient_start.sh (read-only, on the firmware image) waits 15 s after boot and then starts
//             AmbientApp in the background until app_launcher says "successfully launched", then exits.
//             The script stays as it is; Vetro stops the app once it is up, at every boot. The block is partial:
//             screend (Samsung's screen daemon) watches org.tizen.ambientapp and starts it again after a stop,
//             because the model has the firmware feature com.samsung/featureconf/ambient_screen_support.
//
// HbbTV has its own module (hbbtv.js) because its menu value must be restored exactly.
var execError = require('./exec-error.js');
var fs = require('fs');

var FILE = '/opt/usr/home/owner/share/vetro-quick-wins.json';
var AUTOUPDATE = 'db/menu/support/softwareupdate/autoupdate';
var MULTISCREEN_ID = 'com.samsung.tv.multiscreen';
var MULTISCREEN_FLAG = '/home/owner/apps_rw/com.samsung.tv.multiscreen/data/disable_preloading';
var AMBIENT_ID = 'org.tizen.ambientapp';
// Samsung's own background launch (ambient_start.sh), used to undo the win without opening the screen saver.
var AMBIENT_LAUNCH = 'U=$(tzplatform-get TZ_SYS_DEFAULT_USER | sed "s/TZ_SYS_DEFAULT_USER=//"); ' +
    'app_launcher -f ' + AMBIENT_ID + ' -u $(id -u $U) launchstyle background __APPFW_LAUNCH_TYPE_IDENTIFIER__ bg';
var IDS = ['firmware', 'multiscreen', 'ambient'];
var BOOT_POLL_MS = 10000, BOOT_POLLS = 36;

function wrap(s) { return 'echo ' + Buffer.from(s).toString('base64') + ' | base64 -d | sh'; }
function check(r) {
    if (r.exit_code || r.timed_out) throw execError.failed(r, r.stderr || r.stdout || 'TV unavailable');
    return r.stdout || '';
}
function running(id) { return 'app_launcher -S 2>/dev/null | grep -q "^[[:space:]]*' + id.replace(/\./g, '\\.') + '[[:space:]]"'; }
// -t may exit non-zero when the app is already gone (the scripts run under set -e), and the process can take a
// moment to leave the list: wait up to 5 s.
function stop(id) {
    return 'if ' + running(id) + '; then app_launcher -t ' + id + ' || true; i=0; while ' + running(id) + ' && [ $i -lt 10 ]; do sleep 0.5; i=$((i+1)); done; fi';
}

var READ = [
    'echo "AU|$(vconftool get ' + AUTOUPDATE + ' 2>&1)"',
    '[ -e ' + MULTISCREEN_FLAG + ' ] && echo "MS|1" || echo "MS|0"',
    running(MULTISCREEN_ID) + ' && echo "MR|1" || echo "MR|0"',
    running(AMBIENT_ID) + ' && echo "AR|1" || echo "AR|0"',
    'true'
].join('\n');

// Everything the three wins depend on, from one read-only call. A line that is missing stays null.
function parse(text) {
    var out = {autoupdate: null, multiscreenFlag: null, multiscreenRunning: null, ambientRunning: null};
    String(text || '').split('\n').forEach(function (line) {
        var f = line.replace(/\r$/, '').split('|');
        if (f[0] === 'AU') { var m = /value = (-?\d+) \(Int32\)/.exec(f.slice(1).join('|')); if (m) out.autoupdate = Number(m[1]); }
        else if (f[0] === 'MS') out.multiscreenFlag = f[1] === '1';
        else if (f[0] === 'MR') out.multiscreenRunning = f[1] === '1';
        else if (f[0] === 'AR') out.ambientRunning = f[1] === '1';
    });
    return out;
}

function Wins(execute, options) {
    options = options || {};
    this.execute = execute;
    this.fs = options.fs || fs;
    this.file = options.file || FILE;
    this.sleep = options.sleep || function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
    this.bootId = options.bootId || function () { try { return fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(); } catch (e) { return null; } };
    // Only tests and older builds that do not offer the Ambient win set this: a saved choice is then not acted on.
    this.skipAmbient = !!options.skipAmbient;
    this.busy = false;
}

// What Vetro itself switched on, and the values to put back. Plain JSON in the share folder.
Wins.prototype.load = function () {
    try {
        var o = JSON.parse(this.fs.readFileSync(this.file, 'utf8'));
        return {
            hbbtv: o.hbbtv === true, ambient: o.ambient === true,
            autoupdatePrevious: Number.isInteger(o.autoupdatePrevious) && o.autoupdatePrevious > 0 ? o.autoupdatePrevious : null,
            ambientBoot: typeof o.ambientBoot === 'string' ? o.ambientBoot : null
        };
    } catch (e) { return {hbbtv: false, ambient: false, autoupdatePrevious: null, ambientBoot: null}; }
};
Wins.prototype.save = function (patch) {
    var next = Object.assign(this.load(), patch), tmp = this.file + '.tmp';
    this.fs.writeFileSync(tmp, JSON.stringify(next) + '\n', {mode: 0o600});
    this.fs.renameSync(tmp, this.file);
    return next;
};
// Used by the HbbTV route, which does the work itself and only needs the choice remembered for the next boot.
Wins.prototype.remember = function (id, on) {
    if (id !== 'hbbtv' && id !== 'ambient') throw Error('Unknown quick win');
    var patch = {}; patch[id] = !!on;
    return this.save(patch);
};

Wins.prototype.read = function () {
    var self = this;
    return this.execute(wrap(READ), 10000).then(function (r) {
        var s = parse(check(r)), mine = self.load();
        var firmware = s.autoupdate === null ? {status: 'unknown'} : {status: s.autoupdate === 0 ? 'on' : 'off', value: s.autoupdate};
        var multiscreen = s.multiscreenFlag === null ? {status: 'unknown'} : {status: s.multiscreenFlag ? 'on' : 'off', running: s.multiscreenRunning === true};
        var ambient = s.ambientRunning === null ? {status: 'unknown'}
            : {status: !mine.ambient ? 'off' : s.ambientRunning ? 'partial' : 'on', running: s.ambientRunning, chosen: mine.ambient};
        return {ts: Date.now(), wins: {firmware: firmware, multiscreen: multiscreen, ambient: ambient}};
    });
};

Wins.prototype.apply = function (id, on) {
    var self = this;
    if (IDS.indexOf(id) < 0) return Promise.reject(Error('Unknown quick win'));
    if (typeof on !== 'boolean') return Promise.reject(Error('Invalid state'));
    if (this.busy) return Promise.reject(Error('A quick win is already being changed'));
    this.busy = true;
    var task = id === 'firmware' ? this.firmware(on) : id === 'multiscreen' ? this.multiscreen(on) : this.ambient(on);
    return task.then(function (result) { self.busy = false; return result; }, function (e) { self.busy = false; throw e; });
};

// Auto update: readback after the write, and the previous value is put back if the TV does not confirm it.
Wins.prototype.firmware = function (on) {
    var self = this;
    function get() {
        return self.execute(wrap('vconftool get ' + AUTOUPDATE + ' 2>&1'), 6000).then(function (r) {
            var m = /value = (-?\d+) \(Int32\)/.exec(check(r));
            if (!m) throw Error('Auto update setting unreadable');
            return Number(m[1]);
        });
    }
    function set(v) { return self.execute(wrap('vconftool set -f -t int ' + AUTOUPDATE + ' ' + v), 6000).then(check); }
    return get().then(function (before) {
        var target = on ? 0 : (self.load().autoupdatePrevious || 1);
        if (before === target || (!on && before > 0)) return {id: 'firmware', changed: false, value: before};
        if (on && before > 0) self.save({autoupdatePrevious: before});
        return set(target).then(get).then(function (after) {
            if (after !== target) throw Error('The TV did not keep the new value');
            return {id: 'firmware', changed: true, previous: before, value: after};
        }).catch(function (e) {
            return set(before).then(get).then(function (restored) {
                throw Error(e.message + ' · ' + (restored === before ? 'previous value restored' : 'restore not confirmed'));
            }, function () { throw Error(e.message + ' · restore not confirmed'); });
        });
    });
};

// The file is the whole change. It persists across boots, so nothing has to run at startup.
Wins.prototype.multiscreen = function (on) {
    var self = this;
    var script = on
        ? 'set -e\ntouch ' + MULTISCREEN_FLAG + '\nchown owner:system_share ' + MULTISCREEN_FLAG + '\nchmod 664 ' + MULTISCREEN_FLAG + '\n' + stop(MULTISCREEN_ID)
        : 'rm -f ' + MULTISCREEN_FLAG;
    return this.execute(wrap(script), 12000).then(check).then(function () { return self.read(); }).then(function (state) {
        if ((state.wins.multiscreen.status === 'on') !== on) throw Error('The TV did not keep the change');
        return {id: 'multiscreen', changed: true, status: state.wins.multiscreen.status};
    });
};

// Ambient is stopped now and again at each boot. Turning it off lets Samsung's own launch run again.
Wins.prototype.ambient = function (on) {
    var self = this;
    if (on) this.save({ambient: true});
    var script = on ? stop(AMBIENT_ID) : AMBIENT_LAUNCH;
    if (!on) this.save({ambient: false, ambientBoot: null});
    return this.execute(wrap(script + '\nsleep 1\ntrue'), 15000).then(check).then(function () { return self.read(); }).then(function (state) {
        if (on && state.wins.ambient.running) throw Error('AmbientApp started again right away; it will be stopped at the next boot');
        return {id: 'ambient', changed: true, status: state.wins.ambient.status};
    });
};

// After each boot: HbbTV's flag lives in /tmp and AmbientApp is started by the firmware 15 s after boot,
// so both are handled here, once the TV adapter is connected. Resolves with what it did.
Wins.prototype.boot = function (hbbtv) {
    var self = this, mine = this.load(), did = [], id = this.bootId();
    var start = mine.hbbtv && hbbtv ? hbbtv.enforce().then(function (r) { if (r && r.stopped) did.push('hbbtv'); }, function () {}) : Promise.resolve();
    return start.then(function () {
        if (self.skipAmbient || !mine.ambient || (id && mine.ambientBoot === id)) return did;
        var n = 0;
        function poll() {
            return self.execute(wrap(running(AMBIENT_ID) + ' && echo up || echo down'), 8000).then(function (r) {
                if (/up/.test(r.stdout || '') && !r.exit_code) {
                    return self.execute(wrap(stop(AMBIENT_ID) + '\nsleep 1\ntrue'), 12000).then(function () {
                        did.push('ambient');
                        if (id) self.save({ambientBoot: id});
                    });
                }
                if (++n >= BOOT_POLLS) return null;
                return self.sleep(BOOT_POLL_MS).then(poll);
            }, function () {
                if (++n >= BOOT_POLLS) return null;
                return self.sleep(BOOT_POLL_MS).then(poll);
            });
        }
        return poll().then(function () { return did; });
    });
};

module.exports = {Wins: Wins, stop: stop, parse: parse, IDS: IDS, FILE: FILE, AUTOUPDATE: AUTOUPDATE, MULTISCREEN_FLAG: MULTISCREEN_FLAG, AMBIENT_ID: AMBIENT_ID, MULTISCREEN_ID: MULTISCREEN_ID};
