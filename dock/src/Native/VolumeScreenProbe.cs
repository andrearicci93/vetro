using System;
using System.Diagnostics;
using Launcher.Core;

namespace Launcher.Native
{
    internal static class VolumeScreenProbe
    {
        private static int _started;
        /// <summary>The offset found by Start(), 0 until it is known (or when there is none, as on every TV).</summary>
        public static volatile int Offset;

        /// <summary>Runs the probe once, beside the launcher's loop: enlightenment_info is a process start (up to 500 ms), and the default
        /// Left edge would otherwise make every TV wait for it at the first Vol press. The bar is moved once the answer is in (VolumePill.Show).</summary>
        public static void Start(VolumeEdge edge, int screenW, Action<string> log)
        {
            if (edge != VolumeEdge.Left && edge != VolumeEdge.Right) return;
            if (System.Threading.Interlocked.Exchange(ref _started, 1) == 1) return;
            var t = new System.Threading.Thread(() => { Offset = HorizontalOffset(edge, screenW, log); }) { IsBackground = true, Name = "volume-screen" };
            t.Start();
        }

        public static int HorizontalOffset(VolumeEdge edge, int screenW, Action<string> log)
        {
            if (edge != VolumeEdge.Left && edge != VolumeEdge.Right) return 0;
            try
            {
                using (var process = Process.Start(new ProcessStartInfo("/usr/bin/enlightenment_info", "-prop -name tvlauncher")
                {
                    UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true,
                    CreateNoWindow = true
                }))
                {
                    var output = process.StandardOutput.ReadToEndAsync();
                    var error = process.StandardError.ReadToEndAsync();
                    if (!process.WaitForExit(500)) { process.Kill(); log("volume: screen probe timed out"); return 0; }
                    if (process.ExitCode != 0 || !output.Wait(100)) return 0;
                    int offset = VolumeScreen.HorizontalOffset(edge, screenW, output.Result);
                    log("volume: screen edge offset " + offset);
                    return offset;
                }
            }
            catch (Exception ex) { log("volume: screen probe unavailable: " + ex.Message); return 0; }
        }
    }
}
