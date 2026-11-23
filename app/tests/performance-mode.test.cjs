'use strict';
// Extra performance mode: on and off change no other setting (a 0.7.1 test build's ledger is put back once, on the next Off), and
// the background app cleanup on the read a Q80A printed (2026-11-22: YouTube on screen, Netflix paused behind it), with sound and
// kept-open apps left alone.
const assert = require('assert').strict;
const pm = require('../service/performance-mode.js');

const TV_READ = ['FG|com.samsung.tv.cobalt-yt', 'MEM|916464', 'CG|0', 'BG|org.tizen.welcome-mode|1506|-1000|0', 'BG|org.tizen.ScreenMirroring-app-tv|2083|600|0',
    'BG|com.samsung.tv.aria-video|4416|600|0', 'BG|org.tizen.netflix-app|9893|600|0', 'BG|com.samsung.tv.cobalt-yt|16032|200|0', 'BG|com.samsung.hitcomp|24618|480|0',
    'BG|ContentServiceManager|1474|600|0'].join('\n');
const UI = ['org.tizen.welcome-mode', 'org.tizen.ScreenMirroring-app-tv', 'com.samsung.tv.aria-video', 'org.tizen.netflix-app', 'com.samsung.tv.cobalt-yt', 'com.samsung.hitcomp'];
const ids = list => list.map(a => a.id);

function store(init) { let data = init ? JSON.stringify(init) : null; return {readFileSync() { if (data === null) throw Error('absent'); return data; }, writeFileSync(f, t) { data = t; }, renameSync() {}, get json() { return JSON.parse(data); }}; }
function fakeDock(state) {
    const s = Object.assign({enabled: true, noMotion: false, closeIdleHome: true}, state), calls = [];
    return {s, calls, readState: () => Object.assign({}, s),
        setNoMotion(on) { calls.push('motion ' + on); s.noMotion = on; return Promise.resolve({}); },
        setCloseIdleHome(on) { calls.push('idleHome ' + on); s.closeIdleHome = on; return Promise.resolve({}); }};
}
function fakeWins(status) {
    const s = Object.assign({telemetry: 'off', multiscreen: 'off', ambient: 'off'}, status), calls = [];
    return {s, calls, read: () => Promise.resolve({wins: Object.keys(s).reduce((o, k) => { o[k] = {status: s[k]}; return o; }, {})}),
        apply(id, on) { calls.push(id + ' ' + on); s[id] = on ? 'on' : 'off'; return Promise.resolve({status: s[id]}); }};
}

