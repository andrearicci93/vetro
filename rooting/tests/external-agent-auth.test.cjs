'use strict';
const assert = require('assert').strict;
const net = require('net');
const crypto = require('crypto');
const {once} = require('events');
const agent = require('../service/node-root-agent.js');
const id = {pid: 42, uid: 0, euid: 0, gid: 0, egid: 0, cap_eff: 'fixture', smack: 'fixture'};
async function scenario(kind) {
    const secret = crypto.randomBytes(32), nonce = crypto.randomBytes(32);
    const listener = net.createServer(); let calls = 0;
    listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
    const accepted = once(listener, 'connection');
    const socket = net.connect(listener.address().port, '127.0.0.1');
    const peer = agent.session(socket, Buffer.from(secret), id, (task, done) => {
        calls++; done({exit_code: 0, timed_out: false, stdout: 'fixture', stderr: ''}); return () => {};
    });
    const [remote] = await accepted;
    remote.on('error', () => {}); remote.setEncoding('utf8');
    try {
        const hello = once(remote, 'data');
        remote.write('SAMSUNG-TV-ROOT/1\t' + nonce.toString('hex') + '\n'); await hello;
        const closed = new Promise(resolve => remote.once('close', resolve));
        function frame(payload) {
            return payload + '\t' + crypto.createHmac('sha256', secret).update(nonce).update('\0').update(payload).digest('hex') + '\n';
        }
        const payload = 'EXEC\t1\t1000\t' + Buffer.from('printf fixture').toString('base64');
        if (kind === 'bad-mac') remote.write(payload + '\t' + '0'.repeat(64) + '\n');
        if (kind === 'replay') remote.write(frame(payload) + frame(payload));
        if (kind === 'oversize') remote.write('a'.repeat(128 * 1024 + 1));
        if (kind === 'nul') remote.write(frame('EXEC\t1\t1000\t' + Buffer.from('printf x\0').toString('base64')));
        if (kind === 'timeout') remote.write(frame('EXEC\t1\t120001\t' + Buffer.from('printf x').toString('base64')));
        await closed;
        assert.equal(calls, kind === 'replay' ? 1 : 0, 'untrusted/repeated command is never executed');
    } finally { peer.close(); remote.destroy(); await new Promise(resolve => listener.close(resolve)); }
}
(async () => {
    assert.throws(() => agent.session({}, Buffer.alloc(32), {...id, uid: 901}, () => {}), /UID\/GID/);
    assert.throws(() => agent.session({}, Buffer.alloc(32), id), /shell executor/);
    for (const kind of ['bad-mac','replay','oversize','nul','timeout']) await scenario(kind);
    console.log('PASS external agent: unprivileged identity, missing worker, MAC, replay, frame and command bounds');
})().catch(error => { console.error(error); process.exitCode = 1; });
