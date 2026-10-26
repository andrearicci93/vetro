'use strict';
var groupApps = require('./app-groups.js');
var componentAvailability = require('./component-actions.js').availability;
var quickGroups = require('./quick-settings.js').GROUPS;
var quickStateFn = require('./quick-settings.js').state;
var verifiedDisableIds = require('./debloat.js').VERIFIED_GLOBAL_IDS.concat(require('./quick-settings.js').ALLOWED_IDS);
module.exports = function(){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vetro · TV manager</title><link rel="icon" href="/icon.png"><style>
/* Tokens: the Vetro design system (app/design-system/tokens.css) first, then the shorter names this page uses. */
:root{color-scheme:dark;--vetro-blue-950: #00115b;--vetro-blue-700: #123bb5;--vetro-blue-600: #0450ef;--vetro-blue-400: #1674fb;--vetro-ice-100: #e1ebfd;--vetro-white: #f5f8ff;--vetro-bg: #080f23;--vetro-surface: #101c35;--vetro-surface-raised: #192943;--vetro-text: var(--vetro-white);--vetro-text-muted: #aab8d1;--vetro-border: #344360;--vetro-action: var(--vetro-blue-700);--vetro-action-hover: #0e3095;--vetro-on-action: var(--vetro-white);--vetro-link: #8fbaff;--vetro-focus: #8fbaff;--vetro-gradient-brand: radial-gradient(ellipse at 24% 72%, #1674fb 0%, transparent 52%), radial-gradient(ellipse at 78% 22%, #0450ef 0%, transparent 54%), linear-gradient(135deg, #00115b, #123bb5 52%, #00115b);--vetro-gradient-blue: linear-gradient(135deg, #00115b 0%, #123bb5 48%, #1674fb 100%);--vetro-gradient-glass: linear-gradient(145deg, rgba(245, 248, 255, .16), rgba(225, 235, 253, .04) 55%, rgba(245, 248, 255, .10));--vetro-glass-fill: rgba(16, 28, 53, .88);--vetro-glass-edge: rgba(225, 235, 253, .22);--vetro-glass-blur: 16px;--vetro-shadow: 0 12px 32px rgba(0, 8, 35, .24);--vetro-font: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;--vetro-font-mono: ui-monospace, SFMono-Regular, Consolas, monospace;--vetro-text-small: .875rem;--vetro-text-body: 1rem;--vetro-text-title: 1.5rem;--vetro-text-display: 2.5rem;--vetro-weight-regular: 400;--vetro-weight-medium: 500;--vetro-line-body: 1.5;--vetro-line-heading: 1.15;--vetro-space-1: 4px;--vetro-space-2: 8px;--vetro-space-3: 12px;--vetro-space-4: 16px;--vetro-space-6: 24px;--vetro-space-8: 32px;--vetro-space-12: 48px;--vetro-radius-control: 8px;--vetro-radius-surface: 16px;--vetro-control-height: 44px;--vetro-focus-width: 2px;--vetro-focus-offset: 3px;--vetro-duration-fast: 120ms;--vetro-duration-normal: 200ms;--vetro-ease: cubic-bezier(.2, 0, 0, 1);--bg:var(--vetro-bg);--surface:var(--vetro-surface);--raised:var(--vetro-surface-raised);--border:var(--vetro-border);--text:var(--vetro-text);--muted:var(--vetro-text-muted);--accent-rgb:143,186,255;--ok-rgb:127,203,160;--warn-rgb:226,184,103;--danger-rgb:239,138,128;--accent:var(--vetro-link);--ok:rgb(var(--ok-rgb));--warn:rgb(var(--warn-rgb));--danger:rgb(var(--danger-rgb));--accent-soft:rgba(var(--accent-rgb),.14);--ok-soft:rgba(var(--ok-rgb),.12);--warn-soft:rgba(var(--warn-rgb),.12);--danger-soft:rgba(var(--danger-rgb),.12);--accent-line:rgba(var(--accent-rgb),.4);--ok-line:rgba(var(--ok-rgb),.4);--warn-line:rgba(var(--warn-rgb),.4);--danger-line:rgba(var(--danger-rgb),.4);--on-accent:var(--vetro-blue-950);--overlay:rgba(0,8,35,.62);--s1:var(--vetro-space-1);--s2:var(--vetro-space-2);--s3:var(--vetro-space-3);--s4:var(--vetro-space-4);--s5:var(--vetro-space-6);--r:var(--vetro-radius-control);--r-surface:var(--vetro-radius-surface);--pill:999px;--fs-s:12px;--fs-m:14px;--fs-l:16px;--fs-xl:24px;--side:224px;--font-ui:var(--vetro-font);--font-mono:var(--vetro-font-mono)}
@media (prefers-reduced-motion: reduce){:root{--vetro-duration-fast:0ms;--vetro-duration-normal:0ms}}
/* Base */
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:var(--fs-m)/1.5 var(--font-ui);-webkit-font-smoothing:antialiased}
h1,h2,h3,h4,p{margin:0}
h1{font-size:var(--fs-xl);font-weight:600;letter-spacing:-.02em;line-height:1.2}
h2{font-size:var(--fs-l);font-weight:600}
h3{font-size:var(--fs-m);font-weight:600}
h4{font-size:var(--fs-s);font-weight:500;color:var(--muted)}
a{color:var(--accent)}
code{font-family:var(--font-mono);font-size:var(--fs-s)}
.muted{color:var(--muted)}
.notice,.section-note{color:var(--muted);font-size:var(--fs-s);line-height:1.5}
.section-note{margin:0 0 var(--s3)}
[hidden]{display:none!important}
/* Controls */
button,input,select,textarea{font:inherit;color:var(--text);border:1px solid var(--border);border-radius:var(--r);background:var(--raised)}
button,select,input:not([type=checkbox]){height:var(--vetro-control-height);padding:0 var(--s4)}
button{cursor:pointer}
button:hover:not(:disabled){background:var(--border)}
button:disabled{opacity:.45;cursor:default}
input::placeholder,textarea::placeholder{color:var(--muted)}
textarea{width:100%;padding:var(--s3);font:var(--fs-s)/1.5 var(--font-mono);resize:vertical}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible,a:focus-visible{outline:var(--vetro-focus-width) solid var(--vetro-focus);outline-offset:var(--vetro-focus-offset)}
.primary{background:var(--vetro-action);color:var(--vetro-on-action);border-color:var(--vetro-action);font-weight:600}
.primary:hover:not(:disabled){background:var(--vetro-action-hover);border-color:var(--vetro-action-hover)}
.danger,#uninstallComponent,#confirmComponentAction{color:var(--danger);border-color:var(--danger-line);background:var(--danger-soft)}
.danger:hover:not(:disabled),#uninstallComponent:hover:not(:disabled),#confirmComponentAction:hover:not(:disabled){background:var(--danger-soft);border-color:var(--danger)}
#detail .primary:disabled{background:var(--raised);color:var(--muted);border-color:var(--border)}
.switch{display:flex;width:max-content;max-width:100%;align-items:center;gap:var(--s3);cursor:pointer}
.switch input{appearance:none;-webkit-appearance:none;width:40px;height:24px;padding:0;border:1px solid var(--border);border-radius:var(--pill);background:var(--raised);position:relative;flex-shrink:0;cursor:pointer;transition:background var(--vetro-duration-fast) var(--vetro-ease)}
.switch input:before{content:"";position:absolute;left:3px;top:3px;width:16px;height:16px;border-radius:50%;background:var(--muted);transition:transform var(--vetro-duration-fast) var(--vetro-ease),background var(--vetro-duration-fast) var(--vetro-ease)}
.switch input:checked{background:var(--vetro-action);border-color:var(--vetro-link)}
.switch input:checked:before{transform:translateX(16px);background:var(--vetro-white)}
.switch input:disabled{opacity:.45;cursor:default}
.switch span{color:var(--text)}
.panel .switch,.box .switch,.drawer .switch{margin:var(--s3) 0 0}
.field{display:grid;gap:var(--s1);margin:var(--s3) 0 0}
.field span{font-size:var(--fs-s);color:var(--muted)}
.field input,.field select{width:100%}
.row{display:flex;gap:var(--s2);flex-wrap:wrap;align-items:center}
.row .field,.form-grid .field{margin:0}
.row .field{flex:1 1 200px}
.form-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--s3);margin-top:var(--s3)}
/* Layout */
.sidebar{position:fixed;inset:0 auto 0 0;width:var(--side);background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column;padding:var(--s5) var(--s3);z-index:1;overflow-y:auto}
.brand{display:flex;align-items:center;gap:var(--s3);padding:0 var(--s3) var(--s4)}
.brand img{width:44px;height:44px;border-radius:22%;flex-shrink:0;display:block}
.brand span{font-size:var(--fs-xl);font-weight:500;letter-spacing:-.03em;line-height:1.1}
.brand small{display:block;font-size:var(--fs-s);letter-spacing:0;color:var(--muted);font-weight:400;margin-top:var(--s1)}
.nav-label{font-size:var(--fs-s);color:var(--muted);padding:var(--s4) var(--s3) var(--s1)}
.sidebar nav{display:grid;gap:2px}
.sidebar [data-tab]{display:flex;align-items:center;gap:var(--s3);height:40px;padding:0 var(--s3);border:0;background:transparent;color:var(--muted);text-align:left;white-space:nowrap}
.sidebar [data-tab]:hover{background:var(--raised);color:var(--text)}
.sidebar [data-tab][aria-selected=true]{background:var(--accent-soft);color:var(--vetro-ice-100);font-weight:600;box-shadow:inset 0 0 0 1px var(--accent-line)}
.sidebar [data-tab] .chip{margin-left:auto}
.sidebar svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}
.nav-count{margin-left:auto}
.sidebar footer{margin-top:auto;padding:var(--s4) var(--s3) 0;border-top:1px solid var(--border);font-size:var(--fs-s);color:var(--muted)}
#connection{display:block;margin-top:var(--s1)}
.live-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--ok);margin-right:var(--s2)}
.main{margin-left:var(--side);padding:var(--s5) 32px 64px}
.page{max-width:1120px;margin:0 auto}
.page-head{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--s4);margin-bottom:var(--s5)}
.page-head p{color:var(--muted);margin-top:var(--s1)}
.page-head .actions{display:flex;align-items:center;gap:var(--s3)}
.live{font-size:var(--fs-s);color:var(--muted);white-space:nowrap}
/* Cards */
.panel,.box,.quick-group,.metric,.operation-log{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-surface);padding:var(--s4) var(--s5)}
.panel>*+*,.box>*+*{margin-top:var(--s3)}
.panel>.section-note,.panel>.notice{margin-bottom:0}
.panel>h3:not(:first-child){margin-top:var(--s5)}
.panel+.panel,.panel+.box,.box+.box,#dockBody>*+*,.layout+.box{margin-top:var(--s4)}
.panel-head{display:flex;justify-content:space-between;align-items:center;gap:var(--s3)}
.panel-head small{color:var(--muted);font-size:var(--fs-s)}
.eyebrow{font-size:var(--fs-s);font-weight:500;color:var(--accent)}
.eyebrow+h2{margin-top:var(--s1)}
.layout,.chart-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s4)}
.layout>.box,.chart-grid>.panel{margin-top:0}
.chart-grid+.panel{margin-top:var(--s4)}
.charts{margin-bottom:var(--s4)}
.empty{padding:var(--s5);text-align:center;color:var(--muted)}
/* Dashboard */
.metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--s4);margin-bottom:var(--s4)}
.metric{padding:var(--s4);min-width:0}
.metric .label,.metric small{color:var(--muted);font-size:var(--fs-s)}
.metric .value{font-size:var(--fs-xl);font-weight:600;letter-spacing:-.02em;line-height:1.3;margin:var(--s1) 0;font-variant-numeric:tabular-nums}
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
table{border-collapse:collapse;width:100%;text-align:left;white-space:nowrap}
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
#dnsCandidates button,#dnsObserved button{height:30px;margin:0 var(--s1) var(--s1) 0;font-size:var(--fs-s)}
#startupRows .purpose{display:none}
.process-name,.app-name button,.component-row button,.member-list button{height:auto;padding:0;border:0;border-radius:0;background:none;text-align:left}
.process-name{font:var(--fs-s) var(--font-mono)}
.process-name:hover,.app-name button:hover,.member-list button:hover{background:none;color:var(--accent)}
.state{font-size:var(--fs-s);color:var(--muted)}
.app-name{display:flex;gap:var(--s3);align-items:center}
.app-name button{min-width:0;font-weight:600}
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
.chip,.tag,.state-chip,.role{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 var(--s2);border:1px solid var(--border);border-radius:var(--pill);font-size:var(--fs-s);line-height:1;color:var(--muted);white-space:nowrap;vertical-align:middle}
.chip.beta{color:var(--accent);border-color:var(--accent-line);background:var(--accent-soft);font-weight:600;letter-spacing:.02em}
.page-head h1{display:flex;align-items:center;gap:var(--s3)}
.state-chip:before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.tag.good,.tag.running,.state-chip.on{color:var(--ok);border-color:var(--ok-line);background:var(--ok-soft)}
.tag.warn,.tag.mixed,.state-chip.partial,.role-tracking{color:var(--warn);border-color:var(--warn-line);background:var(--warn-soft)}
.role-keep{color:var(--accent);border-color:var(--accent-line);background:var(--accent-soft)}
.role-unused{color:var(--text)}
.disabled-row .tag.running{color:var(--ok)}
/* Toolbars, tabs, filters */
.toolbar{display:flex;gap:var(--s2);align-items:center;flex-wrap:wrap;margin-bottom:var(--s4)}
.toolbar input{flex:1 1 220px;max-width:420px}
.segmented{display:flex;flex-wrap:wrap;gap:var(--s1);padding:var(--s1);background:var(--surface);border:1px solid var(--border);border-radius:var(--r);width:max-content;max-width:100%;margin-bottom:var(--s4)}
.segmented button{height:30px;border:0;background:transparent;color:var(--muted)}
.segmented button:hover:not(:disabled){background:var(--raised);color:var(--text)}
.segmented button[aria-selected=true],.segmented button[aria-selected=true]:hover{background:var(--accent-soft);color:var(--accent);font-weight:600}
.filter-chips{display:flex;flex-wrap:wrap;gap:var(--s2);margin:0 0 var(--s3)}
.filter-chips button{height:30px;padding:0 var(--s3);border-radius:var(--pill);font-size:var(--fs-s)}
.filter-chips button span{color:var(--muted);margin-left:var(--s1);font-variant-numeric:tabular-nums}
.filter-chips button[aria-pressed=true]{color:var(--accent);background:var(--accent-soft);border-color:var(--accent-line)}
.debloat-intro{max-width:100ch}
.debloat-intro span{display:inline-block;margin-right:var(--s2)}
/* Quick settings and launcher */
.quick-layout{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s4);align-items:start}
.quick-column{display:grid;gap:var(--s4)}
.quick-group{padding:var(--s2) var(--s5)}
.quick-group>h2{padding:var(--s4) 0 var(--s1)}
.quick-group>.quick-callout{margin:var(--s2) 0}
.quick-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--s2) var(--s4);padding:var(--s4) 0}
.quick-item+.quick-item{border-top:1px solid var(--border)}
.quick-item .notice{margin-top:var(--s2)}
.quick-item p{font-size:var(--fs-s);color:var(--muted);margin-top:2px;max-width:60ch;text-wrap:pretty}
.quick-item .switch{margin:0;align-self:start}
.quick-item .switch span{font-size:var(--fs-s);color:var(--muted);min-width:24px}
.quick-state{display:flex;flex-wrap:wrap;gap:var(--s2);align-items:center;margin-top:var(--s2)}
.quick-state:empty{display:none}
.quick-item details{margin-top:var(--s2);font-size:var(--fs-s)}
.quick-item summary,.drawer-about summary{cursor:pointer;color:var(--muted);width:max-content}
.quick-item summary:hover{color:var(--text)}
.member-list{list-style:none;margin:var(--s2) 0 0;padding:0;display:grid;gap:var(--s1)}
.member-list li{display:flex;align-items:center;justify-content:space-between;gap:var(--s3)}
.member-list button{font:var(--fs-s) var(--font-mono);color:var(--text);overflow-wrap:anywhere}
.quick-callout,.inline-confirm,.component-confirmation{background:var(--warn-soft);border:1px solid var(--warn-line);border-radius:var(--r);padding:var(--s3) var(--s4);font-size:var(--fs-s);line-height:1.5}
.quick-callout{color:var(--warn)}
.inline-confirm{grid-column:1/-1}
.inline-confirm .primary{background:var(--warn);border-color:var(--warn)}
.inline-confirm p,.component-confirmation p{color:var(--text);max-width:none;margin:0 0 var(--s3)}
.component-confirmation{margin:var(--s4) 0}
.quick-actions{display:flex;gap:var(--s2);flex-wrap:wrap;margin-top:var(--s3)}
/* Rules, remote, actions */
.rule{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--s3);padding:var(--s3) 0;border-top:1px solid var(--border)}
.rule button{height:30px}
#keyEvent{font-size:var(--fs-xl);font-weight:600;margin:var(--s4) 0 var(--s2)}
.operation-item{padding:var(--s3) 0;border-top:1px solid var(--border);overflow-wrap:anywhere}
.operation-item p{font-size:var(--fs-s);margin-top:var(--s1)}
.operation-item small{color:var(--muted)}
.operation-item[data-state="warning"] strong{color:var(--warn)}
.operation-item[data-state="success"] strong{color:var(--ok)}
#actionToast{position:fixed;bottom:var(--s4);left:calc(var(--side) + (100% - var(--side))/2);transform:translateX(-50%);max-width:min(440px,calc(100% - 32px));padding:var(--s2) var(--s4);border:1px solid var(--border);border-radius:var(--pill);background:var(--raised);color:var(--text);font-size:var(--fs-s);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;z-index:6;animation:toast-in .15s ease-out}
#actionToast.warning{color:var(--warn);border-color:var(--warn-line);background:var(--warn-soft)}
#actionToast.success{border-color:var(--ok-line)}
@keyframes toast-in{from{opacity:0;transform:translate(-50%,6px)}to{opacity:1;transform:translate(-50%,0)}}
#feedback{position:fixed;bottom:var(--s5);left:calc(var(--side) + var(--s5));max-width:640px;padding:var(--s3) var(--s4);background:var(--raised);border:1px solid var(--border);border-radius:var(--r);color:var(--text);z-index:5}
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
.drawer details summary{cursor:pointer;font-weight:600}
dl{display:grid;grid-template-columns:112px minmax(0,1fr);gap:var(--s2) var(--s3);font-size:var(--fs-s);padding:var(--s4) 0;border-block:1px solid var(--border);margin:var(--s4) 0}
dt{color:var(--muted)}
dd{margin:0;overflow-wrap:anywhere}
.panel>dl{margin:0;padding:var(--s1) 0;border:0}
.deps{padding:var(--s2) 0;border-bottom:1px solid var(--border);font-size:var(--fs-s)}
.deps small{display:block;color:var(--muted)}
/* Responsive */
@media(max-width:1000px){:root{--side:184px}.metric-grid,.form-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.chart-grid,.layout,.quick-layout,.dock-layout{grid-template-columns:1fr}.main{padding:var(--s5) var(--s4) 64px}.app-table .proc-col{display:none}}
@media(max-width:620px){:root{--side:0px}.sidebar{position:sticky;top:0;width:100%;flex-direction:row;align-items:center;gap:var(--s1);overflow:auto hidden;padding:var(--s2) var(--s3);border-right:0;border-bottom:1px solid var(--border)}.brand,.nav-label,.sidebar footer,.sidebar svg{display:none}.sidebar nav{display:flex;gap:var(--s1)}.sidebar [data-tab]{height:32px}.main{margin-left:0;padding:var(--s4) var(--s4) 48px;min-width:0}.page-head{flex-wrap:wrap}.metric-grid,.form-grid{grid-template-columns:1fr}.toolbar input{max-width:none;min-width:0;width:100%}.toolbar select{flex:1 1 45%}.panel,.box{padding:var(--s4)}.quick-group{padding:var(--s2) var(--s4)}#feedback{left:var(--s4);right:var(--s4)}#actionToast{left:50%}.drawer{padding:var(--s4)}.settings-table table{white-space:normal}dl{grid-template-columns:minmax(0,1fr) minmax(0,1.4fr)}.app-table{min-width:0}.app-table th:nth-child(2),.app-table td:nth-child(2),.app-table th:nth-child(4),.app-table td:nth-child(4){display:none}.app-table th:nth-child(3){width:104px}.app-table th,.app-table td{padding:var(--s3) var(--s2)}.app-table .icon{display:none}.app-table .component-row td:first-child{padding-left:var(--s4)}.mobile-role{display:block;margin-top:var(--s2)}}
@media(max-width:400px){.drawer-actions{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
/* Launcher preview: the stage mirrors the native launcher (1920x1080 scaled down); its glass colours are the TV's own. */
.lp{--s:.4;position:relative;width:100%;max-width:960px;aspect-ratio:16/9;overflow:hidden;border-radius:var(--r);border:1px solid var(--border);background:linear-gradient(160deg,rgba(var(--accent-rgb),.2),var(--bg) 60%,var(--surface))}
.lp-stage{position:absolute;left:0;top:0;width:1920px;height:1080px;transform:scale(var(--s));transform-origin:0 0;color:#fff;font-family:var(--font-ui)}
.lp-pill{position:absolute;left:50%;bottom:40px;transform:translateX(-50%);max-width:1808px;height:144px;box-sizing:border-box;padding:0 26px;display:flex;align-items:center;border-radius:24px;background:rgba(42,51,70,.98);border:2px solid rgba(255,255,255,.22);box-shadow:0 18px 50px rgba(0,0,0,.45)}
.lp-row{display:flex;align-items:center;gap:18px;height:112px}
.lp-tile{position:relative;flex:none;overflow:hidden;background:#222;display:flex;align-items:center;justify-content:center;font-size:36px;color:#cfd6e3;box-shadow:inset 0 0 0 1px rgba(255,255,255,.2)}
.lp-tile img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.lp-loose{background:linear-gradient(#2c364f,#141b2a)}
.lp-loose img{inset:14%;width:72%;height:72%;object-fit:contain}
.lp-wide:before{content:"";position:absolute;inset:-14px;background:var(--bg) center/cover;filter:blur(14px)}
.lp-wide img{object-fit:contain}
.lp-oval{background:none;box-shadow:none}
.lp-oval img{object-fit:fill}
.lp-stack{display:flex;flex-direction:column;gap:8px}
.lp-divider{width:2px;height:72px;background:rgba(255,255,255,.3);margin:0 9px}
.lp-sel{transform:translateY(-4px);box-shadow:inset 0 0 0 1px rgba(255,255,255,.2),0 0 0 2px #fff,0 0 26px 6px var(--glow,rgba(226,237,255,.44))}
.dock-layout{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:var(--s4);align-items:stretch}.dock-layout>.quick-group{display:grid;align-content:center}.dock-left{display:grid;gap:var(--s3);align-content:center}.dock-left h3{margin:0}.dock-left .section-note{margin:0}.dock-left .lp{max-width:none}.lp-scene{position:absolute;left:0;top:0;width:1920px;height:1080px;background:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080' preserveAspectRatio='xMidYMid slice'><defs><linearGradient id='s' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='%23101c3f'/><stop offset='.45' stop-color='%23553b73'/><stop offset='.72' stop-color='%23d9707a'/><stop offset='1' stop-color='%23f6b26b'/></linearGradient><radialGradient id='g' cx='.5' cy='.5' r='.5'><stop offset='0' stop-color='%23fff2cf' stop-opacity='.95'/><stop offset='.35' stop-color='%23ffc58a' stop-opacity='.5'/><stop offset='1' stop-color='%23ffc58a' stop-opacity='0'/></radialGradient><linearGradient id='w' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='%23f0a26c'/><stop offset='1' stop-color='%231a2547'/></linearGradient></defs><rect width='1920' height='1080' fill='url(%23s)'/><circle cx='1330' cy='640' r='420' fill='url(%23g)'/><circle cx='1330' cy='640' r='64' fill='%23fff0c9'/><path d='M0 690 220 520 420 640 640 470 880 650 1080 560 1290 690 1500 540 1740 660 1920 590V760H0z' fill='%2342375f'/><path d='M0 760 180 640 400 740 640 620 900 760 1160 650 1420 770 1680 670 1920 740V800H0z' fill='%2326274a'/><rect y='780' width='1920' height='300' fill='url(%23w)'/><rect x='1250' y='790' width='160' height='6' rx='3' fill='%23ffe3b3' opacity='.7'/><rect x='1280' y='820' width='100' height='5' rx='2' fill='%23ffe3b3' opacity='.45'/><rect x='1300' y='850' width='60' height='4' rx='2' fill='%23ffe3b3' opacity='.3'/><path d='M0 900 0 1080H1920V920C1700 880 1500 930 1250 900 900 860 600 930 0 900z' fill='%230d1530' opacity='.55'/></svg>") center/cover}.lp-bug{position:absolute;left:64px;top:48px;display:flex;align-items:center;gap:14px;height:56px;padding:0 24px;border-radius:28px;background:rgba(10,14,26,.5);font-size:26px;letter-spacing:.02em;text-shadow:0 2px 6px rgba(0,0,0,.5)}.lp-bug i{width:14px;height:14px;border-radius:50%;background:#ff5a5a}.lp-bug b{font-weight:600}.lp-bug span{opacity:.75}.lp-hint{position:absolute;left:50%;bottom:194px;height:36px;line-height:36px;transform:translateX(-50%);font-size:22px;opacity:.9;text-shadow:0 2px 6px rgba(0,0,0,.6)}</style></head><body>
<aside class="sidebar"><div class="brand"><img src="/icon.png" alt="" width="44" height="44"><span>vetro<small>TV manager</small></span></div><nav aria-label="Main"><button data-tab="quick" aria-selected="true"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>Quick settings</button><button data-tab="dock" aria-selected="false"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="13" width="18" height="7" rx="2.5"/><path d="M7.5 16.5h.01M12 16.5h.01M16.5 16.5h.01M8 8h8"/></svg>Launcher<span class="chip beta">Beta</span></button><button data-tab="remote" aria-selected="false"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="3"/><circle cx="12" cy="8" r="2"/><path d="M10 15h4M10 18h4"/></svg>Remapper</button></nav><div class="nav-label">TV</div><nav aria-label="TV"><button data-tab="apps" aria-selected="false"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>Task manager</button><button data-tab="tvsettings" aria-selected="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="9" cy="18" r="2"/></svg>TV settings</button><button data-tab="control" aria-selected="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.2"/><path d="m12 5.2-1.6 1.7h3.2zM12 18.8l-1.6-1.7h3.2zM5.2 12l1.7-1.6v3.2zM18.8 12l-1.7-1.6v3.2z"/></svg>TV controls</button></nav><div class="nav-label">Monitor</div><nav aria-label="Monitor"><button data-tab="dashboard" aria-selected="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 18a8.5 8.5 0 1 1 15 0"/><path d="m12 14 4-5"/><circle cx="12" cy="14" r="1.2"/></svg>Dashboard</button><button data-tab="diagnostics" aria-selected="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/></svg>Diagnostics</button><button data-tab="actions" aria-selected="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.8v4.7h4.7M12 7.5V12l3 2"/></svg>History<span id="actionsCount" class="chip nav-count" hidden></span></button></nav><div class="nav-label">Network</div><nav aria-label="Network"><button data-tab="dns" aria-selected="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/></svg>Domain blocking</button><button data-tab="mqtt" aria-selected="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16l-4-4M20 16H4l4 4"/></svg>MQTT</button></nav><footer><span id="count">—</span> apps<span id="connection">Connecting to TV…</span></footer></aside>
<main class="main"><div class="page"><header class="page-head"><div><h1><span id="pageTitle">Quick settings</span><span id="betaTag" class="chip beta" hidden>Beta</span></h1><p id="pageSubtitle">Quick wins: each switch frees memory, stops tracking or keeps the TV as it is.</p></div><div class="actions"><span id="sampleStatus" class="live" hidden>Live updates off</span><button id="liveToggle" hidden>Start live · 2 min</button></div></header>
<div id="debloatModes" class="segmented" hidden><button data-mode="apps" aria-selected="true">Apps</button><button data-mode="processes" aria-selected="false">Processes</button><button data-mode="startup" aria-selected="false">Startup</button></div>
<section id="quick"><div class="quick-layout"><div class="quick-column"><section class="quick-group" aria-labelledby="quickMemoryTitle"><h2 id="quickMemoryTitle">Free memory</h2><div id="quickMemory"><p class="section-note">Reading the TV…</p></div></section><section class="quick-group" aria-labelledby="quickStorageTitle"><h2 id="quickStorageTitle">Storage</h2><div id="quickStorage"><p class="section-note">Reading the TV…</p></div></section></div><div class="quick-column"><section class="quick-group" aria-labelledby="quickControlTitle"><h2 id="quickControlTitle">Keep the TV as it is</h2><div id="quickControl"><p class="section-note">Reading the TV…</p></div></section><section class="quick-group" aria-labelledby="quickTrackingTitle"><h2 id="quickTrackingTitle">Advertising and tracking</h2><div id="quickTracking"></div></section><section class="quick-group" aria-labelledby="quickVoiceTitle"><h2 id="quickVoiceTitle">Voice assistants</h2><p class="quick-callout">Disabling one also turns off the remote’s microphone button and voice control.</p><div id="quickVoice"></div></section></div></div></section>
<section id="dashboard" hidden><div class="metric-grid">
<div class="metric"><div class="label">CPU</div><div id="cpuValue" class="value">—</div><small id="cpuMeta">Start live updates to sample the TV</small></div>
<div class="metric"><div class="label">Available RAM</div><div id="ramValue" class="value">—</div><small id="ramMeta">—</small></div>
<div class="metric"><div class="label">Free storage</div><div id="diskValue" class="value">—</div><small id="diskMeta">App partition</small></div>
<div class="metric"><div class="label">Network · down / up</div><div id="networkValue" class="value long">—</div><small id="networkMeta">—</small></div></div>
<div class="chart-grid charts"><div class="panel"><div class="panel-head"><h2>CPU usage</h2><small>%</small></div><div id="cpuChart"></div><div class="chart-label"><span>Last 100 samples</span><span>Now</span></div></div><div class="panel"><div class="panel-head"><h2>Available RAM</h2><small>MiB</small></div><div id="ramChart"></div><div class="chart-label"><span>Last 100 samples</span><span>Now</span></div></div></div>
<div class="chart-grid"><div class="panel"><div class="panel-head"><h2>CPU by core</h2><small id="uptime">—</small></div><div id="cores"></div><div class="table-note"><span id="loadValue">Load: —</span><span id="temperature">Temperature unavailable</span></div></div><div class="panel"><div class="panel-head"><h2>Compressed memory</h2><small>Zram</small></div><dl class="plain"><dt>Logical data</dt><dd id="zramLogical">—</dd><dt>RAM used</dt><dd id="zramPhysical">—</dd><dt>Available swap</dt><dd id="swapFree">—</dd></dl><p class="notice">Logical size is larger than the RAM it occupies.</p></div></div>
<div class="panel"><div class="panel-head"><h2>Processes</h2><button data-open="processes">Task manager →</button></div><div id="topProcesses"></div></div></section>
<section id="processes" hidden><div class="toolbar"><input id="processSearch" type="search" aria-label="Search processes" placeholder="Search process or PID…"><select id="processKind" aria-label="Process type"><option value="all">All processes</option><option value="user">User space</option><option value="kernel">Kernel threads</option></select><select id="processSort" aria-label="Sort processes"><option value="cpu">CPU ↓</option><option value="memory">Memory ↓</option><option value="pid">PID ↑</option><option value="name">Name A–Z</option></select></div><div class="table-wrap"><table><thead><tr><th>Process</th><th class="numeric">PID</th><th class="numeric">CPU</th><th class="numeric">RSS memory</th><th>State</th><th class="numeric">Threads</th></tr></thead><tbody id="processRows"></tbody></table></div><div class="table-note"><span id="processCount">—</span><span>Select a process for details · 100% CPU = one core · RSS includes shared memory</span></div></section>
<section id="apps" hidden><p class="section-note debloat-intro"><span><strong>Tracking</strong> collects viewing or ad data.</span> <span><strong>Not used at home</strong> serves hotel, shop or factory modes.</span> <span><strong>Optional</strong> is a feature you may not use.</span> <span><strong>Keep</strong> is needed by the TV.</span> <span>Disabling is reversible; uninstalling is not.</span></p><div id="roleFilters" class="filter-chips" role="group" aria-label="Filter by role"></div><p id="impactResult" class="section-note" aria-live="polite"></p><div class="toolbar"><input id="search" type="search" placeholder="Search name, package or purpose…" aria-label="Search apps"><select id="category" aria-label="Area"><option value="all">All areas</option><option value="tracking">Advertising and tracking</option><option value="voice">Voice assistants</option><option value="tv">TV and channels</option><option value="home">Home and menus</option><option value="media">Apps and media</option><option value="ambient">Ambient and art</option><option value="sharing">Multi View and mirroring</option><option value="devices">Bluetooth and devices</option><option value="samsung">Samsung account and SmartThings</option><option value="support">Diagnostics and support</option><option value="commercial">Hotel, shop and factory</option><option value="system">System services</option></select><select id="appStatus" aria-label="App state"><option value="all">All states</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option><option value="running">Running</option><option value="stopped">Not running</option><option value="visible">Menu-visible</option><option value="unknown">Unknown app state</option></select><button id="refresh">Refresh</button></div><div class="table-wrap"><table id="appTable" class="app-table no-sample"><thead><tr><th>App</th><th>Role</th><th>State</th><th>Startup</th><th class="numeric proc-col">CPU</th><th class="numeric proc-col">RAM</th></tr></thead><tbody id="appGrid"></tbody></table><p id="empty" hidden class="empty">No matching apps.</p></div><div class="table-note"><span id="inventorySource">—</span><span id="appCount">—</span></div><p class="notice">CPU and RAM appear during live updates. Areas and roles come from one Q80A firmware; other models may differ.</p></section>
<section id="startup" hidden><div class="segmented"><button data-startup="apps" aria-selected="true">App flags</button><button data-startup="services" aria-selected="false">System services</button></div><div class="toolbar"><input id="startupSearch" type="search" placeholder="Search app or service…" aria-label="Search startup entries"><select id="startupFilter" aria-label="Filter startup entries"><option value="flagged">Startup or restart enabled</option><option value="all">All</option></select><button id="refreshStartup">Refresh</button></div><div id="startupApps"><p class="section-note">Registry flags. Dependencies may still start an app when they are off.</p><div class="table-wrap"><table><thead><tr><th>App</th><th>On boot</th><th>Auto restart</th><th>App state</th></tr></thead><tbody id="startupRows"></tbody></table></div><p class="section-note">Select an app to change its flags.</p></div><div id="startupServices" hidden><div class="table-wrap"><table><thead><tr><th>Service</th><th>Startup</th><th>Current state</th><th>Substate</th></tr></thead><tbody id="serviceRows"></tbody></table></div><p id="serviceNote" class="section-note">System services · read-only</p></div></section>
<section id="mqtt" hidden><div class="panel"><h2>MQTT broker</h2><p class="notice">Connects Vetro to Home Assistant through a broker such as Mosquitto.</p><label class="switch"><input id="mqttEnabled" type="checkbox" role="switch"><span>Use MQTT</span></label><div class="form-grid"><label class="field"><span>Broker host / IP</span><input id="mqttHost" autocomplete="off" placeholder="Home Assistant server IP"></label><label class="field"><span>Port</span><input id="mqttPort" type="number" min="1" max="65535" value="1883"></label><label class="field"><span>Username</span><input id="mqttUser" autocomplete="off"></label><label class="field"><span>Password</span><input id="mqttPassword" type="password" autocomplete="new-password" placeholder="Blank keeps the saved one"></label></div><label class="switch"><input id="mqttClearPassword" type="checkbox" role="switch"><span>Remove saved password</span></label><label class="switch"><input id="mqttTls" type="checkbox" role="switch"><span>TLS · verify the broker certificate</span></label><label id="mqttCaField" class="field" hidden><span>Custom CA certificate (optional, PEM)</span><textarea id="mqttCa" rows="3"></textarea></label><div class="row"><label class="field"><span>Topic prefix</span><input id="mqttPrefix" value="vetro"></label><label class="field"><span>Device name</span><input id="mqttDevice" value="Vetro"></label></div><div class="row"><button id="saveMqtt" class="primary">Save configuration</button></div><p id="mqttCredential" class="notice"></p></div><div class="panel"><h2>Connection</h2><p id="mqttState" aria-live="polite">Reading state…</p><p id="mqttStats" class="notice"></p><div id="mqttSubscriptions"></div><div id="mqttLog" class="notice"></div><p class="notice">Counts are QoS 0 messages sent by the TV, without delivery confirmation. Message contents and passwords are not logged.</p></div><div class="panel"><h2>Rules</h2><p class="notice">A trigger can open an app, send a key or publish a message. Topics match exactly, retained messages do not fire rules, and publishing to a trigger topic is blocked.</p><label class="field"><span>Trigger type</span><select id="mqttTriggerType"><option value="mqtt">MQTT message</option><option value="physical">Physical key</option><option value="http">HTTP trigger</option></select></label><label class="field"><span>Trigger topic / key code / HTTP name</span><input id="mqttTrigger" placeholder="vetro/command/open"></label><label class="field"><span>Required payload (MQTT only; blank = any)</span><input id="mqttMatch"></label><label class="field"><span>Action</span><select id="mqttActionType"><option value="launch">Open app</option><option value="key">Send key</option><option value="mqtt">Publish MQTT message</option></select></label><label class="field" id="mqttAppField"><span>App</span><select id="mqttTarget"></select></label><label class="field" id="mqttKeyField" hidden><span>Key</span><select id="mqttKey"><option>KEY_HOME</option><option>KEY_RETURN</option><option>KEY_VOLUP</option><option>KEY_VOLDOWN</option><option>KEY_MUTE</option><option>KEY_UP</option><option>KEY_DOWN</option><option>KEY_LEFT</option><option>KEY_RIGHT</option><option>KEY_ENTER</option><option>KEY_PLAY</option><option>KEY_PAUSE</option></select></label><div id="mqttPublishFields" hidden><label class="field"><span>Destination topic</span><input id="mqttOutput"></label><label class="field"><span>Message</span><input id="mqttPayload" maxlength="256"></label></div><div class="row"><button id="saveMqttRule">Add rule</button></div><div id="mqttRules"></div></div></section>
<section id="actions" hidden><div id="operationLog" class="panel operation-log"><h2 id="operationSummary" tabindex="-1">History · this session</h2><p id="operationEmpty" class="empty">Nothing yet. Changes made from Task manager and other panels appear here.</p><div id="operationItems" role="status" aria-live="polite" aria-atomic="true"></div><p class="notice">Last 10 changes. Reloading this page clears the history.</p></div></section>
<section id="diagnostics" hidden><div class="panel"><h2>Download diagnostic report</h2><p class="notice">A JSON snapshot of the TV model and firmware, installed packages, startup flags, processes, resource usage and detected controls. Unavailable sections are marked in the file.</p><p class="notice">Passwords, network addresses, device identifiers, MQTT messages, raw logs and viewing history are excluded. App and process names are included, so review the file before sharing.</p><div class="row"><button id="downloadDiagnostics" class="primary">Download report</button></div><p id="diagnosticStatus" class="notice" role="status" aria-live="polite">Nothing is uploaded.</p></div></section>
<section id="tvsettings" hidden><div class="segmented" id="settingsModes" aria-label="Settings sections"><button data-settings-mode="picture" aria-selected="true">Picture</button><button data-settings-mode="audio" aria-selected="false">Audio</button><button data-settings-mode="advanced" aria-selected="false">Advanced</button><button data-settings-mode="network" aria-selected="false">Network</button><button data-settings-mode="sources" aria-selected="false">Inputs</button><button data-settings-mode="privacy" aria-selected="false">Privacy / HbbTV</button><button data-settings-mode="catalog" aria-selected="false">TV catalog</button><button data-settings-mode="device" aria-selected="false">Information</button></div><div class="toolbar"><input id="settingSearch" type="search" aria-label="Search settings" placeholder="Search settings…"><button id="refreshSettings">Refresh values</button></div><p id="settingStatus" class="section-note" aria-live="polite">Reading from TV…</p><div id="settingGroups"></div></section>
<section id="dns" hidden><div class="panel"><h2>Local filter</h2><p id="dnsStatus" class="notice">Reading state…</p><p id="dnsResolvers" class="notice"></p><label class="switch"><input id="dnsEnabled" type="checkbox" role="switch"><span>Block the saved domains on the TV</span></label><p class="notice">One domain per line; add subdomains separately. The hosts file resolves them to 0.0.0.0 and ::, and your DNS servers stay unchanged. App caches, private resolvers and direct IPs can bypass it.</p><textarea id="dnsDomains" rows="8" aria-label="Domains to block"></textarea><div class="row"><button id="saveDns" class="primary">Save domains</button><button id="observeDns">Observe requests · 6 seconds</button></div><h3>Observed requests</h3><div id="dnsObserved" class="notice">Use an app while observing, then add the domains you want.</div><h3>Candidate domains</h3><div id="dnsCandidates" class="notice"></div><p class="notice">Candidates are untested and not selected by default. The domains the TV uses for its internet check and clock cannot be added. The filter is reapplied when Vetro starts.</p></div></section>
<section id="dock" hidden><div id="dockBody"><div class="panel"><p class="notice">Reading…</p></div></div></section>
<section id="remote" hidden><div class="layout"><div class="box"><div class="eyebrow">Step 1 · Capture a key</div><h2>Listen to the remote</h2><p class="notice">Select a device, start listening and press a key. Keys keep working normally.</p><label class="field"><span>Physical device</span><select id="device"><option value="">Loading…</option></select></label><div class="row"><button id="observe" class="primary">Start listening</button></div><div id="keyEvent">No key captured</div><p id="inputStatus" class="muted" aria-live="polite">Interception off</p></div>
<div class="box"><div class="eyebrow">Step 2 · Choose an app</div><h2>Create a shortcut</h2><label class="field"><span>Captured key code</span><input id="inputCode" type="number" min="0" max="767" placeholder="Press a key while listening"></label><label class="field"><span>App to open</span><select id="targetApp"><option value="">Select an app…</option></select></label><div class="row"><button id="saveRule" class="primary">Save shortcut</button></div><label class="switch"><input id="filter" type="checkbox" role="switch"><span>Remote interception</span></label><p class="notice">Saved on the TV and restored when Vetro starts. Listening pauses interception.</p></div></div><div class="box"><h2>Shortcuts</h2><div id="rules">No saved shortcuts.</div></div></section><section id="control" hidden><div class="box"><h2>Native controls</h2><p class="notice">Send keys directly to the TV.</p><div class="row"><button onclick="k('XF86Home')">Home</button><button onclick="k('XF86Back')">Back</button><button onclick="k('XF86AudioRaiseVolume')">Volume +</button><button onclick="k('XF86AudioLowerVolume')">Volume −</button><button onclick="k('XF86AudioMute')">Mute</button><button onclick="k('Up')">↑</button><button onclick="k('Down')">↓</button><button onclick="k('Left')">←</button><button onclick="k('Right')">→</button><button onclick="k('Return')">OK</button><button onclick="k('XF86PowerOff')">Power</button></div></div></section></div></main><div id="overlay" class="overlay" hidden></div><aside id="detail" class="drawer" role="dialog" aria-modal="true" aria-label="Details" hidden></aside><div id="feedback" role="status" hidden></div><div id="actionToast" aria-hidden="true" hidden></div><script>
'use strict';
var inventory=[], appNameCount={}, rules=[], selected=null, feedbackTimer, lastSeq=0, lastDevice='', closeFocus=null;
var $=function(id){return document.getElementById(id)};
function appLabel(a){var n=a.name||a.appId;return appNameCount[n]>1?n+' ('+a.appId+')':n}
function esc(s){return String(s==null?'—':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function say(s){$('feedback').textContent=s;$('feedback').hidden=false;clearTimeout(feedbackTimer);feedbackTimer=setTimeout(function(){$('feedback').hidden=true},6000)}
function api(url,body){return fetch(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json().then(function(d){if(!r.ok||d.ok===false)throw Error(d.error||'Action failed');return d})})}
function bytes(n){return n==null?'Unavailable':n<1048576?Math.round(n/1024)+' KB':(n/1048576).toFixed(1)+' MB'}
function icon(a){var initial=(a.name||a.appId||'').trim().slice(0,1).toUpperCase(),fallback=a.show?'<span>'+esc(initial)+'</span>':'<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m12 3 8 4v10l-8 4-8-4V7Z M4 7l8 4 8-4 M12 11v10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';return '<span class="icon">'+fallback+(a.iconPath?'<img alt="" loading="lazy" src="/apps/icon?appId='+encodeURIComponent(a.appId)+'" onerror="this.remove()">':'')+'</span>';}


function loadApps(refresh,strict){return api('/apps'+(refresh?'?refresh=1':'')).then(function(d){if(strict&&d.registryError)throw Error('TV registry unavailable: '+d.registryError);inventory=d.apps;if(currentPanel==='dock')renderDock();$('count').textContent=d.summary.total;$('inventorySource').textContent=d.registryError?'Probe data; registry details unavailable':d.source==='package registry + public probe'?'Probe and TV registry · expand a row for components':'Probe data';render();var pickable=inventory.filter(function(a){return a.show&&!a.disabled}).sort(function(a,b){return(a.name||a.appId).localeCompare(b.name||b.appId)||a.appId.localeCompare(b.appId)});appNameCount={};pickable.forEach(function(a){var n=a.name||a.appId;appNameCount[n]=(appNameCount[n]||0)+1});$('targetApp').innerHTML='<option value="">Select an app…</option>'+pickable.map(function(a){return '<option value="'+esc(a.appId)+'">'+esc(appLabel(a))+'</option>'}).join('');var previous=$('mqttTarget').value;$('mqttTarget').innerHTML=$('targetApp').innerHTML;$('mqttTarget').value=previous;if(bootData){bootData.apps=inventory;renderStartup()}renderQuick();return d;}).catch(function(e){if(strict)throw e;$('appGrid').textContent='Inventory unavailable. '+e.message;say(e.message)})}
var componentAvailability=${componentAvailability.toString()},verifiedDisableIds=${JSON.stringify(verifiedDisableIds)};
function depList(list){return !list?'Unknown':!list.length?'None declared':list.map(function(d){return '<div class="deps">'+esc(d.packageId)+'<small>'+esc(d.type)+(d.version?' · version '+esc(d.version):'')+'</small></div>'}).join('')}
function commandButton(id,label,reason,primary){return '<div class="drawer-command"><button id="'+id+'"'+(primary?' class="primary"':'')+(reason?' disabled':'')+' aria-describedby="'+id+'Reason"'+'>'+label+'</button>'+'<p id="'+id+'Reason" class="muted"'+(reason?'':' hidden')+'>'+esc(reason||'')+'</p>'+'</div>';}
function detailMarkup(a){
 var cap=componentAvailability(a,inventory,verifiedDisableIds),u=usage([a]);
 var stopReason=cap.flags.reason||(!u.known?'Process state is unavailable. Refresh state to check it.':!u.count?'No linked processes in the latest sample.':'');
 return '<button id="closeDetail">Close ×</button>'+icon(a)+'<h2>'+esc(a.name||a.appId)+'</h2><code>'+esc(a.appId)+'</code>'+'<div class="drawer-about">'+(a.purpose?'<p>'+esc(a.purpose)+'</p>':'')+'<div class="row">'+roleChip(a.role)+'<span class="muted">'+esc(areaLabels[a.area]||'')+'</span></div>'+((a.startsOn||[]).length?'<p class="notice">The firmware starts it on '+esc(a.startsOn.join(' and '))+'s, so the flags alone do not keep it off. Disable it to stop those launches.</p>':'')+((a.access||[]).length?'<p class="notice">May use: '+esc(a.access.join(', '))+'.</p>':'')+(Array.isArray(a.referencedBy)?(a.referencedBy.length?'<details><summary>Mentioned by '+a.referencedBy.length+' other package'+(a.referencedBy.length===1?'':'s')+'</summary><p class="notice">Packages whose files name this one: a hint, not proof of dependency.</p><ul class="member-list">'+a.referencedBy.map(function(r){return '<li><span class="small-mono">'+esc(r)+'</span></li>'}).join('')+'</ul></details>':'<p class="notice">No other package in this firmware names it.</p>'):'')+'</div>'+
 '<div class="drawer-state"><span>App state <strong id="componentAppState">'+groupTag({members:[a]})+'</strong></span><span>Processes <span id="componentRuntime">'+runtimeTag([a])+'</span></span></div>'+
 '<div class="component-tools"><h3>Actions</h3><div class="drawer-actions">'+commandButton('launchApp','Open app',cap.launch.reason,true)+commandButton('toggleApp',a.disabled?'Enable':'Disable',cap.toggle.reason)+commandButton('stopComponent','Stop now',stopReason)+commandButton('uninstallComponent','Uninstall package',cap.uninstall.reason)+'</div>'+
 '<div id="componentConfirmation" class="component-confirmation" hidden></div><p id="componentProgress" class="notice" role="status" aria-live="polite"></p><p id="componentUsage" class="notice">'+(u.known?u.count+' linked processes':'Process state unknown')+' · CPU '+number(u.cpu)+(u.cpu==null?'':'%')+' · RSS '+memory(u.rss)+'. RSS includes shared memory.</p>'+
 '<h3>Startup</h3><label class="switch"><input type="checkbox" role="switch" id="bootFlag" '+(a.onboot?'checked':'')+' '+(!cap.flags.allowed||a.onboot==null?'disabled':'')+'><span>Start at boot'+(a.onboot==null?' · Unknown':'')+'</span></label><label class="switch"><input type="checkbox" role="switch" id="restartFlag" '+(a.autorestart?'checked':'')+' '+(!cap.flags.allowed||a.autorestart==null?'disabled':'')+'><span>Restart automatically'+(a.autorestart==null?' · Unknown':'')+'</span></label><p class="muted">'+esc(cap.flags.reason||'Flags are independent of app state. Other components may still start the app.')+'</p><button id="refreshDetail">Refresh state</button></div>'+
 '<details class="component-tools"><summary>Package details</summary><dl><dt>Package</dt><dd>'+esc(a.packageId)+'</dd><dt>Version</dt><dd>'+esc(a.version)+'</dd><dt>Size</dt><dd>'+bytes(a.size)+'</dd><dt>Author</dt><dd>'+esc(a.author)+'</dd><dt>Category</dt><dd>'+esc(categories[a.category]||'Other')+'<br><span class="muted">'+esc(a.categoryReason||'Classification unavailable')+'</span></dd><dt>Type</dt><dd>'+esc(a.type)+' · '+esc(a.component)+'</dd><dt>System</dt><dd>'+(a.system==null?'Unknown':a.system?'Yes':'No')+'</dd><dt>Removable</dt><dd>'+(a.removable==null?'Unknown':a.removable?'Yes':'No')+'</dd></dl><h3>Declared dependencies</h3>'+depList(a.dependencies)+'<h3>Declared dependents</h3>'+depList(a.dependents)+'<p class="notice">Registry dependencies only. Other links may exist.</p></details>';
}
function detail(id){
 if(componentBusy){say('Wait for the current action to finish.');return}
 selected=inventory.find(function(a){return a.appId===id});if(!selected)return;
 var a=selected;closeFocus=document.activeElement;$('detail').innerHTML=detailMarkup(a);$('detail').scrollTop=0;
 $('overlay').hidden=false;$('detail').hidden=false;$('closeDetail').focus();$('closeDetail').onclick=closeDetail;
 bindComponentControls(a);
 if(!processData||Date.now()-processData.ts>=30000)sampleOnce();
}
function closeDetail(){$('detail').hidden=true;$('overlay').hidden=true;if(closeFocus)closeFocus.focus()}
$('overlay').onclick=closeDetail;document.addEventListener('keydown',function(e){if($('detail').hidden)return;if(e.key==='Escape')closeDetail();if(e.key==='Tab'){var nodes=$('detail').querySelectorAll('button:not(:disabled),a,input,select');var first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}});
$('appGrid').onclick=function(e){var b=e.target.closest('[data-app]');if(b)detail(b.dataset.app)};$('search').oninput=render;$('category').onchange=render;$('refresh').onclick=function(){loadApps(true)};
function showRules(){renderMqttRules();$('rules').innerHTML=rules.length?rules.map(function(r){var a=r.actions[0],name=a.type==='launch'?appLabel(inventory.find(function(x){return x.appId===a.appId})||{appId:a.appId}):a.key||a.type;return '<div class="rule"><div>'+(r.trigger.type==='physical'?'Key <code>'+esc(r.trigger.value)+'</code>':'<code>'+esc(r.trigger.type)+' / '+esc(r.trigger.value)+'</code>')+' → '+esc(name)+' <span class="muted">'+(r.enabled?'':'(off)')+'</span></div><button class="danger" data-delete="'+esc(r.id)+'">Delete</button></div>'}).join(''):'No saved shortcuts.'}
function loadRules(){return api('/remap').then(function(d){rules=d.rules;showRules()})}
$('rules').onclick=function(e){var id=e.target.dataset.delete;if(!id)return;return saveRuleSet(rules.filter(function(r){return r.id!==id}),'Delete shortcut',e.target)};
$('saveRule').onclick=function(){var code=$('inputCode').value,id=$('targetApp').value;if(!/^\\d{1,3}$/.test(code)||+code>767||!id){say('Capture a key and select an app');return}code=String(+code);var next=rules.filter(function(r){return !(r.trigger.type==='physical'&&r.trigger.value===code)});next.push({id:'physical_'+code,enabled:true,trigger:{type:'physical',value:code},actions:[{type:'launch',appId:id}]});return saveRuleSet(next,'Save shortcut',this)};
function policy(mode,device){return runUiOperation('rules',mode==='off'?'Stop interception':mode==='observe'?'Listen to remote':'Remote interception','Physical remote',mode==='observe'?$('observe'):$('filter'),function(mark){return api('/input',{device:device||$('device').value,mode:mode}).then(function(d){var p=d.status&&d.status.policy;if(!p||p.mode!==mode)throw Error('Remote mode not confirmed');lastSeq=0;pollInput();return {state:mode!=='off'&&!p.connected?'warning':'success',resultLabel:'State read',message:mode==='off'?'Interception stopped. Remote keys work normally.':!p.connected?'Mode requested, but the device connection is not confirmed. Check the state before testing keys.':mode==='observe'?'Listening connected. Keys work normally. Press a key to check the events.':'Interception connected. Test a configured key to check app launch. The setting will be restored when Vetro restarts.'}})})}
// Stopping capture returns to the saved choice: mode off would also save interception as off.
$('observe').onclick=function(){if(!inputListening)return policy('observe');var pref=inputPreferenceState;return pref&&pref.enabled&&(pref.node||pref.device)?policy('filter',pref.node||pref.device):policy('off')};$('filter').onchange=function(){return policy(this.checked?'filter':'off').then(function(){return pollInput()})};
var polling=false,inputListening=false,inputPreferenceState=null;function pollInput(){if(polling)return;polling=true;return api('/input').then(function(d){var value=$('device').value, options=d.devices.filter(function(x){return x.selectable});if(options.map(function(x){return x.node}).join('|')!==lastDevice){lastDevice=options.map(function(x){return x.node}).join('|');$('device').innerHTML=options.length?'<option value="auto">Detect automatically (listen only)</option>'+options.map(function(x){return '<option value="'+esc(x.node)+'">'+esc(x.name)+' · '+esc(x.node)+'</option>'}).join(''):'<option value="">No compatible device</option>';if(options.some(function(x){return x.node===value}))$('device').value=value}var p=d.status.policy;inputListening=p.mode==='observe';inputPreferenceState=d.status.preference||null;$('observe').textContent=inputListening?'Stop listening':'Start listening';if(!uiOperationBusy.rules)$('filter').checked=d.status.preference?d.status.preference.enabled:p.mode==='filter';if(p.node&&options.some(function(x){return x.node===p.node}))$('device').value=p.node;$('inputStatus').textContent=d.error||d.status.error|| (p.mode==='off'?(d.status.preference&&d.status.preference.enabled?'Interception enabled · waiting for remote':'Interception off'):(p.mode==='observe'?'Listening':'Interception')+' · '+p.device+(p.connected?' · connected':' · connecting…'));var down=d.status.events.filter(function(e){return e.action==='down'}), event=down[down.length-1];if(event&&event.node+':'+event.sequence!==lastSeq){lastSeq=event.node+':'+event.sequence;$('device').value=event.node;$('keyEvent').textContent=(event.key||'Key')+' · '+event.code;$('inputCode').value=event.code}}).catch(function(e){$('inputStatus').textContent=e.message}).finally(function(){polling=false})}
function k(key){api('/control',{key:key}).catch(function(e){say(e.message)})}
api('/status').then(function(d){$('connection').textContent=d.agent&&d.agent.connected?'TV connected · service running':'Service running · '+d.mode}).catch(function(){$('connection').textContent='TV unreachable'});

var categories={user:'User apps',media:'Media',ads:'Advertising / ACR',privacy:'Privacy',voice:'Voice assistants',connectivity:'Connectivity',hotel:'Hotel / retail',system:'System',protected:'Protected',other:'Other'};
var origins={installed:'Installed',preinstalled:'Preinstalled',system:'System',unknown:'Unknown'};
var areaLabels=${JSON.stringify(require('./app-catalog.js').AREAS)},roleLabels=${JSON.stringify(require('./app-catalog.js').ROLES)},roleFilter='all';
var processData=null;var inventoryNeedsRefresh=false;var currentPanel='quick',liveUntil=0,liveData=null,histCpu=[],histRam=[],monitorBusy=false,bootData=null,bootMode='apps';
var titles={quick:['Quick settings','Quick wins: each switch frees memory, stops tracking or keeps the TV as it is.'],actions:['History','Changes made in this session.'],diagnostics:['Diagnostics','A redacted technical snapshot.'],mqtt:['MQTT','Broker, status and rules.'],tvsettings:['TV settings','Current values and tested controls.'],dns:['Domain blocking','A local hosts filter; DNS servers stay unchanged.'],dashboard:['Dashboard','Resource usage. Live updates run for 2 minutes.'],processes:['Processes','Refreshed every 10 seconds during live updates.'],apps:['Task manager','Apps, running processes and what starts with the TV.'],startup:['Startup','Startup flags and system services.'],remote:['Remapper','Turn remote keys into app shortcuts, key presses and MQTT messages.'],control:['TV controls','Native TV commands.'],dock:['Launcher','Still in beta. A glass launcher on the Home key; Samsung’s Home is one press away.']};
function number(n,d){return n==null||!isFinite(n)?'—':n.toLocaleString('en-GB',{maximumFractionDigits:d==null?1:d})}
function memory(n){return n==null?'—':n>=1073741824?number(n/1073741824,2)+' GiB':number(n/1048576,0)+' MiB'}
function rate(n){return n==null?'—':n>=1048576?number(n/1048576,1)+' MiB/s':number(n/1024,0)+' KiB/s'}
function tag(s,good){return '<span class="tag '+(good?'good':'')+'">'+esc(s)+'</span>'}
var groupApps=${groupApps.toString()},expandedApps={},expandedBoot={};
function usage(members){var known=!!processData&&Date.now()-processData.ts<30000,ids=members.map(function(a){return a.appId}),p=known?(processData.processes||[]).filter(function(p){return ids.indexOf(p.appId)>=0}):[];return {known:known,count:p.length,cpu:known&&p.some(function(x){return x.cpuPercent!=null})?p.reduce(function(n,x){return n+(x.cpuPercent||0)},0):null,rss:known?p.reduce(function(n,x){return n+(x.rssBytes||0)},0):null};}
function useCells(members){var u=usage(members);return '<td class="numeric proc-col">'+(u.count&&u.cpu!=null?number(u.cpu)+'%':'—')+'</td><td class="numeric proc-col">'+(u.count?memory(u.rss):'—')+'</td>';}
function flagState(members,field){var on=members.filter(function(a){return a[field]===true}).length,off=members.filter(function(a){return a[field]===false}).length;return on===members.length?'On':off===members.length?'Off':on+off<members.length?'Unknown':'Mixed';}
function groupTag(g){var state=flagState(g.members,'disabled');return state==='On'?'Disabled':state==='Off'?'Enabled':state;}
function stateTag(text,kind){var title=/Mixed/.test(text)?'Components have different states. Expand the row to inspect each one.':/Unknown/.test(text)?'Not available in the latest verified data.':'';return '<span class="tag '+kind+'"'+(title?' title="'+title+'"':'')+'>'+esc(text)+'</span>';}
function runtimeTag(members){var u=usage(members);return stateTag(!u.known?'Unknown':u.count?'Running · '+u.count:'Not running',u.known&&u.count?'running':'off');}
function startupText(members){var parts=[];[['onboot','Boot'],['autorestart','Restart']].forEach(function(f){var s=flagState(members,f[0]);if(s==='On')parts.push(f[1]);else if(s==='Mixed')parts.push(f[1]+' (some)');else if(s==='Unknown')parts.push('<span class="muted" title="Not available in the latest verified data.">'+f[1]+' ?</span>');});return parts.length?'<span class="startup-flags">'+parts.join(' · ')+'</span>':'<span class="muted" title="Does not start at boot or restart automatically.">—</span>';}
function roleOf(members){var order=['tracking','unused','optional','keep'],roles=members.map(function(a){return a.role}).filter(Boolean);for(var i=0;i<order.length;i++)if(roles.indexOf(order[i])>=0)return order[i];return null;}
function roleChip(role){return role?'<span class="role role-'+role+'">'+esc(roleLabels[role])+'</span>':'<span class="muted">—</span>';}
function appStateCells(g){var enabled=groupTag(g),u=usage(g.members);return '<td>'+roleChip(roleOf(g.members))+'</td><td>'+stateTag(enabled,enabled==='Mixed'?'mixed':enabled==='Enabled'?'good':'off')+(u.known?'<small class="running-note'+(u.count?'':' off')+'">'+(u.count?'Running · '+u.count:'Not running')+'</small>':'')+'</td><td>'+startupText(g.members)+'</td>';}
function uniqueText(g,field,labels){var out=[];g.members.forEach(function(a){var v=labels?(labels[a[field]]||'Unknown'):a[field]||'—';if(out.indexOf(v)<0)out.push(v)});if(field==='category'&&out.length>1)out=out.filter(function(v){return v!==categories.other});return out.join(' / ');}
function groupName(g,expanded,duplicate){var more=g.members.length>1,purpose=(g.members.filter(function(a){return a.purpose})[0]||{}).purpose;return '<div class="app-name">'+icon(g.primary)+'<button '+(more?'data-group="'+esc(g.key)+'" aria-expanded="'+!!expanded+'"':'data-app="'+esc(g.primary.appId)+'"')+'>'+(more?'<span class="caret" aria-hidden="true">'+(expanded?'▾':'▸')+'</span>':'')+esc(g.name)+(duplicate?' <span class="muted">· '+esc(g.packages[0])+'</span>':'')+(purpose?'<span class="purpose">'+esc(purpose)+'</span>':'')+'<span class="mobile-role">'+roleChip(roleOf(g.members))+'</span>'+'<small>'+esc(g.packages.length===1?g.packages[0]:g.packages.length+' packages')+(more?' · '+g.members.length+' components':'')+' · '+esc(uniqueText(g,'area',areaLabels))+'</small></button></div>';}
function componentRow(a,boot){return '<tr class="component-row '+(a.disabled===true?'disabled-row':'')+'"><td><button data-app="'+esc(a.appId)+'">'+esc(a.name||a.appId)+'<small>'+esc(a.appId)+'</small><small>'+esc(areaLabels[a.area]||'Other')+' · '+esc(origins[a.origin]||'Unknown')+' · '+esc(a.version)+'</small></button></td>'+(boot?'<td>'+stateTag(flagState([a],'onboot'),a.onboot===true?'good':'off')+'</td><td>'+stateTag(flagState([a],'autorestart'),a.autorestart===true?'good':'off')+'</td><td>'+stateTag(groupTag({members:[a]}),a.disabled===false?'good':'off')+'</td>':appStateCells({members:[a]})+useCells([a]))+'</tr>';}
function render(){var q=$('search').value.toLowerCase(),area=$('category').value||'all',status=$('appStatus').value||'all';var all=groupApps(inventory),sampled=!!processData&&Date.now()-processData.ts<30000;function match(g,a,ignoreRole){return ((g.name||'')+' '+(a.name||'')+' '+a.appId+' '+a.packageId+' '+(a.purpose||'')).toLowerCase().indexOf(q)>=0&&(area==='all'||a.area===area)&&(ignoreRole||roleFilter==='all'||a.role===roleFilter)&&(status==='all'||status==='running'&&usage([a]).count||status==='visible'&&a.show||status==='disabled'&&a.disabled===true||status==='enabled'&&a.disabled===false||status==='stopped'&&usage([a]).known&&!usage([a]).count||status==='unknown'&&a.disabled==null)}var counts={all:0};all.forEach(function(g){var hit=g.members.filter(function(a){return match(g,a,true)});if(!hit.length)return;counts.all++;var r=roleOf(hit);if(r)counts[r]=(counts[r]||0)+1;});$('roleFilters').innerHTML=['all','tracking','unused','optional','keep'].map(function(r){return '<button data-role="'+r+'" aria-pressed="'+(roleFilter===r)+'">'+(r==='all'?'All':esc(roleLabels[r]))+' <span>'+(counts[r]||0)+'</span></button>'}).join('');var rows=all.filter(function(g){return g.members.some(function(a){return match(g,a,false)})}),names={};rows.forEach(function(g){names[g.name]=(names[g.name]||0)+1});$('appTable').className='app-table'+(sampled?'':' no-sample');$('appGrid').innerHTML=rows.map(function(g){return '<tr class="'+(g.members.every(function(a){return a.disabled})?'disabled-row':'')+'"><td>'+groupName(g,expandedApps[g.key],names[g.name]>1)+'</td>'+appStateCells(g)+useCells(g.members)+'</tr>'+(expandedApps[g.key]&&g.members.length>1?g.members.map(function(a){return componentRow(a,false)}).join(''):'')}).join('');$('empty').hidden=rows.length!==0;$('appCount').textContent=rows.length+' / '+all.length+' entries · '+inventory.length+' components';if(bootData){bootData.apps=inventory;renderStartup();}}
$('appGrid').onclick=function(e){var g=e.target.closest('[data-group]'),a=e.target.closest('[data-app]');if(g){expandedApps[g.dataset.group]=!expandedApps[g.dataset.group];render()}else if(a)detail(a.dataset.app)};

$('roleFilters').onclick=function(e){var b=e.target.closest('[data-role]');if(!b)return;roleFilter=b.dataset.role;render();};$('appStatus').onchange=render;
function switchPanel(name){currentPanel=name;document.querySelectorAll('[data-tab]').forEach(function(b){b.setAttribute('aria-selected',b.dataset.tab===(['apps','processes','startup'].indexOf(name)>=0?'apps':name)?'true':'false')});Object.keys(titles).forEach(function(k){$(k).hidden=k!==name});var debloatPanel=['apps','processes','startup'].indexOf(name)>=0;$('debloatModes').hidden=!debloatPanel;document.querySelectorAll('[data-mode]').forEach(function(b){b.setAttribute('aria-selected',b.dataset.mode===name?'true':'false')});$('pageTitle').textContent=debloatPanel?'Task manager':titles[name][0];$('betaTag').hidden=name!=='dock';$('pageSubtitle').textContent=titles[name][1];$('liveToggle').hidden=name!=='dashboard'&&name!=='processes'&&name!=='apps';$('sampleStatus').hidden=name!=='dashboard'&&name!=='processes'&&name!=='apps';if(name==='startup')loadStartup();if(name==='dns')loadDns();if(name==='remote')pollInput();if(name==='quick')loadQuick();if(name==='dock')loadDock();if(name==='tvsettings')loadTVSettings();if(name==='mqtt'){loadMqtt();loadRules();$('mqttTarget').innerHTML=$('targetApp').innerHTML;}if(name==='dashboard'||name==='processes'||name==='apps')pollMonitor();}
$('downloadDiagnostics').onclick=function(){var button=this;button.disabled=true;$('diagnosticStatus').textContent='Collecting data… this can take up to 20 seconds.';fetch('/diagnostics/download',{cache:'no-store'}).then(function(r){if(!r.ok)throw Error('Download failed. Try again when the TV is connected.');return r.json();}).then(function(d){if(d.format!=='vetro-diagnostics'||d.schemaVersion!==1||!d.sections)throw Error('Unexpected diagnostic response.');var content=JSON.stringify(d,null,2)+'\\n',url=URL.createObjectURL(new Blob([content],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='vetro-diagnostics.json';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url)},60000);var names=Object.keys(d.sections),ok=names.filter(function(k){return d.sections[k].status==='ok'}).length;$('diagnosticStatus').textContent='Report ready: '+ok+' / '+names.length+' sections.'+(ok<names.length?' Missing sections are marked in the file.':'')+' Nothing was uploaded.';}).catch(function(e){$('diagnosticStatus').textContent=e.message;}).finally(function(){button.disabled=false;});};
document.querySelectorAll('[data-tab]').forEach(function(b){b.onclick=function(){switchPanel(b.dataset.tab)}});document.querySelectorAll('[data-open]').forEach(function(b){b.onclick=function(){switchPanel(b.dataset.open)}});
function spark(values,max){var v=values.filter(function(n){return n!=null}),scale=max||Math.max.apply(Math,v.concat([1]));var pts=values.map(function(n,i){return n==null?null:((100-(values.length-1-i))*5)+','+(100-Math.max(0,Math.min(1,n/scale))*90)}).filter(Boolean).join(' ');return '<svg class="spark" viewBox="0 0 500 110" preserveAspectRatio="none" aria-hidden="true"><path class="gridline" d="M0 10H500 M0 55H500 M0 100H500"/><polyline points="'+pts+'"/></svg>'}
function updateComponentRuntime(u){
 var cap=componentAvailability(selected,inventory,verifiedDisableIds),reason=cap.flags.reason||(!u.known?'Process state is unavailable. Refresh state to check it.':!u.count?'No linked processes in the latest sample.':'');
 $('componentUsage').textContent=(u.known?u.count+' linked processes':'Process state unknown')+' · CPU '+number(u.cpu)+(u.cpu==null?'':'%')+' · RSS '+memory(u.rss)+'. RSS includes shared memory.';
 $('componentRuntime').innerHTML=stateTag(!u.known?'Unknown':u.count?'Running · '+u.count:'Not running',u.known&&u.count?'running':'off');
 $('stopComponent').disabled=componentBusy||!!reason;$('stopComponentReason').textContent=reason;$('stopComponentReason').hidden=!reason;
}
function drawMonitor(d){liveData=d;if(Array.isArray(d.processes))processData=d;$('connection').textContent='TV connected · service running';if(inventoryNeedsRefresh){inventoryNeedsRefresh=false;loadApps(true);}var t=d.telemetry||{},m=d.memory||{},cpu=d.cpu||{};histCpu.push(cpu.percent);histRam.push(m.availableBytes==null?null:m.availableBytes/1048576);if(histCpu.length>100){histCpu.shift();histRam.shift();}$('cpuValue').textContent=number(cpu.percent,0)+(cpu.percent==null?'':'%');$('cpuMeta').textContent=(cpu.cores||[]).length+' cores · '+(t.cpu_freq_khz?number(t.cpu_freq_khz/1000,0)+' MHz':'frequency unavailable');$('ramValue').textContent=memory(m.availableBytes);$('ramMeta').textContent='Total '+memory(m.totalBytes);$('diskValue').textContent=memory(d.storage&&d.storage.availableBytes);$('diskMeta').textContent=d.storage?number(d.storage.usedPercent,0)+'% used · '+d.storage.mount:'Unavailable';var rx=null,tx=null;(d.network||[]).forEach(function(n){if(n.rxPerSecond!=null){rx=(rx||0)+n.rxPerSecond;tx=(tx||0)+n.txPerSecond;}});$('networkValue').textContent=rate(rx)+' / '+rate(tx);$('networkMeta').textContent=(d.network||[]).map(function(n){return n.name}).join(' · ');$('cpuChart').innerHTML=spark(histCpu,100);$('ramChart').innerHTML=spark(histRam,m.totalBytes/1048576);$('cores').innerHTML=(cpu.cores||[]).map(function(c){return '<div class="core"><span>'+esc(c.name.toUpperCase())+'</span><div class="bar"><i style="width:'+(c.percent||0)+'%"></i></div><span class="numeric">'+number(c.percent,0)+(c.percent==null?'':'%')+'</span></div>'}).join('');$('uptime').textContent=d.uptimeSeconds==null?'—':'Uptime: '+number(d.uptimeSeconds/3600,1)+' h';$('loadValue').textContent='Load 1 / 5 / 15 min: '+(t.loadavg||'—').split(' ').slice(0,3).join(' / ');$('temperature').textContent=t.soctemp_c==null?'Temperature unavailable':'Temperature: '+number(t.soctemp_c)+' °C';$('zramLogical').textContent=memory(d.zram&&d.zram.logicalBytes);$('zramPhysical').textContent=memory(d.zram&&d.zram.physicalBytes);$('swapFree').textContent=memory(m.swapFreeBytes)+' / '+memory(m.swapTotalBytes);$('topProcesses').innerHTML=d.scope==='summary'?'<p class="muted">Open Task manager to sample processes.</p>':'<table><thead><tr><th>Process</th><th class="numeric">CPU</th><th class="numeric">RSS</th></tr></thead><tbody>'+(d.processes||[]).slice().sort(function(a,b){return (b.cpuPercent||0)-(a.cpuPercent||0)||b.rssBytes-a.rssBytes}).slice(0,5).map(function(p){return '<tr><td>'+esc(p.name)+'</td><td class="numeric">'+number(p.cpuPercent)+'%</td><td class="numeric">'+memory(p.rssBytes)+'</td></tr>'}).join('')+'</tbody></table>';if(d.processes){renderProcesses();if(currentPanel==='apps')render();}if(Array.isArray(d.processes)&&selected&&$('componentUsage')&&!$('detail').hidden){updateComponentRuntime(usage([selected]));}liveStatus();}
var states={R:'Running',S:'Waiting',D:'I/O wait',T:'Stopped',t:'Traced',Z:'Zombie',I:'Idle'};
function renderProcesses(){if(!liveData)return;var q=$('processSearch').value.toLowerCase(),kind=$('processKind').value||'all',sort=$('processSort').value||'cpu';var rows=liveData.processes.filter(function(p){return (p.name+' '+p.pid).toLowerCase().indexOf(q)>=0&&(kind==='all'||kind==='kernel'&&p.kernel||kind==='user'&&!p.kernel)});rows.sort(function(a,b){return sort==='memory'?b.rssBytes-a.rssBytes:sort==='pid'?a.pid-b.pid:sort==='name'?a.name.localeCompare(b.name):(b.cpuPercent||0)-(a.cpuPercent||0)||b.rssBytes-a.rssBytes});$('processRows').innerHTML=rows.map(function(p){return '<tr><td><button class="process-name" data-process="'+p.pid+'">'+esc(p.name)+'</button>'+(p.appId?'<small class="small-mono muted app-id">'+esc(p.appId)+'</small>':'')+'</td><td class="numeric muted">'+p.pid+'</td><td class="numeric">'+number(p.cpuPercent)+(p.cpuPercent==null?'':'%')+'</td><td class="numeric">'+memory(p.rssBytes)+'</td><td class="state">'+esc(states[p.state]||p.state)+(p.kernel?' · kernel':'')+'</td><td class="numeric muted">'+p.threads+'</td></tr>'}).join('')||'<tr><td colspan="6" class="empty">No matching processes.</td></tr>';$('processCount').textContent=rows.length+' / '+liveData.processCount+' processes';}
$('processSearch').oninput=renderProcesses;$('processKind').onchange=renderProcesses;$('processSort').onchange=renderProcesses;
$('processRows').onclick=function(e){var b=e.target.closest('[data-process]');if(!b||!liveData)return;var p=liveData.processes.find(function(x){return x.pid===+b.dataset.process});if(!p)return;closeFocus=document.activeElement;$('detail').innerHTML='<button id="closeDetail">Close ×</button><h2>'+esc(p.name)+'</h2><p class="muted">'+(p.kernel?'Kernel thread':'User-space process')+'</p><dl><dt>PID / parent</dt><dd>'+p.pid+' / '+p.ppid+'</dd><dt>State</dt><dd>'+esc(states[p.state]||p.state)+'</dd><dt>Sampled CPU</dt><dd>'+number(p.cpuPercent)+(p.cpuPercent==null?'':'%')+'</dd><dt>RSS memory</dt><dd>'+memory(p.rssBytes)+'</dd><dt>Virtual memory</dt><dd>'+memory(p.virtualBytes)+'</dd><dt>Thread</dt><dd>'+p.threads+'</dd></dl><p class="notice">RSS includes shared pages, so it is not the memory that stopping this process would free.</p>'+(p.appId?'<button id="manageProcessApp">Manage component</button>':'');$('overlay').hidden=false;$('detail').hidden=false;$('closeDetail').onclick=closeDetail;$('closeDetail').focus();if(p.appId)$('manageProcessApp').onclick=function(){detail(p.appId)};};
var monitorLastAt={};function pollMonitor(){var scope=currentPanel==='dashboard'?'summary':'full';if(Date.now()>=liveUntil||monitorBusy||document.hidden||['dashboard','processes','apps'].indexOf(currentPanel)<0||Date.now()-(monitorLastAt[scope]||0)<(scope==='summary'?5000:10000))return;monitorBusy=true;monitorLastAt[scope]=Date.now();api(scope==='summary'?'/monitor?scope=summary':'/monitor').then(drawMonitor).catch(function(e){$('sampleStatus').textContent='Data unavailable';$('cpuMeta').textContent=e.message}).finally(function(){monitorBusy=false});}
// Live sampling is off by default: each sample runs commands on the TV. A
// session lasts LIVE_MS and stops by itself; one-off refreshes stay available.
var LIVE_MS=120000;
function liveStatus(){var left=Math.max(0,Math.ceil((liveUntil-Date.now())/1000)),last=liveData?' · last sample '+new Date(liveData.ts).toLocaleTimeString('en-GB'):'';if(left>0)$('sampleStatus').innerHTML='<i class="live-dot"></i>Live · '+Math.floor(left/60)+':'+('0'+left%60).slice(-2)+' left'+esc(last);else $('sampleStatus').textContent='Live updates off'+last;$('liveToggle').textContent=left>0?'Stop live':'Start live · 2 min';}
function setLive(on){liveUntil=on?Date.now()+LIVE_MS:0;liveStatus();if(on){monitorLastAt={};pollMonitor();}}
function sampleOnce(){if(monitorBusy)return;monitorBusy=true;api('/monitor').then(drawMonitor).catch(function(){}).finally(function(){monitorBusy=false});}
$('liveToggle').onclick=function(){setLive(Date.now()>=liveUntil);};
function renderStartup(){if(!bootData)return;var q=$('startupSearch').value.toLowerCase(),flagged=$('startupFilter').value!=='all';$('startupRows').innerHTML=groupApps(bootData.apps).filter(function(g){return g.members.some(function(a){return (g.name+' '+a.appId+' '+a.packageId+' '+(a.name||'')).toLowerCase().indexOf(q)>=0&&(!flagged||a.onboot||a.autorestart)})}).map(function(g){return '<tr><td>'+groupName(g,expandedBoot[g.key])+'</td><td>'+stateTag(flagState(g.members,'onboot'),flagState(g.members,'onboot')==='On'?'good':flagState(g.members,'onboot')==='Mixed'?'mixed':'off')+'</td><td>'+stateTag(flagState(g.members,'autorestart'),flagState(g.members,'autorestart')==='On'?'good':flagState(g.members,'autorestart')==='Mixed'?'mixed':'off')+'</td><td>'+tag(groupTag(g),g.members.every(function(a){return a.disabled===false}))+'</td></tr>'+(expandedBoot[g.key]&&g.members.length>1?g.members.map(function(a){return componentRow(a,true)}).join(''):'')}).join('')||'<tr><td colspan="4" class="empty">No apps.</td></tr>' ;$('serviceRows').innerHTML=bootData.services.filter(function(s){return (s.name+' '+s.description).toLowerCase().indexOf(q)>=0&&(!flagged||/^enabled/.test(s.bootState||''))}).map(function(s){return '<tr><td><span class="small-mono">'+esc(s.name)+'</span></td><td>'+tag(s.bootState||'Unknown',/^enabled/.test(s.bootState||''))+'</td><td>'+tag(s.active,s.active==='active')+'</td><td>'+esc(s.sub)+'</td></tr>'}).join('')||'<tr><td colspan="4" class="empty">No matching services.</td></tr>';$('serviceNote').textContent=bootData.serviceError?'Services unavailable: '+bootData.serviceError:'System services are read-only. Static ones may start through dependencies.';}
function loadStartup(){return api('/startup').then(function(d){bootData=d;renderStartup()}).catch(function(e){say(e.message)})}
$('startupSearch').oninput=renderStartup;$('startupFilter').onchange=renderStartup;$('refreshStartup').onclick=loadStartup;$('startupRows').onclick=function(e){var g=e.target.closest('[data-group]'),a=e.target.closest('[data-app]');if(g){expandedBoot[g.dataset.group]=!expandedBoot[g.dataset.group];renderStartup()}else if(a)detail(a.dataset.app)};
document.querySelectorAll('[data-startup]').forEach(function(b){b.onclick=function(){bootMode=b.dataset.startup;document.querySelectorAll('[data-startup]').forEach(function(x){x.setAttribute('aria-selected',x===b?'true':'false')});$('startupApps').hidden=bootMode!=='apps';$('startupServices').hidden=bootMode!=='services';}});

var componentBusy=false,operationEntries=[],operationSeq=0;
function operationUpdate(entry,state,message){
 entry.state=state;entry.message=message;if(state!=='pending'&&entry.toasted!==state){entry.toasted=state;actionToast(entry);}
 $('operationLog').hidden=false;$('operationEmpty').hidden=true;$('actionsCount').hidden=false;$('actionsCount').textContent=operationEntries.length;
 $('operationSummary').textContent='History · '+(operationEntries.some(function(x){return x.state==='pending'})?'in progress':'this session');
 $('operationItems').innerHTML=operationEntries.map(function(x){return '<div class="operation-item" data-state="'+x.state+'"><small>'+esc(x.time)+' · '+esc(x.target)+'</small><br><strong>'+esc(x.label)+' · '+esc(x.state==='pending'?'In progress':x.state==='warning'?'Check result':x.resultLabel||'Confirmed')+'</strong><p>'+esc(x.message)+'</p></div>'}).join('');
 if(selected&&selected.appId===entry.appId&&!$('detail').hidden)$('componentProgress').textContent=message;
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
 return runUiOperation('rules',label,'Remapper',button,function(mark){return api('/remap',{rules:next}).then(function(d){
  if(!Array.isArray(d.rules)||JSON.stringify(ruleShape(d.rules))!==JSON.stringify(ruleShape(next)))throw Error('Returned rules do not match the requested change');
  rules=d.rules;showRules();
  if(d.persisted!==true)return {state:'warning',message:'Rules updated in memory, but saving to disk was not confirmed. They may be lost on restart. Saved interception resumes automatically when physical shortcuts are available.'};
  return {resultLabel:'Saved',message:'Rules saved to disk. Saved interception resumes automatically when physical shortcuts are available. Test the actions separately. MQTT needs a connected broker.'};
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
function runComponentAction(a,p){
 if(componentBusy)return Promise.resolve(false);
 componentBusy=true;
 var unlock=lockComponentControls(),entry={id:++operationSeq,appId:a.appId,target:(a.name||a.appId)+(p.action==='uninstall'?' · '+a.packageId:''),time:new Date().toLocaleTimeString('en-GB'),label:{disable:'Disable app',enable:'Enable app',stop:'Stop',uninstall:'Uninstall',flags:p.flag==='onboot'?'Start at boot':'Auto restart'}[p.action]};
 operationEntries.unshift(entry);operationEntries=operationEntries.slice(0,10);
 operationUpdate(entry,'pending','Sending the command and checking the TV state…');
 var verified=false,outcome='';
 return api(p.action==='disable'||p.action==='enable'?'/debloat':'/components/action',p.action==='disable'||p.action==='enable'?{action:p.action,appIds:[p.appId]}:p).then(function(r){
  if(r.verified!==true)throw Error('The service did not confirm the requested state.');
  verified=true;outcome=componentOutcome(p,r);if(p.action==='uninstall'){closeDetail();}
  operationUpdate(entry,'pending',outcome+' Refreshing views…');
  return loadApps(true,true).then(function(){return api('/monitor').then(drawMonitor)});
 }).then(function(){operationUpdate(entry,'success',outcome+' App list and processes refreshed.');return true}).catch(function(e){
  inventoryNeedsRefresh=true;
  operationUpdate(entry,'warning',verified?outcome+' State confirmed, but the view could not refresh: '+e.message+'. Refresh the view; do not repeat the command.':'Result not confirmed: '+e.message+'. The command may have taken effect. Refresh the state before trying again.');
  return false;
 }).finally(function(){componentBusy=false;unlock();if(selected&&!$('detail').hidden){var fresh=inventory.find(function(r){return r.appId===a.appId});if(fresh)detail(fresh.appId);}operationUpdate(entry,entry.state,entry.message)});
}
function confirmComponentAction(a,p,label,message,trigger){
 if(componentBusy)return;
 var panel=$('componentConfirmation');panel.hidden=false;
 panel.innerHTML='<h3>'+esc(label)+'</h3><p>'+esc(message)+'</p><div class="drawer-actions"><button id="cancelComponentAction">Cancel</button><button id="confirmComponentAction">'+esc(label)+'</button></div>';
 $('cancelComponentAction').onclick=function(){panel.hidden=true;panel.innerHTML='';if(trigger)trigger.focus()};
 $('confirmComponentAction').onclick=function(){if(this.disabled)return;this.disabled=true;panel.hidden=true;panel.innerHTML='';return runComponentAction(a,p)};
 $('cancelComponentAction').focus();if(panel.scrollIntoView)panel.scrollIntoView({block:'nearest'});
}
function bindComponentControls(a){
 function act(p){return runComponentAction(a,p)}
 $('toggleApp').onclick=function(){if(this.disabled)return;var p={action:a.disabled?'enable':'disable',appId:a.appId};if(a.disabled)return act(p);return confirmComponentAction(a,p,'Confirm disable','Disable '+(a.name||a.appId)+'? Existing processes may keep running. '+(a.dependents&&a.dependents.length?'Declared dependents: '+a.dependents.length+'.':''),this)};
 $('bootFlag').onchange=function(){return act({action:'flags',appId:a.appId,flag:'onboot',enabled:this.checked})};
 $('restartFlag').onchange=function(){return act({action:'flags',appId:a.appId,flag:'autorestart',enabled:this.checked})};
 $('stopComponent').onclick=function(){if(this.disabled)return;return confirmComponentAction(a,{action:'stop',appId:a.appId},'Confirm stop','Stop '+(a.name||a.appId)+'? Auto restart may start it again.',this)};
 $('uninstallComponent').onclick=function(){if(this.disabled)return;var siblings=inventory.filter(function(r){return r.packageId===a.packageId});return confirmComponentAction(a,{action:'uninstall',appId:a.appId},'Confirm uninstall','Uninstall package '+a.packageId+' and all '+siblings.length+' of its components? This removes '+siblings.map(function(r){return r.name||r.appId}).join(', ')+'. Reinstall the package to restore it.',this)};
 $('launchApp').onclick=function(){if(this.disabled)return;return runUiOperation('component-launch','Open app',a.name||a.appId,this,function(){return api('/apps/launch',{appId:a.appId}).then(function(){return {resultLabel:'Requested',message:'Launch command accepted. Check the TV screen to confirm the app opened.'}})})};
 $('refreshDetail').onclick=function(){var button=this;button.disabled=true;return loadApps(true,true).then(function(){return api('/monitor').then(drawMonitor)}).then(function(){var row=inventory.find(function(r){return r.appId===a.appId});if(row)detail(a.appId);else{closeDetail();say('Component is no longer installed.')}}).catch(function(e){$('componentProgress').textContent='Refresh failed: '+e.message}).finally(function(){button.disabled=false})};
}
function dnsState(d){quickData.dns=d;renderQuick();$('dnsEnabled').checked=d.enabled;$('dnsEnabled').disabled=!d.enabled&&!d.domains.length;$('dnsDomains').value=d.domains.join('\\n');$('dnsStatus').textContent=d.applied?'Filter applied on TV · '+d.domains.length+' domains'+(d.namespaceWarnings&&d.namespaceWarnings.length?' · '+d.namespaceWarnings.length+' inaccessible namespaces':''):d.enabled?'Filter configured, but not applied':'Filter off';$('dnsResolvers').textContent='Current DNS servers (read-only): '+d.resolvers.join(' · ');}
function loadDns(){api('/dns').then(dnsState).catch(function(e){$('dnsStatus').textContent=e.message})}
function domainButtons(domains){return domains.map(function(d){return '<button data-domain="'+esc(d)+'">+ '+esc(d)+'</button>'}).join(' ');}
$('dnsCandidates').innerHTML=${JSON.stringify(require('./blocklist.js').publicGroups())}.map(function(g){return '<h4>'+esc(g.label)+'</h4><p class="section-note">'+esc(g.note)+'</p>'+domainButtons(g.hosts)}).join('');
['dnsCandidates','dnsObserved'].forEach(function(id){$(id).onclick=function(e){var b=e.target.closest('[data-domain]');if(!b)return;var list=$('dnsDomains').value.split(/\\s+/).filter(Boolean);if(list.indexOf(b.dataset.domain)<0)list.push(b.dataset.domain);$('dnsDomains').value=list.join('\\n');}});
$('dnsEnabled').onchange=function(){return setDns(this.checked)};
$('mqttTls').onchange=function(){$('mqttCaField').hidden=!this.checked};
$('saveDns').onclick=function(){var p={action:'apply',enabled:$('dnsEnabled').checked,domains:$('dnsDomains').value.split(/\\s+/).filter(Boolean)};
return runUiOperation('dns','Domain filter','TV hosts',this,function(mark){return api('/dns',p).then(function(d){
 var expected=p.domains.map(function(x){return x.toLowerCase().trim()}).filter(function(x,i,a){return a.indexOf(x)===i}).sort();
 if(d.enabled!==p.enabled||!Array.isArray(d.domains)||JSON.stringify(d.domains.slice().sort())!==JSON.stringify(expected))throw Error('Filter configuration not confirmed');
 dnsState(d);
 var message=p.enabled?'Configuration saved. System hosts: '+(d.applied?'filter detected':'filter not detected')+'.':'Filter disabled. System hosts: '+(d.applied?'filter still detected':'filter not detected')+'.';
 var warnings=(d.namespaceWarnings||[]).length,partial=p.enabled!==d.applied||warnings>0;
 return {state:partial?'warning':'success',resultLabel:'State read',message:message+(warnings?' '+warnings+' inaccessible namespaces.':'')+' Custom DNS servers unchanged. App caches and private resolvers may bypass hosts. Blocking real app requests has not been verified.'};
})});};
$('observeDns').onclick=function(){var b=this;b.disabled=true;$('dnsObserved').textContent='Observing requests…';api('/dns',{action:'observe'}).then(function(d){$('dnsObserved').innerHTML=d.domains.length?domainButtons(d.domains):'No UDP DNS requests observed during this capture.'}).catch(function(e){$('dnsObserved').textContent=e.message}).finally(function(){b.disabled=false})};
document.querySelectorAll('[data-mode]').forEach(function(b){b.onclick=function(){switchPanel(b.dataset.mode)}});
var mqttLoaded=false,mqttPolling=false,mqttPending=null;
function loadMqtt(strict){if(mqttPolling){if(strict)return mqttPending.then(function(){return loadMqtt(true)});return mqttPending}mqttPolling=true;return mqttPending=api('/mqtt').then(function(d){var c=d.config||{},x=d.status||{};if(!mqttLoaded){$('mqttEnabled').checked=!!c.enabled;$('mqttHost').value=c.host||'';$('mqttPort').value=c.port||(c.tls?8883:1883);$('mqttUser').value=c.username||'';$('mqttPrefix').value=c.topicPrefix||'vetro';$('mqttDevice').value=c.deviceName||'Vetro';$('mqttTls').checked=!!c.tls;$('mqttCaField').hidden=!c.tls;$('mqttCa').value=c.ca||'';mqttLoaded=true;}$('mqttCredential').textContent=c.hasPassword?'Password saved; it is not sent back to this page':'No password saved';var names={disabled:'Off',connecting:'Connecting',connected:'Connected to broker',reconnecting:'Reconnecting'};$('mqttState').textContent=(names[x.state]||'State unavailable')+(x.lastError?' · '+x.lastError:'');$('mqttStats').textContent=(x.identity?'Device '+x.identity+' · '+(x.identityPersistent?'saved identity':'temporary identity')+' · ':'')+(x.availabilityTopic?'Availability: '+x.availabilityTopic+' · ':'')+(x.sent||0)+' sent · '+(x.received||0)+' messages received'+(x.connectedAt?' · connected since '+new Date(x.connectedAt).toLocaleTimeString('en-GB'):'');$('mqttSubscriptions').innerHTML=(x.subscriptions||[]).map(function(s){return '<p><code>'+esc(s.topic)+'</code> · '+esc({active:'Subscribed',pending:'Awaiting confirmation',refused:'Refused'}[s.status])+'</p>'}).join('');$('mqttLog').innerHTML=(x.events||[]).slice().reverse().slice(0,12).map(function(e){return '<div>'+new Date(e.ts).toLocaleTimeString('en-GB')+' · '+esc(e.message)+'</div>'}).join('')||'No events.';return d;}).catch(function(e){$('mqttState').textContent=e.message;if(strict)throw e}).finally(function(){mqttPolling=false;mqttPending=null})}
$('saveMqtt').onclick=function(){var p={enabled:$('mqttEnabled').checked,host:$('mqttHost').value.trim(),port:Number($('mqttPort').value),username:$('mqttUser').value,topicPrefix:$('mqttPrefix').value,deviceName:$('mqttDevice').value,tls:$('mqttTls').checked,ca:$('mqttCa').value};if($('mqttClearPassword').checked)p.password='';else if($('mqttPassword').value)p.password=$('mqttPassword').value;
return runUiOperation('mqtt','MQTT configuration','MQTT broker',this,function(mark){return api('/mqtt',p).then(function(d){
 if(!d.config||d.config.enabled!==p.enabled)throw Error('Configuration save not confirmed');
 $('mqttPassword').value='';$('mqttClearPassword').checked=false;
 var state=(d.status||{}).state,message='Configuration saved. '+(state==='connected'?'Connected to the broker.':state==='disabled'?'MQTT is off.':'Broker connection not confirmed. Check the Connection panel.');
 mark(message,'Saved');return loadMqtt(true).then(function(){return {resultLabel:'Saved',message:message+' Saving does not confirm message delivery to Home Assistant.'}});
})});};
$('mqttActionType').onchange=function(){$('mqttAppField').hidden=this.value!=='launch';$('mqttKeyField').hidden=this.value!=='key';$('mqttPublishFields').hidden=this.value!=='mqtt'};
function renderMqttRules(){$('mqttRules').innerHTML=rules.map(function(r){return '<div class="rule"><span><code>'+esc(r.trigger.type+' / '+r.trigger.value)+'</code>'+(r.trigger.payload!=null?' · required payload':'')+' → '+r.actions.map(function(a){return esc(a.type==='mqtt'?'MQTT '+a.topic:a.type==='launch'?a.appId:a.key)}).join(', ')+' · '+(r.enabled?'On':'Off')+'</span><button data-mqtt-toggle="'+esc(r.id)+'">'+(r.enabled?'Turn off':'On')+'</button><button class="danger" data-mqtt-delete="'+esc(r.id)+'">Delete</button></div>';}).join('')||'No rules.';}
$('mqttRules').onclick=function(e){var id=e.target.dataset.mqttDelete||e.target.dataset.mqttToggle;if(!id)return;var next=rules.filter(function(r){return !e.target.dataset.mqttDelete||r.id!==id}).map(function(r){return r.id===id&&e.target.dataset.mqttToggle?Object.assign({},r,{enabled:!r.enabled}):r});return saveRuleSet(next,e.target.dataset.mqttDelete?'Delete rule':'Rule state',e.target)};
$('saveMqttRule').onclick=function(){var type=$('mqttTriggerType').value,trigger={type:type,value:$('mqttTrigger').value.trim()},kind=$('mqttActionType').value;if(type==='mqtt'&&$('mqttMatch').value)trigger.payload=$('mqttMatch').value;var action=kind==='launch'?{type:kind,appId:$('mqttTarget').value}:kind==='key'?{type:kind,key:$('mqttKey').value}:{type:kind,topic:$('mqttOutput').value.trim(),payload:$('mqttPayload').value};var next=rules.concat([{id:'rule_'+Date.now(),enabled:true,trigger:trigger,actions:[action]}]);return saveRuleSet(next,'Add rule',this)};
setInterval(function(){if(currentPanel==='mqtt'&&!document.hidden)loadMqtt()},3000);
var tvSettingsData=null,settingBusy=false,settingsSection='picture',catalogData=null,catalogValues={},catalogError=null,privacyData=null,hbbtvData=null,privacyError=null;
function settingDisplay(x){return x.error?'Unavailable':x.value==null?'Unknown':x.boolean?(x.value?'On':'Off'):x.options&&x.options[x.value]?x.options[x.value]:x.coded?'Code '+x.value:x.value;}
function settingNote(x){return (x.hint?'<div class="muted">'+esc(x.hint)+'</div>':'')+(x.access==='firmware'?'<div class="muted">Confirmed by this TV; not yet tested by the maintainer.</div>':'');}
function settingEdit(x){if(!x.writable)return '<span class="muted">'+esc(x.error||x.readOnlyReason||'Write not tested')+'</span>';if(x.options)return '<select id="setting-'+x.id+'" aria-label="'+esc(x.label)+'">'+x.options.map(function(o,i){return '<option value="'+i+'" '+(x.value===i?'selected':'')+'>'+esc(o)+'</option>';}).join('')+'</select><button data-setting="'+x.id+'" '+(settingBusy?'disabled':'')+'>Save</button>'+settingNote(x);if(x.boolean)return '<select id="setting-'+x.id+'" aria-label="'+esc(x.label)+'"><option value="0" '+(x.value===0?'selected':'')+'>Off</option><option value="1" '+(x.value===1?'selected':'')+'>On</option></select><button data-setting="'+x.id+'" '+(settingBusy?'disabled':'')+'>Save</button>'+settingNote(x);return '<input type="number" id="setting-'+x.id+'" aria-label="'+esc(x.label)+'" min="'+x.min+'" max="'+x.max+'" step="1" value="'+x.value+'"><button data-setting="'+x.id+'" '+(settingBusy?'disabled':'')+'>Save</button>'+settingNote(x);}
function settingsList(pairs,q){return '<dl>'+pairs.filter(function(p){return !q||(p[0]+' '+(p[1]==null?'':p[1])).toLowerCase().indexOf(q)>=0}).map(function(p){return '<dt>'+esc(p[0])+'</dt><dd>'+esc(p[1]==null||p[1]===''?'Unknown':p[1])+'</dd>'}).join('')+'</dl>';}
function renderNetworkSettings(n,q){var a=n.active||{},v4=a.ipv4||{},v6=a.ipv6||{},v6c=a.ipv6Configured||{},type={ethernet:'Ethernet · wired',wifi:'Wi-Fi'},state={ready:'Connected',online:'Connected · Internet checked by ConnMan',idle:'Disconnected',association:'Associating',configuration:'Configuring',failure:'Error',disconnect:'Disconnected'},method={dhcp:'Automatic · DHCP',manual:'Manual',auto:'Automatic',off:'Off'};
function dnsNames(list){return (list||[]).map(function(x){return x==='ipv4.dhcp'?'From IPv4 DHCP':x==='ipv6.unknown'?'IPv6 origin not reported':x;}).join(' · ');}
var pairs=[['Connection',type[a.type]||a.type],['State',state[a.state]||a.state],['Active interface',a.interface],['MAC address',a.mac],['IPv4 · method',method[v4.Method]||v4.Method],['IPv4 address',v4.Address],['Subnet mask',v4.Netmask],['Gateway IPv4',v4.Gateway],['DHCP server',v4.DHCPServerIP],['DHCP lease duration',v4.DHCPLeaseDuration==null?null:v4.DHCPLeaseDuration+' s'],['IPv6 · method',method[v6.Method]||v6.Method],['IPv6 address',v6.Address?v6.Address+'/'+v6.PrefixLength:null],['Gateway IPv6',v6.Gateway||v6c.Gateway||((n.defaultRoutes6||[]).find(function(r){return r.interface===a.interface})||{}).gateway],['System DNS servers',(n.resolvers||[]).join(' · ')],['ConnMan DNS servers',dnsNames(a.nameservers)],['Configured DNS in ConnMan',dnsNames(a.nameserversConfigured)],['Proxy',(a.proxy||{}).Method==='direct'?'Direct connection · no proxy':(a.proxy||{}).Method],['Auto connect',a.autoConnect==null?null:a.autoConnect?'On':'Off'],['MTU',a.mtu],['mDNS',a.mdns==null?null:a.mdns?'On':'Off']];
if(q&&!pairs.some(function(p){return (p[0]+' '+(p[1]==null?'':p[1])).toLowerCase().indexOf(q)>=0})&&!(n.interfaces||[]).some(function(i){return (i.name+' '+i.mac+' '+i.addresses.map(function(x){return x.address}).join(' ')).toLowerCase().indexOf(q)>=0}))return '';
var cards='<div class="panel"><h2>Active connection</h2>'+settingsList(pairs,q)+(n.configurationError?'<p class="notice">'+esc(n.configurationError)+'</p>':'')+'<p class="notice">Current values from ConnMan and the system. Network changes have not been tested.</p><div class="row"><button id="settingsToDns">Open domain blocking</button></div></div>';
var interfaces=(n.interfaces||[]).filter(function(i){return !q||(i.name+' '+i.mac+' '+i.state+' '+i.addresses.map(function(x){return x.address}).join(' ')).toLowerCase().indexOf(q)>=0;});
if(interfaces.length)cards+='<div class="panel"><h2>Available interfaces</h2><div class="table-wrap settings-table"><table><thead><tr><th>Interface</th><th>Connection</th><th>MAC</th><th>Addresses</th></tr></thead><tbody>'+interfaces.map(function(i){return '<tr><td>'+esc(i.name)+(i.name===a.interface?' · active':'')+'</td><td>'+esc({UP:'On',DOWN:'Disconnected',DORMANT:'Waiting',UNKNOWN:'Unknown'}[i.state]||i.state)+'</td><td>'+esc(i.mac)+'</td><td>'+i.addresses.map(function(x){return esc(x.address)+' <span class="muted">'+esc(x.scope)+'</span>';}).join('<br>')+'</td></tr>';}).join('')+'</tbody></table></div><p class="notice">Network passwords are not read.</p></div>';
return cards;}
function renderTVSettings(){if(settingsSection==='privacy'){renderPrivacy();return;}if(settingsSection==='catalog'){renderCatalog();return;}if(!tvSettingsData)return;var d=tvSettingsData,q=$('settingSearch').value.toLowerCase().trim(),names={picture:'Picture',audio:'Audio',advanced:'Advanced picture'},html='';
Object.keys(names).forEach(function(g){if(!q&&settingsSection!==g)return;var rows=d.items.filter(function(x){return x.group===g&&(!q||(x.label+' '+names[g]).toLowerCase().indexOf(q)>=0);});if(!rows.length)return;html+='<div class="panel"><h2>'+names[g]+'</h2><div class="table-wrap settings-table"><table><thead><tr><th>Setting</th><th>Value</th><th>Edit</th></tr></thead><tbody>'+rows.map(function(x){return '<tr><td>'+esc(x.label)+'</td><td>'+esc(settingDisplay(x))+'</td><td>'+settingEdit(x)+'</td></tr>';}).join('')+'</tbody></table></div></div>';});
if(settingsSection==='audio'&&!q)html+='<div class="panel"><h2>Volume and mute</h2><div class="row"><button data-audio-key="XF86AudioLowerVolume">Volume −</button><button data-audio-key="XF86AudioRaiseVolume">Volume +</button><button data-audio-key="XF86AudioMute">Toggle mute</button></div><p class="notice">Sends native volume keys; the current level is not shown.</p></div>';
if(settingsSection==='network'&&!q||q){html+=renderNetworkSettings(d.network||{},/^(network)$/.test(q)?'':q);}
if(!q&&settingsSection==='sources'||q&&/input|source|hdmi/.test(q))html+='<div class="panel"><h2>Inputs · TV / HDMI</h2><p class="notice">TV and HDMI input selection is not available yet.</p></div>';
if(!q&&settingsSection==='device'||q&&/model|firmware|region|smart hub/.test(q)){var labels={model:'Series',realModel:'Model',firmware:'Firmware',modelCode:'Model code',localSet:'Region',smartHubServer:'Smart Hub server'};html+='<div class="panel"><h2>TV information</h2>'+settingsList(Object.keys(d.device||{}).map(function(k){return [labels[k]||k,d.device[k]];}),q)+'</div>';}
$('settingGroups').innerHTML=html||'<p class="empty">No matching settings.</p>';if($('settingsToDns'))$('settingsToDns').onclick=function(){switchPanel('dns')};
$('settingStatus').textContent=d.error||('Read at '+new Date(d.ts).toLocaleTimeString('en-GB')+' · '+d.items.length+' values · '+d.items.filter(function(x){return x.writable}).length+' editable. '+d.scope);}
document.querySelectorAll('[data-settings-mode]').forEach(function(b){b.onclick=function(){settingsSection=b.dataset.settingsMode;$('settingSearch').value='';document.querySelectorAll('[data-settings-mode]').forEach(function(x){x.setAttribute('aria-selected',x===b?'true':'false')});if(settingsSection==='catalog')loadCatalog();else if(settingsSection==='privacy')loadPrivacy();else renderTVSettings();};});

function loadTVSettings(strict){if(!strict&&settingsSection==='privacy')return loadPrivacy();if(!strict&&settingsSection==='catalog')return loadCatalog();return api('/tv-settings').then(function(d){if(strict&&d.error)throw Error(d.error);tvSettingsData=d;renderTVSettings();return d}).catch(function(e){$('settingStatus').textContent=e.message;if(strict)throw e})}
$('settingSearch').oninput=renderTVSettings;$('refreshSettings').onclick=function(){return loadTVSettings()};
function loadPrivacy(strict){privacyError=null;return Promise.all([api('/privacy'),api('/hbbtv')]).then(function(d){privacyData=d[0];hbbtvData=d[1];renderPrivacy();renderQuick();}).catch(function(e){privacyError=e.message;renderPrivacy();if(strict)throw e;});}
function renderPrivacy(){if(settingsSection!=='privacy')return;function word(v,yesText,noText){return v==null?'Unknown':v?yesText:noText;}$('settingStatus').textContent=privacyError||'Privacy state from the TV. Consents are read-only.';if(!privacyData){$('settingGroups').textContent=privacyError||'Reading privacy state…';return;}var d=privacyData,h=hbbtvData||{},pairs=[['HbbTV app',word(d.hbbtv.appRunning,'Running','Not running')],['HbbTV stored value',h.value],['Saved previous value',h.restoreValue],['Do Not Track value',d.doNotTrack],['ACR recognition',d.acr.recognitionStatus],['Advertising ID',word(d.adId.psidPresent,'Present','Not present')],['TV Plus consent',word(d.tvPlusConsent,'Given','Not given')]];$('settingGroups').innerHTML='<div class="panel"><h2>Privacy and HbbTV</h2>'+(h.value!=null?hbbtvSwitch(h):'')+settingsList(pairs,'')+'<p class="notice">Saves the current value and reloads HbbTV. Check the red button on the TV afterwards.</p></div><div class="panel"><h2>Reported consents</h2>'+(d.agreementsAvailable===true?settingsList((d.agreements||[]).map(function(x){return [x.id,yes(x.agreed)];}),''):'<p>Consent state unavailable.</p>')+'<p class="notice">Consent changes have not been tested. '+esc(d.scope)+'</p></div>';}
function loadCatalog(){catalogError=null;return api('/tv-menu').then(function(d){catalogData=d;renderCatalog();}).catch(function(e){catalogError=e.message;renderCatalog();});}
function renderCatalog(){if(settingsSection!=='catalog')return;var q=$('settingSearch').value.toLowerCase().trim();$('settingStatus').textContent=catalogError||'Storage keys and provider controls use different access methods.';if(!catalogData){$('settingGroups').textContent=catalogError||'Reading catalog…';return;}var rows=catalogData.items.filter(function(x){return !q||(x.id+' '+x.group+' '+x.vconfKey+' '+x.provider).toLowerCase().indexOf(q)>=0;});$('settingGroups').innerHTML='<div class="panel"><h2>TV catalog · '+rows.length+' entries</h2><p class="notice">Some entries open TV panels or need a provider. Values are read one at a time; the effect of writes is untested.</p><div class="table-wrap settings-table"><table><thead><tr><th>Entry / group</th><th>Value / state</th><th>Source / access</th></tr></thead><tbody>'+rows.map(function(x){var v=catalogValues[x.id],status=v&&v.status||x.readStatus,readable=x.readable!==false&&status!=='storage-missing',label=v&&v.error?'Read failed: '+v.error:status==='provider-required'?(x.capability==='tv-panel'?'TV panel; availability not tested':'Requires a TV provider'):status==='storage-missing'?'Not available in storage':v&&v.value!=null?v.value:'Not read',access=x.capability==='tv-panel'?'TV panel; opening from Vetro not implemented':status==='provider-required'?'Provider access not implemented':status==='storage-missing'?'Storage key missing; runtime access not tested':(status==='storage-readable'?'Storage readable':'Storage read not tested')+' · Effect on TV not tested';return '<tr><td>'+esc(x.id)+'<br><span class="muted">'+esc(x.group||'Group not declared')+'</span></td><td>'+esc(label)+(readable?' <button data-catalog-id="'+esc(x.id)+'">Read value</button>':'')+'</td><td>'+esc(x.vconfKey)+'<br><span class="muted">'+esc(x.provider||'Provider not declared')+' · '+access+(x.danger?' · Protected setting':'')+'</span></td></tr>';}).join('')+'</tbody></table></div></div>';}

$('settingGroups').onchange=function(e){if(e.target.dataset&&e.target.dataset.hbbtvSwitch!=null)return setHbbtv(e.target.checked);};
$('settingGroups').onclick=function(e){var c=e.target.closest('[data-catalog-id]');if(c){c.disabled=true;var id=c.dataset.catalogId;api('/tv-menu?id='+encodeURIComponent(id)).then(function(d){catalogValues[id]=d;}).catch(function(e){catalogValues[id]={error:e.message};}).finally(renderCatalog);return;}var audio=e.target.closest('[data-audio-key]');if(audio){k(audio.dataset.audioKey);return;}var b=e.target.closest('[data-setting]');if(!b||settingBusy)return;var x=tvSettingsData.items.find(function(x){return x.id===b.dataset.setting}),v=Number($('setting-'+x.id).value);if(!$('setting-'+x.id).value.trim()||!Number.isInteger(v)||v<x.min||v>x.max){say('Allowed value: '+x.min+'–'+x.max);return}settingBusy=true;return runUiOperation('settings','Change setting',x.label,b,function(mark){return api('/tv-settings',{id:x.id,value:v,expected:x.value}).then(function(d){if(d.verified!==true||d.id!==x.id||d.value!==v)throw Error('Requested value not confirmed');var message=x.label+': '+d.previous+' → '+d.value+' read back from the TV. Applies to the current source; apps and HDR may change the context.';mark(message,'Value read back');return loadTVSettings(true).then(function(){return {resultLabel:'Value read back',message:message}})});}).finally(function(){settingBusy=false;renderTVSettings()});};
// --- Quick settings: shared state with the Debloater, Domain blocking and TV settings ---
var quickGroups=${JSON.stringify(quickGroups)},quickState=${quickStateFn.toString()};
var quickData={dns:null,leftovers:null,leftoversError:null,hbbtvError:null,wins:null,winsError:null},quickBusy=false,quickConfirm=null,leftoverConfirm=false;
// Every Quick settings switch is a win: on means it is applied, off puts the TV back. Memory figures were measured on a Q80A.
var groupTitles={'tracking-all':'Disable all advertising and tracking','voice-all':'Disable all voice assistants',alexa:'Disable Alexa',google:'Disable Google Assistant',bixby:'Disable Bixby',voice:'Disable the other voice services'};
var winCopy={
 hbbtv:{title:'Disable HbbTV',desc:'Stops the red-button app and the service that keeps starting it again, so it stays off after a source change, a wake-up or a restart. Frees about 22 MB of memory.',
  detail:'Sets the HbbTV menu value to Off, stops the HbbTV service first and then the app (the service starts the app again if it is left running), and does the same after every restart of the TV. Switch off to restore the previous value and start both again.'},
 multiscreen:{title:'Disable MultiScreen autostart',desc:'Samsung loads Multi View in the background at every restart of the TV. This stops that; Multi View still opens when you ask for it, and its first launch takes a few seconds longer. Frees about 15 MB.',
  detail:'Adds the file disable_preloading that Samsung’s own start-up unit checks, and stops the app now. Switch off to remove the file; nothing else is changed.'},
 ambient:{title:'Stop Ambient (partial block)',desc:'Stops the Ambient app now and after every restart of the TV, which frees about 59 MB. The block is partial: Samsung’s screen service starts the app again within seconds, and no setting turns that off, so the memory comes back until the next stop.',
  detail:'Stops org.tizen.ambientapp now and once after each restart of the TV. screend, Samsung’s screen daemon, watches the app and launches it again when it ends (only a firmware feature of the model switches that off), so it can reappear after a few seconds. Samsung’s start-up script and the system image are not touched. Switch off to start it again.'},
 firmware:{title:'Disable automatic firmware update',desc:'Same as Support › Software Update › Auto update. A new firmware can remove root access, so updates only happen when you start them.',
  detail:'Writes 0 to db/menu/support/softwareupdate/autoupdate and reads it back. Switch off to restore the previous value.'}
};
function fileSize(n){return n==null?'—':n<1048576?number(n/1024,0)+' KiB':number(n/1048576,1)+' MiB'}
function chip(text,kind){return '<span class="state-chip '+(kind||'')+'">'+esc(text)+'</span>'}
function switchMarkup(attrs,on,disabled,label){return '<label class="switch"><input type="checkbox" role="switch" '+attrs+(on?' checked':'')+(disabled?' disabled':'')+' aria-label="'+esc(label)+'"><span>'+(on?'On':'Off')+'</span></label>'}
function quickItem(key,title,desc,state,control,extra,after){return '<div class="quick-item" data-quick-item="'+esc(key)+'"><div><h3>'+esc(title)+'</h3><p>'+esc(desc)+'</p><div class="quick-state">'+state+'</div>'+(extra||'')+'</div>'+control+(after||'')+'</div>'}
function winState(id){
 var w=quickData.wins&&quickData.wins.wins[id];return w?w.status:null}
function hbbtvSwitch(h){var on=!h.off,blocked=h.off&&!h.canRestore;return switchMarkup('data-hbbtv-switch',on,settingBusy||blocked,'HbbTV')+(blocked?'<p class="section-note">The previous value was not saved by Vetro. Turn HbbTV on from the TV menu.</p>':'')}
function groupItem(g){
 var s=quickState(g,inventory),rows=s.installed.map(function(id){return inventory.find(function(a){return a.appId===id})});
 var title=groupTitles[g.id]||'Disable '+g.label;
 var done=s.status==='off';
 var state=!inventory.length?chip('Reading apps…'):s.status==='unavailable'?chip('Not installed on this TV'):s.status==='unknown'?chip('State unavailable · refresh the app list','partial'):done?chip('Done · '+s.installed.length+' component'+(s.installed.length===1?'':'s')+' disabled','on'):s.status==='on'?'':chip('Partly done · '+s.enabled.length+' of '+s.installed.length+' components still enabled','partial');
 var disabled=quickBusy||['on','off','partial'].indexOf(s.status)<0;
 var list=rows.length?'<details><summary>'+rows.length+' component'+(rows.length===1?'':'s')+'</summary><ul class="member-list">'+rows.map(function(a){return '<li><button data-quick-app="'+esc(a.appId)+'">'+esc(a.appId)+'</button>'+chip(a.disabled?'Disabled':'Enabled',a.disabled?'on':'')+'</li>'}).join('')+'</ul></details>':'';
 var confirm=quickConfirm===g.id?'<div class="inline-confirm" role="group" aria-label="Confirm '+esc(title)+'"><p><strong>'+esc(title)+'?</strong> The microphone button on the remote and voice control stop working'+(g.everything?', and so do Voice Guide (read-aloud) and voice suggestions in search':'')+' until you turn this off again. Running components stop now.</p><div class="row"><button data-quick-cancel>Cancel</button><button class="primary" data-quick-confirm="'+esc(g.id)+'">'+esc(title)+'</button></div></div>':'';
 return quickItem(g.id,title,g.description,state,switchMarkup('data-quick-toggle="'+esc(g.id)+'"',done,disabled,title),list,confirm);
}
function winItem(id){
 var c=winCopy[id],st=winState(id),w=quickData.wins&&quickData.wins.wins[id]||{},busy=quickBusy||winsBusy;
 var state=!quickData.wins?chip(quickData.winsError||'Reading…',quickData.winsError?'partial':''):st==='unknown'?chip('Not available on this TV','partial'):'';
 if(quickData.wins&&st==='on')state=id==='ambient'?chip('Partly done · Samsung may start it again','partial'):chip(id==='firmware'?'Done · Auto update is off':'Done · Multi View starts when you open it','on');
 if(st==='partial')state=chip('Partly done · Samsung started it again','partial');
 if(st==='off'&&w.running)state=chip('Running now','');
 var control=quickData.wins&&st&&st!=='unknown'?switchMarkup('data-win-switch="'+id+'"',st==='on',busy,c.title):'';
 return quickItem(id,c.title,c.desc,state,control,'<details><summary>What this changes</summary><p>'+esc(c.detail)+'</p></details>');
}
function hbbtvItem(){
 var h=hbbtvData,c=winCopy.hbbtv,state='',control='';
 if(!h)state=chip(quickData.hbbtvError||'Reading…',quickData.hbbtvError?'partial':'');
 else{
  var blocked=h.off&&!h.canRestore;
  if(h.off)state=chip('Done · HbbTV and its service are stopped','on');
  else if(h.valueOff)state=chip('Partly done · the menu says Off, but '+(h.running?'the app is still running':h.serviceRunning?'its service can start it again':'the relaunch brake is missing'),'partial');
  control=switchMarkup('data-hbbtv-disable',!!h.off,settingBusy||blocked,c.title)+(blocked?'<p class="section-note">Vetro does not have the previous value. Turn HbbTV on from the TV menu.</p>':'');
 }
 return quickItem('hbbtv',c.title,c.desc,state,control,'<details><summary>What this changes</summary><p>'+esc(c.detail)+'</p></details>');
}
function renderQuick(){
 if(!$('quickTracking'))return;
 var d=quickData.dns;
 var dnsOn=!!(d&&d.enabled),dnsNoDomains=!!d&&!d.domains.length;
 var dns=quickItem('dns','Block ad and tracking domains','Blocks the saved ad and tracking domains. DNS servers stay unchanged.',
  !d?chip('Reading…'):d.enabled&&!d.applied?chip('Saved as on, not applied','partial'):dnsOn?chip('Done · '+d.domains.length+' domain'+(d.domains.length===1?'':'s')+' blocked','on'):chip(dnsNoDomains?'No domains saved':d.domains.length+' domain'+(d.domains.length===1?'':'s')+' saved'),
  d?switchMarkup('data-dns-switch',dnsOn,quickBusy||uiOperationBusy.dns||dnsNoDomains&&!dnsOn,'Block ad and tracking domains'):'',
  dnsNoDomains?'<div class="quick-actions"><button data-quick-open="dns">Add domains</button></div>':'');
 // Ambient is offered as a partial block: screend, Samsung’s screen daemon, starts it again within seconds of a stop.
 $('quickMemory').innerHTML=hbbtvItem()+winItem('multiscreen')+winItem('ambient');
 $('quickControl').innerHTML=winItem('firmware');
 $('quickTracking').innerHTML=quickGroups.filter(function(g){return g.section==='tracking'}).map(groupItem).join('')+dns;
 $('quickVoice').innerHTML=quickGroups.filter(function(g){return g.section==='voice'}).map(groupItem).join('');
 var l=quickData.leftovers,files=l?l.files.filter(function(f){return f.isPackage}):[];
 var lstate=quickData.leftoversError?chip(quickData.leftoversError,'partial'):!l?chip('Reading…'):files.length?chip(files.length+' package file'+(files.length===1?'':'s')+' · '+fileSize(l.packageBytes),'partial'):chip('No package files');
 var free=l&&l.storageBefore?'<p>Free storage: '+memory(l.storageBefore.availableBytes)+'.</p>':'';
 var listing=files.length?'<details><summary>Show files</summary><ul class="member-list">'+files.map(function(f){return '<li><span class="small-mono">'+esc(f.name)+'</span><span class="muted">'+fileSize(f.size)+'</span></li>'}).join('')+'</ul></details>':'';
 var confirm=leftoverConfirm&&files.length?'<div class="inline-confirm" role="group" aria-label="Confirm cleanup"><p><strong>Delete '+files.length+' package file'+(files.length===1?'':'s')+' ('+fileSize(l.packageBytes)+')?</strong> Installed apps are not affected, but you need the original file to install these again.</p><div class="row"><button data-leftovers-cancel>Cancel</button><button class="primary" data-leftovers-confirm>Delete files</button></div></div>':'';
 $('quickStorage').innerHTML='<div class="quick-item" data-quick-item="leftovers"><div><h3>Clear install leftovers</h3><p>Installer copies left in the TV’s staging folder. Clear deletes only package files (.wgt, .tpk, .rpm).</p>'+free+'<div class="quick-state">'+lstate+'</div>'+listing+'<div class="quick-actions"><button data-leftovers-clear '+(files.length&&!quickBusy?'':'disabled')+'>Clear leftovers</button><button data-leftovers-refresh>Refresh</button></div></div>'+confirm+'</div>';
}
function loadLeftovers(){quickData.leftoversError=null;return api('/leftovers').then(function(d){if(!Array.isArray(d.files))throw Error('Staging folder unreadable');quickData.leftovers=d;}).catch(function(e){quickData.leftoversError=e.message;}).finally(renderQuick);}
function loadWins(){quickData.winsError=null;return api('/wins').then(function(d){if(!d.wins)throw Error('Quick wins unreadable');quickData.wins=d;}).catch(function(e){quickData.winsError=e.message;}).finally(renderQuick);}
function loadQuick(){
 renderQuick();
 api('/hbbtv').then(function(d){if(!Number.isInteger(d.value))throw Error('HbbTV state unreadable');hbbtvData=d;quickData.hbbtvError=null;}).catch(function(e){quickData.hbbtvError=e.message;}).finally(renderQuick);
 api('/dns').then(function(d){if(!Array.isArray(d.domains))throw Error('Filter state unreadable');dnsState(d);}).catch(function(){renderQuick();});
 loadWins();
 loadLeftovers();
}
function applyQuick(id,off){
 var g=quickGroups.filter(function(x){return x.id===id})[0];if(!g||quickBusy)return;quickBusy=true;quickConfirm=null;renderQuick();
 return runUiOperation('quick',(off?'Disable ':'Enable ')+g.label,'Quick settings',null,function(mark){return api('/quick',{id:id,off:off}).then(function(d){
  var n=d.changed.length,parts=[g.label+(off?' disabled.':' enabled.'),n?n+' component'+(n===1?'':'s')+' '+(off?'disabled':'enabled')+'; the TV registry confirms it.':'Already in the requested state.'];
  if(d.stopped.length)parts.push(d.stopped.length+' running component'+(d.stopped.length===1?'':'s')+' stopped.');
  if(d.stopFailed.length)parts.push('Could not stop: '+d.stopFailed.join(', ')+'.');
  if(d.stopUnconfirmed)parts.push('Running components could not be checked.');
  if(off&&g.microphone&&n)parts.push('Check Home and the remote before relying on this change.');
  var message=parts.join(' ');mark(message,'Registry confirmed');
  return loadApps(false,true).then(function(){return {state:d.stopFailed.length?'warning':'success',resultLabel:'Registry confirmed',message:message}});
 })}).finally(function(){quickBusy=false;renderQuick();});
}
function setHbbtv(on){
 if(!hbbtvData||settingBusy)return;var off=!on,expected=hbbtvData.value;settingBusy=true;renderQuick();
 return runUiOperation('settings',off?'Disable HbbTV':'Enable HbbTV','HbbTV',null,function(mark){return api('/hbbtv',{off:off,expected:expected}).then(function(d){if(d.off!==off||!Number.isInteger(d.value))throw Error('HbbTV state not confirmed');hbbtvData=d;var message='HbbTV '+(off?'off':'on')+'. '+(d.changed===false?'Already in the requested state. ':'')+'Menu value '+expected+' → '+d.value+' read back'+(off?'; the app and its service are stopped':'; the service and the app were started')+'. Check the red button on the TV.';mark(message,'Value read back');return {resultLabel:'Value read back',message:message}})}).finally(function(){settingBusy=false;renderQuick();renderPrivacy();if(currentPanel==='tvsettings'&&privacyData)loadPrivacy();});
}
var winsBusy=false;
function winMessage(id,on,d){
 if(d.changed===false)return winCopy[id].title+': already in the requested state.';
 if(id==='firmware')return 'Auto update '+(on?'off':'on')+'; value '+d.previous+' → '+d.value+' read back from the TV.';
 if(id==='multiscreen')return 'MultiScreen autostart '+(on?'disabled: the preload file is in place and the app is stopped':'back on: the preload file is removed')+' (read back). '+(on?'Multi View still opens on demand.':'It loads again at the next restart.');
 return 'Ambient autostart '+(on?'disabled: the app is stopped and will be stopped after each restart':'back on: Samsung’s own start was run again')+'.';
}
function setWin(id,on){
 if(quickBusy||winsBusy||!winCopy[id])return;winsBusy=true;renderQuick();
 return runUiOperation('wins',(on?'':'Undo · ')+winCopy[id].title,'Quick settings',null,function(mark){return api('/wins',{id:id,on:on}).then(function(d){
  var message=winMessage(id,on,d);mark(message,'State read back');
  return api('/wins').then(function(w){quickData.wins=w;return {resultLabel:'State read back',message:message}});
 })}).finally(function(){winsBusy=false;renderQuick();});
}
function setDns(on){
 var d=quickData.dns;if(!d||uiOperationBusy.dns)return;
 return runUiOperation('dns',on?'Turn on domain blocking':'Turn off domain blocking','TV hosts',null,function(mark){return api('/dns',{action:'apply',enabled:on,domains:d.domains}).then(function(r){if(r.enabled!==on||on&&!r.applied)throw Error('Filter state not confirmed');dnsState(r);var message='Domain blocking '+(on?'on · '+r.domains.length+' domains applied on the TV.':'off.');mark(message,'State read back');return {resultLabel:'State read back',message:message}})}).finally(function(){if(quickData.dns)dnsState(quickData.dns);else renderQuick();});
}
function clearLeftovers(){
 leftoverConfirm=false;quickBusy=true;renderQuick();
 return runUiOperation('leftovers','Clear install leftovers','Staging folder',null,function(mark){return api('/leftovers',{action:'clear'}).then(function(d){
  var message=d.deleted.length?d.deleted.length+' package file'+(d.deleted.length===1?'':'s')+' deleted, '+fileSize(d.freedBytes)+' freed.':'No package files to delete.';
  if(d.failed.length)message+=' '+d.failed.length+' could not be deleted.';
  if(d.storageBefore&&d.storageAfter)message+=' Free storage: '+memory(d.storageBefore.availableBytes)+' → '+memory(d.storageAfter.availableBytes)+'.';
  mark(message,'Folder read back');quickData.leftovers=d;
  return {state:d.failed.length||d.errors.length?'warning':'success',resultLabel:'Folder read back',message:message};
 })}).finally(function(){quickBusy=false;renderQuick();});
}
$('quick').onchange=function(e){var x=e.target,ds=x.dataset||{};
 if(ds.quickToggle!=null){var g=quickGroups.filter(function(y){return y.id===ds.quickToggle})[0];if(x.checked&&g&&g.microphone){x.checked=false;quickConfirm=g.id;renderQuick();var c=document.querySelector('[data-quick-confirm]');if(c)c.focus();return}return applyQuick(ds.quickToggle,x.checked);}
 if(ds.hbbtvDisable!=null)return setHbbtv(!x.checked);
 if(ds.winSwitch!=null)return setWin(ds.winSwitch,x.checked);
 if(ds.dnsSwitch!=null)return setDns(x.checked);
};
$('quick').onclick=function(e){var b=e.target.closest?e.target.closest('button'):null;if(!b)return;var ds=b.dataset;
 if(ds.quickCancel!=null){var id=quickConfirm;quickConfirm=null;renderQuick();var s=document.querySelector('[data-quick-toggle="'+id+'"]');if(s)s.focus();return}
 if(ds.quickConfirm!=null)return applyQuick(ds.quickConfirm,true);
 if(ds.quickApp!=null)return detail(ds.quickApp);
 if(ds.quickOpen!=null)return switchPanel(ds.quickOpen);
 if(ds.leftoversClear!=null){leftoverConfirm=true;renderQuick();var c=document.querySelector('[data-leftovers-confirm]');if(c)c.focus();return}
 if(ds.leftoversCancel!=null){leftoverConfirm=false;renderQuick();return}
 if(ds.leftoversConfirm!=null)return clearLeftovers();
 if(ds.leftoversRefresh!=null)return loadLeftovers();
};
// --- Launcher: a glass launcher for the Home key. The service builds its app list from Samsung's Home row. ---
var dockData=null,dockError=null,dockBusy=false,dockConfirm=false;
function loadDock(){return api('/dock').then(function(d){dockData=d;dockError=null}).catch(function(e){dockError=e.message}).finally(renderDock)}
function isTizenTube(id){return String(id).toLowerCase().indexOf('tizentube')>=0}
// TizenTube is a sideloaded app. It has a tile when the launcher list has it; it is installed when the TV registry or that list has it.
// "Not installed" is only said once the registry has been read.
function dockHasTizenTube(d){return (d.entries||[]).some(function(e){return isTizenTube(e.appId)})}
function tizenTubeInstalled(d){return dockHasTizenTube(d)||(inventory||[]).some(function(a){return isTizenTube(a.appId)})}
function previewTile(e,size,pill,sel){return '<div class="lp-tile'+(pill?' lp-oval':'')+(sel?' lp-sel':'')+'" style="width:'+(pill?232:size)+'px;height:'+(pill?48:size)+'px;border-radius:'+(pill?'24px':'16%')+'"><img alt="" src="/dock/icon?slug='+encodeURIComponent(e.slug)+'" data-initials="'+esc(e.label.slice(0,2))+'"></div>'}
var sampleRow=[{slug:'sample-1',label:'Netflix'},{slug:'sample-2',label:'YouTube'},{slug:'sample-3',label:'Prime Video'},{slug:'sample-4',label:'Disney+'},{slug:'sample-5',label:'Plex'},{slug:'sample-6',label:'Sport'},{slug:'sample-7',label:'Music'},{slug:'sample-s1',label:'Source',system:true},{slug:'sample-s2',label:'Settings',system:true}];
function previewMarkup(d){
 var real=(d.entries||[]).length>0,all=real?d.entries:sampleRow,apps=all.filter(function(e){return !e.system}),sys=all.filter(function(e){return e.system});
 var row=apps.map(function(e,i){return previewTile(e,i===0?112:92,false,i===0)}).join('')+(sys.length?'<i class="lp-divider"></i>'+'<div class="lp-stack">'+sys.map(function(e){return previewTile(e,92,true,false)}).join('')+'</div>':'');
 var note=real?(d.enabled?'This TV’s apps and icons, as the launcher shows them. The first app is selected.':'How the launcher will look with this TV’s apps. Turn it on to use it.'):'An example row. Your TV’s apps appear here once the list has been read.';
 return '<div class="dock-left panel"><h3>Preview</h3><p class="section-note">'+note+'</p><div class="lp" id="lp" role="img" aria-label="Preview of the launcher over a TV picture"><div class="lp-stage"><div class="lp-scene"></div><div class="lp-bug"><i></i><b>12</b><span>Evening Light HD</span></div><div class="lp-hint">Source ˄</div><div class="lp-pill"><div class="lp-row">'+row+'</div></div></div></div></div>';
}
function fitPreview(){
 var lp=$('lp');if(!lp||!lp.style||!lp.querySelectorAll||!lp.clientWidth)return;
 var s=lp.clientWidth/1920;lp.style.setProperty('--s',s);lp.style.height=Math.round(1080*s)+'px';
 lp.querySelectorAll('.lp-tile:not(.lp-oval) img').forEach(function(img){
  function judge(){
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
  img.onerror=function(){img.parentNode.classList.add('lp-missing');img.parentNode.textContent=img.dataset.initials||'?'};
  if(img.complete&&img.naturalWidth)judge();else img.onload=judge;
 });
}
function renderDock(){
 var box=$('dockBody');if(!box)return;var d=dockData;
 if(!d){box.innerHTML='<div class="panel"><p class="notice">'+esc(dockError||'Reading…')+'</p></div>';return}
 var state=!d.installed?chip('Not in this package','partial'):d.enabled?(d.running===true?chip('On · running','on'):d.running===false?chip('On · not running','partial'):chip('On · state unknown','partial')):chip('Off');
 var apps=d.apps?'<p class="notice">'+d.apps.count+' app'+(d.apps.count===1?'':'s')+' from Samsung’s Home row, rebuilt at each launcher start.'+(d.apps.skipped&&d.apps.skipped.length?' Left out: '+d.apps.skipped.map(function(x){return esc(x.item.split('@').pop())+' ('+esc(x.reason.toLowerCase())+')'}).join(', ')+'.':'')+'</p>':'';
 var confirm=dockConfirm?'<div class="inline-confirm" role="group" aria-label="Confirm launcher"><p><strong>Turn on the Vetro launcher?</strong> The Home key will open it instead of Samsung’s Home, and Vetro closes Samsung’s Home each time you press it. If the launcher stops, the Home key goes back to Samsung’s Home by itself. It also switches off Samsung’s <em>Autorun Smart Hub</em> setting, so the TV no longer powers on to Samsung’s Home, and puts it back when you turn the launcher off. Nothing of Samsung’s is removed or disabled. Tested on a Q80A only.</p><div class="row"><button data-dock-cancel>Cancel</button><button class="primary" data-dock-confirm>Turn on launcher</button></div></div>':'';
 var control=switchMarkup('data-dock-switch',!!d.enabled,dockBusy||!d.installed,'Vetro launcher');
 var problem=d.error?'<p class="quick-callout">'+esc(d.error)+'</p>':d.probeError?'<p class="quick-callout">The launcher state could not be read: '+esc(d.probeError)+'</p>':'';
 var actions='<div class="quick-actions"><button data-dock-reload>Refresh</button>'+(d.enabled?'<button data-dock-rebuild '+(dockBusy?'disabled':'')+'>Rebuild app list</button>':'')+'</div>';
 var log=d.log?'<details><summary>Launcher log</summary><pre class="small-mono">'+esc(d.log)+'</pre></details>':'';
 var main='<div class="quick-item" data-quick-item="launcher"><div><h3>Vetro launcher</h3><p>Opens on the Home key with the same apps and icons as Samsung’s Home, which is closed while the launcher is on.</p><div class="quick-state">'+state+'</div>'+apps+problem+actions+log+'</div>'+control+confirm+'</div>';
 var noTube=inventory.length>0&&!tizenTubeInstalled(d),fixState=d.fixTizenTube?chip('On','on'):chip('Off');
 var fix='<div class="quick-item" data-quick-item="fix-tizentube"><div><h3>Fix TizenTube</h3><p>Shows the YouTube icon on the TizenTube tile and closes Samsung’s YouTube (com.samsung.tv.cobalt-yt) before starting it. Launcher tile only.</p><div class="quick-state">'+fixState+(noTube?chip('TizenTube is not installed on this TV','partial'):d.enabled&&!dockHasTizenTube(d)?chip('TizenTube is not in Samsung’s Home row','partial'):'')+'</div></div>'+switchMarkup('data-dock-fix',!!d.fixTizenTube,dockBusy||!d.installed||noTube&&!d.fixTizenTube,'Fix TizenTube')+'</div>';
 function sourceOption(key,label,description){
  return '<div class="quick-item" data-quick-item="'+key+'"><div><h3>'+label+'</h3><p>'+description+'</p><div class="quick-state">'+chip(d[key]?'On':'Off',d[key]?'on':'')+'</div></div>'+switchMarkup('data-dock-source-option="'+key+'"',!!d[key],dockBusy||!d.installed,label)+'</div>';
 }
 var sourceOptions=sourceOption('showHomeSources','HDMI sources on Home','Keep HDMI source tiles already present in Samsung’s Home row, in their original positions. Turn off to filter them out. The Sources page is unchanged.');
 box.innerHTML='<div class="dock-layout">'+previewMarkup(d)+'<div class="quick-group">'+main+sourceOptions+fix+'</div></div>';
 setTimeout(fitPreview,0);
}
function setDock(action,label,extra){
 if(dockBusy)return;dockBusy=true;dockConfirm=false;renderDock();
 return runUiOperation('dock',label,'Launcher',null,function(mark){return api('/dock',Object.assign({action:action},extra||{})).then(function(d){
  dockData=d;dockError=null;
  var message=action==='enable'?'Launcher on'+(d.running?' and running':'')+'. Press Home on the remote to open it.':action==='disable'?'Launcher off. Samsung’s Home answers the Home key again.':action==='showHomeSources'?'Source preference saved; '+(d.enabled?'the launcher was restarted.':'the preview was updated.') :action==='fixTizenTube'?'Fix TizenTube '+(d.fixTizenTube?'on':'off')+(d.enabled?'; the launcher was restarted with the new list.':'; it applies when the launcher is on.'):'App list rebuilt and the launcher restarted.';
  mark(message,'Service confirmed');return {state:'success',resultLabel:'Service confirmed',message:message};
 })}).then(function(ok){if(!ok)return loadDock()}).finally(function(){dockBusy=false;renderDock()});
}
$('dock').onchange=function(e){var x=e.target;if(!x.dataset)return;
 if(x.dataset.dockFix!=null)return setDock('fixTizenTube',x.checked?'Turn on Fix TizenTube':'Turn off Fix TizenTube',{on:!!x.checked});
 if(x.dataset.dockSourceOption!=null)return setDock(x.dataset.dockSourceOption,(x.checked?'Turn on ':'Turn off ')+(x.dataset.dockSourceOption==='showHomeSources'?'HDMI sources on Home':'HDMI source images'),{on:!!x.checked});
 if(x.dataset.dockSwitch==null)return;
 if(x.checked){x.checked=false;dockConfirm=true;renderDock();var c=document.querySelector('[data-dock-confirm]');if(c)c.focus();return}
 return setDock('disable','Turn off the launcher');
};
$('dock').onclick=function(e){var b=e.target.closest?e.target.closest('button'):null;if(!b)return;var ds=b.dataset;
 if(ds.dockCancel!=null){dockConfirm=false;renderDock();var s=document.querySelector('[data-dock-switch]');if(s)s.focus();return}
 if(ds.dockConfirm!=null)return setDock('enable','Turn on the launcher');
 if(ds.dockRebuild!=null)return setDock('refresh','Rebuild the launcher app list');
 if(ds.dockReload!=null)return loadDock();
};
if(typeof window!=='undefined'&&window.addEventListener)window.addEventListener('resize',function(){if(currentPanel==='dock')fitPreview()});
loadApps().then(loadRules);liveStatus();loadQuick();setInterval(function(){if(currentPanel==='remote'&&inputListening&&!document.hidden)pollInput()},1500);setInterval(function(){if(liveUntil){if(Date.now()>=liveUntil)liveUntil=0;liveStatus();}if(currentPanel==='dashboard'||currentPanel==='processes'||currentPanel==='apps')pollMonitor()},1000);
</script></body></html>`;};
