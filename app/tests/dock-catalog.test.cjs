'use strict';
const assert = require('assert').strict;
const catalog = require('../service/dock-catalog.js');

const hex = s => Buffer.from(s).toString('hex');
const OUTPUT = [
    'F|csfs', 'O|s/livetv@TVPLUS', 'O|s/livetv@RF', 'O|d/webapp@aaa', 'O|d/webapp@bbb', 'O|d/webapp@hid', 'O|d/webapp@gone', 'O|d/webapp@dup', 'O|s/livetv@WHAT', 'O|junk line', 'O|EOFCOBA',
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
assert.equal(lines[1], 'tvplus\tSamsung TV Plus\torg.tizen.tv-viewer\t\t/opt/usr/apps/com.samsung.tv.tvplus/shared/res/tvplus.png\t\t\tlive:TVPLUS', 'the eighth column is the row key');
assert.equal(lines[2], 'livetv\tLive TV\tsource:0\t\t\t\t\tlive:RF', 'Live TV switches to the TV input (the tuner covers that input only); no icon: empty columns up to the row key');
assert.deepEqual(lines.slice(-2), ['allapps\tAll apps\tpanel:allapps', 'samsunghome\tSamsung Home\tsys:com.samsung.tv.csfs'], 'two pills close the row: All apps (its page ends with Settings and the App store) and Samsung Home');
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
assert.equal(catalog.tsv(fixed).split('\n')[1], 'tizentube\tTizenTube\txvvl3S1TT1.TizenTubeStandalone\t\t/opt/share/webappservice/apps_icon/all/yt/224x224.png\tcom.samsung.tv.cobalt-yt\t\tapp:xvvl3S1TT1.TizenTubeStandalone');
assert.equal(catalog.tsv(plain).split('\n')[1].split('\t')[5], '', 'no app to close first when off');
const noYt = catalog.build(Object.assign({}, tt, {icons: {tt: tt.icons.tt}}), {fixTizenTube: true});
assert.equal(noYt.entries[0].killFirst, 'com.samsung.tv.cobalt-yt', 'still closes YouTube first');
assert.equal(noYt.entries[0].icon, tt.icons.tt, 'without a YouTube icon the app keeps its own');
assert.ok(noYt.skipped.some(x => /No YouTube icon/.test(x.reason)));

// Samsung's YouTube: the Home row lists widget 111299001912, the wrapper app and its registry row are gone, Cobalt YouTube is installed
const pkgs = {}; for (let i = 0; i < 25; i++) pkgs['p.' + i] = true;
const ytGone = {order: ['d/webapp@111299001912', 'd/webapp@aaa'], icons: {'111299001912': '/opt/share/webappservice/apps_icon/all/111299001912/224x224.png'}, packageIcons: {},
    registry: {aaa: {title: 'Netflix', appId: 'org.tizen.netflix-app', hidden: false}}, installed: Object.assign({'com.samsung.tv.cobalt-yt': true, 'org.tizen.netflix-app': true}, pkgs), installedCount: 27};
const ytBuilt = catalog.build(ytGone);
assert.equal(ytBuilt.entries[0].appId, 'com.samsung.tv.cobalt-yt', 'YouTube is started through the Cobalt app');
assert.equal(ytBuilt.entries[0].label, 'YouTube');
assert.equal(ytBuilt.entries[0].icon, '/opt/share/webappservice/apps_icon/all/111299001912/224x224.png');
assert.equal(ytBuilt.skipped.length, 0, 'shown, so not listed as skipped');
const ytNoCobalt = catalog.build(Object.assign({}, ytGone, {installed: Object.assign({'org.tizen.netflix-app': true}, pkgs), installedCount: 26}));
assert.equal(ytNoCobalt.entries.length, 1, 'no Cobalt app: the row stays out');
assert.equal(ytNoCobalt.skipped[0].reason, 'Not installed');
const ytShort = catalog.build(Object.assign({}, ytGone, {installedCount: 3}));
assert.equal(ytShort.entries.length, 1, 'a short package list is not trusted: the row stays out');
// Same fallback when the wrapper package was uninstalled but its widgetinfo row remained in webappservice.db
const ytStaleReg = catalog.build(Object.assign({}, ytGone, {registry: Object.assign({'111299001912': {title: 'YouTube', appId: '9Ur5IzDKqV.TizenYouTube', hidden: false}}, ytGone.registry)}));
assert.equal(ytStaleReg.entries[0].appId, 'com.samsung.tv.cobalt-yt', 'stale wrapper registry row still falls back to Cobalt YouTube');
assert.equal(ytStaleReg.skipped.length, 0);

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
    assert.ok(ok.tsv.includes('tvplus\tSamsung TV Plus\torg.tizen.tv-viewer\t\t' + alt + '\t\t\tlive:TVPLUS\n'), 'TV Plus: the stale package icon gives way to the deep-link package icon');
    assert.ok(!ok.skipped.some(x => x.item === 'tvplus'), 'nothing to report when the second icon exists');
    const bare = await catalog.load(run({exit_code: 0, stdout: OUTPUT}, p => p !== missing && p !== alt));
    assert.ok(bare.tsv.includes('tvplus\tSamsung TV Plus\torg.tizen.tv-viewer\t\t\t\t\tlive:TVPLUS\n'), 'neither icon exists: TV Plus keeps a generic one');
    assert.ok(bare.skipped.some(x => x.item === 'tvplus' && /Icon file missing/.test(x.reason)));
    assert.ok(ok.tsv.includes('/opt/share/webappservice/apps_icon/all/aaa/224x224.png'), 'icons that exist stay');
    // If the existence check itself fails, the paths stay (the dock copes with an unloadable file)
    const lenient = await catalog.load(async cmd => {
        const script = Buffer.from(cmd.split(' ')[1], 'base64').toString();
        if (script.includes('.appLayerCache')) return {exit_code: 0, stdout: OUTPUT};
        throw new Error('busy');
    });
    assert.ok(lenient.tsv.includes(missing));
    await assert.rejects(catalog.load(async () => ({exit_code: 0, stdout: 'F|csfs\nR|' + hex('a') + '|' + hex('A') + '|' + hex('x.a') + '|0'})), /empty or unreadable/);
    await assert.rejects(catalog.load(async () => ({exit_code: 0, stdout: ''})), /empty or unreadable/);
    const registryOnly = await catalog.load(async () => ({exit_code: 0, stdout: 'R|' + hex('a') + '|' + hex('A') + '|' + hex('x.a') + '|0'}));
    assert.equal(registryOnly.count, 1, 'no Home row of either kind: the registry alone makes the dock');
    await assert.rejects(catalog.load(async () => ({exit_code: 0, stdout: 'O|d/webapp@zz'})), /could be matched/);
    await assert.rejects(catalog.load(async () => ({exit_code: 1, stdout: '', stderr: 'boom'})), /boom/);
    await assert.rejects(catalog.load(async () => ({exit_code: 0, timed_out: true, stdout: ''})), /unavailable/);
    console.log('PASS dock catalog: Home row, registry and icons become the dock list');
})().catch(e => { console.error(e); process.exitCode = 1; });

