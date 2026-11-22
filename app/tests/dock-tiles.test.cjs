'use strict';
// Custom tiles (the dashboard's Launcher > Tiles): saved with the Remapper's actions, written into the launcher's lists as tile:<id>, laid
// over the row like any tile, and run in the service when the launcher reports a press. Synthetic apps only.
const assert = require('assert').strict;
const fs = require('fs'), os = require('os'), path = require('path');
const catalog = require('../service/dock-catalog.js');
const {Dock, checkTileIcon, cleanTiles} = require('../service/dock.js');
const launcher = require('../service/plugin-launcher.js');
const {PluginHost} = require('../service/plugin-host.js');

const hex = s => Buffer.from(s).toString('hex');
const reg = (id, title, appId) => 'R|' + hex(id) + '|' + hex(title) + '|' + hex(appId) + '|0|1';
const HOME = ['F|csfs', 'O|d/webapp@net', reg('net', 'Netflix', 'org.example.netflix'), 'A|' + hex('org.example.netflix')].join('\n');
// A PNG header that says w x h (the signature and IHDR are all checkTileIcon reads).
function png(w, h, extra) {
    const b = Buffer.alloc(33 + (extra || 0));
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b, 0);
    b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
    return b;
}

// --- the catalog: tiles join Samsung's row at its end, carry tile:<id>, and their uploaded picture
{
    const parsed = catalog.parse(HOME);
    const tiles = [{id: 'plex', label: 'Plex', actions: [{type: 'key', key: 'KEY_HDMI1'}], icon: true}, {id: 'xbox', label: 'Xbox', actions: [{type: 'key', key: 'KEY_HDMI4'}], icon: false},
        {id: 'Bad ID', label: 'Bad', actions: []}];
    const built = catalog.build(parsed, {tiles});
    assert.deepEqual(built.entries.map(e => e.key), ['app:org.example.netflix', 'tile:plex', 'tile:xbox'], 'after Samsung\'s row; a bad id is left out');
    const lines = catalog.tsv(built).trim().split('\n');
    assert.equal(lines[2], 'plex\tPlex\ttile:plex\t\t/opt/usr/home/owner/share/vetro-tile-plex.png\t\t\ttile:plex', 'appId tile:<id>, the uploaded picture, the row key');
    assert.equal(lines[3], 'xbox\tXbox\ttile:xbox\t\t\t\t\ttile:xbox', 'no picture: the launcher draws its letter');
    assert.ok(catalog.allAppsTsv(built).includes('\ttile:plex\t'), 'All apps lists the tiles, so one taken out of the row can be added again');
    assert.ok(catalog.ROW_KEY.test('tile:plex') && !catalog.ROW_KEY.test('tile:a;b'), 'tile row keys');
    assert.ok(catalog.iconPathOk('/opt/usr/home/owner/share/vetro-tile-plex.png') && !catalog.iconPathOk('/opt/usr/home/owner/share/vetro-dock.json.png'), 'only tile pictures from Vetro\'s folder');

    // the user's own row places them like any tile, and one they took out stays out
    const row = catalog.build(parsed, {tiles, row: {order: ['tile:xbox', 'app:org.example.netflix'], hidden: ['tile:plex'], labels: {}}});
    assert.deepEqual(row.entries.map(e => e.key), ['tile:xbox', 'app:org.example.netflix']);
    assert.ok(row.samsungKeys.indexOf('tile:plex') >= 0, 'a tile counts as part of the base row, so the launcher taking it out hides it');
}

