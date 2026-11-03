'use strict';
require('../../app/service/compat.js').install();
const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const {create} = require('../service/shell-executor.js');
const agent = require('../service/node-root-agent.js');
const {RootAgentServer} = require('../service/root-agent.js');
const net = require('net');
const crypto = require('crypto');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-shell-test-'));
fs.chmodSync(dir, 0o700);
// macOS has no setsid utility. This fixture provides the same syscall boundary.
const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, 'setsid'), '#!/usr/bin/python3\nimport os,sys\nos.setsid()\nos.execvp(sys.argv[1],sys.argv[1:])\n', {mode: 0o700});
const worker = cp.spawn('/bin/sh', [path.join(__dirname, '../service/shell-worker.sh'), dir],
    {detached: true, stdio: 'ignore', env: {...process.env, PATH: bin + ':' + process.env.PATH}});
const executor = create(dir, worker.pid, process.getuid());
const secret = crypto.randomBytes(32);
const id = {pid: 42, uid: 0, euid: 0, gid: 0, egid: 0, cap_eff: 'fixture', smack: 'fixture'};
let peer, server;
const watchdog = setTimeout(() => { console.error('Shell executor test timed out'); process.exit(1); }, 10000);
async function main() {
    let connected;
    const ready = new Promise(resolve => { connected = resolve; });
    server = new RootAgentServer({secret: Buffer.from(secret), onConnect: connected});
    const port = await new Promise(resolve => server.start(resolve));
    peer = agent.session(net.connect(port, '127.0.0.1'), Buffer.from(secret), id, executor);
    await ready;
    const first = await server.execute('printf shell-ok;printf warning >&2;exit 9', 2000);
    assert.deepEqual(first, {exit_code: 9, timed_out: false, stdout: 'shell-ok', stderr: 'warning'});
    const timed = await server.execute('sleep 10', 100);
    assert.equal(timed.timed_out, true);
    assert.equal(timed.exit_code, 124);
    const next = await server.execute('printf recovered', 2000);
    assert.equal(next.stdout, 'recovered');
    const large = await server.execute('yes x', 2000);
    assert.equal(large.exit_code, 125);
    assert.ok(Buffer.byteLength(large.stdout) <= 1024 * 1024);
    const pending = server.execute('sleep 10', 3000);
    await new Promise(resolve => setTimeout(resolve, 80));
    peer.close();
    await assert.rejects(pending, /disconnected/);
    console.log('PASS shell executor via authenticated agent: private files, real command, timeout/recovery, output cap and cancellation');
}
main().then(() => clearTimeout(watchdog)).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
    if (peer) peer.close();
    if (server) server.close();
    executor.close();
    try { process.kill(-worker.pid, 'SIGKILL'); } catch (_) {}
    // Give cancellation's final asynchronous write/poll a chance to settle.
    setTimeout(() => fs.rmSync(dir, {recursive: true, force: true}), 2100);
});
