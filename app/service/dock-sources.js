'use strict';
// The Launcher's source list: the TV's five inputs with their saved order, labels, icons and hidden flags.
//
// Pure data and text: dock.js owns the files and runs the TV read. The saved list (vetro-dock-sources.json)
// is the source of truth; the dock's inputs file is generated from it and from what the TV reports over
// HDMI-CEC. Only the QN90B's payload has been inspected; anything unreadable makes detection unavailable,
// and the saved labels and port names are used instead.

var path = require('path');

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
    var text = value == null ? '' : String(value).trim();
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

// One shell command reads the name list and the four HDMI detection states, separated by SEPARATOR.
function detectionScript() {
    return ['get() { vconftool get "$1" 2>&1; printf "%s" "' + SEPARATOR + '"; }', 'get ' + NAME_KEY]
        .concat([1, 2, 3, 4].map(function (n) { return 'get ' + STATE_KEY + n; }), 'true').join('\n');
}

function unavailable() {
    return {available: false, error: 'Source detection is unavailable', names: {}, states: {}};
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

// The command's output: names by SourceType and "detected"/"not_detected" by SourceType. Anything it
// cannot read makes the whole detection unavailable; it never throws.
function parseDetection(text) {
    var sections = String(text || '').split(SEPARATOR), names = {}, states = {};
    try {
        var value = sectionValue(sections[0], NAME_KEY);
        JSON.parse(value.slice(value.indexOf('['), value.lastIndexOf(']') + 1)).forEach(function (entry) {
            // Two entries for one source: the last one wins, as in the TV's own list.
            if (entry.SourceType >= 13 && entry.SourceType <= 16) names[entry.SourceType] = {detected: entry.DetectedName, edit: entry.EditName};
        });
        // "detected,autodetection": the state is the part before the comma.
        for (var n = 1; n <= 4; n++) states[12 + n] = sectionValue(sections[n], STATE_KEY + n).split(',')[0].trim();
    } catch (e) { return unavailable(); }
    return {available: true, error: null, names: names, states: states};
}

// The TV's name for a port: Samsung's edit when it is not the port default, else the name detected over
// CEC, else ''. Control characters would break the generated file, so they become spaces.
function tvName(slug, detection) {
    if (slug === 'in-tv') return 'TV';
    var entry = detection.available ? detection.names[PORT[slug]] : null;
    if (!entry) return '';
    function clean(value) { return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim(); }
    var edit = clean(entry.edit);
    return edit && edit !== DEFAULT_LABEL[slug] ? edit : clean(entry.detected);
}

function classify(name) {
    for (var i = 0; i < RULES.length; i++) if (RULES[i][1].test(name)) return RULES[i][0];
    return 'hdmi';
}

function iconFile(icon) {
    return icon === 'tv' ? 'in-tv.png' : 'input-' + icon + '.png';
}

// The saved list joined with the TV's report, in saved order. `label` and `icon` are what the dock shows;
// `labelOverride` and `iconChoice` are what is saved. `present` is null when detection is unavailable.
function rows(list, detection) {
    return list.map(function (row) {
        var name = tvName(row.slug, detection), auto = name || DEFAULT_LABEL[row.slug];
        return {
            slug: row.slug,
            label: row.label == null ? auto : row.label,
            labelOverride: row.label,
            autoLabel: auto,
            source: PORT[row.slug],
            hidden: row.hidden,
            icon: row.icon !== 'auto' ? row.icon : row.slug === 'in-tv' ? 'tv' : classify(name),
            iconChoice: row.icon,
            present: !detection.available ? null : row.slug === 'in-tv' || detection.states[PORT[row.slug]] === 'detected'
        };
    });
}

// The dock's inputs file: visible rows in saved order. The fourth field is the native parser's unused
// fallback app id; the fifth is the icon's absolute path inside this package.
function tsv(list, iconDir) {
    var lines = ['# the inputs panel (Up on the dock). Generated from vetro-dock-sources.json; do not edit.'];
    list.forEach(function (row) {
        if (!row.hidden) lines.push([row.slug, row.label, 'source:' + row.source, '', path.join(iconDir, iconFile(row.icon))].join('\t'));
    });
    return lines.join('\n') + '\n';
}

module.exports = {
    SLUGS: SLUGS, TYPE_ICONS: TYPE_ICONS, defaults: defaults, normalize: normalize, detectionScript: detectionScript,
    parseDetection: parseDetection, unavailable: unavailable, iconFile: iconFile, rows: rows, tsv: tsv
};
