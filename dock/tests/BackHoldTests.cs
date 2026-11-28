using System;
using System.Collections.Generic;
using Launcher.Core;

namespace Launcher.Tests
{
    internal static class BackHoldTests
    {
        private sealed class FakeWmBackend : IEnlightenmentWmBackend
        {
            public List<WmStackLogic.WinInfo> Wins = new List<WmStackLogic.WinInfo>();
            public int IdleLayer = WmStackLogic.LayerNormal;
            public readonly List<string> Calls = new List<string>();

            public bool TryGetWinsInfo(out List<WmStackLogic.WinInfo> wins)
            {
                wins = new List<WmStackLogic.WinInfo>(Wins);
                return true;
            }

            public bool TryGetWindowNotiLevel(uint winId, out int level)
            {
                level = IdleLayer;
                return true;
            }

            public bool TrySetWindowNotiLevel(uint winId, int level)
            {
                IdleLayer = level;
                Calls.Add("setLayer:" + winId + "=" + level);
                return true;
            }

            public bool TrySetWindowStack(uint winId, uint baseWinId, int mode)
            {
                Calls.Add("stack:" + winId + (mode == 1 ? ">+" : "<") + baseWinId + ":" + mode);
                return true;
            }

            public bool TrySetWindowNotiLevelAndStack(uint winId, int level, uint baseWinId, int mode)
            {
                IdleLayer = level;
                Calls.Add("setLayerAndStack:" + winId + "=" + level + "," + baseWinId + ":" + mode);
                return true;
            }

            public bool TryPromoteOverlays(IReadOnlyList<uint> overlayWinIds, int layer)
            {
                Calls.Add("promoteOverlays:" + overlayWinIds.Count + "=" + layer);
                return true;
            }

            public bool TrySyncFullscreenAppId(string appId)
            {
                Calls.Add("syncFull:" + appId);
                return true;
            }
        }

        private static WmStackLogic.WinInfo Win(uint id, string title, int layer = WmStackLogic.LayerNormal, bool visible = true, bool hidden = false, int w = 1920, int h = 1080)
        {
            return new WmStackLogic.WinInfo
            {
                WinId = id,
                Title = title,
                Layer = layer,
                Visible = visible,
                IsHidden = hidden,
                IsFrameVisible = visible,
                Width = w,
                Height = h,
                BoolCount = 3
            };
        }

