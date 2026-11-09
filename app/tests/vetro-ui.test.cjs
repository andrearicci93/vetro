'use strict';
// Vetro UI: the shared rules (which keys its parts hold, conflicts with the user's shortcuts, what a part still needs) and the
// service side: the remote interception is turned on by Vetro UI only when one of its parts is switched on, never by the restore
// loop, and a user's "off" stays off.
const assert = require('assert').strict, path = require('path'), EventEmitter = require('events');
const ui = require('../service/vetro-ui.js');
const load = require('./service-harness.cjs'), root = path.resolve(__dirname, '..');

// 1. Pure rules.
assert.equal(ui.launcherMode({enabled: true}), 'vetro', 'an old state with only enabled is the Vetro launcher');
assert.equal(ui.launcherMode({enabled: false, customApp: 'a.b'}), 'custom');
assert.equal(ui.launcherMode({mode: 'off', enabled: false}), 'off');
assert.equal(ui.launcherMode(null), 'off');
assert.deepEqual(ui.reservedKeys({enabled: true, volumePill: true}).map(k => k.code), ['68', '67', '66']);
assert.deepEqual(ui.reservedKeys({enabled: true, numberPad: true}).map(k => k.code), ['140']);
assert.equal(ui.reservedKeys({enabled: false, volumePill: true})[0].live, false, 'saved but not live while the launcher is off');
assert.equal(ui.reservedKeys({mode: 'custom', customApp: 'a.b', numberPad: true})[0].live, true, 'the headless launcher of custom mode draws them too');
assert.deepEqual(ui.reservedKeys({}), []);
const rules = [{id: 'a', enabled: true, trigger: {type: 'physical', value: '68'}, actions: []}, {id: 'b', enabled: false, trigger: {type: 'physical', value: '67'}, actions: []},
    {id: 'c', enabled: true, trigger: {type: 'mqtt', value: '68'}, actions: []}, {id: 'd', enabled: true, trigger: {type: 'physical', value: '140'}, actions: []}];
