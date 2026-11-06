'use strict';
var execError = require('./exec-error.js');
// Regular expressions compiled once at module load, not on every call.
var QUOTE_RE = /'/g;
var DB_PREFIX_RE = /^db\//;
var VCONF_VALUE_RE = /value = (.*) \(([^)]*)\)/;
var TRUE_RE = /^(true|1)$/i;
var FALSE_RE = /^(false|0)$/i;
var MISSING_FILE_RE = /Error: Get:.*No such file or directory/;
var INTEGER_RE = /^-?\d+$/;
var DECIMAL_RE = /^-?\d+(\.\d+)?$/;

// Model menu data keys may identify provider requests or launchable panels,
// not vconf storage. Read only declared vconf keys or storage candidates;
// report a missing key separately from transport/permission failures.

var MENU_PATH = '/usr/share/menu/fulljson/menu-tv.json';
var MAX_ITEMS = 1500;
var DANGER = /(factory|aging|self.?test|internal.?pattern|panel.?mute|shop.?mode|reset|outdoor|video.?wall)/i;
var TYPES = { integer: 'int', int32: 'int', uint32: 'int', int64: 'int', uint64: 'int', bool: 'bool', boolean: 'bool', string: 'string', double: 'double' };

function wrap(s) { return 'echo ' + Buffer.from(s).toString('base64') + ' | base64 -d | sh'; }
function check(r) { if (r.exit_code || r.timed_out) throw execError.failed(r, r.stderr || r.stdout || 'TV menu unavailable'); return r.stdout || ''; }
function shq(s) { return "'" + String(s).replace(QUOTE_RE, "'\\''") + "'"; }

function parseMenu(text) {
    var o;
    try { o = JSON.parse(text); } catch (e) { throw execError.coded('unreadable', 'menu-tv.json unreadable'); }
    var items = o.menuitems || {}, tree = o.menutree || {};
    var parent = {};
    Object.keys(tree).forEach(function (k) { (tree[k].submenuitems || []).forEach(function (c) { if (parent[c] === undefined) parent[c] = k; }); });
    var out = [];
    Object.keys(items).forEach(function (id) {
        var it = items[id] || {}, d = it.data || {};
        if (!d.key || out.length >= MAX_ITEMS) return;
        var list = Array.isArray(d.list) ? d.list.map(function (x) { return { value: String(x.value), label: x['display-value'] == null ? null : String(x['display-value']) }; }) : null;
        var style = (it['setting-ui'] || {}).style || null;
        var action = style === 'application' || style === 'ui-gadget';
        var storage = !action && (d.provider === 'vconf-dataprovider' || DB_PREFIX_RE.test(d.key));
        var capability = action ? 'tv-panel' : storage ? 'storage-candidate' : 'provider-required';
        out.push({
            id: id, group: parent[id] || null, vconfKey: d.key, type: d.type || null, provider: d.provider || null,
            source: MENU_PATH, capability: capability, readStatus: storage ? 'unread' : 'provider-required', readable: storage, runtimeAvailability: null, writableVerified: false, options: list, style: style, danger: DANGER.test(id) || DANGER.test(d.key)
        });
    });
    return { count: out.length, items: out };
}

function parseValue(text) {
    var m = VCONF_VALUE_RE.exec(String(text || ''));
    return m ? { value: m[1], code: m[2] } : null;
}

function booleanValue(v){if(TRUE_RE.test(String(v)))return '1';if(FALSE_RE.test(String(v)))return '0';return null;}

function Catalog(execute) { this.execute = execute; this.cache = null; this.busy = false; }

Catalog.prototype.load = function () {
    var self = this;
    if (this.cache) return Promise.resolve(this.cache);
    return this.execute(wrap('cat ' + MENU_PATH), 12000).then(function (r) { self.cache = parseMenu(check(r)); return self.cache; });
};

Catalog.prototype.find = function (id) {
    return this.load().then(function (c) {
        var it = c.items.find(function (x) { return x.id === id; });
        if (!it) throw Error('Menu entry not found: ' + id);
        return it;
    });
};

