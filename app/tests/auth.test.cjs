'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const {EventEmitter} = require('events');
process.env.VETRO_AUTH_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-auth-')), 'auth.json');
const auth = require('../service/auth.js');

// Calls the gate like Vetro's router does; resolves {handled, code, headers, body}.
function call(method, url, opts) {
  opts = opts || {};
  return new Promise(resolve => {
    const req = new EventEmitter();
    Object.assign(req, {method, url, socket: {remoteAddress: opts.ip || '192.168.1.20'},
      headers: Object.assign({host: '192.168.1.10:8099'}, opts.headers || {})});
    const res = {writeHead(code, headers) { res.code = code; res.headers = headers || {}; },
      end(text) { let body = text; try { body = JSON.parse(text); } catch (e) {} resolve({handled: true, code: res.code, headers: res.headers, body}); }};
    const handled = auth.gate(req, res, url, {onPair: opts.onPair, open: opts.open});
    if (!handled) resolve({handled: false});
    process.nextTick(() => { if (opts.body !== undefined) req.emit('data', JSON.stringify(opts.body)); req.emit('end'); });
  });
}
const tv = {ip: '127.0.0.1', headers: {origin: 'null', host: '127.0.0.1:8099'}};

(async () => {
  // Apps on the TV pass straight through; the LAN does not.
  assert.equal((await call('POST', '/exec', tv)).handled, false);
  assert.equal((await call('GET', '/status', {ip: '127.0.0.1', headers: {host: '127.0.0.1:8099'}})).handled, false);
  assert.equal((await call('POST', '/exec')).code, 401);
  assert.equal((await call('POST', '/exec', {ip: '127.0.0.1', headers: {origin: 'http://evil.example', host: '127.0.0.1:8099'}})).code, 401);
  const page = await call('GET', '/');
  assert.equal(page.code, 200); assert.match(page.body, /Pair with your TV/);
  // DNS rebinding: a hostname on loopback doesn't count as the TV itself, so it needs a key like the LAN.
  assert.equal((await call('GET', '/status', {ip: '127.0.0.1', headers: {host: 'evil.example:8099'}})).code, 401);
  assert.equal((await call('GET', '/auth/pending', {ip: '127.0.0.1', headers: {origin: 'null', host: 'evil.example:8099'}})).code, 403);
  // Web pages can't start or finish a pairing: the Origin must match the Host.
  assert.equal((await call('POST', '/auth/pair', {headers: {origin: 'http://evil.example'}, body: {}})).code, 403);
  assert.equal((await call('POST', '/auth/confirm', {headers: {origin: 'http://evil.example'}, body: {}})).code, 403);
  // App-only mode (no TV adapter) stays open, but still refuses host names.
  assert.equal((await call('POST', '/exec', {open: true})).handled, false);
  assert.equal((await call('GET', '/', {open: true, headers: {host: 'evil.example:8099'}})).code, 403);

  // Pairing: only the TV sees the code.
  let launched = 0;
  const start = await call('POST', '/auth/pair', {body: {name: 'Mac'}, onPair: () => launched++});
  assert.equal(start.code, 200); assert.equal(launched, 1);
  assert.equal((await call('GET', '/auth/pending')).code, 403);
  const shown = await call('GET', '/auth/pending', tv);
  assert.match(shown.body.code, /^\d{6}$/); assert.equal(shown.body.name, 'Mac');
  // A live pairing can't be replaced (no cancelling someone's pairing, no repeated pop-ups on the TV).
  const again1 = await call('POST', '/auth/pair', {body: {}, onPair: () => launched++});
  assert.equal(again1.code, 429); assert.match(again1.body.error, /in progress/); assert.equal(launched, 1);
  assert.equal((await call('GET', '/auth/pending', tv)).body.code, shown.body.code);
  const wrong = String((Number(shown.body.code) + 1) % 1000000).padStart(6, '0');
  assert.equal((await call('POST', '/auth/confirm', {body: {id: start.body.id, code: wrong}})).code, 403);
  const ok = await call('POST', '/auth/confirm', {body: {id: start.body.id, code: shown.body.code}});
  assert.equal(ok.code, 200); assert.match(ok.body.token, /^[0-9a-f]{64}$/);
  assert.match(ok.headers['set-cookie'], /HttpOnly; SameSite=Strict/);
  assert.equal((await call('GET', '/auth/pending', tv)).body.code, null);
  assert.ok(!fs.readFileSync(process.env.VETRO_AUTH_PATH, 'utf8').includes(ok.body.token), 'only hashes are stored');

  // The key works as cookie or bearer; other sites cannot use the cookie.
  const cookie = {cookie: 'vetro_session=' + ok.body.token};
  assert.equal((await call('POST', '/exec', {headers: Object.assign({origin: 'http://192.168.1.10:8099'}, cookie)})).handled, false);
  assert.equal((await call('POST', '/exec', {headers: {authorization: 'Bearer ' + ok.body.token}})).handled, false);
  assert.equal((await call('POST', '/exec', {headers: Object.assign({origin: 'http://evil.example'}, cookie)})).code, 403);
  assert.equal((await call('GET', '/auth/devices', {headers: cookie})).body.devices[0].name, 'Mac');
  // Paired clients may reach the TV by name (tv.local, Home Assistant); the cookie stays bound to that host.
  assert.equal((await call('POST', '/exec', {headers: Object.assign({host: 'tv.local:8099', origin: 'http://tv.local:8099'}, cookie)})).handled, false);
  assert.equal((await call('GET', '/status', {headers: {host: 'tv.local:8099', authorization: 'Bearer ' + ok.body.token}})).handled, false);

  // Five wrong codes end a pairing.
  auth._reset();
  const again = await call('POST', '/auth/pair', {body: {}});
  const code = (await call('GET', '/auth/pending', tv)).body.code;
  const bad = String((Number(code) + 7) % 1000000).padStart(6, '0');
  for (let i = 0; i < 5; i++) await call('POST', '/auth/confirm', {body: {id: again.body.id, code: bad}});
  assert.equal((await call('POST', '/auth/confirm', {body: {id: again.body.id, code}})).code, 410);

  // Sign out removes the key; the TV can sign everyone out.
  auth._reset();
  const p = await call('POST', '/auth/pair', {body: {}});
  const t = (await call('POST', '/auth/confirm', {body: {id: p.body.id, code: (await call('GET', '/auth/pending', tv)).body.code}})).body.token;
  assert.equal((await call('POST', '/auth/signout-all', tv)).code, 200);
  assert.equal((await call('GET', '/apps', {headers: {authorization: 'Bearer ' + t}})).code, 401);
  // At most 20 keys: the 21st pairing is refused with a reason (no key is dropped silently).
  auth._reset();
  const pairOnce = async () => {
    auth._unthrottle();
    const st = await call('POST', '/auth/pair', {body: {name: 'Script'}});
    if (st.code !== 200) return st;
    return call('POST', '/auth/confirm', {body: {id: st.body.id, code: (await call('GET', '/auth/pending', tv)).body.code}});
  };
  const keys = [];
  for (let i = 0; i < 20; i++) { const r = await pairOnce(); assert.equal(r.code, 200); keys.push(r.body.token); }
  const full = await pairOnce();
  assert.equal(full.code, 409); assert.match(full.body.error, /20 paired devices/);
  assert.equal((await call('GET', '/apps', {headers: {authorization: 'Bearer ' + keys[0]}})).handled, false, 'the oldest key still works');

  // If the key file can't be written, pairing still works but says so, and the failure is logged.
  auth._reset();
  fs.rmSync(process.env.VETRO_AUTH_PATH, {force: true}); fs.mkdirSync(process.env.VETRO_AUTH_PATH);
  const logged = []; const err = console.error; console.error = m => logged.push(String(m));
  const warned = await pairOnce();
  console.error = err;
  assert.equal(warned.code, 200); assert.match(warned.body.warning, /could not be saved/);
  assert.ok(logged.some(m => /could not save/.test(m)), 'save failure is logged');

  console.log('PASS auth: TV widget passes, LAN pairs with a TV-only code, one pairing at a time, cookie/bearer keys (any host name), rebinding and cross-site refused, sign-out, app-only open, 20-key limit, save failures reported');
})().catch(e => { console.error(e); process.exitCode = 1; });
