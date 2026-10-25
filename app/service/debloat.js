'use strict';

// Application features: classify package rows and validate debloat targets.
// State changes are delegated to the platform adapter.

// Substrings that mark an ad/ACR/tracking service. Derived from the verified
// category rules used on the Q80A (acr-service, adplatform, adplayer, ...).
var ADS_PATTERNS = [
    'adplatform',
    'acr-service',
    'ad-web-framework',
    'adplayer',
    'targeted-ad',
    'canalysis',
    'analytics',
    'nvision-analysis',
    'contents-recognition',
    'vision-data-recognition'
];

// Also worth surfacing under "privacy".
var PRIVACY_PATTERNS = ['privacy'];

// Smart Hub loads ResourceAdvertise from this package. Excluding it from
// the .NET component index breaks Home even though its DLLs remain on disk.
var SMART_HUB_DEPENDENCY = 'com.samsung.tv.coba.adagent';

function isProtected(id) {
    return typeof id === 'string' &&
        (id === SMART_HUB_DEPENDENCY || id.indexOf(SMART_HUB_DEPENDENCY + '.') === 0);
}

function isAds(appId, pkg) {
    if (appId === SMART_HUB_DEPENDENCY || pkg === SMART_HUB_DEPENDENCY) return false;
    var hay = (appId || '') + ' ' + (pkg || '');
    return ADS_PATTERNS.some(function (p) { return hay.toLowerCase().indexOf(p) !== -1; });
}

function isPrivacy(appId, pkg) {
    var hay = (appId || '') + ' ' + (pkg || '');
    return PRIVACY_PATTERNS.some(function (p) { return hay.toLowerCase().indexOf(p) !== -1; });
}

// Read the full package/app registry as CSV (package,app_id,app_disable).
function listCommand() {
    return 'sqlite3 -readonly -header -csv /opt/dbspace/.pkgmgr_parser.db ' +
        '"SELECT package,app_id,app_disable FROM package_app_info;"';
}

// Feature validation is independent of the platform's command transport.
function validateTargets(appIds, enabled) {
    if (!Array.isArray(appIds) || appIds.some(function (id) {
        return typeof id !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(id);
    })) throw new Error('invalid application IDs');
    if (!enabled && appIds.some(function (id) {
        return id === SMART_HUB_DEPENDENCY || id.indexOf(SMART_HUB_DEPENDENCY + '.') === 0;
    })) throw new Error('Cannot disable Smart Hub dependency: ' + SMART_HUB_DEPENDENCY);
}

// Parse the CSV output of listCommand() into rows, and tag ads/privacy.
function parseList(csv) {
    var rows = [];
    String(csv || '').split('\n').forEach(function (line) {
        if (!line.trim()) return;
        var parts = line.trim().split(',');
        if (parts.length < 3) return;
        var pkg = parts[0], appId = parts[1], disabled = parts[2];
        if (isAds(appId, pkg) || isPrivacy(appId, pkg)) {
            rows.push({
                package: pkg,
                app_id: appId,
                disabled: disabled === 'true',
                kind: isAds(appId, pkg) ? 'ads' : 'privacy'
            });
        }
    });
    return rows;
}

// Keep org.tizen.ambientapp out of this list: /usr/bin/ambient_start.sh relaunches it with
// app_launcher in a loop that only ends on "successfully launched" (read from the Q80A
// firmware, not tested on a TV), so a disabled app could leave that boot script spinning.
var VERIFIED_GLOBAL_IDS=['com.samsung.tv.acr','com.samsung.tv.canalysis-service','com.samsung.tv.vision-data-recognition-service','com.samsung.tv.contents-recognition-dbmgr','com.samsung.tv.nvision-analysis-dbmgr'];
module.exports = {
    VERIFIED_GLOBAL_IDS:VERIFIED_GLOBAL_IDS,
    ADS_PATTERNS: ADS_PATTERNS,
    isAds: isAds,
    isPrivacy: isPrivacy,
    isProtected: isProtected,
    listCommand: listCommand,
    validateTargets: validateTargets,
    parseList: parseList
};