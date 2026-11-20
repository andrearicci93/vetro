'use strict';
// The firmware section of the diagnostic export: the script the service sends to the TV, run by a real shell against fake vconftool,
// busctl and readlink, and what the report keeps of it. Plus the tuner's log lines and the launcher's new event shapes.
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const {execFileSync} = require('child_process');
const report = require('../service/diagnostic-report.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-fwdiag-'));
const bin = path.join(dir, 'bin');
fs.mkdirSync(bin);
// A Tizen 9 TV booted into tv-viewer with Samsung's Home picture still set, sound on optical, the guides cleared by the boot.
const vconf = {
    'db/appfw/is_root_cold_boot': '1 (Int32)', 'db/appfw/home_appid': 'com.samsung.tv.csfs (String)', 'db/menu/smart_hub/ontvsetting/auto_start': '0 (Int32)',
    'db/menu/app_booting': '0 (Int32)', 'memory/volt/firstscreen_state': '1 (Int32)', 'memory/eden/show_status': 'none (String)',
    'memory/appfw/current_fullscreen_appid': 'org.tizen.netflix-app (String)', 'memory/avoc/home_shown': '1 (Int32)',
    'file/private/sound/feature/SpeakerSelection': '1 (Int32)', 'memory/pm/state': '1 (Int32)', 'db/menu/system/auto_protection_time': '2 (Int32)',
    'memory/volume-app/key_guide_status': '0 (Bool)', 'memory/tv-viewer/key_guide_status': '1 (Bool)', 'db/btapp/oob_status': '5 (Int32)',
    'db/menu/settings_menu_guide': '1 (Bool)'
};
fs.writeFileSync(path.join(bin, 'vconftool'), '#!/bin/sh\ncase "$2" in\n' +
    Object.keys(vconf).map(k => '  ' + k + ') echo "' + k + ', value = ' + vconf[k] + '";;').join('\n') + '\n  *) exit 1;;\nesac\n', {mode: 0o755});
fs.writeFileSync(path.join(bin, 'busctl'), '#!/bin/sh\necho "ii 327705 0"\n', {mode: 0o755});
fs.writeFileSync(path.join(bin, 'readlink'), '#!/bin/sh\necho /usr/share/dotnet/shared/Microsoft.NETCore.App/6.0.9/\n', {mode: 0o755});

const service = require('./service-harness.cjs')(path.resolve(__dirname, '..'));
vm.runInContext(`
state={settings:{model:'Q65D'}};
inventory=function(){return Promise.resolve({apps:[]});};
tvSettings.read=function(){return Promise.resolve({items:[]});};
tvSettings.readNetwork=function(){return Promise.resolve({services:[]});};
menuSettings.load=function(){return Promise.resolve({items:[]});};
monitor.snapshot=function(){return Promise.resolve({processes:[]});};
monitor.startup=function(){return Promise.resolve([]);};
dnsFilter.status=function(){return Promise.resolve({enabled:false});};
privacy.read=function(){return Promise.resolve({});};
`, service.context);
service.context.agentExecute = function (command) {
    const m = /^echo (\S+) \| base64 -d \| sh$/.exec(command);
    if (!m) return Promise.reject(Error('not in this test'));
    const script = Buffer.from(m[1], 'base64').toString();
    if (script.indexOf('rootApp|') < 0) return Promise.reject(Error('not in this test'));
    return Promise.resolve({exit_code: 0, stdout: execFileSync('/bin/sh', ['-c', script], {env: {PATH: bin + ':/usr/bin:/bin'}}).toString()});
};
function request() {
    return new Promise(resolve => {
        const res = {setHeader() {}, writeHead(code) { res.code = code; }, end: text => resolve(JSON.parse(text))};
        service.router({method: 'GET', url: '/diagnostics/download', headers: {}}, res);
    });
}

