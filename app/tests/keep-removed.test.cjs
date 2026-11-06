'use strict';
// Credit: the mechanism and this test come from zabique (https://github.com/zabique/vetro, branch fork/extras); the
// global switch, learn() and the Vetro-package rule are new here.
// Apps the user removed stay removed. At the source: their store ids go into webappservice's list of recommended
// apps the user uninstalled (WASConfigTable RESERVED_19), which its app sync skips. Backstop: check() uninstalls
// any that comes back anyway and logs it.
const assert = require('assert').strict;
const fs = require('fs'), os = require('os'), path = require('path');
const M = require('../service/keep-removed.js');
const { KeepRemoved, installedScript, parseInstalled, clean, plan, parseSource, sourceWriteScript } = M;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-removed-'));
let n = 0;
const fresh = () => path.join(dir, 'list' + (++n) + '.json');

// List handling: ids are checked, Vetro itself can never be listed, duplicates collapse.
assert.deepEqual(clean(['org.tizen.primevideo', 'MCmYXNxgcu', 'MCmYXNxgcu']), ['org.tizen.primevideo', 'MCmYXNxgcu']);
assert.throws(() => clean(['x; reboot']), /Invalid package id/);
assert.throws(() => clean(['vetrotvapp']), /cannot be kept removed/);
assert.throws(() => clean(['vetrotvapp.svc']), /cannot be kept removed/, 'every Vetro app id');
assert.ok(installedScript(['a1', 'b.c']).includes("package IN ('a1','b.c')"));
assert.deepEqual(parseInstalled('I|org.tizen.primevideo|true|false\r\nI|lib-x|false|true\njunk\n'),
    [{ packageId: 'org.tizen.primevideo', removable: true, system: false }, { packageId: 'lib-x', removable: false, system: true }]);

// plan(): Samsung's own entries stay; listed ids join; only ids Vetro added leave when unlisted.
assert.deepEqual(plan(['111'], ['222', '333'], []), { want: ['111', '222', '333'], owned: ['222', '333'] });
assert.deepEqual(plan(['111', '222', '333'], ['222'], ['222', '333']), { want: ['111', '222'], owned: ['222'] });
assert.deepEqual(plan(['111', '222'], [], ['222']), { want: ['111'], owned: [] }, 'emptied list: Samsung entry 111 kept');
assert.deepEqual(plan(['111'], ['111'], []).owned, [], 'Samsung recorded it itself: not ours to take off later');
assert.deepEqual(parseSource('M|MCmYXNxgcu|3201901017640\r\nM|bad id|1\nC|3201511006428, 3201901017640,\n'),
    { map: { MCmYXNxgcu: '3201901017640' }, current: ['3201511006428', '3201901017640'] });
assert.deepEqual(parseSource('C|\n').current, [], 'an empty value is an empty list, not a failed read');
assert.throws(() => sourceWriteScript(["1');DROP TABLE x;--"]), /Unsafe/);
assert.ok(sourceWriteScript(['1', '2']).indexOf('vetro-webappservice.db.bak') < sourceWriteScript(['1', '2']).indexOf('INSERT OR REPLACE'), 'backup first');

// A fake TV: Samsung's rows (package -> store id), RESERVED_19, installed packages.
function tv(o) {
    const s = Object.assign({ rows: {}, reserved: '', installed: [], cmds: [], writes: 0 }, o);
    s.execute = async cmd => {
        s.cmds.push(cmd);
        if (cmd.startsWith('echo ')) {
            const sh = Buffer.from(cmd.split(' ')[1], 'base64').toString();
            if (sh.includes('INSERT OR REPLACE INTO WASConfigTable')) {
                s.reserved = /VALUES\('RESERVED_19','([^']*)'\)/.exec(sh)[1]; s.writes++;
                return { exit_code: 0, stdout: 'C|' + s.reserved + '\n' };
            }
            if (sh.includes('WASConfigTable')) {
                const lines = Object.keys(s.rows).filter(p => sh.includes("'" + p + "'")).map(p => 'M|' + p + '|' + s.rows[p]);
                return { exit_code: 0, stdout: lines.concat(['C|' + s.reserved]).join('\n') + '\n' };
            }
            const rows = s.installed.filter(p => sh.includes("'" + p.id + "'")).map(p => 'I|' + p.id + '|' + p.removable + '|' + p.system);
            return { exit_code: 0, stdout: rows.join('\n') + '\n' };
        }
        const m = /^pkgcmd -u -n (\S+)$/.exec(cmd);
        if (m) { s.installed = s.installed.filter(p => p.id !== m[1]); return { exit_code: m[1] === 'Stuck00001' ? 1 : 0, stdout: m[1] === 'Stuck00001' ? 'error -1' : 'ok' }; }
        return { exit_code: 1, stdout: '' };
    };
    return s;
}
const app = (id, removable = true, system = false) => ({ id, removable, system });

