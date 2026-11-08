using System;
using System.Collections.Generic;
using System.IO;
using Tuner.Core;

internal static partial class Tests
{
    private static byte[] Fixture(string name) { return File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "fixtures", name)); }

    private static List<GuideEvent> Events(string fixture, bool description = false)
    {
        List<GuideEvent> ev;
        Check(GuideReply.Parse(Fixture(fixture), description, out ev), "fixture " + fixture + " parses");
        return ev;
    }

    private static void GuideChecks()
    {
        // ---- the reply of GetProgramList, captured on the Q80A (2026-11-07) ----
        List<GuideEvent> none;
        Check(GuideReply.Parse(Fixture("sched_40_3h.bin"), false, out none) && none.Count == 0, "a channel with no data: result 0, empty map, no events");

        List<GuideEvent> c5 = Events("sched_5_3h.bin", true);
        Check(c5.Count == 2, "Canale 5, 3 h: two programmes");
        Check(c5[0].Title == "Tu si que vales" && c5[0].Duration == 13414 && c5[0].EventId == 58516, "first programme: title, length, event id");
        Check(c5[0].Description.StartsWith("Talenti, sfide ed emozioni"), "the description is kept when asked");
        Check(c5[1].Title == "Tg5" && c5[1].Start == c5[0].End, "the second starts where the first ends");
        Check(Events("sched_5_3h.bin", false)[0].Description == "", "no description when not asked");

        List<GuideEvent> la7 = Events("sched_7_3h.bin");
        Check(la7.Count == 2 && la7[0].Title == "In altre parole ST.4" && la7[1].Title == "UOZZAP ST.20", "La7: the two programmes");

        foreach (string f in new[] { "sched_1_168h.bin", "sched_5_24h.bin", "sched_1_3h.bin" })
        {
            List<GuideEvent> ev = Events(f);
            bool sorted = true, contiguous = true, titles = true;
            for (int i = 0; i < ev.Count; i++)
            {
                if (ev[i].Title.Length == 0) titles = false;
                if (i > 0 && ev[i].Start < ev[i - 1].Start) sorted = false;
                if (i > 0 && ev[i].Start != ev[i - 1].End) contiguous = false;
            }
            Check(ev.Count > 0 && sorted && contiguous && titles, f + ": sorted, back to back, every programme titled (" + ev.Count + ")");
        }
        Check(Events("sched_1_168h.bin").Count == 70 && Events("sched_5_24h.bin").Count == 32, "programme counts of the long captures");

        // garbled replies are refused and never throw
        List<GuideEvent> junk;
        byte[] full = Fixture("sched_5_3h.bin");
        Check(!GuideReply.Parse(new byte[0], false, out junk) && junk.Count == 0, "an empty reply is refused");
        Check(!GuideReply.Parse(null, false, out junk), "no reply is refused");
        var cut = new byte[full.Length / 2]; Array.Copy(full, cut, cut.Length);
        Check(!GuideReply.Parse(cut, false, out junk), "a truncated reply is refused");
        var bad = (byte[])full.Clone(); bad[1] = 4;
        Check(!GuideReply.Parse(bad, false, out junk), "a reply that is not a branch is refused");

        // ---- the store ----
        var store = new GuideStore();
        long now = c5[0].Start + 600;
        Check(store.Get(5) == null && store.Current(5, now) == null && store.NeedsRead(5, now, now + 3600), "an unknown channel is read");
        store.Put(5, c5, now, now + 10800);
        Check(store.Current(5, now).Title == "Tu si que vales", "the programme on air comes from the store");
        Check(store.Current(5, c5[1].Start + 1).Title == "Tg5", "and the next one once it has started");
        Check(store.Current(5, c5[1].End) == null, "nothing on air after the last programme");
        Check(!store.NeedsRead(5, now + 5, now + 3600), "a channel just read is left alone");
        Check(store.NeedsRead(5, now + GuideStore.MaxAgeSeconds, now + 3600), "an old reading is read again");
        Check(store.NeedsRead(5, now + 60, now + 86400), "a reading for a shorter window is read again for a longer one");
        store.Put(9, new List<GuideEvent>(), now, now + 3600);
        Check(!store.NeedsRead(9, now + 5, now + 3600) && store.NeedsRead(9, now + GuideStore.RetrySeconds, now + 3600), "a channel with no data is retried, but not at once");
        Check(string.Join(",", GuideStore.Nearest(6, 0)) == "1,5,2,4,3", "neighbours first, wrapping, current left out");
        Check(string.Join(",", GuideStore.Nearest(4, 2)) == "3,1,0", "neighbours of a middle channel");
        Check(GuideStore.Nearest(1, 0).Count == 0 && GuideStore.Nearest(5, -1).Count == 0, "nothing to read with no neighbours or no current");
    }
}

