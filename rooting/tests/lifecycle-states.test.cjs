'use strict';
// Regression tests for the root-agent lifecycle (design and bug list: app/docs/STATE-MACHINES.md, bugs B1 and B2).
//  - B2: the launching flag must not stay set when the agent connects while a launch attempt is still failing;
//  - B1: repeated launch failures (and callback timeouts) back off instead of retrying every 8 s forever;
//  - B1: the diagnostic log files stop growing at a fixed size.
// platform.js is loaded in a vm with its dependencies replaced (no sockets, no TV, no real files).
const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const policy = require('../service/retry-policy.js');
const root = path.resolve(__dirname, '..');

function load(overrides) {
    const timers = [];
    const files = {};
    const fakeFs = {
        readFileSync: function (p, enc) { if (files[p] != null) return files[p]; if (String(p).indexOf(root) === 0) return fs.readFileSync(p, enc); throw new Error('ENOENT'); },
        writeFileSync: function (p, d) { files[p] = String(d); },
        appendFileSync: function (p, d) { files[p] = (files[p] || '') + String(d); },
        statSync: function (p) { if (files[p] == null) throw new Error('ENOENT'); return {size: Buffer.byteLength(files[p])}; },
        mkdirSync: function () {}, readdirSync: function () { return []; }, existsSync: function () { return false; },
        unlinkSync: function () {}, symlinkSync: function () {}
    };
    let opts = null;
    const dependencies = Object.assign({
        fs: fakeFs,
        './root-preflight.js': {checkTarget: () => Promise.resolve({runtime: '3.1', source: 'detected'})},
        './root-preflight-capture.js': {createRunner: () => function () { return Promise.resolve(''); }},
        './sdb.js': {connect: () => new Promise(() => {}), close: () => {}, exec: () => new Promise(() => {})},
        './root-agent.js': {RootAgentServer: function (o) { opts = o; this.start = function (cb) { cb(4321); }; this.close = function () {}; this.log = []; }},
        './sdb-tunnel.js': {TunnelServer: function () { this.start = function (cb) { if (cb) cb(null, 26201); }; this.close = function () {}; }}
    }, overrides || {});
    const context = vm.createContext({module: {exports: {}},
        require: name => Object.prototype.hasOwnProperty.call(dependencies, name) ? dependencies[name]
            : name[0] === '.' ? require(path.join(root, 'service', name)) : require(name),
        __dirname: path.join(root, 'service'), Buffer, process, console,
        setTimeout: function (fn, ms) { const t = {fn, ms, cleared: false}; timers.push(t); return t; },
        clearTimeout: function (t) { if (t) t.cleared = true; }});
    vm.runInContext(fs.readFileSync(path.join(root, 'service/platform.js'), 'utf8'), context);
    return {context, provider: context.module.exports, timers, files, agentOptions: () => opts,
        sdb: dependencies['./sdb.js']};
}

function settle() { return new Promise(r => setImmediate(r)); }

