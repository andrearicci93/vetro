'use strict';
const assert = require('assert');
const EventEmitter = require('events');
const vd = require('../service/vddebugmenu.js');

class FakeStream extends EventEmitter {
  constructor() { super(); this.writes = []; this.closed = false; }
  write(data, cb) { this.writes.push(String(data)); if (cb) cb(); }
  close() { this.closed = true; }
}

const stream = new FakeStream();
const client = { createStream(service) {
  assert.strictEqual(service, 'shell:0 hyperuart_vddebugmenu');
  setImmediate(() => stream.emit('open'));
  return stream;
}};

const p = vd.run(client, 'id', {timeout: 2000, profile: 'generic'});
setImmediate(() => setTimeout(() => {
  assert.equal(stream.writes.length, 1);
  assert.ok(stream.writes[0].indexOf('20089999\n94\n7\n1\n') === 0);
  assert.ok(stream.writes[0].indexOf('x;echo VB') >= 0);
  assert.ok(stream.writes[0].indexOf(';id;echo VE') >= 0);
  assert.ok(stream.writes[0].indexOf(';echo VD') >= 0);
  const marker = stream.writes[0].match(/echo (VD[0-9a-f]+);#/)[1];
  stream.emit('data', Buffer.from('x;echo ' + marker + ';#\n'));
  stream.emit('data', Buffer.from(marker + '====================================\n'));
}, 20));

p.then(() => {
  assert.ok(stream.closed);
  console.log('PASS vddebugmenu generic: one-shot official sequence and prefixed marker');
}).catch(error => { console.error(error.stack); process.exit(1); });
