'use strict';
// Apps2Samsung patches the port by searching these exact phrases (packages/andrearicci93__vetro.json in
// Apps2Samsung/tizen-community-packages). If one is missing or appears twice, the A2S install fails or patches the wrong place.
// Each phrase must appear exactly once in its file, in the package built with the default port.
const assert = require('assert').strict;
const build = require('../build.cjs');
const files = build.collectFiles();
const text = name => files.find(file => decodeURIComponent(file.uri) === name).data.toString();
const phrases = [
    ['config.xml', '<access origin="http://127.0.0.1:8099" subdomains="false"/>'],
    ['index.html', "var BASE = 'http://127.0.0.1:8099';"],
    ['index.html', 'Dashboard at <code>http://&lt;TV&gt;:8099/</code>'],
    ['index.html', 'did not answer on port 8099.'],
    ['service/main.js', '|| buildInfo.port || 8099;']
];
phrases.forEach(([name, phrase]) => {
    const count = text(name).split(phrase).length - 1;
    assert.equal(count, 1, 'Apps2Samsung port phrase must appear exactly once in ' + name + ': ' + phrase + ' (found ' + count + ')');
});
console.log('ok a2s port phrases');
