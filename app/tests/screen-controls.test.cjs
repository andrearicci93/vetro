'use strict';
// The quick controls of the TV screen: what each tile reads and does, who may change anything, and the update the service fetches itself.
const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const {EventEmitter} = require('events');
process.env.VETRO_AUTH_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-screen-controls-')), 'auth.json');
const auth = require('../service/auth.js');
const {Controls, newer, groupTile} = require('../service/screen-controls.js');
const quick = require('../service/quick-settings.js');

// ---- who may use the routes (the sign-in gate) ---------------------------------------------------------------
function call(method, url, opts) {
  opts = opts || {};
  return new Promise(resolve => {
    const req = new EventEmitter();
    Object.assign(req, {method, url, socket: {remoteAddress: opts.ip || '192.168.1.20'}, headers: Object.assign({host: '192.168.1.10:8099'}, opts.headers || {})});
    const res = {writeHead(code, headers) { res.code = code; res.headers = headers || {}; }, end(text) { let body = text; try { body = JSON.parse(text); } catch (e) {} resolve({handled: true, code: res.code, body}); }};
    if (!auth.gate(req, res, url, {})) resolve({handled: false});
  });
}
const tv = {ip: '127.0.0.1', headers: {origin: 'null', host: '127.0.0.1:8099'}};
const stranger = {ip: '192.168.1.20', headers: {origin: 'null', host: '192.168.1.10:8099'}};      // a page that is not the TV, with an opaque origin

function app(rows) { return rows.map(r => Object.assign({appId: r[0], area: r[1], role: 'optional', disabled: r[2], onboot: false, autorestart: false}, r[3] || {})); }

async function gate() {
  auth.setPairingEnabled(false);
  // Pairing off: the Q8F page (not recognised as the TV) can still READ what the tiles would show, never change anything.
  assert.equal((await call('GET', '/screen/controls', stranger)).handled, false, 'the read is open to the TV page, as /screen is');
  assert.equal((await call('POST', '/screen/control', stranger)).code, 403, 'pairing off, not the TV, opaque origin: the change is refused');
  assert.equal((await call('POST', '/screen/control', {ip: stranger.ip, headers: {host: stranger.headers.host}})).handled, false, 'a plain LAN client with no Origin behaves as it does for every other route when pairing is off');
  assert.equal((await call('POST', '/screen/control', {ip: stranger.ip, headers: {origin: 'http://evil.example', host: stranger.headers.host}})).code, 403, 'a web page from another site is refused');
  assert.equal((await call('POST', '/screen/control', tv)).handled, false, 'the TV itself may');
  auth.setPairingEnabled(true);
  assert.equal((await call('GET', '/screen/controls', stranger)).code, 401, 'pairing on: an unpaired page reads nothing either');
  assert.equal((await call('POST', '/screen/control', stranger)).code, 401);
  assert.equal((await call('GET', '/screen/controls', tv)).handled, false);
  assert.equal((await call('POST', '/screen/control', tv)).handled, false);
  auth.setPairingEnabled(false);
}

// ---- the router: preflight and the read ---------------------------------------------------------------------------
async function router() {
  const service = require('./service-harness.cjs')(path.resolve(__dirname, '..'));
  const server = http.createServer(service.router);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const request = (method, endpoint, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request({host: '127.0.0.1', port: server.address().port, method, path: endpoint,
      headers: {Origin: 'null', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data)}}, res => {
      let text = ''; res.on('data', c => { text += c; }); res.on('end', () => resolve({status: res.statusCode, headers: res.headers, text}));
    });
    req.on('error', reject); req.end(data);
  });
  try {
    for (const endpoint of ['/screen/controls', '/screen/control']) {
      const pre = await request('OPTIONS', endpoint);
      assert.equal(pre.status, 204, endpoint + ' answers the preflight of a JSON request');
      assert.equal(pre.headers['access-control-allow-origin'], 'null');
      assert.equal(pre.headers['access-control-allow-headers'], 'Content-Type');
    }
    const read = await request('GET', '/screen/controls');
    assert.equal(read.status, 200);
    assert.equal(read.headers['access-control-allow-origin'], 'null');
    const d = JSON.parse(read.text);
    assert.equal(d.canControl, true, 'a request from the TV itself may change things');
    assert.deepEqual(Object.keys(d.tiles).sort(), ['ads', 'launcher', 'tuner', 'voice']);
    assert.equal(d.tiles.ads.state, 'na', 'no root connection in this harness');
    assert.equal((await request('GET', '/screen/control')).status, 404, 'the change route is POST only');
    assert.equal((await request('POST', '/screen/controls', {})).status, 405, 'the read route takes no POST');
    const bad = await request('POST', '/screen/control', {id: 'format-the-tv', on: true});
    assert.equal(bad.status, 400, 'an unknown control is refused');
  } finally { server.close(); }
}

