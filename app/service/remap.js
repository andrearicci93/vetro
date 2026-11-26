'use strict';
// Regular expressions compiled once at module load, not on every call.
var RULE_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
var KEY_CODE_RE = /^\d{1,3}$/;

// Rules map physical evdev codes, foreground widget keys, or HTTP/MQTT triggers
// to native key injection and app launch through the platform adapter.

var MAX_RULES = 50;
var MAX_ACTIONS = 10;
var KEY_RE = /^KEY_[A-Z0-9_]{1,30}$/;
var APP_RE = /^[A-Za-z0-9_.-]{1,120}$/;
var TOPIC_RE = /^[A-Za-z0-9_\/.-]{1,120}$/;
var TRIGGER_TYPES = ['physical', 'key', 'mqtt', 'http'];
// Parts of Samsung's Settings ("CoBA Setting Component", app-facts.js). app_launcher accepts their ID and returns 0, but
// nothing opens (#100). Not offered as "App to open", refused in new rules, and skipped if an older rule has one.
var NOT_LAUNCHABLE_PREFIX = 'com.samsung.tv.coba.setting';
function launchable(appId) {
    var id = String(appId || '');
    return !(id === NOT_LAUNCHABLE_PREFIX || id.indexOf(NOT_LAUNCHABLE_PREFIX + '.') === 0);
}
var NOT_LAUNCHABLE_MESSAGE = 'is part of Samsung\u2019s Settings, not an app: it cannot be opened by its ID';
// Factory, hotel and shop apps (#135, factory-apps.js): a rule runs from a key press or a message, with nobody in front of
// the screen to confirm, so a rule never opens them. packageOf (optional) gives the package ID of an installed app.
var factoryApps = require('./factory-apps.js');
function ruleRisk(appId, packageOf) {
    return factoryApps.risk(appId, typeof packageOf === 'function' ? packageOf(appId) : null);
}

function validateAction(a) {
    if (!a || typeof a !== 'object') throw new Error('invalid action');
    if (a.type === 'key') {
        if (typeof a.key !== 'string' || !KEY_RE.test(a.key)) throw new Error('invalid key: ' + a.key);
        return {type: 'key', key: a.key};
    }
    if (a.type === 'launch') {
        if (typeof a.appId !== 'string' || !APP_RE.test(a.appId)) throw new Error('invalid appId');
        return {type: 'launch', appId: a.appId};
    }
    // Picture Off: the screen goes dark, the sound stays. No arguments; the command is fixed (control.js SCREEN_OFF_COMMAND).
    if (a.type === 'screenoff') return {type: 'screenoff'};
    // A condition, kept in the action list on purpose: an older Vetro does not know this type and refuses the rule set (a Settings
    // file, a saved rules file) instead of running the rule without its condition. Not an action: runActions never sees it.
    if (a.type === 'when') {
        if (a.screen !== 'on' && a.screen !== 'off') throw new Error('invalid condition: the screen is on or off');
        return {type: 'when', screen: a.screen};
    }
    if (a.type === 'mqtt') {
        if (typeof a.topic !== 'string' || !TOPIC_RE.test(a.topic)) throw new Error('invalid topic');
        var payload = a.payload == null ? '' : String(a.payload);
        if (payload.length > 256) throw new Error('payload too long');
        return {type: 'mqtt', topic: a.topic, payload: payload};
    }
    throw new Error('unknown action type: ' + a.type);
}

