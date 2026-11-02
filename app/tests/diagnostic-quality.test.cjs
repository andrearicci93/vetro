'use strict';
const assert = require('assert');
const report = require('../service/diagnostic-report');
const execError = require('../service/exec-error');
(async () => {
  const secret = 'PRIVATE_SENTINEL@example.com';
  const coded = (code, extra) => Object.assign(new Error(secret), {code}, extra);
  // A reader failure exports a code from a fixed list, never the error text.
  const d = await report.collect({
    startup: () => Promise.reject(execError.failed({timed_out: true}, secret)),
    monitor: () => Promise.reject(execError.failed({exit_code: 127}, secret)),
    privacy: () => Promise.reject(Object.assign(new Error(secret), {code: secret})),
    hbbtv: () => Promise.reject(coded('no-root-agent')),
    catalog: () => Promise.reject(Object.assign(new Error(secret), {exitCode: 99999})),
    dns: () => new Promise(() => {})
  }, 50);
  assert(!JSON.stringify(d).includes(secret));
  assert.deepStrictEqual(d.sections.startup, {status: 'unavailable', reason: 'command-timeout'});
  assert.deepStrictEqual(d.sections.monitor, {status: 'unavailable', reason: 'command-failed', exitCode: 127});
  assert.equal(d.sections.privacy.reason, 'error');
  assert.equal(d.sections.hbbtv.reason, 'no-root-agent');
  assert.deepStrictEqual(d.sections.catalog, {status: 'unavailable', reason: 'error'});
  assert.deepStrictEqual(d.sections.dns, {status: 'timeout', reason: 'report-deadline'});
  assert.equal(d.sections.mqtt.reason, 'no-reader');

  // Projections: kernel threads counted, idle networks and dead fields dropped, provenance labelled.
  const now = Math.floor(Date.now() / 1000);
  const full = await report.collect({
    device: () => ({model: 'M', firmware: 'F', receivedAt: now - 7200}),
    probe: () => ({probe: {}, receivedAt: now}),
    settings: () => ({items: [{id: 'backlight', value: 3, writable: true, access: 'verified'}, {id: 'blurReduction', value: 2, writable: true, access: 'firmware', probe: 'confirmed', readOnlyReason: 'secret text'}], api: {status: 'ok', methods: 223, raw: 'x'}}),
    catalog: () => ({items: [{id: 'anynet+(hdmicec)', group: null, runtimeAvailability: 'x', readable: true}, {id: 'http://x.test/a'}]}),
    monitor: () => ({processes: [{name: 'kworker/0:1', kernel: true, rssBytes: 0}, {name: 'tv-viewer', kernel: false, rssBytes: 5}], telemetry: {}}),
    network: () => ({services: [{type: 'wifi', state: 'idle', autoConnect: false}, {type: 'wifi', state: 'ready', autoConnect: true}]})
  }, 50);
  assert.equal(full.sections.device.data.source, 'widget-probe');
  assert.equal(full.sections.device.data.probeAgeMinutes, 120);
  assert.equal(full.sections.probe.data.probeAgeMinutes, 0);
  assert.equal(full.sections.settings.data.items[0].access, 'implemented');
  assert.deepEqual(full.sections.settings.data.items[1], {id: 'blurReduction', value: 2, writable: true, access: 'firmware', probe: 'confirmed', available: true});
  assert.deepEqual(full.sections.settings.data.api, {status: 'ok', methods: 223});
  assert.equal(full.sections.catalog.data.items[0].id, 'anynet+(hdmicec)');
  assert.equal(full.sections.catalog.data.items[1].id, null);
  assert(!('runtimeAvailability' in full.sections.catalog.data.items[0]));
  assert.equal(full.sections.monitor.data.kernelThreadCount, 1);
  assert.deepStrictEqual(full.sections.monitor.data.processes.map(p => p.name), ['tv-viewer']);
  assert.equal(full.sections.network.data.services.length, 1);
  assert.equal(full.sections.network.data.services[0].state, 'ready');
  assert('sourceDirty' in full);

  const root = report.projectors.platform({rooting: {backend: 'sdb-archive', phase: 'retrying',
    failure: {stage: 'sdb-handshake', code: 'sdbClosed', message: secret}, secret}});
  assert.deepStrictEqual(root.rooting, {backend: 'sdb-archive', phase: 'retrying', failure: {stage: 'sdb-handshake', code: 'sdbClosed'}});
  assert(!JSON.stringify(root).includes(secret));
  const poisoned = report.projectors.platform({rooting: {backend: secret, phase: secret, failure: {stage: secret, code: secret}}});
  assert.deepStrictEqual(poisoned.rooting, {backend: null, phase: null, failure: {stage: null, code: null}});
  assert.deepStrictEqual(report.projectors.platform({}).rooting, {backend: null, phase: null, failure: null});
  const olderInventory = report.projectors.inventory({dependenciesAvailable: false, apps: [{appId: 'old.app', dependencies: null, dependents: null}]});
  assert.equal(olderInventory.registryAvailable, true);
  assert.equal(olderInventory.dependenciesAvailable, false);
  assert.equal(olderInventory.apps[0].dependencies, null);

  // Two samples: the second is forced; a failing or late second sample falls back to the first.
  const calls = [];
  const ok = await report.twoSamples(force => { calls.push(force); return Promise.resolve({n: calls.length}); }, 5, 10000);
  assert.deepStrictEqual(calls, [false, true]);
  assert.equal(ok.n, 2);
  const failed = await report.twoSamples(force => force ? Promise.reject(new Error('x')) : Promise.resolve({n: 1}), 5, 10000);
  assert.equal(failed.n, 1);
  const late = await report.twoSamples(force => force ? new Promise(() => {}) : Promise.resolve({n: 1}), 5, 3010);
  assert.equal(late.n, 1);
  const noRoom = [];
  await report.twoSamples(force => { noRoom.push(force); return Promise.resolve({}); }, 5, 100);
  assert.deepStrictEqual(noRoom, [false]);
  console.log('PASS diagnostic quality: failure codes, provenance, noise filtering and second-sample fallback');
})().catch(e => { console.error(e); process.exit(1); });
