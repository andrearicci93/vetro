using System;
using System.Text;

namespace Launcher.Core
{
    internal static class SystemLaunch
    {
        // How long a launched app must have been up before it counts as opened (a shell `sleep` argument; tests shorten it).
        public static string SettleSeconds = "2";

        // Test the real app_launcher's exit code in the detached shell, not the shell-start result.
        //
        // With a fallback, a zero exit code is not enough either: Tizen 6.5 firmware (Q80A) ships
        // com.samsung.tv.coba.newhome, and app_launcher starts it and returns 0, but it exits within a few seconds and
        // nothing appears. So after SettleSeconds the app, or one of the windows it opens (shownBy, such as Samsung
        // Home's sidebar and media rows on 2025 firmware), must be running; otherwise the fallback starts. The fallback
        // itself never counts: csfs runs as a background service on both firmwares.
        public static string Command(string appId, string fallback, string[] shownBy = null)
        {
            if (!Catalog.ValidAppId(appId) || (fallback != null && !Catalog.ValidAppId(fallback)) ||
                (shownBy != null && !Array.TrueForAll(shownBy, Catalog.ValidAppId)))
                throw new ArgumentException("Invalid system app id");
            string launch = "/usr/bin/app_launcher -s " + appId;
            if (fallback == null) return "( " + launch + " ) >/dev/null 2>&1 &";
            // `app_launcher -S` lists running apps as "<tab>  <app id> (<pid>)".
            var running = new StringBuilder("/usr/bin/app_launcher -S 2>/dev/null | grep -qF -e ' " + appId + " ('");
            if (shownBy != null)
                foreach (string id in shownBy)
                    if (id != appId && id != fallback) running.Append(" -e ' ").Append(id).Append(" ('");
            string start = "/usr/bin/app_launcher -s " + fallback;
            return "( if " + launch + "; then sleep " + SettleSeconds + "; " + running + " || " + start +
                "; else " + start + "; fi ) >/dev/null 2>&1 &";
        }
    }
}
