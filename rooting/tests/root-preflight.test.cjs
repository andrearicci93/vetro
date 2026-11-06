'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const preflight = require('../service/root-preflight.js');
const caps = '/usr/bin/dotnet = cap_setgid,cap_sys_admin+ep\n/usr/sbin/sdbd-tarlauncher cap_setuid,cap_setgid=ep\n';
const listing = version => ({ok: true, output: 'Microsoft.NETCore.App ' + version + ' [/usr/share/dotnet/shared]\n'});
const samsung = {ok: false, code: 255, output: 'Unknown option --list-runtimes.\n'};
const files = version => ({realpathSync: () => '/opt/runtime/' + version, accessSync: () => {}});
function probe(overrides) {
    const responses = Object.assign({dotnet: listing('6.0.2'), getcap: {ok: true, output: caps}, tar: {ok: true, output: '--to-command=COMMAND'}}, overrides);
    return preflight.checkTarget({run: (file) => Promise.resolve(responses[path.basename(file)])});
}
(async function () {
    assert.equal(preflight.detectRuntime(listing('3.1.3')), '3.1');
    assert.equal(preflight.detectRuntime(listing('8.0.1')), '6.0');
    assert.equal(preflight.detectRuntime({ok: true, output: listing('3.1.3').output + listing('6.0.2').output}), '6.0');
    for (const version of ['2.1.4', '3.0.1', '5.0.1']) assert.throws(() => preflight.detectRuntime(listing(version)), {code: 'runtime-unsupported'});
    assert.equal(preflight.detectRuntime(samsung, files('3.1.3')), '3.1');
    assert.equal(preflight.detectRuntime(samsung, files('6.0.1')), '6.0');
    assert.throws(() => preflight.detectRuntime(samsung, files('3.0.1')), {code: 'runtime-unsupported'});
    assert.throws(() => preflight.detectRuntime(samsung, files('not-a-version')), {code: 'runtime-probe-failed'});
    assert.throws(() => preflight.detectRuntime(samsung, {realpathSync: files('3.1.3').realpathSync, accessSync: () => {throw Error('unreadable CLR');}}), {code: 'runtime-probe-failed'});
    assert.throws(() => preflight.detectRuntime({...samsung, code: 1}, files('3.1.3')), {code: 'runtime-probe-failed'});
    assert.deepEqual(await probe(), {runtime: '6.0', source: 'detected'});
    assert.deepEqual(await probe({dotnet: listing('3.1.3')}), {runtime: '3.1', source: 'detected'});
    await assert.rejects(probe({getcap: {ok: false}}), {code: 'capabilities-probe-failed'});
    await assert.rejects(probe({getcap: {ok: true, output: caps.replace('cap_sys_admin+ep', 'cap_sys_admin+p')}}), {code: 'dotnet-capabilities-missing'});
    await assert.rejects(probe({getcap: {ok: true, output: caps.split('\n')[0]}}), {code: 'launcher-capabilities-missing'});
    await assert.rejects(probe({tar: {ok: true, output: 'other options'}}), {code: 'tar-unsupported'});
    await assert.rejects(probe({tar: {ok: false}}), {code: 'tar-probe-failed'});

    // Exercise real preparation: selected DLL/deps and generated config must
    // agree; runtime choice must not just relabel a 3.1 assembly as net6.
    const c = require('./provider-harness.cjs')(path.resolve(__dirname, '..')).context;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-runtime-stage-'));
    c.fs = fs; c.STAGE = tmp; c.cleanStage = () => [];
    try {
        for (const runtime of ['3.1', '6.0']) {
            c.prepare(12345, runtime);
            const source = path.resolve(__dirname, '..', 'payload', runtime === '6.0' ? 'net6' : '.');
            for (const name of ['SamsungTvArchiveRoot', 'SamsungTvRootAgent']) {
                const staged = path.join(tmp, c.pkg, name);
                assert.deepEqual(fs.readFileSync(staged + '.dll'), fs.readFileSync(path.join(source, name + '.dll')));
                const config = JSON.parse(fs.readFileSync(staged + '.runtimeconfig.json'));
                assert.equal(config.runtimeOptions.framework.version, runtime + '.0');
                assert.equal(config.runtimeOptions.rollForward, runtime === '6.0' ? 'Major' : 'LatestPatch');
                assert.equal(JSON.parse(fs.readFileSync(staged + '.deps.json')).runtimeTarget.name, '.NETCoreApp,Version=v' + runtime);
            }
        }
    } finally { fs.rmSync(tmp, {recursive: true, force: true}); }
    console.log('PASS runtime detection, Samsung apphost fallback, effective capabilities, tar and matching staged payloads');
})().catch(error => { console.error(error); process.exitCode = 1; });
