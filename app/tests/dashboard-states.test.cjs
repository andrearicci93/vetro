'use strict';
const assert=require('assert').strict,vm=require('vm');
const html=require('../service/dashboard.js')(),nodes={};
const el=id=>nodes[id]||(nodes[id]={value:'',hidden:true,innerHTML:'',textContent:'',focus(){}});
const sandbox={document:{getElementById:el,querySelectorAll:()=>[],addEventListener(){}},console,setInterval(){},setTimeout(){},clearTimeout(){},fetch:async url=>({ok:true,json:async()=>url.startsWith('/apps')?{apps:[],summary:{total:0}}:url==='/remap'?{rules:[]}:url==='/input'?{devices:[],status:{policy:{mode:'off'},events:[]}}:url.startsWith('/monitor')?{scope:'summary',ts:Date.now(),cpu:{cores:[]},memory:{},network:[]}:{} })};
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],sandbox);
(async()=>{
 await new Promise(r=>setImmediate(r));
 assert.ok(!html.includes('quickDebloat'));
 const app={appId:'example.ui',packageId:'example',name:'Example',disabled:true,onboot:false,autorestart:true,category:'other'};
 sandbox.inventory=[app];sandbox.render();
 assert.match(el('appGrid').innerHTML,/Disabled/);
 assert.ok(!/Not running/.test(el('appGrid').innerHTML),'missing process sample is not a stopped app');assert.match(el('appTable').className,/no-sample/,'process columns hide without a sample');
 const sample={ts:Date.now(),cpu:{cores:[]},memory:{},network:[],processes:[{appId:app.appId,name:'Example',pid:7,cpuPercent:1,rssBytes:1048576}],processCount:1};
 sandbox.drawMonitor(sample);sandbox.render();
 assert.match(el('appGrid').innerHTML,/disabled-row/);
 assert.match(el('appGrid').innerHTML,/Running · 1/,'disabled and running can coexist');
 assert.match(el('appGrid').innerHTML,/startup-flags">Restart</,'only flags that are on are listed');assert.doesNotMatch(el('appTable').className,/no-sample/);
 assert.equal((el('appGrid').innerHTML.match(/<td/g)||[]).length,6,'essential states fit the same row');
 sandbox.drawMonitor({...sample,scope:'summary',processes:undefined});sandbox.render();
 assert.match(el('appGrid').innerHTML,/Running · 1/,'summary refresh preserves the latest process sample');
 sandbox.processData.ts=Date.now()-31000;sandbox.render();
 assert.ok(!/Running · 1/.test(el('appGrid').innerHTML),'stale process state is not displayed as current');
 el('appStatus').value='stopped';sandbox.render();assert.equal(el('empty').hidden,false,'unknown state does not match not running');
 el('appStatus').value='all';sandbox.drawMonitor({...sample,ts:Date.now(),processes:[]});sandbox.render();assert.match(el('appGrid').innerHTML,/Not running/);
 sandbox.inventory=[app,{...app,appId:'example.service',disabled:false,onboot:true,autorestart:null}];sandbox.render();
 assert.match(el('appGrid').innerHTML,/Mixed/);assert.match(el('appGrid').innerHTML,/Boot \(some\)/);assert.match(el('appGrid').innerHTML,/Restart \?/);
 sandbox.expandedApps['package:example']=true;sandbox.render();assert.equal((el('appGrid').innerHTML.match(/<td/g)||[]).length,18,'expanded components retain all six columns');
 sandbox.inventory=[{...app,disabled:undefined}];sandbox.render();assert.match(el('appGrid').innerHTML,/Unknown/);assert.ok(!el('appGrid').innerHTML.includes('disabled-row'));
 console.log('PASS dashboard states: disabled/running independence, startup mixtures, unknown and stale samples, package expansion');
})().catch(e=>{console.error(e);process.exitCode=1});

// Startup: a disabled app keeps its flags, so the default list shows only what can start; the rest is one filter away.
const startupHtml = require('../service/dashboard.js')({});
assert.match(startupHtml, /<option value="flagged">Can start: flag set, app enabled<\/option><option value="flags">Flag set, including disabled apps<\/option>/);
assert.match(startupHtml, /\(a\.onboot\|\|a\.autorestart\)&&\(mode==='flags'\|\|a\.disabled===false\)/, 'default filter requires an enabled component');
assert.match(startupHtml, /function mixedCount/, 'a Mixed flag says how many components have it on');
assert.match(startupHtml, /A disabled app keeps its flags/);
