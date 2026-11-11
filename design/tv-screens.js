/* TV screens extracted from index.html (dock, banner, list, pad, toast, guide). Expects helpers mk text sheet fill ring px tok in scope. */
function makeScreens(mk, text, sheet, fill, ring, px, tok) {
  var screens = {};
  /* The guide's footer as the tuner draws it (tuner/src/Core/GuideScene.cs, Footer): the remote's keys as pictures (assets/tuner/key_*.png) and a word per group;
     34 px keys, 2 px between two keys, 8 px key to word, 56 px between groups; word widths estimated at 12 px a letter, like the tuner does. */
  function guideFooter(c, x, top, size, kind) {
    [[['ok'], 'Watch'], [['left', 'right'], 'Time'], [['up', 'down'], 'Channel'], [['ch'], 'Page'], [['back'], 'Close']].forEach(function (g) {
      g[0].forEach(function (k, i) {
        var w = k === 'ch' ? Math.floor(34 * 96 / 62) : 34;
        mk(c, 'keyimg', x, top - 2, w, 34, { 'background': 'url(assets/tuner/key_' + k + '.png) center / contain no-repeat', 'opacity': '.85' });
        x += w + (i < g[0].length - 1 ? 2 : 8);
      });
      text(c, g[1], x, top, size, kind, g[1].length * 12 + 40);
      x += g[1].length * 12 + 56;
    });
  }

  /* ---------- dock ---------- */
  screens.dock = function (c) {
    var icon = px('--vetro-tv-dock-icon'), foc = px('--vetro-tv-dock-icon-focus'), gap = px('--vetro-tv-dock-gap'),
        padX = px('--vetro-tv-dock-pad-x'), padY = px('--vetro-tv-dock-pad-y'), gg = px('--vetro-tv-dock-group-gap'),
        pw = px('--vetro-tv-dock-pill-w'), ph = px('--vetro-tv-dock-pill-h'), pg = px('--vetro-tv-dock-pill-gap'), bottom = px('--vetro-tv-dock-bottom');
    var apps = [['TV', '#1674fb'], ['▶', '#c2364a'], ['♪', '#1fa971'], ['◎', '#8a52d6'], ['★', '#d98a1e'], ['▦', '#2a8fb8'], ['✦', '#b8478f'], ['☰', '#5f6f86'], ['◐', '#c26a2c'], ['⌂', '#3d7ad6']];
    var focusIdx = 2;
    var appsW = apps.length * icon + (apps.length - 1) * gap;
    var w = padX * 2 + appsW + gg + pw, h = padY * 2 + foc;
    var x0 = Math.round((px('--vetro-tv-w') - w) / 2), y0 = px('--vetro-tv-h') - bottom - h;
    sheet(c, x0, y0, w, h);
    var cy = y0 + h / 2;
    apps.forEach(function (a, i) {
      var s = i === focusIdx ? foc : icon, x = x0 + padX + i * (icon + gap) - (s - icon) / 2;
      var e = mk(c, 'app' + (i === focusIdx ? ' on' : ''), x, cy - s / 2, s, s, { 'background': 'linear-gradient(145deg, color-mix(in srgb, ' + a[1] + ' 78%, #fff), ' + a[1] + ' 55%, color-mix(in srgb, ' + a[1] + ' 70%, #000))', '--c': a[1], 'font-size': Math.round(s * .36) + 'px' });
      e.textContent = a[0];
    });
    var dx = x0 + padX + appsW + gg / 2 - 1;
    mk(c, 'rule', dx, cy - 36, 2, 72, { '--a': tok('--vetro-tv-dock-divider') });
    var px0 = x0 + w - padX - pw, py = cy - (2 * ph + pg) / 2;
    ['Settings', 'Samsung Home'].forEach(function (n, i) { var e = mk(c, 'pill', px0, py + i * (ph + pg), pw, ph); e.textContent = n; });
  };

  /* ---------- tuner: banner ---------- */
  screens.banner = function (c) {
    var X = px('--vetro-tv-margin'), W = px('--vetro-tv-banner-w'), H = px('--vetro-tv-banner-h'), pad = px('--vetro-tv-banner-pad'), Y = px('--vetro-tv-banner-bottom') - H;
    sheet(c, X, Y, W, H);
    text(c, '7', X + pad, Y + 22, px('--vetro-tv-type-display'), '', 110);
    text(c, 'Cinema', X + pad + 110, Y + 32, px('--vetro-tv-type-title'), '', W - 2 * pad - 114);
    text(c, 'La notte del cacciatore', X + pad, Y + 84, px('--vetro-tv-type-subtitle'), '', W - 2 * pad);
    text(c, '21:20 – 23:05', X + pad, Y + 126, px('--vetro-tv-type-meta'), 'muted', 300);
    text(c, '1 h 13 min left', X + W - pad, Y + 126, px('--vetro-tv-type-meta'), 'muted', 300, true);
    var tw = W - 2 * pad;
    mk(c, 'bar-track', X + pad, Y + H - 30, tw, 6, { background: 'color-mix(in srgb, var(--vetro-tv-ink) calc(var(--vetro-tv-track) * 100%), transparent)' });
    mk(c, 'bar-track', X + pad, Y + H - 30, Math.round(tw * .31), 6, { background: 'color-mix(in srgb, var(--vetro-tv-ink) calc(var(--vetro-tv-progress) * 100%), transparent)' });
  };

  /* ---------- tuner: channel list ---------- */
  var CH = ['Cinema', 'Sport 1', 'Sport 2', 'Doc', 'News 24', 'Cinema', 'Kids', 'Music', 'Retro', 'Quiz', 'Cucina', 'Viaggi', 'Storia', 'Natura', 'Serie'];
  screens.list = function (c) {
    var X = px('--vetro-tv-list-x'), Y = px('--vetro-tv-list-y'), W = px('--vetro-tv-list-w'), pad = px('--vetro-tv-list-pad'), RH = px('--vetro-tv-list-row-h'), rows = 11, sel = 5;
    sheet(c, X, Y, W, rows * RH + 2 * pad);
    for (var r = 0; r < rows; r++) {
      var y = Y + pad + r * RH, on = r === sel;
      if (on) { fill(c, X + 16, y + 2, W - 32, RH - 4, tok('--vetro-tv-fill-select')); ring(c, X + 16, y + 2, W - 32, RH - 4); }
      text(c, String(20 + r), X + 44, y + 13, px('--vetro-tv-type-row'), on ? '' : 'muted', 90);
      text(c, CH[r], X + 150, y + 13, px('--vetro-tv-type-row'), '', W - 150 - 40);
    }
  };

  /* ---------- tuner: number pad ---------- */
  screens.pad = function (c) {
    var X = px('--vetro-tv-list-x'), Y = px('--vetro-tv-list-y'), W = px('--vetro-tv-list-w'), P = px('--vetro-tv-pad-pad'),
        kw = px('--vetro-tv-pad-key-w'), kh = px('--vetro-tv-pad-key-h'), g = px('--vetro-tv-pad-gap'), gy = 232, H = gy + 4 * kh + 3 * g + P;
    sheet(c, X, Y, W, H);
    text(c, 'Channel number', X + P, Y + 30, px('--vetro-tv-type-meta'), 'muted', W - 2 * P);
    text(c, '23', X + P, Y + 62, px('--vetro-tv-type-entry'), '', W - 2 * P);
    text(c, 'Cinema', X + P, Y + 166, px('--vetro-tv-type-body'), 'muted', W - 2 * P);
    var labels = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Delete', '0', 'Go'], focus = 4;
    labels.forEach(function (l, i) {
      var col = i % 3, row = Math.floor(i / 3), x = X + P + col * (kw + g), y = Y + gy + row * (kh + g);
      fill(c, x, y, kw, kh, i === focus ? tok('--vetro-tv-fill-key-focus') : tok('--vetro-tv-fill-rest'));
      var k = mk(c, 'key' + (l.length > 1 ? ' w' : ''), x, y, kw, kh); k.textContent = l;
      if (i === focus) ring(c, x, y, kw, kh);
    });
  };

  /* ---------- tuner: toast ---------- */
  screens.toast = function (c) {
    var pad = px('--vetro-tv-toast-pad'), H = px('--vetro-tv-toast-h'), right = px('--vetro-tv-w') - px('--vetro-tv-margin'), y = px('--vetro-tv-toast-y'), w = 400;
    sheet(c, right - w, y, w, H);
    text(c, 'Audio: Italian', right - w + pad, y + 17, px('--vetro-tv-type-row'), '', w - 2 * pad);
  };

  /* ---------- guide ---------- */
  var GUIDE = [
    ['News 24', 1, [[-20, 50, 'Notizie della sera'], [30, 30, 'Meteo e traffico'], [60, 90, 'Il processo'], [150, 60, 'Speciale']]],
    ['Sport 1', 2, [[-45, 75, 'Serie A: studio'], [30, 120, 'Serie A: la partita'], [150, 60, 'Dopo partita']]],
    ['Cinema', 7, [[-20, 105, 'La notte del cacciatore'], [85, 95, 'Il sorpasso']]],
    ['Doc', 8, [[-10, 40, 'Oceani'], [30, 45, 'Savana'], [75, 50, 'Alpi'], [125, 55, 'Isole']]],
    ['Kids', 9, [[-30, 55, 'Cartoni della sera'], [25, 20, 'Nanna'], [45, 135, null]]],
    ['Music', 10, [[-60, 120, 'Concerto dal vivo'], [60, 120, 'Top 50']]],
    ['Retro', 11, [[-15, 30, 'Sit-com'], [15, 30, 'Sit-com'], [45, 45, 'Varietà'], [90, 90, 'Film western']]]
  ];
  function clock(min) { var t = 20 * 60 + 30 + min; return ('0' + Math.floor(t / 60) % 24).slice(-2) + ':' + ('0' + t % 60).slice(-2); }
  var OLD_ = document.documentElement.getAttribute('data-theme') === 'old';
  screens.guide = function (c) {
    var SX = px('--vetro-tv-guide-x'), SY = px('--vetro-tv-guide-y'), SW = px('--vetro-tv-guide-w'), SH = px('--vetro-tv-guide-h'), pad = px('--vetro-tv-guide-pad'),
        AX = px('--vetro-tv-guide-axis-y'), RY = px('--vetro-tv-guide-rows-y'), RH = px('--vetro-tv-guide-row-h'), CH_ = px('--vetro-tv-guide-cell-h'),
        gap = px('--vetro-tv-guide-cell-gap'), LW = px('--vetro-tv-guide-label-w'), ppm = px('--vetro-tv-guide-px-per-min');
    var LX = SX + pad, CX = LX + LW + 14, WIN = 180, CW = WIN * ppm, focusRow = 2, focusCell = 0, now = 22;
    sheet(c, SX, SY, SW, SH).style.background = 'color-mix(in srgb, var(--vetro-tv-sheet) calc(var(--vetro-tv-guide-alpha) * 100%), transparent)';
    var fe = GUIDE[focusRow][2][focusCell];
    text(c, fe[2], LX, SY + 26, px('--vetro-tv-type-title'), '', SW - 2 * pad - 324);
    text(c, clock(fe[0]) + ' – ' + clock(fe[0] + fe[1]) + '   ·   ' + fe[1] + ' min   ·   ' + GUIDE[focusRow][0], LX, SY + 84, px('--vetro-tv-type-meta'), 'muted', SW - 2 * pad);
    var d = text(c, 'The hunter comes to a quiet town, and a family has to decide whom to trust before the night is over.', LX, SY + 128, px('--vetro-tv-type-meta'), 'muted', SW - 2 * pad - 120);
    d.style.whiteSpace = 'normal'; d.style.display = '-webkit-box'; d.style.webkitBoxOrient = 'vertical'; d.style.webkitLineClamp = '2'; d.style.maxHeight = '62px';
    text(c, 'Sat 7 Nov', SX + SW - pad, SY + 32, px('--vetro-tv-type-subtitle'), 'muted', 300, true);
    for (var t = 0; t < WIN; t += 30) text(c, clock(t), CX + t * ppm, AX + 6, px('--vetro-tv-type-label'), 'muted', 120);
    mk(c, 'rule', CX, RY - 4, CW, 2);
    GUIDE.forEach(function (row, r) {
      var y = RY + r * RH, cy = y + (RH - CH_) / 2, fr = r === focusRow;
      text(c, String(row[1]), LX, y + 26, px('--vetro-tv-type-subtitle'), fr ? '' : 'muted', 56);
      text(c, row[0], LX + 68, y + 27, px('--vetro-tv-type-body'), fr ? '' : 'muted', LW - 76);
      row[2].forEach(function (p, i) {
        var s = Math.max(0, p[0]), e = Math.min(WIN, p[0] + p[1]), x = CX + s * ppm + (s === 0 ? 0 : gap / 2), w = (e - s) * ppm - (s === 0 ? 0 : gap / 2) - (e === WIN ? 0 : gap / 2);
        if (w < 4) return;
        var onAir = p[0] <= now && now < p[0] + p[1], isF = fr && i === focusCell;
        fill(c, x, cy, w, CH_, isF ? tok('--vetro-tv-fill-focus') : p[2] === null ? tok('--vetro-tv-fill-empty') : onAir ? tok('--vetro-tv-fill-onair') : tok('--vetro-tv-fill-rest'));
        if (w >= 64) {
          if (p[2] !== null) {
            text(c, p[2], x + 16, cy + (w >= 128 ? 7 : 21), px('--vetro-tv-type-body'), '', w - 32);
            if (w >= 128) text(c, w >= 230 ? clock(p[0]) + ' – ' + clock(p[0] + p[1]) : clock(p[0]), x + 16, cy + (OLD_ ? 42 : 41), px(OLD_ ? '--vetro-tv-type-caption' : '--vetro-tv-type-label'), isF && !OLD_ ? '' : 'muted', w - 32);
          } else if (w >= 150) text(c, 'No information', x + 16, cy + 24, px('--vetro-tv-type-label'), 'muted', w - 32);
        }
        if (isF) ring(c, x, cy, w, CH_);
      });
    });
    var nx = CX + now * ppm;
    mk(c, 'rule', nx - 1, AX + 30, 3, RY - AX - 32, OLD_ ? { '--a': tok('--vetro-tv-progress') } : { background: 'var(--vetro-tv-light)' });
    mk(c, 'rule', nx, RY, 1, 7 * RH - 6, { '--a': '.18' });
    guideFooter(c, LX, SY + SH - (OLD_ ? 50 : 52), px(OLD_ ? '--vetro-tv-type-caption' : '--vetro-tv-type-label'), OLD_ ? 'faint' : 'muted');
  };

  return screens;
}
