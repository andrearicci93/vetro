'use strict';
// Self-update: signature and manifest checks, port kept, nothing outside the allowed paths, and the generated root
// script run for real (sh) against a fake install folder: replace, confirm, watchdog rollback, manual rollback.
const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const { Updater, verifyBundle, compare, okPath } = require('../service/updater.js');

const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' });
const otherKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const info = obj => "'use strict';\nmodule.exports = " + JSON.stringify(obj) + ';\n';

function bundle(version, files, opts) {
    opts = opts || {};
    const manifest = { format: 'vetro-update', v: 1, version, shell: opts.shell || 1, files: {} }, body = {};
    Object.keys(files).forEach(n => { const b = Buffer.from(files[n]); manifest.files[n] = { sha256: sha(b), size: b.length }; body[n] = b.toString('base64'); });
    const text = JSON.stringify(manifest);
    const signature = crypto.sign('RSA-SHA256', Buffer.from(text), (opts.key || keys).privateKey).toString('base64');
    return JSON.stringify({ format: 'vetro-update', v: 1, manifest: text, signature, files: body });
}

// 1. paths and versions
assert.ok(okPath('service/main.js') && okPath('native/dock/tvlauncher-dotnet.dll') && okPath('index.html') && okPath('payload/SamsungTvRootAgent.dll'));
['config.xml', 'author-signature.xml', '../x', 'service/../x.js', 'service/sub/x.js', '/etc/passwd', 'native/../x', 'service/a b.js', 'native//x', 'native/x/'].forEach(n => assert.ok(!okPath(n), 'refused: ' + n));
assert.equal(compare('0.4.1', '0.4.0'), 1); assert.equal(compare('0.4.0', '0.4.0'), 0); assert.equal(compare('0.10.0', '0.9.9'), 1); assert.equal(compare('x', '0.1.0'), null);

// 2. verification
const good = bundle('0.4.1', { 'service/a.js': 'a', 'index.html': 'x 8099 y' });
assert.equal(verifyBundle(good, publicPem).manifest.version, '0.4.1');
assert.throws(() => verifyBundle(good, null), /no update signing key/);
assert.throws(() => verifyBundle(bundle('0.4.1', { 'service/a.js': 'a' }, { key: otherKeys }), publicPem), /not signed by the Vetro release key/);
const tampered = JSON.parse(good); tampered.files['service/a.js'] = Buffer.from('evil').toString('base64');
assert.throws(() => verifyBundle(JSON.stringify(tampered), publicPem), /does not match the signed manifest/);
const extra = JSON.parse(good); extra.files['service/b.js'] = Buffer.from('b').toString('base64');
assert.throws(() => verifyBundle(JSON.stringify(extra), publicPem), /not listed/);
const edited = JSON.parse(good); edited.manifest = edited.manifest.replace('0.4.1', '9.9.9');
assert.throws(() => verifyBundle(JSON.stringify(edited), publicPem), /not signed/);
assert.throws(() => verifyBundle(bundle('0.4.1', { 'config.xml': '<widget/>' }), publicPem), /Path not allowed/);
assert.throws(() => verifyBundle(bundle('0.4.1', { '../evil.js': 'x' }), publicPem), /Path not allowed|Invalid manifest/);
assert.throws(() => verifyBundle('{', publicPem), /invalid JSON/);

