using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using Launcher.Core;
using Launcher.Native;
using Launcher.Ui;

// Native Samsung TV launcher: a glass dock over the running app, drawn with EFL through
// P/Invoke and started by the system's signed `dotnet` (the TV refuses unsigned ELF binaries).
//
// Lifecycle (see README):
//   * the process stays resident; Back/Home/idle only hide the window, so showing the dock
//     again costs a window map instead of a dotnet cold start;
//   * hidden, the process sleeps in the EFL main loop (no animator, no timer, no polling);
//   * `show` / `hide` / `toggle` are read from a FIFO through an ecore fd handler.
namespace Launcher
{
    internal static class Program
    {
        private const int NotificationLevelTop = 40;
        private const int WindowLayer = 900;
        private const int DefaultScreenW = 1920, DefaultScreenH = 1080;

        // Delegates handed to native code live in static fields so the GC can never collect them.
        private static readonly Efl.EvasCb KeyCb = OnKey;
        private static readonly Efl.TaskCb AnimCb = OnFrame;
        private static readonly Efl.TaskCb IdleCb = OnIdle;
        private static readonly Efl.FdCb FifoCb = OnFifo;
        private static readonly Efl.FdCb InputCb = OnInput;

        private static string _dir, _logPath, _pidPath, _fifoPath;
        private static IntPtr _win, _anim, _idle, _fifoHandler;
        private static int _fifoFd = -1;
        private static double _lastFrame;
        private static AppEntry[] _apps, _inputs;
        // Two pages share one window: the apps row and the inputs panel. _ctl / _dock always
        // point at the page on screen, so everything below works on "the dock" as before.
        private static Controller _ctl, _appsCtl, _inputsCtl;
        private static Dock _dock, _appsDock, _inputsDock;
        private static IntPtr _clockTimer;
        private static readonly Efl.TaskCb ClockCb = OnClock;
        private static readonly CommandBuffer Commands = new CommandBuffer();
        private static readonly byte[] ReadBuf = new byte[128];

        // Remote-control input (read-only evdev, never grabbed): the Home key toggles the dock.
        private const double HomeDebounceSeconds = 0.35;

        // --kill-on-home APPID: the system sends Home to Samsung's own home app as well (it is relaunched by
        // the key), so after each Home press the app is closed again, a few times because its start is slow.
        // Off by default; the app id is checked as plain id characters because it goes on a command line.
        // One process: a single shell runs every sleep and every kill (at 0.15, 0.45, 0.9, 1.6 and 2.8 s after the
        // press, as before), so the dock itself spawns once per Home press instead of five times from the loop.
        private static string _guardApp, _guardCmd;
        private const double GuardFirst = 0.15;
        private static readonly double[] GuardGaps = { 0.3, 0.45, 0.7, 1.2 };   // sleeps between the five kills
        private static int _homeCode = -1;
        private static bool _learn;
        private static double _lastHome = -100;
        // One entry per watched evdev node, in the order they were opened: ecore hands the index back to OnInput.
        private static readonly List<int> _inputFds = new List<int>();
        private static readonly List<EvdevReader> _inputReaders = new List<EvdevReader>();
        private static readonly List<string> _inputPaths = new List<string>();
        private static readonly List<IntPtr> _inputHandlers = new List<IntPtr>();
        private static IntPtr _rescanTimer;
        private static readonly Efl.TaskCb RescanCb = OnRescan;
        private const double RescanSeconds = 3.0;
        private const int EAgain = 11;
        private static readonly byte[] InputBuf = new byte[16 * 32];
        private static readonly List<int> InputPresses = new List<int>();

        // ------------------------------------------------------------------ logging

        private static void Log(string m)
        {
            try { File.AppendAllText(_logPath, DateTime.Now.ToString("HH:mm:ss.fff") + " " + m + "\n"); } catch (Exception) { }
        }

        private static void TrimLog()
        {
            try
            {
                var f = new FileInfo(_logPath);
                if (f.Exists && f.Length > 256 * 1024) f.Delete();
            }
            catch (Exception) { }
        }

        // ------------------------------------------------------------------ setup

        private static string Arg(string[] args, string name)
        {
            for (int i = 0; i + 1 < args.Length; i++) if (args[i] == name) return args[i + 1];
            return null;
        }

        private static bool Flag(string[] args, string name) { return Array.IndexOf(args, name) >= 0; }

        private static string ResolveDir(string[] args)
        {
            string d = Arg(args, "--dir") ?? Environment.GetEnvironmentVariable("TVLAUNCHER_DIR") ?? "/home/owner";
            return Directory.Exists(d) ? d : Path.GetTempPath();
        }

