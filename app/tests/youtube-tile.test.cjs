'use strict';
// The row of the web app service's database that Samsung's YouTube button reads (examples/plugins/youtube/tile.js), against a real
// sqlite3 file with the same schema. What must hold: the value is only ever suffixed and un-suffixed, never rewritten from
// a saved copy; a change made by someone else in between is never overwritten; anything unexpected is left alone.
const assert = require('assert').strict;
const fs = require('fs'), os = require('os'), path = require('path');
const cp = require('child_process');
const tile = require(path.join(__dirname, '..', 'examples', 'plugins', 'youtube', 'tile.js'));

const ORIGINAL = '--base_url=https://www.youtube.com/tv --dial_name=YouTube --use_eden --start_frag=#start';
const W = tile.WRAPPER, K = null;

function newDb(rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-tile-')), db = path.join(dir, 'pkg.db');
  const sql = 'CREATE TABLE widgetinfo (id INTEGER PRIMARY KEY, tizen_id TEXT, pkgname TEXT, reserved_string_6 TEXT);' +
    rows.map(r => "INSERT INTO widgetinfo(tizen_id, reserved_string_6) VALUES('" + r[0] + "','" + r[2] + "');").join('');
  assert.equal(cp.spawnSync('sqlite3', [db], { input: sql }).status, 0);
  return db;
}
function values(db, app) {
  return cp.spawnSync('sqlite3', [db, "select reserved_string_6 from widgetinfo where tizen_id='" + (app || W) + "' order by reserved_string_6;"]).stdout.toString().split('\n').filter(Boolean);
}
const run = (script) => Promise.resolve({ stdout: cp.spawnSync('sh', ['-c', script]).stdout.toString() });
const exec = (s) => run(s);

