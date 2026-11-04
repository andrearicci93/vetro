'use strict';
const assert = require('assert').strict;
const {Restore, parseFlags, parseHome, ERASE_SCRIPT} = require('../service/restore.js');
const quick = require('../service/quick-settings.js');
const ledgerMod = require('../service/disabled-ledger.js');

const alexa = quick.find('alexa').ids;
const decode = cmd => { const m = /^echo (\S+) \| base64 -d \| sh$/.exec(cmd); return m ? Buffer.from(m[1], 'base64').toString() : cmd; };

// A TV that Vetro has changed everywhere, as plain state. Scripts are interpreted by their effect, never run.
function tv(start) {
  const s = Object.assign({
    launcher: true, plugins: [{id: 'launcher', bundled: true, enabled: true}, {id: 'hello', name: 'Hello', bundled: false, enabled: true}],
    remote: true, mqtt: true,
    apps: alexa.map(id => ({appId: id, packageId: id, disabled: true, system: true}))
      .concat([
        {appId: 'org.tizen.ep-hotel-factory', packageId: 'org.tizen.ep-hotel-factory', disabled: true, system: true},   // firmware ships it disabled
        {appId: 'org.tizen.factory', packageId: 'org.tizen.factory', disabled: true, system: true},
        {appId: 'com.samsung.tv.acr', packageId: 'com.samsung.tv.acr', disabled: true, system: true},                    // verified set
        {appId: 'org.tizen.ledgered', packageId: 'org.tizen.ledgered', disabled: true, system: true},                    // in the ledger
        {appId: 'com.example.userapp', packageId: 'com.example.userapp', disabled: true, system: false},                 // user-installed
        {appId: 'com.samsung.tv.coba.adagent', packageId: 'com.samsung.tv.coba.adagent', disabled: true, system: true}   // protected
      ]),
    ledger: ['org.tizen.ledgered'],
    wins: {firmware: 'on', multiscreen: 'on', ambient: 'on', telemetry: 'on'}, hbbtvOff: true, hbbtvCanRestore: true,
    dnsOn: true, home: {backups: 2, same: 0}, flags: [{appId: 'a.b', backup: 'true|false', current: 'false|false'}, {appId: 'c.d', backup: 'true|true', current: 'true|true'}],
    failStep: null, calls: [], order: [], erased: 0, authRemoved: 0
  }, start);
  const fail = id => { if (s.failStep === id) throw new Error('boom ' + id); };
  const deps = {
    invalidate() {},
    inventory() { return Promise.resolve({apps: s.apps.map(a => Object.assign({}, a)), registryError: null}); },
    execute(cmd) {
      const sh = decode(cmd); s.calls.push(sh);
      if (/echo "HO\|/.test(sh)) return Promise.resolve({exit_code: 0, stdout: 'HO|' + s.home.backups + '|' + s.home.same + '\n'});
      if (/startup-backups\/\*/.test(sh)) return Promise.resolve({exit_code: 0, stdout: s.flags.map(f => 'SF|' + f.appId + '|' + f.backup + '|' + f.current).join('\n')});
      if (/^cat \/home\/owner\/share\/vetro\/disabled-by-vetro/.test(sh)) return Promise.resolve({exit_code: 0, stdout: s.ledger.join('\n')});
      if (/grep -v -x -F/.test(sh)) { const ids = [...sh.matchAll(/-e "([^"]+)"/g)].map(m => m[1]); s.ledger = s.ledger.filter(x => ids.indexOf(x) < 0); return Promise.resolve({exit_code: 0, stdout: ''}); }
      if (/UPDATE package_app_info SET app_onboot/.test(sh) && /startup-backups/.test(sh)) {
        fail('startup-flags'); s.flags = [];
        return Promise.resolve({exit_code: 0, stdout: [...sh.matchAll(/echo "(\S+) (?:\$r|0)"/g)].map(m => m[1] + ' 0').join('\n')});
      }
      if (/quick-flags/.test(sh)) { const ids = /for id in (.*?);\s*do/.exec(sh)[1].split(' '); return Promise.resolve({exit_code: 0, stdout: ids.map(id => id + ' none').join('\n')}); }
      if (sh === 'app_launcher -S') return Promise.resolve({exit_code: 0, stdout: ''});
      const m = /for id in (.*?); do pkgcmd (-D|-A)/.exec(sh);
      if (m) {
        const ids = m[1].split(' ');
        fail('pkgcmd'); s.order.push('pkgcmd-A:' + ids.join(','));
        ids.forEach(id => { const a = s.apps.find(x => x.appId === id); if (a) a.disabled = m[2] === '-D'; });
        return Promise.resolve({exit_code: 0, stdout: ids.map(id => id + ' 0').join('\n')});
      }
      if (sh === ERASE_SCRIPT) { s.erased++; return Promise.resolve({exit_code: 0, stdout: 'left=0\n'}); }
      return Promise.resolve({exit_code: 0, stdout: ''});
    },
    dock: {readState: () => ({enabled: s.launcher}), disable() { s.order.push('launcher'); fail('launcher'); s.launcher = false; return Promise.resolve({}); }},
    plugins: {list: () => s.plugins, setEnabled(id, on) { s.order.push('plugin:' + id); s.plugins.find(p => p.id === id).enabled = on; }},
    input: {active: () => s.remote, off() { s.order.push('remote'); s.remote = false; }},
    mqtt: {enabled: () => s.mqtt, off() { s.order.push('mqtt'); s.mqtt = false; }},
    wins: {
      load: () => ({hbbtv: s.hbbtvOff}),
      read: () => Promise.resolve({wins: {firmware: {status: s.wins.firmware}, multiscreen: {status: s.wins.multiscreen}, ambient: {status: s.wins.ambient}, telemetry: {status: s.wins.telemetry}}}),
      apply(id, on) { s.order.push('win:' + id); fail('win:' + id); s.wins[id] = 'off'; return Promise.resolve({changed: true}); },
      remember() {}
    },
    hbbtv: {
      read: () => Promise.resolve({value: s.hbbtvOff ? 19 : 20, off: s.hbbtvOff, valueOff: s.hbbtvOff, flag: s.hbbtvOff, canRestore: s.hbbtvCanRestore}),
      change(off, expected) { assert.equal(off, false); s.order.push('hbbtv'); s.hbbtvOff = false; return Promise.resolve({}); }
    },
    dns: {
      status: () => Promise.resolve({enabled: s.dnsOn, applied: s.dnsOn, domains: ['a.example.com']}),
      apply(enabled, domains) { assert.equal(enabled, false); s.order.push('dns'); s.dnsOn = false; return Promise.resolve({enabled: false, applied: false, domains}); }
    },
    homeOrder: {restore() { s.order.push('home'); fail('home'); s.home.same = s.home.backups; return Promise.resolve({}); }},
    removeAuth() { s.authRemoved++; }
  };
  return {s, deps};
}

(async () => {
  // Parsing
  assert.deepEqual(parseHome('noise\nHO|2|1\n'), {backups: 2, same: 1});
  assert.equal(parseHome('nothing'), null);
  assert.deepEqual(parseFlags('SF|a.b|true|false|false|false\nSF|c.d|true|true|\nSF|bad id|true|true|true|true\nSF|e.f|maybe|true|true|true'),
    [{appId: 'a.b', backup: 'true|false', current: 'false|false'}, {appId: 'c.d', backup: 'true|true', current: null}]);
  assert.deepEqual(ledgerMod.parse('a.b\nbad id\na.b\nc.d\n'), ['a.b', 'c.d']);
  assert.throws(() => ledgerMod.addCommand('x; rm -rf /'), /Invalid app ID/);

  // The plan on a changed TV: read-only, and it names every step
  let t = tv(), r = new Restore(t.deps), plan = await r.publicPlan();
  const state = id => plan.items.find(i => i.id === id).state;
  ['launcher', 'plugins', 'remote', 'mqtt', 'groups', 'components', 'win-telemetry', 'win-ambient', 'win-multiscreen', 'win-firmware', 'hbbtv', 'dns', 'home-order', 'startup-flags']
    .forEach(id => assert.equal(state(id), 'changed', id));
  assert.equal(plan.pending, 14);
  assert.equal(plan.items.find(i => i.id === 'groups').count, alexa.length);
  assert.equal(plan.items.find(i => i.id === 'components').count, 3, 'verified + ledger + user app, nothing else');
  assert.equal(plan.items.find(i => i.id === 'startup-flags').count, 1, 'a backup equal to the current value is not a change');
  assert.equal(plan.items.find(i => i.id === 'plugins').count, 1, 'bundled plugins are not touched');
  assert.ok(plan.notes.length >= 2 && plan.notes.some(n => /uninstalled|removed from the Task manager/i.test(n)));
  assert.equal(t.s.order.length, 0, 'planning changes nothing');
  assert.ok(!t.s.calls.some(c => /pkgcmd -A|UPDATE|rm -rf/.test(c)));

  // Erasing is refused until everything is restored
  await assert.rejects(r.eraseData(), e => e.statusCode === 409 && /Restore the TV first/.test(e.message));
  assert.equal(t.s.erased, 0);

  // Run: fixed order, every step done, only provable components switched on
  let res = await r.run();
  assert.equal(res.complete, true, JSON.stringify(res));
  assert.deepEqual(res.steps.map(s => s.status), Array(14).fill('done'));
  assert.deepEqual(t.s.order.filter(x => !/^pkgcmd/.test(x)), ['launcher', 'plugin:hello', 'remote', 'mqtt', 'win:telemetry', 'win:ambient', 'win:multiscreen', 'win:firmware', 'hbbtv', 'dns', 'home']);
  const enabled = [].concat(...t.s.order.filter(x => /^pkgcmd-A:/.test(x)).map(x => x.slice(9).split(',')));
  assert.deepEqual(enabled.sort(), alexa.concat(['com.samsung.tv.acr', 'org.tizen.ledgered', 'com.example.userapp']).sort());
  ['org.tizen.ep-hotel-factory', 'org.tizen.factory', 'com.samsung.tv.coba.adagent'].forEach(id => {
    assert.ok(!enabled.includes(id), id + ' must stay as the firmware had it');
    assert.equal(t.s.apps.find(a => a.appId === id).disabled, true);
  });
  assert.deepEqual(t.s.ledger, [], 'ledger entries are removed once switched on');
  assert.deepEqual(res.remaining, []);

  // Idempotent: a second run has nothing to do
  res = await r.run();
  assert.ok(res.steps.every(s => s.status === 'skipped'), JSON.stringify(res.steps));

  // Now the data can go; the session file is the caller's last step
  const erased = await r.eraseData();
  assert.equal(erased.ok, true); assert.equal(t.s.erased, 1); assert.equal(t.s.authRemoved, 0);
  erased.finish(); assert.equal(t.s.authRemoved, 1);
  assert.ok(/vetro-auth\.json/.test(ERASE_SCRIPT) && /! -name 'vetro-auth.json'/.test(ERASE_SCRIPT), 'the session file is spared by the script');

  // A failing step is reported and the rest still runs; erasing then stays blocked
  t = tv({failStep: 'launcher'}); r = new Restore(t.deps);
  res = await r.run();
  assert.equal(res.complete, false);
  assert.equal(res.steps[0].status, 'failed'); assert.match(res.steps[0].message, /boom launcher/);
  assert.equal(res.steps.filter(s => s.status === 'done').length, 13, 'everything else was done');
  assert.deepEqual(res.remaining, ['launcher']);
  await assert.rejects(r.eraseData(), /Launcher/);

  // A failing component script does not stop the Quick settings groups, wins, DNS or Home
  t = tv({failStep: 'startup-flags'}); r = new Restore(t.deps);
  res = await r.run();
  assert.equal(res.steps[res.steps.length - 1].status, 'failed');
  assert.ok(res.steps.slice(0, -1).every(s => s.status === 'done'));

  // HbbTV whose previous value was never saved is handed back to the user, not guessed
  t = tv({hbbtvCanRestore: false}); r = new Restore(t.deps);
  plan = await r.publicPlan();
  assert.equal(plan.items.find(i => i.id === 'hbbtv').state, 'manual');
  res = await r.run();
  assert.equal(res.steps.find(s => s.id === 'hbbtv').status, 'manual');
  assert.ok(!t.s.order.includes('hbbtv'), 'nothing is written for it');
  await r.eraseData();   // a manual item does not block removing the data

  // A TV that Vetro never touched has nothing to restore, and nothing is sent
  t = tv({launcher: false, plugins: [{id: 'launcher', bundled: true, enabled: true}], remote: false, mqtt: false,
    apps: [{appId: 'org.tizen.factory', packageId: 'org.tizen.factory', disabled: true, system: true}].concat(alexa.map(id => ({appId: id, packageId: id, disabled: false, system: true}))),
    ledger: [], wins: {firmware: 'off', multiscreen: 'off', ambient: 'off', telemetry: 'off'}, hbbtvOff: false, dnsOn: false, home: {backups: 0, same: 0}, flags: []});
  r = new Restore(t.deps); plan = await r.publicPlan();
  assert.equal(plan.pending, 0, JSON.stringify(plan.items.filter(i => i.state !== 'clean')));
  res = await r.run();
  assert.equal(res.complete, true); assert.ok(res.steps.every(s => s.status === 'skipped'));
  assert.deepEqual(t.s.order, []);

  // A source that cannot be read is reported as unknown, never as clean
  t = tv(); t.deps.hbbtv.read = () => Promise.reject(new Error('TV unavailable')); r = new Restore(t.deps);
  plan = await r.publicPlan();
  assert.equal(plan.items.find(i => i.id === 'hbbtv').state, 'unknown');
  res = await r.run();
  assert.equal(res.steps.find(s => s.id === 'hbbtv').status, 'failed');

  await assert.rejects(r.eraseData(), e => e.statusCode === 409 && /HbbTV/.test(e.message));
  assert.equal(t.s.erased, 0, 'unknown state must preserve restore backups');
  t = tv(); r = new Restore(t.deps); await r.run();
  t.deps.hbbtv.read = () => Promise.reject(Error('offline after restore'));
  res = await r.run(); assert.equal(res.complete, false);
  assert.ok(res.remaining.includes('hbbtv'), 'unknown readback prevents completion');
  t = tv(); r = new Restore(t.deps); await r.run();
  t.deps.execute = () => Promise.reject(Error('ledger unavailable'));
  plan = await r.publicPlan();
  assert.equal(plan.items.find(i => i.id === 'components').state, 'unknown');
  t = tv(); r = new Restore(t.deps); await r.run();
  t.deps.wins.read = async () => ({wins:{firmware:{status:'unknown'},multiscreen:{status:'off'},ambient:{status:'off'},telemetry:{status:'off'}}});
  plan = await r.publicPlan();assert.equal(plan.items.find(i => i.id === 'win-firmware').state, 'unknown');
  await assert.rejects(r.eraseData(), /Automatic firmware updates/);
  t = tv(); r = new Restore(t.deps); await r.run();
  t.deps.dock.readState = () => ({enabled:false,autorunWas:1});
  plan = await r.publicPlan();assert.equal(plan.items.find(i => i.id === 'launcher').state, 'changed');
  t = tv();let sdbOn=true;
  t.deps.sdb={status:()=>({enabled:sdbOn,active:sdbOn}),off:async()=>{sdbOn=false;return {enabled:false,active:false};}};
  r = new Restore(t.deps);plan=await r.publicPlan();assert.equal(plan.items.find(i=>i.id==='sdb').state,'changed');
  await assert.rejects(r.eraseData(),/SDB developer access/);res=await r.run();assert.equal(sdbOn,false);assert.equal(res.complete,true);
  assert.equal(res.steps.find(i=>i.id==='sdb').status,'done');
  console.log('restore: ok');
})().catch(e => { console.error(e); process.exit(1); });
