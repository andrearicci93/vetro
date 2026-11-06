'use strict';
// Firmware and Tizen version read by the service itself, for the diagnostic report. The widget posts the model and
// the firmware only when the Vetro page has finished its probe, and two community reports (#17, #25) came back with
// both empty. /etc/prd_info.ini and /etc/tizen-release are world-readable text files; this reads two lines of them.
// The commercial model is not in either file, so it still comes from the widget.
var execError = require('./exec-error.js');
// Regular expressions compiled once at module load, not on every call.
var CR_END_RE = /\r$/;
var VERSION_LINE_RE = /^Version=(.+?);?$/;
var TIZEN_LINE_RE = /^Tizen=(.+)$/;

var FIRMWARE = /^T-[A-Z0-9]{2,12}(?:-\d{4})?-\d{1,5}\.\d{1,3}$/;
// Two to four numeric parts: the platform capability gives "6.5" or "9.0", /etc/tizen-release gives "6.0.0".
var VERSION = /^\d{1,2}\.\d{1,2}(?:\.\d{1,3}){0,2}$/;
var TIZEN = /(\d{1,2}\.\d{1,2}(?:\.\d{1,3}){0,2})/;
function version(v) { return typeof v === 'string' && VERSION.test(v) ? v : null; }

function script() {
    return [
        'sed -n "/^\\[Version\\]/,/^\\[/p" /etc/prd_info.ini 2>/dev/null | grep -E "^Version=" | head -n 1',
        'head -n 1 /etc/tizen-release 2>/dev/null | sed "s/^/Tizen=/"',
        'true'
    ].join('\n');
}
function wrap(s) { return 'echo ' + Buffer.from(s).toString('base64') + ' | base64 -d | sh'; }

// Anything that does not look like what the TV writes is dropped, not exported.
function parse(text) {
    var out = {firmware: null, tizenVersion: null};
    String(text || '').split('\n').forEach(function (line) {
        line = line.replace(CR_END_RE, '').trim();
        var m = VERSION_LINE_RE.exec(line);
        if (m && FIRMWARE.test(m[1]) && !out.firmware) out.firmware = m[1];
        m = TIZEN_LINE_RE.exec(line);
        if (m && !out.tizenVersion) { var v = TIZEN.exec(m[1]); if (v) out.tizenVersion = v[1]; }
    });
    return out;
}

function read(execute) {
    return execute(wrap(script()), 5000).then(function (r) {
        if (!r || r.exit_code || r.timed_out) throw execError.failed(r, 'device info unavailable');
        return parse(r.stdout);
    });
}

// The probe values the widget posted, plus whatever the service can add. It only ever adds: it never rejects, and it
// resolves with the probe alone once maxMs have passed, so a busy or stuck root agent cannot cost the report its
// model and firmware. The firmware the widget posted is not replaced.
// The Tizen version comes from the platform capability the widget posted (platformVersion) when there is one, otherwise
// from the root read; tizenVersionSource says which, or 'unknown'. Without root only the first can exist.
function withVersion(probe, info) {
    var widget = version((probe || {}).platformVersion), service = info ? version(info.tizenVersion) : null;
    return Object.assign({}, probe, {
        tizenVersion: widget || service || null,
        tizenVersionSource: widget ? 'widget-capability' : service ? 'service-read' : 'unknown'
    });
}
// The commercial model, from the TV's own remote-control API on 127.0.0.1:8001 (/api/v2/). It answers without root and
// without the widget, so a report taken after the Vetro screen was closed early still names the TV (#101). That answer
// also carries ids and addresses: only the model name is kept, and only if it looks like one.
var MODEL = /^[A-Z0-9][A-Z0-9_-]{3,40}$/;
var API_URL = 'http://127.0.0.1:8001/api/v2/';
function parseApi(text) {
    var d;
    try { d = JSON.parse(String(text || '')); } catch (e) { return {modelName: null}; }
    var name = d && d.device && d.device.modelName;
    return {modelName: typeof name === 'string' && MODEL.test(name) ? name : null};
}
// A small GET with a time limit and a size cap. ES5 and the http module only, for the Node 4.4 TVs.
function httpGet(url, ms) {
    return new Promise(function (resolve, reject) {
        var body = '', req = require('http').get(url, function (res) {
            res.setEncoding('utf8');
            res.on('data', function (c) { body += c; if (body.length > 65536) { req.abort(); reject(new Error('answer too large')); } });
            res.on('end', function () { resolve(body); });
        });
        req.setTimeout(ms, function () { req.abort(); reject(new Error('timeout')); });
        req.on('error', reject);
    });
}
function readApi(get) { return get(API_URL, 3000).then(parseApi); }

// Gives up with the fallback after ms; never rejects.
function bounded(promise, ms, fallback) {
    var timer;
    var late = new Promise(function (resolve) { timer = setTimeout(function () { resolve(fallback); }, ms); });
    return Promise.race([promise.catch(function () { return fallback; }), late]).then(function (v) { clearTimeout(timer); return v; });
}
// The model from the API is added only when the widget posted none; modelSource says where it came from.
function merge(probe, execute, maxMs, get) {
    probe = probe || {};
    var root = bounded(Promise.resolve().then(function () { return read(execute); }), maxMs, null);
    var api = typeof get === 'function' && !probe.realModel && !probe.model
        ? bounded(Promise.resolve().then(function () { return readApi(get); }), maxMs, null) : Promise.resolve(null);
    return Promise.all([root, api]).then(function (r) {
        var info = r[0], out = withVersion(probe, info);
        if (info && info.firmware && !probe.firmware) { out.firmware = info.firmware; out.firmwareSource = 'service-read'; }
        if (r[1] && r[1].modelName) { out.realModel = r[1].modelName; out.modelSource = 'service-api'; }
        return out;
    });
}

module.exports = {read: read, merge: merge, parse: parse, script: script, version: version, parseApi: parseApi, httpGet: httpGet, API_URL: API_URL};
