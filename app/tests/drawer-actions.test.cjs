'use strict';
const assert=require('assert').strict,vm=require('vm');
const nodes={};
class Node {
 constructor(){this._html='';this.children=[];this.disabled=false;this.hidden=false;this.value='';this.textContent='';this.style={};}
 set innerHTML(value){this._html=value;this.children=[];for(const m of value.matchAll(/<(button|input|p|span)[^>]*\bid="([^"]+)"([^>]*)>/g)){const n=nodes[m[2]]=new Node();n.disabled=/\bdisabled\b/.test(m[3]);}}
 get innerHTML(){return this._html+this.children.map(n=>n.innerHTML).join('');}
 appendChild(n){this.children.push(n);}focus(){}scrollIntoView(){}
}
const el=id=>nodes[id]||(nodes[id]=new Node());
const app={appId:'MCmYXNxgcu.DisneyPlusService',packageId:'MCmYXNxgcu',name:'DisneyPlusPreviewService',system:false,removable:true,disabled:false,show:false,onboot:false,autorestart:true};
const sandbox={document:{body:{classList:{contains:()=>false}},querySelector:el,getElementById:el,createElement:()=>new Node(),querySelectorAll:()=>[],addEventListener(){}},console,setInterval(){},setTimeout(){},clearTimeout(){},confirm:()=>true,fetch:async url=>({ok:true,json:async()=>url.startsWith('/apps')?{apps:[app],summary:{total:1}}:url==='/remap'?{rules:[]}:url==='/input'?{devices:[],status:{events:[]}}:url.startsWith('/monitor')?{ts:Date.now(),cpu:{cores:[]},memory:{},network:[],processes:[]}:{} })};
vm.runInNewContext(require('../service/dashboard')().match(/<script>([\s\S]*?)<\/script>/)[1],sandbox);
(async()=>{
 await new Promise(r=>setImmediate(r));sandbox.inventory=[app];sandbox.detail(app.appId);
 const drawer=el('detail').innerHTML;
 assert(drawer.indexOf('id="toggleApp"')<drawer.indexOf('<dl>'),'Disable must appear before package details');
 assert(drawer.indexOf('id="uninstallComponent"')<drawer.indexOf('<dl>'),'Uninstall must appear before package details');
 assert.equal(el('toggleApp').disabled,false,'removable user service must be eligible for disable');
 assert.equal(el('uninstallComponent').disabled,false,'removable user package must be eligible for uninstall');
 assert.match(drawer,/background component/i,'unavailable launch explains why');
 sandbox.updateComponentRuntime({known:true,count:1,cpu:2,rss:1048576});
 assert.equal(el('stopComponent').disabled,false);assert.equal(el('stopComponentReason').hidden,true,'running process must clear stale stop explanation');
 sandbox.updateComponentRuntime({known:true,count:0,cpu:null,rss:0});
 assert.equal(el('stopComponent').disabled,true);assert.equal(el('stopComponentReason').hidden,false);assert.match(el('stopComponentReason').textContent,/No linked/);
 var performed=[];sandbox.runComponentAction=(a,p)=>{performed.push(p);return Promise.resolve(true)};sandbox.confirm=()=>false;
 el('toggleApp').onclick();
 assert.match(el('componentConfirmation').innerHTML,/Confirm disable/,'blocked browser dialogs must still show an in-page confirmation');
 assert.equal(performed.length,0,'opening confirmation must not mutate the TV');
 el('cancelComponentAction').onclick();assert.equal(performed.length,0);
 el('toggleApp').onclick();el('confirmComponentAction').onclick();assert.equal(performed[0].action,'disable');
 el('uninstallComponent').onclick();assert.match(el('componentConfirmation').innerHTML,/MCmYXNxgcu/,'uninstall confirmation identifies the whole package');
 assert.equal(performed.length,1);el('cancelComponentAction').onclick();assert.equal(performed.length,1);
 sandbox.inventory=[{...app,system:true,removable:false}];sandbox.detail(app.appId);
 assert.equal(el('toggleApp').disabled,true);assert.equal(el('uninstallComponent').disabled,true);
 assert.match(el('detail').innerHTML,/system component|system packages/i,'disabled commands have visible reasons');
 console.log('PASS drawer: actions first, user package actions available, unavailable commands explained');
})().catch(e=>{console.error(e);process.exitCode=1});
