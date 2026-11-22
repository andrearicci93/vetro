'use strict';
// 2026-11-22 census (Q80A + public diagnostics): a component disabled alone in Apps and processes gets Samsung's "do not start" file
// where a group uses one (ghdaemon restarts every 2 s for ever without it), and content-grab-service (the cable/satellite box key
// handler, filed as a picture grabber until 0.7.1) leaves the tracking switch and is switched on again where an earlier Vetro left it off.
const assert = require('assert').strict;
const qs = require('../service/quick-settings.js');
const catalog = require('../service/app-catalog.js');
const decode = cmd => { const m = /^echo (\S+) \| base64 -d \| sh$/.exec(cmd); return m ? Buffer.from(m[1], 'base64').toString() : cmd; };

(async () => {
    // 1. componentMarkers: only units a group already keeps from starting; read, write, read back
    const calls = [];
    let present = false;
    const exec = (cmd) => {
        const s = decode(cmd); calls.push(s);
        if (/systemctl cat/.test(s)) return Promise.resolve({exit_code: 0, stdout: 'MK|com.samsung.tv.ghdaemon.service|com.samsung.tv.ghdaemon|' + (present ? 1 : 0) + '\n'});
        if (/touch /.test(s)) present = true;
        if (/rm -f /.test(s)) present = false;
        return Promise.resolve({exit_code: 0, stdout: ''});
    };
    let m = await qs.componentMarkers('com.samsung.tv.ghdaemon', true, exec);
    assert.deepEqual(m, {units: 1, ok: true});
    assert.ok(calls.some(c => /touch \/opt\/usr\/share\/systemd\/system\/com\.samsung\.tv\.ghdaemon\b/.test(c)), 'the file goes down');
    assert.ok(calls.some(c => /quick-markers/.test(c) && /systemctl stop --no-block "\$u"/.test(c)), 'noted for Restore, unit stopped');
    m = await qs.componentMarkers('com.samsung.tv.ghdaemon', false, exec);
    assert.deepEqual(m, {units: 1, ok: true}); assert.equal(present, false, 'enabled again: the file goes away');
    calls.length = 0;
    m = await qs.componentMarkers('com.samsung.tv.ghservice', true, exec);
    assert.deepEqual(m, {units: 0, ok: true}); assert.equal(calls.length, 0, 'no unit of its own in any group: nothing runs');
    m = await qs.componentMarkers('org.tizen.voice-app', true, () => Promise.resolve({exit_code: 0, stdout: ''}));
    assert.deepEqual(m, {units: 0, ok: true}, 'a TV whose unit has no guard line: nothing is created');
    m = await qs.componentMarkers('com.samsung.tv.ghdaemon', true, () => Promise.reject(new Error('agent down')));
    assert.deepEqual(m, {units: 1, ok: false}, 'reported, never thrown');
    assert.deepEqual(await qs.componentMarkers('x; reboot', true, exec), {units: 0, ok: true});

    // 2. content-grab-service: its own area (kept), new text, no longer a tracking member, a former member of tracking-all
    assert.equal(catalog.areaOf('content-grab-service', 'content-grab-service'), 'tv');
    assert.match(catalog.describe({appId: 'content-grab-service'}).purpose, /cable or satellite box/);
    const tracking = qs.find('tracking-all');
    const row = (id, disabled) => Object.assign({appId: id, packageId: id, disabled, onboot: false, autorestart: false}, catalog.describe({appId: id, packageId: id}));
    const rows = [row('com.samsung.tv.acr-service-app', true), row('content-grab-service', true)];
    const st = qs.state(tracking, rows);
    assert.deepEqual(st.installed, ['com.samsung.tv.acr-service-app'], 'not a member any more'); assert.equal(st.status, 'off');
    assert.deepEqual(qs.formersOff(tracking, rows), ['content-grab-service']);
    assert.deepEqual(qs.allFormersOff([row('content-grab-service', false)]), [], 'already on: nothing to do');

    // 3. apply: whichever way the switch goes, a former member left off is switched on, and is never switched off
    for (const off of [true, false]) {
        let apps = rows.map(r => Object.assign({}, r, {disabled: off ? false : true}));
        apps.find(r => r.appId === 'content-grab-service').disabled = true;
        const ran = [];
        const deps = {
            invalidate() {},
            inventory: () => Promise.resolve({apps: apps.map(r => Object.assign({}, r))}),
            execute: (cmd) => {
                const s = decode(cmd); ran.push(s);
                const fm = /for id in (.+); do pkgcmd (-[DA])/.exec(s);
                if (fm) { fm[1].split(' ').forEach(id => { const r = apps.find(a => a.appId === id); if (r) r.disabled = fm[2] === '-D'; });
                    return Promise.resolve({exit_code: 0, stdout: fm[1].split(' ').map(id => id + ' 0').join('\n')}); }
                return Promise.resolve({exit_code: 0, stdout: ''});
            }
        };
        const res = await qs.apply('tracking-all', off, deps);
        assert.deepEqual(res.formersEnabled, ['content-grab-service'], 'off=' + off);
        assert.equal(apps.find(r => r.appId === 'content-grab-service').disabled, false);
        assert.ok(!ran.some(s => /pkgcmd -D/.test(s) && /content-grab-service/.test(s)), 'never disabled');
    }
    console.log('PASS loop fixes: a component disabled alone gets Samsung\'s file where a group uses one; content-grab-service out of tracking, switched on again');
})().catch(e => { console.error(e); process.exit(1); });
