 'use strict';
const assert=require('assert').strict,catalog=require('../service/dock-catalog.js');
const native='/opt/usr/apps/device/shared/source.png';
const parsed=catalog.parse(['O|s/source.layer.hdmi@HDMI1','S|'+Buffer.from(JSON.stringify({HDMI1:{IconPath:native,DetectedName:'Console'}})).toString('base64')].join('\n'));
for(const showHomeSources of [false,true]) for(const useSourceImages of [false,true]) {
 const b=catalog.build(parsed,{showHomeSources,useSourceImages});
 assert.equal(b.entries.length,showHomeSources?1:0);
 assert.equal(b.inputs[1].icon,useSourceImages?native:null);
 assert.equal(b.inputs[1].label,'Console');
 assert.deepEqual(b.inputs.map(e=>e.appId),['source:0','source:13','source:14','source:15','source:16']);
 if(showHomeSources) assert.equal(b.entries[0].icon,b.inputs[1].icon);
}
console.log('PASS independent native source artwork option');
