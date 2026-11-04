'use strict';
// The plugin list key: a bundle installs with the list's signature, or in Developer mode; a wrong or missing signature
// is refused regardless of whether a key is configured. Not the same key as the update key.
const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const { PluginHost, signedText } = require('../service/plugin-host.js');

const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pub = keys.publicKey.export({ type: 'spki', format: 'pem' });
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const sign = (id, version, hash, key) => crypto.sign('RSA-SHA256', Buffer.from(signedText(id, version, hash)), (key || keys).privateKey).toString('base64');
const bundle = (id, version) => JSON.stringify({ format: 'vetro-plugin', version: 1,
    manifest: { id, apiVersion: 1, name: id, version, permissions: [] }, files: { 'index.js': 'module.exports = function () { return { start: function () {}, stop: function () {} }; };\n' } });
const host = key => new PluginHost({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-sig-')), registryKey: key, external: false });
function call(h, method, url, body) {
    return new Promise(resolve => {
        const req = new EventEmitter(); req.method = method; req.url = url; req.headers = {};
        let status; const res = { setHeader() {}, writeHead: n => { status = n; }, end: text => resolve({ status, body: JSON.parse(text) }) };
        h.handle(req, res, url, (r, d, c) => { r.writeHead(c || 200); r.end(JSON.stringify(d)); }, (rq, cb) => { rq.on('data', c => {}); cb(body || ''); });
        if (method === 'POST') { req.emit('end'); }
    });
}

(async () => {
    const b = bundle('hello', '1.0.0'), h1 = sha(b), h = host(pub);
    // signed by the list: installs, and says so
    const ok = h.install(b, h1, sign('hello', '1.0.0', h1));
    assert.equal(ok.trust, 'registry'); assert.equal(h.status('hello').trust, 'registry');
    // wrong key, wrong version, wrong hash: refused
    assert.throws(() => host(pub).install(b, h1, sign('hello', '1.0.0', h1, other)), /does not match the plugin list key/);
    assert.throws(() => host(pub).install(b, h1, sign('hello', '9.9.9', h1)), /does not match the plugin list key/);
    assert.throws(() => host(pub).install(b, h1, sign('hello', '1.0.0', '0'.repeat(64))), /does not match the plugin list key/);
    // another plugin id under a valid signature for hello is refused
    const evil = bundle('evil', '1.0.0');
    assert.throws(() => host(pub).install(evil, sha(evil), sign('hello', '1.0.0', sha(evil))), /does not match/);
    // no signature: refused until Developer mode, then installed as a file
    const h2 = host(pub);
    assert.throws(() => h2.install(b, h1), /not signed by the plugin list.*Developer mode/);
    assert.equal((await call(h2, 'POST', '/plugins/developer', '{"on":true}')).body.developer, true);
    assert.equal(h2.install(b, h1).trust, 'file'); assert.equal(h2.status('hello').trust, 'file');
    assert.equal((await call(h2, 'GET', '/plugins')).body.developer, true);
    assert.equal((await call(h2, 'GET', '/plugins')).body.signed, true);
    assert.equal((await call(h2, 'POST', '/plugins/developer', '{"on":"yes"}')).status, 400);
    // an update from a file takes the registry trust away; removing forgets it
    const h3 = host(pub); h3.install(b, h1, sign('hello', '1.0.0', h1));
    await call(h3, 'POST', '/plugins/developer', '{"on":true}');
    const b2 = bundle('hello', '1.0.1'); h3.install(b2, sha(b2));
    assert.equal(h3.status('hello').trust, 'file');
    h3.remove('hello'); assert.equal(h3._readState().trust.hello, undefined);
    // a signature with no key configured cannot be checked, so it is not trusted
    assert.throws(() => host(null).install(b, h1, sign('hello', '1.0.0', h1)), /no plugin list key/);
    // No key cannot silently bypass Developer mode.
    const h4 = host(null); assert.throws(() => h4.install(b, h1), /Developer mode/);
    await call(h4, 'POST', '/plugins/developer', '{"on":true}');
    assert.equal(h4.install(b, h1).trust, 'file');
    assert.equal((await call(h4, 'GET', '/plugins')).body.signed, false);
    // "developer" is not a plugin id
    assert.throws(() => host(null).install(bundle('developer', '1.0.0')), /Invalid plugin id|Unknown|not allowed|reserved/i);
    console.log('PASS plugin list signature: signed install, wrong key/version/hash/id refused, Developer mode, trust shown, no-key installs also require Developer mode');
})().catch(e => { console.error(e); process.exit(1); });