(async () => {
    try {
        const r = await request();
        const f = r.sections.firmware;
        assert.equal(f.status, 'ok', JSON.stringify(f));
        const d = f.data;
        assert.equal(d.rootApp, false, 'this Mac has no get_root_app');
        assert.equal(d.rootColdBoot, 1); assert.equal(d.homeApp, 'com.samsung.tv.csfs'); assert.equal(d.autoStart, 0); assert.equal(d.appBooting, 0);
        assert.equal(d.firstscreenState, 1); assert.equal(d.showStatus, 'none');
        assert.equal(d.front, 'other', 'the app in front is a kind, never its id');
        assert.ok(JSON.stringify(r).indexOf('netflix') < 0, 'no app id of the user anywhere in the report');
        assert.equal(d.homeShown, 1); assert.equal(d.pictureMode, 327705); assert.equal(d.pictureModeResult, 0);
        assert.equal(d.speakerSelection, 1, 'optical'); assert.equal(d.displayState, 1); assert.equal(d.autoProtection, 2); assert.equal(d.screensaverOn, null);
        assert.equal(JSON.stringify(d.keyGuides), JSON.stringify({volume: false, viewer: true, viewerDb: null, settingsMenuGuide: true, oobStatus: 5}));
        assert.equal(d.dotnetRuntime, '6.0.9'); assert.equal(d.inputHelpers, 0); assert.ok(d.uptimeMinutes === null || Number.isInteger(d.uptimeMinutes), 'minutes, or nothing without /proc');
        // The projector on its own: hostile or odd values become null or a fixed word.
        const p = report.projectors.firmware({homeApp: 'evil;rm', front: 'com.samsung.tv.csfs', showStatus: '<x>', pictureMode: 'ii 1 2 3', speakerSelection: '1e9',
            netcoreapp: '/etc/passwd', rootApp: 'yes', inputHelpers: '-1'});
        assert.equal(p.homeApp, 'other'); assert.equal(p.front, 'samsung-home'); assert.equal(p.showStatus, 'other'); assert.equal(p.pictureMode, null);
        assert.equal(p.speakerSelection, null); assert.equal(p.dotnetRuntime, null); assert.equal(p.rootApp, null); assert.equal(p.inputHelpers, null);
        assert.equal(report.projectors.firmware({front: 'vetrotvapp.app'}).front, 'vetro');
        assert.equal(report.projectors.firmware({front: 'org.tizen.tv-viewer'}).front, 'tv-viewer');

        // The tuner's log: fixed shapes, the channel name cut, an exception's message cut.
        const ev = report.projectors.tuner({tunerLog: [
            '+24ms start pid=4321 resident', '+33ms elm_init start', '+136ms elm_init done',
            '+507ms tvs: current r=1 [connect=62 total=290] -> 1 Rai 1',
            '+535ms tvs: client /usr/share/dotnet.tizen/framework/Tizen.TV.Broadcast.TVService.dll 1.3.15.0',
            '+10535ms tvs: no answer from the TV service after 10 s',
            '+600ms tvs worker: System.ArgumentException: Object of type System.Int32 cannot be converted /home/owner/x',
            '+700ms tvs: something private /home/owner/secret', 'garbage'
        ].join('\n')}).events;
        assert.deepEqual(ev.map(e => e.line), ['start pid=4321 resident', 'elm_init start', 'elm_init done', 'tvs: current r=1 [connect=62 total=290]',
            'tvs: client /usr/share/dotnet.tizen/framework/Tizen.TV.Broadcast.TVService.dll 1.3.15.0', 'tvs: no answer from the TV service after 10 s',
            'tvs worker: System.ArgumentException']);
        assert.equal(ev[2].ms, 136);
        assert.ok(JSON.stringify(ev).indexOf('Rai') < 0 && JSON.stringify(ev).indexOf('/home/') < 0, 'no channel name, no home path');
        // Its window and the last show / takeover lines, and its threads (S95B: which thread stops, and where).
        const tw = report.projectors.tuner({tunerLog: ['+500ms window up engine=wayland_egl', '+900ms takeover: org.tizen.tv-viewer status first -> 3 (tuner hidden)',
            "+901ms not shown: no channel list yet, Samsung's live TV keeps the screen", '+950ms shown', '+960ms takeover: failed /home/owner/x',
            '+970ms resume: not on live TV (status 3, tv input True)'].join('\n'),
            tunerThreads: ['vetro-tuner.dll|D|mali_ioctl|__switch_to mali_kbase_ioctl /home/x', 'tvs|S|futex_wait_queue_me|', '.NET ThreadPool|S|0|', 'bad|name|Q|', '/home/x|S|f|', 'junk'].join('\n')});
        assert.deepEqual(tw.events.map(e => e.line), ['window up engine=wayland_egl', 'takeover: org.tizen.tv-viewer status first -> 3 (tuner hidden)',
            "not shown: no channel list yet, Samsung's live TV keeps the screen", 'shown', 'resume: not on live TV (status 3, tv input True)']);
        assert.deepEqual(tw.threads, [{name: 'vetro-tuner.dll', state: 'D', wait: 'mali_ioctl', stack: ['__switch_to', 'mali_kbase_ioctl']},
            {name: 'tvs', state: 'S', wait: 'futex_wait_queue_me', stack: null}, {name: '.NET ThreadPool', state: 'S', wait: null, stack: null}]);
        assert.deepEqual(report.projectors.tuner({}).threads, []);

        // The launcher's new shapes: the Samsung Home pill and the screen off; other launches (app ids of the user) stay out.
        const lv = report.projectors.launcher({keyLog: ['10:00:00.000 launch com.samsung.tv.csfs rc=0', '10:00:01.000 screen: off ok',
            '10:00:02.000 launch org.tizen.netflix-app rc=0', '10:00:03.000 launch 5exPmCT0nz.svtplay via HbbTV request 42 ms', '10:00:04.000 launch via HbbTV failed: 5exPmCT0nz.svtplay',
            '10:00:05.000 home: claim granted', '10:00:05.500 home: window keys on', '10:00:06.000 home: claimed press from the window', '10:00:07.000 home claim: EntryPointNotFoundException /opt/x'].join('\n'), bootTimeline: {serviceStart: 95.2, shownAtPowerOn: 140.1, secret: 'x'}});
        assert.deepEqual(lv.events, ['launch com.samsung.tv.csfs rc=0', 'screen: off ok', 'launch via HbbTV request 42 ms', 'launch via HbbTV failed',
            'home: claim granted', 'home: window keys on', 'home: claimed press from the window'], 'the Home claim (#184) in fixed words; its exception text stays out');
        assert.ok(JSON.stringify(lv).indexOf('svtplay') < 0, 'the HbbTV launches keep no app id');
        assert.equal(JSON.stringify(lv.bootTimeline), JSON.stringify({serviceStart: 95.2, agentSeen: null, shownAtPowerOn: 140.1}));
        // The Audio card's switches by output name; a Bluetooth address or a free error text never passes.
        const out = report.projectors.launcher({keyLog: ['10:00:00.000 outputs: UseTv TV speakers ok', '10:00:01.000 outputs: UseExternal Optical ok',
            '10:00:02.000 outputs: UseExternal Optical refused (rc -22)', '10:00:03.000 outputs: Connect AA:BB:CC:DD:EE:FF ok',
            '10:00:04.000 outputs: UseExternal Optical refused (/home/owner/x)'].join('\n')}).events;
        assert.deepEqual(out, ['outputs: UseTv TV speakers ok', 'outputs: UseExternal Optical ok', 'outputs: UseExternal Optical refused (rc -22)']);
        // The launcher's openings and their timings: fixed names and numbers; anything else is dropped.
        const op = report.projectors.launcher({openLog: ['10:00:00.000 perf open home: frames=14 key to first tick ms=180.2 to first frame ms=231.0 to last frame ms=512.7 handler ms=95.4 interval ms max=61.3',
            '10:00:05.000 perf open control center: frames=9 key to first tick ms=40.0 to first frame ms=60.5 to last frame ms=300.1 handler ms=12.0 interval ms max=40.2',
            '10:00:06.000 perf open /home/owner: frames=1 key to first tick ms=1.0 to first frame ms=1.0 to last frame ms=1.0 handler ms=1.0 interval ms max=1.0', 'garbage'].join('\n')}).openings;
        assert.deepEqual(JSON.parse(JSON.stringify(op)), [{what: 'home', frames: 14, firstFrameMs: 231, lastFrameMs: 512.7, handlerMs: 95.4, maxGapMs: 61.3},
            {what: 'control center', frames: 9, firstFrameMs: 60.5, lastFrameMs: 300.1, handlerMs: 12, maxGapMs: 40.2}]);

        // Input: the keyed same-name nodes and whether the saved node is still there.
        const inp = report.projectors.input({keyedSameNameCount: 2, savedNodePresent: false});
        assert.equal(inp.keyedSameNameCount, 2); assert.equal(inp.savedNodePresent, false);
        console.log('PASS diagnostics firmware section: root app, Home and its picture mode, sound output, screen saver, key guides, runtime, helpers; tuner and launcher events');
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
})().catch(e => { console.error(e); process.exitCode = 1; });
