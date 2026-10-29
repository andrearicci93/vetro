'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const page = process.argv[2] || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(page, 'utf8');
const css = fs.readFileSync(path.join(path.dirname(page), 'index.css'), 'utf8');
// The inline port settings of index.html, then index.js, as the TV runs them.
const script = /<script>\s*([\s\S]*?)<\/script>/.exec(html)[1] + '\n' + fs.readFileSync(path.join(path.dirname(page), 'index.js'), 'utf8');

const GOOD = {version: '0.3.5', port: 8099, address: '192.168.1.42', root: {mode: 'tv-integration', connected: true},
  input: {enabled: false, connected: false}, launcher: {installed: true, enabled: true, running: true, failures: 0, hasError: false}, memory: {availableMb: 612}};

// screen: the /screen body (null: the service answers nothing); probeResponse: the /probe reply.
async function run(options) {
  const o = Object.assign({probeResponse: {ok: true, persisted: true}, screen: GOOD, failFetch: null, appVersion: '0.3.5', hangLaunch: false,
    packages: [{id: 'vetrotvapp', version: '0.1.0'}]}, options || {});
  const sent = [], timers = [], listeners = {}, windowListeners = {}, exits = [], launched = [];
  const screen = {innerHTML: ''}, stage = {style: {}};
  function XHR() {}
  XHR.prototype.open = function (method, url) { this.method = method; this.url = url; };
  XHR.prototype.setRequestHeader = function () {};
  XHR.prototype.send = function (body) {
    if (this.method === 'POST') {
      sent.push({method: this.method, url: this.url, body: JSON.parse(body)});
      this.status = 200; this.responseText = JSON.stringify(o.probeResponse); this.onload();
    } else {
      sent.push({method: this.method, url: this.url});
      if (o.screen === null) return this.onerror();
      this.status = 200; this.responseText = JSON.stringify(o.screen); this.onload();
    }
  };
  function WS() { setImmediate(() => this.onopen()); }
  WS.prototype.close = function () {};
  const context = {
    document: {getElementById: id => id === 'stage' ? stage : screen, hidden: false, addEventListener: (n, f) => { listeners[n] = f; }},
    window: {innerWidth: 1920, innerHeight: 1080, addEventListener: (n, f) => { windowListeners[n] = f; }},
    XMLHttpRequest: XHR, WebSocket: WS,
    fetch: async () => { if (o.failFetch && o.failFetch.n-- > 0) throw new Error('refused'); return {status: 200}; },
    tizen: {
      tvinputdevice: {getSupportedKeys: () => [{name: 'VolumeUp'}]},
      application: {launch: (id, ok) => { launched.push(id); if (!o.hangLaunch) ok(); }, getAppsInfo: ok => ok([{id: 'vetrotvapp.app', packageId: 'vetrotvapp'}]),
        getCurrentApplication: () => ({exit: () => exits.push(1), appInfo: {version: o.appVersion}})},
      package: {getPackagesInfo: ok => ok(o.packages)},
      systeminfo: {getPropertyValue: (name, ok) => ok({model: 'TV'})}
    }, webapis: {productinfo: {getModel: () => 'QE55Q80A', getFirmware: () => '2310.0'}},
    btoa: s => Buffer.from(s).toString('base64'), clearTimeout,
    setTimeout: (f, ms) => { if (ms === 1500) { setImmediate(f); return 0; } timers.push({f, ms}); return timers.length; }
  };
  vm.runInNewContext(script, context);
  // run() is not awaited by the page: let its promise chain settle.
  for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r));
  const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r)); };
  return {settle, sent, timers, exits, launched, listeners, windowListeners, screen, stage, context};
}
const key = (r, keyCode) => r.listeners.keydown({keyCode});

