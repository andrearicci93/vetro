'use strict';

// Wire Vetro's telemetry into an MQTT broker (for Home Assistant and other
// smart-home stacks). Pure Node, depends only on ./mqtt.js.
//
// Configuration is read from a JSON file the service polls, so the broker can
// be changed at runtime via the /mqtt endpoint without rebuilding the
// widget. Shape:
//   { "enabled": true, "host": "192.168.1.50", "port": 1883,
//     "username": null, "password": null, "topicPrefix": "vetro" }

var fs = require('fs');
var MqttClient = require('./mqtt.js').MqttClient;
// Regular expressions compiled once at module load, not on every call.
var LEGACY_IDENTITY_RE = /^[a-f0-9]{32}$/i;
var LEGACY_IDENTITY_RE_2 = /^vetro-[a-f0-9]{16,32}$/;
var HOST_RE = /^[A-Za-z0-9:._-]+$/;
var TOPIC_RE = /^[-A-Za-z0-9_.]+(?:\/[-A-Za-z0-9_.]+)*$/;
var WHITESPACE_RE = /\s+/;
var TV_SOURCE_RE = /^(TV|HDMI[1-4])$/;
var PERCENT_RE = /%/g;
var MEMINFO_LINE_RE = /^(\S+):\s*(\d+)/;

// /tmp is tmpfs: a config written there dies with the TV reboot. The
// persistent copy lives under the owner's storage and is read first;
// the tmpfs copy is a fallback when the persistent config cannot be read.
var CONFIG_PATH = '/tmp/vetro-mqtt.json';
var CONFIG_PATH_PERSISTENT = '/opt/usr/home/owner/share/vetro-mqtt.json';

function readConfig() {
    var paths = [CONFIG_PATH_PERSISTENT, CONFIG_PATH];
    for (var i = 0; i < paths.length; i++) {
        try {
            return JSON.parse(fs.readFileSync(paths[i], 'utf8'));
        } catch (e) { /* try next */ }
    }
    return null;
}

function newId(){return 'vetro-'+Math.random().toString(16).slice(2,10)+Math.random().toString(16).slice(2,10)+Math.random().toString(16).slice(2,10);}
function legacyIdentity(){var file='/opt/usr/home/owner/share/vetro-device-id';try{var machine=fs.readFileSync('/etc/machine-id','utf8').trim();if(LEGACY_IDENTITY_RE.test(machine))return {id:'vetro-'+machine.toLowerCase(),persistent:true};}catch(e){}try{var old=fs.readFileSync(file,'utf8').trim();if(LEGACY_IDENTITY_RE_2.test(old))return {id:old,persistent:true};}catch(e){}var id=newId();try{fs.writeFileSync(file,id+'\n',{mode:0o600});return {id:id,persistent:true};}catch(e){return {id:id,persistent:false};}}
function publicConfig(cfg){var out=Object.assign({},cfg||{});out.hasPassword=!!out.password;delete out.password;return out;}
function validateConfig(p,previous){previous=previous||{};if(p.enabled!=null&&typeof p.enabled!=='boolean')throw Error('enabled must be a boolean');var enabled=p.enabled!==false;
 if(typeof p.host!=='string'||p.host.length>253||(!p.host&&enabled)||p.host&&!HOST_RE.test(p.host))throw Error('Invalid MQTT host');
 if(p.port!=null&&(!Number.isInteger(p.port)||p.port<1||p.port>65535))throw Error('Invalid MQTT port');
 if(p.tls!=null&&typeof p.tls!=='boolean')throw Error('Invalid TLS option');
 var prefix=p.topicPrefix||'vetro';if(typeof prefix!=='string'||!TOPIC_RE.test(prefix)||prefix.length>120)throw Error('Invalid topic prefix');
 ['username','password','deviceName','clientId','ca'].forEach(function(k){if(p[k]!=null&&(typeof p[k]!=='string'||p[k].length>(k==='ca'?32768:k==='password'?1024:120)))throw Error('Invalid field: '+k);});
 return {enabled:enabled,host:p.host,port:p.port||(p.tls?8883:1883),tls:p.tls===true,ca:p.ca||null,username:p.username||null,password:Object.prototype.hasOwnProperty.call(p,'password')?p.password:previous.password||null,topicPrefix:prefix,deviceName:p.deviceName||'Vetro',clientId:p.clientId||previous.clientId||newId()};
}
function saveConfig(cfg){var temp=CONFIG_PATH_PERSISTENT+'.tmp';fs.writeFileSync(temp,JSON.stringify(cfg)+'\n',{mode:0o600});fs.chmodSync(temp,0o600);fs.renameSync(temp,CONFIG_PATH_PERSISTENT);}