function validateRules(rules) {
    if (!Array.isArray(rules) || rules.length > MAX_RULES) throw new Error('rules must be an array (max ' + MAX_RULES + ')');
    var ids = {};
    var result=rules.map(function (r) {
        if (!r || typeof r !== 'object') throw new Error('invalid rule');
        if (typeof r.id !== 'string' || !RULE_ID_RE.test(r.id)) throw new Error('invalid rule id');
        if (ids[r.id]) throw new Error('duplicate rule id: ' + r.id);
        ids[r.id] = true;
        var t = r.trigger;
        if (!t || TRIGGER_TYPES.indexOf(t.type) === -1 || typeof t.value !== 'string' || !t.value || t.value.length > 120) {
            throw new Error('invalid trigger in rule ' + r.id);
        }
        if(t.type==='mqtt'&&!TOPIC_RE.test(t.value))throw Error('invalid MQTT trigger topic');
        if(t.payload!=null&&(t.type!=='mqtt'||typeof t.payload!=='string'||t.payload.length>256))throw Error('invalid MQTT trigger payload');
        if (t.type === 'physical' && (!KEY_CODE_RE.test(t.value) || +t.value > 767)) throw new Error('invalid physical input code');
        if (!Array.isArray(r.actions) || !r.actions.length || r.actions.length > MAX_ACTIONS) {
            throw new Error('rule ' + r.id + ' needs 1..' + MAX_ACTIONS + ' actions');
        }
        var checked = r.actions.map(validateAction);
        var guards = checked.filter(function (a) { return a.type === 'when'; });
        if (guards.length > 1) throw new Error('rule ' + r.id + ' has more than one condition');
        if (guards.length && checked.length === 1) throw new Error('rule ' + r.id + ' has a condition but no action');
        // The condition always comes last, so the first action is what the rule does.
        return {
            id: r.id,
            enabled: r.enabled !== false,
            trigger: Object.assign({type:t.type,value:t.type==='physical'?String(+t.value):t.value},t.payload==null?{}:{payload:t.payload}),
            actions: checked.filter(function (a) { return a.type !== 'when'; }).concat(guards)
        };
    });
    var inputs=result.filter(function(r){return r.enabled&&r.trigger.type==='mqtt'}).map(function(r){return r.trigger.value});
    result.forEach(function(r){if(r.enabled&&r.actions.some(function(a){return a.type==='mqtt'&&inputs.indexOf(a.topic)>=0}))throw Error('MQTT action topic overlaps a trigger; loop not allowed');});
    return result;
}

// The enabled rules matching the trigger, in rule order.
function matches(rules, type, value, payload) {
    return rules.filter(function (r) {
        return r.enabled && r.trigger.type === type && r.trigger.value === value && (r.trigger.payload==null||r.trigger.payload===payload);
    });
}
// The rule's condition ('on' or 'off': what the screen must be), or null.
function guardOf(rule) {
    var g = (rule.actions || []).filter(function (a) { return a.type === 'when'; })[0];
    return g ? g.screen : null;
}
// What a rule does: its actions without the condition.
function actionsOf(rule) {
    return rule.actions.filter(function (a) { return a.type !== 'when'; });
}
// Actions of every enabled rule matching the trigger, in rule order. A rule with a condition is left out: its condition needs the
// TV's state, which the caller reads (main.js guardedActions); a caller that cannot read it never runs it unguarded.
function resolve(rules, type, value, payload) {
    var out = [];
    matches(rules, type, value, payload).forEach(function (r) {
        if (guardOf(r)) return;
        actionsOf(r).forEach(function (a) { out.push(a); });
    });
    return out;
}

// On disk the rules with a condition live under their own key ("guarded"), next to "rules". A Vetro from before the condition
// validates "rules" all or nothing, and one entry it does not know would make it drop every shortcut, and the next save would erase them.
// Kept apart, it loads the plain rules, never sees the guarded ones, saves the whole file back with the key it does not know, and the
// conditioned rules are still there when this version comes back. In memory and in the API all of them stay in one list.
function toDisk(rules) {
    return {rules: rules.filter(function (r) { return !guardOf(r); }), guarded: rules.filter(function (r) { return !!guardOf(r); })};
}
// What the file holds, as one valid list. A bad "guarded" part loses only the conditioned rules, never the plain ones.
function fromDisk(store) {
    var plain = [], guarded = [];
    try { plain = validateRules((store && store.rules) || []); } catch (e) { return []; }
    try { guarded = validateRules(((store && store.guarded) || []).filter(function (r) { return !plain.some(function (p) { return r && p.id === r.id; }); })); } catch (e) { guarded = []; }
    var all = plain.concat(guarded.filter(function (r) { return !!guardOf(r); }));
    return all.length > MAX_RULES ? plain : all;
}

// New rules only: rules saved by an older version still load (validateRules), and runActions skips the action.
function checkLaunchable(rules, packageOf) {
    (rules || []).forEach(function (r) { (r.actions || []).forEach(function (a) {
        if (a.type !== 'launch') return;
        if (!launchable(a.appId)) throw new Error(a.appId + ' ' + NOT_LAUNCHABLE_MESSAGE);
        var level = ruleRisk(a.appId, packageOf);
        if (level) throw new Error(a.appId + ' ' + (level === 'blocked' ? factoryApps.BLOCKED_MESSAGE : factoryApps.RULE_MESSAGE));
    }); });
    return rules;
}
module.exports = {validateRules: validateRules, validateAction: validateAction, resolve: resolve, matches: matches, toDisk: toDisk, fromDisk: fromDisk, guardOf: guardOf, actionsOf: actionsOf, launchable: launchable,
    checkLaunchable: checkLaunchable, ruleRisk: ruleRisk, NOT_LAUNCHABLE_PREFIX: NOT_LAUNCHABLE_PREFIX};
