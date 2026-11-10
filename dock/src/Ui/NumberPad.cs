using System;
using System.IO;
using System.Runtime.InteropServices;
using Launcher.Core;
using Launcher.Native;

namespace Launcher.Ui
{
    /// <summary>
    /// The 123 pad, after Samsung's two pages but as one slim glass capsule at the foot of the screen: the digits page
    /// (1-9, 0, dash, backspace, a way to the colour page, a "Done" chip above and the typed number) and the colour page
    /// (back, A B C D, teletext, timer, info, with the name of the focused key above it).
    /// It takes the keyboard focus while it is open (Left/Right/Up/Down/OK/Back), so the app underneath does not see
    /// those keys; "Done" or a function key closes it, gives the focus back and then sends the keys to that app.
    /// Same material as the dock and the volume pill (Fumé): dark smoked body, thin light edge, an ice-white focus capsule that slides.
    /// </summary>
    internal sealed class NumberPad
    {
        private const int WinW = 1100, WinH = 200, EdgeGap = 64;
        private const int BodyY = 92, BodyH = 96, CellY = BodyY + 12, CellH = 72, ChipY = 28, ChipH = 52;
        private const int NotificationLevelTop = 40, WindowLayer = 900;
        private const string Font = "SamsungOneUI 500,Sans";
        private const double FadeSeconds = 0.12, IdleSeconds = 14, SlideRate = 18;
        // While the pad is open this file exists (touched on every key). The tuner reads the remote straight from the input device, so it
        // sees the arrows and OK too; it ignores the keys while the file is fresh, or Left/Right would also cycle its audio and open its channel pad.
        private const string OpenFlag = "/tmp/vetro-numpad.open";

        private sealed class Slot { public IntPtr Text, Icon, Dot; public int X; }

        private readonly string _assets;
        private readonly Action<string> _log;
        private readonly Action<PadResult, string> _send;
        private readonly int _screenW, _screenH;
        private readonly NumberPadModel _model = new NumberPadModel();
        private IntPtr _win, _rim, _body, _focus, _typed, _doneBg, _doneText, _tipBg, _tipText;
        private readonly Slot[][] _slots = new Slot[2][];
        private IntPtr _animator, _idle;
        private readonly Efl.TaskCb _tick, _idleCb;
        private readonly Efl.EvasCb _keyCb;
        private bool _built, _failed, _shown, _closing;
        private double _fade, _lastFrame, _focusX;
        private int _bodyX, _bodyW, _doneX, _doneW, _shownPage = -1;

        public NumberPad(string assets, Action<string> log, int screenW, int screenH, Action<PadResult, string> send)
        {
            _assets = assets; _log = log; _screenW = screenW; _screenH = screenH; _send = send;
            _tick = Tick; _idleCb = OnIdle; _keyCb = OnKey;
        }

        public bool IsShown { get { return _shown && !_closing; } }

        public void Toggle() { if (IsShown) Close(); else Open(); }

        public void Open()
        {
            if (!Build()) return;
            _model.Reset();
            _closing = false;
            LayoutPage(true);
            _focusX = _slots[_model.Page][_model.Focus].X;
            Refresh();
            if (!_shown) { _shown = true; _fade = 0; _lastFrame = Efl.ecore_time_get(); Apply(); Efl.evas_object_show(_win); }
            Efl.elm_win_activate(_win);
            ArmIdle();
            if (_animator == IntPtr.Zero) _animator = Efl.ecore_animator_add(_tick, IntPtr.Zero);
        }

        public void Close()
        {
            if (!_shown || _closing) return;
            _closing = true;
            DisarmIdle();
            if (_animator == IntPtr.Zero) _animator = Efl.ecore_animator_add(_tick, IntPtr.Zero);
        }

        // ------------------------------------------------------------------ build

