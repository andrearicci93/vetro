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
    const rootMethod = process.env.VETRO_ROOT_METHOD || 'archive';
    if (rootMethod !== 'archive' && rootMethod !== 'remote-pc') throw new Error('Unknown VETRO_ROOT_METHOD');
    const remotePcMode = process.env.VETRO_REMOTE_PC_MODE || 'diagnostics';
    if (rootMethod === 'remote-pc' && !['diagnostics', 'manual', 'automatic'].includes(remotePcMode)) {
        throw new Error('VETRO_REMOTE_PC_MODE must be diagnostics, manual or automatic');
    }
    const files = require('../app/build.cjs').collectFiles().filter(file => decodeURIComponent(file.uri) !== 'service/platform.js');
    if (rootMethod === 'remote-pc') {
        const dockManifest = JSON.parse(fs.readFileSync(path.join(__dirname,'dock55','build-manifest.json'),'utf8'));
        const compiled = JSON.parse(fs.readFileSync(path.join(__dirname,'payload55','build-manifest.json'),'utf8'));
        const digest = file => require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
        if (dockManifest.target !== 'netcoreapp3.0' || dockManifest.dllSha256 !== digest(path.join(__dirname,'dock55','tvlauncher-dotnet.dll')) ||
            Object.keys(dockManifest.sources).some(name => dockManifest.sources[name] !== digest(path.join(__dirname,'..',name)))) {
            throw new Error('Rebuild the Tizen 5.5 launcher: its source or binary differs from the build manifest');
        }
        const stateManifest=JSON.parse(fs.readFileSync(path.join(__dirname,'state55','build-manifest.json'),'utf8'));
        if(stateManifest.target!=='netcoreapp3.0' || stateManifest.dllSha256!==digest(path.join(__dirname,'state55','TvState.dll')) || Object.keys(stateManifest.sources).some(name=>stateManifest.sources[name]!==digest(path.join(__dirname,'..',name)))) throw new Error('Rebuild the Tizen 5.5 state reader');
        files.forEach(file => {
            const name = decodeURIComponent(file.uri);
            if (/^native\/TvState\.(dll|runtimeconfig\.json)$/.test(name)) file.data=fs.readFileSync(path.join(__dirname,'state55',path.basename(name)));
            if (/^native\/dock\/tvlauncher-dotnet\.(dll|runtimeconfig\.json)$/.test(name)) file.data = fs.readFileSync(path.join(__dirname,'dock55',path.basename(name)));
        });
        if (compiled.target !== 'netcoreapp3.0' || compiled.sourceSha256 !== digest(path.join(__dirname,'payload','SamsungTvRemoteInputAgent.cs')) ||
            compiled.dllSha256 !== digest(path.join(__dirname,'payload55','SamsungTvRemoteInputAgent.dll'))) {
            throw new Error('Rebuild the Tizen 5.5 input helper: its source or binary differs from the build manifest');
        }
    }
    ['platform.js','adb.js','sdb.js','tar.js','root-agent.js','debloat-commands.js'].forEach(name => {
        const source = name === 'platform.js' && rootMethod === 'remote-pc' ? 'remote-pc-platform.js' : name;
        files.push({uri: encodeURIComponent('service/' + name), data: fs.readFileSync(path.join(__dirname,'service',source))});
    });
    if (rootMethod === 'remote-pc') ['node-root-agent.js', 'shell-executor.js', 'shell-worker.sh'].forEach(name => {
        files.push({uri: encodeURIComponent('service/' + name), data: fs.readFileSync(path.join(__dirname,'service',name))});
    });
    if (rootMethod === 'remote-pc') {
        const metadata = files.find(file => decodeURIComponent(file.uri) === 'service/build-info.js');
        const flags = {rootMethod: 'remote-pc', remotePcMode, inputRuntime: 'tizen55', restoreInput: remotePcMode !== 'diagnostics', restorePreferences: remotePcMode !== 'diagnostics',
            readOnly: remotePcMode === 'diagnostics', automaticRestore: remotePcMode === 'automatic'};
        metadata.data = Buffer.concat([metadata.data, Buffer.from('\nObject.assign(module.exports, ' + JSON.stringify(flags) + ');\n')]);
    }
    fs.readdirSync(path.join(__dirname,'payload')).sort().forEach(name => {
        const inputVariant = rootMethod === 'remote-pc' && /^SamsungTvRemoteInputAgent\.(dll|runtimeconfig\.json)$/.test(name);
        files.push({uri: encodeURIComponent('payload/' + name), data: fs.readFileSync(path.join(__dirname,inputVariant ? 'payload55' : 'payload',name))});
    });
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
