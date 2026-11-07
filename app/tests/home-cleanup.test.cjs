'use strict';
// What `pkgcmd -u` leaves behind (measured on a Q80A: registry row, icon folder and Home line stayed, so the Home showed a tile
// that did not open). The scripts run for real, against a copy of the TV's files in a temp folder.
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const cleanup = require('../service/home-cleanup.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-cleanup-'));
const home = path.join(tmp, 'csfs'), icons = path.join(tmp, 'icons'), bak = path.join(tmp, 'bak'), bin = path.join(tmp, 'bin');
const was = path.join(tmp, 'was.db'), pkg = path.join(tmp, 'pkg.db'), signals = path.join(tmp, 'signals.log');
[home, icons, bin].forEach(d => fs.mkdirSync(d));
// A vconftool that only writes down what it was asked.
fs.writeFileSync(path.join(bin, 'vconftool'), '#!/bin/sh\necho "$@" >> ' + signals + '\n', {mode: 0o755});
const sql = (db, s) => cp.execFileSync('sqlite3', [db, s]);
const rows = db => cp.execFileSync('sqlite3', [db, 'SELECT id FROM widgetinfo ORDER BY id;']).toString().trim().split('\n').filter(Boolean);

function world() {
    [was, pkg, signals].forEach(f => { try { fs.unlinkSync(f); } catch (e) { /* none */ } });
    sql(was, 'CREATE TABLE widgetinfo(id TEXT PRIMARY KEY, title TEXT, tizen_id TEXT, pkgname TEXT, install_state INT);' +
        "INSERT INTO widgetinfo VALUES('3201901017640','Disney+','MCmYXNxgcu.DisneyPlus','MCmYXNxgcu',3),('111299001912','YouTube','9Ur5IzDKqV.TizenYouTube','9Ur5IzDKqV',3)," +
        "('keep1','A','a.a','a',3),('keep2','B','b.b','b',3),('keep3','C','c.c','c',3),('keep4','D','d.d','d',3);");
    // The package manager no longer knows Disney+ (pkgcmd removed it), but still knows YouTube.
    sql(pkg, "CREATE TABLE package_app_info(app_id TEXT, package TEXT); INSERT INTO package_app_info VALUES('9Ur5IzDKqV.TizenYouTube','9Ur5IzDKqV');");
    const list = ['1395', 's/livetv@TVPLUS', 'd/webapp@xvvl3S1TT1.TizenTubeStandalone', 'd/webapp@xvvl3S1TT1', 'd/webapp@111299001912', 'd/webapp@3201901017640',
        'd/webapp@newslO9NqF.stremio', 'd/webapp@keep1', 'EOFCOBA'].join('\n') + '\n';
    ['.appLayerCache.1', '.appLayerCache.2'].forEach(f => fs.writeFileSync(path.join(home, f), list));
    fs.rmSync(icons, {recursive: true, force: true}); fs.mkdirSync(path.join(icons, '3201901017640'), {recursive: true}); fs.mkdirSync(path.join(icons, '111299001912'));
    fs.writeFileSync(path.join(icons, '3201901017640', '224x224.png'), 'x'); fs.writeFileSync(path.join(icons, '111299001912', '224x224.png'), 'x');
    fs.rmSync(bak, {recursive: true, force: true});
}
const lines = f => fs.readFileSync(path.join(home, f), 'utf8').split('\n').filter(Boolean);
function executor(extra) {
    return async function (cmd) {
        const b64 = /^echo (\S+) \| base64 -d \| sh$/.exec(cmd);
        const r = cp.spawnSync('sh', ['-c', Buffer.from(b64[1], 'base64').toString()], {encoding: 'utf8', env: Object.assign({}, process.env, {PATH: bin + ':' + process.env.PATH})});
        return {exit_code: r.status, stdout: r.stdout, stderr: r.stderr, timed_out: false};
    };
}
const opts = extra => Object.assign({homeDirs: [home], wasDb: was, pkgDb: pkg, iconRoot: icons, backupDir: bak, settle: 0, runningCmd: 'false'}, extra || {});

