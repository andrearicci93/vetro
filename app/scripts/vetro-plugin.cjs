#!/usr/bin/env node
'use strict';
// Plugin tooling (runs on your computer, not on the TV). Guide: docs/plugins.md
//   node scripts/vetro-plugin.cjs new <id> [dir]           create a plugin folder from the template
//   node scripts/vetro-plugin.cjs check <folder>           the checks the TV will run, plus loading the entry file
//   node scripts/vetro-plugin.cjs pack <folder> [outDir]   bundle <id>-<version>.vplugin, print its SHA-256
//   node scripts/vetro-plugin.cjs index <index.json> <bundle.vplugin> [url]
//                                                          add or update that bundle in a plugin list (registry)
//   node scripts/vetro-plugin.cjs keygen <folder>          make the plugin list key pair (private key stays with the list's maintainer)
//   node scripts/vetro-plugin.cjs sign <index.json> <private.pem> [dist-folder]
//                                                          add a `signature` to every entry (id, version, bundle SHA-256)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { checkBundle, BUNDLE_MAX_BYTES, signedText } = require('../service/plugin-host.js');

const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
const die = (msg, code) => { console.error(msg); process.exit(code || 1); };

// Folder -> bundle text. Text files only, same rules the TV applies on install.
function pack(folder) {
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8')); }
    catch (e) { throw new Error(path.join(folder, 'manifest.json') + ' is missing or not valid JSON'); }
    const files = {}, skipped = [];
    (function walk(dir, prefix) {
        for (const n of fs.readdirSync(dir).sort()) {
            const full = path.join(dir, n), rel = prefix + n;
            if (n.charAt(0) === '.' || n === 'node_modules' || n === 'config.json') { skipped.push(rel); continue; }
            if (fs.statSync(full).isDirectory()) { walk(full, rel + '/'); continue; }
            if (rel === 'manifest.json') continue;
            const buf = fs.readFileSync(full);
            if (buf.includes(0)) throw new Error(rel + ' is a binary file; a bundle holds text only');
            files[rel] = buf.toString('utf8');
        }
    })(folder, '');
    const bundle = { format: 'vetro-plugin', version: 1, manifest, files };
    checkBundle(bundle);                      // throws the same message the TV would show
    const text = JSON.stringify(bundle) + '\n';
    if (Buffer.byteLength(text) > BUNDLE_MAX_BYTES + 4096) throw new Error('Bundle is too large for the TV to accept');
    return { id: manifest.id, version: manifest.version, manifest, text, skipped, sha256: sha256(text), size: Buffer.byteLength(text) };
}

// The plugin list entry for a packed bundle. `url` is relative to the list file unless absolute.
function entryFor(r, url) {
    const m = r.manifest, e = { id: m.id, name: m.name || m.id, version: m.version || '0.0.0' };
    if (m.description) e.description = m.description;
    if (m.author) e.author = m.author;
    e.permissions = m.permissions || [];
    e.url = url;
    e.sha256 = r.sha256;
    return e;
}

// Load the entry file the way the TV will and make sure it returns something usable.
function load(folder, manifest) {
    const mod = require(path.resolve(folder, manifest.main || 'index.js'));
    const create = typeof mod === 'function' ? mod : mod && mod.create;
    if (typeof create !== 'function') throw new Error('The entry file must export a function (module.exports = function (ctx) { ... })');
    const inst = create({ id: manifest.id, dir: path.resolve(folder), config: { get: () => ({}), set: () => {} }, execute: () => Promise.reject(new Error('no exec here')) });
    if (!inst || typeof inst !== 'object') throw new Error('The function must return an object: { start, stop, status, route }');
    for (const k of ['start', 'stop', 'status', 'route']) if (inst[k] != null && typeof inst[k] !== 'function') throw new Error(k + ' must be a function');
    if (manifest.ui && typeof inst.route !== 'function') throw new Error('manifest.ui is set, so route(req, res, sub) must serve "ui"');
    return inst;
}

