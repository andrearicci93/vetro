using System;
using System.Collections.Generic;
using System.Text;
using Launcher.Core;

// Dependency-free test runner for the launcher's pure logic.
//   dotnet run --project tests -c Release
namespace Launcher.Tests
{
    internal static class T
    {
        public static int Failures, Checks;
        public static void True(bool cond, string what)
        {
            Checks++;
            if (!cond) { Failures++; Console.WriteLine("  FAIL: " + what); }
        }
        public static void Eq<V>(V actual, V expected, string what)
        {
            Checks++;
            if (!EqualityComparer<V>.Default.Equals(actual, expected))
            {
                Failures++;
                Console.WriteLine("  FAIL: " + what + " (expected " + expected + ", got " + actual + ")");
            }
        }
        public static void Run(string name, Action body)
        {
            Console.WriteLine(name);
            try { body(); }
            catch (Exception ex) { Failures++; Console.WriteLine("  EXCEPTION: " + ex); }
        }
    }

    internal static class Program
    {
        /// <summary>Advances a controller by a span of time in frames of at most 1/120 s (Tick caps a single step).</summary>
        private static void Run(Controller c, double seconds)
        {
            while (seconds > 1e-9) { double dt = Math.Min(1 / 120.0, seconds); c.Tick(dt); seconds -= dt; }
        }

        private static Controller NewController(int count, out DockLayout layout)
        {
            layout = new DockLayout(count, 1920, 1080);
            return new Controller(layout);
        }


        private static byte[] Rec(int size, int type, int code, int value)
        {
            var b = new byte[size];
            int o = size - 8;
            b[o] = (byte)type; b[o + 1] = (byte)(type >> 8);
            b[o + 2] = (byte)code; b[o + 3] = (byte)(code >> 8);
            b[o + 4] = (byte)value; b[o + 5] = (byte)(value >> 8); b[o + 6] = (byte)(value >> 16); b[o + 7] = (byte)(value >> 24);
            return b;
        }

        private static byte[] Concat(params byte[][] parts)
        {
            int n = 0; foreach (var p in parts) n += p.Length;
            var r = new byte[n]; int i = 0;
            foreach (var p in parts) { Buffer.BlockCopy(p, 0, r, i, p.Length); i += p.Length; }
            return r;
        }

