'use strict';
// The update INTO this version is applied by the updater of the published 0.7.0 (fixtures/update-from-070), and this
// version's updater then confirms it and can undo it with Go back. Both scripts run for real (sh) against a fake install:
// the files on disk (backup/, backup.json, pending.json, ok-*) must mean the same to both.
const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const V070 = require('./fixtures/update-from-070/updater.js');
const Current = require('../../app/service/updater.js');

const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' });
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const info = obj => "'use strict';\nmodule.exports = " + JSON.stringify(obj) + ';\n';
function bundle(version, files) {
    const manifest = { format: 'vetro-update', v: 1, version, shell: 1, files: {} }, body = {};
    Object.keys(files).sort().forEach(n => { const b = Buffer.from(files[n]); manifest.files[n] = { sha256: sha(b), size: b.length }; body[n] = b.toString('base64'); });
    const text = JSON.stringify(manifest);
    return JSON.stringify({ format: 'vetro-update', v: 1, manifest: text, signature: crypto.sign('RSA-SHA256', Buffer.from(text), keys.privateKey).toString('base64'), files: body });
}
const wait = ms => new Promise(r => setTimeout(r, ms));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-compat-'));
const install = path.join(root, 'wgt'), work = path.join(root, 'work'), bin = path.join(root, 'bin');
[path.join(install, 'service'), path.join(install, 'native', 'dock'), work, bin].forEach(d => fs.mkdirSync(d, { recursive: true }));
fs.writeFileSync(path.join(install, 'service', 'a.js'), 'old a');
fs.writeFileSync(path.join(install, 'native', 'dock', 'x.dll'), 'old dll');
fs.writeFileSync(path.join(install, 'index.html'), 'old html');
// macOS has neither sha256sum nor setsid
fs.writeFileSync(path.join(bin, 'sha256sum'), '#!/bin/sh\nif command -v shasum >/dev/null 2>&1; then exec shasum -a 256 "$@"; fi\nexec /usr/bin/sha256sum "$@"\n', { mode: 0o755 });
fs.writeFileSync(path.join(bin, 'setsid'), '#!/bin/sh\nif command -v /usr/bin/setsid >/dev/null 2>&1; then exec /usr/bin/setsid "$@"; fi\nexec "$@"\n', { mode: 0o755 });
const execute = script => new Promise(resolve => {
    const r = cp.spawnSync('sh', ['-c', script], { env: Object.assign({}, process.env, { PATH: bin + ':' + process.env.PATH }), encoding: 'utf8' });
    resolve({ exit_code: r.status, stdout: r.stdout, stderr: r.stderr, timed_out: false });
});
const opts = version => ({ publicKey: publicPem, installDir: install, workDir: work, buildInfo: { version, shell: 1 }, waitSeconds: 2, execute,
    restartCommand: 'echo restarted >> ' + path.join(root, 'restarts'), dockStopCommand: 'echo dock-stopped >> ' + path.join(root, 'dockstops') });
const read = n => fs.readFileSync(path.join(install, n), 'utf8');

(async () => {
    const next = bundle('0.7.1', { 'service/a.js': 'new a', 'service/b.js': 'new b', 'native/dock/x.dll': 'new dll', 'index.html': 'old html',
        'service/build-info.js': info({ version: '0.7.1', shell: 1 }) });
    // 0.7.0 applies it with its own (long) script
    const applied = await new V070.Updater(opts('0.7.0')).apply(next);
    assert.equal(applied.ok, true);
    assert.equal(read('service/a.js'), 'new a'); assert.equal(read('service/b.js'), 'new b'); assert.equal(read('native/dock/x.dll'), 'new dll');
    // this version starts and confirms itself: the 0.7.0 watchdog (2 s here) sees ok-0.7.1 and leaves the files alone
    const now = new Current.Updater(opts('0.7.1'));
    assert.equal(now.confirm().state, 'updated');
    await wait(3500);
    assert.equal(read('service/a.js'), 'new a', 'the 0.7.0 watchdog accepts the confirmation of this version');
    assert.ok(!fs.existsSync(path.join(work, 'rolled-back')));
    // Go back from this version restores what 0.7.0 saved, removes what it added, and stops the launcher first
    assert.equal(now.status().canRollBack, true);
    const back = await now.rollback();
    assert.equal(back.to, '0.7.0');
    assert.equal(read('service/a.js'), 'old a'); assert.equal(read('native/dock/x.dll'), 'old dll'); assert.equal(read('index.html'), 'old html');
    assert.ok(!fs.existsSync(path.join(install, 'service', 'b.js')), 'the file 0.7.0 added is removed');
    assert.ok(!fs.readdirSync(path.join(install, 'service')).some(n => /\.vnew$/.test(n)), 'no temp copies left');
    assert.match(fs.readFileSync(path.join(root, 'dockstops'), 'utf8'), /dock-stopped/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(work, 'result.json'), 'utf8')).state, 'rolled-back');
    await wait(3500);   // the restart that Go back starts in the background
    fs.rmSync(root, { recursive: true, force: true });
    console.log('PASS update compatibility: 0.7.0 applies this version, this version confirms it and Go back restores 0.7.0');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
