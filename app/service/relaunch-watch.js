'use strict';
// Read-only observer for "Vetro stops an app and the TV starts it again" (#72 HbbTV, #41 csfs).
// It never stops, starts or changes anything: it only lists what runs, so the diagnostic report can show
// whether and when an app came back, how long the matching processes have lived and which system log
// lines mention them.
var execError = require('./exec-error.js');
var WORDS = ['hbbtv', 'csfs'];           // report filter
var READS = 12, GAP_MS = 5000;           // 12 reads, 5 s apart: 60 s after a stop
var KEEP = 6, LOG_LINES = 40, LINE_MAX = 160;
function wrap(s) { return 'echo ' + Buffer.from(s).toString('base64') + ' | base64 -d | sh'; }
function safeId(id) { return typeof id === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(id); }
function matches(text) { text = String(text).toLowerCase(); return WORDS.some(function (w) { return text.indexOf(w) >= 0; }); }
// First word of each line of `app_launcher -S`, the same way hbbtv.js reads it.
function appIds(out) {
    var ids = [];
    String(out || '').split('\n').forEach(function (line) {
        var m = /^\s*([A-Za-z0-9_.-]+)(?:\s|$)/.exec(line);
        if (m && ids.indexOf(m[1]) < 0) ids.push(m[1]);
    });
    return ids;
}
// One log line: time of day only, no addresses, URLs, e-mails or paths, printable ASCII, short.
function cleanLine(line) {
    var s = String(line).replace(/[^\x20-\x7e]/g, ' ');
    s = s.replace(/^\s*\d{1,2}-\d{1,2}\s+/, '');
    s = s.replace(/https?:\/\/\S+/gi, '[url]')
        .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '[x]')
        .replace(/(?:[a-f0-9]{2}[:-]){5}[a-f0-9]{2}/gi, '[x]')
        .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[x]')
        .replace(/\/(?:home|opt\/usr|Users)\/\S*/g, '[path]')
        .replace(/\s+/g, ' ').trim();
    return s.length > LINE_MAX ? s.slice(0, LINE_MAX) : s;
}
function Watch(execute, options) {
    options = options || {};
    this.execute = execute;
    this.sleep = options.sleep || function (ms) { return new Promise(function (r) { var t = setTimeout(r, ms); if (t.unref) t.unref(); }); };
    this.gapMs = options.gapMs === undefined ? GAP_MS : options.gapMs;
    this.reads = options.reads || READS;
    this.running = false;
    this.observations = [];
    this.relaunched = {};
}
Watch.prototype.remember = function (o) {
    this.observations.push(o);
    if (this.observations.length > KEEP) this.observations.shift();
    if (o.relaunched) this.relaunched[o.label.split('-')[0]] = true;
};
// A stop that Vetro itself saw fail (the switch rolls back): no watching, only the reason.
Watch.prototype.failed = function (label, reason) {
    try { this.remember({label: label, status: 'stop-failed', reason: String(reason || ''), reads: 0, relaunched: false, targets: []}); } catch (e) {}
};
// After a stop: 12 reads of the running list. Never in parallel, never while `isBusy()` says a change is under way.
// Resolves with the observation; it never rejects.
Watch.prototype.start = function (label, ids, isBusy) {
    var self = this;
    try {
        if (!/^[a-z0-9-]{1,40}$/.test(label) || !Array.isArray(ids) || !ids.length || !ids.every(safeId)) return Promise.resolve({status: 'skipped'});
        if (this.running) return Promise.resolve({status: 'skipped'});
        if (isBusy && isBusy()) { this.remember({label: label, status: 'skipped-busy', reads: 0, relaunched: false, targets: []}); return Promise.resolve({status: 'skipped'}); }
    } catch (e) { return Promise.resolve({status: 'skipped'}); }
    this.running = true;
    var obs = {label: label, status: 'running', reads: 0, failedReads: 0, relaunched: false, intervalSeconds: this.gapMs / 1000,
        targets: ids.map(function (id) { return {id: id, relaunchedAfterSeconds: null}; })};
    this.remember(obs);
    var n = 0;
    function read() {
        return self.execute(wrap('app_launcher -S 2>/dev/null'), 6000).then(function (r) {
            if (!r || r.exit_code || r.timed_out) throw Error('read');
            var seen = appIds(r.stdout);
            obs.reads++;
            obs.targets.forEach(function (t) {
                if (t.relaunchedAfterSeconds === null && seen.indexOf(t.id) >= 0) { t.relaunchedAfterSeconds = Math.round(n * self.gapMs / 1000); obs.relaunched = true; self.relaunched[label.split('-')[0]] = true; }
            });
        }).catch(function () { obs.failedReads++; });
    }
    function step() {
        return read().then(function () {
            if (++n >= self.reads) return;
            return self.sleep(self.gapMs).then(step);
        });
    }
    return step().catch(function () {}).then(function () {
        obs.status = obs.reads ? 'done' : 'unavailable';
        self.running = false;
        return obs;
    });
};
Watch.prototype.seen = function (prefix) { return !!this.relaunched[prefix]; };
// Read at report time: matching apps, matching processes with their age, and filtered log lines. Read-only.
// Process age comes from /proc (start time against uptime), so it needs neither `ps -o` nor any option BusyBox may lack.
var LIST_SCRIPT = [
    'echo __APPS__',
    'app_launcher -S 2>/dev/null | grep -i -E "hbbtv|csfs" | head -20',
    'echo __PROCS__',
    'up=$(cut -d. -f1 /proc/uptime 2>/dev/null)',
    'for d in /proc/[0-9]*; do c=$(cat $d/comm 2>/dev/null); case "$c" in *[Hh][Bb][Bb][Tt][Vv]*|*[Cc][Ss][Ff][Ss]*)',
    '  s=$(awk \'{print $22}\' $d/stat 2>/dev/null); a=""; if [ -n "$s" ] && [ -n "$up" ]; then a=$((up - s / 100)); fi; echo "P $c $a";;',
    'esac; done 2>/dev/null | head -20',
    'true'
].join('\n');
var LOG_SCRIPT = 'if command -v timeout >/dev/null 2>&1; then timeout 5 dlogutil -d -v time 2>/dev/null | grep -i -E "hbbtv|csfs" | tail -' + LOG_LINES + '; else echo __NO_TIMEOUT__; fi\ntrue';
function nameToken(v) { return typeof v === 'string' && v.length <= 80 && /^[A-Za-z0-9_.-]+$/.test(v) ? v : null; }
Watch.prototype.read = function () {
    var self = this;
    return this.execute(wrap(LIST_SCRIPT), 8000).then(function (r) {
        if (!r || r.exit_code || r.timed_out) throw execError.failed(r, 'Process list unavailable');
        var out = String(r.stdout || ''), apps = [], processes = [], part = '';
        out.split('\n').forEach(function (line) {
            if (line === '__APPS__' || line === '__PROCS__') { part = line; return; }
            var m;
            if (part === '__APPS__') { m = /^\s*([A-Za-z0-9_.-]+)(?:\s|$)/.exec(line); if (m && matches(m[1]) && nameToken(m[1]) && apps.indexOf(m[1]) < 0) apps.push(m[1]); }
            else if (part === '__PROCS__' && (m = /^P (\S+)(?: (-?\d+))?\s*$/.exec(line)) && nameToken(m[1]) && matches(m[1]))
                processes.push({name: m[1], ageSeconds: m[2] !== undefined && Number(m[2]) >= 0 ? Number(m[2]) : null});
        });
        return {apps: apps, processes: processes.slice(0, 20), observations: self.observations.slice()};
    }).then(function (data) {
        return self.execute(wrap(LOG_SCRIPT), 8000).then(function (r) {
            var out = String((r && r.stdout) || '');
            if (!r || r.timed_out || r.exit_code || /__NO_TIMEOUT__/.test(out)) { data.logStatus = 'unavailable'; data.log = []; return data; }
            data.logStatus = 'ok';
            data.log = out.split('\n').filter(matches).slice(-LOG_LINES).map(cleanLine).filter(Boolean);
            return data;
        }, function () { data.logStatus = 'unavailable'; data.log = []; return data; });
    });
};
module.exports = {Watch: Watch, appIds: appIds, cleanLine: cleanLine, READS: READS, GAP_MS: GAP_MS, WORDS: WORDS};
