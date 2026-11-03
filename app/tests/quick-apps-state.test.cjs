'use strict';
// #89: the Quick settings switches waited for the app list and said "Reading apps…" for ever when that read failed,
// came back empty or hung. #100: Settings components are not offered as "App to open".
const assert = require('assert').strict, vm = require('vm');
const html = require('../service/dashboard.js')();
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function load(appsAnswers) {
  const nodes = {}, timers = [], calls = [];
  const el = id => nodes[id] || (nodes[id] = {id, value: '', hidden: true, textContent: '', innerHTML: '', disabled: false, focus() {}});
  const sandbox = {document: {getElementById: el, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}}, console,
    setTimeout(fn, ms) { timers.push({fn, ms}); return timers.length; }, clearTimeout(n) { if (timers[n - 1]) timers[n - 1].cleared = true; }, setInterval() {},
    fetch: async url => {
      calls.push(url);
      let data = {};
      if (url.startsWith('/apps')) {
        const a = appsAnswers.shift();
        if (a === 'hang') return new Promise(() => {});
        if (a instanceof Error) throw a;
        data = a;
      } else if (url === '/status') data = {agent: {connected: true}, mode: 'root', app: {version: '9.9.9'}};
      else if (url === '/dns') data = {enabled: false, applied: false, domains: [], resolvers: []};
      else if (url === '/input') data = {devices: [], status: {policy: {mode: 'off'}, events: []}};
      else if (url === '/remap') data = {rules: []};
      return {ok: true, json: async () => data};
    }};
  vm.runInNewContext(script, sandbox);
  return {sandbox, el, timers, calls};
}
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };
const tracking = t => t.el('quickTracking').innerHTML;
const apps = [{appId: 'com.samsung.tv.acr-service-app', packageId: 'com.samsung.tv.acr-service-app', name: 'ACR', disabled: false, area: 'tracking', role: 'tracking', show: false},
  {appId: 'org.tizen.netflix-app', packageId: 'org.tizen.netflix-app', name: 'Netflix', show: true, disabled: false},
  {appId: 'com.samsung.tv.coba.setting.devicemanager', packageId: 'com.samsung.tv.coba.setting', name: 'Setting', show: true, disabled: false}];

(async () => {
  // The read fails: the switch says so and offers Retry; Retry reads again and the switch comes back.
  let t = load([new Error('Service unreachable'), {apps, summary: {total: apps.length}, source: 'package registry + public probe'}]);
  await tick();
  assert.match(tracking(t), /App list not read · Service unreachable/);
  assert.match(tracking(t), /data-apps-retry/);
  assert.doesNotMatch(tracking(t), /Reading apps…/);
  t.el('quick').onclick({target: {closest: () => ({dataset: {appsRetry: ''}})}});
  await tick();
  assert.equal(t.calls.filter(u => u.startsWith('/apps')).length, 2, 'Retry reads the list again');
  assert.equal(t.calls.filter(u => u.startsWith('/apps'))[1], '/apps?refresh=1');
  assert.doesNotMatch(tracking(t), /App list not read|data-apps-retry/);
  // #100: the Settings component is not offered as an app to open; Netflix is.
  assert.match(t.el('targetApp').innerHTML, /org\.tizen\.netflix-app/);
  assert.doesNotMatch(t.el('targetApp').innerHTML, /coba\.setting/);
  assert.doesNotMatch(t.el('mqttTarget').innerHTML, /coba\.setting/);

  // The service answers with no apps (root not connected yet, no widget report): said, with the reason, and Retry.
  t = load([{apps: [], summary: {total: 0}, source: 'public probe', registryError: 'no root agent connected'}]);
  await tick();
  assert.match(tracking(t), /App list unavailable · no root agent connected/);
  assert.match(tracking(t), /data-apps-retry/);

  // The read hangs: "Reading apps…" first, then after 30 s "Still reading" with Retry.
  t = load(['hang']);
  await tick();
  assert.match(tracking(t), /Reading apps…/);
  const slow = t.timers.find(x => x.ms === 30000 && !x.cleared);
  assert.ok(slow, 'a 30 s timer watches the read');
  slow.fn();
  assert.match(tracking(t), /Still reading the app list…/);
  assert.match(tracking(t), /data-apps-retry/);
  console.log('PASS quick settings app list: failed, empty and slow reads are said with Retry (#89); Settings components are not offered as apps (#100)');
})().catch(e => { console.error(e); process.exitCode = 1; });
