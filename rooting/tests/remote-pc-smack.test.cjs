'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');
const source = fs.readFileSync(path.join(__dirname, '../service/remote-pc-smack.js'), 'utf8');
function rules(value, unreadable) {
    const context = {module: {exports: {}}, require(name) {
        assert.equal(name, 'fs');
        return {readFileSync(file, encoding) {
            assert.equal(file, '/proc/self/attr/current');
            assert.equal(encoding, 'utf8');
            if (unreadable) throw new Error('not available');
            return value;
        }};
    }};
    vm.runInNewContext(source, context);
    return context.module.exports.buildRules();
}
const script = rules('User::Pkg::vetrotvapp\n');
assert.equal(script, "printf '%s\\n' '_ User::Pkg::vetrotvapp w' > /sys/fs/smackfs/load2 2>/dev/null || true\n" +
    "printf '%s\\n' 'User::Pkg::vetrotvapp _ w' > /sys/fs/smackfs/load2 2>/dev/null || true\n");
assert.equal(cp.spawnSync('/bin/sh', ['-n'], {input: script}).status, 0);
assert.equal(rules(null, true), '');
assert.ok(rules('a'.repeat(23)), 'short-label boundary is accepted');
for (const label of ['', 'a'.repeat(24), 'x y', 'x\ny', '-label', 'x"y', "x'y", 'x;y', '$(id)', 'x\0y', 'é']) {
    assert.equal(rules(label), '', 'skip unsupported label ' + JSON.stringify(label));
}
// Execute only printf, with both policy destinations redirected to fixtures.
const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'vetro-smack-'));
const files = [path.join(dir, 'forward'), path.join(dir, 'reverse')];
try {
    let i = 0;
    const fixture = script.replace(/\/sys\/fs\/smackfs\/load2/g, () => "'" + files[i++] + "'");
    cp.execFileSync('/bin/sh', ['-c', fixture]);
    assert.equal(fs.readFileSync(files[0], 'utf8'), '_ User::Pkg::vetrotvapp w\n');
    assert.equal(fs.readFileSync(files[1], 'utf8'), 'User::Pkg::vetrotvapp _ w\n');
} finally {
    files.forEach(file => { if (fs.existsSync(file)) fs.unlinkSync(file); });
    fs.rmdirSync(dir);
}
console.log('PASS own-label SMACK rules, skip cases, shell syntax and fixture-only writes');
