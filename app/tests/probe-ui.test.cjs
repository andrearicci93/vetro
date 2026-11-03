'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const html = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'index.html'), 'utf8');
const script = /<script>\s*([\s\S]*?)<\/script>/.exec(html)[1];

const GOOD = {version: '0.3.5', port: 8099, address: '192.168.1.42', root: {mode: 'tv-integration', connected: true},
  input: {enabled: false, connected: false}, launcher: {installed: true, enabled: true, running: true, failures: 0, hasError: false}, memory: {availableMb: 612}};

// screen: the /screen body (null: the service answers nothing); probeResponse: the /probe reply.
async function run(options) {
  const o = Object.assign({probeResponse: {ok: true, persisted: true}, screen: GOOD, failFetch: null, appVersion: '0.3.5', hangLaunch: false, pending: {code: null}}, options || {});
  const sent = [], timers = [], intervals = [], listeners = {}, windowListeners = {}, exits = [], launched = [];
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
      if (/\/auth\/pending$/.test(this.url)) { this.status = 200; this.responseText = JSON.stringify(o.pending); return this.onload(); }
      if (o.screen === null) return this.onerror();
      this.status = 200; this.responseText = JSON.stringify(o.screen); this.onload();
    }
  };
  function WS() { setImmediate(() => this.onopen()); }
  WS.prototype.close = function () {};
  const context = {
    document: {readyState: o.readyState || 'complete', getElementById: id => id === 'stage' ? stage : screen, hidden: false, addEventListener: (n, f) => { listeners[n] = f; }},
    window: {a2sService: o.Service, innerWidth: 1920, innerHeight: 1080, addEventListener: (n, f) => { windowListeners[n] = f; }},
    XMLHttpRequest: XHR, WebSocket: WS,
    fetch: async () => { if (o.failFetch && o.failFetch.n-- > 0) throw new Error('refused'); return {status: 200}; },
    tizen: {
      tvinputdevice: {getSupportedKeys: () => [{name: 'VolumeUp'}]},
      application: {launch: (id, ok) => { launched.push(id); if (!o.hangLaunch) ok(); }, getAppsInfo: ok => ok([{id: 'vetrotvapp.app', packageId: 'vetrotvapp'}]),
        getCurrentApplication: () => ({exit: () => exits.push(1), appInfo: {version: o.appVersion}})},
      package: {getPackagesInfo: ok => { if (!o.hangPackages) ok([{id: 'vetrotvapp', version: '0.1.0'}]); }},
      systeminfo: {getPropertyValue: (name, ok) => { if (!o.hangBuild) ok({model: 'TV'}); }}
    }, webapis: {productinfo: {getModel: () => 'QE55Q80A', getFirmware: () => '2310.0'}},
    btoa: s => Buffer.from(s).toString('base64'), clearTimeout, clearInterval: () => {}, setInterval: (f, ms) => { intervals.push({f, ms}); return intervals.length; },
    setTimeout: (f, ms) => { if (ms === 1500) { setImmediate(f); return 0; } timers.push({f, ms}); return timers.length; }
  };
  vm.runInNewContext(script, context);   // its value is the page's run() promise, which a stuck call leaves pending
  // run() is not awaited by the page: let its promise chain settle.
  for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r));
  const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r)); };
  return {settle, intervals, sent, timers, exits, launched, listeners, windowListeners, screen, stage, context};
}
const key = (r, keyCode) => r.listeners.keydown({keyCode});

