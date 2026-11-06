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
//             The script stays as it is; Vetro stops the app once it is up, at every boot. A plain stop is not enough:
//             screend (Samsung's screen daemon) watches org.tizen.ambientapp and starts it again within seconds,
//             because the model has the firmware feature com.samsung/featureconf/ambient_screen_support.
//             So screend is stopped first, the app is killed, and screend is started again. On start screend does not
//             launch the app (only ambient_start.sh does, at boot), so it stays down. Measured on a Q80A: the app
//             stayed off for minutes with screend running again; a launch like ambient_start.sh's was caught and
//             stopped in 4 s. The picture is only flat while the app is on screen, nothing is left applied.
//   telemetry The services that watch what is on screen or send usage logs. contents-recognition-service is the
//             viewing-data (ACR) recogniser, canalysis, pisa and adagent are the analytics and ad agents,
//             mirroring-recognition-manager, contents-ui-detector-service and contents-ott-detector-service (the second
//             is started by contents-recognition-service, not by a unit; both find thumbnails and app screens in the picture), kpi-logging (remote key presses), emergency-log-transmitter and
//             devicetracker (health KPIs) report on use. canalysis-service and pisa-service have a
//             ConditionPathExists=! on a file in /opt/usr/share/systemd/system, so a file there keeps them off across
//             boots; the others are stopped now and at every boot. data-service, the collector that uploads KPI logs
//             to lcprd1.samsungcloudsolution.net, is started again over D-Bus by other components, so it is also
//             stopped but what ends its uploads is the local DNS filter entry for that host. Stops are queued with
//             --no-block: waiting for them can pass the 30 s the agent allows a command.
//
//   airplay   Samsung's own units com.samsung.tv.airplay-service(-2).service have ConditionPathExists=! on
//             /opt/usr/share/systemd/system/<unit name> (read in the Q80A firmware), so that file keeps the AirPlay
//             receiver from starting, also at boot. The hidden web app (<package>.AirPlayWebApp) is stopped now and
//             once after each boot if something starts it. Removing the files and starting the unit puts the
//             receiver back; Samsung starts the web app again when it is needed. While this is on, AirPlay and
//             Samsung's screen mirroring from Apple devices do not work.
//             Idea and first implementation by zabique (https://github.com/zabique/vetro, branch fork/extras,
//             tested there on a QN85A), re-written here for the Q80A.
//
// HbbTV has its own module (hbbtv.js) because its menu value must be restored exactly.
var execError = require('./exec-error.js');
var fs = require('fs');
// Regular expressions compiled once at module load, not on every call.
var DOT_RE = /\./g;
var CR_END_RE = /\r$/;
var VCONF_INT32_RE = /value = (-?\d+) \(Int32\)/;
var DIGITS_RE = /^\d+$/;
var UP_RE = /up/;
var BTIME_RE = /^btime (\d+)$/m;

var FILE = '/opt/usr/home/owner/share/vetro-quick-wins.json';
var AUTOUPDATE = 'db/menu/support/softwareupdate/autoupdate';
var MULTISCREEN_ID = 'com.samsung.tv.multiscreen';
var MULTISCREEN_FLAG = '/home/owner/apps_rw/com.samsung.tv.multiscreen/data/disable_preloading';
var AMBIENT_ID = 'org.tizen.ambientapp';
// Samsung's own background launch (ambient_start.sh), used to undo the win without opening the screen saver.
var AMBIENT_LAUNCH = 'U=$(tzplatform-get TZ_SYS_DEFAULT_USER | sed "s/TZ_SYS_DEFAULT_USER=//"); ' +
    'app_launcher -f ' + AMBIENT_ID + ' -u $(id -u $U) launchstyle background __APPFW_LAUNCH_TYPE_IDENTIFIER__ bg';
// Kill the app with screend out of the way, then bring screend back whatever happened.
var AMBIENT_OFF = 'if ' + running(AMBIENT_ID) + '; then systemctl stop screend; ' +
    'kill -9 $(pgrep -f "[A]mbientApp.dll") 2>/dev/null; sleep 1; systemctl start screend; fi';
