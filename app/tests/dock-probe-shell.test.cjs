'use strict';
// #82: the launcher status script, run for real. Its last command printed the launcher log; with no log file it
// failed, so the whole status read failed and the user saw its raw output, "dock= home=0 log:".
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const {Dock} = require('../service/dock.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-dock-probe-'));
const run = path.join(tmp, 'owner');
fs.mkdirSync(run);
const scripts = [];
// Runs what the service would send to the root agent, with /home/owner moved into the temp folder.
const execute = async function (cmd) {
    const b64 = /^echo (\S+) \| base64 -d \| sh$/.exec(cmd);
    const script = Buffer.from(b64[1], 'base64').toString().split('/home/owner').join(run);
    scripts.push(script);
    const r = cp.spawnSync('sh', ['-c', script], {encoding: 'utf8'});
    return {exit_code: r.status, stdout: r.stdout, stderr: r.stderr, timed_out: false};
};
const dock = new Dock({execute: execute, dir: path.join(tmp, 'dock'), stateFile: path.join(tmp, 'state.json'), appsFile: path.join(tmp, 'apps.tsv')});

(async function () {
    try {
        // No pid file, no log file: the launcher is simply not running, which is an answer, not an error.
        const none = await dock.probe();
        assert.equal(none.running, false);
        assert.equal(none.pid, null);
        assert.equal(none.log, '');
        assert.equal(scripts.length, 1);
        assert.ok(/\|\| true\s*$/.test(scripts[0]), 'the log read cannot fail the script');
        // A log file: its last lines come back.
        fs.writeFileSync(path.join(run, 'tvlauncher.log'), ['1', '2', '3', '4', '5', '6', '7', 'last line'].join('\n') + '\n');
        const logged = await dock.probe();
        assert.equal(logged.running, false);
        assert.equal(logged.log, ['3', '4', '5', '6', '7', 'last line'].join('\n'));
        // A stale pid that is not our dll does not count as running.
        fs.writeFileSync(path.join(run, 'tvlauncher.pid'), String(process.pid));
        assert.equal((await dock.probe()).running, false, 'a pid that is not the launcher dll is not the launcher');
        console.log('PASS dock probe script: a missing log or pid file is "not running", not a failed status read (#82)');
    } finally { fs.rmSync(tmp, {recursive: true, force: true}); }
})().catch(e => { console.error(e); process.exitCode = 1; });
