'use strict';
// Regression guard for the Tizen 5.5 / Node 4.4 compatibility work. The TV runs
// Node 4.4, so each built-in the service relies on is removed here to recreate
// that runtime, then compat.install() has to restore working behaviour.
const assert = require('assert').strict, crypto = require('crypto'), fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const compat = require('../service/compat.js'), info = require('../service/package-info.js');
const serviceDir = path.join(__dirname, '..', 'service');

function readSource(name) { return fs.readFileSync(path.join(serviceDir, name), 'utf8'); }

function wgt(xml) {
  const name = Buffer.from('config.xml'), body = Buffer.from(xml), data = zlib.deflateRawSync(body);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(info.crc32(body), 16);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(name.length, 28);
  const offset = local.length + name.length + data.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

(async function () {
  // 1. package-info.js must stay parseable by an engine without the newer syntax.
  const packageInfo = readSource('package-info.js');
  assert.ok(!/async\s+function/.test(packageInfo), 'package-info.js uses async functions again');
  assert.ok(!/\bawait\s/.test(packageInfo), 'package-info.js uses await again');
  assert.ok(!/fs\.promises/.test(packageInfo), 'package-info.js uses fs.promises again');

  // 2. The shims must be installed before any other service module loads.
  const main = readSource('main.js');
  const installAt = main.indexOf("require('./compat.js').install()");
  const firstModule = main.indexOf("require('./mqtt-bridge.js')");
  assert.ok(installAt >= 0, 'main.js no longer installs the compatibility shims');
  assert.ok(firstModule < 0 || installAt < firstModule, 'shims must load before other service modules');

  // 3. Promise.prototype.finally — absent on Node 4.4.
  const realFinally = Promise.prototype.finally;
  delete Promise.prototype.finally;
  try {
    assert.equal(typeof Promise.prototype.finally, 'undefined', 'this Node still had finally');
    assert.throws(function () { Promise.resolve(1).finally(function () {}); }, /finally is not a function/);
    compat.install();
    assert.equal(await Promise.resolve(41).finally(function () {}), 41, 'value passes through');
    let ran = false;
    await Promise.resolve(1).finally(function () { ran = true; });
    assert.ok(ran, 'callback runs on success');
    await assert.rejects(Promise.reject(new Error('boom')).finally(function () {}), /boom/, 'rejection is preserved');
    await assert.rejects(Promise.resolve(1).finally(function () { throw new Error('late'); }), /late/, 'callback errors reject');
  } finally { Promise.prototype.finally = realFinally; }

  // 4. Buffer.alloc — absent on Node 4.4 (along with Buffer.allocUnsafe; `new Buffer(size)` is uninitialized there).
  const realAlloc = Buffer.alloc, realAllocUnsafe = Buffer.allocUnsafe;
  delete Buffer.alloc;
  try {
    assert.equal(typeof Buffer.alloc, 'undefined', 'this Node still had Buffer.alloc');
    compat.install();
    const empty = Buffer.alloc(4);
    assert.equal(empty.length, 4, 'sized');
    assert.equal(empty[0], 0, 'zero filled');
    assert.equal(Buffer.alloc(3, 7)[0], 7, 'fill honoured');
  } finally { Buffer.alloc = realAlloc; }
  // With BOTH Buffer.alloc and Buffer.allocUnsafe absent (Node 4.4.3), Buffer.alloc(size) must still zero-fill.
  {
    const fills = [];
    function FakeBuffer(n) { const b = realAlloc(n, 0xaa); const realFill = b.fill.bind(b); b.fill = function () { fills.push(Array.from(arguments)); return realFill.apply(b, arguments); }; return b; }
    FakeBuffer.byteLength = Buffer.byteLength;
    FakeBuffer.isBuffer = Buffer.isBuffer;
    FakeBuffer.from = Buffer.from;
    compat.install({ Buffer: FakeBuffer });
    const zeroed = FakeBuffer.alloc(8);
    assert.equal(zeroed.length, 8);
    assert.ok(zeroed.every(b => b === 0), 'zero-filled even without Buffer.allocUnsafe');
    assert.equal(fills.length, 1, 'filled once');
    assert.equal(FakeBuffer.alloc(4, 9)[0], 9, 'explicit fill honoured without Buffer.allocUnsafe');
  }

  // 4b. stream.Transform.prototype.destroy — absent on Node 4.4 (added in Node 8.0); zlib uses close().
  {
    let closed = 0;
    function FakeTransform() {}
    FakeTransform.prototype.close = function () { closed++; };
    compat.install({ Transform: FakeTransform });
    assert.equal(typeof FakeTransform.prototype.destroy, 'function', 'Transform.prototype.destroy shimmed');
    const t = new FakeTransform();
    t.destroy();
    assert.equal(closed, 1, 'destroy delegates to close()');
  }

  // 5. Buffer.from(string) — on Node 4.4 this is the inherited TypedArray.from.
  const realFrom = Buffer.from;
  // Node 4.4's Buffer.from is the inherited TypedArray.from, which rejects
  // strings with "this is not a typed array". Modern V8 accepts strings there,
  // so the old behaviour is reproduced explicitly.
  // On V8 4.5 it refuses arrays just the same (the check is on Buffer itself, not on the argument), which is what
  // ended the service when the MQTT client built its first packet (#77).
  Buffer.from = function (value) {
    if (typeof value === 'string' || Array.isArray(value) || ArrayBuffer.isView(value)) throw new TypeError('this is not a typed array');
    return realFrom.apply(Buffer, arguments);
  };
  try {
    assert.throws(function () { Buffer.from('abc'); }, /typed array/, 'expected the old runtime behaviour');
    compat.install();
    assert.equal(Buffer.from('abc').toString(), 'abc', 'utf8 strings');
    assert.equal(Buffer.from('e9', 'hex').length, 1, 'explicit encodings');
    assert.deepEqual(Array.from(Buffer.from([1, 2, 300])), [1, 2, 44], 'arrays work, bytes wrap as in Buffer');
    assert.ok(Buffer.isBuffer(Buffer.from([1, 2, 3])), 'an array gives a Buffer');
    assert.equal(Buffer.from(realFrom.call(Buffer, 'abc')).toString(), 'abc', 'a Buffer is copied');
    assert.equal(Buffer.from([]).length, 0);
  } finally {
    Object.defineProperty(Buffer, 'from', { value: realFrom, configurable: true, writable: true });
  }

  // 6. crypto.timingSafeEqual, Number.isInteger, Number.isSafeInteger, latin1 Buffer, fs.constants & zlib.InflateRaw — absent on Node 4.4.
  const realSafeEqual = crypto.timingSafeEqual, realIsInteger = Number.isInteger, realIsSafeInteger = Number.isSafeInteger;
  delete crypto.timingSafeEqual;
  delete Number.isInteger;
  delete Number.isSafeInteger;
  try {
    assert.equal(typeof crypto.timingSafeEqual, 'undefined', 'this Node still had timingSafeEqual');
    assert.equal(typeof Number.isInteger, 'undefined', 'this Node still had Number.isInteger');
    assert.equal(typeof Number.isSafeInteger, 'undefined', 'this Node still had Number.isSafeInteger');
    compat.install();
    assert.ok(crypto.timingSafeEqual(Buffer.from('abc'), Buffer.from('abc')), 'equal frames verify');
    assert.ok(!crypto.timingSafeEqual(Buffer.from('abc'), Buffer.from('abd')), 'a different frame is rejected');
    assert.throws(function () { crypto.timingSafeEqual(Buffer.from('ab'), Buffer.from('abc')); }, /same byte length/);
    assert.equal(Number.isInteger(3), true);
    assert.equal(Number.isInteger(-3), true);
    assert.equal(Number.isInteger(3.5), false);
    assert.equal(Number.isInteger('3'), false);
    assert.equal(Number.isSafeInteger(9007199254740991), true);
    assert.equal(Number.isSafeInteger(9007199254740992), false);
    assert.equal(Number.isSafeInteger(3.5), false);
    assert.equal(Number.isSafeInteger('3'), false);
  } finally {
    crypto.timingSafeEqual = realSafeEqual;
    Number.isInteger = realIsInteger;
    Number.isSafeInteger = realIsSafeInteger;
  }
  {
    const seen = [];
    function FakeBuf(val) { this.v = val; }
    FakeBuf.isBuffer = Buffer.isBuffer;
    FakeBuf.isEncoding = function (e) { return e !== 'latin1' && Buffer.isEncoding(e); };
    FakeBuf.alloc = Buffer.alloc; FakeBuf.from = Buffer.from;
    FakeBuf.byteLength = function (s, enc) { seen.push('len:' + enc); return Buffer.byteLength(s, enc); };
    FakeBuf.prototype.toString = function (enc) { seen.push('str:' + enc); return String(this.v); };
    const fakeFs = {};
    let inflateClosed = 0;
    function FakeInflateRaw() {}
    FakeInflateRaw.prototype.close = function () { inflateClosed++; };
    const fakeZlib = { InflateRaw: FakeInflateRaw };
    compat.install({ Buffer: FakeBuf, fs: fakeFs, zlib: fakeZlib });
    assert.equal(FakeBuf.isEncoding('latin1'), true);
    assert.equal(FakeBuf.byteLength('hi', 'latin1'), 2);
    assert.equal(new FakeBuf('hi').toString('latin1'), 'hi');
    assert.deepEqual(seen, ['len:binary', 'str:binary']);
    assert.equal(typeof fakeFs.constants.O_WRONLY, 'number');
    assert.equal(typeof fakeFs.constants.O_NONBLOCK, 'number');
    assert.equal(typeof fakeFs.constants.R_OK, 'number');
    assert.equal(typeof FakeInflateRaw.prototype.destroy, 'function');
    new FakeInflateRaw().destroy();
    assert.equal(inflateClosed, 1);
  }

  // 7. package-info read(): the callback-fs path that replaced fs.promises.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-node4-'));
  try {
    const file = path.join(directory, 'sample.wgt');
    fs.writeFileSync(file, wgt('<widget xmlns:tizen="http://tizen.org/ns/widgets"><tizen:application package="node4pkg" id="node4pkg.app"/></widget>'));
    // read() only accepts POSIX absolute paths (the TV's paths); Windows temp
    // paths are rejected by design, so the positive case runs on Linux only.
    if (process.platform !== 'win32') {
      assert.equal((await info.read(file)).packageId, 'node4pkg', 'read() parses a real file');
      assert.equal((await info.read(file)).packageId, 'node4pkg', 'read() works twice (descriptor released)');
    }
    await assert.rejects(info.read(file + ';reboot'), /absolute/, 'unsafe path rejects');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }

  console.log('PASS Node 4 compatibility: source guards, final/alloc/from/safe-equal/isInteger shims and the callback-fs WGT reader');
})().catch(function (error) { console.error(error); process.exitCode = 1; });
