'use strict';
// Fixture identity is deliberately simulated. This does not attest hardware root.
const assert = require('assert').strict;
const net = require('net');
const crypto = require('crypto');
const {once} = require('events');
const agent = require('../service/node-root-agent.js');
const {RootAgentServer} = require('../service/root-agent.js');
const ROOT_FIXTURE = {pid: 123, uid: 0, euid: 0, gid: 0, egid: 0, cap_eff: '0', smack: 'fixture'};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function channel() {
    const secret = crypto.randomBytes(32);
    let resolveConnected;
    const connected = new Promise(resolve => { resolveConnected = resolve; });
    const server = new RootAgentServer({secret: Buffer.from(secret), onConnect: resolveConnected});
    const port = await new Promise(resolve => server.start(resolve));
    const socket = net.connect(port, '127.0.0.1');
    const peer = agent.session(socket, secret, ROOT_FIXTURE);
    await connected;
    return {server, socket, peer, close() { peer.close(); server.close(); }};
}

async function main() {
    assert.throws(() => agent.session({}, Buffer.alloc(32), {...ROOT_FIXTURE, uid: 901}), /UID\/GID/);
    const c = await channel();
    try {
        const ok = await c.server.execute('printf verified; printf warning >&2; exit 7', 1000);
        assert.deepEqual(ok, {exit_code: 7, timed_out: false, stdout: 'verified', stderr: 'warning'});
        const timed = await c.server.execute('sleep 10', 40);
        assert.equal(timed.timed_out, true);
        assert.equal(timed.exit_code, 124);
        const after = await c.server.execute('printf after-timeout', 1000);
        assert.equal(after.stdout, 'after-timeout');
        const overflow = await c.server.execute('yes a', 3000);
        assert.equal(overflow.exit_code, 125);
        assert.ok(Buffer.byteLength(overflow.stdout) <= 1024 * 1024);
        assert.match(overflow.stderr, /limit exceeded/);
        const pending = c.server.execute('sleep 10', 5000);
        c.peer.close();
        await assert.rejects(pending, /disconnected/);
    } finally { c.close(); }

    // Invalid authenticated commands must never run; a socket closes immediately.
    for (const kind of ['bad-mac', 'replayed-sequence', 'oversized-frame']) {
        const secret = crypto.randomBytes(32), nonce = crypto.randomBytes(32);
        const listener = net.createServer();
        listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
        const accepted = once(listener, 'connection');
        const socket = net.connect(listener.address().port, '127.0.0.1');
        const peer = agent.session(socket, Buffer.from(secret), ROOT_FIXTURE);
        const [remote] = await accepted;
        remote.setEncoding('utf8');
        remote.write('SAMSUNG-TV-ROOT/1\t' + nonce.toString('hex') + '\n');
        await once(remote, 'data');
        const closed = once(remote, 'close');
        function frame(payload) {
            return payload + '\t' + crypto.createHmac('sha256', secret).update(nonce).update('\x00').update(payload).digest('hex') + '\n';
        }
        if (kind === 'bad-mac') remote.write('PING\t1\t' + '0'.repeat(64) + '\n');
        if (kind === 'replayed-sequence') remote.write(frame('PING\t1') + frame('PING\t1'));
        if (kind === 'oversized-frame') remote.write('a'.repeat(128 * 1024 + 1));
        await Promise.race([closed, delay(2000).then(() => { throw Error(kind + ' was not rejected'); })]);
        peer.close(); remote.destroy(); listener.close();
    }
    console.log('PASS Node agent: simulated root, protocol interop, output/timeout bounds, disconnect, MAC/replay/frame rejection');
}
const watchdog = setTimeout(() => { console.error('Agent test did not complete'); process.exit(1); }, 10000);
main().then(() => clearTimeout(watchdog)).catch(error => { console.error(error); process.exit(1); });
