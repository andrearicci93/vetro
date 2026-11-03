'use strict';
const assert=require('assert').strict, path=require('path'), EventEmitter=require('events');
const load=require('./service-harness.cjs');
let files={},running=false,failSave=false,devices=[{name:'Smart Control',node:'/dev/input/event6',selectable:true,unique:true}];
const commands=[],bridges=[];
class Bridge {
 constructor(execute,onEvent){this.onEvent=onEvent;this.policy={mode:'off',connected:false};bridges.push(this);}
 inventory(){return Promise.resolve(devices);}
 status(){return {policy:this.policy,events:[]};}
 stop(){this.policy={mode:'off',connected:false};}
 async start(node,mode,blocked){this.policy={device:'Smart Control',node,mode,connected:true,blocked};return this.status();}
}
class Dock {
 readState(){return {enabled:running};}
 async enable(){running=true;return this.status();}
 async disable(){running=false;return this.status();}
 status(){return Promise.resolve({enabled:running,running,installed:true});}
 async toggle(){commands.push('toggle');return true;}
}
const service=load(path.resolve(__dirname,'..'),{setInterval:()=>({unref(){}}),dependencies:{
 fs:{readFileSync:p=>files[p]||'',writeFileSync:(p,s)=>{if(failSave)throw Error('disk full');files[p]=s;},renameSync:(a,b)=>{files[b]=files[a];delete files[a];},unlinkSync:p=>{delete files[p];}},
 './physical-input.js':{Bridge},'./dock.js':{Dock},
 './platform.js':{start(){},status:()=>({agent:{connected:true}}),execute:async cmd=>{commands.push(cmd);return {exit_code:0,stdout:''};}}
}});
service.context.inventory=async()=>({apps:[{appId:'netflix.app',show:true,disabled:false}]});
function request(url,body){return new Promise(resolve=>{const req=new EventEmitter();req.url=url;req.method=body===undefined?'GET':'POST';let code;service.router(req,{writeHead(n){code=n;},end(s){resolve({code,body:JSON.parse(s)});}});if(body!==undefined){req.emit('data',Buffer.from(JSON.stringify(body)));req.emit('end');}});}
const home=(type,appId)=>({id:'physical_63',enabled:true,trigger:{type:'physical',value:'63'},actions:[{type,...(appId?{appId}:{})}]});
(async()=>{
 assert.equal((await request('/dock')).body.enabled,false);
 let r=await request('/dock',{action:'enable'});assert.equal(r.code,409);assert.equal(r.body.code,'home_detection_required');assert.equal(running,false);
 r=await request('/dock',{action:'enable',device:'/dev/input/event6',expectedRevision:0});assert.equal(r.code,200);assert.equal(r.body.enabled,true);assert.equal(r.body.home.ready,true);
 assert.equal(service.context.inputPreference().enabled,false);
 let activity=service.context.remoteActivity();assert.equal(activity.ready,true);
 service.context.physical.onEvent({action:'down',decision:'native',code:108});
 assert.equal(service.context.remoteActivity().sequence,activity.sequence+1,'unmapped navigation cancels startup too');
 activity=service.context.remoteActivity();service.context.physical.onEvent({action:'down',decision:'native',code:116,key:'XF86PowerOff'});
 assert.equal(service.context.remoteActivity().sequence,activity.sequence,'power-on itself does not cancel startup');
 service.context.physical.onEvent({action:'down',decision:'blocked',code:63});await service.context.actionQueue;assert.deepEqual(commands,['toggle']);
 r=await request('/remap',{rules:[home('launch','netflix.app')],expectedRevision:1});assert.equal(r.code,200);assert.equal(running,false);
 assert.equal((await request('/dock')).body.enabled,false);
 service.context.physical.onEvent({action:'down',decision:'blocked',code:63});await service.context.actionQueue;assert.equal(commands.at(-1),'/usr/bin/app_launcher -s netflix.app');
 await request('/input',{mode:'observe',device:'auto'});assert.equal((await request('/input')).body.status.policy.mode,'observe');
 assert.equal((await request('/input')).body.status.preference.enabled,false,'listening keeps the master preference');
 await request('/input',{mode:'resume'});assert.equal((await request('/input')).body.status.policy.mode,'filter','resume restores Home independently');
 await request('/input',{mode:'off'});assert.deepEqual((await request('/input')).body.status.policy.blocked,['63']);
 r=await request('/dock',{action:'enable',expectedRevision:2});assert.equal(r.body.enabled,true);
 const before=(await request('/remap')).body;
 failSave=true;r=await request('/remap',{rules:[],expectedRevision:3});assert.equal(r.code,409);assert.equal((await request('/remap')).body.rules[0].actions[0].type,'launcher');assert.equal(running,true);failSave=false;
 r=await request('/remap',{rules:[],expectedRevision:before.revision});assert.equal(r.code,200);assert.equal(running,false);assert.equal((await request('/input')).body.status.policy.mode,'off');
 await request('/input',{mode:'filter',device:'/dev/input/event6'});
 files['/sys/class/input/event6/device/capabilities/key']='1';files['/sys/class/input/event16/device/capabilities/key']='1';
 devices=[{name:'Smart Control',node:'/dev/input/event6',selectable:true,unique:false},{name:'Smart Control',node:'/dev/input/event16',selectable:true,unique:false}];
 await request('/input',{mode:'observe',device:'auto'});
 assert.equal((await request('/input')).body.status.preference.enabled,true,'Home detection keeps the switch enabled');
 await request('/input',{mode:'resume'});
 r=await request('/remap',{rules:[home('launcher')],device:'/dev/input/event16',expectedRevision:(await request('/remap')).body.revision});
 assert.equal(r.code,200,r.body.error);assert.equal(r.body.home.busy,false);assert.equal(r.body.home.phase,null);assert.equal(r.body.home.ready,true);
 const input=(await request('/input')).body.status;
 assert.equal(input.preference.enabled,true);assert.equal(input.preference.node,'/dev/input/event16');assert.deepEqual(input.policy.blocked,['63']);
 r=await request('/remap',null);assert.equal(r.code,400);
 r=await request('/dock',null);assert.equal(r.code,400);
 r=await request('/input',null);assert.equal(r.code,400);
 console.log('PASS Home HTTP: shared assignment, direct toggles, installed app edit, independent pause, capture resume, deletion, failed persistence and bounded invalid requests');
})().catch(e=>{console.error(e);process.exitCode=1;});
