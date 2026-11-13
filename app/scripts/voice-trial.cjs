#!/usr/bin/env node
'use strict';

// Desktop runner: Node 20.12+ reads dotenv values as data, never shell code.
// The OpenAI key is used only for transcription; the optional Vetro pairing
// token authenticates TV requests. Neither belongs in the app package.
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
if (typeof process.loadEnvFile !== 'function') {
    console.error('Use Node 20.12 or newer for the desktop dictation runner.');
    process.exit(1);
}
for (const name of ['.env', '.env.voice-trial']) {
    const file = path.join(root, name);
    if (fs.existsSync(file)) process.loadEnvFile(file);
}
const child = spawn('python3', [path.join(__dirname, 'voice-trial.py'), ...process.argv.slice(2)], {
    stdio: 'inherit', env: process.env
});
child.on('error', () => { console.error('Could not start python3.'); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code === null ? 1 : code; });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGINT'));
