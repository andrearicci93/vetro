'use strict';
// Runs Vetro TV Tuner (tuner/) on the TV and keeps it running while it is switched on.
//
// The tuner is a .NET process that the TV's own `dotnet` runs from this package, the same kind of part as the launcher
// (dock.js). It is not a Tizen app, so nothing restarts it: the service starts it as root through the agent in its own
// systemd unit, checks on it now and then and stops it when the switch goes off.
//
// What "replaces Samsung's tuner" means here, and what it does not:
//   * Samsung's live TV app (org.tizen.tv-viewer) is never disabled, uninstalled or changed. Disabling a system app the
//     boot waits for stalled a Q80A once (the custom launcher, see dock.js), and the tuner is a replacement for the
//     screen, not for the TV service underneath: tvs-daemon does the real work in both.
//   * The tuner runs resident and hidden, and watches the application manager. When Samsung's live TV app comes on
//     screen it puts its own window over it (--takeover). A dead tuner therefore hands the screen straight back to
//     Samsung's: the worst case of a crash is the TV as it was before.
//   * Samsung's app is not closed behind the tuner: measured on a Q80A (2026-11-08), `app_launcher -k org.tizen.tv-viewer`
//     kills it and the platform starts it again at once (a recovery launch), so nothing is freed.
//
// State lives in one small file next to the other Vetro settings.

var fs = require('fs');
var os = require('os');
var path = require('path');
var atomicFile = require('./atomic-file.js');
// Regular expressions compiled once at module load, not on every call.
var QUOTE_RE = /'/g;
var PROBE_TUNER_RE = /^tuner=(\d+)$/m;
var PROBE_FLAG_RE = /^(client|tvs|dotnet|viewer)=([01])$/gm;       // stateful: reset lastIndex before each use
var LOG_SPLIT = 'log:\n';

var SHARE = '/opt/usr/home/owner/share';
var STATE_FILE = SHARE + '/vetro-tuner.json';
var RUN_DIR = '/home/owner';                          // the tuner's own pid and log, next to the launcher's
var PID_FILE = RUN_DIR + '/vetro-tuner.pid';
var LOG_FILE = RUN_DIR + '/vetro-tuner.log';
var CONTROL = '/tmp/vetro-tuner.ctl';                 // the pipe a resident tuner listens on (created by the tuner, mode 0666)
var FEATURES_FILE = SHARE + '/vetro-tuner-features';  // "name=0" lines the tuner re-reads without a restart; today only "motion=0" (Reduce motion)
var DLL = 'vetro-tuner.dll';
var UNIT = 'vetro-tuner';                             // the tuner's own systemd unit
var TARGET_APP = 'org.tizen.tv-viewer';               // Samsung's live TV app
var CLIENT_ROOT = '/opt/usr/dotnet/Tizen.TV.Broadcast.TVService';
var CLIENT_GLOB = CLIENT_ROOT + '/*/Tizen.TV.Broadcast.TVService.dll';
// The tuner also loads the client from the firmware's shared library folders (tuner/src/Tvs/TvsClient.cs FixedDirs): on 2022 firmware
// (an S95B, 1720.7) there is no CLIENT_ROOT at all and the client sits in /usr/share/dotnet.tizen/framework (2026-11-19 export).
var CLIENT_ELSEWHERE = ['/usr/share/dotnet.tizen/framework', '/usr/apps/*/shared/res', '/usr/apps/*/bin', '/usr/apps/*/lib', '/opt/usr/apps/*/bin',
    '/opt/usr/apps/*/shared/res'].map(function (d) { return d + '/Tizen.TV.Broadcast.TVService.dll'; });
var CLIENT_FIXED = ['/usr/share/dotnet.tizen/framework/Tizen.TV.Broadcast.TVService.dll', '/usr/apps/csapi-tv-tizenfx/shared/lib/Tizen.TV.Broadcast.TVService.dll'];
var CLIENT_VERSION_RE = /^\d+(?:\.\d+){0,3}$/;
var START_WAIT_MS = 15000;
var BOOT_WAIT_MS = 75000;                             // a start in the first minutes after a TV boot is slow
var BOOT_WINDOW_S = 300;
var RETRY_FIRST_MS = 30000;
var RETRY_MAX_MS = 300000;
// A tuner found gone this soon after a start died at start (a client that throws, a TV it cannot read): that start counts as failed,
// so the back-off grows instead of a dotnet start every supervision round.
var QUICK_DEATH_MS = 60000;
// What a dashboard may ask a running tuner to do: each word is a command of its control pipe, nothing else gets through.
var COMMANDS = {show: 'show', hide: 'hide', toggle: 'toggle', guide: 'guide'};

