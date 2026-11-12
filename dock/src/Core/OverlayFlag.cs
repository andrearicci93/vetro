using System;
using System.IO;

namespace Launcher.Core
{
    /// <summary>
    /// The launcher's windows tell Vetro TV Tuner that they are on screen with a small file each: the Dock and its Task manager
    /// (<see cref="DockPath"/>) and the osd 123 (<see cref="PadPath"/>). The tuner reads the remote straight from the input device, so it
    /// sees the keys these windows get; while a flag is fresh it leaves them alone and does not wake up on them (tuner/src, Tuner.Core.OverlayFlag).
    /// The file holds this process's pid, so a launcher killed with a window open does not leave the tuner deaf, and it is touched on every
    /// key: the tuner trusts it for the window's idle time plus a margin (Dock 20 s + 5, osd 123 14 s + 6).
    /// </summary>
    internal static class OverlayFlag
    {
        public const string DockPath = "/tmp/vetro-dock.open";
        public const string PadPath = "/tmp/vetro-numpad.open";

        private static readonly string Pid = System.Diagnostics.Process.GetCurrentProcess().Id.ToString(System.Globalization.CultureInfo.InvariantCulture);

        /// <summary>Writes (or touches) the flag, or removes it. Never throws: a flag that cannot be written only costs the tuner's courtesy.</summary>
        public static void Mark(string path, bool on, Action<string> log)
        {
            try
            {
                if (on) File.WriteAllText(path, Pid);
                else if (File.Exists(path)) File.Delete(path);
            }
            catch (Exception ex) { if (log != null) log("flag " + path + ": " + ex.Message); }
        }
    }
}
