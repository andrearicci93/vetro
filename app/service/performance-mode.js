'use strict';
// Extra performance mode (Quick settings, Experimental). One switch that:
//   - turns on Reduce motion (launcher, Task manager, Volume bar, osd 123 and tuner) and Close idle Samsung Home;
//   - turns on three wins that take nothing away (their own copy says so): Stop viewing-data collection, Disable Multi View
//     autostart, Stop Ambient (Ambient still opens by hand);
//   - closes apps left in the background: after IDLE_MS without being on screen, and the longest-idle one at once (after
//     LOW_IDLE_MS) when the TV's available memory falls under LOW_MEMORY_KIB. Never the app on screen, an app playing sound,
//     Vetro, the TV's own apps, Samsung Home (Close idle Samsung Home has its own rule) or an app the owner keeps open.
// Turning it off puts back only what it turned on, and only what is still as it left it (the ledger in FILE). Measured on a
// Q80A (2026-11-22, one run each): Netflix ~100 MiB and NOW ~95 MiB in background; Samsung's own memory killer already closes
// background apps under pressure, so the cleanup frees memory earlier (less swap), at the cost of a cold start on reopening.
// The app selection follows #281's Free up RAM by swiezaczek (UI apps only, oom_score_adj >= 300). Its background cgroup check is left
// out: a 2021 Q80A has no cpu:/background group (apps sit in resourced_cgroup:/Apps); there resourced gives a background app 600 and
// the app on screen 200 (Netflix behind YouTube, 2026-11-22).
var fs = require('fs');

var FILE = '/opt/usr/home/owner/share/vetro-performance.json';
var WINS = ['telemetry', 'multiscreen', 'ambient'];
var IDLE_MS = 15 * 60000;          // a background app not on screen for this long is closed
var LOW_MEMORY_KIB = 500 * 1024;   // under this much available memory the longest-idle background app goes at once
var LOW_IDLE_MS = 2 * 60000;       // ...if it has been in the background for at least this long
var TICK_MS = 60000;
var APP_ID_RE = /^[A-Za-z0-9_.-]{1,180}$/;
var PKGDB = '/opt/dbspace/.pkgmgr_parser.db';
var MCDB = '/opt/usr/home/owner/.applications/dbspace/.media_controller.db';
// The TV's own UI apps (the Task manager's list, dock/src/Core/Tasks.cs, and #281's), Samsung Home (its own rule) and Vetro.
var PROTECTED = ['org.tizen.tv-viewer', 'org.tizen.menu', 'org.tizen.function-osd', 'com.samsung.tv.sboard-app', 'org.tizen.welcome-mode',
    'org.tizen.hbbtv', 'org.tizen.ScreenMirroring-app-tv', 'com.samsung.hitcomp', 'org.tizen.volume', 'org.tizen.volume-app',
    'org.tizen.screen-saver', 'com.samsung.tv.notification', 'com.samsung.tv.coba.adagent', 'org.tizen.ambientapp', 'com.samsung.tv.quicklaunch',
    'com.samsung.tv.bixbycapsuleviewer', 'com.samsung.tv.airplay-app-2', 'org.tizen.voice-app', 'org.tizen.autofilld', 'org.tizen.litewebappservice',
    'com.samsung.tv.preview-updater', 'capi-bnr-tv', 'com.samsung.tv.csfs', 'com.samsung.tv.home.sidebar', 'com.samsung.tv.home.media'];
function isProtected(id) { return PROTECTED.indexOf(id) >= 0 || /^vetrotvapp/.test(id) || /^org\.tizen\.chromium-efl/.test(id); }

function wrap(s) { return 'echo ' + Buffer.from(s).toString('base64') + ' | base64 -d | sh'; }