// ---- the tiles -------------------------------------------------------------------------------------------------
function fakes(over) {
  over = over || {};
  const calls = [];
  const dockState = Object.assign({enabled: false, customApp: null}, over.dock);
  const tunerState = Object.assign({enabled: false}, over.tuner);
  const d = {
    calls,
    dock: {installed: () => over.dockInstalled !== false, readState: () => dockState,
      enable: () => { calls.push('dock.enable'); dockState.enabled = true; return Promise.resolve({}); },
      disable: () => { calls.push('dock.disable'); dockState.enabled = false; return Promise.resolve({}); },
      disableCustom: () => { calls.push('dock.disableCustom'); dockState.customApp = null; return Promise.resolve({}); }},
    tuner: {installed: () => true, readState: () => tunerState,
      enable: () => { calls.push('tuner.enable'); if (over.tunerRefuses) return Promise.reject(new Error(over.tunerRefuses)); tunerState.enabled = true; return Promise.resolve({}); },
      disable: () => { calls.push('tuner.disable'); tunerState.enabled = false; return Promise.resolve({}); }},
    updater: {status: () => Object.assign({configured: true, source: over.source || 'http://127.0.0.1:1/', version: '0.5.1', shell: 1, busy: false, pending: null}, over.updaterStatus),
      apply: (text, sha) => { calls.push('updater.apply ' + sha + ' ' + text.length); return over.applyFails ? Promise.reject(Object.assign(new Error(over.applyFails), {code: 'busy'})) : Promise.resolve({ok: true}); }},
    agent: over.agent !== false,
    agentConnected() { return d.agent; },
    inventory: () => Promise.resolve(over.registryError ? {registryError: 'x', apps: []} : {apps: over.apps || []}),
    applyQuick: (id, off) => { calls.push('quick ' + id + ' ' + off); return Promise.resolve({ok: true}); }
  };
  return d;
}

async function tiles() {
  const tracking = app([['com.samsung.tv.coba.a', 'tracking', true], ['com.samsung.tv.coba.b', 'tracking', true]]);
  const mixed = app([['com.samsung.tv.alexa-client', 'voice', true], ['com.samsung.tv.vif', 'voice', false], ['com.samsung.tv.bixby-prov', 'voice', false]]);
  let d = fakes({apps: tracking.concat(mixed), dock: {enabled: true}});
  let c = new Controls(d), r = await c.read(true);
  assert.equal(r.canControl, true);
  assert.equal(r.tiles.launcher.state, 'on');
  assert.equal(r.tiles.ads.state, 'on', 'every member disabled: the switch is on');
  assert.equal(r.tiles.voice.state, 'part');
  assert.equal(r.tiles.voice.left, 2, 'two voice members still run');
  assert.equal(r.tiles.tuner.state, 'off');
  assert.equal((await c.read(false)).canControl, false, 'a page that is not the TV is told so up front');
  // The custom launcher counts as the launcher being on, as on the old screen.
  d = fakes({dock: {customApp: 'x.y'}}); r = await new Controls(d).read(true);
  assert.deepEqual(r.tiles.launcher, {state: 'on', custom: true});
  // No root: the tiles that need it say so; the registry unreadable is not "enabled".
  d = fakes({agent: false}); r = await new Controls(d).read(true);
  assert.ok(['launcher', 'ads', 'voice', 'tuner'].every(k => r.tiles[k].state === 'na' && /root/i.test(r.tiles[k].why)));
  d = fakes({registryError: true}); r = await new Controls(d).read(true);
  assert.equal(r.tiles.ads.state, 'na');
  r = await new Controls(fakes({dockInstalled: false})).read(true);
  assert.equal(r.tiles.launcher.state, 'na');
  // A group the TV does not have.
  assert.equal(groupTile(quick.find('tracking-all'), []).state, 'na');
  assert.equal(groupTile(quick.find('tracking-all'), app([['x', 'optional-area', false]])).state, 'na', 'members of another area are not part of the group');
  assert.equal(groupTile(quick.find('tracking-all'), app([['x', 'tracking', false]])).state, 'off', 'one running member: the switch is off');

  // Actions go to the same internals as the dashboard.
  d = fakes(); c = new Controls(d);
  await c.act({id: 'launcher', on: true}); await c.act({id: 'launcher', on: false});
  await c.act({id: 'tuner', on: true}); await c.act({id: 'tuner', on: false});
  await c.act({id: 'ads', on: true}); await c.act({id: 'ads', on: false});
  await c.act({id: 'voice', on: true});
  assert.deepEqual(d.calls, ['dock.enable', 'dock.disable', 'tuner.enable', 'tuner.disable', 'quick tracking-all true', 'quick tracking-all false', 'quick voice-all true']);
  d = fakes({dock: {customApp: 'x.y'}}); await new Controls(d).act({id: 'launcher', on: false});
  assert.deepEqual(d.calls, ['dock.disableCustom'], 'off on a custom launcher puts Samsung\'s Home back the way the dashboard does');
  // Refusals keep their reason and status, and change nothing.
  const refuse = async (p, deps, status, text) => {
    const x = fakes(deps);
    await assert.rejects(new Controls(x).act(p), e => { assert.equal(e.statusCode, status); assert.match(e.message, text); return true; });
    return x.calls;
  };
  assert.deepEqual(await refuse({id: 'nope', on: true}, {}, 400, /Unknown control/), []);
  assert.deepEqual(await refuse({id: 'ads', on: 'yes'}, {}, 400, /Invalid state/), []);
  assert.deepEqual(await refuse({id: 'ads', on: true}, {agent: false}, 409, /root/i), []);
  assert.deepEqual(await refuse({id: 'tuner', on: true}, {tunerRefuses: 'The TV’s tuner service (tvs-daemon) is not running.'}, 409, /tvs-daemon/), ['tuner.enable']);
}

