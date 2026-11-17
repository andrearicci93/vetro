'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const {Dock} = require('../service/dock.js');

(async function () {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-dock-probe-'));
    try {
        // Execute the actual generated status shell, with only its TV paths and
        // process-list commands substituted. This reproduces tail's exit status.
        const dock = new Dock({execute: async command => {
            const script = Buffer.from(command.split(' ')[1], 'base64').toString()
                .replace(/\/home\/owner\/tvlauncher\.(pid|log)/g, (_, ext) => tmp + '/launcher.' + ext)
                .replace('/proc/[0-9]*/comm', tmp + '/proc/[0-9]*/comm');
            const r = spawnSync('/bin/sh', ['-c', 'pidof() { return 1; }; ps() { :; };\n' + script], {encoding: 'utf8'});
            assert.ifError(r.error);
            return {exit_code: r.status, stdout: r.stdout, stderr: r.stderr};
        }});
        assert.deepEqual(await dock.probe(), {running: false, pid: null, samsungHome: false, log: ''});
        fs.writeFileSync(path.join(tmp, 'launcher.log'), 'first\nsecond\nthird\nfourth\nfifth\nsixth\nseventh\n');
        assert.equal((await dock.probe()).log, 'second\nthird\nfourth\nfifth\nsixth\nseventh');
        // Samsung's Home by its process name: "csfs" on some TVs, the tail of the app id after "DN_" where it is a .NET app
        // (a Q80A showed DN_sung.tv.csfs while the older check, the exact name, said it was not running).
        const names = {'csfs': true, 'DN_sung.tv.csfs': true, 'DN_ng.tv.csfsx': false, 'notcsfs': false, 'csfs-helper': false};
        fs.mkdirSync(path.join(tmp, 'proc', '77'), {recursive: true});
        fs.mkdirSync(path.join(tmp, 'proc', '4242'), {recursive: true});
        fs.writeFileSync(path.join(tmp, 'proc', '77', 'comm'), 'sh\n');
        for (const name of Object.keys(names)) {
            fs.writeFileSync(path.join(tmp, 'proc', '4242', 'comm'), name + '\n');
            assert.equal((await dock.probe()).samsungHome, names[name], name);
        }
        fs.rmSync(path.join(tmp, 'proc'), {recursive: true});
        const broken = new Dock({execute: async () => ({exit_code: 1, stderr: 'transport failed'})});
        await assert.rejects(broken.probe(), /transport failed/);
        console.log('PASS launcher status: real shell tolerates missing first-run log, retains tail and command failures');
    } finally {
        fs.rmSync(tmp, {recursive: true, force: true});
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
