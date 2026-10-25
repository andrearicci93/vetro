'use strict';
const assert=require('assert').strict,{Control,FLAG,SERVICE}=require('../service/hbbtv.js');
// A small TV: the menu value, the brake file in /tmp, whether hbbtv_app and hbbtv_service run. Scripts are read, not run.
// Like the real one, it starts HbbTV again when the app dies while the service is running (the brake file does not stop that).
function tv(start){
 const s=Object.assign({value:20,flag:false,running:true,service:true,fail:null,appStarts:0,svcStarts:0},start),scripts=[];
 const execute=async cmd=>{const sh=Buffer.from(cmd.split(' ')[1],'base64').toString();scripts.push(sh);
  if(sh.includes('__FLAG__'))return {exit_code:0,stdout:'value = '+s.value+' (Int32)\n__FLAG__\n'+(s.flag?1:0)+'\n__RUN__\n'+(s.running?1:0)+'\n__SVC__\n'+(s.service?1:0)+'\n'};
  if(s.fail&&s.fail(sh))return {exit_code:1,stdout:'',stderr:'boom'};
  const set=/vconftool set -f -t int \S+ (-?\d+)/.exec(sh);if(set)s.value=Number(set[1]);
  if(sh.includes('touch '+FLAG))s.flag=true;if(/rm -f /.test(sh)&&sh.includes(FLAG))s.flag=false;
  // order inside the script matters: stop the service first, then the app
  sh.split('\n').forEach(line=>{
   if(line.startsWith('if app_launcher -S')&&line.includes('org\\.tizen\\.hbbtv-service')&&line.includes('-t org.tizen.hbbtv-service'))s.service=false;
   if(line.startsWith('if app_launcher -S')&&line.includes('-t org.tizen.hbbtv ')){s.running=false;if(s.service)s.running=true;/* the service starts it again */}
   if(line.startsWith('app_launcher -s '+SERVICE)||(line.startsWith('if ! app_launcher -S')&&line.includes('then app_launcher -s '+SERVICE))&&!s.service){s.service=true;s.svcStarts++;}
   if(line==='app_launcher -s org.tizen.hbbtv'){s.running=true;s.appStarts++;}
  });
  return {exit_code:0,stdout:''};};
 return {s,scripts,execute};
}
(async()=>{
 let backup=null;const io={readFileSync(){if(!backup)throw Error('absent');return backup},writeFileSync(f,t){backup=t},renameSync(){}};
 // Samsung's menu value Off is not enough: the app and its service still run and nothing blocks the relaunch.
 let t=tv({value:19,flag:false,running:true,service:true}),c=new Control(t.execute,io);
 let r=await c.read();assert.equal(r.valueOff,true);assert.equal(r.off,false,'value 19 with the app running is not off');assert.equal(r.running,true);assert.equal(r.serviceRunning,true);
 await assert.rejects(c.change(false,19),/not saved/);
 await assert.rejects(c.change(true,20),/Value changed/);
 // The service goes first: the script stops it before it touches the app.
 r=await c.change(true,19);assert.equal(r.changed,true);assert.equal(r.off,true);assert.equal(t.s.flag,true);assert.equal(t.s.running,false);assert.equal(t.s.service,false);assert.equal(t.s.appStarts+t.s.svcStarts,0,'off never starts anything');
 const off=t.scripts.find(s=>s.includes('touch '+FLAG));assert.ok(off.indexOf('-t org.tizen.hbbtv-service')>0&&off.indexOf('-t org.tizen.hbbtv-service')<off.indexOf('-t org.tizen.hbbtv '),'service is stopped before the app');
 assert.ok(t.scripts.every(s=>!/app_launcher -s/.test(s)),'no script on the way off starts anything');
 assert.equal((await c.change(true,19)).changed,false,'already off: nothing to do');
 // Turning off from On saves the value, writes 19 and restores it exactly; on starts the service and the app and drops both files.
 t=tv({value:20,flag:false,running:true,service:true});backup=null;c=new Control(t.execute,io);
 assert.equal((await c.read()).canRestore,false);
 r=await c.change(true,20);assert.equal(r.off,true);assert.equal(t.s.value,19,'Samsung menu Off writes 19, not 0');assert.equal(JSON.parse(backup).value,20);assert.equal(t.s.flag,true);
 r=await c.change(false,19);assert.equal(r.value,20,'restores the exact firmware value');assert.equal(r.off,false);assert.equal(t.s.flag,false);assert.equal(t.s.svcStarts,1,'the service is started once');assert.equal(t.s.appStarts,1,'and the app once');assert.equal(t.s.service,true);
 assert.ok(t.scripts.some(s=>s.includes('rm -f '+FLAG+' /tmp/hbbtv_app_running')),'the stale "app running" file is removed, or the service would skip the launch');
 assert.equal((await c.change(false,20)).changed,false,'already on');
 // An app that does not stop: the write is undone and the service comes back, instead of leaving HbbTV half off.
 t=tv({value:20,running:true,service:true});backup=null;const exec=t.execute;
 const stubborn=async cmd=>{const out=await exec(cmd);const sh=Buffer.from(cmd.split(' ')[1],'base64').toString();if(sh.includes('-t org.tizen.hbbtv '))t.s.running=true;return out;};
 c=new Control(stubborn,io);
 await assert.rejects(c.change(true,20),/still running.*previous state restored/);assert.equal(t.s.value,20);assert.equal(t.s.flag,false);assert.equal(t.s.service,true,'the service is back if the attempt failed');
 // After a boot the firmware has started both again and the brake file is gone: enforce puts the choice back.
 t=tv({value:19,flag:false,running:true,service:true});c=new Control(t.execute,io);
 assert.deepEqual(await c.enforce(),{stopped:true});assert.equal(t.s.flag,true);assert.equal(t.s.running,false);assert.equal(t.s.service,false);
 assert.equal((await c.enforce()).stopped,false,'second time: already off');
 t=tv({value:20,flag:false,running:true,service:true});c=new Control(t.execute,io);
 assert.equal((await c.enforce()).stopped,false,'HbbTV is on in the menu: left alone');assert.equal(t.s.running,true);assert.equal(t.s.service,true);assert.equal(t.s.flag,false);
 console.log('PASS HbbTV: Off = value, brake file, service stopped first, app stopped; never starts anything; exact restore; boot enforcement');
})().catch(e=>{console.error(e);process.exitCode=1});
