'use strict';
// Save settings / Load settings (issue #307): one JSON file with the user's choices, to keep before a firmware update, a
// Smart Hub reset or a move to another TV.
// - Only choices go in. What Vetro recorded about this TV (disabled-by-vetro, quick-flags, quick-markers, startup backups,
//   the values to put back, the keep-removed package list, Home row keys) never does: loaded on another TV, or after a
//   reset, it would make Restore put back changes that are not there, or uninstall apps there.
// - No secrets: pairing, the device id and the MQTT password and client id stay out.
// - Loading never writes a file of its own. plan() compares the file with this TV and returns the requests the dashboard
//   makes anyway (POST /dock, /wins, /quick ...), one at a time, so every check, lock, read-back and record of those routes
//   still applies. A step that needs root is listed as blocked while the root agent is not connected; nothing waits.
// - Loading switches off what the file has off; it never switches a Quick settings group back on.
var FORMAT = 'vetro-settings', SCHEMA = 1, MAX_BYTES = 256 * 1024;
var WIN_IDS = ['firmware', 'quickboot', 'multiscreen', 'ambient', 'telemetry', 'airplay', 'remotesupport', 'delivery', 'wifipresence'];
// Launcher switches, in the order they are applied (before the launcher itself is switched on, which then starts with them).
var DOCK_SWITCHES = ['fixTizenTube', 'closeIdleHome', 'volumePill', 'numberPad', 'noMotion', 'hdrDim', 'showHomeSources', 'useSourceImages', 'connectedSourcesOnly', 'hideTvSource'];
var DOCK_ROOT = {showHomeSources: true, useSourceImages: true, connectedSourcesOnly: true, hideTvSource: true};     // these read the TV's sources even with the launcher off
var EDGES = ['left', 'right', 'top', 'bottom', 'hidden'], STORES = ['tvstore', 'samsung'];
var ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/, CARD_RE = /^(?:tasks|audio|picture|sleep|shard:[A-Za-z0-9._-]{1,64})$/;
var SECTIONS = ['launcher', 'tuner', 'remapper', 'essentials', 'performance', 'keepRemoved', 'quickSettings', 'dns', 'mqtt', 'shards'];
var LABELS = {launcher: 'Launcher', tuner: 'Vetro TV Tuner', remapper: 'Remapper', essentials: 'Essential settings', performance: 'Extra performance mode',
    keepRemoved: 'Keep removed apps removed', quickSettings: 'Quick settings', dns: 'DNS blocking', mqtt: 'MQTT', shards: 'Shards'};
var WIN_LABELS = {firmware: 'Block firmware and software updates', quickboot: 'Quick boot', multiscreen: 'Disable Multi View autostart', ambient: 'Stop Ambient',
    telemetry: 'Stop viewing-data collection', airplay: 'Disable AirPlay', remotesupport: 'Disable Samsung remote support', delivery: 'Disable background app delivery',
    wifipresence: 'Disable Wi-Fi presence'};
var DOCK_LABELS = {fixTizenTube: 'Fix TizenTube', closeIdleHome: 'Close idle Samsung Home', volumePill: 'Volume bar', numberPad: 'Number pad',
    noMotion: 'Reduce motion', hdrDim: 'Dim UI in HDR', showHomeSources: 'HDMI sources on Home', useSourceImages: 'HDMI source images', connectedSourcesOnly: 'Connected sources only', hideTvSource: 'Hide TV on Sources'};
var MQTT_FIELDS = ['enabled', 'host', 'port', 'tls', 'ca', 'username', 'topicPrefix', 'deviceName'];
// Groups loading never switches off: Samsung Home has its own warning (the TV may not start without it).
var QUICK_NEVER = ['samsung-home'];
// Sections this TV's side of the comparison can only be read with the root agent.
var ROOT_READ = ['quickSettings', 'dns'];

