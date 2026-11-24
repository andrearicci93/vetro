'use strict';
const fs = require('fs');
const path = require('path');
const spawnSync = require('child_process').spawnSync;
const tests = fs.readdirSync(__dirname).filter(name => name.endsWith('.test.cjs')).sort();
for (const name of tests) {
  console.log('\n' + name);
  const result = spawnSync(process.execPath, [path.join(__dirname, name)], {stdio: 'inherit', timeout: 120000});
  if (result.error || result.status !== 0) {
    if (result.error) console.error(result.error.message);
    process.exit(1);
  }
}
console.log('\nPASS ' + tests.length + ' test suites');
