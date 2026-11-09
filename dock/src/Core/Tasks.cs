using System;
using System.Collections.Generic;
using System.Globalization;

namespace Launcher.Core
{
    internal enum TaskSort { Memory, Cpu, Name }

    /// <summary>One running user app as the task manager shows it.</summary>
    internal sealed class RunningApp
    {
        public string AppId;
        public int Pid;
        public string Label;
        public string IconPath;
        /// <summary>Private resident memory plus swap of the app and all its child processes (web renderers), in KiB; -1 until measured.</summary>
        public long MemoryKb = -1;
        /// <summary>CPU use of the app's process tree since the previous sample, in percent of one core; -1 until measured.</summary>
        public double CpuPercent = -1;
        /// <summary>True from the moment the user asked to close it until it leaves the list.</summary>
        public bool Closing;
    }

    /// <summary>What pkginfo says about an app (the fields the task manager needs).</summary>
    internal sealed class AppInfo
    {
        public string Component, Label, Icon, Package;
        public bool NoDisplay;
    }

    /// <summary>One line of /proc/[pid]/stat, cut down to what the tree sums need.</summary>
    internal struct ProcSample
    {
        public int Pid, PPid;
        public long Ticks;      // utime + stime
        public long MemoryKb;   // private resident + swap
    }

    /// <summary>
    /// Pure logic of the task manager: parsing the platform tools' output, deciding which running apps the
    /// user would call "apps", adding up process trees and sorting. No I/O, so it is tested on a desktop.
    /// </summary>
    internal static class Tasks
    {
        /// <summary>
        /// UI apps that are part of the TV itself: closing them breaks the picture, the menus or Vetro.
        /// Samsung's Home (csfs) is listed on purpose: it is large and comes back on the next Home press.
        /// </summary>
        private static readonly HashSet<string> Protected = new HashSet<string>(StringComparer.Ordinal)
        {
            "org.tizen.tv-viewer", "org.tizen.menu", "org.tizen.function-osd", "com.samsung.tv.sboard-app",
            "org.tizen.welcome-mode", "org.tizen.hbbtv", "org.tizen.ScreenMirroring-app-tv", "com.samsung.hitcomp",
            "org.tizen.volume", "org.tizen.screen-saver", "com.samsung.tv.notification",
        };

        /// <summary>
        /// Background helpers that Samsung registers as visible UI apps (component uiapp, Nodisplay 0) although they
        /// never draw anything the user opened: backup and restore (Label "bnr-service") and the Home preview
        /// updater (Label "IotPreviewd"). Seen running on a QN85A, Tizen 6.
        /// </summary>
        private static readonly HashSet<string> Background = new HashSet<string>(StringComparer.Ordinal)
        {
            "capi-bnr-tv", "com.samsung.tv.preview-updater",
        };

        private static readonly Dictionary<string, string> FriendlyNames = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            { "com.samsung.tv.csfs", "Samsung Home" },
            { "com.samsung.tv.store", "Apps" },
            { "com.samsung.tv.cobalt-yt", "YouTube" },
        };

        /// <summary>
        /// Parses `app_launcher -S`: a header line, then one "appId (pid)" per line, indented with tabs and spaces.
        /// </summary>
        public static List<KeyValuePair<string, int>> ParseStatus(string text)
        {
            var list = new List<KeyValuePair<string, int>>();
            if (string.IsNullOrEmpty(text)) return list;
            foreach (string raw in text.Replace("\r", "").Split('\n'))
            {
                string line = raw.Trim();
                int open = line.LastIndexOf(" (", StringComparison.Ordinal);
                if (open <= 0 || !line.EndsWith(")", StringComparison.Ordinal)) continue;
                int pid;
                if (!int.TryParse(line.Substring(open + 2, line.Length - open - 3), NumberStyles.None, CultureInfo.InvariantCulture, out pid) || pid <= 0) continue;
                string id = line.Substring(0, open).Trim();
                if (Catalog.ValidAppId(id)) list.Add(new KeyValuePair<string, int>(id, pid));
            }
            return list;
        }

        /// <summary>Parses `pkginfo --app ID` ("Key: value" lines). Null when it holds no component.</summary>
        public static AppInfo ParseAppInfo(string text)
        {
            if (string.IsNullOrEmpty(text)) return null;
            var info = new AppInfo();
            foreach (string raw in text.Replace("\r", "").Split('\n'))
            {
                int colon = raw.IndexOf(':');
                if (colon <= 0) continue;
                string key = raw.Substring(0, colon).Trim(), val = raw.Substring(colon + 1).Trim();
                switch (key)
                {
                    case "component": info.Component = val; break;
                    case "Label": info.Label = val; break;
                    case "Icon": info.Icon = val; break;
                    case "Package": info.Package = val; break;
                    case "Nodisplay": info.NoDisplay = val == "1"; break;
                }
            }
            return info.Component == null ? null : info;
        }

        /// <summary>A visible UI app that is not part of the TV itself (and not Vetro, which runs the dock).</summary>
        public static bool IsUserApp(string appId, AppInfo info)
        {
            if (info == null || appId == null) return false;
            if (info.Component != "uiapp" || info.NoDisplay) return false;
            if (Protected.Contains(appId) || Background.Contains(appId)) return false;
            if (appId.StartsWith("vetrotvapp", StringComparison.Ordinal)) return false;
            return true;
        }

        public static string DisplayName(string appId, AppInfo info, string catalogLabel)
        {
            string name;
            if (FriendlyNames.TryGetValue(appId, out name)) return name;
            if (!string.IsNullOrEmpty(catalogLabel)) return catalogLabel;
            if (info != null && !string.IsNullOrEmpty(info.Label)) return info.Label;
            return appId;
        }

