'use strict';
const assert=require('assert').strict,EventEmitter=require('events'),path=require('path');
const {context,router}=require('./service-harness.cjs')(path.resolve(__dirname,'..'));
const id='com.samsung.tv.acr';let disabled=false,commands=[],ignore=false;
context.inventory=async()=>({apps:[{appId:id,disabled}]});
context.agentExecute=async cmd=>{commands.push(cmd);if(!ignore&&/pkgcmd/.test(cmd))disabled=cmd.includes('pkgcmd -D');return {exit_code:0,stdout:'ok'};};
function req(body){return new Promise(resolve=>{const r=new EventEmitter();r.method='POST';r.url='/debloat';let status;router(r,{writeHead(n){status=n},end(data){resolve({status,body:JSON.parse(data)})}});r.emit('data',Buffer.from(JSON.stringify(body)));r.emit('end');});}
(async()=>{
 assert.equal((await req({action:'disable',appIds:['unverified.app']})).status,409);assert.equal(commands.length,0);
 assert.equal((await req({action:'disable',appIds:[id]})).body.verified,true);assert.ok(commands[0].endsWith('--global'));assert.equal(disabled,true);
 const plain=c=>{const m=/^echo (\S+) \| base64 -d \| sh$/.exec(c);return m?Buffer.from(m[1],'base64').toString():c};
 assert.ok(commands.some(c=>/disabled-by-vetro/.test(plain(c))&&/echo "com.samsung.tv.acr"/.test(plain(c))),'a disable is written to the ledger');
 await new Promise(r=>setImmediate(r));const count=commands.length;const noop=await req({action:'disable',appIds:[id]});assert.equal(noop.body.changed,false);assert.equal(noop.body.disabled,true);assert.equal(noop.body.appId,id);assert.equal(commands.length,count);await new Promise(r=>setImmediate(r));assert.equal((await req({action:'enable',appIds:[id]})).body.verified,true);assert.equal(disabled,false);assert.ok(commands.some(c=>/grep -v -x -F/.test(plain(c))),'an enable removes it from the ledger');
 await new Promise(r=>setImmediate(r));ignore=true;const failure=await req({action:'disable',appIds:[id]});assert.equal(failure.body.ok,false);assert.match(failure.body.error,/restored/);assert.ok(commands.at(-1).includes('pkgcmd -A'));
 console.log('PASS global app flags: tested targets only, global round trip, readback mismatch rollback');
})().catch(e=>{console.error(e);process.exitCode=1});
