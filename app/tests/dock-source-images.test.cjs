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
// #297: both Homes' source lists are read, the newer one wins key by key; Samsung's device pictures (canalysis, PNG) are used, its SVG type icons are not.
{
 const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64');
 const old={HDMI1:{SourceType:13},HDMI2:{SourceType:14,EditName:'Old box'}};
 const cur={'HDMI1/0':{SourceType:13,EditName:'PS5',LauncherUnfocusedIconPath:'/usr/share/canalysis/Icon/Launcher/2K/launcher_ps5_n.png'},
   HDMI4:{SourceType:16,EditName:'PC',IconPath:'/usr/apps/com.samsung.tv.theme-resource/shared/res/VD_ICONS/i_icon_device_m_pc.svg'}};
 for(const order of [['S|100|'+enc(old),'S|200|'+enc(cur)],['S|200|'+enc(cur),'S|100|'+enc(old)]]){
  const b=catalog.build(catalog.parse(order.join('\n')),{useSourceImages:true});
  assert.deepEqual(b.inputs.slice(1).map(e=>e.label),['PS5','Old box','HDMI 3','PC'],'the newer list wins, whatever the order');
  assert.equal(b.inputs[1].icon,'/usr/share/canalysis/Icon/Launcher/2K/launcher_ps5_n.png');
  assert.equal(b.inputs[4].icon,null,'an SVG is not drawable');
 }
 const both=catalog.parse('S|1|'+enc({HDMI1:{SourceType:13}, 'HDMI1/0':{SourceType:13,DetectedName:'Switch 2'}}));
 assert.equal(catalog.build(both,{}).inputs[1].label,'Switch 2','an entry with a name first');
 assert.equal(catalog.build(catalog.parse('S|'+enc({HDMI1:{EditName:'Box'}})),{}).inputs[1].label,'Box','the old one-field line still reads');
 assert.equal(catalog.build(catalog.parse('S|1|'+enc({HDMI1:{SourceType:13,IconPath:'/usr/share/canalysis/../x.png'}})),{useSourceImages:true}).inputs[1].icon,null);
}
console.log('PASS independent native source artwork option; #297 newer source list, canalysis pictures');
