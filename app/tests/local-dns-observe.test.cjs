'use strict';
const assert=require('assert').strict,{Filter}=require('../service/local-dns.js');
(async()=>{
 let script;let f=new Filter(async cmd=>{script=Buffer.from(cmd.split(' ')[1],'base64').toString();return {exit_code:0,stdout:'IP x: 1+ A? ads.example.com.\nIP x: 2+ AAAA? ads.example.com.\n',stderr:'2 packets captured'};});
 assert.deepEqual((await f.observe()).domains,['ads.example.com']);assert.ok(!script.includes('timeout 6'));assert.ok(script.includes('kill -INT'));assert.ok(script.includes('[ "$rc" -eq 130 ] && rc=0'));assert.ok(!script.includes('|| true'));
 f=new Filter(async()=>({exit_code:127,stderr:'tcpdump unavailable'}));await assert.rejects(f.observe(),/tcpdump unavailable/);
 f=new Filter(async()=>null);await assert.rejects(f.observe(),/Local filter unavailable/);
 console.log('PASS DNS observe: bounded capture without timeout tool and explicit capture failure');
})().catch(e=>{console.error(e);process.exitCode=1});
