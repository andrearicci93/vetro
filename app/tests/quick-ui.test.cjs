'use strict';
const assert=require('assert').strict,vm=require('vm');
const html=require('../service/dashboard.js')();
const nodes={};const el=id=>nodes[id]||(nodes[id]={id,value:'',hidden:true,textContent:'',innerHTML:'',disabled:false,focus(){}});
const alexa=['com.samsung.tv.alexa-client','com.samsung.tv.alexa-fullscreen-app','com.samsung.tv.alexa-jump-starter','com.samsung.tv.wakeup-engine-alexa'];
let apps=alexa.map((id,i)=>({appId:id,packageId:'com.samsung.tv.alexa-client',name:id,disabled:i===3,area:'voice',role:'optional'}));
apps.push({appId:'com.samsung.tv.acr-service-app',packageId:'com.samsung.tv.acr-service-app',name:'ACR',disabled:true,area:'tracking',role:'tracking'},
 {appId:'com.samsung.tv.pisa-service',packageId:'com.samsung.tv.pisa-service',name:'pisa',disabled:false,area:'tracking',role:'tracking'},
 {appId:'org.tizen.pisa-control-service',packageId:'com.samsung.tv.pisa-service',name:'pisa control',disabled:false,area:'tracking',role:'tracking'},
 {appId:'com.samsung.tv.coba.adagent',packageId:'com.samsung.tv.coba.adagent',name:'coba-adagent',disabled:false,area:'tracking',role:'keep'},
 {appId:'org.tizen.multi-assistant-service',packageId:'org.tizen.multi-assistant-service',name:'hub',disabled:false,area:'voice',role:'optional'});
// Quick settings are split in horizontal tabs, one panel each, with the usual tab semantics
assert.match(html,/<div id="quickTabs" class="tabs" role="tablist" aria-label="Quick settings">/);
const qtabs=[...html.matchAll(/data-quick-tab="(\w+)" aria-controls="quickPanel-(\w+)" aria-selected="(true|false)" tabindex="(0|-1)"/g)];
assert.deepEqual(qtabs.map(m=>m[1]),['general','privacy','voice','memory','developer']);assert.ok(qtabs.every(m=>m[1]===m[2]),'each tab controls its own panel');
assert.deepEqual(qtabs.map(m=>m[3]),['true','false','false','false','false'],'one tab selected at a time');assert.deepEqual(qtabs.map(m=>m[4]),['0','-1','-1','-1','-1'],'roving tabindex');
['quickTracking','quickVoice','quickMemory','quickKeep','quickStorage','quickControl'].forEach(id=>assert.ok(html.includes('id="'+id+'"'),id+' is still rendered'));
assert.ok(!html.includes('qtab-home')&&!html.includes('quickPanel-home')&&!html.includes('id="quickHome"'),'Quick settings has no Home tab any more');
let restoreDone=false;
const restoreState=()=>({ok:true,pending:restoreDone?0:2,notes:['Packages removed from the Task manager cannot be brought back from here.'],items:[
 {id:'launcher',label:'Launcher',detail:'Switches the Vetro launcher off.',state:restoreDone?'clean':'changed'},
 {id:'groups',label:'Quick settings groups',detail:'Switches on the components of the groups.',state:restoreDone?'clean':'changed',count:3},
 {id:'hbbtv',label:'HbbTV',detail:'x',state:'clean'}]});
