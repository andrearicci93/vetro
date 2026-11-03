using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Launcher.Core
{
    /// <summary>
    /// Constructs the multi-target shell command to close Samsung Smart Hub components
    /// (csfs, HomeSidebar, HomeMedia) when the Home key is pressed, while preserving QuickLaunch.
    /// Spawns a background subshell that repeats kills across staggered sleep intervals.
    /// </summary>
    internal static class HomeGuard
    {
        public const double GuardFirst = 0.15;
        public static readonly double[] GuardGaps = { 0.3, 0.45, 0.7, 1.2 };

        public const string CsfsAppId = "com.samsung.tv.csfs";
        public const string SidebarAppId = "com.samsung.tv.home.sidebar";
        public const string MediaAppId = "com.samsung.tv.home.media";

        public static string BuildCommand(string primaryAppId)
        {
            var apps = new List<string>(4);
            if (!string.IsNullOrEmpty(primaryAppId)) apps.Add(primaryAppId);
            if (!apps.Contains(SidebarAppId)) apps.Add(SidebarAppId);
            if (!apps.Contains(CsfsAppId)) apps.Add(CsfsAppId);
            if (!apps.Contains(MediaAppId)) apps.Add(MediaAppId);

            var killChain = new StringBuilder();
            for (int i = 0; i < apps.Count; i++)
            {
                if (i > 0) killChain.Append("; ");
                killChain.Append("/usr/bin/app_launcher -k ").Append(apps[i]);
            }
            string kill = killChain.ToString();

            var sb = new StringBuilder("( sleep ");
            sb.Append(GuardFirst.ToString("0.0##", CultureInfo.InvariantCulture));
            sb.Append("; ").Append(kill);

            for (int i = 0; i < GuardGaps.Length; i++)
            {
                sb.Append("; sleep ").Append(GuardGaps[i].ToString("0.0##", CultureInfo.InvariantCulture))
                  .Append("; ").Append(kill);
            }

            sb.Append(" ) >/dev/null 2>&1 &");
            return sb.ToString();
        }
    }
}
