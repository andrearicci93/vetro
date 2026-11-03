using System;

namespace Launcher.Core
{
    internal static class SystemLaunch
    {
        // Test the real app_launcher's exit code in the detached shell, not the shell-start result.
        public static string Command(string appId, string fallback)
        {
            if (!Catalog.ValidAppId(appId) || (fallback != null && !Catalog.ValidAppId(fallback)))
                throw new ArgumentException("Invalid system app id");
            string command = "/usr/bin/app_launcher -s " + appId;
            if (fallback != null) command += " || /usr/bin/app_launcher -s " + fallback;
            return "( " + command + " ) >/dev/null 2>&1 &";
        }
    }
}
