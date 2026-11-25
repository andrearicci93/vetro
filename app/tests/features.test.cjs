const assert = require('assert').strict;
const net = require('net');
const apps = require('../service/apps.js');
const remap = require('../service/remap.js');
const settings = require('../service/settings.js');
const probe = require('../service/probe.js');
const sr = require('../service/samsung-remote.js');

// apps: classification, protection, bad ids dropped
const rows = apps.normalize(
  [{id: 'com.samsung.tv.acr-service-app', packageId: 'com.samsung.tv.acr-service-app'},
   {id: 'com.samsung.tv.coba.adagent', packageId: 'com.samsung.tv.coba.adagent'},
   {id: 'netflix.app', packageId: 'netflix', name: 'Netflix'}, {id: 'bad id;rm'}, null],
  [{id: 'netflix', version: '1.2', totalSize: 100}]);
assert.equal(rows.length, 3);
assert.equal(rows.find(r => r.appId === 'netflix.app').version, '1.2');
assert.equal(rows.find(r => r.appId === 'com.samsung.tv.acr-service-app').kind, 'ads');
const hub = rows.find(r => r.appId === 'com.samsung.tv.coba.adagent');
assert.equal(hub.protected, true); assert.equal(hub.kind, 'other');
assert.deepEqual(apps.summarize(rows), {total: 3, ads: 1, privacy: 0, other: 2, protected: 1});
assert.ok(apps.blocklist('hosts').startsWith('0.0.0.0 '));
assert.equal(apps.blocklist('xml'), null);

// remap: validation and resolution
const rules = remap.validateRules([{id: 'r1', trigger: {type: 'http', value: 'cinema'},
  actions: [{type: 'key', key: 'KEY_HOME'}, {type: 'launch', appId: 'org.tizen.x'}]}]);
assert.equal(remap.resolve(rules, 'http', 'cinema').length, 2);
assert.equal(remap.resolve(rules, 'http', 'other').length, 0);
// The Remapper's "Turn off screen": an action with no arguments, whatever else is sent along is dropped.
const off = remap.validateRules([{id: 'physical_116', trigger: {type: 'physical', value: '116'}, actions: [{type: 'screenoff', command: 'rm -rf /', state: 'standby'}]}]);
assert.deepEqual(off[0].actions, [{type: 'screenoff'}]);
assert.deepEqual(remap.resolve(off, 'physical', '116'), [{type: 'screenoff'}]);
assert.ok(require('../service/control.js').SCREEN_OFF_COMMAND.endsWith('ChangeState s lcdoff'), 'the fixed Picture Off line, not standby');
for (const bad of [[{id: 'x', trigger: {type: 'http', value: 'a'}, actions: [{type: 'key', key: 'home; rm'}]}],
  [{id: 'x', trigger: {type: 'bogus', value: 'a'}, actions: [{type: 'key', key: 'KEY_UP'}]}],
  [{id: 'x', trigger: {type: 'key', value: 'a'}, actions: []}], 'nope'])
  assert.throws(() => remap.validateRules(bad));

// settings: whitelist only
assert.deepEqual(settings.sanitize({model: 'QE', evil: 'x', firmware: {}}), {model: 'QE'});
assert.throws(() => settings.validateWrite('model'), /read-only/);
assert.throws(() => settings.validateWrite('nope'), /unknown/);

// probe: bounded copy
assert.throws(() => probe.sanitize([]));
assert.ok(probe.sanitize({a: 'x'.repeat(2000)}).a.length <= 500);

// websocket frames round trip (server frames are unmasked)
const f = sr.encodeFrame('hi');
assert.equal(f[1] & 0x80, 0x80);
const srv = Buffer.concat([Buffer.from([0x81, 2]), Buffer.from('ok')]);
const d = sr.decodeFrames(Buffer.concat([srv, Buffer.from([0x81])]));
assert.equal(d.frames[0].data.toString(), 'ok'); assert.equal(d.rest.length, 1);

// end-to-end against a fake TV: handshake, ms.channel.connect, key frame received
const crypto = require('crypto');
const server = net.createServer(function (c) {
  let buf = Buffer.alloc(0), up = false;
  c.on('data', function (ch) {
    buf = Buffer.concat([buf, ch]);
    if (!up) {
      const t = buf.toString();
      if (!t.includes('\r\n\r\n')) return;
      const key = /Sec-WebSocket-Key: (.+)\r\n/.exec(t)[1];
      const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      c.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
      const msg = Buffer.from(JSON.stringify({event: 'ms.channel.connect', data: {token: 'T0K'}}));
      c.write(Buffer.concat([Buffer.from([0x81, msg.length]), msg]));
      up = true; buf = Buffer.alloc(0); return;
    }
    let len = buf[1] & 0x7f, off = 2;
    if (len === 126) { len = buf.readUInt16BE(2); off = 4; }
    if (buf.length < off + 4 + len) return;
    const mask = buf.slice(off, off + 4), body = Buffer.alloc(len);
    for (let i = 0; i < len; i++) body[i] = buf[off + 4 + i] ^ mask[i % 4];
    if ((buf[0] & 0x0f) === 1) server.got = body.toString();
    buf = buf.slice(off + 4 + len);
  });
});
server.listen(0, '127.0.0.1', async function () {
  try {
    const r = await sr.send({host: '127.0.0.1', port: server.address().port, timeoutMs: 3000}, [sr.keyFrame('KEY_HOME')]);
    assert.equal(r.token, 'T0K'); assert.equal(r.sent, 1);
    assert.equal(JSON.parse(server.got).params.DataOfCmd, 'KEY_HOME');
    console.log('PASS: apps, remap, settings, probe, samsung-remote');
  } catch (e) { console.error('FAIL', e); process.exitCode = 1; }
  server.close();
});
