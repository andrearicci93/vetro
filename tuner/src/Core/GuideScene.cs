using System;
using System.Collections.Generic;

namespace Tuner.Core
{
    internal enum PrimKind { Line, Fill, Hatch, Focus, Text, Key, Logo }

    /// <summary>
    /// One thing to draw. Line is a plain rectangle; Fill is a programme's rounded cell (pill.png, radius 20) in white at <see cref="Alpha"/>
    /// (0..255); Hatch is the "no information" stripes (hatch.png tiled); Focus is the focused cell, the same pill in ice; Text is text at
    /// <see cref="Alpha"/> in white, or in <see cref="Tint"/> (opaque) when set; Key is the picture of a remote key (res/key_*.png, its name in
    /// <see cref="Text"/>); Logo is a channel's logo (the file path in <see cref="Text"/>, drawn as a W x H square).
    /// </summary>
    internal struct Prim
    {
        public PrimKind Kind;
        public int X, Y, W, H;         // a text's Y is the top of its line box (line height = font size), as the mock-up gives it
        public int Alpha;
        public int Tint;               // line: colour 0xRRGGBB, 0 for white; text: the ink 0xRRGGBB (drawn opaque), 0 for white at Alpha
        public int Size;               // text: pixel size
        public int Weight;             // text: 200, 500 or 600 (the three weights the TV has)
        public string Text;
        public int MaxW;               // text: width it must fit (ellipsis); with Lines > 1 the width of the paragraph
        public int Lines;              // text: 1 or the number of lines of a wrapped paragraph
        public int LineH;              // text: the pitch of a paragraph's lines
        public bool Right;             // text: X is the right edge
        public string Key;             // text: "num", "name" (the focused row's label) or "title" (the header): what a transition flies to or from
    }

    /// <summary>
    /// The guide as a list of drawing primitives: what the screen shows for a state of the model. The EFL view draws this list onto pooled
    /// objects; the tests check it. Back to front: lines, cells, hatches, the focus, logos, texts, keys.
    /// </summary>
    internal static class GuideScene
    {
        /// <summary>The pools the view makes once: these caps hold for every state (the tests fuzz them).</summary>
        public const int MaxFills = 140, MaxHatches = 21, MaxLines = 3, MaxTexts = 260, MaxLogos = GuideLayout.Rows, LogoSize = 56;

        /// <summary>The texts with a <see cref="Prim.Key"/>: the view keeps one object each, so a transition can hold on to them while the rest is redrawn.</summary>
        public static readonly string[] TextKeys = { "num", "name", "title" };

        /// <summary>The remote key pictures the footer uses (tuner/res, tools/render-remote-keys.cjs). The view keeps one object for each, so a name appears once in a scene.</summary>
        public static readonly string[] KeyNames = { "key_ok", "key_left", "key_right", "key_up", "key_down", "key_ch", "key_back" };
        public const int KeyH = 34, FootSize = 24, KeyAlpha = 217;                       // key height; footer text size; 85% white
        private const int InnerGap = 8, PairGap = 2, GroupGap = 44;                     // key to word, key to key, word to the next group

        /// <summary>White text at 100 / 90 / 76 / 70 / 64 %; the slate ink of a text on the ice focus; the light blue of "now".</summary>
        public const int Main = 255, CellText = 230, Muted = 194, Desc = 179, Faint = 163, Slate = 0x243448, Light = 0xA5D8FF;

        /// <summary>Cells: rest .09, on air .16, loading .05, no information .035 (with the hatch); the focus is ice at .96. Lines: the axis .157, "now" .30.</summary>
        public const int CellRest = 23, CellOnAir = 41, CellLoading = 13, CellNone = 9, FocusAlpha = 245, AxisAlpha = 40, NowAlpha = 77;