// One read of what runs: the app on screen, available memory, the running UI apps in the background (pid, oom_score_adj), the
// PulseAudio streams that play (pid), and the media-controller servers that play (app id; Spotify registers there).
var READ = [
    'f=$(vconftool get memory/appfw/current_fullscreen_appid 2>/dev/null | sed -n "s/.*value = \\([^ (]*\\).*/\\1/p"); echo "FG|$f"',
    'echo "MEM|$(awk \'/^MemAvailable:/{print $2}\' /proc/meminfo 2>/dev/null)"',
    'ui=$(sqlite3 -readonly -cmd ".timeout 3000" ' + PKGDB + ' "SELECT app_id FROM package_app_info WHERE app_component=\'uiapp\' AND ifnull(app_nodisplay,\'false\')!=\'true\';" 2>/dev/null)',
    'app_launcher -S 2>/dev/null | sed -n "s/^[[:space:]]*\\([^[:space:]]*\\)[[:space:]]*(\\([0-9]*\\)).*/\\1 \\2/p" | while read -r id pid; do',
    '  [ -n "$pid" ] && [ -d "/proc/$pid" ] || continue',
    '  printf "%s\\n" "$ui" | grep -Fxq "$id" || continue',
    '  echo "BG|$id|$pid|$(cat /proc/$pid/oom_score_adj 2>/dev/null)"',
    'done',
    'PULSE_SERVER=unix:/run/pulse/native pactl list sink-inputs 2>/dev/null | awk \'/^Sink Input/{c=""} /Corked:/{c=$2} /application.process.id/{gsub(/"/,"",$3); if(c=="no") print "AUD|" $3}\'',
    '[ -r ' + MCDB + ' ] && sqlite3 -readonly ' + MCDB + ' "SELECT name FROM server_info WHERE playback_state NOT IN (0,2,3);" 2>/dev/null | sed "s/^/MC|/"',
    'true'
].join('\n');

function parse(out) {
    var s = {fg: null, memKiB: null, background: [], audioPids: [], playing: []};
    String(out || '').split('\n').forEach(function (line) {
        var f = line.split('|');
        if (f[0] === 'FG') s.fg = f[1] || null;
        else if (f[0] === 'MEM' && /^\d+$/.test(f[1])) s.memKiB = Number(f[1]);
        else if (f[0] === 'BG' && APP_ID_RE.test(f[1]) && /^\d+$/.test(f[2])) s.background.push({id: f[1], pid: Number(f[2]), adj: /^-?\d+$/.test(f[3]) ? Number(f[3]) : null});
        else if (f[0] === 'AUD' && /^\d+$/.test(f[1])) s.audioPids.push(Number(f[1]));
        else if (f[0] === 'MC' && APP_ID_RE.test(f[1])) s.playing.push(f[1]);
    });
    return s;
}

// The apps to close now, longest idle first. lastFront: app id -> ms the app was last seen on screen (or first seen at all).
function choose(s, lastFront, now, keepOpen) {
    var keep = keepOpen || [];
    var candidates = s.background.filter(function (a) {
        if (a.id === s.fg || isProtected(a.id) || keep.indexOf(a.id) >= 0) return false;
        if (a.adj === null || a.adj < 300) return false;                       // resourced still counts it as in use (or says nothing)
        if (s.audioPids.indexOf(a.pid) >= 0 || s.playing.indexOf(a.id) >= 0) return false;   // playing sound
        return true;
    }).map(function (a) { return {id: a.id, idle: now - (lastFront[a.id] === undefined ? now : lastFront[a.id])}; });
    candidates.sort(function (x, y) { return y.idle - x.idle; });
    var out = candidates.filter(function (c) { return c.idle >= IDLE_MS; }).map(function (c) { return c.id; });
    if (s.memKiB !== null && s.memKiB < LOW_MEMORY_KIB) {
        var first = candidates.filter(function (c) { return c.idle >= LOW_IDLE_MS && out.indexOf(c.id) < 0; })[0];
        if (first) out.push(first.id);
    }
    return out;
}

function closeScript(ids) {
    return ids.map(function (id) {
        return 'app_launcher -t ' + id + ' >/dev/null 2>&1; sleep 0.3; if app_launcher -r ' + id + ' 2>/dev/null | grep -q "result: running"; then ' +
            'app_launcher -k ' + id + ' >/dev/null 2>&1; fi; echo "CLOSED|' + id + '"';
    }).join('\n') + '\ntrue';
}

function PerformanceMode(execute, options) {
    options = options || {};
    this.execute = execute;
    this.dock = options.dock || null;
    this.wins = options.wins || null;
    this.fs = options.fs || fs;
    this.file = options.file || FILE;
    this.now = options.now || function () { return Date.now(); };
    this.log = options.log || function () {};
    this.busy = false;
    this.lastFront = {};
    this.closedCount = 0;
    this.recent = [];   // the last closes: {id, at}
}

