using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Launcher.Core;
using Launcher.Native;

namespace Launcher.Ui
{
    /// <summary>A look at the running apps, handed from the worker thread to the EFL thread.</summary>
    internal sealed class TaskSnapshot
    {
        public List<RunningApp> Apps = new List<RunningApp>();
        public long AvailableKb = -1;
        /// <summary>True for the quick first half of a look: the apps are known, their memory and CPU are not yet.</summary>
        public bool Partial;
    }

    /// <summary>
    /// Reads the running user apps off the EFL thread, in two steps: first which apps run (`app_launcher -S`,
    /// plus each app's registry entry, read once through the app_info C API and cached), handed over at once;
    /// then each app's process tree from /proc. The second step can be slow on a TV that is short of memory
    /// (reading another process's memory figures waits for that process), so the list shows up without it.
    /// </summary>
    internal sealed class TaskSource
    {
        private readonly object _gate = new object();
        private readonly Dictionary<string, AppInfo> _infos = new Dictionary<string, AppInfo>(StringComparer.Ordinal);
        private readonly Dictionary<string, string> _catalogLabels = new Dictionary<string, string>(StringComparer.Ordinal);
        private readonly Dictionary<string, string> _catalogIcons = new Dictionary<string, string>(StringComparer.Ordinal);
        // Store apps keep their icon outside their package, under the store id: app or package id -> icon file.
        private Dictionary<string, string> _storeIcons;
        private const string StoreIconRoot = "/opt/share/webappservice/apps_icon/all/";
        private static readonly string[] StoreIconSizes = { "224x224", "304x304", "152x152", "104x104", "icon" };
        private static readonly string[] HomeDataDirs = {
            "/opt/usr/home/owner/apps_rw/com.samsung.tv.csfs/data", "/opt/usr/home/owner/apps_rw/com.samsung.tv.home.media/data" };
        private readonly Action<string> _log;
        private Dictionary<int, long> _prevTicks = new Dictionary<int, long>();
        private long _prevStamp;
        private TaskSnapshot _ready;
        private bool _busy, _appInfoBroken;
        private readonly int _hz, _pageKb;

        [DllImport("libc")] private static extern int sysconf(int name);
        [DllImport("libc")] private static extern void free(IntPtr p);
        private const int ScClkTck = 2, ScPageSize = 30;

        private const string AppManager = "libcapi-appfw-app-manager.so.0";
        [DllImport(AppManager)] private static extern int app_info_create(string appId, out IntPtr info);
        [DllImport(AppManager)] private static extern int app_info_destroy(IntPtr info);
        [DllImport(AppManager)] private static extern int app_info_get_label(IntPtr info, out IntPtr label);
        [DllImport(AppManager)] private static extern int app_info_get_icon(IntPtr info, out IntPtr path);
        [DllImport(AppManager)] private static extern int app_info_is_nodisplay(IntPtr info, out byte noDisplay);
        [DllImport(AppManager)] private static extern int app_info_get_app_component_type(IntPtr info, out int type);
        [DllImport(AppManager)] private static extern int app_info_get_package(IntPtr info, out IntPtr package);
        private const int ComponentUiApp = 0;   // APP_INFO_APP_COMPONENT_TYPE_UI_APP

        public TaskSource(AppEntry[] catalog, Action<string> log)
        {
            _log = log;
            foreach (AppEntry e in catalog)
            {
                if (e.AppId == null || e.IsSystem) continue;
                if (!_catalogLabels.ContainsKey(e.AppId)) _catalogLabels[e.AppId] = e.Label;
                if (e.IconPath != null && !_catalogIcons.ContainsKey(e.AppId)) _catalogIcons[e.AppId] = e.IconPath;
            }
            int hz = 100, page = 4096;
            try { hz = sysconf(ScClkTck); page = sysconf(ScPageSize); } catch (Exception) { }
            _hz = hz > 0 ? hz : 100;
            _pageKb = page >= 1024 ? page / 1024 : 4;
        }

        public bool Busy { get { lock (_gate) return _busy; } }

        /// <summary>Starts a look in the background unless one is already running.</summary>
        public void Request()
        {
            lock (_gate)
            {
                if (_busy) return;
                _busy = true;
            }
            var t = new Thread(() =>
            {
                try { Take(); }
                catch (Exception ex) { _log("tasks: " + ex.Message); }
                lock (_gate) _busy = false;
            });
            t.IsBackground = true;
            t.Name = "tasks";
            t.Start();
        }

