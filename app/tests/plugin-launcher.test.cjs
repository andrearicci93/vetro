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
    setCompleteAppList: (on, expected) => { log.push('completion:' + on + ':' + expected); return Promise.resolve({completeAppList: on}); },
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
    for (const [body, entry] of [['{"action":"enable"}', 'enable'], ['{"action":"disable"}', 'disable'], ['{"action":"refresh"}', 'refresh'], ['{"action":"fixTizenTube","on":true}', 'fix:true'], ['{"action":"noMotion","on":true}', 'motion:true'], ['{"action":"noMotion","on":false}', 'motion:false'], ['{"action":"completeAppList","on":true,"expected":false}', 'completion:true:false']]) {
        const before = log.length;
        post(body); await nextTick(1);
        assert.equal(log[before], entry);
    }
    let r = post('{"action":"format"}'); await nextTick(1);
    assert.equal(r.code, 409); assert.deepEqual(r.body, { ok: false, error: 'Invalid dock action' });
    assert.equal(post('null').code, 400);
    r = get('icon', '/dock/icon?slug=known');
    assert.equal(r.code, 200); assert.equal(r.head['content-type'], 'image/png'); assert.equal(r.body.toString(), 'PNG');
    assert.equal(get('icon', '/dock/icon?slug=..%2Fx').code, 404);
    assert.equal(get('icon', '/dock/icon').code, 404);
    assert.equal(get('nope').code, 404);
    r = res(); host.dispatch('launcher', { method: 'GET', url: '/dock', headers: {} }, r, 'action', json);
    assert.equal(r.code, 404, 'a route answers only the method it is for');

    // supervision: at once when the agent connects, then on the fifth tick
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
