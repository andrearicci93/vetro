'use strict';

// Builds the full Vetro package from app sources + TV platform adapter.
// It never touches the TV.

const fs = require('fs');
const path = require('path');
const signingRequire = require('module').createRequire(path.join(__dirname,'on-boot-probe','package.json'));

const ROOT = path.join(__dirname,'..','app');
const CERTS = path.join(__dirname, 'on-boot-probe', 'certs');
const DIST = path.join(__dirname, 'dist');
const OUT = process.env.OUT ? path.resolve(process.env.OUT) : path.join(DIST, 'vetro.wgt');
const DIST_P12 = process.env.DIST_P12
    ? path.resolve(process.env.DIST_P12)
    : path.join(CERTS, 'samsung', 'distributor.p12');
const AUTHOR_P12 = process.env.AUTHOR_P12
    ? path.resolve(process.env.AUTHOR_P12)
    : path.join(CERTS, 'samsung', 'author.p12');

const AUTHOR_PW = process.env.AUTHOR_PW;
const DISTRIBUTOR_PW = process.env.DIST_PW;

function collectIntegration() {
    const method = process.env.VETRO_ROOT_METHOD || 'archive';
    if (!['archive', 'external-root'].includes(method)) throw new Error('Unknown VETRO_ROOT_METHOD');
    const external = method === 'external-root';
    const files = require('../app/build.cjs').collectFiles().filter(file => decodeURIComponent(file.uri) !== 'service/platform.js');
    const services = external
        ? ['external-root-platform.js', 'root-agent.js', 'node-root-agent.js', 'shell-executor.js', 'shell-worker.sh',
            'remote-pc-content.js', 'remote-pc-smack.js', 'remote-pc-deadline.js']
        : ['platform.js','adb.js','sdb.js','tar.js','root-agent.js','debloat-commands.js','sdb-tunnel.js','root-preflight.js','root-preflight-capture.js','retry-policy.js'];
    services.forEach(name => {
        const target = name === 'external-root-platform.js' ? 'platform.js' : name;
        files.push({uri: encodeURIComponent('service/' + target), data: fs.readFileSync(path.join(__dirname,'service',name))});
    });
    if (external) {
        const info = files.find(file => decodeURIComponent(file.uri) === 'service/build-info.js');
        const context = {module: {exports: {}}};
        require('vm').runInNewContext(info.data.toString(), context);
        const smack = process.env.VETRO_EXTERNAL_SMACK || 'none';
        if (!['none', 'agent-write', 'both-write'].includes(smack)) throw new Error('Unknown VETRO_EXTERNAL_SMACK');
        if (process.env.VETRO_EXTERNAL_AUTO_RENEW && !['0', '1'].includes(process.env.VETRO_EXTERNAL_AUTO_RENEW)) {
            throw new Error('VETRO_EXTERNAL_AUTO_RENEW must be 0 or 1');
        }
        const metadata = Object.assign({}, context.module.exports, {rootMethod: 'external-root',
            externalRoot: {autoRenew: process.env.VETRO_EXTERNAL_AUTO_RENEW === '1', smack: smack}});
        info.data = Buffer.from("'use strict';\nmodule.exports = " + JSON.stringify(metadata) + ';\n');
        // No archive exploit or native root payloads in this first backend slice.
        return files;
    }
    function addPayloads(relative) {
        const directory = path.join(__dirname, relative);
        fs.readdirSync(directory).sort().forEach(name => {
            const next = relative + '/' + name;
            if (fs.statSync(path.join(__dirname, next)).isDirectory()) addPayloads(next);
            else files.push({uri: encodeURIComponent(next), data: fs.readFileSync(path.join(__dirname, next))});
        });
    }
    addPayloads('payload');
    files.push({uri: encodeURIComponent('notices/LICENSE-samsung-tv-root.txt'), data: fs.readFileSync(path.join(__dirname, 'tools/samsung-tv-root-master/LICENSE'))});
    return files;
}

function loadP12(der, password, forge) {
    return forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), false, password);
}

async function main() {
    if (!process.env.AUTHOR_P12 || !process.env.DIST_P12 || !AUTHOR_PW || !DISTRIBUTOR_PW) {
        throw new Error('Set AUTHOR_P12, DIST_P12, AUTHOR_PW and DIST_PW using your own signing profile');
    }
    const forge = signingRequire('node-forge');
    const JSZip = signingRequire('jszip');
    const { Signature } = signingRequire('tizen');
    const authorDer = fs.readFileSync(AUTHOR_P12).toString('binary');
    const distributorDer = fs.readFileSync(DIST_P12).toString('binary');

    const author = loadP12(authorDer, AUTHOR_PW, forge);
    const distributor = loadP12(distributorDer, DISTRIBUTOR_PW, forge);

    const contents = collectIntegration();

    const authored = await new Signature('AuthorSignature', contents).sign(author);
    const signed = await new Signature('DistributorSignature', authored).sign(distributor);

    const zip = new JSZip();
    for (const file of signed) zip.file(decodeURIComponent(file.uri), file.data);
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    fs.mkdirSync(DIST, { recursive: true });
    fs.writeFileSync(OUT, buffer);

    console.log('signed files:');
    for (const name of signed.map((f) => decodeURIComponent(f.uri)).sort()) console.log('  ' + name);
    console.log('wrote ' + OUT + ' (' + buffer.length + ' bytes)');
}

module.exports = {collectIntegration, main};
if (require.main === module) main().catch((error) => {
    console.error(error);
    process.exit(1);
});
