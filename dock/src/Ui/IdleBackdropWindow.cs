using System;
using System.Globalization;
using System.Runtime.InteropServices;
using Launcher.Core;
using Launcher.Native;

namespace Launcher.Ui
{
    /// <summary>
    /// Full-screen backdrop covering Samsung's "Aerial Cable: Disconnected" screen when no live
    /// tuner is active. Uses ElmWinNotification (level=10, layer=850) because Tizen 9 blocks
    /// unregistered ElmWinBasic windows, sitting cleanly below tvlauncher/vetro-numpad/vetro-volume.
    /// Relocates along a Halton orbit every 30 s.
    /// </summary>
    internal sealed class IdleBackdropWindow
    {
        private const string FontLight = "SamsungOneUI 200";
        private const string FontDate = "SamsungOneUI 300";
        private const string FontMedium = "SamsungOneUI 500";
        private const int WindowLayer = 850;
        private const double OrbitSeconds = 30.0;
        private const double HintSeconds = 4.0;
        private const double ActiveAnimInterval = 1.0 / 15.0;
        private const double DimAnimInterval = 1.0 / 7.5;
        private const double SwAnimInterval = 2.0;
        private const int ClockW = 280, ClockH = 175;
        private const int LakeTileSize = 128, VignetteSize = 64;
        private const int SilkW = 192, SilkH = 64;
        private const int MoteCrispSize = 16, MoteOrbSize = 24;

        // LayerCache indices: 0=_lakeA, 1=_lakeB, 2=_vignette, 3..5=_silkA..C, 6..15=_motes[0..9]
        private const int CacheLakeA = 0, CacheLakeB = 1, CacheVignette = 2;
        private const int CacheSilkBase = 3, CacheMoteBase = 6, TotalLayerCache = 16;

        private struct LayerCache
        {
            public bool Visible;
            public int X, Y, W, H, Fx, Fy, Fw, Fh, R, G, B, A;
            public void Reset() { Visible = false; X = Y = W = H = Fx = Fy = Fw = Fh = R = G = B = A = int.MinValue; }
        }

        private IdleConfig _cfg;
        private readonly Action<string> _log;
        private readonly int _screenW, _screenH;
        private readonly Efl.TaskCb _orbitCb, _hintCb, _clockCb, _animCb;
        private readonly LayerCache[] _cache = new LayerCache[TotalLayerCache];
        private readonly IntPtr[] _motes = new IntPtr[IdleBackdropModel.AuroraMoteCount];

        private IntPtr _win, _bg, _lakeA, _lakeB, _vignette, _silkA, _silkB, _silkC;
        private IntPtr _primary, _dateDay, _dateSep, _dateNum, _meta, _hint;
        private IntPtr _orbitTimer, _hintTimer, _clockTimer, _animTimer;
        private bool _built, _failed, _shown, _dimmed, _dockOverlay, _displayOff, _softwareEngine;
        private bool _lakeLoaded, _auroraLoaded, _hintShown, _textShown, _lastDimmed, _forceBackdropSync;
        private int _haltonStep = 1, _lastStep = -1, _animTimeMs = 9000, _animFrameCount;
        private int _lastMinute = -1, _lastHour = -1, _lastDay = -1;
        private double _animInterval, _lastAnimTickMono = -1.0, _clockAccumSec, _orbitAccumSec;
        private IdleMode _lastMode = IdleMode.Off;
        private string _lastTime, _lastDate;

        public IdleBackdropWindow(IdleConfig cfg, Action<string> log, int screenW, int screenH)
        {
            _cfg = cfg;
            _log = log;
            _screenW = screenW;
            _screenH = screenH;
            _orbitCb = OnOrbitTick;
            _hintCb = OnHintEnd;
            _clockCb = OnClockTick;
            _animCb = OnAnimTick;
            for (int i = 0; i < _cache.Length; i++) _cache[i].Reset();
        }

        public bool IsShown { get { return _shown; } }
        public Action OnShown;

        /// <summary>
        /// Refreshes the displayed clock/date immediately whenever wall-clock time advances (including after
        /// Tizen STR suspend, where monotonic timers freeze while <see cref="DateTime.Now"/> jumps forward).
        /// Zero Evas redraws when the minute has not changed.
        /// </summary>
        public void SyncClock()
        {
            if (!_shown || _displayOff || !_cfg.ShowsClock) return;
            DateTime now = DateTime.Now;
            if (now.Minute != _lastMinute || now.Hour != _lastHour || now.Day != _lastDay)
            {
                if (!_dockOverlay) _haltonStep++;
                ApplyClockVisuals();
            }
        }

