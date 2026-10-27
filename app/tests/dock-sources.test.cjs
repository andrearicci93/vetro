'use strict';
const assert = require('assert').strict;
const sources = require('../service/dock-sources.js');

// Captured from the QN90B: vconftool's own sed moves the text after the last ": " in front of the
// value, so the JSON arrives split. The reader must put it back together.
const DETECTION = [
    'db/source-list/source-name, value = 15\t}] (String: [\t{\t\t"DetectedName" : "Amazon Fire TV stick",\t\t"DeviceType" : 53,\t\t"EditName" : "",\t\t"EditState" : 0,\t\t"MbrActivityIndex" : -2,\t\t"OrginalDeviceType" : 53,\t\t"SettingMethod" : 2,\t\t"SourceType" : 14\t},\t{\t\t"DetectedName" : "PlayStation 5",\t\t"DeviceType" : 7,\t\t"EditName" : "",\t\t"EditState" : 0,\t\t"MbrActivityIndex" : -2,\t\t"OrginalDeviceType" : 7,\t\t"SettingMethod" : 2,\t\t"SourceType" )',
    '##vetro##db/source-service/detection_state_HDMI1, value = not_detected,mbr (String)\n##vetro##db/source-service/detection_state_HDMI2, value = detected,autodetection (String)\n##vetro##db/source-service/detection_state_HDMI3, value = detected,autodetection (String)\n##vetro##db/source-service/detection_state_HDMI4, value = not_detected,mbr (String)\n##vetro##'
].join('');

// The shape vconftool prints for one value, used for variants. The captured string above pins the real tool.
function vconf(key, value) {
    const i = value.lastIndexOf(': ');
    return i < 0 ? key + ', value = String: ' + value
        : key + ', value = ' + value.slice(i + 2) + ' (String: ' + value.slice(0, i) + ')';
}
function payload(entries) {
    return JSON.stringify(entries).replace(/,/g, ',\t').replace(/:/g, ' : ');
}
function detection(entries, states) {
    return [
        vconf(sources.SOURCE_NAME_KEY, payload(entries)),
        '##vetro##' + vconf('db/source-service/detection_state_HDMI1', states[0] + ',autodetection'),
        '##vetro##' + vconf('db/source-service/detection_state_HDMI2', states[1] + ',autodetection'),
        '##vetro##' + vconf('db/source-service/detection_state_HDMI3', states[2] + ',autodetection'),
        '##vetro##' + vconf('db/source-service/detection_state_HDMI4', states[3] + ',autodetection'),
        '##vetro##'
    ].join('\n');
}

// A saved list, with only the fields a test cares about changed.
function state(changes) {
    const list = sources.defaults();
    (changes || []).forEach(change => Object.assign(list.sources.filter(row => row.slug === change.slug)[0], change));
    return list;
}

