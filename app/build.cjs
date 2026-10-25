'use strict';
// Dependency-free app-only ZIP builder. No signing or device integration.
const fs = require('fs');
const path = require('path');
const crc32 = require('./service/package-info.js').crc32;
// The dock's images live with its sources in ../dock/res and are packaged under native/dock/res.
function dockResources() {
    const root = path.join(__dirname, '..', 'dock', 'res'), found = [];
    (function walk(dir, rel) {
        fs.readdirSync(dir).sort().forEach(name => {
            const full = path.join(dir, name), next = rel ? rel + '/' + name : name;
            if (fs.statSync(full).isDirectory()) walk(full, next); else if (/\.(png|tsv)$/.test(name)) found.push(next);
        });
    })(root, '');
    return found.map(rel => ({name: 'native/dock/res/' + rel, source: path.join(root, rel)}));
}
const DEFAULT_PORT = 8099;
// Ports the package already uses for other things: the TV's remote WebSocket origins in config.xml.
const RESERVED_PORTS = [8001, 8002];
// The widget's access origin and probe page are fixed when the package is built, so the port is chosen here
// (VETRO_PORT=9000 node build.cjs). The service reads the same value from build-info.js.
function buildPort() {
    const raw = process.env.VETRO_PORT;
    if (raw === undefined || raw === '') return DEFAULT_PORT;
    const port = Number(raw);
    if (!/^\d+$/.test(raw) || port < 1024 || port > 65535 || RESERVED_PORTS.includes(port)) {
        throw new Error('VETRO_PORT must be a whole number from 1024 to 65535, not ' + RESERVED_PORTS.join(' or ') + ': ' + raw);
    }
    return port;
}
const PORT_FILES = ['config.xml', 'index.html'];
function collectFiles() {
    const dockFiles = dockResources();
    const port = buildPort();
    const names = ['config.xml', 'index.html', 'icon.png', 'native/TvState.dll', 'native/TvState.runtimeconfig.json',
        'native/dock/tvlauncher-dotnet.dll', 'native/dock/tvlauncher-dotnet.runtimeconfig.json'].concat(
        fs.readdirSync(path.join(__dirname,'service')).filter(name => name.endsWith('.js')).sort().map(name => 'service/' + name));
    const metadata = Object.assign({}, require('./service/build-info.js'));
    if (port !== DEFAULT_PORT) metadata.port = port;
    let revision = process.env.VETRO_SOURCE_REVISION;
    if (!revision) {
        try { revision = require('child_process').execFileSync('git', ['rev-parse', 'HEAD'], {cwd: __dirname, stdio: ['ignore','pipe','ignore']}).toString().trim(); } catch (_) {}
    }
    if (revision && /^[a-f0-9]{40}$/.test(revision)) metadata.sourceRevision = revision;
    // A revision alone does not show that the package matches it. Unknown when the revision is supplied from outside.
    if (!process.env.VETRO_SOURCE_REVISION && metadata.sourceRevision) {
        try { metadata.sourceDirty = require('child_process').execFileSync('git', ['status', '--porcelain', '--', '.', '../rooting'], {cwd: __dirname, stdio: ['ignore','pipe','ignore']}).toString().trim() !== ''; } catch (_) {}
    }
    return names.map(name => ({uri: encodeURIComponent(name), data: name === 'service/build-info.js'
        ? Buffer.from("'use strict';\nmodule.exports = " + JSON.stringify(metadata) + ';\n')
        : PORT_FILES.includes(name) && port !== DEFAULT_PORT
        ? Buffer.from(fs.readFileSync(path.join(__dirname,name),'utf8').replace(/\b8099\b/g, String(port)))
        : fs.readFileSync(path.join(__dirname,name))}))
        .concat(dockFiles.map(file => ({uri: encodeURIComponent(file.name), data: fs.readFileSync(file.source)})));
}
function zip(files) {
    const chunks = [], directory = []; let offset = 0;
    files.forEach(file => {
        const name = Buffer.from(decodeURIComponent(file.uri)); const data = Buffer.from(file.data);
        const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4);
        local.writeUInt32LE(crc32(data),14); local.writeUInt32LE(data.length,18); local.writeUInt32LE(data.length,22); local.writeUInt16LE(name.length,26);
        const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6);
        central.writeUInt32LE(crc32(data),16); central.writeUInt32LE(data.length,20); central.writeUInt32LE(data.length,24); central.writeUInt16LE(name.length,28); central.writeUInt32LE(offset,42);
        chunks.push(local,name,data); directory.push(central,name); offset += local.length + name.length + data.length;
    });
    const table = Buffer.concat(directory), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length,8); end.writeUInt16LE(files.length,10); end.writeUInt32LE(table.length,12); end.writeUInt32LE(offset,16);
    return Buffer.concat(chunks.concat([table,end]));
}
function build() {
    const output = process.env.OUT ? path.resolve(process.env.OUT) : path.join(__dirname,'dist','vetro-app-only.wgt');
    fs.mkdirSync(path.dirname(output),{recursive:true}); fs.writeFileSync(output,zip(collectFiles()));
    console.log('App-only unsigned package: ' + output);
    return output;
}
module.exports = {collectFiles: collectFiles, zip: zip, build: build};
if (require.main === module) build();
