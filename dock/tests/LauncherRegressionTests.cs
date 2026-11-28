using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using Launcher.Core;

namespace Launcher.Tests
{
    internal static class LauncherRegressionTests
    {
        private static string Q(string s) { return "'" + s.Replace("'", "'\"'\"'") + "'"; }
        private static void Shell(string command)
        {
            var start = new ProcessStartInfo("/bin/sh") { UseShellExecute = false };
            start.ArgumentList.Add("-c"); start.ArgumentList.Add(command);
            using (var process = Process.Start(start))
            {
                if (!process.WaitForExit(6000)) { process.Kill(true); throw new Exception("shell test timed out"); }
                T.Eq(process.ExitCode, 0, "shell completed");
            }
        }

        // Exact Tizen 9 org.enlightenment.wm.Test.GetWinsInfo ua(usiiiiibbbiibibbbi) struct formatters:
        // literal (--print-reply=literal) prints i[0] (x) inline after title (or as leading int32 when title is empty);
        // non-literal (--print-reply) prints string "<title>" on its own line followed by 5 int32 lines (x, y, w, h, layer).
        private static string WinLiteral(uint id, string title, int x, int y, int w, int h, int layer, bool mapped = true, bool compData = false, bool frameVis = false, int obscured = 0)
        {
            string titleAndX = string.IsNullOrEmpty(title)
                ? "            int32 " + x
                : "   " + title + "         int32 " + x;
            return "      struct {\n"
                + "         uint32 " + id + "\n"
                + titleAndX + "\n"
                + "         int32 " + y + "\n"
                + "         int32 " + w + "\n"
                + "         int32 " + h + "\n"
                + "         int32 " + layer + "\n"
                + "         boolean " + (compData ? "true" : "false") + "\n"
                + "         boolean " + (mapped ? "true" : "false") + "\n"
                + "         boolean " + (frameVis ? "true" : "false") + "\n"
                + "         int32 -1\n"
                + "         int32 " + obscured + "\n"
                + "         boolean false\n"
                + "         int32 0\n"
                + "         boolean true\n"
                + "         boolean false\n"
                + "         boolean false\n"
                + "         int32 0\n"
                + "      }\n";
        }

        private static string WinStandard(uint id, string title, int x, int y, int w, int h, int layer, bool mapped = true, bool compData = false, bool frameVis = false, int obscured = 0)
        {
            return "      struct {\n"
                + "         uint32 " + id + "\n"
                + "         string \"" + (title ?? "") + "\"\n"
                + "         int32 " + x + "\n"
                + "         int32 " + y + "\n"
                + "         int32 " + w + "\n"
                + "         int32 " + h + "\n"
                + "         int32 " + layer + "\n"
                + "         boolean " + (compData ? "true" : "false") + "\n"
                + "         boolean " + (mapped ? "true" : "false") + "\n"
                + "         boolean " + (frameVis ? "true" : "false") + "\n"
                + "         int32 -1\n"
                + "         int32 " + obscured + "\n"
                + "         boolean false\n"
                + "         int32 0\n"
                + "         boolean true\n"
                + "         boolean false\n"
                + "         boolean false\n"
                + "         int32 0\n"
                + "      }\n";
        }

        private static string WinsReply(params string[] winBlocks)
        {
            return "   uint32 " + winBlocks.Length + "\n   array [\n" + string.Concat(winBlocks) + "   ]\n";
        }

