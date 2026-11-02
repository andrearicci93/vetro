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
assert.ok(!('pin' in bare), 'the sign-in code is not part of /screen: the screen reads /auth/pending itself');
assert.ok(Object.keys(out.launcher).every(k => ['boolean', 'number'].includes(typeof out.launcher[k]) || out.launcher[k] === null), 'no error text or log leaves the service');
// Why root is not connected (#99, #91, #75)
const why = p => screen.rootReason(Object.assign({mode: 'tv-integration', agent: {connected: false}}, p));
assert.equal(screen.rootReason({mode: 'tv-integration', agent: {connected: true}}), null, 'connected: nothing to explain');
assert.equal(screen.rootReason({mode: 'app-only', agent: {connected: false}}), null, 'the app-only package has its own message');
assert.deepEqual(why({unsupported: true, prepareError: 'root agent needs Node 10.12+ (this runtime has v4.4.3)'}), {reason: 'unsupported', code: null});
assert.deepEqual(why({prepareError: 'EACCES'}), {reason: 'prepare', code: null});
assert.deepEqual(why({}), {reason: 'starting', code: null}, 'no attempt yet');
assert.deepEqual(why({attempts: [{phase: 'launch'}]}), {reason: 'starting', code: null}, 'one launch in flight');
assert.deepEqual(why({attempts: [{phase: 'launch', connect: 'ok'}]}), {reason: 'starting', code: null}, 'one launch, the agent may still call back');
assert.deepEqual(why({attempts: [{phase: 'launch', connect: 'ok'}, {phase: 'launch', connect: 'ok'}]}), {reason: 'agent', code: null});
assert.deepEqual(why({attempts: [{phase: 'launch', connect: 'ok'}, {phase: 'launch', connect: 'fail:sdbClosed', err: 'closed before handshake'}]}), {reason: 'sdb', code: 'sdbClosed'});
assert.deepEqual(why({attempts: [{phase: 'launch', connect: 'fail:sdbRefused'}, {phase: 'agent-connected'}]}), {reason: 'sdb', code: 'sdbRefused'}, 'the last launch counts');
assert.deepEqual(why({attempts: [{phase: 'launch', connect: 'fail:<b>x</b>'}]}), {reason: 'starting', code: null}, 'a code of the wrong shape is not passed on');
const down = screen.build({version: '0.5.0', port: 8099, platform: {mode: 'tv-integration', agent: {connected: false}, attempts: [{phase: 'launch', connect: 'fail:sdbClosed', err: 'secret text'}]}, input: {}, launcher: {}, meminfo: null, interfaces: {}});
assert.deepEqual(down.root, {mode: 'tv-integration', connected: false, reason: 'sdb', code: 'sdbClosed'});
assert.ok(!JSON.stringify(down).includes('secret text'), 'no error text leaves the service');
console.log('PASS TV screen status: address, memory, root (and why it is not connected), input and launcher facts, nothing else');