let keepPost=null;const calls=[];
const sandbox={document:{getElementById:el,querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}},console,setTimeout(fn){return 1},clearTimeout(){},setInterval(){},
 fetch:async(url,opts)=>{const body=opts&&opts.body?JSON.parse(opts.body):null;calls.push({url,body});let data={};
  if(url.startsWith('/apps'))data={apps,summary:{total:apps.length},source:'package registry + public probe'};
  else if(url==='/status')data={agent:{connected:true},mode:'root',app:{version:'9.9.9'}};
  else if(url==='/hbbtv')data={value:19,off:true,valueOff:true,flag:true,running:false,serviceRunning:false,serviceDisabled:true,canRestore:true,restoreValue:20};
  else if(url==='/keep-removed'&&!body)data={enabled:true,packages:['org.tizen.primevideo','MCmYXNxgcu'],last:{source:{ids:['1'],changed:false,error:null}},history:[]};
  else if(url==='/keep-removed'){keepPost=body;data={ok:true,enabled:body.action==='enable'?true:body.action==='disable'?false:true,packages:body.action==='allow'?['MCmYXNxgcu']:['org.tizen.primevideo','MCmYXNxgcu'],last:{source:{ids:[],changed:true,error:null}},history:[]};}
  else if(url==='/wins'&&!body)data={ts:1,wins:{firmware:{status:'off',value:1},multiscreen:{status:'on',running:false},ambient:{status:'partial',running:true,chosen:true},telemetry:{status:'on',running:0,brakes:3,chosen:true,dnsBlocked:false},airplay:{status:'off',running:true}}};
  else if(url==='/wins')data={id:body.id,changed:true,status:body.on?'on':'off',previous:1,value:body.on?0:1};
  else if(url==='/dns')data={enabled:false,applied:false,domains:[],resolvers:[]};
  else if(url==='/leftovers'&&!body)data={files:[{name:'old.wgt',size:2048,isPackage:true},{name:'device-profile.xml',size:10,isPackage:false}],packageBytes:2048,storageBefore:{availableBytes:1048576*900},errors:[],
  extras:[{kind:'log',label:'Old network logs',path:'/opt/usr/data/network/inm-manager.log.0',size:1052672},{kind:'webcache',label:'Web app caches (closed apps)',path:'/opt/usr/home/owner/apps_rw/AAAAAAAAAA/data/Code Cache',size:12288}],
  extraKinds:{log:{label:'Old network logs',count:1,bytes:1052672},webcache:{label:'Web app caches (closed apps)',count:1,bytes:12288}},appsUnreadable:false};
  else if(url==='/quick'){apps=apps.map(a=>({...a,disabled:body.off}));data={ok:true,id:body.id,off:body.off,changed:alexa.slice(0,3),stopped:[alexa[0]],stopFailed:[],apps};}
  else if(url==='/restore'&&!body)data=restoreState();
  else if(url==='/restore'&&body.action==='run'){restoreDone=true;data={ok:true,complete:true,steps:[{id:'launcher',label:'Launcher',status:'done',message:'Launcher off; Samsung’s Home is back.'},{id:'dns',label:'DNS blocking',status:'skipped',message:'Nothing to put back.'}],remaining:[],notes:[]};}
  else if(url==='/restore'&&body.action==='erase')data={ok:true,left:0};
  else if(url==='/input')data={devices:[],status:{policy:{mode:'off'},events:[]}};else if(url==='/remap')data={rules:[]};
  return {ok:true,json:async()=>data};}};
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],sandbox);
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{await tick();await tick();
 assert.equal(sandbox.currentPanel,'quick','Quick settings is the first panel');
 assert.ok(!calls.some(c=>c.url.startsWith('/monitor')),'no live sampling at start');
 assert.equal(el('appVersion').textContent,'Vetro 9.9.9','the sidebar footer shows the version the service reports');assert.ok(!html.includes('id="count"')&&!html.includes('>TV manager<'),'no app count in the footer and no TV manager tagline');assert.equal(el('connection').textContent,'Connected','the corner under the logo says Connected or Not connected');
 const voice=el('quickVoice').innerHTML;
 assert.match(voice,/Disable Alexa/);assert.match(voice,/Partly done · 3 of 4 components still enabled/);assert.doesNotMatch(voice,/data-quick-toggle="alexa" checked/,'partly done: the switch is not on yet');
 const memory=el('quickMemory').innerHTML;
 assert.match(memory,/Disable HbbTV/);assert.match(memory,/data-hbbtv-disable[^>]*checked[^>]*aria-label="Disable HbbTV"/,'HbbTV off: the win switch is on');assert.match(memory,/Done · HbbTV and its service are stopped/);
 assert.match(memory,/Disable Multi View autostart/);assert.match(memory,/data-win-switch="multiscreen" checked/);assert.match(memory,/Done · Multi View starts when you open it/);assert.match(memory,/chip[^>]*\bon\b[^>]*>Done · Multi View starts when you open it/,'a finished win is green, not yellow');
 assert.match(memory,/<h3>Stop Ambient<\/h3>/);assert.doesNotMatch(memory,/partial block/,'Ambient is no longer sold as a partial block');assert.match(memory,/Vetro stops screend, ends the app and starts screend again/,'the detail says how it is kept off');
 assert.match(memory,/Partly done · Samsung started it again/,'chosen but running again is shown as partly done');assert.doesNotMatch(memory,/data-win-switch="ambient" checked/);
 const tracking=el('quickTracking').innerHTML;
 assert.match(tracking,/<h3>Stop viewing-data collection<\/h3>/);assert.match(tracking,/data-win-switch="telemetry" checked/,'collection services stopped: the switch is on');assert.match(tracking,/Done · recognition and logging stopped; data-service may still run/);
 assert.match(tracking,/Uploads can resume · turn on Enable DNS blocking/,'the DNS entry is not applied: the state says so');assert.match(tracking,/lcprd1\.samsungcloudsolution\.net/);
 assert.match(tracking,/Disable all advertising and tracking/);assert.match(tracking,/Partly done · 2 of 3 components still enabled/,'the Smart Hub ad agent (role keep) is not a member');
 assert.doesNotMatch(tracking,/coba\.adagent/);
 assert.match(voice,/Disable all voice assistants/);assert.match(voice,/Partly done · 4 of 5 components still enabled/,'the assistant hub is a member of the all-in switch');
 assert.match(el('quickControl').innerHTML,/Disable automatic firmware update/);assert.doesNotMatch(el('quickControl').innerHTML,/data-win-switch="firmware" checked/);
 assert.doesNotMatch(html,/quick wins applied|quickScore/,'no progress counter');
 assert.doesNotMatch(html,/quickPrivacy|Disable viewing-data tracking/,'one Advertising and tracking section: the ACR switch is covered by the all-in switch');
 assert.equal((tracking.match(/data-quick-toggle=/g)||[]).length,1,'a single tracking group switch');
 assert.match(tracking,/No domains saved/);assert.match(tracking,/data-quick-open="dns"/,'the domain filter sits with the tracking switch');
 assert.match(el('quickStorage').innerHTML,/3 items · 1 MiB can be cleared/,'packages, logs and caches are one count');
 assert.match(el('quickStorage').innerHTML,/Install packages · 1 · 2 KiB/);assert.match(el('quickStorage').innerHTML,/Old network logs · 1/);assert.match(el('quickStorage').innerHTML,/AAAAAAAAAA\/data\/Code Cache/,'the list shows where each item is');
 const sw={dataset:{quickToggle:'alexa'},checked:true};el('quick').onchange({target:sw});
 assert.equal(sw.checked,false,'switch stays off until confirmed');assert.ok(!calls.some(c=>c.url==='/quick'),'microphone groups need confirmation');
 assert.match(el('quickVoice').innerHTML,/microphone button on the remote/);
 const confirm={dataset:{quickConfirm:'alexa'}};await el('quick').onclick({target:{closest:()=>confirm}});await tick();await tick();
 assert.deepEqual(calls.find(c=>c.url==='/quick').body,{id:'alexa',off:true});
 assert.ok(sandbox.inventory.filter(a=>alexa.includes(a.appId)).every(a=>a.disabled),'Debloater inventory reflects the change');
 assert.match(el('quickVoice').innerHTML,/data-quick-toggle="alexa" checked/,'every component is disabled: the win is on');assert.match(el('quickVoice').innerHTML,/Done · 4 components disabled/);
 assert.match(sandbox.operationEntries[0].message,/3 components disabled; the TV registry confirms it. 1 running component stopped/);
 // The new wins go through their own route, one at a time, and read the state back
 const fw={dataset:{winSwitch:'firmware'},checked:true};await el('quick').onchange({target:fw});await tick();await tick();
 assert.deepEqual(calls.find(c=>c.url==='/wins'&&c.body).body,{id:'firmware',on:true});
 assert.match(sandbox.operationEntries[0].message,/Auto update off; value 1 → 0 read back/);assert.equal(sandbox.operationEntries[0].resultLabel,'State read back');
 // The Disable tab: AirPlay is a win like the others. Keep removed apps removed is one global switch with its list, in General
 assert.match(html,/id="qtab-memory"[^>]*>Disable</);assert.doesNotMatch(html,/>Free memory</);assert.match(html,/Disable what you don’t use/);
 assert.match(el('quickMemory').innerHTML,/<h3>Disable AirPlay<\/h3>/);assert.match(el('quickMemory').innerHTML,/data-win-switch="airplay"(?! checked)/,'AirPlay running: its switch is off');
 assert.match(el('quickMemory').innerHTML,/Casting from an Apple device to this TV does not work while this is on/);
 assert.doesNotMatch(el('quickMemory').innerHTML,/Keep removed apps removed/,'it is a General setting, not in the Disable tab');assert.match(el('quickKeep').innerHTML,/<h3>Keep removed apps removed<\/h3>/);assert.match(el('quickKeep').innerHTML,/data-keep-switch[^>]*checked/);assert.match(el('quickKeep').innerHTML,/On · 2 apps on the list/);
 assert.match(el('quickKeep').innerHTML,/data-keep-allow="MCmYXNxgcu"/);assert.match(el('quickKeep').innerHTML,/select Allow again first/);
 const kp={dataset:{keepSwitch:''},checked:false};await el('quick').onchange({target:kp});await tick();await tick();
 assert.deepEqual(keepPost,{action:'disable'},'the global switch posts enable or disable');
 assert.match(sandbox.operationEntries[0].message,/Off: the ids Vetro added are taken out of Samsung’s list/);
 const allow={dataset:{keepAllow:'MCmYXNxgcu'}};await el('quick').onclick({target:{closest:()=>allow}});await tick();await tick();
 assert.deepEqual(keepPost,{action:'allow',packages:['MCmYXNxgcu']});assert.match(sandbox.operationEntries[0].message,/Samsung may install MCmYXNxgcu again/);
 const hb={dataset:{hbbtvDisable:''},checked:false};await el('quick').onchange({target:hb});await tick();await tick();
 assert.deepEqual(calls.filter(c=>c.url==='/hbbtv'&&c.body).at(-1).body,{off:false,expected:19},'switching the win off turns HbbTV back on');
 const clear={dataset:{leftoversClear:''}};el('quick').onclick({target:{closest:()=>clear}});assert.match(el('quickStorage').innerHTML,/Delete 3 items \(1 MiB\)\?/);assert.ok(!calls.some(c=>c.url==='/leftovers'&&c.body),'cleanup needs confirmation');
 // A disabled member that still starts at boot keeps the group "partly done"; the Task manager and Quick settings read the same inventory
 apps=apps.map(a=>alexa.includes(a.appId)?{...a,disabled:true,onboot:a.appId===alexa[1],autorestart:false}:a);
 await sandbox.loadApps(true);
 assert.match(el('quickVoice').innerHTML,/Partly done · 1 still starts at boot or restart/,'all disabled but one still on boot: not done');
 assert.doesNotMatch(el('quickVoice').innerHTML,/data-quick-toggle="alexa" checked/);assert.match(el('quickVoice').innerHTML,/Starts at boot/,'the member list marks the flagged component');
 apps=apps.map(a=>({...a,onboot:false}));await sandbox.loadApps(true);
 assert.match(el('quickVoice').innerHTML,/Done · 4 components disabled/,'flag cleared in the Task manager: the quick switch is done');
 assert.match(sandbox.quickNote({appId:alexa[1],disabled:true,onboot:true}),/Covered by Quick settings: .*Disable Alexa.*clears Start at boot/,'the Startup section tells which quick switch covers the component');
 assert.equal(sandbox.quickNote({appId:'unrelated.app',disabled:false}),'');
 // Restore the TV: nothing is asked of the TV until the user reviews, and nothing runs until they confirm
 assert.ok(['quickRestore','quickRemove'].every(id=>html.includes('id="'+id+'"')),'the Maintenance tab has the restore and remove sections');
 assert.ok(!calls.some(c=>c.url==='/restore'),'the plan is read only when asked');
 assert.match(el('quickRestore').innerHTML,/Review what will change/);assert.doesNotMatch(el('quickRestore').innerHTML,/Restore everything/);
 const remove0=el('quickRemove').innerHTML;
 assert.match(remove0,/Vetro cannot remove itself/);assert.match(remove0,/Apps2Samsung/);assert.match(remove0,/Delete<\/em>/);assert.match(remove0,/data-erase-ask disabled/,'saved data cannot be removed before a review shows nothing is left');
 await el('quick').onclick({target:{closest:()=>({dataset:{restoreReview:''}})}});await tick();await tick();
 let rs=el('quickRestore').innerHTML;
 assert.match(rs,/Launcher/);assert.match(rs,/Quick settings groups · 3/);assert.match(rs,/Will be put back/);assert.match(rs,/1 item already as before/);assert.match(rs,/What Vetro cannot put back/);
 assert.match(rs,/data-restore-ask/);assert.ok(!calls.some(c=>c.url==='/restore'&&c.body),'reviewing changes nothing');
 el('quick').onclick({target:{closest:()=>({dataset:{restoreAsk:''}})}});
 assert.match(el('quickRestore').innerHTML,/Restore 2 items\?/);assert.match(el('quickRestore').innerHTML,/data-restore-confirm/);assert.ok(!calls.some(c=>c.url==='/restore'&&c.body),'restoring needs confirmation');
 el('quick').onclick({target:{closest:()=>({dataset:{restoreCancel:''}})}});assert.doesNotMatch(el('quickRestore').innerHTML,/data-restore-confirm/);
 el('quick').onclick({target:{closest:()=>({dataset:{restoreAsk:''}})}});
 await el('quick').onclick({target:{closest:()=>({dataset:{restoreConfirm:''}})}});await tick();await tick();await tick();
 assert.deepEqual(calls.find(c=>c.url==='/restore'&&c.body).body,{action:'run'});
 assert.match(el('quickRestore').innerHTML,/Last restore/);assert.match(el('quickRestore').innerHTML,/Samsung’s Home is back/);assert.doesNotMatch(el('quickRestore').innerHTML,/DNS blocking/,'a skipped step is not listed');
 assert.match(el('quickRestore').innerHTML,/Nothing left to put back/);
 assert.match(sandbox.operationEntries[0].message,/1 step done/);
 assert.doesNotMatch(el('quickRemove').innerHTML,/data-erase-ask disabled/,'with nothing left to put back the data can be removed');
 el('quick').onclick({target:{closest:()=>({dataset:{eraseAsk:''}})}});
 assert.match(el('quickRemove').innerHTML,/Delete Vetro’s saved data on the TV\?/);assert.ok(!calls.some(c=>c.url==='/restore'&&c.body&&c.body.action==='erase'),'erasing needs confirmation');
 await el('quick').onclick({target:{closest:()=>({dataset:{eraseConfirm:''}})}});await tick();await tick();
 assert.ok(calls.some(c=>c.url==='/restore'&&c.body&&c.body.action==='erase'));assert.match(el('quickRemove').innerHTML,/saved data was removed/);
 console.log('PASS quick UI: wins read as done or not, partial states, new switches, microphone confirmation, shared inventory, cleanup confirmation');
})().catch(e=>{console.error(e);process.exitCode=1});
