'use strict';
const assert=require('assert').strict,fs=require('fs'),os=require('os'),path=require('path'),EventEmitter=require('events');
process.env.VETRO_AUTH_PATH=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'vetro-pairing-mode-')),'auth.json');
let auth=require('../service/auth.js');
const h=require('./service-harness.cjs')(path.resolve(__dirname,'..'),{dependencies:{'./platform.js':{start(){},status:()=>({mode:'tv-integration',agent:{connected:false}})}},setInterval(){return {unref(){}};}});
function call(method,url,body,opts){opts=opts||{};return new Promise(resolve=>{const req=new EventEmitter();Object.assign(req,{method,url,headers:Object.assign({host:'192.0.2.10:8099'},opts.headers),socket:{remoteAddress:opts.local?'127.0.0.1':'192.0.2.20'}});h.router(req,{writeHead(code,headers){this.code=code;this.headers=headers;},end(s){let data=s;try{data=JSON.parse(s);}catch(e){}resolve({code:this.code,data,headers:this.headers});}});if(body!==undefined){req.emit('data',Buffer.from(JSON.stringify(body)));req.emit('end');}});}
function reload(){delete require.cache[require.resolve('../service/auth.js')];return require('../service/auth.js');}
function callAt(method,url,body,opts){opts=opts||{};return new Promise(resolve=>{const req=new EventEmitter();Object.assign(req,{method,url,headers:Object.assign({host:'192.0.2.10:8099'},opts.headers),socket:{remoteAddress:opts.ip||(opts.local?'127.0.0.1':'192.0.2.20')}});h.router(req,{setHeader(k,v){(this.extra=this.extra||{})[k]=v;},writeHead(code,headers){this.code=code;this.headers=Object.assign({},this.extra,headers);},end(s){let data=s;try{data=JSON.parse(s);}catch(e){}resolve({code:this.code,data,headers:this.headers||this.extra||{}});}});if(body!==undefined){req.emit('data',Buffer.from(JSON.stringify(body)));req.emit('end');}});}
function unlink(f){try{fs.unlinkSync(f);}catch(e){}}
function modeFile(text){if(text===null)unlink(auth.MODE_PATH);else fs.writeFileSync(auth.MODE_PATH,text);return reload().pairingMode().enabled;}
(async()=>{
 // Automatic by default: never chosen, and the TV app not seen yet, so the service is open as in 0.3.5.
 assert.equal(auth.pairingMode().enabled,false);assert.equal(auth.pairingMode().disabled,true);assert.equal(auth.pairingMode().mode,'auto');assert.equal(auth.pairingMode().tvSeen,false);
 assert.equal((await call('GET','/status')).code,200,'unpaired LAN client admitted while pairing is off');
 assert.equal((await call('GET','/pairing-mode')).data.paired,false);
 // The TV page works from any address while pairing is off (the Q8F / Tizen 9 case), with the CORS answer it needs.
 const page=await callAt('GET','/status',undefined,{ip:'192.0.2.99',headers:{origin:'null',host:'127.0.0.1:8099'}});
 assert.equal(page.code,200);assert.equal(page.headers['Access-Control-Allow-Origin'],'null');
 assert.equal((await callAt('OPTIONS','/probe',undefined,{ip:'192.0.2.99',headers:{origin:'null',host:'127.0.0.1:8099'}})).code,204,'report preflight allowed');
 assert.equal((await callAt('GET','/screen',undefined,{ip:'192.0.2.99',headers:{origin:'null',host:'127.0.0.1:8099'}})).headers['Access-Control-Allow-Origin'],'null');
 // A runtime that sends its own scheme as Origin is answered too (0.3.5 never looked at it); a web site never is.
 const scheme=await callAt('GET','/status',undefined,{ip:'192.0.2.99',headers:{origin:'file://',host:'127.0.0.1:8099'}});
 assert.equal(scheme.code,200);assert.equal(scheme.headers['Access-Control-Allow-Origin'],'file://');
 assert.equal((await callAt('GET','/status',undefined,{ip:'192.0.2.99',headers:{origin:'https://evil.example',host:'127.0.0.1:8099'}})).code,403);
 assert.equal((await callAt('GET','/status',undefined,{ip:'192.0.2.99',headers:{origin:'HTTP://evil.example',host:'127.0.0.1:8099'}})).code,403);
 assert.equal((await call('POST','/exec',{},{headers:{origin:'file://'}})).code,403,'a TV page origin opens only the check routes');
 // ...but an opaque Origin (sandboxed web page) is still refused everywhere else, and so are rebinding and cross-site.
 assert.equal((await call('POST','/exec',{},{headers:{origin:'null'}})).code,403);
 assert.equal((await call('GET','/apps',undefined,{headers:{origin:'null'}})).code,403);
 assert.equal((await call('GET','/status',undefined,{headers:{origin:'null',host:'rebound.example'}})).code,403);
 assert.equal((await call('GET','/status',undefined,{headers:{host:'rebound.example'}})).code,403);
 assert.equal((await call('POST','/pairing-mode',{enabled:true},{headers:{origin:'http://evil.example'}})).code,403);
 const cross=await callAt('GET','/status',undefined,{headers:{origin:'http://evil.example'}});
 assert.equal(cross.code,403);assert.equal(cross.headers['Access-Control-Allow-Origin'],'*');assert.equal(cross.data.seen.origin,'http://evil.example');
 assert.equal((await call('GET','/auth/pending')).code,403,'pairing code stays TV-only');
 // None of this counted as "the TV app was seen": the page from another address, and a program on the TV without the page's Origin.
 assert.equal((await callAt('GET','/status',undefined,{local:true,headers:{host:'127.0.0.1:8099'}})).code,200);
 assert.equal((await callAt('GET','/status',undefined,{ip:'192.0.2.99',headers:{origin:'null',host:'127.0.0.1:8099'}})).code,200);
 assert.equal((await callAt('GET','/status',undefined,{local:true,headers:{origin:'file://',host:'127.0.0.1:8099'}})).code,200);
 assert.equal((await callAt('GET','/probe',undefined,{local:true,headers:{origin:'null',host:'192.0.2.10:8099'}})).code,200);
 assert.equal(auth.pairingMode().tvSeen,true,'the TV page (opaque Origin, from the TV) on a check route marks the TV as seen');
 assert.equal(fs.existsSync(auth.TV_PATH),true);
 assert.equal(auth.pairingMode().enabled,true,'automatic pairing is on once the TV app was seen');
 assert.equal((await call('GET','/status')).code,401,'unpaired LAN client must pair once the TV app was seen');
 assert.equal(reload().pairingMode().enabled,true,'seen survives a service restart');
 // Back to the state before the TV was seen, for the checks below.
 unlink(auth.TV_PATH);reload();
 auth._forgetTv();
 assert.equal(auth.pairingMode().enabled,false);
 // Turning pairing on needs a paired browser (or the TV), so nobody locks themselves out.
 const refused=await call('POST','/pairing-mode',{enabled:true});
 assert.equal(refused.code,409);assert.equal(refused.data.needPair,true);assert.equal(auth.pairingMode().enabled,false);
 assert.equal((await call('POST','/pairing-mode',{enabled:'yes'})).code,400);
 const start=await call('POST','/auth/pair',{name:'test'});
 const pending=await call('GET','/auth/pending',undefined,{local:true});
 const confirmed=await call('POST','/auth/confirm',{id:start.data.id,code:pending.data.code});
 assert.equal(confirmed.code,200);const paired={headers:{authorization:'Bearer '+confirmed.data.token}};
 assert.equal((await call('GET','/pairing-mode',undefined,paired)).data.paired,true);
 const on=await call('POST','/pairing-mode',{enabled:true},paired);
 assert.equal(on.data.enabled,true);assert.equal(on.data.disabled,false);
 assert.deepEqual(JSON.parse(fs.readFileSync(auth.MODE_PATH,'utf8')),{enabled:true,disabled:false},'0.5.0 reads the same choice after a downgrade');
 assert.equal(reload().pairingMode().enabled,true,'on persists across service restart');
 assert.equal((await call('GET','/status')).code,401,'unpaired LAN client must pair');
 assert.equal((await call('GET','/status',undefined,paired)).code,200,'paired keys work');
 assert.equal((await callAt('GET','/status',undefined,{headers:{origin:'null',host:'127.0.0.1:8099'},local:true})).code,200,'the TV itself passes');
 const write=fs.writeFileSync;fs.writeFileSync=()=>{throw Error('disk full');};
 try{assert.throws(()=>auth.setPairingEnabled(false),/disk full/);assert.equal(auth.pairingMode().enabled,true);}finally{fs.writeFileSync=write;}
 // Off again: immediate, and paired keys survive.
 assert.equal((await call('POST','/pairing-mode',{enabled:false},paired)).data.enabled,false);
 assert.equal((await call('GET','/status')).code,200);
 assert.equal((await call('POST','/pairing-mode',{enabled:true},paired)).data.enabled,true,'already paired: no new pairing needed to turn it back on');
 assert.equal((await call('GET','/status',undefined,paired)).code,200,'paired keys survive switching modes');
 // The 0.5.0 form of the request still works.
 assert.equal((await call('POST','/pairing-mode',{disabled:true},paired)).data.enabled,false);
 // Migration: what each file means.
 unlink(auth.TV_PATH);
 assert.equal(modeFile(null),false,'no file (fresh install, or first 0.5.0 release never touched): automatic, TV not seen, so open');
 assert.equal(reload().pairingMode().mode,'auto');
 fs.writeFileSync(auth.TV_PATH,'{"seen":true}');
 assert.equal(modeFile(null),true,'no file but the TV app was seen: automatic is on');
 assert.equal(modeFile('{"enabled":false,"disabled":true}\n'),false,'an explicit off wins over a seen TV');
 unlink(auth.TV_PATH);
 assert.equal(modeFile('{"disabled":true}\n'),false,'0.5.0 opt-out: off');
 assert.equal(modeFile('{"disabled":false}\n'),true,'0.5.0 explicit re-enable: on');
 assert.equal(modeFile('{"enabled":true,"disabled":false}\n'),true);
 assert.equal(modeFile('{"enabled":false,"disabled":true}\n'),false);
 assert.equal(modeFile('broken'),true,'an unreadable choice stays on');
 assert.equal(modeFile('{}'),true,'a choice that is not understood stays on');
 modeFile(null);
 console.log('PASS pairing mode: automatic by default (open until the TV app is seen, then on), TV page answered from any address while open, opaque origins refused elsewhere, turning on needs a paired browser, persisted choice, 0.5.0 files migrated, paired keys kept');
})().catch(e=>{console.error(e);process.exitCode=1;});
