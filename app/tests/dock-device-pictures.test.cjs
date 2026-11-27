'use strict';
// #297: Samsung's cache names an SVG for a device-type input (a PC, a Blu-ray player), which the launcher cannot draw. The same picture is
// a PNG (Tizen 6.0 / 6.5) or a WebP (Tizen 9 / 10) in another folder; the tile takes the one that exists.
const assert = require('assert').strict, catalog = require('../service/dock-catalog.js'), sources = require('../service/input-sources.js');
const DIR = '/usr/apps/com.samsung.tv.theme-resource/shared/res/PRINCIPLE/NONFLUX/icon/r_icon_device_m/';
const SVG = n => '/usr/apps/com.samsung.tv.theme-resource/shared/res/VD_ICONS/i_icon_device_m_' + n + '.svg';
const FLUX = n => '/usr/apps/com.samsung.tv.theme-resource/shared/res/PRINCIPLE/FLUX/i_icon_device_m_' + n + '.svg';
const enc = o => Buffer.from(JSON.stringify(o)).toString('base64');

assert.deepEqual(sources.deviceTwins([SVG('pc')]), [DIR + 'r_icon_device_m_pc.png', DIR + 'r_icon_device_m_pc.webp']);
assert.deepEqual(sources.deviceTwins([undefined, '/etc/x.svg', FLUX('notepc'), SVG('notepc')]), [DIR + 'r_icon_device_m_notepc.png', DIR + 'r_icon_device_m_notepc.webp'], 'FLUX and VD_ICONS name the same picture once');
assert.deepEqual(sources.deviceTwins([SVG('../../etc/passwd'), SVG('a b'), SVG('tv+soundbar'), '/usr/apps/com.samsung.tv.theme-resource/shared/res/VD_ICONS/../x/i_icon_device_m_pc.svg']), [], 'only plain names under the two known folders');

const home = hdmi => ({exit_code: 0, stdout: ['O|s/source.layer.hdmi@HDMI4', 'S|1|' + enc(hdmi)].join('\n')});
const run = (hdmi, exists) => async cmd => {
    const script = Buffer.from(cmd.split(' ')[1], 'base64').toString();
    if (script.includes('.appLayerCache')) return home(hdmi);
    return {exit_code: 0, stdout: (script.match(/'[^']+'/g) || []).map(p => p.slice(1, -1)).filter(exists).map(p => 'OK|' + p).join('\n')};
};
const pc = {HDMI4: {SourceType: 16, EditName: 'PC', IconPath: SVG('pc')}};
(async () => {
    const col5 = (tsv, slug) => (tsv.split('\n').find(l => l.startsWith(slug + '\t')) || '\tnone').split('\t')[4];
    const pcIcon = r => col5(r.inputsTsv, 'in-hdmi4'), rowIcon = r => col5(r.tsv, 'in-hdmi4');
    const png = await catalog.load(run(pc, p => p === DIR + 'r_icon_device_m_pc.png' || p === DIR + 'r_icon_device_m_pc.webp'), {useSourceImages: true});
    assert.equal(pcIcon(png), DIR + 'r_icon_device_m_pc.png', 'PNG first when both exist');
    const webp = await catalog.load(run(pc, p => p === DIR + 'r_icon_device_m_pc.webp'), {useSourceImages: true, showHomeSources: true});
    assert.equal(pcIcon(webp), DIR + 'r_icon_device_m_pc.webp', 'Tizen 9 and 10: the WebP');
    assert.equal(rowIcon(webp), DIR + 'r_icon_device_m_pc.webp', 'the Home-row tile of the port takes it too');
    assert.ok(!webp.inputsTsv.includes('r_icon_device_m_pc.png'), 'only the file that exists is written');
    const none = await catalog.load(run(pc, () => false), {useSourceImages: true});
    assert.equal(pcIcon(none), '', 'neither file: Vetro\'s own icon');
    assert.ok(!none.skipped.some(s => /Icon file missing/.test(s.reason)), 'a twin that is not there is nothing to report');
    const off = await catalog.load(run(pc, () => true), {useSourceImages: false});
    assert.equal(pcIcon(off), '', 'HDMI Source Images off: no picture');
    const picture = {HDMI4: {SourceType: 16, IconPath: SVG('pc'), LauncherUnfocusedIconPath: '/usr/share/canalysis/Icon/Launcher/2K/launcher_ps5_n.png'}};
    const real = await catalog.load(run(picture, () => true), {useSourceImages: true});
    assert.equal(pcIcon(real), '/usr/share/canalysis/Icon/Launcher/2K/launcher_ps5_n.png', 'the picture of a recognised device wins over the generic one');
    const tv = await catalog.load(run({TV: {SourceType: 0, IconPath: SVG('tv')}}, () => true), {useSourceImages: true});
    assert.equal(col5(tv.inputsTsv, 'in-tv'), '', 'the TV input keeps its own icon');
    assert.ok(catalog.iconPathOk(DIR + 'r_icon_device_m_pc.png'));
    console.log('PASS device pictures: SVG type icons map to their PNG or WebP twin; the first that exists is used');
})().catch(e => { console.error(e); process.exitCode = 1; });