        private static int Main()
        {
            SourceSwitchTests.Run();
            T.Run("catalog parses well-formed lines", () =>
            {
                var r = Catalog.Parse("# comment\nnetflix\tNetflix\torg.tizen.netflix-app\n\ntvplus\tTV Plus\tcom.x.y\torg.tizen.tv-viewer\n");
                T.Eq(r.Entries.Length, 2, "two entries");
                T.Eq(r.Problems.Length, 0, "no problems");
                T.Eq(r.Entries[1].FallbackAppId, "org.tizen.tv-viewer", "fallback kept");
                T.Eq(r.Entries[0].FallbackAppId, null, "no fallback is null");
            });

            T.Run("catalog skips bad lines without failing", () =>
            {
                var r = Catalog.Parse("ok\tOk\ta.b\nBAD SLUG\tx\ta.b\nshort\tx\nbadid\tX\t../etc/passwd\ndup\tD\ta.b\ndup\tD2\ta.c\nlong\t\ta.b\n");
                T.Eq(r.Entries.Length, 2, "ok and first dup survive");
                T.Eq(r.Problems.Length, 5, "five problems reported");
            });

            T.Run("catalog: tiles a plugin has taken over", () =>
            {
                var r = Catalog.Parse("yt\tYouTube\tcom.samsung.tv.cobalt-yt\t\t\t\tshard\nplain\tP\ta.b\t\t\t\t\nlater\tL\tc.d\t\t\t\tsomething-new\nkey\tK\tkey:XF86Menu\torg.tizen.menu\t\t\tshard\nsysapp\tS\tsys:com.x.y\t\t\t\tshard\n");
                T.Eq(r.Problems.Length, 0, "no problems");
                T.True(r.Entries[0].ViaShard, "shard column is read");
                T.True(!r.Entries[1].ViaShard, "blank is a normal tile");
                T.True(!r.Entries[2].ViaShard, "an unknown word is ignored, the tile stays normal");
                T.True(!r.Entries[3].ViaShard, "a key tile cannot be taken over");
                T.True(!r.Entries[4].ViaShard, "a system tile cannot be taken over");
                string cmd = ShardLaunch.Command(r.Entries[0], 8099);
                T.Eq(cmd, "( /usr/bin/curl -sf -m 5 -X POST 'http://127.0.0.1:8099/plugins/launcher/api/open?slug=yt' >/dev/null 2>&1 || /usr/bin/app_launcher -s com.samsung.tv.cobalt-yt >/dev/null 2>&1 ) &", "the service is asked first, the plain launch is the fallback");
                T.Eq(ShardLaunch.Command(r.Entries[1], 8099), null, "a normal tile has no plugin command");
                T.Eq(ShardLaunch.Command(null, 8099), null, "null is refused");
                var evil = new AppEntry("a;reboot", "x", "a.b", null, null, -1, null, false, null, null, true);
                T.Eq(ShardLaunch.Command(evil, 8099), null, "a slug with shell characters is refused");
                var evil2 = new AppEntry("ok", "x", "a.b;reboot", null, null, -1, null, false, null, null, true);
                T.Eq(ShardLaunch.Command(evil2, 8099), null, "an app id with shell characters is refused");
            });

            T.Run("catalog: HbbTV link in the ninth field (#200, by genesai)", () =>
            {
                const string svt = "https://hbbtv.play.svt.se/v2/index.xhtml";
                var r = Catalog.Parse("svt-play\tSVT Play\t5exPmCT0nz.svtplay\t\t\t\t\t\t" + svt + "\nur-play\tUR Play\t4rd98xReqr.URPlay\n");
                T.Eq(r.Problems.Length, 0, "no problems");
                T.Eq(r.Entries[0].HbbtvLink, svt, "link kept");
                T.Eq(r.Entries[0].AppId, "5exPmCT0nz.svtplay", "app id kept");
                T.Eq(r.Entries[1].HbbtvLink, null, "no link is null");
                foreach (string bad in new[] { "ftp://x", "https://", "https://a b", "https://a'b", "https://a\"b", "https://a\\b", "javascript:x", "https://" + new string('a', 501) })
                {
                    var b = Catalog.Parse("x\tX\ta.b\t\t\t\t\t\t" + bad + "\n");
                    T.Eq(b.Entries.Length, 0, "bad link refused: " + bad);
                    T.Eq(b.Problems.Length, 1, "bad link reported: " + bad);
                }
                T.True(Catalog.ValidHbbtvLink("https://" + new string('a', 500)), "longest link the service also accepts");
                T.Eq(Catalog.Parse("x\tX\tsys:a.b\t\t\t\t\t\t" + svt + "\n").Entries.Length, 0, "no link on a system row");
                T.Eq(Catalog.Parse("x\tX\tkey:XF86Menu\ta.b\t\t\t\t\t" + svt + "\n").Entries.Length, 0, "no link on a key row");
            });

            T.Run("catalog handles CRLF and empty input", () =>
            {
                T.Eq(Catalog.Parse("a\tA\tx.y\r\nb\tB\tx.z\r\n").Entries.Length, 2, "crlf");
                T.Eq(Catalog.Parse("").Entries.Length, 0, "empty");
                T.Eq(Catalog.Parse(null).Entries.Length, 0, "null");
                T.True(Catalog.BuiltIn().Length > 0, "built-in fallback list is not empty");
            });

            T.Run("catalog: key entries (remote key injection)", () =>
            {
                var r = Catalog.Parse("settings\tSettings\tkey:XF86Menu\torg.tizen.menu\nkeyonly\tK\tkey:XF86Display\nplain\tP\ta.b\n");
                T.Eq(r.Problems.Length, 0, "valid key lines");
                T.Eq(r.Entries.Length, 3, "three entries");
                T.Eq(r.Entries[0].Key, "XF86Menu", "key is read");
                T.Eq(r.Entries[0].AppId, "org.tizen.menu", "app becomes the fallback target");
                T.True(r.Entries[1].Key == "XF86Display" && r.Entries[1].AppId == null, "key without app");
                T.True(r.Entries[2].Key == null && r.Entries[2].AppId == "a.b", "plain app has no key");
                // the key name reaches a command line: anything but letters and digits must be refused
                foreach (string bad in new[] { "key:", "key:XF86 Menu", "key:a;rm", "key:$(x)", "key:a|b", "key:../x", "key:a&b", "key:`x`", "key:a\"b", "key:" + new string('A', 33) })
                {
                    var b = Catalog.Parse("x\tX\t" + bad + "\n");
                    T.True(b.Entries.Length == 0 && b.Problems.Length == 1, "rejects " + bad);
                }
            });

            T.Run("catalog: source and panel entries", () =>
            {
                var r = Catalog.Parse("hdmi1\tHDMI 1\tsource:13\ntv\tTV\tsource:0\nsource\tSource\tpanel:inputs\nplain\tP\ta.b\n");
                T.Eq(r.Problems.Length, 0, "valid lines");
                T.Eq(r.Entries[0].SourceType, 13, "hdmi number");
                T.Eq(r.Entries[1].SourceType, 0, "TV is input 0, not 'none'");
                T.Eq(r.Entries[2].Panel, "inputs", "panel name");
                T.True(r.Entries[2].SourceType == -1 && r.Entries[2].AppId == null, "panel is not an app or an input");
                T.True(r.Entries[3].SourceType == -1 && r.Entries[3].Panel == null, "plain app has neither");
                foreach (string bad in new[] { "source:", "source:-1", "source:1a", "source:123456", "source:1 3", "panel:", "panel:IN", "panel:a b", "panel:a;b" })
                {
                    var b = Catalog.Parse("x\tX\t" + bad + "\n");
                    T.True(b.Entries.Length == 0 && b.Problems.Length == 1, "rejects " + bad);
                }
                var ins = Catalog.BuiltInInputs();
                T.Eq(ins.Length, 5, "built-in inputs: TV and four HDMI");
                T.True(ins[0].SourceType == 0 && ins[1].SourceType == 13 && ins[4].SourceType == 16, "built-in numbers follow Samsung's SourceType");
            });

            T.Run("layout: a narrower page is centred in the shared window", () =>
            {
                var wide = new DockLayout(13, 1920, 1080);
                var narrow = new DockLayout(5, 1920, 1080, wide.WinW);
                T.Eq(narrow.WinW, wide.WinW, "same window width");
                T.Eq(narrow.WinX, wide.WinX, "same window position");
                T.Eq(narrow.WinH, wide.WinH, "same window height");
                T.True(narrow.PillW < wide.PillW, "narrower pill");
                T.Eq(narrow.Left - DockLayout.Margin, (wide.WinW - (narrow.PillW + 2 * DockLayout.Margin)) / 2, "pill offset");
                T.True(Math.Abs((narrow.Left + narrow.PillW / 2) - wide.WinW / 2) <= 1, "pill centred in the window");
                T.Eq(new DockLayout(13, 1920, 1080, 0).Left, DockLayout.Margin, "no offset without a shared width");
                T.Eq(new DockLayout(13, 1920, 1080, 100).WinW, wide.WinW, "a too-small shared width is ignored");
                for (int i = 0; i < 5; i++)
                {
                    var h = narrow.GlowBox(i, narrow.ScrollFor(i), 0);
                    T.True(h.X >= 0 && h.X + h.W <= narrow.WinW, "highlight inside the window, item " + i);   // it may spill a little past the bar, as in the design
                }
            });

            T.Run("labels: the old name fades out in place, the new one fades in at its own icon", () =>
            {
                var f = new LabelFader();
                f.Update(3, 3f);
                T.Eq(f.Index[f.TargetSlot], 3, "first target shown"); T.Eq(f.Weight[f.TargetSlot], 1f, "fully visible at rest");
                T.Eq(f.Dirty, 1, "first text to set"); f.ClearDirty();
                int a = f.TargetSlot;
                f.Update(4, 3f);                                // key pressed, the focus has not moved yet
                T.Eq(f.Index[1 - a], 4, "new name in the other slot"); T.Eq(f.Dirty, 1 << (1 - a), "only the new slot is re-typed"); f.ClearDirty();
                T.Eq(f.Weight[a], 1f, "old name still fully visible"); T.Eq(f.Weight[1 - a], 0f, "new name not yet visible");
                f.Update(4, 3.15f);
                T.True(f.Weight[a] > 0f && f.Weight[a] < 1f, "early in the move the old name is half gone");
                T.Eq(f.Weight[1 - a], 0f, "the new name has not started");
                f.Update(4, 3.5f);
                T.True(f.Weight[a] == 0f && f.Weight[1 - a] == 0f, "halfway: no name at all, nothing trails behind");
                T.Eq(f.Index[a], 3, "old slot keeps its text while it fades");
                // never both visible, old only goes down, new only goes up
                float prevOld = 2f, prevNew = -1f;
                for (float p = 3f; p <= 4f; p += 0.01f)
                {
                    f.Update(4, p);
                    T.True(f.Weight[a] == 0f || f.Weight[1 - a] == 0f, "the two names never overlap p=" + p);
                    T.True(f.Weight[a] <= prevOld + 1e-6f, "old name only fades out p=" + p);
                    T.True(f.Weight[1 - a] >= prevNew - 1e-6f, "new name only fades in p=" + p);
                    prevOld = f.Weight[a]; prevNew = f.Weight[1 - a];
                }
                f.Update(4, 4f);
                T.Eq(f.Weight[a], 0f, "old name gone"); T.Eq(f.Weight[1 - a], 1f, "new name fully visible");
                T.Eq(f.Dirty, 0, "nothing re-typed during the move");
                // reversing while the old name is still fading: its slot is reused, nothing is re-typed
                var g = new LabelFader(); g.Update(3, 3f); g.ClearDirty();
                g.Update(4, 3.6f); g.ClearDirty();
                int slot3 = g.Index[0] == 3 ? 0 : 1;
                g.Update(3, 3.6f);
                T.Eq(g.TargetSlot, slot3, "back to the fading item: same slot"); T.Eq(g.Dirty, 0, "no text change on reverse");
                // a long jump: only the item left and the item reached are ever visible, nothing in between
                var j = new LabelFader(); j.Update(0, 0f); j.ClearDirty(); j.Update(20, 0f);
                for (float p = 0f; p <= 20f; p += 0.05f)
                {
                    j.Update(20, p);
                    for (int k = 0; k < 2; k++) T.True(j.Weight[k] >= 0f && j.Weight[k] <= 1f, "weight in range p=" + p);
                    if (p > 1.05f && p < 18.95f) T.True(j.Weight[0] == 0f && j.Weight[1] == 0f, "no name flashes in between p=" + p);
                }
                j.Update(20, 20f);
                T.Eq(j.Weight[j.TargetSlot], 1f, "the destination is fully shown at the end");
                f.Invalidate(); f.Update(4, 4f);
                T.Eq(f.Dirty & 1, 1, "after Invalidate the name is typed again");
            });

            T.Run("layout: icons grow in even steps so their centre never wobbles", () =>
            {
                T.Eq((DockLayout.FocusIcon - DockLayout.Icon) % 2, 0, "growth is an even number of pixels");
                var l = new DockLayout(13, 1920, 1080, 0, false, 11);
                int centre2 = 2 * l.IconBox(5, 5f, 0f, 0).X + l.IconBox(5, 5f, 0f, 0).W;
                for (float p = 4f; p <= 6f; p += 0.01f)
                {
                    var b = l.IconBox(5, p, 0f, 0);
                    T.Eq(b.W % 2, 0, "even size at p=" + p);
                    T.Eq(2 * b.X + b.W, 2 * l.IconBox(5, 0f, 0f, 0).X + l.IconBox(5, 0f, 0f, 0).W, "centre fixed at p=" + p);
                    T.Eq(b.W, b.H, "square at p=" + p);
                }
                T.Eq(l.IconBox(5, 5f, 0f, 0).W, DockLayout.FocusIcon, "focused size reached");
                T.Eq(l.IconBox(5, 0f, 0f, 0).W, DockLayout.Icon, "rest size reached");
            });

            T.Run("layout: the label stays under the focused icon; the clock yields", () =>
            {
                foreach (int n in new[] { 5, 13, 30 })
                {
                    var l = new DockLayout(n, 1920, 1080);
                    for (int p = 0; p <= n - 1; p++)
                    {
                        float sc = l.ScrollFor(p);
                        var ib = l.IconBox(p, p, sc, 0);
                        int iconCx = l.LabelCenterX(p, sc);
                        T.True(Math.Abs(iconCx - (ib.X + ib.W / 2)) <= 1, "label centre is the icon centre n=" + n + " p=" + p);
                        foreach (int w in new[] { 60, 120, 180, 210 })
                        {
                            if (w > l.PillW - 2 * DockLayout.PadX) continue;
                            int x = l.LabelLeft(p, sc, w);
                            // whatever the neighbourhood of the clock, a label that fits is still under its icon
                            T.True(Math.Abs((x + w / 2) - iconCx) <= DockLayout.FocusIcon / 2 || x == l.Left + DockLayout.PadX || x + w == l.Left + l.PillW - DockLayout.PadX,
                                "label centre under the icon (or pinned to the pill edge) n=" + n + " p=" + p + " w=" + w);
                            T.True(x >= l.Left + DockLayout.PadX && x + w <= l.Left + l.PillW - DockLayout.PadX, "label inside the pill n=" + n + " w=" + w);
                            // the clock is the one that gives way: shown only when the two boxes do not touch
                            bool clear = l.ClockClear(x, w, 62);
                            bool touches = x + w + DockLayout.ClockGap > l.ClockRight - 62;
                            T.Eq(clear, !touches, "clock hides exactly when it would touch the label n=" + n + " w=" + w);
                        }
                    }
                    T.True(l.ClockRight <= l.Left + l.PillW - DockLayout.PadX, "clock inside the pill");
                }
                // a label under an early item leaves the clock alone; the last item's long label hides it
                var apps = new DockLayout(13, 1920, 1080);
                T.True(apps.ClockClear(apps.LabelLeft(0, 0f, 100), 100, 62), "first item: clock shown");
                T.True(!apps.ClockClear(apps.LabelLeft(12, apps.ScrollFor(12f), 150), 150, 62), "last item with a long label: clock hidden");
            });

            T.Run("controller: panel page keys", () =>
            {
                var apps = new DockLayout(13, 1920, 1080);
                var inputs = new DockLayout(5, 1920, 1080, apps.WinW);
                var a = new Controller(apps) { PanelEnabled = true };
                var p = new Controller(inputs, PageKind.Panel);
                a.Show(); p.Show();
                int idx;
                T.Eq(a.Key("Up", out idx), KeyAction.OpenPanel, "Up on apps opens the panel");
                T.Eq(a.Key("Down", out idx), KeyAction.None, "Down on apps does nothing");
                T.Eq(a.Key("XF86Back", out idx), KeyAction.Hide, "Back on apps hides");
                T.Eq(p.Key("Up", out idx), KeyAction.None, "Up in the panel does nothing");
                T.Eq(p.Key("Down", out idx), KeyAction.Back, "Down in the panel goes back");
                T.Eq(p.Key("XF86Back", out idx), KeyAction.Back, "Back in the panel goes back, it does not hide");
                T.Eq(p.Key("Escape", out idx), KeyAction.Back, "Escape in the panel goes back");
                T.Eq(p.Key("XF86Home", out idx), KeyAction.Hide, "Home in the panel hides");
                T.Eq(p.Key("XF86Exit", out idx), KeyAction.Hide, "Exit in the panel hides");
                T.Eq(p.Key("Return", out idx), KeyAction.Launch, "OK launches");
                var plain = new Controller(apps);
                plain.Show();
                T.Eq(plain.Key("Up", out idx), KeyAction.None, "Up does nothing unless the panel is enabled");
            });

            T.Run("controller: switching pages keeps the dock visible", () =>
            {
                var apps = new DockLayout(13, 1920, 1080);
                var inputs = new DockLayout(5, 1920, 1080, apps.WinW);
                var a = new Controller(apps) { PanelEnabled = true };
                var p = new Controller(inputs, PageKind.Panel);
                a.Show();
                while (a.Tick(0.05)) { }
                T.Eq(a.Phase, Phase.Shown, "apps fully shown");
                p.AdoptVisibility(a, 0.55f);
                T.Eq(a.Phase, Phase.Hidden, "old page is hidden");
                T.Eq(a.Presence, 0f, "old page presence cleared");
                T.Eq(p.Phase, Phase.Showing, "new page rises in");
                T.True(p.Presence <= 0.55f && p.Presence > 0f, "new page starts partly in");
                T.True(p.IsActive, "new page counts as active");
                while (p.Tick(0.05)) { }
                T.Eq(p.Phase, Phase.Shown, "new page ends fully shown");
                // a hidden dock hands over a hidden dock
                var h1 = new Controller(apps); var h2 = new Controller(inputs, PageKind.Panel);
                h2.AdoptVisibility(h1, 0.55f);
                T.Eq(h2.Phase, Phase.Hidden, "hidden stays hidden");
                // SetFocus is immediate and clamped
                p.SetFocus(3);
                T.True(p.FocusTarget == 3 && p.FocusPos == 3f, "SetFocus jumps");
                p.SetFocus(99);
                T.Eq(p.FocusTarget, 4, "SetFocus clamps high");
                p.SetFocus(-5);
                T.Eq(p.FocusTarget, 0, "SetFocus clamps low");
            });

            T.Run("catalog caps entries", () =>
            {
                var sb = new StringBuilder();
                for (int i = 0; i < Catalog.MaxEntries + 5; i++) sb.Append("a" + i + "\tA\tx.y\n");
                var r = Catalog.Parse(sb.ToString());
                T.Eq(r.Entries.Length, Catalog.MaxEntries, "capped");
                T.Eq(r.Problems.Length, 5, "overflow reported");
            });

            T.Run("layout: window is a small strip at the bottom centre", () =>
            {
                var l = new DockLayout(11, 1920, 1080);
                // 264 for the pill and its shadow margins, plus the HintH band for the "Input" / "Back" hint.
                T.True(l.WinW < 1920 && l.WinH < 330, "window much smaller than the screen: " + l.WinW + "x" + l.WinH);
                T.Eq(l.WinH, l.PillH + 2 * DockLayout.Margin + DockLayout.HintH, "window = pill + shadow margins + hint band");
                T.Eq(l.WinX, (1920 - l.WinW) / 2, "centred");
                T.Eq(l.WinY + l.WinH + DockLayout.BottomGap, 1080, "sits at the bottom");
                T.True(!l.Scrolls, "11 apps fit without scrolling");
                T.Eq(l.ViewportW, l.ContentW, "viewport == content when it fits");
            });

            T.Run("layout: many items scroll and stay inside the screen", () =>
            {
                var l = new DockLayout(30, 1920, 1080);
                T.True(l.Scrolls, "scrolls");
                T.True(l.WinX >= 0 && l.WinX + l.WinW <= 1920, "window inside screen");
                T.Eq(l.ScrollFor(0f), 0f, "starts at 0");
                T.Eq(l.ScrollFor(29f), (float)(l.ContentW - l.ViewportW), "ends flush");
                float mid = l.ScrollFor(15f);
                T.True(mid > 0 && mid < l.ContentW - l.ViewportW, "middle is interior");
                float prev = -1;
                for (float p = 0; p <= 29; p += 0.25f)
                {
                    float s = l.ScrollFor(p);
                    T.True(s >= prev, "scroll is monotonic");
                    prev = s;
                }
            });

            T.Run("layout: small screens and a single item do not break", () =>
            {
                var one = new DockLayout(1, 1280, 720);
                T.True(one.WinW > 0 && one.ViewportW > 0, "single item");
                T.Eq(one.ScrollFor(0f), 0f, "no scroll");
                bool threw = false;
                try { new DockLayout(0, 1920, 1080); } catch (ArgumentOutOfRangeException) { threw = true; }
                T.True(threw, "zero items rejected");
            });

            T.Run("layout: focus amount and icon sizes", () =>
            {
                var l = new DockLayout(5, 1920, 1080);
                T.Eq(DockLayout.Amount(2f, 2), 1f, "focused");
                T.Eq(DockLayout.Amount(2f, 3), 0f, "neighbour");
                T.Eq(DockLayout.Amount(2.5f, 2), 0.5f, "halfway");
                T.Eq(l.IconBox(2, 2f, 0f, 0).W, DockLayout.FocusIcon, "focused icon is large");
                T.Eq(l.IconBox(0, 2f, 0f, 0).W, DockLayout.Icon, "others are base size");
                var a = l.IconBox(1, 1f, 0f, 0);
                var b = l.IconBox(2, 1f, 0f, 0);
                T.Eq(b.X + b.W / 2 - (a.X + a.W / 2), DockLayout.Pitch, "pitch between centres");
                T.Eq(l.IconBox(0, 0f, 0f, 30).Y - l.IconBox(0, 0f, 0f, 0).Y, 30, "slide shifts everything");
                var h = l.GlowBox(1, 0f, 0);
                var f = l.IconBox(1, 1f, 0f, 0);
                T.Eq(h.X + h.W / 2, f.X + f.W / 2, "glow centred on focused icon");
                int g1, g2; float gw;
                l.GlowAt(2f, out g1, out g2, out gw);
                T.True(g1 == 2 && gw == 0f, "at rest the glow is on the focused icon only");
                l.GlowAt(2.25f, out g1, out g2, out gw);
                T.True(g1 == 2 && g2 == 3 && Math.Abs(gw - 0.25f) < 1e-6f, "in between: the glow fades from icon 2 to icon 3");
                l.GlowAt(-1f, out g1, out g2, out gw); T.True(g1 == 0 && gw == 0f, "before the start: first icon");
                l.GlowAt(99f, out g1, out g2, out gw); T.True(g1 == l.Count - 1 && g2 == g1 && gw == 0f, "past the end: last icon, no second glow");
                // the glow's box on an icon never depends on the focus: it does not travel
                T.Eq(l.GlowBox(3, 0f, 0).X, l.GlowBox(3, 0f, 0).X, "glow box depends only on the item");
            });

            T.Run("layout: highlight and label are never cut or crowd the pill edge", () =>
            {
                foreach (int n in new[] { 2, 11, 30 })
                {
                    var l = new DockLayout(n, 1920, 1080);
                    int clipL = l.ViewLeft - DockLayout.ClipPad, clipR = l.ViewRight + DockLayout.ClipPad;
                    for (float p = 0; p <= n - 1; p += 0.25f)
                    {
                        float sc = l.ScrollFor(p);
                        var h = l.GlowBox((int)Math.Round(p), sc, 0);
                        T.True(h.X >= 0 && h.X + h.W <= l.WinW, "glow inside the window n=" + n + " p=" + p);
                        var ic = l.IconBox((int)Math.Round(p), p, sc, 0);
                        T.True(ic.X >= clipL && ic.X + ic.W <= clipR, "focused icon not cut by the apps clipper n=" + n + " p=" + p);
                        foreach (int w in new[] { 60, 260, 400 })
                        {
                            if (w > l.PillW - 2 * DockLayout.PadX) continue;   // does not fit: covered by the centring check below
                            int x = l.LabelLeft((int)Math.Round(p), sc, w);
                            T.True(x >= DockLayout.Margin + DockLayout.PadX && x + w <= DockLayout.Margin + l.PillW - DockLayout.PadX, "label inset n=" + n + " w=" + w);
                        }
                    }
                }
                var wide = new DockLayout(2, 1920, 1080);
                int lw = wide.PillW;   // wider than the interior: centred, not thrown off
                T.Eq(wide.LabelLeft(0, 0f, lw), DockLayout.Margin, "oversized label is centred in the pill");
            });

            T.Run("layout: focused icon never leaves the pill", () =>
            {
                foreach (int n in new[] { 1, 2, 5, 11, 30 })
                {
                    var l = new DockLayout(n, 1920, 1080);
                    for (float p = 0; p <= n - 1; p += 0.5f)
                    {
                        float s = l.ScrollFor(p);
                        int i = (int)Math.Round(p);
                        var b = l.IconBox(i, p, s, 0);
                        T.True(b.X >= DockLayout.Margin && b.X + b.W <= DockLayout.Margin + l.PillW, "n=" + n + " focus " + p + " inside pill");
                    }
                }
            });

            T.Run("controller: starts hidden, shows, ends shown", () =>
            {
                DockLayout l; var c = NewController(5, out l);
                T.Eq(c.Phase, Phase.Hidden, "initial");
                T.True(c.Show(), "show changes phase");
                T.True(!c.Show(), "second show is a no-op");
                int frames = 0;
                while (c.Tick(1 / 60.0) && frames < 1000) frames++;
                T.Eq(c.Phase, Phase.Shown, "reached shown");
                T.True(frames > 5 && frames < 40, "intro takes a sane number of frames: " + frames);
                T.Eq(c.Presence, 1f, "fully present");
                T.Eq(c.Slide, 0, "no slide when shown");
            });

            T.Run("controller: idle means no more frames", () =>
            {
                DockLayout l; var c = NewController(5, out l);
                c.Show();
                while (c.Tick(1 / 60.0)) { }
                T.True(!c.Tick(1 / 60.0), "settled controller asks for no frame");
                var h = NewController(5, out l);
                T.True(!h.Tick(1 / 60.0), "hidden controller asks for no frame");
            });

            T.Run("controller: hide runs and ends hidden", () =>
            {
                DockLayout l; var c = NewController(5, out l);
                c.Show(); while (c.Tick(1 / 60.0)) { }
                T.True(c.Hide(), "hide changes phase");
                T.True(!c.Hide(), "second hide is a no-op");
                int n = 0; while (c.Tick(1 / 60.0) && n < 1000) n++;
                T.Eq(c.Phase, Phase.Hidden, "hidden");
                T.Eq(c.Presence, 0f, "fully away");
                T.Eq(c.Slide, DockLayout.SlideDistance, "tucked below");
            });

            T.Run("controller: reversing mid-animation is continuous", () =>
            {
                DockLayout l; var c = NewController(5, out l);
                c.Show();
                for (int i = 0; i < 6; i++) c.Tick(1 / 60.0);
                float mid = c.Presence;
                T.True(mid > 0f && mid < 1f, "mid-intro");
                c.Hide();
                c.Tick(1 / 60.0);
                T.True(c.Presence < mid, "turns around without a jump");
                c.Show();
                c.Tick(1 / 60.0);
                T.Eq(c.Phase, Phase.Showing, "show during hide resumes showing");
            });

            T.Run("controller: keys move focus, clamp at the ends", () =>
            {
                DockLayout l; var c = NewController(3, out l);
                c.Show(); while (c.Tick(1 / 60.0)) { }
                int idx;
                T.Eq(c.Key("Left", out idx), KeyAction.None, "left at start does nothing");
                T.Eq(c.Key("Right", out idx), KeyAction.Moved, "right moves");
                T.Eq(c.Key("Right", out idx), KeyAction.Moved, "right moves again");
                T.Eq(c.Key("Right", out idx), KeyAction.None, "right at end does nothing");
                T.Eq(c.FocusTarget, 2, "focus at last");
                T.Eq(c.Key("Home", out idx), KeyAction.Moved, "Home jumps to start");
                T.Eq(c.FocusTarget, 0, "at first");
                T.Eq(c.Key("End", out idx), KeyAction.Moved, "End jumps to last");
                T.Eq(c.FocusTarget, 2, "at last again");
            });

            T.Run("controller: OK launches the focused item", () =>
            {
                DockLayout l; var c = NewController(4, out l);
                c.Show(); while (c.Tick(1 / 60.0)) { }
                int idx;
                c.Key("Right", out idx); c.Key("Right", out idx);
                T.Eq(c.Key("Return", out idx), KeyAction.Launch, "return launches");
                T.Eq(idx, 2, "index of focused item");
                T.Eq(c.Key("KP_Enter", out idx), KeyAction.Launch, "keypad enter launches");
            });

            T.Run("controller: back/home/exit hide, unknown keys ignored", () =>
            {
                DockLayout l; var c = NewController(4, out l);
                c.Show(); while (c.Tick(1 / 60.0)) { }
                int idx;
                foreach (string k in new[] { "Escape", "XF86Back", "XF86Home", "XF86Exit" })
                    T.Eq(c.Key(k, out idx), KeyAction.Hide, k + " hides");
                foreach (string k in new[] { "Up", "Down", "a", "XF86AudioMute", "", null })
                    T.Eq(c.Key(k, out idx), KeyAction.None, "ignored: " + (k ?? "null"));
            });

            T.Run("controller: keys are ignored while hidden or hiding", () =>
            {
                DockLayout l; var c = NewController(4, out l);
                int idx;
                T.Eq(c.Key("Right", out idx), KeyAction.None, "hidden ignores right");
                T.Eq(c.Key("Return", out idx), KeyAction.None, "hidden ignores return");
                c.Show(); while (c.Tick(1 / 60.0)) { }
                c.Hide();
                T.Eq(c.Key("Return", out idx), KeyAction.None, "hiding ignores return");
            });

            T.Run("controller: focus converges and scroll follows", () =>
            {
                DockLayout l; var c = NewController(30, out l);
                c.Show(); while (c.Tick(1 / 60.0)) { }
                int idx;
                for (int i = 0; i < 20; i++) c.Key("Right", out idx);
                int frames = 0;
                float lastScroll = c.Scroll;
                while (c.Tick(1 / 60.0) && frames < 2000)
                {
                    T.True(c.Scroll >= lastScroll, "scroll never goes backwards while moving right");
                    lastScroll = c.Scroll;
                    frames++;
                }
                T.Eq(c.FocusPos, 20f, "snaps exactly to the target");
                T.Eq(c.Scroll, l.ScrollFor(20f), "scroll matches the final focus");
                T.True(frames < 120, "settles in under two seconds: " + frames);
            });

            T.Run("controller: the focus eases in and out like a critically damped spring", () =>
            {
                DockLayout l; var c = NewController(10, out l);
                c.Linear = false;
                c.Show(); while (c.Tick(1 / 60.0)) { }
                int idx; c.Key("Right", out idx);
                float prev = c.FocusPos, prevStep = 0f, firstStep = -1f, maxStep = 0f; int frames = 0;
                while (c.Tick(1 / 120.0) && frames < 2000)
                {
                    float step = c.FocusPos - prev;
                    T.True(step >= -1e-6f, "never goes backwards");
                    T.True(c.FocusPos <= 1f + 1e-5f, "never overshoots a start from rest");
                    if (firstStep < 0f) firstStep = step;
                    if (step > maxStep) maxStep = step;
                    prev = c.FocusPos; prevStep = step; frames++;
                }
                T.True(firstStep < maxStep * 0.35f, "starts gently: first step " + firstStep + " vs peak " + maxStep);
                T.Eq(c.FocusPos, 1f, "rests exactly on the target");
                T.True(frames < 120 * 1 && frames > 20, "settles in well under a second, not instantly: " + frames);
                T.True(!c.Tick(1 / 60.0), "no frame is requested once at rest");
                // retargeting while moving keeps the position continuous (velocity carries over)
                var d = NewController(10, out l); d.Linear = false; d.Show(); while (d.Tick(1 / 60.0)) { }
                d.Key("Right", out idx); for (int i = 0; i < 6; i++) d.Tick(1 / 60.0);
                float before = d.FocusPos; d.Key("Right", out idx); d.Tick(1 / 600.0);
                T.True(Math.Abs(d.FocusPos - before) < 0.02f, "retarget does not jump");
            });

            T.Run("controller: animation is frame-rate independent", () =>
            {
                DockLayout l1, l2;
                var a = NewController(10, out l1); var b = NewController(10, out l2);
                a.Show(); b.Show();
                while (a.Tick(1 / 30.0)) { }
                while (b.Tick(1 / 120.0)) { }
                int idx;
                a.Key("Right", out idx); a.Key("Right", out idx); a.Key("Right", out idx);
                b.Key("Right", out idx); b.Key("Right", out idx); b.Key("Right", out idx);
                for (int i = 0; i < 15; i++) a.Tick(1 / 30.0);   // 0.5 s
                for (int i = 0; i < 60; i++) b.Tick(1 / 120.0);  // 0.5 s
                T.True(Math.Abs(a.FocusPos - b.FocusPos) < 0.02f, "same position after 0.5 s at 30 and 120 fps: " + a.FocusPos + " vs " + b.FocusPos);
            });

            T.Run("controller: a stalled frame cannot teleport the animation", () =>
            {
                DockLayout l; var c = NewController(5, out l);
                c.Show();
                c.Tick(5.0);   // 5 s hiccup is clamped
                T.True(c.Presence < 1f, "intro not skipped by a long frame");
                c.Tick(-1.0);
                T.True(c.Presence >= 0f, "negative dt tolerated");
            });

            T.Run("commands: show hide toggle", () =>
            {
                var b = new CommandBuffer();
                var r = b.Feed(Encoding.ASCII.GetBytes("show\nhide\ntoggle\n"), 16 + 1);
                T.Eq(r.Count, 3, "three commands");
                T.Eq(r[0], Command.Show, "show"); T.Eq(r[1], Command.Hide, "hide"); T.Eq(r[2], Command.Toggle, "toggle");
            });

            T.Run("commands: the volume keys", () =>
            {
                var b = new CommandBuffer();
                var bytes = Encoding.ASCII.GetBytes("volup\nVOLDOWN\n volmute \nvolume\n");
                var r = b.Feed(bytes, bytes.Length);
                T.Eq(r.Count, 3, "three volume commands, the unknown word is dropped");
                T.Eq(r[0], Command.VolUp, "up"); T.Eq(r[1], Command.VolDown, "down"); T.Eq(r[2], Command.VolMute, "mute");
            });

            T.Run("number pad: digits page, colour page, Done, keys, commands", () =>
            {
                var m = new NumberPadModel();
                m.Reset();
                T.Eq(m.Page, NumberPadModel.DigitsPage, "opens on the digits"); T.Eq(m.Focus, 0, "on 1");
                T.Eq(m.Key("Left"), PadResult.None, "nothing before the first");
                T.Eq(m.Key("Return"), PadResult.Typed, "OK types 1");
                for (int i = 0; i < 5; i++) m.Key("Right");
                m.Key("Return"); T.Eq(m.Typed, "16", "sixteen");
                T.Eq(m.Key("Return"), PadResult.Typed, "the same cell twice"); T.Eq(m.Typed, "166", "166");
                for (int i = 0; i < 5; i++) m.Key("Right");
                T.Eq(m.Current.Label, "-", "the eleventh cell is the dash"); T.Eq(m.Key("Return"), PadResult.Typed, "a dash"); T.Eq(m.Typed, "166-", "dash after digits");
                T.Eq(m.Key("Return"), PadResult.None, "no double dash");
                m.Key("Right"); T.Eq(m.Current.Kind, CellKind.Erase, "backspace"); T.Eq(m.Key("Return"), PadResult.Erased, "erase"); T.Eq(m.Typed, "166", "back");
                m.Key("Right"); T.Eq(m.Current.Kind, CellKind.ToColors, "colour page cell"); T.Eq(m.Key("Right"), PadResult.None, "nothing after it");
                T.Eq(m.Key("Up"), PadResult.Moved, "Up reaches Done"); T.True(m.OnDone, "on Done"); T.Eq(m.Key("Left"), PadResult.None, "Left does nothing on Done");
                T.Eq(m.Key("Return"), PadResult.Send, "Done sends what is typed");
                T.Eq(m.Key("Down"), PadResult.Moved, "Down returns to the row"); T.True(!m.OnDone, "off Done");
                T.Eq(m.Key("Return"), PadResult.Page, "to the colour page"); T.Eq(m.Page, NumberPadModel.ColorsPage, "colours");
                T.Eq(m.Current.Tip, "Red A", "opens on the red key"); T.Eq(m.Key("Up"), PadResult.None, "no Done on this page");
                T.Eq(m.Key("Return"), PadResult.SendKey, "a colour key is sent at once"); T.Eq(m.PendingKey, "XF86Red", "red");
                for (int i = 0; i < 6; i++) m.Key("Right");
                T.Eq(m.Current.Tip, "Info", "info is the last cell"); T.Eq(m.Key("Right"), PadResult.None, "nothing after it");
                m.Key("Return"); T.Eq(m.PendingKey, "XF86Info", "info key");
                for (int i = 0; i < 12; i++) m.Key("Left");
                T.Eq(m.Current.Kind, CellKind.ToDigits, "back to the digits cell"); T.Eq(m.Key("Return"), PadResult.Page, "back"); T.Eq(m.Page, NumberPadModel.DigitsPage, "digits again");
                T.Eq(m.Key("XF86Back"), PadResult.Close, "Back closes");
                m.Reset(); T.Eq(m.Typed, "", "reset clears"); m.Key("Up"); T.Eq(m.Key("Return"), PadResult.Close, "Done with nothing typed just closes");
                m.Reset(); for (int i = 0; i < 8; i++) m.Key("5");
                T.Eq(m.Typed, "55555", "at most five characters"); T.Eq(m.Key("BackSpace"), PadResult.Erased, "BackSpace erases");
                T.Eq(NumberPadModel.BodyWidth(NumberPadModel.Digits), 1008, "digits capsule width"); T.Eq(NumberPadModel.Digits[NumberPadModel.Digits.Length - 1].Mark, "pad_colors_dots", "the palette key carries the picture of its four coloured dots"); T.True(NumberPadModel.BodyWidth(NumberPadModel.Colors) <= 800, "colour capsule fits");
                string c16 = NumberPadModel.SendCommand("16", "/usr/bin/input_keyevent ");
                T.True(c16.StartsWith("(sleep 0.25; p=$(cat /home/owner/vetro-tuner.pid"), "the tuner is looked for first");
                T.True(c16.Contains("then echo 'tune 16' > /tmp/vetro-tuner.ctl; else"), "tuner running: one tune command with the whole number");
                T.True(c16.Contains("else /usr/bin/input_keyevent 1; /usr/bin/input_keyevent 6; fi)"), "no tuner: keys by name");
                T.True(c16.Contains("[ -e /tmp/vetro-tuner.ctl.tv ]"), "digits go to the tuner only while Samsung's live TV is in front; over Netflix they are keys for that app");
                int thenAt = c16.IndexOf("then"), elseAt = c16.IndexOf("else");
                T.True(!c16.Substring(thenAt, elseAt - thenAt).Contains("input_keyevent"), "with the tuner running Samsung's TV app is never asked for");
                T.True(NumberPadModel.SendCommand("0", "k ").Contains("echo 'tune 0'"), "a zero is passed on");
                string cd = NumberPadModel.SendCommand("1-2", "k ");
                T.True(cd.Contains("else k 1; k minus; k 2; fi)") && cd.Contains("echo 'tune 12'"), "the dash is minus by name and not given to the tuner");
                string cx = NumberPadModel.SendCommand("1;rm", "k ");
                T.True(cx.Contains("else k 1; fi)") && !cx.Contains("rm"), "only digits reach the shell");
                T.Eq(NumberPadModel.SendCommand("-", "k "), "(sleep 0.25; k minus) >/dev/null 2>&1 &", "a lone dash has no tuner part");
                T.Eq(NumberPadModel.SendCommand("", "k "), "(sleep 0.25) >/dev/null 2>&1 &", "nothing typed, nothing sent");
                string cr = NumberPadModel.SendKeyCommand("XF86Red", "k ");
                T.True(cr.Contains("[ -e /tmp/vetro-tuner.ctl.shown ] && [ -p /tmp/vetro-tuner.ctl ]; then echo hide > /tmp/vetro-tuner.ctl; sleep 0.3; fi; k XF86Red)"),
                    "a colour key: the tuner on screen steps aside first (its window would swallow the named key), then the key goes to Samsung's live TV app");
                T.True(NumberPadModel.SendKeyCommand("XF86TTXMIX", "k ").Contains("echo hide > /tmp/vetro-tuner.ctl") && NumberPadModel.ForLiveTv("XF86Blue"), "teletext and every colour key do the same");
                T.Eq(NumberPadModel.SendKeyCommand("XF86Sleep", "k "), "(sleep 0.25; k XF86Sleep) >/dev/null 2>&1 &", "the sleep timer is not live TV's: sent as it is");
                string ci = NumberPadModel.SendKeyCommand("XF86Info", "k ");
                T.True(ci.Contains("[ -e /tmp/vetro-tuner.ctl.shown ]") && ci.Contains("[ -p /tmp/vetro-tuner.ctl ]") && ci.Contains("then echo info > /tmp/vetro-tuner.ctl; else k XF86Info; fi)"), "Info goes to the tuner on screen and by name otherwise");
                T.True(!NumberPadModel.SendKeyCommand("XF86Sleep", "k ").Contains("tuner") && !NumberPadModel.ForLiveTv("XF86Sleep") && !NumberPadModel.ForLiveTv("XF86Info"), "the other function keys never go to the tuner");
                T.True(c16.Contains("[ -p /tmp/vetro-tuner.ctl ]"), "digits go to the tuner only through a real pipe (a stale plain file is never written)");
                foreach (string cmd in new[] { c16, cr, ci, NumberPadModel.SendKeyCommand("XF86Sleep", "k "), NumberPadModel.SendCommand("12", "k ") })
                {
                    if (!System.IO.File.Exists("/bin/sh")) break;
                    var psi = new System.Diagnostics.ProcessStartInfo("/bin/sh") { RedirectStandardError = true, UseShellExecute = false };
                    psi.ArgumentList.Add("-n"); psi.ArgumentList.Add("-c"); psi.ArgumentList.Add(cmd);
                    using (var sh = System.Diagnostics.Process.Start(psi)) { string err = sh.StandardError.ReadToEnd(); sh.WaitForExit(); T.True(sh.ExitCode == 0, "the pad's shell line parses: " + cmd + " " + err); }
                }
                T.Eq(NumberPadModel.SendKeyCommand("x; rm -rf /", "k "), "(sleep 0.25) >/dev/null 2>&1 &", "a bad key name sends nothing");
                var b = new CommandBuffer(); var bytes = Encoding.ASCII.GetBytes("pad\n"); T.Eq(b.Feed(bytes, bytes.Length)[0], Command.Pad, "pad command");
                var rb = Encoding.ASCII.GetBytes("rescan\n"); T.Eq(new CommandBuffer().Feed(rb, rb.Length)[0], Command.Rescan, "rescan command (the remote bridge made a new forwarding node)");
                var rl = Encoding.ASCII.GetBytes("reload\n"); T.Eq(new CommandBuffer().Feed(rl, rl.Length)[0], Command.Reload, "reload command (Vetro wrote the app lists again)");
                // ListWatch: ask Vetro for the lists only when the package database is newer than them, once per change of the database.
                var t0 = new DateTime(2026, 11, 18, 10, 0, 0, DateTimeKind.Utc);
                T.True(!ListWatch.ShouldAsk(t0, t0.AddSeconds(5), DateTime.MinValue, 1e9), "lists newer than the database: nothing to ask");
                T.True(!ListWatch.ShouldAsk(t0, t0, DateTime.MinValue, 1e9), "the same second: nothing to ask");
                T.True(ListWatch.ShouldAsk(t0.AddSeconds(5), t0, DateTime.MinValue, 0), "an app installed after the lists were written: ask");
                T.True(!ListWatch.ShouldAsk(t0.AddSeconds(5), t0, t0.AddSeconds(5), 10), "the same change, asked 10 s ago: not again");
                T.True(ListWatch.ShouldAsk(t0.AddSeconds(5), t0, t0.AddSeconds(5), ListWatch.RetrySeconds), "asked long ago and still not answered: ask again");
                T.True(ListWatch.ShouldAsk(t0.AddSeconds(9), t0, t0.AddSeconds(5), 10), "another install since the last question: ask");
                T.True(!ListWatch.ShouldAsk(DateTime.MinValue, t0, DateTime.MinValue, 1e9) && !ListWatch.ShouldAsk(t0, DateTime.MinValue, DateTime.MinValue, 1e9), "a missing file never asks");
                T.Eq(ListWatch.Command(8099), "( /usr/bin/curl -sf -m 60 -X POST 'http://127.0.0.1:8099/plugins/launcher/api/relist' >/dev/null 2>&1 ) &", "the question goes to the service in the background");
                T.True(ListWatch.Command(0) == null && ListWatch.Command(70000) == null, "no port, no question");
                var la = Catalog.Parse("netflix\tNetflix\torg.tizen.netflix-app\t\t\t\t\tapp:org.tizen.netflix-app\nstore\tApp store\tsys:com.samsung.tv.store").Entries;
                var lb = Catalog.Parse("netflix\tNetflix\torg.tizen.netflix-app\t\t\t\t\tapp:org.tizen.netflix-app\nstore\tApp store\tsys:com.samsung.tv.store").Entries;
                var lc = Catalog.Parse("netflix\tNetflix\torg.tizen.netflix-app\t\t\t\t\tapp:org.tizen.netflix-app\ntvstore\tTV-Store\tsys:A2STVStore.Store\tcom.samsung.tv.store").Entries;
                T.True(ListWatch.Same(la, lb), "two readings of the same list are the same pages");
                T.True(!ListWatch.Same(la, lc), "the store pill changed: the pages are made again");
                T.True(!ListWatch.Same(la, new[] { la[0] }), "an app removed: the pages are made again");
                T.Eq(lc[1].AppId + "|" + lc[1].FallbackAppId + "|" + lc[1].SystemApp, "A2STVStore.Store|com.samsung.tv.store|True", "the TV-Store pill opens TV-Store, Samsung's store when it does not start");
                string flag = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "vetro-flag-test-" + System.Diagnostics.Process.GetCurrentProcess().Id);
                OverlayFlag.Mark(flag, true, null);
                T.Eq(System.IO.File.ReadAllText(flag), System.Diagnostics.Process.GetCurrentProcess().Id.ToString(), "an overlay flag names the launcher's pid (the tuner ignores a flag whose launcher is dead)");
                OverlayFlag.Mark(flag, false, null);
                T.True(!System.IO.File.Exists(flag), "an overlay flag is removed when its window goes");
                OverlayFlag.Mark("/nonexistent-dir/x/flag", true, null);   // never throws
                T.Eq(OverlayFlag.DockPath, "/tmp/vetro-dock.open", "the Dock's flag path (tuner/src/Core/OverlayFlag.cs reads the same)");
                T.Eq(OverlayFlag.PadPath, "/tmp/vetro-numpad.open", "the osd 123's flag path (tuner/src/Core/OverlayFlag.cs reads the same)");
            });

