'use strict';

// Advanced settings: a named whitelist of what the public Samsung/Tizen web
// APIs expose (webapis.productinfo, tizen.systeminfo). Reads are collected by
// the widget UI; no free-form keys are accepted. Writes stay disabled until the
// probe (POST /probe) shows on the TV which keys accept them.

var ITEMS = [
    {id: 'model', api: 'productinfo', method: 'getModel', writable: false},
    {id: 'realModel', api: 'productinfo', method: 'getRealModel', writable: false},
    {id: 'firmware', api: 'productinfo', method: 'getFirmware', writable: false},
    {id: 'modelCode', api: 'productinfo', method: 'getModelCode', writable: false},
    {id: 'localSet', api: 'productinfo', method: 'getLocalSet', writable: false},
    {id: 'smartHubServer', api: 'productinfo', method: 'getSmartTVServerType', writable: false},
    {id: 'platformVersion', api: 'systeminfo', method: 'getCapability', writable: false}
];

var BY_ID = {};
ITEMS.forEach(function (i) { BY_ID[i.id] = i; });

function describe() {
    return ITEMS.map(function (i) { return {id: i.id, api: i.api, writable: i.writable}; });
}

// Keeps only whitelisted ids with string/number/boolean values.
function sanitize(values) {
    var out = {};
    if (!values || typeof values !== 'object') return out;
    Object.keys(values).forEach(function (k) {
        var v = values[k];
        if (BY_ID[k] && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
            out[k] = typeof v === 'string' ? v.slice(0, 120) : v;
        }
    });
    return out;
}

function validateWrite(id) {
    var item = BY_ID[id];
    if (!item) throw new Error('unknown setting: ' + id);
    if (!item.writable) throw new Error('setting is read-only: ' + id);
}

module.exports = {ITEMS: ITEMS, describe: describe, sanitize: sanitize, validateWrite: validateWrite};
