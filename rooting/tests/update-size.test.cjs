'use strict';
// Each published version writes its own apply script, which must fit the root agent's 64 KiB (see ../update-size.cjs):
// - from 0.7.0 (cumulative: a TV left on 0.7.0 goes straight to whatever is published), fails before a commit pushes it over;
// - from 0.5.0 the bundle must be refused at the check (payload/net6) rather than fail half way;
// - the updater of this tree (0.7.1 and later) fits every file of the package changed, and a full MAX_FILES bundle.
const assert = require('assert').strict;
const { measure, refused, current, LIMIT } = require('../update-size.cjs');
const { collectIntegration } = require('../build.cjs');

process.env.VETRO_SOURCE_REVISION = '0'.repeat(40);
const files = collectIntegration().map(f => ({ name: decodeURIComponent(f.uri), data: Buffer.from(f.data) }));

const from070 = measure(files, '0.7.0');
from070.forEach(r => assert.ok(r.bytes < LIMIT, 'the update script from 0.7.0 is ' + r.bytes + ' bytes for ' + r.changed + ' changed files, over the 64 KiB ' +
    'the root agent takes. Every file that differs from 0.7.0 costs about 1 KB, whichever release changed it: change fewer files, or leave 0.7.0 behind.'));

const from050 = refused(files, '0.5.0');
assert.ok(from050.some(n => /^payload\/net6\//.test(n)), 'a TV on 0.5.0 must refuse the bundle at the check (payload/net6), not fail while applying it');

const whole = current(files);
assert.ok(whole.margin > 0, 'with every file changed this updater writes ' + whole.bytes + ' bytes (Go back ' + whole.rollbackBytes + ')');
// A full bundle (MAX_FILES = 300) whose names are the shipped ones, each made 4 characters longer to tell them apart.
const shipped = files.map(f => f.name).filter(n => /^(?:service|native|payload)\//.test(n));
const many = [];
for (let i = 0; i < 300; i++) { const n = shipped[i % shipped.length]; many.push({ name: n.replace(/(\.[a-z]+)?$/, '-' + String(i).padStart(3, '0') + '$1'), data: Buffer.from('f' + i) }); }
const full = current(many);
const avg = Math.round(many.reduce((t, f) => t + f.name.length, 0) / many.length);
assert.ok(full.margin > 0, 'a 300-file bundle needs ' + full.bytes + ' bytes (Go back ' + full.rollbackBytes + ')');

console.log('PASS update scripts fit: from 0.7.0 ' + from070.map(r => r.changed + ' files (' + r.existing + ' changed, ' + r.added + ' new), ' + r.bytes + ' bytes, margin ' + r.margin).join('; ') +
    '; from 0.5.0 refused at the check (' + from050[0] + '); this updater, all ' + whole.files + ' files changed: ' + whole.bytes + ' bytes (Go back ' + whole.rollbackBytes + '), 300 files of ' +
    avg + ' characters on average: ' + full.bytes + ' bytes (Go back ' + full.rollbackBytes + ')');
