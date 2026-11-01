'use strict';
const assert = require('assert').strict;
const http = require('http');
const path = require('path');
const Sizes = require('../service/package-sizes.js').Sizes;

// A fake tizen.package whose totalSize getter counts reads, like Tizen's (each read is a blocking native call).
function fakeApi(list) {
  const api = {reads: [], fail: false, getPackagesInfo(ok, fail) {
    if (api.fail) return fail(new Error('no'));
    ok(list.map(p => ({id: p.id, get totalSize() {
      api.reads.push(p.id);
      if (p.throws) throw new Error('x');
      return p.size;
    }})));
  }};
  return api;
}
function sizes() {
  const queue = [];
  const store = new Sizes(fn => queue.push(fn));
  store.queue = queue;
  store.drain = () => { while (queue.length) queue.shift()(); };
  return store;
}

(async function () {
  // One read per tick; -1 (Tizen could not measure) and a throwing getter are unknown sizes.
  const store = sizes();
  const api = fakeApi([{id: 'a', size: 100}, {id: 'b', size: -1}, {id: 'c', throws: true}]);
  store.measure(api);
  assert.deepEqual(api.reads, ['a'], 'the first read runs at once, the next waits for a tick');
  assert.equal(store.sizeOf('a'), null, 'sizes are published when the pass ends');
  store.drain();
  assert.deepEqual(api.reads, ['a', 'b', 'c']);
  assert.equal(store.sizeOf('a'), 100);
  assert.equal(store.sizeOf('b'), null);
  assert.equal(store.sizeOf('c'), null);
  assert.equal(store.sizeOf('constructor'), null);

  // Every pass measures everything again: grown sizes and failed reads get a new value, removed packages drop out.
  const later = fakeApi([{id: 'a', size: 150}, {id: 'b', size: 50}]);
  store.measure(later);
  store.drain();
  assert.deepEqual(later.reads, ['a', 'b']);
  assert.equal(store.sizeOf('a'), 150);
  assert.equal(store.sizeOf('b'), 50);
  assert.equal(store.sizeOf('c'), null);

  // A call during a pass runs one more pass after it; a failing list ends the pass and keeps the sizes.
  const busy = sizes();
  const twice = fakeApi([{id: 'a', size: 1}]);
  busy.measure(twice);
  busy.measure(twice);
  busy.measure(twice);
  busy.drain();
  assert.deepEqual(twice.reads, ['a', 'a'], 'calls during a pass collapse into one more pass');
  const broken = fakeApi([]);
  broken.fail = true;
  busy.measure(broken);
  assert.equal(busy.running, false);
  assert.equal(busy.sizeOf('a'), 1);

  // The service: measures at start and on package events; the app list carries the sizes.
  let listener = null;
  let measured = 0;
  const fake = {Sizes: function () {
    this.sizeOf = id => id === 'netflix' ? 1234 : null;
    this.measure = () => { measured++; };
  }};
  const tizen = {package: {setPackageInfoEventListener: l => { listener = l; }}};
  const service = require('./service-harness.cjs')(path.resolve(__dirname, '..'), {
    dependencies: {'./package-sizes.js': fake},
    globals: {tizen}
  });
  assert.equal(measured, 1, 'a pass starts with the service');
  assert.deepEqual(Object.keys(listener).sort(), ['oninstalled', 'onuninstalled', 'onupdated']);
  listener.oninstalled();
  assert.equal(measured, 2);
  const server = http.createServer(service.router);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const call = (method, endpoint, data) => new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : '';
    const req = http.request({host: '127.0.0.1', port: server.address().port, method, path: endpoint,
      headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)}}, res => {
      let text = '';
      res.on('data', c => { text += c; });
      res.on('end', () => resolve(text));
    });
    req.on('error', reject);
    req.end(body);
  });
  try {
    await call('POST', '/probe', {apps: [{id: 'netflix.app', packageId: 'netflix'}, {id: 'other.app', packageId: 'other'}],
      packages: [{id: 'netflix', version: '1'}, {id: 'other', version: '1', totalSize: 55}]});
    const rows = JSON.parse(await call('GET', '/apps')).apps;
    assert.equal(rows.find(r => r.appId === 'netflix.app').size, 1234, 'the measured size reaches the app list');
    assert.equal(rows.find(r => r.appId === 'other.app').size, 55, 'a size from an older TV screen report still shows');
  } finally {
    server.close();
  }

  // The service without Tizen APIs starts and measures nothing.
  measured = 0;
  require('./service-harness.cjs')(path.resolve(__dirname, '..'), {dependencies: {'./package-sizes.js': fake}});
  assert.equal(measured, 0);
  console.log('PASS package sizes: one read per tick, every pass measures everything, measured by the service at start and on package events');
})().catch(e => { console.error(e); process.exitCode = 1; });
