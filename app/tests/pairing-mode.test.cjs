'use strict';
const assert=require('assert').strict,fs=require('fs'),os=require('os'),path=require('path'),EventEmitter=require('events');
process.env.VETRO_AUTH_PATH=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'vetro-pairing-mode-')),'auth.json');
let auth=require('../service/auth.js');
const h=require('./service-harness.cjs')(path.resolve(__dirname,'..'),{dependencies:{'./platform.js':{start(){},status:()=>({mode:'tv-integration',agent:{connected:false}})}},setInterval(){return {unref(){}};}});
function call(method,url,body,opts){opts=opts||{};return new Promise(resolve=>{const req=new EventEmitter();Object.assign(req,{method,url,headers:Object.assign({host:'192.0.2.10:8099'},opts.headers),socket:{remoteAddress:opts.local?'127.0.0.1':'192.0.2.20'}});h.router(req,{writeHead(code,headers){this.code=code;this.headers=headers;},end(s){let data=s;try{data=JSON.parse(s);}catch(e){}resolve({code:this.code,data,headers:this.headers});}});if(body!==undefined){req.emit('data',Buffer.from(JSON.stringify(body)));req.emit('end');}});}
function reload(){delete require.cache[require.resolve('../service/auth.js')];return require('../service/auth.js');}
(async()=>{
 assert.equal(auth.pairingMode().disabled,false);
 assert.equal((await call('POST','/pairing-mode',{disabled:true})).code,401);
 const start=await call('POST','/auth/pair',{name:'test'});
 const pending=await call('GET','/auth/pending',undefined,{local:true});
 const confirmed=await call('POST','/auth/confirm',{id:start.data.id,code:pending.data.code});
 assert.equal(confirmed.code,200);const paired={headers:{authorization:'Bearer '+confirmed.data.token}};
 assert.equal((await call('POST','/pairing-mode',{disabled:'yes'},{local:true})).code,400);
 assert.equal((await call('POST','/pairing-mode',{disabled:true},paired)).data.disabled,true);
 assert.equal(reload().pairingMode().disabled,true,'disabled persists across service restart');
 assert.equal((await call('GET','/status')).code,200,'unpaired LAN client admitted only after opt-out');
 assert.equal((await call('GET','/auth/pending')).code,403,'pairing code stays TV-only');
 assert.equal((await call('POST','/pairing-mode',{disabled:false},{headers:{origin:'http://evil.example'}})).code,403);
 assert.equal((await call('GET','/status',undefined,{headers:{origin:'null'}})).code,403);
 assert.equal((await call('GET','/status',undefined,{headers:{host:'rebound.example'}})).code,403);
 const write=fs.writeFileSync;fs.writeFileSync=()=>{throw Error('disk full');};
 try{assert.throws(()=>auth.setPairingMode(false),/disk full/);assert.equal(auth.pairingMode().disabled,true);}finally{fs.writeFileSync=write;}
 assert.equal((await call('POST','/pairing-mode',{disabled:false})).data.disabled,false);
 assert.equal((await call('GET','/status')).code,401,'turning off immediately restores authentication');
 assert.equal((await call('GET','/status',undefined,paired)).code,200,'paired keys survive switching modes');
 assert.equal(reload().pairingMode().disabled,false);
 fs.writeFileSync(auth.MODE_PATH,'broken');assert.equal(reload().pairingMode().disabled,false,'corruption fails closed');
 console.log('PASS pairing mode: default auth, persisted opt-out, warning boundary, origin/host protection and recovery');
})().catch(e=>{console.error(e);process.exitCode=1;});