        public static void Run()
        {
            T.Run("BackHold IdleConfig: CLI parsing and live reconfiguration fallbacks", () =>
            {
                IdleConfig def = IdleConfig.Parse("wallpaper", false, "0", "10");
                T.Eq(def.BackHoldMode, IdleBackHoldMode.Off, "default BackHoldMode is Off");
                T.True(!def.BackHoldDock, "default BackHoldDock is false");

                IdleConfig min = IdleConfig.Parse("clock", true, "5", "20", true, "minimize", true);
                T.Eq(min.BackHoldMode, IdleBackHoldMode.Minimize, "parses minimize");
                T.True(min.BackHoldDock, "parses backHoldDock true");

                IdleConfig fc = IdleConfig.Parse("aurora", false, "-1", "40", false, "FORCE-CLOSE", false);
                T.Eq(fc.BackHoldMode, IdleBackHoldMode.ForceClose, "parses force-close case-insensitively");
                T.True(!fc.BackHoldDock, "parses backHoldDock false");

                IdleConfig bad = IdleConfig.Parse("clean", false, "0", "10", false, "bogus", true);
                T.Eq(bad.BackHoldMode, IdleBackHoldMode.Off, "invalid backHoldMode falls back to Off");

                IdleConfig live3 = IdleConfig.ParseLiveArgs("wallpaper 0 5", 15, true, IdleBackHoldMode.Minimize, true);
                T.Eq(live3.Mode, IdleMode.Wallpaper, "live3 mode");
                T.True(live3.SuppressScreensaver, "live3 preserves fallback suppressScreensaver");
                T.Eq(live3.BackHoldMode, IdleBackHoldMode.Minimize, "live3 preserves fallback BackHoldMode");
                T.True(live3.BackHoldDock, "live3 preserves fallback BackHoldDock");

                IdleConfig live4 = IdleConfig.ParseLiveArgs("aurora 1 10 0", 15, true, IdleBackHoldMode.ForceClose, true);
                T.True(!live4.SuppressScreensaver, "live4 updates suppressScreensaver");
                T.Eq(live4.BackHoldMode, IdleBackHoldMode.ForceClose, "live4 preserves fallback BackHoldMode");
                T.True(live4.BackHoldDock, "live4 preserves fallback BackHoldDock");

                IdleConfig live5 = IdleConfig.ParseLiveArgs("clean 0 0 1 force-close", 15, false, IdleBackHoldMode.Minimize, true);
                T.Eq(live5.BackHoldMode, IdleBackHoldMode.ForceClose, "live5 updates BackHoldMode");
                T.True(live5.BackHoldDock, "live5 preserves fallback BackHoldDock");

                IdleConfig live6 = IdleConfig.ParseLiveArgs("clock 0 -1 0 minimize 0", 15, true, IdleBackHoldMode.ForceClose, true);
                T.Eq(live6.BackHoldMode, IdleBackHoldMode.Minimize, "live6 updates BackHoldMode");
                T.True(!live6.BackHoldDock, "live6 updates BackHoldDock");
            });

            T.Run("BackHold IdleBackdropModel: minimize lifecycle, auto-clear gates, dim/lcdoff, screensaver", () =>
            {
                var offModel = new IdleBackdropModel(IdleConfig.Parse("off", false, "0", "10", false, "minimize", true));
                T.Eq(offModel.OnProactiveMinimize(10.0, "org.tizen.netflix-app", true), IdleAction.None, "Mode.Off refuses proactive minimize");
                T.True(!offModel.MinimizedActive && !offModel.Visible, "Mode.Off stays hidden and unminimized");

                IdleConfig cfg = IdleConfig.Parse("wallpaper", false, "5", "10", false, "minimize", false);
                var m = new IdleBackdropModel(cfg);
                var netflixSnap = new TvSnapshot { SourceType = 0, FullscreenAppId = "org.tizen.netflix-app", DisplayState = 1, WmStackActive = true };

                T.Eq(m.Evaluate(netflixSnap, 1.0, false, false, false), IdleAction.None, "normal foreground app stays visible");
                T.Eq(m.OnProactiveMinimize(10.0, "org.tizen.netflix-app", false), IdleAction.Show, "proactive minimize without dock returns Show");
                T.True(m.Visible && m.MinimizedActive && m.MinimizedAppId == "org.tizen.netflix-app", "minimized state armed");

                T.Eq(m.OnProactiveMinimize(11.0, "org.tizen.netflix-app", true), IdleAction.ShowWithDock, "proactive minimize with openDock returns ShowWithDock");
                T.Eq(m.Evaluate(netflixSnap, 12.0, true, false, false), IdleAction.None, "keeps backdrop visible while FullscreenAppId is still minimized app");
                T.True(m.Visible && m.MinimizedActive, "minimizedHold keeps Visible and MinimizedActive");

                var emptyAppIdSnap = new TvSnapshot { SourceType = 0, FullscreenAppId = "", DisplayState = 1, WmStackActive = true };
                T.Eq(m.Evaluate(emptyAppIdSnap, 13.0, false, false, false), IdleAction.None, "empty FullscreenAppId preserves minimizedHold");
                T.True(m.Visible && m.MinimizedActive, "still minimized");

                // Guarded Samsung Home does NOT clear minimized state and is dismissed.
                var csfsSnap = new TvSnapshot { SourceType = 0, FullscreenAppId = "com.samsung.tv.csfs", DisplayState = 1, WmStackActive = true };
                T.Eq(m.Evaluate(csfsSnap, 14.0, false, false, false), IdleAction.None, "csfs keeps backdrop visible");
                T.True(m.MinimizedActive, "csfs does not clear MinimizedAppId");
                T.True(m.ShouldDismissGuardedHome(csfsSnap, 14.0), "csfs is dismissed while minimized");

                // Picture-Off timer works identically under minimizedHold.
                T.Eq(m.Evaluate(netflixSnap, 11.0 + 301.0, false, false, false), IdleAction.TriggerLcdOff, "lcdoff triggers after 5 min while minimized");
                var offDisp = new TvSnapshot { SourceType = -1, FullscreenAppId = "", DisplayState = IdleBackdropModel.DisplayStateOff, WmStackActive = true };
                T.Eq(m.Evaluate(offDisp, 315.0, false, false, false), IdleAction.None, "display off stays IdleAction.None");
                T.Eq(m.Evaluate(netflixSnap, 320.0, false, false, false), IdleAction.None, "wake from lcdoff keeps backdrop visible");
                T.True(m.Visible && !m.Dimmed && m.MinimizedActive, "wake undims and keeps minimizedHold");

                // Dim timer works identically under minimizedHold.
                var dimModel = new IdleBackdropModel(IdleConfig.Parse("wallpaper", false, "0", "10", false, "minimize", false));
                dimModel.OnProactiveMinimize(100.0, "org.tizen.netflix-app", false);
                T.Eq(dimModel.Evaluate(netflixSnap, 100.0 + IdleBackdropModel.DimAfterSeconds + 1.0, false, false, false), IdleAction.Dim, "dims after DimAfterSeconds while minimized");
                T.True(dimModel.Dimmed && dimModel.Visible, "dimmed and visible");

                // Screensaver parks and restores minimized backdrop without losing MinimizedAppId.
                var ssSnap = new TvSnapshot
                {
                    SourceType = 0,
                    FullscreenAppId = "com.samsung.tv.spotlight-ss",
                    DisplayState = 1,
                    WmStackActive = true,
                    WmScreensaverWinPresent = true,
                    ScreensaverActive = true
                };
                T.Eq(m.Evaluate(ssSnap, 325.0, false, false, false), IdleAction.Hide, "real screensaver hides for ParkForScreensaver");
                T.True(m.HoldOcclusionForScreensaver && m.MinimizedActive, "HoldOcclusionForScreensaver active and MinimizedAppId preserved");
                T.Eq(m.Evaluate(netflixSnap, 330.0, false, false, false), IdleAction.Show, "exiting screensaver restores Empty TV over minimized app");
                T.True(m.Visible && !m.HoldOcclusionForScreensaver && m.MinimizedActive, "Visible restored with MinimizedActive");

                // Reconfigure non-Off preserves MinimizedActive; Mode.Off clears it.
                m.Reconfigure(IdleConfig.Parse("aurora", false, "0", "10", false, "minimize", false), 335.0);
                T.True(m.Visible && m.MinimizedActive, "non-Off Reconfigure preserves MinimizedActive");
                m.Reconfigure(IdleConfig.Parse("off", false, "0", "10"), 340.0);
                T.True(!m.Visible && !m.MinimizedActive, "Mode.Off Reconfigure clears MinimizedActive");

                // Auto-clear triggers: TvViewer, SamsungHomeRequested, SourceType > 0 (HDMI), TunerActive, another app.
                Action<string, TvSnapshot, bool> checkAutoClear = (label, snap, expectVisible) =>
                {
                    var x = new IdleBackdropModel(cfg);
                    x.OnProactiveMinimize(10.0, "org.tizen.netflix-app", false);
                    x.Evaluate(snap, 11.0, false, false, false);
                    T.True(!x.MinimizedActive, label + ": clears MinimizedActive");
                    T.Eq(x.Visible, expectVisible, label + ": Visible=" + expectVisible);
                };
                checkAutoClear("tv-viewer", new TvSnapshot { SourceType = 0, FullscreenAppId = IdleBackdropModel.TvViewerAppId, DisplayState = 1, WmStackActive = true }, true);
                checkAutoClear("SamsungHomeRequested", new TvSnapshot { SourceType = 0, FullscreenAppId = "com.samsung.tv.csfs", SamsungHomeRequested = true, DisplayState = 1, WmStackActive = true }, false);
                checkAutoClear("HDMI source", new TvSnapshot { SourceType = 13, FullscreenAppId = "", DisplayState = 1, WmStackActive = true }, false);
                checkAutoClear("Vetro Tuner", new TvSnapshot { SourceType = 0, FullscreenAppId = IdleBackdropModel.TvViewerAppId, TunerActive = true, DisplayState = 1, WmStackActive = true }, false);
                checkAutoClear("Other app", new TvSnapshot { SourceType = 0, FullscreenAppId = "com.disney.disneyplus-prod", DisplayState = 1, WmStackActive = true }, false);
            });

            T.Run("BackHold IdleBackdropModel: resume minimized app clears _lastNonIdleAppId and uses 0.15s dwell", () =>
            {
                IdleConfig cfg = IdleConfig.Parse("wallpaper", false, "0", "10", false, "minimize", false);
                var m = new IdleBackdropModel(cfg);
                var ytSnap = new TvSnapshot { SourceType = 0, FullscreenAppId = IdleBackdropModel.CobaltYouTubeAppId, DisplayState = 1, WmStackActive = true, WmLaunchTargetReady = true };

                // Establish _lastNonIdleAppId on Cobalt YouTube, then minimize it.
                m.Evaluate(ytSnap, 10.0, false, false, false);
                T.Eq(m.OnProactiveMinimize(20.0, IdleBackdropModel.CobaltYouTubeAppId, true), IdleAction.ShowWithDock, "minimized YouTube");

                // Simulate Task Manager / Dock double OnLaunchApp (before + after Launch) using WrapperYouTubeAppId alias.
                m.OnLaunchApp(30.0, IdleBackdropModel.ShardLaunchSuppressSeconds, IdleBackdropModel.WrapperYouTubeAppId);
                m.OnLaunchApp(30.01, IdleBackdropModel.ShardLaunchSuppressSeconds, IdleBackdropModel.WrapperYouTubeAppId);
                T.True(!m.MinimizedActive, "OnLaunchApp clears MinimizedActive");

                // Even though FullscreenAppId is STILL CobaltYouTubeAppId, dyingTargetHold & oldAppStillClosing must NOT stall!
                T.Eq(m.Evaluate(ytSnap, 30.02, false, false, false), IdleAction.Hide, "resuming minimized app hides immediately without 3.2s dyingTargetHold");
                T.True(!m.Visible, "backdrop hidden cleanly on resume");
                T.True(m.IsLaunchSuppressed(30.02), "0.15s dwell starts at first hide tick");
                T.Eq(m.Evaluate(ytSnap, 30.18, false, false, false), IdleAction.None, "0.15s dwell tick returns None");
                T.True(!m.IsLaunchSuppressed(30.18), "0.15s short dwell clears launch suppression instead of 1.5s/3.0s");

                // Launching a DIFFERENT app clears MinimizedActive and keeps normal 1.5s dwell.
                m.OnProactiveMinimize(40.0, "org.tizen.netflix-app", false);
                m.OnLaunchApp(50.0, IdleBackdropModel.LaunchSuppressSeconds, "com.disney.disneyplus-prod");
                T.True(!m.MinimizedActive, "launching different app clears MinimizedActive");
                var disneySnap = new TvSnapshot { SourceType = 0, FullscreenAppId = "com.disney.disneyplus-prod", DisplayState = 1, WmStackActive = true, WmLaunchTargetReady = true };
                T.Eq(m.Evaluate(disneySnap, 50.0, false, false, false), IdleAction.Hide, "hides immediately for different app");
                T.Eq(m.Evaluate(disneySnap, 50.25, false, false, false), IdleAction.None, "dwell evaluation at 0.25s");
                T.True(m.IsLaunchSuppressed(50.25), "still suppressed at 0.25s (< 1.5s)");
                T.Eq(m.Evaluate(disneySnap, 51.55, false, false, false), IdleAction.None, "dwell evaluation at 1.55s");
                T.True(!m.IsLaunchSuppressed(51.55), "clears suppression after 1.5s dwell");
            });

            T.Run("BackHold IdleBackdropModel: OnProactiveForceClose openDockOverride", () =>
            {
                var noAutoDock = new IdleBackdropModel(IdleConfig.Parse("wallpaper", false, "0", "10", false, "force-close", true));
                noAutoDock.OnProactiveMinimize(5.0, "org.tizen.netflix-app", false);
                T.Eq(noAutoDock.OnProactiveForceClose(10.0, "org.tizen.netflix-app"), IdleAction.Show, "default override uses AutoDock=false");
                T.True(!noAutoDock.MinimizedActive, "force-close clears MinimizedActive");
                T.Eq(noAutoDock.OnProactiveForceClose(12.0, "org.tizen.netflix-app", true), IdleAction.ShowWithDock, "openDockOverride=true opens Dock");

                var autoDock = new IdleBackdropModel(IdleConfig.Parse("wallpaper", true, "0", "10", false, "force-close", false));
                T.Eq(autoDock.OnProactiveForceClose(10.0, "org.tizen.netflix-app", false), IdleAction.Show, "openDockOverride=false suppresses AutoDock");
                T.Eq(autoDock.OnProactiveForceClose(12.0, "org.tizen.netflix-app", null), IdleAction.ShowWithDock, "openDockOverride=null uses AutoDock=true");
            });

            T.Run("BackHold WmStackLogic: keeps vetro-idle above stubborn minimized app, below Settings and spotlight-ss", () =>
            {
                // 1) Stubborn minimized app above vetro-idle on Layer 200 -> restack vetro-idle above netflix.
                var b = new FakeWmBackend();
                b.Wins.Add(Win(20, "org.tizen.netflix-app"));
                b.Wins.Add(Win(10, "vetro-idle"));
                b.Wins.Add(Win(5, "tv-viewer"));
                bool active = true, probed = true;
                uint idleId = 10;
                WmStackObservation obs;
                WmStackLogic.Step(b, false, false, false, false, false, ref active, ref probed, ref idleId, out obs, null, false, null, 0, null, false, minimizedActive: true);
                T.True(b.Calls.Contains("stack:10>+20:1"), "minimizedActive stacks vetro-idle above stubborn netflix window");

                // 2) With partialActive (Samsung Settings org.tizen.menu above netflix), shield drops 250 -> 200 and stacks vetro-idle above netflix (below menu).
                b = new FakeWmBackend { IdleLayer = WmStackLogic.LayerShield };
                b.Wins.Add(Win(30, "org.tizen.menu"));
                b.Wins.Add(Win(20, "org.tizen.netflix-app"));
                b.Wins.Add(Win(10, "vetro-idle", WmStackLogic.LayerShield));
                b.Wins.Add(Win(5, "tv-viewer"));
                WmStackLogic.Step(b, false, false, partialActive: true, shieldTime: false, screensaverActive: false, ref active, ref probed, ref idleId, out obs, null, false, null, 0, null, false, minimizedActive: true);
                T.True(b.Calls.Contains("setLayer:10=200"), "drops vetro-idle to Layer 200 when shield expires");
                T.True(b.Calls.Contains("stack:10>+20:1"), "stacks vetro-idle above netflix while leaving org.tizen.menu on top");

                // 3) With screensaverActive (spotlight-ss on Layer 200), vetro-idle is lowered BELOW spotlight-ss even when minimizedActive is true.
                b = new FakeWmBackend { IdleLayer = WmStackLogic.LayerNormal };
                b.Wins.Add(Win(10, "vetro-idle"));
                b.Wins.Add(Win(40, "com.samsung.tv.spotlight-ss"));
                b.Wins.Add(Win(20, "org.tizen.netflix-app"));
                b.Wins.Add(Win(5, "tv-viewer"));
                WmStackLogic.Step(b, false, false, false, false, screensaverActive: true, ref active, ref probed, ref idleId, out obs, null, false, null, 0, null, false, minimizedActive: true);
                T.True(b.Calls.Contains("stack:10<40:0"), "keeps vetro-idle below spotlight-ss");
                T.True(!b.Calls.Contains("stack:10>+20:1"), "never stacks above screensaver");

                // 4) With minimizedActive == false, ignores user app window and stacks against tv-viewer.
                b = new FakeWmBackend { IdleLayer = WmStackLogic.LayerNormal };
                b.Wins.Add(Win(20, "org.tizen.netflix-app"));
                b.Wins.Add(Win(5, "tv-viewer"));
                b.Wins.Add(Win(10, "vetro-idle"));
                WmStackLogic.Step(b, false, false, false, false, false, ref active, ref probed, ref idleId, out obs, null, false, null, 0, null, false, minimizedActive: false);
                T.True(b.Calls.Contains("stack:10>+5:1"), "without minimizedActive stacks above tv-viewer");
                T.True(!b.Calls.Contains("stack:10>+20:1"), "without minimizedActive does not target netflix");
            });

            T.Run("BackHold CommandBuffer: parses backhold and extended idle commands", () =>
            {
                var cb = new CommandBuffer();
                byte[] bytes = System.Text.Encoding.ASCII.GetBytes("backhold\nBACKHOLD\nbackhold extra\nidle aurora 1 5 1 force-close 1\n");
                List<Command> cmds = cb.Feed(bytes, bytes.Length);
                T.Eq(cmds.Count, 3, "two backhold commands and one idle command");
                T.Eq(cmds[0], Command.BackHold, "lowercase backhold");
                T.Eq(cmds[1], Command.BackHold, "uppercase BACKHOLD");
                T.Eq(cmds[2], Command.Idle, "extended idle command");
                T.Eq(cb.TakeIdleArgs(), "aurora 1 5 1 force-close 1", "idle args preserved verbatim");
            });

            T.Run("BackHold BackRelease: uinput short-tap burst race (KernelRelease before Press)", () =>
            {
                var br = new BackRelease();
                // Kernel release arrives 10 ms before EFL KeyDown Press.
                br.KernelRelease(10.000);
                T.True(!br.Pending, "KernelRelease alone does not arm Pending");
                T.True(br.Press("XF86Back", 10.010), "Press arms Pending");
                T.True(!br.Due(10.100), "still waiting inside 0.15s kernel grace");
                T.True(br.Due(10.165), "Due fires after KernelGraceSeconds from burst-matched press");

                // WindowRelease clears _lastKernelReleaseAt so an immediate fresh Press isn't prematurely released.
                T.True(br.WindowRelease("XF86Back"), "WindowRelease closes");
                T.True(br.Press("XF86Back", 10.170), "immediate next Press");
                T.True(!br.Due(10.500), "previous KernelRelease was cleared by WindowRelease");

                // Stale KernelRelease (> 0.05s earlier) is ignored by Press.
                br.Cancel();
                br.KernelRelease(20.000);
                T.True(br.Press("XF86Back", 20.100), "Press > 0.05s after KernelRelease");
                T.True(!br.Due(20.300), "stale KernelRelease does not trigger early close");
                T.True(br.Due(21.600), "falls back to LimitSeconds");
            });

            T.Run("BackHold ResolveExitKeyAction: honors BackHoldMode, BackHoldDock, and Vetro self-protection", () =>
            {
                bool min;
                bool? dock;

                IdleBackdropModel.ResolveExitKeyAction(IdleBackHoldMode.Off, true, "NuvioTV001.NuvioTV", out min, out dock);
                T.True(!min, "Off mode does not force minimize");
                T.True(dock == null, "Off mode keeps openDockOverride null (uses AutoDock)");

                IdleBackdropModel.ResolveExitKeyAction(IdleBackHoldMode.Minimize, true, "NuvioTV001.NuvioTV", out min, out dock);
                T.True(min && dock == true, "Minimize with BackHoldDock=true");

                IdleBackdropModel.ResolveExitKeyAction(IdleBackHoldMode.Minimize, false, "NuvioTV001.NuvioTV", out min, out dock);
                T.True(min && dock == false, "Minimize with BackHoldDock=false");

                IdleBackdropModel.ResolveExitKeyAction(IdleBackHoldMode.ForceClose, true, "NuvioTV001.NuvioTV", out min, out dock);
                T.True(!min && dock == true, "ForceClose on regular app with BackHoldDock=true");

                IdleBackdropModel.ResolveExitKeyAction(IdleBackHoldMode.ForceClose, false, "NuvioTV001.NuvioTV", out min, out dock);
                T.True(!min && dock == false, "ForceClose on regular app with BackHoldDock=false");

                IdleBackdropModel.ResolveExitKeyAction(IdleBackHoldMode.ForceClose, true, "vetrotvapp.app", out min, out dock);
                T.True(min && dock == true, "ForceClose on vetrotvapp stays minimize-only for self-protection");
            });
        }
    }
}
