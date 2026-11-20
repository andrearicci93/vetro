'use strict';
// Quick wins that are not app groups: each one is a single, reversible change that frees memory
// or stops the TV from changing itself. Verified against the Q80A firmware (T-NKM2DEUC-2301.1)
// by reading its files; the effect of each change on a running TV has not been measured.
//
//   firmware  Not just "Auto update". The menu value (db/menu/support/softwareupdate/autoupdate) is read by the
//             SWU daemons, but it does not stop the background loop: SWUAutoUpgrade still chooses a background
//             strategy when it is 0, and three other services never look at it at all (app/package updates,
//             EMP/app-binary updates, VD system components). So this win blocks the whole update stack while it is
//             on: the SWU units, the Web App Service background updater, the EMP/app-binary manager, the VD system
//             update manager, the preview updater and the boot-time staged-image apply; it also turns the two vconf
//             switches off and removes the download markers. Masking is --runtime (the rootfs is mounted ro) and is
//             re-applied after every boot. The installers (swu-core-tv, swu-service) are stopped as well as masked:
//             the firmware has two complete boot slots (PLATFORM0/1, KERNEL0/1 in etc/include/partition.txt on 6.0,
//             6.5 and 9), so an interrupted write cannot damage the slot the TV is running, and SWU applies the image
//             while it downloads. The lock is also put in place before the TV's own boot services: AT-HUB runs
//             /opt/etc/parseinfo.sh as root at ~10 s, before the SWU timer (120 s) and the path-activated updaters,
//             so while the win is on that vendor script is replaced by a small awk one that applies the same lock
//             (the original is kept as parseinfo.sh.vetro-orig and restored when the win is turned off). It acts only
//             while the choice is saved and the app is still installed; it is installed only where the file is the
//             known one (or a bash script that writes /proc/target_version); on other firmware the lock still starts
//             with Vetro's root agent. swu-standalone.* is left alone: it is the USB recovery path.
//             Evidence: topics/firmware-update-channels.md in the private wiki (dump + live Q80A, 2026-11-19 and
//             2026-11-20). Tried on a Q80A fw 2310.0 after a cold reboot: the masks were in place 15 s after boot,
//             before Vetro's service; other models are not tried. A firmware update that lands anyway replaces
//             everything this win did.
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
// Every service that can change the TV's own software. SWU: OTA/OTN firmware (timer, path, verifier, downloader,
// installer). was-background-update: app/package updates pushed in the background. fw-update-service and
// appbinary-manager: app-binary (EMP) downloads. vdsystem-update-manager: VD system components. preview-updater:
// Samsung's preview app. bootmode-system-update: applies an already staged image at boot.
var FWUNITS = ['swu-auto-upgrade.timer', 'swu-auto-upgrade.path', 'swu-auto-upgrade.service',
    'swu-verifier-tv.timer', 'swu-verifier-tv.service', 'swu-core-tv.service', 'swu-service.service',
    'was-background-update.path', 'was-background-update.service', 'fw-update-service.path', 'fw-update-service.service',
    'appbinary-manager.service', 'vdsystem-update-manager.timer', 'vdsystem-update-manager.service',
    'com.samsung.tv.preview-updater.service', 'bootmode-system-update.service'];
// Present on 6.0 and later; missing keys stay untouched.
var FWSERVICE = 'db/fw-update-service/service_onoff';
// Files the update stacks look at before they download or install. All on tmpfs; removing them is harmless.
var FWMARKERS = ['/tmp/fw_update_ready', '/tmp/.fw_download_ready', '/run/user/5001/.swu-auto-upgrade-launch'];
// The four markers the boot waits for (system graphical, user default, system delayed, user delayed). Creating them at
// ~10 s lets wait-target-done return immediately; the vendor units still fail, so their targets are not delayed.
var BOOT_MARKERS = ['/run/systemd/system/graphical.target.done', '/run/systemd/system/delayed.target.done',
    '/run/user/5001/systemd/default.target.done', '/run/user/5001/systemd/delayed.target.done'];
