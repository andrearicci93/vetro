'use strict';
const assert=require('assert').strict,path=require('path'),EventEmitter=require('events');
const h=require('./service-harness.cjs')(path.resolve(__dirname,'..'));
function post(body){return new Promise(resolve=>{const req=new EventEmitter();req.method='POST';req.url='/remap';h.router(req,{writeHead(code){this.code=code},end(text){resolve({code:this.code,data:JSON.parse(text)})}});req.emit('data',Buffer.from(JSON.stringify(body)));req.emit('end')})}
(async()=>{
 const home={id:'home',enabled:true,trigger:{type:'physical',value:'63'},actions:[{type:'launch',appId:'other.Home'}]};
 const r=await post({rules:[home]});assert.equal(r.code,400);assert.match(r.data.error,/Home destination/);
 h.context.remapStore.rules=[home,{...home,id:'other',trigger:{type:'physical',value:'398'}}];
 assert.deepEqual(Array.from(h.context.inputTokens()),['398'],'legacy Home rules cannot intercept native Home');
 console.log('PASS Home key reserved for launcher ownership; other shortcuts preserved');
})().catch(e=>{console.error(e);process.exitCode=1});
