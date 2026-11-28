'use strict';
// Save settings / Load settings (#307): only choices go into the file, never what Vetro recorded about the TV or a secret;
// a file is checked before anything is compared; loading lists the dashboard's own requests in a safe order, and what
// needs root is blocked (not queued) while the root agent is away.
const assert = require('assert').strict, EventEmitter = require('events'), path = require('path');
const b = require('../service/settings-backup.js');

const dock = {enabled: true, customApp: null, fixTizenTube: true, noMotion: true, hdrDim: true, hdrBrightness: 30, uiBrightness: 80, closeIdleHome: false, volumePill: true, volumeEdge: 'right', numberPad: false,
    cards: ['tasks', 'shard:clock'], showHomeSources: true, useSourceImages: false, appStore: 'samsung',
    // recorded about this TV: never in the file
    autorunWas: 1, customHomeDisabled: true, since: 123, build: 'x', row: {order: ['app:secret.row'], hidden: [], labels: {}}, lastCards: ['audio']};
const src = {appVersion: '0.7.1', now: '2026-11-23T10:00:00.000Z', root: true, dock, tuner: {enabled: true, since: 5, buildPid: 9},
    rules: [{id: 'r1', enabled: true, trigger: {type: 'key', value: 'KEY_RED'}, actions: [{type: 'launch', appId: 'org.example.app'}]}],
    wins: {firmware: true, quickboot: false, ambient: true, telemetry: false, hbbtv: true, autoupdatePrevious: 7, deliveryApps: ['ledger.app'], firmwareBoot: 'b'},
    multiscreen: false, keyGuides: true, perf: {on: false, keepOpen: ['org.keep'], owned: {motion: true, idleHome: false, wins: ['ambient']}},
    keepRemoved: true, quickOff: ['alexa', 'tvplus'], dns: {enabled: true, domains: ['ads.example'], resolvers: ['192.0.2.1']},
    mqtt: {enabled: true, host: 'broker.lan', port: 1883, tls: false, ca: '', username: 'me', topicPrefix: 'vetro', deviceName: 'TV', hasPassword: true, password: 'hunter2', clientId: 'vetro-abc'},
    shards: {developer: false, list: [{id: 'clock', name: 'Clock', version: '1.0', enabled: true, bundled: false}, {id: 'launcher', bundled: true, enabled: true}]}};

// 1. What goes into the file
const file = b.build(src), text = JSON.stringify(file);
assert.equal(file.format, 'vetro-settings'); assert.equal(file.schemaVersion, 1); assert.deepEqual(file.notRead, {});
['autorunWas', 'customHomeDisabled', 'secret.row', 'autoupdatePrevious', 'ledger.app', 'firmwareBoot', 'owned', 'hunter2', 'password"', 'clientId', 'vetro-abc', 'resolvers', '192.0.2.1', 'buildPid', 'lastCards']
    .forEach(s => assert.ok(!text.includes(s), 'not in the file: ' + s));
assert.equal(file.sections.mqtt.hadPassword, true, 'only whether a password has to be typed again');
assert.deepEqual(file.sections.launcher.cards, ['tasks', 'shard:clock']); assert.equal(file.sections.launcher.mode, 'vetro');
assert.deepEqual(file.sections.essentials, {wins: {firmware: true, quickboot: false, multiscreen: false, ambient: true, telemetry: false, airplay: false, remotesupport: false, delivery: false, wifipresence: false}, keyGuides: true, hbbtvOff: true});
assert.deepEqual(file.sections.shards.list.map(p => p.id), ['clock'], 'bundled Shards are part of Vetro, not of the file');
// A shortcut for an input of the Odyssey OLED G8 (#314) is an ordinary Remapper rule: it is saved, read again, and the service accepts it.
const g8Rule = {id: 'physical_615', enabled: true, trigger: {type: 'physical', value: '615'}, actions: [{type: 'key', key: 'KEY_INPUT_41'}]};
const g8File = b.parse(JSON.stringify(b.build(Object.assign({}, src, {rules: [g8Rule]}))));
assert.deepEqual(g8File.sections.remapper.rules, [g8Rule]);
assert.deepEqual(require('../service/remap.js').validateRules(g8File.sections.remapper.rules)[0].actions, g8Rule.actions);
// A "Turn off screen" shortcut is saved and read back like any other rule, and the service accepts it.
const offRule = {id: 'physical_116', enabled: true, trigger: {type: 'physical', value: '116'}, actions: [{type: 'screenoff'}]};
const offFile = b.parse(JSON.stringify(b.build(Object.assign({}, src, {rules: [offRule]}))));
assert.deepEqual(offFile.sections.remapper.rules, [offRule]);
assert.deepEqual(require('../service/remap.js').validateRules(offFile.sections.remapper.rules)[0].actions, [{type: 'screenoff'}]);
const noRoot = b.build(Object.assign({}, src, {root: false, quickOff: undefined, dns: undefined}));
assert.deepEqual(noRoot.notRead, {quickSettings: 'needs-root', dns: 'needs-root'});