internal static partial class Tests
{
    // ids of the channels the fixtures were read for
    private const ulong Rai1 = 2654873089082394622UL, Canale5 = 2699909101328013310UL, La7 = 2626725588475322366UL, Empty40 = 2688650094869259262UL;
    private const long ProbeNow = 1794087016;   // when the captures were taken (Sat 7 Nov 2026, about 22:30 in Italy)

    private static GuideGrid SampleGrid(out GuideStore store, out ChannelList list)
    {
        var channels = new List<Channel>();
        for (int i = 1; i <= 12; i++) channels.Add(Ch(i, "Channel " + i));
        channels[0].Id = Rai1; channels[4].Id = Canale5; channels[6].Id = La7; channels[7].Id = Empty40;
        list = new ChannelList(channels);
        store = new GuideStore();
        store.Put(Rai1, Events("sched_1_168h.bin"), ProbeNow, ProbeNow + 604800);
        store.Put(Canale5, Events("sched_5_24h.bin"), ProbeNow, ProbeNow + 86400);
        store.Put(La7, Events("sched_7_3h.bin"), ProbeNow, ProbeNow + 10800);
        store.Put(Empty40, new List<GuideEvent>(), ProbeNow, ProbeNow + 10800);
        return new GuideGrid(list, store);
    }

    private static GuideCell FocusCell(GuideGrid g)
    {
        GuideCell found = null;
        for (int r = 0; r < GuideLayout.Rows; r++) foreach (GuideCell c in g.Cells(r)) if (c.Focus) { if (found != null) return null; found = c; }
        return found;
    }

    private static string Titles(GuideGrid g, int row)
    {
        var t = new List<string>();
        foreach (GuideCell c in g.Cells(row)) t.Add(c.Event != null ? c.Event.Title : c.Loading ? "…" : "-");
        return string.Join("|", t);
    }

