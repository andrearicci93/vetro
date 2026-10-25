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
                    "I: Bus=0005 Vendor=04e8\nN: Name=\"vetro-forwarded-remote\"\nH: Handlers=kbd event20\n\n" +
                    "I: Bus=0005\nN: Name=\"dummy-uinput\"\nH: Handlers=kbd event21\n";
                var nodes = InputDevices.RemoteNodes(text);
                T.Eq(nodes.Count, 4, "three remotes plus Vetro's forwarded one");
                T.Eq(nodes[3], "/dev/input/event20", "vetro-forwarded-remote is watched (the grabbed remote goes silent)");
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
                T.Eq(panel.Top, DockLayout.Margin, "raised pill starts right under the shadow margin");
                T.Eq(apps.RowCenterY - panel.RowCenterY, DockLayout.HintH, "icon row follows the pill");
                T.Eq(apps.LabelTop(0) - panel.LabelTop(0), DockLayout.HintH, "label follows the pill");
                T.Eq(apps.PillBox(0).Y - panel.PillBox(0).Y, DockLayout.HintH, "pill box follows");
                T.Eq(apps.ShadowBox(0).Y - panel.ShadowBox(0).Y, DockLayout.HintH, "shadow box follows");
                T.True(apps.ShadowBox(0).Y >= 0 && panel.ShadowBox(0).Y >= 0, "shadow never starts above the window");
                T.True(apps.ShadowBox(0).Y + apps.ShadowBox(0).H <= apps.WinH + Design.ShadowDy, "apps shadow stays in the window (bar its offset: that part is below the screen edge)");
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
                T.True(!Catalog.ValidIconPath("/etc/passwd"), "outside the icon places");
                T.True(!Catalog.ValidIconPath("/opt/usr/apps/../../etc/x.png"), "no parent directories");
                T.True(!Catalog.ValidIconPath("/opt/usr/apps/a b.png"), "no spaces");
                T.True(!Catalog.ValidIconPath("/opt/usr/apps/a.jpg"), "png only");
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
                int s = 128;
                var solid = new uint[s * s];
                for (int i = 0; i < solid.Length; i++) solid[i] = 0xFF2080FFu;
                var done = IconPrep.Prepare(solid, s, s);
                T.Eq(done.Length, s * s, "same size out");
                T.Eq(done[0] >> 24, 0u, "the very corner is transparent");
                T.Eq(done[s / 2 * s + s / 2], 0xFF2080FFu, "the middle is untouched");
                int r = IconPrep.Corner(s);
                T.Eq(r, (int)Math.Round(Design.IconRadiusPct * s / 100.0), "the radius is the design's percentage of the side");
                T.Eq(r, 20, "16% of 128");
                // The thin light line lies just inside the edge, and only there.
                uint edge = done[s / 2];
                T.True(((edge >> 16) & 0xFF) > 0x20 && (edge >> 24) == 255u, "the middle of an edge carries the light line");
                T.Eq(done[4 * s + s / 2], 0xFF2080FFu, "a few pixels in, the picture is untouched");
                T.Eq(done[r * s + 0] >> 24, 255u, "below the corner arc the edge is opaque");
                // A transparent canvas with a small opaque square: a loose logo.
                var loose = new uint[s * s];
                for (int y = 40; y < 88; y++) for (int x = 40; x < 88; x++) loose[y * s + x] = 0xFFFFFFFFu;
                T.True(IconPrep.Coverage(loose) < IconPrep.LooseCoverage, "coverage says loose");
                var tiled = IconPrep.Prepare(loose, s, s);
                T.Eq(tiled[s / 2 * s + 6] >> 24, 255u, "the tile fills what the logo left empty");
                T.Eq(tiled[0] >> 24, 0u, "tile corners are rounded too");
                uint centre = tiled[s / 2 * s + s / 2];
                T.True(((centre >> 16) & 0xFF) > 200, "the logo sits in the middle, still light");
                T.True(((tiled[s / 2 * s + 6] >> 16) & 0xFF) < 100, "and the tile around it is dark");
                // Not square: never cropped, always ends square.
                var wide = new uint[200 * 100];
                for (int i = 0; i < wide.Length; i++) wide[i] = 0xFFFF0000u;
                var sq = IconPrep.Prepare(wide, 200, 100);
                T.Eq(sq.Length, 200 * 200, "a wide icon becomes a square of its longer side");
                T.Eq(sq[100 * 200 + 100], 0xFFFF0000u, "the whole picture sits in the middle");
                T.Eq(sq[5 * 200 + 100] >> 24, 255u, "the blurred fill covers the band above it (no transparent bars)");
                T.Eq(sq[0] >> 24, 0u, "and the corners are rounded");
                // A banner as big as the screen: brought down, then treated the same way.
                var banner = new uint[1920 * 1080];
                for (int i = 0; i < banner.Length; i++) banner[i] = (i / 1920) < 540 ? 0xFF40C0FFu : 0xFFC0E0FFu;
                var bi = IconPrep.Prepare(banner, 1920, 1080);
                T.Eq(bi.Length, IconPrep.MaxSide * IconPrep.MaxSide, "a 1920x1080 banner ends as a 256 px square");
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
                        sink += layout.PillBox(slide).X + layout.ShadowBox(slide).Y + layout.GlowBox((int)fp, sc, slide).X + layout.LabelCenterX((int)fp, sc) + layout.LabelTop(slide)
                            + layout.HintTop(slide) + layout.HintLeft(118) + layout.DividerBox(sc, slide).X;
                        for (int i = 0; i < layout.Count; i++) { sink += layout.IconBox(i, fp, sc, slide).W; sink += (long)DockLayout.Amount(fp, i); }
                    }
                    presses.Clear(); reader.Feed(ev, ev.Length, presses); sink += presses.Count;
                };
                for (int i = 0; i < 2000; i++) once();   // warm-up: JIT and first-use costs
                long before = GC.GetAllocatedBytesForCurrentThread();
                for (int i = 0; i < 20000; i++) once();
                long after = GC.GetAllocatedBytesForCurrentThread();
                T.Eq(after - before, 0L, "bytes allocated over 20000 iterations of 30 frames (sink " + sink + ")");
            });

            Console.WriteLine();
            Console.WriteLine(T.Checks + " checks, " + T.Failures + " failures");
            return T.Failures == 0 ? 0 : 1;
        }
    }
}