// 2. Reading a file
assert.throws(() => b.parse('{'), /not valid JSON/);
assert.throws(() => b.parse('x'.repeat(b.MAX_BYTES + 1)), /larger than 256 KB/);
assert.throws(() => b.parse({format: 'vetro-diagnostics', schemaVersion: 1}), /not a Vetro settings file/);
assert.throws(() => b.parse(Object.assign({}, file, {schemaVersion: 2})), /newer Vetro/);
assert.throws(() => b.parse(Object.assign({}, file, {schemaVersion: '1'})), /no valid version/);
const odd = b.parse(Object.assign({}, file, {sections: Object.assign({}, file.sections, {tuner: {enabled: 'yes'}, launcher: Object.assign({}, file.sections.launcher, {cards: ['rm -rf']}), future: {x: 1}})}));
assert.deepEqual(odd.dropped.sort(), ['launcher', 'tuner']); assert.ok(!('future' in odd.sections), 'an unknown section is ignored');
const lowUi = b.parse(Object.assign({}, file, {sections: Object.assign({}, file.sections, {launcher: Object.assign({}, file.sections.launcher, {uiBrightness: 10})})}));
assert.deepEqual(lowUi.dropped, ['launcher'], 'uiBrightness below 20 is rejected');

// 3. The same TV: nothing to change
const curOf = (s, extra) => Object.assign({sections: b.build(s).sections, root: s.root, shards: {clock: {enabled: true}},
    quick: {alexa: 'off', tvplus: 'off', 'samsung-home': 'on', gone: 'unavailable'}, quickLabels: {alexa: 'Alexa', tvplus: 'Samsung TV Plus'}, hbbtvValue: 0}, extra);
const same = b.plan(b.parse(text), curOf(src));
assert.equal(same.steps.length, 0); assert.equal(same.blocked.length + same.skipped.length, 0); assert.equal(same.same.length, b.SECTIONS.length);

// 4. A fresh TV (defaults, Shard not installed yet), with root
const fresh = {appVersion: '0.7.1', root: true, dock: {enabled: false, closeIdleHome: true, volumeEdge: 'left', appStore: 'tvstore', cards: []}, tuner: {enabled: false}, rules: [],
    wins: {}, multiscreen: true, keyGuides: false, perf: {on: true, keepOpen: []}, keepRemoved: true, quickOff: [], dns: {enabled: false, domains: []},
    mqtt: {enabled: false, host: '', port: 1883, tls: false, ca: '', username: '', topicPrefix: 'vetro', deviceName: '', hasPassword: false}, shards: {developer: false, list: []}};