        /// <summary>
        /// Pre-builds and transparently maps the Wayland surface once at startup so the first real Show()
        /// pays zero ~90 ms GL/Wayland surface cost and WmStackController can assign layer 200 ahead of time.
        /// </summary>
        public void Prewarm()
        {
            if (_shown || !Build()) return;
            if (_bg != IntPtr.Zero) Efl.evas_object_hide(_bg);
            HideBackdropObjects();
            Efl.evas_object_show(_win);
            Efl.HideCursor(_win, true);
            Efl.evas_object_hide(_win);
            if (_bg != IntPtr.Zero) Efl.evas_object_show(_bg);
        }

        public void Show(bool dimmed, bool dockOverlay)
        {
            if (!Build()) return;
            _dimmed = dimmed;
            _dockOverlay = dockOverlay;
            _forceBackdropSync = true;
            _lastAnimTickMono = -1.0;
            if (!_shown)
            {
                _shown = true;
                Efl.evas_object_show(_win);
                Efl.HideCursor(_win, true);
                StartHint();
                if (OnShown != null) OnShown();
            }
            Efl.elm_win_raise(_win);
            ApplyVisuals();
            UpdateTimers();
        }

        public void Raise()
        {
            if (_shown && _win != IntPtr.Zero) Efl.elm_win_raise(_win);
        }

        public void Hide()
        {
            StopTimers();
            if (!_shown || _win == IntPtr.Zero) return;
            _shown = false;
            Efl.evas_object_hide(_win);
        }

        public void SetDockOverlay(bool dockOpen)
        {
            if (_dockOverlay == dockOpen) return;
            _dockOverlay = dockOpen;
            if (dockOpen && _hintShown)
            {
                _hintShown = false;
                if (_hintTimer != IntPtr.Zero) { Efl.ecore_timer_del(_hintTimer); _hintTimer = IntPtr.Zero; }
                if (_hint != IntPtr.Zero) Efl.evas_object_hide(_hint);
            }
            if (!_shown) return;
            if (!dockOpen) _lastAnimTickMono = -1.0;
            UpdateTimers();
        }

        public void SetDimmed(bool dimmed)
        {
            if (_dimmed == dimmed) return;
            _dimmed = dimmed;
            _forceBackdropSync = true;
            if (!_shown) return;
            ApplyVisuals();
            UpdateTimers();
        }

        public void SetDisplayOff(bool off)
        {
            if (_displayOff == off) return;
            _displayOff = off;
            if (_shown && !off)
            {
                _forceBackdropSync = true;
                _lastAnimTickMono = -1.0;
                ApplyVisuals();
            }
            UpdateTimers();
        }

        public void Reconfigure(IdleConfig cfg)
        {
            _cfg = cfg ?? _cfg;
            _dimmed = false;
            _forceBackdropSync = true;
            _lastAnimTickMono = -1.0;
            if (!_built) return;
            SyncActiveThemeAssets();
            if (_primary != IntPtr.Zero)
                Efl.evas_object_text_font_set(_primary, _cfg.ShowsClock ? FontLight : FontMedium, _cfg.ShowsClock ? 96 : 26);
            if (_shown)
            {
                ApplyVisuals();
                UpdateTimers();
            }
            _log("idle: reconfigured mode=" + _cfg.Mode + " autoDock=" + _cfg.AutoDock + " potOff=" + _cfg.PictureOffMinutes);
        }

        private void SyncActiveThemeAssets()
        {
            if (!_cfg.UsesLake) ReleaseLakeAssets();
            else EnsureLakeLoaded();

            if (!_cfg.UsesAurora) ReleaseAuroraAssets();
            else EnsureAuroraLoaded();
        }

        private void HideBackdropObjects()
        {
            HideLayer(_lakeA, CacheLakeA);
            HideLayer(_lakeB, CacheLakeB);
            HideLayer(_vignette, CacheVignette);
            HideLayer(_silkA, CacheSilkBase);
            HideLayer(_silkB, CacheSilkBase + 1);
            HideLayer(_silkC, CacheSilkBase + 2);
            for (int i = 0; i < _motes.Length; i++) HideLayer(_motes[i], CacheMoteBase + i);
        }