function MqttBridge(getTelemetry,onMessage) {
    this.getTelemetry = getTelemetry;this.onMessage=onMessage||function(){};
    this.connected=false;this.state='disabled';this.topics=[];this.subscriptions=[];this.events=[];this.lastError=null;this.connectedAt=null;this.lastMessageAt=null;this.lastPublishAt=null;this.sent=0;this.received=0;this.retryAt=null;
    this.client = null;
    this.config = null;
    this.timer = null;
    this.publishTimer = null;
    this.reconnectTimer = null;
    this.running = false;
    this.discovered = false;this.discoveryTopics=[];this.availabilityTopic=null;this.lastPresence=null;this.legacyIdentity=legacyIdentity();this.identity=null;
}

MqttBridge.prototype._publishTelemetry = function () {
    if (!this.connected) return;
    var client = this;
    var t = this.getTelemetry();
    var prefix = (this.config.topicPrefix || 'vetro')+'/'+this.identity;
    if (t.error) return;

    function pub(suffix, value) {
        if (value === null || value === undefined || value === '') return;
        client.publish(prefix + '/' + suffix, String(value));
    }

    pub('soctemp-c', t.soctemp_c);
    pub('cpu-cores', t.cpu_cores);
    pub('loadavg-1m', t.loadavg ? t.loadavg.split(WHITESPACE_RE)[0] : null);
    pub('cpu-gov', t.cpu_gov);
    pub('cpu-freq-khz', t.cpu_freq_khz);
    pub('uptime-s', Math.round(t.uptime_s || 0));
    if (t.meminfo) {
        var mem = parseMeminfo(t.meminfo);
        pub('ram-used-kb', mem.MemTotal != null && mem.MemAvailable != null ? mem.MemTotal - mem.MemAvailable : null);
        pub('ram-total-kb', mem.MemTotal);
    }
};

MqttBridge.prototype._discover = function () {
    if (!this.connected || this.discovered) return;
    var client = this;
    var prefix = (this.config.topicPrefix || 'vetro')+'/'+this.identity;
    var deviceName = this.config.deviceName || 'Vetro';

    var device = {
        identifiers: [this.identity],
        name: deviceName,
        manufacturer: 'Samsung',
        model: 'Tizen TV'
    };

    // [entityId, name, device_class, unit, state_topic_suffix]
    var sensors = [
        ['soctemp', 'SoC temperature', 'temperature', '°C', 'soctemp-c'],
        ['cpu-load', 'Load average 1m', null, null, 'loadavg-1m'],
        ['cpu-freq', 'CPU frequency', null, null, 'cpu-freq-khz'],
        ['ram-used', 'RAM used', 'data_size', 'kB', 'ram-used-kb'],
        ['uptime', 'Uptime', null, 's', 'uptime-s']
    ];

    sensors.forEach(function (s) {
        var entityId = s[0];
        var conf = {
            name: s[1],
            state_topic: prefix + '/' + s[4],
            unique_id: client.identity+'_'+entityId,
            availability_topic: client.availabilityTopic, payload_available:'online',payload_not_available:'offline',
            device: device
        };
        if (s[2]) conf.device_class = s[2];
        if (s[3]) conf.unit_of_measurement = s[3];
        var topic='homeassistant/sensor/'+client.identity+'/'+entityId+'/config';client.publish(topic, JSON.stringify(conf),{retain:true});client.discoveryTopics.push(topic);
    });

    var fgTopic='homeassistant/sensor/'+client.identity+'/foreground-app/config';
    client.publish(fgTopic, JSON.stringify({
        name: 'Foreground app',
        state_topic: prefix + '/foreground-app',
        json_attributes_topic: prefix + '/foreground-app-attrs',
        unique_id: client.identity+'_foreground-app',
        availability_topic: client.availabilityTopic, payload_available:'online',payload_not_available:'offline',
        device: device
    }), {retain:true});client.discoveryTopics.push(fgTopic);

    // Each native state has its own availability, in addition to the service LWT.
    [['sensor','volume','Volume','volume','%'],
     ['binary_sensor','muted','Muted','muted',null],
     ['sensor','source','Source','source',null]].forEach(function(s){
        var conf={name:s[2],state_topic:prefix+'/'+s[3],unique_id:client.identity+'_'+s[1],device:device,
            availability:[{topic:client.availabilityTopic},{topic:prefix+'/'+s[3]+'/availability'}],
            availability_mode:'all',payload_available:'online',payload_not_available:'offline'};
        if(s[4])conf.unit_of_measurement=s[4];
        if(s[0]==='binary_sensor'){conf.payload_on='ON';conf.payload_off='OFF';}
        var topic='homeassistant/'+s[0]+'/'+client.identity+'/'+s[1]+'/config';
        client.publish(prefix+'/'+s[3]+'/availability','offline',{retain:true});
        client.publish(topic,JSON.stringify(conf),{retain:true});client.discoveryTopics.push(topic);
    });

    this.discovered = true;
};

