'use strict';
// Runs the Vetro dock (dock/) on the TV and keeps it running while it is switched on.
//
// The dock is a .NET process that the TV's own `dotnet` runs from this package. It is not a
// Tizen app, so nothing restarts it: the service starts it as root through the agent, checks on
// it now and then, and stops it when the switch goes off. The dock closes Samsung's Home
// (com.samsung.tv.csfs) itself after each Home press, so a dead dock hands the Home key
// straight back to Samsung: the worst case of a crash is the TV as it was before.
//
// State lives in one small file next to the other Vetro settings. In the Vetro launcher mode nothing else on
// the TV is changed: no package is disabled and the default Home is untouched.
//
// The same process also serves the custom launcher mode (the user's own app on the Home key). There it runs
// headless with --home-launch APPID: the Home key opens that app instead of the dock, and Samsung's Home is
// disabled so that it cannot come up over it. The two modes exclude each other; `customApp` in the state is the
// switch for the second one, `enabled` stays the switch of the first.

var fs = require('fs');
var os = require('os');
var path = require('path');
var catalog = require('./dock-catalog.js');
// Regular expressions compiled once at module load, not on every call.
var QUOTE_RE = /'/g;
var AUTORUN_VALUE_RE = /value = (\d+)/;
var PROBE_DOCK_RE = /^dock=(\d+)$/m;
var PROBE_HOME_RE = /^home=(\d)$/m;
var TARGET_SYSTEM_RE = /^(?:sys|key|panel):/;
var TARGET_PANEL_RE = /^panel:/;
var TARGET_SOURCE_RE = /^source:/;
var SLUG_RE = /^[a-z0-9_-]{1,40}$/;

var SHARE = '/opt/usr/home/owner/share';
var STATE_FILE = SHARE + '/vetro-dock.json';
var APPS_FILE = SHARE + '/vetro-dock-apps.tsv';
var CUSTOM_APPS_FILE = SHARE + '/vetro-dock-custom.tsv';      // the one-line list of the headless custom mode
var APP_ID_RE = /^[A-Za-z0-9_.-]{1,120}$/;
var RUN_DIR = '/home/owner';                          // the dock's own pid, fifo and log
var PID_FILE = RUN_DIR + '/tvlauncher.pid';
var FIFO = RUN_DIR + '/tvlauncher.fifo';
var LOG_FILE = RUN_DIR + '/tvlauncher.log';
var DLL = 'tvlauncher-dotnet.dll';
var UNIT = 'vetro-dock';                              // the dock's own systemd unit
var HOME_APP = 'com.samsung.tv.csfs';
// 2025 (RSM/CoBA) firmware runs the sidebar and media rows as separate processes that stay on top of the dock
// when only csfs is closed, so the guard and the enable-time kill target all three.
var HOME_KILL = [HOME_APP, 'com.samsung.tv.home.sidebar', 'com.samsung.tv.home.media'];
var AUTORUN_KEY = 'db/menu/smart_hub/ontvsetting/auto_start';   // Samsung's "Autorun Smart Hub"
var HOME_CODE = 63;                                   // Home on the forwarded remote Vetro creates
var START_WAIT_MS = 15000;
var BOOT_WAIT_MS = 75000;                             // a start in the first minutes after a TV boot is slow
var BOOT_WINDOW_S = 300;
var RETRY_FIRST_MS = 30000;
var RETRY_MAX_MS = 300000;
// Samsung's Home is disabled in the custom mode and nothing takes over from it, so a process that keeps failing
// to start must not leave the Home key dead: after this many failed tries (about 12 minutes of back-off) the
// service turns the mode off and Samsung's Home is back. A start the agent could not attempt does not count.
var CUSTOM_MAX_FAILURES = 6;
var APP_CHECK_ROUNDS = 6;                              // the chosen app is looked up every 6th supervision round (about a minute)
var APP_GONE_ROUNDS = 2;                               // and given up on when two lookups in a row say it is gone

function wrap(s) { return 'echo ' + Buffer.from(s).toString('base64') + ' | base64 -d | sh'; }
function q(s) { return "'" + String(s).replace(QUOTE_RE, "'\\''") + "'"; }

