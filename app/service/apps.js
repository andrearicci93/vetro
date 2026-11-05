'use strict';

// App inventory: normalizes the output of tizen.application.getAppsInfo and
// tizen.package.getPackagesInfo (collected by the widget UI, see index.html)
// into rows classified for the debloat view. Pure logic, no platform access.

var debloat = require('./debloat.js');
var catalog = require('./app-catalog.js');
var factoryApps = require('./factory-apps.js');

// Candidate domains, grouped by evidence in service/blocklist.js. Served by
// GET /blocklist for an external DNS blocker (Pi-hole, router) and offered as
// suggestions by the local filter, which applies only what the owner saves.
var BLOCKLIST_DOMAINS = require('./blocklist.js').all();
// Regular expressions compiled once at module load, not on every call.
var APP_ID_RE = /^[A-Za-z0-9_.-]+$/;
var DEMO_RE = /hotel|retail|demo-player|agingapp/;
var MEDIA_APP_RE = /netflix|youtube|cobalt|tizentube|stremio|primevideo|disney|spotify|media-player|photo-player/;
var VOICE_RE = /alexa|bixby|voice|tts|assistant|speech/;
var CONNECTIVITY_RE = /allshare|bluetooth|airplay|screenmirror|multiscreen|connectivity|network/;

function str(v, max) { return typeof v === 'string' ? v.slice(0, max || 200) : null; }
function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

function kindOf(appId, pkg) {
    if (debloat.isAds(appId, pkg)) return 'ads';
    if (debloat.isPrivacy(appId, pkg)) return 'privacy';
    return 'other';
}

// apps: [{id, name, packageId, show}], packages: [{id, version, totalSize, author}]
function normalize(apps, packages) {
    var byPkg = {};
    (Array.isArray(packages) ? packages : []).forEach(function (p) {
        if (p && typeof p.id === 'string') byPkg[p.id] = p;
    });
    var rows = [];
    (Array.isArray(apps) ? apps : []).slice(0, 2000).forEach(function (a) {
        if (!a || typeof a.id !== 'string' || !APP_ID_RE.test(a.id)) return;
        var pkgId = str(a.packageId, 120) || a.id.split('.')[0];
        var pkg = byPkg[pkgId] || {};
        rows.push({
            appId: a.id,
            packageId: pkgId,
            name: str(a.name),
            show: a.show !== false,
            version: str(pkg.version, 40),
            size: num(pkg.totalSize),
            kind: kindOf(a.id, pkgId),
            protected: debloat.isProtected(a.id) || debloat.isProtected(pkgId)
        });
        Object.assign(rows[rows.length - 1], describe(rows[rows.length - 1]));
    });
    rows.sort(function (x, y) { return x.appId < y.appId ? -1 : x.appId > y.appId ? 1 : 0; });
    return rows;
}

function classification(r) {
    function result(category,source,reason){return {category:category,categorySource:source,categoryReason:reason};}
    if(r.protected)return result('protected','policy','Protected by Vetro');
    if(r.kind==='ads'||r.kind==='privacy')return result(r.kind,'policy','Known advertising and privacy package IDs');
    var pkg=r.packageId||'',known={
        'com.samsung.tv.alexa-client':'voice','com.samsung.tv.wakeup-engine-alexa':'voice',
        'com.samsung.tv.bixby-context-client':'voice','com.samsung.tv.bixby-prov':'voice','com.samsung.tv.bixbycapsuleviewer':'voice','com.samsung.tv.mybixby':'voice','com.samsung.tv.wakeup-engine-bixby':'voice',
        'com.samsung.tizen.smartthings-client':'connectivity','com.samsung.tizen.smartthings-thing':'connectivity','com.samsung.tv.coba.smartthings':'connectivity','com.samsung.tv.airplay-app':'connectivity'
    };
    if(known[pkg]||r.appId==='NRi6kdBYJ0.AirPlayWebApp')return result(known[pkg]||'connectivity','catalog','Known package ID');
    var id=(r.appId+' '+pkg+' '+(r.name||'')).toLowerCase(),category=null;
    if(DEMO_RE.test(id))category='hotel';
    else if(MEDIA_APP_RE.test(id))category='media';
    else if(VOICE_RE.test(id))category='voice';
    else if(CONNECTIVITY_RE.test(id))category='connectivity';
    if(category)return result(category,'heuristic','Inferred from name or ID; function not verified');
    if(r.origin==='installed'&&r.show)return result('user','registry','Installed and menu-visible in the TV registry');
    return result(r.system?'system':'other','registry',r.system?'System package in the TV registry':'Function not classified');
}
function category(r){return classification(r).category;}
// Area, role, purpose and firmware facts for the Debloater (app-catalog.js).
function describe(r) {
    var c = catalog.describe(r);
    // launchRisk (#135): 'blocked' or 'confirm' for factory, hotel and shop apps; see factory-apps.js.
    return {area: c.area, role: c.role, purpose: c.purpose, referencedBy: c.referencedBy, startsOn: c.startsOn, access: c.access, catalogSource: c.source,
        launchRisk: factoryApps.risk(r.appId, r.packageId)};
}

function summarize(rows) {
    var out = {total: rows.length, ads: 0, privacy: 0, other: 0, protected: 0};
    rows.forEach(function (r) { out[r.kind]++; if (r.protected) out.protected++; });
    return out;
}

function blocklist(format) {
    if (format === 'hosts') {
        return BLOCKLIST_DOMAINS.map(function (d) { return '0.0.0.0 ' + d; }).join('\n') + '\n';
    }
    if (format === 'domains') return BLOCKLIST_DOMAINS.join('\n') + '\n';
    return null;
}

module.exports = {
    BLOCKLIST_DOMAINS: BLOCKLIST_DOMAINS,
    normalize: normalize,
    category: category,
    classification: classification,
    describe: describe,
    summarize: summarize,
    blocklist: blocklist
};