function wrap(s) { return 'echo ' + Buffer.from(s).toString('base64') + ' | base64 -d | sh'; }
function q(s) { return "'" + String(s).replace(QUOTE_RE, "'\\''") + "'"; }

// The cheap "is it running" check, the same one-line, builtins-only check as the launcher's (dock.js runningCheck): one shell
// on the TV instead of the dozen processes of the full probe, which also reads the prerequisites and the log.
var dockShell = require('./dock.js');

function check(r, what) {
    if (!r || r.exit_code || r.timed_out) throw new Error((r && (r.stderr || r.stdout)) || what + ' failed');
    return r.stdout || '';
}

function Tuner(options) {
    options = options || {};
    this.execute = options.execute;
    this.dir = options.dir || path.join(__dirname, '..', 'native', 'tuner');
    this.stateFile = options.stateFile || STATE_FILE;
    this.featuresFile = options.featuresFile || FEATURES_FILE;
    this.sleep = options.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    this.now = options.now || Date.now;
    this.onChange = options.onChange || function () {};   // told after the tuner is switched on or off (main.js: the remote bridge's key list includes Guide while the tuner is on)
    this.uptime = options.uptime || function () { return os.uptime(); };
    this.busy = false;
    this.failures = 0;
    this.nextTry = 0;
    this.lastError = null;
    this.build = options.build || null;         // this Vetro build: a tuner started by another one is restarted (supervise)
    this.noMotion = options.noMotion || null;   // the launcher's Reduce motion setting: the tuner follows it
    this.hdrDim = options.hdrDim || null;       // the launcher's HDR dimming setting: the tuner follows it
    this.cheapBroken = false;                   // as for the launcher: the full probe found running a pid the cheap check did not
    this.changes = 0;                           // counts starts and stops: the supervision goes back to its short interval when it moves
    // First start of this service run, in seconds since the TV booted (as the launcher's bootTimeline): serviceStart, agentSeen,
    // startIssued, startCallMs (how long the start script took), startTimedOut, running. Kept in memory, shown with the status.
    this.serviceStart = options.serviceStart !== undefined ? options.serviceStart : Math.round((this.uptime() - process.uptime()) * 10) / 10;
    this.timeline = {serviceStart: this.serviceStart};
}

Tuner.prototype.mark = function (step, value) {
    if (this.timeline[step] === undefined) this.timeline[step] = value === undefined ? Math.round(this.uptime() * 10) / 10 : value;
};

// The files the TV runs and draws with: the assembly and the pictures that sit next to it (the veil stands for them all).
Tuner.prototype.installed = function () {
    try { return fs.existsSync(path.join(this.dir, DLL)) && fs.existsSync(path.join(this.dir, 'res', 'veil_corner.png')); }
    catch (e) { return false; }
};

Tuner.prototype.readState = function () {
    try {
        var s = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
        // A state saved by a test build may still list parts switched off one by one ("off"): those switches are gone, and
        // the tuner is whole again (the list is not read, and the next save drops it).
        var state = {enabled: !!s && s.enabled === true, since: s && typeof s.since === 'number' ? s.since : null};
        if (s && typeof s.build === 'string') state.build = s.build;   // the Vetro build that last started the tuner
        if (s && typeof s.buildPid === 'number') state.buildPid = s.buildPid;   // and the process it started
        return state;
    } catch (e) { return {enabled: false, since: null}; }
};

Tuner.prototype.writeState = function (state) {
    try { atomicFile.write(fs, this.stateFile, JSON.stringify(state)); }
    catch (e) { throw new Error('The tuner setting could not be saved: ' + e.message); }
};

// Change some fields of the saved state and keep the rest.
Tuner.prototype.patchState = function (patch) {
    this.writeState(Object.assign({}, this.readState(), patch));
};

