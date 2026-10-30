#!/usr/bin/env node
'use strict';
// Plugin boilerplate: node scripts/vetro-plugin.cjs new <id> [dir]
// Copies examples/plugins/hello into <dir>/<id> with the id and name filled in.
const fs = require('fs'), path = require('path');
const [cmd, id, out] = process.argv.slice(2);
if (cmd !== 'new' || !/^[a-z][a-z0-9-]{1,31}$/.test(id || '') || id === 'install' || id === 'resume') {
    console.error('usage: node scripts/vetro-plugin.cjs new <id> [dir]\n  id: 2-32 chars, a-z 0-9 and -, starting with a letter');
    process.exit(2);
}
const src = path.join(__dirname, '..', 'examples', 'plugins', 'hello');
const dest = path.join(out || '.', id);
if (fs.existsSync(dest)) { console.error(dest + ' already exists'); process.exit(1); }
const label = id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' ');
fs.mkdirSync(dest, { recursive: true });
for (const f of ['manifest.json', 'index.js']) {
    const text = fs.readFileSync(path.join(src, f), 'utf8').replace(/"id": "hello"/, '"id": "' + id + '"')
        .replace(/"name": "Hello"/, '"name": "' + label + '"').replace(/"label": "Hello"/, '"label": "' + label.slice(0, 24) + '"')
        .replace(/<h2>Hello<\/h2>/, '<h2>' + label + '</h2>').replace(/Smallest useful Vetro plugin/, label + ': a Vetro plugin');
    fs.writeFileSync(path.join(dest, f), text);
}
console.log('Created ' + dest + '\nCopy the folder into the TV plugin folder, restart Vetro, then switch it on in Plugins.');
