'use strict';
// Native assets (permission 'native', bundle version 2): helper binaries that travel in a bundle as base64.
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { PluginHost, signedText, ASSET_MAX_BYTES } = require('../service/plugin-host.js');
const { pack } = require('../scripts/vetro-plugin.cjs');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-assets-')), 'p');
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const BIN = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0xff, 0xfe, 0x00, 0x80, 0x0d, 0x0a, 0x1a]);   // not UTF-8, has NUL
const asset = (name, buf) => ({ name, sha256: sha(buf), size: buf.length });
const M = (extra) => Object.assign({ id: 'cap', name: 'Cap', version: '1.0.0', apiVersion: 1, permissions: ['exec', 'native'], assets: [asset('tool.bin', BIN)] }, extra || {});
const CODE = 'module.exports = function (ctx) { return { start: function () { global.__assetPath = ctx.asset("tool.bin"); } }; };';
const bundle = (m, over) => JSON.stringify(Object.assign({ format: 'vetro-plugin', version: 2, manifest: m, files: { 'index.js': CODE }, assets: { 'tool.bin': BIN.toString('base64') } }, over || {}));
const fresh = () => { const dir = tmp(), host = new PluginHost({ dir, stableMs: 10, execute: () => Promise.resolve({}) }); host._writeState({ enabled: {}, developer: true }); host.start(); return { dir, host }; };

