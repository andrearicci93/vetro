'use strict';
// Unsigned package plus identical unpacked tree for a temporary SDB test.
const fs = require('fs');
const path = require('path');
process.env.VETRO_ROOT_METHOD = 'remote-pc';
const files = require('../build.cjs').collectIntegration();
files.push({uri: encodeURIComponent('service/q74t-prototype-start.js'),
    data: fs.readFileSync(path.join(__dirname, '../service/q74t-prototype-start.js'))});
const destination = path.resolve(process.argv[2] || path.join(__dirname, '../dist/q74t-prototype'));
fs.mkdirSync(destination, {recursive: true});
for (const file of files) {
    const target = path.join(destination, decodeURIComponent(file.uri));
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, file.data);
}
const wgt = destination + '-unsigned.wgt';
fs.writeFileSync(wgt, require('../../app/build.cjs').zip(files));
console.log(JSON.stringify({directory: destination, unsignedPackage: wgt, files: files.length,
    rootMethod: 'remote-pc', remotePcMode: process.env.VETRO_REMOTE_PC_MODE || 'diagnostics',
    readOnly: !process.env.VETRO_REMOTE_PC_MODE || process.env.VETRO_REMOTE_PC_MODE === 'diagnostics', signed: false}));
