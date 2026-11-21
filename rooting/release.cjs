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

// What never goes into a bundle: the Samsung package's own files (a file swap cannot change them) and the notices.
const PACKAGE_ONLY = /^(?:config\.xml|LICENSE|THIRD_PARTY_NOTICES\.md|notices\/[A-Za-z0-9_.-]+)$/;
// A TV checks the bundle with the updater it runs. Since 0.7.1 the bundle carries payload/net6 (unchanged since 0.5.0, so
// nothing to copy on a 0.7.0 TV): 0.5.x refuses any subfolder of payload/, so a TV still on 0.5.0 refuses the whole bundle
// when it checks it, before it writes anything, and installs with Apps2Samsung instead (#226; owner's call, 2026-11-21).

function buildBundle(privatePem) {
    const info = {};
    const all = collectIntegration().map(f => ({ name: decodeURIComponent(f.uri), data: f.data }));
    const files = all.filter(f => updater.okPath(f.name));
    // A file that is neither shipped nor package-only would be left behind on every TV without a word: stop instead.
    const lost = all.filter(f => !updater.okPath(f.name) && !PACKAGE_ONLY.test(f.name)).map(f => f.name);
    if (lost.length) throw new Error('Files the updater refuses, so no update would carry them: ' + lost.join(', '));
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
    // And what each published version still on TVs does with it (refuses at once, or applies it in one 64 KiB script).
    checkReach(built.raw, publicPem).forEach(line => console.log(line));
    const keyInPackage = require('../app/service/update-key.js');
    if (keyInPackage && keyInPackage.trim() !== publicPem.trim()) throw new Error('This key does not match app/service/update-key.js: TVs would refuse the bundle');
    if (!require('../app/service/plugin-key.js')) console.warn('Warning: app/service/plugin-key.js has no key, so unsigned plugins require Developer mode (this is a different key from the update key)');
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

// A TV runs the updater of the version it is on, so a bundle is checked with each published one (update-size.cjs):
// - 0.7.0 must accept it (paths, file count, size) and fit its apply script in the root agent's 64 KiB;
// - 0.5.0 must refuse it when it checks it, or fit too: a 0.5.0 that applies an oversized bundle fails at the root agent
//   after it has already rewritten its Go back list.
// Throws when one of these does not hold; otherwise returns one line per version for the release log.
function checkReach(raw, publicPem) {
    const size = require('./update-size.cjs');
    const parsed = JSON.parse(raw), shipped = Object.keys(parsed.files).map(n => ({ name: n, data: Buffer.from(parsed.files[n], 'base64') }));
    const lines = [];
    require('./tests/fixtures/update-from-070/updater.js').verifyBundle(raw, publicPem);
    // The Update Vetro tile of the TV page downloads at most 8 MiB of bundle text (BUNDLE_MAX in 0.7.0's screen-controls.js).
    if (Buffer.byteLength(raw) > 8 * 1024 * 1024) throw new Error('The bundle is ' + Buffer.byteLength(raw) + ' bytes: the Update Vetro tile of 0.7.0 takes 8 MiB at most');
    const from070 = size.measure(shipped, '0.7.0');
    const over = from070.filter(r => r.margin <= 0);
    if (over.length) throw new Error('A TV on 0.7.0 could not apply this bundle: ' + over.map(r => r.changed + ' files, ' + r.bytes + ' bytes').join('; ') + ' (limit ' + size.LIMIT + '). Fewer changed files, or leave 0.7.0 behind too');
    lines.push('from 0.7.0: ' + from070.map(r => r.changed + ' files differ (' + r.existing + ' changed, ' + r.added + ' new), script ' + r.bytes + ' bytes, margin ' + r.margin).join('; '));
    const refused = size.refused(shipped, '0.5.0');
    if (refused.length) lines.push('from 0.5.0: refused when checked ("Path not allowed in an update: ' + refused[0] + '"); those TVs install with Apps2Samsung');
    else {
        const from050 = size.measure(shipped, '0.5.0'), bad = from050.filter(r => r.margin <= 0);
        if (bad.length) throw new Error('A TV on 0.5.0 would accept this bundle and then fail to apply it (' + bad.map(r => r.bytes + ' bytes').join(', ') + '): ship a payload subfolder so that it refuses it at the check');
        lines.push('from 0.5.0: fits (margin ' + Math.min.apply(null, from050.map(r => r.margin)) + ')');
    }
    return lines;
}

module.exports = { buildBundle, checkReach, keygen, build };
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