(async () => {
    // a version 2 bundle installs; the bytes on disk are the original ones; ctx.asset points at them
    let { dir, host } = fresh();
    let r = host.install(bundle(M()));
    assert.equal(r.plugin.state, 'stopped');
    assert.deepEqual(r.plugin.permissions, ['exec', 'native']);
    assert.deepEqual(r.plugin.assets, [asset('tool.bin', BIN)]);
    const onDisk = path.join(dir, 'cap', 'assets', 'tool.bin');
    assert.ok(fs.readFileSync(onDisk).equals(BIN), 'binary bytes survive the bundle');
    assert.equal(host.setEnabled('cap', true).state, 'running');
    assert.equal(global.__assetPath, onDisk);
    host.setEnabled('cap', false);

    // an update replaces the asset
    const BIN2 = Buffer.concat([BIN, Buffer.from([1, 2, 3])]);
    r = host.install(bundle(M({ version: '1.1.0', assets: [asset('tool.bin', BIN2)] }), { assets: { 'tool.bin': BIN2.toString('base64') } }));
    assert.equal(r.updated, true);
    assert.ok(fs.readFileSync(onDisk).equals(BIN2));
    assert.deepEqual(fs.readdirSync(dir).filter(n => n.charAt(0) === '.'), [], 'no staging or backup folder left behind');

    // an asset that is changed on disk afterwards shows as Invalid when the folder is read again
    fs.writeFileSync(onDisk, BIN);
    const again = new PluginHost({ dir, stableMs: 10 });
    again.start();
    assert.equal(again.status('cap').state, 'invalid');
    assert.match(again.status('cap').lastError, /asset tool.bin does not match the manifest/);
    fs.unlinkSync(onDisk);
    const gone = new PluginHost({ dir, stableMs: 10 });
    gone.start();
    assert.match(gone.status('cap').lastError, /asset tool.bin is missing/);
    gone.stop && gone.stop();

    // refusals
    ({ dir, host } = fresh());
    const refuse = (text, re) => { assert.throws(() => host.install(text), re); assert.equal(fs.existsSync(path.join(dir, 'cap')), false); };
    const wrong = Object.assign({}, asset('tool.bin', BIN), { sha256: 'ab'.repeat(32) });
    refuse(bundle(M({ assets: [wrong] })), /does not match its SHA-256/);
    refuse(bundle(M({ assets: [Object.assign({}, asset('tool.bin', BIN), { size: BIN.length + 1 })] })), /manifest says/);
    refuse(bundle(M(), { assets: { 'tool.bin': BIN.toString('base64') + '!!' } }), /not valid base64/);
    refuse(bundle(M(), { assets: { 'tool.bin': BIN.toString('base64').slice(0, -2) } }), /not valid base64/);
    refuse(bundle(M(), { assets: { 'tool.bin': BIN.toString('base64'), 'extra.bin': 'AAAA' } }), /do not match the manifest/);
    refuse(bundle(M(), { assets: {} }), /do not match the manifest/);
    refuse(bundle(M(), { assets: undefined }), /do not match the manifest/);
    refuse(bundle(M({ permissions: ['exec'] })), /assets need the native permission/);
    refuse(bundle(M({ assets: [] }), { assets: {} }), /needs at least one asset|native permission needs/);
    refuse(bundle(M({ permissions: ['native'] })), /needs exec/);
    refuse(bundle(M(), { version: 1 }), /must be version 2/);
    refuse(JSON.stringify({ format: 'vetro-plugin', version: 2, manifest: { id: 'cap', apiVersion: 1 }, files: { 'index.js': CODE } }), /needs at least one asset/);
    refuse(JSON.stringify({ format: 'vetro-plugin', version: 3, manifest: M(), files: { 'index.js': CODE } }), /Not a plugin bundle/);
    for (const bad of ['../tool.bin', 'sub/tool.bin', '/tool.bin', '.hidden', 'manifest.json', 'config.json', '']) {
        refuse(bundle(M({ assets: [asset(bad, BIN)] }), { assets: { [bad]: BIN.toString('base64') } }), /Invalid asset name/);
    }
    refuse(bundle(M({ assets: [asset('tool.bin', BIN), asset('tool.bin', BIN)] })), /Duplicate asset/);
    refuse(bundle(M(), { files: { 'index.js': CODE, 'assets/tool.bin': 'text pretending to be the helper' } }), /assets\/ is where the assets go/);
    refuse(bundle(M(), { files: { 'index.js': CODE, 'assets': 'x' } }), /assets\/ is where the assets go/);
    const big = Buffer.alloc(ASSET_MAX_BYTES + 1, 7);
    refuse(bundle(M({ assets: [asset('big.bin', big)] }), { assets: { 'big.bin': big.toString('base64') } }), /size must be/);
    const half = Buffer.alloc(ASSET_MAX_BYTES / 2 + 1, 7);
    refuse(bundle(M({ assets: [asset('a.bin', half), asset('b.bin', half)] }), { assets: { 'a.bin': half.toString('base64'), 'b.bin': half.toString('base64') } }), /add up to more than/);
    const five = [1, 2, 3, 4, 5].map(i => Buffer.from([i]));
    refuse(bundle(M({ assets: five.map((b, i) => asset('f' + i + '.bin', b)) }), { assets: five.reduce((o, b, i) => Object.assign(o, { ['f' + i + '.bin']: b.toString('base64') }), {}) }), /at most 4 assets/);

    // a plain text bundle still installs as version 1, and may not carry the new fields
    r = host.install(JSON.stringify({ format: 'vetro-plugin', version: 1, manifest: { id: 'plain', apiVersion: 1, permissions: ['exec'] }, files: { 'index.js': CODE } }));
    assert.equal(r.plugin.state, 'stopped');
    assert.deepEqual(r.plugin.assets, []);
    assert.equal(fs.existsSync(path.join(dir, 'plain', 'assets')), false);
    host.setEnabled('plain', true);       // exec, no native: asking for an asset fails inside start(), which the host counts
    assert.equal(host.status('plain').state, 'failed');
    assert.match(host.status('plain').lastError, /no native permission/);

    // the plugin list's signature covers the whole bundle, assets included
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = publicKey.export({ type: 'spki', format: 'pem' });
    const dir2 = tmp(), signed = new PluginHost({ dir: dir2, stableMs: 10, registryKey: pem });
    signed.start();
    const text = bundle(M()), hash = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
    const sig = crypto.createSign('RSA-SHA256').update(signedText('cap', '1.0.0', hash)).sign(privateKey, 'base64');
    assert.equal(signed.install(text, hash, sig).trust, 'registry');
    const tampered = bundle(M(), { assets: { 'tool.bin': Buffer.concat([BIN.slice(0, -1), Buffer.from([9])]).toString('base64') } });
    assert.throws(() => signed.install(tampered, null, sig), /does not match its SHA-256/);   // the asset is checked before anything else

    // the packing tool: assets/ is carried as base64, declared in the manifest, and installs
    const src = path.join(path.dirname(tmp()), 'cap-src');
    fs.mkdirSync(path.join(src, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(src, 'manifest.json'), JSON.stringify({ id: 'cap', name: 'Cap', version: '2.0.0', apiVersion: 1, permissions: ['exec', 'native'] }));
    fs.writeFileSync(path.join(src, 'index.js'), CODE);
    fs.writeFileSync(path.join(src, 'assets', 'tool.bin'), BIN);
    const p = pack(src);
    assert.equal(JSON.parse(p.text).version, 2);
    assert.deepEqual(p.manifest.assets, [asset('tool.bin', BIN)]);
    assert.equal(pack(src).sha256, p.sha256, 'packing is reproducible');
    ({ dir, host } = fresh());
    assert.equal(host.install(p.text, p.sha256).plugin.version, '2.0.0');
    assert.ok(fs.readFileSync(path.join(dir, 'cap', 'assets', 'tool.bin')).equals(BIN));
    // the same folder without assets/ and without native packs as version 1
    fs.rmSync(path.join(src, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(src, 'manifest.json'), JSON.stringify({ id: 'cap', name: 'Cap', version: '2.0.1', apiVersion: 1, permissions: ['exec'] }));
    assert.equal(JSON.parse(pack(src).text).version, 1);

    console.log('plugin-assets: ok');
})().catch(e => { console.error(e); process.exit(1); });
