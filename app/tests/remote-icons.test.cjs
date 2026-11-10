'use strict';
// The remote key pictures: every copy (the .svg files, service/remote-icons.js, the block in index.html) is what
// app/design-system/remote/build.cjs makes now, so they cannot drift; the page copy is plain ES5 and safe to inline.
const assert = require('assert').strict, fs = require('fs');
const built = require('../design-system/remote/build.cjs');
Object.keys(built.outputs).forEach(f => {
    assert.equal(fs.readFileSync(f, 'utf8'), built.outputs[f], f + ' is out of date: run node app/design-system/remote/build.cjs');
});
const icons = require('../service/remote-icons.js');
['back', 'home', 'color-123', 'pad', 'pad-up', 'pad-down', 'pad-left', 'pad-right', 'pad-ok', 'rocker-ch-up', 'rocker-vol-press'].forEach(n => assert.ok(icons.icons[n], n));
Object.keys(icons.icons).forEach(n => {
    assert.doesNotMatch(icons.icons[n], / id="/, n + ': no ids (one page shows the same key many times)');
    assert.match(icons.icons[n], /aria-hidden="true"/, n + ': the wrapper carries the name');
});
assert.match(icons.key('pad-ok', 'OK'), /^<span class="rkey rkey-pad-ok" role="img" aria-label="OK" title="OK"><svg/);
assert.equal(icons.key('nope', 'x'), '');
assert.match(icons.key('back', 'a "b" <c>'), /aria-label="a &quot;b&quot; &lt;c>"/);
assert.doesNotMatch(icons.pageSource(), /`|\$\{/);
new Function(icons.pageSource());
// The pad's OK is drawn, not typed: the PNGs for the TV are rendered without fonts.
assert.doesNotMatch(icons.icons['pad-ok'], /<text/);
console.log('PASS remote key pictures: generated copies up to date, no ids, named wrapper, page-safe');
