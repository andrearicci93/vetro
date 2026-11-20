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

        private static long _allocSink;
        private static long MeasureMinAlloc(Action body)
        {
            for (int w = 0; w < 3; w++) body();
            long min = long.MaxValue;
            for (int pass = 0; pass < 3; pass++)
            {
                long before = GC.GetAllocatedBytesForCurrentThread();
                body();
                long alloc = GC.GetAllocatedBytesForCurrentThread() - before;
                if (alloc < min) min = alloc;
                if (min == 0L) break;
            }
            return min;
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
                if (!File.Exists("/bin/sh")) { Console.WriteLine("  SKIP: /bin/sh unavailable"); return; }
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
                if (!File.Exists("/bin/sh")) { Console.WriteLine("  SKIP: /bin/sh unavailable"); return; }
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
            });

            T.Run("Samsung Home: csfs, with Samsung's Home-key bundle on root-app firmware; the component package is never launched", () =>
            {
                if (!File.Exists("/bin/sh")) { Console.WriteLine("  SKIP: /bin/sh unavailable"); return; }
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
                if (!File.Exists("/bin/sh")) { Console.WriteLine("  SKIP: /bin/sh unavailable"); return; }
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
                var optical = OutputPickerModel.Build(paired, 1);
                T.True(!optical[0].Active && optical[1].Kind == OutputKind.External && optical[1].Label == "Optical" && optical[1].Active, "optical (1): its own ticked row, the TV speakers unticked");
                T.Eq(OutputPickerModel.ActionFor(optical[1]), OutputAction.None, "the external output that plays cannot be chosen again");
                T.True(OutputPickerModel.Build(null, 2)[1].Label == "Receiver (HDMI)" && OutputPickerModel.ExternalName(0) == null && OutputPickerModel.ExternalName(5) == null, "route names");
                T.True(OutputPickerModel.VetroSetsLevel(0) && OutputPickerModel.VetroSetsLevel(5) && OutputPickerModel.VetroSetsLevel(-1) && OutputPickerModel.VetroSetsLevel(1) && OutputPickerModel.VetroSetsLevel(9) && OutputPickerModel.VetroSetsLevel(4), "Vol stays with Vetro on TV speakers, Bluetooth, optical (as up to preview8), TV + optical, Wi-Fi");
                T.True(!OutputPickerModel.VetroSetsLevel(2) && !OutputPickerModel.VetroSetsLevel(8) && !OutputPickerModel.VetroSetsLevel(12) && !OutputPickerModel.VetroSetsLevel(17), "only a receiver on HDMI gets Vol back from Samsung");
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

            T.Run("list watch: HbbtvLink changes are detected by ListWatch.Same", () =>
            {
                const string svt1 = "https://hbbtv.play.svt.se/v2/index.xhtml";
                const string svt2 = "https://hbbtv.play.svt.se/v3/index.xhtml";
                var a = Catalog.Parse("svt\tSVT Play\t5exPmCT0nz.svtplay\t\t\t\t\tapp:5exPmCT0nz.svtplay\t" + svt1 + "\n").Entries;
                var aSame = Catalog.Parse("svt\tSVT Play\t5exPmCT0nz.svtplay\t\t\t\t\tapp:5exPmCT0nz.svtplay\t" + svt1 + "\n").Entries;
                var aDiff = Catalog.Parse("svt\tSVT Play\t5exPmCT0nz.svtplay\t\t\t\t\tapp:5exPmCT0nz.svtplay\t" + svt2 + "\n").Entries;
                var aNone = Catalog.Parse("svt\tSVT Play\t5exPmCT0nz.svtplay\t\t\t\t\tapp:5exPmCT0nz.svtplay\n").Entries;
                T.True(ListWatch.Same(a, aSame), "identical entries including HbbtvLink match");
                T.True(!ListWatch.Same(a, aDiff), "changed HbbtvLink triggers reload");
                T.True(!ListWatch.Same(a, aNone), "removed HbbtvLink triggers reload");
                T.True(!ListWatch.Same(aNone, a), "added HbbtvLink triggers reload");
            });

            T.Run("tasks: allocation-free ParseStat handles spaces, nested parens, exact bounds and errors", () =>
            {
                int pid, ppid; long ticks;
                string full = "1234 (Web Process (1)) S 567 567 567 0 -1 4194304 100 0 0 0 321 45 0 0 20 0 12 0 9999 0 0 0 0 0 0 0 0 0 0 0 0 0 0 17 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n";
                T.True(Tasks.ParseStat(full, out pid, out ppid, out ticks), "full 52-field stat parsed");
                T.Eq(pid, 1234, "pid"); T.Eq(ppid, 567, "ppid"); T.Eq(ticks, 366L, "utime + stime");

                string exact13 = "42 (app) R 1 0 0 0 0 0 0 0 0 0 10 20";
                T.True(Tasks.ParseStat(exact13, out pid, out ppid, out ticks), "exact 13 post-comm fields parsed");
                T.Eq(pid, 42, "exact pid"); T.Eq(ppid, 1, "exact ppid"); T.Eq(ticks, 30L, "exact ticks");

                string short12 = "42 (app) R 1 0 0 0 0 0 0 0 0 0 10";
                T.True(!Tasks.ParseStat(short12, out pid, out ppid, out ticks), "12 post-comm fields rejected");
                T.True(pid == 0 && ppid == 0 && ticks == 0, "failed parse leaves outputs zero");

                T.True(!Tasks.ParseStat(null, out pid, out ppid, out ticks), "null rejected");
                T.True(!Tasks.ParseStat("", out pid, out ppid, out ticks), "empty rejected");
                T.True(!Tasks.ParseStat("123 no-parens S 1 0 0 0 0 0 0 0 0 0 1 2", out pid, out ppid, out ticks), "missing ')' rejected");
                T.True(!Tasks.ParseStat("abc (app) S 1 0 0 0 0 0 0 0 0 0 1 2", out pid, out ppid, out ticks), "bad pid rejected");
                T.True(!Tasks.ParseStat("1 (app) S x 0 0 0 0 0 0 0 0 0 1 2", out pid, out ppid, out ticks), "bad ppid rejected");
                T.True(!Tasks.ParseStat("1 (app) S 1 0 0 0 0 0 0 0 0 0 x 2", out pid, out ppid, out ticks), "bad utime rejected");
                T.True(!Tasks.ParseStat("1 (app) S 1 0 0 0 0 0 0 0 0 0 1 x", out pid, out ppid, out ticks), "bad stime rejected");
                T.True(!Tasks.ParseStat("1 (app) S  1 0 0 0 0 0 0 0 0 0 1 2", out pid, out ppid, out ticks), "double space before ppid rejected");

                // Warm up Tier-1 JIT/OSR and verify zero allocations per ParseStat call.
                long alloc = MeasureMinAlloc(() =>
                {
                    int lp, lpp; long lt, s = 0;
                    for (int i = 0; i < 10000; i++) { Tasks.ParseStat(full, out lp, out lpp, out lt); s += lt; }
                    _allocSink = s;
                });
                T.Eq(alloc, 0L, "ParseStat allocates 0 bytes over 10000 calls (sink " + _allocSink + ")");
            });

            T.Run("hold key: consuming a press with Press()+Fire() blocks repeats and release tap", () =>
            {
                var h = new HoldKey();
                T.True(h.Press(), "initial press consumed");
                T.Eq(h.Fire(), HoldResult.Hold, "marked fired");
                T.True(!h.Press(), "auto-repeat while still held is ignored");
                T.Eq(h.Release(), HoldResult.None, "release after move-finish does not fire Tap");
                T.True(h.Press(), "next fresh press works");
                T.Eq(h.Release(), HoldResult.Tap, "fresh press taps normally");
            });

            T.Run("icon prep: int32 BoxPass has no underflow or overflow, and Scale/Rim match direct references", () =>
            {
                // Full-white 112x112 with large radius: no int32 overflow.
                int big = 112;
                var white = new uint[big * big];
                for (int i = 0; i < white.Length; i++) white[i] = 0xFFFFFFFFu;
                IconPrep.Blur(white, big, 16);
                T.Eq(white[0], 0xFFFFFFFFu, "white corner stays white");
                T.Eq(white[big * big / 2], 0xFFFFFFFFu, "white center stays white");

                // High-contrast 0xFFFFFFFF -> 0x00000000 step: verifies no uint sliding-window underflow.
                const int s = 20, rad = 3;
                uint[] step = new uint[s * s], expected = new uint[s * s];
                for (int y = 0; y < s; y++)
                    for (int x = 0; x < s; x++)
                        step[y * s + x] = expected[y * s + x] = (x < s / 2) ? 0xFFFFFFFFu : 0x00000000u;
                IconPrep.Blur(step, s, rad);
                var tmp = new uint[expected.Length];
                int n = 2 * rad + 1;
                Action<uint[], uint[], bool> refPass = (src, dst, horiz) =>
                {
                    for (int line = 0; line < s; line++)
                        for (int i = 0; i < s; i++)
                        {
                            int sa = 0, sr = 0, sg = 0, sb = 0;
                            for (int k = -rad; k <= rad; k++)
                            {
                                int c = Math.Max(0, Math.Min(s - 1, i + k));
                                uint p = src[horiz ? line * s + c : c * s + line];
                                sa += (int)((p >> 24) & 0xFF); sr += (int)((p >> 16) & 0xFF);
                                sg += (int)((p >> 8) & 0xFF); sb += (int)(p & 0xFF);
                            }
                            dst[horiz ? line * s + i : i * s + line] = ((uint)(sa / n) << 24) | ((uint)(sr / n) << 16) | ((uint)(sg / n) << 8) | (uint)(sb / n);
                        }
                };
                for (int p = 0; p < 3; p++) { refPass(expected, tmp, true); refPass(tmp, expected, false); }
                for (int i = 0; i < step.Length; i++) T.Eq(step[i], expected[i], "step blur pixel " + i);

                // Hoisted Scale matches direct bilinear reference.
                const int sw = 19, sh = 13, dw = 27, dh = 17;
                var img = new uint[sw * sh];
                for (int i = 0; i < img.Length; i++)
                    img[i] = ((uint)(120 + (i * 7 % 135)) << 24) | ((uint)(i * 13 % 256) << 16) | ((uint)(i * 29 % 256) << 8) | (uint)(i * 43 % 256);
                uint[] scaled = IconPrep.Scale(img, sw, sh, dw, dh);
                double sx = sw / (double)dw, sy = sh / (double)dh;
                for (int y = 0; y < dh; y++)
                {
                    double fy = (y + 0.5) * sy - 0.5; int y0 = (int)Math.Floor(fy); double wy = fy - y0;
                    int ya = Math.Max(0, Math.Min(sh - 1, y0)), yb = Math.Max(0, Math.Min(sh - 1, y0 + 1));
                    for (int x = 0; x < dw; x++)
                    {
                        double fx = (x + 0.5) * sx - 0.5; int x0 = (int)Math.Floor(fx); double wx = fx - x0;
                        int xa = Math.Max(0, Math.Min(sw - 1, x0)), xb = Math.Max(0, Math.Min(sw - 1, x0 + 1));
                        uint p00 = img[ya * sw + xa], p10 = img[ya * sw + xb], p01 = img[yb * sw + xa], p11 = img[yb * sw + xb];
                        uint refPx = 0;
                        for (int shf = 0; shf <= 24; shf += 8)
                        {
                            double top = ((p00 >> shf) & 0xFF) * (1 - wx) + ((p10 >> shf) & 0xFF) * wx;
                            double bot = ((p01 >> shf) & 0xFF) * (1 - wx) + ((p11 >> shf) & 0xFF) * wx;
                            refPx |= (uint)Math.Round(top * (1 - wy) + bot * wy) << shf;
                        }
                        T.Eq(scaled[y * dw + x], refPx, "scale pixel " + x + "," + y);
                    }
                }

                // Hoisted Rim matches direct SDF reference.
                const int rs = 32, rr = 6;
                uint[] rimA = new uint[rs * rs], rimRef = new uint[rs * rs];
                for (int i = 0; i < rimA.Length; i++) rimA[i] = rimRef[i] = 0xFF204060u;
                IconPrep.Rim(rimA, rs, rr, 1.5f, 0.35f);
                double half = rs / 2.0, inner = half - rr;
                for (int y = 0; y < rs; y++)
                    for (int x = 0; x < rs; x++)
                    {
                        double qx = Math.Abs(x + 0.5 - half) - inner, qy = Math.Abs(y + 0.5 - half) - inner;
                        double outside = Math.Sqrt(Math.Max(qx, 0) * Math.Max(qx, 0) + Math.Max(qy, 0) * Math.Max(qy, 0)) + Math.Min(Math.Max(qx, qy), 0) - rr;
                        double depth = -outside, cov = Math.Max(0.0, Math.Min(1.0, 1.5f - depth + 0.5));
                        if (depth >= -0.5 && cov > 0.0)
                        {
                            uint p = rimRef[y * rs + x], a = p >> 24;
                            double wgt = cov * 0.35f;
                            uint r = (uint)Math.Round(((p >> 16) & 0xFF) * (1 - wgt) + a * wgt);
                            uint g = (uint)Math.Round(((p >> 8) & 0xFF) * (1 - wgt) + a * wgt);
                            uint b = (uint)Math.Round((p & 0xFF) * (1 - wgt) + a * wgt);
                            rimRef[y * rs + x] = (a << 24) | (Math.Min(r, a) << 16) | (Math.Min(g, a) << 8) | Math.Min(b, a);
                        }
                    }
                for (int i = 0; i < rimA.Length; i++) T.Eq(rimA[i], rimRef[i], "rim pixel " + i);
            });

            T.Run("input devices: PruneFailed removes disconnected nodes so InputScanGate goes quiet again", () =>
            {
                var failed = new HashSet<string>(StringComparer.Ordinal) { "/dev/input/event3", "/dev/input/event7" };
                InputDevices.PruneFailed(failed, new List<string> { "/dev/input/event3", "/dev/input/event4" });
                T.Eq(failed.Count, 1, "disconnected node pruned, still-present node kept");
                T.True(failed.Contains("/dev/input/event3"), "still-present failed node kept");
                InputDevices.PruneFailed(failed, new List<string> { "/dev/input/event4" });
                T.Eq(failed.Count, 0, "all failed nodes disconnected -> empty set");
                var gate = new InputScanGate();
                long t0 = 1_000_000_000L;
                T.True(gate.ShouldRead(100, t0), "initial scan reads");
                gate.Read(100, t0, failed.Count == 0);
                T.True(!gate.ShouldRead(100, t0 + TimeSpan.TicksPerSecond * 5), "clean scan lets gate stay quiet when /dev/input unchanged");
                gate.Force();
                T.True(gate.ShouldRead(100, t0 + TimeSpan.TicksPerSecond * 5), "Force() triggers rescan even when /dev/input unchanged");
            });

            T.Run("tasks: allocation-free PrivateKbFromStatm and SwapKbFromStatus handle edge cases with 0 bytes allocated", () =>
            {
                T.Eq(Tasks.PrivateKbFromStatm("1000 400 100 5 0 200 0\n", 4), 1200L, "resident - shared * pageKb");
                T.Eq(Tasks.PrivateKbFromStatm("  1000 100 150  ", 4), 0L, "shared > resident clamps to 0");
                T.Eq(Tasks.PrivateKbFromStatm("1000 400", 4), 0L, "too few fields");
                T.Eq(Tasks.PrivateKbFromStatm("1000  400 100", 4), 0L, "double space rejected like Split");
                T.Eq(Tasks.PrivateKbFromStatm("", 4), 0L, "empty statm");

                string status = "Name:\tapp\nVmRSS:\t  5000 kB\nVmSwap:\t   1234 kB\nThreads:\t2\n";
                T.Eq(Tasks.SwapKbFromStatus(status), 1234L, "VmSwap parsed");
                T.Eq(Tasks.SwapKbFromStatus("VmSwap:   42"), 42L, "VmSwap without kB or trailing newline");
                T.Eq(Tasks.SwapKbFromStatus("Name:\tapp\nVmRSS:\t5000 kB\n"), 0L, "absent VmSwap");
                T.Eq(Tasks.SwapKbFromStatus("VmSwap:\tbad kB\n"), 0L, "malformed VmSwap");

                const string statm = "12345 4567 1234 5 0 2000 0\n";
                long alloc = MeasureMinAlloc(() =>
                {
                    long s = 0;
                    for (int i = 0; i < 10000; i++)
                    {
                        s += Tasks.PrivateKbFromStatm(statm, 4);
                        s += Tasks.SwapKbFromStatus(status);
                    }
                    _allocSink = s;
                });
                T.Eq(alloc, 0L, "PrivateKbFromStatm + SwapKbFromStatus allocate 0 bytes over 10000 calls (sink " + _allocSink + ")");
            });

            T.Run("picture modes: cached check answer matches SDR switches and falls back on HDR or unoffered modes", () =>
            {
                // Candidates indices: 0=65536 (Dynamic SDR), 3=65537 (Standard SDR), 4=393216 (Standard HDR), 12=65538 (Movie SDR), 20=655360 (Filmmaker SDR)
                var lines = new string[PictureModes.Candidates.Length];
                for (int i = 0; i < lines.Length; i++) lines[i] = (i == 0 || i == 3 || i == 12) ? "i 1" : "i 0";
                string sdrChecks = string.Join("\n", lines) + "\n";

                ChoiceState sdr = PictureModes.Build("ii 65537 0", sdrChecks);
                T.True(PictureModes.CacheCovers(sdr, 65537), "Standard SDR covered by cached SDR check");
                T.True(sdr.Rows.Exists(r => r.Active && r.Value == 65537), "Standard SDR active");

                ChoiceState switched = PictureModes.Build("ii 65538 0", sdrChecks);
                T.True(PictureModes.CacheCovers(switched, 65538), "Movie SDR covered by same cached SDR check (2 busctl instead of 24)");
                T.True(switched.Rows.Exists(r => r.Active && r.Value == 65538), "Movie SDR active");

                ChoiceState newHome = PictureModes.Build("ii " + PictureModes.NewHome + " 0", sdrChecks);
                T.True(PictureModes.CacheCovers(newHome, PictureModes.NewHome), "NewHome covered by cached check with choosable list");

                ChoiceState hdrSignal = PictureModes.Build("ii 393216 0", sdrChecks);
                T.True(!PictureModes.CacheCovers(hdrSignal, 393216), "HDR Standard shares name with SDR Standard but has different Value -> cache miss forces fresh check");

                ChoiceState unoffered = PictureModes.Build("ii 655360 0", sdrChecks);
                T.True(!PictureModes.CacheCovers(unoffered, 655360), "Unoffered Filmmaker mode sets Choosable=false -> cache miss forces fresh check");
            });

            T.Run("round 3: zero-alloc CommandBuffer, MemAvailableFromMeminfo, ShardCard.Clean fast-path, and TaskController clamping", () =>
            {
                // CommandBuffer zero-allocation verification over 10,000 feeds
                var cb = new CommandBuffer();
                byte[] cmdBytes = System.Text.Encoding.ASCII.GetBytes("volup\nVOLDOWN\n  toggle \nunknown\n");
                for (int i = 0; i < 500; i++) cb.Feed(cmdBytes, cmdBytes.Length);
                long b0 = GC.GetAllocatedBytesForCurrentThread();
                int totalCmds = 0;
                for (int i = 0; i < 10000; i++) totalCmds += cb.Feed(cmdBytes, cmdBytes.Length).Count;
                long b1 = GC.GetAllocatedBytesForCurrentThread();
                T.Eq(totalCmds, 30000, "all 3 valid commands decoded per feed");
                T.Eq(b1 - b0, 0L, "CommandBuffer.Feed allocates 0 bytes over 10000 calls");

                // MemAvailableFromMeminfo edge cases & 0-byte allocation verification
                string meminfo = "MemTotal:        1536000 kB\nMemFree:          120000 kB\nMemAvailable:     456789 kB\nBuffers:           32000 kB\n";
                T.Eq(Tasks.MemAvailableFromMeminfo(meminfo), 456789L, "MemAvailable parsed");
                T.Eq(Tasks.MemAvailableFromMeminfo("MemAvailable: 900"), 900L, "MemAvailable without kB or newline");
                T.Eq(Tasks.MemAvailableFromMeminfo("MemTotal: 1000 kB\n"), -1L, "absent MemAvailable");
                T.Eq(Tasks.MemAvailableFromMeminfo(""), -1L, "empty meminfo");
                for (int i = 0; i < 500; i++) Tasks.MemAvailableFromMeminfo(meminfo);
                long m0 = GC.GetAllocatedBytesForCurrentThread();
                long mSink = 0;
                for (int i = 0; i < 10000; i++) mSink += Tasks.MemAvailableFromMeminfo(meminfo);
                long m1 = GC.GetAllocatedBytesForCurrentThread();
                T.Eq(m1 - m0, 0L, "MemAvailableFromMeminfo allocates 0 bytes over 10000 calls (sink " + mSink + ")");

                // TaskController.SetCount & Select mid-animation clamping
                bool prevInstant = Controller.Instant;
                try
                {
                    Controller.Instant = false;
                    var tc = new TaskController();
                    tc.Open(1f);
                    tc.SetCount(5);
                    tc.Select(4);
                    T.Eq(tc.SelPos, 4f, "started at row 4");
                    tc.Key("Up");
                    tc.Key("Up");   // Selected = 2, _from = 4, SelPos still 4
                    tc.Tick(0.03);  // SelPos between 4 and 2
                    T.True(tc.SelPos > 3f && tc.SelPos < 4f, "mid-animation between 4 and 2");
                    tc.SetCount(4); // max = 3: SelPos clamped to 3, _from must also clamp so next Tick doesn't jump > 3
                    T.Eq(tc.SelPos, 3f, "SelPos clamped to max=3");
                    tc.Tick(0.02);
                    T.True(tc.SelPos <= 3f && tc.SelPos >= 2f, "next Tick stays within [2..3] after SetCount clamp");
                    tc.Select(2);   // Selected is already 2, but SelPos > 2 -> Select(2) must snap SelPos to 2 at once
                    T.Eq(tc.SelPos, 2f, "Select(Selected) snaps mid-animation SelPos immediately");
                }
                finally { Controller.Instant = prevInstant; }
            });
        }
    }
}