function Dock(options) {
    options = options || {};
    this.execute = options.execute;
    this.dir = options.dir || path.join(__dirname, '..', 'native', 'dock');
    this.stateFile = options.stateFile || STATE_FILE;
    this.appsFile = options.appsFile || APPS_FILE;
    this.customAppsFile = options.customAppsFile || CUSTOM_APPS_FILE;
    // Custom mode needs two things from the shell: home {state(), disable(), restore()} for Samsung's Home, and
    // appCheck(appId) -> {ok, label|reason} for the chosen app (rejects when the registry cannot be read now).
    this.home = options.home || null;
    this.appCheck = options.appCheck || null;
    this.checkRound = 0;
    this.goneRounds = 0;
    this.sleep = options.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    this.now = options.now || Date.now;
    this.uptime = options.uptime || function () { return os.uptime(); };
    this.busy = false;
    this.failures = 0;
    this.nextTry = 0;
    this.lastError = null;
    this.lastCatalog = null;
    this.refreshPending = false;
}

Dock.prototype.installed = function () {
    try { return fs.existsSync(path.join(this.dir, DLL)) && fs.existsSync(path.join(this.dir, 'res', 'glass_tile.png')); }
    catch (e) { return false; }
};

Dock.prototype.readState = function () {
    try {
        var s = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
        return {enabled: s && s.enabled === true, since: typeof s.since === 'number' ? s.since : null, fixTizenTube: s && s.fixTizenTube === true,
            noMotion: s && s.noMotion === true, autorunWas: s && s.autorunWas === 1 ? 1 : null,
            customApp: s && typeof s.customApp === 'string' && APP_ID_RE.test(s.customApp) ? s.customApp : null,
            customSince: s && typeof s.customSince === 'number' ? s.customSince : null,
            customHomeDisabled: s && s.customHomeDisabled === true};
    } catch (e) { return {enabled: false, since: null, fixTizenTube: false, noMotion: false, autorunWas: null, customApp: null, customSince: null, customHomeDisabled: false}; }
};

// Change some fields of the saved state and keep the rest.
Dock.prototype.patchState = function (patch) {
    this.writeState(Object.assign({}, this.readState(), patch));
};

// Samsung's "Autorun Smart Hub" (power-on shows Samsung's Home) would put Samsung's Home in front of
// the launcher at every boot. Turning the launcher on switches it off; the value it had is kept so that
// turning the launcher off puts it back. Only a change made here is ever undone here.
Dock.prototype.readAutorun = function () {
    return this.execute(wrap('vconftool get ' + AUTORUN_KEY + ' 2>&1'), 6000).then(function (r) {
        var m = AUTORUN_VALUE_RE.exec(check(r, 'Autorun read'));
        if (!m) throw new Error('Autorun Smart Hub could not be read');
        return +m[1];
    });
};
Dock.prototype.setAutorun = function (v) {
    var self = this;
    return this.execute(wrap('vconftool set -f -t int ' + AUTORUN_KEY + ' ' + v), 6000).then(function (r) {
        check(r, 'Autorun write');
        return self.readAutorun();
    }).then(function (now) { if (now !== v) throw new Error('Autorun Smart Hub did not change'); });
};
Dock.prototype.turnOffAutorun = function () {
    var self = this;
    return this.readAutorun().then(function (was) {
        if (was !== 1) return null;
        self.patchState({autorunWas: 1});          // remembered before the change, so a failure cannot lose it
        return self.setAutorun(0).then(function () { return 1; });
    });
};
Dock.prototype.restoreAutorun = function () {
    var self = this;
    if (this.readState().autorunWas !== 1) return Promise.resolve();
    return this.readAutorun().then(function (now) {
        return now === 0 ? self.setAutorun(1) : null;     // already on again (the user did it): nothing to put back
    }).then(function () { self.patchState({autorunWas: null}); });
};

Dock.prototype.writeState = function (state) {
    try { fs.writeFileSync(this.stateFile, JSON.stringify(state)); }
    catch (e) { throw new Error('The dock setting could not be saved: ' + e.message); }
};

function check(r, what) {
    if (!r || r.exit_code || r.timed_out) throw new Error((r && (r.stderr || r.stdout)) || what + ' failed');
    return r.stdout || '';
}

// What is running right now. Only the dock's own pid counts, and only if that pid is our dll.
Dock.prototype.probe = function () {
    var script = [
        'p=$(cat ' + PID_FILE + ' 2>/dev/null)',
        'if [ -n "$p" ] && tr "\\0" " " < /proc/$p/cmdline 2>/dev/null | grep -q ' + DLL + '; then echo "dock=$p"; else echo "dock="; fi',
        'if pidof ' + HOME_APP + ' >/dev/null 2>&1 || ps | grep -q "[c]sfs"; then echo "home=1"; else echo "home=0"; fi',
        // No log file yet is normal. Without || true the missing file failed the whole read, and the user saw its raw
        // output, "dock= home=0 log:", as the error (#82).
        'echo "log:"; tail -n 6 ' + LOG_FILE + ' 2>/dev/null || true'
    ].join('\n');
    return this.execute(wrap(script), 8000).then(function (r) {
        var out = check(r, 'Status');
        var pid = PROBE_DOCK_RE.exec(out), home = PROBE_HOME_RE.exec(out);
        return {running: !!pid, pid: pid ? +pid[1] : null, samsungHome: home ? home[1] === '1' : null,
            log: out.split('log:\n')[1] ? out.split('log:\n')[1].trim() : ''};
    });
};

// The page shows a preview before the launcher has ever been turned on, so the list is read from Samsung's
// Home once (the same read a start does) when there is none yet. Only the page asks for it; a failed read is
// not an error here and the page shows an example row instead.
Dock.prototype.previewList = function () {
    var self = this;
    if (this.entries().length || this.busy) return Promise.resolve();
    if (!this.listing) this.listing = this.writeCatalog().catch(function () {}).then(function () { self.listing = null; });
    return this.listing;
};

Dock.prototype.status = function (options) {
    var self = this;
    return (options && options.preview ? this.previewList() : Promise.resolve()).then(function () { return self.statusNow(); });
};

Dock.prototype.statusNow = function () {
    var self = this, state = this.readState();
    var base = {installed: this.installed(), enabled: state.enabled, since: state.since, busy: this.busy,
        error: this.lastError, failures: this.failures, apps: this.lastCatalog, fixTizenTube: state.fixTizenTube, noMotion: state.noMotion, autorunSwitchedOff: state.autorunWas === 1,
        mode: state.customApp ? 'custom' : state.enabled ? 'vetro' : 'off', customApp: state.customApp, customSince: state.customSince,
        customHomeDisabled: state.customHomeDisabled,
        entries: this.entries(), inputs: this.inputEntries()};
    return this.probe().then(function (p) {
        return Object.assign(base, {running: p.running, pid: p.pid, samsungHome: p.samsungHome, log: p.log});
    }).catch(function (e) {
        return Object.assign(base, {running: null, pid: null, samsungHome: null, log: '', probeError: e.message});
    });
};

// The launch line. Paths are fixed constants or come from this package's own folder, and are quoted.
//
// The dock runs as its own systemd service (a transient unit made by systemd-run), NOT as a child of the
// root agent: the agent lives in sdbd's cgroup, and the TV stops sdbd whenever it goes to standby, which
// kills everything in that cgroup (measured: the dock died at every standby and came back only after the
// agent had been relaunched at wake). In its own unit it survives standby. KillSignal is SIGKILL because the
// dock does not leave on SIGTERM. If systemd-run is missing or refuses, the old detached start is used.
Dock.prototype.startScript = function () {
    var env = 'HOME=/home/owner XDG_RUNTIME_DIR=/run WAYLAND_DISPLAY=wayland-0 TVLAUNCHER_ENGINE=egl TVLAUNCHER_DIR=' + RUN_DIR;
    var state = this.readState();
    // Custom mode: headless. The one-line list only gives the process something to load; the window is never shown.
    var args = DLL + ' --apps ' + q(state.customApp ? this.customAppsFile : this.appsFile) + ' --inputs ' + q(path.join(this.dir, 'res', 'inputs.tsv')) +
        ' --hidden' + (state.customApp ? ' --no-premap --no-warmup --home-launch ' + state.customApp : '') +
        ' --home-code ' + HOME_CODE + ' --kill-on-home ' + HOME_KILL.join(',') + (state.noMotion && !state.customApp ? ' --no-motion' : '');
    return [
        this.stopLines(),
        'rm -f ' + FIFO,
        'cd ' + q(this.dir),
        'systemd-run --unit=' + UNIT + ' --collect -p WorkingDirectory=' + q(this.dir) + ' -p KillSignal=SIGKILL -p StandardOutput=null -p StandardError=null ' +
            '/usr/bin/env ' + env + ' /usr/bin/dotnet ' + args + ' >/dev/null 2>&1 || ' +
        env + ' setsid nohup /usr/bin/dotnet ' + args + ' </dev/null >/dev/null 2>&1 &',
        'echo started'
    ].join('\n');
};

// The dock ignores SIGTERM, so it takes kill -9; only a pid that is really our dll is touched.
Dock.prototype.stopLines = function () {
    return 'systemctl stop ' + UNIT + '.service >/dev/null 2>&1; ' +
        'p=$(cat ' + PID_FILE + ' 2>/dev/null); if [ -n "$p" ] && tr "\\0" " " < /proc/$p/cmdline 2>/dev/null | grep -q ' + DLL +
        '; then kill -9 $p; sleep 0.3; fi; rm -f ' + PID_FILE;
};

Dock.prototype.writeCatalog = function () {
    var self = this;
    return catalog.load(this.execute, {fixTizenTube: this.readState().fixTizenTube}).then(function (c) {
        try { fs.writeFileSync(self.appsFile, c.tsv); }
        catch (e) { throw new Error('The app list could not be saved: ' + e.message); }
        self.lastCatalog = {count: c.count, skipped: c.skipped, at: self.now()};
        return c;
    });
};

// Right after a boot the TV is still starting dozens of services, so a start that is slow but
// alive is not a failure: it gets a long wait, and the next supervision tick finds it by its pid.
Dock.prototype.waitRunning = function () {
    var self = this, deadline = this.now() + (this.uptime() < BOOT_WINDOW_S ? BOOT_WAIT_MS : START_WAIT_MS);
    function poll() {
        return self.probe().then(function (p) {
            if (p.running) return p;
            if (self.now() > deadline) throw new Error('The dock did not start. ' + (p.log ? 'Last log lines: ' + p.log.split('\n').slice(-2).join(' | ') : 'It wrote no log.'));
            return self.sleep(1000).then(poll);
        });
    }
    return this.sleep(1500).then(poll);
};

// `quick` is the start after a boot or a crash: it uses the list saved by the last start, so the
// slow Home read does not sit in front of the dock, and the list is refreshed once the dock is up.
Dock.prototype.launch = function (quick) {
    var self = this, custom = this.readState().customApp, saved = !custom && quick && this.hasSavedApps();
    return (custom ? this.writeCustomList(custom) : saved ? Promise.resolve() : this.writeCatalog()).then(function () {
        return self.execute(wrap(self.startScript()), 10000);
    }).then(function (r) { check(r, 'Start'); return self.waitRunning(); }).then(function (p) {
        if (saved) self.refreshPending = true;
        return p;
    });
};

// The saved list is rebuilt once the TV has settled: in the first minutes Samsung's Home may still
// be rewriting its own row, and a half-written read must not replace the good list.
Dock.prototype.refreshCatalogLater = function () {
    if (!this.refreshPending || this.uptime() < BOOT_WINDOW_S) return;
    this.refreshPending = false;
    this.writeCatalog().catch(function () {});
};

Dock.prototype.hasSavedApps = function () {
    try { return fs.statSync(this.appsFile).size > 0; } catch (e) { return false; }
};

