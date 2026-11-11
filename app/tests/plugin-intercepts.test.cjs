'use strict';
// Plugins that take over a launcher tile: manifest field "intercepts", the host's claim rules and launch().
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path');
const { PluginHost, checkManifest, checkBundle } = require('../service/plugin-host.js');

function tmp() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-intercepts-')), 'p'); }
const YT = { appId: 'com.samsung.tv.cobalt-yt', label: 'YouTube' };
function def(id, extra, inst) { return Object.assign({ id, apiVersion: 1, defaultEnabled: true, create() { return inst || {}; } }, extra); }
const manifest = extra => Object.assign({ id: 'shard', apiVersion: 1 }, extra);

const keepAlive = setInterval(() => {}, 1000);   // the launch timeout is unref'd, like the service's other timers
(async function () {
    // manifest rules: optional, 1-3 apps, plain app ids, short plain labels, no duplicates
    checkManifest(manifest());
    checkManifest(manifest({ intercepts: [YT] }));
    checkManifest(manifest({ intercepts: [YT, { appId: 'tv.twitch.tv', label: 'Twitch' }] }));
    const bad = [
        [], 'youtube', {}, [YT, YT],
        [{ appId: 'a.a1', label: 'a' }, { appId: 'b.b1', label: 'b' }, { appId: 'c.c1', label: 'c' }, { appId: 'd.d1', label: 'd' }],
        [{ appId: 'x y', label: 'bad id' }], [{ appId: '..', label: 'dots' }], [{ appId: "a';rm", label: 'quote' }], [{ appId: '', label: 'empty' }],
        [{ appId: 'a.b', label: '' }], [{ appId: 'a.b', label: 'x'.repeat(25) }], [{ appId: 'a.b', label: '<b>x</b>' }], [{ appId: 'a.b' }], [null], ['a.b']
    ];
    bad.forEach(v => assert.throws(() => checkManifest(manifest({ intercepts: v })), /intercepts/, JSON.stringify(v)));
    // the same rules for a bundle (installer, `vetro-plugin.cjs check`) and for a bundled definition
    assert.throws(() => checkBundle({ format: 'vetro-plugin', version: 1, manifest: manifest({ intercepts: [{ appId: '..', label: 'x' }] }), files: { 'index.js': '' } }), /intercepts/);
    assert.throws(() => new PluginHost({ dir: tmp(), external: false }).register(def('bad', { intercepts: [{ appId: 'a b', label: 'x' }] })), /bad: intercepts/);
    // not a permission: an old Vetro that ignores the key still accepts the manifest, and a new permission would not be accepted
    assert.throws(() => checkManifest(manifest({ permissions: ['intercept'] })), /Unknown permission/);

    // the claim: only a running plugin that can launch
    const calls = [];
    const yt = def('youtube', { intercepts: [YT] }, { launch(appId) { calls.push(appId); return Promise.resolve(); } });
    const h = new PluginHost({ dir: tmp(), external: false }).register(yt);
    assert.deepEqual(h.status('youtube').intercepts, [YT], 'the label is part of the status');
    assert.deepEqual(h.intercepted(), {}, 'nothing is claimed before the plugin runs');
    h.start();
    assert.deepEqual(h.intercepted(), { 'com.samsung.tv.cobalt-yt': { plugin: 'youtube', label: 'YouTube' } });
    const r = await h.launch('com.samsung.tv.cobalt-yt');
    assert.deepEqual(r, { handled: true, plugin: 'youtube' });
    assert.deepEqual(calls, ['com.samsung.tv.cobalt-yt']);
    assert.equal((await h.launch('org.tizen.netflix-app')).handled, false, 'an app nobody claims is left to the caller');
    h.setEnabled('youtube', false);
    assert.deepEqual(h.intercepted(), {}, 'switched off: the tile is given back');
    assert.equal((await h.launch('com.samsung.tv.cobalt-yt')).handled, false);
    h.stop();

    // changes reach the launcher when a claiming plugin starts or stops, and a broken listener is ignored
    const h2 = new PluginHost({ dir: tmp(), external: false }).register(def('youtube', { intercepts: [YT] }, { launch() { return Promise.resolve(); } })).register(def('plain'));
    let changes = 0;
    h2.onInterceptChange(() => { changes++; throw new Error('listener bug'); });
    h2.start();
    assert.equal(changes, 1, 'start of the claiming plugin only; the plain one does not notify');
    h2.setEnabled('youtube', false);
    assert.equal(changes, 2);
    h2.setEnabled('youtube', true);
    assert.equal(changes, 3);
    h2.stop();

    // a plugin that fails, throws, declines, hangs or has no launch(): the caller gets handled:false with a reason, never a rejection
    const cases = {
        rejects: { launch() { return Promise.reject(new Error('proxy down')); } },
        throws: { launch() { throw new Error('sync boom'); } },
        declines: { launch() { return Promise.resolve(false); } },
        hangs: { launch() { return new Promise(() => {}); } },
        missing: {}
    };
    for (const name of Object.keys(cases)) {
        const hx = new PluginHost({ dir: tmp(), external: false }).register(def('shard', { intercepts: [YT] }, cases[name]));
        hx.launchMs = 50;
        hx.start();
        const out = await hx.launch(YT.appId);
        assert.equal(out.handled, false, name);
        assert.ok(out.reason, name + ' says why');
        if (name === 'rejects') assert.match(out.reason, /proxy down/);
        if (name === 'hangs') assert.match(out.reason, /in time/);
        hx.stop();
    }

    // two running plugins on one app: neither wins, both say so, and it clears when one stops
    const hc = new PluginHost({ dir: tmp(), external: false })
        .register(def('one', { intercepts: [YT] }, { launch() { return Promise.resolve(); } }))
        .register(def('two', { intercepts: [YT, { appId: 'tv.twitch.tv', label: 'Twitch' }] }, { launch() { return Promise.resolve(); } }));
    hc.start();
    assert.deepEqual(hc.intercepted(), { 'tv.twitch.tv': { plugin: 'two', label: 'Twitch' } }, 'only the unambiguous app is claimed');
    assert.deepEqual(hc.status('one').interceptConflicts, [YT.appId]);
    assert.deepEqual(hc.status('two').interceptConflicts, [YT.appId]);
    assert.equal((await hc.launch(YT.appId)).handled, false);
    hc.setEnabled('two', false);
    assert.deepEqual(hc.status('one').interceptConflicts, []);
    assert.equal(Object.keys(hc.intercepted()).length, 1);
    hc.stop();

    // the author's tool: check refuses a Shard that claims an app but cannot launch it, and the list entry carries the claim
    {
        const cp = require('child_process'), tool = path.join(__dirname, '..', 'scripts', 'vetro-plugin.cjs');
        const run = (...args) => cp.spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8' });
        const make = (m, code) => {
            const d = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-tool-')), 'shard');
            fs.mkdirSync(d);
            fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify(Object.assign({ id: 'shard', name: 'Shard', version: '1.0.0', apiVersion: 1 }, m)));
            fs.writeFileSync(path.join(d, 'index.js'), code);
            return d;
        };
        const good = make({ intercepts: [YT] }, "module.exports = function () { return { launch: function () { return Promise.resolve(); } }; };");
        let r = run('check', good);
        assert.equal(r.status, 0, r.stderr + r.stdout);
        assert.match(r.stdout, /intercepts: YouTube \(com\.samsung\.tv\.cobalt-yt\) \(shown to the user\)/);
        r = run('check', make({ intercepts: [YT] }, "module.exports = function () { return {}; };"));
        assert.notEqual(r.status, 0); assert.match(r.stderr + r.stdout, /launch\(appId\)/);
        r = run('check', make({ intercepts: [{ appId: 'a b', label: 'x' }] }, "module.exports = function () { return {}; };"));
        assert.notEqual(r.status, 0); assert.match(r.stderr + r.stdout, /intercepts/);
        const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-dist-'));
        r = run('pack', good, out); assert.equal(r.status, 0, r.stderr);
        const index = path.join(out, 'index.json');
        fs.writeFileSync(index, JSON.stringify({ format: 'vetro-plugin-index', version: 1, plugins: [] }));
        r = run('index', index, path.join(out, 'shard-1.0.0.vplugin')); assert.equal(r.status, 0, r.stderr + r.stdout);
        assert.deepEqual(JSON.parse(fs.readFileSync(index, 'utf8')).plugins[0].intercepts, [YT], 'the list entry says what the Shard intercepts');
    }

    console.log('PASS plugin intercepts: manifest rules, claims, launch fallbacks and conflicts');
})().catch(e => { console.log('FAIL ' + (e.stack || e)); process.exitCode = 1; }).then(() => clearInterval(keepAlive));
