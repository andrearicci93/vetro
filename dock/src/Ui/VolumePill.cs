using System;
using System.IO;
using Launcher.Core;
using Launcher.Native;

namespace Launcher.Ui
{
    /// <summary>
    /// The volume pill: one soft glass capsule on a screen edge of the user's choice (left, right, top or bottom, 96 px from
    /// the edge) with the level filling a capsule track in light blue, a speaker icon and the level as a number. Vertical on the
    /// side edges (the level rises from the foot), horizontal on top and bottom (it grows from the left). It is shown for a
    /// moment whenever the volume changes. It is its own window in the notification layer that never takes focus and lets
    /// every input event through, so the app underneath (Netflix, the tuner) keeps both. The geometry is
    /// <see cref="VolumePlacement"/>; colours follow <see cref="Design"/>. It exists only after the first volume key, and its
    /// frame animator runs only while it is on screen.
    /// </summary>
    internal sealed class VolumePill
    {
        private const string Font = "SamsungOneUI 500,Sans";
        private const int NotificationLevelTop = 40, WindowLayer = 900;
        private const double HoldSeconds = 1.6, FadeInSeconds = 0.12, FadeOutSeconds = 0.22;

        private readonly string _assets;
        private readonly Action<string> _log;
        private readonly VolumePlacement _p;
        private IntPtr _win, _rim, _body, _track, _fill, _clip, _num;
        private readonly IntPtr[] _icons = new IntPtr[3];
        private IntPtr _animator;
        private readonly Efl.TaskCb _tick;
        private bool _built, _failed, _shown, _muted;
        private double _shownAt, _until;
        private int _fillLength, _iconLevel = -1;

        public VolumePill(string assets, Action<string> log, int screenW, int screenH, VolumeEdge edge)
        {
            _assets = assets; _log = log; _p = VolumePlacement.For(edge, screenW, screenH);
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
                Efl.evas_object_move(_win, _p.WinX, _p.WinY);
                Efl.evas_object_resize(_win, _p.WinW, _p.WinH);
                Efl.evas_object_pass_events_set(_win, true);
                IntPtr evas = Efl.evas_object_evas_get(_win);
                int ox = _p.WinX, oy = _p.WinY;
                int half = _p.BodyH < _p.BodyW ? _p.BodyH / 2 : _p.BodyW / 2;        // body radius: a full capsule
                int trackHalf = (_p.Vertical ? _p.TrackW : _p.TrackH) / 2;
                _rim = Capsule(evas, "vol_rim", half + 2, _p.BodyX - 2 - ox, _p.BodyY - 2 - oy, _p.BodyW + 4, _p.BodyH + 4);
                _body = Capsule(evas, "vol_bg", half, _p.BodyX - ox, _p.BodyY - oy, _p.BodyW, _p.BodyH);
                _track = Capsule(evas, "vol_cap", trackHalf, _p.TrackX - ox, _p.TrackY - oy, _p.TrackW, _p.TrackH);
                // The level is the whole track capsule seen through a window that grows from the foot (or the left edge): a low
                // level is a thin slice with the track's rounded end, a full one is the whole capsule.
                _fill = Capsule(evas, "vol_cap", trackHalf, _p.TrackX - ox, _p.TrackY - oy, _p.TrackW, _p.TrackH);
                _clip = Efl.evas_object_rectangle_add(evas);
                Efl.evas_object_color_set(_clip, 255, 255, 255, 255);
                Efl.evas_object_move(_clip, _p.TrackX - ox, _p.TrackY - oy);
                Efl.evas_object_resize(_clip, 1, 1);
                Efl.evas_object_clip_set(_fill, _clip);
                Efl.evas_object_show(_clip);
                _num = Efl.evas_object_text_add(evas);
                Efl.evas_object_text_font_set(_num, Font, VolumePlacement.NumberSize);
                Efl.evas_object_pass_events_set(_num, true);
                Efl.evas_object_show(_num);
                for (int i = 0; i < _icons.Length; i++)
                {
                    IntPtr img = Efl.evas_object_image_add(evas);
                    Efl.evas_object_image_file_set(img, Path.Combine(_assets, "vol_icon_" + i + ".png"), null);
                    if (Efl.evas_object_image_load_error_get(img) != Efl.EvasLoadErrorNone) _log("volume: asset missing vol_icon_" + i);
                    Efl.evas_object_image_filled_set(img, true);
                    Efl.evas_object_image_smooth_scale_set(img, true);
                    Efl.evas_object_move(img, _p.IconX - ox, _p.IconY - oy);
                    Efl.evas_object_resize(img, VolumePlacement.IconSize, VolumePlacement.IconSize);
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
            _muted = muted;
            _fillLength = VolumeModel.FillHeight(volume, muted, _p.Vertical ? _p.TrackH : _p.TrackW);
            int ox = _p.WinX, oy = _p.WinY;
            if (_fillLength > 0)
            {
                if (_p.Vertical)
                {
                    Efl.evas_object_move(_clip, _p.TrackX - ox, _p.TrackY + _p.TrackH - _fillLength - oy);
                    Efl.evas_object_resize(_clip, _p.TrackW, _fillLength);
                }
                else
                {
                    Efl.evas_object_move(_clip, _p.TrackX - ox, _p.TrackY - oy);
                    Efl.evas_object_resize(_clip, _fillLength, _p.TrackH);
                }
            }
            _iconLevel = VolumeModel.IconLevel(volume, muted);
            Efl.evas_object_text_text_set(_num, muted ? "\u2014" : volume.ToString());
            int w = Efl.evas_object_text_horiz_advance_get(_num), h = Efl.evas_object_text_vert_advance_get(_num);
            int nx = _p.Vertical ? _p.NumberCenterX - w / 2 : _p.NumberRight - w;
            Efl.evas_object_move(_num, nx - ox, _p.NumberCenterY - h / 2 - oy);
        }

        private void Apply(double a)
        {
            Tint(_rim, 0xFFFFFF, Design.ShellBorderAlpha * a);
            Tint(_body, Design.ShellColor, Design.VolumeAlpha * a);
            Tint(_track, 0xFFFFFF, 0.16 * a);
            if (_fillLength > 0) { Tint(_fill, Design.LightColor, a); Efl.evas_object_show(_fill); }
            else Efl.evas_object_hide(_fill);
            Tint(_num, 0xFFFFFF, (_muted ? 0.55 : 0.95) * a);
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