        /// <param name="description">The long text of the focused programme, when it has been read (empty otherwise).</param>
        /// <param name="logo">The logo file of a channel (null for none). Passing it at all (even if every answer is null) keeps a column for the logos
        /// in the channel label; without it the number and the name start at the column's left.</param>
        /// <param name="measure">The width of a text (text, size, weight) in pixels, for the footer's words; an estimate (half an em a letter) without it.</param>
        public static List<Prim> Build(GuideGrid g, long now, TimeSpan offset, string description, Func<Channel, string> logo = null, Func<string, int, int, int> measure = null)
        {
            measure = measure ?? ((s, size, weight) => s.Length * size / 2);
            var lines = new List<Prim>(); var fills = new List<Prim>(); var hatches = new List<Prim>(); var focus = new List<Prim>();
            var texts = new List<Prim>(); var keys = new List<Prim>(); var logos = new List<Prim>();
            int X0 = GuideLayout.X0;

            // ---- header: the focused programme ----
            GuideEvent fe = g.FocusEvent;
            Channel fc = g.FocusChannel;
            if (fe != null)
            {
                texts.Add(Key(T(X0, GuideLayout.TitleTop, 64, 600, Main, fe.Title, GuideLayout.TitleW), "title"));
                string line = ProgramClock.Clock(fe.Start, offset) + " – " + ProgramClock.Clock(fe.End, offset) + "   ·   " + Minutes(fe.Duration) + (fc != null ? "   ·   " + fc.Name : "");
                texts.Add(T(X0, GuideLayout.MetaTop, 30, 500, Muted, line, GuideLayout.MetaW));
                if (!string.IsNullOrEmpty(description))
                {
                    var p = T(X0, GuideLayout.DescTop, 28, 500, Desc, description, GuideLayout.DescW);
                    p.Lines = 2; p.LineH = GuideLayout.DescPitch;
                    texts.Add(p);
                }
            }
            else
            {
                texts.Add(T(X0, GuideLayout.TitleTop, 64, 600, Faint, "No information", GuideLayout.TitleW));
                if (fc != null) texts.Add(T(X0, GuideLayout.MetaTop, 30, 500, Muted, fc.Name, GuideLayout.MetaW));
            }
            var date = T(GuideLayout.Right, GuideLayout.DateTop, 32, 500, Muted, DateTimeOffset.FromUnixTimeSeconds(g.FocusTime).ToOffset(offset).ToString("ddd d MMM", System.Globalization.CultureInfo.InvariantCulture), 400);
            date.Right = true;
            texts.Add(date);

            // ---- time axis: the half hours, full hours stronger ----
            foreach (var tick in g.Ticks())
            {
                bool full = (tick.Value + (long)offset.TotalSeconds) % 3600 == 0;
                texts.Add(T(tick.Key, GuideLayout.AxisY + 4, 26, full ? 600 : 500, full ? Main : Muted, ProgramClock.Clock(tick.Value, offset), 200));
            }
            lines.Add(new Prim { Kind = PrimKind.Line, X = GuideLayout.CellsX, Y = GuideLayout.AxisLineY, W = GuideLayout.CellsW, H = 2, Alpha = AxisAlpha });

            // ---- now: a mark on the axis and a trace through the rows (behind the cells) ----
            int nx = g.NowX(now);
            if (nx >= 0)
            {
                lines.Add(new Prim { Kind = PrimKind.Line, X = nx - 1, Y = GuideLayout.AxisY + 34, W = 3, H = 16, Alpha = 255, Tint = Light });
                lines.Add(new Prim { Kind = PrimKind.Line, X = nx, Y = GuideLayout.RowsY, W = 2, H = GuideLayout.Rows * GuideLayout.RowH, Alpha = NowAlpha, Tint = Light });
            }

            // ---- rows ----
            for (int r = 0; r < GuideLayout.Rows; r++)
            {
                Channel c = g.RowChannel(r);
                if (c == null) break;
                int y = GuideLayout.RowsY + r * GuideLayout.RowH;
                bool focusRow = g.FirstRow + r == g.FocusRow;
                int tx = GuideLayout.LabelX + (logo != null ? 86 : 16);           // number over name, right of the logo's column when there is one
                if (logo != null)
                {
                    string file = logo(c);
                    if (file != null) logos.Add(new Prim { Kind = PrimKind.Logo, X = GuideLayout.LabelX + 16, Y = y + 16, W = LogoSize, H = LogoSize, Alpha = 255, Text = file });
                }
                int labelW = GuideLayout.LabelX + GuideLayout.LabelW - 12 - tx;
                var num = T(tx, y + 12, 24, 500, focusRow ? Main : Muted, c.Major.ToString(), labelW);
                var name = T(tx, y + 44, 26, focusRow ? 600 : 500, focusRow ? Main : Muted, c.Name, labelW);
                if (focusRow) { num.Key = "num"; name.Key = "name"; }
                texts.Add(num); texts.Add(name);

                int cy = y + GuideLayout.CellDy;
                foreach (GuideCell cell in g.Cells(r))
                {
                    int tw = cell.W - 36;
                    if (cell.Focus)
                    {
                        // ice capsule, slate ink (the osd 123's focus): no ring, no shadow
                        focus.Add(new Prim { Kind = PrimKind.Focus, X = cell.X, Y = cy, W = cell.W, H = GuideLayout.CellH, Alpha = FocusAlpha });
                        if (cell.W >= 64)
                        {
                            string what = cell.Event != null ? cell.Event.Title : cell.Loading ? "Loading…" : "No information";
                            texts.Add(Ink(T(cell.X + 20, cy + (cell.Event != null ? 12 : 26), 28, cell.Event != null ? 600 : 500, 255, what, tw)));
                        }
                        if (cell.Event != null && cell.W >= 128)
                        {
                            string when = cell.W >= 230 ? ProgramClock.Clock(cell.Start, offset) + " – " + ProgramClock.Clock(cell.End, offset) : ProgramClock.Clock(cell.Start, offset);
                            texts.Add(Ink(T(cell.X + 20, cy + 47, 22, 500, 255, when, tw)));
                        }
                        continue;
                    }
                    if (cell.Loading)
                    {
                        fills.Add(Cell(cell, cy, CellLoading));
                        if (cell.W >= 150) texts.Add(T(cell.X + 20, cy + 26, 24, 500, Faint, "Loading…", tw));
                    }
                    else if (cell.Event == null)
                    {
                        fills.Add(Cell(cell, cy, CellNone));
                        if (cell.W > 48) hatches.Add(new Prim { Kind = PrimKind.Hatch, X = cell.X + 20, Y = cy, W = cell.W - 40, H = GuideLayout.CellH, Alpha = 255 });
                        if (cell.W >= 190) texts.Add(T(cell.X + 20, cy + 26, 24, 500, Faint, "No information", tw));
                    }
                    else
                    {
                        bool onAir = cell.Start <= now && now < cell.End;
                        fills.Add(Cell(cell, cy, onAir ? CellOnAir : CellRest));
                        if (cell.W >= GuideLayout.MinTextW) texts.Add(T(cell.X + 20, cy + 23, 28, 500, onAir ? Main : CellText, cell.Event.Title, tw));
                    }
                }
            }

            // ---- footer: the remote's keys as pictures, each group a key (or two) and a word ----
            Footer(keys, texts, X0, GuideLayout.FootTop, measure);

            var all = new List<Prim>(lines.Count + fills.Count + hatches.Count + 1 + logos.Count + texts.Count + keys.Count);
            all.AddRange(lines); all.AddRange(fills); all.AddRange(hatches); all.AddRange(focus); all.AddRange(logos); all.AddRange(texts); all.AddRange(keys);
            return all;
        }

