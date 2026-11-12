using System;
using System.Collections.Generic;
using Tuner.Core;
using Tuner.Native;

namespace Tuner.Ui
{
    /// <summary>
    /// The progress row of the Banner and Info: start time at the left end of the line, end time right-aligned to its right end, the track
    /// (bar.png, white .22), the progress with its head (progress.png) and "N min left" above the head. Where the label goes and which time gives
    /// way to it is <see cref="ProgressRow"/>. Every text has the halo; a time that gives way goes to alpha 0 with its halo.
    /// </summary>
    internal sealed class ProgressView
    {
        public const int TimeSize = 26, ProgressH = 32, HeadAbove = 13;   // the progress picture is 32 px tall, its line 13 px below its top
        private readonly IntPtr _start, _end, _left, _prog;
        private readonly Chip _track;

        public ProgressView(Surface s)
        {
            _track = s.Bar();
            _prog = s.Progress();
            _start = s.HaloText(TimeSize, Theme.VeilMuted, Theme.Font500);
            _end = s.HaloText(TimeSize, Theme.VeilMuted, Theme.Font500);
            _left = s.HaloText(TimeSize, Theme.TextMain, Theme.Font600);
        }

        /// <summary>The row's parts by the mock-up's names: the times, the label, the track and the progress.</summary>
        public void AddParts(IDictionary<string, Part> to)
        {
            to["tstart"] = new Part(_start, TimeSize, true); to["tend"] = new Part(_end, TimeSize, true); to["tleft"] = new Part(_left, TimeSize, true);
            to["track"] = new Part(_track.Obj, 0, false); to["prog"] = new Part(_prog, 0, false);
        }

        /// <param name="timesTop">The line-box top of the times and the label (the mock-up's y).</param>
        /// <param name="lineY">The top of the 6 px line.</param>
        public void Set(int x0, int x1, int timesTop, int lineY, string start, string end, string left, double fraction)
        {
            int y = Theme.TopOf(timesTop, TimeSize, Theme.HaloPad);
            Efl.evas_object_text_text_set(_start, start);
            Efl.evas_object_text_text_set(_end, end);
            Efl.evas_object_text_text_set(_left, left);
            int startW = Efl.evas_object_text_horiz_advance_get(_start), endW = Efl.evas_object_text_horiz_advance_get(_end);
            int leftW = string.IsNullOrEmpty(left) ? 0 : Efl.evas_object_text_horiz_advance_get(_left);
            ProgressRow r = ProgressRow.Of(x0, x1, fraction, startW, endW, leftW);
            Theme.TintHalo(_start, r.HideStart ? 0 : Theme.VeilMuted);
            Theme.TintHalo(_end, r.HideEnd ? 0 : Theme.VeilMuted);
            Theme.TintHalo(_left, Theme.TextMain);
            Theme.MoveHalo(_start, x0, y);
            Theme.MoveHalo(_end, x1 - endW, y);
            Theme.MoveHalo(_left, r.LeftX, y);
            _track.SetRect(x0, lineY, x1 - x0, 6);
            _track.SetWhite(Theme.RimAlpha);
            Efl.evas_object_move(_prog, x0, lineY - HeadAbove);
            Efl.evas_object_resize(_prog, r.ProgressW, ProgressH);
            Efl.evas_object_show(_prog);
        }

        /// <summary>No programme: no times, no line (an empty line would say "0%").</summary>
        public void Clear()
        {
            Efl.evas_object_text_text_set(_start, "");
            Efl.evas_object_text_text_set(_end, "");
            Efl.evas_object_text_text_set(_left, "");
            _track.SetWhite(0);
            Efl.evas_object_hide(_prog);
        }
    }

    /// <summary>
    /// The channel Banner, in the bottom-left corner on the veil (no card): the big number, the name beside it with the logo at the right end
    /// of the block, under the name what is on air, then the progress row across the block (x 96..936). The number always stands on the baseline of the
    /// second line (the programme, or "No programme information"), also while that line is still empty: nothing moves when the programme arrives.
    /// Until then the second line and the progress row are empty; if the daemon has none the second line says so quietly.
    /// </summary>
    internal sealed class BannerView : IStage
    {
        private const int X0 = 96, X1 = 936, LogoSize = 72, LogoGap = 24, LogoTop = 818, NumGap = 30;
        private const int NumSize = 128, NameSize = 56, NameTop = 822, TitleSize = 32, TitleTop = 890, NoneSize = 30;
        private const int TimesTop = 946, LineY = 992;
        private readonly Surface _s;
        private readonly Veil _veil;
        private readonly IntPtr _num, _name, _title, _none;
        private readonly ProgressView _progress;
        private readonly Logo _logo;
        private int _nameX;
        private string _nameText = "";