(async function () {
    // --- pure policy -----------------------------------------------------------------------------------------
    assert.equal(policy.relaunchDelay(0), 8000);
    assert.equal(policy.relaunchDelay(1), 8000);
    assert.equal(policy.relaunchDelay(2), 16000);
    assert.equal(policy.relaunchDelay(3), 32000);
    assert.equal(policy.relaunchDelay(50), policy.MAX_MS, 'the delay stops growing at the ceiling');
    assert.equal(policy.callbackWait(0), 30000);
    assert.equal(policy.callbackWait(10), policy.MAX_MS);
    console.log('PASS retry delay doubles from 8 s up to a ceiling');

    // --- bounded log -----------------------------------------------------------------------------------------
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-log-'));
    const log = path.join(dir, 'vetro.jsonl');
    const line = JSON.stringify({attempts: new Array(40).fill({phase: 'launch', err: 'x'.repeat(100)})}) + '\n';
    for (let i = 0; i < 400; i++) policy.appendBounded(fs, log, line);
    const size = fs.statSync(log).size;
    assert(size <= policy.LOG_MAX_BYTES, 'log stays under the cap, got ' + size);
    const text = fs.readFileSync(log, 'utf8');
    assert(text.endsWith(line), 'the newest line is kept');
    assert(text.split('\n').filter(Boolean).every(l => { JSON.parse(l); return true; }), 'every kept line is whole');
    assert.equal(policy.appendBounded({statSync() { throw new Error('x'); }, appendFileSync() { throw new Error('disk full'); }}, '/nope', 'a\n'), false, 'a failing disk never throws');
    console.log('PASS the diagnostic log is bounded and keeps whole lines');

    // --- launching flag --------------------------------------------------------------------------------------
    {
        const t = load();
        let rejectConnect;
        Object.assign(t.sdb, {connect: () => new Promise((resolve, reject) => { rejectConnect = reject; }), close: () => {}, exec: () => new Promise(() => {})});
        t.provider.start();
        await settle();
        assert.equal(t.context.launching, true, 'a launch is waiting for the SDB handshake');
        // The agent of an earlier attempt connects while this handshake is still pending...
        t.context.agentConnected = true;
        // ...and the handshake then fails.
        const error = new Error('refused'); error.code = 'sdbRefused';
        rejectConnect(error);
        await settle();
        assert.equal(t.context.launching, false, 'launching must be released, or the agent is never relaunched after a later disconnect');
        console.log('PASS the launching flag is released when the agent connects during a failing handshake');
    }

    // --- agent connect releases a launch in progress ---------------------------------------------------------
    {
        const t = load();
        Object.assign(t.sdb, {connect: () => new Promise(() => {}), close: () => {}, exec: () => new Promise(() => {})});
        t.provider.start();
        await settle();
        assert.equal(t.context.launching, true);
        t.agentOptions().onConnect({identity: {pid: 1, uid: 0, gid: 0, cap_eff: '0', smack: ''}, _socket: {destroy() {}}});
        assert.equal(t.context.launching, false, 'a connected agent means the launch is over');
        console.log('PASS a connected agent ends the launch in progress');
    }

    // --- backoff ---------------------------------------------------------------------------------------------
    {
        const t = load();
        Object.assign(t.sdb, {connect: () => { const e = new Error('refused'); e.code = 'sdbRefused'; return Promise.reject(e); }, close: () => {}, exec: () => new Promise(() => {})});
        t.provider.start();
        const delays = [];
        for (let i = 0; i < 6; i++) {
            await settle(); await settle();
            const pending = t.timers.filter(x => !x.cleared && x.ms >= 8000 && !x.fired);
            const timer = pending[pending.length - 1];
            delays.push(timer.ms);
            timer.fired = true; timer.cleared = true;
            timer.fn();
        }
        assert.equal(delays[0], 8000);
        assert(delays[2] > delays[0] && delays[5] > delays[2], 'retries slow down while the same failure repeats: ' + delays.join(','));
        assert(delays[5] <= policy.MAX_MS);
        // Every failure writes the adapter state to disk: that writing is bounded too.
        const logged = Object.keys(t.files).filter(f => /vetro\.jsonl$/.test(f));
        assert(logged.length > 0);
        logged.forEach(f => assert(Buffer.byteLength(t.files[f]) <= policy.LOG_MAX_BYTES));
        console.log('PASS repeated launch failures back off (' + delays.join(' ms, ') + ' ms)');
    }

    // --- the TV screen cuts a backoff wait short --------------------------------------------------------------
    // After a few failures the next attempt can be minutes away; opening Vetro on the TV starts it at once, at most every 20 s,
    // never while a launch is running, and without forgetting the failures.
    {
        const t = load();
        let connects = 0, hang = false;
        Object.assign(t.sdb, {connect: () => { connects++; if (hang) return new Promise(() => {}); const e = new Error('refused'); e.code = 'sdbRefused'; return Promise.reject(e); }});
        t.provider.start();
        for (let i = 0; i < 3; i++) {
            await settle(); await settle();
            const timer = t.timers.filter(x => !x.cleared && !x.fired && x.ms >= 8000).pop();
            timer.fired = true; timer.cleared = true; timer.fn();
        }
        await settle(); await settle();
        const waiting = t.timers.filter(x => !x.cleared && !x.fired && x.ms >= 8000).pop();
        assert(waiting && waiting.ms > 8000, 'a backed-off relaunch is waiting');
        const failures = t.context.launchFailures, before = connects;
        hang = true;
        assert.equal(t.provider.retryNow(), true, 'a waiting relaunch starts now');
        await settle();
        assert.equal(connects, before + 1, 'one attempt, at once');
        assert.equal(waiting.cleared, true, 'the backoff timer is dropped');
        assert.equal(t.context.launchFailures, failures, 'the failure count is kept');
        assert.equal(t.provider.retryNow(), false, 'not while that launch runs');
        hang = false;
        assert.equal(t.provider.retryNow(), false, 'and not twice within 20 s');
        console.log('PASS the TV screen starts a waiting root launch at once, without resetting the backoff');
    }

    // --- a TV where the agent can never start: the files written by persist() stay bounded -------------------
    {
        const t = load();
        Object.assign(t.sdb, {connect: () => { const e = new Error('refused ' + 'x'.repeat(200)); e.code = 'sdbRefused'; return Promise.reject(e); }});
        t.provider.start();
        let written = 0;
        for (let i = 0; i < 150; i++) {
            await settle(); await settle();
            const timer = t.timers.filter(x => !x.cleared && !x.fired && x.ms >= 8000).pop();
            timer.fired = true; timer.cleared = true;
            timer.fn();
        }
        const logged = Object.keys(t.files).filter(f => /vetro\.jsonl$/.test(f));
        assert.equal(logged.length, 2, 'both the flash and the tmpfs log are written');
        logged.forEach(f => {
            assert(Buffer.byteLength(t.files[f]) <= policy.LOG_MAX_BYTES, f + ' grew to ' + Buffer.byteLength(t.files[f]));
            written += t.files[f].length;
            t.files[f].split('\n').filter(Boolean).forEach(l => JSON.parse(l));
        });
        assert(JSON.stringify(t.provider.status()).length * 150 > policy.LOG_MAX_BYTES, 'the run wrote more than the cap in total');
        console.log('PASS 150 failed launches leave both log files under ' + policy.LOG_MAX_BYTES + ' bytes with whole lines');
    }

    // --- the real sequence: connect during a failing handshake, disconnect, relaunch ------------------------
    {
        const t = load();
        let connects = 0;
        let rejectFirst;
        Object.assign(t.sdb, {connect: () => { connects++; return connects === 1 ? new Promise((resolve, reject) => { rejectFirst = reject; }) : new Promise(() => {}); }});
        t.provider.start();
        await settle();
        assert.equal(connects, 1);
        const identity = {identity: {pid: 1, uid: 0, gid: 0, cap_eff: '0', smack: ''}, _socket: {destroy() {}}};
        t.agentOptions().onConnect(identity);
        const error = new Error('refused'); error.code = 'sdbRefused';
        rejectFirst(error);
        await settle();
        t.agentOptions().onClose();
        const timer = t.timers.filter(x => !x.cleared && x.ms === 8000).pop();
        assert(timer, 'a disconnect schedules a relaunch');
        timer.fn();
        await settle();
        assert.equal(connects, 2, 'the agent is relaunched after the disconnect');
        console.log('PASS the agent is relaunched after a disconnect that followed a failing handshake');
    }

    // --- wake: the loss of an agent that had been up for a while --------------------------------------------
    // The TV stops sdbd at standby (the agent ends with it) and starts it again at wake. While the handshake is refused it is
    // tried every 2 s, without growing the backoff and without writing the same failure to the log again; the first connect
    // after it records how long the recovery took (awake time, attempts, stages), in memory only.
    {
        const t = load();
        let refuse = false, connects = 0;
        let answer = false;
        Object.assign(t.sdb, {connect: () => { connects++; if (refuse) { const e = new Error('refused'); e.code = 'sdbRefused'; return Promise.reject(e); } return answer ? Promise.resolve({}) : new Promise(() => {}); }});
        const events = [];
        t.provider.onAgent(up => events.push(up));
        t.provider.start();
        await settle();
        const identity = {identity: {pid: 1, uid: 0, gid: 0, cap_eff: '0', smack: ''}, _socket: {destroy() {}}};
        t.agentOptions().onConnect(identity);
        assert.ok(t.provider.status().timing.firstConnect, 'the first connect of the run is timed');
        t.context.state.agent.at = Date.now() - 60000;          // connected a minute ago
        refuse = true;
        t.agentOptions().onClose();
        const log = () => (t.files['/tmp/vetro.jsonl'] || '').split('\n').filter(Boolean).length;
        const delays = [];
        let lines = null;
        for (let i = 0; i < 6; i++) {
            const timer = t.timers.filter(x => !x.cleared && !x.fired && x.ms < 30000).pop();
            assert(timer, 'a relaunch is armed');
            delays.push(timer.ms);
            timer.fired = true; timer.cleared = true; timer.fn();
            await settle(); await settle();
            if (i === 1) lines = log();
        }
        assert.deepEqual(delays, [2000, 2000, 2000, 2000, 2000, 2000], 'refused handshakes after a stable loss are retried every 2 s: ' + delays);
        assert.equal(t.context.launchFailures, 0, 'and do not grow the backoff');
        assert.equal(log(), lines, 'the same refusal is not written again and again');
        refuse = false; answer = true;
        const timer = t.timers.filter(x => !x.cleared && !x.fired && x.ms === 2000).pop();
        timer.fired = true; timer.cleared = true; timer.fn();
        for (let i = 0; i < 6; i++) await settle();
        t.agentOptions().onConnect(identity);
        const reconnect = t.provider.status().timing.reconnect;
        assert.equal(typeof reconnect.awakeMs, 'number'); assert.ok(reconnect.attempts >= 7, 'attempts counted: ' + reconnect.attempts);
        assert.ok(reconnect.connectedFor >= 60000, 'how long the lost agent had been up: ' + reconnect.connectedFor); assert.equal(typeof reconnect.stages.handshakeMs, 'number', 'stages of the attempt that connected: ' + JSON.stringify(reconnect.stages));
        assert.deepEqual(events, [true, false, true], 'the service is told when the agent comes and goes');
        assert.equal(JSON.parse(t.files['/tmp/vetro.jsonl'].trim().split('\n').pop()).timing, undefined, 'the timing never goes to the log files');
        // An agent that dies right after connecting keeps the normal backoff (no fast loop).
        t.context.state.agent.at = Date.now();
        t.agentOptions().onClose();
        assert(t.timers.filter(x => !x.cleared && !x.fired).some(x => x.ms === 8000), 'a short-lived agent is relaunched after the usual 8 s');
        console.log('PASS wake: after a stable agent is lost, refused handshakes are retried every 2 s, uncounted and logged once; the recovery is timed in memory');
    }

    // --- callback timeouts back off, and the counter resets on connect and on stop ------------------------
    {
        const t = load();
        Object.assign(t.sdb, {connect: () => Promise.resolve({}), exec: () => new Promise(() => {})});
        t.provider.start();
        const waits = [];
        for (let i = 0; i < 7; i++) {
            await settle(); await settle();
            const timer = t.timers.filter(x => !x.cleared && !x.fired && x.ms >= 30000).pop();
            assert(timer, 'a callback wait is armed');
            waits.push(timer.ms);
            timer.fired = true; timer.cleared = true;
            timer.fn();
        }
        assert.equal(waits[0], 30000);
        assert(waits[6] > 30000 && waits[6] <= policy.MAX_MS && waits[6] >= waits[3], 'callback wait follows the delay once it passes 30 s: ' + waits.join(','));
        assert(t.context.launchFailures >= 7, 'every callback timeout counts as a failure');
        t.agentOptions().onConnect({identity: {pid: 1, uid: 0, gid: 0, cap_eff: '0', smack: ''}, _socket: {destroy() {}}});
        assert.equal(t.context.launchFailures, 0, 'a connected agent resets the failure count');
        t.context.launchFailures = 5;
        t.provider.stop();
        assert.equal(t.context.launchFailures, 0, 'stop() resets the failure count');
        console.log('PASS callback timeouts back off (' + waits.join(' ms, ') + ' ms); the counter resets on connect and stop');
    }

    // --- the tunnel's port still held by an older Vetro --------------------------------------------------------
    {
        let busy = true, made = 0, closed = 0;
        const t = load({'./sdb-tunnel.js': {TunnelServer: function () {
            made++;
            this.start = function (cb) { if (busy) { const e = new Error('listen EADDRINUSE'); e.code = 'EADDRINUSE'; cb(e); } else cb(null, 26201); };
            this.close = function () { closed++; };
        }}});
        t.provider.start();
        await settle();
        assert.equal(t.provider.status().sdbTunnel.listening, false, 'the port is held: no tunnel yet');
        const retry = () => t.timers.filter(x => !x.cleared && x.ms === 5000).pop();
        assert.ok(retry(), 'another try is armed');
        const first = retry(); first.cleared = true; first.fn();
        assert.equal(t.provider.status().sdbTunnel.listening, false);
        assert.equal(made, 2, 'a new listener for each try');
        busy = false;
        const second = retry(); second.cleared = true; second.fn();
        assert.equal(t.provider.status().sdbTunnel.listening, true, 'the tunnel is up once the older Vetro let the port go');
        assert.equal(retry(), undefined, 'and nothing is armed any more');
        t.provider.stop();
        // An error that is not "in use" is not tried again.
        const u = load({'./sdb-tunnel.js': {TunnelServer: function () { this.start = function (cb) { cb(new Error('invalid tunnel port')); }; this.close = function () {}; }}});
        u.provider.start();
        await settle();
        assert.equal(u.timers.filter(x => !x.cleared && x.ms === 5000).length, 0);
        u.provider.stop();
        console.log('PASS the SDB tunnel tries its port again while an older Vetro still holds it');
    }
    // --- the 1722 archive preflight failure falls back to vddebugmenu once --------------------------------
    {
        const t = load({
            './root-preflight.js': {checkTarget: () => { const e = new Error('preflight capture failed'); e.code = 'preflight-failed'; return Promise.reject(e); }},
            './sdb.js': {connect: () => Promise.resolve({}), close: () => {}, exec: () => Promise.resolve('')},
            './vddebugmenu.js': {run: () => new Promise(() => {})}
        });
        t.context.state.rootBackendDetection = {backend: 'sdb-archive', source: 'stored-probe', platformVersion: '6.5'};
        t.provider.start();
        await settle(); await settle();
        const status = t.provider.status();
        assert.equal(status.rooting.backend, 'vddebugmenu', 'the archive preflight failure switches to the vddebugmenu backend');
        assert.equal(status.rootBackendDetection.source, 'archive-fallback', 'the switch is recorded as the fallback');
        assert.equal(status.rootBackendDetection.platformVersion, '6.5');
        assert.equal(t.context.state.preparedRuntime, '3.1', 'the 6.5 agent is the netcoreapp3.1 payload, not net6');
        assert(status.bootstrapLog.some(x => x.event === 'step-preflight' && /fallback/.test(x.detail)), 'the fallback is in the bootstrap log');
        t.provider.stop();
        console.log('PASS the 1722 archive preflight failure falls back to vddebugmenu once with the 3.1 payload');
    }

    // --- orphan RootAgent & stale diagnostics socket cleanup on connect + DOTNET_EnableDiagnostics=0 ---------
    {
        const t = load();
        assert.ok(t.context.buildLaunchScript(4321).includes('DOTNET_EnableDiagnostics=0 /usr/bin/dotnet'), 'archive launch script disables .NET diagnostics IPC');
        assert.ok(!t.context.buildLaunchScript(4321).includes('GLOBALIZATION_INVARIANT'), 'no globalization invariant override');
        const cmds = [];
        t.provider.start();
        await settle();
        t.agentOptions().onConnect({
            identity: { pid: 5555, uid: 0, gid: 0, cap_eff: '0000003fffffffff', smack: 'User' },
            execute(cmd) { cmds.push(cmd); return Promise.resolve({ exit_code: 0, stdout: '' }); }
        });
        await settle();
        assert.ok(cmds.some(c => c.includes('active=5555') && c.includes('"$PPID"') && c.includes('SamsungTvRootAgent.dll') && c.includes('dotnet-diagnostic-*-socket')),
            'onConnect sweeps orphan RootAgents and stale diagnostic sockets while skipping active PID and $PPID');
        t.provider.stop();
        console.log('PASS orphan RootAgent and diagnostic socket cleanup runs safely on connect');
    }

})().catch(e => { console.error(e); process.exit(1); });