Catalog.prototype.read = function (id) {
    var self = this;
    return this.find(id).then(function (it) {
        function result(status, pv) { return { id: id, vconfKey: it.vconfKey, type: it.type, provider: it.provider, capability: it.capability, status: status, value: pv ? pv.value : null, code: pv ? pv.code : null, options: it.options, runtimeAvailability: null, writableVerified: false }; }
        if (!it.readable) return result(it.readStatus);
        return self.execute(wrap('vconftool get ' + shq(it.vconfKey) + ' 2>&1'), 6000).then(function (r) {
            var output = String(r.stdout || '') + '\n' + String(r.stderr || '');
            if (!r.timed_out && MISSING_FILE_RE.test(output)) {
                it.readStatus = 'storage-missing'; it.readable = false;
                return result('storage-missing');
            }
            var pv = parseValue(check(r));
            if (!pv) throw Error('Unrecognized storage response');
            it.readStatus = 'storage-readable';
            return result('storage-readable', pv);
        });
    });
};

// Conservative write: enumerated/switch items only; int/bool/string; re-read + rollback.
Catalog.prototype.write = function (id, value) {
    var self = this;
    if (this.busy) return Promise.reject(Error('Setting change already in progress'));
    this.busy = true;
    return this.find(id).then(function (it) {
        if (!it.readable) throw Error('Direct read unsupported: ' + it.readStatus);
        if (it.danger) throw Error('Protected setting (risk): ' + id);
        var vt = TYPES[String(it.type || '').toLowerCase()];
        if (!vt) throw Error('Unsupported type: ' + it.type);
        if (!Array.isArray(it.options) || !it.options.length) throw Error('Options not tested; writes unavailable');
        var v = String(value);
        if (vt === 'int') { if (!INTEGER_RE.test(v) || !Number.isSafeInteger(Number(v)) || Number(v)<-2147483648 || Number(v)>2147483647) throw Error('Invalid integer value'); }
        else if (vt === 'double') { if (!DECIMAL_RE.test(v) || !Number.isFinite(Number(v))) throw Error('Value is not numeric'); }
        else if (vt === 'bool') { if (v !== '0' && v !== '1' && v !== 'true' && v !== 'false') throw Error('Invalid boolean value'); v = (v === 'true' || v === '1') ? '1' : '0'; }
        else { if (v.length > 128) throw Error('Value too long'); }
        if (it.options && it.options.length && !it.options.some(function (o) { return (vt==='bool'?booleanValue(o.value):o.value) === v; })) throw Error('Value is not an allowed option');
        return self.execute(wrap('vconftool get ' + shq(it.vconfKey) + ' 2>&1'), 6000).then(function (r) {
            var before = parseValue(check(r));
            if (!before) throw Error('Current state unreadable');
            if(vt==='bool'){before.value=booleanValue(before.value);if(before.value===null)throw Error('Current boolean state unreadable');}
            if (before.value === v) return { id: id, vconfKey: it.vconfKey, value: v, changed: false, verified: true };
            function set(x) { return self.execute(wrap('vconftool set -f -t ' + vt + ' ' + shq(it.vconfKey) + ' ' + shq(x)), 6000).then(function (r) { check(r); }); }
            function get() { return self.execute(wrap('vconftool get ' + shq(it.vconfKey) + ' 2>&1'), 6000).then(function (r) { var p = parseValue(check(r)); return p ? (vt==='bool'?booleanValue(p.value):p.value) : null; }); }
            return set(v).then(get).then(function (after) {
                if (after !== v) throw Error('Write not confirmed');
                return { id: id, vconfKey: it.vconfKey, previous: before.value, value: after, changed: true, verified: true, verificationScope: 'vconf storage; effect on TV not tested' };
            }).catch(function (e) {
                return set(before.value).then(get).then(function (restored) {
                    throw Error(e.message + ' · ' + (restored === before.value ? 'previous state restored' : 'restore not confirmed'));
                }, function () { throw Error(e.message + ' · restore not confirmed'); });
            });
        });
    }).finally(function () { self.busy = false; });
};

module.exports = { Catalog: Catalog, parseMenu: parseMenu, parseValue: parseValue, MENU_PATH: MENU_PATH, TYPES: TYPES, DANGER: DANGER };
