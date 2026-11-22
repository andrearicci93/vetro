using System;
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

        public static bool IsGuardedSamsungHome(string appId)
        {
            if (string.IsNullOrEmpty(appId)) return false;
            return appId == "com.samsung.tv.csfs"
                || appId == "com.samsung.tv.coba.newhome"
                || appId.StartsWith("com.samsung.tv.home.", StringComparison.Ordinal)
                || appId.StartsWith("com.samsung.tv.coba.", StringComparison.Ordinal);
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

        public IdleBackdropModel(IdleConfig cfg)
        {
            _cfg = cfg ?? new IdleConfig(IdleMode.Off, false, 0, 10);
        }

        public bool Visible { get; private set; }
        public bool Dimmed { get { return _dimmed; } }
        public double WakeSuppressUntil { get; private set; }

        /// <summary>Updates Empty TV screen settings live without hiding an active backdrop.</summary>
        public void Reconfigure(IdleConfig cfg, double now)
        {
            _cfg = cfg ?? new IdleConfig(IdleMode.Off, false, 0, 10);
            _idleSince = now;
            _dimmed = false;
            _lcdOffSent = false;
            if (_cfg.Mode == IdleMode.Off) Visible = false;
        }

        public void OnLaunchApp(double now)
        {
            _wasOtherApp = true;
        }

        /// <summary>
        /// Filters raw evdev key presses: suppresses the wake key while the panel is in lcdoff, and resets
        /// the idle dim/Picture-Off timer without ever hiding the backdrop.
        /// </summary>
        public bool OnRawKey(int code, int homeCode, double now, bool displayOff, bool dockActive, out bool hideBackdrop)
        {
            hideBackdrop = false;
            if (displayOff)
            {
                WakeSuppressUntil = now + WakeSuppressSeconds;
                return true;
            }
            if (now < WakeSuppressUntil) return true;

            _idleSince = now;
            _dimmed = false;
            _lcdOffSent = false;
            return false;
        }

        public IdleAction OnLcdOffVerify(int displayState)
        {
            if (displayState == DisplayStateOff) return IdleAction.None;
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

            if (snap.DisplayState == DisplayStateOff)
            {
                _lastDisplayState = DisplayStateOff;
                return IdleAction.None;
            }
            if (_lastDisplayState == DisplayStateOff)
            {
                _idleSince = now;
                _dimmed = false;
                _lcdOffSent = false;
                WakeSuppressUntil = now + WakeSuppressSeconds;
            }
            _lastDisplayState = snap.DisplayState;

            if (snap.SourceType >= 0) _lastKnownSource = snap.SourceType;

            bool guardedHome = !snap.SamsungHomeRequested
                && IsGuardedSamsungHome(snap.FullscreenAppId)
                && snap.SourceType <= 0
                && _lastKnownSource <= 0;
            bool guardedPartial = !snap.SamsungHomeRequested
                && IsGuardedSamsungHome(snap.PartialAppId);

            bool onEmptyTv = (snap.FullscreenAppId == TvViewerAppId
                && !snap.TvPlusActive
                && (snap.SourceType == 0 || (snap.SourceType < 0 && (Visible || _lastKnownSource == 0 || snap.PendingTvSource))))
                || guardedHome;
            if (!onEmptyTv) _wasOtherApp = true;

            bool allowed = onEmptyTv
                && (snap.WmStackActive || string.IsNullOrEmpty(snap.PartialAppId) || guardedPartial)
                && !snap.TunerActive;

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
    }
}
