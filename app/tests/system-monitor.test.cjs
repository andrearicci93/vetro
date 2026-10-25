'use strict';
const assert=require('assert').strict;
const monitor=require('../service/system-monitor.js');
function proc(pid,start,ticks){return pid+' (worker (tv)) S 1 0 0 0 0 0 0 0 0 0 '+ticks+' 0 0 0 20 0 3 0 '+start+' 1048576 20';}
function snapshot(total,idle,ticks,start,rx){return '__CPU__\ncpu '+(total-idle)+' 0 0 '+idle+' 0 0 0 0\ncpu0 '+(total-idle)/2+' 0 0 '+idle/2+' 0 0 0 0\ncpu1 '+(total-idle)/2+' 0 0 '+idle/2+' 0 0 0 0\n__MEM__\nMemTotal: 1000 kB\nMemAvailable: 0 kB\nSwapTotal: 50 kB\nSwapFree: 0 kB\n__NET__\n eth0: '+rx+' 0 0 0 0 0 0 0 100 0 0 0 0 0 0 0\n__ZRAM__\n10000 4000 5000\n__DISK__\nFilesystem 1K-blocks Used Available Use% Mounted on\n/dev/test 1000 700 300 70% /opt\n__UPTIME__\n400 20\n__PAGE__\n4096\n__PROC__\n'+proc(12,start,ticks)+'\n';}
const a=monitor.parse(snapshot(1000,800,10,1,100),null,1000);
assert.equal(a.data.cpu.percent,null);assert.equal(a.data.processes[0].cpuPercent,null);
assert.equal(a.data.processes[0].name,'worker (tv)');assert.equal(a.data.processes[0].threads,3);assert.equal(a.data.processes[0].rssBytes,81920);
const b=monitor.parse(snapshot(1200,900,60,1,400),a.sample,4000);
assert.equal(b.data.cpu.percent,50);assert.equal(b.data.processes[0].cpuPercent,50);assert.equal(b.data.network[0].rxPerSecond,100);
assert.equal(b.data.memory.availableBytes,0);assert.equal(b.data.memory.swapFreeBytes,0);assert.equal(b.data.storage.availableBytes,307200);
assert.equal(b.data.zram.physicalBytes,5000);
const stale=monitor.parse(snapshot(1200,900,60,1,400),a.sample,62000);assert.equal(stale.data.cpu.percent,null,'a sample over 60 s old is not a current rate');assert.equal(stale.data.processes[0].cpuPercent,null);assert.equal(stale.data.network[0].rxPerSecond,null);
const reused=monitor.parse(snapshot(1400,1000,90,2,500),b.sample,7000);assert.equal(reused.data.processes[0].cpuPercent,null,'reused PID must start a new CPU sample');
const units=monitor.parseUnits('hotel.service loaded inactive dead Hotel\n__FILES__\nhotel.service disabled\nnetwork.service enabled\n');assert.equal(units[0].bootState,'disabled');assert.equal(units[1].active,'not-loaded');
let count=0,resolve;const m=new monitor.Monitor(()=>{count++;return new Promise(r=>{resolve=r})});const first=m.snapshot(),second=m.snapshot();assert.equal(first,second);resolve({exit_code:0,stdout:snapshot(1000,800,10,1,100)});
first.then(()=>m.snapshot()).then(()=>{assert.equal(count,1,'simultaneous clients share one snapshot');console.log('PASS monitor: CPU deltas, stale-gap baseline, PID reuse, shared snapshot, zero memory values, network rates and boot states');}).catch(e=>{console.error(e);process.exitCode=1});

const mapped=monitor.parse('__APPS__\n user.ui (12)\n'+snapshot(1000,800,10,1,100),null,1000);assert.equal(mapped.data.processes[0].appId,'user.ui');

// The startup listing is two commands: a slow boot-state read (13-17 s on a Q80A) must not take the running states with it
(async()=>{
 const calls=[];const run=(files)=>new monitor.Monitor((cmd,t)=>{calls.push({cmd,t});
  if(cmd.indexOf('list-unit-files')>=0)return files==='timeout'?Promise.resolve({timed_out:true,stdout:''}):Promise.resolve({exit_code:0,stdout:'hotel.service disabled\n'});
  return Promise.resolve({exit_code:0,stdout:'hotel.service loaded active running Hotel\n'});});
 const ok=await run('ok').startup();assert.equal(ok[0].bootState,'disabled');
 const l=calls.find(c=>c.cmd.indexOf('list-unit-files')>=0);assert.ok(l.t>=45000,'the boot-state read gets a long limit of its own');assert.ok(calls[0].t<=15000);
 const slow=await run('timeout').startup();assert.equal(slow[0].active,'active');assert.equal(slow[0].bootState,null,'boot states unknown, not the whole listing failed');
 console.log('PASS monitor startup: running states survive a slow or failed boot-state read');
})().catch(e=>{console.error(e);process.exitCode=1});
