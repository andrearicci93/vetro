'use strict';
const assert = require('assert').strict;
const sources = require('../service/dock-sources.js');

// Captured from the QN90B: vconftool's own sed moves the text after the last ": " in front of the
// value, so the JSON arrives split. The reader must put it back together.
const DETECTION = [
    'db/source-list/source-name, value = 15\t}] (String: [\t{\t\t"DetectedName" : "Amazon Fire TV stick",\t\t"DeviceType" : 53,\t\t"EditName" : "",\t\t"EditState" : 0,\t\t"MbrActivityIndex" : -2,\t\t"OrginalDeviceType" : 53,\t\t"SettingMethod" : 2,\t\t"SourceType" : 14\t},\t{\t\t"DetectedName" : "PlayStation 5",\t\t"DeviceType" : 7,\t\t"EditName" : "",\t\t"EditState" : 0,\t\t"MbrActivityIndex" : -2,\t\t"OrginalDeviceType" : 7,\t\t"SettingMethod" : 2,\t\t"SourceType" )',
    '##vetro##db/source-service/detection_state_HDMI1, value = not_detected,mbr (String)\n##vetro##db/source-service/detection_state_HDMI2, value = detected,autodetection (String)\n##vetro##db/source-service/detection_state_HDMI3, value = detected,autodetection (String)\n##vetro##db/source-service/detection_state_HDMI4, value = not_detected,mbr (String)\n##vetro##'
].join('');

// The same output for other entries, in the shape vconftool prints (split at the last ": ").
function detection(entries) {
    const vconf = (key, value) => { const i = value.lastIndexOf(': '); return i < 0 ? key + ', value = String: ' + value : key + ', value = ' + value.slice(i + 2) + ' (String: ' + value.slice(0, i) + ')'; };
    const json = JSON.stringify(entries).replace(/,/g, ',\t').replace(/:/g, ' : ');
    return [vconf('db/source-list/source-name', json)].concat([1, 2, 3, 4].map(n => 'db/source-service/detection_state_HDMI' + n + ', value = detected,autodetection (String)')).join('##vetro##') + '##vetro##';
}
function list(changes) {
    const rows = sources.defaults();
    (changes || []).forEach(c => Object.assign(rows.find(r => r.slug === c.slug), c));
    return rows;
}
const autoLabel = (det, slug) => sources.rows(list(), det).find(r => r.slug === slug).autoLabel;

// Validation: the editor's rows or the saved file, cleaned, with the first problem named.
const five = sources.defaults();
assert.deepEqual(sources.normalize({sources: five}), five, 'the saved file shape');
assert.deepEqual(sources.normalize({version: 1, sources: five}), five, 'a file saved with a version field still reads');
assert.equal(sources.normalize(list([{slug: 'in-hdmi2', label: '  Living room  '}]))[2].label, 'Living room');
assert.equal(sources.normalize(list([{slug: 'in-hdmi2', label: '   '}]))[2].label, null, 'blank means automatic');
assert.throws(() => sources.normalize(five.slice(0, 4)), /all five/);
assert.throws(() => sources.normalize(five.slice(0, 4).concat(five[0])), /Duplicate source/);
assert.throws(() => sources.normalize(five.map(r => r.slug === 'in-tv' ? Object.assign({}, r, {slug: 'in-usb'}) : r)), /Unknown source/);
assert.throws(() => sources.normalize(list([{slug: 'in-hdmi2', icon: 'logo'}])), /Unknown icon/);
assert.throws(() => sources.normalize(list([{slug: 'in-hdmi2', label: 'x'.repeat(25)}])), /24 characters/);
assert.throws(() => sources.normalize(list([{slug: 'in-hdmi2', label: 'a\tb'}])), /control characters/);
assert.throws(() => sources.normalize(five.map(r => Object.assign({}, r, {hidden: true}))), /at least one source visible/);

