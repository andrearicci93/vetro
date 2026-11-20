'use strict';
const assert = require('assert').strict;
const EventEmitter = require('events');
const service = require('./service-harness.cjs')(require('path').resolve(__dirname, '..'));
const context = service.context;
let timeoutCallback;
context.setTimeout = fn => { timeoutCallback = fn; return 1; };
context.clearTimeout = () => {};
function bodyCase(events) {
  const req = new EventEmitter(); let result; let calls = 0;
  context.readBody(req, (body, error) => { calls++; result = {body, error}; });
  events(req);
  return {result, calls};
}
let failures = 0;
function check(name, fn) {
  try { fn(); console.log('PASS ' + name); }
  catch (e) { failures++; console.error('FAIL ' + name + ': ' + e.message); }
}
check('oversized body returns 413 once', () => {
  const r = bodyCase(req => { req.emit('data', Buffer.alloc(65537)); req.emit('end'); req.emit('error', new Error('late')); });
  assert.equal(r.calls, 1); assert.equal(r.result.error.statusCode, 413);
});
check('stalled body returns 408', () => {
  const r = bodyCase(() => timeoutCallback()); assert.equal(r.result.error.statusCode, 408);
});
check('aborted body settles immediately', () => {
  const r = bodyCase(req => req.emit('aborted')); assert.equal(r.result.error.statusCode, 400);
});
check('closed body settles immediately', () => {
  const r = bodyCase(req => req.emit('close')); assert.equal(r.calls, 1); assert.equal(r.result.error.statusCode, 400);
});
check('multibyte utf8 string chunk respects byte limit', () => {
  const r = bodyCase(req => req.emit('data', 'ą'.repeat(32769))); assert.equal(r.calls, 1); assert.equal(r.result.error.statusCode, 413);
});
check('fragmented valid body survives', () => {
  const r = bodyCase(req => { req.emit('data', Buffer.from('a')); req.emit('data', Buffer.from('b')); req.emit('end'); });
  assert.equal(r.calls, 1); assert.equal(r.result.body, 'ab'); assert.equal(r.result.error, undefined);
});
check('empty explicit debloat list never discovers bulk targets', () => {
  let status; let payload;
  const req = new EventEmitter(); req.method = 'POST'; req.url = '/debloat';
  const res = {writeHead: n => {status = n;}, end: data => {payload = JSON.parse(data);}};
  service.router(req, res); req.emit('data', Buffer.from('{"action":"disable","appIds":[]}')); req.emit('end');
  assert.equal(status, 200); assert.equal(payload.changed, 0);
});
process.exitCode = failures ? 1 : 0;
