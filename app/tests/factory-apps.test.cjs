'use strict';
// #135: AgingApp (the factory colour test) opened from the Task manager left db/FactoryApp/Aging at 1; the TV then
// started the test at every boot. Factory, hotel and shop apps are blocked or need a confirmation, and Vetro can put
// the key back to 0, only when it reads exactly 1.
const assert = require('assert').strict;
const path = require('path'), EventEmitter = require('events');
const factory = require('../service/factory-apps.js');
const remap = require('../service/remap.js');
const availability = require('../service/component-actions.js').availability;
const {Restore} = require('../service/restore.js');

// Levels. The IDs are the "Not used at home" apps that could be opened on the TV of #135 (M7, fw 1311.1).
['org.tizen.AgingApp', 'org.tizen.factory', 'org.tizen.ep-hotel-factory'].forEach(id => assert.equal(factory.risk(id, id), 'blocked', id));
assert.equal(factory.risk('org.tizen.some-ui', 'org.tizen.factory'), 'blocked', 'any app of the service menu package');
['com.samsung.ep.coba.hotel', 'com.samsung.ep.hotel-popup', 'com.samsung.hitcomp', 'com.samsung.tv.demo-player', 'ep-hotel-protocol', 'ep-log-manager',
    'org.tizen.UsbSyncDisplay', 'org.tizen.UsbSyncDisplay.gui', 'org.tizen.UsbSyncDisplay.keygrab', 'org.tizen.automation-alert', 'org.tizen.automation-app',
    'org.tizen.automation-viewer', 'org.tizen.cloning', 'org.tizen.ep-hotel-channel', 'org.tizen.ep-hotel-channellist', 'org.tizen.ep-hotel-popup-ui',
    'org.tizen.ep-system-manager', 'org.tizen.factory-analysis-viewer', 'org.tizen.rscm-gui', 'org.tizen.rscm-screensaver', 'org.tizen.rscm-syncplayer',
    'test-oqc-tv-QR_code'].forEach(id => assert.equal(factory.risk(id, id), 'confirm', id));
// Everyday apps, the Device Care tests the TV itself offers, and store apps whose name happens to say hotel or factory.
['org.tizen.netflix-app', 'com.samsung.tv.cobalt', 'org.tizen.picture-test', 'org.tizen.sound-test', 'com.samsung.video-test', 'org.tizen.menu',
    'org.tizen.tv-viewer', 'vetrotvapp.app', 'Ab12Cd34Ef.hotelfinder', 'Ab12Cd34Ef.factorygame', '3201606009684', 'com.samsung.tv.coba.setting']
    .forEach(id => assert.equal(factory.risk(id, id), null, id));
assert.equal(factory.risk('Ab12Cd34Ef.AgingApp', 'Ab12Cd34Ef'), 'blocked', 'the blocked list wins over the store rule');

// Task manager button: blocked apps are refused with a reason; others keep their usual rules.
const row = (id, extra) => Object.assign({appId: id, packageId: id, show: true, disabled: false, system: true}, extra, {launchRisk: factory.risk(id, id)});
assert.match(availability(row('org.tizen.AgingApp'), [], []).launch.reason, /Factory test or service menu/);
assert.equal(availability(row('org.tizen.cloning'), [], []).launch.allowed, true, 'confirmed in the dashboard and by the service');
assert.equal(availability(row('org.tizen.netflix-app'), [], []).launch.allowed, true);
// The inventory rows carry the level (apps.js describe).
assert.equal(require('../service/apps.js').normalize([{id: 'org.tizen.AgingApp', packageId: 'org.tizen.AgingApp'}], [])[0].launchRisk, 'blocked');

// Rules: no factory, hotel or shop app, whatever the trigger.
const rule = (id, type) => ({id: 'r', trigger: {type: type || 'physical', value: type === 'mqtt' ? 'tv/open' : '497'}, actions: [{type: 'launch', appId: id}]});
assert.throws(() => remap.checkLaunchable(remap.validateRules([rule('org.tizen.AgingApp')])), /factory test or service menu/);
assert.throws(() => remap.checkLaunchable(remap.validateRules([rule('org.tizen.cloning', 'mqtt')])), /rules cannot open it/);
assert.throws(() => remap.checkLaunchable(remap.validateRules([rule('test-oqc-tv-QR_code', 'http')])), /rules cannot open it/);
assert.throws(() => remap.checkLaunchable(remap.validateRules([rule('org.tizen.menu-ui')]), () => 'org.tizen.factory'), /factory test or service menu/, 'the package ID counts when known');
assert.equal(remap.checkLaunchable(remap.validateRules([rule('org.tizen.netflix-app')])).length, 1);

