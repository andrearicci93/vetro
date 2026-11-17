using System;
using System.Collections.Generic;

namespace Tuner.Core
{
    /// <summary>
    /// The numbers of the guide's layout (1920x1080 screen), shared by the drawing code and the tests. The guide stands on the full veil
    /// (design/challenge/opus6, "EPG: velo pieno"): no sheet. Text tops are the mock-up's line-box tops (line height = font size); the view puts
    /// each text on the same baseline (Theme.TopOf).
    /// </summary>
    internal static class GuideLayout
    {
        public const int X0 = 96, Right = 1824;                  // the safe margins (5%)
        public const int TitleTop = 70, MetaTop = 152, DateTop = 84, DescTop = 200, DescPitch = 38, DescW = 1400, TitleW = 1360, MetaW = 1500;
        public const int AxisY = 286, AxisLineY = AxisY + 46;    // the time labels (line-box top AxisY + 4) and the 2 px line under them
        public const int RowsY = 346, RowH = 88, Rows = 7;       // channel rows
        public const int LabelX = 80, LabelW = 304;              // the label column: logo at +16, number over name at +86 (+16 without logos)
        public const int CellsX = 400;
        public const int WindowMinutes = 180;
        public const int CellsW = 1440;                          // 8 px a minute
        public const int CellGap = 4, CellH = 76, CellDy = 6, MinCellW = 4, MinTextW = 90;   // narrower than MinCellW: not drawn (unless focused); under MinTextW: a box with no title
        public const int FootTop = 984;                          // the footer's words (line-box top)
        public const double PxPerSecond = (double)CellsW / (WindowMinutes * 60);
    }

    /// <summary>One box of a row: a programme, or a stretch with no information ("loading" while the channel has not been read).</summary>
    internal sealed class GuideCell
    {
        public int Row;                  // 0..Rows-1, on screen
        public int X, W;                 // pixels, already clipped to the window, the gap between cells taken off
        public long Start, End;          // the programme's own times (not clipped)
        public GuideEvent Event;         // null for a stretch with no information
        public bool Loading;             // no information because the channel has not been read yet
        public bool ClipLeft, ClipRight; // the programme goes on beyond the edge of the window
        public bool Focus;
    }

    /// <summary>
    /// The guide as a model: which channels are on screen, which 3 hours, which programme is focused, and the moves between them.
    /// No drawing and no TV: it works on a <see cref="ChannelList"/> and a <see cref="GuideStore"/>.
    /// Time runs from the moment the guide was opened (rounded down to 30 minutes) for <see cref="HorizonSeconds"/>: the daemon has nothing
    /// for the past, and the broadcasters send two or three days at most.
    /// </summary>
    internal sealed class GuideGrid
    {
        public const long Half = 30 * 60, WindowSeconds = GuideLayout.WindowMinutes * 60L, HorizonSeconds = 72 * 3600L;

        private readonly ChannelList _list;
        private readonly GuideStore _store;
        private long _minStart;

        public GuideGrid(ChannelList list, GuideStore store) { _list = list; _store = store; }

        public long WindowStart { get; private set; }
        public long WindowEnd { get { return WindowStart + WindowSeconds; } }
        public long MinStart { get { return _minStart; } }
        public long MaxEnd { get { return _minStart + HorizonSeconds; } }
        public int FirstRow { get; private set; }
        public int FocusRow { get; private set; }
        public long FocusTime { get; private set; }

        public static long Floor(long t) { return t - ((t % Half) + Half) % Half; }
        public static long Ceil(long t) { long f = Floor(t); return f == t ? t : f + Half; }

        /// <summary>Starts at the channel with this index, with "now" in the focused programme and the window beginning at the current half hour.</summary>
        public void Open(int channelIndex, long now)
        {
            _minStart = Floor(now);
            WindowStart = _minStart;
            FocusTime = now;
            FocusRow = Clamp(channelIndex, 0, Math.Max(0, _list.Count - 1));
            FirstRow = Clamp(FocusRow - 2, 0, MaxFirst());
        }

        private int MaxFirst() { return Math.Max(0, _list.Count - GuideLayout.Rows); }
        private static int Clamp(int v, int lo, int hi) { return v < lo ? lo : v > hi ? hi : v; }

        public Channel FocusChannel { get { return _list.Count == 0 ? null : _list[FocusRow]; } }

        /// <summary>The channel on an on-screen row (0..Rows-1), or null past the end of the list.</summary>
        public Channel RowChannel(int row) { int i = FirstRow + row; return i >= 0 && i < _list.Count ? _list[i] : null; }

        // ---- the row as a series of stretches ----

        private sealed class Seg { public long Start, End; public GuideEvent Event; public bool Loading; }

        /// <summary>A channel's cut, and what it was cut from: the store's entry (replaced whole on every read, never edited) and the start of the horizon.</summary>
        private sealed class Cut { public ChannelSchedule From; public long MinStart; public List<Seg> Segs; }
        private readonly Dictionary<ulong, Cut> _cuts = new Dictionary<ulong, Cut>();
        /// <summary>Past this many channels the cuts are dropped (a resident tuner pages through the whole list in a guide that stays open).</summary>
        public const int KeepCuts = 48;