        /// <summary>The newest look, or null. A full look replaces a partial one that was not picked up yet.</summary>
        public TaskSnapshot TryTake()
        {
            lock (_gate) { TaskSnapshot s = _ready; _ready = null; return s; }
        }

        private void Publish(TaskSnapshot s) { lock (_gate) _ready = s; }

        /// <summary>Asks the app to close, and kills it if it is still there two seconds later. Runs detached.</summary>
        public void Close(string appId)
        {
            if (!Catalog.ValidAppId(appId)) return;   // plain id characters: safe on the command line
            string cmd = "( /usr/bin/app_launcher -t " + appId + "; sleep 2; /usr/bin/app_launcher -r " + appId
                + " | grep -q 'result: running' && /usr/bin/app_launcher -k " + appId + " ) >/dev/null 2>&1 &";
            int rc = Libc.system(cmd);
            _log("tasks: close " + appId + " rc=" + rc);
        }

        private static long Ms(long since) { return (Stopwatch.GetTimestamp() - since) * 1000 / Stopwatch.Frequency; }

        private void Take()
        {
            long t0 = Stopwatch.GetTimestamp();
            var running = Tasks.ParseStatus(Run("/usr/bin/app_launcher", "-S"));
            long tStatus = Ms(t0);
            LookUp(running);
            long tInfo = Ms(t0);

            // Step one: the apps, with their names and icons; memory and CPU still unknown.
            var users = new List<KeyValuePair<string, int>>();
            var quick = new TaskSnapshot { Partial = true };
            foreach (var r in running)
            {
                AppInfo info;
                lock (_gate) _infos.TryGetValue(r.Key, out info);
                if (!Tasks.IsUserApp(r.Key, info)) continue;
                users.Add(r);
                quick.Apps.Add(NewApp(r, info));
            }
            Publish(quick);

            // Step two: the process trees.
            var procs = new Dictionary<int, ProcSample>();
            foreach (string dir in Directory.GetDirectories("/proc"))
            {
                int pid;
                if (!int.TryParse(Path.GetFileName(dir), NumberStyles.None, CultureInfo.InvariantCulture, out pid)) continue;
                int p, pp; long ticks;
                if (Tasks.ParseStat(ReadSmall(dir + "/stat"), out p, out pp, out ticks))
                    procs[pid] = new ProcSample { Pid = pid, PPid = pp, Ticks = ticks };
            }
            var children = Tasks.ChildMap(procs.Values);
            long tProc = Ms(t0);

            long stamp = Stopwatch.GetTimestamp();
            double seconds = _prevStamp == 0 ? 0 : (stamp - _prevStamp) / (double)Stopwatch.Frequency;
            var ticksNow = new Dictionary<int, long>();
            var full = new TaskSnapshot();
            foreach (var r in users)
            {
                if (!procs.ContainsKey(r.Value)) continue;   // gone in the meantime
                AppInfo info;
                lock (_gate) _infos.TryGetValue(r.Key, out info);
                long mem = 0, ticks = 0;
                foreach (int pid in Tasks.Tree(r.Value, children))
                {
                    ProcSample s;
                    if (procs.TryGetValue(pid, out s)) ticks += s.Ticks;
                    mem += Tasks.PrivateKbFromStatm(ReadSmall("/proc/" + pid + "/statm"), _pageKb);
                    mem += Tasks.SwapKbFromStatus(ReadSmall("/proc/" + pid + "/status"));
                }
                ticksNow[r.Value] = ticks;
                long before;
                RunningApp app = NewApp(r, info);
                app.MemoryKb = mem;
                app.CpuPercent = seconds > 0.2 && _prevTicks.TryGetValue(r.Value, out before) ? Tasks.CpuPercent(before, ticks, seconds, _hz) : -1;
                full.Apps.Add(app);
            }
            _prevTicks = ticksNow;
            _prevStamp = stamp;
            full.AvailableKb = MemAvailable();
            Publish(full);
            long total = Ms(t0);
            if (total > 400)
                _log("tasks: slow look " + total + " ms (status " + tStatus + ", app info " + (tInfo - tStatus) + ", /proc walk " + (tProc - tInfo)
                    + ", trees " + (total - tProc) + "); " + full.Apps.Count + " of " + running.Count + " running apps");
        }

