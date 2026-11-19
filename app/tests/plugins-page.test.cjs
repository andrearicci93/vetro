'use strict';
const assert = require('assert').strict;
const html = require('../service/dashboard.js')({});
assert.match(html, /Vetro UI<\/button><button data-tab="plugins"/, 'Vetro Shards sits right under Vetro UI, above the Remapper (Vetro UI holds the launcher and the tuner)');
assert.doesNotMatch(html, /aria-label="Vetro"|id="pluginNav"|data-plugin-page/, 'no Vetro group and no plugin entries in the sidebar');
assert.match(html, /id="pluginTabs"[^>]*role="tablist"/, 'running plugins become horizontal tabs inside the Plugins page');
assert.match(html, /function showPluginTab/);
assert.match(html, /<section id="plugins" hidden>/);
assert.match(html, /function loadPlugins\(force\)\{var changed=true;return api\('\/plugins'\)/);
assert.match(html, /if\(changed\|\|force\)renderPlugins\(\)/, 'polling repaints only when the list changed; after an action the page is always repainted, so its switches unlock');
assert.match(html, /if\(changed\)\{renderQuick\(\);renderPluginTabs\(\);noticeDots\(\)\}/, 'the poll leaves the other pages alone while nothing changed');
assert.match(html, /'\/plugins\/'\+encodeURIComponent\(id\)\+'\/'\+\(on\?'enable':'disable'\)/);
assert.match(html, /data-plugin-resume/);
assert.match(html, /function installFromRegistry/);
assert.match(html, /'\/plugins\/install'/);
assert.match(html, /function renderPluginTabs/);
assert.match(html, /ArrowRight/, 'tabs answer the arrow keys');
assert.match(html, /confirm\('Remove '\+rid\+/, 'removing asks first');
assert.match(html, /The catalog gives no SHA-256/, 'registry installs need a checksum');
assert.match(html, /u\.protocol!=='https:'/, 'registry downloads are https only');
assert.match(html, /data-plugin-warning/, 'third-party warning is always on the page');
assert.match(html, /takes no responsibility/);
assert.match(html, /not audited/);
assert.match(html, /function confirmPlugin/, 'installs and updates ask first');
assert.match(html, /function pluginUpdate/, 'installed plugins show a newer version from the list');
assert.match(html, /registryChecked=true;loadRegistry\(\)/, 'the list is read once when the page opens');
assert.match(html, /rerun:have&&have\.state==='running'/, 'updating a running plugin turns it off and back on');
assert.match(html, /The catalog is not published yet/);
assert.match(html, /The new version could not start/, 'a failed update start is not reported as running');
assert.match(html, /The previous version is running again/, 'a refused update puts the old version back');
assert.match(html, /f\.size>528384/, 'the file picker uses the host limit');
assert.match(html, /It could not start: /, 'a plugin that fails to start is not reported as done');
assert.match(html, /Could not refresh the Shards/, 'a failed refresh does not leave stale data unannounced');
assert.match(html, /not \x27\+e\.id|not '\+e\.id/, 'the downloaded bundle must be the one the list names');
assert.match(html, /\/session',\{\}\)\.then\(function\(d\)\{if\(pluginView===id2\)\$\('pluginFrame'\)\.src=d\.path/, 'a plugin page is opened with its own session URL');
assert.match(html, /id="pluginFrame"[^>]*sandbox="allow-scripts"/);
console.log('plugins page: ok');

// Vetro's own features are not plugins: the MQTT bridge is started by main.js itself.
const main = require('fs').readFileSync(require('path').join(__dirname, '..', 'service', 'main.js'), 'utf8');
assert.match(main, /function startBridge\(\) \{[^}]*\n    bridge\.start\(\);\n\}/, 'main.js must start the MQTT bridge');
assert.match(main, /server\.on\('listening', function \(\) \{[^}]*becomeOwner\(\);/, 'the bridge starts with the copy of the service that listens (#199, #213)');
assert.match(main, /function becomeOwner\(\) \{[^}]*startBridge\(\);[^}]*platform\.start\(\);[^}]*plugins\.start\(\);/, 'and so do the root agent and the supervision (a second copy touches nothing on the TV)');
assert.match(main, /function restoreInput\(\)\{\n    if\(!serviceOwner\)return;/, 'and the remote interception');
assert.ok(!/plugin-mqtt/.test(main), 'MQTT is not a plugin');

// Sign-in: a sandboxed plugin page cannot send the dashboard's cookie, so its session URL must reach the plugin host before the gate.
const mainSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'service', 'main.js'), 'utf8');
const scopedAt = mainSrc.indexOf("/s\\/[0-9a-f]{32}\\/api");
const gateAt = mainSrc.indexOf('auth.gate(req, res, url');
assert.ok(scopedAt > 0 && gateAt > 0 && scopedAt < gateAt, 'plugin session URLs are routed before the sign-in gate');
console.log('plugin sessions: ok');

assert.match(html,/href="https:\/\/github.com\/andrearicci93\/vetro-plugins"[^>]*>Repository ↗</);
assert.match(html,/plugins\.md"[^>]*>Guide ↗</);
assert.doesNotMatch(html,/class="plugin-steps"|Plugins for your TV|Third-party code\.<\/strong>/,'no how-to strip, no second heading, no amber disclaimer box');
assert.match(html,/Install from a file or develop a Shard/);
assert.doesNotMatch(html,/copy a plugin folder into/,'setup guidance does not expose installation internals');

const shardsNav=/<button data-tab="plugins"[^>]*>([\s\S]*?)<\/button>/.exec(html)[1];
assert.match(shardsNav,/>Vetro Shards$/);
assert.match(shardsNav,/M4 3h9l-4 7-6-2 1-5Z/,'approved three-fragment icon');
assert.doesNotMatch(shardsNav,/M9 3v4M15 3v4/,'plug icon replaced');
assert.match(html,/plugins:\['Vetro Shards','Plugins written by other people/);
assert.match(html,/<summary>Full notice<\/summary>/,'the long notice sits behind the page\'s sentence');
assert.match(html,/id="pluginInstalledTitle">Installed'/);assert.match(html,/id="pluginCatalogTitle">Catalog<\/h2>/);

// A Shard that intercepts an app says so, on its card, in the catalog and in the install question.
{
    const vm = require('vm');
    const grab = name => new RegExp('function ' + name + '\\([^)]*\\)\\{[^\\n]*\\}\\n').exec(html)[0];
    const special = /HTML_SPECIAL_RE\s*=\s*[^;]*;/.exec(html)[0].replace(/^[^H]*/, 'var ');
    const code = special + ['esc', 'chip', 'interceptList', 'interceptKey', 'interceptChips', 'interceptNote', 'interceptWords'].map(grab).join('');
    const ctx = vm.createContext({});
    vm.runInContext(code, ctx);
    const yt = [{appId: 'com.samsung.tv.cobalt-yt', label: 'YouTube'}];
    assert.match(vm.runInContext('interceptChips', ctx)(yt), /Intercepts the YouTube app/, 'the card names the app');
    assert.match(vm.runInContext('interceptChips', ctx)(yt, ['com.samsung.tv.cobalt-yt']), /Conflict · YouTube tile/, 'a conflict is shown instead');
    assert.equal(vm.runInContext('interceptChips', ctx)(undefined), '', 'a Shard without the field shows nothing');
    assert.equal(vm.runInContext('interceptNote', ctx)([]), '');
    assert.match(vm.runInContext('interceptNote', ctx)(yt), /launcher tile of YouTube \(com\.samsung\.tv\.cobalt-yt\) opens this Shard\. If the Shard fails, the tile opens the app/, 'says what changes and the fallback');
    assert.match(vm.runInContext('interceptNote', ctx)(yt, ['x']), /Two Shards claim this app/);
    assert.match(vm.runInContext('interceptWords', ctx)(yt), /intercepts the launcher tile of YouTube/, 'the install question says it too');
    assert.equal(vm.runInContext('interceptWords', ctx)(), '');
    const key = vm.runInContext('interceptKey', ctx);
    assert.equal(key(yt), key([{appId: 'com.samsung.tv.cobalt-yt', label: 'YouTube', extra: 1}]));
    assert.notEqual(key(yt), key([]), 'a bundle that intercepts more than the list says is refused');
    assert.match(vm.runInContext('esc', ctx)('<b>"x"</b>'), /&lt;b&gt;/, 'labels are escaped');
    assert.match(html, /The downloaded file intercepts different apps than the catalog says/);
    console.log('plugins page: intercept label ok');
}

// A Shard that adds a card to the Control center says so: on its card, in the catalog, in the install question, and in the Control center tab.
{
    const vm = require('vm');
    const grab = name => new RegExp('function ' + name + '\\([^)]*\\)\\{[^\\n]*\\}\\n').exec(html)[0];
    const special = /HTML_SPECIAL_RE\s*=\s*[^;]*;/.exec(html)[0].replace(/^[^H]*/, 'var ');
    const infoVar = /var CARD_INFO=\{[^\n]*\};\n/.exec(html)[0];
    const code = special + ['esc', 'cardWords', 'cardKey', 'cardNote', 'cardInfo'].map(grab).join('') + infoVar + 'var dockData=null;';
    const ctx = vm.createContext({});
    vm.runInContext(code, ctx);
    const run = (name, ...a) => vm.runInContext(name, ctx)(...a);
    assert.match(run('cardWords', { label: 'Home Assistant' }), /adds a card to the Control center \(“Home Assistant”\)/, 'the install question says it');
    assert.equal(run('cardWords'), ''); assert.equal(run('cardWords', {}), ''); assert.equal(run('cardWords', { label: 5 }), '');
    assert.equal(run('cardKey', { label: 'Lights', extra: 1 }), 'Lights'); assert.equal(run('cardKey'), ''); assert.notEqual(run('cardKey', { label: 'A' }), run('cardKey'), 'a bundle with a card the list does not name is refused');
    assert.match(run('cardNote', { label: 'Lights' }), /Adds a Control center card \(“Lights”\)\. Enable it in Vetro UI/);
    assert.doesNotMatch(run('cardNote', { label: 'Lights' }), /row-error/, 'no error: nothing to say');
    assert.match(run('cardNote', { label: 'Lights', error: 'The Shard did not answer in time' }), /row-error">Control center card: The Shard did not answer in time/, 'an error of the card is shown on the Shard');
    assert.equal(run('cardNote'), ''); assert.match(run('cardNote', { label: '<i>x</i>' }), /&lt;i&gt;/, 'labels are escaped');
    assert.equal(run('cardInfo', 'tasks', {}).name, 'Task manager');
    assert.equal(run('cardInfo', 'shard:home-assistant', { cardShards: { 'shard:home-assistant': 'Home Assistant' } }).name, 'Home Assistant', 'the Shard names its card');
    assert.equal(run('cardInfo', 'shard:gone', {}).name, 'shard:gone', 'unknown: its name, no crash');
    assert.match(html, /The downloaded file differs from the catalog on the Control center card/);
    assert.match(html, /data-quick-item="card-paused-'/, 'a card whose Shard is off is listed as paused, not dropped');
    assert.match(html, /Adds a card to the Control center'\]/, 'the catalog entry says it');
    console.log('plugins page: control center card ok');
}
