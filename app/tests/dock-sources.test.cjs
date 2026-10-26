'use strict';
const assert = require('assert').strict;
const catalog = require('../service/dock-catalog.js');
const raw = ['O|d/webapp@yt', 'O|s/source.layer.hdmi@HDMI2', 'O|s/livetv@RF',
    'O|s/source.layer.hdmi@HDMI1', 'O|s/source.layer.hdmi@HDMI2',
    'R|' + ['yt', 'YouTube', 'youtube.app'].map(s => Buffer.from(s).toString('hex')).join('|') + '|0'].join('\n');
const parsed = catalog.parse(raw);
const enabled = catalog.build(parsed, {showHomeSources: true});
assert.deepEqual(enabled.entries.map(e => e.appId), ['youtube.app', 'source:14', 'org.tizen.tv-viewer', 'source:13']);
const disabled = catalog.build(parsed, {showHomeSources: false});
assert.deepEqual(disabled.entries.map(e => e.appId), ['youtube.app', 'org.tizen.tv-viewer'], 'upstream Live TV is preserved');
assert.deepEqual(catalog.build(parsed).entries, disabled.entries, 'fresh default filters HDMI sources');
assert.deepEqual(disabled.inputs.map(e => e.appId), ['source:0','source:13','source:14','source:15','source:16']);
assert.deepEqual(enabled.inputs, disabled.inputs, 'filter never changes the Sources page');
assert.ok(!enabled.entries.some(e => e.appId === 'source:15'), 'never adds a source absent from native Home');
assert.ok(enabled.inputs.every(e => e.icon === null), 'sources use packaged generic artwork');
(async () => {
    const loaded = await catalog.load(async () => ({exit_code:0,stdout:'O|s/source.layer.hdmi@HDMI1'}), {showHomeSources:false});
    assert.equal(loaded.count,0,'source-only Home can be filtered down to system actions');
    assert.ok(loaded.tsv.includes('samsunghome'));
    await assert.rejects(catalog.load(async () => ({exit_code:0,stdout:'O|d/webapp@missing'})), /None of the Home row/);
    console.log('PASS Home source filter: native order, duplicates, upstream Live TV, no synthetic tiles and independent Sources page');
})().catch(e=>{console.error(e);process.exitCode=1});
