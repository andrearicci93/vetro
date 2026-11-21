'use strict';
// Samsung's own "do not start" files for the groups' background services (markerUnits), the TV Plus power-on setting (vconf),
// and the process check after a stop: state, the apply flow, and the shell scripts run for real (sh and dash) on fake folders.
const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const quick = require('../service/quick-settings.js');
const decode = cmd => { const m = /^echo (\S+) \| base64 -d \| sh$/.exec(cmd); return m ? Buffer.from(m[1], 'base64').toString() : cmd; };

// 1. state: off needs every file down, on none of them; units the TV does not have do not count
const voice = quick.find('voice');
const rowsOf = (g, disabled) => g.ids.map(id => ({appId: id, disabled, onboot: false, autorestart: false}));
const mk = (present, units) => Object.fromEntries((units || ['com.samsung.tv.farfieldvoice.service', 'org.tizen.voice-app.service']).map(u => [u, {marker: u.replace(/\.service$/, ''), present}]));
assert.equal(quick.state(voice, rowsOf(voice, true)).status, 'off', 'no marker data: as before');
assert.equal(quick.state(voice, rowsOf(voice, true), mk(true)).status, 'off');
const open = quick.state(voice, rowsOf(voice, true), mk(false));
assert.equal(open.status, 'partial', 'apps off but the units can still start');assert.equal(open.markersOpen.length, 2);
const left = quick.state(voice, rowsOf(voice, false), mk(true));
assert.equal(left.status, 'partial', 'apps on again (Samsung re-enabled them) while the files stay');assert.equal(left.markersBlocked.length, 2);
assert.equal(quick.state(voice, rowsOf(voice, false), mk(false)).status, 'on');
assert.equal(quick.state(quick.find('alexa'), rowsOf(quick.find('alexa'), true), mk(false)).status, 'off', 'a group without marker units ignores them');
assert.ok(quick.find('voice-all').markerUnits.includes('com.samsung.tv.bixby-prov.service') && quick.find('voice-all').markerUnits.includes('org.tizen.voice-app.service'));
const health = quick.find('app-health');
assert.deepEqual(health.ids, ['com.samsung.tv.samsung-health'], 'Health\'s service app is never a member (it is on TVs without Samsung Health)');
assert.ok(health.markerUnits.every(u => /^samsunghealth-service-tv/.test(u)));
// state() is sent to the dashboard as text: it must not use anything outside itself
assert.doesNotThrow(() => new Function('return ' + quick.state.toString())()(voice, rowsOf(voice, true), mk(false)));
// parse
const read = 'MK|org.tizen.voice-app.service|org.tizen.voice-app|1\nMK|x.service|bad name;rm|0\nMK|samsunghealth-service-tv-path-activation.service|samsunghealth-service-tv|0\n';
assert.deepEqual(quick.parseMarkers(read), {'org.tizen.voice-app.service': {marker: 'org.tizen.voice-app', present: true},
    'samsunghealth-service-tv-path-activation.service': {marker: 'samsunghealth-service-tv', present: false}});
assert.throws(() => quick.markersReadCommand(['x; reboot']), /Invalid unit/);
assert.throws(() => quick.markersCommand([{unit: 'a.service', marker: '../../etc/x'}], true), /Invalid service/);
assert.throws(() => quick.vconfCommand([{key: 'db/x; reboot', type: 'bool', off: 'false'}], true), /Invalid setting/);
assert.deepEqual(quick.stillRunning('ID|a.b|User::Pkg::a\nID|c.d|User::Pkg::other\nID|e.f|\n', [{appId: 'a.b', packageId: 'a'}, {appId: 'c.d', packageId: 'c'}, {appId: 'e.f', packageId: 'e'}]),
    ['a.b', 'e.f'], 'a reused pid (another package) does not count; an unreadable label trusts the app list');

