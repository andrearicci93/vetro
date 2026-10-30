'use strict';
// Smallest useful Vetro plugin: counts button presses, keeps the count in its own
// config file and shows a page in the dashboard. Plain ES5: the TV runs Node 4.4.

module.exports = function (ctx) {
    var count = 0;

    var PAGE = '<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light dark">' +
        '<body style="font:16px system-ui;margin:24px"><h2>Hello</h2><p>Presses: <b id="n">…</b></p>' +
        '<button id="b">Press</button><script>' +
        'function show(d){document.getElementById("n").textContent=d.count}' +
        'function get(){fetch("count").then(function(r){return r.json()}).then(show)}' +
        'document.getElementById("b").onclick=function(){fetch("press",{method:"POST",headers:{"Content-Type":"text/plain"},body:"{}"}).then(function(r){return r.json()}).then(show)};get();' +
        '</script></body>';

    function json(res, body, code) {
        res.writeHead(code || 200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(body));
    }

    return {
        start: function () { count = ctx.config.get().count || 0; },
        stop: function () { /* nothing to release */ },
        status: function () { return { count: count }; },

        // Served under /plugins/hello/api/<sub>. Return false for anything you do not handle.
        route: function (req, res, sub) {
            if (sub === 'ui' && req.method === 'GET') {
                res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
                res.end(PAGE);
                return true;
            }
            if (sub === 'count' && req.method === 'GET') { json(res, { count: count }); return true; }
            if (sub === 'press' && req.method === 'POST') {
                count++;
                ctx.config.set({ count: count });
                json(res, { count: count });
                return true;
            }
            return false;
        }
    };
};
