'use strict';
const assert = require('assert').strict;
const html = require('../service/dashboard.js')({});
assert.match(html, /<nav aria-label="Vetro"><button data-tab="plugins"/);
assert.match(html, /<section id="plugins" hidden>/);
assert.match(html, /function loadPlugins\(\)\{var changed=true;return api\('\/plugins'\)/);
assert.match(html, /if\(changed\)renderPlugins\(\)/, 'polling repaints only when the list changed');
assert.match(html, /'\/plugins\/'\+encodeURIComponent\(id\)\+'\/'\+\(on\?'enable':'disable'\)/);
assert.match(html, /data-plugin-resume/);
assert.match(html, /function installFromRegistry/);
assert.match(html, /'\/plugins\/install'/);
assert.match(html, /function renderPluginNav/);
assert.match(html, /confirm\('Remove '\+rid\+/, 'removing asks first');
assert.match(html, /The list gives no SHA-256/, 'registry installs need a checksum');
assert.match(html, /u\.protocol!=='https:'/, 'registry downloads are https only');
assert.match(html, /data-plugin-warning/, 'third-party warning is always on the page');
assert.match(html, /takes no responsibility/);
assert.match(html, /spot-checked, not audited/);
assert.match(html, /function confirmPlugin/, 'installs and updates ask first');
assert.match(html, /function pluginUpdate/, 'installed plugins show a newer version from the list');
assert.match(html, /registryChecked=true;loadRegistry\(\)/, 'the list is read once when the page opens');
assert.match(html, /rerun:have&&have\.state==='running'/, 'updating a running plugin turns it off and back on');
assert.match(html, /The plugin list is not published yet/);
assert.match(html, /The new version could not start/, 'a failed update start is not reported as running');
assert.match(html, /The previous version is running again/, 'a refused update puts the old version back');
assert.match(html, /f\.size>528384/, 'the file picker uses the host limit');
assert.match(html, /It could not start: /, 'a plugin that fails to start is not reported as done');
assert.match(html, /Could not refresh the plugins/, 'a failed refresh does not leave stale data unannounced');
assert.match(html, /not \x27\+e\.id|not '\+e\.id/, 'the downloaded bundle must be the one the list names');
assert.match(html, /\/session',\{\}\)\.then\(function\(d\)\{if\(pluginView===id\)\$\('pluginFrame'\)\.src=d\.path/, 'a plugin page is opened with its own session URL');
assert.match(html, /id="pluginFrame"[^>]*sandbox="allow-scripts"/);
console.log('plugins page: ok');

// Vetro's own features are not plugins: the MQTT bridge is started by main.js itself.
const main = require('fs').readFileSync(require('path').join(__dirname, '..', 'service', 'main.js'), 'utf8');
assert.match(main, /\nbridge\.start\(\);\n/, 'main.js must start the MQTT bridge');
assert.ok(!/plugin-mqtt/.test(main), 'MQTT is not a plugin');

// Sign-in: a sandboxed plugin page cannot send the dashboard's cookie, so its session URL must reach the plugin host before the gate.
const mainSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'service', 'main.js'), 'utf8');
const scopedAt = mainSrc.indexOf("/s\\/[0-9a-f]{32}\\/api");
const gateAt = mainSrc.indexOf('auth.gate(req, res, url');
assert.ok(scopedAt > 0 && gateAt > 0 && scopedAt < gateAt, 'plugin session URLs are routed before the sign-in gate');
console.log('plugin sessions: ok');
