'use strict';
// The Remapper's "Send key": a remote key can press another one (HDMI 1, Play/Pause...), not only open an app. Every key it offers
// is one the service can send; the saved rule carries a key action; the shortcut list names the key.
const assert = require('assert').strict, vm = require('vm');
const control = require('../service/control.js'), remap = require('../service/remap.js'), kr = require('../service/key-routing.js');
const html = require('../service/dashboard.js')();

// The list, on the page and in the service.
const offered = /<select id="targetKey">(.*?)<\/select>/.exec(html)[1].match(/KEY_[A-Z0-9]+/g);
['KEY_HDMI1', 'KEY_HDMI4', 'KEY_DISPLAYPORT', 'KEY_POWER', 'KEY_TV', 'KEY_PLAYPAUSE', 'KEY_PLAY', 'KEY_PAUSE', 'KEY_STOP', 'KEY_REWIND', 'KEY_FF', 'KEY_HOME', 'KEY_RETURN']
    .forEach(k => assert.ok(offered.includes(k), k + ' is offered'));
offered.filter(k => k !== "KEY_DISPLAYPORT").forEach(k => assert.ok(control.injectCommand(control.nativeKey(k)), k + ' is a key the service can send'));
assert.equal(control.nativeKey('KEY_PLAYPAUSE'), 'XF86PlayBack', 'Play/Pause is the remote\'s own toggle key (code 244)');
assert.equal(control.nativeKey('KEY_FF'), 'XF86AudioForward');
assert.ok(kr.keyCommand('XF86PlayBack', control.injectCommand('XF86PlayBack')).includes("echo 'key 244' >&3"), 'with Vetro TV Tuner on screen, Play/Pause goes to it as the remote\'s key');
const mqttKeys = /<select id="mqttKey">(.*?)<\/select>/.exec(html)[1].match(/KEY_[A-Z0-9]+/g);
assert.deepEqual(mqttKeys, offered, 'the Home Assistant rule editor offers the same keys');

// The page: choose "Send key", pick HDMI 1, save.
const nodes = {}, el = id => nodes[id] || (nodes[id] = {value: '', hidden: true, textContent: '', innerHTML: '', disabled: false, focus() {}, setAttribute() {}});
let saved = null, rules = [];
const sandbox = {document: {getElementById: el, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}}, console, confirm: () => true,
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() {},
    fetch: async (url, opts) => { const body = opts && opts.body ? JSON.parse(opts.body) : null; let data = {};
        if (url === '/remap' && body) { saved = body.rules; rules = remap.validateRules(body.rules); data = {ok: true, rules}; }
        else if (url === '/remap') data = {rules, reserved: []};
        else if (url.startsWith('/apps')) data = {apps: [], summary: {total: 0}};
        else if (url === '/input') data = {devices: [], status: {events: []}};
        else if (url.startsWith('/monitor')) data = {ts: Date.now(), memory: {}, cpu: {cores: []}, processes: [], network: []};
        return {ok: true, json: async () => data}; }};
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], sandbox);
const tick = () => new Promise(r => setImmediate(r));
(async () => {
    for (let i = 0; i < 4; i++) await tick();
    el('ruleAction').value = 'key'; el('ruleAction').onchange.call(el('ruleAction'));
    assert.equal(el('targetKeyField').hidden, false, 'Send key shows the key list');
    assert.equal(el('targetAppField').hidden, true, 'and hides the app list');
    el('inputCode').value = '1056'; el('targetKey').value = 'KEY_HDMI1';
    await el('saveRule').onclick.call(el('saveRule'));
    assert.equal(saved, null, 'a code past 767 is refused before anything is sent');
    el('inputCode').value = '615';
    await el('saveRule').onclick.call(el('saveRule'));
    for (let i = 0; i < 4; i++) await tick();
    assert.deepEqual(saved, [{id: 'physical_615', enabled: true, trigger: {type: 'physical', value: '615'}, actions: [{type: 'key', key: 'KEY_HDMI1'}]}]);
    assert.deepEqual(remap.resolve(remap.validateRules(saved), 'physical', '615'), [{type: 'key', key: 'KEY_HDMI1'}], 'the service accepts it as it is');
    sandbox.showRules();
    assert.match(el('rules').innerHTML, /Key <code>615<\/code> → HDMI 1 key/, 'the list names the key');
    el('ruleAction').value = 'launch'; el('ruleAction').onchange.call(el('ruleAction'));
    assert.equal(el('targetAppField').hidden, false, 'Open app brings the app list back');
    console.log('PASS remapper send key: offered keys are sendable, the rule carries a key action, the list names it');
})().catch(e => { console.error(e); process.exitCode = 1; });
