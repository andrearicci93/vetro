'use strict';
const assert = require('assert').strict;
const net = require('net');
const {TunnelServer} = require('../service/sdb-tunnel.js');

function listen(server) {
  return new Promise((resolve, reject) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)).on('error', reject));
}
function startTunnel(sdbPort) {
  return new Promise((resolve, reject) => {
    const tunnel = new TunnelServer({port: 0, bindHost: '127.0.0.1', sdbHost: '127.0.0.1', sdbPort});
    tunnel.start((err, port) => err ? reject(err) : resolve({tunnel, port}));
  });
}

async function main() {
  let failures = 0;
  async function check(name, fn) {
    try { await fn(); console.log('PASS ' + name); }
    catch (e) { failures++; console.error('FAIL ' + name + ': ' + e.message); }
  }

  await check('relays bytes in both directions between client and the TV-local sdbd', async () => {
    const fakeSdbd = net.createServer((socket) => socket.on('data', (d) => socket.write(Buffer.from('echo:' + d))));
    const sdbPort = await listen(fakeSdbd);
    const {tunnel, port} = await startTunnel(sdbPort);

    const client = net.connect(port, '127.0.0.1');
    const reply = await new Promise((resolve) => {
      client.once('data', (d) => resolve(d.toString()));
      client.on('connect', () => client.write('CNXN'));
    });

    assert.equal(reply, 'echo:CNXN');
    client.destroy(); tunnel.close(); fakeSdbd.close();
  });

  await check('closing the client tears down its upstream sdbd connection', async () => {
    let upstreamClosed;
    const closedPromise = new Promise((resolve) => { upstreamClosed = resolve; });
    const fakeSdbd = net.createServer((socket) => socket.on('close', upstreamClosed));
    const sdbPort = await listen(fakeSdbd);
    const {tunnel, port} = await startTunnel(sdbPort);

    const client = net.connect(port, '127.0.0.1');
    await new Promise((resolve) => client.on('connect', resolve));
    client.destroy();

    await closedPromise;
    tunnel.close(); fakeSdbd.close();
  });

  process.exitCode = failures ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