// Turn the dock on: build the app list from Samsung's Home, start the dock, and only then
// remember that it is on. If anything fails nothing has changed.
Dock.prototype.enable = function () {
    var self = this;
    if (this.busy) return Promise.reject(new Error('Another dock change is in progress'));
    if (!this.installed()) return Promise.reject(new Error('The dock files are not in this Vetro package'));
    if (this.readState().customApp) return Promise.reject(new Error('Turn off the custom launcher before turning on the Vetro launcher'));
    this.busy = true; this.lastError = null;
    return this.launch().then(function () {
        self.patchState({enabled: true, since: self.now()});
        self.failures = 0; self.nextTry = 0;
        // Not fatal: the launcher works either way, only the picture at power-on differs.
        return self.turnOffAutorun()
            .catch(function (e) { self.lastError = 'The launcher is on, but Autorun Smart Hub could not be switched off: ' + e.message; });
    }).then(function () {
        // Samsung's Home is idle in the background; closing it frees its memory, and Settings or
        // Source opened from the dock start it again on demand.
        return self.execute(HOME_KILL.map(function (id) { return 'app_launcher -k ' + id; }).join('; '), 8000).catch(function () {});
    }).then(function () { return self.status(); }).catch(function (e) {
        self.lastError = e.message;
        return self.stopDock().catch(function () {}).then(function () { throw e; });
    }).finally(function () { self.busy = false; });
};

Dock.prototype.stopDock = function () {
    return this.execute(wrap(this.stopLines()), 8000).then(function (r) { check(r, 'Stop'); });
};

// Turn the dock off. The setting goes first, so a failed stop cannot bring it back by itself.
Dock.prototype.disable = function () {
    var self = this;
    if (this.busy) return Promise.reject(new Error('Another dock change is in progress'));
    this.busy = true; this.lastError = null;
    try { this.patchState({enabled: false}); }
    catch (e) { this.busy = false; return Promise.reject(e); }
    return this.stopDock().then(function () {
        return self.restoreAutorun().catch(function (e) { self.lastError = 'The launcher is off, but Autorun Smart Hub was not put back: ' + e.message; });
    }).then(function () { return self.status(); })
        .finally(function () { self.busy = false; });
};

// Rebuild the app list and restart: after installing or removing an app.
Dock.prototype.refresh = function () {
    var self = this;
    if (this.busy) return Promise.reject(new Error('Another dock change is in progress'));
    var state = this.readState();
    if (!state.enabled && !state.customApp) return Promise.reject(new Error('The dock is off'));
    this.busy = true; this.lastError = null;
    return this.launch().then(function () { return self.status(); }).catch(function (e) {
        self.lastError = e.message; throw e;
    }).finally(function () { self.busy = false; });
};

// ---- Custom launcher: the user's own app on the Home key --------------------------------------------------------
//
// One switch does three things: the Home key opens the chosen app (the headless dock, with the same unit, the same
// supervision and the same standby survival as the Vetro launcher), Samsung's Home is disabled so that it cannot
// come up over the app, and Autorun Smart Hub is switched off so that the TV does not power on to Samsung's Home.
// Everything is undone in the opposite order, and only what this mode changed.

// Which installed apps can be the custom launcher: the ones the user installed, with a launcher entry, switched on.
// This function is also sent to the dashboard as text, so it cannot call anything outside itself.
function customCandidate(row) {
    return !!row && row.system === false && row.removable === true && row.show === true && row.disabled === false &&
        /^[A-Za-z0-9_.-]{1,120}$/.test(row.appId || '') && !/^vetrotvapp(\.|$)/.test(row.appId);
}
// The same rule on the registry rows. strict: at the moment of choosing, an unreadable state is a no; when the
// app is looked up again later it is given the benefit of the doubt.
function customAppCheck(rows, appId, strict) {
    var row = (rows || []).filter(function (r) { return r && r.appId === appId; })[0];
    if (!row) return {ok: false, reason: 'the app is not installed any more.'};
    if (row.disabled === true) return {ok: false, reason: 'the app is disabled.'};
    if (typeof row.disabled !== 'boolean') return strict ? {ok: false, reason: 'the state of the app could not be read.'} : {ok: true, label: row.name || appId};
    if (!customCandidate(row)) return {ok: false, reason: 'only an app you installed yourself, with a launcher entry, can be the custom launcher.'};
    return {ok: true, label: row.name || appId};
}

