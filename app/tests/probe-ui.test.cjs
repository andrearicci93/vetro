'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const html = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'index.html'), 'utf8');
const script = /<script>\s*([\s\S]*?)<\/script>/.exec(html)[1];

async function run(response, failFetch) {
  const sent = [], timers = [], listeners = {}, exits = [], launched = [], output = {textContent: ''};
  function XHR() {}
  XHR.prototype.open = function (method, url) { this.method = method; this.url = url; };
  XHR.prototype.setRequestHeader = function () {};
  XHR.prototype.send = function (body) {
    sent.push({method: this.method, url: this.url, body: JSON.parse(body)});
    this.status = 200; this.responseText = JSON.stringify(response); this.onload();
  };
  function WS() { setImmediate(() => this.onopen()); }
  WS.prototype.close = function () {};
  await vm.runInNewContext(script, {
    document: {getElementById: () => output, hidden: false, addEventListener: (n, f) => { listeners[n] = f; }}, XMLHttpRequest: XHR, WebSocket: WS,
    // Emulates the observed runtime: fetch reports 200 but cannot be trusted
    // to honor POST options. Report delivery must use the explicit XHR path.
    fetch: async () => { if (failFetch && failFetch.n-- > 0) throw new Error('refused'); return {status: 200}; },
    tizen: {
      tvinputdevice: {getSupportedKeys: () => [{name: 'VolumeUp'}]},
      application: {launch: (id, ok) => { launched.push(id); ok(); }, getAppsInfo: ok => ok([{id: 'vetrotvapp.app', packageId: 'vetrotvapp'}]), getCurrentApplication: () => ({exit: () => exits.push(1)})},
      package: {getPackagesInfo: ok => ok([{id: 'vetrotvapp', version: '0.1.0'}])},
      systeminfo: {getPropertyValue: (name, ok) => ok({model: 'TV'})}
    }, webapis: {productinfo: {getModel: () => 'TV'}},
    btoa: s => Buffer.from(s).toString('base64'), setTimeout: (f, ms) => { if (ms === 1500) { setImmediate(f); return 0; } timers.push({f, ms}); return timers.length; }, clearTimeout
  });
  return {sent, timers, exits, launched, listeners, output: output.textContent};
}
(async function () {
  const good = await run({ok: true, persisted: true});
  assert.equal(good.sent.length, 1, 'widget must actually POST its collected report');
  assert.equal(good.sent[0].method, 'POST');
  assert.equal(good.sent[0].url, 'http://127.0.0.1:8099/probe');
  assert.equal(good.sent[0].body.apps[0].id, 'vetrotvapp.app');
  assert.ok(good.output.includes('saved'));
  const close = good.timers.find(t => t.ms === 5000);
  assert.ok(close, 'a delivered report schedules the page to close');
  assert.equal(good.exits.length, 0, 'the page stays up while the user can read it');
  close.f();
  assert.equal(good.exits.length, 1);
  assert.deepEqual(good.launched, ['vetrotvapp.svc'], 'the page starts the background service itself');
  assert.equal(good.sent[0].body.probe.serviceReach.ok, true);
  const slow = await run({ok: true, persisted: true}, {n: 2});
  assert.equal(slow.sent[0].body.probe.serviceReach.ok, true, 'a service still starting is retried');
  const bad = await run({});
  assert.ok(!bad.output.includes('Report sent to service:'));
  assert.ok(bad.output.includes('Report rejected'));
  assert.ok(!bad.timers.some(t => t.ms === 5000), 'a failed report keeps the page open for diagnosis');
  bad.listeners.visibilitychange();
  assert.equal(bad.exits.length, 0);
  console.log('PASS widget probe: explicit POST, complete report, no false success on empty 200');
})().catch(e => {console.error(e); process.exitCode = 1;});
