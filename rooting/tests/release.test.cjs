'use strict';
// The release tool builds a bundle that a TV accepts, and keeps the Samsung package files out of it.
const assert = require('assert').strict;
const crypto = require('crypto');
const updater = require('../../app/service/updater.js');
const { buildBundle, checkReach } = require('../release.cjs');

const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const privatePem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' });
const built = buildBundle(privatePem);
const parsed = updater.verifyBundle(built.raw, publicPem);
const names = Object.keys(parsed.manifest.files);

assert.equal(parsed.manifest.version, require('../../app/package.json').version);
assert.ok(names.includes('service/platform.js') && names.includes('service/root-agent.js'), 'the root adapter ships with updates');
assert.ok(names.includes('service/updater.js') && names.includes('payload/SamsungTvRootAgent.dll'));
assert.ok(names.every(n => !/\.cs$/.test(n)), 'no C# source: the TV runs the built DLL');
// Each TV checks the bundle with the updater it runs (the published ones are in fixtures/): 0.7.0 accepts it, payload/net6
// included; 0.5.0 refuses it at the check, before it writes anything, because it takes no subfolder of payload/ (#226).
assert.ok(names.includes('payload/net6/SamsungTvRootAgent.dll'), 'payload/net6 ships with updates since 0.7.1');
const v070 = require('./fixtures/update-from-070/updater.js'), v050 = require('./fixtures/update-from-050/updater.js');
assert.equal(v070.verifyBundle(built.raw, publicPem).manifest.version, parsed.manifest.version, 'a TV on 0.7.0 accepts the bundle');
assert.throws(() => v050.verifyBundle(built.raw, publicPem), /^Error: Path not allowed in an update: payload\/net6\//, 'a TV on 0.5.0 refuses it at the check');
const reach = checkReach(built.raw, publicPem);
assert.match(reach[0], /^from 0\.7\.0: \d+ files differ/);
assert.match(reach[1], /^from 0\.5\.0: refused when checked/);
assert.ok(!names.includes('config.xml') && names.every(n => !/signature|\.p12|\.cer/.test(n)), 'nothing of the Samsung package or certificates');
assert.throws(() => updater.verifyBundle(built.raw, crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' })), /not signed/);
console.log('PASS release tool: signed bundle verifies, root adapter and payload/net6 included, config.xml and certificates excluded; ' + reach.join('; '));