// The early root execution point (AT-HUB.service, ~10 s). The vendor script only writes /proc/target_version; the
// replacement does the same and applies quick boot and/or the update lock before the boot continues.
var FW_HOOK = '/opt/etc/parseinfo.sh';
var FW_HOOK_BAK = FW_HOOK + '.vetro-orig';
var FW_HOOK_MARK = 'VETRO_UPDATE_LOCK_HOOK';
// parseinfo.sh of the Q80A dump and live Q80A (805 bytes); other firmware is accepted only if it is still the same
// kind of script (bash, /proc/target_version, small), because the replacement is written over it.
var FW_HOOK_SHA = 'c6369e7dec69408e176daa252d436acf6f8e265f560504d8bd831c8023c71d61';
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
var IDS = ['firmware', 'quickboot', 'multiscreen', 'ambient', 'telemetry', 'airplay'];
var BOOT_POLL_MS = 10000, BOOT_POLLS = 36, TELEMETRY_RETRY_MS = 45000, FIRMWARE_RETRY_MS = 30000;

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
    'echo "FWS|$(vconftool get ' + FWSERVICE + ' 2>&1)"',
    'systemctl show -p Id -p LoadState -p ActiveState ' + FWUNITS.join(' ') + ' 2>/dev/null | awk -F= \'/^Id=/{id=$2} /^LoadState=/{l=$2} /^ActiveState=/{print "LS|" id "|" l "|" $2}\'',
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
    '[ -f ' + FW_HOOK + ' ] && grep -q ' + FW_HOOK_MARK + ' ' + FW_HOOK + ' 2>/dev/null && echo "QB|1" || echo "QB|0"',
    'true'
].join('\n');

// Everything the wins depend on, from one read-only call. A line that is missing stays null.
function parse(text) {
    var out = {autoupdate: null, fwService: null, fwUnits: {}, multiscreenFlag: null, multiscreenRunning: null, ambientRunning: null, telemetryBrakes: null, telemetryRunning: null,
        airplayPresent: null, airplayFlag: null, airplayService: null, airplayWeb: null, quickbootHook: null};
    String(text || '').split('\n').forEach(function (line) {
        var f = line.replace(CR_END_RE, '').split('|');
        if (f[0] === 'AU') { var m = VCONF_INT32_RE.exec(f.slice(1).join('|')); if (m) out.autoupdate = Number(m[1]); }
        else if (f[0] === 'FWS') { var n = VCONF_INT32_RE.exec(f.slice(1).join('|')); if (n) out.fwService = Number(n[1]); }
        else if (f[0] === 'LS' && f[1]) out.fwUnits[f[1]] = {load: f[2] || '', active: f[3] || ''};
        else if (f[0] === 'MS') out.multiscreenFlag = f[1] === '1';
        else if (f[0] === 'MR') out.multiscreenRunning = f[1] === '1';
        else if (f[0] === 'AR') out.ambientRunning = f[1] === '1';
        else if (f[0] === 'TB' && DIGITS_RE.test(f[1])) out.telemetryBrakes = Number(f[1]);
        else if (f[0] === 'TR' && DIGITS_RE.test(f[1])) out.telemetryRunning = Number(f[1]);
        else if (f[0] === 'AP') out.airplayPresent = f[1] === '1';
        else if (f[0] === 'AF') out.airplayFlag = f[1] === '1';
        else if (f[0] === 'AS') out.airplayService = (f[1] || '').trim() === 'active';
        else if (f[0] === 'AW') out.airplayWeb = f[1] === '1';
        else if (f[0] === 'QB') out.quickbootHook = f[1] === '1';
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
            firmware: o.firmware === true, quickboot: o.quickboot === true,
            telemetryBoot: typeof o.telemetryBoot === 'string' ? o.telemetryBoot : null,
            autoupdatePrevious: Number.isInteger(o.autoupdatePrevious) && o.autoupdatePrevious > 0 ? o.autoupdatePrevious : null,
            fwServicePrevious: Number.isInteger(o.fwServicePrevious) ? o.fwServicePrevious : null,
            firmwareBoot: typeof o.firmwareBoot === 'string' ? o.firmwareBoot : null,
            ambientBoot: typeof o.ambientBoot === 'string' ? o.ambientBoot : null
        };
    } catch (e) { return {hbbtv: false, ambient: false, telemetry: false, telemetryDns: false, airplay: false, firmware: false, quickboot: false, telemetryBoot: null, autoupdatePrevious: null, fwServicePrevious: null, firmwareBoot: null, ambientBoot: null}; }
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
        var firmware = s.autoupdate === null ? {status: 'unknown'} : fwState(s);
        var multiscreen = s.multiscreenFlag === null ? {status: 'unknown'} : {status: s.multiscreenFlag ? 'on' : 'off', running: s.multiscreenRunning === true};
        var ambient = s.ambientRunning === null ? {status: 'unknown'}
            : {status: !mine.ambient ? 'off' : s.ambientRunning ? 'partial' : 'on', running: s.ambientRunning, chosen: mine.ambient};
        var telemetry = s.telemetryRunning === null ? {status: 'unknown'}
            : {status: !mine.telemetry ? 'off' : s.telemetryRunning ? 'partial' : 'on', running: s.telemetryRunning, brakes: s.telemetryBrakes, chosen: mine.telemetry};
        // on: the flag files are there and nothing of the receiver runs; partial: the files are there but something runs.
        var airplay = s.airplayPresent !== true || s.airplayFlag === null ? {status: 'unknown'}
            : {status: !s.airplayFlag ? 'off' : (s.airplayService || s.airplayWeb) ? 'partial' : 'on',
               running: s.airplayService === true || s.airplayWeb === true};
        var quickboot = s.quickbootHook === null ? {status: 'unknown'}
            : {status: !mine.quickboot ? 'off' : s.quickbootHook ? 'on' : 'partial'};
        var wins = {firmware: firmware, quickboot: quickboot, multiscreen: multiscreen, ambient: ambient, telemetry: telemetry, airplay: airplay};
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
        return id === 'firmware' ? self.firmware(on) : id === 'quickboot' ? self.quickboot(on) : id === 'multiscreen' ? self.multiscreen(on) : id === 'telemetry' ? self.telemetry(on) : id === 'airplay' ? self.airplay(on) : self.ambient(on);
    });
    return task.then(function (result) { self.busy = false; self.changing = null; return result; }, function (e) { self.busy = false; self.changing = null; throw e; });
};

