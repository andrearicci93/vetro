'use strict';
// AppRegistry.one: one app's row, read with one shell line instead of the whole inventory (three sqlite3 reads and the
// join of every app). Run for real with sqlite3 on a fake TV (both registries in a temp folder) and compared with load():
// the fields the callers use (Vetro's startup flags at boot, the custom launcher's lookup about once a minute) must agree.
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const registry = require('../service/app-registry.js');
const dockModule = require('../service/dock.js');

if (cp.spawnSync('sqlite3', ['-version']).status !== 0) { console.log('SKIP registry one-row: no sqlite3 here'); process.exit(0); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-registry-one-'));
const uid = typeof process.getuid === 'function' ? process.getuid() : 5001;
const mainDb = path.join(tmp, '.pkgmgr_parser.db'), userDb = path.join(tmp, 'user', String(uid), '.pkgmgr_parser.db');
fs.mkdirSync(path.dirname(userDb), {recursive: true});
function sql(db, text) { const r = cp.spawnSync('sqlite3', [db, text], {encoding: 'utf8'}); assert.equal(r.status, 0, r.stderr); }
sql(mainDb, [
    'CREATE TABLE package_app_info (app_id TEXT, package TEXT, app_type TEXT, app_component TEXT, app_disable TEXT, app_removable TEXT, app_onboot TEXT, app_autorestart TEXT, app_nodisplay TEXT);',
    'CREATE TABLE package_info (package TEXT, package_version TEXT, package_size TEXT, author_name TEXT, package_system TEXT, package_preload TEXT);',
    'CREATE TABLE package_app_localized_info (app_id TEXT, app_label TEXT, app_icon TEXT, app_locale TEXT);',
    'CREATE TABLE package_app_info_for_uid (app_id TEXT, uid INTEGER, is_disabled TEXT);',
    'CREATE TABLE package_dependency_info (package TEXT, depends_on TEXT, type TEXT, required_version TEXT);',
    "INSERT INTO package_app_info VALUES ('vetrotvapp.svc','vetrotvapp','webapp','svcapp','false','true','false','true','true');",
    "INSERT INTO package_app_info VALUES ('com.example.launcher','com.example','webapp','uiapp','false','true','false','false','false');",
    "INSERT INTO package_app_info VALUES ('com.example.off','com.example.off','webapp','uiapp','false','true','false','false','false');",
    "INSERT INTO package_app_info VALUES ('com.samsung.tv.csfs','csfs','dotnet','uiapp','false','false','true','true','false');",
    "INSERT INTO package_info VALUES ('vetrotvapp','0.5.1','100','Vetro','false','false');",
    "INSERT INTO package_info VALUES ('com.example','1.0','10','Someone','false','false');",
    "INSERT INTO package_info VALUES ('com.example.off','1.0','10','Someone','false','false');",
    "INSERT INTO package_info VALUES ('csfs','1.0','10','Samsung','true','true');",
    "INSERT INTO package_app_localized_info VALUES ('com.example.launcher','Mon lanceur','','fr_FR');",
    "INSERT INTO package_app_localized_info VALUES ('com.example.launcher','My launcher','','en_US');"
].join('\n'));
sql(userDb, "CREATE TABLE package_app_info_for_uid (app_id TEXT, uid INTEGER, is_disabled TEXT); INSERT INTO package_app_info_for_uid VALUES ('com.example.off'," + uid + ",'true');");

const commands = [];
async function execute(cmd) {
    commands.push(cmd);
    const r = cp.spawnSync('sh', ['-c', cmd.split('/opt/dbspace/').join(tmp.split(path.sep).join('/') + '/')], {encoding: 'utf8'});
    return {exit_code: r.status, stdout: r.stdout, stderr: r.stderr, timed_out: false};
}

(async function () {
    try {
        const all = await registry.load(execute, {apps: [], packages: []});
        assert.equal(commands.length, 1, 'the whole inventory is one combined read');
        for (const id of ['vetrotvapp.svc', 'com.example.launcher', 'com.example.off', 'com.samsung.tv.csfs']) {
            commands.length = 0;
            const row = await registry.one(execute, id), full = all.apps.find(a => a.appId === id);
            assert.equal(commands.length, 1, 'one command for one row');
            for (const k of ['appId', 'packageId', 'disabled', 'removable', 'system', 'preload', 'onboot', 'autorestart', 'show']) assert.equal(row[k], full[k], id + ' ' + k);
            assert.deepEqual(dockModule.customAppCheck([row], id, false).ok, dockModule.customAppCheck(all.apps, id, false).ok, id + ': same custom launcher answer');
        }
        assert.equal((await registry.one(execute, 'com.example.launcher')).name, 'My launcher', 'the English label first, as in load()');
        assert.equal((await registry.one(execute, 'com.example.off')).disabled, true, "the owner's own registry overrides the flag, as in load()");
        assert.equal(await registry.one(execute, 'not.installed'), null, 'an app that is not registered');
        assert.equal(dockModule.customAppCheck([], 'not.installed', false).reason, 'the app is not installed any more.');
        // Vetro's startup flags: the main registry only.
        commands.length = 0;
        const own = await registry.one(execute, 'vetrotvapp.svc', {user: false});
        assert.equal(commands.length, 1); assert.ok(!commands[0].includes('/user/'), 'without the user registry');
        assert.deepEqual([own.onboot, own.autorestart], [false, true]);
        // A missing user registry is not an error (as in load()); a failing main registry is.
        fs.unlinkSync(userDb);
        assert.equal((await registry.one(execute, 'com.example.off')).disabled, false);
        const broken = async () => ({exit_code: 1, stdout: '', stderr: 'Error: database is locked'});
        await assert.rejects(registry.one(broken, 'vetrotvapp.svc'), /registry query failed/);
        await assert.rejects(registry.one(execute, "x';DROP"), /invalid app ID/, 'only a plain app id reaches the query');
        console.log('PASS registry one row: the same fields as the whole inventory for that app, in one command; missing app is null, a failure rejects');
    } finally { fs.rmSync(tmp, {recursive: true, force: true}); }
})().catch(e => { console.error(e); process.exitCode = 1; });
