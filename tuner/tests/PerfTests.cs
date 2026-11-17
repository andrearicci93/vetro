using System;
using System.Collections.Generic;
using Tuner.Core;

/// <summary>The performance pass (2026-11-17): work that is no longer done must give exactly what it gave before.</summary>
internal static partial class Tests
{
    private static void PerfChecks()
    {
        NearestLimitChecks();
        CutCacheChecks();
        TextFitChecks();
        IdleWorkChecks();
        NodeScanChecks();
        AppIdMemoChecks();
        MotionOutChecks();
    }

    private static void NearestLimitChecks()
    {
        bool same = true;
        for (int count = 0; count <= 40 && same; count++)
            for (int center = -1; center <= count && same; center++)
            {
                List<int> all = GuideStore.Nearest(count, center);
                for (int limit = 0; limit <= count + 2 && same; limit++)
                {
                    List<int> part = GuideStore.Nearest(count, center, limit);
                    int want = Math.Min(limit, all.Count);
                    if (part.Count != want) { same = false; break; }
                    for (int i = 0; i < want; i++) if (part[i] != all[i]) { same = false; break; }
                }
                // the order without a limit: every other channel once, the current one left out
                if (center >= 0 && center < count && (new HashSet<int>(all).Count != all.Count || all.Count != Math.Max(0, count - 1) || all.Contains(center))) same = false;
            }
        Check(same, "Nearest with a limit is the beginning of the full order, for every list size, centre and limit");
        Check(string.Join(",", GuideStore.Nearest(6, 0, 3)) == "1,5,2" && GuideStore.Nearest(500, 250, 23).Count == 23, "a zap asks for 23 neighbours, not the whole list");
    }

    /// <summary>A list of <paramref name="channels"/> channels, each with 72 h of programmes of 20 to 90 minutes.</summary>
    private static GuideStore BigStore(int channels, out ChannelList list, long now)
    {
        var chs = new List<Channel>();
        var store = new GuideStore();
        var rnd = new Random(7);
        for (int i = 1; i <= channels; i++)
        {
            chs.Add(Ch(i, "Channel " + i));
            var ev = new List<GuideEvent>();
            long t = GuideGrid.Floor(now) - 3600;
            ushort id = 1;
            while (t < now + GuideGrid.HorizonSeconds)
            {
                long d = 60 * (20 + rnd.Next(71));
                if (rnd.Next(25) == 0) t += 600;                                // a hole now and then
                ev.Add(new GuideEvent { EventId = id++, Start = t, Duration = d, Title = "Programme " + i + "." + id });
                t += d;
            }
            if (i % 9 != 0) store.Put((ulong)i * 1000, ev, now, now + GuideGrid.HorizonSeconds);   // every ninth channel not read yet
        }
        list = new ChannelList(chs);
        return store;
    }

    private static string GridState(GuideGrid g)
    {
        var sb = new System.Text.StringBuilder();
        sb.Append(g.FirstRow).Append(' ').Append(g.FocusRow).Append(' ').Append(g.FocusTime).Append(' ').Append(g.WindowStart).Append(' ');
        GuideEvent fe = g.FocusEvent;
        sb.Append(fe != null ? fe.Title : "-").Append(g.FocusLoading ? " L" : " .");
        for (int r = 0; r < GuideLayout.Rows; r++)
            foreach (GuideCell c in g.Cells(r)) sb.Append('|').Append(c.X).Append(',').Append(c.W).Append(',').Append(c.Event != null ? c.Event.Title : c.Loading ? "…" : "-").Append(c.Focus ? "*" : "");
        return sb.ToString();
    }