// The Aging key
assert.deepEqual(factory.parse('db/FactoryApp/Aging, value = 1 (Int32)'), {present: true, value: 1, type: 'Int32'});
assert.deepEqual(factory.parse('db/FactoryApp/Aging, value = 0 (int)'), {present: true, value: 0, type: 'int'});
assert.deepEqual(factory.parse('vconftool get: Error! key does not exist'), {present: false, value: null, type: null});
assert.equal(factory.active(factory.parse('db/FactoryApp/Aging, value = 1 (Int32)')), true);
assert.equal(factory.active(factory.parse('db/FactoryApp/Aging, value = 1 (Bool)')), false, 'not an integer: not ours to write');
assert.equal(factory.active(factory.parse('db/FactoryApp/Aging, value = 2 (Int32)')), false, 'only exactly 1');

// A simulated TV: vconftool get/set on one key. No real TV is touched by these tests.
function fakeTv(start) {
    const tv = {value: start, type: 'Int32', commands: [], failWrite: false, keepValue: false};
    tv.execute = cmd => {
        tv.commands.push(cmd);
        if (cmd === 'vconftool get db/FactoryApp/Aging 2>&1') return Promise.resolve(tv.value === undefined ? {exit_code: 1, stdout: 'vconftool get: Error! key does not exist\n'} : {exit_code: 0, stdout: 'db/FactoryApp/Aging, value = ' + tv.value + ' (' + tv.type + ')\n'});
        if (cmd === 'vconftool set -f -t int db/FactoryApp/Aging 0') { if (tv.failWrite) return Promise.resolve({exit_code: 1, stderr: 'permission denied'}); if (!tv.keepValue) tv.value = 0; return Promise.resolve({exit_code: 0, stdout: ''}); }
        return Promise.resolve({exit_code: 0, stdout: ''});
    };
    return tv;
}
const WRITE = 'vconftool set -f -t int db/FactoryApp/Aging 0';