// The units cannot be renamed (the rootfs is mounted ro) and a plain "disable" is overridden by their targets, so they
// are masked at runtime: /run/systemd/system is tmpfs, systemd honours it at once, and the mask is gone on reboot
// (bootFirmware puts it back). swu-standalone stays out of the list: it is the USB recovery path.
function fwState(s) {
    var known = 0, masked = 0, running = 0;
    FWUNITS.forEach(function (u) {
        var x = s.fwUnits && s.fwUnits[u];
        if (!x || !x.load || x.load === 'not-found') return;
        known++;
        if (x.load === 'masked') masked++;
        if (x.active === 'active' || x.active === 'activating') running++;
    });
    // No service_onoff key means this TV has no EMP/app-binary service: that half is then not required.
    var serviceOk = s.fwService === null || s.fwService === 0;
    var on = s.autoupdate === 0 && serviceOk && (known === 0 || masked === known);
    // Off means no lock of Vetro's: no unit masked. Samsung's own Auto update value is then the owner's setting, whatever it is.
    // Firmware without any of the units falls back to the 0.5.0 meaning, the Auto update value alone.
    var off = known === 0 ? s.autoupdate !== 0 : masked === 0;
    return {status: s.autoupdate === null ? 'unknown' : on ? 'on' : off ? 'off' : 'partial',
        value: s.autoupdate, masked: masked, units: known, running: running};
}