(async function () {
    // Empty list: nothing runs at all.
    let t = tv({});
    let k = new KeepRemoved(t.execute, { path: fresh() }); k.setEnabled(true);
    assert.deepEqual((await k.check()).removed, []);
    assert.equal(t.cmds.length, 0);

    // The source fix: the listed apps' store ids join Samsung's own entry, once; the TV has nothing to undo.
    const p = fresh();
    t = tv({ rows: { MCmYXNxgcu: '3201901017640', 'org.tizen.primevideo': '3201910019365', 'org.tizen.netflix-app': '3201907018807' }, reserved: '3201712015358' });
    k = new KeepRemoved(t.execute, { path: p }); k.setEnabled(true);
    k.change('set', ['MCmYXNxgcu', 'org.tizen.primevideo']);
    let r = await k.check();
    assert.equal(t.reserved, '3201712015358,3201901017640,3201910019365');
    assert.deepEqual([r.source.changed, r.removed, k.history()], [true, [], []]);
    r = await k.check();
    assert.deepEqual([r.source.changed, t.writes], [false, 1], 'no write while it is right');

    // Samsung drops an app's row: its id is remembered and stays in RESERVED_19.
    delete t.rows.MCmYXNxgcu;
    r = await k.check();
    assert.equal(t.reserved, '3201712015358,3201901017640,3201910019365');

    // Prime Video taken off the list: only Vetro's id for it leaves; Samsung's own entry and Disney+ stay.
    k.change('remove', ['org.tizen.primevideo']);
    await k.check();
    assert.equal(t.reserved, '3201712015358,3201901017640');
    // List emptied: Vetro's ids leave, Samsung's entry is never touched.
    k.change('set', []);
    await k.check();
    assert.equal(t.reserved, '3201712015358');
    r = await k.check();
    assert.equal(t.writes, 3, 'nothing left of ours: no more writes');

    // Backstop: Prime Video and Apple TV came back anyway; both are uninstalled, logged, the Home row pruned.
    let pruned = [];
    t = tv({ rows: { 'org.tizen.primevideo': '3201910019365', 'com.samsung.tv.aria-video': '3201807016597' },
        installed: [app('org.tizen.primevideo'), app('com.samsung.tv.aria-video'), app('org.tizen.netflix-app')] });
    k = new KeepRemoved(t.execute, { path: fresh(), now: () => 1234, onRemoved: async x => { pruned = pruned.concat(x); } }); k.setEnabled(true);
    k.change('set', ['org.tizen.primevideo', 'com.samsung.tv.aria-video', 'MCmYXNxgcu']);
    r = await k.check();
    assert.deepEqual(r.removed, ['org.tizen.primevideo', 'com.samsung.tv.aria-video']);
    assert.deepEqual(pruned, r.removed);
    assert.deepEqual(k.history(), [{ at: 1234, removed: r.removed }], 'kept across restarts');
    assert.ok(t.installed.some(x => x.id === 'org.tizen.netflix-app'), 'unlisted apps are never touched');
    assert.ok(!t.cmds.includes('pkgcmd -u -n MCmYXNxgcu'), 'an app that is not back is not uninstalled again');

    // A system or non-removable package is reported, never uninstalled; a failed uninstall is reported.
    t = tv({ installed: [app('lib-core', false, true), app('Stuck00001')] });
    k = new KeepRemoved(t.execute, { path: fresh() }); k.setEnabled(true);
    k.change('set', ['lib-core', 'Stuck00001']);
    r = await k.check();
    assert.deepEqual(r.removed, []);
    assert.deepEqual(r.skipped.map(s => s.packageId + ':' + s.reason), ['lib-core:not removable', 'Stuck00001:error -1']);
    assert.ok(!t.cmds.includes('pkgcmd -u -n lib-core'));
    assert.throws(() => k.change('wipe', []), /Unknown action/);

    // Registry unreadable: the source step reports it and writes nothing; the backstop still runs.
    t = tv({ installed: [app('org.tizen.primevideo')] });
    const broken = async cmd => (Buffer.from(cmd.split(' ')[1] || '', 'base64').toString().includes('WASConfigTable') ? { exit_code: 1, stdout: '' } : t.execute(cmd));
    k = new KeepRemoved(broken, { path: fresh() }); k.setEnabled(true);
    k.change('set', ['org.tizen.primevideo']);
    r = await k.check();
    assert.equal(r.source.error, 'Samsung app registry unavailable');
    assert.deepEqual([r.removed, t.writes], [['org.tizen.primevideo'], 0]);

    // The switch is global: off, the list is kept but RESERVED_19 gets only Samsung's entries and nothing is uninstalled.
    t = tv({ rows: { MCmYXNxgcu: '3201901017640' }, reserved: '3201712015358', installed: [app('MCmYXNxgcu')] });
    k = new KeepRemoved(t.execute, { path: fresh() });
    k.change('set', ['MCmYXNxgcu']);
    r = await k.check();
    assert.deepEqual([t.reserved, r.removed, t.writes], ['3201712015358', [], 0], 'never enabled: nothing happens');
    k.setEnabled(true);
    r = await k.check();
    assert.deepEqual([t.reserved, r.removed], ['3201712015358,3201901017640', ['MCmYXNxgcu']]);
    k.setEnabled(false);
    t.installed = [app('MCmYXNxgcu')];
    r = await k.check();
    assert.equal(t.reserved, '3201712015358', 'off: Vetro ids leave, Samsung entry stays');
    assert.deepEqual([r.removed, k.list(), t.installed.length], [[], ['MCmYXNxgcu'], 1], 'off: list kept, no backstop');
    k.setEnabled(true);
    await k.check();
    assert.equal(t.reserved, '3201712015358,3201901017640', 'back on: the remembered store id is used');
    assert.throws(() => k.setEnabled('yes'), /Invalid state/);

    // learn(): the store id is read before the uninstall and survives Samsung dropping its row afterwards.
    t = tv({ rows: { 'org.tizen.primevideo': '3201910019365' }, reserved: '' });
    k = new KeepRemoved(t.execute, { path: fresh() });
    assert.equal(await k.learn('org.tizen.primevideo'), false, 'off: nothing is read');
    assert.equal(t.cmds.length, 0);
    k.setEnabled(true);
    assert.equal(await k.learn('org.tizen.primevideo'), true);
    delete t.rows['org.tizen.primevideo'];
    k.change('add', ['org.tizen.primevideo']);
    await k.check();
    assert.equal(t.reserved, '3201910019365');
    assert.equal(await k.learn('vetrotvapp'), false, 'Vetro itself is never learned');
    assert.equal(await k.learn('x; reboot'), false);
    assert.deepEqual(Object.keys(k.summary()).sort(), ['enabled', 'history', 'last', 'packages']);

    // A switch-off that arrives while a run is in flight is not lost: the run after it takes Vetro's ids out again.
    t = tv({ rows: { MCmYXNxgcu: '3201901017640' }, reserved: '3201712015358' });
    k = new KeepRemoved(t.execute, { path: fresh() });
    k.change('set', ['MCmYXNxgcu']); k.setEnabled(true);
    const inFlight = k.check();
    k.setEnabled(false);
    await k.check();
    await inFlight;
    assert.equal(t.reserved, '3201712015358', 'owned ids left although the first run had written them');
    assert.deepEqual(k.state(), { enabled: false, owned: 0 });
    console.log('PASS keep-removed: store ids recorded in RESERVED_19 (Samsung entries kept), backstop uninstalls and logs, unlisted/system/Vetro never touched');
})().catch(e => { console.error(e); process.exit(1); });
