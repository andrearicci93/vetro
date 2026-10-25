'use strict';
// Manifest facts for components the firmware catalog does not know: selection, the real shell scripts against temp
// folders, strict parsing, what reaches the report, and that the section is empty unless the user asked for it.
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const cf = require('../service/component-facts.js'), report = require('../service/diagnostic-report.js');
const KNOWN = 'com.samsung.tv.csfs';   // in the Q80A catalog

const rows = [
    {appId: KNOWN, packageId: KNOWN, origin: 'system', onboot: true, autorestart: false},
    {appId: 'com.samsung.tv.iacr', packageId: 'com.samsung.tv.iacr', origin: 'preinstalled', onboot: false, autorestart: false},
    {appId: 'vetrotvapp.svc', packageId: 'vetrotvapp', origin: 'installed', onboot: false, autorestart: false},
    {appId: 'vetrotvapp.app', packageId: 'vetrotvapp', origin: 'installed', onboot: false, autorestart: false},
    {appId: 'com.samsung.tv.tap-service-agent', packageId: 'com.samsung.tv.tap-service-agent', origin: 'installed', onboot: true, autorestart: false},
    {appId: 'bad id;rm', packageId: 'x', origin: 'installed'},
    {appId: 'ok.app', packageId: 'bad;pkg', origin: 'installed'}
];
// select(): the catalog's own components stay out, Vetro's own always come first, then boot-time ones
const sel = cf.select(rows);
assert.deepEqual(sel.targets.map(t => t.packageId), ['vetrotvapp', 'com.samsung.tv.tap-service-agent', 'com.samsung.tv.iacr']);
assert.equal(sel.targets[0].components.length, 2, 'two components, one package');
assert.equal(sel.total, 3); assert.equal(sel.truncated, false);
const many = Array.from({length: cf.MAX_PACKAGES + 30}, (_, i) => ({appId: 'u.p' + i, packageId: 'u.p' + i, origin: 'installed', onboot: false}));
const capped = cf.select(many);
assert.equal(capped.targets.length, cf.MAX_PACKAGES); assert.equal(capped.truncated, true); assert.equal(capped.total, cf.MAX_PACKAGES + 30);