        public BannerView(Surface s, Veil veil)
        {
            _s = s; _veil = veil;
            _logo = s.Logo();
            _num = s.HaloText(NumSize, Theme.TextMain, Theme.Font200);
            _name = s.HaloText(NameSize, Theme.TextMain, Theme.Font600);
            _title = s.HaloText(TitleSize, Theme.VeilTitle, Theme.Font500);
            _none = s.HaloText(NoneSize, Theme.VeilFaint, Theme.Font500);
            Efl.evas_object_text_text_set(_none, "No programme information");
            _progress = new ProgressView(s);
            _parts["num"] = new Part(_num, NumSize, true); _parts["name"] = new Part(_name, NameSize, true);
            _parts["title"] = new Part(_title, TitleSize, true); _parts["none"] = new Part(_none, NoneSize, true);
            _parts["logo"] = new Part(_logo.Obj, 0, false);
            _progress.AddParts(_parts);
        }

        private readonly Dictionary<string, Part> _parts = new Dictionary<string, Part>();
        public Surface Surface { get { return _s; } }
        public IEnumerable<KeyValuePair<string, Part>> Parts { get { return _parts; } }
        public bool GroupFade { get { return false; } }

        public bool Visible { get { return _s.Visible; } }
        public void Hide() { _s.Hide(); _veil.SetBanner(false); }

        /// <summary>
        /// The channel; the programme rows are emptied until <see cref="SetProgram"/> or <see cref="SetNoProgram"/> fills them.
        /// <paramref name="room"/> keeps the right end of the name's row for the logo (the TV has logos to show): the name gives way to it, whether or not this channel has one.
        /// </summary>
        public void ShowChannel(string number, string name, string logo = null, bool room = false)
        {
            Efl.evas_object_text_text_set(_num, number);
            _nameX = X0 + Efl.evas_object_text_horiz_advance_get(_num) + NumGap;
            _nameText = name;
            SetLogo(logo, room);
            Efl.evas_object_text_text_set(_title, "");
            Efl.evas_object_hide(_none);
            _progress.Clear();
            PlaceNumber();
            _veil.SetBanner(true);
            _s.Show();
        }

        /// <summary>Puts the logo (file path, or null for none) at the right end of the name's row and fits the name to what is left.</summary>
        public void SetLogo(string logo, bool room)
        {
            Surface.SetFitted(_name, _nameText, (room ? X1 - LogoSize - LogoGap : X1) - _nameX);
            Theme.MoveHalo(_name, _nameX, Theme.TopOf(NameTop, NameSize, Theme.HaloPad));
            if (logo != null) _logo.Show(logo, X1 - LogoSize, LogoTop, LogoSize); else _logo.Hide();
        }

        /// <summary>The number on the baseline of the second line, whether that line is filled or not: the block does not jump when the programme is read.</summary>
        private void PlaceNumber() { Theme.MoveHalo(_num, X0, Theme.TopFor(Theme.Baseline(TitleTop, TitleSize), NumSize, Theme.HaloPad)); }

        /// <summary>Title (may be empty), start and end time, time left and progress (0..1) of the programme on air on this channel.</summary>
        public void SetProgram(string title, string start, string end, string left, double fraction)
        {
            Efl.evas_object_hide(_none);
            Surface.SetFitted(_title, title ?? "", X1 - _nameX);
            Theme.MoveHalo(_title, _nameX, Theme.TopOf(TitleTop, TitleSize, Theme.HaloPad));
            _progress.Set(X0, X1, TimesTop, LineY, start, end, left, fraction);
            PlaceNumber();
        }

        public void SetNoProgram()
        {
            Efl.evas_object_text_text_set(_title, "");
            Surface.SetFitted(_none, "No programme information", X1 - _nameX);
            Theme.MoveHalo(_none, _nameX, Theme.TopFor(Theme.Baseline(TitleTop, TitleSize), NoneSize, Theme.HaloPad));   // on the programme's baseline
            Efl.evas_object_show(_none);
            _progress.Clear();
            PlaceNumber();
        }
    }

