namespace Launcher.Core
{
    /// <summary>
    /// Samsung's picture mode for its Home (avocd "NewHome", picture mode 327705, <c>memory/avoc/home_shown</c> 1). csfs sets it while its Home
    /// is on screen and hands it back (<c>AvocSetNewHome(0)</c>) when another app takes the screen; with Vetro's launcher on Home csfs is closed
    /// or never shown, so the flag stayed on under every app and the video played in Home's mode, motion smoothing off (S95C, 2026-11-20).
    /// The launcher runs this 3 s after it hides (the wait lets csfs take the screen first when the Samsung Home pill was chosen); the service's
    /// supervision carries the same script (app/service/dock.js HOME_PICTURE_SCRIPT, kept equal by app/tests/dock-home-picture.test.cjs).
    /// Tizen 6.0 has neither the key nor the method: there it does nothing.
    /// </summary>
    internal static class HomePicture
    {
        public const string Script = @"h=$(vconftool get memory/avoc/home_shown 2>/dev/null | sed -n ""s/.*value = \(-*[0-9][0-9]*\).*/\1/p""); f=$(vconftool get memory/appfw/current_fullscreen_appid 2>/dev/null | sed -n ""s/.*value = \([^ ]*\).*/\1/p""); [ ""$h"" = 1 ] || exit 0; case ""$f"" in com.samsung.tv.csfs|com.samsung.tv.home.*|com.samsung.tv.coba.*) exit 0;; esac; busctl --timeout=3 call org.tizen.tv.avoc /org/tizen/tv/avoc org.tizen.tv.avoc.AvOutputControl SetNewHome i 0 >/dev/null 2>&1 && echo cleared";

        /// <summary>The command the launcher starts in the background after it hides.</summary>
        public static string Command() { return "(sleep 3; " + Script + ") >/dev/null 2>&1 &"; }
    }
}
