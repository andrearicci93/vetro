'use strict';
// "The TV starts an app again": read-only observation, report section, privacy, no change to how apps are stopped.
const assert = require('assert').strict, path = require('path'), http = require('http'), vm = require('vm');
const {Watch, appIds, cleanLine} = require('../service/relaunch-watch.js');
const report = require('../service/diagnostic-report.js');
const hbbtv = require('../service/hbbtv.js');
const qw = require('../service/quick-wins.js');
const decode = cmd => { const m = /^echo (\S+) \| base64 -d \| sh$/.exec(cmd); return m ? Buffer.from(m[1], 'base64').toString() : cmd; };
const IDS = ['org.tizen.hbbtv', 'org.tizen.hbbtv-service'];
// The TV: `app_launcher -S` answers from a list of states, one per read.
function tv(listPerRead, extra) {
  const scripts = []; let reads = 0;
  const execute = async (cmd) => {
    const sh = decode(cmd); scripts.push(sh);
    if (/^app_launcher -S/.test(sh)) { const i = Math.min(reads++, listPerRead.length - 1), v = listPerRead[i]; if (v instanceof Error) throw v; if (v === 'timeout') return {exit_code: null, timed_out: true}; return {exit_code: 0, stdout: v}; }
    return extra ? extra(sh) : {exit_code: 0, stdout: ''};
  };
  return {execute, scripts};
}
const none = '  com.samsung.tv.other  1234  0\n', back = none + '  org.tizen.hbbtv  4321  0\n';
(async () => {
  assert.deepEqual(appIds('  org.tizen.hbbtv  4321 0\nsome.app 1\n\n'), ['org.tizen.hbbtv', 'some.app']);
  // 12 reads, 5 s apart; the app is back at the second read, so after 5 s.
  let t = tv([none, back]), w = new Watch(t.execute, {sleep: async () => {}});
  let o = await w.start('hbbtv-switch', IDS);
  assert.equal(o.status, 'done'); assert.equal(o.reads, 12); assert.equal(o.relaunched, true); assert.equal(o.intervalSeconds, 5);
  assert.equal(o.targets[0].relaunchedAfterSeconds, 5); assert.equal(o.targets[1].relaunchedAfterSeconds, null);
  assert.equal(w.seen('hbbtv'), true); assert.equal(w.seen('ambient'), false);
  assert.equal(t.scripts.length, 12, 'exactly 12 reads');
  // Never back.
  t = tv([none]); w = new Watch(t.execute, {sleep: async () => {}}); o = await w.start('hbbtv-boot', IDS);
  assert.equal(o.relaunched, false); assert.equal(o.status, 'done'); assert.ok(o.targets.every(x => x.relaunchedAfterSeconds === null)); assert.equal(w.seen('hbbtv'), false);
  // Errors and timeouts are caught; with no usable read the observation is "unavailable"; it never rejects and never stops early.
  t = tv([new Error('agent gone')]); w = new Watch(t.execute, {sleep: async () => {}}); o = await w.start('hbbtv-boot', IDS);
  assert.equal(o.status, 'unavailable'); assert.equal(o.failedReads, 12);
  t = tv(['timeout', back]); w = new Watch(t.execute, {sleep: async () => {}}); o = await w.start('hbbtv-boot', IDS);
  assert.equal(o.status, 'done'); assert.equal(o.failedReads, 1); assert.equal(o.targets[0].relaunchedAfterSeconds, 5);
  // Never in parallel, never while a change is under way.
  const slow = {execute: () => new Promise(r => setTimeout(() => r({exit_code: 0, stdout: none}), 1))};
  w = new Watch(slow.execute, {sleep: async () => {}}); const first = w.start('hbbtv-switch', IDS);
  assert.equal((await w.start('hbbtv-boot', IDS)).status, 'skipped', 'a second observation does not start while one runs');
  await first; assert.equal(w.running, false);
  const wait = () => new Promise(r => setImmediate(r));
  t = tv([none]); w = new Watch(t.execute, {sleep: async () => {}});
  assert.equal((await w.start('hbbtv-switch', IDS, () => true)).status, 'skipped'); assert.equal(t.scripts.length, 0, 'busy: not one command');
  assert.equal(w.observations[0].status, 'skipped-busy');
  assert.equal((await w.start('bad label!', IDS)).status, 'skipped'); assert.equal((await w.start('x', ['a b; rm -rf /'])).status, 'skipped'); assert.equal(t.scripts.length, 0);
  // Read-only: nothing that stops, starts, writes or deletes.
  t = tv([none, back], sh => ({exit_code: 0, stdout: '__APPS__\norg.tizen.hbbtv 1\n__PROCS__\nP hbbtv_app 7\n'}));
  w = new Watch(t.execute, {sleep: async () => {}}); await w.start('hbbtv-switch', IDS); await w.read();
  t.scripts.forEach(s => assert.doesNotMatch(s, /app_launcher -[tsk]\b|kill|vconftool\s+set|\brm\b|\btouch\b|\bmv\b|(?<![0-9&])>\s*\/(?!dev\/null)|\btee\b|systemctl|reboot/, 'read-only: ' + s));
  // Report reading: apps, process ages, filtered log.
  const listing = '__APPS__\n  org.tizen.hbbtv  4321  0\n  org.tizen.hbbtv-service 99\n__PROCS__\nP hbbtv_app 13\nP csfs 5\nP weird;name 1\nnoise\n';
  const log = '10-29 13:24:47.123 I/HBBTV(  1): started from 192.168.1.20 http://x.example/a?b=1 mail me@x.org /home/owner/secret\n10-29 13:24:48.000 I/other(  2): unrelated\n10-29 13:24:49.000 W/CSFS(  3): relaunch requested\n';
  t = tv([none], sh => /dlogutil/.test(sh) ? {exit_code: 0, stdout: log} : {exit_code: 0, stdout: listing});
  w = new Watch(t.execute, {sleep: async () => {}}); await w.start('hbbtv-switch', IDS);
  let d = await w.read();
  assert.deepEqual(d.apps, ['org.tizen.hbbtv', 'org.tizen.hbbtv-service']);
  assert.deepEqual(d.processes, [{name: 'hbbtv_app', ageSeconds: 13}, {name: 'csfs', ageSeconds: 5}]);
  assert.equal(d.logStatus, 'ok'); assert.equal(d.log.length, 2, 'only lines that mention hbbtv or csfs');
  const joined = d.log.join('\n'); assert.doesNotMatch(joined, /192\.168|http|@|\/home\/|10-29/); assert.match(joined, /13:24:47/); assert.match(joined, /relaunch requested/);
  assert.ok(d.log.every(l => l.length <= 160));
  assert.ok(t.scripts.some(s => /timeout 5 dlogutil -d -v time/.test(s)), 'the log read has a 5 s timeout');
  // dlogutil missing, failing or too slow: "unavailable", the rest of the section stays.
  for (const bad of [{exit_code: 1, stdout: ''}, {exit_code: null, timed_out: true}, {exit_code: 0, stdout: '__NO_TIMEOUT__\n'}, 'throw']) {
    t = tv([none], sh => /dlogutil|__NO_TIMEOUT__/.test(sh) ? (bad === 'throw' ? Promise.reject(Error('x')) : bad) : {exit_code: 0, stdout: listing});
    d = await new Watch(t.execute).read(); assert.equal(d.logStatus, 'unavailable'); assert.deepEqual(d.log, []); assert.equal(d.apps.length, 2);
  }
  await assert.rejects(new Watch(async () => ({exit_code: 1})).read(), e => e.code === 'command-failed');
  // Process age from /proc needs no `ps -o`: the script uses /proc only.
  assert.ok(t.scripts.some(s => /\/proc\/uptime/.test(s) && !/ps -/.test(s)));
  // The report section: allowlisted, nothing else gets through.
  const SECRET = 'PERSONAL_SENTINEL@example.com', poison = {secret: SECRET, cmdline: SECRET, pid: 5};
  const full = await report.collect({relaunch: () => ({...poison, apps: ['org.tizen.hbbtv', SECRET, 'http://x.example'], processes: [{...poison, name: 'hbbtv_app', ageSeconds: 7}, {name: SECRET}],
    observations: [{...poison, label: 'hbbtv-switch', status: 'done', reads: 12, failedReads: 0, intervalSeconds: 5, relaunched: true, reason: SECRET, targets: [{id: 'org.tizen.hbbtv', relaunchedAfterSeconds: 5, secret: SECRET}]}],
    logStatus: 'ok', log: ['13:24:47 I/HBBTV: ok', 'unrelated line', 'HBBTV from 192.168.1.5 and ' + SECRET, 42]})}, 100);
  const sec = full.sections.relaunch; assert.equal(sec.status, 'ok');
  const text = JSON.stringify(sec); assert.ok(!text.includes(SECRET)); assert.ok(!text.includes('192.168')); assert.ok(!text.includes('"pid"')); assert.ok(!text.includes('cmdline'));
  assert.deepEqual(sec.data.apps, ['org.tizen.hbbtv']); assert.deepEqual(sec.data.processes, [{name: 'hbbtv_app', ageSeconds: 7}]);
  assert.equal(sec.data.observations[0].reason, null); assert.equal(sec.data.observations[0].targets[0].relaunchedAfterSeconds, 5);
  assert.deepEqual(sec.data.log.slice(0, 1), ['13:24:47 I/HBBTV: ok']); assert.equal(sec.data.log.length, 2);
  assert.equal((await report.collect({}, 100)).sections.relaunch.status, 'unavailable', 'a missing reader leaves the report valid');
  assert.equal((await report.collect({relaunch: () => { throw Error(SECRET); }}, 100)).sections.relaunch.status, 'unavailable');
  // Stopping is unchanged: the exact scripts of hbbtv.js and quick-wins.js.
  assert.equal(hbbtv.STOP, 'if app_launcher -S 2>/dev/null | grep -q "^[[:space:]]*org\\.tizen\\.hbbtv-service[[:space:]]"; then app_launcher -t org.tizen.hbbtv-service || true; i=0; while app_launcher -S 2>/dev/null | grep -q "^[[:space:]]*org\\.tizen\\.hbbtv-service[[:space:]]" && [ $i -lt 10 ]; do sleep 0.5; i=$((i+1)); done; fi\n' +
    'if app_launcher -S 2>/dev/null | grep -q "^[[:space:]]*org\\.tizen\\.hbbtv[[:space:]]"; then app_launcher -t org.tizen.hbbtv || true; i=0; while app_launcher -S 2>/dev/null | grep -q "^[[:space:]]*org\\.tizen\\.hbbtv[[:space:]]" && [ $i -lt 10 ]; do sleep 0.5; i=$((i+1)); done; fi');
  // Wiring in main.js: the switch starts the watcher after the answer, a failed stop only records the reason, and the boot path watches too.
  const service = require('./service-harness.cjs')(path.resolve(__dirname, '..'));
  vm.runInContext(`var seen=[];relaunchWatch.start=function(l,ids,busy){seen.push(['start',l,ids,busy()]);return Promise.resolve({});};relaunchWatch.failed=function(l,r){seen.push(['failed',l,r]);};
    var next=null;hbbtv.change=function(off,exp){return next instanceof Error?Promise.reject(next):Promise.resolve(next);};hbbtv.read=function(){return Promise.resolve({value:19,off:false,valueOff:true,running:true});};relaunchWatch.seen=function(){return true;};`, service.context);
  const server = http.createServer(service.router);
  const call = (method, url, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request({host: '127.0.0.1', port: server.address().port, method, path: url, headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data)}}, res => { let s = ''; res.on('data', c => s += c); res.on('end', () => resolve({status: res.statusCode, body: s})); });
    req.on('error', reject); req.end(data);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    vm.runInContext('next={off:true,value:19};', service.context);
    let r = await call('POST', '/hbbtv', {off: true, expected: 19}); await wait();
    assert.equal(r.status, 200); assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('seen', service.context))), [['start', 'hbbtv-switch', ['org.tizen.hbbtv', 'org.tizen.hbbtv-service'], false]]);
    vm.runInContext('seen=[];next={off:false,value:20};', service.context);
    await call('POST', '/hbbtv', {off: false, expected: 19}); await wait(); assert.equal(vm.runInContext('seen.length', service.context), 0, 'turning HbbTV on starts no observation');
    vm.runInContext("next=new Error('HbbTV is not fully off: the app is still running · previous state restored');", service.context);
    r = await call('POST', '/hbbtv', {off: true, expected: 19}); assert.equal(r.status, 409);
    assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('seen', service.context))), [['failed', 'hbbtv-switch', 'app-still-running']]);
    r = await call('GET', '/hbbtv'); assert.equal(JSON.parse(r.body).relaunchSeen, true, 'the dashboard learns that the app came back');
  } finally { server.close(); }
  // Boot path: after wins.boot stops HbbTV and AmbientApp, each is watched, one after the other.
  const timers = [];
  const boot = require('./service-harness.cjs')(path.resolve(__dirname, '..'), {setInterval: fn => { timers.push(fn); return {unref() {}}; }});
  vm.runInContext("var seen=[];platform.status=function(){return {agent:{connected:true}};};wins.boot=function(){return Promise.resolve(['hbbtv','ambient']);};relaunchWatch.start=function(l,ids){seen.push(l+':'+ids.join('+'));return new Promise(function(r){setTimeout(r,5);});};", boot.context);
  timers.forEach(fn => fn()); await new Promise(r => setTimeout(r, 40));
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('seen', boot.context))), ['hbbtv-boot:org.tizen.hbbtv+org.tizen.hbbtv-service', 'ambient-boot:' + qw.AMBIENT_ID]);
  console.log('PASS relaunch watcher: read-only, 12 reads, report section filtered, stop scripts unchanged');
})().catch(e => { console.error(e); process.exit(1); });