        private bool Build()
        {
            if (_built) return true;
            if (_failed) return false;
            try
            {
                _win = Efl.elm_win_add(IntPtr.Zero, "vetro-numpad", Efl.ElmWinNotification);
                if (_win == IntPtr.Zero) { _failed = true; _log("pad: elm_win_add failed"); return false; }
                Efl.elm_win_title_set(_win, "vetro-numpad");
                Efl.elm_win_alpha_set(_win, true);
                Efl.elm_win_borderless_set(_win, true);
                Efl.elm_win_prop_focus_skip_set(_win, false);
                Efl.efl_util_set_notification_window_level(_win, NotificationLevelTop);
                Efl.elm_win_layer_set(_win, WindowLayer);
                Efl.elm_win_aux_hint_add(_win, "wm.policy.win.user.geometry", "1");
                Efl.elm_win_aux_hint_add(_win, "wm.comp.win.effect.enable", "0");
                Efl.evas_object_move(_win, (_screenW - WinW) / 2, _screenH - WinH - EdgeGap);
                Efl.evas_object_resize(_win, WinW, WinH);
                IntPtr evas = Efl.evas_object_evas_get(_win);
                _rim = Image(evas, "pill_rim", 50);
                _body = Image(evas, "pill_bg", 48);
                _focus = Image(evas, "pill_cap", 36);
                _doneBg = Image(evas, "pill_chip", 26);
                _tipBg = Image(evas, "pill_chip", 26);
                for (int p = 0; p < 2; p++)
                {
                    PadCell[] row = p == 0 ? NumberPadModel.Digits : NumberPadModel.Colors;
                    _slots[p] = new Slot[row.Length];
                    for (int i = 0; i < row.Length; i++)
                    {
                        PadCell c = row[i];
                        var s = new Slot();
                        if (c.Kind == CellKind.Key && c.Label != null && c.Color != 0) s.Dot = Image(evas, "pill_cap", 0);
                        if (c.Icon != null) s.Icon = Image(evas, c.Icon, 0);
                        if (c.Label != null) s.Text = Text(evas, c.Label, c.Kind == CellKind.Digit ? 36 : 30);
                        _slots[p][i] = s;
                    }
                }
                _doneText = Text(evas, "Done", 26);
                _tipText = Text(evas, "", 26);
                _typed = Text(evas, "", 68);
                Efl.evas_object_event_callback_add(_win, Efl.EvasCallbackKeyDown, _keyCb, IntPtr.Zero);
                _built = true;
                _log("pad: ready");
                return true;
            }
            catch (Exception ex) { _failed = true; _log("pad: " + ex.Message); return false; }
        }

        private IntPtr Image(IntPtr evas, string name, int border)
        {
            IntPtr img = Efl.evas_object_image_add(evas);
            Efl.evas_object_image_file_set(img, Path.Combine(_assets, name + ".png"), null);
            if (Efl.evas_object_image_load_error_get(img) != Efl.EvasLoadErrorNone) _log("pad: asset missing " + name);
            Efl.evas_object_image_filled_set(img, true);
            if (border > 0)
            {
                Efl.evas_object_image_border_set(img, border, border, border, border);
                Efl.evas_object_image_border_center_fill_set(img, 1);
            }
            Efl.evas_object_image_smooth_scale_set(img, true);
            Efl.evas_object_show(img);
            return img;
        }

        private IntPtr Text(IntPtr evas, string text, int size)
        {
            IntPtr t = Efl.evas_object_text_add(evas);
            Efl.evas_object_text_font_set(t, Font, size);
            Efl.evas_object_text_text_set(t, text);
            Efl.evas_object_show(t);
            return t;
        }

        // ------------------------------------------------------------------ layout

        private static void CenterText(IntPtr t, int cx, int cy)
        {
            int w = Efl.evas_object_text_horiz_advance_get(t), h = Efl.evas_object_text_vert_advance_get(t);
            Efl.evas_object_move(t, cx - w / 2, cy - h / 2);
        }