        private static Prim Cell(GuideCell cell, int y, int alpha) { return new Prim { Kind = PrimKind.Fill, X = cell.X, Y = y, W = cell.W, H = GuideLayout.CellH, Alpha = alpha }; }

        /// <summary>OK Watch · Left Right Time · Up Down Channel · CH Page · Back Close, left to right from <paramref name="x"/>.</summary>
        private static void Footer(List<Prim> keys, List<Prim> texts, int x, int top, Func<string, int, int, int> measure)
        {
            var groups = new[]
            {
                new KeyValuePair<string[], string>(new[] { "key_ok" }, "Watch"),
                new KeyValuePair<string[], string>(new[] { "key_left", "key_right" }, "Time"),
                new KeyValuePair<string[], string>(new[] { "key_up", "key_down" }, "Channel"),
                new KeyValuePair<string[], string>(new[] { "key_ch" }, "Page"),
                new KeyValuePair<string[], string>(new[] { "key_back" }, "Close")
            };
            foreach (var g in groups)
            {
                for (int i = 0; i < g.Key.Length; i++)
                {
                    int w = KeyWidth(g.Key[i]);
                    keys.Add(new Prim { Kind = PrimKind.Key, X = x, Y = top - 2, W = w, H = KeyH, Alpha = KeyAlpha, Text = g.Key[i] });
                    x += w + (i < g.Key.Length - 1 ? PairGap : InnerGap);
                }
                int tw = measure(g.Value, FootSize, 500);
                texts.Add(T(x, top + 4, FootSize, 500, Muted, g.Value, tw + 40));   // room to spare: a word is never cut by the measure
                x += tw + GroupGap;
            }
        }

        /// <summary>The CH rocker is wider than the round keys (96 x 62 against 96 x 96 in the drawing).</summary>
        public static int KeyWidth(string name) { return name == "key_ch" ? KeyH * 96 / 62 : KeyH; }

        private static Prim T(int x, int y, int size, int weight, int alpha, string text, int maxW)
        {
            return new Prim { Kind = PrimKind.Text, X = x, Y = y, Size = size, Weight = weight, Alpha = alpha, Text = text ?? "", MaxW = maxW, Lines = 1 };
        }

        private static Prim Key(Prim p, string key) { p.Key = key; return p; }
        private static Prim Ink(Prim p) { p.Tint = Slate; return p; }

        private static string Minutes(long seconds) { long m = (seconds + 30) / 60; return m >= 60 ? (m / 60) + " h " + (m % 60).ToString("00") + " min" : m + " min"; }
    }
}
