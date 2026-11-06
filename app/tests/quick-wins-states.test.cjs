'use strict';
// Regression tests for the quick-wins state machine (app/docs/STATE-MACHINES.md, SM-9):
//  - a failing save must not leave the busy flag set;
//  - the boot enforcement must not act on a choice the user has withdrawn in the meantime;
//  - the boot marker is written only when the stop really ran.
// Written against 0.5.0, where the busy-flag and withdrawn-choice fixes were already in place (Promise.resolve().then in apply,
// chosen() in the boot tasks); the exit-code case below was the part that still failed.
const assert = require('assert').strict;
const qw = require('../service/quick-wins.js');
const b64 = cmd => Buffer.from(cmd.split(' ')[1], 'base64').toString();
function store(options) {
  options = options || {};
  let data = null;
  return {
    readFileSync() { if (data === null) throw Error('absent'); return data; },
    writeFileSync(f, t) { if (options.failWrites && options.failWrites.count-- > 0) throw Error('ENOSPC: no space left on device'); data = t; },
    renameSync() {},
    get data() { return data; }, set data(v) { data = v; }
  };
}

(async () => {
  // --- busy flag after a failing save ------------------------------------------------------------------------
  for (const id of ['ambient', 'telemetry']) {
    const io = store({failWrites: {count: 1}});
    const w = new qw.Wins(async () => ({exit_code: 0, stdout: 'AR|0\nTR|0\n'}), {fs: io, sleep: () => Promise.resolve()});
    await assert.rejects(async () => w.apply(id, true), /ENOSPC/, id + ': the save error reaches the caller as a rejection');
    assert.equal(w.busy, false, id + ': a failed save must release the busy flag');
    await w.apply('multiscreen', false).catch(e => { assert.doesNotMatch(e.message, /already being changed/); });
  }
  console.log('PASS a failing save releases the quick-win busy flag');

  // --- boot: ambient choice withdrawn while the boot poll is waiting -----------------------------------------
  {
    const io = store();
    const calls = [];
    let ambientUp = false;
    const w = new qw.Wins(async cmd => {
      const sh = b64(cmd); calls.push(sh);
      if (/up \|\| echo down/.test(sh)) return {exit_code: 0, stdout: ambientUp ? 'up\n' : 'down\n'};
      return {exit_code: 0, stdout: ''};
    }, {fs: io, sleep: async () => {
      // The user switches the win off and Samsung's launch brings the app up while the boot poll sleeps.
      io.data = JSON.stringify(Object.assign(JSON.parse(io.data), {ambient: false}));
      ambientUp = true;
    }, bootId: () => 'boot-1'});
    io.data = JSON.stringify({ambient: true});
    const did = await w.boot(null);
    assert.ok(!calls.some(c => /systemctl stop screend/.test(c)), 'the app the user allowed again must not be stopped');
    assert.deepEqual(did, []);
    assert.equal(JSON.parse(io.data).ambientBoot || null, null, 'no boot marker for work that was not done');
    console.log('PASS boot enforcement of Ambient stops when the user withdraws the choice');
  }

  // --- boot: telemetry choice withdrawn during the 45 s wait -------------------------------------------------
  {
    const io = store();
    const offRuns = [];
    const w = new qw.Wins(async cmd => {
      const sh = b64(cmd);
      if (/^touch \/opt\/usr\/share\/systemd\/system\/canalysis-daemon/.test(sh)) offRuns.push(sh);
      return {exit_code: 0, stdout: ''};
    }, {fs: io, sleep: async () => { io.data = JSON.stringify(Object.assign(JSON.parse(io.data), {telemetry: false})); }, bootId: () => 'boot-1', skipAmbient: true});
    io.data = JSON.stringify({telemetry: true});
    await w.boot(null);
    assert.equal(offRuns.length, 1, 'the second pass must not run after the user switched the win off');
    console.log('PASS boot enforcement of telemetry stops when the user withdraws the choice');
  }

  // --- boot: no marker when the stop could not run -----------------------------------------------------------
  {
    const io = store();
    const w = new qw.Wins(async () => { throw new Error('no root agent connected'); },
      {fs: io, sleep: () => Promise.resolve(), bootId: () => 'boot-1', skipAmbient: true});
    io.data = JSON.stringify({telemetry: true});
    const did = await w.boot(null);
    assert.deepEqual(did, [], 'nothing was done');
    assert.equal(JSON.parse(io.data).telemetryBoot || null, null, 'the boot is not marked done, so the next attempt in this boot still runs');
    console.log('PASS the telemetry boot marker is written only after a stop that ran');
  }
  // --- boot: a stop that ran and failed is not a pass ---------------------------------------------------------
  {
    const results = [{exit_code: 1, stderr: 'permission denied'}, {exit_code: 0, stdout: ''}];
    const io = store();
    const w = new qw.Wins(async () => results.shift(), {fs: io, sleep: () => Promise.resolve(), bootId: () => 'boot-1', skipAmbient: true});
    io.data = JSON.stringify({telemetry: true});
    const did = await w.boot(null);
    assert.deepEqual(did, ['telemetry'], 'the retry ran after the first stop failed, and it worked');
    assert.equal(JSON.parse(io.data).telemetryBoot, 'boot-1');

    const io2 = store();
    const w2 = new qw.Wins(async () => ({exit_code: 1, stderr: 'permission denied'}), {fs: io2, sleep: () => Promise.resolve(), bootId: () => 'boot-1', skipAmbient: true});
    io2.data = JSON.stringify({telemetry: true});
    assert.deepEqual(await w2.boot(null), [], 'two failed stops: nothing was done');
    assert.equal(JSON.parse(io2.data).telemetryBoot || null, null, 'and the boot is not marked done');
    console.log('PASS a telemetry stop that exits with an error is retried and never counted as done');
  }
})().catch(e => { console.error(e); process.exit(1); });