        /// <summary>
        /// The whole horizon of a channel, cut into the programmes and the stretches between them. A guide key used to cut each row's 72 h about
        /// ten times to draw 3 h; the cut is now kept until the store's entry for that channel is replaced (a new read) or the horizon moves, and is
        /// the same list as a fresh cut would be. The lists are only read by the callers.
        /// </summary>
        private List<Seg> Segments(Channel c)
        {
            ChannelSchedule sched = _store.Get(c.Id);
            Cut cut;
            if (!CacheCuts) return CutSegments(sched);
            if (_cuts.TryGetValue(c.Id, out cut) && ReferenceEquals(cut.From, sched) && cut.MinStart == _minStart) return cut.Segs;
            if (_cuts.Count >= KeepCuts) _cuts.Clear();
            List<Seg> segs = CutSegments(sched);
            _cuts[c.Id] = new Cut { From = sched, MinStart = _minStart, Segs = segs };
            return segs;
        }

        /// <summary>False: every call cuts again, as before the cuts were kept (the tests compare the two).</summary>
        public bool CacheCuts = true;

        /// <summary>How many channels have a cut kept now (for the tests).</summary>
        public int CutsKept { get { return _cuts.Count; } }

        private List<Seg> CutSegments(ChannelSchedule sched)
        {
            var segs = new List<Seg>();
            if (sched == null) { segs.Add(new Seg { Start = _minStart, End = MaxEnd, Loading = true }); return segs; }
            long at = _minStart;
            bool any = false;
            foreach (GuideEvent e in sched.Events)
            {
                if (e.End <= _minStart) continue;                                   // over before the guide opened
                if (e.Start >= MaxEnd) break;
                if (any && e.Start < at) continue;                                  // overlaps the one before: the daemon's order wins
                if (e.Start > at) segs.Add(new Seg { Start = at, End = e.Start });
                segs.Add(new Seg { Start = e.Start, End = e.End, Event = e });      // the first may have begun before the guide opened
                at = e.End; any = true;
            }
            if (at < MaxEnd) segs.Add(new Seg { Start = at, End = MaxEnd });
            return segs;
        }

        private static int IndexAt(List<Seg> segs, long t)
        {
            for (int i = 0; i < segs.Count; i++) if (segs[i].Start <= t && t < segs[i].End) return i;
            return segs.Count - 1;
        }

        /// <summary>The programme under the focus; null when the focus is on a stretch with no information.</summary>
        public GuideEvent FocusEvent
        {
            get
            {
                if (_list.Count == 0) return null;
                List<Seg> segs = Segments(_list[FocusRow]);
                return segs[IndexAt(segs, FocusTime)].Event;
            }
        }

        /// <summary>True when the focus is on a channel whose schedule has not been read yet (the header then says so, not "No information").</summary>
        public bool FocusLoading
        {
            get
            {
                if (_list.Count == 0) return false;
                List<Seg> segs = Segments(_list[FocusRow]);
                return segs[IndexAt(segs, FocusTime)].Loading;
            }
        }

        // ---- moves ----

        /// <summary>Up (-1) or down (+1): the next channel, keeping the time. The rows scroll when the focus leaves them.</summary>
        public void MoveRow(int delta) { SetRow(FocusRow + delta, delta); }

        /// <summary>A page of channels (CH+ / CH-).</summary>
        public void MovePage(int direction) { SetRow(FocusRow + direction * GuideLayout.Rows, direction * GuideLayout.Rows); }

        private void SetRow(int row, int scrollBy)
        {
            if (_list.Count == 0) return;
            long anchor = Math.Max(FocusTime, WindowStart);                        // the visible left edge of what was focused
            FocusRow = Clamp(row, 0, _list.Count - 1);
            if (FocusRow < FirstRow) FirstRow = FocusRow;
            if (FocusRow >= FirstRow + GuideLayout.Rows) FirstRow = FocusRow - GuideLayout.Rows + 1;
            if (Math.Abs(scrollBy) >= GuideLayout.Rows) FirstRow = Clamp(FirstRow, 0, MaxFirst());
            FocusTime = anchor;
            EnsureVisible();
        }

        /// <summary>Left (-1) or right (+1): the previous or next programme of the channel; with nowhere to go but a long stretch, the time scrolls.</summary>
        public void MoveTime(int direction)
        {
            if (_list.Count == 0) return;
            List<Seg> segs = Segments(_list[FocusRow]);
            int i = IndexAt(segs, FocusTime);
            int j = i + (direction > 0 ? 1 : -1);
            if (j >= 0 && j < segs.Count && segs[j].End > _minStart)
            {
                FocusTime = Math.Max(segs[j].Start, _minStart);
            }
            else if (direction > 0 && segs[i].End > WindowEnd)
            {
                WindowStart = Math.Min(WindowStart + Half, MaxEnd - WindowSeconds);
                FocusTime = Math.Max(FocusTime, WindowStart);
            }
            else if (direction < 0 && segs[i].Start < WindowStart)
            {
                WindowStart = Math.Max(WindowStart - Half, _minStart);
                FocusTime = Math.Min(FocusTime, WindowEnd - 1);
            }
            EnsureVisible();
        }