        private static void UploadArgbPixels(IntPtr img, int w, int h, uint[] pixels, int[] rowScratch)
        {
            if (img == IntPtr.Zero || pixels == null) return;
            Efl.evas_object_image_size_set(img, w, h);
            IntPtr dst = Efl.evas_object_image_data_get(img, true);
            if (dst == IntPtr.Zero) return;
            int stride = Math.Max(w * 4, Efl.evas_object_image_stride_get(img));
            for (int y = 0; y < h; y++)
            {
                Buffer.BlockCopy(pixels, y * w * 4, rowScratch, 0, w * 4);
                Marshal.Copy(rowScratch, 0, IntPtr.Add(dst, y * stride), w);
            }
            Efl.evas_object_image_data_set(img, dst);
            Efl.evas_object_image_data_update_add(img, 0, 0, w, h);
        }

        private static void ReleaseImageBuffer(IntPtr img)
        {
            if (img == IntPtr.Zero) return;
            Efl.evas_object_hide(img);
            Efl.evas_object_image_size_set(img, 0, 0);
        }

        private void EnsureLakeLoaded()
        {
            if (_lakeLoaded || _lakeA == IntPtr.Zero || _lakeB == IntPtr.Zero || _vignette == IntPtr.Zero) return;
            int[] scratch = new int[LakeTileSize];
            UploadArgbPixels(_lakeA, LakeTileSize, LakeTileSize, IdleBackdropModel.BuildLakeTilePixels(LakeTileSize, 64, 128, 225, 3, 2.0, 11), scratch);
            UploadArgbPixels(_lakeB, LakeTileSize, LakeTileSize, IdleBackdropModel.BuildLakeTilePixels(LakeTileSize, 44, 148, 178, 4, 2.2, 131), scratch);
            UploadArgbPixels(_vignette, VignetteSize, VignetteSize, IdleBackdropModel.BuildVignettePixels(VignetteSize), scratch);
            _lakeLoaded = true;
            _forceBackdropSync = true;
        }

        private void ReleaseLakeAssets()
        {
            if (!_lakeLoaded) return;
            ReleaseImageBuffer(_lakeA);
            ReleaseImageBuffer(_lakeB);
            ReleaseImageBuffer(_vignette);
            _cache[CacheLakeA].Reset();
            _cache[CacheLakeB].Reset();
            _cache[CacheVignette].Reset();
            _lakeLoaded = false;
        }

        private void EnsureAuroraLoaded()
        {
            if (_auroraLoaded || _silkA == IntPtr.Zero || _silkB == IntPtr.Zero || _silkC == IntPtr.Zero) return;
            int[] scratch = new int[SilkW];
            UploadArgbPixels(_silkA, SilkW, SilkH, IdleBackdropModel.BuildSilkRibbonPixels(SilkW, SilkH, 79, 148, 255, 1.35, 0.13, 0.4, -0.06), scratch);
            UploadArgbPixels(_silkB, SilkW, SilkH, IdleBackdropModel.BuildSilkRibbonPixels(SilkW, SilkH, 50, 230, 214, 1.65, 0.11, 2.2, 0.08), scratch);
            UploadArgbPixels(_silkC, SilkW, SilkH, IdleBackdropModel.BuildSilkRibbonPixels(SilkW, SilkH, 154, 107, 255, 1.15, 0.14, 4.1, -0.04), scratch);

            uint[] crispPx = IdleBackdropModel.BuildBokehPixels(MoteCrispSize, true);
            uint[] orbPx = IdleBackdropModel.BuildBokehPixels(MoteOrbSize, false);
            for (int i = 0; i < _motes.Length; i++)
            {
                if (_motes[i] == IntPtr.Zero) continue;
                bool crisp = IdleBackdropModel.IsMoteCrisp(i);
                int sz = crisp ? MoteCrispSize : MoteOrbSize;
                UploadArgbPixels(_motes[i], sz, sz, crisp ? crispPx : orbPx, scratch);
            }
            _auroraLoaded = true;
            _forceBackdropSync = true;
        }

