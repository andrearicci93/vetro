using System;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using Launcher.Core;
using Launcher.Native;

namespace Launcher.Ui
{
    /// <summary>
    /// Full-screen opaque backdrop covering Samsung's "Aerial Cable: Disconnected" screen when no live
    /// tuner is active. Uses ElmWinNotification (level=40 -> Layer 250, layer=850) at fixed (0, 0) 1920x1080
    /// geometry with alpha=false and a pure #000000 base rectangle so Enlightenment occlusion-culls tv-viewer
    /// underneath and QD-OLED pixels outside the wandering animation zone stay completely off (0% burn-in risk).
    /// </summary>
    internal sealed class IdleBackdropWindow
    {
        private const string FontLight = "SamsungOneUI 200";
        private const string FontDate = "SamsungOneUI 300";
        private const string FontMedium = "SamsungOneUI 500";
        private const int WindowLayer = 850;
        private const double OrbitSeconds = 30.0;
        private const double HintSeconds = 4.0;
        private const double SwAnimInterval = 2.0;
        private const int ClockW = 280, ClockH = 175;
        private const int SilkW = 192, SilkH = 64;
        private const int SilkTexW = 192, SilkTexH = 64, SilkPad = 2;
        private const int MoteCrispSize = 16, MoteOrbSize = 24;
        private const int MoteCrispTex = 16, MoteOrbTex = 24, MotePad = 2;
        private const int PerfWindowFrames = 300;

        // LayerCache indices:
        // 0=_waveSwell, 1=_waveRipple, 2=_waveMask,
        // 3..5=_silkA..C, 6..15=_motes[0..9]
        private const int CacheWaveSwell = 0;
        private const int CacheWaveRipple = 1;
        private const int CacheWaveMask = 2;
        private const int CacheSilkBase = 3;
        private const int CacheMoteBase = 6;
        private const int TotalLayerCache = 16;

        private struct LayerCache
        {
            public bool Visible, MapEnabled;
            public int X, Y, W, H, Fx, Fy, Fw, Fh, R, G, B, A, TopV, BotV, TexW, TexH, Val;
            public double U0, V0, U1, V1, FxD, FyD, FwD, FhD;
            public void Reset()
            {
                Visible = false;
                MapEnabled = false;
                X = Y = W = H = Fx = Fy = Fw = Fh = R = G = B = A = TopV = BotV = TexW = TexH = Val = int.MinValue;
                U0 = V0 = U1 = V1 = FxD = FyD = FwD = FhD = double.NaN;
            }
        }

        private IdleConfig _cfg;
        private readonly Action<string> _log;
        private readonly int _screenW, _screenH;
        private readonly bool _perf;
        private readonly int _envStride;
        private int _scalePreset;
        private readonly AnimClock _animClock = new AnimClock(1.0 / 50.0, 0.05);
        private readonly Efl.TaskCb _orbitCb, _hintCb, _clockCb, _animCb;
        private readonly Efl.EvasCb _keyDownCb, _keyUpCb;
        private readonly LayerCache[] _cache = new LayerCache[TotalLayerCache];
        private readonly IntPtr[] _motes = new IntPtr[IdleBackdropModel.AuroraMoteCount];

        private IntPtr _win, _bg;
        private IntPtr _lakeClip, _waveSwell, _waveRipple, _waveMask;
        private int _clipX = int.MinValue, _clipY = int.MinValue, _clipW = int.MinValue, _clipH = int.MinValue;
        private bool _clipVisible;
        private IntPtr _silkA, _silkB, _silkC, _map, _opaqueMap;
        private IntPtr _primary, _dateDay, _dateSep, _dateNum, _meta, _hint;
        private IntPtr _orbitTimer, _hintTimer, _clockTimer, _animTimer, _animAnimator;
        private bool _built, _failed, _shown, _mapped, _parkedForScreensaver, _dimmed, _dockOverlay, _screensaverOverlay, _interactiveFocus, _displayOff, _softwareEngine;
        private bool _useSubpixelMap, _mapUnavailable, _threadsPromoted, _bgHidden;
        private bool _lakeLoaded, _auroraLoaded, _hintShown, _textShown, _lastDimmed;
        private int _haltonStep = 1, _lastStep = -1, _animTimeMs = 9000, _vblankStrideCount;
        private double _animTimeMsExact = 9000.0, _pendingStrideDt;
        private int _lastMinute = -1, _lastHour = -1, _lastDay = -1;
        private double _animInterval, _lastAnimTickMono = -1.0, _clockAccumSec, _orbitAccumSec;
        private IdleMode _lastMode = IdleMode.Off;
        private string _lastTime, _lastDate;

        private int _perfCount, _perfIntervalCount, _perfOver30, _perfSkipped;
        private double _perfMinDt = double.MaxValue, _perfMaxDt, _perfSumDt, _perfSumWork, _perfMaxWork;

        public IdleBackdropWindow(IdleConfig cfg, Action<string> log, int screenW, int screenH, bool perf = false)
        {
            _cfg = cfg;
            _log = log;
            _screenW = screenW;
            _screenH = screenH;
            _perf = perf;
            int s;
            _envStride = int.TryParse(Environment.GetEnvironmentVariable("TVLAUNCHER_IDLE_STRIDE"), out s) && s >= 1 && s <= 4 ? s : 0;
            _scalePreset = AmbientLakeEngine.ParseScalePreset(Environment.GetEnvironmentVariable("TVLAUNCHER_IDLE_SCALE"));
            _orbitCb = OnOrbitTick;
            _hintCb = OnHintEnd;
            _clockCb = OnClockTick;
            _animCb = OnAnimTick;
            _keyDownCb = HandleKeyDown;
            _keyUpCb = HandleKeyUp;
            for (int i = 0; i < _cache.Length; i++) _cache[i].Reset();
        }

        public bool IsShown { get { return _shown; } }
        public bool IsParkedForScreensaver { get { return _parkedForScreensaver; } }
        public Action OnShown;
        public Action OnAnimatorStarted;
        public Action OnKeyDown;
        public Action OnKeyUp;

        private void HandleKeyDown(IntPtr data, IntPtr evas, IntPtr obj, IntPtr info)
        {
            if (OnKeyDown != null) OnKeyDown();
        }

        private void HandleKeyUp(IntPtr data, IntPtr evas, IntPtr obj, IntPtr info)
        {
            if (OnKeyUp != null) OnKeyUp();
        }

        public void SetScreensaverOverlay(bool active)
        {
            if (_screensaverOverlay == active) return;
            _screensaverOverlay = active;
            if (active && _hintShown)
            {
                _hintShown = false;
                if (_hintTimer != IntPtr.Zero) { Efl.ecore_timer_del(_hintTimer); _hintTimer = IntPtr.Zero; }
                if (_hint != IntPtr.Zero) Efl.evas_object_hide(_hint);
            }
            if (!_shown) return;
            ApplyClockVisuals();
        }

        public void SetInteractiveFocus(bool active)
        {
            if (!_built || _win == IntPtr.Zero || _interactiveFocus == active) return;
            _interactiveFocus = active;
            try
            {
                Efl.elm_win_prop_focus_skip_set(_win, !active);
                Efl.evas_object_pass_events_set(_win, !active);
                if (active) Efl.elm_win_activate(_win);
                Efl.evas_object_focus_set(_win, active);
            }
            catch (Exception) { }
        }

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

