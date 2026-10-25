'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const {Dock} = require('../service/dock.js');

const hex = s => Buffer.from(s).toString('hex');
const HOME_DATA = [
    'O|d/webapp@aaa',
    'R|' + hex('aaa') + '|' + hex('Netflix') + '|' + hex('org.tizen.netflix-app') + '|0',
    'I|aaa|/opt/share/webappservice/apps_icon/all/aaa/224x224.png'
].join('\n');

function fixture(options) {
    options = options || {};
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-dock-'));
    const dir = path.join(tmp, 'dock');
    if (options.installed !== false) {
        fs.mkdirSync(path.join(dir, 'res'), {recursive: true});
        fs.writeFileSync(path.join(dir, 'tvlauncher-dotnet.dll'), 'x');
        fs.writeFileSync(path.join(dir, 'res', 'glass_tile.png'), 'x');
    }
    const tv = {autorun: options.autorun == null ? 1 : options.autorun, running: options.running === true, scripts: [], neverStarts: options.neverStarts === true, csfs: true, clock: 1000000,
        homeData: options.homeData == null ? HOME_DATA : options.homeData, log: options.log || ''};
    const execute = async function (cmd) {
        tv.scripts.push(cmd);
        if (/^app_launcher -k /.test(cmd)) { tv.csfs = false; return {exit_code: 0, stdout: ''}; }
        const script = Buffer.from(cmd.split(' ')[1], 'base64').toString();
        if (script.includes('vconftool set') && script.includes('auto_start')) { tv.autorun = +/auto_start (\d)/.exec(script)[1]; return {exit_code: 0, stdout: ''}; }
        if (script.includes('vconftool get') && script.includes('auto_start')) return {exit_code: 0, stdout: 'db/menu/smart_hub/ontvsetting/auto_start, value = ' + tv.autorun + ' (Int32)\n'};
        if (script.includes('.appLayerCache')) return {exit_code: 0, stdout: tv.homeData};
        if (script.includes('setsid nohup')) { tv.started = script; if (!tv.neverStarts) tv.running = true; return {exit_code: 0, stdout: 'started\n'}; }
        if (script.includes('kill -9') && !script.includes('echo "dock=')) { tv.running = false; tv.stopped = (tv.stopped || 0) + 1; return {exit_code: 0, stdout: ''}; }
        if (script.includes('echo "dock=')) return {exit_code: 0, stdout: (tv.running ? 'dock=4242' : 'dock=') + '\nhome=' + (tv.csfs ? 1 : 0) + '\nlog:\n' + tv.log + '\n'};
        throw new Error('unexpected command: ' + script);
    };
    const dock = new Dock({execute: execute, dir: dir, stateFile: path.join(tmp, 'state.json'), appsFile: path.join(tmp, 'apps.tsv'),
        sleep: async ms => { tv.clock += ms; }, now: () => tv.clock});
    return {dock, tv, tmp};
}

