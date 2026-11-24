'use strict';
const assert = require('assert').strict;
const platform = require('../service/platform.js');

assert.equal(platform.backendForPlatformVersion('10'), 'vddebugmenu');
assert.equal(platform.backendForPlatformVersion('10.0.0'), 'vddebugmenu');
assert.equal(platform.backendForPlatformVersion('9.0'), 'sdb-archive');
assert.equal(platform.backendForPlatformVersion('6.5'), 'sdb-archive');
assert.equal(platform.backendForPlatformVersion('Tizen10/TV'), null);
assert.equal(platform.backendForPlatformVersion(''), null);

const release = 'Tizen10/TV 10.0.0 (arm)\nVERSION = 10.0.0\nCODENAME = TTEN\nBUILD_ID=T-PTMFDEUC-0100-REL-202609171320\n';
assert.equal(platform.parseReleasePlatformVersion(release), '10.0.0');
assert.equal(platform.backendForPlatformVersion(platform.parseReleasePlatformVersion(release)), 'vddebugmenu');
assert.equal(platform.parseReleasePlatformVersion('Tizen 9.0\nVERSION = 9.0.0\n'), '9.0.0');
assert.equal(platform.payloadRuntimeForPlatform('10.0.0'), '6.0');
assert.equal(platform.payloadRuntimeForPlatform('10'), '6.0');
assert.equal(platform.payloadRuntimeForPlatform('9.0'), '6.0');
assert.equal(platform.payloadRuntimeForPlatform('6.5'), '3.1');
assert.equal(platform.payloadRuntimeForPlatform('5.5'), '3.1');
assert.equal(platform.payloadRuntimeForPlatform(''), null);
assert.equal(platform.payloadRuntimeForPlatform('Tizen10/TV'), null);

console.log('PASS backend selection: Tizen 10 vddebugmenu, older versions legacy, payload net6 from Tizen 9');
