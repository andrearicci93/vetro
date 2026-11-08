'use strict';
// The Vetro TV Tuner page: navigation, the static help (keys and previews), and the confirm flow of its two switches.
const assert = require('assert').strict, vm = require('vm');
const html = require('../service/dashboard.js')();
const page = require('../service/tuner-page.js');

// 1. Navigation and static content.
assert.match(html, /Remapper<\/button><button data-tab="tuner"[^>]*>[\s\S]*?Vetro TV Tuner<\/button><button data-tab="plugins"[^>]*>[\s\S]*?Vetro Shards/, 'the tuner is its own entry, between the Remapper and Vetro Shards');
assert.match(html, /<section id="tuner" hidden>/);
assert.ok(page.KEYS.length >= 8, 'the remote buttons are documented');
page.KEYS.forEach(function (k) { assert.ok(html.indexOf(k[1]) >= 0, 'key help on the page: ' + k[1].slice(0, 30)); });
const previews = page.previewsMarkup();
assert.equal((previews.match(/<svg class="tuner-screen"/g) || []).length, 6, 'six previews: banner, channel list, number pad, guide, info panel, audio');
assert.equal((previews.match(/<svg class="tuner-screen"[^>]*role="img" aria-label="[^"]{20,}/g) || []).length, 6, 'each preview has a text alternative');
assert.doesNotMatch(previews, /<script|onload=|href="http/, 'previews are inert, self-contained pictures');
assert.ok(html.indexOf(previews) >= 0, 'the previews are on the page');
assert.ok(html.indexOf(page.keysMarkup()) >= 0, 'the key table is on the page');
assert.doesNotMatch(page.css, /border-top(-color)?\s*:\s*[^;]*(var\(--(accent|ok|warn|danger))/, 'no coloured top border on a rounded card');

// 2. Behaviour in the page script.
const nodes = {};
const el = id => nodes[id] || (nodes[id] = {id, value: '', hidden: true, textContent: '', innerHTML: '', disabled: false, focus() {}});
const calls = [];
let tuner = {installed: true, supported: true, enabled: false, running: false, samsungTunerFound: true, failures: 0, log: ''};
const sandbox = {document: {getElementById: el, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}}, console, setTimeout() { return 1; }, clearTimeout() {}, setInterval() {},
    fetch: async (url, opts) => {
        const body = opts && opts.body ? JSON.parse(opts.body) : null;
        calls.push({url, body});
        let data = {};
        if (url === '/tuner' && !body) data = tuner;
        else if (url === '/tuner') {
            if (body.action === 'enable') tuner = Object.assign({}, tuner, {enabled: true, running: true});
            if (body.action === 'disable') tuner = Object.assign({}, tuner, {enabled: false, running: false});
            data = tuner;
        } else if (url.startsWith('/apps')) data = {apps: [], summary: {total: 0}};
        else if (url === '/remap') data = {rules: []};
        return {ok: true, json: async () => data};
    }};
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], sandbox);
const tick = () => new Promise(r => setImmediate(r));
const click = (target) => sandbox.$('tuner').onclick({target: {closest: () => ({dataset: target})}});
const change = (dataset, checked) => { const x = {dataset, checked}; sandbox.$('tuner').onchange({target: x}); return x; };

(async () => {
    await tick(); await tick();
    assert.ok(!calls.some(c => c.url === '/tuner'), 'the tuner is not read until its tab is opened');
    sandbox.switchPanel('tuner'); await tick(); await tick();
    assert.equal(sandbox.currentPanel, 'tuner');
    let body = el('tunerBody').innerHTML;
    assert.match(body, /Vetro TV Tuner/); assert.match(body, /state-chip[^>]*>Off</);
    assert.match(body, /data-tuner-switch[^>]*aria-label="Vetro TV Tuner"/);
    assert.doesNotMatch(body, /Show tuner now/, 'nothing to show while off');

    // Turning it on asks first and does nothing until confirmed.
    const before = calls.length;
    const sw = change({tunerSwitch: ''}, true);
    assert.equal(sw.checked, false, 'the switch does not flip before the confirmation');
    assert.equal(calls.length, before, 'no request yet');
    body = el('tunerBody').innerHTML;
    assert.match(body, /Turn on Vetro TV Tuner\?/); assert.match(body, /not removed, disabled or changed/);
    click({tunerCancel: ''});
    assert.doesNotMatch(el('tunerBody').innerHTML, /Turn on Vetro TV Tuner\?/, 'Cancel closes the question');
    assert.equal(calls.length, before);
    change({tunerSwitch: ''}, true);
    await click({tunerConfirm: ''}); await tick(); await tick();
    assert.deepEqual(calls.filter(c => c.url === '/tuner' && c.body).map(c => c.body), [{action: 'enable'}]);
    body = el('tunerBody').innerHTML;
    assert.match(body, /On · running/); assert.match(body, /Show tuner now/);

    // Samsung's app is not closed behind the tuner (the TV starts it again at once): no such option on the page.
    assert.doesNotMatch(el('tunerBody').innerHTML, /Close Samsung/);

    // Turning the tuner off needs no question.
    await change({tunerSwitch: ''}, false); await tick(); await tick();
    assert.equal(calls.filter(c => c.body && c.body.action === 'disable').length, 1);
    assert.match(el('tunerBody').innerHTML, /state-chip[^>]*>Off</);

    // A TV that cannot run it: the switch is disabled and the reason is shown, Samsung's tuner is left alone.
    tuner = Object.assign({}, tuner, {supported: false, enabled: false, unsupportedReason: 'This TV has no .NET runtime.'});
    await click({tunerReload: ''}); await tick(); await tick();
    body = el('tunerBody').innerHTML;
    assert.match(body, /This TV has no \.NET runtime\./); assert.match(body, /Samsung’s tuner stays as it is/);
    assert.match(body, /data-tuner-switch[^>]* disabled/);
    console.log('PASS Vetro TV Tuner page: entry, keys, previews, confirm flow, unsupported TV');
})().catch(e => { console.error(e); process.exit(1); });