        private void SetBgCovered(bool covered)
        {
            if (_bg == IntPtr.Zero || _bgHidden == covered) return;
            _bgHidden = covered;
            if (covered) Efl.evas_object_hide(_bg);
            else Efl.evas_object_show(_bg);
        }

        /// <summary>
        /// Pre-builds the fixed (0, 0) 1920x1080 NotificationLevel=40 (Layer-250) window and theme textures at startup
        /// while keeping the window hidden until Show() commits Frame 0 on Layer 250.
        /// </summary>
        public void Prewarm()
        {
            if (_shown || _mapped || _cfg.Mode == IdleMode.Off || !Build()) return;
            SetBgCovered(false);
            HideBackdropObjects();
            HideAllTextObjects();
            SyncActiveThemeAssets();
            _mapped = false;
            _parkedForScreensaver = false;
        }

        /// <summary>
        /// Pre-builds theme textures (Lake/Aurora) while the backdrop window is hidden (e.g. during a 0.45 s
        /// Back/Exit hold) so the subsequent Show() paints its first opaque frame with zero upload stall.
        /// </summary>
        public void PrewarmAssets()
        {
            if (_shown || _cfg.Mode == IdleMode.Off || !Build()) return;
            SyncActiveThemeAssets();
        }

        public void Show(bool dimmed, bool dockOverlay, bool allowRaise = true)
        {
            if (!Build()) return;
            bool wasParked = _parkedForScreensaver;
            _parkedForScreensaver = false;
            _dimmed = dimmed;
            _dockOverlay = dockOverlay;
            if (_animAnimator == IntPtr.Zero && _animTimer == IntPtr.Zero)
            {
                _lastAnimTickMono = -1.0;
                _animClock.Pause();
            }
            if (!_shown)
            {
                _shown = true;
                ResetPerfWindow();
                if (_bg != IntPtr.Zero)
                {
                    _bgHidden = false;
                    Efl.evas_object_color_set(_bg, 0, 0, 0, 255);
                    Efl.evas_object_move(_bg, 0, 0);
                    Efl.evas_object_resize(_bg, _screenW, _screenH);
                    Efl.evas_object_show(_bg);
                }
                ApplyVisuals();
                if (!_mapped)
                {
                    Efl.efl_util_set_notification_window_level(_win, _cfg.NotificationLevel);
                    _mapped = true;
                    Efl.evas_object_show(_win);
                }
                if (allowRaise && !dockOverlay) Efl.elm_win_raise(_win);
                Efl.HideCursor(_win, true);
                if (!wasParked) StartHint();
                if (OnShown != null) OnShown();
            }
            else
            {
                if (allowRaise && !dockOverlay) Efl.elm_win_raise(_win);
                ApplyVisuals();
            }
            UpdateTimers();
        }

        public void Raise()
        {
            if (_shown && _win != IntPtr.Zero) Efl.elm_win_raise(_win);
        }

        /// <summary>
        /// Stops all animators/timers and hides every visual object except the static #000000 base rectangle
        /// WITHOUT unmapping the Wayland surface. Keeping opaque vetro-idle mapped prevents Enlightenment's
        /// e-mod-tizen-screensaver from seeing tv-viewer become visible in the background and terminating
        /// Samsung's OLED screensaver (spotlight-ss / glscreensaver) while dropping Vetro's idle CPU to 0%.
        /// </summary>
        public void ParkForScreensaver()
        {
            StopTimers();
            ResetPerfWindow();
            _animClock.Pause();
            if (_bg != IntPtr.Zero)
            {
                _bgHidden = false;
                Efl.evas_object_color_set(_bg, 0, 0, 0, 255);
                Efl.evas_object_move(_bg, 0, 0);
                Efl.evas_object_resize(_bg, _screenW, _screenH);
                Efl.evas_object_show(_bg);
            }
            HideBackdropObjects();
            HideAllTextObjects();
            if (!_mapped || _win == IntPtr.Zero)
            {
                _shown = false;
                _parkedForScreensaver = false;
                return;
            }
            _shown = false;
            _parkedForScreensaver = true;
        }

        public void Hide(bool releaseAssets = false)
        {
            StopTimers();
            ResetPerfWindow();
            _animClock.Pause();
            SetBgCovered(false);
            HideBackdropObjects();
            HideAllTextObjects();
            if (releaseAssets || _cfg.Mode == IdleMode.Off)
            {
                ReleaseLakeAssets();
                ReleaseAuroraAssets();
            }
            _shown = false;
            _parkedForScreensaver = false;
            if (!_mapped || _win == IntPtr.Zero) return;
            _mapped = false;
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
            if (!dockOpen) Efl.HideCursor(_win, true);
            UpdateTimers();
        }

        public void SetDimmed(bool dimmed)
        {
            if (_dimmed == dimmed) return;
            _dimmed = dimmed;
            if (!_shown) return;
            ApplyVisuals();
            UpdateTimers();
        }

        public void SetDisplayOff(bool off)
        {
            if (_displayOff == off) return;
            _displayOff = off;
            if (off)
            {
                ResetPerfWindow();
                _animClock.Pause();
            }
            if (_shown && !off)
            {
                _lastAnimTickMono = -1.0;
                _animClock.Pause();
                ApplyVisuals();
            }
            UpdateTimers();
        }

        public void Reconfigure(IdleConfig cfg)
        {
            _cfg = cfg ?? _cfg;
            _dimmed = false;
            _animClock.Pause();
            if (_animAnimator == IntPtr.Zero && _animTimer == IntPtr.Zero)
                _lastAnimTickMono = -1.0;
            ResetPerfWindow();
            if (!_built) return;
            if (_cfg.Mode == IdleMode.Off)
            {
                Hide(true);
                _log("idle: reconfigured mode=Off autoDock=" + _cfg.AutoDock + " potOff=" + _cfg.PictureOffMinutes + " noScreensaver=" + _cfg.SuppressScreensaver);
                return;
            }
            if (!_parkedForScreensaver)
                Efl.efl_util_set_notification_window_level(_win, _cfg.NotificationLevel);
            if (!_cfg.UsesLake) ReleaseLakeAssets();
            if (!_cfg.UsesAurora) ReleaseAuroraAssets();
            if (_primary != IntPtr.Zero)
                Efl.evas_object_text_font_set(_primary, _cfg.ShowsClock ? FontLight : FontMedium, _cfg.ShowsClock ? 96 : 26);
            if (_shown)
            {
                SyncActiveThemeAssets();
                ApplyVisuals();
                UpdateTimers();
            }
            else if (!_parkedForScreensaver)
            {
                SyncActiveThemeAssets();
            }
            _log("idle: reconfigured mode=" + _cfg.Mode + " autoDock=" + _cfg.AutoDock + " potOff=" + _cfg.PictureOffMinutes + " noScreensaver=" + _cfg.SuppressScreensaver);
        }

        private void SyncActiveThemeAssets()
        {
            if (!_cfg.UsesLake) ReleaseLakeAssets();
            else EnsureLakeLoaded();

            if (!_cfg.UsesAurora) ReleaseAuroraAssets();
            else EnsureAuroraLoaded();
        }