// The pill always opens csfs, even where the Home component package is installed (it has no entry point: #170, #175, #210).
const coba = catalog.build(catalog.parse(OUTPUT + '\nH|com.samsung.tv.coba.newhome'));
assert.ok(catalog.tsv(coba).includes('samsunghome\tSamsung Home\tsys:com.samsung.tv.csfs\n') || catalog.tsv(coba).includes('samsunghome\tSamsung Home\tsys:com.samsung.tv.csfs\t'));
assert.ok(!catalog.tsv(coba).includes('coba.newhome'));
assert.equal(catalog.parse('H|bad;command').homeApp, null);

// 2022 Home (S95B), PR #43 by arnaudaprahamian: csfs has no row, the Media hub's file is the "recent" strip;
// the registry completes the list.
{
    const MEDIA = [
        'F|media', 'O|274', 'O|s/source.layer.hdmi@HDMI1', 'O|d/webapp@hue', 'O|s/source.layer.hdmi@HDMI4', 'O|s/livetv@HDMI3', 'O|EOFCOBA',
        'R|' + hex('hue') + '|' + hex('Hue Sync') + '|' + hex('kupCeIdDkX.HueSync') + '|0',
        'R|' + hex('yt') + '|' + hex('YouTube') + '|' + hex('9Ur5IzDKqV.TizenYouTube') + '|0',
        'R|' + hex('br') + '|' + hex('Browser') + '|' + hex('org.tizen.browser') + '|0',
        'R|' + hex('vt') + '|' + hex('Vetro') + '|' + hex('vetrotvapp.app') + '|0',
        'R|' + hex('tpl') + '|' + hex('Water') + '|' + hex('com.samsung.tv.water-tpl') + '|1',
        'I|yt|/opt/share/webappservice/apps_icon/all/yt/224x224.png'
    ].join('\n');
    const p = catalog.parse(MEDIA);
    assert.equal(p.rowFrom, 'media');
    assert.deepEqual(p.order, ['s/source.layer.hdmi@HDMI1', 'd/webapp@hue', 's/source.layer.hdmi@HDMI4', 's/livetv@HDMI3'], 'numbers are not entries');
    const b = catalog.build(p, {});
    assert.deepEqual(b.entries.map(e => e.appId), ['kupCeIdDkX.HueSync', 'org.tizen.browser', '9Ur5IzDKqV.TizenYouTube'],
        'the recent strip comes first, then the other visible apps by title; hidden apps and Vetro stay out');
    assert.equal(b.entries[2].icon, '/opt/share/webappservice/apps_icon/all/yt/224x224.png', 'completed apps keep their registry icon');
    assert.ok(b.skipped.some(s => s.item === 's/livetv@HDMI3'), 'an unknown live source is reported, not fatal');
}
// A csfs row keeps today's behaviour: nothing is appended from the registry.
{
    const p = catalog.parse(['F|csfs', 'O|d/webapp@aaa', 'R|' + hex('aaa') + '|' + hex('Netflix') + '|' + hex('org.tizen.netflix-app') + '|0',
        'R|' + hex('bbb') + '|' + hex('Browser') + '|' + hex('org.tizen.browser') + '|0'].join('\n'));
    assert.equal(p.rowFrom, 'csfs');
    assert.deepEqual(catalog.build(p, {}).entries.map(e => e.appId), ['org.tizen.netflix-app']);
}
// No row at all but a registry: still a dock.
{
    const p = catalog.parse(['R|' + hex('bbb') + '|' + hex('Browser') + '|' + hex('org.tizen.browser') + '|0'].join('\n'));
    assert.equal(p.rowFrom, null);
    assert.deepEqual(catalog.build(p, {}).entries.map(e => e.appId), ['org.tizen.browser']);
}
// The script reports which Home the row came from.
assert.match(catalog.script(), /echo "F\|\$F"/);
console.log('dock-catalog 2022 Home: ok');

