'use strict';
const assert = require('assert').strict;
const path = require('path');
const EventEmitter = require('events');
const root = process.argv[2] || path.resolve(__dirname, '..');
const handler = require('./service-harness.cjs')(root).router;
function request(method, url, body) {
  return new Promise(function (resolve, reject) {
    const req = new EventEmitter(); req.method = method; req.url = url;
    let status;
    const res = { writeHead: function (n) { status = n; },
      end: function (data) { resolve({ status: status, body: String(data) }); } };
    try {
      handler(req, res);
      if (method === 'POST') { req.emit('data', Buffer.from(body)); req.emit('end'); }
    } catch (e) { reject(e); }
  });
}
async function main() {
  let failed = 0;
  async function check(name, fn) {
    try { await fn(); console.log('PASS ' + name); }
    catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); }
  }
  for (const route of ['/control', '/debloat', '/mqtt', '/install', '/exec', '/wins']) {
    await check('POST ' + route + ' null returns 400 without throwing', async function () {
      const response = await request('POST', route, 'null');
      assert.equal(response.status, 400);
    });
  }
  const invalidBodies = ['[]', '1', 'true', '"text"', '{'];
  for (const body of invalidBodies) {
    for (const route of ['/control', '/debloat', '/mqtt', '/install']) {
      await check('POST ' + route + ' rejects ' + body, async function () {
        assert.equal((await request('POST', route, body)).status, 400);
      });
    }
  }
  for (const body of [
    {action: 'disable', appIds: 'com.samsung.tv.acr'},
    {action: 'disable', appIds: [null]},
    {action: 'disable', appIds: ['com.samsung.tv.coba.adagent']},
    {action: 'disable', kind: 'unknown'}
  ]) {
    await check('POST /debloat rejects invalid or protected target', async function () {
      assert.equal((await request('POST', '/debloat', JSON.stringify(body))).status, 400);
    });
  }
  await check('missing registry cannot mutate the TV', async function () {
    const r=await request('POST','/debloat',JSON.stringify({action:'disable',appIds:['user.app']}));
    assert.equal(r.status,503);assert.equal(JSON.parse(r.body).ok,false);
  });
  await check('valid platform requests return 503 with the standalone adapter', async function () {
    assert.equal((await request('POST', '/control', '{"key":"XF86Home"}')).status, 503);
    assert.equal((await request('POST', '/exec', '{"cmd":"id"}')).status, 503);
    assert.equal((await request('POST', '/exec', 'id')).status, 503);
  });
  await check('the dock accepts only known actions and never touches the TV on a bad one', async function () {
    assert.equal((await request('POST', '/dock', 'null')).status, 400);
    const bad = await request('POST', '/dock', '{"action":"format"}');
    assert.equal(bad.status, 409); assert.match(JSON.parse(bad.body).error, /Invalid dock action/);
    const fix = await request('POST', '/dock', '{"action":"fixTizenTube","on":"yes"}');
    assert.equal(fix.status, 409); assert.match(JSON.parse(fix.body).error, /Invalid value/);
    assert.equal((await request('GET', '/dock/icon?slug=..%2F..%2Fetc%2Fpasswd')).status, 404);
    assert.equal((await request('GET', '/dock/icon')).status, 404);
    const status = await request('GET', '/dock');
    assert.ok([200, 503].includes(status.status));
  });
  await check('malformed TV menu ID returns 400',async function(){assert.equal((await request('GET','/tv-menu?id=%ZZ')).status,400);});
  await check('GET /status returns JSON', async function () {
    const response = await request('GET', '/status');
    assert.equal(response.status, 200); JSON.parse(response.body);
  });
  await check('dashboard buttons use supported remote keys', async function () {
    const html = (await request('GET', '/')).body;
    const keys = JSON.parse((await request('GET', '/control')).body).keys;
    const buttons = Array.from(html.matchAll(/onclick="k\('([^']+)'\)"/g), function (m) { return m[1]; });
    assert.ok(buttons.length > 0);
    const invalid = buttons.filter(function (key) { return keys.indexOf(key) === -1; });
    assert.deepEqual(invalid, []);
  });
  process.exitCode = failed ? 1 : 0;
}
main().catch(function (error) { console.error(error); process.exitCode = 1; });
