'use strict';
const assert = require('assert').strict;
const net = require('net');
const {TunnelServer} = require('../service/sdb-tunnel.js');
assert.equal(new TunnelServer().bindHost, '127.0.0.1', 'SDB must not bypass pairing through an implicit LAN listener');
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
    // Mirror the Q80A: sdbd accepts exactly one host connection at a time and
    // closes any second one before CNXN. The tunnel must never open a second
    // upstream while the first is open; once it is closed, a new one is fine.
    state.open = state.open || 0;
    if (state.open > 0) { state.refused = (state.refused || 0) + 1; socket.destroy(); return; }
    state.open++;
    socket.on('close', () => { state.open--; });
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

  await check('releases sdbd after the last client leaves and reopens on the next CNXN', async () => {
    const state = {connections: 0, services: [], closedStreams: 0};
    const fake = fakeSdbd(state), sdbPort = await listen(fake);
    const {tunnel, port} = await startTunnel(sdbPort, {idleMs: 120});
    try {
      const first = await sdb.connect({host: '127.0.0.1', port, timeout: 2000});
      await echo(first, 'one');
      assert.equal(state.open, 1, 'upstream is held while a client is connected');
      sdb.close(first);
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.equal(state.open, 1, 'the grace period keeps the upstream for a quick follow-up');
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.equal(state.open, 0, 'sdbd is free once the tunnel is idle');

      // Another app can now take sdbd directly, as TV-Store does.
      await new Promise((resolve, reject) => {
        const other = net.connect(sdbPort, '127.0.0.1');
        other.on('error', reject);
        other.on('connect', () => other.write(encode('CNXN', 0x01000000, 4096, 'host::')));
        other.on('data', () => { other.destroy(); resolve(); });
        other.on('close', () => reject(new Error('direct sdbd connection was refused')));
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(state.open, 0);

      const second = await sdb.connect({host: '127.0.0.1', port, timeout: 2000});
      await echo(second, 'two');
      assert.equal(state.open, 1, 'the next client reopens the upstream');
      assert.deepEqual(state.services, ['shell', 'shell']);
      sdb.close(second);
    } finally { tunnel.close(); fake.close(); }
  });

  await check('a client that returns inside the grace period reuses the same upstream', async () => {
    const state = {connections: 0, services: [], closedStreams: 0};
    const fake = fakeSdbd(state), sdbPort = await listen(fake);
    const {tunnel, port} = await startTunnel(sdbPort, {idleMs: 250});
    try {
      const first = await sdb.connect({host: '127.0.0.1', port, timeout: 2000});
      await echo(first, 'a');
      sdb.close(first);
      await new Promise((resolve) => setTimeout(resolve, 60));
      const second = await sdb.connect({host: '127.0.0.1', port, timeout: 2000});
      await echo(second, 'b');
      await new Promise((resolve) => setTimeout(resolve, 400));
      assert.equal(state.connections, 1, 'no reconnect to sdbd inside the grace period');
      assert.equal(state.open, 1, 'still held: a client is connected');
      sdb.close(second);
    } finally { tunnel.close(); fake.close(); }
  });

  await check('keeps sdbd while any client stays connected', async () => {
    const state = {connections: 0, services: [], closedStreams: 0};
    const fake = fakeSdbd(state), sdbPort = await listen(fake);
    const {tunnel, port} = await startTunnel(sdbPort, {idleMs: 80});
    const stay = await sdb.connect({host: '127.0.0.1', port, timeout: 2000});
    try {
      const leave = await sdb.connect({host: '127.0.0.1', port, timeout: 2000});
      await echo(leave, 'x');
      sdb.close(leave);
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(state.open, 1, 'one client is still connected');
      (await echo(stay, 'still-works')).close();
    } finally { sdb.close(stay); tunnel.close(); fake.close(); }
  });

  await check('close() cancels a pending idle release', async () => {
    const state = {connections: 0, services: [], closedStreams: 0};
    const fake = fakeSdbd(state), sdbPort = await listen(fake);
    const {tunnel, port} = await startTunnel(sdbPort, {idleMs: 80});
    try {
      const first = await sdb.connect({host: '127.0.0.1', port, timeout: 2000});
      sdb.close(first);
      tunnel.close();
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.equal(state.open, 0, 'close() leaves nothing open and no timer fires afterwards');
    } finally { tunnel.close(); fake.close(); }
  });

  await check('rejects an out-of-range listening port before listen()', async () => {
    await assert.rejects(startTunnel(26101, {port: 70000}), /invalid tunnel port/);
  });

  await check('rejects OPEN before CNXN without starting upstream', async () => {
    const state = {connections: 0, services: [], closedStreams: 0};
    const fake = fakeSdbd(state), sdbPort = await listen(fake);
    const {tunnel, port} = await startTunnel(sdbPort);
    try {
      await new Promise((resolve, reject) => {
        const bad = net.connect(port, '127.0.0.1');
        const timer = setTimeout(() => { bad.destroy(); reject(new Error('pre-CNXN OPEN not rejected')); }, 1500);
        bad.on('error', () => {});
        bad.on('close', () => { clearTimeout(timer); resolve(); });
        bad.on('connect', () => bad.write(encode('OPEN', 1, 0, 'shell')));
      });
      assert.equal(state.connections, 0, 'upstream must not open on unauthenticated OPEN');
    } finally { tunnel.close(); fake.close(); }
  });

  await check('rejects duplicate OPEN with the same client stream id', async () => {
    const state = {connections: 0, services: [], closedStreams: 0};
    const fake = fakeSdbd(state), sdbPort = await listen(fake);
    const {tunnel, port} = await startTunnel(sdbPort);
    try {
      await new Promise((resolve, reject) => {
        const sock = net.connect(port, '127.0.0.1');
        const timer = setTimeout(() => { sock.destroy(); reject(new Error('duplicate OPEN not rejected')); }, 1500);
        sock.on('error', () => {});
        sock.on('close', () => { clearTimeout(timer); resolve(); });
        sock.on('connect', () => sock.write(encode('CNXN', 0x01000000, 4096, 'host::')));
        sock.once('data', () => {
          sock.write(encode('OPEN', 42, 0, 'shell'));
          sock.write(encode('OPEN', 42, 0, 'shell'));
        });
      });
      assert.equal(tunnel._pool.streams.size, 0, 'no leaked stream entries after duplicate OPEN');
    } finally { tunnel.close(); fake.close(); }
  });

  await check('resets pool when upstream accepts TCP but never answers CNXN', async () => {
    const silent = net.createServer(() => {});
    const sdbPort = await listen(silent);
    const {tunnel, port} = await startTunnel(sdbPort, {handshakeMs: 120});
    try {
      await new Promise((resolve, reject) => {
        const sock = net.connect(port, '127.0.0.1');
        const timer = setTimeout(() => { sock.destroy(); reject(new Error('hung upstream did not time out')); }, 1500);
        sock.on('error', () => {});
        sock.on('close', () => { clearTimeout(timer); resolve(); });
        sock.on('connect', () => sock.write(encode('CNXN', 0x01000000, 4096, 'host::')));
      });
      assert.equal(tunnel._pool.socket, null, 'upstream socket cleared after handshake timeout');
    } finally { tunnel.close(); silent.close(); }
  });

  await check('tunnel: drops queued OPEN on early client close and rejects WRTE before OKAY', async () => {
    const upstreamServices = [];
    let releaseCnxn = null;
    const fake = net.createServer((socket) => {
      let buffer = Buffer.alloc(0);
      socket.on('error', () => {});
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= HEADER) {
          const cmd = buffer.toString('ascii', 0, 4);
          const len = buffer.readUInt32LE(12);
          if (buffer.length < HEADER + len) break;
          const arg0 = buffer.readUInt32LE(4);
          const payload = buffer.slice(HEADER, HEADER + len);
          buffer = buffer.slice(HEADER + len);
          if (cmd === 'CNXN') releaseCnxn = () => socket.write(encode('CNXN', 0x01000000, 4096, null));
          else if (cmd === 'OPEN') {
            const svc = payload.toString('ascii').replace(/\0$/, '');
            upstreamServices.push(svc);
            if (svc !== 'shell:premature') socket.write(encode('OKAY', 4001, arg0, null));
          }
        }
      });
    });
    const sdbPort = await listen(fake);
    const {tunnel, port} = await startTunnel(sdbPort);
    try {
      // 1. Client connects, queues OPEN while upstream CNXN is stalled, then disconnects early
      await new Promise((resolve) => {
        const c1 = net.connect(port, '127.0.0.1');
        c1.on('error', () => {});
        c1.on('connect', () => {
          c1.write(encode('CNXN', 0x01000000, 4096, 'host::'));
          c1.write(encode('OPEN', 11, 0, 'shell:early-bye'));
          setTimeout(() => { c1.destroy(); resolve(); }, 30);
        });
      });
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.ok(releaseCnxn, 'upstream handshake initiated');
      releaseCnxn();
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.deepEqual(upstreamServices, [], 'queued OPEN of disconnected client must not reach sdbd');

      // 2. Client sends WRTE before OKAY sets remoteId: tunnel destroys it cleanly without crashing
      await new Promise((resolve, reject) => {
        const c2 = net.connect(port, '127.0.0.1');
        c2.resume();
        const timer = setTimeout(() => { c2.destroy(); reject(new Error('WRTE before OKAY was not rejected')); }, 1500);
        c2.on('error', () => {});
        c2.on('close', () => { clearTimeout(timer); resolve(); });
        c2.on('connect', () => {
          c2.write(Buffer.concat([
            encode('CNXN', 0x01000000, 4096, 'host::'),
            encode('OPEN', 22, 0, 'shell:premature'),
            encode('WRTE', 22, 0, 'bad')
          ]));
        });
      });

      // 3. Pool.close() clears queued packets, streams, and banner state
      tunnel._pool.queued.push(Buffer.from('stale'));
      tunnel._pool.streams.set(999, {client: null, clientId: 1, remoteId: -1});
      tunnel._pool.close();
      assert.equal(tunnel._pool.queued.length, 0);
      assert.equal(tunnel._pool.streams.size, 0);
      assert.equal(tunnel._pool.banner, null);
    } finally { tunnel.close(); fake.close(); }
  });

  await check('stale upstream close after reset() does not kill a newly opened upstream', async () => {
    const state = {connections: 0, services: [], closedStreams: 0};
    const fake = fakeSdbd(state), sdbPort = await listen(fake);
    const {tunnel, port} = await startTunnel(sdbPort);
    try {
      const first = await sdb.connect({host: '127.0.0.1', port, timeout: 2000});
      await echo(first, 'before-reset');
      const oldUpstream = tunnel._pool.socket;
      // Simulate reset() right before a new client connects, while oldUpstream's close fires on next tick.
      tunnel._pool.reset();
      assert.equal(oldUpstream.destroyed, true);
      // Wait for fakeSdbd to see the old socket drop before opening the new upstream.
      await new Promise((resolve) => setTimeout(resolve, 40));
      const second = await sdb.connect({host: '127.0.0.1', port, timeout: 2000});
      // Synthesize a late close/error event from the superseded upstream socket.
      oldUpstream.emit('error', new Error('late stale error'));
      oldUpstream.emit('close');
      const stream = await echo(second, 'after-stale-close');
      assert.ok(stream);
      sdb.close(second);
    } finally { tunnel.close(); fake.close(); }
  });

  await check('pipelined invalid frame destroys client without processing trailing OPEN', async () => {
    const state = {connections: 0, services: [], closedStreams: 0};
    const fake = fakeSdbd(state), sdbPort = await listen(fake);
    const {tunnel, port} = await startTunnel(sdbPort);
    try {
      await new Promise((resolve, reject) => {
        const sock = net.connect(port, '127.0.0.1');
        const timer = setTimeout(() => { sock.destroy(); reject(new Error('pipelined invalid frame not closed')); }, 1500);
        sock.on('error', () => {});
        sock.on('close', () => { clearTimeout(timer); resolve(); });
        sock.on('connect', () => {
          // Pre-CNXN WRTE (invalid -> destroys client) pipelined with CNXN + OPEN in the same write.
          sock.write(Buffer.concat([
            encode('WRTE', 1, 2, 'bad'),
            encode('CNXN', 0x01000000, 4096, 'host::'),
            encode('OPEN', 3, 0, 'shell:should-not-run')
          ]));
        });
      });
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.deepEqual(state.services, [], 'trailing pipelined OPEN after destroy must never run');
    } finally { tunnel.close(); fake.close(); }
  });

  process.exitCode = failures ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });