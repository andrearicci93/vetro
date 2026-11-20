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
        public string IconPath = null;
        /// <summary>Private resident memory plus swap of the app and all its child processes (web renderers), in KiB; -1 until measured.</summary>
        public long MemoryKb = -1;
        /// <summary>CPU use of the app's process tree since the previous sample, in percent of one core; -1 until measured.</summary>
        public double CpuPercent = -1;
        /// <summary>True from the moment the user asked to close it until it leaves the list.</summary>
        public bool Closing = false;
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
        public ProcSample(int pid, int ppid, long ticks) { Pid = pid; PPid = ppid; Ticks = ticks; }
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
        /// Each app id is listed once (the first line wins): the task manager keeps one row per id.
        /// </summary>
        public static List<KeyValuePair<string, int>> ParseStatus(string text)
        {
            var list = new List<KeyValuePair<string, int>>();
            if (string.IsNullOrEmpty(text)) return list;
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (string raw in text.Replace("\r", "").Split('\n'))
            {
                string line = raw.Trim();
                int open = line.LastIndexOf(" (", StringComparison.Ordinal);
                if (open <= 0 || !line.EndsWith(")", StringComparison.Ordinal)) continue;
                int pid;
                if (!int.TryParse(line.Substring(open + 2, line.Length - open - 3), NumberStyles.None, CultureInfo.InvariantCulture, out pid) || pid <= 0) continue;
                string id = line.Substring(0, open).Trim();
                if (Catalog.ValidAppId(id) && seen.Add(id)) list.Add(new KeyValuePair<string, int>(id, pid));
            }
            return list;
        }

        /// <summary>
        /// The same apps with each app id once, in the same order (the first occurrence wins). The task manager keeps one
        /// row per app id, so a list with a repeated id would count more rows than it draws and leave an empty one.
        /// </summary>
        public static List<RunningApp> UniqueById(List<RunningApp> apps)
        {
            var list = new List<RunningApp>(apps == null ? 0 : apps.Count);
            if (apps == null) return list;
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (RunningApp a in apps)
                if (a != null && a.AppId != null && seen.Add(a.AppId)) list.Add(a);
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
            long pidL;
            if (!TryParseLong(text, 0, open, false, out pidL) || pidL > int.MaxValue) return false;
            int pos = close + 1;
            int end = text.Length;
            while (pos < end && char.IsWhiteSpace(text[pos])) pos++;
            while (end > pos && char.IsWhiteSpace(text[end - 1])) end--;
            if (pos >= end) return false;
            // f[0] = state (field 3), so field n is f[n - 3]: ppid = f[1], utime = f[11], stime = f[12].
            long ppidL = 0, ut = 0, st = 0;
            bool gotPpid = false, gotUt = false, gotSt = false;
            int field = 0;
            while (pos <= end && field <= 12)
            {
                int sep = text.IndexOf(' ', pos, end - pos);
                int tokEnd = sep < 0 ? end : sep;
                if (field == 1)
                {
                    if (!TryParseLong(text, pos, tokEnd, true, out ppidL) || ppidL < int.MinValue || ppidL > int.MaxValue) return false;
                    gotPpid = true;
                }
                else if (field == 11)
                {
                    if (!TryParseLong(text, pos, tokEnd, true, out ut)) return false;
                    gotUt = true;
                }
                else if (field == 12)
                {
                    if (!TryParseLong(text, pos, tokEnd, true, out st)) return false;
                    gotSt = true;
                    break;
                }
                if (sep < 0) break;
                pos = sep + 1;
                field++;
            }
            if (!gotPpid || !gotUt || !gotSt) return false;
            pid = (int)pidL;
            ppid = (int)ppidL;
            ticks = ut + st;
            return true;
        }

        private static bool TryParseLong(string s, int start, int end, bool allowSign, out long value)
        {
            value = 0;
            if (start >= end) return false;
            int i = start;
            bool neg = false;
            if (allowSign && (s[i] == '-' || s[i] == '+'))
            {
                neg = s[i] == '-';
                i++;
                if (i >= end) return false;
            }
            long acc = 0;
            for (; i < end; i++)
            {
                char c = s[i];
                if (c < '0' || c > '9') return false;
                int d = c - '0';
                if (acc > (long.MaxValue - d) / 10) return false;
                acc = acc * 10 + d;
            }
            value = neg ? -acc : acc;
            return true;
        }

        /// <summary>/proc/[pid]/statm "size resident shared ...", in pages: resident minus shared, in KiB.</summary>
        public static long PrivateKbFromStatm(string text, int pageKb)
        {
            if (string.IsNullOrEmpty(text)) return 0;
            int start = 0, end = text.Length;
            while (start < end && char.IsWhiteSpace(text[start])) start++;
            while (end > start && char.IsWhiteSpace(text[end - 1])) end--;
            int sp1 = text.IndexOf(' ', start, end - start);
            if (sp1 < 0) return 0;
            int sp2 = text.IndexOf(' ', sp1 + 1, end - (sp1 + 1));
            if (sp2 < 0) return 0;
            int sp3 = text.IndexOf(' ', sp2 + 1, end - (sp2 + 1));
            int end2 = sp3 < 0 ? end : sp3;
            long res, shared;
            if (!TryParseLong(text, sp1 + 1, sp2, true, out res) || !TryParseLong(text, sp2 + 1, end2, true, out shared)) return 0;
            long priv = res - shared;
            return priv > 0 ? priv * pageKb : 0;
        }

        /// <summary>"VmSwap:   1234 kB" from /proc/[pid]/status, in KiB (0 when absent).</summary>
        public static long SwapKbFromStatus(string text)
        {
            if (string.IsNullOrEmpty(text)) return 0;
            int at = text.IndexOf("VmSwap:", StringComparison.Ordinal);
            if (at < 0) return 0;
            int pos = at + 7;
            int end = text.IndexOf('\n', pos);
            if (end < 0) end = text.Length;
            while (pos < end && char.IsWhiteSpace(text[pos])) pos++;
            while (end > pos && char.IsWhiteSpace(text[end - 1])) end--;
            if (end - pos >= 2 && text[end - 2] == 'k' && text[end - 1] == 'B')
            {
                end -= 2;
                while (end > pos && char.IsWhiteSpace(text[end - 1])) end--;
            }
            long kb;
            return TryParseLong(text, pos, end, true, out kb) ? kb : 0;
        }

        /// <summary>"MemAvailable:   123456 kB" from /proc/meminfo, in KiB (-1 when absent).</summary>
        public static long MemAvailableFromMeminfo(string text)
        {
            if (string.IsNullOrEmpty(text)) return -1;
            int at = text.IndexOf("MemAvailable:", StringComparison.Ordinal);
            if (at < 0) return -1;
            int pos = at + 13;
            int end = text.IndexOf('\n', pos);
            if (end < 0) end = text.Length;
            while (pos < end && char.IsWhiteSpace(text[pos])) pos++;
            while (end > pos && char.IsWhiteSpace(text[end - 1])) end--;
            if (end - pos >= 2 && text[end - 2] == 'k' && text[end - 1] == 'B')
            {
                end -= 2;
                while (end > pos && char.IsWhiteSpace(text[end - 1])) end--;
            }
            long kb;
            return TryParseLong(text, pos, end, true, out kb) ? kb : -1;
        }

        /// <summary>All descendants of <paramref name="root"/> (the root included), from a pid -> parent map.</summary>
        public static List<int> Tree(int root, Dictionary<int, List<int>> children)
        {
            var result = new List<int> { root };
            if (children == null || !children.ContainsKey(root)) return result;
            for (int i = 0; i < result.Count; i++)
            {
                List<int> kids;
                if (!children.TryGetValue(result[i], out kids)) continue;
                for (int k = 0; k < kids.Count; k++)
                {
                    int c = kids[k];
                    if (!result.Contains(c)) result.Add(c);   // a broken /proc snapshot can never make this loop forever
                }
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
