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
const calls=[];
const sandbox={document:{getElementById:el,querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}},console,setTimeout(fn){return 1},clearTimeout(){},setInterval(){},
 fetch:async(url,opts)=>{const body=opts&&opts.body?JSON.parse(opts.body):null;calls.push({url,body});let data={};
  if(url.startsWith('/apps'))data={apps,summary:{total:apps.length},source:'package registry + public probe'};
  else if(url==='/hbbtv')data={value:19,off:true,valueOff:true,flag:true,running:false,serviceRunning:false,canRestore:true,restoreValue:20};
  else if(url==='/wins'&&!body)data={ts:1,wins:{firmware:{status:'off',value:1},multiscreen:{status:'on',running:false},ambient:{status:'partial',running:true,chosen:true}}};
  else if(url==='/wins')data={id:body.id,changed:true,status:body.on?'on':'off',previous:1,value:body.on?0:1};
  else if(url==='/dns')data={enabled:false,applied:false,domains:[],resolvers:[]};
  else if(url==='/leftovers'&&!body)data={files:[{name:'old.wgt',size:2048,isPackage:true},{name:'device-profile.xml',size:10,isPackage:false}],packageBytes:2048,storageBefore:{availableBytes:1048576*900},errors:[]};
  else if(url==='/quick'){apps=apps.map(a=>({...a,disabled:body.off}));data={ok:true,id:body.id,off:body.off,changed:alexa.slice(0,3),stopped:[alexa[0]],stopFailed:[],apps};}
  else if(url==='/input')data={devices:[],status:{policy:{mode:'off'},events:[]}};else if(url==='/remap')data={rules:[]};
  return {ok:true,json:async()=>data};}};
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],sandbox);
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{await tick();await tick();
 assert.equal(sandbox.currentPanel,'quick','Quick settings is the first panel');
 assert.ok(!calls.some(c=>c.url.startsWith('/monitor')),'no live sampling at start');
 const voice=el('quickVoice').innerHTML;
 assert.match(voice,/Disable Alexa/);assert.match(voice,/Partly done · 3 of 4 components still enabled/);assert.doesNotMatch(voice,/data-quick-toggle="alexa" checked/,'partly done: the switch is not on yet');
 const memory=el('quickMemory').innerHTML;
 assert.match(memory,/Disable HbbTV/);assert.match(memory,/data-hbbtv-disable[^>]*checked[^>]*aria-label="Disable HbbTV"/,'HbbTV off: the win switch is on');assert.match(memory,/Done · HbbTV and its service are stopped/);
 assert.match(memory,/Disable MultiScreen autostart/);assert.match(memory,/data-win-switch="multiscreen" checked/);assert.match(memory,/Done · Multi View starts when you open it/);assert.match(memory,/chip[^>]*\bon\b[^>]*>Done · Multi View starts when you open it/,'a finished win is green, not yellow');
 assert.match(memory,/Stop Ambient \(partial block\)/);assert.match(memory,/Samsung’s screen service starts the app again within seconds/,'the copy says the block is partial');
 assert.match(memory,/Partly done · Samsung started it again/,'chosen but running again is shown as partly done');assert.doesNotMatch(memory,/data-win-switch="ambient" checked/);
 const tracking=el('quickTracking').innerHTML;
 assert.match(tracking,/Disable all advertising and tracking/);assert.match(tracking,/Partly done · 2 of 3 components still enabled/,'the Smart Hub ad agent (role keep) is not a member');
 assert.doesNotMatch(tracking,/coba\.adagent/);
 assert.match(voice,/Disable all voice assistants/);assert.match(voice,/Partly done · 4 of 5 components still enabled/,'the assistant hub is a member of the all-in switch');
 assert.match(el('quickControl').innerHTML,/Disable automatic firmware update/);assert.doesNotMatch(el('quickControl').innerHTML,/data-win-switch="firmware" checked/);
 assert.doesNotMatch(html,/quick wins applied|quickScore/,'no progress counter');
 assert.doesNotMatch(html,/quickPrivacy|Disable viewing-data tracking/,'one Advertising and tracking section: the ACR switch is covered by the all-in switch');
 assert.equal((tracking.match(/data-quick-toggle=/g)||[]).length,1,'a single tracking group switch');
 assert.match(tracking,/No domains saved/);assert.match(tracking,/data-quick-open="dns"/,'the domain filter sits with the tracking switch');
 assert.match(el('quickStorage').innerHTML,/1 package file · 2 KiB/);
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
 const hb={dataset:{hbbtvDisable:''},checked:false};await el('quick').onchange({target:hb});await tick();await tick();
 assert.deepEqual(calls.filter(c=>c.url==='/hbbtv'&&c.body).at(-1).body,{off:false,expected:19},'switching the win off turns HbbTV back on');
 const clear={dataset:{leftoversClear:''}};el('quick').onclick({target:{closest:()=>clear}});assert.match(el('quickStorage').innerHTML,/Delete 1 package file \(2 KiB\)\?/);assert.ok(!calls.some(c=>c.url==='/leftovers'&&c.body),'cleanup needs confirmation');
 console.log('PASS quick UI: wins read as done or not, partial states, new switches, microphone confirmation, shared inventory, cleanup confirmation');
})().catch(e=>{console.error(e);process.exitCode=1});
