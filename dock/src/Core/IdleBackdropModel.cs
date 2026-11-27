using System;
using System.Collections.Generic;
using System.Globalization;

namespace Launcher.Core
{
    internal enum IdleMode { Off, Clock, Wallpaper, Clean, Aurora, AuroraClean }

    internal enum IdleAction { None, Show, ShowWithDock, Hide, Dim, TriggerLcdOff, FallbackDim }

    /// <summary>Parsed configuration for the Empty TV screen ("No Live TV" idle backdrop).</summary>
    internal sealed class IdleConfig
    {
        public IdleMode Mode { get; private set; }
        public bool AutoDock { get; private set; }
        /// <summary>-1 = no dim (keep full brightness); 0 = dim after 10 min (keep visible); 5/10/15 = trigger Samsung lcdoff Picture Off after N minutes.</summary>
        public int PictureOffMinutes { get; private set; }
        public int NotificationLevel { get; private set; }
        public bool SuppressScreensaver { get; private set; }
        public bool UsesWallpaper { get { return UsesLake || UsesAurora; } }
        public bool UsesLake { get { return Mode == IdleMode.Wallpaper || Mode == IdleMode.Clean; } }
        public bool UsesAurora { get { return Mode == IdleMode.Aurora || Mode == IdleMode.AuroraClean; } }
        public bool ShowsClock { get { return Mode == IdleMode.Clock || Mode == IdleMode.Wallpaper || Mode == IdleMode.Aurora; } }

        public IdleConfig(IdleMode mode, bool autoDock, int pictureOffMinutes, int notificationLevel, bool suppressScreensaver = false)
        {
            Mode = mode;
            AutoDock = autoDock;
            PictureOffMinutes = pictureOffMinutes;
            NotificationLevel = notificationLevel;
            SuppressScreensaver = suppressScreensaver;
        }

        public static IdleConfig Parse(string mode, bool autoDock, string potOff, string level, bool suppressScreensaver = false)
        {
            IdleMode m = IdleMode.Off;
            if (string.Equals(mode, "clock", StringComparison.OrdinalIgnoreCase)) m = IdleMode.Clock;
            else if (string.Equals(mode, "wallpaper", StringComparison.OrdinalIgnoreCase)) m = IdleMode.Wallpaper;
            else if (string.Equals(mode, "clean", StringComparison.OrdinalIgnoreCase)) m = IdleMode.Clean;
            else if (string.Equals(mode, "aurora", StringComparison.OrdinalIgnoreCase)) m = IdleMode.Aurora;
            else if (string.Equals(mode, "aurora-clean", StringComparison.OrdinalIgnoreCase)) m = IdleMode.AuroraClean;

            int po = 0;
            int parsedPo;
            if (int.TryParse(potOff, NumberStyles.Integer, CultureInfo.InvariantCulture, out parsedPo)
                && (parsedPo == -1 || parsedPo == 0 || parsedPo == 5 || parsedPo == 10 || parsedPo == 15))
                po = parsedPo;

            int lvl = 40;
            int parsedLvl;
            if (int.TryParse(level, NumberStyles.Integer, CultureInfo.InvariantCulture, out parsedLvl))
                lvl = parsedLvl < 0 ? 0 : (parsedLvl > 40 ? 40 : parsedLvl);

            return new IdleConfig(m, autoDock, po, lvl, suppressScreensaver);
        }

