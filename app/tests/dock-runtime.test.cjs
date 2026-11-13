'use strict';
const assert = require('assert').strict;
const {Runtime, components} = require('../service/dock-runtime.js');
const presence = require('../service/presence.js');
const rows = [
    {appId: 'sample.ui', packageId: 'sample', name: 'Sample', component: 'ui'},
    {appId: 'sample.svc', packageId: 'sample', name: 'Sample playback', component: 'svc', autorestart: true},
    {appId: 'other.ui', packageId: 'other'},
    {appId: 'vetrotvapp.svc', packageId: 'vetrotvapp'}
];
const block = (pid, id, status) => `pid: ${pid}\nappid: ${id}\nstatus: ${status}\n=================\n`;
(async () => {
    const list = components(rows, [{appId: 'sample.svc', pid: 10, status: 8}, {appId: 'unknown', pid: 11, status: 4}, {appId: 'vetrotvapp.svc', pid: 12, status: 8}]);
    assert.deepEqual(list[0].matches, ['sample.ui', 'sample.svc']);
    assert.equal(list[0].service, true); assert.equal(list[0].canStop, true); assert.equal(list[0].autorestart, true);
    assert.equal(list.length, 2, 'unregistered processes do not become stop targets');
    assert.equal(list[1].canStop, false, 'Vetro is protected');
    let pid = 10, mode = 'stop', stopCount = 0, commands = [], inventoryError = false;
    const runtime = new Runtime({inventory: async () => ({apps: rows, registryError: inventoryError ? 'offline' : null}), sleep: async () => {}, execute: async cmd => {
        commands.push(cmd);
        if (cmd === presence.COMMAND) return {exit_code: 0, stdout: block(1, 'vetrotvapp.svc', 8) + (pid ? block(pid, 'sample.svc', 8) : '')};
        stopCount++;
        assert.equal(Buffer.from(cmd.split(' ')[1], 'base64').toString(), 'app_launcher -k sample.svc', 'stop only; no startup flag changes');
        if (mode === 'transport') throw Error('response lost');
        if (mode === 'restart') pid++;
        else if (mode === 'stop') pid = 0;
        return {exit_code: mode === 'failed' ? 1 : 0};
    }});
    const [a, b] = await Promise.all([runtime.snapshot(), runtime.snapshot()]);
    assert.equal(a, b); assert.equal(commands.length, 1, 'concurrent badge reads share one listing');
    commands = [];
    for (const request of [{appId: 'sample.svc', pid: 0}, {appId: 'sample.svc', pid: '10'}, {appId: 'sample.svc;reboot', pid: 10}, {appId: 'vetrotvapp.svc', pid: 1}, {appId: 'absent', pid: 10}]) {
        await assert.rejects(runtime.stop(request));
    }
    assert.equal(stopCount, 0, 'invalid and protected requests never send a stop');
    await assert.rejects(runtime.stop({appId: 'sample.svc', pid: 9}), /restarted/);
    assert.equal(stopCount, 0, 'stale process identity refused');
    let result = await runtime.stop({appId: 'sample.svc', pid: 10});
    assert.equal(result.verified, true); assert.equal(stopCount, 1);
    result = await runtime.stop({appId: 'sample.svc', pid: 10});
    assert.equal(result.message, 'Already stopped'); assert.equal(stopCount, 1);
    pid = 20; mode = 'restart'; result = await runtime.stop({appId: 'sample.svc', pid: 20});
    assert.equal(result.ok, false); assert.match(result.message, /restarted/);
    mode = 'failed'; result = await runtime.stop({appId: 'sample.svc', pid: 21});
    assert.equal(result.ok, false); assert.match(result.message, /Could not stop/);
    mode = 'transport'; const before = stopCount;
    await assert.rejects(runtime.stop({appId: 'sample.svc', pid: 21}), /response lost/);
    assert.equal(stopCount, before + 1, 'uncertain stop is not retried');
    inventoryError = true; commands = [];
    await assert.rejects(runtime.stop({appId: 'sample.svc', pid: 21}), /inventory/);
    assert.equal(commands.length, 0, 'no mutation without a readable registry');
    console.log('PASS launcher runtime: badges, service association, protected/stale targets, stop verification and restart handling');
})().catch(error => { console.error(error); process.exit(1); });
