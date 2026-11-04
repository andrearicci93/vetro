'use strict';
const assert=require('assert').strict,path=require('path'),EventEmitter=require('events');
let enabled=false,changes=0;
const platform={start(){},status:()=>({mode:'tv-integration',agent:{connected:false}}),sdbAccess:()=>({enabled,active:enabled,available:true,port:26201}),setSdbAccess:async on=>{enabled=on;changes++;return platform.sdbAccess();}};
const h=require('./service-harness.cjs')(path.resolve(__dirname,'..'),{dependencies:{'./platform.js':platform},setInterval(){return {unref(){}};}});
function call(method,body,remote){return new Promise(resolve=>{const req=new EventEmitter();req.method=method;req.url='/sdb-access';req.headers={host:'127.0.0.1:8099'};req.socket={remoteAddress:remote||'127.0.0.1'};h.router(req,{writeHead(code){this.code=code;},end(text){resolve({code:this.code,body:JSON.parse(text)});}});if(body!==undefined){req.emit('data',Buffer.from(JSON.stringify(body)));req.emit('end');}});}
(async()=>{
 assert.equal((await call('GET',undefined,'192.0.2.1')).code,401);
 assert.equal((await call('POST',{enabled:true},'192.0.2.1')).code,401);assert.equal(changes,0);
 assert.equal((await call('GET')).body.active,false);
 assert.equal((await call('POST',{enabled:true})).body.active,true);
 assert.equal((await call('POST',{enabled:'yes'})).code,400);
 h.context.debloatBusy=true;assert.equal((await call('POST',{enabled:false})).code,409);h.context.debloatBusy=false;
 assert.equal((await call('POST',{enabled:false})).body.active,false);assert.equal(changes,2);
 console.log('PASS SDB access API: auth boundary, state, validation and restore lock');
})().catch(e=>{console.error(e);process.exitCode=1;});
