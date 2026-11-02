'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {once} = require('events');
const net = require('net');
const {create} = require('../service/remote-pc-platform.js');

async function main() {
    const p = create({lifetimeMs: 2000});
    p.start(); p.start();
    await new Promise(resolve => setTimeout(resolve, 20));
    const state = p.status();
    assert.equal(state.prepared, true);
    assert.equal(state.setupRequired, true);
    assert.equal(state.agent.connected, false);
    assert.equal(state.persistent, false);
    assert.ok(!JSON.stringify(state).includes('secret'));
    const directory = /^lab\$\(bash<(\/tmp\/vq-[A-Za-z0-9]+)\/launch\)$/.exec(state.bootstrapUsername)[1];
    assert.equal(fs.statSync(directory).mode & 0o777, 0o711);
    assert.equal(fs.statSync(path.join(directory, 'session.json')).mode & 0o777, 0o600);
    assert.ok(!/\s/.test(state.bootstrapUsername), 'the firmware splits credential whitespace and joins it with commas');
    // Reproduce the firmware's credential-word joining before shell evaluation.
    // The fixture script replaces the real bootstrap and runs as the host user.
    const cp = require('child_process');
    cp.execFileSync('/bin/bash', ['-n', path.join(directory, 'launch')]);
    fs.writeFileSync(path.join(directory, 'launch'), 'printf BOOTSTRAP_EXECUTED\n');
    const env = Object.assign({}, process.env, {VETRO_TEST_USERNAME: state.bootstrapUsername});
    const result = cp.execFileSync('/bin/bash', ['-c',
        'join_by(){ local IFS="$1"; shift; echo "$*"; }; c=$(join_by , $(printf "username=%s\\npassword=fixture\\n" "$VETRO_TEST_USERNAME")); bash -c "printf %s $c"'], {env}).toString();
    assert.match(result, /username=labBOOTSTRAP_EXECUTED,password=fixture/);
    await assert.rejects(p.execute('id'), /no root agent/);
    await assert.rejects(p.install(), /not enabled/);
    await assert.rejects(p.setApplicationsEnabled(), /not enabled/);
    const sock = net.connect(state.agentPort, '127.0.0.1');
    await once(sock, 'data');
    sock.destroy();
    p.stop(); p.stop();
    assert.equal(p.status().running, false);
    assert.equal(fs.existsSync(directory), false);
    assert.equal(p.status().bootstrapUsername, undefined);

    process.env.VETRO_ROOT_METHOD = 'remote-pc';
    const files = require('../build.cjs').collectIntegration();
    delete process.env.VETRO_ROOT_METHOD;
    const names = files.map(file => decodeURIComponent(file.uri));
    assert.equal(new Set(names).size, names.length);
    assert.ok(names.includes('service/node-root-agent.js'));
    const adapter = files.find(file => decodeURIComponent(file.uri) === 'service/platform.js').data.toString();
    assert.ok(adapter.includes('bootstrapUsername'));
    const metadata = {module: {exports: {}}};
    vm.runInNewContext(files.find(file => decodeURIComponent(file.uri) === 'service/build-info.js').data.toString(), metadata);
    assert.equal(metadata.module.exports.readOnly, true);
    assert.equal(metadata.module.exports.rootMethod, 'remote-pc');
    console.log('PASS Remote PC lifecycle, private staging, no agent/no writes, cleanup and opt-in package');
}
const watchdog = setTimeout(() => { console.error('Remote PC test did not complete'); process.exit(1); }, 10000);
main().then(() => clearTimeout(watchdog)).catch(error => { console.error(error); process.exit(1); });
