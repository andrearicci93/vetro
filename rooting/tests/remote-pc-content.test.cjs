'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const {helperCommand} = require('../service/remote-pc-content.js');
const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'vetro-content-'));
const script = path.join(dir, "helper ' $(touch NEVER).sh");
try {
    fs.writeFileSync(script, 'printf \'%s\\n\' "$0" "$#" "$1" "$2" "$3"\n', {mode: 0o600});
    const args = ['private runtime', "quote' and $HOME", 'line\nsecond'];
    const command = helperCommand(script, 'vetro-worker', args);
    assert.ok(command.startsWith('setsid /bin/sh -c "$(cat '));
    assert.equal(cp.spawnSync('/bin/sh', ['-n'], {input: command}).status, 0);
    // macOS has no setsid. Exercise the exact generated shell invocation
    // without detachment; UEP and process-group behavior remain hardware checks.
    const output = cp.execFileSync('/bin/sh', ['-c', command.slice('setsid '.length)], {cwd: dir}).toString();
    assert.equal(output, ['vetro-worker', '3'].concat(args).join('\n') + '\n');
    assert.equal(fs.existsSync(path.join(dir, 'NEVER')), false, 'path is data, not shell code');
    for (const [file, name, argv] of [
        ['relative', 'worker', []], [script, 'worker', null],
        [script + '\0', 'worker', []], [script, 'worker\0', []],
        [script, 'worker', ['arg\0']], [script, 'worker', [5]]
    ]) assert.throws(() => helperCommand(file, name, argv));
} finally {
    if (fs.existsSync(script)) fs.unlinkSync(script);
    fs.rmdirSync(dir);
}
console.log('PASS content invocation, shell syntax, positional arguments and quoting');
