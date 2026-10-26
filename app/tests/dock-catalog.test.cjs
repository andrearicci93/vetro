'use strict';
const assert = require('assert').strict;
const catalog = require('../service/dock-catalog.js');

const hex = s => Buffer.from(s).toString('hex');
const OUTPUT = [
    'O|s/livetv@TVPLUS', 'O|s/livetv@RF', 'O|d/webapp@aaa', 'O|d/webapp@bbb', 'O|d/webapp@hid', 'O|d/webapp@gone', 'O|d/webapp@dup', 'O|s/livetv@WHAT', 'O|junk line', 'O|EOFCOBA',
    'R|' + hex('aaa') + '|' + hex('Netflix') + '|' + hex('org.tizen.netflix-app') + '|0',
    'R|' + hex('bbb') + '|' + hex('Disney+') + '|' + hex('MCmYXNxgcu.DisneyPlus') + '|0',
    'R|' + hex('hid') + '|' + hex('Template') + '|' + hex('com.samsung.tv.tpl') + '|1',
    'R|' + hex('dup') + '|' + hex('Netflix') + '|' + hex('other.netflix') + '|0',
    'R|zz|nothex|x|0',
    'I|aaa|/opt/share/webappservice/apps_icon/all/aaa/224x224.png',
    'I|bbb|/etc/passwd',
    'P|' + hex('MCmYXNxgcu.DisneyPlus') + '|' + hex('/opt/usr/apps/MCmYXNxgcu/shared/res/disney.png'),
    'P|' + hex('com.samsung.tv.tvplus') + '|' + hex('/opt/usr/apps/com.samsung.tv.tvplus/shared/res/tvplus.png'),
    'P|' + hex('evil') + '|' + hex('/opt/usr/apps/../../etc/x.png')
].join('\n');

const parsed = catalog.parse(OUTPUT);
assert.deepEqual(parsed.order, ['s/livetv@TVPLUS', 's/livetv@RF', 'd/webapp@aaa', 'd/webapp@bbb', 'd/webapp@hid', 'd/webapp@gone', 'd/webapp@dup', 's/livetv@WHAT'],
    'order keeps its sequence and drops lines that are not entries');
assert.equal(parsed.registry.aaa.appId, 'org.tizen.netflix-app');
assert.equal(parsed.registry.hid.hidden, true);
assert.ok(!parsed.registry.zz, 'a row that is not hex is skipped, not fatal');
assert.equal(parsed.icons.aaa, '/opt/share/webappservice/apps_icon/all/aaa/224x224.png');
assert.ok(!parsed.icons.bbb, 'an icon outside the allowed folders is refused');
assert.ok(!parsed.packageIcons.evil, 'a package icon with parent directories is refused');

const built = catalog.build(parsed);
assert.deepEqual(built.entries.map(e => e.slug), ['tvplus', 'livetv', 'netflix', 'disney', 'netflix-2'], 'Home order, unique slugs');
assert.equal(built.entries[0].appId, 'org.tizen.tv-viewer');
assert.equal(built.entries[0].icon, '/opt/usr/apps/com.samsung.tv.tvplus/shared/res/tvplus.png', 'TV Plus uses its package icon');
assert.equal(built.entries[1].icon, null, 'live TV has none: the dock draws its own');
assert.equal(built.entries[2].icon, '/opt/share/webappservice/apps_icon/all/aaa/224x224.png');
assert.equal(built.entries[3].icon, '/opt/usr/apps/MCmYXNxgcu/shared/res/disney.png', 'no registry icon: the package one');
assert.deepEqual(built.skipped.map(s => s.item + ':' + s.reason), [
    'd/webapp@hid:Hidden in the registry', 'd/webapp@gone:Not installed', 's/livetv@WHAT:Unknown live source'
], 'what was left out is reported with a reason');

