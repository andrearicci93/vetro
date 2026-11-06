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

// The startup listing: the boot states (12-17 s on a Q80A) come from a cache file written by a detached job, so the root
// agent, which runs one command at a time, is never held up by them, and the running states never wait for them.
(async()=>{
 const calls=[];const run=(cache)=>new monitor.Monitor((cmd,t)=>{calls.push({cmd,t});
  if(cmd.indexOf('echo "AGE|$a"')>=0)return Promise.resolve({exit_code:0,stdout:cache==='ready'?'AGE|5\nhotel.service disabled\n':cache==='late'&&calls.filter(c=>c.cmd.indexOf('AGE|')>=0).length>1?'AGE|5\nhotel.service disabled\n':'AGE|999999\n'});
  return Promise.resolve({exit_code:0,stdout:'hotel.service loaded active running Hotel\n'});});
 const ok=await run('ready').startup();assert.equal(ok[0].bootState,'disabled');
 assert.ok(!calls.some(c=>/^systemctl list-unit-files/.test(c.cmd)),'list-unit-files never runs in the agent itself');
 const job=calls.find(c=>c.cmd.indexOf('echo "AGE|$a"')>=0);
 assert.ok(job.t<=15000,'reading the cache is a short command');
 assert.match(job.cmd,/setsid sh -c 'nice -n 19 systemctl list-unit-files/,'a missing or old cache starts a detached low-priority job');
 assert.match(job.cmd,/stat -c %Y/,'the job is not started twice within its lock window');
 const cold=await run('empty').startup();assert.equal(cold[0].active,'active');assert.equal(cold[0].bootState,null,'no cache yet: boot states unknown, running states still there');
 const waited=await run('late').startup({wait:10000});assert.equal(waited[0].bootState,'disabled','the report waits for the job');
 console.log('PASS monitor startup: boot states come from a cache written by a detached job; running states never wait for them');
})().catch(e=>{console.error(e);process.exitCode=1});
