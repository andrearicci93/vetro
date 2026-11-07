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
 sandbox.processAt=Date.now()-31000;sandbox.render();
 assert.ok(!/Running · 1/.test(el('appGrid').innerHTML),'stale process state is not displayed as current');
 {const calls=[],orig=sandbox.fetch;sandbox.fetch=async u=>{calls.push(u);return orig(u)};el('appStatus').value='running';sandbox.render();await new Promise(r=>setImmediate(r));
  assert.ok(calls.includes('/monitor'),'choosing Running with no fresh sample reads one instead of showing an empty list');sandbox.fetch=orig;el('appStatus').value='all';}
 el('appStatus').value='stopped';sandbox.render();assert.equal(el('empty').hidden,false,'unknown state does not match not running');
 el('appStatus').value='all';sandbox.drawMonitor({...sample,ts:Date.now(),processes:[]});sandbox.render();assert.match(el('appGrid').innerHTML,/Not running/);
 sandbox.inventory=[app,{...app,appId:'example.service',disabled:false,onboot:true,autorestart:null}];sandbox.render();
 assert.match(el('appGrid').innerHTML,/Mixed/);assert.match(el('appGrid').innerHTML,/Boot \(some\)/);assert.match(el('appGrid').innerHTML,/Restart \?/);
 sandbox.expandedApps['package:example']=true;sandbox.render();assert.equal((el('appGrid').innerHTML.match(/<td/g)||[]).length,18,'expanded components retain all six columns');
 sandbox.inventory=[{...app,disabled:undefined}];sandbox.render();assert.match(el('appGrid').innerHTML,/Unknown/);assert.ok(!el('appGrid').innerHTML.includes('disabled-row'));
 sandbox.registryData={plugins:[{id:'test',name:'Test',version:'1.0.0',sha256:'a'.repeat(64),permissions:[]}]};
 let add=sandbox.pluginAddPanel({plugins:[],signed:false,developer:false});
 assert.match(add,/data-plugin-developer/, 'Developer mode is available even without a catalog key');
 assert.match(add,/data-plugin-file disabled/);assert.match(add,/Not signed/);
 add=sandbox.pluginAddPanel({plugins:[],signed:false,developer:true});
 assert.doesNotMatch(add,/data-plugin-file disabled/);assert.match(add,/>Install<\/button>/);
 sandbox.sdbData={available:true,enabled:false,active:false,port:26201};sandbox.sdbError=null;sandbox.renderSdbAccess();
 assert.match(el('quickSdb').innerHTML,/Allow SDB from the local network/);
 const toggles=[];sandbox.setSdbAccess=on=>toggles.push(on);
 const checkbox={dataset:{sdbAccess:''},checked:true};el('quick').onchange({target:checkbox});
 assert.equal(checkbox.checked,false);assert.equal(toggles.length,0,'enable requires in-page confirmation');
 assert.match(el('quickSdb').innerHTML,/data-sdb-confirm/);
 el('quick').onclick({target:{dataset:{sdbConfirm:''}}});assert.equal(toggles[0],true);
 el('quick').onclick({target:{dataset:{sdbCancel:''}}});assert.equal(sandbox.sdbConfirm,false);
 el('quick').onchange({target:{dataset:{sdbAccess:''},checked:false}});assert.equal(toggles[1],false,'off is immediate');
 // Pairing is off by default: the page says plainly that anyone on the home network can use the commands.
 sandbox.pairingData={enabled:false,disabled:true,paired:false};sandbox.pairingError=null;sandbox.renderPairingMode();
 assert.match(el('quickPairing').innerHTML,/Pairing is off\. Anyone on your home network can use the dashboard and API, including root commands/);
 assert.match(el('quickPairing').innerHTML,/Require pairing/);assert.doesNotMatch(el('quickPairing').innerHTML,/data-pairing-enabled checked/);
 // Automatic mode: waiting for the TV app, then on by itself.
 sandbox.pairingData={enabled:false,disabled:true,mode:'auto',tvSeen:false,paired:false};sandbox.renderPairingMode();
 assert.match(el('quickPairing').innerHTML,/Pairing is waiting for the Vetro app on the TV[\s\S]*anyone on your home network can use the dashboard and API, including root commands/);
 assert.match(el('quickPairing').innerHTML,/Pairing waiting for the TV/);
 sandbox.pairingData={enabled:true,disabled:false,mode:'auto',tvSeen:true,paired:true};sandbox.renderPairingMode();
 assert.match(el('quickPairing').innerHTML,/Pairing on \(automatic\)/);assert.doesNotMatch(el('quickPairing').innerHTML,/Pairing is waiting/);
 sandbox.pairingData={enabled:false,disabled:true,paired:false};sandbox.renderPairingMode();
 const modes=[];sandbox.setPairingMode=on=>modes.push(on);
 // Turning it on from an unpaired browser: pair this browser first, with a code on the TV.
 const pairingCheckbox={dataset:{pairingEnabled:''},checked:true};el('quick').onchange({target:pairingCheckbox});
 assert.equal(pairingCheckbox.checked,false);assert.equal(modes.length,0);
 assert.match(el('quickPairing').innerHTML,/First pair this browser/);assert.match(el('quickPairing').innerHTML,/data-pairing-start/);
 assert.doesNotMatch(el('quickPairing').innerHTML,/data-pairing-confirm/,'an unpaired browser cannot switch it on directly');
 sandbox.pairingStep={id:'x'};sandbox.renderPairingMode();assert.match(el('quickPairing').innerHTML,/id="pairingCode"[\s\S]*data-pairing-code/);
 el('quick').onclick({target:{dataset:{pairingCancel:''}}});assert.equal(sandbox.pairingConfirm,false);assert.equal(sandbox.pairingStep,null);
 // A paired browser confirms and switches it on.
 sandbox.pairingData={enabled:false,disabled:true,paired:true};el('quick').onchange({target:{dataset:{pairingEnabled:''},checked:true}});
 assert.match(el('quickPairing').innerHTML,/This browser is already paired/);
 el('quick').onclick({target:{dataset:{pairingConfirm:''}}});assert.equal(modes[0],true);
 // Turning it off asks first, with the warning.
 sandbox.pairingData={enabled:true,disabled:false,paired:true};sandbox.renderPairingMode();
 assert.match(el('quickPairing').innerHTML,/data-pairing-enabled checked/);assert.doesNotMatch(el('quickPairing').innerHTML,/Pairing is off\./);
 el('quick').onchange({target:{dataset:{pairingEnabled:''},checked:false}});assert.equal(modes.length,1);
 assert.match(el('quickPairing').innerHTML,/Turn pairing off\?[\s\S]*root commands/);
 el('quick').onclick({target:{dataset:{pairingConfirm:''}}});assert.equal(modes[1],false);
 sandbox.inventory=[{appId:'com.samsung.tv.csfs',packageId:'com.samsung.tv.csfs',disabled:false}];
 // Samsung Home lives in the Custom launcher tab of the Launcher page, locked while any launcher is on
 sandbox.dockData={installed:true,mode:'off',enabled:false,entries:[],inputs:[]};
 sandbox.launcherEnabled=true;sandbox.renderQuick();assert.match(el('dockCustom').innerHTML,/data-quick-toggle="samsung-home" disabled/);
 assert.match(el('dockCustom').innerHTML,/Turn off the launcher to change Samsung Home/);
 sandbox.launcherEnabled=false;sandbox.renderQuick();assert.doesNotMatch(el('dockCustom').innerHTML,/data-quick-toggle="samsung-home" disabled/);
 sandbox.inventory=[{appId:'hotel.app',packageId:'hotel',role:'unused',area:'commercial'}];sandbox.render();
 assert.doesNotMatch(el('roleFilters').innerHTML,/data-role="unused"/);assert.doesNotMatch(el('appGrid').innerHTML,/Not used at home|role-unused/);
 assert.equal(sandbox.quickTab,'general');
 const general=html.slice(html.indexOf('id="quickPanel-general"'),html.indexOf('id="quickPanel-privacy"'));
 const developer=html.slice(html.indexOf('id="quickPanel-developer"'),html.indexOf('<section id="dashboard"'));
 assert.match(general,/id="updateVersion"/);assert.match(general,/id="quickRestore"/);assert.doesNotMatch(general,/id="quickPairing"|id="quickSdb"/);
 assert.match(developer,/id="quickPairing"/);assert.match(developer,/id="quickSdb"/);assert.doesNotMatch(developer,/id="quickStorage"|id="updateVersion"/);
 assert.doesNotMatch(html.slice(html.indexOf('<section id="diagnostics"'),html.indexOf('<section id="plugins"')),/id="updateVersion"/);
 assert.match(sandbox.previewMarkup({entries:[]}),/slug=settings/);assert.match(sandbox.previewMarkup({entries:[]}),/slug=samsunghome/);
 assert.match(sandbox.previewMarkup({entries:[],noMotion:true}),/lp-reduced/);
 console.log('PASS dashboard states: disabled/running independence, startup mixtures, unknown and stale samples, package expansion');
})().catch(e=>{console.error(e);process.exitCode=1});

// Startup: a disabled app keeps its flags, so the default list shows only what can start; the rest is one filter away.
const startupHtml = require('../service/dashboard.js')({});
assert.match(startupHtml, /<option value="flagged">Can start: flag set, app enabled<\/option><option value="flags">Flag set, including disabled apps<\/option>/);
assert.match(startupHtml, /\(a\.onboot\|\|a\.autorestart\)&&\(mode==='flags'\|\|a\.disabled===false\)/, 'default filter requires an enabled component');
assert.match(startupHtml, /function mixedCount/, 'a Mixed flag says how many components have it on');
assert.match(startupHtml, /a disabled app keeps them/);
