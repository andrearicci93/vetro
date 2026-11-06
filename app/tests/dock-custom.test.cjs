'use strict';
// The custom launcher must never leave Samsung's Home (com.samsung.tv.csfs) disabled: on the Q80A the boot script
// loops on `app_launcher -f com.samsung.tv.csfs` until it succeeds, so a disabled package can stall the boot.
const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const {Dock} = require('../service/dock.js');

function fixture(options) {
    options = options || {};
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-dock-custom-'));
    const dir = path.join(tmp, 'dock');
    fs.mkdirSync(path.join(dir, 'res'), {recursive: true});
    fs.writeFileSync(path.join(dir, 'tvlauncher-dotnet.dll'), 'x');
    fs.writeFileSync(path.join(dir, 'res', 'glass_tile.png'), 'x');
    const tv = {autorun: 1, running: false, scripts: [], clock: 1000000, started: null, homeCalls: [], csfsKilled: false};
    const execute = async function (cmd) {
        tv.scripts.push(cmd);
        if (/^app_launcher -k /.test(cmd)) { tv.csfsKilled = true; return {exit_code: 0, stdout: ''}; }
        const script = Buffer.from(cmd.split(' ')[1], 'base64').toString();
        if (script.includes('vconftool set') && script.includes('auto_start')) { tv.autorun = +/auto_start (\d)/.exec(script)[1]; return {exit_code: 0, stdout: ''}; }
        if (script.includes('vconftool get') && script.includes('auto_start')) return {exit_code: 0, stdout: 'db/menu/smart_hub/ontvsetting/auto_start, value = ' + tv.autorun + ' (Int32)\n'};
        if (script.includes('setsid nohup')) { tv.started = script; tv.running = true; return {exit_code: 0, stdout: 'started\n'}; }
        if (script.includes('kill -9') && !script.includes('echo "dock=')) { tv.running = false; return {exit_code: 0, stdout: ''}; }
        if (script.includes('echo "dock=')) return {exit_code: 0, stdout: (tv.running ? 'dock=4242' : 'dock=') + '\nhome=1\nlog:\n\n'};
        throw new Error('unexpected command: ' + script);
    };
    const home = {
        state: async () => { tv.homeCalls.push('state'); return 'on'; },
        disable: async () => { tv.homeCalls.push('disable'); },
        restore: async () => { tv.homeCalls.push('restore'); if (options.restoreFails) throw new Error('registry busy'); }
    };
    const dock = new Dock({execute, dir, stateFile: path.join(tmp, 'state.json'), appsFile: path.join(tmp, 'apps.tsv'),
        customAppsFile: path.join(tmp, 'custom.tsv'), home, appCheck: async id => ({ok: true, label: id}),
        sleep: async ms => { tv.clock += ms; }, now: () => tv.clock});
    return {dock, tv, tmp};
}

(async function () {
    // Turning it on: headless dock for the app, autorun off, Samsung's Home closed for now but never disabled.
    let f = fixture();
    let s = await f.dock.enableCustom('com.example.launcher');
    assert.equal(s.mode, 'custom');
    assert.equal(s.customApp, 'com.example.launcher');
    assert.deepEqual(f.tv.homeCalls, [], 'Samsung Home is never disabled, restored or even read by the mode');
    assert.equal(f.dock.readState().customHomeDisabled, false);
    assert.ok(/--home-launch com\.example\.launcher/.test(f.tv.started) && /--kill-on-home com\.samsung\.tv\.csfs,com\.samsung\.tv\.home\.sidebar,com\.samsung\.tv\.home\.media/.test(f.tv.started),
        'the guard that closes Samsung Home after each press is on: ' + f.tv.started);
    assert.equal(f.tv.autorun, 0, 'the TV does not power on into Samsung Home');
    assert.equal(f.tv.csfsKilled, true, 'Samsung Home is closed once');
    assert.ok(f.tv.scripts.every(c => !/pkgcmd/.test(c)), 'no package command at all');

    // Changing the app keeps the mode, does not touch Samsung Home.
    s = await f.dock.enableCustom('com.example.other');
    assert.equal(s.customApp, 'com.example.other');
    assert.deepEqual(f.tv.homeCalls, []);

    // Off: no Samsung Home work either, autorun is put back.
    s = await f.dock.disableCustom();
    assert.equal(s.mode, 'off');
    assert.deepEqual(f.tv.homeCalls, []);
    assert.equal(f.tv.autorun, 1);

    // A failed start leaves nothing behind.
    f = fixture();
    f.dock.appCheck = async () => ({ok: false, reason: 'the app is disabled.'});
    await assert.rejects(f.dock.enableCustom('com.example.launcher'), /disabled/);
    assert.equal(f.dock.readState().customApp, null);
    assert.deepEqual(f.tv.homeCalls, []);

    // Left over from an earlier build: the state says Samsung Home was disabled by the mode. The first supervision
    // round puts it back and clears the flag, and keeps supervising.
    f = fixture();
    await f.dock.enableCustom('com.example.launcher');
    f.dock.patchState({customHomeDisabled: true});
    assert.equal(await f.dock.supervise(true), 'running');
    assert.deepEqual(f.tv.homeCalls, ['restore']);
    assert.equal(f.dock.readState().customHomeDisabled, false);
    assert.equal(await f.dock.supervise(true), 'running');
    assert.deepEqual(f.tv.homeCalls, ['restore'], 'only once');

    // The put-back fails (the registry is busy): the flag stays for the next round, the mode keeps working.
    f = fixture({restoreFails: true});
    await f.dock.enableCustom('com.example.launcher');
    f.dock.patchState({customHomeDisabled: true});
    assert.equal(await f.dock.supervise(true), 'running');
    assert.equal(f.dock.readState().customHomeDisabled, true);
    assert.match(f.dock.lastError, /earlier version/);

    // Turning it off with the leftover flag puts Samsung Home back first; if that fails the mode stays on.
    f = fixture({restoreFails: true});
    await f.dock.enableCustom('com.example.launcher');
    f.dock.patchState({customHomeDisabled: true});
    await assert.rejects(f.dock.disableCustom(), /registry busy/);
    assert.equal(f.dock.readState().customApp, 'com.example.launcher');
    console.log('PASS custom launcher: Samsung Home never disabled, leftover flag healed, off puts everything back');
})().catch(e => { console.error(e); process.exitCode = 1; });
