'use strict';
const assert=require('assert').strict, net=require('net'), crypto=require('crypto');
const {Bridge,devices}=require('../service/physical-input.js');
const remote='N: Name="Smart Control"\nH: Handlers=event4\n';
assert.equal(devices(remote)[0].selectable,true);
assert.equal(devices(remote+'\n'+remote)[0].unique,false);
assert.equal(devices('N: Name="panel key device"\nH: Handlers=event3\n')[0].selectable,false);
// On the TV the real remote reports an empty Phys; Vetro's forwarding device carries the same name and its marker.
const forwarded='N: Name="Smart Control"\nP: Phys=vetro-forwarded-remote\nH: Handlers=event30\n';
const realRemote='N: Name="Smart Control"\nP: Phys=\nH: Handlers=event4\n';
const inventory=forwarded+'\n'+realRemote;
const withForwarded=devices(inventory);
assert.equal(withForwarded.length,1);
assert.equal(withForwarded[0].node,'/dev/input/event4');
assert.equal(withForwarded[0].unique,true);
// Real BLE Smart Control remotes expose keyless companion HID nodes under the same name; only the keyed one is selectable.
const bleKeyed='N: Name="Smart Control 2016"\nH: Handlers=kbd event7\nB: EV=3\nB: KEY=380000 0 10001ffe\n';
const bleRelOnly='N: Name="Smart Control 2016"\nH: Handlers=event14\nB: EV=5\nB: REL=200\n';
const bleRepOnly='N: Name="Smart Control 2016"\nH: Handlers=event15\nB: EV=100001\n';
const bleZeroKeys='N: Name="Smart Control 2016"\nH: Handlers=event16\nB: EV=3\nB: KEY=0 0 0\n';
const bleParsed=devices(bleKeyed+'\n'+bleRelOnly+'\n'+bleRepOnly+'\n'+bleZeroKeys);
assert.equal(bleParsed.length,4);
assert.equal(bleParsed[0].selectable,true);
assert.equal(bleParsed[0].unique,true);
assert.equal(bleParsed[1].selectable,false);
assert.equal(bleParsed[2].selectable,false);
assert.equal(bleParsed[3].selectable,false);
(async function(){
 let socket, bridge, commands=[], got=[], bad=false;
 let authMode='observe';
 function execute(cmd){commands.push(cmd);if(cmd==='cat /proc/bus/input/devices')return Promise.resolve({exit_code:0,stdout:inventory});
  const secret=Buffer.from(/printf %s '([^']+)'/.exec(cmd)[1],'base64');
  const port=Number(/'127.0.0.1' '(\d+)'/.exec(cmd)[1]);
  socket=net.connect(port,'127.0.0.1');socket.on('error',()=>{});
  socket.once('data',chunk=>{const nonce=Buffer.from(chunk.toString().trim().split('\t')[1],'hex');
   function send(payload){const mac=crypto.createHmac('sha256',secret).update(nonce).update(Buffer.from([0])).update(payload).digest('hex');socket.write(payload+'\t'+(bad?'0'.repeat(64):mac)+'\n');}
   const b=s=>Buffer.from(s).toString('base64');send(['AUTH','123','0','0',b('Smart Control'),b('/dev/input/event4'),b('evdev'),b('TV'),authMode].join('\t'));
   if(!bad)setTimeout(()=>{send('EVENT\t1\t'+b(JSON.stringify({type:1,code:67,sequence:1,device:'Smart Control',node:'/dev/input/event4',action:'down',decision:'native'})))},20);
  });return Promise.resolve({exit_code:0});
 }
 bridge=new Bridge(execute,e=>got.push(e));
 try{
  const r=await bridge.start('Smart Control','observe',[]);assert.equal(r.policy.connected,true);
  await new Promise(r=>setTimeout(r,60));assert.equal(got[0].code,67);
  bridge.stop();assert.equal(bridge.status().policy.mode,'off');
  await assert.rejects(bridge.start('Smart Control','filter',[]),/physical rule/);
  authMode='filter';
  const filtered=await bridge.start('Smart Control','filter',['67']);
  assert.equal(filtered.policy.connected,true);
  assert.equal(filtered.policy.node,'/dev/input/event4');
  bridge.stop();
  authMode='observe';
  bad=true;await assert.rejects(bridge.start('Smart Control','observe',[]),/authentication/);assert.equal(bridge.status().policy.mode,'off');
  bad=false;
  const irRemote='N: Name="wt61p807 rc device"\nP: Phys=wt61p807/rc\nH: Handlers=kbd event1\n';
  const btRemote='N: Name="Smart Control 2016"\nP: Phys=\nH: Handlers=kbd event6\nB: EV=3\nB: KEY=380000 0 10001ffe\n';
  const multiInventory=forwarded+'\n'+irRemote+'\n'+btRemote;
  let multiGot=[];
  const multiBridge=new Bridge(cmd=>{
   commands.push(cmd);
   if(cmd==='cat /proc/bus/input/devices')return Promise.resolve({exit_code:0,stdout:multiInventory});
   const secret=Buffer.from(/printf %s '([^']+)'/.exec(cmd)[1],'base64');
   const port=Number(/'127\.0\.0\.1' '(\d+)'/.exec(cmd)[1]);
   assert.ok(cmd.includes("'*'")||cmd.includes("'*!"),'all-remotes mode passes * target to agent');
   if(cmd.includes("'filter'")||cmd.includes("'capture'"))assert.ok(cmd.includes('systemd-run --unit=vetro-input --collect'),'filter and capture use persistent systemd unit with fallback');
   const s=net.connect(port,'127.0.0.1');s.on('error',()=>{});
   s.once('data',chunk=>{
    const nonce=Buffer.from(chunk.toString().trim().split('\t')[1],'hex');
    function send(payload){const mac=crypto.createHmac('sha256',secret).update(nonce).update(Buffer.from([0])).update(payload).digest('hex');s.write(payload+'\t'+mac+'\n');}
    const b=v=>Buffer.from(v).toString('base64');
    const modeMatch=/'evdev' 'TV' '(observe|filter|capture)'/.exec(cmd)[1];
    send(['AUTH','124','0','0',b('all'),b('all'),b('evdev'),b('TV'),modeMatch].join('\t'));
    if(modeMatch==='filter'||modeMatch==='capture'){
     setTimeout(()=>{
      send('EVENT\t1\t'+b(JSON.stringify({type:1,code:626,sequence:1,device:'wt61p807 rc device',node:'/dev/input/event1',action:'down',decision:'blocked'})));
      send('EVENT\t2\t'+b(JSON.stringify({type:1,code:626,sequence:2,device:'Smart Control 2016',node:'/dev/input/event6',action:'down',decision:'blocked'})));
     },20);
    }
   });
   return Promise.resolve({exit_code:0});
  },e=>multiGot.push(e));
  try{
   const allObs=await multiBridge.start('all','observe',[]);
   assert.equal(allObs.policy.device,'all');
   assert.equal(allObs.policy.node,'all');
   assert.equal(allObs.policy.devices.length,2);
   const allFilt=await multiBridge.start('all','filter',['63','626']);
   assert.equal(allFilt.policy.connected,true);
   assert.equal(allFilt.policy.device,'all');
   await new Promise(r=>setTimeout(r,60));
   assert.deepEqual(multiGot.map(x=>[x.node,x.code]),[['/dev/input/event1',626],['/dev/input/event6',626]],'accepts events from multiple physical remote nodes');
   multiGot=[];
   const allExcl=await multiBridge.start('all','filter',['63'],undefined,{exclude:['wt61p807 rc device']});
   assert.deepEqual(allExcl.policy.devices,[{name:'Smart Control 2016',node:'/dev/input/event6'}]);
   assert.deepEqual(allExcl.policy.exclude,['wt61p807 rc device']);
   const allCap=await multiBridge.start('all','capture',[]);
   assert.equal(allCap.policy.mode,'capture');
   await new Promise(r=>setTimeout(r,60));
   assert.equal(multiGot.length,2,'capture mode receives blocked events without filter tokens');
  }finally{multiBridge.stop();}
  assert.equal(commands.filter(x=>x.includes('nohup')).length,7);
  console.log('PASS physical input: exact devices, own forwarding device skipped, all-remotes, exclude, capture, authenticated events, stop, reject invalid MAC');
 }finally{bridge.stop();if(socket)socket.destroy();}
})().catch(e=>{console.error(e);process.exitCode=1});