// The file the tuner reads while it runs. The tuner is one thing: on, it has all its parts (the per-part test switches are
// gone). What is left in the file is Reduce motion, one setting for every Vetro screen on the TV: it follows the launcher's.
// Written when that setting changes and before every start.
Tuner.prototype.writeFeatures = function () {
    var lines = [];
    var still = false;
    try { still = !!(this.noMotion && this.noMotion()); } catch (e) { /* unreadable launcher state: motion stays on */ }
    if (still) lines.push('motion=0');
    var hdr = null;
    try { hdr = this.hdrDim && this.hdrDim(); } catch (e) { /* unreadable launcher state: hdr dim stays off */ }
    if (hdr && hdr.enabled === true) {
        lines.push('hdr_dim=1');
        if (typeof hdr.brightness === 'number' && hdr.brightness >= 20 && hdr.brightness <= 100) lines.push('hdr_brightness=' + Math.round(hdr.brightness));
    }
    if (hdr && typeof hdr.uiBrightness === 'number' && hdr.uiBrightness >= 20 && hdr.uiBrightness < 100) {
        lines.push('ui_brightness=' + Math.round(hdr.uiBrightness));
    }
    try { atomicFile.write(fs, this.featuresFile, lines.join('\n') + (lines.length ? '\n' : '')); }
    catch (e) { throw new Error('The tuner switches could not be saved: ' + e.message); }
};

// What is running, and whether this TV can run the tuner at all, in one read. Only the tuner's own pid counts, and only if
// that pid is our dll. The tuner needs three things from the TV: the firmware's `dotnet`, Samsung's managed TV client (a
// version folder of it, any version) and the tuner service itself (tvs-daemon). Without them it would start and find
// nothing to tune, so the switch is refused there. Only a Q80A with a DVB-T tuner has been seen working.
Tuner.prototype.probe = function () {
    var self = this;
    var script = [
        'p=$(cat ' + PID_FILE + ' 2>/dev/null)',
        'if [ -n "$p" ] && tr "\\0" " " < /proc/$p/cmdline 2>/dev/null | grep -q ' + DLL + '; then echo "tuner=$p"; else echo "tuner="; fi',
        'if ls ' + CLIENT_GLOB + ' >/dev/null 2>&1' + CLIENT_FIXED.map(function (f) { return ' || [ -e ' + f + ' ]'; }).join('') + '; then echo client=1; else echo client=0; fi',
        'if pidof tvs-daemon >/dev/null 2>&1; then echo tvs=1; else echo tvs=0; fi',
        'if [ -x /usr/bin/dotnet ]; then echo dotnet=1; else echo dotnet=0; fi',
        'if [ -e /usr/apps/' + TARGET_APP + ' ]; then echo viewer=1; else echo viewer=0; fi',
        // The version folders of Samsung's client, for the diagnostic report (which versions exist on which firmware is not known yet).
        'echo "clientver=$(ls ' + CLIENT_ROOT + ' 2>/dev/null | tr "\\n" ",")"',
        // What the client's folder holds, relative to it, for the report: on Tizen 9 the version folders exist but hold no .dll at all
        // (the S95C and S95F reports of 2026-11-18). Names only, at most 12.
        'echo "clientdll=$(cd ' + CLIENT_ROOT + ' 2>/dev/null && find . -maxdepth 4 ! -type d 2>/dev/null | sed "s|^\\./||" | head -n 12 | tr "\\n" ",")"',
        // Where else the firmware keeps the client, for the report: the shared library folders and the Samsung apps that carry a copy (an
        // S95B had it in /usr/share/dotnet.tizen/framework, /usr/apps/<app>/shared/res and /opt/usr/apps/<app>/bin). Fixed patterns, no
        // walk of /usr/apps: a find there took longer than the probe's 8 s on a Tizen 9 S90D and left the tuner's status empty.
        self._clientElsewhere ? '' : 'if ! ls ' + CLIENT_GLOB + ' >/dev/null 2>&1; then echo "clientelse=$(ls -d ' + CLIENT_ELSEWHERE.join(' ') + ' 2>/dev/null | head -n 6 | tr "\\n" ",")"; fi',
        // No log file yet is normal: without || true the missing file would fail the whole read.
        'echo "log:"; tail -n 6 ' + LOG_FILE + ' 2>/dev/null || true'
    ].join('\n');
    return this.execute(wrap(script), 8000).then(function (r) {
        var out = check(r, 'Status');
        var pid = PROBE_TUNER_RE.exec(out), flags = {}, m;
        PROBE_FLAG_RE.lastIndex = 0;
        while ((m = PROBE_FLAG_RE.exec(out))) flags[m[1]] = m[2] === '1';
        var tail = out.split(LOG_SPLIT)[1];
        var versions = /^clientver=(.*)$/m.exec(out), dlls = /^clientdll=(.*)$/m.exec(out);
        var elsewhere = /^clientelse=(.*)$/m.exec(out);
        if (elsewhere) self._clientElsewhere = elsewhere[1].split(',').filter(function (v) { return v.length > 0; }).slice(0, 6);
        return {running: !!pid, pid: pid ? +pid[1] : null, client: flags.client === true, tvs: flags.tvs === true,
            dotnet: flags.dotnet === true, viewer: flags.viewer === true,
            clientVersions: versions ? versions[1].split(',').filter(function (v) { return CLIENT_VERSION_RE.test(v); }).slice(0, 5) : [],
            clientFiles: dlls ? dlls[1].split(',').filter(function (v) { return v.length > 0; }).slice(0, 12) : [],
            clientElsewhere: self._clientElsewhere || [],
            log: tail ? tail.trim() : ''};
    });
};

