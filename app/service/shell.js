'use strict';
// Shell tab: one command per request, run as root through the platform adapter like POST /exec.
// Each command gets a fresh shell, so only the working directory is carried over: the command runs in the cwd the
// browser sends, and the cwd it ends in comes back after a marker line with a per-request nonce (a command cannot
// fake it). bash is used when the TV has it, sh otherwise. stdin is /dev/null so a command waiting for input ends
// instead of holding the TV's command queue until the time limit.
var crypto=require('crypto');
var DEFAULT_TIMEOUT=30000,MAX_TIMEOUT=120000,MAX_COMMAND=16384,MAX_OUTPUT=262144;

function quote(s){return "'"+String(s).replace(/'/g,"'\\''")+"'";}
function validCwd(cwd){return typeof cwd==='string'&&cwd.charAt(0)==='/'&&cwd.length<=4096&&!/[\0\n\r]/.test(cwd);}

// Returns {command, nonce, timeout} to hand to execute(), or throws for invalid input.
function build(p){p=p||{};
 var cmd=p.cmd,cwd=p.cwd==null?'/':p.cwd,timeout=p.timeout==null?DEFAULT_TIMEOUT:p.timeout;
 if(typeof cmd!=='string'||!cmd.trim())throw Error('Missing command');
 if(cmd.length>MAX_COMMAND)throw Error('Command too long');
 if(!validCwd(cwd))throw Error('Invalid working directory');
 if(typeof timeout!=='number'||!(timeout>=1000)||timeout>MAX_TIMEOUT)throw Error('Time limit must be 1–120 seconds');
 var nonce=crypto.randomBytes(8).toString('hex'),marker='__VETRO_CWD_'+nonce+'__';
 var script='cd '+quote(cwd)+' 2>/dev/null || { echo "cd: '+cwd.replace(/[^\x20-\x7e]/g,'?').replace(/["$`\\]/g,'?')+': not found, using /" >&2; cd /; }\n'+
  cmd+'\n__vetro_status=$?\nprintf "\\n'+marker+'%s\\n" "$(pwd)"\nexit $__vetro_status\n';
 var b64=Buffer.from(script).toString('base64');
 var command='__vetro_script="$(echo '+b64+' | base64 -d)"; if command -v bash >/dev/null 2>&1; then exec bash -c "$__vetro_script" </dev/null; else exec sh -c "$__vetro_script" </dev/null; fi';
 return {command:command,nonce:nonce,timeout:Math.round(timeout),cwd:cwd};}

function cap(s){s=String(s||'');return s.length>MAX_OUTPUT?{text:s.slice(0,MAX_OUTPUT),truncated:true}:{text:s,truncated:false};}

// Turns the adapter result into {exit_code, timed_out, stdout, stderr, cwd, truncated}. When the command ended the
// shell itself (exit, exec) the marker is missing and the cwd stays where it was.
function parse(r,job){r=r||{};
 var out=String(r.stdout||''),marker='\n__VETRO_CWD_'+job.nonce+'__',i=out.lastIndexOf(marker),cwd=job.cwd;
 if(i>=0){var rest=out.slice(i+marker.length),nl=rest.indexOf('\n'),found=nl<0?rest:rest.slice(0,nl);if(validCwd(found))cwd=found;out=out.slice(0,i)+rest.slice(nl<0?rest.length:nl+1);}
 var so=cap(out),se=cap(r.stderr);
 return {ok:r.exit_code===0&&!r.timed_out,exit_code:r.exit_code,timed_out:!!r.timed_out,stdout:so.text,stderr:se.text,truncated:so.truncated||se.truncated,cwd:cwd};}

function run(execute,p){var job;try{job=build(p);}catch(e){return Promise.reject(e);}
 return execute(job.command,job.timeout).then(function(r){return parse(r,job);});}

module.exports={build:build,parse:parse,run:run,quote:quote,DEFAULT_TIMEOUT:DEFAULT_TIMEOUT,MAX_TIMEOUT:MAX_TIMEOUT};
