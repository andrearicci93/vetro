'use strict';
// Connected sources only: Sources lists TV and the ports Samsung's caches report connected; off keeps TV and HDMI 1-4. Synthetic data.
const assert = require('assert').strict;
const catalog = require('../service/dock-catalog.js');
const settings = require('../service/settings-backup.js');

const hex = s => Buffer.from(s).toString('hex');
const reg = (id, title, appId) => 'R|' + hex(id) + '|' + hex(title) + '|' + hex(appId) + '|0|1';
const read = sources => catalog.parse(['F|csfs', 'O|d/webapp@rai', 'S|' + Buffer.from(JSON.stringify(sources)).toString('base64'), reg('rai', 'RaiPlay', 'org.example.rai')]
    .concat(['org.example.rai'].concat(Array.from({length: 20}, (_, i) => 'org.filler.app' + i)).map(a => 'A|' + hex(a))).join('\n'));
const keys = built => catalog.inputsTsv(built).split('\n').filter(l => l && l[0] !== '#').map(l => l.split('\t')[7]);
const parsed = read({TV: {SourceType: 0, ConnectionState: true}, HDMI1: {SourceType: 13, ConnectionState: true, EditName: 'Streamer'},
    HDMI2: {SourceType: 14, ConnectionState: true}, HDMI3: {SourceType: 15, ConnectionState: false}});

assert.deepEqual(keys(catalog.build(parsed, {})), ['source:0', 'source:13', 'source:14', 'source:15', 'source:16'], 'off: every port, as before');
const only = catalog.build(parsed, {connectedSourcesOnly: true});
assert.deepEqual(keys(only), ['source:0', 'source:13', 'source:14'], 'on: no unplugged or unlisted port');
assert.equal(only.inputs.length, 5, 'the full list stays available to the row');
assert.deepEqual(keys(catalog.build(read({}), {connectedSourcesOnly: true})), ['source:0'], 'an empty cache still leaves TV');

assert.equal(settings.build({dock: {enabled: true, connectedSourcesOnly: true}}).sections.launcher.connectedSourcesOnly, true, 'the Settings file keeps it');
console.log('PASS connected sources only: Sources filter, default unchanged, full list kept, Settings file');
