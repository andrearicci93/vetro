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
        if (command === 'WRTE' && length > 4096) { socket.destroy(); return; }
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
          send('WRTE', remoteId, arg0, state.binary ? payload : 'echo:' + text);
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

// Real SDK file-sync writes include DATA/DONE framing beyond the advertised 4096 bytes.
// Use a wire client: the small service-side client deliberately enforces its own 4096-byte payload limit.
function binaryRoundTrip(port, payload) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let buffer = Buffer.alloc(0), sent = false, chunks = [], received = 0, acknowledgements = 0;
    const timer = setTimeout(() => finish(new Error('binary frame was dropped')), 1500);
    function finish(err, value) { clearTimeout(timer); socket.destroy(); err ? reject(err) : resolve(value); }
    socket.on('error', finish);
    socket.on('close', () => { if (!sent) finish(new Error('closed before binary transfer')); });
    socket.on('connect', () => socket.write(encode('CNXN', 0x01000000, 4096, 'host::')));
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= HEADER) {
        const length = buffer.readUInt32LE(12);
        if (buffer.length < HEADER + length) break;
        const command = buffer.toString('ascii', 0, 4), remote = buffer.readUInt32LE(4);
        const data = buffer.slice(HEADER, HEADER + length);
        buffer = buffer.slice(HEADER + length);
        if (command === 'CNXN') socket.write(encode('OPEN', 7, 0, 'sync:'));
        else if (command === 'OKAY' && !sent) {
          sent = true;
          const packet = encode('WRTE', 7, remote, payload);
          socket.write(packet.slice(0, 17));
          setImmediate(() => { if (!socket.destroyed) socket.write(packet.slice(17)); });
        } else if (command === 'OKAY') {
          acknowledgements++;
        } else if (command === 'WRTE') {
          chunks.push(Buffer.from(data)); received += data.length;
          socket.write(encode('OKAY', 7, remote, null));
          if (received === payload.length) {
            assert.equal(acknowledgements, 1, 'one ACK for the original client write');
            finish(null, Buffer.concat(chunks));
          }
        }
      }
    });
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

  await check('fragments SDK file-sync frames for a strict 4096-byte upstream', async () => {
    const state = {connections: 0, services: [], closedStreams: 0, binary: true};
    const fake = fakeSdbd(state), sdbPort = await listen(fake);
    const {tunnel, port} = await startTunnel(sdbPort);
    try {
      for (const size of [4111, 65552, 262160]) {
        const payload = Buffer.alloc(size);
        for (let i = 0; i < size; i++) payload[i] = i % 251;
        const returned = await binaryRoundTrip(port, payload);
        assert.deepEqual(returned, payload, 'binary data must survive header fragmentation and ID rewriting');
      }
      assert.equal(state.connections, 1, 'large frames reuse the same upstream');
    } finally { tunnel.close(); fake.close(); }
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

  await check('rejects unbounded frame lengths without dropping a healthy client', async () => {
    const state = {connections: 0, services: [], closedStreams: 0};
    const fake = fakeSdbd(state), sdbPort = await listen(fake);
    const {tunnel, port} = await startTunnel(sdbPort);
    const healthy = await sdb.connect({host: '127.0.0.1', port, timeout: 2000});
    try {
      (await echo(healthy, 'before-invalid')).close();
      await new Promise((resolve, reject) => {
        const bad = net.connect(port, '127.0.0.1');
        const timer = setTimeout(() => { bad.destroy(); reject(new Error('oversized header not rejected')); }, 1500);
        bad.on('error', () => {});
        bad.on('close', () => { clearTimeout(timer); resolve(); });
        bad.on('connect', () => {
          const header = encode('WRTE', 7, 0, null);
          header.writeUInt32LE(1024 * 1024 + 1, 12);
          bad.write(header);
        });
      });
      (await echo(healthy, 'after-invalid')).close();
      assert.equal(state.connections, 1);
    } finally { sdb.close(healthy); tunnel.close(); fake.close(); }
  });

  await check('rejects an out-of-range listening port before listen()', async () => {
    await assert.rejects(startTunnel(26101, {port: 70000}), /invalid tunnel port/);
  });

  process.exitCode = failures ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });