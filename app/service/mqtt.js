'use strict';

// Minimal MQTT 3.1.1 client over TCP or verified TLS, zero dependencies.
//
// Runs on the TV's Node v12 runtime inside the on-boot service. Supports the
// subset Vetro needs: CONNECT (username/password), QoS 0 PUBLISH, SUBSCRIBE,
// PINGREQ keepalive, and incoming PUBLISH (QoS 0 and 1, the latter ACK'd).
// Clean sessions; retained flag exposed to callers, no session persistence.

var net = require('net');
var tls = require('tls');
// Regular expressions compiled once at module load, not on every call.
var WILDCARD_RE = /[+#]/;

function encodeRemainingLength(n) {
    var out = [];
    do {
        var digit = n % 128;
        n = Math.floor(n / 128);
        if (n > 0) digit |= 0x80;
        out.push(digit);
    } while (n > 0);
    return out;
}

function encodeString(str) {
    var b = Buffer.from(str, 'utf8');
    var h = Buffer.alloc(2);
    h.writeUInt16BE(b.length, 0);
    return Buffer.concat([h, b]);
}

function packet(type, flags, payload) {
    var body = payload || Buffer.alloc(0);
    var header = [ (type << 4) | (flags & 0x0f) ];
    var rl = encodeRemainingLength(body.length);
    return Buffer.concat([
        Buffer.from(header.concat(rl)),
        body
    ]);
}

function MqttClient(opts) {
    opts = opts || {};
    this.host = opts.host || '127.0.0.1';
    this.port = opts.port || 1883;
    this.clientId = opts.clientId || ('vetro-' + Math.random().toString(16).slice(2, 10));
    this.username = opts.username || null;
    this.password = opts.password || null;
    this.keepalive = opts.keepalive || 30;
    this.tls = opts.tls === true;
    this.ca = opts.ca || undefined;
    this.will=opts.will||null;
    if(this.will && (typeof this.will.topic!=='string'||!this.will.topic||WILDCARD_RE.test(this.will.topic)||Buffer.byteLength(this.will.topic)>65535||Buffer.byteLength(String(this.will.payload))>65535))throw Error('Invalid MQTT will');
    this._packetId = 0;this._subscriptions = {};this._pingOutstanding=false;

    this._socket = null;
    this._connected = false;
    this._buffer = Buffer.alloc(0);
    this._pingTimer = null;
    this._handlers = { message: [], connect: [], close: [], error: [], subscribed: [] };
    this._subscribers = [];
}

MqttClient.prototype.on = function (evt, fn) {
    if (this._handlers[evt]) this._handlers[evt].push(fn);
    return this;
};

MqttClient.prototype._emit = function (evt, arg) {
    (this._handlers[evt] || []).forEach(function (fn) { try { fn(arg); } catch (e) {} });
};

MqttClient.prototype.connect = function () {
    var self = this;
    this.close();
    this._buffer = Buffer.alloc(0);
    var options={host:this.host,port:this.port};
    if(this.tls){options.rejectUnauthorized=true;options.ca=this.ca;if(!net.isIP(this.host))options.servername=this.host;}
    var socket;try{socket = this.tls ? tls.connect(options) : net.connect(options);}catch(e){this._emit('error',e);this._emit('close',{});return this;}
    this._socket = socket;

    socket.setNoDelay(true);
    socket.setTimeout(10000);
    socket.on('timeout',function(){if(self._socket===socket)self._fail('MQTT connection timeout');});

    socket.on(this.tls?'secureConnect':'connect', function () {
        if (self._socket !== socket) return;
        socket.write(self._connectPacket());
    });

    socket.on('data', function (chunk) {
        if (self._socket !== socket) return;
        if(self._buffer.length+chunk.length>1048576)return self._fail('MQTT packet too large');
        self._buffer = Buffer.concat([self._buffer, chunk]);
        try{self._drain();}catch(e){self._fail(e.message);}
    });

    socket.on('close', function () {
        if (self._socket !== socket) return;
        self._socket = null;
        self._teardown();
        self._emit('close', {});
    });

    socket.on('error', function (e) {
        if(self._socket!==socket)return;
        self._emit('error', e);
        // the 'close' event will follow; teardown there
    });

    return this;
};

MqttClient.prototype._connectPacket = function () {
    var flags = 0x02; // clean session
    var payload = [ encodeString(this.clientId) ];
    if(this.will){flags|=0x04;if(this.will.retain)flags|=0x20;payload.push(encodeString(this.will.topic),encodeString(String(this.will.payload)));}
    if (this.username) {
        flags |= 0x80;
        payload.push(encodeString(this.username));
    }
    if (this.password) {
        flags |= 0x40;
        payload.push(encodeString(this.password));
    }
    var varHeader = Buffer.concat([
        encodeString('MQTT'),
        Buffer.from([0x04, flags]),
        (function (ka) { var b = Buffer.alloc(2); b.writeUInt16BE(ka, 0); return b; })(this.keepalive)
    ]);
    return packet(1, 0, Buffer.concat([varHeader].concat(payload)));
};

MqttClient.prototype._teardown = function () {
    this._connected = false;this._subscriptions={};this._subscribers=[];this._pingOutstanding=false;
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
};

MqttClient.prototype._fail=function(message){this._emit('error',new Error(message));this.close();this._emit('close',{});};
MqttClient.prototype._drain=function(){
 while(this._buffer.length>=2){var type=this._buffer[0]>>4,flags=this._buffer[0]&15,value=0,multiplier=1,idx=1,digit;
  do{if(idx>=this._buffer.length)return;if(idx>4)throw Error('Malformed MQTT length');digit=this._buffer[idx++];value+=(digit&127)*multiplier;multiplier*=128;}while(digit&128);
  if(value>1048576)throw Error('MQTT packet too large');if(this._buffer.length<idx+value)return;
  var body=this._buffer.slice(idx,idx+value);this._buffer=this._buffer.slice(idx+value);
  if(!this._connected&&type!==2)throw Error('Missing MQTT CONNACK');
  if(type===2&&(flags!==0||body.length!==2))throw Error('Malformed MQTT CONNACK');
  this._handle(type,flags,body);if(!this._socket)return;
 }
};

MqttClient.prototype._handle = function (type, flags, body) {
    switch (type) {
        case 2: { // CONNACK
            var code = body.length >= 2 ? body[1] : -1;
            if (code === 0) {
                this._connected = true;
                this._socket.setTimeout(0);
                this._startKeepalive();
                this._emit('connect', {});
            } else {
                this._emit('error', new Error('MQTT CONNACK refused, code ' + code));
                this.close();
                this._emit('close', {});
            }
            break;
        }
        case 3: { // PUBLISH (incoming)
            if(body.length<2)throw Error('Malformed MQTT publish');
            var topicLen = body.readUInt16BE(0);
            if(!topicLen||body.length<2+topicLen)throw Error('Malformed MQTT topic');
            var topic = body.slice(2, 2 + topicLen).toString('utf8');
            var qos = (flags >> 1) & 0x03;
            var payloadStart = 2 + topicLen;
            if(qos>1)throw Error('Unsupported MQTT QoS');
            if(qos&&body.length<payloadStart+2)throw Error('Missing MQTT packet id');
            if (qos > 0) payloadStart += 2; // packet id
            var payload = body.slice(payloadStart);
            var msg = { topic: topic, payload: payload,retained:!!(flags&1),duplicate:!!(flags&8),qos:qos };

            var self = this;
            this._subscribers.forEach(function (s) {
                if (matchesTopic(s.topic, topic)) {
                    try { s.fn(msg); } catch (e) {}
                }
            });
            this._handlers.message.forEach(function (fn) { try { fn(msg); } catch (e) {} });

            if (qos === 1) {
                // PUBACK with the same packet id
                var pid = body.slice(2 + topicLen, 2 + topicLen + 2);
                this._socket && this._socket.write(packet(4, 0, pid));
            }
            break;
        }
        case 12: // PINGREQ -> respond PINGRESP
            this._socket && this._socket.write(packet(13, 0, null));
            break;
        case 13: this._pingOutstanding=false;break;
        case 4: break;
        case 9:
            if(body.length!==3)throw Error('Malformed MQTT SUBACK');
            var id=body.readUInt16BE(0),topic=this._subscriptions[id];delete this._subscriptions[id];
            if(topic)this._emit('subscribed',{topic:topic,accepted:body[2]===0});
            break;
    }
};

MqttClient.prototype._startKeepalive = function () {
    var self = this;
    this._pingTimer = setInterval(function () {
        if(self._pingOutstanding){self._fail('MQTT keepalive timeout');return;}
        if (self._socket){self._pingOutstanding=true;self._socket.write(packet(12, 0, null));}
    }, Math.floor(this.keepalive * 1000) * 0.5 || 15000);
};

MqttClient.prototype.publish = function (topic, payload, opts) {
    if (!this._connected) return this;
    var data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
    var body = Buffer.concat([ encodeString(topic), data ]);
    if (this._socket) this._socket.write(packet(3, opts&&opts.retain?1:0, body));
    return this;
};

MqttClient.prototype.subscribe = function (topic, fn) {
    if (fn) this._subscribers.push({ topic: topic, fn: fn });
    // Without a callback, the global message event is sufficient.
    if (this._socket) {
        var pid = Buffer.alloc(2);
        this._packetId=this._packetId%65535+1;pid.writeUInt16BE(this._packetId,0);this._subscriptions[this._packetId]=topic;
        var body = Buffer.concat([ pid, encodeString(topic), Buffer.from([0]) ]); // QoS 0
        this._socket.write(packet(8, 2, body));
    }
    return this;
};

MqttClient.prototype.close = function () {
    var connected=this._connected;
    this._teardown();
    var socket = this._socket;
    this._socket = null;
    if(socket){if(connected){socket.setTimeout(1000,function(){socket.destroy();});socket.end(packet(14,0,null));}else socket.destroy();}
};

function matchesTopic(pattern, topic) {
    var p = pattern.split('/');
    var t = topic.split('/');
    for (var i = 0; i < p.length; i++) {
        if (p[i] === '#') return true;
        if (p[i] === '+') { if (i >= t.length) return false; continue; }
        if (t[i] !== p[i]) return false;
    }
    return p.length === t.length;
}

module.exports = { MqttClient, matchesTopic };