const withSamsungHome = JSON.parse(text); withSamsungHome.sections.quickSettings.off.push('samsung-home', 'gone', 'renamed');
const p = b.plan(b.parse(withSamsungHome), curOf(fresh, {shards: {}, quick: {alexa: 'on', tvplus: 'partial', 'samsung-home': 'on', gone: 'unavailable'}}));
const at = label => p.steps.findIndex(s => s.label === label);
assert.equal(p.steps[0].label, 'Extra performance mode off', 'turning Performance mode off comes first: it undoes what it turned on');
assert.ok(at('Reduce motion on') < at('Turn on the Vetro launcher'), 'switches before the launcher starts with them');
assert.ok(at('Dim UI in HDR on') < at('Turn on the Vetro launcher'), 'HDR dim switch before launcher starts');
assert.ok(at('HDR overlay brightness: 30%') < at('Turn on the Vetro launcher'), 'HDR brightness before launcher starts');
assert.ok(at('UI overlay brightness: 80%') < at('Turn on the Vetro launcher'), 'UI brightness before launcher starts');
assert.ok(at('Turn on Vetro TV Tuner') > at('Turn on the Vetro launcher'));
assert.deepEqual(p.steps.filter(s => s.section === 'quickSettings').map(s => [s.body.id, s.confirm]), [['alexa', true], ['tvplus', true]], 'partial groups are switched off again, each needs the confirmation');
assert.ok(!p.steps.some(s => s.path === '/quick' && s.body.off !== true), 'loading never switches a group back on');
const reasons = Object.fromEntries(p.skipped.map(s => [s.label, s.reason]));
assert.match(reasons['samsung-home'], /yourself/); assert.match(reasons.gone, /Not installed/); assert.match(reasons.renamed, /Not a Quick settings group/);
assert.match(reasons.Clock, /Not installed/); assert.match(reasons['Control center cards'], /clock/);
assert.match(reasons['MQTT password'], /type it again/);
const mqtt = p.steps.find(s => s.path === '/mqtt'); assert.ok(!('password' in mqtt.body) && !('clientId' in mqtt.body), 'the TV keeps its own password and client id');
assert.deepEqual(p.steps.find(s => s.path === '/hbbtv').body, {off: true, expected: 0}, 'HbbTV carries the value it expects to change');
assert.deepEqual(p.steps.find(s => s.label === 'Disable Multi View autostart off').body, {id: 'multiscreen', on: false});
assert.ok(p.steps.every(s => ['/plugins/clock/enable', '/mqtt', '/remap', '/dock', '/tuner', '/wins', '/hbbtv', '/quick', '/dns', '/keep-removed', '/performance'].indexOf(s.path) >= 0));

// The two launchers exclude each other: the one that is on is turned off first
const toCustom = JSON.parse(text); Object.assign(toCustom.sections.launcher, {mode: 'custom', customApp: 'org.example.home'});
const swap = b.plan(b.parse(toCustom), curOf(src)).steps.filter(s => s.path === '/dock' && /able/.test(s.body.action)).map(s => s.body.action);
assert.deepEqual(swap, ['disable', 'enableCustom']);
const backToVetro = b.plan(b.parse(text), curOf(Object.assign({}, src, {dock: Object.assign({}, dock, {customApp: 'org.example.home'})}))).steps.filter(s => s.path === '/dock' && /able/.test(s.body.action)).map(s => s.body.action);
assert.deepEqual(backToVetro, ['disableCustom', 'enable']);

// 5. Without root: what needs it is blocked, the rest still loads
const q = b.plan(b.parse(text), Object.assign(curOf(Object.assign({}, fresh, {root: false, quickOff: undefined, dns: undefined, multiscreen: undefined})), {root: false, hbbtvValue: null}));
assert.ok(q.steps.length && q.steps.every(s => !s.root));
['Turn on the Vetro launcher', 'Block firmware and software updates on', 'HbbTV off', 'Quick settings', 'DNS blocking', 'Disable Multi View autostart off', 'HDMI sources on Home on']
    .forEach(l => assert.ok(q.blocked.some(x => x.label === l), 'blocked without root: ' + l));
assert.ok(q.steps.some(s => s.path === '/remap') && q.steps.some(s => s.path === '/mqtt') && q.steps.some(s => s.label === 'Fix TizenTube on'));

// 6. The routes (service harness: no root agent, empty files)
const {router} = require('./service-harness.cjs')(path.resolve(__dirname, '..'));
function call(method, url, body) {
    return new Promise(resolve => { const r = new EventEmitter(); r.method = method; r.url = url; r.headers = {}; let status;
        router(r, {setHeader() {}, writeHead(n) { status = n; }, end(data) { resolve({status, body: JSON.parse(data)}); }});
        if (body !== undefined) { r.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))); r.emit('end'); } });
}
(async () => {
    const saved = await call('GET', '/settings-file');
    assert.equal(saved.status, 200); assert.equal(saved.body.format, 'vetro-settings'); assert.equal(saved.body.notRead.quickSettings, 'needs-root');
    assert.equal((await call('POST', '/settings-file', {})).status, 405);
    const bad = await call('POST', '/settings-file/plan', {file: {format: 'nope'}});
    assert.equal(bad.status, 400); assert.match(bad.body.error, /not a Vetro settings file/);
    const planned = await call('POST', '/settings-file/plan', {file: JSON.parse(text)});
    assert.equal(planned.status, 200); assert.ok(Array.isArray(planned.body.steps)); assert.equal(planned.body.root, false);
    assert.ok(planned.body.blocked.some(x => x.section === 'quickSettings'));
    console.log('PASS settings file: choices only, no ledger or secret, file checks, safe order, blocked without root, routes');
})().catch(e => { console.error(e); process.exitCode = 1; });
