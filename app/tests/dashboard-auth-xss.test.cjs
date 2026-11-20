'use strict';
const assert = require('assert').strict;

const html = require('../service/dashboard.js')();
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// 1. All 6 direct same-origin fetch() calls include credentials:'same-origin'
const sameOriginFetches = [
    ["fetch('/diagnostics/download'+(more?'?components=1':''),{cache:'no-store',credentials:'same-origin'})", '/diagnostics/download'],
    ["fetch('/quick/uninstall',{method:'POST',credentials:'same-origin',", '/quick/uninstall'],
    ["fetch('/plugins/install',{method:'POST',credentials:'same-origin',", '/plugins/install'],
    ["fetch('/status',{cache:'no-store',credentials:'same-origin'})", '/status'],
    ["fetch('/update/apply',{method:'POST',credentials:'same-origin',", '/update/apply'],
    ["fetch('/input',{method:'POST',credentials:'same-origin',", '/input'],
];
sameOriginFetches.forEach(([snippet, route]) => {
    assert.ok(script.includes(snippet), 'expected credentials:same-origin on ' + route);
});

// 2. Cross-origin GitHub/catalog fetches must NOT attach same-origin credentials
const crossOriginSnippets = [
    "return fetch(url,{cache:'no-store'}).then(function(r){if(!r.ok)throw Error(r.status===404?'The catalog is not published yet.'",
    "return fetch(url,{cache:'no-store'}).then(function(r){if(!r.ok)throw Error('Download answered '+r.status)",
    "function updateFetch(url,kind){return fetch(url,{cache:'no-store'})",
];
crossOriginSnippets.forEach(snippet => {
    assert.ok(script.includes(snippet), 'cross-origin fetch must stay without credentials: ' + snippet.slice(0, 60));
});

// 3. XSS escaping on Shard/card names in renderOverview() and dynamic fields in settingEdit()
const ovStart = script.indexOf('function renderOverview()');
assert.ok(ovStart >= 0, 'renderOverview present');
const overviewBody = script.slice(ovStart, ovStart + 2500);
assert.ok(overviewBody.includes("esc(cardInfo(c,d).name)"), 'renderOverview escapes cardInfo(c,d).name');
assert.ok(!overviewBody.includes("return cardInfo(c,d).name"), 'unescaped cardInfo(c,d).name removed from renderOverview');
['id="setting-\'+esc(x.id)+\'"', 'data-setting="\'+esc(x.id)+\'"', 'min="\'+esc(x.min)+\'"', 'max="\'+esc(x.max)+\'"', 'value="\'+esc(x.value)+\'"'].forEach(part => {
    assert.ok(script.includes(part), 'settingEdit escapes dynamic attribute: ' + part);
});

console.log('PASS dashboard-auth-xss: same-origin fetch credentials, cross-origin fetch boundary, and HTML escaping');