        public static void Run()
        {
            T.Run("raw navigation: immediate presses, delayed echoes, aliases, stale counts and hidden dock", () =>
            {
                var nav = new NavigationInput();
                T.Eq(nav.Press(106, false, 0), null, "hidden dock ignores raw navigation");
                T.True(!nav.IsEcho("Right", 0.14), "hidden press does not swallow a key later");
                T.Eq(nav.Press(106, true, 1), "Right", "raw press is delivered now");
                T.Eq(nav.Press(106, true, 1.05), "Right", "a second real press is not deduplicated");
                T.True(nav.IsEcho("Right", 1.14), "first echo discarded");
                T.True(nav.IsEcho("Right", 1.19), "second echo discarded");
                T.True(!nav.IsEcho("Right", 1.2), "next compositor-only press remains valid");
                nav.Press(28, true, 2); T.True(nav.IsEcho("Select", 2.14), "OK alias");
                nav.Press(1, true, 3); T.True(nav.IsEcho("Escape", 3.14), "Back alias");
                nav.Press(105, true, 4); T.True(!nav.IsEcho("Left", 5.1), "late key is a fresh press");
                nav.Press(105, true, 6); nav.Press(105, true, 7.1);
                T.True(nav.IsEcho("Left", 7.2), "current echo discarded");
                T.True(!nav.IsEcho("Left", 7.3), "expired unmatched counts cannot swallow new presses");
                T.Eq(nav.Press(63, true, 8), null, "Home has its own debounce");
            });

            T.Run("reduce motion: instant visibility, pages, focus and stable icon geometry", () =>
            {
                bool instant = Controller.Instant, grow = DockLayout.Grow, glow = DockLayout.GlowFromIcon;
                try
                {
                    Controller.Instant = true; DockLayout.Grow = false; DockLayout.GlowFromIcon = false;
                    var layout = new DockLayout(20, 1920, 1080);
                    var ctl = new Controller(layout); ctl.Show(); int index;
                    T.Eq(ctl.Phase, Phase.Shown, "show has no fade or cascade"); T.Eq(ctl.Presence, 1f, "fully opaque immediately");
                    for (int i = 0; i < ctl.Count; i++) { T.Eq(ctl.ItemPresence(i), 1f, "no stagger"); T.Eq(ctl.ItemSlide(i), 0, "no entrance slide"); }
                    T.True(!ctl.Tick(0), "no animation frames needed while shown");
                    var panel = new Controller(layout, PageKind.Panel); panel.AdoptVisibility(ctl, .55f);
                    T.Eq(panel.Phase, Phase.Shown, "panel is immediate"); T.Eq(panel.Presence, 1f, "no page pop");
                    ctl.AdoptVisibility(panel, .55f);
                    ctl.Hide(); T.Eq(ctl.Phase, Phase.Hidden, "no hide transition"); T.Eq(ctl.Presence, 0f, "hidden immediately");
                    T.Eq(ctl.Slide, 0, "no exit slide"); T.True(!ctl.Tick(0), "no frames needed after hiding"); ctl.Show();
                    ctl.Key("Right", out index);
                    T.Eq(ctl.FocusPos, 1f, "focus changes without waiting for a frame");
                    var selected = layout.IconBox(1, 1, ctl.Scroll, 0);
                    var unselected = layout.IconBox(1, 0, ctl.Scroll, 0);
                    T.Eq(selected.W, unselected.W, "no zoom"); T.Eq(selected.Y, unselected.Y, "no lift");
                    for (int i = 0; i < 15; i++) ctl.Key("Right", out index);
                    T.Eq(ctl.Scroll, layout.ScrollFor(ctl.FocusTarget), "scroll follows the instant focus");
                    Controller.Instant = false;
                    ctl.Key("Left", out index);
                    T.True(ctl.FocusPos != ctl.FocusTarget, "normal motion remains available");
                }
                finally { Controller.Instant = instant; DockLayout.Grow = grow; DockLayout.GlowFromIcon = glow; }
            });

            T.Run("multi-app Home guard: every target guarded, cancellation stops the entire chain", () =>
            {
                string[] ids = HomeGuard.Parse("com.samsung.tv.csfs,com.samsung.tv.home.sidebar,com.samsung.tv.home.media");
                T.Eq(ids.Length, 3, "three valid targets");
                T.Eq(HomeGuard.Parse("com.samsung.tv.csfs;touch /tmp/x"), null, "shell metacharacters refused");
                T.Eq(HomeGuard.Parse("com.samsung.tv.csfs,,other"), null, "empty target refused");
                foreach (string id in ids) T.True(HomeGuard.ShouldCancel(ids, id), "target cancels guard");
                T.True(HomeGuard.ShouldCancel(ids, "com.samsung.tv.coba.newhome"), "CoBA launcher cancels guard");
                T.True(!HomeGuard.ShouldCancel(ids, "org.tizen.browser"), "unrelated app does not cancel guard");
                string dir = Path.Combine(Path.GetTempPath(), "vetro-guard-'" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(dir);
                try
                {
                    string gen = Path.Combine(dir, "generation"), log = Path.Combine(dir, "calls"), tool = Path.Combine(dir, "launcher");
                    File.WriteAllText(tool, "#!/bin/sh\necho \"$2\" >> " + Q(log) + "\n");
                    Shell("chmod +x " + Q(tool)); File.WriteAllText(gen, "1");
                    string command = HomeGuard.Command(ids, gen, 1).Replace("/usr/bin/app_launcher", Q(tool));
                    Shell(command + " wait");
                    string[] calls = File.ReadAllLines(log); T.Eq(calls.Length, 15, "all three targets in all five rounds");
                    for (int i = 0; i < calls.Length; i++) T.Eq(calls[i], ids[i % 3], "target order");
                    File.Delete(log); File.WriteAllText(gen, "2"); Shell(command + " wait");
                    T.True(!File.Exists(log), "retired generation issues no kills");
                    File.WriteAllText(gen, "1");
                    File.WriteAllText(tool, "#!/bin/sh\necho \"$2\" >> " + Q(log) + "\necho 2 > " + Q(gen) + "\n");
                    Shell(command + " wait");
                    T.Eq(File.ReadAllLines(log).Length, 1, "cancellation between targets stops remaining targets too");
                }
                finally { Directory.Delete(dir, true); }
            });

            T.Run("shard card: the shell gives curl the whole URL, '&' and all, as one argument", () =>
            {
                string dir = Path.Combine(Path.GetTempPath(), "vetro-shard-'" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(dir);
                try
                {
                    string log = Path.Combine(dir, "args"), tool = Path.Combine(dir, "curl");
                    File.WriteAllText(tool, "#!/bin/sh\nfor a in \"$@\"; do echo \"$a\" >> " + Q(log) + "; done\n");
                    Shell("chmod +x " + Q(tool));
                    Shell(ShardCard.SelectCommand("demo-lights", "living_room.1", 8099).Replace("/usr/bin/curl", Q(tool)));
                    T.Eq(string.Join(" | ", File.ReadAllLines(log)), "-sf | -m | 12 | -X | POST | http://127.0.0.1:8099/plugins/launcher/api/card-select?plugin=demo-lights&row=living_room.1", "the choice: one URL, nothing run in the background");
                    File.Delete(log);
                    Shell(ShardCard.ReadCommand("demo-lights", 8099).Replace("/usr/bin/curl", Q(tool)));
                    T.Eq(string.Join(" | ", File.ReadAllLines(log)), "-sf | -m | 5 | http://127.0.0.1:8099/plugins/launcher/api/card?plugin=demo-lights", "the read");
                }
                finally { Directory.Delete(dir, true); }
            });

            T.Run("custom launcher mode: only a plain app id becomes the Home target", () =>
            {
                AppEntry e = HomeLaunch.Parse("org.example.projectivy");
                T.True(e != null, "plain id accepted");
                T.Eq(e.AppId, "org.example.projectivy", "launches the chosen app");
                T.True(!e.IsSystem, "an ordinary app, not a system control");
                T.Eq(HomeLaunch.Parse("app;reboot"), null, "shell metacharacters refused");
                T.Eq(HomeLaunch.Parse(""), null, "empty id refused");
                T.Eq(HomeLaunch.Parse(null), null, "missing id refused");
                T.Eq(HomeLaunch.Command("org.example.projectivy"), "( /usr/bin/app_launcher -e org.example.projectivy || /usr/bin/app_launcher -s org.example.projectivy ) >/dev/null 2>&1 &", "the Home app starts without the loader, with the plain launch as the fallback");
                bool refused = false; try { HomeLaunch.Command("app;reboot"); } catch (ArgumentException) { refused = true; }
                T.True(refused, "an id with shell characters never reaches the command line");
            });

            T.Run("Samsung Home: csfs, with Samsung's Home-key bundle on root-app firmware; the component package is never launched", () =>
            {
                string dir = Path.Combine(Path.GetTempPath(), "vetro-launch-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(dir);
                try
                {
                    string tool = Path.Combine(dir, "launcher"), log = Path.Combine(dir, "calls");
                    string root = Path.Combine(dir, "get_root_app"), done = Path.Combine(dir, "firstscreen_done"), none = Path.Combine(dir, "absent");
                    File.WriteAllText(tool, "#!/bin/sh\necho \"$*\" >> " + Q(log) + "\nexit 0\n");
                    Shell("chmod +x " + Q(tool));
                    Shell(SystemLaunch.Command("com.samsung.tv.coba.newhome", "com.samsung.tv.csfs", none, done).Replace("/usr/bin/app_launcher", Q(tool)) + " wait");
                    T.Eq(string.Join(",", File.ReadAllLines(log)), "-s com.samsung.tv.csfs", "an old list naming the component package opens csfs only, plainly on 2021 firmware");
                    File.Delete(log);
                    File.WriteAllText(root, ""); File.WriteAllText(done, "");
                    Shell(SystemLaunch.Command("com.samsung.tv.csfs", null, root, done).Replace("/usr/bin/app_launcher", Q(tool)) + " wait");
                    T.Eq(string.Join(",", File.ReadAllLines(log)), "-s com.samsung.tv.csfs entry_point smarthub_key __NO_RAISE_WINDOW enable __K_EX_FORCE_BOOST enable", "root-app firmware: Samsung's Home-key bundle");
                    File.Delete(log); File.Delete(done);
                    Shell(SystemLaunch.Command("com.samsung.tv.csfs", null, root, done).Replace("/usr/bin/app_launcher", Q(tool)) + " wait");
                    T.True(File.ReadAllText(log).Contains("__K_SPLASH_SCREEN LA_UI_DEFAULT __K_EX_SPLASH_SCREEN_FORCE_SHOW enable"), "first screen not done yet: the splash keys too");
                    File.Delete(log);
                    File.WriteAllText(tool, "#!/bin/sh\necho \"$*\" >> " + Q(log) + "\n[ $# -le 2 ]\n");
                    Shell(SystemLaunch.Command("com.samsung.tv.csfs", null, root, done).Replace("/usr/bin/app_launcher", Q(tool)) + " wait");
                    T.Eq(File.ReadAllLines(log).Length, 2, "a refused bundle falls back to the plain launch");
                    T.Eq(File.ReadAllLines(log)[1], "-s com.samsung.tv.csfs", "the fallback is the plain launch");
                }
                finally { Directory.Delete(dir, true); }
            });

            T.Run("ordinary system apps retain error-only fallback and single-target launches", () =>
            {
                string dir = Path.Combine(Path.GetTempPath(), "vetro-launch-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(dir);
                try
                {
                    string tool = Path.Combine(dir, "launcher"), log = Path.Combine(dir, "calls");
                    string command = SystemLaunch.Command("org.example.primary", "org.example.fallback").Replace("/usr/bin/app_launcher", Q(tool));
                    File.WriteAllText(tool, "#!/bin/sh\necho \"$2\" >> " + Q(log) + "\nexit 0\n");
                    Shell("chmod +x " + Q(tool)); Shell(command + " wait");
                    T.Eq(string.Join(",", File.ReadAllLines(log)), "org.example.primary", "successful ordinary app does not launch its fallback");
                    File.Delete(log);
                    File.WriteAllText(tool, "#!/bin/sh\necho \"$2\" >> " + Q(log) + "\n[ \"$2\" != org.example.primary ]\n");
                    Shell(command + " wait");
                    T.Eq(string.Join(",", File.ReadAllLines(log)), "org.example.primary,org.example.fallback", "failed ordinary app still tries its fallback");
                    File.Delete(log);
                    Shell(SystemLaunch.Command("com.samsung.tv.csfs", null, "/nonexistent/get_root_app").Replace("/usr/bin/app_launcher", Q(tool)) + " wait");
                    T.Eq(string.Join(",", File.ReadAllLines(log)), "com.samsung.tv.csfs", "Home launches First Screen once on 2021 firmware");
                }
                finally { Directory.Delete(dir, true); }
            });

            T.Run("volume screen: G9 compositor centring and safe fallbacks", () =>
            {
                string info = "Transform : transform count: 2\n" +
                    "[ 0] [base_output_resolution ] [ 0, 0] [2.000, 1.000] [ 0]\n" +
                    "[ 1] [alignment_for_base_outp] [ 960, 0] [0.500, 1.000] [ 0]";
                foreach (var edge in new[] { VolumeEdge.Left, VolumeEdge.Right, VolumeEdge.Top, VolumeEdge.Bottom, VolumeEdge.Hidden })
                {
                    int shift = VolumeScreen.HorizontalOffset(edge, 1920, info);
                    T.Eq(shift, edge == VolumeEdge.Left ? -960 : edge == VolumeEdge.Right ? 960 : 0, "edge correction");
                    T.Eq(VolumeScreen.HorizontalOffset(edge, 1920, null), 0, "missing probe");
                }
                var left = VolumePlacement.For(VolumeEdge.Left, 1920, 1080);
                var right = VolumePlacement.For(VolumeEdge.Right, 1920, 1080);
                T.Eq(left.BodyX - 960 + 960, 96, "left final compositor margin");
                T.Eq(3840 - (right.BodyX + 960 + 960 + right.BodyW), 96, "right final compositor margin");
                foreach (string invalid in new[] { "", info.Replace("count: 2", "count: 3"),
                    info.Replace("2.000", "2..0"), info.Replace("0.500", "0..5"),
                    info.Replace("2.000", "1.000"), info.Replace("0.500", "1.000"),
                    info.Replace("960, 0", "960, 20"), info.Replace("960, 0", "480, 0"),
                    info.Replace("[ 0]\n", "[ 90]\n") })
                    T.Eq(VolumeScreen.HorizontalOffset(VolumeEdge.Left, 1920, invalid), 0, "unknown transform unchanged");
                T.Eq(VolumeScreen.HorizontalOffset(VolumeEdge.Left, 3840, info), 0, "explicit screen override unchanged");
            });

            T.Run("volume pill: four edges, 96 px safe margin, parts inside the body, unknown edge falls back to left", () =>
            {
                T.True(VolumePlacement.ParseEdge("right") == VolumeEdge.Right && VolumePlacement.ParseEdge(" TOP ") == VolumeEdge.Top, "edge names");
                T.True(VolumePlacement.ParseEdge("bottom") == VolumeEdge.Bottom && VolumePlacement.ParseEdge("nonsense") == VolumeEdge.Left && VolumePlacement.ParseEdge(null) == VolumeEdge.Left, "default is left");
                T.True(VolumePlacement.ParseEdge("hidden") == VolumeEdge.Hidden, "hidden: the level changes, no bar");
                var left = VolumePlacement.For(VolumeEdge.Left, 1920, 1080); var right = VolumePlacement.For(VolumeEdge.Right, 1920, 1080);
                var top = VolumePlacement.For(VolumeEdge.Top, 1920, 1080); var bottom = VolumePlacement.For(VolumeEdge.Bottom, 1920, 1080);
                T.Eq(left.BodyX, 96, "left margin"); T.Eq(1920 - (right.BodyX + right.BodyW), 96, "right margin");
                T.Eq(top.BodyY, 96, "top margin"); T.Eq(1080 - (bottom.BodyY + bottom.BodyH), 96, "bottom margin");
                T.True(left.Vertical && right.Vertical && !top.Vertical && !bottom.Vertical, "side edges are vertical");
                T.Eq(left.BodyY * 2 + left.BodyH, 1080, "vertical pill centred"); T.Eq(bottom.BodyX * 2 + bottom.BodyW, 1920, "horizontal pill centred");
                foreach (var p in new[] { left, right, top, bottom })
                {
                    T.True(p.TrackX >= p.BodyX && p.TrackX + p.TrackW <= p.BodyX + p.BodyW && p.TrackY >= p.BodyY && p.TrackY + p.TrackH <= p.BodyY + p.BodyH, "track inside the body");
                    T.True(p.IconX >= p.BodyX && p.IconX + VolumePlacement.IconSize <= p.BodyX + p.BodyW && p.IconY >= p.BodyY && p.IconY + VolumePlacement.IconSize <= p.BodyY + p.BodyH, "icon inside the body");
                    T.True(p.WinX <= p.BodyX - 2 && p.WinY <= p.BodyY - 2 && p.WinX + p.WinW >= p.BodyX + p.BodyW + 2 && p.WinY + p.WinH >= p.BodyY + p.BodyH + 2, "window holds the 2 px light edge");
                    T.True(p.TrackW >= 64 || p.TrackH >= 64, "track keeps its capsule");
                }
                T.True(left.TrackY + left.TrackH <= left.IconY, "icon sits below the vertical track"); T.True(left.NumberCenterY < left.TrackY, "number sits above the vertical track");
                T.True(bottom.NumberRight > bottom.TrackX + bottom.TrackW, "number sits right of the horizontal track");
            });

            T.Run("audio output: TV speakers first, audio devices only, the connected one on top", () =>
            {
                var paired = new List<BondedDevice>
                {
                    new BondedDevice { Address = "A", Name = "zeta", Connected = false, MajorClass = 4 },
                    new BondedDevice { Address = "B", Name = "Remote", Connected = true, MajorClass = 5 },      // a remote: not a sound device
                    new BondedDevice { Address = "C", Name = "Beam", Connected = false, MajorClass = 4 },
                    new BondedDevice { Address = "D", Name = "Unclassed", Connected = false, MajorClass = 0 },  // class not reported: kept
                    new BondedDevice { Address = null, Name = "No address", MajorClass = 4 }
                };
                var none = OutputPickerModel.Build(paired);
                T.Eq(string.Join(",", none.ConvertAll(r => r.Label).ToArray()), "TV speakers,Beam,Unclassed,zeta", "rows with nothing connected");
                T.True(none[0].Active && !none[1].Active, "TV speakers play when no device is connected");
                paired[0].Connected = true;
                var one = OutputPickerModel.Build(paired, 5);
                T.Eq(string.Join(",", one.ConvertAll(r => r.Label).ToArray()), "TV speakers,zeta,Beam,Unclassed", "the connected device comes first");
                T.True(!one[0].Active && one[1].Active && one[1].Connected, "sound output on Bluetooth: the device plays, the TV speakers do not");
                var onTv = OutputPickerModel.Build(paired, 0);
                T.True(onTv[0].Active && !onTv[1].Active && onTv[1].Connected, "connected but the sound output is the TV speaker: the TV plays, the device is only connected");
                T.True(OutputPickerModel.Build(paired, 6)[1].Active && OutputPickerModel.Build(paired, -1)[1].Active, "6 reads as Bluetooth; unknown with a connected device assumes it plays");
                T.True(OutputPickerModel.Build(null, 5)[0].Active, "Bluetooth selected but nothing connected: the TV plays");
                T.Eq(OutputPickerModel.Build(null).Count, 1, "no list: only the TV speakers");
                var withPort = OutputPickerModel.Build(paired, 5, true, -1, true);
                var portRow = withPort.Find(r => r.Kind == OutputKind.External);
                T.True(portRow != null && portRow.Label == "Optical" && portRow.Selection == 1 && !portRow.Active, "a TV with an optical port offers Optical before the sound has been there (Q70BA)");
                T.Eq(OutputPickerModel.ActionFor(portRow), OutputAction.UseExternal, "choosing it sets output 1");
                T.True(OutputPickerModel.Build(paired, 5, true, -1, false).Find(r => r.Kind == OutputKind.External) == null, "no optical port: no Optical row");
                T.Eq(OutputPickerModel.Build(paired, 1, true, -1, true).FindAll(r => r.Kind == OutputKind.External).Count, 1, "on optical: one Optical row, not two");
                T.Eq(OutputPickerModel.Build(paired, 9, true, -1, true).FindAll(r => r.Kind == OutputKind.External).Count, 1, "on TV + optical: no second optical row");
                var receiverAndPort = OutputPickerModel.Build(paired, 0, true, 2, true).FindAll(r => r.Kind == OutputKind.External);
                T.True(receiverAndPort.Count == 2 && receiverAndPort[0].Selection == 2 && receiverAndPort[1].Selection == 1, "a receiver seen before and the optical port: both offered");
                T.True(OutputPickerModel.Build(paired, -1, true, -1, true).Find(r => r.Kind == OutputKind.External) == null, "output unknown: nothing extra");
                var optical = OutputPickerModel.Build(paired, 1);
                T.True(!optical[0].Active && optical[1].Kind == OutputKind.External && optical[1].Label == "Optical" && optical[1].Active, "optical (1): its own ticked row, the TV speakers unticked");
                T.Eq(OutputPickerModel.ActionFor(optical[1]), OutputAction.None, "the external output that plays cannot be chosen again");
                T.True(OutputPickerModel.Build(null, 2)[1].Label == "Receiver (HDMI)" && OutputPickerModel.ExternalName(0) == null && OutputPickerModel.ExternalName(5) == null, "route names");
                T.True(OutputPickerModel.VetroSetsLevel(0) && OutputPickerModel.VetroSetsLevel(-1) && OutputPickerModel.VetroSetsLevel(4), "Vol stays with Vetro on TV speakers, unknown, Wi-Fi");
                T.True(!OutputPickerModel.VetroSetsLevel(5) && !OutputPickerModel.VetroSetsLevel(6), "Bluetooth headphones get Vol from Samsung (LS03B 2026-11-20)");
                T.True(!OutputPickerModel.VetroSetsLevel(2) && !OutputPickerModel.VetroSetsLevel(8) && !OutputPickerModel.VetroSetsLevel(12) && !OutputPickerModel.VetroSetsLevel(17), "a receiver on HDMI gets Vol from Samsung");
                T.True(!OutputPickerModel.VetroSetsLevel(1) && !OutputPickerModel.VetroSetsLevel(9) && !OutputPickerModel.VetroSetsLevel(11) && !OutputPickerModel.VetroSetsLevel(18), "an optical soundbar gets Vol from Samsung (S95C, S90D, S90F 2026-11-20)");
                // The S95C on optical chose TV speakers and lost its Optical row: the output last seen playing stays, not ticked, and can be chosen again.
                var back = OutputPickerModel.Build(paired, 0, true, 1);
                T.Eq(string.Join(",", back.ConvertAll(r => r.Label).ToArray()), "TV speakers,Optical,zeta,Beam,Unclassed,Turn off screen", "optical keeps its row after TV speakers");
                T.True(back[0].Active && !back[1].Active && back[1].Selection == 1, "TV speakers ticked, Optical offered with its number");
                T.Eq(OutputPickerModel.ActionFor(back[1]), OutputAction.UseExternal, "choosing Optical again selects it");
                T.Eq(OutputPickerModel.Build(paired, 5, false, 1)[1].Label, "Optical", "also while a Bluetooth device plays");
                T.Eq(OutputPickerModel.Build(paired, -1, false, 1).Exists(r => r.Kind == OutputKind.External), false, "an unread output offers nothing");
                T.Eq(OutputPickerModel.Build(null, 0, false, 4).Count, 1, "a Wi-Fi speaker is not offered again (Samsung's list never selects 4 this way)");
                T.Eq(OutputPickerModel.Build(null, 2, false, 1)[1].Label, "Receiver (HDMI)", "the one playing wins over the remembered one");
                T.Eq(OutputPickerModel.ActionFor(new OutputEntry { Kind = OutputKind.External, Label = "x", Selection = 4 }), OutputAction.None, "no switch to an output that cannot be chosen");
                var withOff = OutputPickerModel.Build(paired, 5, true);
                T.Eq(withOff[withOff.Count - 1].Kind, OutputKind.ScreenOff, "Turn off screen is the last row");
                T.True(!withOff[withOff.Count - 1].Active && withOff[1].Active, "the screen row is never ticked and does not move the tick");
                T.True(!OutputPickerModel.HasDevices(OutputPickerModel.Build(null, -1, true)) && OutputPickerModel.HasDevices(withOff), "the screen row is not a paired speaker");
            });

            T.Run("audio output: what a choice does", () =>
            {
                var rows = new List<OutputEntry> { new OutputEntry { Kind = OutputKind.TvSpeaker, Label = "TV", Active = true } };
                for (int i = 0; i < 3; i++) rows.Add(new OutputEntry { Kind = OutputKind.Bluetooth, Label = "d" + i, Address = "a" + i });
                T.Eq(OutputPickerModel.ActionFor(rows[0]), OutputAction.None, "the one that plays: nothing to do");
                T.Eq(OutputPickerModel.ActionFor(rows[3]), OutputAction.Connect, "a device that is not connected is connected first");
                rows[3].Connected = true;
                T.Eq(OutputPickerModel.ActionFor(rows[3]), OutputAction.UseBluetooth, "a connected device that is not playing: select it");
                rows[0].Active = false;
                T.Eq(OutputPickerModel.ActionFor(rows[0]), OutputAction.UseTv, "the TV speakers: select them");
                T.Eq(OutputPickerModel.ActionFor(null), OutputAction.None, "no row, no action");
                T.Eq(OutputPickerModel.ActionFor(new OutputEntry { Kind = OutputKind.ScreenOff, Label = "x" }), OutputAction.ScreenOff, "the last row turns the screen off");
            });

            T.Run("Tizen 9 Task Manager protection for volume-app and quicklaunch", () =>
            {
                var ui = new AppInfo { Component = "uiapp", NoDisplay = false };
                T.True(!Tasks.IsUserApp("org.tizen.volume-app", ui), "volume-app protected");
                T.True(!Tasks.IsUserApp("com.samsung.tv.quicklaunch", ui), "quicklaunch protected");
                T.True(Tasks.IsUserApp("com.samsung.tv.store", ui), "normal uiapp remains visible");
            });

            T.Run("picture modes: CheckPictureModeByGroup dbus-send format and truncation fallback", () =>
            {
                string groupCmd = PictureModes.CheckGroupCommand();
                T.True(groupCmd.Contains("dbus-send --system") && groupCmd.Contains("CheckPictureModeByGroup") && groupCmd.Contains("array:int32:65536,") && groupCmd.Contains(" int32:22"), "builds dbus-send CheckPictureModeByGroup command");
                string combined = PictureModes.GetAndCheckGroupCommand();
                T.True(combined.Contains("GetPictureMode i 1") && combined.Contains("__GROUP__") && combined.Contains("CheckPictureModeByGroup"), "combines mode read and group check");

                var sb = new System.Text.StringBuilder("   array [\n");
                for (int i = 0; i < PictureModes.Candidates.Length; i++) sb.Append("      int32 ").Append(PictureModes.Candidates[i] == 65536 || PictureModes.Candidates[i] == 65538 ? 1 : 0).Append('\n');
                sb.Append("   ]\n   int32 0\n");
                string parsed = PictureModes.ParseGroupReply(sb.ToString());
                T.True(parsed != null, "accepts 22-element reply ending in int32 0");
                ChoiceState st = PictureModes.Build("ii 65538 0", parsed);
                T.Eq(st.Rows.Count, 2, "builds offered rows from group reply");
                T.True(st.Rows[1].Value == 65538 && st.Rows[1].Active, "marks active mode");

                T.Eq(PictureModes.ParseGroupReply("   array [\n      int32 1\n   ]\n   int32 -1\n"), null, "rejects truncated -1 reply for busctl fallback");
                T.Eq(PictureModes.ParseGroupReply("   array [\n      int32 1\n   ]\n   int32 0\n"), null, "rejects partial array count");
                T.Eq(PictureModes.ParseGroupReply("\nx\n"), null, "a TV without the method (the 2021 Q80A answers UnknownMethod, so the command prints x) falls back to the per-mode checks");
            });

            T.Run("NumberPadModel grab key tables", () =>
            {
                var seen = new HashSet<string>();
                foreach (string k in NumberPadModel.GrabKeys) T.True(seen.Add(k), "unique grab key: " + k);
                foreach (string k in new[] { "Left", "Right", "Up", "Down", "Return", "XF86Back" })
                {
                    T.True(Array.IndexOf(NumberPadModel.CoreGrabKeys, k) >= 0, "CoreGrabKeys includes " + k);
                    T.True(seen.Contains(k), "GrabKeys includes core key " + k);
                }
                foreach (string k in new[] { "KP_Enter", "Select", "BackSpace", "Escape", "XF86Exit", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9" })
                    T.True(seen.Contains(k), "GrabKeys includes " + k);
            });

            T.Run("IdleBackdropModel: 5 gates, Halton orbit, lcdoff wake guard, key handling, and tuner flag", () =>
            {
                IdleConfig cfg = IdleConfig.Parse("clock", true, "0", "12");
                T.True(cfg.Mode == IdleMode.Clock && cfg.AutoDock && cfg.PictureOffMinutes == 0 && cfg.NotificationLevel == 12, "parses idle config");
                T.True(IdleConfig.Parse("invalid", false, "99", "999").Mode == IdleMode.Off, "rejects invalid mode");
                T.True(IdleConfig.Parse("beacon", false, "0", "10").Mode == IdleMode.Off, "removed beacon parses as Off");
                T.Eq(IdleConfig.Parse("wallpaper", false, "5", "99").NotificationLevel, 40, "clamps notification level");

                var model = new IdleBackdropModel(cfg);
                var onTv = new TvSnapshot { SourceType = 0, FullscreenAppId = IdleBackdropModel.TvViewerAppId, PartialAppId = "", DisplayState = 1, TunerActive = false };
                T.True(model.Evaluate(onTv, 10.0, false, false, false) == IdleAction.ShowWithDock, "first arrival opens Dock over backdrop");
                T.True(model.Evaluate(onTv, 12.0, false, false, false) == IdleAction.None, "stays shown without reopening dock");
                T.True(model.Evaluate(onTv, 615.0, false, false, false) == IdleAction.Dim, "dims after 10 min when potOff=0");

                var standbySnap = new TvSnapshot { SourceType = -1, FullscreenAppId = "", PartialAppId = "", DisplayState = IdleBackdropModel.DisplayStateOff, TunerActive = false };
                T.True(model.Evaluate(standbySnap, 615.2, false, false, false) == IdleAction.None && model.Visible, "stays mapped through standby/lcdoff for zero-ms wake");

                var blipSnap = onTv; blipSnap.SourceType = -1;
                T.True(model.Evaluate(blipSnap, 615.4, false, false, false) == IdleAction.None && model.Visible, "survives transient source_type=-1 while tv-viewer stays fullscreen");

                var otherApp = onTv; otherApp.FullscreenAppId = "vetrotvapp.app";
                T.True(model.Evaluate(otherApp, 615.6, false, false, false) == IdleAction.Hide && !model.Visible, "hides immediately when another app takes fullscreen");
                T.True(model.Evaluate(onTv, 615.8, false, false, false) == IdleAction.ShowWithDock, "returns after other app closes");

                var withOverlay = onTv; withOverlay.PartialAppId = "com.samsung.tv.menu";
                T.True(model.Evaluate(withOverlay, 616.0, false, false, false) == IdleAction.Hide, "hides on Samsung partial overlay");
                var onHdmi = onTv; onHdmi.SourceType = 13;
                T.True(model.Evaluate(onHdmi, 617.0, false, false, false) == IdleAction.None, "stays hidden on HDMI");
                T.True(model.Evaluate(onTv, 620.0, false, false, false) == IdleAction.ShowWithDock, "returning from HDMI opens Dock once");

                T.True(model.Evaluate(onTv, 1225.0, false, false, false) == IdleAction.Dim, "dims again after 10 min idle");
                bool hideBg;
                T.True(!model.OnRawKey(108, 63, 1226.0, false, false, out hideBg) && !hideBg && model.Visible && !model.Dimmed, "non-Home key keeps backdrop visible and undims");
                T.True(model.Evaluate(onTv, 1230.0, false, false, false) == IdleAction.None, "backdrop stays visible continuously");

                T.True(model.OnRawKey(63, 63, 1300.0, true, false, out hideBg) && !hideBg, "consumes wake key while DisplayStateOff");
                T.True(model.OnRawKey(63, 63, 1300.2, false, false, out hideBg), "suppresses echo within 0.5 s");

                var potModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", false, "5", "10"));
                T.True(potModel.Evaluate(onTv, 100.0, false, false, false) == IdleAction.Show, "wallpaper shows without auto-dock");
                T.True(potModel.Evaluate(onTv, 405.0, false, false, false) == IdleAction.TriggerLcdOff, "triggers lcdoff after 5 min");
                T.True(potModel.OnLcdOffVerify(1) == IdleAction.FallbackDim, "falls back to dim if deviced refused");

                var noDimCfg = IdleConfig.Parse("wallpaper", false, "-1", "10");
                T.Eq(noDimCfg.PictureOffMinutes, -1, "parses potOff=-1 as no-dim");
                var noDimModel = new IdleBackdropModel(noDimCfg);
                T.True(noDimModel.Evaluate(onTv, 100.0, false, false, false) == IdleAction.Show, "no-dim backdrop shows");
                T.True(noDimModel.Evaluate(onTv, 100.0 + IdleBackdropModel.DimAfterSeconds + 120.0, false, false, false) == IdleAction.None && !noDimModel.Dimmed, "no-dim never dims past DimAfterSeconds");
                var dimFirst = new IdleBackdropModel(IdleConfig.Parse("wallpaper", false, "0", "10"));
                T.True(dimFirst.Evaluate(onTv, 10.0, false, false, false) == IdleAction.Show, "dimFirst shows initially");
                T.True(dimFirst.Evaluate(onTv, 10.0 + IdleBackdropModel.DimAfterSeconds + 1.0, false, false, false) == IdleAction.Dim && dimFirst.Dimmed, "dimFirst dims after DimAfterSeconds");
                dimFirst.Reconfigure(IdleConfig.ParseLiveArgs("wallpaper 0 -1 1", 10), 700.0);
                T.True(!dimFirst.Dimmed && dimFirst.Evaluate(onTv, 700.0 + IdleBackdropModel.DimAfterSeconds + 60.0, false, false, false) == IdleAction.None && !dimFirst.Dimmed, "live reconfigure to potOff=-1 undims and stays full brightness");
                var ssNoDim = new IdleBackdropModel(IdleConfig.Parse("aurora", false, "-1", "40", true));
                var ssSnap = new TvSnapshot { SourceType = 13, DisplayState = 1, WmStackActive = true, ScreensaverActive = true };
                T.Eq(ssNoDim.Evaluate(ssSnap, 100.0, false, false, false), IdleAction.Show, "screensaver takeover starts with no-dim");
                T.True(ssNoDim.Evaluate(new TvSnapshot { SourceType = 13, DisplayState = 1, WmStackActive = true }, 100.0 + IdleBackdropModel.DimAfterSeconds + 60.0, false, false, false) == IdleAction.None && !ssNoDim.Dimmed, "screensaver takeover with potOff=-1 stays full brightness");

                IdleConfig wallCfg = IdleConfig.Parse("wallpaper", false, "0", "10");
                T.True(wallCfg.Mode == IdleMode.Wallpaper && wallCfg.UsesWallpaper && wallCfg.UsesLake && !wallCfg.UsesAurora && wallCfg.ShowsClock, "parses wallpaper (Midnight Lake + Clock)");
                IdleConfig cleanCfg = IdleConfig.Parse("clean", false, "0", "10");
                T.True(cleanCfg.Mode == IdleMode.Clean && cleanCfg.UsesWallpaper && cleanCfg.UsesLake && !cleanCfg.UsesAurora && !cleanCfg.ShowsClock, "parses clean (Midnight Lake)");
                IdleConfig auroraCfg = IdleConfig.Parse("aurora", false, "0", "10");
                T.True(auroraCfg.Mode == IdleMode.Aurora && auroraCfg.UsesWallpaper && auroraCfg.UsesAurora && !auroraCfg.UsesLake && auroraCfg.ShowsClock, "parses aurora (Aurora Silk + Clock)");
                IdleConfig auroraCleanCfg = IdleConfig.Parse("aurora-clean", false, "0", "10");
                T.True(auroraCleanCfg.Mode == IdleMode.AuroraClean && auroraCleanCfg.UsesWallpaper && auroraCleanCfg.UsesAurora && !auroraCleanCfg.UsesLake && !auroraCleanCfg.ShowsClock, "parses aurora-clean (Aurora Silk)");

                uint[] swellPx = AmbientLakeEngine.BuildOpaqueSwellTilePixels();
                T.Eq(swellPx.Length, AmbientLakeEngine.SwellTileW * AmbientLakeEngine.SwellTileH, "builds Midnight Lake swell tile");
                bool swellOpaque = true, swellHasGradient = false;
                for (int i = 0; i < swellPx.Length; i++)
                {
                    uint p = swellPx[i];
                    if ((p >> 24) != 0xFFu) { swellOpaque = false; break; }
                    if ((p & 0xFFu) > 80u) swellHasGradient = true;
                }
                T.True(swellOpaque && swellHasGradient, "swell tile pixels are opaque ARGB with midnight sapphire wave crests");

                uint[] ripplePx = AmbientLakeEngine.BuildRippleTilePixels();
                T.Eq(ripplePx.Length, AmbientLakeEngine.RippleTileW * AmbientLakeEngine.RippleTileH, "builds Midnight Lake ripple tile");
                bool ripplePremulOk = true, rippleHasGlow = false;
                for (int i = 0; i < ripplePx.Length; i++)
                {
                    uint p = ripplePx[i];
                    uint a = (p >> 24) & 0xFF, r = (p >> 16) & 0xFF, g = (p >> 8) & 0xFF, b = p & 0xFF;
                    if (r > a || g > a || b > a) { ripplePremulOk = false; break; }
                    if (a > 64) rippleHasGlow = true;
                }
                T.True(ripplePremulOk && rippleHasGlow, "ripple tile pixels are valid premultiplied ARGB with wave crests");

                uint[] maskPx = AmbientLakeEngine.BuildPureBlackPortalMaskPixels();
                T.Eq(maskPx.Length, AmbientLakeEngine.MaskTexW * AmbientLakeEngine.MaskTexH, "builds pure-black portal mask");
                uint maskCenterA = maskPx[(AmbientLakeEngine.MaskTexH / 2) * AmbientLakeEngine.MaskTexW + (AmbientLakeEngine.MaskTexW / 2)] >> 24;
                uint maskCornerA = maskPx[0] >> 24;
                T.True(maskCenterA < 80 && maskCornerA == 255 && (maskPx[0] & 0xFFFFFFu) == 0u, "portal mask has translucent center and pure #000000 edges");

                uint[] silkPx = AmbientLakeEngine.BuildAuroraSilkRibbonPixels(192, 64, 79, 148, 255, 1.35, 0.13, 0.4, -0.06);
                T.Eq(silkPx.Length, 192 * 64, "builds 192x64 Aurora Silk ribbon");
                T.True((silkPx[0] >> 24) == 0 && (silkPx[191] >> 24) == 0 && (silkPx[63 * 192 + 96] >> 24) == 0, "silk ribbon has zero alpha on all borders");
                bool silkPremulOk = true, silkHasCore = false;
                for (int i = 0; i < silkPx.Length; i++)
                {
                    uint p = silkPx[i];
                    uint a = (p >> 24) & 0xFF, r = (p >> 16) & 0xFF, g = (p >> 8) & 0xFF, b = p & 0xFF;
                    if (r > a || g > a || b > a) { silkPremulOk = false; break; }
                    if (a > 120) silkHasCore = true;
                }
                T.True(silkPremulOk && silkHasCore, "silk ribbon pixels are valid premultiplied ARGB");

                uint[] crispPx = IdleBackdropModel.BuildBokehPixels(16, true);
                uint[] orbPx = IdleBackdropModel.BuildBokehPixels(24, false);
                T.Eq(crispPx.Length, 16 * 16, "builds 16x16 starlight bokeh");
                T.Eq(orbPx.Length, 24 * 24, "builds 24x24 near bokeh orb");
                T.True((crispPx[0] >> 24) == 0 && (crispPx[8 * 16 + 8] >> 24) > 100, "bokeh sprite has zero edge and glowing center");

                AmbientLakeEngine.LakeRenderFrame lf1, lf2, lfDim;
                AmbientLakeEngine.ComputeFrame(10000, 1920, 1080, false, out lf1);
                AmbientLakeEngine.ComputeFrame(12000, 1920, 1080, false, out lf2);
                AmbientLakeEngine.ComputeFrame(10000, 1920, 1080, true, out lfDim);
                T.True(lf1.SwellU0 != lf2.SwellU0 || lf1.SwellV0 != lf2.SwellV0, "ComputeFrame advances swell UVs smoothly");
                T.True(lf1.PortalX >= 0 && lf1.PortalX + lf1.PortalW <= 1920 && lf1.PortalY >= 0 && lf1.PortalY + lf1.PortalH <= 1080, "lake portal stays inside 1080p screen");
                T.True(lfDim.MaskTint < lf1.MaskTint && lfDim.SwellBotTint < lf1.SwellBotTint, "lake frame dims safely at 10 min");

                IdleBackdropModel.AuroraRibbonMotion rf1, rf2;
                AmbientLakeEngine.ComputeAuroraRibbonMotion(0, 10000, 1920, 1080, false, out rf1);
                AmbientLakeEngine.ComputeAuroraRibbonMotion(0, 15000, 1920, 1080, false, out rf2);
                T.True(rf1.X != rf2.X || rf1.Y != rf2.Y, "ComputeAuroraRibbonMotion drifts on Lissajous orbit");

                bool sawZeroMote = false, sawVisibleMote = false;
                for (int t = 0; t < 40000; t += 1000)
                {
                    IdleBackdropModel.MoteMotion mf;
                    AmbientLakeEngine.ComputeAuroraMoteMotion(0, t, 1920, 1080, false, out mf);
                    if (mf.Alpha == 0) sawZeroMote = true;
                    if (mf.Alpha > 20) sawVisibleMote = true;
                }
                T.True(sawZeroMote && sawVisibleMote, "ComputeAuroraMoteMotion fades smoothly through zero alpha (hide) and visible peak");

                var seen = new System.Collections.Generic.HashSet<string>();
                for (int s = 1; s <= 40; s++)
                {
                    int hx, hy;
                    IdleBackdropModel.HaltonPosition(s, 1920, 1080, 280, 140, out hx, out hy);
                    T.True(hx >= 96 && hx <= 1920 - 96 - 280 && hy >= 96 && hy <= 1080 - 280 - 140, "Halton clears 280px bottom Dock band");
                    T.True(seen.Add(hx + "," + hy), "Halton position unique");
                }

                T.True(IdleBackdropModel.IsTunerReady(p => p == IdleBackdropModel.TunerTvFlag || p == IdleBackdropModel.TunerPidPath, p => "4242\n", pid => pid == 4242), "detects live tuner");
                T.True(!IdleBackdropModel.IsTunerReady(p => p == IdleBackdropModel.TunerTvFlag || p == IdleBackdropModel.TunerPidPath, p => "4242\n", pid => false), "ignores stale tuner pid");

                string dDay, dNum;
                IdleBackdropModel.FormatDate(new DateTime(2026, 11, 21, 22, 53, 0), out dDay, out dNum);
                T.Eq(dDay, "SAT", "formats uppercase 3-letter weekday");
                T.Eq(dNum, "21.11.26", "formats dd.MM.yy date");

                model.Reconfigure(IdleConfig.Parse("wallpaper", false, "0", "10"), 1350.0);
                T.True(model.Visible && !model.Dimmed, "Reconfigure preserves Visible across live style change and resets dim");
                T.True(model.Evaluate(onTv, 1960.0, false, false, false) == IdleAction.Dim, "dims 10 min after live reconfigure");
                model.Reconfigure(IdleConfig.Parse("clean", true, "5", "10"), 1970.0);
                T.True(model.Visible && !model.Dimmed, "Reconfigure keeps Visible when toggling clean/autoDock/potOff");
                T.True(model.Evaluate(onTv, 2275.0, false, false, false) == IdleAction.TriggerLcdOff, "uses updated potOff=5 after live reconfigure");
                model.Reconfigure(IdleConfig.Parse("off", false, "0", "10"), 2280.0);
                T.True(!model.Visible, "Reconfigure to Off hides backdrop immediately");

                var cmdBuf = new CommandBuffer();
                byte[] cmdBytes = System.Text.Encoding.ASCII.GetBytes("idle wallpaper 1 5\nshow\nLaunch 8\nlaunch 3.5\nlaunch\nlaunch 0.2\nlaunch 99\nlaunch bogus\n");
                var parsedCmds = cmdBuf.Feed(cmdBytes, cmdBytes.Length);
                T.True(parsedCmds.Count == 8 && parsedCmds[0] == Command.Idle && parsedCmds[1] == Command.Show && parsedCmds[2] == Command.Launch && parsedCmds[7] == Command.Launch, "CommandBuffer parses live idle and launch commands");
                T.Eq(cmdBuf.TakeIdleArgs(), "wallpaper 1 5", "CommandBuffer captures idle command arguments");
                T.Eq(CommandBuffer.ParseLaunchSuppressSeconds(cmdBuf.TakeLaunchArgs(), IdleBackdropModel.LaunchSuppressSeconds), 8.0, "parses Launch 8");
                T.Eq(CommandBuffer.ParseLaunchSuppressSeconds(cmdBuf.TakeLaunchArgs(), IdleBackdropModel.LaunchSuppressSeconds), 3.5, "parses launch 3.5");
                T.Eq(CommandBuffer.ParseLaunchSuppressSeconds(cmdBuf.TakeLaunchArgs(), IdleBackdropModel.LaunchSuppressSeconds), IdleBackdropModel.LaunchSuppressSeconds, "bare launch uses default suppress seconds");
                T.Eq(CommandBuffer.ParseLaunchSuppressSeconds(cmdBuf.TakeLaunchArgs(), IdleBackdropModel.LaunchSuppressSeconds), CommandBuffer.MinLaunchSuppressSeconds, "clamps low launch seconds to 1.0");
                T.Eq(CommandBuffer.ParseLaunchSuppressSeconds(cmdBuf.TakeLaunchArgs(), IdleBackdropModel.LaunchSuppressSeconds), CommandBuffer.MaxLaunchSuppressSeconds, "clamps high launch seconds to 15.0");
                T.Eq(CommandBuffer.ParseLaunchSuppressSeconds(cmdBuf.TakeLaunchArgs(), IdleBackdropModel.LaunchSuppressSeconds), IdleBackdropModel.LaunchSuppressSeconds, "invalid launch arg falls back to default");

                var homeModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                T.True(homeModel.Evaluate(onTv, 10.0, false, false, false) == IdleAction.ShowWithDock, "shows on empty TV");
                var csfsSnap = new TvSnapshot { SourceType = 0, FullscreenAppId = "com.samsung.tv.csfs", PartialAppId = "", DisplayState = 1, TunerActive = false, SamsungHomeRequested = false };
                T.True(homeModel.Evaluate(csfsSnap, 11.0, true, false, false) == IdleAction.None && homeModel.Visible, "suppresses guarded Samsung Home flash while visible");
                var csfsIntentional = csfsSnap; csfsIntentional.SamsungHomeRequested = true;
                T.True(homeModel.Evaluate(csfsIntentional, 12.0, false, false, false) == IdleAction.Hide && !homeModel.Visible, "hides immediately when user requests Samsung Home pill");
                T.True(homeModel.Evaluate(csfsSnap, 13.0, true, false, false) == IdleAction.Show && homeModel.Visible, "covers csfs again when DockActive returns after guard");

                // Fast app-exit recovery when source_type is still -1 while tv-viewer regains fullscreen.
                var inAppSnap = new TvSnapshot { SourceType = -1, FullscreenAppId = "vetrotvapp.app", PartialAppId = "", DisplayState = 1, TunerActive = false };
                T.True(homeModel.Evaluate(inAppSnap, 14.0, false, false, false) == IdleAction.Hide && !homeModel.Visible, "hides when entering app");
                var exitingAppToTv = new TvSnapshot { SourceType = -1, FullscreenAppId = IdleBackdropModel.TvViewerAppId, PartialAppId = "", DisplayState = 1, TunerActive = false };
                T.True(homeModel.Evaluate(exitingAppToTv, 14.1, false, false, false) == IdleAction.ShowWithDock && homeModel.Visible, "restores immediately on app exit even before source_type settles to 0");

                // Never covers HDMI when returning from an app while source_type is transiently -1.
                var hdmiModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", false, "0", "10"));
                T.True(hdmiModel.Evaluate(onHdmi, 20.0, false, false, false) == IdleAction.None, "records last known source = HDMI (13)");
                T.True(hdmiModel.Evaluate(inAppSnap, 21.0, false, false, false) == IdleAction.None, "app over HDMI stays hidden");
                T.True(hdmiModel.Evaluate(exitingAppToTv, 21.1, false, false, false) == IdleAction.None && !hdmiModel.Visible, "does not show over HDMI when last known source was HDMI and source_type is still -1");

                // Unrequested Samsung Smart Hub after long-press Back force-close: Art Mode excluded, cooldown/backoff & reset.
                T.True(IdleBackdropModel.IsGuardedSamsungHome("com.samsung.tv.csfs"), "csfs is guarded Samsung Home");
                T.True(IdleBackdropModel.IsGuardedSamsungHome("com.samsung.tv.coba.newhome"), "coba newhome is guarded Samsung Home");
                T.True(IdleBackdropModel.IsGuardedSamsungHome("com.samsung.tv.home.sidebar"), "home.sidebar is guarded Samsung Home");
                T.True(!IdleBackdropModel.IsGuardedSamsungHome("com.samsung.tv.coba.art"), "Frame Art Mode (coba.art) is excluded from Home guard");
                T.True(!IdleBackdropModel.IsGuardedSamsungHome("com.samsung.tv.home.art"), "Frame Art Mode (home.art) is excluded from Home guard");
                T.True(IdleBackdropModel.IsGuardedSamsungHomeWindow("/opt/usr/apps/com.samsung.tv.csfs/bin/csfs.dll"), "matches Tizen 9 csfs.dll window title");
                T.True(IdleBackdropModel.IsGuardedSamsungHomeWindow("/opt/usr/apps/com.samsung.tv.home.sidebar/bin/HomeSidebar.dll"), "matches Tizen 9 HomeSidebar.dll window title");
                T.True(IdleBackdropModel.IsGuardedSamsungHomeWindow("/opt/usr/apps/com.samsung.tv.home.media/bin/HomeMedia.dll"), "matches Tizen 9 HomeMedia.dll window title");
                T.True(!IdleBackdropModel.IsGuardedSamsungHomeWindow("/opt/usr/apps/com.samsung.tv.home.art/bin/HomeArt.dll"), "excludes home.art window title");
                T.True(!IdleBackdropModel.IsGuardedSamsungHomeWindow("/opt/usr/apps/com.samsung.tv.coba.art/bin/Art.dll"), "excludes coba.art window title");
                T.True(!IdleBackdropModel.IsGuardedSamsungHomeWindow("tv-viewer"), "non-home window is not guarded");

                var dismissModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", false, "0", "10"));
                T.True(dismissModel.ShouldDismissGuardedHome(csfsSnap, 30.0), "dismisses unrequested Smart Hub after force-close");
                T.True(!dismissModel.ShouldDismissGuardedHome(csfsSnap, 31.0), "respects 2.0 s cooldown before retry");
                T.True(dismissModel.ShouldDismissGuardedHome(csfsSnap, 32.0), "fires 2nd attempt after 2.0 s cooldown");
                T.True(dismissModel.ShouldDismissGuardedHome(csfsSnap, 34.0), "fires 3rd fast attempt after 2.0 s cooldown");
                T.True(!dismissModel.ShouldDismissGuardedHome(csfsSnap, 40.0), "backs off to 10.0 s after 3rd attempt");
                T.True(dismissModel.ShouldDismissGuardedHome(csfsSnap, 44.0), "fires 4th attempt once 10.0 s backoff elapses");
                T.True(!dismissModel.ShouldDismissGuardedHome(onTv, 45.0), "resets dismissal backoff once tv-viewer returns");
                T.True(dismissModel.ShouldDismissGuardedHome(csfsSnap, 45.1), "fires immediately again on next unrequested csfs");

                T.True(!dismissModel.ShouldDismissGuardedHome(csfsIntentional, 46.0), "never dismisses Samsung Home when requested intentionally from Dock");
                T.True(!hdmiModel.ShouldDismissGuardedHome(csfsSnap, 50.0), "never dismisses Smart Hub on HDMI source");
                var offModel = new IdleBackdropModel(IdleConfig.Parse("off", false, "0", "10"));
                T.True(!offModel.ShouldDismissGuardedHome(csfsSnap, 60.0), "never dismisses Smart Hub when Empty TV screen is Off");

                // Post-csfs dying-app holdover: killing csfs briefly exposes the dying app (src=-1) before tv-viewer settles,
                // while a different newly opened app (e.g. via phone/CEC/remote button) still hides the backdrop immediately.
                var holdModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                var csfsNegSnap = new TvSnapshot { SourceType = -1, FullscreenAppId = "com.samsung.tv.csfs", PartialAppId = "", DisplayState = 1 };
                var dyingYtSnap = new TvSnapshot { SourceType = -1, FullscreenAppId = "com.samsung.tv.cobalt-yt", PartialAppId = "", DisplayState = 1 };
                T.True(holdModel.Evaluate(dyingYtSnap, 99.0, false, false, false) == IdleAction.None && !holdModel.Visible, "records running app before force-close");
                T.True(holdModel.Evaluate(csfsNegSnap, 100.0, false, false, false) == IdleAction.ShowWithDock && holdModel.Visible, "covers csfs on force-close");
                T.True(holdModel.Evaluate(dyingYtSnap, 101.0, true, false, false) == IdleAction.None && holdModel.Visible, "holds backdrop steady while dying app tears down after csfs kill");
                T.True(holdModel.Evaluate(onTv, 101.5, true, false, false) == IdleAction.None && holdModel.Visible, "stays shown seamlessly when tv-viewer settles");
                T.True(holdModel.Evaluate(dyingYtSnap, 109.0, false, false, false) == IdleAction.Hide && !holdModel.Visible, "hides when entering YouTube again");
                T.True(holdModel.Evaluate(csfsNegSnap, 110.0, false, false, false) == IdleAction.ShowWithDock && holdModel.Visible, "re-arms holdover on guarded home");
                T.True(holdModel.Evaluate(dyingYtSnap, 112.6, true, false, false) == IdleAction.Hide && !holdModel.Visible, "hides cleanly once 2.5 s holdover expires if app stayed alive");
                // A different newly opened app hides immediately even within the 2.5 s holdover window.
                T.True(holdModel.Evaluate(csfsNegSnap, 115.0, false, false, false) == IdleAction.ShowWithDock && holdModel.Visible, "shows on csfs after dying app");
                T.True(holdModel.Evaluate(inAppSnap, 115.5, true, false, false) == IdleAction.Hide && !holdModel.Visible, "different app hides backdrop immediately during holdover");
                // Launching the same app from Dock cancels holdover while keeping Layer-200 curtain Visible until the app takes fullscreen.
                T.True(holdModel.Evaluate(dyingYtSnap, 119.0, false, false, false) == IdleAction.None && !holdModel.Visible, "in YouTube again");
                T.True(holdModel.Evaluate(csfsNegSnap, 120.0, false, false, false) == IdleAction.ShowWithDock && holdModel.Visible, "shows again on guarded home");
                holdModel.OnLaunchApp(120.2);
                T.True(holdModel.Visible && holdModel.IsLaunchCurtainActive(120.2), "OnLaunchApp keeps Visible=true for Layer-200 curtain and clears holdover");
                T.True(holdModel.Evaluate(dyingYtSnap, 120.3, false, false, false) == IdleAction.Hide && !holdModel.Visible && holdModel.IsLaunchSuppressed(120.3), "emits Hide immediately on fullscreen app while keeping dwell guard active");
                T.True(holdModel.Evaluate(dyingYtSnap, 121.9, false, false, false) == IdleAction.None && !holdModel.IsLaunchSuppressed(121.9), "clears normal launch suppression after >=1.5 s continuous fullscreen dwell");

                // Launch suppression + Layer-200 Launch Curtain + continuous dwell guard:
                // - From inside an app (Visible==false): brief tv-viewer/csfs gap immediately raises Layer-200 curtain (Show, no Dock!)
                //   so No-Antenna / SmartHub is covered even on warm relaunch or app-to-app switch, then restores ShowWithDock if launch expires.
                // - From Empty TV (Visible==true): keeps Visible=true (dropped to Layer 200 by WmStackController) over tv-viewer/csfs,
                //   hides the instant the new app takes fullscreen, keeps suppression active until continuous dwell (>=1.5s / >=3.0s).
                var launchModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                T.True(launchModel.Evaluate(dyingYtSnap, 200.0, false, false, false) == IdleAction.None && !launchModel.Visible, "hidden while in app");
                launchModel.OnLaunchApp(200.5);
                T.True(launchModel.Evaluate(dyingYtSnap, 200.55, false, false, false) == IdleAction.None && !launchModel.Visible, "immediate post-launch poll does not cancel launch suppression");
                T.True(launchModel.Evaluate(onTv, 201.0, false, false, false) == IdleAction.Show && launchModel.Visible && launchModel.IsLaunchCurtainActive(201.0), "raises Layer-200 curtain (Show without Dock) over tv-viewer gap during launch");
                T.True(launchModel.Evaluate(onTv, 204.5, false, false, false) == IdleAction.None && launchModel.Visible, "keeps Layer-200 curtain steady at +4.0 s for slow cold app launches (e.g. NuvioTV)");
                T.True(launchModel.Evaluate(onTv, 206.6, false, false, false) == IdleAction.ShowWithDock && launchModel.Visible, "restores ShowWithDock if launched app fails to appear after 6.0 s");
                launchModel.OnLaunchApp(210.0);
                T.True(launchModel.Visible && launchModel.IsLaunchCurtainActive(210.0), "OnLaunchApp while Visible==true keeps Layer-200 launch curtain active");
                T.True(launchModel.Evaluate(onTv, 210.002, false, false, false) == IdleAction.None && launchModel.Visible, "stays Visible (None) over tv-viewer during launch curtain so No-Antenna never flashes");
                T.True(launchModel.Evaluate(csfsNegSnap, 210.1, false, false, false) == IdleAction.None && launchModel.Visible, "stays Visible (None) over transient csfs during launch curtain without popping Dock");
                T.Eq(launchModel.GuardedHomeDyingAppId, "", "launch curtain does not arm GuardedHomeDyingAppId on transient csfs");
                T.True(launchModel.Evaluate(dyingYtSnap, 210.4, false, false, false) == IdleAction.Hide && !launchModel.Visible, "hides immediately once launched app takes fullscreen");
                T.True(launchModel.IsLaunchSuppressed(211.0), "normal launch keeps suppression during <1.5 s dwell");
                T.True(launchModel.Evaluate(dyingYtSnap, 212.0, false, false, false) == IdleAction.None && !launchModel.IsLaunchSuppressed(212.0), "clears normal launch suppression after >=1.5 s continuous fullscreen dwell");
                T.True(launchModel.Evaluate(csfsNegSnap, 212.2, false, false, false) == IdleAction.ShowWithDock && launchModel.Visible, "closing app after 1.5 s dwell immediately pops ShowWithDock");

                // Launch curtain expiry: if launched app fails to take fullscreen, restores ShowWithDock cleanly on expiry.
                var expireModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                T.True(expireModel.Evaluate(onTv, 250.0, false, false, false) == IdleAction.ShowWithDock && expireModel.Visible, "starts on Empty TV");
                expireModel.OnLaunchApp(251.0, 3.5);
                T.True(expireModel.Evaluate(onTv, 253.0, false, false, false) == IdleAction.None && expireModel.Visible && expireModel.IsLaunchCurtainActive(253.0), "curtain stays Visible without Dock while app starts");
                T.True(expireModel.Evaluate(onTv, 254.6, false, false, false) == IdleAction.ShowWithDock && expireModel.Visible && !expireModel.IsLaunchCurtainActive(254.6), "expired launch curtain restores ShowWithDock so user is not stuck without Dock");

                // Exact 13:12:50 -> 13:12:54 shard teardown repro:
                // 1) If Visible flipped false when trapped old Cobalt surfaced, dropping to tv-viewer at +415 ms IMMEDIATELY
                //    raises Layer-200 curtain (IdleAction.Show without Dock!) so raw tv-viewer ("No Antenna") is NEVER exposed!
                // 2) Second OnLaunchApp (redundant FIFO Launch) extends suppression without clobbering _launchWasVisible.
                // 3) Dying-same-app hold (when targetAppId matches wrapper/Cobalt alias) keeps curtain Visible until -t hits tv-viewer.
                var shardRepro = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                T.True(shardRepro.Evaluate(onTv, 400.0, false, false, false) == IdleAction.ShowWithDock && shardRepro.Visible, "starts on Empty TV before YouTube click");
                shardRepro.OnLaunchApp(401.0, IdleBackdropModel.ShardLaunchSuppressSeconds);
                T.True(shardRepro.Evaluate(dyingYtSnap, 401.1, false, false, false) == IdleAction.Hide && !shardRepro.Visible, "hides curtain when trapped Cobalt surfaces without targetAppId");
                shardRepro.OnLaunchApp(401.3, IdleBackdropModel.ShardLaunchSuppressSeconds);
                T.True(shardRepro.IsLaunchSuppressed(409.0), "second OnLaunchApp extends suppression window without resetting state");
                T.True(shardRepro.Evaluate(onTv, 401.515, false, false, false) == IdleAction.Show && shardRepro.Visible && shardRepro.IsLaunchCurtainActive(401.515), "415 ms later when app_launcher -t drops to tv-viewer, raises Layer-200 curtain (Show, zero antenna screen, zero Dock bounce!)");
                T.True(shardRepro.Evaluate(dyingYtSnap, 403.0, false, false, false) == IdleAction.Hide && !shardRepro.Visible && shardRepro.IsLaunchSuppressed(403.0), "hides Layer-200 curtain as soon as new Cobalt maps at 403.0");
                T.True(shardRepro.Evaluate(dyingYtSnap, 405.5, false, false, false) == IdleAction.None && shardRepro.IsLaunchSuppressed(405.5), "2.5 s shard dwell still active (<3.0 s)");
                T.True(shardRepro.Evaluate(dyingYtSnap, 406.1, false, false, false) == IdleAction.None && !shardRepro.IsLaunchSuppressed(406.1), "3.1 s continuous shard dwell clears launch suppression");

                var aliasHold = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                aliasHold.Evaluate(dyingYtSnap, 450.0, false, false, false);
                T.True(aliasHold.Evaluate(csfsNegSnap, 451.0, false, false, false) == IdleAction.ShowWithDock && aliasHold.Visible, "on Empty TV over csfs with Cobalt as last app");
                aliasHold.OnLaunchApp(452.0, IdleBackdropModel.ShardLaunchSuppressSeconds, "9Ur5IzDKqV.TizenYouTube");
                T.True(aliasHold.Evaluate(dyingYtSnap, 452.2, false, false, false) == IdleAction.None && aliasHold.Visible, "wrapper->cobalt alias hold prevents dying Cobalt PID from hiding curtain before -t");
                T.True(aliasHold.Evaluate(onTv, 452.8, false, false, false) == IdleAction.None && aliasHold.Visible, "-t drops to tv-viewer while curtain stays seamlessly Visible");
                T.True(aliasHold.Evaluate(dyingYtSnap, 454.2, false, false, false) == IdleAction.Hide && !aliasHold.Visible, "once empty gap seen, new Cobalt hides curtain immediately");

                // OnProactiveForceClose breaks out of an active 8 s shard window immediately and holds Visible across -t teardown.
                var proactiveModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                T.True(proactiveModel.Evaluate(onTv, 500.0, false, false, false) == IdleAction.ShowWithDock && proactiveModel.Visible, "starts on Empty TV");
                proactiveModel.OnLaunchApp(501.0, IdleBackdropModel.ShardLaunchSuppressSeconds);
                T.True(proactiveModel.Evaluate(dyingYtSnap, 501.5, false, false, false) == IdleAction.Hide && !proactiveModel.Visible && proactiveModel.IsLaunchSuppressed(501.5), "YouTube visible inside 8 s window");
                T.True(proactiveModel.OnProactiveForceClose(502.3, "com.samsung.tv.cobalt-yt") == IdleAction.ShowWithDock && proactiveModel.Visible && !proactiveModel.IsLaunchSuppressed(502.3), "OnProactiveForceClose immediately returns ShowWithDock and clears 8 s suppression");
                T.True(proactiveModel.Evaluate(dyingYtSnap, 502.4, true, false, false) == IdleAction.None && proactiveModel.Visible, "holds Visible steady while app_launcher -t gracefully closes Cobalt");
                T.True(proactiveModel.Evaluate(onTv, 502.9, true, false, false) == IdleAction.None && proactiveModel.Visible, "stays Visible seamlessly once tv-viewer returns");

                // Shard launch suppression (8.0 s) + Layer-200 curtain over csfs/tv-viewer during warm relaunch from inside YouTube.
                var shardModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                T.True(shardModel.Evaluate(dyingYtSnap, 300.0, false, false, false) == IdleAction.None && !shardModel.Visible, "hidden while in YouTube before relaunch");
                shardModel.OnLaunchApp(301.0, IdleBackdropModel.ShardLaunchSuppressSeconds, "9Ur5IzDKqV.TizenYouTube");
                T.True(shardModel.IsLaunchSuppressed(307.5), "8 s shard launch suppression still active past 6.0 s default");
                T.True(shardModel.Evaluate(dyingYtSnap, 301.2, false, false, false) == IdleAction.None && shardModel.IsLaunchSuppressed(301.2), "old app still closing before empty gap does not start dwell");
                T.True(shardModel.Evaluate(csfsNegSnap, 302.0, false, false, false) == IdleAction.Show && shardModel.Visible, "transient csfs during shard relaunch raises Layer-200 curtain (Show, NOT ShowWithDock)");
                T.Eq(shardModel.GuardedHomeDyingAppId, "", "transient csfs during launch suppression does not arm GuardedHomeDyingAppId");
                T.Eq(shardModel.TeardownHoldAppId, "", "transient csfs during launch suppression does not arm TeardownHoldAppId");
                T.True(shardModel.ShouldDismissGuardedHome(csfsNegSnap, 302.0), "transient csfs during launch suppression is still dismissed safely");
                T.True(shardModel.Evaluate(onTv, 304.0, false, false, false) == IdleAction.None && shardModel.Visible, "keeps Layer-200 curtain over tv-viewer while Cobalt cold-starts (zero antenna flash)");
                T.True(shardModel.Evaluate(dyingYtSnap, 304.5, false, false, false) == IdleAction.Hide && !shardModel.Visible && shardModel.IsLaunchSuppressed(304.5), "new Cobalt hides curtain and begins 3.0 s shard dwell");
                T.True(shardModel.Evaluate(dyingYtSnap, 307.6, false, false, false) == IdleAction.None && !shardModel.IsLaunchSuppressed(307.6), "warm relaunch clears 8 s suppression after >=3.0 s continuous dwell");
                T.True(shardModel.Evaluate(csfsNegSnap, 308.0, false, false, false) == IdleAction.ShowWithDock && shardModel.Visible, "exiting YouTube after dwell immediately pops backdrop + Dock");
                T.Eq(shardModel.GuardedHomeDyingAppId, "com.samsung.tv.cobalt-yt", "dying app is tracked normally after launch suppression clears");

                // Fix 5: com.samsung.tv.channel-list is normalized to empty so it never drops vetro-idle or blocks Back claim,
                // and ShardLaunch fromDock appends &from=dock.
                T.Eq(IdleBackdropModel.NormalizePartialAppId("com.samsung.tv.channel-list"), "", "channel-list partial appid is ignored");
                T.Eq(IdleBackdropModel.NormalizePartialAppId("com.samsung.tv.shortcut"), "com.samsung.tv.shortcut", "real partial overlay is preserved");
                var chanListModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                var chanListSnap = new TvSnapshot { SourceType = 0, FullscreenAppId = IdleBackdropModel.TvViewerAppId, PartialAppId = "com.samsung.tv.channel-list", DisplayState = 1 };
                T.True(chanListModel.Evaluate(chanListSnap, 600.0, false, false, false) == IdleAction.ShowWithDock && chanListModel.CanClaimBackKey(true, false, "com.samsung.tv.channel-list", false, false), "channel-list partial does not block backdrop or Back claim");
                var ytTile = new AppEntry("youtube", "YouTube", "9Ur5IzDKqV.TizenYouTube", null, null, -1, null, false, null, null, true);
                T.True(ShardLaunch.Command(ytTile, 8099, true).Contains("/plugins/launcher/api/open?slug=youtube&from=dock"), "ShardLaunch fromDock appends &from=dock");

                // TriggerLcdOff marks Dimmed=true immediately and OnRawKey while DisplayStateOff resets Dimmed/lcdOffSent.
                var dimSyncModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", false, "5", "10"));
                T.True(dimSyncModel.Evaluate(onTv, 300.0, false, false, false) == IdleAction.Show, "shows backdrop");
                T.True(dimSyncModel.Evaluate(onTv, 605.0, false, false, false) == IdleAction.TriggerLcdOff && dimSyncModel.Dimmed, "TriggerLcdOff sets Dimmed=true immediately");
                T.True(dimSyncModel.OnRawKey(63, 63, 610.0, true, false, out hideBg) && !dimSyncModel.Dimmed, "OnRawKey while DisplayStateOff clears Dimmed and consumes wake key");

                // Issues 1-3: foreground apps (YouTube, Browser) never match IsEmptyTvContext; CanClaimBackKey is strictly gated.
                var backModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                var ytSnap = new TvSnapshot { SourceType = -1, FullscreenAppId = "com.samsung.tv.cobalt-yt", PartialAppId = "", DisplayState = 1 };
                var browserSnap = new TvSnapshot { SourceType = -1, FullscreenAppId = "org.tizen.browser", PartialAppId = "", DisplayState = 1 };
                T.True(backModel.Evaluate(ytSnap, 10.0, false, false, false) == IdleAction.None && !backModel.IsEmptyTvContext, "fresh model in YouTube (src=-1) is never Empty TV");
                T.True(backModel.Evaluate(onTv, 20.0, false, false, false) == IdleAction.ShowWithDock && backModel.IsEmptyTvContext, "shows backdrop on Empty TV");
                T.True(backModel.CanClaimBackKey(true, false, "", false, false), "claims Back only on unobstructed shown vetro-idle");
                T.True(!backModel.CanClaimBackKey(false, false, "", false, false), "does not claim Back if window is not shown");
                T.True(!backModel.CanClaimBackKey(true, true, "", false, false), "does not claim Back while Dock is active");
                T.True(!backModel.CanClaimBackKey(true, false, "com.samsung.tv.shortcut", false, false), "does not claim Back over Samsung partial overlay");
                T.True(!backModel.CanClaimBackKey(true, false, "", true, false), "does not claim Back while 123 pad is open");
                T.True(!backModel.CanClaimBackKey(true, false, "", false, true), "does not claim Back in custom launcher mode");
                T.True(backModel.Evaluate(ytSnap, 30.0, false, false, false) == IdleAction.Hide && !backModel.IsEmptyTvContext && !backModel.CanClaimBackKey(true, false, "", false, false), "YouTube hides backdrop and clears Empty TV / Back claim");
                T.True(backModel.ShouldDismissGuardedHome(csfsNegSnap, 35.0), "post-exit guarded Home dismissal still works after YouTube closes");
                T.True(backModel.Evaluate(onTv, 36.0, false, false, false) == IdleAction.ShowWithDock && backModel.IsEmptyTvContext, "restores backdrop + Dock after YouTube exits");
                T.True(backModel.Evaluate(browserSnap, 40.0, false, false, false) == IdleAction.Hide && !backModel.IsEmptyTvContext && !backModel.CanClaimBackKey(true, false, "", false, false), "Browser hides backdrop and clears Empty TV / Back claim");
                T.True(backModel.Evaluate(onHdmi, 50.0, false, false, false) == IdleAction.None && !backModel.IsEmptyTvContext && !backModel.CanClaimBackKey(true, false, "", false, false), "HDMI never matches Empty TV or Back claim");

                // Issue 4: DisplayState wake & STR OnWake clear Dimmed, trigger restack, hold transient empty FullscreenAppId for 1.5 s,
                // and open Dock on arrival after Standby wake when AutoDock is true (while distinguishing lcdoff / Picture Off).
                var wakeModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                T.True(wakeModel.Evaluate(onTv, 100.0, false, false, false) == IdleAction.ShowWithDock, "initial backdrop");
                T.True(wakeModel.Evaluate(onTv, 705.0, false, false, false) == IdleAction.Dim && wakeModel.Dimmed, "dims after 10 min");
                T.True(wakeModel.Evaluate(standbySnap, 710.0, false, false, false) == IdleAction.None && wakeModel.Visible, "stays visible in DisplayStateOff");
                var wakeEmptySnap = new TvSnapshot { SourceType = -1, FullscreenAppId = "", PartialAppId = "", DisplayState = 1 };
                T.True(wakeModel.Evaluate(wakeEmptySnap, 720.0, false, false, false) == IdleAction.None && wakeModel.Visible && !wakeModel.Dimmed, "wake clears Dimmed and preserves Visible across transient empty appid");
                T.True(wakeModel.ConsumeWakeRestack() && !wakeModel.ConsumeWakeRestack(), "ConsumeWakeRestack fires once on DisplayStateOff -> On");
                T.True(wakeModel.Evaluate(onTv, 720.8, false, false, false) == IdleAction.ShowWithDock && wakeModel.Visible, "opens Dock on arrival when tv-viewer settles after Standby wake with AutoDock=true");
                T.True(wakeModel.Evaluate(onTv, 721.5, false, false, false) == IdleAction.None && wakeModel.Visible, "subsequent steady poll does not reopen Dock");
                T.True(wakeModel.OnWake(800.0) && wakeModel.Evaluate(wakeEmptySnap, 801.0, false, false, false) == IdleAction.None && wakeModel.Visible, "STR OnWake holds transient empty appid within 1.5 s grace");
                T.True(wakeModel.Evaluate(ytSnap, 801.2, false, false, false) == IdleAction.Hide && !wakeModel.Visible, "real foreground app still hides immediately during wake grace");
                T.True(wakeModel.Evaluate(onTv, 805.0, false, false, false) == IdleAction.ShowWithDock, "shows again on tv-viewer");
                T.True(wakeModel.OnWake(810.0) && wakeModel.Evaluate(wakeEmptySnap, 811.6, false, false, false) == IdleAction.Hide && !wakeModel.Visible, "empty appid after 1.5 s grace expires hides normally");

                // Standby vs Picture Off (lcdoff) & transient displayOff blip: lcdoff and <1.5s blips do NOT reopen Dock on wake.
                var lcdWakeModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "5", "10"));
                T.True(lcdWakeModel.Evaluate(onTv, 100.0, false, false, false) == IdleAction.ShowWithDock, "lcdWakeModel initial arrival");
                T.True(lcdWakeModel.Evaluate(onTv, 405.0, false, false, false) == IdleAction.TriggerLcdOff && lcdWakeModel.Dimmed, "TriggerLcdOff fires after 5 min");
                T.True(lcdWakeModel.Evaluate(standbySnap, 406.0, false, false, false) == IdleAction.None && lcdWakeModel.Visible, "panel enters lcdoff DisplayStateOff");
                T.True(lcdWakeModel.OnRawKey(106, 63, 450.0, true, false, out hideBg), "wake key consumed during lcdoff");
                T.True(lcdWakeModel.Evaluate(onTv, 450.2, false, false, false) == IdleAction.None && lcdWakeModel.Visible && !lcdWakeModel.Dimmed, "waking from automatic lcdoff undims without reopening Dock");
                lcdWakeModel.OnPictureOff();
                T.True(lcdWakeModel.Evaluate(standbySnap, 460.0, false, false, false) == IdleAction.None, "manual Picture Off enters DisplayStateOff");
                T.True(lcdWakeModel.Evaluate(onTv, 490.0, false, false, false) == IdleAction.None && lcdWakeModel.Visible, "waking from manual Picture Off does not reopen Dock");
                T.True(lcdWakeModel.Evaluate(standbySnap, 500.0, false, false, false) == IdleAction.None, "short display state blip (<1.5s) starts");
                T.True(lcdWakeModel.Evaluate(onTv, 500.8, false, false, false) == IdleAction.None, "short display state blip (<1.5s) does not reopen Dock");

                // Pre-showing vetro-idle while panel is dark in DisplayStateOff so tv-viewer never flashes on wake frame 0.
                var preStandbyModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                T.True(preStandbyModel.Evaluate(ytSnap, 10.0, false, false, false) == IdleAction.None && !preStandbyModel.Visible, "in app before Standby");
                var darkTvSnap = new TvSnapshot { SourceType = 0, FullscreenAppId = IdleBackdropModel.TvViewerAppId, PartialAppId = "", DisplayState = IdleBackdropModel.DisplayStateOff };
                T.True(preStandbyModel.Evaluate(darkTvSnap, 15.0, false, false, false) == IdleAction.Show && preStandbyModel.Visible, "pre-shows vetro-idle while DisplayStateOff when tv-viewer becomes fullscreen");
                T.True(preStandbyModel.Evaluate(onTv, 25.0, false, false, false) == IdleAction.ShowWithDock && preStandbyModel.Visible, "opens Dock on arrival once panel wakes from Standby");

                // Preserving _wasOtherApp across temporary VolumePill (pillOpen) or NumberPad (padOpen) at arrival.
                var pillArrivalModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                T.True(pillArrivalModel.Evaluate(onTv, 10.0, false, false, true) == IdleAction.Show && pillArrivalModel.Visible, "shows backdrop without Dock while VolumePill is open on arrival");
                T.True(pillArrivalModel.Evaluate(onTv, 11.0, false, false, true) == IdleAction.None, "waits while VolumePill remains open");
                T.True(pillArrivalModel.Evaluate(onTv, 12.5, false, false, false) == IdleAction.ShowWithDock, "opens Dock on arrival as soon as VolumePill closes");
                T.True(pillArrivalModel.Evaluate(ytSnap, 20.0, false, false, false) == IdleAction.Hide, "hides in app");
                T.True(pillArrivalModel.Evaluate(onTv, 30.0, false, true, false) == IdleAction.Show && pillArrivalModel.Visible, "shows backdrop without Dock while NumberPad is open on arrival");
                T.True(pillArrivalModel.Evaluate(onTv, 32.0, false, false, false) == IdleAction.ShowWithDock, "opens Dock on arrival as soon as NumberPad closes");

                // Opaque vetro-idle occlusion compatibility: SourceType == -1 with _lastKnownSource == -1 matches Empty TV for TvViewerAppId.
                var occludedModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                var occludedTvSnap = new TvSnapshot { SourceType = -1, FullscreenAppId = IdleBackdropModel.TvViewerAppId, PartialAppId = "", DisplayState = 1 };
                T.True(occludedModel.Evaluate(occludedTvSnap, 10.0, false, false, false) == IdleAction.ShowWithDock && occludedModel.Visible, "matches Empty TV when tv-viewer reports SourceType=-1 on startup/reconfigure");
                T.True(occludedModel.Evaluate(onHdmi, 20.0, false, false, false) == IdleAction.Hide && !occludedModel.Visible, "hides on HDMI (SourceType=13)");
                T.True(occludedModel.Evaluate(occludedTvSnap, 25.0, false, false, false) == IdleAction.None && !occludedModel.Visible, "does not show when _lastKnownSource is HDMI (13) and SourceType=-1");

                // Iteration 2 (Finding 1): OnWake called BEFORE Evaluate preserves Visible even when _lastDisplayState == 1 (STR before pm==3).
                var strOnlyModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                T.True(strOnlyModel.Evaluate(onTv, 10.0, false, false, false) == IdleAction.ShowWithDock, "strOnlyModel starts visible");
                T.True(strOnlyModel.Evaluate(onTv, 620.0, false, false, false) == IdleAction.Dim && strOnlyModel.Dimmed, "strOnlyModel dimmed before STR freeze");
                T.True(strOnlyModel.OnWake(700.0), "STR OnWake runs before Evaluate while _lastDisplayState is still 1");
                T.True(strOnlyModel.Evaluate(wakeEmptySnap, 700.1, false, false, false) == IdleAction.None && strOnlyModel.Visible && !strOnlyModel.Dimmed, "OnWake before Evaluate keeps Visible and undims across transient empty FullscreenAppId when _lastDisplayState == 1");

                // Iteration 2: Launchscreen Winsys is Tizen's native loading spinner (NOT guarded Samsung Home; EdenView IS guarded) & narrow IsOverlayLaunchKey.
                T.True(!IdleBackdropModel.IsGuardedSamsungHomeWindow("Launchscreen Winsys"), "Launchscreen Winsys is NOT guarded Samsung Home (handled as launch-gated spinner)");
                T.True(!IdleBackdropModel.IsGuardedSamsungHomeWindow("Launchscreen Winsys BG 24 Bit"), "Launchscreen Winsys BG 24 Bit is NOT guarded Samsung Home");
                T.True(IdleBackdropModel.IsGuardedSamsungHomeWindow("[WIND]Badak wind for EdenView App"), "EdenView remains recognized as guarded Samsung Home window");
                T.True(IdleBackdropModel.IsOverlayLaunchKey(139) && IdleBackdropModel.IsOverlayLaunchKey(140) && IdleBackdropModel.IsOverlayLaunchKey(490) && IdleBackdropModel.IsOverlayLaunchKey(524), "overlay launch keys match Menu/123/QuickMenu/Source");
                T.True(!IdleBackdropModel.IsOverlayLaunchKey(103) && !IdleBackdropModel.IsOverlayLaunchKey(105) && !IdleBackdropModel.IsOverlayLaunchKey(106) && !IdleBackdropModel.IsOverlayLaunchKey(108) && !IdleBackdropModel.IsOverlayLaunchKey(28), "D-pad and OK do not trigger eager Back-claim release");

                // Empty TV 120s screensaver_on_off=1 preservation (#120/#121): Tizen flips screensaver_on_off=1 at 120s on Empty TV
                // even when no screensaver window exists above tv-viewer ("Aerial cable: disconnected"), and any real Layer-900
                // ScreenSaverContent/glscreensaver composites above Layer-250 vetro-idle anyway. vetro-idle must stay Visible=true
                // across t=121s and proceed cleanly to Dim (600s) / TriggerLcdOff (PictureOffMinutes), while full Ambient hides normally.
                var ssModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", false, "0", "40"));
                T.True(ssModel.Evaluate(onTv, 900.0, false, false, false) == IdleAction.Show && ssModel.Visible, "initial backdrop on Empty TV");
                var ssActiveSnap = new TvSnapshot { SourceType = 0, FullscreenAppId = IdleBackdropModel.TvViewerAppId, PartialAppId = "", DisplayState = 1, ScreensaverActive = true };
                T.True(ssModel.Evaluate(ssActiveSnap, 1021.0, false, false, false) == IdleAction.None && ssModel.Visible && !ssModel.Dimmed, "at t=+121s with screensaver_on_off=1 on tv-viewer, vetro-idle stays Visible (NEVER Hide!)");
                T.True(ssModel.Evaluate(ssActiveSnap, 1500.0, false, false, false) == IdleAction.Dim && ssModel.Visible && ssModel.Dimmed, "at t=+600s with screensaver_on_off=1 on tv-viewer, vetro-idle proceeds cleanly to Dim");
                var ambientFullSnap = new TvSnapshot { SourceType = -1, FullscreenAppId = "org.tizen.ambientapp", PartialAppId = "", DisplayState = 1, ScreensaverActive = true };
                T.True(ssModel.Evaluate(ambientFullSnap, 1510.0, false, false, false) == IdleAction.Hide && !ssModel.Visible, "real fullscreen Ambient Mode app still hides vetro-idle cleanly");
                T.True(ssModel.Evaluate(onTv, 1520.0, false, false, false) == IdleAction.Show && ssModel.Visible, "restores cleanly when returning from Ambient Mode to Empty TV");

                var ssPotOffModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", false, "10", "40"));
                T.True(ssPotOffModel.Evaluate(onTv, 100.0, false, false, false) == IdleAction.Show && ssPotOffModel.Visible, "PictureOffMinutes=10 starts Visible on Empty TV");
                T.True(ssPotOffModel.Evaluate(ssActiveSnap, 221.0, false, false, false) == IdleAction.None && ssPotOffModel.Visible, "PictureOffMinutes=10 stays Visible across t=+121s screensaver_on_off=1");
                T.True(ssPotOffModel.Evaluate(ssActiveSnap, 700.0, false, false, false) == IdleAction.TriggerLcdOff && ssPotOffModel.Visible, "PictureOffMinutes=10 fires TriggerLcdOff at t=+600s despite screensaver_on_off=1");

                T.True(!IdleBackdropModel.IsScreensaverOverlayComm("screend\n"), "IsScreensaverOverlayComm excludes permanent screend daemon");
                T.True(!IdleBackdropModel.IsScreensaverOverlayComm("AmbientApp\n") && !IdleBackdropModel.IsScreensaverOverlayComm("DN_n.ambientapp\n"), "IsScreensaverOverlayComm excludes background-preloaded AmbientApp");
                T.True(!IdleBackdropModel.IsScreensaverOverlayComm("tv-viewer\n") && !IdleBackdropModel.IsScreensaverOverlayComm(""), "IsScreensaverOverlayComm excludes tv-viewer and empty comm");
                T.True(IdleBackdropModel.IsScreensaverOverlayComm("glscreensaver\n") && IdleBackdropModel.IsScreensaverOverlayComm("ScreenSaverCont\n") && IdleBackdropModel.IsScreensaverOverlayComm("DN_SaverContent\n") && IdleBackdropModel.IsScreensaverOverlayComm("DN_.screensaver\n"), "IsScreensaverOverlayComm matches glscreensaver and ScreenSaverContent comm names");

                // Iteration 3: Boolean vconf primary read with Int32 fallback & OnEcoreKey live screensaver forwarding.
                bool fallbackCalled = false;
                T.True(IdleBackdropModel.ReadBoolOrInt((out int v) => { v = 1; return true; }, (out int v) => { fallbackCalled = true; v = 0; return true; }) && !fallbackCalled, "ReadBoolOrInt returns true on bool=1 without calling int fallback");
                T.True(!IdleBackdropModel.ReadBoolOrInt((out int v) => { v = 0; return true; }, (out int v) => { fallbackCalled = true; v = 1; return true; }) && !fallbackCalled, "ReadBoolOrInt respects valid bool=0 without falling back to int");
                T.True(IdleBackdropModel.ReadBoolOrInt((out int v) => { v = 0; return false; }, (out int v) => { v = 1; return true; }), "ReadBoolOrInt falls back to int=1 when bool read fails");
                T.True(!IdleBackdropModel.ReadBoolOrInt((out int v) => { v = 0; return false; }, (out int v) => { v = 0; return true; }), "ReadBoolOrInt falls back to int=0 -> false");
                T.True(!IdleBackdropModel.ReadBoolOrInt((out int v) => { v = 1; return false; }, (out int v) => { v = 1; return false; }), "ReadBoolOrInt returns false when both bool and int fail");

                T.True(!IdleBackdropModel.ShouldForwardGrabbedBack("", IdleBackdropModel.TvViewerAppId, () => false), "does not forward Back on unobstructed tv-viewer");
                T.True(IdleBackdropModel.ShouldForwardGrabbedBack("", IdleBackdropModel.TvViewerAppId, () => true), "forwards grabbed Back when screensaver activates in 0..1.5s poll gap");
                T.True(!IdleBackdropModel.ShouldForwardGrabbedBack("", "com.samsung.tv.csfs", () => false), "does not forward Back for guarded Samsung Home when screensaver is inactive");
                bool ssChecked = false;
                T.True(IdleBackdropModel.ShouldForwardGrabbedBack("org.tizen.menu", IdleBackdropModel.TvViewerAppId, () => { ssChecked = true; return false; }) && !ssChecked, "partial app short-circuits before screensaver check");
                T.True(IdleBackdropModel.ShouldForwardGrabbedBack("", "com.samsung.tv.cobalt-yt", () => { ssChecked = true; return false; }) && !ssChecked, "foreground app short-circuits before screensaver check");

                // Iteration 4: CollectStaleLongpressPids deduplicates, excludes current/invalid PIDs, and parses whitespace/newlines.
                int[] stale = IdleBackdropModel.CollectStaleLongpressPids(12303, "11590\n", " 11590\t12303 0 -5 abc 9981 \r\n", null, "");
                T.True(stale.Length == 2 && stale[0] == 11590 && stale[1] == 9981, "CollectStaleLongpressPids returns distinct valid stale PIDs in order");
                T.True(IdleBackdropModel.CollectStaleLongpressPids(12303, "12303\n", "", "not-a-pid").Length == 0, "CollectStaleLongpressPids returns empty when only current or invalid PIDs exist");
            });

            T.Run("WmStackLogic: LayerShield default, layerChanged forces SetWindowStack, and Launchscreen/tvvideosink tracking", () =>
            {
                // Case 1: LayerShield (250) -> LayerNormal (200) when partialActive=true forces SetWindowStack even when pre-change idleIndex < topTvIndex.
                var cmds = new List<string>();
                int currentLayer = WmStackLogic.LayerShield;
                string winsAboveTv =
                    "struct {\n uint32 1554\n vetro-idle         \n int32 0\n int32 250\n}\n" +
                    "struct {\n uint32 1553\n tvlauncher         \n int32 0\n int32 900\n}\n" +
                    "struct {\n uint32 1767\n tvvideosink-area         \n int32 0\n int32 200\n}\n" +
                    "struct {\n uint32 1\n tv-viewer         \n int32 0\n int32 200\n}\n";
                Func<string, string> fakeShell = cmd =>
                {
                    cmds.Add(cmd);
                    if (cmd.Contains("GetWinsInfo")) return winsAboveTv;
                    if (cmd.Contains("GetWindowNotiLevel")) return "int32 " + currentLayer;
                    if (cmd.Contains("SetWindowNotiLevel"))
                    {
                        if (cmd.Contains("int32:200")) currentLayer = WmStackLogic.LayerNormal;
                        else if (cmd.Contains("int32:250")) currentLayer = WmStackLogic.LayerShield;
                        return "";
                    }
                    return "";
                };
                bool active = false, probed = false;
                uint idleWinId = 0;
                WmStackLogic.Step(fakeShell, false, false, true, false, ref active, ref probed, ref idleWinId, null);
                T.True(active && idleWinId == 1554 && currentLayer == WmStackLogic.LayerNormal, "partialActive drops vetro-idle from LayerShield to LayerNormal");
                T.True(cmds.Exists(c => c.Contains("SetWindowStack uint32:1554 uint32:1767 int32:1")), "layerChanged forces SetWindowStack above topTv (tvvideosink-area) despite stale pre-change idleIndex=0");

                // Case 2: Steady state (shieldTime=false, no csfs) stays on LayerNormal (200); active shieldTime=true promotes to LayerShield (250)
                // and promotes Layer-250 overlays to LayerOverlay (500) first (or atomically chains SetWindowStack if firmware refuses 500).
                cmds.Clear();
                WmStackLogic.Step(fakeShell, false, false, false, false, ref active, ref probed, ref idleWinId, null);
                T.True(currentLayer == WmStackLogic.LayerNormal, "steady-state unobstructed vetro-idle stays on LayerNormal (200)");
                cmds.Clear();
                winsAboveTv =
                    "struct {\n uint32 1554\n vetro-idle         \n int32 0\n int32 200\n}\n" +
                    "struct {\n uint32 1553\n tvlauncher         \n int32 0\n int32 250\n}\n" +
                    "struct {\n uint32 1\n tv-viewer         \n int32 0\n int32 200\n}\n";
                WmStackLogic.Step(fakeShell, false, false, false, true, ref active, ref probed, ref idleWinId, null);
                T.True(currentLayer == WmStackLogic.LayerShield, "active shieldTime promotes vetro-idle to LayerShield (250)");
                T.True(cmds.Exists(c => c.Contains("SetWindowNotiLevel uint32:1553 int32:500")), "promotes tvlauncher overlay to LayerOverlay (500) before promoting vetro-idle");
                T.True(cmds.Exists(c => c.Contains("SetWindowNotiLevel uint32:1554 int32:250") && c.Contains("SetWindowStack uint32:1554 uint32:1553 int32:0")), "chains atomic SetWindowStack below tvlauncher when firmware refuses Layer 500");

                // Case 3 (#108 Finding #1): Launch-gated Launchscreen Winsys — during launchingApp=true, vetro-idle drops to Layer 200 and
                // stacks strictly BELOW Launchscreen Winsys*; outside a launch (launchingApp=false), Launchscreen Winsys never drops LayerShield (250).
                cmds.Clear();
                currentLayer = WmStackLogic.LayerShield;
                winsAboveTv =
                    "struct {\n uint32 1554\n vetro-idle         \n int32 0\n int32 250\n}\n" +
                    "struct {\n uint32 1702\n Launchscreen Winsys         \n int32 0\n int32 200\n}\n" +
                    "struct {\n uint32 1703\n Launchscreen Winsys BG 24 Bit         \n int32 0\n int32 200\n}\n" +
                    "struct {\n uint32 1\n tv-viewer         \n int32 0\n int32 200\n}\n";
                WmStackObservation lsObs;
                WmStackLogic.Step(fakeShell, false, false, false, true, ref active, ref probed, ref idleWinId, out lsObs, null, false);
                T.True(lsObs.LaunchscreenWinPresent && !lsObs.ActiveAppWinPresent && currentLayer == WmStackLogic.LayerShield, "outside app launch (launchingApp=false), csfs cold-restart Launchscreen Winsys NEVER drops LayerShield (250)");
                T.True(!cmds.Exists(c => c.Contains("SetWindowStack uint32:1554 uint32:1703 int32:0")), "outside app launch, never tucks vetro-idle below Launchscreen Winsys");

                cmds.Clear();
                WmStackLogic.Step(fakeShell, false, false, false, true, ref active, ref probed, ref idleWinId, out lsObs, null, true);
                T.True(lsObs.LaunchscreenWinPresent && currentLayer == WmStackLogic.LayerNormal, "during active app launch (launchingApp=true), drops vetro-idle to LayerNormal (200)");
                T.True(cmds.Exists(c => c.Contains("SetWindowStack uint32:1554 uint32:1703 int32:0")), "during active app launch, stacks vetro-idle strictly below Launchscreen Winsys BG 24 Bit");

                // Case 4: launchingApp=true drops LayerShield (250) -> LayerNormal (200) WITHOUT calling SetWindowStack,
                // keeping vetro-idle at the top of Layer 200 above paused background apps (cobalt-app) as well as tv-viewer/csfs.
                cmds.Clear();
                currentLayer = WmStackLogic.LayerShield;
                winsAboveTv =
                    "struct {\n uint32 1554\n vetro-idle         \n int32 0\n int32 250\n}\n" +
                    "struct {\n uint32 2326\n cobalt-app         \n int32 0\n int32 200\n}\n" +
                    "struct {\n uint32 1\n tv-viewer         \n int32 0\n int32 200\n}\n";
                WmStackLogic.Step(fakeShell, false, true, false, true, ref active, ref probed, ref idleWinId, null, true);
                T.True(currentLayer == WmStackLogic.LayerNormal, "launchingApp drops vetro-idle to LayerNormal (200) even during guardedHomeActive/shieldTime");
                T.True(!cmds.Exists(c => c.Contains("SetWindowStack")), "launchingApp never calls SetWindowStack (never tucks vetro-idle under background cobalt-app)");

                // Case 5: already on LayerNormal (200) during launchingApp -> no SetWindowNotiLevel and no SetWindowStack.
                cmds.Clear();
                currentLayer = WmStackLogic.LayerNormal;
                WmStackLogic.Step(fakeShell, false, false, false, false, ref active, ref probed, ref idleWinId, null, true);
                T.True(!cmds.Exists(c => c.Contains("SetWindowNotiLevel")) && !cmds.Exists(c => c.Contains("SetWindowStack")), "launchingApp already on LayerNormal does zero restack mutations");

                // Case 6: WmLaunchState pre-launch snapshot + real Tizen 9 GetWinsInfo struct format:
                // Cold launch of Player.pl while paused cobalt-app sits above tv-viewer keeps cobalt-app covered, then stacks vetro-idle
                // immediately below newly mapped Player window (SetWindowStack above=0).
                var launchState = new WmLaunchState
                {
                    TargetAppId = "uW3QTCzW3B.Player",
                    TargetLabel = "Player",
                    IsYoutubeTarget = false,
                    StartedAtMs = 1000
                };
                cmds.Clear();
                currentLayer = WmStackLogic.LayerShield;
                winsAboveTv =
                    "struct {\n uint32 2422\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 250\n boolean true\n}\n" +
                    "struct {\n uint32 2326\n cobalt-app         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean true\n}\n" +
                    "struct {\n uint32 50\n org.tizen.browser         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n}\n" +
                    "struct {\n uint32 2016\n ChannelList         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean true\n}\n" +
                    "struct {\n uint32 1\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean true\n}\n";
                WmStackLogic.Step(fakeShell, false, false, false, false, ref active, ref probed, ref idleWinId, null, true, launchState, 1000);
                T.True(launchState.SnapshotTaken && launchState.PreLaunchTopAppWinId == 2326 && launchState.PreLaunchWinIds.Contains(2326), "initial launch step snapshots pre-existing cobalt-app");
                T.True(!launchState.PreLaunchWinIds.Contains(50) && !launchState.PreLaunchWinIds.Contains(2016), "hidden windows and ChannelList daemon are excluded from user app set");
                T.True(currentLayer == WmStackLogic.LayerNormal && !cmds.Exists(c => c.Contains("SetWindowStack")), "snapshot step drops to Layer 200 without uncovering cobalt-app");

                // Poll at +300 ms while Player is still loading: paused cobalt-app (2326) is still topmost, must NOT match Player!
                cmds.Clear();
                winsAboveTv =
                    "struct {\n uint32 2422\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean true\n}\n" +
                    "struct {\n uint32 2326\n cobalt-app         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean true\n}\n" +
                    "struct {\n uint32 1\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean true\n}\n";
                WmStackLogic.Step(fakeShell, false, false, false, false, ref active, ref probed, ref idleWinId, null, true, launchState, 1300);
                T.True(!cmds.Exists(c => c.Contains("SetWindowStack")), "unrelated paused cobalt-app never triggers SetWindowStack even past 220 ms");

                // Poll at +650 ms once Player (2610) maps below vetro-idle on Layer 200: stacks vetro-idle below Player (above=0)!
                cmds.Clear();
                winsAboveTv =
                    "struct {\n uint32 2422\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean true\n}\n" +
                    "struct {\n uint32 2610\n Player         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean true\n}\n" +
                    "struct {\n uint32 2326\n cobalt-app         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean true\n}\n" +
                    "struct {\n uint32 1\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean true\n}\n";
                WmStackLogic.Step(fakeShell, false, false, false, false, ref active, ref probed, ref idleWinId, null, true, launchState, 1650);
                T.True(cmds.Exists(c => c.Contains("SetWindowStack uint32:2422 uint32:2610 int32:0")), "stacks vetro-idle immediately below newly mapped Player window (above=0)");

                // Case 7: Resident switch (existing app rises above previous PreLaunchTopAppWinId) & Same-app resident re-open (Nuvio TV).
                var nuvioState = new WmLaunchState
                {
                    TargetAppId = "NuvioTV001.NuvioTV",
                    TargetLabel = "Custom Label",
                    IsYoutubeTarget = false,
                    StartedAtMs = 2000
                };
                cmds.Clear();
                winsAboveTv =
                    "struct {\n uint32 2422\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean true\n}\n" +
                    "struct {\n uint32 2594\n Nuvio TV         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean true\n}\n" +
                    "struct {\n uint32 1\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean true\n}\n";
                WmStackLogic.Step(fakeShell, false, false, false, false, ref active, ref probed, ref idleWinId, null, true, nuvioState, 2000);
                T.True(!cmds.Exists(c => c.Contains("SetWindowStack")), "snapshot on resident Nuvio TV waits before restacking");
                WmStackLogic.Step(fakeShell, false, false, false, false, ref active, ref probed, ref idleWinId, null, true, nuvioState, 2100);
                T.True(!cmds.Exists(c => c.Contains("SetWindowStack")), "resident same-app hold waits until >=220 ms");
                WmStackLogic.Step(fakeShell, false, false, false, false, ref active, ref probed, ref idleWinId, null, true, nuvioState, 2250);
                T.True(cmds.Exists(c => c.Contains("SetWindowStack uint32:2422 uint32:2594 int32:0")), "re-opening resident Nuvio TV matches targetAppId suffix despite custom label at >=220 ms");

                // Case 8: YouTube warm relaunch ignores dying old cobalt-app (2326) and stacks below new cobalt-app (2700).
                var ytLaunchState = new WmLaunchState
                {
                    TargetAppId = "9Ur5IzDKqV.TizenYouTube",
                    TargetLabel = "YouTube",
                    IsYoutubeTarget = true,
                    StartedAtMs = 3000
                };
                cmds.Clear();
                winsAboveTv =
                    "struct {\n uint32 2422\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean true\n}\n" +
                    "struct {\n uint32 2326\n cobalt-app         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean true\n}\n" +
                    "struct {\n uint32 1\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean true\n}\n";
                WmStackLogic.Step(fakeShell, false, false, false, false, ref active, ref probed, ref idleWinId, null, true, ytLaunchState, 3000);
                WmStackLogic.Step(fakeShell, false, false, false, false, ref active, ref probed, ref idleWinId, null, true, ytLaunchState, 3500);
                T.True(!cmds.Exists(c => c.Contains("SetWindowStack")), "YouTube relaunch never tucks under pre-existing dying cobalt-app");
                winsAboveTv =
                    "struct {\n uint32 2422\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean true\n}\n" +
                    "struct {\n uint32 2700\n cobalt-app         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean true\n}\n" +
                    "struct {\n uint32 1\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean true\n}\n";
                WmStackLogic.Step(fakeShell, false, false, false, false, ref active, ref probed, ref idleWinId, null, true, ytLaunchState, 4200);
                T.True(cmds.Exists(c => c.Contains("SetWindowStack uint32:2422 uint32:2700 int32:0")), "YouTube relaunch stacks below newly spawned cobalt-app (2700)");

                // Case 9: Real 3-boolean Tizen 9 GetWinsInfo struct (bools[0]=false iconic, bools[1]=true/false VISIBLE, bools[2]=false FOCUSED):
                // Proves visible Nuvio TV (2757) is parsed as Visible==true while hidden browser (50, false/false/false) is Visible==false,
                // triggering SetWindowStack(2422, 2757, 0).
                WmStackLogic.WinInfo parsedShown, parsedHidden;
                T.True(WmStackLogic.TryParseWinInfo(" uint32 2757\n Nuvio TV         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}", 0, out parsedShown) && parsedShown.Visible && parsedShown.Title == "Nuvio TV", "3-bool Tizen 9 struct parses bools[1] as Visible=true");
                T.True(WmStackLogic.TryParseWinInfo(" uint32 50\n org.tizen.browser         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean false\n boolean false\n}", 1, out parsedHidden) && !parsedHidden.Visible, "3-bool Tizen 9 struct parses bools[1]=false as Visible=false");

                var tizen9NuvioLaunch = new WmLaunchState
                {
                    TargetAppId = "NuvioTV001.NuvioTV",
                    TargetLabel = "Nuvio TV",
                    IsYoutubeTarget = false,
                    StartedAtMs = 5000
                };
                cmds.Clear();
                currentLayer = WmStackLogic.LayerShield;
                winsAboveTv =
                    "struct {\n uint32 2422\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 250\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 2326\n cobalt-app         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 50\n org.tizen.browser         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean false\n boolean false\n}\n" +
                    "struct {\n uint32 118\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 137\n /opt/usr/apps/com.samsung.tv.csfs/bin/csfs.dll         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n";
                WmStackLogic.Step(fakeShell, false, false, false, false, ref active, ref probed, ref idleWinId, null, true, tizen9NuvioLaunch, 5000);
                T.True(tizen9NuvioLaunch.PreLaunchWinIds.Contains(2326) && !tizen9NuvioLaunch.PreLaunchWinIds.Contains(50), "3-bool snapshot captures visible cobalt-app and skips hidden browser");
                cmds.Clear();
                winsAboveTv =
                    "struct {\n uint32 2422\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 2757\n Nuvio TV         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 2326\n cobalt-app         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 118\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n";
                WmStackLogic.Step(fakeShell, false, false, false, false, ref active, ref probed, ref idleWinId, null, true, tizen9NuvioLaunch, 5400);
                T.True(cmds.Exists(c => c.Contains("SetWindowStack uint32:2422 uint32:2757 int32:0")), "3-bool Tizen 9 Nuvio TV triggers SetWindowStack(2422, 2757, 0)");

                // Case 10 (#117a): Rapid force-close -> <1.5s YouTube relaunch where dying cobalt-app (3100) is initially visible at T=0,
                // unmaps during -t teardown (bools[1]=false -> pruned from PreLaunchWinIds), and re-maps reusing the SAME WinId=3100 at +1.1s.
                T.True(WmStackLogic.WindowMatchesTarget("cobalt-app", "9Ur5IzDKqV.TizenYouTube", "YouTube"), "WindowMatchesTarget matches cobalt-app for wrapper 9Ur5IzDKqV.TizenYouTube");
                T.True(WmStackLogic.WindowMatchesTarget("/usr/apps/com.samsung.tv.cobalt-yt/bin/cobalt-app", "com.samsung.tv.cobalt-yt", ""), "WindowMatchesTarget matches cobalt-app path for com.samsung.tv.cobalt-yt");
                T.True(!WmStackLogic.WindowMatchesTarget("cobalt-app", "NuvioTV001.NuvioTV", "Nuvio TV"), "WindowMatchesTarget never matches cobalt-app for non-YouTube targets");

                var rapidYtReusedId = new WmLaunchState
                {
                    TargetAppId = "9Ur5IzDKqV.TizenYouTube",
                    TargetLabel = "YouTube",
                    IsYoutubeTarget = true,
                    StartedAtMs = 6000
                };
                cmds.Clear();
                currentLayer = WmStackLogic.LayerShield;
                winsAboveTv =
                    "struct {\n uint32 2422\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 250\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 3100\n cobalt-app         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 118\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n";
                WmStackLogic.Step(fakeShell, false, false, false, false, ref active, ref probed, ref idleWinId, null, true, rapidYtReusedId, 6000);
                T.True(rapidYtReusedId.PreLaunchWinIds.Contains(3100), "snapshot captures initially visible dying cobalt-app 3100");
                cmds.Clear();
                // At +300 ms, -t hides cobalt-app 3100 (bools[1]=false) -> pruned from PreLaunchWinIds.
                winsAboveTv =
                    "struct {\n uint32 2422\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 3100\n cobalt-app         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean false\n boolean false\n}\n" +
                    "struct {\n uint32 118\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n";
                WmStackLogic.Step(fakeShell, false, false, false, false, ref active, ref probed, ref idleWinId, null, true, rapidYtReusedId, 6300);
                T.True(!rapidYtReusedId.PreLaunchWinIds.Contains(3100), "unmapped/hidden cobalt-app 3100 is pruned from PreLaunchWinIds");
                cmds.Clear();
                // At +1100 ms (<2200 ms), cobalt-app 3100 re-maps with Visible=true reusing WinId=3100 -> promotes immediately!
                winsAboveTv =
                    "struct {\n uint32 2422\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 3100\n cobalt-app         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 118\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n";
                WmStackLogic.Step(fakeShell, false, false, false, false, ref active, ref probed, ref idleWinId, null, true, rapidYtReusedId, 7100);
                T.True(cmds.Exists(c => c.Contains("SetWindowStack uint32:2422 uint32:3100 int32:0")), "re-mapped cobalt-app reusing WinId=3100 promotes immediately (<2.2s)");

                // Case 11 (#117b): Warm YouTube relaunch where cobalt-app (3200) NEVER unmaps stays covered <2200 ms, then promotes at >=2200 ms.
                var warmYtNeverUnmapped = new WmLaunchState
                {
                    TargetAppId = "9Ur5IzDKqV.TizenYouTube",
                    TargetLabel = "YouTube",
                    IsYoutubeTarget = true,
                    StartedAtMs = 8000
                };
                cmds.Clear();
                currentLayer = WmStackLogic.LayerShield;
                winsAboveTv =
                    "struct {\n uint32 2422\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 250\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 3200\n cobalt-app         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 118\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n";
                WmStackLogic.Step(fakeShell, false, false, false, false, ref active, ref probed, ref idleWinId, null, true, warmYtNeverUnmapped, 8000);
                cmds.Clear();
                winsAboveTv =
                    "struct {\n uint32 2422\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 3200\n cobalt-app         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 118\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n";
                WmStackLogic.Step(fakeShell, false, false, false, false, ref active, ref probed, ref idleWinId, null, true, warmYtNeverUnmapped, 9500);
                T.True(!cmds.Exists(c => c.Contains("SetWindowStack uint32:2422 uint32:3200 int32:0")), "continuously-mapped cobalt-app stays covered during <2200 ms restart hold");
                WmStackLogic.Step(fakeShell, false, false, false, false, ref active, ref probed, ref idleWinId, null, true, warmYtNeverUnmapped, 10250);
                T.True(cmds.Exists(c => c.Contains("SetWindowStack uint32:2422 uint32:3200 int32:0")), "continuously-mapped cobalt-app promotes above vetro-idle at >=2200 ms");

                // Case 12 (#129/#130): Enlightenment prev_fullscreen_appid dedup resync when relaunching the SAME app after force-close.
                // (a) YouTube -> force-close -> YouTube: Cobalt (3400) maps ALREADY above vetro-idle (topApp.Index < idleIndex) while
                //     vconf stays stuck on org.tizen.tv-viewer -> resyncs com.samsung.tv.cobalt-yt at >=250 ms -> Hide, stays hidden past +10s!
                string simVconfFull = IdleBackdropModel.TvViewerAppId;
                Func<string, string> vconfAwareShell = cmd =>
                {
                    if (cmd.StartsWith("/usr/bin/vconftool set -f -t string memory/appfw/current_fullscreen_appid ", StringComparison.Ordinal))
                    {
                        cmds.Add(cmd);
                        string rest = cmd.Substring("/usr/bin/vconftool set -f -t string memory/appfw/current_fullscreen_appid ".Length);
                        int sp = rest.IndexOf(' ');
                        simVconfFull = sp > 0 ? rest.Substring(0, sp) : rest.Trim();
                        return "";
                    }
                    return fakeShell(cmd);
                };
                Func<string> readSimVconf = () => simVconfFull;

                var ytSameAppModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "40"));
                ytSameAppModel.Evaluate(new TvSnapshot { SourceType = -1, FullscreenAppId = IdleBackdropModel.CobaltYouTubeAppId, DisplayState = 1, WmStackActive = true }, 10.0, false, false, false);
                T.Eq(ytSameAppModel.OnProactiveForceClose(20.0, IdleBackdropModel.CobaltYouTubeAppId), IdleAction.ShowWithDock, "force-close YouTube shows backdrop+Dock");
                ytSameAppModel.Evaluate(new TvSnapshot { SourceType = -1, FullscreenAppId = IdleBackdropModel.TvViewerAppId, DisplayState = 1, WmStackActive = true }, 20.5, true, false, false);
                ytSameAppModel.OnLaunchApp(22.0, IdleBackdropModel.ShardLaunchSuppressSeconds, IdleBackdropModel.WrapperYouTubeAppId);
                ytSameAppModel.Evaluate(new TvSnapshot { SourceType = -1, FullscreenAppId = IdleBackdropModel.TvViewerAppId, DisplayState = 1, WmStackActive = true }, 22.1, false, false, false);

                var ytResyncState = new WmLaunchState
                {
                    TargetAppId = IdleBackdropModel.WrapperYouTubeAppId,
                    TargetLabel = "YouTube",
                    LastForceClosedAppId = IdleBackdropModel.CobaltYouTubeAppId,
                    IsYoutubeTarget = true,
                    StartedAtMs = 12000
                };
                cmds.Clear();
                currentLayer = WmStackLogic.LayerShield;
                simVconfFull = IdleBackdropModel.TvViewerAppId;
                winsAboveTv =
                    "struct {\n uint32 2422\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 250\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 118\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n";
                WmStackLogic.Step(vconfAwareShell, false, false, false, false, ref active, ref probed, ref idleWinId, null, true, ytResyncState, 12000, readSimVconf);
                cmds.Clear();
                // Cobalt maps ALREADY above vetro-idle (index 0 < index 1), while Enlightenment suppresses vconf write (simVconfFull == org.tizen.tv-viewer).
                winsAboveTv =
                    "struct {\n uint32 3400\n cobalt-app         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 2422\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 118\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n";
                WmStackObservation ytObs;
                WmStackLogic.Step(vconfAwareShell, false, false, false, false, ref active, ref probed, ref idleWinId, out ytObs, null, true, ytResyncState, 13200, readSimVconf);
                WmStackLogic.Step(vconfAwareShell, false, false, false, false, ref active, ref probed, ref idleWinId, out ytObs, null, true, ytResyncState, 13320, readSimVconf);
                T.True(!cmds.Exists(c => c.Contains("vconftool set")), "waits 250 ms on top so Enlightenment gets first chance to update vconf natively");
                WmStackLogic.Step(vconfAwareShell, false, false, false, false, ref active, ref probed, ref idleWinId, out ytObs, null, true, ytResyncState, 13460, readSimVconf);
                T.True(ytObs.LaunchTargetReady, "LaunchTargetReady=true once Cobalt mapped above vetro-idle");
                T.Eq(simVconfFull, IdleBackdropModel.CobaltYouTubeAppId, "at >=250 ms resyncs vconf to com.samsung.tv.cobalt-yt when Cobalt mapped above vetro-idle");
                T.True(ytResyncState.VconfSynced, "marks VconfSynced=true after resync");
                T.True(ytSameAppModel.Evaluate(new TvSnapshot { SourceType = -1, FullscreenAppId = simVconfFull, DisplayState = 1, WmStackActive = true, WmLaunchTargetReady = ytObs.LaunchTargetReady }, 23.5, false, false, false) == IdleAction.Hide && !ytSameAppModel.Visible, "resynced vconf immediately triggers IdleAction.Hide");
                T.True(ytSameAppModel.Evaluate(new TvSnapshot { SourceType = -1, FullscreenAppId = simVconfFull, DisplayState = 1, WmStackActive = true, WmLaunchTargetReady = ytObs.LaunchTargetReady }, 27.0, false, false, false) == IdleAction.None && !ytSameAppModel.IsLaunchSuppressed(27.0), "3.0s dwell clears launch suppression cleanly");
                T.True(ytSameAppModel.Evaluate(new TvSnapshot { SourceType = -1, FullscreenAppId = simVconfFull, DisplayState = 1, WmStackActive = true, WmLaunchTargetReady = ytObs.LaunchTargetReady }, 33.0, false, false, false) == IdleAction.None && !ytSameAppModel.Visible, "stays hidden well past +8s/+11s without slamming ShowWithDock over YouTube video!");

                // (b) NuvioTV -> force-close -> NuvioTV: WRT app (3500) maps BELOW vetro-idle, gets raised via SetWindowStack,
                //     and vconf stays stuck on org.tizen.tv-viewer -> resyncs NuvioTV001.NuvioTV at >=250 ms -> Hide, stays hidden past +10s!
                var nuvioSameAppModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "40"));
                nuvioSameAppModel.Evaluate(new TvSnapshot { SourceType = -1, FullscreenAppId = "NuvioTV001.NuvioTV", DisplayState = 1, WmStackActive = true }, 40.0, false, false, false);
                T.Eq(nuvioSameAppModel.OnProactiveForceClose(50.0, "NuvioTV001.NuvioTV"), IdleAction.ShowWithDock, "force-close NuvioTV shows backdrop+Dock");
                nuvioSameAppModel.Evaluate(new TvSnapshot { SourceType = -1, FullscreenAppId = IdleBackdropModel.TvViewerAppId, DisplayState = 1, WmStackActive = true }, 50.4, true, false, false);
                nuvioSameAppModel.OnLaunchApp(52.0, IdleBackdropModel.LaunchSuppressSeconds, "NuvioTV001.NuvioTV");
                nuvioSameAppModel.Evaluate(new TvSnapshot { SourceType = -1, FullscreenAppId = IdleBackdropModel.TvViewerAppId, DisplayState = 1, WmStackActive = true }, 52.1, false, false, false);

                var nuvioResyncState = new WmLaunchState
                {
                    TargetAppId = "NuvioTV001.NuvioTV",
                    TargetLabel = "Nuvio TV",
                    LastForceClosedAppId = "NuvioTV001.NuvioTV",
                    IsYoutubeTarget = false,
                    StartedAtMs = 15000
                };
                cmds.Clear();
                currentLayer = WmStackLogic.LayerShield;
                simVconfFull = IdleBackdropModel.TvViewerAppId;
                winsAboveTv =
                    "struct {\n uint32 2422\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 250\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 118\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n";
                WmStackLogic.Step(vconfAwareShell, false, false, false, false, ref active, ref probed, ref idleWinId, null, true, nuvioResyncState, 15000, readSimVconf);
                cmds.Clear();
                winsAboveTv =
                    "struct {\n uint32 2422\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 3500\n Nuvio TV         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 118\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n";
                WmStackLogic.Step(vconfAwareShell, false, false, false, false, ref active, ref probed, ref idleWinId, null, true, nuvioResyncState, 16000, readSimVconf);
                T.True(cmds.Exists(c => c.Contains("SetWindowStack uint32:2422 uint32:3500 int32:0")), "raises Nuvio TV above vetro-idle");
                winsAboveTv =
                    "struct {\n uint32 3500\n Nuvio TV         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 2422\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 118\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n";
                WmStackObservation nuvioObs;
                WmStackLogic.Step(vconfAwareShell, false, false, false, false, ref active, ref probed, ref idleWinId, out nuvioObs, null, true, nuvioResyncState, 16260, readSimVconf);
                T.True(nuvioObs.LaunchTargetReady, "LaunchTargetReady=true once Nuvio TV mapped above vetro-idle");
                T.Eq(simVconfFull, "NuvioTV001.NuvioTV", "resyncs vconf to NuvioTV001.NuvioTV at >=250 ms after SetWindowStack");
                T.True(nuvioSameAppModel.Evaluate(new TvSnapshot { SourceType = -1, FullscreenAppId = simVconfFull, DisplayState = 1, WmStackActive = true, WmLaunchTargetReady = nuvioObs.LaunchTargetReady }, 53.3, false, false, false) == IdleAction.Hide && !nuvioSameAppModel.Visible, "NuvioTV hides vetro-idle immediately on resync");
                T.True(nuvioSameAppModel.Evaluate(new TvSnapshot { SourceType = -1, FullscreenAppId = simVconfFull, DisplayState = 1, WmStackActive = true, WmLaunchTargetReady = nuvioObs.LaunchTargetReady }, 55.0, false, false, false) == IdleAction.None && !nuvioSameAppModel.IsLaunchSuppressed(55.0), "NuvioTV 1.5s dwell clears launch suppression");
                T.True(nuvioSameAppModel.Evaluate(new TvSnapshot { SourceType = -1, FullscreenAppId = simVconfFull, DisplayState = 1, WmStackActive = true, WmLaunchTargetReady = nuvioObs.LaunchTargetReady }, 63.0, false, false, false) == IdleAction.None && !nuvioSameAppModel.Visible, "NuvioTV stays hidden well past +6s/+11s");

                // (c) When Enlightenment ALREADY updated vconf to a real app within 250 ms, VconfSynced does NOT overwrite vconf.
                var nativeUpdatedState = new WmLaunchState
                {
                    TargetAppId = "org.tizen.netflix-app",
                    TargetLabel = "Netflix",
                    LastForceClosedAppId = "NuvioTV001.NuvioTV",
                    IsYoutubeTarget = false,
                    StartedAtMs = 18000
                };
                cmds.Clear();
                currentLayer = WmStackLogic.LayerNormal;
                simVconfFull = "org.tizen.netflix-app";
                winsAboveTv =
                    "struct {\n uint32 2422\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 118\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n";
                WmStackLogic.Step(vconfAwareShell, false, false, false, false, ref active, ref probed, ref idleWinId, null, true, nativeUpdatedState, 18000, readSimVconf);
                cmds.Clear();
                winsAboveTv =
                    "struct {\n uint32 3600\n gibbon         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 2422\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 118\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n";
                WmStackLogic.Step(vconfAwareShell, false, false, false, false, ref active, ref probed, ref idleWinId, null, true, nativeUpdatedState, 18200, readSimVconf);
                WmStackLogic.Step(vconfAwareShell, false, false, false, false, ref active, ref probed, ref idleWinId, null, true, nativeUpdatedState, 18500, readSimVconf);
                T.True(nativeUpdatedState.VconfSynced && !cmds.Exists(c => c.Contains("vconftool set")), "never overwrites vconf when Enlightenment already set a real fullscreen appId");

                // Case 13 (#145): Samsung SmartHub EdenView window ("[WIND]Badak wind for EdenView App") is matched as guarded Samsung Home,
                // rejected by IsLayer200UserAppWindow, never triggers SetWindowStack(idleWin, edenWin, 0) during a YouTube launch,
                // and keeps vetro-idle ABOVE visible EdenView (SetWindowStack(idleWin, edenWin, 1)); hidden EdenView never shadows visible csfs.
                const string edenTitle = "[WIND]Badak wind for EdenView App";
                T.True(IdleBackdropModel.IsGuardedSamsungHomeWindow(edenTitle), "IsGuardedSamsungHomeWindow matches [WIND]Badak wind for EdenView App");
                WmStackLogic.WinInfo edenWin;
                T.True(WmStackLogic.TryParseWinInfo(" uint32 3450\n " + edenTitle + "         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}", 0, out edenWin)
                    && !WmStackLogic.IsLayer200UserAppWindow(edenWin), "EdenView 1920x1080 Layer-200 window is rejected by IsLayer200UserAppWindow");

                var ytEdenState = new WmLaunchState
                {
                    TargetAppId = IdleBackdropModel.WrapperYouTubeAppId,
                    TargetLabel = "YouTube",
                    IsYoutubeTarget = true,
                    StartedAtMs = 20000
                };
                cmds.Clear();
                currentLayer = WmStackLogic.LayerNormal;
                winsAboveTv =
                    "struct {\n uint32 2422\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 118\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n";
                WmStackLogic.Step(fakeShell, false, false, false, false, ref active, ref probed, ref idleWinId, null, true, ytEdenState, 20000);
                cmds.Clear();
                // Visible EdenView surfaces ABOVE vetro-idle during YouTube launch -> must NOT tuck vetro-idle below EdenView, must raise vetro-idle ABOVE EdenView!
                winsAboveTv =
                    "struct {\n uint32 3450\n " + edenTitle + "         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 2422\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 118\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n";
                WmStackLogic.Step(fakeShell, false, false, false, false, ref active, ref probed, ref idleWinId, null, true, ytEdenState, 20500);
                T.True(!cmds.Exists(c => c.Contains("SetWindowStack uint32:2422 uint32:3450 int32:0")), "YouTube launch NEVER places vetro-idle below EdenView");
                T.True(cmds.Exists(c => c.Contains("SetWindowStack uint32:2422 uint32:3450 int32:1")), "YouTube launch keeps vetro-idle ABOVE visible EdenView (int32:1)");

                // Hidden EdenView at index 0 must NOT shadow visible csfs.dll at index 1.
                cmds.Clear();
                winsAboveTv =
                    "struct {\n uint32 3450\n " + edenTitle + "         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean false\n boolean false\n}\n" +
                    "struct {\n uint32 3447\n /opt/usr/apps/com.samsung.tv.csfs/bin/csfs.dll         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 2422\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 118\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n";
                WmStackLogic.Step(fakeShell, false, false, false, false, ref active, ref probed, ref idleWinId, null, true, ytEdenState, 20700);
                T.True(cmds.Exists(c => c.Contains("SetWindowStack uint32:2422 uint32:3447 int32:1")), "hidden EdenView does not shadow visible csfs.dll (stacks vetro-idle above 3447)");

                // Case 14 (#157):
                // (a) Force-close cobalt-yt -> 1.3s later OnLaunchApp("NuvioTV001.NuvioTV") -> dying cobalt-yt pulse keeps Visible=true
                //     (NO IdleAction.Hide blink!), then NuvioTV001.NuvioTV hides vetro-idle and clears _teardownHoldAppId.
                var crossCloseModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "40"));
                crossCloseModel.Evaluate(new TvSnapshot { SourceType = -1, FullscreenAppId = IdleBackdropModel.CobaltYouTubeAppId, DisplayState = 1, WmStackActive = true }, 100.0, false, false, false);
                T.Eq(crossCloseModel.OnProactiveForceClose(110.0, IdleBackdropModel.CobaltYouTubeAppId), IdleAction.ShowWithDock, "force-close cobalt-yt shows backdrop+Dock");
                crossCloseModel.Evaluate(new TvSnapshot { SourceType = -1, FullscreenAppId = IdleBackdropModel.TvViewerAppId, DisplayState = 1, WmStackActive = true }, 110.2, true, false, false);
                crossCloseModel.OnLaunchApp(111.3, IdleBackdropModel.LaunchSuppressSeconds, "NuvioTV001.NuvioTV");
                T.Eq(crossCloseModel.TeardownHoldAppId, IdleBackdropModel.CobaltYouTubeAppId, "launching DIFFERENT app preserves dying cobalt-yt teardown hold");
                T.True(crossCloseModel.Evaluate(new TvSnapshot { SourceType = -1, FullscreenAppId = IdleBackdropModel.CobaltYouTubeAppId, DisplayState = 1, WmStackActive = true }, 111.7, false, false, false) == IdleAction.None && crossCloseModel.Visible, "dying cobalt-yt pulse at +1.7s never triggers Hide blink while NuvioTV launches");
                T.True(crossCloseModel.Evaluate(new TvSnapshot { SourceType = -1, FullscreenAppId = "NuvioTV001.NuvioTV", DisplayState = 1, WmStackActive = true, WmLaunchTargetReady = true }, 112.5, false, false, false) == IdleAction.Hide && !crossCloseModel.Visible && crossCloseModel.TeardownHoldAppId == "", "NuvioTV entering fullscreen cleanly hides vetro-idle and clears _teardownHoldAppId");

                // (b) Force-close cobalt-yt -> +2.2s VolUp (pill=true, full=cobalt-yt) stays Visible (TeardownHoldSeconds=4.0s, NO Hide blink!).
                var volTeardownModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "40"));
                volTeardownModel.Evaluate(new TvSnapshot { SourceType = -1, FullscreenAppId = IdleBackdropModel.CobaltYouTubeAppId, DisplayState = 1, WmStackActive = true }, 200.0, false, false, false);
                T.Eq(volTeardownModel.OnProactiveForceClose(210.0, IdleBackdropModel.CobaltYouTubeAppId), IdleAction.ShowWithDock, "force-close cobalt-yt");
                volTeardownModel.Evaluate(new TvSnapshot { SourceType = -1, FullscreenAppId = IdleBackdropModel.TvViewerAppId, DisplayState = 1, WmStackActive = true }, 210.3, false, false, false);
                T.True(volTeardownModel.Evaluate(new TvSnapshot { SourceType = -1, FullscreenAppId = IdleBackdropModel.CobaltYouTubeAppId, DisplayState = 1, WmStackActive = true }, 212.2, false, false, true) == IdleAction.None && volTeardownModel.Visible, "+2.2s VolUp (pill=true, full=cobalt-yt) stays Visible within 4.0s TeardownHoldSeconds");