const text = catalog.tsv(built);
const lines = text.trim().split('\n');
assert.ok(lines[0].startsWith('#'));
assert.equal(lines[1], 'tvplus\tSamsung TV Plus\torg.tizen.tv-viewer\t\t/opt/usr/apps/com.samsung.tv.tvplus/shared/res/tvplus.png');
assert.equal(lines[2], 'livetv\tLive TV\torg.tizen.tv-viewer', 'no icon: no trailing tabs');
assert.deepEqual(lines.slice(-2), ['settings\tSettings\tkey:XF86SysMenu\torg.tizen.menu', 'samsunghome\tSamsung Home\tsys:com.samsung.tv.csfs'], 'two pills close the row: Settings (the System Menu key) and Samsung Home');
lines.slice(1).forEach(l => assert.ok(l.split('\t').length >= 3, 'every line has slug, label and app id: ' + l));

// Names that would break the file or the dock
assert.equal(catalog.slugify('Disney+'), 'disney');
assert.equal(catalog.slugify('日本語'), 'app');
assert.equal(catalog.cleanLabel('A\tB|C\n D', 'x'), 'A B C D');
assert.equal(catalog.cleanLabel('   ', 'fallback'), 'fallback');
assert.equal(catalog.cleanLabel('x'.repeat(100), 'f').length, 40);
const reserved = catalog.build({order: ['d/webapp@s'], registry: {s: {title: 'Settings', appId: 'com.example.settings', hidden: false}}, icons: {}, packageIcons: {}});
assert.equal(reserved.entries[0].slug, 'settings-2', 'an app called Settings does not take the system entry\'s slug');
const badId = catalog.build({order: ['d/webapp@s'], registry: {s: {title: 'X', appId: 'bad id;rm', hidden: false}}, icons: {}, packageIcons: {}});
assert.equal(badId.entries.length, 0, 'an app id that is not plain is never written to the file');

// The dock holds 40 entries including the three system ones
const many = {order: [], registry: {}, icons: {}, packageIcons: {}};
for (let i = 0; i < 60; i++) { many.order.push('d/webapp@a' + i); many.registry['a' + i] = {title: 'App ' + i, appId: 'x.app' + i, hidden: false}; }
const capped = catalog.build(many);
assert.equal(capped.entries.length, 38);
assert.equal(capped.skipped.length, 22);

// Fix TizenTube: YouTube's icon, and Samsung's YouTube closed first
const tt = {order: ['d/webapp@tt', 'd/webapp@aaa'], icons: {tt: '/opt/share/webappservice/apps_icon/all/tt/icon.png', yt: '/opt/share/webappservice/apps_icon/all/yt/224x224.png', aaa: '/opt/share/webappservice/apps_icon/all/aaa/224x224.png'}, packageIcons: {},
    registry: {tt: {title: 'TizenTube', appId: 'xvvl3S1TT1.TizenTubeStandalone', hidden: false}, yt: {title: 'YouTube', appId: '9Ur5IzDKqV.TizenYouTube', hidden: false}, aaa: {title: 'Netflix', appId: 'org.tizen.netflix-app', hidden: false}}};
const plain = catalog.build(tt);
assert.equal(plain.entries[0].killFirst, null, 'off: TizenTube is launched as it is');
assert.equal(plain.entries[0].icon, '/opt/share/webappservice/apps_icon/all/tt/icon.png', 'off: its own icon');
const fixed = catalog.build(tt, {fixTizenTube: true});
assert.equal(fixed.entries[0].killFirst, 'com.samsung.tv.cobalt-yt');
assert.equal(fixed.entries[0].icon, '/opt/share/webappservice/apps_icon/all/yt/224x224.png', 'on: the YouTube tile icon');
assert.equal(fixed.entries[0].label, 'TizenTube', 'the name is left alone');
assert.equal(fixed.entries[1].killFirst, null, 'other apps are untouched');
assert.equal(fixed.entries[1].icon, plain.entries[1].icon);
assert.equal(catalog.tsv(fixed).split('\n')[1], 'tizentube\tTizenTube\txvvl3S1TT1.TizenTubeStandalone\t\t/opt/share/webappservice/apps_icon/all/yt/224x224.png\tcom.samsung.tv.cobalt-yt');
assert.equal(catalog.tsv(plain).split('\n')[1].split('\t').length, 5, 'no sixth column when off');
const noYt = catalog.build(Object.assign({}, tt, {icons: {tt: tt.icons.tt}}), {fixTizenTube: true});
assert.equal(noYt.entries[0].killFirst, 'com.samsung.tv.cobalt-yt', 'still closes YouTube first');
assert.equal(noYt.entries[0].icon, tt.icons.tt, 'without a YouTube icon the app keeps its own');
assert.ok(noYt.skipped.some(x => /No YouTube icon/.test(x.reason)));