            T.Run("volume model: step, clamp, mute, picture, bar", () =>
            {
                T.Eq(VolumeModel.Next(50, 1, 1), 51, "up"); T.Eq(VolumeModel.Next(50, -1, 1), 49, "down");
                T.Eq(VolumeModel.Next(100, 1, 1), 100, "no more than 100"); T.Eq(VolumeModel.Next(0, -1, 1), 0, "no less than 0");
                T.Eq(VolumeModel.IconLevel(0, false), 0, "silent"); T.Eq(VolumeModel.IconLevel(30, true), 0, "muted");
                T.Eq(VolumeModel.IconLevel(20, false), 1, "low"); T.Eq(VolumeModel.IconLevel(80, false), 2, "loud");
                T.Eq(VolumeModel.FillHeight(0, false, 280), 0, "no bar at 0"); T.Eq(VolumeModel.FillHeight(60, true, 280), 0, "no bar when muted");
                T.Eq(VolumeModel.FillHeight(1, false, 280), 3, "a low level is a low fill"); T.Eq(VolumeModel.FillHeight(10, false, 280), 28, "ten percent");
                T.Eq(VolumeModel.FillHeight(50, false, 280), 140, "half");
                for (int v = 2; v <= 100; v++) T.True(VolumeModel.FillHeight(v, false, 280) > VolumeModel.FillHeight(v - 1, false, 280), "every step moves the top edge at " + v); T.Eq(VolumeModel.FillHeight(100, false, 280), 280, "full");
            });

            T.Run("commands: partial lines wait, case and spaces tolerated", () =>
            {
                var b = new CommandBuffer();
                var x = Encoding.ASCII.GetBytes("  ToG");
                T.Eq(b.Feed(x, x.Length).Count, 0, "no newline yet");
                var y = Encoding.ASCII.GetBytes("GLE \n");
                var r = b.Feed(y, y.Length);
                T.Eq(r.Count, 1, "completed");
                T.Eq(r[0], Command.Toggle, "toggle");
            });

            T.Run("commands: junk and runaway lines are dropped", () =>
            {
                var b = new CommandBuffer();
                var junk = Encoding.ASCII.GetBytes("quit\nrm -rf /\n\nshow\n");
                var r = b.Feed(junk, junk.Length);
                T.Eq(r.Count, 1, "only show survives");
                var big = new byte[500];
                for (int i = 0; i < big.Length; i++) big[i] = (byte)'a';
                T.Eq(b.Feed(big, big.Length).Count, 0, "no newline, nothing emitted");
                var tail = Encoding.ASCII.GetBytes("show\nshow\n");
                var r2 = b.Feed(tail, tail.Length);
                T.Eq(r2.Count, 1, "overflowed line discarded, the next one works");
            });


            T.Run("evdev: key presses are decoded, releases and repeats ignored", () =>
            {
                var r = new EvdevReader(16);
                byte[] data = Concat(Rec(16, 1, 102, 1), Rec(16, 1, 102, 0), Rec(16, 1, 102, 2), Rec(16, 0, 0, 0), Rec(16, 1, 221, 1));
                var p = r.Feed(data, data.Length);
                T.Eq(p.Count, 2, "two presses");
                T.Eq(p[0], 102, "first code"); T.Eq(p[1], 221, "second code");
            });

            T.Run("evdev: a record split across reads is reassembled", () =>
            {
                var r = new EvdevReader(16);
                byte[] rec = Rec(16, 1, 364, 1);
                T.Eq(r.Feed(rec, 5).Count, 0, "first fragment");
                var tail = new byte[11]; Array.Copy(rec, 5, tail, 0, 11);
                var p = r.Feed(tail, 11);
                T.Eq(p.Count, 1, "completed");
                T.Eq(p[0], 364, "code above 255 survives");
                byte[] two = Concat(Rec(16, 1, 1, 1), Rec(16, 1, 2, 1));
                var q = r.Feed(two, 20);
                T.Eq(q.Count, 1, "one whole record in 20 bytes");
                var rest = new byte[12]; Array.Copy(two, 20, rest, 0, 12);
                T.Eq(r.Feed(rest, 12).Count, 1, "second record finishes");
            });

            T.Run("evdev: 24-byte records and bad sizes", () =>
            {
                var r = new EvdevReader(24);
                byte[] d = Rec(24, 1, 102, 1);
                T.Eq(r.Feed(d, d.Length)[0], 102, "64-bit layout");
                bool threw = false;
                try { new EvdevReader(20); } catch (ArgumentOutOfRangeException) { threw = true; }
                T.True(threw, "odd record size rejected");
                T.Eq(new EvdevReader().Feed(new byte[0], 0).Count, 0, "empty read");
            });

            T.Run("input devices: remote nodes are selected like Vetro does", () =>
            {
                string text =
                    "I: Bus=0019 Vendor=0001\nN: Name=\"sdp-mcirb\"\nH: Handlers=event0\n\n" +
                    "I: Bus=0003\nN: Name=\"MCE IR Keyboard/Mouse (sdp-mcirb)\"\nH: Handlers=kbd mouse0 event1\n\n" +
                    "I: Bus=0019\nN: Name=\"wt61p807 rc device\"\nH: Handlers=event2\n\n" +
                    "I: Bus=0019\nN: Name=\"wt61p807 panel key device\"\nH: Handlers=event3\n\n" +
                    "I: Bus=0005\nN: Name=\"Smart Control\"\nH: Handlers=kbd event4\n\n" +
                    "I: Bus=0003\nN: Name=\"Some Mouse\"\nH: Handlers=mouse1 event5\n\n" +
                    "I: Bus=0005 Vendor=04e8\nN: Name=\"Smart Control\"\nP: Phys=vetro-forwarded-remote\nH: Handlers=kbd event20\n\n" +
                    "I: Bus=0005\nN: Name=\"dummy-uinput\"\nH: Handlers=kbd event21\n";
                var nodes = InputDevices.RemoteNodes(text);
                T.Eq(nodes.Count, 4, "three remotes plus Vetro's forwarded one");
                T.Eq(nodes[3], "/dev/input/event20", "the forwarded node is watched (the grabbed remote goes silent)");
                T.Eq(nodes[0], "/dev/input/event0", "ir");
                T.Eq(nodes[1], "/dev/input/event2", "rc");
                T.Eq(nodes[2], "/dev/input/event4", "bluetooth remote");
                T.Eq(InputDevices.RemoteNodes(null).Count, 0, "null text");
                T.Eq(InputDevices.RemoteNodes("garbage").Count, 0, "garbage text");
            });

            T.Run("layout: the hint band changes the window, not where the apps pill sits", () =>
            {
                var apps = new DockLayout(13, 1920, 1080);
                var panel = new DockLayout(5, 1920, 1080, apps.WinW, true, -1);
                int pillTopScreen = apps.WinY + apps.Top;
                T.Eq(pillTopScreen, 1080 - DockLayout.BottomGap - DockLayout.Margin - apps.PillH, "apps pill keeps its distance from the screen bottom");
                T.Eq(panel.WinH, apps.WinH, "both pages share the window height");
                T.Eq(panel.WinY, apps.WinY, "and its position");
                T.Eq(apps.Top - panel.Top, DockLayout.HintH, "the panel pill sits one hint band higher");
                T.Eq(panel.Top, DockLayout.Margin, "raised pill starts right under the margin");
                T.Eq(apps.RowCenterY - panel.RowCenterY, DockLayout.HintH, "icon row follows the pill");
                T.Eq(apps.LabelTop(0) - panel.LabelTop(0), DockLayout.HintH, "label follows the pill");
                T.Eq(apps.PillBox(0).Y - panel.PillBox(0).Y, DockLayout.HintH, "pill box follows");
                T.Eq(apps.RimBox(0).Y - panel.RimBox(0).Y, DockLayout.HintH, "rim box follows");
                foreach (DockLayout l in new[] { apps, panel })
                {
                    Box rim = l.RimBox(0), pill = l.PillBox(0);
                    int w = Design.ShellBorderW;
                    T.True(rim.X == pill.X - w && rim.Y == pill.Y - w && rim.W == pill.W + 2 * w && rim.H == pill.H + 2 * w, "rim is the pill grown by the border width");
                    T.True(rim.X >= 0 && rim.Y >= 0 && rim.X + rim.W <= l.WinW && rim.Y + rim.H <= l.WinH, "rim inside the window");
                }
            });

            T.Run("layout: hint capsule sits clear of the pill, inside the window, centred", () =>
            {
                var apps = new DockLayout(13, 1920, 1080);
                var panel = new DockLayout(5, 1920, 1080, apps.WinW, true, -1);
                foreach (int w in new[] { 90, 118, 140 })
                {
                    int ax = apps.HintLeft(w), px = panel.HintLeft(w);
                    T.True(Math.Abs((ax + w / 2) - (apps.Left + apps.PillW / 2)) <= 1, "apps hint centred on its pill, w=" + w);
                    T.True(Math.Abs((px + w / 2) - (panel.Left + panel.PillW / 2)) <= 1, "panel hint centred on its pill, w=" + w);
                    T.True(ax >= 0 && ax + w <= apps.WinW && px >= 0 && px + w <= panel.WinW, "hint inside the window width, w=" + w);
                }
                int up = apps.HintTop(0), down = panel.HintTop(0);
                T.Eq(up + DockLayout.CapsuleH + (DockLayout.HintH - DockLayout.CapsuleH), apps.Top, "capsule above the apps pill, with its gap");
                T.True(up >= 0, "up hint inside the window top");
                T.Eq(down, panel.Top + panel.PillH + (DockLayout.HintH - DockLayout.CapsuleH), "back capsule below the raised panel pill, with its gap");
                T.True(down + DockLayout.CapsuleH <= panel.WinH, "back hint inside the window bottom");
                T.True(down >= apps.Top + 0, "back hint sits in the band the raised pill vacated");
                T.Eq(apps.HintTop(30) - up, 30, "hint follows the slide");
                T.Eq(panel.HintTop(30) - down, 30, "back hint follows the slide");
            });

            T.Run("layout: divider sits in the gap before the first system entry", () =>
            {
                var l = new DockLayout(10, 1920, 1080, 0, false, 8);
                T.Eq(l.GroupStart, 8, "group start kept");
                var d = l.DividerBox(l.ScrollFor(0f), 0);
                var left = l.IconBox(7, 0f, 0f, 0);        // neither focused: plain 104 px icons
                var right = l.IconBox(8, 0f, 0f, 0);
                int gapL = left.X + left.W, gapR = right.X;
                T.True(d.X >= gapL && d.X + d.W <= gapR, "divider inside the gap: " + d.X + ".." + (d.X + d.W) + " vs " + gapL + ".." + gapR);
                T.True(Math.Abs((d.X + d.W / 2.0) - (gapL + gapR) / 2.0) <= 1.0, "divider centred in the gap");
                T.Eq(d.Y + d.H / 2, l.RowCenterY, "divider centred on the icon row");
                T.True(d.H < DockLayout.Icon, "shorter than an icon");
                T.Eq(l.DividerBox(0f, 20).Y - l.DividerBox(0f, 0).Y, 20, "divider follows the slide");
                var many = new DockLayout(30, 1920, 1080, 0, false, 28);
                T.Eq(many.DividerBox(50f, 0).X, many.DividerBox(0f, 0).X, "divider stays put while the apps scroll");
                T.Eq(new DockLayout(5, 1920, 1080, 0, false, 0).GroupStart, -1, "group at 0 is no group");
                T.Eq(new DockLayout(5, 1920, 1080, 0, false, 5).GroupStart, -1, "group at count is no group");
                T.Eq(new DockLayout(5, 1920, 1080, 0, false, -3).GroupStart, -1, "negative is no group");
                T.True(!l.IsPinned(7) && l.IsPinned(8) && l.IsPinned(9), "the system entries after the divider are the pills");
                T.Eq(l.IconBox(8, 8f, 0f, 0).W, DockLayout.PillItemW, "a focused pill does not grow");
                T.Eq(l.GlowBox(8, 0f, 0).W, DockLayout.PillItemW + 2 * DockLayout.PillGlowPad, "its glow is the capsule size");
                var p1 = l.IconBox(8, 0f, 0f, 0); var p2 = l.IconBox(9, 0f, 0f, 0);
                T.Eq(p1.X, p2.X, "the pills are one column");
                T.Eq(p2.Y - (p1.Y + p1.H), DockLayout.PillItemGap, "stacked with the small gap");
                T.Eq((p1.Y + p2.Y + p2.H) / 2, l.RowCenterY, "the stack is centred on the icon row");
                T.True(p1.Y >= l.Top + DockLayout.PadTop - 20 && p2.Y + p2.H <= l.Top + DockLayout.PadTop + DockLayout.FocusIcon + 20, "inside the icon row band");
                T.Eq(l.PinnedW, DockLayout.PillItemW, "the pinned group is as wide as one pill");
                var nav = new Controller(l) { PanelEnabled = true };
                nav.Show(); int ni;
                nav.Key("End", out ni);
                T.Eq(nav.FocusTarget, 9, "End goes to the last pill");
                T.Eq(nav.Key("Up", out ni), KeyAction.Moved, "Up climbs the column"); T.Eq(nav.FocusTarget, 8, "top pill");
                T.Eq(nav.Key("Up", out ni), KeyAction.OpenPanel, "Up from the top pill opens the inputs page");
                T.Eq(nav.Key("Down", out ni), KeyAction.Moved, "Down goes to the lower pill"); T.Eq(nav.FocusTarget, 9, "bottom pill");
                T.Eq(nav.Key("Down", out ni), KeyAction.None, "nothing below the last pill");
                T.Eq(nav.Key("Right", out ni), KeyAction.None, "nothing to the right of the column");
                T.Eq(nav.Key("Left", out ni), KeyAction.Moved, "Left leaves the column"); T.Eq(nav.FocusTarget, 7, "for the last app");
                T.Eq(nav.Key("Right", out ni), KeyAction.Moved, "Right enters the column again"); T.Eq(nav.FocusTarget, 8, "at the top pill");
                T.True(!new DockLayout(5, 1920, 1080, 0, true, -1).IsPinned(4), "no group, nothing is round");
            });

            T.Run("layout: pinned system entries stay on screen while the apps scroll", () =>
            {
                var l = new DockLayout(22, 1920, 1080, 0, false, 20);   // 20 apps + Source + Settings
                T.Eq(l.AppCount, 20, "apps"); T.Eq(l.PinnedCount, 2, "pinned");
                T.True(l.Scrolls, "20 apps do not fit");
                T.Eq(l.ViewportW + DockLayout.GroupGap + l.PinnedW, l.PillW - 2 * DockLayout.PadX, "viewport, gap and pinned entries fill the pill");
                var rest = new[] { l.IconBox(20, 0f, 0f, 0), l.IconBox(21, 0f, 0f, 0) };
                for (float p = 0f; p <= 21f; p += 0.25f)
                {
                    float sc = l.ScrollFor(p);
                    for (int k = 0; k < 2; k++)
                    {
                        var b = l.IconBox(20 + k, 0f, sc, 0);
                        T.Eq(b.X, rest[k].X, "pinned entry does not move, k=" + k + " p=" + p);
                        T.True(b.X >= l.ViewRight + DockLayout.ClipPad + 1, "pinned entry clear of the apps clipper p=" + p);
                        T.True(b.X + b.W <= l.Left + l.PillW - DockLayout.PadX, "pinned entry inside the pill p=" + p);
                    }
                    var f = l.IconBox((int)Math.Round(p), p, sc, 0);
                    var h = l.GlowBox((int)Math.Round(p), sc, 0);
                    T.True(h.X >= 0 && h.X + h.W <= l.WinW, "glow inside the window p=" + p);
                    T.True(f.X >= l.ViewLeft - DockLayout.ClipPad || p >= 20f, "focused app not cut on the left p=" + p);
                }
                T.Eq(l.ScrollFor(19f), (float)(l.AppsW - l.ViewportW), "focus on the last app: scrolled to the end");
                T.Eq(l.ScrollFor(20f), l.ScrollFor(19f), "focus on a pinned entry: apps rest where they are");
                T.Eq(l.ScrollFor(21f), l.ScrollFor(19f), "same on the last entry");
                for (int i = 18; i <= 21; i++)
                {
                    var fb = l.IconBox(i, i, l.ScrollFor(i), 0);
                    T.True(Math.Abs(l.LabelCenterX(i, l.ScrollFor(i)) - (fb.X + fb.W / 2)) <= 1, "label centred under its icon, item " + i);
                }
                var d = l.DividerBox(0f, 0);
                T.True(d.X >= l.ViewRight + DockLayout.ClipPad && d.X + d.W <= rest[0].X, "divider between the clipper and the pinned entries");
                var fit = new DockLayout(10, 1920, 1080, 0, false, 8);
                T.True(!fit.Scrolls, "8 apps and 2 pills still fit");
                T.Eq(fit.ViewportW, fit.AppsW, "apps viewport equals the apps when they fit");
            });

            T.Run("catalog: ValidAppId only lets plain ids onto a command line", () =>
            {
                T.True(Catalog.ValidAppId("com.samsung.tv.csfs"), "real id");
                T.True(Catalog.ValidAppId("org.tizen.tv-viewer") && Catalog.ValidAppId("jcz0WrZYdy.NOWTV"), "dash, mixed case");
                T.True(!Catalog.ValidAppId(null) && !Catalog.ValidAppId(""), "null and empty");
                foreach (string bad in new[] { "a b", "a;b", "a&b", "a|b", "$(x)", "a`b`", "a>b", "a\nb", "a'b", "a\"b" })
                    T.True(!Catalog.ValidAppId(bad), "rejected: " + bad.Replace("\n", "\\n"));
                T.True(!Catalog.ValidAppId(new string('a', 121)), "too long");
            });

            T.Run("catalog: sys: launches an app but counts as a system control", () =>
            {
                var r = Catalog.Parse("a\tA\tx.a\nsettings\tSettings\tsys:com.samsung.tv.csfs\nbad\tBad\tsys:no spaces\n");
                T.Eq(r.Entries.Length, 2, "sys entry parsed, bad one skipped");
                T.Eq(r.Entries[1].AppId, "com.samsung.tv.csfs", "app id without the prefix");
                T.True(r.Entries[1].IsSystem && r.Entries[1].Key == null && r.Entries[1].Panel == null, "system without key or panel");
                T.True(!r.Entries[0].IsSystem, "plain app is not");
                T.Eq(Catalog.GroupStart(r.Entries), 1, "grouped at the end");
                T.Eq(r.Problems.Length, 1, "one problem reported");
            });

            T.Run("catalog: system entries are recognised and grouped only at the end", () =>
            {
                var apps = new[] { new AppEntry("a", "A", "x.a", null), new AppEntry("b", "B", "x.b", null) };
                var src = new AppEntry("source", "Source", null, null, null, -1, "inputs");
                var set = new AppEntry("settings", "Settings", "org.tizen.menu", null, "XF86Menu");
                T.True(!apps[0].IsSystem && src.IsSystem && set.IsSystem, "IsSystem follows Key / Panel");
                T.True(!new AppEntry("in-tv", "TV", null, null, null, 0, null).IsSystem, "an input is a destination, not a system control");
                T.Eq(Catalog.GroupStart(new[] { apps[0], apps[1], src, set }), 2, "two system entries at the end");
                T.Eq(Catalog.GroupStart(new[] { apps[0], apps[1] }), -1, "none: no group");
                T.Eq(Catalog.GroupStart(new[] { src, set }), -1, "all system: nothing to separate from");
                T.Eq(Catalog.GroupStart(new[] { apps[0], src, apps[1] }), -1, "a system entry in the middle: no group");
                T.Eq(Catalog.GroupStart(new AppEntry[0]), -1, "empty");
                T.Eq(Catalog.GroupStart(Catalog.Parse("a\tA\tx.a\nsource\tSource\tpanel:inputs\nsettings\tSettings\tkey:XF86Menu\torg.tizen.menu\n").Entries), 1, "parsed catalog");
            });

            T.Run("catalog: an optional fifth column names the app's own icon", () =>
            {
                string ok = "/opt/share/webappservice/apps_icon/all/111399002034/224x224.png";
                var r = Catalog.Parse("a\tA\tx.a\t\t" + ok + "\nb\tB\tx.b\n");
                T.Eq(r.Entries.Length, 2, "both parsed");
                T.Eq(r.Entries[0].IconPath, ok, "icon path kept");
                T.Eq(r.Entries[0].FallbackAppId, null, "empty fallback column stays empty");
                T.Eq(r.Entries[1].IconPath, null, "no icon column: the pre-made icon");
                T.True(Catalog.ValidIconPath("/opt/usr/apps/pkg/shared/res/icon.png"), "package icon accepted");
                T.True(Catalog.ValidIconPath("/usr/apps/com.samsung.x/shared/res/a-b_c.png"), "system package icon accepted");
                T.True(Catalog.ValidIconPath("/usr/share/canalysis/Icon/Launcher/2K/launcher_xbox360_n.png"), "Samsung's device picture of an input accepted");
                T.True(!Catalog.ValidIconPath("/usr/share/canalysis/x.png"), "only canalysis' Icon folder");
                T.True(!Catalog.ValidIconPath("/etc/passwd"), "outside the icon places");
                T.True(!Catalog.ValidIconPath("/opt/usr/apps/../../etc/x.png"), "no parent directories");
                T.True(!Catalog.ValidIconPath("/opt/usr/apps/a b.png"), "no spaces");
                T.True(!Catalog.ValidIconPath("/opt/usr/apps/a.jpg"), "png only");
                string deviceDir = "/usr/apps/com.samsung.tv.theme-resource/shared/res/PRINCIPLE/NONFLUX/icon/r_icon_device_m/";
                T.True(Catalog.ValidIconPath(deviceDir + "r_icon_device_m_pc.png"), "the generic device picture (Tizen 6.0 / 6.5, PNG) is accepted");
                T.True(Catalog.ValidIconPath(deviceDir + "r_icon_device_m_pc.webp"), "and its WebP form from Tizen 9");
                T.True(!Catalog.ValidIconPath("/usr/apps/com.samsung.tv.theme-resource/shared/res/other/a.webp"), "WebP only for the device pictures folder");
                T.True(!Catalog.ValidIconPath("/opt/usr/apps/pkg/a.webp"), "an app icon is still PNG only");
                T.True(!Catalog.ValidIconPath(deviceDir + "../x.webp"), "no parent directories in a WebP path");
                T.True(!Catalog.ValidIconPath("/opt/usr/apps//a.png"), "no empty path part");
                var bad = Catalog.Parse("a\tA\tx.a\t\t/etc/shadow.png\n");
                T.Eq(bad.Entries.Length, 0, "a bad icon path drops the line");
                T.Eq(bad.Problems.Length, 1, "and reports it");
                var key = Catalog.Parse("settings\tSettings\tkey:XF86Menu\torg.tizen.menu\t/usr/apps/a/b.png\n");
                T.Eq(key.Entries[0].IconPath, "/usr/apps/a/b.png", "the column works after a key entry too");
            });

            T.Run("catalog: a sixth column names an app to close before launching", () =>
            {
                var r = Catalog.Parse("tt\tTizenTube\tx.TizenTube\t\t/opt/usr/apps/a/b.png\tcom.samsung.tv.cobalt-yt\nb\tB\tx.b\n");
                T.Eq(r.Entries[0].KillFirst, "com.samsung.tv.cobalt-yt", "kill-first id kept");
                T.Eq(r.Entries[1].KillFirst, null, "none by default");
                T.True(Catalog.ValidAppId(r.Entries[0].KillFirst), "and it is a plain id");
                var bad = Catalog.Parse("a\tA\tx.a\t\t\tbad id;rm\n");
                T.Eq(bad.Entries.Length, 0, "an id that is not plain drops the line");
                T.Eq(bad.Problems.Length, 1, "and reports it");
                T.Eq(Catalog.Parse("a\tA\tx.a\t\t\tcom.x.y\n").Entries[0].IconPath, null, "an empty icon column stays empty");
            });

            T.Run("icons: rounded corners, and loose logos go on a tile", () =>
            {
                // A fully opaque square tile: only the four corners may change.
                int s = DockLayout.FocusIcon;
                var solid = new uint[s * s];
                for (int i = 0; i < solid.Length; i++) solid[i] = 0xFF2080FFu;
                var done = IconPrep.Prepare(solid, s, s);
                T.Eq(done.Length, s * s, "same size out");
                T.Eq(done[0] >> 24, 0u, "the very corner is transparent");
                T.Eq(done[s / 2 * s + s / 2], 0xFF2080FFu, "the middle is untouched");
                int r = IconPrep.Corner(s);
                T.Eq(r, (int)Math.Round(Design.IconRadiusPct * s / 100.0), "the radius is the design's percentage of the side");
                T.Eq(r, 18, "16% of 112");
                // The thin light line lies just inside the edge, and only there.
                uint edge = done[s / 2];
                T.True(((edge >> 16) & 0xFF) > 0x20 && (edge >> 24) == 255u, "the middle of an edge carries the light line");
                T.Eq(done[4 * s + s / 2], 0xFF2080FFu, "a few pixels in, the picture is untouched");
                T.Eq(done[r * s + 0] >> 24, 255u, "below the corner arc the edge is opaque");
                // A transparent canvas with a small opaque square: a loose logo.
                var loose = new uint[s * s];
                for (int y = 36; y < 76; y++) for (int x = 36; x < 76; x++) loose[y * s + x] = 0xFFFFFFFFu;
                T.True(IconPrep.Coverage(loose) < IconPrep.LooseCoverage, "coverage says loose");
                var tiled = IconPrep.Prepare(loose, s, s);
                T.Eq(tiled[s / 2 * s + 6] >> 24, 255u, "the tile fills what the logo left empty");
                T.Eq(tiled[0] >> 24, 0u, "tile corners are rounded too");
                uint centre = tiled[s / 2 * s + s / 2];
                T.True(((centre >> 16) & 0xFF) > 200, "the logo sits in the middle, still light");
                T.True(((tiled[s / 2 * s + 6] >> 16) & 0xFF) < 100, "and the tile around it is dark");
                // Not square but opaque: it fills the tile, cut to its middle square, and ends square.
                var wide = new uint[100 * 50];
                for (int y = 0; y < 50; y++) for (int x = 0; x < 100; x++) wide[y * 100 + x] = x < 25 ? 0xFF0000FFu : x >= 75 ? 0xFF00FF00u : 0xFFFF0000u;
                var sq = IconPrep.Prepare(wide, 100, 50);
                T.Eq(sq.Length, 100 * 100, "a wide icon becomes a square of its longer side");
                T.Eq(sq[50 * 100 + 50], 0xFFFF0000u, "its middle fills the tile");
                T.Eq(sq[5 * 100 + 50], 0xFFFF0000u, "up to the top: no band above it");
                T.Eq(sq[50 * 100 + 3], 0xFFFF0000u, "the sides outside the middle square are cut");
                T.Eq(sq[0] >> 24, 0u, "and the corners are rounded");
                var tall = new uint[40 * 80];
                for (int y = 0; y < 80; y++) for (int x = 0; x < 40; x++) tall[y * 40 + x] = y < 20 || y >= 60 ? 0xFF0000FFu : 0xFF00FF00u;
                var tq = IconPrep.Prepare(tall, 40, 80);
                T.Eq(tq[2 * 80 + 40], 0xFF00FF00u, "a tall one is cut the same way, top and bottom");
                // A banner as big as the screen: brought down, then treated the same way.
                var banner = new uint[1920 * 1080];
                for (int i = 0; i < banner.Length; i++) banner[i] = (i / 1920) < 540 ? 0xFF40C0FFu : 0xFFC0E0FFu;
                var bi = IconPrep.Prepare(banner, 1920, 1080);
                T.Eq(bi.Length, IconPrep.MaxSide * IconPrep.MaxSide, "a 1920x1080 banner ends as a 112 px square");
                T.Eq(bi[(IconPrep.MaxSide / 2) * IconPrep.MaxSide + IconPrep.MaxSide / 2] >> 24, 255u, "opaque in the middle");
                var half = IconPrep.Halve(new uint[] { 0xFF000000u, 0xFF0000FFu, 0xFF00FF00u, 0xFFFFFFFFu }, 2, 2);
                T.Eq(half.Length, 1, "halving 2x2 gives one pixel");
                T.Eq(half[0] >> 24, 255u, "alpha stays opaque");
                T.Eq(IconPrep.Halve(new uint[3 * 3], 3, 3).Length, 4, "odd sizes round up");
                T.Eq(IconPrep.SideFor(1000, 900), IconPrep.MaxSide, "huge icons are capped");
                T.Eq(IconPrep.SideFor(8, 8), IconPrep.MinSide, "tiny icons are raised to a minimum");
                var big = new uint[304 * 304];
                for (int i = 0; i < big.Length; i++) big[i] = 0xFF00FF00u;
                T.Eq(IconPrep.Prepare(big, 304, 304).Length, IconPrep.MaxSide * IconPrep.MaxSide, "a 304 px icon is scaled down to the cap");
                bool threw = false;
                try { IconPrep.Prepare(new uint[3], 10, 10); } catch (ArgumentException) { threw = true; }
                T.True(threw, "a buffer smaller than the size is refused");
            });

            T.Run("icon cache: a page made again copies finished icons; what no page shows goes at the sweep", () =>
            {
                const string p = "/opt/usr/apps/x/shared/res/icon.png";
                string k = IconCache.Key(p, 100, 2000, IconPrep.MaxSide);
                T.Eq(IconCache.Key(p, 100, 2000, IconPrep.MaxSide), k, "the same file at the same side: the same key");
                T.True(IconCache.Key(p, 101, 2000, IconPrep.MaxSide) != k, "a newer date (an app update wrote its icon again): another key");
                T.True(IconCache.Key(p, 100, 2001, IconPrep.MaxSide) != k, "another length: another key");
                T.True(IconCache.Key(p, 100, 2000, 104) != k, "the Task manager's side (2 x 52): another key");
                T.True(IconCache.Key("/opt/usr/apps/y/shared/res/icon.png", 100, 2000, IconPrep.MaxSide) != k, "another file: another key");
                T.True(IconCache.Key(null, 1, 1, 1) == null && IconCache.Key("", 1, 1, 1) == null, "no path: no key");

                var c = new IconCache(8);
                PreparedIcon got;
                T.True(!c.TryGet(k, out got) && got == null, "an empty cache has nothing");
                T.True(!c.TryGet(null, out got), "a null key is never found");
                var icon = new PreparedIcon(new uint[4], 2, 0x3366CC);
                c.Put(k, icon);
                c.Put(null, icon);
                T.Eq(c.Count, 1, "a null key is not stored");
                T.True(c.TryGet(k, out got) && got == icon, "stored: the same pixels come back");
                T.Eq(got.Hue, 0x3366CC, "with the glow colour taken when it was made");
                T.True(!c.TryGet(IconCache.Key(p, 101, 2000, IconPrep.MaxSide), out got), "a newer file is a miss");

                // A build of the pages: what was asked for, stored or kept stays, the rest goes.
                string a = IconCache.Key("/a.png", 1, 1, IconPrep.MaxSide), b = IconCache.Key("/b.png", 1, 1, IconPrep.MaxSide), t = IconCache.Key("/a.png", 1, 1, 104);
                c.Put(a, icon); c.Put(b, icon); c.Put(t, icon);
                T.Eq(c.Sweep(), 0, "a sweep right after the build drops nothing: all were used in it");
                T.Eq(c.Count, 4, "four kept");
                c.TryGet(a, out got);          // a page made again asks for it
                c.Keep(t);                     // a Task manager row still shows it
                c.Keep(IconCache.Key("/never.png", 1, 1, 1));
                c.Keep(null);
                T.Eq(c.Count, 4, "keeping an unknown or null key adds nothing");
                T.Eq(c.Sweep(), 2, "the next sweep drops the two nothing used (b and the first icon)");
                T.True(c.TryGet(a, out got) && c.TryGet(t, out got), "the one asked for and the one kept stay");
                T.True(!c.TryGet(b, out got) && !c.TryGet(k, out got), "the others went");
                c.Put(k, icon);
                T.Eq(c.Sweep(), 0, "stored since the last sweep: kept");

                // Bounded between two sweeps: a full cache drops the icon used longest ago.
                var small = new IconCache(3);
                string[] ks = { "/1", "/2", "/3", "/4", "/5" };
                small.Put(ks[0], icon); small.Put(ks[1], icon);
                small.Sweep();                                 // round 1: both were used in round 0
                small.TryGet(ks[1], out got);                  // used again in round 1
                small.Put(ks[2], icon);
                small.Put(ks[3], icon);                        // full: /1, the one used longest ago, goes
                T.Eq(small.Count, 3, "never more than the bound");
                T.True(!small.TryGet(ks[0], out got), "the icon used longest ago made room");
                T.True(small.TryGet(ks[1], out got) && small.TryGet(ks[2], out got) && small.TryGet(ks[3], out got), "the recent ones stay");
                small.Put(ks[3], icon);
                T.Eq(small.Count, 3, "storing a key again replaces it, nothing is dropped");
                small.Put(ks[4], icon);
                T.Eq(small.Count, 3, "still bounded when every entry was used in the same round");
                bool refused = false;
                try { new IconCache(0); } catch (ArgumentOutOfRangeException) { refused = true; }
                T.True(refused, "a cache must hold at least one icon");
                T.True(IconCache.DefaultMax * IconPrep.MaxSide * IconPrep.MaxSide * 4L <= 8L * 1024 * 1024, "the default bound is at most 8 MB of dock icons");
            });

