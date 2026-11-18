'use strict';
// The store pill of All apps (TV-Store or Samsung's store) and the lists read again after an app is installed or removed:
// the launcher asks (api/relist), the service reads the TV again and says "reload" only when the lists changed. Synthetic apps only.
const assert = require('assert').strict;
const fs = require('fs'), os = require('os'), path = require('path');
const catalog = require('../service/dock-catalog.js');
const {Dock} = require('../service/dock.js');
const launcher = require('../service/plugin-launcher.js');
const {PluginHost} = require('../service/plugin-host.js');

const hex = s => Buffer.from(s).toString('hex');
const reg = (id, title, appId) => 'R|' + hex(id) + '|' + hex(title) + '|' + hex(appId) + '|0|1';
const FILLER = Array.from({length: 30}, (_, i) => 'A|' + hex('org.filler.app' + i) + '|false');
function home(extra) {
    return ['F|csfs', 'O|d/webapp@net', reg('net', 'Netflix', 'org.example.netflix'), 'A|' + hex('org.example.netflix') + '|false'].concat(FILLER, extra || []).join('\n');
}
const WITH_STORE = [reg('tvs', 'TV-Store', catalog.TV_STORE), 'A|' + hex(catalog.TV_STORE) + '|false'];
const NEW_APP = [reg('new', 'Stremio', 'org.example.stremio'), 'A|' + hex('org.example.stremio') + '|false'];
const tick = ms => new Promise(r => setTimeout(r, ms || 0));

function fixture() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-relist-'));
    const tv = {home: home(), reloads: 0, loads: 0, restarts: 0};
    const execute = async cmd => {
        if (cmd.includes('echo reload')) { if (tv.failReload) { tv.failReload--; throw new Error('agent reconnecting'); } tv.reloads++; return {exit_code: 0, stdout: ''}; }
        const script = Buffer.from(cmd.split(' ')[1] || '', 'base64').toString();
        if (script.includes('.appLayerCache')) { tv.loads++; return {exit_code: 0, stdout: tv.home}; }
        return {exit_code: 0, stdout: ''};
    };
    const dock = new Dock({execute, stateFile: path.join(tmp, 's.json'), dir: tmp, appsFile: path.join(tmp, 'apps.tsv'), rowRetryMs: 10, relistFollowMs: 30});
    dock.refresh = async () => { tv.restarts++; await dock.writeCatalog(); return {}; };
    dock.status = async () => ({});
    return {tmp, tv, dock, all: () => fs.readFileSync(dock.allAppsFile, 'utf8')};
}
const storePill = text => text.trim().split('\n').pop();

