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
    const files = require('../app/build.cjs').collectFiles().filter(file => decodeURIComponent(file.uri) !== 'service/platform.js');
    ['platform.js','adb.js','sdb.js','tar.js','root-agent.js','debloat-commands.js','sdb-tunnel.js'].forEach(name => {
        files.push({uri: encodeURIComponent('service/' + name), data: fs.readFileSync(path.join(__dirname,'service',name))});
    });
    fs.readdirSync(path.join(__dirname,'payload')).sort().forEach(name => {
        files.push({uri: encodeURIComponent('payload/' + name), data: fs.readFileSync(path.join(__dirname,'payload',name))});
    });
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