        private void ReleaseAuroraAssets()
        {
            if (!_auroraLoaded) return;
            ReleaseImageBuffer(_silkA);
            ReleaseImageBuffer(_silkB);
            ReleaseImageBuffer(_silkC);
            _cache[CacheSilkBase].Reset();
            _cache[CacheSilkBase + 1].Reset();
            _cache[CacheSilkBase + 2].Reset();
            for (int i = 0; i < _motes.Length; i++)
            {
                ReleaseImageBuffer(_motes[i]);
                _cache[CacheMoteBase + i].Reset();
            }
            _auroraLoaded = false;
        }

        private static IntPtr CreateBackdropImage(IntPtr evas, bool filled)
        {
            IntPtr img = Efl.evas_object_image_add(evas);
            Efl.evas_object_image_alpha_set(img, true);
            Efl.evas_object_image_filled_set(img, filled);
            Efl.evas_object_image_smooth_scale_set(img, true);
            Efl.evas_object_image_scale_hint_set(img, Efl.EvasImageScaleHintStatic);
            Efl.evas_object_pass_events_set(img, true);
            return img;
        }

        private bool Build()
        {
            if (_built) return true;
            if (_failed) return false;
            try
            {
                _win = Efl.elm_win_add(IntPtr.Zero, "vetro-idle", Efl.ElmWinNotification);
                if (_win == IntPtr.Zero) { _failed = true; _log("idle: elm_win_add failed"); return false; }
                Efl.elm_win_title_set(_win, "vetro-idle");
                // Keep an alpha-capable surface (matching Dock and Tuner): a full-screen opaque (alpha=false)
                // notification window makes Tizen 9's compositor mark tv-viewer occluded and flip source_type to -1.
                // _bg still paints opaque #000000 (0, 0, 0, 255) over the full screen.
                Efl.elm_win_alpha_set(_win, true);
                Efl.elm_win_borderless_set(_win, true);
                Efl.elm_win_prop_focus_skip_set(_win, true);
                int lvlRc = Efl.efl_util_set_notification_window_level(_win, _cfg.NotificationLevel);
                Efl.elm_win_layer_set(_win, WindowLayer);
                Efl.elm_win_aux_hint_add(_win, "wm.policy.win.user.geometry", "1");
                Efl.elm_win_aux_hint_add(_win, "wm.comp.win.effect.enable", "0");
                Efl.evas_object_move(_win, 0, 0);
                Efl.evas_object_resize(_win, _screenW, _screenH);
                Efl.evas_object_pass_events_set(_win, true);
                Efl.HideCursor(_win, true);

                IntPtr evas = Efl.evas_object_evas_get(_win);
                _softwareEngine = string.Equals(Efl.EngineName(evas), "wayland_shm", StringComparison.OrdinalIgnoreCase);

                _bg = Efl.evas_object_rectangle_add(evas);
                Efl.evas_object_color_set(_bg, 0, 0, 0, 255);
                Efl.evas_object_move(_bg, 0, 0);
                Efl.evas_object_resize(_bg, _screenW, _screenH);
                Efl.evas_object_pass_events_set(_bg, true);
                Efl.evas_object_show(_bg);

                // Allocate empty Evas image handles strictly BEFORE text objects so live mode switching keeps clock above backdrops.
                _lakeA = CreateBackdropImage(evas, false);
                Efl.evas_object_move(_lakeA, 0, 0);
                Efl.evas_object_resize(_lakeA, _screenW, _screenH);
                _lakeB = CreateBackdropImage(evas, false);
                Efl.evas_object_move(_lakeB, 0, 0);
                Efl.evas_object_resize(_lakeB, _screenW, _screenH);
                _vignette = CreateBackdropImage(evas, true);

                _silkA = CreateBackdropImage(evas, true);
                _silkB = CreateBackdropImage(evas, true);
                _silkC = CreateBackdropImage(evas, true);
                for (int i = 0; i < _motes.Length; i++) _motes[i] = CreateBackdropImage(evas, true);

                SyncActiveThemeAssets();

                _primary = Efl.evas_object_text_add(evas);
                Efl.evas_object_text_font_set(_primary, _cfg.ShowsClock ? FontLight : FontMedium, _cfg.ShowsClock ? 96 : 26);
                Efl.evas_object_pass_events_set(_primary, true);

                _dateDay = Efl.evas_object_text_add(evas);
                Efl.evas_object_text_font_set(_dateDay, FontDate, 28);
                Efl.evas_object_pass_events_set(_dateDay, true);

                _dateSep = Efl.evas_object_rectangle_add(evas);
                Efl.evas_object_resize(_dateSep, 1, 15);
                Efl.evas_object_pass_events_set(_dateSep, true);

                _dateNum = Efl.evas_object_text_add(evas);
                Efl.evas_object_text_font_set(_dateNum, FontDate, 28);
                Efl.evas_object_pass_events_set(_dateNum, true);

                _meta = Efl.evas_object_text_add(evas);
                Efl.evas_object_text_font_set(_meta, FontDate, 20);
                Efl.evas_object_text_text_set(_meta, "No antenna \u00B7 TV");
                Efl.evas_object_pass_events_set(_meta, true);

                _hint = Efl.evas_object_text_add(evas);
                Efl.evas_object_text_font_set(_hint, FontMedium, 24);
                Efl.evas_object_text_text_set(_hint, "Press Home for apps");
                Efl.evas_object_pass_events_set(_hint, true);
                SetIceColor(_hint, 110);
                int hw = Efl.evas_object_text_horiz_advance_get(_hint);
                int hh = Efl.evas_object_text_vert_advance_get(_hint);
                Efl.evas_object_move(_hint, _screenW - 96 - (hw > 0 ? hw : 240), _screenH - 96 - (hh > 0 ? hh : 30));

                _built = true;
                _log("idle: built mode=" + _cfg.Mode + " shm=" + _softwareEngine + " level=" + _cfg.NotificationLevel + " rc=" + lvlRc);
                return true;
            }
            catch (Exception ex) { _failed = true; _log("idle: " + ex.Message); return false; }
        }