// load(): one read of the Home data, one check that the icon files exist; errors are explicit
(async function () {
    const missing = '/opt/usr/apps/com.samsung.tv.tvplus/shared/res/tvplus.png';
    const run = (home, exists) => async cmd => {
        const script = Buffer.from(cmd.split(' ')[1], 'base64').toString();
        seen.push(script);
        if (script.includes('.appLayerCache')) return home;
        const out = (script.match(/'[^']+'/g) || []).map(p => p.slice(1, -1)).filter(exists).map(p => 'OK|' + p).join('\n');
        return {exit_code: 0, stdout: out};
    };
    const seen = [];
    const ok = await catalog.load(run({exit_code: 0, stdout: OUTPUT}, p => p !== missing));
    assert.equal(ok.count, 5);
    assert.ok(/appLayerCache/.test(seen[0]) && seen.length === 2, 'two read-only calls');
    assert.ok(seen.every(sc => !/\b(rm|mv|cp|tee|chmod|kill)\b|>\s*\/(?!dev\/null)/.test(sc)), 'neither script writes anything');
    assert.ok(seen[0].includes('.webappservice.db') && seen[0].includes('-readonly'), 'reads only');
    assert.ok(!ok.tsv.includes(missing), 'an icon file that is gone is not listed');
    const alt = '/opt/usr/apps/com.samsung.tv.tvPlusDeeplinker/shared/res/TVPlus_app_icon.png';
    assert.ok(ok.tsv.includes('tvplus\tSamsung TV Plus\torg.tizen.tv-viewer\t\t' + alt + '\n'), 'TV Plus: the stale package icon gives way to the deep-link package icon');
    assert.ok(!ok.skipped.some(x => x.item === 'tvplus'), 'nothing to report when the second icon exists');
    const bare = await catalog.load(run({exit_code: 0, stdout: OUTPUT}, p => p !== missing && p !== alt));
    assert.ok(bare.tsv.includes('tvplus\tSamsung TV Plus\torg.tizen.tv-viewer\n'), 'neither icon exists: TV Plus keeps a generic one');
    assert.ok(bare.skipped.some(x => x.item === 'tvplus' && /Icon file missing/.test(x.reason)));
    assert.ok(ok.tsv.includes('/opt/share/webappservice/apps_icon/all/aaa/224x224.png'), 'icons that exist stay');
    // If the existence check itself fails, the paths stay (the dock copes with an unloadable file)
    const lenient = await catalog.load(async cmd => {
        const script = Buffer.from(cmd.split(' ')[1], 'base64').toString();
        if (script.includes('.appLayerCache')) return {exit_code: 0, stdout: OUTPUT};
        throw new Error('busy');
    });
    assert.ok(lenient.tsv.includes(missing));
    await assert.rejects(catalog.load(async () => ({exit_code: 0, stdout: 'S|csfs\nR|' + hex('a') + '|' + hex('A') + '|' + hex('x.a') + '|0'})), /empty or unreadable/);
    await assert.rejects(catalog.load(async () => ({exit_code: 0, stdout: ''})), /empty or unreadable/);
    const registryOnly = await catalog.load(async () => ({exit_code: 0, stdout: 'R|' + hex('a') + '|' + hex('A') + '|' + hex('x.a') + '|0'}));
    assert.equal(registryOnly.count, 1, 'no Home row of either kind: the registry alone makes the dock');
    await assert.rejects(catalog.load(async () => ({exit_code: 0, stdout: 'O|d/webapp@zz'})), /could be matched/);
    await assert.rejects(catalog.load(async () => ({exit_code: 1, stdout: '', stderr: 'boom'})), /boom/);
    await assert.rejects(catalog.load(async () => ({exit_code: 0, timed_out: true, stdout: ''})), /unavailable/);
    console.log('PASS dock catalog: Home row, registry and icons become the dock list');
})().catch(e => { console.error(e); process.exitCode = 1; });

// 2022 Home (S95B): csfs has no row, the Media hub's file is the "recent" strip; the registry completes the list.
{
    const MEDIA = [
        'S|media', 'O|274', 'O|s/source.layer.hdmi@HDMI1', 'O|d/webapp@hue', 'O|s/source.layer.hdmi@HDMI4', 'O|s/livetv@HDMI3', 'O|EOFCOBA',
        'R|' + hex('hue') + '|' + hex('Hue Sync') + '|' + hex('kupCeIdDkX.HueSync') + '|0',
        'R|' + hex('yt') + '|' + hex('YouTube') + '|' + hex('9Ur5IzDKqV.TizenYouTube') + '|0',
        'R|' + hex('br') + '|' + hex('Browser') + '|' + hex('org.tizen.browser') + '|0',
        'R|' + hex('vt') + '|' + hex('Vetro') + '|' + hex('vetrotvapp.app') + '|0',
        'R|' + hex('tpl') + '|' + hex('Water') + '|' + hex('com.samsung.tv.water-tpl') + '|1',
        'I|yt|/opt/share/webappservice/apps_icon/all/yt/224x224.png'
    ].join('\n');
    const p = catalog.parse(MEDIA);
    assert.equal(p.source, 'media');
    assert.deepEqual(p.order, ['d/webapp@hue', 's/livetv@HDMI3'], 'input strips are not entries');
    const b = catalog.build(p, {});
    assert.deepEqual(b.entries.map(e => e.appId), ['kupCeIdDkX.HueSync', 'org.tizen.browser', '9Ur5IzDKqV.TizenYouTube'],
        'the recent strip comes first, then the other visible apps by title; hidden apps and Vetro stay out');
    assert.equal(b.entries[2].icon, '/opt/share/webappservice/apps_icon/all/yt/224x224.png', 'completed apps keep their registry icon');
    assert.ok(b.skipped.some(s => s.item === 's/livetv@HDMI3'), 'an unknown live source is reported, not fatal');
}
// A csfs row keeps today's behaviour: nothing is appended from the registry.
{
    const p = catalog.parse(['S|csfs', 'O|d/webapp@aaa', 'R|' + hex('aaa') + '|' + hex('Netflix') + '|' + hex('org.tizen.netflix-app') + '|0',
        'R|' + hex('bbb') + '|' + hex('Browser') + '|' + hex('org.tizen.browser') + '|0'].join('\n'));
    assert.equal(p.source, 'csfs');
    assert.deepEqual(catalog.build(p, {}).entries.map(e => e.appId), ['org.tizen.netflix-app']);
}
// No row at all but a registry: still a dock.
{
    const p = catalog.parse(['R|' + hex('bbb') + '|' + hex('Browser') + '|' + hex('org.tizen.browser') + '|0'].join('\n'));
    assert.equal(p.source, null);
    assert.deepEqual(catalog.build(p, {}).entries.map(e => e.appId), ['org.tizen.browser']);
}
console.log('dock-catalog 2022 Home: ok');

// Apps hidden by choice (options.hidden): left out of the row and of the completion, reported with a reason.
{
    const p = catalog.parse(['S|media', 'O|d/webapp@hue', 'R|' + hex('hue') + '|' + hex('Hue Sync') + '|' + hex('kupCeIdDkX.HueSync') + '|0',
        'R|' + hex('br') + '|' + hex('Browser') + '|' + hex('org.tizen.browser') + '|0', 'R|' + hex('yt') + '|' + hex('YouTube') + '|' + hex('9Ur5IzDKqV.TizenYouTube') + '|0'].join('\n'));
    const b = catalog.build(p, {hidden: ['org.tizen.browser', 'kupCeIdDkX.HueSync', 'bad id;']});
    assert.deepEqual(b.entries.map(e => e.appId), ['9Ur5IzDKqV.TizenYouTube'], 'hidden apps are out of the row and of the completion');
    assert.ok(b.skipped.some(s => s.item === 'd/webapp@hue' && /Hidden from the launcher/.test(s.reason)));
}
console.log('dock-catalog hidden: ok');