function bool(v) { return v === true; }
function hdrBrightnessInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 0 && v <= 100 ? v : 40; }
function str(v, max) { return typeof v === 'string' && v.length <= max ? v : null; }
function ids(list, re, max) {
    return (Array.isArray(list) ? list : []).filter(function (x, i, a) { return typeof x === 'string' && re.test(x) && a.indexOf(x) === i; }).slice(0, max);
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// --- Saving -----------------------------------------------------------------------------------------------------------------
// src: what main.js reads. Each part may be null when it could not be read; the file then says so in notRead.
function build(src) {
    var s = {}, notRead = {};
    var d = src.dock;
    if (d) s.launcher = {mode: d.customApp ? 'custom' : d.enabled ? 'vetro' : 'off', customApp: d.customApp || null,
        fixTizenTube: bool(d.fixTizenTube), closeIdleHome: d.closeIdleHome !== false, volumePill: bool(d.volumePill), numberPad: bool(d.numberPad),
        noMotion: bool(d.noMotion), hdrDim: bool(d.hdrDim), hdrBrightness: hdrBrightnessInt(d.hdrBrightness),
        showHomeSources: bool(d.showHomeSources), useSourceImages: bool(d.useSourceImages), connectedSourcesOnly: bool(d.connectedSourcesOnly), hideTvSource: bool(d.hideTvSource),
        volumeEdge: EDGES.indexOf(d.volumeEdge) >= 0 ? d.volumeEdge : 'left', appStore: d.appStore === 'samsung' ? 'samsung' : 'tvstore',
        cards: ids(d.cards, CARD_RE, 3)};
    else notRead.launcher = 'unreadable';
    if (src.tuner) s.tuner = {enabled: bool(src.tuner.enabled)}; else notRead.tuner = 'unreadable';
    if (Array.isArray(src.rules)) s.remapper = {rules: src.rules}; else notRead.remapper = 'unreadable';
    if (src.wins) {
        var wins = {};
        WIN_IDS.forEach(function (id) {
            if (id === 'multiscreen') { if (src.multiscreen === true || src.multiscreen === false) wins.multiscreen = src.multiscreen; }
            else wins[id] = bool(src.wins[id]);
        });
        s.essentials = {wins: wins, keyGuides: bool(src.keyGuides), hbbtvOff: bool(src.wins.hbbtv)};
    } else notRead.essentials = 'unreadable';
    if (src.perf) s.performance = {on: bool(src.perf.on), keepOpen: ids(src.perf.keepOpen, ID_RE, 100)}; else notRead.performance = 'unreadable';
    if (src.keepRemoved === true || src.keepRemoved === false) s.keepRemoved = {enabled: src.keepRemoved}; else notRead.keepRemoved = 'unreadable';
    if (Array.isArray(src.quickOff)) s.quickSettings = {off: ids(src.quickOff, ID_RE, 200)}; else notRead.quickSettings = src.root ? 'unreadable' : 'needs-root';
    if (src.dns) s.dns = {enabled: bool(src.dns.enabled), domains: (Array.isArray(src.dns.domains) ? src.dns.domains : []).slice(0, 500)};
    else notRead.dns = src.root ? 'unreadable' : 'needs-root';
    if (src.mqtt) {
        var m = {};
        MQTT_FIELDS.forEach(function (k) { if (src.mqtt[k] !== undefined) m[k] = src.mqtt[k]; });
        m.hadPassword = src.mqtt.hasPassword === true;      // not the password: whether one has to be typed again
        s.mqtt = m;
    } else notRead.mqtt = 'unreadable';
    if (src.shards) s.shards = {developer: bool(src.shards.developer), list: (src.shards.list || []).filter(function (p) { return p && !p.bundled && ID_RE.test(p.id || ''); })
        .map(function (p) { return {id: p.id, name: str(p.name, 80) || p.id, version: str(p.version, 40), enabled: p.enabled === true}; })};
    else notRead.shards = 'unreadable';
    return {format: FORMAT, schemaVersion: SCHEMA, appVersion: src.appVersion || null, savedAt: src.now || null, sections: s, notRead: notRead};
}

// --- Reading a file ---------------------------------------------------------------------------------------------------------
// Checks the envelope and the type of every field plan() looks at; the routes the steps go to check the values themselves.
// A section of the wrong shape is dropped and named in `dropped`; an unknown section is ignored.
function parse(file) {
    if (typeof file === 'string') {
        if (file.length > MAX_BYTES) throw Error('The file is larger than 256 KB, so it is not a Vetro settings file.');
        try { file = JSON.parse(file); } catch (e) { throw Error('The file is not valid JSON.'); }
    }
    if (!file || typeof file !== 'object' || file.format !== FORMAT) throw Error('This is not a Vetro settings file.');
    if (!(file.schemaVersion >= 1) || Math.floor(file.schemaVersion) !== file.schemaVersion) throw Error('This settings file has no valid version.');
    if (file.schemaVersion > SCHEMA) throw Error('This file was saved by a newer Vetro. Update Vetro, then load it again.');
    var src = file.sections && typeof file.sections === 'object' ? file.sections : {}, out = {}, dropped = [];
    function take(name, ok) { if (src[name] === undefined) return; if (ok(src[name])) out[name] = src[name]; else dropped.push(name); }
    function obj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
    function isBool(v) { return v === true || v === false; }
    take('launcher', function (v) {
        return obj(v) && ['vetro', 'custom', 'off'].indexOf(v.mode) >= 0 && (v.mode !== 'custom' || (typeof v.customApp === 'string' && ID_RE.test(v.customApp))) &&
            DOCK_SWITCHES.every(function (k) { return v[k] === undefined || isBool(v[k]); }) &&
            (v.hdrBrightness === undefined || (typeof v.hdrBrightness === 'number' && isFinite(v.hdrBrightness) && Math.floor(v.hdrBrightness) === v.hdrBrightness && v.hdrBrightness >= 0 && v.hdrBrightness <= 100)) &&
            (v.volumeEdge === undefined || EDGES.indexOf(v.volumeEdge) >= 0) && (v.appStore === undefined || STORES.indexOf(v.appStore) >= 0) &&
            (v.cards === undefined || (Array.isArray(v.cards) && v.cards.length <= 3 && v.cards.every(function (c) { return typeof c === 'string' && CARD_RE.test(c); })));
    });
    take('tuner', function (v) { return obj(v) && isBool(v.enabled); });
    take('remapper', function (v) { return obj(v) && Array.isArray(v.rules) && v.rules.length <= 50; });
    take('essentials', function (v) {
        return obj(v) && obj(v.wins) && Object.keys(v.wins).every(function (k) { return WIN_IDS.indexOf(k) < 0 || isBool(v.wins[k]); }) &&
            (v.keyGuides === undefined || isBool(v.keyGuides)) && (v.hbbtvOff === undefined || isBool(v.hbbtvOff));
    });
    take('performance', function (v) { return obj(v) && isBool(v.on) && (v.keepOpen === undefined || (Array.isArray(v.keepOpen) && v.keepOpen.length <= 100)); });
    take('keepRemoved', function (v) { return obj(v) && isBool(v.enabled); });
    take('quickSettings', function (v) { return obj(v) && Array.isArray(v.off) && v.off.length <= 200; });
    take('dns', function (v) { return obj(v) && isBool(v.enabled) && Array.isArray(v.domains) && v.domains.length <= 500; });
    take('mqtt', function (v) { return obj(v) && (v.enabled === undefined || isBool(v.enabled)); });
    take('shards', function (v) { return obj(v) && Array.isArray(v.list) && v.list.length <= 100 && v.list.every(function (p) { return obj(p) && typeof p.id === 'string' && ID_RE.test(p.id); }); });
    return {appVersion: typeof file.appVersion === 'string' ? file.appVersion.slice(0, 40) : null, savedAt: typeof file.savedAt === 'string' ? file.savedAt.slice(0, 40) : null,
        sections: out, dropped: dropped, notRead: obj(file.notRead) ? Object.keys(file.notRead).filter(function (k) { return SECTIONS.indexOf(k) >= 0; }) : []};
}

// --- Loading: what would change ---------------------------------------------------------------------------------------------
// want: parse() output. cur: build() of this TV now, plus
//   root (agent connected), shards {id: {enabled, version}}, quick {id: 'on'|'off'|'partial'|'unavailable'|'unknown'},
//   quickLabels {id: label}, hbbtvValue (the TV's value now, for the route's precondition; null unread).
// Returns {steps:[{section, label, path, body, root, confirm}], blocked:[{section, label, reason}], skipped:[...], same:[section]}.
// A step marked root is blocked when root is not connected. confirm: the dashboard asks before running it (apps switched off).
function plan(want, cur) {
    var w = want.sections, c = cur.sections || {}, steps = [], blocked = [], skipped = [], same_ = [];
    function step(section, label, path, body, needsRoot, confirm) {
        var s = {section: section, label: label, path: path, body: body, root: !!needsRoot, confirm: !!confirm};
        if (s.root && !cur.root) blocked.push({section: section, label: label, reason: 'Needs root access. Load the file again once Root access is connected.'});
        else steps.push(s);
    }
    function skip(section, label, reason) { skipped.push({section: section, label: label, reason: reason}); }
    function section(name, fn) {
        if (!w[name]) return;
        if (!c[name] && !cur.root && ROOT_READ.indexOf(name) >= 0) return blocked.push({section: name, label: LABELS[name], reason: 'Needs root access. Load the file again once Root access is connected.'});
        if (!c[name]) return skip(name, LABELS[name], 'Could not be read on this TV, so it was not compared.');
        var before = steps.length + blocked.length + skipped.length;
        fn(w[name], c[name]);
        if (steps.length + blocked.length + skipped.length === before) same_.push(name);
    }

    // Performance mode off goes first: on a TV that ran a 0.7.1 test build, turning it off also puts back what that build turned
    // on (Reduce motion, telemetry ...), which would otherwise undo the same choices loaded from the file just before.
    var perfOff = !!(w.performance && c.performance && w.performance.on === false && c.performance.on === true);
    if (perfOff) step('performance', LABELS.performance + ' off', '/performance', {on: false}, false);
    // Shards next: the launcher's Control center cards can name a Shard only while it runs.
    section('shards', function (f, now) {
        if (f.developer === true && now.developer !== true) skip('shards', 'Developer mode', 'Turn it on yourself in Shards if you need it: it lets unsigned code run as root.');
        f.list.forEach(function (p) {
            var have = (cur.shards || {})[p.id], name = typeof p.name === 'string' ? p.name.slice(0, 80) : p.id;
            if (!have) return skip('shards', name, 'Not installed. Install it from the catalog in Shards, then load the file again to switch it on.');
            if (p.enabled === true && !have.enabled) step('shards', 'Turn on ' + name, '/plugins/' + encodeURIComponent(p.id) + '/enable', {}, false);
            else if (p.enabled === false && have.enabled) step('shards', 'Turn off ' + name, '/plugins/' + encodeURIComponent(p.id) + '/disable', {}, false);
        });
    });
    section('mqtt', function (f, now) {
        var body = {}, differs = false;
        MQTT_FIELDS.forEach(function (k) { var v = f[k] !== undefined ? f[k] : now[k]; body[k] = v; if (!same(v, now[k])) differs = true; });
        if (differs) step('mqtt', 'MQTT connection settings', '/mqtt', body, false);
        if (f.hadPassword && !now.hadPassword) skip('mqtt', 'MQTT password', 'The file never holds the password: type it again in MQTT.');
    });
    section('remapper', function (f, now) { if (!same(f.rules, now.rules)) step('remapper', f.rules.length + ' Remapper rule' + (f.rules.length === 1 ? '' : 's'), '/remap', {rules: f.rules}, false); });
    section('launcher', function (f, now) {
        var running = now.mode !== 'off';
        DOCK_SWITCHES.forEach(function (k) {
            if (f[k] === undefined || f[k] === now[k]) return;
            step('launcher', DOCK_LABELS[k] + (f[k] ? ' on' : ' off'), '/dock', {action: k, on: f[k]}, DOCK_ROOT[k] || (running && (k === 'noMotion' || k === 'hdrDim')));
        });
        if (f.hdrBrightness !== undefined && f.hdrBrightness !== now.hdrBrightness) {
            var hdrWillRun = f.hdrDim !== undefined ? f.hdrDim : now.hdrDim;
            step('launcher', 'HDR overlay brightness: ' + f.hdrBrightness + '%', '/dock', {action: 'hdrBrightness', brightness: f.hdrBrightness}, running && hdrWillRun);
        }
        if (f.volumeEdge && f.volumeEdge !== now.volumeEdge) step('launcher', 'Volume bar position: ' + f.volumeEdge, '/dock', {action: 'volumeEdge', edge: f.volumeEdge}, running);
        if (f.appStore && f.appStore !== now.appStore) step('launcher', 'Store in All apps: ' + (f.appStore === 'samsung' ? 'Samsung' : 'TV-Store'), '/dock', {action: 'appStore', store: f.appStore}, false);
        if (f.cards && !same(f.cards, now.cards)) {
            var missing = f.cards.filter(function (k) { var id = k.indexOf('shard:') === 0 ? k.slice(6) : null; return id && !((cur.shards || {})[id] && (cur.shards[id].enabled || (w.shards && w.shards.list.some(function (p) { return p.id === id && p.enabled === true; })))); });
            if (missing.length) skip('launcher', 'Control center cards', 'They name a Shard that is not installed here (' + missing.join(', ') + '). Set the cards in Launcher.');
            else step('launcher', 'Control center cards', '/dock', {action: 'cards', cards: f.cards}, running);
        }
        if (f.mode !== now.mode || (f.mode === 'custom' && f.customApp !== now.customApp)) {
            // The two launchers exclude each other (dock.enable / enableCustom refuse while the other is on): the one on goes first.
            if (f.mode !== 'off' && now.mode !== 'off') step('launcher', now.mode === 'custom' ? 'Turn off the custom launcher' : 'Turn off the launcher', '/dock', {action: now.mode === 'custom' ? 'disableCustom' : 'disable'}, false);
            if (f.mode === 'vetro') step('launcher', 'Turn on the Vetro launcher', '/dock', {action: 'enable'}, true);
            else if (f.mode === 'custom') step('launcher', 'Turn on the custom launcher (' + f.customApp + ')', '/dock', {action: 'enableCustom', appId: f.customApp}, true);
            else step('launcher', 'Turn off the launcher', '/dock', {action: now.mode === 'custom' ? 'disableCustom' : 'disable'}, false);
        }
    });
    section('tuner', function (f, now) { if (f.enabled !== now.enabled) step('tuner', f.enabled ? 'Turn on Vetro TV Tuner' : 'Turn off Vetro TV Tuner', '/tuner', {action: f.enabled ? 'enable' : 'disable'}, f.enabled); });
    section('essentials', function (f, now) {
        WIN_IDS.forEach(function (id) {
            if (!(f.wins[id] === true || f.wins[id] === false)) return;
            if (now.wins[id] === undefined) return cur.root ? skip('essentials', WIN_LABELS[id], 'Its state could not be read on this TV.') : step('essentials', WIN_LABELS[id] + (f.wins[id] ? ' on' : ' off'), '/wins', {id: id, on: f.wins[id]}, true);
            if (f.wins[id] !== now.wins[id]) step('essentials', WIN_LABELS[id] + (f.wins[id] ? ' on' : ' off'), '/wins', {id: id, on: f.wins[id]}, true);
        });
        if ((f.keyGuides === true || f.keyGuides === false) && f.keyGuides !== now.keyGuides) step('essentials', 'Hide remote key guides ' + (f.keyGuides ? 'on' : 'off'), '/wins', {id: 'keyguides', on: f.keyGuides}, true);
        if ((f.hbbtvOff === true || f.hbbtvOff === false) && f.hbbtvOff !== now.hbbtvOff) {
            if (cur.hbbtvValue == null) { if (cur.root) skip('essentials', 'HbbTV', 'Its value could not be read on this TV.'); else step('essentials', 'HbbTV ' + (f.hbbtvOff ? 'off' : 'on'), '/hbbtv', null, true); }
            else step('essentials', 'HbbTV ' + (f.hbbtvOff ? 'off' : 'on'), '/hbbtv', {off: f.hbbtvOff, expected: cur.hbbtvValue}, true);
        }
    });
    section('quickSettings', function (f, now) {
        f.off.forEach(function (id) {
            if (typeof id !== 'string') return;
            var label = (cur.quickLabels || {})[id] || id, st = (cur.quick || {})[id];
            if (QUICK_NEVER.indexOf(id) >= 0) return skip('quickSettings', label, 'Switch it off yourself in Quick settings: it has its own warning.');
            if (!st) return skip('quickSettings', label, 'Not a Quick settings group in this Vetro version.');
            if (st === 'unavailable') return skip('quickSettings', label, 'Not installed on this TV.');
            if (st === 'unknown') return skip('quickSettings', label, 'Its state could not be read on this TV.');
            if (st !== 'off') step('quickSettings', 'Switch off ' + label, '/quick', {id: id, off: true}, true, true);
        });
    });
    section('dns', function (f, now) {
        if (f.enabled !== now.enabled || !same(f.domains, now.domains)) {
            if (f.enabled && !f.domains.length) return skip('dns', LABELS.dns, 'The file has it on with no domains.');
            step('dns', LABELS.dns + (f.enabled ? ' on, ' + f.domains.length + ' domain' + (f.domains.length === 1 ? '' : 's') : ' off'), '/dns', {action: 'apply', enabled: f.enabled, domains: f.domains}, true);
        }
    });
    section('keepRemoved', function (f, now) { if (f.enabled !== now.enabled) step('keepRemoved', LABELS.keepRemoved + (f.enabled ? ' on' : ' off'), '/keep-removed', {action: f.enabled ? 'enable' : 'disable'}, true); });
    // Last: the keep-open list, then the mode on (it changes no other section; on needs root, as it closes apps).
    section('performance', function (f, now) {
        var keep = Array.isArray(f.keepOpen) ? f.keepOpen : null;
        if (keep && !same(keep, now.keepOpen)) step('performance', 'Apps Extra performance mode keeps open', '/performance', {keepOpen: keep}, false);
        if (!perfOff && f.on !== now.on) step('performance', LABELS.performance + (f.on ? ' on' : ' off'), '/performance', {on: f.on}, f.on);
    });
    if (perfOff) same_ = same_.filter(function (n) { return n !== 'performance'; });
    return {steps: steps, blocked: blocked, skipped: skipped, same: same_, dropped: want.dropped || [], notRead: want.notRead || [], root: !!cur.root,
        appVersion: want.appVersion, savedAt: want.savedAt, labels: LABELS};
}

module.exports = {FORMAT: FORMAT, SCHEMA: SCHEMA, MAX_BYTES: MAX_BYTES, SECTIONS: SECTIONS, LABELS: LABELS, WIN_IDS: WIN_IDS, build: build, parse: parse, plan: plan};
