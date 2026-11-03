'use strict';
const assert=require('assert').strict;
const {Control}=require('../service/hbbtv.js'),{Wins}=require('../service/quick-wins.js'),activation=require('../service/app-activation.js');
function fixture(){
 const files={},state={value:20,flag:false,hbb:true,svc:true,sd:false,ambient:true,ad:false,ms:true,msFlag:false,bootFlag:false},scripts=[];
 let refuse=null;
 const io={readFileSync:p=>{if(!(p in files))throw Error('missing');return files[p]},writeFileSync:(p,s)=>{files[p]=s},renameSync:(a,b)=>{files[b]=files[a];delete files[a]}};
 const execute=async cmd=>{
  const sh=Buffer.from(cmd.split(' ')[1],'base64').toString();scripts.push(sh);
  const s=state;
  if(sh.includes('__FLAG__'))return {exit_code:0,stdout:'value = '+s.value+' (Int32)\n__FLAG__\n'+Number(s.flag)+'\n__RUN__\n'+Number(s.hbb)+'\n__SVC__\n'+Number(s.svc)+'\n__DISABLED__\n'+s.sd+'\n'};
  if(sh.includes('echo "AU|'))return {exit_code:0,stdout:'AU|value = 0 (Int32)\nMS|'+Number(s.msFlag)+'\nMR|'+Number(s.ms)+'\nAR|'+Number(s.ambient)+'\n__Q74T__\npreload='+Number(s.bootFlag)+'\n'+s.ad+'\n'};
  for(const m of sh.matchAll(/pkgcmd (-D|-A) -t app -n ([\w.-]+) --global/g)){
   if(refuse===m[2]){refuse=null;return {exit_code:1,stderr:'activation refused'}}
   const off=m[1]==='-D';if(m[2]==='org.tizen.hbbtv-service'){s.sd=off;if(off)s.svc=false}else if(m[2]==='org.tizen.ambientapp'){s.ad=off;if(off)s.ambient=false}
  }
  const value=/data-service (-?\d+)/.exec(sh);if(value)s.value=+value[1];
  if(sh.includes('touch /tmp/hbbtv_do-not-relaunch'))s.flag=true;
  if(sh.includes('rm -f /tmp/hbbtv_do-not-relaunch'))s.flag=false;
  if(sh.includes('app_launcher -t org.tizen.hbbtv-service'))s.svc=!s.sd; // launchpad restarts it unless disabled
  if(sh.includes('app_launcher -t org.tizen.hbbtv '))s.hbb=s.svc;
  if(sh.includes('app_launcher -s org.tizen.hbbtv-service')&&!s.sd)s.svc=true;
  if(sh.includes('app_launcher -s org.tizen.hbbtv\n')||sh.endsWith('app_launcher -s org.tizen.hbbtv'))s.hbb=!s.sd;
  if(sh.includes('touch /home/owner/apps_rw/com.samsung.tv.multiscreen/data/disable_preloading'))s.msFlag=true;
  if(sh.includes('touch /tmp/multiview_disable_preloading'))s.bootFlag=true;
  if(sh.includes('systemctl stop com.samsung.tv.multiscreen.service'))s.ms=false;
  if(sh.includes('rm -f /home/owner/apps_rw/com.samsung.tv.multiscreen/data/disable_preloading'))s.msFlag=s.bootFlag=false;
  if(sh.includes('app_launcher -f org.tizen.ambientapp')&&!s.ad)s.ambient=true;
  let stdout='';if(sh.includes('SELECT app_disable'))stdout=(sh.includes("app_id='org.tizen.ambientapp'")?s.ad:s.sd)+'\n';
  return {exit_code:0,stdout};
 };
 return {state,files,scripts,io,execute,refuse:id=>{refuse=id}};
}
(async()=>{
 let t=fixture(),h=new Control(t.execute,t.io,{manageService:true});
 assert.equal((await h.read()).serviceDisabled,false);
 let s=await h.change(true,20);assert.equal(s.off,true);assert.equal(t.state.sd,true);assert.equal(t.state.svc,false);
 assert.ok(t.scripts.some(s=>s.includes('pkgcmd -D -t app -n org.tizen.hbbtv-service --global')));
 s=await h.change(false,19);assert.equal(s.value,20);assert.equal(t.state.sd,false);assert.equal(t.state.svc,true);
 await h.change(true,20);t.state.flag=false;await h.enforce();assert.equal((await h.read()).off,true,'boot restores ephemeral brake');
 t=fixture();h=new Control(t.execute,t.io,{manageService:true});t.refuse('org.tizen.hbbtv-service');
 await assert.rejects(h.change(true,20),/refused.*previous state restored/);assert.equal(t.state.sd,false);assert.equal(t.state.value,20);
 t=fixture();let w=new Wins(t.execute,{fs:t.io,tizen55:true});
 await w.apply('multiscreen',true);assert.equal(t.state.ms,false);assert.equal(t.state.bootFlag,true);
 t.state.bootFlag=false;t.state.ms=true;
 assert.equal((await w.read()).wins.multiscreen.status,'partial');await w.boot(null);assert.equal(t.state.bootFlag,true);assert.equal(t.state.ms,false);
 await w.apply('multiscreen',false);assert.equal(t.state.msFlag,false);assert.equal(t.state.bootFlag,false);
 await w.apply('ambient',true);s=(await w.read()).wins.ambient;assert.equal(s.status,'on');assert.equal(s.disabled,true);assert.equal(s.mode,'disabled');assert.equal(t.state.ambient,false);
 await w.apply('ambient',false);assert.equal(t.state.ad,false);assert.equal(t.state.ambient,true);
 t.refuse('org.tizen.ambientapp');await assert.rejects(w.apply('ambient',true),/refused.*previous activation restored/);assert.equal(w.load().ambient,false);assert.equal(t.state.ad,false);
 t.state.ad=true;await w.apply('ambient',true);await w.apply('ambient',false);assert.equal(t.state.ad,true,'externally disabled Ambient stays disabled on undo');
 for(const id of ['org.tizen.tv-viewer','screend','x;reboot'])assert.throws(()=>activation.command(id,true),/Unsupported/);
 assert.throws(()=>activation.parse(''),/unavailable/);
 console.log('PASS Q74T background controls: native activation, HbbTV restart prevention and undo, correct Multi View boot flag, Ambient block and exact undo, failed-change rollback');
})().catch(e=>{console.error(e);process.exitCode=1});
