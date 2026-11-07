'use strict';
// Host fixture only: no TV, root process or network listener is started.
const assert = require('assert').strict;
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(process.argv[2] || path.join(__dirname, '../../..'));
const c = require(path.join(root, 'rooting/tests/provider-harness.cjs'))(path.join(root, 'rooting')).context;
const writes = [], dirs = [], modes = [];
c.EXTERNAL_AGENT = true;
c.crypto = {randomBytes: n => Buffer.alloc(n, 7)}; // No RSA generation on this fixture.
c.secretB64 = Buffer.alloc(32, 9).toString('base64');
c.fs = {
    mkdirSync: (p, mode) => dirs.push([p, mode]),
    writeFileSync: (p, text, options) => writes.push([p, JSON.parse(text), options.mode]),
    chmodSync: (p, mode) => modes.push([p, mode])
};
c.prepare(4321, '3.0');
assert.equal(c.state.prepared, true);
assert.equal(c.state.rootMethod, 'manual-external-agent');
assert.equal(dirs.length, 1);
assert.equal(dirs[0][1], 0o700);
assert.match(dirs[0][0], /\/vetro-external-[a-f0-9]{24}$/);
assert.equal(writes[0][0], dirs[0][0] + '/agent.json');
assert.equal(writes[0][1].port, 4321);
assert.equal(writes[0][1].token, c.secretB64);
assert.equal(writes[0][2], 0o600);
assert.equal(modes[0][1], 0o600);
c.prepare(4322, '3.0');
assert.equal(dirs.length, 1, 'one private directory per service lifetime');
assert.equal(writes[1][1].port, 4322, 'current loopback listener port is rewritten');
let tunnelReady = 0;
c.startTunnel(() => tunnelReady++);
assert.equal(tunnelReady, 1, 'external mode skips the unused SDB tunnel');
let connects = 0, retries = 0;
c.state.running = true;
c.agentConnected = false;
c.sdb = {connect: () => { connects++; throw Error('must not connect'); }};
c.scheduleRelaunch = () => retries++;
c.relaunch();
assert.equal(connects, 0, 'external mode never launches archive-root');
assert.equal(retries, 1, 'the external worker may reconnect later');

const saved = crypto.timingSafeEqual;
try {
    crypto.timingSafeEqual = undefined;
    const Server = require(path.join(root, 'rooting/service/root-agent.js')).RootAgentServer;
    const secret = Buffer.alloc(32, 3), nonce = Buffer.alloc(32, 5);
    const server = new Server({secret});
    const payload = 'PING\t1';
    const mac = crypto.createHmac('sha256', secret).update(nonce).update('\x00').update(payload, 'utf8').digest('hex');
    assert.equal(server._verify(payload + '\t' + mac, nonce), payload);
    const wrong = (mac[0] === '0' ? '1' : '0') + mac.slice(1);
    assert.throws(() => server._verify(payload + '\t' + wrong, nonce), /auth failed/);
    assert.throws(() => server._verify(payload + '\tnot-hex', nonce), /invalid authenticator/);
} finally { crypto.timingSafeEqual = saved; }
console.log('PASS external-agent configuration, no archive launch, and Node 4 MAC fallback');
