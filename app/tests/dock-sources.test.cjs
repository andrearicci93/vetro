'use strict';
const assert = require('assert').strict;
const catalog = require('../service/dock-catalog.js');
const raw = ['O|d/webapp@yt', 'O|s/source.layer.hdmi@HDMI2', 'O|s/livetv@RF',
    'O|s/source.layer.hdmi@HDMI1', 'O|s/source.layer.hdmi@HDMI2',
    'R|' + ['yt', 'YouTube', 'youtube.app'].map(s => Buffer.from(s).toString('hex')).join('|') + '|0'].join('\n');
const parsed = catalog.parse(raw);
const enabled = catalog.build(parsed, {showHomeSources: true});
assert.deepEqual(enabled.entries.map(e => e.appId), ['youtube.app', 'source:14', 'source:0', 'source:13']);
const disabled = catalog.build(parsed, {showHomeSources: false});
assert.deepEqual(disabled.entries.map(e => e.appId), ['youtube.app', 'source:0'], 'upstream Live TV is preserved');
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

// A Samsung monitor (#215: Odyssey G6 LS27BG652, Smart Monitor M8): its source list keys an HDMI input with the activity index of the
// device on it ("HDMI2/0") and has a DisplayPort input ("DISPLAYPORT", SourceType 33). Same shape as the reporter's file, names made up.
{
    const catalog = require('../service/dock-catalog.js');
    const monitor = {
        'HDMI2/0': {SourceType: 14, EditName: 'Console', DetectedName: 'Console', ConnectionState: true},
        'DISPLAYPORT': {SourceType: 33, EditName: 'PC', DetectedName: 'PC', ConnectionState: true,
            IconPath: '/usr/apps/com.samsung.tv.theme-resource/shared/res/VD_ICONS/i_icon_device_m_pc.svg'},
        'DLNA/uuid:x+wlan0': {SourceType: 56, EditName: 'Media server', ConnectionState: true}
    };
    const parsed = catalog.parse(['F|csfs', 'O|s/livetv@RF', 'S|' + Buffer.from(JSON.stringify(monitor)).toString('base64')].join('\n'));
    const inputs = catalog.sourceEntries(parsed, {});
    assert.deepEqual(inputs.map(e => e.appId), ['source:0', 'source:13', 'source:14', 'source:15', 'source:16', 'source:33'], 'DisplayPort after HDMI 4, DLNA left out');
    assert.equal(inputs[2].inputLabel, 'HDMI 2 - Console', 'the name of "HDMI2/0" reaches HDMI 2');
    const dp = inputs[5];
    assert.deepEqual([dp.slug, dp.label, dp.inputLabel, dp.key], ['in-dp', 'PC', 'DisplayPort - PC', 'source:33']);
    assert.equal(catalog.sourceEntries(parsed, {useSourceImages: true})[5].icon, null, 'an SVG picture is not used: the launcher draws its own DP icon');
    const tv = catalog.parse(['F|csfs', 'S|' + Buffer.from(JSON.stringify({TV: {SourceType: 0}, HDMI1: {SourceType: 13, EditName: 'Box'}})).toString('base64')].join('\n'));
    assert.deepEqual(catalog.sourceEntries(tv, {}).map(e => e.appId), ['source:0', 'source:13', 'source:14', 'source:15', 'source:16'], 'a TV without DisplayPort: no DisplayPort');
    assert.equal(catalog.sourceEntries(tv, {})[1].inputLabel, 'HDMI 1 - Box', 'the plain "HDMI1" key still names HDMI 1');
    assert.ok(catalog.inputsTsv({inputs: inputs}).includes('in-dp\tDisplayPort - PC\tsource:33'), 'the launcher list carries it');
    console.log('PASS sources: a monitor\'s DisplayPort and "HDMI2/0" names');
}
