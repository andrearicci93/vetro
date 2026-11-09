using System;
using Tuner.Core;
using Tuner.Native;

namespace Tuner.Ui
{
    /// <summary>
    /// The info panel (Info key, or "info" on the control pipe): one card at the top of the screen with the channel number, the programme on
    /// air with its times and progress, what the programme is about (up to three lines), and on the right the clock and date, the tuner
    /// and the audio track. The card always has the same size, so nothing jumps when the text arrives. Pooled: nothing is created
    /// after the constructor. Replaces what Samsung's tuner draws in the same place.
    /// </summary>
    internal sealed class InfoView
    {
        public const int DescriptionLines = 3;
        private const int X = 96, Y = 56, W = 1728, H = 348, Pad = 44, SideW = 380, BadgeSize = 96, LineH = 40, DescTop = 212;
        private readonly Surface _s;
        private readonly IntPtr _num, _title, _name, _times, _left, _clock, _date, _source, _audio, _probe;
        private readonly IntPtr[] _desc = new IntPtr[DescriptionLines];
        private readonly Chip _badge, _track, _fill;
        private readonly int _textX, _textW, _sideX, _descW;

        public InfoView(Surface s)
        {
            _s = s;
            s.Card().SetRect(X, Y, W, H);
            _badge = s.Chip(); _track = s.Bar(); _fill = s.Bar();
            _num = s.Text(44, Theme.TextMain);
            _title = s.Text(44, Theme.TextMain);
            _name = s.Text(30, Theme.TextMuted);
            _times = s.Text(26, Theme.TextMuted);
            _left = s.Text(26, Theme.TextMuted);
            _clock = s.Text(44, Theme.TextMain);
            _date = s.Text(26, Theme.TextMuted);
            _source = s.Text(26, Theme.TextMuted);
            _audio = s.Text(26, Theme.TextMuted);
            _probe = s.Text(30, 0);                                   // measures the description, never seen
            for (int i = 0; i < _desc.Length; i++) _desc[i] = s.Text(30, Theme.TextMuted);
            _textX = X + Pad + BadgeSize + 32;
            _sideX = X + W - Pad - SideW;
            _textW = _sideX - 40 - _textX;
            _descW = W - 2 * Pad;
            _badge.SetRect(X + Pad, Y + 36, BadgeSize, BadgeSize); _badge.SetWhite(51);
            Efl.evas_object_move(_title, _textX, Y + 28);
            Efl.evas_object_move(_name, _textX, Y + 88);
            Efl.evas_object_move(_times, _textX, Y + 130);
            Efl.evas_object_move(_clock, _sideX, Y + 28);
            Efl.evas_object_move(_date, _sideX, Y + 90);
            Efl.evas_object_move(_source, _sideX, Y + 128);
            Efl.evas_object_move(_audio, _sideX, Y + 164);
            for (int i = 0; i < _desc.Length; i++) Efl.evas_object_move(_desc[i], X + Pad, Y + DescTop + i * LineH);
        }

        public bool Visible { get { return _s.Visible; } }
        public void Hide() { _s.Hide(); }

        private static void Tint(IntPtr t, int a) { Efl.evas_object_color_set(t, a, a, a, a); }

        private int Measure(string s) { Efl.evas_object_text_text_set(_probe, s); return Efl.evas_object_text_horiz_advance_get(_probe); }

        public void Draw(InfoData d)
        {
            Efl.evas_object_text_text_set(_num, d.Number);
            Efl.evas_object_move(_num, X + Pad + (BadgeSize - Efl.evas_object_text_horiz_advance_get(_num)) / 2, Y + 36 + 18);
            if (d.NoProgram) { Tint(_title, Theme.TextFaint); Efl.evas_object_text_text_set(_title, "No programme information"); }
            else { Tint(_title, Theme.TextMain); Surface.SetFitted(_title, d.Title, _textW); }
            Surface.SetFitted(_name, d.Name, _textW);
            Efl.evas_object_text_text_set(_times, d.Range);
            int timesW = Efl.evas_object_text_horiz_advance_get(_times);
            if (d.Fraction == null) { _track.SetWhite(0); _fill.SetWhite(0); Efl.evas_object_text_text_set(_left, ""); }
            else
            {
                int barX = _textX + timesW + 24, barW = 260;
                _track.SetRect(barX, Y + 144, barW, 6); _track.SetWhite(56);
                _fill.SetRect(barX, Y + 144, Math.Max(12, (int)(barW * Math.Max(0, Math.Min(1, d.Fraction.Value)))), 6); _fill.SetTint(Theme.Light, 255);
                Efl.evas_object_text_text_set(_left, d.Left);
                Efl.evas_object_move(_left, barX + barW + 24, Y + 130);
            }
            Efl.evas_object_text_text_set(_clock, d.Clock);
            Efl.evas_object_text_text_set(_date, d.Date);
            Efl.evas_object_text_text_set(_source, d.Source);
            Efl.evas_object_text_text_set(_audio, d.Audio.Length > 0 ? "Audio: " + d.Audio : "");
            var lines = InfoText.Wrap(d.Description, _descW, DescriptionLines, Measure);
            for (int i = 0; i < _desc.Length; i++) Efl.evas_object_text_text_set(_desc[i], i < lines.Count ? lines[i] : "");
            _s.Show();
        }
    }
}
