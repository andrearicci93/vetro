'use strict';
const assert=require('assert').strict,fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
const activation=require('../service/app-activation.js');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vetro-activation-'));
try {
 const state=path.join(tmp,'state'),calls=path.join(tmp,'calls');fs.writeFileSync(state,'false\n');
 fs.writeFileSync(path.join(tmp,'sqlite3'),'#!/bin/sh\ncat "$VETRO_STATE"\n',{mode:0o755});
 fs.writeFileSync(path.join(tmp,'pkgcmd'),'#!/bin/sh\n[ "$1" = -D ] && want=true || want=false\n[ "$(cat "$VETRO_STATE")" != "$want" ] || exit 25\nprintf "%s\\n" "$want" > "$VETRO_STATE"\necho changed >> "$VETRO_CALLS"\n',{mode:0o755});
 const env={...process.env,PATH:tmp+':'+process.env.PATH,VETRO_STATE:state,VETRO_CALLS:calls};
 const run=disabled=>spawnSync('/bin/sh',['-c','set -e\n'+activation.command('org.tizen.ambientapp',disabled)],{env,encoding:'utf8'});
 for(const disabled of [true,true,false,false]){const r=run(disabled);assert.equal(r.status,0,r.stderr)}
 assert.equal(fs.readFileSync(calls,'utf8').trim().split('\n').length,2,'already-set activation does not call pkgcmd again');
 fs.writeFileSync(state,'');const r=run(true);assert.notEqual(r.status,0);assert.match(r.stderr,/state unavailable/);
 assert.equal(fs.readFileSync(calls,'utf8').trim().split('\n').length,2,'unknown state sends no mutation');
 console.log('PASS activation shell: idempotent enable/disable despite pkgcmd exit 25, unknown state refuses mutation');
} finally {fs.rmSync(tmp,{recursive:true,force:true})}