                // (c) Warm NuvioTV -> YouTube (PreLaunchTopAppWinId = nuvioWin, cobaltWin raised to index 0) promotes immediately at elapsedMs=150 (<2200 ms).
                var warmNuvioToYt = new WmLaunchState
                {
                    TargetAppId = IdleBackdropModel.WrapperYouTubeAppId,
                    TargetLabel = "YouTube",
                    IsYoutubeTarget = true,
                    StartedAtMs = 25000
                };
                cmds.Clear();
                currentLayer = WmStackLogic.LayerNormal;
                winsAboveTv =
                    "struct {\n uint32 2422\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 3500\n Nuvio TV         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 3400\n cobalt-app         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 118\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n";
                WmStackLogic.Step(fakeShell, false, false, false, false, ref active, ref probed, ref idleWinId, null, true, warmNuvioToYt, 25000);
                T.Eq(warmNuvioToYt.PreLaunchTopAppWinId, 3500u, "snapshot records Nuvio TV (3500) as PreLaunchTopAppWinId");
                cmds.Clear();
                winsAboveTv =
                    "struct {\n uint32 2422\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 3400\n cobalt-app         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 3500\n Nuvio TV         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n" +
                    "struct {\n uint32 118\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}\n";
                WmStackLogic.Step(fakeShell, false, false, false, false, ref active, ref probed, ref idleWinId, null, true, warmNuvioToYt, 25150);
                T.True(cmds.Exists(c => c.Contains("SetWindowStack uint32:2422 uint32:3400 int32:0")), "warm NuvioTV -> YouTube promotes raised cobalt-app immediately at +150 ms (<2200 ms)");