(async function () {
    try {
        // validId: plain ids only
        for (const bad of ['', '.', '..', 'a b', "a'b", 'a;b', 'a/b', '$(x)', 'x'.repeat(121), null, 5]) assert.equal(cleanup.validId(bad), false, String(bad));
        assert.equal(cleanup.validId('MCmYXNxgcu.DisneyPlus'), true);

        // learn: the widget ids of a package, read before it goes
        world();
        assert.deepEqual(await cleanup.learn(executor(), 'MCmYXNxgcu', {wasDb: was}), ['3201901017640']);
        assert.deepEqual(await cleanup.learn(executor(), '9Ur5IzDKqV', {wasDb: was}), ['111299001912']);
        assert.deepEqual(await cleanup.learn(executor(), 'nothing', {wasDb: was}), []);
        assert.deepEqual(await cleanup.learn(executor(), "x'; DROP TABLE widgetinfo; --", {wasDb: was}), [], 'a bad package id reads nothing');
        assert.deepEqual(rows(was).length, 6);
        console.log('PASS learn reads the registry ids of a package');

        // clean: Home lines (by widget id and by package id), registry row, icon folder, signal
        world();
        let r = await cleanup.clean(executor(), 'MCmYXNxgcu', ['3201901017640'], opts());
        assert.equal(r.error, undefined);
        assert.equal(r.home, 'removed'); assert.equal(r.homeLines, 2, 'one line in each of the two caches'); assert.equal(r.rows, 1); assert.equal(r.icons, 1); assert.equal(r.signals, 1);
        ['.appLayerCache.1', '.appLayerCache.2'].forEach(f => {
            assert.ok(!lines(f).includes('d/webapp@3201901017640'));
            assert.ok(lines(f).includes('d/webapp@111299001912') && lines(f).includes('d/webapp@keep1') && lines(f).includes('s/livetv@TVPLUS'), 'the other lines stay');
            assert.equal(lines(f)[0], '1395'); assert.equal(lines(f).at(-1), 'EOFCOBA');
        });
        assert.deepEqual(rows(was), ['111299001912', 'keep1', 'keep2', 'keep3', 'keep4']);
        assert.ok(!fs.existsSync(path.join(icons, '3201901017640')) && fs.existsSync(path.join(icons, '111299001912')), 'only the removed app\'s icons go');
        assert.ok(/set -f -t string memory\/was\/app_uninstall 3201901017640/.test(fs.readFileSync(signals, 'utf8')) && /app_change 1/.test(fs.readFileSync(signals, 'utf8')));
        assert.ok(fs.readdirSync(bak).some(f => /^\.appLayerCache\.1\..*\.before$/.test(f)) && /INSERT INTO "?widgetinfo"?/i.test(fs.readFileSync(path.join(bak, 'widgetinfo-MCmYXNxgcu.sql'), 'utf8')), 'backups of what was changed');
        console.log('PASS clean removes the Home line, the registry row and the icons of an uninstalled package');

        // no registry row at all (the TizenTube case): the Home lines of the package id and of its parts still go
        world();
        r = await cleanup.clean(executor(), 'xvvl3S1TT1', [], opts());
        assert.equal(r.home, 'removed'); assert.equal(r.homeLines, 4); assert.equal(r.rows, 0);
        assert.ok(!lines('.appLayerCache.1').some(l => /xvvl3S1TT1/.test(l)) && lines('.appLayerCache.1').includes('d/webapp@keep1'));
        // "xvvl3S1TT1" must not take lines of a longer, different id
        world();
        fs.appendFileSync(path.join(home, '.appLayerCache.1'), '');
        const l1 = lines('.appLayerCache.1'); l1.splice(-1, 0, 'd/webapp@xvvl3S1TT1x'); fs.writeFileSync(path.join(home, '.appLayerCache.1'), l1.join('\n') + '\n');
        await cleanup.clean(executor(), 'xvvl3S1TT1', [], opts());
        assert.ok(lines('.appLayerCache.1').includes('d/webapp@xvvl3S1TT1x'), 'a different id that only starts the same stays');
        console.log('PASS clean takes the Home lines of a package that has no registry row, and only those');

        // an app that is still installed is never touched
        world();
        r = await cleanup.clean(executor(), '9Ur5IzDKqV', ['111299001912'], opts());
        assert.equal(r.skipped, true);
        assert.ok(lines('.appLayerCache.1').includes('d/webapp@111299001912') && rows(was).includes('111299001912') && fs.existsSync(path.join(icons, '111299001912')));
        assert.ok(!fs.existsSync(signals), 'no signal either');
        console.log('PASS clean leaves an installed app alone');

        // the Home is running: the file is not rewritten (it would write the line back); the row and the icons still go
        world();
        r = await cleanup.clean(executor(), 'MCmYXNxgcu', ['3201901017640'], opts({runningCmd: 'true'}));
        assert.equal(r.home, 'pending'); assert.equal(r.rows, 1);
        assert.ok(lines('.appLayerCache.1').includes('d/webapp@3201901017640'), 'the cache is left as it is while the Home runs');
        console.log('PASS clean does not rewrite the Home row while the Home runs');

        // a registry row of an app the package manager still has is not deleted
        world();
        sql(pkg, "INSERT INTO package_app_info VALUES('MCmYXNxgcu.DisneyPlus','OTHERPKG');");
        r = await cleanup.clean(executor(), 'MCmYXNxgcu', ['3201901017640'], opts());
        assert.equal(r.rows, 0, 'row kept: its app id is still registered');
        console.log('PASS clean keeps a registry row whose app the package manager still knows');

        // sweep: lines whose app is known nowhere
        world();
        let o = await cleanup.orphans(executor(), opts());
        assert.deepEqual(o.orphans.sort(), ['newslO9NqF.stremio', 'xvvl3S1TT1', 'xvvl3S1TT1.TizenTubeStandalone'], 'only ids unknown to both databases (Disney+ still has its registry row here)');
        const s = await cleanup.sweep(executor(), opts());
        assert.equal(s.home, 'removed');
        assert.ok(lines('.appLayerCache.1').includes('d/webapp@3201901017640') && lines('.appLayerCache.1').includes('d/webapp@keep1') && !lines('.appLayerCache.1').some(l => /stremio|xvvl3/.test(l)));
        // an unreadable registry reports nothing instead of calling everything a leftover
        world(); fs.unlinkSync(was);
        o = await cleanup.orphans(executor(), opts());
        assert.deepEqual(o.orphans, []); assert.equal(o.unsafe, true);
        console.log('PASS sweep finds only lines of apps known nowhere, and nothing when the registry cannot be read');
    } catch (e) { console.log('FAIL ' + (e.stack || e)); process.exitCode = 1; }
    fs.rmSync(tmp, {recursive: true, force: true});
})();