PerformanceMode.prototype.load = function () {
    try {
        var o = JSON.parse(this.fs.readFileSync(this.file, 'utf8'));
        return {on: o.on === true, owned: {motion: !!(o.owned && o.owned.motion), idleHome: !!(o.owned && o.owned.idleHome),
            wins: (o.owned && Array.isArray(o.owned.wins) ? o.owned.wins : []).filter(function (id) { return WINS.indexOf(id) >= 0; })},
            keepOpen: (Array.isArray(o.keepOpen) ? o.keepOpen : []).filter(function (id) { return APP_ID_RE.test(id); }).slice(0, 100)};
    } catch (e) { return {on: false, owned: {motion: false, idleHome: false, wins: []}, keepOpen: []}; }
};

PerformanceMode.prototype.save = function (state) {
    var tmp = this.file + '.tmp';
    this.fs.writeFileSync(tmp, JSON.stringify(state) + '\n', {mode: 0o600});
    this.fs.renameSync(tmp, this.file);
};

// The apps to offer for "never close": the launcher's All apps list (vetro-dock-allapps.tsv: slug, name, app id), the apps the
// owner sees on Samsung's Apps screen; inputs, keys and the TV's own apps are left out.
PerformanceMode.prototype.choices = function () {
    var file = this.dock && this.dock.allAppsFile, seen = {}, out = [];
    if (!file) return out;
    try {
        this.fs.readFileSync(file, 'utf8').split('\n').forEach(function (line) {
            if (!line || line.charAt(0) === '#') return;
            var f = line.split('\t'), id = f[2], name = f[1];
            if (!id || !name || !APP_ID_RE.test(id) || isProtected(id) || seen[id]) return;
            seen[id] = 1; out.push({appId: id, name: name});
        });
    } catch (e) { /* no list yet (launcher off or never built): the dashboard says so */ }
    return out;
};

PerformanceMode.prototype.dockState = function () {
    try { return this.dock ? this.dock.readState() : null; } catch (e) { return null; }
};

// What each part reads now: applied (true/false/null unknown) and whether the mode turned it on.
PerformanceMode.prototype.read = function () {
    var self = this, st = this.load(), d = this.dockState();
    var winsRead = this.wins ? this.wins.read().then(function (w) { return w.wins; }, function () { return null; }) : Promise.resolve(null);
    return winsRead.then(function (w) {
        var parts = {
            motion: {applied: d ? d.noMotion === true : null, owned: st.owned.motion},
            idleHome: {applied: d ? d.closeIdleHome !== false : null, owned: st.owned.idleHome}
        };
        WINS.forEach(function (id) {
            var s = w && w[id] ? w[id].status : null;
            parts[id] = {applied: s === 'on' || s === 'partial' ? true : s === 'off' ? false : null, owned: st.owned.wins.indexOf(id) >= 0};
        });
        // Partly on: a part the mode turned on was turned off by hand since.
        var changed = Object.keys(parts).filter(function (k) { return parts[k].owned && parts[k].applied === false; });
        return {on: st.on, status: !st.on ? 'off' : changed.length ? 'partial' : 'on', changed: changed, parts: parts,
            keepOpen: st.keepOpen, choices: self.choices(), closed: self.closedCount, recent: self.recent.slice(), busy: self.busy,
            launcher: !!(d && d.enabled), idleMinutes: IDLE_MS / 60000, lowMemoryMiB: LOW_MEMORY_KIB / 1024};
    });
};

