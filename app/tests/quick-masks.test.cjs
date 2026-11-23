'use strict';
// The mask switches (remote support, app delivery, Wi-Fi presence) and the telemetry masks: state, apply, units two choices
// share (the update lock and delivery both mask was-background-update), the delivery apps, and the AT-HUB hook run for real (awk).
const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const qw = require('../service/quick-wins.js');

function tv(start) {
    const s = Object.assign({units: {}, apps: {}, calls: [], hook: false}, start);
    const units = ['remote-management.service', 'samsung-easy-support.service', 'remote-shop-care-hub.service', 'was-background-update.path',
        'was-background-update.service', 'wifi-presence.path', 'wifi-presence.service'].concat(qw.FWUNITS, qw.TELEMETRY_MASK);
    units.forEach(u => { if (!s.units[u]) s.units[u] = s.absent && s.absent.includes(u) ? 'not-found' : 'loaded'; });
    const execute = async cmd => {
        const sh = Buffer.from(cmd.split(' ')[1], 'base64').toString(); s.calls.push(sh);
        if (sh.includes('echo "AU|')) return {exit_code: 0, stdout: 'AU|value = 0 (Int32)\nFWS|value = 0 (Int32)\n' +
            Object.keys(s.units).map(u => 'LS|' + u + '|' + s.units[u] + '|' + (s.units[u] === 'masked' ? 'inactive' : s.running && s.running.includes(u) ? 'active' : 'inactive')).join('\n') + '\n' +
            Object.keys(s.apps).map(a => 'DA|' + a + '|' + s.apps[a]).join('\n') + '\nMS|0\nMR|0\nAR|0\nTB|0\nTR|0\nAP|0\nAF|0\nAS|inactive\nAW|0\nQB|' + (s.hook ? 1 : 0) + '\n'};
        if (/SELECT app_id FROM package_app_info WHERE app_disable='false'/.test(sh)) return {exit_code: 0, stdout: Object.keys(s.apps).filter(a => s.apps[a] === 'false').join('\n')};
        if (sh.includes('vetro-hook: restored')) { s.hook = false; return {exit_code: 0, stdout: 'vetro-hook: restored\n'}; }
        for (const m of sh.matchAll(/systemctl mask --runtime ([^>|]+?) >\/dev\/null/g)) m[1].trim().split(/\s+/).forEach(u => { if (s.units[u] && s.units[u] !== 'not-found') s.units[u] = 'masked'; });
        for (const m of sh.matchAll(/systemctl unmask --runtime ([^>|]+?) >\/dev\/null/g)) m[1].trim().split(/\s+/).forEach(u => { if (s.units[u] === 'masked') s.units[u] = 'loaded'; });
        // A boot pass carries the masks and the hook install in one command: both halves count.
        if (sh.includes('sha256sum')) { s.hook = true; return {exit_code: 0, stdout: 'vetro-hook: installed\n'}; }
        const pk = /for id in (.*?); do pkgcmd (-D|-A)/.exec(sh);
        if (pk) pk[1].split(' ').forEach(a => { s.apps[a] = pk[2] === '-D' ? 'true' : 'false'; });
        return {exit_code: 0, stdout: ''};
    };
    return {s, execute};
}
function store(init) { let data = init ? JSON.stringify(init) : null; return {readFileSync() { if (data === null) throw Error('absent'); return data; }, writeFileSync(f, t) { data = t; }, renameSync() {}, get data() { return data; }}; }
const noWait = () => Promise.resolve();

