'use strict';
// The launcher's and the tuner's supervision, as the root agent sees it:
//  - a round on a running part sends only the cheap check (one shell), never the full probe (about ten processes);
//  - "not running" from the cheap check is confirmed by the full probe before a start; a live pid that the cheap check did
//    not recognise goes to the full probe, and if the full probe finds it running the cheap check is not used again;
//  - the plugin's rounds slow down from 10 s to 30 s and 60 s while the part keeps running, never more than 60 s apart, and go
//    back to 10 s at once after an action, the agent coming back, a round that did not find it running, or a start/stop;
//  - the custom launcher's app is looked up about once a minute by the clock, whatever the pace of the rounds;
//  - the launcher's state file is parsed again only when it changed (it is read on every forwarded remote key).
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path');
const {Dock} = require('../service/dock.js');
const {Tuner} = require('../service/tuner.js');
const launcherPlugin = require('../service/plugin-launcher.js');
const tunerPlugin = require('../service/plugin-tuner.js');

function decode(cmd) { const m = /^echo (\S+) \| base64 -d \| sh$/.exec(cmd); return m ? Buffer.from(m[1], 'base64').toString() : cmd; }
function kind(cmd) {
    const s = decode(cmd);
    if (!/^echo /.test(cmd) && /read -r -d ''/.test(s)) return 'check';
    if (/tail -n 6/.test(s)) return 'probe';
    if (/systemd-run/.test(s)) return 'start';
    if (/app_launcher -k/.test(s)) return 'kill';
    return 'other';
}
function dockFixture(options) {
    options = options || {};
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-cadence-'));
    const dir = path.join(tmp, 'dock');
    fs.mkdirSync(path.join(dir, 'res'), {recursive: true});
    fs.writeFileSync(path.join(dir, 'tvlauncher-dotnet.dll'), 'x');
    fs.writeFileSync(path.join(dir, 'res', 'glass_tile.png'), 'x');
    fs.writeFileSync(path.join(tmp, 'apps.tsv'), 'yt\tYouTube\tyoutube.app\n');
    const tv = {running: options.running !== false, commands: [], clock: 1000000, cheapSays: null};
    const execute = async function (cmd) {
        const k = kind(cmd); tv.commands.push(k);
        if (k === 'check') return {exit_code: 0, stdout: tv.cheapSays || (tv.running ? 'dock=4242\n' : 'dock=\n')};
        if (k === 'probe') return {exit_code: 0, stdout: (tv.running ? 'dock=4242' : 'dock=') + '\nhome=0\nlog:\n\n'};
        if (k === 'start') { tv.running = true; return {exit_code: 0, stdout: 'started\n'}; }
        return {exit_code: 0, stdout: ''};
    };
    fs.writeFileSync(path.join(tmp, 'state.json'), JSON.stringify(Object.assign({enabled: true, showHomeSources: false, useSourceImages: false}, options.state || {})));
    const dock = new Dock({execute, dir, stateFile: path.join(tmp, 'state.json'), appsFile: path.join(tmp, 'apps.tsv'), appCheck: options.appCheck,
        sleep: async ms => { tv.clock += ms; }, now: () => tv.clock, uptime: () => 100000, serviceStart: options.serviceStart || 400, build: null});
    return {dock, tv, tmp};
}
function count(list, k) { return list.filter(x => x === k).length; }

// A plugin driven by a fake clock: the interval is called by hand, one tick = 2 s.
function drive(definition, part, connected) {
    let tick = null;
    const timers = {setInterval: (fn) => { tick = fn; return {}; }, clearInterval: () => { tick = null; }};
    const plugin = definition(part, {timers}).create({vetro: {agentConnected: () => connected(), json() {}, readJson() {}}});
    plugin.start();
    return {plugin, tick: () => tick()};
}
const settle = () => new Promise(r => setImmediate(r));

