'use strict';
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path');
const { PluginHost } = require('../service/plugin-host.js');

function tmp() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-plugins-')), 'p'); }
function res() { const r = { code: 0, body: null, headersSent: false, writeHead(c) { r.code = c; r.headersSent = true; }, end(b) { r.body = b; } }; return r; }
function json(r, obj, code) { r.code = code || 200; r.headersSent = true; r.body = obj; }
function def(id, extra) { return Object.assign({ id, apiVersion: 1, create() { return {}; } }, extra); }

// registration rules
const h0 = new PluginHost({ dir: tmp() });
assert.throws(() => h0.register(def('Bad Id')), /Invalid plugin id/);
assert.throws(() => h0.register(def('old', { apiVersion: 2 })), /unsupported plugin API/);
assert.throws(() => h0.register(def('perm', { permissions: ['root'] })), /unknown permission/);
h0.register(def('ok'));
assert.throws(() => h0.register(def('ok')), /Duplicate/);

// lifecycle, enable/disable persisted
const dir = tmp();
let started = 0, stopped = 0;
const good = def('good', { create() { return { start() { started++; }, stop() { stopped++; }, status() { return { n: 1 }; } }; } });
let h = new PluginHost({ dir, stableMs: 10 }).register(good);
assert.equal(h.start()[0].state, 'running');
assert.deepEqual(h.status('good').detail, { n: 1 });
assert.equal(h.setEnabled('good', false).state, 'stopped');
assert.equal(stopped, 1);
h.stop();
h = new PluginHost({ dir, stableMs: 10 }).register(good);
assert.equal(h.start()[0].state, 'stopped', 'disabled choice survives a restart');
h.stop();

// a plugin that throws on start does not stop the others
const h1 = new PluginHost({ dir: tmp() }).register(def('boom', { create() { throw new Error('nope'); } })).register(good);
const l1 = h1.start();
assert.equal(l1[0].state, 'failed');
assert.equal(l1[0].lastError, 'nope');
assert.equal(l1[1].state, 'running');
h1.stop();

// routes: isolated prefix, failing route counted, plugin switched off after maxErrors
let broken = true;
const h2 = new PluginHost({ dir: tmp(), maxErrors: 2 }).register(def('web', {
    create() { return { route(req, r, sub) { if (broken) throw new Error('bad route'); json(r, { sub }); } }; }
}));
h2.start();
let r = res();
assert.equal(h2.handle({ method: 'GET' }, r, '/other', json), false);
r = res(); h2.handle({ method: 'GET' }, r, '/plugins/web/api/x', json);
assert.equal(r.code, 404);
r = res(); h2.handle({ method: 'GET' }, r, '/plugins/web/api/x', json);
assert.equal(h2.status('web').state, 'failed');
r = res(); h2.handle({ method: 'GET' }, r, '/plugins/web/api/x', json);
assert.equal(r.code, 503);
r = res(); h2.handle({ method: 'GET' }, r, '/plugins/nope/api/x', json);
assert.equal(r.code, 404);
r = res(); h2.handle({ method: 'POST' }, r, '/plugins/web/enable', json);
broken = false;
r = res(); h2.handle({ method: 'GET' }, r, '/plugins/web/api/a/b', json);
assert.deepEqual(r.body, { sub: 'a/b' });
r = res(); h2.handle({ method: 'GET' }, r, '/plugins', json);
assert.equal(r.body.plugins.length, 1);
h2.stop();

// exec is only lent to plugins that ask for it
const calls = [];
let ctxA, ctxB;
const h3 = new PluginHost({ dir: tmp(), execute: c => { calls.push(c); return Promise.resolve({}); } })
    .register(def('exec-yes', { permissions: ['exec'], create(c) { ctxA = c; return {}; } }))
    .register(def('exec-no', { create(c) { ctxB = c; return {}; } }));
h3.start();
(async () => {
    await ctxA.execute('id');
    await assert.rejects(ctxB.execute('id'), /no exec permission/);
    assert.deepEqual(calls, ['id']);
    ctxA.config.set({ x: 1 });
    assert.deepEqual(ctxA.config.get(), { x: 1 });
    assert.deepEqual(ctxB.config.get(), {}, 'config is per plugin');
    h3.stop();

    // safe mode: a boot that never reached markStable suspends plugins on the next one
    const sdir = tmp();
    let s1 = new PluginHost({ dir: sdir, stableMs: 60000 }).register(good);
    s1.start();
    s1.stableTimer && clearTimeout(s1.stableTimer);
    // simulate a crash: no stop(), marker left behind
    const s2 = new PluginHost({ dir: sdir, stableMs: 60000 }).register(good);
    const l2 = s2.start();
    assert.equal(s2.safeMode, true);
    assert.equal(l2[0].state, 'suspended');
    const s3 = new PluginHost({ dir: sdir }).register(good);
    s3.start();
    assert.equal(s3.safeMode, true, 'stays suspended until the user resumes');
    assert.equal(s3.resume().restartRequired, true);
    const s4 = new PluginHost({ dir: sdir, stableMs: 10 }).register(good);
    assert.equal(s4.start()[0].state, 'running');
    s4.stop();
    console.log('plugin-host: ok');
})().catch(e => { console.error(e); process.exit(1); });
