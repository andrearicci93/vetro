'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const cp = require('child_process');
const {create} = require('../service/external-root-platform.js');
const agent = require('../service/node-root-agent.js');
const shell = require('../service/shell-executor.js');
// Identity is simulated; every real fixture command runs as the host user.
const id = {pid: 42, uid: 0, euid: 0, gid: 0, egid: 0, cap_eff: 'fixture', smack: 'fixture'};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test, ms = 4000) {
    const end = Date.now() + ms;
    while (!test()) { if (Date.now() > end) throw Error('Condition timed out'); await delay(15); }
}
function attach(p, resources) {
    const directory = path.dirname(p.status().bootstrapPath);
    const config = JSON.parse(fs.readFileSync(path.join(directory, 'session.json')));
    const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-external-fixture-'));
    fs.chmodSync(runtime, 0o700);
    const bin = path.join(runtime, 'bin'); fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'setsid'), '#!/usr/bin/env python3\nimport os,sys\nos.setsid()\nos.execvp(sys.argv[1],sys.argv[1:])\n', {mode: 0o700});
    const worker = cp.spawn('/bin/sh', [path.join(__dirname, '../service/shell-worker.sh'), runtime],
        {detached: true, stdio: 'ignore', env: {...process.env, PATH: bin + ':' + process.env.PATH}});
    const executor = shell.create(runtime, worker.pid, process.getuid());
    const peer = agent.session(net.connect(config.port, '127.0.0.1'), Buffer.from(config.secret, 'base64'), id, executor);
    resources.push({runtime, peer, executor});
    return peer;
}
async function main() {
    const resources = [], p = create({lifetimeMs: 30000});
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-outcome-'));
    const counter = path.join(fixture, 'count');
    try {
        await assert.rejects(p.execute('id'), e => e.submitted === false);
        await assert.rejects(p.install('x', '/tmp/x.wgt'), e => e.submitted === false);
        await assert.rejects(p.setApplicationsEnabled([], true), e => e.submitted === false);
        p.start(); p.start(); await until(() => p.status().prepared);
        const first = p.status().bootstrapPath, directory = path.dirname(first);
        assert.equal(fs.statSync(directory).mode & 0o777, 0o711);
        assert.equal(fs.statSync(path.join(directory, 'session.json')).mode & 0o777, 0o600);
        const config = JSON.parse(fs.readFileSync(path.join(directory, 'session.json')));
        assert.ok(!JSON.stringify(p.status()).includes(config.secret));
        const launch = fs.readFileSync(first, 'utf8');
        assert.equal(cp.spawnSync('/bin/sh', ['-n'], {input: launch}).status, 0);
        assert.ok(!launch.includes('/sys/fs/smackfs/'), 'default leaves SMACK unchanged');
        assert.ok(!launch.includes('mount.smb') && !launch.includes('sdb'), 'no root acquisition');
        assert.equal(p.status().rooting.backend, 'external-root');
        assert.equal(p.status().capabilities.install, false);
        const peer = attach(p, resources); await until(() => p.status().agent.connected);
        assert.equal(p.status().rooting.phase, 'connected');
        await assert.rejects(p.execute('printf x\0', 1000), e => e.submitted === false);
        await assert.rejects(p.execute('printf x', 120001), e => e.submitted === false);
        assert.deepEqual(await p.execute('printf hello;printf warning >&2;exit 7', 2000),
            {exit_code: 7, timed_out: false, stdout: 'hello', stderr: 'warning'});
        const timed = await p.execute('sleep 10', 80);
        assert.equal(timed.exit_code, 124); assert.equal(timed.timed_out, true);
        assert.equal((await p.execute('printf recovered', 1000)).stdout, 'recovered');
        const overflow = await p.execute('yes x', 3000);
        assert.equal(overflow.exit_code, 125); assert.ok(Buffer.byteLength(overflow.stdout) <= 1024 * 1024);
        const pending = p.execute("printf x >> '" + counter + "'; sleep 10", 5000);
        // Register the rejection handler before intentionally losing the channel.
        const lost = assert.rejects(pending, e => /disconnected|closed/.test(e.message) && e.submitted === null);
        await until(() => fs.existsSync(counter)); peer.close(); await lost;
        await until(() => p.status().prepared && p.status().bootstrapPath !== first);
        assert.equal(fs.existsSync(directory), false, 'old session files are removed');
        assert.notEqual(JSON.parse(fs.readFileSync(path.join(path.dirname(p.status().bootstrapPath), 'session.json'))).secret, config.secret);
        attach(p, resources); await until(() => p.status().agent.connected);
        assert.equal((await p.execute('printf new-session', 1000)).stdout, 'new-session');
        assert.equal(fs.readFileSync(counter, 'utf8'), 'x', 'uncertain mutation was not replayed');
        const final = path.dirname(p.status().bootstrapPath);
        p.stop(); p.stop(); await delay(30);
        assert.equal(p.status().running, false); assert.equal(fs.existsSync(final), false);
        p.start(); p.stop(); await delay(30); // close before listen callback
        assert.equal(p.status().prepared, false);
        const once = create({lifetimeMs: 1000});
        once.start(); await until(() => once.status().prepared);
        await until(() => !once.status().running);
        assert.equal(once.status().prepared, false);
        const renewing = create({lifetimeMs: 1000, autoRenew: true});
        try {
            renewing.start(); await until(() => renewing.status().prepared);
            const a = renewing.status().bootstrapPath;
            await until(() => renewing.status().prepared && renewing.status().bootstrapPath !== a);
            const b = renewing.status().bootstrapPath;
            await until(() => renewing.status().prepared && renewing.status().bootstrapPath !== b);
            renewing.stop(); await delay(1100);
            assert.equal(renewing.status().prepared, false);
        } finally { renewing.stop(); }
        for (const options of [{lifetimeMs: 0}, {lifetimeMs: 7200001}, {smack: 'rwxat'}]) {
            assert.throws(() => create(options));
        }
        console.log('PASS external adapter: real shell/protocol, timeout/output bounds, fresh reconnect, no replay, stop races and opt-in renewal');
    } finally {
        p.stop();
        resources.forEach(r => { r.peer.close(); r.executor.close(); });
        await delay(2100);
        resources.forEach(r => fs.rmSync(r.runtime, {recursive: true, force: true}));
        fs.rmSync(fixture, {recursive: true, force: true});
    }
}
const watchdog = setTimeout(() => { console.error('External adapter fixture timed out'); process.exit(1); }, 25000);
main().then(() => clearTimeout(watchdog)).catch(e => { console.error(e); clearTimeout(watchdog); process.exitCode = 1; });