// Only the boot-mode oneshot is never stopped: it is already isolating system-update.target, so a stop would not
// cancel it and only the next boot matters, where the mask is in place. The installers are stopped as well (the two
// boot slots make it safe); masked, a unit cannot start again.
var FW_NOSTOP = ['bootmode-system-update.service'];
function fwStoppable() { return FWUNITS.filter(function (u) { return FW_NOSTOP.indexOf(u) < 0; }); }
function fwMaskScript(stop) {
    // --runtime only: a plain mask would be written to /etc and outlive Vetro (and Restore), so a TV whose /etc is writable could
    // never update again. A unit that cannot be masked at runtime shows in the readback as not masked.
    // Masks first, then the stops, so a timer cannot start its unit again in between. One mask call for all units: each call reloads
    // systemd (~2 s at boot on the Q80A, 16 calls took 12.5 -> 39.3 s and swu-verifier-tv ran meanwhile); systemd 244 masks a unit
    // this firmware lacks with a warning and rc 0, and the per-unit loop is only the fallback.
    return 'set +e\n' +
        'systemctl mask --runtime ' + FWUNITS.join(' ') + ' >/dev/null 2>&1 || for u in ' + FWUNITS.join(' ') + '; do systemctl mask --runtime $u >/dev/null 2>&1; done\n' +
        (stop ? 'for u in ' + fwStoppable().join(' ') + '; do systemctl stop --no-block $u >/dev/null 2>&1; done\n' : '') +
        'rm -f ' + FWMARKERS.join(' ') + ' 2>/dev/null\n' +
        'true';
}
function fwUnmaskScript() {
    return 'set +e\n' +
        'systemctl unmask --runtime ' + FWUNITS.join(' ') + ' >/dev/null 2>&1\n' +
        'systemctl reset-failed ' + FWUNITS.join(' ') + ' >/dev/null 2>&1\n' +
        // Start again what the boot sequence would have started; the rest comes back through D-Bus when needed.
        'systemctl start --no-block swu-auto-upgrade.timer swu-verifier-tv.service was-background-update.path ' +
        'fw-update-service.path vdsystem-update-manager.timer appbinary-manager.service >/dev/null 2>&1\n' +
        'true';
}
function fwSet(key, value) {
    return 'vconftool set -f -t int ' + key + ' ' + value + ' >/dev/null 2>&1';
}

// The AT-HUB hook (see the header): quick boot's four markers and/or the update lock at ~10 s, then the vendor
// behaviour (the /proc/target_version write). Each part runs only while its saved choice is on and Vetro is
// installed, so turning the wins off, Restore the TV or removing the app stops the next boot from acting.
function fwHookScript() {
    return '#!/usr/bin/awk -f\n' +
        '# ' + FW_HOOK_MARK + ' - Vetro applies quick boot and/or the update lock before the boot continues.\n' +
        '# The replaced vendor script is kept in ' + FW_HOOK_BAK + ' and put back when the win is turned off.\n' +
        'BEGIN {\n' +
        '    lock = 0; boot = 0\n' +
        '    if (system("[ -d /opt/usr/apps/vetrotvapp ]") == 0) {\n' +
        '        while ((getline l < "' + FILE + '") > 0) { if (l ~ /"firmware"[ \\t]*:[ \\t]*true/) lock = 1; if (l ~ /"quickboot"[ \\t]*:[ \\t]*true/) boot = 1 }\n' +
        '        close("' + FILE + '")\n' +
        '    }\n' +
        '    if (boot) system("/usr/bin/touch ' + BOOT_MARKERS.join(' ') + ' 2>/dev/null")\n' +
        '    if (lock) {\n' +
        '        system("/usr/bin/systemctl mask --runtime ' + FWUNITS.join(' ') + ' >/dev/null 2>&1 || for u in ' + FWUNITS.join(' ') + '; do /usr/bin/systemctl mask --runtime $u >/dev/null 2>&1; done")\n' +
        '        system("/usr/bin/systemctl stop --no-block ' + fwStoppable().join(' ') + ' >/dev/null 2>&1")\n' +
        '        system("/bin/rm -f ' + FWMARKERS.join(' ') + ' >/dev/null 2>&1")\n' +
        '    }\n' +
        '    repo = ""; model = ""\n' +
        '    while ((getline l < "/etc/prd_info.ini") > 0) {\n' +
        '        if (l ~ /^Build=/) { split(l,a,"="); v=a[2]; sub(/;.*/,"",v); repo=v }\n' +
        '        if (l ~ /^Model=/) { split(l,a,"="); v=a[2]; sub(/;.*/,"",v); model=v }\n' +
        '    }\n' +
        '    close("/etc/prd_info.ini")\n' +
        '    printf "__%s__%s\\n", repo, model > "/proc/target_version"\n' +
        '    close("/proc/target_version")\n' +
        '    exit 0\n' +
        '}\n';
}
// Replaces the vendor file once; the original is copied first and restored by fwHookRemoveScript. The write is skipped
// unless the file is the known script or a tiny bash script whose only job is the same /proc/target_version write; the
// backup is refreshed after a firmware update so Off puts back the script that firmware shipped.
function fwHookInstallScript() {
    var body = Buffer.from(fwHookScript()).toString('base64');
    return 'set +e\n' +
        'F=' + FW_HOOK + '\n' +
        'B=' + FW_HOOK_BAK + '\n' +
        'H=' + body + '\n' +
        'if [ ! -f "$F" ]; then echo "vetro-hook: no parseinfo"; exit 0; fi\n' +
        // Our own hook from an earlier Vetro is brought up to this one (the backup of the vendor script is already there).
        'if grep -q ' + FW_HOOK_MARK + ' "$F" 2>/dev/null; then echo "$H" | base64 -d > "$F.vetro" && ' +
        'if [ "$(sha256sum "$F.vetro" | cut -d" " -f1)" = "$(sha256sum "$F" | cut -d" " -f1)" ]; then rm -f "$F.vetro"; else chmod 755 "$F.vetro" && mv "$F.vetro" "$F"; fi; ' +
        'echo "vetro-hook: installed"; exit 0; fi\n' +
        'S=$(sha256sum "$F" 2>/dev/null | cut -d" " -f1); OK=0\n' +
        '[ "$S" = "' + FW_HOOK_SHA + '" ] && OK=1\n' +
        'if [ $OK -eq 0 ] && [ "$(wc -l < "$F")" -le 8 ] && head -1 "$F" | grep -q "^#!/bin/bash" && grep -q /proc/target_version "$F" && [ "$(wc -c < "$F")" -le 4096 ]; then OK=1; fi\n' +
        'if [ $OK -eq 0 ]; then echo "vetro-hook: unknown parseinfo"; exit 0; fi\n' +
        'if [ -f "$B" ] && [ -n "$S" ] && [ "$(sha256sum "$B" 2>/dev/null | cut -d" " -f1)" = "$S" ]; then :; else cp -p "$F" "$B" || { echo "vetro-hook: backup failed"; exit 0; }; fi\n' +
        'echo "$H" | base64 -d > "$F.vetro" && chmod 755 "$F.vetro" && mv "$F.vetro" "$F" && echo "vetro-hook: installed" || echo "vetro-hook: write failed"\n' +
        'true';
}
// Only puts back our own replacement, so a script the owner or a firmware update changed is left alone.
function fwHookRemoveScript() {
    return 'set +e\n' +
        'F=' + FW_HOOK + '\n' +
        'B=' + FW_HOOK_BAK + '\n' +
        'if [ -f "$B" ] && grep -q ' + FW_HOOK_MARK + ' "$F" 2>/dev/null; then cp -p "$B" "$F" && rm -f "$B" && echo "vetro-hook: restored"; ' +
        'else echo "vetro-hook: unchanged"; fi\n' +
        'true';
}

