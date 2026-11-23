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
        }
    }
}