(async function () {
    // Defaults: all five visible, automatic labels, Auto icons, canonical order.
    const empty = sources.defaults();
    assert.deepEqual(empty.sources.map(row => row.slug), sources.SLUGS);
    assert.ok(empty.sources.every(row => row.label === null && row.hidden === false && row.icon === 'auto'));

    // Validation: the stored shape, or the five rows, with the first problem named.
    assert.deepEqual(sources.normalize(empty), empty);
    assert.deepEqual(sources.normalize(empty.sources), empty);
    assert.equal(sources.normalize(state([{slug: 'in-hdmi2', label: '  Living room  '}])).sources[2].label, 'Living room');
    assert.equal(sources.normalize(state([{slug: 'in-hdmi2', label: '   '}])).sources[2].label, null, 'empty means null');
    assert.throws(() => sources.normalize({version: 2, sources: empty.sources}), /version/);
    assert.throws(() => sources.normalize({version: 1, sources: empty.sources.slice(0, 4)}), /Missing source/);
    assert.throws(() => sources.normalize({version: 1, sources: empty.sources.concat(empty.sources[0])}), /Duplicate source/);
    assert.throws(() => sources.normalize(state([{slug: 'in-hdmi2', icon: 'logo'}])), /Unknown icon/);
    assert.throws(() => sources.normalize(state([{slug: 'in-hdmi2', hidden: 'yes'}])), /hidden/);
    assert.throws(() => sources.normalize(state([{slug: 'in-hdmi2', label: 'x'.repeat(25)}])), /24 characters/);
    assert.throws(() => sources.normalize(state([{slug: 'in-hdmi2', label: 'a\u0001b'}])), /control characters/);
    assert.throws(() => sources.normalize(state([
        {slug: 'in-tv', hidden: true}, {slug: 'in-hdmi1', hidden: true}, {slug: 'in-hdmi2', hidden: true},
        {slug: 'in-hdmi3', hidden: true}, {slug: 'in-hdmi4', hidden: true}
    ])), /at least one source visible/);
    assert.throws(() => sources.normalize({version: 1, sources: empty.sources.map(row => row.slug === 'in-tv' ? Object.assign({}, row, {slug: 'in-usb'}) : row)}), /Unknown source/);

    // Migration: the old file's order and custom labels survive; defaults become automatic; unknown
    // slugs are ignored, duplicates take the first row, and a missing slot is appended.
    const old = [
        "# the inputs panel (Up on the dock). source:N is Samsung's input number",
        'in-hdmi3\tPlayStation 5\tsource:15',
        'in-tv\tFreeview\tsource:0',
        'in-hdmi3\tSecond copy\tsource:15',
        'in-usb\tCamcorder\tsource:99',
        'in-hdmi2\tHDMI 2\tsource:14',
        'in-hdmi1\tMac mini\tsource:13'
    ].join('\n');
    const migrated = sources.migrate(old);
    assert.deepEqual(migrated.sources.map(row => row.slug), ['in-hdmi3', 'in-tv', 'in-hdmi2', 'in-hdmi1', 'in-hdmi4']);
    assert.equal(migrated.sources[0].label, 'PlayStation 5');
    assert.equal(migrated.sources[1].label, 'Freeview');
    assert.equal(migrated.sources[2].label, null, 'the exact port default is automatic, not an override');
    assert.equal(migrated.sources[3].label, 'Mac mini');
    assert.equal(migrated.sources[4].label, null);
    assert.ok(migrated.sources.every(row => row.hidden === false && row.icon === 'auto'));

    // Detection: the TV's own names and presence.
    const det = sources.parseDetection(DETECTION);
    assert.equal(det.available, true);
    assert.equal(det.names[14].detected, 'Amazon Fire TV stick');
    assert.equal(det.names[15].detected, 'PlayStation 5');
    assert.deepEqual(det.states, {13: 'not_detected', 14: 'detected', 15: 'detected', 16: 'not_detected'});

    const lastWins = sources.parseDetection(detection([
        {DetectedName: 'Old stick', EditName: '', SourceType: 14},
        {DetectedName: 'New stick', EditName: '', SourceType: 14}
    ], ['not_detected', 'detected', 'not_detected', 'not_detected']));
    assert.equal(lastWins.names[14].detected, 'New stick', 'two entries for one source: the last wins');
    const edited = sources.parseDetection(detection([
        {DetectedName: 'Amazon Fire TV stick', EditName: 'Living room', SourceType: 14}
    ], ['not_detected', 'detected', 'not_detected', 'not_detected']));
    assert.equal(sources.tvName('in-hdmi2', edited), 'Living room', 'Samsung edit wins over the detected name');
    const sameDefault = sources.parseDetection(detection([
        {DetectedName: 'Amazon Fire TV stick', EditName: 'HDMI 2', SourceType: 14}
    ], ['not_detected', 'detected', 'not_detected', 'not_detected']));
    assert.equal(sources.tvName('in-hdmi2', sameDefault), 'Amazon Fire TV stick', 'an edit equal to the port default is ignored');

    // Detection is unavailable as a whole: a failed read, broken JSON, or a shape we do not know.
    assert.equal(sources.parseDetection('').available, false);
    assert.equal(sources.parseDetection(DETECTION.replace('detection_state_HDMI3, value = detected', 'Error: no such key')).available, false, 'a failed state read');
    assert.equal(sources.parseDetection(DETECTION.replace('"PlayStation 5"', '"PlayStation 5')).available, false, 'broken JSON');
    assert.equal(sources.parseDetection(detection([], ['detected', 'detected', 'detected', 'detected'])).available, true, 'an empty source list is still a shape we know');
    assert.equal(sources.parseDetection(vconf(sources.SOURCE_NAME_KEY, '') + '\n##vetro##x##vetro##x##vetro##x##vetro##x##vetro##').available, false);
    assert.equal(sources.parseDetection(detection([{SourceType: '14'}], ['detected', 'detected', 'detected', 'detected'])).available, false, 'SourceType must be a number');
    assert.equal(sources.parseDetection(detection([{DetectedName: 5, SourceType: 14}], ['detected', 'detected', 'detected', 'detected'])).available, false, 'DetectedName must be a string');
    assert.equal(sources.parseDetection(detection({not: 'an array'}, ['detected', 'detected', 'detected', 'detected'])).available, false);

    // The saved list joined with detection: effective vs stored values, presence and the move/hide flags.
    const list = state([
        {slug: 'in-tv', hidden: true},
        {slug: 'in-hdmi1', hidden: true},
        {slug: 'in-hdmi2', label: 'Living room Fire TV', icon: 'streaming'}
    ]);
    const rows = sources.rows(list, det);
    assert.deepEqual(rows.map(row => row.slug), sources.SLUGS);
    assert.equal(rows[2].label, 'Living room Fire TV');
    assert.equal(rows[2].labelOverride, 'Living room Fire TV');
    assert.equal(rows[2].autoLabel, 'Amazon Fire TV stick');
    assert.equal(rows[2].icon, 'streaming');
    assert.equal(rows[2].iconChoice, 'streaming');
    assert.equal(rows[3].label, 'PlayStation 5', 'automatic row uses the detected name');
    assert.equal(rows[3].labelOverride, null);
    assert.equal(rows[3].icon, 'console', 'auto icon classifies the TV name');
    assert.equal(rows[3].present, true);
    assert.equal(rows[1].present, false);
    assert.equal(rows[0].present, true, 'the TV is always present');
    assert.equal(rows[0].hidden, true);
    assert.equal(rows[0].canMoveUp, false);
    assert.equal(rows[0].canHide, false, 'hidden rows offer no actions');
    assert.equal(rows[2].canMoveUp, false, 'the first visible row cannot move up');
    assert.equal(rows[2].canMoveDown, true);
    assert.equal(rows[3].canMoveUp, true);
    assert.equal(rows[4].canMoveDown, false, 'the last visible row cannot move down');
    assert.equal(rows[2].canHide, true);

    // An explicit icon wins on any row; a Vetro label never changes the type.
    const explicit = sources.rows(state([{slug: 'in-tv', icon: 'camera'}, {slug: 'in-hdmi2', label: 'Mac mini'}]), det);
    assert.equal(explicit[0].icon, 'camera');
    assert.equal(explicit[2].icon, 'streaming', 'classification uses the TV name, not the Vetro label');

    // Detection unavailable: overrides stay, automatic rows fall back to port defaults, present is null.
    const unavailable = sources.rows(state([{slug: 'in-hdmi2', label: 'Fire TV'}]), sources.unavailable());
    assert.equal(unavailable[2].label, 'Fire TV');
    assert.equal(unavailable[3].label, 'HDMI 3');
    assert.equal(unavailable[3].icon, 'hdmi');
    assert.ok(unavailable.every(row => row.present === null), 'no "no device" claim when detection cannot run');
    // Only one visible row: it cannot be hidden or moved.
    const last = sources.rows(state([{slug: 'in-hdmi1', hidden: true}, {slug: 'in-hdmi2', hidden: true},
        {slug: 'in-hdmi3', hidden: true}, {slug: 'in-hdmi4', hidden: true}]), det);
    assert.equal(last[0].canHide, false);
    assert.equal(last[0].canMoveUp, false);
    assert.equal(last[0].canMoveDown, false);

    // Classification by name, the correction path being the per-row icon choice.
    assert.equal(sources.classify('PlayStation 5'), 'console');
    assert.equal(sources.classify('Xbox Series X'), 'console');
    assert.equal(sources.classify('Nintendo Switch'), 'console');
    assert.equal(sources.classify('Amazon Fire TV stick'), 'streaming');
    assert.equal(sources.classify('Apple TV 4K'), 'streaming');
    assert.equal(sources.classify('Chromecast'), 'streaming');
    assert.equal(sources.classify('Roku'), 'streaming');
    assert.equal(sources.classify('NVIDIA Shield'), 'streaming');
    assert.equal(sources.classify('Mac mini'), 'pc');
    assert.equal(sources.classify('Windows PC'), 'pc');
    assert.equal(sources.classify('Linux box'), 'pc');
    assert.equal(sources.classify('Soundbar'), 'soundbar');
    assert.equal(sources.classify('Home Theater'), 'soundbar');
    assert.equal(sources.classify('AV receiver'), 'soundbar');
    assert.equal(sources.classify('Blu-ray player'), 'disc');
    assert.equal(sources.classify('DVD'), 'disc');
    assert.equal(sources.classify('Camera'), 'camera');
    assert.equal(sources.classify('Webcam'), 'camera');
    assert.equal(sources.classify('Satellite box'), 'hdmi');
    assert.equal(sources.classify(''), 'hdmi');

    // The generated inputs file: saved order, visible rows only, source numbers, absolute icon paths,
    // and a label shortened to 40 characters including one ellipsis.
    const long = sources.parseDetection(detection([
        {DetectedName: 'A'.repeat(50), EditName: '', SourceType: 14}
    ], ['detected', 'detected', 'detected', 'detected']));
    const generated = sources.tsv(sources.rows(state([{slug: 'in-hdmi1', hidden: true}]), long), '/opt/usr/apps/vetrotvapp/res/wgt/native/dock/res/icons');
    const lines = generated.split('\n');
    assert.match(lines[0], /^# /);
    assert.ok(!generated.includes('in-hdmi1'), 'hidden rows are omitted');
    assert.equal(lines[1], 'in-tv\tTV\tsource:0\t\t/opt/usr/apps/vetrotvapp/res/wgt/native/dock/res/icons/in-tv.png');
    assert.equal(lines[2], 'in-hdmi2\t' + 'A'.repeat(39) + '\u2026\tsource:14\t\t/opt/usr/apps/vetrotvapp/res/wgt/native/dock/res/icons/input-hdmi.png');
    assert.equal(lines[3], 'in-hdmi3\tHDMI 3\tsource:15\t\t/opt/usr/apps/vetrotvapp/res/wgt/native/dock/res/icons/input-hdmi.png');
    assert.equal(lines[4], 'in-hdmi4\tHDMI 4\tsource:16\t\t/opt/usr/apps/vetrotvapp/res/wgt/native/dock/res/icons/input-hdmi.png');
    assert.equal(lines.length, 6, 'header, four visible rows and the final newline');
    assert.equal(sources.shorten('x'.repeat(40)), 'x'.repeat(40), 'forty is short enough');
    assert.equal(sources.shorten('x'.repeat(41)).length, 40);
    assert.equal(sources.shorten('x'.repeat(41)), 'x'.repeat(39) + '\u2026', 'the ellipsis replaces the fortieth character');
    const splitPair = sources.shorten('a'.repeat(38) + '\uD83D\uDE00' + 'b'.repeat(10));
    assert.equal(splitPair, 'a'.repeat(38) + '\u2026', 'a cut between the halves of an emoji drops the whole pair');
    assert.doesNotMatch(splitPair, /[\uD800-\uDBFF]\u2026/, 'no lone high surrogate before the ellipsis');

    // Icon file names: TV reuses the existing TV icon, HDMI has its own file.
    assert.equal(sources.iconFile('tv'), 'in-tv.png');
    assert.equal(sources.iconFile('hdmi'), 'input-hdmi.png');
    ['pc', 'console', 'streaming', 'soundbar', 'disc', 'camera'].forEach(id => assert.equal(sources.iconFile(id), 'input-' + id + '.png'));

    // The detection command reads the one key and the four states in one call, separated by sections.
    const script = sources.detectionScript();
    assert.ok(script.includes('vconftool get "$1"'));
    [sources.SOURCE_NAME_KEY, 'detection_state_HDMI1', 'detection_state_HDMI2', 'detection_state_HDMI3', 'detection_state_HDMI4']
        .forEach(key => assert.ok(script.includes(key), 'reads ' + key));
    assert.ok(script.includes('##vetro##'));

    console.log('PASS dock sources: defaults, validation, migration, detection, resolution, generated file');
})().catch(e => { console.error(e); process.exitCode = 1; });