        /// <summary>
        /// /proc/[pid]/stat: "pid (comm) state ppid ... utime(14) stime(15) ...". The command name may hold spaces
        /// and parentheses, so the fields are counted from the last ')'.
        /// </summary>
        public static bool ParseStat(string text, out int pid, out int ppid, out long ticks)
        {
            pid = ppid = 0; ticks = 0;
            if (string.IsNullOrEmpty(text)) return false;
            int close = text.LastIndexOf(')');
            int open = text.IndexOf(' ');
            if (close < 0 || open <= 0) return false;
            if (!int.TryParse(text.Substring(0, open), NumberStyles.None, CultureInfo.InvariantCulture, out pid)) return false;
            string[] f = text.Substring(close + 1).Trim().Split(' ');
            // f[0] = state (field 3), so field n is f[n - 3].
            long ut, st;
            if (f.Length < 13 || !int.TryParse(f[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out ppid)) return false;
            if (!long.TryParse(f[11], NumberStyles.Integer, CultureInfo.InvariantCulture, out ut)) return false;
            if (!long.TryParse(f[12], NumberStyles.Integer, CultureInfo.InvariantCulture, out st)) return false;
            ticks = ut + st;
            return true;
        }

        /// <summary>/proc/[pid]/statm "size resident shared ...", in pages: resident minus shared, in KiB.</summary>
        public static long PrivateKbFromStatm(string text, int pageKb)
        {
            if (string.IsNullOrEmpty(text)) return 0;
            string[] f = text.Trim().Split(' ');
            long res, shared;
            if (f.Length < 3 || !long.TryParse(f[1], out res) || !long.TryParse(f[2], out shared)) return 0;
            long priv = res - shared;
            return priv > 0 ? priv * pageKb : 0;
        }

        /// <summary>"VmSwap:   1234 kB" from /proc/[pid]/status, in KiB (0 when absent).</summary>
        public static long SwapKbFromStatus(string text)
        {
            if (string.IsNullOrEmpty(text)) return 0;
            int at = text.IndexOf("VmSwap:", StringComparison.Ordinal);
            if (at < 0) return 0;
            int end = text.IndexOf('\n', at);
            string v = (end < 0 ? text.Substring(at + 7) : text.Substring(at + 7, end - at - 7)).Replace("kB", "").Trim();
            long kb;
            return long.TryParse(v, out kb) ? kb : 0;
        }

        /// <summary>All descendants of <paramref name="root"/> (the root included), from a pid -> parent map.</summary>
        public static List<int> Tree(int root, Dictionary<int, List<int>> children)
        {
            var result = new List<int>();
            var stack = new Stack<int>();
            var seen = new HashSet<int>();
            stack.Push(root);
            while (stack.Count > 0)
            {
                int p = stack.Pop();
                if (!seen.Add(p)) continue;   // a broken /proc snapshot can never make this loop forever
                result.Add(p);
                List<int> kids;
                if (children.TryGetValue(p, out kids)) foreach (int k in kids) stack.Push(k);
            }
            return result;
        }

        public static Dictionary<int, List<int>> ChildMap(IEnumerable<ProcSample> procs)
        {
            var map = new Dictionary<int, List<int>>();
            foreach (ProcSample s in procs)
            {
                if (s.PPid <= 0 || s.PPid == s.Pid) continue;
                List<int> l;
                if (!map.TryGetValue(s.PPid, out l)) map[s.PPid] = l = new List<int>();
                l.Add(s.Pid);
            }
            return map;
        }

        /// <summary>CPU percent of one core between two tick totals taken <paramref name="seconds"/> apart.</summary>
        public static double CpuPercent(long ticksBefore, long ticksNow, double seconds, int ticksPerSecond)
        {
            if (seconds <= 0 || ticksPerSecond <= 0 || ticksNow < ticksBefore) return -1;
            return (ticksNow - ticksBefore) * 100.0 / (seconds * ticksPerSecond);
        }

        public static void Sort(List<RunningApp> apps, TaskSort by)
        {
            apps.Sort((a, b) =>
            {
                int c;
                switch (by)
                {
                    case TaskSort.Cpu: c = b.CpuPercent.CompareTo(a.CpuPercent); break;
                    case TaskSort.Name: c = 0; break;
                    default: c = b.MemoryKb.CompareTo(a.MemoryKb); break;
                }
                if (c == 0) c = string.Compare(a.Label, b.Label, StringComparison.OrdinalIgnoreCase);
                return c != 0 ? c : string.CompareOrdinal(a.AppId, b.AppId);
            });
        }

        public static TaskSort Next(TaskSort s, int step)
        {
            int n = 3, i = ((int)s + step) % n;
            return (TaskSort)(i < 0 ? i + n : i);
        }

        public static string SortName(TaskSort s)
        {
            return s == TaskSort.Cpu ? "CPU" : s == TaskSort.Name ? "Name" : "Memory";
        }

        public static string FormatMemory(long kb)
        {
            if (kb < 0) return "…";   // not measured yet
            if (kb < 1024) return kb + " KB";
            double mb = kb / 1024.0;
            return mb < 10 ? mb.ToString("0.0", CultureInfo.InvariantCulture) + " MB" : Math.Round(mb).ToString(CultureInfo.InvariantCulture) + " MB";
        }

        public static string FormatCpu(double pct)
        {
            if (pct < 0) return "–";
            return pct < 10 ? pct.ToString("0.0", CultureInfo.InvariantCulture) + "%" : Math.Round(pct).ToString(CultureInfo.InvariantCulture) + "%";
        }
    }
}
