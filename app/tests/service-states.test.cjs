'use strict';
// Regression tests for the service-level state machines (app/docs/STATE-MACHINES.md, SM-5, SM-6, SM-10):
//  - a handler that throws before it has a promise answers 500 and releases the shared "app change" flag;
//  - two overlapping /input requests leave exactly one set of helpers, and the older one cannot cancel the newer;
//  - a failed remote action pauses interception for a while, not for good;
//  - the DNS filter is restored whenever the root agent shows up within the same five minutes as the other boot tasks.
const assert = require('assert').strict, path = require('path'), EventEmitter = require('events');
const load = require('./service-harness.cjs'), root = path.resolve(__dirname, '..');

function request(service, url, body, method) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter(); req.method = method || 'POST'; req.url = url; req.headers = {}; req.socket = {remoteAddress: '127.0.0.1'};
    const res = {writeHead(code) { this.code = code; }, setHeader() {}, end(s) { try { resolve({code: this.code, body: JSON.parse(s)}); } catch (e) { resolve({code: this.code, body: s}); } }};
    try { service.router(req, res); req.emit('data', Buffer.from(JSON.stringify(body || {}))); req.emit('end'); }
    catch (e) { reject(e); }
  });
}
const tick = ms => new Promise(r => setTimeout(r, ms || 0));

