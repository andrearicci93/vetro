'use strict';
// Update notices: off by default (nothing is asked of GitHub); when the Developer settings switch is on, the dashboard asks for
// the Vetro update index and the plugin catalog by itself and puts a dot on the menu, but never installs anything.
const assert = require('assert').strict, vm = require('vm');
const html = require('../service/dashboard.js')();

const SHA = 'a'.repeat(64);
function run(stored) {
    const nodes = {}, tabs = {}, calls = [], intervals = [], storage = Object.assign({}, stored);
    const el = id => nodes[id] || (nodes[id] = {value: '', checked: false, disabled: false, hidden: true, textContent: '', innerHTML: '', className: '', dataset: {},
        focus() {}, setAttribute() {}, removeAttribute() {}, addEventListener() {}, classList: {add() {}, remove() {}, toggle() {}, contains: () => false}, style: {}, querySelector: () => null, querySelectorAll: () => []});
    const tab = name => tabs[name] || (tabs[name] = {dot: null, querySelector() { return this.dot; }, appendChild(d) { this.dot = d; d.remove = () => { this.dot = null; }; }});
    const responses = {
        '/update': {configured: true, source: 'https://updates.test/', version: '0.5.0', shell: 1, busy: false, pending: null, last: null, canRollBack: false},
        '/plugins': {plugins: [{id: 'hello', name: 'Hello', version: '1.0.0', state: 'running', permissions: [], trust: 'registry', enabled: true}], bundled: [], registry: 'https://plugins.test/index.json'},
        'https://updates.test/update-index.json': {version: '0.5.1', shell: 1, sha256: SHA, file: 'vetro-update-0.5.1.json'},
        'https://plugins.test/index.json': {format: 'vetro-plugin-index', plugins: [{id: 'hello', name: 'Hello', url: 'hello.vplugin', version: '1.1.0', sha256: SHA}]}
    };
    const sandbox = {
        document: {getElementById: el, querySelectorAll: () => [], querySelector: s => { const m = /data-tab="(\w+)"/.exec(s); return m ? tab(m[1]) : el('q:' + s); },
            createElement: () => ({setAttribute() {}, remove() {}}), body: {classList: {contains: () => false, add() {}, remove() {}}}, hidden: false, addEventListener() {}},
        localStorage: {getItem: k => (k in storage ? storage[k] : null), setItem(k, v) { storage[k] = String(v); }},
        setInterval(fn, ms) { intervals.push({fn, ms}); return intervals.length; }, setTimeout() { return 1; }, clearTimeout() {}, clearInterval() {},
        location: {reload() {}, hash: ''}, addEventListener() {}, confirm: () => true,
        fetch: async url => {
            calls.push(url);
            const d = responses[url];
            const other = url.startsWith('/apps') ? {apps: [], summary: {total: 0}} : url === '/remap' ? {rules: []}
                : url === '/input' ? {devices: [], status: {policy: {mode: 'off'}, events: []}}
                : url.startsWith('/monitor') ? {ts: Date.now(), memory: {}, cpu: {cores: []}, processes: [], network: []} : {};
            const body = d === undefined ? other : d;
            return {ok: true, json: async () => body, text: async () => JSON.stringify(body)};
        }
    };
    sandbox.window = sandbox;
    vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], sandbox);
    return {sandbox, nodes, tabs, calls, intervals, storage};
}
const tick = (n = 8) => new Promise(r => { let i = 0; (function next() { if (++i > n) r(); else setImmediate(next); })(); });
const asked = (calls, url) => calls.filter(c => c === url).length;

