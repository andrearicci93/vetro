using System;
using System.Globalization;
using System.Text;

namespace Launcher.Core
{
    // The guard may close several Home windows, but choosing Home must retire every pending kill.
    internal static class HomeGuard
    {
        public static string[] Parse(string value)
        {
            if (value == null) return null;
            string[] ids = value.Split(',');
            return ids.Length > 0 && Array.TrueForAll(ids, Catalog.ValidAppId) ? ids : null;
        }

        public static bool ShouldCancel(string[] ids, string appId)
        {
            return ids != null && appId != null &&
                (Array.IndexOf(ids, appId) >= 0 || appId == "com.samsung.tv.coba.newhome");
        }

        public static string Command(string[] ids, string file, int generation, bool preserveCsfs = false)
        {
            if (ids == null || ids.Length == 0 || !Array.TrueForAll(ids, Catalog.ValidAppId))
                throw new ArgumentException("Invalid Home app ids");
            string quotedFile = "'" + file.Replace("'", "'\"'\"'") + "'";
            string gen = generation.ToString(CultureInfo.InvariantCulture);
            var command = new StringBuilder("(");
            bool hasCsfs = preserveCsfs && (Array.IndexOf(ids, "com.samsung.tv.csfs") >= 0 || Array.IndexOf(ids, "com.samsung.tv.coba.newhome") >= 0);
            foreach (string gap in new[] { "0.15", "0.3", "0.45", "0.7", "1.2" })
            {
                command.Append(" sleep ").Append(gap).Append(';');
                if (preserveCsfs)
                {
                    command.Append(" [ \"$(cat ").Append(quotedFile).Append(")\" = ").Append(gen).Append(" ] || exit 0;");
                    foreach (string id in ids)
                    {
                        if (id == "com.samsung.tv.csfs" || id == "com.samsung.tv.coba.newhome") continue;
                        command.Append(" /usr/bin/app_launcher -k ").Append(id).Append(';');
                    }
                    if (hasCsfs)
                    {
                        command.Append(" case \"$(/usr/bin/vconftool get memory/appfw/current_fullscreen_appid 2>/dev/null)\" in *com.samsung.tv.csfs*|*com.samsung.tv.home.*|*com.samsung.tv.coba.*) /usr/bin/app_launcher -s org.tizen.tv-viewer -u 5001 >/dev/null 2>&1; /usr/bin/vconftool set -f -t string memory/appfw/current_fullscreen_appid org.tizen.tv-viewer >/dev/null 2>&1 ;; esac;");
                    }
                }
                else
                {
                    foreach (string id in ids)
                        command.Append(" [ \"$(cat ").Append(quotedFile).Append(")\" = ").Append(gen)
                            .Append(" ] || exit 0; /usr/bin/app_launcher -k ").Append(id).Append(';');
                }
            }
            return command.Append(" ) >/dev/null 2>&1 &").ToString();
        }
    }

    // --home-launch APPID (custom launcher mode): the Home key opens this app and the dock is never drawn.
    internal static class HomeLaunch
    {
        // The entry the Home key launches, or null when the id is not plain id characters (it goes on a command line).
        public static AppEntry Parse(string appId)
        {
            return Catalog.ValidAppId(appId) ? new AppEntry("custom", appId, appId, null) : null;
        }

        /// <summary>The detached shell command the Home key runs in custom launcher mode (#334, found by a reporter on a Tizen 9 TV).
        /// <c>app_launcher -e</c> starts or resumes the app without Samsung's loader, so the four-dot animation is not drawn on every press
        /// even when the app is already running; the plain <c>-s</c> launch (through the loader) is the fallback when -e fails. Both return
        /// 255 for an app that is not installed. On the 2021 Q80A (Tizen 6.0), -e started a stopped app in about 0.5 s and resumed a running
        /// one in about 50 ms, the same as -s. The id is checked (Catalog.ValidAppId), so it is safe on a command line.</summary>
        public static string Command(string appId)
        {
            if (!Catalog.ValidAppId(appId)) throw new ArgumentException("Invalid Home launch app id");
            return "( /usr/bin/app_launcher -e " + appId + " || /usr/bin/app_launcher -s " + appId + " ) >/dev/null 2>&1 &";
        }
    }
}
