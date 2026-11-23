'use strict';
var groupApps = require('./app-groups.js');
var componentAvailability = require('./component-actions.js').availability;
var quickGroups = require('./quick-settings.js').GROUPS;
var quickStateFn = require('./quick-settings.js').state;
var verifiedDisableIds = require('./debloat.js').VERIFIED_GLOBAL_IDS.concat(require('./quick-settings.js').ALLOWED_IDS);
// Small purpose markers share the dashboard's existing 24px outline vocabulary.
var sectionIcons={
 update:'<path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/>',
 storage:'<path d="m5 4-3 9v7h20v-7l-3-9H5ZM2 13h20M6 17h.01M10 17h.01"/>',
 firmware:'<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
 restore:'<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5M3.5 3.8v4.7h4.7M12 7.5V12l3 2"/>',
 remove:'<rect x="6" y="7" width="12" height="14" rx="2"/><path d="M4 7h16M9 7V3h6v4M10 11v6M14 11v6"/>',
 privacy:'<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z"/><path d="m8 8 8 8"/>',
 voice:'<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8"/>',
 disable:'<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
memory:'<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
 home:'<path d="m3 11 9-8 9 8M5 9v12h14V9M9 21v-7h6v7"/>',
 access:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
 tv:'<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
 keys:'<rect x="7" y="2" width="10" height="20" rx="3"/><circle cx="12" cy="8" r="2"/><path d="M10 15h4M10 18h4"/>',
 preview:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M7 21h10M9 13l2-3 2 2 2-3"/>'
};
// Disable and Uninstall, said the same way in both tabs; the name of the other tab switches to it.
function quickPair(here){var line=function(id,name,text){return '<p>'+(id===here?'<strong>'+name+'</strong>':'<button type="button" class="link-button" data-quick-goto="'+id+'">'+name+'</button>')+': '+text+'</p>'};return '<div class="tab-pair">'+line('memory','Disable','switched off, still on the TV.')+line('uninstall','Uninstall','deleted from the TV, to free space.')+'</div>'}
function sectionIcon(name){return '<svg class="section-icon" viewBox="0 0 24 24" aria-hidden="true">'+sectionIcons[name]+'</svg>'}
// The keys a Remapper shortcut or a Home Assistant rule can send, grouped as on the remote; control.js turns each name into the TV's own key.
var SEND_KEYS=[['Inputs',[['KEY_TV','TV'],['KEY_HDMI1','HDMI 1'],['KEY_HDMI2','HDMI 2'],['KEY_HDMI3','HDMI 3'],['KEY_HDMI4','HDMI 4'],['KEY_DISPLAYPORT','DisplayPort']]],
 ['Playback',[['KEY_PLAYPAUSE','Play/Pause'],['KEY_PLAY','Play'],['KEY_PAUSE','Pause'],['KEY_STOP','Stop'],['KEY_REWIND','Rewind'],['KEY_FF','Fast forward']]],
 ['Remote',[['KEY_POWER','Power'],['KEY_HOME','Home'],['KEY_RETURN','Back'],['KEY_EXIT','Exit'],['KEY_UP','Up'],['KEY_DOWN','Down'],['KEY_LEFT','Left'],['KEY_RIGHT','Right'],['KEY_ENTER','OK'],['KEY_VOLUP','Volume up'],['KEY_VOLDOWN','Volume down'],['KEY_MUTE','Mute']]]];
function keyOptions(){return SEND_KEYS.map(function(g){return '<optgroup label="'+g[0]+'">'+g[1].map(function(k){return '<option value="'+k[0]+'">'+k[1]+'</option>'}).join('')+'</optgroup>'}).join('')}
var sendKeyLabels={};SEND_KEYS.forEach(function(g){g[1].forEach(function(k){sendKeyLabels[k[0]]=k[1]})});
var aboutPhoto=require('./about-photo.js');
var tunerPage=require('./tuner-page.js');
module.exports = function(){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content"><title>Vetro · TV manager</title><link rel="icon" href="/icon.png"><style>
/* Tokens: the Vetro design system (app/design-system/tokens.css) first, then the shorter names this page uses. */
:root{color-scheme:dark;--vetro-blue-950: #00115b;--vetro-blue-700: #123bb5;--vetro-blue-600: #0450ef;--vetro-blue-400: #1674fb;--vetro-ice-100: #e1ebfd;--vetro-white: #f5f8ff;--vetro-bg: #080f23;--vetro-surface: #101c35;--vetro-surface-raised: #192943;--vetro-text: var(--vetro-white);--vetro-text-muted: #aab8d1;--vetro-border: #344360;--vetro-control-border: #7183a2;--vetro-warning: #e2b867;--vetro-on-warning: #101c35;--vetro-action: var(--vetro-blue-700);--vetro-action-hover: #0e3095;--vetro-on-action: var(--vetro-white);--vetro-link: #8fbaff;--vetro-focus: #8fbaff;--vetro-gradient-brand: radial-gradient(ellipse at 24% 72%, #1674fb 0%, transparent 52%), radial-gradient(ellipse at 78% 22%, #0450ef 0%, transparent 54%), linear-gradient(135deg, #00115b, #123bb5 52%, #00115b);--vetro-gradient-blue: linear-gradient(135deg, #00115b 0%, #123bb5 48%, #1674fb 100%);--vetro-gradient-glass: linear-gradient(145deg, rgba(245, 248, 255, .16), rgba(225, 235, 253, .04) 55%, rgba(245, 248, 255, .10));--vetro-glass-fill: rgba(16, 28, 53, .88);--vetro-glass-edge: rgba(225, 235, 253, .22);--vetro-glass-blur: 16px;--vetro-shadow: 0 12px 32px rgba(0, 8, 35, .24);--vetro-font: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;--vetro-font-mono: ui-monospace, SFMono-Regular, Consolas, monospace;--vetro-text-small: .875rem;--vetro-text-body: 1rem;--vetro-text-section: 1.125rem;--vetro-prose-measure: 56ch;--vetro-text-title: 1.5rem;--vetro-text-display: 2.5rem;--vetro-weight-regular: 400;--vetro-weight-medium: 500;--vetro-line-body: 1.5;--vetro-line-heading: 1.15;--vetro-space-1: 4px;--vetro-space-2: 8px;--vetro-space-3: 12px;--vetro-space-4: 16px;--vetro-space-6: 24px;--vetro-space-8: 32px;--vetro-space-12: 48px;--vetro-radius-control: 8px;--vetro-radius-surface: 16px;--vetro-column-min: 26rem;--vetro-control-height: 44px;--vetro-focus-width: 2px;--vetro-focus-offset: 3px;--vetro-duration-fast: 120ms;--vetro-duration-normal: 200ms;--vetro-ease: cubic-bezier(.2, 0, 0, 1);--bg:var(--vetro-bg);--surface:var(--vetro-surface);--raised:var(--vetro-surface-raised);--border:var(--vetro-border);--text:var(--vetro-text);--muted:var(--vetro-text-muted);--accent-rgb:143,186,255;--ok-rgb:127,203,160;--warn-rgb:226,184,103;--danger-rgb:239,138,128;--accent:var(--vetro-link);--ok:rgb(var(--ok-rgb));--warn:var(--vetro-warning);--danger:rgb(var(--danger-rgb));--accent-soft:rgba(var(--accent-rgb),.14);--ok-soft:rgba(var(--ok-rgb),.12);--warn-soft:rgba(var(--warn-rgb),.12);--danger-soft:rgba(var(--danger-rgb),.12);--accent-line:rgba(var(--accent-rgb),.4);--ok-line:rgba(var(--ok-rgb),.4);--warn-line:rgba(var(--warn-rgb),.4);--danger-line:rgba(var(--danger-rgb),.4);--on-accent:var(--vetro-blue-950);--overlay:rgba(0,8,35,.62);--s1:var(--vetro-space-1);--s2:var(--vetro-space-2);--s3:var(--vetro-space-3);--s4:var(--vetro-space-4);--s5:var(--vetro-space-6);--r:var(--vetro-radius-control);--r-surface:var(--vetro-radius-surface);--pill:999px;--fs-s:var(--vetro-text-small);--fs-m:var(--vetro-text-body);--fs-l:var(--vetro-text-section);--fs-xl:var(--vetro-text-title);--safe-top:env(safe-area-inset-top,0px);--safe-right:env(safe-area-inset-right,0px);--safe-bottom:env(safe-area-inset-bottom,0px);--safe-left:env(safe-area-inset-left,0px);--scroll-clearance:calc(72px + var(--safe-top));--side:clamp(256px,16rem,352px);--font-ui:var(--vetro-font);--font-mono:var(--vetro-font-mono)}
@media (prefers-reduced-motion: reduce){:root{--vetro-duration-fast:0ms;--vetro-duration-normal:0ms}}
/* Base */
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:var(--fs-m)/1.5 var(--font-ui);-webkit-font-smoothing:antialiased}
h1,h2,h3,h4,p{margin:0}
h1,h2,h3,h4{text-wrap:balance;overflow-wrap:anywhere}
p{text-wrap:pretty;overflow-wrap:anywhere}
.panel>p,.box>p,.panel>ol.steps,.quick-group>ol.steps{max-width:var(--vetro-prose-measure)}
h1{font-size:var(--fs-xl);font-weight:500;letter-spacing:0;line-height:1.2}
h2{font-size:var(--fs-l);font-weight:500}
h3{font-size:var(--fs-m);font-weight:500}
h4{font-size:var(--fs-s);font-weight:500;color:var(--muted)}
a{color:var(--accent)}
code{font-family:var(--font-mono);font-size:var(--fs-s)}
.muted{color:var(--muted)}
.notice,.section-note{color:var(--muted);font-size:var(--fs-s);line-height:1.6;max-width:var(--vetro-prose-measure)}
.steps{max-width:var(--vetro-prose-measure);overflow-wrap:anywhere}
.steps li{text-wrap:pretty}
.section-note{margin:0 0 var(--s3)}
[hidden]{display:none!important}
/* Controls */
input[type=file]{height:auto;max-width:100%;padding:var(--s2);color:var(--muted);font-size:var(--fs-s)}
input[type=file]::file-selector-button{min-height:44px;height:auto;margin-right:var(--s3);padding:0 var(--s3);border:1px solid var(--vetro-control-border);border-radius:var(--r);background:var(--surface);color:var(--text);font:inherit;cursor:pointer}
button,input,select,textarea{font:inherit;color:var(--text);border:1px solid var(--vetro-control-border);border-radius:var(--r);background:var(--raised)}
button,select,input:not([type=checkbox]){min-height:var(--vetro-control-height);height:auto;padding:var(--s2) var(--s4)}
input:not([type=checkbox]),select,textarea{font-size:var(--fs-m)}
button{cursor:pointer;max-width:100%;overflow-wrap:anywhere;scroll-margin-block:var(--scroll-clearance)}
input,select,textarea{caret-color:var(--accent);scroll-margin-block:var(--scroll-clearance)}
::selection{background:var(--accent);color:var(--on-accent)}
a{text-underline-offset:.18em}
.sidebar,.drawer,.table-wrap{scrollbar-color:var(--vetro-control-border) var(--surface)}
button:hover:not(:disabled){background:var(--border)}
button:disabled{opacity:.45;cursor:default}
input::placeholder,textarea::placeholder{color:var(--muted)}
textarea{width:100%;padding:var(--s3);font:var(--fs-m)/1.5 var(--font-mono);resize:vertical}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible,a:focus-visible{outline:var(--vetro-focus-width) solid var(--vetro-focus);outline-offset:var(--vetro-focus-offset)}
.primary{background:var(--vetro-action);color:var(--vetro-on-action);border-color:var(--vetro-action);font-weight:500}
.primary:hover:not(:disabled){background:var(--vetro-action-hover);border-color:var(--vetro-action-hover)}
.danger,#uninstallComponent,#confirmComponentAction{color:var(--danger);border-color:var(--danger-line);background:var(--danger-soft)}
.danger:hover:not(:disabled),#uninstallComponent:hover:not(:disabled),#confirmComponentAction:hover:not(:disabled){background:var(--danger-soft);border-color:var(--danger)}
#detail .primary:disabled{background:var(--raised);color:var(--muted);border-color:var(--border)}
.switch{display:flex;min-height:44px;width:max-content;max-width:100%;align-items:center;gap:var(--s3);cursor:pointer}
.switch input{appearance:none;-webkit-appearance:none;width:40px;height:24px;padding:0;border:1px solid var(--vetro-control-border);border-radius:var(--pill);background:var(--raised);position:relative;flex-shrink:0;cursor:pointer;transition:background var(--vetro-duration-fast) var(--vetro-ease)}
.switch input:before{content:"";position:absolute;left:3px;top:3px;width:16px;height:16px;border-radius:50%;background:var(--muted);transition:transform var(--vetro-duration-fast) var(--vetro-ease),background var(--vetro-duration-fast) var(--vetro-ease)}
.switch input:checked{background:var(--vetro-action);border-color:var(--vetro-link)}
.switch input:checked:before{transform:translateX(16px);background:var(--vetro-white)}
.switch input:disabled{opacity:.45;cursor:default}
.switch span{color:var(--text)}
.panel .switch,.box .switch,.drawer .switch{margin:var(--s3) 0 0}
.field{display:grid;gap:var(--s1);margin:var(--s3) 0 0}
.field span{font-size:var(--fs-s);color:var(--muted)}
.field input,.field select{width:100%;min-width:0}
.row{display:flex;gap:var(--s2);flex-wrap:wrap;align-items:center}
.row .field,.form-grid .field{margin:0;min-width:0}
.row .field{flex:1 1 200px}
.form-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--s3);margin-top:var(--s3)}
/* Layout */
.sidebar{position:fixed;inset:0 auto 0 0;width:var(--side);background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column;padding:var(--s5) var(--s3);padding-top:max(var(--s5),var(--safe-top));padding-left:max(var(--s3),var(--safe-left));padding-bottom:calc(var(--s5) + var(--safe-bottom));z-index:1;overflow-y:auto}
.brand{display:flex;align-items:center;gap:var(--s3);padding:0 var(--s3) var(--s4)}
.brand img{width:44px;height:44px;border-radius:22%;flex-shrink:0;display:block}
.brand span{font-size:var(--fs-xl);font-weight:500;letter-spacing:0;line-height:1.1}
.brand small{display:block;font-size:var(--fs-s);letter-spacing:0;color:var(--muted);font-weight:400;margin-top:var(--s1)}
.brand small:before{content:"";display:inline-block;width:6px;height:6px;margin-right:var(--s1);border-radius:50%;background:currentColor;vertical-align:middle;opacity:.55}
.brand small.is-on{color:var(--ok)}.brand small.is-on:before{opacity:1}
.nav-label{font-size:var(--fs-s);color:var(--muted);padding:var(--s4) var(--s3) var(--s1)}
.sidebar nav{display:grid;gap:2px}
.sidebar [data-tab]{display:flex;align-items:center;gap:var(--s3);height:auto;padding:var(--s2) var(--s3);border:0;background:transparent;color:var(--muted);font-size:var(--fs-s);text-align:left;white-space:normal}
.sidebar [data-tab]:hover{background:var(--raised);color:var(--text)}
.sidebar [data-tab][aria-current=page]{background:var(--accent-soft);color:var(--vetro-ice-100);font-weight:500;box-shadow:inset 0 0 0 1px var(--accent-line)}
.sidebar [data-tab] .chip{margin-left:auto;white-space:nowrap;flex-shrink:0}
.sidebar [data-tab] .notice-dot{margin-left:auto;width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0}
.sidebar svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}
.nav-count{margin-left:auto}
.side-low{margin-top:auto;padding-top:var(--s5);display:grid;gap:var(--s1)}
.sidebar .side-low .quiet{font-size:12px;padding:var(--s1) var(--s3);min-height:32px;color:var(--muted);opacity:.9}
.sidebar .side-low .quiet svg{width:15px;height:15px;opacity:.8}
.sidebar .side-low .quiet[aria-current=page]{opacity:1}
.about-btn{display:flex;align-items:center;gap:var(--s3);width:100%;height:auto;padding:var(--s2) var(--s3);border:1px solid var(--border);background:transparent;color:var(--text);font-size:var(--fs-s);text-align:left}
.about-btn:hover{background:var(--raised)}
.sidebar footer{margin-top:var(--s3);padding:var(--s4) var(--s3) 0;border-top:1px solid var(--border);font-size:var(--fs-s);color:var(--muted)}
#connection{display:block;margin-top:var(--s1)}
.live-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--ok);margin-right:var(--s2)}
.main{margin-left:var(--side);padding:var(--s5) 32px 64px;padding-right:max(32px,var(--safe-right));padding-bottom:calc(64px + var(--safe-bottom))}
.page{max-width:1120px;margin:0 auto}
.page-head{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--s4);margin-bottom:var(--s5)}
.page-head p{color:var(--muted);margin-top:var(--s1)}
.page-head .actions{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s3);min-width:0;max-width:100%}
.live{font-size:var(--fs-s);color:var(--muted);max-width:100%;overflow-wrap:anywhere}
/* Cards */
.panel,.box,.quick-group,.metric,.operation-log{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-surface);padding:var(--s4) var(--s5)}
.panel>*+*,.box>*+*{margin-top:var(--s3)}
.panel>.section-note,.panel>.notice{margin-bottom:0}
.panel>h3:not(:first-child){margin-top:var(--s5)}
.panel+.panel,.panel+.box,.box+.box,#dockBody>*+*,.layout+.box{margin-top:var(--s4)}
.panel-head{display:flex;justify-content:space-between;align-items:center;gap:var(--s3)}
.panel-head small{color:var(--muted);font-size:var(--fs-s)}
.layout,.chart-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s4)}
.layout>.box,.chart-grid>.panel{margin-top:0;min-width:0}
.chart-grid+.panel{margin-top:var(--s4)}
.charts{margin-bottom:var(--s4)}
.empty{padding:var(--s5);text-align:center;color:var(--muted)}
/* Dashboard */
.metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--s4);margin-bottom:var(--s4)}
.metric{padding:var(--s4);min-width:0}
.metric .label,.metric small{color:var(--muted);font-size:var(--fs-s)}
.metric .label,.metric small,.metric .value{overflow-wrap:anywhere}
#dashboard{container-type:inline-size}
.metric .value{font-size:var(--fs-xl);font-weight:500;letter-spacing:0;line-height:1.3;margin:var(--s1) 0;font-variant-numeric:tabular-nums}
.metric .value.long{font-size:var(--fs-l);line-height:2}
.metric small{display:block}
.spark{height:110px;width:100%;display:block;margin-top:var(--s2)}
.spark .gridline{stroke:var(--border);stroke-width:1}
.spark polyline{fill:none;stroke:var(--accent);stroke-width:2;vector-effect:non-scaling-stroke}
.chart-label{display:flex;justify-content:space-between;color:var(--muted);font-size:var(--fs-s);margin-top:var(--s2)}
.core{display:grid;grid-template-columns:48px 1fr 44px;gap:var(--s3);align-items:center;font-size:var(--fs-s);margin:var(--s3) 0}
.bar{height:6px;border-radius:var(--pill);background:var(--raised);overflow:hidden}
.bar i{display:block;height:100%;background:var(--accent)}
dl.plain{margin:0;padding:var(--s1) 0;border:0}
.table-note{display:flex;justify-content:space-between;flex-wrap:wrap;gap:var(--s2);font-size:var(--fs-s);color:var(--muted);margin:var(--s3) 0 var(--s4)}
/* Tables */
.table-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:var(--r);background:var(--surface)}
.table-wrap+.section-note{margin:var(--s3) 0 0}
.panel>.table-wrap{background:transparent}
table{font-size:var(--fs-s);border-collapse:collapse;width:100%;text-align:left;white-space:nowrap}
th,td{padding:var(--s3) var(--s4);border-bottom:1px solid var(--border);vertical-align:middle}
th{font-size:var(--fs-s);font-weight:500;color:var(--muted)}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover{background:var(--raised)}
td.numeric,th.numeric{text-align:right;font-variant-numeric:tabular-nums}
.settings-table td,.app-table td{white-space:normal}
.settings-table td select,.settings-table td input{width:auto;min-width:96px}
.settings-table td button[data-setting]{margin-left:var(--s2)}
.settings-table td>.muted,.settings-table td>div{margin-top:var(--s1);font-size:var(--fs-s)}
.small-mono{font:var(--fs-s) var(--font-mono)}
pre.small-mono{white-space:pre-wrap;overflow-wrap:anywhere;margin:var(--s2) 0 0}
.app-id{display:block}
#dnsCandidates h4{margin-top:var(--s3)}
#dnsCandidates .section-note{margin-bottom:var(--s2)}
#dnsCandidates button,#dnsObserved button{height:auto;margin:0 var(--s1) var(--s1) 0;font-size:var(--fs-s)}
#startupRows .purpose{display:none}
.process-name,.app-name button,.component-row button,.member-list button{height:auto;padding:0;border:0;border-radius:0;background:none;text-align:left}
.process-name{font:var(--fs-s) var(--font-mono)}
.process-name:hover,.app-name button:hover,.member-list button:hover{background:none;color:var(--accent)}
.state{font-size:var(--fs-s);color:var(--muted)}
.app-name{display:flex;gap:var(--s3);align-items:center}
.app-name button{min-width:0;font-weight:500}
.app-name small,.component-row button small{display:block;color:var(--muted);font:var(--fs-s)/1.5 var(--font-mono);font-weight:400;overflow:hidden;text-overflow:ellipsis}
.app-name .purpose{display:block;font-size:var(--fs-s);font-weight:400;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.app-name .caret{display:inline-block;width:14px;color:var(--muted)}
.icon{width:36px;height:36px;border-radius:var(--r);background:var(--raised);flex-shrink:0;display:flex;align-items:center;justify-content:center;color:var(--muted);overflow:hidden;position:relative}
.icon img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:var(--raised)}
.disabled-row{color:var(--muted);background:var(--bg)}
.disabled-row .icon,.disabled-row .app-name img{filter:grayscale(1);opacity:.5}
.disabled-row button{color:var(--muted)}
.component-row{background:var(--bg)}
.component-row td:first-child{padding-left:56px}
.component-row button{width:100%;font-weight:500}
.app-table{table-layout:fixed;min-width:640px}
.app-table .app-name button,.app-table .component-row button{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.app-table th:nth-child(1){width:auto}
.app-table th:nth-child(2){width:140px}
.app-table th:nth-child(3){width:128px}
.app-table th:nth-child(4){width:190px}
.app-table th:nth-child(5),.app-table th:nth-child(6){width:84px}
.app-table.no-sample .proc-col{display:none}
.running-note{display:block;font-size:var(--fs-s);color:var(--ok);margin-top:var(--s1)}
.running-note.off{color:var(--muted)}
.startup-flags{font-size:var(--fs-s)}
.mobile-role{display:none}
/* Chips */
.chip,.tag,.state-chip,.role{display:inline-flex;align-items:center;gap:var(--s1);min-height:24px;padding:2px var(--s2);border:1px solid var(--border);border-radius:var(--pill);font-size:var(--fs-s);line-height:1.35;color:var(--muted);max-width:100%;white-space:normal;overflow-wrap:anywhere;vertical-align:middle}
.page-head h1{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s3)}
.page-head h1 .state-chip{font-weight:400}
.state-chip:before{content:"";flex-shrink:0;width:6px;height:6px;border-radius:50%;background:currentColor}
.tag.good,.tag.running,.state-chip.on{color:var(--ok);border-color:var(--ok-line);background:var(--ok-soft)}
.tag.warn,.tag.mixed,.state-chip.partial,.state-chip.warn,.role-tracking{color:var(--warn);border-color:var(--warn-line);background:var(--warn-soft)}
.role-keep{color:var(--accent);border-color:var(--accent-line);background:var(--accent-soft)}
.disabled-row .tag.running{color:var(--ok)}
/* Toolbars, tabs, filters */
.toolbar{display:flex;gap:var(--s2);align-items:center;flex-wrap:wrap;margin-bottom:var(--s4)}
.toolbar input{flex:1 1 220px;max-width:420px}
.segmented{display:flex;flex-wrap:wrap;gap:var(--s1);padding:var(--s1);background:var(--surface);border:1px solid var(--border);border-radius:var(--r);width:max-content;max-width:100%;margin-bottom:var(--s4)}
.segmented button{height:auto;border:0;background:transparent;color:var(--muted)}
.segmented button:hover:not(:disabled){background:var(--raised);color:var(--text)}
.segmented button[aria-pressed=true],.segmented button[aria-pressed=true]:hover{background:var(--accent-soft);color:var(--accent);font-weight:500}
.filter-chips{display:flex;flex-wrap:wrap;gap:var(--s2);margin:0 0 var(--s3)}
.filter-chips button{height:auto;padding:0 var(--s3);border-radius:var(--pill);font-size:var(--fs-s)}
.filter-chips button span{color:var(--muted);margin-left:var(--s1);font-variant-numeric:tabular-nums}
.filter-chips button[aria-pressed=true]{color:var(--accent);background:var(--accent-soft);border-color:var(--accent-line)}
.debloat-intro{max-width:100ch}
.debloat-intro span{display:inline-block;margin-right:var(--s2)}
/* Quick settings and launcher */
.tabs{display:flex;gap:var(--s1);border-bottom:1px solid var(--border);margin-bottom:var(--s5);overflow:auto hidden;scrollbar-width:none}@media (max-width:620px){.tabs{padding-right:32px;-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 32px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 32px),transparent)}}
.tabs button{flex:none;height:auto;padding:var(--s2) var(--s4);border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;color:var(--muted);white-space:nowrap;margin-bottom:-1px}
.tabs button:hover{color:var(--text);background:transparent}
.tabs button[aria-selected=true],.tabs button[aria-selected=true]:hover{color:var(--text);font-weight:500;border-bottom-color:var(--accent)}
.stack{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--s4)}
.stack[hidden],.tabs[hidden]{display:none}
.stack>.panel,.stack>.quick-group{margin:0}
.plugin-frame{width:100%;height:calc(100vh - 220px);height:calc(100dvh - 220px);min-height:360px;border:1px solid var(--border);border-radius:var(--r-surface);background:Canvas}
.quick-item .quick-actions{margin-top:var(--s3)}
.quick-group{padding:var(--s4) var(--s5)}
.quick-group ol.steps{margin:var(--s2) 0 var(--s3);padding-left:var(--s5)}.quick-group ol.steps li{margin:0 0 var(--s2);line-height:1.5}
.quick-group>h2{padding:0}
.quick-group>h2+*{margin-top:var(--s3)}
.quick-group>div>.quick-item:first-child{padding-top:0}
.quick-group>div>.quick-item:last-child{padding-bottom:0}
#quickPanel-general{gap:var(--s5);align-items:start}
#quickPanel-general>.general-wide{grid-column:1/-1}
.removal-steps summary{min-height:44px;padding:var(--s2) 0;cursor:pointer;font-weight:500}
.removal-steps .steps{margin-top:var(--s3)}
.quick-group>.quick-callout{margin:var(--s2) 0}
.fw-steps{margin:var(--s2) 0 0;padding-left:1.4em;display:grid;gap:var(--s1);color:var(--muted);font-size:var(--fs-s);line-height:1.6;max-width:var(--vetro-prose-measure)}
.quick-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--s2) var(--s4);padding:var(--s4) 0}
.quick-item+.quick-item{border-top:1px solid var(--border)}
.quick-group>#quickControl+#quickSdb>.quick-item:first-child{margin-top:var(--s4);padding-top:var(--s4);border-top:1px solid var(--border)}
.quick-sub{padding-left:var(--s5)}
.quick-edge{grid-column:1/-1;display:flex;align-items:center;gap:var(--s3);color:var(--muted)}
.quick-item .notice{margin-top:var(--s2)}
.quick-item p{font-size:var(--fs-s);line-height:1.6;color:var(--muted);margin-top:2px;max-width:60ch;text-wrap:pretty}
.quick-item .switch{margin:0;align-self:start}
.quick-item .switch span{font-size:var(--fs-s);color:var(--muted);min-width:24px}
.quick-state{display:flex;flex-wrap:wrap;gap:var(--s2);align-items:center;margin-top:var(--s2)}
.quick-state:empty{display:none}
.quick-item details{margin-top:var(--s2);font-size:var(--fs-s)}
.quick-item summary,.drawer-about summary{cursor:pointer;color:var(--muted);width:max-content;max-width:100%}
.quick-item summary:hover{color:var(--text)}
.member-list{list-style:none;margin:var(--s2) 0 0;padding:0;display:grid;gap:var(--s1)}
.member-list li>span,.rule>div,.rule>span{min-width:0;overflow-wrap:anywhere}
.member-list li{display:flex;align-items:center;justify-content:space-between;gap:var(--s3)}
.member-list button{font:var(--fs-s) var(--font-mono);color:var(--text);overflow-wrap:anywhere}
.quick-callout,.inline-confirm,.component-confirmation{background:var(--warn-soft);border:1px solid var(--warn-line);border-radius:var(--r);padding:var(--s3) var(--s4);font-size:var(--fs-s);line-height:1.6}
.quick-callout{color:var(--warn)}
.file-pick{display:flex;flex-wrap:wrap;max-width:100%;align-items:center;gap:var(--s2);color:var(--muted);font-size:var(--fs-s)}
.file-pick input[type=file]{font:inherit;color:var(--muted);width:100%;max-width:260px;min-width:0;height:auto;padding:0;border:0;background:transparent}
.file-pick input::file-selector-button{font:inherit;min-height:44px;height:auto;padding:var(--s2) var(--s3);margin-right:var(--s2);border:1px solid var(--vetro-control-border);border-radius:var(--r);background:var(--raised);color:var(--text);cursor:pointer}
.inline-confirm{grid-column:1/-1}
.inline-confirm .primary{background:var(--warn);color:var(--vetro-on-warning);border-color:var(--warn)}
.inline-confirm .primary:hover:not(:disabled){background:var(--warn);color:var(--vetro-on-warning);border-color:var(--vetro-on-warning)}
.inline-confirm p,.component-confirmation p{color:var(--text);max-width:var(--vetro-prose-measure);margin:0 0 var(--s3)}
.component-confirmation{margin:var(--s4) 0}
.quick-actions{display:flex;gap:var(--s2);flex-wrap:wrap;margin-top:var(--s3)}
/* Rules, remote, actions */
.rule{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--s3);padding:var(--s3) 0;border-top:1px solid var(--border)}
.rule button{height:auto}
.rule-locked{color:var(--text)}.rule-locked .rkey{vertical-align:middle;margin-right:var(--s1)}.rule-locked .rkey svg{height:1.75rem}.rule-locked .lock-icon{width:16px;height:16px;vertical-align:-3px;margin-right:var(--s1);fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;color:var(--accent)}
.subtabs{margin-bottom:var(--s4)}.subtabs button{font-size:var(--fs-s)}.ui-lead{margin:0 0 var(--s3);max-width:var(--vetro-prose-measure)}
.ui-rules{margin:var(--s2) 0 0;padding-left:var(--s5);display:grid;gap:var(--s2)}.ui-rules li{font-size:var(--fs-s);line-height:1.55;color:var(--muted);max-width:var(--vetro-prose-measure)}.ui-rules strong{color:var(--text);font-weight:600}
.quick-callout>p{margin:0}.quick-item .quick-callout p{color:inherit}.quick-callout .quick-actions{margin-top:var(--s2)}
.quick-item .field+.quick-callout,.quick-item .field+.quick-actions,.quick-item .quick-actions+.quick-callout,.quick-item .quick-callout+.inline-confirm{margin-top:var(--s3)}
#keyEvent{font-size:var(--fs-xl);font-weight:500;margin:var(--s4) 0 var(--s2)}
.operation-item{padding:var(--s3) 0;border-top:1px solid var(--border);overflow-wrap:anywhere}
.operation-item p{font-size:var(--fs-s);margin-top:var(--s1)}
.operation-item small{color:var(--muted)}
.operation-item[data-state="warning"] strong{color:var(--warn)}
.operation-item[data-state="success"] strong{color:var(--ok)}
#actionToast{position:fixed;bottom:var(--s4);left:calc(var(--side) + (100% - var(--side))/2);transform:translateX(-50%);max-width:min(440px,calc(100% - 32px));padding:var(--s2) var(--s4);border:1px solid var(--border);border-radius:var(--pill);background:var(--raised);color:var(--text);font-size:var(--fs-s);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;z-index:6;animation:toast-in .15s ease-out}
#actionToast.warning{color:var(--warn);border-color:var(--warn-line);background:var(--warn-soft)}
#actionToast.success{border-color:var(--ok-line)}
@keyframes toast-in{from{opacity:0;transform:translate(-50%,6px)}to{opacity:1;transform:translate(-50%,0)}}
#feedback{position:fixed;bottom:var(--s5);left:calc(var(--side) + var(--s5));right:max(var(--s5),var(--safe-right));max-width:640px;padding:var(--s3) var(--s4);background:var(--raised);border:1px solid var(--border);border-radius:var(--r);color:var(--text);z-index:5}
/* Drawer */
.overlay{position:fixed;inset:0;background:var(--overlay);z-index:2}
.drawer{position:fixed;inset:0 0 0 auto;width:min(480px,100%);background:var(--surface);border-left:1px solid var(--border);padding:var(--s5);overflow-y:auto;z-index:3}
.drawer h2{margin:var(--s4) 0 var(--s1);overflow-wrap:anywhere}
.drawer .icon{margin-top:var(--s4)}
.drawer .notice{margin-top:var(--s3)}
.drawer code{display:block;color:var(--muted);overflow-wrap:anywhere}
.drawer-about{margin:var(--s3) 0 0;display:grid;gap:var(--s2)}
.drawer-about>p{max-width:60ch}
.drawer-about details{font-size:var(--fs-s)}
.drawer-state{display:flex;flex-wrap:wrap;gap:var(--s4);margin-top:var(--s4)}
.drawer-state strong{margin-left:var(--s2)}
.drawer-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s3)}
.drawer-command button{width:100%}
.drawer-command p{font-size:var(--fs-s);margin:var(--s2) 0 0}
.component-tools{margin-top:var(--s4);border-top:1px solid var(--border);padding-top:var(--s4)}
.component-tools h3{margin:var(--s4) 0 var(--s2)}
.component-tools .drawer-actions+*,.component-tools>.notice,.component-tools>button{margin-top:var(--s3)}
.drawer details summary{cursor:pointer;font-weight:500}
dl{display:grid;grid-template-columns:112px minmax(0,1fr);gap:var(--s2) var(--s3);font-size:var(--fs-s);padding:var(--s4) 0;border-block:1px solid var(--border);margin:var(--s4) 0}
dt{color:var(--muted)}
dd{margin:0;overflow-wrap:anywhere}
.panel>dl{margin:0;padding:var(--s1) 0;border:0}
.deps{padding:var(--s2) 0;border-bottom:1px solid var(--border);font-size:var(--fs-s)}
.deps small{display:block;color:var(--muted)}
/* Responsive */
.topbar,.scrim,.menu-close{display:none}
.topbar .brand-mini{display:flex;align-items:center;gap:var(--s3);font-size:var(--fs-l)}
.topbar .brand-mini img{width:32px;height:32px;border-radius:22%;display:block}
.menu-btn{display:inline-flex;align-items:center;gap:var(--s2);height:auto;padding:var(--s2) var(--s3)}
.menu-btn svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
@media(max-width:1000px){:root{--side:clamp(232px,14.5rem,296px)}.metric-grid,.form-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.chart-grid,.layout{grid-template-columns:1fr}.main{padding:var(--s5) var(--s4) 64px;padding-right:max(var(--s4),var(--safe-right));padding-bottom:calc(64px + var(--safe-bottom))}.app-table .proc-col{display:none}}
@media(max-width:620px),(max-width:1000px) and (max-height:500px) and (pointer:coarse){
 :root{--side:0px}
 .topbar{display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:3;min-height:56px;padding:var(--s2) var(--s4);padding-top:max(var(--s2),var(--safe-top));padding-right:max(var(--s4),var(--safe-right));padding-left:max(var(--s4),var(--safe-left));background:var(--surface);border-bottom:1px solid var(--border)}
 .sidebar{width:min(300px,86vw);padding:var(--s4) var(--s3);padding-top:max(var(--s4),var(--safe-top));padding-right:max(var(--s3),var(--safe-right));padding-bottom:max(var(--s4),var(--safe-bottom));padding-left:max(var(--s3),var(--safe-left));z-index:5;transform:translateX(-100%);visibility:hidden;transition:transform var(--vetro-duration-normal) var(--vetro-ease),visibility 0s linear var(--vetro-duration-normal)}
 .nav-open .sidebar{transform:none;visibility:visible;transition:transform var(--vetro-duration-normal) var(--vetro-ease),visibility 0s}
 .scrim{display:block;position:fixed;inset:0;z-index:4;background:var(--overlay);opacity:0;pointer-events:none;transition:opacity var(--vetro-duration-normal) var(--vetro-ease)}
 .nav-open .scrim{opacity:1;pointer-events:auto}
 body.nav-open{overflow:hidden}
 .sidebar .brand{display:none}
 .menu-close{display:block;flex-shrink:0;align-self:flex-end;margin-bottom:var(--s3);position:sticky;top:var(--safe-top);z-index:1;background:var(--surface)}
 .sidebar #gaAuth{flex-wrap:wrap;white-space:normal;padding:var(--s3) 0 0}
 .main{margin-left:0;padding:var(--s4) var(--s4) calc(48px + var(--safe-bottom));padding-right:max(var(--s4),var(--safe-right));padding-left:max(var(--s4),var(--safe-left));min-width:0}
 #actionToast{left:50%}
 #feedback{left:max(var(--s4),var(--safe-left));right:max(var(--s4),var(--safe-right))}
}
@media(max-width:620px){.page-head{flex-wrap:wrap;row-gap:0;margin-bottom:var(--s4)}.page-head .actions{width:100%;justify-content:space-between}.page-head .actions>*{margin-top:var(--s3)}.metric-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s2)}.form-grid{grid-template-columns:1fr}.metric{padding:var(--s3)}.tabs,.filter-chips{margin-left:calc(var(--s4)*-1);margin-right:calc(var(--s4)*-1);padding-left:var(--s4);padding-right:var(--s4)}.filter-chips{flex-wrap:nowrap;overflow:auto hidden;scrollbar-width:none}.filter-chips button{flex:none}.toolbar input{flex:1 1 100%;max-width:none;min-width:0;width:100%}.toolbar select{flex:1 1 0;min-width:0}.toolbar button{flex:none}.panel,.box{padding:var(--s4)}.quick-group{padding:var(--s4)}#actionToast{left:50%}.drawer{padding:var(--s4)}.settings-table table{white-space:normal}dl{grid-template-columns:minmax(0,1fr) minmax(0,1.4fr)}.app-table{min-width:0}.app-table th:nth-child(2),.app-table td:nth-child(2),.app-table th:nth-child(4),.app-table td:nth-child(4){display:none}.app-table th:nth-child(3){width:104px}.app-table th,.app-table td{padding:var(--s3) var(--s2)}.app-table .icon{display:none}.app-table .component-row td:first-child{padding-left:var(--s4)}.mobile-role{display:block;margin-top:var(--s2)}}
@media(max-width:400px){.drawer-actions{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
@media(forced-colors:active){.switch input{appearance:auto;-webkit-appearance:auto}.switch input:before{display:none}}
/* Adapt fixed surfaces and touch disclosure without changing the information architecture. */
.sidebar,.drawer{height:100vh;height:100dvh;overscroll-behavior-y:contain}
.drawer{padding-top:max(var(--s5),var(--safe-top));padding-right:max(var(--s5),var(--safe-right));padding-bottom:calc(var(--s5) + var(--safe-bottom));padding-left:max(var(--s5),var(--safe-left))}
#closeDetail{position:sticky;top:var(--safe-top);z-index:1;background:var(--surface)}
#feedback{bottom:calc(var(--s5) + var(--safe-bottom));overflow-wrap:anywhere}
#actionToast{bottom:calc(var(--s4) + var(--safe-bottom));max-width:min(440px,calc(100% - var(--side) - 32px - var(--safe-left) - var(--safe-right)))}
[tabindex="-1"]{scroll-margin-block:var(--scroll-clearance)}
@container(max-width:17rem){.metric-grid{grid-template-columns:minmax(0,1fr)}}
@media(pointer:coarse){.quick-item summary,.drawer summary,.shard-more>summary,.shard-notice>summary{min-height:44px;padding-block:var(--s2)}}
@media(max-width:1000px) and (max-height:500px) and (pointer:coarse){.plugin-frame{min-height:240px}}
@media(max-width:620px){.drawer{padding-top:max(var(--s4),var(--safe-top));padding-right:max(var(--s4),var(--safe-right));padding-bottom:calc(var(--s4) + var(--safe-bottom));padding-left:max(var(--s4),var(--safe-left))}}
/* Vetro's glass belongs at the point of control; working surfaces remain solid. */
.page-head>div:first-child{flex:1 1 320px;min-width:0}
.page-head{flex-wrap:wrap}
.section-title{display:flex;align-items:center;gap:var(--s3)}
.section-icon{width:26px;height:26px;flex:none;fill:none;stroke:var(--accent);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
#quickRemoveTitle .section-icon{stroke:var(--muted)}
.sidebar [data-tab]{transition:background var(--vetro-duration-fast),color var(--vetro-duration-fast)}
.sidebar [data-tab][aria-current=page]{background:var(--vetro-gradient-glass),var(--accent-soft)}
.sidebar [data-tab][aria-current=page] svg{color:var(--accent)}
.primary{background-image:var(--vetro-gradient-glass)}
.primary:hover:not(:disabled){background-image:var(--vetro-gradient-glass)}
.inline-confirm .primary,.inline-confirm .primary:hover:not(:disabled){background-image:none}
button:active:not(:disabled){transform:translateY(1px)}
#keyEvent{display:table;max-width:100%;padding:var(--s3) var(--s4);border:1px solid var(--border);border-radius:var(--r);background:var(--bg);font:500 var(--fs-l)/1.5 var(--font-mono);overflow-wrap:anywhere;transition:background var(--vetro-duration-fast),border-color var(--vetro-duration-fast)}
#keyEvent.has-key{background:var(--accent-soft);border-color:var(--accent);color:var(--accent)}
#actionToast{display:flex;align-items:center;gap:var(--s3);border-radius:var(--r);background:var(--vetro-glass-fill);backdrop-filter:blur(8px);white-space:normal;overflow-wrap:anywhere}
#actionToast.success:before{content:"";width:14px;height:8px;flex:none;border-left:2px solid var(--ok);border-bottom:2px solid var(--ok);transform:rotate(-45deg)}
#actionToast.warning{background:var(--surface)}
#actionToast.warning:before{content:"!";display:grid;place-items:center;flex:none;width:20px;height:20px;border:1px solid currentColor;border-radius:50%;font-weight:500}
@media(max-width:620px){.section-icon{width:24px;height:24px}}
@media(prefers-reduced-motion:reduce){button:active:not(:disabled){transform:none}}
@media(forced-colors:active){.section-icon{stroke:CanvasText}}
/* Launcher preview: the stage mirrors the native launcher (1920x1080 scaled down); its glass colours are the TV's own. */
.lp{--s:.4;position:relative;width:100%;max-width:960px;aspect-ratio:16/9;overflow:hidden;border-radius:var(--r);border:1px solid var(--border);background:linear-gradient(160deg,rgba(var(--accent-rgb),.2),var(--bg) 60%,var(--surface))}
.lp-stage{position:absolute;left:0;top:0;width:1920px;height:1080px;transform:scale(var(--s));transform-origin:0 0;color:#fff;font-family:var(--font-ui)}
.lp-pill{position:absolute;left:50%;bottom:40px;transform:translateX(-50%);max-width:1808px;height:144px;box-sizing:border-box;padding:0 26px;display:flex;align-items:center;border-radius:40px;background:rgba(36,52,72,.9);border:2px solid rgba(255,255,255,.22)}
.lp-row{display:flex;align-items:center;gap:18px;height:112px}
.lp-tile{position:relative;flex:none;overflow:hidden;background:#222;display:flex;align-items:center;justify-content:center;font-size:36px;color:#cfd6e3;box-shadow:inset 0 0 0 1px rgba(255,255,255,.2)}
.lp-tile img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.lp-loose{background:linear-gradient(#2c364f,#141b2a)}
.lp-loose img{inset:14%;width:72%;height:72%;object-fit:contain}
.lp-wide:before{content:"";position:absolute;inset:-14px;background:var(--bg) center/cover;filter:blur(14px)}
.lp-wide img{object-fit:contain}
.lp-oval{background:none;box-shadow:none}
.lp-oval img{object-fit:fill}
.lp-oval.lp-missing{font-size:24px;white-space:nowrap;color:#fff;background:rgba(255,255,255,.12);box-shadow:inset 0 0 0 1px rgba(255,255,255,.22)}
.lp-stack{display:flex;flex-direction:column;gap:8px}
.lp-divider{width:2px;height:72px;background:rgba(255,255,255,.3);margin:0 9px}
.lp-reduced .lp-sel{transform:none}.lp-rise .lp-pill,.lp-rise .lp-hint{animation:lpRise 1.1s cubic-bezier(.2,0,0,1) .3s both}@keyframes lpRise{from{transform:translate(-50%,320px);opacity:0}to{transform:translate(-50%,0);opacity:1}}@media (prefers-reduced-motion:reduce){.lp-rise .lp-pill,.lp-rise .lp-hint{animation:none}}.tshow-slide .lp{max-width:none}.lp-tasks .lp-pill{bottom:86px}.lp-tasks .lp-hint{bottom:240px}.lp-tasks .lp-hint.lp-hint-below{bottom:40px}.dock-left .tuner-shots{margin-top:var(--s4)}.lp-sel{transform:translateY(-4px);box-shadow:inset 0 0 0 1px rgba(255,255,255,.2),0 0 0 2px #e4f2ff,0 0 26px 6px var(--glow,rgba(226,237,255,.44))}
.dock-layout{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--s4);align-items:stretch}.dock-layout>.quick-group{display:grid;align-content:center}#uiOverview .dock-layout>.quick-group,.dock-layout>#tunerBody,#osd .dock-layout>.quick-group{align-content:start}.dock-left{display:grid;gap:var(--s3);align-content:start;align-self:start}.dock-layout>.quick-group>.quick-item:first-child{padding-top:0}.dock-layout>.quick-group>.quick-item:last-child{padding-bottom:0}.dock-left h3{margin:0}.dock-left .section-note{margin:0}.dock-left .lp{max-width:none}.lp-scene{position:absolute;left:0;top:0;width:1920px;height:1080px;background:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080' preserveAspectRatio='xMidYMid slice'><defs><linearGradient id='s' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='%23101c3f'/><stop offset='.45' stop-color='%23553b73'/><stop offset='.72' stop-color='%23d9707a'/><stop offset='1' stop-color='%23f6b26b'/></linearGradient><radialGradient id='g' cx='.5' cy='.5' r='.5'><stop offset='0' stop-color='%23fff2cf' stop-opacity='.95'/><stop offset='.35' stop-color='%23ffc58a' stop-opacity='.5'/><stop offset='1' stop-color='%23ffc58a' stop-opacity='0'/></radialGradient><linearGradient id='w' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='%23f0a26c'/><stop offset='1' stop-color='%231a2547'/></linearGradient></defs><rect width='1920' height='1080' fill='url(%23s)'/><circle cx='1330' cy='640' r='420' fill='url(%23g)'/><circle cx='1330' cy='640' r='64' fill='%23fff0c9'/><path d='M0 690 220 520 420 640 640 470 880 650 1080 560 1290 690 1500 540 1740 660 1920 590V760H0z' fill='%2342375f'/><path d='M0 760 180 640 400 740 640 620 900 760 1160 650 1420 770 1680 670 1920 740V800H0z' fill='%2326274a'/><rect y='780' width='1920' height='300' fill='url(%23w)'/><rect x='1250' y='790' width='160' height='6' rx='3' fill='%23ffe3b3' opacity='.7'/><rect x='1280' y='820' width='100' height='5' rx='2' fill='%23ffe3b3' opacity='.45'/><rect x='1300' y='850' width='60' height='4' rx='2' fill='%23ffe3b3' opacity='.3'/><path d='M0 900 0 1080H1920V920C1700 880 1500 930 1250 900 900 860 600 930 0 900z' fill='%230d1530' opacity='.55'/></svg>") center/cover}.lp-bug{position:absolute;left:64px;top:48px;display:flex;align-items:center;gap:14px;height:56px;padding:0 24px;border-radius:28px;background:rgba(10,14,26,.5);font-size:26px;letter-spacing:.02em;text-shadow:0 2px 6px rgba(0,0,0,.5)}.lp-bug i{width:14px;height:14px;border-radius:50%;background:#ff5a5a}.lp-bug b{font-weight:600}.lp-bug span{opacity:.75}.lp-hint{position:absolute;left:50%;bottom:194px;height:36px;line-height:36px;transform:translateX(-50%);font-size:22px;opacity:.9;text-shadow:0 2px 6px rgba(0,0,0,.6)}.shard-links{display:flex;flex-wrap:wrap;gap:var(--s4)}.shard-links a{display:inline-flex;align-items:center;min-height:var(--vetro-control-height);font-size:var(--fs-s);text-decoration:none}.shard-links a:hover{text-decoration:underline}.shard-notice{margin-top:var(--s1);font-size:var(--fs-s)}.shard-notice>summary{cursor:pointer;color:var(--accent);width:max-content;max-width:100%}.shard-notice>p{margin-top:var(--s2);color:var(--muted);line-height:1.6;max-width:var(--vetro-prose-measure)}.shard-card-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--s2) var(--s3)}.shard-card-head h2{display:flex;align-items:center;gap:var(--s2)}.panel>.shard-card-head+.section-note{margin-top:var(--s1)}#pluginsBody .panel>.shard-list{margin-top:var(--s3)}.shard-list{display:grid;grid-template-columns:minmax(0,1fr);column-gap:var(--s5)}.shard-list>.quick-item{padding:var(--s3) 0;border-top:1px solid var(--border)}.shard-list>.quick-item:last-child{padding-bottom:0}.shard-list .quick-item p{margin:2px 0 0}.shard-list .quick-item .quick-state{margin-top:var(--s2)}.shard-list h3 small{margin-left:var(--s1);color:var(--muted);font-size:var(--fs-s);font-weight:400}.shard-list .quick-actions,.shard-list>.quick-item>.quick-state{margin-top:0}.shard-control{align-self:start}.link-button{min-height:0;padding:0;border:0;border-radius:0;background:none;color:var(--accent);font:inherit;text-decoration:underline;text-underline-offset:.18em}.link-button:hover:not(:disabled){background:none;color:var(--text)}.tab-pair{display:grid;gap:var(--s1);margin:0 0 var(--s3);color:var(--muted);font-size:var(--fs-s);line-height:1.6}.tab-pair p{margin:0}.tab-pair strong{color:var(--text);font-weight:500}.uninstall-app{display:flex;align-items:flex-start;gap:var(--s3);min-width:0}.uninstall-app>div{min-width:0}.uninstall-app h3 small{margin-left:var(--s1);color:var(--muted);font-size:var(--fs-s);font-weight:400}#quickUninstall .uninstall-list{align-items:start}#quickUninstall .quick-item>button{align-self:start}.uninstall-busy{align-self:center;color:var(--muted);font-size:var(--fs-s)}.shard-row-actions{display:flex;flex-wrap:wrap;align-items:center;gap:0 var(--s2);margin-top:var(--s2)}.shard-row-actions>.text-button,.shard-card-head .text-button{margin-block:calc(var(--s3)*-1)}.text-button{min-height:var(--vetro-control-height);padding:0 var(--s2);border:0;background:transparent;color:var(--accent);font-size:var(--fs-s)}.text-button:hover:not(:disabled){background:transparent;text-decoration:underline}#plugins .shard-row-actions>.text-button:first-child{margin-left:calc(var(--s2)*-1)}.shard-card-head .text-button{margin-left:0;margin-right:calc(var(--s2)*-1)}.alert-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--s2) var(--s4);padding:var(--s2) var(--s2) var(--s2) var(--s4);border:1px solid var(--warn-line);border-radius:var(--r);background:var(--warn-soft);color:var(--warn);font-size:var(--fs-s);line-height:1.6}.alert-row>p{flex:1 1 auto;min-width:0;max-width:var(--vetro-prose-measure);margin:0}.alert-row>button:not(.primary){border-color:var(--warn-line);background:transparent;color:var(--warn)}.alert-row>button:not(.primary):hover:not(:disabled){background:var(--warn-soft)}.quick-item p.row-error{color:var(--warn)}.shard-more>summary{cursor:pointer;width:max-content;max-width:100%;color:var(--muted);font-size:var(--fs-s)}.shard-more>summary:hover{color:var(--text)}.shard-more>.panel{margin-top:var(--s2)}.shard-more .panel>.quick-item:first-child{padding-top:0}.shard-more .file-pick{padding-top:var(--s3);border-top:1px solid var(--border)}@supports(grid-template-columns:repeat(auto-fit,minmax(min(100%,26rem),1fr))){.shard-list{grid-template-columns:repeat(auto-fit,minmax(min(100%,calc(var(--vetro-column-min) + var(--vetro-space-12))),1fr))}}
@supports(grid-template-columns:repeat(auto-fit,minmax(min(100%,26rem),1fr))){#quickPanel-general,.dock-layout{grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--vetro-column-min)),1fr))}}

/* Settings and controls: the tab row sits above the section buttons */
#settingsGroups{margin-bottom:var(--s3)}
.diag-body .notice{max-width:72ch}
/* About Vetro */
.about{width:min(580px,calc(100% - 2*var(--s4)));max-height:calc(100vh - 2*var(--s5));padding:0;border:1px solid var(--border);border-radius:16px;background:var(--surface);color:var(--text);overflow:auto}
.about::backdrop{background:var(--overlay)}
.about-body{padding:var(--s5);display:grid;gap:var(--s4)}
.about-top{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--s3)}
.about-brand{display:flex;align-items:center;gap:var(--s3)}.about-brand img{width:44px;height:44px;border-radius:22%}
.about-brand h2{margin:0;font-size:var(--fs-xl);font-weight:500}.about-brand small{display:block;color:var(--muted)}
.about-lead{margin:0;color:var(--muted);line-height:1.5}.about-lead strong{color:var(--text);font-weight:500}
.about-maker{display:flex;align-items:center;gap:var(--s4);padding:var(--s4);border:1px solid var(--border);border-radius:12px;background:var(--raised)}
.about-photo{width:88px;height:88px;border-radius:50%;object-fit:cover;flex-shrink:0;border:1px solid var(--border)}
.about-maker h3{margin:0 0 var(--s1);font-size:var(--fs-l)}.about-maker p{margin:0;color:var(--muted);line-height:1.45}
.about-list{margin:0;padding:0;list-style:none;display:grid;gap:var(--s3)}.about-list li{display:grid;gap:2px;line-height:1.45}.about-list strong{font-weight:500}.about-list span{color:var(--muted)}
.about-links{display:flex;flex-wrap:wrap;gap:var(--s2)}
.about-links a{display:inline-flex;align-items:center;justify-content:center;min-height:var(--vetro-control-height);padding:0 var(--s4);border:1px solid var(--border);border-radius:var(--r);background:var(--raised);color:var(--text);text-decoration:none}
.about-links a:hover{background:var(--border)}.about-links a.primary{background:var(--vetro-action);border-color:var(--vetro-action)}.about-links a.primary:hover{background:var(--vetro-action-hover)}
.about-fine{margin:0;color:var(--muted);font-size:var(--fs-s);line-height:1.5}.about-fine a{color:var(--accent)}
@media(max-width:620px){.about-maker{flex-direction:column;align-items:flex-start}}
/* Density. A setting row is tighter; a group of settings that is wide enough runs in two columns (one where min() is missing);
   the previews sit beside their settings, with the notes in the shorter column. */
.quick-item{padding:var(--s3) 0}
.quick-group>.quick-item:first-child{padding-top:0;border-top:0}
.quick-group>.quick-item:last-child{padding-bottom:0}
.quick-group>.section-title+.section-note,.quick-group>h2+.section-note{margin-top:var(--s1)}
#dockBody .dock-layout>.quick-group{align-content:start}
#dockCards>*+*{margin-top:var(--s4)}
.ui-side{align-content:start}
.ui-parts{display:grid;gap:var(--s4);align-content:start}.ui-parts>.quick-group{margin:0}
.ui-side>.quick-group{margin:0}
@supports(grid-template-columns:repeat(auto-fit,minmax(min(100%,26rem),1fr))){
 .quick-group{display:grid;align-content:start;grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--vetro-column-min)),1fr));column-gap:var(--s5)}
 .quick-group>:not(.quick-item),.quick-group>.quick-item:only-of-type{grid-column:1/-1}
 #quickPanel-developer{grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--vetro-column-min)),1fr))}
 #quickMemory,#quickApps,#quickUninstall>.uninstall-list,#quickTracking,#quickVoice{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--vetro-column-min)),1fr));column-gap:var(--s5)}
 #quickMemory>.quick-item,#quickApps>.quick-item,#quickUninstall .uninstall-list>.quick-item,#quickTracking>.quick-item,#quickVoice>.quick-item{border-top:1px solid var(--border);padding-top:var(--s3)}
 #quickMemory>.quick-item:last-child,#quickApps>.quick-item:last-child,#quickUninstall .uninstall-list>.quick-item:last-child,#quickTracking>.quick-item:last-child,#quickVoice>.quick-item:last-child{padding-bottom:var(--s3)}
 #dnsCandidates{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--vetro-column-min)),1fr));column-gap:var(--s5);max-width:none}
 .quick-group>h2{margin-bottom:var(--s3)}.quick-group>h2+*{margin-top:0}.quick-group>h2+.section-note{margin-top:calc(var(--s1) - var(--s3))}
 .quick-group>.quick-item+.quick-item,.quick-group>.section-note+.quick-item,.quick-group>h2+.quick-item{border-top:1px solid var(--border)}
}
#uiOverview,#osd{container-type:inline-size}
@container (min-width:53rem){
 .ui-overview{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
 .ui-overview>.dock-left{grid-column:1;grid-row:1}.ui-overview>#uiParts{grid-column:2;grid-row:1/span 2}.ui-overview>#uiRel{grid-column:1;grid-row:2}
 .ui-osd{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
 .ui-osd>.dock-left{grid-column:1;grid-row:1/span 2}.ui-osd>#osdParts{grid-column:2;grid-row:1}.ui-osd>#osdNeeds{grid-column:2;grid-row:2}
}
${tunerPage.css}</style></head><body>
<header class="topbar"><span class="brand-mini"><img src="/icon.png" alt="" width="32" height="32">vetro</span><button type="button" id="menuBtn" class="menu-btn" aria-expanded="false" aria-controls="sidebar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>Menu</button></header><div class="scrim" id="scrim"></div>
<aside class="sidebar" id="sidebar"><div class="brand"><img src="/icon.png" alt="" width="44" height="44"><span>vetro<small id="connection">Checking…</small></span></div><button type="button" id="closeMenu" class="menu-close">Close menu ×</button><nav aria-label="Main"><button data-tab="quick" aria-current="page"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>Quick settings</button><button data-tab="vetroui" aria-current="false" title="Vetro UI · Launcher, live TV, on-screen displays"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><rect x="6.5" y="11.5" width="11" height="2.5" rx="1.25"/><path d="M8 20h8M12 16v4"/></svg>Vetro UI<span class="chip nav-count">Preview</span></button><button data-tab="plugins" aria-current="false" title="Vetro Shards · Plugin system"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h9l-4 7-6-2 1-5ZM16 3h5v15l-9-7 4-8ZM3 12l6 3 8 6H3v-9Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>Vetro Shards</button><button data-tab="remote" aria-current="false"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="3"/><circle cx="12" cy="8" r="2"/><path d="M10 15h4M10 18h4"/></svg>Remapper</button></nav><div class="nav-label">TV</div><nav aria-label="TV"><button data-tab="apps" aria-current="false"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>Apps and processes</button><button data-tab="dashboard" aria-current="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 18a8.5 8.5 0 1 1 15 0"/><path d="m12 14 4-5"/><circle cx="12" cy="14" r="1.2"/></svg>Resource monitor</button><button data-tab="tvsettings" aria-current="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="9" cy="18" r="2"/></svg>Settings and controls</button></nav><div class="nav-label">Connections</div><nav aria-label="Connections"><button data-tab="dns" aria-current="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/></svg>DNS blocking</button><button data-tab="mqtt" aria-current="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M9.5 15.5c1.3-1.6 3.7-1.6 5 0M7.5 13c2.5-2.6 6.5-2.6 9 0"/><circle cx="12" cy="17.6" r=".8"/></svg>Home Assistant</button></nav><div class="side-low"><button type="button" data-tab="actions" class="quiet" aria-current="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.8v4.7h4.7M12 7.5V12l3 2"/></svg>Session history<span id="actionsCount" class="chip nav-count" hidden></span></button><button type="button" id="aboutBtn" class="about-btn" aria-haspopup="dialog"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.01"/></svg>About Vetro</button></div><footer><span id="appVersion"></span></footer></aside>
<main class="main"><div class="page"><header class="page-head"><div><h1 id="pageHeading" tabindex="-1"><span id="pageTitle">Quick settings</span><span id="pageTag" class="state-chip" hidden>Experimental · some parts may not work on your TV</span></h1><p id="pageSubtitle">Privacy, background services and maintenance.</p><details id="shardNotice" class="shard-notice" data-plugin-warning hidden><summary>Full notice</summary><p id="shardNoticeText"></p></details></div><div class="actions"><span id="shardLinks" class="shard-links" hidden><a href="https://github.com/andrearicci93/vetro-plugins" target="_blank" rel="noopener noreferrer">Repository ↗</a><a href="https://github.com/andrearicci93/vetro/blob/main/app/docs/plugins.md" target="_blank" rel="noopener noreferrer">Guide ↗</a></span><span id="sampleStatus" class="live" hidden>Live updates off</span><button id="liveToggle" hidden>Start live · 2 min</button></div></header>
<div id="debloatModes" class="segmented" role="group" aria-label="Apps and processes views" hidden><button data-mode="apps" aria-pressed="true">Apps</button><button data-mode="processes" aria-pressed="false">Processes</button><button data-mode="startup" aria-pressed="false">Startup</button></div>
<section id="quick"><div id="factoryTestBanner" class="inline-confirm" role="status" hidden></div><div id="quickTabs" class="tabs" role="tablist" aria-label="Quick settings"><button type="button" role="tab" id="qtab-general" data-quick-tab="general" aria-controls="quickPanel-general" aria-selected="true" tabindex="0">General</button><button type="button" role="tab" id="qtab-privacy" data-quick-tab="privacy" aria-controls="quickPanel-privacy" aria-selected="false" tabindex="-1">Privacy and ads</button><button type="button" role="tab" id="qtab-voice" data-quick-tab="voice" aria-controls="quickPanel-voice" aria-selected="false" tabindex="-1">Voice</button><button type="button" role="tab" id="qtab-memory" data-quick-tab="memory" aria-controls="quickPanel-memory" aria-selected="false" tabindex="-1">Disable</button><button type="button" role="tab" id="qtab-uninstall" data-quick-tab="uninstall" aria-controls="quickPanel-uninstall" aria-selected="false" tabindex="-1">Uninstall</button><button type="button" role="tab" id="qtab-developer" data-quick-tab="developer" aria-controls="quickPanel-developer" aria-selected="false" tabindex="-1">Developer settings</button></div>
<div id="quickPanel-general" class="stack" role="tabpanel" aria-labelledby="qtab-general"><div class="panel"><h2 class="section-title">${sectionIcon('update')}Software update</h2><p id="updateVersion" class="notice">Reading…</p><p class="notice">Signed updates from GitHub. Vetro restores the previous version if an update fails to start.</p><div class="row"><button id="checkUpdate" disabled>Check for update</button><button id="applyUpdate" class="primary" hidden>Update</button><button id="rollbackUpdate" hidden>Go back to the previous version</button></div><p id="updateStatus" class="notice" role="status" aria-live="polite"></p></div><section class="quick-group" aria-labelledby="quickStorageTitle"><h2 class="section-title" id="quickStorageTitle">${sectionIcon('storage')}Storage</h2><div id="quickStorage"><p class="section-note">Reading the TV…</p></div></section><section class="quick-group general-wide" aria-labelledby="quickControlTitle"><h2 class="section-title" id="quickControlTitle">${sectionIcon('firmware')}Essential settings</h2><div id="quickControl"><p class="section-note">Reading the TV…</p></div><div id="quickSdb"></div></section><section class="quick-group general-wide" aria-labelledby="quickRestoreTitle"><h2 class="section-title" id="quickRestoreTitle">${sectionIcon('restore')}Restore the TV</h2><div id="quickRestore"></div></section><section class="quick-group general-wide" aria-labelledby="quickRemoveTitle"><h2 class="section-title" id="quickRemoveTitle">${sectionIcon('remove')}Remove Vetro</h2><div id="quickRemove"></div></section></div>
<div id="quickPanel-privacy" class="stack" role="tabpanel" aria-labelledby="qtab-privacy" hidden><section class="quick-group" aria-labelledby="quickTrackingTitle"><h2 class="section-title" id="quickTrackingTitle">${sectionIcon('privacy')}Advertising and tracking</h2><div id="quickTracking"></div></section></div>
<div id="quickPanel-voice" class="stack" role="tabpanel" aria-labelledby="qtab-voice" hidden><section class="quick-group" aria-labelledby="quickVoiceTitle"><h2 class="section-title" id="quickVoiceTitle">${sectionIcon('voice')}Voice assistants</h2><p class="quick-callout">Disabling one also turns off the remote’s microphone button and voice control.</p><div id="quickVoice"></div></section></div>
<div id="quickPanel-memory" class="stack" role="tabpanel" aria-labelledby="qtab-memory" hidden><section class="quick-group" aria-labelledby="quickMemoryTitle"><h2 class="section-title" id="quickMemoryTitle">${sectionIcon('disable')}Disable what you don’t use</h2><p class="section-note">Each switch stops something that starts by itself.</p><div id="quickMemory"><p class="section-note">Reading the TV…</p></div></section><section id="quickAppsGroup" class="quick-group" aria-labelledby="quickAppsTitle" hidden><h2 class="section-title" id="quickAppsTitle">${sectionIcon('disable')}Apps you don’t use</h2><p class="section-note">A disabled app cannot start, from its tile or its button on the remote.</p>${quickPair('memory')}<div id="quickApps"></div></section></div>
<div id="quickPanel-uninstall" class="stack" role="tabpanel" aria-labelledby="qtab-uninstall" hidden><section class="quick-group" aria-labelledby="quickUninstallTitle"><h2 class="section-title" id="quickUninstallTitle">${sectionIcon('remove')}Uninstall apps that came with the TV</h2><p class="section-note">Deletes the app and frees its space. To get it back, install it again from Samsung’s Apps, where it is offered.</p>${quickPair('uninstall')}<div id="quickUninstall"><p class="section-note">Reading the TV…</p></div></section><section class="quick-group" aria-labelledby="quickKeepTitle"><h2 class="section-title" id="quickKeepTitle">${sectionIcon('disable')}Removed apps</h2><div id="quickKeep"><p class="section-note">Reading the TV…</p></div></section></div>
<div id="quickPanel-developer" class="stack" role="tabpanel" aria-labelledby="qtab-developer" hidden><section class="quick-group" aria-labelledby="quickPairingTitle"><h2 class="section-title" id="quickPairingTitle">${sectionIcon('access')}Pairing</h2><div id="quickPairing"></div></section><section class="quick-group" aria-labelledby="quickNoticeTitle"><h2 class="section-title" id="quickNoticeTitle">${sectionIcon('update')}Update notices</h2><p class="notice">This browser checks GitHub for Vetro and Shard updates on opening and every six hours. You install updates manually.</p><label class="switch"><input type="checkbox" role="switch" id="autoUpdateCheck"><span>Look for updates when this page opens</span></label><p id="autoUpdateNote" class="notice" role="status" aria-live="polite"></p></section><section class="quick-group" aria-labelledby="quickDiagTitle"><h2 class="section-title" id="quickDiagTitle">${sectionIcon('update')}Diagnostic report</h2><div class="diag-body"><p class="notice">A JSON file with the TV model, firmware, packages, startup flags, processes and resource use.</p><p class="notice">No passwords, network addresses, device ids, MQTT messages, raw logs or viewing history. App names are in it: review it before sharing.</p><label class="switch"><input type="checkbox" role="switch" id="diagComponents"><span>Include unrecognised components</span></label><p class="notice">Adds their description, permissions and startup details, without paths, addresses or file contents. Up to a minute on a slow TV.</p><div class="row"><button id="downloadDiagnostics" class="primary">Download report</button></div><p id="diagnosticStatus" class="notice" role="status" aria-live="polite">Nothing is uploaded.</p></div></section></div></section>
<section id="dashboard" hidden><div class="metric-grid">
<div class="metric"><div class="label">CPU</div><div id="cpuValue" class="value">—</div><small id="cpuMeta">Start live updates to sample the TV</small></div>
<div class="metric"><div class="label">Available RAM</div><div id="ramValue" class="value">—</div><small id="ramMeta">—</small></div>
<div class="metric"><div class="label">Free storage</div><div id="diskValue" class="value">—</div><small id="diskMeta">App partition</small></div>
<div class="metric"><div class="label">Network · down / up</div><div id="networkValue" class="value long">—</div><small id="networkMeta">—</small></div></div>
<div class="chart-grid charts"><div class="panel"><div class="panel-head"><h2>CPU usage</h2><small>%</small></div><div id="cpuChart"></div><div class="chart-label"><span>Last 100 samples</span><span>Now</span></div></div><div class="panel"><div class="panel-head"><h2>Available RAM</h2><small>MiB</small></div><div id="ramChart"></div><div class="chart-label"><span>Last 100 samples</span><span>Now</span></div></div></div>
<div class="chart-grid"><div class="panel"><div class="panel-head"><h2>CPU by core</h2><small id="uptime">—</small></div><div id="cores"></div><div class="table-note"><span id="loadValue">Load: —</span><span id="temperature">Temperature unavailable</span></div></div><div class="panel"><div class="panel-head"><h2>Compressed memory</h2><small>Zram</small></div><dl class="plain"><dt>Logical data</dt><dd id="zramLogical">—</dd><dt>RAM used</dt><dd id="zramPhysical">—</dd><dt>Available swap</dt><dd id="swapFree">—</dd></dl><p class="notice">Logical size is larger than the RAM it occupies.</p></div></div>
<div class="panel"><div class="panel-head"><h2>Processes</h2><button data-open="processes">Apps and processes →</button></div><div id="topProcesses" role="region" aria-label="Top processes" tabindex="-1"></div></div></section>
<section id="processes" hidden><div class="toolbar"><input id="processSearch" type="search" aria-label="Search processes" placeholder="Search process or PID…"><select id="processKind" aria-label="Process type"><option value="all">All processes</option><option value="user">User space</option><option value="kernel">Kernel threads</option></select><select id="processSort" aria-label="Sort processes"><option value="cpu">CPU ↓</option><option value="memory">Memory ↓</option><option value="pid">PID ↑</option><option value="name">Name A–Z</option></select></div><div class="table-wrap"><table><thead><tr><th>Process</th><th class="numeric">PID</th><th class="numeric">CPU</th><th class="numeric">RSS memory</th><th>State</th><th class="numeric">Threads</th></tr></thead><tbody id="processRows"></tbody></table></div><div class="table-note"><span id="processCount">—</span><span>Select a process for details · 100% CPU = one core · RSS includes shared RAM</span></div></section>
<section id="apps" hidden><p class="section-note debloat-intro"><span><strong>Tracking</strong> collects viewing or ad data.</span> <span><strong>Optional</strong> is a feature you may not use.</span> <span><strong>Keep</strong> is needed by the TV.</span> <span>Disabling keeps the app installed. Uninstalling requires a reinstall to restore it.</span></p><div id="roleFilters" class="filter-chips" role="group" aria-label="Filter by role"></div><p id="impactResult" class="section-note" aria-live="polite"></p><div class="toolbar"><input id="search" type="search" placeholder="Search apps" aria-label="Search apps"><select id="category" aria-label="Area"><option value="all">All areas</option><option value="tracking">Advertising and tracking</option><option value="voice">Voice assistants</option><option value="tv">TV and channels</option><option value="home">Home and menus</option><option value="media">Apps and media</option><option value="ambient">Ambient and art</option><option value="sharing">Multi View and mirroring</option><option value="devices">Bluetooth and devices</option><option value="samsung">Samsung account and SmartThings</option><option value="support">Diagnostics and support</option><option value="commercial">Hotel, shop and factory</option><option value="system">System services</option></select><select id="appStatus" aria-label="App state"><option value="all">All states</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option><option value="running">Running</option><option value="stopped">Not running</option><option value="visible">Menu-visible</option><option value="unknown">Unknown app state</option></select><button id="refresh">Refresh</button></div><div class="table-wrap"><table id="appTable" class="app-table no-sample"><thead><tr><th>App</th><th>Role</th><th>State</th><th>Startup</th><th class="numeric proc-col">CPU</th><th class="numeric proc-col">RAM</th></tr></thead><tbody id="appGrid"></tbody></table><p id="empty" hidden class="empty">No matching apps.</p></div><div class="table-note"><span id="inventorySource">—</span><span id="appCount">—</span></div></section>
<section id="startup" hidden><div class="segmented" role="group" aria-label="Startup views"><button data-startup="apps" aria-pressed="true">App flags</button><button data-startup="services" aria-pressed="false">System services</button></div><div class="toolbar"><input id="startupSearch" type="search" placeholder="Search app or service…" aria-label="Search startup entries"><select id="startupFilter" aria-label="Filter startup entries"><option value="flagged">Can start: flag set, app enabled</option><option value="flags">Flag set, including disabled apps</option><option value="all">All</option></select><button id="refreshStartup">Refresh</button></div><div id="startupApps"><p class="section-note">Disabled apps keep their startup settings. Other components can start enabled apps even with both settings off.</p><div class="table-wrap"><table><thead><tr><th>App</th><th>On boot</th><th>Auto restart</th><th>App state</th></tr></thead><tbody id="startupRows"></tbody></table></div><p class="section-note">Select an app to change its flags.</p></div><div id="startupServices" hidden><div class="table-wrap"><table><thead><tr><th>Service</th><th>Startup</th><th>Current state</th><th>Substate</th></tr></thead><tbody id="serviceRows"></tbody></table></div><p id="serviceNote" class="section-note">System services · read-only</p></div></section>
<section id="mqtt" hidden><div class="panel"><h2>Home Assistant connection</h2><p class="notice">Use a broker such as Mosquitto. The TV shows up in Home Assistant with its sensors and controls.</p><label class="switch"><input id="mqttEnabled" type="checkbox" role="switch"><span>Connect to Home Assistant (MQTT)</span></label><div class="form-grid"><label class="field"><span>Broker host / IP</span><input id="mqttHost" autocomplete="off" placeholder="MQTT broker address"></label><label class="field"><span>Port</span><input id="mqttPort" type="number" min="1" max="65535" value="1883"></label><label class="field"><span>Username</span><input id="mqttUser" autocomplete="off"></label><label class="field"><span>Password</span><input id="mqttPassword" type="password" autocomplete="new-password" placeholder="Blank keeps the saved one"></label></div><label class="switch"><input id="mqttClearPassword" type="checkbox" role="switch"><span>Remove saved password</span></label><label class="switch"><input id="mqttTls" type="checkbox" role="switch"><span>TLS · verify the broker certificate</span></label><label id="mqttCaField" class="field" hidden><span>Custom CA certificate (optional, PEM)</span><textarea id="mqttCa" rows="3"></textarea></label><div class="row"><label class="field"><span>Topic prefix</span><input id="mqttPrefix" value="vetro"></label><label class="field"><span>Device name</span><input id="mqttDevice" value="Vetro"></label></div><div class="row"><button id="saveMqtt" class="primary">Save configuration</button></div><p id="mqttCredential" class="notice"></p></div><div class="panel"><h2>Connection</h2><p id="mqttState" aria-live="polite">Reading state…</p><p id="mqttStats" class="notice"></p><div id="mqttSubscriptions"></div><div id="mqttLog" class="notice"></div><p class="notice">Counts show messages sent. The log excludes message contents and passwords.</p></div><div class="panel"><h2>Rules</h2><p class="notice">A trigger opens an app, sends a key or publishes a message. Topics match exactly. Retained messages cannot trigger rules. Rules cannot publish to trigger topics.</p><div class="row"><label class="field"><span>Trigger type</span><select id="mqttTriggerType"><option value="mqtt">MQTT message</option><option value="physical">Physical key</option><option value="http">HTTP trigger</option></select></label><label class="field"><span>Trigger topic / key code / HTTP name</span><input id="mqttTrigger" placeholder="vetro/command/open"></label><label class="field"><span>Required payload (MQTT only; blank = any)</span><input id="mqttMatch"></label></div><div class="row"><label class="field"><span>Action</span><select id="mqttActionType"><option value="launch">Open app</option><option value="key">Send key</option><option value="mqtt">Publish MQTT message</option></select></label><label class="field" id="mqttAppField"><span>App</span><select id="mqttTarget"></select></label><label class="field" id="mqttKeyField" hidden><span>Key</span><select id="mqttKey">${keyOptions()}</select></label><label class="field" id="mqttPublishFields" hidden><span>Destination topic</span><input id="mqttOutput"></label><label class="field" id="mqttPayloadField" hidden><span>Message</span><input id="mqttPayload" maxlength="256"></label></div><div class="row"><button id="saveMqttRule">Add rule</button></div><div id="mqttRules"></div></div></section>
<section id="actions" hidden><div id="operationLog" class="panel operation-log"><h2 id="operationSummary" tabindex="-1">History · this session</h2><p id="operationEmpty" class="empty">No changes in this session.</p><div id="operationItems" role="status" aria-live="polite" aria-atomic="true"></div><p class="notice">Shows up to 10 changes until you reload.</p></div></section>

<section id="tvsettings" hidden><div id="settingsGroups" class="tabs" role="tablist" aria-label="Settings and controls"><button type="button" role="tab" data-settings-group="sound" aria-selected="true" tabindex="0">Picture and sound</button><button type="button" role="tab" data-settings-group="network" aria-selected="false" tabindex="-1">Network and inputs</button><button type="button" role="tab" data-settings-group="privacy" aria-selected="false" tabindex="-1">Privacy</button><button type="button" role="tab" data-settings-group="device" aria-selected="false" tabindex="-1">Device</button><button type="button" role="tab" data-settings-group="keys" aria-selected="false" tabindex="-1">Remote keys</button></div><div id="settingsBody"><div class="segmented" id="settingsModes" role="group" aria-label="Settings sections"><button data-settings-mode="picture" aria-pressed="true">Picture</button><button data-settings-mode="audio" aria-pressed="false">Audio</button><button data-settings-mode="network" aria-pressed="false" hidden>Network</button><button data-settings-mode="sources" aria-pressed="false" hidden>Inputs</button><button data-settings-mode="privacy" aria-pressed="false" hidden>Privacy and HbbTV</button><button data-settings-mode="device" aria-pressed="false" hidden>Information</button><button data-settings-mode="advanced" aria-pressed="false" hidden>Advanced</button><button data-settings-mode="catalog" aria-pressed="false" hidden>TV catalog</button></div><div class="toolbar"><input id="settingSearch" type="search" aria-label="Search settings" placeholder="Search settings…"><button id="refreshSettings">Refresh values</button></div><p id="settingStatus" class="section-note" aria-live="polite">Reading from TV…</p><div id="settingGroups"></div></div><div id="settingsKeys" role="tabpanel" hidden><div class="box"><h2>Remote keys</h2><p class="notice">Send remote keys to the TV.</p><div class="row"><button onclick="k('XF86Home')">Home</button><button onclick="k('XF86Back')">Back</button><button onclick="k('XF86AudioRaiseVolume')">Volume +</button><button onclick="k('XF86AudioLowerVolume')">Volume −</button><button onclick="k('XF86AudioMute')">Mute</button><button aria-label="Send Up key" onclick="k('Up')">↑</button><button aria-label="Send Down key" onclick="k('Down')">↓</button><button aria-label="Send Left key" onclick="k('Left')">←</button><button aria-label="Send Right key" onclick="k('Right')">→</button><button onclick="k('Return')">OK</button><button onclick="k('XF86PowerOff')">Power</button></div></div></div></section>
<section id="dns" hidden><div class="panel"><p id="dnsStatus" class="notice">Reading state…</p><p id="dnsResolvers" class="notice"></p><label class="switch"><input id="dnsEnabled" type="checkbox" role="switch"><span>Block the saved domains on the TV</span></label><p class="notice">One domain per line. Add subdomains separately. Some apps can bypass blocking.</p><textarea id="dnsDomains" rows="8" aria-label="Domains to block"></textarea><div class="row"><button id="saveDns" class="primary">Save domains</button><button id="observeDns">Observe requests · 6 seconds</button></div><h3>Observed requests</h3><div id="dnsObserved" class="notice">Use an app while observing, then add the domains you want.</div><h3>Candidate domains</h3><div id="dnsCandidates" class="notice"></div><p class="notice">Candidates start unselected. The TV’s internet-check and clock domains cannot be added. Blocking resumes when Vetro starts.</p></div></section>

<section id="plugins" hidden><div id="pluginTabs" class="tabs" role="tablist" aria-label="Vetro Shards" hidden></div><div id="pluginsBody" class="stack" role="tabpanel" aria-labelledby="ptab-manage"><div class="panel"><p class="notice">Reading…</p></div></div><div id="pluginPage" role="tabpanel" hidden><iframe id="pluginFrame" class="plugin-frame" title="Vetro Shard page" sandbox="allow-scripts"></iframe></div></section>
<section id="vetroui" hidden>${tunerPage.defs}<div id="uiTabs" class="tabs" role="tablist" aria-label="Vetro UI"><button type="button" role="tab" id="utab-overview" data-ui-tab="overview" aria-controls="uiPanel-overview" aria-selected="true" tabindex="0">Overview</button><button type="button" role="tab" id="utab-launcher" data-ui-tab="launcher" aria-controls="uiPanel-launcher" aria-selected="false" tabindex="-1">Launcher</button><button type="button" role="tab" id="utab-tuner" data-ui-tab="tuner" aria-controls="uiPanel-tuner" aria-selected="false" tabindex="-1">Live TV</button><button type="button" role="tab" id="utab-osd" data-ui-tab="osd" aria-controls="uiPanel-osd" aria-selected="false" tabindex="-1">On-screen displays</button></div><div id="uiPanel-overview" role="tabpanel" aria-labelledby="utab-overview"><div id="uiOverview" class="stack"><div class="panel"><p class="notice">Reading…</p></div></div></div><div id="uiPanel-launcher" role="tabpanel" aria-labelledby="utab-launcher" hidden><div id="dock"><div id="dockTabs" class="tabs subtabs" role="tablist" aria-label="Launcher"><button type="button" role="tab" id="dtab-vetro" data-dock-tab="vetro" aria-controls="dockBody" aria-selected="true" tabindex="0">Vetro launcher</button><button type="button" role="tab" id="dtab-cards" data-dock-tab="cards" aria-controls="dockCards" aria-selected="false" tabindex="-1">Control center</button><button type="button" role="tab" id="dtab-custom" data-dock-tab="custom" aria-controls="dockCustom" aria-selected="false" tabindex="-1">Custom launcher</button></div><div id="dockBody" role="tabpanel" aria-labelledby="dtab-vetro"><div class="panel"><p class="notice">Reading…</p></div></div><div id="dockCards" role="tabpanel" aria-labelledby="dtab-cards" hidden><div class="panel"><p class="notice">Reading…</p></div></div><div id="dockCustom" role="tabpanel" aria-labelledby="dtab-custom" hidden><div class="panel"><p class="notice">Reading…</p></div></div></div></div><div id="uiPanel-tuner" role="tabpanel" aria-labelledby="utab-tuner" hidden><div id="tuner" class="stack"><div class="dock-layout"><div class="dock-left panel"><h3>Preview</h3><p class="section-note">Sample channels.</p><div id="tunerShow"></div></div><div class="stack ui-side"><div id="tunerBody" class="quick-group"><p class="notice">Reading…</p></div><section class="quick-group tuner-static" aria-labelledby="tunerKeysTitle"><h2 class="section-title" id="tunerKeysTitle">${sectionIcon('keys')}Remote buttons</h2>${tunerPage.keysMarkup()}</section></div></div></div></div><div id="uiPanel-osd" role="tabpanel" aria-labelledby="utab-osd" hidden><div id="osd" class="stack"><div class="panel"><p class="notice">Reading…</p></div></div></div></section>
<section id="remote" hidden><div class="layout"><div class="box"><h2>Step 1 · Listen to the remote</h2><p class="notice">Select a device, start listening and press a key. Keys keep working normally. Listening stops after 2 minutes.</p><label class="field"><span>Physical device</span><select id="device"><option value="">Loading…</option></select></label><div class="row"><button id="observe" class="primary">Start listening</button></div><div id="keyEvent" role="status" aria-live="polite">No key captured</div><p id="inputStatus" class="muted" aria-live="polite">Interception off</p></div>
<div class="box"><h2>Step 2 · Create a shortcut</h2><label class="field"><span>Captured key code</span><input id="inputCode" type="number" min="0" max="767" placeholder="Press a key while listening"></label><label class="field"><span>Action</span><select id="ruleAction"><option value="launch">Open app</option><option value="key">Send key</option></select></label><label class="field" id="targetAppField"><span>App to open</span><select id="targetApp"><option value="">Select an app…</option></select></label><label class="field" id="targetKeyField" hidden><span>Key to send</span><select id="targetKey"><option value="">Select a key…</option>${keyOptions()}</select></label><div class="row"><button id="saveRule" class="primary">Save shortcut</button></div><label class="switch"><input id="filter" type="checkbox" role="switch"><span>Remote interception</span></label><p class="notice">Saved on the TV and restored when Vetro starts. Listening pauses interception.</p></div></div><div class="box"><h2>Shortcuts</h2><div id="rules">No shortcuts yet. Capture a key and choose what it does.</div></div></section></div></main><div id="overlay" class="overlay" hidden></div><aside id="detail" class="drawer" role="dialog" aria-modal="true" aria-label="Details" hidden></aside><div id="feedback" role="status" hidden></div><div id="actionToast" aria-hidden="true" hidden></div><dialog id="aboutDialog" class="about" aria-labelledby="aboutTitle"><div class="about-body">
<div class="about-top"><div class="about-brand"><img src="/icon.png" alt="" width="44" height="44"><div><h2 id="aboutTitle">About Vetro</h2><small id="aboutVersion"></small></div></div><button type="button" id="aboutClose" aria-label="Close About Vetro">Close</button></div>
<p class="about-lead"><strong>A TV manager for Samsung Tizen.</strong></p>
<div class="about-maker"><img class="about-photo" alt="Andrea Ricci" width="88" height="88"><div><h3>Made by Andrea Ricci</h3><p>Free and open source (MIT). Questions and reports from your TV go to Discord or GitHub.</p></div></div>
<ul class="about-list"><li><strong>Vetro TV Tuner</strong><span>Banner, Channel list, Channel pad and TV guide over live TV.</span></li><li><strong>Vetro launcher</strong><span>Your own row of apps on the Home key, with a Control center.</span></li><li><strong>Privacy and cleanup</strong><span>Switch off ads, viewing-data collection, voice assistants and apps you don’t use.</span></li><li><strong>Remapper</strong><span>Make a remote button open an app or press another key.</span></li><li><strong>Also</strong><span>Shards (plugins), DNS blocking, TV settings and signed updates.</span></li></ul>
<div class="about-links"><a class="primary" href="https://discord.gg/Pe9BmthUar" target="_blank" rel="noopener noreferrer">Discord ↗</a><a href="https://github.com/andrearicci93/vetro" target="_blank" rel="noopener noreferrer">GitHub ↗</a><a href="https://github.com/andrearicci93/vetro/issues/new?template=log_report.yml" target="_blank" rel="noopener noreferrer">Add your TV ↗</a><a href="https://github.com/andrearicci93/vetro/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer">Changelog ↗</a></div>
<p class="about-fine">Vetro builds on <a href="https://github.com/chris-ritsen/samsung-tv-root" target="_blank" rel="noopener noreferrer">Chris Ritsen’s Samsung TV root research</a>. Contributors are credited in the README. Experimental software, provided as is, not affiliated with Samsung.</p>
</div></dialog>
<script>
'use strict';
/* Regular expressions are built once, here, before any function can run. */
var HTML_SPECIAL_RE=/[&<>"']/g,MIXED_RE=/Mixed/,UNKNOWN_RE=/Unknown/,ENABLED_RE=/^enabled/,KEY_CODE_RE=/^\\d{1,3}$/,SPACES_RE=/\\s+/,NETWORK_QUERY_RE=/^(network)$/,SOURCES_QUERY_RE=/input|source|hdmi/,DEVICE_QUERY_RE=/model|firmware|region|smart hub/,VERSION_RE=/^\\d+(\\.\\d+)*$/,SHA256_I_RE=/^[0-9a-f]{64}$/i,SHA256_RE=/^[0-9a-f]{64}$/,UPDATE_FILE_RE=/^vetro-update-[0-9.]+[.]json$/;
var inventory=[], appNameCount={}, rules=[], reservedKeys=[], remapTuner=false, selected=null, feedbackTimer, lastSeq=0, lastDevice=null, closeFocus=null;
// #89: the Quick settings switches wait for the app list. A failed or empty read, or one that takes over 30 s, is said
// on the switch with a Retry button, instead of 'Reading apps…' for ever.
var appsState={state:'loading',error:null},appsSlowTimer=null;
var $=function(id){return document.getElementById(id)};
function appLabel(a){var n=a.name||a.appId;return appNameCount[n]>1?n+' ('+a.appId+')':n}
function esc(s){return String(s==null?'—':s).replace(HTML_SPECIAL_RE,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function say(s){$('feedback').textContent=s;$('feedback').hidden=false;clearTimeout(feedbackTimer);feedbackTimer=setTimeout(function(){$('feedback').hidden=true},6000)}
// A request that gets no answer is cancelled, so a half-open connection cannot leave a busy flag set until the page is reloaded.
// The slowest honest answer is a package install or a quick win, a minute or so.
var API_TIMEOUT_MS=120000;
function api(url,body){var ac=typeof AbortController==='function'?new AbortController():null,timer=ac?setTimeout(function(){ac.abort()},API_TIMEOUT_MS):null,opts=body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};if(ac)opts.signal=ac.signal;
 function done(){if(timer)clearTimeout(timer)}
 return fetch(url,opts).then(function(r){return r.json().then(function(d){if(!r.ok||d.ok===false){var e=Error(d.error||'Action failed');e.data=d;throw e}return d})}).then(function(d){done();return d},function(e){done();if(e&&e.name==='AbortError')throw Error('The TV did not answer in time');throw e})}
function bytes(n){return n==null?'Unavailable':n<1048576?Math.round(n/1024)+' KB':(n/1048576).toFixed(1)+' MB'}
function icon(a){var initial=(a.name||a.appId||'').trim().slice(0,1).toUpperCase(),fallback=a.show?'<span>'+esc(initial)+'</span>':'<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m12 3 8 4v10l-8 4-8-4V7Z M4 7l8 4 8-4 M12 11v10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';return '<span class="icon">'+fallback+(a.iconPath?'<img alt="" loading="lazy" src="/apps/icon?appId='+encodeURIComponent(a.appId)+'" onerror="this.remove()">':'')+'</span>';}


// The app list and the process sample do not depend on each other: ask for both at once, then draw the monitor after the list as before.
function refreshAppsAndMonitor(){return Promise.all([loadApps(true,true),api('/monitor')]).then(function(r){return drawMonitor(r[1])})}
function loadApps(refresh,strict){appsState={state:'loading',error:null};clearTimeout(appsSlowTimer);appsSlowTimer=setTimeout(function(){if(appsState.state==='loading'){appsState={state:'slow',error:null};renderQuick();}},30000);if(!inventory.length)renderQuick();return api('/apps'+(refresh?'?refresh=1':'')).then(function(d){clearTimeout(appsSlowTimer);appsState=d.apps&&d.apps.length?{state:'ok',error:null}:{state:'empty',error:d.registryError||null};if(strict&&d.registryError)throw Error('TV registry unavailable: '+d.registryError);inventory=d.apps;if(currentPanel==='vetroui')renderDock();$('inventorySource').textContent=d.registryError?'Probe data; registry details unavailable':d.source==='package registry + public probe'?'App information from the TV · expand a row for components':'Probe data';render();var pickable=inventory.filter(function(a){return a.show&&!a.disabled&&!a.launchRisk&&a.appId!==NOT_LAUNCHABLE&&String(a.appId).indexOf(NOT_LAUNCHABLE+'.')!==0}).sort(function(a,b){return(a.name||a.appId).localeCompare(b.name||b.appId)||a.appId.localeCompare(b.appId)});appNameCount={};pickable.forEach(function(a){var n=a.name||a.appId;appNameCount[n]=(appNameCount[n]||0)+1});$('targetApp').innerHTML='<option value="">Select an app…</option>'+pickable.map(function(a){return '<option value="'+esc(a.appId)+'">'+esc(appLabel(a))+'</option>'}).join('');var previous=$('mqttTarget').value;$('mqttTarget').innerHTML=$('targetApp').innerHTML;$('mqttTarget').value=previous;if(bootData){bootData.apps=inventory;renderStartup()}renderQuick();return d;}).catch(function(e){clearTimeout(appsSlowTimer);if(appsState.state!=='empty')appsState={state:'error',error:e.message};renderQuick();if(strict)throw e;$('appGrid').textContent='Inventory unavailable. '+e.message;say(e.message)})}
function appsChip(){var s=appsState.state,retry=' <button data-apps-retry>Retry</button>',why=String(appsState.error||'').slice(0,120);
 if(s==='loading')return chip('Reading apps…');
 if(s==='slow')return chip('Still reading the app list…','partial')+retry;
 if(s==='error')return chip('App list not read'+(why?' · '+why:''),'partial')+retry;
 return chip(why?'App list unavailable · '+why:'No apps found','partial')+retry;}
var NOT_LAUNCHABLE=${JSON.stringify(require('./remap.js').NOT_LAUNCHABLE_PREFIX)};
var SEND_KEY_LABELS=${JSON.stringify(sendKeyLabels)};
var componentAvailability=${componentAvailability.toString()},verifiedDisableIds=${JSON.stringify(verifiedDisableIds)};
function depList(list){return !list?'Unknown':!list.length?'None declared':list.map(function(d){return '<div class="deps">'+esc(d.packageId)+'<small>'+esc(d.type)+(d.version?' · version '+esc(d.version):'')+'</small></div>'}).join('')}
function commandButton(id,label,reason,primary){return '<div class="drawer-command"><button id="'+id+'"'+(primary?' class="primary"':'')+(reason?' disabled':'')+' aria-describedby="'+id+'Reason"'+'>'+label+'</button>'+'<p id="'+id+'Reason" class="muted"'+(reason?'':' hidden')+'>'+esc(reason||'')+'</p>'+'</div>';}
function detailMarkup(a){
 var cap=componentAvailability(a,inventory,verifiedDisableIds),u=usage([a]);
 var stopReason=cap.flags.reason||(!u.known?'Process state is unavailable. Refresh state to check it.':!u.count?'No linked processes in the latest sample.':'');
 return '<button id="closeDetail">Close ×</button>'+icon(a)+'<h2>'+esc(a.name||a.appId)+'</h2><code>'+esc(a.appId)+'</code>'+'<div class="drawer-about">'+(a.purpose?'<p>'+esc(a.purpose)+'</p>':'')+'<div class="row">'+roleChip(a.role)+'<span class="muted">'+esc(areaLabels[a.area]||'')+'</span></div>'+((a.startsOn||[]).length?'<p class="notice">The firmware starts it on '+esc(a.startsOn.join(' and '))+'s. Disable it to block those launches.</p>':'')+((a.access||[]).length?'<p class="notice">May use: '+esc(a.access.join(', '))+'.</p>':'')+(Array.isArray(a.referencedBy)?(a.referencedBy.length?'<details><summary>Mentioned by '+a.referencedBy.length+' other package'+(a.referencedBy.length===1?'':'s')+'</summary><p class="notice">These packages mention this one. Dependencies are listed separately.</p><ul class="member-list">'+a.referencedBy.map(function(r){return '<li><span class="small-mono">'+esc(r)+'</span></li>'}).join('')+'</ul></details>':'<p class="notice">No other package in this firmware names it.</p>'):'')+'</div>'+
 '<div class="drawer-state"><span>App state <strong id="componentAppState">'+groupTag({members:[a]})+'</strong></span><span>Processes <span id="componentRuntime">'+runtimeTag([a])+'</span></span></div>'+
 '<div class="component-tools"><h3>Actions</h3><div class="drawer-actions">'+commandButton('launchApp','Open app',cap.launch.reason,true)+commandButton('toggleApp',a.disabled?'Enable':'Disable',cap.toggle.reason)+commandButton('stopComponent','Stop now',stopReason)+commandButton('uninstallComponent','Uninstall package',cap.uninstall.reason)+'</div>'+
 '<div id="componentConfirmation" class="component-confirmation" hidden></div><p id="componentProgress" class="notice" role="status" aria-live="polite"></p><p id="componentUsage" class="notice">'+(u.known?u.count+' linked processes':'Process state unknown')+' · CPU '+number(u.cpu)+(u.cpu==null?'':'%')+' · RSS '+memory(u.rss)+'. RSS includes shared RAM.</p>'+
 '<h3>Startup</h3><label class="switch"><input type="checkbox" role="switch" id="bootFlag" '+(a.onboot?'checked':'')+' '+(!cap.flags.allowed||a.onboot==null?'disabled':'')+'><span>Start at boot'+(a.onboot==null?' · Unknown':'')+'</span></label><label class="switch"><input type="checkbox" role="switch" id="restartFlag" '+(a.autorestart?'checked':'')+' '+(!cap.flags.allowed||a.autorestart==null?'disabled':'')+'><span>Restart automatically'+(a.autorestart==null?' · Unknown':'')+'</span></label><p class="muted">'+esc(cap.flags.reason||'Startup settings are saved separately. Other components can start the app.')+'</p>'+quickNote(a)+'<button id="refreshDetail">Refresh state</button></div>'+
 '<details class="component-tools"><summary>Package details</summary><dl><dt>Package</dt><dd>'+esc(a.packageId)+'</dd><dt>Version</dt><dd>'+esc(a.version)+'</dd><dt>Size</dt><dd>'+bytes(a.size)+'</dd><dt>Author</dt><dd>'+esc(a.author)+'</dd><dt>Category</dt><dd>'+esc(categories[a.category]||'Other')+'<br><span class="muted">'+esc(a.categoryReason||'Classification unavailable')+'</span></dd><dt>Type</dt><dd>'+esc(a.type)+' · '+esc(a.component)+'</dd><dt>System</dt><dd>'+(a.system==null?'Unknown':a.system?'Yes':'No')+'</dd><dt>Removable</dt><dd>'+(a.removable==null?'Unknown':a.removable?'Yes':'No')+'</dd></dl><h3>Declared dependencies</h3>'+depList(a.dependencies)+'<h3>Declared dependents</h3>'+depList(a.dependents)+'<p class="notice">Registry dependencies only. Other links may exist.</p></details>';
}
function detail(id){
 if(componentBusy){say('Wait for the current action to finish.');return}
 selected=inventory.find(function(a){return a.appId===id});if(!selected)return;
 var a=selected;if($('detail').hidden)closeFocus=document.activeElement;$('detail').innerHTML=detailMarkup(a);$('detail').scrollTop=0;
 $('overlay').hidden=false;$('detail').hidden=false;syncOverlayBackground();$('closeDetail').focus();$('closeDetail').onclick=closeDetail;
 bindComponentControls(a);
 if(!processData||Date.now()-processAt>=30000)sampleOnce();
}
function focusableWithin(box){return [].slice.call(box.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex]:not([tabindex="-1"])')).filter(function(n){return n.getClientRects().length&&!n.closest('[inert]')})}
function containFocus(box,e){
 if(e.key!=='Tab')return;
 var nodes=focusableWithin(box),first=nodes[0],last=nodes[nodes.length-1];
 if(!first){e.preventDefault();box.focus();return}
 if(!box.contains(document.activeElement)||e.shiftKey&&document.activeElement===first){e.preventDefault();(e.shiftKey?last:first).focus()}
 else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
}
function syncOverlayBackground(){
 var menu=navOpen(),drawer=!$('detail').hidden;
 document.querySelector('.main').inert=menu||drawer;
 document.querySelector('.topbar').inert=menu||drawer;
 $('sidebar').inert=drawer;
}
function closeDetail(){
 $('detail').hidden=true;$('overlay').hidden=true;syncOverlayBackground();
 if(closeFocus&&closeFocus.isConnected)closeFocus.focus();else $('pageHeading').focus();
}
$('overlay').onclick=closeDetail;document.addEventListener('keydown',function(e){if($('detail').hidden)return;if(e.key==='Escape'){e.preventDefault();closeDetail();return}containFocus($('detail'),e)});
$('appGrid').onclick=function(e){var b=e.target.closest('[data-app]');if(b)detail(b.dataset.app)};$('search').oninput=render;$('category').onchange=render;$('refresh').onclick=function(){loadApps(true)};
function showRules(){renderMqttRules();
 var lock='<svg class="lock-icon" viewBox="0 0 24 24" role="img" aria-label="Locked"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/></svg>';
 var held=reservedKeys.map(function(k){return '<div class="rule rule-locked" data-held="'+esc(k.code)+'"><div>'+lock+' '+(k.icon?remoteKey(k.icon,k.label)+' ':'')+'Key <code>'+esc(k.code)+'</code> ('+esc(k.label)+') → '+esc(k.name)+' <span class="muted">Vetro UI'+(k.live?'':' · waits for a launcher')+'</span></div><button data-open-ui="osd">Open Vetro UI</button></div>'}).join('');
 var mine=rules.map(function(r){var a=r.actions[0],name=a.type==='launch'?appLabel(inventory.find(function(x){return x.appId===a.appId})||{appId:a.appId}):a.type==='key'?(SEND_KEY_LABELS[a.key]||a.key)+' key':a.type;var over=r.enabled&&r.trigger.type==='physical'&&reservedKeys.some(function(k){return k.live&&k.code===String(r.trigger.value)});var tk=!over&&remapTuner&&r.enabled&&r.trigger.type==='physical'?UI_TUNER_KEYS.filter(function(k){return k.code===String(r.trigger.value)})[0]:null;return '<div class="rule"><div>'+(r.trigger.type==='physical'?'Key <code>'+esc(r.trigger.value)+'</code>':'<code>'+esc(r.trigger.type)+' / '+esc(r.trigger.value)+'</code>')+' → '+esc(name)+' <span class="muted">'+(r.enabled?'':'(off)')+'</span>'+(over?' <span class="tag">Overridden by Vetro UI</span>':'')+(tk?' <span class="tag">Live TV does not get '+esc(tk.label)+'</span>':'')+'</div><button class="danger" data-delete="'+esc(r.id)+'">Delete shortcut</button></div>'}).join('');
 $('rules').innerHTML=held||mine?held+mine:'No shortcuts yet. Capture a key and choose what it does.'}
function loadRules(){return api('/remap').then(function(d){if(!Array.isArray(d.rules))throw Error('Shortcut list unreadable');rules=d.rules;reservedKeys=Array.isArray(d.reserved)?d.reserved:[];remapTuner=!!(d.tuner&&d.tuner.enabled);showRules()}).catch(function(e){$('rules').textContent='Could not read the saved shortcuts: '+e.message})}
$('rules').onclick=function(e){if(e.target.dataset.openUi!=null)return switchPanel(e.target.dataset.openUi);var id=e.target.dataset.delete;if(!id)return;return saveRuleSet(rules.filter(function(r){return r.id!==id}),'Delete shortcut',e.target)};
$('ruleAction').onchange=function(){$('targetAppField').hidden=this.value!=='launch';$('targetKeyField').hidden=this.value!=='key'};
$('saveRule').onclick=function(){var code=$('inputCode').value,sends=$('ruleAction').value==='key',id=sends?$('targetKey').value:$('targetApp').value;if(!KEY_CODE_RE.test(code)||+code>767||!id){say('Enter a key code from 0 to 767 and select '+(sends?'a key to send.':'an app.'));return}code=String(+code);var held=reservedKeys.filter(function(k){return k.code===code})[0];if(held&&!confirm('Key '+code+' ('+held.label+') is used by Vetro UI ('+held.name+'). Vetro UI comes first: this shortcut will not run while the '+held.name.toLowerCase()+' is on. Save it anyway?'))return;var tkey=remapTuner?UI_TUNER_KEYS.filter(function(k){return k.code===code})[0]:null;if(tkey&&!confirm('Key '+code+' is '+tkey.label+' for Vetro’s live TV. With this shortcut the key '+(sends?'sends '+SEND_KEY_LABELS[id]:'opens the app')+' and never reaches the tuner. Save it anyway?'))return;var next=rules.filter(function(r){return !(r.trigger.type==='physical'&&r.trigger.value===code)});next.push({id:'physical_'+code,enabled:true,trigger:{type:'physical',value:code},actions:[sends?{type:'key',key:id}:{type:'launch',appId:id}]});return saveRuleSet(next,'Save shortcut',this)};
function policy(mode,device){return runUiOperation('rules',mode==='off'?'Stop interception':mode==='observe'?'Listen to remote':'Remote interception','Physical remote',mode==='observe'?$('observe'):$('filter'),function(mark){return api('/input',{device:device||$('device').value,mode:mode}).then(function(d){var p=d.status&&d.status.policy;if(!p||p.mode!==mode)throw Error('Remote mode not confirmed');lastSeq=0;pollInput();return {state:mode!=='off'&&!p.connected?'warning':'success',resultLabel:'State read',message:mode==='off'?'Interception stopped. Remote keys work normally.':!p.connected?'Mode requested. Check the device connection before testing keys.':mode==='observe'?'Listening. Keys work normally. Press a remote key to test.':'Interception on. Test a saved shortcut. This setting survives a restart.'}})})}
// Stopping capture returns to the saved choice: mode off would also save interception as off.
function listenStopBody(){var pref=inputPreferenceState;return pref&&pref.enabled&&(pref.node||pref.device)?{device:pref.node||pref.device,mode:'filter'}:{device:$('device').value,mode:'off'}}
$('observe').onclick=function(){if(!inputListening)return policy('observe');var b=listenStopBody();return policy(b.mode,b.device)};$('filter').onchange=function(){if(!this.checked&&reservedKeys.some(function(k){return k.live})&&!confirm('The volume bar or the 123 pad of Vetro UI use the remote interception. Without it Vol, Mute and 123 go back to Samsung’s own bar and pad. Turn it off anyway?')){this.checked=true;return}return policy(this.checked?'filter':'off').then(function(){return pollInput()})};
// Listening pauses the remote interception (and with it Vetro UI's Volume bar and 123 pad): it ends by itself after LIVE_MS, and when the page goes away.
var polling=false,inputListening=false,inputPreferenceState=null,listenSince=0;function pollInput(){if(polling)return;polling=true;return api('/input').then(function(d){var value=$('device').value, options=d.devices.filter(function(x){return x.selectable});if(options.map(function(x){return x.node}).join('|')!==lastDevice){lastDevice=options.map(function(x){return x.node}).join('|');$('device').innerHTML=options.length?'<option value="auto">Detect automatically (listen only)</option>'+options.map(function(x){return '<option value="'+esc(x.node)+'">'+esc(x.name)+' · '+esc(x.node)+'</option>'}).join(''):'<option value="">No compatible device</option>';if(options.some(function(x){return x.node===value}))$('device').value=value}var p=d.status.policy;inputListening=p.mode==='observe';listenSince=inputListening?listenSince||Date.now():0;inputPreferenceState=d.status.preference||null;$('observe').textContent=inputListening?'Stop listening':'Start listening';if(!uiOperationBusy.rules)$('filter').checked=d.status.preference?d.status.preference.enabled:p.mode==='filter';if(p.node&&options.some(function(x){return x.node===p.node}))$('device').value=p.node;$('inputStatus').textContent=d.error||d.status.error|| (p.mode==='off'?(d.status.preference&&d.status.preference.enabled?'Interception enabled · waiting for remote':'Interception off'):(p.mode==='observe'?'Listening':'Interception')+' · '+p.device+(p.connected?' · connected':' · connecting…'));var down=d.status.events.filter(function(e){return e.action==='down'}), event=down[down.length-1];if(event&&event.node+':'+event.sequence!==lastSeq){lastSeq=event.node+':'+event.sequence;$('device').value=event.node;$('keyEvent').textContent=(event.key||'Key')+' · '+event.code;$('keyEvent').className='has-key';$('inputCode').value=event.code}}).catch(function(e){$('inputStatus').textContent=e.message}).finally(function(){polling=false})}
function k(key){api('/control',{key:key}).catch(function(e){say(e.message)})}
function setConnection(on){var c=$('connection');c.textContent=on?'Connected':'Not connected';c.className=on?'is-on':''}
var statusRead=api('/status').then(function(d){if(d.app&&d.app.version)$('appVersion').textContent='Vetro '+d.app.version;setConnection(!!(d.agent&&d.agent.connected));
 // Whether the root agent is up: the Quick settings wins need it (without it /wins answers 503), and the firmware card then says what still works.
 quickData.root=!!(d.agent&&d.agent.connected);if(!quickData.root)renderQuick()}).catch(function(){setConnection(false)});

var categories={user:'User apps',media:'Media',ads:'Advertising / viewing recognition',privacy:'Privacy',voice:'Voice assistants',connectivity:'Connectivity',hotel:'Hotel / retail',system:'System',protected:'Protected',other:'Other'};
var origins={installed:'Installed',preinstalled:'Preinstalled',system:'System',unknown:'Unknown'};
var areaLabels=${JSON.stringify(require('./app-catalog.js').AREAS)},roleLabels=${JSON.stringify(Object.assign({},require('./app-catalog.js').ROLES,{unused:''}))},roleFilter='all';
var processData=null,processAt=0,sampleFetching=false,sampleFailedAt=0;var inventoryNeedsRefresh=false;var currentPanel='quick',liveUntil=0,liveData=null,histCpu=[],histRam=[],monitorBusy=false,bootData=null,bootMode='apps';
var titles={vetroui:['Vetro UI','The launcher, live TV and on-screen displays that Vetro draws on the TV.'],plugins:['Vetro Shards','Plugins written by other people. They run on your TV with Vetro’s own access.'],quick:['Quick settings','Privacy, background services and maintenance.'],actions:['Session history','Changes made in this session.'],mqtt:['Home Assistant','The TV in Home Assistant, through an MQTT broker.'],tvsettings:['Settings and controls','Picture, sound, network and privacy values, device information and remote keys.'],dns:['DNS blocking','Blocks domains without changing DNS servers.'],dashboard:['Resource monitor','Resource usage. Live updates run for 2 minutes.'],processes:['Processes','Refreshed every 10 seconds during live updates.'],apps:['Apps and processes','Apps, running processes and what starts with the TV.'],startup:['Startup','Startup flags and system services.'],remote:['Remapper','Make a remote button open an app or press another key.']};
function number(n,d){return n==null||!isFinite(n)?'—':n.toLocaleString('en-GB',{maximumFractionDigits:d==null?1:d})}
function memory(n){return n==null?'—':n>=1073741824?number(n/1073741824,2)+' GiB':number(n/1048576,0)+' MiB'}
function rate(n){return n==null?'—':n>=1048576?number(n/1048576,1)+' MiB/s':number(n/1024,0)+' KiB/s'}
function tag(s,good){return '<span class="tag '+(good?'good':'')+'">'+esc(s)+'</span>'}
var groupApps=${groupApps.toString()},expandedApps={},expandedBoot={};
function usage(members){var known=!!processData&&Date.now()-processAt<30000,ids=members.map(function(a){return a.appId}),p=known?(processData.processes||[]).filter(function(p){return ids.indexOf(p.appId)>=0}):[];return {known:known,count:p.length,cpu:known&&p.some(function(x){return x.cpuPercent!=null})?p.reduce(function(n,x){return n+(x.cpuPercent||0)},0):null,rss:known?p.reduce(function(n,x){return n+(x.rssBytes||0)},0):null};}
function useCells(members){var u=usage(members);return '<td class="numeric proc-col">'+(u.count&&u.cpu!=null?number(u.cpu)+'%':'—')+'</td><td class="numeric proc-col">'+(u.count?memory(u.rss):'—')+'</td>';}
function flagState(members,field){var on=members.filter(function(a){return a[field]===true}).length,off=members.filter(function(a){return a[field]===false}).length;return on===members.length?'On':off===members.length?'Off':on+off<members.length?'Unknown':'Mixed';}
function groupTag(g){var state=flagState(g.members,'disabled');return state==='On'?'Disabled':state==='Off'?'Enabled':state;}
function mixedCount(members,field){if(flagState(members,field)!=='Mixed')return '';var on=members.filter(function(a){return a[field]===true}).length;return '<small class="running-note"> '+on+' of '+members.length+' on</small>'}
function stateTag(text,kind){var title=MIXED_RE.test(text)?'Components have different states. Expand the row to inspect each one.':UNKNOWN_RE.test(text)?'Not available in the latest verified data.':'';return '<span class="tag '+kind+'"'+(title?' title="'+title+'"':'')+'>'+esc(text)+'</span>';}
function runtimeTag(members){var u=usage(members);return stateTag(!u.known?'Unknown':u.count?'Running · '+u.count:'Not running',u.known&&u.count?'running':'off');}
function startupText(members){var parts=[];[['onboot','Boot'],['autorestart','Restart']].forEach(function(f){var s=flagState(members,f[0]);if(s==='On')parts.push(f[1]);else if(s==='Mixed')parts.push(f[1]+' (some)');else if(s==='Unknown')parts.push('<span class="muted" title="Not available in the latest verified data.">'+f[1]+' ?</span>');});return parts.length?'<span class="startup-flags">'+parts.join(' · ')+'</span>':'<span class="muted" title="No startup settings are on. Firmware or dependencies can still start the app.">—</span>';}
function roleOf(members){var order=['tracking','optional','keep'],roles=members.map(function(a){return a.role}).filter(Boolean);for(var i=0;i<order.length;i++)if(roles.indexOf(order[i])>=0)return order[i];return null;}
function roleChip(role){return role&&role!=='unused'?'<span class="role role-'+role+'">'+esc(roleLabels[role])+'</span>':'<span class="muted">—</span>';}
function appStateCells(g){var enabled=groupTag(g),u=usage(g.members);return '<td>'+roleChip(roleOf(g.members))+'</td><td>'+stateTag(enabled,enabled==='Mixed'?'mixed':enabled==='Enabled'?'good':'off')+(u.known?'<small class="running-note'+(u.count?'':' off')+'">'+(u.count?'Running · '+u.count:'Not running')+'</small>':'')+'</td><td>'+startupText(g.members)+'</td>';}
function uniqueText(g,field,labels){var out=[];g.members.forEach(function(a){var v=labels?(labels[a[field]]||'Unknown'):a[field]||'—';if(out.indexOf(v)<0)out.push(v)});if(field==='category'&&out.length>1)out=out.filter(function(v){return v!==categories.other});return out.join(' / ');}
function groupName(g,expanded,duplicate){var more=g.members.length>1,purpose=(g.members.filter(function(a){return a.purpose})[0]||{}).purpose;return '<div class="app-name">'+icon(g.primary)+'<button '+(more?'data-group="'+esc(g.key)+'" aria-expanded="'+!!expanded+'"':'data-app="'+esc(g.primary.appId)+'"')+'>'+(more?'<span class="caret" aria-hidden="true">'+(expanded?'▾':'▸')+'</span>':'')+esc(g.name)+(duplicate?' <span class="muted">· '+esc(g.packages[0])+'</span>':'')+(purpose?'<span class="purpose">'+esc(purpose)+'</span>':'')+'<span class="mobile-role">'+roleChip(roleOf(g.members))+'</span>'+'<small>'+esc(g.packages.length===1?g.packages[0]:g.packages.length+' packages')+(more?' · '+g.members.length+' components':'')+' · '+esc(uniqueText(g,'area',areaLabels))+'</small></button></div>';}
// Tells, in the Startup section, that a Quick settings switch covers this component and what it does to the two flags.
function quickNote(a){var g=quickGroups.filter(function(x){var s=quickState(x,inventory);return s.installed.indexOf(a.appId)>=0&&(s.status==='off'||s.status==='partial'||s.disabled.indexOf(a.appId)>=0)});if(!g.length)return '';var names=g.map(function(x){return groupTitles[x.id]||x.label}).filter(function(n,i,all){return all.indexOf(n)===i});return '<p class="notice">Covered by Quick settings: '+esc(names.join(', '))+'. Turning on a switch disables this component and clears Start at boot and Restart automatically. Turning it off restores both settings.'+(a.disabled&&(a.onboot||a.autorestart)?' This component is disabled but still has a startup flag, so the switch is partly done.':'')+'</p>';}
function componentRow(a,boot){return '<tr class="component-row '+(a.disabled===true?'disabled-row':'')+'"><td><button data-app="'+esc(a.appId)+'">'+esc(a.name||a.appId)+'<small>'+esc(a.appId)+'</small><small>'+esc(areaLabels[a.area]||'Other')+' · '+esc(origins[a.origin]||'Unknown')+' · '+esc(a.version)+'</small></button></td>'+(boot?'<td>'+stateTag(flagState([a],'onboot'),a.onboot===true?'good':'off')+'</td><td>'+stateTag(flagState([a],'autorestart'),a.autorestart===true?'good':'off')+'</td><td>'+stateTag(groupTag({members:[a]}),a.disabled===false?'good':'off')+'</td>':appStateCells({members:[a]})+useCells([a]))+'</tr>';}
// A section is written only when its markup differs from what was last written there, so a background read that changes
// nothing keeps focus, open <details> and the pictures as they are. The comparison is with the string written, not with
// box.innerHTML (the browser rewrites that, and reading it serialises the whole section). Another write (textContent, a
// plain innerHTML) changes firstChild, and a click on a control or a change inside the section marks it, so the next render
// writes again: a switch the user moved is always redrawn from the state.
function paint(box,html){
 if(!box)return false;
 if(box.vetroHtml===html&&box.vetroFirst===box.firstChild)return false;
 box.innerHTML=html;box.vetroHtml=html;box.vetroFirst=box.firstChild;return true;
}
function unpaint(e){
 var t=e.target;if(!t||e.type==='click'&&!(t.closest&&t.closest('button,input,select,textarea,label,a')))return;   // opening a <details> is not a change
 for(var n=t;n;n=n.parentNode)if(n.vetroHtml!=null)n.vetroHtml=null;
}
['click','change','input'].forEach(function(type){document.addEventListener(type,unpaint,true)});
function replaceControls(box,html,attributes){
 var active=document.activeElement,key=null,attribute=null;
 if(active&&box.contains&&box.contains(active))attributes.some(function(a){var v=active.getAttribute(a);if(v===null)return false;attribute=a;key=v;return true});
 paint(box,html);
 if(attribute&&document.activeElement!==active){
  var replacement=[].slice.call(box.querySelectorAll('['+attribute+']')).filter(function(n){return n.getAttribute(attribute)===key})[0];
  if(box.hidden)$('pageHeading').focus();
  else (replacement||box.querySelector('[aria-selected="true"],[aria-pressed="true"]')||$('pageHeading')).focus({preventScroll:true});
 }
}
// 'Running' and 'Not running' need a process sample. Without live updates there is none, so one is read now.
function ensureSample(){if(sampleFetching||monitorBusy||Date.now()-sampleFailedAt<15000)return;sampleFetching=true;$('impactResult').textContent='Reading which apps are running…';api('/monitor').then(function(d){sampleFetching=false;$('impactResult').textContent='';drawMonitor(d)}).catch(function(e){sampleFetching=false;sampleFailedAt=Date.now();$('impactResult').textContent='Could not read the running apps: '+e.message})}
function render(){var q=$('search').value.toLowerCase(),area=$('category').value||'all',status=$('appStatus').value||'all';var all=groupApps(inventory),sampled=!!processData&&Date.now()-processAt<30000;if((status==='running'||status==='stopped')&&!sampled)ensureSample();function match(g,a,ignoreRole){return ((g.name||'')+' '+(a.name||'')+' '+a.appId+' '+a.packageId+' '+(a.purpose||'')).toLowerCase().indexOf(q)>=0&&(area==='all'||a.area===area)&&(ignoreRole||roleFilter==='all'||a.role===roleFilter)&&(status==='all'||status==='running'&&usage([a]).count||status==='visible'&&a.show||status==='disabled'&&a.disabled===true||status==='enabled'&&a.disabled===false||status==='stopped'&&usage([a]).known&&!usage([a]).count||status==='unknown'&&a.disabled==null)}var counts={all:0};all.forEach(function(g){var hit=g.members.filter(function(a){return match(g,a,true)});if(!hit.length)return;counts.all++;var r=roleOf(hit);if(r)counts[r]=(counts[r]||0)+1;});replaceControls($('roleFilters'),['all','tracking','optional','keep'].map(function(r){return '<button data-role="'+r+'" aria-pressed="'+(roleFilter===r)+'">'+(r==='all'?'All':esc(roleLabels[r]))+' <span>'+(counts[r]||0)+'</span></button>'}).join(''),['data-role']);var rows=all.filter(function(g){return g.members.some(function(a){return match(g,a,false)})}),names={};rows.forEach(function(g){names[g.name]=(names[g.name]||0)+1});$('appTable').className='app-table'+(sampled?'':' no-sample');replaceControls($('appGrid'),rows.map(function(g){return '<tr class="'+(g.members.every(function(a){return a.disabled})?'disabled-row':'')+'"><td>'+groupName(g,expandedApps[g.key],names[g.name]>1)+'</td>'+appStateCells(g)+useCells(g.members)+'</tr>'+(expandedApps[g.key]&&g.members.length>1?g.members.map(function(a){return componentRow(a,false)}).join(''):'')}).join(''),['data-group','data-app']);$('empty').hidden=rows.length!==0;$('appCount').textContent=rows.length+' / '+all.length+' entries · '+inventory.length+' components';if(bootData){bootData.apps=inventory;renderStartup();}}
$('appGrid').onclick=function(e){var g=e.target.closest('[data-group]'),a=e.target.closest('[data-app]');if(g){expandedApps[g.dataset.group]=!expandedApps[g.dataset.group];render()}else if(a)detail(a.dataset.app)};

$('roleFilters').onclick=function(e){var b=e.target.closest('[data-role]');if(!b)return;roleFilter=b.dataset.role;render();};$('appStatus').onchange=render;
function switchPanel(name){if(name==='dock'||name==='tuner'||name==='osd'){var sub=name==='dock'?'launcher':name;switchPanel('vetroui');return showUiTab(sub)}var previousFocus=document.activeElement;if(currentPanel==='remote'&&name!=='remote'&&inputListening&&!uiOperationBusy.rules)$('observe').onclick();if(currentPanel==='plugins'&&name!=='plugins'&&pluginView)showPluginTab(null);currentPanel=name;document.querySelectorAll('[data-tab]').forEach(function(b){b.setAttribute('aria-current',b.dataset.tab===(['apps','processes','startup'].indexOf(name)>=0?'apps':name)?'page':'false')});Object.keys(titles).forEach(function(k){$(k).hidden=k!==name});var debloatPanel=['apps','processes','startup'].indexOf(name)>=0;$('debloatModes').hidden=!debloatPanel;document.querySelectorAll('[data-mode]').forEach(function(b){b.setAttribute('aria-pressed',b.dataset.mode===name?'true':'false')});$('pageTitle').textContent=debloatPanel?'Apps and processes':titles[name][0];$('pageSubtitle').textContent=titles[name][1];$('pageTag').hidden=name!=='vetroui';$('shardLinks').hidden=name!=='plugins';$('shardNotice').hidden=name!=='plugins'||!!pluginView;$('liveToggle').hidden=name!=='dashboard'&&name!=='processes'&&name!=='apps';$('sampleStatus').hidden=name!=='dashboard'&&name!=='processes'&&name!=='apps';if(name==='startup')loadStartup();if(name==='dns')loadDns();if(name==='remote'){pollInput();loadRules();}if(name==='quick')loadQuick();if(name==='vetroui')loadVetroUi();if(name==='plugins')loadPlugins().then(function(){if(!registryChecked){registryChecked=true;loadRegistry()}});if(name==='tvsettings')loadTVSettings();if(name==='mqtt'){loadMqtt();loadRules();$('mqttTarget').innerHTML=$('targetApp').innerHTML;}if(name==='dashboard'||name==='processes'||name==='apps')pollMonitor();if(name==='plugins'&&pluginView){var pp=pluginPages().filter(function(q){return q.id===pluginView})[0];if(pp)$('pageSubtitle').textContent=pp.name+' · Shard (plugin)'}if(previousFocus&&previousFocus.closest('section[hidden]'))$('pageHeading').focus()}
$('downloadDiagnostics').onclick=function(){var button=this;button.disabled=true;var more=$('diagComponents').checked;$('diagnosticStatus').textContent=more?'Collecting report and component details (up to a minute)…':'Collecting report data (up to 20 seconds)…';fetch('/diagnostics/download'+(more?'?components=1':''),{cache:'no-store'}).then(function(r){if(!r.ok)throw Error('Download failed. Try again when the TV is connected.');return r.json();}).then(function(d){if(d.format!=='vetro-diagnostics'||d.schemaVersion!==1||!d.sections)throw Error('Unexpected diagnostic response.');var content=JSON.stringify(d,null,2)+'\\n',url=URL.createObjectURL(new Blob([content],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='vetro-diagnostics.json';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url)},60000);var names=Object.keys(d.sections).filter(function(k){return d.sections[k].reason!=='not-requested'}),ok=names.filter(function(k){return d.sections[k].status==='ok'}).length;$('diagnosticStatus').textContent='Report ready: '+ok+' / '+names.length+' sections.'+(ok<names.length?' Missing sections are marked in the file.':'')+' Nothing was uploaded.';}).catch(function(e){$('diagnosticStatus').textContent=e.message;}).finally(function(){button.disabled=false;});};
function compactNavigation(){return typeof matchMedia==='function'?matchMedia('(max-width:620px), (max-width:1000px) and (max-height:500px) and (pointer:coarse)').matches:innerWidth<=620}
function navOpen(){return document.body.classList.contains('nav-open')}
function setNav(open){
 var side=$('sidebar');
 if(open&&!$('detail').hidden)closeDetail();
 document.body.classList.toggle('nav-open',open);$('menuBtn').setAttribute('aria-expanded',open?'true':'false');
 if(open){side.setAttribute('role','dialog');side.setAttribute('aria-modal','true');side.setAttribute('aria-label','Navigation')}
 else{side.removeAttribute('role');side.removeAttribute('aria-modal');side.removeAttribute('aria-label')}
 syncOverlayBackground();
 var target=open?side.querySelector('[aria-current="page"]'):compactNavigation()?$('menuBtn'):side.querySelector('[aria-current="page"]');
 if(target)target.focus();
}
$('menuBtn').onclick=function(){setNav(!navOpen())};$('closeMenu').onclick=$('scrim').onclick=function(){setNav(false)};
document.addEventListener('keydown',function(e){if(!navOpen())return;if(e.key==='Escape'){e.preventDefault();setNav(false);return}containFocus($('sidebar'),e)});
if(typeof window!=='undefined')window.addEventListener('resize',function(){if(!compactNavigation()&&navOpen())setNav(false)});
document.querySelectorAll('[data-tab]').forEach(function(b){b.onclick=function(){switchPanel(b.dataset.tab);window.scrollTo(0,0);if(navOpen())setNav(false)}});document.querySelectorAll('[data-open]').forEach(function(b){b.onclick=function(){switchPanel(b.dataset.open)}});
function spark(values,max){var v=values.filter(function(n){return n!=null}),scale=max||Math.max.apply(Math,v.concat([1]));var pts=values.map(function(n,i){return n==null?null:((100-(values.length-1-i))*5)+','+(100-Math.max(0,Math.min(1,n/scale))*90)}).filter(Boolean).join(' ');return '<svg class="spark" viewBox="0 0 500 110" preserveAspectRatio="none" aria-hidden="true"><path class="gridline" d="M0 10H500 M0 55H500 M0 100H500"/><polyline points="'+pts+'"/></svg>'}
function updateComponentRuntime(u){
 var cap=componentAvailability(selected,inventory,verifiedDisableIds),reason=cap.flags.reason||(!u.known?'Process state is unavailable. Refresh state to check it.':!u.count?'No linked processes in the latest sample.':'');
 $('componentUsage').textContent=(u.known?u.count+' linked processes':'Process state unknown')+' · CPU '+number(u.cpu)+(u.cpu==null?'':'%')+' · RSS '+memory(u.rss)+'. RSS is memory held in RAM, including memory shared with other processes.';
 $('componentRuntime').innerHTML=stateTag(!u.known?'Unknown':u.count?'Running · '+u.count:'Not running',u.known&&u.count?'running':'off');
 $('stopComponent').disabled=componentBusy||!!reason;$('stopComponentReason').textContent=reason;$('stopComponentReason').hidden=!reason;
}
function drawMonitor(d){if(liveData&&liveData.ts&&d.ts&&d.ts<liveData.ts)return;liveData=d;if(Array.isArray(d.processes)){processData=d;processAt=Date.now()}setConnection(true);if(inventoryNeedsRefresh){inventoryNeedsRefresh=false;loadApps(true);}var t=d.telemetry||{},m=d.memory||{},cpu=d.cpu||{};histCpu.push(cpu.percent);histRam.push(m.availableBytes==null?null:m.availableBytes/1048576);if(histCpu.length>100){histCpu.shift();histRam.shift();}$('cpuValue').textContent=number(cpu.percent,0)+(cpu.percent==null?'':'%');$('cpuMeta').textContent=(cpu.cores||[]).length+' cores · '+(t.cpu_freq_khz?number(t.cpu_freq_khz/1000,0)+' MHz':'frequency unavailable');$('ramValue').textContent=memory(m.availableBytes);$('ramMeta').textContent='Total '+memory(m.totalBytes);$('diskValue').textContent=memory(d.storage&&d.storage.availableBytes);$('diskMeta').textContent=d.storage?number(d.storage.usedPercent,0)+'% used · '+d.storage.mount:'Unavailable';var rx=null,tx=null;(d.network||[]).forEach(function(n){if(n.rxPerSecond!=null){rx=(rx||0)+n.rxPerSecond;tx=(tx||0)+n.txPerSecond;}});$('networkValue').textContent=rate(rx)+' / '+rate(tx);$('networkMeta').textContent=(d.network||[]).map(function(n){return n.name}).join(' · ');$('cpuChart').innerHTML=spark(histCpu,100);$('ramChart').innerHTML=spark(histRam,m.totalBytes/1048576);$('cores').innerHTML=(cpu.cores||[]).map(function(c){return '<div class="core"><span>'+esc(c.name.toUpperCase())+'</span><div class="bar"><i style="width:'+(c.percent||0)+'%"></i></div><span class="numeric">'+number(c.percent,0)+(c.percent==null?'':'%')+'</span></div>'}).join('');$('uptime').textContent=d.uptimeSeconds==null?'—':'Uptime: '+number(d.uptimeSeconds/3600,1)+' h';$('loadValue').textContent='Load 1 / 5 / 15 min: '+(t.loadavg||'—').split(' ').slice(0,3).join(' / ');$('temperature').textContent=t.soctemp_c==null?'Temperature unavailable':'Temperature: '+number(t.soctemp_c)+' °C';$('zramLogical').textContent=memory(d.zram&&d.zram.logicalBytes);$('zramPhysical').textContent=memory(d.zram&&d.zram.physicalBytes);$('swapFree').textContent=memory(m.swapFreeBytes)+' / '+memory(m.swapTotalBytes);$('topProcesses').className=d.scope==='summary'?'':'table-wrap';$('topProcesses').tabIndex=d.scope==='summary'?-1:0;$('topProcesses').innerHTML=d.scope==='summary'?'<p class="muted">Open Apps and processes to sample processes.</p>':'<table><thead><tr><th>Process</th><th class="numeric">CPU</th><th class="numeric">RSS</th></tr></thead><tbody>'+(d.processes||[]).slice().sort(function(a,b){return (b.cpuPercent||0)-(a.cpuPercent||0)||b.rssBytes-a.rssBytes}).slice(0,5).map(function(p){return '<tr><td>'+esc(p.name)+'</td><td class="numeric">'+number(p.cpuPercent)+'%</td><td class="numeric">'+memory(p.rssBytes)+'</td></tr>'}).join('')+'</tbody></table>';if(d.processes){renderProcesses();if(currentPanel==='apps')render();}if(Array.isArray(d.processes)&&selected&&$('componentUsage')&&!$('detail').hidden){updateComponentRuntime(usage([selected]));}liveStatus();}
var states={R:'Running',S:'Waiting',D:'I/O wait',T:'Stopped',t:'Traced',Z:'Zombie',I:'Idle'};
function renderProcesses(){if(!processData)return;var q=$('processSearch').value.toLowerCase(),kind=$('processKind').value||'all',sort=$('processSort').value||'cpu';var rows=processData.processes.filter(function(p){return (p.name+' '+p.pid).toLowerCase().indexOf(q)>=0&&(kind==='all'||kind==='kernel'&&p.kernel||kind==='user'&&!p.kernel)});rows.sort(function(a,b){return sort==='memory'?b.rssBytes-a.rssBytes:sort==='pid'?a.pid-b.pid:sort==='name'?a.name.localeCompare(b.name):(b.cpuPercent||0)-(a.cpuPercent||0)||b.rssBytes-a.rssBytes});replaceControls($('processRows'),rows.map(function(p){return '<tr><td><button class="process-name" data-process="'+p.pid+'">'+esc(p.name)+'</button>'+(p.appId?'<small class="small-mono muted app-id">'+esc(p.appId)+'</small>':'')+'</td><td class="numeric muted">'+p.pid+'</td><td class="numeric">'+number(p.cpuPercent)+(p.cpuPercent==null?'':'%')+'</td><td class="numeric">'+memory(p.rssBytes)+'</td><td class="state">'+esc(states[p.state]||p.state)+(p.kernel?' · kernel':'')+'</td><td class="numeric muted">'+p.threads+'</td></tr>'}).join('')||'<tr><td colspan="6" class="empty">No matching processes.</td></tr>',['data-process']);$('processCount').textContent=rows.length+' / '+processData.processCount+' processes';}
$('processSearch').oninput=renderProcesses;$('processKind').onchange=renderProcesses;$('processSort').onchange=renderProcesses;
$('processRows').onclick=function(e){var b=e.target.closest('[data-process]');if(!b||!processData)return;var p=processData.processes.find(function(x){return x.pid===+b.dataset.process});if(!p)return;closeFocus=document.activeElement;$('detail').innerHTML='<button id="closeDetail">Close ×</button><h2>'+esc(p.name)+'</h2><p class="muted">'+(p.kernel?'Kernel thread':'User-space process')+'</p><dl><dt>PID / parent</dt><dd>'+p.pid+' / '+p.ppid+'</dd><dt>State</dt><dd>'+esc(states[p.state]||p.state)+'</dd><dt>Sampled CPU</dt><dd>'+number(p.cpuPercent)+(p.cpuPercent==null?'':'%')+'</dd><dt>RSS memory</dt><dd>'+memory(p.rssBytes)+'</dd><dt>Virtual memory</dt><dd>'+memory(p.virtualBytes)+'</dd><dt>Thread</dt><dd>'+p.threads+'</dd></dl><p class="notice">RSS includes shared RAM. Stopping this process may free less.</p>'+(p.appId?'<button id="manageProcessApp">Manage component</button>':'');$('overlay').hidden=false;$('detail').hidden=false;syncOverlayBackground();$('closeDetail').onclick=closeDetail;$('closeDetail').focus();if(p.appId)$('manageProcessApp').onclick=function(){detail(p.appId)};};
var monitorLastAt={};function pollMonitor(){var scope=currentPanel==='dashboard'?'summary':'full';if(Date.now()>=liveUntil||monitorBusy||document.hidden||['dashboard','processes','apps'].indexOf(currentPanel)<0||Date.now()-(monitorLastAt[scope]||0)<(scope==='summary'?5000:10000))return;monitorBusy=true;monitorLastAt[scope]=Date.now();api(scope==='summary'?'/monitor?scope=summary':'/monitor').then(drawMonitor).catch(function(e){$('sampleStatus').textContent='Data unavailable';$('cpuMeta').textContent=e.message}).finally(function(){monitorBusy=false});}
// Live sampling is off by default: each sample runs commands on the TV. A
// session lasts LIVE_MS and stops by itself; one-off refreshes stay available.
var LIVE_MS=120000;
function liveStatus(){var left=Math.max(0,Math.ceil((liveUntil-Date.now())/1000)),last=liveData?' · last sample '+new Date(liveData.ts).toLocaleTimeString('en-GB'):'';if(left>0)$('sampleStatus').innerHTML='<i class="live-dot"></i>Live · '+Math.floor(left/60)+':'+('0'+left%60).slice(-2)+' left'+esc(last);else $('sampleStatus').textContent='Live updates off'+last;$('liveToggle').textContent=left>0?'Stop live':'Start live · 2 min';}
function setLive(on){liveUntil=on?Date.now()+LIVE_MS:0;liveStatus();if(on){monitorLastAt={};pollMonitor();}}
function sampleOnce(){if(monitorBusy)return;monitorBusy=true;api('/monitor').then(drawMonitor).catch(function(){}).finally(function(){monitorBusy=false});}
$('liveToggle').onclick=function(){setLive(Date.now()>=liveUntil);};
function renderStartup(){if(!bootData)return;var q=$('startupSearch').value.toLowerCase(),mode=$('startupFilter').value,flagged=mode!=='all';replaceControls($('startupRows'),groupApps(bootData.apps).filter(function(g){return g.members.some(function(a){return (g.name+' '+a.appId+' '+a.packageId+' '+(a.name||'')).toLowerCase().indexOf(q)>=0&&(mode==='all'||((a.onboot||a.autorestart)&&(mode==='flags'||a.disabled===false)))})}).map(function(g){return '<tr><td>'+groupName(g,expandedBoot[g.key])+'</td><td>'+stateTag(flagState(g.members,'onboot'),flagState(g.members,'onboot')==='On'?'good':flagState(g.members,'onboot')==='Mixed'?'mixed':'off')+mixedCount(g.members,'onboot')+'</td><td>'+stateTag(flagState(g.members,'autorestart'),flagState(g.members,'autorestart')==='On'?'good':flagState(g.members,'autorestart')==='Mixed'?'mixed':'off')+mixedCount(g.members,'autorestart')+'</td><td>'+tag(groupTag(g),g.members.every(function(a){return a.disabled===false}))+'</td></tr>'+(expandedBoot[g.key]&&g.members.length>1?g.members.map(function(a){return componentRow(a,true)}).join(''):'')}).join('')||'<tr><td colspan="4" class="empty">No apps.</td></tr>',['data-group','data-app']);$('serviceRows').innerHTML=bootData.services.filter(function(s){return (s.name+' '+s.description).toLowerCase().indexOf(q)>=0&&(!flagged||ENABLED_RE.test(s.bootState||''))}).map(function(s){return '<tr><td><span class="small-mono">'+esc(s.name)+'</span></td><td>'+tag(s.bootState||'Unknown',ENABLED_RE.test(s.bootState||''))+'</td><td>'+tag(s.active,s.active==='active')+'</td><td>'+esc(s.sub)+'</td></tr>'}).join('')||'<tr><td colspan="4" class="empty">No matching services.</td></tr>';$('serviceNote').textContent=bootData.serviceError?'Services unavailable: '+bootData.serviceError:'System services are read-only. Static ones may start through dependencies.';}
function loadStartup(){return api('/startup').then(function(d){bootData=d;renderStartup()}).catch(function(e){say(e.message)})}
$('startupSearch').oninput=renderStartup;$('startupFilter').onchange=renderStartup;$('refreshStartup').onclick=loadStartup;$('startupRows').onclick=function(e){var g=e.target.closest('[data-group]'),a=e.target.closest('[data-app]');if(g){expandedBoot[g.dataset.group]=!expandedBoot[g.dataset.group];renderStartup()}else if(a)detail(a.dataset.app)};
document.querySelectorAll('[data-startup]').forEach(function(b){b.onclick=function(){bootMode=b.dataset.startup;document.querySelectorAll('[data-startup]').forEach(function(x){x.setAttribute('aria-pressed',x===b?'true':'false')});$('startupApps').hidden=bootMode!=='apps';$('startupServices').hidden=bootMode!=='services';}});

var componentBusy=false,operationEntries=[],operationSeq=0;
function operationUpdate(entry,state,message){
 entry.state=state;entry.message=message;if(state!=='pending'&&entry.toasted!==state){entry.toasted=state;actionToast(entry);}
 $('operationLog').hidden=false;$('operationEmpty').hidden=true;$('actionsCount').hidden=false;$('actionsCount').textContent=operationEntries.length;
 $('operationSummary').textContent='History · '+(operationEntries.some(function(x){return x.state==='pending'})?'in progress':'this session');
 $('operationItems').innerHTML=operationEntries.map(function(x){return '<div class="operation-item" data-state="'+x.state+'"><small>'+esc(x.time)+' · '+esc(x.target)+'</small><br><strong>'+esc(x.label)+' · '+esc(x.state==='pending'?'In progress':x.state==='warning'?'Check result':x.resultLabel||'Confirmed')+'</strong><p>'+esc(x.message)+'</p></div>'}).join('');
 if(selected&&selected.appId===entry.appId&&!$('detail').hidden){var progress=$('componentProgress');if(progress)progress.textContent=message;}
}
var uiOperationBusy={};
function runUiOperation(key,label,target,button,work){
 if(uiOperationBusy[key])return Promise.resolve(false);
 uiOperationBusy[key]=true;
 var oldDisabled=button&&button.disabled,oldText=button&&button.textContent;
 if(button){button.disabled=true;button.textContent='In progress…'}
 var entry={id:++operationSeq,time:new Date().toLocaleTimeString('en-GB'),label:label,target:target},confirmed=null;
 operationEntries.unshift(entry);operationEntries=operationEntries.slice(0,10);
 operationUpdate(entry,'pending','Waiting for the service to confirm the change…');
 function mark(message,resultLabel){confirmed=message;entry.resultLabel=resultLabel||'Confirmed';operationUpdate(entry,'pending',message+' Refreshing the view…')}
 return Promise.resolve().then(function(){return work(mark)}).then(function(result){entry.resultLabel=result.resultLabel||entry.resultLabel;operationUpdate(entry,result.state||'success',result.message);return result.state!=='warning'}).catch(function(e){
  operationUpdate(entry,'warning',confirmed?confirmed+' View refresh failed: '+e.message+'. Refresh the view; do not repeat the command.':'Result not confirmed: '+e.message+'. Read the state before trying again.');return false;
 }).finally(function(){delete uiOperationBusy[key];if(button){button.disabled=oldDisabled;button.textContent=oldText}});
}
function ruleShape(list){return list.map(function(r){return {id:r.id,enabled:r.enabled!==false,trigger:{type:r.trigger.type,value:r.trigger.type==='physical'?String(+r.trigger.value):r.trigger.value,payload:r.trigger.payload==null?null:r.trigger.payload},actions:r.actions.map(function(a){return [a.type,a.appId||null,a.key||null,a.topic||null,a.type==='mqtt'?String(a.payload==null?'':a.payload):null]})}})}
function saveRuleSet(next,label,button){
 return runUiOperation('rules',label,'Remapper',button,function(mark){return api('/remap').then(function(cur){
   if(!Array.isArray(cur.rules))throw Error('Shortcut list unreadable. Nothing was changed.');
   if(JSON.stringify(ruleShape(cur.rules))!==JSON.stringify(ruleShape(rules))){rules=cur.rules;showRules();throw Error('Shortcuts changed on the TV since this page loaded. The list was reloaded; repeat the change.');}
   return api('/remap',{rules:next});
  }).then(function(d){
  if(!Array.isArray(d.rules)||JSON.stringify(ruleShape(d.rules))!==JSON.stringify(ruleShape(next)))throw Error('Returned rules do not match the requested change');
  rules=d.rules;showRules();
  if(d.persisted!==true)return {state:'warning',message:'Saving was not confirmed. Rules may be lost on restart. Saved interception resumes when physical shortcuts are available.'};
  return {resultLabel:'Saved',message:'Rules saved. Saved interception resumes when physical shortcuts are available. Test actions separately. MQTT needs a connected broker.'};
 })});
}
var actionToastTimer=null;
function actionToast(e){var t=$('actionToast');t.textContent=e.label+' · '+e.target+' · '+(e.state==='warning'?'Check result':e.resultLabel||'Confirmed');t.className=e.state==='warning'?'warning':'success';t.hidden=false;clearTimeout(actionToastTimer);actionToastTimer=setTimeout(function(){t.hidden=true},2500)}
function lockComponentControls(){
 var saved=[];['launchApp','toggleApp','bootFlag','restartFlag','stopComponent','uninstallComponent','refreshDetail'].forEach(function(id){var b=$(id);if(b){saved.push({node:b,disabled:b.disabled});b.disabled=true}});
 return function(){saved.forEach(function(x){x.node.disabled=x.disabled})};
}
function componentOutcome(p,r){
 var already=r.changed===false?'Already in the requested state. ':'';
 if(p.action==='disable')return already+'App disabled. Existing processes may keep running until the next launch. This does not confirm a reduction in RAM or CPU usage.';
 if(p.action==='enable')return already+'App enabled. It can be launched; enabling it does not open it.';
 if(p.action==='uninstall')return 'Package removed, including all its components. Reinstall the package to restore it.';
 if(p.action==='stop')return 'No linked processes found after the stop command. The app may start again if requested or if auto restart is on.';
 return already+(p.flag==='onboot'?'Start at boot':'Auto restart')+': '+(p.enabled?'on':'off')+' in the registry. Running processes are unchanged; other components may still start the app.';
}
function factoryOutcome(f){if(!f)return '';if(f.error)return ' The factory test setting could not be checked: '+f.error+'. If the colour test comes back after a restart, use Turn off the factory test in Quick settings.';return ' '+f.message}
function runComponentAction(a,p){
 if(componentBusy)return Promise.resolve(false);
 componentBusy=true;
 var unlock=lockComponentControls(),entry={id:++operationSeq,appId:a.appId,target:(a.name||a.appId)+(p.action==='uninstall'?' · '+a.packageId:''),time:new Date().toLocaleTimeString('en-GB'),label:{disable:'Disable app',enable:'Enable app',stop:'Stop',uninstall:'Uninstall',flags:p.flag==='onboot'?'Start at boot':'Auto restart'}[p.action]};
 operationEntries.unshift(entry);operationEntries=operationEntries.slice(0,10);
 operationUpdate(entry,'pending','Sending the command and checking the TV state…');
 var verified=false,outcome='';
 return api(p.action==='disable'||p.action==='enable'?'/debloat':'/components/action',p.action==='disable'||p.action==='enable'?{action:p.action,appIds:[p.appId]}:p).then(function(r){
  if(r.verified!==true)throw Error('The service did not confirm the requested state.');
  verified=true;outcome=componentOutcome(p,r)+factoryOutcome(r.factoryTest);if(p.action==='uninstall'){closeDetail();}if(r.factoryTest){factoryTestView.state=r.factoryTest.after||null;renderFactoryTest()}
  operationUpdate(entry,'pending',outcome+' Refreshing views…');
  /* Force a post-action sample; inventory and processes can now refresh together. */
  return Promise.all([loadApps(true,true),api('/monitor?refresh=1')]).then(function(r){return drawMonitor(r[1])});
 }).then(function(){operationUpdate(entry,'success',outcome+' App list and processes refreshed.');return true}).catch(function(e){
  inventoryNeedsRefresh=true;if(p.action==='stop'&&String(a.appId).slice(-8)==='AgingApp')loadFactoryTest();
  operationUpdate(entry,'warning',verified?outcome+' State confirmed, but the view could not refresh: '+e.message+'. Refresh the view; do not repeat the command.':'Result not confirmed: '+e.message+'. The command may have taken effect. Refresh the state before trying again.');
  return false;
 }).finally(function(){componentBusy=false;unlock();if(p.action==='uninstall'){delete quickReadAt.keep;delete quickReadAt.uninstall;}   // Quick settings reads its Keep removed count and Uninstall list again
  if(selected&&!$('detail').hidden){var fresh=inventory.find(function(r){return r.appId===a.appId});if(fresh)detail(fresh.appId);}operationUpdate(entry,entry.state,entry.message)});
}
function confirmComponentAction(a,p,label,message,trigger){
 if(componentBusy)return;
 var panel=$('componentConfirmation');panel.hidden=false;
 panel.innerHTML='<h3>'+esc(label)+'</h3><p>'+esc(message)+'</p><div class="drawer-actions"><button id="cancelComponentAction">Cancel</button><button id="confirmComponentAction">'+esc(label)+'</button></div>';
 $('cancelComponentAction').onclick=function(){panel.hidden=true;panel.innerHTML='';if(trigger)trigger.focus()};
 $('confirmComponentAction').onclick=function(){if(this.disabled)return;this.disabled=true;panel.hidden=true;panel.innerHTML='';return runComponentAction(a,p)};
 $('cancelComponentAction').focus();if(panel.scrollIntoView)panel.scrollIntoView({block:'nearest'});
}
function launchComponent(a,confirmed,button){return runUiOperation('component-launch','Open app',a.name||a.appId,button,function(){return api('/apps/launch',confirmed?{appId:a.appId,confirmed:true}:{appId:a.appId}).then(function(){return {resultLabel:'Requested',message:'Launch requested. Check the TV to see if the app opened.'}})})}
/* #135: hotel, shop and factory apps can switch on a mode meant for shops or service centres. The service also refuses them without confirmed:true. */
function confirmLaunch(a,trigger){
 if(componentBusy)return;
 var panel=$('componentConfirmation');panel.hidden=false;
 panel.innerHTML='<h3>Open a hotel, shop or factory app?</h3><p>'+esc(a.name||a.appId)+' may leave the TV in hotel, shop or factory mode after a restart or factory reset. Vetro may be unable to turn it off. Open it only if you know what it does.</p><div class="drawer-actions"><button id="cancelComponentAction">Cancel</button><button id="confirmComponentAction">Open anyway</button></div>';
 $('cancelComponentAction').onclick=function(){panel.hidden=true;panel.innerHTML='';if(trigger)trigger.focus()};
 $('confirmComponentAction').onclick=function(){if(this.disabled)return;this.disabled=true;panel.hidden=true;panel.innerHTML='';return launchComponent(a,true,$('launchApp'))};
 $('cancelComponentAction').focus();if(panel.scrollIntoView)panel.scrollIntoView({block:'nearest'});
}
function bindComponentControls(a){
 function act(p){return runComponentAction(a,p)}
 $('toggleApp').onclick=function(){if(this.disabled)return;var p={action:a.disabled?'enable':'disable',appId:a.appId};if(a.disabled)return act(p);return confirmComponentAction(a,p,'Confirm disable','Disable '+(a.name||a.appId)+'? Existing processes may keep running. '+(a.dependents&&a.dependents.length?'Declared dependents: '+a.dependents.length+'.':''),this)};
 $('bootFlag').onchange=function(){return act({action:'flags',appId:a.appId,flag:'onboot',enabled:this.checked})};
 $('restartFlag').onchange=function(){return act({action:'flags',appId:a.appId,flag:'autorestart',enabled:this.checked})};
 $('stopComponent').onclick=function(){if(this.disabled)return;return confirmComponentAction(a,{action:'stop',appId:a.appId},'Confirm stop','Stop '+(a.name||a.appId)+'? Auto restart may start it again.',this)};
 $('uninstallComponent').onclick=function(){if(this.disabled)return;var siblings=inventory.filter(function(r){return r.packageId===a.packageId});return confirmComponentAction(a,{action:'uninstall',appId:a.appId},'Confirm uninstall','Uninstall package '+a.packageId+' and all '+siblings.length+' of its components? This removes '+siblings.map(function(r){return r.name||r.appId}).join(', ')+'. Reinstall the package to restore it.',this)};
 $('launchApp').onclick=function(){if(this.disabled)return;if(a.launchRisk==='confirm')return confirmLaunch(a,this);return launchComponent(a,false,this)};
 $('refreshDetail').onclick=function(){var button=this;button.disabled=true;return refreshAppsAndMonitor().then(function(){var row=inventory.find(function(r){return r.appId===a.appId});if(row)detail(a.appId);else{closeDetail();say('Component is no longer installed.')}}).catch(function(e){var progress=$('componentProgress');if(progress)progress.textContent='Refresh failed: '+e.message}).finally(function(){button.disabled=false})};
}
var dnsDirty=false;
function dnsState(d){quickData.dns=d;quickReadAt.dns=Date.now();renderQuick();$('dnsEnabled').checked=d.enabled;$('dnsEnabled').disabled=!d.enabled&&!d.domains.length;if(!dnsDirty)$('dnsDomains').value=d.domains.join('\\n');$('dnsStatus').textContent=d.applied?'Filter applied on TV · '+d.domains.length+' domains'+(d.namespaceWarnings&&d.namespaceWarnings.length?' · '+d.namespaceWarnings.length+' inaccessible namespaces':''):d.enabled?'Filter configured, but not applied':'Filter off';$('dnsResolvers').textContent='Current DNS servers (read-only): '+d.resolvers.join(' · ');}
function loadDns(){api('/dns').then(dnsState).catch(function(e){$('dnsStatus').textContent=e.message})}
function domainButtons(domains){return domains.map(function(d){return '<button data-domain="'+esc(d)+'">+ '+esc(d)+'</button>'}).join(' ');}
$('dnsCandidates').innerHTML=${JSON.stringify(require('./blocklist.js').publicGroups())}.map(function(g){return '<div class="dns-group"><h4>'+esc(g.label)+'</h4><p class="section-note">'+esc(g.note)+'</p>'+domainButtons(g.hosts)+'</div>'}).join('');
['dnsCandidates','dnsObserved'].forEach(function(id){$(id).onclick=function(e){var b=e.target.closest('[data-domain]');if(!b)return;var list=$('dnsDomains').value.split(SPACES_RE).filter(Boolean);if(list.indexOf(b.dataset.domain)<0)list.push(b.dataset.domain);$('dnsDomains').value=list.join('\\n');dnsDirty=true;}});
$('dnsEnabled').onchange=function(){return setDns(this.checked)};
$('dnsDomains').oninput=function(){dnsDirty=true};
$('mqttTls').onchange=function(){$('mqttCaField').hidden=!this.checked};
$('saveDns').onclick=function(){var p={action:'apply',enabled:$('dnsEnabled').checked,domains:$('dnsDomains').value.split(SPACES_RE).filter(Boolean)};
return runUiOperation('dns','DNS blocking','TV hosts',this,function(mark){return api('/dns',p).then(function(d){
 var expected=p.domains.map(function(x){return x.toLowerCase().trim()}).filter(function(x,i,a){return a.indexOf(x)===i}).sort();
 if(d.enabled!==p.enabled||!Array.isArray(d.domains)||JSON.stringify(d.domains.slice().sort())!==JSON.stringify(expected))throw Error('Filter configuration not confirmed');
 dnsDirty=false;dnsState(d);
 var message=p.enabled?'Configuration saved. System hosts: '+(d.applied?'filter detected':'filter not detected')+'.':'Filter disabled. System hosts: '+(d.applied?'filter still detected':'filter not detected')+'.';
 var warnings=(d.namespaceWarnings||[]).length,partial=p.enabled!==d.applied||warnings>0;
 return {state:partial?'warning':'success',resultLabel:'State read',message:message+(warnings?' '+warnings+' inaccessible namespaces.':'')+' Some apps bypass DNS blocking with cached addresses or their own DNS.'};
})});};
$('observeDns').onclick=function(){var b=this;b.disabled=true;$('dnsObserved').textContent='Observing requests…';api('/dns',{action:'observe'}).then(function(d){$('dnsObserved').innerHTML=d.domains.length?domainButtons(d.domains):'No UDP DNS requests observed during this capture.'}).catch(function(e){$('dnsObserved').textContent=e.message}).finally(function(){b.disabled=false})};
document.querySelectorAll('[data-mode]').forEach(function(b){b.onclick=function(){switchPanel(b.dataset.mode)}});
var mqttLoaded=false,mqttPolling=false,mqttPending=null;
function loadMqtt(strict){if(mqttPolling){if(strict)return mqttPending.then(function(){return loadMqtt(true)});return mqttPending}mqttPolling=true;return mqttPending=api('/mqtt').then(function(d){var c=d.config||{},x=d.status||{};if(!mqttLoaded){$('mqttEnabled').checked=!!c.enabled;$('mqttHost').value=c.host||'';$('mqttPort').value=c.port||(c.tls?8883:1883);$('mqttUser').value=c.username||'';$('mqttPrefix').value=c.topicPrefix||'vetro';$('mqttDevice').value=c.deviceName||'Vetro';$('mqttTls').checked=!!c.tls;$('mqttCaField').hidden=!c.tls;$('mqttCa').value=c.ca||'';mqttLoaded=true;}$('mqttCredential').textContent=c.hasPassword?'Password saved; it is not sent back to this page':'No password saved';var names={disabled:'Off',connecting:'Connecting',connected:'Connected to broker',reconnecting:'Reconnecting'};$('mqttState').textContent=(names[x.state]||'State unavailable')+(x.lastError?' · '+x.lastError:'');$('mqttStats').textContent=(x.identity?'Device '+x.identity+' · '+(x.identityPersistent?'saved identity':'temporary identity')+' · ':'')+(x.availabilityTopic?'Availability: '+x.availabilityTopic+' · ':'')+(x.sent||0)+' sent · '+(x.received||0)+' messages received'+(x.connectedAt?' · connected since '+new Date(x.connectedAt).toLocaleTimeString('en-GB'):'');$('mqttSubscriptions').innerHTML=(x.subscriptions||[]).map(function(s){return '<p><code>'+esc(s.topic)+'</code> · '+esc({active:'Subscribed',pending:'Awaiting confirmation',refused:'Refused'}[s.status])+'</p>'}).join('');$('mqttLog').innerHTML=(x.events||[]).slice().reverse().slice(0,12).map(function(e){return '<div>'+new Date(e.ts).toLocaleTimeString('en-GB')+' · '+esc(e.message)+'</div>'}).join('')||'No connection events yet.';return d;}).catch(function(e){$('mqttState').textContent=e.message;if(strict)throw e}).finally(function(){mqttPolling=false;mqttPending=null})}
$('saveMqtt').onclick=function(){var p={enabled:$('mqttEnabled').checked,host:$('mqttHost').value.trim(),port:Number($('mqttPort').value),username:$('mqttUser').value,topicPrefix:$('mqttPrefix').value,deviceName:$('mqttDevice').value,tls:$('mqttTls').checked,ca:$('mqttCa').value};if($('mqttClearPassword').checked)p.password='';else if($('mqttPassword').value)p.password=$('mqttPassword').value;
return runUiOperation('mqtt','Home Assistant configuration','Home Assistant',this,function(mark){return api('/mqtt',p).then(function(d){
 if(!d.config||d.config.enabled!==p.enabled)throw Error('Configuration save not confirmed');
 $('mqttPassword').value='';$('mqttClearPassword').checked=false;
 var state=(d.status||{}).state,message='Configuration saved. '+(state==='connected'?'Connected to the broker.':state==='disabled'?'Home Assistant connection is off.':'Broker connection not confirmed. Check the Connection panel.');
 mark(message,'Saved');return loadMqtt(true).then(function(){return {resultLabel:'Saved',message:message+' Saving does not confirm message delivery to Home Assistant.'}});
})});};
$('mqttActionType').onchange=function(){$('mqttAppField').hidden=this.value!=='launch';$('mqttKeyField').hidden=this.value!=='key';$('mqttPublishFields').hidden=$('mqttPayloadField').hidden=this.value!=='mqtt'};
function renderMqttRules(){$('mqttRules').innerHTML=rules.map(function(r){return '<div class="rule"><span><code>'+esc(r.trigger.type+' / '+r.trigger.value)+'</code>'+(r.trigger.payload!=null?' · required payload':'')+' → '+r.actions.map(function(a){return esc(a.type==='mqtt'?'MQTT '+a.topic:a.type==='launch'?a.appId:a.key)}).join(', ')+' · '+(r.enabled?'On':'Off')+'</span><button data-mqtt-toggle="'+esc(r.id)+'">'+(r.enabled?'Turn off':'Turn on')+'</button><button class="danger" data-mqtt-delete="'+esc(r.id)+'">Delete rule</button></div>';}).join('')||'No rules yet. Choose a trigger and an action above, then select Add rule.';}
$('mqttRules').onclick=function(e){var id=e.target.dataset.mqttDelete||e.target.dataset.mqttToggle;if(!id)return;var next=rules.filter(function(r){return !e.target.dataset.mqttDelete||r.id!==id}).map(function(r){return r.id===id&&e.target.dataset.mqttToggle?Object.assign({},r,{enabled:!r.enabled}):r});return saveRuleSet(next,e.target.dataset.mqttDelete?'Delete rule':'Rule state',e.target)};
$('saveMqttRule').onclick=function(){var type=$('mqttTriggerType').value,trigger={type:type,value:$('mqttTrigger').value.trim()},kind=$('mqttActionType').value;if(type==='mqtt'&&$('mqttMatch').value)trigger.payload=$('mqttMatch').value;var action=kind==='launch'?{type:kind,appId:$('mqttTarget').value}:kind==='key'?{type:kind,key:$('mqttKey').value}:{type:kind,topic:$('mqttOutput').value.trim(),payload:$('mqttPayload').value};var next=rules.concat([{id:'rule_'+Date.now(),enabled:true,trigger:trigger,actions:[action]}]);return saveRuleSet(next,'Add rule',this)};
setInterval(function(){if(currentPanel==='mqtt'&&!document.hidden)loadMqtt()},3000);
var tvSettingsData=null,settingBusy=false,settingsSection='picture',catalogData=null,catalogValues={},catalogError=null,privacyData=null,hbbtvData=null,privacyError=null;
function settingDisplay(x){return x.error?'Unavailable':x.value==null?'Unknown':x.boolean?(x.value?'On':'Off'):x.options&&x.options[x.value]?x.options[x.value]:x.coded?'Code '+x.value:x.value;}
function settingNote(x){return (x.hint?'<div class="muted">'+esc(x.hint)+'</div>':'')+(x.access==='firmware'?'<div class="muted">Reported as supported by this TV.</div>':'');}
function settingEdit(x){if(!x.writable)return '<span class="muted">'+esc(x.error||x.readOnlyReason||'Read-only')+'</span>';if(x.options)return '<select id="setting-'+x.id+'" aria-label="'+esc(x.label)+'">'+x.options.map(function(o,i){return '<option value="'+i+'" '+(x.value===i?'selected':'')+'>'+esc(o)+'</option>';}).join('')+'</select><button data-setting="'+x.id+'" '+(settingBusy?'disabled':'')+'>Save</button>'+settingNote(x);if(x.boolean)return '<select id="setting-'+x.id+'" aria-label="'+esc(x.label)+'"><option value="0" '+(x.value===0?'selected':'')+'>Off</option><option value="1" '+(x.value===1?'selected':'')+'>On</option></select><button data-setting="'+x.id+'" '+(settingBusy?'disabled':'')+'>Save</button>'+settingNote(x);return '<input type="number" id="setting-'+x.id+'" aria-label="'+esc(x.label)+'" min="'+x.min+'" max="'+x.max+'" step="1" value="'+x.value+'"><button data-setting="'+x.id+'" '+(settingBusy?'disabled':'')+'>Save</button>'+settingNote(x);}
function settingsList(pairs,q){return '<dl>'+pairs.filter(function(p){return !q||(p[0]+' '+(p[1]==null?'':p[1])).toLowerCase().indexOf(q)>=0}).map(function(p){return '<dt>'+esc(p[0])+'</dt><dd>'+esc(p[1]==null||p[1]===''?'Unknown':p[1])+'</dd>'}).join('')+'</dl>';}
function renderNetworkSettings(n,q){var a=n.active||{},v4=a.ipv4||{},v6=a.ipv6||{},v6c=a.ipv6Configured||{},type={ethernet:'Ethernet · wired',wifi:'Wi-Fi'},state={ready:'Connected',online:'Connected · Internet checked by ConnMan',idle:'Disconnected',association:'Associating',configuration:'Configuring',failure:'Error',disconnect:'Disconnected'},method={dhcp:'Automatic · DHCP',manual:'Manual',auto:'Automatic',off:'Off'};
function dnsNames(list){return (list||[]).map(function(x){return x==='ipv4.dhcp'?'From IPv4 DHCP':x==='ipv6.unknown'?'IPv6 origin not reported':x;}).join(' · ');}
var pairs=[['Connection',type[a.type]||a.type],['State',state[a.state]||a.state],['Active interface',a.interface],['MAC address',a.mac],['IPv4 · method',method[v4.Method]||v4.Method],['IPv4 address',v4.Address],['Subnet mask',v4.Netmask],['Gateway IPv4',v4.Gateway],['DHCP server',v4.DHCPServerIP],['DHCP lease duration',v4.DHCPLeaseDuration==null?null:v4.DHCPLeaseDuration+' s'],['IPv6 · method',method[v6.Method]||v6.Method],['IPv6 address',v6.Address?v6.Address+'/'+v6.PrefixLength:null],['Gateway IPv6',v6.Gateway||v6c.Gateway||((n.defaultRoutes6||[]).find(function(r){return r.interface===a.interface})||{}).gateway],['System DNS servers',(n.resolvers||[]).join(' · ')],['ConnMan DNS servers',dnsNames(a.nameservers)],['Configured DNS in ConnMan',dnsNames(a.nameserversConfigured)],['Proxy',(a.proxy||{}).Method==='direct'?'Direct connection · no proxy':(a.proxy||{}).Method],['Auto connect',a.autoConnect==null?null:a.autoConnect?'On':'Off'],['MTU',a.mtu],['mDNS',a.mdns==null?null:a.mdns?'On':'Off']];
if(q&&!pairs.some(function(p){return (p[0]+' '+(p[1]==null?'':p[1])).toLowerCase().indexOf(q)>=0})&&!(n.interfaces||[]).some(function(i){return (i.name+' '+i.mac+' '+i.addresses.map(function(x){return x.address}).join(' ')).toLowerCase().indexOf(q)>=0}))return '';
var cards='<div class="panel"><h2>Active connection</h2>'+settingsList(pairs,q)+(n.configurationError?'<p class="notice">'+esc(n.configurationError)+'</p>':'')+'<p class="notice">Network settings are read-only here.</p><div class="row"><button id="settingsToDns">Open DNS blocking</button></div></div>';
var interfaces=(n.interfaces||[]).filter(function(i){return !q||(i.name+' '+i.mac+' '+i.state+' '+i.addresses.map(function(x){return x.address}).join(' ')).toLowerCase().indexOf(q)>=0;});
if(interfaces.length)cards+='<div class="panel"><h2>Available interfaces</h2><div class="table-wrap settings-table"><table><thead><tr><th>Interface</th><th>Connection</th><th>MAC</th><th>Addresses</th></tr></thead><tbody>'+interfaces.map(function(i){return '<tr><td>'+esc(i.name)+(i.name===a.interface?' · active':'')+'</td><td>'+esc({UP:'On',DOWN:'Disconnected',DORMANT:'Waiting',UNKNOWN:'Unknown'}[i.state]||i.state)+'</td><td>'+esc(i.mac)+'</td><td>'+i.addresses.map(function(x){return esc(x.address)+' <span class="muted">'+esc(x.scope)+'</span>';}).join('<br>')+'</td></tr>';}).join('')+'</tbody></table></div><p class="notice">Network passwords are not read.</p></div>';
return cards;}
function renderTVSettings(){if(settingsSection==='privacy'){renderPrivacy();return;}if(settingsSection==='catalog'){renderCatalog();return;}if(!tvSettingsData)return;var d=tvSettingsData,q=$('settingSearch').value.toLowerCase().trim(),names={picture:'Picture',audio:'Audio',advanced:'Advanced picture'},html='';
Object.keys(names).forEach(function(g){if(!q&&settingsSection!==g)return;var rows=d.items.filter(function(x){return x.group===g&&(!q||(x.label+' '+names[g]).toLowerCase().indexOf(q)>=0);});if(!rows.length)return;html+='<div class="panel"><h2>'+names[g]+'</h2><div class="table-wrap settings-table"><table><thead><tr><th>Setting</th><th>Value</th><th>Edit</th></tr></thead><tbody>'+rows.map(function(x){return '<tr><td>'+esc(x.label)+'</td><td>'+esc(settingDisplay(x))+'</td><td>'+settingEdit(x)+'</td></tr>';}).join('')+'</tbody></table></div></div>';});
if(settingsSection==='audio'&&!q)html+='<div class="panel"><h2>Volume and mute</h2><div class="row"><button data-audio-key="XF86AudioLowerVolume">Volume −</button><button data-audio-key="XF86AudioRaiseVolume">Volume +</button><button data-audio-key="XF86AudioMute">Toggle mute</button></div><p class="notice">Sends native volume keys; the current level is not shown.</p></div>';
if(settingsSection==='network'&&!q||q){html+=renderNetworkSettings(d.network||{},NETWORK_QUERY_RE.test(q)?'':q);}
if(!q&&settingsSection==='sources'||q&&SOURCES_QUERY_RE.test(q))html+='<div class="panel"><h2>Inputs · TV / HDMI</h2><p class="notice">TV and HDMI input selection is not available yet.</p></div>';
if(!q&&settingsSection==='device'||q&&DEVICE_QUERY_RE.test(q)){var labels={model:'Series',realModel:'Model',firmware:'Firmware',modelCode:'Model code',localSet:'Region',smartHubServer:'Smart Hub server',platformVersion:'Tizen version'};html+='<div class="panel"><h2>TV information</h2>'+settingsList(Object.keys(d.device||{}).map(function(k){return [labels[k]||k,d.device[k]];}),q)+'</div>';}
$('settingGroups').innerHTML=html||'<p class="empty">No matching settings.</p>';if($('settingsToDns'))$('settingsToDns').onclick=function(){switchPanel('dns')};
$('settingStatus').textContent=d.error||('Read at '+new Date(d.ts).toLocaleTimeString('en-GB')+' · '+d.items.length+' values · '+d.items.filter(function(x){return x.writable}).length+' editable. '+d.scope);}
document.querySelectorAll('[data-settings-mode]').forEach(function(b){b.onclick=function(){settingsSection=b.dataset.settingsMode;$('settingSearch').value='';document.querySelectorAll('[data-settings-mode]').forEach(function(x){x.setAttribute('aria-pressed',x===b?'true':'false')});if(settingsSection==='catalog')loadCatalog();else if(settingsSection==='privacy')loadPrivacy();else renderTVSettings();};});
// Settings and controls has two levels: the groups (tabs) and, inside the ones that have several, the sections.
var settingsGroupModes={sound:['picture','audio'],network:['network','sources'],privacy:['privacy'],device:['device','advanced','catalog'],keys:[]};
function showSettingsGroup(g){var modes=settingsGroupModes[g]||[];document.querySelectorAll('[data-settings-group]').forEach(function(t){var on=t.dataset.settingsGroup===g;t.setAttribute('aria-selected',on?'true':'false');t.tabIndex=on?0:-1});$('settingsBody').hidden=g==='keys';$('settingsKeys').hidden=g!=='keys';$('settingsModes').hidden=modes.length<2;document.querySelectorAll('[data-settings-mode]').forEach(function(b){b.hidden=modes.indexOf(b.dataset.settingsMode)<0});if(g!=='keys'&&modes.indexOf(settingsSection)<0){var first=document.querySelector('[data-settings-mode="'+modes[0]+'"]');if(first)first.onclick()}}
document.querySelectorAll('[data-settings-group]').forEach(function(t){t.onclick=function(){showSettingsGroup(t.dataset.settingsGroup)}});
$('settingsGroups').onkeydown=function(e){var tabs=[].slice.call(document.querySelectorAll('[data-settings-group]')),i=tabs.indexOf(document.activeElement),n=e.key==='ArrowRight'?i+1:e.key==='ArrowLeft'?i-1:e.key==='Home'?0:e.key==='End'?tabs.length-1:null;if(n===null||i<0)return;e.preventDefault();var next=tabs[(n+tabs.length)%tabs.length];next.focus();showSettingsGroup(next.dataset.settingsGroup)};
// About Vetro: a native dialog (focus is kept inside it and Escape closes it).
function closeAbout(){var d=$('aboutDialog');if(d.close)d.close();else d.removeAttribute('open')}
// The photo is decoded when About first opens, not with every page load.
var ABOUT_PHOTO=${JSON.stringify(aboutPhoto)};
$('aboutBtn').onclick=function(){if(navOpen())setNav(false);var ph=document.querySelector('.about-photo');if(ph&&!ph.getAttribute('src'))ph.setAttribute('src',ABOUT_PHOTO);$('aboutVersion').textContent=$('appVersion').textContent;var d=$('aboutDialog');if(d.showModal)d.showModal();else d.setAttribute('open','');$('aboutClose').focus()};
$('aboutClose').onclick=closeAbout;
$('aboutDialog').onclick=function(e){if(e.target===this)closeAbout()};

function loadTVSettings(strict){if(!strict&&settingsSection==='privacy')return loadPrivacy();if(!strict&&settingsSection==='catalog')return loadCatalog();return api('/tv-settings').then(function(d){if(strict&&d.error)throw Error(d.error);tvSettingsData=d;renderTVSettings();return d}).catch(function(e){$('settingStatus').textContent=e.message;if(strict)throw e})}
$('settingSearch').oninput=renderTVSettings;$('refreshSettings').onclick=function(){return loadTVSettings()};
function loadPrivacy(strict){privacyError=null;return Promise.all([api('/privacy'),api('/hbbtv')]).then(function(d){privacyData=d[0];hbbtvData=d[1];renderPrivacy();renderQuick();}).catch(function(e){privacyError=e.message;renderPrivacy();if(strict)throw e;});}
function renderPrivacy(){if(settingsSection!=='privacy')return;function word(v,yesText,noText){return v==null?'Unknown':v?yesText:noText;}$('settingStatus').textContent=privacyError||'Privacy state from the TV. Consents are read-only.';if(!privacyData){$('settingGroups').textContent=privacyError||'Reading privacy state…';return;}var d=privacyData,h=hbbtvData||{},pairs=[['HbbTV app',word(d.hbbtv.appRunning,'Running','Not running')],['HbbTV stored value',h.value],['Saved previous value',h.restoreValue],['Do Not Track value',d.doNotTrack],['ACR recognition',d.acr.recognitionStatus],['Advertising ID',word(d.adId.psidPresent,'Present','Not present')],['TV Plus consent',word(d.tvPlusConsent,'Given','Not given')]];$('settingGroups').innerHTML='<div class="panel"><h2>Privacy and HbbTV</h2>'+(h.value!=null?hbbtvSwitch(h):'')+settingsList(pairs,'')+'<p class="notice">Applies your HbbTV choice and reloads HbbTV. Check the red button on the TV afterwards.</p></div><div class="panel"><h2>Reported consents</h2>'+(d.agreementsAvailable===true?settingsList((d.agreements||[]).map(function(x){return [x.id,word(x.agreed,'Given','Not given')];}),''):'<p>Consent state unavailable.</p>')+'<p class="notice">'+esc(d.scope)+'</p></div>';}
function loadCatalog(){catalogError=null;return api('/tv-menu').then(function(d){catalogData=d;renderCatalog();}).catch(function(e){catalogError=e.message;renderCatalog();});}
function renderCatalog(){if(settingsSection!=='catalog')return;var q=$('settingSearch').value.toLowerCase().trim();$('settingStatus').textContent=catalogError||'Storage keys and provider controls use different access methods.';if(!catalogData){$('settingGroups').textContent=catalogError||'Reading catalog…';return;}var rows=catalogData.items.filter(function(x){return !q||(x.id+' '+x.group+' '+x.vconfKey+' '+x.provider).toLowerCase().indexOf(q)>=0;});$('settingGroups').innerHTML='<div class="panel"><h2>TV catalog · '+rows.length+' entries</h2><p class="notice">Some entries open TV panels or need a provider. Values are read one at a time.</p><div class="table-wrap settings-table"><table><thead><tr><th>Entry / group</th><th>Value / state</th><th>Source / access</th></tr></thead><tbody>'+rows.map(function(x){var v=catalogValues[x.id],status=v&&v.status||x.readStatus,readable=x.readable!==false&&status!=='storage-missing',label=v&&v.error?'Read failed: '+v.error:status==='provider-required'?(x.capability==='tv-panel'?'TV panel':'Requires a TV provider'):status==='storage-missing'?'Not available in storage':v&&v.value!=null?v.value:'Not read',access=x.capability==='tv-panel'?'TV panel · open on the TV':status==='provider-required'?'Provider access unavailable':status==='storage-missing'?'Storage key missing':(status==='storage-readable'?'Storage readable':'Not read')+' ';return '<tr><td>'+esc(x.id)+'<br><span class="muted">'+esc(x.group||'Group not declared')+'</span></td><td>'+esc(label)+(readable?' <button data-catalog-id="'+esc(x.id)+'">Read value</button>':'')+'</td><td>'+esc(x.vconfKey)+'<br><span class="muted">'+esc(x.provider||'Provider not declared')+' · '+access+(x.danger?' · Protected setting':'')+'</span></td></tr>';}).join('')+'</tbody></table></div></div>';}

$('settingGroups').onchange=function(e){if(e.target.dataset&&e.target.dataset.hbbtvSwitch!=null)return setHbbtv(e.target.checked);};
$('settingGroups').onclick=function(e){var c=e.target.closest('[data-catalog-id]');if(c){c.disabled=true;var id=c.dataset.catalogId;api('/tv-menu?id='+encodeURIComponent(id)).then(function(d){catalogValues[id]=d;}).catch(function(e){catalogValues[id]={error:e.message};}).finally(renderCatalog);return;}var audio=e.target.closest('[data-audio-key]');if(audio){k(audio.dataset.audioKey);return;}var b=e.target.closest('[data-setting]');if(!b||settingBusy)return;var x=tvSettingsData.items.find(function(x){return x.id===b.dataset.setting}),v=Number($('setting-'+x.id).value);if(!$('setting-'+x.id).value.trim()||!Number.isInteger(v)||v<x.min||v>x.max){say('Allowed value: '+x.min+'–'+x.max);return}settingBusy=true;return runUiOperation('settings','Change setting',x.label,b,function(mark){return api('/tv-settings',{id:x.id,value:v,expected:x.value}).then(function(d){if(d.verified!==true||d.id!==x.id||d.value!==v)throw Error('Requested value not confirmed');var message=x.label+': '+d.previous+' → '+d.value+' read from the TV. Applies to the current source. Apps and HDR can change the context.';mark(message,'Value read back');return loadTVSettings(true).then(function(){return {resultLabel:'Value read back',message:message}})}).catch(function(e){return loadTVSettings().catch(function(){}).then(function(){throw e})});}).finally(function(){settingBusy=false;renderTVSettings()});};
// --- Quick settings: shared state with the Debloater, DNS blocking and TV settings ---
var quickGroups=${JSON.stringify(quickGroups)},quickState=${quickStateFn.toString()};
var restoreView={plan:null,error:null,result:null,confirm:false,eraseConfirm:false,erased:null,loading:false};
var quickData={dns:null,leftovers:null,leftoversError:null,hbbtvError:null,wins:null,winsError:null,root:null},quickBusy=false,quickConfirm=null,leftoverConfirm=false;
// Every Quick settings switch is a win: on means it is applied, off puts the TV back. Memory figures were measured on a Q80A.
var launcherEnabled=null;
var groupTitles={'tracking-all':'Disable advertising and tracking services','voice-all':'Disable all voice assistants',alexa:'Disable Alexa',google:'Disable Google Assistant',bixby:'Disable Bixby',voice:'Disable the other voice services','samsung-home':'Disable Samsung Home'};
var winCopy={
 hbbtv:{title:'Disable HbbTV',desc:'Stops the red-button app and the service that restarts it, now and after every restart.',
  detail:'Turns HbbTV off, disables its service app and stops both after a restart. Turning this off restores the previous menu value, enables the service app and starts both. Service disable by zabique.'},
 multiscreen:{title:'Disable Multi View autostart',desc:'Multi View stops loading in the background; it still opens, a little slower the first time.',
  detail:'Stops Multi View now and prevents it from loading at startup.'},
 ambient:{title:'Stop Ambient',desc:'Stops Ambient now and after every restart; you can still open it yourself.',
  detail:'Stops Ambient now and after every restart. Switch off to start it again.'},
 telemetry:{title:'Stop viewing-data collection',desc:'Stops screen recognition, key-press logging and usage logs, now and after every restart.',
  detail:'Stops contents-recognition-service (recognises the app, content type and channel on screen), canalysis, pisa-service and adagent-service (analytics and ads), mirroring-recognition-manager, contents-ui-detector-service and contents-ott-detector-service (find thumbnails and app screens in the picture), kpi-logging (key presses), emergency-log-transmitter and devicetracker. canalysis and pisa-service are kept off across restarts with the files their own start-up units check; the rest are stopped again at each boot. data-service collects KPI logs (its configuration lists remote keys, apps, channels, volume and the advertising ID among the sources) and its log endpoints are on lcprd1.samsungcloudsolution.net; other components start it again, so that host is also added to the saved list of the domain filter. What it sends was not inspected, the connection is encrypted. Turn on Enable DNS blocking to apply it. Switch off to start everything again and remove the host if Vetro added it. Some TV features that report back to Samsung, such as targeted suggestions, may stop updating. canalysis also works on logo recognition for HDMI inputs and pisa-service starts feature services and handles ad terms, so source recognition or some consent screens may change; neither was tested.'},
 airplay:{title:'Disable AirPlay',desc:'Stops the AirPlay receiver now and after every restart. Casting from an Apple device to this TV does not work while this is on.',
  detail:'Stops the receiver and AirPlay app and prevents the receiver from starting at boot. Turning this off restarts the receiver. Method by zabique.'},
 keyguides:{title:'Hide remote key guides',desc:'Stops the picture of the remote that pops up on Vol, Play and other keys (\u201cPress Volume: Mute\u201d), now and after every restart.',
  detail:'Samsung\u2019s volume and TV apps show the guide until they note it was seen; on 2024 and later TVs that note is lost at every power-on. Vetro marks the guides as seen now and after each restart. Switch off to let Samsung show them again.'},
 firmware:{title:'Block firmware and software updates',desc:'Samsung is actively trying to block root with remote firmware updates. This stops and masks every update service; turn it on if you do not want to lose root access.',
  detail:'Samsung is actively trying to block root with remote firmware updates; this blocks the whole update stack while it is on, not just the menu toggle: OTA firmware (SWU/OTN: auto-upgrade, verifier, downloader and installer), Web App Service background app/package updates, EMP/app-binary downloads, VD system components, the preview updater and the boot-time apply of an already staged image. The units are stopped and masked at runtime (the firmware image is read-only) and the lock is applied again after every restart, through the AT-HUB boot step built into the firmware where it exists (before the update services can start) and with the Vetro root agent everywhere else; the auto-update and EMP switches are turned off and the download markers removed. USB recovery (swu-standalone) is left working. Turning it off unmasks the units and restores the previous auto-update value. A firmware update that lands anyway replaces everything this does.'},
 quickboot:{title:'Quick boot',desc:'Starts Vetro and the launcher earlier after power-on. Experimental: it may not work on your TV.',
  detail:'Creates the four boot-completion markers the TV waits for at about 10 s, through the same AT-HUB boot step the update lock uses. The vendor update services are left alone and keep failing as before, so the boot targets are not delayed. Measured on a Q80A: Vetro from about 97 s to 28-31 s, the launcher from about 103 s to 42-45 s. It replaces /opt/etc/parseinfo.sh and keeps the vendor copy; a TV without the AT-HUB step cannot use it. On Tizen 6.5 and 9 it also sets the system-default event the user boot waits for; those models are untested. Turning it off restores the vendor script if the update lock is off too. Experimental: tested on a Q80A only; the boot order or another model may differ.'}
};
function fileSize(n){return n==null?'—':n<1048576?number(n/1024,0)+' KiB':number(n/1048576,1)+' MiB'}
function chip(text,kind){return '<span class="state-chip '+(kind||'')+'">'+esc(text)+'</span>'}
function switchMarkup(attrs,on,disabled,label){return '<label class="switch"><input type="checkbox" role="switch" '+attrs+(on?' checked':'')+(disabled?' disabled':'')+' aria-label="'+esc(label)+'"><span>'+(on?'On':'Off')+'</span></label>'}
function quickItem(key,title,desc,state,control,extra,after){return '<div class="quick-item" data-quick-item="'+esc(key)+'"><div><h3>'+esc(title)+'</h3>'+(desc?'<p>'+esc(desc)+'</p>':'')+'<div class="quick-state">'+state+'</div>'+(extra||'')+'</div>'+control+(after||'')+'</div>'}
function winState(id){
 var w=quickData.wins&&quickData.wins.wins[id];return w?w.status:null}
function hbbtvSwitch(h){var on=!h.off,blocked=h.off&&!h.canRestore;return switchMarkup('data-hbbtv-switch',on,settingBusy||blocked,'HbbTV')+(blocked?'<p class="section-note">The previous value was not saved by Vetro. Turn HbbTV on from the TV menu.</p>':'')}
function groupItem(g,compact){
 var s=quickState(g,inventory),rows=s.installed.map(function(id){return inventory.find(function(a){return a.appId===id})});
 var title=compact?g.label:groupTitles[g.id]||'Disable '+g.label;
 var done=s.status==='off';
 var state=!inventory.length?appsChip():s.status==='unavailable'?chip('Not installed on this TV'):s.status==='unknown'?chip('State unavailable · refresh the app list','partial'):done?chip(compact&&s.installed.length===1?'Done':'Done · '+s.installed.length+' component'+(s.installed.length===1?'':'s')+' disabled','on'):s.status==='on'?'':chip('Partly done · '+(s.enabled.length?s.enabled.length+' of '+s.installed.length+' components still enabled':'')+(s.enabled.length&&s.flagged&&s.flagged.length?' · ':'')+(s.flagged&&s.flagged.length?s.flagged.length+' still start'+(s.flagged.length===1?'s':'')+' at boot or restart':''),'partial');
 var homeLocked=g.id==='samsung-home'&&launcherEnabled!==false;
 var disabled=quickBusy||winsBusy||homeLocked||['on','off','partial'].indexOf(s.status)<0;
 if(homeLocked)state+=chip(launcherEnabled?'Turn off the launcher to change Samsung Home':'Reading launcher state…','partial');
 var list=rows.length>(compact?1:0)?'<details><summary>'+rows.length+' component'+(rows.length===1?'':'s')+'</summary><ul class="member-list">'+rows.map(function(a){return '<li><button data-quick-app="'+esc(a.appId)+'">'+esc(a.appId)+'</button>'+chip(a.disabled?'Disabled':'Enabled',a.disabled?'on':'')+(a.disabled&&(a.onboot||a.autorestart)?chip('Startup setting saved','partial'):'')+'</li>'}).join('')+'</ul></details>':'';
 var confirmText=g.confirm?'Samsung’s Home stops now and the Home key no longer opens it. While it is off the TV may not finish starting: turn it back on before you restart or switch off the TV. Map the Home key to your other launcher in the Remapper first. The Custom launcher tab does the same without this risk.':'The microphone button on the remote and voice control stop working'+(g.everything?', and so do Voice Guide (read-aloud) and voice suggestions in search':'')+' until you turn this off again. Running components stop now.';
 var confirm=quickConfirm===g.id&&!homeLocked?'<div class="inline-confirm" role="group" aria-label="Confirm '+esc(title)+'"><p><strong>'+esc(title)+'?</strong> '+esc(confirmText)+'</p><div class="row"><button data-quick-cancel>Cancel</button><button class="primary" data-quick-confirm="'+esc(g.id)+'">'+esc(title)+'</button></div></div>':'';
 return quickItem(g.id,title,compact?'':g.description,state,switchMarkup('data-quick-toggle="'+esc(g.id)+'"',done,disabled,compact?'Disable '+g.label:title),list,confirm);
}
// What a switch in the partial state still lacks. The firmware lock: units masked out of the update units found, and the Auto update value.
function winPartial(id,w){
 if(id==='keyguides')return 'a guide can still show';
 if(id==='quickboot')return 'the early boot step is not installed';
 if(id==='telemetry')return w.running+' service'+(w.running===1?'':'s')+' started again';
 if(id!=='firmware')return 'Samsung started it again';
 var n=w.masked,m=w.units;
 if(m>0&&n>0&&n<m)return n+' of '+m+' update services blocked';
 if(m>0&&!n)return 'no update service blocked'+(w.value===0?', Auto update is off':'');
 return w.value?'Auto update is on':'some update services are still reachable';
}
// Without root no win can be switched (they stop services, mask units, write vconf): no switch, and the firmware card says what
// still protects the TV. With root (or before the root state is known) the switches are as they always were.
var FW_NO_ROOT_STEPS=['Router: deny internet egress for this TV, IPv4 and IPv6. A VLAN without internet is the surest way.',
 'If you need apps, allow only the streaming/CDN hosts you use; any Samsung service you allow can still be an update path.',
 'Log the TV’s DNS queries and flows before the next update window, so the exact endpoint is known.',
 'A firmware file on a USB stick still works for recovery; it needs no network.'];
function winNoRoot(id){
 var c=winCopy[id];
 if(id!=='firmware')return quickItem(id,c.title,c.desc,chip('Root required','partial'),'','<details><summary>What this changes</summary><p>'+esc(c.detail)+'</p></details>');
 return quickItem('firmware','Block firmware and software updates','',chip('Root required','partial'),'',
  '<p class="section-note">Stopping the update services needs root. Without root the only reliable block is the network: give this TV no internet access (IPv4 and IPv6), or put it on a network that cannot reach the internet. Blocking DNS alone is not enough.</p>'+
  '<ol class="fw-steps">'+FW_NO_ROOT_STEPS.map(function(t){return '<li>'+esc(t)+'</li>'}).join('')+'</ol>'+
  '<details><summary>What a firmware update can do</summary><p>Samsung is actively trying to block root with remote firmware updates: a patch can remove root and close the path Vetro uses. Turn this on as soon as root is available. The TV’s own Auto update setting does not stop the background update loop.</p></details>');
}
function winItem(id){
 if(quickData.root===false)return winNoRoot(id);
 var c=winCopy[id],st=winState(id),w=quickData.wins&&quickData.wins.wins[id]||{},busy=quickBusy||winsBusy;
 var state=!quickData.wins?chip(quickData.winsError||'Reading…',quickData.winsError?'partial':''):st==='unknown'?chip('Not available on this TV','partial'):'';
 if(quickData.wins&&st==='on')state=chip(id==='ambient'?'Done · Ambient is stopped':id==='telemetry'?'Done · data-service may still run':id==='airplay'?'Done · AirPlay is stopped':id==='firmware'?'Done · updates are blocked':id==='quickboot'?'Done · boot starts earlier':id==='keyguides'?'Done · the guides count as seen':'Done · Multi View starts when you open it','on');
 if(id==='telemetry'&&st==='on'&&w.dnsBlocked===false)state+=chip('Uploads can resume · turn on Enable DNS blocking','partial');
 if(st==='partial')state=chip('Partly done · '+winPartial(id,w),'partial');
 if(st==='off'&&w.running)state=chip('Running now','');
 if(id==='quickboot')state=chip('Experimental · may not work on this TV','partial')+state;
 var control=quickData.wins&&st&&st!=='unknown'?switchMarkup('data-win-switch="'+id+'"',st==='on',busy,c.title):'';
 return quickItem(id,c.title,c.desc,state,control,'<details><summary>What this changes</summary><p>'+esc(c.detail)+'</p></details>');
}
function hbbtvItem(){
 var h=hbbtvData,c=winCopy.hbbtv,state='',control='';
 if(!h)state=chip(quickData.hbbtvError||'Reading…',quickData.hbbtvError?'partial':'');
 else{
  var blocked=h.off&&!h.canRestore;
  if(h.off)state=chip('Done · HbbTV and its service are stopped','on');
  else if(h.valueOff)state=chip('Partly done · the menu says Off, but '+(h.running?'the app is still running':h.serviceRunning?'its service can start it again':!h.flag?'the relaunch brake is missing':'its service is not disabled yet'),'partial');
  control=switchMarkup('data-hbbtv-disable',!!h.off,settingBusy||blocked||!!(uninstallView&&uninstallView.busy),c.title)+(blocked?'<p class="section-note">Vetro does not have the previous value. Turn HbbTV on from the TV menu.</p>':'');
 }
 return quickItem('hbbtv',c.title,c.desc,state,control,'<details><summary>What this changes</summary><p>'+esc(c.detail)+'</p></details>');
}
var quickTab='general';
function showQuickTab(id){quickTab=id;quickTabReads(id);document.querySelectorAll('[data-quick-tab]').forEach(function(b){var on=b.dataset.quickTab===id;b.setAttribute('aria-selected',on);b.tabIndex=on?0:-1;var p=$('quickPanel-'+b.dataset.quickTab);if(p)p.hidden=!on})}
$('quickTabs').onclick=function(e){var b=e.target.closest&&e.target.closest('[data-quick-tab]');if(b)showQuickTab(b.dataset.quickTab)};
// Keep removed apps removed (keep-removed.js): a global switch, in the General tab. The idea and the mechanism are zabique’s.
function keepItem(){
 var k=quickData.keep,title='Keep removed apps removed',n=k?k.packages.length:0,state='',control='',extra='';
 if(!k)state=chip(quickData.keepError||'Reading…',quickData.keepError?'partial':'');
 else{
  var src=k.last&&k.last.source&&k.last.source.error;
  state=k.enabled?chip('On · '+n+' app'+(n===1?'':'s')+' on the list','on'):chip(n?'Off · '+n+' app'+(n===1?'':'s')+' saved, not kept off':'Off');
  if(k.enabled&&src)state+=chip('Samsung’s list could not be updated · '+src,'partial');
  if(k.history&&k.history.length)state+=chip('Samsung installed an app again · Vetro removed it again','partial');
  control=switchMarkup('data-keep-switch',k.enabled,quickBusy||winsBusy||keepBusy,title);
  extra=n?'<details><summary>'+n+' app'+(n===1?'':'s')+' on the list</summary><ul class="member-list">'+k.packages.map(function(id){return '<li><span class="small-mono">'+esc(id)+'</span><button data-keep-allow="'+esc(id)+'"'+(keepBusy?' disabled':'')+'>Allow again</button></li>'}).join('')+'</ul></details>':'';
 }
 return quickItem('keep-removed',title,'Apps you uninstall here or in Apps and processes stay off the TV. Select Allow again before installing one again.',state,control,
  extra+'<details><summary>What this changes</summary><p>'+esc('Vetro adds listed apps to Samsung’s removal list and removes any it finds reinstalled every 10 minutes. Select Allow again before reinstalling. Only apps removed after you turn the switch on are added. Turning it off removes Vetro’s entries from Samsung’s list.')+'</p></details>');
}
var keepBusy=false;
function setKeep(action,packages){
 if(quickBusy||winsBusy||keepBusy)return;keepBusy=true;renderQuick();
 var label=action==='enable'?'Keep removed apps removed':action==='disable'?'Undo · Keep removed apps removed':'Allow removed app again';
 // The service answers {ok:false, enabled, packages} when the switch was saved but Samsung's list was not updated: api() throws on it, the state is in e.data.
 return runUiOperation('keep',label,'Quick settings',null,function(mark){return api('/keep-removed',{action:action,packages:packages}).then(null,function(e){var d=e&&e.data;if(!d||typeof d.enabled!=='boolean')throw e;if(!Array.isArray(d.packages))d.packages=quickData.keep&&quickData.keep.packages||[];d.ok=false;return d}).then(function(d){
  quickData.keep=d;quickReadAt.keep=Date.now();
  var message=action==='enable'?'On: apps you remove from now on stay off the TV.':action==='disable'?'Off: the ids Vetro added are taken out of Samsung’s list; the saved list of apps is kept.':'Allowed again: Samsung may install '+String((packages||[])[0]||'this app')+' again.';
  if(d.ok===false){var why=d.last&&d.last.source&&d.last.source.error||d.error||'Samsung’s list could not be updated';return {state:'warning',resultLabel:'Saved, not applied',message:message+' But '+why+'.'};}
  mark(message,'State read back');
  return {resultLabel:'State read back',message:message};
 })}).finally(function(){keepBusy=false;renderQuick();});
}
function loadKeep(){quickData.keepError=null;return api('/keep-removed').then(function(d){if(typeof d.enabled!=='boolean'||!Array.isArray(d.packages))throw Error('Keep removed unreadable');quickData.keep=d;quickReadAt.keep=Date.now();}).catch(function(e){quickData.keepError=e.message;}).finally(renderQuick);}
function renderQuick(){
 if(!$('quickTracking'))return;
 renderRestore();
 var d=quickData.dns;
 var dnsOn=!!(d&&d.enabled),dnsNoDomains=!!d&&!d.domains.length;
 var dns=quickItem('dns','Enable DNS blocking','Blocks the saved ad and tracking domains. DNS servers stay unchanged.',
  !d?chip('Reading…'):d.enabled&&!d.applied?chip('Saved as on, not applied','partial'):dnsOn?chip('Done · '+d.domains.length+' domain'+(d.domains.length===1?'':'s')+' blocked','on'):chip(dnsNoDomains?'No domains saved':d.domains.length+' domain'+(d.domains.length===1?'':'s')+' saved'),
  d?switchMarkup('data-dns-switch',dnsOn,quickBusy||uiOperationBusy.dns||dnsNoDomains&&!dnsOn,'Enable DNS blocking'):'',
  dnsNoDomains?'<div class="quick-actions"><button data-quick-open="dns">Add domains</button></div>':'');
 // Ambient: screend, Samsung’s screen daemon, is stopped around the kill so that it does not start the app again.
 // A group marked onlyInstalled (Vision AI: 2024 and later TVs only) shows only on a TV that has its apps.
 paint($('quickMemory'),hbbtvItem()+winItem('multiscreen')+winItem('ambient')+winItem('airplay')+quickGroups.filter(function(g){return g.section==='memory'&&!(g.onlyInstalled&&quickState(g,inventory).status==='unavailable')}).map(function(g){return groupItem(g)}).join(''));
 // Apps you don't use: only the ones on this TV; none on it, no group.
 var appGroups=quickGroups.filter(function(g){return g.section==='apps'&&quickState(g,inventory).status!=='unavailable'});
 $('quickAppsGroup').hidden=!appGroups.length;paint($('quickApps'),appGroups.map(function(g){return groupItem(g,true)}).join(''));
 paint($('quickKeep'),keepItem());
 renderUninstall();
 paint($('quickControl'),winItem('firmware')+winItem('quickboot')+winItem('keyguides'));
 paint($('quickTracking'),winItem('telemetry')+quickGroups.filter(function(g){return g.section==='tracking'}).map(function(g){return groupItem(g)}).join('')+dns);
 paint($('quickVoice'),quickGroups.filter(function(g){return g.section==='voice'}).map(function(g){return groupItem(g)}).join(''));
 renderCustom();
 var l=quickData.leftovers,files=l?l.files.filter(function(f){return f.isPackage}):[],extras=l&&l.extras||[],kinds=l&&l.extraKinds||{};
 var groups=[];if(files.length)groups.push({label:'Install packages',count:files.length,bytes:l.packageBytes,names:files.map(function(f){return {n:f.name,s:f.size}})});
 Object.keys(kinds).forEach(function(k){groups.push({label:kinds[k].label,count:kinds[k].count,bytes:kinds[k].bytes,names:extras.filter(function(f){return f.kind===k}).map(function(f){return {n:f.path.split('/').slice(-3).join('/'),s:f.size}})})});
 var total=groups.reduce(function(n,g){return n+g.bytes},0),items=groups.reduce(function(n,g){return n+g.count},0);
 var lstate=quickData.leftoversError?chip(quickData.leftoversError,'partial'):!l?chip('Reading…'):items?chip(items+' item'+(items===1?'':'s')+' · '+fileSize(total)+' can be cleared','partial'):chip('Nothing to clear');
 var free=l&&l.storageBefore?'<p>Free storage: '+memory(l.storageBefore.availableBytes)+'.</p>':'';
 var skipped=l&&l.appsUnreadable?'<p class="section-note">The list of running apps could not be read, so app caches and Prime Video pictures were left out.</p>':'';
 var listing=groups.length?'<details><summary>Show what would go</summary>'+groups.map(function(g){return '<h4>'+esc(g.label)+' · '+g.count+' · '+fileSize(g.bytes)+'</h4><ul class="member-list">'+g.names.slice(0,40).map(function(f){return '<li><span class="small-mono">'+esc(f.n)+'</span><span class="muted">'+fileSize(f.s)+'</span></li>'}).join('')+(g.names.length>40?'<li class="muted">and '+(g.names.length-40)+' more</li>':'')+'</ul>'}).join('')+'</details>':'';
 var confirm=leftoverConfirm&&items?'<div class="inline-confirm" role="group" aria-label="Confirm cleanup"><p><strong>Delete '+items+' item'+(items===1?'':'s')+' ('+fileSize(total)+')?</strong> '+groups.map(function(g){return esc(g.label)+': '+g.count}).join(' · ')+'. Installed apps and their data are not affected. You need the original file to install deleted packages again; apps rebuild their caches when you open them, so the first start can be slower.</p><div class="row"><button data-leftovers-cancel>Cancel</button><button class="primary" data-leftovers-confirm>Delete</button></div></div>':'';
 paint($('quickStorage'),'<div class="quick-item" data-quick-item="leftovers"><div><h3>Clear leftovers</h3><p>Deletes installer files, old network logs and caches of apps that are not running, never settings or logins.</p>'+free+skipped+'<div class="quick-state">'+lstate+'</div>'+listing+'<div class="quick-actions"><button data-leftovers-clear '+(items&&!quickBusy&&!winsBusy?'':'disabled')+'>Clear leftovers</button><button data-leftovers-refresh>Refresh</button></div></div>'+confirm+'</div>');
}
function loadLeftovers(){quickData.leftoversError=null;return api('/leftovers').then(function(d){if(!Array.isArray(d.files))throw Error('Staging folder unreadable');quickData.leftovers=d;quickReadAt.leftovers=Date.now();}).catch(function(e){quickData.leftoversError=e.message;}).finally(renderQuick);}
var winsSeq=0;
function loadWins(){var mine=++winsSeq;quickData.winsError=null;
 // Without root the wins cannot be read (503): the root agent is asked about first, and nothing privileged is called while it is down.
 // The first read waits for the page's own /status answer, so a TV without root is never asked for the wins at all.
 var first=quickData.root===false?api('/status').then(function(d){quickData.root=!!(d.agent&&d.agent.connected)}):quickData.root===null&&statusRead?statusRead:Promise.resolve();
 return first.then(function(){if(quickData.root===false)return;return api('/wins').then(function(d){if(!d.wins)throw Error('Quick wins unreadable');if(mine===winsSeq){quickData.wins=d;quickData.root=true;quickReadAt.wins=Date.now()}})}).catch(function(e){if(mine===winsSeq)quickData.winsError=e.message;}).finally(renderQuick);}
/* #135: AgingApp can leave db/FactoryApp/Aging at 1; the TV then starts the colour test at every boot. Shown only when it reads exactly 1. */
var factoryTestView={state:null,busy:false,message:''};
function renderFactoryTest(){var b=$('factoryTestBanner');if(!b)return;var v=factoryTestView,on=!!v.state&&v.state.active===true;
 if(!on&&!v.message){b.hidden=true;paint(b,'');return}
 b.hidden=false;
 paint(b,on?'<p><strong>The factory colour test is switched on.</strong> The TV starts Samsung’s AgingApp at every boot, and the volume bar may stay hidden. A factory reset may not clear it. Turn it off here, then restart the TV.</p>'+(v.message?'<p>'+esc(v.message)+'</p>':'')+'<div class="row"><button class="primary" data-factory-reset '+(v.busy?'disabled':'')+'>Turn off the factory test</button></div>':'<p>'+esc(v.message)+'</p>');
}
function loadFactoryTest(){return api('/factory-test').then(function(d){factoryTestView.state=d;quickReadAt.factory=Date.now()}).catch(function(){factoryTestView.state=null}).finally(renderFactoryTest)}
function resetFactoryTest(){
 if(factoryTestView.busy)return;factoryTestView.busy=true;factoryTestView.message='';renderFactoryTest();
 return runUiOperation('factory-test','Turn off the factory test','TV',null,function(mark){return api('/factory-test',{action:'reset'}).then(function(d){factoryTestView.state=d.after||null;factoryTestView.message=d.message;return {resultLabel:d.changed?'Checked on the TV':'No change',message:d.message}})})
  .then(function(ok){if(!ok&&!factoryTestView.message)factoryTestView.message='The factory test could not be turned off. Check the operation log, then try again.'}).finally(function(){factoryTestView.busy=false;renderFactoryTest()});
}
var pairingData=null,pairingError=null,pairingBusy=false,pairingConfirm=false,pairingStep=null,pairingMsg='';
// Pairing is automatic by default (since the republished 0.5.0): off until the TV app has been seen, then on. Turning it on from a browser that is not paired yet first pairs that browser with a
// code shown on the TV: if the TV cannot show the code, pairing stays off and nobody is locked out of the dashboard.
function renderPairingMode(){
 var d=pairingData,on=!!(d&&d.enabled),confirm='';
 var waiting=!!(d&&!on&&d.mode==='auto'),auto=!!(d&&on&&d.mode==='auto');
 var warning=d&&!on?'<p class="quick-callout" role="status">'+(waiting?'Pairing is waiting for the Vetro app on the TV. Until then, anyone':'Pairing is off. Anyone')+' on your home network can use the dashboard and API, including root commands, without a code. Turn it on if you do not trust everyone on your network.</p>':'';
 if(pairingConfirm==='off')confirm='<div class="inline-confirm" role="group" aria-label="Confirm turning pairing off"><p><strong>Turn pairing off?</strong> Anyone on your network can control the TV and run root commands without a code or token. Pairing stays off after restart. Paired devices are kept.</p><div class="row"><button data-pairing-cancel>Cancel</button><button class="primary" data-pairing-confirm>Turn pairing off</button></div></div>';
 else if(pairingConfirm==='on'&&d&&d.paired)confirm='<div class="inline-confirm" role="group" aria-label="Confirm turning pairing on"><p><strong>Turn pairing on?</strong> Browsers and scripts that are not paired will need a 6-digit code shown on the TV. This browser is already paired.</p><div class="row"><button data-pairing-cancel>Cancel</button><button class="primary" data-pairing-confirm>Turn pairing on</button></div></div>';
 else if(pairingConfirm==='on')confirm='<div class="inline-confirm" role="group" aria-label="Pair this browser, then turn pairing on"><p><strong>Turn pairing on?</strong> Enter the 6-digit code shown on the TV to pair this browser. If no code appears, open Vetro on the TV and try again.</p>'+
  (pairingStep?'<div class="row"><input id="pairingCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000" aria-label="Code shown on the TV"><button class="primary" data-pairing-code>Pair and turn on</button><button data-pairing-cancel>Cancel</button></div>':'<div class="row"><button class="primary" data-pairing-start>Show a code on the TV</button><button data-pairing-cancel>Cancel</button></div>')+
  (pairingMsg?'<p role="status" aria-live="polite">'+esc(pairingMsg)+'</p>':'')+'</div>';
 paint($('quickPairing'),'<div class="quick-item"><div><h3>Require pairing</h3><p>Browsers and scripts need a 6-digit code from the TV to use the dashboard and API.</p><div class="quick-state">'+(pairingError?chip(pairingError,'partial'):!d?chip('Reading…'):chip(on?(auto?'Pairing on (automatic)':'Pairing on'):waiting?'Pairing waiting for the TV':'Pairing off',on?'on':'warn'))+'<button data-pairing-refresh'+(pairingBusy?' disabled':'')+'>Refresh</button></div><details><summary>Automatic mode</summary><p>Pairing turns on after Vetro runs on the TV. On or Off overrides automatic mode. Paired devices stay paired.</p></details></div>'+switchMarkup('data-pairing-enabled',on,pairingBusy||!d||!!pairingError,'Require pairing')+'</div>'+warning+confirm);
}
function loadPairingMode(){return api('/pairing-mode').then(function(d){if(typeof d.enabled!=='boolean')throw Error('Pairing state unavailable');pairingData=d;pairingError=null;quickReadAt.pairing=Date.now();}).catch(function(e){pairingError=e.message;}).finally(renderPairingMode);}
function setPairingMode(enabled){
 if(pairingBusy)return;pairingBusy=true;pairingConfirm=false;pairingStep=null;pairingMsg='';renderPairingMode();
 return runUiOperation('pairing-mode',enabled?'Turn pairing on':'Turn pairing off','Dashboard access',null,function(mark){return api('/pairing-mode',{enabled:enabled}).then(function(d){if(d.enabled!==enabled)throw Error('Pairing mode was not confirmed');pairingData=d;var message=enabled?'Pairing on. Unpaired devices must pair with a code shown on the TV.':'Pairing off. Devices on your home network can use Vetro without a code.';mark(message,'State read back');return {resultLabel:'State read back',message:message};});}).finally(function(){pairingBusy=false;renderPairingMode();});
}
function startPairingOn(){
 pairingMsg='Asking the TV…';renderPairingMode();
 return api('/auth/pair',{name:((typeof navigator!=='undefined'&&navigator.platform)||'Browser')+' dashboard'}).then(function(d){pairingStep={id:d.id};pairingMsg='Enter the 6-digit code shown on the TV. It expires in '+d.expiresIn+' seconds.';},function(e){if(/already on the TV/.test(e.message))pairingStep={id:null};pairingMsg=e.message;}).finally(function(){renderPairingMode();var c=$('pairingCode');if(c&&c.focus)c.focus();});
}
function confirmPairingOn(code){
 return api('/auth/confirm',{id:pairingStep&&pairingStep.id,code:code}).then(function(){if(pairingData)pairingData.paired=true;pairingBusy=false;return setPairingMode(true);},function(e){pairingMsg=e.message;if(/start again/.test(e.message))pairingStep=null;renderPairingMode();});
}
var sdbData=null,sdbError=null,sdbBusy=false,sdbConfirm=false;
function renderSdbAccess(){
 var d=sdbData,can=d&&(d.available||d.enabled),on=d&&d.enabled;
 var state=sdbError?chip(sdbError,'partial'):!d?chip('Reading…'):d.active?chip('LAN access on · port '+d.port,'warn'):d.enabled?chip('Saved on · tunnel unavailable','partial'):chip('LAN access off');
 var confirm=sdbConfirm?'<div class="inline-confirm" role="group" aria-label="Confirm SDB access"><p>Allow developer access from your network? Any device that reaches this port can use SDB to install apps and run shell commands without a pairing code.</p><div class="row"><button data-sdb-cancel>Cancel</button><button class="primary" data-sdb-confirm>Enable LAN access</button></div></div>':'';
 paint($('quickSdb'),'<div class="quick-item"><div><h3>Allow SDB from the local network</h3><p>Turning it on improves compatibility with Apps2Samsung and TV-Store: they reach the TV on port '+esc(d&&d.port||26201)+'. Turning it off disconnects them.</p><div class="quick-state">'+state+'<button data-sdb-refresh'+(sdbBusy?' disabled':'')+'>Refresh</button></div></div>'+switchMarkup('data-sdb-access',!!on,sdbBusy||!can||!!sdbError,'Allow SDB from the local network')+'</div>'+confirm);
}
function loadSdbAccess(){return api('/sdb-access').then(function(d){if(typeof d.enabled!=='boolean'||typeof d.active!=='boolean')throw Error('SDB state unavailable');sdbData=d;sdbError=null;quickReadAt.sdb=Date.now();}).catch(function(e){sdbError=e.message;}).finally(renderSdbAccess);}
function setSdbAccess(on){
 if(sdbBusy)return;sdbBusy=true;sdbConfirm=false;renderSdbAccess();
 return runUiOperation('sdb-access',on?'Enable SDB LAN access':'Disable SDB LAN access','Developer access',null,function(mark){
  return api('/sdb-access',{enabled:on}).then(function(d){sdbData=d;if(d.enabled!==on||d.active!==on)throw Error('SDB access was not confirmed');var message=on?'SDB LAN access enabled.':'SDB LAN access off; network clients disconnected.';mark(message,'State read back');return {resultLabel:'State read back',message:message};});
 }).finally(function(){sdbBusy=false;return loadSdbAccess();});
}
// Quick settings reads only what the tab on screen shows (each read runs commands on the TV), and not again within 30 s
// of a good answer. Refresh buttons and the switches read again at once; force (after Restore) forgets every answer.
var QUICK_FRESH_MS=30000,quickReadAt={},quickReading={};
var QUICK_TAB_READS={general:['leftovers','wins','sdb'],privacy:['wins','dns'],voice:[],memory:['hbbtv','wins'],uninstall:['uninstall','keep'],developer:['pairing']};
var QUICK_READERS={factory:loadFactoryTest,leftovers:loadLeftovers,wins:loadWins,dns:loadQuickDns,hbbtv:loadQuickHbbtv,uninstall:loadUninstall,keep:loadKeep,pairing:loadPairingMode,sdb:loadSdbAccess};
function quickRead(k){
 if(quickReading[k]||quickReadAt[k]&&Date.now()-quickReadAt[k]<QUICK_FRESH_MS)return;
 quickReading[k]=true;Promise.resolve(QUICK_READERS[k]()).catch(function(){}).then(function(){quickReading[k]=false});
}
function quickTabReads(id){(QUICK_TAB_READS[id]||[]).forEach(quickRead)}
function loadQuickHbbtv(){return api('/hbbtv').then(function(d){if(!Number.isInteger(d.value))throw Error('HbbTV state unreadable');hbbtvData=d;quickData.hbbtvError=null;quickReadAt.hbbtv=Date.now();}).catch(function(e){quickData.hbbtvError=e.message;}).finally(renderQuick);}
function loadQuickDns(){return api('/dns').then(function(d){if(!Array.isArray(d.domains))throw Error('Filter state unreadable');dnsState(d);}).catch(function(){renderQuick();});}
function loadQuick(force){
 if(force)quickReadAt={};
 renderQuick();
 if(!inventory.length&&(appsState.state==='error'||appsState.state==='empty'))Promise.resolve(loadApps()).catch(function(){});
 quickRead('factory');   // its banner sits above every tab
 quickTabReads(quickTab);
}
function applyQuick(id,off){
 if(id==='samsung-home'&&launcherEnabled!==false)return;
 var g=quickGroups.filter(function(x){return x.id===id})[0];if(!g||quickBusy||winsBusy)return;quickBusy=true;quickConfirm=null;renderQuick();
 var read=false;   // a change that fails, or whose app list did not come back, reads the list again: the switch must show what the TV has
 return runUiOperation('quick',(off?'Disable ':'Enable ')+g.label,'Quick settings',null,function(mark){return api('/quick',{id:id,off:off}).then(function(d){
  var n=d.changed.length,parts=[g.label+(off?' disabled.':' enabled.'),n?n+' component'+(n===1?'':'s')+' '+(off?'disabled':'enabled')+'; the TV registry confirms it.':'Already in the requested state.'];
  if(off&&d.flagsCleared&&d.flagsCleared.length)parts.push('Start at boot and restart cleared on '+d.flagsCleared.length+' component'+(d.flagsCleared.length===1?'':'s')+'.');
  if(!off&&d.flagsRestored&&d.flagsRestored.length)parts.push('Start at boot and restart put back as they were on '+d.flagsRestored.length+' component'+(d.flagsRestored.length===1?'':'s')+'.');
  if(!off&&d.flagsNotRestored&&d.flagsNotRestored.length)parts.push('Could not put back the startup flags of '+d.flagsNotRestored.join(', ')+'; check them in Apps and processes.');
  if(d.stopped.length)parts.push(d.stopped.length+' running component'+(d.stopped.length===1?'':'s')+' stopped.');
  if(d.stopFailed.length)parts.push('Could not stop: '+d.stopFailed.join(', ')+'.');
  if(d.stopUnconfirmed)parts.push('Running components could not be checked.');
  if(off&&g.microphone&&n)parts.push('Check Home and the remote before relying on this change.');
  if(off&&g.confirm&&n)parts.push('Map the Home key to your other launcher with the Remapper.');
  var message=parts.join(' ');mark(message,'Registry confirmed');
  return loadApps(false,true).then(function(){read=true;if(bootData)loadStartup();return {state:d.stopFailed.length||(d.flagsNotRestored&&d.flagsNotRestored.length)?'warning':'success',resultLabel:'Registry confirmed',message:message}});
 })}).finally(function(){quickBusy=false;renderQuick();if(!read)loadApps(true);});
}
function setHbbtv(on){
 if(!hbbtvData||settingBusy)return;var off=!on,expected=hbbtvData.value;settingBusy=true;renderQuick();
 return runUiOperation('settings',off?'Disable HbbTV':'Enable HbbTV','HbbTV',null,function(mark){return api('/hbbtv',{off:off,expected:expected}).then(function(d){if(d.off!==off||!Number.isInteger(d.value))throw Error('HbbTV state not confirmed');hbbtvData=d;var message='HbbTV '+(off?'off':'on')+'. '+(d.changed===false?'Already in the requested state. ':'')+'Menu value '+expected+' → '+d.value+' read back'+(off?'; the app and its service are stopped':'; the service and the app were started')+'. Check the red button on the TV.';mark(message,'Value read back');return {resultLabel:'Value read back',message:message}}).catch(function(e){return api('/hbbtv').then(function(d){if(Number.isInteger(d.value))hbbtvData=d}).catch(function(){}).then(function(){throw e})})}).finally(function(){settingBusy=false;renderQuick();renderPrivacy();if(currentPanel==='tvsettings'&&privacyData)loadPrivacy();});
}
var winsBusy=false;
function winMessage(id,on,d){
 if(d.changed===false)return winCopy[id].title+': already in the requested state.';
 if(id==='firmware')return on?'Updates blocked: the firmware, app, app-binary and system updaters are stopped and masked, and the lock is applied again after every restart.':('Updates allowed again: the updaters are unmasked'+(d.value!=null?'; Auto update is '+(d.value?'on':'off')+' in the TV menu':'')+'.');
 if(id==='keyguides')return 'Remote key guides '+(on?'hidden: they count as seen now and after every restart.':'back: Samsung shows them again.');
 if(id==='airplay')return 'AirPlay '+(on?'disabled: the receiver stays off after a restart.':'back on: the receiver has restarted.');
 if(id==='multiscreen')return 'Multi View autostart '+(on?'disabled: Multi View is stopped':'back on')+' (read back). '+(on?'Multi View still opens on demand.':'It loads again at the next restart.');
 return 'Ambient autostart '+(on?'disabled: the app is stopped and will be stopped after each restart':'back on: Ambient has started')+'.';
}
function setWin(id,on){
 if(quickBusy||winsBusy||!winCopy[id])return;winsBusy=true;renderQuick();
 // Success is said only when the TV reports the state asked for; a partial or unknown state is a warning. A change that fails reads the switches again.
 // The viewing-data switch also adds or removes a host in the saved DNS list: that list is read again too.
 var want=on?'on':'off',read=false;
 return runUiOperation('wins',(on?'':'Undo · ')+winCopy[id].title,'Quick settings',null,function(mark){return api('/wins',{id:id,on:on}).then(function(d){
  if(!d.status||d.status===want)mark(winMessage(id,on,d),'State read back');
  return api('/wins').then(function(w){winsSeq++;quickData.wins=w;quickReadAt.wins=Date.now();read=true;
   var now=w.wins&&w.wins[id]||{},st=d.status||now.status;
   if(!st||st===want)return {resultLabel:'State read back',message:winMessage(id,on,d)};
   return {state:'warning',resultLabel:st==='partial'?'Partly done':'Not confirmed',message:winCopy[id].title+': '+(st==='partial'?'partly done · '+winPartial(id,now.status?now:d):st==='unknown'?'the state could not be read back':'the TV did not keep the change')+'.'};
  });
 })}).finally(function(){winsBusy=false;renderQuick();if(!read)loadWins();if(id==='telemetry'){delete quickReadAt.dns;loadQuickDns();}});
}
function setDns(on){
 if(!quickData.dns||uiOperationBusy.dns)return;
 // The saved list can change behind the page (the viewing-data switch adds a host to it): send the list the TV holds now.
 return runUiOperation('dns',on?'Turn on DNS blocking':'Turn off DNS blocking','TV hosts',null,function(mark){return api('/dns').then(function(now){if(!Array.isArray(now.domains)||!Array.isArray(now.resolvers))throw Error('Filter state unreadable');quickData.dns=now;quickReadAt.dns=Date.now();return api('/dns',{action:'apply',enabled:on,domains:now.domains})}).then(function(r){if(r.enabled!==on||on&&!r.applied){if(Array.isArray(r.domains)&&Array.isArray(r.resolvers))dnsState(r);throw Error('Filter state not confirmed');}dnsState(r);var message='DNS blocking '+(on?'on · '+r.domains.length+' domains applied on the TV.':'off.');mark(message,'State read back');return {resultLabel:'State read back',message:message}})}).finally(function(){if(quickData.dns)dnsState(quickData.dns);else renderQuick();});
}
function clearLeftovers(){
 if(quickBusy||winsBusy)return;
 leftoverConfirm=false;quickBusy=true;renderQuick();
 return runUiOperation('leftovers','Clear leftovers','TV storage',null,function(mark){return api('/leftovers',{action:'clear'}).then(function(d){
  var n=d.deleted.length+d.extrasDeleted.length,bad=d.failed.length+d.extrasFailed.length;
  var message=n?n+' item'+(n===1?'':'s')+' deleted, '+fileSize(d.freedBytes)+' freed.':'Nothing to delete.';
  if(bad)message+=' '+bad+' could not be deleted.';
  if(d.appsUnreadable)message+=' Skipped app caches and Prime Video pictures. Could not read running apps.';
  if(d.storageBefore&&d.storageAfter)message+=' Free storage: '+memory(d.storageBefore.availableBytes)+' → '+memory(d.storageAfter.availableBytes)+'.';
  mark(message,'Storage read back');quickData.leftovers=d;
  return {state:bad||d.errors.length?'warning':'success',resultLabel:'Storage read back',message:message};
 })}).finally(function(){quickBusy=false;renderQuick();});
}
$('quick').onchange=function(e){var x=e.target,ds=x.dataset||{};
 if(ds.pairingEnabled!=null){if(pairingBusy)return;pairingConfirm=x.checked?'on':'off';pairingStep=null;pairingMsg='';x.checked=!x.checked;renderPairingMode();return}
 if(ds.sdbAccess!=null){if(sdbBusy)return;if(x.checked){x.checked=false;sdbConfirm=true;renderSdbAccess();return}return setSdbAccess(false);}
 if(ds.quickToggle!=null){var g=quickGroups.filter(function(y){return y.id===ds.quickToggle})[0];if(x.checked&&g&&(g.microphone||g.confirm)){x.checked=false;quickConfirm=g.id;renderQuick();var c=document.querySelector('[data-quick-confirm]');if(c)c.focus();return}return applyQuick(ds.quickToggle,x.checked);}
 if(ds.hbbtvDisable!=null)return setHbbtv(!x.checked);
 if(ds.winSwitch!=null)return setWin(ds.winSwitch,x.checked);
 if(ds.keepSwitch!=null)return setKeep(x.checked?'enable':'disable');
 if(ds.dnsSwitch!=null)return setDns(x.checked);
};
$('quick').onclick=function(e){
 if(e.target.dataset&&e.target.dataset.pairingRefresh!=null)return loadPairingMode();
 if(e.target.dataset&&e.target.dataset.pairingCancel!=null){pairingConfirm=false;pairingStep=null;pairingMsg='';renderPairingMode();return}
 if(e.target.dataset&&e.target.dataset.pairingConfirm!=null)return setPairingMode(pairingConfirm==='on');
 if(e.target.dataset&&e.target.dataset.pairingStart!=null)return startPairingOn();
 if(e.target.dataset&&e.target.dataset.pairingCode!=null){var pc=$('pairingCode');return confirmPairingOn(pc?pc.value:'');}
 if(e.target.dataset&&e.target.dataset.sdbRefresh!=null)return loadSdbAccess();
 if(e.target.dataset&&e.target.dataset.sdbCancel!=null){sdbConfirm=false;renderSdbAccess();return}
 if(e.target.dataset&&e.target.dataset.sdbConfirm!=null)return setSdbAccess(true);var b=e.target.closest?e.target.closest('button'):null;if(!b)return;var ds=b.dataset;
 if(ds.quickCancel!=null){var id=quickConfirm;quickConfirm=null;renderQuick();var s=document.querySelector('[data-quick-toggle="'+id+'"]');if(s)s.focus();return}
 if(ds.quickConfirm!=null)return applyQuick(ds.quickConfirm,true);
 if(ds.quickApp!=null)return detail(ds.quickApp);
 if(ds.quickGoto!=null){showQuickTab(ds.quickGoto);var qt=$('qtab-'+ds.quickGoto);if(qt&&qt.focus)qt.focus();return}
 if(ds.uninstallRetry!=null)return loadUninstall();
 if(ds.uninstallAsk!=null){if(quickBusy||uiOperationBusy.uninstall)return;uninstallView.confirm=ds.uninstallAsk;uninstallView.result=null;renderUninstall();var uc=document.querySelector('[data-uninstall-cancel]');if(uc)uc.focus();return}
 if(ds.uninstallCancel!=null){var ui=uninstallView.confirm;uninstallView.confirm=null;renderUninstall();var ub=document.querySelector('[data-uninstall-ask="'+ui+'"]');if(ub)ub.focus();return}
 if(ds.uninstallConfirm!=null)return uninstallApp(ds.uninstallConfirm);
 if(ds.keepAllow!=null)return setKeep('allow',[ds.keepAllow]);
 if(ds.quickOpen!=null)return switchPanel(ds.quickOpen);
 if(ds.leftoversClear!=null){leftoverConfirm=true;renderQuick();var c=document.querySelector('[data-leftovers-confirm]');if(c)c.focus();return}
 if(ds.leftoversCancel!=null){leftoverConfirm=false;renderQuick();return}
 if(ds.leftoversConfirm!=null)return clearLeftovers();
 if(ds.leftoversRefresh!=null)return loadLeftovers();
 if(ds.factoryReset!=null)return resetFactoryTest();
 if(ds.restoreReview!=null)return loadRestorePlan();
 if(ds.restoreAsk!=null){restoreView.confirm=true;renderRestore();var rc=document.querySelector('[data-restore-confirm]');if(rc)rc.focus();return}
 if(ds.restoreCancel!=null){restoreView.confirm=false;renderRestore();return}
 if(ds.restoreConfirm!=null)return runRestore();
 if(ds.eraseAsk!=null){restoreView.eraseConfirm=true;renderRestore();var ec=document.querySelector('[data-erase-confirm]');if(ec)ec.focus();return}
 if(ds.eraseCancel!=null){restoreView.eraseConfirm=false;renderRestore();return}
 if(ds.eraseConfirm!=null)return eraseVetroData();
 if(ds.appsRetry!=null)return loadApps(true);
};

// --- Quick settings → Uninstall (quick-uninstall.js): the service sends only what this TV has and allows; the page shows it as it is. ---
var uninstallView={items:null,error:null,loading:false,confirm:null,busy:null,result:null};
function uninstallSize(n){return typeof n!=='number'||!(n>0)?'':n<1048576?Math.max(1,Math.round(n/1024))+' KB':Math.round(n/1048576)+' MB'}
function loadUninstall(){
 if(uninstallView.busy)return;uninstallView.loading=true;uninstallView.error=null;renderUninstall();
 return api('/quick/uninstall').then(function(d){if(d.error)throw Error(d.error);if(!Array.isArray(d.items))throw Error('The list could not be read.');uninstallView.items=d.items;quickReadAt.uninstall=Date.now()}).catch(function(e){uninstallView.error=e.message}).finally(function(){uninstallView.loading=false;renderUninstall()});
}
function renderUninstall(){
 var box=$('quickUninstall');if(!box)return;var v=uninstallView,items=v.items,r=v.result,html='';
 if(v.error)html='<div class="alert-row" role="alert"><p>'+esc(v.error)+'</p><button type="button" data-uninstall-retry>Retry</button></div>';
 else if(!items)html='<p class="section-note">Reading the TV…</p>';
 else{
  var here=r&&items.some(function(it){return it.id===r.id});
  if(r&&r.ok)html+='<p class="section-note" role="status">'+esc(r.label)+' uninstalled.</p>';
  else if(r&&!here)html+='<div class="alert-row" role="status"><p>'+esc(r.label+': '+r.error+(r.part?' '+r.part:''))+'</p></div>';
  if(!items.length)html+='<p class="section-note">No apps available to uninstall here. <button type="button" class="link-button" data-quick-open="apps">Apps and processes</button> lists every app.</p>';
  else html+='<div class="uninstall-list">'+items.map(function(it){
   var size=uninstallSize(it.size),busy=v.busy===it.id,lock=!!v.busy||quickBusy||winsBusy||keepBusy||!!uiOperationBusy.restore;
   var err=r&&!r.ok&&r.id===it.id?'<p class="row-error" role="status">'+esc(r.error)+(r.part?' '+esc(r.part):'')+'</p>':'';
   var control=busy?'<span class="uninstall-busy" role="status">Uninstalling…</span>':'<button type="button" data-uninstall-ask="'+esc(it.id)+'"'+(lock?' disabled':'')+'>Uninstall</button>';
   var confirm=v.confirm===it.id&&!busy?'<div class="inline-confirm" role="group" aria-label="Confirm uninstalling '+esc(it.label)+'"><p><strong>Uninstall '+esc(it.label)+'?</strong> It is deleted from the TV'+(size?', freeing '+size:'')+'. To have it again, install it from Samsung’s Apps.</p><div class="row"><button type="button" data-uninstall-cancel>Cancel</button><button type="button" class="primary" data-uninstall-confirm="'+esc(it.id)+'">Uninstall '+esc(it.label)+'</button></div></div>':'';
   return '<div class="quick-item" data-quick-item="uninstall-'+esc(it.id)+'"><div class="uninstall-app">'+icon({name:it.label,appId:it.appId,iconPath:!!it.appId,show:true})+'<div><h3>'+esc(it.label)+(size?' <small>'+size+'</small>':'')+'</h3>'+(it.disabled?'<div class="quick-state"><span class="chip">Disabled</span></div>':'')+(it.note?'<p>'+esc(it.note)+'</p>':'')+err+'</div></div>'+control+confirm+'</div>';
  }).join('')+'</div>';
 }
 replaceControls(box,html,['data-uninstall-ask','data-uninstall-cancel','data-uninstall-confirm','data-uninstall-retry']);
}
function uninstallApp(id){
 var it=(uninstallView.items||[]).filter(function(x){return x.id===id})[0];if(!it||uninstallView.busy)return;
 if(quickBusy||winsBusy||keepBusy||uiOperationBusy.restore||uiOperationBusy.uninstall){say('Wait for the current action to finish.');return}
 var label=it.label,total=(it.packages||[]).length||1,answered=false;
 uninstallView.confirm=null;uninstallView.result=null;uninstallView.busy=id;quickBusy=true;renderQuick();
 // A minute per package can pass on a slow TV: never less time than the page gives its longest call.
 var ac=typeof AbortController==='function'?new AbortController():null,timer=ac?setTimeout(function(){ac.abort()},Math.max(API_TIMEOUT_MS,total*60000+30000)):null;
 return runUiOperation('uninstall','Uninstall '+label,'Quick settings',null,function(mark){
  return fetch('/quick/uninstall',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id}),signal:ac?ac.signal:undefined}).then(function(res){return res.json().then(function(d){return {ok:res.ok,d:d||{}}})}).then(function(x){
   var d=x.d;if(Array.isArray(d.items)){answered=true;uninstallView.items=d.items;}
   if(x.ok&&d.ok){var m=label+' uninstalled.';uninstallView.result={id:id,label:label,ok:true};mark(m,'Uninstalled');return {resultLabel:'Uninstalled',message:m}}
   var n=Array.isArray(d.removed)?d.removed.length:0,part=n?'Part of it was removed ('+n+' of '+total+').':'',error=d.error||'The uninstall failed.';
   uninstallView.result={id:id,label:label,ok:false,error:error,part:part};
   return {state:'warning',resultLabel:n?'Partly uninstalled':'Not uninstalled',message:error+(part?' '+part:'')};
  },function(e){
   var error=e&&e.name==='AbortError'?'The TV timed out. Check the refreshed list before retrying.':e.message;
   uninstallView.result={id:id,label:label,ok:false,error:error,part:''};throw Error(error);
  });
 // The answer carries the list as it is afterwards; without it the list is read again. The Keep removed count can change too.
 }).finally(function(){if(timer)clearTimeout(timer);uninstallView.busy=null;quickBusy=false;renderQuick();if(!answered)loadUninstall();loadKeep();
  Promise.resolve(loadApps(true)).catch(function(){});Promise.resolve(loadDock()).catch(function(){});});
}
// Holding Enter on Uninstall must not go on to confirm: a repeated key never presses the confirmation.
document.addEventListener('keydown',function(e){var t=e.target;if(e.repeat&&t&&t.getAttribute&&t.getAttribute('data-uninstall-confirm')!==null)e.preventDefault()});
// --- Restore the TV and Remove Vetro: the plan comes from the service (restore.js); nothing changes until it is confirmed. ---
function restoreChip(state){return state==='changed'?chip('Will be put back','partial'):state==='manual'?chip('Do this yourself','partial'):state==='unknown'?chip('Could not be read','partial'):chip('As before','on')}
function renderRestore(){
 if(!$('quickRestore'))return;
 var v=restoreView,p=v.plan,busy=quickBusy||uiOperationBusy.restore||v.loading;
 var html='<p class="section-note">Restores the changes Vetro recorded after you confirm.</p>';
 if(v.error)html+='<p class="section-note">'+esc(v.error)+'</p>';
 if(p){
  var open=p.items.filter(function(i){return i.state!=='clean'}),clean=p.items.filter(function(i){return i.state==='clean'});
  if(open.length)html+='<ul class="member-list">'+open.map(function(i){return '<li><span><strong>'+esc(i.label)+(i.count?' · '+i.count:'')+'</strong><br><span class="muted">'+esc(i.state==='unknown'?(i.error||'Unavailable'):i.detail)+'</span></span>'+restoreChip(i.state)+'</li>'}).join('')+'</ul>';
  else html+='<p class="section-note">No recorded changes are left to put back.</p>';
  if(clean.length)html+='<details><summary>'+clean.length+' item'+(clean.length===1?'':'s')+' already as before</summary><ul class="member-list">'+clean.map(function(i){return '<li><span>'+esc(i.label)+'</span>'+restoreChip('clean')+'</li>'}).join('')+'</ul></details>';
  html+='<details><summary>What Vetro cannot put back</summary><ul class="member-list">'+p.notes.map(function(n){return '<li><span>'+esc(n)+'</span></li>'}).join('')+'</ul></details>';
 }
 var r=v.result;
 if(r)html+='<h4>Last restore</h4><ul class="member-list">'+r.steps.filter(function(s){return s.status!=='skipped'}).map(function(s){return '<li><span><strong>'+esc(s.label)+'</strong><br><span class="muted">'+esc(s.message)+'</span></span>'+chip(s.status==='done'?'Done':s.status==='manual'?'Do this yourself':'Failed',s.status==='done'?'on':'partial')+'</li>'}).join('')+'</ul>'+(r.complete?'':'<p class="section-note">Some steps failed. Review what remains before retrying.</p>');
 var pending=p?p.pending:0;
 if(v.confirm&&pending)html+='<div class="inline-confirm" role="group" aria-label="Confirm restore"><p><strong>Restore '+pending+' item'+(pending===1?'':'s')+'?</strong> Restores Samsung Home, restarts services Vetro stopped and ends DNS blocking. Vetro keeps running and keeps your settings. It checks each step and continues if one fails.</p><div class="row"><button class="primary" data-restore-confirm>Restore everything</button><button data-restore-cancel>Cancel</button></div></div>';
 else html+='<div class="quick-actions"><button data-restore-review '+(busy?'disabled':'')+'>'+(p?'Review again':'Review what will change')+'</button>'+(pending?'<button class="primary" data-restore-ask '+(busy?'disabled':'')+'>Restore everything…</button>':'')+'</div>';
 paint($('quickRestore'),html);
 renderRemove();
}
function renderRemove(){
 if(!$('quickRemove'))return;
 var v=restoreView,p=v.plan,ready=!!p&&p.pending===0,busy=quickBusy||uiOperationBusy.restore,stepsOpen=$('removeSteps')&&$('removeSteps').open;
 var unread=p?p.items.filter(function(i){return i.state==='unknown'}).map(function(i){return i.label}):[];
 var html='<p class="section-note">Restore the TV first. If a step fails, you can still delete Vetro in step 3.</p><details class="removal-steps" id="removeSteps"'+(stepsOpen?' open':'')+'><summary id="removeStepsToggle">Removal steps</summary><ol class="steps">'
  +'<li><strong>Optional: remove Vetro’s saved data.</strong> Deletes restore values, Remapper rules, MQTT settings, Shards and paired browsers after a restore. This cannot be undone.</li>'
  +'<li><strong>Restart the TV.</strong> This clears the temporary changes and reloads Home.</li>'
  +'<li><strong>Remove the app on the TV.</strong> Open <em>Apps</em>, open settings, select Vetro and choose <em>Delete</em>. Menu names vary by model and year.</li>'
  +'<li><strong>Or with Apps2Samsung.</strong> If the TV menu lacks Delete, use Apps2Samsung on desktop or Android.</li>'
  +'<li><strong>Developer Mode.</strong> If you turned it on only for Vetro, switch it off, or change <em>Host PC IP</em> back, in the same Apps screen.</li>'
  +'<li><strong>Home Assistant.</strong> If you used Home Assistant, delete the TV device there to remove its sensors and controls.</li></ol></details>';
 if(v.erased)html+='<p class="section-note">Vetro’s saved data was removed'+(v.erased.left?' (a few items could not be deleted)':'')+'. Vetro keeps running until you remove the app; browsers stay paired until it restarts.</p>';
 else if(v.eraseConfirm&&ready)html+='<div class="inline-confirm" role="group" aria-label="Confirm removing the data"><p><strong>Delete Vetro’s saved data on the TV?</strong> Deletes restore values, settings, rules, Shards and pairings for good. The launcher is off and recorded changes are restored.'+(unread.length?' <strong>Could not be checked: '+esc(unread.join(', '))+'.</strong> If Vetro changed them, the values needed to restore them will be lost.':'')+'</p><div class="row"><button class="primary" data-erase-confirm>Delete the data</button><button data-erase-cancel>Cancel</button></div></div>';
 else html+='<div class="quick-actions"><button data-erase-ask '+(ready&&!busy?'':'disabled')+'>Remove Vetro’s saved data…</button></div>'+(ready?'':'<p class="section-note">Available after restore. You can delete the app from the TV at any time.</p>');
 replaceControls($('quickRemove'),html,['id','data-erase-ask','data-erase-cancel','data-erase-confirm']);
}
function loadRestorePlan(){
 restoreView.error=null;restoreView.loading=true;renderRestore();
 return api('/restore').then(function(d){restoreView.plan=d}).catch(function(e){restoreView.error=e.message}).finally(function(){restoreView.loading=false;renderRestore()});
}
function runRestore(){
 if(quickBusy||winsBusy||keepBusy||uiOperationBusy.restore){say('Wait for the current action to finish.');return}
 restoreView.confirm=false;quickBusy=true;renderRestore();
 return runUiOperation('restore','Restore the TV','TV',null,function(mark){return api('/restore',{action:'run'}).then(function(d){
  restoreView.result=d;
  var done=d.steps.filter(function(s){return s.status==='done'}).length,bad=d.steps.filter(function(s){return s.status==='failed'}).length;
  var message=done+' step'+(done===1?'':'s')+' done'+(bad?', '+bad+' failed':'')+'.'+(d.complete?' Every recorded change is put back.':' Review again to see what is left.');
  mark(message,'Checked on the TV');
  return Promise.all([api('/restore').then(function(plan){restoreView.plan=plan}).catch(function(){}),loadApps(false,true)]).then(function(){return {state:d.complete?'success':'warning',resultLabel:'Checked on the TV',message:message}});
 })}).finally(function(){quickBusy=false;loadQuick(true)});
}
function eraseVetroData(){
 if(quickBusy||winsBusy||keepBusy||uiOperationBusy.restore){say('Wait for the current action to finish.');return}
 restoreView.eraseConfirm=false;quickBusy=true;renderRestore();
 return runUiOperation('restore','Remove Vetro’s saved data','TV',null,function(mark){return api('/restore',{action:'erase'}).then(function(d){
  restoreView.erased=d;var message='Vetro’s saved data was removed.';mark(message,'Removed');return {resultLabel:'Removed',message:message};
 })}).finally(function(){quickBusy=false;renderRestore()});
}
// --- Launcher: a minimal launcher for the Home key. The service builds its app list from Samsung's Home row. ---
var dockData=null,dockError=null,dockBusy=false,dockConfirm=false,dockTab='vetro',customConfirm=false,customChoice=null,customChosen='';
${require('./dock.js').customCandidate.toString()}
function launcherOn(d){return d.mode?d.mode!=='off':!!d.enabled}
var dockSeq=0;
function loadDock(){var mine=++dockSeq;return api('/dock').then(function(d){if(mine===dockSeq){dockData=d;launcherEnabled=launcherOn(d);dockError=null}}).catch(function(e){if(mine===dockSeq)dockError=e.message}).finally(function(){renderDock();renderQuick();renderUi()})}
function isTizenTube(id){return String(id).toLowerCase().indexOf('tizentube')>=0}
// TizenTube is a sideloaded app. It has a tile when the launcher list has it; it is installed when the TV registry or that list has it.
// "Not installed" is only said once the registry has been read.
function dockHasTizenTube(d){return (d.entries||[]).some(function(e){return isTizenTube(e.appId)})}
function tizenTubeInstalled(d){return dockHasTizenTube(d)||(inventory||[]).some(function(a){return isTizenTube(a.appId)})}
// TV-Store (A2STVStore.Store): the last list the launcher was given says whether it is there, or the TV's app list.
function tvStoreInstalled(d){return !!(d.apps&&d.apps.tvStoreInstalled)||(inventory||[]).some(function(a){return a.appId==='A2STVStore.Store'})}
function previewTile(e,size,pill,sel,sourceImages){var art=/^source:/.test(e.appId)?'&images='+(sourceImages?'1':'0'):'';return '<div class="lp-tile'+(pill?' lp-oval':'')+(sel?' lp-sel':'')+'" style="width:'+(pill?232:size)+'px;height:'+(pill?48:size)+'px;border-radius:'+(pill?'24px':'16%')+'" aria-label="'+esc(e.label)+'">'+(e.slug.indexOf('sample-')===0?esc(e.label.slice(0,2)):'<img alt="'+esc(e.label)+'" src="/dock/icon?slug='+encodeURIComponent(e.slug)+art+'" data-initials="'+esc(e.label.slice(0,2))+'">')+'</div>'}
var sampleRow=[{slug:'sample-1',label:'Netflix'},{slug:'sample-2',label:'YouTube'},{slug:'sample-3',label:'Prime Video'},{slug:'sample-4',label:'Disney+'},{slug:'sample-5',label:'Plex'},{slug:'sample-6',label:'Sport'},{slug:'sample-7',label:'Music'},{slug:'allapps',label:'All apps',system:true},{slug:'samsunghome',label:'Samsung Home',system:true}];
// The launcher over the TV picture, at 1920 x 1080 scaled to its box (fitPreview). extra: more classes (lp-rise: the bar comes up
// from the bottom, for the Overview's slideshow); id: the Launcher tab's own copy.
// The Control center's cards. An older service has only the Task manager switch: it reads as that card alone.
// A Shard's card is named "shard:<plugin id>"; its name is the label the Shard gave (cardShards, from the service).
function cardInfo(c,d){d=d||dockData||{};if(CARD_INFO[c])return CARD_INFO[c];var l=d.cardShards&&d.cardShards[c];return l?{name:l,text:'A Shard adds this card. Press OK to choose a row. If the Shard does not respond, the card says “Not available”.'}:{name:c,text:''}}
var CARD_INFO={tasks:{name:'Task manager',text:'Apps sorted by memory. Press OK to switch, hold OK to close. By zabique.'},audio:{name:'Audio output',text:'Press OK to choose TV speakers or paired Bluetooth audio.'},picture:{name:'Picture mode',text:'Press OK to change Picture mode for this source. Locked in Game mode.'},sleep:{name:'Sleep timer',text:'Samsung’s timer: off, 30, 60, 120 or 180 minutes. The TV warns a minute before.'}};
function dockCards(d){var c=d&&Array.isArray(d.cards)?d.cards:(d&&d.taskManager?['tasks']:[]);if(c.length)keepCards(c);return c}
// The Overview has one switch for the whole Control center: off sends no cards, and on must bring back the cards that were
// chosen (in the Launcher tab), not only the Task manager. The last choice is kept here and in the browser.
var lastCards=null;
function keepCards(c){var t=c.join(',');if(lastCards===t)return;lastCards=t;try{localStorage.setItem('vetro.cards',t)}catch(e){}}
function rememberedCards(){var t=lastCards;if(t===null){try{t=localStorage.getItem('vetro.cards')}catch(e){}}var ch=dockData&&dockData.cardChoices||[],c=String(t||'').split(',').filter(function(x){return CARD_INFO[x]||ch.indexOf(x)>=0});return c.length?c:['tasks']}
function cardsWith(d,card,on){var now=dockCards(d);return (d.cardChoices||['tasks','audio','picture','sleep']).filter(function(c){return c===card?on:now.indexOf(c)>=0})}
function lpMarkup(d,extra,id){
 var real=(d.entries||[]).length>0,all=real?d.entries:sampleRow,apps=all.filter(function(e){return !e.system}),sys=all.filter(function(e){return e.system});
 var row=apps.map(function(e,i){return previewTile(e,i===0&&!d.noMotion?112:92,false,i===0,d.useSourceImages)}).join('')+(sys.length?'<i class="lp-divider"></i>'+'<div class="lp-stack">'+sys.map(function(e){return previewTile(e,92,true,false,d.useSourceImages)}).join('')+'</div>':'');
 var cards=dockCards(d),tasks=cards.length>0,hint=cards.length===1?cardInfo(cards[0],d).name:'Control center';
 return '<div class="lp'+(d.noMotion?' lp-reduced':'')+(tasks?' lp-tasks':'')+(extra?' '+extra:'')+'"'+(id?' id="lp"':'')+' role="img" aria-label="Preview of the launcher over a TV picture"><div class="lp-stage"><div class="lp-scene"></div><div class="lp-bug"><i></i><b>12</b><span>Evening Light HD</span></div><div class="lp-hint">Source ˄</div><div class="lp-pill"><div class="lp-row">'+row+'</div></div>'+(tasks?'<div class="lp-hint lp-hint-below">'+esc(hint)+' ˅</div>':'')+'</div></div>';
}
function previewMarkup(d){
 var real=(d.entries||[]).length>0;
 var note=real?(d.enabled?'This TV’s apps, as the launcher shows them.':'How the launcher will look with this TV’s apps.'):'An example row until the TV’s apps are read.';
 return '<div class="dock-left panel"><h3>Preview</h3><p class="section-note">'+note+'</p>'+lpMarkup(d,'',true)+'</div>';
}
// Every launcher picture on screen (the Launcher tab's and the Overview's) is scaled to its box; one in a hidden slide waits.
var fitTimer=null;
function fitPreview(){
 var all=document.querySelectorAll?document.querySelectorAll('.lp'):[],w=[],k;
 for(k=0;k<all.length;k++)w.push(all[k].clientWidth);   // every width read before any is written: one layout, not one per picture
 for(k=0;k<all.length;k++)fitOne(all[k],w[k]);
}
function fitOne(lp,width){
 if(!lp||!lp.style||!lp.querySelectorAll)return;var cw=width===undefined?lp.clientWidth:width;if(!cw)return;
 var s=cw/1920;if(lp.vetroScale!==s){lp.vetroScale=s;lp.style.setProperty('--s',s);lp.style.height=Math.round(1080*s)+'px'}
 lp.querySelectorAll('.lp-tile img').forEach(function(img){
  function judge(){
   if(img.vetroJudged||!img.parentNode)return;img.vetroJudged=true;   // once per picture: the read-back through a canvas is not free, and this runs at every slide change
   if(img.parentNode.classList.contains('lp-oval'))return;
   try{var w=img.naturalWidth,h=img.naturalHeight,c=document.createElement('canvas');c.width=c.height=32;var x=c.getContext('2d');x.drawImage(img,0,0,32,32);
    var px=x.getImageData(0,0,32,32).data,opaque=0;for(var i=3;i<px.length;i+=4)if(px[i]>200)opaque++;
    var tile=img.parentNode;
    if(Math.abs(w-h)>2){tile.classList.add('lp-wide');tile.style.setProperty('--bg','url('+img.src+')')}
    else if(opaque/1024<0.8)tile.classList.add('lp-loose');
    if(tile.classList.contains('lp-sel')){
     var r=0,g=0,b=0,t=0;
     for(var k=0;k<px.length;k+=4){var a=px[k+3];if(!a)continue;var mx=Math.max(px[k],px[k+1],px[k+2]),mn=Math.min(px[k],px[k+1],px[k+2]),q=(a/255)*(0.15+(mx?(mx-mn)/mx:0))*(mx>40?1:0.2);r+=px[k]*q;g+=px[k+1]*q;b+=px[k+2]*q;t+=q}
     if(t>0)tile.style.setProperty('--glow','rgba('+Math.round(r/t)+','+Math.round(g/t)+','+Math.round(b/t)+',.44)');
    }
   }catch(e){}
  }
  // No picture: a pill keeps its name on one line, a square tile shows two letters (a long name would wrap and spill).
  img.onerror=function(){var tile=img.parentNode;if(!tile)return;tile.classList.add('lp-missing');tile.textContent=tile.classList.contains('lp-oval')?(img.alt||'?'):(img.dataset.initials||'?')};
  if(img.vetroJudged)return;
  if(img.complete){if(img.naturalWidth)judge();else img.onerror();}else img.onload=judge;
 });
}
function renderDock(){
 var box=$('dockBody');if(!box)return;var d=dockData,cbox=$('dockCards');
 if(!d){var wait='<div class="panel"><p class="notice">'+esc(dockError||'Reading…')+'</p></div>';paint(box,wait);paint(cbox,wait);return}
 var state=!d.installed?chip('Not in this package','partial'):d.enabled?(d.running===true?chip('On · running','on'):d.running===false?chip('On · not running','partial'):chip('On · state unknown','partial')):chip('Off');
 var apps=d.apps?'<p class="notice">'+d.apps.count+' app'+(d.apps.count===1?'':'s')+' from Samsung’s Home row.'+(d.apps.skipped&&d.apps.skipped.length?' Left out: '+d.apps.skipped.map(function(x){return esc(x.item.split('@').pop())+' ('+esc(x.reason.toLowerCase())+')'}).join(', ')+'.':'')+'</p>':'';
 var confirm=dockConfirm?'<div class="inline-confirm" role="group" aria-label="Confirm launcher"><p><strong>Turn on the Vetro launcher?</strong> The Home key opens it instead of Samsung’s Home, and Vetro closes Samsung’s Home each time you press it. If the launcher stops, the Home key goes back to Samsung’s Home by itself. Samsung’s <em>Autorun Smart Hub</em> is off while the launcher is on, so the TV does not power on into Samsung’s Home.</p>'+launcherConflictNote('vetro')+'<div class="row"><button data-dock-cancel>Cancel</button><button class="primary" data-dock-confirm>Turn on launcher</button></div></div>':'';
 var control=switchMarkup('data-dock-switch',!!d.enabled,dockBusy||!d.installed||d.mode==='custom','Vetro launcher');
 var problem=d.mode==='custom'?'<div class="quick-callout"><p>'+esc(customName(d.customApp))+' is the current launcher.</p><div class="quick-actions"><button data-launcher-switch="vetro" '+(dockBusy?'disabled':'')+'>Use the Vetro launcher instead</button></div></div>'+launcherSwitchConfirmMarkup('vetro'):d.error?'<p class="quick-callout">'+esc(d.error)+'</p>':d.probeError?'<p class="quick-callout">The launcher state could not be read: '+esc(d.probeError)+'</p>':'';
 var actions='<div class="quick-actions"><button data-dock-reload>Refresh</button>'+(d.enabled?'<button data-dock-rebuild '+(dockBusy?'disabled':'')+'>Rebuild app list</button>':'')+'</div>';
 var log=d.log?'<details><summary>Launcher log</summary><pre class="small-mono">'+esc(d.log)+'</pre></details>':'';
 var main='<div class="quick-item" data-quick-item="launcher"><div><h3>Vetro launcher</h3><p>Home opens the same apps and icons as Samsung Home.</p><div class="quick-state">'+state+'</div>'+apps+problem+actions+log+'</div>'+control+confirm+'</div>';
 var row='<div class="quick-item" data-quick-item="app-row"><div><h3>App row</h3><p>On the TV, hold OK on a tile to move or remove it, or on All apps to add one. New apps join at the end.</p><div class="quick-state">'+(d.rowCustomised?chip('Your own row','on'):chip('Same as Samsung’s Home'))+'</div>'+(d.rowCustomised?'<div class="quick-actions"><button data-dock-reset-row '+(dockBusy?'disabled':'')+'>Use Samsung’s row again</button></div>':'')+'</div></div>';
 var noTube=inventory.length>0&&!tizenTubeInstalled(d),fixState=d.fixTizenTube?chip('On','on'):chip('Off');
 var fix='<div class="quick-item" data-quick-item="fix-tizentube"><div><h3>Fix TizenTube</h3><p>Uses YouTube’s icon for TizenTube and closes Samsung’s YouTube first.</p><div class="quick-state">'+fixState+(noTube?chip('TizenTube is not installed on this TV','partial'):d.enabled&&!dockHasTizenTube(d)?chip('TizenTube is not in Samsung’s Home row','partial'):'')+'</div></div>'+switchMarkup('data-dock-fix',!!d.fixTizenTube,dockBusy||!d.installed||noTube&&!d.fixTizenTube,'Fix TizenTube')+'</div>';
 var tvs=tvStoreInstalled(d),storeOn=tvs&&d.appStore!=='samsung';
 var store='<div class="quick-item" data-quick-item="app-store"><div><h3>TV-Store in All apps</h3><p>The store button in All apps opens TV-Store by <a href="https://apps2samsung.com/" target="_blank" rel="noopener noreferrer">Apps2Samsung</a>. Samsung’s store opens if TV-Store fails.</p><div class="quick-state">'+(storeOn?chip('TV-Store','on'):chip('Samsung’s store'))+(tvs?'':chip('TV-Store is not installed','partial'))+'</div></div>'+switchMarkup('data-dock-store',storeOn,dockBusy||!d.installed||!tvs,'TV-Store in All apps')+'</div>';
 var still='<div class="quick-item" data-quick-item="reduce-motion"><div><h3>Reduce motion</h3><p>Turns off the launcher’s animations.</p><div class="quick-state">'+(d.noMotion?chip('On','on'):chip('Off'))+'</div></div>'+switchMarkup('data-dock-still',!!d.noMotion,dockBusy||!d.installed,'Reduce motion')+'</div>';
 function sourceOption(key,label,description){
  return '<div class="quick-item" data-quick-item="'+key+'"><div><h3>'+label+'</h3><p>'+description+'</p><div class="quick-state">'+chip(d[key]?'On':'Off',d[key]?'on':'')+'</div></div>'+switchMarkup('data-dock-source-option="'+key+'"',!!d[key],dockBusy||!d.installed,label)+'</div>';
 }
 var sourceOptions=sourceOption('showHomeSources','HDMI sources on Home','Copies the HDMI tiles and their positions from Samsung Home.');
 sourceOptions+=sourceOption('useSourceImages','HDMI source images','Uses Samsung’s images for HDMI tiles on the Dock and Sources.');
 var look='<h2 class="section-title" id="dockLookTitle">${sectionIcon('home')}Customization</h2>'+row+store+sourceOptions+still+fix;
 // The preview (a TV picture and the app icons) is drawn again only when it changes; a busy or changed switch redraws the
 // switches beside it, not the pictures.
 var preview=previewMarkup(d),lay=box.firstChild,group=lay&&lay.lastChild,sec=box.lastChild;
 if(box.vetroPreview===preview&&box.vetroFirst===lay&&group&&sec&&sec!==lay){paint(group,main);paint(sec,look)}
 else if(paint(box,'<div class="dock-layout">'+preview+'<div class="quick-group">'+main+'</div></div><section class="quick-group ui-cols" aria-labelledby="dockLookTitle">'+look+'</section>')){
  box.vetroPreview=preview;lay=box.firstChild;group=lay&&lay.lastChild;sec=box.lastChild;
  if(group&&sec){group.vetroHtml=main;group.vetroFirst=group.firstChild;sec.vetroHtml=look;sec.vetroFirst=sec.firstChild}
  setTimeout(fitPreview,0);
 }
 paint(cbox,cardsMarkup(d));
 renderCustom();
}
// The Launcher tab's Control center: its picture beside one switch per card.
function cardsMarkup(d){
 var navUsed=uiRules?uiConflicts(uiRules,UI_TASK_KEYS):[];
 var cards=dockCards(d),maxCards=d.maxCards||3;
 var taskState=(cards.length?chip(cards.length===1?'1 card':cards.length+' cards','on'):chip('Off'))+(cards.length&&d.mode==='custom'?chip('Only in the Vetro launcher','partial'):cards.length&&d.mode==='off'?chip('Needs the Vetro launcher','partial'):'');
 var taskNote=navUsed.length?'<p class="quick-callout">'+(navUsed.length===1?'A shortcut of yours uses ':'Shortcuts of yours use ')+navUsed.map(function(x){return 'Key '+esc(x.label)+' ('+esc(x.code)+') opens '+esc(ruleName(x.rule))}).join('; ')+'. While the remote interception is on, the launcher never gets that key, so the Control center cannot use it.</p>':'';
 var head='<div class="quick-item" data-quick-item="control-center"><div><h3>Control center</h3><p>Down on the apps row opens up to '+maxCards+' cards. Left and Right move, Up or Back returns.</p><div class="quick-state">'+taskState+'</div>'+taskNote+'</div></div>';
 var list=(d.cardChoices||['tasks','audio','picture','sleep']).map(function(c){var info=cardInfo(c,d),on=cards.indexOf(c)>=0;
  return '<div class="quick-item" data-quick-item="card-'+esc(c)+'"><div><h3>'+esc(info.name)+'</h3><p>'+info.text+'</p><div class="quick-state">'+(on?chip('On','on'):chip('Off'))+'</div></div>'+switchMarkup('data-dock-card="'+esc(c)+'"',on,dockBusy||!d.installed||(!on&&cards.length>=maxCards),info.name)+'</div>'}).join('');
 list+=(Array.isArray(d.cardsPaused)?d.cardsPaused:[]).map(function(x){return '<div class="quick-item" data-quick-item="card-paused-'+esc(x.card)+'"><div><h3>'+esc(x.label)+'</h3><p>'+esc(x.why)+'. Your choice is kept: the card comes back with the Shard.</p><div class="quick-state">'+chip('Paused','partial')+'</div></div></div>'}).join('');
 var shot='<div class="dock-left panel"><h3>Preview</h3><div class="tuner-shots"><figure class="tuner-shot">'+osdTasksPreview()+'<figcaption><strong>Control center</strong><span class="tuner-opens">'+remoteKey('pad-down','Down')+' '+remoteKey('pad-ok','OK')+'</span><span>'+(cards.length?'Left and Right move between the cards.':'Shows once a card is on.')+'</span></figcaption></figure></div></div>';
 return '<div class="dock-layout">'+shot+'<div class="quick-group">'+head+list+'</div></div>';
}
function showDockTab(id){
 dockTab=id==='custom'||id==='cards'?id:'vetro';
 document.querySelectorAll('[data-dock-tab]').forEach(function(b){var on=b.dataset.dockTab===dockTab;b.setAttribute('aria-selected',on);b.tabIndex=on?0:-1});
 $('dockBody').hidden=dockTab!=='vetro';$('dockCustom').hidden=dockTab!=='custom';var cb=$('dockCards');if(cb)cb.hidden=dockTab!=='cards';
 if(dockTab==='vetro')fitPreview();
}
function customName(id){var a=(inventory||[]).filter(function(x){return x.appId===id})[0];return a&&a.name?a.name:id}
function renderCustom(){
 var box=$('dockCustom');if(!box)return;var d=dockData;
 if(!d){paint(box,'<div class="panel"><p class="notice">'+esc(dockError||'Reading…')+'</p></div>');return}
 var on=d.mode==='custom',vetroOn=d.mode==='vetro',cur=d.customApp||null;
 var rows=(inventory||[]).filter(customCandidate).sort(function(a,b){return String(a.name||a.appId).localeCompare(String(b.name||b.appId))});
 if(cur&&!rows.some(function(r){return r.appId===cur}))rows.unshift({appId:cur,name:cur});
 var chosen=customChoice&&rows.some(function(r){return r.appId===customChoice})?customChoice:cur||(rows[0]&&rows[0].appId)||'';
 customChosen=chosen;
 var state=!d.installed?chip('Not in this package','partial'):on?(d.running===true?chip('On · running','on'):d.running===false?chip('On · not running','partial'):chip('On · state unknown','partial')):chip('Off');
 var picker=!inventory.length?'<p class="section-note">Reading the app list…</p>':!rows.length?'<p class="section-note">No installed launcher app found. Install one on the TV, then refresh.</p>':'<label class="field"><span>App for the Home key</span><select data-custom-app'+(dockBusy||!d.installed||vetroOn?' disabled':'')+'>'+rows.map(function(r){return '<option value="'+esc(r.appId)+'"'+(r.appId===chosen?' selected':'')+'>'+esc(appLabel(r))+'</option>'}).join('')+'</select></label>';
 var control=switchMarkup('data-custom-switch',on,dockBusy||!d.installed||vetroOn||!chosen,'Custom launcher');
 var change=on&&chosen&&chosen!==cur?'<div class="quick-actions"><button data-custom-change '+(dockBusy?'disabled':'')+'>Use this app</button></div>':'';
 var problem=vetroOn?'<div class="quick-callout"><p>The Vetro launcher is on.</p>'+(chosen?'<div class="quick-actions"><button data-launcher-switch="custom" '+(dockBusy?'disabled':'')+'>Use '+esc(customName(chosen))+' instead</button></div>':'')+'</div>'+launcherSwitchConfirmMarkup('custom'):d.error?'<p class="quick-callout">'+esc(d.error)+'</p>':d.probeError?'<p class="quick-callout">The launcher state could not be read: '+esc(d.probeError)+'</p>':'';
 var confirm=customConfirm&&chosen?'<div class="inline-confirm" role="group" aria-label="Confirm custom launcher"><p><strong>Use '+esc(customName(chosen))+' as the launcher?</strong> Home opens this app, closes Samsung Home and turns off Autorun Smart Hub. If the app keeps failing to start, Home returns to Samsung Home.</p>'+launcherConflictNote('custom')+'<div class="row"><button data-custom-cancel>Cancel</button><button class="primary" data-custom-confirm>Turn on</button></div></div>':'';
 var main='<div class="quick-item" data-quick-item="custom-launcher"><div><h3>Custom launcher</h3><p>Home opens an app you installed. Samsung Home stays enabled.</p><div class="quick-state">'+state+(on&&cur?chip(customName(cur)):'')+'</div>'+picker+change+problem+'</div>'+control+confirm+'</div>';
 var home='<section class="quick-group" aria-labelledby="customHomeTitle"><h2 class="section-title" id="customHomeTitle">${sectionIcon('home')}Samsung Home</h2><p class="section-note">The custom launcher does not need this switch. Turning Samsung’s Home off can stop the TV from finishing its boot: turn it back on before a restart.</p>'+quickGroups.filter(function(g){return g.section==='home'}).map(function(g){return groupItem(g)}).join('')+'</section>';
 paint(box,'<div class="stack"><section class="quick-group">'+main+'</section>'+home+'</div>');
}
function setDock(action,label,extra){
 if(dockBusy)return;dockBusy=true;dockConfirm=false;customConfirm=false;renderDock();renderUi();   // the Overview's and the displays' switches lock too
 return runUiOperation('dock',label,'Launcher',null,function(mark){return api('/dock',Object.assign({action:action},extra||{})).then(function(d){
  dockSeq++;dockData=d;launcherEnabled=launcherOn(d);dockError=null;
  var message=action==='appStore'?'All apps now opens '+(d.appStore==='samsung'?'Samsung’s store':'TV-Store')+(d.enabled?'; the launcher was restarted.':'.'):action==='enableCustom'?'Custom launcher on'+(d.running?' and running':'')+'. Press Home on the remote to open it.':action==='disableCustom'?'Custom launcher off. Home opens Samsung Home.':action==='enable'?'Launcher on'+(d.running?' and running':'')+'. Press Home on the remote to open it.':action==='disable'?'Launcher off. Home opens Samsung Home.':action==='showHomeSources'||action==='useSourceImages'?'Source preference saved; '+(d.enabled?'the launcher was restarted.':'the preview was updated.'):action==='fixTizenTube'?'Fix TizenTube '+(d.fixTizenTube?'on':'off')+(d.enabled?'; the launcher was restarted with the new list.':'; it applies when the launcher is on.'):action==='noMotion'?'Reduce motion '+(d.noMotion?'on':'off')+(d.enabled?'; the launcher was restarted.':'; it applies when the launcher is on.'):action==='resetRow'?'Samsung’s row is back'+(d.enabled?'; the launcher was restarted.':'.'):action==='cards'?'Control center: '+(dockCards(d).length?dockCards(d).map(function(c){return cardInfo(c,d).name}).join(', '):'off')+(d.enabled?'; the launcher was restarted.':d.mode==='custom'?'; it shows in the Vetro launcher only.':'; it applies when the launcher is on.'):action==='volumePill'?'Volume bar '+(d.volumePill?'on.':'off: Samsung’s bar is back.'):action==='numberPad'?'Number pad '+(d.numberPad?'on.':'off: Samsung’s pad is back.'):action==='volumeEdge'?(d.volumeEdge==='hidden'?'The volume bar is hidden: Vol changes the level without a bar':'The volume bar moves to the '+(d.volumeEdge||'left')+' edge')+(d.enabled?'; the launcher was restarted.':'.'):'App list rebuilt and the launcher restarted.';
  mark(message,'Service confirmed');return {state:'success',resultLabel:'Service confirmed',message:message};
 })}).then(function(ok){if(!ok)return loadDock()}).finally(function(){dockBusy=false;renderDock();renderQuick();renderUi();if(action==='enableCustom'||action==='disableCustom')loadApps(true)});
}
var tunerData=null,tunerError=null,tunerBusy=false,tunerSeq=0,tunerConfirm=false;
function loadTuner(withDock){if(!dockData&&!withDock)loadDock();var mine=++tunerSeq;return api('/tuner').then(function(d){if(mine===tunerSeq){tunerData=d;tunerError=null}}).catch(function(e){if(mine===tunerSeq)tunerError=e.message}).finally(function(){renderTuner();renderUi()})}
function renderTuner(){
 var box=$('tunerBody');if(!box)return;var d=tunerData;
 if(!d){paint(box,'<p class="notice">'+esc(uiErr(tunerError||'Reading…'))+'</p>');return}
 var unsupported=d.installed&&d.supported===false;
 var state=!d.installed?chip('Not in this package','partial'):unsupported&&!d.enabled?chip('Not available on this TV','partial'):d.enabled?(d.running===true?chip('On · running','on'):d.running===false?chip('On · not running','partial'):chip('On · state unknown','partial')):chip('Off');
 var problem=unsupported?'<p class="quick-callout">'+esc(d.unsupportedReason||'This TV cannot run the tuner.')+'</p>':d.error?'<p class="quick-callout">'+esc(d.error)+'</p>':d.probeError?'<p class="quick-callout">The tuner state could not be read: '+esc(d.probeError)+'</p>':d.enabled&&d.running===false&&d.failures>0?'<p class="quick-callout">Vetro TV Tuner did not start. It will retry. Samsung’s tuner still works.</p>':'';
 var note=d.installed&&d.samsungTunerFound===false?'<p class="section-note">Samsung’s live TV app is missing. Show tuner now still works.</p>':'';
 var confirm=tunerConfirm?'<div class="inline-confirm" role="group" aria-label="Confirm Vetro TV Tuner"><p><strong>Turn on Vetro TV Tuner?</strong> Vetro’s tuner appears over live TV and starts again after a restart. It covers the TV input only. Teletext stays with Samsung’s live TV app.</p><div class="row"><button data-tuner-cancel>Cancel</button><button class="primary" data-tuner-confirm>Turn on Vetro TV Tuner</button></div></div>':'';
 var control=switchMarkup('data-tuner-switch',!!d.enabled,tunerBusy||!d.installed||(unsupported&&!d.enabled),'Vetro TV Tuner');
 var actions='<div class="quick-actions">'+(d.enabled?'<button data-tuner-show '+(tunerBusy||d.running!==true?'disabled':'')+'>Show tuner now</button>':'')+'<button data-tuner-reload>Refresh</button></div>';
 var log=d.log?'<details><summary>Tuner log</summary><pre class="small-mono">'+esc(d.log)+'</pre></details>':'';
 var tk=tunerKeyConflicts();if(tk.length)problem+='<p class="quick-callout">'+(tk.length===1?'A shortcut of yours uses':tk.length+' shortcuts of yours use')+' a key of the tuner: '+tk.map(function(x){return esc(x.key.label)+' ('+esc(x.key.code)+') opens '+esc(ruleName(x.rule))}).join('; ')+'. While the remote interception is on, '+(tk.length===1?'that key goes':'those keys go')+' to the shortcut, not the tuner. Delete the shortcut in the Remapper to free it.</p>';
 var main='<div class="quick-item" data-quick-item="tuner"><div><h3>Vetro TV Tuner</h3><p>Banner, Channel list, Channel pad and TV guide (EPG) over live TV.</p><div class="quick-state">'+state+'</div>'+problem+note+actions+log+'</div>'+control+confirm+'</div>';
 paint(box,main);
}
function setTuner(action,label,extra){
 if(tunerBusy)return;tunerBusy=true;tunerConfirm=false;renderTuner();renderUi();
 return runUiOperation('tuner',label,'Vetro TV Tuner',null,function(mark){return api('/tuner',Object.assign({action:action},extra||{})).then(function(d){
  if(d&&d.installed!==undefined){tunerSeq++;tunerData=d;tunerError=null}
  var message=action==='enable'?'Vetro TV Tuner on'+(d.running?' and running':'')+'. Open live TV on the TV to see it.':action==='disable'?'Vetro TV Tuner off. Samsung’s tuner is back.':'Sent to the TV.';
  mark(message,'Service confirmed');return {state:'success',resultLabel:'Service confirmed',message:message};
 })}).then(function(ok){if(!ok)return loadTuner()}).finally(function(){tunerBusy=false;renderTuner();renderUi()});
}
// --- Vetro UI: the launcher, live TV and the on-screen displays (volume bar, number pad) as one page with a tab each. ---
// The rules of what depends on what are shared with the service (vetro-ui.js); the pictures of the displays come from osd-page.js.
${require('./vetro-ui.js').pageSource()}
${require('./osd-page.js').pageSource()}
${require('./remote-icons.js').pageSource()}
var TUNER_SLIDES=${JSON.stringify(tunerPage.slides())},UI_GUIDE_SCENE=${JSON.stringify(tunerPage.guide(true))};
// Slideshows: one picture at a time, the next after a few seconds; it waits while the pointer or the focus is on it, and has a pause
// button and a dot per picture. Only a slideshow that is on screen moves. The index survives the re-render of its tab.
var showState={},uiShowKey=null;
function showreel(id,slides,label){
 var st=showState[id]||(showState[id]={i:0,paused:false,at:Date.now()});if(st.i>=slides.length)st.i=0;
 return '<div class="tshow" data-show="'+id+'" data-count="'+slides.length+'" role="group" aria-roledescription="slideshow" aria-label="'+esc(label)+'"><div class="tshow-stage">'+slides.map(function(sl,i){
  return '<figure class="tuner-shot tshow-slide'+(i===st.i?' is-on':'')+'" data-ms="'+(sl.ms||6000)+'"'+(i===st.i?'':' aria-hidden="true"')+'>'+sl.svg+'<figcaption><strong>'+esc(sl.title)+'</strong>'+(sl.keys?'<span class="tuner-opens">'+sl.keys+'</span>':'')+'<span>'+esc(sl.text)+'</span></figcaption></figure>'}).join('')+
  '</div><div class="tshow-bar"><button type="button" class="tshow-pause" data-show-pause aria-pressed="'+(st.paused?'true':'false')+'" aria-label="'+(st.paused?'Play':'Pause')+' the slideshow">'+(st.paused?'<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>':'<svg viewBox="0 0 16 16"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/></svg>')+'</button>'+
  slides.map(function(sl,i){return '<button type="button" class="tshow-dot" data-show-go="'+i+'" aria-label="'+esc(sl.title)+'" aria-current="'+(i===st.i?'true':'false')+'"></button>'}).join('')+'</div></div>';
}
function showGo(box,i){
 var id=box.getAttribute('data-show'),st=showState[id],figs=box.querySelectorAll('.tshow-slide'),dots=box.querySelectorAll('[data-show-go]');if(!st||!figs.length)return;
 st.i=(i+figs.length)%figs.length;st.at=Date.now();
 // The picture shown first is there at once; the next ones fade in.
 for(var k=0;k<figs.length;k++){figs[k].classList.toggle('is-on',k===st.i);figs[k].classList.toggle('is-enter',k===st.i);if(k===st.i)figs[k].removeAttribute('aria-hidden');else figs[k].setAttribute('aria-hidden','true')}
 for(var j=0;j<dots.length;j++)dots[j].setAttribute('aria-current',j===st.i?'true':'false');
 fitPreview();   // a launcher picture is sized once it is shown
}
setInterval(function(){
 if(document.hidden||currentPanel!=='vetroui')return;   // every slideshow is on the Vetro UI page; elsewhere nothing is measured
 var boxes=document.querySelectorAll('.tshow');
 for(var b=0;b<boxes.length;b++){var box=boxes[b],st=showState[box.getAttribute('data-show')];if(!st||st.paused||!box.offsetParent)continue;
  if(box.matches(':hover')||box.matches(':focus-within')){st.at=Date.now();continue}
  var on=box.querySelector('.tshow-slide.is-on'),ms=on?+on.getAttribute('data-ms')||6000:6000;if(Date.now()-st.at>=ms)showGo(box,st.i+1)}
},500);
// The tuner's slideshow (about 50 KB of pictures) is built when its tab first opens; its clock starts now, as before.
showState.tuner={i:0,paused:false,at:Date.now()};
function buildTunerShow(){var b=$('tunerShow');if(b&&!b.firstChild&&!b.innerHTML)b.innerHTML=showreel('tuner',TUNER_SLIDES,'The tuner’s screens')}
document.addEventListener('click',function(e){
 var t=e.target&&e.target.closest?e.target.closest('[data-show-go],[data-show-pause]'):null;if(!t)return;var box=t.closest('.tshow');if(!box)return;
 var st=showState[box.getAttribute('data-show')];if(!st)return;
 if(t.hasAttribute('data-show-go')){showGo(box,+t.getAttribute('data-show-go'));return}
 st.paused=!st.paused;st.at=Date.now();t.setAttribute('aria-pressed',st.paused?'true':'false');t.setAttribute('aria-label',(st.paused?'Play':'Pause')+' the slideshow');
 t.innerHTML=st.paused?'<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>':'<svg viewBox="0 0 16 16"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/></svg>';
});
var uiTab='overview',uiInput=null,uiRules=null,uiInterception=null,launcherSwitchAsk=null,osdAsk=null;
var UI_TABS=['overview','launcher','tuner','osd'];
function showUiTab(id){
 uiTab=UI_TABS.indexOf(id)>=0?id:'overview';
 document.querySelectorAll('[data-ui-tab]').forEach(function(b){var on=b.dataset.uiTab===uiTab;b.setAttribute('aria-selected',on);b.tabIndex=on?0:-1});
 UI_TABS.forEach(function(k){var p=$('uiPanel-'+k);if(p)p.hidden=k!==uiTab});
 if(uiTab==='launcher')setTimeout(fitPreview,0);
 if(uiTab==='tuner')buildTunerShow();
}
var uiInputError=null;   // a failed read is said, not shown as a read still in progress
function loadUiInput(){
 return Promise.all([
  api('/input').then(function(d){uiInput=d;uiInputError=null}).catch(function(e){uiInput=null;uiInputError=e.message||'no answer'}),
  api('/remap').then(function(d){uiRules=Array.isArray(d.rules)?d.rules:[];uiInterception=d.interception||null}).catch(function(e){if(!uiInputError)uiInputError=e.message||'no answer'})
 ]).then(renderUi);
}
function loadVetroUi(){showUiTab(uiTab);return Promise.all([loadDock(),loadTuner(true),loadUiInput()]).then(renderUi)}   // loadTuner(true): the launcher is read here, once (each read is a root command on the TV)
function renderUi(){renderOverview();renderOsd()}
// A bundled part switched off in Vetro Shards answers \u201c... is not running\u201d: say where to turn it back on.
function uiErr(m){return /is not running/.test(String(m))?String(m).split(' is not running')[0]+' is switched off in Vetro Shards. Turn it on there to use this part.':m}
function uiState(d,on){return !d.installed?chip('Not in this package','partial'):on?(d.running===true?chip('On · running','on'):d.running===false?chip('On · not running','partial'):chip('On · state unknown','partial')):chip('Off')}
function ruleName(r){var a=(r.actions||[])[0]||{};return a.type==='launch'?appLabel(inventory.find(function(x){return x.appId===a.appId})||{appId:a.appId}):a.key||a.type||'?'}
function uiNeedNotes(part){
 var d=dockData;if(!d)return '';var n=uiNeeds(part,d,uiInput),out='';
 if(n.indexOf('launcher')>=0)out+=chip('Needs a launcher','partial');
 if(n.indexOf('interception')>=0)out+=chip('Needs the remote interception','partial');
 if(n.indexOf('listening')>=0)out+=chip('Paused: the Remapper is listening','partial');
 var c=uiConflicts(uiRules||[],uiKeysOf(part));if(c.length)out+=chip(c.length+' shortcut'+(c.length===1?'':'s')+' of yours on the same key'+(c.length===1?'':'s'),'partial');
 return out;
}
// One row of the overview: what the part is, its state, its switch (or the place where it is chosen).
function uiRow(id,title,text,state,control,tab,sub){
 return '<div class="quick-item" data-quick-item="ui-'+id+'"><div><h3>'+title+'</h3><p>'+text+'</p><div class="quick-state">'+state+'<button class="ui-open" data-ui-open="'+tab+'"'+(sub?' data-dock-open="'+sub+'"':'')+'>'+(id==='launcher'?'Choose':'Details')+'</button></div></div>'+control+'</div>';
}
// Where the volume bar is, for the slides: an edge, or hidden (the level changes, nothing is drawn).
// Where the TV's sound goes (dockData.audioOutput: Samsung's speaker selection, ext_volume, whether mbr-daemon runs) and what Vetro's
// Volume bar does there: one muted sentence, a permanent caveat. A receiver on HDMI and the optical outputs get Vol back from Samsung
// (OutputPickerModel.VetroSetsLevel): an optical soundbar follows Samsung's universal remote or Q-Symphony, not the TV's level (S95C,
// S90D, S90F, 2026-11-20).
var AUDIO_OUTPUT_NAMES={1:'the optical output',5:'Bluetooth headphones or a speaker',6:'two Bluetooth devices',2:'a receiver or soundbar on HDMI',3:'Sound Share',4:'a Wi-Fi speaker',8:'the TV and a receiver on HDMI',9:'the TV and the optical output',10:'the TV and a Wi-Fi speaker',11:'the optical output (centre mode)',12:'a receiver on HDMI (centre mode)',13:'headphones',14:'the line out',15:'a USB headset',16:'the TV and a Wi-Fi speaker',17:'the TV and a receiver on HDMI',18:'the TV and the optical output',19:'Auracast'};
function audioOutputNote(d){
 var a=d&&d.audioOutput,sel=a&&a.selection,name=AUDIO_OUTPUT_NAMES[sel];if(!name)return null;
 var rest=' The number pad, the launcher and the Control center work as usual.';
 if([2,8,12,17].indexOf(sel)>=0)return {text:'Sound goes to '+name+'. Vol and Mute pass to it through Samsung, so Samsung’s bar shows its level and Vetro’s bar stays away.'+rest};
 if(sel===5||sel===6)return {text:'Sound goes to '+name+'. Vol and Mute pass to Samsung, which sets the level of the Bluetooth device, so Samsung’s bar shows and Vetro’s bar stays away.'+rest};
 if([1,9,11,18].indexOf(sel)>=0)return {text:(sel===9||sel===18?'Sound plays on '+name:'Sound goes to '+name)+'. Vol and Mute pass to Samsung, which drives the soundbar (by infrared or Q-Symphony), so Samsung’s bar shows and Vetro’s bar stays away.'+rest};
 return {text:'Sound goes to '+name+'. Vetro’s bar changes the TV’s own level; whether '+name+' follows it has not been tried. If Vol stops working, turn the Volume bar off.'};
}
function audioOutputMarkup(d){var n=audioOutputNote(d);return n?'<p class="notice" data-audio-note>'+esc(n.text)+'</p>':''}
function edgeText(edge){return edge==='hidden'?'Hidden: Vol changes the level, no bar.':'On the '+edge+' edge.'}
// The Overview's slideshow: what each part puts on the screen, with the key that brings it up.
function overviewSlides(d){
 var edge=d&&d.volumeEdge||'left';
 return [
  {title:'Vetro launcher',keys:remoteKey('home','Home'),text:'Your apps in one row. Up opens Sources.',svg:lpMarkup(d||{},'lp-rise'),ms:6500},
  {title:'TV guide',keys:remoteKey('pad-up','Up'),text:'Up, while watching live TV.',svg:UI_GUIDE_SCENE,ms:8000},
  {title:'Volume bar',keys:remoteKey('rocker-vol-up','Vol +'),text:edgeText(edge),svg:osdVolumePreview(edge,62)},
  {title:'Number pad',keys:remoteKey('color-123','123'),text:'Pick a channel by number.',svg:osdPadPreview()},
  {title:'Control center',keys:remoteKey('pad-down','Down'),text:'Running apps and audio output from the Dock.',svg:osdTasksPreview()}
 ];
}
function renderOverview(){
 var box=$('uiOverview');if(!box)return;var d=dockData,t=tunerData,rows=[],home=[];
 if(!d)home.push(uiRow('launcher','Launcher','What the Home key opens.',chip(dockError?'Not available':'Reading…','partial')+(dockError?'<p class="quick-callout">'+esc(uiErr(dockError))+'</p>':''),'','launcher'));
 else{
  var mode=uiLauncherMode(d),what=mode==='vetro'?'the Vetro launcher':mode==='custom'?esc(customName(d.customApp)):'Samsung’s Home';
  home.push(uiRow('launcher','Launcher','The Home key opens '+what+'.',mode==='off'?chip('Samsung’s Home'):uiState(d,true)+(mode==='custom'?chip('Custom launcher'):''),
   switchMarkup('data-ui-launcher',mode==='vetro',dockBusy||!d.installed,'Vetro launcher'),'launcher',mode==='custom'?'custom':'vetro'));
 }
 if(!t)rows.push(uiRow('tuner','Live TV','Vetro’s own tuner, guide included.',chip(tunerError?'Not available':'Reading…','partial')+(tunerError?'<p class="quick-callout">'+esc(uiErr(tunerError))+'</p>':''),'','tuner'));
 else{
  var unsup=t.installed&&t.supported===false;
  rows.push(uiRow('tuner','Live TV','Banner, Channel list and TV guide over live TV.',(unsup&&!t.enabled?chip('Not available on this TV','partial'):uiState(t,!!t.enabled))+(unsup?'<p class="quick-callout">'+esc(t.unsupportedReason||'This TV cannot run the tuner.')+'</p>':''),
   switchMarkup('data-ui-tuner',!!t.enabled,tunerBusy||!t.installed||(unsup&&!t.enabled),'Live TV'),'tuner'));
 }
 if(d){
  var cc=dockCards(d);
  home.push(uiRow('tasks','Control center','Down on the apps row: up to '+(d.maxCards||3)+' cards'+(cc.length?' ('+cc.map(function(c){return cardInfo(c,d).name}).join(', ')+')':'')+'.',chip(cc.length?'On':'Off',cc.length?'on':'')+(cc.length&&uiLauncherMode(d)!=='vetro'?chip('Needs the Vetro launcher','partial'):''),switchMarkup('data-ui-tasks',cc.length>0,dockBusy||!d.installed,'Control center'),'launcher','cards'));
  rows.push(uiRow('volume','Volume bar','Vol and Mute show Vetro’s bar instead of Samsung’s.',chip(d.volumePill?'On':'Off',d.volumePill?'on':'')+(d.volumePill?uiNeedNotes('volume'):''),switchMarkup('data-ui-osd="volumePill"',!!d.volumePill,dockBusy||!d.installed,'Volume bar'),'osd'));
  rows.push(uiRow('pad','Number pad','123 opens Vetro’s pad instead of Samsung’s.',chip(d.numberPad?'On':'Off',d.numberPad?'on':'')+(d.numberPad?uiNeedNotes('pad'):''),switchMarkup('data-ui-osd="numberPad"',!!d.numberPad,dockBusy||!d.installed,'Number pad'),'osd'));
 }
 var rel='<section class="quick-group" aria-labelledby="uiRelTitle"><h2 class="section-title" id="uiRelTitle">${sectionIcon('keys')}How they fit together</h2><ul class="ui-rules">'+
  '<li><strong>One launcher on Home:</strong> Samsung’s Home, the Vetro launcher or another app.</li>'+
  '<li><strong>The Volume bar and Number pad are drawn by the launcher</strong>, so they need one on the Home key.</li>'+
  '<li><strong>Their keys come through the Remapper’s interception</strong>, which Vetro UI turns on for you.</li>'+
  '<li><strong>Vetro UI comes first:</strong> shortcuts on the same key pause after you confirm.</li>'+
  '<li><strong>Live TV runs on its own.</strong></li></ul></section>';
 var key=d?[d.volumeEdge||'left',(d.entries||[]).length,dockCards(d).join('+'),!!d.noMotion,!!d.useSourceImages].join(','):'none';   // what the pictures show
 // Two boxes: what the Home key opens (the launcher and its Control center), then live TV and the on-screen displays.
 var parts='<section class="quick-group" aria-label="Launcher and Control center">'+home.join('')+'</section><section class="quick-group" aria-label="Live TV, Volume bar and Number pad">'+rows.join('')+'</section>';
 if(uiShowKey===key&&box.firstChild&&$('uiParts')){paint($('uiParts'),parts);paint($('uiRel'),rel);return}
 uiShowKey=key;
 box.innerHTML='<div class="dock-layout ui-overview"><div class="dock-left panel"><h3>On your TV</h3><p class="section-note">Sample apps and channels.</p>'+showreel('overview',overviewSlides(d),'What Vetro UI draws on the TV')+'</div><div class="ui-parts" id="uiParts">'+parts+'</div><div id="uiRel">'+rel+'</div></div>';
 setTimeout(fitPreview,0);
}
// Parts switched on but idle while Samsung's Home is the launcher start holding their keys when a launcher comes on: name the
// shortcuts of the user's that would stop running.
function launcherConflictNote(mode){
 if(!dockData||!uiRules)return '';var c=uiConflicts(uiRules,uiKeysWhen(dockData,mode));if(!c.length)return '';
 return '<p class="quick-callout"><strong>'+(c.length===1?'One of your shortcuts stops running':c.length+' of your shortcuts stop running')+'.</strong> '+c.map(function(x){return 'Key '+esc(x.label)+' ('+esc(x.code)+') opens '+esc(ruleName(x.rule))}).join('; ')+': the '+esc(c[0].name.toLowerCase())+' is on and the launcher draws it, and Vetro UI’s keys come first. Turn the '+esc(c[0].name.toLowerCase())+' off in On-screen displays to keep '+(c.length===1?'it':'them')+'.</p>';
}
// Shortcuts of the user's on the tuner's keys: the remote bridge keeps those keys for the shortcut, so the tuner never gets them.
function tunerKeyConflicts(){var codes={};UI_TUNER_KEYS.forEach(function(k){codes[k.code]=k});return (uiRules||[]).filter(function(r){return r.enabled&&r.trigger&&r.trigger.type==='physical'&&codes[String(r.trigger.value)]}).map(function(r){return {key:codes[String(r.trigger.value)],rule:r}})}
function launcherSwitchConfirmMarkup(target){
 if(launcherSwitchAsk!==target||!dockData)return '';
 var from=target==='vetro'?esc(customName(dockData.customApp)):'the Vetro launcher',to=target==='vetro'?'the Vetro launcher':esc(customName(customChosen));
 return '<div class="inline-confirm" role="group" aria-label="Confirm launcher switch"><p><strong>Switch the Home key from '+from+' to '+to+'?</strong> Vetro turns '+from+' off, then '+to+' on. Autorun Smart Hub stays off. If the second step fails, Home opens Samsung Home until you try again.</p><div class="row"><button data-launcher-switch-cancel>Cancel</button><button class="primary" data-launcher-switch-confirm>Switch</button></div></div>';
}
function switchLauncher(target){
 launcherSwitchAsk=null;var id=target==='custom'?customChosen:null;if(!dockData||target==='custom'&&!id)return;
 var first=target==='vetro'?['disableCustom','Turn off the custom launcher']:['disable','Turn off the Vetro launcher'];
 return Promise.resolve(setDock(first[0],first[1])).then(function(){
  if(!dockData||uiLauncherMode(dockData)!=='off'){say('The original launcher is still on.');return}
  return target==='vetro'?setDock('enable','Turn on the Vetro launcher'):setDock('enableCustom','Turn on the custom launcher',{appId:id});
 });
}
function osdConflictMarkup(name){
 if(osdAsk!==name)return '';var c=uiConflicts(uiRules||[],uiKeysOf(name==='volumePill'?'volume':'pad')),part=name==='volumePill'?'volume bar':'number pad';
 return '<div class="inline-confirm" role="group" aria-label="Confirm shortcut conflict"><p><strong>'+(c.length===1?'One of your shortcuts uses':c.length+' of your shortcuts use')+' the same key.</strong> '+c.map(function(x){return 'Key '+esc(x.label)+' ('+esc(x.code)+') opens '+esc(ruleName(x.rule))}).join('; ')+'. While the '+part+' is on, Vetro UI’s keys come first and '+(c.length===1?'this shortcut does':'these shortcuts do')+' not run. '+(c.length===1?'It stays saved and works':'They stay saved and work')+' again when you turn the '+part+' off.</p><div class="row"><button data-osd-cancel>Cancel</button><button class="primary" data-osd-confirm="'+name+'">Turn on anyway</button></div></div>';
}
function osdToggle(name,on,confirmed){
 var label=(on?'Turn on the ':'Turn off the ')+(name==='volumePill'?'volume bar':'number pad');
 if(on&&!confirmed&&uiConflicts(uiRules||[],uiKeysOf(name==='volumePill'?'volume':'pad')).length){osdAsk=name;renderUi();if(uiTab!=='osd')showUiTab('osd');var q=document.querySelector('[data-osd-confirm]');if(q)q.focus();return}
 osdAsk=null;
 return Promise.resolve(setDock(name,label,{on:!!on})).then(loadUiInput);
}
var osdShowKey=null;
function renderOsd(){
 var box=$('osd');if(!box)return;var d=dockData;
 if(!d){osdShowKey=null;box.innerHTML='<div class="panel"><p class="notice">'+esc(uiErr(dockError)||'Reading…')+'</p></div>';return}
 var mode=uiLauncherMode(d),st=uiInput&&uiInput.status,pref=st&&st.preference,anyOn=d.volumePill||d.numberPad;
 var host=mode==='vetro'?'<p class="notice">Drawn by the Vetro launcher.</p>':mode==='custom'?'<p class="notice">Drawn by Vetro while '+esc(customName(d.customApp))+' is the launcher.</p>':
  '<div class="quick-callout"><p>Turn on a launcher to use these displays.</p><div class="quick-actions"><button data-ui-open="launcher" data-dock-open="vetro">Choose a launcher</button></div></div>';
 var inter=!uiInput?'<p class="notice">'+(uiInputError?'The remote interception could not be read ('+esc(uiInputError)+'). Open this page again to retry.':'Reading the remote interception…')+'</p>':pref&&pref.enabled?'<p class="notice">Remote interception on'+(uiInterception&&uiInterception.auto?', turned on by Vetro UI':'')+(st.policy&&st.policy.connected?'':' (connecting)')+'. Their keys are locked in the Remapper.</p>':
  '<div class="quick-callout"><p>The remote interception is off'+(anyOn?', so Vol and 123 still go to Samsung':'')+'. It turns on when you switch one of these on'+(uiInterception&&uiInterception.problem?'; last try: '+esc(uiInterception.problem):'')+'.</p><div class="quick-actions"><button data-ui-remote>Open the Remapper</button></div></div>';
 var needs='<section class="quick-group" aria-labelledby="osdNeedsTitle"><h2 class="section-title" id="osdNeedsTitle">${sectionIcon('access')}What they need</h2>'+host+inter+'</section>';
 var edge=d.volumeEdge||'left';
 var vol='<div class="quick-item" data-quick-item="volume-pill"><div><h3>Volume bar</h3><p>Vol and Mute show Vetro’s bar instead of Samsung’s. With a receiver on HDMI, a soundbar on optical or Bluetooth headphones, Vol goes to Samsung and its bar shows.</p><div class="quick-state">'+chip(d.volumePill?'On':'Off',d.volumePill?'on':'')+(d.volumePill?uiNeedNotes('volume'):'')+'</div><label class="quick-edge">Position <select data-osd-edge aria-label="Volume bar position"'+(dockBusy||!d.installed?' disabled':'')+'>'+['left','right','top','bottom','hidden'].map(function(e){return '<option value="'+e+'"'+(edge===e?' selected':'')+'>'+e.charAt(0).toUpperCase()+e.slice(1)+'</option>'}).join('')+'</select></label>'+audioOutputMarkup(d)+'</div>'+switchMarkup('data-osd="volumePill"',!!d.volumePill,dockBusy||!d.installed,'Volume bar')+osdConflictMarkup('volumePill')+'</div>';
 var pad='<div class="quick-item" data-quick-item="number-pad"><div><h3>Number pad</h3><p>123 opens Vetro’s pad instead of Samsung’s.</p><div class="quick-state">'+chip(d.numberPad?'On':'Off',d.numberPad?'on':'')+(d.numberPad?uiNeedNotes('pad'):'')+'</div></div>'+switchMarkup('data-osd="numberPad"',!!d.numberPad,dockBusy||!d.installed,'Number pad')+osdConflictMarkup('numberPad')+'</div>';
 // The preview beside the switches, as on the other tabs; drawn again only when the bar moves to another edge.
 if(osdShowKey===edge&&box.firstChild&&$('osdParts')){paint($('osdParts'),vol+pad);paint($('osdNeeds'),needs);return}
 osdShowKey=edge;
 var slides=[{title:'Volume bar',keys:remoteKey('rocker-vol-up','Vol +')+remoteKey('rocker-vol-down','Vol −')+remoteKey('rocker-vol-press','Mute: press VOL'),text:edgeText(edge),svg:osdVolumePreview(edge,35)},
  {title:'Number pad',keys:remoteKey('color-123','123'),text:'One row at the bottom.',svg:osdPadPreview()}];
 box.innerHTML='<div class="dock-layout ui-osd"><div class="dock-left panel"><h3>Preview</h3><p class="section-note">The bar follows the position you choose.</p>'+showreel('osd',slides,'The on-screen displays')+'</div><div class="quick-group" id="osdParts">'+vol+pad+'</div><div id="osdNeeds">'+needs+'</div></div>';
}
var pluginData=null,pluginError=null,pluginBusy=false;
var pluginView=null;
// One horizontal tab per running plugin that has a page, next to Manage. Plugins no longer add to the sidebar.
function pluginPages(){return pluginData?pluginData.plugins.filter(function(p){return p.ui&&p.state==='running'}):[]}
function renderPluginTabs(){
 var box=$('pluginTabs');if(!box)return;var pages=pluginPages();
 if(pluginView&&!pages.some(function(p){return p.id===pluginView}))showPluginTab(null,true);
 var body=$('pluginsBody'),y=body&&body.getBoundingClientRect&&typeof scrollBy==='function'?body.getBoundingClientRect().top:null,was=box.hidden;
 box.hidden=!pages.length;
 if(y!==null&&was!==box.hidden&&currentPanel==='plugins'){var dy=body.getBoundingClientRect().top-y;if(dy)scrollBy(0,dy)}
 replaceControls(box,[{id:'',label:'Manage'}].concat(pages.map(function(p){return {id:p.id,label:p.ui.label}})).map(function(t){var on=(pluginView||'')===t.id;return '<button type="button" role="tab" data-plugin-tab="'+esc(t.id)+'" id="ptab-'+(t.id?esc(t.id):'manage')+'" aria-controls="'+(t.id?'pluginPage':'pluginsBody')+'" aria-selected="'+on+'" tabindex="'+(on?0:-1)+'">'+esc(t.label)+'</button>'}).join(''),['id']);
}
function showPluginTab(id,quiet){
 pluginView=id||null;
 $('pluginsBody').hidden=!!pluginView;$('pluginPage').hidden=!pluginView;
 $('pluginPage').setAttribute('aria-labelledby','ptab-'+(pluginView||'manage'));
 var p=pluginView?pluginPages().filter(function(q){return q.id===pluginView})[0]:null;
 if(currentPanel==='plugins'){$('pageSubtitle').textContent=p?p.name+' · Shard':titles.plugins[1];$('shardNotice').hidden=!!p}
 if(!pluginView){$('pluginFrame').src='about:blank';if(!quiet)renderPluginTabs();return}
 $('pluginFrame').src='about:blank';
 // The page gets its own session in its URL: a sandboxed frame cannot send the dashboard's sign-in cookie.
 var id2=pluginView;
 api('/plugins/'+encodeURIComponent(id2)+'/session',{}).then(function(d){if(pluginView===id2)$('pluginFrame').src=d.path}).catch(function(e){if(pluginView===id2)$('pageSubtitle').textContent=p.name+' · could not open: '+e.message});
 if(!quiet)renderPluginTabs();
}
// Arrow keys, Home and End move between tabs of any tablist (activation follows focus).
document.addEventListener('keydown',function(e){var t=e.target;if(!t||!t.getAttribute||t.getAttribute('role')!=='tab')return;var list=t.parentNode,tabs=[].slice.call(list.querySelectorAll('[role=tab]')),i=tabs.indexOf(t),n=e.key==='ArrowRight'?i+1:e.key==='ArrowLeft'?i-1:e.key==='Home'?0:e.key==='End'?tabs.length-1:null;if(n===null||i<0||!tabs.length)return;e.preventDefault();var next=tabs[(n+tabs.length)%tabs.length];next.focus();next.click()});
var pluginSig='',registryChecked=false;
function loadPlugins(force){var changed=true;return api('/plugins').then(function(d){if(!d||!Array.isArray(d.plugins))throw Error('The Shard list is unavailable');var sig=JSON.stringify(d);changed=sig!==pluginSig||pluginError!==null;pluginSig=sig;pluginData=d;pluginError=null;var launcher=(d.bundled||[]).concat(d.plugins).filter(function(p){return p.id==='launcher'})[0];if(launcher&&launcher.detail&&typeof launcher.detail.enabled==='boolean')launcherEnabled=launcher.detail.enabled;if(changed){renderQuick();renderPluginTabs();noticeDots()}}).catch(function(e){changed=pluginError!==e.message;pluginError=e.message}).finally(function(){if(changed||force)renderPlugins()})}
var PLUGIN_WARNING='Plugins are written by third parties, not by the author of Vetro. A plugin runs on your TV with the same access as Vetro itself, and the author takes no responsibility for what any plugin does or for any damage, loss or malfunction that follows. Plugins in the public list are only spot-checked: that is not an audit and does not guarantee that a plugin works, is safe or stays unchanged. A plugin is not sandboxed: whatever permissions it lists, its code runs inside Vetro and can do anything Vetro can, including running commands as root. Permissions are labels that tell you what it says it needs, not limits. A signature from the plugin list shows that the file is the one the list published, not that the code is safe. Install only plugins you trust.';
$('shardNoticeText').textContent=PLUGIN_WARNING;
function verNewer(a,b){var ok=VERSION_RE;if(!ok.test(String(a))||!ok.test(String(b)))return String(a)!==String(b);var x=String(a).split('.'),y=String(b).split('.');for(var i=0;i<Math.max(x.length,y.length);i++){var m=parseInt(x[i]||'0',10),n=parseInt(y[i]||'0',10);if(m!==n)return m>n}return false}
function checksumOk(e){return SHA256_I_RE.test((e&&e.sha256)||'')}
function pluginUpdate(p){var e=((registryData||{}).plugins||[]).filter(function(x){return x.id===p.id})[0];return e&&checksumOk(e)&&verNewer(e.version,p.version)?e:null}
function permName(x){return x==='exec'?'run commands as root':x}
function interceptList(list){return Array.isArray(list)?list.filter(function(a){return a&&typeof a.appId==='string'&&typeof a.label==='string'}):[]}
function interceptKey(list){return JSON.stringify(interceptList(list).map(function(a){return [a.appId,a.label]}))}
function interceptChips(list,conflicts){return interceptList(list).map(function(a){return (conflicts||[]).indexOf(a.appId)>=0?chip('Conflict · '+a.label+' tile','warn'):chip('Intercepts the '+a.label+' app')}).join('')}
function interceptNote(list,conflicts){var l=interceptList(list);if(!l.length)return '';var names=l.map(function(a){return a.label+' ('+a.appId+')'}).join(', ');return '<p class="section-note">'+((conflicts||[]).length?'Two Shards claim this app. Its tile opens the app as usual. Turn one Shard off.':'While it is on, the launcher tile of '+esc(names)+' opens this Shard. If the Shard fails, the tile opens the app.')+'</p>'}
function cardWords(cc){return cc&&typeof cc.label==='string'?' It adds a card to the Control center (“'+cc.label+'”).':''}
function cardKey(cc){return cc&&typeof cc.label==='string'?cc.label:''}
function cardNote(cc){if(!cc||typeof cc.label!=='string')return '';return '<p class="section-note">Adds a Control center card (“'+esc(cc.label)+'”). Enable it in Vetro UI → Launcher → Control center.</p>'+(cc.error?'<p class="row-error">Control center card: '+esc(cc.error)+'</p>':'')}
function interceptWords(list){var l=interceptList(list);return l.length?' It intercepts the launcher tile of '+l.map(function(a){return a.label+' ('+a.appId+')'}).join(', ')+' while it is on.':''}
function trustName(t){return t==='registry'?'From the catalog, signed':t==='file'?'From a file, not signed':'Copied in by hand, not signed'}
function pluginChip(p){return chip(p.state==='invalid'?'Invalid':p.state==='failed'?'Failed':p.state==='suspended'?'Paused':p.state==='running'?'Running':'Off',p.state==='running'?'on':p.state==='failed'||p.state==='invalid'?'warn':'')}
// One muted line under a Shard: who wrote it, what it says it needs, and anything else short.
function shardMeta(author,perms,more){var m=[];if(author)m.push('By '+author);m.push(perms&&perms.length?'Needs: '+perms.map(permName).join(', '):'No special permission');return '<p>'+esc(m.concat(more||[]).join(' · '))+'</p>'}
// The result of an install or a refused file, next to the control that started it: muted when it went well, amber when it needs a look.
function pluginNoteMarkup(at){if(!pluginNote||pluginNoteAt!==at)return '';return pluginNote===pluginNoteOk?'<p class="section-note" role="status">'+esc(pluginNote)+'</p>':'<div class="alert-row" role="status"><p>'+esc(pluginNote)+'</p></div>'}
function renderPlugins(){
 var box=$('pluginsBody');if(!box)return;var d=pluginData;
 if(!d){box.innerHTML=pluginError?'<div class="alert-row" role="alert"><p>Could not read the Shards: '+esc(pluginError)+'</p><button type="button" data-plugin-retry>Try again</button></div>':'<p class="notice">Reading…</p>';return}
 var stale=pluginError?'<div class="alert-row" role="status"><p>Could not refresh the Shards: '+esc(pluginError)+'. What you see may be out of date.</p><button type="button" data-plugin-retry>Try again</button></div>':'';
 var safe=d.safeMode?'<div class="alert-row" role="status"><p>Shards paused after Vetro stopped within a minute of starting twice in a row.</p><button type="button" class="primary" data-plugin-resume '+(pluginBusy?'disabled':'')+'>Resume Shards</button></div>':'';
 var rows=d.plugins.map(function(p){
  var sw=p.state==='invalid'?'':switchMarkup('data-plugin-switch="'+esc(p.id)+'"',p.enabled&&p.state!=='suspended'&&p.state!=='failed',pluginBusy||d.safeMode,p.name);
  var err=p.state==='failed'&&p.lastError?'<p class="row-error">Switched off after repeated errors: '+esc(p.lastError)+'</p>':p.state==='invalid'?'<p class="row-error">Not loaded: '+esc(p.lastError)+'</p>':'';
  var upd=pluginUpdate(p),acts=(upd?'<button type="button" class="text-button" data-registry-install="'+esc(p.id)+'" '+(pluginBusy?'disabled':'')+'>Update to '+esc(upd.version)+'</button>':'')+(p.state==='running'?'':'<button type="button" class="text-button" data-plugin-remove="'+esc(p.id)+'" '+(pluginBusy?'disabled':'')+'>Remove</button>');
  var conflict=(p.interceptConflicts||[]).length?interceptChips(p.intercepts,p.interceptConflicts):'';
  return '<div class="quick-item" data-quick-item="plugin-'+esc(p.id)+'"><div><h3>'+esc(p.name)+' <small>'+esc(p.version||'—')+'</small></h3>'+(p.description?'<p>'+esc(p.description)+'</p>':'')+'<div class="quick-state">'+pluginChip(p)+'<span class="chip">'+esc(trustName(p.trust))+'</span>'+conflict+'</div>'+shardMeta(p.author,p.permissions)+interceptNote(p.intercepts,p.interceptConflicts)+cardNote(p.controlCenter)+err+(acts?'<div class="shard-row-actions">'+acts+'</div>':'')+'</div>'+sw+'</div>';
 }).join('');
 var n=d.plugins.length;
 var installed='<section class="panel" aria-labelledby="pluginInstalledTitle"><div class="shard-card-head"><h2 id="pluginInstalledTitle">Installed'+(n?' <span class="chip">'+n+'</span>':'')+'</h2></div>'+pluginNoteMarkup('installed')+(n?'<div class="shard-list">'+rows+'</div>':'<p class="section-note">None yet. Install one from the catalog; it starts switched off.</p>')+'</section>';
 replaceControls(box,stale+safe+installed+pluginAddPanel(d),['data-plugin-switch','data-plugin-remove','data-registry-install','data-registry-refresh','data-plugin-developer','data-plugin-file','data-plugin-retry','data-plugin-resume','data-shard-more']);
}
var registryData=null,registryError=null,registryLoading=false,pluginNote=null,pluginNoteAt='catalog',pluginNoteOk=null,shardMoreOpen=false;
function registryUrl(){return (pluginData||{}).registry||null}
function loadRegistry(){
 var url=registryUrl();if(!url){registryError='No catalog is configured.';return renderPlugins()}
 registryLoading=true;renderPlugins();
 return fetch(url,{cache:'no-store'}).then(function(r){if(!r.ok)throw Error(r.status===404?'The catalog is not published yet.':'The catalog answered '+r.status);return r.json()}).then(function(d){
  if(!d||d.format!=='vetro-plugin-index'||!Array.isArray(d.plugins))throw Error('The catalog has an unexpected format.');
  d.plugins=d.plugins.filter(function(e){return e&&typeof e.id==='string'&&typeof e.name==='string'&&typeof e.url==='string'});
  registryData=d;registryError=null;
 }).catch(function(e){registryError=e.message==='Failed to fetch'?'Could not reach the catalog. This browser needs internet access.':e.message}).finally(function(){registryLoading=false;renderPlugins();noticeDots()});
}
function pluginAddPanel(d){
 var installed={};d.plugins.forEach(function(p){installed[p.id]=p});
 var ready=registryData&&!registryLoading&&!registryError,body;
 if(registryLoading)body='<p class="notice">Loading the catalog…</p>';
 else if(registryError)body='<div class="alert-row" role="alert"><p>'+esc(registryError)+'</p><button type="button" data-registry-refresh>Try again</button></div>';
 else if(!registryData)body='<div class="quick-actions"><button type="button" data-registry-refresh>Load the catalog</button></div>';
 else body='<p class="section-note">Downloads are checked against the catalog’s '+(d.signed?'signature':'checksum')+'.</p>'+pluginNoteMarkup('catalog')+(registryData.plugins.length?'<div class="shard-list">'+registryData.plugins.map(function(e){
   var have=installed[e.id],same=have&&!verNewer(e.version,have.version),verified=checksumOk(e),unsigned=!d.developer&&(!d.signed||!e.signature);
   var ctrl=same?chip('Installed'):!verified?chip('No checksum'):unsigned?chip('Not signed'):'<button type="button" data-registry-install="'+esc(e.id)+'"'+(pluginBusy?' disabled':'')+'>'+(have?'Update':'Install')+'</button>';
   var more=(have&&!same?['You have '+have.version]:[]).concat(interceptList(e.intercepts).map(function(a){return 'Intercepts the '+a.label+' app'})).concat(e.controlCenter&&e.controlCenter.label?['Adds a card to the Control center']:[]);
   return '<div class="quick-item"><div><h3>'+esc(e.name)+' <small>'+esc(e.version)+'</small></h3>'+(e.description?'<p>'+esc(e.description)+'</p>':'')+shardMeta(e.author,e.permissions,more)+'</div><div class="shard-control">'+ctrl+'</div></div>';
  }).join('')+'</div>':'<p class="section-note">The catalog has no Shards yet.</p>');
 var catalog='<section class="panel" aria-labelledby="pluginCatalogTitle"><div class="shard-card-head"><h2 id="pluginCatalogTitle">Catalog</h2>'+(ready?'<button type="button" class="text-button" data-registry-refresh>Refresh</button>':'')+'</div>'+body+'</section>';
 var more='<details class="shard-more"'+(shardMoreOpen?' open':'')+'><summary data-shard-more>Install from a file or develop a Shard</summary><div class="panel">'+pluginNoteMarkup('file')+'<div class="quick-item"><div><h3>Developer mode</h3><p>Lets you install Shards the catalog has not signed; their code can do anything Vetro can, including running commands as root.'+(d.developerAllowed===false?' Not available in this package: it has no sign-in.':'')+'</p></div>'+switchMarkup('data-plugin-developer',d.developer,pluginBusy||d.developerAllowed===false,'Developer mode')+'</div><label class="file-pick">Shard file (.vplugin) <input type="file" accept=".vplugin,.json" data-plugin-file'+(!d.developer?' disabled':'')+'></label>'+(!d.developer?'<p class="section-note">Turn on Developer mode to choose a file.</p>':'')+'<p class="section-note">To write and package your own Shard, read the <a href="https://github.com/andrearicci93/vetro/blob/main/app/docs/plugins.md" target="_blank" rel="noopener noreferrer">Guide ↗</a>.</p></div></details>';
 return catalog+more;
}
function confirmPlugin(what){return confirm(what+' Third-party code, not audited. Install it only if you trust its author. Continue?')}
function installBundle(text,sha,label,opts){
 opts=opts||{};var sigHeader=opts.signature?{'X-Vetro-Sha256':sha||'','X-Vetro-Signature':opts.signature}:{'X-Vetro-Sha256':sha||''};if(pluginBusy)return;pluginBusy=true;pluginNote=null;renderPlugins();
 var enableUrl=opts.rerun?'/plugins/'+encodeURIComponent(opts.rerun)+'/enable':null;
 return runUiOperation('plugin-install',label,'Vetro Shards',null,function(mark){
  return (opts.rerun?api('/plugins/'+encodeURIComponent(opts.rerun)+'/disable',{}):Promise.resolve()).then(function(){
   return fetch('/plugins/install',{method:'POST',headers:sigHeader,body:text}).then(function(r){return r.json().then(function(d){if(!r.ok||d.ok===false)throw Error(d.error||'Install failed');if(d.plugin&&d.plugin.state==='invalid')throw Error('Installed, but not valid: '+d.plugin.lastError);return d})});
  }).then(function(d){
   var same=function(a,b){return JSON.stringify((a||[]).slice().sort())===JSON.stringify((b||[]).slice().sort())};
   var msg=label+' done. SHA-256 '+d.sha256.slice(0,16)+'…';
   if(opts.rerun&&d.plugin&&same(d.plugin.permissions,opts.perms)&&d.plugin.state==='stopped')return api(enableUrl,{}).then(function(r){
    if(r&&r.plugin&&r.plugin.state==='failed')msg+=' The new version could not start ('+r.plugin.lastError+'), so it is switched off.';
    else msg+=' It is running again.';
    pluginNote=msg;if(!/could not start/.test(msg))pluginNoteOk=msg;mark(msg,'Installed');return {resultLabel:'Installed',message:msg}});
   msg+=opts.rerun?' The update needs different permissions or failed to load. Review the Shard before turning it on.':' It is switched off.';
   pluginNote=msg;if(!opts.rerun)pluginNoteOk=msg;mark(msg,'Installed');return {resultLabel:'Installed',message:msg};
  },function(err){
   // The install was refused, so the old version is still on disk: put it back as it was.
   if(!opts.rerun)throw err;
   return api(enableUrl,{}).then(function(){throw Error(err.message+'. The previous version is running again.')},function(){throw Error(err.message+'. The Shard stays switched off.')});
  });
 }).finally(function(){pluginBusy=false;loadPlugins(true)});
}
function installFromRegistry(id){
 var e=((registryData||{}).plugins||[]).filter(function(x){return x.id===id})[0];if(!e||pluginBusy)return;
 if(!checksumOk(e)){pluginNote='The catalog gives no SHA-256 for '+e.name+', so it is not installed.';return renderPlugins()}
 var url;try{var u=new URL(e.url,registryUrl());if(u.protocol!=='https:')throw Error('scheme');url=u.href}catch(x){pluginNote='The catalog entry has no valid https address.';return renderPlugins()}
 var have=((pluginData||{}).plugins||[]).filter(function(q){return q.id===id})[0],upd=!!have;
 var perms=(e.permissions&&e.permissions.length?' It asks for: '+e.permissions.join(', ')+'.':'')+interceptWords(e.intercepts)+cardWords(e.controlCenter);
 if(!confirmPlugin((upd?'Update ':'Install ')+e.name+' '+e.version+(e.author?' by '+e.author:'')+'.'+perms))return;
 pluginBusy=true;renderPlugins();
 return fetch(url,{cache:'no-store'}).then(function(r){if(!r.ok)throw Error('Download answered '+r.status);return r.text()}).then(function(text){pluginBusy=false;var m;try{m=JSON.parse(text).manifest||{}}catch(x){m={}}if(m.id!==e.id||m.version!==e.version){pluginNote='The downloaded file is '+(m.id||'?')+' '+(m.version||'?')+', not '+e.id+' '+e.version+' as the catalog says. Not installed.';return renderPlugins()}if(interceptKey(m.intercepts)!==interceptKey(e.intercepts)){pluginNote='The downloaded file intercepts different apps than the catalog says. Not installed.';return renderPlugins()}if(cardKey(m.controlCenter)!==cardKey(e.controlCenter)){pluginNote='The downloaded file differs from the catalog on the Control center card. Not installed.';return renderPlugins()}return installBundle(text,e.sha256,(upd?'Update ':'Install ')+e.name,{rerun:have&&have.state==='running'?id:null,perms:have&&have.permissions,signature:e.signature||null})}).catch(function(err){pluginBusy=false;pluginNote='Download failed: '+err.message;renderPlugins()});
}
function setPlugin(id,on,label){
 if(pluginBusy)return;pluginBusy=true;renderPlugins();
 return runUiOperation('plugin-'+id,label,'Vetro Shards',null,function(mark){return api('/plugins/'+encodeURIComponent(id)+'/'+(on?'enable':'disable'),{}).then(function(d){if(on&&d&&d.plugin&&d.plugin.state==='failed')throw Error('It could not start: '+d.plugin.lastError);mark(label+' done.','Done');return {resultLabel:'Done',message:label+' done.'}})}).finally(function(){pluginBusy=false;loadPlugins(true)});
}
$('plugins').onchange=function(e){var x=e.target;
 if(x.dataset&&x.dataset.pluginDeveloper!=null){if(pluginBusy)return;pluginNoteAt='file';if(x.checked&&!confirm('Developer mode lets you install Shards the catalog has not signed. Their code can do anything Vetro can, including running commands as root. Turn it on?')){x.checked=false;return}pluginBusy=true;renderPlugins();api('/plugins/developer',{on:x.checked}).then(function(){pluginBusy=false;return loadPlugins(true)}).catch(function(err){pluginBusy=false;pluginNote=err.message;loadPlugins(true)});return}
 if(x.dataset&&x.dataset.pluginFile!=null){var f=x.files&&x.files[0];if(!f)return;x.value='';pluginNoteAt='file';if(f.size>528384){pluginNote=f.name+' is larger than 512 KB, so it is not a Shard file.';return renderPlugins()}var rd=new FileReader();rd.onload=function(){var fm={};try{fm=JSON.parse(String(rd.result)).manifest||{}}catch(x){}if(confirmPlugin('Install '+f.name+' from an unsigned file. The author’s identity is unverified.'+interceptWords(fm.intercepts)+cardWords(fm.controlCenter)))installBundle(String(rd.result),'','Install '+f.name)};rd.onerror=function(){pluginNote='Could not read '+f.name+'.';renderPlugins()};rd.readAsText(f);return}
 if(!x.dataset||x.dataset.pluginSwitch==null)return;var p=(pluginData.plugins||[]).filter(function(q){return q.id===x.dataset.pluginSwitch})[0];setPlugin(x.dataset.pluginSwitch,x.checked,(x.checked?'Turn on ':'Turn off ')+(p?p.name:x.dataset.pluginSwitch));};
$('pluginTabs').onclick=function(e){var b=e.target.closest&&e.target.closest('[data-plugin-tab]');if(b)showPluginTab(b.dataset.pluginTab)};
$('plugins').onclick=function(e){var t=e.target,ds=t.dataset||{};
 if(ds.registryRefresh!=null)return loadRegistry();
 if(ds.pluginRetry!=null)return loadPlugins(true);
 if(ds.shardMore!=null){var dt=t.closest&&t.closest('details');if(dt)shardMoreOpen=!dt.open;return}
 if(ds.registryInstall){pluginNoteAt=t.closest&&t.closest('[data-quick-item^="plugin-"]')?'installed':'catalog';return installFromRegistry(ds.registryInstall)}
 if(ds.pluginRemove){var rid=ds.pluginRemove;if(pluginBusy)return;if(!confirm('Remove '+rid+'? Its saved settings are deleted too.'))return;pluginBusy=true;pluginNote=null;renderPlugins();return runUiOperation('plugin-remove-'+rid,'Remove '+rid,'Vetro Shards',null,function(mark){return api('/plugins/'+encodeURIComponent(rid)+'/remove',{}).then(function(){mark('Removed '+rid+'.','Removed');return {resultLabel:'Removed',message:'Removed '+rid+'.'}})}).finally(function(){pluginBusy=false;loadPlugins(true)})}
 if(e.target.dataset&&e.target.dataset.pluginResume!=null){if(pluginBusy)return;pluginBusy=true;renderPlugins();api('/plugins/resume',{}).then(function(){pluginBusy=false;return loadPlugins(true)}).catch(function(err){pluginBusy=false;pluginError=err.message;renderPlugins()})}};
setInterval(function(){var a=document.activeElement;if(currentPanel==='plugins'&&!document.hidden&&!pluginBusy&&!(a&&a.dataset&&a.dataset.pluginFile!=null))loadPlugins()},5000);
$('dock').onchange=function(e){var x=e.target;if(!x.dataset)return;
 if(x.dataset.quickToggle!=null)return $('quick').onchange(e);
 if(x.dataset.customApp!=null){customChoice=x.value;customConfirm=false;renderCustom();return}
 if(x.dataset.customSwitch!=null){if(x.checked){x.checked=false;customConfirm=true;renderCustom();var c=document.querySelector('[data-custom-confirm]');if(c)c.focus();return}return setDock('disableCustom','Turn off the custom launcher')}
 if(x.dataset.dockFix!=null)return setDock('fixTizenTube',x.checked?'Turn on Fix TizenTube':'Turn off Fix TizenTube',{on:!!x.checked});
 if(x.dataset.dockCard!=null){var card=x.dataset.dockCard,name=cardInfo(card).name;return setDock('cards',(x.checked?'Turn on the ':'Turn off the ')+name+' card',{cards:cardsWith(dockData||{},card,!!x.checked)})}
 if(x.dataset.dockStore!=null)return setDock('appStore',x.checked?'Use TV-Store in All apps':'Use Samsung’s store in All apps',{store:x.checked?'tvstore':'samsung'});
 if(x.dataset.dockStill!=null)return setDock('noMotion',x.checked?'Turn on Reduce motion':'Turn off Reduce motion',{on:!!x.checked});
 if(x.dataset.dockSourceOption!=null)return setDock(x.dataset.dockSourceOption,(x.checked?'Turn on ':'Turn off ')+(x.dataset.dockSourceOption==='showHomeSources'?'HDMI sources on Home':'HDMI source images'),{on:!!x.checked});
 if(x.dataset.dockSwitch==null)return;
 if(x.checked){x.checked=false;dockConfirm=true;renderDock();var c=document.querySelector('[data-dock-confirm]');if(c)c.focus();return}
 return setDock('disable','Turn off the launcher');
};
$('dock').onclick=function(e){var b=e.target.closest?e.target.closest('button'):null;if(!b)return;var ds=b.dataset;
 if(ds.dockTab!=null)return showDockTab(ds.dockTab);
 if(ds.launcherSwitch!=null){launcherSwitchAsk=ds.launcherSwitch;renderDock();var q=document.querySelector('[data-launcher-switch-confirm]');if(q)q.focus();return}
 if(ds.launcherSwitchCancel!=null){launcherSwitchAsk=null;renderDock();return}
 if(ds.launcherSwitchConfirm!=null)return switchLauncher(launcherSwitchAsk);
 if(ds.quickCancel!=null||ds.quickConfirm!=null||ds.quickApp!=null||ds.appsRetry!=null)return $('quick').onclick(e);   // the Samsung Home switch of the Custom launcher tab
 if(ds.customCancel!=null){customConfirm=false;renderCustom();var sw=document.querySelector('[data-custom-switch]');if(sw)sw.focus();return}
 if(ds.customConfirm!=null||ds.customChange!=null){var id=customChosen;if(!id)return;return setDock('enableCustom',ds.customChange!=null?'Change the custom launcher app':'Turn on the custom launcher',{appId:id})}
 if(ds.dockCancel!=null){dockConfirm=false;renderDock();var s=document.querySelector('[data-dock-switch]');if(s)s.focus();return}
 if(ds.dockConfirm!=null)return setDock('enable','Turn on the launcher');
 if(ds.dockRebuild!=null)return setDock('refresh','Rebuild the launcher app list');
 if(ds.dockResetRow!=null)return setDock('resetRow','Put Samsung’s Home row back in the launcher');
 if(ds.dockReload!=null)return loadDock();
};
$('tuner').onchange=function(e){var x=e.target;if(!x.dataset)return;
 if(x.dataset.tunerSwitch==null)return;
 if(x.checked){x.checked=false;tunerConfirm=true;renderTuner();var c=document.querySelector('[data-tuner-confirm]');if(c)c.focus();return}
 return setTuner('disable','Turn off Vetro TV Tuner');
};
$('tuner').onclick=function(e){var b=e.target.closest?e.target.closest('button'):null;if(!b)return;var ds=b.dataset;
 if(ds.tunerCancel!=null){tunerConfirm=false;renderTuner();var s=document.querySelector('[data-tuner-switch]');if(s)s.focus();return}
 if(ds.tunerConfirm!=null)return setTuner('enable','Turn on Vetro TV Tuner');
 if(ds.tunerShow!=null)return setTuner('show','Show the tuner');
 if(ds.tunerReload!=null)return loadTuner();
};
$('uiTabs').onclick=function(e){var b=e.target.closest&&e.target.closest('[data-ui-tab]');if(b)showUiTab(b.dataset.uiTab)};
function uiClick(e){var b=e.target.closest?e.target.closest('button'):null;if(!b)return;var ds=b.dataset;
 if(ds.uiOpen!=null){showUiTab(ds.uiOpen);if(ds.dockOpen!=null)showDockTab(ds.dockOpen);return}
 if(ds.uiRemote!=null)return switchPanel('remote');
 if(ds.osdCancel!=null){osdAsk=null;renderUi();return}
 if(ds.osdConfirm!=null)return osdToggle(ds.osdConfirm,true,true);
}
function uiChange(e){var x=e.target;if(!x.dataset)return;
 if(x.dataset.osd!=null){var name=x.dataset.osd,on=!!x.checked;if(on)x.checked=false;return osdToggle(name,on)}
 if(x.dataset.osdEdge!=null)return Promise.resolve(setDock('volumeEdge',x.value==='hidden'?'Hide the Volume bar':'Move the Volume bar to the '+x.value,{edge:x.value}));
 if(x.dataset.uiOsd!=null){var n=x.dataset.uiOsd,o=!!x.checked;if(o)x.checked=false;return osdToggle(n,o)}
 if(x.dataset.uiTasks!=null)return setDock('cards',x.checked?'Turn on the Control center':'Turn off the Control center',{cards:x.checked?rememberedCards():[]});
 if(x.dataset.uiTuner!=null){if(x.checked){x.checked=false;tunerConfirm=true;showUiTab('tuner');renderTuner();var c=document.querySelector('[data-tuner-confirm]');if(c)c.focus();return}return setTuner('disable','Turn off Vetro TV Tuner')}
 if(x.dataset.uiLauncher!=null){
  if(!x.checked)return setDock('disable','Turn off the launcher');
  x.checked=false;showUiTab('launcher');showDockTab('vetro');
  if(dockData&&uiLauncherMode(dockData)==='custom'){launcherSwitchAsk='vetro';renderDock();var q=document.querySelector('[data-launcher-switch-confirm]');if(q)q.focus();return}
  dockConfirm=true;renderDock();var k=document.querySelector('[data-dock-confirm]');if(k)k.focus();return;
 }
}
$('uiOverview').onclick=uiClick;$('uiOverview').onchange=uiChange;$('osd').onclick=uiClick;$('osd').onchange=uiChange;
if(typeof window!=='undefined'&&window.addEventListener)window.addEventListener('resize',function(){clearTimeout(fitTimer);fitTimer=setTimeout(function(){if(currentPanel==='vetroui'&&uiTab==='launcher')fitPreview()},120)});
var updateState=null,updateIndex=null,updateBusy=false,updateArmed=false;
function updateText(m){var el=$('updateStatus');if(el)el.textContent=m}
function updateButtons(){var s=updateState||{};$('checkUpdate').disabled=updateBusy||!s.configured;$('rollbackUpdate').hidden=!s.canRollBack;$('rollbackUpdate').disabled=updateBusy;$('applyUpdate').disabled=updateBusy}
function loadUpdate(){return api('/update').then(function(s){updateState=s;$('updateVersion').textContent='Installed: Vetro '+s.version+(s.configured?'':' · no update key for this build');if(s.last&&s.last.state==='rolled-back')updateText('The last update did not start, so Vetro went back to '+s.last.to+'.');updateButtons()}).catch(function(e){$('updateVersion').textContent='Update information unavailable.';updateText(e.message+'. Reload this page to try again.')})}
function updateFetch(url,kind){return fetch(url,{cache:'no-store'}).then(function(r){if(!r.ok)throw Error(r.status===404&&kind==='update list'?'No update has been published yet.':'GitHub answered '+r.status+' for the '+kind);return kind==='update list'?r.json():r.text()})}
var updateAvail=null,AUTO_KEY='vetro.autoUpdateCheck',AUTO_EVERY=6*3600000;
function showUpdateIndex(ix,quiet){if(!ix||!SHA256_RE.test(ix.sha256||'')||!UPDATE_FILE_RE.test(ix.file||''))throw Error('Unexpected update list');updateIndex=ix;updateAvail=null;updateArmed=false;$('applyUpdate').hidden=true;if(!verNewer(ix.version,updateState.version)){if(!quiet)updateText('Vetro '+updateState.version+' is the latest version.');return}if(ix.shell>updateState.shell){updateAvail='reinstall';updateText('Vetro '+ix.version+' changes the package itself. Install it again with Apps2Samsung.');return}updateAvail='apply';updateText('Vetro '+ix.version+' is available.');$('applyUpdate').textContent='Update to '+ix.version;$('applyUpdate').hidden=false}
function setNoticeDot(tab,text){var b=document.querySelector('[data-tab="'+tab+'"]');if(!b)return;var d=b.querySelector('.notice-dot');if(!text){if(d)d.remove();return}if(!d){d=document.createElement('span');d.className='notice-dot';d.setAttribute('role','img');b.appendChild(d)}d.title=text;d.setAttribute('aria-label',text)}
function noticeDots(){var n=((pluginData||{}).plugins||[]).filter(function(p){return pluginUpdate(p)}).length;setNoticeDot('quick',updateAvail?(updateAvail==='apply'?'A Vetro update is available':'A new Vetro version needs a reinstall'):'');setNoticeDot('plugins',n?(n===1?'A Shard update is available':n+' Shard updates are available'):'')}
function autoCheckOn(){try{return localStorage.getItem(AUTO_KEY)==='1'}catch(e){return false}}
function autoNotices(){if(!autoCheckOn())return;if(updateState&&updateState.configured&&!updateBusy&&!updateArmed)updateFetch(updateState.source+'update-index.json','update list').then(function(ix){if(!updateBusy&&!updateArmed){showUpdateIndex(ix,true);noticeDots()}}).catch(function(){});if(registryUrl()&&!registryLoading){registryChecked=true;loadRegistry().then(function(){if(registryError)registryChecked=false})}}
$('autoUpdateCheck').checked=autoCheckOn();
$('autoUpdateCheck').onchange=function(){var on=this.checked,note=$('autoUpdateNote');try{localStorage.setItem(AUTO_KEY,on?'1':'0')}catch(e){this.checked=false;note.textContent='This browser does not allow saving the setting.';return}note.textContent=on?'On for this browser. Looking now…':'Off. Check for update contacts GitHub.';if(on)autoNotices()};
$('checkUpdate').onclick=function(){updateBusy=true;updateArmed=false;$('applyUpdate').hidden=true;updateButtons();updateText('Asking GitHub…');updateFetch(updateState.source+'update-index.json','update list').then(function(ix){showUpdateIndex(ix,false);noticeDots()}).catch(function(e){updateText('Could not check: '+e.message)}).finally(function(){updateBusy=false;updateButtons()})};
function waitForVersion(v,tries){fetch('/status',{cache:'no-store'}).then(function(r){return r.json()}).then(function(d){if(d&&d.app&&d.app.version===v){updateText('Updated to Vetro '+v+'.');setTimeout(function(){location.reload()},1500);return}throw Error('old')}).catch(function(){if(tries>100){updateBusy=false;updateButtons();updateText('Vetro did not come back with the new version yet. If it does not, it puts the old one back by itself: reload this page in a minute.');return}setTimeout(function(){waitForVersion(v,(tries||0)+1)},3000)})}
$('applyUpdate').onclick=function(){var ix=updateIndex;if(!ix||updateAvail!=='apply')return;if(!updateArmed){updateArmed=true;this.textContent='Confirm: update to '+ix.version+' and restart Vetro';return}updateArmed=false;updateBusy=true;$('applyUpdate').hidden=true;updateButtons();updateText('Downloading the update…');updateFetch(updateState.source+ix.file,'update').then(function(text){updateText('Sending it to the TV…');return fetch('/update/apply',{method:'POST',headers:{'Content-Type':'text/plain','x-vetro-sha256':ix.sha256},body:text})}).then(function(r){return r.json().then(function(d){if(!r.ok||!d.ok)throw Error(d.error||'The TV refused the update');return d})}).then(function(){updateText('Updating… Vetro restarts in a few seconds.');waitForVersion(ix.version,0)}).catch(function(e){updateBusy=false;updateButtons();updateText('Update failed: '+e.message)})};
$('rollbackUpdate').onclick=function(){updateBusy=true;updateButtons();updateText('Putting the previous version back…');api('/update/rollback',{}).then(function(d){updateText('Restarting with Vetro '+d.to+'…');setTimeout(function(){location.reload()},15000)}).catch(function(e){updateBusy=false;updateButtons();updateText(e.message)})};
// The live countdown is not drawn while the page is hidden; it is right again as soon as the page shows.
document.addEventListener('visibilitychange',function(){if(!document.hidden)liveStatus()});
// The shortcut list is read when the Remapper or Home Assistant opens (both read it again there), not at start.
// Listening ends after LIVE_MS even in a hidden tab (a forgotten tab is how it stays on); a stop that fails is tried again LIVE_MS later.
function listenExpired(){if(!inputListening||!(listenSince>0)||Date.now()-listenSince<LIVE_MS||uiOperationBusy.rules)return;listenSince=Date.now();return Promise.resolve($('observe').onclick()).then(function(ok){if(ok)say('Listening stopped after 2 minutes. Start it again to capture another key.')})}
if(typeof window!=='undefined'&&window.addEventListener)window.addEventListener('pagehide',function(){if(!inputListening)return;try{fetch('/input',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(listenStopBody()),keepalive:true}).catch(function(){})}catch(e){}});
var bootUpdate=loadUpdate();loadApps();liveStatus();loadQuick();Promise.all([bootUpdate,loadPlugins()]).then(autoNotices);setInterval(autoNotices,AUTO_EVERY);setInterval(function(){listenExpired();if(currentPanel==='remote'&&inputListening&&!document.hidden)pollInput()},1500);setInterval(function(){if(liveUntil){if(Date.now()>=liveUntil)liveUntil=0;if(!document.hidden)liveStatus();}if(currentPanel==='dashboard'||currentPanel==='processes'||currentPanel==='apps')pollMonitor()},1000);
</script></body></html>`;};
