'use strict';
const assert=require('assert').strict;
const quick=require('../service/quick-settings.js');
const alexa=quick.find('alexa').ids;
function rows(disabled){return alexa.map(id=>({appId:id,disabled:disabled.includes(id)}));}
assert.equal(quick.state(quick.find('alexa'),rows(alexa)).status,'off');
assert.equal(quick.state(quick.find('alexa'),rows([])).status,'on');
const partial=quick.state(quick.find('alexa'),rows([alexa[3]]));assert.equal(partial.status,'partial');assert.deepEqual(partial.enabled,alexa.slice(0,3));
assert.equal(quick.state(quick.find('alexa'),[]).status,'unavailable');
assert.equal(quick.state(quick.find('alexa'),[{appId:alexa[0]}]).status,'unknown');
assert.equal(quick.state(quick.find('alexa'),rows(alexa).slice(1)).status,'off','missing members are skipped');
assert.throws(()=>quick.command(['bad id'],true),/Invalid app ID/);
assert.deepEqual(quick.exitCodes('a.b 0\nc.d 1\n'),{'a.b':0,'c.d':1});
assert.deepEqual(quick.running('\tcom.samsung.tv.alexa-client (812)\n other (9)\n'),['com.samsung.tv.alexa-client','other']);
assert.ok(quick.ALLOWED_IDS.indexOf('org.tizen.multi-assistant-service')<0&&!quick.ALLOWED_IDS.some(id=>/tts-engine/.test(id)),'system assistant hub and Voice Guide TTS are excluded');
function decode(cmd){const m=/^echo (\S+) \| base64 -d \| sh$/.exec(cmd);return m?Buffer.from(m[1],'base64').toString():cmd;}
function harness(opts){
 let disabled=new Set(opts.disabled||[]),calls=[],registryCalls=0;
 return {calls,disabled,deps:{invalidate(){},inventory(){registryCalls++;if(opts.registryError&&registryCalls>1)return Promise.resolve({apps:[],registryError:'x'});return Promise.resolve({apps:alexa.map(id=>({appId:id,disabled:disabled.has(id)}))});},
  execute(cmd){const s=decode(cmd);calls.push(s);
   if(s==='app_launcher -S')return Promise.resolve({exit_code:0,stdout:(opts.running||[]).map((id,i)=>'\t'+id+' ('+(100+i)+')').join('\n')});
   const m=/for id in (.*); do (pkgcmd (-D|-A)|app_launcher -k)/.exec(s);const ids=m[1].split(' ');
   if(m[2]==='app_launcher -k')return Promise.resolve({exit_code:0,stdout:ids.map(id=>id+' 0').join('\n')});
   ids.forEach(id=>{if(opts.stuck&&opts.stuck===id&&m[3]==='-D')return;m[3]==='-D'?disabled.add(id):disabled.delete(id);});
   return Promise.resolve({exit_code:0,stdout:ids.map(id=>id+' 0').join('\n')});}}};}
