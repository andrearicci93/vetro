'use strict';
// The Launcher's source list: the TV's five inputs, their saved order, labels and type icons.
//
// This module is pure data and text. dock.js owns the files, runs the TV reads and starts the dock;
// nothing here touches the TV or the disk. The saved list (vetro-dock-sources.json) is the source of
// truth; the dock's inputs file is generated from it and from what the TV reports over HDMI-CEC.
//
// The stored value in db/source-list/source-name is Samsung's own JSON with a small binary header.
// vconftool's display of a value containing ": " is mangled by its own sed, so the reader undoes that
// before parsing. Only the QN90B has been inspected; an unreadable or unknown payload is reported as
// unavailable and the saved labels and port defaults are used.

var path = require('path');

var VERSION = 1;
var SLUGS = ['in-tv', 'in-hdmi1', 'in-hdmi2', 'in-hdmi3', 'in-hdmi4'];
// Samsung's SourceType: TV is 0, HDMI 1-4 are 13-16.
var PORT = {'in-tv': 0, 'in-hdmi1': 13, 'in-hdmi2': 14, 'in-hdmi3': 15, 'in-hdmi4': 16};
var DEFAULT_LABEL = {'in-tv': 'TV', 'in-hdmi1': 'HDMI 1', 'in-hdmi2': 'HDMI 2', 'in-hdmi3': 'HDMI 3', 'in-hdmi4': 'HDMI 4'};
var ICONS = ['auto', 'tv', 'hdmi', 'pc', 'console', 'streaming', 'soundbar', 'disc', 'camera'];
var TYPE_ICONS = ['tv', 'hdmi', 'pc', 'console', 'streaming', 'soundbar', 'disc', 'camera'];
var MAX_LABEL = 24;
var MAX_TSV_LABEL = 40;
var SOURCE_NAME_KEY = 'db/source-list/source-name';
var STATE_KEY = 'db/source-service/detection_state_HDMI';
var SEPARATOR = '##vetro##';

// What the editor classifies an HDMI device as. Names are the TV's own (Samsung's edit, else the
// detected name); a Vetro label never changes the icon.
var RULES = [
    ['console', /playstation|xbox|nintendo|\bswitch\b/i],
    ['streaming', /fire ?tv|apple ?tv|chromecast|roku|shield|stream/i],
    ['pc', /\b(?:mac|pc|windows|linux|computer)\b/i],
    ['soundbar', /sound ?bar|home ?theat(?:er|re)|receiver|\bavr\b/i],
    ['disc', /blu-?ray|\bdvd\b|\bdisc\b/i],
    ['camera', /camera|cam/i]
];

function defaults() {
    return {version: VERSION, sources: SLUGS.map(function (slug) {
        return {slug: slug, label: null, hidden: false, icon: 'auto'};
    })};
}

// null, or 1 to 24 UTF-16 code units after trimming. An empty value is null; the JSON never holds "".
function cleanLabel(value) {
    if (value == null) return null;
    var text = String(value).trim();
    if (!text) return null;
    if (/[\u0000-\u001f\u007f]/.test(text)) throw new Error('Source labels cannot contain control characters');
    if (text.length > MAX_LABEL) throw new Error('Source labels are limited to ' + MAX_LABEL + ' characters');
    return text;
}

// A saved list, or the five stored-shape rows, checked and returned in a fresh object. Throws the
// first problem: the editor shows the reason and the old list stays.
function normalize(value) {
    if (!value || typeof value !== 'object') throw new Error('Invalid source list');
    var list = Array.isArray(value) ? value : value.sources;
    if ((Array.isArray(value) ? VERSION : value.version) !== VERSION) throw new Error('Unknown source list version');
    if (!Array.isArray(list)) throw new Error('Invalid source list');
    var seen = {}, out = [];
    list.forEach(function (row) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid source row');
        if (typeof row.slug !== 'string' || SLUGS.indexOf(row.slug) < 0) throw new Error('Unknown source: ' + (row && row.slug));
        if (seen[row.slug]) throw new Error('Duplicate source: ' + row.slug);
        seen[row.slug] = true;
        if (typeof row.hidden !== 'boolean') throw new Error('Invalid hidden flag for ' + row.slug);
        if (typeof row.icon !== 'string' || ICONS.indexOf(row.icon) < 0) throw new Error('Unknown icon: ' + row.icon);
        out.push({slug: row.slug, label: cleanLabel(row.label), hidden: row.hidden, icon: row.icon});
    });
    SLUGS.forEach(function (slug) { if (!seen[slug]) throw new Error('Missing source: ' + slug); });
    if (out.every(function (row) { return row.hidden; })) throw new Error('Keep at least one source visible');
    return {version: VERSION, sources: out};
}