(async () => {
  // --- a synchronous throw in a handler --------------------------------------------------------------------------
  {
    let calls = 0;
    const service = load(root, {dependencies: {
      fs: {readFileSync: () => '', writeFileSync() {}},
      './platform.js': {start() {}, status: () => ({agent: {connected: true}}), execute: () => Promise.resolve({exit_code: 0, stdout: ''})},
      './quick-wins.js': {Wins: function () { this.apply = function () { if (calls++ === 0) throw new Error('disk full'); return Promise.resolve({ok: true}); }; this.boot = () => Promise.resolve(); this.read = () => Promise.resolve({}); this.remember = () => {}; }}
    }, setInterval: () => ({unref() {}})});
    const first = await request(service, '/wins', {id: 'ambient', on: true});
    assert.equal(first.code, 409, 'the failure is answered, the service stays up');
    assert.equal(first.body.ok, false);
    const second = await request(service, '/wins', {id: 'ambient', on: false});
    assert.equal(second.code, 200, 'the shared app-change flag was released: ' + JSON.stringify(second.body));
    console.log('PASS a handler that throws at once answers an error and releases the busy flag');
  }

  // --- a route that calls into code without any promise wrapper: readJsonBody itself is the last guard -----------
  {
    const service = load(root, {dependencies: {
      fs: {readFileSync: () => '', writeFileSync() {}},
      './platform.js': {start() {}, status: () => ({agent: {connected: true}}), execute: () => Promise.resolve({exit_code: 0, stdout: ''})},
      './menu-settings.js': {Catalog: function () { this.write = function () { throw new Error('menu catalog exploded'); }; }}
    }, setInterval: () => ({unref() {}})});
    const answer = await request(service, '/tv-menu', {id: 'x', value: 1});
    assert.equal(answer.code, 500, 'a throwing handler is answered with 500 instead of ending the process');
    assert.match(answer.body.error, /menu catalog exploded/);
    console.log('PASS an exception inside a POST handler answers 500 and does not escape');
  }

  // --- overlapping /input requests -------------------------------------------------------------------------------
  function inputService(startDelay) {
    const instances = [];
    class Bridge {
      constructor() { this.generation = 0; this.current = {mode: 'off', connected: false}; this.live = false; this.starts = 0; instances.push(this); }
      inventory() { return tick(5).then(() => [{name: 'Smart Control', node: '/dev/input/event4', unique: true, selectable: true}]); }
      status() { return {policy: this.current, events: []}; }
      stop() { ++this.generation; this.live = false; this.current = {mode: 'off', connected: false}; }
      start(device, mode) {
        const requested = this.generation;
        this.starts++;
        return this.inventory().then(() => {
          if (requested !== this.generation) throw new Error('input request cancelled');
          this.stop(); this.live = true; this.current = {mode, connected: true, device: 'Smart Control', node: '/dev/input/event4'};
          return this.status();
        });
      }
    }
    const timers = [];
    const service = load(root, {dependencies: {
      fs: {readFileSync: () => '', writeFileSync() {}},
      './physical-input.js': {Bridge},
      './platform.js': {start() {}, status: () => ({agent: {connected: true}}), execute: () => Promise.reject(new Error('TV is busy'))}
    }, setInterval: fn => { timers.push(fn); return {unref() {}}; }});
    service.instances = instances; service.timers = timers;
    return service;
  }
  {
    const service = inputService();
    const base = service.instances.length;
    const results = await Promise.all([
      request(service, '/input', {mode: 'observe', device: 'auto'}),
      request(service, '/input', {mode: 'observe', device: 'auto'})
    ]);
    const helpers = service.instances.slice(base);
    const live = helpers.filter(h => h.live).length;
    assert.equal(live, 1, 'one candidate remote, one helper: the older request must not leave its own running (' + live + ' live of ' + helpers.length + ')');
    assert(results.some(r => r.body.ok === true), 'the newest request succeeds');
    const replaced = results.filter(r => r.code === 409);
    assert.equal(replaced.length, 1, 'the older request is answered as replaced: ' + JSON.stringify(results.map(r => [r.code, r.body.error])));
    assert.equal(replaced[0].body.error, 'Replaced by a newer input request');
    console.log('PASS overlapping observe-all requests leave one set of helpers');
  }
  {
    const service = inputService();
    const results = await Promise.all([
      request(service, '/input', {mode: 'filter', device: '/dev/input/event4'}),
      request(service, '/input', {mode: 'filter', device: '/dev/input/event4'})
    ]);
    // no physical rule saved: both are refused the same way, so use observe-by-node instead, which starts a single helper
    assert(results.every(r => r.code !== undefined));
    const a = request(service, '/input', {mode: 'observe', device: '/dev/input/event4'});
    const b = request(service, '/input', {mode: 'observe', device: '/dev/input/event4'});
    const both = await Promise.all([a, b]);
    assert(both.some(r => r.body.ok === true), 'a double click must not cancel both starts: ' + JSON.stringify(both.map(r => r.body)));
    assert(both.some(r => r.code === 409 && r.body.error === 'Replaced by a newer input request'), 'the older start is answered as replaced: ' + JSON.stringify(both.map(r => [r.code, r.body.error])));
    assert.equal(service.context.physical.status().policy.connected, true, 'the helper of the newest request stays up');
    console.log('PASS the older of two overlapping starts cannot cancel the newer one');
  }

  // --- fault pause is temporary ----------------------------------------------------------------------------------
  {
    const remap = JSON.stringify({rules: [{id: 'r', enabled: true, trigger: {type: 'physical', value: '67'}, actions: [{type: 'launch', appId: 'example.app'}]}], input: {enabled: true, device: 'Smart Control', node: '/dev/input/event4'}});
    const starts = [];
    class Bridge {
      constructor(execute, onEvent) { this.onEvent = onEvent; this.current = {mode: 'off', connected: false}; }
      inventory() { return Promise.resolve([{name: 'Smart Control', node: '/dev/input/event4', unique: true, selectable: true}]); }
      status() { return {policy: this.current, events: []}; }
      stop() { this.current = {mode: 'off', connected: false}; }
      start(d, mode) { starts.push(mode); this.current = {mode, connected: true, device: 'Smart Control', node: '/dev/input/event4'}; return Promise.resolve(this.status()); }
    }
    const timers = [];
    const service = load(root, {dependencies: {
      fs: {readFileSync: p => p.endsWith('vetro-remap.json') ? remap : '', writeFileSync() {}},
      './physical-input.js': {Bridge},
      './platform.js': {start() {}, status: () => ({agent: {connected: true}}), execute: () => Promise.reject(new Error('TV is busy; try again in a few seconds'))}
    }, setInterval: fn => { timers.push(fn); return {unref() {}}; }});
    const run = async () => { timers.forEach(fn => fn()); await tick(5); };
    await run();
    assert.equal(starts.length, 1, 'saved interception starts');
    service.context.physical.onEvent({action: 'down', decision: 'blocked', code: 67});
    await service.context.actionQueue;
    assert.equal(service.context.physical.status().policy.connected, false, 'a failed action gives the keys back to the TV');
    await run();
    assert.equal(starts.length, 1, 'it stays released during the pause');
    service.context.inputFaultUntil = Date.now() - 1;
    await run();
    assert.equal(starts.length, 2, 'interception comes back by itself when the pause is over');
    console.log('PASS a failed remote action pauses interception for a while, not for good');
  }

  // --- a forgotten "listening" pause ends -------------------------------------------------------------------------
  {
    const remap = JSON.stringify({rules: [{id: 'r', enabled: true, trigger: {type: 'physical', value: '67'}, actions: [{type: 'launch', appId: 'example.app'}]}], input: {enabled: true, device: 'Smart Control', node: '/dev/input/event4'}});
    const starts = [];
    class Bridge {
      constructor(execute, onEvent) { this.current = {mode: 'off', connected: false}; }
      inventory() { return Promise.resolve([{name: 'Smart Control', node: '/dev/input/event4', unique: true, selectable: true}]); }
      status() { return {policy: this.current, events: []}; }
      stop() { this.current = {mode: 'off', connected: false}; }
      start(d, mode) { starts.push(mode); this.current = {mode, connected: true, device: 'Smart Control', node: '/dev/input/event4'}; return Promise.resolve(this.status()); }
    }
    const timers = [];
    const service = load(root, {dependencies: {
      fs: {readFileSync: p => p.endsWith('vetro-remap.json') ? remap : '', writeFileSync() {}},
      './physical-input.js': {Bridge},
      './platform.js': {start() {}, status: () => ({agent: {connected: true}}), execute: () => Promise.resolve({exit_code: 0, stdout: ''})}
    }, setInterval: fn => { timers.push(fn); return {unref() {}}; }});
    const run = async () => { timers.forEach(fn => fn()); await tick(5); };
    await run();
    assert.equal(starts.length, 1);
    // The user pressed "Start listening", then closed the page: interception was stopped and nothing will ever resume it.
    service.context.physical.stop();
    service.context.inputPaused = true;
    await run();
    assert.equal(starts.length, 1, 'a recent listening session keeps interception paused');
    service.context.inputSeenAt = Date.now() - 10 * 60 * 1000;
    await run();
    assert.equal(starts.length, 2, 'nobody asked about the input for minutes: the saved shortcuts work again');
    assert.equal(service.context.inputPaused, false);
    console.log('PASS a listening session that nobody ends stops pausing interception');
  }

  // --- DNS restore keeps trying while the agent may still come up ------------------------------------------------
  {
    let connected = false, restores = 0;
    const timers = [];
    const service = load(root, {dependencies: {
      fs: {readFileSync: () => '', writeFileSync() {}},
      './local-dns.js': {Filter: function () { this.restore = () => { restores++; return Promise.resolve({enabled: true, applied: true}); }; this.status = () => Promise.resolve({}); }},
      './platform.js': {start() {}, status: () => ({agent: {connected}}), execute: () => Promise.resolve({exit_code: 0, stdout: ''})}
    }, setInterval: fn => { timers.push(fn); return {unref() {}}; }});
    for (let i = 0; i < 40; i++) timers.forEach(fn => fn());   // 40 rounds of 5 s: more than three minutes without the agent
    connected = true;
    timers.forEach(fn => fn());
    await tick(5);
    assert.equal(restores, 1, 'the saved DNS filter is restored when the agent arrives late');
    console.log('PASS the DNS filter is restored when the root agent connects late');
  }
})().catch(e => { console.error(e); process.exit(1); });
