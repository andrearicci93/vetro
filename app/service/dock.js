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
// headless with --home-launch APPID: the Home key opens that app instead of the dock, and the same guard that the
// Vetro launcher uses closes Samsung's Home (and its sidebar and media windows) after each press. Samsung's Home is
// never disabled: on the Q80A the boot script waits for it to start, so a disabled package can keep the TV from
// finishing its boot (verified 2026-11-06). The two modes exclude each other; `customApp` in the state is the
// switch for the second one, `enabled` stays the switch of the first.

var fs = require('fs');
var os = require('os');
var path = require('path');
var catalog = require('./dock-catalog.js');
var atomicFile = require('./atomic-file.js');
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
// Samsung's Home tiles read their previews from this updater (a .NET service started at boot, about 13 MB of real memory). With the dock
// or a custom launcher on Home the tiles are never shown, so it is stopped with them and started again when they go
// off. Measured on a Q80A (2026-11-08): stopped, it stayed off and nothing else noticed.
var PREVIEW_UNIT = 'com.samsung.tv.preview-updater';
var PREVIEW_OFF = 'systemctl stop --no-block ' + PREVIEW_UNIT + '.service >/dev/null 2>&1; app_launcher -k ' + PREVIEW_UNIT + ' >/dev/null 2>&1 || true';
var PREVIEW_ON = 'systemctl start --no-block ' + PREVIEW_UNIT + '.service >/dev/null 2>&1 || true';
var AUTORUN_KEY = 'db/menu/smart_hub/ontvsetting/auto_start';   // Samsung's "Autorun Smart Hub"
var HOME_CODE = 63;                                   // Home on the forwarded remote Vetro creates
var START_WAIT_MS = 15000;
var BOOT_WAIT_MS = 75000;                             // a start in the first minutes after a TV boot is slow
var BOOT_WINDOW_S = 300;
var RETRY_FIRST_MS = 30000;
var RETRY_BOOT_MS = 10000;                            // first retry inside the boot window: the TV is still busy, not broken
var BOOT_GATE_MS = 60000;                             // other boot tasks wait for the dock at most this long after the agent connects
var RETRY_MAX_MS = 300000;
// Nothing opens the chosen app but the headless process, so one that keeps failing to start must not leave the Home
// key dead: after this many failed tries (about 12 minutes of back-off) the service turns the mode off and Samsung's
// Home answers the key again. A start the agent could not attempt does not count.
var CUSTOM_MAX_FAILURES = 6;
var APP_CHECK_MS = 60000;                              // the chosen app is looked up about once a minute (by time: the supervision slows down)
var APP_GONE_ROUNDS = 2;                               // and given up on when two lookups in a row say it is gone

function wrap(s) { return 'echo ' + Buffer.from(s).toString('base64') + ' | base64 -d | sh'; }
function q(s) { return "'" + String(s).replace(QUOTE_RE, "'\\''") + "'"; }

// The cheap "is it running" check: the pid file, then the command line of that pid, read with shell builtins only (no
// pipe, no other program), sent as one line without the base64 wrapper, so the root agent starts one shell and nothing
// else (the full probe below starts about ten processes). Same meaning as the probe: the pid is alive AND its command
// line holds our dll. The command line is NUL-separated and bash 3.2 (the TV's sh) keeps only its first field with a
// plain read, so each field is read on its own (read -d ''). A pid that is alive but did not match is reported as
// other=<pid>: the caller then asks the full probe, so a shell that cannot read the fields only costs the full probe.
function runningCheck(pidFile, dll, tag) {
    return 'p=; [ -r ' + pidFile + ' ] && read -r p < ' + pidFile + '; f=; a=; case "$p" in \'\'|*[!0-9]*) p= ;; *) ' +
        '[ -r /proc/$p/cmdline ] && while IFS= read -r -d \'\' a || [ -n "$a" ]; do case "$a" in *' + dll + '*) f=1; break ;; esac; a=; done < /proc/$p/cmdline ;; esac; ' +
        'if [ -n "$f" ]; then echo "' + tag + '=$p"; else echo "' + tag + '="; [ -n "$p" ] && [ -d /proc/$p ] && echo "other=$p"; fi; true';
}
var CHECK_OTHER_RE = /^other=(\d+)$/m;
function parseCheck(out, re) {
    var pid = re.exec(out), other = CHECK_OTHER_RE.exec(out);
    return {running: !!pid, pid: pid ? +pid[1] : null, other: other ? +other[1] : null, cheap: true};
}

var SOURCE_OPTION_KEYS = ['showHomeSources', 'useSourceImages'];
function legacySourceUsage(file, images) {
    try {
        if (fs.statSync(file).size > 65536) return false;
        return fs.readFileSync(file, 'utf8').split('\n').some(function (line) {
            var fields = line.split('\t');
            return /^source:(?:13|14|15|16)$/.test(fields[2] || '') && (!images || !!fields[4]);
        });
    } catch (e) { return false; }
}

function Dock(options) {
    options = options || {};
    this.execute = options.execute;
    this.dir = options.dir || path.join(__dirname, '..', 'native', 'dock');
    this.stateFile = options.stateFile || STATE_FILE;
    this.appsFile = options.appsFile || APPS_FILE;
    this.customAppsFile = options.customAppsFile || CUSTOM_APPS_FILE;
    // Custom mode needs two things from the shell: appCheck(appId) -> {ok, label|reason} for the chosen app (rejects
    // when the registry cannot be read now), and home {restore()} to put Samsung's Home back when an earlier build
    // of the mode had disabled it (state flag customHomeDisabled, never set by this version).
    this.home = options.home || null;
    this.appCheck = options.appCheck || null;
    this.onVolumeChange = options.onVolumeChange || null;
    this.port = options.port || null;                         // the service's port (a number or a function), for the launcher's own calls to Vetro
    this.build = options.build || null;                       // this Vetro build: a launcher started by another one is restarted (supervise)
    this.onMotionChange = options.onMotionChange || null;     // Reduce motion changed: the tuner follows the same setting
    this.appCheckedAt = null;     // this.now() of the last lookup of the custom launcher's app
    this.goneRounds = 0;
    this.inputsFile = options.inputsFile || path.join(path.dirname(this.appsFile), 'vetro-dock-inputs.tsv');
    this.allAppsFile = options.allAppsFile || path.join(path.dirname(this.appsFile), 'vetro-dock-allapps.tsv');
    // The one-time migration of the two source options reads both lists; it is read once, and only when a state lacks them.
    this.legacySources = null;
    this.stateCache = null;       // the parsed state file and the stat it was read at (readState)
    this.cheapBroken = false;     // the cheap check said "not ours" for a pid the full probe found running: probe in full from then on
    this.changes = 0;             // counts starts and stops: the supervision goes back to its short interval when it moves
    this.sleep = options.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    this.pendingRow = null; this.rowRunning = false; this.rowRetry = null;
    this.relistPending = false; this.relistRetry = null; this.relistTimer = null; this.reloadedAt = null;
    this.relistFollowMs = options.relistFollowMs || 20000;
    this.rowRetryMs = options.rowRetryMs || 1000;
    this.now = options.now || Date.now;
    this.uptime = options.uptime || function () { return os.uptime(); };
    this.busy = false;
    this.failures = 0;
    this.nextTry = 0;
    // Seconds since the TV booted at which this service process began: says whether this run of the service is the one
    // that came up with the TV (boot tasks, closing Samsung's idle Home) or a later restart (an update, a crash).
    this.serviceStart = options.serviceStart !== undefined ? options.serviceStart : Math.round((this.uptime() - process.uptime()) * 10) / 10;
    this.timeline = {serviceStart: this.serviceStart};   // seconds since the TV booted, per step of the first start (see mark())
    this.agentSeenAt = null;     // this.now() when supervise first saw the root agent
    this.upAt = null;            // this.now() when the dock was first seen running
    this.lastError = null;
    this.lastCatalog = null;
    this.refreshPending = false;
    this.shards = null;            // the plugin host, once setShards() has been called
    this.shardTimer = null;
    this.lastShardLaunch = null;
}

