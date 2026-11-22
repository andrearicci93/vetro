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
        private const int ClockW = 280, ClockH = 175;
        private const int WallW = 320, WallH = 180;

        private IdleConfig _cfg;
        private readonly Action<string> _log;
        private readonly int _screenW, _screenH;
        private readonly Efl.TaskCb _orbitCb, _hintCb;

        private IntPtr _win, _bg, _wall, _primary, _dateDay, _dateSep, _dateNum, _meta, _hint;
        private IntPtr _orbitTimer, _hintTimer;
        private bool _built, _failed, _shown, _dimmed, _dockOverlay, _displayOff, _wallLoaded, _hintShown;
        private int _haltonStep = 1;
        private int _lastTint = -1, _lastStep = -1;
        private bool _textShown, _lastDimmed;
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
        }

        public bool IsShown { get { return _shown; } }
        public Action OnShown;

        /// <summary>
        /// Pre-builds and transparently maps the Wayland surface once at startup so the first real Show()
        /// pays zero ~90 ms GL/Wayland surface cost and WmStackController can assign layer 200 ahead of time.
        /// </summary>
        public void Prewarm()
        {
            if (_shown || !Build()) return;
            if (_bg != IntPtr.Zero) Efl.evas_object_hide(_bg);
            if (_wall != IntPtr.Zero) Efl.evas_object_hide(_wall);
            Efl.evas_object_show(_win);
            Efl.evas_object_hide(_win);
            if (_bg != IntPtr.Zero) Efl.evas_object_show(_bg);
            if (_wall != IntPtr.Zero && _cfg.UsesWallpaper) Efl.evas_object_show(_wall);
        }

        public void Show(bool dimmed, bool dockOverlay)
        {
            if (!Build()) return;
            _dimmed = dimmed;
            _dockOverlay = dockOverlay;
            if (!_shown)
            {
                _shown = true;
                Efl.evas_object_show(_win);
                StartHint();
                if (OnShown != null) OnShown();
            }
            ApplyVisuals();
            UpdateTimers();
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
            UpdateTimers();
        }

        public void SetDimmed(bool dimmed)
        {
            if (_dimmed == dimmed) return;
            _dimmed = dimmed;
            if (!_shown) return;
            ApplyVisuals();
        }

        public void SetDisplayOff(bool off)
        {
            if (_displayOff == off) return;
            _displayOff = off;
            if (_shown && !off) ApplyVisuals();
            UpdateTimers();
        }

        public void Reconfigure(IdleConfig cfg)
        {
            _cfg = cfg ?? _cfg;
            _dimmed = false;
            if (!_built) return;
            if (_cfg.UsesWallpaper)
            {
                EnsureWallpaperLoaded();
                if (_wall != IntPtr.Zero) Efl.evas_object_show(_wall);
            }
            else if (_wall != IntPtr.Zero)
            {
                Efl.evas_object_hide(_wall);
            }
            if (_primary != IntPtr.Zero)
                Efl.evas_object_text_font_set(_primary, _cfg.ShowsClock ? FontLight : FontMedium, _cfg.ShowsClock ? 96 : 26);
            if (_shown)
            {
                ApplyVisuals();
                UpdateTimers();
            }
            _log("idle: reconfigured mode=" + _cfg.Mode + " autoDock=" + _cfg.AutoDock + " potOff=" + _cfg.PictureOffMinutes);
        }

        private void EnsureWallpaperLoaded()
        {
            if (_wallLoaded || _wall == IntPtr.Zero) return;
            Efl.evas_object_image_size_set(_wall, WallW, WallH);
            IntPtr dst = Efl.evas_object_image_data_get(_wall, true);
            if (dst != IntPtr.Zero)
            {
                uint[] pixels = IdleBackdropModel.BuildWallpaperPixels(WallW, WallH);
                int stride = Math.Max(WallW * 4, Efl.evas_object_image_stride_get(_wall));
                int[] row = new int[WallW];
                for (int y = 0; y < WallH; y++)
                {
                    Buffer.BlockCopy(pixels, y * WallW * 4, row, 0, WallW * 4);
                    Marshal.Copy(row, 0, IntPtr.Add(dst, y * stride), WallW);
                }
                Efl.evas_object_image_data_set(_wall, dst);
                Efl.evas_object_image_data_update_add(_wall, 0, 0, WallW, WallH);
                _wallLoaded = true;
            }
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

                IntPtr evas = Efl.evas_object_evas_get(_win);
                _bg = Efl.evas_object_rectangle_add(evas);
                Efl.evas_object_color_set(_bg, 0, 0, 0, 255);
                Efl.evas_object_move(_bg, 0, 0);
                Efl.evas_object_resize(_bg, _screenW, _screenH);
                Efl.evas_object_pass_events_set(_bg, true);
                Efl.evas_object_show(_bg);

                // Always allocate _wall before text objects so live mode switching keeps clock labels above the wallpaper.
                _wall = Efl.evas_object_image_add(evas);
                Efl.evas_object_image_alpha_set(_wall, false);
                Efl.evas_object_image_filled_set(_wall, true);
                Efl.evas_object_image_smooth_scale_set(_wall, true);
                Efl.evas_object_move(_wall, 0, 0);
                Efl.evas_object_resize(_wall, _screenW, _screenH);
                Efl.evas_object_pass_events_set(_wall, true);
                if (_cfg.UsesWallpaper)
                {
                    EnsureWallpaperLoaded();
                    Efl.evas_object_show(_wall);
                }
                else
                {
                    Efl.evas_object_hide(_wall);
                }

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
                _log("idle: built mode=" + _cfg.Mode + " level=" + _cfg.NotificationLevel + " rc=" + lvlRc);
                return true;
            }
            catch (Exception ex) { _failed = true; _log("idle: " + ex.Message); return false; }
        }

        private void ApplyVisuals()
        {
            if (!_built) return;
            if (_wall != IntPtr.Zero)
            {
                int tint = _dimmed ? 96 : 255;
                if (tint != _lastTint)
                {
                    _lastTint = tint;
                    Efl.evas_object_color_set(_wall, tint, tint, tint, 255);
                }
            }

            if (!_cfg.ShowsClock)
            {
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
            SetIceColor(_primary, isClock ? (_dimmed ? 51 : 97) : (_dimmed ? 68 : 155));
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
            SetIceColor(_dateDay, isClock ? (_dimmed ? 28 : 56) : (_dimmed ? 38 : 84));
            SetIceColor(_dateNum, isClock ? (_dimmed ? 34 : 68) : (_dimmed ? 46 : 106));
            SetIceColor(_dateSep, isClock ? (_dimmed ? 12 : 24) : (_dimmed ? 16 : 36));

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
                SetIceColor(_meta, _dimmed ? 24 : 48);
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
            if (_shown && !_displayOff && !_dockOverlay && _cfg.Mode != IdleMode.Clean)
            {
                if (_orbitTimer == IntPtr.Zero) _orbitTimer = Efl.ecore_timer_add(OrbitSeconds, _orbitCb, IntPtr.Zero);
            }
            else if (_orbitTimer != IntPtr.Zero)
            {
                Efl.ecore_timer_del(_orbitTimer);
                _orbitTimer = IntPtr.Zero;
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
            if (_hintTimer != IntPtr.Zero) { Efl.ecore_timer_del(_hintTimer); _hintTimer = IntPtr.Zero; }
            if (_hintShown && _hint != IntPtr.Zero) Efl.evas_object_hide(_hint);
            _hintShown = false;
        }

        private byte OnOrbitTick(IntPtr data)
        {
            try
            {
                _haltonStep++;
                ApplyVisuals();
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
