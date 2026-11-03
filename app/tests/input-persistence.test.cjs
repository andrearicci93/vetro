'use strict';
const assert=require('assert').strict, path=require('path'), EventEmitter=require('events');
const load=require('./service-harness.cjs'), root=path.resolve(__dirname,'..');
let disk=JSON.stringify({rules:[{id:'remote',enabled:true,trigger:{type:'physical',value:'67'},actions:[{type:'launch',appId:'example.app'}]}]}), ready=true, node='/dev/input/event4', writesFail=false;
const starts=[], commands=[];let temporary='';
class Dock {constructor(){this.enabled=false;}readState(){return {enabled:this.enabled};}async enable(){this.enabled=true;}async disable(){this.enabled=false;}supervise(){return Promise.resolve();}}
class Bridge {
 constructor(execute,onEvent){this.onEvent=onEvent;this.current={mode:'off',connected:false};}
 inventory(){return Promise.resolve([{name:'Smart Control',node,unique:true,selectable:true}]);}
 status(){return {policy:this.current,events:[]};}
 stop(){this.current={mode:'off',connected:false};}
 async start(device,mode,tokens){assert.ok(ready);assert.ok(device==='Smart Control'||device===node);starts.push({device,mode,tokens});this.current={mode,connected:true,device:'Smart Control',node};return this.status();}
}
function boot(){const timers=[];const service=load(root,{dependencies:{fs:{readFileSync:p=>p.endsWith('vetro-remap.json')?disk:'',writeFileSync:(p,s)=>{if(writesFail)throw Error('disk full');if(p.endsWith('.tmp'))temporary=s;else disk=s;},renameSync:()=>{disk=temporary;},unlinkSync:()=>{}},'./physical-input.js':{Bridge},'./dock.js':{Dock},'./platform.js':{start(){},status:()=>({agent:{connected:ready}}),execute:cmd=>{commands.push(cmd);return Promise.resolve({exit_code:0,stdout:''});}}},setInterval:fn=>{timers.push(fn);return {unref(){}};}});service.tick=async()=>{timers.forEach(fn=>fn());await new Promise(r=>setImmediate(r));};return service;}
function post(service,body,url='/input'){return new Promise(resolve=>{const req=new EventEmitter();req.method='POST';req.url=url;service.router(req,{writeHead(code){this.code=code;},end(s){resolve(JSON.parse(s));}});req.emit('data',Buffer.from(JSON.stringify(body)));req.emit('end');});}
(async()=>{
 let service=boot();await service.tick();assert.equal(starts.length,0);
 let result=await post(service,{device:node,mode:'filter'});assert.equal(result.ok,true);
 node='/dev/input/event7';ready=false;service=boot();await service.tick();assert.equal(starts.length,1);
 ready=true;await service.tick();assert.equal(starts.length,2,'saved interception must resume after restart when the adapter connects');assert.equal(service.context.physical.status().policy.mode,'filter');
 service.context.physical.onEvent({action:'down',decision:'blocked',code:67});await service.context.actionQueue;assert.ok(commands.includes('/usr/bin/app_launcher -s example.app'),'restored interception must execute the saved app shortcut');
 service.context.physical.stop();await service.tick();assert.equal(starts.length,3,'helper disconnection must reconnect');
 await post(service,{device:node,mode:'observe'});await service.tick();assert.equal(starts.length,4,'listening pauses interception without clearing the preference');assert.equal(JSON.parse(disk).input.enabled,true);
 service=boot();await service.tick();assert.equal(starts.at(-1).mode,'filter','listening is not restored after boot');
 const rules=JSON.parse(disk).rules;rules[0].trigger.value='68';await post(service,{rules},'/remap');await service.tick();assert.equal(starts.at(-1).tokens[0],'68','editing reconfigures saved interception');
 await post(service,{rules:[]},'/remap');let count=starts.length;await service.tick();assert.equal(starts.length,count,'no helper without physical shortcuts');
 await post(service,{rules},'/remap');await service.tick();assert.equal(starts.length,count+1,'interception resumes when shortcuts return');
 await post(service,{mode:'off'});count=starts.length;service=boot();await service.tick();assert.equal(starts.length,count,'explicit off must survive restart');
 const launcherRules=[{id:'home',enabled:true,trigger:{type:'physical',value:'63'},actions:[{type:'launcher'}]}];
 await post(service,{rules:launcherRules},'/remap');await post(service,{device:node,mode:'filter'});
 service=boot();await service.tick();let toggles=0;service.context.dock.toggle=()=>{toggles++;return true;};
 commands.length=0;service.context.physical.onEvent({action:'down',decision:'blocked',code:63});await service.context.actionQueue;
 assert.equal(toggles,1,'launcher action survives saved rule validation and interception restoration');
 assert.deepEqual(commands,[],'restored launcher shortcut does not inject Home or close an app');
 await post(service,{mode:'off'});
 writesFail=true;result=await post(service,{device:node,mode:'filter'});assert.equal(result.ok,false,'unsaved interception must not report success');assert.equal(service.context.physical.status().policy.mode,'filter','failed master change preserves the independently assigned Home route');
 console.log('PASS input persistence: delayed boot, changed event node, reconnection, temporary listening, rule edits, restored launcher action, persistent off, disk failure');
})().catch(e=>{console.error(e);process.exitCode=1;});
