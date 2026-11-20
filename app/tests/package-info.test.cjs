'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const compat = require('../service/compat.js');
const info = require('../service/package-info.js');
function archive(xml, method) {
  const decoded = Buffer.from(xml); const data = method === 8 ? zlib.deflateRawSync(decoded) : decoded;
  const name = Buffer.from('config.xml'); const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(method, 8); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(method, 10); central.writeUInt32LE(info.crc32(decoded), 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(decoded.length, 24); central.writeUInt16LE(name.length, 28);
  const offset = local.length + name.length + data.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}
async function main() {
  const xml = '<widget xmlns:tizen="http://tizen.org/ns/widgets"><tizen:application package="testPkg123" id="testPkg123.app"/></widget>';
  for (const method of [0, 8]) assert.equal((await info.fromBuffer(archive(xml, method))).packageId, 'testPkg123');
  await assert.rejects(info.fromBuffer(Buffer.from('not a ZIP')));
  const corrupt = archive(xml, 0); corrupt[45] ^= 1;
  await assert.rejects(info.fromBuffer(corrupt), /checksum/);
  await assert.rejects(info.fromBuffer(archive(xml.replace('testPkg123', 'bad;id'), 8)), /package ID/);
  await assert.rejects(info.fromBuffer(archive(xml + '<tizen:application package="other"/>', 0)), /one Tizen/);
  await assert.rejects(info.fromBuffer(archive('<!DOCTYPE widget>' + xml, 0)), /declarations/);
  await assert.rejects(info.read('/tmp/x.wgt;reboot'), /absolute/);

  // Simulate Node 4.4.3 where zlib InflateRaw streams have no .destroy() until compat.install() runs
  let closed = 0;
  const { EventEmitter } = require('events');
  const pkgSrc = fs.readFileSync(path.resolve(__dirname, '../service/package-info.js'), 'utf8');
  for (const [mode, expected] of [['size', /config\.xml too large/], ['error', /corrupt deflate/]]) {
      function FakeInflateRaw() { EventEmitter.call(this); }
      FakeInflateRaw.prototype = Object.create(EventEmitter.prototype);
      FakeInflateRaw.prototype.constructor = FakeInflateRaw;
      FakeInflateRaw.prototype.close = function () { closed++; };
      FakeInflateRaw.prototype.end = function () {
          const s = this;
          process.nextTick(() => {
              if (mode === 'size') s.emit('data', Buffer.alloc(70000));
              else s.emit('error', new Error('corrupt deflate'));
          });
      };
      const fakeZlib = Object.assign({}, zlib, {
          InflateRaw: FakeInflateRaw,
          createInflateRaw: () => new FakeInflateRaw()
      });
      assert.equal(typeof FakeInflateRaw.prototype.destroy, 'undefined');
      compat.install({ zlib: fakeZlib });
      assert.equal(typeof FakeInflateRaw.prototype.destroy, 'function');
      const mod = { exports: {} };
      vm.runInNewContext('(function(require, module, exports){' + pkgSrc + '\n})', {
          Buffer, Error, Math, Promise
      })(id => (id === 'zlib' ? fakeZlib : require(id)), mod, mod.exports);
      await assert.rejects(mod.exports.fromBuffer(archive(xml, 8)), expected);
  }
  assert.equal(closed, 2, 'Node 4.4 compat shim closed inflate stream via close()');

  console.log('PASS WGT: stored/deflated manifests, corrupt archives, ambiguous IDs and unsafe paths');
}
main().catch(e => {console.error(e); process.exitCode = 1;});
