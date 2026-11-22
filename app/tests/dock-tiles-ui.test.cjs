'use strict';
// The dashboard's Launcher > Tiles tab: lists the custom tiles, adds, edits and deletes them, and changes their picture.
const assert = require('assert').strict;
const vm = require('vm');
const html = require('../service/dashboard.js')();
const nodes = {}, calls = [];
const el = id => nodes[id] || (nodes[id] = {id, value: '', hidden: true, textContent: '', innerHTML: '', disabled: false, focus() {}});
let tiles = [{id: 'plex', label: 'Plex', actions: [{type: 'key', key: 'KEY_HDMI1'}, {type: 'mqtt', topic: 'vetro', payload: '{"input":"plex"}'}], icon: true}];
const dock = {installed: true, enabled: true, running: true, mode: 'vetro', busy: false, error: null, apps: null, log: '', entries: [], inputs: [], maxTiles: 20, maxTileActions: 5};
const sandbox = {document: {getElementById: el, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}}, console, setTimeout() { return 1; }, clearTimeout() {}, setInterval() {},
    fetch: async (url, opts) => {
        const body = opts && opts.body ? JSON.parse(opts.body) : null;
        calls.push({url, body});
        let data = {};
        if (url === '/dock' && !body) data = Object.assign({}, dock, {tiles});
        else if (url === '/plugins/launcher/api/tiles' && body.action === 'save') {
            const tile = Object.assign({id: body.tile.id || body.tile.label.toLowerCase(), icon: false}, body.tile);
            tiles = tiles.filter(t => t.id !== tile.id).concat([tile]); data = {ok: true, tile, tiles};
        } else if (url === '/plugins/launcher/api/tiles' && body.action === 'delete') { tiles = tiles.filter(t => t.id !== body.id); data = {ok: true, tiles}; }
        else if (url.startsWith('/plugins/launcher/api/tile-icon')) { tiles = tiles.map(t => Object.assign({}, t, {icon: body.png !== null})); data = {ok: true, tiles}; }
        else if (url.startsWith('/apps')) data = {apps: [], summary: {total: 0}};
        else if (url === '/remap') data = {rules: []};
        return {ok: true, json: async () => data};
    }};
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], sandbox);
const tick = () => new Promise(r => setImmediate(r));
const click = async ds => { await el('dock').onclick({target: {closest: () => ({dataset: ds})}}); await tick(); await tick(); };

(async () => {
    assert.match(html, /id="dockTiles" role="tabpanel" aria-labelledby="dtab-tiles" hidden/, 'the Tiles panel, closed at first');
    await sandbox.loadDock(); await tick();
    await click({dockTab: 'tiles'});
    assert.equal(el('dockTiles').hidden, false); assert.equal(el('dockBody').hidden, true);
    let box = el('dockTiles').innerHTML;
    assert.match(box, /<h3>Plex<\/h3><p>HDMI 1 · MQTT to vetro<\/p>/, 'each tile with what it does');
    assert.match(box, /src="\/plugins\/launcher\/api\/tile-icon\?id=plex&amp;v=0"/, 'its picture');
    assert.match(box, /data-tile-icon="plex"/, 'a picture can be chosen');

    // a new tile: the editor, then Save sends the name and the actions
    await click({tileNew: ''});
    assert.match(el('dockTiles').innerHTML, /data-tile-name/); assert.match(el('dockTiles').innerHTML, /data-tile-save/);
    assert.match(el('dockTiles').innerHTML, /New tile<\/button>/); assert.match(el('dockTiles').innerHTML, /data-tile-new disabled/, 'one editor at a time');
    sandbox.tileEdit.label = '';
    await click({tileSave: ''});
    assert.match(el('dockTiles').innerHTML, /Give the tile a name/); assert.equal(calls.filter(c => c.body && c.body.action === 'save').length, 0, 'nothing sent without a name');
    sandbox.tileEdit.label = 'Xbox'; sandbox.tileEdit.actions = [{type: 'key', key: ''}];
    await click({tileSave: ''});
    assert.match(el('dockTiles').innerHTML, /needs a key, an app or an MQTT topic/);
    sandbox.tileEdit.actions = [{type: 'key', key: 'KEY_HDMI4'}];
    await click({tileSave: ''});
    assert.deepEqual(calls.filter(c => c.body && c.body.action === 'save').map(c => c.body), [{action: 'save', tile: {label: 'Xbox', actions: [{type: 'key', key: 'KEY_HDMI4'}]}}]);
    assert.equal(sandbox.tileEdit, null, 'the editor closes once saved');
    assert.match(el('dockTiles').innerHTML, /<h3>Xbox<\/h3>/);

    // editing keeps the id
    await click({tileEdit: 'plex'});
    assert.equal(sandbox.tileEdit.id, 'plex'); sandbox.tileEdit.label = 'Plex on the Shield';
    await click({tileSave: ''});
    assert.equal(calls[calls.length - 1].body.tile.id, 'plex');

    // removing the picture, then deleting asks first
    await click({tileIconRemove: 'plex'});
    assert.deepEqual(calls[calls.length - 1], {url: '/plugins/launcher/api/tile-icon?id=plex', body: {png: null}});
    await click({tileDelete: 'xbox'});
    assert.match(el('dockTiles').innerHTML, /Delete Xbox\?/);
    const before = calls.length;
    await click({tileCancel: ''});
    assert.equal(calls.length, before, 'Cancel sends nothing');
    await click({tileDelete: 'xbox'}); await click({tileDeleteConfirm: 'xbox'});
    assert.deepEqual(calls[calls.length - 1].body, {action: 'delete', id: 'xbox'});
    assert.doesNotMatch(el('dockTiles').innerHTML, /<h3>Xbox<\/h3>/);
    console.log('PASS launcher tiles UI: list, add, edit, picture, delete with confirmation');
})().catch(e => { console.error(e); process.exitCode = 1; });