    private static void CutCacheChecks()
    {
        long now = ProbeNow;
        ChannelList list;
        GuideStore store = BigStore(100, out list, now);
        var kept = new GuideGrid(list, store);
        var fresh = new GuideGrid(list, store) { CacheCuts = false };
        kept.Open(40, now); fresh.Open(40, now);
        var rnd = new Random(11);
        bool same = GridState(kept) == GridState(fresh);
        string why = same ? "" : "after Open";
        for (int i = 0; i < 3000 && same; i++)
        {
            int op = rnd.Next(9);
            switch (op)
            {
                case 0: kept.MoveTime(+1); fresh.MoveTime(+1); break;
                case 1: kept.MoveTime(-1); fresh.MoveTime(-1); break;
                case 2: kept.MoveRow(+1); fresh.MoveRow(+1); break;
                case 3: kept.MoveRow(-1); fresh.MoveRow(-1); break;
                case 4: { int d = rnd.Next(2) == 0 ? 1 : -1; kept.MovePage(d); fresh.MovePage(d); break; }
                case 5:
                    {
                        // a channel is read again while the guide is open (new entry in the store): the kept cut must follow it
                        Channel c = list[rnd.Next(list.Count)];
                        var ev = new List<GuideEvent>();
                        long t = now - 1200 + rnd.Next(1800);
                        for (int k = 0; k < 20; k++) { long d = 60 * (15 + rnd.Next(100)); ev.Add(new GuideEvent { EventId = (ushort)(k + 1), Start = t, Duration = d, Title = "New " + c.Major + "." + k + "." + i }); t += d + (rnd.Next(4) == 0 ? 900 : 0); }
                        store.Put(c.Id, ev, now, now + GuideGrid.HorizonSeconds);
                        break;
                    }
                case 6: { Channel c = list[rnd.Next(list.Count)]; store.PutFailed(c.Id, now, now + GuideGrid.HorizonSeconds); break; }
                case 7: { int idx = rnd.Next(list.Count); long at = now + rnd.Next(3600); kept.Open(idx, at); fresh.Open(idx, at); break; }   // opened again later: the horizon moves
                default: for (int k = 0; k < 5; k++) { kept.MoveTime(+1); fresh.MoveTime(+1); } break;
            }
            if (GridState(kept) != GridState(fresh)) { same = false; why = "after step " + i + " (op " + op + ")"; }
        }
        Check(same, "the guide with its cuts kept moves and draws exactly as one that cuts every row again " + why);
        Check(kept.CutsKept <= GuideGrid.KeepCuts, "the kept cuts stay bounded (" + kept.CutsKept + ")");

        // what a guide key allocates: the grid part (the moves, the focus, the seven rows' cells) and the whole scene, kept cuts against fresh ones
        long keptBytes = KeyBytes(BigGridFor(100, now, true), false), freshBytes = KeyBytes(BigGridFor(100, now, false), false);
        long keptScene = KeyBytes(BigGridFor(100, now, true), true), freshScene = KeyBytes(BigGridFor(100, now, false), true);
        Console.WriteLine("  desk: bytes allocated per guide key (100 channels x 72 h): grid " + freshBytes + " -> " + keptBytes + ", with the scene " + freshScene + " -> " + keptScene);
        Check(keptBytes * 10 < freshBytes, "a guide key no longer cuts the rows' 72 h again (grid bytes per key " + freshBytes + " -> " + keptBytes + ")");

        // the scene into a kept list is the same scene
        GuideGrid sg = BigGridFor(30, now, true);
        var into = new List<Prim>();
        bool sameScene = true;
        for (int i = 0; i < 50 && sameScene; i++)
        {
            if (i % 2 == 0) sg.MoveRow(+1); else sg.MoveTime(+1);
            List<Prim> a = GuideScene.Build(sg, now, TimeSpan.FromHours(1), i % 3 == 0 ? "A description of the programme." : "");
            List<Prim> b = GuideScene.Build(sg, now, TimeSpan.FromHours(1), i % 3 == 0 ? "A description of the programme." : "", null, null, into);
            if (!ReferenceEquals(b, into) || a.Count != b.Count) { sameScene = false; break; }
            for (int k = 0; k < a.Count; k++) if (!PrimEquals(a[k], b[k])) { sameScene = false; break; }
        }
        Check(sameScene, "a scene built into the view's kept list is the same scene as a new one");
    }

    private static GuideGrid BigGridFor(int channels, long now, bool cache)
    {
        ChannelList list;
        GuideStore store = BigStore(channels, out list, now);
        var g = new GuideGrid(list, store) { CacheCuts = cache };
        g.Open(channels / 2, now);
        return g;
    }

    private static bool PrimEquals(Prim a, Prim b)
    {
        return a.Kind == b.Kind && a.X == b.X && a.Y == b.Y && a.W == b.W && a.H == b.H && a.Alpha == b.Alpha && a.Tint == b.Tint && a.Size == b.Size && a.Weight == b.Weight
            && a.Text == b.Text && a.MaxW == b.MaxW && a.Lines == b.Lines && a.LineH == b.LineH && a.Right == b.Right && a.Key == b.Key;
    }

