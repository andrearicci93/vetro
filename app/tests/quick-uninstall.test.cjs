'use strict';
// Quick settings → Uninstall: a named list, offered only for what the TV has and allows to remove, and removed through the
// same action as Apps and processes, one package at a time.
const assert = require('assert');
const quick = require('../service/quick-uninstall.js');
const actions = require('../service/component-actions.js');
const debloat = require('../service/debloat.js');

const row = (appId, packageId, over) => Object.assign({appId, packageId, show: true, system: false, removable: true, protected: false,
  disabled: false, size: 10 * 1048576}, over);
const ids = rows => quick.candidates(rows).map(i => i.id);

(async () => {
  // Nothing on the TV, or nothing known about it: nothing is offered.
  assert.deepEqual(quick.candidates([]), []);
  assert.deepEqual(quick.candidates(null), []);
  assert.deepEqual(ids([row('some.other.app', 'some.other.app')]), [], 'an app that is not on the list is never offered, removable or not');

  // The TV's registry marks its own store and account apps removable: they are not on the list, so they are never offered.
  assert.deepEqual(ids([row('com.samsung.tv.store', 'com.samsung.tv.store'), row('com.samsung.tv.CSAccount', 'com.samsung.tv.CSAccount'),
    row('com.samsung.tv.quickpanel', 'com.samsung.tv.quickpanel'), row('com.samsung.tv.csfs', 'com.samsung.tv.csfs')]), []);
  // Nothing on the list is something Vetro protects, and YouTube and the TV Plus services are left to Disable.
  quick.LIST.forEach(e => (e.apps || []).forEach(id => assert.ok(!debloat.isProtected(id), id)));
  const named = quick.LIST.reduce((all, e) => all.concat(e.apps || []), []);
  ['9Ur5IzDKqV.TizenYouTube', 'com.samsung.tv.cobalt-yt', 'com.samsung.tv.slive-daemon', 'org.tizen.bms-service', 'org.tizen.tv-viewer', 'vetrotvapp.app'].forEach(id => assert.ok(!named.includes(id), id + ' is not offered'));

  // An entry shows only when the TV has it and allows removing it.
  const netflix = row('org.tizen.netflix-app', 'org.tizen.netflix-app', {size: 83 * 1048576});
  let items = quick.candidates([netflix]);
  assert.deepEqual(items.map(i => i.id), ['netflix']);
  assert.deepEqual(items[0], {id: 'netflix', label: 'Netflix', appId: 'org.tizen.netflix-app', size: 83 * 1048576, disabled: false,
    packages: [{packageId: 'org.tizen.netflix-app', appId: 'org.tizen.netflix-app', size: 83 * 1048576, disabled: false}]});
  assert.deepEqual(ids([Object.assign({}, netflix, {system: true})]), [], 'part of the firmware on this TV: not offered');
  assert.deepEqual(ids([Object.assign({}, netflix, {removable: false})]), [], 'the TV does not mark it removable: not offered');
  assert.deepEqual(ids([Object.assign({}, netflix, {removable: undefined, system: undefined})]), [], 'no registry facts (no root): not offered');
  assert.deepEqual(ids([Object.assign({}, netflix, {protected: true})]), [], 'protected: not offered');
  assert.equal(quick.candidates([Object.assign({}, netflix, {disabled: true})])[0].disabled, true, 'a disabled app is still installed, and says so');

  // A package with several apps is one package; the entry's icon is the app the menu shows.
  const prime = [row('org.tizen.primevideo', 'org.tizen.primevideo', {size: 35 * 1048576}), row('org.tizen.primevideo-dummy', 'org.tizen.primevideo', {size: 35 * 1048576}),
    row('org.tizen.primevideo_companionapp', 'org.tizen.primevideo', {show: false, size: 35 * 1048576})];
  items = quick.candidates(prime);
  assert.equal(items[0].packages.length, 1); assert.equal(items[0].appId, 'org.tizen.primevideo'); assert.equal(items[0].size, 35 * 1048576, 'the package is counted once');
  // A protected sibling in the same package keeps the package out (the check of Apps and processes).
  assert.deepEqual(ids(prime.concat(row('vetrotvapp.x', 'org.tizen.primevideo', {protected: true}))), []);

  // e-Manual: the package id changes with the model year, the app id always ends in ".emanual"; the system stub is not it.
  assert.deepEqual(ids([row('25emanual2.emanual', '25emanual2', {size: 70 * 1048576})]), ['emanual']);
  assert.deepEqual(ids([row('LzU5yAFXeg.emanual', 'LzU5yAFXeg')]), ['emanual']);
  assert.deepEqual(ids([row('org.tizen.emanual-app', 'org.tizen.emanual-app', {system: true, removable: false})]), []);
  assert.deepEqual(ids([row('x.emanual', 'x'), row('evil.emanual.other', 'evil')]), [], 'only the exact shape of the id');

  // Samsung TV Plus: its three packages, each only if this TV has it; the note says what stays.
  items = quick.candidates([row('com.samsung.tv.tvplus', 'com.samsung.tv.tvplus', {show: false}), row('w2VwCK465D.OTApp', 'w2VwCK465D'),
    row('com.samsung.tv.slive-daemon', 'com.samsung.tv.slive-daemon', {show: false})]);
  assert.deepEqual(items[0].packages.map(p => p.packageId), ['com.samsung.tv.tvplus', 'w2VwCK465D']);
  assert.match(items[0].note, /services stay/);
  assert.equal(items[0].size, 20 * 1048576);

  // The order is the list's, whatever the registry's.
  assert.deepEqual(ids([row('com.samsung.tv.gallery', 'com.samsung.tv.gallery'), netflix, row('25emanual1.emanual', '25emanual1')]), ['emanual', 'netflix', 'gallery']);

  // ---- uninstalling ----
  function tv(rows, over) {
    over = over || {};
    const t = {rows: rows.slice(), calls: [], reads: 0};
    t.deps = {
      inventory: fresh => { t.reads++; return Promise.resolve(over.registryError ? {apps: [], registryError: 'x'} : {apps: t.rows}); },
      componentAction: p => {
        t.calls.push(p.action + ' ' + p.appId);
        // the real action checks the request against the app list again
        try { actions.validate(p, t.rows); } catch (e) { e.statusCode = 400; return Promise.reject(e); }
        const target = t.rows.find(r => r.appId === p.appId);
        if (over.refuse === target.packageId) return Promise.resolve({ok: false, verified: false, error: 'Requested state not confirmed; the component may have restarted.', apps: t.rows});
        if (over.throws === target.packageId) return Promise.reject(new Error('root agent not connected'));
        t.rows = t.rows.filter(r => r.packageId !== target.packageId);
        return Promise.resolve({ok: true, verified: true, apps: t.rows});
      }
    };
    return t;
  }
  await assert.rejects(quick.uninstall('nope', tv([netflix]).deps), e => e.statusCode === 400 && /Unknown app/.test(e.message));
  await assert.rejects(quick.uninstall(undefined, tv([netflix]).deps), e => e.statusCode === 400);
  let t = tv([netflix], {registryError: true});
  await assert.rejects(quick.uninstall('netflix', t.deps), e => e.statusCode === 503 && /nothing was removed/.test(e.message));
  assert.deepEqual(t.calls, [], 'no app list, no command');
  t = tv([row('org.tizen.browser', 'org.tizen.browser')]);
  await assert.rejects(quick.uninstall('netflix', t.deps), e => e.statusCode === 409 && /Netflix is not on this TV/.test(e.message));
  assert.deepEqual(t.calls, []);
  t = tv([Object.assign({}, netflix, {system: true})]);
  await assert.rejects(quick.uninstall('netflix', t.deps), e => e.statusCode === 409);
  assert.deepEqual(t.calls, [], 'what the TV does not allow to remove is never tried');

  t = tv([netflix, row('org.tizen.browser', 'org.tizen.browser')]);
  let r = await quick.uninstall('netflix', t.deps);
  assert.deepEqual(t.calls, ['uninstall org.tizen.netflix-app']);
  assert.equal(t.reads, 1, 'the app list is read fresh before anything is removed');
  assert.deepEqual({ok: r.ok, removed: r.removed, error: r.error, left: r.items.map(i => i.id)}, {ok: true, removed: ['org.tizen.netflix-app'], error: null, left: ['browser']});

  // Several packages go one at a time; the first that is not confirmed gone stops the rest, and the answer says what went.
  const tvplus = [row('com.samsung.tv.tvplus', 'com.samsung.tv.tvplus', {show: false}), row('com.samsung.tv.tvPlusDeeplinker', 'com.samsung.tv.tvPlusDeeplinker', {show: false}), row('w2VwCK465D.OTApp', 'w2VwCK465D')];
  t = tv(tvplus);
  r = await quick.uninstall('tvplus', t.deps);
  assert.deepEqual(t.calls, ['uninstall com.samsung.tv.tvplus', 'uninstall com.samsung.tv.tvPlusDeeplinker', 'uninstall w2VwCK465D.OTApp']);
  assert.equal(r.ok, true); assert.deepEqual(r.items, []);
  t = tv(tvplus, {refuse: 'com.samsung.tv.tvPlusDeeplinker'});
  r = await quick.uninstall('tvplus', t.deps);
  assert.deepEqual(t.calls, ['uninstall com.samsung.tv.tvplus', 'uninstall com.samsung.tv.tvPlusDeeplinker'], 'the third package is not touched after a failure');
  assert.equal(r.ok, false); assert.deepEqual(r.removed, ['com.samsung.tv.tvplus']); assert.match(r.error, /not confirmed/);
  assert.deepEqual(r.items.map(i => i.id), ['tvplus'], 'what is left is still offered');
  assert.deepEqual(r.items[0].packages.map(p => p.packageId), ['com.samsung.tv.tvPlusDeeplinker', 'w2VwCK465D']);
  t = tv(tvplus, {throws: 'com.samsung.tv.tvplus'});
  r = await quick.uninstall('tvplus', t.deps);
  assert.equal(r.ok, false); assert.deepEqual(r.removed, []); assert.match(r.error, /root agent/);
  assert.equal(t.calls.length, 1);

  // The service: the routes exist, the action is the one of Apps and processes, and it runs under the same lock.
  const main = require('fs').readFileSync(require('path').join(__dirname, '..', 'service', 'main.js'), 'utf8');
  assert.match(main, /quickUninstall\.uninstall\(p&&p\.id,\{inventory:inventory,componentAction:componentAction\}\)/);
  assert.match(main, /function handleQuickUninstall[\s\S]{0,700}if\(debloatBusy\)return serveJson\(res,\{ok:false,error:'App change already in progress'\},409\);debloatBusy=true;/);
  assert.equal((main.match(/if \(url === '\/quick\/uninstall'\) return handleQuickUninstall\(req,res\);/g) || []).length, 2, 'GET and POST');
  console.log('PASS quick uninstall: a named list, only what the TV has and allows, one package at a time through the action of Apps and processes');
})().catch(e => { console.error(e); process.exitCode = 1; });
