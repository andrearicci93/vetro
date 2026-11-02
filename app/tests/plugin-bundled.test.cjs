'use strict';
// Bundled plugins: ship with Vetro, on by default, get ctx.vetro, keep running in safe mode, cannot be switched off,
// removed or replaced from the Plugins page, and answer the old URLs through dispatch().
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path');
const { PluginHost } = require('../service/plugin-host.js');

function tmp() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-bundled-')), 'p'); }
function res() { const r = { code: 0, body: null, headersSent: false, setHeader() {}, writeHead(c) { r.code = c; r.headersSent = true; }, end(b) { r.body = b; } }; return r; }
function json(r, obj, code) { r.code = code || 200; r.headersSent = true; r.body = obj; }
const services = { marker: 'shell' };
let seen = {};
const bundled = { id: 'inner', name: 'Inner', apiVersion: 1, bundled: true, create(ctx) {
    seen.vetro = ctx.vetro;
    return { start() { seen.started = (seen.started || 0) + 1; }, stop() { seen.stopped = (seen.stopped || 0) + 1; },
        status() { return { ok: 1 }; }, route(req, r, sub) { if (sub !== 'hi') return false; json(r, { hi: sub }); return true; } };
} };
const third = { id: 'third', apiVersion: 1, defaultEnabled: true, create(ctx) { seen.thirdVetro = ctx.vetro; return {}; } };

// on by default, ctx.vetro for bundled only, listed apart from the plugins a user installs
let h = new PluginHost({ dir: tmp(), external: false, services }).register(bundled).register(third);
h.start();
assert.equal(h.status('inner').state, 'running');
assert.equal(h.status('inner').bundled, true);
assert.equal(h.status('inner').trust, 'bundled');
assert.equal(seen.vetro, services, 'a bundled plugin gets the shell services');
assert.equal(seen.thirdVetro, undefined, 'a third-party plugin does not');
const listing = res();
h.handle({ method: 'GET', headers: {} }, listing, '/plugins', json);
assert.deepEqual(listing.body.plugins.map(p => p.id), ['third']);
assert.deepEqual(listing.body.bundled.map(p => p.id), ['inner']);

// cannot be switched off, removed or replaced
assert.throws(() => h.setEnabled('inner', false), /part of Vetro/);
assert.throws(() => h.remove('inner'), /part of Vetro/);
const bundle = JSON.stringify({ format: 'vetro-plugin', version: 1, manifest: { id: 'inner', apiVersion: 1, name: 'Evil' }, files: { 'index.js': 'module.exports=function(){return {}}' } });
assert.throws(() => h.install(bundle, null, null), /part of Vetro/);
assert.equal(h.setEnabled('inner', true).state, 'running', 'switching it on again is harmless');

// dispatch: runs the route, answers for a missing or stopped plugin
let r = res();
h.dispatch('inner', { method: 'GET', headers: {} }, r, 'hi', json);
assert.deepEqual(r.body, { hi: 'hi' });
r = res(); h.dispatch('inner', { method: 'GET', headers: {} }, r, 'nope', json);
assert.equal(r.code, 404);
r = res(); h.dispatch('third', { method: 'GET', headers: {} }, r, 'x', json);
assert.equal(r.code, 404, 'dispatch is for bundled plugins only');
h.stop();
assert.equal(seen.stopped, 1);
r = res(); h.dispatch('inner', { method: 'GET', headers: {} }, r, 'hi', json);
assert.equal(r.code, 503);
assert.match(r.body.error, /Inner is not running/);

// safe mode: an interrupted boot pauses the third-party plugin and leaves the bundled one running
const dir = tmp();
h = new PluginHost({ dir, external: false, services }).register(bundled).register(third);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'starting'), '1');
seen = {};
h.start();
assert.equal(h.safeMode, true);
assert.equal(h.status('third').state, 'suspended');
assert.equal(h.status('inner').state, 'running');
assert.equal(seen.started, 1);
h.stop();

// a failing bundled plugin is counted but never switched off (it has no switch to turn it back on); dispatch says why
let calls = 0;
const flaky = { id: 'flaky', name: 'Flaky', apiVersion: 1, bundled: true, create() { return { route() { calls++; throw new Error('boom'); } }; } };
h = new PluginHost({ dir: tmp(), external: false, services, maxErrors: 2 }).register(flaky);
h.start();
for (let i = 0; i < 4; i++) { r = res(); h.dispatch('flaky', { method: 'GET', headers: {} }, r, 'x', json); }
assert.equal(h.status('flaky').state, 'running', 'still running after more errors than a third-party plugin survives');
assert.equal(h.status('flaky').errors >= 2, true);
assert.equal(r.code, 500);
assert.match(r.body.error, /Flaky failed: boom/);
assert.equal(calls, 4, 'and still called');
h.stop();

// listing the plugins asks each one for its status once: a status() that throws is counted once per poll, not twice
let polls = 0;
const sick = { id: 'sick', apiVersion: 1, defaultEnabled: true, create() { return { status() { polls++; throw new Error('sick'); } }; } };
h = new PluginHost({ dir: tmp(), external: false, services }).register(sick);
h.start();
polls = 0;
for (let i = 0; i < 2; i++) h.handle({ method: 'GET', headers: {} }, res(), '/plugins', json);
assert.equal(polls, 2, 'one status() call per poll');
assert.equal(h.status('sick').errors, 3, 'two polls and the check just now: 3 errors');
h.stop();
console.log('plugin-bundled: ok');
