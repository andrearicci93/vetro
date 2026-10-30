'use strict';
const assert = require('assert').strict;
const html = require('../service/dashboard.js')({});
assert.match(html, /<nav aria-label="Vetro"><button data-tab="plugins"/);
assert.match(html, /<section id="plugins" hidden>/);
assert.match(html, /function loadPlugins\(\)\{return api\('\/plugins'\)/);
assert.match(html, /'\/plugins\/'\+encodeURIComponent\(id\)\+'\/'\+\(on\?'enable':'disable'\)/);
assert.match(html, /data-plugin-resume/);
assert.match(html, /function installFromRegistry/);
assert.match(html, /'\/plugins\/install'/);
assert.match(html, /function renderPluginNav/);
assert.match(html, /id="pluginFrame"[^>]*sandbox="allow-scripts"/);
console.log('plugins page: ok');

// Vetro's own features are not plugins: the MQTT bridge is started by main.js itself.
const main = require('fs').readFileSync(require('path').join(__dirname, '..', 'service', 'main.js'), 'utf8');
assert.match(main, /\nbridge\.start\(\);\n/, 'main.js must start the MQTT bridge');
assert.ok(!/plugin-mqtt/.test(main), 'MQTT is not a plugin');