// 2. the scripts, for real
function run(sh, script, env) {
    const r = cp.spawnSync(sh, ['-c', script], {env: Object.assign({}, process.env, env || {}), encoding: 'utf8'});
    return {code: r.status, out: r.stdout, err: r.stderr};
}
for (const sh of ['sh', fs.existsSync('/bin/dash') ? '/bin/dash' : null].filter(Boolean)) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-markers-'));
    const sys = path.join(root, 'sys') + '/', vetro = path.join(root, 'vetro'), bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    // systemctl: `cat` prints a unit with the guard line, `stop` is noted; vconftool keeps its values in a file
    fs.writeFileSync(path.join(bin, 'systemctl'), '#!/bin/sh\nif [ "$1" = cat ]; then case "$2" in *.missing.service) exit 1;; esac; n=${2%.service}; echo "[Unit]"; echo "ConditionPathExists=!' + sys + '$n"; exit 0; fi\necho "$@" >> ' + root + '/systemctl.log\n', {mode: 0o755});
    fs.writeFileSync(path.join(bin, 'vconftool'), '#!/bin/sh\nF=' + root + '/vconf\nif [ "$1" = get ]; then v=$(grep "^$2=" $F 2>/dev/null | cut -d= -f2); [ -n "$v" ] || exit 1; echo "$2, value = $v (Boolean)"; exit 0; fi\n' +
        'if [ "$1" = set ]; then k=$5; v=$6; [ "$v" = 1 ] && v=True || v=False; grep -v "^$k=" $F > $F.t 2>/dev/null; echo "$k=$v" >> $F.t; mv $F.t $F; fi\n', {mode: 0o755});
    fs.writeFileSync(path.join(root, 'vconf'), 'db/menu/autorun_tv_plus=True\n');
    const fix = s => s.split('/opt/usr/share/systemd/system/').join(sys).split('/home/owner/share/vetro').join(vetro);
    const env = {PATH: bin + ':' + process.env.PATH};
    const units = ['org.tizen.voice-app.service', 'com.samsung.tv.ondevice-voice.service', 'gone.missing.service'];
    let r = run(sh, fix(decode(quick.markersReadCommand(units))), env);
    let found = quick.parseMarkers(r.out);
    assert.deepEqual(Object.keys(found), units.slice(0, 2), sh + ': a unit this TV does not have is left out');
    assert.ok(Object.values(found).every(x => !x.present));
    const list = units.slice(0, 2).map(u => ({unit: u, marker: found[u].marker}));
    r = run(sh, fix(decode(quick.markersCommand(list, true))), env);
    assert.equal(r.code, 0, r.err);
    assert.ok(fs.existsSync(sys + 'org.tizen.voice-app') && fs.existsSync(sys + 'com.samsung.tv.ondevice-voice'), sh + ': files put down');
    assert.deepEqual(fs.readFileSync(vetro + '/quick-markers', 'utf8').trim().split('\n'), ['org.tizen.voice-app', 'com.samsung.tv.ondevice-voice'], sh + ': noted once');
    run(sh, fix(decode(quick.markersCommand(list, true))), env);
    assert.equal(fs.readFileSync(vetro + '/quick-markers', 'utf8').trim().split('\n').length, 2, sh + ': not noted twice');
    assert.match(fs.readFileSync(root + '/systemctl.log', 'utf8'), /stop --no-block org\.tizen\.voice-app\.service/);
    found = quick.parseMarkers(run(sh, fix(decode(quick.markersReadCommand(units))), env).out);
    assert.ok(Object.values(found).every(x => x.present), sh + ': read back as present');
    r = run(sh, fix(decode(quick.markersCommand(list.slice(0, 1), false))), env);
    assert.ok(!fs.existsSync(sys + 'org.tizen.voice-app') && fs.existsSync(sys + 'com.samsung.tv.ondevice-voice'), sh + ': on removes only its own');
    assert.deepEqual(fs.readFileSync(vetro + '/quick-markers', 'utf8').trim().split('\n'), ['com.samsung.tv.ondevice-voice'], sh + ': and forgets it');
    // a file someone else put down is not Vetro's: Restore leaves it
    fs.writeFileSync(sys + 'someone-elses', '');
    r = run(sh, fix(quick.MARKERS_CLEAR), env);
    assert.match(r.out, /MC\|done/);
    assert.ok(!fs.existsSync(sys + 'com.samsung.tv.ondevice-voice') && fs.existsSync(sys + 'someone-elses') && !fs.existsSync(vetro + '/quick-markers'), sh + ': Restore removes what Vetro noted, only that');
    // TV Plus power-on: saved once, set off, put back
    const tvplus = quick.find('tvplus').vconf;
    r = run(sh, fix(decode(quick.vconfCommand(tvplus, true))), env);
    assert.match(r.out, /VC\|db\/menu\/autorun_tv_plus\|0/);
    assert.match(fs.readFileSync(root + '/vconf', 'utf8'), /autorun_tv_plus=False/, sh + ': off');
    run(sh, fix(decode(quick.vconfCommand(tvplus, true))), env);
    assert.equal(fs.readFileSync(vetro + '/quick-vconf/db_menu_autorun_tv_plus', 'utf8').trim(), 'True', sh + ': the first value found is the one kept');
    r = run(sh, fix(decode(quick.vconfRestoreAll())), env);
    assert.match(fs.readFileSync(root + '/vconf', 'utf8'), /autorun_tv_plus=True/, sh + ': put back');
    assert.ok(!fs.existsSync(vetro + '/quick-vconf/db_menu_autorun_tv_plus'), sh + ': and forgotten');
    assert.match(run(sh, fix(decode(quick.vconfRestoreAll())), env).out, /\|none/, sh + ': nothing saved, nothing written');
    fs.writeFileSync(path.join(root, 'vconf'), '');
    assert.match(run(sh, fix(decode(quick.vconfCommand(tvplus, true))), env).out, /\|none/, sh + ': a TV without the key is left alone');
    assert.ok(!fs.existsSync(vetro + '/quick-vconf/db_menu_autorun_tv_plus'));
    // the process check: the app list's pid, the label of that process
    fs.writeFileSync(path.join(bin, 'app_launcher'), '#!/bin/sh\nprintf "\\t appId (PID)\\n\\t  a.b (4242)\\n\\t  c.d (999999)\\n"\n', {mode: 0o755});
    fs.mkdirSync(path.join(root, 'proc', '4242', 'attr'), {recursive: true});
    fs.writeFileSync(path.join(root, 'proc', '4242', 'attr', 'current'), 'User::Pkg::a\0');
    r = run(sh, decode(quick.identityCommand(['a.b', 'c.d', 'e.f'])).replace('sleep 1', ':').split('/proc/').join(root + '/proc/'), env);
    assert.match(r.out, /^ID\|a\.b\|User::Pkg::a$/m, sh + ': a live pid is checked by its label');
    assert.doesNotMatch(r.out, /c\.d|e\.f/, sh + ': a dead pid or an app not in the list is not running');
    fs.rmSync(root, {recursive: true, force: true});
}