// A manifest the way Tizen writes one, and some that are not
const MANIFEST = (pkg, app, extra) => `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns="http://tizen.org/ns/packages" package="${pkg}" version="1.0">
    <author email="someone@example.test" href="https://example.test">Someone</author>
    <description>${(extra && extra.description) || 'Analysis Data Manager'}</description>
    <service-application appid="${app}" auto-restart="${(extra && extra.restart) || 'true'}" exec="${(extra && extra.exec) || '/opt/usr/apps/' + pkg + '/bin/svc'}" on-boot="${(extra && extra.boot) || 'true'}" taskmanage="true" type="capp">
    </service-application>
    <privileges>
        <privilege>http://tizen.org/privilege/internet</privilege>
        <privilege>http://developer.samsung.com/privilege/securestorage</privilege>
        <privilege>http://evil.test/privilege/x</privilege>
        <privilege>file:///etc/passwd</privilege>
    </privileges>
</manifest>
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-comp-'));
const pk = path.join(dir, 'packages'), apps = path.join(dir, 'apps');
fs.mkdirSync(pk); fs.mkdirSync(apps);
function install(pkg, app, extra) {
    fs.writeFileSync(path.join(pk, pkg + '.xml'), MANIFEST(pkg, app, extra));
    fs.mkdirSync(path.join(apps, pkg, 'bin'), {recursive: true});
    fs.writeFileSync(path.join(apps, pkg, 'bin', 'svc'), 'binary-of-' + pkg);
}
install('com.samsung.tv.iacr', 'com.samsung.tv.iacr', {boot: 'false'});
install('com.samsung.tv.tap-service-agent', 'com.samsung.tv.tap-service-agent', {boot: 'true', restart: 'false', description: 'Contact https://x.test now'});
install('vetrotvapp', 'vetrotvapp.svc', {boot: 'true', restart: 'true'});
// vetrotvapp.app has no entry in its manifest, as in the test above; that package row has two components

function executor() {
    const calls = [];
    const run = async cmd => {
        const b64 = /^echo (\S+) \| base64 -d \| nice -n 19 sh$/.exec(cmd);
        assert.ok(b64, 'low priority wrapper');
        const script = Buffer.from(b64[1], 'base64').toString();
        calls.push(script);
        const real = script.split('/opt/share/packages/').join(pk + '/').split('/usr/share/packages/').join(path.join(dir, 'nowhere') + '/').split('/opt/usr/apps/').join(apps + '/');
        const r = cp.spawnSync('sh', ['-c', real], {encoding: 'utf8'});
        return {exit_code: r.status, stdout: r.stdout.split(apps + '/').join('/opt/usr/apps/')};
    };
    run.calls = calls;
    return run;
}

(async function () {
    try {
        const run = executor();
        const data = await cf.read(run, rows);
        assert.equal(run.calls.length, 2, 'one call for the manifests, one for the hashes');
        assert.ok(run.calls.every(s => !/\b(rm|mv|cp|tee|chmod|kill)\b|>\s*\/(?!dev\/null)/.test(s.replace(/rm -f/g, ''))), 'read-only scripts');
        const by = Object.fromEntries(data.packages.map(p => [p.packageId, p]));
        assert.deepEqual(Object.keys(by), ['vetrotvapp', 'com.samsung.tv.tap-service-agent', 'com.samsung.tv.iacr']);

        const iacr = by['com.samsung.tv.iacr'];
        assert.equal(iacr.manifest, 'found'); assert.match(iacr.manifestSha256, /^[a-f0-9]{64}$/);
        assert.equal(iacr.description, 'Analysis Data Manager', 'system and preinstalled components keep their description');
        assert.deepEqual(iacr.privileges, ['tizen/internet', 'samsung/securestorage'], 'shortened, and foreign hosts and schemes refused');
        const c = iacr.components[0];
        assert.deepEqual([c.kind, c.exec, c.declaredOnBoot, c.declaredAutoRestart, c.registeredOnBoot, c.differs, c.exeSha256], ['service', 'svc', false, true, false, true, null],
            'declared auto-restart differs from the registered one; not started at boot, so not hashed');

        const tap = by['com.samsung.tv.tap-service-agent'];
        assert.equal(tap.description, null, 'an installed component: no free text from its author, and this one holds a URL anyway');
        assert.match(tap.components[0].exeSha256, /^[a-f0-9]{64}$/, 'starts at boot: its program is hashed');
        assert.equal(tap.components[0].differs, false);

        const own = by.vetrotvapp;
        const svc = own.components.find(x => x.appId === 'vetrotvapp.svc'), ui = own.components.find(x => x.appId === 'vetrotvapp.app');
        assert.deepEqual([svc.declaredOnBoot, svc.registeredOnBoot, svc.differs], [true, false, true], 'the #25 / #26 case: on-boot asked, onboot=false registered');
        assert.match(svc.exeSha256, /^[a-f0-9]{64}$/);
        assert.deepEqual([ui.kind, ui.declaredOnBoot, ui.differs], [null, null, null], 'a component the manifest does not list: unknown, not "false"');
        assert.equal(own.description, 'Analysis Data Manager', 'Vetro describes itself');

        // A missing manifest, a hostile exec path, an oversized program
        const none = await cf.read(executor(), [{appId: 'a.b', packageId: 'a.b', origin: 'installed', onboot: true}]);
        assert.deepEqual([none.packages[0].manifest, none.packages[0].manifestSha256, none.packages[0].components[0].kind], ['missing', null, null]);
        install('p.evil', 'p.evil', {exec: '/opt/usr/apps/../../etc/shadow', boot: 'true'});
        const evil = await cf.read(executor(), [{appId: 'p.evil', packageId: 'p.evil', origin: 'installed', onboot: true}]);
        assert.equal(evil.packages[0].components[0].exec, null, 'a path with .. is refused'); assert.equal(evil.packages[0].components[0].exeSha256, null);
        install('p.big', 'p.big', {boot: 'true'});
        fs.writeFileSync(path.join(apps, 'p.big', 'bin', 'svc'), Buffer.alloc(8388608 + 1));
        const big = await cf.read(executor(), [{appId: 'p.big', packageId: 'p.big', origin: 'installed', onboot: true}]);
        assert.equal(big.packages[0].components[0].exeSha256, null, 'larger than 8 MB: not read');

        // Failures: the manifests are the section; a failed hash step is not
        await assert.rejects(cf.read(async () => ({exit_code: 1, stdout: ''}), rows), e => e.code === 'command-failed');
        await assert.rejects(cf.read(async () => ({exit_code: 0, timed_out: true, stdout: ''}), rows), e => e.code === 'command-timeout');
        let n = 0;
        const flaky = await cf.read(async cmd => { if (n++) throw new Error('boom'); return executor()(cmd); }, rows);
        assert.equal(flaky.packages.length, 3); assert.ok(flaky.packages.every(p => p.components.every(x => x.exeSha256 === null)), 'no hashes, still a report');
        assert.equal((await cf.read(async () => { throw new Error('not called'); }, [{appId: KNOWN, packageId: KNOWN}])).packageCount, 0, 'nothing unknown: no call to the TV');

        // In the report: strict projection, and "not-requested" without the box
        const poisoned = Object.assign({}, data, {
            packages: data.packages.concat([{packageId: 'p.x', origin: 'installed', manifest: 'found', manifestSha256: 'zz', description: 'see 192.0.2.10', privileges: ['http://x.test/p', 'tizen/ok'],
                components: [{appId: 'p.x', kind: 'weird', exec: '/home/owner/secret', exeSha256: 'nothex', serial: 'private-serial', declaredOnBoot: 'yes'}], serial: 'private-serial'}])});
        const out = await report.collect({components: () => poisoned}, 1000);
        const sec = out.sections.components;
        assert.equal(sec.status, 'ok');
        const text = JSON.stringify(sec);
        ['192.0.2.10', 'x.test', '/home/owner', 'private-serial', 'example.test', 'someone@'].forEach(s => assert.ok(!text.includes(s), 'leaked: ' + s));
        const px = sec.data.packages.find(p => p.packageId === 'p.x');
        assert.deepEqual([px.manifestSha256, px.description, px.privileges, px.components[0].kind, px.components[0].exec, px.components[0].exeSha256, px.components[0].declaredOnBoot],
            [null, null, ['tizen/ok'], null, null, null, null]);
        const off = await report.collect({components: () => { throw require('../service/exec-error.js').coded('not-requested', 'x'); }}, 1000);
        assert.deepEqual([off.sections.components.status, off.sections.components.reason], ['unavailable', 'not-requested']);
        console.log('PASS component facts: unknown components only, manifests read for real, flags compared, strict export, opt-in');
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
})().catch(e => { console.error(e); process.exitCode = 1; });