    private static void GuideGridChecks()
    {
        GuideStore store; ChannelList list;
        GuideGrid g = SampleGrid(out store, out list);
        g.Open(4, ProbeNow);                                      // Canale 5
        Check(g.WindowStart % GuideGrid.Half == 0 && g.WindowStart <= ProbeNow && ProbeNow - g.WindowStart < GuideGrid.Half, "the window opens at the current half hour");
        Check(g.FocusRow == 4 && g.FirstRow == 2 && g.FocusChannel.Major == 5, "opens on the channel, two rows from the top");
        Check(g.FocusEvent != null && g.FocusEvent.Title == "Tu si que vales", "the focus is on the programme on air");

        // geometry: inside the window, in order, no overlap
        for (int r = 0; r < GuideLayout.Rows; r++)
        {
            int edge = GuideLayout.CellsX - 1;
            foreach (GuideCell c in g.Cells(r))
            {
                Check(c.X > edge && c.X + c.W <= GuideLayout.CellsX + GuideLayout.CellsW, "row " + r + ": cell inside the window and after the one before");
                edge = c.X + c.W - 1;
            }
        }
        GuideCell fc = FocusCell(g);
        Check(fc != null && fc.ClipLeft && !fc.ClipRight && fc.X == GuideLayout.CellsX + GuideLayout.CellGap / 2, "the programme on air is cut at the left edge, where it began earlier");
        Check(Titles(g, 2).StartsWith("Tu si que vales|Tg5"), "Canale 5 row: its programmes in order");
        Check(Titles(g, 3) == "…" , "a channel not read yet is one 'loading' box");
        Check(g.Cells(5).Count == 1 && g.Cells(5)[0].Event == null && !g.Cells(5)[0].Loading, "a channel with no data is one 'no information' box (row of channel 8)");

        // right: next programme, scrolling the time when it would not show
        g.MoveTime(+1);
        Check(g.FocusEvent.Title == "Tg5", "right: the next programme");
        Check(g.WindowStart % GuideGrid.Half == 0 && g.WindowStart > g.MinStart, "the time scrolled in half hours");
        GuideCell tg = FocusCell(g);
        Check(tg != null && !tg.ClipLeft && !tg.ClipRight, "the next programme shows whole after the scroll");
        g.MoveTime(-1);
        Check(g.FocusEvent.Title == "Tu si que vales", "left: back to the first");
        long ws = g.WindowStart;
        g.MoveTime(-1);
        Check(g.FocusEvent.Title == "Tu si que vales" && g.WindowStart <= ws, "nothing before the programme on air: left only scrolls the time back");
        for (int i = 0; i < 10; i++) g.MoveTime(-1);
        Check(g.FocusEvent.Title == "Tu si que vales" && g.WindowStart == g.MinStart, "and stops at the moment the guide opened");

        // down / up keep the time; rows scroll
        g.MoveRow(+1);
        Check(g.FocusRow == 5 && g.FocusEvent == null && FocusCell(g).Loading, "down: an unread channel is focused as 'loading'");
        g.MoveRow(+1);
        Check(g.FocusRow == 6 && g.FocusEvent != null && g.FocusEvent.Title == "In altre parole ST.4", "down: La7's programme at the same time");
        Check(g.FirstRow <= g.FocusRow && g.FocusRow < g.FirstRow + GuideLayout.Rows, "the focus stays on screen");
        for (int i = 0; i < 40; i++) g.MoveRow(+1);
        Check(g.FocusRow == 11 && g.FirstRow == 5, "down stops at the last channel, the rows scroll to show it");
        for (int i = 0; i < 40; i++) g.MoveRow(-1);
        Check(g.FocusRow == 0 && g.FirstRow == 0, "up stops at the first channel");
        g.MovePage(+1);
        Check(g.FocusRow == GuideLayout.Rows, "CH+ goes down a page");

        // the data runs out: the time scrolls through the empty stretch and stops at the horizon
        g.Open(6, ProbeNow);
        for (int i = 0; i < 400; i++) g.MoveTime(+1);
        Check(g.WindowEnd <= g.MaxEnd && g.WindowStart >= g.MinStart && g.WindowStart % GuideGrid.Half == 0, "the time never goes beyond the horizon");
        Check(g.FocusEvent == null && FocusCell(g) != null, "after the last programme the focus is on a 'no information' stretch");
        for (int i = 0; i < 400; i++) g.MoveTime(-1);
        Check(g.FocusEvent != null && g.FocusEvent.Title == "In altre parole ST.4" && g.WindowStart == g.MinStart, "and back to the start");

        // axis and now
        g.Open(4, ProbeNow);
        var ticks = g.Ticks();
        Check(ticks.Count == 6 && ticks[0].Key == GuideLayout.CellsX && ticks[5].Key - ticks[0].Key == 5 * 240, "six half-hour ticks, 240 px apart");
        Check(g.NowX(ProbeNow) > GuideLayout.CellsX && g.NowX(g.WindowEnd) == -1 && g.NowX(g.WindowStart - 1) == -1, "the 'now' line is inside the window or absent");
        var order = g.RowsToRead();
        Check(order[0] == g.FocusRow && new HashSet<int>(order).Count == order.Count && order.Count == list.Count, "rows to read: focus first, each once, all of them in a 12-channel list");

        // the scene: every state of the fuzz fits the object pools and the sheet
        g.Open(4, ProbeNow);
        var rnd0 = new Random(3);
        bool sceneOk = true; string sceneWhy = "";
        for (int i = 0; i < 400 && sceneOk; i++)
        {
            switch (rnd0.Next(5)) { case 0: g.MoveTime(+1); break; case 1: g.MoveTime(-1); break; case 2: g.MoveRow(+1); break; case 3: g.MoveRow(-1); break; default: g.MovePage(rnd0.Next(2) == 0 ? 1 : -1); break; }
            List<Prim> scene = GuideScene.Build(g, ProbeNow, TimeSpan.FromHours(1), "A description.");
            int fills = 0, texts = 0, rings = 0;
            foreach (Prim p in scene)
            {
                if (p.Kind == PrimKind.Fill) fills++; else if (p.Kind == PrimKind.Text) texts++; else if (p.Kind == PrimKind.Ring) rings++;
                if (p.Kind != PrimKind.Text && (p.X < GuideLayout.SheetX || p.X + p.W > GuideLayout.SheetX + GuideLayout.SheetW || p.Y < GuideLayout.SheetY || p.Y + p.H > GuideLayout.SheetY + GuideLayout.SheetH)) { sceneOk = false; sceneWhy = "shape outside the sheet"; }
                if (p.Kind == PrimKind.Text && (p.Text == null || p.MaxW <= 0 || p.X < GuideLayout.SheetX || p.X > GuideLayout.SheetX + GuideLayout.SheetW)) { sceneOk = false; sceneWhy = "text placement"; }
            }
            if (fills > GuideScene.MaxFills || texts > GuideScene.MaxTexts || rings != 1) { sceneOk = false; sceneWhy = "pools: fills " + fills + " texts " + texts + " rings " + rings; }
        }
        Check(sceneOk, "400 scenes fit the pools and the sheet, with one focus ring" + (sceneOk ? "" : " (" + sceneWhy + ")"));
        string dump = Environment.GetEnvironmentVariable("GUIDE_PREVIEW");
        if (dump != null)
        {
            Directory.CreateDirectory(dump);
            g.Open(4, ProbeNow);
            DumpScene(dump + "/guide_open.json", GuideScene.Build(g, ProbeNow, TimeSpan.FromHours(1), "Talenti, sfide ed emozioni con Elisabetta Canalis, Rudy Zerbi e una giuria di quattro artisti. In ogni puntata nuovi concorrenti si sfidano davanti al pubblico."));
            g.MoveTime(+1); g.MoveRow(-4);
            DumpScene(dump + "/guide_moved.json", GuideScene.Build(g, ProbeNow, TimeSpan.FromHours(1), ""));
        }

        // a long fuzz: whatever the keys, the model stays consistent and the focus is on screen exactly once
        var rnd = new Random(7);
        g.Open(0, ProbeNow);
        bool ok = true; string why = "";
        for (int i = 0; i < 3000 && ok; i++)
        {
            switch (rnd.Next(5))
            {
                case 0: g.MoveTime(+1); break;
                case 1: g.MoveTime(-1); break;
                case 2: g.MoveRow(+1); break;
                case 3: g.MoveRow(-1); break;
                default: g.MovePage(rnd.Next(2) == 0 ? 1 : -1); break;
            }
            if (g.WindowStart % GuideGrid.Half != 0 || g.WindowStart < g.MinStart || g.WindowEnd > g.MaxEnd) { ok = false; why = "window"; }
            else if (g.FocusRow < g.FirstRow || g.FocusRow >= g.FirstRow + GuideLayout.Rows || g.FirstRow < 0) { ok = false; why = "rows"; }
            else if (g.FocusTime < g.WindowStart || g.FocusTime >= g.WindowEnd) { ok = false; why = "focus time"; }
            else if (FocusCell(g) == null) { ok = false; why = "focus cell step " + i; }
        }
        Check(ok, "3000 random moves keep the model consistent" + (ok ? "" : " (" + why + ")"));
    }
}

internal static partial class Tests
{
    private static void DumpScene(string path, List<Prim> scene)
    {
        var sb = new System.Text.StringBuilder("[");
        foreach (Prim p in scene)
            sb.Append("\n{\"k\":\"" + p.Kind + "\",\"x\":" + p.X + ",\"y\":" + p.Y + ",\"w\":" + p.W + ",\"h\":" + p.H + ",\"a\":" + p.Alpha + ",\"s\":" + p.Size
                + ",\"t\":" + System.Text.Json.JsonSerializer.Serialize(p.Text ?? "") + ",\"mw\":" + p.MaxW + ",\"l\":" + p.Lines + ",\"r\":" + (p.Right ? "true" : "false") + "},");
        sb.Length--; sb.Append("\n]");
        File.WriteAllText(path, sb.ToString());
    }
}