MqttBridge.prototype.publishTvState = function(d) {
    if(!this.connected||!this.client||!this.identity)return;
    d=d||{};
    var prefix=(this.config.topicPrefix||'vetro')+'/'+this.identity;
    var values={volume:Number.isInteger(d.volume)&&d.volume>=0&&d.volume<=100?d.volume:null,
        muted:typeof d.muted==='boolean'?(d.muted?'ON':'OFF'):null,
        source:typeof d.source==='string'&&TV_SOURCE_RE.test(d.source)?d.source:null};
    var self=this;
    Object.keys(values).forEach(function(key){
        var value=values[key],available=value!==null;
        if(available)self.publish(prefix+'/'+key,String(value),{retain:true});
        self.publish(prefix+'/'+key+'/availability',available?'online':'offline',{retain:true});
        if(!available)self.publish(prefix+'/'+key,'',{retain:true});
    });
};

// Publishes the foreground app only when it changes. {name, appId, pid} or null.
MqttBridge.prototype.publishPresence = function (fg) {
    if (!this.connected || !this.client || !this.identity) return;
    var key = fg ? fg.appId + ':' + fg.pid : 'none';
    if (key === this.lastPresence) return;
    var prefix = (this.config.topicPrefix || 'vetro')+'/'+this.identity;
    this.publish(prefix + '/foreground-app', fg ? String(fg.name || fg.appId) : 'none', {retain:true});
    this.publish(prefix + '/foreground-app-attrs', JSON.stringify(fg ? {app_id: fg.appId, pid: fg.pid} : {app_id: null, pid: null}), {retain:true});
    this.lastPresence = key;
};

MqttBridge.prototype.start = function () {
    var self = this;
    if (this.running) return;
    this.running = true;

    this.config = readConfig();

    // poll for config changes every 30s
    this.timer = setInterval(function () {
        var cfg = readConfig();
        if (cfg && (!self.config || JSON.stringify(cfg) !== JSON.stringify(self.config))) {
            self.config = cfg;
            self._connect();
        } else if (!cfg && self.config) {
            self.config = null;
            self.stopClient();
        }
    }, 30000);

    // publish telemetry every 10s
    this.publishTimer = setInterval(function () {
        if (self.client) { self._publishTelemetry(); self._discover(); }
    }, 10000);

    if (this.config && this.config.enabled !== false) this._connect();
};

