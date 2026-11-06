'use strict';
const assert=require('assert').strict,EventEmitter=require('events'),path=require('path');
const {context,router}=require('./service-harness.cjs')(path.resolve(__dirname,'..'));
const id='MCmYXNxgcu.DisneyPlusService';let disabled=false,commands=[];
context.inventory=async()=>({apps:[{appId:id,packageId:'MCmYXNxgcu',system:false,removable:true,disabled}]});
context.agentExecute=async cmd=>{commands.push(cmd);if(/pkgcmd/.test(cmd))disabled=cmd.includes('pkgcmd -D');return {exit_code:0,stdout:'ok'};};
function request(body){return new Promise(resolve=>{const r=new EventEmitter();r.method='POST';r.url='/debloat';let status;router(r,{writeHead(n){status=n},end(data){resolve({status,body:JSON.parse(data)})}});r.emit('data',Buffer.from(JSON.stringify(body)));r.emit('end');});}
(async()=>{
 const result=await request({action:'disable',appIds:[id]});
 assert.equal(result.status,200,'an installed removable user component must support a verified disable attempt');
 assert.equal(result.body.verified,true);assert.equal(disabled,true);assert.equal(commands.filter(c=>/pkgcmd/.test(c)).length,1,'one pkgcmd; the ledger write is a second, separate command');
 await new Promise(r=>setImmediate(r));
 assert.equal((await request({action:'enable',appIds:[id]})).body.verified,true);assert.equal(disabled,false);
 console.log('PASS removable user app disable/enable through actual HTTP router');
})().catch(e=>{console.error(e);process.exitCode=1});
