'use strict';
const assert=require('assert').strict,EventEmitter=require('events'),path=require('path');
const platform=require('../service/platform.js');
const commands=[];platform.execute=cmd=>{commands.push(cmd);return Promise.resolve({exit_code:0,stdout:''});};
const service=require('./service-harness.cjs')(path.resolve(__dirname,'..')),context=service.context,router=service.router;
function post(url,body){return new Promise(resolve=>{const req=new EventEmitter();req.method='POST';req.url=url;const res={writeHead(n){this.status=n},end(s){resolve({status:this.status,data:JSON.parse(s)})}};router(req,res);req.emit('data',Buffer.from(JSON.stringify(body)));req.emit('end');});}
(async()=>{
 const rule={id:'physical',trigger:{type:'physical',value:'068'},actions:[{type:'launch',appId:'app.selected'},{type:'key',key:'KEY_ENTER'}]};
 assert.equal((await post('/remap',{rules:[rule]})).data.rules[0].trigger.value,'68');
 const result=await post('/remap/run',{type:'physical',value:'68'});
 assert.equal(result.data.transport,'native');assert.equal(result.data.sent,2);
 assert.deepEqual(commands,['/usr/bin/app_launcher -s app.selected','/usr/bin/input_keyevent Return']);
 assert.equal((await post('/remap',{rules:[{...rule,trigger:{type:'physical',value:'768'}}]})).status,400);
 const panelRule={id:'panel',trigger:{type:'http',value:'panel'},actions:[{type:'inputs',appId:'ignored'}]};
 const panelSaved=await post('/remap',{rules:[panelRule]});
 assert.deepEqual(panelSaved.data.rules[0].actions,[{type:'inputs'}],'the inputs action keeps no other fields');
 commands.length=0;let opened=0;context.dock.openInputs=()=>{opened++;return Promise.resolve({ok:true,panel:'inputs'})};
 const panelRun=await post('/remap/run',{type:'http',value:'panel'});
 assert.equal(panelRun.data.sent,1);assert.equal(opened,1);assert.deepEqual(commands,[],'the panel is opened by the launcher, not by a raw key');
 assert.equal((await post('/remap',{rules:[{...panelRule,actions:[{type:'inputs',key:'Up'}]}]})).data.rules[0].actions.length,1);

 // A launcher-off inputs action is skipped, not fatal: interception and the helper stay up.
 const offPanel={id:'panel-off',enabled:true,trigger:{type:'physical',value:'70'},actions:[{type:'inputs'}]};
 const afterRule={id:'after',enabled:true,trigger:{type:'physical',value:'71'},actions:[{type:'launch',appId:'app.after'}]};
 await post('/remap',{rules:[offPanel,afterRule]});
 let stops=0;const realStop=context.physical.stop.bind(context.physical);
 context.physical.stop=function(){stops++;return realStop();};
 context.dock.openInputs=()=>Promise.reject(Object.assign(new Error('The Vetro launcher is off; turn it on to use the inputs panel'),{nonFatal:true}));
 context.physical.onEvent({action:'down',decision:'blocked',code:70});
 await context.actionQueue;
 assert.equal(context.inputPaused,false,'a launcher-off shortcut does not pause interception');
 assert.equal(stops,0,'the remote helper is not stopped');
 assert.match(context.inputError,/launcher is off/);
 commands.length=0;
 context.physical.onEvent({action:'down',decision:'blocked',code:71});
 await context.actionQueue;
 assert.deepEqual(commands,['/usr/bin/app_launcher -s app.after'],'the next mapped key still runs');
 console.log('PASS native remap: canonical physical codes, selected app, whitelisted native key and the launcher inputs panel');
})().catch(e=>{console.error(e);process.exitCode=1});