(async function () {
  // Healthy TV: the probe report is still sent, and the screen says so.
  const good = await run();
  const posts = good.sent.filter(s => s.method === 'POST');
  assert.equal(posts.length, 1, 'widget must still POST its collected report');
  assert.equal(posts[0].url, 'http://127.0.0.1:8099/probe');
  assert.equal(posts[0].body.apps[0].id, 'vetrotvapp.app');
  assert.equal(posts[0].body.probe.serviceReach.ok, true);
  assert.deepEqual(good.launched, ['vetrotvapp.svc'], 'the page starts the background service itself');
  assert.ok(good.sent.some(s => s.method === 'GET' && s.url === 'http://127.0.0.1:8099/screen'));
  assert.ok(good.screen.innerHTML.includes('Running in the background'));
  assert.ok(good.screen.innerHTML.includes('You can close this screen, Vetro keeps running without it.'));
  assert.ok(good.screen.innerHTML.includes('http://192.168.1.42:8099'));
  assert.ok(good.screen.innerHTML.includes('QE55Q80A'), 'model comes from the TV itself');
  assert.ok(good.screen.innerHTML.includes('V0.3.5 &middot; QE55Q80A 2310.0 &middot; svc ok &middot; root ok'), 'the support line');
  assert.ok(!/class="c (bad|warn)/.test(good.screen.innerHTML));
  assert.match(good.stage.style.transform, /^scale\(1\)$/);

  // The PIN slot of 0.4.0 exists but is hidden until the service sends one.
  assert.ok(/id="pin" hidden/.test(good.screen.innerHTML), 'the PIN slot is reserved and hidden');
  const pinned = await run({screen: Object.assign({}, GOOD, {pin: '4829'})});
  assert.ok(/id="pin">PIN<b>4829<\/b>/.test(pinned.screen.innerHTML), 'a PIN sent by the service is shown');

  // The page stays up while the user reads; Back leaves; OK checks again; idle leaves.
  assert.equal(good.exits.length, 0);
  assert.ok(!good.timers.some(t => t.ms === 5000), 'no more closing 5 seconds after the report');
  assert.ok(good.timers.some(t => t.ms === 300000), 'an idle screen closes itself');
  key(good, 13);
  for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r));
  assert.equal(good.sent.filter(s => s.method === 'POST').length, 2, 'OK runs the checks again');
  key(good, 10009);
  assert.equal(good.exits.length, 1, 'Back closes the screen');
  const idle = good.timers.filter(t => t.ms === 300000).pop();
  idle.f();
  assert.equal(good.exits.length, 2);

  // Errors are loud and say what to do.
  const root = await run({screen: Object.assign({}, GOOD, {root: {mode: 'app-only', connected: false}})});
  assert.ok(root.screen.innerHTML.includes('Running, with limits'));
  assert.ok(!root.screen.innerHTML.includes('You can close this screen'), 'the all-clear is only said when everything is green');
  assert.ok(root.screen.innerHTML.includes('app-only package'));
  assert.ok(root.screen.innerHTML.includes('<em class="w">ROOT NO</em>'));
  const failed = await run({screen: Object.assign({}, GOOD, {launcher: {installed: true, enabled: true, running: false, failures: 4, hasError: true}, memory: {availableMb: 148}})});
  assert.ok(failed.screen.innerHTML.includes('Needs attention'));
  assert.ok(failed.screen.innerHTML.includes('Failed to start'));
  assert.ok(failed.screen.innerHTML.includes('Tried 4 times'));
  assert.ok(failed.screen.innerHTML.includes('<em>LAUNCHER FAIL x4</em>'));
  assert.ok(failed.screen.innerHTML.includes('1 problem<'), 'the summary counts problems');
  assert.ok(failed.screen.innerHTML.includes('MEM 148M'));
  const mismatch = await run({appVersion: '0.3.2'});
  assert.ok(mismatch.screen.innerHTML.includes('Version differs'), 'an app and a service of different versions are named');

  // Service down: the page still draws itself, with no invented facts.
  const down = await run({screen: null});
  assert.ok(down.screen.innerHTML.includes('Not responding'));
  assert.ok(down.screen.innerHTML.includes('Address unavailable'));
  assert.ok(down.screen.innerHTML.includes('SVC DOWN'));
  assert.ok(!down.screen.innerHTML.includes('You can close this screen'));
  assert.ok(down.screen.innerHTML.includes('QE55Q80A'), 'model and firmware come from the TV, not the service');

  // A service still starting is retried; a refused report keeps the page open for diagnosis.
  const slow = await run({failFetch: {n: 2}});
  assert.equal(slow.sent.find(s => s.method === 'POST').body.probe.serviceReach.ok, true);
  const bad = await run({probeResponse: {}});
  bad.context.document.hidden = true;
  bad.listeners.visibilitychange();
  assert.equal(bad.exits.length, 0, 'a rejected report is not a delivered one');
  const leaving = await run();
  leaving.context.document.hidden = true;
  leaving.listeners.visibilitychange();
  assert.equal(leaving.exits.length, 1, 'a delivered page leaves when the user goes elsewhere');
  // A Tizen call that never answers must not keep the screen on "Checking": its probe times out and the rest goes on.
  const hung = await run({hangLaunch: true});
  assert.ok(hung.screen.innerHTML.includes('Checking'), 'still waiting for the stuck call');
  const limit = hung.timers.find(t => t.ms === 8000);
  assert.ok(limit, 'every probe has a time limit');
  assert.equal(hung.screen.textContent, '9 of 10 checks done', 'the checks run at the same time: only the stuck one is left');
  limit.f();
  await hung.settle();
  const report = hung.sent.find(s => s.method === 'POST').body;
  assert.equal(report.probe.serviceLaunch.ok, false);
  assert.equal(report.probe.serviceLaunch.error, 'no answer in 8 s', 'the error names the time limit that ran out');
  assert.equal(report.probe.serviceReach.ok, true, 'the probes after the stuck one still run');
  assert.deepEqual(Object.keys(report.probe), ['serviceLaunch', 'tizenObject', 'webapisObject', 'supportedKeys', 'apps', 'packages',
    'productinfo', 'systeminfoBattery', 'remoteApi8001', 'serviceReach'], 'the report keeps the job order, whichever check finishes first');
  assert.ok(!hung.screen.innerHTML.includes('Checking'), 'the screen leaves the waiting state');
  // While the checks run the screen says what it is doing: placeholders for each check, a turning ring, a step counter.
  const waiting = await run({hangLaunch: true});
  assert.ok(waiting.screen.innerHTML.includes('class="c wait"'), 'one placeholder per check while waiting');
  assert.ok(waiting.screen.innerHTML.includes('Root access'));
  assert.ok(waiting.screen.innerHTML.includes('Vetro is checking the TV'));
  assert.ok(!waiting.screen.innerHTML.includes('Asking for help') || !waiting.screen.innerHTML.includes('SVC'), 'no verdict while waiting');
  assert.ok(/@keyframes spin/.test(css), 'the waiting ring turns');
  // Samsung's guideline: a loading indicator only once loading takes 100 ms.
  assert.ok(/\.state\.wait svg,\s*\.c\.wait \.ic \{\s*visibility: hidden;/.test(css), 'the ring is hidden at first');
  assert.ok(/\.slow \.state\.wait svg,\s*\.slow \.c\.wait \.ic \{\s*visibility: visible;\s*animation: spin/.test(css), 'and turns once the stage is slow');
  assert.equal(waiting.stage.className, '');
  waiting.timers.find(t => t.ms === 100).f();
  assert.equal(waiting.stage.className, 'slow', 'after 100 ms of checking the ring shows');
  // The TV has no monospace font: the address, PIN and support line use the bundled Roboto Mono.
  assert.ok(/@font-face \{\s*font-family: 'Roboto Mono';\s*src: url\(fonts\/RobotoMono-Regular\.woff\) format\('woff'\);/.test(css));
  assert.equal((css.match(/font-family: 'Roboto Mono', monospace;/g) || []).length, 3, '.url, .pin b and .share code');
  // totalSize blocks the page on the TV (about 40 ms per package); the service measures sizes.
  let sizeReads = 0;
  const sized = await run({packages: [{id: 'a', version: '1', get totalSize() { sizeReads++; return 4096; }}]});
  sized.timers.forEach(t => t.f());
  await sized.settle();
  assert.equal(sizeReads, 0, 'the page never reads a package size');
  assert.deepEqual(sized.sent.find(s => s.method === 'POST').body.packages, [{id: 'a', version: '1'}]);
  console.log('PASS TV screen: probe report kept, healthy/limited/failed/down states, PIN slot hidden, Back/OK/idle, no package sizes read');
})().catch(e => {console.error(e); process.exitCode = 1;});
