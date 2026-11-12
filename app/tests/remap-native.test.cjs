'use strict';
const assert=require('assert').strict,EventEmitter=require('events'),path=require('path');
const platform=require('../service/platform.js');
const commands=[];platform.execute=cmd=>{commands.push(cmd);return Promise.resolve({exit_code:0,stdout:''});};
const router=require('./service-harness.cjs')(path.resolve(__dirname,'..')).router;
function post(url,body){return new Promise(resolve=>{const req=new EventEmitter();req.method='POST';req.url=url;const res={writeHead(n){this.status=n},end(s){resolve({status:this.status,data:JSON.parse(s)})}};router(req,res);req.emit('data',Buffer.from(JSON.stringify(body)));req.emit('end');});}
(async()=>{
 const rule={id:'physical',trigger:{type:'physical',value:'068'},actions:[{type:'launch',appId:'app.selected'},{type:'key',key:'KEY_ENTER'}]};
 assert.equal((await post('/remap',{rules:[rule]})).data.rules[0].trigger.value,'68');
 const result=await post('/remap/run',{type:'physical',value:'68'});
 assert.equal(result.data.transport,'native');assert.equal(result.data.sent,2);
 assert.equal(commands.length,2);assert.equal(commands[0],'/usr/bin/app_launcher -s app.selected');
 // The whitelisted key is still sent by name; only while Vetro TV Tuner is on screen it goes to the tuner instead (key-routing.js).
 assert.ok(commands[1].endsWith("then ( exec 3<>/tmp/vetro-tuner.ctl && echo 'key 28' >&3 ); else /usr/bin/input_keyevent Return; fi"),commands[1]);
 assert.equal((await post('/remap',{rules:[{...rule,trigger:{type:'physical',value:'768'}}]})).status,400);
 console.log('PASS native remap: canonical physical codes, selected app and whitelisted native key');
})().catch(e=>{console.error(e);process.exitCode=1});
