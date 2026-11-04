'use strict';
const assert = require('assert').strict, {DevMode, validIp} = require('../service/dev-mode.js');
// A small TV: the two Developer Mode values and whether a restart was scheduled. Scripts are read, not run.
function tv(start) {
  const s = Object.assign({mode: 1, ip: '127.0.0.1', rebooted: 0, keep: true, fail: null}, start), scripts = [];
  const execute = async cmd => {
    const sh = Buffer.from(cmd.split(' ')[1], 'base64').toString(); scripts.push(sh);
    if (s.fail && s.fail(sh)) return {exit_code: 1, stdout: '', stderr: 'boom'};
    const set = /^vconftool set -f -t string db\/sdk\/develop\/ip '([^']*)'$/.exec(sh);
    if (set) { if (s.keep) s.ip = set[1]; return {exit_code: 0, stdout: ''}; }
    if (sh.includes('/usr/sbin/reboot')) { s.rebooted++; return {exit_code: 0, stdout: ''}; }
    if (sh.includes('vconftool get')) return {exit_code: 0, stdout: 'db/sdk/develop/mode, value = ' + s.mode + ' (Int32)\ndb/sdk/develop/ip, value = ' + s.ip + ' (String)\n'};
    return {exit_code: 127, stdout: '', stderr: 'unexpected: ' + sh};
  };
  return {s, scripts, execute};
}
(async () => {
  for (const ok of ['127.0.0.1', '192.168.1.20', '0.0.0.0', '255.255.255.255']) assert.ok(validIp(ok), ok);
  for (const bad of ['', '1.2.3', '1.2.3.4.5', '256.1.1.1', '01.2.3.4', "1.2.3.4'; reboot", ' 1.2.3.4', 'host.local', 12345, null])
    assert.ok(!validIp(bad), String(bad));

  let t = tv(), d = new DevMode(t.execute);
  let r = await d.read();
  assert.deepEqual([r.enabled, r.hostIp, r.selfHosted], [true, '127.0.0.1', true]);

  // A new address is written, read back, and the restart is scheduled in the background.
  r = await d.change('192.168.1.20', true);
  assert.deepEqual([r.changed, r.previous, r.hostIp, r.selfHosted, r.rebooting], [true, '127.0.0.1', '192.168.1.20', false, true]);
  assert.equal(t.s.rebooted, 1);
  assert.ok(t.scripts.some(x => /^\( sleep 3; \/usr\/sbin\/reboot \) .*&$/.test(x)), 'restart runs detached after a delay');

  // Without the restart nothing is restarted; the same address is not written again.
  t = tv({ip: '192.168.1.20'}); d = new DevMode(t.execute);
  r = await d.change('192.168.1.20', false);
  assert.deepEqual([r.changed, r.rebooting, t.s.rebooted], [false, false, 0]);
  assert.ok(!t.scripts.some(x => x.includes('vconftool set')), 'unchanged value is not written');
  r = await d.change('127.0.0.1', false);
  assert.deepEqual([r.changed, r.selfHosted, t.s.ip, t.s.rebooted], [true, true, '127.0.0.1', 0]);

  // Bad input never reaches the TV.
  t = tv(); d = new DevMode(t.execute);
  await assert.rejects(d.change("1.2.3.4'; reboot; '", true), /IPv4/);
  await assert.rejects(d.change('1.2.3.4', 'yes'), /restart choice/);
  assert.equal(t.scripts.length, 0);

  // Developer Mode off: nothing is written.
  t = tv({mode: 0}); d = new DevMode(t.execute);
  await assert.rejects(d.change('1.2.3.4', true), /Developer Mode is off/);
  assert.ok(!t.scripts.some(x => x.includes('vconftool set') || x.includes('reboot')));

  // A write the TV does not keep is reported, the old value is put back and no restart happens.
  t = tv({keep: false}); d = new DevMode(t.execute);
  await assert.rejects(d.change('10.0.0.5', true), /not confirmed · previous value restored/);
  assert.equal(t.s.rebooted, 0);

  // A failing restart command is an error, but the address stays written.
  t = tv({fail: sh => sh.includes('reboot')}); d = new DevMode(t.execute);
  await assert.rejects(d.change('10.0.0.5', true), /boom/);
  assert.equal(t.s.ip, '10.0.0.5');

  // Unreadable state.
  d = new DevMode(async () => ({exit_code: 0, stdout: 'nothing'}));
  await assert.rejects(d.read(), /unreadable/);

  // The dashboard offers it under TV settings.
  const html = require('../service/dashboard.js')({});
  const page = typeof html === 'string' ? html : String(html);
  assert.ok(page.includes('data-settings-mode="devmode"'), 'Developer Mode section in TV settings');
  assert.ok(page.includes("api('/dev-mode',{ip:c.ip,reboot:c.reboot})"), 'dashboard posts the IP and the restart choice');
  assert.ok(page.includes("return /^\\d{1,3}(\\.\\d{1,3}){3}$/.test(v)"), "the IP check survives the template literal");
  console.log('dev-mode: ok');
})().catch(e => { console.error(e); process.exit(1); });
