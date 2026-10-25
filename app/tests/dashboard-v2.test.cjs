'use strict';
// The dashboard follows the recorded design system, names its panels for what they do and shows the Vetro icon.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const root = path.resolve(__dirname, '..');
const html = require('../service/dashboard.js')();
const squash = t => t.replace(/\s+/g, '');

// design-system/tokens.css is the source; every token in its :root block is in the page, unchanged
const tokens = fs.readFileSync(path.join(root, 'design-system', 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rootBlock = /:root \{([\s\S]*?)\n\}/.exec(tokens)[1];
const pairs = rootBlock.split(';').map(x => x.trim()).filter(Boolean);
assert.ok(pairs.length > 40, 'the token block was read');
pairs.forEach(p => assert.ok(squash(html).includes(squash(p)), 'token missing from the dashboard: ' + p.slice(0, 50)));
assert.ok(squash(html).includes(squash('--vetro-duration-fast:0ms')), 'reduced motion is honoured');

// Navigation: the three entries at the top, then the rest
const nav = /<nav aria-label="Main">([\s\S]*?)<\/nav>/.exec(html)[1];
assert.deepEqual([...nav.matchAll(/data-tab="(\w+)"/g)].map(m => m[1]), ['quick', 'dock', 'remote']);
assert.match(nav, /Launcher<span class="chip beta">Beta<\/span>/);
assert.match(nav, /Remapper<\/button>/);
assert.match(html, /<nav aria-label="TV"><button data-tab="apps"[^>]*>[\s\S]*?Task manager<\/button>/);
const visible = html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<script>[\s\S]*?<\/script>/, '');
assert.doesNotMatch(visible, /Debloater/, 'no panel is still called Debloater');
assert.match(html, /remote:\['Remapper'/);
assert.match(html, /apps:\['Task manager'/);
assert.match(html, /id="betaTag" class="chip beta"/);

// The icon: in the brand block, as the page icon, and served by the service
assert.match(html, /<link rel="icon" href="\/icon.png">/);
assert.match(html, /<div class="brand"><img src="\/icon.png"/);
// Cards with rounded corners never get a coloured top border (a thicker line on top makes ears at the corners)
assert.doesNotMatch(html, /border-top:\s*[2-9]px solid var\(--(accent|ok|warn|danger)/);
assert.doesNotMatch(html, /border-top-color/);

const handler = require('./service-harness.cjs')(root, {dependencies: {fs: fs}}).router;
const res = new Promise(resolve => {
  const req = new EventEmitter(); req.method = 'GET'; req.url = '/icon.png';
  let head, status;
  handler(req, {writeHead: (n, h) => { status = n; head = h; }, end: data => resolve({status, head, data})});
});
res.then(r => {
  assert.equal(r.status, 200);
  assert.equal(r.head['content-type'], 'image/png');
  assert.deepEqual(r.data, fs.readFileSync(path.join(root, 'icon.png')));
  assert.deepEqual([...r.data.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'a real PNG');
  console.log('PASS dashboard v2: design tokens, nav order, names, beta tag, Vetro icon');
}).catch(e => { console.error(e); process.exitCode = 1; });