    /// <summary>Bytes allocated on this thread per guide key, averaged over a walk of 200 keys (after a first walk that fills what is kept).</summary>
    private static long KeyBytes(GuideGrid g, bool scene)
    {
        var into = new List<Prim>();
        Func<int, bool> walk = n =>
        {
            for (int i = 0; i < n; i++)
            {
                int k = i % 8;
                if (k < 3) g.MoveTime(+1); else if (k < 5) g.MoveRow(+1); else if (k < 7) g.MoveTime(-1); else g.MoveRow(-1);
                if (scene) GuideScene.Build(g, ProbeNow, TimeSpan.FromHours(1), "", null, null, into);
                else { GuideEvent fe = g.FocusEvent; bool l = g.FocusLoading; for (int r = 0; r < GuideLayout.Rows; r++) g.Cells(r); }
            }
            return true;
        };
        walk(200);
        long before = GC.GetAllocatedBytesForCurrentThread();
        walk(200);
        return (GC.GetAllocatedBytesForCurrentThread() - before) / 200;
    }

    /// <summary>The cut as Surface.SetFitted made it before TextFit: kept here to check that TextFit gives the same.</summary>
    private static string OldFit(string s, int maxW, Func<string, int> measure)
    {
        if (s.Length <= 1 || measure(s) <= maxW) return s;
        int lo = 1, hi = s.Length - 1;
        while (lo < hi) { int mid = (lo + hi + 1) / 2; if (measure(s.Substring(0, mid).TrimEnd() + "…") <= maxW) lo = mid; else hi = mid - 1; }
        return s.Substring(0, lo).TrimEnd() + "…";
    }

    private static void TextFitChecks()
    {
        // a measure with uneven letter widths, as a font has
        Func<string, int> measure = t => { int w = 0; foreach (char ch in t) w += ch == ' ' ? 7 : ch == '…' ? 15 : char.IsUpper(ch) ? 19 : 11 + (ch % 5); return w; };
        string[] texts = { "", "A", "Rai 1", "Un posto al sole", "Il commissario Montalbano - La forma dell'acqua", "Sample description of the programme on Radio Italia TV HD. Generated for the preview.", "   spaced   out   " };
        bool same = true;
        foreach (string t in texts) for (int w = 0; w < 900 && same; w += 13) if (TextFit.Fit(t, w, measure) != OldFit(t, w, measure)) same = false;
        Check(same, "TextFit cuts every text at every width exactly as the old SetFitted did");

        var cache = new FitCache();
        Fitted f;
        Check(!cache.TryGet("SamsungOneUI 500", 28, 0, "Rai 1", 200, out f), "an empty cut cache knows nothing");
        cache.Put("SamsungOneUI 500", 28, 0, "Rai 1", 200, new Fitted("Rai 1", 55));
        Check(cache.TryGet("SamsungOneUI 500", 28, 0, "Rai 1", 200, out f) && f.Text == "Rai 1" && f.Advance == 55, "a cut is found again with the same font, size, style, text and width");
        Check(!cache.TryGet("SamsungOneUI 600", 28, 0, "Rai 1", 200, out f) && !cache.TryGet("SamsungOneUI 500", 26, 0, "Rai 1", 200, out f)
              && !cache.TryGet("SamsungOneUI 500", 28, 8, "Rai 1", 200, out f) && !cache.TryGet("SamsungOneUI 500", 28, 0, "Rai 1", 201, out f), "another font, size, style or width is another cut");
        for (int i = 0; i < FitCache.Max + 10; i++) cache.Put("F", 10, 0, "t" + i, 100, new Fitted("t" + i, i));
        Check(cache.Count <= FitCache.Max, "the cut cache stays bounded");

        var widths = new WidthCache();
        int calls = 0;
        Func<string, int, int, int> m3 = (t, size, weight) => { calls++; return t.Length * size; };
        int a1 = widths.Get("Watch", 24, 500, m3), a2 = widths.Get("Watch", 24, 500, m3), a3 = widths.Get("Watch", 26, 500, m3), a4 = widths.Get("Watch", 24, 600, m3);
        Check(a1 == 120 && a2 == 120 && a3 == 130 && a4 == 120 && calls == 3, "a width is measured once per text, size and weight (3 measures for 3 keys, got " + calls + ")");
        var small = new WidthCache(16);
        for (int i = 0; i < 100; i++) small.Get("w" + i, 24, 500, m3);
        Check(small.Count <= 16, "the width cache stays bounded");
    }