        public static IdleConfig ParseLiveArgs(string argsLine, int fallbackNotificationLevel, bool fallbackSuppressScreensaver = false)
        {
            if (string.IsNullOrEmpty(argsLine)) return null;
            string[] parts = argsLine.Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 3) return null;
            string lvl = fallbackNotificationLevel.ToString(CultureInfo.InvariantCulture);
            bool suppressSs = parts.Length >= 4
                ? (parts[3] == "1" || string.Equals(parts[3], "true", StringComparison.OrdinalIgnoreCase))
                : fallbackSuppressScreensaver;
            return Parse(parts[0], parts[1] == "1" || string.Equals(parts[1], "true", StringComparison.OrdinalIgnoreCase), parts[2], lvl, suppressSs);
        }
    }

    internal struct TvSnapshot
    {
        public int SourceType;
        public string FullscreenAppId;
        public string PartialAppId;
        public int DisplayState;
        public bool TunerActive;
        public bool SamsungHomeRequested;
        public bool WmStackActive;
        public bool WmStateObserved;
        public bool WmGuardedHomePresent;
        public bool WmActiveAppPresent;
        public bool WmLaunchscreenPresent;
        public bool WmScreensaverWinPresent;
        public bool WmLaunchTargetReady;
        public bool PendingTvSource;
        public bool TvPlusActive;
        public bool ScreensaverActive;
        public bool ScreensaverProcessActive;
        public bool ColdBootSilentHome;
    }

    /// <summary>
    /// Pure state machine for the Empty TV screen ("No Live TV" backdrop) and OLED burn-in protection.
    /// Zero EFL or native P/Invoke dependencies so all transitions are unit-tested on desktop.
    /// </summary>
    internal sealed class IdleBackdropModel
    {
        public const int DisplayStateOff = 3;
        public const double DimAfterSeconds = 600.0;
        public const double WakeSuppressSeconds = 0.5;
        public const string TvViewerAppId = "org.tizen.tv-viewer";
        public const string TunerPidPath = "/home/owner/vetro-tuner.pid";
        public const string TunerTvFlag = "/tmp/vetro-tuner.ctl.tv";
        public const string TunerShownFlag = "/tmp/vetro-tuner.ctl.shown";
        public const string TunerChannelsFlag = "/tmp/vetro-tuner.ctl.channels";
        public const double DismissHomeCooldownSeconds = 2.0;
        public const double DismissHomeBackoffSeconds = 10.0;
        public const int DismissHomeMaxFastAttempts = 3;
        public const double GuardedHomeHoldSeconds = 2.5;
        public const double TeardownHoldSeconds = 4.0;
        public const double LaunchSuppressSeconds = 6.0;
        public const double ShardLaunchSuppressSeconds = 8.0;
        public const double NormalLaunchClearDwellSeconds = 1.5;
        public const double ShardLaunchClearDwellSeconds = 3.0;
        public const double ShardLaunchDwellThresholdSeconds = 7.0;
        public const double DyingRelaunchHoldSeconds = 3.2;
        public const string ChannelListAppId = "com.samsung.tv.channel-list";
        public const string CobaltYouTubeAppId = "com.samsung.tv.cobalt-yt";
        public const string WrapperYouTubeAppId = "9Ur5IzDKqV.TizenYouTube";
        public const double WakeGraceSeconds = 1.5;
        public const double StandbyMinOffSeconds = 1.5;

        public static bool IsGuardedSamsungHome(string appId)
        {
            if (string.IsNullOrEmpty(appId)) return false;
            if (appId.StartsWith("com.samsung.tv.coba.art", StringComparison.Ordinal)) return false;
            if (appId.StartsWith("com.samsung.tv.home.art", StringComparison.Ordinal)) return false;
            return appId == "com.samsung.tv.csfs"
                || appId == "com.samsung.tv.coba.newhome"
                || appId.StartsWith("com.samsung.tv.home.", StringComparison.Ordinal)
                || appId.StartsWith("com.samsung.tv.coba.", StringComparison.Ordinal);
        }

        /// <summary>
        /// Matches Enlightenment <c>GetWinsInfo</c> window titles for guarded Samsung Home apps (which on Tizen 9
        /// report full .NET DLL paths such as <c>/opt/usr/apps/com.samsung.tv.csfs/bin/csfs.dll</c>), while always
        /// excluding Frame Art Mode (<c>home.art</c> / <c>coba.art</c>).
        /// </summary>
        public static bool IsGuardedSamsungHomeWindow(string title)
        {
            if (string.IsNullOrEmpty(title)) return false;
            if (title.IndexOf("com.samsung.tv.home.art", StringComparison.Ordinal) >= 0
                || title.IndexOf("com.samsung.tv.coba.art", StringComparison.Ordinal) >= 0)
                return false;
            if (IsGuardedSamsungHome(title)) return true;
            return title.IndexOf("/com.samsung.tv.csfs/", StringComparison.Ordinal) >= 0
                || title.IndexOf("/com.samsung.tv.home.", StringComparison.Ordinal) >= 0
                || title.IndexOf("/com.samsung.tv.coba.", StringComparison.Ordinal) >= 0
                || title.EndsWith("/csfs.dll", StringComparison.Ordinal)
                || title.EndsWith("/HomeSidebar.dll", StringComparison.Ordinal)
                || title.EndsWith("/HomeMedia.dll", StringComparison.Ordinal)
                || title == "csfs.dll"
                || title == "HomeSidebar.dll"
                || title == "HomeMedia.dll"
                || title.IndexOf("EdenView", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        public static bool IsScreensaverApp(string appId)
        {
            if (string.IsNullOrEmpty(appId)) return false;
            return appId == "com.samsung.tv.spotlight-ss"
                || appId == "com.samsung.tv.glscreensaver-launcher"
                || appId == "com.samsung.tv.glscreensaver"
                || appId == "com.samsung.tv.screen-saver"
                || appId == "org.tizen.rscm-screensaver"
                || appId == "org.tizen.screen-saver"
                || appId.EndsWith(".spotlight-ss", StringComparison.OrdinalIgnoreCase)
                || appId.IndexOf("screensaver", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        public static bool IsScreensaverWindow(string title)
        {
            if (string.IsNullOrEmpty(title)) return false;
            return IsScreensaverApp(title)
                || title == "Default_Screensaver"
                || title == "DefaultScreensaver"
                || title.IndexOf("spotlight-ss", StringComparison.OrdinalIgnoreCase) >= 0
                || title.IndexOf("screensaver", StringComparison.OrdinalIgnoreCase) >= 0
                || title.IndexOf("screen-saver", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        /// <summary>
        /// Returns true when Tizen 9's root-app cold-boot (<c>com.samsung.tv.csfs</c>) is running silently
        /// (<c>show_status == "none"</c>, <c>home_shown &lt;= 0</c>) before <c>/tmp/firstscreen_done</c> is created.
        /// Bounded to &lt;60 s uptime so cold-boot handoff completes peacefully well before Samsung's 120 s QD-OLED
        /// <c>auto_protection_time</c> screensaver can launch.
        /// </summary>
        public static bool IsColdBootSilentHome(
            string fullApp,
            string partialApp,
            bool hasRootApp,
            bool firstScreenDone,
            double uptimeSeconds,
            string showStatus,
            int homeShown)
        {
            if (!IsGuardedSamsungHome(fullApp) || !string.IsNullOrEmpty(NormalizePartialAppId(partialApp))) return false;
            if (!hasRootApp || firstScreenDone) return false;
            if (uptimeSeconds < 0.0 || uptimeSeconds >= 60.0) return false;
            if (homeShown > 0) return false;
            return string.IsNullOrEmpty(showStatus) || string.Equals(showStatus, "none", StringComparison.OrdinalIgnoreCase);
        }

        public static bool ShouldPollFastIdle(
            double postNow,
            double fastIdleWatchUntil,
            int sourceType,
            string fullApp,
            bool visible,
            bool holdOcclusionForScreensaver,
            bool screensaverActive,
            bool guardedHomeActive)
        {
            if (holdOcclusionForScreensaver || screensaverActive)
                return postNow < fastIdleWatchUntil;
            if (postNow < fastIdleWatchUntil) return true;
            if (visible) return false;
            if (guardedHomeActive) return true;
            return sourceType == 0
                || fullApp == TvViewerAppId
                || IsGuardedSamsungHome(fullApp)
                || (sourceType <= 0 && string.IsNullOrEmpty(fullApp));
        }

        public static bool IsOverlayLaunchKey(int code)
        {
            switch (code)
            {
                case 125: // XF86SysMenu
                case 127: // XF86SimpleMenu
                case 130: // XF86ChannelGuide
                case 139: // KEY_MENU
                case 140: // 123
                case 141: // KEY_SETUP
                case 176: // XF86MBRSTBGuide
                case 188: // XF86Info
                case 229: // XF86MBRMenu
                case 245: // XF86ExtraApp
                case 355: // XF86UserGuideAccessibility
                case 356: // XF86AccessibilityShortcut
                case 358: // KEY_INFO
                case 362: // KEY_PROGRAM
                case 376: // XF86DiscretSourceTV
                case 385: // XF86AVDiscMenu
                case 386: // XF86AVTitleMenu
                case 396: // XF86Menu
                case 490: // XF86QuickMenu
                case 507: // XF86LongTapMenu
                case 524: // XF86PanelSource
                case 525: // XF86PanelMenu
                case 581: // XF86KeyLearnMenu
                case 587: // XF86AndroidMenu
                case 590: // XF86KeyQuickSetting
                case 661: // XF86KeyAIMenu
                    return true;
                default:
                    return false;
            }
        }

        public delegate bool TryGetVconfInt(out int value);

        public static bool ReadBoolOrInt(TryGetVconfInt tryBool, TryGetVconfInt tryInt)
        {
            int v = 0;
            if (tryBool != null && tryBool(out v)) return v != 0;
            v = 0;
            if (tryInt != null && tryInt(out v)) return v != 0;
            return false;
        }

        public static int[] CollectStaleLongpressPids(int currentPid, params string[] rawContents)
        {
            var seen = new List<int>();
            if (rawContents == null) return seen.ToArray();
            char[] sep = { ' ', '\t', '\r', '\n' };
            foreach (string raw in rawContents)
            {
                if (string.IsNullOrEmpty(raw)) continue;
                string[] parts = raw.Split(sep, StringSplitOptions.RemoveEmptyEntries);
                foreach (string part in parts)
                {
                    int pid;
                    if (int.TryParse(part, NumberStyles.Integer, CultureInfo.InvariantCulture, out pid)
                        && pid > 0 && pid != currentPid && !seen.Contains(pid))
                        seen.Add(pid);
                }
            }
            return seen.ToArray();
        }

        public static string NormalizePartialAppId(string partialAppId)
        {
            if (string.IsNullOrEmpty(partialAppId) || partialAppId == ChannelListAppId) return "";
            return partialAppId;
        }

        public static bool SameLaunchAppOrYouTubeAlias(string a, string b)
        {
            if (string.IsNullOrEmpty(a) || string.IsNullOrEmpty(b)) return false;
            if (a == b) return true;
            bool aYt = a == CobaltYouTubeAppId || a == WrapperYouTubeAppId;
            bool bYt = b == CobaltYouTubeAppId || b == WrapperYouTubeAppId;
            return aYt && bYt;
        }

        public static bool ShouldForwardGrabbedBack(string partialAppId, string fullscreenAppId, Func<bool> isScreensaverActive)
        {
            string normPartial = NormalizePartialAppId(partialAppId);
            return !string.IsNullOrEmpty(normPartial)
                || (!string.IsNullOrEmpty(fullscreenAppId) && fullscreenAppId != TvViewerAppId && !IsGuardedSamsungHome(fullscreenAppId))
                || (isScreensaverActive != null && isScreensaverActive());
        }

        public static bool ShouldRaiseBackdrop(
            bool dockActive,
            bool padOpen,
            bool pillOpen,
            string partialAppId = null,
            bool samsungHomeRequested = false,
            bool backReleaseActive = false)
        {
            if (dockActive || padOpen || pillOpen || backReleaseActive) return false;
            string normPartial = NormalizePartialAppId(partialAppId);
            if (string.IsNullOrEmpty(normPartial)) return true;
            return !samsungHomeRequested && IsGuardedSamsungHome(normPartial);
        }

        /// <summary>
        /// Builds a navigation-safe Enlightenment screensaver activity command using <c>org.enlightenment.wm.info.scrsaver</c>.
        /// Serialized across processes (<c>SamsungTvRemoteInputAgent</c> and <c>tvlauncher</c>) via an atomic lock directory
        /// with a crash-recovery marker (<c>/d</c>) so concurrent presses never observe each other's transient disable window
        /// and a <c>SIGKILL</c> mid-cycle self-heals <c>State: Enabled</c> on the next run without ever enabling a user-disabled screensaver.
        /// </summary>
        public static string BuildScreensaverActivityCommand(string lockDir = "/tmp/vetro-scrsaver.lock")
        {
            string lk = string.IsNullOrEmpty(lockDir) ? "/tmp/vetro-scrsaver.lock" : lockDir;
            string qlk = "'" + lk.Replace("'", "'\"'\"'") + "'";
            const string scrsaverCall = "dbus-send --system --reply-timeout=1000 --print-reply=literal --dest=org.enlightenment.wm /org/enlightenment/wm org.enlightenment.wm.info.scrsaver ";
            return "lk=" + qlk + "; "
                + "if ! mkdir \"$lk\" 2>/dev/null; then "
                + "for _ in 1 2 3 4 5; do [ -e \"$lk/p\" ] && break; done; "
                + "read -r lp < \"$lk/p\" 2>/dev/null || lp=; "
                + "if [ -n \"$lp\" ] && (kill -0 \"$lp\" 2>/dev/null || [ -d \"/proc/$lp\" ]); then exit 0; fi; "
                + "if [ -e \"$lk/d\" ]; then "
                + "if " + scrsaverCall + "int32:2 double:0 >/dev/null 2>&1 || " + scrsaverCall + "int32:2 double:0 >/dev/null 2>&1; then "
                + "rm -f \"$lk/d\" 2>/dev/null; else exit 1; fi; "
                + "fi; "
                + "rm -rf \"$lk\" 2>/dev/null; "
                + "mkdir \"$lk\" 2>/dev/null || exit 0; "
                + "fi; "
                + "trap '' HUP INT TERM; "
                + "echo $$ > \"$lk/p\" 2>/dev/null; "
                + "s=$(" + scrsaverCall + "int32:1 double:0 2>/dev/null); "
                + "case \"$s\" in *\"State: Enabled\"*) "
                + ": > \"$lk/d\" 2>/dev/null; "
                + scrsaverCall + "int32:3 double:0 >/dev/null 2>&1; "
                + "if " + scrsaverCall + "int32:2 double:0 >/dev/null 2>&1 || " + scrsaverCall + "int32:2 double:0 >/dev/null 2>&1; then "
                + "rm -f \"$lk/d\" 2>/dev/null; fi ;; esac; "
                + "if [ ! -e \"$lk/d\" ]; then rm -rf \"$lk\" 2>/dev/null; fi";
        }

        /// <summary>
        /// Returns true only for an active Samsung Layer-900 screensaver overlay process (<c>glscreensaver</c> /
        /// <c>ScreenSaverContent</c>), excluding the permanent <c>screend</c> daemon and background-preloaded <c>AmbientApp</c>.
        /// </summary>
        public static bool IsScreensaverOverlayComm(string comm)
        {
            if (string.IsNullOrEmpty(comm)) return false;
            string trimmed = comm.Trim();
            if (trimmed.Length == 0) return false;
            if (string.Equals(trimmed, "screend", StringComparison.OrdinalIgnoreCase)) return false;
            return trimmed.IndexOf("screensaver", StringComparison.OrdinalIgnoreCase) >= 0
                || trimmed.IndexOf("savercontent", StringComparison.OrdinalIgnoreCase) >= 0
                || trimmed.IndexOf("eensaver", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private IdleConfig _cfg;
        private bool _wasOtherApp = true;
        private int _lastKnownSource = -1;
        private int _lastDisplayState = 1;
        private double _idleSince;
        private bool _dimmed;
        private bool _lcdOffSent;
        private double _nextDismissHomeAt;
        private int _dismissHomeAttempts;
        private double _guardedHomeHoldUntil;
        private string _guardedHomeDyingAppId = "";
        private double _teardownHoldUntil;
        private string _teardownHoldAppId = "";
        private string _lastNonIdleAppId = "";
        private double _launchSuppressUntil;
        private double _launchStartedAt;
        private string _launchTargetAppId = "";
        private double _launchClearDwellSeconds = NormalLaunchClearDwellSeconds;
        private double _launchClearSince;
        private string _launchClearAppId = "";
        private bool _launchWasVisible;
        private bool _launchSawEmptyGap;
        private bool _pendingLaunchHide;
        private double _wakeGraceUntil;
        private double _screensaverExitGraceUntil;
        private double _displayOffSince = -1.0;
        private bool _pictureOffActive;

        public IdleBackdropModel(IdleConfig cfg)
        {
            _cfg = cfg ?? new IdleConfig(IdleMode.Off, false, 0, 40);
        }

        public bool Visible { get; private set; }
        public bool HoldOcclusionForScreensaver { get; private set; }
        public bool ScreensaverTakeoverActive { get; private set; }
        public bool Dimmed { get { return _dimmed; } }
        public double WakeSuppressUntil { get; private set; }
        public bool WakeRestackPending { get; private set; }
        public bool IsEmptyTvContext { get { return _cfg.Mode != IdleMode.Off && !ScreensaverTakeoverActive && (Visible || HoldOcclusionForScreensaver) && _lastKnownSource <= 0; } }
        public int LastKnownSource { get { return _lastKnownSource; } }
        public string LaunchTargetAppId { get { return _launchTargetAppId; } }
        public string GuardedHomeDyingAppId { get { return _guardedHomeDyingAppId; } }
        public string TeardownHoldAppId { get { return _teardownHoldAppId; } }
        public bool IsLaunchSuppressed(double now) { return now < _launchSuppressUntil; }
        public bool IsLaunchCurtainActive(double now) { return Visible && now < _launchSuppressUntil; }

        public IdleAction DismissScreensaverTakeover(double now)
        {
            if (!ScreensaverTakeoverActive) return IdleAction.None;
            ScreensaverTakeoverActive = false;
            Visible = false;
            _dimmed = false;
            _lcdOffSent = false;
            _pictureOffActive = false;
            _idleSince = now;
            WakeSuppressUntil = now + 0.35;
            return IdleAction.Hide;
        }

        public static bool CanClaimExitKey(
            bool idleEnabled,
            bool samsungHomeRequested,
            int sourceType,
            bool tunerActive = false,
            bool holdOcclusionForScreensaver = false,
            bool screensaverActive = false,
            bool coldBootSilentHome = false,
            bool screensaverTakeoverActive = false)
        {
            if (screensaverTakeoverActive)
                return idleEnabled && !holdOcclusionForScreensaver && !coldBootSilentHome;
            return idleEnabled
                && !samsungHomeRequested
                && sourceType <= 0
                && !tunerActive
                && !holdOcclusionForScreensaver
                && !screensaverActive
                && !coldBootSilentHome;
        }

        public static bool ShouldRaiseIdleWindow(bool dockActive, bool padOpen, bool pillOpen)
        {
            return !dockActive && !padOpen && !pillOpen;
        }

        public const double SuppressScreensaverKeepaliveSeconds = 40.0;

        public static bool ShouldKeepScreensaverSuppressed(
            IdleConfig cfg,
            bool visible,
            bool holdOcclusionForScreensaver,
            bool displayOff,
            bool realScreensaver = false)
        {
            return cfg != null
                && cfg.Mode != IdleMode.Off
                && cfg.SuppressScreensaver
                && visible
                && !holdOcclusionForScreensaver
                && !displayOff
                && !realScreensaver;
        }

        public static bool ComputeGuardedHomeActive(bool samsungHomeRequested, string fullApp, string partialApp, bool wmStateObserved, bool wmGuardedHomePresent)
        {
            if (samsungHomeRequested) return false;
            string normPartial = NormalizePartialAppId(partialApp);
            bool wmGuarded = wmStateObserved && wmGuardedHomePresent;
            bool vconfFullGuarded = IsGuardedSamsungHome(fullApp) && !(wmStateObserved && !wmGuardedHomePresent);
            return vconfFullGuarded || IsGuardedSamsungHome(normPartial) || wmGuarded;
        }

        /// <summary>
        /// Distinguishes a genuine Samsung screensaver (<c>spotlight-ss</c> / <c>rscm-screensaver</c> on Layer 200,
        /// <c>glscreensaver</c> / <c>ScreenSaverContent</c> on Layer 900, or legacy <c>Default_Screensaver</c>)
        /// from Enlightenment's 126.7 s phantom <c>screensaver_on_off=True</c> pulse when no screensaver window/process exists.
        /// </summary>
        public static bool IsRealScreensaverActive(TvSnapshot snap)
        {
            if (snap.DisplayState >= DisplayStateOff) return false;
            if (IsScreensaverApp(snap.FullscreenAppId) || IsScreensaverApp(snap.PartialAppId)) return true;
            if (snap.WmScreensaverWinPresent) return true;
            if (!snap.ScreensaverActive) return false;
            if (snap.ScreensaverProcessActive) return true;
            if (!snap.WmStateObserved && string.IsNullOrEmpty(snap.FullscreenAppId)) return true;
            return false;
        }

        public static bool IsEffectiveScreensaverActive(TvSnapshot snap, bool wmFrozenIdle = false)
        {
            return IsRealScreensaverActive(snap);
        }

        public static bool TaskAppMatchesEntry(string runningAppId, string entryAppId)
        {
            if (string.IsNullOrEmpty(runningAppId) || string.IsNullOrEmpty(entryAppId)) return false;
            if (string.Equals(runningAppId, entryAppId, StringComparison.Ordinal)) return true;
            return string.Equals(runningAppId, CobaltYouTubeAppId, StringComparison.Ordinal)
                && string.Equals(entryAppId, WrapperYouTubeAppId, StringComparison.Ordinal);
        }

        public bool CanClaimBackKey(
            bool idleWindowShown,
            bool dockActive,
            string partialAppId,
            bool padOpen,
            bool homeLaunch,
            bool screensaverActive = false,
            bool coldBootSilentHome = false)
        {
            return _cfg.Mode != IdleMode.Off
                && Visible
                && !ScreensaverTakeoverActive
                && !HoldOcclusionForScreensaver
                && !screensaverActive
                && !coldBootSilentHome
                && idleWindowShown
                && !dockActive
                && string.IsNullOrEmpty(NormalizePartialAppId(partialAppId))
                && !padOpen
                && !homeLaunch;
        }

        public void OnPictureOff()
        {
            _pictureOffActive = true;
        }

        public bool OnWake(double now, bool standbyWake = true)
        {
            _idleSince = now;
            _dimmed = false;
            _lcdOffSent = false;
            WakeSuppressUntil = now + WakeSuppressSeconds;
            _wakeGraceUntil = now + WakeGraceSeconds;
            if (standbyWake && !_pictureOffActive && !ScreensaverTakeoverActive) _wasOtherApp = true;
            _pictureOffActive = false;
            _displayOffSince = -1.0;
            return Visible;
        }

        public bool ConsumeWakeRestack()
        {
            if (!WakeRestackPending) return false;
            WakeRestackPending = false;
            return true;
        }

        /// <summary>Updates Empty TV screen settings live without hiding an active backdrop.</summary>
        public void Reconfigure(IdleConfig cfg, double now)
        {
            _cfg = cfg ?? new IdleConfig(IdleMode.Off, false, 0, 40);
            _idleSince = now;
            _dimmed = false;
            _lcdOffSent = false;
            _dismissHomeAttempts = 0;
            _nextDismissHomeAt = 0;
            _guardedHomeHoldUntil = 0;
            _guardedHomeDyingAppId = "";
            _teardownHoldUntil = 0;
            _teardownHoldAppId = "";
            _launchSuppressUntil = 0;
            _launchStartedAt = 0;
            _launchTargetAppId = "";
            _launchClearDwellSeconds = NormalLaunchClearDwellSeconds;
            _launchClearSince = 0;
            _launchClearAppId = "";
            _launchWasVisible = false;
            _launchSawEmptyGap = false;
            _pendingLaunchHide = false;
            _wakeGraceUntil = 0;
            _screensaverExitGraceUntil = 0;
            _displayOffSince = -1.0;
            _pictureOffActive = false;
            WakeRestackPending = false;
            if (_cfg.Mode == IdleMode.Off)
            {
                Visible = false;
                HoldOcclusionForScreensaver = false;
                ScreensaverTakeoverActive = false;
            }
            else if (!_cfg.SuppressScreensaver)
            {
                ScreensaverTakeoverActive = false;
            }
        }

        /// <summary>
        /// Returns true when an unrequested Samsung Home window (e.g. after force-closing an app via long-press Back)
        /// should be dismissed so the TV returns to Vetro's Empty TV screen instead of Smart Hub.
        /// Rate-limited with exponential backoff to avoid spin loops on stubborn firmware.
        /// </summary>
        public bool ShouldDismissGuardedHome(TvSnapshot snap, double now)
        {
            bool realScreensaver = IsRealScreensaverActive(snap);
            if (_cfg.Mode == IdleMode.Off
                || snap.DisplayState >= DisplayStateOff
                || snap.SamsungHomeRequested
                || realScreensaver
                || HoldOcclusionForScreensaver
                || ScreensaverTakeoverActive
                || snap.ColdBootSilentHome)
            {
                _dismissHomeAttempts = 0;
                _nextDismissHomeAt = 0;
                return false;
            }

            string partial = NormalizePartialAppId(snap.PartialAppId);
            bool isFullscreen = IsGuardedSamsungHome(snap.FullscreenAppId);
            bool partialGuarded = IsGuardedSamsungHome(partial);
            bool wmGuarded = snap.WmStateObserved && snap.WmGuardedHomePresent;
            bool vconfFullGuarded = isFullscreen && !(snap.WmStateObserved && !snap.WmGuardedHomePresent);
            bool guardedNow = (vconfFullGuarded || wmGuarded || partialGuarded)
                && snap.SourceType <= 0
                && _lastKnownSource <= 0;
            if (!guardedNow || (now < _launchSuppressUntil && Visible && snap.WmStackActive && !partialGuarded))
            {
                _dismissHomeAttempts = 0;
                _nextDismissHomeAt = 0;
                return false;
            }

            if (now < _nextDismissHomeAt) return false;
            _dismissHomeAttempts++;
            _nextDismissHomeAt = now + (_dismissHomeAttempts >= DismissHomeMaxFastAttempts
                ? DismissHomeBackoffSeconds
                : DismissHomeCooldownSeconds);
            return true;
        }

        public void OnLaunchApp(double now, double suppressSeconds = LaunchSuppressSeconds, string targetAppId = "")
        {
            bool wasHolding = HoldOcclusionForScreensaver;
            HoldOcclusionForScreensaver = false;
            ScreensaverTakeoverActive = false;
            _screensaverExitGraceUntil = 0;
            _pendingLaunchHide = wasHolding && !Visible;
            _dimmed = false;
            _lcdOffSent = false;
            _wasOtherApp = true;
            if (_lastKnownSource > 0 && (string.IsNullOrEmpty(targetAppId) || !targetAppId.StartsWith("vetrotvapp", StringComparison.OrdinalIgnoreCase)))
                _lastKnownSource = 0;
            _guardedHomeHoldUntil = 0;
            _guardedHomeDyingAppId = "";
            if (string.IsNullOrEmpty(targetAppId) || SameLaunchAppOrYouTubeAlias(targetAppId, _teardownHoldAppId))
            {
                _teardownHoldUntil = 0;
                _teardownHoldAppId = "";
            }
            if (suppressSeconds < 0) suppressSeconds = 0;
            double dwell = suppressSeconds >= ShardLaunchDwellThresholdSeconds
                ? ShardLaunchClearDwellSeconds
                : NormalLaunchClearDwellSeconds;
            bool sameGesture = now < _launchSuppressUntil
                && (now - _launchStartedAt) < 0.5
                && (string.IsNullOrEmpty(targetAppId)
                    || string.IsNullOrEmpty(_launchTargetAppId)
                    || SameLaunchAppOrYouTubeAlias(targetAppId, _launchTargetAppId));
            if (sameGesture)
            {
                _launchSuppressUntil = Math.Max(_launchSuppressUntil, now + suppressSeconds);
                if (dwell > _launchClearDwellSeconds) _launchClearDwellSeconds = dwell;
                if (!string.IsNullOrEmpty(targetAppId) && string.IsNullOrEmpty(_launchTargetAppId))
                    _launchTargetAppId = targetAppId;
                _launchClearSince = 0;
                _launchClearAppId = "";
            }
            else
            {
                _launchStartedAt = now;
                _launchTargetAppId = targetAppId ?? "";
                _launchSuppressUntil = Math.Max(_launchSuppressUntil, now + suppressSeconds);
                _launchClearDwellSeconds = dwell;
                _launchClearSince = 0;
                _launchClearAppId = "";
                _launchWasVisible = Visible || wasHolding;
                _launchSawEmptyGap = false;
            }
            _wakeGraceUntil = 0;
        }

        /// <summary>
        /// Marks the backdrop visible as an opaque Layer-200 launch curtain (after <see cref="OnLaunchApp"/>)
        /// when an external shard/YouTube launch starts from another fullscreen app so <c>csfs</c> cannot flash
        /// while the plugin restarts Cobalt.
        /// </summary>
        public void SetVisibleForLaunchCurtain(double now)
        {
            if (_cfg.Mode == IdleMode.Off) return;
            HoldOcclusionForScreensaver = false;
            _screensaverExitGraceUntil = 0;
            _pendingLaunchHide = false;
            Visible = true;
            _idleSince = now;
            _dimmed = false;
            _lcdOffSent = false;
        }

        /// <summary>
        /// Proactively shows the opaque backdrop (and AutoDock if enabled) before closing a foreground app
        /// on a sustained Back/Exit hold, clearing any active launch suppression and arming a teardown hold
        /// so <see cref="Evaluate"/> keeps the backdrop steady while <c>app_launcher -t</c> finishes closing the app.
        /// </summary>
        public IdleAction OnProactiveForceClose(double now, string closingAppId = "")
        {
            if (_cfg.Mode == IdleMode.Off) return IdleAction.None;
            HoldOcclusionForScreensaver = false;
            _screensaverExitGraceUntil = 0;
            _launchSuppressUntil = 0;
            _launchStartedAt = 0;
            _launchTargetAppId = "";
            _launchClearSince = 0;
            _launchClearAppId = "";
            _launchWasVisible = false;
            _launchSawEmptyGap = false;
            _pendingLaunchHide = false;
            _wakeGraceUntil = 0;
            string closing = closingAppId ?? "";
            _teardownHoldAppId = closing;
            _teardownHoldUntil = !string.IsNullOrEmpty(closing) ? now + TeardownHoldSeconds : 0;
            _guardedHomeDyingAppId = closing;
            _guardedHomeHoldUntil = _teardownHoldUntil;
            _idleSince = now;
            _dimmed = false;
            _lcdOffSent = false;
            _wasOtherApp = false;
            ScreensaverTakeoverActive = false;
            Visible = true;
            return _cfg.AutoDock ? IdleAction.ShowWithDock : IdleAction.Show;
        }

        /// <summary>
        /// Filters raw evdev key presses: suppresses the wake key while the panel is in lcdoff, and resets
        /// the idle dim/Picture-Off timer without ever hiding the backdrop.
        /// </summary>
        public bool OnRawKey(int code, int homeCode, double now, bool displayOff, bool dockActive, out bool hideBackdrop)
        {
            hideBackdrop = false;
            _idleSince = now;
            _dimmed = false;
            _lcdOffSent = false;
            if (displayOff)
            {
                if (code == 116 || code == 112 || code == 142) _pictureOffActive = false;
                if (ScreensaverTakeoverActive)
                {
                    ScreensaverTakeoverActive = false;
                    Visible = false;
                    hideBackdrop = true;
                }
                WakeSuppressUntil = now + WakeSuppressSeconds;
                return true;
            }
            if (now < WakeSuppressUntil) return true;
            return false;
        }

        public IdleAction OnLcdOffVerify(int displayState)
        {
            if (displayState >= DisplayStateOff) return IdleAction.None;
            _dimmed = true;
            return IdleAction.FallbackDim;
        }

        public IdleAction Evaluate(TvSnapshot snap, double now, bool dockActive, bool padOpen, bool pillOpen)
        {
            if (_cfg.Mode == IdleMode.Off)
            {
                ScreensaverTakeoverActive = false;
                if (!Visible && !HoldOcclusionForScreensaver) return IdleAction.None;
                Visible = false;
                HoldOcclusionForScreensaver = false;
                return IdleAction.Hide;
            }

            bool realScreensaver = IsRealScreensaverActive(snap);

            if (snap.DisplayState >= DisplayStateOff)
            {
                if (_lastDisplayState < DisplayStateOff) _displayOffSince = now;
                if (_lcdOffSent) _pictureOffActive = true;
                _lastDisplayState = snap.DisplayState;
                if (ScreensaverTakeoverActive)
                {
                    if (_pictureOffActive) return IdleAction.None;
                    ScreensaverTakeoverActive = false;
                    Visible = false;
                    _dimmed = false;
                    _lcdOffSent = false;
                    return IdleAction.Hide;
                }
                if (!Visible
                    && !snap.TunerActive
                    && !snap.SamsungHomeRequested
                    && snap.SourceType <= 0
                    && _lastKnownSource <= 0
                    && (snap.FullscreenAppId == TvViewerAppId
                        || IsGuardedSamsungHome(snap.FullscreenAppId)
                        || HoldOcclusionForScreensaver
                        || IsScreensaverApp(snap.FullscreenAppId)))
                {
                    HoldOcclusionForScreensaver = false;
                    Visible = true;
                    _idleSince = now;
                    _dimmed = false;
                    _lcdOffSent = false;
                    _wasOtherApp = true;
                    return IdleAction.Show;
                }
                return IdleAction.None;
            }
            bool wasPictureOffTakeoverWake = false;
            if (_lastDisplayState >= DisplayStateOff)
            {
                wasPictureOffTakeoverWake = ScreensaverTakeoverActive && _pictureOffActive;
                bool isStandbyWake = !_pictureOffActive
                    && (_displayOffSince < 0.0 || (now - _displayOffSince) >= StandbyMinOffSeconds);
                WakeRestackPending = OnWake(now, isStandbyWake);
                if (wasPictureOffTakeoverWake)
                {
                    ScreensaverTakeoverActive = false;
                    Visible = false;
                }
            }
            _lastDisplayState = snap.DisplayState;

            if (snap.SourceType >= 0) _lastKnownSource = snap.SourceType;
            else if (_lastKnownSource > 0
                && !string.IsNullOrEmpty(snap.FullscreenAppId)
                && snap.FullscreenAppId != TvViewerAppId
                && !IsGuardedSamsungHome(snap.FullscreenAppId)
                && !IsScreensaverApp(snap.FullscreenAppId)
                && !snap.FullscreenAppId.StartsWith("vetrotvapp", StringComparison.OrdinalIgnoreCase))
            {
                _lastKnownSource = 0;
            }
            if (snap.SourceType > 0) _launchSuppressUntil = 0;

            bool launchSuppressed = now < _launchSuppressUntil;
            bool wmGuardedHome = snap.WmStateObserved
                && snap.WmGuardedHomePresent
                && !snap.SamsungHomeRequested
                && snap.SourceType <= 0
                && _lastKnownSource <= 0;
            bool guardedHome = !snap.SamsungHomeRequested
                && (IsGuardedSamsungHome(snap.FullscreenAppId) || wmGuardedHome)
                && snap.SourceType <= 0
                && _lastKnownSource <= 0;
            if (guardedHome)
            {
                if (!launchSuppressed)
                {
                    string dying = !string.IsNullOrEmpty(_lastNonIdleAppId) ? _lastNonIdleAppId : _teardownHoldAppId;
                    if (!string.IsNullOrEmpty(dying))
                    {
                        _guardedHomeDyingAppId = dying;
                        _teardownHoldAppId = dying;
                        _teardownHoldUntil = now + GuardedHomeHoldSeconds;
                    }
                    _guardedHomeHoldUntil = now + GuardedHomeHoldSeconds;
                }
            }
            else if ((snap.FullscreenAppId == TvViewerAppId && snap.SourceType <= 0 && _lastKnownSource <= 0)
                || snap.SamsungHomeRequested
                || snap.SourceType > 0)
            {
                _guardedHomeHoldUntil = 0;
                _guardedHomeDyingAppId = "";
                if (snap.FullscreenAppId == TvViewerAppId && snap.SourceType <= 0 && _lastKnownSource <= 0) _lastNonIdleAppId = "";
            }

            if (snap.SamsungHomeRequested
                || snap.SourceType > 0
                || realScreensaver
                || snap.TunerActive
                || now >= _teardownHoldUntil
                || (!string.IsNullOrEmpty(snap.FullscreenAppId)
                    && snap.FullscreenAppId != TvViewerAppId
                    && !IsGuardedSamsungHome(snap.FullscreenAppId)
                    && !IsScreensaverApp(snap.FullscreenAppId)
                    && snap.FullscreenAppId != _teardownHoldAppId))
            {
                _teardownHoldUntil = 0;
                _teardownHoldAppId = "";
            }

            string normPartial = NormalizePartialAppId(snap.PartialAppId);
            bool dyingTargetHold = launchSuppressed
                && !_launchSawEmptyGap
                && (now - _launchStartedAt) < DyingRelaunchHoldSeconds
                && !string.IsNullOrEmpty(snap.FullscreenAppId)
                && !string.IsNullOrEmpty(_lastNonIdleAppId)
                && SameLaunchAppOrYouTubeAlias(snap.FullscreenAppId, _lastNonIdleAppId)
                && (!_launchWasVisible || (!string.IsNullOrEmpty(_launchTargetAppId) && SameLaunchAppOrYouTubeAlias(snap.FullscreenAppId, _launchTargetAppId)));
            bool guardedHomeHold = Visible
                && !snap.SamsungHomeRequested
                && !realScreensaver
                && !snap.TunerActive
                && _lastKnownSource <= 0
                && ((snap.SourceType < 0
                        && now < _guardedHomeHoldUntil
                        && !string.IsNullOrEmpty(_guardedHomeDyingAppId)
                        && snap.FullscreenAppId == _guardedHomeDyingAppId)
                    || (snap.SourceType <= 0
                        && now < _teardownHoldUntil
                        && !string.IsNullOrEmpty(_teardownHoldAppId)
                        && snap.FullscreenAppId == _teardownHoldAppId)
                    || dyingTargetHold);
            bool guardedPartial = !snap.SamsungHomeRequested
                && IsGuardedSamsungHome(normPartial);

            if (snap.SamsungHomeRequested || snap.SourceType > 0 || snap.TunerActive || snap.TvPlusActive)
                _screensaverExitGraceUntil = 0;

            bool wakeEmptyHold = Visible
                && now < _wakeGraceUntil
                && snap.SourceType <= 0
                && !snap.TvPlusActive
                && string.IsNullOrEmpty(snap.FullscreenAppId);

            bool screensaverExitHold = (Visible || HoldOcclusionForScreensaver)
                && now < _screensaverExitGraceUntil
                && snap.SourceType <= 0
                && _lastKnownSource <= 0
                && !snap.SamsungHomeRequested
                && !snap.TvPlusActive
                && string.IsNullOrEmpty(snap.FullscreenAppId);

            bool coldBootTvEmpty = snap.SourceType == 0
                && _lastKnownSource <= 0
                && !snap.SamsungHomeRequested
                && !snap.TvPlusActive
                && string.IsNullOrEmpty(snap.FullscreenAppId);

            bool screensaverOverEmptyTv = !ScreensaverTakeoverActive
                && !_cfg.SuppressScreensaver
                && (Visible || HoldOcclusionForScreensaver)
                && realScreensaver
                && !snap.SamsungHomeRequested
                && !snap.TvPlusActive
                && (snap.SourceType == 0 || (snap.SourceType < 0 && (_lastKnownSource <= 0 || snap.PendingTvSource)));

            bool onEmptyTv = (snap.FullscreenAppId == TvViewerAppId
                && !snap.TvPlusActive
                && (snap.SourceType == 0 || (snap.SourceType < 0 && (Visible || HoldOcclusionForScreensaver || _lastKnownSource <= 0 || snap.PendingTvSource))))
                || coldBootTvEmpty
                || screensaverOverEmptyTv
                || screensaverExitHold
                || wakeEmptyHold
                || guardedHome
                || guardedHomeHold;
            double curtainMaxSeconds = _launchClearDwellSeconds >= ShardLaunchClearDwellSeconds ? 4.5 : 2.5;
            bool launchCurtainHold = launchSuppressed
                && Visible
                && snap.WmStackActive
                && !snap.SamsungHomeRequested
                && !realScreensaver
                && snap.SourceType <= 0
                && _lastKnownSource <= 0
                && !snap.TunerActive
                && !snap.WmLaunchTargetReady
                && (now - _launchStartedAt) < curtainMaxSeconds;
            if (onEmptyTv)
            {
                if (launchSuppressed && !dyingTargetHold)
                {
                    _launchSawEmptyGap = true;
                    _launchClearSince = 0;
                    _launchClearAppId = "";
                }
            }
            else if (launchCurtainHold)
            {
                if (!realScreensaver && !ScreensaverTakeoverActive) _wasOtherApp = true;
                _launchClearSince = 0;
                _launchClearAppId = "";
                _idleSince = now;
                _dimmed = false;
                _lcdOffSent = false;
                return IdleAction.None;
            }
            else
            {
                if (!realScreensaver && !ScreensaverTakeoverActive) _wasOtherApp = true;
                if (!string.IsNullOrEmpty(snap.FullscreenAppId)
                    && snap.FullscreenAppId != TvViewerAppId
                    && !IsGuardedSamsungHome(snap.FullscreenAppId)
                    && !IsScreensaverApp(snap.FullscreenAppId))
                {
                    bool oldAppStillClosing = dyingTargetHold
                        || (!_launchWasVisible
                            && !_launchSawEmptyGap
                            && !string.IsNullOrEmpty(_lastNonIdleAppId)
                            && SameLaunchAppOrYouTubeAlias(snap.FullscreenAppId, _lastNonIdleAppId));
                    if (launchSuppressed && !guardedHome && !oldAppStillClosing)
                    {
                        if (_launchClearAppId != snap.FullscreenAppId || _launchClearSince <= 0)
                        {
                            _launchClearAppId = snap.FullscreenAppId;
                            _launchClearSince = now;
                        }
                        else if (now - _launchClearSince >= _launchClearDwellSeconds)
                        {
                            _launchSuppressUntil = 0;
                            _launchStartedAt = 0;
                            _launchTargetAppId = "";
                            _launchClearSince = 0;
                            _launchClearAppId = "";
                            _launchWasVisible = false;
                            _launchSawEmptyGap = false;
                            _pendingLaunchHide = false;
                            launchSuppressed = false;
                        }
                    }
                    else if (launchSuppressed)
                    {
                        _launchClearSince = 0;
                        _launchClearAppId = "";
                    }
                    _lastNonIdleAppId = snap.FullscreenAppId;
                }
            }

            // Ignore Enlightenment's phantom 126.7 s screensaver_on_off=1 pulse on Empty TV (no screensaver process,
            // no Layer-200/900 screensaver window, full=tv-viewer) so vetro-idle never blinks or blacks out, while
            // holding #000000 Wayland surface occlusion (HoldOcclusionForScreensaver + ParkForScreensaver) whenever a
            // real Layer-200 (spotlight-ss) or Layer-900 (glscreensaver) screensaver runs over Empty TV so tv-viewer
            // never flips obscured 2 -> 0 and triggers e_screensaver_notidle().
            bool allowedBase = onEmptyTv
                && (snap.WmStackActive || string.IsNullOrEmpty(normPartial) || guardedPartial || IsScreensaverApp(normPartial))
                && !snap.TunerActive;
            bool allowed = allowedBase && (!realScreensaver || _cfg.SuppressScreensaver);

            if (!allowed)
            {
                bool pendingHide = _pendingLaunchHide;
                _pendingLaunchHide = false;
                if (_cfg.SuppressScreensaver && !allowedBase && (ScreensaverTakeoverActive || (realScreensaver && !launchSuppressed && now >= WakeSuppressUntil)))
                {
                    bool enteredTakeover = !ScreensaverTakeoverActive;
                    HoldOcclusionForScreensaver = false;
                    ScreensaverTakeoverActive = true;
                    _screensaverExitGraceUntil = 0;
                    if (enteredTakeover || !Visible)
                    {
                        Visible = true;
                        _idleSince = now;
                        _dimmed = false;
                        _lcdOffSent = false;
                        return IdleAction.Show;
                    }
                    if (dockActive || padOpen || pillOpen)
                    {
                        _idleSince = now;
                        if (_dimmed) _dimmed = false;
                        _lcdOffSent = false;
                        return IdleAction.None;
                    }
                    return EvaluateIdleTimer(now);
                }
                if (realScreensaver && allowedBase && (Visible || HoldOcclusionForScreensaver) && !pendingHide)
                {
                    HoldOcclusionForScreensaver = true;
                    _wasOtherApp = false;
                    _screensaverExitGraceUntil = now + WakeGraceSeconds;
                    if (dockActive || padOpen || pillOpen)
                    {
                        _idleSince = now;
                        _dimmed = false;
                        _lcdOffSent = false;
                    }
                    if (Visible)
                    {
                        Visible = false;
                        _dimmed = false;
                        return IdleAction.Hide;
                    }
                    if (!dockActive && !padOpen && !pillOpen
                        && _cfg.PictureOffMinutes > 0 && !_lcdOffSent && now - _idleSince >= _cfg.PictureOffMinutes * 60.0)
                    {
                        _lcdOffSent = true;
                        _pictureOffActive = true;
                        _dimmed = true;
                        return IdleAction.TriggerLcdOff;
                    }
                    return IdleAction.None;
                }
                bool wasHolding = HoldOcclusionForScreensaver;
                bool wasTakeover = ScreensaverTakeoverActive;
                HoldOcclusionForScreensaver = false;
                ScreensaverTakeoverActive = false;
                _screensaverExitGraceUntil = 0;
                if (!Visible && !pendingHide && !wasHolding && !wasTakeover && !wasPictureOffTakeoverWake) return IdleAction.None;
                Visible = false;
                _dimmed = false;
                _lcdOffSent = false;
                return IdleAction.Hide;
            }

            HoldOcclusionForScreensaver = false;
            ScreensaverTakeoverActive = false;
            if (!Visible)
            {
                if (launchSuppressed)
                {
                    _pendingLaunchHide = false;
                    _launchSawEmptyGap = true;
                    Visible = true;
                    _idleSince = now;
                    _dimmed = false;
                    _lcdOffSent = false;
                    return IdleAction.Show;
                }
                _pendingLaunchHide = false;
                Visible = true;
                _idleSince = now;
                _dimmed = false;
                _lcdOffSent = false;
                if (dockActive)
                {
                    _wasOtherApp = false;
                    return IdleAction.Show;
                }
                if (_cfg.AutoDock && _wasOtherApp)
                {
                    if (!padOpen && !pillOpen)
                    {
                        _wasOtherApp = false;
                        return IdleAction.ShowWithDock;
                    }
                    return IdleAction.Show;
                }
                _wasOtherApp = false;
                return IdleAction.Show;
            }

            if (launchSuppressed)
            {
                _idleSince = now;
                _dimmed = false;
                _lcdOffSent = false;
                return IdleAction.None;
            }
            if (dockActive)
            {
                _wasOtherApp = false;
                _idleSince = now;
                if (_dimmed) { _dimmed = false; }
                _lcdOffSent = false;
                return IdleAction.None;
            }
            if (padOpen || pillOpen)
            {
                _idleSince = now;
                if (_dimmed) { _dimmed = false; }
                _lcdOffSent = false;
                return IdleAction.None;
            }
            if (_wasOtherApp && !wakeEmptyHold && now >= _launchSuppressUntil)
            {
                _wasOtherApp = false;
                _idleSince = now;
                _dimmed = false;
                _lcdOffSent = false;
                if (_cfg.AutoDock) return IdleAction.ShowWithDock;
            }

            return EvaluateIdleTimer(now);
        }

        private IdleAction EvaluateIdleTimer(double now)
        {
            if (_cfg.PictureOffMinutes > 0)
            {
                if (!_lcdOffSent && now - _idleSince >= _cfg.PictureOffMinutes * 60.0)
                {
                    _lcdOffSent = true;
                    _pictureOffActive = true;
                    _dimmed = true;
                    return IdleAction.TriggerLcdOff;
                }
                return IdleAction.None;
            }
            if (_cfg.PictureOffMinutes < 0) return IdleAction.None;
            if (!_dimmed && now - _idleSince >= DimAfterSeconds)
            {
                _dimmed = true;
                return IdleAction.Dim;
            }
            return IdleAction.None;
        }

        public const int AuroraMoteCount = 10;

        /// <summary>
        /// Builds a white-luminance premultiplied ARGB bokeh/starlight sprite (R=G=B=A) tinted on GPU via color_set.
        /// </summary>
        public static uint[] BuildBokehPixels(int size, bool crisp)
        {
            var px = new uint[size * size];
            double half = size * 0.5;
            for (int y = 0; y < size; y++)
            {
                double ny = (y - half + 0.5) / half;
                int rowOffset = y * size;
                for (int x = 0; x < size; x++)
                {
                    double nx = (x - half + 0.5) / half;
                    double r = Math.Sqrt(nx * nx + ny * ny);
                    double alpha = 0.0;
                    if (r < 1.0)
                    {
                        if (crisp)
                        {
                            double omr = 1.0 - r;
                            alpha = Math.Exp(-r * r * 12.0) * 0.92 + (omr * omr * omr) * 0.25;
                        }
                        else
                        {
                            double disc = Math.Pow(1.0 - r * r, 2.2);
                            double hr = (r - 0.68) / 0.16;
                            double halo = Math.Exp(-hr * hr) * 0.14;
                            alpha = (disc * 0.86 + halo) * (1.0 - r);
                        }
                    }
                    if (alpha < 0.0) alpha = 0.0;
                    if (alpha > 1.0) alpha = 1.0;
                    int a = (int)Math.Round(alpha * 255.0);
                    if (x == 0 || x == size - 1 || y == 0 || y == size - 1) a = 0;
                    uint u = (uint)a;
                    px[rowOffset + x] = (u << 24) | (u << 16) | (u << 8) | u;
                }
            }
            return px;
        }

        /// <summary>
        /// Wraps a <paramref name="w"/>x<paramref name="h"/> premultiplied ARGB sprite with a
        /// <paramref name="pad"/>-pixel transparent (#00000000) border on all four sides for sub-pixel UV clamping safety.
        /// </summary>
        public static uint[] PadPixels(uint[] pixels, int w, int h, int pad)
        {
            if (pixels == null || w <= 0 || h <= 0) return new uint[0];
            if (pad <= 0)
            {
                var copy = new uint[pixels.Length];
                Buffer.BlockCopy(pixels, 0, copy, 0, pixels.Length * 4);
                return copy;
            }
            int outW = w + pad * 2;
            int outH = h + pad * 2;
            var dst = new uint[outW * outH];
            int rowBytes = w * 4;
            for (int y = 0; y < h; y++)
            {
                Buffer.BlockCopy(pixels, y * rowBytes, dst, ((y + pad) * outW + pad) * 4, rowBytes);
            }
            return dst;
        }

        internal struct AuroraRibbonMotion
        {
            public double X, Y, W, H;
            public int Alpha;
        }

        internal struct MoteMotion
        {
            public double X, Y, Size;
            public int R, G, B, Alpha;
        }

        internal struct SubpixelQuad
        {
            public int X, Y, W, H;
            public double U0, V0, U1, V1;
        }

        public static void ComputeSpriteSubpixelQuad(
            double fx, double fy, double w, double h,
            int innerW, int innerH, int pad, int texW, int texH,
            out SubpixelQuad quad)
        {
            int ix = (int)Math.Floor(fx);
            int iy = (int)Math.Floor(fy);
            double fracX = fx - ix;
            double fracY = fy - iy;
            int drawW = Math.Max(1, (int)Math.Ceiling(w + fracX));
            int drawH = Math.Max(1, (int)Math.Ceiling(h + fracY));
            double scaleU = w > 0.0 ? innerW / w : 1.0;
            double scaleV = h > 0.0 ? innerH / h : 1.0;
            double u0 = pad - fracX * scaleU;
            double v0 = pad - fracY * scaleV;
            double u1 = pad + (drawW - fracX) * scaleU;
            double v1 = pad + (drawH - fracY) * scaleV;
            if (u0 < 0.0) u0 = 0.0;
            if (v0 < 0.0) v0 = 0.0;
            if (u1 > texW) u1 = texW;
            if (v1 > texH) v1 = texH;
            quad = new SubpixelQuad
            {
                X = ix,
                Y = iy,
                W = drawW,
                H = drawH,
                U0 = u0,
                V0 = v0,
                U1 = u1,
                V1 = v1
            };
        }

        public const int FloatMapBase = 4096;

        public static void ComputeFloatMapZoomFactors(double f, double size, out double z1, out double z2)
        {
            z2 = 1.0 + f / FloatMapBase;
            if (Math.Abs(z2) < 1e-6) z2 = 1e-6;
            z1 = size / (FloatMapBase * z2);
        }

        public static void ComputePaddedFloatQuad(
            double innerFx, double innerFy, double innerFw, double innerFh,
            int innerTexW, int innerTexH, int pad, int totalTexW, int totalTexH,
            out double quadFx, out double quadFy, out double quadFw, out double quadFh)
        {
            double sx = innerTexW > 0 ? innerFw / innerTexW : 1.0;
            double sy = innerTexH > 0 ? innerFh / innerTexH : 1.0;
            quadFx = innerFx - pad * sx;
            quadFy = innerFy - pad * sy;
            quadFw = totalTexW * sx;
            quadFh = totalTexH * sy;
        }

        public static double Halton(int index, int radix)
        {
            double f = 1.0, r = 0.0;
            int i = index < 1 ? 1 : index;
            while (i > 0)
            {
                f /= radix;
                r += f * (i % radix);
                i /= radix;
            }
            return r;
        }

        public static void HaltonPosition(int step, int screenW, int screenH, int blockW, int blockH, out int x, out int y)
        {
            const int margin = 96;
            int bottomMargin = screenH >= 720 ? 280 : margin;
            int maxX = Math.Max(margin, screenW - margin - blockW);
            int maxY = Math.Max(margin, screenH - bottomMargin - blockH);
            x = margin + (int)Math.Round(Halton(step, 2) * (maxX - margin));
            y = margin + (int)Math.Round(Halton(step, 3) * (maxY - margin));
        }

        public static void FormatDate(DateTime now, out string dayAbbr, out string dateStr)
        {
            dayAbbr = now.ToString("ddd", CultureInfo.InvariantCulture).ToUpperInvariant();
            dateStr = now.ToString("dd.MM.yy", CultureInfo.InvariantCulture);
        }

        public static bool IsTunerReady(Func<string, bool> fileExists, Func<string, string> readText, Func<int, bool> pidAlive)
        {
            if (fileExists == null || readText == null || pidAlive == null) return false;
            if (!fileExists(TunerTvFlag) && !fileExists(TunerShownFlag)) return false;
            if (fileExists(TunerChannelsFlag))
            {
                string ch = (readText(TunerChannelsFlag) ?? "").Trim();
                if (ch == "0") return false;
            }
            if (!fileExists(TunerPidPath)) return false;
            int pid;
            string raw = readText(TunerPidPath);
            if (!int.TryParse((raw ?? "").Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out pid) || pid <= 1)
                return false;
            return pidAlive(pid);
        }

        /// <summary>
        /// Builds the shell command that restores <see cref="TvViewerAppId"/> to foreground after an unrequested
        /// guarded Samsung Home is dismissed. Graceful-stop apps such as <c>org.tizen.browser</c> remain visible and
        /// foreground (never emitting AUL pause/<c>bg</c>) if <c>csfs</c> is killed directly, preventing tvctx-manager's
        /// pending <c>stop.gracefully</c> from terminating them; bringing <c>tv-viewer</c> to foreground triggers the
        /// transition cleanly without overriding an unrelated newly launched app.
        /// </summary>
        public static List<string> FilterDismissHomeTargets(string[] guardApps, string fullApp, bool preserveCsfs, Func<string, bool> validAppId = null)
        {
            var targets = new List<string>(guardApps == null ? 0 : guardApps.Length + 1);
            if (guardApps != null)
            {
                // Kill home.sidebar first because on Tizen 9 it is the caller/parent that spawns csfs.
                foreach (string id in guardApps)
                {
                    if (id == "com.samsung.tv.home.sidebar"
                        && (validAppId == null || validAppId(id))
                        && !targets.Contains(id))
                    {
                        targets.Add(id);
                    }
                }
                foreach (string id in guardApps)
                {
                    if (preserveCsfs && (id == "com.samsung.tv.csfs" || id == "com.samsung.tv.coba.newhome")) continue;
                    if ((validAppId == null || validAppId(id)) && !targets.Contains(id)) targets.Add(id);
                }
            }
            if (!preserveCsfs
                && !string.IsNullOrEmpty(fullApp)
                && fullApp == "com.samsung.tv.coba.newhome"
                && (validAppId == null || validAppId(fullApp))
                && !targets.Contains(fullApp))
            {
                targets.Add(fullApp);
            }
            return targets;
        }

        public static string BuildGuardedHomeRestoreCommand(string fullApp, string dyingApp, Func<string, bool> validAppId, string genCheck, bool includeDyingApp)
        {
            if (!IsGuardedSamsungHome(fullApp)) return "";
            string patterns = "*com.samsung.tv.csfs*|*com.samsung.tv.home.*|*com.samsung.tv.coba.*";
            if (includeDyingApp
                && !string.IsNullOrEmpty(dyingApp)
                && dyingApp != TvViewerAppId
                && !IsGuardedSamsungHome(dyingApp)
                && !IsScreensaverApp(dyingApp)
                && IsSafeAppToken(dyingApp)
                && (validAppId == null || validAppId(dyingApp)))
            {
                patterns += "|*" + dyingApp + "*";
            }
            return (genCheck ?? "")
                + "case \"$(/usr/bin/vconftool get memory/appfw/current_fullscreen_appid 2>/dev/null)\" in "
                + patterns
                + ") /usr/bin/app_launcher -s " + TvViewerAppId + " -u 5001 >/dev/null 2>&1; /usr/bin/vconftool set -f -t string memory/appfw/current_fullscreen_appid " + TvViewerAppId + " >/dev/null 2>&1 ;; esac";
        }

        private static bool IsSafeAppToken(string appId)
        {
            if (string.IsNullOrEmpty(appId) || appId.Length > 120) return false;
            for (int i = 0; i < appId.Length; i++)
            {
                char c = appId[i];
                bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
                    || c == '.' || c == '_' || c == '-';
                if (!ok) return false;
            }
            return true;
        }

        private static bool IsPositiveDigits(string pid)
        {
            if (string.IsNullOrEmpty(pid) || pid.Length > 10) return false;
            bool anyNonZero = false;
            for (int i = 0; i < pid.Length; i++)
            {
                char c = pid[i];
                if (c < '0' || c > '9') return false;
                if (c != '0') anyNonZero = true;
            }
            return anyNonZero;
        }

        public static string BuildReadAppPidCommand(string appId, Func<string, bool> validAppId = null)
        {
            if (string.IsNullOrEmpty(appId)
                || appId == TvViewerAppId
                || IsGuardedSamsungHome(appId)
                || IsScreensaverApp(appId)
                || !IsSafeAppToken(appId)
                || (validAppId != null && !validAppId(appId)))
            {
                return "";
            }
            return "/usr/bin/app_launcher -S 2>/dev/null | awk -v a='" + appId + "' '$1==a && $2~/^\\([0-9]+\\)$/{gsub(/[()]/,\"\",$2); print $2; exit}'";
        }

        public static string BuildCloseStuckAppCommand(string appId, string expectedPid, Func<string, bool> validAppId = null, string genCheck = "")
        {
            if (string.IsNullOrEmpty(appId)
                || string.IsNullOrEmpty(expectedPid)
                || appId == TvViewerAppId
                || IsGuardedSamsungHome(appId)
                || IsScreensaverApp(appId)
                || !IsSafeAppToken(appId)
                || (validAppId != null && !validAppId(appId))
                || !IsPositiveDigits(expectedPid))
            {
                return "";
            }
            string readPid = BuildReadAppPidCommand(appId, validAppId);
            if (string.IsNullOrEmpty(readPid)) return "";
            string prefix = genCheck ?? "";
            if (prefix.Length > 0 && !prefix.EndsWith(" ", StringComparison.Ordinal)) prefix += " ";
            return prefix
                + "dp=" + expectedPid + "; cur=$(" + readPid + "); "
                + "if [ -n \"$cur\" ] && [ \"$cur\" = \"$dp\" ]; then "
                + "/usr/bin/app_launcher -k " + appId + " >/dev/null 2>&1; "
                + "case \"$(/usr/bin/vconftool get memory/appfw/current_fullscreen_appid 2>/dev/null)\" in "
                + "*com.samsung.tv.csfs*|*com.samsung.tv.home.*|*com.samsung.tv.coba.*|*" + appId + "*) "
                + "/usr/bin/app_launcher -s " + TvViewerAppId + " -u 5001 >/dev/null 2>&1; /usr/bin/vconftool set -f -t string memory/appfw/current_fullscreen_appid " + TvViewerAppId + " >/dev/null 2>&1 ;; esac; "
                + "echo KILLED; fi";
        }
    }

    /// <summary>
    /// Coordinates stuck dying-app PID capture and close across guarded Samsung Home dismissal retries so
    /// repeated 2 s guard waves never re-capture a freshly respawned background recovery process after
    /// the original foreground instance has already been tracked or closed in the same episode.
    /// </summary>
    internal sealed class GuardedHomeCloseTracker
    {
        private readonly object _gate = new object();
        private int _activeGen = -1;
        private string _activeAppId = "";
        private bool _inFlight;
        private bool _pidCaptured;

        public bool TryBegin(int restoreGen, string dyingApp, bool allowCloseDying, string fullApp)
        {
            if (!allowCloseDying || string.IsNullOrEmpty(dyingApp)) return false;
            lock (_gate)
            {
                if (_activeGen != restoreGen || _activeAppId != dyingApp)
                {
                    _activeGen = restoreGen;
                    _activeAppId = dyingApp;
                    _inFlight = true;
                    _pidCaptured = false;
                    return true;
                }
                if (_inFlight) return false;
                if (_pidCaptured && fullApp != dyingApp) return false;
                _inFlight = true;
                return true;
            }
        }

        public void MarkPidCaptured(int restoreGen, string dyingApp, string pid)
        {
            lock (_gate)
            {
                if (_activeGen != restoreGen || _activeAppId != dyingApp) return;
                if (!string.IsNullOrEmpty(pid)) _pidCaptured = true;
                else _inFlight = false;
            }
        }

        public void MarkCompleted(int restoreGen, string dyingApp)
        {
            lock (_gate)
            {
                if (_activeGen == restoreGen && _activeAppId == dyingApp) _inFlight = false;
            }
        }

        public void Reset()
        {
            lock (_gate)
            {
                _activeGen = -1;
                _activeAppId = "";
                _inFlight = false;
                _pidCaptured = false;
            }
        }
    }

    internal struct WmStackObservation
    {
        public bool Observed;
        public bool GuardedHomeWinPresent;
        public bool ActiveAppWinPresent;
        public bool LaunchscreenWinPresent;
        public bool ScreensaverWinPresent;
        public bool HomeOccluded;
        public bool LaunchTargetReady;
    }

    internal interface IEnlightenmentWmBackend
    {
        bool TryGetWinsInfo(out List<WmStackLogic.WinInfo> wins);
        bool TryGetWindowNotiLevel(uint winId, out int level);
        bool TrySetWindowNotiLevel(uint winId, int level);
        bool TrySetWindowStack(uint winId, uint baseWinId, int mode);
        bool TrySetWindowNotiLevelAndStack(uint winId, int level, uint baseWinId, int mode);
        bool TryPromoteOverlays(IReadOnlyList<uint> overlayWinIds, int layer);
        bool TrySyncFullscreenAppId(string appId);
    }

    internal sealed class ShellEnlightenmentWmBackend : IEnlightenmentWmBackend
    {
        private readonly Func<string, string> _shellRead;

        public ShellEnlightenmentWmBackend(Func<string, string> shellRead)
        {
            _shellRead = shellRead;
        }

        public bool TryGetWinsInfo(out List<WmStackLogic.WinInfo> wins)
        {
            wins = null;
            if (_shellRead == null) return false;
            string raw = _shellRead("dbus-send --system --dest=org.enlightenment.wm --print-reply=literal /org/enlightenment/wm org.enlightenment.wm.Test.GetWinsInfo 2>/dev/null");
            if (string.IsNullOrEmpty(raw)) return false;
            wins = new List<WmStackLogic.WinInfo>(24);
            int idx = 0;
            string[] structs = raw.Split(new[] { "struct {" }, StringSplitOptions.RemoveEmptyEntries);
            foreach (string block in structs)
            {
                WmStackLogic.WinInfo w;
                if (!WmStackLogic.TryParseWinInfo(block, idx, out w)) continue;
                wins.Add(w);
                idx++;
            }
            return true;
        }

        public bool TryGetWindowNotiLevel(uint winId, out int level)
        {
            level = -1;
            if (_shellRead == null) return false;
            string reply = _shellRead("dbus-send --system --dest=org.enlightenment.wm --print-reply=literal /org/enlightenment/wm org.enlightenment.wm.Test.GetWindowNotiLevel uint32:" + winId.ToString(CultureInfo.InvariantCulture) + " 2>/dev/null");
            level = WmStackLogic.ParseIntReply(reply);
            return level >= 0;
        }

        public bool TrySetWindowNotiLevel(uint winId, int level)
        {
            if (_shellRead == null) return false;
            _shellRead("dbus-send --system --dest=org.enlightenment.wm --print-reply=literal /org/enlightenment/wm org.enlightenment.wm.Test.SetWindowNotiLevel uint32:" + winId.ToString(CultureInfo.InvariantCulture) + " int32:" + level.ToString(CultureInfo.InvariantCulture) + " 2>/dev/null");
            return true;
        }

        public bool TrySetWindowStack(uint winId, uint baseWinId, int mode)
        {
            if (_shellRead == null) return false;
            _shellRead("dbus-send --system --dest=org.enlightenment.wm --print-reply=literal /org/enlightenment/wm org.enlightenment.wm.Test.SetWindowStack uint32:" + winId.ToString(CultureInfo.InvariantCulture) + " uint32:" + baseWinId.ToString(CultureInfo.InvariantCulture) + " int32:" + mode.ToString(CultureInfo.InvariantCulture) + " 2>/dev/null");
            return true;
        }

        public bool TrySetWindowNotiLevelAndStack(uint winId, int level, uint baseWinId, int mode)
        {
            if (_shellRead == null) return false;
            string winStr = winId.ToString(CultureInfo.InvariantCulture);
            string setLvlCmd = "dbus-send --system --dest=org.enlightenment.wm --print-reply=literal /org/enlightenment/wm org.enlightenment.wm.Test.SetWindowNotiLevel uint32:" + winStr + " int32:" + level.ToString(CultureInfo.InvariantCulture) + " 2>/dev/null";
            string stackCmd = "dbus-send --system --dest=org.enlightenment.wm --print-reply=literal /org/enlightenment/wm org.enlightenment.wm.Test.SetWindowStack uint32:" + winStr + " uint32:" + baseWinId.ToString(CultureInfo.InvariantCulture) + " int32:" + mode.ToString(CultureInfo.InvariantCulture) + " 2>/dev/null";
            _shellRead(setLvlCmd + "; " + stackCmd);
            return true;
        }

        public bool TryPromoteOverlays(IReadOnlyList<uint> overlayWinIds, int layer)
        {
            if (_shellRead == null || overlayWinIds == null || overlayWinIds.Count == 0) return false;
            var promoSb = new System.Text.StringBuilder();
            for (int i = 0; i < overlayWinIds.Count; i++)
            {
                if (promoSb.Length > 0) promoSb.Append("; ");
                promoSb.Append("dbus-send --system --dest=org.enlightenment.wm --print-reply=literal /org/enlightenment/wm org.enlightenment.wm.Test.SetWindowNotiLevel uint32:")
                    .Append(overlayWinIds[i].ToString(CultureInfo.InvariantCulture))
                    .Append(" int32:").Append(layer.ToString(CultureInfo.InvariantCulture)).Append(" 2>/dev/null");
            }
            _shellRead(promoSb.ToString());
            return true;
        }

        public bool TrySyncFullscreenAppId(string appId)
        {
            if (_shellRead == null || string.IsNullOrEmpty(appId)) return false;
            _shellRead("/usr/bin/vconftool set -f -t string memory/appfw/current_fullscreen_appid " + appId + " >/dev/null 2>&1");
            return true;
        }
    }

    internal sealed class WmLaunchState
    {
        public readonly HashSet<uint> PreLaunchWinIds = new HashSet<uint>();
        public uint PreLaunchTopAppWinId;
        public uint StackedAboveIdleWinId;
        public uint ConfirmedOnTopWinId;
        public long ConfirmedOnTopSinceMs;
        public bool SnapshotTaken;
        public bool VconfSynced;
        public string TargetAppId = "";
        public string TargetLabel = "";
        public string LastPausedAppId = "";
        public string LastForceClosedAppId = "";
        public bool IsYoutubeTarget;
        public long StartedAtMs;
    }

    internal static class WmStackLogic
    {
        public const int LayerNormal = 200;
        public const int LayerShield = 250;
        public const int LayerOverlay = 500;
        public const long SameAppResidentHoldMs = 220;
        public const long YoutubeResidentHoldMs = 2200;
        public const long VconfResyncDelayMs = 250;

        public static bool ShouldContinueWorker(
            bool pending,
            long remBurstMs,
            long remShieldMs,
            long remLaunchMs,
            bool lastStepShielded,
            bool fastRetry,
            out int sleepMs)
        {
            bool needShieldRestore = lastStepShielded && remShieldMs <= 0 && remLaunchMs <= 0;
            bool again = pending || remLaunchMs > 0 || remBurstMs > 0 || remShieldMs > 0 || needShieldRestore;
            if (!again)
            {
                sleepMs = 0;
                return false;
            }
            if (pending || needShieldRestore) sleepMs = 0;
            else if (fastRetry) sleepMs = 20;
            else if (remLaunchMs > 0) sleepMs = 120;
            else if (remBurstMs > 0) sleepMs = 150;
            else sleepMs = (int)Math.Min(400, remShieldMs + 20);
            return true;
        }

        public static bool ShouldContinueWorker(
            bool pending,
            long remBurstMs,
            long remShieldMs,
            bool rapidShield,
            bool lastStepShielded,
            bool fastRetry,
            out int sleepMs)
        {
            bool needShieldRestore = lastStepShielded && remShieldMs <= 0 && !rapidShield;
            bool again = pending || remBurstMs > 0 || remShieldMs > 0 || rapidShield || needShieldRestore;
            if (!again)
            {
                sleepMs = 0;
                return false;
            }
            if (pending || needShieldRestore) sleepMs = 0;
            else if (fastRetry) sleepMs = 20;
            else if (rapidShield) sleepMs = 100;
            else if (remBurstMs > 0) sleepMs = 150;
            else sleepMs = (int)Math.Min(400, remShieldMs + 20);
            return true;
        }

        internal struct WinInfo
        {
            public uint WinId;
            public string Title;
            public int Index;
            public int X;
            public int Y;
            public int Width;
            public int Height;
            public int Layer;
            public bool Visible;
            public bool IsHidden;
            public bool IsFrameVisible;
            public int Iconic;
            public int BoolCount;

            public uint Id { get { return WinId; } }
            public int W { get { return Width; } }
            public int H { get { return Height; } }
            public bool CompData { get { return IsHidden; } }
            public bool Mapped { get { return Visible; } }
            public bool FrameVisible { get { return IsFrameVisible; } }
        }

        private static readonly HashSet<string> GenericAppSegments = new HashSet<string>(StringComparer.Ordinal)
        {
            "com", "org", "net", "tv", "tizen", "samsung", "app", "apps", "prod", "wgt", "bin", "dll", "usr", "opt"
        };

        public static bool IsLaunchscreenWindow(string title)
        {
            return title == "Launchscreen Winsys" || title == "Launchscreen Winsys BG 24 Bit";
        }

        public static bool IsYoutubeTargetApp(string appId)
        {
            return appId == IdleBackdropModel.CobaltYouTubeAppId || appId == IdleBackdropModel.WrapperYouTubeAppId;
        }

        public static bool IsCobaltWindow(string title)
        {
            return !string.IsNullOrEmpty(title)
                && title.IndexOf("cobalt", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        public static bool IsSystemBackgroundWindow(string title)
        {
            if (string.IsNullOrEmpty(title)) return true;
            if (title == "vetro-idle" || title == "tvlauncher" || title == "vetro-numpad" || title == "vetro-volume" || title == "vetro-tuner")
                return true;
            if (title == "tv-viewer" || title == "tv-viewer-graphics" || title == "tvvideosink-area")
                return true;
            if (IdleBackdropModel.IsGuardedSamsungHomeWindow(title) || IdleBackdropModel.IsScreensaverWindow(title))
                return true;
            if (title == "VirtualRemoteControl" || title == "Keyboard")
                return true;
            if (title == "ChannelList" || title == "ChannelList.dll" || title.EndsWith("/ChannelList.dll", StringComparison.Ordinal) || title.IndexOf("com.samsung.tv.channel-list", StringComparison.Ordinal) >= 0)
                return true;
            if (title == "QuickLaunch" || title == "QuickLaunch.dll" || title.EndsWith("/QuickLaunch.dll", StringComparison.Ordinal) || title.IndexOf("com.samsung.tv.quicklaunch", StringComparison.Ordinal) >= 0)
                return true;
            if (title.IndexOf("org.tizen.menu", StringComparison.OrdinalIgnoreCase) >= 0)
                return true;
            if (title.IndexOf("org.tizen.volume-app", StringComparison.OrdinalIgnoreCase) >= 0)
                return true;
            if (title.IndexOf("org.tizen.indicator", StringComparison.OrdinalIgnoreCase) >= 0)
                return true;
            if (title.IndexOf("org.tizen.autofilld", StringComparison.OrdinalIgnoreCase) >= 0)
                return true;
            if (title.IndexOf("com.samsung.tv.shortcut", StringComparison.OrdinalIgnoreCase) >= 0)
                return true;
            if (title.IndexOf("bixbycapsuleviewer", StringComparison.OrdinalIgnoreCase) >= 0)
                return true;
            if (title.IndexOf("BixbyIndicator", StringComparison.OrdinalIgnoreCase) >= 0)
                return true;
            return false;
        }

        public static bool IsSystemOverlayAppId(string appId)
        {
            if (string.IsNullOrEmpty(appId)) return false;
            return appId.IndexOf("org.tizen.menu", StringComparison.OrdinalIgnoreCase) >= 0
                || appId.IndexOf("org.tizen.volume-app", StringComparison.OrdinalIgnoreCase) >= 0
                || appId.IndexOf("org.tizen.indicator", StringComparison.OrdinalIgnoreCase) >= 0
                || appId.IndexOf("org.tizen.autofilld", StringComparison.OrdinalIgnoreCase) >= 0
                || appId.IndexOf("com.samsung.tv.shortcut", StringComparison.OrdinalIgnoreCase) >= 0
                || appId.IndexOf("bixbycapsuleviewer", StringComparison.OrdinalIgnoreCase) >= 0
                || appId.IndexOf("com.samsung.tv.quicklaunch", StringComparison.OrdinalIgnoreCase) >= 0
                || appId.IndexOf("com.samsung.tv.channel-list", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        public static bool IsLayer200UserAppWindow(WinInfo w)
        {
            return w.WinId != 0
                && w.Visible
                && !w.IsHidden
                && w.Layer == LayerNormal
                && w.Width >= 1280
                && w.Height >= 720
                && !IsSystemBackgroundWindow(w.Title)
                && !IsLaunchscreenWindow(w.Title);
        }

        internal static bool IsActiveForegroundAppWindow(
            string title,
            int winLayer,
            bool isHidden,
            bool isVisible,
            bool isFrameVisible,
            int iconic,
            int boolCount,
            bool ignoreIconic = false)
        {
            if (winLayer != LayerNormal || isHidden || !isVisible || (!ignoreIconic && iconic > 0)) return false;
            if (string.IsNullOrEmpty(title)) return false;
            if (IsLaunchscreenWindow(title)) return false;
            if (title == "vetro-idle" || title == "tvlauncher" || title == "vetro-numpad" || title == "vetro-volume" || title == "vetro-tuner") return false;
            if (title == "tv-viewer" || title == "tv-viewer-graphics" || title == "tvvideosink-area") return false;
            if (IdleBackdropModel.IsGuardedSamsungHomeWindow(title) || IdleBackdropModel.IsScreensaverWindow(title)) return false;
            if (title == "VirtualRemoteControl" || title == "Keyboard") return false;
            if (title == "ChannelList" || title == "ChannelList.dll" || title.EndsWith("/ChannelList.dll", StringComparison.Ordinal) || title.IndexOf("com.samsung.tv.channel-list", StringComparison.Ordinal) >= 0) return false;
            if (title.IndexOf("QuickLaunch", StringComparison.OrdinalIgnoreCase) >= 0) return false;
            if (title.IndexOf("org.tizen.menu", StringComparison.OrdinalIgnoreCase) >= 0) return false;
            if (title.IndexOf("org.tizen.volume-app", StringComparison.OrdinalIgnoreCase) >= 0) return false;
            if (title.IndexOf("org.tizen.indicator", StringComparison.OrdinalIgnoreCase) >= 0) return false;
            if (title.IndexOf("org.tizen.autofilld", StringComparison.OrdinalIgnoreCase) >= 0) return false;
            if (title.IndexOf("com.samsung.tv.shortcut", StringComparison.OrdinalIgnoreCase) >= 0) return false;
            if (title.IndexOf("bixbycapsuleviewer", StringComparison.OrdinalIgnoreCase) >= 0) return false;
            if (title.IndexOf("BixbyIndicator", StringComparison.OrdinalIgnoreCase) >= 0) return false;
            if (title.IndexOf("airplay-app-2", StringComparison.OrdinalIgnoreCase) >= 0 && !ignoreIconic && boolCount >= 3 && !isFrameVisible) return false;
            return true;
        }

        private static string NormAlnum(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            var sb = new System.Text.StringBuilder(s.Length);
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                if (char.IsLetterOrDigit(c)) sb.Append(char.ToLowerInvariant(c));
            }
            return sb.ToString();
        }

        public static bool WindowMatchesTarget(string winTitle, string targetAppId, string targetLabel)
        {
            string normWin = NormAlnum(winTitle);
            if (normWin.Length < 3) return false;
            if (IsCobaltWindow(winTitle))
            {
                if (IsYoutubeTargetApp(targetAppId)) return true;
                string lowTarget = (targetAppId ?? "") + " " + (targetLabel ?? "");
                return lowTarget.IndexOf("cobalt", StringComparison.OrdinalIgnoreCase) >= 0
                    || lowTarget.IndexOf("youtube", StringComparison.OrdinalIgnoreCase) >= 0;
            }

            var tokens = new List<string>(6);
            string normLabel = NormAlnum(targetLabel);
            if (normLabel.Length >= 3) tokens.Add(normLabel);

            if (!string.IsNullOrEmpty(targetAppId))
            {
                string[] parts = targetAppId.Split(new[] { '.', '-', '_' }, StringSplitOptions.RemoveEmptyEntries);
                for (int i = 0; i < parts.Length; i++)
                {
                    string seg = NormAlnum(parts[i]);
                    if (seg.Length >= 3 && !GenericAppSegments.Contains(seg) && !tokens.Contains(seg))
                        tokens.Add(seg);
                }
                string fullNorm = NormAlnum(targetAppId);
                if (fullNorm.Length >= 3 && !tokens.Contains(fullNorm)) tokens.Add(fullNorm);
            }

            for (int i = 0; i < tokens.Count; i++)
            {
                string tok = tokens[i];
                if (normWin.IndexOf(tok, StringComparison.Ordinal) >= 0 || tok.IndexOf(normWin, StringComparison.Ordinal) >= 0)
                    return true;
            }
            return false;
        }

        public static bool NeedsFullscreenVconfResync(string currentFullscreenAppId)
        {
            return string.IsNullOrEmpty(currentFullscreenAppId)
                || currentFullscreenAppId == IdleBackdropModel.TvViewerAppId
                || IdleBackdropModel.IsGuardedSamsungHome(currentFullscreenAppId);
        }

        public static string ResolveLaunchSyncAppId(string topWinTitle, string targetAppId, string lastForceClosedAppId)
        {
            if (IsSystemBackgroundWindow(topWinTitle))
                return "";
            if (IsCobaltWindow(topWinTitle) || targetAppId == IdleBackdropModel.WrapperYouTubeAppId)
                return IdleBackdropModel.CobaltYouTubeAppId;
            string candidate = !string.IsNullOrEmpty(targetAppId) ? targetAppId : (lastForceClosedAppId ?? "");
            if (candidate == IdleBackdropModel.WrapperYouTubeAppId)
                return IdleBackdropModel.CobaltYouTubeAppId;
            if (string.IsNullOrEmpty(candidate)
                || candidate == IdleBackdropModel.TvViewerAppId
                || IdleBackdropModel.IsGuardedSamsungHome(candidate)
                || IsSystemOverlayAppId(candidate)
                || candidate.StartsWith("vetrotvapp", StringComparison.OrdinalIgnoreCase)
                || !Catalog.ValidAppId(candidate))
            {
                return "";
            }
            return candidate;
        }

        public static void Step(
            Func<string, string> shellRead,
            bool allowSamsungHome,
            bool guardedHomeActive,
            bool partialActive,
            bool shieldTime,
            ref bool active,
            ref bool probed,
            ref uint idleWinId,
            Action<string> log,
            bool launchingApp = false,
            WmLaunchState launchState = null,
            long nowMs = 0,
            Func<string> readFullscreenAppId = null)
        {
            WmStackObservation obs;
            Step(shellRead, allowSamsungHome, guardedHomeActive, partialActive, shieldTime, false, ref active, ref probed, ref idleWinId, out obs, log, launchingApp, launchState, nowMs, readFullscreenAppId);
        }

        public static void Step(
            Func<string, string> shellRead,
            bool allowSamsungHome,
            bool guardedHomeActive,
            bool partialActive,
            bool shieldTime,
            bool screensaverActive,
            ref bool active,
            ref bool probed,
            ref uint idleWinId,
            Action<string> log)
        {
            WmStackObservation obs;
            Step(shellRead, allowSamsungHome, guardedHomeActive, partialActive, shieldTime, screensaverActive, ref active, ref probed, ref idleWinId, out obs, log);
        }

        public static void Step(
            Func<string, string> shellRead,
            bool allowSamsungHome,
            bool guardedHomeActive,
            bool partialActive,
            bool shieldTime,
            ref bool active,
            ref bool probed,
            ref uint idleWinId,
            out WmStackObservation observation,
            Action<string> log,
            bool launchingApp = false,
            WmLaunchState launchState = null,
            long nowMs = 0,
            Func<string> readFullscreenAppId = null)
        {
            Step(shellRead, allowSamsungHome, guardedHomeActive, partialActive, shieldTime, false, ref active, ref probed, ref idleWinId, out observation, log, launchingApp, launchState, nowMs, readFullscreenAppId);
        }

        public static void Step(
            Func<string, string> shellRead,
            bool allowSamsungHome,
            bool guardedHomeActive,
            bool partialActive,
            bool shieldTime,
            bool screensaverActive,
            ref bool active,
            ref bool probed,
            ref uint idleWinId,
            out WmStackObservation observation,
            Action<string> log,
            bool launchingApp = false,
            WmLaunchState launchState = null,
            long nowMs = 0,
            Func<string> readFullscreenAppId = null)
        {
            if (shellRead == null)
            {
                observation = default(WmStackObservation);
                return;
            }
            Step(new ShellEnlightenmentWmBackend(shellRead), allowSamsungHome, guardedHomeActive, partialActive, shieldTime, screensaverActive, ref active, ref probed, ref idleWinId, out observation, log, launchingApp, launchState, nowMs, readFullscreenAppId);
        }

        public static void Step(
            IEnlightenmentWmBackend backend,
            bool allowSamsungHome,
            bool guardedHomeActive,
            bool partialActive,
            bool shieldTime,
            bool screensaverActive,
            ref bool active,
            ref bool probed,
            ref uint idleWinId,
            out WmStackObservation observation,
            Action<string> log,
            bool launchingApp = false,
            WmLaunchState launchState = null,
            long nowMs = 0,
            Func<string> readFullscreenAppId = null,
            bool screensaverTakeover = false)
        {
            observation = default(WmStackObservation);
            if (backend == null) return;
            List<WinInfo> wins;
            if (!backend.TryGetWinsInfo(out wins) || wins == null)
            {
                if (!probed) { probed = true; if (log != null) log("wm stack: GetWinsInfo unavailable, using PartialAppId hide fallback"); }
                return;
            }

            uint idleWin = 0, tvViewerWin = 0, tvGraphicsWin = 0, tvVideoSinkWin = 0, homeWin = 0, rawHomeWin = 0, bottomOverlayWin = 0, lowestAppWin = 0, launchscreenWin = 0, bottomNormalScreensaverWin = 0;
            int idleIndex = -1, tvViewerIndex = -1, tvGraphicsIndex = -1, tvVideoSinkIndex = -1, tvBoundaryIndex = -1, homeIndex = int.MaxValue, homeLayer = -1, rawHomeIndex = int.MaxValue, rawHomeLayer = -1, bottomOverlayIndex = -1, lowestAppIndex = -1, launchscreenIndex = -1, bottomNormalScreensaverIndex = -1;
            bool idleVisible = false;
            bool screensaverWinPresent = false;
            List<uint> overlaysToPromote = null;
            for (int idx = 0; idx < wins.Count; idx++)
            {
                WinInfo w = wins[idx];
                w.Index = idx;
                wins[idx] = w;
                string title = w.Title;
                uint winId = w.WinId;
                bool realSurface = w.Width > 1 && w.Height > 1;
                if (title == "vetro-idle") { idleWin = winId; idleIndex = idx; idleVisible = w.Visible && !w.IsHidden; }
                else if (title == "tv-viewer")
                {
                    if (realSurface && (w.Layer < 0 || w.Layer == LayerNormal))
                    {
                        tvViewerWin = winId;
                        tvViewerIndex = idx;
                        if (tvBoundaryIndex < 0 || idx < tvBoundaryIndex) tvBoundaryIndex = idx;
                    }
                }
                else if (title == "tv-viewer-graphics")
                {
                    if (realSurface && (w.Layer < 0 || w.Layer == LayerNormal))
                    {
                        tvGraphicsWin = winId;
                        tvGraphicsIndex = idx;
                        if (tvBoundaryIndex < 0 || idx < tvBoundaryIndex) tvBoundaryIndex = idx;
                    }
                }
                else if (title == "tvvideosink-area")
                {
                    if (realSurface && (w.Layer < 0 || w.Layer == LayerNormal))
                    {
                        tvVideoSinkWin = winId;
                        tvVideoSinkIndex = idx;
                    }
                }
                else if (title == "tvlauncher" || title == "vetro-numpad" || title == "vetro-volume")
                {
                    if (realSurface && w.Layer >= 0 && w.Layer < LayerOverlay)
                    {
                        if (overlaysToPromote == null) overlaysToPromote = new List<uint>(4);
                        if (!overlaysToPromote.Contains(winId)) overlaysToPromote.Add(winId);
                    }
                    if (!w.IsHidden && w.Visible && realSurface && (w.Layer < 0 || w.Layer == LayerShield) && idx > bottomOverlayIndex)
                    {
                        bottomOverlayWin = winId;
                        bottomOverlayIndex = idx;
                    }
                }
            }

            // Pass 2: Enlightenment's occlusion culler sets Icon=1 on opaque 24-bit 1920x1080 windows below vetro-idle.
            // Use tv-viewer / tv-viewer-graphics on layer 200 as the Z-order boundary separating foreground apps/home
            // (i < tvBoundaryIndex, occlusion-safe regardless of iconic) from background/prelaunched apps (i > tvBoundaryIndex).
            for (int i = 0; i < wins.Count; i++)
            {
                WinInfo w = wins[i];
                if (w.Title == "vetro-idle" || w.Title == "tv-viewer" || w.Title == "tv-viewer-graphics" || w.Title == "tvvideosink-area"
                    || w.Title == "tvlauncher" || w.Title == "vetro-numpad" || w.Title == "vetro-volume")
                {
                    continue;
                }
                bool realSurface = w.Width > 1 && w.Height > 1;
                if (IdleBackdropModel.IsScreensaverWindow(w.Title))
                {
                    // Terminating screensavers are lowered by e-mod-tizen-screensaver to layer 150 (E_LAYER_CLIENT_BELOW)
                    // while aul_terminate_pid_async_v2 kills the PID; unmapped or 1x1 dummy surfaces are also inactive.
                    if (!w.IsHidden && w.Visible && realSurface && (w.Layer < 0 || w.Layer >= LayerNormal))
                    {
                        screensaverWinPresent = true;
                        if ((w.Layer < 0 || w.Layer == LayerNormal) && i > bottomNormalScreensaverIndex)
                        {
                            bottomNormalScreensaverWin = w.WinId;
                            bottomNormalScreensaverIndex = i;
                        }
                    }
                }
                else if (IdleBackdropModel.IsGuardedSamsungHomeWindow(w.Title))
                {
                    if (!w.IsHidden && w.Visible && realSurface && (w.Layer < 0 || w.Layer >= LayerNormal))
                    {
                        if ((w.Layer < 0 || w.Layer == LayerNormal) && i < rawHomeIndex)
                        {
                            rawHomeWin = w.WinId;
                            rawHomeIndex = i;
                            rawHomeLayer = w.Layer;
                        }
                        bool homeOcclusionSafe = w.Layer >= LayerShield
                            || (tvBoundaryIndex >= 0 ? i < tvBoundaryIndex : w.Iconic <= 0);
                        if (homeOcclusionSafe && i < homeIndex)
                        {
                            homeWin = w.WinId;
                            homeIndex = i;
                            homeLayer = w.Layer;
                        }
                    }
                }
                else if (IsLaunchscreenWindow(w.Title))
                {
                    if (!w.IsHidden && w.Visible && realSurface && (w.Layer < 0 || w.Layer == LayerNormal) && (tvBoundaryIndex < 0 || i < tvBoundaryIndex))
                    {
                        launchscreenWin = w.WinId;
                        launchscreenIndex = i;
                    }
                }
                else if (realSurface
                    && (tvBoundaryIndex < 0 || i < tvBoundaryIndex)
                    && IsActiveForegroundAppWindow(w.Title, w.Layer, w.IsHidden, w.Visible, w.IsFrameVisible, w.Iconic, w.BoolCount, tvBoundaryIndex >= 0))
                {
                    lowestAppWin = w.WinId;
                    lowestAppIndex = i;
                }
            }

            observation.Observed = wins.Count > 0;
            observation.ActiveAppWinPresent = lowestAppWin != 0;
            observation.LaunchscreenWinPresent = launchscreenWin != 0;
            observation.ScreensaverWinPresent = screensaverWinPresent;
            observation.GuardedHomeWinPresent = homeWin != 0
                && (lowestAppWin == 0 || homeIndex < lowestAppIndex || homeLayer >= LayerShield);

            // Capture pre-launch Layer-200 user app snapshot on the first step of a launch even before vetro-idle maps.
            if (launchingApp && launchState != null && !launchState.SnapshotTaken)
            {
                launchState.PreLaunchWinIds.Clear();
                launchState.PreLaunchTopAppWinId = 0;
                for (int i = 0; i < wins.Count; i++)
                {
                    WinInfo w = wins[i];
                    if (!IsLayer200UserAppWindow(w)) continue;
                    launchState.PreLaunchWinIds.Add(w.WinId);
                    if (launchState.PreLaunchTopAppWinId == 0 && (tvViewerIndex < 0 || w.Index < tvViewerIndex))
                    {
                        launchState.PreLaunchTopAppWinId = w.WinId;
                    }
                }
                launchState.SnapshotTaken = true;
                if (idleWin == 0 || !idleVisible)
                {
                    BuryWarmHomeIfAboveTvViewer(backend, allowSamsungHome, tvViewerWin, tvViewerIndex, rawHomeWin, rawHomeIndex, rawHomeLayer);
                    return;
                }
            }

            // Prune any pre-launch window that unmapped/hid during teardown (e.g. app_launcher -t on Cobalt)
            // so if it later re-maps (even reusing the same WinId), !PreLaunchWinIds.Contains(w.WinId) promotes immediately.
            if (launchingApp && launchState != null && launchState.SnapshotTaken
                && (launchState.PreLaunchWinIds.Count > 0 || launchState.StackedAboveIdleWinId != 0 || launchState.ConfirmedOnTopWinId != 0))
            {
                var visibleIds = new HashSet<uint>();
                for (int i = 0; i < wins.Count; i++)
                {
                    WinInfo w = wins[i];
                    if (w.WinId != 0 && w.Visible && !w.IsHidden) visibleIds.Add(w.WinId);
                }
                launchState.PreLaunchWinIds.RemoveWhere(id => !visibleIds.Contains(id));
                if (launchState.StackedAboveIdleWinId != 0 && !visibleIds.Contains(launchState.StackedAboveIdleWinId))
                {
                    launchState.StackedAboveIdleWinId = 0;
                }
                if (launchState.ConfirmedOnTopWinId != 0 && !visibleIds.Contains(launchState.ConfirmedOnTopWinId))
                {
                    launchState.ConfirmedOnTopWinId = 0;
                    launchState.ConfirmedOnTopSinceMs = 0;
                    launchState.VconfSynced = false;
                }
            }

            if (idleWin == 0)
            {
                idleWinId = 0;
                if (overlaysToPromote != null && overlaysToPromote.Count > 0)
                    PromoteOverlaysToLayer500(backend, overlaysToPromote, ref bottomOverlayWin, ref bottomOverlayIndex);
                BuryWarmHomeIfAboveTvViewer(backend, allowSamsungHome, tvViewerWin, tvViewerIndex, rawHomeWin, rawHomeIndex, rawHomeLayer);
                return;
            }
            idleWinId = idleWin;

            // During app launch:
            // 1) Keep vetro-idle on LayerNormal (200) ABOVE all pre-existing background apps (paused cobalt-app), tv-viewer, and csfs.
            // 2) As soon as a qualifying launched Layer-200 app window appears (or raises/matches target) below vetro-idle,
            //    call SetWindowStack(idleWin, appWin, 0) to place vetro-idle immediately BELOW that app so WRT apps (Nuvio TV, Player.pl)
            //    and warm Cobalt YouTube are unoccluded and Enlightenment immediately updates current_fullscreen_appid -> idle: Hide.
            // 3) If Tizen's native Launchscreen Winsys loading spinner maps during an active app launch before the real app window,
            //    stack vetro-idle strictly BELOW Launchscreen Winsys* so the user sees the loading spinner without triggering premature vconf resync.
            // 4) If the same app was just force-closed while Layer-250 vetro-idle occluded tv-viewer, Enlightenment's internal
            //    prev_fullscreen_appid stayed equal to that appId and suppresses its own vconf write; resync vconf after 250 ms on top.
            if (launchingApp)
            {
                int curLayerLaunch;
                bool droppedLayer = EnsureIdleLayerNormal(backend, idleWin, ref active, ref probed, log, out curLayerLaunch);
                if (curLayerLaunch >= 0 && overlaysToPromote != null && overlaysToPromote.Count > 0)
                    PromoteOverlaysToLayer500(backend, overlaysToPromote, ref bottomOverlayWin, ref bottomOverlayIndex);
                bool qualifyingOnTop = false;
                if (launchState != null && launchState.SnapshotTaken)
                {
                    WinInfo topApp = default(WinInfo);
                    bool foundTopApp = false;
                    for (int i = 0; i < wins.Count; i++)
                    {
                        WinInfo w = wins[i];
                        if (!IsLayer200UserAppWindow(w)) continue;
                        if (tvViewerIndex >= 0 && w.Index >= tvViewerIndex) continue;
                        topApp = w;
                        foundTopApp = true;
                        break;
                    }
                    if (foundTopApp)
                    {
                        long elapsedMs = nowMs > launchState.StartedAtMs ? (nowMs - launchState.StartedAtMs) : 0;
                        long residentHoldMs = launchState.IsYoutubeTarget ? YoutubeResidentHoldMs : SameAppResidentHoldMs;
                        bool isBrandNew = !launchState.PreLaunchWinIds.Contains(topApp.WinId);
                        bool isRaisedResident = topApp.WinId != launchState.PreLaunchTopAppWinId
                            && (launchState.IsYoutubeTarget
                                ? IsCobaltWindow(topApp.Title)
                                : !IsCobaltWindow(topApp.Title));
                        bool isSameResidentTarget = elapsedMs >= residentHoldMs
                            && (launchState.IsYoutubeTarget || topApp.WinId == launchState.PreLaunchTopAppWinId)
                            && (WindowMatchesTarget(topApp.Title, launchState.TargetAppId, launchState.TargetLabel)
                                || (!launchState.IsYoutubeTarget
                                    && !string.IsNullOrEmpty(launchState.LastPausedAppId)
                                    && launchState.LastPausedAppId == launchState.TargetAppId
                                    && !IsCobaltWindow(topApp.Title)));
                        if (isBrandNew || isRaisedResident || isSameResidentTarget)
                        {
                            if (droppedLayer || idleIndex < topApp.Index)
                            {
                                uint prevStacked = launchState.StackedAboveIdleWinId;
                                backend.TrySetWindowStack(idleWin, topApp.WinId, 0);
                                launchState.StackedAboveIdleWinId = topApp.WinId;
                                if (log != null && prevStacked != topApp.WinId) log("wm stack: launch raised win=" + topApp.WinId + " (" + topApp.Title + ") above vetro-idle");
                                qualifyingOnTop = true;
                            }
                            else if (topApp.Index < idleIndex)
                            {
                                launchState.StackedAboveIdleWinId = topApp.WinId;
                                qualifyingOnTop = true;
                            }
                        }
                    }

                    if (qualifyingOnTop)
                    {
                        if (launchState.ConfirmedOnTopWinId != topApp.WinId)
                        {
                            launchState.ConfirmedOnTopWinId = topApp.WinId;
                            launchState.ConfirmedOnTopSinceMs = nowMs;
                            launchState.VconfSynced = false;
                        }
                        if (!launchState.VconfSynced
                            && readFullscreenAppId != null
                            && nowMs >= launchState.ConfirmedOnTopSinceMs
                            && (nowMs - launchState.ConfirmedOnTopSinceMs) >= VconfResyncDelayMs)
                        {
                            string curFull = readFullscreenAppId() ?? "";
                            if (NeedsFullscreenVconfResync(curFull))
                            {
                                string syncAppId = ResolveLaunchSyncAppId(topApp.Title, launchState.TargetAppId, launchState.LastForceClosedAppId);
                                if (!string.IsNullOrEmpty(syncAppId))
                                {
                                    launchState.VconfSynced = true;
                                    backend.TrySyncFullscreenAppId(syncAppId);
                                    if (log != null) log("wm stack: resynced vconf fullscreen=" + syncAppId);
                                }
                            }
                            else
                            {
                                launchState.VconfSynced = true;
                            }
                        }
                    }
                    else
                    {
                        launchState.ConfirmedOnTopWinId = 0;
                        launchState.ConfirmedOnTopSinceMs = 0;
                        launchState.VconfSynced = false;
                    }
                }
                observation.LaunchTargetReady = qualifyingOnTop;
                if (launchState == null || launchState.StackedAboveIdleWinId == 0)
                {
                    if (!allowSamsungHome && launchscreenWin != 0)
                    {
                        if (droppedLayer || idleIndex < launchscreenIndex || (tvViewerIndex >= 0 && idleIndex > tvViewerIndex))
                            backend.TrySetWindowStack(idleWin, launchscreenWin, 0);
                    }
                    else
                    {
                        uint topTv = 0;
                        int topTvIndex = int.MaxValue;
                        if (tvGraphicsWin != 0 && tvGraphicsIndex < topTvIndex) { topTv = tvGraphicsWin; topTvIndex = tvGraphicsIndex; }
                        if (tvViewerWin != 0 && tvViewerIndex < topTvIndex) { topTv = tvViewerWin; topTvIndex = tvViewerIndex; }
                        if (tvVideoSinkWin != 0 && tvVideoSinkIndex < topTvIndex) { topTv = tvVideoSinkWin; topTvIndex = tvVideoSinkIndex; }
                        if (!allowSamsungHome && homeWin != 0 && (homeLayer < 0 || homeLayer == LayerNormal) && homeIndex < topTvIndex) { topTv = homeWin; topTvIndex = homeIndex; }
                        if (topTv != 0 && ((droppedLayer && lowestAppWin == 0) || idleIndex > topTvIndex))
                        {
                            backend.TrySetWindowStack(idleWin, topTv, 1);
                        }
                    }
                }
                BuryWarmHomeIfAboveTvViewer(backend, allowSamsungHome, tvViewerWin, tvViewerIndex, rawHomeWin, rawHomeIndex, rawHomeLayer);
                return;
            }

            // Outside an active app launch, pre-stage hidden vetro-idle at LayerShield (250) whenever !saverNow && !allowSamsungHome,
            // keep visible steady-state vetro-idle on LayerNormal (200) above tv-viewer, and promote visible vetro-idle to
            // LayerShield (250) during an active shield or guarded-home teardown (dropping to LayerNormal whenever a real screensaver is active).
            bool saverNow = !screensaverTakeover && (screensaverActive || screensaverWinPresent);
            bool prestageHiddenShield = !idleVisible && !saverNow && !allowSamsungHome;
            bool wantShield = (screensaverTakeover && idleVisible)
                || prestageHiddenShield
                || (!allowSamsungHome
                    && !saverNow
                    && ((shieldTime && !partialActive) || (guardedHomeActive && homeWin != 0)));
            int targetLayer = wantShield ? LayerShield : LayerNormal;

            int curLayer;
            backend.TryGetWindowNotiLevel(idleWin, out curLayer);
            if (curLayer >= 0 && overlaysToPromote != null && overlaysToPromote.Count > 0)
            {
                PromoteOverlaysToLayer500(backend, overlaysToPromote, ref bottomOverlayWin, ref bottomOverlayIndex);
            }
            bool layerChanged = curLayer != targetLayer;
            bool chainedOverlayStack = false;
            if (layerChanged)
            {
                if (targetLayer == LayerShield && bottomOverlayWin != 0)
                {
                    backend.TrySetWindowNotiLevelAndStack(idleWin, targetLayer, bottomOverlayWin, 0);
                    chainedOverlayStack = true;
                }
                else
                {
                    backend.TrySetWindowNotiLevel(idleWin, targetLayer);
                }
                backend.TryGetWindowNotiLevel(idleWin, out curLayer);
            }

            if (curLayer == targetLayer)
            {
                if (!active)
                {
                    active = true;
                    probed = true;
                    if (log != null) log("wm stack: C1 active (win=" + idleWin + " layer=" + curLayer + ")");
                }
                // GetWinsInfo lists top-to-bottom: smaller index is higher in Z-order.
                bool stackChanged = chainedOverlayStack;
                if (curLayer == LayerShield)
                {
                    // Ensure vetro-idle sits above any guarded Samsung Home window on layer >= 250.
                    if ((!allowSamsungHome || screensaverTakeover) && homeWin != 0 && (homeLayer < 0 || (homeLayer >= LayerShield && homeLayer < 900)) && (layerChanged || idleIndex > homeIndex))
                    {
                        backend.TrySetWindowStack(idleWin, homeWin, 1);
                        stackChanged = true;
                        chainedOverlayStack = false;
                    }
                    // Keep vetro-idle strictly below mapped tvlauncher/vetro-numpad/vetro-volume on layer 250 (fallback when firmware refuses Layer 500).
                    if (bottomOverlayWin != 0 && !chainedOverlayStack && (layerChanged || idleIndex < bottomOverlayIndex))
                    {
                        backend.TrySetWindowStack(idleWin, bottomOverlayWin, 0);
                        stackChanged = true;
                    }
                }
                else
                {
                    uint topTv = 0;
                    int topTvIndex = int.MaxValue;
                    if (tvGraphicsWin != 0 && tvGraphicsIndex < topTvIndex) { topTv = tvGraphicsWin; topTvIndex = tvGraphicsIndex; }
                    if (tvViewerWin != 0 && tvViewerIndex < topTvIndex) { topTv = tvViewerWin; topTvIndex = tvViewerIndex; }
                    if (tvVideoSinkWin != 0 && tvVideoSinkIndex < topTvIndex) { topTv = tvVideoSinkWin; topTvIndex = tvVideoSinkIndex; }
                    if (!allowSamsungHome && homeWin != 0 && (homeLayer < 0 || homeLayer == LayerNormal) && homeIndex < topTvIndex) { topTv = homeWin; topTvIndex = homeIndex; }
                    if (saverNow)
                    {
                        // Keep vetro-idle directly below any layer-200 screensaver window (e.g. spotlight-ss) and at the top of
                        // non-screensaver layer-200 windows so background apps (home.media/csfs/tv-viewer) never become unobscured.
                        if (bottomNormalScreensaverWin != 0 && (layerChanged || idleIndex < bottomNormalScreensaverIndex))
                        {
                            backend.TrySetWindowStack(idleWin, bottomNormalScreensaverWin, 0);
                            stackChanged = true;
                        }
                        else if (!layerChanged && topTv != 0 && idleIndex > topTvIndex)
                        {
                            backend.TrySetWindowStack(idleWin, topTv, 1);
                            stackChanged = true;
                        }
                    }
                    else if (topTv != 0 && (layerChanged || idleIndex > topTvIndex))
                    {
                        backend.TrySetWindowStack(idleWin, topTv, 1);
                        stackChanged = true;
                    }
                }
                if (idleVisible && !allowSamsungHome && !layerChanged && !stackChanged && (homeWin == 0 || (idleIndex >= 0 && idleIndex < homeIndex && (homeLayer < 0 || homeLayer < 900))))
                {
                    observation.HomeOccluded = true;
                }
            }
            else if (!probed)
            {
                probed = true;
                if (log != null) log("wm stack: C1 refused (layer=" + curLayer + "), using fallback");
            }
            BuryWarmHomeIfAboveTvViewer(backend, allowSamsungHome, tvViewerWin, tvViewerIndex, rawHomeWin, rawHomeIndex, rawHomeLayer);
        }

        private static void BuryWarmHomeIfAboveTvViewer(
            IEnlightenmentWmBackend backend,
            bool allowSamsungHome,
            uint tvViewerWin,
            int tvViewerIndex,
            uint rawHomeWin,
            int rawHomeIndex,
            int rawHomeLayer)
        {
            if (!allowSamsungHome
                && tvViewerWin != 0
                && rawHomeWin != 0
                && (rawHomeLayer < 0 || rawHomeLayer == LayerNormal)
                && rawHomeIndex < tvViewerIndex)
            {
                backend.TrySetWindowStack(rawHomeWin, tvViewerWin, 0);
            }
        }

        private static void PromoteOverlaysToLayer500(IEnlightenmentWmBackend backend, List<uint> overlaysToPromote, ref uint bottomOverlayWin, ref int bottomOverlayIndex)
        {
            backend.TryPromoteOverlays(overlaysToPromote, LayerOverlay);
            if (bottomOverlayWin != 0 && overlaysToPromote.Contains(bottomOverlayWin))
            {
                int ovLayer;
                if (backend.TryGetWindowNotiLevel(bottomOverlayWin, out ovLayer) && ovLayer >= LayerOverlay)
                {
                    bottomOverlayWin = 0;
                    bottomOverlayIndex = -1;
                }
            }
        }

        private static bool EnsureIdleLayerNormal(IEnlightenmentWmBackend backend, uint idleWin, ref bool active, ref bool probed, Action<string> log, out int curLayer)
        {
            backend.TryGetWindowNotiLevel(idleWin, out curLayer);
            bool changed = curLayer != LayerNormal;
            if (changed)
            {
                backend.TrySetWindowNotiLevel(idleWin, LayerNormal);
                backend.TryGetWindowNotiLevel(idleWin, out curLayer);
            }
            if (curLayer == LayerNormal && !active)
            {
                active = true;
                probed = true;
                if (log != null) log("wm stack: C1 active (win=" + idleWin + " layer=" + curLayer + ")");
            }
            return changed;
        }

        /// <summary>
        /// Parses one window struct from <c>org.enlightenment.wm.Test.GetWinsInfo</c> (<c>ua(usiiiiibbbiibibbbi)</c>)
        /// across both <c>dbus-send --print-reply=literal</c> (where <c>i[0]</c> = <c>x</c> prints inline on the title line,
        /// or as a leading <c>int32 &lt;x&gt;</c> line when <c>title</c> is empty) and <c>--print-reply</c> (<c>string "..."</c>).
        /// </summary>
        internal static bool TryParseWin(string block, out WinInfo win)
        {
            return TryParseWinCore(block, 0, true, out win);
        }

        internal static bool TryParseWinInfo(string block, int index, out WinInfo info)
        {
            return TryParseWinCore(block, index, false, out info);
        }

        private static bool TryParseWinCore(string block, int index, bool strictStruct, out WinInfo info)
        {
            info = new WinInfo { Index = index, Width = 1920, Height = 1080, Layer = -1, Visible = true, IsHidden = false, IsFrameVisible = true, Iconic = 0, BoolCount = 0 };
            if (string.IsNullOrEmpty(block)) return false;

            bool hasWinId = false;
            bool inQuotedTitle = false;
            string title = null;
            bool seenBool = false;
            int postBoolIntCount = 0;
            var ints = new List<int>(8);
            var bools = new List<bool>(8);

            string[] lines = block.Split('\n');
            for (int i = 0; i < lines.Length; i++)
            {
                string rawLine = lines[i];
                string line = rawLine.Trim();
                if (!inQuotedTitle && line.Length == 0) continue;
                if (!inQuotedTitle && line.StartsWith("}", StringComparison.Ordinal)) break;

                if (!hasWinId)
                {
                    if (line.StartsWith("uint32 ", StringComparison.Ordinal))
                    {
                        uint parsedId;
                        if (uint.TryParse(line.Substring(7).Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out parsedId) && parsedId != 0)
                        {
                            info.WinId = parsedId;
                            hasWinId = true;
                        }
                    }
                    continue;
                }

                if (inQuotedTitle)
                {
                    string trimmedEnd = rawLine.TrimEnd('\r', ' ', '\t');
                    if (EndsWithUnescapedQuote(trimmedEnd, 0))
                    {
                        title = UnescapeDbusString(title + "\n" + trimmedEnd.Substring(0, trimmedEnd.Length - 1));
                        inQuotedTitle = false;
                    }
                    else
                    {
                        title = title + "\n" + trimmedEnd;
                    }
                    continue;
                }

                if (title == null)
                {
                    if (line.StartsWith("string \"", StringComparison.Ordinal))
                    {
                        if (line.Length >= 9 && EndsWithUnescapedQuote(line, 8))
                        {
                            title = UnescapeDbusString(line.Substring(8, line.Length - 9));
                        }
                        else
                        {
                            title = line.Substring(8);
                            inQuotedTitle = true;
                        }
                    }
                    else if (line.StartsWith("int32 ", StringComparison.Ordinal))
                    {
                        int xVal;
                        if (!int.TryParse(line.Substring(6).Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out xVal))
                            return false;
                        title = "";
                        ints.Add(xVal);
                    }
                    else if (!line.StartsWith("boolean ", StringComparison.Ordinal))
                    {
                        string head;
                        int inlineX;
                        if (TrySplitInlineInt32(line, out head, out inlineX))
                        {
                            title = head;
                            ints.Add(inlineX);
                        }
                        else
                        {
                            title = line;
                        }
                    }
                    else
                    {
                        return false;
                    }
                    continue;
                }

                if (line.StartsWith("int32 ", StringComparison.Ordinal))
                {
                    int v;
                    if (int.TryParse(line.Substring(6).Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out v))
                    {
                        if (!seenBool) ints.Add(v);
                        else
                        {
                            if (postBoolIntCount == 2) info.Iconic = v;
                            postBoolIntCount++;
                        }
                    }
                    else if (!seenBool)
                    {
                        return false;
                    }
                    else
                    {
                        postBoolIntCount++;
                    }
                    continue;
                }

                if (line.StartsWith("boolean ", StringComparison.Ordinal))
                {
                    if (strictStruct && ints.Count < 5) return false;
                    string bStr = line.Substring(8).Trim();
                    bool bv;
                    if (string.Equals(bStr, "true", StringComparison.OrdinalIgnoreCase)) bv = true;
                    else if (string.Equals(bStr, "false", StringComparison.OrdinalIgnoreCase)) bv = false;
                    else return false;
                    seenBool = true;
                    bools.Add(bv);
                    continue;
                }

                if (!seenBool && ints.Count == 0)
                {
                    string head;
                    int inlineX;
                    if (TrySplitInlineInt32(line, out head, out inlineX))
                    {
                        title = head.Length > 0 ? title + "\n" + head : title;
                        ints.Add(inlineX);
                    }
                    else
                    {
                        title = title + "\n" + line;
                    }
                    continue;
                }

                if (strictStruct) return false;
            }

            if (!hasWinId || title == null || inQuotedTitle) return false;
            if (strictStruct && (ints.Count < 5 || bools.Count < 3)) return false;
            if (!strictStruct && ints.Count < 2) return false;

            info.Title = title;
            if (ints.Count >= 5)
            {
                info.X = ints[0];
                info.Y = ints[1];
                info.Width = ints[2];
                info.Height = ints[3];
                info.Layer = ints[4];
            }
            else
            {
                info.Layer = ints[1];
            }

            // On Tizen 9 GetWinsInfo, every window emits 3 leading booleans: bools[0]=isHidden (compData), bools[1]=isVisible (mapped), bools[2]=isFrameVisible.
            // Keep 1-boolean fallback (bools[0]=isVisible) for compact unit-test fixtures.
            info.BoolCount = bools.Count;
            if (bools.Count >= 3)
            {
                info.IsHidden = bools[0];
                info.Visible = bools[1];
                info.IsFrameVisible = bools[2];
            }
            else if (bools.Count == 2)
            {
                info.IsHidden = bools[0];
                info.Visible = bools[1];
                info.IsFrameVisible = bools[1];
            }
            else if (bools.Count == 1)
            {
                info.Visible = bools[0];
                info.IsHidden = !bools[0];
                info.IsFrameVisible = bools[0];
            }
            return true;
        }

        private static bool EndsWithUnescapedQuote(string s, int contentStart)
        {
            if (string.IsNullOrEmpty(s) || s.Length <= contentStart || s[s.Length - 1] != '"') return false;
            int backslashes = 0;
            for (int i = s.Length - 2; i >= contentStart && s[i] == '\\'; i--)
                backslashes++;
            return (backslashes & 1) == 0;
        }

        private static string UnescapeDbusString(string s)
        {
            if (string.IsNullOrEmpty(s) || s.IndexOf('\\') < 0) return s;
            var sb = new System.Text.StringBuilder(s.Length);
            for (int i = 0; i < s.Length; i++)
            {
                if (s[i] == '\\' && i + 1 < s.Length && (s[i + 1] == '"' || s[i + 1] == '\\'))
                {
                    sb.Append(s[++i]);
                }
                else
                {
                    sb.Append(s[i]);
                }
            }
            return sb.ToString();
        }

        private static bool TrySplitInlineInt32(string line, out string titlePart, out int intVal)
        {
            titlePart = null;
            intVal = 0;
            int idx = line.LastIndexOf("int32 ", StringComparison.Ordinal);
            if (idx <= 0 || !char.IsWhiteSpace(line[idx - 1])) return false;
            if (!int.TryParse(line.Substring(idx + 6).Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out intVal))
                return false;
            titlePart = line.Substring(0, idx).Trim();
            return true;
        }

        internal static int ParseIntReply(string reply)
        {
            if (string.IsNullOrEmpty(reply)) return -1;
            string[] parts = reply.Trim().Split(new[] { ' ', '\t', '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            int val;
            return parts.Length >= 2 && int.TryParse(parts[parts.Length - 1], NumberStyles.Integer, CultureInfo.InvariantCulture, out val) ? val : -1;
        }
    }

    /// <summary>
    /// Phase-locked frame-time smoother for continuous ambient animations.
    /// Absorbs single-frame main-loop callback jitter (e.g. timer/fd latency before an animator
    /// fires on the same vsync) while locking onto the real display refresh rate (50/60 Hz)
    /// and clamping post-stall steps so motion never visibly jumps.
    /// </summary>
    internal sealed class AnimClock
    {
        private readonly double _defaultPeriod;
        private readonly double _maxStep;
        private double _emaPeriod;
        private double _lastMono = -1.0;
        private double _virtualMono = -1.0;
        private bool _periodMeasured;
        private int _shiftCount;
        private int _shiftDir;

        public AnimClock(double defaultPeriod = 1.0 / 60.0, double maxStep = 0.05)
        {
            _defaultPeriod = ClampPeriod(defaultPeriod);
            _maxStep = maxStep > 0.0 ? maxStep : 0.05;
            _emaPeriod = _defaultPeriod;
        }

        public double PeriodEstimate { get { return _emaPeriod; } }

        public void SeedPeriod(double period)
        {
            if (period > 0.0) _emaPeriod = ClampPeriod(period);
        }

        public void Reset()
        {
            _lastMono = -1.0;
            _virtualMono = -1.0;
            _emaPeriod = _defaultPeriod;
            _periodMeasured = false;
            _shiftCount = 0;
            _shiftDir = 0;
        }

        public void Pause()
        {
            _lastMono = -1.0;
            _virtualMono = -1.0;
            _periodMeasured = false;
            _shiftCount = 0;
            _shiftDir = 0;
        }

        public bool TryStep(double nowMono, out double dt, out double rawDt, out bool hasRealDt)
        {
            if (_lastMono < 0.0)
            {
                _lastMono = nowMono;
                _virtualMono = nowMono;
                rawDt = _emaPeriod;
                hasRealDt = false;
                dt = _emaPeriod;
                return true;
            }

            rawDt = nowMono - _lastMono;
            if (rawDt < 0.0)
            {
                rawDt = _emaPeriod;
                hasRealDt = false;
                _lastMono = nowMono;
                _virtualMono = nowMono;
                dt = _emaPeriod;
                return true;
            }

            hasRealDt = true;
            // Filter duplicate queued animator wake-ups within the same display refresh (<45% of period).
            if (_maxStep <= 0.1 && rawDt < _emaPeriod * 0.45)
            {
                dt = 0.0;
                return false;
            }

            _lastMono = nowMono;
            double clamped = rawDt > _maxStep ? _maxStep : rawDt;
            if (clamped < 0.001) clamped = 0.001;

            if (_maxStep <= 0.1 && rawDt <= _maxStep)
            {
                if (!_periodMeasured && rawDt >= 1.0 / 120.0 && rawDt <= 1.0 / 24.0)
                {
                    _emaPeriod = ClampPeriod(rawDt);
                    _periodMeasured = true;
                    _shiftCount = 0;
                    _shiftDir = 0;
                    _virtualMono = nowMono;
                    dt = _emaPeriod;
                    return true;
                }

                double periodDiff = rawDt - _emaPeriod;
                if (rawDt >= 1.0 / 120.0 && rawDt <= 1.0 / 24.0 && Math.Abs(periodDiff) > 0.0022)
                {
                    int dir = periodDiff > 0 ? 1 : -1;
                    _shiftCount = (dir == _shiftDir) ? (_shiftCount + 1) : 1;
                    _shiftDir = dir;
                    if (_shiftCount >= 2)
                    {
                        _emaPeriod = ClampPeriod(_emaPeriod + periodDiff * 0.45);
                        _virtualMono = nowMono;
                        dt = _emaPeriod;
                        return true;
                    }
                }
                else
                {
                    _shiftCount = 0;
                    _shiftDir = 0;
                }

                double predicted = _virtualMono + _emaPeriod;
                double phaseErr = nowMono - predicted;
                if (Math.Abs(phaseErr) <= _emaPeriod * 1.4)
                {
                    double freqErr = phaseErr;
                    if (freqErr > 0.008) freqErr = 0.008;
                    else if (freqErr < -0.008) freqErr = -0.008;
                    _emaPeriod = ClampPeriod(_emaPeriod + freqErr * 0.04);

                    double corr = phaseErr * 0.12;
                    if (corr > 0.002) corr = 0.002;
                    else if (corr < -0.002) corr = -0.002;
                    dt = _emaPeriod + corr;
                    if (dt < 0.004) dt = 0.004;
                    if (dt > _maxStep) dt = _maxStep;
                    _virtualMono += dt;
                    return true;
                }

                _shiftCount = 0;
                _shiftDir = 0;
                _virtualMono = nowMono;
                dt = Math.Min(_emaPeriod * 1.5, clamped);
                return true;
            }

            _shiftCount = 0;
            _shiftDir = 0;
            _virtualMono = nowMono;
            dt = clamped;
            return true;
        }

        public double Step(double nowMono, out double rawDt, out bool hasRealDt)
        {
            double dt;
            if (TryStep(nowMono, out dt, out rawDt, out hasRealDt)) return dt;
            _lastMono = nowMono;
            _virtualMono = nowMono;
            return Math.Max(0.001, Math.Min(_maxStep, rawDt));
        }

        private static double ClampPeriod(double p)
        {
            if (p < 1.0 / 120.0) return 1.0 / 120.0;
            if (p > 1.0 / 24.0) return 1.0 / 24.0;
            return p;
        }
    }

    /// <summary>
    /// Debounces transient QD-OLED AOT <c>screensaver_on_off</c> pulses while the Empty TV backdrop is visible
    /// so periodic 120 s AOT checks do not blink <c>vetro-idle</c>, while confirming sustained screensaver state
    /// within <see cref="ConfirmSeconds"/>.
    /// </summary>
    internal sealed class ScreensaverPulseFilter
    {
        public const double ConfirmSeconds = 5.0;
        private double _since = -1.0;
        private bool _confirmed;

        public bool IsPending { get { return _since >= 0.0 && !_confirmed; } }

        public void Reset()
        {
            _since = -1.0;
            _confirmed = false;
        }

        public bool Update(bool rawActive, bool idleVisible, double now)
        {
            if (!rawActive)
            {
                Reset();
                return false;
            }
            if (!idleVisible)
            {
                if (_since < 0.0) _since = now;
                _confirmed = true;
                return true;
            }
            if (_confirmed) return true;
            if (_since < 0.0)
            {
                _since = now;
                return false;
            }
            if ((now - _since) >= ConfirmSeconds)
            {
                _confirmed = true;
                return true;
            }
            return false;
        }
    }
}
