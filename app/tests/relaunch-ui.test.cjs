'use strict';
// The HbbTV row tells the user when the TV starts the app again and points to the diagnostics report.
const assert = require('assert').strict, vm = require('vm');
const html = require('../service/dashboard.js')();
async function memoryFor(hbbtv) {
  const nodes = {}, el = id => nodes[id] || (nodes[id] = {id, value: '', hidden: true, textContent: '', innerHTML: '', disabled: false, focus() {}});
  const sandbox = {document: {getElementById: el, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}}, console, setTimeout() { return 1; }, clearTimeout() {}, setInterval() {},
    fetch: async url => {
      let data = {};
      if (url.startsWith('/apps')) data = {apps: [], summary: {total: 0}, source: 'test'};
      else if (url === '/hbbtv') data = hbbtv;
      else if (url === '/wins') data = {ts: 1, wins: {firmware: {status: 'off', value: 1}, multiscreen: {status: 'on', running: false}, ambient: {status: 'on', running: false, chosen: true}}};
      else if (url === '/dns') data = {enabled: false, applied: false, domains: [], resolvers: []};
      else if (url === '/leftovers') data = {files: [], packageBytes: 0, storageBefore: {availableBytes: 1}, errors: []};
      else if (url === '/input') data = {devices: [], status: {policy: {mode: 'off'}, events: []}};
      else if (url === '/remap') data = {rules: []};
      return {ok: true, json: async () => data};
    }};
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], sandbox);
  const tick = () => new Promise(r => setImmediate(r));
  await tick(); await tick();
  return el('quickMemory').innerHTML;
}
const base = {value: 19, off: false, valueOff: true, flag: true, running: false, serviceRunning: false, canRestore: true, restoreValue: 20};
(async () => {
  const note = /The TV starts this app again\. Share a diagnostics report to help us fix it\./;
  let m = await memoryFor({...base, running: true});
  assert.match(m, note); assert.match(m, /Partly done · the menu says Off, but the app is still running/); assert.match(m, /data-quick-open="diagnostics"/);
  assert.match(await memoryFor({...base, serviceRunning: true}), note);
  assert.match(await memoryFor({...base, relaunchSeen: true}), note, 'the watcher saw the app come back');
  assert.doesNotMatch(await memoryFor({...base}), note, 'only the brake file is missing: no accusation');
  assert.doesNotMatch(await memoryFor({...base, off: true, flag: true, valueOff: true}), note, 'fully off: no note');
  assert.doesNotMatch(await memoryFor({...base, valueOff: false, value: 20, running: true}), note, 'HbbTV is on in the menu: nothing to report');
  console.log('PASS relaunch UI note');
})().catch(e => { console.error(e); process.exit(1); });
