/* Shared helpers for dock.html, tuner.html, epg.html. Geometry is canvas pixels at 1920x1080; values come from tokens.css. */
var Tv = (function () {
  var root = document.documentElement, cs = getComputedStyle(root);
  function tok(n) { return cs.getPropertyValue(n).trim(); }
  function px(n) { return parseFloat(tok(n)); }
  function mk(parent, cls, x, y, w, h, extra) {
    var e = document.createElement('div');
    e.className = cls; e.style.left = x + 'px'; e.style.top = y + 'px';
    if (w != null) e.style.width = w + 'px';
    if (h != null) e.style.height = h + 'px';
    if (extra) for (var k in extra) e.style.setProperty(k, extra[k]);
    parent.appendChild(e); return e;
  }
  function text(parent, s, x, y, size, kind, maxW, right) {
    var e = mk(parent, 't' + (kind ? ' ' + kind : '') + (right ? ' r' : ''), right ? x - maxW : x, y, maxW, null, { 'font-size': size + 'px' });
    e.textContent = s; return e;
  }
  /* The guide's footer as the tuner draws it (tuner/src/Core/GuideScene.cs, Footer): the remote's keys as pictures (assets/tuner/key_*.png) and a word per group;
     34 px keys, 2 px between two keys, 8 px key to word, 56 px between groups; word widths estimated at 12 px a letter, like the tuner does. */
  function guideFooter(c, x, top, size, kind, measured) {
    [[['ok'], 'Watch'], [['left', 'right'], 'Time'], [['up', 'down'], 'Channel'], [['ch'], 'Page'], [['back'], 'Close']].forEach(function (g) {
      g[0].forEach(function (k, i) {
        var w = k === 'ch' ? Math.floor(34 * 96 / 62) : 34;
        mk(c, 'keyimg', x, top - 2, w, 34, { 'background': 'url(assets/tuner/key_' + k + '.png) center / contain no-repeat', 'opacity': '.85' });
        x += w + (i < g[0].length - 1 ? 2 : 8);
      });
      var ww = measured ? textW(g[1], size, 500) : g[1].length * 12;   // measured: the opus6 EPG (words measured, 44 px between groups, text 4 px lower); else 12 px a letter
      text(c, g[1], x, measured ? top + 4 : top, size, kind, ww + 40);
      x += ww + (measured ? 44 : 56);
    });
  }
  function sheet(c, x, y, w, h) { return mk(c, 'sheet', x, y, w, h); }

  /* ---- the two materials (tv-material.css; DESIGN.md "TV material") ---- */
  /* The panel: rim 2 px outside, then the slate body; r = 40 for a panel, h / 2 for a capsule. Returns { move(x, y, w, h, r) }. */
  function panel(c, x, y, w, h, r) {
    var rim = mk(c, 'pnl-rim'), body = mk(c, 'pnl-body');
    function move(x2, y2, w2, h2, r2) { r2 = r2 == null ? r : r2; place(rim, x2 - 2, y2 - 2, w2 + 4, h2 + 4); place(body, x2, y2, w2, h2); rim.style.setProperty('--r', r2 + 'px'); body.style.setProperty('--r', r2 + 'px'); }
    move(x, y, w, h, r); return { move: move, rim: rim, body: body };
  }
  /* The ice focus capsule (or, with rest, a resting key: white .14). */
  function cap(c, x, y, w, h, rest) { var e = mk(c, 'cap' + (rest ? ' rest' : '')); placeCap(e, x, y, w, h); return e; }
  function placeCap(e, x, y, w, h) { place(e, x, y, w, h); e.style.setProperty('--r', Math.floor(h / 2) + 'px'); }
  function place(e, x, y, w, h) { e.style.left = x + 'px'; e.style.top = y + 'px'; e.style.width = w + 'px'; e.style.height = h + 'px'; }
  /* The veil: veil_corner.png stretched from (0, 1080); shape 'banner' | 'info' | 'epg' (sizes and alphas from tokens.css), or null to hide. */
  function veil(c) { var e = mk(c, 'veil', 0, 1080, 0, 0); e.style.opacity = 0; return e; }
  function setVeil(e, shape) {
    if (!shape) { e.style.opacity = 0; return; }
    var w = px('--vetro-tv-veil-' + shape + '-w'), h = px('--vetro-tv-veil-' + shape + '-h');
    place(e, 0, 1080 - h, w, h); e.style.opacity = tok('--vetro-tv-veil-' + shape + '-alpha');
  }
  /* Text widths, measured with the TV's font (load it first: Tv.ready). */
  var meas = document.createElement('canvas').getContext('2d');
  function textW(s, size, wt) { meas.font = (wt || 500) + ' ' + size + 'px SamsungOneUI'; return Math.round(meas.measureText(s).width); }
  /* SamsungOneUI's line (ascender 952 + descender 276 per 1024) centred in a line box as high as the font size: the baseline is this far below the top. */
  function baseOff(size) { return size * (1024 + 952 - 276) / 2048; }
  /* Puts element e (size) on the baseline of a text of size refSize whose line-box top is refTop. */
  function onBaseline(e, size, refTop, refSize) { e.style.top = Math.round(refTop + baseOff(refSize) - baseOff(size)) + 'px'; }
  /* The progress row of the Banner and Info (ProgressView / ProgressRow): times at both ends, the track, the Luce progress with its head, and
     "N min left" following the head; a time the label would come within 28 px of hides (alpha 0) and the label may run to the line's end. */
  function progressRow(c, x0, x1, timesTop, lineY, start, end, left, f) {
    var gap = px('--vetro-tv-left-gap'), hx = Math.round(x0 + (x1 - x0) * Math.max(0, Math.min(1, f)));
    mk(c, 'trk', x0, lineY, x1 - x0, 6);
    mk(c, 'prg', x0, lineY - 13, Math.max(40, hx - x0 + 16), 32);
    var sw = textW(start, 26, 500), ew = textW(end, 26, 500), lw = textW(left, 26, 600);
    var se = text(c, start, x0, timesTop, 26, 'v muted', sw + 8), ee = text(c, end, x1, timesTop, 26, 'v muted', ew + 8, true);
    var ideal = hx - lw / 2, lx;
    if (ideal > x1 - ew - gap - lw) { ee.style.opacity = 0; lx = Math.min(ideal, x1 - lw); }
    else if (ideal < x0 + sw + gap) { se.style.opacity = 0; lx = Math.max(ideal, x0); }
    else lx = ideal;
    if (left) text(c, left, Math.round(lx), timesTop, 26, 'v w600', lw + 8);
  }
  /* Runs fn once the TV font is loaded (widths and baselines depend on it). */
  function ready(fn) {
    if (!document.fonts || !document.fonts.load) { fn(); return; }
    Promise.all([200, 500, 600].map(function (w) { return document.fonts.load(w + ' 32px SamsungOneUI'); })).then(fn, fn);
  }
  function fill(c, x, y, w, h, a) { return mk(c, 'fill', x, y, w, h, a != null ? { '--a': a } : null); }
  function ring(c, x, y, w, h) { return mk(c, 'ring', x, y, w, h); }
  function fit() {
    var c = document.getElementById('canvas'); if (!c) return;
    c.style.transform = 'scale(' + Math.min(innerWidth / 1920, innerHeight / 1080) + ')';
  }
  /* toolbar: backdrop switch, a status line, the key hints; fades when idle */
  function toolbar(hint, links) {
    var bar = document.createElement('div'); bar.id = 'bar';
    var qb = /[?&]bd=(\w+)/.exec(location.search), bd = qb ? qb[1] : null;   // ?bd=video|black|light|grid
    if (!bd) { try { bd = localStorage.getItem('vetro-bd'); } catch (e) {} } bd = bd || 'video';
    root.setAttribute('data-bd', bd);
    ['video', 'black', 'light', 'grid'].forEach(function (n) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = n; b.setAttribute('aria-pressed', n === bd);
      b.addEventListener('click', function () { root.setAttribute('data-bd', n); try { localStorage.setItem('vetro-bd', n); } catch (e) {} bar.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); });
      bar.appendChild(b);
    });
    var st = document.createElement('span'); st.className = 'status'; bar.appendChild(st);
    var h = document.createElement('span'); h.className = 'hint'; h.textContent = hint; bar.appendChild(h);
    (links || []).forEach(function (l) { var a = document.createElement('a'); a.href = l[1]; a.textContent = l[0]; bar.appendChild(a); });
    document.body.appendChild(bar);
    var t; function wake() { bar.classList.remove('idle'); clearTimeout(t); t = setTimeout(function () { bar.classList.add('idle'); }, 4000); }
    addEventListener('mousemove', wake); addEventListener('keydown', wake);
    if (/[?&]still/.test(location.search)) bar.classList.add('idle'); else wake();   // ?still: screenshots without the bar
    return { say: function (s) { st.textContent = s; } };
  }
  addEventListener('resize', fit);
  return { tok: tok, px: px, mk: mk, text: text, sheet: sheet, fill: fill, ring: ring, fit: fit, toolbar: toolbar, guideFooter: guideFooter,
           panel: panel, cap: cap, placeCap: placeCap, place: place, veil: veil, setVeil: setVeil, textW: textW, baseOff: baseOff, onBaseline: onBaseline, progressRow: progressRow, ready: ready };
}());
