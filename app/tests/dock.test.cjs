'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const dockModule = require('../service/dock.js');
const {Dock} = dockModule;

const hex = s => Buffer.from(s).toString('hex');
const HOME_DATA = [
    'F|csfs', 'O|d/webapp@aaa',
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
        const script = /^echo \S+ \| base64 -d \| sh$/.test(cmd) ? Buffer.from(cmd.split(' ')[1], 'base64').toString() : cmd;   // the running check goes unwrapped
        // Samsung's Home closed by the launcher's script (closeHomeOnce, Close idle Samsung Home): not while it is on screen
        if (script.includes('current_fullscreen_appid') && script.includes('app_launcher -k')) {
            if (tv.fullscreenHome) return {exit_code: 0, stdout: 'fg\n'};
            const was = tv.csfs; tv.csfs = false; return {exit_code: 0, stdout: was ? 'closed:csfs\n' : 'off\n'};
        }
        if (script.includes('vconftool set') && script.includes('auto_start')) { tv.autorun = +/auto_start (\d)/.exec(script)[1]; return {exit_code: 0, stdout: ''}; }
        if (script.includes('vconftool get') && script.includes('auto_start')) return {exit_code: 0, stdout: 'db/menu/smart_hub/ontvsetting/auto_start, value = ' + tv.autorun + ' (Int32)\n'};
        if (script.includes('.appLayerCache')) return {exit_code: 0, stdout: tv.homeData};
        if (script.includes('setsid nohup')) { tv.started = script; tv.running = !tv.neverStarts; return {exit_code: 0, stdout: 'started\n'}; }
        if (script.includes('kill -9') && !script.includes('echo "dock=')) { tv.running = false; tv.stopped = (tv.stopped || 0) + 1; return {exit_code: 0, stdout: ''}; }
        if (script.includes('get_root_app')) { tv.powerOnShows = (tv.powerOnShows || 0) + 1; return {exit_code: 0, stdout: tv.rootApp ? 'shown\n' : ''}; }
        if (script.includes('echo "dock=')) return {exit_code: 0, stdout: (tv.running ? 'dock=' + (tv.pid || 4242) : 'dock=') + '\nhome=' + (tv.csfs ? 1 : 0) + '\nlog:\n' + tv.log + '\n'};
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
    assert.ok(fs.existsSync(f.dock.inputsFile), 'generated Sources list saved next to app data');
    assert.ok(f.tv.started.includes("--inputs '" + f.dock.inputsFile + "'"), 'native dock uses the generated Sources list');
    assert.deepEqual(f.dock.inputEntries().map(e => e.source), [0, 13, 14, 15, 16], 'Sources preview uses the same ordered list');
    assert.equal(fs.readFileSync(path.join(f.tmp, 'apps.tsv'), 'utf8').split('\n')[1],
        'netflix\tNetflix\torg.tizen.netflix-app\t\t/opt/share/webappservice/apps_icon/all/aaa/224x224.png\t\t\tapp:org.tizen.netflix-app', 'the list the dock reads');
    assert.ok(fs.existsSync(f.dock.allAppsFile), 'the All apps list is saved next to it');
    assert.ok(/tvlauncher-dotnet\.dll --apps '[^']+apps\.tsv' --inputs '[^']+inputs\.tsv'( --all-apps '[^']+allapps\.tsv')? --hidden --claim-home( --service-port \d+)? --home-code 63 --kill-on-home com\.samsung\.tv\.csfs,com\.samsung\.tv\.home\.sidebar,com\.samsung\.tv\.home\.media/.test(f.tv.started),
        'the verified dock command line: ' + f.tv.started);
    assert.ok(f.tv.started.includes('TVLAUNCHER_DIR=/home/owner') && f.tv.started.includes('WAYLAND_DISPLAY=wayland-0') && f.tv.started.includes('setsid nohup /usr/bin/dotnet'));
    assert.ok(f.tv.started.indexOf('kill -9') < f.tv.started.indexOf('setsid'), 'a previous dock is stopped before the new one starts');
    assert.ok(/tr "\\0" " " < \/proc\/\$p\/cmdline/.test(f.tv.started) && f.tv.started.includes('grep -q tvlauncher-dotnet.dll'), 'only a pid that is our dll is killed');
    assert.ok(/systemd-run --unit=vetro-dock --collect -p WorkingDirectory=.*-p KillSignal=SIGKILL -p Nice=-10 .* -p Restart=on-failure -p RestartSec=200ms .*\/usr\/bin\/env HOME=\/home\/owner .*\/usr\/bin\/dotnet tvlauncher-dotnet\.dll/.test(f.tv.started),
        'the dock runs as its own systemd unit with elevated scheduler priority, Restart=on-failure, and outside the root agent\'s cgroup (sdbd stops at standby and kills it): ' + f.tv.started);
    assert.ok(f.tv.started.indexOf('systemctl stop --no-block vetro-dock.service') >= 0 &&
        f.tv.started.indexOf('systemctl stop --no-block vetro-dock.service') < f.tv.started.indexOf('systemd-run'), 'a previous unit is stopped non-blockingly first');
    assert.ok(f.tv.started.includes('systemctl is-active vetro-dock.service 2>/dev/null') && f.tv.started.includes('active|activating|deactivating|reloading') && f.tv.started.includes('systemctl reset-failed vetro-dock.service'),
        'unit stop polls is-active states including deactivating and resets failed unit state');
    assert.ok(f.tv.started.includes('tvlauncher.longpress') && f.tv.started.includes('wm.keyroutertv.longpress.info.unset_longpress_key_info string:"XF86Back" double:1.0 int32:"$u"') && f.tv.started.indexOf('unset_longpress_key_info') > f.tv.started.indexOf('kill -9 $p') && f.tv.started.indexOf('unset_longpress_key_info') < f.tv.started.indexOf('rm -f /home/owner/tvlauncher.pid'),
        'stopLines cleans up stale XF86Back longpress registration after stopping the dock and before removing state files');
    assert.ok(require('../service/restore.js').ERASE_SCRIPT.includes('/home/owner/tvlauncher.longpress'),
        'restore ERASE_SCRIPT removes tvlauncher.longpress alongside tvlauncher.pid');
    assert.ok(/systemd-run [^\n]*\|\| \{ [^\n]*setsid nohup \/usr\/bin\/dotnet [^\n]*<\/dev\/null >\/dev\/null 2>&1 & \}/.test(f.tv.started), 'the detached start remains as a braced fallback');
    assert.equal(f.tv.csfs, false, 'Samsung Home closed once the dock is up');
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.tmp, 'state.json'), 'utf8')).enabled, true);
    assert.equal(f.tv.scripts[f.tv.scripts.length - 1].startsWith('echo '), true);
    assert.ok(f.tv.scripts.findIndex(c => /^app_launcher -k com\.samsung\.tv\.csfs; app_launcher -k com\.samsung\.tv\.home\.sidebar; app_launcher -k com\.samsung\.tv\.home\.media$/.test(c)) > f.tv.scripts.findIndex(c => c.startsWith('echo') && Buffer.from(c.split(' ')[1], 'base64').toString().includes('setsid')),
        'Samsung Home is closed after the dock started, never before');

    // Still selection is persisted, changes the actual process arguments and rolls back a failed restart.
    assert.equal(f.dock.readState().noMotion, false);
    assert.equal((await f.dock.setNoMotion(true)).noMotion, true);
    assert.ok(f.tv.started.includes(' --no-motion'));
    assert.equal((await f.dock.setNoMotion(false)).noMotion, false);
    assert.ok(!f.tv.started.includes(' --no-motion'));
    await assert.rejects(f.dock.setNoMotion('true'), /Invalid value/);
    f.tv.neverStarts = true;
    await assert.rejects(f.dock.setNoMotion(true), /did not start/);
    assert.equal(f.dock.readState().noMotion, false, 'failed restart restores the selection preference');

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

    // Samsung's preview updater only feeds Home's tiles: stopped with the launcher, started again when it goes off.
    {
        const dec = c => c.startsWith('echo ') ? Buffer.from(c.split(' ')[1], 'base64').toString() : c;
        f = fixture();
        f.tv.scripts.length = 0;
        await f.dock.enable();
        assert.ok(f.tv.scripts.map(dec).some(c => c.includes('systemctl stop --no-block com.samsung.tv.preview-updater.service') && c.includes('app_launcher -k com.samsung.tv.preview-updater')), 'stopped at start');
        f.tv.scripts.length = 0;
        await f.dock.disable();
        assert.ok(f.tv.scripts.map(dec).some(c => c.includes('systemctl start --no-block com.samsung.tv.preview-updater.service')), 'started again when off');
    }

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
        'F|csfs', 'O|d/webapp@tt', 'O|d/webapp@aaa',
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
    assert.ok('audioOutput' in s, 'the dashboard read says where the sound goes (null when the TV cannot say)');
    assert.equal(s.enabled, false); assert.ok(!f.tv.started, 'and starts nothing');
    s = await f.dock.enable();
    assert.equal(s.fixTizenTube, true, 'turning the launcher on keeps the choice');
    let tsv = fs.readFileSync(path.join(f.tmp, 'apps.tsv'), 'utf8');
    assert.ok(tsv.includes('tizentube\tTizenTube\txvvl3S1TT1.TizenTubeStandalone\t\t/opt/share/webappservice/apps_icon/all/yt/224x224.png\tcom.samsung.tv.cobalt-yt'), 'YouTube icon and kill-first in the list');
    assert.deepEqual(s.entries.map(e => e.slug), ['tizentube', 'netflix', 'allapps', 'samsunghome']);
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

    // Source switches persist like other launcher options and revert failed changes.
    f = fixture();
    assert.equal(f.dock.readState().showHomeSources,false);
    await f.dock.writeCatalog();
    assert.equal(JSON.parse(fs.readFileSync(f.dock.stateFile)).showHomeSources,false,'fresh defaults persist before creating generated lists');
    await assert.rejects(f.dock.setSourceOption('other',true),/Invalid source option/);
    await assert.rejects(f.dock.setSourceOption('showHomeSources','yes'),/Invalid source option/);
    await f.dock.setSourceOption('showHomeSources',true);
    await f.dock.setSourceOption('showHomeSources',false);
    assert.equal(f.dock.readState().showHomeSources,false);
    await f.dock.enable();
    const previousCatalog=fs.readFileSync(f.dock.appsFile,'utf8'), exec=f.dock.execute;
    let failOnce=true;
    f.dock.execute=async function(cmd){
        if(failOnce && Buffer.from(cmd.split(' ')[1]||'', 'base64').toString().includes('.appLayerCache')) {
            failOnce=false;return {exit_code:1,stderr:'read failed'};
        }
        return exec(cmd);
    };
    await assert.rejects(f.dock.setSourceOption('showHomeSources',true),/read failed/);
    assert.equal(f.dock.readState().showHomeSources,false,'failed changes restore persisted state');
    assert.equal(fs.readFileSync(f.dock.appsFile,'utf8'),previousCatalog,'failed changes restore the generated catalog');
    assert.equal(f.tv.running,true,'previous launcher relaunched after failed change');
    // An old installation with HDMI tiles retains its visible behavior during migration.
    f=fixture(); fs.writeFileSync(f.dock.appsFile,'in-hdmi1\tConsole\tsource:13\n');
    const migrated=new Dock({execute:f.dock.execute,dir:f.dock.dir,stateFile:f.dock.stateFile,appsFile:f.dock.appsFile});
    assert.equal(migrated.readState().showHomeSources,true);
    await migrated.writeCatalog();
    assert.equal(JSON.parse(fs.readFileSync(migrated.stateFile)).showHomeSources,true);

    // Both choices are independent and remain explicit across restarts.
    f=fixture();
    assert.equal(f.dock.readState().useSourceImages,false);
    await f.dock.setSourceOption('useSourceImages',true);
    assert.equal(f.dock.readState().showHomeSources,false);
    await f.dock.setSourceOption('showHomeSources',true);
    await f.dock.setSourceOption('useSourceImages',false);
    assert.equal(f.dock.readState().showHomeSources,true);
    await f.dock.setSourceOption('showHomeSources',false);
    const reloaded=new Dock({execute:f.dock.execute,dir:f.dock.dir,stateFile:f.dock.stateFile,appsFile:f.dock.appsFile});
    assert.equal(reloaded.readState().showHomeSources,false);
    assert.equal(reloaded.readState().useSourceImages,false);
    // Old artwork on the generated Sources page migrates on, even if Home has no HDMI tiles.
    f=fixture(); fs.writeFileSync(f.dock.inputsFile,'in-hdmi1\tConsole\tsource:13\t\t/opt/usr/apps/a/source.png\n');
    const legacyArt=new Dock({execute:f.dock.execute,dir:f.dock.dir,stateFile:f.dock.stateFile,appsFile:f.dock.appsFile});
    assert.equal(legacyArt.readState().showHomeSources,false);
    assert.equal(legacyArt.readState().useSourceImages,true);
    await legacyArt.writeCatalog();
    assert.equal(JSON.parse(fs.readFileSync(legacyArt.stateFile)).useSourceImages,true);

    f=fixture(); fs.writeFileSync(f.dock.stateFile,JSON.stringify({showHomeSources:false,sourceOptionOriginal:{showHomeSources:true}}));
    await f.dock.setSourceOption('showHomeSources',true);
    assert.equal(f.dock.readState().showHomeSources,true);
    assert.ok(!('sourceOptionOriginal' in JSON.parse(fs.readFileSync(f.dock.stateFile))),'obsolete original-choice metadata is removed when settings are saved');

    f=fixture(); fs.writeFileSync(f.dock.stateFile,'broken existing state');
    await assert.rejects(f.dock.setSourceOption('showHomeSources',true),/Cannot read launcher preferences/);
    await assert.rejects(f.dock.writeCatalog(),/Cannot read launcher preferences/);
    assert.equal(fs.readFileSync(f.dock.stateFile,'utf8'),'broken existing state','migration never overwrites malformed state');

    // Samsung's Home started by the TV at boot: closed once when the dock is up, never in the boot window, never twice.
    f = fixture({running: true});
    f.dock.patchState({enabled: true});
    f.dock.serviceStart = 95;                           // this run of the service came up with the TV
    f.dock.uptime = () => 100;
    assert.equal(await f.dock.supervise(true), 'running');
    assert.equal(f.tv.csfs, true, 'boot window: Samsung Home left alone');
    f.dock.uptime = () => 1000;
    assert.equal(await f.dock.supervise(true), 'running');
    assert.equal(f.tv.csfs, false, 'settled: Samsung Home closed');
    // Samsung's Home on screen by its window (Q80A 2026-11-22, enlightenment_info -topvwins rows as printed there): on 2021 firmware the
    // fullscreen app key kept naming YouTube with Home open over it
    {
        const awk = dockModule.HOME_ON_SCREEN_AWK;
        const shown = '  3 0x008feb30    158  30887   1920  1080      0      0   O         32  -1    0    0   1   V     1      DV     0          /usr/apps/com.samsung.tv.csfs/bin/csfs.dll';
        const afterBack = ' 13 0x008feb30    158  30887   1920  1080      0      0             32  -1    2    1   1   V     0      NO     0          /usr/apps/com.samsung.tv.csfs/bin/csfs.dll';
        const youtube = '  3 0x00a57fc8    110  16032   1920  1080      0      0   O         24  -1    0    0   1   V     1      DV     0          cobalt-app';
        const media = '  4 0x00a57fc9    111  16040   1920  1080      0      0             24  -1    0    0   1   V     1      DV     0          com.samsung.tv.home.media';
        const onScreen = rows => require('child_process').spawnSync('awk', [awk], {input: rows.join('\n') + '\n'}).status === 0;
        assert.equal(onScreen([youtube, shown]), true, 'Home open over YouTube');
        assert.equal(onScreen([youtube, afterBack, afterBack]), false, 'after Back: iconified and covered');
        assert.equal(onScreen([youtube, media]), false, 'only csfs\'s window counts');
        assert.equal(onScreen([]), false, 'no enlightenment_info: nothing on screen');
        const probe = dockModule.idleHomeScript(true);
        assert.ok(probe.indexOf('topvwins') > probe.indexOf('current_fullscreen_appid') && probe.indexOf('topvwins') < probe.indexOf('app_launcher -k'), 'asked before anything is closed');
    }
    // #278: not while Samsung's Home is the app on screen, and asked again at the next round
    {
        const g = fixture({running: true});
        g.dock.patchState({enabled: true});
        g.dock.serviceStart = 95; g.dock.uptime = () => 1000; g.tv.fullscreenHome = true;
        await g.dock.supervise(true);
        assert.equal(g.tv.csfs, true, 'Samsung Home on screen: left alone');
        assert.ok(!g.dock.homeClosed, 'and not marked done');
        g.tv.fullscreenHome = false;
        await g.dock.supervise(true);
        assert.equal(g.tv.csfs, false, 'closed at the next round once it is in the background');
        assert.equal(g.dock.homeClosed, true);
        assert.match(g.dock.startScript(), /DOTNET_EnableDiagnostics=0/);
        const all = g.tv.scripts.map(c => /^echo \S+ \| base64 -d \| sh$/.test(c) ? Buffer.from(c.split(' ')[1], 'base64').toString() : c).join('\n');
        assert.ok(all.includes('app_launcher -k com.samsung.tv.home.media') && all.includes('app_launcher -k com.samsung.tv.home.sidebar'), 'Home\'s media hub and sidebar too (the Home of 2022 and later TVs)');
        assert.match(all, /grep -qE "\(\^\|\[\._\]\)\(csfs\|home\\\.media\|home\\\.sidebar\)\$"/, 'the probe counts the media hub and the sidebar as Samsung Home');
    }
    f.tv.csfs = true;                                   // opened again on purpose from the dock
    assert.equal(await f.dock.supervise(true), 'running');
    assert.equal(f.tv.csfs, true, 'closed only once per service run');


    // #206: the launcher is opened once at power-on (the TV-side script checks the firmware and the app in front), never later, never twice.
    f = fixture({running: true});
    f.dock.patchState({enabled: true});
    f.dock.serviceStart = 95; f.dock.uptime = () => 140; f.tv.rootApp = true;
    assert.equal(await f.dock.supervise(true), 'running');
    assert.equal(f.tv.powerOnShows, 1, 'shown once right after the boot');
    assert.ok(f.tv.scripts.some(c => /^echo \S+ \| base64 -d \| sh$/.test(c) && /current_fullscreen_appid[\s\S]*org\.tizen\.tv-viewer[\s\S]*echo show/.test(Buffer.from(c.split(' ')[1], 'base64').toString())),
        'only while tv-viewer is in front, through the launcher pipe');
    assert.equal(await f.dock.supervise(true), 'running');
    assert.equal(f.tv.powerOnShows, 1, 'not twice');
    f = fixture({running: true});
    f.dock.patchState({enabled: true});
    f.dock.serviceStart = 95; f.dock.uptime = () => 900;
    await f.dock.supervise(true);
    assert.equal(f.tv.powerOnShows || 0, 0, 'too long after the boot: nothing');
    f = fixture({running: true});
    f.dock.patchState({enabled: true, customApp: 'org.example.app'});
    f.dock.serviceStart = 95; f.dock.uptime = () => 140;
    await f.dock.supervise(true);
    assert.equal(f.tv.powerOnShows || 0, 0, 'custom launcher: nothing');

    // A service that restarts long after the boot (an update, a crash) leaves a Samsung Home on screen alone: the user opened it.
    f = fixture({running: true});
    f.dock.patchState({enabled: true});
    f.dock.serviceStart = 5000;
    f.dock.uptime = () => 5010;
    assert.equal(await f.dock.supervise(true), 'running');
    assert.equal(f.tv.csfs, true, 'service restarted after the boot: Samsung Home is not closed');

    // One probe that fails while the dock is starting is "not seen yet", not a failed start.
    {
        const t = fixture();
        fs.writeFileSync(t.dock.stateFile, JSON.stringify({enabled: true, since: 5}));
        const probe = t.dock.probe.bind(t.dock); let failed = 0;
        t.dock.probe = function () { if (failed++ === 1) return Promise.reject(new Error('root agent reconnecting')); return probe(); };
        assert.equal(await t.dock.supervise(true), 'started', 'a rejected probe during the wait does not fail the start');
        assert.equal(t.dock.lastError, null);
    }

    // Boot start (#179): a start script that outlives its wait is not a failure when the dock comes up from it, the retry inside the
    // boot window is short, a stale warning clears once the dock is seen running, and the status records where the time went.
    {
        const t = fixture();
        t.dock.uptime = () => 40;
        fs.writeFileSync(t.dock.stateFile, JSON.stringify({enabled: true, since: 5}));
        const exec = t.dock.execute, waits = [];
        t.dock.execute = async (cmd, ms) => {
            const r = await exec(cmd, ms);
            if (cmd.startsWith('echo ') && Buffer.from(cmd.split(' ')[1], 'base64').toString().includes('setsid nohup')) { waits.push(ms); return {exit_code: null, timed_out: true, stdout: ''}; }
            return r;
        };
        assert.equal(t.dock.bootSettled(), false, 'launcher on and not up yet: other boot tasks wait');
        assert.equal(await t.dock.supervise(true), 'started', 'a timed-out start script is not a failure when the dock is up');
        assert.equal(waits[0], 75000, 'inside the boot window the start script gets the long wait');
        assert.equal(t.dock.failures, 0);
        assert.equal(t.dock.lastError, null);
        const tl = (await t.dock.status()).bootTimeline;
        assert.equal(tl.agentSeen, 40); assert.equal(tl.startIssued, 40); assert.equal(tl.running, 40); assert.equal(tl.startTimedOut, true);
        assert.equal(typeof tl.startCallMs, 'number');
        assert.equal(t.dock.bootSettled(), true, 'dock is up: other boot tasks may run');

        const late = fixture();
        late.dock.uptime = () => 4000;
        fs.writeFileSync(late.dock.stateFile, JSON.stringify({enabled: true, since: 5}));
        const lateExec = late.dock.execute, lateWaits = [];
        late.dock.execute = async (cmd, ms) => { if (cmd.startsWith('echo ') && Buffer.from(cmd.split(' ')[1], 'base64').toString().includes('setsid nohup')) lateWaits.push(ms); return lateExec(cmd, ms); };
        assert.equal(await late.dock.supervise(true), 'started');
        assert.equal(lateWaits[0], 10000, 'outside the boot window the wait stays short');

        const stuck = fixture({neverStarts: true});
        stuck.dock.uptime = () => 40;
        fs.writeFileSync(stuck.dock.stateFile, JSON.stringify({enabled: true, since: 5}));
        assert.equal(await stuck.dock.supervise(true), 'failed');
        assert.equal(stuck.dock.nextTry - stuck.tv.clock, 10000, 'first retry inside the boot window is 10 s');
        assert.equal(stuck.dock.bootSettled(), true, 'a launcher that does not come up (75 s wait spent) cannot hold the other boot tasks for ever');
        const gated = fixture();
        fs.writeFileSync(gated.dock.stateFile, JSON.stringify({enabled: true, since: 5}));
        gated.dock.agentSeenAt = gated.tv.clock - 30000;
        assert.equal(gated.dock.bootSettled(), false, '30 s after the agent connected the gate is still closed');
        gated.tv.clock += 31000;
        assert.equal(gated.dock.bootSettled(), true, 'and it opens after 60 s');
        stuck.tv.running = true; stuck.dock.nextTry = 0;
        assert.equal(await stuck.dock.supervise(true), 'running');
        assert.equal(stuck.dock.lastError, null, 'the earlier "failed" warning clears once the dock is seen running');

        const off = fixture();
        assert.equal(off.dock.bootSettled(), true, 'launcher off: nothing to wait for');
    }

    // A launcher started by another build of Vetro (the package installed again over a running one) is restarted once.
    {
        const t = fixture({running: true});
        fs.writeFileSync(t.dock.stateFile, JSON.stringify({enabled: true, since: 5}));
        t.dock.build = '0.5.1+abc';
        const starts = () => t.tv.scripts.filter(c => /^echo /.test(c) && Buffer.from(c.split(' ')[1], 'base64').toString().includes('setsid nohup')).length;
        assert.equal(await t.dock.supervise(true), 'started', 'running, but started by an unknown build: started again');
        assert.equal(starts(), 1);
        assert.equal(t.dock.readState().build, '0.5.1+abc', 'the build that started it is remembered');
        assert.equal(await t.dock.supervise(true), 'running');
        assert.equal(starts(), 1, 'and only once');
        const again = new Dock({execute: t.dock.execute, dir: t.dock.dir, stateFile: t.dock.stateFile, appsFile: t.dock.appsFile, build: '0.5.1+abc', sleep: t.dock.sleep, now: t.dock.now});
        assert.equal(await again.supervise(true), 'running', 'a restart of the same build leaves the launcher alone');
        assert.equal(starts(), 1);
        await again.restartAfterUpdate();
        assert.equal(starts(), 1, 'after an update the launcher this build already started is not started twice');
        const next = new Dock({execute: t.dock.execute, dir: t.dock.dir, stateFile: t.dock.stateFile, appsFile: t.dock.appsFile, build: '0.5.2+def', sleep: t.dock.sleep, now: t.dock.now});
        await next.restartAfterUpdate();
        assert.equal(starts(), 2, 'a new build restarts it after its update');
        // Go back, then the same update again: the state still names this build, but the launcher that runs is the one the
        // older Vetro started in between (another process). It is started again, once; the supervision sees it as well.
        assert.equal(next.readState().buildPid, 4242, 'the process a build started is remembered with it');
        const mk = () => new Dock({execute: t.dock.execute, dir: t.dock.dir, stateFile: t.dock.stateFile, appsFile: t.dock.appsFile, build: '0.5.2+def', sleep: t.dock.sleep, now: t.dock.now});
        t.tv.pid = 5151;
        const redo = mk();
        await redo.restartAfterUpdate();
        assert.equal(starts(), 3, 'same build in the state, another process running: started again after the update');
        assert.equal(redo.readState().buildPid, 5151);
        const same = mk();
        await same.restartAfterUpdate();
        assert.equal(await same.supervise(true), 'running');
        assert.equal(starts(), 3, 'and left alone when it is the process this build started');
        t.tv.pid = 6262;
        assert.equal(await mk().supervise(true), 'started', 'the supervision restarts a process of another Vetro too');
        assert.equal(starts(), 4);
        t.tv.pid = undefined;
        // Empty TV mode keeps com.samsung.tv.csfs warm in RAM across closeHomeOnce and maintainIdleHome so app exits never cold-boot Launchscreen Winsys.
        const warm = fixture({running: true});
        warm.dock.serviceStart = 20;
        warm.dock.uptime = () => 600;
        fs.writeFileSync(warm.dock.stateFile, JSON.stringify({enabled: true, since: 5, idleMode: 'wallpaper', idleAutoDock: true}));
        assert.equal(await warm.dock.supervise(true), 'running');
        warm.tv.clock += 750000;
        warm.dock.noteWake();
        warm.tv.clock += 30000;
        assert.equal(await warm.dock.supervise(true), 'running');
        assert.equal(warm.tv.csfs, true, 'Empty TV mode keeps csfs warm in RAM after boot window, idle timer, and standby wake');
        // A state that cannot be saved must not turn into a restart at every round.
        const ro = fixture({running: true});
        fs.writeFileSync(ro.dock.stateFile, JSON.stringify({enabled: true, since: 5}));
        ro.dock.build = 'x';
        const patch = ro.dock.patchState.bind(ro.dock);
        ro.dock.patchState = function (p) { if (p && p.build) throw new Error('read-only'); return patch(p); };
        assert.equal(await ro.dock.supervise(true), 'started');
        assert.equal(await ro.dock.supervise(true), 'running', 'restarted once per run even when the build cannot be saved');
        // Without a build id (tests, older callers) nothing changes.
        const plain = fixture({running: true});
        fs.writeFileSync(plain.dock.stateFile, JSON.stringify({enabled: true, since: 5}));
        assert.equal(await plain.dock.supervise(true), 'running');
    }

    // The TV restarted after Vetro was installed again over 0.5.0: nothing runs, and the lists on disk are the ones 0.5.0 wrote (an
    // apps list without row keys, no All apps list). The quick start after the boot uses them; once the boot has settled the
    // launcher is started again, once, from lists this build writes.
    {
        const t = fixture();
        fs.writeFileSync(t.dock.stateFile, JSON.stringify({enabled: true, since: 5, fixTizenTube: false, noMotion: false, autorunWas: 1,
            customApp: null, customSince: null, customHomeDisabled: false, showHomeSources: false, useSourceImages: false}));
        fs.writeFileSync(t.dock.appsFile, '# written by Vetro\nnetflix\tNetflix\torg.tizen.netflix-app\nsettings\tSettings\tkey:XF86SysMenu\torg.tizen.menu\n');
        t.dock.build = '0.5.1+abc';
        let up = 120;
        t.dock.uptime = () => up;
        const starts = () => t.tv.scripts.map(c => /^echo /.test(c) ? Buffer.from(c.split(' ')[1], 'base64').toString() : '').filter(s => s.includes('setsid nohup'));
        assert.equal(await t.dock.supervise(true), 'started', 'boot: started at once');
        assert.equal(starts().length, 1);
        assert.ok(!starts()[0].includes('--all-apps'), 'the quick start had only the old lists');
        assert.equal(await t.dock.supervise(true), 'running', 'inside the boot window it is left alone');
        up = 400;
        assert.equal(await t.dock.supervise(true), 'started', 'after the boot window: started again from new lists');
        assert.equal(starts().length, 2);
        assert.ok(starts()[1].includes('--all-apps'), 'with the All apps list: ' + starts()[1]);
        assert.ok(t.dock.entries().every(e => e.key || e.system), 'the apps list now has row keys');
        assert.equal(await t.dock.supervise(true), 'running');
        assert.equal(starts().length, 2, 'once');
        const again = new Dock({execute: t.dock.execute, dir: t.dock.dir, stateFile: t.dock.stateFile, appsFile: t.dock.appsFile, build: '0.5.1+abc',
            sleep: t.dock.sleep, now: t.dock.now, uptime: () => 9999});
        assert.equal(await again.supervise(true), 'running', 'a later run of the service finds the new lists and leaves it alone');
        assert.equal(starts().length, 2);
        // the custom launcher has no All apps list: never restarted for it
        const c = fixture({running: true});
        fs.writeFileSync(c.dock.stateFile, JSON.stringify({customApp: 'org.example.kodi', customSince: 1}));
        fs.writeFileSync(c.dock.appsFile, 'netflix\tNetflix\torg.tizen.netflix-app\n');
        c.dock.uptime = () => 9999; c.dock.appCheck = async () => ({ok: true});
        assert.equal(await c.dock.supervise(true), 'running');
    }

    // The launcher's own calls to Vetro go to the port this build answers on.
    {
        const t = fixture();
        assert.ok(!/--service-port/.test(t.dock.startScript()), 'no port given: the launcher keeps its default');
        t.dock.port = () => 9000;
        assert.ok(/ --service-port 9000 /.test(t.dock.startScript()));
        t.dock.port = '9000; reboot';
        assert.ok(!/--service-port/.test(t.dock.startScript()), 'only a number in range reaches the command line');
    }

    // The custom launcher given up by the supervision: the remote bridge is told, as when the mode is switched off by hand.
    {
        const t = fixture();
        let told = 0;
        t.dock.onVolumeChange = () => { told++; };
        t.dock.leaveCustom = async () => {};
        assert.equal(await t.dock.giveUpCustom('the app is gone.'), 'reverted');
        assert.equal(told, 1, 'giveUpCustom tells the bridge that the keys changed');
        t.dock.leaveCustom = async () => { throw new Error('no agent'); };
        assert.equal(await t.dock.giveUpCustom('the app is gone.'), 'failed');
        assert.equal(told, 2);
    }

    // maintainIdleHome: 10 min idle countdown, no helper respawn loop, foreground reset, post-wake sweep, and setCloseIdleHome toggle.
    {
        const ih = fixture({running: true});
        ih.dock.patchState({enabled: true});
        ih.dock.serviceStart = 50; ih.dock.uptime = () => 1000;
        let idleMode = 'bg:csfs', idleChecks = 0, idleKills = 0;
        const origIhExec = ih.dock.execute;
        ih.dock.execute = async cmd => {
            if (/^echo (\S+) \| base64 -d \| sh$/.test(cmd)) {
                const sh = Buffer.from(cmd.split(' ')[1], 'base64').toString();
                if (sh.includes('current_fullscreen_appid') && sh.includes('preview-updater')) {
                    idleChecks++;
                    if (sh.includes('app_launcher -k')) {
                        if (idleMode === 'fg' || idleMode === 'off') return {exit_code: 0, stdout: idleMode + '\n'};
                        idleKills++;
                        return {exit_code: 0, stdout: idleMode === 'bg:csfs' ? 'closed:csfs\n' : 'closed:helpers\n'};
                    }
                    return {exit_code: 0, stdout: idleMode + '\n'};
                }
            }
            return origIhExec(cmd);
        };
        await ih.dock.supervise(true); // sets homeClosed = true & homeCheckedAt = now
        ih.tv.clock += 120000;        // +2 min -> poll sees bg:csfs, starts 10 min countdown
        idleChecks = 0; idleKills = 0; ih.dock.idleHomeClosed = false;
        await ih.dock.supervise(true);
        assert.equal(idleChecks, 1); assert.equal(idleKills, 0, 'does not kill immediately on first bg observation');
        ih.tv.clock += 540000;        // +9 min total (< 10 min)
        await ih.dock.supervise(true);
        assert.equal(idleKills, 0, 'keeps Samsung Home warm before 10 min idle');
        ih.tv.clock += 120000;        // +11 min total (>= 10 min)
        await ih.dock.supervise(true);
        assert.equal(idleKills, 1, 'closes idle Samsung Home after 10 min in background');
        assert.equal(ih.dock.idleHomeClears, 1);
        // Helper respawn alone (bg:helpers while idleHomeClosed=true) must not cause a kill loop:
        idleMode = 'bg:helpers';
        ih.tv.clock += 700000;
        await ih.dock.supervise(true);
        assert.equal(idleKills, 1, 'ignores stubborn helper respawn without restarting countdown');
        // Opening Samsung Home again (fg) resets cleanly:
        idleMode = 'fg';
        ih.tv.clock += 120000;
        await ih.dock.supervise(true);
        assert.equal(ih.dock.idleHomeClosed, false);
        assert.equal(ih.dock.homeIdleSince, null);
        // Standby wake trigger waits 25 s then sweeps once:
        idleMode = 'bg:csfs';
        ih.dock.noteWake();
        ih.tv.clock += 10000;
        await ih.dock.supervise(true);
        assert.equal(idleKills, 1, 'waits 25 s after wake for preload to settle');
        ih.tv.clock += 20000;
        await ih.dock.supervise(true);
        assert.equal(idleKills, 2, 'sweeps once after wake settle delay');
        // Toggle off prevents checks without restarting dock:
        await ih.dock.setCloseIdleHome(false);
        assert.equal(ih.dock.readState().closeIdleHome, false);
        ih.tv.clock += 700000;
        await ih.dock.supervise(true);
        assert.equal(idleKills, 2, 'disabled closeIdleHome skips sweeps');
        await ih.dock.setCloseIdleHome(true);
        assert.equal((await ih.dock.status()).closeIdleHome, true);

        // plugin-launcher forwards standby wake edges to noteWake() only after initial connect, and accepts closeIdleHome actions.
        const plMod = require('../service/plugin-launcher.js');
        let agentUp = true, tickFn = null, notes = 0;
        const stubDock = {
            changes: 0, installed: () => true, readState: () => ({enabled: true}),
            noteWake() { notes++; },
            supervise: async () => 'running',
            setCloseIdleHome: async on => ({closeIdleHome: on})
        };
        const pl = plMod.definition(stubDock, {timers: {setInterval: fn => { tickFn = fn; return {}; }, clearInterval() {}}}).create({
            vetro: {
                agentConnected: () => agentUp,
                json: (r, b, c) => { r.code = c || 200; r.body = b; },
                readJson: (req, r, cb) => cb(req.body)
            }
        });
        pl.start();
        tickFn();
        assert.equal(notes, 0, 'cold connect does not fire noteWake');
        agentUp = false; tickFn();
        agentUp = true; tickFn();
        assert.equal(notes, 1, 'reconnect after disconnect fires noteWake');
        const plRes = {code: 0, body: null};
        pl.route({method: 'POST', url: '/plugins/launcher/api/action', body: {action: 'closeIdleHome', on: false}}, plRes, 'action');
        await new Promise(r => setImmediate(r));
        assert.deepEqual(plRes, {code: 200, body: {closeIdleHome: false}});

        // dashboard exposes Close idle Samsung Home toggle in Launcher Customization
        const dashHtml = require('../service/dashboard.js')();
        assert.ok(dashHtml.includes('data-dock-idle-home') && dashHtml.includes('Close idle Samsung Home'), 'dashboard includes Close idle Samsung Home switch');
    }

    console.log('PASS dock service: on, off, boot start, crash restart, back-off that never switches it off');
})().catch(e => { console.error(e); process.exitCode = 1; });

