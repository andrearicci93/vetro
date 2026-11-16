'use strict';
// The user's own launcher row (moved, taken out, added from All apps) laid over Samsung's Home row, and the All apps list.
// Synthetic apps only.
const assert = require('assert').strict;
const fs = require('fs'), os = require('os'), path = require('path');
const catalog = require('../service/dock-catalog.js');
const {Dock, rowAfter, cleanRow} = require('../service/dock.js');

const hex = s => Buffer.from(s).toString('hex');
const reg = (id, title, appId, hidden, featured) => 'R|' + hex(id) + '|' + hex(title) + '|' + hex(appId) + '|' + (hidden ? 1 : 0) + (featured == null ? '' : '|' + featured);
const HOME = [
    'F|csfs', 'O|s/livetv@TVPLUS', 'O|d/webapp@net', 'O|d/webapp@rai',
    reg('net', 'Netflix', 'org.example.netflix', false, 2),
    reg('rai', 'RaiPlay', 'org.example.rai', false, 1),
    reg('str', 'Stremio', 'org.example.stremio', false, 1),          // installed, not in Samsung's row: only in All apps
    reg('amb', 'Ambient Template', 'org.example.tpl', true, 4),     // hidden template: never listed
    reg('ads', 'Ad Player', 'org.example.ads', true, 1),            // hidden helper: never listed
    reg('tpl', 'Visible Template', 'org.example.tpl2', false, 4),   // not an app Samsung's Apps screen shows
    reg('vet', 'Vetro', 'vetrotvapp.app', false, 1),                // Vetro itself is not offered
    reg('old', 'Old Row', 'org.example.old', false)                 // an older read without app_featured: kept
].concat(['org.example.netflix', 'org.example.rai', 'org.example.stremio', 'org.example.tpl', 'org.example.ads', 'org.example.tpl2', 'vetrotvapp.app', 'org.example.old']
    .concat(Array.from({length: 20}, (_, i) => 'org.filler.app' + i)).map(a => 'A|' + hex(a))).join('\n');

const parsed = catalog.parse(HOME);
assert.equal(parsed.registry.net.featured, 2, 'app_featured is read');
assert.equal(parsed.registry.old.featured, null, 'a row without it reads as unknown');

// No row of the user's: Samsung's row as it is; All apps lists it plus the registry's visible apps, by name, each once
const plain = catalog.build(parsed);
assert.deepEqual(plain.entries.map(e => e.key), ['live:TVPLUS', 'app:org.example.netflix', 'app:org.example.rai']);
assert.deepEqual(plain.allApps.map(e => e.label), ['Netflix', 'Old Row', 'RaiPlay', 'Samsung TV Plus', 'Stremio'], 'no hidden helper, no template, no Vetro, no repeat');
assert.deepEqual(plain.samsungKeys, ['live:TVPLUS', 'app:org.example.netflix', 'app:org.example.rai']);
const all = catalog.allAppsTsv(plain).trim().split('\n');
assert.ok(all[0].startsWith('#'));
assert.deepEqual(all.slice(-2), ['settings\tSettings\tkey:XF86SysMenu\torg.tizen.menu', 'store\tApp store\tsys:com.samsung.tv.store'], 'the All apps page ends with Settings and the App store');
assert.ok(all.some(l => l.split('\t')[0] === 'stremio' && l.endsWith('\tapp:org.example.stremio')), 'every app line carries its row key');
const slugs = all.slice(1).map(l => l.split('\t')[0]);
assert.equal(new Set(slugs).size, slugs.length, 'slugs are unique across the page');

// The user's row: their order, a tile added from All apps, one of Samsung's taken out, a new name
const mine = catalog.build(parsed, {row: {order: ['app:org.example.stremio', 'app:org.example.rai'], hidden: ['live:TVPLUS'], labels: {'app:org.example.rai': 'Rai'}}});
assert.deepEqual(mine.entries.map(e => e.key), ['app:org.example.stremio', 'app:org.example.rai', 'app:org.example.netflix'],
    'their order, then what Samsung has and they did not place (a new app arrives at the end), without what they took out');
assert.equal(mine.entries[1].label, 'Rai', 'a custom name');
assert.deepEqual(mine.samsungKeys, ['live:TVPLUS', 'app:org.example.netflix', 'app:org.example.rai'], 'Samsung\'s row is still known');
assert.ok(mine.allApps.some(e => e.key === 'live:TVPLUS'), 'a tile taken out can be added back from All apps');
const gone = catalog.build(parsed, {row: {order: ['app:org.removed.app', 'app:org.example.rai'], hidden: []}});
assert.deepEqual(gone.entries.map(e => e.key), ['app:org.example.rai', 'live:TVPLUS', 'app:org.example.netflix'], 'an app that is not on the TV any more is dropped quietly');