                // (d) Launching app from HDMI (_lastKnownSource > 0) resets _lastKnownSource = 0 so CanClaimExitKey stays true.
                var hdmiModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "40"));
                hdmiModel.Evaluate(new TvSnapshot { SourceType = 1, FullscreenAppId = IdleBackdropModel.TvViewerAppId, DisplayState = 1, WmStackActive = true }, 300.0, false, false, false);
                T.Eq(hdmiModel.LastKnownSource, 1, "tracks HDMI sourceType=1");
                hdmiModel.OnLaunchApp(305.0, IdleBackdropModel.ShardLaunchSuppressSeconds, IdleBackdropModel.WrapperYouTubeAppId);
                T.True(hdmiModel.LastKnownSource == 0 && IdleBackdropModel.CanClaimExitKey(true, false, hdmiModel.LastKnownSource, false), "OnLaunchApp from HDMI resets LastKnownSource=0 so CanClaimExitKey stays true");
                hdmiModel.Evaluate(new TvSnapshot { SourceType = 2, FullscreenAppId = IdleBackdropModel.TvViewerAppId, DisplayState = 1, WmStackActive = true }, 310.0, false, false, false);
                hdmiModel.Evaluate(new TvSnapshot { SourceType = -1, FullscreenAppId = "NuvioTV001.NuvioTV", DisplayState = 1, WmStackActive = true }, 312.0, false, false, false);
                T.True(hdmiModel.LastKnownSource == 0 && IdleBackdropModel.CanClaimExitKey(true, false, hdmiModel.LastKnownSource, false), "fullscreen user app on SourceType=-1 resets LastKnownSource=0");
            });

            T.Run("idle: warm csfs preservation, 120s guarded-home screensaver hold, warm YouTube relaunch over csfs, and FIFO launch target parsing", () =>
            {
                string[] guardIds = HomeGuard.Parse("com.samsung.tv.csfs,com.samsung.tv.home.sidebar,com.samsung.tv.home.media");
                var warmTargets = IdleBackdropModel.FilterDismissHomeTargets(guardIds, "com.samsung.tv.csfs", true, Catalog.ValidAppId);
                T.True(warmTargets.Count == 2 && warmTargets[0] == "com.samsung.tv.home.sidebar" && warmTargets[1] == "com.samsung.tv.home.media", "warm csfs mode kills sidebar and media only, never csfs");
                var coldTargets = IdleBackdropModel.FilterDismissHomeTargets(guardIds, "com.samsung.tv.coba.newhome", false, Catalog.ValidAppId);
                T.True(coldTargets.Contains("com.samsung.tv.csfs") && coldTargets.Contains("com.samsung.tv.coba.newhome"), "fallback mode still kills csfs and coba.newhome");

                string warmGuardCmd = HomeGuard.Command(guardIds, "/home/owner/tvlauncher.guard", 5, true);
                T.True(!warmGuardCmd.Contains("-k com.samsung.tv.csfs")
                    && warmGuardCmd.Contains("-k com.samsung.tv.home.sidebar")
                    && warmGuardCmd.Contains("-k com.samsung.tv.home.media")
                    && warmGuardCmd.Contains("/usr/bin/app_launcher -s org.tizen.tv-viewer -u 5001")
                    && warmGuardCmd.Contains("/usr/bin/vconftool set -f -t string memory/appfw/current_fullscreen_appid org.tizen.tv-viewer"), "HomeGuard preserveCsfs=true pushes csfs behind tv-viewer and updates vconf without killing csfs");

                // 120s screensaver flag while guarded csfs is still reported as fullscreen must NEVER return IdleAction.Hide.
                var m120 = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                var csfsStart = new TvSnapshot { SourceType = -1, FullscreenAppId = "com.samsung.tv.csfs", PartialAppId = "", DisplayState = 1, WmStackActive = true };
                var csfsAt120 = new TvSnapshot { SourceType = -1, FullscreenAppId = "com.samsung.tv.csfs", PartialAppId = "", DisplayState = 1, WmStackActive = true, ScreensaverActive = true };
                T.Eq(m120.Evaluate(csfsStart, 10.0, false, false, false), IdleAction.ShowWithDock, "shows on csfs exit");
                T.True(m120.Evaluate(csfsAt120, 130.5, false, false, false) == IdleAction.None && m120.Visible, "never emits Hide at 120s while guarded csfs is still fullscreen");

                // Live-hardware Bug #2 repro: C1 cold YouTube launch followed <8s later by C2 warm YouTube relaunch where app_launcher -t
                // drops full from com.samsung.tv.cobalt-yt (!Visible) to warm com.samsung.tv.csfs at +1.2s inside the 8s window.
                var warmYt = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                var tvSnap0 = new TvSnapshot { SourceType = 0, FullscreenAppId = IdleBackdropModel.TvViewerAppId, PartialAppId = "", DisplayState = 1, WmStackActive = true };
                var ytFull = new TvSnapshot { SourceType = -1, FullscreenAppId = "com.samsung.tv.cobalt-yt", PartialAppId = "", DisplayState = 1, WmStackActive = true };
                var ytFullReady = new TvSnapshot { SourceType = -1, FullscreenAppId = "com.samsung.tv.cobalt-yt", PartialAppId = "", DisplayState = 1, WmStackActive = true, WmLaunchTargetReady = true };
                var csfsGap = new TvSnapshot { SourceType = -1, FullscreenAppId = "com.samsung.tv.csfs", PartialAppId = "", DisplayState = 1, WmStackActive = true };
                T.Eq(warmYt.Evaluate(tvSnap0, 40.0, false, false, false), IdleAction.ShowWithDock, "starts on Empty TV");
                warmYt.OnLaunchApp(41.0, IdleBackdropModel.ShardLaunchSuppressSeconds, "com.samsung.tv.cobalt-yt");
                T.Eq(warmYt.Evaluate(ytFullReady, 44.2, false, false, false), IdleAction.Hide, "C1 YouTube takes fullscreen at +3.2s");
                // 2.8s into C1 dwell (C1's 8s suppression still active until 49.0!), C2 warm YouTube relaunch starts at 47.0:
                warmYt.OnLaunchApp(47.0, IdleBackdropModel.ShardLaunchSuppressSeconds, "com.samsung.tv.cobalt-yt");
                T.True(warmYt.Evaluate(ytFull, 47.25, false, false, false) == IdleAction.None && !warmYt.Visible && warmYt.IsLaunchSuppressed(47.25), "C1 stale dwell never wipes C2 launch suppression while old Cobalt is still closing");
                T.True(warmYt.Evaluate(csfsGap, 48.24, false, false, false) == IdleAction.Show && warmYt.Visible && warmYt.IsLaunchSuppressed(48.24), "-t dropping to warm csfs inside 8s window returns IdleAction.Show (Layer-200 curtain, NEVER ShowWithDock!)");
                T.Eq(warmYt.GuardedHomeDyingAppId, "", "warm csfs gap during launch suppression never marks Cobalt as dying app");
                T.True(warmYt.Evaluate(csfsGap, 48.6, false, false, false) == IdleAction.None && warmYt.Visible && warmYt.IsLaunchSuppressed(48.6), "subsequent poll on warm csfs stays Visible with IdleAction.None");
                T.True(warmYt.Evaluate(ytFullReady, 49.9, false, false, false) == IdleAction.Hide && !warmYt.Visible && warmYt.IsLaunchSuppressed(49.9), "new Cobalt hides Layer-200 curtain cleanly and starts fresh 3.0s dwell");
                T.True(warmYt.Evaluate(ytFullReady, 53.0, false, false, false) == IdleAction.None && !warmYt.IsLaunchSuppressed(53.0), "clears 8s suppression after >=3.0s continuous dwell on new Cobalt");

                // CommandBuffer preserves exact mixed-case appId on FIFO launch command.
                var cb = new CommandBuffer();
                byte[] rawCmd = System.Text.Encoding.UTF8.GetBytes("launch 8 9Ur5IzDKqV.TizenYouTube YouTube\n");
                var parsedCmds = cb.Feed(rawCmd, rawCmd.Length);
                string parsedId, parsedLabel;
                double secs = CommandBuffer.ParseLaunchArgs(cb.TakeLaunchArgs(), 6.0, out parsedId, out parsedLabel);
                T.True(parsedCmds.Count == 1 && parsedCmds[0] == Command.Launch && secs == 8.0 && parsedId == "9Ur5IzDKqV.TizenYouTube" && parsedLabel == "YouTube", "FIFO launch preserves case-sensitive targetAppId and label");

                // #109: IdleConfig default NotificationLevel == 40 (Layer 250), CanClaimExitKey continuous claim across fullscreen apps,
                // and WmStackLogic ignoring 1x1 parked vetro-idle and sub-fullscreen (<1280x720) windows.
                T.Eq(IdleConfig.Parse("wallpaper", true, "0", null).NotificationLevel, 40, "IdleConfig defaults NotificationLevel to 40 (native Layer 250)");
                T.Eq(IdleConfig.Parse("aurora", false, "5", "").NotificationLevel, 40, "empty level string defaults NotificationLevel to 40");
                T.True(IdleBackdropModel.CanClaimExitKey(true, false, -1), "CanClaimExitKey stays true while user app is fullscreen (sourceType=-1)");
                T.True(IdleBackdropModel.CanClaimExitKey(true, false, 0), "CanClaimExitKey stays true on sourceType=0 Empty TV");
                T.True(!IdleBackdropModel.CanClaimExitKey(true, false, 13), "CanClaimExitKey releases XF86Exit on HDMI (sourceType > 0)");
                T.True(!IdleBackdropModel.CanClaimExitKey(true, true, 0), "CanClaimExitKey releases XF86Exit when Samsung Home is intentionally requested");
                T.True(!IdleBackdropModel.CanClaimExitKey(false, false, 0), "CanClaimExitKey is false when IdleMode == Off");
                T.True(!IdleBackdropModel.CanClaimExitKey(true, false, 0, true), "CanClaimExitKey releases XF86Exit when live RF tuner is active");

                WmStackLogic.WinInfo parkedIdle, smallOverlay, fullUserApp;
                T.True(WmStackLogic.TryParseWinInfo(" uint32 2828\n vetro-idle         int32 -16\n int32 -16\n int32 1\n int32 1\n int32 250\n boolean false\n boolean true\n boolean false\n}", 0, out parkedIdle), "parses 1x1 (-16,-16) parked vetro-idle");
                T.True(!WmStackLogic.IsLayer200UserAppWindow(parkedIdle), "1x1 parked vetro-idle is never treated as a Layer-200 user app");
                parkedIdle.Layer = WmStackLogic.LayerNormal;
                T.True(!WmStackLogic.IsLayer200UserAppWindow(parkedIdle), "even on Layer 200 after launch curtain, 1x1 parked vetro-idle is excluded");
                T.True(WmStackLogic.TryParseWinInfo(" uint32 2900\n MiniToast         int32 100\n int32 100\n int32 800\n int32 450\n int32 200\n boolean false\n boolean true\n boolean false\n}", 1, out smallOverlay) && !WmStackLogic.IsLayer200UserAppWindow(smallOverlay), "non-fullscreen (<1280x720) window is excluded from user app set");
                T.True(WmStackLogic.TryParseWinInfo(" uint32 2954\n Nuvio TV         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n}", 2, out fullUserApp) && WmStackLogic.IsLayer200UserAppWindow(fullUserApp), "1920x1080 Nuvio TV qualifies as Layer-200 user app");
            });

            T.Run("idle: GuardedHomeDyingAppId and BuildGuardedHomeRestoreCommand", () =>
            {
                var model = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                var browserSnap = new TvSnapshot { SourceType = -1, FullscreenAppId = "org.tizen.browser", PartialAppId = "", DisplayState = 1 };
                var csfsSnap = new TvSnapshot { SourceType = -1, FullscreenAppId = "com.samsung.tv.csfs", PartialAppId = "", DisplayState = 1 };
                var onTv = new TvSnapshot { SourceType = 0, FullscreenAppId = IdleBackdropModel.TvViewerAppId, PartialAppId = "", DisplayState = 1 };

                T.Eq(model.GuardedHomeDyingAppId, "", "starts empty");
                model.Evaluate(browserSnap, 10.0, false, false, false);
                model.Evaluate(csfsSnap, 11.0, false, false, false);
                T.Eq(model.GuardedHomeDyingAppId, "org.tizen.browser", "captures browser as dying app when guarded csfs opens");
                model.Evaluate(onTv, 12.0, true, false, false);
                T.Eq(model.GuardedHomeDyingAppId, "", "clears dying app once tv-viewer settles on source 0");

                T.Eq(IdleBackdropModel.BuildGuardedHomeRestoreCommand("startup", "org.tizen.browser", Catalog.ValidAppId, "", true), "", "startup sweep does not relaunch tv-viewer");
                T.Eq(IdleBackdropModel.BuildGuardedHomeRestoreCommand("", "org.tizen.browser", Catalog.ValidAppId, "", true), "", "empty fullApp is ignored");
                T.Eq(IdleBackdropModel.BuildGuardedHomeRestoreCommand(null, "org.tizen.browser", Catalog.ValidAppId, "", true), "", "null fullApp is ignored");
                T.Eq(IdleBackdropModel.BuildGuardedHomeRestoreCommand(IdleBackdropModel.TvViewerAppId, "org.tizen.browser", Catalog.ValidAppId, "", true), "", "already on tv-viewer does not relaunch tv-viewer");
                T.Eq(IdleBackdropModel.BuildGuardedHomeRestoreCommand("com.samsung.tv.home.art", "org.tizen.browser", Catalog.ValidAppId, "", true), "", "Art Mode is never restored away");

                string genPrefix = "[ \"$(cat '/home/owner/tvlauncher.guard' 2>/dev/null)\" = 3 ] || exit 0; ";
                string firstCmd = IdleBackdropModel.BuildGuardedHomeRestoreCommand("com.samsung.tv.csfs", "org.tizen.browser", Catalog.ValidAppId, genPrefix, true);
                T.True(firstCmd.StartsWith(genPrefix, System.StringComparison.Ordinal), "preserves guard generation check");
                T.True(firstCmd.Contains("vconftool get memory/appfw/current_fullscreen_appid"), "guards against racing a newly launched unrelated app");
                T.True(firstCmd.Contains("*com.samsung.tv.csfs*") && firstCmd.Contains("*org.tizen.browser*"), "matches csfs and dying browser app");
                T.True(firstCmd.Contains("/usr/bin/app_launcher -s org.tizen.tv-viewer -u 5001"), "restores tv-viewer to foreground so graceful stop completes");
                T.True(firstCmd.Contains("/usr/bin/vconftool set -f -t string memory/appfw/current_fullscreen_appid org.tizen.tv-viewer"), "syncs current_fullscreen_appid when Layer-250 Dock holds focus");

                string tailCmd = IdleBackdropModel.BuildGuardedHomeRestoreCommand("com.samsung.tv.csfs", "org.tizen.browser", Catalog.ValidAppId, genPrefix, false);
                T.True(tailCmd.Contains("*com.samsung.tv.csfs*") && !tailCmd.Contains("org.tizen.browser"), "tail check omits dying app so subsequent relaunch is never overridden");

                string unsafeDying = IdleBackdropModel.BuildGuardedHomeRestoreCommand("com.samsung.tv.csfs", "bad;rm -rf /", Catalog.ValidAppId, "", true);
                T.True(!unsafeDying.Contains("bad;rm") && unsafeDying.Contains("*com.samsung.tv.csfs*"), "rejects unsafe dyingApp characters while preserving csfs restore");

                string dupTv = IdleBackdropModel.BuildGuardedHomeRestoreCommand("com.samsung.tv.coba.newhome", IdleBackdropModel.TvViewerAppId, Catalog.ValidAppId, "", true);
                T.True(!dupTv.Contains("|*" + IdleBackdropModel.TvViewerAppId + "*") && dupTv.Contains("/usr/bin/vconftool set -f -t string memory/appfw/current_fullscreen_appid org.tizen.tv-viewer"), "does not add tv-viewer to case pattern list and updates vconf");
            });

            T.Run("idle: TeardownHoldAppId prevents transient Hide flicker after onTv and clears safely", () =>
            {
                var browserSnap = new TvSnapshot { SourceType = -1, FullscreenAppId = "org.tizen.browser", PartialAppId = "", DisplayState = 1 };
                var browserSrc0Snap = new TvSnapshot { SourceType = 0, FullscreenAppId = "org.tizen.browser", PartialAppId = "", DisplayState = 1 };
                var csfsSnap = new TvSnapshot { SourceType = -1, FullscreenAppId = "com.samsung.tv.csfs", PartialAppId = "", DisplayState = 1 };
                var onTv = new TvSnapshot { SourceType = 0, FullscreenAppId = IdleBackdropModel.TvViewerAppId, PartialAppId = "", DisplayState = 1 };
                var ytSnap = new TvSnapshot { SourceType = -1, FullscreenAppId = "org.tizen.cobalt-app", PartialAppId = "", DisplayState = 1 };
                var ssSnap = new TvSnapshot { SourceType = 0, FullscreenAppId = "org.tizen.browser", PartialAppId = "", DisplayState = 1, ScreensaverActive = true, ScreensaverProcessActive = true };

                var model = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                model.Evaluate(browserSnap, 10.0, false, false, false);
                T.Eq(model.Evaluate(csfsSnap, 11.0, false, false, false), IdleAction.ShowWithDock, "shows on csfs");
                T.Eq(model.TeardownHoldAppId, "org.tizen.browser", "captures browser in teardown hold");
                T.Eq(model.Evaluate(onTv, 11.2, true, false, false), IdleAction.None, "stays visible on tv-viewer");
                T.Eq(model.GuardedHomeDyingAppId, "", "clears public GuardedHomeDyingAppId on tv-viewer settle");
                T.Eq(model.TeardownHoldAppId, "org.tizen.browser", "retains internal teardown hold across tv-viewer settle");
                T.Eq(model.Evaluate(browserSnap, 12.4, true, false, false), IdleAction.None, "suppresses transient browser pulse (src=-1) within 2.5s");
                T.True(model.Visible, "remains visible after src=-1 pulse");
                T.Eq(model.Evaluate(browserSrc0Snap, 12.8, true, false, false), IdleAction.None, "suppresses transient browser pulse (src=0) within 2.5s");
                T.True(model.Visible, "remains visible after src=0 pulse");
                T.Eq(model.Evaluate(browserSnap, 13.5, true, false, false), IdleAction.Hide, "hides once teardown hold expires at >= 2.5s");
                T.Eq(model.TeardownHoldAppId, "", "clears teardown hold after expiry");

                // Different app clears teardown hold immediately
                var m2 = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                m2.Evaluate(browserSnap, 10.0, false, false, false);
                m2.Evaluate(csfsSnap, 11.0, false, false, false);
                m2.Evaluate(onTv, 11.2, true, false, false);
                T.Eq(m2.Evaluate(ytSnap, 11.5, false, false, false), IdleAction.Hide, "different app hides immediately");
                T.Eq(m2.TeardownHoldAppId, "", "different app clears teardown hold");

                // ScreensaverActive clears teardown hold and hides immediately
                var m3 = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                m3.Evaluate(browserSnap, 10.0, false, false, false);
                m3.Evaluate(csfsSnap, 11.0, false, false, false);
                m3.Evaluate(onTv, 11.2, true, false, false);
                T.Eq(m3.Evaluate(ssSnap, 11.5, false, false, false), IdleAction.Hide, "screensaver hides immediately despite browser id");
                T.Eq(m3.TeardownHoldAppId, "", "screensaver clears teardown hold");

                // OnLaunchApp clears teardown hold so explicit relaunch of same app hides immediately
                var m4 = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                m4.Evaluate(browserSnap, 10.0, false, false, false);
                m4.Evaluate(csfsSnap, 11.0, false, false, false);
                m4.Evaluate(onTv, 11.2, true, false, false);
                m4.OnLaunchApp(11.3);
                T.Eq(m4.TeardownHoldAppId, "", "OnLaunchApp clears teardown hold");
                T.Eq(m4.Evaluate(browserSnap, 11.6, false, false, false), IdleAction.Hide, "relaunched browser hides immediately after OnLaunchApp");
            });

            T.Run("idle: BuildReadAppPidCommand and BuildCloseStuckAppCommand validate and preserve preload recovery", () =>
            {
                T.Eq(IdleBackdropModel.BuildReadAppPidCommand("", Catalog.ValidAppId), "", "rejects empty appId");
                T.Eq(IdleBackdropModel.BuildReadAppPidCommand(null, Catalog.ValidAppId), "", "rejects null appId");
                T.Eq(IdleBackdropModel.BuildReadAppPidCommand(IdleBackdropModel.TvViewerAppId, Catalog.ValidAppId), "", "rejects tv-viewer");
                T.Eq(IdleBackdropModel.BuildReadAppPidCommand("com.samsung.tv.csfs", Catalog.ValidAppId), "", "rejects guarded home");
                T.Eq(IdleBackdropModel.BuildReadAppPidCommand("bad;id", Catalog.ValidAppId), "", "rejects unsafe appId");

                string readCmd = IdleBackdropModel.BuildReadAppPidCommand("org.tizen.browser", Catalog.ValidAppId);
                T.True(readCmd.Contains("/usr/bin/app_launcher -S") && readCmd.Contains("awk -v a='org.tizen.browser'"), "builds exact app_launcher -S awk reader");

                T.Eq(IdleBackdropModel.BuildCloseStuckAppCommand("org.tizen.browser", "", Catalog.ValidAppId, ""), "", "rejects empty pid");
                T.Eq(IdleBackdropModel.BuildCloseStuckAppCommand("org.tizen.browser", "0", Catalog.ValidAppId, ""), "", "rejects zero pid");
                T.Eq(IdleBackdropModel.BuildCloseStuckAppCommand("org.tizen.browser", "123;rm", Catalog.ValidAppId, ""), "", "rejects non-digit pid");
                T.Eq(IdleBackdropModel.BuildCloseStuckAppCommand("bad;id", "1234", Catalog.ValidAppId, ""), "", "rejects invalid appId");

                string genPrefix = "[ \"$(cat '/home/owner/tvlauncher.guard' 2>/dev/null)\" = 4 ] || exit 0; ";
                string closeCmd = IdleBackdropModel.BuildCloseStuckAppCommand("org.tizen.browser", "15842", Catalog.ValidAppId, genPrefix);
                T.True(closeCmd.StartsWith(genPrefix, System.StringComparison.Ordinal), "prepends guard generation check");
                T.True(closeCmd.Contains("dp=15842; cur=$("), "captures live PID for comparison against original dying PID");
                T.True(closeCmd.Contains("\"$cur\" = \"$dp\""), "only kills if live PID still matches original dying PID");
                T.True(closeCmd.Contains("/usr/bin/app_launcher -k org.tizen.browser"), "kills stuck app via app_launcher -k");
                T.True(closeCmd.Contains("/usr/bin/app_launcher -s org.tizen.tv-viewer"), "restores tv-viewer if fullscreen app matches dying app or guarded home");
                T.True(closeCmd.Contains("echo KILLED; fi"), "emits KILLED marker when stuck PID is terminated");
            });

            T.Run("idle: GuardedHomeCloseTracker prevents duplicate close and protects respawned preload recovery across retries", () =>
            {
                var tracker = new GuardedHomeCloseTracker();
                T.True(!tracker.TryBegin(0, "", true, "com.samsung.tv.csfs"), "rejects empty dyingApp");
                T.True(!tracker.TryBegin(0, "org.tizen.browser", false, "com.samsung.tv.csfs"), "rejects when allowCloseDying is false");

                // Attempt 1 captures PID cleanly; Attempt 2 (2s later) while in-flight OR after PID capture must not re-capture recovery PID
                T.True(tracker.TryBegin(1, "org.tizen.browser", true, "com.samsung.tv.csfs"), "Attempt 1 begins close tracking");
                T.True(!tracker.TryBegin(1, "org.tizen.browser", true, "com.samsung.tv.csfs"), "Attempt 2 rejected while Attempt 1 is in-flight");
                tracker.MarkPidCaptured(1, "org.tizen.browser", "15651");
                T.True(!tracker.TryBegin(1, "org.tizen.browser", true, "com.samsung.tv.csfs"), "still rejected while waiting for kill");
                tracker.MarkCompleted(1, "org.tizen.browser");
                T.True(!tracker.TryBegin(1, "org.tizen.browser", true, "com.samsung.tv.csfs"), "Attempt 2 after completion does not re-capture background preload PID while csfs is fullscreen");

                // If dyingApp itself stays/returns fullscreen with partial guarded home, another close attempt IS allowed
                T.True(tracker.TryBegin(1, "org.tizen.browser", true, "org.tizen.browser"), "allows retry if dyingApp itself is still fullscreen");
                tracker.MarkCompleted(1, "org.tizen.browser");

                // If Attempt 1 failed to capture a PID (empty string), Attempt 2 may retry capture
                T.True(tracker.TryBegin(2, "org.tizen.browser", true, "com.samsung.tv.csfs"), "new restore generation starts fresh");
                tracker.MarkPidCaptured(2, "org.tizen.browser", "");
                T.True(tracker.TryBegin(2, "org.tizen.browser", true, "com.samsung.tv.csfs"), "retries PID capture if initial read returned empty");

                // Reset (e.g. launch/cancel) allows subsequent teardown on same or next generation
                tracker.MarkPidCaptured(2, "org.tizen.browser", "22222");
                tracker.Reset();
                T.True(tracker.TryBegin(2, "org.tizen.browser", true, "com.samsung.tv.csfs"), "Reset clears prior episode state");
            });

            T.Run("idle: AmbientLakeEngine sub-pixel PadPixels, continuous motion, UV bounds, and AnimClock smoothing", () =>
            {
                // Transparent padding adds exact zero-alpha border
                uint[] orb = IdleBackdropModel.BuildBokehPixels(24, false);
                uint[] padded = IdleBackdropModel.PadPixels(orb, 24, 24, 3);
                T.Eq(padded.Length, 30 * 30, "padded bokeh is 30x30");
                T.Eq(padded[0], 0u, "outer padding corner is transparent black");
                T.Eq(padded[15 * 30 + 15], orb[12 * 24 + 12], "center pixel preserved after padding");

                // Lake continuous motion + periodic UV stays strictly inside tiled safe bounds across wrap
                double maxSwellU = AmbientLakeEngine.SwellTileW * AmbientLakeEngine.SwellRepeatX;
                double maxSwellV = AmbientLakeEngine.SwellTileH * AmbientLakeEngine.SwellRepeatY;
                double maxRippleU = AmbientLakeEngine.RippleTileW * AmbientLakeEngine.RippleRepeatX;
                double maxRippleV = AmbientLakeEngine.RippleTileH * AmbientLakeEngine.RippleRepeatY;
                for (double tMs = 0.0; tMs <= 400000.0; tMs += 1373.1)
                {
                    AmbientLakeEngine.LakeRenderFrame lf;
                    AmbientLakeEngine.ComputeFrame(tMs, 1920, 1080, false, out lf);
                    T.True(lf.SwellU0 >= 1.0 && lf.SwellU1 <= maxSwellU && lf.SwellV0 >= 1.0 && lf.SwellV1 <= maxSwellV, "Lake Swell UV stays strictly inside tiled periodic safe region");
                    T.True(lf.RippleU0 >= 1.0 && lf.RippleU1 <= maxRippleU && lf.RippleV0 >= 1.0 && lf.RippleV1 <= maxRippleV, "Lake Ripple UV stays strictly inside tiled periodic safe region");
                    T.True(lf.PortalX >= 0 && lf.PortalX + lf.PortalW <= 1920 && lf.PortalY >= 0 && lf.PortalY + lf.PortalH <= 1080, "Lake portal stays inside 1080p screen");
                }

                // Every 16.7 ms frame advances sub-pixel Lake, Silk Ribbon, and slow Mote continuously
                AmbientLakeEngine.LakeRenderFrame lfA, lfB;
                AmbientLakeEngine.ComputeFrame(10000.0, 1920, 1080, false, out lfA);
                AmbientLakeEngine.ComputeFrame(10016.67, 1920, 1080, false, out lfB);
                T.True(Math.Abs(lfB.SwellV0 - lfA.SwellV0) > 0.001 || Math.Abs(lfB.SwellU0 - lfA.SwellU0) > 0.001, "AmbientLakeEngine moves smoothly sub-pixel on a single 16.7 ms frame");

                IdleBackdropModel.AuroraRibbonMotion rmA, rmB;
                AmbientLakeEngine.ComputeAuroraRibbonMotion(0, 10000.0, 1920, 1080, false, out rmA);
                AmbientLakeEngine.ComputeAuroraRibbonMotion(0, 10016.67, 1920, 1080, false, out rmB);
                T.True(Math.Abs(rmB.X - rmA.X) > 0.01 && Math.Abs(rmB.X - rmA.X) < 1.0, "Aurora ribbon moves continuously every frame");

                IdleBackdropModel.MoteMotion mmA, mmB;
                AmbientLakeEngine.ComputeAuroraMoteMotion(5, 19000.0, 1920, 1080, false, out mmA);
                AmbientLakeEngine.ComputeAuroraMoteMotion(5, 19016.67, 1920, 1080, false, out mmB);
                T.True(mmA.Alpha > 20 && (Math.Abs(mmB.X - mmA.X) > 0.005 || Math.Abs(mmB.Y - mmA.Y) > 0.005), "Aurora mote moves smoothly every 16.7 ms frame without quantization jumps");

                // Sub-pixel quad maintains world-space continuity across integer pixel boundary (99.999 -> 100.001)
                IdleBackdropModel.SubpixelQuad qBefore, qAfter;
                IdleBackdropModel.ComputeSpriteSubpixelQuad(99.999, 50.25, 75.0, 75.0, 32, 32, 3, 38, 38, out qBefore);
                IdleBackdropModel.ComputeSpriteSubpixelQuad(100.001, 50.25, 75.0, 75.0, 32, 32, 3, 38, 38, out qAfter);
                T.Eq(qBefore.X, 99, "floor 99.999 is 99");
                T.Eq(qAfter.X, 100, "floor 100.001 is 100");
                double uAt150Before = qBefore.U0 + (150.5 - qBefore.X) * ((qBefore.U1 - qBefore.U0) / qBefore.W);
                double uAt150After = qAfter.U0 + (150.5 - qAfter.X) * ((qAfter.U1 - qAfter.U0) / qAfter.W);
                T.True(Math.Abs(uAt150Before - uAt150After) < 0.002, "world-space texture coordinate is continuous across integer pixel crossing");
                T.True(qBefore.U0 > 0.5 && qBefore.U1 < 37.5 && qAfter.U0 > 0.5 && qAfter.U1 < 37.5, "padded mote UV stays safely away from texture border");

                // AnimClock absorbs callback wakeup jitter (+5ms / -5ms) while locking onto 50 Hz PAL refresh
                var clk = new AnimClock(1.0 / 60.0, 0.05);
                double rdt; bool real;
                clk.Step(0.0, out rdt, out real);
                T.True(!real, "first AnimClock sample reports synthetic initial step");
                double t = 0.0;
                for (int i = 1; i <= 60; i++)
                {
                    t += 0.020; // 50 Hz display
                    double jitter = (i % 2 == 0) ? 0.004 : -0.004;
                    double dt = clk.Step(t + jitter, out rdt, out real);
                    T.True(real, "subsequent ticks report real elapsed dt");
                    if (i > 20) T.True(Math.Abs(dt - 0.020) < 0.0015, "50 Hz locked AnimClock absorbs +/-4ms callback jitter cleanly");
                }
                T.True(Math.Abs(clk.PeriodEstimate - 0.020) < 0.001, "AnimClock converges to 50 Hz period estimate");
                double stallDt = clk.Step(t + 1.5, out rdt, out real);
                T.True(Math.Abs(stallDt - 0.05) < 1e-6, "AnimClock caps post-stall step at maxStep=0.05");

                // TryStep filters duplicate <45%-period queued bursts without corrupting phase or double-stepping
                var burstClk = new AnimClock(0.020, 0.05);
                double bdt;
                T.True(burstClk.TryStep(1.000, out bdt, out rdt, out real), "initial TryStep accepted");
                T.True(burstClk.TryStep(1.020, out bdt, out rdt, out real), "20ms TryStep accepted");
                T.True(!burstClk.TryStep(1.0201, out bdt, out rdt, out real), "0.1ms queued burst TryStep filtered out");
                T.True(Math.Abs(bdt) < 1e-9, "filtered burst advances zero anim time");
                T.True(burstClk.TryStep(1.040, out bdt, out rdt, out real), "next 20ms vblank after burst accepted");
                T.True(Math.Abs(rdt - 0.020) < 1e-6 && Math.Abs(bdt - 0.020) < 0.001, "real interval preserved after skipped burst");

                // 640x360 proxy portal size & UV stays strictly inside safe periodic interior
                AmbientLakeEngine.LakeRenderFrame pLf;
                AmbientLakeEngine.ComputeFrame(123456.7, 640, 360, false, out pLf);
                T.True(pLf.PortalW >= 128 && pLf.PortalH >= 80 && pLf.RippleU0 >= 1.0 && pLf.RippleU1 <= maxRippleU, "640x360 proxy AmbientLakeEngine portal and Ripple UV stay inside safe bounds");
            });

            T.Run("Unified #107/#108: Layer 500 overlays, tvBoundaryIndex Icon=1, launch-gated Launchscreen, combined screensaver, and TaskApp alias", () =>
            {
                // 1. LayerOverlay (500) promotion for visible + hidden overlays strictly before LayerShield (250), skipping cross-layer SetWindowStack once >=500 confirmed.
                var cmds = new List<string>();
                int idleLayer = WmStackLogic.LayerNormal;
                var winLayers = new Dictionary<uint, int> { { 1554u, 200 }, { 962u, 250 }, { 964u, 250 }, { 965u, 250 } };
                string wins =
                    "struct {\n uint32 962\n tvlauncher         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 250\n boolean false\n boolean true\n boolean true\n}\n" +
                    "struct {\n uint32 964\n vetro-numpad         int32 0\n int32 0\n int32 400\n int32 400\n int32 250\n boolean true\n boolean false\n boolean false\n}\n" +
                    "struct {\n uint32 965\n vetro-volume         int32 0\n int32 0\n int32 120\n int32 400\n int32 250\n boolean true\n boolean false\n boolean false\n}\n" +
                    "struct {\n uint32 1554\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean true\n}\n" +
                    "struct {\n uint32 1\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean true\n}\n";
                Func<string, string> layer500Shell = cmd =>
                {
                    cmds.Add(cmd);
                    if (cmd.Contains("GetWinsInfo")) return wins;
                    if (cmd.Contains("GetWindowNotiLevel"))
                    {
                        foreach (var kv in winLayers)
                            if (cmd.Contains("uint32:" + kv.Key)) return "int32 " + kv.Value;
                        return "int32 " + idleLayer;
                    }
                    if (cmd.Contains("SetWindowNotiLevel"))
                    {
                        foreach (uint wid in new[] { 962u, 964u, 965u, 1554u })
                        {
                            if (cmd.Contains("uint32:" + wid + " int32:500")) winLayers[wid] = 500;
                            else if (cmd.Contains("uint32:" + wid + " int32:250")) { winLayers[wid] = 250; if (wid == 1554u) idleLayer = 250; }
                            else if (cmd.Contains("uint32:" + wid + " int32:200")) { winLayers[wid] = 200; if (wid == 1554u) idleLayer = 200; }
                        }
                        return "";
                    }
                    return "";
                };
                bool active = true, probed = true;
                uint idleWinId = 1554;
                WmStackObservation obs;
                WmStackLogic.Step(layer500Shell, false, false, false, true, ref active, ref probed, ref idleWinId, out obs, null);
                int promoIdx = cmds.FindIndex(c => c.Contains("uint32:962 int32:500") && c.Contains("uint32:964 int32:500") && c.Contains("uint32:965 int32:500"));
                int shieldIdx = cmds.FindIndex(c => c.Contains("uint32:1554 int32:250"));
                T.True(promoIdx >= 0 && shieldIdx > promoIdx, "promotes all overlays (visible + hidden) to Layer 500 in one chained call strictly before vetro-idle promotes to Layer 250");
                T.True(!cmds.Exists(c => c.Contains("SetWindowStack uint32:1554 uint32:962")), "skips cross-layer SetWindowStack once tvlauncher confirms Layer 500");

                // 2. Deterministic ShouldContinueWorker Layer-200 restore when shield expires mid-Step + 120 ms launch cadence.
                int sleepMs;
                T.True(WmStackLogic.ShouldContinueWorker(false, -100, -50, 0, true, false, out sleepMs) && sleepMs == 0, "runs immediate final pass (sleepMs=0) when shield expires mid-Step");
                T.True(!WmStackLogic.ShouldContinueWorker(false, -100, -50, 0, false, false, out sleepMs), "exits cleanly once restored to Layer 200");
                T.True(WmStackLogic.ShouldContinueWorker(false, 0, 0, 5000, false, false, out sleepMs) && sleepMs == 120, "uses 120 ms cadence during active app launch");

                // 3. Two-pass tvBoundaryIndex occlusion fix: Icon=1 single-surface WRT app (Player / Nuvio TV / browser) above tv-viewer
                //    sets ActiveAppWinPresent=true, while background/prelaunched app below tv-viewer sets ActiveAppWinPresent=false.
                cmds.Clear();
                idleLayer = WmStackLogic.LayerNormal;
                winLayers[1554u] = 200;
                wins =
                    "struct {\n uint32 1554\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean true\n int32 0\n int32 0\n int32 0\n}\n" +
                    "struct {\n uint32 2610\n Player         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n int32 0\n int32 0\n int32 1\n}\n" +
                    "struct {\n uint32 118\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n int32 0\n int32 0\n int32 1\n}\n" +
                    "struct {\n uint32 900\n org.tizen.browser         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n int32 0\n int32 0\n int32 1\n}\n";
                WmStackLogic.Step(layer500Shell, false, false, false, false, ref active, ref probed, ref idleWinId, out obs, null);
                T.True(obs.Observed && obs.ActiveAppWinPresent && !obs.GuardedHomeWinPresent, "recognizes occluded Icon=1 Player strictly above tv-viewer as ActiveAppWinPresent");

                wins =
                    "struct {\n uint32 1554\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean true\n int32 0\n int32 0\n int32 0\n}\n" +
                    "struct {\n uint32 118\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n int32 0\n int32 0\n int32 1\n}\n" +
                    "struct {\n uint32 900\n org.tizen.browser         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean false\n int32 0\n int32 0\n int32 1\n}\n";
                WmStackLogic.Step(layer500Shell, false, false, false, false, ref active, ref probed, ref idleWinId, out obs, null);
                T.True(obs.Observed && !obs.ActiveAppWinPresent, "excludes background preloaded browser below tv-viewer from ActiveAppWinPresent");

                // ShouldDismissGuardedHome breaks infinite loop when vconf is frozen on csfs while WM confirms !WmGuardedHomePresent.
                var loopModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "40"));
                var frozenCsfsGone = new TvSnapshot { SourceType = -1, FullscreenAppId = "com.samsung.tv.csfs", DisplayState = 1, WmStackActive = true, WmStateObserved = true, WmGuardedHomePresent = false };
                T.True(!loopModel.ShouldDismissGuardedHome(frozenCsfsGone, 100.0), "stops dismiss loop when WM confirms csfs is no longer mapped");
                var wmEdenMapped = new TvSnapshot { SourceType = -1, FullscreenAppId = "com.samsung.tv.cobalt-yt", DisplayState = 1, WmStackActive = true, WmStateObserved = true, WmGuardedHomePresent = true };
                T.True(loopModel.ShouldDismissGuardedHome(wmEdenMapped, 100.5), "fires dismiss immediately when WM observes guarded home/EdenView despite frozen vconf");

                // 4. Launch-gated Launchscreen Winsys (#108 Finding #1): during launchingApp=true with WmLaunchState, stacks vetro-idle
                //    below Launchscreen Winsys WITHOUT triggering premature VconfResync before the real app maps.
                var lsLaunchState = new WmLaunchState
                {
                    TargetAppId = "NuvioTV001.NuvioTV",
                    TargetLabel = "Nuvio TV",
                    IsYoutubeTarget = false,
                    StartedAtMs = 30000
                };
                string simFull = IdleBackdropModel.TvViewerAppId;
                Func<string, string> lsVconfShell = cmd =>
                {
                    if (cmd.Contains("vconftool set")) { cmds.Add(cmd); simFull = "OVERWRITTEN"; return ""; }
                    return layer500Shell(cmd);
                };
                cmds.Clear();
                idleLayer = WmStackLogic.LayerNormal;
                winLayers[1554u] = 200;
                wins =
                    "struct {\n uint32 1554\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean true\n}\n" +
                    "struct {\n uint32 118\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean true\n}\n";
                WmStackLogic.Step(lsVconfShell, false, false, false, false, ref active, ref probed, ref idleWinId, out obs, null, true, lsLaunchState, 30000, () => simFull);
                cmds.Clear();
                wins =
                    "struct {\n uint32 1554\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean true\n}\n" +
                    "struct {\n uint32 1702\n Launchscreen Winsys         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean true\n}\n" +
                    "struct {\n uint32 118\n tv-viewer         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 200\n boolean false\n boolean true\n boolean true\n}\n";
                WmStackLogic.Step(lsVconfShell, false, false, false, false, ref active, ref probed, ref idleWinId, out obs, null, true, lsLaunchState, 30100, () => simFull);
                T.True(obs.LaunchscreenWinPresent && !obs.LaunchTargetReady && cmds.Exists(c => c.Contains("SetWindowStack uint32:1554 uint32:1702 int32:0")), "stacks vetro-idle strictly below Launchscreen Winsys during app launch with LaunchTargetReady=false");
                WmStackLogic.Step(lsVconfShell, false, false, false, false, ref active, ref probed, ref idleWinId, out obs, null, true, lsLaunchState, 30500, () => simFull);
                T.Eq(simFull, IdleBackdropModel.TvViewerAppId, "Launchscreen Winsys alone never triggers premature VconfResync");

                // 5. Unified Screensaver Reconciliation (#124 Section 1):
                //    - Phantom 126.7s screensaver_on_off=True (no /proc process, full=tv-viewer, !wmSs) -> stays Visible (ZERO blink, !HoldOcclusionForScreensaver).
                //    - Real Layer-900 /proc glscreensaver (ScreensaverProcessActive=true, full=tv-viewer) -> parks with HoldOcclusionForScreensaver=true!
                //    - Real Layer-200/900 WM screensaver window (WmScreensaverWinPresent=true) -> parks with HoldOcclusionForScreensaver=true!
                var ssCombined = new IdleBackdropModel(IdleConfig.Parse("wallpaper", false, "0", "40"));
                var idleC1 = new TvSnapshot { SourceType = 0, FullscreenAppId = IdleBackdropModel.TvViewerAppId, DisplayState = 1, WmStackActive = true, WmStateObserved = true, WmActiveAppPresent = false };
                T.Eq(ssCombined.Evaluate(idleC1, 100.0, false, false, false), IdleAction.Show, "C1 idle backdrop starts visible");
                var phantomSs = idleC1;
                phantomSs.ScreensaverActive = true;
                phantomSs.ScreensaverProcessActive = false;
                phantomSs.WmScreensaverWinPresent = false;
                T.Eq(ssCombined.Evaluate(phantomSs, 226.7, false, false, false), IdleAction.None, "ignores phantom 126.7s screensaver_on_off=True when no /proc screensaver and !wmSs");
                T.True(ssCombined.Visible && !ssCombined.HoldOcclusionForScreensaver, "stays visible without occlusion parking across phantom 126.7s screensaver pulse");

                var realProcSs = phantomSs;
                realProcSs.ScreensaverProcessActive = true;
                T.Eq(ssCombined.Evaluate(realProcSs, 230.0, false, false, false), IdleAction.Hide, "real Layer-900 /proc glscreensaver parks vetro-idle immediately even when full=tv-viewer");
                T.True(!ssCombined.Visible && ssCombined.HoldOcclusionForScreensaver, "holds Wayland black occlusion while Layer-900 /proc screensaver runs over Empty TV");
                T.Eq(ssCombined.Evaluate(idleC1, 240.0, false, false, false), IdleAction.Show, "restores cleanly when real /proc screensaver ends");
                T.True(ssCombined.Visible && !ssCombined.HoldOcclusionForScreensaver, "clears occlusion hold when screensaver ends");

                var realWinSs = phantomSs;
                realWinSs.WmScreensaverWinPresent = true;
                T.Eq(ssCombined.Evaluate(realWinSs, 250.0, false, false, false), IdleAction.Hide, "real WM screensaver window (WmScreensaverWinPresent=True) parks vetro-idle immediately");
                T.True(!ssCombined.Visible && ssCombined.HoldOcclusionForScreensaver, "holds Wayland black occlusion while WM screensaver window runs over Empty TV");

                // ScreensaverPulseFilter 5.0s confirm threshold.
                var filter = new ScreensaverPulseFilter();
                T.Eq(ScreensaverPulseFilter.ConfirmSeconds, 5.0, "ScreensaverPulseFilter ConfirmSeconds == 5.0");
                T.True(!filter.Update(true, true, 1000.0) && filter.IsPending, "pulse filter enters pending on rising edge");
                T.True(!filter.Update(true, true, 1004.5) && filter.IsPending, "pulse filter stays pending below 5.0s");
                T.True(filter.Update(true, true, 1005.1) && !filter.IsPending, "pulse filter confirms at >=5.0s");
                T.True(!filter.Update(false, true, 1006.0) && !filter.IsPending, "pulse filter resets on falling edge");

                // 6. ShouldRaiseIdleWindow, ComputeGuardedHomeActive, and TaskAppMatchesEntry YouTube alias.
                T.True(IdleBackdropModel.ShouldRaiseIdleWindow(false, false, false), "allows raise when dock/pad/pill all closed");
                T.True(!IdleBackdropModel.ShouldRaiseIdleWindow(true, false, false), "blocks raise while dock open");
                T.True(!IdleBackdropModel.ShouldRaiseIdleWindow(false, true, false), "blocks raise while numpad open");
                T.True(!IdleBackdropModel.ShouldRaiseIdleWindow(false, false, true), "blocks raise while volume pill open");
                T.True(IdleBackdropModel.ComputeGuardedHomeActive(false, "com.samsung.tv.cobalt-yt", "", true, true), "ComputeGuardedHomeActive honors WM guarded home despite frozen vconf");
                T.True(!IdleBackdropModel.ComputeGuardedHomeActive(false, "com.samsung.tv.csfs", "", true, false), "ComputeGuardedHomeActive clears when WM confirms csfs is gone");
                T.True(IdleBackdropModel.TaskAppMatchesEntry("com.samsung.tv.cobalt-yt", "9Ur5IzDKqV.TizenYouTube"), "TaskAppMatchesEntry aliases running cobalt-yt to YouTube catalog entry");
                T.True(IdleBackdropModel.TaskAppMatchesEntry("uW3QTCzW3B.Player", "uW3QTCzW3B.Player"), "TaskAppMatchesEntry matches identical app IDs");
                T.True(!IdleBackdropModel.TaskAppMatchesEntry("com.samsung.tv.cobalt-yt", "uW3QTCzW3B.Player"), "TaskAppMatchesEntry rejects unrelated app");
            });

            T.Run("idle: Tizen 9 spotlight-ss screensaver occlusion hold, WmStack layer drop, cold-boot silent csfs & fast-poll gate", () =>
            {
                // 1. Screensaver app & window matchers across Tizen 4/5.5/6/8/9
                T.True(IdleBackdropModel.IsScreensaverApp("com.samsung.tv.spotlight-ss"), "matches Tizen 9 spotlight-ss");
                T.True(IdleBackdropModel.IsScreensaverApp("com.samsung.tv.glscreensaver-launcher"), "matches glscreensaver-launcher");
                T.True(IdleBackdropModel.IsScreensaverApp("org.tizen.rscm-screensaver"), "matches rscm-screensaver");
                T.True(IdleBackdropModel.IsScreensaverApp("org.tizen.screen-saver"), "matches org.tizen.screen-saver");
                T.True(!IdleBackdropModel.IsScreensaverApp(IdleBackdropModel.TvViewerAppId)
                    && !IdleBackdropModel.IsScreensaverApp("com.samsung.tv.csfs")
                    && !IdleBackdropModel.IsScreensaverApp("com.samsung.tv.cobalt-yt")
                    && !IdleBackdropModel.IsScreensaverApp("")
                    && !IdleBackdropModel.IsScreensaverApp(null), "rejects non-screensaver apps and empty/null");
                T.True(IdleBackdropModel.IsScreensaverWindow("Default_Screensaver")
                    && IdleBackdropModel.IsScreensaverWindow("ScreenSaverContent")
                    && IdleBackdropModel.IsScreensaverWindow("/opt/usr/apps/com.samsung.tv.spotlight-ss/bin/spotlight-ss.dll")
                    && !IdleBackdropModel.IsScreensaverWindow("tv-viewer")
                    && !IdleBackdropModel.IsScreensaverWindow(""), "IsScreensaverWindow matches Default_Screensaver, ScreenSaverContent, and spotlight-ss window paths");

                // 2. HoldOcclusionForScreensaver lifecycle over Empty TV (prevents Enlightenment eval_visibility kill & unwanted AutoDock reopen)
                var onTv = new TvSnapshot { SourceType = 0, FullscreenAppId = IdleBackdropModel.TvViewerAppId, PartialAppId = "", DisplayState = 1 };
                var spotlightSnap = new TvSnapshot { SourceType = -1, FullscreenAppId = "com.samsung.tv.spotlight-ss", PartialAppId = "", DisplayState = 1, ScreensaverActive = false };
                var ssEmptyFullSnap = new TvSnapshot { SourceType = -1, FullscreenAppId = "", PartialAppId = "", DisplayState = 1, ScreensaverActive = true };
                var ssTeardownGapSnap = new TvSnapshot { SourceType = -1, FullscreenAppId = "", PartialAppId = "", DisplayState = 1, ScreensaverActive = false };

                var m = new IdleBackdropModel(IdleConfig.Parse("aurora", true, "5", "10"));
                T.Eq(m.Evaluate(onTv, 100.0, false, false, false), IdleAction.ShowWithDock, "initial Empty TV shows with Dock");
                T.True(m.Visible && !m.HoldOcclusionForScreensaver, "Visible=true and HoldOcclusion=false on Empty TV");
                T.True(m.CanClaimBackKey(true, false, "", false, false, false), "claims Back on unobstructed Empty TV");
                T.True(!m.CanClaimBackKey(true, false, "", false, false, true), "never claims Back when screensaverActive=true");
                T.True(!IdleBackdropModel.CanClaimExitKey(true, false, 0, false, true, false), "HoldOcclusionForScreensaver blocks Exit claim");
                T.True(!IdleBackdropModel.CanClaimExitKey(true, false, 0, false, false, true), "screensaverActive blocks Exit claim");

                // spotlight-ss takes current_fullscreen_appid with SourceType=-1 even before vconf screensaver_on_off flips
                T.Eq(m.Evaluate(spotlightSnap, 220.0, false, false, false), IdleAction.Hide, "parks backdrop visuals when spotlight-ss starts");
                T.True(!m.Visible && m.HoldOcclusionForScreensaver, "holds black Wayland occlusion while spotlight-ss runs over Empty TV");
                T.True(!m.CanClaimBackKey(true, false, "", false, false, false), "HoldOcclusionForScreensaver blocks Back claim");
                T.Eq(m.Evaluate(spotlightSnap, 250.0, false, false, false), IdleAction.None, "steady spotlight-ss poll emits None while holding occlusion");
                T.True(m.HoldOcclusionForScreensaver, "keeps HoldOcclusionForScreensaver across steady polls");
                T.Eq(m.Evaluate(ssEmptyFullSnap, 260.0, false, false, false), IdleAction.None, "keeps HoldOcclusionForScreensaver when ScreensaverActive=true with empty FullscreenAppId");
                T.True(m.HoldOcclusionForScreensaver, "still holding occlusion for Default_Screensaver / empty FullscreenAppId");

                // PictureOffMinutes=5 still fires at 300s even while Samsung's 2-min OLED screensaver is holding occlusion
                T.Eq(m.Evaluate(spotlightSnap, 400.5, false, false, false), IdleAction.TriggerLcdOff, "PictureOffMinutes triggers lcdoff while screensaver holds occlusion");
                T.True(m.HoldOcclusionForScreensaver, "keeps occlusion hold until panel reports DisplayStateOff or screensaver exits");

                // Exiting spotlight-ss directly to tv-viewer restores Show WITHOUT reopening AutoDock
                var mDirect = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                mDirect.Evaluate(onTv, 10.0, false, false, false);
                mDirect.Evaluate(spotlightSnap, 130.0, false, false, false);
                T.Eq(mDirect.Evaluate(onTv, 145.0, false, false, false), IdleAction.Show, "exiting spotlight-ss to tv-viewer restores Show without AutoDock");
                T.True(mDirect.Visible && !mDirect.HoldOcclusionForScreensaver, "clears HoldOcclusionForScreensaver on Empty TV return");

                // Exiting spotlight-ss through a sub-100ms empty FullscreenAppId + SourceType=-1 gap also restores Show cleanly without Hide/ShowWithDock
                var mGap = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                mGap.Evaluate(onTv, 10.0, false, false, false);
                mGap.Evaluate(spotlightSnap, 130.0, false, false, false);
                T.Eq(mGap.Evaluate(ssTeardownGapSnap, 130.05, false, false, false), IdleAction.Show, "sub-100ms screensaver exit gap restores Show immediately without Hide flash");
                T.True(mGap.Visible && !mGap.HoldOcclusionForScreensaver, "Visible=true after screensaver exit grace");
                T.Eq(mGap.Evaluate(onTv, 130.15, false, false, false), IdleAction.None, "settling onto tv-viewer after exit gap emits None (no AutoDock popup)");

                // Switching to HDMI while HoldOcclusionForScreensaver=true unmaps vetro-idle cleanly via Hide
                var mHdmi = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                mHdmi.Evaluate(onTv, 10.0, false, false, false);
                mHdmi.Evaluate(spotlightSnap, 130.0, false, false, false);
                var hdmiSnap = new TvSnapshot { SourceType = 13, FullscreenAppId = IdleBackdropModel.TvViewerAppId, PartialAppId = "", DisplayState = 1 };
                T.Eq(mHdmi.Evaluate(hdmiSnap, 135.0, false, false, false), IdleAction.Hide, "switching to HDMI while parked emits Hide to unmap vetro-idle");
                T.True(!mHdmi.Visible && !mHdmi.HoldOcclusionForScreensaver, "clears HoldOcclusionForScreensaver on HDMI");

                // Entering spotlight-ss from HDMI (SourceType=13 -> SourceType=-1) preserves HDMI LastKnownSource and never activates Empty TV
                var mFromHdmi = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                mFromHdmi.Evaluate(hdmiSnap, 10.0, false, false, false);
                T.Eq(mFromHdmi.Evaluate(spotlightSnap, 130.0, false, false, false), IdleAction.None, "spotlight-ss over HDMI stays hidden");
                T.Eq(mFromHdmi.LastKnownSource, 13, "preserves HDMI LastKnownSource across SourceType=-1 screensaver");
                T.True(!mFromHdmi.Visible && !mFromHdmi.HoldOcclusionForScreensaver, "never holds Empty TV occlusion over HDMI");

                // Entering spotlight-ss from YouTube (!Visible && !HoldOcclusion) does NOT hold occlusion and preserves YouTube as _lastNonIdleAppId
                var mYt = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                var ytSnap = new TvSnapshot { SourceType = -1, FullscreenAppId = "com.samsung.tv.cobalt-yt", PartialAppId = "", DisplayState = 1 };
                var csfsSnap = new TvSnapshot { SourceType = -1, FullscreenAppId = "com.samsung.tv.csfs", PartialAppId = "", DisplayState = 1 };
                T.Eq(mYt.Evaluate(ytSnap, 10.0, false, false, false), IdleAction.None, "hidden in YouTube");
                T.Eq(mYt.Evaluate(spotlightSnap, 130.0, false, false, false), IdleAction.None, "spotlight-ss over YouTube stays hidden");
                T.True(!mYt.Visible && !mYt.HoldOcclusionForScreensaver, "does not hold Empty TV occlusion when screensaver started over YouTube");
                mYt.Evaluate(csfsSnap, 140.0, false, false, false);
                T.Eq(mYt.GuardedHomeDyingAppId, "com.samsung.tv.cobalt-yt", "spotlight-ss never overwrote YouTube in _lastNonIdleAppId");

                // 3. Cold-boot SourceType=0 with empty FullscreenAppId activates Empty TV immediately (while SourceType=-1 empty or TvPlusActive stays hidden)
                var mBoot = new IdleBackdropModel(IdleConfig.Parse("aurora-clean", false, "0", "10"));
                T.Eq(mBoot.Evaluate(new TvSnapshot { SourceType = -1, FullscreenAppId = "", DisplayState = 1, WmLaunchscreenPresent = false }, 1.0, false, false, false), IdleAction.None, "SourceType=-1 with empty app stays hidden");
                T.Eq(mBoot.Evaluate(new TvSnapshot { SourceType = 0, FullscreenAppId = IdleBackdropModel.TvViewerAppId, DisplayState = 1, TvPlusActive = true }, 1.2, false, false, false), IdleAction.None, "TvPlusActive keeps Empty TV hidden");
                T.Eq(mBoot.Evaluate(new TvSnapshot { SourceType = -1, FullscreenAppId = IdleBackdropModel.TvViewerAppId, DisplayState = 1, PendingTvSource = true }, 1.5, false, false, false), IdleAction.Show, "PendingTvSource with tv-viewer activates Empty TV");
                mBoot = new IdleBackdropModel(IdleConfig.Parse("aurora-clean", false, "0", "10"));
                T.Eq(mBoot.Evaluate(new TvSnapshot { SourceType = 0, FullscreenAppId = "", DisplayState = 1 }, 2.0, false, false, false), IdleAction.Show, "cold-boot SourceType=0 with empty FullscreenAppId shows Empty TV immediately");
                T.True(mBoot.Visible, "Visible=true on cold-boot SourceType=0");

                // 4. Cold-boot silent csfs protection (bounded <60s so it finishes well before 120s QD-OLED screensaver)
                T.True(IdleBackdropModel.IsColdBootSilentHome("com.samsung.tv.csfs", "", true, false, 18.5, "none", 0), "silent root cold-boot csfs before firstscreen_done is protected");
                T.True(IdleBackdropModel.IsColdBootSilentHome("com.samsung.tv.csfs", "", true, false, 18.5, "", 0), "empty show_status before firstscreen_done is protected");
                T.True(!IdleBackdropModel.IsColdBootSilentHome("com.samsung.tv.csfs", "", true, true, 18.5, "none", 0), "not protected once /tmp/firstscreen_done exists");
                T.True(!IdleBackdropModel.IsColdBootSilentHome("com.samsung.tv.csfs", "", true, false, 18.5, "full", 0), "not protected if Eden show_status is full");
                T.True(!IdleBackdropModel.IsColdBootSilentHome("com.samsung.tv.csfs", "", true, false, 18.5, "none", 1), "not protected if avoc home_shown=1");
                T.True(!IdleBackdropModel.IsColdBootSilentHome("com.samsung.tv.csfs", "", true, false, 65.0, "none", 0), "bounded at 60s uptime before 120s OLED screensaver");
                T.True(!IdleBackdropModel.IsColdBootSilentHome("com.samsung.tv.csfs", "", true, false, 125.0, "none", 0), "inactive at 125s uptime");
                T.True(!IdleBackdropModel.IsColdBootSilentHome("com.samsung.tv.csfs", "", false, false, 18.5, "none", 0), "not used without get_root_app");

                // 4b. Partial overlay (!WmStackActive) -> screensaver -> Empty TV does NOT corrupt _wasOtherApp; no duplicate or active-UI TriggerLcdOff
                var mPartialSs = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                T.Eq(mPartialSs.Evaluate(onTv, 10.0, false, false, false), IdleAction.ShowWithDock, "initial arrival opens Dock");
                var partialMenuSnap = new TvSnapshot { SourceType = 0, FullscreenAppId = IdleBackdropModel.TvViewerAppId, PartialAppId = "org.tizen.menu", DisplayState = 1, WmStackActive = false };
                T.Eq(mPartialSs.Evaluate(partialMenuSnap, 20.0, false, false, false), IdleAction.Hide, "hides for partial menu when !WmStackActive");
                T.Eq(mPartialSs.Evaluate(spotlightSnap, 140.0, false, false, false), IdleAction.None, "spotlight-ss after partial menu stays hidden");
                T.Eq(mPartialSs.Evaluate(onTv, 150.0, false, false, false), IdleAction.Show, "returning from spotlight-ss to Empty TV does not reopen AutoDock");

                var mPot = new IdleBackdropModel(IdleConfig.Parse("wallpaper", false, "5", "10"));
                mPot.Evaluate(onTv, 10.0, false, false, false);
                T.Eq(mPot.Evaluate(onTv, 315.0, false, false, false), IdleAction.TriggerLcdOff, "5-min PictureOff fires once at 315s");
                mPot.OnLcdOffVerify(1); // lcdoff unsupported -> fallback dim, DisplayState remains 1
                T.Eq(mPot.Evaluate(spotlightSnap, 600.0, false, false, false), IdleAction.Hide, "parks for 10-min LCD screensaver");
                T.Eq(mPot.Evaluate(spotlightSnap, 602.0, false, false, false), IdleAction.None, "does not double-fire TriggerLcdOff after parking");

                var mPill = new IdleBackdropModel(IdleConfig.Parse("wallpaper", false, "5", "10"));
                mPill.Evaluate(onTv, 10.0, false, false, false);
                mPill.Evaluate(spotlightSnap, 130.0, false, false, false);
                T.Eq(mPill.Evaluate(spotlightSnap, 320.0, false, false, true), IdleAction.None, "open VolumePill during screensaver suppresses TriggerLcdOff and resets idle timer");
                T.Eq(mPill.Evaluate(spotlightSnap, 330.0, false, false, false), IdleAction.None, "idle timer stayed reset after VolumePill closed");
                T.Eq(mPill.Evaluate(spotlightSnap, 625.0, false, false, false), IdleAction.TriggerLcdOff, "TriggerLcdOff fires 5 min after last VolumePill activity");

                var mColdCsfs = new IdleBackdropModel(IdleConfig.Parse("clock", false, "0", "10"));
                var silentCsfsSnap = new TvSnapshot { SourceType = -1, FullscreenAppId = "com.samsung.tv.csfs", DisplayState = 1, ColdBootSilentHome = true };
                T.Eq(mColdCsfs.Evaluate(silentCsfsSnap, 15.0, false, false, false), IdleAction.Show, "vetro-idle still covers screen during silent cold-boot csfs");
                T.True(!mColdCsfs.ShouldDismissGuardedHome(silentCsfsSnap, 15.0), "ShouldDismissGuardedHome=false during silent cold-boot csfs");
                var settledCsfsSnap = new TvSnapshot { SourceType = -1, FullscreenAppId = "com.samsung.tv.csfs", DisplayState = 1, ColdBootSilentHome = false };
                T.True(mColdCsfs.ShouldDismissGuardedHome(settledCsfsSnap, 25.0), "ShouldDismissGuardedHome=true once cold-boot silent phase finishes");
                T.True(!mColdCsfs.ShouldDismissGuardedHome(new TvSnapshot { SourceType = 0, FullscreenAppId = "com.samsung.tv.csfs", DisplayState = 1, ScreensaverActive = true, ScreensaverProcessActive = true }, 30.0), "never dismisses guarded home while real screensaver is active");

                // Command builders never target screensaver apps
                T.Eq(IdleBackdropModel.BuildReadAppPidCommand("com.samsung.tv.spotlight-ss", Catalog.ValidAppId), "", "BuildReadAppPidCommand rejects spotlight-ss");
                T.Eq(IdleBackdropModel.BuildCloseStuckAppCommand("com.samsung.tv.spotlight-ss", "4321", Catalog.ValidAppId, ""), "", "BuildCloseStuckAppCommand rejects spotlight-ss");
                T.Eq(IdleBackdropModel.BuildGuardedHomeRestoreCommand("com.samsung.tv.spotlight-ss", "", Catalog.ValidAppId, "", true), "", "BuildGuardedHomeRestoreCommand rejects spotlight-ss");

                // 5. WmStackLogic.TryParseWin accurately parses real Tizen 9 ua(usiiiiibbbiibibbbi) across literal, non-literal, and empty titles
                WmStackLogic.WinInfo parsed;
                string litIdle = WinLiteral(53, "vetro-idle", 0, 0, 1920, 1080, 250, true, false, true).Replace("      struct {", "");
                T.True(WmStackLogic.TryParseWin(litIdle, out parsed)
                    && parsed.Id == 53 && parsed.Title == "vetro-idle"
                    && parsed.X == 0 && parsed.Y == 0 && parsed.W == 1920 && parsed.H == 1080
                    && parsed.Layer == 250 && !parsed.CompData && parsed.Mapped && parsed.FrameVisible,
                    "TryParseWin parses literal vetro-idle with inline x=0 and layer=250 (not width=1920)");

                string litEmpty = WinLiteral(1402, "", -16, 24, 1, 1, 200, false).Replace("      struct {", "");
                T.True(WmStackLogic.TryParseWin(litEmpty, out parsed)
                    && parsed.Id == 1402 && parsed.Title == ""
                    && parsed.X == -16 && parsed.Y == 24 && parsed.W == 1 && parsed.H == 1
                    && parsed.Layer == 200 && !parsed.Mapped,
                    "TryParseWin parses literal empty-title window where int32 x is first token after uint32");

                string stdSpot = WinStandard(1990, "/opt/usr/apps/com.samsung.tv.spotlight-ss/bin/spotlight-ss.dll", 0, 0, 1920, 1080, 900, true).Replace("      struct {", "");
                T.True(WmStackLogic.TryParseWin(stdSpot, out parsed)
                    && parsed.Id == 1990 && parsed.Title == "/opt/usr/apps/com.samsung.tv.spotlight-ss/bin/spotlight-ss.dll"
                    && parsed.W == 1920 && parsed.H == 1080 && parsed.Layer == 900 && parsed.Mapped,
                    "TryParseWin parses non-literal --print-reply struct");

                string stdEmpty = WinStandard(1403, "", 0, 0, 1920, 1080, 200, false).Replace("      struct {", "");
                T.True(WmStackLogic.TryParseWin(stdEmpty, out parsed)
                    && parsed.Id == 1403 && parsed.Title == "" && parsed.Layer == 200 && !parsed.Mapped,
                    "TryParseWin parses non-literal empty string \"\" title");

                string stdQuotedInt = WinStandard(1404, "App int32 777", 10, 20, 1920, 1080, 200, true).Replace("      struct {", "");
                T.True(WmStackLogic.TryParseWin(stdQuotedInt, out parsed)
                    && parsed.Title == "App int32 777" && parsed.X == 10 && parsed.Layer == 200,
                    "TryParseWin keeps int32 text inside quoted non-literal string");

                string stdMultiLineLeadingNl = WinStandard(1405, "\nLineTwo", 0, 0, 1920, 1080, 200, true).Replace("      struct {", "");
                T.True(WmStackLogic.TryParseWin(stdMultiLineLeadingNl, out parsed)
                    && parsed.Id == 1405 && parsed.Title == "\nLineTwo" && parsed.Layer == 200 && parsed.Mapped,
                    "TryParseWin parses non-literal title starting with newline (trimmed 'string \"' len 8) without throwing");

                string stdEscapedQuotes = WinStandard(1406, "Cinema \\\"Pro\\\"", 0, 0, 1920, 1080, 200, true).Replace("      struct {", "");
                T.True(WmStackLogic.TryParseWin(stdEscapedQuotes, out parsed)
                    && parsed.Id == 1406 && parsed.Title == "Cinema \"Pro\"" && parsed.Layer == 200,
                    "TryParseWin unescapes quoted D-Bus title strings");

                T.True(!WmStackLogic.TryParseWin(" uint32 53\n string \"\n int32 0\n int32 0\n int32 1920\n int32 1080\n int32 250\n}\n", out parsed),
                    "TryParseWin rejects unterminated 'string \"' cleanly without ArgumentOutOfRangeException");
                T.True(!WmStackLogic.TryParseWin(" uint32 53\n vetro-idle         int32 0\n int32 0\n int32 1920\n int32 1080\n int32 250\n boolean false\n boolean true\n}\n", out parsed),
                    "TryParseWin rejects truncated 2-boolean struct");
                T.True(!WmStackLogic.TryParseWin("   uint32 14\n   array [\n", out parsed), "TryParseWin rejects GetWinsInfo header preamble");
                T.True(!WmStackLogic.TryParseWin(" uint32 53\n vetro-idle         int32 0\n int32 250\n}\n", out parsed), "TryParseWin rejects truncated 2-int struct");

                // 5a. WmStackLogic drops vetro-idle to LayerNormal (200) directly below layer-200 screensaver without exposing background apps
                var ssCmds = new List<string>();
                int ssLayer = WmStackLogic.LayerShield;
                string winsWithScreensaver = WinsReply(
                    WinLiteral(1990, "com.samsung.tv.spotlight-ss", 0, 0, 1920, 1080, 200, true),
                    WinLiteral(1554, "vetro-idle", 0, 0, 1920, 1080, 250, true, false, true),
                    WinLiteral(1800, "com.samsung.tv.home.media", 0, 0, 1920, 1080, 200, true),
                    WinLiteral(1, "tv-viewer", 0, 0, 1920, 1080, 200, true));
                Func<string, string> ssShell = cmd =>
                {
                    ssCmds.Add(cmd);
                    if (cmd.Contains("GetWinsInfo")) return winsWithScreensaver;
                    if (cmd.Contains("GetWindowNotiLevel")) return "int32 " + ssLayer;
                    if (cmd.Contains("SetWindowNotiLevel"))
                    {
                        if (cmd.Contains("uint32:1554 int32:200")) ssLayer = WmStackLogic.LayerNormal;
                        else if (cmd.Contains("uint32:1554 int32:250")) ssLayer = WmStackLogic.LayerShield;
                    }
                    return "";
                };
                bool ssActive = false, ssProbed = false;
                uint ssIdleWin = 0;
                WmStackObservation ssObs;
                WmStackLogic.Step(ssShell, false, false, false, true, false, ref ssActive, ref ssProbed, ref ssIdleWin, out ssObs, null);
                T.True(ssObs.ScreensaverWinPresent && !ssObs.ActiveAppWinPresent, "observes ScreensaverWinPresent=true and excludes screensaver from ActiveAppWinPresent");
                T.Eq(ssLayer, WmStackLogic.LayerNormal, "spotlight-ss window in GetWinsInfo drops vetro-idle to LayerNormal (200) even during shieldTime");
                T.True(ssCmds.Exists(c => c.Contains("SetWindowStack uint32:1554 uint32:1990 int32:0")), "stacks vetro-idle directly below spotlight-ss (never exposing home.media below it)");
                T.True(!ssCmds.Exists(c => c.Contains("uint32:1990 int32:1")), "never stacks vetro-idle above spotlight-ss");
                T.True(!ssCmds.Exists(c => c.Contains("uint32:1 int32:1")), "does not push vetro-idle down to tv-viewer beneath home.media");

                // 5b. Non-literal --print-reply GetWinsInfo output + empty-title window behaves identically
                ssCmds.Clear();
                ssLayer = WmStackLogic.LayerNormal;
                winsWithScreensaver = WinsReply(
                    WinStandard(1402, "", 0, 0, 1, 1, 200, false),
                    WinStandard(1554, "vetro-idle", 0, 0, 1920, 1080, 200, true),
                    WinStandard(1990, "com.samsung.tv.spotlight-ss", 0, 0, 1920, 1080, 200, true));
                WmStackLogic.Step(ssShell, false, false, false, false, true, ref ssActive, ref ssProbed, ref ssIdleWin, null);
                T.True(ssCmds.Exists(c => c.Contains("SetWindowStack uint32:1554 uint32:1990 int32:0")), "restacks vetro-idle below spotlight-ss on non-literal output even when curLayer==200 and tv-viewer is absent");

                // 5c. Layer-900 spotlight-ss and Layer-990 Default_Screensaver drop vetro-idle to LayerNormal (200) without calling SetWindowStack against layer 900/990
                ssCmds.Clear();
                ssLayer = WmStackLogic.LayerShield;
                winsWithScreensaver = WinsReply(
                    WinLiteral(1990, "/opt/usr/apps/com.samsung.tv.spotlight-ss/bin/spotlight-ss.dll", 0, 0, 1920, 1080, 900, true),
                    WinLiteral(1999, "Default_Screensaver", 0, 0, 1920, 1080, 990, true),
                    WinLiteral(1554, "vetro-idle", 0, 0, 1920, 1080, 250, true),
                    WinLiteral(1, "tv-viewer", 0, 0, 1920, 1080, 200, true));
                WmStackLogic.Step(ssShell, false, false, false, true, false, ref ssActive, ref ssProbed, ref ssIdleWin, out ssObs, null);
                T.True(ssObs.ScreensaverWinPresent, "observes Layer-900/990 ScreensaverWinPresent");
                T.Eq(ssLayer, WmStackLogic.LayerNormal, "layer-900/990 active screensaver drops vetro-idle to LayerNormal");
                T.True(!ssCmds.Exists(c => c.Contains("SetWindowStack")), "does not call SetWindowStack against layer-900/990 screensavers");

                // 5d. Terminating layer-150 spotlight-ss (lowered by _e_mod_screensaver_lower_terminating_app), unmapped screensaver (b[1]==false),
                // and 1x1 dummy surface MUST NOT trigger saverNow or drag vetro-idle onto layer 150!
                ssCmds.Clear();
                ssLayer = WmStackLogic.LayerShield;
                winsWithScreensaver = WinsReply(
                    WinLiteral(52, "tvlauncher", 539, 764, 842, 316, 250, false), // unmapped hidden dock above vetro-idle (real S90C layout!)
                    WinLiteral(1554, "vetro-idle", 0, 0, 1920, 1080, 250, true),
                    WinLiteral(1991, "com.samsung.tv.spotlight-ss", 0, 0, 1920, 1080, 200, false), // unmapped screensaver
                    WinLiteral(1992, "Default_Screensaver", 0, 0, 1, 1, 990, true), // 1x1 dummy surface
                    WinLiteral(1, "tv-viewer", 0, 0, 1920, 1080, 200, true),
                    WinLiteral(1990, "/opt/usr/apps/com.samsung.tv.spotlight-ss/bin/spotlight-ss.dll", 0, 0, 1920, 1080, 150, true)); // dying layer-150 screensaver
                WmStackLogic.Step(ssShell, false, false, false, true, false, ref ssActive, ref ssProbed, ref ssIdleWin, out ssObs, null);
                T.True(!ssObs.ScreensaverWinPresent, "ignores dying layer-150, unmapped, and 1x1 screensavers");
                T.Eq(ssLayer, WmStackLogic.LayerShield, "dying layer-150, unmapped, and 1x1 screensavers do NOT drop vetro-idle off LayerShield");
                T.True(!ssCmds.Exists(c => c.Contains("uint32:1990")), "never stacks vetro-idle relative to dying layer-150 spotlight-ss");
                T.True(!ssCmds.Exists(c => c.Contains("SetWindowStack") && c.Contains("uint32:52")), "never stacks vetro-idle below unmapped hidden tvlauncher");

                // Even if partialActive=true puts vetro-idle on LayerNormal (200), dying layer-150 spotlight-ss is ignored and vetro-idle stacks above tv-viewer
                ssCmds.Clear();
                WmStackLogic.Step(ssShell, false, false, true, true, false, ref ssActive, ref ssProbed, ref ssIdleWin, null);
                T.Eq(ssLayer, WmStackLogic.LayerNormal, "partialActive drops vetro-idle to LayerNormal");
                T.True(ssCmds.Exists(c => c.Contains("SetWindowStack uint32:1554 uint32:1 int32:1")), "stacks vetro-idle above tv-viewer on layer 200");
                T.True(!ssCmds.Exists(c => c.Contains("uint32:1990")), "never drops vetro-idle onto layer 150 beneath tv-viewer/QuickLaunch");

                // 5e. Mapped vetro-numpad / vetro-volume / ControlCenter (_taskWin) vs unmapped hidden _win or wrong-layer windows on LayerShield (250)
                ssCmds.Clear();
                ssLayer = WmStackLogic.LayerShield;
                winsWithScreensaver = WinsReply(
                    WinLiteral(1554, "vetro-idle", 0, 0, 1920, 1080, 250, true),
                    WinLiteral(1610, "vetro-volume", 96, 360, 88, 360, 250, true),
                    WinLiteral(1611, "vetro-numpad", 410, 816, 1100, 200, 250, false), // unmapped pad below volume
                    WinLiteral(1612, "tvlauncher", 0, 0, 1, 1, 250, true), // recycled 1x1 window
                    WinLiteral(1613, "vetro-numpad", 410, 816, 1100, 200, 200, true)); // wrong-layer overlay ignored on LayerShield
                WmStackLogic.Step(ssShell, false, false, false, true, false, ref ssActive, ref ssProbed, ref ssIdleWin, null);
                T.True(ssCmds.Exists(c => c.Contains("SetWindowStack uint32:1554 uint32:1610 int32:0")), "stacks vetro-idle below mapped layer-250 vetro-volume while ignoring unmapped, 1x1, and wrong-layer windows");
                T.True(!ssCmds.Exists(c => c.Contains("SetWindowStack") && c.Contains("uint32:1613")), "never stacks layer-250 vetro-idle relative to layer-200 overlay");

                // Dying layer-150 guarded Samsung Home or tv-viewer is ignored when stacking on LayerNormal (200)
                ssCmds.Clear();
                ssLayer = WmStackLogic.LayerNormal;
                winsWithScreensaver = WinsReply(
                    WinLiteral(1703, "com.samsung.tv.csfs", 0, 0, 1920, 1080, 150, true),
                    WinLiteral(1554, "vetro-idle", 0, 0, 1920, 1080, 200, true),
                    WinLiteral(1, "tv-viewer", 0, 0, 1920, 1080, 200, true));
                WmStackLogic.Step(ssShell, false, false, true, false, false, ref ssActive, ref ssProbed, ref ssIdleWin, null);
                T.True(!ssCmds.Exists(c => c.Contains("uint32:1703")), "never stacks layer-200 vetro-idle relative to layer-150 csfs");

                // 5f. ShouldRaiseBackdrop prevents Z-order flash over Dock, NumberPad, VolumePill, and partial menus while still masking unrequested guarded home.sidebar
                T.True(IdleBackdropModel.ShouldRaiseBackdrop(false, false, false, ""), "raises backdrop when no overlay or partial app is open");
                T.True(!IdleBackdropModel.ShouldRaiseBackdrop(true, false, false, ""), "never raises backdrop over open Dock/ControlCenter");
                T.True(!IdleBackdropModel.ShouldRaiseBackdrop(false, true, false, ""), "never raises backdrop over open NumberPad");
                T.True(!IdleBackdropModel.ShouldRaiseBackdrop(false, false, true, ""), "never raises backdrop over open VolumePill");
                T.True(!IdleBackdropModel.ShouldRaiseBackdrop(false, false, false, "org.tizen.menu"), "never raises backdrop over partial menu");
                T.True(!IdleBackdropModel.ShouldRaiseBackdrop(false, false, false, "", false, true), "never raises backdrop during back-release overlay launch window");
                T.True(IdleBackdropModel.ShouldRaiseBackdrop(false, false, false, "com.samsung.tv.home.sidebar", false, false), "raises backdrop over unrequested guarded home.sidebar partial app");
                T.True(!IdleBackdropModel.ShouldRaiseBackdrop(false, false, false, "com.samsung.tv.home.sidebar", true, false), "does not raise backdrop over intentionally requested Samsung Home partial app");

                // 5g. BuildScreensaverActivityCommand wakes/resets Enlightenment scrsaver without XF86Back injection and includes cross-process lock + crash recovery
                string actCmd = IdleBackdropModel.BuildScreensaverActivityCommand();
                T.True(!actCmd.Contains("input_keyevent") && !actCmd.Contains("XF86Back"), "never injects XF86Back or key events");
                T.True(actCmd.Contains("org.enlightenment.wm.info.scrsaver")
                    && actCmd.Contains("/tmp/vetro-scrsaver.lock")
                    && actCmd.Contains("int32:1 double:0")
                    && actCmd.Contains("State: Enabled")
                    && actCmd.Contains("int32:3 double:0")
                    && actCmd.Contains("int32:2 double:0"), "uses locked Enlightenment scrsaver query -> disable -> enable reset");

                // 6. ShouldPollFastIdle avoids 10 Hz vconf polling in streaming apps, during screensaver, and when steady Visible over stubborn csfs
                T.True(!IdleBackdropModel.ShouldPollFastIdle(50.0, 10.0, -1, "com.samsung.tv.cobalt-yt", false, false, false, false), "does not fast-poll during YouTube");
                T.True(!IdleBackdropModel.ShouldPollFastIdle(50.0, 10.0, -1, "com.samsung.tv.spotlight-ss", false, true, true, false), "does not fast-poll during spotlight-ss");
                T.True(!IdleBackdropModel.ShouldPollFastIdle(50.0, 10.0, -1, "com.samsung.tv.csfs", false, true, true, true), "never fast-polls during screensaver even if guardedHomeActive=true");
                T.True(!IdleBackdropModel.ShouldPollFastIdle(50.0, 10.0, 0, IdleBackdropModel.TvViewerAppId, true, false, false, false), "does not fast-poll when steady Visible on Empty TV");
                T.True(!IdleBackdropModel.ShouldPollFastIdle(50.0, 10.0, -1, "com.samsung.tv.csfs", true, false, false, true), "does not spin at 10 Hz when already Visible over stubborn csfs outside fast window");
                T.True(IdleBackdropModel.ShouldPollFastIdle(50.0, 10.0, -1, "com.samsung.tv.csfs", false, false, false, true), "fast-polls when !Visible and guardedHomeActive=true");
                T.True(IdleBackdropModel.ShouldPollFastIdle(50.0, 52.0, -1, "com.samsung.tv.spotlight-ss", false, true, true, false), "fast-polls immediately after remote wake key press");
                T.True(IdleBackdropModel.ShouldPollFastIdle(50.0, 10.0, 0, IdleBackdropModel.TvViewerAppId, false, false, false, false), "fast-polls on unshown Empty TV arrival");
            });

            T.Run("idle: BuildScreensaverActivityCommand shell execution handles enabled, retry, disabled, concurrent lock, and SIGKILL recovery", () =>
            {
                string ssDir = Path.Combine(Path.GetTempPath(), "vetro-scrsaver-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(ssDir);
                try
                {
                    string lockDir = Path.Combine(ssDir, "lock").Replace('\\', '/');
                    string actCmd = IdleBackdropModel.BuildScreensaverActivityCommand(lockDir);
                    string dbusMock = Path.Combine(ssDir, "dbus-send").Replace('\\', '/');
                    string callLog = Path.Combine(ssDir, "calls").Replace('\\', '/');
                    string stateFile = Path.Combine(ssDir, "state").Replace('\\', '/');
                    string failOnce = Path.Combine(ssDir, "fail2").Replace('\\', '/');
                    File.WriteAllText(dbusMock,
                        "#!/bin/sh\n"
                        + "for a in \"$@\"; do case \"$a\" in int32:*) cmd=\"$a\" ;; esac; done\n"
                        + "echo \"$cmd\" >> " + Q(callLog) + "\n"
                        + "if [ \"$cmd\" = \"int32:1\" ]; then cat " + Q(stateFile) + "; exit 0; fi\n"
                        + "if [ \"$cmd\" = \"int32:2\" ] && [ -f " + Q(failOnce) + " ]; then rm -f " + Q(failOnce) + "; exit 1; fi\n"
                        + "exit 0\n");
                    Shell("chmod +x " + Q(dbusMock));
                    string testCmd = actCmd.Replace("dbus-send ", Q(dbusMock) + " ");

                    // Enabled: runs 1 -> 3 -> 2 and cleans lock
                    File.WriteAllText(stateFile, "   [Server] screen saver\n\tState: Enabled\n\tTimeout period: 120.000000\n");
                    Shell(testCmd);
                    T.Eq(string.Join(",", File.ReadAllLines(callLog)), "int32:1,int32:3,int32:2", "enabled scrsaver runs query, disable, enable");
                    T.True(!Directory.Exists(lockDir), "cleans lock directory after normal run");

                    // Enabled with transient D-Bus failure on first re-enable: retries int32:2 so screensaver is never left disabled
                    File.Delete(callLog);
                    File.WriteAllText(failOnce, "1");
                    Shell(testCmd);
                    T.Eq(string.Join(",", File.ReadAllLines(callLog)), "int32:1,int32:3,int32:2,int32:2", "retries enable on transient failure");

                    // Disabled: queries int32:1 and never touches 3 or 2
                    File.Delete(callLog);
                    File.WriteAllText(stateFile, "   [Server] screen saver\n\tState: Disabled\n\tTimeout period: 120.000000\n");
                    Shell(testCmd);
                    T.Eq(string.Join(",", File.ReadAllLines(callLog)), "int32:1", "disabled scrsaver is left untouched");

                    // Concurrent live lock holder (e.g. SamsungTvRemoteInputAgent + dock firing simultaneously): skips duplicate D-Bus calls
                    File.Delete(callLog);
                    Directory.CreateDirectory(lockDir);
                    File.WriteAllText(Path.Combine(lockDir, "p"), Process.GetCurrentProcess().Id.ToString());
                    Shell("mkdir -p " + Q(lockDir) + "; echo $$ > " + Q(lockDir + "/p") + "; (" + testCmd + ")");
                    T.True(!File.Exists(callLog), "concurrent live lock holder skips duplicate dbus-send calls");
                    Directory.Delete(lockDir, true);

                    // Simulated SIGKILL after int32:3 left stale lock + /d marker and State: Disabled -> next call self-heals via int32:2!
                    Directory.CreateDirectory(lockDir);
                    File.WriteAllText(Path.Combine(lockDir, "p"), "999999");
                    File.WriteAllText(Path.Combine(lockDir, "d"), "");
                    File.WriteAllText(stateFile, "   [Server] screen saver\n\tState: Disabled\n\tTimeout period: 120.000000\n");
                    Shell(testCmd);
                    T.Eq(string.Join(",", File.ReadAllLines(callLog)), "int32:2,int32:1", "self-heals SIGKILLed int32:3 via int32:2 before querying");
                    T.True(!Directory.Exists(lockDir), "cleans stale lock after crash recovery");
                }
                finally { Directory.Delete(ssDir, true); }
            });

            T.Run("Fix A/B/C & IEnlightenmentWmBackend: warm csfs bury, hidden pre-stage Layer 250, Step-1 fall-through & LaunchTargetReady curtain", () =>
            {
                // Fix A: Bury warm csfs.dll sitting on Layer 200 between user app and tv-viewer (even when occluded Icon=1 / !idleVisible)
                var cmds = new List<string>();
                int idleLayer = WmStackLogic.LayerNormal;
                string wins = WinsReply(
                    WinLiteral(2757, "Nuvio TV", 0, 0, 1920, 1080, 200, true, false, false, 0),
                    WinLiteral(137, "/opt/usr/apps/com.samsung.tv.csfs/bin/csfs.dll", 0, 0, 1920, 1080, 200, true, false, false, 1),
                    WinLiteral(118, "tv-viewer", 0, 0, 1920, 1080, 200, true, false, false, 1),
                    WinLiteral(2422, "vetro-idle", 0, 0, 1920, 1080, 200, false, false, false, 0));
                Func<string, string> shell = cmd =>
                {
                    cmds.Add(cmd);
                    if (cmd.Contains("GetWinsInfo")) return wins;
                    if (cmd.Contains("GetWindowNotiLevel")) return "int32 " + idleLayer;
                    if (cmd.Contains("SetWindowNotiLevel"))
                    {
                        if (cmd.Contains("int32:250")) idleLayer = WmStackLogic.LayerShield;
                        else if (cmd.Contains("int32:200")) idleLayer = WmStackLogic.LayerNormal;
                    }
                    return "";
                };
                bool active = true, probed = true;
                uint idleWinId = 2422;
                WmStackObservation obs;
                WmStackLogic.Step(shell, false, false, false, false, false, ref active, ref probed, ref idleWinId, out obs, null);
                T.True(cmds.Exists(c => c.Contains("SetWindowStack uint32:137 uint32:118 int32:0")), "Fix A: buries warm csfs.dll directly below tv-viewer (int32:0)");

                // Fix B: Hidden vetro-idle (!idleVisible && !launchingApp && !saverNow && !allowSamsungHome) pre-stages at LayerShield (250)
                T.Eq(idleLayer, WmStackLogic.LayerShield, "Fix B: pre-stages hidden vetro-idle at LayerShield (250)");

                // Fix B: When allowSamsungHome=true, hidden vetro-idle does NOT pre-stage to 250 and does NOT bury csfs
                cmds.Clear();
                idleLayer = WmStackLogic.LayerNormal;
                WmStackLogic.Step(shell, true, false, false, false, false, ref active, ref probed, ref idleWinId, out obs, null);
                T.Eq(idleLayer, WmStackLogic.LayerNormal, "Fix B: allowSamsungHome=true skips pre-stage LayerShield");
                T.True(!cmds.Exists(c => c.Contains("SetWindowStack uint32:137 uint32:118 int32:0")), "Fix A: allowSamsungHome=true never buries csfs");

                // Fix B: Hidden vetro-idle promotes Layer-250 overlays to Layer 500 and chains SetWindowStack below fallback Layer-250 overlay
                cmds.Clear();
                idleLayer = WmStackLogic.LayerNormal;
                var overlayLayers = new Dictionary<uint, int> { { 962u, 250 } };
                wins = WinsReply(
                    WinLiteral(962, "tvlauncher", 539, 764, 842, 316, 250, true, false, true),
                    WinLiteral(2422, "vetro-idle", 0, 0, 1920, 1080, 200, false, false, false),
                    WinLiteral(118, "tv-viewer", 0, 0, 1920, 1080, 200, true, false, true));
                Func<string, string> overlayShell = cmd =>
                {
                    cmds.Add(cmd);
                    if (cmd.Contains("GetWinsInfo")) return wins;
                    if (cmd.Contains("GetWindowNotiLevel"))
                    {
                        if (cmd.Contains("uint32:962")) return "int32 " + overlayLayers[962u];
                        return "int32 " + idleLayer;
                    }
                    if (cmd.Contains("SetWindowNotiLevel"))
                    {
                        if (cmd.Contains("uint32:2422 int32:250")) idleLayer = WmStackLogic.LayerShield;
                        else if (cmd.Contains("uint32:2422 int32:200")) idleLayer = WmStackLogic.LayerNormal;
                    }
                    return "";
                };
                WmStackLogic.Step(overlayShell, false, false, false, false, false, ref active, ref probed, ref idleWinId, out obs, null);
                T.Eq(idleLayer, WmStackLogic.LayerShield, "Fix B: pre-staged hidden vetro-idle reaches LayerShield (250)");
                T.True(cmds.Exists(c => c.Contains("SetWindowNotiLevel uint32:962 int32:500")), "Fix B: promotes tvlauncher to Layer 500 before pre-staging");
                T.True(cmds.Exists(c => c.Contains("SetWindowStack uint32:2422 uint32:962 int32:0")), "Fix B: chains SetWindowStack below Layer-250 fallback overlay");

                // Fix C: Step-1 fall-through when idleWin != 0 && idleVisible drops to Layer 200, buries rawHomeWin below tv-viewer, AND stacks above topTv in the same pass
                cmds.Clear();
                idleLayer = WmStackLogic.LayerShield;
                wins = WinsReply(
                    WinLiteral(2422, "vetro-idle", 0, 0, 1920, 1080, 250, true, false, true),
                    WinLiteral(137, "/opt/usr/apps/com.samsung.tv.csfs/bin/csfs.dll", 0, 0, 1920, 1080, 200, true, false, false),
                    WinLiteral(118, "tv-viewer", 0, 0, 1920, 1080, 200, true, false, true));
                var step1Launch = new WmLaunchState
                {
                    TargetAppId = "NuvioTV001.NuvioTV",
                    TargetLabel = "Nuvio TV",
                    StartedAtMs = 1000
                };
                WmStackLogic.Step(shell, false, false, false, false, false, ref active, ref probed, ref idleWinId, out obs, null, true, step1Launch, 1000);
                T.True(step1Launch.SnapshotTaken, "Fix C: Step 1 takes pre-launch snapshot");
                T.Eq(idleLayer, WmStackLogic.LayerNormal, "Fix C: Step 1 drops vetro-idle to LayerNormal (200)");
                T.True(!obs.LaunchTargetReady, "Fix C: Step 1 reports LaunchTargetReady=false while no target or Launchscreen mapped");
                T.True(cmds.Exists(c => c.Contains("SetWindowStack uint32:2422 uint32:137 int32:1") || c.Contains("SetWindowStack uint32:2422 uint32:118 int32:1")), "Fix C: Step 1 falls through and stacks vetro-idle above topTv");
                T.True(cmds.Exists(c => c.Contains("SetWindowStack uint32:137 uint32:118 int32:0")), "Fix C: Step 1 buries rawHomeWin below tv-viewer in same pass");

                // Fix C: Launchscreen Winsys stacks vetro-idle below spinner while LaunchTargetReady remains false until real app maps
                cmds.Clear();
                idleLayer = WmStackLogic.LayerNormal;
                wins = WinsReply(
                    WinLiteral(2422, "vetro-idle", 0, 0, 1920, 1080, 200, true, false, true),
                    WinLiteral(1702, "Launchscreen Winsys", 0, 0, 1920, 1080, 200, true, false, true),
                    WinLiteral(118, "tv-viewer", 0, 0, 1920, 1080, 200, true, false, true));
                WmStackLogic.Step(shell, false, false, false, false, false, ref active, ref probed, ref idleWinId, out obs, null, true, step1Launch, 1120);
                T.True(!obs.LaunchTargetReady && obs.LaunchscreenWinPresent, "Fix C: Launchscreen Winsys keeps LaunchTargetReady=false while LaunchscreenWinPresent=true");
                T.True(cmds.Exists(c => c.Contains("SetWindowStack uint32:2422 uint32:1702 int32:0")), "Fix C: stacks vetro-idle below Launchscreen Winsys");

                // Fix C: IdleBackdropModel.Evaluate holds launch curtain while !WmLaunchTargetReady up to 2.5s (normal) / 4.5s (shard), then hides when ready or expired
                var curtainModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "40"));
                var tvSnap = new TvSnapshot { SourceType = 0, FullscreenAppId = IdleBackdropModel.TvViewerAppId, DisplayState = 1, WmStackActive = true };
                curtainModel.Evaluate(tvSnap, 10.0, false, false, false);
                curtainModel.OnLaunchApp(20.0, IdleBackdropModel.LaunchSuppressSeconds, "NuvioTV001.NuvioTV");
                var nuvioNotReadySnap = new TvSnapshot { SourceType = -1, FullscreenAppId = "NuvioTV001.NuvioTV", DisplayState = 1, WmStackActive = true, WmLaunchTargetReady = false };
                T.Eq(curtainModel.Evaluate(nuvioNotReadySnap, 21.0, false, false, false), IdleAction.None, "Fix C: holds curtain at +1.0s when WmLaunchTargetReady=false");
                T.True(curtainModel.Visible, "Fix C: remains Visible while target window not mapped/stacked yet");
                var nuvioReadySnap = nuvioNotReadySnap; nuvioReadySnap.WmLaunchTargetReady = true;
                T.Eq(curtainModel.Evaluate(nuvioReadySnap, 21.1, false, false, false), IdleAction.Hide, "Fix C: hides immediately once WmLaunchTargetReady=true");
                T.True(!curtainModel.Visible, "Fix C: Visible becomes false once target ready");

                // Normal launch curtain timeout at 2.5s
                var normTimeoutModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "40"));
                normTimeoutModel.Evaluate(tvSnap, 10.0, false, false, false);
                normTimeoutModel.OnLaunchApp(20.0, IdleBackdropModel.LaunchSuppressSeconds, "NuvioTV001.NuvioTV");
                T.Eq(normTimeoutModel.Evaluate(nuvioNotReadySnap, 22.4, false, false, false), IdleAction.None, "Fix C: normal launch holds curtain < 2.5s");
                T.Eq(normTimeoutModel.Evaluate(nuvioNotReadySnap, 22.6, false, false, false), IdleAction.Hide, "Fix C: normal launch releases curtain after 2.5s timeout");

                // Shard launch curtain timeout at 4.5s
                var shardTimeoutModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "40"));
                shardTimeoutModel.Evaluate(tvSnap, 10.0, false, false, false);
                shardTimeoutModel.OnLaunchApp(20.0, IdleBackdropModel.ShardLaunchSuppressSeconds, IdleBackdropModel.WrapperYouTubeAppId);
                var ytNotReadySnap = new TvSnapshot { SourceType = -1, FullscreenAppId = IdleBackdropModel.CobaltYouTubeAppId, DisplayState = 1, WmStackActive = true, WmLaunchTargetReady = false };
                T.Eq(shardTimeoutModel.Evaluate(ytNotReadySnap, 24.4, false, false, false), IdleAction.None, "Fix C: shard launch holds curtain < 4.5s");
                T.Eq(shardTimeoutModel.Evaluate(ytNotReadySnap, 24.6, false, false, false), IdleAction.Hide, "Fix C: shard launch releases curtain after 4.5s timeout");

                // Fix C: ShouldDismissGuardedHome returns false when now < _launchSuppressUntil && Visible && snap.WmStackActive && !partialGuarded
                var dismissSupModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "40"));
                dismissSupModel.Evaluate(tvSnap, 10.0, false, false, false);
                dismissSupModel.OnLaunchApp(20.0, IdleBackdropModel.ShardLaunchSuppressSeconds, IdleBackdropModel.WrapperYouTubeAppId);
                var csfsWmSnap = new TvSnapshot { SourceType = -1, FullscreenAppId = "com.samsung.tv.csfs", PartialAppId = "", DisplayState = 1, WmStackActive = true, WmStateObserved = true, WmGuardedHomePresent = true };
                T.True(!dismissSupModel.ShouldDismissGuardedHome(csfsWmSnap, 21.0), "Fix C: suppresses guarded-home kill while curtain Visible + WmStackActive during launch");
                var csfsPartialWmSnap = csfsWmSnap; csfsPartialWmSnap.PartialAppId = "com.samsung.tv.home.sidebar";
                T.True(dismissSupModel.ShouldDismissGuardedHome(csfsPartialWmSnap, 21.0), "Fix C: still dismisses partial guarded home during launch");

                // Both IEnlightenmentWmBackend implementations (mock structured backend vs ShellEnlightenmentWmBackend) behave identically
                var mockBackend = new FakeWmBackend(
                    new List<WmStackLogic.WinInfo>
                    {
                        new WmStackLogic.WinInfo { WinId = 2422, Title = "vetro-idle", Index = 0, Width = 1920, Height = 1080, Layer = 250, Visible = true, IsHidden = false },
                        new WmStackLogic.WinInfo { WinId = 137, Title = "/opt/usr/apps/com.samsung.tv.csfs/bin/csfs.dll", Index = 1, Width = 1920, Height = 1080, Layer = 200, Visible = true, IsHidden = false },
                        new WmStackLogic.WinInfo { WinId = 118, Title = "tv-viewer", Index = 2, Width = 1920, Height = 1080, Layer = 200, Visible = true, IsHidden = false }
                    },
                    250);
                var mockLaunch = new WmLaunchState { TargetAppId = "NuvioTV001.NuvioTV", TargetLabel = "Nuvio TV", StartedAtMs = 5000 };
                bool mockActive = true, mockProbed = true;
                uint mockIdle = 0;
                WmStackObservation mockObs;
                WmStackLogic.Step(mockBackend, false, false, false, false, false, ref mockActive, ref mockProbed, ref mockIdle, out mockObs, null, true, mockLaunch, 5000);
                T.True(mockLaunch.SnapshotTaken && mockBackend.IdleLayer == WmStackLogic.LayerNormal && mockIdle == 2422, "IEnlightenmentWmBackend: structured backend drops vetro-idle to 200 on Step 1");
                T.True(mockBackend.StackCalls.Contains("137:118:0"), "IEnlightenmentWmBackend: structured backend buries csfs below tv-viewer");
                T.True(mockBackend.StackCalls.Contains("2422:137:1") || mockBackend.StackCalls.Contains("2422:118:1"), "IEnlightenmentWmBackend: structured backend stacks vetro-idle above topTv");
            });
        }

        private sealed class FakeWmBackend : IEnlightenmentWmBackend
        {
            public List<WmStackLogic.WinInfo> Windows;
            public int IdleLayer;
            public string SyncedFullscreenAppId;
            public readonly List<string> StackCalls = new List<string>();
            public readonly List<string> PromotedOverlayCalls = new List<string>();
            public FakeWmBackend(List<WmStackLogic.WinInfo> wins, int idleLayer) { Windows = wins; IdleLayer = idleLayer; }
            public bool TryGetWinsInfo(out List<WmStackLogic.WinInfo> wins) { wins = Windows; return true; }
            public bool TryGetWindowNotiLevel(uint winId, out int level) { level = IdleLayer; return true; }
            public bool TrySetWindowNotiLevel(uint winId, int level) { if (winId == 2422) IdleLayer = level; return true; }
            public bool TrySetWindowStack(uint winId, uint baseWinId, int mode) { StackCalls.Add(winId + ":" + baseWinId + ":" + mode); return true; }
            public bool TrySetWindowNotiLevelAndStack(uint winId, int level, uint baseWinId, int mode) { TrySetWindowNotiLevel(winId, level); return TrySetWindowStack(winId, baseWinId, mode); }
            public bool TryPromoteOverlays(IReadOnlyList<uint> overlayWinIds, int layer) { if (overlayWinIds != null) foreach (uint id in overlayWinIds) PromotedOverlayCalls.Add(id + "->" + layer); return true; }
            public bool TrySyncFullscreenAppId(string appId) { SyncedFullscreenAppId = appId; return true; }
        }

        public static void RunWallpaperScaleTests()
        {
            T.Run("wallpaper scale: unified envelope presets, mask resolution, and parser", () =>
            {
                T.Eq(AmbientLakeEngine.MaskTexW, 288, "MaskTexW upgraded to 288");
                T.Eq(AmbientLakeEngine.MaskTexH, 160, "MaskTexH upgraded to 160");
                T.Eq(AmbientLakeEngine.ScaleCompact, 0, "ScaleCompact == 0");
                T.Eq(AmbientLakeEngine.ScaleBalanced, 1, "ScaleBalanced == 1");
                T.Eq(AmbientLakeEngine.ScaleExpansive, 2, "ScaleExpansive == 2");

                int w, h;
                AmbientLakeEngine.ComputeUnifiedEnvelopeSize(1920, 1080, AmbientLakeEngine.ScaleCompact, out w, out h);
                T.True(w == 960 && h == 346, "compact preset is 960x346 (50%x32%)");
                AmbientLakeEngine.ComputeUnifiedEnvelopeSize(1920, 1080, AmbientLakeEngine.ScaleBalanced, out w, out h);
                T.True(w == 1190 && h == 421, "balanced preset is 1190x421 (62%x39%)");
                AmbientLakeEngine.ComputeUnifiedEnvelopeSize(1920, 1080, AmbientLakeEngine.ScaleExpansive, out w, out h);
                T.True(w == 1382 && h == 486, "expansive preset is 1382x486 (72%x45%)");

                int defW, defH;
                AmbientLakeEngine.ComputePortalSize(1920, 1080, out defW, out defH);
                T.True(defW == 1190 && defH == 421, "default 4-arg ComputePortalSize forwards to balanced 1190x421");

                T.Eq(AmbientLakeEngine.ParseScalePreset("compact"), AmbientLakeEngine.ScaleCompact, "parses compact");
                T.Eq(AmbientLakeEngine.ParseScalePreset(" BALANCED "), AmbientLakeEngine.ScaleBalanced, "parses balanced case-insensitively");
                T.Eq(AmbientLakeEngine.ParseScalePreset("expansive"), AmbientLakeEngine.ScaleExpansive, "parses expansive");
                T.Eq(AmbientLakeEngine.ParseScalePreset("0"), AmbientLakeEngine.ScaleCompact, "parses 0");
                T.Eq(AmbientLakeEngine.ParseScalePreset("2"), AmbientLakeEngine.ScaleExpansive, "parses 2");
                T.Eq(AmbientLakeEngine.ParseScalePreset("unknown"), AmbientLakeEngine.ScaleBalanced, "unknown falls back to balanced");
                T.Eq(AmbientLakeEngine.ParseScalePreset(null), AmbientLakeEngine.ScaleBalanced, "null falls back to balanced");
            });

            T.Run("wallpaper scale: Midnight Lake and Aurora Silk share unified envelope across all 3 presets", () =>
            {
                int[] presets = { AmbientLakeEngine.ScaleCompact, AmbientLakeEngine.ScaleBalanced, AmbientLakeEngine.ScaleExpansive };
                int[][] screens = { new[] { 1920, 1080 }, new[] { 1280, 720 } };

                foreach (int[] scr in screens)
                {
                    int scrW = scr[0], scrH = scr[1];
                    foreach (int preset in presets)
                    {
                        int envW, envH;
                        AmbientLakeEngine.ComputeUnifiedEnvelopeSize(scrW, scrH, preset, out envW, out envH);

                        double minUnionW = double.MaxValue, maxUnionW = 0.0;
                        double minUnionH = double.MaxValue, maxUnionH = 0.0;

                        for (double sec = 0.0; sec <= 900.0; sec += 5.0)
                        {
                            double tMs = sec * 1000.0;

                            // 1. Midnight Lake frame matches exact unified envelope and stays inside screen bounds
                            AmbientLakeEngine.LakeRenderFrame lf;
                            AmbientLakeEngine.ComputeFrame(tMs, scrW, scrH, false, preset, out lf);
                            T.Eq(lf.PortalW, envW, "Lake PortalW matches envW preset=" + preset);
                            T.Eq(lf.PortalH, envH, "Lake PortalH matches envH preset=" + preset);
                            T.True(lf.PortalX >= 0 && lf.PortalX + lf.PortalW <= scrW, "Lake X inside screen t=" + sec);
                            T.True(lf.PortalY >= 0 && lf.PortalY + lf.PortalH <= scrH, "Lake Y inside screen t=" + sec);

                            // 2. Aurora Silk ribbons + motes union bounding box fits cleanly inside & fills unified envelope
                            double minX = double.MaxValue, minY = double.MaxValue;
                            double maxX = double.MinValue, maxY = double.MinValue;
                            for (int i = 0; i < AmbientLakeEngine.AuroraRibbonCount; i++)
                            {
                                IdleBackdropModel.AuroraRibbonMotion rm;
                                AmbientLakeEngine.ComputeAuroraRibbonMotion(i, tMs, scrW, scrH, false, preset, out rm);
                                if (rm.X < minX) minX = rm.X;
                                if (rm.Y < minY) minY = rm.Y;
                                if (rm.X + rm.W > maxX) maxX = rm.X + rm.W;
                                if (rm.Y + rm.H > maxY) maxY = rm.Y + rm.H;
                            }
                            for (int i = 0; i < AmbientLakeEngine.AuroraActiveMoteCount; i++)
                            {
                                IdleBackdropModel.MoteMotion mm;
                                AmbientLakeEngine.ComputeAuroraMoteMotion(i, tMs, scrW, scrH, false, preset, out mm);
                                if (mm.Alpha <= 0) continue;
                                if (mm.X < minX) minX = mm.X;
                                if (mm.Y < minY) minY = mm.Y;
                                if (mm.X + mm.Size > maxX) maxX = mm.X + mm.Size;
                                if (mm.Y + mm.Size > maxY) maxY = mm.Y + mm.Size;
                            }

                            T.True(minX >= 0.0 && maxX <= scrW + 0.5, "Aurora X inside screen preset=" + preset + " t=" + sec);
                            T.True(minY >= 0.0 && maxY <= scrH + 0.5, "Aurora Y inside screen preset=" + preset + " t=" + sec);

                            double uW = maxX - minX;
                            double uH = maxY - minY;
                            if (uW < minUnionW) minUnionW = uW;
                            if (uW > maxUnionW) maxUnionW = uW;
                            if (uH < minUnionH) minUnionH = uH;
                            if (uH > maxUnionH) maxUnionH = uH;
                        }

                        T.True(maxUnionW <= envW + 1.0, "Aurora max union width <= envW (" + maxUnionW.ToString("0.0") + " vs " + envW + ") preset=" + preset);
                        T.True(maxUnionH <= envH + 1.0, "Aurora max union height <= envH (" + maxUnionH.ToString("0.0") + " vs " + envH + ") preset=" + preset);
                        T.True(minUnionW >= envW * 0.80, "Aurora min union width fills >= 80% of envW (" + minUnionW.ToString("0.0") + " vs " + envW + ") preset=" + preset);
                        T.True(minUnionH >= envH * 0.62, "Aurora min union height fills >= 62% of envH (" + minUnionH.ToString("0.0") + " vs " + envH + ") preset=" + preset);
                    }
                }
            });

            T.Run("wallpaper scale: QD-OLED burn-in invariant over 15-min Lissajous sweep (0..900s step 5s)", () =>
            {
                const int W = 1920, H = 1080;
                uint[] mask = AmbientLakeEngine.BuildPureBlackPortalMaskPixels();
                uint[] swell = AmbientLakeEngine.BuildOpaqueSwellTilePixels();

                // Verify across all 3 presets, with balanced (62%x39%) as primary burn-in gate
                foreach (int preset in new[] { AmbientLakeEngine.ScaleCompact, AmbientLakeEngine.ScaleBalanced, AmbientLakeEngine.ScaleExpansive })
                {
                    // Track whether each pixel on 1920x1080 dropped <= #040404 at least once during t=0..900s (step 5s)
                    bool[] lakeCleared = new bool[W * H];
                    bool[] auroraCleared = new bool[W * H];

                    for (double sec = 0.0; sec <= 900.0; sec += 5.0)
                    {
                        double tMs = sec * 1000.0;

                        AmbientLakeEngine.LakeRenderFrame lf;
                        AmbientLakeEngine.ComputeFrame(tMs, W, H, false, preset, out lf);

                        // Mark every pixel outside the Midnight Lake portal bounding box as #000000 (<= #040404)
                        int px0 = Math.Max(0, lf.PortalX);
                        int py0 = Math.Max(0, lf.PortalY);
                        int px1 = Math.Min(W, lf.PortalX + lf.PortalW);
                        int py1 = Math.Min(H, lf.PortalY + lf.PortalH);

                        for (int y = 0; y < H; y++)
                        {
                            int row = y * W;
                            if (y < py0 || y >= py1)
                            {
                                Array.Fill(lakeCleared, true, row, W);
                            }
                            else
                            {
                                if (px0 > 0) Array.Fill(lakeCleared, true, row, px0);
                                if (px1 < W) Array.Fill(lakeCleared, true, row + px1, W - px1);
                                // Inside portal bounding box: outer mask border (mask == 0xFF000000) is also pure #000000
                                int my = ((y - lf.PortalY) * AmbientLakeEngine.MaskTexH) / Math.Max(1, lf.PortalH);
                                if (my >= 0 && my < AmbientLakeEngine.MaskTexH)
                                {
                                    int mRow = my * AmbientLakeEngine.MaskTexW;
                                    for (int x = px0; x < px1; x++)
                                    {
                                        if (lakeCleared[row + x]) continue;
                                        int mx = ((x - lf.PortalX) * AmbientLakeEngine.MaskTexW) / Math.Max(1, lf.PortalW);
                                        if (mx >= 0 && mx < AmbientLakeEngine.MaskTexW && mask[mRow + mx] == 0xFF000000u)
                                            lakeCleared[row + x] = true;
                                    }
                                }
                            }
                        }

                        // Aurora Silk: track union bounding box of ribbons + active motes at tMs
                        int aMinX = W, aMinY = H, aMaxX = 0, aMaxY = 0;
                        for (int i = 0; i < AmbientLakeEngine.AuroraRibbonCount; i++)
                        {
                            IdleBackdropModel.AuroraRibbonMotion rm;
                            AmbientLakeEngine.ComputeAuroraRibbonMotion(i, tMs, W, H, false, preset, out rm);
                            int rx0 = (int)Math.Floor(rm.X), ry0 = (int)Math.Floor(rm.Y);
                            int rx1 = (int)Math.Ceiling(rm.X + rm.W), ry1 = (int)Math.Ceiling(rm.Y + rm.H);
                            if (rx0 < aMinX) aMinX = rx0;
                            if (ry0 < aMinY) aMinY = ry0;
                            if (rx1 > aMaxX) aMaxX = rx1;
                            if (ry1 > aMaxY) aMaxY = ry1;
                        }
                        for (int i = 0; i < AmbientLakeEngine.AuroraActiveMoteCount; i++)
                        {
                            IdleBackdropModel.MoteMotion mm;
                            AmbientLakeEngine.ComputeAuroraMoteMotion(i, tMs, W, H, false, preset, out mm);
                            if (mm.Alpha <= 0) continue;
                            int mx0 = (int)Math.Floor(mm.X), my0 = (int)Math.Floor(mm.Y);
                            int mx1 = (int)Math.Ceiling(mm.X + mm.Size), my1 = (int)Math.Ceiling(mm.Y + mm.Size);
                            if (mx0 < aMinX) aMinX = mx0;
                            if (my0 < aMinY) aMinY = my0;
                            if (mx1 > aMaxX) aMaxX = mx1;
                            if (my1 > aMaxY) aMaxY = my1;
                        }
                        aMinX = Math.Max(0, aMinX);
                        aMinY = Math.Max(0, aMinY);
                        aMaxX = Math.Min(W, aMaxX);
                        aMaxY = Math.Min(H, aMaxY);
                        for (int y = 0; y < H; y++)
                        {
                            int row = y * W;
                            if (y < aMinY || y >= aMaxY)
                            {
                                Array.Fill(auroraCleared, true, row, W);
                            }
                            else
                            {
                                if (aMinX > 0) Array.Fill(auroraCleared, true, row, aMinX);
                                if (aMaxX < W) Array.Fill(auroraCleared, true, row + aMaxX, W - aMaxX);
                            }
                        }
                    }

                    int lakeStuck = 0, auroraStuck = 0;
                    for (int i = 0; i < lakeCleared.Length; i++)
                    {
                        if (!lakeCleared[i]) lakeStuck++;
                        if (!auroraCleared[i]) auroraStuck++;
                    }
                    T.Eq(lakeStuck, 0, "Midnight Lake clears every 1080p pixel to <= #040404 across 15-min Lissajous sweep preset=" + preset);
                    T.Eq(auroraStuck, 0, "Aurora Silk clears every 1080p pixel to <= #040404 across 15-min Lissajous sweep preset=" + preset);
                }

                // Also verify swell pixels are all opaque (A=255)
                T.True(swell.Length == AmbientLakeEngine.SwellTileW * AmbientLakeEngine.SwellTileH && (swell[0] >> 24) == 255u, "swell tile generated");
            });

            T.Run("wallpaper scale: zero managed allocations per frame and premultiplied ARGB / border invariants", () =>
            {
                // 1. Zero B/frame managed allocations in ComputeFrame, ComputeAuroraRibbonMotion, ComputeAuroraMoteMotion
                AmbientLakeEngine.LakeRenderFrame lf;
                IdleBackdropModel.AuroraRibbonMotion rm;
                IdleBackdropModel.MoteMotion mm;
                // Warm up JIT
                AmbientLakeEngine.ComputeFrame(1000.0, 1920, 1080, false, AmbientLakeEngine.ScaleBalanced, out lf);
                AmbientLakeEngine.ComputeAuroraRibbonMotion(0, 1000.0, 1920, 1080, false, AmbientLakeEngine.ScaleBalanced, out rm);
                AmbientLakeEngine.ComputeAuroraMoteMotion(0, 1000.0, 1920, 1080, false, AmbientLakeEngine.ScaleBalanced, out mm);

                long before = GC.GetAllocatedBytesForCurrentThread();
                for (int i = 0; i < 1000; i++)
                {
                    double t = i * 20.0;
                    AmbientLakeEngine.ComputeFrame(t, 1920, 1080, false, AmbientLakeEngine.ScaleBalanced, out lf);
                    AmbientLakeEngine.ComputeAuroraRibbonMotion(i % 3, t, 1920, 1080, false, AmbientLakeEngine.ScaleBalanced, out rm);
                    AmbientLakeEngine.ComputeAuroraMoteMotion(i % 6, t, 1920, 1080, false, AmbientLakeEngine.ScaleBalanced, out mm);
                }
                long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
                T.Eq(allocated, 0L, "zero managed bytes allocated across 1000 animation frames");

                // 2. BuildPureBlackPortalMaskPixels: premultiplied ARGB, pure #000000 3-px border, and wide lit inner aperture
                uint[] mask = AmbientLakeEngine.BuildPureBlackPortalMaskPixels();
                T.Eq(mask.Length, AmbientLakeEngine.MaskTexW * AmbientLakeEngine.MaskTexH, "mask exact pixel count");
                bool maskPremul = true, maskBorderPureBlack = true;
                int litCols = 0, litRows = 0;
                bool[] rowLit = new bool[AmbientLakeEngine.MaskTexH];
                bool[] colLit = new bool[AmbientLakeEngine.MaskTexW];
                for (int y = 0; y < AmbientLakeEngine.MaskTexH; y++)
                {
                    for (int x = 0; x < AmbientLakeEngine.MaskTexW; x++)
                    {
                        uint p = mask[y * AmbientLakeEngine.MaskTexW + x];
                        uint a = (p >> 24) & 0xFF, r = (p >> 16) & 0xFF, g = (p >> 8) & 0xFF, b = p & 0xFF;
                        if (r > a || g > a || b > a) maskPremul = false;
                        if (x <= 2 || x >= AmbientLakeEngine.MaskTexW - 3 || y <= 2 || y >= AmbientLakeEngine.MaskTexH - 3)
                        {
                            if (p != 0xFF000000u) maskBorderPureBlack = false;
                        }
                        if (a < 210)
                        {
                            rowLit[y] = true;
                            colLit[x] = true;
                        }
                    }
                }
                for (int x = 0; x < AmbientLakeEngine.MaskTexW; x++) if (colLit[x]) litCols++;
                for (int y = 0; y < AmbientLakeEngine.MaskTexH; y++) if (rowLit[y]) litRows++;
                T.True(maskPremul, "portal mask pixels are valid premultiplied ARGB (R,G,B <= A)");
                T.True(maskBorderPureBlack, "portal mask 3px perimeter is 100% pure opaque #000000");
                T.True(litCols >= (AmbientLakeEngine.MaskTexW * 55) / 100 && litRows >= (AmbientLakeEngine.MaskTexH * 55) / 100,
                    "portal mask visible aperture spans >= 55% width and height (" + litCols + "/" + AmbientLakeEngine.MaskTexW + ", " + litRows + "/" + AmbientLakeEngine.MaskTexH + ")");

                // 3. BuildAuroraSilkRibbonPixels: premultiplied ARGB and 0-alpha on all 4 borders
                uint[] silk = AmbientLakeEngine.BuildAuroraSilkRibbonPixels(192, 64, 79, 148, 255, 1.35, 0.13, 0.4, -0.06);
                T.Eq(silk.Length, 192 * 64, "silk ribbon exact pixel count");
                bool silkPremul = true, silkBorderZero = true, silkHasCore = false;
                for (int y = 0; y < 64; y++)
                {
                    for (int x = 0; x < 192; x++)
                    {
                        uint p = silk[y * 192 + x];
                        uint a = (p >> 24) & 0xFF, r = (p >> 16) & 0xFF, g = (p >> 8) & 0xFF, b = p & 0xFF;
                        if (r > a || g > a || b > a) silkPremul = false;
                        if (x == 0 || x == 191 || y == 0 || y == 63)
                        {
                            if (a != 0) silkBorderZero = false;
                        }
                        if (a > 120) silkHasCore = true;
                    }
                }
                T.True(silkPremul && silkHasCore, "silk ribbon pixels are valid premultiplied ARGB with luminous core");
                T.True(silkBorderZero, "silk ribbon has 0 alpha on all 4 borders");

                // 4. Swell and Ripple tiles premultiplied ARGB invariants
                uint[] swell = AmbientLakeEngine.BuildOpaqueSwellTilePixels();
                uint[] ripple = AmbientLakeEngine.BuildRippleTilePixels();
                bool swellOpaque = true, ripplePremul = true;
                for (int i = 0; i < swell.Length; i++) if ((swell[i] >> 24) != 255u) { swellOpaque = false; break; }
                for (int i = 0; i < ripple.Length; i++)
                {
                    uint p = ripple[i];
                    uint a = (p >> 24) & 0xFF, r = (p >> 16) & 0xFF, g = (p >> 8) & 0xFF, b = p & 0xFF;
                    if (r > a || g > a || b > a) { ripplePremul = false; break; }
                }
                T.True(swellOpaque, "swell tile is 100% opaque A=255");
                T.True(ripplePremul, "ripple tile is valid premultiplied ARGB");
            });

            T.Run("idle: Midnight Lake sub-pixel PortalFx/PortalFy + MaskPad quad, AnimClock 50/60 Hz lock & shift, and IsTunerReady ordering", () =>
            {
                // 1. Sub-pixel _waveMask quad + continuous fractional PortalFx/PortalFy tracking
                T.Eq(AmbientLakeEngine.MaskPad, 2, "AmbientLakeEngine.MaskPad == 2");
                AmbientLakeEngine.LakeRenderFrame f0, f1;
                AmbientLakeEngine.ComputeFrame(10000.0, 1920, 1080, false, AmbientLakeEngine.ScaleBalanced, out f0);
                AmbientLakeEngine.ComputeFrame(10020.0, 1920, 1080, false, AmbientLakeEngine.ScaleBalanced, out f1);
                double dfx = Math.Abs(f1.PortalFx - f0.PortalFx);
                double dfy = Math.Abs(f1.PortalFy - f0.PortalFy);
                T.True(dfx > 0.0 || dfy > 0.0, "PortalFx/PortalFy advance smoothly at 20ms vblank");
                T.True(dfx < 1.0 && dfy < 1.0, "20ms Lissajous drift is sub-pixel without multi-pixel jumps");
                T.Eq(f0.PortalX, (int)Math.Floor(f0.PortalFx), "PortalX matches Floor(PortalFx)");
                T.Eq(f0.PortalY, (int)Math.Floor(f0.PortalFy), "PortalY matches Floor(PortalFy)");

                // Verify ComputeSpriteSubpixelQuad tracks fractional offsets within safe padded UV bounds
                IdleBackdropModel.SubpixelQuad qA, qB;
                int maskTotalW = AmbientLakeEngine.MaskTexW + AmbientLakeEngine.MaskPad * 2;
                int maskTotalH = AmbientLakeEngine.MaskTexH + AmbientLakeEngine.MaskPad * 2;
                IdleBackdropModel.ComputeSpriteSubpixelQuad(
                    100.10, 200.25, 1190, 421,
                    AmbientLakeEngine.MaskTexW, AmbientLakeEngine.MaskTexH,
                    AmbientLakeEngine.MaskPad, maskTotalW, maskTotalH, out qA);
                IdleBackdropModel.ComputeSpriteSubpixelQuad(
                    100.60, 200.75, 1190, 421,
                    AmbientLakeEngine.MaskTexW, AmbientLakeEngine.MaskTexH,
                    AmbientLakeEngine.MaskPad, maskTotalW, maskTotalH, out qB);
                T.Eq(qA.X, qB.X, "same integer floor X maps to same integer quad origin");
                T.Eq(qA.Y, qB.Y, "same integer floor Y maps to same integer quad origin");
                T.True(qB.U0 < qA.U0 && qB.V0 < qA.V0, "sub-pixel +0.5 shift translates smoothly in UV space instead of 0");
                T.True(qA.U0 >= 0.5 && qA.U1 <= maskTotalW - 0.5 && qB.U0 >= 0.5 && qB.U1 <= maskTotalW - 0.5, "mask padded U stays inside safe opaque black perimeter");
                T.True(qA.V0 >= 0.5 && qA.V1 <= maskTotalH - 0.5 && qB.V0 >= 0.5 && qB.V1 <= maskTotalH - 0.5, "mask padded V stays inside safe opaque black perimeter");

                // 2. AnimClock first-interval 50 Hz lock, 50 <-> 60 Hz refresh shift handling, and late-callback cap
                var lockClk = new AnimClock(1.0 / 60.0, 0.05);
                double dt, rdt; bool real;
                lockClk.TryStep(10.000, out dt, out rdt, out real);
                lockClk.TryStep(10.020, out dt, out rdt, out real);
                T.True(Math.Abs(lockClk.PeriodEstimate - 0.020) < 1e-6, "AnimClock locks onto 50 Hz on first real interval without 60 Hz bias");
                T.True(Math.Abs(dt - 0.020) < 1e-6, "first measured 50 Hz interval outputs exact 20.0ms dt");

                // Shift from 50 Hz (20.0ms) to 60 Hz (16.67ms): 2 shifted frames immediately bridge gap, then settles within <1ms
                double tShift = 10.020;
                for (int i = 0; i < 2; i++)
                {
                    tShift += 1.0 / 60.0;
                    lockClk.TryStep(tShift, out dt, out rdt, out real);
                }
                T.True(lockClk.PeriodEstimate < 0.0186, "AnimClock immediately blends 50 Hz -> 60 Hz after 2 consecutive shifted frames (" + (lockClk.PeriodEstimate * 1000.0).ToString("0.00") + "ms)");
                for (int i = 2; i < 25; i++)
                {
                    tShift += 1.0 / 60.0;
                    lockClk.TryStep(tShift, out dt, out rdt, out real);
                }
                T.True(Math.Abs(lockClk.PeriodEstimate - (1.0 / 60.0)) < 0.001, "AnimClock adapts rapidly on 50 Hz -> 60 Hz shift (" + (lockClk.PeriodEstimate * 1000.0).ToString("0.00") + "ms)");

                // Shift back 60 Hz -> 50 Hz
                for (int i = 0; i < 2; i++)
                {
                    tShift += 0.020;
                    lockClk.TryStep(tShift, out dt, out rdt, out real);
                }
                T.True(lockClk.PeriodEstimate > 0.0180, "AnimClock immediately blends 60 Hz -> 50 Hz after 2 consecutive shifted frames (" + (lockClk.PeriodEstimate * 1000.0).ToString("0.00") + "ms)");
                for (int i = 2; i < 25; i++)
                {
                    tShift += 0.020;
                    lockClk.TryStep(tShift, out dt, out rdt, out real);
                }
                T.True(Math.Abs(lockClk.PeriodEstimate - 0.020) < 0.001, "AnimClock adapts rapidly on 60 Hz -> 50 Hz shift (" + (lockClk.PeriodEstimate * 1000.0).ToString("0.00") + "ms)");

                // Single late callback where |phaseErr| > 1.4 * _emaPeriod is capped at 1.5 * _emaPeriod (30ms at 50 Hz) instead of 50ms
                var capClk = new AnimClock(1.0 / 60.0, 0.05);
                capClk.TryStep(20.000, out dt, out rdt, out real);
                capClk.TryStep(20.020, out dt, out rdt, out real);
                capClk.TryStep(20.069, out dt, out rdt, out real); // 49ms single late callback (|phaseErr|=29ms > 28ms)
                T.True(dt <= 0.020 * 1.5 + 1e-6, "single late callback caps dt at 1.5x period (<=30ms) instead of 49-50ms");

                // Pause/Reset clears measured lock so next activation re-locks
                capClk.Pause();
                capClk.TryStep(30.000, out dt, out rdt, out real);
                capClk.TryStep(30.01667, out dt, out rdt, out real);
                T.True(Math.Abs(capClk.PeriodEstimate - 0.01667) < 1e-5, "Pause clears period lock for next vblank acquisition");

                // 3. IsTunerReady checks /tmp TV/shown flags FIRST before channels count or ext4 PID path
                var probedPaths = new List<string>();
                bool inactiveReady = IdleBackdropModel.IsTunerReady(
                    p => { probedPaths.Add("exists:" + p); return p == IdleBackdropModel.TunerChannelsFlag || p == IdleBackdropModel.TunerPidPath; },
                    p => { probedPaths.Add("read:" + p); return "0"; },
                    pid => true);
                T.True(!inactiveReady, "IsTunerReady returns false when neither /tmp TV flag exists");
                T.True(!probedPaths.Exists(s => s.Contains(IdleBackdropModel.TunerChannelsFlag) || s.Contains(IdleBackdropModel.TunerPidPath)),
                    "IsTunerReady avoids checking TunerChannelsFlag or ext4 TunerPidPath when /tmp flags are absent");
            });

            T.Run("idle: floating-point vertex zoom map factors and continuous portal-covering wave float quads", () =>
            {
                // 1. ComputeFloatMapZoomFactors reconstructs exact [fx, fx + fw] after two evas_map_util_zoom calls
                double[] fxs = { -600.125, -12.3456, 0.0, 0.375, 123.456789, 1920.875 };
                double[] fws = { 16.25, 210.5, 421.75, 1190.4, 1850.625 };
                foreach (double fx in fxs)
                {
                    foreach (double fw in fws)
                    {
                        double z1, z2;
                        IdleBackdropModel.ComputeFloatMapZoomFactors(fx, fw, out z1, out z2);
                        double x0AfterZ1 = 0.0 * z1;
                        double x1AfterZ1 = IdleBackdropModel.FloatMapBase * z1;
                        double cx = -IdleBackdropModel.FloatMapBase;
                        double p0 = cx + (x0AfterZ1 - cx) * z2;
                        double p1 = cx + (x1AfterZ1 - cx) * z2;
                        T.True(Math.Abs(p0 - fx) < 1e-9, "FloatMap left edge matches fx (" + fx + ")");
                        T.True(Math.Abs(p1 - (fx + fw)) < 1e-9, "FloatMap right edge matches fx+fw (" + (fx + fw) + ")");
                    }
                }

                double pfx, pfy, pfw, pfh;
                IdleBackdropModel.ComputePaddedFloatQuad(100.25, 200.75, 1190.0, 421.0,
                    AmbientLakeEngine.MaskTexW, AmbientLakeEngine.MaskTexH, AmbientLakeEngine.MaskPad,
                    AmbientLakeEngine.MaskTexW + AmbientLakeEngine.MaskPad * 2,
                    AmbientLakeEngine.MaskTexH + AmbientLakeEngine.MaskPad * 2,
                    out pfx, out pfy, out pfw, out pfh);
                T.True(pfx < 100.25 && pfy < 200.75 && pfx + pfw > 100.25 + 1190.0 && pfy + pfh > 200.75 + 421.0,
                    "ComputePaddedFloatQuad expands padded quad strictly around inner bounds");

                // 2. SwellQuadFx..Fh & RippleQuadFx..Fh strictly cover [PortalFx, PortalFx+PortalW] x [PortalFy, PortalFy+PortalH]
                int[] presets = { AmbientLakeEngine.ScaleCompact, AmbientLakeEngine.ScaleBalanced, AmbientLakeEngine.ScaleExpansive };
                foreach (int preset in presets)
                {
                    for (double sec = 0.0; sec <= 600.0; sec += 7.5)
                    {
                        AmbientLakeEngine.LakeRenderFrame lf;
                        AmbientLakeEngine.ComputeFrame(sec * 1000.0, 1920, 1080, false, preset, out lf);
                        T.True(lf.SwellQuadFx <= lf.PortalFx + 1e-9 && lf.SwellQuadFx + lf.SwellQuadFw >= lf.PortalFx + lf.PortalW - 1e-9,
                            "SwellQuad covers PortalFx width preset=" + preset + " sec=" + sec);
                        T.True(lf.SwellQuadFy <= lf.PortalFy + 1e-9 && lf.SwellQuadFy + lf.SwellQuadFh >= lf.PortalFy + lf.PortalH - 1e-9,
                            "SwellQuad covers PortalFy height preset=" + preset + " sec=" + sec);
                        T.True(lf.RippleQuadFx <= lf.PortalFx + 1e-9 && lf.RippleQuadFx + lf.RippleQuadFw >= lf.PortalFx + lf.PortalW - 1e-9,
                            "RippleQuad covers PortalFx width preset=" + preset + " sec=" + sec);
                        T.True(lf.RippleQuadFy <= lf.PortalFy + 1e-9 && lf.RippleQuadFy + lf.RippleQuadFh >= lf.PortalFy + lf.PortalH - 1e-9,
                            "RippleQuad covers PortalFy height preset=" + preset + " sec=" + sec);
                        T.True(lf.SwellTint > 0 && lf.RippleAlpha > 0, "uniform SwellTint and RippleAlpha populated");
                    }
                }

                // 3. Every 20ms vblank tick advances SwellQuad and RippleQuad smoothly with zero plateaus
                AmbientLakeEngine.LakeRenderFrame prev;
                AmbientLakeEngine.ComputeFrame(50000.0, 1920, 1080, false, AmbientLakeEngine.ScaleBalanced, out prev);
                bool anyPlateau = false;
                for (int k = 1; k <= 50; k++)
                {
                    AmbientLakeEngine.LakeRenderFrame cur;
                    AmbientLakeEngine.ComputeFrame(50000.0 + k * 20.0, 1920, 1080, false, AmbientLakeEngine.ScaleBalanced, out cur);
                    double swellMove = Math.Abs(cur.SwellQuadFx - prev.SwellQuadFx) + Math.Abs(cur.SwellQuadFy - prev.SwellQuadFy);
                    double rippleMove = Math.Abs(cur.RippleQuadFx - prev.RippleQuadFx) + Math.Abs(cur.RippleQuadFy - prev.RippleQuadFy);
                    if (swellMove <= 1e-6 || rippleMove <= 1e-6) anyPlateau = true;
                    prev = cur;
                }
                T.True(!anyPlateau, "SwellQuad and RippleQuad advance continuously at every 20ms tick without plateaus");
            });

            T.Run("Empty TV screensaver suppression: IdleConfig, live args, and keepalive policy", () =>
            {
                T.True(IdleBackdropModel.SuppressScreensaverKeepaliveSeconds >= 30.0 && IdleBackdropModel.SuppressScreensaverKeepaliveSeconds < 120.0,
                    "keepalive interval stays safely below Samsung Tizen 9 120s minimum screensaver timeout");

                var defCfg = IdleConfig.Parse("wallpaper", true, "5", "40");
                T.True(!defCfg.SuppressScreensaver, "SuppressScreensaver defaults to false");

                var supCfg = IdleConfig.Parse("wallpaper", true, "5", "40", true);
                T.True(supCfg.SuppressScreensaver, "SuppressScreensaver=true sets property");

                var liveOn = IdleConfig.ParseLiveArgs("wallpaper 1 5 1", 40, false);
                T.True(liveOn != null, "live 4-token args parse");
                T.Eq(liveOn.Mode, IdleMode.Wallpaper, "live mode");
                T.True(liveOn.AutoDock, "live autoDock");
                T.Eq(liveOn.PictureOffMinutes, 5, "live potOff");
                T.True(liveOn.SuppressScreensaver, "live 4th token 1 enables SuppressScreensaver");

                var liveOff = IdleConfig.ParseLiveArgs("clock 0 0 0", 40, true);
                T.True(liveOff != null && !liveOff.SuppressScreensaver, "live 4th token 0 disables SuppressScreensaver");

                var liveLegacy = IdleConfig.ParseLiveArgs("aurora 1 10", 40, true);
                T.True(liveLegacy != null && liveLegacy.SuppressScreensaver, "3-token live command preserves fallback SuppressScreensaver");

                T.True(!IdleBackdropModel.ShouldKeepScreensaverSuppressed(null, true, false, false, false), "null config never suppresses screensaver");
                T.True(!IdleBackdropModel.ShouldKeepScreensaverSuppressed(IdleConfig.Parse("off", false, "0", "40", true), true, false, false, false), "Off mode never suppresses screensaver");
                T.True(!IdleBackdropModel.ShouldKeepScreensaverSuppressed(defCfg, true, false, false, false), "SuppressScreensaver=false never suppresses screensaver");
                T.True(!IdleBackdropModel.ShouldKeepScreensaverSuppressed(supCfg, false, false, false, false), "hidden window (other apps/HDMI) never suppresses screensaver");
                T.True(!IdleBackdropModel.ShouldKeepScreensaverSuppressed(supCfg, true, true, false, false), "parked-for-screensaver never suppresses screensaver");
                T.True(!IdleBackdropModel.ShouldKeepScreensaverSuppressed(supCfg, true, false, true, false), "display off (standby/Picture Off) stops keepalive");
                T.True(!IdleBackdropModel.ShouldKeepScreensaverSuppressed(supCfg, true, false, false, true), "active real screensaver stops keepalive");
                T.True(IdleBackdropModel.ShouldKeepScreensaverSuppressed(supCfg, true, false, false, false), "visible active backdrop with SuppressScreensaver=true enables keepalive");

                // 1. Does nothing outside Empty TV when realScreensaver=false (e.g. disabled in TV settings or video playback)
                var ytSnap = new TvSnapshot { SourceType = -1, FullscreenAppId = IdleBackdropModel.CobaltYouTubeAppId, DisplayState = 1, WmStackActive = true };
                var mApp = new IdleBackdropModel(supCfg);
                T.Eq(mApp.Evaluate(ytSnap, 10.0, false, false, false), IdleAction.None, "does not take over during active YouTube playback");
                T.True(!mApp.ScreensaverTakeoverActive && !mApp.Visible, "remains hidden when Samsung screensaver has not triggered");
                T.True(!IdleBackdropModel.ShouldKeepScreensaverSuppressed(supCfg, mApp.Visible, mApp.HoldOcclusionForScreensaver, false, false), "keepalive stays off while hidden in 3rd-party app");

                // 2. Takes over when realScreensaver=true in 3rd-party app (even with AutoDock=true -> Show, never ShowWithDock), and stays visible after Samsung screensaver is dismissed
                var ytSsSnap = new TvSnapshot { SourceType = -1, FullscreenAppId = IdleBackdropModel.CobaltYouTubeAppId, PartialAppId = "com.samsung.tv.spotlight-ss", DisplayState = 1, WmStackActive = true, ScreensaverActive = true, ScreensaverProcessActive = true };
                T.Eq(mApp.Evaluate(ytSsSnap, 120.0, false, false, false), IdleAction.Show, "latches takeover with Show (never ShowWithDock) over YouTube");
                T.True(mApp.ScreensaverTakeoverActive && mApp.Visible && !mApp.HoldOcclusionForScreensaver, "ScreensaverTakeoverActive & Visible set");
                T.True(IdleBackdropModel.ShouldKeepScreensaverSuppressed(supCfg, mApp.Visible, mApp.HoldOcclusionForScreensaver, false, false), "keepalive turns on once takeover is visible");
                T.Eq(mApp.Evaluate(ytSnap, 121.0, false, false, false), IdleAction.None, "stays visible after DbusBus dismisses Samsung screensaver");
                T.True(mApp.ScreensaverTakeoverActive && mApp.Visible, "takeover stays latched after realScreensaver drops");
                T.True(!mApp.CanClaimBackKey(true, false, "", false, false, false, false), "CanClaimBackKey=false during takeover (_idleWin owns focus)");
                T.True(IdleBackdropModel.CanClaimExitKey(true, true, 13, true, false, false, false, true), "CanClaimExitKey=true during takeover even over HDMI/Live TV/Samsung Home");

                // 3. Key-release dismissal
                T.Eq(mApp.DismissScreensaverTakeover(130.0), IdleAction.Hide, "DismissScreensaverTakeover returns Hide when active");
                T.True(!mApp.ScreensaverTakeoverActive && !mApp.Visible, "DismissScreensaverTakeover clears takeover and Visible");
                T.True(mApp.WakeSuppressUntil >= 130.30, "WakeSuppressUntil set on dismissal");
                T.Eq(mApp.DismissScreensaverTakeover(131.0), IdleAction.None, "DismissScreensaverTakeover returns None when inactive");

                // 4. HDMI, Samsung Home, and Live TV takeover + ShouldDismissGuardedHome guard
                var hdmiSs = new TvSnapshot { SourceType = 13, DisplayState = 1, WmStackActive = true, WmScreensaverWinPresent = true, ScreensaverActive = true, ScreensaverProcessActive = true };
                var mHdmi = new IdleBackdropModel(supCfg);
                T.Eq(mHdmi.Evaluate(hdmiSs, 200.0, false, false, false), IdleAction.Show, "takes over screensaver on HDMI input");
                T.True(mHdmi.ScreensaverTakeoverActive && mHdmi.Visible, "HDMI takeover active");

                var homeSs = new TvSnapshot { SourceType = -1, FullscreenAppId = "com.samsung.tv.csfs", SamsungHomeRequested = true, DisplayState = 1, WmStackActive = true, WmScreensaverWinPresent = true, ScreensaverActive = true };
                var mHome = new IdleBackdropModel(supCfg);
                T.Eq(mHome.Evaluate(homeSs, 210.0, false, false, false), IdleAction.Show, "takes over screensaver on Samsung Home");
                T.True(!mHome.ShouldDismissGuardedHome(new TvSnapshot { SourceType = -1, FullscreenAppId = "com.samsung.tv.csfs", DisplayState = 1, WmStackActive = true }, 211.0), "does not kill underlying Samsung Home during takeover");

                var liveSs = new TvSnapshot { SourceType = 0, FullscreenAppId = IdleBackdropModel.TvViewerAppId, TunerActive = true, DisplayState = 1, WmStackActive = true, WmScreensaverWinPresent = true, ScreensaverActive = true };
                var mLive = new IdleBackdropModel(supCfg);
                T.Eq(mLive.Evaluate(liveSs, 220.0, false, false, false), IdleAction.Show, "takes over screensaver over Live TV");

                // 5. After idle Dim (when PictureOff=0) & Picture Off during takeover + Picture Off wake + Standby reset + Reconfigure + transition to Empty TV
                var dimSupCfg = IdleConfig.Parse("wallpaper", true, "0", "40", true);
                var mDim = new IdleBackdropModel(dimSupCfg);
                T.Eq(mDim.Evaluate(hdmiSs, 200.0, false, false, false), IdleAction.Show, "Dim takeover starts");
                T.Eq(mDim.Evaluate(new TvSnapshot { SourceType = 13, DisplayState = 1, WmStackActive = true }, 200.0 + IdleBackdropModel.DimAfterSeconds + 1.0, false, false, false), IdleAction.Dim, "DimAfterSeconds dims takeover backdrop");
                var potSupCfg = IdleConfig.Parse("wallpaper", false, "5", "40", true);
                var mPot = new IdleBackdropModel(potSupCfg);
                T.Eq(mPot.Evaluate(hdmiSs, 300.0, false, false, false), IdleAction.Show, "Picture-Off takeover starts");
                T.Eq(mPot.Evaluate(new TvSnapshot { SourceType = 13, DisplayState = 1, WmStackActive = true }, 600.0, false, false, false), IdleAction.TriggerLcdOff, "Picture-Off triggers after 5 min during takeover");
                T.Eq(mPot.Evaluate(new TvSnapshot { SourceType = 13, DisplayState = 3, WmStackActive = true }, 601.0, false, false, false), IdleAction.None, "keeps takeover latched while panel is in After-idle Picture Off");
                T.True(mPot.ScreensaverTakeoverActive && mPot.Visible, "Picture-Off keeps takeover active until user wakes");
                T.Eq(mPot.Evaluate(new TvSnapshot { SourceType = 13, DisplayState = 1, WmStackActive = true }, 610.0, false, false, false), IdleAction.Hide, "waking from After-idle Picture Off hides takeover back to HDMI");
                T.True(!mPot.ScreensaverTakeoverActive && !mPot.Visible, "Picture-Off wake clears takeover");

                // OnRawKey while displayOff during takeover clears takeover and sets hideBackdrop
                var mKeyWake2 = new IdleBackdropModel(potSupCfg);
                mKeyWake2.Evaluate(hdmiSs, 700.0, false, false, false);
                mKeyWake2.Evaluate(new TvSnapshot { SourceType = 13, DisplayState = 1, WmStackActive = true }, 1001.0, false, false, false);
                mKeyWake2.Evaluate(new TvSnapshot { SourceType = 13, DisplayState = 3, WmStackActive = true }, 1002.0, false, false, false);
                bool keyWakeHide;
                T.True(mKeyWake2.OnRawKey(116, 63, 1005.0, true, false, out keyWakeHide) && keyWakeHide && !mKeyWake2.ScreensaverTakeoverActive && !mKeyWake2.Visible, "power wake during Picture-Off takeover clears takeover and requests hideBackdrop");

                // Real TV standby (without PictureOff) clears takeover
                var mStandby = new IdleBackdropModel(supCfg);
                mStandby.Evaluate(hdmiSs, 800.0, false, false, false);
                T.Eq(mStandby.Evaluate(new TvSnapshot { SourceType = 13, DisplayState = 3, WmStackActive = true }, 805.0, false, false, false), IdleAction.Hide, "real standby hides takeover");
                T.True(!mStandby.ScreensaverTakeoverActive && !mStandby.Visible, "real standby clears takeover");

                // Underlying app exits to Empty TV during takeover -> clears takeover, keeps Visible=true
                var mToEmpty = new IdleBackdropModel(supCfg);
                mToEmpty.Evaluate(ytSsSnap, 900.0, false, false, false);
                var emptySnap = new TvSnapshot { SourceType = 0, FullscreenAppId = IdleBackdropModel.TvViewerAppId, DisplayState = 1, WmStackActive = true };
                mToEmpty.Evaluate(emptySnap, 902.0, false, false, false);
                T.True(!mToEmpty.ScreensaverTakeoverActive && mToEmpty.Visible, "exiting app to Empty TV clears ScreensaverTakeoverActive while keeping Visible");

                // Live Reconfigure with SuppressScreensaver=false clears ScreensaverTakeoverActive
                var mReconf = new IdleBackdropModel(supCfg);
                mReconf.Evaluate(hdmiSs, 950.0, false, false, false);
                mReconf.Reconfigure(defCfg, 951.0);
                T.True(!mReconf.ScreensaverTakeoverActive, "Reconfigure with SuppressScreensaver=false clears takeover");

                // 6. WM Layer-250 stacking during takeover (even when allowSamsungHome=true, partialActive=true, screensaverActive=true)
                var mockWm = new FakeWmBackend(new List<WmStackLogic.WinInfo>
                {
                    new WmStackLogic.WinInfo { WinId = 10, Title = "tvlauncher", Layer = 250, Width = 1920, Height = 1080, Visible = true },
                    new WmStackLogic.WinInfo { WinId = 20, Title = "/opt/usr/apps/com.samsung.tv.csfs/bin/csfs.dll", Layer = 250, Width = 1920, Height = 1080, Visible = true },
                    new WmStackLogic.WinInfo { WinId = 2422, Title = "vetro-idle", Layer = 200, Width = 1920, Height = 1080, Visible = true }
                }, WmStackLogic.LayerNormal);
                bool wmAct = false, wmProbed = false;
                uint wmIdleId = 0;
                WmStackObservation wmObs;
                WmStackLogic.Step(mockWm, true, false, true, false, true, ref wmAct, ref wmProbed, ref wmIdleId, out wmObs, null, false, null, 0, null, true);
                T.Eq(mockWm.IdleLayer, WmStackLogic.LayerShield, "takeover forces vetro-idle to LayerShield (250) despite allowSamsungHome/partialActive/screensaverActive");
                T.True(mockWm.StackCalls.Contains("2422:20:1"), "takeover stacks vetro-idle above homeWin regardless of allowSamsungHome");
                T.True(mockWm.StackCalls.Contains("2422:10:0"), "takeover keeps vetro-idle below bottomOverlayWin (tvlauncher)");

                // 7. System overlay (Settings / org.tizen.menu) exclusion and idleWin == 0 overlay promotion
                T.True(WmStackLogic.IsSystemBackgroundWindow("org.tizen.menu.dll"), "org.tizen.menu.dll is excluded as system overlay");
                T.True(!WmStackLogic.IsLayer200UserAppWindow(new WmStackLogic.WinInfo { WinId = 55, Title = "org.tizen.menu.dll", Layer = 200, Width = 1920, Height = 1080, Visible = true }), "org.tizen.menu.dll is never classified as Layer-200 user app");
                T.Eq(WmStackLogic.ResolveLaunchSyncAppId("org.tizen.menu.dll", "org.tizen.menu", ""), "", "ResolveLaunchSyncAppId never returns org.tizen.menu");
                T.True(WmStackLogic.IsSystemOverlayAppId("org.tizen.menu"), "IsSystemOverlayAppId flags org.tizen.menu");

                var menuLaunchBackend = new FakeWmBackend(new List<WmStackLogic.WinInfo>
                {
                    new WmStackLogic.WinInfo { WinId = 1, Title = "vetro-idle", Layer = 200, Width = 1920, Height = 1080, Visible = true },
                    new WmStackLogic.WinInfo { WinId = 2, Title = "tv-viewer", Layer = 200, Width = 1920, Height = 1080, Visible = true }
                }, WmStackLogic.LayerNormal);
                var menuState = new WmLaunchState { TargetAppId = "org.tizen.menu", TargetLabel = "Settings", StartedAtMs = 1000 };
                bool mAct = false, mProbed = false;
                uint mIdleId = 0;
                WmStackObservation mObs;
                WmStackLogic.Step(menuLaunchBackend, false, false, false, false, false, ref mAct, ref mProbed, ref mIdleId, out mObs, null, true, menuState, 1000, () => "org.tizen.tv-viewer");
                menuLaunchBackend.Windows = new List<WmStackLogic.WinInfo>
                {
                    new WmStackLogic.WinInfo { WinId = 55, Title = "org.tizen.menu.dll", Layer = 200, Width = 1920, Height = 1080, Visible = true },
                    new WmStackLogic.WinInfo { WinId = 1, Title = "vetro-idle", Layer = 200, Width = 1920, Height = 1080, Visible = true },
                    new WmStackLogic.WinInfo { WinId = 2, Title = "tv-viewer", Layer = 200, Width = 1920, Height = 1080, Visible = true }
                };
                WmStackLogic.Step(menuLaunchBackend, false, false, false, false, false, ref mAct, ref mProbed, ref mIdleId, out mObs, null, true, menuState, 1400, () => "org.tizen.tv-viewer");
                T.Eq(menuLaunchBackend.SyncedFullscreenAppId, null, "launching org.tizen.menu never poisons current_fullscreen_appid");

                var noIdleBackend = new FakeWmBackend(new List<WmStackLogic.WinInfo>
                {
                    new WmStackLogic.WinInfo { WinId = 77, Title = "vetro-numpad", Layer = 40, Width = 1100, Height = 200, Visible = true },
                    new WmStackLogic.WinInfo { WinId = 88, Title = "Nuvio TV", Layer = 200, Width = 1920, Height = 1080, Visible = true }
                }, WmStackLogic.LayerNormal);
                bool niAct = false, niProbed = false;
                uint niIdleId = 0;
                WmStackObservation niObs;
                WmStackLogic.Step(noIdleBackend, false, false, false, false, false, ref niAct, ref niProbed, ref niIdleId, out niObs, null);
                T.True(noIdleBackend.PromotedOverlayCalls.Contains("77->500"), "vetro-numpad promotes to Layer 500 even when idleWin == 0");
            });
        }
    }
}