{ const local=new (require('../service/dock.js').Dock)({execute:()=>Promise.reject(Error('no TV'))}); for(const slug of ['settings','samsunghome']) { const icon=local.iconFile(slug); assert.ok(icon && icon.slice(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'local preview system icon: '+slug); } }

// The dashboard's read of where the sound goes: one root read, kept 30 s, null when the TV cannot answer, never failing the status.
(async () => {
    const {Dock, parseAudio} = require('../service/dock.js');
    assert.deepEqual(parseAudio('S|1\nE|1\nM|1\n'), {selection: 1, extVolume: 1, mbr: true});
    assert.deepEqual(parseAudio('S|0\nE|False\nM|0\n'), {selection: 0, extVolume: false, mbr: false});
    assert.equal(parseAudio('S|\nE|\nM|0\n'), null, 'no speaker selection: nothing to say');
    assert.equal(parseAudio('S|1; rm\n'), null);
    let reads = 0, clock = 1000;
    const d = new Dock({execute: cmd => { if (/^echo "S\|/.test(cmd)) { reads++; return Promise.resolve({exit_code: 0, stdout: 'S|1\nE|1\nM|1\n'}); } return Promise.reject(Error('not here')); }, now: () => clock});
    assert.deepEqual(await d.audioOutput(), {selection: 1, extVolume: 1, mbr: true});
    clock += 10000; await d.audioOutput(); assert.equal(reads, 1, 'kept 30 s');
    clock += 30000; await d.audioOutput(); assert.equal(reads, 2, 'read again after 30 s');
    const down = new Dock({execute: () => Promise.reject(Error('no root agent connected'))});
    assert.equal(await down.audioOutput(), null);
    console.log('PASS dock audio output: parsed, cached, null when unreadable');
})().catch(e => { console.error(e); process.exitCode = 1; });

(async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const {Dock} = require('../service/dock.js');
    const launcher = require('../service/plugin-launcher.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-idle-test-'));
    try {
        const stateFile = path.join(dir, 'state.json');
        let powerOnCmds = 0, pipeLive = false, execLog = [];
        const d = new Dock({
            dir: path.join(__dirname, '..', 'native', 'dock'),
            stateFile: stateFile,
            appsFile: path.join(dir, 'apps.tsv'),
            inputsFile: path.join(dir, 'inputs.tsv'),
            customAppsFile: path.join(dir, 'custom.tsv'),
            uptime: () => 60,
            execute: cmd => {
                powerOnCmds++;
                execLog.push(cmd);
                return Promise.resolve({exit_code: 0, stdout: pipeLive && cmd.indexOf('echo "idle ') >= 0 ? 'live\n' : ''});
            }
        });
        assert.deepEqual(
            {m: d.readState().idleMode, a: d.readState().idleAutoDock, p: d.readState().idlePictureOffMin, s: d.readState().idleSuppressScreensaver, bh: d.readState().idleBackHoldMode, bhd: d.readState().idleBackHoldDock},
            {m: 'off', a: false, p: 0, s: false, bh: 'off', bhd: false},
            'idleScreen defaults to off / false / 0 / false / off / false'
        );
        assert.equal((await d.status()).idleSuppressScreensaver, false, 'status exposes idleSuppressScreensaver default');
        assert.equal((await d.status()).idleBackHoldMode, 'off', 'status exposes idleBackHoldMode default');
        assert.equal((await d.status()).idleBackHoldDock, false, 'status exposes idleBackHoldDock default');
        assert.ok(!d.startScript().includes('--idle-mode'), 'off mode omits --idle-mode from startScript');
        assert.ok(!d.startScript().includes('--idle-no-screensaver'), 'off mode omits --idle-no-screensaver from startScript');

        await assert.rejects(() => d.setIdleScreen({mode: 'invalid'}), /Invalid idle mode/);
        await assert.rejects(() => d.setIdleScreen({mode: 'beacon'}), /Invalid idle mode/);
        await assert.rejects(() => d.setIdleScreen({autoDock: 'yes'}), /Invalid auto-dock/);
        await assert.rejects(() => d.setIdleScreen({pictureOffMin: 30}), /Invalid idle picture-off/);
        await assert.rejects(() => d.setIdleScreen({pictureOffMin: -2}), /Invalid idle picture-off/);
        await assert.rejects(() => d.setIdleScreen({suppressScreensaver: 'yes'}), /Invalid screensaver setting/);
        await assert.rejects(() => d.setIdleScreen({backHoldMode: 'kill'}), /Invalid back-hold mode/);
        await assert.rejects(() => d.setIdleScreen({backHoldDock: 'yes'}), /Invalid back-hold dock setting/);

        await d.setIdleScreen({mode: 'aurora'});
        assert.equal(d.readState().idleMode, 'aurora');
        assert.ok(d.startScript().includes('--idle-mode aurora'), 'startScript carries aurora mode');
        await d.setIdleScreen({mode: 'aurora-clean', pictureOffMin: -1});
        assert.equal(d.readState().idleMode, 'aurora-clean');
        assert.equal(d.readState().idlePictureOffMin, -1);
        assert.ok(d.startScript().includes('--idle-mode aurora-clean --idle-potoff -1'), 'startScript carries --idle-potoff -1 for no-dim mode');
        await d.setIdleScreen({mode: 'off', pictureOffMin: 0});

        await d.setIdleScreen({mode: 'clock', autoDock: true, pictureOffMin: 5, suppressScreensaver: true});
        assert.equal(d.readState().idleMode, 'clock');
        assert.equal(d.readState().idleAutoDock, true);
        assert.equal(d.readState().idlePictureOffMin, 5);
        assert.equal(d.readState().idleSuppressScreensaver, true);
        assert.equal((await d.status()).idleSuppressScreensaver, true, 'status reflects idleSuppressScreensaver');
        const script = d.startScript();
        assert.ok(script.includes('--idle-mode clock --idle-autodock --idle-potoff 5 --idle-no-screensaver'), 'startScript carries idle flags including --idle-no-screensaver when enabled');
        assert.ok(script.includes('DOTNET_EnableDiagnostics=0'), 'startScript keeps DOTNET_EnableDiagnostics=0');
        assert.ok(!script.includes('DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1'), 'startScript omits rejected DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 (#278)');

        // Omitting suppressScreensaver preserves existing idleSuppressScreensaver=true
        await d.setIdleScreen({mode: 'wallpaper'});
        assert.equal(d.readState().idleSuppressScreensaver, true, 'setIdleScreen preserves idleSuppressScreensaver when omitted');

        powerOnCmds = 0;
        await d.showAtPowerOn({enabled: true, customApp: null, idleMode: 'clock', idleAutoDock: true});
        assert.equal(powerOnCmds, 0, 'showAtPowerOn backs off when idleAutoDock owns arrival');

        const pl = launcher.definition(d).create({vetro: {agentConnected: () => true, json: (res, obj, code) => { res.code = code || 200; res.body = obj; }, readJson: (req, res, cb) => cb(req.body)}});
        const plRes = {code: 0, body: null};
        pl.route({method: 'POST', url: '/plugins/launcher/api/action', body: {action: 'idleScreen', mode: 'wallpaper', autoDock: false, pictureOffMin: 0}}, plRes, 'action');
        await new Promise(r => setTimeout(r, 30));
        assert.equal(plRes.code, 200);
        assert.equal(d.readState().idleMode, 'wallpaper');
        assert.equal(d.readState().idleSuppressScreensaver, true, 'plugin route without suppressScreensaver preserves state');

        await d.setIdleScreen({mode: 'clean', suppressScreensaver: false});
        assert.equal(d.readState().idleMode, 'clean');
        assert.equal(d.readState().idleSuppressScreensaver, false);
        assert.ok(d.startScript().includes('--idle-mode clean') && !d.startScript().includes('--idle-no-screensaver'), 'startScript omits --idle-no-screensaver when false');

        // Enabled launcher: live FIFO update succeeds without calling refreshOr / restart; external launch sends launch curtain.
        d.patchState({enabled: true});
        pipeLive = true;
        execLog = [];
        let refreshed = 0;
        const origRefreshOr = d.refreshOr.bind(d);
        d.refreshOr = undo => { refreshed++; return origRefreshOr(undo); };
        await d.setIdleScreen({mode: 'wallpaper', autoDock: true, pictureOffMin: 5, suppressScreensaver: true});
        assert.equal(refreshed, 0, 'live FIFO update avoids launcher restart');
        assert.ok(execLog.some(cmd => cmd.includes('echo "idle wallpaper 1 5 1 off 0" >&3')), 'FIFO command carries mode, autoDock, potOff, suppressScreensaver=1, backHoldMode, and backHoldDock');
        assert.ok(!execLog.some(cmd => cmd.includes('kill -9')), 'live FIFO update does not kill or restart launcher');

        execLog = [];
        await d.setIdleScreen({suppressScreensaver: false, pictureOffMin: -1});
        assert.ok(execLog.some(cmd => cmd.includes('echo "idle wallpaper 1 -1 0 off 0" >&3')), 'FIFO command carries -1 for no-dim and suppressScreensaver=0');

        execLog = [];
        await d.setIdleScreen({backHoldMode: 'minimize', backHoldDock: true});
        assert.ok(execLog.some(cmd => cmd.includes('echo "idle wallpaper 1 -1 0 minimize 1" >&3')), 'FIFO command carries minimize and backHoldDock=1');
        assert.ok(d.startScript().includes('--idle-back-hold minimize --idle-back-hold-dock'), 'startScript carries --idle-back-hold and --idle-back-hold-dock');
        await d.setIdleScreen({backHoldMode: 'off', backHoldDock: false});

        execLog = [];
        await d.notifyAppLaunch(true, 'com.samsung.tv.cobalt-yt');
        assert.ok(execLog.some(cmd => cmd.includes('echo "launch 8 com.samsung.tv.cobalt-yt" >&3')), 'notifyAppLaunch sends shard launch curtain over FIFO');

        // Fallback to refreshOr when launcher pipe is unavailable.
        pipeLive = false;
        d.refreshOr = () => { refreshed++; return Promise.resolve(d.status()); };
        await d.setIdleScreen({mode: 'clock', autoDock: false, pictureOffMin: 0});
        assert.equal(refreshed, 1, 'falls back to restart when FIFO is not live');
        d.patchState({enabled: false});
        d.refreshOr = origRefreshOr;

        const dashHtml = require('../service/dashboard.js')();
        assert.ok(!dashHtml.includes('Minimal Beacon') && !dashHtml.includes('quick-item-wide') && dashHtml.includes('<div class="quick-item" data-quick-item="idle-autodock">') && dashHtml.includes('<div class="quick-item" data-quick-item="idle-noscreensaver">') && dashHtml.includes('data-dock-idle-mode') && dashHtml.includes('data-dock-idle-autodock') && dashHtml.includes('data-dock-idle-potoff') && dashHtml.includes('No dim (Keep full brightness)') && dashHtml.includes('data-dock-idle-noscreensaver') && dashHtml.includes('Replace Samsung screensaver') && dashHtml.includes('Shows Vetro’s backdrop instead of Samsung’s screen saver whenever the TV goes idle in apps, menus, HDMI inputs or Empty TV.') && dashHtml.includes('Empty TV screen') && dashHtml.includes('dockIdleSec') && dashHtml.includes('Pure Black + Clock (OLED)') && dashHtml.includes('Midnight Lake + Clock') && dashHtml.includes('Midnight Lake (No text)') && dashHtml.includes('Aurora Silk + Clock') && dashHtml.includes('Aurora Silk (No text)'), 'dashboard includes Empty TV screen section, 2-column quick-items without quick-item-wide, No-dim option, Replace Samsung screensaver toggle, and updated backdrop mode labels without beacon');
        console.log('PASS dock idleScreen: defaults, validation, startScript flags, showAtPowerOn guard, plugin route, dashboard');
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
