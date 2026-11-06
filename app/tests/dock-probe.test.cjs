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
                .replace(/\/home\/owner\/tvlauncher\.(pid|log)/g, (_, ext) => tmp + '/launcher.' + ext);
            const r = spawnSync('/bin/sh', ['-c', 'pidof() { return 1; }; ps() { :; };\n' + script], {encoding: 'utf8'});
            assert.ifError(r.error);
            return {exit_code: r.status, stdout: r.stdout, stderr: r.stderr};
        }});
        assert.deepEqual(await dock.probe(), {running: false, pid: null, samsungHome: false, log: ''});
        fs.writeFileSync(path.join(tmp, 'launcher.log'), 'first\nsecond\nthird\nfourth\nfifth\nsixth\nseventh\n');
        assert.equal((await dock.probe()).log, 'second\nthird\nfourth\nfifth\nsixth\nseventh');
        const broken = new Dock({execute: async () => ({exit_code: 1, stderr: 'transport failed'})});
        await assert.rejects(broken.probe(), /transport failed/);
        console.log('PASS launcher status: real shell tolerates missing first-run log, retains tail and command failures');
    } finally {
        fs.rmSync(tmp, {recursive: true, force: true});
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
