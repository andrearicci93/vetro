using System;
using System.Collections.Generic;
using System.Globalization;

namespace Launcher.Core
{
    internal enum IdleMode { Off, Clock, Wallpaper, Clean }

    internal enum IdleAction { None, Show, ShowWithDock, Hide, Dim, TriggerLcdOff, FallbackDim }

    /// <summary>Parsed configuration for the Empty TV screen ("No Live TV" idle backdrop).</summary>
    internal sealed class IdleConfig
    {
        public IdleMode Mode { get; private set; }
        public bool AutoDock { get; private set; }
        /// <summary>0 = dim after 10 min (keep visible); 5/10/15 = trigger Samsung lcdoff Picture Off after N minutes.</summary>
        public int PictureOffMinutes { get; private set; }
        public int NotificationLevel { get; private set; }
        public bool UsesWallpaper { get { return Mode == IdleMode.Wallpaper || Mode == IdleMode.Clean; } }
        public bool ShowsClock { get { return Mode == IdleMode.Clock || Mode == IdleMode.Wallpaper; } }

        public IdleConfig(IdleMode mode, bool autoDock, int pictureOffMinutes, int notificationLevel)
        {
            Mode = mode;
            AutoDock = autoDock;
            PictureOffMinutes = pictureOffMinutes;
            NotificationLevel = notificationLevel;
        }