            T.Run("vol on a receiver: input_keyevent is waited for until it has worked, then runs in the background", () =>
            {
                const string line = "/usr/bin/input_keyevent XF86AudioRaiseVolume";
                var run = new KeyToolRun();
                T.True(!run.Works, "not known to work before the first call");
                T.Eq(run.Command(line), line, "the first call is waited for: its exit code decides the fallback");
                T.True(!run.Passed(127, false), "the tool missing (127): not passed, Vetro sets the level itself");
                T.Eq(run.Command(line), line, "still waited for after a failure");
                T.True(!run.Passed(1, false), "the tool refusing: not passed");
                T.True(!run.Works, "a missing or refusing tool never goes to the background");
                T.Eq(run.Command(line), line, "so every press keeps the fallback");
                T.True(run.Passed(0, false), "the tool answered 0: passed");
                T.True(run.Works, "known to work from now on");
                T.Eq(run.Command(line), line + " >/dev/null 2>&1 &", "the next press is started in the background (nothing waited for)");
                T.Eq(run.Command(line), line + KeyToolRun.Detach, "the suffix ListWatch uses");
                T.True(run.Passed(0, true), "a background start that worked: passed");
                T.True(!run.Passed(-1, true), "the shell could not even start: not passed, the level is set by Vetro");
                T.True(run.Works, "a failed background start does not undo what the tool proved");
                var other = new KeyToolRun();
                other.Passed(0, true);
                T.True(!other.Works, "a 0 from a background start proves nothing about the tool");
            });

            T.Run("design: ring and glow share the icon's corner rule", () =>
            {
                // One rule for every shape: the radius is a percentage of the side, so it grows with the icon.
                var l = new DockLayout(11, 1920, 1080, 0, false, 9);
                for (float p = 0f; p <= 8f; p += 0.25f)
                {
                    int i = (int)Math.Round(p);
                    var ic = l.IconBox(i, p, l.ScrollFor(p), 0);
                    var rb = l.RingBox(i, p, l.ScrollFor(p), 0);
                    T.Eq(rb.W, ic.W + 2 * Design.RingW, "ring is the icon plus its width, p=" + p);
                    T.Eq(rb.X + rb.W / 2, ic.X + ic.W / 2, "ring is centred on the icon, p=" + p);
                    T.Eq(rb.Y + rb.H / 2, ic.Y + ic.H / 2, "and vertically too, p=" + p);
                }
                T.Eq(l.RingBox(2, 2f, 0f, 0).W, DockLayout.FocusIcon + 2 * Design.RingW, "the ring of the selected icon is the size of the ring image's inner box plus its width");
                T.Eq(DockLayout.HighlightPad, (int)Math.Ceiling(Design.GlowSpread * 1.95), "glow reach = spread + blur, as the glow image is drawn");
                T.Eq(DockLayout.PillGlowPad, DockLayout.HighlightPad, "pills glow with the same reach");
                T.True(DockLayout.ClipPad >= (DockLayout.FocusIcon - DockLayout.Icon) / 2 + Design.RingW, "the apps clipper leaves room for the ring");
                T.Eq(IconPrep.Corner(DockLayout.FocusIcon), (int)Math.Round(Design.IconRadiusPct * DockLayout.FocusIcon / 100.0), "the selected icon's radius");
            });

            T.Run("layout: lift raises the selected icon and its glow, not the pills", () =>
            {
                var l = new DockLayout(11, 1920, 1080, 0, false, 9);
                int rest = l.IconBox(3, 0f, 0f, 0).Y + l.IconBox(3, 0f, 0f, 0).H / 2;
                var sel = l.IconBox(3, 3f, 0f, 0);
                T.Eq(sel.Y + sel.H / 2, l.RowCenterY - Design.Lift, "selected icon is Lift px above the row centre");
                T.Eq(rest, l.RowCenterY, "an icon at rest sits on the row centre");
                var g = l.GlowBox(3, 0f, 0);
                T.Eq(g.Y + g.H / 2, l.RowCenterY - Design.Lift, "the glow rises with it");
                var pill = l.IconBox(9, 9f, 0f, 0);
                T.Eq(pill.Y, l.PillTop(9), "a selected pill does not rise");
                T.Eq(l.PillH, DockLayout.PadTop + DockLayout.FocusIcon + DockLayout.LabelRow + DockLayout.PadBottom, "bar height");
                if (!Design.ShowLabels && !Design.ShowClock) T.Eq(DockLayout.LabelRow, 0, "no names, no clock: no row for them");
                T.Eq(l.PillW <= DockLayout.MaxPillW ? 1 : 0, 1, "the bar never exceeds the maximum width");
                T.Eq(new DockLayout(40, 1920, 1080, 0, false, 38).PillW, DockLayout.MaxPillW, "a long row fills the maximum width");
                T.Eq(l.WinY + l.WinH, 1080 - DockLayout.BottomGap, "the window ends at the bottom");
                T.Eq(1080 - (l.WinY + l.Top + l.PillH), DockLayout.Margin + DockLayout.BottomGap, "the bar's bottom edge is Margin + BottomGap above the screen bottom");
                T.Eq(DockLayout.Margin + DockLayout.BottomGap, 40, "the designer's distance from the edge");
            });

            T.Run("controller: the cascade brings the items in one after the other", () =>
            {
                DockLayout l; var c = NewController(6, out l);
                T.True(c.Show(), "show");
                T.Eq(c.ItemPresence(0), 0f, "nothing has come in yet");
                Run(c, Controller.ShowSeconds / 2);
                T.True(c.Presence > 0.45f && c.Presence < 0.55f, "the bar fades in over the enter time");
                T.Eq(c.Slide, 0, "the bar does not slide while the cascade runs");
                T.True(c.ItemPresence(0) > c.ItemPresence(1) && c.ItemPresence(1) > c.ItemPresence(5), "earlier items are further along");
                T.True(c.ItemSlide(5) > c.ItemSlide(0), "and have less to rise");
                // the bar is fully in after the enter time, the last item after the stagger of all the others
                Run(c, Controller.ShowSeconds / 2 + 0.002);
                T.Eq(c.Presence, 1f, "bar fully present");
                T.Eq(c.Phase, Phase.Showing, "still showing: the last item has not landed");
                T.True(c.ItemPresence(5) < 1f && c.ItemPresence(0) == 1f, "first item landed, last one not");
                int guard = 0; while (c.Tick(1 / 60.0) && guard++ < 200) { }
                T.Eq(c.Phase, Phase.Shown, "shown once the last item landed");
                for (int i = 0; i < 6; i++) { T.Eq(c.ItemPresence(i), 1f, "item " + i + " in"); T.Eq(c.ItemSlide(i), 0, "item " + i + " in place"); }
                // hiding is uniform: every item follows the bar's presence
                c.Hide(); Run(c, Controller.HideSeconds / 2);
                for (int i = 0; i < 6; i++) T.Eq(c.ItemPresence(i), c.Presence, "hide: item " + i + " follows the bar");
                // a page opened inside a visible dock does not run the cascade
                DockLayout l2; var from = NewController(6, out l2);
                from.Show(); while (from.Tick(1 / 60.0)) { }
                var panel = new Controller(new DockLayout(5, 1920, 1080, 0, true, -1), PageKind.Panel);
                panel.AdoptVisibility(from, 0.55f);
                T.True(Math.Abs(panel.Presence - 0.55f) < 1e-6f, "the new page starts a little tucked in");
                for (int i = 0; i < 5; i++) T.Eq(panel.ItemPresence(i), panel.Presence, "no cascade when a page opens inside a visible dock, item " + i);
                T.True(panel.Slide > 0, "the whole page rises together");
                // the warm-up pass draws everything faintly
                var warm = NewController(6, out l); warm.HoldFaint(0.012f);
                T.True(warm.ItemPresence(5) > 0f, "the warm-up pass draws the last item too");
                T.True(warm.ItemPresence(5) == warm.Presence, "at the bar's own faint opacity");
            });

            T.Run("controller: linear focus moves at constant speed and restarts from where it is", () =>
            {
                DockLayout l; var c = NewController(10, out l);
                c.Show(); while (c.Tick(1 / 60.0)) { }
                T.True(c.Linear, "linear is the design's motion");
                int idx; c.Key("Right", out idx);
                Run(c, Design.FocusSeconds / 4);
                T.True(Math.Abs(c.FocusPos - 0.25f) < 1e-3f, "a quarter of the time, a quarter of the way: " + c.FocusPos);
                Run(c, Design.FocusSeconds / 4);
                T.True(Math.Abs(c.FocusPos - 0.5f) < 1e-3f, "half way after half the time");
                // a second press mid-way: a fresh run from 0.5 to 2 over the same time
                c.Key("Right", out idx);
                Run(c, Design.FocusSeconds / 2);
                T.True(Math.Abs(c.FocusPos - 1.25f) < 1e-3f, "restarted from where it was: " + c.FocusPos);
                int guard = 0; while (c.Tick(1 / 60.0) && guard++ < 100) { }
                T.Eq(c.FocusPos, 2f, "lands exactly on the target");
                T.True(!c.Tick(1 / 60.0), "and asks for no more frames");
                T.True(guard < 25, "takes about the focus time: " + guard);
            });

            T.Run("icons: dominant colour for the glow, thin line along the rounded edge", () =>
            {
                int s = 64;
                var red = new uint[s * s];
                for (int i = 0; i < red.Length; i++) red[i] = 0xFFE02020u;
                int rc = IconPrep.DominantColor(red, s, s);
                T.True(rc >= 0 && ((rc >> 16) & 0xFF) > 200 && ((rc >> 8) & 0xFF) < 60, "a red icon gives red");
                T.Eq(IconPrep.DominantColor(new uint[s * s], s, s), -1, "a blank picture has no colour");
                // half grey, half blue: the saturated part wins
                var mixed = new uint[s * s];
                for (int i = 0; i < mixed.Length; i++) mixed[i] = (i % s) < s / 2 ? 0xFF808080u : 0xFF2050E0u;
                int mc = IconPrep.DominantColor(mixed, s, s);
                T.True((mc & 0xFF) > ((mc >> 16) & 0xFF) + 40, "saturated colours count more than grey: " + mc.ToString("X6"));
                // a fully transparent pixel does not count; a dark one barely does
                var dark = new uint[s * s];
                for (int i = 0; i < dark.Length; i++) dark[i] = (i % s) < s / 2 ? 0xFF101010u : 0xFFD04010u;
                int dc = IconPrep.DominantColor(dark, s, s);
                T.True(((dc >> 16) & 0xFF) > 150, "near-black pixels carry little weight: " + dc.ToString("X6"));
                // the rim follows the corner: pixels just inside the arc are lit, the corner outside it stays clear
                int side = 128, rad = IconPrep.Corner(side);
                var tile = new uint[side * side];
                for (int i = 0; i < tile.Length; i++) tile[i] = 0xFF000000u;
                IconPrep.RoundCorners(tile, side, rad);
                IconPrep.Rim(tile, side, rad, 1f, 0.2f);
                T.Eq(tile[0] >> 24, 0u, "the corner outside the arc stays transparent");
                // a point on the arc at 45 degrees, one pixel inside it
                double c45 = rad - rad / Math.Sqrt(2.0);
                int ax = (int)Math.Floor(rad - (rad - 0.5) / Math.Sqrt(2.0)), ay = ax;
                T.True((tile[ay * side + ax] & 0xFF) > 20, "the line bends round the corner: " + (tile[ay * side + ax] & 0xFF));
                T.Eq(tile[side / 2 * side + side / 2], 0xFF000000u, "the middle is untouched");
                T.True((tile[(side / 2) * side + 0] & 0xFF) > 20, "and it runs along the straight edge");
                T.Eq(IconPrep.Corner(256), 41, "16% of 256");
            });

            T.Run("hot paths allocate nothing (animation frame, keys, evdev read)", () =>
            {
                var layout = new DockLayout(13, 1920, 1080, 0, false, 11);
                var c = new Controller(layout);
                c.Show();
                var reader = new EvdevReader(16);
                var presses = new List<int>();
                byte[] ev = Concat(Rec(16, 4, 4, 1), Rec(16, 1, 102, 1), Rec(16, 1, 102, 0), Rec(16, 0, 0, 0));
                long sink = 0;
                Action once = () =>
                {
                    int idx;
                    c.Key("Right", out idx); c.Key("Left", out idx);
                    for (int f = 0; f < 30; f++)
                    {
                        c.Tick(1 / 60.0);
                        float fp = c.FocusPos, sc = c.Scroll;
                        int slide = c.Slide;
                        int g1, g2; float gw;
                        layout.GlowAt(fp, out g1, out g2, out gw);
                        sink += layout.GlowBox(g2, sc, slide).X + (long)gw;
                        sink += layout.PillBox(slide).X + layout.RimBox(slide).Y + layout.GlowBox((int)fp, sc, slide).X + layout.LabelCenterX((int)fp, sc) + layout.LabelTop(slide)
                            + layout.HintTop(slide) + layout.HintLeft(118) + layout.DividerBox(sc, slide).X;
                        for (int i = 0; i < layout.Count; i++) { sink += layout.IconBox(i, fp, sc, slide).W; sink += (long)DockLayout.Amount(fp, i); }
                    }
                    presses.Clear(); reader.Feed(ev, ev.Length, presses); sink += presses.Count;
                };
                for (int i = 0; i < 10000; i++) once();   // warm-up: JIT, Tier-1 promotion and first-use costs
                long before = GC.GetAllocatedBytesForCurrentThread();
                for (int i = 0; i < 20000; i++) once();
                long after = GC.GetAllocatedBytesForCurrentThread();
                T.Eq(after - before, 0L, "bytes allocated over 20000 iterations of 30 frames (sink " + sink + ")");
            });

            T.Run("osd 123: the animator stops at rest and its restart moves exactly as a running one", () =>
            {
                // The pad's motion as it was written inline before (NumberPad.Tick: oFade, oX below), compared with PadMotion step by step.
                var rnd = new Random(3);
                var m = new PadMotion { Fade = 0, FocusX = 40 };
                double oFade = 0, oX = 40;
                bool sameAll = true, everSettled = false;
                for (int f = 0; f < 400; f++)
                {
                    double dt = 1 / 60.0 + (rnd.NextDouble() - 0.5) * 0.004;
                    bool onDone = (f / 50) % 3 == 1;
                    double target = 40 + 96 * ((f / 37) % 4);
                    bool gone;
                    bool moving = m.Step(dt, false, onDone, target, out gone);
                    oFade = Math.Min(1, oFade + dt / 0.12);
                    if (!onDone) { oX += (target - oX) * Math.Min(1, dt * 18); if (Math.Abs(target - oX) < 0.5) oX = target; }
                    sameAll &= m.Fade == oFade && m.FocusX == oX && !gone;
                    // At rest exactly when every later frame would draw the same: opaque, and the capsule on its cell (or the focus on Done).
                    T.True(moving == (oFade < 1 || (!onDone && oX != target)), "moving reported for frame " + f);
                    everSettled |= !moving;
                }
                T.True(sameAll, "PadMotion follows the old arithmetic exactly");
                T.True(everSettled, "the pad comes to rest");
                var close = new PadMotion { Fade = 1, FocusX = 10 };
                bool g = false; int frames = 0;
                while (!g && frames < 100) { close.Step(1 / 60.0, true, false, 10, out g); frames++; }
                T.True(g && close.Fade == 0 && frames == 8, "closing fades out in 0.12 s and says gone (" + frames + " frames)");
                bool g2; T.True(close.Step(1 / 60.0, true, false, 10, out g2) == false && g2, "a closed pad stays gone");

                // FrameStep: a run's first tick advances by the time since it began; a restart's first tick by the interval seen before.
                var s = new FrameStep(0.05);
                s.Begin(10.0);
                T.True(Math.Abs(s.Next(10.008) - 0.008) < 1e-9, "first tick of a run: since it began");
                T.True(Math.Abs(s.Next(10.028) - 0.020) < 1e-9 && Math.Abs(s.Interval - 0.020) < 1e-9, "a tick after a tick: the frame interval, and it is remembered");
                s.Resume();
                T.True(Math.Abs(s.Next(13.0) - 0.020) < 1e-9, "restarted after a rest of seconds: one frame interval, not the 50 ms cap");
                T.True(Math.Abs(s.Next(13.020) - 0.020) < 1e-9, "then the time between ticks again");
                T.True(s.Next(14.0) == 0.05, "a stalled frame is capped");
                var fresh = new FrameStep(0.05);
                fresh.Resume();
                T.True(Math.Abs(fresh.Next(5) - 1 / 60.0) < 1e-12, "a restart before any interval was seen: 1/60 s");
            });

            T.Run("volume bar: it waits on a timer while it is held, and every frame is the one a running animator drew", () =>
            {
                // The old Tick, as it was: alpha from the time shown and the end of the hold.
                Func<double, double, double, double> oldAlpha = (now, at, until) => { double a = Math.Min(1.0, (now - at) / 0.12); if (now > until) a = Math.Min(a, 1.0 - (now - until) / 0.22); return a; };
                var rnd = new Random(5);
                bool same = true;
                for (int i = 0; i < 2000; i++)
                {
                    double at = rnd.NextDouble() * 10, until = at + 1.6, now = at + rnd.NextDouble() * 2.2;
                    same &= VolumeFade.Alpha(now, at, until) == oldAlpha(now, at, until);
                }
                T.True(same, "VolumeFade.Alpha is the old formula");
                T.True(VolumeFade.Holding(1.0, 5.0, 5.0) && !VolumeFade.Holding(1.0, 5.001, 5.0) && !VolumeFade.Holding(0.99, 4.0, 5.0), "held: full and not past the end");

                // A model of both hosts on one 60 Hz clock: the old animator ticks every frame from the show to the end of the fade-out; the new one
                // stops while held and a timer at the end of the hold adds it again (its first tick is the next frame). Keys come at random frames.
                for (int run = 0; run < 50; run++)
                {
                    var keys = new HashSet<int>();
                    for (int k = 0; k < 6; k++) keys.Add(rnd.Next(0, 400));
                    double shownAtOld = 0, untilOld = 0, shownAtNew = 0, untilNew = 0, timerAt = -1;
                    bool shownOld = false, shownNew = false, animNew = false;
                    bool match = true; int ticksOld = 0, ticksNew = 0;
                    for (int f = 0; f < 600; f++)
                    {
                        double now = f / 60.0, keyAt = now - 1 / 120.0;   // a key comes half a frame before the tick
                        if (keys.Contains(f))
                        {
                            // Show(), the same code in both
                            untilOld = keyAt + 1.6; if (!shownOld) { shownOld = true; shownAtOld = keyAt; } else if (keyAt - shownAtOld >= 0.13) shownAtOld = keyAt - 0.12;
                            untilNew = keyAt + 1.6; if (!shownNew) { shownNew = true; shownAtNew = keyAt; } else if (keyAt - shownAtNew >= 0.13) shownAtNew = keyAt - 0.12;
                            timerAt = -1; animNew = true;
                        }
                        if (timerAt >= 0 && timerAt <= now) { timerAt = -1; if (shownNew) animNew = true; }
                        double aOld = -1, aNew = -1;
                        if (shownOld) { ticksOld++; aOld = oldAlpha(now, shownAtOld, untilOld); if (aOld <= 0) shownOld = false; }
                        if (shownNew && animNew)
                        {
                            ticksNew++;
                            aNew = VolumeFade.Alpha(now, shownAtNew, untilNew);
                            if (aNew <= 0) { shownNew = false; animNew = false; }
                            else if (VolumeFade.Holding(aNew, now, untilNew)) { animNew = false; timerAt = untilNew; }
                        }
                        else if (shownNew) aNew = 1.0;   // not ticking: the last frame drawn stays, and it was drawn at full opacity
                        if (aOld != aNew && !(aOld <= 0 && aNew <= 0)) match = false;
                        if (shownOld != shownNew) match = false;
                    }
                    T.True(match, "run " + run + ": the same opacity on every frame, and gone on the same frame");
                    T.True(ticksNew <= ticksOld, "fewer wake-ups (" + ticksNew + " against " + ticksOld + ")");
                }
            });

            T.Run("cards: placement keys, the input-node gate, the guard's pending shell, the --perf probe", () =>
            {
                var k = new PlaceKey();
                T.True(!k.Same(1, 2, 3, 4, 0.5f, 0f), "the first placement is never skipped");
                T.True(k.Same(1, 2, 3, 4, 0.5f, 0f), "the same inputs: nothing to move");
                T.True(!k.Same(1, 2, 3, 5, 0.5f, 0f), "a text changed (version)");
                T.True(!k.Same(1, 2, 3, 5, 0.5001f, 0f), "the selection or the scroll moved");
                T.True(k.Same(1, 2, 3, 5, 0.5001f, 0f), "and settled again");
                k.Invalidate();
                T.True(!k.Same(1, 2, 3, 5, 0.5001f, 0f), "invalidated: placed again");

                long sec = TimeSpan.TicksPerSecond, t0 = 1000 * sec;
                var g = new InputScanGate();
                T.True(g.ShouldRead(t0, t0 + 100 * sec), "the first look reads");
                g.Read(t0, t0 + 100 * sec, true);
                T.True(!g.ShouldRead(t0, t0 + 103 * sec), "the directory unchanged since a clean read: skipped");
                T.True(g.ShouldRead(t0 + 102 * sec, t0 + 103 * sec), "the directory changed: read");
                g.Read(t0 + 102 * sec, t0 + 103 * sec, true);
                T.True(g.ShouldRead(t0 + 102 * sec, t0 + 106 * sec), "changed one second before that read: read again (a second change could share its time)");
                g.Read(t0 + 102 * sec, t0 + 106 * sec, true);
                T.True(!g.ShouldRead(t0 + 102 * sec, t0 + 109 * sec), "then settled: skipped");
                g.Read(t0 + 102 * sec, t0 + 109 * sec, false);
                T.True(g.ShouldRead(t0 + 102 * sec, t0 + 112 * sec), "a node failed to open: the next look reads");
                g.Read(t0 + 102 * sec, t0 + 112 * sec, true);
                g.Force();
                T.True(g.ShouldRead(t0 + 102 * sec, t0 + 115 * sec), "a node was dropped: read");
                g.Read(t0 + 102 * sec, t0 + 115 * sec, true);
                T.True(g.ShouldRead(0, t0 + 118 * sec), "the directory cannot be read: read");
                g.Read(t0 + 102 * sec, t0 + 118 * sec, true);
                int reads = 0;
                for (int i = 0; i < 30; i++) if (g.ShouldRead(t0 + 102 * sec, t0 + (121 + 3 * i) * sec)) { reads++; g.Read(t0 + 102 * sec, t0 + (121 + 3 * i) * sec, true); }
                T.Eq(reads, 3, "an unchanged directory is still read every " + InputScanGate.FullEvery + " looks");

                var p = new PendingCommand();
                T.True(!p.Pending && p.Take() == null, "nothing waits at first");
                p.Set("a"); p.Set("b");
                T.True(p.Pending && p.Take() == "b" && !p.Pending && p.Take() == null, "the newer press replaces the older; it runs once");

                var probe = new OpenProbe();
                T.True(probe.Tick(1.0, true) == null, "an idle probe says nothing");
                probe.Begin("home", 10.0);
                probe.HandlerDone(10.002);
                T.True(probe.Tick(10.010, false) == null && probe.Tick(10.027, false) == null, "nothing before the last frame");
                string line = probe.Tick(10.060, true);
                T.Eq(line, "perf open home: frames=3 key to first tick ms=10.0 to first frame ms=27.0 to last frame ms=60.0 handler ms=2.0 interval ms max=33.0", "one line at the end");
                T.True(!probe.Active && probe.Tick(10.1, true) == null, "and only one");

                // The per-frame helpers allocate nothing (PlaceKey, the gate's skip, PadMotion, FrameStep, VolumeFade, an idle probe).
                long sink = 0;
                var mm = new PadMotion(); var st = new FrameStep(0.05); var idle = new OpenProbe(); var gate = new InputScanGate(); gate.Read(5, 10 * sec, true);
                Action once = () =>
                {
                    bool gone;
                    for (int f = 0; f < 30; f++)
                    {
                        if (!k.Same(f, 2, 3, 4, f * 0.1f, 0f)) sink++;
                        sink += mm.Step(st.Next(f / 60.0), false, false, 100, out gone) ? 1 : 0;
                        sink += VolumeFade.Holding(VolumeFade.Alpha(f / 60.0, 0, 1.6), f / 60.0, 1.6) ? 1 : 0;
                        sink += idle.Tick(f, false) == null ? 1 : 0;
                    }
                    sink += gate.ShouldRead(5, 20 * sec) ? 1 : 0;
                };
                for (int i = 0; i < 2000; i++) once();
                long before = GC.GetAllocatedBytesForCurrentThread();
                for (int i = 0; i < 20000; i++) once();
                T.Eq(GC.GetAllocatedBytesForCurrentThread() - before, 0L, "bytes allocated by the new per-frame helpers (sink " + sink + ")");
            });

            T.Run("tasks: app_launcher -S and pkginfo output (as printed by the Q80A)", () =>
            {
                var r = Tasks.ParseStatus("\t appId (PID)\n\t  org.tizen.tv-viewer (482)\n\t  com.samsung.tv.cobalt-yt (3299)\r\n\t  bad id;rm (12)\n\t  x.y (0)\n");
                T.Eq(r.Count, 2, "two valid lines; header, unsafe id and pid 0 skipped");
                T.Eq(r[1].Key, "com.samsung.tv.cobalt-yt", "app id");
                T.Eq(r[1].Value, 3299, "pid");
                T.Eq(Tasks.ParseStatus(null).Count, 0, "null");
                var dup = Tasks.ParseStatus("\t appId (PID)\n\t  a.one (10)\n\t  b.two (20)\n\t  a.one (30)\n\t  c.three (40)\n\t  b.two (50)\n");
                T.Eq(dup.Count, 3, "a repeated app id is listed once");
                T.Eq(dup[0].Key + "," + dup[1].Key + "," + dup[2].Key, "a.one,b.two,c.three", "order of first appearance kept");
                T.Eq(dup[0].Value, 10, "first line wins (pid)");
                T.Eq(dup[1].Value, 20, "first line wins (second id)");

                var info = Tasks.ParseAppInfo("Appid: org.tizen.browser\nApptype: capp\ncomponent: uiapp\nLabel: Internet\nIcon: /usr/apps/org.tizen.browser/shared/res/browser.png\nNodisplay: 0\nPackage: org.tizen.browser\n");
                T.Eq(info.Component, "uiapp", "component");
                T.Eq(info.Label, "Internet", "label");
                T.Eq(info.Icon, "/usr/apps/org.tizen.browser/shared/res/browser.png", "icon path with colons after the key");
                T.True(!info.NoDisplay, "displayed");
                T.True(Tasks.ParseAppInfo("garbage") == null, "no component -> null");
            });

            T.Run("tasks: the running-app list holds each app id once (one task manager row per id)", () =>
            {
                var tvPlus = new RunningApp { AppId = "org.tizen.tv-viewer", Pid = 11, Label = "Samsung TV Plus" };
                var live = new RunningApp { AppId = "org.tizen.tv-viewer", Pid = 12, Label = "Live TV" };
                var yt = new RunningApp { AppId = "com.samsung.tv.cobalt-yt", Pid = 13, Label = "YouTube" };
                var web = new RunningApp { AppId = "org.tizen.browser", Pid = 14, Label = "Internet" };
                var u = Tasks.UniqueById(new List<RunningApp> { tvPlus, yt, live, web, yt });
                T.Eq(u.Count, 3, "two repeats dropped");
                T.True(ReferenceEquals(u[0], tvPlus), "first occurrence kept (Samsung TV Plus, not Live TV)");
                T.True(ReferenceEquals(u[1], yt) && ReferenceEquals(u[2], web), "order kept");
                T.Eq(Tasks.UniqueById(new List<RunningApp>()).Count, 0, "empty");
                T.Eq(Tasks.UniqueById(null).Count, 0, "null");
                T.Eq(Tasks.UniqueById(new List<RunningApp> { null, new RunningApp { AppId = null }, web }).Count, 1, "null entries and ids skipped");
                var same = new List<RunningApp> { yt, web };
                var copy = Tasks.UniqueById(same);
                T.True(!ReferenceEquals(copy, same) && copy.Count == 2, "a new list; the input is left as it is");
            });

            T.Run("tasks: only visible user apps are listed; the TV's own parts and Vetro are not", () =>
            {
                var ui = new AppInfo { Component = "uiapp" };
                T.True(Tasks.IsUserApp("org.tizen.browser", ui), "browser");
                T.True(Tasks.IsUserApp("com.samsung.tv.csfs", ui), "Samsung Home is listed (large, comes back on Home)");
                T.True(!Tasks.IsUserApp("org.tizen.tv-viewer", ui), "live TV protected");
                T.True(!Tasks.IsUserApp("vetrotvapp.svc", ui), "Vetro protected");
                T.True(!Tasks.IsUserApp("com.samsung.tv.coba.adagent", ui), "Smart Hub ad agent protected (Samsung's Home loads it)");
                T.True(!Tasks.IsUserApp("org.tizen.ambientapp", ui), "Ambient app protected (screend starts it again)");
                T.True(!Tasks.IsUserApp("capi-bnr-tv", ui), "backup service (bnr-service) hidden");
                T.True(!Tasks.IsUserApp("com.samsung.tv.preview-updater", ui), "Home preview updater (IotPreviewd) hidden");
                T.True(!Tasks.IsUserApp("x.y", new AppInfo { Component = "svcapp" }), "services hidden");
                T.True(!Tasks.IsUserApp("x.y", new AppInfo { Component = "uiapp", NoDisplay = true }), "nodisplay hidden");
                T.True(!Tasks.IsUserApp("x.y", null), "unknown hidden");
                T.Eq(Tasks.DisplayName("com.samsung.tv.csfs", ui, null), "Samsung Home", "friendly name");
                T.Eq(Tasks.DisplayName("a.b", new AppInfo { Label = "Pkg" }, "Catalog"), "Catalog", "catalog label wins");
            });

            T.Run("tasks: a row stays closing only while the same process runs, and not past the timeout", () =>
            {
                long hz = 1000, limit = (long)(Tasks.ClosingTimeoutSeconds * hz);
                T.True(Tasks.StillClosing(true, 42, 42, 1000, 1000 + 2 * hz, limit), "same pid, 2 s after the close: still closing");
                T.True(!Tasks.StillClosing(true, 42, 42, 1000, 1000 + limit, limit), "same pid past the timeout: the close failed, the row is usable again");
                T.True(!Tasks.StillClosing(true, 42, 43, 1000, 1000 + hz, limit), "a new pid is the app started again, not closing");
                T.True(!Tasks.StillClosing(false, 42, 42, 1000, 1000 + hz, limit), "never closed");
                T.True(Tasks.ClosingTimeoutSeconds > 2.6, "longer than the close itself (terminate, 2 s, kill) and the 2.6 s look after it");
            });

            T.Run("tasks: /proc parsing and process-tree sums", () =>
            {
                int pid, ppid; long ticks;
                T.True(Tasks.ParseStat("3547 (browser (x) y) S 452 3547 3547 0 -1 4194560 1 2 3 4 1200 34 0 0 20 0 9", out pid, out ppid, out ticks), "stat with ')' in the name");
                T.Eq(pid, 3547, "pid"); T.Eq(ppid, 452, "ppid"); T.Eq(ticks, 1234L, "utime + stime");
                T.True(!Tasks.ParseStat("", out pid, out ppid, out ticks), "empty");
                T.Eq(Tasks.PrivateKbFromStatm("9000 3000 1000 10 0 2000 0", 4), 8000L, "resident - shared pages, in KiB");
                T.Eq(Tasks.SwapKbFromStatus("Name:\tx\nVmRSS:\t 100 kB\nVmSwap:\t   2048 kB\nThreads: 3\n"), 2048L, "VmSwap");
                T.Eq(Tasks.SwapKbFromStatus("Name: x\n"), 0L, "no VmSwap");

                var procs = new[] {
                    new ProcSample { Pid = 10, PPid = 1 }, new ProcSample { Pid = 11, PPid = 10 },
                    new ProcSample { Pid = 12, PPid = 11 }, new ProcSample { Pid = 20, PPid = 1 },
                    new ProcSample { Pid = 30, PPid = 30 },
                };
                var tree = Tasks.Tree(10, Tasks.ChildMap(procs));
                T.Eq(tree.Count, 3, "app, zygote and renderer");
                T.True(!tree.Contains(20), "a sibling is not counted");
                T.Eq(Tasks.Tree(30, Tasks.ChildMap(procs)).Count, 1, "self-parent does not loop");
                T.Eq(Tasks.CpuPercent(100, 150, 1.0, 100), 50.0, "50 ticks in 1 s at 100 Hz");
                T.Eq(Tasks.CpuPercent(100, 90, 1.0, 100), -1.0, "counter went back: unknown");
            });

            T.Run("tasks: sorting and formatting", () =>
            {
                var l = new List<RunningApp> {
                    new RunningApp { AppId = "a", Label = "beta", MemoryKb = 100, CpuPercent = 5 },
                    new RunningApp { AppId = "b", Label = "Alpha", MemoryKb = 300, CpuPercent = 1 },
                    new RunningApp { AppId = "c", Label = "gamma", MemoryKb = 200, CpuPercent = 9 },
                };
                Tasks.Sort(l, TaskSort.Memory); T.Eq(l[0].AppId, "b", "biggest first");
                Tasks.Sort(l, TaskSort.Cpu); T.Eq(l[0].AppId, "c", "busiest first");
                Tasks.Sort(l, TaskSort.Name); T.Eq(l[0].Label, "Alpha", "names ignore case");
                T.Eq(Tasks.FormatMemory(118924), "116 MB", "MB");
                T.Eq(Tasks.FormatMemory(5000), "4.9 MB", "small MB keeps a decimal");
                T.Eq(Tasks.FormatCpu(-1), "–", "not measured yet");
                T.Eq(Tasks.FormatCpu(3.25), "3.3%", "cpu");
            });

            T.Run("tasks: Down opens the task manager from the apps row; the page's keys", () =>
            {
                var layout = new DockLayout(13, 1920, 1080, 0, false, 11);
                var c = new Controller(layout) { TasksEnabled = true };
                c.Show(); Run(c, 2.0);
                int idx;
                T.Eq(c.Key("Down", out idx), KeyAction.OpenTasks, "Down on an app");
                c.SetFocus(11);
                T.Eq(c.Key("Down", out idx), KeyAction.Moved, "Down inside the pill column still climbs down");
                c.SetFocus(12);
                T.Eq(c.Key("Down", out idx), KeyAction.OpenTasks, "Down below the last pill");
                var off = new Controller(layout); off.Show(); Run(off, 2.0);
                T.Eq(off.Key("Down", out idx), KeyAction.None, "switched off: nothing");

                var t = new TaskController();
                t.Open(0.5f);
                t.SetCount(10);
                T.Eq(t.Key("Up"), TaskAction.Back, "Up on the first row returns");
                T.Eq(t.Key("Down"), TaskAction.Moved, "Down moves");
                for (int i = 0; i < 20; i++) t.Key("Down");
                T.Eq(t.Selected, 9, "clamped at the last row");
                for (int i = 0; i < 60; i++) t.Tick(1 / 60.0);
                T.Eq(t.Phase, Phase.Shown, "shown");
                T.True(t.Scroll >= 9 - TaskLayout.MaxRows + 1 - 0.001f, "scrolled so the last row is visible");
                T.Eq(t.Key("Right"), TaskAction.Right, "Right asks for the card on the right (there is no sort any more)");
                T.Eq(t.Key("Left"), TaskAction.Left, "Left for the card on the left");
                T.Eq(t.Sort, TaskSort.Memory, "the list stays biggest first");
                T.Eq(t.Key("Return"), TaskAction.Open, "OK opens (holding it closes: HoldKey)");
                t.SetCount(3);
                T.Eq(t.Selected, 2, "selection kept inside a shorter list");
                t.SetCount(0);
                T.Eq(t.Key("Return"), TaskAction.None, "nothing to open");
                T.Eq(t.Key("XF86Back"), TaskAction.Back, "Back returns");
                T.Eq(t.Key("XF86Home"), TaskAction.Hide, "Home hides");
            });

            T.Run("tasks: OK tapped opens, OK held closes", () =>
            {
                var h = new HoldKey();
                T.True(h.Press(), "first down arms the timer");
                T.Eq(h.Release(), HoldResult.Tap, "let go before the timer: tap");
                T.Eq(h.Release(), HoldResult.None, "second release (raw node and window): nothing");
                T.Eq(h.Fire(), HoldResult.None, "a late timer after a tap: nothing");

                T.True(h.Press(), "down again");
                T.True(!h.Press(), "auto-repeat while held is not a new press");
                T.Eq(h.Fire(), HoldResult.Hold, "timer while held: hold");
                T.Eq(h.Fire(), HoldResult.None, "fires once");
                T.Eq(h.Release(), HoldResult.None, "release after the hold does not open");

                T.True(h.Press(), "down");
                h.Cancel();
                T.Eq(h.Release(), HoldResult.None, "page gone: the release does nothing");
                T.Eq(h.Fire(), HoldResult.None, "nor the timer");
                T.True(HoldKey.HoldSeconds >= 0.5 && HoldKey.HoldSeconds <= 1.5, "hold long enough not to fire on a click");
            });

            T.Run("reduce motion: the osd 123 and the Volume bar appear and go at once", () =>
            {
                bool gone;
                var m = new PadMotion { FocusX = 0 };
                PadMotion.Instant = true; VolumeFade.Instant = true;
                try
                {
                    T.True(!m.Step(0.016, false, false, 300, out gone) && !gone && m.Fade == 1 && m.FocusX == 300, "opens full, capsule on its cell, at rest");
                    T.True(!m.Step(0.016, true, false, 300, out gone) && gone && m.Fade == 0, "closes in one frame");
                    T.Eq(VolumeFade.Alpha(10.0, 10.0, 11.6), 1.0, "full from the first frame");
                    T.Eq(VolumeFade.Alpha(11.7, 10.0, 11.6), 0.0, "gone right after the hold");
                }
                finally { PadMotion.Instant = false; VolumeFade.Instant = false; }
                T.True(VolumeFade.Alpha(10.05, 10.0, 11.6) < 1.0, "with motion the bar still fades in");
            });

            T.Run("back: the launcher closes on Back's release, never on its press (#284)", () =>
            {
                var b = new BackRelease();
                T.True(!b.Press("Left", 0), "an arrow is not held back");
                T.True(b.Press("XF86Back", 10.0), "Back waits for its release");
                T.True(b.Pending && !b.Due(10.5), "still open while Back is down");
                T.True(b.Press("XF86Back", 10.2) && b.Pending, "a repeat while held changes nothing");
                T.True(!b.WindowRelease("Left"), "another key's release does not close");
                T.True(b.WindowRelease("XF86Back") && !b.Pending, "the window's release closes at once");
                T.True(!b.WindowRelease("XF86Back"), "a second release does nothing");

                T.True(b.Press("Escape", 20.0), "Escape too");
                b.KernelRelease(20.3);
                T.True(!b.Due(20.3 + BackRelease.KernelGraceSeconds / 2), "the kernel's release waits for the window's copy");
                T.True(b.Due(20.3 + BackRelease.KernelGraceSeconds + 0.001), "then closes without it");
                b.Cancel();

                T.True(b.Press("XF86Exit", 30.0), "Exit too");
                T.True(!b.Due(30.0 + BackRelease.LimitSeconds - 0.01) && b.Due(30.0 + BackRelease.LimitSeconds + 0.001), "a release that never comes: closed at the limit");
                b.Cancel();
                T.True(!b.Pending && !b.Due(99), "cancelled (the launcher closed another way): nothing left");
                b.KernelRelease(40);
                T.True(!b.Due(41), "a stray kernel release with nothing waiting does nothing");
                T.True(BackRelease.KernelGraceSeconds < 0.5 && BackRelease.LimitSeconds >= 1.0, "grace short, limit long enough for a normal press");
            });

            T.Run("evdev: releases are reported when asked for, repeats never", () =>
            {
                var r = new EvdevReader(16);
                byte[] data = new byte[48];
                int[][] recs = { new[] { 28, 1 }, new[] { 28, 2 }, new[] { 28, 0 } };
                for (int i = 0; i < 3; i++)
                {
                    int o = i * 16 + 8;
                    data[o] = 1;                                   // EV_KEY
                    data[o + 2] = (byte)recs[i][0];                // code
                    data[o + 4] = (byte)recs[i][1];                // value
                }
                var presses = new List<int>(); var releases = new List<int>();
                r.Feed(data, data.Length, presses, releases);
                T.Eq(presses.Count, 1, "one press");
                T.Eq(releases.Count, 1, "one release, the repeat ignored");
                T.Eq(releases[0], 28, "release code");
                T.Eq(new EvdevReader(16).Feed(data, data.Length).Count, 1, "presses-only feed unchanged");
            });

            T.Run("tasks: Reduce motion opens, moves and closes the task page at once", () =>
            {
                bool was = Controller.Instant;
                Controller.Instant = true;
                try
                {
                    var t = new TaskController();
                    t.Open(0f);
                    T.Eq(t.Phase, Phase.Shown, "shown at once");
                    T.Eq(t.Slide, 0, "no slide");
                    t.SetCount(10);
                    T.Eq(t.Key("Down"), TaskAction.Moved, "Down moves");
                    T.Eq(t.SelPos, 1f, "selection jumps, no glide");
                    T.True(!t.Tick(1 / 60.0), "no frame needed after a jump");
                    T.True(t.Hide(), "hide accepted");
                    T.Eq(t.Phase, Phase.Hidden, "hidden at once");
                    var c = new Controller(new DockLayout(13, 1920, 1080));
                    c.Rise(0.3f);
                    T.Eq(c.Phase, Phase.Shown, "the apps row comes back at once too");
                }
                finally { Controller.Instant = was; }
            });

