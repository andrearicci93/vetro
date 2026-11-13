'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const build = require('../build.cjs');
const previous = process.env.OPENAI_API_KEY;
const sentinel = ['sk', 'proj', 'only-a-packaging-test-never-a-real-key'].join('-');
process.env.OPENAI_API_KEY = sentinel;
try {
    const files = build.collectFiles();
    const voice = files.filter(f => decodeURIComponent(f.uri).startsWith('native/voice/'));
    assert.deepEqual(voice.map(f => decodeURIComponent(f.uri).split('/').pop()).sort(),
        ['VetroVoiceTrial.deps.json', 'VetroVoiceTrial.dll', 'VetroVoiceTrial.runtimeconfig.json', 'start-cue.wav']);
    for (const file of files) {
        const name = decodeURIComponent(file.uri);
        assert.ok(!file.data.includes(Buffer.from(sentinel)), name + ' contains an environment credential');
        assert.ok(!file.data.includes(Buffer.from(sentinel, 'utf16le')), name + ' contains an encoded environment credential');
        assert.ok(!/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/.test(file.data.toString()), name + ' contains a token pattern');
        assert.ok(!/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/.test(file.data.toString('utf16le')), name + ' contains an encoded token pattern');
    }
    const cue = voice.find(f => decodeURIComponent(f.uri).endsWith('/start-cue.wav'));
    assert.ok(cue.data.equals(fs.readFileSync(path.join(__dirname, '../../rooting/voice-trial/res/start-cue.wav'))));
    console.log('PASS voice package: explicit assets only, no environment credentials or token patterns, matching notification cue');
} finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
}
