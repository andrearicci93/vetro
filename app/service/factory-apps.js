'use strict';
// #135: Samsung's factory, hotel and shop apps ("Not used at home", app-catalog.js) are installed on home TVs too,
// and app_launcher opens them like any other app. One of them, AgingApp (the factory colour test), was opened from
// the Task manager and then stopped with "Stop now": the vconf key db/FactoryApp/Aging stayed at 1, tv-viewer started
// the test again at every boot and the volume bar stayed hidden. A factory reset and unplugging did not clear it; the
// user's fix was `vconftool set -f -t int db/FactoryApp/Aging 0` and a restart (9francy9, Smart Monitor M7
// LS43FM702UUXEN, fw T-RSLMFWWC-0090-1311.1, Vetro 0.3.5).
//
// Opening, at two levels:
//   blocked: Vetro never opens it (AgingApp and the factory service menus).
//   confirm: the Task manager opens it only after a warning; remapper, MQTT and HTTP rules never open it, because
//            they run from a key press or a message, with nobody in front of the screen to confirm.
// Only AgingApp's damage is confirmed. The others are treated the same way because they serve shop, hotel and
// service-centre modes that a home TV does not use (Vetro's own classification, from one Q80A firmware).
//
// The Aging key: Vetro only reads it, and writes 0 only when it reads exactly 1 as an integer. It never creates the key
// (on other models it may not exist or have another name) and never touches the other db/FactoryApp/* keys, whose
// meaning is unknown (they may hold panel calibration). Writing needs the root agent, like every other vconf change.
var catalog = require('./app-catalog.js');
// Regular expressions compiled once at module load, not on every call.
var BLOCKED_RE = /(?:^|\.)AgingApp$|^org\.tizen\.(?:ep-hotel-)?factory$/;
var FACTORY_TEST_RE = /test-oqc/;
// Store apps: a 10-character package ID (appId "<package>.<Name>") or an old numeric ID. Their names can contain
// "hotel" or "factory" without being Samsung's commercial modes.
var STORE_ID_RE = /^[A-Za-z0-9]{10}(?:\.|$)|^\d+$/;
var VCONF_VALUE_RE = /value\s*=\s*(-?\d+)\s*\(([A-Za-z0-9]+)\)/;
var INT_TYPE_RE = /^int/i;

var AGING_ID = 'org.tizen.AgingApp';
var AGING_KEY = 'db/FactoryApp/Aging';

function risk(appId, packageId) {
    var id = String(appId || ''), pkg = String(packageId || '');
    if (BLOCKED_RE.test(id) || BLOCKED_RE.test(pkg)) return 'blocked';
    if (STORE_ID_RE.test(id)) return null;
    if (FACTORY_TEST_RE.test(id) || FACTORY_TEST_RE.test(pkg)) return 'confirm';
    return catalog.areaOf(pkg || id, id) === 'commercial' ? 'confirm' : null;
}
function isAging(appId) { return /(?:^|\.)AgingApp$/.test(String(appId || '')); }

var BLOCKED_MESSAGE = 'is a factory test or service menu: Vetro does not open it, because it can leave the TV in a factory mode';
var RULE_MESSAGE = 'is a hotel, shop or factory app (Not used at home): rules cannot open it';
var CONFIRM_MESSAGE = 'is a hotel, shop or factory app (Not used at home): confirm before opening it';

// {present, value, type}. present is false when vconftool gives no value: the key is missing on this model, or unreadable.
function parse(text) {
    var m = VCONF_VALUE_RE.exec(String(text || ''));
    if (!m) return {present: false, value: null, type: null};
    return {present: true, value: Number(m[1]), type: m[2]};
}
function active(s) { return !!s && s.present === true && s.value === 1 && INT_TYPE_RE.test(s.type || ''); }

function FactoryTest(execute) { this.execute = execute; this.busy = false; }
FactoryTest.prototype.read = function () {
    return this.execute('vconftool get ' + AGING_KEY + ' 2>&1', 8000).then(function (r) {
        if (!r || r.timed_out) throw new Error('The TV did not answer in time');
        var s = parse(r.stdout);
        return {key: AGING_KEY, present: s.present, value: s.value, type: s.type, active: active(s)};
    });
};
// Read; only if the key holds exactly 1: write 0, read again. Resolves {changed, before, after, active, message}.
FactoryTest.prototype.reset = function () {
    var self = this;
    if (this.busy) return Promise.reject(new Error('Factory test change already in progress'));
    this.busy = true;
    var before;
    return this.read().then(function (s) {
        before = s;
        if (!s.present) return {changed: false, before: s, after: s, active: false, message: 'The factory test setting does not exist on this TV. Nothing was written.'};
        if (!s.active) return {changed: false, before: s, after: s, active: false, message: 'The factory test is already off.'};
        return self.execute('vconftool set -f -t int ' + AGING_KEY + ' 0', 8000).then(function (r) {
            if (!r || r.exit_code || r.timed_out) throw new Error((r && (r.stderr || r.stdout)) || 'The factory test setting could not be written');
            return self.read();
        }).then(function (after) {
            if (!after.present || after.value !== 0) throw new Error('The factory test setting was written but did not read back as 0');
            return {changed: true, before: before, after: after, active: false, message: 'Factory test turned off. Restart the TV: the colour test no longer starts at boot.'};
        });
    }).then(function (result) { self.busy = false; return result; }, function (e) { self.busy = false; throw e; });
};

module.exports = {risk: risk, isAging: isAging, parse: parse, active: active, FactoryTest: FactoryTest,
    AGING_ID: AGING_ID, AGING_KEY: AGING_KEY, BLOCKED_MESSAGE: BLOCKED_MESSAGE, RULE_MESSAGE: RULE_MESSAGE, CONFIRM_MESSAGE: CONFIRM_MESSAGE};
