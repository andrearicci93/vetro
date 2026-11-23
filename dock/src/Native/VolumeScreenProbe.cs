using System;
using System.Diagnostics;
using Launcher.Core;

namespace Launcher.Native
{
    internal static class VolumeScreenProbe
    {
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
