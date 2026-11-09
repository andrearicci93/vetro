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
assert.equal(autoLabel(det, 'in-hdmi2'), 'HDMI 2 - Amazon Fire TV stick', 'the port first, as the Launcher has always shown it');
assert.equal(autoLabel(det, 'in-hdmi1'), 'HDMI 1', 'no device: the port name');
assert.equal(autoLabel(sources.parseDetection(detection([{DetectedName: 'Old', SourceType: 14}, {DetectedName: 'New', SourceType: 14}])), 'in-hdmi2'), 'HDMI 2 - New', 'two entries for one port: the last wins');
assert.equal(autoLabel(sources.parseDetection(detection([{DetectedName: 'Fire TV', EditName: 'Living room', SourceType: 14}])), 'in-hdmi2'), 'HDMI 2 - Living room', 'Samsung\'s edit wins over the detected name');
assert.equal(autoLabel(sources.parseDetection(detection([{DetectedName: 'Fire TV', EditName: 'HDMI 2', SourceType: 14}])), 'in-hdmi2'), 'HDMI 2 - Fire TV', 'an edit equal to the port name is ignored');
assert.equal(autoLabel(sources.parseDetection(detection([{DetectedName: 'Fire\tTV', SourceType: 14}])), 'in-hdmi2'), 'HDMI 2 - Fire TV', 'a tab in a TV name never reaches the file');

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
    ['HDMI 3 - PlayStation 5', null, 'console', 'auto', true],
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
assert.equal(sources.tsv(sources.rows(order, det), '/usr/apps/vetrotvapp/res/icons'), [
    '# the inputs panel (Up on the dock). Generated from vetro-dock-sources.json; do not edit.',
    'in-hdmi3\tHDMI 3 - PlayStation 5\tsource:15\t\t/usr/apps/vetrotvapp/res/icons/input-console.png',
    'in-tv\tTV\tsource:0\t\t/usr/apps/vetrotvapp/res/icons/in-tv.png',
    'in-hdmi2\tHDMI 2 - Amazon Fire TV stick\tsource:14\t\t/usr/apps/vetrotvapp/res/icons/input-streaming.png',
    'in-hdmi4\tHDMI 4\tsource:16\t\t/usr/apps/vetrotvapp/res/icons/input-hdmi.png',
    ''
].join('\n'));

// The dock skips a whole line with an icon path outside its roots (an owner install, say): keep the row, leave the icon out.
assert.equal(sources.tsv(sources.rows(list(), det), '/opt/usr/home/owner/apps_rw/vetro/res/icons').split('\n')[1],
    'in-tv\tTV\tsource:0\t\t');

// Names the dock would reject are cut or refused here.
const long = sources.rows(list(), sources.parseDetection(detection([{DetectedName: 'x'.repeat(60), SourceType: 13}])));
assert.equal(long[1].label.length, 40, 'a TV-reported name is cut to the dock\'s 40');
[{}, [1, 2], 5].forEach(label => assert.throws(() => sources.normalize(list([{slug: 'in-hdmi1', label}])), /Invalid source label/));

// Samsung's own source list (the Home row's `.sourceCache`, S| line) is read from the same script and wins over the
// settings store for names; the store still says which devices are connected. A TV with only one of the two works.
const CACHE = Buffer.from(JSON.stringify({HDMI1: {EditName: 'Mac mini', DetectedName: 'Mac mini', IconPath: '/opt/usr/apps/x/hdmi1.png'},
    HDMI2: {EditName: '', DetectedName: 'Fire TV', IconPath: '/opt/usr/apps/x/hdmi2.png'}, HDMI3: {EditName: 'Den PS5', DetectedName: 'PlayStation 5'}})).toString('base64');
const both = sources.parseDetection(DETECTION + 'S|' + CACHE + '\n');
const cacheOnly = sources.parseDetection('Error\n##vetro##'.repeat(5) + 'S|' + CACHE + '\n');
assert.equal(both.available, true);
assert.equal(both.states[14], 'detected', 'presence comes from the settings store');
assert.equal(autoLabel(both, 'in-hdmi3'), 'HDMI 3 - Den PS5', 'Samsung\'s list wins over the settings store');
assert.equal(autoLabel(both, 'in-hdmi1'), 'HDMI 1 - Mac mini', 'a name only the list has');
assert.equal(cacheOnly.available, true, 'the list alone is enough');
assert.equal(autoLabel(cacheOnly, 'in-hdmi2'), 'HDMI 2 - Fire TV');
assert.ok(sources.rows(list(), cacheOnly).every(r => r.slug === 'in-tv' || r.present === null), 'no presence without the settings store');
assert.equal(sources.parseDetection(DETECTION.replace('Amazon Fire TV stick', 'Old') + 'S|not-json\n').available, true, 'an unreadable list leaves the store\'s answer');
assert.ok(sources.detectionScript().includes('.sourceCache'), 'one script reads both');

// Samsung's artwork (only when the switch is on) replaces the packaged icon on a row left on Auto; a chosen icon wins.
const art = sources.rows(list([{slug: 'in-hdmi2', icon: 'pc'}]), both, {useSourceImages: true});
assert.equal(art[1].artwork, '/opt/usr/apps/x/hdmi1.png');
assert.equal(art[2].artwork, null, 'a chosen icon is never replaced');
assert.equal(art[0].artwork, null, 'the TV tile has no Samsung artwork');
assert.equal(sources.rows(list(), both, {useSourceImages: false})[1].artwork, null, 'the switch is off');
const artTsv = sources.tsv(art, '/usr/apps/vetrotvapp/res/icons').split('\n');
assert.equal(artTsv[2], 'in-hdmi1\tHDMI 1 - Mac mini\tsource:13\t\t/opt/usr/apps/x/hdmi1.png');
assert.equal(artTsv[3], 'in-hdmi2\tHDMI 2 - Fire TV\tsource:14\t\t/usr/apps/vetrotvapp/res/icons/input-pc.png', 'the chosen icon, packaged');
assert.equal(art[3].artwork, null, 'a port without artwork keeps the packaged icon');

console.log('PASS dock sources: validation, detection, rows and the generated file');
