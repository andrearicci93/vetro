'use strict';
// Read-only foreground application state from the TV application manager.
// The command is fixed and only lists running apps; nothing is started,
// resumed or terminated. AUL status codes: 2 focus, 3 visible, 4 background,
// 8 service. Only 3, 4 and 8 have been observed on the test TV; 2 is assumed.
var COMMAND = 'aul_test getallappstatus 2>&1';
var FOREGROUND = {2: 1, 3: 2};
var APP_ID = /^[A-Za-z0-9_.-]+$/;
var APP_STATUS_RE = /pid:\s*(\d+)\s+appid:\s*(\S+)[^=]*?status:\s*(\d+)/g;   // stateful: reset lastIndex before each use

function applications(text) {
    var re = APP_STATUS_RE, m, rows = [];
    re.lastIndex = 0;   // the regex is shared and global: always start from the beginning
    while ((m = re.exec(String(text || '')))) {
        if (!APP_ID.test(m[2]) || +m[1] <= 0) continue;
        rows.push({appId: m[2], pid: +m[1], status: +m[3]});
    }
    if (!rows.length) throw new Error('application status unreadable');
    return rows;
}
function parse(text) {
    var rows = applications(text), best = null;
    rows.forEach(function (row) {
        var rank = FOREGROUND[row.status];
        if (rank && (!best || rank < best.rank)) best = Object.assign({rank: rank}, row);
    });
    return {foreground: best ? {appId: best.appId, pid: best.pid, status: best.status} : null, running: rows.length};
}

function Presence(execute) { this.execute = execute; this.pending = null; }
Presence.prototype.read = function () {
    if (this.pending) return this.pending;
    var self = this;
    this.pending = this.execute(COMMAND, 8000).then(function (r) {
        if (r.exit_code || r.timed_out) throw new Error('application status unavailable');
        var d = parse(r.stdout);
        d.ts = Date.now();
        return d;
    }).finally(function () { self.pending = null; });
    return this.pending;
};

module.exports = {Presence: Presence, parse: parse, applications: applications, COMMAND: COMMAND};
