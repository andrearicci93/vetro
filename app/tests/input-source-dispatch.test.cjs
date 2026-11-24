'use strict';
const assert = require('assert').strict;
const path = require('path');
const EventEmitter = require('events');
const spawnSync = require('child_process').spawnSync;
const loadService = require('./service-harness.cjs');
const remap = require('../service/remap.js');

// Keep the real selector, dispatcher, physical-event callback and HTTP route.
// Only the TV execution boundary is substituted: it inspects actual shell argv
// and changes readback only for the packaged one-shot app-control command.
const icon = '/usr/apps/com.samsung.tv.theme-resource/shared/res/VD_ICONS/i_icon_device_m_pc.svg';
const cache = {HDMI1:{SourceType:13,IconPath:icon},DISPLAYPORT:{SourceType:33,IconPath:icon},USB_C:{SourceType:41,IconPath:icon}};
const encoded = Buffer.from(JSON.stringify(cache)).toString('base64');
const {context, router} = loadService(path.resolve(__dirname, '..'), {listen:false,setInterval:()=>1});
let current = 33, refuse = false;
const requests = [];
const readback = () => '[memory] memory/system/source_type = Int32: ' + current + '\n';
context.agentExecute = async (command, _timeout, guard) => {
    if (guard && !guard()) throw Error('Input action cancelled');
    if (command.includes('.sourceCache')) return {exit_code:0,stdout:'CACHE|' + encoded + '\n' + readback()};
    if (command.includes('echo ICON_')) return {exit_code:0,stdout:'ICON_0\nICON_1\nICON_2\nICON_3\n'};
    if (command.startsWith('buxton2ctl')) return {exit_code:0,stdout:readback()};
    assert.ok(command.includes('/usr/bin/dotnet '), 'input actions must use native app-control, not app_launcher arguments or injected TV keys');
    const tail = command.split('/usr/bin/dotnet ')[1];
    const parsed = spawnSync('/bin/sh', ['-c', 'set -- ' + tail + '; printf "%s\\0" "$@"']);
    assert.equal(parsed.status, 0);
    const args = parsed.stdout.toString().split('\0').filter(Boolean);
    assert.equal(args.length, 5, 'the helper receives exactly four arguments');
    assert.equal(args[0], path.resolve(__dirname, '../native/dock/tvlauncher-dotnet.dll'));
    assert.equal(args[1], '--switch-source');
    assert.equal(args[4], icon);
    requests.push(args.slice(2));
    if (!refuse) current = Number(args[2]);
    return {exit_code:refuse?1:0,stdout:''};
};
function post(body) {
    return new Promise((resolve,reject) => {
        const req = new EventEmitter();
        Object.assign(req,{method:'POST',url:'/inputs',headers:{host:'127.0.0.1:8099'},socket:{remoteAddress:'127.0.0.1'},resume(){}});
        const res = {headersSent:false,statusCode:200,setHeader(){},writeHead(code){this.statusCode=code;this.headersSent=true;},
            end(text){try{resolve({code:this.statusCode,body:JSON.parse(text)});}catch(e){reject(e);}}};
        router(req,res);
        process.nextTick(()=>{req.emit('data',Buffer.from(JSON.stringify(body)));req.emit('end');});
    });
}
async function press(code) {
    context.physical.onEvent({code,action:'down',decision:'blocked'});
    await context.actionQueue;
}
(async()=>{
    const selected = await post({sourceType:41});
    assert.equal(selected.code,200);
    assert.equal(selected.body.currentSourceType,41);
    assert.deepEqual(requests[0],['41','USB-C',icon]);

    context.remapStore.rules = remap.validateRules([
        {id:'dp',trigger:{type:'physical',value:'226'},actions:[{type:'key',key:'KEY_INPUT_33'}]},
        {id:'hdmi',trigger:{type:'physical',value:'560'},actions:[{type:'key',key:'KEY_INPUT_13'}]}
    ]);
    context.inputLifecycleActive = true;
    await press(226);
    assert.equal(current,33,'a real resolved physical rule reaches the native source command');
    await press(560);
    assert.equal(current,13);
    assert.deepEqual(requests.map(r=>r[0]),['41','33','13']);

    refuse = true;
    const failed = await post({sourceType:41});
    assert.equal(failed.code,503,'a native rejection is an HTTP failure');
    assert.match(failed.body.error,/selection failed/);
    assert.equal(current,13,'failed selection does not invent a selected source');
    await press(226);
    assert.match(context.inputError,/selection failed/,'the physical pipeline records the failure instead of reporting success');
    refuse = false;
    assert.equal((await post({sourceType:41})).code,200,'a failed physical action releases the shared selection lock');
    console.log('PASS input dispatch: dashboard route and physical shortcuts use the packaged native helper, shell argv and verified readback');
})().catch(e=>{console.error(e);process.exitCode=1});