// The old editable inputs file, in its own order. Old slugs that are not one of the five are ignored,
// a duplicate takes the first row, and a slot the old file did not have is appended in canonical order.
// A label equal to the exact port default cannot be told apart from the default, so it becomes automatic.
function migrate(text) {
    var order = [], bySlug = {};
    String(text || '').split('\n').forEach(function (line) {
        var fields = line.replace(/\r$/, '').split('\t');
        var slug = (fields[0] || '').trim();
        if (!slug || slug.charAt(0) === '#' || bySlug[slug] || SLUGS.indexOf(slug) < 0) return;
        var label = String(fields[1] == null ? '' : fields[1]).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
        if (label === DEFAULT_LABEL[slug]) label = '';
        bySlug[slug] = {slug: slug, label: label ? label.slice(0, MAX_LABEL) : null, hidden: false, icon: 'auto'};
        order.push(slug);
    });
    // A slot the old file did not have is appended in canonical order.
    SLUGS.forEach(function (slug) {
        if (!bySlug[slug]) { bySlug[slug] = {slug: slug, label: null, hidden: false, icon: 'auto'}; order.push(slug); }
    });
    return {version: VERSION, sources: order.map(function (slug) { return bySlug[slug]; })};
}

function detectionScript() {
    return [
        'get() { vconftool get "$1" 2>&1; printf "%s" "' + SEPARATOR + '"; }',
        'get ' + SOURCE_NAME_KEY,
        'get ' + STATE_KEY + '1',
        'get ' + STATE_KEY + '2',
        'get ' + STATE_KEY + '3',
        'get ' + STATE_KEY + '4',
        'true'
    ].join('\n');
}

function unavailable() {
    return {available: false, error: 'Source detection is unavailable', names: {}, states: {}};
}

// vconftool's own sed turns "String: <A>: <B>" into "<B> (String: <A>)", where the greedy match splits
// at the last ": ". Undo that exact inverse so the JSON arrives whole.
function unsed(value) {
    var m = /^(.*) \(String: ([\s\S]*)\)$/.exec(value);
    return m ? m[2] + ': ' + m[1] : value;
}

function sectionValue(section, key) {
    var prefix = key + ', value = ';
    if (section.indexOf(prefix) !== 0) return null;
    return unsed(section.slice(prefix.length));
}

function detectionName(entry) {
    if (!entry) return {detected: '', edit: ''};
    return {detected: entry.DetectedName, edit: entry.EditName};
}

// The one shell command's output: the source-name section, then HDMI 1-4. Any unreadable section, an
// unparseable payload or a shape we do not know makes the whole detection unavailable; it never throws.
function parseDetection(text) {
    var sections = String(text || '').split(SEPARATOR);
    if (sections.length < 5) return unavailable();
    var source = sectionValue(sections[0].trim(), SOURCE_NAME_KEY);
    if (source == null) return unavailable();
    var from = source.indexOf('['), to = source.lastIndexOf(']');
    if (from < 0 || to <= from) return unavailable();
    var entries;
    try { entries = JSON.parse(source.slice(from, to + 1)); } catch (e) { return unavailable(); }
    if (!Array.isArray(entries)) return unavailable();
    var names = {};
    for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return unavailable();
        if (typeof entry.SourceType !== 'number' || !isFinite(entry.SourceType)) return unavailable();
        if ((entry.DetectedName != null && typeof entry.DetectedName !== 'string') ||
            (entry.EditName != null && typeof entry.EditName !== 'string')) return unavailable();
        // Two entries for one source: the last one wins, as the TV's own list does.
        if (entry.SourceType >= 13 && entry.SourceType <= 16) names[entry.SourceType] = detectionName(entry);
    }
    var states = {};
    for (var n = 1; n <= 4; n++) {
        var state = sectionValue(sections[n].trim(), STATE_KEY + n);
        if (state == null) return unavailable();
        // vconftool shows "detected,autodetection": the state is the part before the comma.
        states[PORT['in-hdmi' + n]] = state.split(',')[0].trim();
    }
    return {available: true, error: null, names: names, states: states};
}