(async () => {
    // Off by default: nothing is fetched from the update source or the catalog, and no dot appears.
    let t = run({});
    await tick();
    assert.equal(asked(t.calls, 'https://updates.test/update-index.json'), 0);
    assert.equal(asked(t.calls, 'https://plugins.test/index.json'), 0);
    assert.ok(!(t.tabs.quick && t.tabs.quick.dot) && !(t.tabs.plugins && t.tabs.plugins.dot), 'no dots');
    assert.equal(t.nodes.autoUpdateCheck.checked, false);
    console.log('PASS update notices are off by default and ask GitHub for nothing');

    // On: both are asked at page load, a dot appears on Quick settings and Vetro Shards, and nothing is installed.
    t = run({'vetro.autoUpdateCheck': '1'});
    await tick();
    assert.equal(asked(t.calls, 'https://updates.test/update-index.json'), 1);
    assert.equal(asked(t.calls, 'https://plugins.test/index.json'), 1);
    assert.ok(t.tabs.quick.dot, 'Quick settings has a dot');
    assert.match(t.tabs.quick.dot.title, /Vetro update is available/);
    assert.ok(t.tabs.plugins.dot, 'Vetro Shards has a dot');
    assert.match(t.tabs.plugins.dot.title, /plugin update is available/);
    assert.equal(t.nodes.applyUpdate.hidden, false, 'the Update button is offered');
    assert.equal(t.nodes.applyUpdate.textContent, 'Update to 0.5.1');
    assert.equal(t.calls.filter(c => c === '/update/apply').length, 0, 'nothing is installed');
    assert.equal(t.nodes.autoUpdateCheck.checked, true);
    assert.ok(t.intervals.some(i => i.ms === 6 * 3600000), 'it asks again every six hours');
    console.log('PASS with update notices on, a new Vetro version and a new plugin version show a dot and install nothing');

    // The switch saves the choice and asks at once.
    t = run({});
    await tick();
    t.nodes.autoUpdateCheck.checked = true;
    t.nodes.autoUpdateCheck.onchange.call(t.nodes.autoUpdateCheck);
    await tick();
    assert.equal(t.storage['vetro.autoUpdateCheck'], '1');
    assert.equal(asked(t.calls, 'https://updates.test/update-index.json'), 1);
    assert.ok(t.tabs.quick.dot);
    t.nodes.autoUpdateCheck.checked = false;
    t.nodes.autoUpdateCheck.onchange.call(t.nodes.autoUpdateCheck);
    assert.equal(t.storage['vetro.autoUpdateCheck'], '0');
    console.log('PASS the Developer settings switch saves the choice and asks at once');

    // Same versions: no dot, and no "latest version" message that nobody asked for.
    t = run({'vetro.autoUpdateCheck': '1'});
    await tick(2);
    t.sandbox.updateState = {configured: true, source: 'https://updates.test/', version: '0.5.1', shell: 1};
    t.nodes.updateStatus.textContent = '';
    t.sandbox.showUpdateIndex({version: '0.5.1', shell: 1, sha256: SHA, file: 'vetro-update-0.5.1.json'}, true);
    assert.equal(t.nodes.updateStatus.textContent, '');
    assert.equal(t.sandbox.updateAvail, null);
    console.log('PASS a quiet check that finds nothing newer stays silent');

    // A needs-reinstall version is flagged but not offered as an in-place update.
    t.sandbox.showUpdateIndex({version: '0.6.0', shell: 2, sha256: SHA, file: 'vetro-update-0.6.0.json'}, true);
    assert.equal(t.sandbox.updateAvail, 'reinstall');
    console.log('PASS a version that needs a reinstall is flagged as such');

    // A second check that finds an incompatible version takes the Update button away, and Update is not sent for it.
    t.sandbox.showUpdateIndex({version: '0.5.2', shell: 1, sha256: SHA, file: 'vetro-update-0.5.2.json'}, true);
    assert.equal(t.nodes.applyUpdate.hidden, false);
    t.sandbox.showUpdateIndex({version: '0.6.0', shell: 2, sha256: SHA, file: 'vetro-update-0.6.0.json'}, true);
    assert.equal(t.nodes.applyUpdate.hidden, true, 'no stale Update button for a package that needs a reinstall');
    t.sandbox.showUpdateIndex({version: '0.5.1', shell: 1, sha256: SHA, file: 'vetro-update-0.5.1.json'}, true);
    assert.equal(t.nodes.applyUpdate.hidden, true, 'no stale Update button when nothing newer is left');
    const before = t.calls.length;
    t.nodes.applyUpdate.onclick.call(t.nodes.applyUpdate);
    await tick();
    assert.equal(t.calls.length, before, 'Update does nothing when no installable version is on offer');
    assert.equal(typeof t.sandbox.waitForVersion, 'function', 'the restart watcher exists');
    console.log('PASS a stale Update button is removed and cannot send an incompatible package');
    process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
