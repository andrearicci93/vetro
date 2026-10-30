#!/usr/bin/env node
'use strict';
// Plugin tooling.
//   node scripts/vetro-plugin.cjs new <id> [dir]     boilerplate from examples/plugins/hello
//   node scripts/vetro-plugin.cjs pack <folder> [out] bundle <id>-<version>.vplugin and print its SHA-256
const fs = require('fs'), path = require('path');
const crypto = require('crypto');

// Folder -> bundle text. Text files only, same limits the TV enforces on install.
function pack(folder) {
    const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
    const files = {};
    (function walk(dir, prefix) {
        for (const n of fs.readdirSync(dir).sort()) {
            if (n.charAt(0) === '.' || n === 'node_modules') continue;
            const full = path.join(dir, n), rel = prefix + n;
            if (fs.statSync(full).isDirectory()) walk(full, rel + '/');
            else if (rel !== 'manifest.json') files[rel] = fs.readFileSync(full, 'utf8');
        }
    })(folder, '');
    const text = JSON.stringify({ format: 'vetro-plugin', version: 1, manifest, files }) + '\n';
    return { id: manifest.id, version: manifest.version, text, sha256: crypto.createHash('sha256').update(text).digest('hex'), size: Buffer.byteLength(text) };
}
module.exports = { pack };
if (require.main !== module) return;

const [cmd, id, out] = process.argv.slice(2);
if (cmd === 'pack') {
    const r = pack(id);
    const file = path.join(out || '.', r.id + '-' + r.version + '.vplugin');
    fs.writeFileSync(file, r.text);
    console.log(file + '\nsha256 ' + r.sha256 + '\n' + r.size + ' bytes');
    process.exit(0);
}
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