(async () => {
  // --- pure helpers
  assert.equal(tile.isPatched(ORIGINAL), false);
  const p = tile.patched(ORIGINAL, '127.0.0.2', 8101);
  const REST = '--dial_name=YouTube --use_eden --start_frag=#start';
  assert.equal(p, REST + ' --proxy=127.0.0.2:8101,direct:// --content=/opt/usr/home/owner/share/vyt', 'Samsung\'s default --base_url makes room for our flags');
  assert.ok(p.length <= tile.MAX_VALUE, 'it fits in the 127 characters the TV passes on: ' + p.length);
  assert.equal(tile.patched(ORIGINAL + ' ' + 'x'.repeat(30), '127.0.0.2', 8101), null, 'a value that would not fit is not patched');
  assert.equal(tile.isPatched(p), true);
  assert.equal(tile.original(p), ORIGINAL, 'un-patching takes our flags out and puts the one constant back: no saved copy needed');
  assert.equal(tile.original(tile.patched(ORIGINAL + ' -a', '127.0.0.2', 8101)), ORIGINAL + ' -a');
  assert.equal(tile.patched(p, '127.0.0.2', 8123), tile.patched(ORIGINAL, '127.0.0.2', 8123), 'patching twice never doubles the suffix');
  assert.equal(tile.original(ORIGINAL), ORIGINAL);
  for (const bad of ["a'b", 'a"b', 'a$b', 'a`b', 'a\\b', 'a\nb', '', 'é', 'x'.repeat(700)]) assert.equal(tile.plain(bad), false, JSON.stringify(bad));
  assert.throws(() => tile.swapScript("x' ; drop table t; --", 'y'), /plain printable/);
  assert.throws(() => tile.swapScript('x', 'y$(reboot)'), /plain printable/);
  assert.equal(cp.spawnSync('sh', ['-n'], { input: tile.swapScript(ORIGINAL, p) }).status, 0);

  // --- classify
  assert.deepEqual(tile.classify(''), { state: 'absent', value: null });
  assert.equal(tile.classify(ORIGINAL + '\n').state, 'original');
  assert.equal(tile.classify(p + '\n').state, 'patched');
  assert.equal(tile.classify('--something-else').state, 'foreign', 'a value that does not start like Samsung\'s is not ours to edit');
  assert.equal(tile.classify(ORIGINAL + '\n' + ORIGINAL + ' x\n').state, 'error', 'two rows is unexpected');
  assert.equal(tile.classify('Error: database is locked').state, 'error');
  assert.equal(tile.classify('Parse error: no such table: widgetinfo').state, 'error');

  // --- the real thing against sqlite
  let db = newDb([[W, K, ORIGINAL],
    ['tUb3Xq7Lm9.Tube', K, '--base_url=https://other.example/tv']]);
  assert.equal(await tile.apply(exec, '127.0.0.2', 8101, db), 'patched');
  assert.deepEqual(values(db), [p]);
  assert.deepEqual(values(db, 'tUb3Xq7Lm9.Tube'), ['--base_url=https://other.example/tv'], 'another app\'s row is never touched');
  assert.equal(await tile.apply(exec, '127.0.0.2', 8101, db), 'patched', 'applying again changes nothing');
  assert.equal(await tile.apply(exec, '127.0.0.2', 8123, db), 'patched', 'a new port replaces the old suffix');
  assert.deepEqual(values(db), [tile.patched(ORIGINAL, '127.0.0.2', 8123)]);
  assert.equal(await tile.restore(exec, db), 'original');
  assert.deepEqual(values(db), [ORIGINAL], 'back to exactly what Samsung had');
  assert.equal(await tile.restore(exec, db), 'original', 'restoring again changes nothing');
  assert.equal(cp.spawnSync('sqlite3', [db, 'pragma integrity_check;']).stdout.toString().trim(), 'ok');

  // --- no such row (another firmware): nothing is created
  db = newDb([['someone.else', K, '--base_url=x']]);
  assert.equal(await tile.apply(exec, '127.0.0.2', 8101, db), 'absent');
  assert.equal(await tile.restore(exec, db), 'absent');
  assert.deepEqual(values(db), []);

  // --- a value in a form we do not know is left alone, in both directions
  db = newDb([[W, K, '--base_url=https://www.youtube.com/tv --weird=1 -- ' + 'x'.repeat(10)]]);
  assert.equal(await tile.apply(exec, '127.0.0.2', 8101, db), 'patched', 'a longer value that still starts like Samsung\'s is fine');
  db = newDb([[W, K, 'something else entirely']]);
  assert.equal(await tile.apply(exec, '127.0.0.2', 8101, db), 'foreign');
  assert.equal(await tile.restore(exec, db), 'foreign');
  assert.deepEqual(values(db), ['something else entirely']);

  // --- compare-and-swap: a change between the read and the write is not overwritten
  db = newDb([[W, K, ORIGINAL]]);
  let calls = 0;
  const racing = (script) => {
    if (++calls === 2) cp.spawnSync('sqlite3', [db, "update widgetinfo set reserved_string_6='" + ORIGINAL + " --samsung-update' where tizen_id='" + W + "';"]);
    return run(script);
  };
  assert.equal(await tile.apply(racing, '127.0.0.2', 8101, db), 'raced');
  assert.deepEqual(values(db), [ORIGINAL + ' --samsung-update'], 'the newer value survived');

  // --- the database is missing: no file is created, no crash
  const gone = path.join(os.tmpdir(), 'vetro-tile-missing-' + process.pid, 'x.db');
  assert.equal(await tile.apply(exec, '127.0.0.2', 8101, gone), 'error');
  assert.equal(await tile.restore(exec, gone), 'error');
  assert.equal(fs.existsSync(gone), false);

  // --- two rows with the same key (a second row for the same app: which one is read is not known)
  db = newDb([[W, K, ORIGINAL], [W, K, ORIGINAL + ' --other']]);
  assert.equal(await tile.apply(exec, '127.0.0.2', 8101, db), 'error');
  assert.equal(values(db).length, 2, 'nothing was changed');

  // --- a locked database is reported, not forced
  db = newDb([[W, K, ORIGINAL]]);
  const holder = cp.spawn('sqlite3', [db], { stdio: ['pipe', 'ignore', 'ignore'] });
  holder.stdin.write('BEGIN EXCLUSIVE;\nupdate widgetinfo set reserved_string_6=reserved_string_6;\n');
  await new Promise(r => setTimeout(r, 400));
  const fast = (s) => Promise.resolve({ stdout: cp.spawnSync('sh', ['-c', s.replace(/\.timeout 8000/g, '.timeout 300')]).stdout.toString() });
  const locked = await tile.apply(fast, '127.0.0.2', 8101, db);
  holder.kill();
  assert.equal(locked, 'error', 'a locked database is reported, never forced');
  console.log('youtube tile: ok');
})().catch(e => { console.error(e); process.exit(1); });