        private void HideLayer(IntPtr obj, int idx)
        {
            if (obj == IntPtr.Zero || !_cache[idx].Visible) return;
            _cache[idx].Visible = false;
            Efl.evas_object_hide(obj);
        }

        private void ApplyTiledColor(IntPtr obj, int idx, int fx, int fy, int fw, int fh, int alpha)
        {
            if (obj == IntPtr.Zero) return;
            if (alpha <= 0) { HideLayer(obj, idx); return; }
            ref LayerCache c = ref _cache[idx];
            if (c.Fx != fx || c.Fy != fy || c.Fw != fw || c.Fh != fh)
            {
                c.Fx = fx; c.Fy = fy; c.Fw = fw; c.Fh = fh;
                Efl.evas_object_image_fill_set(obj, fx, fy, fw, fh);
            }
            if (c.R != alpha || c.G != alpha || c.B != alpha || c.A != alpha)
            {
                c.R = c.G = c.B = c.A = alpha;
                Efl.evas_object_color_set(obj, alpha, alpha, alpha, alpha);
            }
            if (!c.Visible) { c.Visible = true; Efl.evas_object_show(obj); }
        }

        private void ApplyMoveResizeColor(IntPtr obj, int idx, int x, int y, int w, int h, int r, int g, int b, int a)
        {
            if (obj == IntPtr.Zero) return;
            if (a <= 0) { HideLayer(obj, idx); return; }
            ref LayerCache c = ref _cache[idx];
            if (c.X != x || c.Y != y)
            {
                c.X = x; c.Y = y;
                Efl.evas_object_move(obj, x, y);
            }
            if (c.W != w || c.H != h)
            {
                c.W = w; c.H = h;
                Efl.evas_object_resize(obj, w, h);
            }
            if (c.R != r || c.G != g || c.B != b || c.A != a)
            {
                c.R = r; c.G = g; c.B = b; c.A = a;
                Efl.evas_object_color_set(obj, r, g, b, a);
            }
            if (!c.Visible) { c.Visible = true; Efl.evas_object_show(obj); }
        }