// Only "is it running": {running, pid, other, cheap: true}.
Tuner.prototype.check = function () {
    return this.execute(dockShell.runningCheck(PID_FILE, DLL, 'tuner'), 6000).then(function (r) { return dockShell.parseCheck(check(r, 'Status'), PROBE_TUNER_RE); });
};

// The cheap check, and the full probe when it cannot tell (see Dock.runningNow).
Tuner.prototype.runningNow = function () {
    var self = this;
    if (this.cheapBroken) return this.probe();
    return this.check().then(function (c) {
        self.cheapFails = 0;
        if (c.running || !c.other) return c;
        return self.probe().then(function (p) {
            if (p.running && p.pid === c.other) self.cheapBroken = true;
            return p;
        });
    }, function () {
        // The check itself failed (a shell that refuses the line, a timeout). The full probe answers instead; when it
        // works twice in a row where the check did not, the check is given up for this run of the service.
        return self.probe().then(function (p) {
            self.cheapFails = (self.cheapFails || 0) + 1;
            if (self.cheapFails >= 2) self.cheapBroken = true;
            return p;
        });
    });
};

// The reason this TV cannot run the tuner, or null when it can.
function unsupportedReason(p) {
    if (!p.dotnet) return 'This TV has no .NET runtime for Vetro to use.';
    if (!p.client) return 'Samsung’s TV service client was not found on this TV.';
    if (!p.tvs) return 'The TV’s tuner service (tvs-daemon) is not running.';
    return null;
}

Tuner.prototype.status = function () {
    var self = this, state = this.readState();
    var base = {installed: this.installed(), enabled: state.enabled, since: state.since, busy: this.busy,
        error: this.lastError, failures: this.failures, target: TARGET_APP, bootTimeline: this.timeline,
        runningCheck: this.cheapBroken ? 'full' : 'cheap'};
    return this.probe().then(function (p) {
        var reason = unsupportedReason(p);
        self.unsupported = reason;
        return Object.assign(base, {running: p.running, pid: p.pid, supported: reason === null, unsupportedReason: reason,
            samsungTunerFound: p.viewer, prerequisites: {dotnet: p.dotnet, client: p.client, tvs: p.tvs, viewer: p.viewer},
            clientVersions: p.clientVersions, clientFiles: p.clientFiles, clientElsewhere: p.clientElsewhere, log: p.log});
    }).catch(function (e) {
        return Object.assign(base, {running: null, pid: null, supported: null, unsupportedReason: null, samsungTunerFound: null, prerequisites: null, clientVersions: [], clientFiles: [], clientElsewhere: [], log: '', probeError: e.message});
    });
};