function customLine(appId) { return 'custom\tCustom launcher\t' + appId + '\n'; }

Dock.prototype.writeCustomList = function (appId) {
    var self = this;
    return new Promise(function (resolve, reject) {
        try { fs.writeFileSync(self.customAppsFile, customLine(appId)); resolve(); }
        catch (e) { reject(new Error('The custom launcher list could not be saved: ' + e.message)); }
    });
};

Dock.prototype.requireCustomParts = function () {
    if (!this.installed()) return new Error('The dock files are not in this Vetro package');
    if (!this.home || !this.appCheck) return new Error('The custom launcher is not available in this build');
    return null;
};

// Turn the custom launcher on, or change its app when it is on already. Order: the app is checked, the headless
// process is started and seen running, Autorun Smart Hub is switched off, and only then is Samsung's Home
// disabled (the step that has no cheap way back). The intent is written before each change, as autorunWas is,
// so that a crash in the middle leaves something the service can finish or undo.
Dock.prototype.enableCustom = function (appId) {
    var self = this, before = this.readState();
    if (typeof appId !== 'string' || !APP_ID_RE.test(appId)) return Promise.reject(new Error('Choose an app from the list'));
    if (this.busy) return Promise.reject(new Error('Another launcher change is in progress'));
    var missing = this.requireCustomParts();
    if (missing) return Promise.reject(missing);
    if (before.enabled) return Promise.reject(new Error('Turn off the Vetro launcher before turning on the custom launcher'));
    if (before.customApp === appId) return this.status();
    this.busy = true; this.lastError = null;
    var changing = !!before.customApp, homeStep = false;
    return this.appCheck(appId, true).then(function (c) {
        if (!c || c.ok !== true) throw new Error((c && c.reason) || 'This app cannot be used as a launcher');
        return self.home.state();
    }).then(function (homeState) {
        if (homeState === 'unknown') throw new Error('Samsung Home state could not be read. Refresh the app list and try again.');
        // Written first: if this process dies now, supervision starts the headless dock for this app.
        self.patchState({customApp: appId, customSince: changing ? before.customSince : self.now(),
            customHomeDisabled: changing ? before.customHomeDisabled : homeState !== 'off' && homeState !== 'unavailable'});
        return self.launch();
    }).then(function () {
        self.failures = 0; self.nextTry = 0; self.goneRounds = 0;
        if (changing) return null;
        return self.turnOffAutorun()
            .catch(function (e) { self.lastError = 'The custom launcher is on, but Autorun Smart Hub could not be switched off: ' + e.message; });
    }).then(function () {
        if (changing || !self.readState().customHomeDisabled) return null;
        homeStep = true;
        return self.home.disable();
    }).then(function () { return self.status(); }).catch(function (e) {
        self.lastError = e.message;
        return self.undoCustomStart(before, homeStep).then(function () { throw e; });
    }).finally(function () { self.busy = false; });
};

// A start that failed half way: back to the state before it, never leaving Samsung's Home off.
Dock.prototype.undoCustomStart = function (before, homeStep) {
    var self = this;
    function failed(label) { return function (e) { self.lastError = (self.lastError ? self.lastError + ' · ' : '') + label + ': ' + e.message; }; }
    var step = homeStep ? this.home.restore().catch(failed('Samsung Home was not put back')) : Promise.resolve();
    return step.then(function () {
        if (before.customApp) {                      // it was a change of app: the old app goes back
            try { self.patchState({customApp: before.customApp}); } catch (e) { return null; }
            return self.launch().catch(failed('The previous app was not started again'));
        }
        try { self.patchState({customApp: null, customSince: null, customHomeDisabled: false}); } catch (e) { failed('The setting was not cleared')(e); }
        return self.stopDock().catch(function () {}).then(function () { return self.restoreAutorun(); }).catch(failed('Autorun Smart Hub was not put back'));
    });
};

