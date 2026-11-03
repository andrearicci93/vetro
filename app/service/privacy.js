'use strict';
var execError = require('./exec-error.js');
// Regular expressions compiled once at module load, not on every call.
var SECTIONS_RE = /^__(\w+)__$/;
var VCONF_VALUE_RE = /value = (.*) \(([^)]*)\)/;
var INTEGER_RE = /^-?\d+$/;
var DIGITS_RE = /^\d+$/;
var TRUE_RE = /^(true|1)$/i;
var FALSE_RE = /^(false|0)$/i;
var PAIR_BIT_RE = /^[^:]+:[01]$/;

// Privacy dashboard data: aggregates the TV's privacy/consent state that is
// readable without a web runtime. Values come from vconf (Buxton2) and the
// HomeDataControl consent DB. The web-only ad identifiers (TIFA / Limit Ad
// Tracking via webapis.adinfo) are not reachable from the shell and are
// reported as unavailable, never guessed.

var HDC = '/opt/usr/apps/org.tizen.homedatacontrol-service/data/data.db';

function wrap(script) { return 'echo ' + Buffer.from(script).toString('base64') + ' | base64 -d | sh'; }
function check(r) { if (r.exit_code || r.timed_out) throw execError.failed(r, r.stderr || r.stdout || 'Privacy state unavailable'); return r.stdout || ''; }
function sections(text) {
    var out = {}, key = null;
    String(text || '').split('\n').forEach(function (l) {
        var m = SECTIONS_RE.exec(l);
        if (m) { key = m[1]; out[key] = []; } else if (key) out[key].push(l);
    });
    return out;
}
function vconfVal(lines) {
    var m = VCONF_VALUE_RE.exec((lines || []).join(' ').trim());
    return m ? m[1] : null;
}
function num(v) { return v == null ? null : (INTEGER_RE.test(v) ? Number(v) : v); }

function Privacy(execute) { this.execute = execute; this.cached = null; }

Privacy.prototype.read = function () {
    var self = this;
    if (this.cached && Date.now() - this.cached.ts < 3000) return Promise.resolve(this.cached.data);
    var script = [
        'echo __HBBTV__; vconftool get db/menu/system/data-service 2>&1',
        'echo __DNT__; vconftool get db/menu/system/data-service_do-not-track 2>&1',
        'echo __ACR__; vconftool get db/Canalysis-service/recognition_status 2>&1',
        'echo __ACRRESET__; vconftool get db/acr/reset 2>&1',
        'echo __PSID__; vconftool get db/adagent/psid 2>&1',
        'echo __TCF__; vconftool get db/TCF/TVPlus/TCFEnabled 2>&1',
        'echo __HBBTVAPP__; ps -eo comm 2>/dev/null | grep -c hbbtv_app',
        'echo __AGREE__; sqlite3 -readonly ' + HDC + ' "SELECT id||\':\'||isAgreed FROM table_home_data_disclaimer_info" 2>/dev/null; rc=$?; echo __AGREE_STATUS__; echo $rc'
    ].join('; ');
    return this.execute(wrap(script), 12000).then(function (r) {
        var s = sections(check(r));
        var hbbtv = vconfVal(s.HBBTV);
        var data = {
            hbbtv: { dataService: num(hbbtv), off: hbbtv == null ? null : (hbbtv === '0' || hbbtv === '19'), appRunning: DIGITS_RE.test((s.HBBTVAPP || []).join('').trim()) ? Number(s.HBBTVAPP.join('').trim()) > 0 : null },
            doNotTrack: num(vconfVal(s.DNT)),
            acr: { recognitionStatus: num(vconfVal(s.ACR)), reset: num(vconfVal(s.ACRRESET)) },
            adId: { psidPresent: vconfVal(s.PSID) == null ? null : !!String(vconfVal(s.PSID)).trim() },
            tvPlusConsent: TRUE_RE.test(vconfVal(s.TCF) || '') ? true : FALSE_RE.test(vconfVal(s.TCF) || '') ? false : null,
            agreementsAvailable: (s.AGREE_STATUS || []).join('').trim() === '0' ? true : s.AGREE_STATUS ? false : (s.AGREE || []).some(function(l){return PAIR_BIT_RE.test(l.trim());}) ? true : null,
            agreements: (s.AGREE || []).map(function (l) { return l.trim(); }).filter(function(l){return PAIR_BIT_RE.test(l);}).map(function (l) {
                var i = l.indexOf(':');
                return { id: l.slice(0, i), agreed: l.slice(i + 1) === '1' };
            }),
            scope: 'State from vconf (Buxton2) and HomeDataControl. TIFA and Limit Ad Tracking are not accessible from the service.'
        };
        self.cached = { ts: Date.now(), data: data };
        return data;
    });
};

module.exports = { Privacy: Privacy, HDC: HDC };
