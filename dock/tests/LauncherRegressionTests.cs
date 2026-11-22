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

                IdleConfig wallCfg = IdleConfig.Parse("wallpaper", false, "0", "10");
                T.True(wallCfg.Mode == IdleMode.Wallpaper && wallCfg.UsesWallpaper && wallCfg.UsesLake && !wallCfg.UsesAurora && wallCfg.ShowsClock, "parses wallpaper (Midnight Lake + Clock)");
                IdleConfig cleanCfg = IdleConfig.Parse("clean", false, "0", "10");
                T.True(cleanCfg.Mode == IdleMode.Clean && cleanCfg.UsesWallpaper && cleanCfg.UsesLake && !cleanCfg.UsesAurora && !cleanCfg.ShowsClock, "parses clean (Midnight Lake)");
                IdleConfig auroraCfg = IdleConfig.Parse("aurora", false, "0", "10");
                T.True(auroraCfg.Mode == IdleMode.Aurora && auroraCfg.UsesWallpaper && auroraCfg.UsesAurora && !auroraCfg.UsesLake && auroraCfg.ShowsClock, "parses aurora (Aurora Silk + Clock)");
                IdleConfig auroraCleanCfg = IdleConfig.Parse("aurora-clean", false, "0", "10");
                T.True(auroraCleanCfg.Mode == IdleMode.AuroraClean && auroraCleanCfg.UsesWallpaper && auroraCleanCfg.UsesAurora && !auroraCleanCfg.UsesLake && !auroraCleanCfg.ShowsClock, "parses aurora-clean (Aurora Silk)");

                T.Eq(IdleBackdropModel.SinQ14(0), 0, "SinQ14(0) == 0");
                T.Eq(IdleBackdropModel.SinQ14(16384), 16384, "SinQ14(pi/2) == 16384");
                T.Eq(IdleBackdropModel.SinQ14(32768), 0, "SinQ14(pi) == 0");
                T.Eq(IdleBackdropModel.CosQ14(0), 16384, "CosQ14(0) == 16384");
                T.Eq(IdleBackdropModel.CosQ14(32768), -16384, "CosQ14(pi) == -16384");

                uint[] lakePx = IdleBackdropModel.BuildLakeTilePixels(128, 64, 128, 225, 3, 2.0, 11);
                T.Eq(lakePx.Length, 128 * 128, "builds 128x128 Midnight Lake tile");
                bool lakePremulOk = true, lakeHasGlow = false;
                for (int i = 0; i < lakePx.Length; i++)
                {
                    uint p = lakePx[i];
                    uint a = (p >> 24) & 0xFF, r = (p >> 16) & 0xFF, g = (p >> 8) & 0xFF, b = p & 0xFF;
                    if (r > a || g > a || b > a) { lakePremulOk = false; break; }
                    if (a > 64) lakeHasGlow = true;
                }
                T.True(lakePremulOk && lakeHasGlow, "lake tile pixels are valid premultiplied ARGB with wave crests");

                uint[] vigPx = IdleBackdropModel.BuildVignettePixels(64);
                T.Eq(vigPx.Length, 64 * 64, "builds 64x64 OLED vignette mask");
                uint vigCenterA = vigPx[32 * 64 + 32] >> 24;
                uint vigCornerA = vigPx[0] >> 24;
                T.True(vigCenterA < 10 && vigCornerA > 240 && (vigPx[0] & 0xFFFFFFu) == 0u, "vignette has transparent center and pure #000000 edges");

                uint[] silkPx = IdleBackdropModel.BuildSilkRibbonPixels(192, 64, 79, 148, 255, 1.35, 0.13, 0.4, -0.06);
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

                IdleBackdropModel.LakeFrame lf1, lf2, lfDim;
                IdleBackdropModel.ComputeLakeFrame(10000, 1920, 1080, false, out lf1);
                IdleBackdropModel.ComputeLakeFrame(12000, 1920, 1080, false, out lf2);
                IdleBackdropModel.ComputeLakeFrame(10000, 1920, 1080, true, out lfDim);
                T.True(lf1.FillAX != lf2.FillAX || lf1.FillAY != lf2.FillAY, "ComputeLakeFrame advances ripple fill offsets smoothly");
                T.True(lf1.VigX <= 0 && lf1.VigX + lf1.VigW >= 1920 && lf1.VigY <= 0 && lf1.VigY + lf1.VigH >= 1080, "lake vignette always covers 100% of 1080p screen");
                T.True(lfDim.AlphaA < lf1.AlphaA && lf1.AlphaA <= 68, "lake frame keeps OLED peak safe and dims further at 10 min");
                IdleBackdropModel.LakeFrame lfWrapA, lfWrapB;
                IdleBackdropModel.ComputeLakeFrame(32800, 1920, 1080, false, out lfWrapA);
                IdleBackdropModel.ComputeLakeFrame(33000, 1920, 1080, false, out lfWrapB);
                int dxWrap = Math.Abs(lfWrapB.FillAX - lfWrapA.FillAX);
                T.True(dxWrap <= 20 || Math.Abs(dxWrap - lfWrapA.FillAW) <= 20, "lake fill has no int32 wrap jump around 32.9s");

                IdleBackdropModel.AuroraRibbonFrame rf1, rf2;
                IdleBackdropModel.ComputeAuroraRibbon(0, 10000, 1920, 1080, false, out rf1);
                IdleBackdropModel.ComputeAuroraRibbon(0, 15000, 1920, 1080, false, out rf2);
                T.True(rf1.X != rf2.X || rf1.Y != rf2.Y, "ComputeAuroraRibbon drifts on Lissajous orbit");

                bool sawZeroMote = false, sawVisibleMote = false;
                for (int t = 0; t < 40000; t += 1000)
                {
                    IdleBackdropModel.MoteFrame mf;
                    IdleBackdropModel.ComputeMoteFrame(0, t, 1920, 1080, false, out mf);
                    if (mf.Alpha == 0) sawZeroMote = true;
                    if (mf.Alpha > 20) sawVisibleMote = true;
                }
                T.True(sawZeroMote && sawVisibleMote, "ComputeMoteFrame fades smoothly through zero alpha (hide) and visible peak");

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
                byte[] cmdBytes = System.Text.Encoding.ASCII.GetBytes("idle wallpaper 1 5\nshow\n");
                var parsedCmds = cmdBuf.Feed(cmdBytes, cmdBytes.Length);
                T.True(parsedCmds.Count == 2 && parsedCmds[0] == Command.Idle && parsedCmds[1] == Command.Show, "CommandBuffer parses live idle command");
                T.Eq(cmdBuf.TakeIdleArgs(), "wallpaper 1 5", "CommandBuffer captures idle command arguments");

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
                // Launching the same app from Dock cancels holdover immediately.
                T.True(holdModel.Evaluate(dyingYtSnap, 119.0, false, false, false) == IdleAction.None && !holdModel.Visible, "in YouTube again");
                T.True(holdModel.Evaluate(csfsNegSnap, 120.0, false, false, false) == IdleAction.ShowWithDock && holdModel.Visible, "shows again on guarded home");
                holdModel.OnLaunchApp(120.2);
                T.True(holdModel.Evaluate(dyingYtSnap, 120.3, false, false, false) == IdleAction.Hide && !holdModel.Visible, "OnLaunchApp cancels holdover so relaunched app hides backdrop immediately");

                // Launch suppression: KillFirst (fixTizenTube) brief tv-viewer gap does not flash backdrop or reopen Dock.
                var launchModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                T.True(launchModel.Evaluate(dyingYtSnap, 200.0, false, false, false) == IdleAction.None && !launchModel.Visible, "hidden while in app");
                launchModel.OnLaunchApp(200.5);
                T.True(launchModel.Evaluate(dyingYtSnap, 200.55, false, false, false) == IdleAction.None && !launchModel.Visible, "immediate post-launch poll does not cancel launch suppression");
                T.True(launchModel.Evaluate(onTv, 201.0, false, false, false) == IdleAction.None && !launchModel.Visible, "suppresses ShowWithDock during 2.0 s KillFirst launch window");
                T.True(launchModel.Evaluate(onTv, 202.6, false, false, false) == IdleAction.ShowWithDock && launchModel.Visible, "restores backdrop if launched app fails to appear after 2.0 s");

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

                // Issue 4: DisplayState wake & STR OnWake clear Dimmed, trigger restack, and hold transient empty FullscreenAppId for 1.5 s.
                var wakeModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                T.True(wakeModel.Evaluate(onTv, 100.0, false, false, false) == IdleAction.ShowWithDock, "initial backdrop");
                T.True(wakeModel.Evaluate(onTv, 705.0, false, false, false) == IdleAction.Dim && wakeModel.Dimmed, "dims after 10 min");
                T.True(wakeModel.Evaluate(standbySnap, 710.0, false, false, false) == IdleAction.None && wakeModel.Visible, "stays visible in DisplayStateOff");
                var wakeEmptySnap = new TvSnapshot { SourceType = -1, FullscreenAppId = "", PartialAppId = "", DisplayState = 1 };
                T.True(wakeModel.Evaluate(wakeEmptySnap, 720.0, false, false, false) == IdleAction.None && wakeModel.Visible && !wakeModel.Dimmed, "wake clears Dimmed and preserves Visible across transient empty appid");
                T.True(wakeModel.ConsumeWakeRestack() && !wakeModel.ConsumeWakeRestack(), "ConsumeWakeRestack fires once on DisplayStateOff -> On");
                T.True(wakeModel.Evaluate(onTv, 720.8, false, false, false) == IdleAction.None && wakeModel.Visible, "returns to tv-viewer seamlessly without spurious Hide or ShowWithDock");
                T.True(wakeModel.OnWake(800.0) && wakeModel.Evaluate(wakeEmptySnap, 801.0, false, false, false) == IdleAction.None && wakeModel.Visible, "STR OnWake holds transient empty appid within 1.5 s grace");
                T.True(wakeModel.Evaluate(ytSnap, 801.2, false, false, false) == IdleAction.Hide && !wakeModel.Visible, "real foreground app still hides immediately during wake grace");
                T.True(wakeModel.Evaluate(onTv, 805.0, false, false, false) == IdleAction.ShowWithDock, "shows again on tv-viewer");
                T.True(wakeModel.OnWake(810.0) && wakeModel.Evaluate(wakeEmptySnap, 811.6, false, false, false) == IdleAction.Hide && !wakeModel.Visible, "empty appid after 1.5 s grace expires hides normally");

                // Iteration 2 (Finding 1): OnWake called BEFORE Evaluate preserves Visible even when _lastDisplayState == 1 (STR before pm==3).
                var strOnlyModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                T.True(strOnlyModel.Evaluate(onTv, 10.0, false, false, false) == IdleAction.ShowWithDock, "strOnlyModel starts visible");
                T.True(strOnlyModel.Evaluate(onTv, 620.0, false, false, false) == IdleAction.Dim && strOnlyModel.Dimmed, "strOnlyModel dimmed before STR freeze");
                T.True(strOnlyModel.OnWake(700.0), "STR OnWake runs before Evaluate while _lastDisplayState is still 1");
                T.True(strOnlyModel.Evaluate(wakeEmptySnap, 700.1, false, false, false) == IdleAction.None && strOnlyModel.Visible && !strOnlyModel.Dimmed, "OnWake before Evaluate keeps Visible and undims across transient empty FullscreenAppId when _lastDisplayState == 1");

                // Iteration 2: Launchscreen Winsys in IsGuardedSamsungHomeWindow & narrow IsOverlayLaunchKey.
                T.True(IdleBackdropModel.IsGuardedSamsungHomeWindow("Launchscreen Winsys"), "Launchscreen Winsys is recognized as guarded Samsung Home window");
                T.True(IdleBackdropModel.IsOverlayLaunchKey(139) && IdleBackdropModel.IsOverlayLaunchKey(140) && IdleBackdropModel.IsOverlayLaunchKey(490) && IdleBackdropModel.IsOverlayLaunchKey(524), "overlay launch keys match Menu/123/QuickMenu/Source");
                T.True(!IdleBackdropModel.IsOverlayLaunchKey(103) && !IdleBackdropModel.IsOverlayLaunchKey(105) && !IdleBackdropModel.IsOverlayLaunchKey(106) && !IdleBackdropModel.IsOverlayLaunchKey(108) && !IdleBackdropModel.IsOverlayLaunchKey(28), "D-pad and OK do not trigger eager Back-claim release");

                // Samsung original glscreensaver cooperation: hides while screensaver is active and restores without Dock.
                var ssModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10"));
                T.True(ssModel.Evaluate(onTv, 900.0, false, false, false) == IdleAction.ShowWithDock && ssModel.Visible, "initial backdrop on Empty TV");
                var ssActiveSnap = new TvSnapshot { SourceType = 0, FullscreenAppId = IdleBackdropModel.TvViewerAppId, PartialAppId = "", DisplayState = 1, ScreensaverActive = true };
                T.True(ssModel.Evaluate(ssActiveSnap, 910.0, false, false, false) == IdleAction.Hide && !ssModel.Visible, "hides cleanly when Samsung screensaver activates");
                T.True(ssModel.Evaluate(onTv, 920.0, false, false, false) == IdleAction.Show && ssModel.Visible, "restores cleanly without reopening Dock when screensaver ends");

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

                // Case 2: LayerNormal (200) -> LayerShield (250) when partialActive=false places vetro-idle strictly below bottomOverlayWin (tvlauncher).
                cmds.Clear();
                WmStackLogic.Step(fakeShell, false, false, false, false, ref active, ref probed, ref idleWinId, null);
                T.True(currentLayer == WmStackLogic.LayerShield, "unobstructed vetro-idle rises back to LayerShield (250)");
                T.True(cmds.Exists(c => c.Contains("SetWindowStack uint32:1554 uint32:1553 int32:0")), "LayerShield stacks vetro-idle below tvlauncher");

                // Case 3: Launchscreen Winsys is tracked on LayerNormal when !allowSamsungHome and ignored when allowSamsungHome=true.
                cmds.Clear();
                currentLayer = WmStackLogic.LayerNormal;
                winsAboveTv =
                    "struct {\n uint32 1702\n Launchscreen Winsys         \n int32 0\n int32 200\n}\n" +
                    "struct {\n uint32 1554\n vetro-idle         \n int32 0\n int32 200\n}\n" +
                    "struct {\n uint32 1\n tv-viewer         \n int32 0\n int32 200\n}\n";
                WmStackLogic.Step(fakeShell, false, false, true, false, ref active, ref probed, ref idleWinId, null);
                T.True(cmds.Exists(c => c.Contains("SetWindowStack uint32:1554 uint32:1702 int32:1")), "stacks vetro-idle above Launchscreen Winsys when !allowSamsungHome");

                cmds.Clear();
                WmStackLogic.Step(fakeShell, true, false, false, false, ref active, ref probed, ref idleWinId, null);
                T.True(!cmds.Exists(c => c.Contains("SetWindowStack uint32:1554 uint32:1702 int32:1")), "does not stack above Launchscreen Winsys when allowSamsungHome=true");
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
                T.True(firstCmd.Contains("/usr/bin/app_launcher -s org.tizen.tv-viewer"), "restores tv-viewer to foreground so graceful stop completes");

                string tailCmd = IdleBackdropModel.BuildGuardedHomeRestoreCommand("com.samsung.tv.csfs", "org.tizen.browser", Catalog.ValidAppId, genPrefix, false);
                T.True(tailCmd.Contains("*com.samsung.tv.csfs*") && !tailCmd.Contains("org.tizen.browser"), "tail check omits dying app so subsequent relaunch is never overridden");

                string unsafeDying = IdleBackdropModel.BuildGuardedHomeRestoreCommand("com.samsung.tv.csfs", "bad;rm -rf /", Catalog.ValidAppId, "", true);
                T.True(!unsafeDying.Contains("bad;rm") && unsafeDying.Contains("*com.samsung.tv.csfs*"), "rejects unsafe dyingApp characters while preserving csfs restore");

                string dupTv = IdleBackdropModel.BuildGuardedHomeRestoreCommand("com.samsung.tv.coba.newhome", IdleBackdropModel.TvViewerAppId, Catalog.ValidAppId, "", true);
                T.True(dupTv.IndexOf(IdleBackdropModel.TvViewerAppId, System.StringComparison.Ordinal) == dupTv.LastIndexOf(IdleBackdropModel.TvViewerAppId, System.StringComparison.Ordinal), "does not duplicate tv-viewer in pattern list");
            });

            T.Run("idle: TeardownHoldAppId prevents transient Hide flicker after onTv and clears safely", () =>
            {
                var browserSnap = new TvSnapshot { SourceType = -1, FullscreenAppId = "org.tizen.browser", PartialAppId = "", DisplayState = 1 };
                var browserSrc0Snap = new TvSnapshot { SourceType = 0, FullscreenAppId = "org.tizen.browser", PartialAppId = "", DisplayState = 1 };
                var csfsSnap = new TvSnapshot { SourceType = -1, FullscreenAppId = "com.samsung.tv.csfs", PartialAppId = "", DisplayState = 1 };
                var onTv = new TvSnapshot { SourceType = 0, FullscreenAppId = IdleBackdropModel.TvViewerAppId, PartialAppId = "", DisplayState = 1 };
                var ytSnap = new TvSnapshot { SourceType = -1, FullscreenAppId = "org.tizen.cobalt-app", PartialAppId = "", DisplayState = 1 };
                var ssSnap = new TvSnapshot { SourceType = 0, FullscreenAppId = "org.tizen.browser", PartialAppId = "", DisplayState = 1, ScreensaverActive = true };

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
        }
    }
}
