'use strict';
// The Launcher's source list: the TV's five inputs with their saved order, labels, icons and hidden flags.
//
// Pure data and text: dock.js owns the files and runs the TV read. The saved list (vetro-dock-sources.json)
// is the source of truth; the dock's inputs file is generated from it and from what the TV reports. The TV
// reports its sources two ways, and both are read: Samsung's own source list (the `.sourceCache` the Home row
// also reads, with names and artwork; on the S95C) and the source names and HDMI detection states in the
// TV's settings store (the QN90B). Samsung's list wins when it has a name; the settings store fills the gaps and
// says whether a device is connected. Anything unreadable makes that part unavailable, and the saved labels and
// port names are used instead.

var path = require('path');
var catalog = require('./dock-catalog.js');

var SLUGS = ['in-tv', 'in-hdmi1', 'in-hdmi2', 'in-hdmi3', 'in-hdmi4'];
// Samsung's SourceType: TV is 0, HDMI 1-4 are 13-16.
var PORT = {'in-tv': 0, 'in-hdmi1': 13, 'in-hdmi2': 14, 'in-hdmi3': 15, 'in-hdmi4': 16};
var DEFAULT_LABEL = {'in-tv': 'TV', 'in-hdmi1': 'HDMI 1', 'in-hdmi2': 'HDMI 2', 'in-hdmi3': 'HDMI 3', 'in-hdmi4': 'HDMI 4'};
var TYPE_ICONS = ['tv', 'hdmi', 'pc', 'console', 'streaming', 'soundbar', 'disc', 'camera'];
var MAX_LABEL = 24;
var NAME_KEY = 'db/source-list/source-name';
var STATE_KEY = 'db/source-service/detection_state_HDMI';
var SEPARATOR = '##vetro##';

// The icon an HDMI device gets from the TV's name for it (a Vetro label never changes the icon).
var RULES = [
    ['console', /playstation|xbox|nintendo|\bswitch\b/i],
    ['streaming', /fire ?tv|apple ?tv|chromecast|roku|shield|stream/i],
    ['pc', /\b(?:mac|pc|windows|linux|computer)\b/i],
    ['soundbar', /sound ?bar|home ?theat(?:er|re)|receiver|\bavr\b/i],
    ['disc', /blu-?ray|\bdvd\b|\bdisc\b/i],
    ['camera', /camera|cam/i]
];

function defaults() {
    return SLUGS.map(function (slug) { return {slug: slug, label: null, hidden: false, icon: 'auto'}; });
}

// null, or 1 to 24 characters after trimming.
function cleanLabel(value) {
    if (value != null && typeof value !== 'string') throw new Error('Invalid source label');
    var text = value == null ? '' : value.trim();
    if (!text) return null;
    if (/[\u0000-\u001f\u007f]/.test(text)) throw new Error('Source labels cannot contain control characters');
    if (text.length > MAX_LABEL) throw new Error('Source labels are limited to ' + MAX_LABEL + ' characters');
    return text;
}

// The five rows from the editor or the saved file ({sources: [...]}), checked and copied. Throws the
// first problem: the editor shows it and the saved list stays.
function normalize(value) {
    var list = Array.isArray(value) ? value : value && value.sources;
    if (!Array.isArray(list)) throw new Error('Invalid source list');
    var seen = {};
    var out = list.map(function (row) {
        row = row || {};
        if (SLUGS.indexOf(row.slug) < 0) throw new Error('Unknown source: ' + row.slug);
        if (seen[row.slug]) throw new Error('Duplicate source: ' + row.slug);
        seen[row.slug] = true;
        if (row.icon !== 'auto' && TYPE_ICONS.indexOf(row.icon) < 0) throw new Error('Unknown icon: ' + row.icon);
        return {slug: row.slug, label: cleanLabel(row.label), hidden: row.hidden === true, icon: row.icon};
    });
    if (out.length !== SLUGS.length) throw new Error('The source list needs all five sources');
    if (out.every(function (row) { return row.hidden; })) throw new Error('Keep at least one source visible');
    return out;
}

// One shell command reads the name list and the four HDMI detection states, each followed by SEPARATOR, and then
// Samsung's own source list as an `S|` line (the same read the Home row makes).
function detectionScript() {
    return ['get() { vconftool get "$1" 2>&1; printf "%s" "' + SEPARATOR + '"; }', 'get ' + NAME_KEY]
        .concat([1, 2, 3, 4].map(function (n) { return 'get ' + STATE_KEY + n; }), catalog.SOURCE_CACHE_SCRIPT, 'true').join('\n');
}

function unavailable() {
    return {available: false, error: 'Source detection is unavailable', names: {}, states: {}, cache: {}};
}

// vconftool's own sed turns "String: <A>: <B>" into "<B> (String: <A>)", splitting at the last ": ".
// Undo that, so the JSON arrives whole.
function unsed(value) {
    var m = /^(.*) \(String: ([\s\S]*)\)$/.exec(value);
    return m ? m[2] + ': ' + m[1] : value;
}

function sectionValue(section, key) {
    var prefix = key + ', value = ';
    section = String(section || '').trim();
    if (section.indexOf(prefix) !== 0) throw new Error('Unreadable ' + key);
    return unsed(section.slice(prefix.length));
}