// An app removed with pkgcmd leaves its row in Samsung's web app registry and its entry in the Home row. The package
// list shows it is gone, so the dock does not build a tile that would not open. A short package list proves nothing.
{
    const pkgs = Array.from({length: 30}, (_, i) => 'A|' + hex('pkg.app' + i));
    const base = ['F|csfs', 'O|d/webapp@live', 'O|d/webapp@dead',
        'R|' + hex('live') + '|' + hex('Live App') + '|' + hex('pkg.app1') + '|0',
        'R|' + hex('dead') + '|' + hex('Removed App') + '|' + hex('pkg.removed') + '|0'];
    const full = catalog.build(catalog.parse(base.concat(pkgs).join('\n')));
    assert.deepEqual(full.entries.map(e => e.appId), ['pkg.app1'], 'the registry row without a package gets no tile');
    assert.ok(full.skipped.some(s => s.item === 'd/webapp@dead' && s.reason === 'Not installed'));
    const short = catalog.build(catalog.parse(base.concat(pkgs.slice(0, 3)).join('\n')));
    assert.deepEqual(short.entries.map(e => e.appId).sort(), ['pkg.app1', 'pkg.removed'], 'a short package list is not trusted');
    const none = catalog.build(catalog.parse(base.join('\n')));
    assert.equal(none.entries.length, 2, 'no package list at all (the query failed): nothing is filtered');
    assert.ok(catalog.script().includes("hex(app_id)||'|'||ifnull(app_disable,'false') FROM package_app_info;"), 'the script asks for the package list, with the disabled flag');
    // An app disabled in Quick settings or in Apps and processes cannot start: it gets no tile, on the row or on All apps,
    // and the page can say why. Enabled again, it is back. Lines of the older form (no third field) still read as installed.
    const flagged = pkgs.map(l => l + '|false').concat('A|' + hex('pkg.off') + '|true');
    const withOff = ['F|csfs', 'O|d/webapp@live', 'O|d/webapp@off',
        'R|' + hex('live') + '|' + hex('Live App') + '|' + hex('pkg.app1') + '|0|1',
        'R|' + hex('off') + '|' + hex('Switched Off') + '|' + hex('pkg.off') + '|0|1'];
    const off = catalog.build(catalog.parse(withOff.concat(flagged).join('\n')));
    assert.deepEqual(off.entries.map(e => e.appId), ['pkg.app1'], 'a disabled app gets no tile');
    assert.ok(off.skipped.some(s => s.item === 'd/webapp@off' && s.reason === 'Disabled'));
    assert.ok(!/pkg\.off/.test(off.allAppsTsv), 'and it is not on All apps either');
    const on = catalog.build(catalog.parse(withOff.concat(pkgs.map(l => l + '|false'), 'A|' + hex('pkg.off') + '|false').join('\n')));
    assert.deepEqual(on.entries.map(e => e.appId), ['pkg.app1', 'pkg.off'], 'enabled again, it is back');
}
console.log('PASS dock catalog skips registry rows whose package is gone');

