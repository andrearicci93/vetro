'use strict';
const assert = require('assert').strict;
const EventEmitter = require('events');
const crypto = require('crypto');
const {RootAgentServer} = require('../service/root-agent.js');
class Socket extends EventEmitter {
  constructor() { super(); this.writes = []; this.destroyed = false; }
  write(data) { this.writes.push(data); }
  destroy() { this.destroyed = true; this.emit('close'); }
}
function frame(server, socket, payload) {
  const nonce = Buffer.from(socket.writes[0].trim().split('\t')[1], 'hex');
  const mac = crypto.createHmac('sha256', server.secret).update(nonce).update('\x00').update(payload).digest('hex');
  return payload + '\t' + mac + '\n';
}
function authenticate(server, socket) {
  socket.emit('data', Buffer.from(frame(server, socket, 'AUTH\t42\t0\t0\t0\t0\t3fffffffff\tVXNlcg==')));
}
async function main() {
  let failures = 0;
  async function check(name, fn) {
    try { await fn(); console.log('PASS ' + name); }
    catch (e) { failures++; console.error('FAIL ' + name + ': ' + e.message); }
  }
  await check('disconnect rejects pending commands immediately', async () => {
    const server = new RootAgentServer(); const socket = new Socket(); server._handle(socket); authenticate(server, socket);
    const pending = server.execute('id', 1).then(() => 'resolved', () => 'rejected');
    socket.destroy();
    assert.equal(await Promise.race([pending, new Promise(r => setImmediate(() => r('still pending')))]), 'rejected');
    server.close();
  });
  await check('a second peer cannot replace an authenticated agent', async () => {
    const server = new RootAgentServer(); const first = new Socket(); const second = new Socket();
    server._handle(first); server._handle(second); authenticate(server, first); authenticate(server, second);
    assert.equal(server._conn._socket, first); assert.equal(second.destroyed, true);
    first.destroy(); second.destroy(); server.close();
  });
  await check('AUTH and RESULT in one TCP chunk are both processed', async () => {
    let pending;
    const server = new RootAgentServer({onConnect: () => { pending = server.execute('id', 1); }});
    const socket = new Socket(); server._handle(socket);
    socket.emit('data', Buffer.from(frame(server, socket, 'AUTH\t42\t0\t0\t0\t0\t3fffffffff\tVXNlcg==') + frame(server, socket, 'RESULT\t1\t0\t0\tb2s=\t')));
    const result = await Promise.race([pending, new Promise(r => setImmediate(() => r(null)))]);
    socket.destroy(); pending.catch(() => {}); server.close();
    assert.ok(result); assert.equal(result.stdout, 'ok');
  });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const sent = socket => socket.writes.slice(1).map(w => w.split('\t')).filter(f => f[0] === 'EXEC').map(f => f[1]);
  const settle = (p, ms) => Promise.race([p.then(v => ({v}), e => ({e})), wait(ms).then(() => null)]);
  await check('one command at a time: the next is sent only after the agent answers', async () => {
    const server = new RootAgentServer({graceMs: 20, lateMaxMs: 200}); const socket = new Socket(); server._handle(socket); authenticate(server, socket);
    const a = server.execute('a', 50), b = server.execute('b', 50);
    assert.deepEqual(sent(socket), ['1'], 'the second waits behind the first');
    socket.emit('data', Buffer.from(frame(server, socket, 'RESULT\t1\t0\t0\tYQ==\t')));
    assert.equal((await a).stdout, 'a');
    assert.deepEqual(sent(socket), ['1', '2']);
    socket.emit('data', Buffer.from(frame(server, socket, 'RESULT\t2\t0\t0\tYg==\t')));
    assert.equal((await b).stdout, 'b');
    socket.destroy(); server.close();
  });
  await check('a late answer does not close the channel: the caller is told, the next command runs after it', async () => {
    const server = new RootAgentServer({graceMs: 20, lateMaxMs: 500}); const socket = new Socket(); server._handle(socket); authenticate(server, socket);
    const slow = server.execute('slow', 30), next = server.execute('next', 400);
    const r = await settle(slow, 200);
    assert.ok(r && r.e && r.e.code === 'command-timeout', 'the caller of the slow command gets command-timeout');
    assert.equal(socket.destroyed, false, 'the channel stays open');
    assert.deepEqual(sent(socket), ['1'], 'nothing is sent while the agent is still busy');
    socket.emit('data', Buffer.from(frame(server, socket, 'RESULT\t1\t124\t1\t\t')));
    assert.deepEqual(sent(socket), ['1', '2'], 'the late answer frees the channel');
    socket.emit('data', Buffer.from(frame(server, socket, 'RESULT\t2\t0\t0\tbg==\t')));
    assert.equal((await next).stdout, 'n');
    assert.equal(server.channel.lateAnswers, 1);
    assert.equal(server.channel.drops.length, 0);
    socket.destroy(); server.close();
  });
  await check('a command waiting behind a late one gives up as agent-busy without closing the channel', async () => {
    const server = new RootAgentServer({graceMs: 20, lateMaxMs: 1000}); const socket = new Socket(); server._handle(socket); authenticate(server, socket);
    const slow = server.execute('slow', 30); slow.catch(() => {});
    const queued = server.execute('queued', 40);
    const r = await settle(queued, 300);
    assert.ok(r && r.e && r.e.code === 'agent-busy', 'agent-busy, got ' + JSON.stringify(r && r.e && r.e.code));
    assert.equal(socket.destroyed, false);
    assert.equal(server.channel.busyRefusals, 1);
    socket.emit('data', Buffer.from(frame(server, socket, 'RESULT\t1\t0\t0\t\t')));
    assert.deepEqual(sent(socket), ['1'], 'the command that gave up is never sent');
    socket.destroy(); server.close();
  });
  await check('an agent that never answers is dropped after the late limit, and the report says why', async () => {
    const server = new RootAgentServer({graceMs: 10, lateMaxMs: 60}); const socket = new Socket(); server._handle(socket); authenticate(server, socket);
    server.execute('stuck', 20).catch(() => {});
    const queued = server.execute('queued', 5000);
    const r = await settle(queued, 400);
    assert.equal(socket.destroyed, true, 'the channel is closed');
    assert.ok(r && r.e && r.e.code === 'no-root-agent', 'waiting commands fail as no-root-agent');
    assert.deepEqual(server.channel.drops.map(x => [x.reason, x.timeoutMs]), [['command-timeout', 20]]);
    server.close();
  });
  await check('an agent that closes by itself is recorded as closed', async () => {
    const server = new RootAgentServer(); const socket = new Socket(); server._handle(socket); authenticate(server, socket);
    socket.destroy();
    assert.deepEqual(server.channel.drops.map(x => x.reason), ['closed']);
    server.close();
  });
  await check('a malformed result closes the channel and is recorded as bad-result, not as the agent closing', async () => {
    const server = new RootAgentServer(); const socket = new Socket(); server._handle(socket); authenticate(server, socket);
    const p = server.execute('x', 1000).then(() => 'resolved', e => e.message);
    socket.emit('data', Buffer.from(frame(server, socket, 'RESULT\t1\tnope\t0\t\t')));
    assert.equal(await p, 'invalid root agent result');
    assert.deepEqual(server.channel.drops.map(x => x.reason), ['bad-result']);
    server.close();
  });
  process.exitCode = failures ? 1 : 0;
}
main().catch(e => { console.error(e); process.exitCode = 1; });
