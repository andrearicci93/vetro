'use strict';
const assert = require('assert').strict;
const { Order, parse, render, validate } = require('../service/home-order.js');

const FIX = '3210\ns/livetv@TVPLUS\nd/webapp@aaa\nd/webapp@bbb\nEOFC OBA\n';

assert.deepEqual(parse(FIX).entries, ['s/livetv@TVPLUS', 'd/webapp@aaa', 'd/webapp@bbb']);
assert.equal(render({ version: '3210', entries: ['s/livetv@TVPLUS', 'd/webapp@aaa', 'd/webapp@bbb'] }), FIX);
const NOSP = FIX.replace('EOFC OBA', 'EOFCOBA');
assert.deepEqual(parse(NOSP).entries, parse(FIX).entries);
assert.equal(parse(NOSP).term, 'EOFCOBA');
assert.equal(render(parse(NOSP)), NOSP, 'terminator preserved on rewrite');
assert.throws(() => parse('3210\ns/livetv@TVPLUS\nd/webapp@aaa\nEOF\n'), /terminator/);
assert.throws(() => parse('nope'), /Unrecognized/);
assert.throws(() => parse('3210\nx/y@z\nEOFC OBA\n'), /Invalid/);
assert.throws(() => validate(['d/webapp@a', 'd/webapp@a', 'bad']), /Invalid/);
assert.throws(() => validate('x'), /Invalid/);

let wrote = null;
const runner = async function (cmd) {
    const script = Buffer.from(cmd.split(' ')[1], 'base64').toString();
    if (/cat .*appLayerCache/.test(script)) return { exit_code: 0, stdout: FIX };
    if (script.includes('echo ') && script.includes('base64 -d >')) wrote = script;
    return { exit_code: 0, stdout: 'OK' };
};

(async function () {
    const o = new Order(runner);
    const r = await o.read();
    assert.deepEqual(r.entries, ['s/livetv@TVPLUS', 'd/webapp@aaa', 'd/webapp@bbb']);

    await assert.rejects(o.write(['s/livetv@TVPLUS', 'd/webapp@aaa']), /unchanged/);
    await assert.rejects(o.write(['x/y@z', 'd/webapp@aaa', 'd/webapp@bbb']), /Invalid/);

    await assert.rejects(o.write(['d/webapp@bbb', 's/livetv@TVPLUS', 'd/webapp@aaa']), /not confirmed/);
    assert.ok(/vetro-bak/.test(wrote), 'backup scritto');
    const payload = (wrote.match(/echo ([A-Za-z0-9+/=]+) \| base64 -d >/) || [])[1] || '';
    const text = Buffer.from(payload, 'base64').toString();
    assert.equal(text, '3210\nd/webapp@bbb\ns/livetv@TVPLUS\nd/webapp@aaa\nEOFC OBA\n');
    assert.equal(o.busy, false);
    let current=FIX;const good=new Order(async cmd=>{const script=Buffer.from(cmd.split(' ')[1],'base64').toString();if(/cat .*appLayerCache/.test(script))return {exit_code:0,stdout:current};current=Buffer.from(script.match(/echo ([A-Za-z0-9+/=]+) \| base64 -d >/)[1],'base64').toString();return {exit_code:0,stdout:'OK'};}); assert.equal((await good.write(['d/webapp@bbb','s/livetv@TVPLUS','d/webapp@aaa'])).saved,true);
    console.log('PASS home-order: parse/render, strict entry validation, permutation-only write with backup');
})().catch(function (e) { console.error(e); process.exitCode = 1; });

// Physical input entry (The Frame 2024, issue #41): dots in the type part, and the EOFCOBA terminator.
{
    const HDMI = "1146\ns/livetv@TVPLUS\ns/source.layer.hdmi@HDMI3/0\nEOFCOBA\n";
    const p = parse(HDMI);
    assert.deepEqual(p.entries, ["s/livetv@TVPLUS", "s/source.layer.hdmi@HDMI3/0"]);
    assert.equal(render(p), HDMI);
    validate(["s/source.layer.hdmi@HDMI3/0"]);
    for (const bad of ["s/a b@x", "s/a;b@x", "x/source.layer.hdmi@HDMI3/0", "s/source.layer.hdmi@HDMI 3", "s/a$(id)@x", "s/a/b@x", "s/a-b@x"]) {
        assert.throws(() => validate([bad]), /Invalid/, bad);
    }
}
