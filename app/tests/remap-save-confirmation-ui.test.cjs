'use strict';
const assert=require('assert').strict,vm=require('vm');
const html=require('../service/dashboard.js')();
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const copy=value=>JSON.parse(JSON.stringify(value));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};}
function fixture(){
 const f={nodes:{},calls:[],rules:[],revision:0,home:{code:'63',device:'Smart Control',node:'/dev/input/event6',busy:false,phase:null,error:null,ready:true},post:deferred()};
 let now=0,seq=0;const timers=new Map();
 const el=id=>f.nodes[id]||(f.nodes[id]={id,value:'',checked:false,disabled:false,hidden:true,innerHTML:'',textContent:'',dataset:{},focus(){},appendChild(child){child.parentNode=this;return child;}});
 const response=(data,ok=true)=>({ok,json:async()=>data});
 f.snapshot=()=>({rules:copy(f.rules),revision:f.revision,home:copy(f.home)});
 const sandbox={document:{getElementById:el,querySelectorAll:()=>[],addEventListener(){}},console,setInterval(){},
  setTimeout(fn,delay){const id=++seq;timers.set(id,{at:now+delay,fn});return id;},clearTimeout(id){timers.delete(id);},
  fetch:async(url,options)=>{
   const body=options&&options.body?JSON.parse(options.body):null;f.calls.push({url,body,options});
   if(url==='/remap'&&body)return f.post.promise;
   if(url==='/remap'){if(f.readError)throw Error('Connection lost');const data=f.snapshot();if(f.readWait)await f.readWait.promise;return response(data);}
   if(url==='/input')return response({devices:[],status:{preference:{enabled:true},policy:{mode:'filter',connected:true},events:[]}});
   if(url.startsWith('/apps'))return response({apps:[],summary:{total:0}});
   return response({});
  }
 };
 vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],sandbox);
 f.advance=async ms=>{
  const end=now+ms;
  for(;;){const next=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;
   now=next[1].at;timers.delete(next[0]);next[1].fn();await tick();
  }
  now=end;await tick();
 };
 f.open=()=>{sandbox.editRule(null,true);el('editKind0').value='launcher';el('ruleEditor').onchange({target:{dataset:{editKind:'0'}}});el('editKind0').value='launcher';};
 f.save=()=>{el('saveRuleEdit').dataset={saveEdit:''};return el('ruleEditor').onclick({target:el('saveRuleEdit')});};
 f.posts=()=>f.calls.filter(call=>call.url==='/remap'&&call.body);
 f.commit=()=>{const body=f.posts().at(-1).body;f.rules=copy(body.rules);f.revision=body.expectedRevision+1;};
 f.reply=()=>f.post.resolve(response({...f.snapshot(),persisted:true}));
 f.el=el;f.sandbox=sandbox;return f;
}
(async()=>{
 let f=fixture();await tick();await f.sandbox.pollInput();f.open();const saving=f.save();await tick();
 f.home.busy=true;f.home.phase='starting-launcher';await f.advance(1000);
 assert.match(f.el('ruleEditStatus').textContent,/Starting Vetro/);assert.equal(f.el('saveRuleEdit').disabled,true);
 f.commit();f.home.phase='applying-remote';await f.advance(1000);
 assert.ok(f.sandbox.ruleDraft,'persisted rules are not success while the service can still roll back');
 assert.match(f.el('ruleEditStatus').textContent,/Applying/);assert.equal(f.el('homeSaveStatus').hidden,true);
 await f.save();assert.equal(f.posts().length,1,'a slow save cannot be sent twice');
 f.home.busy=false;f.home.phase=null;f.home.ready=false;await f.advance(1000);
 assert.ok(f.sandbox.ruleDraft,'read-back waits for the remote connection too');assert.match(f.el('ruleEditStatus').textContent,/Waiting for the remote connection/);
 f.home.ready=true;await f.advance(1000);assert.equal(await saving,true);
 assert.equal(f.sandbox.ruleDraft,null);assert.equal(f.el('homeSaveStatus').textContent,'Home saved.');assert.equal(f.el('filter').checked,true);
 assert.ok(f.calls.filter(call=>call.url==='/remap'&&!call.body).every(call=>call.options.cache==='no-store'));
 const completed=f.snapshot();f.rules=[];f.revision++;await f.sandbox.loadRules();
 f.post.resolve({ok:true,json:async()=>({...completed,persisted:true})});await tick();
 assert.equal(f.sandbox.rulesRevision,2);assert.equal(f.sandbox.rules.length,0,'a late POST response cannot replace newer saved state');

 f=fixture();await tick();f.open();let pending=f.save();await tick();f.post.reject(Error('Network disconnected'));await tick();
 assert.match(f.el('ruleEditStatus').textContent,/Checking the saved assignment/);
 f.commit();await f.advance(1000);assert.equal(await pending,true);assert.equal(f.posts().length,1,'lost acknowledgement triggers reads, never another write');

 f=fixture();await tick();f.open();pending=f.save();await tick();
 f.commit();f.home.busy=true;f.home.phase='applying-remote';await f.advance(1000);
 f.rules=[];f.revision=0;f.home.busy=false;f.home.phase=null;f.home.error='Remote connection failed; previous assignment restored';
 await f.advance(1000);assert.equal(await pending,false);assert.ok(f.sandbox.ruleDraft);
 assert.match(f.el('ruleEditStatus').textContent,/previous assignment restored/);assert.equal(f.el('saveRuleEdit').disabled,false);
 assert.equal(f.el('editKind0').value,'launcher');assert.equal(f.el('homeSaveStatus').hidden,true);

 f=fixture();await tick();f.open();pending=f.save();await tick();f.commit();f.revision++;
 await f.advance(1000);assert.equal(await pending,false);assert.ok(f.sandbox.ruleDraft);
 assert.match(f.el('ruleEditStatus').textContent,/Shortcuts changed/,'matching rules from a different revision do not confirm this save');

 f=fixture();await tick();f.open();pending=f.save();await tick();f.readWait=deferred();await f.advance(1000);
 f.commit();f.reply();assert.equal(await pending,true);const revision=f.sandbox.rulesRevision;
 f.readWait.resolve();await tick();assert.equal(f.sandbox.rulesRevision,revision);assert.equal(f.sandbox.rules.length,1,'a stale GET cannot undo a confirmed POST');

 f=fixture();await tick();f.open();pending=f.save();await tick();
 f.post.resolve({ok:false,json:async()=>({error:'Remote is unavailable',code:'home_detection_required'})});
 assert.equal(await pending,false);assert.match(f.el('ruleEditStatus').textContent,/Remote is unavailable/);assert.equal(f.el('saveRuleEdit').disabled,false);
 const reads=f.calls.filter(call=>call.url==='/remap'&&!call.body).length;await f.advance(2000);
 assert.equal(f.calls.filter(call=>call.url==='/remap'&&!call.body).length,reads,'definite rejection ends confirmation polling');

 f=fixture();await tick();f.open();pending=f.save();await tick();f.readWait=deferred();await f.advance(120000);
 assert.equal(await pending,false);assert.ok(f.sandbox.ruleDraft);assert.match(f.el('ruleEditStatus').textContent,/not confirmed completion.*sent only once/);
 assert.equal(f.posts().length,1);f.commit();f.reply();f.readWait.resolve();await tick();assert.ok(f.sandbox.ruleDraft,'late replies after timeout do not claim success');

 f=fixture();await tick();f.home.busy=true;f.home.phase='starting-launcher';await f.sandbox.loadRules();
 assert.equal(f.el('filter').disabled,true);assert.equal(f.el('newShortcutFields').disabled,true);assert.match(f.el('homeRule').innerHTML,/Starting Vetro/);
 f.readError=true;await f.advance(1000);assert.equal(f.el('filter').disabled,true);
 f.readError=false;f.home.busy=false;f.home.phase=null;await f.advance(1000);
 assert.equal(f.el('filter').disabled,false);assert.equal(f.el('newShortcutFields').disabled,false,'a refreshed page follows the outstanding transaction to completion');
 console.log('PASS shortcut save confirmation: progress, one write, completed read-back, rollback, revisions, lost and late replies, explicit failures, bounded waiting and refreshed-page recovery');
})().catch(error=>{console.error(error);process.exitCode=1;});
