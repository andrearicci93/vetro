'use strict';
const assert = require('assert').strict;
const vm = require('vm');
const builder = require('../build.cjs');
function collect() { return builder.collectIntegration(); }
const standalone = require('../../app/build.cjs').collectFiles();
const saved = {...process.env};
try {
    process.env.VETRO_ROOT_METHOD = 'external-root';
    delete process.env.VETRO_EXTERNAL_SMACK; delete process.env.VETRO_EXTERNAL_AUTO_RENEW;
    const files = collect(), names = files.map(f => decodeURIComponent(f.uri));
    assert.equal(new Set(names).size, names.length);
    assert.equal(names.filter(n => n === 'service/platform.js').length, 1);
    for (const name of ['node-root-agent.js','shell-worker.sh','shell-executor.js','remote-pc-content.js','remote-pc-smack.js','remote-pc-deadline.js']) {
        assert.ok(names.includes('service/' + name));
    }
    assert.ok(!names.some(n => /^payload\//.test(n) || /^service\/(sdb|tar|adb|root-preflight)/.test(n)));
    assert.ok(!standalone.some(f => /external-root|shell-worker|node-root-agent/.test(f.uri)));
    const script = files.find(f => decodeURIComponent(f.uri) === 'service/platform.js').data.toString();
    assert.ok(script.includes("backend: 'external-root'"));
    const context = {module: {exports: {}}};
    vm.runInNewContext(files.find(f => decodeURIComponent(f.uri) === 'service/build-info.js').data.toString(), context);
    assert.equal(context.module.exports.rootMethod, 'external-root');
    assert.equal(context.module.exports.externalRoot.autoRenew, false);
    assert.equal(context.module.exports.externalRoot.smack, 'none');
    process.env.VETRO_EXTERNAL_SMACK = 'rwxat'; assert.throws(collect, /Unknown VETRO_EXTERNAL_SMACK/);
    process.env.VETRO_EXTERNAL_SMACK = 'both-write'; process.env.VETRO_EXTERNAL_AUTO_RENEW = 'true';
    assert.throws(collect, /AUTO_RENEW must/);
    process.env.VETRO_EXTERNAL_AUTO_RENEW = '1';
    assert.doesNotThrow(collect);
    process.env.VETRO_ROOT_METHOD = 'unknown'; assert.throws(collect, /Unknown VETRO_ROOT_METHOD/);
    console.log('PASS external package: explicit selection, dependencies wired, unchanged defaults and app-only boundary');
} finally {
    for (const key of ['VETRO_ROOT_METHOD','VETRO_EXTERNAL_SMACK','VETRO_EXTERNAL_AUTO_RENEW']) {
        if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
}