// The launch line. Paths are fixed constants or come from this package's own folder, and are quoted.
//
// The tuner runs as its own systemd service (a transient unit made by systemd-run), NOT as a child of the root agent: the
// agent lives in sdbd's cgroup and the TV stops sdbd at standby, which would kill the tuner with it (measured for the dock).
// KillSignal is SIGKILL because a process inside the EFL main loop does not leave on SIGTERM. If systemd-run is missing
// or refuses, the old detached start is used. Never in this line: --seconds (auto exit), --hold, --backdrop (test options).
// quiet: this start replaces a tuner that was running (an update, another build), so its Banner does not come up by itself.
Tuner.prototype.startScript = function (quiet) {
    var env = 'HOME=/home/owner XDG_RUNTIME_DIR=/run WAYLAND_DISPLAY=wayland-0';
    var state = this.readState();
    var args = DLL + ' --resident --notif --control ' + CONTROL + ' --log ' + LOG_FILE + ' --pid-file ' + PID_FILE +
        ' --takeover ' + TARGET_APP + ' --features ' + q(this.featuresFile) + (quiet ? ' --quiet' : '');
    return [
        this.stopLines(),
        'cd ' + q(this.dir),
        'systemd-run --unit=' + UNIT + ' --collect -p WorkingDirectory=' + q(this.dir) + ' -p KillSignal=SIGKILL -p StandardOutput=null -p StandardError=null ' +
            '/usr/bin/env ' + env + ' /usr/bin/dotnet ' + args + ' >/dev/null 2>&1 || ' +
        '{ ' + env + ' setsid nohup /usr/bin/dotnet ' + args + ' </dev/null >/dev/null 2>&1 & }',
        'echo started'
    ].join('\n');
};

// The process is killed outright; only a pid that is really our dll is touched. The control pipe goes with it, so a
// stale one cannot make a dashboard command look like it worked.
// --no-block avoids blocking on Tizen 9 systemd/SMACK D-Bus JobRemoved; poll is-active text so deactivating still waits.
Tuner.prototype.stopLines = function () {
    return 'systemctl stop --no-block ' + UNIT + '.service >/dev/null 2>&1; ' +
        'i=0; while [ $i -lt 30 ]; do case "$(systemctl is-active ' + UNIT + '.service 2>/dev/null)" in active|activating|deactivating|reloading) sleep 0.1; i=$((i+1)) ;; *) break ;; esac; done; ' +
        'systemctl reset-failed ' + UNIT + '.service >/dev/null 2>&1 || true; ' +
        'p=$(cat ' + PID_FILE + ' 2>/dev/null || true); if [ -n "$p" ] && tr "\\0" " " < /proc/$p/cmdline 2>/dev/null | grep -q ' + DLL +
        '; then kill -9 $p; sleep 0.3; fi; rm -f ' + PID_FILE + ' ' + CONTROL;
};

// Right after a boot the TV is still starting dozens of services, so a start that is slow but alive is not a failure: it
// gets a long wait, and the next supervision tick finds it by its pid.
Tuner.prototype.waitRunning = function () {
    var self = this, deadline = this.now() + (this.uptime() < BOOT_WINDOW_S ? BOOT_WAIT_MS : START_WAIT_MS);
    // A probe that fails is "not seen yet", and the wait between probes grows (1, 2, 3 s), as for the launcher (dock.js).
    // Each poll is the cheap check; the full probe comes last, for its log lines and as the last word.
    var round = 0;
    function full(p) { return p.cheap ? self.probe().catch(function () { return {running: false, log: ''}; }) : Promise.resolve(p); }
    function poll() {
        return self.runningNow().catch(function () { return {running: false, log: ''}; }).then(function (p) {
            if (p.running) return p;
            if (self.now() > deadline) return full(p).then(function (f) {
                if (f.running) return f;
                throw new Error('The tuner did not start. ' + (f.log ? 'Last log lines: ' + f.log.split('\n').slice(-2).join(' | ') : 'It wrote no log.'));
            });
            return self.sleep(Math.min(3000, 1000 * ++round)).then(poll);
        });
    }
    return this.sleep(1500).then(poll);
};

