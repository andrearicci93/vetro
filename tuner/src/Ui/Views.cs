using System;
using Tuner.Core;
using Tuner.Native;

namespace Tuner.Ui
{
    /// <summary>
    /// The channel banner, bottom left: number, name, and under them what is on air: title, start-end times, time left and a progress
    /// bar. The card always has the same size, so nothing jumps when the programme arrives; until it does the rows are empty
    /// (the bar shows its track), and if the daemon has none the title row says so quietly.
    /// </summary>
    internal sealed class BannerView
    {
        private const int X = 96, W = 780, Pad = 36, H = 204, Bottom = 1000, Y = Bottom - H;
        private readonly Surface _s;
        private readonly IntPtr _num, _name, _title, _times, _left;
        private readonly Chip _track, _fill;
        private int _numW;

        public BannerView(Surface s)
        {
            _s = s;
            s.Card().SetRect(X, Y, W, H);
            _num = s.Text(56, Theme.TextMain);
            _name = s.Text(40, Theme.TextMain);
            _title = s.Text(30, Theme.TextMain);
            _times = s.Text(26, Theme.TextMuted);
            _left = s.Text(26, Theme.TextMuted);
            _track = s.Chip();
            _fill = s.Chip();
            Efl.evas_object_move(_num, X + Pad, Y + 22);
            Efl.evas_object_move(_title, X + Pad, Y + 84);
            Efl.evas_object_move(_times, X + Pad, Y + 126);
            _track.SetRect(X + Pad, Y + H - 30, W - 2 * Pad, 6);
        }

        public bool Visible { get { return _s.Visible; } }
        public void Hide() { _s.Hide(); }

        /// <summary>The channel; the programme rows are emptied until <see cref="SetProgram"/> or <see cref="SetNoProgram"/> fills them.</summary>
        public void ShowChannel(string number, string name)
        {
            Efl.evas_object_text_text_set(_num, number);
            _numW = Efl.evas_object_text_horiz_advance_get(_num);
            Surface.SetFitted(_name, name, W - 2 * Pad - Math.Max(110, _numW + 30) - 4);
            Efl.evas_object_move(_name, X + Pad + Math.Max(110, _numW + 30), Y + 32);
            Efl.evas_object_text_text_set(_title, "");
            Efl.evas_object_text_text_set(_times, "");
            Efl.evas_object_text_text_set(_left, "");
            Tint(_title, Theme.TextMain);
            _track.SetWhite(40);
            _fill.SetWhite(0);
            _s.Show();
        }

        private static void Tint(IntPtr t, int a) { Efl.evas_object_color_set(t, a, a, a, a); }

        /// <summary>Title (may be empty), times, time left and progress (0..1) of the programme on air on this channel.</summary>
        public void SetProgram(string title, string range, string left, double fraction)
        {
            Tint(_title, Theme.TextMain);
            Surface.SetFitted(_title, title, W - 2 * Pad);
            Efl.evas_object_text_text_set(_times, range);
            Efl.evas_object_text_text_set(_left, left);
            Efl.evas_object_move(_left, X + W - Pad - Efl.evas_object_text_horiz_advance_get(_left), Y + 126);
            int barW = W - 2 * Pad;
            _track.SetWhite(56);
            _fill.SetRect(X + Pad, Y + H - 30, Math.Max(12, (int)(barW * Math.Max(0, Math.Min(1, fraction)))), 6);
            _fill.SetWhite(235);
        }

        public void SetNoProgram()
        {
            Tint(_title, Theme.TextFaint);
            Efl.evas_object_text_text_set(_title, "No programme information");
            Efl.evas_object_text_text_set(_times, "");
            Efl.evas_object_text_text_set(_left, "");
            _track.SetWhite(40);
            _fill.SetWhite(0);
        }
    }

    /// <summary>The channel list (OK), right side: twelve rows around the selection.</summary>
    internal sealed class ListView
    {
        public const int Rows = 11, RowH = 64, X = 1296, Y = 110, W = 540, Pad = 24;
        private readonly Surface _s;
        private readonly Chip _fill, _ring;
        private readonly IntPtr[] _num = new IntPtr[Rows], _name = new IntPtr[Rows];

        public ListView(Surface s)
        {
            _s = s;
            s.Card().SetRect(X, Y, W, Rows * RowH + 2 * Pad);
            _fill = s.Chip(); _ring = s.Ring();
            for (int i = 0; i < Rows; i++) { _num[i] = s.Text(32, Theme.TextMuted); _name[i] = s.Text(32, Theme.TextMain); }
        }

        public bool Visible { get { return _s.Visible; } }
        public void Hide() { _s.Hide(); }

