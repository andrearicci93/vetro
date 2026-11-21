'use strict';
// What changes in the YouTube TV page: a script tag before </body>, and a Content-Security-Policy that allows it.
// Cobalt wants a CSP header on every page (without one it closes a few seconds after the page loads), so the original
// is replaced, not just removed.

var SCRIPT_PATH = '/vetro-youtube/userscript.js';     // served by the proxy itself, on the youtube.com origin

var CSP = "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; img-src * data: blob:; media-src * data: blob:; " +
    "script-src * data: blob: 'unsafe-inline' 'unsafe-eval'; style-src * data: blob: 'unsafe-inline'; connect-src *; font-src * data:";

var META_CSP_RE = /<meta\b[^>]*http-equiv\s*=\s*["']Content-Security-Policy(?:-Report-Only)?["'][^>]*>/gi;

// The TV app's start page: /tv or /tv?..., not /tv_config or anything else that merely starts with /tv.
function isTvPage(url) { return url === '/tv' || url.indexOf('/tv?') === 0 || url.indexOf('/tv#') === 0; }

function scriptTag(version) { return '<script src="' + SCRIPT_PATH + '?v=' + encodeURIComponent(version) + '"></script>'; }

// -> {html, injected}. Without a </body> the tag goes at the end of the document.
function rewritePage(html, tag) {
    var text = String(html).replace(META_CSP_RE, '');
    var at = text.indexOf('</body>');
    if (at < 0) return { html: text + tag, injected: false };
    return { html: text.slice(0, at) + tag + text.slice(at), injected: true };
}

// Response headers of the rewritten page: no CSP from YouTube, ours instead; length and encoding are recomputed.
function pageHeaders(upstream, byteLength) {
    var h = {};
    Object.keys(upstream).forEach(function (k) {
        if (k === 'content-security-policy' || k === 'content-security-policy-report-only' || k === 'content-length' ||
            k === 'content-encoding' || k === 'alt-svc') return;
        h[k] = upstream[k];
    });
    h['content-security-policy'] = CSP;
    h['content-length'] = byteLength;
    return h;
}

// Headers of everything else: unchanged, except an alt-svc that would send the app to YouTube over QUIC, around the proxy.
function passHeaders(upstream) {
    var h = {};
    Object.keys(upstream).forEach(function (k) { if (k !== 'alt-svc') h[k] = upstream[k]; });
    return h;
}

// Only these hosts are opened up and rewritten; every other host is a plain tunnel.
var MITM_HOSTS = { 'www.youtube.com': 1, 'youtube.com': 1 };

module.exports = { SCRIPT_PATH: SCRIPT_PATH, CSP: CSP, isTvPage: isTvPage, scriptTag: scriptTag, rewritePage: rewritePage,
    pageHeaders: pageHeaders, passHeaders: passHeaders, MITM_HOSTS: MITM_HOSTS };
