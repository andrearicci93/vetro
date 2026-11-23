'use strict';
// The update lock against Samsung's standalone update (#308): the runtime guard that removes the request file, the app-binary
// helper in the masked units, the lock applied again once after a Vetro update in the same boot, and the reported update hosts
// in the local DNS filter. Scripts are read for their effect, never run (the awk hook is run for real in quick-masks).
const assert = require('assert').strict, qw = require('../service/quick-wins.js');

function tv(start) {
  const s = Object.assign({autoupdate: 1, fwsvc: 1, masked: {}, guard: false, guardFiles: 0, flag: false, guardFails: false, calls: []}, start);
  const execute = async cmd => {
    const sh = Buffer.from(cmd.split(' ')[1], 'base64').toString(); s.calls.push(sh);
    if (sh.includes('echo "AU|')) return {exit_code: 0, stdout: 'AU|value = ' + s.autoupdate + ' (Int32)\nFWS|value = ' + s.fwsvc + ' (Int32)\n' +
      qw.FWUNITS.map(u => 'LS|' + u + '|' + (s.masked[u] ? 'masked' : 'loaded') + '|inactive').join('\n') +
      '\nQB|0\nGD|' + (s.guard ? 'active' : 'inactive') + '\nSF|' + (s.flag ? 1 : 0) + '\n'};
    if (/systemctl mask --runtime swu-auto-upgrade\.timer/.test(sh)) {
      // The guard's files come before the one mask call (its reload reads them), the start and the removal after it.
      const write = sh.indexOf('base64 -d > ' + qw.FW_GUARD_DIR + '/' + qw.FW_GUARD + '.path'), mask = sh.indexOf('systemctl mask --runtime');
      const startAt = sh.indexOf('systemctl start --no-block ' + qw.FW_GUARD + '.path');
      assert.ok(write >= 0 && write < mask && mask < startAt, 'guard files, then the mask call, then the guard start');
      s.guardFiles = (sh.match(/ \| base64 -d > \S+vetro-update-lock-guard\.(path|service)/g) || []).length;
      for (const u of qw.FWUNITS) s.masked[u] = true;
      if (!s.guardFails) s.guard = true;
      if (sh.includes('rm -f ' + qw.STANDALONE_FLAG)) s.flag = false;
      for (const m of sh.matchAll(/vconftool set -f -t int (\S+) (-?\d+)/g)) { if (m[1] === qw.FWSERVICE) s.fwsvc = +m[2]; else s.autoupdate = +m[2]; }
      s.maskRuns = (s.maskRuns || 0) + 1;
      return {exit_code: 0, stdout: ''};
    }
    if (/systemctl unmask --runtime/.test(sh)) {
      assert.ok(sh.indexOf('systemctl stop ' + qw.FW_GUARD + '.path') < sh.indexOf('systemctl unmask'), 'guard stopped and removed before the unmask reload');
      assert.ok(sh.includes('rm -f ' + qw.FW_GUARD_DIR + '/' + qw.FW_GUARD + '.path ' + qw.FW_GUARD_DIR + '/' + qw.FW_GUARD + '.service'));
      s.masked = {}; s.guard = false; return {exit_code: 0, stdout: ''};
    }
    const set = /^vconftool set -f -t int (\S+) (-?\d+)/.exec(sh);
    if (set) { if (set[1] === qw.FWSERVICE) s.fwsvc = +set[2]; else s.autoupdate = +set[2]; }
    if (sh.includes('sha256sum')) return {exit_code: 0, stdout: 'vetro-hook: installed\n'};
    return {exit_code: 0, stdout: ''};
  };
  return {s, execute};
}
function store(init) { let data = init ? JSON.stringify(init) : null; return {readFileSync() { if (data === null) throw Error('absent'); return data; }, writeFileSync(f, t) { data = t; }, renameSync() {}, get data() { return JSON.parse(data); }}; }
function dns(start) {
  const d = Object.assign({enabled: true, applied: true, domains: []}, start), applied = [];
  return {d, applied, status: async () => ({enabled: d.enabled, applied: d.enabled, domains: d.domains.slice()}),
    apply: async (enabled, domains) => { applied.push({enabled, domains}); d.enabled = enabled; d.domains = domains.slice(); return {}; }};
}
const noWait = () => Promise.resolve();

