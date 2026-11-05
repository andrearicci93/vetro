'use strict';
const assert = require('assert').strict, path = require('path');
const load = require('./service-harness.cjs');
const flush = () => new Promise(setImmediate);
function setup() {
  const bridges = [], launches = [], inventory = [], commands = [], queue = [];
  const saved = JSON.stringify({rules: [{id:'test', enabled:true, trigger:{type:'physical',value:'67'}, actions:[{type:'launch',appId:'example.app'}]}], input:{enabled:true,device:'Smart Control',node:'/dev/input/event4'}});
  let writes = 0;
  class Bridge {
    constructor(execute, onEvent) { this.onEvent = onEvent; this.current = {mode:'off',connected:false}; bridges.push(this); }
    stop() { this.current = {mode:'off',connected:false}; }
    status() { return {policy:this.current,events:[]}; }
    inventory() { return new Promise(resolve => inventory.push(resolve)); }
    start(node, mode) { launches.push(node); this.current={mode,connected:true}; return Promise.resolve(this.status()); }
  }
  const service = load(path.resolve(__dirname, '..'), {setInterval: () => ({unref(){}}), dependencies: {
    fs: {readFileSync: name => name.endsWith('vetro-remap.json') ? saved : '', writeFileSync(){writes++;}},
    './physical-input.js': {Bridge},
    './platform.js': {start(){}, status:()=>({agent:{connected:true}}), execute(command){commands.push(command); return new Promise(resolve=>queue.push(resolve));}}
  }});
  return {service, bridges, launches, inventory, commands, queue, writes:()=>writes};
}
(async()=>{
  const f = setup(), c=f.service.context, lifecycle=f.service.lifecycle;
  c.restoreInput(); assert.equal(f.inventory.length,1);
  lifecycle.onStop(); lifecycle.onExit();
  f.inventory.shift()([{name:'Smart Control',node:'/dev/input/event4',selectable:true}]); await flush();
  assert.equal(f.launches.length,0,'a stopped restoration must not launch a helper');
  assert.equal(c.inputLifecycleActive,false); assert.equal(f.writes(),0,'stop preserves saved mappings and preference');
  c.restoreInput(); assert.equal(f.inventory.length,0);
  lifecycle.onStart(); lifecycle.onRequest(); c.restoreInput();
  f.inventory.shift()([{name:'Smart Control',node:'/dev/input/event4',selectable:true}]); await flush();
  assert.equal(f.launches.length,1); assert.equal(c.physical.status().policy.connected,true);
  // A physical action that is already waiting behind another root command must be cancelled at dispatch.
  const hold=c.agentExecute('blocking-read'); await flush();
  c.physical.onEvent({action:'down',decision:'blocked',code:67}); await flush();
  lifecycle.onExit(); f.queue.shift()({exit_code:0,stdout:''}); await hold; await c.actionQueue;
  assert.deepEqual(f.commands,['blocking-read']); assert.equal(c.physical.status().policy.mode,'off');
  assert.equal(f.writes(),0); assert.equal(c.pendingActions,0);
  // A late failed restoration must not clear or overwrite the replacement generation.
  lifecycle.onStart(); c.restoreInput(); const old=f.inventory.shift();
  lifecycle.onStop(); lifecycle.onRequest(); c.restoreInput();
  old([]); await flush(); assert.equal(c.inputRestoring,true);
  f.inventory.shift()([{name:'Smart Control',node:'/dev/input/event4',selectable:true}]); await flush();
  assert.equal(c.inputRestoring,false); assert.equal(c.inputError,null);
  lifecycle.onExit();
  console.log('PASS input service lifecycle: stop releases helpers, preserves preferences, cancels queued actions and isolates restoration generations');
})().catch(error=>{console.error(error);process.exitCode=1;});
