'use strict';
var path = require('path');
var control = require('./control.js');
var SOURCE_HELPER = path.join(__dirname, '..', 'native', 'dock', 'tvlauncher-dotnet.dll');

// The monitor's physical inputs come from Samsung Home's source inventory. A
// successful app-control launch is not evidence that the input changed: select
// always reads the selected source back before reporting success.
var CACHE_PATHS = [
    '/opt/usr/home/owner/apps_rw/com.samsung.tv.csfs/data/.sourceCache',
    '/opt/usr/home/owner/apps_rw/com.samsung.tv.home.media/data/.sourceCache'
];
var MAX_CACHE_BYTES = 262144;
var MAX_ITEMS = 16;
var ICON_ROOT = '/usr/apps/com.samsung.tv.theme-resource/shared/res/org.tizen.menu/Settings_Popup/device_icon/';
var SOURCE_ICON_RE = /^\/(?:usr\/apps|opt\/usr\/apps)\/[A-Za-z0-9_.\/-]+\.(?:png|svg|webp)$/;
var ARTWORK_RE = /^(?:\/opt\/share\/webappservice\/apps_icon|\/opt\/usr\/apps|\/usr\/apps|\/usr\/share\/canalysis\/Icon)\/[A-Za-z0-9_.\/-]{1,160}\.png$/;
var HDMI_RE = /^HDMI([1-4])(?:\/\d+)?$/i;
var DP_RE = /^(?:DISPLAYPORT|DP)(?:\/\d+)?$/i;
var USB_C_RE = /^(?:USB_C|USB-C|USBC|TYPE_C)(?:\/\d+)?$/i;
var TV_RE = /^TV(?:\/\d+)?$/i;
var SAFE_CACHE_KEY_RE = /^(?:TV|HDMI[1-4]|DISPLAYPORT|DP|USB_C|USB-C|USBC|TYPE_C)(?:\/\d+)?$/i;
var MEDIA_SOURCE_RE = /^(?:DLNA|USB)\//i;
var CAMERA_SOURCE_RE = /^USBCAM(?:\/\d+)?$/i;
var CONTROL_RE = /[\u0000-\u001f\u007f]/g;
var SPACE_RE = /\s+/g;
var CURRENT_RE = /memory\/system\/source_type[^\n]*(?:Int32:\s*|value\s*=\s*)(-?\d+)/;
var INPUT_KEY_RE = /^KEY_INPUT_(\d{1,5})$/;
var META_FIELDS = ['SourceType', 'ConnectionState', 'EditName', 'DetectedName', 'IconPath', 'OrgIconPath', 'LauncherFocusedIconPath', 'LauncherUnfocusedIconPath'];