// ---- the update the service fetches itself -------------------------------------------------------------------------
async function update() {
  const sha = 'a'.repeat(64);
  const files = {'/update-index.json': JSON.stringify({version: '0.5.2', file: 'vetro-update-0.5.2.json', sha256: sha, shell: 1}), '/vetro-update-0.5.2.json': '{"bundle":true}'};
  let hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    if (!(req.url in files)) { res.writeHead(404); return res.end(); }
    res.writeHead(200); res.end(files[req.url]);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const source = 'http://127.0.0.1:' + server.address().port + '/';
  try {
    let d = fakes({source}), c = new Controls(d);
    assert.deepEqual(await c.act({id: 'update', step: 'check'}), {ok: true, phase: 'found', version: '0.5.2'});
    assert.deepEqual(d.calls, [], 'checking installs nothing');
    assert.deepEqual(hits, ['/update-index.json'], 'and downloads no bundle');
    // Apply fetches the list again, then the bundle, and gives the updater the list\'s hash: the signature is the updater\'s to check.
    hits = [];
    assert.deepEqual(await c.act({id: 'update', step: 'apply'}), {ok: true, phase: 'run', version: '0.5.2'});
    assert.deepEqual(d.calls, ['updater.apply ' + sha + ' 15']);
    assert.deepEqual(hits, ['/update-index.json', '/vetro-update-0.5.2.json']);
    // Nothing newer, or a version that needs a reinstall: no download of the bundle.
    d = fakes({source, updaterStatus: {version: '0.5.2'}}); hits = [];
    assert.equal((await new Controls(d).act({id: 'update', step: 'check'})).phase, 'none');
    await assert.rejects(new Controls(d).act({id: 'update', step: 'apply'}), /newest version/);
    d = fakes({source, updaterStatus: {shell: 0}}); files['/update-index.json'] = JSON.stringify({version: '0.6.0', file: 'vetro-update-0.6.0.json', sha256: sha, shell: 2});
    assert.equal((await new Controls(d).act({id: 'update', step: 'check'})).phase, 'reinstall');
    await assert.rejects(new Controls(d).act({id: 'update', step: 'apply'}), /Apps2Samsung/);
    assert.deepEqual(hits.filter(h => h !== '/update-index.json'), [], 'the bundle is never fetched for those');
    // A list that is not what the dashboard accepts is refused: no path of its own, no odd hash.
    for (const bad of [{version: '0.5.2', file: '../../etc/passwd', sha256: sha}, {version: '0.5.2', file: 'vetro-update-0.5.2.json', sha256: 'zz'}, {version: 'x', file: 'vetro-update-0.5.2.json', sha256: sha}, 'not json']) {
      files['/update-index.json'] = typeof bad === 'string' ? bad : JSON.stringify(bad);
      await assert.rejects(new Controls(fakes({source})).act({id: 'update', step: 'check'}), /Unexpected update list/);
    }
    files['/update-index.json'] = JSON.stringify({version: '0.5.2', file: 'vetro-update-0.5.2.json', sha256: sha});
    // The updater's own refusal (busy, pending, bad signature) reaches the screen with its status.
    await assert.rejects(new Controls(fakes({source, applyFails: 'An update is already in progress'})).act({id: 'update', step: 'apply'}), e => e.statusCode === 409 && /already in progress/.test(e.message));
    // A build without the key cannot update, and a missing list is said plainly.
    await assert.rejects(new Controls(fakes({source, updaterStatus: {configured: false}})).act({id: 'update', step: 'check'}), /no update key/);
    delete files['/update-index.json'];
    await assert.rejects(new Controls(fakes({source})).act({id: 'update', step: 'check'}), /No update has been published yet/);
    // Too big a bundle is cut off, and a wrong step is refused.
    files['/update-index.json'] = JSON.stringify({version: '0.5.2', file: 'vetro-update-0.5.2.json', sha256: sha});
    await assert.rejects(new Controls(fakes({source})).act({id: 'update', step: 'launch'}), /Invalid update step/);
    await assert.rejects(new Controls(fakes({source: 'ftp://example.invalid/'})).act({id: 'update', step: 'check'}), /not valid/);
  } finally { server.close(); }
  assert.equal(newer('0.5.2', '0.5.1'), true); assert.equal(newer('0.5.1', '0.5.1'), false); assert.equal(newer('0.10.0', '0.9.9'), true); assert.equal(newer('0.5.0', '0.5.1'), false);
}

(async () => {
  await gate(); await router(); await tiles(); await update();
  console.log('screen-controls ok');
})().catch(e => { console.error(e); process.exit(1); });