        private RunningApp NewApp(KeyValuePair<string, int> r, AppInfo info)
        {
            string label;
            _catalogLabels.TryGetValue(r.Key, out label);
            return new RunningApp { AppId = r.Key, Pid = r.Value, Label = Tasks.DisplayName(r.Key, info, label), IconPath = IconFor(r.Key, info) };
        }

        /// <summary>The package's own icon when it is there; else the store's copy (YouTube, Prime Video...); else the dock's.</summary>
        private string IconFor(string appId, AppInfo info)
        {
            if (!string.IsNullOrEmpty(info.Icon) && File.Exists(info.Icon)) return info.Icon;
            if (_storeIcons == null) _storeIcons = LoadStoreIcons();
            string icon;
            int dot = appId.IndexOf('.');
            if (_storeIcons.TryGetValue(appId, out icon)) return icon;
            if (info.Package != null && _storeIcons.TryGetValue(info.Package, out icon)) return icon;
            if (dot > 0 && _storeIcons.TryGetValue(appId.Substring(0, dot), out icon)) return icon;
            if (_catalogIcons.TryGetValue(appId, out icon)) return icon;
            return null;
        }

        /// <summary>
        /// Samsung's Home lists every store app in webapps.txt: a store id (digits) followed by the package and app
        /// ids that belong to it. The icon folder is named after the store id. Read once; plain file reads only.
        /// </summary>
        private Dictionary<string, string> LoadStoreIcons()
        {
            var map = new Dictionary<string, string>(StringComparer.Ordinal);
            try
            {
                string text = null;
                foreach (string dir in HomeDataDirs)
                    foreach (string name in new[] { "webapps.txt.2", "webapps.txt.1" })
                        if (text == null && File.Exists(Path.Combine(dir, name))) text = ReadSmall(Path.Combine(dir, name));
                if (text == null) return map;
                string store = null, icon = null;
                foreach (string raw in text.Replace("\r", "").Split('\n'))
                {
                    string line = raw.Trim();
                    if (line.Length >= 8 && IsDigits(line))
                    {
                        store = line;
                        icon = null;
                        foreach (string size in StoreIconSizes)
                        {
                            string f = StoreIconRoot + store + "/" + size + ".png";
                            if (File.Exists(f)) { icon = f; break; }
                        }
                    }
                    else if (store != null && icon != null && line.Length > 0 && Catalog.ValidAppId(line) && !map.ContainsKey(line))
                        map[line] = icon;
                }
                _log("tasks: " + map.Count + " store app ids with icons");
            }
            catch (Exception ex) { _log("tasks: store icons: " + ex.Message); }
            return map;
        }

        private static bool IsDigits(string s) { foreach (char c in s) if (c < '0' || c > '9') return false; return true; }

        /// <summary>Registry entries for app ids not seen before. A null entry (not an app we can read) is cached too.</summary>
        private void LookUp(List<KeyValuePair<string, int>> running)
        {
            var missing = new List<string>();
            lock (_gate) foreach (var r in running) if (!_infos.ContainsKey(r.Key)) missing.Add(r.Key);
            if (missing.Count == 0) return;
            var viaTool = new List<string>();
            foreach (string id in missing)
            {
                AppInfo info = _appInfoBroken ? null : FromAppInfo(id);
                if (info != null) { lock (_gate) _infos[id] = info; }
                else viaTool.Add(id);
            }
            if (viaTool.Count > 0) LookUpWithTool(viaTool);
        }

        /// <summary>The app_info C API, in this process: no spawn per app.</summary>
        private AppInfo FromAppInfo(string id)
        {
            IntPtr h = IntPtr.Zero;
            try
            {
                if (app_info_create(id, out h) != 0 || h == IntPtr.Zero) return null;
                var info = new AppInfo();
                int type;
                byte nd;
                info.Component = app_info_get_app_component_type(h, out type) == 0 ? (type == ComponentUiApp ? "uiapp" : "other") : null;
                info.NoDisplay = app_info_is_nodisplay(h, out nd) == 0 && nd != 0;
                info.Label = TakeString(app_info_get_label(h, out IntPtr label), label);
                info.Icon = TakeString(app_info_get_icon(h, out IntPtr icon), icon);
                info.Package = TakeString(app_info_get_package(h, out IntPtr pkg), pkg);
                return info.Component == null ? null : info;
            }
            catch (Exception ex)
            {
                // A missing library or symbol: fall back to the pkginfo tool from now on.
                _appInfoBroken = true;
                _log("tasks: app_info unavailable (" + ex.Message + "), using pkginfo");
                return null;
            }
            finally { if (h != IntPtr.Zero) app_info_destroy(h); }
        }

        private static string TakeString(int rc, IntPtr p)
        {
            if (p == IntPtr.Zero) return null;
            string s = rc == 0 ? Marshal.PtrToStringAnsi(p) : null;
            free(p);
            return s;
        }

        /// <summary>pkginfo for the given ids, in one shell (one spawn instead of one per app).</summary>
        private void LookUpWithTool(List<string> ids)
        {
            var sb = new StringBuilder("for id in");
            foreach (string id in ids) sb.Append(' ').Append(id);   // ParseStatus only keeps plain app ids
            sb.Append("; do echo \"@@ $id\"; /usr/bin/pkginfo --app \"$id\" 2>/dev/null; done");
            string output = Run("/bin/sh", null, sb.ToString());
            string current = null;
            var block = new StringBuilder();
            foreach (string line in (output + "\n@@ \n").Split('\n'))
            {
                if (line.StartsWith("@@ ", StringComparison.Ordinal))
                {
                    if (current != null)
                    {
                        AppInfo info = Tasks.ParseAppInfo(block.ToString());
                        lock (_gate) _infos[current] = info;
                    }
                    current = line.Substring(3).Trim();
                    if (current.Length == 0) current = null;
                    block.Clear();
                }
                else block.Append(line).Append('\n');
            }
        }

        private static long MemAvailable()
        {
            string m = ReadSmall("/proc/meminfo");
            int at = m.IndexOf("MemAvailable:", StringComparison.Ordinal);
            if (at < 0) return -1;
            int end = m.IndexOf('\n', at);
            long kb;
            return long.TryParse((end < 0 ? m.Substring(at + 13) : m.Substring(at + 13, end - at - 13)).Replace("kB", "").Trim(), out kb) ? kb : -1;
        }

        private static string ReadSmall(string path)
        {
            try { return File.ReadAllText(path); } catch (Exception) { return ""; }
        }

        [DllImport("libc", SetLastError = true)] private static extern IntPtr popen(string command, string mode);
        [DllImport("libc")] private static extern int pclose(IntPtr stream);
        [DllImport("libc")] private static extern UIntPtr fread(byte[] buffer, UIntPtr size, UIntPtr count, IntPtr stream);

        /// <summary>
        /// Output of a command, through libc's popen rather than System.Diagnostics.Process: EFL installs its own
        /// SIGCHLD handler, which can reap the child before .NET sees it exit, and Process.WaitForExit then sat out
        /// its whole timeout (measured: 8 s for a 20 ms command). popen only needs the pipe to close.
        /// Only fixed program paths and plain app ids ever reach the command line.
        /// </summary>
        private string Run(string file, string args, string shellScript = null)
        {
            string cmd = shellScript ?? (file + (args != null ? " " + args : ""));
            IntPtr f = IntPtr.Zero;
            try
            {
                f = popen(cmd + " 2>/dev/null", "r");
                if (f == IntPtr.Zero) { _log("tasks: popen failed for " + file + " errno=" + Marshal.GetLastWin32Error()); return ""; }
                var buf = new byte[16384];
                var ms = new MemoryStream();
                while (true)
                {
                    int n = (int)fread(buf, (UIntPtr)1, (UIntPtr)buf.Length, f);
                    if (n <= 0) break;
                    ms.Write(buf, 0, n);
                    if (ms.Length > 4 * 1024 * 1024) break;   // nothing we run prints that much
                }
                return Encoding.UTF8.GetString(ms.GetBuffer(), 0, (int)ms.Length);
            }
            catch (Exception ex) { _log("tasks: " + file + ": " + ex.Message); return ""; }
            finally { if (f != IntPtr.Zero) pclose(f); }   // ECHILD if ecore reaped it first: harmless
        }
    }
}
