'use strict';
// The update endpoints: status is readable, the package carries the release public key, and a bundle that is not
// signed with it is refused (the missing-key refusal itself is covered in updater.test.cjs).
const assert = require('assert').strict;
const EventEmitter = require('events');
const service = require('./service-harness.cjs')(require('path').resolve(__dirname, '..'));
service.context.platform = {start: () => {}, status: () => ({agent: {connected: false}}), execute: () => Promise.reject(new Error('offline'))};
function call(method, url, body) {
  return new Promise(resolve => {
    const req = new EventEmitter(); req.method = method; req.url = url; req.headers = {};
    let status; const res = {setHeader() {}, writeHead: n => {status = n;}, end: text => resolve({status, body: JSON.parse(text)})};
    service.router(req, res);
    if (method === 'POST') { req.emit('data', Buffer.from(body || '')); req.emit('end'); }
  });
}
(async () => {
  const s = await call('GET', '/update');
  assert.equal(s.status, 200); assert.equal(s.body.configured, true); assert.equal(s.body.shell, 1);
  assert.match(s.body.source, /^https:\/\/raw\.githubusercontent\.com\/.*\/$/);
  const refused = await call('POST', '/update/apply', '{"format":"vetro-update"}');
  assert.equal(refused.status, 400); assert.equal(refused.body.ok, false); assert.notEqual(refused.body.code, 'no-key');
  assert.equal((await call('POST', '/update/check', '{}')).status, 400);
  assert.equal((await call('POST', '/update/rollback')).status, 409);
  // No published update list (GitHub 404) reads as such, not as a GitHub failure.
  assert.match(require('fs').readFileSync(require('path').join(__dirname, '../service/dashboard.js'), 'utf8'), /r\.status===404&&kind==='update list'\?'No update has been published yet\.'/);
  // Windows local development and 8.3 short temp paths are accepted while relative and shell-unsafe paths are refused.
  const {Updater} = require('../service/updater.js');
  assert.ok(new Updater({installDir: 'C:\\Users\\MAURIC~1\\AppData\\Local\\Temp\\vetro', workDir: 'C:\\vetro-work'}).status());
  assert.throws(() => new Updater({installDir: 'relative/path', workDir: '/opt/work'}), /Unsafe update folders/);
  assert.throws(() => new Updater({installDir: '/opt/bad;rm', workDir: '/opt/work'}), /Unsafe update folders/);
  console.log('PASS update endpoints: status, refusal of an unsigned bundle, no rollback without a backup');
})().catch(e => { console.error(e); process.exitCode = 1; });