PerformanceMode.prototype.apply = function (on) {
    var self = this;
    if (typeof on !== 'boolean') return Promise.reject(Error('Invalid state'));
    if (this.busy) return Promise.reject(Error('Extra performance mode is already being changed'));
    this.busy = true;
    var st = this.load(), errors = [];
    function step(promise, what) { return promise.then(null, function (e) { errors.push(what + ': ' + (e && e.message || e)); }); }
    var task;
    if (on) {
        task = Promise.resolve().then(function () {
            var d = self.dockState();
            if (d && d.noMotion !== true && self.dock) return step(self.dock.setNoMotion(true).then(function () { st.owned.motion = true; }), 'Reduce motion');
        }).then(function () {
            var d = self.dockState();
            if (d && d.closeIdleHome === false && self.dock) return step(self.dock.setCloseIdleHome(true).then(function () { st.owned.idleHome = true; }), 'Close idle Samsung Home');
        }).then(function () {
            if (!self.wins) return;
            return self.wins.read().then(function (w) {
                return WINS.reduce(function (p, id) {
                    return p.then(function () {
                        var s = w.wins[id] && w.wins[id].status;
                        if (s !== 'off') return;   // already on, partly on, or unreadable (no root): not the mode's to change
                        return step(self.wins.apply(id, true).then(function () { if (st.owned.wins.indexOf(id) < 0) st.owned.wins.push(id); }), id);
                    });
                }, Promise.resolve());
            }, function (e) { errors.push('wins: ' + e.message); });
        }).then(function () { st.on = true; self.lastFront = {}; });
    } else {
        task = Promise.resolve().then(function () {
            var d = self.dockState();
            if (st.owned.motion && d && d.noMotion === true && self.dock) return step(self.dock.setNoMotion(false), 'Reduce motion');
        }).then(function () {
            var d = self.dockState();
            if (st.owned.idleHome && d && d.closeIdleHome !== false && self.dock) return step(self.dock.setCloseIdleHome(false), 'Close idle Samsung Home');
        }).then(function () {
            if (!self.wins || !st.owned.wins.length) return;
            return self.wins.read().then(function (w) {
                return st.owned.wins.reduce(function (p, id) {
                    return p.then(function () {
                        var s = w.wins[id] && w.wins[id].status;
                        if (s !== 'on' && s !== 'partial') return;   // turned off by hand since: left as it is
                        return step(self.wins.apply(id, false), id);
                    });
                }, Promise.resolve());
            }, function (e) { errors.push('wins: ' + e.message); });
        }).then(function () { st.on = false; st.owned = {motion: false, idleHome: false, wins: []}; });
    }
    return task.then(function () {
        self.save(st);
        self.busy = false;
        return self.read().then(function (r) { r.errors = errors; return r; });
    }, function (e) { self.busy = false; throw e; });
};

PerformanceMode.prototype.setKeepOpen = function (ids) {
    if (!Array.isArray(ids) || ids.length > 100 || !ids.every(function (id) { return typeof id === 'string' && APP_ID_RE.test(id); }))
        return Promise.reject(Error('Invalid app list'));
    var st = this.load();
    st.keepOpen = ids.filter(function (id, i) { return ids.indexOf(id) === i; });
    this.save(st);
    return this.read();
};

// Restore the TV: everything it turns back already covers what the mode changed; only the ledger goes.
PerformanceMode.prototype.forget = function () {
    var st = this.load();
    this.save({on: false, owned: {motion: false, idleHome: false, wins: []}, keepOpen: st.keepOpen});
};

// Every TICK_MS while the mode is on: note the app on screen, close what has been idle too long.
PerformanceMode.prototype.tick = function () {
    var self = this;
    if (this.busy || this.ticking) return Promise.resolve([]);
    var st = this.load();
    if (!st.on) { this.lastFront = {}; return Promise.resolve([]); }
    this.ticking = true;
    return this.execute(wrap(READ), 20000).then(function (r) {
        if (!r || r.exit_code || r.timed_out) return [];
        var s = parse(r.stdout), now = self.now();
        if (s.fg) self.lastFront[s.fg] = now;
        s.background.forEach(function (a) { if (self.lastFront[a.id] === undefined) self.lastFront[a.id] = now; });
        Object.keys(self.lastFront).forEach(function (id) {   // forget apps that are gone, so a reopened one starts a new count
            if (id !== s.fg && !s.background.some(function (a) { return a.id === id; })) delete self.lastFront[id];
        });
        var ids = choose(s, self.lastFront, now, st.keepOpen);
        if (!ids.length) return [];
        return self.execute(wrap(closeScript(ids)), 30000).then(function (c) {
            var closed = String(c && c.stdout || '').split('\n').filter(function (l) { return l.indexOf('CLOSED|') === 0; }).map(function (l) { return l.slice(7); });
            closed.forEach(function (id) { delete self.lastFront[id]; self.closedCount++; self.recent.unshift({id: id, at: now}); });
            self.recent = self.recent.slice(0, 5);
            if (closed.length) self.log('performance: closed ' + closed.join(', ') + (s.memKiB !== null ? ' (available ' + Math.round(s.memKiB / 1024) + ' MiB)' : ''));
            return closed;
        });
    }).then(function (x) { self.ticking = false; return x; }, function () { self.ticking = false; return []; });
};

module.exports = {PerformanceMode: PerformanceMode, parse: parse, choose: choose, closeScript: closeScript, READ: READ, FILE: FILE,
    WINS: WINS, IDLE_MS: IDLE_MS, LOW_MEMORY_KIB: LOW_MEMORY_KIB, LOW_IDLE_MS: LOW_IDLE_MS, TICK_MS: TICK_MS, isProtected: isProtected};