// The analytics, ad and viewing-data agents. Names are the process names (15 characters at most) as ps shows them.
var TELEMETRY_DIR = '/opt/usr/share/systemd/system/';
var TELEMETRY_BRAKES = ['canalysis-daemon', 'pisa-service', 'vision-data-recognition-service'].map(function (n) { return TELEMETRY_DIR + n; });
var TELEMETRY_COND = '/tmp/eltlaunch.cond';
var TELEMETRY_UNITS = ['canalysis-service', 'pisa-service', 'adagent-service', 'contents-recognition-service',
    'mirroring-recognition-manager', 'contents-ui-detector-service', 'kpi-logging',
    'emergency-log-transmitter', 'devicetracker', 'data-service'];
var TELEMETRY_PROCS = ['canalysis-daemo', 'pisa-service', 'adagent-servic', 'contents-recogn', 'mirroring-recog',
    'contents-ui-det', 'contents-ott-de', 'kpi-logging', 'emergencyLogTr', 'devicetracker'];
var TELEMETRY_HOST = 'lcprd1.samsungcloudsolution.net';
var TELEMETRY_OFF = 'touch ' + TELEMETRY_BRAKES.join(' ') + ' ' + TELEMETRY_COND + '\n' +
    'for u in ' + TELEMETRY_UNITS.join(' ') + '; do systemctl stop --no-block $u 2>/dev/null; done\nsleep 1\n' +
    'for n in ' + TELEMETRY_PROCS.join(' ') + '; do for p in $(pgrep -x $n); do kill -9 $p 2>/dev/null; done; done\n' +
    'sleep 2\ntrue';
var TELEMETRY_ON = 'rm -f ' + TELEMETRY_BRAKES.join(' ') + ' ' + TELEMETRY_COND + '\n' +
    'systemctl reset-failed 2>/dev/null\n' +
    'for u in ' + TELEMETRY_UNITS.slice(0, -1).join(' ') + '; do systemctl start --no-block $u 2>/dev/null; done\nsleep 1\ntrue';
// AirPlay (see the header). The web app's package id differs between stores and models; its app id always ends like this.
var AIRPLAY_UNITS = ['com.samsung.tv.airplay-service', 'com.samsung.tv.airplay-service-2'];
var AIRPLAY_FLAGS = AIRPLAY_UNITS.map(function (u) { return TELEMETRY_DIR + u; });
// A shell loop over the receiver's units that exist on this TV. Two generations are in the community reports: the 2020 and
// 2021 TVs have both units (airplay-service and airplay-service-2), 2022 and later only airplay-service-2. AirPlay is only
// offered when every unit that exists carries the ConditionPathExists=! line on its flag file (checked by AP below),
// because the file trick is read in the Q80A firmware and not known for any other generation.
function AIRPLAY_EACH(body, init) {
    return init + '; for u in ' + AIRPLAY_UNITS.join(' ') + '; do if systemctl cat $u.service >/dev/null 2>&1; then ' + body + '; fi; done;';
}
var AIRPLAY_WEB_RUNNING = 'app_launcher -S 2>/dev/null | grep -q "\\.AirPlayWebApp[[:space:]]"';
var AIRPLAY_WEB_STOP = 'for w in $(app_launcher -S 2>/dev/null | awk \'{print $1}\' | grep "\\.AirPlayWebApp$"); do app_launcher -t "$w" >/dev/null 2>&1 || true; done';
var AIRPLAY_OFF = 'set -e\ntouch ' + AIRPLAY_FLAGS.join(' ') + '\n' +
    AIRPLAY_UNITS.map(function (u) { return 'systemctl stop --no-block ' + u + '.service >/dev/null 2>&1 || true'; }).join('\n') + '\n' +
    'sleep 1\n' + AIRPLAY_WEB_STOP + '\nsleep 1\ntrue';
var AIRPLAY_ON = 'rm -f ' + AIRPLAY_FLAGS.join(' ') + '\nsystemctl reset-failed ' + AIRPLAY_UNITS[1] + '.service >/dev/null 2>&1\n' +
    AIRPLAY_UNITS.map(function (u) { return 'systemctl start --no-block ' + u + '.service >/dev/null 2>&1 || true'; }).join('\n') + '\nsleep 1\ntrue';
var IDS = ['firmware', 'multiscreen', 'ambient', 'telemetry', 'airplay'];
var BOOT_POLL_MS = 10000, BOOT_POLLS = 36, TELEMETRY_RETRY_MS = 45000;