// The TV's name for a port, ignoring a Vetro label: Samsung's edit when it is not the port default,
// then the name detected over CEC.
function tvName(slug, detection) {
    if (slug === 'in-tv') return 'TV';
    var entry = detection && detection.available ? detection.names[PORT[slug]] : null;
    // A tab or line break in a TV name would break the generated row, so it never reaches the file.
    function name(value) { return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim(); }
    var edit = entry ? name(entry.edit) : '';
    if (edit && edit !== DEFAULT_LABEL[slug]) return edit;
    return entry ? name(entry.detected) : '';
}

function classify(name) {
    var text = String(name || '');
    for (var i = 0; i < RULES.length; i++) if (RULES[i][1].test(text)) return RULES[i][0];
    return 'hdmi';
}

function iconFile(icon) {
    if (icon === 'tv') return 'in-tv.png';
    if (icon === 'hdmi') return 'input-hdmi.png';
    return 'input-' + icon + '.png';
}

function shorten(label) {
    var text = String(label);
    if (text.length <= MAX_TSV_LABEL) return text;
    var cut = MAX_TSV_LABEL - 1, head = text.slice(0, cut);
    // Never leave half of a surrogate pair before the ellipsis.
    if (/[\uD800-\uDBFF]$/.test(head)) head = text.slice(0, cut - 1);
    return head + '\u2026';
}

// The saved list joined with the TV's report, one row per source, in saved order. `label` and `icon`
// are effective, `labelOverride` and `iconChoice` are stored, and `present` is null when detection is
// unavailable so the editor can show the notice instead of five "no device" rows.
function rows(state, detection) {
    var available = !!(detection && detection.available);
    var visible = state.sources.filter(function (row) { return !row.hidden; });
    return state.sources.map(function (row) {
        var auto = slugAutoLabel(row.slug, detection);
        var autoIcon = row.slug === 'in-tv' ? 'tv' : classify(tvName(row.slug, detection));
        var icon = row.icon === 'auto' ? autoIcon : row.icon;
        var index = visible.indexOf(row);
        return {
            slug: row.slug,
            label: row.label == null ? auto : row.label,
            labelOverride: row.label,
            autoLabel: auto,
            source: PORT[row.slug],
            hidden: row.hidden,
            icon: icon,
            iconChoice: row.icon,
            present: available ? (row.slug === 'in-tv' ? true : detection.states[PORT[row.slug]] === 'detected') : null,
            canMoveUp: index > 0,
            canMoveDown: index >= 0 && index < visible.length - 1,
            canHide: index >= 0 && visible.length > 1
        };
    });
}

function slugAutoLabel(slug, detection) {
    return tvName(slug, detection) || DEFAULT_LABEL[slug];
}

// The dock's inputs file: visible rows only, in saved order. The fourth field is the native parser's
// unused fallback app id; the fifth is the absolute icon path inside this package.
function tsv(list, iconDir) {
    var lines = ['# the inputs panel (Up on the dock). Generated from vetro-dock-sources.json; do not edit.'];
    list.filter(function (row) { return !row.hidden; }).forEach(function (row) {
        lines.push([row.slug, shorten(row.label), 'source:' + row.source, '', path.join(iconDir, iconFile(row.icon))].join('\t'));
    });
    return lines.join('\n') + '\n';
}

module.exports = {
    VERSION: VERSION, SLUGS: SLUGS, PORT: PORT, DEFAULT_LABEL: DEFAULT_LABEL, ICONS: ICONS, TYPE_ICONS: TYPE_ICONS,
    MAX_LABEL: MAX_LABEL, MAX_TSV_LABEL: MAX_TSV_LABEL, SOURCE_NAME_KEY: SOURCE_NAME_KEY,
    defaults: defaults, cleanLabel: cleanLabel, normalize: normalize, migrate: migrate,
    detectionScript: detectionScript, parseDetection: parseDetection, unavailable: unavailable,
    tvName: tvName, classify: classify, iconFile: iconFile, shorten: shorten, rows: rows, tsv: tsv
};