        /// <summary>Puts the cells of the current page in place, hides the other page and sizes the capsule to the row.</summary>
        private void LayoutPage(bool force)
        {
            int page = _model.Page;
            if (!force && page == _shownPage) return;
            _shownPage = page;
            PadCell[] row = _model.Row;
            _bodyW = NumberPadModel.BodyWidth(row);
            _bodyX = (WinW - _bodyW) / 2;
            Efl.evas_object_move(_rim, _bodyX - 2, BodyY - 2); Efl.evas_object_resize(_rim, _bodyW + 4, BodyH + 4);
            Efl.evas_object_move(_body, _bodyX, BodyY); Efl.evas_object_resize(_body, _bodyW, BodyH);
            for (int p = 0; p < 2; p++)
                for (int i = 0; i < _slots[p].Length; i++)
                {
                    Slot s = _slots[p][i];
                    if (s.Dot != IntPtr.Zero) SetShown(s.Dot, p == page);
                    if (s.Icon != IntPtr.Zero) SetShown(s.Icon, p == page);
                    if (s.Text != IntPtr.Zero) SetShown(s.Text, p == page);
                }
            int x = _bodyX + 24;
            for (int i = 0; i < row.Length; i++)
            {
                PadCell c = row[i]; Slot s = _slots[page][i];
                x += c.Gap; s.X = x;
                int cx = x + c.Width / 2, cy = CellY + CellH / 2;
                if (s.Dot != IntPtr.Zero) { Efl.evas_object_move(s.Dot, cx - 22, cy - 22); Efl.evas_object_resize(s.Dot, 44, 44); }
                if (c.Kind == CellKind.ToDigits)
                {
                    Efl.evas_object_move(s.Icon, x + 14, cy - 14); Efl.evas_object_resize(s.Icon, 28, 28);
                    int tw = Efl.evas_object_text_horiz_advance_get(s.Text), th = Efl.evas_object_text_vert_advance_get(s.Text);
                    Efl.evas_object_move(s.Text, x + 44 + (c.Width - 44 - 14 - tw) / 2, cy - th / 2);
                }
                else
                {
                    if (s.Icon != IntPtr.Zero) { Efl.evas_object_move(s.Icon, cx - 20, cy - 20); Efl.evas_object_resize(s.Icon, 40, 40); }
                    if (s.Text != IntPtr.Zero) CenterText(s.Text, cx, cy);
                }
                x += c.Width;
            }
            Efl.evas_object_move(_typed, _bodyX + 12, 8);
            _doneW = Efl.evas_object_text_horiz_advance_get(_doneText) + 56;
            _doneX = _bodyX + _bodyW - _doneW;
            Efl.evas_object_move(_doneBg, _doneX, ChipY); Efl.evas_object_resize(_doneBg, _doneW, ChipH);
            CenterText(_doneText, _doneX + _doneW / 2, ChipY + ChipH / 2);
            SetShown(_doneBg, page == NumberPadModel.DigitsPage); SetShown(_doneText, page == NumberPadModel.DigitsPage);
        }

        private static void SetShown(IntPtr obj, bool on) { if (on) Efl.evas_object_show(obj); else Efl.evas_object_hide(obj); }

        /// <summary>After a key: the typed number, the focus capsule's size, the tooltip.</summary>
        private void Refresh()
        {
            LayoutPage(false);
            Efl.evas_object_text_text_set(_typed, _model.Typed);
            PadCell c = _model.Current;
            if (c != null) Efl.evas_object_resize(_focus, c.Width, CellH);
            bool tip = c != null && c.Tip != null && _model.Page == NumberPadModel.ColorsPage;
            SetShown(_tipBg, tip); SetShown(_tipText, tip);
            if (tip)
            {
                Efl.evas_object_text_text_set(_tipText, c.Tip);
                int w = Efl.evas_object_text_horiz_advance_get(_tipText) + 44;
                int cx = _slots[_model.Page][_model.Focus].X + c.Width / 2;
                int x = Math.Max(_bodyX, Math.Min(_bodyX + _bodyW - w, cx - w / 2));
                Efl.evas_object_move(_tipBg, x, ChipY); Efl.evas_object_resize(_tipBg, w, ChipH);
                CenterText(_tipText, x + w / 2, ChipY + ChipH / 2);
            }
        }

        // ------------------------------------------------------------------ drawing

        private static void Tint(IntPtr obj, int rgb, double alpha)
        {
            int a = (int)Math.Round(Math.Max(0, Math.Min(1, alpha)) * 255);
            Efl.evas_object_color_set(obj, ((rgb >> 16) & 255) * a / 255, ((rgb >> 8) & 255) * a / 255, (rgb & 255) * a / 255, a);
        }

