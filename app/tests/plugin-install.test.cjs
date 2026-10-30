'use strict';
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path');
const { PluginHost, BUNDLE_MAX_BYTES } = require('../service/plugin-host.js');
const { pack } = require('../scripts/vetro-plugin.cjs');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-install-')), 'p');
const hello = pack(path.join(__dirname, '..', 'examples', 'plugins', 'hello'));
const bundle = (m, files) => JSON.stringify({ format: 'vetro-plugin', version: 1, manifest: m, files });
const M = { id: 'demo', name: 'Demo', version: '1', apiVersion: 1, permissions: [] };

(async () => {
    const dir = tmp();
    const host = new PluginHost({ dir, stableMs: 10 });
    host.start();

    // install from a packed example: lands off, hash reported, no restart needed
    let r = host.install(hello.text, hello.sha256);
    assert.equal(r.id, 'hello');
    assert.equal(r.sha256, hello.sha256);
    assert.equal(r.restartRequired, false);
    assert.equal(r.plugin.state, 'stopped');
    assert.equal(r.plugin.enabled, false);
    assert.equal(host.setEnabled('hello', true).state, 'running');

    // a running plugin is not overwritten or removed
    assert.throws(() => host.install(hello.text), /Switch the plugin off/);
    assert.throws(() => host.remove('hello'), /Switch the plugin off/);
    host.setEnabled('hello', false);

    // update: files replaced, old code stays loaded until restart
    r = host.install(hello.text);
    assert.equal(r.restartRequired, true);

    // refusals
    assert.throws(() => host.install(hello.text, 'ab'.repeat(32)), /SHA-256 does not match/);
    assert.throws(() => host.install('{nope'), /invalid JSON/);
    assert.throws(() => host.install('{"format":"other"}'), /Not a plugin bundle/);
    assert.throws(() => host.install(bundle({ ...M, id: 'install' }, { 'index.js': 'x' })), /Invalid plugin id/);
    assert.throws(() => host.install(bundle({ ...M, apiVersion: 2 }, { 'index.js': 'x' })), /Unsupported plugin API 2/);
    assert.throws(() => host.install(bundle({ ...M, permissions: ['root'] }, { 'index.js': 'x' })), /Unknown permission/);
    assert.throws(() => host.install(bundle(M, { '../evil.js': 'x', 'index.js': 'x' })), /Invalid file entry/);
    assert.throws(() => host.install(bundle(M, { '/abs.js': 'x', 'index.js': 'x' })), /Invalid file entry/);
    assert.throws(() => host.install(bundle(M, { 'manifest.json': '{}', 'index.js': 'x' })), /Invalid file entry/);
    assert.throws(() => host.install(bundle(M, { 'other.js': 'x' })), /Entry file index.js is missing/);
    assert.throws(() => host.install(bundle(M, { 'index.js': 'x'.repeat(BUNDLE_MAX_BYTES + 1) })), /larger than/);
    assert.equal(fs.existsSync(path.join(dir, 'evil.js')), false);
    assert.equal(fs.existsSync(path.join(dir, '..', 'evil.js')), false);
    assert.deepEqual(fs.readdirSync(dir).filter(n => n.charAt(0) === '.'), [], 'no staging folder left behind');

    // a bundle whose code does not load is listed as invalid, not fatal
    r = host.install(bundle({ ...M, id: 'broken' }, { 'index.js': 'throw new Error("bad code")' }));
    assert.equal(r.plugin.state, 'invalid');
    assert.match(r.plugin.lastError, /bad code/);
    assert.throws(() => host.setEnabled('broken', true), /invalid/);
    // ...and fixing it replaces the invalid entry
    r = host.install(bundle({ ...M, id: 'broken' }, { 'index.js': 'module.exports=function(){return {}}' }));
    assert.equal(r.plugin.state, 'stopped');

    // sub folders in a bundle
    r = host.install(bundle({ ...M, id: 'nested' }, { 'index.js': 'module.exports=require("./lib/a.js")', 'lib/a.js': 'module.exports=function(){return {}}' }));
    assert.equal(host.setEnabled('nested', true).state, 'running');
    host.setEnabled('nested', false);

    // HTTP: install and remove through the routes, hash from the header
    const out = {};
    const json = (res, obj, code) => { out.code = code || 200; out.body = obj; };
    const readBody = (req, cb, max) => { out.max = max; cb(req.body); };
    host.handle({ method: 'POST', headers: { 'x-vetro-sha256': hello.sha256 }, body: hello.text }, {}, '/plugins/install', json, readBody);
    assert.equal(out.code, 200);
    assert.equal(out.body.sha256, hello.sha256);
    assert.ok(out.max > BUNDLE_MAX_BYTES);
    host.handle({ method: 'POST', headers: { 'x-vetro-sha256': '00' }, body: hello.text }, {}, '/plugins/install', json, readBody);
    assert.equal(out.code, 400);
    assert.match(out.body.error, /SHA-256/);
    host.handle({ method: 'GET', headers: {} }, {}, '/plugins/install', json, readBody);
    assert.equal(out.code, 405);
    host.handle({ method: 'POST' }, {}, '/plugins/nested/remove', json, readBody);
    assert.equal(out.code, 200);
    assert.equal(fs.existsSync(path.join(dir, 'nested')), false);
    assert.equal(host.status('nested'), null);
    host.handle({ method: 'POST' }, {}, '/plugins/nested/remove', json, readBody);
    assert.equal(out.code, 404);
    host.handle({ method: 'POST' }, {}, '/plugins/hello/remove', json, readBody);
    assert.equal(out.code, 200);
    host.stop();

    // everything survives a restart: installed plugins are found again, still off
    const again = new PluginHost({ dir, stableMs: 10 });
    const ids = again.start().map(p => p.id).sort();
    assert.deepEqual(ids, ['broken']);
    assert.ok(again.list().every(p => p.state === 'stopped'));
    again.stop();
    console.log('plugin-install: ok');
})().catch(e => { console.error(e); process.exit(1); });