Dock.prototype.installed = function () {
    try { return fs.existsSync(path.join(this.dir, DLL)) && fs.existsSync(path.join(this.dir, 'res', 'glass_tile.png')); }
    catch (e) { return false; }
};

var VOLUME_EDGES = ['left', 'right', 'top', 'bottom', 'hidden'];   // where the volume bar sits (the dock's --volume-edge); hidden: the level changes, no bar
// The Control center's cards (Down on the apps row), in the order they stand on screen; at most three (the dock's --cards).
var CARDS = ['tasks', 'audio', 'picture', 'sleep'], MAX_CARDS = 3;
// A Shard (plugin) can add one card (manifest "controlCenter"): it is named "shard:<plugin id>". A saved list keeps such a name even while
// its Shard is off or gone, so the choice comes back with the Shard; what the launcher is started with (cardsArg) only has the running ones.
var SHARD_CARD_RE = /^shard:([a-z][a-z0-9-]{1,31})$/;
function cleanCards(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (c) { if ((CARDS.indexOf(c) >= 0 || (typeof c === 'string' && SHARD_CARD_RE.test(c))) && out.indexOf(c) < 0 && out.length < MAX_CARDS) out.push(c); });
    return out;
}
// A card's label on the launcher's command line: every byte outside [A-Za-z0-9.-] as =HH (UTF-8), so it needs no quoting in a shell and
// no % for systemd. The launcher decodes it (ControlCenter.Parse).
function hexLabel(text) {
    var bytes = Buffer.from(String(text), 'utf8'), out = '';
    for (var i = 0; i < bytes.length; i++) {
        var b = bytes[i];
        out += (b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122) || b === 46 || b === 45 ? String.fromCharCode(b) : '=' + (b < 16 ? '0' : '') + b.toString(16).toUpperCase();
    }
    return out;
}
// The user's own row: Vetro's order of the tiles and the ones taken out of it, by row key (dock-catalog ROW_KEY), plus
// custom names. Samsung's own Home row is never written; it stays the base the user's row is laid over.
var MAX_ROW = 40;
function cleanRow(r) {
    if (!r || typeof r !== 'object') return null;
    function keys(list) { var out = []; (Array.isArray(list) ? list : []).forEach(function (k) { if (typeof k === 'string' && catalog.ROW_KEY.test(k) && out.indexOf(k) < 0 && out.length < 120) out.push(k); }); return out; }
    var labels = {};
    if (r.labels && typeof r.labels === 'object') Object.keys(r.labels).forEach(function (k) { if (catalog.ROW_KEY.test(k) && typeof r.labels[k] === 'string') labels[k] = catalog.cleanLabel(r.labels[k], ''); });
    return {order: keys(r.order).slice(0, MAX_ROW), hidden: keys(r.hidden), labels: labels};
}
// Before the Control center there was one switch, the Task manager: it reads as that card alone.
// The row the user left (keys in order) over Samsung's row: their order, and every Samsung tile they left out as taken out.
// A tile they put back is no longer taken out; custom names stay.
function rowAfter(before, list, samsungKeys) {
    var hidden = (before && before.hidden || []).filter(function (k) { return list.indexOf(k) < 0; });
    samsungKeys.forEach(function (k) { if (k && list.indexOf(k) < 0 && hidden.indexOf(k) < 0) hidden.push(k); });
    return cleanRow({order: list, hidden: hidden, labels: before && before.labels || {}});
}
function stateCards(s) { return s && Array.isArray(s.cards) ? cleanCards(s.cards) : (s && s.taskManager === true ? ['tasks'] : []); }

// Read on every remote key the bridge forwards (volume, 123) and by most routes, so the parsed file is kept and read again
// only when the file changed: a write through writeState drops it, and a write by anyone else changes the file's inode
// (atomic writes rename a new file), its size or its modification time. A missing file is read again each time.
Dock.prototype.readStateFile = function () {
    var st = fs.statSync(this.stateFile);
    var key = st.ino + ':' + st.size + ':' + (st.mtimeMs !== undefined ? st.mtimeMs : +st.mtime);
    if (this.stateCache && this.stateCache.key === key) return this.stateCache.value;
    var value = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
    this.stateCache = {key: key, value: value};
    return value;
};

Dock.prototype.legacy = function (which) {
    if (!this.legacySources) this.legacySources = {home: legacySourceUsage(this.appsFile, false), images: legacySourceUsage(this.inputsFile, true)};
    return this.legacySources[which];
};

Dock.prototype.readState = function () {
    try {
        var s = this.readStateFile();
        return {enabled: s && s.enabled === true, since: typeof s.since === 'number' ? s.since : null, fixTizenTube: s && s.fixTizenTube === true,
            noMotion: s && s.noMotion === true, volumePill: s && s.volumePill === true, volumeEdge: s && VOLUME_EDGES.indexOf(s.volumeEdge) >= 0 ? s.volumeEdge : 'left', numberPad: s && s.numberPad === true, taskManager: stateCards(s).indexOf('tasks') >= 0, cards: stateCards(s), row: cleanRow(s && s.row), autorunWas: s && s.autorunWas === 1 ? 1 : null,
            customApp: s && typeof s.customApp === 'string' && APP_ID_RE.test(s.customApp) ? s.customApp : null,
            customSince: s && typeof s.customSince === 'number' ? s.customSince : null,
            customHomeDisabled: s && s.customHomeDisabled === true,
            build: s && typeof s.build === 'string' ? s.build : null,
            buildPid: s && typeof s.buildPid === 'number' ? s.buildPid : null,
            // The --cards the running launcher was started with (null: started by a Vetro that did not note it).
            shownCards: s && typeof s.shownCards === 'string' ? s.shownCards.slice(0, 400) : null,
            // The cards the Control center had when it was last on: switching it off and on again (the TV screen's Vetro UI tile) brings them back.
            lastCards: s && Array.isArray(s.lastCards) ? cleanCards(s.lastCards) : [],
            showHomeSources: s && typeof s.showHomeSources === 'boolean' ? s.showHomeSources : this.legacy('home'),
            useSourceImages: s && typeof s.useSourceImages === 'boolean' ? s.useSourceImages : this.legacy('images'),
            // The store pill of All apps: TV-Store when it is installed (the default), or Samsung's store.
            appStore: s && s.appStore === 'samsung' ? 'samsung' : 'tvstore'};
    } catch (e) { return {enabled: false, since: null, fixTizenTube: false, noMotion: false, volumePill: false, volumeEdge: 'left', numberPad: false, taskManager: false, cards: [], shownCards: null, row: null, autorunWas: null, customApp: null, customSince: null, customHomeDisabled: false,
        showHomeSources: this.legacy('home'), useSourceImages: this.legacy('images'), appStore: 'tvstore'}; }
};

