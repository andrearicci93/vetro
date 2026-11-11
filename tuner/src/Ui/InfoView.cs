using System;
using System.Collections.Generic;
using Tuner.Core;
using Tuner.Native;

namespace Tuner.Ui
{
    /// <summary>
    /// The info panel (Info key, or "info" on the control pipe): the Banner's corner grown up and to the right, on the veil (no card), in a block
    /// x 96..1296. Left column (96..936): the channel number and name, the logo at the right end of the block, the programme on air in large, its
    /// progress row and what it is about (up to three lines). Right column, right-aligned to 1296: the clock, the date, the tuner and the audio
    /// track. Every text has the halo. Pooled: nothing is created after the constructor. Replaces what Samsung's tuner draws in the same place.
    /// </summary>
    internal sealed class InfoView : IStage
    {
        public const int DescriptionLines = 3;
        private const int X0 = 96, Right = 1296, Col = 936, LogoSize = 72, LogoX = Right - LogoSize, LogoY = 584, LogoGap = 32, NumGap = 20;
        private const int NumSize = 64, NameSize = 36, NameTop = 606, TitleSize = 72, TitleTop = 672, NoneSize = 56, NoneTop = 684;
        private const int TimesTop = 780, LineY = 826, DescSize = 30, DescTop = 866, LineH = 42;
        private const int ClockSize = 88, ClockTop = 776, ClockRight = Right + 4, SideSize = 26, DateTop = 878, SourceTop = 918, AudioTop = 958;
        private readonly Surface _s;
        private readonly Veil _veil;
        private readonly IntPtr _num, _name, _title, _none, _clock, _date, _source, _audio, _probe;
        private readonly IntPtr[] _desc = new IntPtr[DescriptionLines];
        private readonly ProgressView _progress;
        private readonly Logo _logo;

        public InfoView(Surface s, Veil veil)
        {
            _s = s; _veil = veil;
            _logo = s.Logo();
            _num = s.HaloText(NumSize, Theme.TextMain, Theme.Font200);
            _name = s.HaloText(NameSize, Theme.VeilMuted, Theme.Font600);
            _title = s.HaloText(TitleSize, Theme.TextMain, Theme.Font600);
            _none = s.HaloText(NoneSize, Theme.VeilFaint, Theme.Font600);
            _progress = new ProgressView(s);
            _clock = s.HaloText(ClockSize, Theme.TextMain, Theme.Font200);
            _date = s.HaloText(SideSize, Theme.VeilMuted, Theme.Font500);
            _source = s.HaloText(SideSize, Theme.VeilMuted, Theme.Font500);
            _audio = s.HaloText(SideSize, Theme.VeilMuted, Theme.Font500);
            _probe = s.Text(DescSize, 0, Theme.Font500);                     // measures the description, never seen
            for (int i = 0; i < _desc.Length; i++)
            {
                _desc[i] = s.HaloText(DescSize, Theme.VeilMuted, Theme.Font500);
                Theme.MoveHalo(_desc[i], X0, Theme.TopOf(DescTop + i * LineH, DescSize, Theme.HaloPad));
            }
            Theme.MoveHalo(_title, X0, Theme.TopOf(TitleTop, TitleSize, Theme.HaloPad));
            Theme.MoveHalo(_none, X0, Theme.TopOf(NoneTop, NoneSize, Theme.HaloPad));
            _parts["num"] = new Part(_num, NumSize, true); _parts["name"] = new Part(_name, NameSize, true);
            _parts["title"] = new Part(_title, TitleSize, true); _parts["none"] = new Part(_none, NoneSize, true);
            _parts["logo"] = new Part(_logo.Obj, 0, false);
            _progress.AddParts(_parts);
            _parts["clock"] = new Part(_clock, ClockSize, true); _parts["date"] = new Part(_date, SideSize, true);
            _parts["source"] = new Part(_source, SideSize, true); _parts["audio"] = new Part(_audio, SideSize, true);
            for (int i = 0; i < _desc.Length; i++) _parts["desc" + i] = new Part(_desc[i], DescSize, true);
        }

        private readonly Dictionary<string, Part> _parts = new Dictionary<string, Part>();
        public Surface Surface { get { return _s; } }
        public IEnumerable<KeyValuePair<string, Part>> Parts { get { return _parts; } }
        public bool GroupFade { get { return false; } }

        public bool Visible { get { return _s.Visible; } }
        public void Hide() { _s.Hide(); _veil.SetInfo(false); }

        private int Measure(string s) { Efl.evas_object_text_text_set(_probe, s); return Efl.evas_object_text_horiz_advance_get(_probe); }

        /// <summary>A text whose right edge is at <paramref name="right"/>, on the baseline of the mock-up's line-box top <paramref name="top"/>.</summary>
        private static void RightAt(IntPtr t, string s, int right, int top, int size)
        {
            Efl.evas_object_text_text_set(t, s);
            Theme.MoveHalo(t, right - Efl.evas_object_text_horiz_advance_get(t), Theme.TopOf(top, size, Theme.HaloPad));
        }

        public void Draw(InfoData d)
        {
            Efl.evas_object_text_text_set(_num, d.Number);
            int nameX = X0 + Efl.evas_object_text_horiz_advance_get(_num) + NumGap;
            Surface.SetFitted(_name, d.Name, (d.LogoRoom ? LogoX - LogoGap : Right) - nameX);
            Theme.MoveHalo(_name, nameX, Theme.TopOf(NameTop, NameSize, Theme.HaloPad));
            Theme.MoveHalo(_num, X0, Theme.TopFor(Theme.Baseline(NameTop, NameSize), NumSize, Theme.HaloPad));   // the number stands on the name's baseline
            if (d.Logo != null) _logo.Show(d.Logo, LogoX, LogoY, LogoSize); else _logo.Hide();
            if (d.NoProgram) { Efl.evas_object_text_text_set(_title, ""); Surface.SetFitted(_none, "No programme information", Right - X0); Efl.evas_object_show(_none); }
            else { Efl.evas_object_hide(_none); Surface.SetFitted(_title, d.Title, Right - X0); }
            if (d.Fraction == null) _progress.Clear();
            else _progress.Set(X0, Col, TimesTop, LineY, d.Start, d.End, d.Left, d.Fraction.Value);
            RightAt(_clock, d.Clock, ClockRight, ClockTop, ClockSize);
            RightAt(_date, d.Date, Right, DateTop, SideSize);
            RightAt(_source, d.Source, Right, SourceTop, SideSize);
            RightAt(_audio, d.Audio.Length > 0 ? "Audio: " + d.Audio : "", Right, AudioTop, SideSize);
            var lines = InfoText.Wrap(d.Description, Col - X0, DescriptionLines, Measure);
            for (int i = 0; i < _desc.Length; i++) Efl.evas_object_text_text_set(_desc[i], i < lines.Count ? lines[i] : "");
            _veil.SetInfo(true);
            _s.Show();
        }
    }
}