function wrap(s) { return 'echo ' + Buffer.from(s).toString('base64') + ' | base64 -d | sh'; }
function check(r) {
    if (r.exit_code || r.timed_out) throw execError.failed(r, r.stderr || r.stdout || 'TV unavailable');
    return r.stdout || '';
}
function running(id) { return 'app_launcher -S 2>/dev/null | grep -q "^[[:space:]]*' + id.replace(DOT_RE, '\\.') + '[[:space:]]"'; }
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
    'echo "TB|$(ls ' + TELEMETRY_BRAKES.join(' ') + ' 2>/dev/null | wc -l)"',
    'echo "TR|$(ps -eo comm | grep -c -E "^(' + TELEMETRY_PROCS.join('|') + ')$")"',
    AIRPLAY_EACH('n=$((n+1)); systemctl cat $u.service 2>/dev/null | grep -q "^ConditionPathExists=!' + TELEMETRY_DIR + '$u$" || bad=$((bad+1))', 'n=0; bad=0') +
        ' [ $n -gt 0 ] && [ $bad -eq 0 ] && echo "AP|1" || echo "AP|0"',
    AIRPLAY_EACH('[ -e ' + TELEMETRY_DIR + '$u ] || f=0', 'f=1') + ' echo "AF|$f"',
    AIRPLAY_EACH('systemctl is-active $u.service >/dev/null 2>&1 && a=active', 'a=inactive') + ' echo "AS|$a"',
    AIRPLAY_WEB_RUNNING + ' && echo "AW|1" || echo "AW|0"',
    'true'
].join('\n');

// Everything the wins depend on, from one read-only call. A line that is missing stays null.
function parse(text) {
    var out = {autoupdate: null, multiscreenFlag: null, multiscreenRunning: null, ambientRunning: null, telemetryBrakes: null, telemetryRunning: null,
        airplayPresent: null, airplayFlag: null, airplayService: null, airplayWeb: null};
    String(text || '').split('\n').forEach(function (line) {
        var f = line.replace(CR_END_RE, '').split('|');
        if (f[0] === 'AU') { var m = VCONF_INT32_RE.exec(f.slice(1).join('|')); if (m) out.autoupdate = Number(m[1]); }
        else if (f[0] === 'MS') out.multiscreenFlag = f[1] === '1';
        else if (f[0] === 'MR') out.multiscreenRunning = f[1] === '1';
        else if (f[0] === 'AR') out.ambientRunning = f[1] === '1';
        else if (f[0] === 'TB' && DIGITS_RE.test(f[1])) out.telemetryBrakes = Number(f[1]);
        else if (f[0] === 'TR' && DIGITS_RE.test(f[1])) out.telemetryRunning = Number(f[1]);
        else if (f[0] === 'AP') out.airplayPresent = f[1] === '1';
        else if (f[0] === 'AF') out.airplayFlag = f[1] === '1';
        else if (f[0] === 'AS') out.airplayService = (f[1] || '').trim() === 'active';
        else if (f[0] === 'AW') out.airplayWeb = f[1] === '1';
    });
    return out;
}

// Which boot this is. The kernel's boot_id alone is not enough: on a QN85A the same boot_id came back after a restart
// (the TV starts from a saved snapshot), so "already done in this boot" stayed true for good and the Ambient and
// viewing-data stops were skipped. The boot time in /proc/stat (btime) changes with every start, so both are used.
// If the clock is stepped during a boot, btime moves and the stops run one more time, which does no harm.
// Found by zabique (https://github.com/zabique/vetro, branch fork/extras).
function currentBoot() {
    var id = '', bt = '';
    try { id = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(); } catch (e) { /* unreadable: the other half is used */ }
    try { var m = BTIME_RE.exec(fs.readFileSync('/proc/stat', 'utf8')); if (m) bt = m[1]; } catch (e) { /* same */ }
    return id || bt ? id + '@' + bt : null;
}

