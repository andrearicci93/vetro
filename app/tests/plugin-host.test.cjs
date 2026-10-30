'use strict';
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path');
const { PluginHost } = require('../service/plugin-host.js');

function tmp() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-plugins-')), 'p'); }
function res() { const r = { code: 0, body: null, headersSent: false, setHeader() {}, writeHead(c) { r.code = c; r.headersSent = true; }, end(b) { r.body = b; } }; return r; }
function json(r, obj, code) { r.code = code || 200; r.headersSent = true; r.body = obj; }
function def(id, extra) { return Object.assign({ id, apiVersion: 1, defaultEnabled: true, create() { return {}; } }, extra); }

// registration rules
const h0 = new PluginHost({ dir: tmp(), external: false });
assert.throws(() => h0.register(def('lbl', { ui: { label: '' } })), /ui.label/);
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
    ui: { label: 'Web' },
    create() { return { route(req, r, sub) { if (broken) throw new Error('bad route'); json(r, { sub }); } }; }
}));
h2.start();
assert.deepEqual(h2.status('web').ui, { label: 'Web' });
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


// external plugins: folder + manifest, off until switched on, bad ones reported not fatal
const ext = tmp();
function plugin(id, manifest, code) {
    fs.mkdirSync(path.join(ext, id), { recursive: true });
    if (manifest !== null) fs.writeFileSync(path.join(ext, id, 'manifest.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
    if (code != null) fs.writeFileSync(path.join(ext, id, 'index.js'), code);
}
plugin('fine', { id: 'fine', name: 'Fine', version: '1', apiVersion: 1, ui: { label: 'Fine' } },
    "module.exports=function(ctx){return {start:function(){global.__fineStarted=(global.__fineStarted||0)+1},stop:function(){global.__fineStopped=1},route:function(q,r,s){r.writeHead(200);r.end('hi '+s+' '+ctx.id)}}}");
plugin('wrongid', { id: 'other', apiVersion: 1 }, 'module.exports=function(){return {}}');
plugin('nomani', null, 'module.exports=function(){return {}}');
plugin('badjson', '{nope', 'module.exports=function(){return {}}');
plugin('escape', { id: 'escape', apiVersion: 1, main: '../fine/index.js' }, null);
plugin('throws', { id: 'throws', apiVersion: 1 }, 'throw new Error("top level")');
plugin('oldapi', { id: 'oldapi', apiVersion: 7 }, 'module.exports=function(){return {}}');
const he = new PluginHost({ dir: ext, stableMs: 10 });
const le = he.start();
const by = id => le.filter(p => p.id === id)[0];
assert.equal(by('fine').state, 'stopped', 'external plugins start off');
assert.equal(by('fine').enabled, false);
assert.equal(global.__fineStarted, undefined, 'nothing runs before it is switched on');
assert.match(by('wrongid').lastError, /match the folder/);
assert.match(by('nomani').lastError, /manifest/);
assert.match(by('badjson').lastError, /manifest/);
assert.match(by('escape').lastError, /inside the plugin folder/);
assert.match(by('throws').lastError, /top level/);
assert.match(by('oldapi').lastError, /unsupported plugin API 7/);
['wrongid', 'nomani', 'badjson', 'escape', 'throws', 'oldapi'].forEach(id => assert.equal(by(id).state, 'invalid', id));
assert.equal(he.setEnabled('fine', true).state, 'running');
assert.equal(global.__fineStarted, 1);
let rr = res(); rr.setHeader = (k, v) => { rr[k] = v; };
he.handle({ method: 'GET', headers: { origin: 'null' } }, rr, '/plugins/fine/api/x', json);
assert.equal(rr['Content-Security-Policy'], 'sandbox allow-scripts');
assert.equal(rr['Access-Control-Allow-Origin'], 'null');
rr = res(); he.handle({ method: 'POST' }, rr, '/plugins/badjson/enable', json);
assert.equal(rr.code, 409);
he.stop();
assert.equal(global.__fineStopped, 1);

// example shipped in the repo loads and works
const exDir = tmp();
fs.mkdirSync(exDir, { recursive: true });
const exSrc = path.join(__dirname, '..', 'examples', 'plugins', 'hello');
fs.mkdirSync(path.join(exDir, 'hello'));
['manifest.json', 'index.js'].forEach(f => fs.copyFileSync(path.join(exSrc, f), path.join(exDir, 'hello', f)));
const hx = new PluginHost({ dir: exDir, stableMs: 10 });
assert.equal(hx.start()[0].state, 'stopped');
assert.equal(hx.setEnabled('hello', true).state, 'running');
let pressed = null;
const pr = { headersSent: false, setHeader() {}, writeHead() { this.headersSent = true; }, end(b) { pressed = JSON.parse(b); } };
hx.handle({ method: 'POST', headers: {} }, pr, '/plugins/hello/api/press', json);
assert.deepEqual(pressed, { count: 1 });
hx.stop();
const hy = new PluginHost({ dir: exDir, stableMs: 10 });
hy.start();
assert.equal(hy.setEnabled('hello', true).detail.count, 1, 'count survives a restart');
hy.stop();

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
