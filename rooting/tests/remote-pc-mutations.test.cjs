'use strict';
// Real authenticated transport, simulated root identity and TV command executor.
// Never dispatch TV package commands on the host.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const net = require('net');
const vm = require('vm');
const platformModule = require('../service/remote-pc-platform.js');
const agent = require('../service/node-root-agent.js');
const rootIdentity = {pid: 123, uid: 0, euid: 0, gid: 0, egid: 0, cap_eff: '0', smack: 'fixture'};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    const p = platformModule.create({allowMutations: true, lifetimeMs: 10000});
    let peer;
    try {
        await assert.rejects(p.install('example', '/tmp/example.wgt'), e => e.submitted === false && e.code === 'no-root-agent');
        p.start();
        for (let i = 0; !p.status().prepared && i < 100; i++) await delay(10);
        const state = p.status();
        assert.equal(state.prepared, true);
        const directory = /^lab\$\(bash<(\/tmp\/vq-[A-Za-z0-9]+)\/launch\)$/.exec(state.bootstrapUsername)[1];
        const configPath = path.join(directory, 'session.json');
        const config = JSON.parse(fs.readFileSync(configPath));
        fs.unlinkSync(configPath);
        const tasks = [];
        let result = {exit_code: 0, timed_out: false, stdout: 'submitted\n', stderr: ''};
        let disconnect = false;
        const executor = (task, callback) => {
            tasks.push(task);
            if (disconnect) setImmediate(() => peer.close());
            else setImmediate(() => callback(result));
            return () => {};
        };
        peer = agent.session(net.connect(config.port, config.host), Buffer.from(config.secret, 'base64'), rootIdentity, executor);
        for (let i = 0; !p.status().agent.connected && i < 100; i++) await delay(10);
        assert.equal(p.status().agent.connected, true);
        assert.equal(p.status().readOnly, false);

        for (const args of [['bad;id', '/tmp/a.wgt'], ['ok', '/tmp/$(id).wgt'], ['ok', '/tmp/../a.wgt'], [null, '/tmp/a.wgt']]) {
            await assert.rejects(p.install(...args), e => e.submitted === false && /invalid/.test(e.message));
        }
        for (const args of [[['ok;id'], false], [['ok'], 'false'], [null, true], [Array(33).fill('ok'), false]]) {
            await assert.rejects(p.setApplicationsEnabled(...args), /invalid/);
        }
        for (const id of ['vetrotvapp', 'vetrotvapp.svc', 'com.samsung.tv.coba.adagent', 'com.samsung.tv.coba.adagent.service']) {
            await assert.rejects(p.setApplicationsEnabled([id], false), /Cannot disable/);
        }
        assert.equal((await p.setApplicationsEnabled([], false)).exit_code, 0);
        assert.equal(tasks.length, 0, 'invalid and empty requests send no command');

        assert.equal(await p.install('example', '/tmp/example.wgt'), 'submitted\n');
        assert.equal(tasks[0].command, "vd_appinstall example '/tmp/example.wgt'");
        assert.equal(tasks[0].timeout, 120000);
        await p.setApplicationsEnabled(['example.app'], false);
        await p.setApplicationsEnabled(['example.app'], true);
        for (const [index, flag] of [[1, '-D'], [2, '-A']]) {
            const script = Buffer.from(tasks[index].command.split(' ')[1], 'base64').toString();
            assert.ok(script.includes('pkgcmd ' + flag + ' -t app -n "$id" --uid "$u"'));
            assert.ok(script.includes('stat -c %u /opt/usr/home/owner'));
            assert.equal(tasks[index].timeout, 60000);
        }
        result = {exit_code: 7, timed_out: false, stdout: '', stderr: 'installer refused'};
        await assert.rejects(p.install('example', '/tmp/example.wgt'), e => e.submitted === null && /refused/.test(e.message));
        result = {exit_code: 124, timed_out: true, stdout: '', stderr: ''};
        await assert.rejects(p.install('example', '/tmp/example.wgt'), e => e.submitted === null);
        const count = tasks.length;
        disconnect = true;
        await assert.rejects(p.install('example', '/tmp/example.wgt'), e => e.submitted === null && /disconnect/.test(e.message));
        await delay(20);
        assert.equal(tasks.length, count + 1, 'a disconnected install is never retried');
    } finally { if (peer) peer.close(); p.stop(); }

    const oldMethod = process.env.VETRO_ROOT_METHOD, oldMode = process.env.VETRO_REMOTE_PC_MODE;
    try {
        process.env.VETRO_ROOT_METHOD = 'remote-pc';
        for (const mode of ['diagnostics', 'manual', 'automatic']) {
            process.env.VETRO_REMOTE_PC_MODE = mode;
            const files = require('../build.cjs').collectIntegration();
            const context = {module: {exports: {}}};
            vm.runInNewContext(files.find(f => decodeURIComponent(f.uri) === 'service/build-info.js').data.toString(), context);
            const info = context.module.exports;
            assert.equal(info.remotePcMode, mode);
            assert.equal(info.inputRuntime, 'tizen55');
            assert.equal(info.restoreInput, mode !== 'diagnostics');
            assert.equal(info.restorePreferences, mode !== 'diagnostics');
            const dockRuntime=JSON.parse(files.find(f=>decodeURIComponent(f.uri)==='native/dock/tvlauncher-dotnet.runtimeconfig.json').data.toString());
            assert.equal(dockRuntime.runtimeOptions.tfm,'netcoreapp3.0');
            assert.equal(info.readOnly, mode === 'diagnostics');
            assert.equal(info.automaticRestore, mode === 'automatic');
            const runtime = JSON.parse(files.find(f => decodeURIComponent(f.uri) === 'payload/SamsungTvRemoteInputAgent.runtimeconfig.json').data.toString());
            assert.equal(runtime.runtimeOptions.tfm, 'netcoreapp3.0');
            assert.ok(files.find(f => decodeURIComponent(f.uri) === 'payload/SamsungTvRemoteInputAgent.dll').data.equals(fs.readFileSync(path.resolve(__dirname, '../payload55/SamsungTvRemoteInputAgent.dll'))));
            // Verify the packaged singleton uses the flags, not just the factory fixture.
            const packaged = {module: {exports: {}}, __dirname: path.resolve(__dirname, '../../app/service'),
                require: name => name === './build-info.js' ? info : name === './compat.js' ? require('../../app/service/compat.js') : name.startsWith('.')
                    ? require(path.resolve(__dirname, '../service', name)) : require(name), process, Buffer, setTimeout, clearTimeout};
            vm.runInNewContext(files.find(f => decodeURIComponent(f.uri) === 'service/platform.js').data.toString(), packaged);
            assert.equal(packaged.module.exports.status().readOnly, mode === 'diagnostics');
        }
        process.env.VETRO_REMOTE_PC_MODE = 'typo';
        assert.throws(() => require('../build.cjs').collectIntegration(), /VETRO_REMOTE_PC_MODE/);
    } finally {
        if (oldMethod === undefined) delete process.env.VETRO_ROOT_METHOD; else process.env.VETRO_ROOT_METHOD = oldMethod;
        if (oldMode === undefined) delete process.env.VETRO_REMOTE_PC_MODE; else process.env.VETRO_REMOTE_PC_MODE = oldMode;
    }
    console.log('PASS Remote PC manual actions: authenticated installer/package state, validation, unknown outcomes, no retry and build modes');
}
const watchdog = setTimeout(() => { console.error('Remote PC mutations test timed out'); process.exit(1); }, 10000);
main().then(() => clearTimeout(watchdog)).catch(e => {console.error(e); process.exit(1);});
