'use strict';
// Sources in the user's row: every input of the Sources page carries its row key, every input can be resolved in the row (hold OK on
// Sources adds it), whatever showHomeSources says, and the whole path from the launcher's POST to the three lists works. Synthetic data.
const assert = require('assert').strict;
const fs = require('fs'), os = require('os'), path = require('path');
const catalog = require('../service/dock-catalog.js');
const {Dock} = require('../service/dock.js');
const {PluginHost} = require('../service/plugin-host.js');
const launcher = require('../service/plugin-launcher.js');

const hex = s => Buffer.from(s).toString('hex');
const reg = (id, title, appId) => 'R|' + hex(id) + '|' + hex(title) + '|' + hex(appId) + '|0|1';
const SOURCES = 'S|' + Buffer.from(JSON.stringify({HDMI1: {DetectedName: 'Console'}})).toString('base64');
// Samsung's row holds HDMI 1 (and Live TV); HDMI 2 and TV are only on the Sources page.
const HOME = ['F|csfs', 'O|d/webapp@net', 'O|s/source.layer.hdmi@HDMI1', 'O|s/livetv@RF', 'O|d/webapp@rai', SOURCES,
    reg('net', 'Netflix', 'org.example.netflix'), reg('rai', 'RaiPlay', 'org.example.rai'), reg('in', 'In HDMI2', 'org.example.inhdmi2')]
    .concat(['org.example.netflix', 'org.example.rai', 'org.example.inhdmi2'].concat(Array.from({length: 20}, (_, i) => 'org.filler.app' + i)).map(a => 'A|' + hex(a))).join('\n');
const parsed = catalog.parse(HOME);
const lines = text => text.split('\n').filter(l => l && l[0] !== '#');
const keyOf = line => line.split('\t')[7] || null;

// The Sources page: five inputs in port order, each with its row key in the eighth column (TV is source:0).
const plain = catalog.build(parsed, {});
assert.deepEqual(lines(catalog.inputsTsv(plain)).map(keyOf), ['source:0', 'source:13', 'source:14', 'source:15', 'source:16'], 'every input carries its row key');
assert.equal(lines(catalog.inputsTsv(plain))[1].split('\t')[1], 'HDMI 1 - Console', 'the Sources page keeps its port label');
assert.deepEqual(plain.entries.map(e => e.key), ['app:org.example.netflix', 'live:RF', 'app:org.example.rai'], 'showHomeSources off: no source arrives by itself');
assert.ok(!plain.allApps.some(e => /^source:/.test(e.key)), 'All apps lists no input');

// Added from Sources (not on Samsung's row): in the row, at its place in the order, the same tile showHomeSources makes.
const mine = catalog.build(parsed, {row: {order: ['source:14', 'app:org.example.rai', 'source:0'], hidden: [], exact: true}});
assert.deepEqual(mine.entries.map(e => e.key), ['source:14', 'app:org.example.rai', 'source:0'], 'their order, sources included');
assert.deepEqual([mine.entries[0].slug, mine.entries[0].label, mine.entries[0].appId], ['in-hdmi2', 'HDMI 2', 'source:14']);
assert.deepEqual([mine.entries[2].slug, mine.entries[2].appId], ['in-tv', 'source:0'], 'TV switches to the TV input');
assert.ok(!mine.allApps.some(e => /^source:/.test(e.key)), 'an input the user added stays off All apps');
const tsv = lines(catalog.tsv(mine));
assert.equal(tsv[0], 'in-hdmi2\tHDMI 2\tsource:14\t\t\t\t\tsource:14', 'the row line carries the key the launcher sends back');
const slugs = tsv.map(l => l.split('\t')[0]);
assert.equal(new Set(slugs).size, slugs.length, 'slugs stay unique in the row');
assert.ok(lines(catalog.allAppsTsv(mine)).some(l => l.startsWith('in-hdmi2-2\tIn HDMI2\t')), 'an app whose name slugs like an input keeps its own tile');
assert.equal(catalog.build(parsed, {row: {order: ['source:13'], hidden: [], exact: true}}).entries[0].label, 'Console', 'the row tile has the name showHomeSources would give it');
assert.equal(catalog.build(parsed, {row: {order: ['source:15'], hidden: [], labels: {'source:15': 'Blu-ray'}}}).entries[0].label, 'Blu-ray', 'a custom name applies');

// showHomeSources on: HDMI 1 of Samsung's row arrives by itself, once, with its own slug; it stays on All apps as before, once.
const home = catalog.build(parsed, {showHomeSources: true});
assert.deepEqual(home.entries.map(e => e.key), ['app:org.example.netflix', 'source:13', 'live:RF', 'app:org.example.rai']);
assert.equal(home.entries[1].slug, 'in-hdmi1');
assert.equal(home.allApps.filter(e => e.key === 'source:13').length, 1, 'a Home-row source shows on All apps once, as before');
assert.ok(!home.allApps.some(e => e.key === 'source:14'), 'the other inputs do not');
const homeMine = catalog.build(parsed, {showHomeSources: true, row: {order: ['source:14', 'source:13', 'app:org.example.rai'], hidden: ['app:org.example.netflix']}});
assert.deepEqual(homeMine.entries.map(e => e.key), ['source:14', 'source:13', 'app:org.example.rai', 'live:RF'], 'both kinds keep their place');
assert.equal(catalog.build(parsed, {showHomeSources: true, row: {order: [], hidden: ['source:13']}}).entries.some(e => e.key === 'source:13'), false, 'a Home-row source taken out stays out');
// The row's size limit holds for sources too.
const many = Array.from({length: 40}, (_, i) => 'app:org.filler.app' + i);
const bigParsed = catalog.parse(HOME + '\n' + Array.from({length: 20}, (_, i) => reg('f' + i, 'Filler ' + i, 'org.filler.app' + i)).join('\n'));
const big = catalog.build(bigParsed, {row: {order: many.slice(0, 20).concat(['app:org.example.netflix', 'live:RF', 'app:org.example.rai'], ['source:14']).concat(many.slice(20)), hidden: [], exact: true}});
assert.ok(big.entries.length <= 38 && big.entries.some(e => e.key === 'source:14'), 'a source within the limit is kept');

