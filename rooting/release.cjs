'use strict';

// Release tooling for self-update (app/docs/UPDATING.md). Runs on the maintainer's computer, never on the TV.
//   node release.cjs keygen <folder>   make the update signing key pair (keep update-private.pem offline)
//   node release.cjs build <folder>    write vetro-update-<version>.json and update-index.json, signed with VETRO_UPDATE_KEY
// The bundle holds the same files as the integration package (app + root adapter + payload) minus what a file swap
// cannot change (config.xml, signatures). It carries no Samsung certificate and is useless without the TV's own install.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const updater = require('../app/service/updater.js');
const { collectIntegration } = require('./build.cjs');

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

function keygen(folder) {
    if (!folder) throw new Error('Usage: node release.cjs keygen <folder>');
    const dir = path.resolve(folder);
    fs.mkdirSync(dir, { recursive: true });
    const privateFile = path.join(dir, 'update-private.pem');
    if (fs.existsSync(privateFile)) throw new Error('Refusing to overwrite ' + privateFile);
    const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
    fs.writeFileSync(privateFile, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' });
    fs.writeFileSync(path.join(dir, 'update-public.pem'), publicPem);
    console.log('Private key: ' + privateFile + '  (never commit it; keep a backup offline)');
    console.log('Paste this into app/service/update-key.js as the exported string:\n');
    console.log(publicPem);
}

function buildBundle(privatePem) {
    const info = {};
    const all = collectIntegration().map(f => ({ name: decodeURIComponent(f.uri), data: f.data }));
    const files = all.filter(f => updater.okPath(f.name));
    const infoFile = files.find(f => f.name === 'service/build-info.js');
    Object.assign(info, updater.parseBuildInfo(infoFile.data));
    if (!info.version || !(info.shell >= 1)) throw new Error('build-info.js has no version or shell');
    if (info.port) throw new Error('Build without VETRO_PORT: an update must carry the default port (each TV keeps its own)');
    const manifest = { format: updater.FORMAT, v: 1, version: info.version, shell: info.shell, files: {} };
    const body = {};
    files.sort((a, b) => a.name < b.name ? -1 : 1).forEach(f => {
        manifest.files[f.name] = { sha256: sha256(f.data), size: f.data.length };
        body[f.name] = f.data.toString('base64');
    });
    const text = JSON.stringify(manifest);
    const signature = crypto.sign('RSA-SHA256', Buffer.from(text), privatePem).toString('base64');
    return { info, raw: JSON.stringify({ format: updater.FORMAT, v: 1, manifest: text, signature, files: body }) };
}

function build(folder) {
    if (!folder) throw new Error('Usage: node release.cjs build <folder>');
    if (!process.env.VETRO_UPDATE_KEY) throw new Error('Set VETRO_UPDATE_KEY to the path of update-private.pem');
    const privatePem = fs.readFileSync(path.resolve(process.env.VETRO_UPDATE_KEY), 'utf8');
    const publicPem = crypto.createPublicKey(privatePem).export({ type: 'spki', format: 'pem' });
    const built = buildBundle(privatePem);
    // Check what was just written exactly as a TV would.
    updater.verifyBundle(built.raw, publicPem);
    const keyInPackage = require('../app/service/update-key.js');
    if (keyInPackage && keyInPackage.trim() !== publicPem.trim()) throw new Error('This key does not match app/service/update-key.js: TVs would refuse the bundle');
    if (!require('../app/service/plugin-key.js')) console.warn('Warning: app/service/plugin-key.js has no key, so plugins install without a signature check (this is a different key from the update key)');
    if (!keyInPackage) console.warn('Warning: app/service/update-key.js has no key yet, so no installed Vetro will accept this bundle');
    const dir = path.resolve(folder);
    fs.mkdirSync(dir, { recursive: true });
    const name = 'vetro-update-' + built.info.version + '.json';
    fs.writeFileSync(path.join(dir, name), built.raw);
    const index = { version: built.info.version, shell: built.info.shell, file: name, sha256: sha256(Buffer.from(built.raw)), size: Buffer.byteLength(built.raw) };
    fs.writeFileSync(path.join(dir, 'update-index.json'), JSON.stringify(index, null, 2) + '\n');
    console.log('wrote ' + path.join(dir, name) + ' (' + index.size + ' bytes, sha256 ' + index.sha256 + ')');
    console.log('wrote ' + path.join(dir, 'update-index.json'));
}

module.exports = { buildBundle, keygen, build };
if (require.main === module) {
    try {
        const [command, folder] = process.argv.slice(2);
        if (command === 'keygen') keygen(folder);
        else if (command === 'build') build(folder);
        else throw new Error('Usage: node release.cjs keygen|build <folder>');
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}