        private void ApplyBackdropFrame(bool stagger)
        {
            if (!_built) return;
            if (_cfg.UsesLake)
            {
                EnsureLakeLoaded();
                IdleBackdropModel.LakeFrame lf;
                IdleBackdropModel.ComputeLakeFrame(_animTimeMs, _screenW, _screenH, _dimmed, out lf);
                ApplyTiledColor(_lakeA, CacheLakeA, lf.FillAX, lf.FillAY, lf.FillAW, lf.FillAH, lf.AlphaA);
                ApplyTiledColor(_lakeB, CacheLakeB, lf.FillBX, lf.FillBY, lf.FillBW, lf.FillBH, lf.AlphaB);
                if (!stagger || _forceBackdropSync || (_animFrameCount & 7) == 0)
                    ApplyMoveResizeColor(_vignette, CacheVignette, lf.VigX, lf.VigY, lf.VigW, lf.VigH, lf.VigAlpha, lf.VigAlpha, lf.VigAlpha, lf.VigAlpha);
            }
            else if (_cfg.UsesAurora)
            {
                EnsureAuroraLoaded();
                if (!stagger || _forceBackdropSync)
                {
                    for (int i = 0; i < IdleBackdropModel.AuroraRibbonCount; i++) ApplySingleRibbon(i);
                }
                else
                {
                    ApplySingleRibbon(_animFrameCount % IdleBackdropModel.AuroraRibbonCount);
                }

                for (int i = 0; i < IdleBackdropModel.AuroraMoteCount; i++)
                {
                    IdleBackdropModel.MoteFrame mf;
                    IdleBackdropModel.ComputeMoteFrame(i, _animTimeMs, _screenW, _screenH, _dimmed, out mf);
                    if (mf.Alpha <= 0)
                    {
                        HideLayer(_motes[i], CacheMoteBase + i);
                        continue;
                    }
                    int pr = (mf.R * mf.Alpha) / 255;
                    int pg = (mf.G * mf.Alpha) / 255;
                    int pb = (mf.B * mf.Alpha) / 255;
                    ApplyMoveResizeColor(_motes[i], CacheMoteBase + i, mf.X, mf.Y, mf.Size, mf.Size, pr, pg, pb, mf.Alpha);
                }
            }
            else
            {
                HideBackdropObjects();
            }
            _forceBackdropSync = false;
        }

        private void ApplySingleRibbon(int idx)
        {
            IdleBackdropModel.AuroraRibbonFrame rf;
            IdleBackdropModel.ComputeAuroraRibbon(idx, _animTimeMs, _screenW, _screenH, _dimmed, out rf);
            IntPtr obj = idx == 0 ? _silkA : (idx == 1 ? _silkB : _silkC);
            ApplyMoveResizeColor(obj, CacheSilkBase + idx, rf.X, rf.Y, rf.W, rf.H, rf.Alpha, rf.Alpha, rf.Alpha, rf.Alpha);
        }

        private void ApplyVisuals()
        {
            if (!_built) return;
            ApplyBackdropFrame(false);
            ApplyClockVisuals();
        }

