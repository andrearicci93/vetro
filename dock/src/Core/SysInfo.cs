using System;
using System.IO;

namespace Launcher.Core
{
    internal static class SysInfo
    {
        public static int ParseMemAvailableKb(string meminfo)
        {
            if (string.IsNullOrEmpty(meminfo)) return -1;
            int free = -1, buffers = 0, cached = 0;
            string[] lines = meminfo.Split('\n');
            for (int i = 0; i < lines.Length; i++)
            {
                string line = lines[i].Trim();
                if (line.StartsWith("MemAvailable:", StringComparison.OrdinalIgnoreCase))
                {
                    int kb = ParseKb(line);
                    if (kb >= 0) return kb;
                }
                else if (line.StartsWith("MemFree:", StringComparison.OrdinalIgnoreCase)) free = ParseKb(line);
                else if (line.StartsWith("Buffers:", StringComparison.OrdinalIgnoreCase)) buffers = Math.Max(0, ParseKb(line));
                else if (line.StartsWith("Cached:", StringComparison.OrdinalIgnoreCase)) cached = Math.Max(0, ParseKb(line));
            }
            if (free >= 0) return free + buffers + cached;
            return -1;
        }

        private static int ParseKb(string line)
        {
            int colon = line.IndexOf(':');
            if (colon < 0) return -1;
            string s = line.Substring(colon + 1).Trim();
            int sp = s.IndexOf(' ');
            if (sp >= 0) s = s.Substring(0, sp).Trim();
            int v;
            return int.TryParse(s, out v) ? v : -1;
        }

        public static string FormatClockAndMem(string clock, int memMb)
        {
            if (string.IsNullOrEmpty(clock)) clock = "";
            if (memMb <= 0) return clock;
            return clock + "  \u00b7  RAM " + memMb + " MB";
        }

        public static int GetAvailableMemMb()
        {
            try
            {
                if (File.Exists("/proc/meminfo"))
                {
                    int kb = ParseMemAvailableKb(File.ReadAllText("/proc/meminfo"));
                    if (kb > 0) return kb / 1024;
                }
            }
            catch { }
            return -1;
        }
    }
}
