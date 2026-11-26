'use strict';
// Hide TV on Sources: TV leaves the Sources list, never the inputs the row, tuner and keys use; an empty list keeps TV. Synthetic data.
const assert = require('assert').strict;
const catalog = require('../service/dock-catalog.js');
const settings = require('../service/settings-backup.js');

const hex = s => Buffer.from(s).toString('hex');
const reg = (id, title, appId) => 'R|' + hex(id) + '|' + hex(title) + '|' + hex(appId) + '|0|1';
const read = sources => catalog.parse(['F|csfs', 'O|d/webapp@rai', 'O|s/livetv@RF', 'S|' + Buffer.from(JSON.stringify(sources)).toString('base64'), reg('rai', 'RaiPlay', 'org.example.rai')]
    .concat(['org.example.rai'].concat(Array.from({length: 20}, (_, i) => 'org.filler.app' + i)).map(a => 'A|' + hex(a))).join('\n'));
const keys = built => catalog.inputsTsv(built).split('\n').filter(l => l && l[0] !== '#').map(l => l.split('\t')[7]);
const parsed = read({TV: {SourceType: 0, ConnectionState: true}, HDMI1: {SourceType: 13, ConnectionState: true}});

assert.deepEqual(keys(catalog.build(parsed, {})), ['source:0', 'source:13', 'source:14', 'source:15', 'source:16'], 'off: as before');
const hidden = catalog.build(parsed, {hideTvSource: true});
assert.deepEqual(keys(hidden), ['source:13', 'source:14', 'source:15', 'source:16'], 'on: every port but TV');
assert.ok(hidden.inputs.some(e => e.key === 'source:0'), 'TV stays among the inputs');
assert.ok(hidden.entries.some(e => e.key === 'live:RF'), 'a Live TV tile on the row is untouched');
assert.deepEqual(keys(catalog.build(parsed, {hideTvSource: true, connectedSourcesOnly: true})), ['source:13'], 'with Connected sources only: the plugged ports');
assert.deepEqual(keys(catalog.build(read({}), {hideTvSource: true, connectedSourcesOnly: true})), ['source:0'], 'nothing else to show: TV stays');

assert.equal(settings.build({dock: {enabled: true, hideTvSource: true}}).sections.launcher.hideTvSource, true, 'the Settings file keeps it');
console.log('PASS hide TV on Sources: Sources only, inputs and row untouched, with Connected sources only, never empty, Settings file');