(async () => {
    // owner of the masks
    assert.deepEqual(qw.wantedMasks({firmware: true, delivery: true}, 'delivery').filter(u => /was-background/.test(u)), ['was-background-update.path', 'was-background-update.service'],
        'delivery off while the lock is on: the lock still wants its units');
    assert.ok(!qw.wantedMasks({delivery: true}, 'delivery').length);
    assert.ok(qw.hookWanted({telemetry: true}) && qw.hookWanted({wifipresence: true}) && !qw.hookWanted({ambient: true, airplay: true}));
    assert.ok(!qw.TELEMETRY_MASK.includes('data-service.service'), 'data-service is never masked');
    assert.ok(!qw.TELEMETRY_MASK.includes('org.tizen.tv.sp-kpi.service'), 'sp-kpi is the hardware fault monitor, not viewing data');
    assert.ok(qw.TELEMETRY_MASK.includes('issue_report_agent.service') && qw.TELEMETRY_MASK.includes('abnormal_user_behavior.service'));
    assert.ok(!qw.MASK_WINS.remotesupport.units.some(u => /remotepc/.test(u)), 'Remote PC is left alone (root adapters use it)');
    const unmask = qw.fwUnmaskScript(['was-background-update.path', 'was-background-update.service']);
    assert.ok(!/unmask --runtime [^\n]*was-background-update/.test(unmask) && !/start --no-block [^\n]*was-background-update/.test(unmask), 'the lock off leaves delivery\'s units masked');

    // a TV without any of the units: the switch is not there
    let t = tv({absent: qw.MASK_WINS.remotesupport.units}), io = store(), w = new qw.Wins(t.execute, {fs: io, sleep: noWait});
    assert.equal((await w.read()).wins.remotesupport.status, 'unavailable');
    await assert.rejects(w.apply('remotesupport', true), /Not on this TV/);

    // remote support on and off
    t = tv(); io = store(); w = new qw.Wins(t.execute, {fs: io, sleep: noWait});
    assert.equal((await w.read()).wins.remotesupport.status, 'off');
    let r = await w.apply('remotesupport', true);
    assert.equal(r.status, 'on'); assert.equal(JSON.parse(io.data).remotesupport, true); assert.equal(r.hook, true, 'the early hook keeps the masks after a boot');
    assert.ok(qw.MASK_WINS.remotesupport.units.every(u => t.s.units[u] === 'masked'));
    assert.ok(t.s.calls.every(c => !/systemctl mask (?!--runtime)/.test(c)), 'runtime masks only');
    r = await w.apply('remotesupport', false);
    assert.equal(r.status, 'off'); assert.ok(qw.MASK_WINS.remotesupport.units.every(u => t.s.units[u] === 'loaded'));
    assert.equal(t.s.hook, false, 'nothing else wants the hook: the vendor script is back');

    // delivery while the update lock is on: off must not unmask what the lock still wants; the apps go back only if Vetro disabled them
    t = tv({apps: {'org.tizen.was-appsync': 'false', 'org.tizen.was-appupdate': 'true'}}); io = store({firmware: true}); w = new qw.Wins(t.execute, {fs: io, sleep: noWait});
    r = await w.apply('delivery', true);
    assert.equal(r.status, 'on'); assert.deepEqual(JSON.parse(io.data).deliveryApps, ['org.tizen.was-appsync'], 'only the app that was on is Vetro\'s to turn back on');
    assert.equal(t.s.apps['org.tizen.was-appsync'], 'true');
    r = await w.apply('delivery', false);
    assert.equal(r.status, 'off'); assert.equal(t.s.units['was-background-update.service'], 'masked', 'still masked for the update lock');
    assert.equal(t.s.apps['org.tizen.was-appsync'], 'false'); assert.equal(t.s.apps['org.tizen.was-appupdate'], 'true', 'an app that was already off stays off');
    // the lock off while delivery is on: delivery's units stay masked and the lock reads off
    t = tv(); io = store(); w = new qw.Wins(t.execute, {fs: io, sleep: noWait});
    await w.apply('delivery', true); await w.apply('firmware', true);
    r = await w.apply('firmware', false);
    assert.equal(r.status, 'off', 'the lock is off even though delivery keeps two of its units masked');
    assert.equal(t.s.units['was-background-update.path'], 'masked'); assert.equal(t.s.units['swu-auto-upgrade.timer'], 'loaded');
    assert.equal((await w.read()).wins.delivery.status, 'on');

    // partial: chosen, but a service runs again
    t = tv({running: ['wifi-presence.service']}); io = store({wifipresence: true}); w = new qw.Wins(t.execute, {fs: io, sleep: noWait});
    t.s.units['wifi-presence.path'] = 'masked';
    assert.equal((await w.read()).wins.wifipresence.status, 'partial');

    // the root agent's boot pass masks the chosen switches' units (TVs without the hook), in one command with the hook install
    t = tv(); io = store({wifipresence: true}); w = new qw.Wins(t.execute, {fs: io, sleep: noWait, bootId: () => 'b1', skipAmbient: true});
    const did = await w.boot(null);
    assert.ok(did.includes('wifipresence')); assert.equal(t.s.units['wifi-presence.service'], 'masked');

    // the hook, for real: one mask call with every chosen unit, before the stops, nothing when Vetro is gone
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-hook-'));
    const fake = path.join(root, 'systemctl'), log = path.join(root, 'log'), file = path.join(root, 'wins.json'), app = path.join(root, 'app');
    fs.writeFileSync(fake, '#!/bin/sh\necho "$@" >> ' + log + '\n', {mode: 0o755});
    fs.writeFileSync(path.join(root, 'prd'), 'Build=T-TEST;\nModel=QTEST;\n');
    const hook = qw.fwHookScript().split('/usr/bin/systemctl').join(fake).split(qw.FILE).join(file).split('/opt/usr/apps/vetrotvapp').join(app)
        .split('/proc/target_version').join(path.join(root, 'tv')).split('/etc/prd_info.ini').join(path.join(root, 'prd'))
        .split(qw.FW_GUARD_DIR).join(root).split('/usr/bin/touch').join('true').split('/bin/rm').join('true');
    fs.writeFileSync(path.join(root, 'hook.awk'), hook);
    function boot(choices, installed) {
        try { fs.unlinkSync(log); } catch (e) { /* first */ }
        fs.writeFileSync(file, JSON.stringify(choices) + '\n');
        if (installed) fs.mkdirSync(app, {recursive: true}); else fs.rmSync(app, {recursive: true, force: true});
        const rr = cp.spawnSync('awk', ['-f', path.join(root, 'hook.awk')], {encoding: 'utf8'});
        assert.equal(rr.status, 0, rr.stderr);
        return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
    }
    let lines = boot({firmware: true, telemetry: true, telemetryDns: true, wifipresence: true, delivery: true}, true);
    const masks = lines.filter(l => /^mask --runtime/.test(l));
    assert.equal(masks.length, 1, 'one mask call at boot: each reloads systemd');
    ['swu-auto-upgrade.timer', 'issue_report_agent.service', 'wifi-presence.service', 'was-background-update.path'].forEach(u => assert.ok(masks[0].includes(u), u));
    assert.ok(!masks[0].includes('remote-management.service'), 'a switch that is off is not masked');
    assert.ok(lines.findIndex(l => /^mask/.test(l)) < lines.findIndex(l => /^stop/.test(l)), 'masked before the stops');
    assert.ok(lines.some(l => /^stop --no-block .*wifi-presence\.service/.test(l)));
    assert.equal(fs.readFileSync(path.join(root, 'tv'), 'utf8').trim(), '__T-TEST__QTEST', 'the vendor write still happens');
    // #308: with the lock, the standalone guard's files are written before the mask call and the guard is started after it.
    assert.equal(fs.readFileSync(path.join(root, qw.FW_GUARD + '.path'), 'utf8'), qw.FW_GUARD_FILES.path);
    assert.equal(fs.readFileSync(path.join(root, qw.FW_GUARD + '.service'), 'utf8'), qw.FW_GUARD_FILES.service.split('/bin/rm').join('true'));
    assert.ok(lines.findIndex(l => /^mask --runtime/.test(l)) < lines.findIndex(l => l === 'start --no-block ' + qw.FW_GUARD + '.path'), 'guard started after the masks');
    fs.unlinkSync(path.join(root, qw.FW_GUARD + '.path')); fs.unlinkSync(path.join(root, qw.FW_GUARD + '.service'));
    assert.deepEqual(boot({telemetryDns: true, telemetryBoot: 'x'}, true), [], 'telemetryDns alone is not telemetry');
    assert.deepEqual(boot({remotesupport: true}, false), [], 'Vetro removed: the hook does nothing');
    assert.ok(!fs.existsSync(path.join(root, qw.FW_GUARD + '.path')), 'no guard without the lock');
    lines = boot({remotesupport: true}, true);
    assert.equal(lines.filter(l => /^mask --runtime remote-management\.service samsung-easy-support\.service remote-shop-care-hub\.service$/.test(l.split(' >')[0])).length, 1);
    fs.rmSync(root, {recursive: true, force: true});
    console.log('PASS mask switches: unavailable without their units, on/off with readback, units the lock shares kept masked, delivery apps put back only if Vetro disabled them, ' +
        'boot pass, and the AT-HUB hook run for real with one mask call');
})().catch(e => { console.error(e); process.exit(1); });