            T.Run("tasks: layout stands on the dock's bottom line and fits the screen", () =>
            {
                var dock = new DockLayout(13, 1920, 1080);
                var tl = new TaskLayout(1920, 1080, dock.WinW);
                T.Eq(tl.WinY + tl.WinH, dock.WinY + dock.WinH, "same window bottom as the dock");
                Box p = tl.Panel(TaskLayout.MaxRows, 0), bar = dock.PillBox(0);
                T.Eq(tl.WinY + p.Y + p.H, dock.WinY + bar.Y + bar.H, "panel bottom = bar bottom on screen");
                T.True(tl.WinY >= 0, "tallest panel fits on a 1080p screen");
                T.True(tl.Panel(1, 0).H < p.H, "a short list makes a shorter panel");
                T.Eq(tl.Panel(0, 0).H, TaskLayout.PanelH(TaskLayout.MinRows), "empty list keeps two rows of room");
                T.Eq(TaskLayout.ScrollFor(8, 0, 10), (float)(8 - TaskLayout.MaxRows + 1), "scroll follows the selection down");
                T.Eq(TaskLayout.ScrollFor(1, 2, 10), 1f, "and back up");
            });

            T.Run("layout: task manager hint below the apps pill mirrors the Source hint above it", () =>
            {
                var plain = new DockLayout(13, 1920, 1080);
                var apps = new DockLayout(13, 1920, 1080, 0, false, -1, true);
                var panel = new DockLayout(5, 1920, 1080, apps.WinW, true, -1, true);
                T.True(apps.BelowBand && !plain.BelowBand, "band only when asked for");
                T.Eq(apps.WinH, plain.WinH + DockLayout.HintH, "window one hint band taller");
                T.Eq(panel.WinH, apps.WinH, "both pages keep one window height");
                T.Eq(apps.Top, plain.Top, "pill keeps its place from the window top");
                T.Eq(apps.WinY, plain.WinY - DockLayout.HintH, "so the bar sits one band higher on screen");
                int above = apps.Top - (apps.HintTop(0) + DockLayout.CapsuleH);
                int below = apps.HintBelowTop(0) - (apps.Top + apps.PillH);
                T.Eq(below, above, "same gap below the pill as above it");
                T.True(apps.HintBelowTop(0) + DockLayout.CapsuleH <= apps.WinH - DockLayout.Margin, "below hint inside the window, clear of the bottom margin");
                T.Eq(apps.HintBelowTop(30) - apps.HintBelowTop(0), 30, "below hint follows the slide");
                T.Eq(panel.HintTop(0), new DockLayout(5, 1920, 1080, apps.WinW, true, -1).HintTop(0), "panel page and its back hint unchanged inside the window");

                var tl = new TaskLayout(1920, 1080, apps.WinW, DockLayout.HintH);
                Box p = tl.Panel(TaskLayout.MaxRows, 0), bar = apps.PillBox(0);
                T.Eq(tl.WinY + tl.WinH, apps.WinY + apps.WinH, "task window keeps the dock's bottom");
                T.Eq(tl.WinY + p.Y + p.H, apps.WinY + bar.Y + bar.H, "panel bottom = raised bar bottom on screen");
                T.True(tl.WinY >= 0, "tallest panel still fits on a 1080p screen");
            });

            T.Run("layout: apps and Sources pages are both centred on the screen (the window is sized from the grouped apps page)", () =>
            {
                // 11 apps + Settings and Samsung Home pinned after the divider, 5 inputs: the case that put Sources 34 px left.
                foreach (int[] k in new[] { new[] { 13, 11, 5 }, new[] { 9, 7, 5 }, new[] { 22, 20, 5 }, new[] { 3, 1, 12 }, new[] { 13, -1, 5 } })
                    foreach (bool band in new[] { false, true })
                    {
                        DockLayout apps, inputs;
                        DockLayout.Pages(k[0], k[1], k[2], 1920, 1080, band, out apps, out inputs);
                        string what = k[0] + " items grouped at " + k[1] + ", " + k[2] + " inputs, band " + band;
                        T.Eq(inputs.WinW, apps.WinW, "one window width: " + what);
                        T.Eq(inputs.WinH, apps.WinH, "one window height: " + what);
                        T.Eq(inputs.WinX, apps.WinX, "one window position: " + what);
                        T.True(Math.Abs(2 * (apps.WinX + apps.Left) + apps.PillW - 1920) <= 1, "apps bar centred on the screen: " + what);
                        T.True(Math.Abs(2 * (inputs.WinX + inputs.Left) + inputs.PillW - 1920) <= 1, "Sources bar centred on the screen: " + what);
                        T.Eq(apps.GroupStart, k[1] > 0 && k[1] < k[0] ? k[1] : -1, "apps page keeps its group: " + what);
                        T.True(inputs.Raised && !apps.Raised, "Sources is the raised page: " + what);
                    }
                DockLayout a, s;
                DockLayout.Pages(13, 11, 5, 1920, 1080, true, out a, out s);
                T.Eq(s.WinX + s.RimBox(0).X, 666, "Sources bar (with its rim) starts at x 666 on a 1920 screen (it started at 632)");
                T.Eq(s.WinX + s.RimBox(0).X + s.RimBox(0).W, 1254, "and ends at 1254");
            });

            T.Run("tasks: the selection plate covers row 0 and the rows follow it, one row height apart", () =>
            {
                var tl = new TaskLayout(1920, 1080, 1612, DockLayout.HintH);
                foreach (int n in new[] { 1, 2, 5, 7, 10 })
                    for (int slide = 0; slide <= 48; slide += 48)
                    {
                        Box panel = tl.Panel(n, slide), list = tl.ListClip(n, slide);
                        int rows = TaskLayout.VisibleRows(n);
                        T.Eq(list.Y, tl.ListTop(n, slide), "list clip starts at the list top, n=" + n);
                        T.Eq(list.H, rows * TaskLayout.RowH, "list clip is as tall as the visible rows, n=" + n);
                        T.Eq(panel.H, TaskLayout.PanelH(rows), "panel as tall as its visible rows, n=" + n);
                        for (int i = 0; i < Math.Min(n, rows); i++)
                        {
                            Box plate = tl.Plate(i, 0, n, slide);
                            int top = tl.RowTop(i, 0, n, slide);
                            T.Eq(top, list.Y + i * TaskLayout.RowH, "row " + i + " top, n=" + n);
                            T.Eq(plate.Y, top + 4, "plate on row " + i + ", n=" + n);
                            T.Eq(plate.Y + plate.H, top + TaskLayout.RowH - 4, "plate ends 4 px above the next row, n=" + n);
                            T.True(plate.Y >= list.Y && plate.Y + plate.H <= list.Y + list.H, "plate inside the list, row " + i + ", n=" + n);
                        }
                        Box p0 = tl.Plate(0, 0, n, slide);
                        T.Eq(p0.X - panel.X, TaskLayout.PlateInset, "plate inset from the panel's left side");
                        T.Eq(panel.X + panel.W - (p0.X + p0.W), TaskLayout.PlateInset, "and from its right side");
                        Box rim = tl.Rim(n, slide);
                        T.True(rim.X == panel.X - Design.ShellBorderW && rim.W == panel.W + 2 * Design.ShellBorderW && rim.Y == panel.Y - Design.ShellBorderW, "rim is the panel grown by the border width, n=" + n);
                    }
                T.Eq(tl.Plate(2.5f, 1, 7, 0).Y, tl.RowTop(1, 0, 7, 0) + TaskLayout.RowH / 2 + 4, "plate between two rows while it moves, scrolled by one");
                T.True(TaskLayout.RowH - 8 <= 2 * Design.CapSlice, "plate no taller than the capsule picture: the ends stay fully round");
            });

            T.Run("control center: five rows at most, a longer list scrolls with a bar in the gutter right of the rows", () =>
            {
                T.Eq(TaskLayout.MaxRows, 5, "five rows: a sixth running app no longer grows the card");
                foreach (int cards in new[] { 1, 3 })
                {
                    var tl = new TaskLayout(1920, 1080, 1612, DockLayout.HintH, cards, 0);
                    T.True(!tl.Scrolls(5) && tl.Scrolls(6), "the bar shows from the sixth row, cards=" + cards);
                    Box panel = tl.Panel(9, 0), list = tl.ListClip(9, 0), track = tl.ScrollTrack(9, 0), plate = tl.Plate(0, 0, 9, 0);
                    T.Eq(panel.H, TaskLayout.PanelH(TaskLayout.MaxRows), "nine apps: the card stays five rows tall, cards=" + cards);
                    T.True(track.X >= plate.X + plate.W + 2 && track.X + track.W <= panel.X + panel.W - 2, "the bar sits in the gutter, clear of the plate and the card's side, cards=" + cards);
                    T.Eq(track.Y, plate.Y, "the track starts where the first plate does");
                    T.Eq(track.Y + track.H, list.Y + list.H - 4, "and ends where the last plate does");
                    Box top = tl.ScrollThumb(0, 9, 0), end = tl.ScrollThumb(4, 9, 0), mid = tl.ScrollThumb(2, 9, 0);
                    T.Eq(top.Y, track.Y, "not scrolled: the thumb at the top");
                    T.Eq(end.Y + end.H, track.Y + track.H, "scrolled to the end: the thumb at the bottom");
                    T.True(mid.Y > top.Y && mid.Y + mid.H < end.Y + end.H, "half way: in between");
                    T.Eq(top.H, track.H * 5 / 9, "the thumb is the share of the list on screen");
                    T.True(tl.ScrollThumb(0, 400, 0).H == TaskLayout.ScrollMinThumb, "never shorter than the minimum");
                    T.Eq(tl.ScrollThumb(99, 9, 0).Y, end.Y, "a scroll past the end stays at the end");
                    T.True(TaskLayout.ScrollW / 2.0 <= Design.CapSlice, "the bar's ends stay round");
                }
                var t = new TaskController();
                t.Open(1f); t.SetCount(9);
                for (int i = 0; i < 8; i++) { t.Key("Down"); for (int f = 0; f < 20; f++) t.Tick(1 / 60.0); }
                T.True(Math.Abs(t.Scroll - 4) < 0.001f, "the last of nine rows scrolls the list by four");
            });

            T.Run("control center: which cards, in which order, and Left/Right between them", () =>
            {
                Func<CardSpec[], string> names = k => string.Join(",", Array.ConvertAll(k, x => x.ToString()));
                T.Eq(names(ControlCenter.Parse(null, false)), "Tasks", "no --cards: the Task manager alone, as before");
                T.Eq(names(ControlCenter.Parse(null, true)), "", "--no-tasks: no card");
                T.Eq(names(ControlCenter.Parse("audio,tasks", false)), "Audio,Tasks", "the order given");
                T.Eq(names(ControlCenter.Parse(" tasks , radio,audio,tasks", true)), "Tasks,Audio", "unknown and repeated names skipped; --cards wins over --no-tasks");
                T.Eq(names(ControlCenter.Parse("", false)), "", "an empty list: no card");
                T.Eq(ControlCenter.HintText(new[] { CardKind.Tasks }), "Task manager", "one card: its own name under the bar");
                T.Eq(ControlCenter.HintText(new[] { CardKind.Audio }), "Audio output", "the Audio output alone");
                T.Eq(ControlCenter.HintText(new[] { CardKind.Tasks, CardKind.Audio }), "Control center", "two or more: Control center");
                T.True(ControlCenter.HintText(new CardKind[0]) == null, "no card: no hint");
                T.Eq(ControlCenter.Move(0, 3, -1), 0, "Left on the first card stays");
                T.Eq(ControlCenter.Move(0, 3, 1), 1, "Right moves");
                T.Eq(ControlCenter.Move(2, 3, 1), 2, "Right on the last card stays");
                T.Eq(ControlCenter.Move(0, 1, 1), 0, "one card: nowhere to go");
            });

            T.Run("control center: cards side by side, centred, on the dock's bottom line, as tall as each other", () =>
            {
                var apps = new DockLayout(13, 1920, 1080, 0, false, -1, true);
                var one = new TaskLayout(1920, 1080, apps.WinW, DockLayout.HintH);
                T.Eq(one.PanelW, TaskLayout.WideW, "one card keeps the Task manager's width");
                T.True(!one.Narrow, "and its CPU column");
                foreach (int n in new[] { 2, 3 })
                {
                    var cards = new TaskLayout[n];
                    for (int i = 0; i < n; i++) cards[i] = new TaskLayout(1920, 1080, apps.WinW, DockLayout.HintH, n, i);
                    T.True(cards[0].Narrow && cards[0].PanelW == TaskLayout.NarrowW, n + " cards are narrow");
                    // #283: the CPU column stays on a narrow card: the name ends before it, it ends before the memory figure, and the name keeps room
                    T.True(cards[0].CpuRight < cards[0].MemRight - 90 && cards[0].NameRight < cards[0].CpuRight - 60, n + " cards keep the CPU column between the name and the memory");
                    T.True(cards[0].NameRight - cards[0].NameX >= 170, n + " cards leave the name at least 170 px");
                    T.True(cards[0].NameRight - cards[0].NameX < one.NameRight - one.NameX, n + " cards: the wide card's names have more room");
                    T.Eq(cards[0].WinW, cards[n - 1].WinW, "one window for all of them, n=" + n);
                    int left = cards[0].WinX + cards[0].PanelX, right = cards[n - 1].WinX + cards[n - 1].PanelX + cards[n - 1].PanelW;
                    T.True(Math.Abs(left + right - 1920) <= 1, "the row of cards is centred on the screen, n=" + n);
                    T.True(left >= 0 && right <= 1920, "and fits on it, n=" + n);
                    for (int i = 1; i < n; i++) T.Eq(cards[i].PanelX - (cards[i - 1].PanelX + cards[i - 1].PanelW), TaskLayout.CardGap, "gap between cards, n=" + n);
                    Box p = cards[0].Panel(3, 0), bar = apps.PillBox(0);
                    T.Eq(cards[0].WinY + p.Y + p.H, apps.WinY + bar.Y + bar.H, "card bottom = bar bottom on screen, n=" + n);
                    T.True(cards[0].WinY >= 0, "the tallest cards fit on a 1080p screen, n=" + n);
                    cards[0].ShowRows = 5; cards[1].ShowRows = 5;
                    T.Eq(cards[0].Panel(1, 0).H, cards[1].Panel(5, 0).H, "evened out: a short list is as tall as the longest beside it, n=" + n);
                    T.Eq(cards[0].Rows(9), TaskLayout.MaxRows, "never more than the most rows, n=" + n);
                    T.True(cards[0].NameRight > cards[0].NameX + 180 && cards[0].NameRight < cards[0].MemRight - 100, "a narrow row has room for the name before the CPU and memory figures, n=" + n);
                }
                var three = new TaskLayout(1920, 1080, apps.WinW, DockLayout.HintH, 5, 9);
                T.Eq(three.PanelX, new TaskLayout(1920, 1080, apps.WinW, DockLayout.HintH, 3, 2).PanelX, "more than three cards or an index past the end are clamped");
            });

            T.Run("row: keys read from the list, moving, taking out and adding tiles, what is sent to Vetro", () =>
            {
                var r = Catalog.Parse("a\tA\torg.a\t\t\t\t\tapp:org.a\nb\tB\torg.b\t\t\t\t\tapp:org.b\nlive\tLive TV\torg.tizen.tv-viewer\t\t\t\t\tlive:RF\n" +
                    "bad\tBad\torg.bad\t\t\t\t\tapp:x;rm\nallapps\tAll apps\tpanel:allapps\nsamsunghome\tSamsung Home\tsys:com.samsung.tv.csfs");
                AppEntry[] row = r.Entries;
                T.Eq(row[0].RowKey, "app:org.a", "the eighth column is the row key");
                T.Eq(row[2].RowKey, "live:RF", "a live entry's key");
                T.True(row[3].RowKey == null, "a key that is not plain is dropped (the tile cannot be edited)");
                T.True(!RowEdit.CanEdit(row), "one app without a key: the row cannot be edited");
                row = new[] { row[0], row[1], row[2], row[4], row[5] };
                T.True(RowEdit.CanEdit(row), "every app has a key");
                T.Eq(RowEdit.AppsEnd(row), 3, "the apps end where the pills start");
                T.True(!RowEdit.IsApp(row, 3), "a pill is not an app of the row");
                T.Eq(RowEdit.Target(row, 0, -1), 0, "the first app does not go further left");
                T.Eq(RowEdit.Target(row, 2, 1), 2, "nor the last one into the pills");
                T.Eq(RowEdit.Target(row, 1, 1), 2, "one place right");
                T.Eq(RowEdit.Target(row, 3, -1), 3, "a pill never moves");
                AppEntry[] less = RowEdit.Remove(row, 1);
                T.Eq(string.Join(",", Array.ConvertAll(less, e => e.Slug)), "a,live,allapps,samsunghome", "taken out");
                T.True(RowEdit.Remove(RowEdit.Remove(less, 0), 0).Length == 3, "the last app stays: a row is never empty");
                AppEntry[] more = RowEdit.Add(less, row[1]);
                T.Eq(string.Join(",", Array.ConvertAll(more, e => e.Slug)), "a,live,b,allapps,samsunghome", "added after the last app, before the pills");
                T.True(RowEdit.Add(more, row[1]) == more, "an app already in the row is not added twice");
                T.True(RowEdit.Add(more, row[3]) == more, "a pill is never added");
                T.Eq(RowEdit.IndexOf(more, "app:org.b"), 2, "found by its key");
                T.Eq(RowEdit.Command(RowEdit.Keys(more), 8099),
                    "( /usr/bin/curl -sf -m 15 -X POST -H 'Content-Type: application/json' -d '{\"row\":[\"app:org.a\",\"live:RF\",\"app:org.b\"]}' 'http://127.0.0.1:8099/plugins/launcher/api/row' >/dev/null 2>&1 ) &",
                    "the row goes to Vetro as plain keys, in the background");
                T.True(RowEdit.Command(new[] { "app:a'b" }, 8099) == null && RowEdit.Command(new string[0], 8099) == null, "nothing unchecked reaches the shell");
                T.True(Catalog.ValidRowKey("source:13") && !Catalog.ValidRowKey("source:x") && !Catalog.ValidRowKey("live:rf") && !Catalog.ValidRowKey("app:"), "key shapes");
                T.Eq(Catalog.BuiltInAllApps().Length, 2, "no All apps list: its two pills only");
                T.Eq(Catalog.GroupStart(Catalog.Parse("x\tX\torg.x\n" + "settings\tSettings\tkey:XF86SysMenu\torg.tizen.menu\nstore\tApp store\tsys:com.samsung.tv.store").Entries), 1, "All apps ends with Settings and the App store as pills");
                DockLayout a, i, all;
                DockLayout.Pages(5, 3, 5, 30, 28, 1920, 1080, true, out a, out i, out all);
                T.True(a.WinW == i.WinW && i.WinW == all.WinW && all.Raised && all.GroupStart == 28, "All apps shares the window, raised, with its pills");
            });