// --- saved tiles: checks, ids, row clean-up, pictures
(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-tiles-'));
    const dock = new Dock({execute: () => Promise.reject(new Error('the TV is not asked while the launcher is off and has no lists')),
        dir: tmp, stateFile: path.join(tmp, 'state.json'), appsFile: path.join(tmp, 'apps.tsv'), tileIconFile: id => path.join(tmp, 'tile-' + id + '.png')});

    let r = await dock.saveTile({label: 'Plex', actions: [{type: 'key', key: 'KEY_HDMI1'}, {type: 'mqtt', topic: 'vetro', payload: '{"input":"plex"}'}]});
    assert.equal(r.ok, true); assert.equal(r.tile.id, 'plex'); assert.equal(r.tile.icon, false);
    r = await dock.saveTile({label: 'Plex', actions: [{type: 'key', key: 'KEY_HDMI2'}]});
    assert.equal(r.tile.id, 'plex-2', 'a second tile of the same name gets its own id');
    r = await dock.saveTile({id: 'plex-2', label: 'SNES', actions: [{type: 'key', key: 'KEY_HDMI2'}]});
    assert.equal(r.tile.id, 'plex-2', 'a rename keeps the id, so the tile keeps its place');
    assert.deepEqual(dock.readState().tiles.map(t => t.label), ['Plex', 'SNES']);

    const refused = async (tile, re, why) => { await assert.rejects(dock.saveTile(tile), re, why); };
    await refused({label: '  ', actions: [{type: 'key', key: 'KEY_HDMI1'}]}, /needs a name/, 'a name is required');
    await refused({label: 'X', actions: []}, /1 to 5 actions/, 'at least one action');
    await refused({label: 'X', actions: Array(6).fill({type: 'key', key: 'KEY_HDMI1'})}, /1 to 5 actions/, 'at most five');
    await refused({label: 'X', actions: [{type: 'key', key: 'rm -rf'}]}, /invalid key/, 'the Remapper\'s key check');
    await refused({label: 'X', actions: [{type: 'mqtt', topic: 'a b'}]}, /invalid topic/, 'the Remapper\'s topic check');
    await refused({label: 'X', actions: [{type: 'launch', appId: 'com.samsung.tv.coba.setting.x'}]}, /Samsung/, 'a part of Samsung\'s Settings is not an app');
    await refused({id: 'nope', label: 'X', actions: [{type: 'key', key: 'KEY_HDMI1'}]}, /No tile/, 'an unknown id is not created');
    assert.equal(dock.readState().tiles.length, 2, 'nothing was saved by the refused ones');

    // the press: the tile's actions, for main.js runActions
    assert.deepEqual(dock.tilePressed('plex'), [{type: 'key', key: 'KEY_HDMI1'}, {type: 'mqtt', topic: 'vetro', payload: '{"input":"plex"}'}]);
    assert.equal(dock.lastTilePress.id, 'plex');
    assert.equal(dock.tilePressed('gone'), null);

    // pictures
    assert.doesNotThrow(() => checkTileIcon(png(256, 256)));
    assert.throws(() => checkTileIcon(Buffer.from('GIF89a........................................')), /PNG/);
    assert.throws(() => checkTileIcon(png(16, 16)), /between 32 and 1024/);
    assert.throws(() => checkTileIcon(png(2048, 512)), /between 32 and 1024/);
    assert.throws(() => checkTileIcon(png(256, 256, 600 * 1024)), /512 KB/);
    r = await dock.setTileIcon('plex', png(256, 256));
    assert.equal(r.tiles[0].icon, true);
    assert.ok(dock.tileIcon('plex').equals(png(256, 256)), 'served back for the dashboard');
    await assert.rejects(dock.setTileIcon('plex', Buffer.from('not a png')), /PNG/);
    assert.ok(dock.tileIcon('plex'), 'a refused picture leaves the old one');
    await dock.setTileIcon('plex', null);
    assert.equal(dock.tileIcon('plex'), null); assert.equal(fs.existsSync(path.join(tmp, 'tile-plex.png')), false, 'removed from disk');

    // deleting takes the tile out of the user's row and its picture off the disk
    await dock.setTileIcon('plex', png(64, 64));
    dock.patchState({row: {order: ['tile:plex', 'app:org.example.netflix'], hidden: ['tile:plex-2'], labels: {'tile:plex': 'P'}}});
    r = await dock.deleteTile('plex');
    assert.deepEqual(r.tiles.map(t => t.id), ['plex-2']);
    assert.deepEqual(dock.readState().row, {order: ['app:org.example.netflix'], hidden: ['tile:plex-2'], labels: {}});
    assert.equal(fs.existsSync(path.join(tmp, 'tile-plex.png')), false);
    await assert.rejects(dock.deleteTile('plex'), /No tile/);

    // other launcher settings keep the tiles (every write goes through readState)
    dock.patchState({noMotion: true});
    assert.equal(dock.readState().tiles.length, 1);
    assert.deepEqual(cleanTiles([{id: 'a', label: 'A', actions: [{type: 'teleport'}]}, {id: 'b', label: 'B', actions: [{type: 'key', key: 'KEY_TV'}, {type: 'teleport'}]}]),
        [{id: 'b', label: 'B', actions: [{type: 'key', key: 'KEY_TV'}], icon: false}], 'a saved action this build does not know is dropped; a tile left with none is dropped');

    // --- the launcher plugin's routes
    const ran = [];
    const json = (res, obj, code) => { res.code = code || 200; res.body = obj; res.headersSent = true; };
    const readJson = (req, res, cb) => cb(req.body);
    const host = new PluginHost({dir: path.join(tmp, 'plugins'), external: false, services: {agentConnected: () => false, json, readJson}})
        .register(launcher.definition(dock, {tickMs: 100000, runActions: actions => { ran.push(actions); return Promise.resolve({sent: actions.length}); }}));
    host.start();
    const call = (method, sub, url, body, address) => {
        const o = {code: 0, body: null, headersSent: false, setHeader() {}, writeHead(c) { this.code = c; }, end(b) { this.raw = b; }};
        host.dispatch('launcher', {method, url, headers: {}, body, socket: {remoteAddress: address || '127.0.0.1'}}, o, sub, json);
        return o;
    };
    const tick = () => new Promise(r => setTimeout(r, 5));

    let o = call('POST', 'tile', '/plugins/launcher/api/tile?id=plex-2'); await tick();
    assert.equal(o.code, 202); assert.deepEqual(ran, [[{type: 'key', key: 'KEY_HDMI2'}]], 'the press runs the tile\'s actions');
    o = call('POST', 'tile', '/plugins/launcher/api/tile?id=plex-2', undefined, '192.168.1.20'); await tick();
    assert.equal(o.code, 403); assert.equal(ran.length, 1, 'only the TV itself may press a tile');
    o = call('POST', 'tile', '/plugins/launcher/api/tile?id=gone'); assert.equal(o.code, 404);

    o = call('POST', 'tiles', '/plugins/launcher/api/tiles', {action: 'save', tile: {label: 'Xbox', actions: [{type: 'key', key: 'KEY_HDMI4'}]}}); await tick();
    assert.equal(o.body.ok, true); assert.equal(o.body.tile.id, 'xbox');
    o = call('POST', 'tiles', '/plugins/launcher/api/tiles', {action: 'save', tile: {label: '', actions: []}}); await tick();
    assert.equal(o.code, 409); assert.match(o.body.error, /name/);
    o = call('GET', 'tiles', '/plugins/launcher/api/tiles');
    assert.deepEqual(o.body.tiles.map(t => t.id), ['plex-2', 'xbox']); assert.equal(o.body.maxTiles, 20);

    o = call('POST', 'tile-icon', '/plugins/launcher/api/tile-icon?id=xbox', {png: png(128, 128).toString('base64')}); await tick();
    assert.equal(o.body.ok, true);
    o = call('GET', 'tile-icon', '/plugins/launcher/api/tile-icon?id=xbox');
    assert.equal(o.code, 200); assert.ok(o.raw.equals(png(128, 128)));
    o = call('POST', 'tile-icon', '/plugins/launcher/api/tile-icon?id=xbox', {png: 'not base64!'}); assert.equal(o.code, 400);
    o = call('POST', 'tiles', '/plugins/launcher/api/tiles', {action: 'delete', id: 'xbox'}); await tick();
    assert.deepEqual(o.body.tiles.map(t => t.id), ['plex-2']);
    host.stop();

    console.log('PASS dock tiles: saved with the Remapper\'s checks, laid over the row, pictures checked, presses run from the TV only');
})().catch(e => { console.error(e); process.exitCode = 1; });