function scaffold(id, outDir) {
    const src = path.join(__dirname, '..', 'examples', 'plugins', 'hello');
    const dest = path.join(outDir || '.', id);
    if (fs.existsSync(dest)) die(dest + ' already exists');
    const label = id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' ');
    const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
    Object.assign(manifest, { id, name: label, version: '0.1.0', description: 'Describe what ' + label + ' does in one line.', author: 'Your name' });
    manifest.ui = { label: label.slice(0, 24) };
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    fs.writeFileSync(path.join(dest, 'index.js'), fs.readFileSync(path.join(src, 'index.js'), 'utf8')
        .replace('<h2>Hello</h2>', '<h2>' + label + '</h2>').replace('Smallest useful Vetro plugin', label + ': a Vetro plugin')
        .replace(/\/plugins\/hello\//g, '/plugins/' + id + '/'));
    fs.writeFileSync(path.join(dest, 'README.md'), [
        '# ' + label, '',
        'A Vetro plugin. Developer guide: https://github.com/andrearicci93/vetro/blob/main/app/docs/plugins.md', '',
        '```', 'node scripts/vetro-plugin.cjs check ' + id + '    # same checks as the TV', 'node scripts/vetro-plugin.cjs pack ' + id + '     # ' + id + '-0.1.0.vplugin + SHA-256', '```', '',
        'Try it: open Vetro, Plugins, "or from a file", pick the `.vplugin`, switch it on.', ''].join('\n'));
    return dest;
}

module.exports = { pack, entryFor };
if (require.main !== module) return;

const [cmd, a, b, c] = process.argv.slice(2);
try {
    if (cmd === 'new') {
        if (!/^[a-z][a-z0-9-]{1,31}$/.test(a || '') || a === 'install' || a === 'resume') die('usage: node scripts/vetro-plugin.cjs new <id> [dir]\n  id: 2-32 chars, a-z 0-9 and -, starting with a letter', 2);
        const dest = scaffold(a, b);
        console.log('Created ' + dest + '\nNext: edit index.js, then `check ' + dest + '` and `pack ' + dest + '` (docs/plugins.md).');
    } else if (cmd === 'check') {
        if (!a) die('usage: node scripts/vetro-plugin.cjs check <folder>', 2);
        const r = pack(a);
        if (path.basename(path.resolve(a)) !== r.id) console.log('note: the folder is named ' + path.basename(path.resolve(a)) + ' but the id is ' + r.id + ' (installed folders take the id)');
        load(a, r.manifest);
        console.log('OK ' + r.id + ' ' + r.version + ' · ' + Object.keys(JSON.parse(r.text).files).length + ' files · ' + r.size + ' bytes');
        if (r.skipped.length) console.log('not bundled: ' + r.skipped.join(', '));
        if (r.manifest.permissions && r.manifest.permissions.length) console.log('asks for: ' + r.manifest.permissions.join(', ') + ' (shown to the user)');
    } else if (cmd === 'pack') {
        if (!a) die('usage: node scripts/vetro-plugin.cjs pack <folder> [outDir]', 2);
        const r = pack(a), file = path.join(b || '.', r.id + '-' + r.version + '.vplugin');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, r.text);
        console.log(file + '\nsha256 ' + r.sha256 + '\n' + r.size + ' bytes');
        console.log('\nPlugin list entry (or run `index` to write it for you):\n' + JSON.stringify(entryFor(r, 'dist/' + path.basename(file)), null, 2));
    } else if (cmd === 'index') {
        if (!a || !b) die('usage: node scripts/vetro-plugin.cjs index <index.json> <bundle.vplugin> [url]', 2);
        const text = fs.readFileSync(b, 'utf8'), bundle = JSON.parse(text);
        checkBundle(bundle);
        const list = fs.existsSync(a) ? JSON.parse(fs.readFileSync(a, 'utf8')) : { format: 'vetro-plugin-index', version: 1, plugins: [] };
        if (list.format !== 'vetro-plugin-index' || !Array.isArray(list.plugins)) die(a + ' is not a plugin list');
        const e = entryFor({ manifest: bundle.manifest, sha256: sha256(text) }, c || 'dist/' + path.basename(b));
        const at = list.plugins.findIndex(p => p.id === e.id);
        if (at >= 0) list.plugins[at] = e; else list.plugins.push(e);
        list.plugins.sort((x, y) => x.id < y.id ? -1 : 1);
        fs.writeFileSync(a, JSON.stringify(list, null, 2) + '\n');
        console.log((at >= 0 ? 'Updated ' : 'Added ') + e.id + ' ' + e.version + ' in ' + a + '\nCommit the list and ' + path.basename(b) + ' together.');
    } else if (cmd === 'keygen') {
        if (!a) die('usage: node scripts/vetro-plugin.cjs keygen <folder>', 2);
        const dir = path.resolve(a), priv = path.join(dir, 'plugin-list-private.pem');
        fs.mkdirSync(dir, { recursive: true });
        if (fs.existsSync(priv)) die('Refusing to overwrite ' + priv);
        const k = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
        fs.writeFileSync(priv, k.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
        const pubPem = k.publicKey.export({ type: 'spki', format: 'pem' });
        fs.writeFileSync(path.join(dir, 'plugin-list-public.pem'), pubPem);
        console.log('Private key: ' + priv + ' (never commit it; this is not the Vetro update key)\nPaste this into app/service/plugin-key.js as the exported string:\n\n' + pubPem);
    } else if (cmd === 'sign') {
        if (!a || !b) die('usage: node scripts/vetro-plugin.cjs sign <index.json> <private.pem> [dist-folder]', 2);
        const list = JSON.parse(fs.readFileSync(a, 'utf8')), key = fs.readFileSync(b, 'utf8'), base = c || path.join(path.dirname(a), 'dist');
        if (list.format !== 'vetro-plugin-index' || !Array.isArray(list.plugins)) die(a + ' is not a plugin list');
        list.plugins.forEach(e => {
            const file = path.join(base, path.basename(String(e.url || '')));
            const text = fs.readFileSync(file, 'utf8'), hash = sha256(text);
            if (hash !== e.sha256) throw new Error(e.id + ': the bundle ' + file + ' does not match the SHA-256 in the list');
            const m = JSON.parse(text).manifest;
            if (m.id !== e.id || m.version !== e.version) throw new Error(e.id + ': the bundle is ' + m.id + ' ' + m.version + ', not ' + e.version);
            e.signature = crypto.sign('RSA-SHA256', Buffer.from(signedText(e.id, e.version, hash)), key).toString('base64');
        });
        fs.writeFileSync(a, JSON.stringify(list, null, 2) + '\n');
        console.log('Signed ' + list.plugins.length + ' entr' + (list.plugins.length === 1 ? 'y' : 'ies') + ' in ' + a);
    } else {
        die('usage: node scripts/vetro-plugin.cjs new|check|pack|index|keygen|sign  (docs/plugins.md)', 2);
    }
} catch (e) { die('Error: ' + e.message); }
