'use strict';
const assert = require('assert');
const blocklist = require('../service/blocklist');
const dns = require('../service/local-dns');
const apps = require('../service/apps');

const all = blocklist.all();
assert.deepStrictEqual(dns.validate(all), all, 'every candidate is a valid, unique hostname');
assert.equal(new Set(all).size, all.length);

// Exports never contain an essential name or a parent domain that external blockers apply to it.
const exported = apps.blocklist('domains').split('\n').filter(Boolean);
assert.deepStrictEqual(exported, all);
assert.deepStrictEqual(apps.blocklist('hosts').split('\n').filter(Boolean), all.map(h => '0.0.0.0 ' + h));
blocklist.ESSENTIAL.forEach(n => {
  exported.forEach(e => assert.ok(n.host !== e && !n.host.endsWith('.' + e), e + ' would also block ' + n.host));
  assert.ok(!all.includes(n.host));
});
assert.ok(!exported.includes('samsungcloudsolution.com'));
assert.ok(exported.includes('rtb-config.samsungads.com'));
['osb', 'rm', 'scs', 'gpm'].forEach(h => assert.ok(exported.includes(h + '.samsungqbe.com'), h + '.samsungqbe.com is a candidate'));
assert.ok(blocklist.essential('svdca.samsungqbe.com'), 'the certificate server stays reachable');
assert.ok(!exported.some(h => /^(samsungqbe\.com|samsungqbe\.cn)$/.test(h)), 'no parent domain of the QBE hosts');

// The local filter refuses names the TV needs, whatever the case, and accepts the rest.
assert.throws(() => dns.validate(['CDN.samsungcloudsolution.com ']), /cannot be blocked: the TV checks its internet connection/);
assert.throws(() => dns.validate(['rtb-config.samsungads.com', 'time.samsungcloudsolution.net']), /clock/);
assert.deepStrictEqual(dns.validate(['rtb-config.samsungads.com']), ['rtb-config.samsungads.com']);
assert.deepStrictEqual(dns.validate(['samsungcloudsolution.com']), ['samsungcloudsolution.com']);

// Dashboard data carries evidence and notes but not component names.
const groups = blocklist.publicGroups();
assert.deepStrictEqual(groups.map(g => g.evidence), ['firmware', 'firmware', 'firmware', 'firmware', 'reported', 'unverified']);
assert.ok(!JSON.stringify(groups).includes('"by"'));
groups.forEach(g => assert.ok(g.label && g.note && g.hosts.length));
console.log('PASS blocklist: evidence groups, unique valid hosts, essential names refused and never exported');
