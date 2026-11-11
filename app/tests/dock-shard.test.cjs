'use strict';
// A plugin that takes over a launcher tile: the list marks it, the launcher asks Vetro to start it, Vetro asks the plugin and
// falls back to the plain launch. The plugin never writes anything into the list the dock reads.
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path');
const catalog = require('../service/dock-catalog.js');
const {Dock} = require('../service/dock.js');
const {PluginHost} = require('../service/plugin-host.js');
const launcher = require('../service/plugin-launcher.js');

const hex = s => Buffer.from(s).toString('hex');
const HOME_DATA = ['F|csfs', 'O|d/webapp@aaa', 'O|d/webapp@bbb', 'O|s/livetv@RF',
    'R|' + hex('aaa') + '|' + hex('YouTube') + '|' + hex('com.samsung.tv.cobalt-yt') + '|0',
    'R|' + hex('bbb') + '|' + hex('Netflix') + '|' + hex('org.tizen.netflix-app') + '|0'].join('\n');
const YT = 'com.samsung.tv.cobalt-yt';
const nextTick = ms => new Promise(r => setTimeout(r, ms));

function fixture(shards, extra) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-dockshard-'));
    const dir = path.join(tmp, 'dock');
    fs.mkdirSync(path.join(dir, 'res'), {recursive: true});
    fs.writeFileSync(path.join(dir, 'tvlauncher-dotnet.dll'), 'x');
    fs.writeFileSync(path.join(dir, 'res', 'glass_tile.png'), 'x');
    const tv = {scripts: [], launched: [], running: false, clock: 1000000, refreshes: 0};
    const execute = async function (cmd) {
        tv.scripts.push(cmd);
        if (/^app_launcher -s /.test(cmd)) { tv.launched.push(cmd.slice(16)); return {exit_code: 0, stdout: ''}; }
        if (/^app_launcher -k /.test(cmd)) return {exit_code: 0, stdout: ''};
        const script = Buffer.from(cmd.split(' ')[1], 'base64').toString();
        if (script.includes('vconftool get')) return {exit_code: 0, stdout: 'x, value = 0 (Int32)\n'};
        if (script.includes('vconftool set')) return {exit_code: 0, stdout: ''};
        if (script.includes('.appLayerCache')) return {exit_code: 0, stdout: HOME_DATA};
        if (script.includes('setsid nohup')) { tv.refreshes++; tv.running = true; return {exit_code: 0, stdout: 'started\n'}; }
        if (script.includes('kill -9') && !script.includes('echo "dock=')) { tv.running = false; return {exit_code: 0, stdout: ''}; }
        if (script.includes('echo "dock=')) return {exit_code: 0, stdout: (tv.running ? 'dock=4242' : 'dock=') + '\nhome=0\nlog:\n\n'};
        if (/^for p in /.test(script)) return {exit_code: 0, stdout: ''};
        throw new Error('unexpected command: ' + script);
    };
    const dock = new Dock(Object.assign({execute, dir, stateFile: path.join(tmp, 'state.json'), appsFile: path.join(tmp, 'apps.tsv'),
        sleep: async ms => { tv.clock += ms; }, now: () => tv.clock, uptime: () => 100000}, extra));
    if (shards) dock.setShards(shards);
    return {dock, tv, tmp};
}
function fakeShards(opts) {
    const h = {listeners: [], claimed: opts.claimed || {}, asked: [],
        intercepted: () => h.claimed,
        onInterceptChange: fn => h.listeners.push(fn),
        launch: appId => { h.asked.push(appId); return opts.launch ? opts.launch(appId) : Promise.resolve({handled: true, plugin: 'youtube'}); }};
    return h;
}

