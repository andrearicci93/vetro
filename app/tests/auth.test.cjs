'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const {EventEmitter} = require('events');
process.env.VETRO_AUTH_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-auth-')), 'auth.json');
// Pairing is off by default since 0.5.1; this file checks the pairing-on behaviour (pairing-mode.test.cjs covers off).
fs.writeFileSync(process.env.VETRO_AUTH_PATH + '.mode', JSON.stringify({enabled: true}));
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
  assert.equal((await call('POST', '/sdb-access')).code, 401);
  assert.equal((await call('POST', '/exec', {ip: '127.0.0.1', headers: {origin: 'http://evil.example', host: '127.0.0.1:8099'}})).code, 401);
  const page = await call('GET', '/');
  assert.equal(page.code, 200); assert.match(page.body, /Pair with your TV/);
  assert.match(page.body, /<img src="\/icon\.png"/, 'the sign-in page shows the Vetro logo'); assert.match(page.body, /No code on the TV\?[\s\S]*Open the <b>Vetro app<\/b> on the TV/, 'and says what to do when no code appears');
  assert.equal((await call('GET', '/icon.png')).handled, false, 'the logo is public so the sign-in page can show it');
  const bar = auth.decorate('<html><body></body></html>');
  assert.match(bar, /id="gaOut"[^>]*>Sign out<\/button>/); assert.match(bar, /Only this device[\s\S]*All devices[\s\S]*Cancel/); assert.doesNotMatch(bar, /confirm\(/, 'the choice is a dialog, not a browser prompt');
  // DNS rebinding: a hostname on loopback doesn't count as the TV itself, so it needs a key like the LAN.
  assert.equal((await call('GET', '/status', {ip: '127.0.0.1', headers: {host: 'evil.example:8099'}})).code, 401);
  assert.equal((await call('GET', '/auth/pending', {ip: '127.0.0.1', headers: {origin: 'null', host: 'evil.example:8099'}})).code, 403);
  // A TV that blocks loopback (The Frame 2025, #122): its own LAN address counts as the TV, anyone else's does not.
  auth._ownAddresses(() => ({lo0: [{family: 'IPv4', internal: true, address: '127.0.0.1'}], eth0: [{family: 'IPv6', internal: false, address: 'fe80::1'}, {family: 'IPv4', internal: false, address: '192.168.1.10'}]}));
  const own = {ip: '192.168.1.10', headers: {origin: 'null', host: '192.168.1.10:8099'}};
  assert.equal((await call('POST', '/exec', own)).handled, false);
  assert.equal((await call('POST', '/exec', Object.assign({}, own, {ip: '::ffff:192.168.1.10'}))).handled, false);
  assert.equal((await call('GET', '/auth/pending', own)).code, 200);
  assert.equal((await call('POST', '/exec', {ip: '192.168.1.11', headers: own.headers})).code, 401);
  assert.equal((await call('GET', '/auth/pending', {ip: '192.168.1.11', headers: own.headers})).code, 403);
  assert.equal((await call('POST', '/exec', {ip: '192.168.1.10', headers: {origin: 'http://evil.example', host: '192.168.1.10:8099'}})).code, 401);
  assert.equal((await call('GET', '/status', {ip: '192.168.1.10', headers: {host: 'evil.example:8099'}})).code, 401);
  assert.equal(auth.fromThisTv('192.168.1.10'), true); assert.equal(auth.fromThisTv('::ffff:192.168.1.10'), true);
  assert.equal(auth.fromThisTv('192.168.1.99'), false); assert.equal(auth.fromThisTv(undefined), false); assert.equal(auth.fromThisTv('0.0.0.0'), false);
  // An unreadable interface list means nothing extra is trusted.
  auth._ownAddresses(() => { throw new Error('no interfaces'); });
  assert.equal((await call('POST', '/exec', own)).code, 401);
  auth._ownAddresses();
  // Every 127.x address is loopback, so a TV that does not use 127.0.0.1 itself still counts as the TV.
  assert.equal((await call('POST', '/exec', {ip: '127.0.0.2', headers: tv.headers})).handled, false);
  assert.equal((await call('POST', '/exec', {ip: '::ffff:127.10.0.1', headers: tv.headers})).handled, false);
  assert.equal((await call('GET', '/auth/pending', {ip: '127.0.0.2', headers: tv.headers})).code, 200);
  assert.equal(auth.fromThisTv('127.255.255.254'), true); assert.equal(auth.fromThisTv('128.0.0.1'), false);
  assert.equal(auth.fromThisTv('::ffff:128.0.0.1'), false); assert.equal(auth.fromThisTv('10.127.0.0.1'), false);
  // Refusals on the TV page's routes are readable by the page and say what the service saw, instead of "Failed to fetch".
  {
    const page = {ip: '192.168.1.77', headers: {origin: 'null', host: '127.0.0.1:8099'}};
    const status = await call('GET', '/status', page);
    assert.equal(status.code, 401); assert.equal(status.headers['Access-Control-Allow-Origin'], '*');
    assert.deepEqual(status.body.seen, {address: '192.168.1.77', origin: 'null', host: '127.0.0.1:8099'});
    for (const route of ['/probe', '/screen']) assert.equal((await call('GET', route, page)).headers['Access-Control-Allow-Origin'], '*');
    const pin = await call('GET', '/auth/pending', page);
    assert.equal(pin.code, 403); assert.equal(pin.headers['Access-Control-Allow-Origin'], '*'); assert.equal(pin.body.pending, false);
    assert.equal(pin.body.code, undefined, 'the refusal never carries the code');
    const exec = await call('POST', '/exec', page);
    assert.equal(exec.code, 401); assert.equal(exec.headers['Access-Control-Allow-Origin'], undefined, 'other routes stay unreadable cross-origin');
    assert.equal(exec.body.seen, undefined);
  }
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
  {
    const refused = await call('GET', '/auth/pending', {ip: '192.168.1.77', headers: {origin: 'null', host: '127.0.0.1:8099'}});
    assert.equal(refused.body.pending, true, 'a page that is not the TV learns a code is waiting, so it can say it cannot show it');
    assert.equal(refused.body.code, undefined);
  }
  const shown = await call('GET', '/auth/pending', tv);
  assert.match(shown.body.code, /^\d{6}$/); assert.equal(shown.body.name, 'Mac');
  // A live pairing can't be replaced (no cancelling someone's pairing, no repeated pop-ups on the TV).
  const again1 = await call('POST', '/auth/pair', {body: {}, onPair: () => launched++});
  assert.equal(again1.code, 429); assert.match(again1.body.error, /Another device is pairing/); assert.equal(launched, 1);
  assert.equal((await call('GET', '/auth/pending', tv)).body.code, shown.body.code);
  const wrong = String((Number(shown.body.code) + 1) % 1000000).padStart(6, '0');
  assert.equal((await call('POST', '/auth/confirm', {body: {id: start.body.id, code: wrong}})).code, 403);
  const ok = await call('POST', '/auth/confirm', {body: {id: start.body.id, code: shown.body.code}});
  assert.equal(ok.code, 200); assert.match(ok.body.token, /^[0-9a-f]{64}$/);
  assert.match(ok.headers['set-cookie'][0], /HttpOnly; SameSite=Strict/);
  assert.equal((await call('GET', '/auth/pending', tv)).body.code, null);
  assert.ok(!fs.readFileSync(process.env.VETRO_AUTH_PATH, 'utf8').includes(ok.body.token), 'only hashes are stored');

  // The key works as cookie or bearer; other sites cannot use the cookie.
  const cookie = {cookie: 'vetro_session=' + ok.body.token};
  assert.equal((await call('POST', '/exec', {headers: Object.assign({origin: 'http://192.168.1.10:8099'}, cookie)})).handled, false);
  assert.equal((await call('POST', '/exec', {headers: {authorization: 'Bearer ' + ok.body.token}})).handled, false);
  assert.equal((await call('POST', '/sdb-access', {headers: {authorization: 'Bearer ' + ok.body.token}})).handled, false);
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

  // A reload must not lose the pairing: the browser that asked keeps an id cookie, resumes the same code, and anyone else is told to wait.
  auth._reset();
  const r1 = await call('POST', '/auth/pair', {body: {name: 'Mac'}});
  const pairCookie = {cookie: /^(vetro_pair=[0-9a-f]{32})/.exec(r1.headers['set-cookie'])[1]};
  assert.match(r1.headers['set-cookie'], /Path=\/auth; HttpOnly; SameSite=Strict/); assert.match(r1.headers['set-cookie'], /Max-Age=120/);
  assert.deepEqual(Object.assign({}, (await call('GET', '/auth/state')).body, {expiresIn: 0}), {pending: true, mine: false, expiresIn: 0}, 'another browser sees a waiting code, not that it is theirs');
  const mine = await call('GET', '/auth/state', {headers: pairCookie});
  assert.equal(mine.body.mine, true); assert.ok(mine.body.expiresIn > 100 && mine.body.expiresIn <= 120);
  const noCookie = await call('POST', '/auth/pair', {body: {}});
  assert.equal(noCookie.code, 429); assert.match(noCookie.body.error, /Another device is pairing right now\. Try again in \d+ seconds/); assert.equal(noCookie.body.mine, false);
  auth._unthrottle();
  const owner = await call('POST', '/auth/pair', {body: {}, headers: pairCookie});
  assert.equal(owner.code, 429); assert.match(owner.body.error, /already on the TV screen/); assert.equal(owner.body.mine, true, 'the owner is told to resume, and the code is not replaced');
  const wrongBrowser = await call('POST', '/auth/confirm', {body: {code: (await call('GET', '/auth/pending', tv)).body.code}});
  assert.equal(wrongBrowser.code, 410); assert.match(wrongBrowser.body.error, /another browser or tab/, 'without the id the code does not work, and the message says why');
  const resumed = await call('POST', '/auth/confirm', {body: {code: (await call('GET', '/auth/pending', tv)).body.code}, headers: pairCookie});
  assert.equal(resumed.code, 200, 'after a reload the cookie stands in for the id');
  assert.match(resumed.headers['set-cookie'].join('\n'), /vetro_pair=; Max-Age=0; Path=\/auth/, 'the pairing cookie is cleared once paired');
  assert.equal((await call('GET', '/auth/state', {headers: pairCookie})).body.pending, false);

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

  // Node 4.4 (Tizen 5.5) has no crypto.timingSafeEqual: pairing and keys still work through the fallback.
  {
    const crypto = require('crypto'), real = crypto.timingSafeEqual;
    crypto.timingSafeEqual = undefined;
    try {
      auth._reset(); fs.rmSync(process.env.VETRO_AUTH_PATH, {recursive: true, force: true});
      const r = await pairOnce();
      assert.equal(r.code, 200);
      assert.equal((await call('GET', '/apps', {headers: {authorization: 'Bearer ' + r.body.token}})).handled, false);
      assert.equal((await call('GET', '/apps', {headers: {authorization: 'Bearer ' + 'f'.repeat(64)}})).code, 401);
    } finally { crypto.timingSafeEqual = real; }
  }

  console.log('PASS auth: TV widget passes, LAN pairs with a TV-only code, one pairing at a time, cookie/bearer keys (any host name), rebinding and cross-site refused, sign-out, app-only open, 20-key limit, save failures reported, Node 4 fallback');
})().catch(e => { console.error(e); process.exitCode = 1; });