// Installs or removes the shared early hook according to the saved choices. true only while the hook is installed.
Wins.prototype.ensureHook = function () {
    var mine = this.load(), wanted = !!(mine.firmware || mine.quickboot);
    return this.execute(wrap(wanted ? fwHookInstallScript() : fwHookRemoveScript()), 20000).then(function (r) {
        return wanted && !!r && !r.exit_code && !r.timed_out && /vetro-hook: installed/.test(r.stdout || '');
    }, function () { return false; });
};

// One read for the values that must be remembered, then the lock or the undo, then a readback. A failure on the way
// in puts the previous switches and masks back; the error says what happened.
Wins.prototype.firmware = function (on) {
    var self = this;
    function current() { return self.execute(wrap(READ), 15000).then(function (r) { return parse(check(r)); }); }
    function setKey(key, value) { return self.execute(wrap(fwSet(key, value)), 6000); }
    var hookOn = false;
    // Installs the shared hook if the other win is still on; removes it only when both are off.
    function setHook() { return self.ensureHook().then(function (v) { hookOn = v; return v; }); }
    function lock(before) {
        var svc = before.fwService !== null ? '\n' + fwSet(FWSERVICE, 0) : '';
        return self.execute(wrap(fwMaskScript(true) + '\n' + fwSet(AUTOUPDATE, 0) + svc + '\ntrue'), 30000).then(function (r) {
            if (r.exit_code || r.timed_out) throw Error('The TV refused the update lock');
        }).then(function () { return setHook(); });
    }
    function undo() {
        // Only values Vetro saved are written back: an owner who had Auto update off before the lock keeps it off.
        var mine = self.load();
        return self.execute(wrap(fwUnmaskScript()), 30000).then(function () { return setHook(); }).then(function () {
            return mine.autoupdatePrevious ? setKey(AUTOUPDATE, mine.autoupdatePrevious) : null;
        }).then(function () {
            return mine.fwServicePrevious !== null ? setKey(FWSERVICE, mine.fwServicePrevious) : null;
        });
    }
    return current().then(function (before) {
        var state = fwState(before), mine = self.load();
        // 0.5.0 turned Auto update off and saved the value it had; it masked nothing, so the switch reads off. Turning it off (Restore
        // the TV) still puts that value back, once.
        var leftover = !on && state.status === 'off' && !!mine.autoupdatePrevious && before.autoupdate === 0;
        if (!leftover && (on ? state.status === 'on' : state.status === 'off')) {
            // A TV that is already locked still gets the early hook: an upgrade can have restored the vendor script.
            // Off also keeps it when quick boot is on, so the shared hook state is read either way.
            return self.ensureHook().then(function (early) {
                return {id: 'firmware', changed: false, status: state.status, value: before.autoupdate, hook: !!early};
            });
        }
        // A value of 0 found now may be an earlier lock's (a reboot whose re-apply failed): the value saved then is kept.
        if (on) self.save({firmware: true, autoupdatePrevious: before.autoupdate > 0 ? before.autoupdate : self.load().autoupdatePrevious,
            fwServicePrevious: before.fwService > 0 ? before.fwService : self.load().fwServicePrevious});
        else self.save({firmware: false, firmwareBoot: null});
        return (on ? lock(before) : undo()).then(current).then(function (after) {
            var st = fwState(after);
            if (on && st.status !== 'on') throw Error('The TV did not keep the lock (' + st.masked + ' of ' + st.units + ' update unit' + (st.units === 1 ? '' : 's') + ' masked)');
            if (!on && st.masked > 0) throw Error('The TV did not end the lock (' + st.masked + ' of ' + st.units + ' update unit' + (st.units === 1 ? '' : 's') + ' still masked)');
            // The values are back: forgotten, so a later Off or Restore never writes an old value over one the owner chose since.
            if (!on) self.save({autoupdatePrevious: null, fwServicePrevious: null});
            return {id: 'firmware', changed: true, status: st.status, value: after.autoupdate, previous: before.autoupdate, hook: hookOn};
        }).catch(function (e) {
            // A lock that did not hold is not the owner's choice any more: the boot must not mask the units again.
            // An undo that failed is locked again below, so the boot must keep re-applying it.
            self.save(on ? {firmware: false, firmwareBoot: null} : {firmware: true});
            // Put the switches back the way they were found: undo if the lock failed, lock again if the undo failed.
            var back = on
                ? self.execute(wrap(fwUnmaskScript()), 30000).then(function () { return setHook(); }).then(function () {
                    return setKey(AUTOUPDATE, before.autoupdate).then(function () {
                        return before.fwService !== null && before.fwService !== undefined ? setKey(FWSERVICE, before.fwService) : null;
                    });
                })
                : self.execute(wrap(fwMaskScript(true) + '\n' + fwSet(AUTOUPDATE, 0) + '\ntrue'), 30000).then(function () { return setHook(); });
            return back.then(function () { return current(); }).then(function (now) {
                var restored = now.autoupdate === before.autoupdate && (before.fwService === null || now.fwService === before.fwService) &&
                    (on ? fwState(now).masked === fwState(before).masked : fwState(now).status === fwState(before).status);
                throw Error(e.message + (restored ? ' · previous state restored' : ' · restore not confirmed'));
            }, function () { throw Error(e.message + ' · restore not confirmed'); });
        });
    });
};