        /// <summary>
        /// Environment for EFL. Must go through libc setenv: on Unix .NET keeps its own copy of
        /// Environment.SetEnvironmentVariable and native getenv never sees it.
        /// </summary>
        private static string SetupEnvironment()
        {
            string want = (Environment.GetEnvironmentVariable("TVLAUNCHER_ENGINE") ?? "").ToLowerInvariant();
            bool egl = want == "egl" || (want != "shm" && Directory.Exists("/dev/dri"));

            // The firmware's own apps run with wayland_egl whenever /dev/dri exists.
            Libc.setenv("ELM_ENGINE", "gl", 1);
            Libc.setenv("ECORE_EVAS_ENGINE", egl ? "wayland_egl" : "wayland_shm", 1);

            // XDG_RUNTIME_DIR must be the directory that holds the compositor's socket. Inherited
            // values are only trusted when the socket is really there (the root agent's may not be).
            string uid = Libc.getuid().ToString();
            string display = Environment.GetEnvironmentVariable("WAYLAND_DISPLAY") ?? "wayland-0";
            string runtime = null;
            foreach (string c in new[] { Environment.GetEnvironmentVariable("XDG_RUNTIME_DIR"), "/run/user/" + uid, "/run", "/run/user/5001" })
                if (!string.IsNullOrEmpty(c) && File.Exists(Path.Combine(c, display))) { runtime = c; break; }
            if (runtime == null) runtime = Directory.Exists("/run/user/" + uid) ? "/run/user/" + uid : "/run";
            Libc.setenv("XDG_RUNTIME_DIR", runtime, 1);
            Libc.setenv("WAYLAND_DISPLAY", "wayland-0", 0);
            Libc.setenv("ELM_PROFILE", "tv", 0);
            Libc.setenv("ELM_DISPLAY", "wl", 0);
            Libc.setenv("EVAS_FONT_DPI", "72", 0);
            if (egl)
            {
                Libc.setenv("ELM_ACCEL", "gl", 0);
                Libc.setenv("EVAS_GL_NO_BLACKLIST", "1", 0);
                Libc.setenv("ECORE_EVAS_COMP_NOSYNC", "1", 0);
                Libc.setenv("ECORE_VSYNC_DRM_ALL", "1", 0);
                Libc.setenv("ECORE_EVAS_GL_SYNC_DRAW_DONE", "1", 0);
                Libc.setenv("EVAS_GL_PARTIAL_DISABLE", "1", 0);
            }
            return egl ? "wayland_egl" : "wayland_shm";
        }

        private static bool ProcessLooksLikeUs(int pid)
        {
            try { return File.ReadAllText("/proc/" + pid + "/cmdline").Contains("tvlauncher-dotnet"); }
            catch (Exception) { return false; }
        }

        /// <summary>
        /// True when this process may run. When another launcher is alive it is asked to show
        /// itself instead (a second Home press must not start a second dock). Never matches by
        /// process name: the root agent is also a dotnet process.
        /// </summary>
        private static bool AcquireInstance()
        {
            try
            {
                int other;
                if (File.Exists(_pidPath) && int.TryParse(File.ReadAllText(_pidPath).Trim(), out other)
                    && other != Libc.getpid() && Libc.kill(other, 0) == 0 && ProcessLooksLikeUs(other))
                {
                    SendCommand("show");
                    return false;
                }
                File.WriteAllText(_pidPath, Libc.getpid().ToString());
            }
            catch (Exception ex) { Log("pidfile: " + ex.Message); }
            return true;
        }

        private static void SendCommand(string word)
        {
            int fd = Libc.open(_fifoPath, Libc.O_WRONLY | Libc.O_NONBLOCK);
            if (fd < 0) return;
            byte[] b = System.Text.Encoding.ASCII.GetBytes(word + "\n");
            Libc.write(fd, b, (UIntPtr)b.Length);
            Libc.close(fd);
        }

        private static void CleanupFiles()
        {
            try
            {
                int pid;
                if (File.Exists(_pidPath) && int.TryParse(File.ReadAllText(_pidPath).Trim(), out pid)
                    && pid == Libc.getpid())
                {
                    File.Delete(_pidPath);
                    Libc.unlink(_fifoPath);
                }
            }
            catch (Exception) { }
        }