    /// <summary>
    /// The channel list (OK), right side, centred on the screen's height: eleven rows around the selection, on a panel of the osd 123's
    /// material (radius 40, no shadow). The selected row is one ice capsule with its number and name in slate; the numbers are right-aligned.
    /// </summary>
    internal sealed class ListView
    {
        public const int Rows = 11, RowH = 64, X = 1284, W = 540, Pad = 24, LogoSize = 44, H = Rows * RowH + 2 * Pad, Y = 540 - H / 2;
        private const int NumRight = X + 92;
        private readonly Surface _s;
        private readonly Chip _focus;
        private readonly IntPtr[] _num = new IntPtr[Rows], _name = new IntPtr[Rows];
        private readonly Logo[] _logo = new Logo[Rows];

        public ListView(Surface s)
        {
            _s = s;
            s.Panel().SetRect(X, Y, W, H, 40);
            _focus = s.Cap();
            for (int i = 0; i < Rows; i++) { _logo[i] = s.Logo(); _num[i] = s.Text(32, Theme.TextMuted); _name[i] = s.Text(32, Theme.TextMain); }
        }

        public bool Visible { get { return _s.Visible; } }
        public void Hide() { _s.Hide(); }

        /// <param name="logo">The logo file of a channel (null for none); <paramref name="room"/> keeps a column for it in every row.</param>
        public void Draw(ChannelList list, int selected, Func<Channel, string> logo = null, bool room = false)
        {
            int top = Math.Max(0, Math.Min(selected - Rows / 2, list.Count - Rows));
            for (int r = 0; r < Rows; r++)
            {
                int idx = top + r;
                if (idx >= list.Count) { Efl.evas_object_hide(_num[r]); Efl.evas_object_hide(_name[r]); _logo[r].Hide(); continue; }
                Efl.evas_object_show(_num[r]); Efl.evas_object_show(_name[r]);
                Channel c = list[idx];
                int y = Y + Pad + r * RowH;
                bool sel = idx == selected;
                if (sel) { _focus.SetRect(X + 16, y + 2, W - 32, RowH - 4); _focus.SetRadius((RowH - 4) / 2); _focus.SetTint(Theme.Ice, Theme.FocusAlpha); }
                Efl.evas_object_text_text_set(_num[r], c.Major.ToString());
                if (sel) Theme.TintText(_num[r], Theme.Slate, 255); else Theme.TintText(_num[r], 0xFFFFFF, Theme.TextMuted);
                if (sel) Theme.TintText(_name[r], Theme.Slate, 255); else Theme.TintText(_name[r], 0xFFFFFF, Theme.TextMain);
                int nameX = room ? X + 172 : X + 150;
                Surface.SetFitted(_name[r], c.Name, X + W - 40 - nameX);
                int ty = Theme.TopForCentre(y, RowH, 32);                         // capitals centred in the row (Evas metrics, not a measured offset)
                Efl.evas_object_move(_num[r], NumRight - Efl.evas_object_text_horiz_advance_get(_num[r]), ty);
                Efl.evas_object_move(_name[r], nameX, ty);
                string file = logo == null ? null : logo(c);
                if (file != null) _logo[r].Show(file, X + 114, y + (RowH - LogoSize) / 2, LogoSize); else _logo[r].Hide();
            }
            _s.Show();
        }
    }

    /// <summary>
    /// The Channel pad (the remote has no digit keys): what is typed, the name of that channel, and a 4x3 grid, on the right, centred on the
    /// screen's height, on a panel of the osd 123's material (radius 40, no shadow). The keys are capsules (white .14); the selected one is the
    /// ice capsule with its label in slate.
    /// </summary>
    internal sealed class PadView
    {
        private const int X = 1284, W = 540, Pad = 34, KeyW = 148, KeyH = 76, Gap = 14, GridY = 232, H = 232 + 4 * 76 + 3 * 14 + 38, Y = 540 - H / 2;
        private readonly Surface _s;
        private readonly IntPtr _title, _typed, _preview;
        private readonly Logo _logo;
        private readonly Chip[] _key = new Chip[NumberEntry.Rows * NumberEntry.Cols];
        private readonly IntPtr[] _label = new IntPtr[NumberEntry.Rows * NumberEntry.Cols];
        private readonly Chip _focus;