// Quick boot: create the four boot-completion markers at ~10 s (see the header). Experimental; the shared hook is
// installed with the firmware lock, so either win keeps it and only the last one off restores the vendor script.
Wins.prototype.quickboot = function (on) {
    var self = this;
    this.save({quickboot: on});
    return this.ensureHook().then(function (installed) {
        if (on && !installed) {
            self.save({quickboot: false});
            throw Error('The early boot step is not available on this TV');
        }
        return self.read().then(function (state) {
            var st = state.wins.quickboot.status;
            if ((st === 'on') !== on) {
                if (on) {
                    self.save({quickboot: false});
                    return self.ensureHook().then(function () { throw Error('The TV did not keep quick boot'); });
                }
                throw Error('The TV did not end quick boot');
            }
            return {id: 'quickboot', changed: true, status: st, hook: installed};
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
    return Promise.all([start, self.bootFirmware(mine, id, did), self.bootTelemetry(mine, id, did), self.bootAmbient(mine, id, did), self.bootAirplay(mine, did)]).then(function () { return did; });
};

// Runtime masks live in /run, so after a boot the update units are free again: the lock is applied once per boot,
// before the SWU timer (OnActiveSec=120) and the background updater can do anything. No vconf write: that persisted.
Wins.prototype.bootFirmware = function (mine, id, did) {
    var self = this;
    if (!(mine.firmware || mine.quickboot) || (id && mine.firmwareBoot === id)) return Promise.resolve();
    // bootLock (as soon as the agent is up) and boot (after the launcher) can both arrive: one run is enough.
    if (self.fwBootBusy) return Promise.resolve();
    self.fwBootBusy = true;
    function chosen() {
        var now = self.load();
        return self.changing !== 'firmware' && self.changing !== 'quickboot' && (now.firmware || now.quickboot);
    }
    function pass() {
        if (!chosen()) return Promise.resolve(false);
        // The early hook goes in the same command: an upgrade can have put the vendor script back. Only the firmware win
        // masks the update units; quick boot alone must leave them as they are (the vendor done units still fail).
        var mask = self.load().firmware ? fwMaskScript(true) + '\n' : '';
        return self.execute(wrap(mask + fwHookInstallScript()), 30000).then(function (r) { return !!r && !r.exit_code && !r.timed_out; }, function () { return false; });
    }
    return pass().then(function (first) {
        return self.sleep(FIRMWARE_RETRY_MS).then(pass).then(function (second) {
            if (!(first || second) || !chosen()) return;
            if (mine.firmware) did.push('firmware');
            if (mine.quickboot) did.push('quickboot');
            if (id) self.save({firmwareBoot: id});
        });
    }).then(function (v) { self.fwBootBusy = false; return v; }, function (e) { self.fwBootBusy = false; throw e; });
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

// The update units (and the early hook for quick boot) can act before the launcher is ready, so this half runs as soon
// as the root agent is up.
Wins.prototype.bootLock = function () { var did = []; return this.bootFirmware(this.load(), this.bootId(), did).then(function () { return did; }); };

// Some of these services start a minute or more after the TV answers, so the stop is repeated once.
Wins.prototype.bootTelemetry = function (mine, id, did) {
    var self = this;
    if (!mine.telemetry || (id && mine.telemetryBoot === id)) return Promise.resolve();
    function chosen() { return self.changing !== 'telemetry' && self.load().telemetry; }
    // true only if the stop really ran: a command that came back with an error or a timeout is not a pass, and neither a rejection.
    function pass() {
        if (!chosen()) return Promise.resolve(false);
        return self.execute(wrap(TELEMETRY_OFF), 30000).then(function (r) { return !!r && !r.exit_code && !r.timed_out; }, function () { return false; });
    }
    return pass().then(function (first) {
        return self.sleep(TELEMETRY_RETRY_MS).then(pass).then(function (second) {
            if (!(first || second) || !chosen()) return;
            did.push('telemetry');
            if (id) self.save({telemetryBoot: id});
        });
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

module.exports = {Wins: Wins, stop: stop, parse: parse, IDS: IDS, FILE: FILE, AUTOUPDATE: AUTOUPDATE, FWSERVICE: FWSERVICE, FWUNITS: FWUNITS, FWMARKERS: FWMARKERS, FW_HOOK: FW_HOOK, fwHookScript: fwHookScript, MULTISCREEN_FLAG: MULTISCREEN_FLAG, AMBIENT_ID: AMBIENT_ID, TELEMETRY_HOST: TELEMETRY_HOST, TELEMETRY_UNITS: TELEMETRY_UNITS, TELEMETRY_BRAKES: TELEMETRY_BRAKES, MULTISCREEN_ID: MULTISCREEN_ID,
    AIRPLAY_FLAGS: AIRPLAY_FLAGS, AIRPLAY_UNITS: AIRPLAY_UNITS, currentBoot: currentBoot};