        /// <summary>Scrolls the time so that the focused programme shows, as much of it as the window holds.</summary>
        private void EnsureVisible()
        {
            if (_list.Count == 0) return;
            List<Seg> segs = Segments(_list[FocusRow]);
            Seg s = segs[IndexAt(segs, FocusTime)];
            long a = Math.Max(s.Start, _minStart), b = Math.Min(s.End, MaxEnd);
            long shown = Math.Min(b, WindowEnd) - Math.Max(a, WindowStart);        // how much of it is on screen
            if (shown < Math.Min(Half, b - a))                                       // less than half an hour of it (or of all of it)
            {
                if (a < WindowStart) WindowStart = Floor(a);
                else
                {
                    long start = b - a <= WindowSeconds ? Ceil(b - WindowSeconds) : Floor(a);   // all of it when it fits, else its start at the left
                    WindowStart = start > a ? Floor(a) : start;
                }
            }
            WindowStart = Clamp64(WindowStart, _minStart, MaxEnd - WindowSeconds);
            if (FocusTime < WindowStart) FocusTime = WindowStart;
            if (FocusTime >= WindowEnd) FocusTime = WindowEnd - 1;
        }

        private static long Clamp64(long v, long lo, long hi) { return v < lo ? lo : v > hi ? hi : v; }

        // ---- what to draw and what to read ----

        /// <summary>
        /// The boxes of one on-screen row (0..Rows-1), clipped to the window; boxes too narrow to show anything are left out. Neighbours are
        /// <see cref="GuideLayout.CellGap"/> apart; a box cut by the window's edge is flush with it (the grid's edges are straight).
        /// </summary>
        public List<GuideCell> Cells(int row)
        {
            var cells = new List<GuideCell>();
            int idx = FirstRow + row;
            if (idx < 0 || idx >= _list.Count) return cells;
            foreach (Seg s in Segments(_list[idx]))
            {
                if (s.End <= WindowStart || s.Start >= WindowEnd) continue;
                long a = Math.Max(s.Start, WindowStart), b = Math.Min(s.End, WindowEnd);
                int x0 = (int)Math.Round((a - WindowStart) * GuideLayout.PxPerSecond), x1 = (int)Math.Round((b - WindowStart) * GuideLayout.PxPerSecond);
                int half = GuideLayout.CellGap / 2;
                int left = x0 + (x0 > 0 ? half : 0), right = x1 - (x1 < GuideLayout.CellsW ? half : 0);
                int w = right - left;
                bool focus = idx == FocusRow && s.Start <= FocusTime && FocusTime < s.End;
                if (w < GuideLayout.MinCellW) { if (!focus) continue; w = GuideLayout.MinCellW; left = Math.Min(left, GuideLayout.CellsW - w); }   // the focus is always on screen
                cells.Add(new GuideCell
                {
                    Row = row, X = GuideLayout.CellsX + left, W = w, Start = s.Start, End = s.End, Event = s.Event, Loading = s.Loading,
                    ClipLeft = s.Start < WindowStart, ClipRight = s.End > WindowEnd,
                    Focus = focus
                });
            }
            return cells;
        }

        /// <summary>The time labels: the half hours of the window as (x of the tick, unix time).</summary>
        public List<KeyValuePair<int, long>> Ticks()
        {
            var ticks = new List<KeyValuePair<int, long>>();
            for (long t = WindowStart; t < WindowEnd; t += Half)
                ticks.Add(new KeyValuePair<int, long>(GuideLayout.CellsX + (int)Math.Round((t - WindowStart) * GuideLayout.PxPerSecond), t));
            return ticks;
        }

        /// <summary>The x of "now" on the time axis, or -1 when it is not in the window.</summary>
        public int NowX(long now)
        {
            if (now < WindowStart || now >= WindowEnd) return -1;
            return GuideLayout.CellsX + (int)Math.Round((now - WindowStart) * GuideLayout.PxPerSecond);
        }

        /// <summary>
        /// The channels worth reading, in the order to read them: the focused one, the rest of the screen by distance, then the page below
        /// and the page above (a CH+ or a few Down presses away). Indexes into the channel list.
        /// </summary>
        public List<int> RowsToRead()
        {
            var order = new List<int>();
            if (_list.Count == 0) return order;
            var seen = new HashSet<int>();
            Action<int> add = i => { if (i >= 0 && i < _list.Count && seen.Add(i)) order.Add(i); };
            add(FocusRow);
            for (int k = 1; k < GuideLayout.Rows; k++) { add(FocusRow + k); add(FocusRow - k); }
            for (int k = 0; k < GuideLayout.Rows; k++) add(FirstRow + GuideLayout.Rows + k);
            for (int k = 1; k <= GuideLayout.Rows; k++) add(FirstRow - k);
            return order;
        }
    }
}
