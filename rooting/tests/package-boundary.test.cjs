'use strict';
const assert=require('assert');
const standalone=require('../../app/build.cjs').collectFiles();
const full=require('../build.cjs').collectIntegration();
const names=full.map(x=>decodeURIComponent(x.uri));
assert.equal(new Set(names).size,names.length,'no duplicate ZIP paths');
assert(names.includes('payload/SamsungTvRootAgent.dll'));
assert(names.includes('payload/SamsungTvRemoteInputAgent.dll'));
assert(names.includes('service/sdb.js'));
assert.equal(names.filter(x=>x==='service/platform.js').length,1);
assert(!names.some(x=>/cert|\.p12$|node_modules|on-boot-probe|tools\//.test(x)));
const appPlatform=standalone.find(x=>decodeURIComponent(x.uri)==='service/platform.js').data.toString();
const tvPlatform=full.find(x=>decodeURIComponent(x.uri)==='service/platform.js').data.toString();
assert(appPlatform.includes('app-only'));
assert(tvPlatform.includes('tv-integration'));
assert(!standalone.some(x=>decodeURIComponent(x.uri).startsWith('payload/')));
console.log('PASS integration package boundary: one TV adapter, active payloads, no certificates or historical tools; app-only remains isolated');

assert.ok(require('../build.cjs').collectIntegration().some(f => decodeURIComponent(f.uri) === 'notices/LICENSE-samsung-tv-root.txt' && f.data.equals(require('fs').readFileSync(require('path').join(__dirname, '../tools/samsung-tv-root-master/LICENSE')))), 'integration retains the complete upstream notice');
