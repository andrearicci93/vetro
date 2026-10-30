'use strict';
// The release tool builds a bundle that a TV accepts, and keeps the Samsung package files out of it.
const assert = require('assert').strict;
const crypto = require('crypto');
const updater = require('../../app/service/updater.js');
const { buildBundle } = require('../release.cjs');

const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const privatePem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' });
const built = buildBundle(privatePem);
const parsed = updater.verifyBundle(built.raw, publicPem);
const names = Object.keys(parsed.manifest.files);

assert.equal(parsed.manifest.version, require('../../app/package.json').version);
assert.ok(names.includes('service/platform.js') && names.includes('service/root-agent.js'), 'the root adapter ships with updates');
assert.ok(names.includes('service/updater.js') && names.includes('payload/SamsungTvRootAgent.dll'));
assert.ok(!names.includes('config.xml') && names.every(n => !/signature|\.p12|\.cer/.test(n)), 'nothing of the Samsung package or certificates');
assert.throws(() => updater.verifyBundle(built.raw, crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' })), /not signed/);
console.log('PASS release tool: signed bundle verifies, root adapter included, config.xml and certificates excluded');