function Wins(execute, options) {
    options = options || {};
    this.execute = execute;
    this.fs = options.fs || fs;
    this.file = options.file || FILE;
    this.sleep = options.sleep || function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
    this.bootId = options.bootId || currentBoot;
    // Only tests and older builds that do not offer the Ambient win set this: a saved choice is then not acted on.
    this.skipAmbient = !!options.skipAmbient;
    // The local DNS filter (local-dns.js): status() and apply(enabled, domains). Without it the host is not blocked.
    this.dns = options.dns || null;
    this.busy = false;
    this.changing = null;
}

// What Vetro itself switched on, and the values to put back. Plain JSON in the share folder.
Wins.prototype.load = function () {
    try {
        var o = JSON.parse(this.fs.readFileSync(this.file, 'utf8'));
        return {
            hbbtv: o.hbbtv === true, ambient: o.ambient === true, telemetry: o.telemetry === true, telemetryDns: o.telemetryDns === true, airplay: o.airplay === true,
            telemetryBoot: typeof o.telemetryBoot === 'string' ? o.telemetryBoot : null,
            autoupdatePrevious: Number.isInteger(o.autoupdatePrevious) && o.autoupdatePrevious > 0 ? o.autoupdatePrevious : null,
            ambientBoot: typeof o.ambientBoot === 'string' ? o.ambientBoot : null
        };
    } catch (e) { return {hbbtv: false, ambient: false, telemetry: false, telemetryDns: false, airplay: false, telemetryBoot: null, autoupdatePrevious: null, ambientBoot: null}; }
};
Wins.prototype.save = function (patch) {
    var next = Object.assign(this.load(), patch), tmp = this.file + '.tmp';
    this.fs.writeFileSync(tmp, JSON.stringify(next) + '\n', {mode: 0o600});
    this.fs.renameSync(tmp, this.file);
    return next;
};
// Used by the HbbTV route, which does the work itself and only needs the choice remembered for the next boot.
Wins.prototype.remember = function (id, on) {
    if (id !== 'hbbtv' && id !== 'ambient' && id !== 'telemetry' && id !== 'airplay') throw Error('Unknown quick win');
    var patch = {}; patch[id] = !!on;
    return this.save(patch);
};

Wins.prototype.read = function () {
    var self = this, mine = this.load(), read = this.execute(wrap(READ), 10000);
    // The DNS filter's answer needs nothing from the TV read, and whether it is asked depends only on the saved choice:
    // start both together so the second does not wait for the first to come back.
    var dnsAsked = mine.telemetry && self.dns ? self.dns.status().then(function (d) { return !!(d.enabled && d.applied && d.domains.indexOf(TELEMETRY_HOST) >= 0); }, function () { return null; }) : null;
    return read.then(function (r) {
        var s = parse(check(r));
        var firmware = s.autoupdate === null ? {status: 'unknown'} : {status: s.autoupdate === 0 ? 'on' : 'off', value: s.autoupdate};
        var multiscreen = s.multiscreenFlag === null ? {status: 'unknown'} : {status: s.multiscreenFlag ? 'on' : 'off', running: s.multiscreenRunning === true};
        var ambient = s.ambientRunning === null ? {status: 'unknown'}
            : {status: !mine.ambient ? 'off' : s.ambientRunning ? 'partial' : 'on', running: s.ambientRunning, chosen: mine.ambient};
        var telemetry = s.telemetryRunning === null ? {status: 'unknown'}
            : {status: !mine.telemetry ? 'off' : s.telemetryRunning ? 'partial' : 'on', running: s.telemetryRunning, brakes: s.telemetryBrakes, chosen: mine.telemetry};
        // on: the flag files are there and nothing of the receiver runs; partial: the files are there but something runs.
        var airplay = s.airplayPresent !== true || s.airplayFlag === null ? {status: 'unknown'}
            : {status: !s.airplayFlag ? 'off' : (s.airplayService || s.airplayWeb) ? 'partial' : 'on',
               running: s.airplayService === true || s.airplayWeb === true};
        var wins = {firmware: firmware, multiscreen: multiscreen, ambient: ambient, telemetry: telemetry, airplay: airplay};
        if (!dnsAsked) return {ts: Date.now(), wins: wins};
        return dnsAsked.then(function (blocked) { telemetry.dnsBlocked = blocked; return {ts: Date.now(), wins: wins}; });
    });
};