// The command's output: names by SourceType and "detected"/"not_detected" by SourceType from the settings store,
// and Samsung's own source list by port. Each part that cannot be read is left empty; the detection is unavailable
// only when neither part gave anything. It never throws.
function parseDetection(text) {
    var sections = String(text || '').split(SEPARATOR), names = {}, states = {}, cache = {}, store = false;
    try {
        var value = sectionValue(sections[0], NAME_KEY), found = {}, seen = {};
        JSON.parse(value.slice(value.indexOf('['), value.lastIndexOf(']') + 1)).forEach(function (entry) {
            // Two entries for one source: the last one wins, as in the TV's own list.
            if (entry.SourceType >= 13 && entry.SourceType <= 16) found[entry.SourceType] = {detected: entry.DetectedName, edit: entry.EditName};
        });
        // "detected,autodetection": the state is the part before the comma.
        for (var n = 1; n <= 4; n++) seen[12 + n] = sectionValue(sections[n], STATE_KEY + n).split(',')[0].trim();
        names = found; states = seen; store = true;
    } catch (e) { /* the settings store is unreadable on this TV */ }
    try { cache = catalog.parse(sections[5] || '').sources || {}; } catch (e) { cache = {}; }
    var cached = Object.keys(cache).length > 0;
    if (!store && !cached) return unavailable();
    return {available: true, error: null, names: names, states: states, cache: cache, store: store};
}

// The TV's own name for a port, or ''. Samsung's source list first (its edit name, else the name detected over
// CEC), then the settings store (its edit name when it is not the port default, else the detected one). Control
// characters would break the generated file, so they become spaces, and the dock drops a source whose label is
// over 40 characters, so the name is cut to that.
function tvName(slug, detection) {
    if (slug === 'in-tv' || !detection.available) return '';
    var meta = (detection.cache || {})['HDMI' + (PORT[slug] - 12)] || {};
    var named = catalog.cleanLabel(meta.EditName || meta.DetectedName, '');
    if (named) return named;
    var entry = detection.names[PORT[slug]];
    if (!entry) return '';
    var edit = catalog.cleanLabel(entry.edit, '');
    return edit && edit !== DEFAULT_LABEL[slug] ? edit : catalog.cleanLabel(entry.detected, '');
}

// What the dock shows when the user typed nothing: the port, with the TV's name after it when it has one
// ("HDMI 2 - Fire TV"), as the Launcher has always shown it.
function autoLabel(slug, name) {
    var base = DEFAULT_LABEL[slug];
    return !name || name === base || slug === 'in-tv' ? base : catalog.cleanLabel(base + ' - ' + name, base);
}

function classify(name) {
    for (var i = 0; i < RULES.length; i++) if (RULES[i][1].test(name)) return RULES[i][0];
    return 'hdmi';
}

function iconFile(icon) {
    return icon === 'tv' ? 'in-tv.png' : 'input-' + icon + '.png';
}

// The saved list joined with the TV's report, in saved order. `label` and `icon` are what the dock shows;
// `labelOverride` and `iconChoice` are what is saved. `present` is null when the TV did not say. With
// options.useSourceImages an HDMI row whose icon is left on Auto shows Samsung's own artwork (`artwork`, a path on
// the TV) in place of the packaged type icon; an icon the user chose always wins.
function rows(list, detection, options) {
    var tv = catalog.sourceEntries({sources: detection.cache || {}}, options);
    return list.map(function (row) {
        var name = tvName(row.slug, detection), auto = autoLabel(row.slug, name);
        var artwork = row.icon === 'auto' ? tv[SLUGS.indexOf(row.slug)].icon : null;
        return {
            slug: row.slug,
            label: row.label == null ? auto : row.label,
            labelOverride: row.label,
            autoLabel: auto,
            source: PORT[row.slug],
            hidden: row.hidden,
            icon: row.icon !== 'auto' ? row.icon : row.slug === 'in-tv' ? 'tv' : classify(name),
            iconChoice: row.icon,
            artwork: artwork,
            present: !detection.available ? null : row.slug === 'in-tv' ? true : detection.states && detection.states[PORT[row.slug]] ? detection.states[PORT[row.slug]] === 'detected' : null
        };
    });
}

// The dock's inputs file: visible rows in saved order. The fourth field is the native parser's unused
// fallback app id; the fifth is the icon's absolute path, in this package or Samsung's. The dock skips a whole
// line whose icon path is outside the places it accepts (the same whitelist as the app list), so the column is
// left empty then and the dock uses its own icon for the port.
function tsv(list, iconDir) {
    var lines = ['# the inputs panel (Up on the dock). Generated from vetro-dock-sources.json; do not edit.'];
    list.forEach(function (row) {
        if (row.hidden) return;
        var icon = path.join(iconDir, iconFile(row.icon));
        // Samsung's artwork when it is on and passed the same path whitelist; else the packaged icon.
        var shown = row.artwork && catalog.iconPathOk(row.artwork) ? row.artwork : catalog.iconPathOk(icon) ? icon : '';
        lines.push([row.slug, row.label, 'source:' + row.source, '', shown].join('\t'));
    });
    return lines.join('\n') + '\n';
}

module.exports = {
    SLUGS: SLUGS, TYPE_ICONS: TYPE_ICONS, defaults: defaults, normalize: normalize, detectionScript: detectionScript,
    parseDetection: parseDetection, unavailable: unavailable, iconFile: iconFile, rows: rows, tsv: tsv
};