            T.Run("row: sources added from the Sources page, taken out, marked; older lists", () =>
            {
                // The three lists as the service writes them (dock-catalog.js: tsv, inputsTsv, allAppsTsv) after the row ["app:org.a","source:14"].
                AppEntry[] row = Catalog.Parse("a\tA\torg.a\t\t\t\t\tapp:org.a\nin-hdmi2\tHDMI 2\tsource:14\t\t\t\t\tsource:14\n"
                    + "allapps\tAll apps\tpanel:allapps\nsamsunghome\tSamsung Home\tsys:com.samsung.tv.csfs").Entries;
                AppEntry[] inputs = Catalog.Parse("# Sources in physical port order\nin-tv\tTV\tsource:0\t\t\t\t\tsource:0\nin-hdmi1\tHDMI 1 - Console\tsource:13\t\t\t\t\tsource:13\n"
                    + "in-hdmi2\tHDMI 2\tsource:14\t\t\t\t\tsource:14\nin-hdmi3\tHDMI 3\tsource:15\t\t\t\t\tsource:15\nin-hdmi4\tHDMI 4\tsource:16\t\t\t\t\tsource:16").Entries;
                T.Eq(inputs.Length, 5, "the five inputs parse with their row keys");
                T.Eq(inputs[0].RowKey, "source:0", "TV is source:0");
                T.True(inputs[0].SourceType == 0 && inputs[1].SourceType == 13 && !inputs[1].IsSystem, "an input is a plain entry that switches the source");
                T.Eq(row[1].SourceType, 14, "the row tile of an input switches to it");
                T.Eq(RowEdit.IndexOf(row, "source:14"), 1, "the source in the row is found by its key");
                T.True(RowEdit.CanEdit(row), "a row with a source tile can still be edited");
                T.True(RowEdit.CanAddFrom(inputs, row), "Sources with row keys: hold OK adds and takes out");
                T.Eq(string.Join(",", RowEdit.Marks(inputs, row)), "2", "HDMI 2 carries the tick on Sources");
                bool added;
                AppEntry[] more = RowEdit.Toggle(row, inputs[1], out added);
                T.True(added, "HDMI 1 goes into the row");
                T.Eq(string.Join(",", Array.ConvertAll(more, e => e.Slug)), "a,in-hdmi2,in-hdmi1,allapps,samsunghome", "at the end of the apps, before the pills");
                T.Eq(string.Join(",", RowEdit.Marks(inputs, more)), "1,2", "the marks follow at once");
                T.Eq(RowEdit.Command(RowEdit.Keys(more), 8099),
                    "( /usr/bin/curl -sf -m 15 -X POST -H 'Content-Type: application/json' -d '{\"row\":[\"app:org.a\",\"source:14\",\"source:13\"]}' 'http://127.0.0.1:8099/plugins/launcher/api/row' >/dev/null 2>&1 ) &",
                    "the source keys go to Vetro as they are");
                AppEntry[] less = RowEdit.Toggle(more, inputs[2], out added);
                T.True(!added && RowEdit.IndexOf(less, "source:14") < 0 && less.Length == 4, "a second hold on HDMI 2 takes it out");
                T.Eq(string.Join(",", Array.ConvertAll(less, e => e.Slug)), "a,in-hdmi1,allapps,samsunghome", "the rest of the row keeps its order");
                AppEntry[] lone = RowEdit.Remove(less, 0);
                T.Eq(string.Join(",", Array.ConvertAll(lone, e => e.Slug)), "in-hdmi1,allapps,samsunghome", "a row of one source");
                T.True(RowEdit.Toggle(lone, inputs[1], out added) == lone && !added, "the last tile of the row stays, even a source");
                T.True(RowEdit.Toggle(row, row[2], out added) == row && !added, "a pill is never toggled");
                // A full row: nothing is added.
                var full = new List<AppEntry>();
                for (int n = 0; n < Catalog.MaxEntries - 2; n++) full.Add(new AppEntry("x" + n, "X", "org.x" + n, null, null, -1, null, false, null, null, false, "app:org.x" + n));
                full.Add(row[2]); full.Add(row[3]);
                AppEntry[] fullRow = full.ToArray();
                T.True(RowEdit.Toggle(fullRow, inputs[0], out added) == fullRow && !added, "the row is full: the source is not added");
                // A Sources list written by an older Vetro (no eighth column), or the built-in one: OK only switches, no hold, no promise.
                AppEntry[] oldInputs = Catalog.Parse("in-tv\tTV\tsource:0\nin-hdmi1\tHDMI 1\tsource:13").Entries;
                T.True(!RowEdit.CanAddFrom(oldInputs, row) && !RowEdit.CanAddFrom(Catalog.BuiltInInputs(), row), "an older Sources list cannot add");
                T.True(RowEdit.Toggle(row, oldInputs[1], out added) == row && !added, "and a hold on it does nothing");
                T.Eq(RowEdit.Marks(oldInputs, row).Count, 0, "and nothing is marked");
                AppEntry[] oldRow = Catalog.Parse("a\tA\torg.a\nallapps\tAll apps\tpanel:allapps").Entries;
                T.True(!RowEdit.CanAddFrom(inputs, oldRow), "a row of an older Vetro cannot take a source either");
            });

            T.Run("picture mode and sleep timer cards: what is read, what is offered, what is sent", () =>
            {
                T.Eq(string.Join(",", Array.ConvertAll(ControlCenter.Parse("sleep,picture,tasks,audio", false), k => k.ToString())), "Sleep,Picture,Tasks", "the two new cards, at most three");
                T.Eq(ControlCenter.HintText(new[] { CardKind.Picture }), "Picture mode", "one card: its name");
                // The answers as the Q80A gave them (read only, 2026-11-16): Movie now, five modes offered on that source.
                Func<int[], string> offer = ids => { var b = new System.Text.StringBuilder(); foreach (int id in PictureModes.Candidates) b.Append(Array.IndexOf(ids, id) >= 0 ? "i 1\n" : "i 2\n"); return b.ToString(); };
                string checks = offer(new[] { 65536, 65537, 65542, 65538, 655360 });
                ChoiceState p = PictureModes.Build("ii 65538 0\n", checks);
                T.Eq(string.Join(",", p.Rows.ConvertAll(r => r.Label).ToArray()), "Dynamic,Standard,Natural,Movie,Filmmaker Mode", "Samsung's order, only what the TV offers");
                T.True(p.Choosable && p.Rows[3].Active && !p.Rows[0].Active, "the current one ticked");
                ChoiceState hdr = PictureModes.Build("ii 393217 0", offer(new[] { 65536, 393216, 393217, 655361 }));
                T.True(hdr.Rows.Exists(r => r.Label == "Movie" && r.Active), "an HDR variant reads as its own name");
                ChoiceState game = PictureModes.Build("ii 65547 0", checks);
                T.True(!game.Choosable && game.Rows.Count == 1 && game.Rows[0].Label == "Game" && game.Note == "Set in Samsung's menu", "Game mode locks the list, as on Samsung's menu");
                ChoiceState home = PictureModes.Build("ii 327705 0", checks);
                T.True(home.Choosable && !home.Rows.Exists(r => r.Active) && home.Rows.Count == 5, "NewHome (327705, Samsung's Home picture): nothing ticked, the list stays choosable");
                ChoiceState eco = PictureModes.Build("ii 65552 0", offer(new[] { 65536, 65537, 65552, 65538, 655360 }));
                T.Eq(string.Join(",", eco.Rows.ConvertAll(r => r.Label).ToArray()), "Dynamic,Standard,Eco,Movie,Filmmaker Mode", "Eco after Standard, as on a 2024 TV");
                T.True(eco.Rows[2].Active, "Eco ticked");
                ChoiceState dimmed = PictureModes.Build("ii 589824 0", checks);
                T.True(!dimmed.Choosable && dimmed.Rows.Count == 1 && dimmed.Rows[0].Label == "Adaptive Picture", "a mode the TV does not offer in its list (2021) locks it");
                T.True(!PictureModes.Build("", "").Choosable && PictureModes.Build("Failed to connect", checks.ToString()).Note == "Not available", "nothing read: not available");
                T.Eq(PictureModes.SetCommand(655360), "busctl call org.tizen.tv.avoc /org/tizen/tv/avoc org.tizen.tv.avoc.AvOutputControl SetPictureMode ii 655360 1", "set and saved, as Samsung's menu does");
                T.True(PictureModes.SetCommand(65547) == null && PictureModes.SetCommand(-1) == null, "only a candidate can be set");
                T.Eq(PictureModes.Numbers("ii 65538 0").Count, 2, "busctl's answer read"); T.Eq(PictureModes.Numbers("x 1").Count, 0, "not an answer");
                // The reads give up after 3 s each (a stuck avocd must not hold the card for minutes); the set keeps busctl's own wait.
                T.True(PictureModes.GetCommand().StartsWith("busctl --timeout=3 call org.tizen.tv.avoc "), "the read has a short timeout");
                T.True(PictureModes.CheckCommand().Contains("busctl --timeout=3 call ") && !PictureModes.CheckCommand().Contains("busctl call "), "every check has it");
                T.True(PictureModes.SetCommand(655360).StartsWith("busctl call "), "the set does not");
                // The port the launcher calls Vetro on: the one given at start, 8099 for anything that is not a usable port.
                T.Eq(ShardLaunch.ParsePort("9000"), 9000, "the service port given at start"); T.Eq(ShardLaunch.ParsePort(null), 8099, "no port: the default");
                T.Eq(ShardLaunch.ParsePort("80"), 8099, "a reserved port is refused"); T.Eq(ShardLaunch.ParsePort("9000; reboot"), 8099, "only digits");
                // A list that draws its icons small prepares them small: the Task manager asks for 104 px, the dock keeps the
                // size its selected icon is drawn at (112), so nothing is kept that is never shown (#242, by swiezaczek).
                T.Eq(IconPrep.SideFor(512, 512), DockLayout.FocusIcon, "the dock's icons: up to the selected icon's size"); T.Eq(IconPrep.SideFor(512, 512, 104), 104, "the Task manager's: 104");
                T.Eq(IconPrep.SideFor(64, 64, 104), 64, "a small icon is not enlarged");
                T.Eq(IconPrep.Prepare(new uint[512 * 512], 512, 512, 104).Length, 104 * 104, "prepared at the size asked for");
                string off = "memory/menu/system/time/sleeptimer/savetime, value = 0 (Int32)\ndb/menu/system/time/sleeptimer/time_t, value = 0 (String)\n";
                ChoiceState s = SleepTimer.Build(off);
                T.Eq(string.Join(",", s.Rows.ConvertAll(r => r.Label).ToArray()), "Off,30 min,60 min,120 min,180 min", "Samsung's five choices");
                T.True(s.Rows[0].Active && s.Note == "", "off ticked, no line");
                ChoiceState on = SleepTimer.Build("memory/menu/system/time/sleeptimer/savetime, value = 3 (Int32)\ndb/menu/system/time/sleeptimer/time_t, value = 97 (String)");
                T.True(on.Rows[3].Active && on.Note == "TV off in 97 min", "120 min chosen, 97 left");
                T.True(!SleepTimer.Build("").Choosable && !SleepTimer.Build("memory/menu/system/time/sleeptimer/savetime, value = 9 (Int32)").Choosable, "unreadable or unknown: not available");
                T.Eq(SleepTimer.SetCommand(2), "vconftool set -f -t int memory/menu/system/time/sleeptimer/savetime 2 && vconftool set -f -t string db/menu/system/time/sleeptimer/time_t 60", "the index first, then the minutes");
                T.Eq(SleepTimer.SetCommand(0), "vconftool set -f -t int memory/menu/system/time/sleeptimer/savetime 0 && vconftool set -f -t string db/menu/system/time/sleeptimer/time_t 0", "off");
                T.True(SleepTimer.SetCommand(5) == null && SleepTimer.SetCommand(-1) == null, "nothing outside Samsung's five");
            });

            T.Run("shard cards: --cards tokens, labels, title and hint", () =>
            {
                Func<CardSpec[], string> names = k => string.Join(",", Array.ConvertAll(k, x => x.ToString()));
                CardSpec[] one = ControlCenter.Parse("shard:demo-lights", false);
                T.Eq(names(one), "Shard:demo-lights", "a Shard's card alone");
                T.Eq(one[0].Kind, CardKind.Shard, "its kind"); T.Eq(one[0].Label, "demo-lights", "no label: the id");
                T.Eq(ControlCenter.HintText(one), "demo-lights", "one card: its title under the bar");
                CardSpec[] lab = ControlCenter.Parse("shard:demo-lights:Demo=20lights", false);
                T.Eq(lab[0].Label, "Demo lights", "the label, a space escaped");
                T.Eq(ControlCenter.Title(lab[0]), "Demo lights", "the card's title is the label");
                T.Eq(ControlCenter.HintText(lab), "Demo lights", "and so is the hint");
                T.Eq(names(ControlCenter.Parse("tasks,shard:demo-lights,audio", false)), "Tasks,Shard:demo-lights,Audio", "in the order given, beside the others");
                T.Eq(ControlCenter.HintText(ControlCenter.Parse("tasks,shard:demo-lights", false)), "Control center", "two cards: Control center");
                T.Eq(names(ControlCenter.Parse("shard:aa,shard:bb,shard:cc", false)), "Shard:aa,Shard:bb,Shard:cc", "three Shards at once");
                T.Eq(names(ControlCenter.Parse("shard:aa,shard:aa:Other,shard:bb", false)), "Shard:aa,Shard:bb", "each Shard once (the first token wins)");
                T.Eq(names(ControlCenter.Parse("tasks,audio,picture,shard:aa", false)), "Tasks,Audio,Picture", "at most three cards");
                T.Eq(names(ControlCenter.Parse("shard:aa,tasks,sleep,audio", false)), "Shard:aa,Tasks,Sleep", "a Shard counts as one of the three");
                T.Eq(names(ControlCenter.Parse("shard:,shard:a,shard:Aa,shard:1a,shard:a_b,shard:a;b,shard:" + new string('a', 33) + ",shard,tasks", false)), "Tasks", "bad ids skipped");
                T.Eq(names(ControlCenter.Parse("shard:" + new string('a', 32), false)), "Shard:" + new string('a', 32), "32 characters is the longest id");
                T.Eq(ControlCenter.Parse("shard:aa:Caf=C3=A9", false)[0].Label, "Café", "UTF-8 bytes decoded");
                T.Eq(ControlCenter.Parse("shard:aa:=E2=9C=A8=20Lights", false)[0].Label, "✨ Lights", "a symbol too");
                T.Eq(ControlCenter.Parse("shard:aa:caf=c3=a9", false)[0].Label, "café", "lower-case hex read as well");
                T.Eq(ControlCenter.Parse("shard:aa:Bad=G1", false)[0].Label, "aa", "a bad escape: the id");
                T.Eq(ControlCenter.Parse("shard:aa:Bad=4", false)[0].Label, "aa", "an escape cut short: the id");
                T.Eq(ControlCenter.Parse("shard:aa:Bad=", false)[0].Label, "aa", "a lone '=': the id");
                T.Eq(ControlCenter.Parse("shard:aa:Two words", false)[0].Label, "aa", "a space that should have been escaped: the id");
                T.Eq(ControlCenter.Parse("shard:aa:a:b", false)[0].Label, "aa", "a raw ':' in the label: the id");
                T.Eq(ControlCenter.Parse("shard:aa:=C3", false)[0].Label, "aa", "bytes that are not UTF-8: the id");
                T.Eq(ControlCenter.Parse("shard:aa:=0A", false)[0].Label, "aa", "a control character: the id");
                T.Eq(ControlCenter.Parse("shard:aa:=20=20", false)[0].Label, "aa", "only spaces: the id");
                T.Eq(ControlCenter.Parse("shard:aa:", false)[0].Label, "aa", "an empty label: the id");
                T.Eq(ControlCenter.Parse("shard:aa:" + new string('x', 24), false)[0].Label, new string('x', 24), "24 characters is the longest label");
                T.Eq(ControlCenter.Parse("shard:aa:" + new string('x', 25), false)[0].Label, "aa", "25 is too long: the id");
                T.Eq(ShardCard.EncodeLabel("Café: 1_2,3=4%"), "Caf=C3=A9=3A=201=5F2=2C3=3D4=25", "the service's escape: ':', ' ', '_', ',', '=', '%' too");
                T.Eq(ShardCard.DecodeLabel(ShardCard.EncodeLabel("Luci · salotto")), "Luci · salotto", "and back");
                T.True(ShardCard.EncodeLabel("Caf=C3=A9").IndexOf('%') < 0, "no '%' ever, for systemd's ExecStart");
            });

            T.Run("shard cards: the curl commands only carry checked ids", () =>
            {
                T.Eq(ShardCard.ReadCommand("demo-lights", 8099), "/usr/bin/curl -sf -m 5 'http://127.0.0.1:8099/plugins/launcher/api/card?plugin=demo-lights'", "the read: 5 s");
                T.Eq(ShardCard.SelectCommand("demo-lights", "living_room.1", 9000), "/usr/bin/curl -sf -m 12 -X POST 'http://127.0.0.1:9000/plugins/launcher/api/card-select?plugin=demo-lights&row=living_room.1'", "the choice: 12 s, a POST, the port given");
                foreach (string bad in new[] { null, "", "a", "A-b", "a'b", "a b", "a;reboot", "a$(x)", "a&b=c" })
                {
                    T.True(ShardCard.ReadCommand(bad, 8099) == null, "a bad Shard id never reaches the shell: " + bad);
                    T.True(ShardCard.SelectCommand(bad, "row", 8099) == null, "nor in a choice: " + bad);
                }
                foreach (string bad in new[] { null, "", "a b", "a'b", "a&plugin=x", "a/b", "a;b", "é", new string('r', 41) })
                    T.True(ShardCard.SelectCommand("demo-lights", bad, 8099) == null, "a bad row id never reaches the shell: " + bad);
                T.True(ShardCard.SelectCommand("demo-lights", new string('r', 40), 8099) != null, "40 characters is the longest row id");
            });

            T.Run("shard cards: what the service answers, read again here", () =>
            {
                string r; ChoiceState st;
                st = ShardCard.Parse("status\tok\nnote\t2 on\nrow\tliving\tLiving room\t80%\t1\nrow\tkitchen\tKitchen\t\t0\r\nrow\toff\tOff\t\t0\n", out r);
                T.True(st.Choosable && st.Note == "2 on" && st.Rows.Count == 3, "ok: the rows and the note");
                T.Eq(st.Rows[0].Label, "Living room · 80%", "a value after a middle dot");
                T.Eq(st.Rows[1].Label, "Kitchen", "no value: the label alone (CRLF tolerated)");
                T.True(st.Rows[0].Active && !st.Rows[1].Active, "ticked is the active row");
                T.True(st.Rows[0].Id == "living" && st.Rows[2].Id == "off" && st.Rows[0].Value == 0 && st.Rows[2].Value == 2, "each row keeps its id, its value is its index");
                T.True(r == null, "a read has no result");
                st = ShardCard.Parse("status\tok\nresult\tfail\nnote\tThe bridge did not answer\nrow\ta\tA\t\t1\n", out r);
                T.True(r == "fail" && st.Rows.Count == 1 && st.Note == "The bridge did not answer", "a choice's result, the card as it is now");
                st = ShardCard.Parse("status\tok\nchoosable\t0\nrow\ta\tA\t\t1\n");
                T.True(!st.Choosable && st.Rows.Count == 1, "choosable 0: shown, not chosen");
                T.True(ShardCard.Parse("status\tok\nrow\ta\tA\t\t0").Choosable, "choosable when it is not said");
                st = ShardCard.Parse("status\tunavailable\nnote\tThe Shard is off\nrow\ta\tA\t\t1\n");
                T.True(!st.Choosable && st.Rows.Count == 0 && st.Note == "The Shard is off", "unavailable: its reason, no rows");
                T.Eq(ShardCard.Parse("status\tunavailable\n").Note, "Not available", "unavailable without a reason");
                foreach (string bad in new[] { null, "", "\n\n", "<html>502 Bad Gateway</html>", "status\tmaybe\nrow\ta\tA\t\t1", "row\ta\tA\t\t1", "status ok\nrow a A  1" })
                {
                    ChoiceState g = ShardCard.Parse(bad);
                    T.True(!g.Choosable && g.Rows.Count == 0 && g.Note == "Not available", "garbage or nothing: not available (" + (bad ?? "null") + ")");
                }
                st = ShardCard.Parse("status\tok\n");
                T.True(!st.Choosable && st.Note == "Not available", "ok without rows: nothing to choose");
                var many = new StringBuilder("status\tok\n");
                for (int i = 0; i < 10; i++) many.Append("row\tr" + i + "\tRow " + i + "\t\t0\n");
                st = ShardCard.Parse(many.ToString());
                T.Eq(st.Rows.Count, ShardCard.MaxRows, "at most seven rows (plugins.md); the card shows five and scrolls");
                T.Eq(st.Rows[6].Id, "r6", "the first seven");
                st = ShardCard.Parse("status\tok\nrow\ta b\tSpace\t\t0\nrow\ta'b\tQuote\t\t0\nrow\t\tEmpty\t\t0\nrow\tok\tGood\t\t0\nrow\tok\tAgain\t\t1\nrow\tn\t\t\t0\nrow\tt\tTick\t\tyes\n");
                T.Eq(st.Rows.Count, 1, "rows with a bad id, a repeated id, no label or a bad tick dropped");
                T.True(st.Rows[0].Id == "ok" && st.Rows[0].Label == "Good" && st.Rows[0].Value == 0, "the good one, at index 0");
                st = ShardCard.Parse("status\tok\nrow\ta\tLabel\twith\ttab\t1\nrow\tb\tB\t\t0\nrow\tc\tC\t\t0\textra\nnote\tone\ttwo\n");
                T.True(st.Rows.Count == 1 && st.Rows[0].Id == "b", "a tab inside a row's texts shifts its fields: the row is dropped");
                T.Eq(st.Note, "one two", "a tab inside the note reads as a space");
                st = ShardCard.Parse("status\tok\nnote\t" + new string('n', 100) + "\nrow\ta\t" + new string('l', 50) + "\t" + new string('v', 30) + "\t0\nunknown\tline\n");
                T.Eq(st.Note.Length, ShardCard.MaxNote, "a long note is cut to 80");
                T.True(st.Note.EndsWith("…"), "with an ellipsis");
                T.Eq(st.Rows[0].Label, new string('l', 39) + "… · " + new string('v', 23) + "…", "a long label cut to 40, a long value to 24");
                T.Eq(ShardCard.Parse("status\tok\nrow\ta\tA\u0007b\t\t0\n").Rows[0].Label, "A b", "control characters read as spaces");
            });

            T.Run("design: one material for the panels", () =>
            {
                T.True(Design.PanelRadius <= Design.SheetSlice && Design.PanelRadius + Design.ShellBorderW <= Design.RimSlice, "border scales of at most 1: corners are never drawn from a stretched picture");
                T.True(2 * Design.PanelRadius <= new DockLayout(5, 1920, 1080).PillH, "the bar's corners meet at most in the middle of its sides");
            });

            Console.WriteLine();
            LauncherRegressionTests.Run();
            LauncherRegressionTests.RunWallpaperScaleTests();
            BackHoldTests.Run();
            Console.WriteLine(T.Checks + " checks, " + T.Failures + " failures");
            return T.Failures == 0 ? 0 : 1;
        }
    }
}