// Turn the custom launcher off. Samsung's Home goes back first: if it cannot be put back the mode stays on and
// keeps working, which is better than a Home key that opens nothing. options.keepHome leaves that to the caller
// (Restore the TV does it as its next step).
Dock.prototype.disableCustom = function (options) {
    var self = this, state = this.readState();
    if (this.busy) return Promise.reject(new Error('Another launcher change is in progress'));
    if (!state.customApp) return this.status();
    this.busy = true; this.lastError = null;
    return this.leaveCustom(options).then(function () { return self.status(); }).finally(function () { self.busy = false; });
};

Dock.prototype.leaveCustom = function (options) {
    var self = this, state = this.readState();
    var home = state.customHomeDisabled && !(options && options.keepHome) ? (this.home ? this.home.restore() : Promise.reject(new Error('Samsung Home cannot be put back from here'))) : Promise.resolve();
    return home.then(function () {
        self.patchState({customApp: null, customSince: null, customHomeDisabled: false});
        self.failures = 0; self.nextTry = 0; self.goneRounds = 0;
        return self.stopDock();
    }).then(function () {
        return self.restoreAutorun().catch(function (e) { self.lastError = 'The custom launcher is off, but Autorun Smart Hub was not put back: ' + e.message; });
    });
};

// The chosen app is gone (uninstalled or disabled) or the process cannot be started: give Samsung's Home back.
Dock.prototype.giveUpCustom = function (reason) {
    var self = this;
    return this.leaveCustom().then(function () {
        self.lastError = 'The custom launcher was turned off and Samsung’s Home is back: ' + reason;
        return 'reverted';
    }, function (e) {
        self.lastError = reason + ' Samsung’s Home could not be put back: ' + e.message;
        return 'failed';
    });
};

// The list the dock was last given, as the page's preview shows it. Icons are served by iconFile().
function parseTsv(text) {
    return String(text || '').split('\n').filter(function (l) { return l.trim() && l.trim()[0] !== '#'; }).map(function (l) {
        var f = l.split('\t'), target = f[2] || '';
        return {slug: f[0], label: f[1], appId: target, icon: f[4] || null, killFirst: f[5] || null,
            system: TARGET_SYSTEM_RE.test(target), panel: TARGET_PANEL_RE.test(target), source: TARGET_SOURCE_RE.test(target) ? +target.slice(7) : null};
    }).filter(function (e) { return SLUG_RE.test(e.slug || '') && e.label; });
}
Dock.prototype.entries = function () {
    try { return parseTsv(fs.readFileSync(this.appsFile, 'utf8')); } catch (e) { return []; }
};
Dock.prototype.inputEntries = function () {
    try { return parseTsv(fs.readFileSync(path.join(this.dir, 'res', 'inputs.tsv'), 'utf8')); } catch (e) { return []; }
};

// Turn the TizenTube fix on or off. It only changes the list, so a running dock is rebuilt.
Dock.prototype.setFixTizenTube = function (on) {
    var self = this;
    if (typeof on !== 'boolean') return Promise.reject(new Error('Invalid value'));
    if (this.busy) return Promise.reject(new Error('Another launcher change is in progress'));
    var state = this.readState();
    try { this.patchState({fixTizenTube: on}); }
    catch (e) { return Promise.reject(e); }
    if (!state.enabled) return this.writeCatalog().catch(function () {}).then(function () { return self.status(); });   // the preview follows the choice
    return this.refresh().catch(function (e) {
        try { self.patchState({fixTizenTube: state.fixTizenTube}); } catch (e2) {}
        throw e;
    });
};

