using System;
using System.IO;
using Launcher.Core;
using Launcher.Native;

namespace Launcher.Ui
{
    /// <summary>
    /// The volume pill: a vertical glass capsule at the left edge of the screen with the level filling it from the bottom and a speaker
    /// at its foot, shown for a moment whenever the volume changes. It is its own window in the notification layer that
    /// never takes focus and lets every input event through, so the app underneath (Netflix, the tuner) keeps both.
    /// Colours and shapes follow the dock: dark slate sheet, thin light edge, white level. It exists only after the
    /// first volume key, and its frame animator runs only while it is on screen.
    /// </summary>
    internal sealed class VolumePill
    {
        private const int WinW = 120, WinH = 400, EdgeGap = 28;
        private const int BodyX = 12, BodyY = 20, BodyW = 96, BodyH = 360;
        private const int CapX = 24, CapW = 72, TrackY = 32, TrackH = 264;
        // The icon sits in the 84 px between the foot of the track and the foot of the body, with the same air above and below.
        private const int IconSize = 40, IconX = BodyX + (BodyW - IconSize) / 2, IconY = TrackY + TrackH + (BodyY + BodyH - TrackY - TrackH - IconSize) / 2;
        private const int NotificationLevelTop = 40, WindowLayer = 900;
        private const double HoldSeconds = 1.6, FadeInSeconds = 0.12, FadeOutSeconds = 0.22;

        private readonly string _assets;
        private readonly Action<string> _log;
        private readonly int _screenW, _screenH;
        private IntPtr _win, _rim, _body, _track, _fill, _clip;
        private readonly IntPtr[] _icons = new IntPtr[3];
        private IntPtr _animator;
        private readonly Efl.TaskCb _tick;
        private bool _built, _failed, _shown;
        private double _shownAt, _until;
        private int _fillHeight, _iconLevel = -1;

        public VolumePill(string assets, Action<string> log, int screenW, int screenH)
        {
            _assets = assets; _log = log; _screenW = screenW; _screenH = screenH;
            _tick = Tick;
        }

        public bool IsShown { get { return _shown; } }

        public void Show(int volume, bool muted)
        {
            if (!Build()) return;
            Update(volume, muted);
            double now = Efl.ecore_time_get();
            _until = now + HoldSeconds;
            if (!_shown)
            {
                _shown = true; _shownAt = now;
                Apply(0);
                Efl.evas_object_show(_win);
            }
            else if (now - _shownAt < FadeInSeconds + 0.01) { /* still fading in: keep going */ }
            else _shownAt = now - FadeInSeconds;   // came back during the fade-out: full again at once
            if (_animator == IntPtr.Zero) _animator = Efl.ecore_animator_add(_tick, IntPtr.Zero);
        }

        private bool Build()
        {
            if (_built) return true;
            if (_failed) return false;
            try
            {
                _win = Efl.elm_win_add(IntPtr.Zero, "vetro-volume", Efl.ElmWinNotification);
                if (_win == IntPtr.Zero) { _failed = true; _log("volume: elm_win_add failed"); return false; }
                Efl.elm_win_title_set(_win, "vetro-volume");
                Efl.elm_win_alpha_set(_win, true);
                Efl.elm_win_borderless_set(_win, true);
                Efl.elm_win_prop_focus_skip_set(_win, true);
                Efl.efl_util_set_notification_window_level(_win, NotificationLevelTop);
                Efl.elm_win_layer_set(_win, WindowLayer);
                Efl.elm_win_aux_hint_add(_win, "wm.policy.win.user.geometry", "1");
                Efl.elm_win_aux_hint_add(_win, "wm.comp.win.effect.enable", "0");
                Efl.evas_object_move(_win, EdgeGap, (_screenH - WinH) / 2);
                Efl.evas_object_resize(_win, WinW, WinH);
                Efl.evas_object_pass_events_set(_win, true);
                IntPtr evas = Efl.evas_object_evas_get(_win);
                _rim = Capsule(evas, "pill_rim", 50, BodyX - 2, BodyY - 2, BodyW + 4, BodyH + 4);
                _body = Capsule(evas, "pill_bg", 48, BodyX, BodyY, BodyW, BodyH);
                _track = Capsule(evas, "pill_cap", 36, CapX, TrackY, CapW, TrackH);
                // The level is the whole track capsule seen through a window that rises from the foot: a low level is a thin
                // slice with the track's rounded bottom, a full one is the whole capsule.
                _fill = Capsule(evas, "pill_cap", 36, CapX, TrackY, CapW, TrackH);
                _clip = Efl.evas_object_rectangle_add(evas);
                Efl.evas_object_color_set(_clip, 255, 255, 255, 255);
                Efl.evas_object_move(_clip, CapX, TrackY + TrackH);
                Efl.evas_object_resize(_clip, CapW, 1);
                Efl.evas_object_clip_set(_fill, _clip);
                Efl.evas_object_show(_clip);
                for (int i = 0; i < _icons.Length; i++)
                {
                    IntPtr img = Efl.evas_object_image_add(evas);
                    Efl.evas_object_image_file_set(img, Path.Combine(_assets, "vol_icon_" + i + ".png"), null);
                    if (Efl.evas_object_image_load_error_get(img) != Efl.EvasLoadErrorNone) _log("volume: asset missing vol_icon_" + i);
                    Efl.evas_object_image_filled_set(img, true);
                    Efl.evas_object_image_smooth_scale_set(img, true);
                    Efl.evas_object_move(img, IconX, IconY);
                    Efl.evas_object_resize(img, IconSize, IconSize);
                    Efl.evas_object_pass_events_set(img, true);
                    _icons[i] = img;
                }
                _built = true;
                _log("volume: pill ready");
                return true;
            }
            catch (Exception ex) { _failed = true; _log("volume: " + ex.Message); return false; }
        }

