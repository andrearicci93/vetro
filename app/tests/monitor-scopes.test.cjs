'use strict';
const assert=require('assert').strict;
const {Monitor,parse}=require('../service/system-monitor.js');
function fixture(n,boot){return '__BOOT__\n'+(boot||'boot-a')+'\n__CPU__\ncpu '+n+' 0 0 '+n+' 0 0 0 0\ncpu0 '+n+' 0 0 '+n+' 0 0 0 0\n__MEM__\nMemTotal: 1000 kB\nMemAvailable: 500 kB\n__NET__\neth0: '+n+' 0 0 0 0 0 0 0 '+n+' 0 0 0 0 0 0 0\n__BLOCK__\nzram0 1 0 '+n+' 0 1 0 '+n+' 0 0 0 0\n__VM__\nnr_free_pages 1\n__PROC__\n12 (tv) S 1 0 0 0 0 0 7 0 5 0 '+n+' 0 0 0 20 0 1 0 99 1000 1\n__DISK__\n/dev/test 1000 500 500 50% /opt\n';}
(async()=>{
 let commands=[],now=100000;const original=Date.now;Date.now=()=>now;
 try{
  const m=new Monitor(async cmd=>{commands.push(cmd);return {exit_code:0,stdout:fixture(now)}});
  const light=await m.snapshot('summary');assert.equal(light.scope,'summary');assert.equal(light.processes,undefined);assert.ok(!commands[0].includes('app_launcher'));assert.ok(!commands[0].includes('/proc/[0-9]*/stat'));assert.ok(!commands[0].includes('\\"'),'shell variables use real quotes');
  const full=await m.snapshot();assert.equal(full.processCount,1);assert.equal(full.scope,'full');assert.ok(commands[1].includes('app_launcher'));assert.ok(!commands[1].includes('df -k'),'storage shared for 30 seconds');
  now+=5000;const next=await m.snapshot('summary');assert.equal(next.intervalSeconds,5);assert.equal(next.paging.swapInPagesPerSecond,null);assert.ok(next.io.zram0.readBytesPerSecond>0);assert.equal(next.cpu.percent,50);
  now+=5000;const nextFull=await m.snapshot();assert.equal(nextFull.intervalSeconds,10,'summary must not alter process delta interval');assert.equal(nextFull.processes[0].majorFaultsPerSecond,0);
  now+=30000;await m.snapshot('summary');assert.ok(commands.at(-1).includes('df -k'));
  await assert.rejects(m.snapshot('invalid'),/Unsupported/);
  const prev=parse(fixture(10),null,1000);const reboot=parse(fixture(1,'boot-b'),prev.sample,2000);assert.equal(reboot.data.cpu.percent,null);assert.equal(reboot.data.processes[0].majorFaultsPerSecond,null);assert.equal(reboot.data.io.zram0.readBytesPerSecond,null);
  let resolve,count=0;const shared=new Monitor(()=>{count++;return new Promise(r=>resolve=r)});const a=shared.snapshot('summary'),b=shared.snapshot('summary');assert.equal(a,b);resolve({exit_code:0,stdout:fixture(10)});await a;assert.equal(count,1);
  const fresh=shared.snapshot('summary',true);assert.equal(count,2,'forced post-action sample bypasses a fresh cached snapshot');resolve({exit_code:0,stdout:fixture(11)});await fresh;
  let release;const starts=[];
  const coalesced=new Monitor(()=>new Promise(r=>{starts.push(1);release=r;}));
  const stale=coalesced.snapshot('summary');
  const postA=coalesced.snapshot('summary',true),postB=coalesced.snapshot('summary',true);
  release({exit_code:0,stdout:fixture(20)});await stale;await new Promise(r=>setImmediate(r));
  assert.equal(starts.length,2);release({exit_code:0,stdout:fixture(21)});await postA;
  await new Promise(r=>setImmediate(r));
  assert.equal(starts.length,2,'concurrent forced reads share the trailing sample');await postB;
  // A new force after the trailing sample started must get a still newer sample.
  const preMutation=coalesced.snapshot('summary',true);
  const laterMutation=coalesced.snapshot('summary',true);
  release({exit_code:0,stdout:fixture(22)});await preMutation;await new Promise(r=>setImmediate(r));
  assert.equal(starts.length,4);release({exit_code:0,stdout:fixture(23)});await laterMutation;
  let attempts=0;const recover=new Monitor(async()=>++attempts===1?{exit_code:1}:{exit_code:0,stdout:fixture(10)});await assert.rejects(recover.snapshot('summary'));assert.equal((await recover.snapshot('summary')).scope,'summary');
 }finally{Date.now=original;}
 const harness=require('./service-harness.cjs')(require('path').resolve(__dirname,'..'));let requested=[];harness.context.monitor={snapshot:async (s,force)=>{requested.push(s);return {scope:s,forced:force};}};async function get(url){return new Promise(resolve=>harness.router({method:'GET',url},{writeHead(status){this.status=status},end(body){resolve({status:this.status,body:JSON.parse(body)})}}));}assert.equal((await get('/monitor?scope=summary')).body.scope,'summary');assert.equal((await get('/monitor')).body.scope,'full');assert.equal((await get('/monitor?scope=wrong')).status,400);assert.equal((await get('/monitor?refresh=1')).body.forced,true);assert.equal((await get('/monitor?xrefresh=1')).body.forced,false);assert.deepEqual(requested,['summary','full','full','full']);
 console.log('PASS monitor scopes: lightweight commands, independent deltas, storage cache, missing counters, reboot and retry');
})().catch(e=>{console.error(e);process.exitCode=1});