// Still selection: the focus jumps between tiles and the icons keep their size (the dock's --no-motion).
// It is a start argument, so a running dock is restarted.
Dock.prototype.setNoMotion = function (on) {
    var self = this;
    if (typeof on !== 'boolean') return Promise.reject(new Error('Invalid value'));
    if (this.busy) return Promise.reject(new Error('Another launcher change is in progress'));
    var state = this.readState();
    try { this.patchState({noMotion: on}); }
    catch (e) { return Promise.reject(e); }
    if (!state.enabled) return this.status();
    return this.refresh().catch(function (e) {
        try { self.patchState({noMotion: state.noMotion}); } catch (e2) {}
        throw e;
    });
};

// The file behind one tile of the preview: the app's own icon when the list names one that is a
// safe path, else the dock's packaged icon. Returns a Buffer or null.
Dock.prototype.iconFile = function (slug) {
    if (!SLUG_RE.test(String(slug))) return null;
    var all = this.entries().concat(this.inputEntries()), entry = all.filter(function (e) { return e.slug === slug; })[0];
    var systemIcon = slug === 'settings' || slug === 'samsunghome';
    if (!entry && !systemIcon) return null;
    var files = [];
    if (entry && entry.icon && catalog.iconPathOk(entry.icon)) files.push(entry.icon);
    files.push(path.join(this.dir, 'res', 'icons', slug + '.png'));
    // Local app-only runs use source assets; WGTs carry the same files under native/dock/res.
    if (systemIcon) files.push(path.join(__dirname, '..', '..', 'dock', 'res', 'icons', slug + '.png'));
    for (var i = 0; i < files.length; i++) {
        try {
            var data = fs.readFileSync(files[i]);
            if (data.length <= 1048576 && data.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return data;
        } catch (e) { /* next */ }
    }
    return null;
};

// Called every few seconds by the service, and at once when the root agent connects. Starts the
// dock after a boot or a crash while it is switched on. It never switches the setting off: a slow
// boot must not cost the user the launcher for good, so after repeated failures it keeps trying
// every few minutes and reports the reason.
Dock.prototype.supervise = function (agentConnected) {
    var self = this, state = this.readState(), custom = !!state.customApp;
    if ((!state.enabled && !custom) || this.busy || !agentConnected || this.now() < this.nextTry) return Promise.resolve(null);
    if (!this.installed()) return Promise.resolve(null);
    this.busy = true;
    return this.probe().then(function (p) {
        if (p.running) { self.failures = 0; self.refreshCatalogLater(); return 'running'; }
        return self.launch(true).then(function () { self.failures = 0; self.lastError = null; self.refreshCatalogLater(); return 'started'; });
    }).then(function (result) {
        return custom ? self.checkCustomApp(state.customApp).then(function (gone) { return gone || result; }) : result;
    }).catch(function (e) {
        self.failures++;
        self.nextTry = self.now() + Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * Math.pow(2, Math.min(self.failures, 8) - 1));
        if (custom && self.failures >= CUSTOM_MAX_FAILURES) return self.giveUpCustom('the launcher process did not start after ' + self.failures + ' tries. ' + e.message);
        self.lastError = (self.failures >= 4 ? 'The dock has not started after ' + self.failures + ' tries; Vetro keeps trying. ' : '') + e.message;
        return 'failed';
    }).finally(function () { self.busy = false; });
};

// Custom mode only: about once a minute the chosen app is looked up. Two lookups in a row that say it is gone
// (uninstalled, disabled) end the mode, since the Home key would open nothing. A lookup that fails is not an answer.
Dock.prototype.checkCustomApp = function (appId) {
    var self = this;
    if (!this.appCheck || ++this.checkRound < APP_CHECK_ROUNDS) return Promise.resolve(null);
    this.checkRound = 0;
    return this.appCheck(appId).then(function (c) {
        if (c && c.ok === true) { self.goneRounds = 0; return null; }
        if (++self.goneRounds < APP_GONE_ROUNDS) return null;
        return self.giveUpCustom((c && c.reason) || 'the app is no longer available.');
    }, function () { return null; });
};

module.exports = {Dock: Dock, STATE_FILE: STATE_FILE, APPS_FILE: APPS_FILE, CUSTOM_APPS_FILE: CUSTOM_APPS_FILE,
    customCandidate: customCandidate, customAppCheck: customAppCheck};
