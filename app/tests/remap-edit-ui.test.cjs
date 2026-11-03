'use strict';
const assert=require('assert').strict,vm=require('vm');
const html=require('../service/dashboard.js')(),nodes={},calls=[];
const el=id=>nodes[id]||(nodes[id]={id,value:'',checked:false,disabled:false,hidden:true,innerHTML:'',textContent:'',focus(){},appendChild(child){child.parentNode=this;return child;}});
const rules=[{id:'home',enabled:true,trigger:{type:'physical',value:'63'},actions:[{type:'launcher'}]},
 {id:'automation',enabled:false,trigger:{type:'mqtt',value:'room/open',payload:'go'},actions:[{type:'launch',appId:'netflix.app'},{type:'mqtt',topic:'room/state',payload:'opened'}]}];
let saved=JSON.parse(JSON.stringify(rules)),revision=4,failure=false,holdRead=null;
const sandbox={document:{getElementById:el,querySelectorAll:()=>[],addEventListener(){}},console,setInterval(){},setTimeout(){},clearTimeout(){},
 fetch:async(url,opts)=>{
 const body=opts&&opts.body?JSON.parse(opts.body):null;calls.push({url,body});let data={};
 if(url==='/remap'&&body){if(failure)return {ok:false,json:async()=>({error:'disk full'})};assert.equal(body.expectedRevision,revision);saved=body.rules;revision++;data={rules:saved,revision,persisted:true};}
 else if(url==='/remap'){data={rules:JSON.parse(JSON.stringify(saved)),revision,home:{code:'63',ready:true,device:'Smart Control',node:'/dev/input/event6'}};if(holdRead)await holdRead;}
 else if(url.startsWith('/apps'))data={apps:[{appId:'netflix.app',name:'Netflix',show:true,disabled:false}],summary:{total:1}};
 else if(url==='/input')data={devices:[],status:{policy:{mode:'off'},preference:{enabled:false},events:[]}};
 return {ok:true,json:async()=>data};
 }};
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],sandbox);
const tick=()=>new Promise(r=>setImmediate(r));
const click=d=>el('ruleEditor').onclick({target:{dataset:d}});
(async()=>{
 await tick();await tick();assert.match(el('homeRule').innerHTML,/Home → Toggle Vetro launcher/);
 assert.match(el('rules').innerHTML,/data-edit="automation"/);assert.match(el('mqttRules').innerHTML,/data-mqtt-edit="home"/);
 sandbox.editRule('automation');await tick();
 assert.equal(el('ruleEditor').parentNode,el('otherEditorSlot'));assert.equal(el('newShortcutFields').disabled,true);
 assert.match(el('ruleEditor').innerHTML,/room\/open/);assert.match(el('ruleEditor').innerHTML,/room\/state/);assert.match(el('ruleEditor').innerHTML,/Action 2/);
 await click({cancelEdit:''});assert.equal(calls.filter(c=>c.url==='/remap'&&c.body).length,0);assert.equal(el('ruleEditor').hidden,true);assert.equal(el('newShortcutFields').disabled,false);
 sandbox.editRule('automation');await tick();
 el('editEnabled').checked=false;el('editTriggerType').value='mqtt';el('editTrigger').value='room/open';el('editMatch').value='go';
 el('editKind0').value='launch';el('editApp0').value='netflix.app';el('editKind1').value='mqtt';el('editTopic1').value='room/state';el('editPayload1').value='ready';
 await click({saveEdit:''});
 assert.equal(saved.length,2);assert.equal(saved.filter(r=>r.id==='automation').length,1);assert.equal(saved.find(r=>r.id==='automation').actions[1].payload,'ready');assert.equal(saved.find(r=>r.id==='automation').enabled,false);
 sandbox.editRule('home');await tick();el('editKind0').value='launch';el('ruleEditor').onchange({target:{dataset:{editKind:'0'}}});el('editKind0').value='launch';el('editApp0').value='netflix.app';
 assert.equal(el('ruleEditor').parentNode,el('homeEditorSlot'));assert.equal(el('homeRule').hidden,true);assert.equal(el('saveRuleEdit').textContent,'Save Home');
 el('device').value='/dev/input/event99';
 failure=true;await click({saveEdit:''});assert.ok(sandbox.ruleDraft);assert.equal(el('editApp0').value,'netflix.app');assert.equal(saved.find(r=>r.id==='home').actions[0].type,'launcher');
 assert.match(el('ruleEditStatus').textContent,/disk full/);assert.equal(el('ruleEditStatus').hidden,false);assert.equal(el('saveRuleEdit').disabled,false);
 assert.equal(calls.filter(c=>c.url==='/remap'&&c.body).at(-1).body.device,undefined,'Home editing reuses its saved remote instead of the new-shortcut device');
 const editorBeforePoll=el('ruleEditor').innerHTML;await sandbox.loadRules();assert.equal(el('ruleEditor').innerHTML,editorBeforePoll,'status reads preserve the failed draft');
 failure=false;await click({saveEdit:''});assert.equal(saved.find(r=>r.id==='home').actions[0].appId,'netflix.app');assert.equal(saved.length,2);assert.equal(sandbox.dockData,null,'Launcher status is re-read after editing Home');
 let release;holdRead=new Promise(r=>{release=r});const old=sandbox.loadRules();holdRead=null;
 const next=saved.filter(r=>r.id!=='home');await sandbox.saveRuleSet(next,'Restore default',el('saveRule'));release();await old;
 assert.equal(sandbox.rules.length,1,'late read cannot restore a deleted Home override');assert.match(el('homeRule').innerHTML,/Home → Samsung Home/);assert.match(el('homeRule').innerHTML,/data-edit-home/);
 sandbox.editRule(null,true);assert.equal(sandbox.ruleDraft.rule.actions[0].type,'native');await click({cancelEdit:''});
 el('inputCode').value='063';el('inputCode').oninput();assert.equal(el('saveRule').textContent,'Edit Home below');assert.equal(el('shortcutAction').disabled,true);
 const beforeHome=calls.filter(c=>c.url==='/remap'&&c.body).length;await el('saveRule').onclick();assert.equal(calls.filter(c=>c.url==='/remap'&&c.body).length,beforeHome,'Home capture opens its existing editor without saving a second mapping');
 assert.equal(el('ruleEditor').parentNode,el('homeEditorSlot'));el('editKind0').value='launcher';el('ruleEditor').onchange({target:{dataset:{editKind:'0'}}});el('editKind0').value='launcher';await click({saveEdit:''});
 assert.equal(saved.filter(r=>r.trigger.type==='physical'&&r.trigger.value==='63').length,1);assert.equal(saved.find(r=>r.trigger.value==='63').actions[0].type,'launcher');assert.equal(el('homeSaveStatus').textContent,'Home saved.');
 assert.match(html,/Other shortcuts[\s\S]*Enable remote shortcuts/);
 console.log('PASS mapping editor: inline Home, one editing location, saved remote reuse, actionable save errors, cancel, multi-action rules, failed drafts and stale reads');
})().catch(e=>{console.error(e);process.exitCode=1;});
