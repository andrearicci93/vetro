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
        fs.writeFileSync(path.join(dir, 'res', 'veil_corner.png'), 'x');
    }
    const tv = {running: options.running === true, scripts: [], neverStarts: options.neverStarts === true, clock: 1000000, log: options.log || '',
        client: options.client !== false, tvs: options.tvs !== false, dotnet: options.dotnet !== false, viewer: options.viewer !== false, pipe: options.pipe !== false, sent: [], starts: 0, stops: 0,
        failProbe: options.failProbe === true};
    const execute = async function (cmd) {
        tv.scripts.push(cmd);
        const script = /^echo \S+ \| base64 -d \| sh$/.test(cmd) ? Buffer.from(cmd.split(' ')[1], 'base64').toString() : cmd;   // the running check goes unwrapped
        if (script.includes('systemd-run')) { tv.starts++; tv.started = script; tv.running = !tv.neverStarts; return {exit_code: 0, stdout: 'started\n'}; }
        if (script.includes('echo "tuner=')) {
            if (tv.failProbe) throw new Error('agent gone');
            return {exit_code: 0, stdout: (tv.running ? 'tuner=' + (tv.pid || 4242) : 'tuner=') + '\nclient=' + (tv.client ? 1 : 0) + '\ntvs=' + (tv.tvs ? 1 : 0) + '\ndotnet=' + (tv.dotnet ? 1 : 0) +
                '\nviewer=' + (tv.viewer ? 1 : 0) + '\nclientver=' + (tv.clientVersions === undefined ? '1.1.12,' : tv.clientVersions) + '\nlog:\n' + tv.log + '\n'};
        }
        if (script.includes('kill -9')) { tv.running = false; tv.stops++; return {exit_code: 0, stdout: ''}; }
        if (script.includes('[ -p ' + CONTROL + ' ]')) {
            const word = /echo (\w+) >&3/.exec(script)[1];
            assert.ok(script.includes('[ -d /proc/$p ]') && script.includes('exec 3<>' + CONTROL), 'the word goes only to a live tuner, through a write that cannot wait');
            if (tv.pipe && tv.running) { tv.sent.push(word); return {exit_code: 0, stdout: 'sent\n'}; }
            return {exit_code: 0, stdout: 'none\n'};
        }
        throw new Error('unexpected command: ' + script);
    };
    const tuner = new Tuner({execute, dir, stateFile: path.join(tmp, 'state.json'), featuresFile: path.join(tmp, 'features'), sleep: async ms => { tv.clock += ms; }, now: () => tv.clock});
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
    // What the diagnostic report learns about this TV: the four prerequisites and the version folders of Samsung's client (numbers only, five at most).
    assert.deepEqual(s.prerequisites, {dotnet: true, client: true, tvs: true, viewer: true});
    assert.deepEqual(s.clientVersions, ['1.1.12']);
    f.tv.clientVersions = '1.0.3,2.0,../etc,latest,1.1.12,1.2,1.3,1.4,';
    assert.deepEqual((await f.tuner.status()).clientVersions, ['1.0.3', '2.0', '1.1.12', '1.2', '1.3']);
    f.tv.clientVersions = '';
    assert.deepEqual((await f.tuner.status()).clientVersions, []);

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
    // The tuner has no per-part switches: on, it has all its parts. A list of parts left off by an older state is not read,
    // and the switches file it is started with holds nothing of the kind.
    f = fixture();
    fs.writeFileSync(path.join(f.tmp, 'state.json'), JSON.stringify({enabled: true, since: 1, off: ['banner', 'hold']}));
    assert.deepEqual(f.tuner.readState(), {enabled: true, since: 1});
    f.tuner.writeFeatures();
    assert.equal(fs.readFileSync(path.join(f.tmp, 'features'), 'utf8'), '');
    assert.equal(typeof f.tuner.setFeature, 'undefined');
    assert.ok(!('features' in (await f.tuner.status())), 'the status lists no parts');
    assert.ok(f.tuner.startScript().includes(' --features ' + "'" + path.join(f.tmp, 'features') + "'"));
    // Reduce motion is the launcher's setting: the tuner's switches file carries it, and it is not one of the tuner's own switches.
    f = fixture();
    let still = false;
    f.tuner.noMotion = () => still;
    f.tuner.writeFeatures();
    assert.equal(fs.readFileSync(f.tuner.featuresFile, 'utf8'), '');
    still = true;
    f.tuner.writeFeatures();
    assert.equal(fs.readFileSync(f.tuner.featuresFile, 'utf8'), 'motion=0\n');
    f.tuner.noMotion = () => { throw new Error('launcher state unreadable'); };
    f.tuner.writeFeatures();
    assert.equal(fs.readFileSync(f.tuner.featuresFile, 'utf8'), '', 'an unreadable launcher state leaves motion on');

    // A start script that outlives its wait is not a failed start when the tuner comes up from it (#179, as the launcher);
    // a warning left by a failed round clears once the tuner is seen running.
    f = fixture();
    await f.tuner.enable();
    f.tv.running = false; f.tuner.nextTry = 0;
    const exec = f.tuner.execute;
    f.tuner.execute = async (cmd, ms) => { const r = await exec(cmd, ms); return Buffer.from(cmd.split(' ')[1], 'base64').toString().includes('systemd-run') ? {exit_code: null, timed_out: true, stdout: ''} : r; };
    assert.equal(await f.tuner.supervise(true), 'started');
    assert.equal(f.tuner.lastError, null);
    f.tuner.execute = exec;
    f.tv.running = false; f.tv.neverStarts = true; f.tuner.nextTry = 0;
    assert.equal(await f.tuner.supervise(true), 'failed');
    assert.ok(f.tuner.lastError);
    f.tv.running = true; f.tuner.nextTry = 0;
    assert.equal(await f.tuner.supervise(true), 'running');
    assert.equal(f.tuner.lastError, null, 'the earlier warning clears once the tuner is seen running');

    // A tuner started by another build of Vetro is restarted once (the package installed again over a running one).
    f = fixture();
    await f.tuner.enable();
    const before = f.tv.starts;
    f.tuner.build = '0.5.1+abc'; f.tuner.startedHere = false;
    assert.equal(await f.tuner.supervise(true), 'started');
    assert.equal(f.tv.starts, before + 1);
    assert.equal(f.tuner.readState().build, '0.5.1+abc');
    assert.equal(await f.tuner.supervise(true), 'running');
    await f.tuner.restartAfterUpdate();
    assert.equal(f.tv.starts, before + 1, 'not started twice for the same build');
    // Go back, then the same update again: this build is in the state, but another process runs (the older Vetro's).
    assert.equal(f.tuner.readState().buildPid, 4242);
    f.tv.pid = 5151; f.tuner.startedHere = false;
    await f.tuner.restartAfterUpdate();
    assert.equal(f.tv.starts, before + 2, 'a tuner of the same build but another process is started again');
    assert.equal(f.tuner.readState().buildPid, 5151);
    f.tuner.startedHere = false;
    assert.equal(await f.tuner.supervise(true), 'running');
    assert.equal(f.tv.starts, before + 2, 'and left alone once it is the process this build started');

    // A start that replaces a running tuner (an update, another build) is quiet: its Banner does not come up by itself over
    // the programme. A start asked for from the dashboard, or of a tuner that was not running, shows it as ever.
    f = fixture();
    assert.ok(!f.tuner.startScript().includes('--quiet'));
    assert.ok(f.tuner.startScript(true).endsWith(' --quiet </dev/null >/dev/null 2>&1 &\necho started'), 'on both ways of starting it');
    assert.equal(f.tuner.startScript(true).split(' --quiet').length, 3);
    const startLines = [], run = f.tuner.execute;
    f.tuner.execute = async (cmd, ms) => { const text = Buffer.from(cmd.split(' ')[1], 'base64').toString(); if (text.includes('systemd-run')) startLines.push(text.includes(' --quiet')); return run(cmd, ms); };
    await f.tuner.enable();
    f.tv.running = false; f.tuner.nextTry = 0;
    assert.equal(await f.tuner.supervise(true), 'started');
    assert.deepEqual(startLines, [false, false], 'turned on, and started again after it died');
    f.tuner.build = '0.5.1+abc'; f.tuner.startedHere = false;
    assert.equal(await f.tuner.supervise(true), 'started');
    f.tv.pid = 5151; f.tuner.startedHere = false;
    await f.tuner.restartAfterUpdate();
    assert.deepEqual(startLines, [false, false, true, true], 'another build, and after an update');

    console.log('tuner: ok');
})().catch(e => { console.error(e); process.exit(1); });

// 2022 firmware keeps the client in the firmware's shared folder (no /opt/usr/dotnet/Tizen.TV.Broadcast.TVService at all): the check
// looks there too, as the tuner itself does (TvsClient.FixedDirs).
(function () {
    const {Tuner} = require('../service/tuner.js');
    let script = '';
    const t = new Tuner({execute: function (c) { script = Buffer.from(c.split(' ')[1], 'base64').toString(); return Promise.resolve({exit_code: 0, stdout: 'tuner=\nclient=1\ntvs=1\ndotnet=1\nviewer=1\nlog:\n'}); }});
    return t.probe().then(function (r) {
        assert.ok(script.indexOf('[ -e /usr/share/dotnet.tizen/framework/Tizen.TV.Broadcast.TVService.dll ]') >= 0, 'the framework copy counts');
        assert.ok(script.indexOf('[ -e /usr/apps/csapi-tv-tizenfx/shared/lib/Tizen.TV.Broadcast.TVService.dll ]') >= 0, 'and the csapi copy');
        assert.equal(r.client, true);
        console.log('tuner: the client in the firmware shared folder counts');
    });
})();