        private void HideLakeClip()
        {
            if (_lakeClip == IntPtr.Zero || !_clipVisible) return;
            _clipVisible = false;
            _clipX = _clipY = _clipW = _clipH = int.MinValue;
            Efl.evas_object_hide(_lakeClip);
        }

        private void HideBackdropObjects()
        {
            SetBgCovered(false);
            HideLakeClip();
            HideLayer(_waveSwell, CacheWaveSwell);
            HideLayer(_waveRipple, CacheWaveRipple);
            HideLayer(_waveMask, CacheWaveMask);
            HideLayer(_silkA, CacheSilkBase);
            HideLayer(_silkB, CacheSilkBase + 1);
            HideLayer(_silkC, CacheSilkBase + 2);
            for (int i = 0; i < _motes.Length; i++) HideLayer(_motes[i], CacheMoteBase + i);
        }

        private void HideAllTextObjects()
        {
            _lastMinute = -1;
            _lastHour = -1;
            _lastDay = -1;
            if (_textShown)
            {
                _textShown = false;
                if (_primary != IntPtr.Zero) Efl.evas_object_hide(_primary);
                if (_dateDay != IntPtr.Zero) Efl.evas_object_hide(_dateDay);
                if (_dateSep != IntPtr.Zero) Efl.evas_object_hide(_dateSep);
                if (_dateNum != IntPtr.Zero) Efl.evas_object_hide(_dateNum);
                if (_meta != IntPtr.Zero) Efl.evas_object_hide(_meta);
            }
            if (_hintShown)
            {
                _hintShown = false;
                if (_hint != IntPtr.Zero) Efl.evas_object_hide(_hint);
            }
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

        private static void UploadTiledRectArgbPixels(IntPtr img, int tileW, int tileH, int repeatX, int repeatY, uint[] tile, int[] rowScratch)
        {
            if (img == IntPtr.Zero || tile == null || tileW <= 0 || tileH <= 0 || repeatX <= 0 || repeatY <= 0) return;
            int outW = tileW * repeatX;
            int outH = tileH * repeatY;
            Efl.evas_object_image_size_set(img, outW, outH);
            IntPtr dst = Efl.evas_object_image_data_get(img, true);
            if (dst == IntPtr.Zero) return;
            int stride = Math.Max(outW * 4, Efl.evas_object_image_stride_get(img));
            int rowBytes = tileW * 4;
            for (int y = 0; y < tileH; y++)
            {
                int srcOff = y * rowBytes;
                for (int rx = 0; rx < repeatX; rx++)
                    Buffer.BlockCopy(tile, srcOff, rowScratch, rx * rowBytes, rowBytes);
                for (int ry = 0; ry < repeatY; ry++)
                    Marshal.Copy(rowScratch, 0, IntPtr.Add(dst, (ry * tileH + y) * stride), outW);
            }
            Efl.evas_object_image_data_set(img, dst);
            Efl.evas_object_image_data_update_add(img, 0, 0, outW, outH);
        }

        private static void UploadPaddedArgbPixels(IntPtr img, int innerW, int innerH, int pad, uint[] inner, int[] rowScratch)
        {
            UploadPaddedArgbPixelsWithFill(img, innerW, innerH, pad, inner, rowScratch, 0);
        }

        private static void UploadOpaqueBlackPaddedArgbPixels(IntPtr img, int innerW, int innerH, int pad, uint[] inner, int[] rowScratch)
        {
            UploadPaddedArgbPixelsWithFill(img, innerW, innerH, pad, inner, rowScratch, unchecked((int)0xFF000000u));
        }

        private static void UploadPaddedArgbPixelsWithFill(IntPtr img, int innerW, int innerH, int pad, uint[] inner, int[] rowScratch, int padFillArgb)
        {
            if (img == IntPtr.Zero || inner == null || innerW <= 0 || innerH <= 0) return;
            int outW = innerW + pad * 2;
            int outH = innerH + pad * 2;
            Efl.evas_object_image_size_set(img, outW, outH);
            IntPtr dst = Efl.evas_object_image_data_get(img, true);
            if (dst == IntPtr.Zero) return;
            int stride = Math.Max(outW * 4, Efl.evas_object_image_stride_get(img));
            int rowBytes = innerW * 4;
            if (padFillArgb == 0) Array.Clear(rowScratch, 0, outW);
            else for (int x = 0; x < outW; x++) rowScratch[x] = padFillArgb;
            for (int y = 0; y < pad; y++)
            {
                Marshal.Copy(rowScratch, 0, IntPtr.Add(dst, y * stride), outW);
                Marshal.Copy(rowScratch, 0, IntPtr.Add(dst, (pad + innerH + y) * stride), outW);
            }
            for (int y = 0; y < innerH; y++)
            {
                Buffer.BlockCopy(inner, y * rowBytes, rowScratch, pad * 4, rowBytes);
                Marshal.Copy(rowScratch, 0, IntPtr.Add(dst, (pad + y) * stride), outW);
            }
            Efl.evas_object_image_data_set(img, dst);
            Efl.evas_object_image_data_update_add(img, 0, 0, outW, outH);
        }

        private void ReleaseImageBuffer(IntPtr img)
        {
            if (img == IntPtr.Zero) return;
            if (_useSubpixelMap)
            {
                try
                {
                    Efl.evas_object_map_enable_set(img, false);
                    Efl.evas_object_map_set(img, IntPtr.Zero);
                }
                catch (Exception) { }
            }
            Efl.evas_object_hide(img);
            try { Efl.evas_object_image_data_set(img, IntPtr.Zero); } catch (Exception) { }
            Efl.evas_object_image_size_set(img, 0, 0);
        }

        private static IntPtr CreateConfiguredMap(bool alpha)
        {
            IntPtr m = Efl.evas_map_new(4);
            if (m == IntPtr.Zero) return IntPtr.Zero;
            Efl.evas_map_smooth_set(m, true);
            Efl.evas_map_alpha_set(m, alpha);
            for (int i = 0; i < 4; i++)
            {
                Efl.evas_map_point_color_set(m, i, 255, 255, 255, 255);
                Efl.evas_map_point_coord_set(m, i, 0, 0, 0);
                Efl.evas_map_point_image_uv_set(m, i, 0.0, 0.0);
            }
            return m;
        }

        private bool InitSubpixelMap()
        {
            if (_softwareEngine || _mapUnavailable) return false;
            if (_map != IntPtr.Zero) return true;
            try
            {
                IntPtr m = CreateConfiguredMap(true);
                if (m == IntPtr.Zero) { _mapUnavailable = true; return false; }
                try
                {
                    Efl.evas_map_util_zoom(m, 1.0, 1.0, 0, 0);
                }
                catch (Exception)
                {
                    try { Efl.evas_map_free(m); } catch (Exception) { }
                    throw;
                }
                IntPtr om = CreateConfiguredMap(false);
                if (om == IntPtr.Zero) om = m;
                _map = m;
                _opaqueMap = om;
                return true;
            }
            catch (Exception ex)
            {
                _mapUnavailable = true;
                _log("idle: subpixel map unavailable (" + ex.Message + "), using integer fallback");
                return false;
            }
        }

        private void EnsureLakeLoaded()
        {
            if (_lakeLoaded || _waveSwell == IntPtr.Zero || _waveRipple == IntPtr.Zero || _waveMask == IntPtr.Zero)
                return;

            int maxRow = Math.Max(
                AmbientLakeEngine.SwellTileW * AmbientLakeEngine.SwellRepeatX,
                AmbientLakeEngine.RippleTileW * AmbientLakeEngine.RippleRepeatX);
            maxRow = Math.Max(maxRow, AmbientLakeEngine.MaskTexW + AmbientLakeEngine.MaskPad * 2);
            int[] scratch = new int[maxRow];

            // 1. Opaque deep midnight water body + rolling sapphire swells
            uint[] swellTile = AmbientLakeEngine.BuildOpaqueSwellTilePixels();
            // 2. Translucent moonlit aqua-silver surface wavelets
            uint[] rippleTile = AmbientLakeEngine.BuildRippleTilePixels();

            Efl.evas_object_image_alpha_set(_waveSwell, false);
            Efl.evas_object_image_alpha_set(_waveRipple, true);
            if (_useSubpixelMap)
            {
                if (_lakeClip != IntPtr.Zero)
                {
                    Efl.evas_object_clip_set(_waveSwell, _lakeClip);
                    Efl.evas_object_clip_set(_waveRipple, _lakeClip);
                }
                Efl.evas_object_image_filled_set(_waveSwell, true);
                Efl.evas_object_image_filled_set(_waveRipple, true);
                UploadTiledRectArgbPixels(_waveSwell,
                    AmbientLakeEngine.SwellTileW, AmbientLakeEngine.SwellTileH,
                    AmbientLakeEngine.SwellRepeatX, AmbientLakeEngine.SwellRepeatY,
                    swellTile, scratch);
                UploadTiledRectArgbPixels(_waveRipple,
                    AmbientLakeEngine.RippleTileW, AmbientLakeEngine.RippleTileH,
                    AmbientLakeEngine.RippleRepeatX, AmbientLakeEngine.RippleRepeatY,
                    rippleTile, scratch);
            }
            else
            {
                Efl.evas_object_image_filled_set(_waveSwell, false);
                Efl.evas_object_image_filled_set(_waveRipple, false);
                UploadArgbPixels(_waveSwell, AmbientLakeEngine.SwellTileW, AmbientLakeEngine.SwellTileH, swellTile, scratch);
                UploadArgbPixels(_waveRipple, AmbientLakeEngine.RippleTileW, AmbientLakeEngine.RippleTileH, rippleTile, scratch);
            }

            // 3. Pure-#000000 perspective-elliptical feather mask matching _bg (#000000) everywhere on screen
            uint[] maskPx = AmbientLakeEngine.BuildPureBlackPortalMaskPixels();
            Efl.evas_object_image_alpha_set(_waveMask, true);
            Efl.evas_object_image_filled_set(_waveMask, true);
            if (_useSubpixelMap)
                UploadOpaqueBlackPaddedArgbPixels(_waveMask, AmbientLakeEngine.MaskTexW, AmbientLakeEngine.MaskTexH, AmbientLakeEngine.MaskPad, maskPx, scratch);
            else
                UploadArgbPixels(_waveMask, AmbientLakeEngine.MaskTexW, AmbientLakeEngine.MaskTexH, maskPx, scratch);

            _lakeLoaded = true;
        }

        private void ReleaseLakeAssets()
        {
            if (!_lakeLoaded) return;
            SetBgCovered(false);
            HideLakeClip();
            ReleaseImageBuffer(_waveSwell);
            ReleaseImageBuffer(_waveRipple);
            ReleaseImageBuffer(_waveMask);
            _cache[CacheWaveSwell].Reset();
            _cache[CacheWaveRipple].Reset();
            _cache[CacheWaveMask].Reset();
            _lakeLoaded = false;
        }

        private void EnsureAuroraLoaded()
        {
            if (_auroraLoaded || _silkA == IntPtr.Zero || _silkB == IntPtr.Zero || _silkC == IntPtr.Zero) return;
            if (_useSubpixelMap)
            {
                int texW = SilkTexW + SilkPad * 2;
                int orbTexW = MoteOrbTex + MotePad * 2;
                int[] scratch = new int[Math.Max(texW, orbTexW)];

                UploadPaddedArgbPixels(_silkA, SilkTexW, SilkTexH, SilkPad, AmbientLakeEngine.BuildAuroraSilkRibbonPixels(SilkTexW, SilkTexH, 79, 148, 255, 1.35, 0.13, 0.4, -0.06), scratch);
                UploadPaddedArgbPixels(_silkB, SilkTexW, SilkTexH, SilkPad, AmbientLakeEngine.BuildAuroraSilkRibbonPixels(SilkTexW, SilkTexH, 50, 230, 214, 1.65, 0.11, 2.2, 0.08), scratch);
                UploadPaddedArgbPixels(_silkC, SilkTexW, SilkTexH, SilkPad, AmbientLakeEngine.BuildAuroraSilkRibbonPixels(SilkTexW, SilkTexH, 154, 107, 255, 1.15, 0.14, 4.1, -0.04), scratch);

                uint[] crispPx = IdleBackdropModel.BuildBokehPixels(MoteCrispTex, true);
                uint[] orbPx = IdleBackdropModel.BuildBokehPixels(MoteOrbTex, false);
                for (int i = 0; i < AmbientLakeEngine.AuroraActiveMoteCount && i < _motes.Length; i++)
                {
                    if (_motes[i] == IntPtr.Zero) continue;
                    bool crisp = AmbientLakeEngine.IsAuroraMoteCrisp(i);
                    UploadPaddedArgbPixels(_motes[i], crisp ? MoteCrispTex : MoteOrbTex, crisp ? MoteCrispTex : MoteOrbTex, MotePad, crisp ? crispPx : orbPx, scratch);
                }
            }
            else
            {
                int[] scratch = new int[SilkW];
                UploadArgbPixels(_silkA, SilkW, SilkH, AmbientLakeEngine.BuildAuroraSilkRibbonPixels(SilkW, SilkH, 79, 148, 255, 1.35, 0.13, 0.4, -0.06), scratch);
                UploadArgbPixels(_silkB, SilkW, SilkH, AmbientLakeEngine.BuildAuroraSilkRibbonPixels(SilkW, SilkH, 50, 230, 214, 1.65, 0.11, 2.2, 0.08), scratch);
                UploadArgbPixels(_silkC, SilkW, SilkH, AmbientLakeEngine.BuildAuroraSilkRibbonPixels(SilkW, SilkH, 154, 107, 255, 1.15, 0.14, 4.1, -0.04), scratch);

                uint[] crispPx = IdleBackdropModel.BuildBokehPixels(MoteCrispSize, true);
                uint[] orbPx = IdleBackdropModel.BuildBokehPixels(MoteOrbSize, false);
                for (int i = 0; i < AmbientLakeEngine.AuroraActiveMoteCount && i < _motes.Length; i++)
                {
                    if (_motes[i] == IntPtr.Zero) continue;
                    bool crisp = AmbientLakeEngine.IsAuroraMoteCrisp(i);
                    int sz = crisp ? MoteCrispSize : MoteOrbSize;
                    UploadArgbPixels(_motes[i], sz, sz, crisp ? crispPx : orbPx, scratch);
                }
            }
            _auroraLoaded = true;
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

        private static IntPtr CreateBackdropImage(IntPtr evas, bool filled, bool alpha = true)
        {
            IntPtr img = Efl.evas_object_image_add(evas);
            Efl.evas_object_image_alpha_set(img, alpha);
            Efl.evas_object_image_filled_set(img, filled);
            Efl.evas_object_image_smooth_scale_set(img, true);
            Efl.evas_object_image_scale_hint_set(img, Efl.EvasImageScaleHintStatic);
            Efl.evas_object_pass_events_set(img, true);
            return img;
        }

        private void ResizeLakeLayers(int portalW, int portalH)
        {
            if (_waveSwell != IntPtr.Zero) Efl.evas_object_resize(_waveSwell, portalW, portalH);
            if (_waveRipple != IntPtr.Zero) Efl.evas_object_resize(_waveRipple, portalW, portalH);
            if (_waveMask != IntPtr.Zero) Efl.evas_object_resize(_waveMask, portalW, portalH);
            _cache[CacheWaveSwell].Reset();
            _cache[CacheWaveRipple].Reset();
            _cache[CacheWaveMask].Reset();
        }

        public void SetScalePreset(int scalePreset)
        {
            int next = AmbientLakeEngine.ClampScalePreset(scalePreset);
            if (_scalePreset == next) return;
            _scalePreset = next;
            if (!_built) return;
            int portalW, portalH;
            AmbientLakeEngine.ComputeUnifiedEnvelopeSize(_screenW, _screenH, _scalePreset, out portalW, out portalH);
            ResizeLakeLayers(portalW, portalH);
            if (_shown) ApplyVisuals();
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
                // Opaque window surface (alpha=false) + pure #000000 _bg enables Enlightenment occlusion culling
                // on tv-viewer while keeping all unlit QD-OLED pixels at 0 mA (100% burn-in safe).
                Efl.elm_win_alpha_set(_win, false);
                Efl.elm_win_borderless_set(_win, true);
                Efl.elm_win_prop_focus_skip_set(_win, true);
                int lvlRc = Efl.efl_util_set_notification_window_level(_win, _cfg.NotificationLevel);
                Efl.elm_win_layer_set(_win, WindowLayer);
                Efl.elm_win_aux_hint_add(_win, "wm.policy.win.user.geometry", "1");
                Efl.elm_win_aux_hint_add(_win, "wm.comp.win.effect.enable", "0");
                Efl.evas_object_move(_win, 0, 0);
                Efl.evas_object_resize(_win, _screenW, _screenH);
                Efl.evas_object_pass_events_set(_win, true);
                Efl.evas_object_event_callback_add(_win, Efl.EvasCallbackKeyDown, _keyDownCb, IntPtr.Zero);
                Efl.evas_object_event_callback_add(_win, Efl.EvasCallbackKeyUp, _keyUpCb, IntPtr.Zero);
                Efl.HideCursor(_win, true);

                IntPtr evas = Efl.evas_object_evas_get(_win);
                _softwareEngine = string.Equals(Efl.EngineName(evas), "wayland_shm", StringComparison.OrdinalIgnoreCase);
                try
                {
                    double ft = Efl.ecore_animator_frametime_get();
                    if (ft > 0.0) _animClock.SeedPeriod(ft);
                }
                catch (Exception) { }
                _useSubpixelMap = InitSubpixelMap();

                _bg = Efl.evas_object_rectangle_add(evas);
                Efl.evas_object_color_set(_bg, 0, 0, 0, 255);
                Efl.evas_object_move(_bg, 0, 0);
                Efl.evas_object_resize(_bg, _screenW, _screenH);
                Efl.evas_object_pass_events_set(_bg, true);
                Efl.evas_object_show(_bg);

                int portalW, portalH;
                AmbientLakeEngine.ComputeUnifiedEnvelopeSize(_screenW, _screenH, _scalePreset, out portalW, out portalH);

                // Allocate Evas image handles strictly BEFORE text objects so live mode switching keeps clock above backdrops.
                _lakeClip = Efl.evas_object_rectangle_add(evas);
                Efl.evas_object_color_set(_lakeClip, 255, 255, 255, 255);
                Efl.evas_object_pass_events_set(_lakeClip, true);
                _waveSwell = CreateBackdropImage(evas, _useSubpixelMap, false);
                _waveRipple = CreateBackdropImage(evas, _useSubpixelMap, true);
                _waveMask = CreateBackdropImage(evas, true, true);
                ResizeLakeLayers(portalW, portalH);

                _silkA = CreateBackdropImage(evas, true, true);
                _silkB = CreateBackdropImage(evas, true, true);
                _silkC = CreateBackdropImage(evas, true, true);
                for (int i = 0; i < _motes.Length; i++) _motes[i] = CreateBackdropImage(evas, true, true);

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
                _log("idle: built mode=" + _cfg.Mode + " scale=" + AmbientLakeEngine.ScalePresetName(_scalePreset) + " shm=" + _softwareEngine + " subpixel=" + _useSubpixelMap + " level=" + _cfg.NotificationLevel + " rc=" + lvlRc + " noScreensaver=" + _cfg.SuppressScreensaver);
                return true;
            }
            catch (Exception ex) { _failed = true; _log("idle: " + ex.Message); return false; }
        }

        private void HideLayer(IntPtr obj, int idx)
        {
            if (obj == IntPtr.Zero) return;
            ref LayerCache c = ref _cache[idx];
            if (c.MapEnabled)
            {
                c.MapEnabled = false;
                if (_useSubpixelMap)
                {
                    Efl.evas_object_map_enable_set(obj, false);
                    Efl.evas_object_map_set(obj, IntPtr.Zero);
                }
            }
            if (!c.Visible) return;
            c.Visible = false;
            Efl.evas_object_hide(obj);
        }

        private void ApplyFloatQuadMap(
            IntPtr obj, int idx,
            double fx, double fy, double fw, double fh,
            int texW, int texH,
            int r, int g, int b, int a,
            bool opaque = false)
        {
            if (obj == IntPtr.Zero) return;
            if (a <= 0 || fw <= 0.0 || fh <= 0.0) { HideLayer(obj, idx); return; }
            ref LayerCache c = ref _cache[idx];
            int ix = (int)Math.Floor(fx);
            int iy = (int)Math.Floor(fy);
            int iw = Math.Max(1, (int)Math.Ceiling(fx + fw) - ix);
            int ih = Math.Max(1, (int)Math.Ceiling(fy + fh) - iy);
            if (c.X != ix || c.Y != iy) { c.X = ix; c.Y = iy; Efl.evas_object_move(obj, ix, iy); }
            if (c.W != iw || c.H != ih) { c.W = iw; c.H = ih; Efl.evas_object_resize(obj, iw, ih); }

            bool mapDirty = !c.MapEnabled || c.TexW != texW || c.TexH != texH
                || !(Math.Abs(c.FxD - fx) <= 1e-4) || !(Math.Abs(c.FyD - fy) <= 1e-4)
                || !(Math.Abs(c.FwD - fw) <= 1e-4) || !(Math.Abs(c.FhD - fh) <= 1e-4);
            if (mapDirty)
            {
                c.FxD = fx; c.FyD = fy; c.FwD = fw; c.FhD = fh;
                c.TexW = texW; c.TexH = texH;
                IntPtr mapPtr = (opaque && _opaqueMap != IntPtr.Zero) ? _opaqueMap : _map;
                Efl.evas_map_point_coord_set(mapPtr, 0, 0, 0, 0);
                Efl.evas_map_point_coord_set(mapPtr, 1, IdleBackdropModel.FloatMapBase, 0, 0);
                Efl.evas_map_point_coord_set(mapPtr, 2, IdleBackdropModel.FloatMapBase, IdleBackdropModel.FloatMapBase, 0);
                Efl.evas_map_point_coord_set(mapPtr, 3, 0, IdleBackdropModel.FloatMapBase, 0);
                double z1x, z2x, z1y, z2y;
                IdleBackdropModel.ComputeFloatMapZoomFactors(fx, fw, out z1x, out z2x);
                IdleBackdropModel.ComputeFloatMapZoomFactors(fy, fh, out z1y, out z2y);
                Efl.evas_map_util_zoom(mapPtr, z1x, z1y, 0, 0);
                Efl.evas_map_util_zoom(mapPtr, z2x, z2y, -IdleBackdropModel.FloatMapBase, -IdleBackdropModel.FloatMapBase);
                Efl.evas_map_point_image_uv_set(mapPtr, 0, 0.0, 0.0);
                Efl.evas_map_point_image_uv_set(mapPtr, 1, (double)texW, 0.0);
                Efl.evas_map_point_image_uv_set(mapPtr, 2, (double)texW, (double)texH);
                Efl.evas_map_point_image_uv_set(mapPtr, 3, 0.0, (double)texH);
                for (int i = 0; i < 4; i++) Efl.evas_map_point_color_set(mapPtr, i, 255, 255, 255, 255);
                Efl.evas_object_map_set(obj, mapPtr);
                if (!c.MapEnabled)
                {
                    c.MapEnabled = true;
                    Efl.evas_object_map_enable_set(obj, true);
                }
            }
            if (c.R != r || c.G != g || c.B != b || c.A != a)
            {
                c.R = r; c.G = g; c.B = b; c.A = a;
                Efl.evas_object_color_set(obj, r, g, b, a);
            }
            if (!c.Visible) { c.Visible = true; Efl.evas_object_show(obj); }
        }

        private void ApplyMoveResizeTiledColor(IntPtr obj, int idx, int x, int y, int w, int h, int fx, int fy, int fw, int fh, int r, int g, int b, int a)
        {
            if (obj == IntPtr.Zero) return;
            if (a <= 0) { HideLayer(obj, idx); return; }
            ref LayerCache c = ref _cache[idx];
            if (c.X != x || c.Y != y) { c.X = x; c.Y = y; Efl.evas_object_move(obj, x, y); }
            if (c.W != w || c.H != h) { c.W = w; c.H = h; Efl.evas_object_resize(obj, w, h); }
            if (c.Fx != fx || c.Fy != fy || c.Fw != fw || c.Fh != fh)
            {
                c.Fx = fx; c.Fy = fy; c.Fw = fw; c.Fh = fh;
                Efl.evas_object_image_fill_set(obj, fx, fy, fw, fh);
            }
            if (c.R != r || c.G != g || c.B != b || c.A != a)
            {
                c.R = r; c.G = g; c.B = b; c.A = a;
                Efl.evas_object_color_set(obj, r, g, b, a);
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

        private void ApplyBackdropFrame()
        {
            if (!_built) return;
            if (_cfg.UsesLake)
            {
                // Keep pure #000000 _bg visible (0% burn-in outside the wandering wave portal, 0 dirty rect from _bg).
                SetBgCovered(false);
                EnsureLakeLoaded();

                AmbientLakeEngine.LakeRenderFrame lf;
                AmbientLakeEngine.ComputeFrame(_animTimeMsExact, _screenW, _screenH, _dimmed, _scalePreset, out lf);

                if (_useSubpixelMap)
                {
                    if (_lakeClip != IntPtr.Zero)
                    {
                        int clipX = (int)Math.Floor(lf.PortalFx);
                        int clipY = (int)Math.Floor(lf.PortalFy);
                        int clipW = Math.Max(1, (int)Math.Ceiling(lf.PortalFx + lf.PortalW) - clipX);
                        int clipH = Math.Max(1, (int)Math.Ceiling(lf.PortalFy + lf.PortalH) - clipY);
                        if (_clipX != clipX || _clipY != clipY) { _clipX = clipX; _clipY = clipY; Efl.evas_object_move(_lakeClip, clipX, clipY); }
                        if (_clipW != clipW || _clipH != clipH) { _clipW = clipW; _clipH = clipH; Efl.evas_object_resize(_lakeClip, clipW, clipH); }
                        if (!_clipVisible) { _clipVisible = true; Efl.evas_object_show(_lakeClip); }
                    }

                    ApplyFloatQuadMap(_waveSwell, CacheWaveSwell,
                        lf.SwellQuadFx, lf.SwellQuadFy, lf.SwellQuadFw, lf.SwellQuadFh,
                        AmbientLakeEngine.SwellTileW * AmbientLakeEngine.SwellRepeatX,
                        AmbientLakeEngine.SwellTileH * AmbientLakeEngine.SwellRepeatY,
                        lf.SwellTint, lf.SwellTint, lf.SwellTint, 255, opaque: true);

                    ApplyFloatQuadMap(_waveRipple, CacheWaveRipple,
                        lf.RippleQuadFx, lf.RippleQuadFy, lf.RippleQuadFw, lf.RippleQuadFh,
                        AmbientLakeEngine.RippleTileW * AmbientLakeEngine.RippleRepeatX,
                        AmbientLakeEngine.RippleTileH * AmbientLakeEngine.RippleRepeatY,
                        lf.RippleAlpha, lf.RippleAlpha, lf.RippleAlpha, lf.RippleAlpha, opaque: false);

                    double mfx, mfy, mfw, mfh;
                    IdleBackdropModel.ComputePaddedFloatQuad(
                        lf.PortalFx, lf.PortalFy, lf.PortalW, lf.PortalH,
                        AmbientLakeEngine.MaskTexW, AmbientLakeEngine.MaskTexH,
                        AmbientLakeEngine.MaskPad,
                        AmbientLakeEngine.MaskTexW + AmbientLakeEngine.MaskPad * 2,
                        AmbientLakeEngine.MaskTexH + AmbientLakeEngine.MaskPad * 2,
                        out mfx, out mfy, out mfw, out mfh);
                    ApplyFloatQuadMap(_waveMask, CacheWaveMask,
                        mfx, mfy, mfw, mfh,
                        AmbientLakeEngine.MaskTexW + AmbientLakeEngine.MaskPad * 2,
                        AmbientLakeEngine.MaskTexH + AmbientLakeEngine.MaskPad * 2,
                        lf.MaskTint, lf.MaskTint, lf.MaskTint, 255, opaque: false);
                }
                else
                {
                    HideLakeClip();
                    int swW = Math.Max(1, (int)Math.Round(lf.PortalW / 1.44));
                    int swH = Math.Max(1, (int)Math.Round(lf.PortalH / 1.56));
                    int rpW = Math.Max(1, (int)Math.Round(lf.PortalW / 2.24));
                    int rpH = Math.Max(1, (int)Math.Round(lf.PortalH / 2.42));
                    ApplyMoveResizeTiledColor(_waveSwell, CacheWaveSwell, lf.PortalX, lf.PortalY, lf.PortalW, lf.PortalH, 0, 0, swW, swH, lf.SwellBotTint, lf.SwellBotTint, lf.SwellBotTint, 255);
                    ApplyMoveResizeTiledColor(_waveRipple, CacheWaveRipple, lf.PortalX, lf.PortalY, lf.PortalW, lf.PortalH, 0, 0, rpW, rpH, lf.RippleTopAlpha, lf.RippleTopAlpha, lf.RippleTopAlpha, lf.RippleTopAlpha);

                    // Organic raised-cosine/Gaussian atmospheric mask dissolves the lake vista into pure #000000 _bg.
                    ApplyMoveResizeColor(_waveMask, CacheWaveMask, lf.PortalX, lf.PortalY, lf.PortalW, lf.PortalH, lf.MaskTint, lf.MaskTint, lf.MaskTint, 255);
                }
            }
            else if (_cfg.UsesAurora)
            {
                SetBgCovered(false);
                HideLakeClip();
                EnsureAuroraLoaded();
                if (_useSubpixelMap)
                {
                    int silkTexTotalW = SilkTexW + SilkPad * 2;
                    int silkTexTotalH = SilkTexH + SilkPad * 2;
                    for (int i = 0; i < AmbientLakeEngine.AuroraRibbonCount; i++)
                    {
                        IdleBackdropModel.AuroraRibbonMotion rm;
                        AmbientLakeEngine.ComputeAuroraRibbonMotion(i, _animTimeMsExact, _screenW, _screenH, _dimmed, _scalePreset, out rm);
                        double qfx, qfy, qfw, qfh;
                        IdleBackdropModel.ComputePaddedFloatQuad(rm.X, rm.Y, rm.W, rm.H, SilkTexW, SilkTexH, SilkPad, silkTexTotalW, silkTexTotalH, out qfx, out qfy, out qfw, out qfh);
                        IntPtr obj = i == 0 ? _silkA : (i == 1 ? _silkB : _silkC);
                        ApplyFloatQuadMap(obj, CacheSilkBase + i, qfx, qfy, qfw, qfh, silkTexTotalW, silkTexTotalH, rm.Alpha, rm.Alpha, rm.Alpha, rm.Alpha, opaque: false);
                    }

                    for (int i = 0; i < AmbientLakeEngine.AuroraActiveMoteCount && i < _motes.Length; i++)
                    {
                        IdleBackdropModel.MoteMotion mm;
                        AmbientLakeEngine.ComputeAuroraMoteMotion(i, _animTimeMsExact, _screenW, _screenH, _dimmed, _scalePreset, out mm);
                        if (mm.Alpha <= 0)
                        {
                            HideLayer(_motes[i], CacheMoteBase + i);
                            continue;
                        }
                        bool crisp = AmbientLakeEngine.IsAuroraMoteCrisp(i);
                        int inner = crisp ? MoteCrispTex : MoteOrbTex;
                        int total = inner + MotePad * 2;
                        double qfx, qfy, qfw, qfh;
                        IdleBackdropModel.ComputePaddedFloatQuad(mm.X, mm.Y, mm.Size, mm.Size, inner, inner, MotePad, total, total, out qfx, out qfy, out qfw, out qfh);
                        if (qfx + qfw <= 0.0 || qfx >= _screenW || qfy + qfh <= 0.0 || qfy >= _screenH)
                        {
                            HideLayer(_motes[i], CacheMoteBase + i);
                            continue;
                        }
                        int pr = (mm.R * mm.Alpha) / 255;
                        int pg = (mm.G * mm.Alpha) / 255;
                        int pb = (mm.B * mm.Alpha) / 255;
                        ApplyFloatQuadMap(_motes[i], CacheMoteBase + i, qfx, qfy, qfw, qfh, total, total, pr, pg, pb, mm.Alpha, opaque: false);
                    }
                    for (int i = AmbientLakeEngine.AuroraActiveMoteCount; i < _motes.Length; i++)
                    {
                        HideLayer(_motes[i], CacheMoteBase + i);
                    }
                }
                else
                {
                    for (int i = 0; i < AmbientLakeEngine.AuroraRibbonCount; i++) ApplySingleRibbon(i);
                    for (int i = 0; i < AmbientLakeEngine.AuroraActiveMoteCount && i < _motes.Length; i++)
                    {
                        IdleBackdropModel.MoteMotion mm;
                        AmbientLakeEngine.ComputeAuroraMoteMotion(i, _animTimeMsExact, _screenW, _screenH, _dimmed, _scalePreset, out mm);
                        if (mm.Alpha <= 0)
                        {
                            HideLayer(_motes[i], CacheMoteBase + i);
                            continue;
                        }
                        int sz = Math.Max(4, (int)Math.Round(mm.Size));
                        int pr = (mm.R * mm.Alpha) / 255;
                        int pg = (mm.G * mm.Alpha) / 255;
                        int pb = (mm.B * mm.Alpha) / 255;
                        ApplyMoveResizeColor(_motes[i], CacheMoteBase + i, (int)Math.Round(mm.X), (int)Math.Round(mm.Y), sz, sz, pr, pg, pb, mm.Alpha);
                    }
                    for (int i = AmbientLakeEngine.AuroraActiveMoteCount; i < _motes.Length; i++)
                    {
                        HideLayer(_motes[i], CacheMoteBase + i);
                    }
                }
            }
            else
            {
                HideBackdropObjects();
            }
        }

        private void ApplySingleRibbon(int idx)
        {
            IdleBackdropModel.AuroraRibbonMotion rm;
            AmbientLakeEngine.ComputeAuroraRibbonMotion(idx, _animTimeMsExact, _screenW, _screenH, _dimmed, _scalePreset, out rm);
            IntPtr obj = idx == 0 ? _silkA : (idx == 1 ? _silkB : _silkC);
            ApplyMoveResizeColor(obj, CacheSilkBase + idx,
                (int)Math.Round(rm.X), (int)Math.Round(rm.Y),
                Math.Max(1, (int)Math.Round(rm.W)), Math.Max(1, (int)Math.Round(rm.H)),
                rm.Alpha, rm.Alpha, rm.Alpha, rm.Alpha);
        }

        private void ApplyVisuals()
        {
            if (!_built) return;
            ApplyBackdropFrame();
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
            if (_textShown && _lastStep == _haltonStep && _lastMode == _cfg.Mode && _lastDimmed == _dimmed
                && now.Minute == _lastMinute && now.Hour == _lastHour && now.Day == _lastDay)
                return;

            _lastMinute = now.Minute;
            _lastHour = now.Hour;
            _lastDay = now.Day;
            string timeText = now.ToString("HH:mm", CultureInfo.InvariantCulture);
            string dayAbbr, dateStr;
            IdleBackdropModel.FormatDate(now, out dayAbbr, out dateStr);

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

            if (isClock && !_screensaverOverlay)
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
                if (_animAnimator != IntPtr.Zero) { Efl.ecore_animator_del(_animAnimator); _animAnimator = IntPtr.Zero; }
                if (_animTimer != IntPtr.Zero) { Efl.ecore_timer_del(_animTimer); _animTimer = IntPtr.Zero; }
                if (_clockTimer != IntPtr.Zero) { Efl.ecore_timer_del(_clockTimer); _clockTimer = IntPtr.Zero; }
                _animInterval = 0;
                _animClock.Pause();
                return;
            }

            if (_cfg.UsesWallpaper)
            {
                if (_orbitTimer != IntPtr.Zero) { Efl.ecore_timer_del(_orbitTimer); _orbitTimer = IntPtr.Zero; }
                if (!_softwareEngine)
                {
                    if (_animTimer != IntPtr.Zero) { Efl.ecore_timer_del(_animTimer); _animTimer = IntPtr.Zero; }
                    _animInterval = 1.0 / 50.0;
                    if (_animAnimator == IntPtr.Zero)
                    {
                        _lastAnimTickMono = -1.0;
                        _vblankStrideCount = 0;
                        _pendingStrideDt = 0.0;
                        _animClock.Pause();
                        _animAnimator = Efl.ecore_animator_add(_animCb, IntPtr.Zero);
                    }
                }
                else
                {
                    if (_animAnimator != IntPtr.Zero) { Efl.ecore_animator_del(_animAnimator); _animAnimator = IntPtr.Zero; }
                    if (_animTimer == IntPtr.Zero || Math.Abs(_animInterval - SwAnimInterval) > 0.001)
                    {
                        if (_animTimer != IntPtr.Zero) Efl.ecore_timer_del(_animTimer);
                        _animInterval = SwAnimInterval;
                        _lastAnimTickMono = -1.0;
                        _animTimer = Efl.ecore_timer_add(SwAnimInterval, _animCb, IntPtr.Zero);
                    }
                }
            }
            else
            {
                if (_animAnimator != IntPtr.Zero) { Efl.ecore_animator_del(_animAnimator); _animAnimator = IntPtr.Zero; }
                if (_animTimer != IntPtr.Zero) { Efl.ecore_timer_del(_animTimer); _animTimer = IntPtr.Zero; }
                _animInterval = 0;
                _animClock.Pause();
                if (_cfg.ShowsClock && !_dockOverlay)
                {
                    if (_orbitTimer == IntPtr.Zero) _orbitTimer = Efl.ecore_timer_add(OrbitSeconds, _orbitCb, IntPtr.Zero);
                }
                else if (_orbitTimer != IntPtr.Zero)
                {
                    Efl.ecore_timer_del(_orbitTimer);
                    _orbitTimer = IntPtr.Zero;
                }
            }

            // Coalesce 1s clock updates into active animation tick; keep _clockTimer for Clock mode and SW fallback.
            if (_shown && !_displayOff && _cfg.ShowsClock && _animAnimator == IntPtr.Zero)
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
            if (!_dockOverlay && !_screensaverOverlay && _hint != IntPtr.Zero)
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
            if (_animAnimator != IntPtr.Zero) { Efl.ecore_animator_del(_animAnimator); _animAnimator = IntPtr.Zero; }
            if (_animTimer != IntPtr.Zero) { Efl.ecore_timer_del(_animTimer); _animTimer = IntPtr.Zero; }
            _animInterval = 0;
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
            long workT0 = _perf ? Stopwatch.GetTimestamp() : 0;
            try
            {
                if (!_threadsPromoted)
                {
                    _threadsPromoted = true;
                    if (OnAnimatorStarted != null) OnAnimatorStarted();
                }

                double now = Efl.ecore_time_get();
                double dt, rawDt;
                bool hasRealDt;
                if (_softwareEngine)
                {
                    rawDt = _lastAnimTickMono < 0.0 ? SwAnimInterval : now - _lastAnimTickMono;
                    hasRealDt = _lastAnimTickMono >= 0.0 && rawDt >= 0.0;
                    _lastAnimTickMono = now;
                    dt = rawDt < 0.0 ? SwAnimInterval : (rawDt > 2.5 ? 2.5 : rawDt);
                }
                else
                {
                    if (!_animClock.TryStep(now, out dt, out rawDt, out hasRealDt))
                    {
                        if (_perf) _perfSkipped++;
                        return 1;
                    }
                    // Full 50 Hz (stride = 1) for silky motion; stride = 2 only when dimmed after 10 min idle.
                    int stride = _envStride > 0 ? _envStride : (_dimmed ? 2 : 1);
                    if (stride > 1)
                    {
                        _pendingStrideDt += dt;
                        _vblankStrideCount++;
                        if (_vblankStrideCount < stride) return 1;
                        _vblankStrideCount = 0;
                        dt = _pendingStrideDt;
                        _pendingStrideDt = 0.0;
                    }
                    else if (_pendingStrideDt > 0.0)
                    {
                        dt += _pendingStrideDt;
                        _pendingStrideDt = 0.0;
                        _vblankStrideCount = 0;
                    }
                }

                _animTimeMsExact += dt * (_dimmed ? 500.0 : 1000.0);
                _animTimeMs = (int)(_animTimeMsExact % 2147000000.0);

                ApplyBackdropFrame();

                if (_cfg.ShowsClock)
                {
                    _clockAccumSec += dt;
                    bool checkClock = _clockAccumSec >= 1.0;
                    if (checkClock) _clockAccumSec %= 1.0;
                    if (!_dockOverlay)
                    {
                        _orbitAccumSec += dt;
                        if (_orbitAccumSec >= OrbitSeconds)
                        {
                            _orbitAccumSec %= OrbitSeconds;
                            _haltonStep++;
                            checkClock = true;
                        }
                    }
                    if (checkClock) ApplyClockVisuals();
                }

                if (_perf)
                {
                    double workMs = (Stopwatch.GetTimestamp() - workT0) * 1000.0 / Stopwatch.Frequency;
                    RecordPerfSample(hasRealDt ? rawDt * 1000.0 : -1.0, workMs);
                }
            }
            catch (Exception ex) { _log("idle anim: " + ex.Message); }
            return 1;
        }

        private void ResetPerfWindow()
        {
            _perfCount = 0;
            _perfIntervalCount = 0;
            _perfOver30 = 0;
            _perfSkipped = 0;
            _perfMinDt = double.MaxValue;
            _perfMaxDt = 0;
            _perfSumDt = 0;
            _perfSumWork = 0;
            _perfMaxWork = 0;
        }

        private void RecordPerfSample(double intervalMs, double workMs)
        {
            _perfCount++;
            _perfSumWork += workMs;
            if (workMs > _perfMaxWork) _perfMaxWork = workMs;
            if (intervalMs >= 0.0)
            {
                _perfIntervalCount++;
                _perfSumDt += intervalMs;
                if (intervalMs < _perfMinDt) _perfMinDt = intervalMs;
                if (intervalMs > _perfMaxDt) _perfMaxDt = intervalMs;
                if (intervalMs > 30.0) _perfOver30++;
            }
            if (_perfCount < PerfWindowFrames) return;
            _log(string.Format(CultureInfo.InvariantCulture,
                "perf idle {0}: frames={1} skipped={2} interval ms min/avg/max={3:0.0}/{4:0.0}/{5:0.0} over30ms={6} work ms avg/max={7:0.00}/{8:0.00}",
                _cfg.Mode, _perfCount, _perfSkipped,
                _perfIntervalCount > 0 ? _perfMinDt : 0.0,
                _perfIntervalCount > 0 ? _perfSumDt / _perfIntervalCount : 0.0,
                _perfMaxDt, _perfOver30,
                _perfSumWork / _perfCount, _perfMaxWork));
            ResetPerfWindow();
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