// 3. applying, with the generated script run by a real shell
function fixture(version, extraInfo) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-upd-'));
    const install = path.join(root, 'wgt'), work = path.join(root, 'work'), bin = path.join(root, 'bin');
    fs.mkdirSync(path.join(install, 'service'), { recursive: true }); fs.mkdirSync(work); fs.mkdirSync(bin);
    fs.writeFileSync(path.join(install, 'service', 'a.js'), 'old a');
    fs.writeFileSync(path.join(install, 'index.html'), "var BASE = 'http://127.0.0.1:9123';");
    // macOS has no sha256sum
    fs.writeFileSync(path.join(bin, 'sha256sum'), '#!/bin/sh\nif command -v shasum >/dev/null 2>&1; then exec shasum -a 256 "$@"; fi\nexec /usr/bin/sha256sum "$@"\n', { mode: 0o755 });
    // macOS has no setsid either
    fs.writeFileSync(path.join(bin, 'setsid'), '#!/bin/sh\nif command -v /usr/bin/setsid >/dev/null 2>&1; then exec /usr/bin/setsid "$@"; fi\nexec "$@"\n', { mode: 0o755 });
    const buildInfo = Object.assign({ version, shell: 1 }, extraInfo);
    const ran = [];
    const u = new Updater({ publicKey: publicPem, installDir: install, workDir: work, buildInfo, waitSeconds: 2,
        restartCommand: 'echo restarted >> ' + path.join(root, 'restarts'), dockStopCommand: 'echo dock-stopped >> ' + path.join(root, 'dockstops'),
        execute: script => new Promise(resolve => {
            ran.push(script);
            const r = cp.spawnSync('sh', ['-c', script], { env: Object.assign({}, process.env, { PATH: bin + ':' + process.env.PATH }), encoding: 'utf8' });
            resolve({ exit_code: r.status, stdout: r.stdout, stderr: r.stderr, timed_out: false });
        }) });
    return { root, install, work, u, ran, read: n => fs.readFileSync(path.join(install, n), 'utf8') };
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    // not newer, same version, needs reinstall, unknown key
    let f = fixture('0.4.0', { port: 9123 });
    await assert.rejects(f.u.apply(bundle('0.4.0', { 'service/a.js': 'x' })), /not newer/);
    await assert.rejects(f.u.apply(bundle('0.3.0', { 'service/a.js': 'x' })), /not newer/);
    await assert.rejects(f.u.apply(bundle('0.5.0', { 'service/a.js': 'x' }, { shell: 2 })), /Apps2Samsung/);
    await assert.rejects(f.u.apply(bundle('0.5.0', { 'service/a.js': 'x' }), 'f'.repeat(64)), /SHA-256/);
    assert.equal(f.ran.length, 0, 'nothing runs when a check fails');
    assert.equal(f.u.check(bundle('0.4.1', { 'service/a.js': 'new a' })).changed, 1);

    // success: files replaced, a new file added, the port kept, old files backed up, watchdog stays quiet after confirm
    const next = bundle('0.4.1', { 'service/a.js': 'new a', 'service/b.js': 'new b', 'index.html': "var BASE = 'http://127.0.0.1:8099';", 'service/build-info.js': info({ version: '0.4.1', shell: 1 }) });
    const res = await f.u.apply(next, sha(Buffer.from(next)));
    assert.equal(res.ok, true); assert.equal(res.changed, 3, 'index.html is unchanged once the installed port is kept');
    assert.equal(f.read('service/a.js'), 'new a'); assert.equal(f.read('service/b.js'), 'new b');
    assert.equal(f.read('index.html'), "var BASE = 'http://127.0.0.1:9123';", 'the port chosen at install time survives');
    assert.match(f.read('service/build-info.js'), /"port":9123/);
    assert.equal(fs.readFileSync(path.join(f.work, 'backup', 'service', 'a.js'), 'utf8'), 'old a');
    assert.equal(f.u.status().pending.to, '0.4.1'); assert.equal(f.u.status().canRollBack, true);
    assert.ok(!fs.readdirSync(path.join(f.install, 'service')).some(n => /\.vnew$/.test(n)), 'no temp copies left');
    // the new version starts and confirms itself; the watchdog then leaves the files alone
    const up = new Updater({ publicKey: publicPem, installDir: f.install, workDir: f.work, buildInfo: { version: '0.4.1', shell: 1 }, execute: () => Promise.reject(new Error('unused')) });
    assert.equal(up.confirm().state, 'updated');
    await wait(3500);
    assert.equal(f.read('service/a.js'), 'new a', 'confirmed update is not rolled back');
    assert.ok(!fs.existsSync(path.join(f.work, 'rolled-back')));
    assert.equal(f.u.status().last.state, 'updated'); assert.equal(f.u.status().pending, null);

    // a copy that fails half way (here "native" is a file, so native/dock/x.dll cannot be created, after index.html was
    // already replaced): the replaced files are put back at once and the apply reports the failure instead of leaving a mix
    f = fixture('0.4.0');
    fs.writeFileSync(path.join(f.install, 'native'), 'not a folder');
    await assert.rejects(f.u.apply(bundle('0.4.1', { 'index.html': 'new html', 'native/dock/x.dll': 'dll', 'service/a.js': 'new a' })), /could not be replaced/);
    assert.equal(f.read('index.html'), "var BASE = 'http://127.0.0.1:9123';", 'a half-done copy is undone');
    assert.equal(f.read('service/a.js'), 'old a');
    assert.ok(!fs.readdirSync(f.install).some(n => /\.vnew$/.test(n)), 'no temp copies left');
    assert.equal(f.u.status().pending, null, 'nothing waits for a confirmation that will never come');
    assert.equal(f.u.status().busy, false);

    // failure to confirm: the watchdog puts the old files back, removes the added one and restarts
    f = fixture('0.4.0');
    await f.u.apply(next);
    await wait(4500);
    assert.equal(f.read('service/a.js'), 'old a', 'rolled back');
    assert.ok(!fs.existsSync(path.join(f.install, 'service', 'b.js')), 'added file removed again');
    assert.ok(fs.existsSync(path.join(f.work, 'rolled-back')));
    assert.ok(fs.readFileSync(path.join(f.root, 'restarts'), 'utf8').split('\n').filter(Boolean).length >= 1);
    // the old version, started again, reports it
    const old = new Updater({ publicKey: publicPem, installDir: f.install, workDir: f.work, buildInfo: { version: '0.4.0', shell: 1 }, execute: () => Promise.reject(new Error('unused')) });
    assert.equal(old.confirm().state, 'rolled-back');

    // nothing is written to disk and run as a file (the TV's UEP refuses unsigned script files)
    assert.ok(f.ran.length === 0 || f.ran.every(sc => !/\bsh "?\$?[A-Za-z_\/]*\.sh/.test(sc) && !/cat > /.test(sc)), 'no script file is created and run');

    // staged file altered before the root script copies it: refused, nothing replaced
    f = fixture('0.4.0');
    const realExec = f.u.execute;
    f.u.execute = script => { fs.writeFileSync(path.join(f.work, 'staging', 'service', 'a.js'), 'tampered'); return realExec(script); };
    await assert.rejects(f.u.apply(bundle('0.4.1', { 'service/a.js': 'new a' })), /could not be replaced/);
    assert.equal(f.read('service/a.js'), 'old a');
    assert.equal(f.u.status().busy, false, 'a failed update can be tried again');

    // #116: a second apply while the first still waits for its confirmation is refused and changes nothing
    f = fixture('0.4.0');
    await f.u.apply(next);
    const ranBefore = f.ran.length;
    await assert.rejects(f.u.apply(bundle('0.4.2', { 'service/a.js': 'newer a' })), /still waiting for its confirmation/);
    assert.equal(f.ran.length, ranBefore, 'no second root script');
    assert.equal(f.read('service/a.js'), 'new a', 'files of the first update untouched');
    assert.equal(f.u.status().pending.to, '0.4.1');
    // the record is on disk: a fresh instance after a service restart refuses too
    const again = new Updater({ publicKey: publicPem, installDir: f.install, workDir: f.work, buildInfo: { version: '0.4.0', shell: 1 }, execute: () => Promise.reject(new Error('unused')) });
    await assert.rejects(again.apply(bundle('0.4.2', { 'service/a.js': 'newer a' })), err => err.code === 'pending');
    // a record left behind by a dead watchdog (older than the waiting time) does not block updates for ever
    const pendingFile = path.join(f.work, 'pending.json');
    const rec = JSON.parse(fs.readFileSync(pendingFile, 'utf8')); rec.at = Date.now() - 3600 * 1000; fs.writeFileSync(pendingFile, JSON.stringify(rec));
    assert.equal(again._pendingUpdate(), null);
    // and the way out stays open: manual rollback is allowed while pending
    fs.writeFileSync(pendingFile, JSON.stringify({ from: '0.4.0', to: '0.4.1', dock: false, at: Date.now() }));
    await f.u.rollback();
    assert.equal(f.read('service/a.js'), 'old a');

    // manual rollback
    f = fixture('0.4.0');
    await f.u.apply(next);
    await f.u.rollback();
    assert.equal(f.read('service/a.js'), 'old a'); assert.ok(!fs.existsSync(path.join(f.install, 'service', 'b.js')));
    await assert.rejects(fixture('0.4.0').u.rollback(), /no previous version/);

    // identical files: nothing to do, nothing run
    f = fixture('0.4.0');
    const same = await f.u.apply(bundle('0.4.1', { 'service/a.js': 'old a' }));
    assert.equal(same.changed, 0); assert.equal(f.ran.length, 0);


    // the launcher is part of the update: its files are replaced, the dock is restarted by the new version,
    // and an update whose launcher will not start is not confirmed (so the watchdog puts everything back)
    f = fixture('0.4.0');
    fs.mkdirSync(path.join(f.install, 'native', 'dock'), { recursive: true });
    fs.writeFileSync(path.join(f.install, 'native', 'dock', 'tvlauncher-dotnet.dll'), 'old dock');
    const withDock = bundle('0.4.1', { 'service/a.js': 'new a', 'native/dock/tvlauncher-dotnet.dll': 'new dock', 'native/dock/res/icons/x.png': 'png' });
    await f.u.apply(withDock);
    assert.equal(fs.readFileSync(path.join(f.install, 'native', 'dock', 'tvlauncher-dotnet.dll'), 'utf8'), 'new dock');
    assert.equal(f.u.status().pending.dock, true);
    const upDock = (restart, version) => {
        const x = new Updater({ publicKey: publicPem, installDir: f.install, workDir: f.work, buildInfo: { version: version || '0.4.1', shell: 1 }, execute: () => Promise.reject(new Error('unused')) });
        return x.finish(restart);
    };
    let calls = 0;
    assert.equal(await upDock(() => { calls++; return Promise.reject(new Error('dock will not start')); }), null, 'a launcher that will not start leaves the update unconfirmed');
    assert.equal(calls, 1); assert.ok(!fs.existsSync(path.join(f.work, 'ok-0.4.1')));
    await wait(4500);   // the watchdog (2 s here) puts the old files back and stops the dock first
    assert.equal(fs.readFileSync(path.join(f.install, 'native', 'dock', 'tvlauncher-dotnet.dll'), 'utf8'), 'old dock');
    assert.ok(!fs.existsSync(path.join(f.install, 'native', 'dock', 'res', 'icons', 'x.png')));
    assert.match(fs.readFileSync(path.join(f.root, 'dockstops'), 'utf8'), /dock-stopped/);
    // a good restart confirms and records what happened to the launcher
    f = fixture('0.4.0');
    await f.u.apply(withDock);
    const done = await upDock(() => Promise.resolve('restarted'));
    assert.equal(done.state, 'updated'); assert.equal(done.dock, 'restarted');
    assert.equal(f.u.status().last.dock, 'restarted');
    // the tuner is a native part like the launcher: a change to its files is flagged the same way, so both are restarted afterwards
    f = fixture('0.4.0');
    fs.mkdirSync(path.join(f.install, 'native', 'tuner'), { recursive: true });
    fs.writeFileSync(path.join(f.install, 'native', 'tuner', 'vetro-tuner.dll'), 'old tuner');
    await f.u.apply(bundle('0.4.1', { 'service/a.js': 'new a', 'native/tuner/vetro-tuner.dll': 'new tuner' }));
    assert.equal(f.u.status().pending.dock, true, 'a changed tuner file counts as a native change');
    assert.equal(fs.readFileSync(path.join(f.install, 'native', 'tuner', 'vetro-tuner.dll'), 'utf8'), 'new tuner');
    // an update that leaves the launcher alone never restarts it or stops it
    f = fixture('0.4.0');
    await f.u.apply(bundle('0.4.1', { 'service/a.js': 'new a' }));
    assert.equal(f.u.status().pending.dock, false);
    calls = 0;
    assert.equal((await upDock(() => { calls++; return Promise.resolve('restarted'); })).state, 'updated'); assert.equal(calls, 0);
    await wait(2500);
    assert.ok(!fs.existsSync(path.join(f.root, 'dockstops')), 'the launcher is not stopped when its files did not change');

    console.log('PASS updater: signature, manifest paths, port kept, replace + confirm, watchdog rollback, manual rollback, tampered staging refused, launcher restarted and rolled back with the update');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