        public static IdleConfig Parse(string mode, bool autoDock, string potOff, string level)
        {
            IdleMode m = IdleMode.Off;
            if (string.Equals(mode, "clock", StringComparison.OrdinalIgnoreCase)) m = IdleMode.Clock;
            else if (string.Equals(mode, "wallpaper", StringComparison.OrdinalIgnoreCase)) m = IdleMode.Wallpaper;
            else if (string.Equals(mode, "clean", StringComparison.OrdinalIgnoreCase)) m = IdleMode.Clean;

            int po = 0;
            int parsedPo;
            if (int.TryParse(potOff, NumberStyles.Integer, CultureInfo.InvariantCulture, out parsedPo)
                && (parsedPo == 0 || parsedPo == 5 || parsedPo == 10 || parsedPo == 15))
                po = parsedPo;

            int lvl = 10;
            int parsedLvl;
            if (int.TryParse(level, NumberStyles.Integer, CultureInfo.InvariantCulture, out parsedLvl))
                lvl = parsedLvl < 0 ? 0 : (parsedLvl > 40 ? 40 : parsedLvl);

            return new IdleConfig(m, autoDock, po, lvl);
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
        public bool PendingTvSource;
        public bool TvPlusActive;
        public bool ScreensaverActive;
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
        public const double LaunchSuppressSeconds = 2.0;
        public const double WakeGraceSeconds = 1.5;

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
                || title == "Launchscreen Winsys";
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

        public static bool ShouldForwardGrabbedBack(string partialAppId, string fullscreenAppId, Func<bool> isScreensaverActive)
        {
            return !string.IsNullOrEmpty(partialAppId)
                || (!string.IsNullOrEmpty(fullscreenAppId) && fullscreenAppId != TvViewerAppId && !IsGuardedSamsungHome(fullscreenAppId))
                || (isScreensaverActive != null && isScreensaverActive());
        }

        private static readonly int[] Bayer4x4 =
        {
            0,  8,  2, 10,
            12, 4, 14,  6,
            3, 11,  1,  9,
            15, 7, 13,  5
        };

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
        private double _wakeGraceUntil;

        public IdleBackdropModel(IdleConfig cfg)
        {
            _cfg = cfg ?? new IdleConfig(IdleMode.Off, false, 0, 10);
        }

        public bool Visible { get; private set; }
        public bool Dimmed { get { return _dimmed; } }
        public double WakeSuppressUntil { get; private set; }
        public bool WakeRestackPending { get; private set; }
        public bool IsEmptyTvContext { get { return _cfg.Mode != IdleMode.Off && Visible && _lastKnownSource <= 0; } }
        public string GuardedHomeDyingAppId { get { return _guardedHomeDyingAppId; } }
        public string TeardownHoldAppId { get { return _teardownHoldAppId; } }

        public bool CanClaimBackKey(bool idleWindowShown, bool dockActive, string partialAppId, bool padOpen, bool homeLaunch)
        {
            return _cfg.Mode != IdleMode.Off
                && Visible
                && idleWindowShown
                && !dockActive
                && string.IsNullOrEmpty(partialAppId)
                && !padOpen
                && !homeLaunch;
        }

        public bool OnWake(double now)
        {
            _idleSince = now;
            _dimmed = false;
            _lcdOffSent = false;
            WakeSuppressUntil = now + WakeSuppressSeconds;
            _wakeGraceUntil = now + WakeGraceSeconds;
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
            _cfg = cfg ?? new IdleConfig(IdleMode.Off, false, 0, 10);
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
            _wakeGraceUntil = 0;
            WakeRestackPending = false;
            if (_cfg.Mode == IdleMode.Off) Visible = false;
        }

        /// <summary>
        /// Returns true when an unrequested Samsung Home window (e.g. after force-closing an app via long-press Back)
        /// should be dismissed so the TV returns to Vetro's Empty TV screen instead of Smart Hub.
        /// Rate-limited with exponential backoff to avoid spin loops on stubborn firmware.
        /// </summary>
        public bool ShouldDismissGuardedHome(TvSnapshot snap, double now)
        {
            if (_cfg.Mode == IdleMode.Off || snap.DisplayState >= DisplayStateOff || snap.SamsungHomeRequested)
            {
                _dismissHomeAttempts = 0;
                _nextDismissHomeAt = 0;
                return false;
            }

            bool guardedNow = (IsGuardedSamsungHome(snap.FullscreenAppId) || IsGuardedSamsungHome(snap.PartialAppId))
                && snap.SourceType <= 0
                && _lastKnownSource <= 0;
            if (!guardedNow)
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

        public void OnLaunchApp(double now)
        {
            _wasOtherApp = true;
            _guardedHomeHoldUntil = 0;
            _guardedHomeDyingAppId = "";
            _teardownHoldUntil = 0;
            _teardownHoldAppId = "";
            _launchSuppressUntil = now + LaunchSuppressSeconds;
            _wakeGraceUntil = 0;
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
                if (!Visible) return IdleAction.None;
                Visible = false;
                return IdleAction.Hide;
            }

            if (snap.DisplayState >= DisplayStateOff)
            {
                _lastDisplayState = snap.DisplayState;
                return IdleAction.None;
            }
            if (_lastDisplayState >= DisplayStateOff)
            {
                WakeRestackPending = OnWake(now);
            }
            _lastDisplayState = snap.DisplayState;

            if (snap.SourceType >= 0) _lastKnownSource = snap.SourceType;
            if (snap.SourceType > 0) _launchSuppressUntil = 0;

            bool guardedHome = !snap.SamsungHomeRequested
                && IsGuardedSamsungHome(snap.FullscreenAppId)
                && snap.SourceType <= 0
                && _lastKnownSource <= 0;
            if (guardedHome)
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
            else if ((snap.FullscreenAppId == TvViewerAppId && snap.SourceType == 0)
                || snap.SamsungHomeRequested
                || snap.SourceType > 0)
            {
                _guardedHomeHoldUntil = 0;
                _guardedHomeDyingAppId = "";
                if (snap.FullscreenAppId == TvViewerAppId && snap.SourceType == 0) _lastNonIdleAppId = "";
            }

            if (snap.SamsungHomeRequested
                || snap.SourceType > 0
                || snap.ScreensaverActive
                || snap.TunerActive
                || now >= _teardownHoldUntil
                || (!string.IsNullOrEmpty(snap.FullscreenAppId)
                    && snap.FullscreenAppId != TvViewerAppId
                    && !IsGuardedSamsungHome(snap.FullscreenAppId)
                    && snap.FullscreenAppId != _teardownHoldAppId))
            {
                _teardownHoldUntil = 0;
                _teardownHoldAppId = "";
            }

            bool guardedHomeHold = Visible
                && !snap.SamsungHomeRequested
                && !snap.ScreensaverActive
                && !snap.TunerActive
                && _lastKnownSource <= 0
                && ((snap.SourceType < 0
                        && now < _guardedHomeHoldUntil
                        && !string.IsNullOrEmpty(_guardedHomeDyingAppId)
                        && snap.FullscreenAppId == _guardedHomeDyingAppId)
                    || (snap.SourceType <= 0
                        && now < _teardownHoldUntil
                        && !string.IsNullOrEmpty(_teardownHoldAppId)
                        && snap.FullscreenAppId == _teardownHoldAppId));
            bool guardedPartial = !snap.SamsungHomeRequested
                && IsGuardedSamsungHome(snap.PartialAppId);

            bool wakeEmptyHold = Visible
                && now < _wakeGraceUntil
                && snap.SourceType <= 0
                && !snap.TvPlusActive
                && string.IsNullOrEmpty(snap.FullscreenAppId);

            bool onEmptyTv = (snap.FullscreenAppId == TvViewerAppId
                && !snap.TvPlusActive
                && (snap.SourceType == 0 || (snap.SourceType < 0 && (Visible || _lastKnownSource == 0 || snap.PendingTvSource))))
                || wakeEmptyHold
                || guardedHome
                || guardedHomeHold;
            if (!onEmptyTv)
            {
                _wasOtherApp = true;
                if (!string.IsNullOrEmpty(snap.FullscreenAppId)
                    && snap.FullscreenAppId != TvViewerAppId
                    && !IsGuardedSamsungHome(snap.FullscreenAppId))
                {
                    _lastNonIdleAppId = snap.FullscreenAppId;
                }
            }

            bool allowed = onEmptyTv
                && (snap.WmStackActive || string.IsNullOrEmpty(snap.PartialAppId) || guardedPartial)
                && !snap.TunerActive
                && !snap.ScreensaverActive;

            if (!allowed)
            {
                if (!Visible) return IdleAction.None;
                Visible = false;
                _dimmed = false;
                _lcdOffSent = false;
                return IdleAction.Hide;
            }

            if (!Visible)
            {
                if (now < _launchSuppressUntil && !guardedHome) return IdleAction.None;
                Visible = true;
                _idleSince = now;
                _dimmed = false;
                _lcdOffSent = false;
                bool openDock = _cfg.AutoDock && _wasOtherApp && !dockActive && !padOpen && !pillOpen;
                _wasOtherApp = false;
                return openDock ? IdleAction.ShowWithDock : IdleAction.Show;
            }

            if (dockActive || padOpen || pillOpen)
            {
                _idleSince = now;
                if (_dimmed) { _dimmed = false; }
                _lcdOffSent = false;
                return IdleAction.None;
            }

            if (_cfg.PictureOffMinutes > 0)
            {
                if (!_lcdOffSent && now - _idleSince >= _cfg.PictureOffMinutes * 60.0)
                {
                    _lcdOffSent = true;
                    _dimmed = true;
                    return IdleAction.TriggerLcdOff;
                }
                return IdleAction.None;
            }

            if (!_dimmed && now - _idleSince >= DimAfterSeconds)
            {
                _dimmed = true;
                return IdleAction.Dim;
            }
            return IdleAction.None;
        }

        /// <summary>
        /// Builds a Samsung-style dark midnight-slate gradient (#070B14 to #1D2E4D) with a 4x4 Bayer dither
        /// using strictly 32-bit integer math for smooth OLED rendering without color banding.
        /// </summary>
        public static uint[] BuildWallpaperPixels(int w, int h)
        {
            var px = new uint[w * h];
            int cx = w / 2;
            int cy = (h * 36) / 100;
            int rx = w > 2 ? w / 2 : 1;
            int ry = (h * 65) / 100;
            if (ry < 1) ry = 1;

            for (int y = 0; y < h; y++)
            {
                int dy = y - cy;
                int ny = (dy * 256) / ry;
                int nySq = ny * ny;
                int vert = (256 * (h - y)) / h;
                int yRow = (y & 3) << 2;
                int rowOffset = y * w;

                for (int x = 0; x < w; x++)
                {
                    int dx = x - cx;
                    int nx = (dx * 256) / rx;
                    int inv = 65536 - (nx * nx + nySq);
                    int radial = 0;
                    if (inv > 0)
                    {
                        int t = inv / 256;
                        radial = (t * t) / 256;
                    }
                    int mix = (radial * 205 + vert * 51) / 256;
                    int dither = Bayer4x4[yRow | (x & 3)];

                    int r = (112 + (mix * 352) / 256 + dither) / 16;
                    int g = (176 + (mix * 560) / 256 + dither) / 16;
                    int b = (320 + (mix * 912) / 256 + dither) / 16;
                    if (r > 255) r = 255;
                    if (g > 255) g = 255;
                    if (b > 255) b = 255;

                    px[rowOffset + x] = 0xFF000000u | ((uint)r << 16) | ((uint)g << 8) | (uint)b;
                }
            }
            return px;
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
            if (fileExists(TunerChannelsFlag))
            {
                string ch = (readText(TunerChannelsFlag) ?? "").Trim();
                if (ch == "0") return false;
            }
            if (!fileExists(TunerTvFlag) && !fileExists(TunerShownFlag)) return false;
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
        public static string BuildGuardedHomeRestoreCommand(string fullApp, string dyingApp, Func<string, bool> validAppId, string genCheck, bool includeDyingApp)
        {
            if (!IsGuardedSamsungHome(fullApp)) return "";
            string patterns = "*com.samsung.tv.csfs*|*com.samsung.tv.home.*|*com.samsung.tv.coba.*";
            if (includeDyingApp
                && !string.IsNullOrEmpty(dyingApp)
                && dyingApp != TvViewerAppId
                && !IsGuardedSamsungHome(dyingApp)
                && (validAppId == null || validAppId(dyingApp)))
            {
                patterns += "|*" + dyingApp + "*";
            }
            return (genCheck ?? "")
                + "case \"$(/usr/bin/vconftool get memory/appfw/current_fullscreen_appid 2>/dev/null)\" in "
                + patterns
                + ") /usr/bin/app_launcher -s " + TvViewerAppId + " >/dev/null 2>&1 ;; esac";
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
                + "/usr/bin/app_launcher -s " + TvViewerAppId + " >/dev/null 2>&1 ;; esac; "
                + "echo KILLED; fi";
        }
    }

    internal static class WmStackLogic
    {
        public const int LayerNormal = 200;
        public const int LayerShield = 250;

        public static void Step(
            Func<string, string> shellRead,
            bool allowSamsungHome,
            bool guardedHomeActive,
            bool partialActive,
            bool shieldTime,
            ref bool active,
            ref bool probed,
            ref uint idleWinId,
            Action<string> log)
        {
            if (shellRead == null) return;
            string raw = shellRead("dbus-send --system --dest=org.enlightenment.wm --print-reply=literal /org/enlightenment/wm org.enlightenment.wm.Test.GetWinsInfo 2>/dev/null");
            if (string.IsNullOrEmpty(raw))
            {
                if (!probed) { probed = true; if (log != null) log("wm stack: GetWinsInfo unavailable, using PartialAppId hide fallback"); }
                return;
            }

            uint idleWin = 0, tvViewerWin = 0, tvGraphicsWin = 0, tvVideoSinkWin = 0, homeWin = 0, bottomOverlayWin = 0;
            int idleIndex = -1, tvViewerIndex = -1, tvGraphicsIndex = -1, tvVideoSinkIndex = -1, homeIndex = int.MaxValue, bottomOverlayIndex = -1;
            int idx = 0;
            string[] structs = raw.Split(new[] { "struct {" }, StringSplitOptions.RemoveEmptyEntries);
            foreach (string block in structs)
            {
                uint winId;
                string title;
                if (!TryParseWin(block, out winId, out title)) continue;
                if (title == "vetro-idle") { idleWin = winId; idleIndex = idx; }
                else if (title == "tv-viewer") { tvViewerWin = winId; tvViewerIndex = idx; }
                else if (title == "tv-viewer-graphics") { tvGraphicsWin = winId; tvGraphicsIndex = idx; }
                else if (title == "tvvideosink-area") { tvVideoSinkWin = winId; tvVideoSinkIndex = idx; }
                else if (title == "tvlauncher" || title == "vetro-numpad" || title == "vetro-volume")
                {
                    if (idx > bottomOverlayIndex) { bottomOverlayWin = winId; bottomOverlayIndex = idx; }
                }
                else if (IdleBackdropModel.IsGuardedSamsungHomeWindow(title) && idx < homeIndex)
                {
                    homeWin = winId;
                    homeIndex = idx;
                }
                idx++;
            }

            if (idleWin == 0) return;
            idleWinId = idleWin;

            bool wantShield = !allowSamsungHome && (!partialActive || guardedHomeActive || shieldTime);
            int targetLayer = wantShield ? LayerShield : LayerNormal;

            string lvlReply = shellRead("dbus-send --system --dest=org.enlightenment.wm --print-reply=literal /org/enlightenment/wm org.enlightenment.wm.Test.GetWindowNotiLevel uint32:" + idleWin.ToString(CultureInfo.InvariantCulture) + " 2>/dev/null");
            int curLayer = ParseIntReply(lvlReply);
            bool layerChanged = curLayer != targetLayer;
            if (layerChanged)
            {
                shellRead("dbus-send --system --dest=org.enlightenment.wm --print-reply=literal /org/enlightenment/wm org.enlightenment.wm.Test.SetWindowNotiLevel uint32:" + idleWin.ToString(CultureInfo.InvariantCulture) + " int32:" + targetLayer + " 2>/dev/null");
                lvlReply = shellRead("dbus-send --system --dest=org.enlightenment.wm --print-reply=literal /org/enlightenment/wm org.enlightenment.wm.Test.GetWindowNotiLevel uint32:" + idleWin.ToString(CultureInfo.InvariantCulture) + " 2>/dev/null");
                curLayer = ParseIntReply(lvlReply);
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
                if (curLayer == LayerShield)
                {
                    // Keep vetro-idle strictly below tvlauncher/vetro-numpad/vetro-volume on layer 250.
                    if (bottomOverlayWin != 0 && (layerChanged || idleIndex < bottomOverlayIndex))
                    {
                        shellRead("dbus-send --system --dest=org.enlightenment.wm --print-reply=literal /org/enlightenment/wm org.enlightenment.wm.Test.SetWindowStack uint32:" + idleWin.ToString(CultureInfo.InvariantCulture) + " uint32:" + bottomOverlayWin.ToString(CultureInfo.InvariantCulture) + " int32:0 2>/dev/null");
                    }
                }
                else
                {
                    uint topTv = 0;
                    int topTvIndex = int.MaxValue;
                    if (tvGraphicsWin != 0 && tvGraphicsIndex < topTvIndex) { topTv = tvGraphicsWin; topTvIndex = tvGraphicsIndex; }
                    if (tvViewerWin != 0 && tvViewerIndex < topTvIndex) { topTv = tvViewerWin; topTvIndex = tvViewerIndex; }
                    if (tvVideoSinkWin != 0 && tvVideoSinkIndex < topTvIndex) { topTv = tvVideoSinkWin; topTvIndex = tvVideoSinkIndex; }
                    if (!allowSamsungHome && homeWin != 0 && homeIndex < topTvIndex) { topTv = homeWin; topTvIndex = homeIndex; }
                    if (topTv != 0 && (layerChanged || idleIndex > topTvIndex))
                    {
                        shellRead("dbus-send --system --dest=org.enlightenment.wm --print-reply=literal /org/enlightenment/wm org.enlightenment.wm.Test.SetWindowStack uint32:" + idleWin.ToString(CultureInfo.InvariantCulture) + " uint32:" + topTv.ToString(CultureInfo.InvariantCulture) + " int32:1 2>/dev/null");
                    }
                }
            }
            else if (!probed)
            {
                probed = true;
                if (log != null) log("wm stack: C1 refused (layer=" + curLayer + "), using fallback");
            }
        }

        private static bool TryParseWin(string block, out uint winId, out string title)
        {
            winId = 0;
            title = null;
            string[] lines = block.Split('\n');
            foreach (string rawLine in lines)
            {
                string line = rawLine.Trim();
                if (winId == 0 && line.StartsWith("uint32 ", StringComparison.Ordinal))
                {
                    uint.TryParse(line.Substring(7).Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out winId);
                }
                else if (winId != 0 && title == null && line.Length > 0
                    && !line.StartsWith("int32 ", StringComparison.Ordinal)
                    && !line.StartsWith("boolean ", StringComparison.Ordinal)
                    && !line.StartsWith("}", StringComparison.Ordinal))
                {
                    int cut = line.IndexOf("         ", StringComparison.Ordinal);
                    title = (cut >= 0 ? line.Substring(0, cut) : line).Trim();
                    return true;
                }
            }
            return false;
        }

        private static int ParseIntReply(string reply)
        {
            if (string.IsNullOrEmpty(reply)) return -1;
            string[] parts = reply.Trim().Split(new[] { ' ', '\t', '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            int val;
            return parts.Length >= 2 && int.TryParse(parts[parts.Length - 1], NumberStyles.Integer, CultureInfo.InvariantCulture, out val) ? val : -1;
        }
    }
}