// 3. the apply flow with markers: off puts them down and reads them back; on takes them away
function harness(present) {
    const disabled = new Set(), calls = [];
    let files = present ? {'org.tizen.voice-app': true} : {};
    const rows = () => voice.ids.slice(0, 2).map(id => ({appId: id, packageId: id, disabled: disabled.has(id), onboot: false, autorestart: false}));
    return {calls, deps: {invalidate() {}, inventory() { return Promise.resolve({apps: rows(), registryError: null}); },
        execute(cmd) {
            const s = decode(cmd); calls.push(s);
            if (/^for u in .*systemctl cat/.test(s)) return Promise.resolve({exit_code: 0, stdout: 'MK|org.tizen.voice-app.service|org.tizen.voice-app|' + (files['org.tizen.voice-app'] ? 1 : 0) + '\n'});
            if (/touch \/opt\/usr\/share\/systemd\/system\/org\.tizen\.voice-app/.test(s)) { files['org.tizen.voice-app'] = true; return Promise.resolve({exit_code: 0, stdout: ''}); }
            if (/^rm -f \/opt\/usr\/share\/systemd\/system\/org\.tizen\.voice-app/.test(s)) { delete files['org.tizen.voice-app']; return Promise.resolve({exit_code: 0, stdout: ''}); }
            if (s === 'app_launcher -S') return Promise.resolve({exit_code: 0, stdout: '\t' + voice.ids[0] + ' (55)\n'});
            if (/^sleep 1\nL=\$\(app_launcher -S/.test(s)) return Promise.resolve({exit_code: 0, stdout: 'ID|' + voice.ids[0] + '|User::Pkg::' + voice.ids[0] + '\n'});
            const m = /for id in (.*?); do (pkgcmd (-D|-A)|app_launcher -k)/.exec(s);
            if (m) { const ids = m[1].split(' '); if (m[3]) ids.forEach(id => m[3] === '-D' ? disabled.add(id) : disabled.delete(id)); return Promise.resolve({exit_code: 0, stdout: ids.map(id => id + ' 0').join('\n')}); }
            return Promise.resolve({exit_code: 0, stdout: ''});
        }}};
}
(async () => {
    let h = harness(false);
    let r = await quick.apply('voice', true, h.deps);
    assert.deepEqual(r.markers, {off: true, units: 1, ok: true});
    assert.equal(r.state.status, 'off', 'apps off and the file read back');
    assert.deepEqual(r.stillRunning, [voice.ids[0]], 'a member whose process survived the stop is reported');
    r = await quick.apply('voice', false, h.deps);
    assert.deepEqual(r.markers, {off: false, units: 1, ok: true});assert.equal(r.state.status, 'on');
    assert.ok(!h.calls.some(c => /systemctl start/.test(c)), 'on starts nothing: the units\' own .path units do');
    // apps already off, file missing (a group switched off by 0.7.0): switching it off again only puts the file down
    h = harness(false);
    await quick.apply('voice', true, h.deps);
    const before = h.calls.length;
    r = await quick.apply('voice', true, h.deps);
    assert.ok(!h.calls.slice(before).some(c => /pkgcmd/.test(c)), 'no app change');assert.equal(r.markers.ok, true);
    console.log('PASS quick settings markers: state with Samsung\'s "do not start" files, apply puts them down and reads them back, ' +
        'Restore removes only Vetro\'s, the TV Plus power-on value saved and put back, the process check after a stop (sh, dash)');
})().catch(e => { console.error(e); process.exit(1); });
