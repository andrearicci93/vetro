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
var DLL = 'vetro-tuner.dll';
var UNIT = 'vetro-tuner';                             // the tuner's own systemd unit
var TARGET_APP = 'org.tizen.tv-viewer';               // Samsung's live TV app
var CLIENT_GLOB = '/opt/usr/dotnet/Tizen.TV.Broadcast.TVService/*/Tizen.TV.Broadcast.TVService.dll';
var START_WAIT_MS = 15000;
var BOOT_WAIT_MS = 75000;                             // a start in the first minutes after a TV boot is slow
var BOOT_WINDOW_S = 300;
var RETRY_FIRST_MS = 30000;
var RETRY_MAX_MS = 300000;
// What a dashboard may ask a running tuner to do: each word is a command of its control pipe, nothing else gets through.
var COMMANDS = {show: 'show', hide: 'hide', toggle: 'toggle', guide: 'guide'};

function wrap(s) { return 'echo ' + Buffer.from(s).toString('base64') + ' | base64 -d | sh'; }
function q(s) { return "'" + String(s).replace(QUOTE_RE, "'\\''") + "'"; }

function check(r, what) {
    if (!r || r.exit_code || r.timed_out) throw new Error((r && (r.stderr || r.stdout)) || what + ' failed');
    return r.stdout || '';
}

function Tuner(options) {
    options = options || {};
    this.execute = options.execute;
    this.dir = options.dir || path.join(__dirname, '..', 'native', 'tuner');
    this.stateFile = options.stateFile || STATE_FILE;
    this.sleep = options.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    this.now = options.now || Date.now;
    this.uptime = options.uptime || function () { return os.uptime(); };
    this.busy = false;
    this.failures = 0;
    this.nextTry = 0;
    this.lastError = null;
}

// The files the TV runs and draws with: the assembly and the glass pictures that sit next to it.
Tuner.prototype.installed = function () {
    try { return fs.existsSync(path.join(this.dir, DLL)) && fs.existsSync(path.join(this.dir, 'res', 'dock_bg.png')); }
    catch (e) { return false; }
};

