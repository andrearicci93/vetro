using System;
using System.IO;

namespace Tuner.Core
{
    /// <summary>
    /// The launcher's windows say they are on screen with a small file each (written by dock/src, Launcher.Core.OverlayFlag): the Dock and
    /// its Task manager (<see cref="DockPath"/>) and the osd 123 (<see cref="PadPath"/>). While one is fresh the remote's keys are the
    /// launcher's: the tuner, which reads them straight from the input device, leaves them alone and does not wake up on them.
    /// The file holds the launcher's pid and is touched on every key. It counts while it is younger than the window's own idle time
    /// plus a margin and while that pid is alive, so a launcher that was killed with a window open cannot leave the tuner deaf.
    /// </summary>
    internal static class OverlayFlag
    {
        public const string DockPath = "/tmp/vetro-dock.open";
        public const string PadPath = "/tmp/vetro-numpad.open";
        public const double DockSeconds = 25;   // the Dock hides itself 20 s after the last key
        public const double PadSeconds = 20;    // the osd 123 closes itself 14 s after the last key

        /// <summary>Whether the flag at <paramref name="path"/> says its window is on screen now.</summary>
        public static bool Fresh(string path, double maxAgeSeconds)
        {
            try
            {
                if (!File.Exists(path)) return false;
                // Liveness through /proc where there is one (the TV); elsewhere (the preview on a Mac) the flag is judged by its age alone.
                Func<int, bool> alive = Directory.Exists("/proc/self") ? (Func<int, bool>)(pid => Directory.Exists("/proc/" + pid)) : null;
                return Judge(File.ReadAllText(path), File.GetLastWriteTimeUtc(path), DateTime.UtcNow, maxAgeSeconds, alive);
            }
            catch (Exception) { return false; }
        }

        /// <summary>
        /// Pure part of <see cref="Fresh"/>: young enough, and its writer alive when it names one. A file without a pid (written by an older
        /// launcher, which wrote "1") is judged by its age alone.
        /// </summary>
        public static bool Judge(string content, DateTime writtenUtc, DateTime nowUtc, double maxAgeSeconds, Func<int, bool> alive)
        {
            double age = (nowUtc - writtenUtc).TotalSeconds;
            if (age > maxAgeSeconds) return false;
            int pid;
            if (int.TryParse((content ?? "").Trim(), out pid) && pid > 1 && alive != null && !alive(pid)) return false;
            return true;
        }
    }
}