// The whole path: the launcher's POST to the row route -> state -> the three lists -> the next start (a rebuild) -> taken out again.
(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-source-row-'));
    const execute = async cmd => {
        const script = Buffer.from(cmd.split(' ')[1] || '', 'base64').toString();
        if (script.includes('.appLayerCache')) return {exit_code: 0, stdout: HOME};
        return {exit_code: 0, stdout: ''};
    };
    const d = new Dock({execute, stateFile: path.join(tmp, 's.json'), dir: tmp, appsFile: path.join(tmp, 'apps.tsv'), rowRetryMs: 10});
    d.supervise = async () => 'running';
    d.patchState({enabled: true, showHomeSources: false, useSourceImages: false});
    const json = (r, obj, code) => { r.code = code || 200; r.body = obj; };
    const services = {agentConnected: () => true, json, readJson: (req, r, cb) => cb(JSON.parse(req.body))};
    const host = new PluginHost({dir: path.join(tmp, 'p'), external: false, services, stableMs: 10}).register(launcher.definition(d, {tickMs: 60000}));
    host.start();
    const post = async row => {
        const r = {code: 0, body: null, headersSent: false, setHeader() {}, writeHead(c) { r.code = c; }, end(b) { r.body = b; }};
        host.dispatch('launcher', {method: 'POST', url: '/api/row', headers: {}, body: JSON.stringify({row})}, r, 'row', json);
        for (let i = 0; i < 100 && !r.body; i++) await new Promise(res => setTimeout(res, 5));
        return r;
    };
    const read = f => lines(fs.readFileSync(f, 'utf8'));

    let r = await post(['app:org.example.netflix', 'live:RF', 'app:org.example.rai', 'source:14']);
    assert.deepEqual(r.body, {ok: true}, 'the row route takes a source key');
    assert.deepEqual(d.readState().row.order, ['app:org.example.netflix', 'live:RF', 'app:org.example.rai', 'source:14'], 'saved in the state as sent');
    assert.ok(d.readState().row.hidden.indexOf('source:14') < 0, 'not remembered as taken out');
    assert.deepEqual(read(d.appsFile).map(keyOf).slice(0, 4), ['app:org.example.netflix', 'live:RF', 'app:org.example.rai', 'source:14'], 'the row list for the next start');
    assert.deepEqual(read(d.inputsFile).map(keyOf), ['source:0', 'source:13', 'source:14', 'source:15', 'source:16'], 'the Sources list, with its keys (the launcher marks HDMI 2)');
    assert.ok(!read(d.allAppsFile).some(l => /^source:/.test(keyOf(l) || '')), 'All apps unchanged');
    // The next start (a rebuild from the saved state, not exact): the source comes back at its place.
    await d.writeCatalog();
    assert.deepEqual(read(d.appsFile).map(keyOf).slice(0, 4), ['app:org.example.netflix', 'live:RF', 'app:org.example.rai', 'source:14'], 'back after a rebuild');
    // Taken out on the launcher: gone, and it can be added again later.
    r = await post(['app:org.example.netflix', 'live:RF', 'app:org.example.rai']);
    assert.deepEqual(r.body, {ok: true});
    await d.writeCatalog();
    assert.ok(!read(d.appsFile).some(l => keyOf(l) === 'source:14'), 'taken out');
    r = await post(['source:14', 'app:org.example.netflix', 'live:RF', 'app:org.example.rai']);
    await d.writeCatalog();
    assert.equal(keyOf(read(d.appsFile)[0]), 'source:14', 'added back, first');
    assert.equal((await post(['source:x'])).code, 409, 'a key that is not plain is refused');

    // showHomeSources: a Home-row source the user's row holds stays when the option goes off (the order cannot tell "arrived by itself"
    // from "added from Sources"); it leaves when it is taken out.
    d.patchState({showHomeSources: true});
    await d.writeCatalog();
    assert.ok(read(d.appsFile).some(l => keyOf(l) === 'source:13'), 'option on: HDMI 1 of Samsung\'s row arrives by itself');
    await post(read(d.appsFile).map(keyOf).filter(Boolean));
    assert.ok(d.readState().row.order.indexOf('source:13') >= 0, 'a move saves it in the order');
    d.patchState({showHomeSources: false});
    await d.writeCatalog();
    assert.ok(read(d.appsFile).some(l => keyOf(l) === 'source:13'), 'option off: it stays, as a source the user placed');
    await post(d.readState().row.order.filter(k => k !== 'source:13'));
    await d.writeCatalog();
    assert.ok(!read(d.appsFile).some(l => keyOf(l) === 'source:13'), 'taken out, it leaves');

    // Custom launcher mode: the row is refused (the dock is not drawn there).
    d.patchState({customApp: 'org.example.netflix'});
    assert.equal((await post(['source:14'])).code, 409, 'no row in custom launcher mode');
    host.stop();
    console.log('PASS sources in the row: keys on the Sources list, resolved whatever showHomeSources says, off All apps, route to lists and back');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