        private void Apply()
        {
            double a = _fade;
            bool onDone = _model.OnDone;
            Tint(_rim, 0xFFFFFF, Design.ShellBorderAlpha * a);
            Tint(_body, Design.ShellColor, Design.VolumeAlpha * a);
            Tint(_focus, Design.RingColor, (onDone ? 0 : 0.96) * a);
            Efl.evas_object_move(_focus, (int)Math.Round(_focusX), CellY);
            Tint(_typed, 0xFFFFFF, a);
            Tint(_doneBg, onDone ? Design.RingColor : Design.ShellColor, (onDone ? 0.96 : Design.VolumeAlpha) * a);
            Tint(_doneText, onDone ? Design.ShellColor : 0xFFFFFF, a);
            Tint(_tipBg, Design.ShellColor, 0.92 * a);
            Tint(_tipText, 0xFFFFFF, a);
            PadCell[] row = _model.Row;
            for (int i = 0; i < row.Length; i++)
            {
                PadCell c = row[i]; Slot s = _slots[_model.Page][i];
                bool f = !onDone && i == _model.Focus;
                int ink = f && c.Color == 0 ? Design.ShellColor : 0xFFFFFF;
                double al = (f ? 1.0 : 0.92) * a;
                if (s.Dot != IntPtr.Zero) Tint(s.Dot, c.Color, a);
                if (s.Icon != IntPtr.Zero) Tint(s.Icon, ink, al);
                if (s.Text != IntPtr.Zero) Tint(s.Text, ink, al);
            }
        }

        private byte Tick(IntPtr data)
        {
            try
            {
                double now = Efl.ecore_time_get(), dt = Math.Min(0.05, Math.Max(0, now - _lastFrame));
                _lastFrame = now;
                _fade = _closing ? _fade - dt / FadeSeconds : Math.Min(1, _fade + dt / FadeSeconds);
                if (_closing && _fade <= 0)
                {
                    _fade = 0; Efl.evas_object_hide(_win);
                    _shown = false; _closing = false; _animator = IntPtr.Zero;
                    MarkOpen(false);
                    return 0;
                }
                if (!_model.OnDone)
                {
                    double target = _slots[_model.Page][_model.Focus].X;
                    _focusX += (target - _focusX) * Math.Min(1, dt * SlideRate);
                    if (Math.Abs(target - _focusX) < 0.5) _focusX = target;
                }
                Apply();
                return 1;
            }
            catch (Exception ex) { _log("pad tick: " + ex.Message); _animator = IntPtr.Zero; _shown = false; _closing = false; Efl.evas_object_hide(_win); MarkOpen(false); return 0; }
        }

        private void OnKey(IntPtr data, IntPtr evas, IntPtr obj, IntPtr eventInfo)
        {
            try
            {
                string key = Marshal.PtrToStringAnsi(Marshal.ReadIntPtr(eventInfo));
                if (!IsShown) return;
                ArmIdle();
                PadResult r = _model.Key(key);
                switch (r)
                {
                    case PadResult.Close: Close(); break;
                    case PadResult.Send: { string typed = _model.Typed; Close(); _send(r, typed); break; }
                    case PadResult.SendKey: { string k = _model.PendingKey; Close(); _send(r, k); break; }
                    case PadResult.None: break;
                    default:
                        // A move onto the other page starts the focus capsule at the cell it lands on.
                        if (r == PadResult.Page) { LayoutPage(false); _focusX = _slots[_model.Page][_model.Focus].X; }
                        Refresh();
                        break;
                }
            }
            catch (Exception ex) { _log("pad key: " + ex.Message); }
        }

        private void MarkOpen(bool on)
        {
            try { if (on) File.WriteAllText(OpenFlag, "1"); else if (File.Exists(OpenFlag)) File.Delete(OpenFlag); }
            catch (Exception ex) { _log("pad flag: " + ex.Message); }
        }

        private void ArmIdle() { MarkOpen(true); DisarmIdle(); _idle = Efl.ecore_timer_add(IdleSeconds, _idleCb, IntPtr.Zero); }
        private void DisarmIdle() { if (_idle != IntPtr.Zero) { Efl.ecore_timer_del(_idle); _idle = IntPtr.Zero; } }
        private byte OnIdle(IntPtr data) { _idle = IntPtr.Zero; Close(); return 0; }
    }
}
