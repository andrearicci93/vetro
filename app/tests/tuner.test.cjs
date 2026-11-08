'use strict';
// Vetro TV Tuner (service/tuner.js): the switch, the start line, supervision, and above all what it never does to Samsung's tuner.
const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const {Tuner, unsupportedReason, CONTROL, TARGET_APP} = require('../service/tuner.js');

function fixture(options) {
    options = options || {};
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-tuner-'));
    const dir = path.join(tmp, 'tuner');
    if (options.installed !== false) {
        fs.mkdirSync(path.join(dir, 'res'), {recursive: true});
        fs.writeFileSync(path.join(dir, 'vetro-tuner.dll'), 'x');
        fs.writeFileSync(path.join(dir, 'res', 'dock_bg.png'), 'x');
    }
    const tv = {running: options.running === true, scripts: [], neverStarts: options.neverStarts === true, clock: 1000000, log: options.log || '',
        client: options.client !== false, tvs: options.tvs !== false, dotnet: options.dotnet !== false, viewer: options.viewer !== false, pipe: options.pipe !== false, sent: [], starts: 0, stops: 0,
        failProbe: options.failProbe === true};
    const execute = async function (cmd) {
        tv.scripts.push(cmd);
        const script = Buffer.from(cmd.split(' ')[1], 'base64').toString();
        if (script.includes('systemd-run')) { tv.starts++; tv.started = script; tv.running = !tv.neverStarts; return {exit_code: 0, stdout: 'started\n'}; }
        if (script.includes('echo "tuner=')) {
            if (tv.failProbe) throw new Error('agent gone');
            return {exit_code: 0, stdout: (tv.running ? 'tuner=4242' : 'tuner=') + '\nclient=' + (tv.client ? 1 : 0) + '\ntvs=' + (tv.tvs ? 1 : 0) + '\ndotnet=' + (tv.dotnet ? 1 : 0) +
                '\nviewer=' + (tv.viewer ? 1 : 0) + '\nlog:\n' + tv.log + '\n'};
        }
        if (script.includes('kill -9')) { tv.running = false; tv.stops++; return {exit_code: 0, stdout: ''}; }
        if (script.includes('[ -p ' + CONTROL + ' ]')) {
            const word = /echo (\w+) > /.exec(script)[1];
            if (tv.pipe && tv.running) { tv.sent.push(word); return {exit_code: 0, stdout: 'sent\n'}; }
            return {exit_code: 0, stdout: 'none\n'};
        }
        throw new Error('unexpected command: ' + script);
    };
    const tuner = new Tuner({execute, dir, stateFile: path.join(tmp, 'state.json'), sleep: async ms => { tv.clock += ms; }, now: () => tv.clock});
    return {tuner, tv, tmp};
}
const decode = cmd => Buffer.from(cmd.split(' ')[1], 'base64').toString();

