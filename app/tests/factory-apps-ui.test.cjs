'use strict';
// #135 in the dashboard: pickers without factory, hotel or shop apps; AgingApp's "Open app" disabled; a confirmation for
// the others; the factory test banner and its reset; the Aging result after "Stop now".
const assert = require('assert').strict, vm = require('vm');
const factory = require('../service/factory-apps.js');
const html = require('../service/dashboard.js')();
const nodes = {}, el = id => nodes[id] || (nodes[id] = {value: '', hidden: true, textContent: '', innerHTML: '', disabled: false, focus() {}});
const row = (id, name) => ({appId: id, packageId: id, name, show: true, disabled: false, system: true, onboot: false, autorestart: false, launchRisk: factory.risk(id, id)});
const apps = [row('org.tizen.AgingApp', 'AgingApp'), row('org.tizen.cloning', 'Cloning'), row('org.tizen.netflix-app', 'Netflix')];
let aging = {key: 'db/FactoryApp/Aging', present: true, value: 1, type: 'Int32', active: true}, stopResult = null;
const calls = [];
const sandbox = {document: {getElementById: el, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}}, console, confirm: () => true,
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() {},
    fetch: async (url, opts) => { const body = opts && opts.body ? JSON.parse(opts.body) : null; calls.push({url, body}); let data = {};
        if (url.startsWith('/apps/launch')) data = {ok: true, sent: 1, skipped: []};
        else if (url.startsWith('/apps')) data = {apps, summary: {total: apps.length}, source: 'package registry + public probe'};
        else if (url === '/factory-test' && !body) data = aging;
        else if (url === '/factory-test') { aging = Object.assign({}, aging, {value: 0, active: false}); data = {ok: true, changed: true, before: {value: 1}, after: aging, active: false, message: 'Factory test turned off. Restart the TV: the colour test no longer starts at boot.'}; }
        else if (url === '/components/action') data = {ok: true, verified: true, action: 'stop', factoryTest: stopResult};
        else if (url.startsWith('/monitor')) data = {ts: Date.now(), memory: {totalBytes: 1000, availableBytes: null}, cpu: {percent: null, cores: []}, processes: [], network: []};
        else if (url === '/input') data = {devices: [], status: {events: []}}; else if (url === '/remap') data = {rules: []};
        return {ok: true, json: async () => data}; }};
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], sandbox);
const tick = () => new Promise(r => setImmediate(r));
(async () => {
    for (let i = 0; i < 4; i++) await tick();
    // Pickers for remapper and MQTT rules
    assert.match(el('targetApp').innerHTML, /org\.tizen\.netflix-app/);
    assert.doesNotMatch(el('targetApp').innerHTML, /AgingApp|cloning/, 'no factory, hotel or shop app among the apps a rule can open');
    // Task manager drawer
    const aged = sandbox.detailMarkup(apps[0]);
    assert.match(aged, /id="launchApp" class="primary" disabled/);assert.match(aged, /Factory test or service menu/);
    assert.doesNotMatch(sandbox.detailMarkup(apps[1]), /id="launchApp" class="primary" disabled/, 'Not used at home: open after a confirmation');
    sandbox.confirmLaunch(apps[1], null);
    assert.equal(el('componentConfirmation').hidden, false);assert.match(el('componentConfirmation').innerHTML, /hotel, shop or factory app/);
    assert.ok(!calls.some(c => c.url === '/apps/launch'), 'nothing is sent before the confirmation');
    await el('confirmComponentAction').onclick.call(el('confirmComponentAction'));await tick();
    assert.deepEqual(calls.filter(c => c.url === '/apps/launch').map(c => c.body), [{appId: 'org.tizen.cloning', confirmed: true}]);
    // Banner: the key reads 1
    assert.equal(el('factoryTestBanner').hidden, false);assert.match(el('factoryTestBanner').innerHTML, /data-factory-reset/);assert.match(el('factoryTestBanner').innerHTML, /factory colour test is switched on/);
    await sandbox.resetFactoryTest();await tick();
    assert.deepEqual(calls.filter(c => c.url === '/factory-test' && c.body).map(c => c.body), [{action: 'reset'}]);
    assert.doesNotMatch(el('factoryTestBanner').innerHTML, /data-factory-reset/, 'off: no button');assert.match(el('factoryTestBanner').innerHTML, /Restart the TV/);
    // Key 0 on a fresh read: no banner
    sandbox.factoryTestView.message = '';await sandbox.loadFactoryTest();assert.equal(el('factoryTestBanner').hidden, true);
    // Stop now on AgingApp: the service's Aging result is part of the outcome
    stopResult = {changed: true, after: {value: 0, active: false}, message: 'Factory test turned off. Restart the TV: the colour test no longer starts at boot.'};
    await sandbox.runComponentAction(apps[0], {action: 'stop', appId: 'org.tizen.AgingApp'});
    assert.match(sandbox.operationEntries[0].message, /Factory test turned off/);
    stopResult = {changed: false, error: 'TV platform adapter unavailable'};
    await sandbox.runComponentAction(apps[0], {action: 'stop', appId: 'org.tizen.AgingApp'});
    assert.match(sandbox.operationEntries[0].message, /could not be checked: TV platform adapter unavailable/);
    console.log('PASS factory apps UI: pickers, disabled Open app, confirmation, factory test banner and reset, Stop now result (#135)');
})().catch(e => { console.error(e); process.exitCode = 1; });
