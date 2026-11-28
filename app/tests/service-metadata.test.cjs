'use strict';
// allow.bgservice for Vetro's own service: the real module, its shell run by a real sh against a real sqlite3 and a database with the
// tables the TV's registry has (package_app_info, package_app_app_metadata with a foreign key), and a launcher file that does or does not
// contain the key. Nothing here was tried on a TV.
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path');
const {execFileSync, spawnSync} = require('child_process');
const meta = require('../service/service-metadata.js');

if (spawnSync('sqlite3', ['-version']).error) { console.log('service metadata: skipped (no sqlite3 here)'); process.exit(0); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-service-metadata_'));
const DB = path.join(dir, 'pkgmgr.db'), LAUNCHER = path.join(dir, 'launcher');
const sql = q => execFileSync('sqlite3', [DB, q]).toString().trim();
const reset = () => {
    fs.rmSync(DB, {force: true});
    sql("PRAGMA foreign_keys=ON; CREATE TABLE package_app_info (app_id TEXT PRIMARY KEY NOT NULL, package TEXT NOT NULL, app_onboot TEXT NOT NULL DEFAULT 'false'); " +
        'CREATE TABLE package_app_app_metadata (app_id TEXT NOT NULL, md_key TEXT NOT NULL, md_value TEXT, PRIMARY KEY(app_id, md_key, md_value), ' +
        'FOREIGN KEY(app_id) REFERENCES package_app_info(app_id) ON DELETE CASCADE);' +
        "INSERT INTO package_app_info(app_id,package) VALUES('vetrotvapp.svc','vetrotvapp'),('vetrotvapp.app','vetrotvapp'),('other.svc','other');" +
        "INSERT INTO package_app_app_metadata VALUES('other.svc','" + meta.KEY + "','true');");
};
const withKey = on => fs.writeFileSync(LAUNCHER, Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.from(on ? 'http://samsung.com/tv/metadata/allow.bgservice' : 'use.preview'), Buffer.from([0])]));
const execute = command => {
    assert.match(command, /^echo \S+ \| base64 -d \| sh$/);
    return Promise.resolve({exit_code: 0, stdout: execFileSync('/bin/sh', ['-c', command]).toString()});
};
const run = () => meta.apply(execute, {db: DB, launcher: LAUNCHER});
const rows = () => sql("SELECT app_id||'|'||md_value FROM package_app_app_metadata WHERE md_key='" + meta.KEY + "' ORDER BY 1;");

(async () => {
    try {
        // The launcher does not know the key (older firmware): nothing is written.
        reset(); withKey(false);
        assert.deepEqual(await run(), {state: 'unsupported'});
        assert.equal(rows(), 'other.svc|true', 'no row for Vetro where the key does nothing');

        // A launcher that is missing counts the same.
        fs.rmSync(LAUNCHER);
        assert.deepEqual(await run(), {state: 'unsupported'});

        // The launcher knows the key: one row for the service, written once, nothing else touched.
        withKey(true);
        assert.deepEqual(await run(), {state: 'added'});
        assert.equal(rows(), 'other.svc|true\nvetrotvapp.svc|true');
        assert.equal(sql('SELECT count(*) FROM package_app_info'), '3');
        assert.deepEqual(await run(), {state: 'present'}, 'second start: already there');
        assert.equal(rows(), 'other.svc|true\nvetrotvapp.svc|true', 'not written twice');

        // Installed from a config.xml that has the key (the row is on the UI app): left alone.
        reset();
        sql("INSERT INTO package_app_app_metadata VALUES('vetrotvapp.app','" + meta.KEY + "','true')");
        assert.deepEqual(await run(), {state: 'present'});
        assert.equal(rows(), 'other.svc|true\nvetrotvapp.app|true', 'nothing added for the service');

        // Another package's row does not count for Vetro (the first case above wrote one for Vetro only).
        reset();
        assert.equal((await run()).state, 'added');

        // Vetro's service is not in the registry (not installed as a service): nothing to attach the row to.
        reset(); sql("DELETE FROM package_app_info WHERE app_id='vetrotvapp.svc'");
        assert.deepEqual(await run(), {state: 'unregistered'});

        // The registry refuses the write (read-only file): reported, not thrown, not "added".
        reset(); fs.chmodSync(DB, 0o444);
        const got = await run();
        assert.ok(got.state === 'failed' || got.state === 'added', 'a read-only database is never reported as present');
        if (process.getuid && process.getuid() !== 0) assert.equal(got.state, 'failed');
        fs.chmodSync(DB, 0o644);

        // The TV does not answer: a rejection the caller can retry on.
        await assert.rejects(meta.apply(() => Promise.resolve({exit_code: 1, stdout: ''})), /did not answer/);
        await assert.rejects(meta.apply(() => Promise.resolve({exit_code: 0, stdout: 'nothing useful'})), /did not answer/);
        await assert.rejects(meta.apply(() => { throw new Error('agent down'); }), /agent down/);

        // The command goes through the root agent as one inline shell text, and names only Vetro's service and the one key.
        const s = meta.script();
        assert.ok(s.includes("'vetrotvapp.svc'") && s.includes(meta.KEY));
        assert.ok(!/DELETE|DROP|UPDATE/.test(s), 'only reads and one INSERT OR IGNORE');
        console.log('service metadata: ok');
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
})().catch(e => { console.error(e); process.exit(1); });
