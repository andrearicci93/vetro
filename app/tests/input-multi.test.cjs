'use strict';
const assert=require('assert').strict, path=require('path'), EventEmitter=require('events');
const load=require('./service-harness.cjs'), root=path.resolve(__dirname,'..');
const devices=[
    {name:'wt61p807 rc device',node:'/dev/input/event1',unique:true,selectable:true},
    {name:'Smart Control',node:'/dev/input/event3',unique:true,selectable:true}
];
let disk=JSON.stringify({rules:[{id:'remote',enabled:true,trigger:{type:'physical',value:'67'},actions:[{type:'launch',appId:'example.app'}]}]});
const starts=[], commands=[];
class Bridge {
    constructor(execute,onEvent){this.onEvent=onEvent;this.current={mode:'off',connected:false};}
    inventory(){return Promise.resolve(devices);}
    status(){return {policy:this.current,events:[]};}
    stop(){this.current={mode:'off',connected:false};}
    async start(device,mode,tokens){
        const found=devices.filter(function(d){return d.node===device;})[0];
        assert.ok(found,'known device: '+device);
        starts.push({device:device,mode:mode,tokens:tokens});
        this.current={mode:mode,connected:true,device:found.name,node:device,blocked:tokens};
        return this.status();
    }
}
function boot(){
    const timers=[];
    const service=load(root,{dependencies:{
        fs:{readFileSync:p=>p.endsWith('vetro-remap.json')?disk:'',
            writeFileSync:(p,s)=>{disk=s;}},
        './physical-input.js':{Bridge},
        './platform.js':{start(){},status:()=>({agent:{connected:true}}),execute:cmd=>{commands.push(cmd);return Promise.resolve({exit_code:0,stdout:''});}}
    },setInterval:fn=>{timers.push(fn);return {unref(){}};}});
    service.tick=async()=>{timers.forEach(fn=>fn());await new Promise(r=>setImmediate(r));};
    return service;
}
function post(service,body,url='/input'){
    return new Promise(resolve=>{
        const req=new EventEmitter();req.method='POST';req.url=url;
        service.router(req,{writeHead(code){this.code=code;},end(s){resolve(JSON.parse(s));}});
        req.emit('data',Buffer.from(JSON.stringify(body)));req.emit('end');
    });
}
(async()=>{
    const service=boot();await service.tick();
    let result=await post(service,{device:devices[0].node,mode:'filter'});
    assert.equal(result.ok,true);
    assert.deepEqual(starts.map(s=>s.device),[devices[0].node,devices[1].node],'every selectable remote starts');
    assert.ok(starts.every(s=>s.mode==='filter'&&s.tokens[0]==='67'));
    assert.equal(service.context.inputSnapshot().policy.mode,'filter');
    assert.equal(service.context.inputSnapshot().policy.connected,true);
    assert.equal(service.context.inputSnapshot().policy.device,'all');
    assert.equal(service.context.extraInputs.length,1,'one helper per extra remote');

    service.context.physical.onEvent({action:'down',decision:'blocked',code:67,time_seconds:1,time_microseconds:1});
    await service.context.actionQueue;
    assert.equal(commands.filter(c=>c.includes('app_launcher -s example.app')).length,1,'the first remote runs the shortcut');

    await new Promise(r=>setTimeout(r,150));
    service.context.extraInputs[0].onEvent({action:'down',decision:'blocked',code:67,time_seconds:2,time_microseconds:2});
    await service.context.actionQueue;
    assert.equal(commands.filter(c=>c.includes('app_launcher -s example.app')).length,2,'the second remote runs the same shortcut');

    result=await post(service,{mode:'off'});
    assert.equal(result.ok,true);
    assert.equal(service.context.inputSnapshot().policy.connected,false);
    assert.equal(service.context.extraInputs.length,0,'off stops every helper');
    console.log('PASS input multi: every selectable remote is intercepted, either one runs the rule, off stops all');
})().catch(e=>{console.error(e);process.exitCode=1;});
