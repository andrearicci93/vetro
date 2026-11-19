'use strict';
// The keys Vetro UI holds (the Remapper's locked rows: Vol+, Vol-, Mute, 123) against the user's own shortcuts and the key routing of
// 2026-11-12: a held key always goes to the launcher's volume bar / osd 123 (or, with the launcher down, back to the TV by name), never to
// a shortcut on the same key and never through the tuner routing; the routing only touches the user's own key actions.
const assert = require('assert').strict, path = require('path'), EventEmitter = require('events');
const load = require('./service-harness.cjs'), root = path.resolve(__dirname, '..');
const vk = require('../service/volume-keys.js');
let disk = JSON.stringify({rules: [
    {id: 'vol', enabled: true, trigger: {type: 'physical', value: '68'}, actions: [{type: 'launch', appId: 'example.vol'}]},
    {id: 'pad', enabled: true, trigger: {type: 'physical', value: '140'}, actions: [{type: 'launch', appId: 'example.pad'}]},
    {id: 'ok', enabled: true, trigger: {type: 'physical', value: '106'}, actions: [{type: 'key', key: 'KEY_ENTER'}]}
]}), pending = null;
const commands = [];
class Bridge {
    constructor(execute, onEvent, hooks) { this.onEvent = onEvent; this.hooks = hooks; this.current = {mode: 'off', connected: false}; }
    inventory() { return Promise.resolve([]); }
    status() { return {policy: this.current, events: []}; }
    stop() { if (this.hooks && this.hooks.onStop) this.hooks.onStop(); }
    start() { return Promise.reject(new Error('not here')); }
}
const service = load(root, {dependencies: {
    fs: {readFileSync: p => p.endsWith('vetro-remap.json') ? disk : '', existsSync: () => false, writeFileSync: (p, s) => { pending = s; }, renameSync() { disk = pending; }, unlinkSync() {}},
    './physical-input.js': {Bridge},
    './platform.js': {start() {}, status: () => ({agent: {connected: true}}), execute: cmd => { commands.push(cmd); return Promise.resolve({exit_code: 0, stdout: ''}); }}
}, setInterval: () => ({unref() {}})});
service.context.dock.readState = () => ({enabled: true, volumePill: true, numberPad: true, customApp: null});
function request(method, url) {
    return new Promise(resolve => { const req = new EventEmitter(); req.method = method; req.url = url;
        service.router(req, {writeHead(code) { this.code = code; }, end(s) { resolve(JSON.parse(s)); }}); req.emit('end'); });
}
const settle = () => new Promise(r => setTimeout(r, 40));
(async () => {
    const remap = await request('GET', '/remap');
    assert.deepEqual(remap.reserved.map(k => k.code), ['68', '67', '66', '140'], 'the locked rows: Vol+, Vol-, Mute, 123');
    assert.equal(remap.rules.length, 3, 'never written into the user rules');
    const physical = service.context.physical;
    // The launcher's FIFO is not there (a computer, or the launcher down): the held key goes back to the TV by name, the shortcut does not run.
    physical.onEvent({code: 68, action: 'down', decision: 'blocked'}); physical.onEvent({code: 68, action: 'up', decision: 'blocked'}); await settle();
    physical.onEvent({code: 140, action: 'down', decision: 'blocked'}); physical.onEvent({code: 140, action: 'up', decision: 'blocked'}); await settle();
    assert.ok(commands.includes('/usr/bin/input_keyevent XF86AudioRaiseVolume'), 'Vol+ held for the volume bar, sent back by name with the launcher down');
    assert.ok(commands.includes('/usr/bin/input_keyevent XF86More'), '123 held for the osd 123, sent back as XF86More (its name on 6.0, 6.5 and 9) with the launcher down');
    assert.ok(!commands.some(c => /example\.(vol|pad)/.test(c)), 'a shortcut on a locked key does not run (Overridden by Vetro UI)');
    assert.ok(!commands.some(c => c.includes('vetro-tuner.ctl') && /XF86(AudioRaiseVolume|More)/.test(c)), 'held keys never go through the tuner routing');
    // A shortcut of the user's own on another key still runs, and its key action is the only thing the routing touches.
    physical.onEvent({code: 106, action: 'down', decision: 'blocked'}); await service.context.actionQueue; await settle();
    const ok = commands.find(c => c.includes('input_keyevent Return'));
    assert.ok(ok && ok.includes("( exec 3<>/tmp/vetro-tuner.ctl && echo 'key 28' >&3 ); else /usr/bin/input_keyevent Return; fi"), 'the user key action: to the tuner on screen, by name otherwise');
    // A stop of the bridge in the middle of a held Vol+ ends its repeat (no release will come).
    const before = commands.length;
    physical.onEvent({code: 67, action: 'down', decision: 'blocked'}); await settle();
    physical.stop();
    await new Promise(r => setTimeout(r, 700));             // past the 380 ms delay and several 90 ms steps
    const vdown = commands.slice(before).filter(c => c.endsWith('XF86AudioLowerVolume')).length;
    assert.equal(vdown, 1, 'one step, then the stopped bridge ended the repeat (' + vdown + ')');
    assert.equal(vk.reinjectCommand('XF86PowerOff'), null, 'only the four held keys can be sent back this way');
    console.log('PASS locked keys: Vetro UI\'s held keys win over shortcuts, go back to the TV by name when the launcher is down (123 too), never through the tuner routing; a bridge stop ends a held repeat');
})().catch(e => { console.error(e); process.exitCode = 1; });