Tuner.prototype.readState = function () {
    try {
        var s = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
        return {enabled: !!s && s.enabled === true, since: s && typeof s.since === 'number' ? s.since : null};
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

// What is running, and whether this TV can run the tuner at all, in one read. Only the tuner's own pid counts, and only if
// that pid is our dll. The tuner needs three things from the TV: the firmware's `dotnet`, Samsung's managed TV client (a
// version folder of it, any version) and the tuner service itself (tvs-daemon). Without them it would start and find
// nothing to tune, so the switch is refused there. Only a Q80A with a DVB-T tuner has been seen working.
Tuner.prototype.probe = function () {
    var script = [
        'p=$(cat ' + PID_FILE + ' 2>/dev/null)',
        'if [ -n "$p" ] && tr "\\0" " " < /proc/$p/cmdline 2>/dev/null | grep -q ' + DLL + '; then echo "tuner=$p"; else echo "tuner="; fi',
        'if ls ' + CLIENT_GLOB + ' >/dev/null 2>&1; then echo client=1; else echo client=0; fi',
        'if pidof tvs-daemon >/dev/null 2>&1; then echo tvs=1; else echo tvs=0; fi',
        'if [ -x /usr/bin/dotnet ]; then echo dotnet=1; else echo dotnet=0; fi',
        'if [ -e /usr/apps/' + TARGET_APP + ' ]; then echo viewer=1; else echo viewer=0; fi',
        // No log file yet is normal: without || true the missing file would fail the whole read.
        'echo "log:"; tail -n 6 ' + LOG_FILE + ' 2>/dev/null || true'
    ].join('\n');
    return this.execute(wrap(script), 8000).then(function (r) {
        var out = check(r, 'Status');
        var pid = PROBE_TUNER_RE.exec(out), flags = {}, m;
        PROBE_FLAG_RE.lastIndex = 0;
        while ((m = PROBE_FLAG_RE.exec(out))) flags[m[1]] = m[2] === '1';
        var tail = out.split(LOG_SPLIT)[1];
        return {running: !!pid, pid: pid ? +pid[1] : null, client: flags.client === true, tvs: flags.tvs === true,
            dotnet: flags.dotnet === true, viewer: flags.viewer === true, log: tail ? tail.trim() : ''};
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
        error: this.lastError, failures: this.failures, target: TARGET_APP};
    return this.probe().then(function (p) {
        var reason = unsupportedReason(p);
        return Object.assign(base, {running: p.running, pid: p.pid, supported: reason === null, unsupportedReason: reason,
            samsungTunerFound: p.viewer, log: p.log});
    }).catch(function (e) {
        return Object.assign(base, {running: null, pid: null, supported: null, unsupportedReason: null, samsungTunerFound: null, log: '', probeError: e.message});
    });
};

// The launch line. Paths are fixed constants or come from this package's own folder, and are quoted.
//
// The tuner runs as its own systemd service (a transient unit made by systemd-run), NOT as a child of the root agent: the
// agent lives in sdbd's cgroup and the TV stops sdbd at standby, which would kill the tuner with it (measured for the dock).
// KillSignal is SIGKILL because a process inside the EFL main loop does not leave on SIGTERM. If systemd-run is missing
// or refuses, the old detached start is used. Never in this line: --seconds (auto exit), --hold, --backdrop (test options).
Tuner.prototype.startScript = function () {
    var env = 'HOME=/home/owner XDG_RUNTIME_DIR=/run WAYLAND_DISPLAY=wayland-0';
    var state = this.readState();
    var args = DLL + ' --resident --notif --control ' + CONTROL + ' --log ' + LOG_FILE + ' --pid-file ' + PID_FILE +
        ' --takeover ' + TARGET_APP;
    return [
        this.stopLines(),
        'cd ' + q(this.dir),
        'systemd-run --unit=' + UNIT + ' --collect -p WorkingDirectory=' + q(this.dir) + ' -p KillSignal=SIGKILL -p StandardOutput=null -p StandardError=null ' +
            '/usr/bin/env ' + env + ' /usr/bin/dotnet ' + args + ' >/dev/null 2>&1 || ' +
        env + ' setsid nohup /usr/bin/dotnet ' + args + ' </dev/null >/dev/null 2>&1 &',
        'echo started'
    ].join('\n');
};

// The process is killed outright; only a pid that is really our dll is touched. The control pipe goes with it, so a
// stale one cannot make a dashboard command look like it worked.
Tuner.prototype.stopLines = function () {
    return 'systemctl stop ' + UNIT + '.service >/dev/null 2>&1; ' +
        'p=$(cat ' + PID_FILE + ' 2>/dev/null); if [ -n "$p" ] && tr "\\0" " " < /proc/$p/cmdline 2>/dev/null | grep -q ' + DLL +
        '; then kill -9 $p; sleep 0.3; fi; rm -f ' + PID_FILE + ' ' + CONTROL;
};

// Right after a boot the TV is still starting dozens of services, so a start that is slow but alive is not a failure: it
// gets a long wait, and the next supervision tick finds it by its pid.
Tuner.prototype.waitRunning = function () {
    var self = this, deadline = this.now() + (this.uptime() < BOOT_WINDOW_S ? BOOT_WAIT_MS : START_WAIT_MS);
    function poll() {
        return self.probe().then(function (p) {
            if (p.running) return p;
            if (self.now() > deadline) throw new Error('The tuner did not start. ' + (p.log ? 'Last log lines: ' + p.log.split('\n').slice(-2).join(' | ') : 'It wrote no log.'));
            return self.sleep(1000).then(poll);
        });
    }
    return this.sleep(1500).then(poll);
};

Tuner.prototype.launch = function () {
    var self = this;
    return this.execute(wrap(this.startScript()), 10000).then(function (r) { check(r, 'Start'); return self.waitRunning(); });
};

Tuner.prototype.stopTuner = function () {
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
        if (reason) throw new Error(reason + ' Samsung’s tuner stays as it is.');
        return self.launch();
    }).then(function () {
        self.patchState({enabled: true, since: self.now()});
        self.failures = 0; self.nextTry = 0;
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
    return this.stopTuner().then(function () { return self.status(); }).finally(function () { self.busy = false; });
};

// Ask a running tuner to show, hide or open its guide (the dashboard's "Open now"). Only the words above get through, and only
// when the pipe exists: writing to a missing path would make a plain file that the next tuner has to remove.
Tuner.prototype.command = function (name) {
    var word = Object.prototype.hasOwnProperty.call(COMMANDS, name) ? COMMANDS[name] : null;
    if (!word) return Promise.reject(new Error('Invalid tuner command'));
    if (!this.readState().enabled) return Promise.reject(new Error('Turn the tuner on first'));
    return this.execute(wrap('if [ -p ' + CONTROL + ' ]; then echo ' + word + ' > ' + CONTROL + '; echo sent; else echo none; fi'), 6000).then(function (r) {
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
    return this.probe().then(function (p) {
        if (p.running) { self.failures = 0; return 'running'; }
        return self.launch().then(function () { self.failures = 0; self.lastError = null; return 'started'; });
    }).catch(function (e) {
        self.failures++;
        self.nextTry = self.now() + Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * Math.pow(2, Math.min(self.failures, 8) - 1));
        self.lastError = (self.failures >= 4 ? 'The tuner has not started after ' + self.failures + ' tries; Vetro keeps trying. ' : '') + e.message;
        return 'failed';
    }).finally(function () { self.busy = false; });
};

// After an update that replaced the tuner's files the old process keeps running the old assembly: start it again.
Tuner.prototype.restart = function () {
    var self = this;
    if (this.busy) return Promise.reject(new Error('Another tuner change is in progress'));
    if (!this.readState().enabled) return Promise.reject(new Error('The tuner is off'));
    this.busy = true; this.lastError = null;
    return this.launch().then(function () { self.failures = 0; self.nextTry = 0; return self.status(); })
        .catch(function (e) { self.lastError = e.message; throw e; })
        .finally(function () { self.busy = false; });
};

module.exports = {Tuner: Tuner, STATE_FILE: STATE_FILE, TARGET_APP: TARGET_APP, CONTROL: CONTROL, unsupportedReason: unsupportedReason, COMMANDS: COMMANDS};