        private void ApplyClockVisuals()
        {
            if (!_built) return;
            if (!_cfg.ShowsClock)
            {
                _lastMinute = -1;
                _lastHour = -1;
                _lastDay = -1;
                if (_textShown)
                {
                    _textShown = false;
                    Efl.evas_object_hide(_primary);
                    Efl.evas_object_hide(_dateDay);
                    Efl.evas_object_hide(_dateSep);
                    Efl.evas_object_hide(_dateNum);
                    Efl.evas_object_hide(_meta);
                }
                return;
            }

            DateTime now = DateTime.Now;
            _lastMinute = now.Minute;
            _lastHour = now.Hour;
            _lastDay = now.Day;
            string timeText = now.ToString("HH:mm", CultureInfo.InvariantCulture);
            string dayAbbr, dateStr;
            IdleBackdropModel.FormatDate(now, out dayAbbr, out dateStr);
            if (_textShown && _lastStep == _haltonStep && _lastMode == _cfg.Mode && _lastDimmed == _dimmed
                && _lastTime == timeText && _lastDate == dateStr)
                return;

            _textShown = true;
            _lastStep = _haltonStep;
            _lastMode = _cfg.Mode;
            _lastDimmed = _dimmed;
            _lastTime = timeText;
            _lastDate = dateStr;

            bool isClock = _cfg.Mode == IdleMode.Clock;
            Efl.evas_object_text_text_set(_primary, timeText);
            SetIceColor(_primary, isClock ? (_dimmed ? 82 : 97) : (_dimmed ? 108 : 128));
            int clockW = Efl.evas_object_text_horiz_advance_get(_primary);
            if (clockW <= 0) clockW = 240;
            int clockH = Efl.evas_object_text_vert_advance_get(_primary);
            if (clockH <= 0) clockH = 112;
            int x, y;
            IdleBackdropModel.HaltonPosition(_haltonStep, _screenW, _screenH, Math.Max(ClockW, clockW), ClockH, out x, out y);
            Efl.evas_object_move(_primary, x, y);
            Efl.evas_object_show(_primary);

            Efl.evas_object_text_text_set(_dateDay, dayAbbr);
            Efl.evas_object_text_text_set(_dateNum, dateStr);
            int dayW = Efl.evas_object_text_horiz_advance_get(_dateDay);
            int numW = Efl.evas_object_text_horiz_advance_get(_dateNum);
            int dateH = Efl.evas_object_text_vert_advance_get(_dateNum);
            if (dayW <= 0) dayW = 58;
            if (numW <= 0) numW = 104;
            if (dateH <= 0) dateH = 34;

            int dateY = y + (clockH * 82) / 100;
            SetIceColor(_dateDay, isClock ? (_dimmed ? 46 : 56) : (_dimmed ? 62 : 74));
            SetIceColor(_dateNum, isClock ? (_dimmed ? 56 : 68) : (_dimmed ? 76 : 90));
            SetIceColor(_dateSep, isClock ? (_dimmed ? 20 : 24) : (_dimmed ? 26 : 30));

            int inkW = Math.Max(160, clockW - 16);
            int gap = (inkW - dayW - numW - 1) / 2;
            if (gap < 12) gap = 12;
            if (gap > 22) gap = 22;
            int totalW = dayW + gap + 1 + gap + numW;
            int startX = x + (clockW - totalW) / 2;
            int sepX = startX + dayW + gap;
            int numX = sepX + 1 + gap;
            int sepH = Math.Max(13, (dateH * 48) / 100);
            int sepY = dateY + (dateH * 28) / 100;

            Efl.evas_object_move(_dateDay, startX, dateY);
            Efl.evas_object_move(_dateSep, sepX, sepY);
            Efl.evas_object_resize(_dateSep, 1, sepH);
            Efl.evas_object_move(_dateNum, numX, dateY);
            Efl.evas_object_show(_dateDay);
            Efl.evas_object_show(_dateSep);
            Efl.evas_object_show(_dateNum);

            if (isClock)
            {
                int metaW = Efl.evas_object_text_horiz_advance_get(_meta);
                if (metaW <= 0) metaW = 140;
                SetIceColor(_meta, _dimmed ? 40 : 48);
                Efl.evas_object_move(_meta, x + (clockW - metaW) / 2, dateY + dateH + 8);
                Efl.evas_object_show(_meta);
            }
            else
            {
                Efl.evas_object_hide(_meta);
            }
        }

        private void UpdateTimers()
        {
            if (!_shown || _displayOff)
            {
                if (_orbitTimer != IntPtr.Zero) { Efl.ecore_timer_del(_orbitTimer); _orbitTimer = IntPtr.Zero; }
                if (_clockTimer != IntPtr.Zero) { Efl.ecore_timer_del(_clockTimer); _clockTimer = IntPtr.Zero; }
                if (_animTimer != IntPtr.Zero) { Efl.ecore_timer_del(_animTimer); _animTimer = IntPtr.Zero; }
                _animInterval = 0;
                return;
            }

            if (_dockOverlay)
            {
                if (_orbitTimer != IntPtr.Zero) { Efl.ecore_timer_del(_orbitTimer); _orbitTimer = IntPtr.Zero; }
                if (_animTimer != IntPtr.Zero) { Efl.ecore_timer_del(_animTimer); _animTimer = IntPtr.Zero; _animInterval = 0; }
            }
            else if (_cfg.UsesWallpaper)
            {
                if (_orbitTimer != IntPtr.Zero) { Efl.ecore_timer_del(_orbitTimer); _orbitTimer = IntPtr.Zero; }
                double targetInterval = _softwareEngine ? SwAnimInterval : (_dimmed ? DimAnimInterval : ActiveAnimInterval);
                if (_animTimer == IntPtr.Zero || Math.Abs(_animInterval - targetInterval) > 0.001)
                {
                    if (_animTimer != IntPtr.Zero) Efl.ecore_timer_del(_animTimer);
                    _animInterval = targetInterval;
                    _lastAnimTickMono = -1.0;
                    _animTimer = Efl.ecore_timer_add(targetInterval, _animCb, IntPtr.Zero);
                }
            }
            else
            {
                if (_animTimer != IntPtr.Zero) { Efl.ecore_timer_del(_animTimer); _animTimer = IntPtr.Zero; _animInterval = 0; }
                if (_cfg.ShowsClock)
                {
                    if (_orbitTimer == IntPtr.Zero) _orbitTimer = Efl.ecore_timer_add(OrbitSeconds, _orbitCb, IntPtr.Zero);
                }
                else if (_orbitTimer != IntPtr.Zero)
                {
                    Efl.ecore_timer_del(_orbitTimer);
                    _orbitTimer = IntPtr.Zero;
                }
            }

            // Coalesce 1s clock updates into _animTimer when active; otherwise keep _clockTimer for Clock mode or Dock-over-idle.
            if (_cfg.ShowsClock && _animTimer == IntPtr.Zero)
            {
                if (_clockTimer == IntPtr.Zero) _clockTimer = Efl.ecore_timer_add(1.0, _clockCb, IntPtr.Zero);
            }
            else if (_clockTimer != IntPtr.Zero)
            {
                Efl.ecore_timer_del(_clockTimer);
                _clockTimer = IntPtr.Zero;
            }
        }

