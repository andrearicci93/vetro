'use strict';
const assert = require('assert').strict;
const path = require('path');
const load = require('./provider-harness.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return {promise, resolve, reject};
}
function fixture() {
    const {context: c, provider} = load(path.resolve(__dirname, '..'));
    const connect = deferred(), exec = deferred(), timers = [];
    let callbacks;
    c.RootAgentServer = function (opts) {
        callbacks = opts;
        this.start = cb => cb(12345);
        this.close = () => {};
        this.log = [];
    };
    c.fs = {writeFileSync: () => {}};
    c.prepare = () => { c.state.prepared = true; c.state.preparedRuntime = '3.1'; };
    c.persist = () => {};
    c.setTimeout = (fn, ms) => { const timer = {fn, ms}; timers.push(timer); return timer; };
    c.clearTimeout = () => {};
    c.sdb = {connect: () => connect.promise, exec: () => exec.promise, close: () => {}};
    function authenticate() {
        callbacks.onConnect({identity: {pid: 100, uid: 0, gid: 0}, _socket: {destroy() {}}});
    }
    return {c, provider, connect, exec, timers, authenticate, disconnect: () => callbacks.onClose()};
}
const plain = v => JSON.parse(JSON.stringify(v));
(async function () {
    let f = fixture();
    assert.equal(f.provider.status().rooting.phase, 'stopped');
    f.provider.start(); await flush();
    assert.equal(f.provider.status().rooting.phase, 'sdb-handshake');
    f.connect.reject(Object.assign(Error('private error text'), {code: 'sdbClosed'}));
    await flush();
    assert.deepEqual(plain(f.provider.status().rooting), {
        backend: 'sdb-archive', phase: 'retrying', failure: {stage: 'sdb-handshake', code: 'sdbClosed'}
    });
    f.provider.stop();

    f = fixture(); f.provider.start(); await flush(); f.connect.resolve({}); await flush();
    assert.equal(f.provider.status().rooting.phase, 'launch-command');
    f.exec.resolve('archive output'); await flush();
    assert.equal(f.provider.status().rooting.phase, 'agent-callback');
    assert.equal(f.provider.status().agent.connected, false, 'command completion does not prove root');
    f.timers.find(t => t.ms === 30000).fn(); await flush();
    assert.deepEqual(plain(f.provider.status().rooting.failure), {stage: 'agent-callback', code: 'agent-timeout'});
    f.authenticate();
    assert.equal(f.provider.status().rooting.phase, 'connected');
    assert.equal(f.provider.status().rooting.failure, null);
    f.disconnect();
    assert.equal(f.provider.status().rooting.phase, 'retrying');
    assert.equal(f.provider.status().rooting.failure.code, 'agent-disconnected');
    f.provider.stop();
    f.disconnect();
    assert.equal(f.provider.status().rooting.phase, 'stopped');

    f = fixture(); f.provider.start(); await flush(); f.connect.resolve({}); await flush();
    f.exec.reject(Object.assign(Error('stream reset'), {code: 'sdbStreamError'})); await flush();
    assert.deepEqual(plain(f.provider.status().rooting.failure), {stage: 'launch-command', code: 'sdbStreamError'});
    f.timers.find(t => t.ms === 30000).fn(); await flush();
    assert.equal(f.provider.status().rooting.failure.code, 'sdbStreamError', 'callback timeout retains the specific stream failure');
    f.provider.stop();

    // Late stream/handshake completion must not change connected/stopped state.
    f = fixture(); f.provider.start(); await flush(); f.connect.resolve({}); await flush();
    f.authenticate(); f.exec.reject(Object.assign(Error('closed during release'), {code: 'sdbClosed'})); await flush();
    assert.equal(f.provider.status().rooting.phase, 'connected');
    assert.equal(f.provider.status().rooting.failure, null);
    f.provider.stop();
    f = fixture(); f.provider.start(); await flush(); f.provider.stop();
    f.connect.reject(Error('late failure')); await flush();
    assert.equal(f.provider.status().rooting.phase, 'stopped');
    assert.equal(f.timers.length, 0);

    f = fixture(); f.provider.start(); await flush(); f.authenticate();
    f.c.sdb.exec = () => { throw Error('must not inject after authentication'); };
    f.connect.resolve({}); await flush();
    assert.equal(f.provider.status().rooting.phase, 'connected', 'late handshake cannot replace an authenticated state');
    assert.equal(f.provider.status().rooting.failure, null);
    f.provider.stop();

    // An earlier service generation can complete after a new start. It must
    // neither schedule another retry nor clear the new launch's in-flight flag.
    f = fixture(); f.provider.start(); await flush(); f.provider.stop();
    const oldConnect = f.connect;
    const nextConnect = deferred();
    f.c.sdb.connect = () => nextConnect.promise;
    f.provider.start(); await flush();
    oldConnect.reject(Object.assign(Error('old handshake closed'), {code: 'sdbClosed'})); await flush();
    assert.equal(f.c.launching, true);
    assert.equal(f.provider.status().rooting.phase, 'sdb-handshake');
    assert.equal(f.provider.status().rooting.failure, null);
    assert.equal(f.timers.length, 0);
    f.provider.stop(); nextConnect.resolve({}); await flush();

    f = fixture(); f.c.prepare = () => { throw Error('unwritable staging'); }; f.provider.start(); await flush();
    assert.equal(f.provider.status().rooting.phase, 'retrying');
    assert.equal(f.provider.status().rooting.failure.code, 'prepare-failed');
    f.provider.stop();
    f = fixture(); f.c.fs.writeFileSync = () => { throw Error('token unavailable'); }; f.provider.start(); await flush();
    assert.equal(f.provider.status().rooting.failure.code, 'token-write-failed');
    f.provider.stop();
    // A failed preflight never prepares or dispatches a launch. Retry remains
    // available at boot, while diagnostics retain the bounded failure.
    f = fixture();
    f.c.checkTarget = () => Promise.reject(Object.assign(Error('private probe output'), {code: 'runtime-unsupported'}));
    f.c.prepare = () => { throw Error('must not prepare'); };
    f.provider.start(); await flush();
    assert.deepEqual(plain(f.provider.status().rooting.failure), {stage: 'preflight', code: 'runtime-unsupported'});
    assert.equal(f.provider.status().rooting.phase, 'retrying');
    f.provider.stop();

    // Stopping while a probe is pending must prevent preparation and SDB.
    f = fixture(); const pending = deferred();
    f.c.checkTarget = () => pending.promise;
    f.c.prepare = () => { throw Error('must not prepare after stop'); };
    f.provider.start(); await flush(); f.provider.stop();
    pending.resolve({runtime: '6.0', source: 'detected'}); await flush();
    assert.equal(f.provider.status().rooting.phase, 'stopped');
    assert.equal(f.timers.length, 0);

    f = fixture(); let preparations = 0;
    f.c.prepare = () => { preparations++; f.c.state.prepared = true; f.c.state.preparedRuntime = '3.1'; };
    f.provider.start(); await flush(); f.provider.stop();
    f.provider.start(); await flush();
    assert.equal(preparations, 2, 'new lifecycle regenerates launch script for the current listener port');
    f.provider.stop();

    f = fixture(); f.provider.start(); await flush(); f.authenticate();
    f.connect.reject(Object.assign(Error('late rejection after authentication'), {code: 'sdbClosed'})); await flush();
    assert.equal(f.provider.status().rooting.phase, 'connected');
    assert.equal(f.provider.status().rooting.failure, null);
    f.provider.stop();

    console.log('PASS root diagnostics: preparation, handshake, launch, callback, recovery and stale async results');
})().catch(error => { console.error(error); process.exitCode = 1; });