(async function () {
    // --- cheap rounds ----------------------------------------------------------------------------------------------
    {
        const f = dockFixture();
        for (let i = 0; i < 5; i++) assert.equal(await f.dock.supervise(true), 'running');
        assert.deepEqual(f.tv.commands, ['check', 'check', 'check', 'check', 'check'], 'a running launcher costs one cheap check per round: ' + f.tv.commands);
        // Crashed: the cheap check says "not running", the full probe confirms it, then the launcher is started.
        f.tv.running = false; f.tv.commands = [];
        assert.equal(await f.dock.supervise(true), 'started');
        assert.deepEqual(f.tv.commands.slice(0, 3), ['check', 'probe', 'start'], 'not running is confirmed before a start: ' + f.tv.commands);
        assert.equal(f.tv.commands.indexOf('probe', 2), -1, 'the start wait polls with the cheap check: ' + f.tv.commands);
        // The cheap check is wrong (a shell that cannot read the fields says "other" for our own pid): the full probe answers,
        // no start is sent, and the full probe is used from then on.
        f.tv.running = true; f.tv.cheapSays = 'dock=\nother=4242\n'; f.tv.commands = [];
        assert.equal(await f.dock.supervise(true), 'running');
        assert.deepEqual(f.tv.commands, ['check', 'probe']);
        assert.equal(f.dock.cheapBroken, true);
        assert.equal((await f.dock.status()).runningCheck, 'full', 'the status says which check is in use');
        f.tv.commands = [];
        await f.dock.supervise(true);
        assert.deepEqual(f.tv.commands, ['probe'], 'after a contradiction only the full probe');
        // Once after the boot window the full probe looks at Samsung's idle Home (closeHomeOnce); then cheap again.
        const g = dockFixture({serviceStart: 50});
        let up = 100; g.dock.uptime = () => up;
        await g.dock.supervise(true);
        up = 400; g.tv.commands = [];
        await g.dock.supervise(true); await g.dock.supervise(true);
        assert.deepEqual(g.tv.commands, ['check', 'probe', 'check'], 'one full probe after the boot window, for Samsung Home: ' + g.tv.commands);
        // The dashboard's status still reads the full probe.
        g.tv.commands = [];
        const s = await g.dock.status();
        assert.equal(s.running, true); assert.equal(typeof s.samsungHome, 'boolean');
        assert.deepEqual(g.tv.commands, ['probe']);
        console.log('PASS launcher supervision: one cheap check per round while running; full probe before a start, for the dashboard, and after a contradiction');
    }
    {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-cadence-tuner-'));
        const dir = path.join(tmp, 'tuner');
        fs.mkdirSync(path.join(dir, 'res'), {recursive: true});
        fs.writeFileSync(path.join(dir, 'vetro-tuner.dll'), 'x'); fs.writeFileSync(path.join(dir, 'res', 'veil_corner.png'), 'x');
        fs.writeFileSync(path.join(tmp, 'state.json'), JSON.stringify({enabled: true}));
        const tv = {running: true, commands: [], clock: 0};
        const tuner = new Tuner({dir, stateFile: path.join(tmp, 'state.json'), featuresFile: path.join(tmp, 'features'), uptime: () => 100, serviceStart: 40,
            sleep: async ms => { tv.clock += ms; }, now: () => tv.clock, execute: async cmd => {
                const s = decode(cmd), k = !/^echo /.test(cmd) && /read -r -d ''/.test(s) ? 'check' : /tail -n 6/.test(s) ? 'probe' : /systemd-run/.test(s) ? 'start' : 'other';
                tv.commands.push(k);
                if (k === 'check') return {exit_code: 0, stdout: tv.running ? 'tuner=77\n' : 'tuner=\n'};
                if (k === 'probe') return {exit_code: 0, stdout: (tv.running ? 'tuner=77' : 'tuner=') + '\nclient=1\ntvs=1\ndotnet=1\nviewer=1\nclientver=\nlog:\n\n'};
                if (k === 'start') { tv.running = true; return {exit_code: 0, stdout: 'started\n'}; }
                return {exit_code: 0, stdout: ''};
            }});
        for (let i = 0; i < 3; i++) assert.equal(await tuner.supervise(true), 'running');
        assert.deepEqual(tv.commands, ['check', 'check', 'check']);
        tv.running = false; tv.commands = [];
        assert.equal(await tuner.supervise(true), 'started');
        assert.deepEqual(tv.commands.slice(0, 3), ['check', 'probe', 'start']);
        const t = (await tuner.status()).bootTimeline;
        assert.equal(t.serviceStart, 40); assert.equal(t.agentSeen, 100); assert.equal(t.running, 100); assert.equal(t.startIssued, 100); assert.equal(typeof t.startCallMs, 'number');
        console.log('PASS tuner supervision: cheap check per round, full probe before a start; first-start times in the status (bootTimeline)');
    }

    // --- cadence of the plugin's rounds ----------------------------------------------------------------------------
    for (const [name, definition] of [['launcher', launcherPlugin.definition], ['tuner', tunerPlugin.definition]]) {
        let result = 'running', connected = true;
        const part = {changes: 0, rounds: [], readState: () => ({enabled: true}), installed: () => true,
            supervise(up) { this.rounds.push(now); return Promise.resolve(up ? result : null); }};
        let now = 0;
        const d = drive(definition, part, () => connected);
        async function run(seconds) { for (let i = 0; i < seconds / 2; i++) { now += 2; d.tick(); await settle(); } }
        await run(600);
        const gaps = part.rounds.slice(1).map((t, i) => t - part.rounds[i]);
        assert.equal(part.rounds[0], 2, 'the connect edge supervises at once');
        assert.ok(Math.max.apply(null, gaps) <= 60, name + ': never more than a minute between checks: ' + gaps);
        assert.deepEqual(gaps.slice(0, 2), [10, 10], name + ': 10 s at first (three rounds found running before each step)');
        assert.ok(gaps.includes(30) && gaps[gaps.length - 1] === 60, name + ': then 30 s, then 60 s: ' + gaps);
        assert.ok(part.rounds.length <= 20, name + ': ten minutes of a running part are at most 20 rounds, not 60: ' + part.rounds.length);
        // A start or stop of the process (an update, a dashboard action that restarted it): 10 s again at once.
        part.changes++; part.rounds = [];
        await run(2);
        assert.equal(part.rounds.length, 1, name + ': a change is checked at the next tick');
        await run(30);
        assert.deepEqual(part.rounds.slice(1).map((t, i) => t - part.rounds[i]).slice(0, 2), [10, 10], name + ': and at the short pace');
        // A round that does not find it running (a failure, a start) keeps the short pace.
        await run(120); result = 'failed'; part.rounds = [];
        await run(120);
        assert.ok(part.rounds.slice(1).map((t, i) => t - part.rounds[i]).slice(1).every(g => g === 10), name + ': failures stay at 10 s');
        // The agent coming back (after a wake): at once, and at the short pace.
        result = 'running'; await run(300);
        connected = false; await run(10); connected = true; part.rounds = [];
        await run(2);
        assert.equal(part.rounds.length, 1, name + ': the reconnect edge supervises at once');
        // An action from the dashboard: the next round comes at the short pace.
        await run(300); part.rounds = [];
        d.plugin.route({method: 'POST', url: '/'}, {}, 'action');
        await run(12);
        assert.ok(part.rounds.length >= 1, name + ': an action brings the next round within 10 s');
        d.plugin.stop();
    }
    console.log('PASS supervision cadence: 10 s, then 30 s and 60 s while running (never more than a minute), back to 10 s after a change, a failure, a reconnect or an action');

    // --- the custom launcher's app lookup is by time ---------------------------------------------------------------
    {
        const looked = [];
        const f = dockFixture({state: {enabled: false, customApp: 'com.example.launcher'}, appCheck: async id => { looked.push(f.tv.clock); return {ok: true, label: id}; }});
        for (let i = 0; i < 7; i++) { await f.dock.supervise(true); f.tv.clock += 10000; }       // fast rounds, 0 to 60 s: once, at 60 s
        assert.equal(looked.length, 1, 'about once a minute at a 10 s pace: ' + looked.length);
        for (let i = 0; i < 5; i++) { await f.dock.supervise(true); f.tv.clock += 60000; }       // slow rounds, 70 s to 310 s: at 130, 190, 250, 310 s
        assert.equal(looked.length, 5, 'and once per round at a 60 s pace: ' + looked.length);
        console.log('PASS custom launcher: its app is looked up about once a minute by the clock, at any pace of the rounds');
    }

    // --- state file cache ------------------------------------------------------------------------------------------
    {
        const f = dockFixture({state: {enabled: true, volumePill: true}});
        const real = fs.readFileSync;
        let reads = 0;
        fs.readFileSync = function (p) { if (p === f.dock.stateFile) reads++; return real.apply(fs, arguments); };
        try {
            for (let i = 0; i < 50; i++) assert.equal(f.dock.readState().volumePill, true);
            assert.equal(reads, 1, 'fifty reads of an unchanged state parse the file once');
            f.dock.patchState({volumePill: false});
            assert.equal(f.dock.readState().volumePill, false, 'a write through writeState is seen at once');
            // A write by someone else (a test, a restore) in place, same size: seen through the stat.
            const st = fs.statSync(f.dock.stateFile);
            fs.writeFileSync(f.dock.stateFile, real(f.dock.stateFile, 'utf8').replace('"volumePill":false', '"volumePill":true '));
            fs.utimesSync(f.dock.stateFile, st.atime, new Date(st.mtime.getTime() + 5000));
            assert.equal(f.dock.readState().volumePill, true, 'a write by another hand is seen');
            const state = f.dock.readState(); state.enabled = 'changed by a caller';
            assert.equal(f.dock.readState().enabled, true, 'callers get their own copy');
            fs.unlinkSync(f.dock.stateFile);
            assert.equal(f.dock.readState().enabled, false, 'a removed file reads as the defaults');
        } finally { fs.readFileSync = real; }
        // The source-option migration reads the two lists only when the state lacks the two booleans.
        let listReads = 0;
        fs.readFileSync = function (p) { if (/apps\.tsv|inputs\.tsv/.test(String(p))) listReads++; return real.apply(fs, arguments); };
        try {
            const g = dockFixture({state: {enabled: true}});
            listReads = 0; g.dock.readState(); g.dock.readState();
            assert.equal(listReads, 0, 'a state with both booleans reads no list');
            const h = new Dock({execute: g.dock.execute, dir: g.dock.dir, stateFile: path.join(g.tmp, 'old.json'), appsFile: g.dock.appsFile});
            fs.writeFileSync(path.join(g.tmp, 'old.json'), JSON.stringify({enabled: true}));
            listReads = 0; h.readState(); h.readState(); h.readState();
            assert.equal(listReads, 1, 'an old state reads the list once');
        } finally { fs.readFileSync = real; }
        console.log('PASS launcher state: parsed once while unchanged, a change by any hand is seen, the source migration reads the lists only for an old state');
    }
    {
        // A check that fails outright (a shell that refuses the line) is answered by the full probe, and given up after
        // two rounds in a row; one failure alone (a timeout on a busy TV) is not enough.
        for (const Part of [Dock, Tuner]) {
            const sent = []; let refuse = true;
            const part = new Part({stateFile: path.join(os.tmpdir(), 'vetro-cadence-none-' + process.pid + '.json'), execute: function (cmd) {
                sent.push(kind(cmd));
                if (kind(cmd) === 'check') return Promise.resolve(refuse ? {exit_code: 2, stderr: 'syntax error'} : {exit_code: 0, stdout: 'dock=7\ntuner=7\n'});
                return Promise.resolve({exit_code: 0, stdout: 'dock=7\ntuner=7\nhome=0\nlog:\n'});
            }});
            assert.equal((await part.runningNow()).running, true, 'the probe answers for a failed check');
            assert.equal(part.cheapBroken, false, 'one failure keeps the check');
            refuse = false; await part.runningNow(); refuse = true;
            await part.runningNow();
            assert.equal(part.cheapBroken, false, 'a good round in between starts the count again');
            await part.runningNow();
            assert.equal(part.cheapBroken, true, 'two failures in a row give the check up');
            sent.length = 0; await part.runningNow();
            assert.deepEqual(sent, ['probe'], 'from then on only the full probe is sent');
        }
        console.log('PASS a check that fails outright: the full probe answers, and the check is given up after two failures in a row');
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