        private void StartHint()
        {
            if (_hintTimer != IntPtr.Zero) { Efl.ecore_timer_del(_hintTimer); _hintTimer = IntPtr.Zero; }
            if (!_dockOverlay && _hint != IntPtr.Zero)
            {
                _hintShown = true;
                Efl.evas_object_show(_hint);
                _hintTimer = Efl.ecore_timer_add(HintSeconds, _hintCb, IntPtr.Zero);
            }
        }

        private void StopTimers()
        {
            if (_orbitTimer != IntPtr.Zero) { Efl.ecore_timer_del(_orbitTimer); _orbitTimer = IntPtr.Zero; }
            if (_clockTimer != IntPtr.Zero) { Efl.ecore_timer_del(_clockTimer); _clockTimer = IntPtr.Zero; }
            if (_animTimer != IntPtr.Zero) { Efl.ecore_timer_del(_animTimer); _animTimer = IntPtr.Zero; _animInterval = 0; }
            if (_hintTimer != IntPtr.Zero) { Efl.ecore_timer_del(_hintTimer); _hintTimer = IntPtr.Zero; }
            if (_hintShown && _hint != IntPtr.Zero) Efl.evas_object_hide(_hint);
            _hintShown = false;
        }

        private byte OnClockTick(IntPtr data)
        {
            try { SyncClock(); }
            catch (Exception ex) { _log("idle clock: " + ex.Message); }
            return 1;
        }

        private byte OnAnimTick(IntPtr data)
        {
            try
            {
                double now = Efl.ecore_time_get();
                double dt = _lastAnimTickMono < 0.0 ? _animInterval : now - _lastAnimTickMono;
                _lastAnimTickMono = now;
                if (dt < 0.0) dt = _animInterval;
                if (dt > 0.25 && !_softwareEngine) dt = 0.25;
                if (dt > 2.5 && _softwareEngine) dt = 2.5;

                int advMs = (int)(dt * (_dimmed ? 500.0 : 1000.0));
                if (advMs < 1) advMs = 1;
                _animTimeMs += advMs;
                _animFrameCount++;

                ApplyBackdropFrame(true);

                if (_cfg.ShowsClock)
                {
                    _clockAccumSec += dt;
                    _orbitAccumSec += dt;
                    bool checkClock = _clockAccumSec >= 1.0;
                    if (checkClock) _clockAccumSec %= 1.0;
                    if (_orbitAccumSec >= OrbitSeconds)
                    {
                        _orbitAccumSec %= OrbitSeconds;
                        _haltonStep++;
                        checkClock = true;
                    }
                    if (checkClock) ApplyClockVisuals();
                }
            }
            catch (Exception ex) { _log("idle anim: " + ex.Message); }
            return 1;
        }

        private byte OnOrbitTick(IntPtr data)
        {
            try
            {
                _haltonStep++;
                ApplyClockVisuals();
            }
            catch (Exception ex) { _log("idle orbit: " + ex.Message); }
            return 1;
        }

        private byte OnHintEnd(IntPtr data)
        {
            _hintTimer = IntPtr.Zero;
            _hintShown = false;
            try { if (_hint != IntPtr.Zero) Efl.evas_object_hide(_hint); } catch (Exception) { }
            return 0;
        }

        private static void SetIceColor(IntPtr obj, int alpha)
        {
            // EFL uses premultiplied ARGB; Ice is #E4F2FF (228, 242, 255).
            int r = (228 * alpha) / 255;
            int g = (242 * alpha) / 255;
            Efl.evas_object_color_set(obj, r, g, alpha, alpha);
        }
    }
}
