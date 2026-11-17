'use strict';
// The cheap "is it running" check of the launcher and the tuner (dock.js runningCheck), run for real on a fake TV: the pid
// file and /proc/<pid>/cmdline are moved into a temp folder, and the line is given to a shell exactly as the root agent
// gives it (setsid /bin/sh -c "<line>", no base64 wrapper). The TV's /bin/sh is bash; bash 3.2 (the macOS /bin/sh too) keeps
// only the first field of a NUL-separated file with a plain `read`, which is why the check reads field by field.
// Same answers as the full probe on a missing pid file (#82): "not running", never a failed read.
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const {Dock, runningCheck, parseCheck} = require('../service/dock.js');
const {Tuner} = require('../service/tuner.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-running-check-'));
const run = path.join(tmp, 'owner'), proc = path.join(tmp, 'proc');
fs.mkdirSync(run); fs.mkdirSync(proc);
function onTv(line) { return line.split('/home/owner').join(run).split('/proc/').join(proc + '/'); }
function fakeProcess(pid, argv) { fs.mkdirSync(path.join(proc, String(pid)), {recursive: true}); fs.writeFileSync(path.join(proc, String(pid), 'cmdline'), argv.join('\0') + '\0'); }
function has(shell) { return cp.spawnSync(shell, ['-c', 'true']).status === 0; }
const shells = ['bash', '/bin/sh'].filter(has);
const scripts = [];
function executeWith(shell) {
    return async function (cmd) {
        scripts.push(cmd);
        const wrapped = /^echo (\S+) \| base64 -d \| sh$/.exec(cmd);
        const line = onTv(wrapped ? Buffer.from(wrapped[1], 'base64').toString() : cmd);
        const r = cp.spawnSync(shell, ['-c', 'pidof() { return 1; }\n' + line], {encoding: 'utf8'});
        return {exit_code: r.status, stdout: r.stdout, stderr: r.stderr, timed_out: false};
    };
}

(async function () {
    try {
        // The line itself: one line, no pipe, no program but the shell's own builtins.
        const line = runningCheck('/home/owner/tvlauncher.pid', 'tvlauncher-dotnet.dll', 'dock');
        assert.ok(!/\n/.test(line), 'one line');
        assert.ok(!/\|/.test(line.replace(/\|\|/g, '').replace("''|*[!0-9]*)", '')), 'no pipe (only || and a case pattern)');
        assert.ok(!/\$\(|`|\b(cat|tr|grep|tail|pidof|ls|sed)\b/.test(line), 'no command substitution and no external tool');
        assert.deepEqual(parseCheck('dock=\nother=77\n', /^dock=(\d+)$/m), {running: false, pid: null, other: 77, cheap: true});

        assert.ok(shells.length, 'a shell to run the check');
        for (const shell of shells) {
            for (const f of fs.readdirSync(run)) fs.unlinkSync(path.join(run, f));
            const dock = new Dock({execute: executeWith(shell), dir: path.join(tmp, 'dock'), stateFile: path.join(tmp, 'state.json'), appsFile: path.join(tmp, 'apps.tsv')});
            const tuner = new Tuner({execute: executeWith(shell), dir: path.join(tmp, 'tuner'), stateFile: path.join(tmp, 'tuner.json')});
            // No pid file: not running, and not a failed read.
            assert.deepEqual(await dock.check(), {running: false, pid: null, other: null, cheap: true}, shell + ': no pid file');
            assert.deepEqual(await tuner.check(), {running: false, pid: null, other: null, cheap: true}, shell + ': no pid file (tuner)');
            // A pid file left by a process that is gone: not running, nothing to escalate.
            fs.writeFileSync(path.join(run, 'tvlauncher.pid'), '999999\n');
            assert.deepEqual(await dock.check(), {running: false, pid: null, other: null, cheap: true}, shell + ': dead pid');
            // Garbage in the pid file never reaches a path.
            fs.writeFileSync(path.join(run, 'tvlauncher.pid'), '../etc');
            assert.equal((await dock.check()).running, false, shell + ': not a number');
            // Our dll, as systemd-run starts it (/usr/bin/env execs dotnet): running, with its pid. No trailing newline in the file.
            fakeProcess(4242, ['/usr/bin/dotnet', 'tvlauncher-dotnet.dll', '--apps', '/opt/x.tsv', '--hidden']);
            fs.writeFileSync(path.join(run, 'tvlauncher.pid'), '4242');
            assert.deepEqual(await dock.check(), {running: true, pid: 4242, other: null, cheap: true}, shell + ': our dll is running');
            // A live pid that is something else (the pid was reused): not running, reported as "other" for the full probe.
            fakeProcess(4343, ['/usr/bin/dotnet', 'SomethingElse.dll']);
            fs.writeFileSync(path.join(run, 'tvlauncher.pid'), '4343\n');
            assert.deepEqual(await dock.check(), {running: false, pid: null, other: 4343, cheap: true}, shell + ': a reused pid');
            // The tuner's dll as its last argument with no NUL after it (a rewritten argv): still found.
            fs.mkdirSync(path.join(proc, '5151'), {recursive: true});
            fs.writeFileSync(path.join(proc, '5151', 'cmdline'), '/usr/bin/dotnet\0--resident\0vetro-tuner.dll');
            fs.writeFileSync(path.join(run, 'vetro-tuner.pid'), '5151\n');
            assert.deepEqual(await tuner.check(), {running: true, pid: 5151, other: null, cheap: true}, shell + ': the tuner');
            // The launcher's dll in the tuner's pid file is not the tuner.
            fs.writeFileSync(path.join(run, 'vetro-tuner.pid'), '4242\n');
            assert.equal((await tuner.check()).running, false, shell + ': another part is not the tuner');
        }

        // A shell that cannot read the fields (dash has no read -d) never answers "running" for a pid that is not ours, and
        // answers "other" for ours, so the caller asks the full probe and then keeps using it (Dock.runningNow).
        if (has('dash')) {
            fs.writeFileSync(path.join(run, 'tvlauncher.pid'), '4242\n');
            const r = await executeWith('dash')(runningCheck('/home/owner/tvlauncher.pid', 'tvlauncher-dotnet.dll', 'dock'));
            assert.equal(r.exit_code, 0);
            const c = parseCheck(r.stdout, /^dock=(\d+)$/m);
            assert.ok(c.running === true || c.other === 4242, 'either it reads the fields or it says "other": ' + r.stdout);
        }
        console.log('PASS running check on a fake TV (' + shells.join(', ') + '): builtins only, a missing or stale pid is "not running", a reused pid is "other", our dll is found field by field');
    } finally { fs.rmSync(tmp, {recursive: true, force: true}); }
})().catch(e => { console.error(e); process.exitCode = 1; });
