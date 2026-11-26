'use strict';
const {launchCommand}=require('../service/dock-catalog.js').hbbtvLink;
const assert=require('assert').strict,EventEmitter=require('events'),path=require('path');
const platform=require('../service/platform.js');
const commands=[];platform.execute=cmd=>{commands.push(cmd);return Promise.resolve({exit_code:0,stdout:''});};
const harnessOpts=process.platform==='win32'?{dependencies:{'./updater.js':{Updater:function(){this.status=()=>({});this.notePid=()=>{};this.finish=()=>Promise.resolve();}}}}:undefined;
const loaded=require('./service-harness.cjs')(path.resolve(__dirname,'..'),harnessOpts);
const router=loaded.router;
function post(url,body){return new Promise(resolve=>{const req=new EventEmitter();req.method='POST';req.url=url;const res={writeHead(n){this.status=n},end(s){resolve({status:this.status,data:JSON.parse(s)})}};router(req,res);req.emit('data',Buffer.from(JSON.stringify(body)));req.emit('end');});}
(async()=>{
 const rule={id:'physical',trigger:{type:'physical',value:'068'},actions:[{type:'launch',appId:'app.selected'},{type:'key',key:'KEY_ENTER'}]};
 assert.equal((await post('/remap',{rules:[rule]})).data.rules[0].trigger.value,'68');
 const result=await post('/remap/run',{type:'physical',value:'68'});
 assert.equal(result.data.transport,'native');assert.equal(result.data.sent,2);
 assert.equal(commands.length,2);assert.equal(commands[0],launchCommand('app.selected'));
 // The whitelisted key is still sent by name; only while Vetro TV Tuner is on screen it goes to the tuner instead (key-routing.js).
 assert.ok(commands[1].endsWith("then ( exec 3<>/tmp/vetro-tuner.ctl && echo 'key 28' >&3 ); else /usr/bin/input_keyevent Return; fi"),commands[1]);
 assert.equal((await post('/remap',{rules:[{...rule,trigger:{type:'physical',value:'768'}}]})).status,400);

 // Plugin interception routing in runActions: direct cobalt-yt and wrapper 9Ur5IzDKqV.TizenYouTube both route via plugins.launch('com.samsung.tv.cobalt-yt').
 const pluginCalls=[];
 let pluginHandled=true;
 loaded.context.plugins={
  intercepted:()=>({'com.samsung.tv.cobalt-yt':{plugin:'youtube',label:'YouTube'}}),
  launch:appId=>{pluginCalls.push(appId);return Promise.resolve({handled:pluginHandled,plugin:'youtube'});},
  handle:()=>{}
 };
 const ytRule={id:'yt1',trigger:{type:'physical',value:'626'},actions:[{type:'launch',appId:'com.samsung.tv.cobalt-yt'}]};
 const wrapperRule={id:'yt2',trigger:{type:'physical',value:'627'},actions:[{type:'launch',appId:'9Ur5IzDKqV.TizenYouTube'}]};
 assert.equal((await post('/remap',{rules:[ytRule,wrapperRule]})).status,200);
 commands.length=0;
 const rCobalt=await post('/remap/run',{type:'physical',value:'626'});
 assert.equal(rCobalt.data.sent,1);
 assert.deepEqual(pluginCalls,['com.samsung.tv.cobalt-yt']);
 assert.equal(commands.length,0,'intercepted cobalt-yt does not fall back to raw app_launcher');
 const rWrapper=await post('/remap/run',{type:'physical',value:'627'});
 assert.equal(rWrapper.data.sent,1);
 assert.deepEqual(pluginCalls,['com.samsung.tv.cobalt-yt','com.samsung.tv.cobalt-yt']);
 assert.equal(commands.length,0,'intercepted wrapper YouTube routes through cobalt-yt plugin');

 pluginHandled=false;
 const rFallback=await post('/remap/run',{type:'physical',value:'627'});
 assert.equal(rFallback.data.sent,1);
 await new Promise(r=>setTimeout(r,50));
 assert.equal(commands.length,1);
 assert.equal(commands[0],launchCommand('9Ur5IzDKqV.TizenYouTube'),'falls back to hbbtvLink.launchCommand when plugin declines');

 // A plugin that takes a minute to get ready must not hold the action queue: the answer comes at once and the app is not started twice.
 let release;pluginHandled=true;
 loaded.context.plugins.launch=appId=>new Promise(res=>{release=()=>res({handled:true,plugin:'youtube'});});
 commands.length=0;
 const slowRule={id:'slow',trigger:{type:'physical',value:'628'},actions:[{type:'launch',appId:'com.samsung.tv.cobalt-yt'},{type:'key',key:'KEY_ENTER'}]};
 assert.equal((await post('/remap',{rules:[slowRule]})).status,200);
 const slow=await Promise.race([post('/remap/run',{type:'physical',value:'628'}),new Promise(r=>setTimeout(()=>r('held'),1500))]);
 assert.notEqual(slow,'held','a slow Shard launch does not hold the rule actions');
 assert.equal(slow.data.sent,2);
 release();await new Promise(r=>setTimeout(r,50));
 assert.equal(commands.filter(c=>c.indexOf('app_launcher')>=0).length,0,'a handled launch is not started again');

 const mainSrc=require('fs').readFileSync(path.resolve(__dirname,'..','service','main.js'),'utf8');
 assert.ok(mainSrc.includes("pgrep -f \\'[g]lscreensaver|[s]potlight-ss|[s]cm-screensaver\\'"),'diagnostics screensaverRunning avoids pgrep self-match and checks Tizen 9 screensavers');

 console.log('PASS native remap: canonical physical codes, selected app, whitelisted native key, and plugin YouTube routing');
})().catch(e=>{console.error(e);process.exitCode=1});
