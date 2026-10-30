'use strict';
const assert = require('assert').strict;
const screen = require('../service/screen-status.js');

assert.equal(screen.address({lo: [{family: 'IPv4', internal: true, address: '127.0.0.1'}],
  wlan0: [{family: 'IPv6', internal: false, address: 'fe80::1'}, {family: 'IPv4', internal: false, address: '192.168.1.42'}]}), '192.168.1.42');
assert.equal(screen.address({lo: [{family: 'IPv4', internal: true, address: '127.0.0.1'}]}), null, 'loopback is not an address to open');
assert.equal(screen.address(undefined), null);
assert.equal(screen.availableMb('MemTotal:  1900000 kB\nMemAvailable:  626688 kB\n'), 612);
assert.equal(screen.availableMb('MemTotal: 1 kB'), null);
assert.equal(screen.availableMb(null), null);

const out = screen.build({version: '0.3.5', port: 8099, platform: {mode: 'tv-integration', agent: {connected: true}},
  input: {policy: {connected: true}, preference: {enabled: true}}, launcher: {installed: true, enabled: true, running: false, failures: 4, error: true},
  meminfo: 'MemAvailable: 153600 kB\n', interfaces: {}});
assert.deepEqual(out, {version: '0.3.5', port: 8099, address: null, root: {mode: 'tv-integration', connected: true},
  input: {enabled: true, connected: true}, launcher: {installed: true, enabled: true, running: false, failures: 4, hasError: true}, memory: {availableMb: 150}});

const bare = screen.build({version: '0.3.5', port: 8099, platform: {mode: 'app-only', agent: {connected: false}}, input: {}, launcher: {}, meminfo: null, interfaces: {}});
assert.equal(bare.root.connected, false);
assert.equal(bare.launcher.running, null, 'a launcher that was not checked is unknown, not stopped');
assert.equal(bare.memory.availableMb, null);
assert.ok(!('pin' in bare), 'no PIN until 0.4.0 adds one');
assert.ok(Object.keys(out.launcher).every(k => ['boolean', 'number'].includes(typeof out.launcher[k]) || out.launcher[k] === null), 'no error text or log leaves the service');
console.log('PASS TV screen status: address, memory, root, input and launcher facts, nothing else');