(async function () {
    // Not in the package: nothing to run, nothing touched.
    let f = fixture({installed: false});
    let s = await f.tuner.status();
    assert.equal(s.installed, false);
    await assert.rejects(f.tuner.enable(), /not in this Vetro package/);
    assert.equal(f.tv.scripts.length, 1, 'only the status probe ran');

    // The status of a TV that never had the tuner on.
    f = fixture();
    s = await f.tuner.status();
    assert.deepEqual([s.installed, s.enabled, s.running, s.supported, s.unsupportedReason, s.samsungTunerFound, s.target],
        [true, false, false, true, null, true, TARGET_APP]);

    // This TV cannot run it: refused with the reason, nothing started, nothing saved, and Samsung's tuner is left alone.
    for (const [opt, re] of [[{client: false}, /TV service client/], [{tvs: false}, /tvs-daemon/], [{dotnet: false}, /\.NET runtime/]]) {
        f = fixture(opt);
        s = await f.tuner.status();
        assert.equal(s.supported, false); assert.match(s.unsupportedReason, re);
        await assert.rejects(f.tuner.enable(), re);
        await assert.rejects(f.tuner.enable(), /Samsung.s tuner stays as it is/);
        assert.equal(f.tv.starts, 0, 'nothing started on a TV that cannot run it');
        assert.equal(f.tuner.readState().enabled, false);
    }
    assert.equal(unsupportedReason({dotnet: true, client: true, tvs: true}), null);

    // Switching on: probe, start, then the setting. The launch line is a resident, notification-level, takeover tuner with no test options.
    f = fixture();
    s = await f.tuner.enable();
    assert.equal(s.enabled, true); assert.equal(s.running, true);
    assert.ok(f.tuner.readState().since > 0);
    const line = f.tv.started;
    assert.match(line, /systemd-run --unit=vetro-tuner --collect/);
    assert.match(line, /dotnet vetro-tuner\.dll --resident --notif --control \/tmp\/vetro-tuner\.ctl --log \/home\/owner\/vetro-tuner\.log --pid-file \/home\/owner\/vetro-tuner\.pid --takeover org\.tizen\.tv-viewer/);
    for (const test of ['--seconds', '--hold', '--backdrop', '--shm', '--close-target']) assert.ok(!line.includes(test), test + ' is not on the launch line');
    assert.ok(line.includes("WorkingDirectory='" + f.tuner.dir + "'"), 'the folder with the res/ pictures is the working directory');
    assert.ok(line.includes('KillSignal=SIGKILL'));
    assert.ok(line.indexOf('systemctl stop vetro-tuner') < line.indexOf('systemd-run'), 'an old process is stopped before the new start');

    // Samsung's tuner is never disabled, uninstalled, closed or changed by turning the tuner on or off.
    s = await f.tuner.disable();
    assert.equal(s.enabled, false); assert.equal(s.running, false);
    for (const cmd of f.tv.scripts) {
        const text = decode(cmd);
        assert.ok(!/pkgcmd|app_launcher|aul_test|org\.tizen\.tv-viewer.*(-D|disable|kill|-u)/.test(text.replace(/--takeover org\.tizen\.tv-viewer/, '')), 'no command touches Samsung’s tuner: ' + text.split('\n').pop());
    }

    // A start that never shows up: the error is told, the process stopped again, and the setting stays off.
    f = fixture({neverStarts: true, log: 'boom'});
    await assert.rejects(f.tuner.enable(), /did not start\. Last log lines: boom/);
    assert.equal(f.tuner.readState().enabled, false);
    assert.ok(f.tv.stops >= 1 || f.tv.scripts.some(c => decode(c).includes('systemctl stop')), 'the failed start was cleaned up');
    s = await f.tuner.status(); assert.match(s.error, /did not start/);
    assert.equal(f.tuner.busy, false);

    // Busy: a second change at the same time is refused.
    f = fixture();
    const first = f.tuner.enable();
    await assert.rejects(f.tuner.disable(), /in progress/);
    await first;

    // Samsung's app is never closed: an old saved closeSamsung option is ignored and adds nothing to the launch line.
    f = fixture();
    fs.writeFileSync(path.join(f.tmp, 'state.json'), JSON.stringify({enabled: true, since: 1, closeSamsung: true}));
    assert.deepEqual(f.tuner.readState(), {enabled: true, since: 1});
    assert.ok(!f.tuner.startScript().includes('--close-target'));
    assert.equal(typeof f.tuner.setCloseSamsung, 'undefined');

    // Commands to a running tuner: only the known words, only while on, only through an existing pipe.
    f = fixture();
    await assert.rejects(f.tuner.command('show'), /Turn the tuner on first/);
    await f.tuner.enable();
    assert.deepEqual(await f.tuner.command('show'), {ok: true, command: 'show'});
    await f.tuner.command('guide'); await f.tuner.command('hide');
    assert.deepEqual(f.tv.sent, ['show', 'guide', 'hide']);
    for (const bad of ['quit', 'tune 5', 'key 28', 'show; reboot', '__proto__', 'constructor', undefined]) await assert.rejects(f.tuner.command(bad), /Invalid tuner command/);
    f.tv.pipe = false;
    await assert.rejects(f.tuner.command('show'), /not running yet/);

    // Supervision: nothing while off, with the agent away, or while another change runs; a start after a crash; back-off after failures.
    f = fixture();
    assert.equal(await f.tuner.supervise(true), null, 'off: nothing');
    await f.tuner.enable();
    f.tv.running = false;
    f.tv.scripts.length = 0;
    assert.equal(await f.tuner.supervise(false), null, 'agent away: nothing'); assert.equal(f.tv.scripts.length, 0);
    assert.equal(await f.tuner.supervise(true), 'started', 'a crashed tuner is started again');
    assert.equal(await f.tuner.supervise(true), 'running');
    f.tv.running = false; f.tv.neverStarts = true;
    assert.equal(await f.tuner.supervise(true), 'failed');
    assert.equal(f.tuner.failures, 1);
    f.tv.scripts.length = 0;
    assert.equal(await f.tuner.supervise(true), null, 'the back-off holds the next try');
    assert.equal(f.tv.scripts.length, 0);
    f.tv.clock += 31000;
    f.tv.neverStarts = false;
    assert.equal(await f.tuner.supervise(true), 'started', 'after the back-off it tries again');
    assert.equal(f.tuner.failures, 0); assert.equal(f.tuner.lastError, null);
    assert.equal(f.tuner.readState().enabled, true, 'failures never switch the tuner off');
    for (let i = 0; i < 5; i++) { f.tv.running = false; f.tv.neverStarts = true; f.tv.clock += 400000; await f.tuner.supervise(true); }
    assert.match(f.tuner.lastError, /has not started after 5 tries; Vetro keeps trying/);
    assert.equal(f.tuner.readState().enabled, true);
    // a probe that cannot reach the agent is a failure of that round, not an exception
    f = fixture(); await f.tuner.enable(); f.tv.failProbe = true;
    assert.equal(await f.tuner.supervise(true), 'failed');

    // Restart after an update: needs the tuner on.
    f = fixture();
    await assert.rejects(f.tuner.restart(), /The tuner is off/);
    await f.tuner.enable();
    const starts = f.tv.starts;
    await f.tuner.restart();
    assert.equal(f.tv.starts, starts + 1);

    // The stop only kills a process whose command line is our assembly, and removes the pipe with it.
    const stop = f.tuner.stopLines();
    assert.match(stop, /grep -q vetro-tuner\.dll; then kill -9 \$p/);
    assert.ok(stop.includes('rm -f /home/owner/vetro-tuner.pid /tmp/vetro-tuner.ctl'));

    // A state file that is garbage reads as off.
    f = fixture();
    fs.writeFileSync(path.join(f.tmp, 'state.json'), '{nope');
    assert.deepEqual(f.tuner.readState(), {enabled: false, since: null});
    console.log('tuner: ok');
})().catch(e => { console.error(e); process.exit(1); });
