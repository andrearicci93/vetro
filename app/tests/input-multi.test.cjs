'use strict';
const assert=require('assert').strict, path=require('path'), EventEmitter=require('events');
const load=require('./service-harness.cjs'), root=path.resolve(__dirname,'..');
const devices=[
    {name:'wt61p807 rc device',node:'/dev/input/event1',unique:true,selectable:true},
    {name:'Smart Control',node:'/dev/input/event3',unique:true,selectable:true}
];
let disk=JSON.stringify({rules:[{id:'remote',enabled:true,trigger:{type:'physical',value:'67'},actions:[{type:'launch',appId:'example.app'}]}]});
const starts=[], commands=[], launched=[];
let gate=null, failing=null;
// Mirrors the real bridge: stop() bumps the generation, and a start that sees a newer
// generation once its inventory read returns is cancelled before any helper launches.
class Bridge {
    constructor(execute,onEvent){this.onEvent=onEvent;this.current={mode:'off',connected:false};this.generation=0;this.lastError=null;}
    inventory(){return Promise.resolve(devices);}
    status(){return {policy:this.current,events:[],error:this.lastError};}
    stop(){this.generation++;this.current={mode:'off',connected:false};}
    async start(device,mode,tokens){
        const generation=this.generation;
        starts.push({device:device,mode:mode,tokens:tokens});
        await gate;
        if(generation!==this.generation)throw new Error('input request cancelled');
        const found=devices.filter(function(d){return d.node===device;})[0];
        if(!found||device===failing){this.lastError='select a unique physical remote device';throw new Error(this.lastError);}
        launched.push(this);this.lastError=null;
        this.current={mode:mode,connected:true,device:found.name,node:device,blocked:tokens};
        return this.status();
    }
    disconnect(){this.lastError='input helper disconnected; original keys released';this.stop();}
}
let clock=1000;
function boot(){
    const timers=[];
    const service=load(root,{dependencies:{
        fs:{readFileSync:p=>p.endsWith('vetro-remap.json')?disk:'',
            writeFileSync:(p,s)=>{disk=s;}},
        './physical-input.js':{Bridge},
        './platform.js':{start(){},status:()=>({agent:{connected:true}}),execute:cmd=>{commands.push(cmd);return Promise.resolve({exit_code:0,stdout:''});}}
    },setInterval:fn=>{timers.push(fn);return {unref(){}};}});
    service.context.Date=class extends Date{static now(){return clock;}};
    service.tick=async()=>{timers.forEach(fn=>fn());await flush();};
    return service;
}
const flush=()=>new Promise(r=>setImmediate(r));
function request(service,method,body,url='/input'){
    return new Promise(resolve=>{
        const req=new EventEmitter();req.method=method;req.url=url;
        service.router(req,{writeHead(code){this.code=code;},end(s){resolve(JSON.parse(s));}});
        req.emit('data',Buffer.from(JSON.stringify(body||{})));req.emit('end');
    });
}
const post=(service,body,url)=>request(service,'POST',body,url);
const launches=()=>commands.filter(c=>c.includes('app_launcher -s example.app')).length;
const press=(bridge,node)=>bridge.onEvent({action:'down',decision:'blocked',code:67,node:node,time_seconds:1,time_microseconds:1});
const tracked=c=>[c.physical].concat(c.extraInputs);
(async()=>{
    const service=boot(), c=service.context;await service.tick();
    let result=await post(service,{device:devices[0].node,mode:'filter'});
    assert.equal(result.ok,true);
    assert.deepEqual(starts.map(s=>s.device),[devices[0].node,devices[1].node],'every selectable remote starts');
    assert.ok(starts.every(s=>s.mode==='filter'&&s.tokens[0]==='67'));
    assert.equal(c.inputSnapshot().policy.mode,'filter');
    assert.equal(c.inputSnapshot().policy.connected,true);
    assert.equal(c.inputSnapshot().policy.device,'all');
    assert.equal(c.extraInputs.length,1,'one helper per extra remote');

    press(c.physical,devices[0].node);await c.actionQueue;
    assert.equal(launches(),1,'the first remote runs the shortcut');
    clock+=100;press(c.extraInputs[0],devices[1].node);await c.actionQueue;
    assert.equal(launches(),1,'the same press arriving from a second interface runs once');
    clock+=100;press(c.physical,devices[0].node);await c.actionQueue;
    assert.equal(launches(),2,'a fast double press on one remote runs twice');
    clock+=400;press(c.extraInputs[0],devices[1].node);await c.actionQueue;
    assert.equal(launches(),3,'the second remote runs the same shortcut');

    // One helper crashes while the other stays connected: only the missing remote restarts.
    let count=starts.length;const healthy=c.physical.generation;
    c.extraInputs[0].disconnect();
    assert.equal(c.inputSnapshot().policy.connected,true);
    await service.tick();
    assert.deepEqual(starts.slice(count).map(s=>s.device),[devices[1].node],'the disconnected remote restarts');
    assert.equal(c.physical.generation,healthy,'the connected helper keeps running');
    assert.ok(tracked(c).every(b=>b.current.connected));
    count=starts.length;await service.tick();
    assert.equal(starts.length,count,'no restart while every remote is connected');

    // A remote that appears after interception started is picked up by the restore timer.
    devices.push({name:'Smart Control 2',node:'/dev/input/event5',unique:true,selectable:true});
    await service.tick();
    assert.deepEqual(starts.slice(count).map(s=>s.device),['/dev/input/event5']);
    assert.equal(c.extraInputs.length,2);
    devices.pop();

    // A remote whose helper keeps failing is reported, not hidden behind the connected ones.
    c.extraInputs[0].disconnect();failing=devices[1].node;await service.tick();
    let status=await request(service,'GET');
    assert.equal(status.status.policy.connected,true);
    assert.match(status.error||'',/select a unique physical remote/,'a partial restore failure stays visible');
    failing=null;await service.tick();
    status=await request(service,'GET');
    assert.equal(status.error,null,'the error clears once every remote is connected');

    // A stop while the helpers are still starting must not leave one running untracked.
    let release;gate=new Promise(r=>{release=r;});
    const pending=post(service,{mode:'filter'});await flush();
    await post(service,{rules:JSON.parse(disk).rules},'/remap');
    release();gate=null;result=await pending;await flush();
    assert.deepEqual(launched.filter(b=>b.current.connected),[],'no helper survives a stop issued during start');

    // Two overlapping starts leave one helper per remote, all tracked.
    gate=new Promise(r=>{release=r;});
    const first=post(service,{mode:'filter'});await flush();
    const second=post(service,{mode:'filter'});await flush();
    release();gate=null;await Promise.all([first,second]);await flush();
    const live=[...new Set(launched)].filter(b=>b.current.connected);
    assert.ok(live.every(b=>tracked(c).includes(b)),'every live helper is tracked');
    assert.ok(live.length<=devices.length);

    result=await post(service,{mode:'off'});
    assert.equal(result.ok,true);
    assert.equal(c.inputSnapshot().policy.connected,false);
    assert.equal(c.extraInputs.length,0,'off stops every helper');
    assert.deepEqual(launched.filter(b=>b.current.connected),[]);
    console.log('PASS input multi: every remote intercepted, cross-interface dedupe, per-remote restore, no helper leaks on stop');
})().catch(e=>{console.error(e);process.exitCode=1;});