(async function () {
    // Not in the package: nothing to run, nothing touched.
    let f = fixture({installed: false});
    assert.equal((await f.dock.status()).installed, false);
    await assert.rejects(f.dock.enable(), /not in this Vetro package/);
    assert.equal(f.tv.scripts.length, 1, 'only the status probe ran');

    // Switching on: app list first, then the dock, then the setting, then Samsung's Home is closed.
    f = fixture();
    let s = await f.dock.status();
    assert.equal(s.enabled, false);
    assert.equal(s.running, false);
    s = await f.dock.enable();
    assert.equal(s.enabled, true);
    assert.equal(s.running, true);
    assert.equal(s.apps.count, 1);
    assert.equal(fs.readFileSync(path.join(f.tmp, 'apps.tsv'), 'utf8').split('\n')[1],
        'netflix\tNetflix\torg.tizen.netflix-app\t\t/opt/share/webappservice/apps_icon/all/aaa/224x224.png', 'the list the dock reads');
    assert.ok(/tvlauncher-dotnet\.dll --apps '[^']+apps\.tsv' --inputs '[^']+inputs\.tsv' --hidden --home-code 63 --kill-on-home com\.samsung\.tv\.csfs/.test(f.tv.started),
        'the verified dock command line: ' + f.tv.started);
    assert.ok(f.tv.started.includes('TVLAUNCHER_DIR=/home/owner') && f.tv.started.includes('WAYLAND_DISPLAY=wayland-0') && f.tv.started.includes('setsid nohup /usr/bin/dotnet'));
    assert.ok(f.tv.started.indexOf('kill -9') < f.tv.started.indexOf('setsid'), 'a previous dock is stopped before the new one starts');
    assert.ok(/tr "\\0" " " < \/proc\/\$p\/cmdline/.test(f.tv.started) && f.tv.started.includes('grep -q tvlauncher-dotnet.dll'), 'only a pid that is our dll is killed');
    assert.ok(/systemd-run --unit=vetro-dock --collect .*-p KillSignal=SIGKILL .*\/usr\/bin\/env HOME=\/home\/owner .*\/usr\/bin\/dotnet tvlauncher-dotnet\.dll/.test(f.tv.started),
        'the dock runs as its own systemd unit, outside the root agent\'s cgroup (sdbd stops at standby and kills it): ' + f.tv.started);
    assert.ok(f.tv.started.indexOf('systemctl stop vetro-dock.service') < f.tv.started.indexOf('systemd-run'), 'a previous unit is stopped first');
    assert.ok(/systemd-run [^\n]*\|\| [^\n]*setsid nohup \/usr\/bin\/dotnet/.test(f.tv.started), 'the detached start remains as the fallback');
    assert.equal(f.tv.csfs, false, 'Samsung Home closed once the dock is up');
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.tmp, 'state.json'), 'utf8')).enabled, true);
    assert.equal(f.tv.scripts[f.tv.scripts.length - 1].startsWith('echo '), true);
    assert.ok(f.tv.scripts.findIndex(c => /^app_launcher -k com\.samsung\.tv\.csfs$/.test(c)) > f.tv.scripts.findIndex(c => c.startsWith('echo') && Buffer.from(c.split(' ')[1], 'base64').toString().includes('setsid')),
        'Samsung Home is closed after the dock started, never before');

    // Autorun Smart Hub: switched off with the launcher, put back with it, only if the launcher changed it.
    f = fixture({autorun: 1});
    s = await f.dock.enable();
    assert.equal(f.tv.autorun, 0, 'Samsung Home no longer comes up at power-on');
    assert.equal(s.autorunSwitchedOff, true);
    await f.dock.enable();
    assert.equal(f.dock.readState().autorunWas, 1, 'a second enable does not forget the original value');
    s = await f.dock.disable();
    assert.equal(f.tv.autorun, 1, 'turned back on with the launcher off');
    assert.equal(s.autorunSwitchedOff, false);
    f = fixture({autorun: 0});
    await f.dock.enable();
    await f.dock.disable();
    assert.equal(f.tv.autorun, 0, 'the user had it off already: left off');
    f = fixture({autorun: 1});
    await f.dock.enable();
    f.tv.autorun = 1;   // the user switched it on again in Samsung's menu while the launcher was on
    f.tv.scripts.length = 0;
    await f.dock.disable();
    assert.ok(!f.tv.scripts.some(c => c.startsWith('echo') && Buffer.from(c.split(' ')[1], 'base64').toString().includes('vconftool set')), 'nothing to put back');
    assert.equal(f.dock.readState().autorunWas, null);

    // Switching on fails when the dock never appears: back to how it was, with the reason.
    f = fixture({neverStarts: true, log: 'fatal: no display'});
    await assert.rejects(f.dock.enable(), /did not start.*fatal: no display/);
    assert.equal(f.dock.readState().enabled, false, 'not remembered as on');
    assert.equal(f.tv.csfs, true, 'Samsung Home was never touched');
    assert.ok(f.tv.stopped >= 1, 'a half-started dock is stopped');
    assert.match((await f.dock.status()).error, /did not start/);
    assert.equal((await f.dock.status()).busy, false);

    // A Home row that cannot be read stops everything before the dock is started.
    f = fixture({homeData: ''});
    await assert.rejects(f.dock.enable(), /empty or unreadable/);
    assert.ok(!f.tv.started, 'the dock was not started');
    assert.equal(f.dock.readState().enabled, false);

    // Two changes at once: the second is refused.
    f = fixture();
    const first = f.dock.enable();
    await assert.rejects(f.dock.disable(), /in progress/);
    await first;

    // Switching off: the setting goes first, then the process; Samsung's Home is left to open on the next Home press.
    f = fixture();
    await f.dock.enable();
    s = await f.dock.disable();
    assert.equal(s.enabled, false);
    assert.equal(s.running, false);
    assert.ok(!f.tv.scripts.some(c => /^app_launcher -s /.test(c)), 'the screen is not switched under the viewer');

    // Supervision: only when on, installed, and the agent is up.
    f = fixture();
    assert.equal(await f.dock.supervise(true), null, 'off: nothing to do');
    await f.dock.enable();
    f.tv.running = false;
    assert.equal(await f.dock.supervise(false), null, 'agent not connected yet: wait');
    assert.equal(await f.dock.supervise(true), 'started', 'dock died: started again');
    assert.equal(f.tv.running, true);
    assert.equal(await f.dock.supervise(true), 'running', 'alive: left alone');

    // After a reboot the service sees the setting but no process, and starts it.
    const tmpState = f.dock.stateFile;
    const reborn = fixture();
    fs.writeFileSync(reborn.dock.stateFile, JSON.stringify({enabled: true, since: 5}));
    assert.equal(await reborn.dock.supervise(true), 'started');
    assert.equal(reborn.tv.running, true);

    // Failures back off but never switch the setting off: a slow boot must not cost the launcher for good.
    const bad = fixture({neverStarts: true});
    fs.writeFileSync(bad.dock.stateFile, JSON.stringify({enabled: true, since: 5}));
    assert.equal(await bad.dock.supervise(true), 'failed');
    assert.equal(await bad.dock.supervise(true), null, 'backing off: not tried again at once');
    for (let i = 0; i < 6; i++) { bad.tv.clock += 301000; await bad.dock.supervise(true); }
    assert.equal(bad.dock.readState().enabled, true, 'still on after repeated failures');
    assert.match(bad.dock.lastError, /keeps trying/);
    assert.ok(bad.dock.nextTry - bad.tv.clock <= 300000, 'the wait between tries is capped at five minutes');
    bad.tv.neverStarts = false; bad.dock.nextTry = 0;
    assert.equal(await bad.dock.supervise(true), 'started', 'it starts as soon as the TV lets it');
    assert.equal(bad.dock.lastError, null);

    // Right after a boot a start gets a long wait; later it does not (and nothing waits when it comes up at once).
    const slow = fixture({neverStarts: true});
    slow.dock.uptime = () => 40;
    const t0 = slow.tv.clock;
    await assert.rejects(slow.dock.waitRunning(), /did not start/);
    assert.ok(slow.tv.clock - t0 > 60000, 'boot window: waited ' + (slow.tv.clock - t0) + ' ms');
    slow.dock.uptime = () => 90000;
    const t1 = slow.tv.clock;
    await assert.rejects(slow.dock.waitRunning(), /did not start/);
    assert.ok(slow.tv.clock - t1 < 20000, 'normal uptime: short wait');

    // A start after a boot uses the list saved by the last start, then refreshes it once the dock is up.
    const quick = fixture();
    await quick.dock.enable();
    quick.tv.running = false;
    quick.tv.scripts.length = 0;
    quick.tv.homeData = HOME_DATA.replace(hex('Netflix'), hex('Netflix 4K'));
    quick.dock.uptime = () => 40;
    assert.equal(await quick.dock.supervise(true), 'started');
    const order = quick.tv.scripts.map(c => c.startsWith('echo') ? Buffer.from(c.split(' ')[1], 'base64').toString() : c);
    const iStart = order.findIndex(c => c.includes('setsid nohup')), iRead = order.findIndex(c => c.includes('.appLayerCache'));
    assert.ok(iStart >= 0 && iRead === -1, 'the dock is started without reading the Home row first (or at all while booting)');
    await new Promise(r => setImmediate(r));
    assert.ok(!fs.readFileSync(path.join(quick.tmp, 'apps.tsv'), 'utf8').includes('Netflix 4K'), 'not rewritten while the TV is still booting');
    quick.dock.uptime = () => 400;
    assert.equal(await quick.dock.supervise(true), 'running');
    await new Promise(r => setImmediate(r));
    assert.ok(fs.readFileSync(path.join(quick.tmp, 'apps.tsv'), 'utf8').includes('Netflix 4K'), 'the list is refreshed for the next start once the TV settled');
    // No saved list yet (first run): the list is built first, as in enable().
    const fresh = fixture();
    fs.writeFileSync(fresh.dock.stateFile, JSON.stringify({enabled: true, since: 5}));
    await fresh.dock.supervise(true);
    const o2 = fresh.tv.scripts.map(c => c.startsWith('echo') ? Buffer.from(c.split(' ')[1], 'base64').toString() : c);
    assert.ok(o2.findIndex(c => c.includes('.appLayerCache')) < o2.findIndex(c => c.includes('setsid nohup')), 'no saved list: read it first');

    // Refresh needs the dock to be on.
    f = fixture();
    await assert.rejects(f.dock.refresh(), /off/);
    await f.dock.enable();
    f.tv.homeData = HOME_DATA.replace(hex('Netflix'), hex('Netflix HD'));
    await f.dock.refresh();
    assert.ok(fs.readFileSync(path.join(f.tmp, 'apps.tsv'), 'utf8').includes('Netflix HD'));

    // Fix TizenTube and the preview data
    const TT = [
        'O|d/webapp@tt', 'O|d/webapp@aaa',
        'R|' + hex('tt') + '|' + hex('TizenTube') + '|' + hex('xvvl3S1TT1.TizenTubeStandalone') + '|0',
        'R|' + hex('yt') + '|' + hex('YouTube') + '|' + hex('9Ur5IzDKqV.TizenYouTube') + '|0',
        'R|' + hex('aaa') + '|' + hex('Netflix') + '|' + hex('org.tizen.netflix-app') + '|0',
        'I|tt|/opt/share/webappservice/apps_icon/all/tt/icon.png', 'I|yt|/opt/share/webappservice/apps_icon/all/yt/224x224.png',
        'I|aaa|/opt/share/webappservice/apps_icon/all/aaa/224x224.png'
    ].join('\n');
    f = fixture({homeData: TT});
    await assert.rejects(f.dock.setFixTizenTube('yes'), /Invalid value/);
    s = await f.dock.setFixTizenTube(true);
    assert.equal(s.fixTizenTube, true, 'saved while the launcher is off');
    assert.equal(s.enabled, false);
    assert.ok(!f.tv.started, 'the launcher is not started by the fix');
    assert.ok(fs.readFileSync(path.join(f.tmp, 'apps.tsv'), 'utf8').includes('tizentube'), 'off: the list for the page preview follows the choice');
    // The page preview: with no list yet, the page's status reads it once; the plain status never touches the TV
    fs.unlinkSync(path.join(f.tmp, 'apps.tsv'));
    s = await f.dock.status(); assert.deepEqual(s.entries, [], 'plain status: no TV read');
    s = await f.dock.status({preview: true}); assert.ok(s.entries.length > 0, 'preview status reads the list before the launcher was ever on');
    assert.equal(s.enabled, false); assert.ok(!f.tv.started, 'and starts nothing');
    s = await f.dock.enable();
    assert.equal(s.fixTizenTube, true, 'turning the launcher on keeps the choice');
    let tsv = fs.readFileSync(path.join(f.tmp, 'apps.tsv'), 'utf8');
    assert.ok(tsv.includes('tizentube\tTizenTube\txvvl3S1TT1.TizenTubeStandalone\t\t/opt/share/webappservice/apps_icon/all/yt/224x224.png\tcom.samsung.tv.cobalt-yt'), 'YouTube icon and kill-first in the list');
    assert.deepEqual(s.entries.map(e => e.slug), ['tizentube', 'netflix', 'settings', 'samsunghome']);
    assert.equal(s.entries[0].killFirst, 'com.samsung.tv.cobalt-yt');
    assert.equal(s.entries[2].system, true); assert.equal(s.entries[3].system, true); assert.equal(s.entries[1].system, false);
    s = await f.dock.setFixTizenTube(false);
    assert.equal(s.fixTizenTube, false);
    assert.equal(s.enabled, true, 'the launcher stays on');
    tsv = fs.readFileSync(path.join(f.tmp, 'apps.tsv'), 'utf8');
    assert.ok(!tsv.includes('cobalt-yt') && tsv.includes('/all/tt/icon.png'), 'off again: the list is rebuilt without it');
    f.tv.neverStarts = true; f.tv.running = false;
    await assert.rejects(f.dock.setFixTizenTube(true), /did not start/);
    assert.equal(f.dock.readState().fixTizenTube, false, 'a failed rebuild puts the choice back');

    // Preview icons: only a real PNG, only from safe places
    const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('data')]);
    f = fixture({homeData: TT});
    await f.dock.enable();
    fs.mkdirSync(path.join(f.tmp, 'dock', 'res', 'icons'), {recursive: true});
    fs.writeFileSync(path.join(f.tmp, 'dock', 'res', 'icons', 'settings.png'), png);
    assert.ok(f.dock.iconFile('settings').equals(png), 'a packaged icon is served');
    assert.equal(f.dock.iconFile('../settings'), null, 'no path tricks');
    assert.equal(f.dock.iconFile('nope'), null);
    assert.equal(f.dock.iconFile('netflix'), null, 'an icon that is not readable here gives nothing, not an error');
    fs.writeFileSync(f.dock.appsFile, '# x\nevil\tEvil\tx.evil\t\t/etc/passwd\nnet\tNet\tx.net\t\t/opt/usr/apps/a/../../b.png\n');
    assert.equal(f.dock.iconFile('evil'), null, 'a path outside the icon places is never read');
    assert.equal(f.dock.iconFile('net'), null, 'nor one with parent directories');

    console.log('PASS dock service: on, off, boot start, crash restart, back-off that never switches it off');
})().catch(e => { console.error(e); process.exitCode = 1; });
