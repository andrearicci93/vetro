'use strict';
const assert=require('assert').strict,path=require('path'),EventEmitter=require('events');
const h=require('./service-harness.cjs')(path.resolve(__dirname,'..'));
h.context.dock.readState=()=>({enabled:true});
let sent=0;h.context.agentExecute=()=>{sent++;return Promise.resolve({exit_code:0,stdout:''});};
function post(url,body){return new Promise(resolve=>{const req=new EventEmitter();req.method='POST';req.url=url;h.router(req,{writeHead(code){this.code=code;},end(text){resolve({code:this.code,data:JSON.parse(text)});}});req.emit('data',Buffer.from(JSON.stringify(body)));req.emit('end');});}
(async()=>{
 for(const off of [true,false]){const r=await post('/quick',{id:'samsung-home',off});assert.equal(r.code,409);assert.match(r.data.error,/Turn off the Vetro launcher/);}
 const r=await post('/debloat',{action:'disable',appIds:['com.samsung.tv.csfs']});assert.equal(r.code,409);assert.equal(sent,0,'conflicting operations send no TV command');
 console.log('PASS launcher/Home interlock across Quick settings and Task manager');
})().catch(e=>{console.error(e);process.exitCode=1;});
