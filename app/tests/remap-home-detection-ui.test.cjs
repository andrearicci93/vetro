'use strict';
const assert=require('assert').strict,vm=require('vm');
const html=require('../service/dashboard.js')(),validate=require('../service/remap.js').validateRules;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve};}
function fixture(){
 const f={nodes:{},calls:[],rules:[],revision:0,bound:null,mode:'off',events:[],resumeError:false,startError:false};
 const el=id=>f.nodes[id]||(f.nodes[id]={id,value:'',checked:false,disabled:false,hidden:true,innerHTML:'',textContent:'',focus(){},appendChild(child){child.parentNode=this;return child;}});
 const home=()=>({code:'63',device:f.bound?'Smart Control':null,node:f.bound,ready:f.mode!=='observe',listening:f.mode==='observe'});
 const input=()=>({devices:[{name:'Smart Control',node:'/dev/input/event7',selectable:true}],status:{policy:{mode:f.mode,connected:f.mode!=='off',device:'Smart Control'},preference:{enabled:false},events:f.events.slice()},home:home()});
 const response=(data,ok=true)=>({ok,json:async()=>data});
 const sandbox={document:{getElementById:el,querySelectorAll:()=>[],addEventListener(){}},console,setInterval(){},setTimeout(){},clearTimeout(){},fetch:async(url,options)=>{
  const body=options&&options.body?JSON.parse(options.body):null;f.calls.push({url,body});
  if(url==='/remap'&&body){
   if(f.saveWait)await f.saveWait.promise;
   if(body.expectedRevision!==f.revision)return response({error:'Shortcuts changed. Refresh before saving.'},false);
   if(!body.device&&!f.bound)return response({error:'Press Detect Home, then press Home on your remote to finish setup.',code:'home_detection_required'},false);
   f.rules=validate(body.rules);f.revision++;f.bound=body.device||f.bound;f.mode='filter';
   return response({rules:f.rules,revision:f.revision,persisted:true,home:home()});
  }
  if(url==='/remap')return response({rules:JSON.parse(JSON.stringify(f.rules)),revision:f.revision,home:home()});
  if(url==='/input'&&body){
   if(body.mode==='observe'){
    assert.equal(body.device,'auto');f.mode='observe';f.events=[];
    if(f.startWait)await f.startWait.promise;
    if(f.startError)return response({error:'Listening acknowledgement lost'},false);
   }else{
    assert.equal(body.mode,'resume','detection must restore the saved preference, never enable other shortcuts');
    if(f.resumeError)return response({error:'Root unavailable'},false);
    f.mode=f.bound?'filter':'off';f.events=[];
   }
   return response(input());
  }
  if(url==='/input'){const data=input();if(f.readWait)await f.readWait.promise;return response(data);}
  if(url.startsWith('/apps'))return response({apps:[{appId:'netflix.app',name:'Netflix',show:true,disabled:false}],summary:{total:1}});
  return response({});
 }};
 vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],sandbox);
 f.sandbox=sandbox;f.el=el;f.click=dataset=>el('ruleEditor').onclick({target:{dataset}});
 f.kind=type=>{el('editKind0').value=type;el('ruleEditor').onchange({target:{dataset:{editKind:'0'}}});el('editKind0').value=type;};
 f.open=()=>{sandbox.editRule(f.rules.length?f.rules[0].id:null,true);f.kind('launcher');};
 f.posts=()=>f.calls.filter(call=>call.url==='/remap'&&call.body);
 return f;
}
(async()=>{
 let f=fixture();await tick();f.open();
 await f.click({saveEdit:''});assert.equal(f.rules.length,0);assert.match(f.el('ruleEditStatus').textContent,/Press Detect Home/);
 assert.equal(f.el('ruleEditStatus').hidden,false);assert.equal(f.el('ruleEditor').parentNode,f.el('homeEditorSlot'));
 await f.click({detectHome:''});assert.equal(f.mode,'observe');assert.equal(f.el('saveRuleEdit').disabled,true);
 assert.match(f.el('ruleEditStatus').textContent,/Press Home/);const posts=f.posts().length;
 f.events=[{action:'down',code:103,key:'Up',node:'/dev/input/event7'}];await f.sandbox.pollRuleDetection();assert.equal(f.sandbox.ruleDraft.device,undefined);
 f.events=[{action:'down',code:63,key:'XF86Home',node:'/unexpected'}];await f.sandbox.pollRuleDetection();assert.equal(f.sandbox.ruleDraft.device,undefined);
 f.events=[{action:'down',code:63,key:'XF86Home',node:'/dev/input/event7'}];await f.sandbox.pollRuleDetection();await tick();
 assert.equal(f.mode,'off');assert.equal(f.sandbox.ruleDraft.device,'/dev/input/event7');assert.equal(f.posts().length,posts,'detection does not save the assignment');
 assert.match(f.el('ruleEditStatus').textContent,/Choose an action, then Save Home/);assert.equal(f.el('saveRuleEdit').disabled,false);
 f.el('device').value='/dev/input/event99';await f.click({saveEdit:''});
 assert.equal(f.posts().at(-1).body.device,'/dev/input/event7');assert.equal(f.rules[0].actions[0].type,'launcher');assert.equal(f.el('homeSaveStatus').textContent,'Home saved.');
 f.open();f.el('device').value='/dev/input/event99';await f.click({saveEdit:''});
 assert.equal(f.posts().at(-1).body.device,undefined,'subsequent edits reuse the saved Home identity');assert.equal(f.rules.length,1);

 f.open();f.revision++;await f.click({saveEdit:''});assert.match(f.el('ruleEditStatus').textContent,/Shortcuts changed/);
 assert.ok(f.sandbox.ruleDraft);assert.equal(f.el('newShortcutFields').disabled,true);await f.click({cancelEdit:''});assert.equal(f.el('newShortcutFields').disabled,false);

 f=fixture();await tick();f.bound='/dev/input/event7';f.open();f.saveWait=deferred();
 const saving=f.click({saveEdit:''});await tick();const count=f.posts().length;
 await f.click({saveEdit:''});await f.click({cancelEdit:''});assert.equal(f.posts().length,count);assert.ok(f.sandbox.ruleDraft,'save in progress cannot be discarded');
 f.saveWait.resolve();await saving;assert.equal(f.rules.length,1);assert.equal(f.sandbox.ruleDraft,null);

 f=fixture();await tick();f.open();f.startWait=deferred();const starting=f.click({detectHome:''});await tick();
 const cancelling=f.click({cancelEdit:''});assert.equal(f.sandbox.ruleDetection.phase,'stopping');f.startWait.resolve();await starting;await cancelling;
 assert.equal(f.mode,'off');assert.equal(f.sandbox.ruleDraft,null);assert.equal(f.posts().length,0,'cancel during listener startup never writes a mapping');

 f=fixture();await tick();f.open();await f.click({detectHome:''});f.resumeError=true;
 await f.click({cancelEdit:''});assert.equal(f.sandbox.ruleDetection.phase,'restore-failed');assert.equal(f.el('saveRuleEdit').disabled,true);
 assert.match(f.el('ruleEditStatus').textContent,/Remote restore not confirmed.*Root unavailable/);assert.equal(f.el('ruleDetectHome').textContent,'Retry remote restore');
 f.resumeError=false;await f.click({detectHome:''});assert.equal(f.sandbox.ruleDetection,null);assert.equal(f.el('saveRuleEdit').disabled,false);assert.doesNotMatch(f.el('ruleEditStatus').textContent,/not confirmed/);
 await f.click({cancelEdit:''});assert.equal(f.posts().length,0);

 f=fixture();await tick();f.open();f.startError=true;await f.click({detectHome:''});
 assert.equal(f.mode,'off');assert.equal(f.sandbox.ruleDetection,null);assert.match(f.el('ruleEditStatus').textContent,/Listening acknowledgement lost/);
 assert.equal(f.posts().length,0);

 f=fixture();await tick();f.open();await f.click({detectHome:''});f.events=[{action:'down',code:63,node:'/dev/input/event7'}];f.readWait=deferred();
 const polling=f.sandbox.pollRuleDetection();await tick();f.sandbox.switchPanel('quick');await tick();f.readWait.resolve();await polling;await tick();
 assert.equal(f.mode,'off');assert.equal(f.sandbox.ruleDetection,null);assert.equal(f.sandbox.ruleDraft.device,undefined,'late detection replies cannot populate a cancelled detection');assert.equal(f.posts().length,0);

 assert.ok(html.indexOf('Step 2 · Choose an action')<html.indexOf('id="homeSection"'));
 assert.ok(html.indexOf('id="homeSection"')<html.indexOf('<h2>Other shortcuts</h2>'));
 console.log('PASS inline Home setup: missing identity, detection, explicit save, saved identity, conflict, duplicate save, cancellation, restoration failure and stale replies');
})().catch(error=>{console.error(error);process.exitCode=1;});