(async () => {
  // The helper of the app-binary updater is one of the masked units; the guard unit files are what systemd needs.
  assert.ok(qw.FWUNITS.includes('fw-update-init-download.service'));
  assert.ok(!qw.FWUNITS.some(u => /swu-standalone|bootmode-swu-standalone|system-rw-update|os-upgrade/.test(u)), 'the standalone and OS-upgrade boots are not masked');
  assert.match(qw.FW_GUARD_FILES.path, /^\[Unit\][\s\S]*DefaultDependencies=no[\s\S]*\[Path\]\nPathExists=\/mnt\/systemrw\/org\.tizen\.tv\.swu\/data\/tv\/STANDALONE\nUnit=vetro-update-lock-guard\.service\n$/);
  assert.match(qw.FW_GUARD_FILES.service, /DefaultDependencies=no[\s\S]*Type=oneshot\nExecStart=\/bin\/rm -f \/mnt\/systemrw\/org\.tizen\.tv\.swu\/data\/tv\/STANDALONE\n$/);

  // The read: the guard and the request file, both yes/no.
  assert.deepEqual([qw.parse('GD|active\nSF|0').fwGuard, qw.parse('GD|active\nSF|0').standaloneFlag], [true, false]);
  assert.deepEqual([qw.parse('GD|inactive\nSF|1').fwGuard, qw.parse('GD|inactive\nSF|1').standaloneFlag], [false, true]);
  assert.equal(qw.parse('').fwGuard, null, 'no line, unknown');

  // Lock on: the request left from before the lock is removed, the guard runs, the hosts go into the filter's list.
  let t = tv({flag: true}), io = store(), f = dns({domains: ['ads.example.com']});
  let w = new qw.Wins(t.execute, {fs: io, sleep: noWait, bootId: () => 'b1', dns: f});
  let r = await w.apply('firmware', true);
  assert.equal(r.status, 'on'); assert.equal(t.s.guardFiles, 2); assert.equal(t.s.guard, true); assert.equal(t.s.flag, false);
  assert.equal(r.dns, 'blocked');
  assert.deepEqual(f.d.domains, ['ads.example.com'].concat(qw.FW_DNS_HOSTS));
  assert.deepEqual(io.data.firmwareDnsAdded, qw.FW_DNS_HOSTS); assert.equal(io.data.firmwareRev, qw.FW_LOCK_REV);
  let st = await w.read();
  assert.equal(st.wins.firmware.guard, true); assert.equal(st.wins.firmware.standalone, false); assert.equal(st.wins.firmware.dnsBlocked, true);

  // Samsung writes the request while the lock is on: the read says so (the guard removes it on a TV), and a lock without its guard is partial.
  t.s.flag = true; st = await w.read(); assert.equal(st.wins.firmware.standalone, true);
  t.s.guard = false; st = await w.read(); assert.equal(st.wins.firmware.status, 'partial', 'all units masked but no guard');

  // Off: the guard goes with the masks; only the hosts Vetro added leave the list.
  t = tv(); io = store(); f = dns({domains: ['otn2.samsungcloudcdn.com']});   // the owner had one of them already
  w = new qw.Wins(t.execute, {fs: io, sleep: noWait, bootId: () => 'b2', dns: f});
  await w.apply('firmware', true);
  assert.deepEqual(io.data.firmwareDnsAdded, ['qoe.samsungcloud.tv'], 'a host already in the list is not Vetro\u2019s');
  r = await w.apply('firmware', false);
  assert.equal(r.status, 'off'); assert.equal(t.s.guard, false); assert.equal(r.dns, 'removed');
  assert.deepEqual(f.d.domains, ['otn2.samsungcloudcdn.com']); assert.equal(f.d.enabled, true);
  assert.deepEqual(io.data.firmwareDnsAdded, []); assert.equal(io.data.firmwareRev, 0);

  // A filter that is off stays off: the hosts are only saved in its list. Without a filter, the lock still works.
  t = tv(); io = store(); f = dns({enabled: false, domains: []});
  w = new qw.Wins(t.execute, {fs: io, sleep: noWait, bootId: () => 'b3', dns: f});
  r = await w.apply('firmware', true); assert.equal(r.dns, 'saved'); assert.equal(f.d.enabled, false); assert.deepEqual(f.d.domains, qw.FW_DNS_HOSTS);
  t = tv(); w = new qw.Wins(t.execute, {fs: store(), sleep: noWait, bootId: () => 'b4'});
  r = await w.apply('firmware', true); assert.equal(r.status, 'on'); assert.equal(r.dns, 'unavailable');
  // A filter that fails does not undo the lock.
  t = tv(); f = dns(); f.apply = async () => { throw Error('busy'); };
  w = new qw.Wins(t.execute, {fs: store(), sleep: noWait, bootId: () => 'b5', dns: f});
  r = await w.apply('firmware', true); assert.equal(r.status, 'on'); assert.equal(r.dns, 'failed');

  // A guard that does not start: the lock is not kept, and the previous state is put back.
  t = tv({guardFails: true}); w = new qw.Wins(t.execute, {fs: store(), sleep: noWait, bootId: () => 'b6'});
  await assert.rejects(w.apply('firmware', true), /did not keep the lock/);
  assert.equal(t.s.masked['swu-core-tv.service'], undefined, 'unmasked again');

  // A TV that had the lock from 0.7.0: same boot, older pass record, no revision. The boot pass runs again once, masks the new
  // unit, starts the guard, adds the hosts once; the switch then reads "on" without being touched.
  const old = {firmware: true, autoupdatePrevious: 1, firmwareBoot: 'same-boot'};
  t = tv({autoupdate: 0, fwsvc: 0}); for (const u of qw.FWUNITS) if (u !== 'fw-update-init-download.service') t.s.masked[u] = true;
  io = store(old); f = dns({domains: ['ads.example.com']});
  w = new qw.Wins(t.execute, {fs: io, sleep: noWait, bootId: () => 'same-boot', dns: f, skipAmbient: true});
  assert.equal((await w.read()).wins.firmware.status, 'partial', 'before the pass: one unit unmasked and no guard');
  const did = await w.boot(null);
  assert.ok(did.includes('firmware'));
  assert.equal((await w.read()).wins.firmware.status, 'on');
  assert.equal(io.data.firmwareBoot, 'same-boot#' + qw.FW_LOCK_REV); assert.equal(io.data.firmwareRev, qw.FW_LOCK_REV);
  assert.deepEqual(f.d.domains, ['ads.example.com'].concat(qw.FW_DNS_HOSTS));
  // Once per boot and revision: a second boot call does nothing, and hosts the owner took out are not put back by the next boot.
  const runs = t.s.maskRuns; assert.deepEqual(await w.boot(null), []); assert.equal(t.s.maskRuns, runs);
  f.d.domains = ['ads.example.com'];
  w = new qw.Wins(t.execute, {fs: io, sleep: noWait, bootId: () => 'next-boot', dns: f, skipAmbient: true});
  await w.boot(null); assert.deepEqual(f.d.domains, ['ads.example.com'], 'the hosts are added by the boot only once');

  // The hook (installed with the lock) carries the guard too; its keys are not mistaken for the lock's own choice.
  const hook = qw.fwHookScript();
  assert.ok(hook.indexOf(qw.FW_GUARD + '.path') > 0 && hook.indexOf(qw.FW_GUARD + '.service') > 0);
  assert.ok(hook.indexOf('> ' + qw.FW_GUARD_DIR + '/' + qw.FW_GUARD + '.path') < hook.indexOf('/usr/bin/systemctl mask --runtime'), 'files before the mask call');
  assert.ok(hook.includes(qw.STANDALONE_FLAG + ' >/dev/null 2>&1")'), 'the request file is removed at boot');
  const lockRe = /"firmware"[ \t]*:[ \t]*true/;   // what the hook looks for in the saved choices
  assert.ok(hook.includes('/"firmware"[ \\t]*:[ \\t]*true/'), 'the hook uses that pattern');
  assert.ok(lockRe.test('{"firmware":true}') && !lockRe.test('{"firmwareDnsAdded":["qoe.samsungcloud.tv"],"firmwareRev":2}'));

  console.log('PASS update lock guard: standalone request removed and guarded at runtime, fw-update-init-download masked, lock re-applied once after a Vetro update, update hosts in the DNS filter only while Vetro added them');
})().catch(e => { console.error(e); process.exit(1); });