(async()=>{
 let h=harness({disabled:[alexa[3]],running:[alexa[0]]});
 let r=await quick.apply('alexa',true,h.deps);
 assert.deepEqual(r.changed,alexa.slice(0,3),'only enabled members are changed');assert.equal(r.state.status,'off');assert.deepEqual(r.stopped,[alexa[0]],'running members are stopped');
 assert.equal(h.calls.filter(c=>/pkgcmd/.test(c)).length,1,'one script for the whole group');
 h=harness({disabled:alexa});r=await quick.apply('alexa',false,h.deps);assert.equal(r.state.status,'on');assert.ok(!h.calls.includes('app_launcher -S'),'enabling stops nothing');
 h=harness({disabled:[],stuck:alexa[1]});
 await assert.rejects(quick.apply('alexa',true,h.deps),/Not confirmed for com.samsung.tv.alexa-fullscreen-app · previous state restored/);
 assert.equal(h.disabled.size,0,'rollback re-enables every changed member');
 h=harness({disabled:alexa});r=await quick.apply('alexa',true,h.deps);assert.deepEqual(r.changed,[]);assert.ok(!h.calls.some(c=>/pkgcmd/.test(c)),'no command when already off');
 await assert.rejects(quick.apply('nope',true,h.deps),/Unknown quick setting/);
 await assert.rejects(quick.apply('alexa','yes',h.deps),/Invalid state/);
 h=harness({disabled:[],registryError:true});await assert.rejects(quick.apply('alexa',true,h.deps),/App registry unavailable/);
 // Area groups: members are whatever the Task manager files under the area, minus role keep and protected components
 {
  const trk=[{appId:'t.one',packageId:'t.one',area:'tracking',role:'tracking',disabled:false},{appId:'org.tizen.pisa-control-service',packageId:'com.samsung.tv.pisa-service',area:'tracking',role:'tracking',disabled:true},
   {appId:'com.samsung.tv.coba.adagent',packageId:'com.samsung.tv.coba.adagent',area:'tracking',role:'keep',disabled:false},{appId:'com.samsung.tv.coba.adagent.res',packageId:'com.samsung.tv.coba.adagent',area:'tracking',role:'tracking',disabled:false},
   {appId:'vetrotvapp.svc',packageId:'vetrotvapp',area:'tracking',role:'tracking',disabled:false},{appId:'other',packageId:'other',area:'voice',role:'optional',disabled:false}];
  const g=quick.find('tracking-all'),st=quick.state(g,trk);
  assert.deepEqual(st.installed,['t.one','org.tizen.pisa-control-service'],'keep, Smart Hub ad agent, Vetro and other areas are not members');assert.equal(st.status,'partial');
  assert.equal(quick.state(g,[]).status,'unavailable');
  assert.deepEqual(quick.state(quick.find('voice-all'),trk).installed,['other']);
  assert.equal(quick.find('voice-all').microphone,true);assert.ok(quick.ALLOWED_IDS.indexOf('t.one')<0,'area groups add no fixed ids');
  const live=new Set(['t.one']),sent=[];
  const deps={invalidate(){},inventory(){return Promise.resolve({apps:trk.map(r=>({...r,disabled:r.appId==='t.one'?!live.has('t.one')?true:false:r.disabled})).map(r=>r.appId==='t.one'?{...r,disabled:!live.has('t.one')}:r)});},
   execute(cmd){const c=decode(cmd);sent.push(c);if(c==='app_launcher -S')return Promise.resolve({exit_code:0,stdout:'\tt.one (7)\n\tother (8)\n'});
    const m=/for id in (.*); do (pkgcmd (-D|-A)|app_launcher -k)/.exec(c);const ids=m[1].split(' ');if(m[2]==='pkgcmd -D')ids.forEach(id=>{if(id==='t.one')live.delete(id);});return Promise.resolve({exit_code:0,stdout:ids.map(id=>id+' 0').join('\n')});}};
  const r=await quick.apply('tracking-all',true,deps);
  assert.deepEqual(r.changed,['t.one']);assert.deepEqual(r.stopped,['t.one'],'only running members of the group are stopped, not other apps');assert.equal(r.state.status,'off');
 }
 {
  // The separate ACR switch was removed because the all-in switch covers its components: pin that down, with the
  // package id of the firmware (com.samsung.tv.acr-service-app) and with the app id used as package id.
  const catalog=require('../service/app-catalog.js'),ids=require('../service/debloat.js').VERIFIED_GLOBAL_IDS;
  [id=>id==='com.samsung.tv.acr'?'com.samsung.tv.acr-service-app':id,id=>id].forEach(pkgOf=>{
   const rows=ids.map(id=>{const c=catalog.describe({appId:id,packageId:pkgOf(id)});return {appId:id,packageId:pkgOf(id),disabled:false,area:c.area,role:c.role};});
   const s=quick.state(quick.find('tracking-all'),rows);
   assert.deepEqual(s.installed.sort(),ids.slice().sort(),'every verified ACR/analytics component is a member of the all-in tracking switch');
  });
  assert.equal(quick.find('acr'),null,'no second ACR switch');
 }
 console.log('PASS quick settings: group state, one-script apply, verified readback, rollback, stop of running members, exclusions');
})().catch(e=>{console.error(e);process.exitCode=1});