(async function () {
    // 1. the catalog marks only claimed apps, and only with a flag
    const parsed = catalog.parse(HOME_DATA + '\nA|' + hex(YT) + '\nA|' + hex('org.tizen.netflix-app'));
    const plain = catalog.build(parsed, {});
    assert.ok(plain.entries.every(e => !e.viaShard), 'nothing claimed: nothing marked');
    assert.ok(catalog.tsv(plain).split('\n').every(l => l.split('\t').length <= 5), 'and no seventh column');
    const claimed = catalog.build(parsed, {intercepted: {[YT]: {plugin: 'youtube', label: 'YouTube'}, 'org.tizen.tv-viewer': {plugin: 'x', label: 'Live TV'}}});
    assert.deepEqual(claimed.entries.map(e => [e.appId, !!e.viaShard]), [[YT, true], ['org.tizen.netflix-app', false], ['org.tizen.tv-viewer', false]], 'Live TV (the viewer) cannot be claimed');
    const lines = catalog.tsv(claimed).split('\n');
    assert.equal(lines[1], 'youtube\tYouTube\t' + YT + '\t\t\t\tshard', 'the flag is the only thing a plugin adds to the list');
    assert.equal(lines[2].split('\t').length, 3);
    assert.ok(!/__proto__|constructor/.test(JSON.stringify(catalog.build(parsed, {intercepted: {constructor: 1}}).entries)), 'prototype names are not claims');

    // 2. the Dock writes it, reads it back, and the page sees it
    let shards = fakeShards({claimed: {[YT]: {plugin: 'youtube', label: 'YouTube'}}});
    let f = fixture(shards);
    await f.dock.enable();
    const written = fs.readFileSync(path.join(f.tmp, 'apps.tsv'), 'utf8');
    assert.ok(written.split('\n').some(l => l === 'youtube\tYouTube\t' + YT + '\t\t\t\tshard'), written);
    assert.deepEqual(f.dock.entries().map(e => [e.slug, e.shard]), [['youtube', true], ['netflix', false], ['livetv', false], ['settings', false], ['samsunghome', false]]);
    assert.equal(f.dock.shardEntry('youtube').appId, YT);
    assert.equal(f.dock.shardEntry('netflix'), null);
    assert.equal(f.dock.shardEntry('../etc'), null);

    // 3. opening: the plugin starts it, the plain launch does not run
    f.tv.launched.length = 0;
    let r = await f.dock.openEntry('youtube');
    assert.deepEqual(r, {ok: true, via: 'youtube'});
    assert.deepEqual(shards.asked, [YT]);
    assert.deepEqual(f.tv.launched, [], 'no second start');
    assert.equal((await f.dock.status()).lastShardLaunch.via, 'youtube');

    // 4. the plugin cannot do it (declines, fails, is gone): Vetro starts the app itself, once, and says why
    for (const [name, launch] of [['declines', () => Promise.resolve({handled: false, reason: 'youtube declined'})], ['throws', () => { throw new Error('boom'); }],
        ['rejects', () => Promise.reject(new Error('proxy down'))]]) {
        shards = fakeShards({claimed: {[YT]: {plugin: 'youtube', label: 'YouTube'}}, launch});
        f.dock.shards = shards; f.tv.launched.length = 0;
        r = await f.dock.openEntry('youtube');
        assert.equal(r.ok, true, name); assert.equal(r.via, null, name); assert.ok(r.reason, name);
        assert.deepEqual(f.tv.launched, [YT], name + ': one plain launch');
    }
    f.dock.shards = null; f.tv.launched.length = 0;
    r = await f.dock.openEntry('youtube');
    assert.deepEqual(f.tv.launched, [YT], 'no plugin host at all: plain launch');
    r = await f.dock.openEntry('netflix');
    assert.equal(r.ok, false); assert.deepEqual(f.tv.launched, [YT], 'a tile no plugin owns is not launched here');

    // 5. the launcher plugin's route: 202 at once, 404 for a tile that is not a plugin's, GET refused
    shards = fakeShards({claimed: {[YT]: {plugin: 'youtube', label: 'YouTube'}}});
    f.dock.shards = shards; f.tv.launched.length = 0;
    const json = (res, obj, code) => { res.code = code || 200; res.body = obj; res.headersSent = true; };
    const res = () => ({code: 0, body: null, headersSent: false, setHeader() {}, writeHead() {}, end() {}});
    const host = new PluginHost({dir: path.join(f.tmp, 'plugins'), external: false, services: {agentConnected: () => false, json, readJson() {}}}).register(launcher.definition(f.dock, {tickMs: 100000}));
    host.start();
    const call = (method, url) => { const o = res(); host.dispatch('launcher', {method, url, headers: {}}, o, 'open', json); return o; };
    let o = call('POST', '/plugins/launcher/api/open?slug=youtube'); await nextTick(5);
    assert.equal(o.code, 202); assert.deepEqual(o.body, {ok: true}); assert.deepEqual(shards.asked, [YT]);
    o = call('POST', '/plugins/launcher/api/open?slug=netflix'); await nextTick(5);
    assert.equal(o.code, 404); assert.equal(shards.asked.length, 1);
    o = call('POST', '/plugins/launcher/api/open'); assert.equal(o.code, 404);
    o = call('POST', '/plugins/launcher/api/open?slug=' + encodeURIComponent('youtube;reboot')); assert.equal(o.code, 404, 'a slug is letters, digits, - and _');
    o = call('GET', '/plugins/launcher/api/open?slug=youtube'); assert.equal(o.code, 404, 'only POST');
    host.stop();

    // 6. a plugin starting or stopping rebuilds the list: after a pause, once, and not while another change runs or in the boot window
    shards = fakeShards({claimed: {}});
    f = fixture(shards);
    await f.dock.enable();
    const starts = () => f.tv.refreshes;
    let base = starts();
    shards.claimed = {[YT]: {plugin: 'youtube', label: 'YouTube'}};
    shards.listeners.forEach(fn => fn()); shards.listeners.forEach(fn => fn());
    assert.equal(starts(), base, 'debounced, not immediate');
    await nextTick(1700);
    assert.equal(starts(), base + 1, 'two changes, one rebuild');
    assert.ok(fs.readFileSync(path.join(f.tmp, 'apps.tsv'), 'utf8').includes('\tshard'), 'the rebuilt list carries the flag');
    f.dock.busy = true; base = starts();
    shards.listeners.forEach(fn => fn()); await nextTick(1700);
    assert.equal(starts(), base, 'busy: no rebuild now'); assert.equal(f.dock.refreshPending, true, 'it is remembered for the later pass');
    f.dock.busy = false;
    const boot = fixture(fakeShards({claimed: {}}), {uptime: () => 20});
    await boot.dock.enable(); base = boot.tv.refreshes;
    boot.dock.shards.listeners.forEach(fn => fn()); await nextTick(1700);
    assert.equal(boot.tv.refreshes, base, 'first minutes after boot: left to the later pass'); assert.equal(boot.dock.refreshPending, true);
    const off = fixture(fakeShards({claimed: {}}));
    off.dock.shards.listeners.forEach(fn => fn()); await nextTick(1700);
    assert.equal(off.tv.refreshes, 0, 'launcher off: nothing to rebuild');

    console.log('PASS plugin-owned launcher tiles: list flag, launch through the plugin, fallbacks, route and rebuilds');
})().catch(e => { console.log('FAIL ' + (e.stack || e)); process.exitCode = 1; });
