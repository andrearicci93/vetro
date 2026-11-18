'use strict';
// The web app registry query of the catalog script, run for real against two widgetinfo schemas: with app_featured
// (Q80A, Tizen 6.0) and without it (any firmware where that column is missing). Without the column the old five-field
// query must still list the apps, otherwise the launcher loses every web app tile.
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const catalog = require('../service/dock-catalog.js');

if (cp.spawnSync('sqlite3', ['-version']).status !== 0) { console.log('dock-catalog-schema: sqlite3 not installed, skipped'); process.exit(0); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-catalog-schema-'));
const line = catalog.script().split('\n').filter(l => l.indexOf('.webappservice.db') >= 0);
assert.equal(line.length, 1, 'one registry line in the catalog script');

function run(columns, row) {
    const db = path.join(tmp, columns.length + '.db');
    const made = cp.spawnSync('sqlite3', [db, 'CREATE TABLE widgetinfo (' + columns.join(', ') + '); INSERT INTO widgetinfo VALUES (' + row + ');']);
    assert.equal(made.status, 0, String(made.stderr));
    const r = cp.spawnSync('sh', ['-c', line[0].split('/opt/dbspace/.webappservice.db').join(db)], {encoding: 'utf8'});
    assert.equal(r.status, 0, 'the line itself never fails');
    return catalog.parse(r.stdout).registry;
}

const withColumn = run(['id TEXT', 'title TEXT', 'tizen_id TEXT', 'is_hidden INTEGER', 'app_featured INTEGER'], "'aaa', 'Netflix', 'org.tizen.netflix-app', 0, 2");
assert.deepEqual(withColumn.aaa, {title: 'Netflix', appId: 'org.tizen.netflix-app', hidden: false, featured: 2});

const without = run(['id TEXT', 'title TEXT', 'tizen_id TEXT', 'is_hidden INTEGER'], "'aaa', 'Netflix', 'org.tizen.netflix-app', 0");
assert.deepEqual(without.aaa, {title: 'Netflix', appId: 'org.tizen.netflix-app', hidden: false, featured: null},
    'without app_featured the five-field query still lists the app');

fs.rmSync(tmp, {recursive: true, force: true});
console.log('dock-catalog-schema: ok');