        private IntPtr Capsule(IntPtr evas, string name, int border, int x, int y, int w, int h)
        {
            IntPtr img = Efl.evas_object_image_add(evas);
            Efl.evas_object_image_file_set(img, Path.Combine(_assets, name + ".png"), null);
            if (Efl.evas_object_image_load_error_get(img) != Efl.EvasLoadErrorNone) _log("volume: asset missing " + name);
            Efl.evas_object_image_filled_set(img, true);
            Efl.evas_object_image_border_set(img, border, border, border, border);
            Efl.evas_object_image_border_center_fill_set(img, 1);
            Efl.evas_object_image_smooth_scale_set(img, true);
            Efl.evas_object_move(img, x, y);
            Efl.evas_object_resize(img, w, h);
            Efl.evas_object_pass_events_set(img, true);
            Efl.evas_object_show(img);
            return img;
        }

        private void Update(int volume, bool muted)
        {
            _fillHeight = VolumeModel.FillHeight(volume, muted, TrackH);
            if (_fillHeight > 0)
            {
                Efl.evas_object_move(_clip, CapX, TrackY + TrackH - _fillHeight);
                Efl.evas_object_resize(_clip, CapW, _fillHeight);
            }
            _iconLevel = VolumeModel.IconLevel(volume, muted);
        }

        private void Apply(double a)
        {
            Tint(_rim, 0xFFFFFF, 0.22 * a);
            Tint(_body, Design.ShellColor, 0.84 * a);
            Tint(_track, 0xFFFFFF, 0.16 * a);
            if (_fillHeight > 0) { Tint(_fill, 0xFFFFFF, 0.96 * a); Efl.evas_object_show(_fill); }
            else Efl.evas_object_hide(_fill);
            for (int i = 0; i < _icons.Length; i++)
            {
                if (i == _iconLevel) { Tint(_icons[i], 0xFFFFFF, 0.95 * a); Efl.evas_object_show(_icons[i]); }
                else Efl.evas_object_hide(_icons[i]);
            }
        }

        /// <summary>EFL colours are premultiplied: each channel is scaled by the alpha.</summary>
        private static void Tint(IntPtr obj, int rgb, double alpha)
        {
            int a = (int)Math.Round(Math.Max(0, Math.Min(1, alpha)) * 255);
            Efl.evas_object_color_set(obj, ((rgb >> 16) & 255) * a / 255, ((rgb >> 8) & 255) * a / 255, (rgb & 255) * a / 255, a);
        }

        private byte Tick(IntPtr data)
        {
            try
            {
                double now = Efl.ecore_time_get();
                double a = Math.Min(1.0, (now - _shownAt) / FadeInSeconds);
                if (now > _until) a = Math.Min(a, 1.0 - (now - _until) / FadeOutSeconds);
                if (a <= 0)
                {
                    Efl.evas_object_hide(_win);
                    _shown = false; _animator = IntPtr.Zero;
                    return 0;
                }
                Apply(a);
                return 1;
            }
            catch (Exception ex) { _log("volume tick: " + ex.Message); _animator = IntPtr.Zero; _shown = false; Efl.evas_object_hide(_win); return 0; }
        }
    }
}
