'use strict';
const assert = require('assert').strict;
const net = require('net');
const {TunnelServer} = require('../service/sdb-tunnel.js');
const sdb = require('../service/sdb.js');

const HEADER = 24;
function encode(command, arg0, arg1, payload) {
  const data = typeof payload === 'string'
    ? Buffer.concat([Buffer.from(payload), Buffer.from([0])])
    : (payload || Buffer.alloc(0));
  const packet = Buffer.alloc(HEADER + data.length);
  packet.write(command, 0, 'ascii');
  packet.writeUInt32LE(arg0 >>> 0, 4);
  packet.writeUInt32LE(arg1 >>> 0, 8);
  packet.writeUInt32LE(data.length, 12);
  let sum = 0;
  for (const byte of data) sum = (sum + byte) & 0xffffffff;
  packet.writeUInt32LE(sum, 16);
  packet.writeUInt32LE((Buffer.from(command).readUInt32LE(0) ^ 0xffffffff) >>> 0, 20);
  if (data.length) data.copy(packet, HEADER);
  return packet;
}

// Minimal sdbd: one CNXN, OPEN -> OKAY, WRTE -> OKAY + echoed WRTE, CLSE -> CLSE.
function fakeSdbd(state) {
  return net.createServer((socket) => {
    state.connections++;
    // Mirror the Q80A: sdbd accepts exactly one host connection and closes any
    // second one before CNXN. The tunnel must never open a second upstream.
    if (state.connections > 1) { socket.destroy(); return; }
    let buffer = Buffer.alloc(0);
    let nextRemote = 1000;
    const streams = new Map();
    const send = (command, arg0, arg1, payload) => socket.write(encode(command, arg0, arg1, payload));

    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      let offset = 0;
      while (buffer.length - offset >= HEADER) {
        const command = buffer.toString('ascii', offset, offset + 4);
        const length = buffer.readUInt32LE(offset + 12);
        if (buffer.length - offset < HEADER + length) break;
        const arg0 = buffer.readUInt32LE(offset + 4);
        const arg1 = buffer.readUInt32LE(offset + 8);
        const payload = buffer.slice(offset + HEADER, offset + HEADER + length);
        offset += HEADER + length;
        if (command === 'CNXN') send('CNXN', 0x01000000, 4096, null);
        else if (command === 'OPEN') {
          const remoteId = nextRemote++;
          streams.set(arg0, remoteId);
          state.services.push(payload.toString('ascii').replace(/\0$/, ''));
          send('OKAY', remoteId, arg0, null);
        } else if (command === 'WRTE') {
          const remoteId = streams.get(arg0);
          if (remoteId === undefined) continue;
          const text = payload.toString('ascii').replace(/\0$/, '');
          send('OKAY', remoteId, arg0, null);
          send('WRTE', remoteId, arg0, 'echo:' + text);
        } else if (command === 'CLSE') {
          const remoteId = streams.get(arg0);
          streams.delete(arg0);
          state.closedStreams++;
          send('CLSE', remoteId === undefined ? 0 : remoteId, arg0, null);
        }
      }
      buffer = buffer.slice(offset);
    });
  });
}

function listen(server) {
  return new Promise((resolve, reject) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)).on('error', reject));
}
function startTunnel(sdbPort, extra) {
  return new Promise((resolve, reject) => {
    const options = Object.assign({port: 0, bindHost: '127.0.0.1', sdbHost: '127.0.0.1', sdbPort}, extra);
    const tunnel = new TunnelServer(options);
    tunnel.start((err, port) => err ? reject(err) : resolve({tunnel, port}));
  });
}
function echo(client, text) {
  return new Promise((resolve, reject) => {
    const stream = client.createStream('shell');
    let output = '';
    const timer = setTimeout(() => reject(new Error('timeout waiting for echo:' + text)), 3000);
    stream.on('data', (chunk) => {
      output += chunk.toString();
      if (output.includes('echo:' + text)) {
        clearTimeout(timer);
        resolve(stream);
      }
    });
    stream.on('error', (e) => { clearTimeout(timer); reject(e); });
    stream.write(text);
  });
}

async function main() {
  let failures = 0;
  async function check(name, fn) {
    try { await fn(); console.log('PASS ' + name); }
    catch (e) { failures++; console.error('FAIL ' + name + ': ' + e.message); }
  }

  await check('serves one client through a single CNXN upstream', async () => {
    const state = {connections: 0, services: [], closedStreams: 0};
    const fake = fakeSdbd(state);
    const sdbPort = await listen(fake);
    const {tunnel, port} = await startTunnel(sdbPort);

    const client = await sdb.connect({host: '127.0.0.1', port, timeout: 2000});
    const stream = await echo(client, 'one');
    assert.deepEqual(state.services, ['shell']);
    assert.equal(state.connections, 1);

    sdb.close(client);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(state.closedStreams >= 1 || stream.destroyed);
    tunnel.close(); fake.close();
  });

  await check('multiplexes two simultaneous clients over one upstream sdbd connection', async () => {
    const state = {connections: 0, services: [], closedStreams: 0};
    const fake = fakeSdbd(state);
    const sdbPort = await listen(fake);
    const {tunnel, port} = await startTunnel(sdbPort);

    const clients = [];
    try {
      for (let i = 0; i < 2; i++) clients.push(await sdb.connect({host: '127.0.0.1', port, timeout: 2000}));
      const [a, b] = await Promise.all([echo(clients[0], 'alpha'), echo(clients[1], 'beta')]);
      assert.ok(a && b);
      // The whole point: two clients, one TCP connection to sdbd.
      assert.equal(state.connections, 1);
      assert.equal(state.services.length, 2);
    } finally {
      clients.forEach(sdb.close);
      tunnel.close(); fake.close();
    }
  });

  await check('close() destroys active relay sessions instead of waiting for them', async () => {
    const state = {connections: 0, services: [], closedStreams: 0};
    const fake = fakeSdbd(state);
    const sdbPort = await listen(fake);
    const {tunnel, port} = await startTunnel(sdbPort);

    const client = await sdb.connect({host: '127.0.0.1', port, timeout: 2000});
    const socket = client._socket;
    const closed = new Promise((resolve) => socket.once('close', resolve));
    tunnel.close();
    await closed;
    assert.equal(socket.destroyed, true);
    tunnel.close();
    fake.close();
  });

  await check('rejects an out-of-range listening port before listen()', async () => {
    await assert.rejects(startTunnel(26101, {port: 70000}), /invalid tunnel port/);
  });

  process.exitCode = failures ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });