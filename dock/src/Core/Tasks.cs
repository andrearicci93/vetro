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
        public string Component, Label, Icon, Package, Exec;
        public bool NoDisplay;
        public bool TaskManage = true;
        public bool OnBoot;
        public bool AutoRestart;
        public bool NoAutoRaise;
    }

    /// <summary>One line of /proc/[pid]/stat, cut down to what the tree sums need.</summary>
    internal struct ProcSample
    {
        public int Pid, PPid;
        public long Ticks;      // utime + stime
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
            "com.samsung.tv.coba.adagent", "org.tizen.ambientapp",
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

        private static bool ParseBool(string val)
        {
            return val == "1" || val.Equals("true", StringComparison.OrdinalIgnoreCase);
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
                    case "Exec": info.Exec = val; break;
                    case "Nodisplay": info.NoDisplay = ParseBool(val); break;
                    case "Taskmanage": info.TaskManage = val != "0" && !val.Equals("false", StringComparison.OrdinalIgnoreCase); break;
                    case "Onboot": info.OnBoot = ParseBool(val); break;
                    case "Autorestart": info.AutoRestart = ParseBool(val); break;
                }
            }
            return info.Component == null ? null : info;
        }

        /// <summary>Apps explicitly surfaced by the task manager (e.g. Samsung Home, Store, YouTube) regardless of firmware flags.</summary>
        public static bool IsKeepVisible(string appId)
        {
            return appId != null && FriendlyNames.ContainsKey(appId);
        }

        /// <summary>A visible UI app that is not part of the TV itself (and not Vetro, which runs the dock).</summary>
        public static bool IsUserApp(string appId, AppInfo info)
        {
            return IsUserApp(appId, info, false);
        }

        /// <summary>
        /// A visible UI app that is not part of the TV itself, Vetro, or a background firmware helper
        /// (detected via Tizen manifest/metadata signals when not in the user's launcher catalog).
        /// </summary>
        public static bool IsUserApp(string appId, AppInfo info, bool inCatalog)
        {
            if (info == null || appId == null) return false;
            if (info.Component != "uiapp" || info.NoDisplay) return false;
            if (Protected.Contains(appId) || Background.Contains(appId)) return false;
            if (appId.StartsWith("vetrotvapp", StringComparison.Ordinal)) return false;
            if (!inCatalog && !IsKeepVisible(appId))
            {
                if (!info.TaskManage || info.NoAutoRaise || info.OnBoot || info.AutoRestart) return false;
                if (!string.IsNullOrEmpty(info.Exec) && info.Exec.StartsWith("/usr/bin/", StringComparison.Ordinal)) return false;
            }
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

    /// <summary>
    /// Tracks user-initiated app closes across snapshots to detect firmware helpers that cannot be closed
    /// (survive past the close timeout or auto-respawn with a new PID) on any TV model or firmware version.
    /// </summary>
    internal sealed class TaskCloseTracker
    {
        public const double ClosingTimeoutSeconds = 6.0;
        public const double RespawnWindowSeconds = 10.0;
        public const int MaxLearned = 64;

        private sealed class PendingClose
        {
            public int Pid;
            public long AtTicks;
            public bool SawGone;
        }

        private readonly Dictionary<string, PendingClose> _pending = new Dictionary<string, PendingClose>(StringComparer.Ordinal);
        private readonly HashSet<string> _learned = new HashSet<string>(StringComparer.Ordinal);
        private readonly List<string> _learnedOrder = new List<string>();
        private readonly long _closeTimeoutTicks, _respawnTicks;

        public TaskCloseTracker(long ticksPerSecond)
        {
            _closeTimeoutTicks = (long)(ClosingTimeoutSeconds * ticksPerSecond);
            _respawnTicks = (long)(RespawnWindowSeconds * ticksPerSecond);
        }

        public static bool KeepClosing(bool wasClosing, int oldPid, int newPid, long closingAt, long now, long timeoutTicks)
        {
            return wasClosing && oldPid == newPid && (closingAt == 0 || now - closingAt < timeoutTicks);
        }

        public int LearnedCount { get { return _learnedOrder.Count; } }

        public void RecordClose(string appId, int pid, long nowTicks)
        {
            if (Catalog.ValidAppId(appId) && pid > 0)
                _pending[appId] = new PendingClose { Pid = pid, AtTicks = nowTicks };
        }

        public void CancelClose(string appId)
        {
            if (appId != null) _pending.Remove(appId);
        }

        public bool IsLearned(string appId)
        {
            return appId != null && _learned.Contains(appId);
        }

        private bool AddLearned(string appId)
        {
            if (!Catalog.ValidAppId(appId) || !_learned.Add(appId)) return false;
            if (_learnedOrder.Count >= MaxLearned)
            {
                _learned.Remove(_learnedOrder[0]);
                _learnedOrder.RemoveAt(0);
            }
            _learnedOrder.Add(appId);
            return true;
        }

        public void LoadLearned(string text)
        {
            if (string.IsNullOrEmpty(text)) return;
            foreach (string raw in text.Replace("\r", "").Split('\n'))
            {
                string line = raw.Trim();
                if (line.Length == 0 || line[0] == '#') continue;
                AddLearned(line);
            }
        }

        public string FormatLearned()
        {
            return _learnedOrder.Count == 0 ? "" : string.Join("\n", _learnedOrder) + "\n";
        }

        public List<KeyValuePair<string, string>> Observe(List<KeyValuePair<string, int>> running, long nowTicks, Func<string, bool> keepVisible)
        {
            var newlyLearned = new List<KeyValuePair<string, string>>();
            if (_pending.Count == 0) return newlyLearned;

            var live = new Dictionary<string, int>(StringComparer.Ordinal);
            if (running != null)
            {
                foreach (var r in running)
                    if (r.Key != null && !live.ContainsKey(r.Key)) live[r.Key] = r.Value;
            }

            var keys = new List<string>(_pending.Keys);
            foreach (string appId in keys)
            {
                PendingClose p = _pending[appId];
                long elapsed = nowTicks - p.AtTicks;
                if (elapsed < 0)
                {
                    _pending.Remove(appId);
                    continue;
                }
                int curPid;
                if (live.TryGetValue(appId, out curPid))
                {
                    if (curPid != p.Pid)
                    {
                        _pending.Remove(appId);
                        if (elapsed <= _respawnTicks && (keepVisible == null || !keepVisible(appId)))
                        {
                            if (AddLearned(appId))
                                newlyLearned.Add(new KeyValuePair<string, string>(appId, "respawned pid " + p.Pid + "->" + curPid));
                        }
                    }
                    else if (elapsed >= _closeTimeoutTicks)
                    {
                        _pending.Remove(appId);
                        if (keepVisible == null || !keepVisible(appId))
                        {
                            if (AddLearned(appId))
                                newlyLearned.Add(new KeyValuePair<string, string>(appId, "survived close pid " + p.Pid));
                        }
                    }
                }
                else
                {
                    p.SawGone = true;
                    if (elapsed >= _respawnTicks) _pending.Remove(appId);
                }
            }
            return newlyLearned;
        }
    }
}