(async () => {
    // the read: what is on screen, memory, background apps with their oom_score_adj, sound
    const s = pm.parse(TV_READ + '\nAUD|777\nMC|rJeHak5zRg.Spotify\nBG|bad id|1|600');
    assert.equal(s.fg, 'com.samsung.tv.cobalt-yt'); assert.equal(s.memKiB, 916464);
    assert.equal(s.background.length, 7, 'a malformed line is dropped'); assert.equal(s.cgroupInUse, false); assert.deepEqual(s.audioPids, [777]); assert.deepEqual(s.playing, ['rJeHak5zRg.Spotify']);
    assert.match(pm.READ, /cgroup\.procs/, 'the background cgroup counts only where resourced uses it');
    assert.doesNotMatch(pm.READ, /\$\(cat |grep -Fxq/, 'no process started per app');
    assert.match(pm.READ, /oom_score_adj/); assert.match(pm.UIAPPS, /app_component='uiapp'/); assert.match(pm.READ, /pactl list sink-inputs/); assert.match(pm.READ, /media_controller\.db/);

    // choose: idle long enough, never the app on screen, the TV's own apps, sound, kept-open, or an app resourced keeps in use
    const now = 100 * 60000, front = {'org.tizen.netflix-app': now - 16 * 60000, 'com.samsung.tv.aria-video': now - 20 * 60000, 'com.samsung.tv.cobalt-yt': now - 30 * 60000};
    front.ContentServiceManager = now - 60 * 60000;
    assert.deepEqual(pm.choose(s, front, now, [], UI), [{id: 'com.samsung.tv.aria-video', pid: 4416}, {id: 'org.tizen.netflix-app', pid: 9893}], 'longest idle first; YouTube on screen, the TV\'s apps and a non-UI service stay');
    assert.deepEqual(pm.choose(s, front, now, [], null), [], 'UI apps not known yet: nothing is closed');
    assert.deepEqual(ids(pm.choose(s, front, now, ['org.tizen.netflix-app'], UI)), ['com.samsung.tv.aria-video'], 'an app kept open stays');
    assert.deepEqual(ids(pm.choose(Object.assign({}, s, {audioPids: [9893]}), front, now, [], UI)), ['com.samsung.tv.aria-video'], 'a native app with a playing stream stays');
    assert.deepEqual(ids(pm.choose(Object.assign({}, s, {playing: ['com.samsung.tv.aria-video']}), front, now, [], UI)), ['org.tizen.netflix-app'], 'a media-controller player that plays stays');
    assert.deepEqual(pm.choose(s, {}, now, [], UI), [], 'first seen now: nothing is idle yet');
    const fresh = {'org.tizen.netflix-app': now - 3 * 60000, 'com.samsung.tv.aria-video': now - 60000};
    assert.deepEqual(pm.choose(s, fresh, now, [], UI), [], 'plenty of memory: 3 minutes is not long enough');
    assert.deepEqual(ids(pm.choose(Object.assign({}, s, {memKiB: 400 * 1024}), fresh, now, [], UI)), ['org.tizen.netflix-app'], 'low memory: the longest idle past 2 minutes goes at once');
    assert.deepEqual(pm.choose(Object.assign({}, s, {background: [{id: 'org.tizen.netflix-app', pid: 9893, adj: 200, cg: false}]}), front, now, [], UI), [], 'adj under 300: resourced counts it as in use');
    const tizen9 = Object.assign({}, s, {cgroupInUse: true, background: [{id: 'org.tizen.netflix-app', pid: 9893, adj: 600, cg: false}, {id: 'com.samsung.tv.aria-video', pid: 4416, adj: 600, cg: true}]});
    assert.deepEqual(ids(pm.choose(tizen9, front, now, [], UI)), ['com.samsung.tv.aria-video'], 'where resourced uses the background cgroup (#281\'s S90C), an app outside it stays');
    ['org.tizen.tv-viewer', 'com.samsung.tv.csfs', 'vetrotvapp.Vetro', 'org.tizen.chromium-efl.wrt-client', 'org.tizen.volume-app'].forEach(id => assert.ok(pm.isProtected(id), id));
    const cs = pm.closeScript([{id: 'org.tizen.netflix-app', pid: 9893}]);
    assert.match(cs, /app_launcher -t org\.tizen\.netflix-app[\s\S]*\[ -d \/proc\/9893 \][\s\S]*app_launcher -k org\.tizen\.netflix-app/);
    assert.match(cs, /if \[ -d \/proc\/9893 \]; then echo "LEFT\|org\.tizen\.netflix-app"; else echo "CLOSED\|org\.tizen\.netflix-app"; fi/, 'closed only when the process is gone');

    // on and off touch nothing else: not Reduce motion, not Close idle Samsung Home, not the wins
    let io = store(), dock = fakeDock({noMotion: false, closeIdleHome: false}), wins = fakeWins({telemetry: 'on'});
    let m = new pm.PerformanceMode(async () => ({exit_code: 0, stdout: ''}), {dock, wins, fs: io});
    let r = await m.apply(true);
    assert.equal(r.status, 'on'); assert.equal(r.on, true); assert.deepEqual(r.legacy, []); assert.deepEqual(r.errors, []);
    assert.ok(!('parts' in r) && !('changed' in r), 'no parts of its own any more');
    assert.deepEqual(io.json, {on: true, keepOpen: []}, 'no ledger written');
    r = await m.apply(false); assert.equal(r.status, 'off');
    assert.deepEqual(dock.calls, []); assert.deepEqual(wins.calls, []);
    assert.deepEqual(dock.s, {enabled: true, noMotion: false, closeIdleHome: false}); assert.equal(wins.s.telemetry, 'on');

    // a TV that ran a 0.7.1 test build: its ledger is shown, kept while the mode stays on, put back once on the next Off, then gone
    io = store({on: true, owned: {motion: true, idleHome: false, wins: ['multiscreen', 'ambient', 'bogus']}, keepOpen: ['org.keep']});
    dock = fakeDock({noMotion: true, closeIdleHome: true}); wins = fakeWins({telemetry: 'on', multiscreen: 'on', ambient: 'off'});
    m = new pm.PerformanceMode(async () => ({exit_code: 0, stdout: ''}), {dock, wins, fs: io});
    r = await m.read(); assert.equal(r.status, 'on'); assert.deepEqual(r.legacy, ['motion', 'multiscreen', 'ambient'], 'an unknown id is dropped');
    r = await m.setKeepOpen(['org.keep', 'org.other']); assert.deepEqual(io.json.owned, {motion: true, idleHome: false, wins: ['multiscreen', 'ambient']}, 'kept until Off');
    r = await m.apply(true); assert.deepEqual(dock.calls, []); assert.deepEqual(wins.calls, [], 'on again: nothing put back, nothing turned on');
    r = await m.apply(false);
    assert.equal(r.status, 'off'); assert.deepEqual(r.legacy, []);
    assert.deepEqual(dock.calls, ['motion false'], 'Reduce motion, turned on by the test build, goes back off');
    assert.deepEqual(wins.calls, ['multiscreen false'], 'ambient was turned off by hand since: left as it is; telemetry was never the build\'s');
    assert.equal(dock.s.closeIdleHome, true); assert.equal(wins.s.telemetry, 'on');
    assert.deepEqual(io.json, {on: false, keepOpen: ['org.keep', 'org.other']}, 'ledger dropped, keep-open list kept');
    await m.apply(true); await m.apply(false);
    assert.deepEqual(dock.calls, ['motion false']); assert.deepEqual(wins.calls, ['multiscreen false'], 'a second Off puts back nothing');

    // a legacy win without root reads unknown: not touched
    io = store({on: true, owned: {motion: false, idleHome: false, wins: ['telemetry']}});
    wins = {calls: [], read: () => Promise.resolve({wins: {telemetry: {status: 'unknown'}}}), apply() { this.calls.push('x'); return Promise.resolve({}); }};
    m = new pm.PerformanceMode(async () => ({exit_code: 0, stdout: ''}), {dock: fakeDock(), wins, fs: io});
    await m.apply(false); assert.deepEqual(wins.calls, []); assert.equal(io.json.owned, undefined);

    // the choices: the launcher's All apps list without inputs, keys, the TV's own apps and Vetro
    const tsv = '# header\napple-tv\tApple TV\tcom.samsung.tv.aria-video\t\nlivetv\tLive TV\tsource:0\t\nnetflix\tNetflix\torg.tizen.netflix-app\t\n' +
        'tvplus\tSamsung TV Plus\torg.tizen.tv-viewer\t\nvetro\tVetro\tvetrotvapp.app\t\nsettings\tSettings\tkey:XF86SysMenu\torg.tizen.menu\n';
    const files = {'/x/allapps.tsv': tsv}, fsx = Object.assign(store(), {readFileSync(f) { if (files[f] !== undefined) return files[f]; throw Error('absent'); }});
    const mc = new pm.PerformanceMode(async () => ({exit_code: 0, stdout: ''}), {dock: Object.assign(fakeDock(), {allAppsFile: '/x/allapps.tsv'}), fs: fsx});
    assert.deepEqual(mc.choices(), [{appId: 'com.samsung.tv.aria-video', name: 'Apple TV'}, {appId: 'org.tizen.netflix-app', name: 'Netflix'}]);
    assert.deepEqual(new pm.PerformanceMode(null, {dock: fakeDock(), fs: fsx}).choices(), [], 'no list: no choices');

    // keep-open list and Restore's forget
    await assert.rejects(m.setKeepOpen(['bad id']), /Invalid app list/);
    io = store({on: true, owned: {motion: true, idleHome: true, wins: ['ambient']}, keepOpen: []});
    m = new pm.PerformanceMode(async () => ({exit_code: 0, stdout: ''}), {dock: fakeDock(), fs: io});
    r = await m.setKeepOpen(['rJeHak5zRg.Spotify', 'rJeHak5zRg.Spotify']); assert.deepEqual(r.keepOpen, ['rJeHak5zRg.Spotify']);
    m.forget(); assert.deepEqual(io.json, {on: false, keepOpen: ['rJeHak5zRg.Spotify']}, 'Restore: off, a test build\'s ledger gone, the owner\'s list kept');

    // the cleanup over time: first tick notes the apps, 15 minutes later Netflix and Apple TV go; off: nothing runs
    let clock = 0; const sent = [];
    io = store({on: true, keepOpen: []});
    m = new pm.PerformanceMode(async cmd => {
        const sh = Buffer.from(cmd.split(' ')[1], 'base64').toString(); sent.push(sh);
        if (sh.includes('echo "FG|')) return {exit_code: 0, stdout: TV_READ};
        if (sh.includes("app_component='uiapp'")) return {exit_code: 0, stdout: UI.join('\n')};
        // Netflix survives -t and -k on this fake TV: reported as left, not counted
        return {exit_code: 0, stdout: (sh.match(/echo "(?:CLOSED|LEFT)\|[^"]+"/g) || []).map(x => x.slice(6, -1)).map(x => x === 'CLOSED|org.tizen.netflix-app' ? 'LEFT|org.tizen.netflix-app' : x).join('\n')};
    }, {fs: io, now: () => clock});
    assert.deepEqual(await m.tick(), [], 'first look: everything is new');
    clock += 14 * 60000; assert.deepEqual(await m.tick(), []);
    clock += 60000; assert.deepEqual(await m.tick(), ['com.samsung.tv.aria-video'], 'Netflix did not go: not counted');
    r = await m.read(); assert.equal(r.closed, 1); assert.equal(r.recent[0].id, 'com.samsung.tv.aria-video');
    assert.equal(sent.filter(x => x.includes("app_component='uiapp'")).length, 1, 'the UI app list is asked once an hour, not every minute');
    io = store({on: false}); const before = sent.length;
    m = new pm.PerformanceMode(async () => { throw Error('must not run'); }, {fs: io});
    assert.deepEqual(await m.tick(), []); assert.equal(sent.length, before);
    console.log('PASS performance mode: on/off change no other setting, a 0.7.1 test build\'s ledger put back once on Off (not what was changed by hand), ' +
        'unknown wins untouched, keep-open list, Restore forget, background cleanup on a Q80A read (screen, TV apps, sound, kept-open, adj, low memory)');
})().catch(e => { console.error(e); process.exit(1); });
