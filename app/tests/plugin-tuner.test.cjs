'use strict';
// The Vetro TV Tuner plugin: its two routes and its supervision timer.
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path');
const { PluginHost } = require('../service/plugin-host.js');
const plugin = require('../service/plugin-tuner.js');

function res() { const r = { code: 0, head: null, body: null, headersSent: false, setHeader() {}, writeHead(c, h) { r.code = c; r.head = h; r.headersSent = true; }, end(b) { r.body = b; } }; return r; }
function json(r, obj, code) { r.code = code || 200; r.headersSent = true; r.body = obj; }
const nextTick = ms => new Promise(r => setTimeout(r, ms));

const log = [];
let enabled = false, connected = false;
const tuner = {
    readState: () => ({ enabled }), installed: () => true,
    status: () => Promise.resolve({ enabled }),
    enable: () => { log.push('enable'); enabled = true; return Promise.resolve({ enabled }); },
    disable: () => { log.push('disable'); enabled = false; return Promise.resolve({ enabled }); },
    command: name => { log.push('command:' + name); return Promise.resolve({ ok: true, command: name }); },
    supervise: up => { log.push('supervise:' + up); return Promise.resolve(); }
};
const services = {
    agentConnected: () => connected, json,
    readJson: (req, r, cb) => { let p; try { p = JSON.parse(req.body); } catch (e) { p = null; }
        if (!p || typeof p !== 'object' || Array.isArray(p)) return json(r, { error: 'expected a JSON object' }, 400);
        cb(p); }
};
const host = new PluginHost({ dir: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-tuner-plugin-')), 'p'), external: false, services, stableMs: 10 })
    .register(plugin.definition(tuner, { tickMs: 20 }));
host.start();

const get = sub => { const r = res(); host.dispatch('tuner', { method: 'GET', url: '/tuner', headers: {} }, r, sub, json); return r; };
const post = body => { const r = res(); host.dispatch('tuner', { method: 'POST', url: '/tuner', headers: {}, body }, r, 'action', json); return r; };

(async () => {
    assert.equal(host.status('tuner').state, 'running');
    assert.deepEqual(host.status('tuner').detail, { enabled: false, installed: true });
    const listed = host.list().find(p => p.id === 'tuner');
    assert.equal(listed.bundled, true); assert.equal(listed.name, 'Vetro TV Tuner');

    const st = get('status'); await nextTick(1);
    assert.deepEqual(st.body, { enabled: false });
    for (const [body, entry] of [['{"action":"enable"}', 'enable'], ['{"action":"disable"}', 'disable'],
        ['{"action":"show"}', 'command:show'], ['{"action":"hide"}', 'command:hide'], ['{"action":"toggle"}', 'command:toggle'], ['{"action":"guide"}', 'command:guide']]) {
        const before = log.length;
        post(body); await nextTick(1);
        assert.equal(log[before], entry);
    }
    let r = post('{"action":"format"}'); await nextTick(1);
    assert.equal(r.code, 409); assert.deepEqual(r.body, { ok: false, error: 'Invalid tuner action' });
    r = post('{"action":"closeSamsung","on":true}'); await nextTick(1);
    assert.equal(r.code, 409); assert.deepEqual(r.body, { ok: false, error: 'Invalid tuner action' }, 'there is no option to close Samsung\u2019s app');
    assert.equal(post('null').code, 400);
    assert.equal(get('nope').code, 404);
    r = res(); host.dispatch('tuner', { method: 'GET', url: '/tuner', headers: {} }, r, 'action', json);
    assert.equal(r.code, 404, 'a route answers only the method it is for');

    // supervision: at once when the agent connects, then on the fifth tick
    log.length = 0;
    connected = true;
    await nextTick(30);
    assert.equal(log[0], 'supervise:true', 'a connect edge supervises at once');
    await nextTick(150);
    assert.ok(log.filter(x => x === 'supervise:true').length >= 2, 'and again every fifth tick');

    // a bundled plugin has no switch of its own in the host: the tuner's own switch is the only one
    assert.throws(() => host.setEnabled('tuner', false), /use its own switch/);
    console.log('plugin-tuner: ok');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
