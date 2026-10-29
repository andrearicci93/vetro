'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
module.exports = function loadService(root, options) {
  options = options || {};
  let router;
  const dependencies = {
    fs: { readFileSync: function () { return ''; } },
    http: { createServer: function (fn) { router = fn; return { listen: function () {} }; } },
    './mqtt-bridge.js': Object.assign({},require('../service/mqtt-bridge.js'),{ MqttBridge: function (getTelemetry,onMessage) { this.onMessage=onMessage;this.event=function(){};this.connected=false; this.start = function () {};this.setTopics=function(){};this.status=function(){return {connected:false,state:'disabled',events:[]}};this.configure=function(){};this.publish=function(){throw Error('MQTT disconnected')}; } })
  };
  const context = vm.createContext(Object.assign({
    require: function (name) {
      return options.dependencies && Object.prototype.hasOwnProperty.call(options.dependencies, name) ? options.dependencies[name] : Object.prototype.hasOwnProperty.call(dependencies, name) ? dependencies[name]
        : name[0] === '.' ? require(path.join(root, 'service', name)) : require(name);
    }, __dirname: path.join(root, 'service'), Buffer, process, console, setTimeout, clearTimeout, setInterval: options.setInterval || setInterval, clearInterval
  }, options.globals));
  vm.runInContext(fs.readFileSync(path.join(root, 'service/main.js'), 'utf8'), context);
  return { context: context, router: router };
};
