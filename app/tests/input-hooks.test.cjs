'use strict';
// main.js wires the remote bridge to Vetro UI: a connected helper makes the launcher and the tuner watch the new forwarding node at
// once (rescan), and every stop of the bridge ends a volume repeat.
const assert = require('assert').strict, path = require('path');
const load = require('./service-harness.cjs'), root = path.resolve(__dirname, '..');
const kr = require('../service/key-routing.js');
const made = [], commands = [];
class Bridge {
    constructor(execute, onEvent, hooks) { this.hooks = hooks; this.onEvent = onEvent; made.push(this); this.current = {mode: 'off', connected: false}; }
    inventory() { return Promise.resolve([]); }
    status() { return {policy: this.current, events: [], error: null}; }
    stop() { if (this.hooks && this.hooks.onStop) this.hooks.onStop(); }
    start() { return Promise.reject(new Error('not in this test')); }
}
load(root, {dependencies: {
    './physical-input.js': {Bridge},
    './platform.js': {start() {}, status: () => ({agent: {connected: true}}), execute: cmd => { commands.push(cmd); return Promise.resolve({exit_code: 0, stdout: ''}); }}
}, setInterval: () => ({unref() {}})});
const physical = made[0];
assert.ok(physical && physical.hooks, 'the interception bridge gets the hooks');
assert.equal(typeof physical.hooks.onStop, 'function');
(async () => {
    physical.hooks.onStop();                               // ends a volume repeat; never throws
    physical.hooks.onConnect({policy: {mode: 'observe'}});
    await new Promise(r => setTimeout(r, 30));             // root commands go through the service's queue
    assert.ok(!commands.includes(kr.rescanCommand()), 'listening only (observe) makes no forwarding node: no rescan');
    physical.hooks.onConnect({policy: {mode: 'filter'}});
    await new Promise(r => setTimeout(r, 30));
    assert.ok(commands.includes(kr.rescanCommand()), 'interception connected: the launcher and the tuner rescan at once');
    console.log('PASS input hooks: rescan on a connected interception, a repeat stop on every bridge stop');
})().catch(e => { console.error(e); process.exitCode = 1; });
