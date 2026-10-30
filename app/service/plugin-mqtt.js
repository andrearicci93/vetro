'use strict';
// MQTT as the first plugin on the host (see plugin-host.js). The bridge itself is
// built by main.js because rules and actions still reach into it; the plugin
// owns its lifecycle (start/stop) and its routes. The legacy /mqtt route keeps
// working unchanged.

var mqtt = require('./mqtt-bridge.js');

function definition(bridge) {
    return {
        id: 'mqtt',
        name: 'MQTT & Home Assistant',
        version: '1',
        apiVersion: 1,
        permissions: [],
        create: function () {
            return {
                start: function () { bridge.start(); },
                stop: function () { bridge.stop(); },
                status: function () { return { connected: !!bridge.connected, state: bridge.state }; },
                // GET /plugins/mqtt/api/config
                route: function (req, res, sub) {
                    if (sub !== 'config' || req.method !== 'GET') return false;
                    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ config: mqtt.publicConfig(mqtt.readConfig()), status: bridge.status() }));
                    return true;
                }
            };
        }
    };
}

module.exports = { definition: definition };