    private static void IdleWorkChecks()
    {
        Check(IdleWork.Ask(true, false, true, false, false, 10) == IdleWork.Answer.Now, "idle, list known, nothing on screen: the guide is made now");
        Check(IdleWork.Ask(true, true, true, false, false, 10) == IdleWork.Answer.Never && IdleWork.Ask(false, false, true, false, false, 10) == IdleWork.Answer.Never, "made already, or the guide switched off: never (the first opening makes it)");
        Check(IdleWork.Ask(true, false, false, false, false, 10) == IdleWork.Answer.Later, "no channel list yet: later");
        Check(IdleWork.Ask(true, false, true, true, false, 10) == IdleWork.Answer.Later && IdleWork.Ask(true, false, true, false, true, 10) == IdleWork.Answer.Later, "something on screen or moving: later");
        Check(IdleWork.Ask(true, false, true, false, false, IdleWork.QuietSeconds - 0.1) == IdleWork.Answer.Later && IdleWork.Ask(true, false, true, false, false, IdleWork.QuietSeconds) == IdleWork.Answer.Now, "a key in the last seconds: later");
    }

    private static void NodeScanChecks()
    {
        var s = new NodeScan();
        Check(s.ShouldRead(100), "nothing scanned yet: the list is read");
        s.Scanned(100, true);
        Check(!s.ShouldRead(100), "same /dev/input time, every node opened: not read");
        Check(s.ShouldRead(101), "/dev/input changed: read");
        s.Scanned(101, false);
        Check(s.ShouldRead(101) && s.ShouldRead(101), "a listed node could not be opened: read on every tick, as before");
        s.Scanned(101, true);
        Check(s.ShouldRead(null), "the time cannot be read: read");
        s.Scanned(null, true);
        Check(s.ShouldRead(null) && s.ShouldRead(5), "after a scan without a time: read until one with a time");
        s.Scanned(7, true);
        Check(!s.ShouldRead(7), "clean again: not read");
        s.Dirty();
        Check(s.ShouldRead(7), "a watched node was dropped (or a scan threw half way): the next tick reads, as before");
        s.Scanned(7, true);
        int reads = 0;
        for (int i = 0; i < NodeScan.FullEvery * 3; i++) if (s.ShouldRead(7)) { reads++; s.Scanned(7, true); }
        Check(reads == 3, "unchanged: read once every " + NodeScan.FullEvery + " ticks anyway (got " + reads + " in " + NodeScan.FullEvery * 3 + ")");
    }

    private static void AppIdMemoChecks()
    {
        var m = new FrontApp.AppIdMemo();
        string app;
        Check(m.Known(500, 500, out app) && app == null, "the tuner's own window: no need to ask (Judge says Own first)");
        Check(FrontApp.Judge(true, 500, null, 0, 500, "org.tizen.tv-viewer") == FrontApp.Kind.Own && FrontApp.Judge(true, 500, "x", 0, 500, "org.tizen.tv-viewer") == FrontApp.Kind.Own, "Own whatever the app id");
        Check(!m.Known(42, 500, out app), "a process not seen yet: ask");
        m.Asked(42, "org.tizen.tv-viewer");
        Check(m.Known(42, 500, out app) && app == "org.tizen.tv-viewer", "the same process again: its app id is known");
        Check(!m.Known(43, 500, out app), "another process: ask");
        m.Asked(43, null);
        Check(!m.Known(43, 500, out app), "a process that is not an app (yet): asked every time");
        m.Asked(44, "youtube");
        int asks = 0;
        for (int i = 0; i < FrontApp.AppIdMemo.RecheckEvery * 3; i++) if (!m.Known(44, 500, out app)) { asks++; m.Asked(44, "youtube"); } else if (app != "youtube") asks = -1000;
        Check(asks == 2, "the same process: asked again every " + FrontApp.AppIdMemo.RecheckEvery + " readings (got " + asks + ")");
    }

    private static void MotionOutChecks()
    {
        bool same = true;
        for (double p = 0; p <= 1.0001 && same; p += 0.05)
        {
            double x, y, w, h;
            double[] a = Motion.FlyFrom(96, 790, 200, 169, 128, 480, 400, 24, p);
            Motion.FlyFrom(96, 790, 200, 169, 128, 480, 400, 24, p, out x, out y, out w, out h);
            if (a[0] != x || a[1] != y || a[2] != w || a[3] != h) same = false;
            double[] b = Motion.FlyTo(480, 400, 24, 96, 790, 200, 169, 128, p);
            Motion.FlyTo(480, 400, 24, 96, 790, 200, 169, 128, p, out x, out y, out w, out h);
            if (b[0] != x || b[1] != y || b[2] != w || b[3] != h) same = false;
        }
        Check(same, "the flights without arrays give the same rectangles");
    }
}