        public void Draw(ChannelList list, int selected)
        {
            int top = Math.Max(0, Math.Min(selected - Rows / 2, list.Count - Rows));
            for (int r = 0; r < Rows; r++)
            {
                int idx = top + r;
                if (idx >= list.Count) { Efl.evas_object_hide(_num[r]); Efl.evas_object_hide(_name[r]); continue; }
                Efl.evas_object_show(_num[r]); Efl.evas_object_show(_name[r]);
                Channel c = list[idx];
                int y = Y + Pad + r * RowH;
                bool sel = idx == selected;
                if (sel) { _fill.SetRect(X + 16, y + 2, W - 32, RowH - 4); _fill.SetWhite(44); _ring.SetRect(X + 16, y + 2, W - 32, RowH - 4); _ring.SetWhite(255); }
                Efl.evas_object_text_text_set(_num[r], c.Major.ToString());
                Efl.evas_object_color_set(_num[r], sel ? 255 : Theme.TextMuted, sel ? 255 : Theme.TextMuted, sel ? 255 : Theme.TextMuted, sel ? 255 : Theme.TextMuted);
                Surface.SetFitted(_name[r], c.Name, W - 150 - 40);
                Efl.evas_object_move(_num[r], X + 44, y + 10);
                Efl.evas_object_move(_name[r], X + 150, y + 10);
            }
            _s.Show();
        }
    }

    /// <summary>The on-screen number pad (the remote has no digit keys): what is typed, the name of that channel, and a 4x3 grid.</summary>
    internal sealed class PadView
    {
        private const int X = 1296, Y = 110, W = 540, Pad = 38, KeyW = 148, KeyH = 76, Gap = 14, GridY = 232, H = 232 + 4 * 76 + 3 * 14 + 38;
        private readonly Surface _s;
        private readonly IntPtr _title, _typed, _preview;
        private readonly Chip[] _key = new Chip[NumberEntry.Rows * NumberEntry.Cols];
        private readonly IntPtr[] _label = new IntPtr[NumberEntry.Rows * NumberEntry.Cols];
        private readonly Chip _ring;

        public PadView(Surface s)
        {
            _s = s;
            s.Card().SetRect(X, Y, W, H);
            _title = s.Text(26, Theme.TextMuted);
            Efl.evas_object_text_text_set(_title, "Channel number");
            Efl.evas_object_move(_title, X + Pad, Y + 30);
            _typed = s.Text(76, Theme.TextMain);
            Efl.evas_object_move(_typed, X + Pad, Y + 62);
            _preview = s.Text(28, Theme.TextMuted);
            Efl.evas_object_move(_preview, X + Pad, Y + 166);
            for (int i = 0; i < _key.Length; i++)
            {
                int r = i / NumberEntry.Cols, c = i % NumberEntry.Cols;
                _key[i] = s.Chip();
                _key[i].SetRect(Left(c), Top(r), KeyW, KeyH);
            }
            _ring = s.Ring();
            for (int i = 0; i < _label.Length; i++)
            {
                string t = NumberEntry.Label(i / NumberEntry.Cols, i % NumberEntry.Cols);
                _label[i] = s.Text(t.Length > 1 ? 28 : 40, Theme.TextMain);
                Efl.evas_object_text_text_set(_label[i], t);
                int r = i / NumberEntry.Cols, c = i % NumberEntry.Cols;
                Efl.evas_object_move(_label[i], Left(c) + (KeyW - Efl.evas_object_text_horiz_advance_get(_label[i])) / 2, Top(r) + (t.Length > 1 ? 20 : 12));
            }
        }

        private static int Left(int col) { return X + Pad + col * (KeyW + Gap); }
        private static int Top(int row) { return Y + GridY + row * (KeyH + Gap); }

        public bool Visible { get { return _s.Visible; } }
        public void Hide() { _s.Hide(); }

        /// <summary>Redraws the pad. <paramref name="preview"/> is the name of the channel the typed number would go to ("" for none).</summary>
        public void Draw(NumberEntry e, string preview)
        {
            Efl.evas_object_text_text_set(_typed, e.Text.Length > 0 ? e.Text : "–");
            Efl.evas_object_text_text_set(_preview, preview);
            for (int i = 0; i < _key.Length; i++)
                _key[i].SetWhite(i == e.Row * NumberEntry.Cols + e.Col ? 56 : 24);
            _ring.SetRect(Left(e.Col), Top(e.Row), KeyW, KeyH);
            _ring.SetWhite(255);
            _s.Show();
        }
    }

    /// <summary>A one-line message, top right ("Audio: English").</summary>
    internal sealed class ToastView
    {
        private const int Pad = 32, H = 72, Right = 1920 - 96, Y = 80;
        private readonly Surface _s;
        private readonly Card _card;
        private readonly IntPtr _text;

        public ToastView(Surface s) { _s = s; _card = s.Card(); _text = s.Text(32, Theme.TextMain); }

        public bool Visible { get { return _s.Visible; } }
        public void Hide() { _s.Hide(); }

        public void Show(string text)
        {
            Efl.evas_object_text_text_set(_text, text);
            int w = Efl.evas_object_text_horiz_advance_get(_text) + 2 * Pad;
            _card.SetRect(Right - w, Y, w, H);
            Efl.evas_object_move(_text, Right - w + Pad, Y + 14);
            _s.Show();
        }
    }
}