// rowAfter: the row the dock sends back becomes the order; Samsung tiles left out are remembered as taken out
const row = rowAfter(null, ['app:org.example.rai', 'app:org.example.stremio'], ['live:TVPLUS', 'app:org.example.netflix', 'app:org.example.rai']);
assert.deepEqual(row.order, ['app:org.example.rai', 'app:org.example.stremio']);
assert.deepEqual(row.hidden, ['live:TVPLUS', 'app:org.example.netflix']);
const back = rowAfter(row, ['live:TVPLUS', 'app:org.example.rai', 'app:org.example.stremio'], ['live:TVPLUS', 'app:org.example.netflix', 'app:org.example.rai']);
assert.deepEqual(back.hidden, ['app:org.example.netflix'], 'a tile put back is no longer taken out');
assert.equal(cleanRow({order: ['app:ok', 'bad key', 'app:ok', 'app:x;rm'], hidden: 'x', labels: {'app:ok': 'A\tB', nope: 'x'}}).order.join(), 'app:ok', 'only real keys, once');
assert.deepEqual(cleanRow({order: [], labels: {'app:ok': 'A\tB', nope: 'x'}}).labels, {'app:ok': 'A B'});
assert.equal(cleanRow('x'), null);

// setRow: saved, the lists written again, the launcher not restarted; refused when the list is bad or the launcher is off
(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-row-'));
    let restarts = 0;
    const execute = async cmd => {
        const script = Buffer.from(cmd.split(' ')[1] || '', 'base64').toString();
        if (script.includes('.appLayerCache')) return {exit_code: 0, stdout: HOME};
        return {exit_code: 0, stdout: ''};
    };
    const d = new Dock({execute, stateFile: path.join(tmp, 's.json'), dir: tmp, appsFile: path.join(tmp, 'apps.tsv'), rowRetryMs: 10});
    d.refresh = async () => { restarts++; return {}; };
    d.status = async () => ({});
    await assert.rejects(d.setRow(['app:org.example.rai']), /launcher is off/);
    d.patchState({enabled: true});
    await assert.rejects(d.setRow([]), /Invalid row/);
    await assert.rejects(d.setRow(['app:x;rm -rf']), /Invalid row/);
    await d.setRow(['app:org.example.stremio', 'app:org.example.rai']);
    assert.deepEqual(d.readState().row.order, ['app:org.example.stremio', 'app:org.example.rai']);
    assert.deepEqual(d.readState().row.hidden, ['live:TVPLUS', 'app:org.example.netflix']);
    const apps = fs.readFileSync(path.join(tmp, 'apps.tsv'), 'utf8').split('\n').filter(l => l && l[0] !== '#').map(l => l.split('\t')[0]);
    assert.deepEqual(apps, ['stremio', 'raiplay', 'allapps', 'samsunghome'], 'the list the next start reads');
    assert.ok(fs.existsSync(d.allAppsFile), 'and the All apps list');
    assert.equal(restarts, 0, 'the running launcher already shows it: no restart');
    assert.match(d.startScript(), / --all-apps '[^']+allapps\.tsv'/);
    // Two holds in a row on All apps: the second row arrives while the first is being saved, and is the one that stays.
    const first = d.setRow(['app:org.example.rai']);
    const second = await d.setRow(['app:org.example.netflix', 'app:org.example.rai']);
    assert.deepEqual(second, {queued: true}, 'the second waits');
    await first;
    assert.deepEqual(d.readState().row.order, ['app:org.example.netflix', 'app:org.example.rai'], 'and is saved once the first is done');
    assert.ok(fs.readFileSync(path.join(tmp, 'apps.tsv'), 'utf8').includes('netflix\tNetflix'), 'in the list too');
    // A row sent while another launcher change runs (a refresh): applied when it ends.
    d.busy = true;
    assert.deepEqual(await d.setRow(['app:org.example.stremio']), {queued: true});
    d.busy = false;
    await new Promise(r => setTimeout(r, 80));
    assert.deepEqual(d.readState().row.order, ['app:org.example.stremio'], 'applied after the other change');
    await d.resetRow();
    assert.equal(d.readState().row, null, 'reset: Samsung\'s row again');
    assert.equal(restarts, 1, 'the reset restarts the launcher so it shows Samsung\'s row');
    console.log('PASS launcher row: the user\'s order over Samsung\'s row, taken out and added back, All apps list, saved without a restart');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