// Source-option migration must never overwrite an unreadable or malformed existing state.
Dock.prototype.validateSourcePreferenceState = function () {
    try {
        var state = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
        if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Invalid launcher state');
    } catch (e) {
        if (e.code !== 'ENOENT') throw new Error('Cannot read launcher preferences: ' + e.message);
    }
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

// The file also holds `autorunWas`, the only record that Samsung's Autorun Smart Hub was switched off by Vetro: a truncated
// write would lose it and leave that TV setting off for good. Written whole or not at all, and no temporary file is left behind.
Dock.prototype.writeState = function (state) {
    this.stateCache = null;
    try { atomicFile.write(fs, this.stateFile, JSON.stringify(state)); }
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
        // Samsung's Home is a .NET app: its process is the TV's dotnet launcher and its name the tail of the app id after "DN_"
        // (DN_sung.tv.csfs on a 2021 TV), so pidof never finds it and the name is not "csfs" alone. Both spellings count.
        'if pidof ' + HOME_APP + ' >/dev/null 2>&1 || grep -qE "(^|[._])csfs$" /proc/[0-9]*/comm 2>/dev/null; then echo "home=1"; else echo "home=0"; fi',
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

// Only "is it running": {running, pid, other, cheap: true}. See runningCheck().
Dock.prototype.check = function () {
    return this.execute(runningCheck(PID_FILE, DLL, 'dock'), 6000).then(function (r) { return parseCheck(check(r, 'Status'), PROBE_DOCK_RE); });
};

// What the supervision and the start wait use: the cheap check, and the full probe when the check cannot tell (a live pid
// that did not match). When the full probe then finds that very pid running, the cheap check does not work on this TV and
// the full probe is used from then on.
Dock.prototype.runningNow = function () {
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

// Boot timeline: seconds since the TV booted at which each step of the first start happened. Kept in memory and shown
// with the status, so one reboot is enough to see where the time goes. Each step is recorded once.
Dock.prototype.up = function () { if (this.upAt === null) { this.upAt = this.now(); this.mark('running'); } };

Dock.prototype.mark = function (step, value) {
    if (this.timeline[step] === undefined) this.timeline[step] = value === undefined ? Math.round(this.uptime() * 10) / 10 : value;
};

// True when other boot tasks may use the (serial) root agent: the launcher is off or already up, or it has had
// BOOT_GATE_MS since the agent connected. Their long commands would otherwise queue in front of the dock's start.
Dock.prototype.bootSettled = function () {
    try {
        var state = this.readState();
        if ((!state.enabled && !state.customApp) || !this.installed()) return true;
        if (this.upAt !== null) return true;
        return this.agentSeenAt !== null && this.now() - this.agentSeenAt > BOOT_GATE_MS;
    } catch (e) { return true; }      // it runs inside timers: never throw, never hold the other boot tasks back by mistake
};

Dock.prototype.statusNow = function () {
    var self = this, state = this.readState();
    var base = {installed: this.installed(), enabled: state.enabled, since: state.since, busy: this.busy,
        error: this.lastError, failures: this.failures, apps: this.lastCatalog, fixTizenTube: state.fixTizenTube, noMotion: state.noMotion, volumePill: state.volumePill, volumeEdge: state.volumeEdge, numberPad: state.numberPad, taskManager: state.taskManager, cards: this.cardsEffective(state), cardChoices: this.cardChoices(), cardShards: this.cardShards(), cardsPaused: this.cardsPaused(state), maxCards: MAX_CARDS, rowCustomised: !!state.row, showHomeSources: state.showHomeSources, useSourceImages: state.useSourceImages, appStore: state.appStore, autorunSwitchedOff: state.autorunWas === 1,
        mode: state.customApp ? 'custom' : state.enabled ? 'vetro' : 'off', customApp: state.customApp, customSince: state.customSince,
        customHomeDisabled: state.customHomeDisabled,
        entries: this.entries(), inputs: this.inputEntries(), lastShardLaunch: this.lastShardLaunch, bootTimeline: this.timeline,
        runningCheck: this.cheapBroken ? 'full' : 'cheap'};   // which check the supervision uses (see runningNow)
    return this.probe().then(function (p) {
        return Object.assign(base, {running: p.running, pid: p.pid, samsungHome: p.samsungHome, log: p.log});
    }).catch(function (e) {
        return Object.assign(base, {running: null, pid: null, samsungHome: null, log: '', probeError: e.message});
    });
};

function servicePort(port) {
    var n = typeof port === 'function' ? port() : port;
    return typeof n === 'number' && n % 1 === 0 && n >= 1024 && n <= 65535 ? n : null;
}

// --- the Control center's cards, with the Shards' ones ---------------------------------------------------------------------------
// {"shard:<id>": label} for the running Shards that have a card.
Dock.prototype.cardShards = function () {
    var out = {};
    if (!this.shards || typeof this.shards.cards !== 'function') return out;
    var list;
    try { list = this.shards.cards() || []; } catch (e) { return out; }
    list.forEach(function (c) { if (c && typeof c.plugin === 'string' && typeof c.label === 'string') out['shard:' + c.plugin] = c.label; });
    return out;
};
// What can be switched on now: the four cards of Vetro and one for each running Shard that has one.
Dock.prototype.cardChoices = function () { return CARDS.concat(Object.keys(this.cardShards())); };
// The saved cards the launcher shows now: a Shard's card only while that Shard runs.
Dock.prototype.cardsEffective = function (state) {
    var shards = this.cardShards();
    return (state || this.readState()).cards.filter(function (c) { return CARDS.indexOf(c) >= 0 || Object.prototype.hasOwnProperty.call(shards, c); });
};
// Saved Shard cards that are not shown now, with the label the Shard gave and why: [{card, label, why}].
Dock.prototype.cardsPaused = function (state) {
    var self = this, shards = this.cardShards();
    return (state || this.readState()).cards.filter(function (c) { return SHARD_CARD_RE.test(c) && !Object.prototype.hasOwnProperty.call(shards, c); }).map(function (c) {
        var id = SHARD_CARD_RE.exec(c)[1], st = null;
        try { st = self.shards && self.shards.status(id); } catch (e) { st = null; }
        return {card: c, label: st && st.controlCenter ? st.controlCenter.label : id, why: !st ? 'The Shard is not installed' : st.state === 'running' ? 'The Shard has no card' : 'The Shard is switched off'};
    });
};
// The value of the launcher's --cards: "tasks,shard:home-assistant:Home=20Assistant" ('' when no card shows).
Dock.prototype.cardsArg = function (state) {
    var shards = this.cardShards();
    return this.cardsEffective(state).map(function (c) { return SHARD_CARD_RE.test(c) ? c + ':' + hexLabel(shards[c]) : c; }).join(',');
};
// True when the launcher that runs was started with the cards it should show now.
Dock.prototype.cardsShown = function () {
    var state = this.readState(), want = this.cardsArg(state);
    return state.shownCards === null ? want.indexOf('shard:') < 0 : state.shownCards === want;
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
    var args = DLL + ' --apps ' + q(state.customApp ? this.customAppsFile : this.appsFile) + ' --inputs ' + q(this.inputListPath()) +
        (!state.customApp && fs.existsSync(this.allAppsFile) ? ' --all-apps ' + q(this.allAppsFile) : '') +
        ' --hidden' + (state.customApp ? ' --no-premap --no-warmup --home-launch ' + state.customApp : '') +
        // The launcher calls Vetro for a tile a plugin took over and to save the row: on the port this build answers on.
        (servicePort(this.port) ? ' --service-port ' + servicePort(this.port) : '') +
        ' --home-code ' + HOME_CODE + ' --kill-on-home ' + HOME_KILL.join(',') + (state.noMotion && !state.customApp ? ' --no-motion' : '') + ' --volume-edge ' + state.volumeEdge +
        // The Control center (Down from the apps row) is opt-in: without a card the dock looks and acts as before.
        (!state.customApp && this.cardsArg(state) ? ' --cards ' + this.cardsArg(state) : ' --no-tasks');
    return [
        this.stopLines(),
        'rm -f ' + FIFO,
        'cd ' + q(this.dir),
        'systemd-run --unit=' + UNIT + ' --collect -p WorkingDirectory=' + q(this.dir) + ' -p KillSignal=SIGKILL -p StandardOutput=null -p StandardError=null ' +
            '/usr/bin/env ' + env + ' /usr/bin/dotnet ' + args + ' >/dev/null 2>&1 || ' +
        env + ' setsid nohup /usr/bin/dotnet ' + args + ' </dev/null >/dev/null 2>&1 &',
        PREVIEW_OFF,
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
    var state = this.readState();
    // Persist defaults/migration before generating lists, so a fresh preview cannot be mistaken for legacy data later.
    try { this.validateSourcePreferenceState(); this.patchState({showHomeSources: state.showHomeSources, useSourceImages: state.useSourceImages}); } catch (e) { return Promise.reject(e); }
    return catalog.load(this.execute, this.catalogOptions(state)).then(function (c) {
        self.saveLists(c);
        return c;
    });
};

// What every read of the Home data is built with, from the saved state: one place, so no caller forgets a setting (a row saved from the
// launcher that left the store choice out would put TV-Store back on a TV where the user chose Samsung's store).
Dock.prototype.catalogOptions = function (state, row) {
    return {fixTizenTube: state.fixTizenTube, showHomeSources: state.showHomeSources, useSourceImages: state.useSourceImages,
        intercepted: this.shards ? this.shards.intercepted() : {}, row: row === undefined ? state.row : row, appStore: state.appStore};
};
// Writes the three lists the launcher reads. Returns true when one of them is not what was there before.
Dock.prototype.saveLists = function (c) {
    var files = [[this.appsFile, c.tsv], [this.inputsFile, c.inputsTsv], [this.allAppsFile, c.allAppsTsv]];
    var changed = files.some(function (f) { try { return fs.readFileSync(f[0], 'utf8') !== f[1]; } catch (e) { return true; } });
    try { files.forEach(function (f) { atomicFile.write(fs, f[0], f[1]); }); }
    catch (e) { throw new Error('The app list could not be saved: ' + e.message); }
    this.lastCatalog = {count: c.count, skipped: c.skipped, at: this.now(), appStore: c.appStore || 'samsung', tvStoreInstalled: !!c.tvStoreInstalled};
    return changed;
};

// Right after a boot the TV is still starting dozens of services, so a start that is slow but
// alive is not a failure: it gets a long wait, and the next supervision tick finds it by its pid.
Dock.prototype.waitRunning = function () {
    var self = this, deadline = this.now() + (this.uptime() < BOOT_WINDOW_S ? BOOT_WAIT_MS : START_WAIT_MS);
    // One probe that fails (the agent reconnecting, a probe out of time while the TV is busy) is not the dock failing to
    // start: it counts as "not seen yet". The wait between probes grows (1, 2, 3 s): each probe is a handful of processes
    // on a TV that is already busy starting.
    // Each poll is the cheap check (one shell); the full probe comes last, for its log lines and as the last word.
    var round = 0;
    function full(p) { return p.cheap ? self.probe().catch(function () { return {running: false, log: ''}; }) : Promise.resolve(p); }
    function poll() {
        return self.runningNow().catch(function () { return {running: false, log: ''}; }).then(function (p) {
            if (p.running) return p;
            if (self.now() > deadline) return full(p).then(function (f) {
                if (f.running) return f;
                throw new Error('The dock did not start. ' + (f.log ? 'Last log lines: ' + f.log.split('\n').slice(-2).join(' | ') : 'It wrote no log.'));
            });
            return self.sleep(Math.min(3000, 1000 * ++round)).then(poll);
        });
    }
    return this.sleep(1500).then(poll);
};

// `quick` is the start after a boot or a crash: it uses the list saved by the last start, so the
// slow Home read does not sit in front of the dock, and the list is refreshed once the dock is up.
Dock.prototype.launch = function (quick) {
    var self = this, custom = this.readState().customApp, saved = !custom && quick && this.hasSavedApps();
    this.changes++;
    return (custom ? this.writeCustomList(custom) : saved ? Promise.resolve() : this.writeCatalog()).then(function () {
        // Right after a boot systemd answers slowly, so the start script gets the long wait; a start that still runs
        // out of time is not a failure either (the dock usually comes up from that same attempt): waitRunning() decides.
        self.mark('startIssued');
        var boot = self.uptime() < BOOT_WINDOW_S, t0 = self.now();
        return self.execute(wrap(self.startScript()), boot ? BOOT_WAIT_MS : 10000).then(function (r) {
            self.mark('startCallMs', self.now() - t0);
            return r;
        });
    }).then(function (r) {
        if (r && r.timed_out) self.mark('startTimedOut', true); else check(r, 'Start');
        return self.waitRunning();
    }).then(function (p) {
        if (saved) self.refreshPending = true;
        // Which build of Vetro started this process (see supervise): never a reason to fail a start that worked.
        // Kept in memory too: if the state cannot be saved, the launcher must still be restarted only once per run.
        self.startedHere = true;
        if (self.build) { try { self.rememberBuild(p); } catch (e) {} }
        try { var st = self.readState(); if (!st.customApp) self.patchState({shownCards: self.cardsArg(st)}); } catch (e) { /* only decides whether a Shard's change restarts the launcher */ }
        return p;
    });
};

// The build that started the launcher, and the process it started. The pid matters after "go back, then update again to
// the same version": the state still names this build, but the process running is the one the older Vetro started.
Dock.prototype.rememberBuild = function (p) {
    var state = this.readState(), pid = p && typeof p.pid === 'number' ? p.pid : null;
    if (state.build !== this.build || state.buildPid !== pid) this.patchState({build: this.build, buildPid: pid});
};
// True when the launcher that runs was not started by this build: another build is named in the state, or this build is
// but for another process. Never true for a launcher this run of the service started.
Dock.prototype.otherBuild = function (state, p) {
    if (!this.build || this.startedHere) return false;
    return state.build !== this.build || (!!state.buildPid && !!p && typeof p.pid === 'number' && state.buildPid !== p.pid);
};

// The saved list is rebuilt once the TV has settled: in the first minutes Samsung's Home may still
// be rewriting its own row, and a half-written read must not replace the good list.
Dock.prototype.refreshCatalogLater = function () {
    if (!this.refreshPending || this.uptime() < BOOT_WINDOW_S) return;
    this.refreshPending = false;
    var self = this;
    // The running launcher is told too: these lists may also hold an app installed meanwhile, and once they are written the launcher's
    // own check (its lists newer than the package database) would not ask for them any more.
    this.writeCatalog().then(function () { return self.tellReload(); }).catch(function () {});
};

// Plugins that claim an app's tile (manifest "intercepts"). `host` is the plugin host: intercepted() says which apps are claimed,
// launch(appId) starts one through its plugin. When a claiming plugin starts or stops, the list is rebuilt so the tile follows;
// in the first minutes after a boot, and while another change is under way, the rebuild waits for the normal later pass.
Dock.prototype.setShards = function (host) {
    var self = this;
    this.shards = host;
    if (!host || typeof host.onInterceptChange !== 'function') return;
    host.onInterceptChange(function () {
        var state = self.readState();
        if (!state.enabled || state.customApp) return;
        if (self.busy || self.uptime() < BOOT_WINDOW_S) { self.refreshPending = true; return; }
        if (self.shardTimer) clearTimeout(self.shardTimer);
        self.shardTimer = setTimeout(function () {
            self.shardTimer = null;
            if (self.busy) { self.refreshPending = true; return; }
            // Plugins start with the service, so this runs at every service start: when the row already shows what
            // the plugins claim, there is nothing to rebuild and the launcher must not be restarted for it.
            if (self.claimsShown() && self.cardsShown()) return;
            // A rebuild that fails here (the root agent not connected yet, right after a service restart) is tried again
            // by the supervision once the launcher is seen running; it is not an error to show on the Launcher page.
            self.refresh().catch(function () { self.refreshPending = true; self.lastError = null; });
        }, 1500);
        if (self.shardTimer.unref) self.shardTimer.unref();
    });
};

// True when the saved row marks as taken exactly the apps that running plugins claim now.
Dock.prototype.claimsShown = function () {
    var claimed;
    try { claimed = this.shards.intercepted() || {}; } catch (e) { return false; }
    var entries = this.entries();
    if (!entries.length) return false;
    for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (e.system || e.panel || e.source !== null) continue;
        if (e.shard !== Object.prototype.hasOwnProperty.call(claimed, e.appId)) return false;
    }
    return true;
};

// The tile of this slug when a plugin has taken it over, else null.
Dock.prototype.shardEntry = function (slug) {
    if (!SLUG_RE.test(String(slug))) return null;
    var found = this.entries().filter(function (e) { return e.slug === slug && e.shard && APP_ID_RE.test(e.appId); })[0];
    return found || null;
};

// Starts the app of a plugin tile: through the plugin that claims it, otherwise the plain way. The decision is made here and not in
// the launcher, so the launcher never starts the app a second time while a plugin is still preparing. Always resolves.
Dock.prototype.openEntry = function (slug) {
    var self = this, entry = this.shardEntry(slug);
    if (!entry) return Promise.resolve({ok: false, via: null, reason: 'No such tile'});
    var asked;
    try { asked = this.shards ? Promise.resolve(this.shards.launch(entry.appId)) : Promise.resolve({handled: false, reason: 'Plugins are not available'}); }
    catch (e) { asked = Promise.reject(e); }
    // A host that fails is the same as a plugin that cannot: the app still has to start.
    return asked.then(null, function (e) { return {handled: false, reason: String(e && e.message || e)}; }).then(function (r) {
        if (r && r.handled) { self.lastShardLaunch = {slug: slug, appId: entry.appId, via: r.plugin, reason: null, at: self.now()}; return {ok: true, via: r.plugin}; }
        var reason = r && r.reason || 'The plugin did not start it';
        return self.execute('app_launcher -s ' + entry.appId, 15000).then(function () {
            self.lastShardLaunch = {slug: slug, appId: entry.appId, via: null, reason: reason, at: self.now()};
            return {ok: true, via: null, reason: reason};
        });
    }).catch(function (e) {
        self.lastShardLaunch = {slug: slug, appId: entry.appId, via: null, reason: String(e && e.message || e), at: self.now()};
        return {ok: false, via: null, reason: self.lastShardLaunch.reason};
    });
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
    var self = this;
    this.changes++;
    return this.execute(wrap(this.stopLines()), 8000).then(function (r) { check(r, 'Stop'); }).then(function () {
        // Best effort: Samsung's Home needs its preview updater back once the dock no longer covers it.
        return self.execute(wrap(PREVIEW_ON), 8000).catch(function () {});
    });
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

// For a setting that restarts the launcher. When the restart is not seen in time, the setting is put back (undo) only if
// the launcher really is not running: one that came up late was started with the NEW setting, and putting the old one
// back would leave the saved setting and the running process disagreeing, under an error that nothing clears.
Dock.prototype.refreshOr = function (undo) {
    var self = this;
    return this.refresh().catch(function (e) {
        return self.runningNow().then(function (p) { return !!p.running; }, function () { return false; }).then(function (running) {
            if (running) { self.lastError = null; return self.status(); }
            try { undo(); } catch (e2) {}
            throw e;
        });
    });
};

// After a self-update: the launcher is started again with the new files, unless the supervision has already done it
// (it restarts a launcher that another build started).
Dock.prototype.restartAfterUpdate = function () {
    var self = this;
    if (this.busy) return Promise.reject(new Error('Another dock change is in progress'));
    if (!this.build) return this.refresh();
    return this.runningNow().then(function (p) { return p.running && !self.otherBuild(self.readState(), p) ? self.status() : self.refresh(); });
};

// ---- Custom launcher: the user's own app on the Home key --------------------------------------------------------
//
// One switch does two things: the Home key opens the chosen app (the headless dock, with the same unit, the same
// supervision and the same standby survival as the Vetro launcher, and the same guard that closes Samsung's Home
// after each press), and Autorun Smart Hub is switched off so that the TV does not power on to Samsung's Home.
// Samsung's Home itself is left alone, so a reboot, a power cut or a failed update can never leave the TV without
// the first screen its boot waits for. Everything is undone in the opposite order, and only what this mode changed.

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
        try { atomicFile.write(fs, self.customAppsFile, customLine(appId)); resolve(); }
        catch (e) { reject(new Error('The custom launcher list could not be saved: ' + e.message)); }
    });
};

Dock.prototype.requireCustomParts = function () {
    if (!this.installed()) return new Error('The dock files are not in this Vetro package');
    if (!this.appCheck) return new Error('The custom launcher is not available in this build');
    return null;
};

// Turn the custom launcher on, or change its app when it is on already. Order: the app is checked, the headless
// process is started and seen running, and Autorun Smart Hub is switched off. The intent is written before the
// start, as autorunWas is, so that a crash in the middle leaves something the service can finish or undo.
Dock.prototype.enableCustom = function (appId) {
    var self = this, before = this.readState();
    if (typeof appId !== 'string' || !APP_ID_RE.test(appId)) return Promise.reject(new Error('Choose an app from the list'));
    if (this.busy) return Promise.reject(new Error('Another launcher change is in progress'));
    var missing = this.requireCustomParts();
    if (missing) return Promise.reject(missing);
    if (before.enabled) return Promise.reject(new Error('Turn off the Vetro launcher before turning on the custom launcher'));
    if (before.customApp === appId) return this.status();
    this.busy = true; this.lastError = null;
    var changing = !!before.customApp;
    return this.appCheck(appId, true).then(function (c) {
        if (!c || c.ok !== true) throw new Error((c && c.reason) || 'This app cannot be used as a launcher');
        // Written first: if this process dies now, supervision starts the headless dock for this app.
        self.patchState({customApp: appId, customSince: changing ? before.customSince : self.now()});
        return self.launch();
    }).then(function () {
        self.failures = 0; self.nextTry = 0; self.goneRounds = 0;
        if (changing) return null;
        return self.turnOffAutorun()
            .catch(function (e) { self.lastError = 'The custom launcher is on, but Autorun Smart Hub could not be switched off: ' + e.message; });
    }).then(function () {
        if (changing) return null;
        // Samsung's Home is idle in the background; closing it frees its memory and clears the screen for the app.
        return self.execute(HOME_KILL.map(function (id) { return 'app_launcher -k ' + id; }).join('; '), 8000).catch(function () {});
    }).then(function () { return self.status(); }).catch(function (e) {
        self.lastError = e.message;
        return self.undoCustomStart(before).then(function () { throw e; });
    }).finally(function () { self.busy = false; });
};

// A start that failed half way: back to the state before it.
Dock.prototype.undoCustomStart = function (before) {
    var self = this;
    function failed(label) { return function (e) { self.lastError = (self.lastError ? self.lastError + ' · ' : '') + label + ': ' + e.message; }; }
    if (before.customApp) {                          // it was a change of app: the old app goes back
        try { self.patchState({customApp: before.customApp}); } catch (e) { return Promise.resolve(); }
        return self.launch().catch(failed('The previous app was not started again'));
    }
    try { self.patchState({customApp: null, customSince: null, customHomeDisabled: false}); } catch (e) { failed('The setting was not cleared')(e); }
    return self.stopDock().catch(function () {}).then(function () { return self.restoreAutorun(); }).catch(failed('Autorun Smart Hub was not put back'));
};

// Turn the custom launcher off. If an earlier build had disabled Samsung's Home, it goes back first: when it cannot
// be put back the mode stays on and keeps working, which is better than a Home key that opens nothing.
// options.keepHome leaves that to the caller (Restore the TV does it as its next step).
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

// The chosen app is gone (uninstalled or disabled) or the process cannot be started: the Home key goes back to Samsung.
Dock.prototype.giveUpCustom = function (reason) {
    var self = this;
    // The mode ends here without enable/disable being called: the remote bridge must be told too, or it keeps holding
    // back the volume and 123 keys for a launcher that is no longer there to answer them.
    return this.leaveCustom().then(function () {
        self.lastError = 'The custom launcher was turned off and Samsung’s Home answers the Home key again: ' + reason;
        return 'reverted';
    }, function (e) {
        self.lastError = reason + ' Samsung’s Home could not be put back: ' + e.message;
        return 'failed';
    }).then(function (result) { return self.keysChanged().then(function () { return result; }); });
};

// The list the dock was last given, as the page's preview shows it. Icons are served by iconFile().
function parseTsv(text) {
    return String(text || '').split('\n').filter(function (l) { return l.trim() && l.trim()[0] !== '#'; }).map(function (l) {
        var f = l.split('\t'), target = f[2] || '';
        return {slug: f[0], label: f[1], appId: target, icon: f[4] || null, killFirst: f[5] || null, shard: f[6] === 'shard', key: f[7] || null,
            system: TARGET_SYSTEM_RE.test(target), panel: TARGET_PANEL_RE.test(target), source: TARGET_SOURCE_RE.test(target) ? +target.slice(7) : null};
    }).filter(function (e) { return SLUG_RE.test(e.slug || '') && e.label; });
}
Dock.prototype.entries = function () {
    try { return parseTsv(fs.readFileSync(this.appsFile, 'utf8')); } catch (e) { return []; }
};
Dock.prototype.inputListPath = function () {
    return fs.existsSync(this.inputsFile) ? this.inputsFile : path.join(this.dir, 'res', 'inputs.tsv');
};
Dock.prototype.inputEntries = function () {
    try { return parseTsv(fs.readFileSync(this.inputListPath(), 'utf8')); } catch (e) { return []; }
};

// Like Fix TizenTube, source switches save a boolean and rebuild the launcher list.
Dock.prototype.setSourceOption = function (key, on) {
    var self = this;
    if (SOURCE_OPTION_KEYS.indexOf(key) < 0 || typeof on !== 'boolean') return Promise.reject(new Error('Invalid source option'));
    if (this.busy) return Promise.reject(new Error('Another launcher change is in progress'));
    try { this.validateSourcePreferenceState(); } catch (e) { return Promise.reject(e); }
    var before = this.readState();
    if (before[key] === on) return this.status();
    var patch = {};
    patch[key] = on;
    try { this.patchState(patch); } catch (e) { return Promise.reject(e); }
    this.busy = true; this.lastError = null;
    function rebuild() { return before.enabled ? self.launch() : self.writeCatalog(); }
    return Promise.resolve().then(rebuild).then(function () {
        if (self.readState()[key] !== on) throw new Error('Source option readback failed');
        return self.status();
    }).catch(function (error) {
        try { self.writeState(before); } catch (restoreError) { throw new Error(error.message + '; settings restore failed: ' + restoreError.message); }
        return Promise.resolve().then(rebuild).catch(function (restoreError) {
            self.lastError = error.message + '; catalog restore failed: ' + restoreError.message;
            throw new Error(self.lastError);
        }).then(function () { throw error; });
    }).finally(function () { self.busy = false; });
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
    return this.refreshOr(function () { self.patchState({fixTizenTube: state.fixTizenTube}); });
};

// Which store the store pill of All apps opens: 'tvstore' (TV-Store when it is installed, Samsung's store otherwise) or 'samsung'.
// It only changes the lists, rebuilt like Fix TizenTube does.
Dock.prototype.setAppStore = function (store) {
    var self = this;
    if (catalog.APP_STORES.indexOf(store) < 0) return Promise.reject(new Error('Invalid value'));
    if (this.busy) return Promise.reject(new Error('Another launcher change is in progress'));
    var state = this.readState();
    if (state.appStore === store) return this.status();
    try { this.patchState({appStore: store}); }
    catch (e) { return Promise.reject(e); }
    if (!state.enabled) return this.writeCatalog().catch(function () {}).then(function () { return self.status(); });
    return this.refreshOr(function () { self.patchState({appStore: state.appStore}); });
};

// Still selection: the focus jumps between tiles and the icons keep their size (the dock's --no-motion).
// It is a start argument, so a running dock is restarted.
Dock.prototype.setNoMotion = function (on) {
    var self = this;
    if (typeof on !== 'boolean') return Promise.reject(new Error('Invalid value'));
    if (this.busy) return Promise.reject(new Error('Another launcher change is in progress'));
    var state = this.readState();
    function tell() { if (self.onMotionChange) { try { self.onMotionChange(); } catch (e) {} } }
    try { this.patchState({noMotion: on}); }
    catch (e) { return Promise.reject(e); }
    tell();
    if (!state.enabled) return this.status();
    return this.refreshOr(function () { self.patchState({noMotion: state.noMotion}); tell(); });
};

// The Control center: Down from the apps row shows up to three cards side by side (the Task manager, the Audio output). A start
// argument (--cards, or --no-tasks when there is none), so a running Vetro launcher is restarted.
Dock.prototype.setCards = function (list) {
    var self = this;
    if (!Array.isArray(list)) return Promise.reject(new Error('Unknown card'));
    var state = this.readState(), shards = this.cardShards();
    // A Shard's card can be chosen while its Shard runs; one that was saved earlier may be put back at any time (the TV screen's tile does).
    var known = state.cards.concat(state.lastCards);
    if (list.some(function (c) { return CARDS.indexOf(c) < 0 && !(SHARD_CARD_RE.test(c) && (Object.prototype.hasOwnProperty.call(shards, c) || known.indexOf(c) >= 0)); })) return Promise.reject(new Error('Unknown card'));
    var cards = cleanCards(list);
    if (cards.length !== list.length) return Promise.reject(new Error('At most ' + MAX_CARDS + ' cards, each once'));
    if (this.busy) return Promise.reject(new Error('Another launcher change is in progress'));
    // A Shard card whose Shard is off stays saved, behind the cards just chosen and while there is room (it comes back with the Shard).
    var saved = cards.slice();
    if (cards.length) state.cards.forEach(function (c) {
        if (SHARD_CARD_RE.test(c) && !Object.prototype.hasOwnProperty.call(shards, c) && saved.indexOf(c) < 0 && saved.length < MAX_CARDS) saved.push(c);
    });
    var last = saved.length ? saved : state.cards.length ? state.cards : state.lastCards;
    try { this.patchState({cards: saved, taskManager: saved.indexOf('tasks') >= 0, lastCards: last}); }
    catch (e) { return Promise.reject(e); }
    if (!state.enabled) return this.status();
    return this.refreshOr(function () { self.patchState({cards: state.cards, taskManager: state.taskManager, lastCards: state.lastCards}); });
};

// The card of a Shard for the launcher, as text (the launcher has no JSON parser): lines of tab-separated fields, always answered, so that
// the launcher shows "Not available" and goes on whatever the Shard does. READ and SELECT answer the same way (docs/plugins.md).
//   status<TAB>ok|unavailable   [result<TAB>ok|fail (a choice)]   note<TAB>text   choosable<TAB>1|0   row<TAB>id<TAB>label<TAB>value<TAB>ticked 0|1
function shardCardText(card, extra) {
    var lines = [];
    if (!card || card.ok !== true) {
        lines.push('status\tunavailable');
        if (extra && extra.result) lines.push('result\t' + extra.result);
        lines.push('note\t' + ((extra && extra.note) || (card && card.reason) || 'Not available'));
        lines.push('choosable\t0');
    } else {
        lines.push('status\tok');
        if (extra && extra.result) lines.push('result\t' + extra.result);
        var note = extra && extra.note || card.note;
        if (note) lines.push('note\t' + note);
        lines.push('choosable\t' + (card.choosable ? 1 : 0));
        card.rows.forEach(function (r) { lines.push('row\t' + r.id + '\t' + r.label + '\t' + r.value + '\t' + (r.ticked ? 1 : 0)); });
    }
    return lines.join('\n') + '\n';
}

Dock.prototype.shardCardRead = function (id) {
    if (!this.shards || typeof this.shards.cardOf !== 'function') return Promise.resolve(shardCardText({ok: false, reason: 'Plugins are not available'}));
    return Promise.resolve(this.shards.cardOf(id)).then(null, function (e) { return {ok: false, reason: String(e && e.message || e)}; }).then(function (card) { return shardCardText(card); });
};

Dock.prototype.shardCardSelect = function (id, rowId) {
    var self = this;
    if (!this.shards || typeof this.shards.selectCard !== 'function') return Promise.resolve(shardCardText({ok: false, reason: 'Plugins are not available'}, {result: 'fail'}));
    return Promise.resolve(this.shards.selectCard(id, rowId)).then(null, function (e) { return {ok: false, note: String(e && e.message || e), card: null}; }).then(function (r) {
        if (r && r.unavailable) return shardCardText(r, {result: 'fail'});
        var note = r && r.note || (r && r.ok ? '' : 'It did not work');
        // Without a card after a failed action, the card is read again: the rows must still be on screen.
        return (r && r.card ? Promise.resolve(r.card) : self.shards.cardOf(id)).then(function (card) { return shardCardText(card, {result: r && r.ok ? 'ok' : 'fail', note: note}); });
    });
};

// The launcher sends the row as the user left it (moved, a tile taken out or added from All apps), always whole, and does not wait for
// the answer. Only the newest row matters, so a row that arrives while another change is under way waits as "pending" and replaces any
// older pending one; it is applied as soon as the launcher is free (a quick second hold on All apps is not lost). One read of the Home
// data gives both the lists to write and Samsung's row, from which the tiles left out are remembered as taken out. The running launcher
// already shows the row, so it is not restarted, and the Home row cleanup does not run.
Dock.prototype.setRow = function (list) {
    if (!Array.isArray(list) || !list.length || list.length > MAX_ROW || list.some(function (k) { return typeof k !== 'string' || !catalog.ROW_KEY.test(k); })) return Promise.reject(new Error('Invalid row'));
    var state = this.readState();
    if (!state.enabled || state.customApp) return Promise.reject(new Error('The Vetro launcher is off'));
    this.pendingRow = list.slice();
    if (this.rowRunning) return Promise.resolve({queued: true});
    return this.drainRows();
};

Dock.prototype.drainRows = function () {
    var self = this;
    if (!this.pendingRow) return Promise.resolve({ok: true});
    if (this.busy) {
        // Another launcher change (enable, refresh, a card switch) is running: try again shortly, for up to a minute.
        if (!this.rowRetry) {
            var tries = 0;
            this.rowRetry = setInterval(function () {
                if (self.busy && ++tries < 60000 / self.rowRetryMs) return;
                clearInterval(self.rowRetry); self.rowRetry = null;
                if (!self.busy) self.drainRows().catch(function (e) { self.lastError = 'The launcher row was not saved: ' + e.message; });
            }, this.rowRetryMs);
            if (this.rowRetry.unref) this.rowRetry.unref();
        }
        return Promise.resolve({queued: true});
    }
    var list = this.pendingRow, state = this.readState(), before = state.row;
    this.pendingRow = null;
    this.rowRunning = true; this.busy = true;
    return catalog.load(this.execute, this.catalogOptions(state, {order: list, hidden: [], exact: true, labels: before && before.labels || {}})).then(function (c) {
        self.saveLists(c);
        self.patchState({row: rowAfter(before, list, c.samsungKeys || [])});
    }).finally(function () {
        self.busy = false; self.rowRunning = false;
    }).then(function () {
        // A relist that read the row before this one arrived may have sent the launcher its lists, with the old row: they are
        // sent again (the launcher does nothing when they are what it shows).
        var resend = !self.pendingRow && self.reloadedAt !== null && self.now() - self.reloadedAt < 60000;
        return (resend ? self.tellReload() : Promise.resolve()).then(function () { return self.pendingRow ? self.drainRows() : {ok: true}; });
    }, function (e) {
        if (self.pendingRow) return self.drainRows();
        throw e;
    });
};

// Back to Samsung's row as it is (the dashboard's Reset), without restarting the launcher: the next start shows it.
Dock.prototype.resetRow = function () {
    var self = this;
    if (this.busy) return Promise.reject(new Error('Another launcher change is in progress'));
    try { this.patchState({row: null}); } catch (e) { return Promise.reject(e); }
    var state = this.readState();
    return (state.enabled && !state.customApp ? this.refresh() : this.status());
};

// An app was installed or removed (from any store, Apps2Samsung, pkgcmd): the launcher found the package manager's database newer than
// its lists when it came on screen, and asks for this. The Home data is read again with the saved row and settings, the lists are always
// written (their date tells the launcher the change has been looked at) and the launcher is always told to read them again, without a
// restart: it compares them with what it shows and does nothing when they are the same, so a "reload" lost on the way (the agent
// reconnecting) or lists written meanwhile by another path are still delivered by the next pass. One more pass follows a little later: Samsung's web app registry can get the new app's row after the
// package manager has it. While another launcher change runs, the relist waits for it (up to a minute).
Dock.prototype.relist = function (followUp) {
    var self = this, state = this.readState();
    if (!state.enabled || state.customApp) return Promise.resolve({ok: false, error: 'The Vetro launcher is off'});
    if (this.busy) { this.relistPending = true; this.relistWhenFree(); return Promise.resolve({queued: true}); }
    this.busy = true; this.relistPending = false;
    var changed = false;
    return catalog.load(this.execute, this.catalogOptions(state)).then(function (c) {
        changed = self.saveLists(c);
    }).finally(function () {
        self.busy = false;
    }).then(function () {
        if (!followUp) self.relistLater();
        return self.tellReload();
    }).then(function () {
        if (self.pendingRow) self.drainRows().catch(function (e) { self.lastError = 'The launcher row was not saved: ' + e.message; });
        return {ok: true, changed: changed};
    });
};
Dock.prototype.relistWhenFree = function () {
    var self = this, tries = 0;
    if (this.relistRetry) return;
    this.relistRetry = setInterval(function () {
        if (self.busy && ++tries < 60000 / self.rowRetryMs) return;
        clearInterval(self.relistRetry); self.relistRetry = null;
        if (!self.busy && self.relistPending) self.relist().catch(function () {});
    }, this.rowRetryMs);
    if (this.relistRetry.unref) this.relistRetry.unref();
};
Dock.prototype.relistLater = function () {
    var self = this;
    if (this.relistTimer) clearTimeout(this.relistTimer);
    this.relistTimer = setTimeout(function () { self.relistTimer = null; self.relist(true).catch(function () {}); }, this.relistFollowMs);
    if (this.relistTimer.unref) this.relistTimer.unref();
};
// "reload" down the launcher's control pipe, when it runs: it reads its three lists again and makes its pages again if they changed.
Dock.prototype.tellReload = function () {
    this.reloadedAt = this.now();
    var line = 'p=$(cat ' + PID_FILE + ' 2>/dev/null); if [ -n "$p" ] && [ -d /proc/$p ] && [ -p ' + FIFO + ' ]; then ( exec 3<>' + FIFO + ' && echo reload >&3 ); fi; true';
    return this.execute(line, 5000).catch(function () {});
};

// The launcher's process draws Vetro UI's volume bar and number pad, so when it comes or goes (from the dashboard, the TV screen's tile,
// Restore the TV or the supervision) the keys the remote bridge holds back change too: the service is told, and the answer waits for it.
Dock.prototype.keysChanged = function () {
    var follow = null;
    if (this.onVolumeChange) { try { follow = this.onVolumeChange(); } catch (e) {} }
    return Promise.resolve(follow).catch(function () {});
};
['enable', 'disable', 'enableCustom', 'disableCustom'].forEach(function (name) {
    var inner = Dock.prototype[name];
    Dock.prototype[name] = function () {
        var self = this;
        return inner.apply(this, arguments).then(function (status) {
            return self.keysChanged().then(function () { return status; });
        }, function (error) {
            return self.keysChanged().then(function () { throw error; });
        });
    };
});

// Glass volume pill: the dock draws it for Vol+ and Vol- (the bridge holds those keys back). The dock needs no restart;
// onVolumeChange lets the service restart the remote bridge so the new key list takes effect.
Dock.prototype.setVolumePill = function (on) { return this.setKeyOption('volumePill', on); };
// Which edge of the screen the pill sits on. It is a start argument, so a running dock is restarted.
Dock.prototype.setVolumeEdge = function (edge) {
    var self = this;
    if (VOLUME_EDGES.indexOf(edge) < 0) return Promise.reject(new Error('Invalid value'));
    if (this.busy) return Promise.reject(new Error('Another launcher change is in progress'));
    var state = this.readState();
    try { this.patchState({volumeEdge: edge}); }
    catch (e) { return Promise.reject(e); }
    if (!state.enabled) return this.status();
    return this.refreshOr(function () { self.patchState({volumeEdge: state.volumeEdge}); });
};
// The same for the number pad that replaces Samsung's 123 pad.
Dock.prototype.setNumberPad = function (on) { return this.setKeyOption('numberPad', on); };
Dock.prototype.setKeyOption = function (name, on) {
    if (typeof on !== 'boolean') return Promise.reject(new Error('Invalid value'));
    var patch = {}; patch[name] = on;
    try { this.patchState(patch); }
    catch (e) { return Promise.reject(e); }
    var self = this, follow = null;
    if (this.onVolumeChange) { try { follow = this.onVolumeChange(on); } catch (e) {} }
    // The service may turn the remote interception on for these keys: the answer waits for that, so the page reads the result.
    return Promise.resolve(follow).catch(function () {}).then(function () { return self.status(); });
};

// The volume bar and the number pad together (the TV screen's Vetro UI tile): one save, and the remote bridge is told once.
Dock.prototype.setKeys = function (on) {
    if (typeof on !== 'boolean') return Promise.reject(new Error('Invalid value'));
    try { this.patchState({volumePill: on, numberPad: on}); }
    catch (e) { return Promise.reject(e); }
    var self = this, follow = null;
    if (this.onVolumeChange) { try { follow = this.onVolumeChange(on); } catch (e) {} }
    return Promise.resolve(follow).catch(function () {}).then(function () { return self.status(); });
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

// After a boot Samsung's own Home is started by the TV and sits idle (~140 MB); the dock closes it only after a Home press,
// and enable() only when the switch is turned on. So once per service run, when the dock is up and the boot has settled, close
// it. Never during the boot window (the Q80A stalls without it), and only once: opening it again from the dock is deliberate.
Dock.prototype.closeHomeOnce = function (samsungHome) {
    if (this.homeClosed || this.uptime() < BOOT_WINDOW_S) return Promise.resolve();
    this.homeClosed = true;
    // Only the run of the service that came up with the TV does it: after a later restart (an update, a crash) a Samsung
    // Home on screen is one the user opened from the launcher, and closing it would take it away from them.
    if (!samsungHome || this.serviceStart >= BOOT_WINDOW_S) return Promise.resolve();
    return this.execute('app_launcher -k ' + HOME_APP, 8000).catch(function () {});
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
    if (this.agentSeenAt === null) { this.agentSeenAt = this.now(); this.mark('agentSeen'); }
    return this.healHome(state).then(function () { return self.runningNow(); }).then(function (c) {
        // The cheap check is enough while the launcher runs. "Not running" is confirmed by the full probe before anything is
        // started, and once after the boot window the full probe says whether Samsung's idle Home is up (closeHomeOnce).
        if (!c.cheap) return c;
        if (!c.running || (!self.homeClosed && self.uptime() >= BOOT_WINDOW_S && self.serviceStart < BOOT_WINDOW_S)) return self.probe();
        return c;
    }).then(function (p) {
        // A warning left by an earlier failed supervision round is stale once the dock is seen running.
        // The launcher lives in its own unit, so it survives the service: after the package was installed again over a
        // running Vetro (an upgrade through the installer, not through self-update) the process found here is the OLD
        // build, which knows neither the new start options nor the new command words. It is started again, once.
        var stale = p.running && self.otherBuild(state, p);
        // The other way the old lists reach a new launcher: the TV restarted after such an install, and the quick start after the boot
        // used the lists the older Vetro had written. They have no All apps list (this build always writes one next to the apps list)
        // and no row keys, so All apps is nearly empty and no tile can be moved. Once the boot has settled the launcher is started
        // again, once per run, from lists this build reads from Samsung's Home.
        var oldLists = p.running && !custom && !self.relisted && self.uptime() >= BOOT_WINDOW_S && self.hasSavedApps() && !fs.existsSync(self.allAppsFile);
        if (stale || oldLists) {
            self.relisted = true; self.refreshPending = false;
            return self.launch(false).then(function () { self.failures = 0; self.superviseFailed = false; self.lastError = null; self.up(); return 'started'; });
        }
        if (p.running) { self.failures = 0; if (self.superviseFailed) { self.superviseFailed = false; self.lastError = null; } self.up(); self.refreshCatalogLater(); return self.closeHomeOnce(p.samsungHome).then(function () { return 'running'; }); }
        return self.launch(true).then(function () { self.failures = 0; self.superviseFailed = false; self.lastError = null; self.up(); self.refreshCatalogLater(); return 'started'; });
    }).then(function (result) {
        return custom ? self.checkCustomApp(state.customApp).then(function (gone) { return gone || result; }) : result;
    }).catch(function (e) {
        self.failures++; self.superviseFailed = true;
        var first = self.uptime() < BOOT_WINDOW_S ? RETRY_BOOT_MS : RETRY_FIRST_MS;
        self.nextTry = self.now() + Math.min(RETRY_MAX_MS, first * Math.pow(2, Math.min(self.failures, 8) - 1));
        if (custom && self.failures >= CUSTOM_MAX_FAILURES) return self.giveUpCustom('the launcher process did not start after ' + self.failures + ' tries. ' + e.message);
        self.lastError = (self.failures >= 4 ? 'The dock has not started after ' + self.failures + ' tries; Vetro keeps trying. ' : '') + e.message;
        return 'failed';
    }).finally(function () { self.busy = false; });
};

// A build of the custom mode before 0.5.0 final disabled Samsung's Home and flagged it in the state. That package must
// never stay disabled across a boot, so the first supervision round with the agent connected puts it back and clears
// the flag. A failure is kept for the next round and does not stop the supervision.
Dock.prototype.healHome = function (state) {
    var self = this;
    if (!state.customHomeDisabled || !this.home || typeof this.home.restore !== 'function') return Promise.resolve();
    return this.home.restore().then(function () { self.patchState({customHomeDisabled: false}); }).catch(function (e) {
        self.lastError = 'Samsung Home was disabled by an earlier version and could not be put back yet: ' + e.message;
    });
};

// Custom mode only: about once a minute the chosen app is looked up. Two lookups in a row that say it is gone
// (uninstalled, disabled) end the mode, since the Home key would open nothing. A lookup that fails is not an answer.
// The minute is counted from the first supervision round of this run, by the clock: the rounds slow down while the
// launcher keeps running (plugin-launcher.js), and a count of rounds would stretch the minute with them.
Dock.prototype.checkCustomApp = function (appId) {
    var self = this, now = this.now();
    if (!this.appCheck) return Promise.resolve(null);
    if (this.appCheckedAt === null) { this.appCheckedAt = now; return Promise.resolve(null); }
    if (now - this.appCheckedAt < APP_CHECK_MS) return Promise.resolve(null);
    this.appCheckedAt = now;
    return this.appCheck(appId).then(function (c) {
        if (c && c.ok === true) { self.goneRounds = 0; return null; }
        if (++self.goneRounds < APP_GONE_ROUNDS) return null;
        return self.giveUpCustom((c && c.reason) || 'the app is no longer available.');
    }, function () { return null; });
};

module.exports = {rowAfter: rowAfter, cleanRow: cleanRow, Dock: Dock, runningCheck: runningCheck, parseCheck: parseCheck, STATE_FILE: STATE_FILE, APPS_FILE: APPS_FILE, CUSTOM_APPS_FILE: CUSTOM_APPS_FILE,
    customCandidate: customCandidate, customAppCheck: customAppCheck, hexLabel: hexLabel, LOG_FILE: LOG_FILE, shardCardText: shardCardText, cleanCards: cleanCards};
