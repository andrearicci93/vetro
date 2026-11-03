'use strict';
const assert=require('assert').strict,fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vetro-boot-pid-'));
try{
 const state=path.join(tmp,'state'),lock=path.join(tmp,'lock'),mark=path.join(tmp,'starts');fs.mkdirSync(state);
 fs.writeFileSync(path.join(state,'root-supervisor.sh'),'printf started >> "'+mark+'"\n',{mode:0o700});
 fs.writeFileSync(path.join(state,'supervisor.pid'),String(process.pid));
 // Same startup guard as the hardware hook: the PID remains live but belongs
 // to the test process, reproducing a number reused after a cold boot.
 const original='D=/opt/tvroot\nLOCK=/tmp/.q74t-boot-lock\nmkdir "$LOCK" 2>/dev/null || exit 0\nSUP="$D/root-supervisor.sh"\nPIDFILE="$D/supervisor.pid"\nif [ -x "$SUP" ] && { [ ! -f "$PIDFILE" ] || ! kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; }; then\n sh -c "$(cat "$SUP")" root-supervisor 5001 "$D" &\n printf "%s\\n" "$!" > "$PIDFILE"\nfi\n';
 const src=path.join(tmp,'before.sh'),dst=path.join(tmp,'after.sh');fs.writeFileSync(src,original);
 const tool=path.resolve(__dirname,'../tools/fix-q74t-boot-pid.py');
 let r=cp.spawnSync('python3',[tool,src,dst],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 const fixed=fs.readFileSync(dst,'utf8');assert.equal(fixed,original.replace('PIDFILE="$D/supervisor.pid"','PIDFILE="$LOCK/supervisor.pid"'));
 function run(text){const script=text.replace('D=/opt/tvroot','D="'+state+'"').replace('LOCK=/tmp/.q74t-boot-lock','LOCK="'+lock+'"');const x=cp.spawnSync('/bin/sh',['-c',script],{encoding:'utf8',timeout:3000});assert.equal(x.status,0,x.stderr);}
 run(original);assert.equal(fs.existsSync(mark),false,'old live PID wrongly prevents supervisor startup');
 fs.rmdirSync(lock);run(fixed);assert.equal(fs.readFileSync(mark,'utf8'),'started');
 run(fixed);assert.equal(fs.readFileSync(mark,'utf8'),'started','same boot does not start duplicates');
 fs.unlinkSync(path.join(lock,'supervisor.pid'));fs.rmdirSync(lock);run(fixed);assert.equal(fs.readFileSync(mark,'utf8'),'startedstarted','next cold boot ignores persistent old PID');
 r=cp.spawnSync('python3',[tool,src,dst],{encoding:'utf8'});assert.notEqual(r.status,0,'never overwrite a backup/output');
 fs.writeFileSync(src,fixed);r=cp.spawnSync('python3',[tool,src,path.join(tmp,'wrong.sh')],{encoding:'utf8'});assert.notEqual(r.status,0,'unexpected/already-patched hooks are refused');
 console.log('PASS boot PID: stale live PID reproduced, per-boot PID fixes startup, no duplicate, next boot, no overwrite or unexpected template');
}finally{fs.rmSync(tmp,{recursive:true,force:true})}