(async () => {
    let tv = fakeTv(1), test = new factory.FactoryTest(tv.execute), r = await test.reset();
    assert.equal(r.changed, true);assert.equal(r.before.value, 1);assert.equal(r.after.value, 0);assert.match(r.message, /Restart the TV/);
    assert.deepEqual(tv.commands, ['vconftool get db/FactoryApp/Aging 2>&1', WRITE, 'vconftool get db/FactoryApp/Aging 2>&1'], 'read, write 0, read again');

    tv = fakeTv(0); r = await new factory.FactoryTest(tv.execute).reset();
    assert.equal(r.changed, false);assert.ok(!tv.commands.includes(WRITE), 'already 0: nothing written');
    tv = fakeTv(undefined); r = await new factory.FactoryTest(tv.execute).reset();
    assert.equal(r.changed, false);assert.match(r.message, /does not exist/);assert.ok(!tv.commands.includes(WRITE), 'missing key: never created');
    tv = fakeTv(2); r = await new factory.FactoryTest(tv.execute).reset();
    assert.ok(!tv.commands.includes(WRITE), 'a value other than 1 is left alone');
    tv = fakeTv(1); tv.type = 'Bool'; await new factory.FactoryTest(tv.execute).reset();
    assert.ok(!tv.commands.includes(WRITE), 'another type is left alone');
    tv = fakeTv(1); tv.failWrite = true;
    await assert.rejects(new factory.FactoryTest(tv.execute).reset(), /permission denied/);
    tv = fakeTv(1); tv.keepValue = true;
    await assert.rejects(new factory.FactoryTest(tv.execute).reset(), /did not read back as 0/);
    await assert.rejects(new factory.FactoryTest(() => Promise.reject(new Error('TV platform adapter unavailable'))).read(), /adapter unavailable/);

    // Restore the TV: an item only when the key reads 1; the step writes 0.
    const restoreDeps = ft => ({invalidate() {}, inventory: () => Promise.resolve({apps: [], registryError: null}), execute: () => Promise.resolve({exit_code: 0, stdout: ''}),
        dock: {readState: () => ({enabled: false})}, plugins: {list: () => []}, input: {active: () => false}, mqtt: {enabled: () => false},
        wins: {load: () => ({}), read: () => Promise.resolve({wins: {}})}, hbbtv: {read: () => Promise.resolve({value: 20, off: false, valueOff: false, flag: false, serviceRunning: true, canRestore: false})},
        dns: {status: () => Promise.resolve({enabled: false, applied: false, domains: []})}, homeOrder: {}, factoryTest: ft});
    tv = fakeTv(1);
    const restore = new Restore(restoreDeps(new factory.FactoryTest(tv.execute)));
    let plan = await restore.publicPlan(), item = plan.items.find(i => i.id === 'factory-test');
    assert.equal(item.state, 'changed');assert.equal(plan.pending, 1);
    const run = await restore.run();
    assert.equal(run.steps.find(s => s.id === 'factory-test').status, 'done');assert.equal(tv.value, 0);assert.ok(!run.remaining.includes('factory-test'), 'read back clean after the step');
    plan = await new Restore(restoreDeps(new factory.FactoryTest(fakeTv(undefined).execute))).publicPlan();
    assert.equal(plan.items.find(i => i.id === 'factory-test').state, 'clean', 'no key on this model: nothing to do');

    // Through the service.
    const platform = require('../service/platform.js'), sent = [];
    let aging = 1;
    platform.execute = c => {
        sent.push(c);
        if (c === 'vconftool get db/FactoryApp/Aging 2>&1') return Promise.resolve({exit_code: 0, stdout: 'db/FactoryApp/Aging, value = ' + aging + ' (Int32)\n'});
        if (c === WRITE) { aging = 0; return Promise.resolve({exit_code: 0, stdout: ''}); }
        if (c.indexOf('sqlite3') >= 0) return Promise.resolve({exit_code: 1, stdout: '', stderr: 'no registry in this test'});
        return Promise.resolve({exit_code: 0, stdout: ''});
    };
    const {context, router} = require('./service-harness.cjs')(path.resolve(__dirname, '..'));
    // No registry: the inventory falls back to the widget's list.
    context.state.apps = ['org.tizen.AgingApp', 'org.tizen.cloning', 'org.tizen.netflix-app'].map(id => ({id, packageId: id, show: true}));
    const call = (method, url, body) => new Promise(resolve => { const req = new EventEmitter(); req.method = method; req.url = url;
        const res = {writeHead(n) { this.status = n; }, setHeader() {}, end(s) { resolve({status: this.status || 200, data: JSON.parse(s)}); }};
        router(req, res); if (method === 'POST') { req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end'); } });
    const launches = () => sent.filter(c => c.indexOf('app_launcher -s') >= 0);

    let x = await call('POST', '/apps/launch', {appId: 'org.tizen.AgingApp', confirmed: true});
    assert.equal(x.status, 403);assert.match(x.data.error, /does not open it/);
    x = await call('POST', '/apps/launch', {appId: 'org.tizen.cloning'});
    assert.equal(x.status, 409);assert.equal(x.data.needsConfirmation, true);
    assert.deepEqual(launches(), [], 'nothing opened without a confirmation');
    x = await call('POST', '/apps/launch', {appId: 'org.tizen.cloning', confirmed: true});
    assert.equal(x.data.ok, true);
    x = await call('POST', '/apps/launch', {appId: 'org.tizen.netflix-app'});
    assert.equal(x.data.ok, true);
    assert.deepEqual(launches(), ['/usr/bin/app_launcher -s org.tizen.cloning', '/usr/bin/app_launcher -s org.tizen.netflix-app']);

    x = await call('POST', '/remap', {rules: [rule('org.tizen.cloning')]});
    assert.equal(x.status, 400);assert.match(x.data.error, /rules cannot open it/);
    sent.length = 0;
    const old = await context.runActions([{type: 'launch', appId: 'org.tizen.AgingApp'}, {type: 'launch', appId: 'org.tizen.cloning'}, {type: 'launch', appId: 'org.tizen.netflix-app'}]);
    assert.deepEqual(launches(), ['/usr/bin/app_launcher -s org.tizen.netflix-app'], 'a rule saved by 0.3.5 still runs, without the factory apps');
    assert.deepEqual(Array.from(old.skipped), ['launch:factory-app', 'launch:factory-app']);

    x = await call('GET', '/factory-test');
    assert.equal(x.data.active, true);assert.equal(x.data.value, 1);
    x = await call('POST', '/factory-test', {action: 'reset'});
    assert.equal(x.data.ok, true);assert.equal(x.data.changed, true);assert.equal(aging, 0);
    x = await call('POST', '/factory-test', {action: 'set', value: 1});
    assert.equal(x.status, 400, 'reset is the only action');
    assert.equal(aging, 0);
    // Stop now on AgingApp: the service stops it, then puts the key back to 0 (registry simulated). The process check fails
    // here (no process list in this test), and the key is put back all the same: the answer carries the result.
    aging = 1; sent.length = 0;
    const registry = {load: () => Promise.resolve({apps: [{appId: 'org.tizen.AgingApp', packageId: 'org.tizen.AgingApp', show: true, disabled: false, system: true}], summary: {total: 1}, source: 'package registry + public probe'}),
        fields: () => [], iconCommand: () => null};
    const second = require('./service-harness.cjs')(path.resolve(__dirname, '..'), {dependencies: {'./app-registry.js': registry}});
    const stop = await new Promise(resolve => { const req = new EventEmitter(); req.method = 'POST'; req.url = '/components/action';
        const res = {writeHead(n) { this.status = n; }, setHeader() {}, end(s) { resolve({status: this.status || 200, data: JSON.parse(s)}); }};
        second.router(req, res); req.emit('data', Buffer.from(JSON.stringify({action: 'stop', appId: 'org.tizen.AgingApp'}))); req.emit('end'); });
    assert.ok(sent.some(c => c.indexOf('base64') >= 0), 'the stop command was sent');
    assert.ok(stop.data.factoryTest, JSON.stringify(stop.data).slice(0, 400));assert.equal(stop.data.factoryTest.changed, true);assert.equal(aging, 0);
    assert.ok(sent.indexOf(WRITE) > 0, 'written after the stop');
    console.log('PASS factory apps: AgingApp and service menus blocked, hotel/shop/factory apps confirmed in the Task manager and refused in rules, Aging key 1 -> 0 only when it reads 1 (#135)');
})().catch(e => { console.error(e); process.exitCode = 1; });
