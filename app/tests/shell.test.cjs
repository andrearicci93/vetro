'use strict';
const assert=require('assert').strict,fs=require('fs'),os=require('os'),path=require('path'),spawnSync=require('child_process').spawnSync;
const shell=require('../service/shell.js');

// Input validation
for(const bad of [{},{cmd:''},{cmd:'   '},{cmd:1},{cmd:'x'.repeat(16385)},{cmd:'ls',cwd:'relative'},{cmd:'ls',cwd:'/a\nb'},{cmd:'ls',timeout:500},{cmd:'ls',timeout:120001},{cmd:'ls',timeout:'30'}])
  assert.throws(()=>shell.build(bad),JSON.stringify(bad).slice(0,40));
const job=shell.build({cmd:'echo hi'});
assert.equal(job.cwd,'/');assert.equal(job.timeout,shell.DEFAULT_TIMEOUT);assert.ok(/^[0-9a-f]{16}$/.test(job.nonce));
assert.ok(!job.command.includes('echo hi'),'the command travels base64-encoded');
assert.notEqual(shell.build({cmd:'x'}).nonce,shell.build({cmd:'x'}).nonce);

// parse: the marker is removed, the output before it is kept exactly, a missing marker keeps the old cwd
let r=shell.parse({exit_code:0,stdout:'a\nb\n__VETRO_CWD_'+job.nonce+'__/tmp\n'},job);
assert.deepEqual([r.stdout,r.cwd,r.ok],['a\nb','/tmp',true]);
r=shell.parse({exit_code:3,stdout:'gone',stderr:'bye'},Object.assign({},job,{cwd:'/opt'}));
assert.deepEqual([r.stdout,r.stderr,r.cwd,r.ok,r.exit_code],['gone','bye','/opt',false,3]);
r=shell.parse({exit_code:0,stdout:'\n__VETRO_CWD_0000000000000000__/fake\n'},job);
assert.equal(r.cwd,'/','a marker with another nonce is ordinary output');
r=shell.parse({exit_code:0,stdout:'x'.repeat(300000)},job);assert.equal(r.truncated,true);assert.equal(r.stdout.length,262144);

// The real thing: run the generated command with a local shell, as the root agent does on the TV.
const local=(cmd,timeout)=>{const p=spawnSync('/bin/sh',['-c',cmd],{encoding:'utf8',timeout:timeout});return Promise.resolve({exit_code:p.status,timed_out:!!p.error,stdout:p.stdout,stderr:p.stderr});};
const tmp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'vetro-shell-'))),odd=path.join(tmp,"it's a \"dir\" $(x)");fs.mkdirSync(odd);
(async()=>{
  let d=await shell.run(local,{cmd:'cd '+tmp+' && printf no-newline',cwd:'/'});
  assert.deepEqual([d.stdout,d.cwd,d.exit_code],['no-newline',tmp,0]);
  d=await shell.run(local,{cmd:'pwd; cd "$(ls -d */ | head -1)"',cwd:tmp});
  assert.equal(d.stdout,tmp+'\n');assert.equal(d.cwd,odd,'directory names with quotes and $() are carried over intact');
  d=await shell.run(local,{cmd:'pwd',cwd:d.cwd});assert.equal(d.stdout,odd+'\n');
  d=await shell.run(local,{cmd:'echo out; echo err >&2; false'});
  assert.deepEqual([d.stdout,d.stderr,d.exit_code,d.ok],['out\n','err\n',1,false]);
  d=await shell.run(local,{cmd:'cat; echo after'});assert.equal(d.stdout,'after\n','stdin is /dev/null: cat does not wait');
  d=await shell.run(local,{cmd:'exit 7',cwd:tmp});assert.deepEqual([d.exit_code,d.cwd],[7,tmp]);
  d=await shell.run(local,{cmd:'pwd',cwd:'/no/such/dir'});
  assert.equal(d.stdout,'/\n');assert.ok(/not found, using \//.test(d.stderr));
  d=await shell.run(local,{cmd:'echo "$__vetro_status" x; printf "\\n__VETRO_CWD_feedfacefeedface__/fake\\n"',cwd:tmp});
  assert.equal(d.cwd,tmp,'a command cannot set the cwd by printing a marker');
  d=await shell.run(local,{cmd:"for i in 1 2 3; do echo $i; done | wc -l | tr -d ' '"});assert.equal(d.stdout,'3\n');
  fs.rmSync(tmp,{recursive:true,force:true});
  console.log('PASS shell: validated input, base64 transport, cwd carried over with a nonce marker, exit codes, stdin closed');
})().catch(e=>{console.error(e);process.exitCode=1;});
