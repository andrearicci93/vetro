'use strict';
const assert = require('assert').strict;
const build = require('../build.cjs');
const info = require('../service/package-info.js');
const files = build.collectFiles(); const names = files.map(file => decodeURIComponent(file.uri));
assert.ok(names.includes('service/platform.js'));
const dockRes = names.filter(name => name.startsWith('native/dock/res/'));
['chev_down', 'chev_up', 'dock_bg', 'dock_glow', 'dock_glow_pill', 'dock_ring', 'glass_tile', 'shadow', 'icons/settings', 'icons/samsunghome', 'icons/livetv', 'icons/in-tv'].forEach(
    base => assert.ok(dockRes.includes('native/dock/res/' + base + '.png'), 'dock image packaged: ' + base));
assert.ok(dockRes.includes('native/dock/res/inputs.tsv'));
assert.ok(dockRes.every(name => /\.(png|tsv)$/.test(name)), 'only images and the inputs list are packaged from dock/res');
assert.deepEqual(names.filter(name => !name.startsWith('native/dock/res/')).sort(), [
    'config.xml', 'icon.png', 'index.html', 'native/TvState.dll', 'native/TvState.runtimeconfig.json', 'service/tv-state.js',
    'native/dock/tvlauncher-dotnet.dll', 'native/dock/tvlauncher-dotnet.runtimeconfig.json', 'service/dock.js', 'service/dock-catalog.js',
    'service/auth.js', 'service/build-info.js', 'service/blocklist.js', 'service/exec-error.js', 'service/app-catalog.js', 'service/app-facts.js', 'service/app-groups.js','service/app-registry.js', 'service/dashboard.js', 'service/physical-input.js', 'service/presence.js', 'service/apps.js', 'service/component-actions.js','service/control.js',     'service/debloat.js', 'service/diagnostic-report.js', 'service/hbbtv.js','service/home-order.js','service/local-dns.js','service/menu-settings.js','service/main.js',
    'service/mqtt-bridge.js', 'service/mqtt.js', 'service/package-info.js',
    'service/platform.js', 'service/privacy.js', 'service/probe.js', 'service/quick-settings.js', 'service/quick-wins.js', 'service/leftovers.js', 'service/remap.js',
    'service/samsung-remote.js', 'service/settings.js', 'service/system-monitor.js','service/tv-settings.js'
].sort());
const metadata = files.find(file => decodeURIComponent(file.uri) === 'service/build-info.js').data.toString();
const context = {module: {exports: {}}};
require('vm').runInNewContext(metadata, context);
assert.equal(context.module.exports.version, require('../package.json').version);
assert.ok(context.module.exports.sourceRevision === null || /^[a-f0-9]{40}$/.test(context.module.exports.sourceRevision));
assert.ok(context.module.exports.sourceDirty === null || typeof context.module.exports.sourceDirty === 'boolean');
const platform = files.find(file => decodeURIComponent(file.uri) === 'service/platform.js').data.toString();
assert.ok(platform.includes('app-only'));
// The port is fixed at build time: the default package is untouched, a chosen port reaches the widget's access origin,
// the probe page and the service, and a port the package already uses is refused.
const text = (list, name) => list.find(file => decodeURIComponent(file.uri) === name).data.toString();
assert.ok(text(files, 'config.xml').includes('http://127.0.0.1:8099"'));
assert.ok(text(files, 'index.html').includes("var BASE = 'http://127.0.0.1:8099'"));
assert.ok(!('port' in context.module.exports), 'the default build records no port');
process.env.VETRO_PORT = '9123';
try {
    const custom = build.collectFiles();
    assert.ok(text(custom, 'config.xml').includes('<access origin="http://127.0.0.1:9123" subdomains="false"/>'));
    assert.ok(text(custom, 'config.xml').includes('ws://127.0.0.1:8001'), 'other ports in config.xml are left alone');
    assert.ok(!/8099/.test(text(custom, 'config.xml') + text(custom, 'index.html')), 'no leftover default port in the widget');
    assert.ok(text(custom, 'index.html').includes("var BASE = 'http://127.0.0.1:9123'"));
    const customInfo = {module: {exports: {}}};
    require('vm').runInNewContext(text(custom, 'service/build-info.js'), customInfo);
    assert.equal(customInfo.module.exports.port, 9123);
    ['80', '70000', '8001', '8002', 'abc', '9000.5', '-9000'].forEach(bad => {
        process.env.VETRO_PORT = bad;
        assert.throws(() => build.collectFiles(), /VETRO_PORT/, 'refused: ' + bad);
    });
} finally { delete process.env.VETRO_PORT; }
info.fromBuffer(build.zip(files)).then(result => {
    assert.equal(result.packageId,'vetrotvapp'); console.log('PASS standalone package: app adapter only, valid WGT manifest');
}).catch(error => {console.error(error);process.exitCode=1;});