function integer(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }
function q(v) { return "'" + String(v).replace(/'/g, "'\\''") + "'"; }
function clean(v, fallback) {
    return typeof v === 'string' ? v.replace(CONTROL_RE, ' ').replace(SPACE_RE, ' ').trim().slice(0, 40).trim() || fallback : fallback;
}
function sourceIconOk(p) {
    return typeof p === 'string' && p.length <= 240 && SOURCE_ICON_RE.test(p) && p.indexOf('..') < 0 && p.indexOf('//') < 0;
}
// Both Homes may keep a source list, and on newer firmware the one in csfs/data can be an old copy without the names the user gave the
// inputs (#297). Each list arrives with its modification time: the older first, and an input the newer one has replaces every older
// entry of the same source type, whatever its key ("HDMI1" in an old copy, "HDMI1/0" once a device was recognised).
function newestWins(files) {
    var merged = {};
    (files || []).map(function (f, i) { return {at: f.at || 0, i: i, sources: f.sources}; }).sort(function (a, b) { return a.at - b.at || a.i - b.i; })
        .forEach(function (f) {
            var keys = Object.keys(f.sources), types = {};
            keys.forEach(function (k) { var v = f.sources[k]; if (v && typeof v === 'object' && typeof v.SourceType === 'number') types[v.SourceType] = true; });
            Object.keys(merged).forEach(function (k) { var v = merged[k]; if (v && types[v.SourceType]) delete merged[k]; });
            keys.forEach(function (k) { merged[k] = f.sources[k]; });
        });
    return merged;
}
function mergeCaches(caches) {
    var result = {};
    (Array.isArray(caches) ? caches : [caches]).forEach(function (cache) {
        cache = cache && cache.sources || cache;
        if (!cache || typeof cache !== 'object' || Array.isArray(cache)) return;
        if (cache._otherInputs === true) result._otherInputs = true;
        Object.keys(cache).slice(0, 512).forEach(function (key) {
            if (!cache[key] || typeof cache[key] !== 'object' || Array.isArray(cache[key])) return;
            if (!SAFE_CACHE_KEY_RE.test(key)) {
                // Unknown source metadata must not look like a complete three-port
                // display. Keep only a flag; no media ids or private paths escape.
                // Home also lists the G8's USB camera tile (USBCAM, type 67).
                // It is not a physical display input. Match
                // both identities so an unrecognized source still stays unknown.
                var camera = CAMERA_SOURCE_RE.test(key) && cache[key].SourceType === 67;
                if (Object.prototype.hasOwnProperty.call(cache[key], 'SourceType') && !MEDIA_SOURCE_RE.test(key) && !camera) result._otherInputs = true;
                return;
            }
            // Only physical sources survive this merge: DLNA ids, USB paths and
            // unrelated Home metadata never enter the public input inventory.
            var meta = result[key] || {};
            META_FIELDS.forEach(function (field) {
                if (Object.prototype.hasOwnProperty.call(cache[key], field)) meta[field] = cache[key][field];
            });
            result[key] = meta;
        });
    });
    return result;
}
function isMonitor(sources) {
    // Match the complete G8 port layout, not every device with a DP/USB-C
    // entry. Other monitors and TVs keep Vetro's existing defaults.
    var ports = {}, keys = Object.keys(sources || {});
    var matched = keys.every(function (key) {
        var f = family(key), meta = sources[key];
        if (!f || f.family === 'tv' || !validType(f.family, meta.SourceType) || f.family === 'hdmi' && meta.SourceType !== 12 + f.port) return false;
        if (Object.prototype.hasOwnProperty.call(ports, f.family) && ports[f.family] !== meta.SourceType) return false;
        ports[f.family] = meta.SourceType;
        return true;
    });
    return matched && Object.keys(ports).length === 3 && ports.hdmi >= 13 && ports.hdmi <= 16 && ports.displayport === 33 && ports.usbc === 41;
}
function family(key) {
    var hdmi = HDMI_RE.exec(key);
    return hdmi ? {family: 'hdmi', port: +hdmi[1]} : DP_RE.test(key) ? {family: 'displayport', port: null}
        : USB_C_RE.test(key) ? {family: 'usbc', port: null} : TV_RE.test(key) ? {family: 'tv', port: null} : null;
}
function validType(f, n) {
    // These are observed Samsung SourceType values, not guesses for missing
    // ports: TV/HDMI on TVs, DisplayPort and USB-C in the G8's own cache.
    return integer(n) && (f === 'tv' ? n === 0 : f === 'hdmi' ? n >= 13 && n <= 16 : f === 'displayport' ? n === 33 : f === 'usbc' && n === 41);
}
// Samsung's device_icon folder holds PNG files up to the 2024 firmware and WebP files from the 2025 Tizen 9 firmware (stock package).
function fallbackIcons(f, port) {
    var name = f === 'tv' ? 'tv' : f === 'hdmi' ? 'hdmi' + port : f === 'displayport' ? 'dpport' : null;
    return name ? ['.png', '.webp'].map(function (ext) { return ICON_ROOT + 'r_icon_device_s_' + name + ext; }) : [];
}
function normalize(caches) {
    var sources = mergeCaches(caches), monitor = isMonitor(sources), found = {};
    Object.keys(sources).sort().forEach(function (key) {
        var f = family(key), meta = sources[key], n = meta.SourceType;
        if (!f || !validType(f.family, n) || f.family === 'hdmi' && n !== 12 + f.port) return;
        // The entry that carries a name wins (the user's name for the input sits on "HDMI2/0" once a device was recognised), then a
        // plain port entry over an activity on the same port. Activity entries remain useful on firmwares which only store HDMI2/0.
        var rank = (meta.EditName || meta.DetectedName ? 2 : 0) + (key.indexOf('/') < 0 ? 1 : 0);
        if (found[n] && found[n].rank >= rank) return;
        found[n] = {sourceType: n, family: f.family, port: f.port, meta: meta, rank: rank};
    });
    if (!monitor) {
        // USB-C is added only for the verified three-port layout. The original
        // launcher supports TV/HDMI 1-4 plus a discovered DisplayPort source.
        delete found[41];
        [0, 13, 14, 15, 16].forEach(function (n) {
            var key = n === 0 ? 'TV' : 'HDMI' + (n - 12);
            if (!found[n]) found[n] = {sourceType: n, family: n === 0 ? 'tv' : 'hdmi', port: n === 0 ? null : n - 12, meta: sources[key] || {}};
        });
    }
    var rows = Object.keys(found).map(function (n) { return found[n]; }).sort(function (a, b) { return a.sourceType - b.sourceType; });
    var hdmiCount = rows.filter(function (r) { return r.family === 'hdmi'; }).length;
    return rows.slice(0, MAX_ITEMS).map(function (row) {
        var meta = row.meta, base = row.family === 'tv' ? 'TV' : row.family === 'hdmi' ? (monitor && hdmiCount === 1 ? 'HDMI' : 'HDMI ' + row.port)
            : row.family === 'displayport' ? 'DisplayPort' : 'USB-C';
        var name = clean(meta.EditName || meta.DetectedName, base);
        var candidates = monitor ? [meta.IconPath, meta.OrgIconPath, meta.LauncherUnfocusedIconPath, meta.LauncherFocusedIconPath].filter(sourceIconOk)
            .filter(function (p, i, all) { return all.indexOf(p) === i; }) : [];
        var icon = candidates[0] || null;
        var displayIcon = [meta.LauncherUnfocusedIconPath, meta.IconPath, meta.OrgIconPath].filter(function (p) {
            return typeof p === 'string' && ARTWORK_RE.test(p) && p.indexOf('..') < 0 && p.indexOf('//') < 0;
        })[0] || null;
        return {sourceType: row.sourceType, family: row.family, port: row.port, label: base, name: name,
            inputLabel: row.family === 'tv' || name === base ? base : clean(base + ' - ' + name, base), sourceIcon: icon, sourceIcons: candidates, displayIcon: displayIcon,
            connected: typeof meta.ConnectionState === 'boolean' ? meta.ConnectionState : null,
            key: monitor ? 'KEY_INPUT_' + row.sourceType : row.family === 'tv' ? 'KEY_TV' : row.family === 'hdmi' ? 'KEY_HDMI' + row.port : row.family === 'displayport' ? 'KEY_DISPLAYPORT' : null,
            slug: row.family === 'hdmi' ? 'in-hdmi' + row.port : row.family === 'displayport' ? 'in-dp' : 'in-' + row.family,
            rowKey: 'source:' + row.sourceType};
    });
}
function readCurrentCommand() {
    return 'buxton2ctl get memory memory/system/source_type 2>/dev/null || vconftool get memory/system/source_type 2>/dev/null';
}
function parseCurrent(text) {
    var m = CURRENT_RE.exec(String(text || ''));
    return m && integer(+m[1]) ? +m[1] : null;
}
function resultOk(r, message) {
    if (!r || r.exit_code || r.timed_out) throw new Error(message);
    return String(r.stdout || '');
}
function readCurrent(execute) {
    return execute(readCurrentCommand(), 5000).then(function (r) { return parseCurrent(resultOk(r, 'Selected input is unavailable')); });
}
function readCommand() {
    return CACHE_PATHS.map(function (p) {
        return 'if [ -r ' + q(p) + ' ]; then printf "CACHE|%s|" "$(stat -c %Y ' + q(p) + ' 2>/dev/null || echo 0)"; head -c ' + (MAX_CACHE_BYTES + 1) + ' ' + q(p) +
            ' | base64 | tr -d "\\n"; printf "\\n"; fi';
    }).concat([readCurrentCommand(), 'true']).join('\n');
}
function parseRead(text) {
    var caches = [];
    String(text || '').split('\n').forEach(function (line) {
        var m = /^CACHE\|(?:(\d{1,12})\|)?([A-Za-z0-9+/=]+)\r?$/.exec(line);
        if (!m) return;
        try {
            var bytes = Buffer.from(m[2], 'base64');
            if (bytes.length > MAX_CACHE_BYTES) return;
            var value = JSON.parse(bytes.toString('utf8'));
            if (value && typeof value === 'object' && !Array.isArray(value)) caches.push({at: m[1] ? +m[1] : 0, sources: value});
        } catch (e) { /* Another Home's readable cache may still be valid. */ }
    });
    if (!caches.length) throw new Error('Samsung input inventory is unavailable');
    return {sources: mergeCaches(newestWins(caches)), currentSourceType: parseCurrent(text)};
}
function read(execute) {
    var inventory = Promise.resolve().then(function () { return execute(readCommand(), 10000); }).then(function (r) {
        return parseRead(resultOk(r, 'Samsung input inventory is unavailable'));
    });
    return inventory.then(function (parsed) {
        var items = normalize(parsed.sources), icons = [];
        items.forEach(function (item) {
            fallbackIcons(item.family, item.port).forEach(function (fallback) { if (item.sourceIcons.indexOf(fallback) < 0) item.sourceIcons.push(fallback); });
            item.sourceIcons.forEach(function (icon) { if (icons.indexOf(icon) < 0) icons.push(icon); });
        });
        var command = icons.map(function (icon, i) { return '[ ! -f ' + q(icon) + ' ] || echo ICON_' + i; }).concat(['true']).join('\n');
        return execute(command, 5000).then(function (r) {
            var output = resultOk(r, 'Input icons could not be checked').split(/\r?\n/);
            items.forEach(function (item) {
                item.sourceIcon = item.sourceIcons.filter(function (icon) { return output.indexOf('ICON_' + icons.indexOf(icon)) >= 0; })[0] || null;
                delete item.sourceIcons;
            });
            return {available: true, monitor: isMonitor(parsed.sources), items: items, currentSourceType: parsed.currentSourceType};
        });
    }, function () {
        // Upstream's TV/HDMI choices do not depend on a readable Home cache.
        // The service refuses this fallback for a previously detected G8 layout.
        return readCurrent(execute).catch(function () { return null; }).then(function (current) {
            return {available: false, monitor: false, items: normalize({}), currentSourceType: current,
                warning: 'Input inventory unavailable; using Vetro default inputs.'};
        });
    });
}
function command(item) {
    if (!item || !validType(item.family, item.sourceType) || !sourceIconOk(item.sourceIcon)) throw new Error('A verified input icon is required');
    var n = String(item.sourceType);
    // Use the same app-control API as the launcher. This one-shot mode runs
    // before the dock's instance lock or window setup and works with the dock off.
    return 'HOME=/home/owner XDG_RUNTIME_DIR=/run /usr/bin/dotnet ' + q(SOURCE_HELPER) +
        ' --switch-source ' + n + ' ' + q(item.label) + ' ' + q(item.sourceIcon);
}
function select(execute, type, options) {
    options = options || {};
    if (!integer(type)) return Promise.reject(new Error('Invalid input'));
    return read(execute).then(function (inventory) {
        if (!inventory.available && options.monitor === true) throw new Error('Samsung input inventory is unavailable');
        var item = inventory.items.filter(function (row) { return row.sourceType === type; })[0];
        if (!item) throw new Error('That input is not available on this device');
        // A TV's own keys go as before. A DisplayPort on a device that is not the G8 layout uses the verified native request when its
        // icon is there, and the Remapper's tv-viewer command (#303) when it is not.
        var legacy = !inventory.monitor && item.key && (item.family !== 'displayport' || !item.sourceIcon) && control.injectCommand(control.nativeKey(item.key));
        if (!legacy && !item.sourceIcon) throw new Error('The input icon is missing on this firmware');
        return execute(legacy || command(item), 10000).then(function (r) {
            resultOk(r, 'Input selection failed');
            var attempts = 0;
            function verify() {
                return readCurrent(execute).then(function (selected) {
                    if (selected === type) return {ok: true, changed: true, sourceType: type, previousSourceType: inventory.currentSourceType,
                        currentSourceType: selected, selected: item, items: inventory.items};
                    if (++attempts >= 6) throw new Error('The display did not confirm the selected input');
                    return new Promise(function (resolve) { setTimeout(resolve, 250); }).then(verify);
                });
            }
            return verify();
        });
    });
}
function typeForKey(key) { var m = INPUT_KEY_RE.exec(String(key || '')); return m ? +m[1] : null; }
module.exports = {normalize: normalize, mergeCaches: mergeCaches, newestWins: newestWins, isMonitor: isMonitor, sourceIconOk: sourceIconOk,
    read: read, select: select, readCurrent: readCurrent, parseCurrent: parseCurrent, readCommand: readCommand, parseRead: parseRead,
    command: command, typeForKey: typeForKey};
