'use strict';

// Rules map physical evdev codes, foreground widget keys, or HTTP/MQTT triggers
// to native key injection, app launch, and the launcher's inputs panel through the
// platform adapter.

var MAX_RULES = 50;
var MAX_ACTIONS = 10;
var KEY_RE = /^KEY_[A-Z0-9_]{1,30}$/;
var APP_RE = /^[A-Za-z0-9_.-]{1,120}$/;
var TOPIC_RE = /^[A-Za-z0-9_\/.-]{1,120}$/;
var TRIGGER_TYPES = ['physical', 'key', 'mqtt', 'http'];

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
    if (a.type === 'inputs') return {type: 'inputs'};
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
        if (typeof r.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(r.id)) throw new Error('invalid rule id');
        if (ids[r.id]) throw new Error('duplicate rule id: ' + r.id);
        ids[r.id] = true;
        var t = r.trigger;
        if (!t || TRIGGER_TYPES.indexOf(t.type) === -1 || typeof t.value !== 'string' || !t.value || t.value.length > 120) {
            throw new Error('invalid trigger in rule ' + r.id);
        }
        if(t.type==='mqtt'&&!TOPIC_RE.test(t.value))throw Error('invalid MQTT trigger topic');
        if(t.payload!=null&&(t.type!=='mqtt'||typeof t.payload!=='string'||t.payload.length>256))throw Error('invalid MQTT trigger payload');
        if (t.type === 'physical' && (!/^\d{1,3}$/.test(t.value) || +t.value > 767)) throw new Error('invalid physical input code');
        if (!Array.isArray(r.actions) || !r.actions.length || r.actions.length > MAX_ACTIONS) {
            throw new Error('rule ' + r.id + ' needs 1..' + MAX_ACTIONS + ' actions');
        }
        return {
            id: r.id,
            enabled: r.enabled !== false,
            trigger: Object.assign({type:t.type,value:t.type==='physical'?String(+t.value):t.value},t.payload==null?{}:{payload:t.payload}),
            actions: r.actions.map(validateAction)
        };
    });
    var inputs=result.filter(function(r){return r.enabled&&r.trigger.type==='mqtt'}).map(function(r){return r.trigger.value});
    result.forEach(function(r){if(r.enabled&&r.actions.some(function(a){return a.type==='mqtt'&&inputs.indexOf(a.topic)>=0}))throw Error('MQTT action topic overlaps a trigger; loop not allowed');});
    return result;
}

// Actions of every enabled rule matching the trigger, in rule order.
function resolve(rules, type, value, payload) {
    var out = [];
    rules.forEach(function (r) {
        if (r.enabled && r.trigger.type === type && r.trigger.value === value && (r.trigger.payload==null||r.trigger.payload===payload)) {
            r.actions.forEach(function (a) { out.push(a); });
        }
    });
    return out;
}

module.exports = {validateRules: validateRules, validateAction: validateAction, resolve: resolve};
