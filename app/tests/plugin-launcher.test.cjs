'use strict';
// The launcher plugin: its three routes behave as the old /dock routes did, and its timer supervises the dock.
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path');
const { PluginHost } = require('../service/plugin-host.js');
const launcher = require('../service/plugin-launcher.js');

function res() { const r = { code: 0, head: null, body: null, headersSent: false, setHeader() {}, writeHead(c, h) { r.code = c; r.head = h; r.headersSent = true; }, end(b) { r.body = b; } }; return r; }
function json(r, obj, code) { r.code = code || 200; r.headersSent = true; r.body = obj; }
const nextTick = ms => new Promise(r => setTimeout(r, ms));

const log = [];
let enabled = false, connected = false;
const dock = {
    readState: () => ({ enabled }), installed: () => true,
    status: o => Promise.resolve({ enabled, preview: !!(o && o.preview) }),
    enable: () => { log.push('enable'); enabled = true; return Promise.resolve({ enabled }); },
    disable: () => { log.push('disable'); enabled = false; return Promise.resolve({ enabled }); },
    refresh: () => { log.push('refresh'); return Promise.resolve({ ok: true }); },
    setNoMotion: on => { log.push('motion:' + on); return Promise.resolve({ noMotion: on }); },
    setHdrDim: on => { log.push('hdrDim:' + on); return Promise.resolve({ hdrDim: on }); },
    setHdrBrightness: brightness => { log.push('hdrBrightness:' + brightness); return Promise.resolve({ hdrBrightness: brightness }); },
    setFixTizenTube: on => { log.push('fix:' + on); return Promise.resolve({ fix: on }); },
    iconFile: slug => slug === 'known' ? Buffer.from('PNG') : null,
    supervise: up => { log.push('supervise:' + up); return Promise.resolve(); }
};
const services = {
    agentConnected: () => connected, json,
    readJson: (req, r, cb) => { let p; try { p = JSON.parse(req.body); } catch (e) { p = null; }
        if (!p || typeof p !== 'object' || Array.isArray(p)) return json(r, { error: 'expected a JSON object' }, 400);   // as main.js's readJsonBody
        cb(p); }
};
const host = new PluginHost({ dir: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-launcher-')), 'p'), external: false, services, stableMs: 10 })
    .register(launcher.definition(dock, { tickMs: 20 }));
host.start();

const get = (sub, url) => { const r = res(); host.dispatch('launcher', { method: 'GET', url: url || '/dock', headers: {} }, r, sub, json); return r; };
const post = (body) => { const r = res(); host.dispatch('launcher', { method: 'POST', url: '/dock', headers: {}, body }, r, 'action', json); return r; };

(async () => {
    assert.equal(host.status('launcher').state, 'running');
    assert.deepEqual(host.status('launcher').detail, { enabled: false, installed: true });

    // status, actions, icon: the answers the old routes gave
    const st = get('status'); await nextTick(1);
    assert.deepEqual(st.body, { enabled: false, preview: true });
    for (const [body, entry] of [['{"action":"enable"}', 'enable'], ['{"action":"disable"}', 'disable'], ['{"action":"refresh"}', 'refresh'], ['{"action":"fixTizenTube","on":true}', 'fix:true'], ['{"action":"noMotion","on":true}', 'motion:true'], ['{"action":"noMotion","on":false}', 'motion:false'], ['{"action":"hdrDim","on":true}', 'hdrDim:true'], ['{"action":"hdrBrightness","brightness":30}', 'hdrBrightness:30']]) {
        const before = log.length;
        post(body); await nextTick(1);
        assert.equal(log[before], entry);
    }
    let r = post('{"action":"format"}'); await nextTick(1);
    assert.equal(r.code, 409); assert.deepEqual(r.body, { ok: false, error: 'Invalid dock action' });
    assert.equal(post('null').code, 400);
    r = get('icon', '/dock/icon?slug=known');
    assert.equal(r.code, 200); assert.equal(r.head['content-type'], 'image/png'); assert.equal(r.body.toString(), 'PNG');
    // An ETag: asked again with it, an unchanged picture is a 304 without the image.
    assert.match(r.head.etag, /^"[0-9a-f]{20}"$/);
    const again = res(); host.dispatch('launcher', { method: 'GET', url: '/dock/icon?slug=known', headers: { 'if-none-match': r.head.etag } }, again, 'icon', json);
    assert.equal(again.code, 304); assert.ok(!again.body || !again.body.length);
    assert.equal(get('icon', '/dock/icon?slug=..%2Fx').code, 404);
    assert.equal(get('icon', '/dock/icon').code, 404);
    assert.equal(get('nope').code, 404);
    r = res(); host.dispatch('launcher', { method: 'GET', url: '/dock', headers: {} }, r, 'action', json);
    assert.equal(r.code, 404, 'a route answers only the method it is for');

    // "Rebuild the list" first takes the Home lines of apps that are gone, then rebuilds; a failed sweep never stops the rebuild
    const scripts = [];
    dock.execute = async cmd => {
        const script = Buffer.from(/^echo (\S+) \|/.exec(cmd)[1], 'base64').toString(); scripts.push(script);
        return /ORPHAN \$id/.test(script) ? { exit_code: 0, stdout: 'ORPHAN newslO9NqF.stremio\nREGISTRY 40\n' } : { exit_code: 0, stdout: 'HOME 2\n' };
    };
    let before = log.length;
    r = post('{"action":"refresh"}'); await nextTick(20);
    assert.equal(log[before], 'refresh'); assert.equal(scripts.length, 2, 'one read of the Home row, one cleanup');
    assert.deepEqual(r.body.cleaned.removed, ['newslO9NqF.stremio']);
    scripts.length = 0; dock.execute = async () => { throw new Error('agent gone'); };
    before = log.length; r = post('{"action":"refresh"}'); await nextTick(20);
    assert.equal(log[before], 'refresh'); assert.equal(r.body.cleaned, undefined, 'the rebuild goes on when the sweep fails');
    delete dock.execute;

    // open: 503 when root agent is disconnected so the launcher falls back instead of a silent dead tile; 202 when connected
    const opened = [];
    dock.shardEntry = slug => slug === 'youtube' ? { slug: 'youtube', appId: 'com.samsung.tv.cobalt-yt', shard: true } : null;
    dock.openEntry = slug => { opened.push(slug); return Promise.resolve({ ok: true, via: 'youtube' }); };
    connected = false;
    const openDown = res();
    host.dispatch('launcher', { method: 'POST', url: '/plugins/launcher/api/open?slug=youtube', headers: {} }, openDown, 'open', json);
    await nextTick(5);
    assert.equal(openDown.code, 503, 'open refuses with 503 while root agent is disconnected');
    assert.deepEqual(opened, [], 'open does not dispatch when agent is down');
    connected = true;
    const openUp = res();
    host.dispatch('launcher', { method: 'POST', url: '/plugins/launcher/api/open?slug=youtube', headers: {} }, openUp, 'open', json);
    await nextTick(5);
    assert.equal(openUp.code, 202, 'open answers 202 when root agent is connected');
    assert.deepEqual(opened, ['youtube']);

    // supervision: at once when the agent connects, then on the fifth tick
    connected = false;
    await nextTick(30);
    log.length = 0;
    connected = true;
    await nextTick(30);
    assert.equal(log[0], 'supervise:true', 'a connect edge supervises at once');
    log.length = 0;
    await nextTick(150);
    assert.ok(log.length >= 1 && log.every(l => l === 'supervise:true'), 'then every fifth tick');
    assert.ok(log.length <= 2, 'and not on every tick');

    // switching the plugin off stops the timer and nothing else
    host.stop();
    log.length = 0;
    await nextTick(80);
    assert.deepEqual(log, [], 'no supervision after stop');
    console.log('plugin-launcher: ok');
})().catch(e => { console.error(e); process.exitCode = 1; });