Wins.prototype.apply = function (id, on) {
    var self = this;
    if (IDS.indexOf(id) < 0) return Promise.reject(Error('Unknown quick win'));
    if (typeof on !== 'boolean') return Promise.reject(Error('Invalid state'));
    if (this.busy) return Promise.reject(Error('A quick win is already being changed'));
    this.busy = true; this.changing = id;
    var task = Promise.resolve().then(function () {
        return id === 'firmware' ? self.firmware(on) : id === 'multiscreen' ? self.multiscreen(on) : id === 'telemetry' ? self.telemetry(on) : id === 'airplay' ? self.airplay(on) : self.ambient(on);
    });
    return task.then(function (result) { self.busy = false; self.changing = null; return result; }, function (e) { self.busy = false; self.changing = null; throw e; });
};

// Auto update: readback after the write, and the previous value is put back if the TV does not confirm it.
Wins.prototype.firmware = function (on) {
    var self = this;
    function get() {
        return self.execute(wrap('vconftool get ' + AUTOUPDATE + ' 2>&1'), 6000).then(function (r) {
            var m = VCONF_INT32_RE.exec(check(r));
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

// Ambient is stopped now and again at each boot, with screend out of the way (see the header). Turning it off lets Samsung's own launch run again.
Wins.prototype.ambient = function (on) {
    var self = this;
    if (on) this.save({ambient: true});
    var script = on ? AMBIENT_OFF : AMBIENT_LAUNCH;
    if (!on) this.save({ambient: false, ambientBoot: null});
    return this.execute(wrap(script + '\nsleep 1\ntrue'), 15000).then(check).then(function () { return self.read(); }).then(function (state) {
        if (on && state.wins.ambient.running) throw Error('AmbientApp is still running; it will be stopped again at the next boot');
        return {id: 'ambient', changed: true, status: state.wins.ambient.status};
    });
};

// The host that receives the KPI logs goes into the saved list of the local DNS filter. Vetro only removes it again
// if it was the one that added it. A failure here does not undo the services: the result says what happened.
Wins.prototype.telemetryDns = function (on) {
    var self = this, dns = this.dns;
    if (!dns) return Promise.resolve('unavailable');
    return dns.status().then(function (d) {
        var has = d.domains.indexOf(TELEMETRY_HOST) >= 0;
        if (on) {
            if (has) return d.enabled && d.applied ? 'blocked' : 'saved';
            return dns.apply(d.enabled, d.domains.concat([TELEMETRY_HOST])).then(function () { self.save({telemetryDns: true}); return d.enabled ? 'blocked' : 'saved'; });
        }
        if (!has || !self.load().telemetryDns) { self.save({telemetryDns: false}); return 'unchanged'; }
        var rest = d.domains.filter(function (x) { return x !== TELEMETRY_HOST; });
        return dns.apply(d.enabled && rest.length > 0, rest).then(function () { self.save({telemetryDns: false}); return 'removed'; });
    }).catch(function () { return 'failed'; });
};

// Stops the viewing-data, analytics and usage-log services now and at every boot (see the header for what each one is).
Wins.prototype.telemetry = function (on) {
    var self = this;
    this.save({telemetry: on});
    if (!on) this.save({telemetryBoot: null});
    return this.execute(wrap(on ? TELEMETRY_OFF : TELEMETRY_ON), 30000).then(check).then(function () { return self.telemetryDns(on); }).then(function (dns) {
        return self.read().then(function (state) {
            if (on && state.wins.telemetry.running) throw Error(state.wins.telemetry.running + ' collector' + (state.wins.telemetry.running === 1 ? '' : 's') + ' started again; they are stopped again at the next boot');
            return {id: 'telemetry', changed: true, status: state.wins.telemetry.status, dns: dns};
        });
    });
};

// AirPlay: the two "do not start" files for the receiver's units, the units stopped, the web app stopped. Off removes
// the files and starts the receiver again. Credit: zabique (see the header).
Wins.prototype.airplay = function (on) {
    var self = this;
    this.save({airplay: on});
    return this.execute(wrap(on ? AIRPLAY_OFF : AIRPLAY_ON), 20000).then(check).then(function () { return self.read(); }).then(function (state) {
        var st = state.wins.airplay.status;
        if (on && st !== 'on') throw Error(st === 'partial' ? 'AirPlay was started again right away; it is stopped again at the next boot' : 'The TV did not keep the change');
        if (!on && st !== 'off') throw Error('The TV did not keep the change');
        return {id: 'airplay', changed: true, status: st};
    });
};

// After each boot: HbbTV's flag lives in /tmp and AmbientApp is started by the firmware 15 s after boot,
// so both are handled here, once the TV adapter is connected. AirPlay's files survive a boot; its web app is
// stopped if something starts it in the first minutes. Resolves with what it did.
Wins.prototype.boot = function (hbbtv) {
    var self = this, mine = this.load(), did = [], id = this.bootId();
    var start = mine.hbbtv && hbbtv ? hbbtv.enforce().then(function (r) { if (r && r.stopped) did.push('hbbtv'); }, function () {}) : Promise.resolve();
    return Promise.all([start, self.bootTelemetry(mine, id, did), self.bootAmbient(mine, id, did), self.bootAirplay(mine, did)]).then(function () { return did; });
};

Wins.prototype.bootAirplay = function (mine, did) {
    var self = this;
    if (!mine.airplay) return Promise.resolve();
    var n = 0;
    function chosen() { return self.changing !== 'airplay' && self.load().airplay; }
    function poll() {
        if (!chosen()) return Promise.resolve();
        return self.execute(wrap(AIRPLAY_WEB_RUNNING + ' && echo up || echo down'), 8000).then(function (r) {
            if (!chosen()) return;
            if (UP_RE.test(r.stdout || '') && !r.exit_code) {
                return self.execute(wrap(AIRPLAY_WEB_STOP + '\nsleep 1\ntrue'), 12000).then(function () { if (chosen()) did.push('airplay'); });
            }
            if (++n >= BOOT_POLLS) return null;
            return self.sleep(BOOT_POLL_MS).then(poll);
        }, function () {
            if (++n >= BOOT_POLLS) return null;
            return self.sleep(BOOT_POLL_MS).then(poll);
        });
    }
    return poll();
};

// Some of these services start a minute or more after the TV answers, so the stop is repeated once.
Wins.prototype.bootTelemetry = function (mine, id, did) {
    var self = this;
    if (!mine.telemetry || (id && mine.telemetryBoot === id)) return Promise.resolve();
    function chosen() { return self.changing !== 'telemetry' && self.load().telemetry; }
    function pass() {
        if (!chosen()) return Promise.resolve(false);
        return self.execute(wrap(TELEMETRY_OFF), 30000).then(function (r) { check(r); return true; }, function () { return false; });
    }
    return pass().then(function () { return self.sleep(TELEMETRY_RETRY_MS); }).then(pass).then(function (applied) {
        if (!applied || !chosen()) return;
        did.push('telemetry');
        if (id) self.save({telemetryBoot: id});
    });
};

Wins.prototype.bootAmbient = function (mine, id, did) {
    var self = this;
    if (self.skipAmbient || !mine.ambient || (id && mine.ambientBoot === id)) return Promise.resolve();
    var n = 0;
    function poll() {
        if (self.changing === 'ambient' || !self.load().ambient) return Promise.resolve();
        return self.execute(wrap(running(AMBIENT_ID) + ' && echo up || echo down'), 8000).then(function (r) {
            if (self.changing === 'ambient' || !self.load().ambient) return;
            if (UP_RE.test(r.stdout || '') && !r.exit_code) {
                return self.execute(wrap(AMBIENT_OFF + '\nsleep 1\ntrue'), 15000).then(function (r) {
                    check(r);
                    if (!self.load().ambient) return;
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
    return poll();
};

module.exports = {Wins: Wins, stop: stop, parse: parse, IDS: IDS, FILE: FILE, AUTOUPDATE: AUTOUPDATE, MULTISCREEN_FLAG: MULTISCREEN_FLAG, AMBIENT_ID: AMBIENT_ID, TELEMETRY_HOST: TELEMETRY_HOST, TELEMETRY_UNITS: TELEMETRY_UNITS, TELEMETRY_BRAKES: TELEMETRY_BRAKES, MULTISCREEN_ID: MULTISCREEN_ID,
    AIRPLAY_FLAGS: AIRPLAY_FLAGS, AIRPLAY_UNITS: AIRPLAY_UNITS, currentBoot: currentBoot};