assert.deepEqual(ui.conflicts(rules, ui.keysOf('volume')).map(c => c.rule.id), ['a'], 'only enabled physical rules on the held keys');
assert.deepEqual(ui.conflicts(rules, ui.keysOf('pad')).map(c => c.rule.id), ['d']);
assert.deepEqual(ui.needs('volume', {enabled: false}, null), ['launcher'], 'input not read yet: only what is known');
assert.deepEqual(ui.needs('volume', {enabled: true}, {status: {preference: {enabled: false}, policy: {mode: 'off'}}}), ['interception']);
assert.deepEqual(ui.needs('pad', {mode: 'custom', customApp: 'x'}, {status: {preference: {enabled: true}, policy: {mode: 'filter'}}}), []);
assert.deepEqual(ui.needs('tuner', {enabled: false}, null), []);
assert.doesNotMatch(ui.pageSource(), /`|\$\{/, 'safe to drop into the page template');
new Function(ui.pageSource());

// An older version's launcher state (no mode, no volumeEdge, no volume switches): it is the Vetro launcher, as before, and the file
// is only read. The launch line gets the default position.
{
    const fs = require('fs'), os = require('os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-ui-old-'));
    const file = path.join(tmp, 'vetro-dock.json'), old = JSON.stringify({enabled: true, since: 1700000000, fixTizenTube: true});
    fs.writeFileSync(file, old);
    const {Dock} = require('../service/dock.js');
    const d = new Dock({execute: async () => ({exit_code: 0, stdout: ''}), stateFile: file, dir: tmp, appsFile: path.join(tmp, 'apps.tsv')});
    const st = d.readState();
    assert.equal(ui.launcherMode(st), 'vetro', 'whoever had the launcher on finds it on');
    assert.equal(st.volumeEdge, 'left'); assert.equal(st.volumePill, false); assert.equal(st.fixTizenTube, true);
    assert.match(d.startScript(), / --volume-edge left/);
    assert.equal(fs.readFileSync(file, 'utf8'), old, 'reading never rewrites the old file');
    assert.deepEqual(ui.reservedKeys(st), [], 'no keys are taken from an old state');
    // The task manager (zabique's, PR #172) is opt-in: an old state starts the launcher without it, as before.
    assert.equal(st.taskManager, false); assert.match(d.startScript(), / --no-tasks/);
    fs.writeFileSync(file, JSON.stringify({enabled: true, taskManager: true}));
    assert.doesNotMatch(d.startScript(), /--no-tasks/, 'switched on: the launcher starts with it');
    fs.writeFileSync(file, JSON.stringify({enabled: false, customApp: 'org.example.app', taskManager: true}));
    assert.match(d.startScript(), / --no-tasks/, 'custom mode draws nothing of the dock');
}
// The switch: saved, and a running Vetro launcher is restarted with the new start line; a bad value is refused.
(async () => {
    const fs = require('fs'), os = require('os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-ui-tasks-'));
    const {Dock} = require('../service/dock.js');
    const d = new Dock({execute: async () => ({exit_code: 0, stdout: ''}), stateFile: path.join(tmp, 's.json'), dir: tmp, appsFile: path.join(tmp, 'apps.tsv')});
    let refreshed = 0;
    d.refresh = async () => { refreshed++; return {}; };
    d.status = async () => ({});
    await d.setTaskManager(true);
    assert.equal(d.readState().taskManager, true); assert.equal(refreshed, 0, 'launcher off: nothing to restart');
    d.patchState({enabled: true});
    await d.setTaskManager(false);
    assert.equal(d.readState().taskManager, false); assert.equal(refreshed, 1, 'launcher on: restarted');
    await assert.rejects(d.setTaskManager('yes'), /Invalid value/);
    d.refresh = async () => { throw new Error('restart failed'); };
    await assert.rejects(d.setTaskManager(true), /restart failed/);
    assert.equal(d.readState().taskManager, false, 'a failed restart puts the old value back');
})().catch(e => { console.error(e); process.exit(1); });
// Any caller that turns the launcher on or off (the TV tile, Restore the TV, the supervision), not only the dashboard route, tells the
// service, which restarts the bridge with the new keys; a failed call tells it too.
(async () => {
    const fs = require('fs'), os = require('os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-ui-hook-'));
    const {Dock} = require('../service/dock.js');
    let told = 0;
    const d = new Dock({execute: async () => ({exit_code: 0, stdout: ''}), stateFile: path.join(tmp, 's.json'), dir: tmp, appsFile: path.join(tmp, 'apps.tsv'),
        onVolumeChange: () => { told++; return Promise.resolve(); }, sleep: async () => {}});
    await d.disable().catch(() => {});
    assert.equal(told, 1, 'disable tells the service');
    d.execute = async () => { throw new Error('agent gone'); };
    await d.enable().catch(() => {});
    assert.equal(told, 2, 'a failed enable tells it too');
})().catch(e => { console.error(e); process.exit(1); });

// 2. Service.
let disk, dockState, remotes, pending = null;
const starts = [];
class Bridge {
    constructor(execute, onEvent) { this.onEvent = onEvent; this.current = {mode: 'off', connected: false}; }
    inventory() { return Promise.resolve(remotes); }
    status() { return {policy: this.current, events: []}; }
    stop() { this.current = {mode: 'off', connected: false}; }
    async start(device, mode, tokens) { starts.push({device, mode, tokens}); this.current = {mode, connected: true, device: 'Smart Control', node: device}; return this.status(); }
}
function boot() {
    const timers = [];
    const service = load(root, {dependencies: {
        fs: {readFileSync: p => p.endsWith('vetro-remap.json') ? disk : p.endsWith('vetro-dock.json') ? JSON.stringify(dockState) : '', existsSync: () => false,
            writeFileSync: (p, s) => { pending = s; }, renameSync() { disk = pending; }, unlinkSync() { pending = null; }},
        './physical-input.js': {Bridge},
        './platform.js': {start() {}, status: () => ({agent: {connected: true}}), execute: () => Promise.resolve({exit_code: 0, stdout: ''})}},
        setInterval: fn => { timers.push(fn); return {unref() {}}; }});
    service.context.dock.readState = () => Object.assign({enabled: false, volumePill: false, numberPad: false, customApp: null}, dockState);   // the dock module reads its own file with the real fs
    service.tick = async () => { timers.forEach(fn => fn()); await new Promise(r => setImmediate(r)); };
    return service;
}
function request(service, method, url, body) {
    return new Promise(resolve => {
        const req = new EventEmitter(); req.method = method; req.url = url;
        service.router(req, {writeHead(code) { this.code = code; }, end(s) { resolve(JSON.parse(s)); }});
        if (body) { req.emit('data', Buffer.from(JSON.stringify(body))); }
        req.emit('end');
    });
}

(async () => {
    // An update with the bar already on and no interception: nothing is started or rewritten by the restore loop.
    disk = JSON.stringify({rules: []}); dockState = {enabled: true, volumePill: true}; remotes = [{name: 'Smart Control', node: '/dev/input/event5', unique: true, selectable: true}];
    let service = boot();
    await service.tick(); await service.tick();
    assert.equal(starts.length, 0, 'after an update the restore loop does not turn the interception on by itself');
    assert.equal(JSON.parse(disk).input, undefined, 'and does not write the remote setting');

    // Switching a part on turns it on, with the held keys, and marks it as Vetro UI's own.
    const r1 = await service.context.vetroUiInput(); assert.equal(r1, true, String(service.context.vetroUiInputProblem) + " flags " + JSON.stringify(service.context.keyFlags()));
    assert.equal(starts.length, 1); assert.equal(starts[0].mode, 'filter'); assert.equal(starts[0].device, '/dev/input/event5');
    assert.deepEqual(Array.from(starts[0].tokens).sort(), ['66', '67', '68']);
    assert.deepEqual(JSON.parse(disk).input, {enabled: true, device: 'Smart Control', node: '/dev/input/event5', auto: true});
    let remap = await request(service, 'GET', '/remap');
    assert.deepEqual(remap.reserved.map(k => k.code), ['68', '67', '66']); assert.equal(remap.reserved[0].live, true);
    assert.equal(remap.interception.auto, true); assert.deepEqual(remap.rules, [], 'the held keys are never written into the rules');

    // The part goes off and no shortcut of the user's needs the interception: it goes off again.
    dockState = {enabled: true, volumePill: false};
    await service.context.vetroUiInput();
    assert.equal(JSON.parse(disk).input.enabled, false);

    // With a shortcut of the user's own it stays on.
    dockState = {enabled: true, numberPad: true};
    await service.context.vetroUiInput();
    await request(service, 'POST', '/remap', {rules: [{id: 'physical_4', enabled: true, trigger: {type: 'physical', value: '4'}, actions: [{type: 'launch', appId: 'example.app'}]}]});
    dockState = {enabled: true, numberPad: false};
    await service.context.vetroUiInput();
    assert.equal(JSON.parse(disk).input.enabled, true, 'a shortcut of the user still needs it');

    // The user turns the interception off: the restore loop leaves it off, and so does a later boot.
    dockState = {enabled: true, numberPad: true};
    await request(service, 'POST', '/input', {mode: 'off'});
    let count = starts.length;
    await service.tick(); await service.tick();
    service = boot(); await service.tick();
    assert.equal(starts.length, count, 'the user’s off stays off');

    // Two remotes: nothing is guessed, the page gets the reason.
    remotes = [{name: 'Smart Control', node: '/dev/input/event5', unique: true, selectable: true}, {name: 'RC Device', node: '/dev/input/event6', unique: true, selectable: true}];
    assert.equal(await service.context.vetroUiInput(), false);
    assert.equal(starts.length, count);
    remap = await request(service, 'GET', '/remap');
    assert.match(remap.interception.problem, /More than one remote/);
    console.log('PASS Vetro UI: held keys, conflicts, needs; interception on only on a switch, off again when Vetro UI started it, user off kept');
})().catch(e => { console.error(e); process.exit(1); });
