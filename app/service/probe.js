'use strict';

// The widget UI (index.html) runs a one-shot probe of the public APIs available
// on the TV and POSTs the result here. The service keeps the latest probe and
// app inventory in memory and on disk, so the dashboard can show them.

var fs = require('fs');

var STORE_PATH = '/opt/usr/home/owner/share/vetro-probe.json';
var MAX_JSON = 262144;

// Bounded copy of arbitrary JSON: depth, key count and string length are capped.
function clip(value, depth) {
    if (depth > 6) return null;
    if (typeof value === 'string') return value.slice(0, 500);
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
    if (Array.isArray(value)) return value.slice(0, 2000).map(function (v) { return clip(v, depth + 1); });
    if (value && typeof value === 'object') {
        var out = {};
        Object.keys(value).slice(0, 100).forEach(function (k) { out[k.slice(0, 80)] = clip(value[k], depth + 1); });
        return out;
    }
    return null;
}

function sanitize(report) {
    var clean = clip(report, 0);
    if (!clean || typeof clean !== 'object' || Array.isArray(clean)) throw new Error('expected a JSON object');
    if (Buffer.byteLength(JSON.stringify(clean), 'utf8') > MAX_JSON) throw new Error('probe report too large');
    clean.receivedAt = Math.floor(Date.now() / 1000);
    return clean;
}

function load() {
    try { return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); } catch (e) { return null; }
}

function save(report) {
    try { fs.writeFileSync(STORE_PATH, JSON.stringify(report)); return true; } catch (e) { return false; }
}

// The TV screen now sends what it has after the first steps and again at the end (#101, #104), and reads the package
// list after its verdict. A report sent before the app or package list was read keeps the lists of the last report
// that had them, so an early report does not empty the app inventory. carried names what was kept.
function carry(previous, next) {
    var kept = [];
    ['apps', 'packages'].forEach(function (k) {
        var ran = next.probe && typeof next.probe === 'object' && next.probe[k];
        if (!ran && previous && Array.isArray(previous[k]) && previous[k].length) { next[k] = previous[k]; kept.push(k); }
    });
    if (kept.length) next.carried = kept; else delete next.carried;
    return next;
}

module.exports = {STORE_PATH: STORE_PATH, MAX_JSON: MAX_JSON, sanitize: sanitize, load: load, save: save, carry: carry};
