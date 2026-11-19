'use strict';
// The remote bridge's history for the diagnostics, and a failed "Intercept" from the Remapper: it used to leave the restore loop paused,
// with no error kept, until the Remapper had been closed for 5 minutes (S95C, preview12 export: enabled, not connected, no failure).
const assert = require('assert').strict, path = require('path'), EventEmitter = require('events');
const load = require('./service-harness.cjs'), root = path.resolve(__dirname, '..');
const report = require('../service/diagnostic-report.js');
let disk = JSON.stringify({rules: [{id: 'r', enabled: true, trigger: {type: 'physical', value: '67'}, actions: [{type: 'launch', appId: 'example.app'}]}],
    input: {enabled: true, device: 'Smart Control 2016', node: '/dev/input/event7'}});
const node = '/dev/input/event9', starts = [];
let failNext = null, bridge = null;
class Bridge {
    constructor(execute, onEvent, hooks) { this.onEvent = onEvent; this.hooks = hooks || {}; this.current = {mode: 'off', connected: false}; bridge = this; }
    inventory() { return Promise.resolve([{name: 'Smart Control 2016', node, unique: true, selectable: true}]); }
    status() { return {policy: this.current, events: [], error: null}; }
    stop(reason) { const was = this.current.connected; this.current = {mode: 'off', connected: false}; if (this.hooks.onStop) this.hooks.onStop(reason ? {reason, connected: was} : null); }
    async start(device, mode) {
        starts.push({device, mode});
        if (failNext) { const e = Error(failNext); failNext = null; throw e; }
        this.current = {mode, connected: true, device: 'Smart Control 2016', node};
        if (this.hooks.onConnect) this.hooks.onConnect(this.status());
        return this.status();
    }
}
const timers = [];
const service = load(root, {dependencies: {
    fs: {readFileSync: p => p.endsWith('vetro-remap.json') ? disk : '', writeFileSync: (p, s) => { disk = s; }, renameSync() {}, unlinkSync() {}},
    './physical-input.js': {Bridge},
    './platform.js': {start() {}, status: () => ({agent: {connected: true}}), execute: () => Promise.resolve({exit_code: 0, stdout: ''})}
}, setInterval: fn => { timers.push(fn); return {unref() {}}; }});
const tick = async () => { timers.forEach(fn => fn()); for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };
function post(body) {
    return new Promise(resolve => {
        const req = new EventEmitter(); req.method = 'POST'; req.url = '/input';
        service.router(req, {writeHead(code) { this.code = code; }, end(s) { resolve(JSON.parse(s)); }});
        req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end');
    });
}
const c = service.context;
const kinds = () => JSON.parse(JSON.stringify(c.inputHistory)).map(e => e.kind + (e.why ? ' ' + e.why : ''));

(async () => {
    await tick();
    assert.equal(c.physical.status().policy.connected, true, 'the saved interception is restored');
    // The helper goes away on its own: a "lost" turn, then the loop starts it again.
    bridge.stop('input helper disconnected; original keys released');
    await tick();
    assert.equal(c.physical.status().policy.connected, true, 'restored again after the loss');
    // A manual Intercept that fails.
    failNext = 'native input helper did not connect';
    const r = await post({device: node, mode: 'filter'});
    assert.equal(r.ok, false);
    assert.equal(c.inputPaused, false, 'a failed Intercept does not leave the restore loop paused');
    assert.equal(c.inputError, 'native input helper did not connect', 'its reason is kept for the diagnostics');
    const before = starts.length;
    await tick();
    assert.equal(starts.length, before + 1, 'the saved remote is tried again by the 5 s loop');
    assert.equal(c.physical.status().policy.connected, true);
    const h = kinds();
    ['restore', 'connected filter', 'lost input helper disconnected; original keys released', 'request filter', 'stop request', 'failed native input helper did not connect']
        .forEach(k => assert.ok(h.includes(k), 'history has "' + k + '": ' + h.join(' | ')));
    assert.ok(h.lastIndexOf('connected filter') > h.indexOf('failed native input helper did not connect'), 'and connects after the failure');
    // What the report keeps: fixed words, seconds ago, nothing else.
    const now = Date.now();
    const p = report.projectors.input({enabled: true, connected: false,
        history: c.inputHistory.map(e => ({secondsAgo: Math.round((now - e.at) / 1000), kind: e.kind, why: e.why}))
            .concat([{secondsAgo: 3, kind: 'lost', why: '/home/owner/secret'}, {secondsAgo: 2, kind: 'evil', why: 'x'}, {secondsAgo: -1, kind: 'restore'}]),
        loop: {paused: true, lifecycle: true, restoring: false, faultPauseSeconds: 0, retryWaitSeconds: 25, retryFailures: 12, tokenCount: 4, mode: 'filter', extra: 'x'},
        prevHelperLog: 'IOException: remote input device disconnected\n', helperLog: '', remoconSubtype: 'remocon subtype: no tool\n'});
    assert.equal(p.remoconSubtype, 'no-tool', 'the helper\'s Remocon line as a fixed word');
    assert.equal(report.projectors.input({remoconSubtype: 'remocon subtype: /etc/x'}).remoconSubtype, null);
    const events = p.history.map(e => e.event);
    assert.ok(events.includes('lost helper-disconnected') && events.includes('failed helper-did-not-connect') && events.includes('stop request') && events.includes('request filter'), events.join(' | '));
    assert.equal(events[events.length - 1], 'lost other', 'an unknown reason is "other"; an unknown kind and a negative age are dropped');
    assert.ok(JSON.stringify(p).indexOf('/home/') < 0);
    assert.equal(JSON.stringify(p.loop), JSON.stringify({paused: true, lifecycle: true, restoring: false, faultPauseSeconds: 0, retryWaitSeconds: 25, retryFailures: 12, tokenCount: 4, mode: 'filter'}));
    assert.equal(p.prevHelperError, 'IOException: remote input device disconnected');
    console.log('PASS input history: lost and restored helpers, a failed Intercept unpauses the loop and keeps its reason, the report keeps fixed words');
})().catch(e => { console.error(e); process.exitCode = 1; });
