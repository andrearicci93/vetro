'use strict';
const assert = require('assert').strict;
const path = require('path');
const load = require('./service-harness.cjs');
(async () => {
  const reads = [];
  const h = load(path.resolve(__dirname, '..'), {dependencies: {
    './app-registry.js': {load() { return new Promise(resolve => reads.push(resolve)); }}
  }}).context;
  const old = h.inventory(true);
  assert.equal(reads.length, 1);
  // Simulate a mutation after the old inventory started but before its reply.
  h.invalidateInventory();
  const first = h.inventory(true), second = h.inventory(true);
  reads[0]({apps: [{appId: 'a', disabled: false}]});
  await old;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads.length, 2, 'post-mutation readers share one fresh read');
  reads[1]({apps: [{appId: 'a', disabled: true}]});
  assert.equal((await first).apps[0].disabled, true);
  assert.equal((await second).apps[0].disabled, true);
  assert.equal((await h.inventory(false)).apps[0].disabled, true);
  console.log('PASS inventory concurrency: pre-mutation replies cannot satisfy post-mutation readback');
})().catch(e => { console.error(e); process.exitCode = 1; });