        private static void SetupFifo()
        {
            Libc.unlink(_fifoPath);
            if (Libc.mkfifo(_fifoPath, 438u) != 0) { Log("mkfifo failed: " + Marshal.GetLastWin32Error()); return; }
            Libc.chmod(_fifoPath, 438u);   // 0666: it only accepts show/hide/toggle
            // O_RDWR keeps a writer open ourselves, so the descriptor never reports EOF when a client disconnects.
            _fifoFd = Libc.open(_fifoPath, Libc.O_RDWR | Libc.O_NONBLOCK);
            if (_fifoFd < 0) { Log("open fifo failed: " + Marshal.GetLastWin32Error()); return; }
            _fifoHandler = Efl.ecore_main_fd_handler_add(_fifoFd, Efl.EcoreFdRead, FifoCb, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
        }

        /// <summary>
        /// Opens the remote's evdev nodes read-only and watches them through ecore fd handlers
        /// (no polling of the keys; only the list of nodes is looked at again every few seconds). Reading does not consume the key: the system still sees it, so the
        /// Samsung Home only stays out of the way while it is not running.
        /// </summary>
        private static void SetupInput(string[] args)
        {
            int code;
            string want = Arg(args, "--home-code") ?? Environment.GetEnvironmentVariable("TVLAUNCHER_HOME_CODE");
            if (want != null && int.TryParse(want, out code) && code > 0 && code < 768) _homeCode = code;
            _learn = Flag(args, "--learn");
            if (_homeCode < 0 && !_learn) return;

            WatchNewNodes();
            Log("home key code " + (_homeCode < 0 ? "not set" : _homeCode.ToString()) + (_learn ? ", learn mode (every key press is logged)" : ""));
            // The remote's nodes come and go: it reconnects after standby, and Vetro creates its forwarded-remote
            // node some time after this process started. A node that appears later is picked up here.
            _rescanTimer = Efl.ecore_timer_add(RescanSeconds, RescanCb, IntPtr.Zero);
        }

        /// <summary>Opens every remote node that is not being watched yet. Returns how many were added.</summary>
        private static int WatchNewNodes()
        {
            List<string> nodes;
            try { nodes = InputDevices.RemoteNodes(File.ReadAllText("/proc/bus/input/devices")); }
            catch (Exception ex) { Log("input: cannot list devices: " + ex.Message); return 0; }
            int added = 0;
            foreach (string node in nodes)
            {
                if (_inputPaths.Contains(node)) continue;
                int fd = Libc.open(node, Libc.O_RDONLY | Libc.O_NONBLOCK);
                if (fd < 0) { Log("input: cannot open " + node + " errno=" + Marshal.GetLastWin32Error()); continue; }
                int index = _inputFds.Count;
                IntPtr handler = Efl.ecore_main_fd_handler_add(fd, Efl.EcoreFdRead, InputCb, (IntPtr)index, IntPtr.Zero, IntPtr.Zero);
                _inputFds.Add(fd);
                _inputReaders.Add(new EvdevReader());
                _inputPaths.Add(node);
                _inputHandlers.Add(handler);
                added++;
                Log("input: watching " + node);
            }
            return added;
        }

        private static byte OnRescan(IntPtr data)
        {
            try { WatchNewNodes(); }
            catch (Exception ex) { Log("input: rescan: " + ex.Message); }
            return 1;
        }

        /// <summary>A node that was unplugged (the remote went to sleep) stops being watched; it is opened again when it returns.</summary>
        private static void DropNode(int index)
        {
            if (_inputFds[index] < 0) return;
            Log("input: lost " + _inputPaths[index]);
            if (_inputHandlers[index] != IntPtr.Zero) Efl.ecore_main_fd_handler_del(_inputHandlers[index]);
            Libc.close(_inputFds[index]);
            _inputFds[index] = -1;
            _inputHandlers[index] = IntPtr.Zero;
            _inputPaths[index] = null;
        }

        private static AppEntry[] LoadApps(string path) { return LoadList(path, Catalog.BuiltIn); }

        private static AppEntry[] LoadList(string path, Func<AppEntry[]> builtIn)
        {
            try
            {
                if (File.Exists(path))
                {
                    CatalogResult r = Catalog.Parse(File.ReadAllText(path));
                    foreach (string p in r.Problems) Log("apps: " + p);
                    if (r.Entries.Length > 0) return r.Entries;
                    Log("apps: " + path + " has no usable entries");
                }
                else Log("apps: " + path + " not found, using the built-in list");
            }
            catch (Exception ex) { Log("apps: " + ex.Message); }
            return builtIn();
        }

        // ------------------------------------------------------------------ show / hide

        private static void ShowDock()
        {
            // A dock that was closed from the inputs panel opens on the apps again.
            if (_ctl != _appsCtl && !_ctl.IsActive) ActivatePage(_appsCtl, _appsDock);
            if (!_ctl.Show()) { ResetIdle(); return; }
            Efl.evas_object_show(_win);
            Efl.elm_win_activate(_win);
            StartClock();
            StartAnimator();
            ResetIdle();
        }

        private static void HideDock()
        {
            CancelIdle();
            StopClock();
            if (_ctl.Hide()) StartAnimator();
        }

        // ------------------------------------------------------------------ pages

        private static void ActivatePage(Controller ctl, Dock dock)
        {
            if (ctl == _ctl) return;
            _dock.SetVisible(false);
            dock.SetVisible(true);
            _ctl = ctl;
            _dock = dock;
        }

        /// <summary>Moves to another page of a visible dock; it rises in over the previous one.</summary>
        private static void SelectPage(Controller ctl, Dock dock)
        {
            if (ctl == _ctl) return;
            ctl.AdoptVisibility(_ctl, 0.55f);
            ActivatePage(ctl, dock);
            _dock.Apply(_ctl);
            StartAnimator();
            ResetIdle();
        }

        private static void OpenInputs()
        {
            int current = -1, type;
            // The firmware keeps the active input here (Vetro's TV state sensor reads the same key).
            if (Efl.vconf_get_int("memory/system/source_type", out type) == 0)
                for (int i = 0; i < _inputs.Length; i++) if (_inputs[i].SourceType == type) { current = i; break; }
            _inputsDock.CurrentIndex = current;
            _inputsCtl.SetFocus(current >= 0 ? current : 0);
            Log("inputs panel, source_type=" + type + " current=" + current);
            SelectPage(_inputsCtl, _inputsDock);
        }

        // ------------------------------------------------------------------ clock

        private static string ClockText() { return DateTime.Now.ToString("HH:mm"); }

        /// <summary>
        /// Shows the time and arms one timer for the next minute change. It runs only while the dock
        /// is on screen: nothing ticks while the dock is hidden.
        /// </summary>
        private static void StartClock()
        {
            string t = ClockText();
            _appsDock.SetClock(t);
            _inputsDock.SetClock(t);
            if (_clockTimer != IntPtr.Zero) Efl.ecore_timer_del(_clockTimer);
            DateTime now = DateTime.Now;
            double wait = 60.0 - now.Second - now.Millisecond / 1000.0 + 0.05;
            _clockTimer = Efl.ecore_timer_add(wait, ClockCb, IntPtr.Zero);
        }

        private static void StopClock()
        {
            if (_clockTimer == IntPtr.Zero) return;
            Efl.ecore_timer_del(_clockTimer);
            _clockTimer = IntPtr.Zero;
        }

        private static byte OnClock(IntPtr data)
        {
            _clockTimer = IntPtr.Zero;   // returning 0 makes ecore free the timer
            try
            {
                if (_ctl.IsActive) { StartClock(); _dock.Apply(_ctl); }
            }
            catch (Exception ex) { Log("clock: " + ex.Message); }
            return 0;
        }

        private static void StartAnimator()
        {
            if (_anim != IntPtr.Zero) return;
            _lastFrame = Efl.ecore_time_get() - 1.0 / 60.0;
            _anim = Efl.ecore_animator_add(AnimCb, IntPtr.Zero);
        }

        private static void ResetIdle()
        {
            if (_idle == IntPtr.Zero) _idle = Efl.ecore_timer_add(Controller.IdleHideSeconds, IdleCb, IntPtr.Zero);
            else Efl.ecore_timer_reset(_idle);
        }

        private static void CancelIdle()
        {
            if (_idle == IntPtr.Zero) return;
            Efl.ecore_timer_del(_idle);
            _idle = IntPtr.Zero;
        }

        // ------------------------------------------------------------------ callbacks (never let an exception cross into native code)

        private static byte OnFrame(IntPtr data)
        {
            try
            {
                long t0 = _perf ? Stopwatch.GetTimestamp() : 0;
                double now = Efl.ecore_time_get();
                double dt = now - _lastFrame;
                bool more = _ctl.Tick(dt);
                _lastFrame = now;
                _dock.Apply(_ctl);
                if (_ctl.Phase == Phase.Hidden) Efl.evas_object_hide(_win);
                if (_perf) PerfSample(dt, (Stopwatch.GetTimestamp() - t0) * 1000.0 / Stopwatch.Frequency, !more);
                if (more) return 1;
            }
            catch (Exception ex) { Log("frame: " + ex); }
            _anim = IntPtr.Zero;   // returning 0 makes ecore free the animator
            return 0;
        }

        // ------------------------------------------------------------------ --perf: frame-time probe (off by default)

        // Per animation: how far apart the frames really are (vsync is 16.7 ms) and how long our own callback took.
        // Preallocated, so measuring does not allocate; one log line when the animation ends.
        private static bool _perf;
        private static string _perfWhy = "?";
        private static int _perfN;
        private static readonly double[] PerfDt = new double[2048], PerfWork = new double[2048];

        private static void PerfSample(double dt, double workMs, bool last)
        {
            if (_perfN < PerfDt.Length) { PerfDt[_perfN] = dt * 1000.0; PerfWork[_perfN] = workMs; _perfN++; }
            if (!last) return;
            // The first frame's dt is made up (the animator has just been created): left out of the intervals.
            double min = double.MaxValue, max = 0, sum = 0, wmax = 0, wsum = 0; int over = 0, n = 0, worst = 0;
            for (int i = 0; i < _perfN; i++)
            {
                if (PerfWork[i] > wmax) wmax = PerfWork[i];
                wsum += PerfWork[i];
                if (i == 0) continue;
                double d = PerfDt[i];
                if (d < min) min = d;
                if (d > max) { max = d; worst = i; }
                if (d > 30.0) over++;
                sum += d; n++;
            }
            Log(string.Format(System.Globalization.CultureInfo.InvariantCulture,
                "perf {0}: frames={1} interval ms min/avg/max={2:0.0}/{3:0.0}/{4:0.0} over30ms={5} (worst at frame {8}) work ms avg/max={6:0.00}/{7:0.00}",
                _perfWhy, _perfN, n > 0 ? min : 0, n > 0 ? sum / n : 0, max, over, _perfN > 0 ? wsum / _perfN : 0, wmax, worst));
            _perfN = 0;
        }

        // By default a client waits on the output's real vblank. On this TV that tick follows the content on screen: 50/s
        // over 50 Hz live TV, 60/s over a 60 Hz source (counters in `tdm-monitor -vblank_list`, measured). Over a 60 Hz
        // source the dock then sees a steady 16.7 ms. Asking tdm-monitor for another rate swaps in a millisecond timer
        // that is not tied to the vsync (62 -> 16.1 ms with jitter, beating against 60 Hz). So the default is off (0);
        // --vblank-fps N (30..120) stays for experiments. Samsung's own tdm-monitor sets it for this process only and
        // the setting goes away with the process.
        private static int _vblankFps = 0;
        private static readonly Efl.TaskCb FpsCb = OnFps;

        // The client vblank only exists once an animator has run, so one frame is run at start (the window is mapped
        // then) and the rate is set right after it.
        private static byte OnFps(IntPtr data)
        {
            try
            {
                // Both numbers are integers made here: nothing from outside reaches the command line.
                int rc = Libc.system("/usr/bin/tdm-monitor -vblank_fps " + Libc.getpid() + "@" + _vblankFps + " >/dev/null 2>&1");
                Log("vblank " + _vblankFps + " fps for this process, rc=" + rc);
            }
            catch (Exception ex) { Log("vblank fps: " + ex.Message); }
            return 0;
        }

        // The very first map of the window (wayland surface, GL context, first buffer) takes ~90 ms, which used to land
        // inside the first entrance animation. The window is mapped once at start, fully transparent, and unmapped
        // half a second later unless the dock has been shown in the meantime.
        private static IntPtr _premapTimer;
        private static readonly Efl.TaskCb PremapCb = OnPremap;

        private static byte OnPremap(IntPtr data)
        {
            _premapTimer = IntPtr.Zero;
            try
            {
                if (_ctl.Phase == Phase.Hidden)
                {
                    _ctl.Reset();
                    _dock.Apply(_ctl);
                    Efl.evas_object_hide(_win);
                }
                Log("window pre-mapped and released");
            }
            catch (Exception ex) { Log("premap: " + ex.Message); }
            return 0;
        }

        private static byte OnIdle(IntPtr data)
        {
            _idle = IntPtr.Zero;   // returning 0 makes ecore free the timer
            try { HideDock(); } catch (Exception ex) { Log("idle: " + ex); }
            return 0;
        }

        private static void OnKey(IntPtr data, IntPtr evas, IntPtr obj, IntPtr eventInfo)
        {
            try
            {
                // Evas_Event_Key_Down starts with `const char *keyname`.
                string key = Marshal.PtrToStringAnsi(Marshal.ReadIntPtr(eventInfo));
                int index;
                switch (_ctl.Key(key, out index))
                {
                    case KeyAction.Moved:
                        _perfWhy = "move";
                        StartAnimator();
                        ResetIdle();
                        break;
                    case KeyAction.Launch:
                        Activate((_ctl == _appsCtl ? _apps : _inputs)[index]);
                        break;
                    case KeyAction.OpenPanel:
                        OpenInputs();
                        break;
                    case KeyAction.Back:
                        SelectPage(_appsCtl, _appsDock);
                        break;
                    case KeyAction.Hide:
                        if (key == "XF86Home") _lastHome = Efl.ecore_time_get();
                        HideDock();
                        break;
                }
            }
            catch (Exception ex) { Log("key: " + ex); }
        }

        private static byte OnFifo(IntPtr data, IntPtr handler)
        {
            try
            {
                for (int round = 0; round < 8; round++)
                {
                    long n = (long)Libc.read(_fifoFd, ReadBuf, (UIntPtr)ReadBuf.Length);
                    if (n <= 0) break;
                    foreach (Command c in Commands.Feed(ReadBuf, (int)n))
                    {
                        Log("command " + c);
                        switch (c)
                        {
                            case Command.Show: _perfWhy = "fifo-show"; ShowDock(); break;
                            case Command.Hide: _perfWhy = "fifo-hide"; HideDock(); break;
                            case Command.Toggle: _perfWhy = "fifo-toggle"; if (_ctl.IsActive) HideDock(); else ShowDock(); break;
                        }
                    }
                }
            }
            catch (Exception ex) { Log("fifo: " + ex); }
            return 1;
        }

        private static byte OnInput(IntPtr data, IntPtr handler)
        {
            try
            {
                int index = (int)data;
                if (index < 0 || index >= _inputFds.Count || _inputFds[index] < 0) return 1;
                for (int round = 0; round < 8; round++)
                {
                    long n = (long)Libc.read(_inputFds[index], InputBuf, (UIntPtr)InputBuf.Length);
                    if (n < 0 && Marshal.GetLastWin32Error() != EAgain) { DropNode(index); break; }
                    if (n <= 0) break;
                    InputPresses.Clear();
                    _inputReaders[index].Feed(InputBuf, (int)n, InputPresses);
                    for (int k = 0; k < InputPresses.Count; k++)
                    {
                        int code = InputPresses[k];
                        if (_learn) Log("key code " + code);
                        if (code != _homeCode) continue;
                        double now = Efl.ecore_time_get();
                        // The focused dock also gets XF86Home through evas and hides itself: count it once.
                        if (now - _lastHome < HomeDebounceSeconds) continue;
                        _lastHome = now;
                        _perfWhy = "home";
                        if (_ctl.IsActive) HideDock(); else ShowDock();
                        ArmGuard();
                    }
                }
            }
            catch (Exception ex) { Log("input: " + ex); }
            return 1;
        }

        private static void ArmGuard()
        {
            if (_guardCmd == null) return;
            try { Libc.system(_guardCmd); }   // returns at once: the shell puts the whole chain in the background
            catch (Exception ex) { Log("guard: " + ex.Message); }
        }

        /// <summary>The app id is plain id characters (checked at start), so it is safe on a command line.</summary>
        private static string GuardCommand(string appId)
        {
            string kill = "/usr/bin/app_launcher -k " + appId;
            var sb = new System.Text.StringBuilder("( sleep " + GuardFirst.ToString("0.0##", System.Globalization.CultureInfo.InvariantCulture) + "; " + kill);
            foreach (double gap in GuardGaps) sb.Append("; sleep ").Append(gap.ToString("0.0##", System.Globalization.CultureInfo.InvariantCulture)).Append("; ").Append(kill);
            return sb.Append(" ) >/dev/null 2>&1 &").ToString();
        }

        // ------------------------------------------------------------------ launching

        private static bool SendLaunch(string appId)
        {
            IntPtr ac;
            if (Efl.app_control_create(out ac) != 0) return false;
            try
            {
                Efl.app_control_set_app_id(ac, appId);
                return Efl.app_control_send_launch_request(ac, IntPtr.Zero, IntPtr.Zero) == 0;
            }
            finally { Efl.app_control_destroy(ac); }
        }

        /// <summary>OK on an entry: open a page, switch input, or launch; everything but a page closes the dock.</summary>
        private static void Activate(AppEntry e)
        {
            if (e.Panel != null)
            {
                if (e.Panel == "inputs") OpenInputs(); else Log("unknown panel " + e.Panel);
                return;
            }
            if (e.SourceType >= 0) SwitchSource(e); else Launch(e);
            HideDock();
        }

        private const string SourceIconDir = "/usr/apps/com.samsung.tv.theme-resource/shared/res/org.tizen.menu/Settings_Popup/device_icon/";

        /// <summary>
        /// Switches input the way Samsung's own Source tile does (CompSource, SourceChangeViaTVViewer):
        /// a launch request to tv-viewer carrying the input number. tv-viewer refuses a missing icon,
        /// so the firmware's own device icon is passed along.
        /// </summary>
        private static void SwitchSource(AppEntry e)
        {
            IntPtr ac = IntPtr.Zero;
            try
            {
                if (Efl.app_control_create(out ac) != 0) { Log("source: app_control_create failed"); return; }
                string n = e.SourceType.ToString();
                string icon = SourceIconDir + (e.SourceType >= 13 && e.SourceType <= 16 ? "r_icon_device_s_hdmi" + (e.SourceType - 12) : "r_icon_device_s_tv") + ".png";
                Efl.app_control_set_app_id(ac, "org.tizen.tv-viewer");
                Efl.app_control_add_extra_data(ac, "change_source", n);
                Efl.app_control_add_extra_data(ac, "sourceType", n);
                Efl.app_control_add_extra_data(ac, "sourceName", e.Label);
                Efl.app_control_add_extra_data(ac, "sourceIcon", icon);
                Efl.app_control_add_extra_data(ac, "mbrIndex", "-2");   // SourceMbrActivityIndex.Invalid: no external-device profile
                Efl.app_control_add_extra_data(ac, "__K_EX_LAUNCH_REQUESTOR", "user");
                int rc = Efl.app_control_send_launch_request(ac, IntPtr.Zero, IntPtr.Zero);
                Log("source " + e.Label + " (" + n + ") rc=" + rc);
            }
            catch (Exception ex) { Log("source error: " + ex.Message); }
            finally { if (ac != IntPtr.Zero) Efl.app_control_destroy(ac); }
        }

        private const string KeyTool = "/usr/bin/input_keyevent ";
        private static readonly Efl.TaskCb KeyTimerCb = OnKeyTimer;
        private static AppEntry _pendingKey;

        // A remote key is sent only once our window is gone: while it is still mapped it would
        // take the key itself. One-shot timer, so nothing runs while the dock is idle.
        private static byte OnKeyTimer(IntPtr data)
        {
            AppEntry e = _pendingKey;
            _pendingKey = null;
            try
            {
                if (e == null) return 0;
                int rc = Libc.system(KeyTool + e.Key);   // Key is letters and digits only (Catalog.IsKeyName)
                Log("key " + e.Key + " rc=" + rc);
                if (rc != 0 && e.AppId != null) LaunchApp(e);
            }
            catch (Exception ex) { Log("key timer: " + ex.Message); }
            return 0;
        }

        private static void Launch(AppEntry e)
        {
            if (e.Key != null)
            {
                _pendingKey = e;
                Efl.ecore_timer_add(0.30, KeyTimerCb, IntPtr.Zero);
                return;
            }
            LaunchApp(e);
        }

        private static void LaunchApp(AppEntry e)
        {
            try
            {
                if (e.KillFirst != null && e.AppId != null)
                {
                    // Close the other app first, then start this one: one detached shell, so the dock does not wait.
                    // Both ids are plain Tizen ids (Catalog.ValidAppId), safe on a command line.
                    int rc = Libc.system("( /usr/bin/app_launcher -k " + e.KillFirst + "; sleep 0.4; /usr/bin/app_launcher -s " + e.AppId + " ) >/dev/null 2>&1 &");
                    Log("launch " + e.AppId + " after closing " + e.KillFirst + " rc=" + rc);
                    return;
                }
                if (e.AppId == "com.samsung.tv.csfs")
                {
                    // Samsung's Home ignores a plain app-control request from here (logged as launched, never shown);
                    // the platform's own launcher starts it.
                    Log("launch " + e.AppId + " rc=" + Libc.system("/usr/bin/app_launcher -s " + e.AppId + " >/dev/null 2>&1 &"));
                    return;
                }
                if (SendLaunch(e.AppId)) { Log("launch " + e.AppId); return; }
                Log("launch failed: " + e.AppId);
                if (e.FallbackAppId != null && SendLaunch(e.FallbackAppId)) { Log("launch " + e.FallbackAppId + " (fallback)"); return; }
                // Last resort: the platform's command line launcher.
                Process.Start(new ProcessStartInfo("/usr/bin/app_launcher", "-s " + (e.FallbackAppId ?? e.AppId)) { UseShellExecute = false });
                Log("launch via app_launcher: " + (e.FallbackAppId ?? e.AppId));
            }
            catch (Exception ex) { Log("launch error: " + ex.Message); }
        }

        // ------------------------------------------------------------------ warm-up

        /// <summary>
        /// Runs each page through a show, a move right and back, and a hide while the window is still unmapped,
        /// so the JIT has compiled the animation, layout and drawing paths before the first real show. Without
        /// it the very first Home press pays for compiling them in the middle of the entrance animation.
        /// </summary>
        private static void WarmUp()
        {
            long t0 = Stopwatch.GetTimestamp();
            Controller[] ctls = { _appsCtl, _inputsCtl };
            Dock[] docks = { _appsDock, _inputsDock };
            for (int p = 0; p < ctls.Length; p++)
            {
                Controller c = ctls[p]; Dock d = docks[p];
                int idx;
                c.Show();
                WarmFrames(c, d, 18);
                c.Key("Right", out idx);
                WarmFrames(c, d, 24);
                c.Key("Left", out idx);
                WarmFrames(c, d, 24);
                c.Hide();
                WarmFrames(c, d, 14);
                c.Reset();
            }
            Log("warm-up " + ((Stopwatch.GetTimestamp() - t0) * 1000.0 / Stopwatch.Frequency).ToString("0") + " ms");
        }

        private static void WarmFrames(Controller c, Dock d, int frames)
        {
            for (int i = 0; i < frames; i++) { c.Tick(1.0 / 60.0); d.Apply(c); }
        }

        // ------------------------------------------------------------------ entry point

        /// <summary>
        /// <c>--get-home</c>: prints which app the TV launches for the Home key and exits. A read-only look
        /// at the default Home, to see whether the platform answers this call on a given TV.
        /// </summary>
        private static int GetHome()
        {
            try
            {
                IntPtr id;
                int rc = Efl.app_operation_get_current_app("http://tizen.org/appcontrol/operation/main", out id);
                Console.WriteLine("rc=" + rc);
                Console.WriteLine("home=" + (id == IntPtr.Zero ? "(null)" : Marshal.PtrToStringAnsi(id)));
                return rc == 0 ? 0 : 1;
            }
            catch (Exception ex) { Console.WriteLine("get-home failed: " + ex.Message); return 2; }
        }

        private static int Main(string[] args)
        {
            if (Flag(args, "--get-home")) return GetHome();
            _perf = Flag(args, "--perf");
            _dir = ResolveDir(args);
            _logPath = Path.Combine(_dir, "tvlauncher.log");
            _pidPath = Path.Combine(_dir, "tvlauncher.pid");
            _fifoPath = Path.Combine(_dir, "tvlauncher.fifo");
            TrimLog();

            if (!AcquireInstance()) return 0;
            AppDomain.CurrentDomain.ProcessExit += (s, e) => CleanupFiles();

            try
            {
                string engine = SetupEnvironment();
                Log("start pid=" + Libc.getpid() + " uid=" + Libc.getuid() + " engine=" + engine);

                Efl.elm_init(0, IntPtr.Zero);
                _win = Efl.elm_win_add(IntPtr.Zero, "tvlauncher", Efl.ElmWinNotification);
                if (_win == IntPtr.Zero) { Log("elm_win_add failed"); return 2; }

                int sx, sy, sw, sh;
                Efl.elm_win_screen_size_get(_win, out sx, out sy, out sw, out sh);
                int screenW = DefaultScreenW, screenH = DefaultScreenH;
                string forced = Arg(args, "--screen");
                if (forced != null)
                {
                    string[] wh = forced.Split('x');
                    int fw, fh;
                    if (wh.Length == 2 && int.TryParse(wh[0], out fw) && int.TryParse(wh[1], out fh)) { screenW = fw; screenH = fh; }
                }
                // The compositor works in 1920x1080 on the Q80A even though the panel is 4K; the
                // size it reports is logged so a different model can be spotted and overridden.
                Log("screen reported " + sw + "x" + sh + ", layout " + screenW + "x" + screenH);

                _apps = LoadApps(Arg(args, "--apps") ?? Path.Combine(AppContext.BaseDirectory, "res", "apps.tsv"));
                _inputs = LoadList(Arg(args, "--inputs") ?? Path.Combine(AppContext.BaseDirectory, "res", "inputs.tsv"), Catalog.BuiltInInputs);
                // One window for both pages: as wide as the wider of the two, the other is centred in it.
                int windowW = Math.Max(new DockLayout(_apps.Length, screenW, screenH).WinW, new DockLayout(_inputs.Length, screenW, screenH).WinW);
                var layout = new DockLayout(_apps.Length, screenW, screenH, windowW, false, Catalog.GroupStart(_apps));
                var inputsLayout = new DockLayout(_inputs.Length, screenW, screenH, windowW, true, -1);
                _appsCtl = new Controller(layout) { PanelEnabled = true };
                _inputsCtl = new Controller(inputsLayout, PageKind.Panel);
                _ctl = _appsCtl;

                Efl.elm_win_title_set(_win, "tvlauncher");
                Efl.elm_win_alpha_set(_win, true);
                Efl.elm_win_borderless_set(_win, true);
                Efl.elm_win_prop_focus_skip_set(_win, false);
                int level = Efl.efl_util_set_notification_window_level(_win, NotificationLevelTop);
                Efl.elm_win_layer_set(_win, WindowLayer);
                // Without this hint the compositor may ignore our geometry for a notification window.
                Efl.elm_win_aux_hint_add(_win, "wm.policy.win.user.geometry", "1");
                Efl.elm_win_aux_hint_add(_win, "wm.comp.win.effect.enable", "0");
                Efl.evas_object_move(_win, layout.WinX, layout.WinY);
                Efl.evas_object_resize(_win, layout.WinW, layout.WinH);
                Log("window " + layout.WinW + "x" + layout.WinH + " at " + layout.WinX + "," + layout.WinY + " notification-level=" + level);

                string res = Path.Combine(AppContext.BaseDirectory, "res");
                string dumpIcons = Arg(args, "--dump-icons");
                if (dumpIcons != null && Directory.Exists(dumpIcons)) Dock.DumpIconsTo = dumpIcons;
                _appsDock = new Dock(_win, layout, _apps, res, Log, Design.HintText, true);
                _appsDock.Build();
                _inputsDock = new Dock(_win, inputsLayout, _inputs, res, Log, "Back", false);
                _inputsDock.Build();
                _inputsDock.SetVisible(false);
                _dock = _appsDock;
                if (!Flag(args, "--no-warmup")) WarmUp();
                _appsDock.Apply(_appsCtl);
                _inputsDock.Apply(_inputsCtl);
                Log("engine in use: " + (Efl.EngineName(_dock.Evas) ?? "unknown") + ", " + _apps.Length + " apps, " + _inputs.Length + " inputs, "
                    + (_appsDock.MissingIcons + _inputsDock.MissingIcons) + " icons missing");

                Efl.evas_object_event_callback_add(_win, Efl.EvasCallbackKeyDown, KeyCb, IntPtr.Zero);
                SetupFifo();
                string guard = Arg(args, "--kill-on-home");
                if (guard != null)
                {
                    if (Catalog.ValidAppId(guard)) { _guardApp = guard; _guardCmd = GuardCommand(guard); Log("guard: " + guard + " is closed after each Home press: " + _guardCmd); }
                    else Log("guard: bad app id ignored");
                }
                SetupInput(args);

                string fpsArg = Arg(args, "--vblank-fps");
                int fps;
                if (fpsArg != null && int.TryParse(fpsArg, out fps) && (fps == 0 || (fps >= 30 && fps <= 120))) _vblankFps = fps;
                if (_vblankFps > 0 && File.Exists("/usr/bin/tdm-monitor")) Efl.ecore_animator_add(FpsCb, IntPtr.Zero);
                Log("animator frame time " + (Efl.ecore_animator_frametime_get() * 1000.0).ToString("0.0", System.Globalization.CultureInfo.InvariantCulture) + " ms");
                if (!Flag(args, "--hidden")) ShowDock();
                else if (!Flag(args, "--no-premap"))
                {
                    _appsCtl.HoldFaint(0.012f);   // about 1% opacity: invisible, but drawn, so the shaders get compiled now
                    _appsDock.Apply(_appsCtl);
                    Efl.evas_object_show(_win);
                    if (Flag(args, "--premap-activate")) Efl.elm_win_activate(_win);
                    _premapTimer = Efl.ecore_timer_add(0.5, PremapCb, IntPtr.Zero);
                }

                GC.Collect();
                GC.WaitForPendingFinalizers();
                Log("elm_run");
                Efl.elm_run();
                Log("elm_run returned");
                Efl.elm_shutdown();
            }
            catch (Exception ex)
            {
                Log("fatal: " + ex);
                return 1;
            }
            return 0;
        }
    }
}
