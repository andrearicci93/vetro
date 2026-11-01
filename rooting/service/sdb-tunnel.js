'use strict';

// Lets a PC on the LAN run `sdb connect <tv-ip>:<port>` and use the TV's own
// sdbd (push, install, shell, forward) without Developer Mode's Host PC IP
// pointing at that PC. Every relayed connection still reaches sdbd from
// 127.0.0.1 (this process's own loopback), which is the host sdbd already
// trusts; nothing here changes what sdbd authorizes.
//
// This has the same reach as pointing Host PC IP at any LAN host would: a
// client that can connect here can push and install on the TV. The LAN is
// already fully trusted by the rest of Vetro (see SECURITY.md), so this adds
// no new class of exposure, only another door into the same room.

var net = require('net');
var SDB_PORT = require('./sdb.js').SDB_PORT;

function TunnelServer(opts) {
    opts = opts || {};
    this.port = opts.port || 0;
    this.bindHost = opts.bindHost || '0.0.0.0';
    this.sdbHost = opts.sdbHost || '127.0.0.1';
    this.sdbPort = opts.sdbPort || SDB_PORT;
    this._server = null;
}

TunnelServer.prototype.start = function (cb) {
    var self = this;
    this._server = net.createServer(function (client) {
        var upstream = net.connect(self.sdbPort, self.sdbHost);
        client.pipe(upstream);
        upstream.pipe(client);
        upstream.on('error', function () { client.destroy(); });
        client.on('error', function () { upstream.destroy(); });
        upstream.on('close', function () { client.destroy(); });
        client.on('close', function () { upstream.destroy(); });
    });
    this._server.on('error', function (e) { if (cb) cb(e); });
    this._server.listen(this.port, this.bindHost, function () {
        if (cb) cb(null, self._server.address().port);
    });
    return this;
};

TunnelServer.prototype.close = function () {
    if (this._server) { try { this._server.close(); } catch (e) {} this._server = null; }
};

module.exports = { TunnelServer: TunnelServer };