(async function () {
  assert.ok(html.includes("<script type=\"module\">import { Service } from 'wrt:service'; window.a2sService = Service;</script>"));
  // The classic script must wait for the later module before choosing a launcher.
  const deferred = await run({readyState: 'loading'}), started = [];
  assert.equal(deferred.launched.length, 0);
  assert.equal(deferred.sent.filter(s => s.method === 'POST').length, 0);
  deferred.context.window.a2sService = function (id) {
    this.start = () => { started.push(id); return Promise.resolve(); };
  };
  deferred.listeners.DOMContentLoaded();
  await deferred.settle();
  assert.deepEqual(started, ['vetrotvapp.svc']);
  assert.equal(deferred.launched.length, 0);
  assert.equal(deferred.sent.find(s => s.method === 'POST').body.probe.serviceLaunch.ok, true);
  const noReturn = await run({Service: function () { this.start = () => {}; }});
  assert.equal(noReturn.sent.find(s => s.method === 'POST').body.probe.serviceLaunch.ok, true);
  assert.equal(noReturn.launched.length, 0);
  for (const synchronous of [false, true]) {
    const refused = await run({screen: null, Service: function () {
      this.start = () => { if (synchronous) throw new Error('refused <start>'); return Promise.reject(new Error('refused <start>')); };
    }});
    assert.equal(refused.launched.length, 0);
    assert.equal(refused.sent.find(s => s.method === 'POST').body.probe.serviceLaunch.error, 'launch failed (wrt:service: refused <start>)');
    assert.ok(refused.screen.innerHTML.includes('launch failed (wrt:service: refused &lt;start&gt;)'));
  }
  // Missing/unsupported module on an older runtime leaves the legacy launcher available.
  const older = await run({readyState: 'loading'});
  older.listeners.DOMContentLoaded();
  await older.settle();
  assert.deepEqual(older.launched, ['vetrotvapp.svc']);
  // Healthy TV: the probe report is still sent, and the screen says so.
  const good = await run();
  const posts = good.sent.filter(s => s.method === 'POST');
  // #101: a first report right after the service answers, one per later step, the verdict one, one with the package list
  assert.equal(posts.length, 5, 'widget must still POST its collected report');
  assert.ok(posts.every(p => p.url === 'http://127.0.0.1:8099/probe'));
  assert.equal(posts[0].body.settings.model, 'QE55Q80A', 'the first report already names the TV');
  assert.equal(posts[0].body.progress.partial, true);
  assert.equal(posts[0].body.progress.done, 6);
  assert.equal(posts[0].body.progress.of, 9);
  assert.equal(posts[0].body.progress.next, 'remoteApi8001', 'a report left behind says which step came next');
  assert.equal(posts[0].body.probe.apps, undefined, 'the app list is not read yet');
  const verdict = posts.find(p => p.body.progress.partial === false).body;
  assert.equal(verdict.apps[0].id, 'vetrotvapp.app');
  assert.equal(verdict.probe.serviceReach.ok, true);
  assert.equal(verdict.probe.packages, undefined, 'the package list is read after the verdict');
  assert.equal(verdict.progress.done, 9);
  const last = posts[posts.length - 1].body;
  assert.equal(last.probe.packages.ok, true);
  assert.equal(last.packages[0].id, 'vetrotvapp', 'the package list goes out once it is read');
  assert.deepEqual(good.launched, ['vetrotvapp.svc'], 'the page starts the background service itself');
  assert.ok(good.sent.some(s => s.method === 'GET' && s.url === 'http://127.0.0.1:8099/screen'));
  assert.ok(good.screen.innerHTML.includes('Running in the background'));
  assert.ok(good.screen.innerHTML.includes('You can close this screen, Vetro keeps running without it.'));
  assert.ok(good.screen.innerHTML.includes('http://192.168.1.42:8099'));
  assert.ok(good.screen.innerHTML.includes('QE55Q80A'), 'model comes from the TV itself');
  assert.ok(good.screen.innerHTML.includes('V0.3.5 &middot; QE55Q80A 2310.0 &middot; svc ok &middot; root ok'), 'the support line');
  assert.ok(!/class="c (bad|warn)/.test(good.screen.innerHTML));
  assert.match(good.stage.style.transform, /^scale\(1\)$/);

  // The sign-in code: the slot is hidden until a browser asks to pair, then shows the code and who asked.
  assert.ok(/id="pin" hidden/.test(good.screen.innerHTML), 'the PIN slot is reserved and hidden');
  assert.ok(good.sent.some(s => s.method === 'GET' && s.url === 'http://127.0.0.1:8099/auth/pending'), 'the screen asks the service for a pending code');
  assert.ok(good.intervals.some(t => t.ms === 2000), 'and keeps asking');
  const pinned = await run({pending: {code: '482913', name: 'Chrome on Mac', expiresIn: 95}});
  assert.ok(/id="pin">PIN<b>482 913<\/b><i>Chrome on Mac · 1:3[45]<\/i>/.test(pinned.screen.innerHTML), 'a pending code is shown in groups of three, with the name and the time it stays valid');
  assert.ok(pinned.intervals.some(t => t.ms === 1000), 'the countdown ticks every second, so a lost answer cannot leave a dead code on screen');

  // The page stays up while the user reads; Back leaves; OK checks again; idle leaves.
  assert.equal(good.exits.length, 0);
  assert.ok(!good.timers.some(t => t.ms === 5000), 'no more closing 5 seconds after the report');
  assert.ok(good.timers.some(t => t.ms === 300000), 'an idle screen closes itself');
  key(good, 13);
  for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r));
  assert.equal(good.sent.filter(s => s.method === 'POST').length, 10, 'OK runs the checks again (five reports each time)');
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
  limit.f();
  await hung.settle();
  const report = hung.sent.find(s => s.method === 'POST').body;
  assert.equal(report.probe.serviceLaunch.ok, false);
  assert.ok(/no answer/.test(report.probe.serviceLaunch.error));
  assert.equal(report.probe.serviceReach.ok, true, 'the probes after the stuck one still run');
  assert.ok(!hung.screen.innerHTML.includes('Checking'), 'the screen leaves the waiting state');
  assert.ok(hung.screen.innerHTML.includes('Running in the background'), 'a start call that never reports back does not matter once the service answers');
  assert.ok(!/slow serviceLaunch|SLOW serviceLaunch/.test(hung.screen.innerHTML));
  // A slow step Vetro does not need is named, but the TV stays green.
  const build = await run({hangBuild: true});
  build.timers.filter(t => t.ms === 8000).pop().f();
  await build.settle();
  assert.ok(build.screen.innerHTML.includes('Running in the background'));
  assert.ok(build.screen.innerHTML.includes('slow: System info'));
  assert.ok(build.screen.innerHTML.includes('api ok, slow systeminfoBattery'));
  // While the checks run the screen says what it is doing: placeholders for each check, a turning ring, a step counter.
  const waiting = await run({hangLaunch: true});
  assert.ok(waiting.screen.innerHTML.includes('class="c wait"'), 'one placeholder per check while waiting');
  assert.ok(waiting.screen.innerHTML.includes('Root access'));
  assert.ok(waiting.screen.innerHTML.includes('Vetro is checking the TV'));
  assert.ok(waiting.screen.innerHTML.includes('1&ndash;2 minutes: please do not close this screen'), 'the wait is announced');
  assert.equal(waiting.screen.textContent, 'Checking 1 of 9 \u00b7 Starting the service \u00b7 0 s', 'the step, its name and its seconds');
  assert.ok(waiting.intervals.some(t => t.ms === 1000), 'the seconds tick');
  assert.ok(!waiting.screen.innerHTML.includes('<i>OK</i>'), 'no OK key while OK does nothing (#104)');
  assert.ok(good.screen.innerHTML.includes('<i>OK</i>Check again'), 'and back once the checks are done');
  // A step stuck past the total limit: the screen gives its verdict anyway, and says which steps did not answer.
  const capped = await run({hangLaunch: true});
  capped.timers.find(t => t.ms === 100000).f();
  await capped.settle();
  const cappedReport = capped.sent.find(s => s.method === 'POST' && s.body.progress.partial === false).body;
  assert.ok(/^skipped/.test(cappedReport.probe.serviceLaunch.error));
  assert.equal(cappedReport.progress.done, 0);
  assert.ok(!capped.screen.innerHTML.includes('class="c wait"'), 'the verdict is drawn');
  assert.ok(capped.screen.innerHTML.includes('No answer in time: Starting the service'), 'the stuck step is named');
  assert.ok(capped.screen.innerHTML.includes('SLOW serviceLaunch'), 'and in the support line');
  // The service never answers: no early report (it would fail), and the reason is in the support line (#2).
  const unreachable = await run({screen: null, failFetch: {n: 99}});
  assert.equal(unreachable.sent.filter(s => s.method === 'POST').length, 2, 'only the verdict report and the package one are tried');
  assert.ok(unreachable.screen.innerHTML.includes('SVC DOWN (reach: refused)'));
  // The package list is slow: the verdict does not wait for it, then it is drawn when it times out.
  const pk = await run({hangPackages: true});
  assert.ok(pk.screen.innerHTML.includes('Running in the background'), 'the verdict is there before the package list');
  assert.ok(pk.screen.innerHTML.includes('package list: reading'));
  pk.timers.find(t => t.ms === 30000).f();
  await pk.settle();
  assert.ok(pk.screen.innerHTML.includes('Not available: packages. No answer in time: Package list.'));
  assert.ok(pk.screen.innerHTML.includes('API packages SLOW packages'));
  const pkLast = pk.sent.filter(s => s.method === 'POST').pop().body;
  assert.ok(/^no answer in 30 s/.test(pkLast.probe.packages.error), 'the report says so too');
  assert.ok(!waiting.screen.innerHTML.includes('Asking for help') || !waiting.screen.innerHTML.includes('SVC'), 'no verdict while waiting');
  assert.ok(/<style>[\s\S]*@keyframes spin/.test(html), 'the waiting ring turns');
  console.log('PASS TV screen: probe report kept, healthy/limited/failed/down states, PIN slot hidden, Back/OK/idle');
})().catch(e => {console.error(e); process.exitCode = 1;});