        public PadView(Surface s)
        {
            _s = s;
            s.Panel().SetRect(X, Y, W, H, 40);
            _title = s.Text(26, Theme.TextMuted);
            Efl.evas_object_text_text_set(_title, "Channel number");
            Efl.evas_object_move(_title, X + Pad, Y + 30);
            _typed = s.Text(76, Theme.TextMain);
            Efl.evas_object_move(_typed, X + Pad, Y + 62);
            _preview = s.Text(28, Theme.TextMuted);
            _logo = s.Logo();
            Efl.evas_object_move(_preview, X + Pad, Y + 166);
            for (int i = 0; i < _key.Length; i++)
            {
                int r = i / NumberEntry.Cols, c = i % NumberEntry.Cols;
                _key[i] = s.Cap();
                _key[i].SetRect(Left(c), Top(r), KeyW, KeyH);
                _key[i].SetRadius(KeyH / 2);
            }
            _focus = s.Cap();
            _focus.SetRadius(KeyH / 2);
            for (int i = 0; i < _label.Length; i++)
            {
                string t = NumberEntry.Label(i / NumberEntry.Cols, i % NumberEntry.Cols);
                _label[i] = s.Text(t.Length > 1 ? 28 : 40, Theme.TextMain);
                Efl.evas_object_text_text_set(_label[i], t);
                int r = i / NumberEntry.Cols, c = i % NumberEntry.Cols;
                Efl.evas_object_move(_label[i], Left(c) + (KeyW - Efl.evas_object_text_horiz_advance_get(_label[i])) / 2, Theme.TopForCentre(Top(r), KeyH, t.Length > 1 ? 28 : 40));   // capitals and digits centred on the key
            }
        }

        private static int Left(int col) { return X + Pad + col * (KeyW + Gap); }
        private static int Top(int row) { return Y + GridY + row * (KeyH + Gap); }

        public bool Visible { get { return _s.Visible; } }
        public void Hide() { _s.Hide(); }

        /// <summary>Redraws the pad. <paramref name="preview"/> is the name of the channel the typed number would go to ("" for none).</summary>
        public void Draw(NumberEntry e, string preview, string logo = null)
        {
            Efl.evas_object_text_text_set(_typed, e.Text.Length > 0 ? e.Text : "–");
            Surface.SetFitted(_preview, preview, W - 2 * Pad - (logo != null ? 52 : 0));
            Efl.evas_object_move(_preview, X + Pad + (logo != null ? 52 : 0), Y + 166);
            if (logo != null) _logo.Show(logo, X + Pad, Y + 158, 44); else _logo.Hide();
            int focus = e.Row * NumberEntry.Cols + e.Col;
            for (int i = 0; i < _key.Length; i++)
            {
                _key[i].SetWhite(i == focus ? 0 : Theme.KeyAlpha);              // the focus capsule takes the key's place
                if (i == focus) Theme.TintText(_label[i], Theme.Slate, 255); else Theme.TintText(_label[i], 0xFFFFFF, Theme.TextMain);
            }
            _focus.SetRect(Left(e.Col), Top(e.Row), KeyW, KeyH);
            _focus.SetTint(Theme.Ice, Theme.FocusAlpha);
            _s.Show();
        }
    }

    /// <summary>A one-line message, top right ("Audio: English"): the osd 123's capsule (rim and slate body, radius half the height), no shadow.</summary>
    internal sealed class ToastView
    {
        private const int Pad = 40, H = 72, Right = 1920 - 96, Y = 96, Size = 32;
        private readonly Surface _s;
        private readonly Panel _card;
        private readonly IntPtr _text;

        public ToastView(Surface s) { _s = s; _card = s.Panel(); _text = s.Text(Size, Theme.TextMain); }

        public bool Visible { get { return _s.Visible; } }
        public void Hide() { _s.Hide(); }

        public void Show(string text)
        {
            Efl.evas_object_text_text_set(_text, text);
            int w = Efl.evas_object_text_horiz_advance_get(_text) + 2 * Pad;
            _card.SetRect(Right - w, Y, w, H, H / 2);
            Efl.evas_object_move(_text, Right - w + Pad, Theme.TopForCentre(Y, H, Size));   // capitals centred in the capsule
            _s.Show();
        }
    }
}