MqttBridge.prototype._connect = function () {
    var self = this;
    this.stopClient();

    var cfg = this.config;
    if (!this.running || !cfg || cfg.enabled === false || !cfg.host) return;

    this.identity=encodeURIComponent(cfg.clientId||this.legacyIdentity.id).replace(PERCENT_RE,'_');
    this.availabilityTopic=(cfg.topicPrefix||'vetro')+'/'+this.identity+'/availability';
    var client = new MqttClient({
        host: cfg.host,
        port: cfg.port || 1883,
        clientId: cfg.clientId || this.legacyIdentity.id,
        will:{topic:this.availabilityTopic,payload:'offline',retain:true},
        username: cfg.username || null,
        password: cfg.password || null,
        tls:cfg.tls===true,ca:cfg.ca||undefined
    });

    this.state='connecting';this.lastError=null;this.retryAt=null;this.event('connect','Connecting to broker');
    client.on('connect', function () {
        if (!self.running || self.client !== client) return;
        self.connected=true;self.state='connected';self.connectedAt=Date.now();self.lastError=null;self.event('connected','MQTT connection confirmed');
        self.subscriptions=self.topics.map(function(t){client.subscribe(t);return {topic:t,status:'pending'};});
        self.discovered = false;self.lastPresence = null;self.publish(self.availabilityTopic,'online',{retain:true});
        self._publishTelemetry();
        self._discover();
    });

    client.on('error',function(e){if(self.client!==client)return;self.lastError=String(e.message||e).slice(0,300);self.event('error',self.lastError);});
    client.on('subscribed',function(r){if(self.client!==client)return;self.subscriptions.forEach(function(s){if(s.topic===r.topic)s.status=r.accepted?'active':'refused'});self.event(r.accepted?'subscribed':'error',r.accepted?'Subscribed to topic: '+r.topic:'Subscription refused: '+r.topic);});
    client.on('message',function(m){if(self.client!==client)return;self.received++;self.lastMessageAt=Date.now();self.event('message',m.topic+' · '+m.payload.length+' bytes'+(m.retained?' · retained, ignored':''));if(m.retained||m.duplicate||m.payload.length>4096)return;self.onMessage(m);});
    client.on('close', function () {
        if (self.client !== client) return;
        self.client = null;self.connected=false;self.subscriptions=[];self.state='reconnecting';self.retryAt=Date.now()+10000;self.event('close','Connection closed');
        if (!self.running || !self.config || self.config.enabled === false || self.reconnectTimer) return;
        self.reconnectTimer = setTimeout(function () {
            self.reconnectTimer = null;
            if (self.running) self._connect();
        }, 10000);
    });

    this.client = client;
    client.connect();
};

MqttBridge.prototype.stopClient = function () {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    var client = this.client;
    if(client&&this.connected){try{this.discoveryTopics.forEach(function(t){client.publish(t,'',{retain:true});});if(this.availabilityTopic)client.publish(this.availabilityTopic,'offline',{retain:true});}catch(e){this.lastError=String(e.message||e);}}
    this.discoveryTopics=[];
    this.client = null;this.connected=false;this.state='disabled';this.retryAt=null;this.subscriptions=[];
    this.discovered = false;
    if (client) { try { client.close(); } catch (e) {} }
};

MqttBridge.prototype.stop = function () {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    if (this.publishTimer) clearInterval(this.publishTimer);
    this.timer = null;
    this.publishTimer = null;
    this.stopClient();
};

MqttBridge.prototype.event=function(type,message){this.events.push({ts:Date.now(),type:type,message:message});if(this.events.length>50)this.events.shift();};
MqttBridge.prototype.status=function(){return {identity:this.identity,identityPersistent:!!(this.config&&this.config.clientId)||this.legacyIdentity.persistent,availabilityTopic:this.availabilityTopic,state:this.state,connected:this.connected,lastError:this.lastError,connectedAt:this.connectedAt,retryAt:this.retryAt,lastMessageAt:this.lastMessageAt,lastPublishAt:this.lastPublishAt,sent:this.sent,received:this.received,subscriptions:this.subscriptions.slice(),events:this.events.slice()};};
MqttBridge.prototype.configure=function(cfg){this.config=cfg;this._connect();};
MqttBridge.prototype.setTopics=function(topics){topics=Array.from(new Set(topics)).sort();if(JSON.stringify(topics)===JSON.stringify(this.topics))return;this.topics=topics;if(this.running&&this.config)this._connect();};
MqttBridge.prototype.publish=function(topic,payload,opts){if(!this.connected||!this.client)throw Error('MQTT disconnected');this.client.publish(topic,payload,opts);this.sent++;this.lastPublishAt=Date.now();};

function parseMeminfo(s) {
    var out = {};
    String(s).split(';').forEach(function (line) {
        var m = line.match(MEMINFO_LINE_RE);
        if (m) out[m[1]] = parseInt(m[2], 10);
    });
    return out;
}

module.exports = { MqttBridge, readConfig, CONFIG_PATH, CONFIG_PATH_PERSISTENT, publicConfig:publicConfig,validateConfig:validateConfig,saveConfig:saveConfig };