// Detection: the TV's own names and presence from the captured output.
const det = sources.parseDetection(DETECTION);
assert.equal(det.available, true);
assert.deepEqual(det.states, {13: 'not_detected', 14: 'detected', 15: 'detected', 16: 'not_detected'});
assert.equal(autoLabel(det, 'in-hdmi2'), 'Amazon Fire TV stick');
assert.equal(autoLabel(det, 'in-hdmi1'), 'HDMI 1', 'no device: the port name');
assert.equal(autoLabel(sources.parseDetection(detection([{DetectedName: 'Old', SourceType: 14}, {DetectedName: 'New', SourceType: 14}])), 'in-hdmi2'), 'New', 'two entries for one port: the last wins');
assert.equal(autoLabel(sources.parseDetection(detection([{DetectedName: 'Fire TV', EditName: 'Living room', SourceType: 14}])), 'in-hdmi2'), 'Living room', 'Samsung\'s edit wins over the detected name');
assert.equal(autoLabel(sources.parseDetection(detection([{DetectedName: 'Fire TV', EditName: 'HDMI 2', SourceType: 14}])), 'in-hdmi2'), 'Fire TV', 'an edit equal to the port name is ignored');
assert.equal(autoLabel(sources.parseDetection(detection([{DetectedName: 'Fire\tTV', SourceType: 14}])), 'in-hdmi2'), 'Fire TV', 'a tab in a TV name never reaches the file');

// Anything unreadable makes the whole detection unavailable.
assert.equal(sources.parseDetection('').available, false);
assert.equal(sources.parseDetection(DETECTION.replace('detection_state_HDMI3, value = detected', 'Error: no such key')).available, false, 'a failed state read');
assert.equal(sources.parseDetection(DETECTION.replace('"PlayStation 5"', '"PlayStation 5')).available, false, 'broken JSON');
assert.equal(sources.parseDetection(detection({not: 'a list'})).available, false);
assert.equal(sources.parseDetection(detection([null])).available, false);
assert.equal(sources.parseDetection(detection([])).available, true, 'an empty name list is fine');

// Rows: saved order, effective and saved values, presence, and icons classified from the TV's name.
const rows = sources.rows(list([{slug: 'in-hdmi1', hidden: true}, {slug: 'in-hdmi2', label: 'Mac mini'}, {slug: 'in-tv', icon: 'camera'}]), det);
assert.deepEqual(rows.map(r => [r.label, r.labelOverride, r.icon, r.iconChoice, r.present]), [
    ['TV', null, 'camera', 'camera', true],
    ['HDMI 1', null, 'hdmi', 'auto', false],
    ['Mac mini', 'Mac mini', 'streaming', 'auto', true],
    ['PlayStation 5', null, 'console', 'auto', true],
    ['HDMI 4', null, 'hdmi', 'auto', false]
], 'a Vetro label never changes the automatic icon');
const offline = sources.rows(list([{slug: 'in-hdmi2', label: 'Fire TV'}]), sources.unavailable());
assert.deepEqual(offline.map(r => r.label), ['TV', 'HDMI 1', 'Fire TV', 'HDMI 3', 'HDMI 4'], 'without detection: saved labels and port names');
assert.ok(offline.every(r => r.present === null), 'no "no device" claim when detection cannot run');

// Classification of common device names.
[['Xbox Series X', 'console'], ['Apple TV 4K', 'streaming'], ['Windows PC', 'pc'], ['AV receiver', 'soundbar'],
    ['Blu-ray player', 'disc'], ['Webcam', 'camera'], ['Satellite box', 'hdmi']].forEach(([name, icon]) => {
    const one = sources.rows(list(), sources.parseDetection(detection([{DetectedName: name, SourceType: 13}])));
    assert.equal(one[1].icon, icon, name);
});

// The generated file: visible rows in saved order, source numbers and absolute icon paths.
const order = list([{slug: 'in-hdmi1', hidden: true}]);
order.unshift(order.splice(3, 1)[0]);
assert.equal(sources.tsv(sources.rows(order, det), '/pkg/icons'), [
    '# the inputs panel (Up on the dock). Generated from vetro-dock-sources.json; do not edit.',
    'in-hdmi3\tPlayStation 5\tsource:15\t\t/pkg/icons/input-console.png',
    'in-tv\tTV\tsource:0\t\t/pkg/icons/in-tv.png',
    'in-hdmi2\tAmazon Fire TV stick\tsource:14\t\t/pkg/icons/input-streaming.png',
    'in-hdmi4\tHDMI 4\tsource:16\t\t/pkg/icons/input-hdmi.png',
    ''
].join('\n'));

console.log('PASS dock sources: validation, detection, rows and the generated file');