// TV-Store (A2STVStore.Store) takes the store pill of All apps when it is installed and switched on, unless the user chose Samsung's
// store; Samsung's store stays its fallback. TV-Store itself stays in the A-Z list (it can be put in the row), under its own slug.
{
    const pkgs = Array.from({length: 30}, (_, i) => 'A|' + hex('pkg.app' + i) + '|false');
    const base = ['F|csfs', 'O|d/webapp@live',
        'R|' + hex('live') + '|' + hex('Live App') + '|' + hex('pkg.app1') + '|0|1',
        'R|' + hex('tvs') + '|' + hex('TV-Store') + '|' + hex(catalog.TV_STORE) + '|0|1'];
    const pills = t => t.trim().split('\n').slice(-2);
    const SAMSUNG = 'store\tApp store\tsys:com.samsung.tv.store', TVSTORE = 'tvstore\tTV-Store\tsys:A2STVStore.Store\tcom.samsung.tv.store';
    const without = catalog.build(catalog.parse(base.concat(pkgs).join('\n')));
    assert.equal(without.tvStoreInstalled, false);
    assert.deepEqual(pills(catalog.allAppsTsv(without)), ['settings\tSettings\tkey:XF86SysMenu\torg.tizen.menu', SAMSUNG], 'TV-Store not installed: Samsung\'s store');
    const lines = base.concat(pkgs, 'A|' + hex(catalog.TV_STORE) + '|false').join('\n');
    const withIt = catalog.build(catalog.parse(lines));
    assert.equal(withIt.tvStoreInstalled, true);
    assert.equal(withIt.appStore, 'tvstore');
    const text = catalog.allAppsTsv(withIt);
    assert.equal(pills(text)[1], TVSTORE, 'installed: the pill opens TV-Store, Samsung\'s store if it does not start');
    const slugs = text.trim().split('\n').filter(l => !l.startsWith('#')).map(l => l.split('\t')[0]);
    assert.equal(new Set(slugs).size, slugs.length, 'no slug twice: the dock would drop the second line, the pill');
    assert.ok(slugs.includes('tv-store'), 'TV-Store is also on the A-Z list, so it can be put in the row');
    const chosen = catalog.build(catalog.parse(lines), {appStore: 'samsung'});
    assert.equal(chosen.appStore, 'samsung');
    assert.equal(pills(catalog.allAppsTsv(chosen))[1], SAMSUNG, 'the user chose Samsung\'s store');
    const off = catalog.build(catalog.parse(base.concat(pkgs, 'A|' + hex(catalog.TV_STORE) + '|true').join('\n')));
    assert.equal(pills(catalog.allAppsTsv(off))[1], SAMSUNG, 'TV-Store disabled on the TV: Samsung\'s store');
    // An app named "TVStore" would slug like the pill: it gets another slug.
    const named = catalog.build(catalog.parse(base.concat(pkgs, 'A|' + hex(catalog.TV_STORE) + '|false', 'O|d/webapp@x',
        'R|' + hex('x') + '|' + hex('TVStore') + '|' + hex('pkg.app2') + '|0|1').join('\n')));
    assert.ok(named.entries.every(e => e.slug !== 'tvstore') && named.allApps.every(e => e.slug !== 'tvstore'), 'the pill\'s slug is reserved');
}
console.log('PASS dock catalog: TV-Store takes the store pill when installed, unless Samsung\'s store is chosen');