Tuner.prototype.launch = function (quiet) {
    var self = this;
    try { this.writeFeatures(); } catch (e) { return Promise.reject(e); }
    this.changes++;
    this.mark('startIssued');
    // As for the launcher: right after a boot the start script gets the long wait, and one that still runs out of time
    // is not a failure (the tuner usually comes up from that same attempt): waitRunning() decides.
    var t0 = this.now();
    return this.execute(wrap(this.startScript(quiet)), this.uptime() < BOOT_WINDOW_S ? BOOT_WAIT_MS : 10000).then(function (r) {
        self.mark('startCallMs', self.now() - t0);
        if (r && r.timed_out) self.mark('startTimedOut', true);
        if (!r || !r.timed_out) check(r, 'Start');
        return self.waitRunning();
    }).then(function (p) {
        self.mark('running');
        self.startedHere = true;   // in memory too: a state that cannot be saved must not restart the tuner at every round
        if (self.build) { try { self.rememberBuild(p); } catch (e) {} }
        return p;
    });
};

// The build that started the tuner and the process it started; see the launcher's rememberBuild and otherBuild (dock.js).
Tuner.prototype.rememberBuild = function (p) {
    var state = this.readState(), pid = p && typeof p.pid === 'number' ? p.pid : null;
    if (state.build !== this.build || (state.buildPid || null) !== pid) this.patchState({build: this.build, buildPid: pid});
};
Tuner.prototype.otherBuild = function (state, p) {
    if (!this.build || this.startedHere) return false;
    return state.build !== this.build || (!!state.buildPid && !!p && typeof p.pid === 'number' && state.buildPid !== p.pid);
};

Tuner.prototype.stopTuner = function () {
    this.changes++;
    return this.execute(wrap(this.stopLines()), 8000).then(function (r) { check(r, 'Stop'); });
};

// Turn the tuner on: check that this TV can run it, start it, and only then remember that it is on. If anything fails
// nothing has changed.
Tuner.prototype.enable = function () {
    var self = this;
    if (this.busy) return Promise.reject(new Error('Another tuner change is in progress'));
    if (!this.installed()) return Promise.reject(new Error('The tuner files are not in this Vetro package'));
    this.busy = true; this.lastError = null;
    return this.probe().then(function (p) {
        var reason = unsupportedReason(p);
        self.unsupported = reason;   // remembered for the TV screen's tile, which must not count a tuner this TV cannot run
        if (reason) throw new Error(reason + ' Samsung’s tuner stays as it is.');
        return self.launch();
    }).then(function () {
        self.patchState({enabled: true, since: self.now()});
        self.failures = 0; self.nextTry = 0;
        try { self.onChange(true); } catch (e) { /* the switch itself worked */ }
        return self.status();
    }).catch(function (e) {
        self.lastError = e.message;
        return self.stopTuner().catch(function () {}).then(function () { throw e; });
    }).finally(function () { self.busy = false; });
};

// Turn the tuner off. The setting goes first, so a failed stop cannot bring it back by itself. Samsung's tuner was never
// touched, so there is nothing else to put back.
Tuner.prototype.disable = function () {
    var self = this;
    if (this.busy) return Promise.reject(new Error('Another tuner change is in progress'));
    this.busy = true; this.lastError = null;
    try { this.patchState({enabled: false}); }
    catch (e) { this.busy = false; return Promise.reject(e); }
    return this.stopTuner().then(function () { try { self.onChange(false); } catch (e) { /* the switch itself worked */ } return self.status(); }).finally(function () { self.busy = false; });
};

// Ask a running tuner to show, hide or open its guide (the dashboard's "Open now"). Only the words above get through, and only
// when the pipe exists: writing to a missing path would make a plain file that the next tuner has to remove.
Tuner.prototype.command = function (name) {
    var word = Object.prototype.hasOwnProperty.call(COMMANDS, name) ? COMMANDS[name] : null;
    if (!word) return Promise.reject(new Error('Invalid tuner command'));
    if (!this.readState().enabled) return Promise.reject(new Error('Turn the tuner on first'));
    // Only to a tuner that is alive: a pipe left by one that died has no reader, and a plain write to it would wait
    // (holding the root agent's queue) until the command ran out of time. Opened read-write, the write never waits.
    return this.execute(wrap('p=$(cat ' + PID_FILE + ' 2>/dev/null); if [ -n "$p" ] && [ -d /proc/$p ] && [ -p ' + CONTROL + ' ]; then ( exec 3<>' + CONTROL + ' && echo ' + word + ' >&3 ) && echo sent; else echo none; fi'), 6000).then(function (r) {
        if (check(r, 'Command').trim() !== 'sent') throw new Error('The tuner is not running yet');
        return {ok: true, command: word};
    });
};

