'use strict';
// Extra performance mode: the ledger (only what it turned on goes back), the parts it reads, and the background app cleanup on the
// read a Q80A printed (2026-11-22: YouTube on screen, Netflix paused behind it), with sound and kept-open apps left alone.
const assert = require('assert').strict;
const pm = require('../service/performance-mode.js');

const TV_READ = ['FG|com.samsung.tv.cobalt-yt', 'MEM|916464', 'BG|org.tizen.welcome-mode|1506|-1000', 'BG|org.tizen.ScreenMirroring-app-tv|2083|600',
    'BG|com.samsung.tv.aria-video|4416|600', 'BG|org.tizen.netflix-app|9893|600', 'BG|com.samsung.tv.cobalt-yt|16032|200', 'BG|com.samsung.hitcomp|24618|480'].join('\n');

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
    assert.equal(s.background.length, 6, 'a malformed line is dropped'); assert.deepEqual(s.audioPids, [777]); assert.deepEqual(s.playing, ['rJeHak5zRg.Spotify']);
    assert.doesNotMatch(pm.READ, /cpu:\/background/, 'no cgroup test: a 2021 Q80A has no cpu:/background group');
    assert.match(pm.READ, /oom_score_adj/); assert.match(pm.READ, /pactl list sink-inputs/); assert.match(pm.READ, /media_controller\.db/);

    // choose: idle long enough, never the app on screen, the TV's own apps, sound, kept-open, or an app resourced keeps in use
    const now = 100 * 60000, front = {'org.tizen.netflix-app': now - 16 * 60000, 'com.samsung.tv.aria-video': now - 20 * 60000, 'com.samsung.tv.cobalt-yt': now - 30 * 60000};
    assert.deepEqual(pm.choose(s, front, now, []), ['com.samsung.tv.aria-video', 'org.tizen.netflix-app'], 'longest idle first; YouTube on screen and the TV\'s apps stay');
    assert.deepEqual(pm.choose(s, front, now, ['org.tizen.netflix-app']), ['com.samsung.tv.aria-video'], 'an app kept open stays');
    assert.deepEqual(pm.choose(Object.assign({}, s, {audioPids: [9893]}), front, now, []), ['com.samsung.tv.aria-video'], 'a native app with a playing stream stays');
    assert.deepEqual(pm.choose(Object.assign({}, s, {playing: ['com.samsung.tv.aria-video']}), front, now, []), ['org.tizen.netflix-app'], 'a media-controller player that plays stays');
    assert.deepEqual(pm.choose(s, {}, now, []), [], 'first seen now: nothing is idle yet');
    const fresh = {'org.tizen.netflix-app': now - 3 * 60000, 'com.samsung.tv.aria-video': now - 60000};
    assert.deepEqual(pm.choose(s, fresh, now, []), [], 'plenty of memory: 3 minutes is not long enough');
    assert.deepEqual(pm.choose(Object.assign({}, s, {memKiB: 400 * 1024}), fresh, now, []), ['org.tizen.netflix-app'], 'low memory: the longest idle past 2 minutes goes at once');
    assert.deepEqual(pm.choose(Object.assign({}, s, {background: [{id: 'org.tizen.netflix-app', pid: 9893, adj: 200}]}), front, now, []), [], 'adj under 300: resourced counts it as in use');
    ['org.tizen.tv-viewer', 'com.samsung.tv.csfs', 'vetrotvapp.Vetro', 'org.tizen.chromium-efl.wrt-client', 'org.tizen.volume-app'].forEach(id => assert.ok(pm.isProtected(id), id));
    assert.match(pm.closeScript(['org.tizen.netflix-app']), /app_launcher -t org\.tizen\.netflix-app[\s\S]*app_launcher -k org\.tizen\.netflix-app[\s\S]*CLOSED\|org\.tizen\.netflix-app/);

    // on: only what was off becomes the mode's; off: only the mode's, and only if still as it left it
    let io = store(), dock = fakeDock({noMotion: false, closeIdleHome: true}), wins = fakeWins({telemetry: 'on'});
    let m = new pm.PerformanceMode(async () => ({exit_code: 0, stdout: ''}), {dock, wins, fs: io});
    let r = await m.apply(true);
    assert.equal(r.status, 'on'); assert.deepEqual(io.json.owned, {motion: true, idleHome: false, wins: ['multiscreen', 'ambient']}, 'telemetry was already on: not the mode\'s');
    assert.deepEqual(dock.calls, ['motion true']); assert.deepEqual(wins.calls, ['multiscreen true', 'ambient true']);
    wins.s.ambient = 'off';   // turned off by hand
    r = await m.read(); assert.equal(r.status, 'partial'); assert.deepEqual(r.changed, ['ambient']);
    r = await m.apply(false);
    assert.equal(r.status, 'off'); assert.deepEqual(wins.calls.slice(2), ['multiscreen false'], 'ambient was turned off by hand: left as it is');
    assert.equal(wins.s.telemetry, 'on', 'telemetry was the owner\'s: still on'); assert.equal(dock.s.noMotion, false); assert.equal(dock.s.closeIdleHome, true, 'idle Home was already on: still on');
    assert.deepEqual(io.json.owned, {motion: false, idleHome: false, wins: []});

    // a win without root reads unknown: not touched
    io = store(); dock = fakeDock({noMotion: true}); wins = {calls: [], read: () => Promise.resolve({wins: {telemetry: {status: 'unknown'}, multiscreen: {status: 'unknown'}, ambient: {status: 'unknown'}}}), apply() { this.calls.push('x'); return Promise.resolve({}); }};
    m = new pm.PerformanceMode(async () => ({exit_code: 0, stdout: ''}), {dock, wins, fs: io});
    await m.apply(true); assert.deepEqual(wins.calls, []); assert.deepEqual(io.json.owned, {motion: false, idleHome: false, wins: []});

    // the choices: the launcher's All apps list without inputs, keys, the TV's own apps and Vetro
    const tsv = '# header\napple-tv\tApple TV\tcom.samsung.tv.aria-video\t\nlivetv\tLive TV\tsource:0\t\nnetflix\tNetflix\torg.tizen.netflix-app\t\n' +
        'tvplus\tSamsung TV Plus\torg.tizen.tv-viewer\t\nvetro\tVetro\tvetrotvapp.app\t\nsettings\tSettings\tkey:XF86SysMenu\torg.tizen.menu\n';
    const files = {'/x/allapps.tsv': tsv}, fsx = Object.assign(store(), {readFileSync(f) { if (files[f] !== undefined) return files[f]; throw Error('absent'); }});
    const mc = new pm.PerformanceMode(async () => ({exit_code: 0, stdout: ''}), {dock: Object.assign(fakeDock(), {allAppsFile: '/x/allapps.tsv'}), fs: fsx});
    assert.deepEqual(mc.choices(), [{appId: 'com.samsung.tv.aria-video', name: 'Apple TV'}, {appId: 'org.tizen.netflix-app', name: 'Netflix'}]);
    assert.deepEqual(new pm.PerformanceMode(null, {dock: fakeDock(), fs: fsx}).choices(), [], 'no list: no choices');

    // keep-open list and Restore's forget
    r = await m.setKeepOpen(['rJeHak5zRg.Spotify', 'rJeHak5zRg.Spotify']); assert.deepEqual(r.keepOpen, ['rJeHak5zRg.Spotify']);
    await assert.rejects(m.setKeepOpen(['bad id']), /Invalid app list/);
    m.forget(); assert.equal(io.json.on, false); assert.deepEqual(io.json.keepOpen, ['rJeHak5zRg.Spotify'], 'Restore keeps the owner\'s list');

    // the cleanup over time: first tick notes the apps, 15 minutes later Netflix and Apple TV go; off: nothing runs
    let clock = 0; const sent = [];
    io = store({on: true, owned: {motion: false, idleHome: false, wins: []}, keepOpen: []});
    m = new pm.PerformanceMode(async cmd => {
        const sh = Buffer.from(cmd.split(' ')[1], 'base64').toString(); sent.push(sh);
        if (sh.includes('echo "FG|')) return {exit_code: 0, stdout: TV_READ};
        return {exit_code: 0, stdout: (sh.match(/CLOSED\|[^"]+/g) || []).join('\n')};
    }, {fs: io, now: () => clock});
    assert.deepEqual(await m.tick(), [], 'first look: everything is new');
    clock += 14 * 60000; assert.deepEqual(await m.tick(), []);
    clock += 60000; assert.deepEqual(await m.tick(), ['com.samsung.tv.aria-video', 'org.tizen.netflix-app']);
    r = await m.read(); assert.equal(r.closed, 2); assert.equal(r.recent[0].id, 'org.tizen.netflix-app');
    io = store({on: false}); const before = sent.length;
    m = new pm.PerformanceMode(async () => { throw Error('must not run'); }, {fs: io});
    assert.deepEqual(await m.tick(), []); assert.equal(sent.length, before);
    console.log('PASS performance mode: ledger on/off (only its own changes, not what was changed by hand), unknown wins untouched, keep-open list, ' +
        'Restore forget, background cleanup on a Q80A read (screen, TV apps, sound, kept-open, adj, low memory)');
})().catch(e => { console.error(e); process.exit(1); });
