using System;

namespace Launcher.Core
{
    internal static class SystemLaunch
    {
        public const string HomeApp = "com.samsung.tv.csfs";
        // On 2022 firmware (and the 2025 update of 2023 TVs) this is a package of Home components whose app has no entry point:
        // launching it starts and dies at once, so nothing showed (#170, #175, #210). Samsung's Home is always csfs.
        private const string ComponentHome = "com.samsung.tv.coba.newhome";

        // Test the real app_launcher's exit code in the detached shell, not the shell-start result.
        public static string Command(string appId, string fallback, string rootAppTool = "/usr/bin/get_root_app", string firstScreenDone = "/tmp/firstscreen_done")
        {
            if (!Catalog.ValidAppId(appId) || (fallback != null && !Catalog.ValidAppId(fallback)))
                throw new ArgumentException("Invalid system app id");
            // A list written by an older Vetro can still name the component package, with csfs as its fallback.
            if (appId == ComponentHome && (fallback == null || fallback == HomeApp)) { appId = HomeApp; fallback = null; }
            if (appId == HomeApp && fallback == null) return "( " + HomeShell(rootAppTool, firstScreenDone) + " ) >/dev/null 2>&1 &";
            string command = "/usr/bin/app_launcher -s " + appId;
            if (fallback != null) command += " || /usr/bin/app_launcher -s " + fallback;
            return "( " + command + " ) >/dev/null 2>&1 &";
        }

        /// <summary>
        /// Samsung Home as Samsung's own Home key asks for it. Firmware that boots through a "root app" (2022 and later: it has
        /// get_root_app) gets the bundle of libapp-context-manager's LaunchHomeApp: entry_point smarthub_key with __NO_RAISE_WINDOW and
        /// __K_EX_FORCE_BOOST, which makes csfs show its Home whatever it was doing (without them a fresh csfs can take the call for a cold
        /// boot and, with Autorun Smart Hub off, show nothing), plus the two splash keys Tizen 9 adds while the first screen is not done.
        /// A refusal falls back to the plain launch, which is all the 2021 firmware gets (there __NO_RAISE_WINDOW keeps Home as it was).
        /// Read from the 6.5 and 9 firmware on 2026-11-19; the plain launch is the one tried on a Q80A.
        /// </summary>
        public static string HomeShell(string rootAppTool, string firstScreenDone)
        {
            string plain = "/usr/bin/app_launcher -s " + HomeApp;
            return "if [ -e " + rootAppTool + " ]; then X='entry_point smarthub_key __NO_RAISE_WINDOW enable __K_EX_FORCE_BOOST enable'; "
                + "[ -e " + firstScreenDone + " ] || X=\"$X __K_SPLASH_SCREEN LA_UI_DEFAULT __K_EX_SPLASH_SCREEN_FORCE_SHOW enable\"; "
                + plain + " $X || " + plain + "; else " + plain + "; fi";
        }
    }
}
