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
    assert.equal(r.updated, false);
    assert.equal(r.plugin.state, 'stopped');
    assert.equal(r.plugin.enabled, false);
    assert.equal(host.setEnabled('hello', true).state, 'running');

    // a running plugin is not overwritten or removed
    assert.throws(() => host.install(hello.text), /Switch the plugin off/);
    assert.throws(() => host.remove('hello'), /Switch the plugin off/);
    host.setEnabled('hello', false);

    // update: files replaced, new code loaded now, comes back switched off
    r = host.install(hello.text);
    assert.equal(r.updated, true);
    assert.equal(r.plugin.state, 'stopped');
    assert.equal(r.plugin.enabled, false);

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

    // installing never runs the plugin's code; code that fails shows up when it is switched on
    global.__installRan = 0;
    r = host.install(bundle({ ...M, id: 'broken' }, { 'index.js': 'global.__installRan++; throw new Error("bad code")' }));
    assert.equal(r.plugin.state, 'stopped');
    assert.equal(global.__installRan, 0, 'install did not execute the plugin');
    assert.equal(host.setEnabled('broken', true).state, 'failed');
    assert.match(host.status('broken').lastError, /bad code/);
    // ...and fixing it replaces the failed entry
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
    // an update keeps the plugin's saved config; remove + install again runs the new code, not a cached copy
    const code = (tag) => 'module.exports=function(){return {status:function(){return {tag:"' + tag + '"}}}}';
    host.install(bundle({ ...M, id: 'keeper' }, { 'index.js': code('v1') }));
    host.setEnabled('keeper', true);
    host.setEnabled('keeper', false);
    fs.writeFileSync(path.join(dir, 'keeper', 'config.json'), '{"saved":true}\n');
    host.install(bundle({ ...M, id: 'keeper', version: '2' }, { 'index.js': code('v2') }));
    assert.equal(fs.readFileSync(path.join(dir, 'keeper', 'config.json'), 'utf8'), '{"saved":true}\n');
    assert.deepEqual(fs.readdirSync(dir).filter(n => n.charAt(0) === '.'), [], 'no staging or backup folder left behind');
    assert.equal(host.setEnabled('keeper', true).detail.tag, 'v2', 'an update runs without a restart');
    host.setEnabled('keeper', false);
    host.remove('keeper');
    host.install(bundle({ ...M, id: 'keeper', version: '3' }, { 'index.js': code('v3') }));
    assert.equal(host.setEnabled('keeper', true).detail.tag, 'v3');
    host.setEnabled('keeper', false);
    host.remove('keeper');

    // manifest fields are checked before anything is written
    assert.throws(() => host.install(bundle({ ...M, id: 'typed', name: { x: 1 } }, { 'index.js': 'x' })), /name must be/);
    assert.throws(() => host.install(bundle({ ...M, id: 'typed', version: 2 }, { 'index.js': 'x' })), /version must be/);
    assert.throws(() => host.install(bundle({ ...M, id: 'typed', ui: { label: 'x'.repeat(25) } }, { 'index.js': 'x' })), /ui.label/);
    assert.throws(() => host.install(bundle({ ...M, id: 'typed', permissions: 'exec' }, { 'index.js': 'x' })), /permissions must be a list/);
    assert.equal(fs.existsSync(path.join(dir, 'typed')), false);

    // a sandboxed plugin page (origin "null") can ask for a CORS preflight before a JSON POST
    host.install(hello.text);
    host.setEnabled('hello', true);
    const pre = { code: 0, headers: null };
    host.handle({ method: 'OPTIONS', headers: { origin: 'null' } }, { writeHead: (c, h) => { pre.code = c; pre.headers = h; }, end: () => {} }, '/plugins/hello/api/press', json, readBody);
    assert.equal(pre.code, 204);
    assert.equal(pre.headers['Access-Control-Allow-Origin'], 'null');
    host.setEnabled('hello', false);


    // a plugin page has no sign-in cookie: it gets a session token in its own URL, good for that plugin only
    host.install(hello.text);
    host.setEnabled('hello', true);
    out.body = null;
    host.handle({ method: 'POST', headers: {} }, {}, '/plugins/hello/session', json, readBody);
    assert.equal(out.code, 200);
    const sessionPath = out.body.path;
    assert.match(sessionPath, /^\/plugins\/hello\/s\/[0-9a-f]{32}\/api\/ui$/);
    const page = () => { const r = { code: 0, headers: {}, setHeader(k, v) { r.headers[k] = v; }, writeHead(c) { r.code = c; }, end() {} }; return r; };
    let pr = page(); host.handle({ method: 'GET', headers: { origin: 'null' } }, pr, sessionPath, json, readBody);
    assert.equal(pr.code, 200, 'the token opens the plugin page');
    assert.equal(pr.headers['Referrer-Policy'], 'no-referrer');
    pr = page(); host.handle({ method: 'GET', headers: { origin: 'null' } }, pr, sessionPath.replace('/api/ui', '/api/count'), json, readBody);
    assert.equal(pr.code, 200, 'relative URLs from the page resolve under the same token');
    host.handle({ method: 'GET', headers: {} }, {}, sessionPath.replace(/\/s\/[0-9a-f]{32}/, '/s/' + '0'.repeat(32)), json, readBody);
    assert.equal(out.code, 401, 'a wrong token is refused');
    host.handle({ method: 'POST', headers: {} }, {}, sessionPath.replace('/api/ui', '/disable'), json, readBody);
    assert.equal(out.code, 401, 'a token reaches api routes only, never enable/disable/remove');
    host.handle({ method: 'GET', headers: {} }, {}, '/plugins/other/s/' + sessionPath.split('/')[4] + '/api/ui', json, readBody);
    assert.notEqual(out.code, 200, 'a token is good for its own plugin only');
    host.handle({ method: 'POST', headers: {} }, {}, '/plugins/broken/session', json, readBody);
    assert.equal(out.code, 409, 'no session for a plugin that is not running');
    host.setEnabled('hello', false);
    host.handle({ method: 'GET', headers: {} }, {}, sessionPath, json, readBody);
    assert.equal(out.code, 401, 'switching the plugin off ends its sessions');
    host.remove('hello');
    host.stop();

    // everything survives a restart: installed plugins are found again, still off
    const again = new PluginHost({ dir, stableMs: 10 });
    const ids = again.start().map(p => p.id).sort();
    assert.deepEqual(ids, ['broken']);
    assert.ok(again.list().every(p => p.state === 'stopped'));
    again.stop();
    console.log('plugin-install: ok');
})().catch(e => { console.error(e); process.exit(1); });
