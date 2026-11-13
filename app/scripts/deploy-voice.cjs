#!/usr/bin/env node
'use strict';
// Local developer setup after installing a voice-enabled Vetro build.
// Credentials are read as data, never printed or included in packaged artifacts.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
for (const name of ['.env', '.env.voice-trial']) {
    const file = path.join(root, name);
    if (fs.existsSync(file)) process.loadEnvFile(file);
}
const base = new URL(process.env.VETRO_BASE_URL || 'http://' + process.env.TV_IP + ':8099');
if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw Error('Invalid TV URL');
const q = s => "'" + String(s).replace(/'/g, "'\\''") + "'";
const tvRoot = '/opt/usr/apps/vetrotvapp/res/wgt';
async function request(route, data) {
    const headers = {'Content-Type': 'application/json'};
    if (process.env.VETRO_API_TOKEN) headers.Authorization = 'Bearer ' + process.env.VETRO_API_TOKEN;
    const response = await fetch(new URL(route, base), {method: data === undefined ? 'GET' : 'POST', redirect: 'error',
        headers, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(45000)});
    const result = await response.json();
    if (!response.ok || result.ok === false || result.timed_out) throw Error('TV setup operation failed');
    return result;
}
async function execute(cmd) { return (await request('/exec', {cmd})).output || ''; }
async function upload(remote, data, mode = '644') {
    const temp = remote + '.voice-upload';
    await execute('umask 077; mkdir -p ' + q(path.posix.dirname(remote)) + '; : > ' + q(temp));
    for (let offset = 0; offset < data.length; offset += 24000) {
        await execute('printf %s ' + q(data.subarray(offset, offset + 24000).toString('base64')) + ' | base64 -d >> ' + q(temp));
    }
    const expected = crypto.createHash('sha256').update(data).digest('hex');
    if (!(await execute('sha256sum ' + q(temp))).startsWith(expected + ' ')) throw Error('Upload verification failed');
    await execute('chmod ' + mode + ' ' + q(temp) + '; mv ' + q(temp) + ' ' + q(remote));
}
(async () => {
    const apiKey = process.env.OPENAI_API_KEY;
    const remoteAddress = process.env.VETRO_REMOTE_BLUETOOTH_ADDRESS;
    if (!apiKey || !/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(remoteAddress || '')) throw Error('Missing voice credentials or remote address');
    // Require the matching package to be installed first. Never hot-patch main.js
    // from a checkout into an unrelated Vetro version.
    const status = await request('/voice');
    if (typeof status.enabled !== 'boolean') throw Error('Install a voice-enabled Vetro build first');
    for (const name of ['VetroVoiceTrial.dll', 'VetroVoiceTrial.runtimeconfig.json', 'VetroVoiceTrial.deps.json', 'start-cue.wav']) {
        const expected = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'app/native/voice', name))).digest('hex');
        if (!(await execute('sha256sum ' + q(tvRoot + '/native/voice/' + name))).startsWith(expected + ' '))
            throw Error('Install the matching voice-enabled package first');
    }
    if (status.running || status.enabled) await request('/voice', {enabled: false});
    const privateDir = '/opt/usr/home/owner/share/vetro-voice';
    await execute('umask 077; mkdir -p ' + q(privateDir) + '; chmod 700 ' + q(privateDir));
    await upload(privateDir + '/config.json', Buffer.from(JSON.stringify({apiKey, remoteAddress,
        baseUrl: 'http://127.0.0.1:' + (base.port || '8099'), model: process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-transcribe'})), '600');
    console.log('Installed private voice configuration');
    const started = await request('/voice', {enabled: true});
    if (!started.running || started.error) throw Error('Voice did not start; inspect Vetro voice status');
    console.log('Voice configured and enabled. Hold the microphone button with the TV keyboard open.');
})().catch(() => { console.error('Voice setup failed. Check the installed package, TV pairing and private configuration; credentials were not logged.'); process.exitCode = 1; });
