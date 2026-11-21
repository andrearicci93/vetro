'use strict';
const {launchCommand}=require('../service/dock-catalog.js').hbbtvLink;
const assert=require('assert').strict, path=require('path'), EventEmitter=require('events');
const load=require('./service-harness.cjs'), root=path.resolve(__dirname,'..');
let disk=JSON.stringify({rules:[{id:'remote',enabled:true,trigger:{type:'physical',value:'67'},actions:[{type:'launch',appId:'example.app'}]}]}), ready=true, pending=null, node='/dev/input/event4', writesFail=false;
const starts=[], commands=[];
class Bridge {
 constructor(execute,onEvent){this.onEvent=onEvent;this.current={mode:'off',connected:false};}
 inventory(){return Promise.resolve([{name:'Smart Control',node,unique:true,selectable:true},{name:'wt61p807 rc device',node:'/dev/input/event1',unique:true,selectable:true}]);}
 status(){return {policy:this.current,events:[]};}
 stop(){this.current={mode:'off',connected:false};}
 async start(device,mode,tokens,list,options){assert.ok(ready);assert.ok(device==='all'||device==='Smart Control'||device===node);starts.push({device,mode,tokens,options});this.current={mode,connected:true,device:device==='all'?'all':'Smart Control',node:device==='all'?'all':node};if(options&&options.exclude)this.current.exclude=options.exclude;return this.status();}
}
function boot(){const timers=[];const service=load(root,{dependencies:{fs:{readFileSync:p=>p.endsWith('vetro-remap.json')?disk:'',writeFileSync:(p,s)=>{if(writesFail)throw Error('disk full');pending=s;},renameSync(){disk=pending;},unlinkSync(){pending=null;}},'./physical-input.js':{Bridge},'./platform.js':{start(){},status:()=>({agent:{connected:ready}}),execute:cmd=>{commands.push(cmd);return Promise.resolve({exit_code:0,stdout:''});}}},setInterval:fn=>{timers.push(fn);return {unref(){}};}});service.tick=async()=>{timers.forEach(fn=>fn());await new Promise(r=>setImmediate(r));};return service;}
function post(service,body,url='/input'){return new Promise(resolve=>{const req=new EventEmitter();req.method='POST';req.url=url;service.router(req,{writeHead(code){this.code=code;},end(s){resolve(JSON.parse(s));}});req.emit('data',Buffer.from(JSON.stringify(body)));req.emit('end');});}
(async()=>{
 let service=boot();await service.tick();assert.equal(starts.length,0);
 let result=await post(service,{device:node,mode:'filter'});assert.equal(result.ok,true);
 node='/dev/input/event7';ready=false;service=boot();await service.tick();assert.equal(starts.length,1);
 ready=true;await service.tick();assert.equal(starts.length,2,'saved interception must resume after restart when the adapter connects');assert.equal(service.context.physical.status().policy.mode,'filter');
 service.context.physical.onEvent({action:'down',decision:'blocked',code:67});await service.context.actionQueue;assert.ok(commands.includes(launchCommand('example.app')),'restored interception must execute the saved app shortcut');
 service.context.physical.stop();await service.tick();assert.equal(starts.length,3,'helper disconnection must reconnect');
 await post(service,{device:node,mode:'observe'});await service.tick();assert.equal(starts.length,4,'listening pauses interception without clearing the preference');assert.equal(JSON.parse(disk).input.enabled,true);
 service=boot();await service.tick();assert.equal(starts.at(-1).mode,'filter','listening is not restored after boot');
 const rules=JSON.parse(disk).rules;rules[0].trigger.value='68';await post(service,{rules},'/remap');await service.tick();assert.equal(starts.at(-1).tokens[0],'68','editing reconfigures saved interception');
 await post(service,{rules:[]},'/remap');let count=starts.length;await service.tick();assert.equal(starts.length,count,'no helper without physical shortcuts');
 await post(service,{rules},'/remap');await service.tick();assert.equal(starts.length,count+1,'interception resumes when shortcuts return');
 await post(service,{mode:'off'});count=starts.length;service=boot();await service.tick();assert.equal(starts.length,count,'explicit off must survive restart');
 result=await post(service,{device:'all',mode:'filter'});assert.equal(result.ok,true);assert.deepEqual(JSON.parse(disk).input,{enabled:true,device:'all',node:'all'});
 service=boot();await service.tick();assert.equal(starts.at(-1).device,'all','all-remotes mode must restore across restart');assert.equal(starts.at(-1).mode,'filter');
 result=await post(service,{device:'all',mode:'filter',exclude:['wt61p807 rc device']});assert.equal(result.ok,true);assert.deepEqual(JSON.parse(disk).input,{enabled:true,device:'all',node:'all',exclude:['wt61p807 rc device']});
 const beforeEx=starts.length;service=boot();await service.tick();assert.equal(starts.length,beforeEx+1);assert.deepEqual(JSON.parse(JSON.stringify(starts.at(-1).options)),{exclude:['wt61p807 rc device']},'excluded remote list restores across restart');
 result=await post(service,{device:'all',mode:'capture'});assert.equal(result.ok,true);assert.equal(service.context.physical.status().policy.mode,'capture');
 const cmdBeforeCap=commands.length;service.context.physical.onEvent({action:'down',decision:'blocked',code:68});await service.context.actionQueue;
 assert.equal(commands.length,cmdBeforeCap,'capture mode does not fire shortcuts');
 const aliasRules=[{id:'physical_150',enabled:true,trigger:{type:'physical',value:'150'},aliases:['560'],actions:[{type:'launch',appId:'example.browser'}]}];
 const savedAlias=await post(service,{rules:aliasRules},'/remap');assert.equal(savedAlias.ok,true);assert.deepEqual(Array.from(savedAlias.rules[0].aliases),['560']);
 const badAlias=await post(service,{rules:[{id:'physical_150',enabled:true,trigger:{type:'physical',value:'150'},aliases:['560'],actions:[{type:'launch',appId:'example.browser'}]},{id:'physical_221',enabled:true,trigger:{type:'physical',value:'221'},aliases:['560'],actions:[{type:'launch',appId:'example.prime'}]}]},'/remap');
 assert.ok(badAlias.error,'conflicting alias is rejected');
 const beforeAlias=starts.length;service=boot();await service.tick();assert.equal(starts.length,beforeAlias+1);
 assert.deepEqual(Array.from(starts.at(-1).tokens).sort(),['150','560'],'linked alias is blocked alongside primary trigger');
 service.context.physical.onEvent({action:'down',decision:'blocked',code:560});await service.context.actionQueue;
 assert.ok(commands.includes(launchCommand('example.browser')),'pressing linked alias executes rule');
 await post(service,{mode:'off'});
 writesFail=true;result=await post(service,{device:node,mode:'filter'});assert.equal(result.ok,false,'unsaved interception must not report success');assert.equal(service.context.physical.status().policy.mode,'off');
 console.log('PASS input persistence: delayed boot, changed event node, reconnection, capture, exclude, linked aliases, persistent off, disk failure');
})().catch(e=>{console.error(e);process.exitCode=1;});
