'use strict';
// The uninstall route: the package's registry ids are read BEFORE `pkgcmd -u`, and once the package is verified gone the
// leftovers of the uninstall (Home line, registry row, icon folder) are cleaned. An uninstall that did not happen cleans nothing.
const assert = require('assert').strict, EventEmitter = require('events'), path = require('path');
const {context, router} = require('./service-harness.cjs')(path.resolve(__dirname, '..'));
const id = 'MCmYXNxgcu.DisneyPlus';
let installed = true, removeWorks = true, steps = [];
const decode = cmd => { const m = /^echo (\S+) \| base64 -d \| sh$/.exec(cmd); return m ? Buffer.from(m[1], 'base64').toString() : cmd; };
context.inventory = async () => ({apps: installed ? [{appId: id, packageId: 'MCmYXNxgcu', system: false, removable: true, disabled: false, show: true}] : []});
context.invalidateInventory = () => {};
context.agentExecute = async cmd => {
    const s = decode(cmd);
    if (/pkgcmd -u/.test(s)) { steps.push('uninstall'); if (removeWorks) installed = false; return {exit_code: 0, stdout: 'ok'}; }
    if (/SELECT hex\(id\) FROM widgetinfo/.test(s)) { steps.push('learn'); return {exit_code: 0, stdout: Buffer.from('3201901017640').toString('hex') + '\n'}; }
    if (/strip\(\)/.test(s)) {
        steps.push('clean');
        assert.ok(/3201901017640/.test(s) && /MCmYXNxgcu/.test(s), 'the clean script names the ids it learned');
        return {exit_code: 0, stdout: 'SIGNAL x\nHOME 2\nROW 1\nICON 3201901017640\n'};
    }
    return {exit_code: 0, stdout: ''};
};
function request(body) {
    return new Promise(resolve => {
        const r = new EventEmitter(); r.method = 'POST'; r.url = '/components/action'; let status;
        router(r, {writeHead(n) { status = n; }, end(data) { resolve({status, body: JSON.parse(data)}); }});
        r.emit('data', Buffer.from(JSON.stringify(body))); r.emit('end');
    });
}
(async () => {
    const ok = await request({action: 'uninstall', appId: id});
    assert.equal(ok.status, 200); assert.equal(ok.body.verified, true);
    assert.deepEqual(steps.filter(s => s !== 'noise'), ['learn', 'uninstall', 'clean'], 'ids read first, leftovers cleaned after the package is gone');
    assert.equal(ok.body.cleanup.home, 'removed'); assert.equal(ok.body.cleanup.rows, 1); assert.equal(ok.body.cleanup.icons, 1);
    console.log('PASS uninstall reads the registry ids first and cleans the leftovers after');

    installed = true; removeWorks = false; steps = [];
    const failed = await request({action: 'uninstall', appId: id});
    assert.equal(failed.body.verified, false);
    assert.deepEqual(steps, ['learn', 'uninstall'], 'a package that is still there is not cleaned');
    assert.equal(failed.body.cleanup, undefined);
    console.log('PASS an uninstall that did not happen cleans nothing');
})().catch(e => { console.error(e); process.exitCode = 1; });
