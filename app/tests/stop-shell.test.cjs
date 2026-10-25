'use strict';
// The stop snippet runs under `set -e` on the TV: this runs it for real against a fake app_launcher.
const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const hbbtv = require('../service/hbbtv.js');
const qw = require('../service/quick-wins.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-stop-'));
const state = path.join(dir, 'left');
// app_launcher -S lists the app while `left` polls remain; -t arms the counter and exits 1, like a launcher that
// complains. The counter drops by one at every -S.
fs.writeFileSync(path.join(dir, 'app_launcher'), [
  '#!/bin/sh',
  'S=' + state,
  'case "$1" in',
  '  -S) n=$(cat $S 2>/dev/null || echo 0); if [ "$n" -gt 0 ]; then echo "	  $APP ($$)"; echo $((n-1)) > $S; fi;;',
  '  -t) echo "$ARMED" > $S; echo terminated:$2 >> ' + path.join(dir, 'calls') + '; exit 1;;',
  'esac', ''].join('\n'), {mode: 0o755});

function run(script, app, armed, initial) {
  fs.writeFileSync(state, String(initial));
  fs.writeFileSync(path.join(dir, 'calls'), '');
  const r = cp.spawnSync('sh', ['-c', 'set -e\n' + script + '\necho finished'], {
    env: {PATH: dir + ':' + process.env.PATH, APP: app, ARMED: String(armed)}, encoding: 'utf8', timeout: 20000});
  return {code: r.status, out: r.stdout, left: Number(fs.readFileSync(state, 'utf8')), calls: fs.readFileSync(path.join(dir, 'calls'), 'utf8')};
}

for (const [name, script, app] of [['HbbTV', hbbtv.STOP, 'org.tizen.hbbtv'], ['quick wins', qw.stop('org.tizen.ambientapp'), 'org.tizen.ambientapp']]) {
  // running, and it takes three polls to leave: terminated, waited, no failure although -t exited 1
  let r = run(script, app, 3, 99);
  assert.equal(r.code, 0, name + ': a non-zero -t does not abort the script: ' + r.out);
  assert.match(r.out, /finished/);
  assert.match(r.calls, new RegExp('terminated:' + app.replace(/\./g, '\\.')));
  assert.equal(r.left, 0, name + ': it waited until the app left the list');
  // not running: -t is never called
  r = run(script, app, 3, 0);
  assert.equal(r.code, 0);
  assert.equal(r.calls, '', name + ': nothing to stop, nothing called');
  // an app that never leaves: the wait is bounded and the script still ends (the caller reads the state back)
  const t0 = Date.now();
  r = run(script, app, 1000, 1000);
  assert.equal(r.code, 0);
  assert.ok(Date.now() - t0 < 12000, name + ': bounded wait');
}
fs.rmSync(dir, {recursive: true, force: true});
console.log('PASS stop snippet: runs under set -e, tolerates a non-zero -t, waits for the app to leave, bounded');
