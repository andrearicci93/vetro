'use strict';
// A single Home assignment lives in the saved physical rules. The binding only
// identifies its remote; it never contains a second copy of the action.
var remap = require('./remap.js');
var HOME_CODE = '63';
function code(store) { return store.home && /^\d{1,3}$/.test(store.home.code) && +store.home.code <= 767 ? String(+store.home.code) : HOME_CODE; }
function rule(store) { return store.rules.find(function (r) { return r.trigger.type === 'physical' && r.trigger.value === code(store); }) || null; }
function binding(store) {
    if (store.home && store.home.device) return store.home;
    // Preserve a previously enabled, working Home mapping on upgrade.
    if (store.input && store.input.enabled && store.input.device && rule(store)) return Object.assign({code: code(store)}, store.input);
    return null;
}
function launcher(rules) { return rules.some(function (r) { return r.enabled && r.actions.some(function (a) { return a.type === 'launcher'; }); }); }
function plan(store) {
    var home = rule(store), remote = binding(store), input = store.input || {}, tokens = [];
    if (home && home.enabled && remote) tokens.push(code(store));
    if (input.enabled) store.rules.forEach(function (r) {
        if (r.enabled && r.trigger.type === 'physical' && r.trigger.value !== code(store)) tokens.push(r.trigger.value);
    });
    return {remote: home && home.enabled && remote ? remote : input, tokens: Array.from(new Set(tokens))};
}
function validate(rules, homeCode) {
    var result = remap.validateRules(rules), homes = result.filter(function (r) { return r.trigger.type === 'physical' && r.trigger.value === homeCode; });
    if (homes.length > 1) throw Error('Home can have only one saved mapping');
    if (homes.length && homes[0].actions.length !== 1) throw Error('Choose one action for Home');
    return result;
}
function HomeRouting(options) { this.o = options; this.busy = false; this.phase = null; this.error = null; }
HomeRouting.prototype.status = function () {
    var store = this.o.get(), r = rule(store), action = r && r.enabled ? r.actions[0] : null;
    var p = this.o.inputStatus().policy, b = binding(store);
    return {code: code(store), ruleId: r ? r.id : null, action: action, launcher: !!action && action.type === 'launcher',
        device: b && b.device || null, node: b && b.node || null,
        ready: !this.busy && (!action || !!b && p.mode === 'filter' && p.connected && (p.blocked || []).indexOf(code(store)) >= 0),
        listening: p.mode === 'observe', busy: this.busy, phase: this.phase, error: this.error};
};
HomeRouting.prototype.device = function (store, explicit) {
    var self=this;
    return Promise.resolve().then(function(){return self.o.devices();}).then(function(devices){
        var list=devices.filter(function(d){return d.selectable;});
        if(explicit){
            var chosen=list.find(function(d){return d.node===explicit;});
            if(!chosen)throw Error('The selected remote is unavailable. Detect Home again.');
            return chosen;
        }
        var saved=binding(store)||store.input;
        if(saved&&saved.device){
            var matches=list.filter(function(d){return d.name===saved.device;});
            if(matches.length===1)return matches[0];
            var keyed=matches.filter(self.o.hasKeys);
            if(keyed.length===1)return keyed[0];
            var same=keyed.find(function(d){return d.node===saved.node;});
            if(same)return same;
        }
        var e=Error('Press Detect Home, then press Home on your remote to finish setup.');
        e.code='home_detection_required';throw e;
    });
};
HomeRouting.prototype.change = function (rules, options) {
    options=options||{};
    if(this.busy)return Promise.reject(Error('A remote shortcut change is already in progress'));
    this.busy=true;this.phase='preparing';this.error=null;
    var self=this,o=this.o,previous,next,wanted,wasRunning,committed=false,runtimeTouched=false;
    return Promise.resolve().then(function(){
        previous=o.get();wasRunning=o.dock.readState().enabled;
        if(options.expectedRevision!==undefined&&options.expectedRevision!==(previous.revision||0))throw Error('Shortcuts changed. Refresh before saving.');
        next=Object.assign({},previous,{rules:validate(rules,code(previous)),revision:(previous.revision||0)+1});
        var before=rule(previous),after=rule(next),changed=JSON.stringify(before)!==JSON.stringify(after);
        if(after&&after.enabled&&(changed||options.device||!binding(previous))){
            return self.device(previous,options.device).then(function(remote){
                var input=previous.input||{},otherActive=input.enabled&&next.rules.some(function(r){return r.enabled&&r.trigger.type==='physical'&&r.trigger.value!==code(previous);});
                if(otherActive&&input.device&&input.device!==remote.name)throw Error('Home and the other remote shortcuts must use the same remote');
                if(otherActive&&options.device&&remote.unique===false&&input.node!==remote.node)throw Error('Pause other remote shortcuts before assigning Home to a different remote interface');
                next.home={code:code(previous),device:remote.name,node:remote.node};
                // A switch with no active shortcuts does not own a different remote.
                // Keep its preference enabled and reuse Home's remote for future shortcuts.
                if(input.enabled&&!otherActive)next.input=Object.assign({},input,{device:remote.name,node:remote.node});
                if(after.actions[0].type==='launch')return o.apps().then(function(apps){
                    if(apps.registryError||!apps.apps.some(function(a){return a.appId===after.actions[0].appId&&a.show===true&&a.disabled===false;}))throw Error('Choose an installed, enabled app with a launcher entry');
                });
            });
        }
        if(binding(previous))next.home=Object.assign({},binding(previous),{code:code(previous)});
    }).then(function(){
        wanted=launcher(next.rules);
        if(wanted&&!wasRunning){self.phase='starting-launcher';runtimeTouched=true;return o.dock.enable();}
    }).then(function(){
        // Persist before changing input. Failed runtime changes restore the assignment.
        o.save(next);committed=true;runtimeTouched=true;self.phase='applying-remote';return o.applyInput();
    }).then(function(){
        if(!wanted&&wasRunning){self.phase='stopping-launcher';return o.dock.disable();}
    }).then(function(){return {ok:true,persisted:true,rules:next.rules,revision:next.revision};})
        .catch(function(e){
            self.phase='restoring';
            var restoreErrors=[];
            if(committed){try{o.save(previous);}catch(restore){restoreErrors.push('saved assignment: '+restore.message);}}
            return Promise.resolve().then(function(){
                if(!runtimeTouched)return;
                return Promise.resolve().then(function(){
                    if(wasRunning&&!o.dock.readState().enabled)return o.dock.enable();
                    if(!wasRunning&&o.dock.readState().enabled)return o.dock.disable();
                }).then(function(){return o.applyInput();}).catch(function(restore){restoreErrors.push('remote state: '+restore.message);});
            }).then(function(){
                self.error=e.message+(restoreErrors.length?'. Restore not confirmed: '+restoreErrors.join('; '):'');
                e.message=self.error;throw e;
            });
        }).finally(function(){self.busy=false;self.phase=null;});
};
HomeRouting.prototype.setLauncher = function (enabled, options) {
    var store = this.o.get(), current = rule(store);
    // An already-off switch must not erase a custom Home destination.
    if (!enabled && !(current && current.actions[0].type === 'launcher')) return Promise.resolve({ok: true, rules: store.rules, revision: store.revision || 0, persisted: true});
    var rules = store.rules.filter(function (r) { return r !== current; });
    if (enabled) rules.push({id: current ? current.id : 'physical_' + code(store), enabled: true,
        trigger: {type: 'physical', value: code(store)}, actions: [{type: 'launcher'}]});
    return this.change(rules, options);
};
module.exports = {HomeRouting: HomeRouting, code: code, rule: rule, binding: binding, plan: plan, launcher: launcher};
