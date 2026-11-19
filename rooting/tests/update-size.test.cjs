'use strict';
// The update from 0.5.0 must fit the root agent's 64 KiB (see ../update-size.cjs): fails before a commit pushes it over.
const assert = require('assert').strict;
const { measure, LIMIT } = require('../update-size.cjs');
const { collectIntegration } = require('../build.cjs');

process.env.VETRO_SOURCE_REVISION = '0'.repeat(40);
const files = collectIntegration().map(f => ({ name: decodeURIComponent(f.uri), data: Buffer.from(f.data) }));
const report = measure(files);
report.forEach(r => assert.ok(r.bytes < LIMIT, 'the update script from 0.5.0 build ' + r.build + ' is ' + r.bytes + ' bytes, over the 64 KiB the root agent takes. ' +
    'Move the change into a file 0.7.0 already changes, or keep it for a later release.'));
console.log('PASS update from 0.5.0 fits: ' + report.map(r => r.build + ': ' + r.changed + ' files (' + r.existing + ' changed, ' + r.added + ' new), ' + r.bytes + ' bytes, margin ' + r.margin).join('; '));