(async () => {
    // 1. The store choice: TV-Store by default when it is installed, Samsung's store when chosen; kept by every rebuild
    let f = fixture();
    f.tv.home = home(WITH_STORE);
    assert.equal(f.dock.readState().appStore, 'tvstore', 'TV-Store is the default');
    await f.dock.writeCatalog();
    assert.equal(storePill(f.all()), 'tvstore\tTV-Store\tsys:A2STVStore.Store\tcom.samsung.tv.store');
    assert.equal(f.dock.lastCatalog.tvStoreInstalled, true, 'the dashboard can tell TV-Store is there');
    await assert.rejects(f.dock.setAppStore('other'), /Invalid value/);
    await f.dock.setAppStore('samsung');
    assert.equal(f.dock.readState().appStore, 'samsung');
    assert.equal(storePill(f.all()), 'store\tApp store\tsys:com.samsung.tv.store', 'the launcher off: the list follows the choice');
    f.dock.patchState({enabled: true});
    await f.dock.setRow(['app:org.example.netflix']);
    assert.equal(storePill(f.all()), 'store\tApp store\tsys:com.samsung.tv.store', 'a row saved from the launcher keeps the choice');
    await f.dock.setAppStore('tvstore');
    assert.equal(f.tv.restarts, 1, 'the launcher on: it is restarted with the new list');
    assert.equal(storePill(f.all()), 'tvstore\tTV-Store\tsys:A2STVStore.Store\tcom.samsung.tv.store');

    // 2. relist: the lists are always written and the launcher always told (it compares with what it shows), one more pass a little later
    f = fixture();
    f.dock.patchState({enabled: true});
    await f.dock.writeCatalog();
    const before = fs.statSync(f.dock.allAppsFile).mtimeMs;
    await tick(15);
    let r = await f.dock.relist();
    assert.deepEqual(r, {ok: true, changed: false});
    assert.equal(f.tv.reloads, 1, 'told even when nothing changed on disk: the launcher compares with what it shows');
    assert.ok(fs.statSync(f.dock.allAppsFile).mtimeMs > before, 'but the lists are newer than the change the launcher saw');
    await tick(60);
    assert.equal(f.tv.loads, 3, 'the follow-up pass ran once (write, relist, follow-up)');
    assert.equal(f.tv.reloads, 2, 'and told the launcher again');
    // A reload lost on the way (the agent reconnecting) is delivered by the follow-up, although the files did not change since.
    f.tv.home = home(NEW_APP);
    f.tv.failReload = 1;
    r = await f.dock.relist();
    assert.deepEqual(r, {ok: true, changed: true});
    assert.ok(f.all().includes('\tStremio\t'), 'the new app is on All apps');
    assert.equal(f.tv.reloads, 2, 'the reload was lost');
    await tick(60);
    assert.equal(f.tv.reloads, 3, 'the follow-up delivers it');
    // Lists written by the supervision's later rebuild (a deferred Shard change) are also sent to the launcher.
    f.dock.refreshPending = true; f.dock.uptime = () => 1000;
    f.dock.refreshCatalogLater(); await tick(20);
    assert.equal(f.tv.reloads, 4, 'the later rebuild tells the launcher too');

    // 3. busy: the relist waits for the other change; off or custom: nothing
    f.tv.loads = 0;
    f.dock.busy = true;
    assert.deepEqual(await f.dock.relist(), {queued: true});
    assert.equal(f.tv.loads, 0);
    f.dock.busy = false;
    await tick(40);
    assert.ok(f.tv.loads >= 1, 'run once the other change is done');
    await tick(60);
    const off = fixture();
    assert.equal((await off.dock.relist()).ok, false, 'the launcher off: nothing to do');
    assert.equal(off.tv.loads, 0);

    // 4. a row that arrives just after a relist reloaded the launcher is sent to it again (it may have shown the old row meanwhile)
    const reloads = f.tv.reloads;
    f.dock.reloadedAt = f.dock.now();
    await f.dock.setRow(['app:org.example.stremio', 'app:org.example.netflix']);
    assert.equal(f.tv.reloads, reloads + 1, 'reload after the row');
    f.dock.reloadedAt = f.dock.now() - 120000;
    await f.dock.setRow(['app:org.example.netflix']);
    assert.equal(f.tv.reloads, reloads + 1, 'no recent reload: the launcher already shows its own row');

    // 5. the launcher's route: 202 at once, the relist runs afterwards; GET refused
    f = fixture();
    f.dock.patchState({enabled: true});
    const json = (res, obj, code) => { res.code = code || 200; res.body = obj; res.headersSent = true; };
    const res = () => ({code: 0, body: null, headersSent: false, setHeader() {}, writeHead() {}, end() {}});
    const host = new PluginHost({dir: path.join(f.tmp, 'plugins'), external: false, services: {agentConnected: () => false, json, readJson() {}}}).register(launcher.definition(f.dock, {tickMs: 100000}));
    host.start();
    const call = (method, url) => { const o = res(); host.dispatch('launcher', {method, url, headers: {}}, o, 'relist', json); return o; };
    let o = call('POST', '/plugins/launcher/api/relist');
    assert.equal(o.code, 202);
    await tick(20);
    assert.ok(f.tv.loads >= 1, 'the TV was read again');
    o = call('GET', '/plugins/launcher/api/relist');
    assert.equal(o.code, 404, 'only POST');
    host.stop();
    await tick(60);
    console.log('PASS launcher lists: TV-Store or Samsung\'s store on All apps, read again after an install, the launcher told each time');
})().catch(e => { console.log('FAIL ' + (e.stack || e)); process.exitCode = 1; });
