'use strict';
const assert = require('assert').strict;
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const script = fs.readFileSync(path.join(__dirname, '../scripts/deploy-voice.cjs'), 'utf8');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');

async function setup(mismatch) {
    const commands = [], requests = [], logs = [], config = [];
    const process = {env: {TV_IP: 'tv.invalid', OPENAI_API_KEY: 'test-openai-key',
        VETRO_API_TOKEN: 'test-vetro-token', VETRO_REMOTE_BLUETOOTH_ADDRESS: '00:11:22:33:44:55'}};
    const files = {existsSync: () => false, readFileSync: file => Buffer.from(path.basename(file))};
    const fetch = async (url, options) => {
        assert.equal(options.headers.Authorization, 'Bearer test-vetro-token');
        assert.equal(options.redirect, 'error', 'pairing token never follows redirects');
        requests.push([url.pathname, options.method, options.body]);
        let result = options.method === 'POST' && url.pathname === '/voice' ?
            {enabled: true, running: true} : {enabled: false, running: false};
        if (url.pathname === '/exec') {
            const cmd = JSON.parse(options.body).cmd;
            commands.push(cmd);
            result = {ok: true, output: ''};
            const upload = /printf %s '([A-Za-z0-9+/=]+)' \| base64 -d >>/.exec(cmd);
            if (upload) config.push(Buffer.from(upload[1], 'base64'));
            if (cmd.startsWith('sha256sum ')) {
                const name = path.posix.basename(cmd.split("'")[1]);
                const digest = name === 'config.json.voice-upload' ? hash(Buffer.concat(config)) :
                    mismatch ? 'wrong-hash' : hash(Buffer.from(name));
                result.output = digest + '  asset\n';
            }
        }
        return {ok: true, json: async () => result};
    };
    await vm.runInNewContext(script, {require: name => name === 'node:fs' ? files : require(name),
        __dirname: path.join(__dirname, '../scripts'), process, Buffer, URL, AbortSignal, fetch,
        console: {log: text => logs.push(text), error: text => logs.push(text)}});
    return {commands, requests, logs, config, process};
}

(async () => {
    const result = await setup(false);
    assert.equal(result.process.exitCode, undefined);
    const config = JSON.parse(Buffer.concat(result.config));
    assert.equal(config.apiKey, 'test-openai-key');
    assert.ok(!JSON.stringify(config).includes('test-vetro-token'), 'pairing credential stays on the setup computer');
    assert.ok(result.commands.some(cmd => cmd.includes('chmod 700')));
    assert.ok(result.commands.some(cmd => cmd.includes('chmod 600')));
    assert.ok(result.commands.every(cmd => !cmd.includes('/service/')), 'setup never overwrites the main service');
    assert.equal(result.requests.at(-1)[0], '/voice');
    assert.equal(result.requests.at(-1)[2], '{"enabled":true}');
    const failed = await setup(true);
    assert.equal(failed.process.exitCode, 1);
    assert.equal(failed.config.length, 0, 'mismatched package cannot receive credentials');
    assert.ok(!failed.requests.some(r => r[0] === '/voice' && r[1] === 'POST'));
    for (const r of [result, failed]) {
        assert.ok(!r.logs.join(' ').includes('test-openai-key'));
        assert.ok(!r.logs.join(' ').includes('test-vetro-token'));
    }
    console.log('PASS voice setup: paired requests, package verification, private config, no service replacement or credential logging');
})().catch(error => {console.error(error);process.exitCode = 1;});
