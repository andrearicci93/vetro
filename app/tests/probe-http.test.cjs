'use strict';
const assert = require('assert').strict;
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
process.env.VETRO_AUTH_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-probe-http-')), 'auth.json');
const service = require('./service-harness.cjs')(path.resolve(__dirname, '..'));
const server = http.createServer(service.router);
function request(method, endpoint, origin, data) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : '';
    const req = http.request({host: '127.0.0.1', port: server.address().port,
      method, path: endpoint, headers: {Origin: origin, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)}}, res => {
      let text = ''; res.on('data', c => {text += c;});
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, text}));
    });
    req.on('error', reject); req.end(body);
  });
}
server.listen(0, '127.0.0.1', async () => {
  try {
    const preflight = await request('OPTIONS', '/probe', 'null');
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], 'null');
    assert.equal(preflight.headers['access-control-allow-headers'], 'Content-Type');
    const sent = await request('POST', '/probe', 'null', {probe: {tizenObject: {ok: true, value: true}}, apps: []});
    assert.equal(JSON.parse(sent.text).ok, true);
    const received = await request('GET', '/probe', 'null');
    assert.equal(JSON.parse(received.text).probe.tizenObject.value, true);
    const external = await request('GET', '/probe', 'https://example.com');
    assert.equal(external.headers['access-control-allow-origin'], undefined);
    const inventory = {apps: Array.from({length: 700}, (_, i) => ({id: 'app' + i, name: 'x'.repeat(100)}))};
    assert.ok(Buffer.byteLength(JSON.stringify(inventory)) > 65536);
    const large = await request('POST', '/probe', 'null', inventory);
    assert.equal(large.status, 200);
    assert.equal(JSON.parse((await request('GET', '/probe', 'null')).text).apps.length, 700);
    const tooLarge = await request('POST', '/probe', 'null', {padding: 'x'.repeat(262144)});
    assert.equal(tooLarge.status, 413);
    // Only the TV's own widget may replace the stored probe; a LAN client is refused.
    const remote = await new Promise(resolve => {
      const res = {headers: {}, setHeader() {}, writeHead(code) {res.code = code;}, end(text) {resolve({code: res.code, text});}};
      service.router({method: 'POST', url: '/probe', headers: {}, socket: {remoteAddress: '192.0.2.5'}, on() {}}, res);
    });
    assert.equal(remote.code, 403);
    assert.equal(JSON.parse((await request('GET', '/probe', 'null')).text).apps.length, 700);
    // A TV that blocks loopback (#122) posts from its own LAN address: accepted, while another device on the LAN is not.
    const auth = require('../service/auth.js');
    auth._ownAddresses(() => ({eth0: [{family: 'IPv4', internal: false, address: '192.0.2.10'}]}));
    const post = address => new Promise(resolve => {
      const res = {headers: {}, setHeader() {}, writeHead(code) {res.code = code;}, end(text) {resolve({code: res.code, text});}};
      const req = {method: 'POST', url: '/probe', headers: {origin: 'null'}, socket: {remoteAddress: address},
        on(name, fn) { if (name === 'data') process.nextTick(() => fn(Buffer.from(JSON.stringify({probe: {fromLan: true}, apps: []})))); if (name === 'end') process.nextTick(fn); }};
      service.router(req, res);
    });
    // Pairing off (the default): the TV page (opaque Origin) is accepted from any address, as in 0.3.5.
    assert.equal((await post('192.0.2.11')).code, 200);
    // Pairing on: only the TV itself (loopback, any 127.x, or its own address).
    auth.setPairingEnabled(true);
    assert.equal((await post('192.0.2.11')).code, 403);
    assert.equal((await post('127.0.0.2')).code, 200);
    assert.equal((await post('192.0.2.10')).code, 200);
    assert.equal(JSON.parse((await request('GET', '/probe', 'null')).text).probe.fromLan, true);
    auth._ownAddresses();
    console.log('PASS widget probe HTTP: preflight, report round trip, opaque origin only, writes from the TV only (loopback or its own address)');
  } catch (e) {console.error(e); process.exitCode = 1;}
  finally {server.close();}
});
