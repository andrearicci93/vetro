'use strict';
// Behavioral focus regressions. Browser visibility/axe checks are also run on the rendered dashboard.
const assert = require('assert').strict;
const vm = require('vm');
const nodes = {}, listeners = {};
let document;
class Element {
  constructor(attrs = {}) { this.attrs = attrs; this.hidden = false; this.disabled = false; this.children = []; this.value = ''; this._html = ''; this.isConnected = true; }
  getAttribute(name) { return this.attrs[name] ?? null; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  removeAttribute(name) { delete this.attrs[name]; }
  contains(node) { return this === node || this.children.some(n => n.contains(node)); }
  closest(selector) { return selector === '[inert]' && this.inert ? this : null; }
  getClientRects() { return this.hidden ? [] : [{}]; }
  focus() { document.activeElement = this; }
  querySelectorAll(selector) {
    if (selector.startsWith('button:')) return this.children.filter(n => !n.disabled);
    return this.children.filter(n => selector.split(',').some(s => {
      const m = /^\[([^=\]]+)(?:="?([^"\]]*)"?)?\]$/.exec(s);
      return m && n.getAttribute(m[1]) !== null && (m[2] === undefined || n.getAttribute(m[1]) === m[2]);
    }));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  get innerHTML() { return this._html; }
  set innerHTML(html) {
    this.children.forEach(n => { n.isConnected = false; if (document.activeElement === n) document.activeElement = document.body; });
    this._html = html;
    this.children = [...html.matchAll(/<button\b([^>]*)>/g)].map(m => {
      const attrs = Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(a => [a[1], a[2]]));
      return new Element(attrs);
    });
  }
}
const el = id => nodes[id] || (nodes[id] = new Element({id}));
const classes = new Set();
document = {
  body: new Element(), activeElement: null,
  getElementById: el,
  querySelector: selector => el(selector), querySelectorAll: () => [],
  addEventListener: (event, fn) => (listeners[event] || (listeners[event] = [])).push(fn)
};
document.body.classList = {contains: c => classes.has(c), toggle: (c, on) => on ? classes.add(c) : classes.delete(c)};
document.activeElement = document.body;
el('detail').hidden = true;
const context = {
  document, console, innerWidth: 390, setTimeout() {}, clearTimeout() {}, setInterval() {},
  fetch: async url => ({ok: true, json: async () => url.startsWith('/apps') ? {apps: [], summary: {total: 0}} : url === '/remap' ? {rules: []} : {plugins: []}})
};
vm.runInNewContext(require('../service/dashboard.js')().match(/<script>([\s\S]*?)<\/script>/)[1], context);
function key(name, shiftKey = false) {
  const event = {key: name, shiftKey, target: document.activeElement, preventDefault() { this.prevented = true; }};
  (listeners.keydown || []).forEach(fn => fn(event));
  return event;
}
(async () => {
  await new Promise(resolve => setImmediate(resolve));
  const first = new Element({'aria-current': 'page'}), last = new Element(), hidden = new Element();
  hidden.hidden = true;
  el('sidebar').children = [first, last, hidden];
  context.setNav(true);
  assert.equal(document.activeElement, first);
  assert.equal(el('.main').inert, true, 'background controls cannot receive focus while the sheet is open');
  assert.equal(el('sidebar').getAttribute('aria-modal'), 'true');
  last.focus(); assert.equal(key('Tab').prevented, true); assert.equal(document.activeElement, first);
  first.focus(); key('Tab', true); assert.equal(document.activeElement, last, 'reverse Tab skips hidden controls');
  key('Escape');
  assert.equal(document.activeElement, el('menuBtn'));
  assert.equal(el('.main').inert, false);
  assert.equal(el('sidebar').getAttribute('role'), null);

  context.render();
  el('roleFilters').querySelector('[data-role="optional"]').focus();
  context.roleFilter = 'optional'; context.render();
  assert.equal(document.activeElement.getAttribute('data-role'), 'optional', 'filter activation retains its keyboard position');
  assert.equal(document.activeElement.getAttribute('aria-pressed'), 'true');

  context.pluginData = {plugins: [{id: 'example', name: 'Example', state: 'running', ui: {label: 'Example'}}]};
  context.currentPanel = 'plugins'; context.renderPluginTabs();
  // Give the fake nodes the parent relation a browser provides for tab key handling.
  function wireTabs() { el('pluginTabs').children.forEach(n => { n.parentNode = el('pluginTabs'); n.click = () => context.showPluginTab(n.getAttribute('data-plugin-tab')); }); }
  wireTabs(); el('pluginTabs').children[0].focus(); key('ArrowLeft');
  assert.equal(context.pluginView, 'example', 'Left from the first tab wraps to the last');
  assert.equal(document.activeElement.getAttribute('id'), 'ptab-example', 'activation preserves the newly selected tab');
  assert.equal(document.activeElement.getAttribute('aria-controls'), 'pluginPage');
  assert.equal(el('pluginPage').getAttribute('aria-labelledby'), 'ptab-example');
  wireTabs(); key('Home');
  assert.equal(context.pluginView, null);
  assert.equal(document.activeElement.getAttribute('id'), 'ptab-manage');
  wireTabs(); key('End');
  context.pluginData = {plugins: []}; context.renderPluginTabs();
  assert.equal(document.activeElement, el('pageHeading'), 'removing the last plugin provides a visible focus destination');
  console.log('PASS dashboard focus: modal isolation, forward/reverse Tab, Escape, filter focus, plugin keyboard wrap and removal');
})().catch(error => { console.error(error); process.exitCode = 1; });
