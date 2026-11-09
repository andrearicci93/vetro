using System;
using System.Collections.Generic;

namespace Tuner.Core
{
    internal enum PrimKind { Sheet, Fill, Ring, Text }

    /// <summary>One thing to draw. Fill/Ring are rounded rectangles in white at <see cref="Alpha"/> (0..255); Text is white text.</summary>
    internal struct Prim
    {
        public PrimKind Kind;
        public int X, Y, W, H;
        public int Alpha;
        public int Tint;               // fill: colour 0xRRGGBB, 0 for white
        public int Size;               // text: pixel size
        public string Text;
        public int MaxW;               // text: width it must fit (ellipsis); with Lines > 1 the width of the paragraph
        public int Lines;              // text: 1 or the number of lines of a wrapped paragraph
        public bool Right;             // text: X is the right edge
    }

    /// <summary>
    /// The guide as a list of drawing primitives: what the screen shows for a state of the model. The EFL view and the offline preview both
    /// draw this list, so the preview is the real layout. Back to front: sheet, fills, ring, texts.
    /// </summary>
    internal static class GuideScene
    {
        public const int MaxFills = 140, MaxTexts = 260;
        private const int TextMain = 255, TextMuted = 178, TextFaint = 140, Light = 0xA5D8FF;

        /// <param name="description">The long text of the focused programme, when it has been read (empty otherwise).</param>
        public static List<Prim> Build(GuideGrid g, long now, TimeSpan offset, string description)
        {
            var fills = new List<Prim>(); var texts = new List<Prim>(); var ring = new List<Prim>();
            var all = new List<Prim>();
            all.Add(new Prim { Kind = PrimKind.Sheet, X = GuideLayout.SheetX, Y = GuideLayout.SheetY, W = GuideLayout.SheetW, H = GuideLayout.SheetH });

            // ---- header: the focused programme ----
            GuideEvent fe = g.FocusEvent;
            Channel fc = g.FocusChannel;
            int textW = GuideLayout.SheetW - 2 * GuideLayout.Pad;
            if (fe != null)
            {
                texts.Add(T(GuideLayout.LabelX, GuideLayout.SheetY + 26, 40, TextMain, fe.Title, textW - 260));
                string line = ProgramClock.Clock(fe.Start, offset) + " – " + ProgramClock.Clock(fe.End, offset) + "   ·   " + Minutes(fe.Duration) + (fc != null ? "   ·   " + fc.Name : "");
                texts.Add(T(GuideLayout.LabelX, GuideLayout.SheetY + 84, 26, TextMuted, line, textW));
                if (description.Length > 0)
                {
                    var p = T(GuideLayout.LabelX, GuideLayout.SheetY + 128, 26, TextMuted, description, textW - 120);
                    p.Lines = 2;
                    texts.Add(p);
                }
            }
            else
            {
                texts.Add(T(GuideLayout.LabelX, GuideLayout.SheetY + 26, 40, TextFaint, "No information", textW - 260));
                if (fc != null) texts.Add(T(GuideLayout.LabelX, GuideLayout.SheetY + 84, 26, TextMuted, fc.Name, textW));
            }
            var date = T(GuideLayout.SheetX + GuideLayout.SheetW - GuideLayout.Pad, GuideLayout.SheetY + 32, 30, TextMuted, DateTimeOffset.FromUnixTimeSeconds(g.FocusTime).ToOffset(offset).ToString("ddd d MMM", System.Globalization.CultureInfo.InvariantCulture), 240);
            date.Right = true;
            texts.Add(date);

            // ---- time axis ----
            foreach (var tick in g.Ticks())
                texts.Add(T(tick.Key, GuideLayout.AxisY + 6, 24, TextMuted, ProgramClock.Clock(tick.Value, offset), 120));
            fills.Add(new Prim { Kind = PrimKind.Fill, X = GuideLayout.CellsX, Y = GuideLayout.RowsY - 4, W = GuideLayout.CellsW, H = 2, Alpha = 40 });

            // ---- rows ----
            GuideCell focus = null;
            for (int r = 0; r < GuideLayout.Rows; r++)
            {
                Channel c = g.RowChannel(r);
                if (c == null) break;
                int y = GuideLayout.RowsY + r * GuideLayout.RowH;
                bool focusRow = FirstRowIs(g, r);
                texts.Add(T(GuideLayout.LabelX, y + 22, 30, focusRow ? TextMain : TextMuted, c.Major.ToString(), 70));
                texts.Add(T(GuideLayout.LabelX + 68, y + 24, 27, focusRow ? TextMain : TextMuted, c.Name, GuideLayout.LabelW - 76));
                foreach (GuideCell cell in g.Cells(r))
                {
                    int cy = y + (GuideLayout.RowH - GuideLayout.CellH) / 2;
                    bool onAir = cell.Event != null && cell.Start <= now && now < cell.End;
                    fills.Add(new Prim { Kind = PrimKind.Fill, X = cell.X, Y = cy, W = cell.W, H = GuideLayout.CellH, Alpha = cell.Focus ? 66 : cell.Event == null ? 12 : onAir ? 66 : 51 });
                    if (cell.Focus) focus = cell;
                    if (cell.W < GuideLayout.MinTextW) continue;
                    int tw = cell.W - 28;
                    if (cell.Event != null)
                    {
                        texts.Add(T(cell.X + 16, cy + 10, 28, TextMain, cell.Event.Title, tw));
                        if (cell.W >= 128)
                        {
                            string when = cell.W >= 230 ? ProgramClock.Clock(cell.Start, offset) + " – " + ProgramClock.Clock(cell.End, offset) : ProgramClock.Clock(cell.Start, offset);
                            texts.Add(T(cell.X + 16, cy + 41, 24, cell.Focus ? TextMain : TextMuted, when, tw));
                        }
                    }
                    else if (cell.W >= 150) texts.Add(T(cell.X + 16, cy + 22, 24, TextFaint, cell.Loading ? "Loading…" : "No information", tw));
                }
                if (focus != null && focus.Row == r)
                {
                    int cy = y + (GuideLayout.RowH - GuideLayout.CellH) / 2;
                    ring.Add(new Prim { Kind = PrimKind.Ring, X = focus.X, Y = cy, W = focus.W, H = GuideLayout.CellH, Alpha = 255 });
                }
            }

            // ---- now ----
            int nx = g.NowX(now);
            if (nx >= 0)
            {
                int rowsEnd = GuideLayout.RowsY + GuideLayout.Rows * GuideLayout.RowH;
                fills.Add(new Prim { Kind = PrimKind.Fill, X = nx - 1, Y = GuideLayout.AxisY + 30, W = 3, H = GuideLayout.RowsY - GuideLayout.AxisY - 32, Alpha = 255, Tint = Light });   // a clear mark on the time axis
                fills.Add(new Prim { Kind = PrimKind.Fill, X = nx, Y = GuideLayout.RowsY, W = 1, H = rowsEnd - GuideLayout.RowsY - 6, Alpha = 45 });                       // only a trace through the rows, so it does not cut the text
            }

            // ---- footer ----
            texts.Add(T(GuideLayout.LabelX, GuideLayout.SheetY + GuideLayout.SheetH - 52, 24, TextMuted, "OK  Watch        Left / Right  Time        Up / Down  Channel        CH + / -  Page        Back  Close", textW));

            all.AddRange(fills); all.AddRange(ring); all.AddRange(texts);
            return all;
        }

        private static bool FirstRowIs(GuideGrid g, int row) { return g.FirstRow + row == g.FocusRow; }

        private static Prim T(int x, int y, int size, int alpha, string text, int maxW)
        {
            return new Prim { Kind = PrimKind.Text, X = x, Y = y, Size = size, Alpha = alpha, Text = text ?? "", MaxW = maxW, Lines = 1 };
        }

        private static string Minutes(long seconds) { long m = (seconds + 30) / 60; return m >= 60 ? (m / 60) + " h " + (m % 60).ToString("00") + " min" : m + " min"; }
    }
}