// The setting says on, the process is not there: after a boot, a crash or a restart of the service. Called by the plugin's
// timer. A failure backs off (30 s, doubling to 5 min) and is kept for the page; it never ends the mode, because a tuner that
// is not running leaves Samsung's own on screen, which is the safe state.
Tuner.prototype.supervise = function (agentConnected) {
    var self = this;
    if (!this.readState().enabled || this.busy || !agentConnected || this.now() < this.nextTry) return Promise.resolve(null);
    if (!this.installed()) return Promise.resolve(null);
    this.busy = true;
    this.mark('agentSeen');
    var saved = this.readState();
    // The cheap check while the tuner runs; "not running" is confirmed by the full probe before anything is started.
    return this.runningNow().then(function (c) { return c.cheap && !c.running ? self.probe() : c; }).then(function (p) {
        // A tuner started by another build of Vetro (the package was installed again over a running one) is the old
        // binary in its own unit: it is started again, once. See the launcher's supervise (dock.js).
        if (p.running && self.otherBuild(saved, p)) return self.launch(true).then(function () { self.failures = 0; self.superviseFailed = false; self.lastError = null; return 'started'; });
        // A warning left by an earlier failed round is stale once the tuner is seen running.
        var age = self.lastStartAt ? self.now() - self.lastStartAt : Infinity;
        if (p.running) {
            // Failures are forgotten only once a start has lasted: a tuner that crashes a few seconds after each start keeps its back-off.
            if (age >= QUICK_DEATH_MS) self.failures = 0;
            self.mark('running'); if (self.superviseFailed) { self.superviseFailed = false; self.lastError = null; } return 'running';
        }
        if (age < QUICK_DEATH_MS) { self.lastStartAt = 0; throw new Error('The tuner stopped ' + Math.round(age / 1000) + ' s after it started.'); }
        return self.launch().then(function () { self.lastStartAt = self.now(); self.superviseFailed = false; self.lastError = null; return 'started'; });
    }).catch(function (e) {
        self.failures++; self.superviseFailed = true;
        self.nextTry = self.now() + Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * Math.pow(2, Math.min(self.failures, 8) - 1));
        self.lastError = (self.failures >= 4 ? 'The tuner has not started after ' + self.failures + ' tries; Vetro keeps trying. ' : '') + e.message;
        return 'failed';
    }).finally(function () { self.busy = false; });
};

// After an update that replaced the tuner's files the old process keeps running the old assembly: start it again.
Tuner.prototype.restart = function (quiet) {
    var self = this;
    if (this.busy) return Promise.reject(new Error('Another tuner change is in progress'));
    if (!this.readState().enabled) return Promise.reject(new Error('The tuner is off'));
    this.busy = true; this.lastError = null;
    return this.launch(quiet).then(function () { self.failures = 0; self.nextTry = 0; return self.status(); })
        .catch(function (e) { self.lastError = e.message; throw e; })
        .finally(function () { self.busy = false; });
};

// After a self-update: the tuner is started again with the new files, unless the supervision has already done it.
Tuner.prototype.restartAfterUpdate = function () {
    var self = this;
    if (this.busy) return Promise.reject(new Error('Another tuner change is in progress'));
    if (!this.build) return this.restart(true);
    return this.runningNow().then(function (p) { return p.running && !self.otherBuild(self.readState(), p) ? self.status() : self.restart(true); });
};

module.exports = {Tuner: Tuner, LOG_FILE: LOG_FILE, PID_FILE: PID_FILE, STATE_FILE: STATE_FILE, TARGET_APP: TARGET_APP, CONTROL: CONTROL, unsupportedReason: unsupportedReason, COMMANDS: COMMANDS};
