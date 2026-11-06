'use strict';
const assert = require('assert').strict;
const fs = require('fs'), path = require('path'), os = require('os');
const {spawn} = require('child_process');
const sdb = require('../service/sdb.js');
const {createRunner} = require('../service/root-preflight-capture.js');
const preflight = require('../service/root-preflight.js');
const vm = require('vm');
// Tizen exposes child_process but terminates the host on execFile. A loadable
// module and the unconfigured fallback must never attempt a native spawn.
const moduleObject = {exports: {}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../service/root-preflight.js'), 'utf8'), {
    module: moduleObject, require: name => name === 'child_process' ? {execFile: () => {throw Error('Tizen host terminated');}} : require(name)
});
const original = sdb.exec;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-capture-'));
const active = new Set();
sdb.exec = (client, request) => new Promise((resolve, reject) => {
    const command = request.slice('shell:0 appinstall tpk '.length);
    const child = spawn('/bin/bash', ['-c', command]);
    active.add(child);
    child.once('error', reject);
    child.once('close', code => {active.delete(child); code === 0 ? resolve('') : reject(Error('injection failed'));});
});
(async function () {
    await assert.rejects(moduleObject.exports.checkTarget(), {code: 'preflight-failed'});
    const run = createRunner({}, command => command, {directory, timeout: 1000});
    assert.deepEqual(await run('/bin/echo', ["apostrophe's value"]), {ok: true, code: 0, output: "apostrophe's value\n"});
    assert.deepEqual(await run('/bin/bash', ['-c', 'echo diagnostic >&2; exit 255']), {ok: false, code: 255, output: 'diagnostic\n'});
    await assert.rejects(run('/bin/sleep', ['3']), {code: 'preflight-failed'});
    assert.deepEqual(fs.readdirSync(directory), [], 'probe scripts are removed on success and timeout');
    // Drive the real preflight parser through real loopback captures, replacing
    // only the TV commands with deterministic shell output on this host.
    const probe = (file, args) => file === '/usr/bin/dotnet' ? run('/bin/echo', ['Microsoft.NETCore.App 3.1.3 [/runtime]'])
      : file === 'getcap' ? run('/bin/echo', ['/usr/bin/dotnet cap_setgid,cap_sys_admin=ep\n/usr/sbin/sdbd-tarlauncher cap_setuid,cap_setgid=ep'])
      : run('/bin/echo', ['--to-command']);
    assert.deepEqual(await preflight.checkTarget({run: probe}), {runtime: '3.1', source: 'detected'});
    console.log('PASS Tizen preflight avoids native spawn; loopback capture preserves output/exit, quoting, deadlines and cleanup');
})().catch(error => {console.error(error); process.exitCode = 1;}).finally(() => {
    active.forEach(child => child.kill());
    sdb.exec = original;
    fs.rmSync(directory, {recursive: true, force: true});
});
