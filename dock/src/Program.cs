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

        private static string _dir, _logPath, _pidPath, _fifoPath, _longpressPath;
        private static IntPtr _win, _anim, _idle, _fifoHandler;
        private static int _fifoFd = -1;
        private static double _lastFrame;
        private static AppEntry[] _apps, _inputs, _allApps;
        // Where the three lists were read from, to read them again when Vetro says "reload"; _allAppsWatch is the All apps list Vetro wrote
        // (--all-apps), whose date says whether it is older than the package database (ListWatch). Null when Vetro passed none.
        private static string _appsPath, _inputsPath, _allAppsPath, _allAppsWatch;
        private static bool _reloadPending;
        private static DateTime _listsAskedFor = DateTime.MinValue;
        private static double _listsAskedAt, _listsCheckedAt = -100;
        // Three pages share one window: the apps row, the inputs panel (Up) and All apps (its pill). _ctl / _dock always
        // point at the page on screen, so everything below works on "the dock" as before.
        private static Controller _ctl, _appsCtl, _inputsCtl, _allCtl;
        private static Dock _dock, _appsDock, _inputsDock, _allDock;
        private static string _res;
        private static int _screenW = DefaultScreenW, _screenH = DefaultScreenH;
        private static IntPtr _clockTimer;
        private static readonly Efl.TaskCb ClockCb = OnClock;

        // The Control center (Down from the apps row): up to three cards side by side (the Task manager, the Audio output), its own page,
        // drawn in its own window while it is open so the Dock window is never resized while mapped. _tasksOn: the Control center is the page
        // on screen. Every card has its own controller (selection, scroll); they open, fade and close together. _cardFocus is the card Left
        // and Right have moved to.
        private static IntPtr _taskWin, _taskRecycleTimer;
        private static readonly Efl.TaskCb TaskRecycleCb = OnTaskWindowRecycle;
        private static long _lastAvailableKb = -1;
        private static List<OutputEntry> _lastAudioEntries;
        private static string _lastAudioNote = "";
        private static ChoiceState[] _lastChoiceStates = new ChoiceState[0];
        private static DockLayout _appsLayout;
        private static TaskLayout _taskLayout;
        private static CardSpec[] _cards = new CardSpec[0];
        private static int _cardFocus;
        // The controller of the card at each position; the Task manager's and the Audio output's are also kept by name (their own code uses them).
        private static TaskController[] _cardCtl = new TaskController[0];
        private static TaskController _tasksCtl, _audioCtl;
        private static TaskPanel _taskPanel;
        private static AudioCard _audioCard;
        // The choice cards (Picture mode, Sleep timer, a Shard's card: there may be several of those) and what reads them, by position;
        // null at the positions of the other cards.
        private static ChoiceCard[] _choiceCards = new ChoiceCard[0];
        private static ChoiceSource[] _choiceSrcs = new ChoiceSource[0];
        private static TaskSource _taskSource;
        private static bool _tasksOn;
        private static List<RunningApp> _taskApps = new List<RunningApp>();
        private static IntPtr _taskPoll, _taskRefresh;
        private static readonly Efl.TaskCb TaskPollCb = OnTaskPoll;
        private static readonly Efl.TaskCb TaskRefreshCb = OnTaskRefresh;
        private const double TaskRefreshSeconds = 1.5;
        // OK on the task page: a tap opens the selected app, holding it closes the app.
        private static readonly HoldKey TaskOk = new HoldKey();
        private static RunningApp _taskOkApp;
        private static IntPtr _taskOkTimer;
        private static readonly Efl.TaskCb TaskOkHoldCb = OnTaskOkHold;
        private static readonly Efl.EvasCb KeyUpCb = OnKeyUp;
        private static readonly List<int> InputReleases = new List<int>();
        private const int RawOkCode = 28;   // KEY_ENTER, the code NavigationInput maps to Return
        private const int RawBackCode = 1;  // KEY_ESC, the code NavigationInput maps to XF86Back
        private static readonly CommandBuffer Commands = new CommandBuffer();
        private static readonly byte[] ReadBuf = new byte[128];

        // Remote-control input (read-only evdev, never grabbed): the Home key toggles the dock.
        private const double HomeDebounceSeconds = 0.35;
        // The raw press (evdev) opens the dock at once. The system holds Home to tell a short press from a long one
        // and only then delivers XF86Home to the focused window, which is now the dock: on 2025 firmware that echo
        // comes about 0.6 s later, well past the debounce. An XF86Home this soon after the raw press is the same
        // press, not a request to close.
        private const double HomeEchoSeconds = 1.5;

        // --kill-on-home APPID[,APPID...]: the system sends Home to Samsung's own home app as well (it is relaunched
        // by the key), so after each Home press the app is closed again, a few times because its start is slow.
        // 2025 (RSM/CoBA) firmware splits Home into csfs plus separate sidebar and media windows that stay on top of
        // the dock when only csfs is closed, so several ids may be given. Off by default; every id is checked as
        // plain id characters because it goes on a command line.
        // One process: a single shell runs every sleep and every kill (at 0.15, 0.45, 0.9, 1.6 and 2.8 s after the
        // press, as before), so the dock itself spawns once per Home press instead of five times from the loop.
        private static string[] _guardApps;
        // The kills are tied to a generation written to a file: each Home press arms a new one, and launching the guarded
        // app on purpose (the Samsung Home pill) retires it. Without that, Samsung Home started 1-2 s after a Home press
        // was closed again by the kills still pending, and the pill seemed to do nothing.
        private static int _guardGen;
        private static int _dismissRestoreGen;
        private static string _guardFile;
        private static string _dismissRestoreFile;
        private static readonly GuardedHomeCloseTracker _closeTracker = new GuardedHomeCloseTracker();
        private const double AppHomeProtectSeconds = 2.5;
        private static int _homeCode = -1;
        // --claim-home (#184; idea and first version by chemicalsno, tried on a QN90D): the window claims XF86Home at the compositor
        // (Tizen keyrouter, exclusive grab), so the key no longer reaches Samsung's Home (csfs registers it in its manifest), which came
        // up for a moment before the dock on every press until the guard closed it. On the Q80A the claimed key reaches this process while
        // the window is hidden, but only as an ecore_input event (evas drops it), so ecore's key events are watched too (WatchEcoreKeys):
        // a Home from another source (sent by name, the phone app, CEC) then opens the dock. The claim is made only after the input reader
        // has answered a real press, at that press's ShowDock: a TV whose reader does not hear the remote keeps Samsung's Home on the key.
        // The first press after each start still shows Samsung's Home for a moment (the guard closes it). The
        // guard stays armed: on a firmware where Samsung's Home still starts, it is closed as before. The claim belongs to this process's
        // Wayland connection, so when the launcher exits Samsung's Home gets the key again. While it is granted, tvlauncher.homeclaim
        // holds this process's pid and the service sends its own Home down the FIFO (key-routing.js). A Home that reaches the hidden
        // window (WindowHome) is the echo of the press the reader answered, or a press of its own.
        private static bool _claimHome, _claimTried, _homeClaimed, _rawHomeSeen;
        private static string _claimPath, _claimVerifiedPath;
        private const int KeygrabExclusive = 1 << 10;   // ELM_WIN_KEYGRAB_EXCLUSIVE
        // --home-launch APPID: the custom launcher mode. The Home key opens that app instead of the dock, and the dock
        // itself is never shown. Samsung's Home is NOT disabled in this mode (the TV's boot waits for it): the guard below is what keeps it away.
        // The id is checked as plain id characters (Catalog.ValidAppId) because it goes on a command line.
        private static AppEntry _homeLaunch;

        private static readonly NavigationInput Navigation = new NavigationInput();
        private static double _lastRawHome = -100;
        private static AppEntry _pendingLaunch;
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

        private static IdleConfig _idleConfig;
        private static IdleBackdropModel _idleModel;
        private static IdleBackdropWindow _idleWin;
        private static WmStackController _wmStack;
        private static readonly ScreensaverPulseFilter _screensaverFilter = new ScreensaverPulseFilter();
        private static bool _samsungHomeRequested, _samsungHomeObserved, _tvPlusActive, _lastRawScreensaver;
        private static double _samsungHomeRequestedUntil, _pendingTvSourceUntil, _fastIdleWatchUntil, _backHoldFastUntil, _nextSteadyStackCheckAt;
        private const double SteadyStackCheckSeconds = 15.0;
        private static string _lastPartialApp = "", _lastFullApp = "";
        private static string _lastPausedAppId = "";
        private static string _lastForceClosedAppId = "";
        private static bool _lastTunerActive;
        private static double _lastTunerCheckMono = -100.0;
        private static string _fifoReadyPath;
        private static IntPtr _idleWatchTimer, _idleLcdVerifyTimer, _screensaverKeepaliveTimer, _screensaverWakeReleaseTimer, _syncBackTimer, _elmRunStartTimer, _backPrewarmTimer, _backHoldTimer, _backForceCloseTimer, _deferredForceCloseTimer;
        private static bool _wasScreensaverTakeoverActive, _screensaverWakePendingRelease;
        private static string _deferredForceCloseApp = "";
        private static int _deferredForceCloseGen;
        private static bool _deferredForceCloseWasLaunching;
        private static int _deferredForceCloseLaunchEpoch;
        private static int _launchEpoch;
        private static string _lastLaunchTargetApp = "";
        private static int _backHoldCode;
        private static bool _vconfFullscreenSubscribed;
        private static bool _vconfScreensaverSubscribed;
        private static int _vconfWakePending;
        private static int _dismissHomeInFlight;
        private static double _idleWatchInterval;
        private static double _lastPollMono = -1;
        private static DateTime _lastPollUtc = DateTime.MinValue;
        private static bool _backClaimed, _exitClaimed, _longpressClaimed, _backClaimUnavailable, _ecoreKeysWatched;
        private static bool _wasDisplayOff, _inElmRun, _pendingArrivalDock;
        private static double _backReleaseUntil, _exitReleaseUntil, _launchBackClaimSuppressUntil, _arrivalBackShieldUntil;
        private static double _lastAppHomePress = -100, _lastExitForceCloseMono = -100;
        private static readonly object LongpressGate = new object();
        private static bool _longpressBusy, _longpressDesired, _longpressApplied;
        private static readonly Efl.TaskCb IdleWatchCb = OnIdleWatch;
        private static readonly Efl.TaskCb ScreensaverKeepaliveCb = OnScreensaverKeepalive;
        private static readonly Efl.TaskCb SyncBackCb = OnSyncBackTimer;
        private static readonly Efl.TaskCb ElmRunStartCb = OnElmRunStarted;
        private static readonly Efl.TaskCb BackPrewarmCb = OnBackPrewarm;
        private static readonly Efl.TaskCb BackHoldCb = OnBackHold;
        private static readonly Efl.TaskCb BackForceCloseCb = OnBackForceClose;
        private static readonly Efl.TaskCb DeferredForceCloseCb = OnDeferredForceClose;
        private static readonly Efl.VconfCb VconfFullscreenCb = OnVconfFullscreenChanged;
        private static readonly Efl.VconfCb VconfScreensaverCb = OnVconfScreensaverChanged;
        private static readonly Efl.MainLoopCb VconfMainLoopCb = OnVconfFullscreenMain;

        private const int EChild = 10;
        [DllImport("libc.so.6", EntryPoint = "system", SetLastError = true)]
        private static extern int SystemWithErrno(string command);

        private static bool SystemSucceeded(int rc, out int errno)
        {
            errno = rc == -1 ? Marshal.GetLastWin32Error() : 0;
            return rc == 0 || (rc == -1 && errno == EChild);
        }

        private static readonly Efl.TaskCb IdleLcdVerifyCb = OnIdleLcdVerify;
        private static readonly Func<string, bool> FileExistsFn = File.Exists;
        private static readonly Func<string, string> ReadTextFn = path => { try { return File.ReadAllText(path); } catch (Exception) { return ""; } };
        private static readonly Func<int, bool> PidAliveFn = pid => Directory.Exists("/proc/" + pid);

        private static bool IsDisplayOff()
        {
            int state;
            try { return Efl.vconf_get_int("memory/pm/state", out state) == 0 && state >= IdleBackdropModel.DisplayStateOff; }
            catch (Exception) { return false; }
        }

        private const string ScreensaverKey = "memory/window_system/screensaver_on_off";
        private static int _screensaverOverlayPid;
        private static int _screensaverScanInFlight;
        private static readonly byte[] ScreensaverCommBuf = new byte[32];
        private static bool _lastRealScreensaverActive;
        private static bool _lastColdBootSilentHome;
        private static readonly object ScreensaverActivityGate = new object();
        private static bool _screensaverActivityBusy;
        private static bool _screensaverActivityPending;
        private static bool _screensaverActivityDismiss;
        private static double _lastScreensaverActivityAt = -100.0;

        private static bool IsCachedScreensaverOverlayPidAlive(int pid)
        {
            if (pid <= 0) return false;
            try
            {
                if (Libc.kill(pid, 0) != 0) return false;
                string commPath = "/proc/" + pid.ToString(System.Globalization.CultureInfo.InvariantCulture) + "/comm";
                int fd = Libc.open(commPath, Libc.O_RDONLY);
                if (fd < 0) return false;
                try
                {
                    int n = (int)Libc.read(fd, ScreensaverCommBuf, (UIntPtr)ScreensaverCommBuf.Length);
                    if (n <= 0) return false;
                    string comm = System.Text.Encoding.ASCII.GetString(ScreensaverCommBuf, 0, n);
                    return IdleBackdropModel.IsScreensaverOverlayComm(comm);
                }
                finally
                {
                    Libc.close(fd);
                }
            }
            catch (Exception) { return false; }
        }

        private static bool HasScreensaverOverlayProcess()
        {
            int pid = System.Threading.Volatile.Read(ref _screensaverOverlayPid);
            if (pid <= 0) return false;
            if (IsCachedScreensaverOverlayPidAlive(pid)) return true;
            System.Threading.Interlocked.CompareExchange(ref _screensaverOverlayPid, 0, pid);
            return false;
        }

        private static int FindScreensaverOverlayPidBackground()
        {
            try
            {
                byte[] buf = new byte[32];
                foreach (string dir in Directory.EnumerateDirectories("/proc"))
                {
                    string name = Path.GetFileName(dir);
                    int pid;
                    if (!int.TryParse(name, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out pid) || pid <= 0)
                        continue;
                    int fd = Libc.open(dir + "/comm", Libc.O_RDONLY);
                    if (fd < 0) continue;
                    try
                    {
                        int n = (int)Libc.read(fd, buf, (UIntPtr)buf.Length);
                        if (n > 0 && IdleBackdropModel.IsScreensaverOverlayComm(System.Text.Encoding.ASCII.GetString(buf, 0, n)))
                            return pid;
                    }
                    finally { Libc.close(fd); }
                }
            }
            catch (Exception) { }
            return 0;
        }

        private static void StartBackgroundScreensaverProcScan()
        {
            if (System.Threading.Interlocked.CompareExchange(ref _screensaverScanInFlight, 1, 0) != 0) return;
            System.Threading.Tasks.Task.Run(() =>
            {
                try
                {
                    int foundPid = FindScreensaverOverlayPidBackground();
                    int[] delays = new[] { 150, 250, 400 };
                    for (int i = 0; i < delays.Length && foundPid <= 0; i++)
                    {
                        if (!ReadScreensaverVconfFlag()) break;
                        System.Threading.Thread.Sleep(delays[i]);
                        if (ReadScreensaverVconfFlag()) foundPid = FindScreensaverOverlayPidBackground();
                    }
                    if (foundPid > 0)
                    {
                        System.Threading.Volatile.Write(ref _screensaverOverlayPid, foundPid);
                        ScheduleAsyncIdlePoll();
                    }
                }
                catch (Exception) { }
                finally
                {
                    System.Threading.Volatile.Write(ref _screensaverScanInFlight, 0);
                }
            });
        }

        private static bool ReadScreensaverVconfFlag()
        {
            try
            {
                return IdleBackdropModel.ReadBoolOrInt(
                    (out int b) => Efl.vconf_get_bool(ScreensaverKey, out b) == 0,
                    (out int i) => Efl.vconf_get_int(ScreensaverKey, out i) == 0);
            }
            catch (Exception) { return false; }
        }

        private static bool IsScreensaverActive()
        {
            try
            {
                if (!ReadScreensaverVconfFlag())
                {
                    System.Threading.Volatile.Write(ref _screensaverOverlayPid, 0);
                    return false;
                }
                return HasScreensaverOverlayProcess();
            }
            catch (Exception) { return false; }
        }

        private static bool IsAnyRealScreensaverActive()
        {
            if (IsDisplayOff()) return false;
            if (_lastRealScreensaverActive
                || (_idleModel != null && _idleModel.HoldOcclusionForScreensaver)
                || (_wmStack != null && _wmStack.ScreensaverWinPresent))
            {
                return true;
            }
            string full = Efl.VconfGetString(FullscreenAppIdKey);
            if (IdleBackdropModel.IsScreensaverApp(full)) return true;
            return IsScreensaverActive();
        }

        private static void TriggerScreensaverActivityReset(double now, double minIntervalSeconds, bool dismissActive = false)
        {
            lock (ScreensaverActivityGate)
            {
                if (!dismissActive && minIntervalSeconds > 0.0 && (now - _lastScreensaverActivityAt) < minIntervalSeconds) return;
                _lastScreensaverActivityAt = now;
                if (dismissActive) _screensaverActivityDismiss = true;
                if (_screensaverActivityBusy)
                {
                    _screensaverActivityPending = true;
                    return;
                }
                _screensaverActivityBusy = true;
                _screensaverActivityPending = false;
            }
            System.Threading.Tasks.Task.Run(() =>
            {
                try
                {
                    while (true)
                    {
                        bool dismiss;
                        lock (ScreensaverActivityGate)
                        {
                            dismiss = _screensaverActivityDismiss;
                            _screensaverActivityDismiss = false;
                        }
                        try
                        {
                            if (!DbusBus.TryResetScreensaverActivity(dismiss))
                                Libc.system(IdleBackdropModel.BuildScreensaverActivityCommand());
                        }
                        catch (Exception) { }
                        lock (ScreensaverActivityGate)
                        {
                            if (!_screensaverActivityPending && !_screensaverActivityDismiss)
                            {
                                _screensaverActivityBusy = false;
                                return;
                            }
                            _screensaverActivityPending = false;
                        }
                    }
                }
                catch (Exception)
                {
                    lock (ScreensaverActivityGate) { _screensaverActivityBusy = false; _screensaverActivityPending = false; _screensaverActivityDismiss = false; }
                }
            });
        }

        private static void WakeOrResetScreensaverForUserAction(bool openingOverlay)
        {
            if (IsDisplayOff()) return;
            double now = Efl.ecore_time_get();
            if (IsAnyRealScreensaverActive())
            {
                _lastRealScreensaverActive = false;
                SyncBackClaim();
                _fastIdleWatchUntil = Math.Max(_fastIdleWatchUntil, now + 2.5);
                UpdateIdleWatchTimer(0.10);
                Log("idle: waking active screensaver for overlay");
                TriggerScreensaverActivityReset(now, 0.0, dismissActive: true);
                return;
            }
            TriggerScreensaverActivityReset(now, openingOverlay ? 0.25 : 1.5);
        }

        private static double ReadSystemUptimeSeconds()
        {
            try
            {
                string raw = ReadTextFn("/proc/uptime");
                if (string.IsNullOrEmpty(raw)) return 999999.0;
                int sp = raw.IndexOf(' ');
                string token = (sp > 0 ? raw.Substring(0, sp) : raw).Trim();
                double sec;
                return double.TryParse(token, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out sec) ? sec : 999999.0;
            }
            catch (Exception) { return 999999.0; }
        }

        private static bool ReadColdBootSilentHome(string fullApp, string partialApp)
        {
            if (!IdleBackdropModel.IsGuardedSamsungHome(fullApp) || !string.IsNullOrEmpty(partialApp)) return false;
            bool hasRootApp = File.Exists("/usr/bin/get_root_app");
            if (!hasRootApp || File.Exists("/tmp/firstscreen_done")) return false;
            double uptime = ReadSystemUptimeSeconds();
            if (uptime >= 60.0) return false;
            string showStatus = Efl.VconfGetString("memory/eden/show_status");
            int homeShown = 0;
            try { if (Efl.vconf_get_int("memory/avoc/home_shown", out homeShown) != 0) homeShown = 0; } catch (Exception) { homeShown = 0; }
            return IdleBackdropModel.IsColdBootSilentHome(fullApp, partialApp, hasRootApp, false, uptime, showStatus, homeShown);
        }

        private static string LongpressCommand(bool enable, int pid)
        {
            string method = enable ? "set_longpress_key_info" : "unset_longpress_key_info";
            return "dbus-send --system --reply-timeout=1500 --print-reply=literal --dest=keyrouter.dbus.server /com/burtonini/dbus/ping "
                + "wm.keyroutertv.longpress.info." + method + " string:\"XF86Back\" double:1.0 int32:"
                + pid.ToString(System.Globalization.CultureInfo.InvariantCulture) + " 2>/dev/null";
        }

        private static void WriteLongpressFile(int pid)
        {
            if (string.IsNullOrEmpty(_longpressPath)) return;
            try { File.WriteAllText(_longpressPath, pid.ToString(System.Globalization.CultureInfo.InvariantCulture)); }
            catch (Exception) { }
        }

        private static void RemoveLongpressFile()
        {
            if (string.IsNullOrEmpty(_longpressPath)) return;
            try { Libc.unlink(_longpressPath); }
            catch (Exception) { }
        }

        private static void ClearStaleLongpressClaims(string priorLongpress, string priorPid)
        {
            int[] stale = IdleBackdropModel.CollectStaleLongpressPids(Libc.getpid(), priorLongpress, priorPid);
            foreach (int oldPid in stale)
            {
                try
                {
                    if (!DbusBus.TrySetLongpressKeyInfo(false, "XF86Back", 1.0, oldPid))
                        Shell.Read(LongpressCommand(false, oldPid));
                    Log("idle: cleared stale longpress pid=" + oldPid);
                }
                catch (Exception) { }
            }
            RemoveLongpressFile();
        }

        private static void SyncLongpressClaim(bool want)
        {
            lock (LongpressGate)
            {
                _longpressDesired = want;
                if (_longpressBusy) return;
                _longpressBusy = true;
            }
            System.Threading.Tasks.Task.Run(() =>
            {
                int pid = Libc.getpid();
                try
                {
                    while (true)
                    {
                        bool desired;
                        lock (LongpressGate)
                        {
                            if (_longpressApplied == _longpressDesired) { _longpressBusy = false; return; }
                            desired = _longpressDesired;
                        }
                        if (desired) WriteLongpressFile(pid);
                        try
                        {
                            if (!DbusBus.TrySetLongpressKeyInfo(desired, "XF86Back", 1.0, pid))
                                Shell.Read(LongpressCommand(desired, pid));
                        }
                        catch (Exception) { }
                        lock (LongpressGate)
                        {
                            _longpressApplied = desired;
                            if (!desired && !_longpressDesired) RemoveLongpressFile();
                            if (_longpressApplied == _longpressDesired) { _longpressBusy = false; return; }
                        }
                    }
                }
                catch (Exception)
                {
                    lock (LongpressGate) { _longpressBusy = false; }
                }
            });
        }

        private static void SyncBackClaim()
        {
            if (_backClaimUnavailable) return;
            double claimNow = Efl.ecore_time_get();
            bool idleEnabled = _win != IntPtr.Zero
                && _ctl != null
                && _idleModel != null
                && _idleWin != null
                && _idleConfig != null
                && _idleConfig.Mode != IdleMode.Off
                && _homeLaunch == null;
            bool wantBack = idleEnabled
                && claimNow >= _backReleaseUntil
                && claimNow >= _launchBackClaimSuppressUntil
                && !_idleModel.IsLaunchSuppressed(claimNow)
                && _idleModel.CanClaimBackKey(_idleWin.IsShown, DockActive, _lastPartialApp, _pad != null && _pad.IsOnScreen, false, _lastRealScreensaverActive, _lastColdBootSilentHome);
            bool wantExit = idleEnabled
                && claimNow >= _exitReleaseUntil
                && IdleBackdropModel.CanClaimExitKey(true, _samsungHomeRequested, _idleModel.LastKnownSource, _lastTunerActive, _idleModel.HoldOcclusionForScreensaver, _lastRealScreensaverActive, _lastColdBootSilentHome, _idleModel.ScreensaverTakeoverActive);
            if ((wantBack == _backClaimed) && (wantBack == _longpressClaimed) && (wantExit == _exitClaimed)) return;
            try
            {
                bool changed = false;
                if (wantBack)
                {
                    if (!_backClaimed)
                    {
                        bool ok = Efl.elm_win_keygrab_set(_win, "XF86Back", 0, 0, 0, KeygrabExclusive);
                        if (ok) { _backClaimed = true; changed = true; WatchEcoreKeys(); }
                        else Log("idle: back claim refused (XF86Back)");
                    }
                    if (!_longpressClaimed)
                    {
                        _longpressClaimed = true;
                        SyncLongpressClaim(true);
                        changed = true;
                    }
                }
                else
                {
                    if (_backClaimed)
                    {
                        Efl.elm_win_keygrab_unset(_win, "XF86Back", 0, 0);
                        _backClaimed = false;
                        changed = true;
                    }
                    if (_longpressClaimed)
                    {
                        _longpressClaimed = false;
                        SyncLongpressClaim(false);
                        changed = true;
                    }
                }
                if (wantExit)
                {
                    if (!_exitClaimed)
                    {
                        bool ok = Efl.elm_win_keygrab_set(_win, "XF86Exit", 0, 0, 0, KeygrabExclusive);
                        if (ok) { _exitClaimed = true; changed = true; WatchEcoreKeys(); }
                        else Log("idle: back claim refused (XF86Exit)");
                    }
                }
                else
                {
                    if (_exitClaimed)
                    {
                        Efl.elm_win_keygrab_unset(_win, "XF86Exit", 0, 0);
                        _exitClaimed = false;
                        changed = true;
                    }
                }
                if (changed) Log("idle: back claim sync (back=" + _backClaimed + " exit=" + _exitClaimed + ")");
            }
            catch (EntryPointNotFoundException ex) { _backClaimUnavailable = true; _backClaimed = false; _exitClaimed = false; if (_longpressClaimed) { _longpressClaimed = false; SyncLongpressClaim(false); } Log("idle: back claim unavailable: " + ex.Message); }
            catch (DllNotFoundException ex) { _backClaimUnavailable = true; _backClaimed = false; _exitClaimed = false; if (_longpressClaimed) { _longpressClaimed = false; SyncLongpressClaim(false); } Log("idle: back claim unavailable: " + ex.Message); }
            catch (Exception ex) { _backClaimed = false; _exitClaimed = false; if (_longpressClaimed) { _longpressClaimed = false; SyncLongpressClaim(false); } Log("idle: back claim error: " + ex.Message); }
        }

        private static void ScheduleSyncBackClaim(double delay = 0.02)
        {
            if (_backClaimUnavailable) return;
            if (_syncBackTimer != IntPtr.Zero) return;
            _syncBackTimer = Efl.ecore_timer_add(delay, SyncBackCb, IntPtr.Zero);
        }

        private static byte OnSyncBackTimer(IntPtr data)
        {
            _syncBackTimer = IntPtr.Zero;
            try
            {
                if (_anim != IntPtr.Zero || (_padProbe != null && _padProbe.Active))
                {
                    _syncBackTimer = Efl.ecore_timer_add(0.05, SyncBackCb, IntPtr.Zero);
                    return 0;
                }
                SyncBackClaim();
            }
            catch (Exception ex) { Log("idle: sync back timer: " + ex.Message); }
            return 0;
        }

        private static void OpenArrivalDock()
        {
            if (_homeLaunch != null) return;
            _perfWhy = "idle-arrival";
            bool wasActive = DockActive;
            if (!wasActive) ProbeBegin("idle-arrival");
            ShowDock(false);
            if (!wasActive) ProbeHandlerDone();
        }

        private static byte OnElmRunStarted(IntPtr data)
        {
            _elmRunStartTimer = IntPtr.Zero;
            _inElmRun = true;
            try
            {
                if (_pendingArrivalDock)
                {
                    _pendingArrivalDock = false;
                    if (_idleModel != null && _idleModel.Visible && _idleWin != null)
                    {
                        _idleWin.Show(_idleModel.Dimmed, true, false);
                        OpenArrivalDock();
                    }
                }
            }
            catch (Exception ex) { Log("elm_run start: " + ex.Message); }
            return 0;
        }

        private static void CancelDeferredForceClose()
        {
            if (_deferredForceCloseTimer != IntPtr.Zero)
            {
                Efl.ecore_timer_del(_deferredForceCloseTimer);
                _deferredForceCloseTimer = IntPtr.Zero;
            }
            _deferredForceCloseApp = "";
        }

        private static void ReleaseBackClaimOnExit()
        {
            if (_screensaverKeepaliveTimer != IntPtr.Zero) { Efl.ecore_timer_del(_screensaverKeepaliveTimer); _screensaverKeepaliveTimer = IntPtr.Zero; }
            CancelScreensaverWakeReleaseTimer();
            if (_syncBackTimer != IntPtr.Zero) { Efl.ecore_timer_del(_syncBackTimer); _syncBackTimer = IntPtr.Zero; }
            if (_elmRunStartTimer != IntPtr.Zero) { Efl.ecore_timer_del(_elmRunStartTimer); _elmRunStartTimer = IntPtr.Zero; }
            if (_taskRecycleTimer != IntPtr.Zero) { Efl.ecore_timer_del(_taskRecycleTimer); _taskRecycleTimer = IntPtr.Zero; }
            CancelDeferredForceClose();
            if (_win != IntPtr.Zero)
            {
                if (_backClaimed) { try { Efl.elm_win_keygrab_unset(_win, "XF86Back", 0, 0); } catch (Exception) { } _backClaimed = false; }
                if (_exitClaimed) { try { Efl.elm_win_keygrab_unset(_win, "XF86Exit", 0, 0); } catch (Exception) { } _exitClaimed = false; }
            }
            bool hadLongpressFile = !string.IsNullOrEmpty(_longpressPath) && File.Exists(_longpressPath);
            if (_longpressClaimed || _longpressApplied || hadLongpressFile)
            {
                _longpressClaimed = false;
                lock (LongpressGate) { _longpressDesired = false; _longpressApplied = false; }
                try
                {
                    if (!DbusBus.TrySetLongpressKeyInfo(false, "XF86Back", 1.0, Libc.getpid()))
                        Shell.Read(LongpressCommand(false, Libc.getpid()));
                }
                catch (Exception) { }
            }
            RemoveLongpressFile();
        }

        private static void UpdateIdleWatchTimer(double interval)
        {
            if (_idleWatchTimer != IntPtr.Zero && Math.Abs(_idleWatchInterval - interval) < 0.01) return;
            if (_idleWatchTimer != IntPtr.Zero) { Efl.ecore_timer_del(_idleWatchTimer); _idleWatchTimer = IntPtr.Zero; }
            _idleWatchInterval = interval;
            _idleWatchTimer = Efl.ecore_timer_add(interval, IdleWatchCb, IntPtr.Zero);
        }

        private const string FullscreenAppIdKey = "memory/appfw/current_fullscreen_appid";

        private static void SubscribeFullscreenNotify()
        {
            if (!_vconfFullscreenSubscribed)
            {
                try
                {
                    int rc = Efl.vconf_notify_key_changed(FullscreenAppIdKey, VconfFullscreenCb, IntPtr.Zero);
                    if (rc == 0)
                    {
                        _vconfFullscreenSubscribed = true;
                        Log("idle: vconf notify ok");
                    }
                    else Log("idle: vconf notify rc=" + rc);
                }
                catch (Exception ex) { Log("idle: vconf notify unavailable: " + ex.Message); }
            }
            if (!_vconfScreensaverSubscribed)
            {
                try
                {
                    int rc = Efl.vconf_notify_key_changed(ScreensaverKey, VconfScreensaverCb, IntPtr.Zero);
                    if (rc == 0) _vconfScreensaverSubscribed = true;
                }
                catch (Exception) { }
            }
        }

        private static void UnsubscribeFullscreenNotify()
        {
            if (_vconfFullscreenSubscribed)
            {
                _vconfFullscreenSubscribed = false;
                try { Efl.vconf_ignore_key_changed(FullscreenAppIdKey, VconfFullscreenCb); }
                catch (Exception) { }
            }
            if (_vconfScreensaverSubscribed)
            {
                _vconfScreensaverSubscribed = false;
                try { Efl.vconf_ignore_key_changed(ScreensaverKey, VconfScreensaverCb); }
                catch (Exception) { }
            }
        }

        private static void ScheduleAsyncIdlePoll()
        {
            if (System.Threading.Interlocked.Exchange(ref _vconfWakePending, 1) != 0) return;
            try { Efl.ecore_main_loop_thread_safe_call_async(VconfMainLoopCb, IntPtr.Zero); }
            catch (Exception) { System.Threading.Volatile.Write(ref _vconfWakePending, 0); }
        }

        private static void OnVconfFullscreenChanged(IntPtr keynode, IntPtr userData)
        {
            if (!_vconfFullscreenSubscribed) return;
            ScheduleAsyncIdlePoll();
        }

        private static void OnVconfScreensaverChanged(IntPtr keynode, IntPtr userData)
        {
            if (!_vconfScreensaverSubscribed) return;
            ScheduleAsyncIdlePoll();
        }

        private static void OnVconfFullscreenMain(IntPtr data)
        {
            System.Threading.Volatile.Write(ref _vconfWakePending, 0);
            if (_idleModel == null || _idleWin == null || _homeLaunch != null || (_idleConfig != null && _idleConfig.Mode == IdleMode.Off)) return;
            try { PollIdleBackdrop(); }
            catch (Exception ex) { Log("idle: vconf poll: " + ex.Message); }
        }

        private static void CancelBackHoldTimer()
        {
            if (_backPrewarmTimer != IntPtr.Zero) { Efl.ecore_timer_del(_backPrewarmTimer); _backPrewarmTimer = IntPtr.Zero; }
            if (_backHoldTimer != IntPtr.Zero) { Efl.ecore_timer_del(_backHoldTimer); _backHoldTimer = IntPtr.Zero; }
            if (_backForceCloseTimer != IntPtr.Zero) { Efl.ecore_timer_del(_backForceCloseTimer); _backForceCloseTimer = IntPtr.Zero; }
            _backHoldCode = 0;
        }

        private static byte OnBackPrewarm(IntPtr data)
        {
            _backPrewarmTimer = IntPtr.Zero;
            try
            {
                if (_idleModel != null && !_idleModel.Visible && !_idleModel.HoldOcclusionForScreensaver && !DockActive && _idleWin != null && (_idleConfig == null || _idleConfig.Mode != IdleMode.Off))
                {
                    _idleWin.PrewarmAssets();
                }
            }
            catch (Exception) { }
            return 0;
        }

        private static byte OnBackHold(IntPtr data)
        {
            int code = _backHoldCode;
            _backHoldTimer = IntPtr.Zero;
            try
            {
                if (_idleModel != null && !_idleModel.Visible && !_idleModel.HoldOcclusionForScreensaver && !DockActive && _idleWin != null && (_idleConfig == null || _idleConfig.Mode != IdleMode.Off))
                {
                    _idleWin.PrewarmAssets();
                    double now = Efl.ecore_time_get();
                    _backHoldFastUntil = Math.Max(_backHoldFastUntil, now + 2.0);
                    _fastIdleWatchUntil = Math.Max(_fastIdleWatchUntil, now + 2.5);
                    UpdateIdleWatchTimer(0.02);
                    Log("idle: back hold 0.45s code=" + code + " prewarmed");
                }
            }
            catch (Exception ex) { Log("idle: back hold: " + ex.Message); }
            return 0;
        }

        private static bool TriggerProactiveForceClose(double now, string rawFullApp, string triggerSource)
        {
            if (_idleModel == null || DockActive || _idleWin == null || (_idleConfig != null && _idleConfig.Mode == IdleMode.Off) || _homeLaunch != null)
                return false;
            bool launching = _idleModel.IsLaunchSuppressed(now);
            if ((_idleModel.Visible || _idleModel.HoldOcclusionForScreensaver || IsAnyRealScreensaverActive()) && !launching)
                return false;

            string appToClose = rawFullApp ?? "";
            if (IdleBackdropModel.IsScreensaverApp(appToClose))
                return false;
            if (string.IsNullOrEmpty(appToClose)
                || appToClose == IdleBackdropModel.TvViewerAppId
                || IdleBackdropModel.IsGuardedSamsungHome(appToClose))
            {
                appToClose = launching ? (_idleModel.LaunchTargetAppId ?? "") : "";
            }
            if (appToClose == IdleBackdropModel.WrapperYouTubeAppId)
                appToClose = IdleBackdropModel.CobaltYouTubeAppId;

            if (!string.IsNullOrEmpty(appToClose)
                && (appToClose == IdleBackdropModel.TvViewerAppId
                    || IdleBackdropModel.IsGuardedSamsungHome(appToClose)
                    || IdleBackdropModel.IsScreensaverApp(appToClose)
                    || appToClose.StartsWith("vetrotvapp", StringComparison.OrdinalIgnoreCase)
                    || !Catalog.ValidAppId(appToClose)))
            {
                return false;
            }
            if (string.IsNullOrEmpty(appToClose) && !launching)
                return false;

            CancelBackHoldTimer();
            CancelDeferredForceClose();
            _lastExitForceCloseMono = now;

            // Step A (T = 0 ms, synchronous on EFL main thread): paint opaque Layer-250 vetro-idle + Arrival Dock
            // OVER the still-open app on the very next Wayland VSync (~16 ms) before requesting app termination.
            IdleAction action = _idleModel.OnProactiveForceClose(now, appToClose);
            if (action == IdleAction.None) return false;
            _launchBackClaimSuppressUntil = 0;
            _lastPausedAppId = "";
            if (!string.IsNullOrEmpty(appToClose)) _lastForceClosedAppId = appToClose;
            bool openDock = action == IdleAction.ShowWithDock;
            bool padOpen = _pad != null && _pad.IsOnScreen;
            bool pillOpen = _pill != null && _pill.IsOnScreen;
            if (openDock) _arrivalBackShieldUntil = now + 0.90;
            if (_wmStack != null) _wmStack.LaunchingApp = false;
            _idleWin.Show(false, openDock, IdleBackdropModel.ShouldRaiseIdleWindow(openDock || DockActive, padOpen, pillOpen));
            if (_wmStack != null)
            {
                _wmStack.IdleShown = _idleWin.IsShown;
                if (!_samsungHomeRequested)
                {
                    _wmStack.ActivateShield(4500);
                    _wmStack.EnsureStack(true);
                }
            }
            if (openDock && !DockActive)
            {
                if (_inElmRun) OpenArrivalDock();
                else _pendingArrivalDock = true;
            }
            ArmGuard();
            BumpDismissRestoreGen();
            int restoreGen = System.Threading.Volatile.Read(ref _dismissRestoreGen);
            if (!string.IsNullOrEmpty(appToClose))
            {
                _deferredForceCloseApp = appToClose;
                _deferredForceCloseGen = restoreGen;
                _deferredForceCloseWasLaunching = launching;
                _deferredForceCloseLaunchEpoch = System.Threading.Volatile.Read(ref _launchEpoch);
                _deferredForceCloseTimer = Efl.ecore_timer_add(0.035, DeferredForceCloseCb, IntPtr.Zero);
            }
            Log("idle: proactive " + triggerSource + " close app=" + (string.IsNullOrEmpty(appToClose) ? "(launching)" : appToClose));
            SyncBackClaim();
            _fastIdleWatchUntil = Math.Max(_fastIdleWatchUntil, now + 2.5);
            UpdateIdleWatchTimer(0.10);
            return true;
        }

        private static void NoteLaunchEpoch(string rawAppId)
        {
            string canonical = rawAppId ?? "";
            if (canonical == IdleBackdropModel.WrapperYouTubeAppId)
                canonical = IdleBackdropModel.CobaltYouTubeAppId;
            _lastLaunchTargetApp = canonical;
            System.Threading.Interlocked.Increment(ref _launchEpoch);
        }

        private static bool SleepUnlessLaunchChanged(int totalMs, int launchEpoch, int restoreGen)
        {
            int elapsed = 0;
            while (elapsed < totalMs)
            {
                if (_samsungHomeRequested
                    || System.Threading.Volatile.Read(ref _launchEpoch) != launchEpoch
                    || System.Threading.Volatile.Read(ref _dismissRestoreGen) != restoreGen)
                {
                    return false;
                }
                int slice = Math.Min(200, totalMs - elapsed);
                System.Threading.Thread.Sleep(slice);
                elapsed += slice;
            }
            return !_samsungHomeRequested
                && System.Threading.Volatile.Read(ref _launchEpoch) == launchEpoch
                && System.Threading.Volatile.Read(ref _dismissRestoreGen) == restoreGen;
        }

        private static byte OnDeferredForceClose(IntPtr data)
        {
            _deferredForceCloseTimer = IntPtr.Zero;
            string app = _deferredForceCloseApp;
            _deferredForceCloseApp = "";
            int restoreGen = _deferredForceCloseGen;
            bool wasLaunching = _deferredForceCloseWasLaunching;
            int launchEpoch = _deferredForceCloseLaunchEpoch;
            _deferredForceCloseWasLaunching = false;
            if (string.IsNullOrEmpty(app) || !Catalog.ValidAppId(app)) return 0;
            System.Threading.Tasks.Task.Run(() =>
            {
                try
                {
                    string settleCmd = "case \"$(/usr/bin/vconftool get memory/appfw/current_fullscreen_appid 2>/dev/null)\" in "
                        + "*com.samsung.tv.csfs*|*com.samsung.tv.home.*|*com.samsung.tv.coba.*|*" + app + "*) "
                        + "/usr/bin/app_launcher -s " + IdleBackdropModel.TvViewerAppId + " -u 5001 >/dev/null 2>&1; "
                        + "/usr/bin/vconftool set -f -t string memory/appfw/current_fullscreen_appid " + IdleBackdropModel.TvViewerAppId + " >/dev/null 2>&1 ;; esac";

                    if (System.Threading.Volatile.Read(ref _dismissRestoreGen) == restoreGen)
                    {
                        Libc.system("/usr/bin/app_launcher -t " + app + " -u 5001 >/dev/null 2>&1");
                        if (!_samsungHomeRequested && System.Threading.Volatile.Read(ref _dismissRestoreGen) == restoreGen)
                        {
                            Libc.system(settleCmd);
                        }
                    }

                    System.Threading.Thread.Sleep(220);
                    int curEpoch = System.Threading.Volatile.Read(ref _launchEpoch);
                    bool sameAppRelaunched = curEpoch != launchEpoch
                        && IdleBackdropModel.SameLaunchAppOrYouTubeAlias(_lastLaunchTargetApp, app);
                    if (!_samsungHomeRequested && !sameAppRelaunched)
                    {
                        Libc.system("/usr/bin/app_launcher -k " + app + " >/dev/null 2>&1");
                        if (System.Threading.Volatile.Read(ref _dismissRestoreGen) == restoreGen)
                        {
                            Libc.system(settleCmd);
                        }
                    }

                    if (!wasLaunching)
                    {
                        System.Threading.Thread.Sleep(220);
                        if (!_samsungHomeRequested && System.Threading.Volatile.Read(ref _dismissRestoreGen) == restoreGen)
                        {
                            Libc.system(settleCmd);
                        }
                        return;
                    }

                    // Mid-launch XF86Exit abort: catch late-spawning apps at +1.0s and +2.3s, cancelling within <=200 ms on any new launch.
                    int[] abortFollowUpsMs = { 780, 1300 };
                    for (int i = 0; i < abortFollowUpsMs.Length; i++)
                    {
                        if (!SleepUnlessLaunchChanged(abortFollowUpsMs[i], launchEpoch, restoreGen))
                            return;
                        Libc.system("/usr/bin/app_launcher -t " + app + " -u 5001 >/dev/null 2>&1; /usr/bin/app_launcher -k " + app + " >/dev/null 2>&1");
                        if (!_samsungHomeRequested
                            && System.Threading.Volatile.Read(ref _launchEpoch) == launchEpoch
                            && System.Threading.Volatile.Read(ref _dismissRestoreGen) == restoreGen)
                        {
                            Libc.system(settleCmd);
                        }
                    }
                }
                catch (Exception) { }
            });
            return 0;
        }

        private static void HandleExitKey(double now)
        {
            if (now - _lastExitForceCloseMono < 0.75) return;
            if (_pad != null && _pad.IsOnScreen)
            {
                _lastExitForceCloseMono = now;
                ClosePad();
                return;
            }
            if (DockActive)
            {
                if (now < _arrivalBackShieldUntil) return;
                _lastExitForceCloseMono = now;
                HideDock();
                return;
            }
            if ((_idleModel != null && _idleModel.ScreensaverTakeoverActive) || _screensaverWakePendingRelease)
            {
                _lastExitForceCloseMono = now;
                ArmScreensaverTakeoverWakeRelease(now);
                return;
            }
            if (_idleModel == null || _idleWin == null || _homeLaunch != null || (_idleConfig != null && _idleConfig.Mode == IdleMode.Off))
                return;

            string partial = IdleBackdropModel.NormalizePartialAppId(Efl.VconfGetString("memory/appfw/current_partial_appid"));
            string full = Efl.VconfGetString(FullscreenAppIdKey);
            if ((!_idleModel.IsLaunchSuppressed(now) && (_idleModel.HoldOcclusionForScreensaver || IdleBackdropModel.IsScreensaverApp(full) || IsAnyRealScreensaverActive())))
            {
                _lastExitForceCloseMono = now;
                WakeOrResetScreensaverForUserAction(false);
                return;
            }
            if (!string.IsNullOrEmpty(partial) && !IdleBackdropModel.IsGuardedSamsungHome(partial) && !IdleBackdropModel.IsScreensaverApp(partial))
            {
                _lastExitForceCloseMono = now;
                _exitReleaseUntil = now + 1.0;
                _backReleaseUntil = now + 1.0;
                SyncBackClaim();
                PollIdleBackdrop();
                System.Threading.Tasks.Task.Run(() =>
                {
                    try { Libc.system("/usr/bin/input_keyevent XF86Back >/dev/null 2>&1"); } catch (Exception) { }
                });
                return;
            }

            if (!_idleModel.Visible || _idleModel.IsLaunchSuppressed(now))
            {
                TriggerProactiveForceClose(now, full, "exit");
                return;
            }
            _lastExitForceCloseMono = now;
        }

        private static byte OnBackForceClose(IntPtr data)
        {
            _backForceCloseTimer = IntPtr.Zero;
            try
            {
                TriggerProactiveForceClose(Efl.ecore_time_get(), Efl.VconfGetString(FullscreenAppIdKey), "back-hold");
            }
            catch (Exception ex) { Log("idle: proactive back-hold close: " + ex.Message); }
            return 0;
        }

        private static void CancelIdleTimers()
        {
            _idleWatchInterval = 0;
            if (_idleWatchTimer != IntPtr.Zero) { Efl.ecore_timer_del(_idleWatchTimer); _idleWatchTimer = IntPtr.Zero; }
            if (_idleLcdVerifyTimer != IntPtr.Zero) { Efl.ecore_timer_del(_idleLcdVerifyTimer); _idleLcdVerifyTimer = IntPtr.Zero; }
            if (_screensaverKeepaliveTimer != IntPtr.Zero) { Efl.ecore_timer_del(_screensaverKeepaliveTimer); _screensaverKeepaliveTimer = IntPtr.Zero; }
            CancelScreensaverWakeReleaseTimer();
            CancelBackHoldTimer();
            CancelDeferredForceClose();
        }

        private static bool IsScreensaverSuppressionKeepaliveWanted()
        {
            return _idleConfig != null
                && _idleModel != null
                && _idleWin != null
                && IdleBackdropModel.ShouldKeepScreensaverSuppressed(
                    _idleConfig,
                    _idleModel.Visible && _idleWin.IsShown,
                    _idleModel.HoldOcclusionForScreensaver,
                    IsDisplayOff(),
                    _lastRealScreensaverActive);
        }

        private static void SyncScreensaverSuppressionKeepalive(double now, bool forceImmediate = false)
        {
            if (!IsScreensaverSuppressionKeepaliveWanted())
            {
                if (_screensaverKeepaliveTimer != IntPtr.Zero)
                {
                    Efl.ecore_timer_del(_screensaverKeepaliveTimer);
                    _screensaverKeepaliveTimer = IntPtr.Zero;
                }
                return;
            }
            if (_screensaverKeepaliveTimer == IntPtr.Zero)
            {
                _screensaverKeepaliveTimer = Efl.ecore_timer_add(
                    IdleBackdropModel.SuppressScreensaverKeepaliveSeconds,
                    ScreensaverKeepaliveCb,
                    IntPtr.Zero);
                TriggerScreensaverActivityReset(now, forceImmediate ? 0.0 : 25.0);
            }
            else if (forceImmediate)
            {
                TriggerScreensaverActivityReset(now, 0.0);
            }
        }

        private static byte OnScreensaverKeepalive(IntPtr data)
        {
            if (!IsScreensaverSuppressionKeepaliveWanted())
            {
                _screensaverKeepaliveTimer = IntPtr.Zero;
                return 0;
            }
            TriggerScreensaverActivityReset(Efl.ecore_time_get(), 25.0);
            return 1;
        }

        private static void InitIdleBackdrop()
        {
            if (_idleModel != null && _idleWin != null) return;
            _idleModel = new IdleBackdropModel(_idleConfig);
            _idleWin = new IdleBackdropWindow(_idleConfig, Log, _screenW, _screenH, _perf);
            if (_wmStack == null) _wmStack = new WmStackController(Log, ScheduleAsyncIdlePoll);
            _wmStack.AllowSamsungHome = _samsungHomeRequested;
            _idleWin.OnShown = () => _wmStack.EnsureStack(1500);
            _idleWin.OnAnimatorStarted = () => System.Threading.Tasks.Task.Run((Action)PromoteRenderThreads);
            _idleWin.OnKeyDown = () =>
            {
                if (_idleModel != null && (_idleModel.ScreensaverTakeoverActive || _screensaverWakePendingRelease))
                    ArmScreensaverTakeoverWakeRelease(Efl.ecore_time_get());
            };
            _idleWin.OnKeyUp = () =>
            {
                if (_screensaverWakePendingRelease || (_idleModel != null && _idleModel.ScreensaverTakeoverActive))
                    CompleteScreensaverTakeoverWake(true);
            };
            _idleWin.Prewarm();
            _wmStack.EnsureStack(1500);
            SubscribeFullscreenNotify();
        }

        private static void ApplyLiveIdleConfig(string argsLine)
        {
            if (_homeLaunch != null || string.IsNullOrEmpty(argsLine)) return;
            int fallbackLvl = _idleConfig != null ? _idleConfig.NotificationLevel : 10;
            bool fallbackSuppress = _idleConfig != null && _idleConfig.SuppressScreensaver;
            IdleConfig next = IdleConfig.ParseLiveArgs(argsLine, fallbackLvl, fallbackSuppress);
            if (next == null) return;
            _idleConfig = next;
            if (next.Mode == IdleMode.Off)
            {
                CancelIdleTimers();
                UnsubscribeFullscreenNotify();
                _lastRealScreensaverActive = false;
                _lastColdBootSilentHome = false;
                _wasScreensaverTakeoverActive = false;
                _screensaverWakePendingRelease = false;
                if (_idleModel != null) _idleModel.Reconfigure(next, Efl.ecore_time_get());
                if (_idleWin != null)
                {
                    _idleWin.SetScreensaverOverlay(false);
                    _idleWin.SetInteractiveFocus(false);
                    _idleWin.Hide(true);
                }
                if (_wmStack != null) { _wmStack.ScreensaverActive = false; _wmStack.ScreensaverTakeover = false; _wmStack.IdleShown = false; }
                SyncBackClaim();
                Log("idle: live off");
                return;
            }
            if (_idleModel == null || _idleWin == null)
            {
                InitIdleBackdrop();
            }
            else
            {
                _idleModel.Reconfigure(_idleConfig, Efl.ecore_time_get());
                if (!next.SuppressScreensaver)
                {
                    CancelScreensaverWakeReleaseTimer();
                    _wasScreensaverTakeoverActive = false;
                    _screensaverWakePendingRelease = false;
                    _idleWin.SetScreensaverOverlay(false);
                    _idleWin.SetInteractiveFocus(false);
                    if (_wmStack != null) _wmStack.ScreensaverTakeover = false;
                }
                _idleWin.Reconfigure(_idleConfig);
                SubscribeFullscreenNotify();
            }
            if (next.SuppressScreensaver && next.Mode != IdleMode.Off && IsAnyRealScreensaverActive())
                WakeOrResetScreensaverForUserAction(false);
            PollIdleBackdrop();
            SyncScreensaverSuppressionKeepalive(Efl.ecore_time_get(), forceImmediate: next.SuppressScreensaver);
        }

        private static void HandleExternalLaunch(string argsLine)
        {
            string extAppId, extLabel;
            double suppressSec = CommandBuffer.ParseLaunchArgs(argsLine, IdleBackdropModel.LaunchSuppressSeconds, out extAppId, out extLabel);
            if (!string.IsNullOrEmpty(extAppId) && string.IsNullOrEmpty(extLabel))
            {
                AppEntry known = FindCatalogEntry(extAppId);
                if (known != null && !string.IsNullOrEmpty(known.Label)) extLabel = known.Label;
            }
            double now = Efl.ecore_time_get();
            NoteLaunchEpoch(extAppId);
            CancelDeferredForceClose();
            BumpDismissRestoreGen();
            if (_guardApps != null)
            {
                try { NewGuardGeneration(); } catch (Exception) { }
            }
            _lastAppHomePress = -100;
            CancelPendingScreenOff();
            ClosePad();
            if (_idleModel != null)
            {
                _idleModel.OnLaunchApp(now, suppressSec, extAppId);
                _launchBackClaimSuppressUntil = now + 1.5;
                if (_idleWin != null
                    && !_idleWin.IsShown
                    && _idleConfig != null
                    && _idleConfig.Mode != IdleMode.Off
                    && _homeLaunch == null
                    && !_samsungHomeRequested
                    && _idleModel.LastKnownSource <= 0
                    && !_lastTunerActive
                    && (WmStackLogic.IsYoutubeTargetApp(extAppId)
                        || suppressSec >= IdleBackdropModel.ShardLaunchDwellThresholdSeconds
                        || _lastFullApp == IdleBackdropModel.TvViewerAppId
                        || IdleBackdropModel.IsGuardedSamsungHome(_lastFullApp)
                        || (_wmStack != null && _wmStack.GuardedHomeWinPresent && !_wmStack.ActiveAppWinPresent)))
                {
                    _idleModel.SetVisibleForLaunchCurtain(now);
                    _idleWin.Show(false, false);
                }
            }
            _pendingArrivalDock = false;
            if (_wmStack != null)
            {
                _wmStack.InvalidateObservation();
                bool shownNow = _idleWin != null && _idleWin.IsShown;
                _wmStack.IdleShown = shownNow;
                _wmStack.BeginAppLaunch(
                    extAppId,
                    extLabel,
                    _lastPausedAppId,
                    suppressSec >= IdleBackdropModel.ShardLaunchDwellThresholdSeconds || WmStackLogic.IsYoutubeTargetApp(extAppId),
                    (int)Math.Round((suppressSec + 0.5) * 1000.0),
                    shownNow,
                    100,
                    _lastForceClosedAppId);
            }
            if (DockActive) HideDock();
            SyncBackClaim();
            if (_idleWin != null) UpdateIdleWatchTimer(0.25);
            Log("idle: external launch suppress=" + suppressSec.ToString("0.#", System.Globalization.CultureInfo.InvariantCulture) + "s" + (string.IsNullOrEmpty(extAppId) ? "" : " app=" + extAppId));
        }

        private static void PollIdleBackdrop()
        {
            if (_idleModel == null || _idleWin == null || _homeLaunch != null) return;
            double now = Efl.ecore_time_get();
            DateTime utcNow = DateTime.UtcNow;
            bool strResumed = false;
            if (_lastPollMono >= 0 && _lastPollUtc != DateTime.MinValue)
            {
                double wallDelta = (utcNow - _lastPollUtc).TotalSeconds;
                double monoDelta = now - _lastPollMono;
                if (wallDelta - monoDelta > 2.0) strResumed = true;
            }
            _lastPollMono = now;
            _lastPollUtc = utcNow;

            bool padOpen = _pad != null && _pad.IsOnScreen;
            bool pillOpen = _pill != null && _pill.IsOnScreen;
            int pm = 1;
            try { if (Efl.vconf_get_int("memory/pm/state", out pm) != 0) pm = 1; } catch (Exception) { pm = 1; }
            bool displayOff = pm >= IdleBackdropModel.DisplayStateOff;
            if (displayOff && !_wasDisplayOff)
            {
                _wasDisplayOff = true;
                _lastRealScreensaverActive = false;
                _lastColdBootSilentHome = false;
                _screensaverFilter.Reset();
                _idleWin.SetDisplayOff(true);
                _lastPartialApp = "";
                if (_wmStack != null)
                {
                    _wmStack.ScreensaverActive = false;
                    _wmStack.PartialActive = false;
                    if ((_idleModel.Visible || _idleModel.HoldOcclusionForScreensaver) && !_samsungHomeRequested) _wmStack.ActivateShield(5000);
                }
                if (_idleModel.Visible)
                {
                    bool allowRaise = IdleBackdropModel.ShouldRaiseBackdrop(DockActive, padOpen, pillOpen, _lastPartialApp, _samsungHomeRequested);
                    if (!_idleWin.IsShown) _idleWin.Show(false, DockActive, allowRaise);
                    else _idleWin.SetDimmed(false);
                    if (allowRaise) _idleWin.Raise();
                }
            }
            else if (!displayOff && _wasDisplayOff)
            {
                _wasDisplayOff = false;
                _idleWin.SetDisplayOff(false);
            }
            else
            {
                _idleWin.SetDisplayOff(displayOff);
            }
            if (!displayOff && _idleLcdVerifyTimer != IntPtr.Zero)
            {
                Efl.ecore_timer_del(_idleLcdVerifyTimer);
                _idleLcdVerifyTimer = IntPtr.Zero;
            }
            if (displayOff && _idleModel.Visible && !_idleModel.HoldOcclusionForScreensaver && _idleWin.IsShown)
            {
                _screensaverFilter.Reset();
                IdleAction offAct = _idleModel.Evaluate(new TvSnapshot { DisplayState = pm }, now, DockActive, false, false);
                if (offAct == IdleAction.Hide || (!_idleModel.ScreensaverTakeoverActive && _wasScreensaverTakeoverActive))
                {
                    CancelScreensaverWakeReleaseTimer();
                    _wasScreensaverTakeoverActive = false;
                    _screensaverWakePendingRelease = false;
                    _idleWin.SetScreensaverOverlay(false);
                    _idleWin.SetInteractiveFocus(false);
                    if (_wmStack != null) _wmStack.ScreensaverTakeover = false;
                    SyncBackClaim();
                }
                if (offAct == IdleAction.Hide)
                {
                    _idleWin.Hide();
                    if (_wmStack != null) _wmStack.IdleShown = false;
                }
                SyncScreensaverSuppressionKeepalive(now);
                UpdateIdleWatchTimer(0.15);
                return;
            }

            int src = -1, srcRc = -1;
            try { srcRc = Efl.vconf_get_int("memory/system/source_type", out src); if (srcRc != 0) src = -1; } catch (Exception) { src = -1; }
            if (src == 0) _tvPlusActive = false;

            string fullApp = (!displayOff || !_idleModel.Visible) ? Efl.VconfGetString("memory/appfw/current_fullscreen_appid") : null;
            if (_samsungHomeRequested && !displayOff)
            {
                if (IdleBackdropModel.IsGuardedSamsungHome(fullApp)) _samsungHomeObserved = true;
                if (src > 0
                    || (_samsungHomeObserved && fullApp == IdleBackdropModel.TvViewerAppId)
                    || (!_samsungHomeObserved && now >= _samsungHomeRequestedUntil))
                {
                    _samsungHomeRequested = false;
                    _samsungHomeObserved = false;
                }
            }

            bool fullChanged = fullApp != null && fullApp != _lastFullApp;
            if (fullApp != null)
            {
                _lastFullApp = fullApp;
                if (_wmStack != null) _wmStack.CachedFullscreenAppId = fullApp;
            }
            if (fullChanged && _wmStack != null)
            {
                if (_idleModel.IsLaunchSuppressed(now)) _wmStack.EnsureStack(true);
                else _wmStack.InvalidateObservation();
            }

            bool wmObserved = _wmStack != null && _wmStack.HasObservedWindows;
            bool wmGuardedHome = wmObserved && _wmStack.GuardedHomeWinPresent;
            bool wmActiveApp = wmObserved && _wmStack.ActiveAppWinPresent;
            bool wmLaunchscreen = wmObserved && _wmStack.LaunchscreenWinPresent;
            bool wmScreensaver = wmObserved && _wmStack.ScreensaverWinPresent;
            bool wmLaunchTargetReady = wmObserved && _wmStack.LaunchTargetReady;
            var snap = new TvSnapshot
            {
                SourceType = src,
                DisplayState = pm,
                FullscreenAppId = fullApp,
                SamsungHomeRequested = _samsungHomeRequested,
                WmStackActive = _wmStack != null && _wmStack.IsActive,
                WmStateObserved = wmObserved,
                WmGuardedHomePresent = wmGuardedHome,
                WmActiveAppPresent = wmActiveApp,
                WmLaunchscreenPresent = wmLaunchscreen,
                WmScreensaverWinPresent = wmScreensaver,
                WmLaunchTargetReady = wmLaunchTargetReady,
                PendingTvSource = now < _pendingTvSourceUntil,
                TvPlusActive = _tvPlusActive
            };
            if ((!displayOff || !_idleModel.Visible) && src <= 0)
            {
                if (fullApp == IdleBackdropModel.TvViewerAppId
                    || IdleBackdropModel.IsGuardedSamsungHome(fullApp)
                    || IdleBackdropModel.IsScreensaverApp(fullApp)
                    || string.IsNullOrEmpty(fullApp)
                    || wmGuardedHome
                    || wmScreensaver)
                {
                    if (!displayOff) snap.PartialAppId = IdleBackdropModel.NormalizePartialAppId(Efl.VconfGetString("memory/appfw/current_partial_appid"));
                    bool steadyIdleVisible = _idleModel.Visible && _idleWin.IsShown && !displayOff;
                    if (steadyIdleVisible && (now - _lastTunerCheckMono) >= 0.0 && (now - _lastTunerCheckMono) < 2.5)
                    {
                        snap.TunerActive = _lastTunerActive;
                    }
                    else
                    {
                        snap.TunerActive = IdleBackdropModel.IsTunerReady(FileExistsFn, ReadTextFn, PidAliveFn);
                        _lastTunerCheckMono = now;
                    }
                }
            }
            _lastTunerActive = snap.TunerActive;
            bool rawScreensaverFlag = !displayOff && ReadScreensaverVconfFlag();
            bool rawScreensaverRose = rawScreensaverFlag && !_lastRawScreensaver;
            if (rawScreensaverRose)
            {
                if (_wmStack != null) _wmStack.EnsureStack(2500);
                _fastIdleWatchUntil = Math.Max(_fastIdleWatchUntil, now + 3.5);
            }
            _lastRawScreensaver = rawScreensaverFlag;
            if (!displayOff && rawScreensaverFlag && snap.PartialAppId == null)
            {
                snap.PartialAppId = IdleBackdropModel.NormalizePartialAppId(Efl.VconfGetString("memory/appfw/current_partial_appid"));
            }
            if (!rawScreensaverFlag && !wmScreensaver) System.Threading.Volatile.Write(ref _screensaverOverlayPid, 0);
            bool screensaverProc = !displayOff && (rawScreensaverFlag || wmScreensaver) && HasScreensaverOverlayProcess();
            if (!displayOff && rawScreensaverRose && !wmScreensaver && !screensaverProc)
                StartBackgroundScreensaverProcScan();
            snap.ScreensaverProcessActive = screensaverProc;
            snap.ScreensaverActive = !displayOff
                && (rawScreensaverFlag
                    || wmScreensaver
                    || IdleBackdropModel.IsScreensaverApp(fullApp)
                    || IdleBackdropModel.IsScreensaverApp(snap.PartialAppId));
            bool realScreensaver = IdleBackdropModel.IsRealScreensaverActive(snap);
            if (!displayOff && !realScreensaver && ReadColdBootSilentHome(fullApp, snap.PartialAppId))
            {
                snap.ColdBootSilentHome = true;
            }
            _lastRealScreensaverActive = realScreensaver;
            _lastColdBootSilentHome = snap.ColdBootSilentHome;

            string partialNow = snap.PartialAppId ?? "";
            if (partialNow != _lastPartialApp)
            {
                _lastPartialApp = partialNow;
                if (_wmStack != null) _wmStack.EnsureStack(1500);
            }

            bool guardedHomeActive = !realScreensaver
                && !snap.ColdBootSilentHome
                && IdleBackdropModel.ComputeGuardedHomeActive(_samsungHomeRequested, fullApp, snap.PartialAppId, wmObserved, wmGuardedHome);
            bool partialActive = (!string.IsNullOrEmpty(_lastPartialApp) && !guardedHomeActive) || now < _backReleaseUntil || padOpen;
            if (_wmStack != null)
            {
                _wmStack.AllowSamsungHome = _samsungHomeRequested;
                _wmStack.GuardedHomeActive = guardedHomeActive;
                _wmStack.PartialActive = partialActive;
                _wmStack.ScreensaverActive = realScreensaver;
                _wmStack.ScreensaverTakeover = _idleModel.ScreensaverTakeoverActive || (_idleConfig.SuppressScreensaver && realScreensaver && _idleModel.Visible);
                _wmStack.LaunchingApp = _idleModel.IsLaunchSuppressed(now);
            }

            bool dockWasActive = DockActive;
            bool strWake = !displayOff && strResumed && _idleModel.OnWake(now, true);
            IdleAction action = _idleModel.Evaluate(snap, now, dockWasActive, padOpen, pillOpen);
            bool takeoverNow = _idleModel.ScreensaverTakeoverActive;
            bool enteredTakeover = takeoverNow && !_wasScreensaverTakeoverActive;
            bool leftTakeover = !takeoverNow && _wasScreensaverTakeoverActive;
            _wasScreensaverTakeoverActive = takeoverNow;
            if (_wmStack != null)
                _wmStack.ScreensaverTakeover = takeoverNow || (_idleConfig.SuppressScreensaver && realScreensaver && _idleModel.Visible);
            if (leftTakeover)
            {
                CancelScreensaverWakeReleaseTimer();
                _screensaverWakePendingRelease = false;
                _idleWin.SetScreensaverOverlay(false);
                _idleWin.SetInteractiveFocus(false);
            }
            bool launchSuppressed = _idleModel.IsLaunchSuppressed(now);
            if (_wmStack != null) _wmStack.LaunchingApp = launchSuppressed;
            bool woke = !displayOff && (_idleModel.ConsumeWakeRestack() || strWake);
            _idleWin.SetDimmed(_idleModel.Dimmed);
            if (action == IdleAction.Hide
                && !realScreensaver
                && !_idleModel.HoldOcclusionForScreensaver
                && !string.IsNullOrEmpty(fullApp)
                && fullApp != IdleBackdropModel.TvViewerAppId
                && !IdleBackdropModel.IsGuardedSamsungHome(fullApp)
                && !IdleBackdropModel.IsScreensaverApp(fullApp))
            {
                _lastAppHomePress = -100;
                _lastPausedAppId = "";
                _lastForceClosedAppId = "";
                BumpDismissRestoreGen();
            }
            if (action == IdleAction.Show || action == IdleAction.ShowWithDock)
            {
                if (!launchSuppressed)
                {
                    _launchBackClaimSuppressUntil = 0;
                    if (fullApp == IdleBackdropModel.TvViewerAppId && src <= 0) _lastPausedAppId = "";
                }
                CancelBackHoldTimer();
            }

            if (action != IdleAction.None)
            {
                string fullLog = (action == IdleAction.Hide && snap.FullscreenAppId == null) ? Efl.VconfGetString("memory/appfw/current_fullscreen_appid") : (snap.FullscreenAppId ?? "");
                string partialLog = (action == IdleAction.Hide && snap.PartialAppId == null) ? Efl.VconfGetString("memory/appfw/current_partial_appid") : (snap.PartialAppId ?? "");
                string actLabel = (action == IdleAction.Hide && _idleModel.HoldOcclusionForScreensaver) ? "ParkForScreensaver" : action.ToString();
                string wmLog = wmObserved ? (" wmObs=True wmHome=" + wmGuardedHome + " wmApp=" + wmActiveApp + (wmLaunchscreen ? " wmLs=True" : "") + (wmScreensaver ? " wmSs=True" : "")) : "";
                Log("idle: " + actLabel + " src=" + snap.SourceType + " srcRc=" + srcRc + " full=" + fullLog + " partial=" + partialLog + " pm=" + snap.DisplayState + " ss=" + realScreensaver + " tuner=" + snap.TunerActive + " dock=" + DockActive + " pad=" + padOpen + " pill=" + pillOpen + " wm=" + snap.WmStackActive + (takeoverNow ? " takeover=True" : "") + wmLog);
            }
            bool canRaise = IdleBackdropModel.ShouldRaiseBackdrop(DockActive, padOpen, pillOpen, _lastPartialApp, _samsungHomeRequested, now < _backReleaseUntil);
            // Show vetro-idle on the EFL thread WITHOUT synchronous dbus-send/system() blocks so Wayland Frame 1 commits immediately (<16 ms).
            switch (action)
            {
                case IdleAction.Show:
                    if (launchSuppressed)
                    {
                        if (_wmStack != null) _wmStack.LaunchingApp = true;
                        _idleWin.Show(false, false, canRaise);
                        if (_wmStack != null)
                        {
                            _wmStack.IdleShown = _idleWin.IsShown;
                            _wmStack.DropForLaunchSync(100);
                        }
                    }
                    else
                    {
                        if (_wmStack != null) _wmStack.LaunchingApp = false;
                        if (takeoverNow) _idleWin.SetScreensaverOverlay(true);
                        bool showDockOverlay = DockActive && !takeoverNow;
                        _idleWin.Show(_idleModel.Dimmed, showDockOverlay, canRaise || takeoverNow);
                        if (showDockOverlay) RaiseActiveDockWin();
                        if (_wmStack != null)
                        {
                            _wmStack.IdleShown = _idleWin.IsShown;
                            if ((!_samsungHomeRequested && !realScreensaver) || takeoverNow) _wmStack.ActivateShield(displayOff ? 5000 : 4500);
                            _wmStack.EnsureStack(true);
                        }
                    }
                    break;
                case IdleAction.ShowWithDock:
                    if (_wmStack != null) _wmStack.LaunchingApp = false;
                    _idleWin.Show(_idleModel.Dimmed, true, false);
                    if (_wmStack != null) _wmStack.IdleShown = _idleWin.IsShown;
                    if (!DockActive)
                    {
                        if (_inElmRun) OpenArrivalDock();
                        else _pendingArrivalDock = true;
                    }
                    if (_wmStack != null)
                    {
                        if (!_samsungHomeRequested && !realScreensaver) _wmStack.ActivateShield(4500);
                        _wmStack.EnsureStack(true);
                    }
                    break;
                case IdleAction.Hide:
                    _pendingArrivalDock = false;
                    if (_idleModel.HoldOcclusionForScreensaver)
                    {
                        _idleWin.ParkForScreensaver();
                        if (_wmStack != null)
                        {
                            _wmStack.IdleShown = _idleWin.IsParkedForScreensaver;
                            _wmStack.LaunchingApp = false;
                            _wmStack.EnsureStack(true);
                        }
                    }
                    else
                    {
                        _idleWin.SetScreensaverOverlay(false);
                        _idleWin.SetInteractiveFocus(false);
                        _idleWin.Hide();
                        // Restore steady-state Layer 200 in the background after hiding.
                        if (_wmStack != null)
                        {
                            _wmStack.IdleShown = false;
                            _wmStack.LaunchingApp = launchSuppressed;
                            if (!_samsungHomeRequested) _wmStack.EnsureStack(false);
                        }
                    }
                    break;
                case IdleAction.Dim:
                    _idleWin.SetDimmed(true);
                    break;
                case IdleAction.TriggerLcdOff:
                    _idleWin.SetDimmed(true);
                    TurnScreenOff();
                    if (_idleLcdVerifyTimer != IntPtr.Zero) Efl.ecore_timer_del(_idleLcdVerifyTimer);
                    _idleLcdVerifyTimer = Efl.ecore_timer_add(1.5, IdleLcdVerifyCb, IntPtr.Zero);
                    break;
            }

            if (enteredTakeover)
            {
                Log("idle: entering global screensaver takeover (src=" + src + " full=" + (fullApp ?? "") + ")");
                _idleWin.SetScreensaverOverlay(true);
                _idleWin.SetInteractiveFocus(true);
                HideTunerForScreensaverTakeover();
                TriggerScreensaverActivityReset(now, 0.0, dismissActive: true);
                if (_wmStack != null) _wmStack.EnsureStack(2500);
                _fastIdleWatchUntil = Math.Max(_fastIdleWatchUntil, now + 3.5);
            }
            else if (realScreensaver && _idleConfig.SuppressScreensaver && !takeoverNow && _idleModel.Visible)
            {
                TriggerScreensaverActivityReset(now, 0.5, dismissActive: true);
            }

            if (_guardApps != null && _idleModel.ShouldDismissGuardedHome(snap, now))
            {
                _fastIdleWatchUntil = Math.Max(_fastIdleWatchUntil, now + 2.5);
                string dyingApp = "";
                if (!launchSuppressed)
                {
                    dyingApp = _idleModel.GuardedHomeDyingAppId;
                    if (string.IsNullOrEmpty(dyingApp)) dyingApp = _idleModel.TeardownHoldAppId;
                    if (string.IsNullOrEmpty(dyingApp) && IdleBackdropModel.IsGuardedSamsungHome(fullApp))
                    {
                        string prevApp = Efl.VconfGetString("memory/appfw/previous_fullscreen_appid");
                        if (!string.IsNullOrEmpty(prevApp)
                            && prevApp != IdleBackdropModel.TvViewerAppId
                            && !IdleBackdropModel.IsGuardedSamsungHome(prevApp)
                            && !IdleBackdropModel.IsScreensaverApp(prevApp))
                            dyingApp = prevApp;
                    }
                }
                bool allowCloseDying = !launchSuppressed && !_samsungHomeRequested && (now - _lastAppHomePress) > AppHomeProtectSeconds;
                DismissUnrequestedHome(fullApp, snap.PartialAppId, dyingApp, allowCloseDying, launchSuppressed);
            }

            // Defensive invariant: keep _idleWin synchronized with _idleModel (Visible vs HoldOcclusionForScreensaver vs Hidden).
            if (_idleModel.HoldOcclusionForScreensaver)
            {
                if (!_idleWin.IsParkedForScreensaver) _idleWin.ParkForScreensaver();
            }
            else if (!_idleModel.Visible && (_idleWin.IsShown || _idleWin.IsParkedForScreensaver))
            {
                _idleWin.SetScreensaverOverlay(false);
                _idleWin.SetInteractiveFocus(false);
                _idleWin.Hide();
            }
            else if (_idleModel.Visible && !_idleWin.IsShown)
            {
                _idleWin.SetScreensaverOverlay(takeoverNow);
                _idleWin.Show(launchSuppressed ? false : _idleModel.Dimmed, (launchSuppressed || takeoverNow) ? false : DockActive, canRaise || takeoverNow);
                if (takeoverNow) _idleWin.SetInteractiveFocus(true);
            }
            if (_wmStack != null) _wmStack.IdleShown = _idleWin.IsShown || _idleWin.IsParkedForScreensaver;

            if (_idleWin.IsShown && !displayOff) _idleWin.SyncClock();

            if (woke)
            {
                Log("idle: wake restack visible=" + _idleModel.Visible + " str=" + strResumed + " pm=" + pm);
                _idleWin.SetDimmed(false);
                if (_idleModel.Visible && !realScreensaver)
                {
                    if (_wmStack != null && !_samsungHomeRequested) _wmStack.ActivateShield(3000);
                    if (IdleBackdropModel.ShouldRaiseBackdrop(DockActive, padOpen, pillOpen, _lastPartialApp, _samsungHomeRequested, now < _backReleaseUntil)) _idleWin.Raise();
                    else if (DockActive) RaiseActiveDockWin();
                    if (_wmStack != null) _wmStack.EnsureStack(2500);
                    _fastIdleWatchUntil = Math.Max(_fastIdleWatchUntil, now + 2.5);
                }
            }

            bool activeGuardedDismiss = guardedHomeActive && (action != IdleAction.None || now < _fastIdleWatchUntil);
            if (activeGuardedDismiss && _idleModel.Visible && !launchSuppressed && !realScreensaver)
            {
                if (_wmStack != null) _wmStack.ActivateShield(3000);
                if (IdleBackdropModel.ShouldRaiseBackdrop(DockActive, padOpen, pillOpen, _lastPartialApp, _samsungHomeRequested, now < _backReleaseUntil)) _idleWin.Raise();
                else if (DockActive) RaiseActiveDockWin();
            }

            if (_wmStack != null
                && (_idleModel.Visible || _idleModel.HoldOcclusionForScreensaver)
                && (_idleWin.IsShown || _idleWin.IsParkedForScreensaver)
                && !displayOff
                && !launchSuppressed)
            {
                if (woke || activeGuardedDismiss || takeoverNow || action != IdleAction.None || !_wmStack.IsActive || now >= _nextSteadyStackCheckAt)
                {
                    _nextSteadyStackCheckAt = now + SteadyStackCheckSeconds;
                    _wmStack.EnsureStack(0);
                }
            }
            if (realScreensaver || _idleModel.HoldOcclusionForScreensaver || takeoverNow) SyncBackClaim();
            else if (_anim != IntPtr.Zero || action != IdleAction.None) ScheduleSyncBackClaim(0.02);
            else SyncBackClaim();

            double postNow = Efl.ecore_time_get();
            SyncScreensaverSuppressionKeepalive(postNow);
            if (displayOff) UpdateIdleWatchTimer(0.15);
            else if (postNow < _backHoldFastUntil && !_idleModel.Visible && !_idleModel.HoldOcclusionForScreensaver) UpdateIdleWatchTimer(0.02);
            else if (IdleBackdropModel.ShouldPollFastIdle(postNow, _fastIdleWatchUntil, src, fullApp, _idleModel.Visible, _idleModel.HoldOcclusionForScreensaver, realScreensaver, guardedHomeActive)) UpdateIdleWatchTimer(0.10);
            else if (_idleModel.IsLaunchSuppressed(postNow)) UpdateIdleWatchTimer(0.25);
            else if (_idleModel.Visible && _idleWin.IsShown && !displayOff && _vconfFullscreenSubscribed && !guardedHomeActive && !_idleModel.IsLaunchSuppressed(postNow) && postNow >= _fastIdleWatchUntil) UpdateIdleWatchTimer(3.0);
            else if (src <= 0 || _idleModel.Visible || _idleModel.HoldOcclusionForScreensaver) UpdateIdleWatchTimer(1.5);
            else UpdateIdleWatchTimer(5.0);
        }

        private static readonly Efl.TaskCb ScreensaverWakeReleaseCb = OnScreensaverWakeRelease;

        private static void CancelScreensaverWakeReleaseTimer()
        {
            if (_screensaverWakeReleaseTimer != IntPtr.Zero)
            {
                Efl.ecore_timer_del(_screensaverWakeReleaseTimer);
                _screensaverWakeReleaseTimer = IntPtr.Zero;
            }
        }

        private static void HideTunerForScreensaverTakeover()
        {
            int fd = Libc.open(TunerPipe, Libc.O_WRONLY | Libc.O_NONBLOCK);
            if (fd < 0) return;
            try
            {
                byte[] b = System.Text.Encoding.ASCII.GetBytes("hide\n");
                Libc.write(fd, b, (UIntPtr)b.Length);
                Log("tuner: hide (screensaver takeover)");
            }
            catch (Exception) { }
            finally { Libc.close(fd); }
        }

        private static void ArmScreensaverTakeoverWakeRelease(double now)
        {
            if (_screensaverWakePendingRelease) return;
            _screensaverWakePendingRelease = true;
            _fastIdleWatchUntil = Math.Max(_fastIdleWatchUntil, now + 1.5);
            CancelScreensaverWakeReleaseTimer();
            _screensaverWakeReleaseTimer = Efl.ecore_timer_add(0.35, ScreensaverWakeReleaseCb, IntPtr.Zero);
        }

        private static byte OnScreensaverWakeRelease(IntPtr data)
        {
            _screensaverWakeReleaseTimer = IntPtr.Zero;
            CompleteScreensaverTakeoverWake(true);
            return 0;
        }

        private static void CompleteScreensaverTakeoverWake(bool resumeTuner)
        {
            CancelScreensaverWakeReleaseTimer();
            _screensaverWakePendingRelease = false;
            bool wasTakeover = (_idleModel != null && _idleModel.ScreensaverTakeoverActive) || _wasScreensaverTakeoverActive;
            _wasScreensaverTakeoverActive = false;
            if (_idleModel == null) return;
            double now = Efl.ecore_time_get();
            IdleAction act = _idleModel.DismissScreensaverTakeover(now);
            if (!wasTakeover && act == IdleAction.None) return;
            Log("idle: screensaver takeover dismissed (resumeTuner=" + resumeTuner + ")");
            CancelIdleTimers();
            CancelPendingScreenOff();
            if (_idleWin != null)
            {
                _idleWin.SetScreensaverOverlay(false);
                _idleWin.SetInteractiveFocus(false);
                _idleWin.Hide();
            }
            if (_wmStack != null)
            {
                _wmStack.ScreensaverTakeover = false;
                _wmStack.IdleShown = false;
                _wmStack.EnsureStack(false);
            }
            TriggerScreensaverActivityReset(now, 0.0, dismissActive: true);
            SyncBackClaim();
            _fastIdleWatchUntil = Math.Max(_fastIdleWatchUntil, now + 2.5);
            UpdateIdleWatchTimer(0.10);
            if (resumeTuner) ResumeTuner("screensaver takeover dismissed");
        }

        private static bool PreserveWarmCsfs()
        {
            return _idleWin != null
                && _idleConfig != null
                && _idleConfig.Mode != IdleMode.Off
                && _wmStack != null
                && _wmStack.IsActive
                && _homeLaunch == null;
        }

        private static void DismissUnrequestedHome(string fullApp, string partialApp, string dyingApp = "", bool allowCloseDying = false, bool launchSuppressed = false)
        {
            if (_guardApps == null || _guardApps.Length == 0) return;
            if (_wmStack != null && !launchSuppressed && !_wmStack.LaunchingApp) _wmStack.ActivateShield(3000);
            if (System.Threading.Interlocked.CompareExchange(ref _dismissHomeInFlight, 1, 0) != 0) return;

            if (launchSuppressed)
            {
                dyingApp = "";
                allowCloseDying = false;
            }
            if (allowCloseDying && !string.IsNullOrEmpty(dyingApp) && Catalog.ValidAppId(dyingApp))
            {
                _lastForceClosedAppId = dyingApp;
            }
            bool preserveCsfs = PreserveWarmCsfs();
            List<string> targets = IdleBackdropModel.FilterDismissHomeTargets(_guardApps, fullApp, preserveCsfs, Catalog.ValidAppId);
            bool needRestore = !_samsungHomeRequested && IdleBackdropModel.IsGuardedSamsungHome(fullApp);
            if (targets.Count == 0 && !needRestore)
            {
                System.Threading.Volatile.Write(ref _dismissHomeInFlight, 0);
                return;
            }

            int gen = _guardGen;
            int restoreGen = System.Threading.Volatile.Read(ref _dismissRestoreGen);
            System.Threading.Tasks.Task.Run(() =>
            {
                bool closeTracked = false;
                string closeDyingApp = "";
                long startedAt = Stopwatch.GetTimestamp();
                try
                {
                    string genCheck = "";
                    if (!string.IsNullOrEmpty(_guardFile))
                    {
                        try
                        {
                            EnsureGuardFile();
                            genCheck = "[ \"$(cat '" + _guardFile.Replace("'", "'\\''") + "' 2>/dev/null)\" = "
                                + gen.ToString(System.Globalization.CultureInfo.InvariantCulture) + " ] || exit 0; ";
                        }
                        catch (Exception ex) { Log("idle: guard gen: " + ex.Message); }
                    }

                    string restoreGenCheck = "";
                    if (!string.IsNullOrEmpty(_dismissRestoreFile))
                    {
                        try
                        {
                            EnsureDismissRestoreFile(restoreGen);
                            restoreGenCheck = "[ \"$(cat '" + _dismissRestoreFile.Replace("'", "'\\''") + "' 2>/dev/null)\" = "
                                + restoreGen.ToString(System.Globalization.CultureInfo.InvariantCulture) + " ] || exit 0; ";
                        }
                        catch (Exception ex) { Log("idle: restore gen: " + ex.Message); }
                    }

                    var comms = new List<string>(3);
                    if (targets.Contains("com.samsung.tv.home.sidebar")) comms.Add("DN_home.sidebar");
                    if (targets.Contains("com.samsung.tv.csfs")) comms.Add("DN_sung.tv.csfs");
                    if (targets.Contains("com.samsung.tv.home.media")) comms.Add("DN_v.home.media");
                    string fastKill = comms.Count > 0
                        ? "for p in /proc/[0-9]*; do read -r c < \"$p/comm\" 2>/dev/null || continue; case \"$c\" in "
                            + string.Join("|", comms.ToArray()) + ") kill -9 \"${p#/proc/}\" 2>/dev/null ;; esac; done"
                        : "";

                    var killSb = new System.Text.StringBuilder();
                    for (int i = 0; i < targets.Count; i++)
                    {
                        if (i > 0) killSb.Append("; ");
                        killSb.Append("/usr/bin/app_launcher -k ").Append(targets[i]);
                    }
                    string singleKill = killSb.ToString();
                    string killBody = (fastKill.Length > 0 ? fastKill + (singleKill.Length > 0 ? "; " : "") : "") + singleKill;
                    string stepCmd = killBody.Length > 0 ? (genCheck + killBody) : "";
                    string restoreFirst = (!_samsungHomeRequested && !launchSuppressed)
                        ? IdleBackdropModel.BuildGuardedHomeRestoreCommand(fullApp, dyingApp, Catalog.ValidAppId, restoreGenCheck, allowCloseDying)
                        : "";
                    string restoreTail = (!_samsungHomeRequested && !launchSuppressed)
                        ? IdleBackdropModel.BuildGuardedHomeRestoreCommand(fullApp, dyingApp, Catalog.ValidAppId, restoreGenCheck, false)
                        : "";
                    string initialKillCmd = stepCmd.Length > 0 ? "(" + stepCmd + ") >/dev/null 2>&1" : "";
                    string waveFollowCmd = stepCmd.Length > 0 ? "(for d in 0.15 0.35 0.55; do sleep $d; " + stepCmd + "; done) >/dev/null 2>&1" : "";
                    closeTracked = !_samsungHomeRequested && _closeTracker.TryBegin(restoreGen, dyingApp, allowCloseDying, fullApp);
                    closeDyingApp = closeTracked ? dyingApp : "";
                    string readDyingPidCmd = !string.IsNullOrEmpty(closeDyingApp)
                        ? IdleBackdropModel.BuildReadAppPidCommand(closeDyingApp, Catalog.ValidAppId)
                        : "";
                    Log("idle: dismiss guarded home full=" + (fullApp ?? "") + " partial=" + (partialApp ?? "") + " warmCsfs=" + preserveCsfs + (launchSuppressed ? " launch=True" : "") + (string.IsNullOrEmpty(dyingApp) ? "" : " dying=" + dyingApp));

                    string dyingPid = "";
                    if (!string.IsNullOrEmpty(readDyingPidCmd)
                        && System.Threading.Volatile.Read(ref _dismissRestoreGen) == restoreGen)
                    {
                        dyingPid = (Shell.Read(readDyingPidCmd) ?? "").Trim();
                    }
                    if (closeTracked) _closeTracker.MarkPidCaptured(restoreGen, closeDyingApp, dyingPid);
                    if (initialKillCmd.Length > 0) Libc.system(initialKillCmd);
                    if (!string.IsNullOrEmpty(restoreFirst)
                        && System.Threading.Volatile.Read(ref _dismissRestoreGen) == restoreGen)
                    {
                        Libc.system(restoreFirst);
                        if (_wmStack != null) _wmStack.EnsureStack(false);
                    }
                    System.Threading.Tasks.Task waveTask = waveFollowCmd.Length > 0
                        ? System.Threading.Tasks.Task.Run(() => { try { Libc.system(waveFollowCmd); } catch (Exception) { } })
                        : null;
                    if (!string.IsNullOrEmpty(dyingPid)
                        && !string.IsNullOrEmpty(closeDyingApp))
                    {
                        while (System.Threading.Volatile.Read(ref _dismissRestoreGen) == restoreGen)
                        {
                            double elapsedMs = (Stopwatch.GetTimestamp() - startedAt) * 1000.0 / Stopwatch.Frequency;
                            if (elapsedMs >= 1400.0) break;
                            int sliceMs = Math.Min(200, Math.Max(20, (int)Math.Ceiling(1400.0 - elapsedMs)));
                            System.Threading.Thread.Sleep(sliceMs);
                        }
                        if (System.Threading.Volatile.Read(ref _dismissRestoreGen) == restoreGen)
                        {
                            string closeDyingCmd = IdleBackdropModel.BuildCloseStuckAppCommand(closeDyingApp, dyingPid, Catalog.ValidAppId, restoreGenCheck);
                            if (!string.IsNullOrEmpty(closeDyingCmd))
                            {
                                string killed = (Shell.Read(closeDyingCmd) ?? "").Trim();
                                if (killed == "KILLED") Log("idle: closed stuck dying app " + closeDyingApp + " pid=" + dyingPid);
                            }
                        }
                    }
                    else if (!string.IsNullOrEmpty(restoreTail))
                    {
                        // Ensure ~0.45 s tail settle check when csfs was warm or no dying PID remained so late csfs foreground flips to tv-viewer.
                        while (System.Threading.Volatile.Read(ref _dismissRestoreGen) == restoreGen)
                        {
                            double elapsedMs = (Stopwatch.GetTimestamp() - startedAt) * 1000.0 / Stopwatch.Frequency;
                            if (elapsedMs >= 450.0) break;
                            int sliceMs = Math.Min(150, Math.Max(20, (int)Math.Ceiling(450.0 - elapsedMs)));
                            System.Threading.Thread.Sleep(sliceMs);
                        }
                    }
                    if (waveTask != null)
                    {
                        try { waveTask.Wait(); } catch (Exception) { }
                    }
                    if (!string.IsNullOrEmpty(restoreTail)
                        && System.Threading.Volatile.Read(ref _dismissRestoreGen) == restoreGen)
                    {
                        Libc.system(restoreTail);
                    }
                }
                catch (Exception ex) { Log("idle: dismiss home: " + ex.Message); }
                finally
                {
                    if (closeTracked) _closeTracker.MarkCompleted(restoreGen, closeDyingApp);
                    System.Threading.Volatile.Write(ref _dismissHomeInFlight, 0);
                }
                if (System.Threading.Volatile.Read(ref _dismissRestoreGen) == restoreGen && (gen == 0 || _guardGen == gen)) HomePictureOff();
                if (_wmStack != null) _wmStack.EnsureStack(true);
            });
        }

        private static void RaiseActiveDockWin()
        {
            IntPtr activeWin = (_tasksOn && _taskWin != IntPtr.Zero) ? _taskWin : _win;
            if (activeWin != IntPtr.Zero)
            {
                Efl.elm_win_raise(activeWin);
                if (DockActive) Efl.elm_win_activate(activeWin);
            }
        }

        private static byte OnIdleWatch(IntPtr data)
        {
            if (_anim != IntPtr.Zero && !_wasDisplayOff) return 1;
            try { PollIdleBackdrop(); } catch (Exception ex) { Log("idle watch: " + ex.Message); }
            return 1;
        }

        private static byte OnIdleLcdVerify(IntPtr data)
        {
            _idleLcdVerifyTimer = IntPtr.Zero;
            try
            {
                if (_idleModel == null || _idleWin == null) return 0;
                int pm = 1;
                try { if (Efl.vconf_get_int("memory/pm/state", out pm) != 0) pm = 1; } catch (Exception) { pm = 1; }
                if (_idleModel.OnLcdOffVerify(pm) == IdleAction.FallbackDim) _idleWin.SetDimmed(true);
            }
            catch (Exception ex) { Log("idle lcd verify: " + ex.Message); }
            return 0;
        }

        // ------------------------------------------------------------------ logging

        // The process stays resident for weeks, so the file is cut down as it grows and not only at start. Callbacks run
        // on the main loop, but the lock keeps the byte count and the file in step if anything else ever logs.
        private static readonly object LogLock = new object();
        private const long LogLimit = 256 * 1024;
        private static long _logBytes;

        private static void Log(string m)
        {
            try
            {
                string line = DateTime.Now.ToString("HH:mm:ss.fff") + " " + m + "\n";
                lock (LogLock)
                {
                    _logBytes += System.Text.Encoding.UTF8.GetByteCount(line);
                    if (_logBytes > LogLimit)
                    {
                        _logBytes = System.Text.Encoding.UTF8.GetByteCount(line);
                        try { File.Delete(_logPath); } catch (Exception) { }
                    }
                    File.AppendAllText(_logPath, line);
                }
            }
            catch (Exception) { }
        }

        private static void TrimLog()
        {
            try
            {
                lock (LogLock)
                {
                    var f = new FileInfo(_logPath);
                    if (f.Exists && f.Length > LogLimit) { f.Delete(); _logBytes = 0; }
                    else _logBytes = f.Exists ? f.Length : 0;
                }
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
                Libc.setenv("ECORE_EVAS_COMP_NOSYNC", "0", 0);
                Libc.setenv("ECORE_VSYNC_DRM_ALL", "0", 0);
                Libc.setenv("ECORE_EVAS_GL_SYNC_DRAW_DONE", "0", 0);
                Libc.setenv("EVAS_GL_PARTIAL_DISABLE", "0", 0);
            }
            return egl ? "wayland_egl" : "wayland_shm";
        }

        private static string PromoteRealtimeScheduler()
        {
            if (Environment.OSVersion.Platform != PlatformID.Unix) return "skip";
            try
            {
                var p = new Libc.SchedParam { sched_priority = 8 };
                int rc = Libc.sched_setscheduler(0, Libc.SCHED_RR | Libc.SCHED_RESET_ON_FORK, ref p);
                return rc == 0 ? "rr=8" : "errno=" + Marshal.GetLastWin32Error();
            }
            catch (Exception ex) { return "err=" + ex.Message; }
        }

        internal static void PromoteRenderThreads()
        {
            if (Environment.OSVersion.Platform != PlatformID.Unix) return;
            try
            {
                int selfPid = Libc.getpid();
                var p = new Libc.SchedParam { sched_priority = 8 };
                foreach (string dir in Directory.GetDirectories("/proc/self/task"))
                {
                    int tid;
                    if (!int.TryParse(Path.GetFileName(dir), out tid) || tid <= 0) continue;
                    bool want = tid == selfPid;
                    if (!want)
                    {
                        string comm = ReadTextFn(Path.Combine(dir, "comm")).Trim();
                        want = comm == "Eanimator-vsync" || comm == "wl_egl_thread" || comm == "mali-cmar-backe";
                    }
                    if (want) Libc.sched_setscheduler(tid, Libc.SCHED_RR | Libc.SCHED_RESET_ON_FORK, ref p);
                }
            }
            catch (Exception) { }
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
                ReleaseBackClaimOnExit();
                int pid;
                if (File.Exists(_pidPath) && int.TryParse(File.ReadAllText(_pidPath).Trim(), out pid)
                    && pid == Libc.getpid())
                {
                    File.Delete(_pidPath);
                    Libc.unlink(_fifoPath);
                    if (_fifoReadyPath != null) Libc.unlink(_fifoReadyPath);
                    if (_claimPath != null) Libc.unlink(_claimPath);
                    if (_longpressPath != null) Libc.unlink(_longpressPath);
                }
                if (_dockMapped) OverlayFlag.Mark(OverlayFlag.DockPath, false, null);
                if (_pad != null && _pad.IsOnScreen) OverlayFlag.Mark(OverlayFlag.PadPath, false, null);
            }
            catch (Exception) { }
        }

        private static readonly byte[] SmackStar = { (byte)'*' };

        private static void SetupFifo()
        {
            Libc.unlink(_fifoPath);
            if (Libc.mkfifo(_fifoPath, 438u) != 0) { Log("mkfifo failed: " + Marshal.GetLastWin32Error()); return; }
            Libc.chmod(_fifoPath, 438u);   // 0666: it only accepts show/hide/toggle
            // On Tizen 9 SMACK enforcing, /home/owner transmutes new files to User::Home (rxl-only for User::Pkg::vetrotvapp),
            // blocking wrt-service from writing volume/123 commands to the FIFO. Labeling the FIFO "*" (matching /tmp) lets
            // the unprivileged service write directly; safely ignored on non-SMACK systems.
            Libc.setxattr(_fifoPath, "security.SMACK64", SmackStar, (UIntPtr)SmackStar.Length, 0);
            // O_RDWR keeps a writer open ourselves, so the descriptor never reports EOF when a client disconnects.
            _fifoFd = Libc.open(_fifoPath, Libc.O_RDWR | Libc.O_NONBLOCK);
            if (_fifoFd < 0) { Log("open fifo failed: " + Marshal.GetLastWin32Error()); return; }
            _fifoHandler = Efl.ecore_main_fd_handler_add(_fifoFd, Efl.EcoreFdRead, FifoCb, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
            if (_fifoReadyPath != null)
            {
                try
                {
                    File.WriteAllText(_fifoReadyPath, Libc.getpid().ToString(System.Globalization.CultureInfo.InvariantCulture));
                    Libc.chmod(_fifoReadyPath, 420u);   // 0644
                    Libc.setxattr(_fifoReadyPath, "security.SMACK64", SmackStar, (UIntPtr)SmackStar.Length, 0);
                }
                catch (Exception ex) { Log("fifo ready: " + ex.Message); }
            }
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
            // The remote's nodes come and go: it reconnects after standby, and Vetro creates its forwarding
            // node some time after this process started. A node that appears later is picked up here.
            _rescanTimer = Efl.ecore_timer_add(RescanSeconds, RescanCb, IntPtr.Zero);
            WatchInputDir();
        }

        // inotify on /dev/input (idea and first version: BirikuSistema, vetro-bar, issue #219): a remote that comes back after standby
        // is watched about 80 ms after its node appears, instead of at the next look of the timer above (up to RescanSeconds). The kernel
        // wakes the main loop only when the directory changes; nothing runs meanwhile. Without inotify the timer alone does it, as before.
        private static int _inotifyFd = -1;
        private static IntPtr _inotifyHandler, _inotifyTimer;
        private static readonly Efl.FdCb InotifyCb = OnInotify;
        private static readonly Efl.TaskCb InotifyLookCb = OnInotifyLook;
        private const double InotifyDelaySeconds = 0.08;   // udev gives the node its permissions just after creating it

        private static void WatchInputDir()
        {
            try
            {
                int fd = Libc.inotify_init1(Libc.IN_NONBLOCK);
                if (fd < 0) { Log("input: no inotify (errno " + Marshal.GetLastWin32Error() + "), the look every " + RescanSeconds + " s finds new nodes"); return; }
                if (Libc.inotify_add_watch(fd, "/dev/input", Libc.IN_CREATE | Libc.IN_ATTRIB | Libc.IN_MOVED_TO) < 0)
                {
                    Log("input: cannot watch /dev/input (errno " + Marshal.GetLastWin32Error() + ")");
                    Libc.close(fd);
                    return;
                }
                _inotifyHandler = Efl.ecore_main_fd_handler_add(fd, Efl.EcoreFdRead, InotifyCb, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
                if (_inotifyHandler == IntPtr.Zero) { Libc.close(fd); return; }
                _inotifyFd = fd;
                Log("input: /dev/input watched with inotify");
            }
            catch (Exception ex) { Log("input: inotify: " + ex.Message); }
        }

        private static readonly byte[] InotifyBuf = new byte[1024];

        private static byte OnInotify(IntPtr data, IntPtr handler)
        {
            try
            {
                // Only "something changed" matters: the events are drained, and one look follows shortly (a burst of events makes one look).
                for (int round = 0; round < 8 && (long)Libc.read(_inotifyFd, InotifyBuf, (UIntPtr)InotifyBuf.Length) > 0; round++) { }
                ScanGate.Force();
                if (_inotifyTimer == IntPtr.Zero) _inotifyTimer = Efl.ecore_timer_add(InotifyDelaySeconds, InotifyLookCb, IntPtr.Zero);
            }
            catch (Exception ex) { Log("input: inotify: " + ex.Message); }
            return 1;
        }

        private static byte OnInotifyLook(IntPtr data)
        {
            _inotifyTimer = IntPtr.Zero;   // returning 0 makes ecore free the timer
            try
            {
                int added = WatchNewNodes();
                if (added > 0) Log("input: new node seen through inotify");
                if ((added > 0 || _wasDisplayOff) && _idleWin != null) PollIdleBackdrop();
            }
            catch (Exception ex) { Log("input: inotify look: " + ex.Message); }
            return 0;
        }

        /// <summary>Opens every remote node that is not being watched yet. Returns how many were added.</summary>
        private static int WatchNewNodes()
        {
            List<string> nodes;
            try { nodes = InputDevices.RemoteNodes(File.ReadAllText("/proc/bus/input/devices")); }
            catch (Exception ex) { if (!_listFailed) Log("input: cannot list devices: " + ex.Message); _listFailed = true; return 0; }
            _listFailed = false;
            int added = 0;
            foreach (string node in nodes)
            {
                if (_inputPaths.Contains(node)) continue;
                int fd = Libc.open(node, Libc.O_RDONLY | Libc.O_NONBLOCK);
                if (fd < 0)
                {
                    // The rescan comes back every few seconds: say it once per node, or the log fills with the same line.
                    if (_openFailed.Add(node)) Log("input: cannot open " + node + " errno=" + Marshal.GetLastWin32Error());
                    continue;
                }
                _openFailed.Remove(node);
                // A node that went away (DropNode) leaves a free slot: take it, so the lists do not grow with every reconnect.
                int index = _inputFds.IndexOf(-1);
                bool reuse = index >= 0;
                if (!reuse) index = _inputFds.Count;
                IntPtr handler = Efl.ecore_main_fd_handler_add(fd, Efl.EcoreFdRead, InputCb, (IntPtr)index, IntPtr.Zero, IntPtr.Zero);
                if (handler == IntPtr.Zero) { Libc.close(fd); Log("input: cannot watch " + node); continue; }
                if (reuse) { _inputFds[index] = fd; _inputReaders[index] = new EvdevReader(); _inputPaths[index] = node; _inputHandlers[index] = handler; }
                else { _inputFds.Add(fd); _inputReaders.Add(new EvdevReader()); _inputPaths.Add(node); _inputHandlers.Add(handler); }
                added++;
                Log("input: watching " + node);
            }
            return added;
        }
        private static bool _listFailed;
        private static readonly HashSet<string> _openFailed = new HashSet<string>();

        // The look every RescanSeconds reads /proc/bus/input/devices only when /dev/input may have changed (InputScanGate): one stat of the
        // directory instead of the whole device list, for as long as the process lives, hidden or not. The fifo's "rescan" (Vetro's bridge
        // has just made a node) and the look at start always read the list.
        private static readonly InputScanGate ScanGate = new InputScanGate();

        private static long InputDirTicks()
        {
            try { var d = new DirectoryInfo("/dev/input"); return d.Exists ? d.LastWriteTimeUtc.Ticks : 0; }
            catch (Exception) { return 0; }
        }

        private static byte OnRescan(IntPtr data)
        {
            try
            {
                long dir = InputDirTicks();
                if (ScanGate.ShouldRead(dir, DateTime.UtcNow.Ticks))
                {
                    WatchNewNodes();
                    ScanGate.Read(dir, DateTime.UtcNow.Ticks, !_listFailed && _openFailed.Count == 0);
                }
            }
            catch (Exception ex) { Log("input: rescan: " + ex.Message); ScanGate.Force(); }
            return 1;
        }

        /// <summary>A node that was unplugged (the remote went to sleep) stops being watched; it is opened again when it returns.</summary>
        private static void DropNode(int index)
        {
            if (_inputFds[index] < 0) return;
            Log("input: lost " + _inputPaths[index]);
            ScanGate.Force();   // the next look reads the list: the node may come back without the directory changing
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

        /// <summary>Whichever page is on screen is showing (or coming in).</summary>
        private static bool DockActive { get { return _tasksOn ? CardsActive : (_ctl != null && _ctl.IsActive); } }

        // ------------------------------------------------------------------ Control center cards

        /// <summary>The position of the first card of kind <paramref name="k"/>, -1 without one.</summary>
        private static int CardAt(CardKind k) { return _cards == null ? -1 : Array.FindIndex(_cards, c => c.Kind == k); }
        private static bool HasCard(CardKind k) { return CardAt(k) >= 0; }
        private static CardKind FocusedCard { get { return _cards == null || _cards.Length == 0 ? CardKind.Tasks : _cards[_cardFocus].Kind; } }
        private static TaskController FocusedCtl { get { return _cardCtl == null || _cardCtl.Length == 0 ? _tasksCtl : _cardCtl[_cardFocus]; } }
        /// <summary>The cards open, fade and close together: the first one stands for all of them.</summary>
        private static TaskController LeadCtl { get { return _cardCtl == null || _cardCtl.Length == 0 ? _tasksCtl : _cardCtl[0]; } }
        private static bool CardsActive { get { TaskController lead = LeadCtl; return lead != null && lead.IsActive; } }

        private static void OpenCards(float pop) { foreach (TaskController c in _cardCtl) c.Open(pop); }
        private static bool HideCards() { bool any = false; foreach (TaskController c in _cardCtl) any |= c.Hide(); return any; }
        private static void DropCards() { foreach (TaskController c in _cardCtl) c.Drop(); }
        private static bool TickCards(double dt) { bool more = false; foreach (TaskController c in _cardCtl) more |= c.Tick(dt); return more; }

        private static void ShowCards(bool on)
        {
            if (HasCard(CardKind.Tasks)) _taskPanel.SetVisible(on);
            if (HasCard(CardKind.Audio)) _audioCard.SetVisible(on);
            foreach (ChoiceCard c in _choiceCards) if (c != null) c.SetVisible(on);
        }

        /// <summary>
        /// Draws every card; only the focused one shows its capsule. Side by side they always stand <see cref="TaskLayout.MaxRows"/> rows tall,
        /// whatever their lists hold: an app that starts or ends, a Bluetooth device that connects or a choice card's answer used to grow or
        /// shrink every card while the Control center was open. A longer list scrolls. A single card is as tall as its own list.
        /// </summary>
        private static void ApplyCards()
        {
            if (_cards.Length > 1)
            {
                const int rows = TaskLayout.MaxRows;
                if (HasCard(CardKind.Tasks)) _taskPanel.Layout.ShowRows = rows;
                if (HasCard(CardKind.Audio)) _audioCard.Layout.ShowRows = rows;
                foreach (ChoiceCard c in _choiceCards) if (c != null) c.Layout.ShowRows = rows;
            }
            if (HasCard(CardKind.Tasks)) _taskPanel.Apply(_tasksCtl, FocusedCard == CardKind.Tasks);
            if (HasCard(CardKind.Audio)) _audioCard.Apply(_audioCtl, FocusedCard == CardKind.Audio);
            for (int i = 0; i < _choiceCards.Length; i++) if (_choiceCards[i] != null) _choiceCards[i].Apply(_cardCtl[i], i == _cardFocus);
        }

        // The window is mapped for the Dock or the Task manager (not for the start-up pre-map): its flag (OverlayFlag) tells the tuner the keys
        // are the launcher's. Set when the window is shown, cleared when the fade has ended and the window is hidden.
        private static bool _dockMapped;
        private static double _lastDockFlagMark = -100;

        // The remote's 123 key as evdev reports it. Vetro's osd 123 holds it back in the remote bridge, so when it is read here Samsung's own
        // 123 pad is opening (Vetro's is off, or the key came on a part of the remote the bridge does not hold).
        private const int Raw123Code = 140;

        private static void MarkDock(bool on)
        {
            _dockMapped = on;
            _lastDockFlagMark = on ? Efl.ecore_time_get() : -100;
            OverlayFlag.Mark(OverlayFlag.DockPath, on, Log);
        }

        // ------------------------------------------------------------------ Vetro TV Tuner

        private const string TunerPipe = "/tmp/vetro-tuner.ctl";
        private static bool _padFromDock;   // the osd 123 was opened over the Dock: its close counts as the Dock's
        private static bool _hideFor123;    // the Dock is going away for Samsung's own 123 pad: the tuner must not come back over it

        /// <summary>
        /// The launcher went away without opening anything (Back, Home, its idle time), or switched to the TV input. The Home key that opened it
        /// also sent Vetro TV Tuner away; the tuner comes back now if live TV is what is on screen (it checks that itself: Takeover.Resume).
        /// Without this, Home then Back left Samsung's own live TV app answering the remote until a CH key. Never sent while a window of ours
        /// is still on screen. A plain non-blocking write: nothing happens when the tuner is not running.
        /// </summary>
        /// <param name="live">The TV input was chosen (Live TV tile, Sources): "live", so that the tuner also leaves a Samsung TV Plus channel
        /// that Samsung's app resumed (the TV input alone keeps it).</param>
        private static void ResumeTuner(string why, bool live = false)
        {
            if (_dockMapped || (_pad != null && _pad.IsOnScreen)) return;
            int fd = Libc.open(TunerPipe, Libc.O_WRONLY | Libc.O_NONBLOCK);
            if (fd < 0) return;
            try
            {
                byte[] b = System.Text.Encoding.ASCII.GetBytes(live ? "live\n" : "resume\n");
                Libc.write(fd, b, (UIntPtr)b.Length);
                Log("tuner: " + (live ? "live" : "resume") + " (" + why + ")");
            }
            finally { Libc.close(fd); }
        }

        /// <summary>A launch that leaves the viewer on live TV: the TV input, or Samsung's live TV app itself (excluding TV Plus).</summary>
        private static bool StaysOnLiveTv(AppEntry e) { return e == null || e.SourceType == 0 || (e.AppId == "org.tizen.tv-viewer" && e.Slug != "tvplus" && e.RowKey != "live:TVPLUS"); }

        /// <summary>True when launching <paramref name="e"/> opens a real fullscreen app rather than Live TV or a key/system overlay (e.g. Settings).</summary>
        private static bool UsesIdleLaunchCurtain(AppEntry e)
        {
            return e != null
                && !StaysOnLiveTv(e)
                && string.IsNullOrEmpty(e.Key)
                && !WmStackLogic.IsSystemOverlayAppId(e.AppId);
        }

        private static void ShowDock(bool userInitiated = true)
        {
            if (_homeLaunch != null) return;   // custom launcher mode: nothing of ours is ever drawn
            if (userInitiated && !DockActive) WakeOrResetScreensaverForUserAction(true);
            if (_idleModel != null && !_idleModel.Visible && !_idleModel.HoldOcclusionForScreensaver)
            {
                string fg = Efl.VconfGetString(FullscreenAppIdKey);
                if (!string.IsNullOrEmpty(fg)
                    && fg != IdleBackdropModel.TvViewerAppId
                    && !IdleBackdropModel.IsGuardedSamsungHome(fg)
                    && !IdleBackdropModel.IsScreensaverApp(fg)
                    && Catalog.ValidAppId(fg))
                {
                    _lastPausedAppId = fg;
                }
            }
            _pendingLaunch = null;
            _pendingArrivalDock = false;
            if (_premapTimer != IntPtr.Zero)
            {
                Efl.ecore_timer_del(_premapTimer);
                _premapTimer = IntPtr.Zero;
            }
            // A key chosen just before the dock closed must not be sent into the dock that opens again.
            CancelPendingKey();
            if (_tasksOn)
            {
                if (CardsActive) { ResetIdle(userInitiated); return; }
                LeaveTasks(false);   // it was fading out: the dock comes back on the apps row
            }
            // Lists Vetro wrote while a tile was being moved or the Control center was open are read once the dock has gone
            // (ReloadWhenHidden); a Home pressed before that reads them now, before the dock comes in.
            if (_reloadPending && !_ctl.IsActive) ReloadLists();
            // A dock that was closed from the inputs panel opens on the apps again.
            if (_ctl != _appsCtl && !_ctl.IsActive) ActivatePage(_appsCtl, _appsDock);
            if (_ctl.Phase == Phase.Hidden) _ctl.Reset();
            if (!_ctl.Show()) { ResetIdle(userInitiated); return; }
            // The page may have been put away while its objects were still opaque (a swap to the inputs panel): draw its
            // state for presence 0 before the window is mapped, or one frame can show it whole before the entrance starts.
            _dock.Apply(_ctl);
            _hideFor123 = false;
            MarkDock(true);
            ScheduleSyncBackClaim(0.02);
            if (_idleWin != null) _idleWin.SetDockOverlay(true);
            Efl.evas_object_show(_win);
            Efl.HideCursor(_win, false);
            Efl.elm_win_raise(_win);
            Efl.elm_win_activate(_win);
            ClaimHome();   // once, on the window a real Home press brings up (the claim needs a mapped window)
            StartClock();
            StartAnimator();
            ResetIdle(userInitiated);
            AskForLists();   // after the dock is on its way in: an app installed since the lists were written
        }

        // ------------------------------------------------------------------ lists written again by Vetro (an app installed or removed)

        /// <summary>A file's date, or <see cref="DateTime.MinValue"/> when it is not there.</summary>
        private static DateTime FileDate(string path)
        {
            try { return path != null && File.Exists(path) ? File.GetLastWriteTimeUtc(path) : DateTime.MinValue; }
            catch (Exception) { return DateTime.MinValue; }
        }

        private static IntPtr _listsAskTimer;
        private static readonly Efl.TaskCb ListsAskCb = OnListsAsk;

        /// <summary>
        /// Schedules a background check 0.8 s after the dock opens (never stalling the entrance animation):
        /// if the package database is newer than the lists Vetro wrote, asks Vetro in a worker task to refresh them.
        /// </summary>
        private static void AskForLists()
        {
            if (_allAppsWatch == null || _homeLaunch != null || _listsAskTimer != IntPtr.Zero) return;
            if (Efl.ecore_time_get() - _listsCheckedAt < 10.0) return;
            _listsAskTimer = Efl.ecore_timer_add(0.8, ListsAskCb, IntPtr.Zero);
        }

        private static byte OnListsAsk(IntPtr data)
        {
            if (_anim != IntPtr.Zero) return 1;
            _listsAskTimer = IntPtr.Zero;
            try
            {
                if (_allAppsWatch == null || _homeLaunch != null) return 0;
                double now = Efl.ecore_time_get();
                _listsCheckedAt = now;
                string allAppsWatch = _allAppsWatch;
                int port = ShardLaunch.ServicePort;
                DateTime askedFor = _listsAskedFor;
                double elapsed = now - _listsAskedAt;
                System.Threading.Tasks.Task.Run(() =>
                {
                    try
                    {
                        DateTime db = FileDate(ListWatch.PackageDb);
                        if (!ListWatch.ShouldAsk(db, FileDate(allAppsWatch), askedFor, elapsed)) return;
                        string cmd = ListWatch.Command(port);
                        if (cmd == null) return;
                        _listsAskedFor = db;
                        _listsAskedAt = now;
                        Log("lists: the package database changed, asking Vetro rc=" + Libc.system(cmd));
                    }
                    catch (Exception ex) { Log("lists: " + ex.Message); }
                });
            }
            catch (Exception ex) { Log("lists timer: " + ex.Message); }
            return 0;
        }

        // A reload that waited for a moved tile, a held OK or the Control center runs a moment after the dock has gone, not in front of its
        // next entrance: the frame that hides the window and the launch go first. If the dock comes back before, ShowDock reads the lists.
        private const double ReloadAfterHideSeconds = 0.5;
        private static IntPtr _reloadTimer;
        private static readonly Efl.TaskCb ReloadAfterHideCb = OnReloadAfterHide;

        private static void ReloadWhenHidden()
        {
            if (!_reloadPending || _reloadTimer != IntPtr.Zero) return;
            _reloadTimer = Efl.ecore_timer_add(ReloadAfterHideSeconds, ReloadAfterHideCb, IntPtr.Zero);
        }

        private static byte OnReloadAfterHide(IntPtr data)
        {
            _reloadTimer = IntPtr.Zero;
            try { if (_reloadPending && !_dockMapped && !DockActive && _anim == IntPtr.Zero) ReloadLists(); }
            catch (Exception ex) { Log("lists after hide: " + ex); }
            return 0;
        }

        /// <summary>What an entry of a page is known by across a reload: its row key, or its slug.</summary>
        private static string EntryKey(AppEntry e) { return e.RowKey ?? "slug:" + e.Slug; }

        /// <summary>
        /// Vetro wrote the three lists again (see <see cref="ListWatch"/>): they are read again and the pages whose list differs from what
        /// they show are made again (all three, the window resized for them, when the window's size changes). On screen the same page stays,
        /// its focus on the same entry. While the user moves a tile, holds OK or has the Control center open it waits until the dock has gone.
        /// </summary>
        private static void ReloadLists()
        {
            if (_homeLaunch != null || _appsDock == null) return;
            if (_moveIndex >= 0 || _rowOkTimer != IntPtr.Zero || _tasksOn || _anim != IntPtr.Zero) { _reloadPending = true; Log("lists: reload waits until the dock is free"); return; }
            _reloadPending = false;
            AppEntry[] apps = LoadApps(_appsPath), inputs = LoadList(_inputsPath, Catalog.BuiltInInputs), all = LoadList(_allAppsPath, Catalog.BuiltInAllApps);
            bool sameApps = ListWatch.Same(apps, _apps), sameInputs = ListWatch.Same(inputs, _inputs), sameAll = ListWatch.Same(all, _allApps);
            if (sameApps && sameInputs && sameAll) { Log("lists: read again, nothing changed"); return; }
            ProbeBegin("lists reload");
            long t0 = Stopwatch.GetTimestamp();
            bool shown = _ctl.IsActive, onAll = _ctl == _allCtl, onInputs = _ctl == _inputsCtl;
            AppEntry[] before = onAll ? _allApps : onInputs ? _inputs : _apps;
            int at = _ctl.FocusTarget, inputsCurrent = _inputsDock.CurrentIndex;
            string key = at >= 0 && at < before.Length ? EntryKey(before[at]) : null;
            // The pages as they are: one whose list did not change is kept, with its controller and its place.
            Dock appsDock = _appsDock, inputsDock = _inputsDock, allDock = _allDock, dockBefore = _dock;
            Controller appsCtl = _appsCtl, inputsCtl = _inputsCtl, allCtl = _allCtl, ctlBefore = _ctl;
            DockLayout appsLayout = _appsLayout, inputsLayout = _inputsLayout, allLayout = _allLayout;
            bool editableBefore = _sourcesEditable;
            _apps = apps; _inputs = inputs; _allApps = all;
            PageLayouts();
            // The window keeps its size: an unchanged list is laid out exactly as before (as in RebuildPages), so its page is kept. An
            // installed app usually changes All apps alone, and making the apps row and Sources again prepared every icon of them for nothing.
            bool sameWindow = _appsLayout.WinX == appsLayout.WinX && _appsLayout.WinY == appsLayout.WinY && _appsLayout.WinW == appsLayout.WinW && _appsLayout.WinH == appsLayout.WinH;
            bool keepApps = sameWindow && sameApps, keepAll = sameWindow && sameAll;
            // Sources' hint says whether its inputs can go in the row, which depends on the row too.
            bool keepInputs = sameWindow && sameInputs && RowEdit.CanAddFrom(_inputs, _apps) == editableBefore;
            if (keepApps || keepInputs || keepAll)
            {
                if (keepApps) { _appsLayout = appsLayout; _appsCtl = appsCtl; _appsDock = appsDock; }
                else { appsDock.Destroy(); BuildAppsPage(); }
                if (keepInputs) { _inputsLayout = inputsLayout; _inputsCtl = inputsCtl; _inputsDock = inputsDock; }
                else { inputsDock.Destroy(); BuildInputsPage(); }
                if (keepAll) { _allLayout = allLayout; _allCtl = allCtl; _allDock = allDock; }
                else { allDock.Destroy(); BuildAllPage(); }
            }
            else
            {
                appsDock.Destroy(); inputsDock.Destroy(); allDock.Destroy();
                BuildPages();
                MoveWindow(_appsLayout.WinX, _appsLayout.WinY, _appsLayout.WinW, _appsLayout.WinH);
            }
            if (inputsCurrent < _inputs.Length) _inputsDock.CurrentIndex = inputsCurrent;   // the input in use still says so
            MarkInRow();
            MarkSources();
            if (onAll ? keepAll : onInputs ? keepInputs : keepApps)
            {
                // The page in use was kept: it goes on untouched (an entrance under way included), and a new page beside it stays hidden.
                _ctl = ctlBefore; _dock = dockBefore;
                if (_appsDock != _dock) _appsDock.SetVisible(false);
            }
            else
            {
                // As after a start: the apps row is the page at rest (a kept row was hidden while another page was in use).
                _ctl = _appsCtl; _dock = _appsDock;
                _dock.SetVisible(true);
                if (shown)
                {
                    Controller ctl = onAll ? _allCtl : onInputs ? _inputsCtl : _appsCtl;
                    AppEntry[] page = onAll ? _allApps : onInputs ? _inputs : _apps;
                    int focus = -1;
                    for (int i = 0; key != null && i < page.Length; i++) if (EntryKey(page[i]) == key) { focus = i; break; }
                    ActivatePage(ctl, onAll ? _allDock : onInputs ? _inputsDock : _appsDock);
                    ctl.SetFocus(focus >= 0 ? focus : Math.Max(0, Math.Min(at, page.Length - 1)));
                    _ctl.Rise(1f);
                    StartClock();
                    StartAnimator();
                    ResetIdle(false);
                }
            }
            KeepIconsInUse();
            _dock.Apply(_ctl);
            string made = keepApps || keepInputs || keepAll
                ? (keepApps ? "" : " apps row") + (keepInputs ? "" : " Sources") + (keepAll ? "" : " All apps")
                : " all three";
            Log("lists: read again, made again:" + made + "; " + _apps.Length + " tiles, " + _allApps.Length + " on All apps, in "
                + ((Stopwatch.GetTimestamp() - t0) * 1000.0 / Stopwatch.Frequency).ToString("0", System.Globalization.CultureInfo.InvariantCulture) + " ms");
            ProbeHandlerDone();
        }

        private static void HideDock()
        {
            if (_premapTimer != IntPtr.Zero)
            {
                Efl.ecore_timer_del(_premapTimer);
                _premapTimer = IntPtr.Zero;
                if (_dock != null && _ctl != null && _ctl.Phase == Phase.Hidden && !_tasksOn)
                {
                    _ctl.Reset();
                    _dock.Apply(_ctl);
                    Efl.evas_object_hide(_win);
                }
            }
            if (_moveIndex >= 0) FinishMove(true);   // leaving while a tile is being moved keeps where it is now
            StopBackWait();
            CancelRowOk();
            _pendingLaunch = null;
            CancelIdle();
            StopClock();
            if (_tasksOn)
            {
                StopTaskTimers();
                CancelTaskOk();   // an OK let go after the panel went away opens nothing
                if (HideCards()) StartAnimator();
                return;
            }
            if (_ctl.Hide()) StartAnimator();
        }

        // ------------------------------------------------------------------ task manager page

        private static void MoveWindow(int x, int y, int w, int h)
        {
            Efl.evas_object_move(_win, x, y);
            Efl.evas_object_resize(_win, w, h);
        }

        private static void BuildTaskWindow()
        {
            if (_homeLaunch != null || _cards.Length == 0 || _taskWin != IntPtr.Zero) return;
            int band = DockLayout.HintH;
            int cardsN = Math.Max(1, _cards.Length);
            _taskLayout = new TaskLayout(_screenW, _screenH, 0, band, cardsN, 0);
            _taskWin = Efl.elm_win_add(IntPtr.Zero, "tvlauncher", Efl.ElmWinNotification);
            if (_taskWin == IntPtr.Zero) { Log("task elm_win_add failed"); return; }
            Efl.elm_win_title_set(_taskWin, "tvlauncher");
            Efl.elm_win_alpha_set(_taskWin, true);
            Efl.elm_win_borderless_set(_taskWin, true);
            Efl.elm_win_prop_focus_skip_set(_taskWin, false);
            Efl.efl_util_set_notification_window_level(_taskWin, NotificationLevelTop);
            Efl.elm_win_layer_set(_taskWin, WindowLayer);
            Efl.elm_win_aux_hint_add(_taskWin, "wm.policy.win.user.geometry", "1");
            Efl.elm_win_aux_hint_add(_taskWin, "wm.comp.win.effect.enable", "0");
            Efl.evas_object_move(_taskWin, _taskLayout.WinX, _taskLayout.WinY);
            Efl.evas_object_resize(_taskWin, _taskLayout.WinW, _taskLayout.WinH);
            Efl.HideCursor(_taskWin, false);
            if (HasCard(CardKind.Tasks))
            {
                _taskPanel = new TaskPanel(_taskWin, new TaskLayout(_screenW, _screenH, 0, band, cardsN, CardAt(CardKind.Tasks)), _res, Log);
                _taskPanel.Build();
                if (_taskApps != null && _taskApps.Count > 0)
                {
                    _taskPanel.SetApps(_taskApps, _lastAvailableKb);
                    _tasksCtl.SetCount(_taskApps.Count);
                }
            }
            if (HasCard(CardKind.Audio))
            {
                _audioCard = new AudioCard(_taskWin, new TaskLayout(_screenW, _screenH, 0, band, cardsN, CardAt(CardKind.Audio)), _res, Log);
                _audioCard.Build();
                if (_lastAudioEntries != null)
                {
                    _audioCard.SetEntries(_lastAudioEntries, _lastAudioNote);
                    _audioCtl.SetCount(_lastAudioEntries.Count);
                }
            }
            _choiceCards = new ChoiceCard[_cards.Length];
            if (_lastChoiceStates == null || _lastChoiceStates.Length != _cards.Length)
                _lastChoiceStates = new ChoiceState[_cards.Length];
            for (int i = 0; i < _cards.Length; i++)
            {
                CardSpec spec = _cards[i];
                if (spec.Kind != CardKind.Picture && spec.Kind != CardKind.Sleep && spec.Kind != CardKind.Shard) continue;
                string tag = spec.Kind == CardKind.Picture ? "picture" : spec.Kind == CardKind.Sleep ? "sleep" : "shard " + spec.ShardId;
                string reading = spec.Kind == CardKind.Picture ? "Reading the picture modes…" : spec.Kind == CardKind.Sleep ? "Reading the sleep timer…" : "Reading…";
                _choiceCards[i] = new ChoiceCard(_taskWin, new TaskLayout(_screenW, _screenH, 0, band, cardsN, i), _res, Log, tag, ControlCenter.Title(spec), reading);
                _choiceCards[i].Build();
                if (_lastChoiceStates[i] != null)
                {
                    _choiceCards[i].SetState(_lastChoiceStates[i]);
                    _cardCtl[i].SetCount(_choiceCards[i].Count);
                }
            }
            ShowCards(false);
            Efl.evas_object_event_callback_add(_taskWin, Efl.EvasCallbackKeyDown, KeyCb, IntPtr.Zero);
            Efl.evas_object_event_callback_add(_taskWin, Efl.EvasCallbackKeyUp, KeyUpCb, IntPtr.Zero);
        }

        private static void ScheduleTaskWindowRecycle(double delay = 0.08)
        {
            if (_taskRecycleTimer != IntPtr.Zero) Efl.ecore_timer_del(_taskRecycleTimer);
            _taskRecycleTimer = Efl.ecore_timer_add(delay, TaskRecycleCb, IntPtr.Zero);
        }

        private static void ReleaseObjectImages(object obj)
        {
            if (obj == null) return;
            var flags = System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Public;
            for (Type t = obj.GetType(); t != null && t != typeof(object); t = t.BaseType)
            {
                foreach (var f in t.GetFields(flags))
                {
                    if (f.Name == "_win" || f.Name == "_evas" || f.Name == "_clip" || f.Name == "_listClip") continue;
                    object val = null;
                    try { val = f.GetValue(obj); } catch (Exception) { }
                    if (val == null) continue;
                    if (val is IntPtr)
                    {
                        IntPtr ptr = (IntPtr)val;
                        if (ptr != IntPtr.Zero)
                        {
                            try { Efl.evas_object_hide(ptr); } catch (Exception) { }
                            try { Efl.evas_object_image_data_set(ptr, IntPtr.Zero); } catch (Exception) { }
                            try { Efl.evas_object_image_size_set(ptr, 0, 0); } catch (Exception) { }
                            try { Efl.evas_object_del(ptr); } catch (Exception) { }
                            try { f.SetValue(obj, IntPtr.Zero); } catch (Exception) { }
                        }
                    }
                    else if (val is System.Collections.IEnumerable && !(val is string))
                    {
                        foreach (object item in (System.Collections.IEnumerable)val)
                        {
                            if (item == null) continue;
                            if (item is IntPtr)
                            {
                                IntPtr ptr = (IntPtr)item;
                                if (ptr != IntPtr.Zero)
                                {
                                    try { Efl.evas_object_hide(ptr); } catch (Exception) { }
                                    try { Efl.evas_object_image_data_set(ptr, IntPtr.Zero); } catch (Exception) { }
                                    try { Efl.evas_object_image_size_set(ptr, 0, 0); } catch (Exception) { }
                                    try { Efl.evas_object_del(ptr); } catch (Exception) { }
                                }
                            }
                            else if (!item.GetType().IsPrimitive && !(item is string))
                            {
                                ReleaseObjectImages(item);
                            }
                        }
                    }
                }
            }
        }

        private static void DestroyTaskWindow()
        {
            if (_taskWin == IntPtr.Zero) return;
            try
            {
                ShowCards(false);
                if (_taskPanel != null) { ReleaseObjectImages(_taskPanel); _taskPanel = null; }
                if (_audioCard != null) { ReleaseObjectImages(_audioCard); _audioCard = null; }
                if (_choiceCards != null)
                {
                    for (int i = 0; i < _choiceCards.Length; i++)
                    {
                        if (_choiceCards[i] != null) ReleaseObjectImages(_choiceCards[i]);
                    }
                }
                _choiceCards = new ChoiceCard[_cards == null ? 0 : _cards.Length];
                Efl.evas_object_hide(_taskWin);
                Efl.evas_object_resize(_taskWin, 1, 1);
                Efl.evas_object_del(_taskWin);
            }
            catch (Exception ex) { Log("task win destroy: " + ex.Message); }
            _taskWin = IntPtr.Zero;
        }

        private static byte OnTaskWindowRecycle(IntPtr data)
        {
            _taskRecycleTimer = IntPtr.Zero;
            try
            {
                if (_tasksOn || _anim != IntPtr.Zero)
                {
                    _taskRecycleTimer = Efl.ecore_timer_add(0.15, TaskRecycleCb, IntPtr.Zero);
                    return 0;
                }
                DestroyTaskWindow();
                KeepIconsInUse();
            }
            catch (Exception ex) { Log("task win recycle: " + ex.Message); }
            return 0;
        }

        /// <summary>Down on the apps row: the Control center's cards rise where the bar was, in their own window without resizing the Dock window.</summary>
        private static void OpenTasks()
        {
            ProbeBegin("control center");
            if (_taskRecycleTimer != IntPtr.Zero)
            {
                Efl.ecore_timer_del(_taskRecycleTimer);
                _taskRecycleTimer = IntPtr.Zero;
            }
            if (_taskWin == IntPtr.Zero) BuildTaskWindow();
            if (_taskWin == IntPtr.Zero) { ProbeHandlerDone(); return; }
            float pop = Math.Min(_ctl.Presence, 0.55f);
            _ctl.Vanish();
            _dock.SetVisible(false);
            _tasksOn = true;
            _cardFocus = 0;
            OpenCards(pop);
            if (HasCard(CardKind.Tasks))
            {
                _taskUserMoved = false;
                _tasksCtl.SetCount(_taskPanel.Count);
                RefreshTasks(true);
                if (_taskRefresh == IntPtr.Zero) _taskRefresh = Efl.ecore_timer_add(TaskRefreshSeconds, TaskRefreshCb, IntPtr.Zero);
            }
            if (HasCard(CardKind.Audio))
            {
                // The Bluetooth list is asked on the main loop (calls to another process, of unknown length on a TV): after the
                // cards have come in, not in front of their first frame. Meanwhile the card shows what it showed last time
                // ("Reading…" the first time).
                _audioCtl.SetCount(_audioCard.Count);
                if (_audioCard.Count > 0) _audioCtl.Select(_audioCard.ActiveRow);
                CancelAudioReread();
                _audioSelectActive = true;
                _audioReread = Efl.ecore_timer_add(AudioOpenDelay, AudioRereadCb, IntPtr.Zero);
            }
            for (int i = 0; i < _cards.Length; i++)
            {
                ChoiceCard choice = _choiceCards[i];
                if (choice == null) continue;
                // A card that already has its rows keeps them while the TV is asked again (the answer replaces them in place);
                // only the first time is there nothing to show but "Reading…".
                if (choice.Count == 0) { choice.Clear(); _cardCtl[i].SetCount(0); }
                else { choice.ClearBusy(); _cardCtl[i].SetCount(choice.Count); _cardCtl[i].Select(choice.ActiveRow); }
                _choiceFresh[i] = true;
                _choiceSrcs[i].Request();
            }
            StartChoicePoll();
            ShowCards(true);
            ApplyCards();
            Efl.evas_object_show(_taskWin);
            Efl.HideCursor(_taskWin, false);
            Efl.elm_win_raise(_taskWin);
            Efl.elm_win_activate(_taskWin);
            Efl.evas_object_hide(_win);
            StartAnimator();
            ResetIdle();
            Log("control center: " + string.Join(",", Array.ConvertAll(_cards, k => k.ToString())));
            ProbeHandlerDone();
        }

        /// <summary>Back to the apps row (<paramref name="rise"/>: it comes in at once), or put away while hidden.</summary>
        private static void LeaveTasks(bool rise)
        {
            float pop = Math.Min(LeadCtl.Presence, 0.55f);
            StopTaskTimers();
            CancelTaskOk();
            CancelAudioReread();
            _tasksOn = false;
            DropCards();
            ShowCards(false);
            if (_taskWin != IntPtr.Zero)
            {
                Efl.evas_object_hide(_taskWin);
                ScheduleTaskWindowRecycle(rise ? 0.45 : 0.05);
            }
            _dock.SetVisible(true);
            if (rise)
            {
                _ctl.Rise(pop);
                _dock.Apply(_ctl);
                Efl.evas_object_show(_win);
                Efl.HideCursor(_win, false);
                Efl.elm_win_raise(_win);
                Efl.elm_win_activate(_win);
                StartAnimator();
                ResetIdle();
            }
        }

        private static void StopTaskTimers()
        {
            if (_taskRefresh != IntPtr.Zero) { Efl.ecore_timer_del(_taskRefresh); _taskRefresh = IntPtr.Zero; }
            if (_taskPoll != IntPtr.Zero) { Efl.ecore_timer_del(_taskPoll); _taskPoll = IntPtr.Zero; }
        }

        private static bool _taskResort, _taskUserMoved;

        /// <summary>Asks the worker for a new look; <paramref name="resort"/>: put the list in sort order when it arrives.</summary>
        private static void RefreshTasks(bool resort)
        {
            _taskResort |= resort;
            _taskSource.Request();
            if (_taskPoll == IntPtr.Zero) _taskPoll = Efl.ecore_timer_add(0.05, TaskPollCb, IntPtr.Zero);
        }

        private static byte OnTaskPoll(IntPtr data)
        {
            try
            {
                // A look arrives in two halves (the apps, then their memory): keep polling until the worker is done.
                bool busy = _taskSource.Busy;
                TaskSnapshot s = _taskSource.TryTake();
                if (s != null) ApplySnapshot(s);
                if (busy) return 1;
                s = _taskSource.TryTake();
                if (s != null) ApplySnapshot(s);
            }
            catch (Exception ex) { Log("tasks poll: " + ex); }
            _taskPoll = IntPtr.Zero;
            return 0;
        }

        private static byte OnTaskRefresh(IntPtr data)
        {
            try { if (_tasksOn && _tasksCtl.IsActive) RefreshTasks(false); }
            catch (Exception ex) { Log("tasks refresh: " + ex); }
            return 1;
        }

        /// <summary>
        /// A new look from the worker (every 1.5 s while the card is open). The order only changes when asked (opening, after a close):
        /// rows that jump on their own every refresh would be hard to point at. New apps go to the end.
        /// </summary>
        private static void ApplySnapshot(TaskSnapshot s)
        {
            if (!_tasksOn || _taskPanel == null) return;
            s.Apps = Tasks.UniqueById(s.Apps);   // one row per app id, or the panel counts a row it never draws
            RunningApp selected = _taskPanel.AppAt(_tasksCtl.Selected);
            if (s.Partial)
            {
                // Memory and CPU are still being read: show the last known figures for the same process meanwhile.
                var known = new Dictionary<string, RunningApp>(StringComparer.Ordinal);
                foreach (RunningApp old in _taskApps) known[old.AppId] = old;
                foreach (RunningApp a in s.Apps)
                {
                    RunningApp old;
                    if (known.TryGetValue(a.AppId, out old) && old.Pid == a.Pid) { a.MemoryKb = old.MemoryKb; a.CpuPercent = old.CpuPercent; }
                }
            }
            List<RunningApp> list;
            // The sort waits for real figures; a first look without any is shown by name meanwhile. Then the rows stay put until the
            // next opening or close: sorting every look again swapped two apps of about the same size back and forth every 1.5 s,
            // which read as the card flickering.
            if (_taskResort && (!s.Partial || _taskApps.Count == 0))
            {
                list = s.Apps;
                Tasks.Sort(list, s.Partial ? TaskSort.Name : _tasksCtl.Sort);
                // CPU needs two looks: the first full one has no figures yet, so the sort waits for the next.
                if (!s.Partial) _taskResort = !HasFigures(list, _tasksCtl.Sort);
            }
            else
            {
                var fresh = new Dictionary<string, RunningApp>(StringComparer.Ordinal);
                foreach (RunningApp a in s.Apps) fresh[a.AppId] = a;
                list = new List<RunningApp>();
                foreach (RunningApp old in _taskApps) { RunningApp a; if (fresh.TryGetValue(old.AppId, out a)) { list.Add(a); fresh.Remove(old.AppId); } }
                foreach (RunningApp a in s.Apps) if (fresh.ContainsKey(a.AppId)) list.Add(a);
            }
            _taskApps = list;
            _lastAvailableKb = s.AvailableKb;
            _taskPanel.SetApps(list, s.AvailableKb);
            _tasksCtl.SetCount(list.Count);
            // Until the user moves, the selection sits on the top row (the biggest app once the figures are in);
            // after that it stays on the same app when it is still there, otherwise on the same row number.
            if (!_taskUserMoved) _tasksCtl.SelectFirst();
            else if (selected != null) for (int i = 0; i < list.Count; i++) if (list[i].AppId == selected.AppId) { _tasksCtl.Select(i); break; }
            ApplyCards();
        }

        /// <summary>A key on the Control center: the focused card's own, except Left and Right, which move between the cards.</summary>
        private static void OnTaskKey(string key)
        {
            if ((key == "XF86Back" || key == "XF86Exit" || key == "Escape") && Efl.ecore_time_get() < _arrivalBackShieldUntil) return;
            CardKind card = FocusedCard;
            TaskController ctl = FocusedCtl;
            switch (ctl.Key(key))
            {
                case TaskAction.Moved:
                    if (card == CardKind.Tasks) _taskUserMoved = true;
                    StartAnimator();
                    ResetIdle();
                    break;
                case TaskAction.Left:
                case TaskAction.Right:
                    int next = ControlCenter.Move(_cardFocus, _cards.Length, key == "Left" ? -1 : 1);
                    if (next != _cardFocus)
                    {
                        if (card == CardKind.Tasks) CancelTaskOk();
                        _cardFocus = next;
                        ApplyCards();
                        StartAnimator();
                    }
                    ResetIdle();
                    break;
                case TaskAction.Open:
                    if (card == CardKind.Tasks) OpenTaskApp(_taskPanel.AppAt(_tasksCtl.Selected));
                    else if (card == CardKind.Audio) ChooseOutput();
                    else Choose(_cardFocus);
                    break;
                case TaskAction.Back:
                    LeaveTasks(true);
                    break;
                case TaskAction.Hide:
                    if (key == "XF86Home")
                    {
                        double now = Efl.ecore_time_get();
                        if (now - _lastRawHome < HomeEchoSeconds) break;   // the evas copy of a press the input reader already handled
                        _lastHome = now;
                        NoteAppHomePress(now);
                        HideDock();
                        ArmGuard();
                        break;
                    }
                    if (BackUp.Press(key, Efl.ecore_time_get())) { StartBackWait(); break; }   // Exit: on its release (#284)
                    HideDock();
                    break;
            }
        }

        private static bool IsOkKey(string key) { return key == "Return" || key == "KP_Enter" || key == "Select"; }

        /// <summary>OK went down on the task page: remember the row and wait to see whether it is a tap or a hold.</summary>
        private static void TaskOkDown()
        {
            ResetIdle();
            if (_taskPanel == null) return;
            if (!TaskOk.Press()) return;   // auto-repeat, or the window's copy of a press already handled
            _taskOkApp = _taskPanel.AppAt(_tasksCtl.Selected);
            if (_taskOkApp == null) { TaskOk.Cancel(); return; }
            if (_taskOkTimer != IntPtr.Zero) Efl.ecore_timer_del(_taskOkTimer);
            _taskOkTimer = Efl.ecore_timer_add(HoldKey.HoldSeconds, TaskOkHoldCb, IntPtr.Zero);
        }

        /// <summary>OK came up: a tap opens the app it went down on.</summary>
        private static void TaskOkUp()
        {
            if (TaskOk.Release() != HoldResult.Tap) return;
            if (_taskOkTimer != IntPtr.Zero) { Efl.ecore_timer_del(_taskOkTimer); _taskOkTimer = IntPtr.Zero; }
            RunningApp app = _taskOkApp;
            _taskOkApp = null;
            if (_tasksOn && _tasksCtl.IsActive) OpenTaskApp(app);
        }

        private static byte OnTaskOkHold(IntPtr data)
        {
            _taskOkTimer = IntPtr.Zero;   // returning 0 makes ecore free the timer
            try
            {
                if (TaskOk.Fire() == HoldResult.Hold && _tasksOn && _tasksCtl.IsActive) CloseTaskApp(_taskOkApp);
            }
            catch (Exception ex) { Log("tasks hold: " + ex); }
            return 0;
        }

        private static void CancelTaskOk()
        {
            TaskOk.Cancel();
            _taskOkApp = null;
            if (_taskOkTimer != IntPtr.Zero) { Efl.ecore_timer_del(_taskOkTimer); _taskOkTimer = IntPtr.Zero; }
        }

        private const string CobaltYouTubeAppId = "com.samsung.tv.cobalt-yt";
        private const string WrapperYouTubeAppId = "9Ur5IzDKqV.TizenYouTube";

        private static AppEntry FindCatalogEntry(string appId)
        {
            if (string.IsNullOrEmpty(appId)) return null;
            if (_apps != null) foreach (AppEntry a in _apps) if (a.AppId == appId) return a;
            if (_allApps != null) foreach (AppEntry a in _allApps) if (a.AppId == appId) return a;
            string alias = appId == CobaltYouTubeAppId ? WrapperYouTubeAppId
                : appId == WrapperYouTubeAppId ? CobaltYouTubeAppId : null;
            if (alias == null) return null;
            if (_apps != null) foreach (AppEntry a in _apps) if (a.AppId == alias) return a;
            if (_allApps != null) foreach (AppEntry a in _allApps) if (a.AppId == alias) return a;
            return null;
        }

        /// <summary>Brings a running app to the front: the panel fades out first, then the app is launched (it resumes).</summary>
        private static void OpenTaskApp(RunningApp app)
        {
            if (app == null || app.Closing) return;
            // Match the apps row and All apps (including Cobalt/wrapper YouTube alias) so Shard tiles open through their plugin.
            AppEntry e = FindCatalogEntry(app.AppId);
            if (e == null) e = new AppEntry(app.AppId, app.Label ?? app.AppId, app.AppId, null);
            NoteLaunchEpoch(e.AppId);
            if (HomeGuard.ShouldCancel(_guardApps, e.AppId)) CancelGuard();
            Log("tasks: open " + app.AppId);
            HideDock();
            _pendingLaunch = e;
        }

        private static void CloseTaskApp(RunningApp app)
        {
            if (app != null && !app.Closing)
            {
                _taskPanel.MarkClosing(app);
                _taskSource.Close(app.AppId);
                ApplyCards();
                // Look again soon: the list shrinks as soon as the app is gone, in sort order again.
                Efl.ecore_timer_add(0.9, TaskAfterCloseCb, IntPtr.Zero);
                Efl.ecore_timer_add(2.6, TaskAfterCloseCb, IntPtr.Zero);
                if (_idleWin != null) UpdateIdleWatchTimer(0.10);
            }
            ResetIdle();
        }

        /// <summary>True when the list holds the figures the sort needs (names always; memory and CPU once measured).</summary>
        private static bool HasFigures(List<RunningApp> list, TaskSort by)
        {
            if (by == TaskSort.Name) return true;
            foreach (RunningApp a in list) if (by == TaskSort.Cpu ? a.CpuPercent < 0 : a.MemoryKb < 0) return false;
            return true;
        }

        private static readonly Efl.TaskCb TaskAfterCloseCb = OnTaskAfterClose;

        private static byte OnTaskAfterClose(IntPtr data)
        {
            try { if (_tasksOn) RefreshTasks(true); }
            catch (Exception ex) { Log("tasks after close: " + ex); }
            return 0;
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
            if (_sourcesEditable) MarkSources();
            _inputsCtl.SetFocus(current >= 0 ? current : 0);
            Log("inputs panel, source_type=" + type + " current=" + current);
            SelectPage(_inputsCtl, _inputsDock);
        }

        // ------------------------------------------------------------------ the three pages, and the user's own row

        private static DockLayout _inputsLayout, _allLayout;
        // The hint of All apps, and of Sources when its inputs can be put in the row (a Sources list of an older Vetro has no row keys: only
        // the way back), drawn with the remote's keys like the Control center cards' footer (Dock.KeyHint).
        private static bool _sourcesEditable;

        /// <summary>The three pages' layouts for the current lists (one window, as wide as the widest page); the controllers start on them.</summary>
        private static DockLayout PageLayouts()
        {
            bool band = _cards.Length > 0;
            DockLayout apps;
            DockLayout.Pages(_apps.Length, Catalog.GroupStart(_apps), _inputs.Length, _allApps.Length, Catalog.GroupStart(_allApps), _screenW, _screenH, band,
                out apps, out _inputsLayout, out _allLayout);
            _appsLayout = apps;
            _appsCtl = new Controller(apps) { PanelEnabled = true, TasksEnabled = band };
            _inputsCtl = new Controller(_inputsLayout, PageKind.Panel);
            _allCtl = new Controller(_allLayout, PageKind.Panel);
            _ctl = _appsCtl;
            return apps;
        }

        /// <summary>The pages' objects (the apps row on screen, the other two hidden).</summary>
        private static void BuildPages()
        {
            BuildAppsPage();
            BuildInputsPage();
            BuildAllPage();
            _dock = _appsDock;
        }

        /// <summary>The apps row's objects, shown (a new Dock is visible until hidden).</summary>
        private static void BuildAppsPage()
        {
            _appsDock = new Dock(_win, _appsLayout, _apps, _res, Log, Design.HintText, true, ControlCenter.HintText(_cards));
            _appsDock.Build();
        }

        /// <summary>The Sources page's objects, hidden. Its hint depends on the row (<see cref="RowEdit.CanAddFrom"/>).</summary>
        private static void BuildInputsPage()
        {
            _sourcesEditable = RowEdit.CanAddFrom(_inputs, _apps);
            _inputsDock = new Dock(_win, _inputsLayout, _inputs, _res, Log, Dock.KeyHint(_sourcesEditable), false);
            _inputsDock.Build();
            _inputsDock.SetVisible(false);
        }

        /// <summary>All apps' objects, hidden.</summary>
        private static void BuildAllPage()
        {
            _allDock = new Dock(_win, _allLayout, _allApps, _res, Log, Dock.KeyHint(true), false);
            _allDock.Build();
            _allDock.SetVisible(false);
        }

        /// <summary>
        /// After a build of the pages: the icon cache keeps what the three pages and the Task manager's rows show now, and lets go of the
        /// icons of apps no page shows any more.
        /// </summary>
        private static void KeepIconsInUse()
        {
            _appsDock.KeepIcons(); _inputsDock.KeepIcons(); _allDock.KeepIcons();
            if (_taskPanel != null) _taskPanel.KeepIcons();
            int gone = Dock.Icons.Sweep();
            if (gone > 0) Log("icons: " + gone + " no longer shown let go, " + Dock.Icons.Count + " kept");
        }

        /// <summary>
        /// A tile was taken out of the row or added to it: the three pages are made again for the new row (the window's width may change),
        /// on screen at once, the focus on <paramref name="focus"/> of the apps row, or on the same entry of All apps or Sources when the change
        /// came from there.
        /// </summary>
        private static void RebuildPages(AppEntry[] apps, int focus)
        {
            ProbeBegin("row rebuild");
            long t0 = Stopwatch.GetTimestamp();   // how long a rebuild takes on a TV (its icons come from Dock.Icons now) is not known yet
            bool onAll = _ctl == _allCtl, onInputs = _ctl == _inputsCtl;
            int allFocus = _allCtl.FocusTarget, inputsFocus = _inputsCtl.FocusTarget, inputsCurrent = _inputsDock.CurrentIndex;
            Dock inputsDock = _inputsDock, allDock = _allDock;
            Controller inputsCtl = _inputsCtl, allCtl = _allCtl;
            DockLayout inputsLayout = _inputsLayout, allLayout = _allLayout;
            int wx = _appsLayout.WinX, wy = _appsLayout.WinY, ww = _appsLayout.WinW, wh = _appsLayout.WinH;
            _appsDock.Destroy();
            _apps = apps;
            PageLayouts();
            if (_appsLayout.WinX == wx && _appsLayout.WinY == wy && _appsLayout.WinW == ww && _appsLayout.WinH == wh)
            {
                // The window keeps its size (All apps is usually the widest page), so the Sources page and All apps are laid out
                // exactly as before: they are kept, with their icons, and only the row is made again. Preparing every icon of the
                // three pages at each change froze the launcher for a moment, and All apps lost its place.
                _inputsLayout = inputsLayout; _allLayout = allLayout; _inputsCtl = inputsCtl; _allCtl = allCtl;
                _inputsDock = inputsDock; _allDock = allDock;
                BuildAppsPage();
                if (onAll) { _appsDock.SetVisible(false); _ctl = _allCtl; _dock = _allDock; }
                else if (onInputs) { _appsDock.SetVisible(false); _ctl = _inputsCtl; _dock = _inputsDock; }
                else { _ctl = _appsCtl; _dock = _appsDock; _appsCtl.SetFocus(focus); }
            }
            else
            {
                inputsDock.Destroy(); allDock.Destroy();
                BuildPages();
                MoveWindow(_appsLayout.WinX, _appsLayout.WinY, _appsLayout.WinW, _appsLayout.WinH);
                _inputsDock.CurrentIndex = inputsCurrent;   // the input in use still says so
                if (onAll) { ActivatePage(_allCtl, _allDock); _allCtl.SetFocus(allFocus); }
                else if (onInputs) { ActivatePage(_inputsCtl, _inputsDock); _inputsCtl.SetFocus(inputsFocus); }
                else _appsCtl.SetFocus(focus);
            }
            MarkInRow();
            MarkSources();
            KeepIconsInUse();
            _ctl.Rise(1f);
            _dock.Apply(_ctl);
            Log("row: pages rebuilt for " + _apps.Length + " tiles in " + ((Stopwatch.GetTimestamp() - t0) * 1000.0 / Stopwatch.Frequency).ToString("0", System.Globalization.CultureInfo.InvariantCulture) + " ms");
            StartClock();
            StartAnimator();
            ResetIdle();
            ProbeHandlerDone();
        }

        /// <summary>All apps puts a tick on the apps that are in the row.</summary>
        private static void MarkInRow() { _allDock.Marked = RowEdit.Marks(_allApps, _apps); }

        /// <summary>Sources puts the same tick on the inputs the user put in the row.</summary>
        private static void MarkSources() { _inputsDock.Marked = RowEdit.Marks(_inputs, _apps); }

        private static void OpenAllApps()
        {
            ProbeBegin("all apps");
            MarkInRow();
            _allCtl.SetFocus(0);
            Log("all apps page, " + _allApps.Length + " entries");
            SelectPage(_allCtl, _allDock);
            ProbeHandlerDone();
        }

        // OK on the apps row, on All apps and on Sources: a tap opens the tile (switches to the input) when the key comes up; held (0.8 s) it
        // moves the tile (apps row) or adds the entry to the row or takes it out (All apps, Sources). A Sources list without row keys (an older
        // Vetro wrote it) keeps acting on the press, as before.
        private static AppEntry[] PageEntries(Controller ctl) { return ctl == _allCtl ? _allApps : ctl == _inputsCtl ? _inputs : _apps; }
        private static bool HoldsOk(Controller ctl) { return ctl == _appsCtl || ctl == _allCtl || (ctl == _inputsCtl && _sourcesEditable); }
        private static readonly HoldKey RowOk = new HoldKey();
        private static IntPtr _rowOkTimer;
        private static readonly Efl.TaskCb RowOkHoldCb = OnRowOkHold;
        private static Controller _rowOkPage;
        private static int _rowOkIndex = -1;

        private static void RowOkDown()
        {
            ResetIdle();
            if (!RowOk.Press()) return;   // auto-repeat, or the window's copy of a press already handled
            _rowOkPage = _ctl;
            _rowOkIndex = _ctl.FocusTarget;
            if (_rowOkTimer != IntPtr.Zero) Efl.ecore_timer_del(_rowOkTimer);
            _rowOkTimer = Efl.ecore_timer_add(HoldKey.HoldSeconds, RowOkHoldCb, IntPtr.Zero);
        }

        private static void RowOkUp()
        {
            if (RowOk.Release() != HoldResult.Tap) return;
            if (_rowOkTimer != IntPtr.Zero) { Efl.ecore_timer_del(_rowOkTimer); _rowOkTimer = IntPtr.Zero; }
            // The focus moved while OK was down: the tile it was pressed on is not the one in front of the user any more.
            if (_tasksOn || _ctl != _rowOkPage || !_ctl.IsActive || _moveIndex >= 0 || _ctl.FocusTarget != _rowOkIndex) return;
            AppEntry[] list = PageEntries(_ctl);
            if (_rowOkIndex >= 0 && _rowOkIndex < list.Length) Activate(list[_rowOkIndex]);
        }

        private static byte OnRowOkHold(IntPtr data)
        {
            _rowOkTimer = IntPtr.Zero;   // returning 0 makes ecore free the timer
            try
            {
                if (RowOk.Fire() != HoldResult.Hold || _tasksOn || _ctl != _rowOkPage || !_ctl.IsActive || _ctl.FocusTarget != _rowOkIndex) return 0;
                if (_ctl == _appsCtl) StartMove(_rowOkIndex); else ToggleInRow(_ctl == _inputsCtl, _rowOkIndex);
            }
            catch (Exception ex) { Log("row hold: " + ex); }
            return 0;
        }

        private static void CancelRowOk()
        {
            RowOk.Cancel();
            if (_rowOkTimer != IntPtr.Zero) { Efl.ecore_timer_del(_rowOkTimer); _rowOkTimer = IntPtr.Zero; }
        }

        // Moving a tile: Left / Right carry it, Down takes it out of the row, OK keeps it there, Back puts the row back as it was.
        private const string MoveHint = "\u2039 \u203a move  \u00b7  Down take out  \u00b7  OK done";
        private static int _moveIndex = -1;
        private static AppEntry[] _moveBefore;

        private static void StartMove(int index)
        {
            if (!RowEdit.IsApp(_apps, index)) return;   // the pills stay where they are
            if (!RowEdit.CanEdit(_apps)) { Log("row: this list has no row keys (an older Vetro wrote it), so it cannot be edited"); return; }
            _moveIndex = index;
            _moveBefore = (AppEntry[])_apps.Clone();
            _appsDock.MovingIndex = index;
            _appsDock.SetHints(MoveHint, "Take out", false);   // Down takes the tile out now, not to the Control center
            Log("row: moving " + _apps[index].RowKey);
            StartAnimator();
            ResetIdle();
        }

        private static void MoveKey(string key)
        {
            ResetIdle();
            int idx;
            switch (key)
            {
                case "Left":
                case "Right":
                    int to = RowEdit.Target(_apps, _moveIndex, key == "Left" ? -1 : 1);
                    if (to == _moveIndex) return;
                    _appsDock.Swap(_moveIndex, to);   // the dock's items are this same array
                    _moveIndex = to;
                    _appsDock.MovingIndex = to;
                    _appsCtl.Key(key, out idx);       // the focus goes with it
                    StartAnimator();
                    return;
                case "Down":
                    AppEntry[] fewer = RowEdit.Remove(_apps, _moveIndex);
                    if (fewer == _apps) return;       // the last app stays
                    Log("row: took out " + _apps[_moveIndex].RowKey);
                    int at = Math.Min(_moveIndex, RowEdit.AppsEnd(fewer) - 1);
                    FinishMove(false);
                    RebuildPages(fewer, at);
                    SendRow();
                    return;
                case "Return":
                case "KP_Enter":
                case "Select":
                    FinishMove(true);
                    return;
                case "Escape":
                case "XF86Back":
                    AppEntry[] before = _moveBefore;
                    int back = Array.IndexOf(before, _apps[_moveIndex]);
                    // The tile got where it is by swaps with its neighbours: the same swaps the other way put the row back
                    // as it was, with nothing built again.
                    while (back >= 0 && _moveIndex != back)
                    {
                        int step = _moveIndex + (back < _moveIndex ? -1 : 1);
                        _appsDock.Swap(_moveIndex, step);
                        _moveIndex = step;
                    }
                    bool restored = SameOrder(before, _apps);
                    if (restored && back >= 0) _appsCtl.SetFocus(back);
                    FinishMove(false);
                    if (!restored) RebuildPages(before, back < 0 ? 0 : back);
                    return;
                case "XF86Home":
                case "XF86Exit":
                    HideDock();   // keeps the tile where it is now
                    return;
            }
        }

        /// <summary>Ends moving a tile; <paramref name="keep"/>: the row as it is now is sent to Vetro when it changed.</summary>
        private static void FinishMove(bool keep)
        {
            bool changed = keep && _moveBefore != null && !SameOrder(_moveBefore, _apps);
            _moveIndex = -1;
            _moveBefore = null;
            _appsDock.MovingIndex = -1;
            _appsDock.SetHints(null, null, true);
            StartAnimator();
            if (changed) SendRow();
        }

        private static bool SameOrder(AppEntry[] a, AppEntry[] b)
        {
            if (a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++) if (!ReferenceEquals(a[i], b[i])) return false;
            return true;
        }

        /// <summary>
        /// Held OK on an app of All apps or an input of Sources (<paramref name="sources"/>): into the row (at its end) when it is not there,
        /// out of it when it is. The page's dock is read from its field after the rebuild, which may have made it again.
        /// </summary>
        private static void ToggleInRow(bool sources, int index)
        {
            AppEntry[] page = sources ? _inputs : _allApps;
            if (index < 0 || index >= page.Length) return;
            AppEntry e = page[index];
            bool added;
            AppEntry[] next = RowEdit.Toggle(_apps, e, out added);
            if (next == _apps) return;   // a pill, no row key, the last app, or the row is full
            Log("row: " + (added ? "added " : "took out ") + e.RowKey + (sources ? " from Sources" : " from All apps"));
            RebuildPages(next, 0);
            // A hint left on the other page by a hold a moment ago goes back to its own words now.
            if (_hintTimer != IntPtr.Zero) { Efl.ecore_timer_del(_hintTimer); _hintTimer = IntPtr.Zero; HintDock(_hintOnSources).SetHints(null, null, true); }
            _hintOnSources = sources;
            HintDock(sources).SetHints(added ? "Added to the row" : "Taken out of the row", null, false);
            _hintTimer = Efl.ecore_timer_add(2.5, HintBackCb, IntPtr.Zero);
            SendRow();
        }

        private static IntPtr _hintTimer;
        private static bool _hintOnSources;   // which page shows "Added to the row" now: Sources, or All apps
        private static readonly Efl.TaskCb HintBackCb = OnHintBack;
        private static Dock HintDock(bool sources) { return sources ? _inputsDock : _allDock; }
        private static byte OnHintBack(IntPtr data)
        {
            _hintTimer = IntPtr.Zero;
            try
            {
                HintDock(_hintOnSources).SetHints(null, null, true);
                if (_ctl == (_hintOnSources ? _inputsCtl : _allCtl)) StartAnimator();
            }
            catch (Exception ex) { Log("hint: " + ex.Message); }
            return 0;
        }

        /// <summary>Tells Vetro the row as it is now (it saves it and writes the lists the next start reads). Returns at once.</summary>
        private static void SendRow()
        {
            string cmd = RowEdit.Command(RowEdit.Keys(_apps), ShardLaunch.ServicePort);
            if (cmd == null) { Log("row: not sent (a tile has no row key)"); return; }
            Log("row: sent rc=" + Libc.system(cmd));
        }

        // ------------------------------------------------------------------ clock

        private static string ClockText() { return DateTime.Now.ToString("HH:mm"); }

        /// <summary>
        /// Shows the time and arms one timer for the next minute change. It runs only while the dock
        /// is on screen: nothing ticks while the dock is hidden.
        /// </summary>
        private static void StartClock()
        {
            if (!Design.ShowClock) return;   // no clock is drawn in this look: no timer for it either
            string t = ClockText();
            _appsDock.SetClock(t);
            _inputsDock.SetClock(t);
            _allDock.SetClock(t);
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
                else if (_tasksOn && CardsActive) StartClock();
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

        private static void ResetIdle(bool userInitiated = true)
        {
            if (_idle == IntPtr.Zero) _idle = Efl.ecore_timer_add(Controller.IdleHideSeconds, IdleCb, IntPtr.Zero);
            else Efl.ecore_timer_reset(_idle);
            if (_dockMapped)
            {
                double now = Efl.ecore_time_get();
                if (now - _lastDockFlagMark >= 5.0)
                {
                    _lastDockFlagMark = now;
                    OverlayFlag.Mark(OverlayFlag.DockPath, true, Log);   // throttled touch so rapid nav avoids filesystem overhead
                }
                if (userInitiated && !IsDisplayOff()) TriggerScreensaverActivityReset(now, 10.0);
            }
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
            byte again = Frame();
            // The frame has been laid out (it is drawn when this callback returns): a Home guard that waited for it starts now.
            if (GuardSpawn.Pending) ScheduleGuard();
            return again;
        }

        // Samsung's Home picture mode handed back once the launcher has gone (Core/HomePicture.cs): offloaded from the main loop.
        private static void HomePictureOff()
        {
            string cmd = HomePicture.Command();
            System.Threading.Tasks.Task.Run(() =>
            {
                try
                {
                    int rc = SystemWithErrno(cmd);
                    int err;
                    if (!SystemSucceeded(rc, out err)) Log("home: picture check not started rc=" + rc + " errno=" + err);
                }
                catch (Exception ex) { Log("home: picture check: " + ex.Message); }
            });
        }

        private static byte Frame()
        {
            if (_dock == null) { _anim = IntPtr.Zero; return 0; }   // custom launcher mode: no page to draw
            try
            {
                long t0 = _perf ? Stopwatch.GetTimestamp() : 0;
                double now = Efl.ecore_time_get();
                double dt = now - _lastFrame;
                bool more;
                _lastFrame = now;
                if (_tasksOn)
                {
                    more = TickCards(dt);
                    ApplyCards();
                    if (LeadCtl.Phase == Phase.Hidden)
                    {
                        if (_taskWin != IntPtr.Zero) Efl.evas_object_hide(_taskWin);
                        Efl.evas_object_hide(_win);
                        MarkDock(false);
                        LeaveTasks(false);   // the next Home opens on the apps row, in the dock's own window size
                        more = false;
                        AppEntry chosen = _pendingLaunch;
                        _pendingLaunch = null;
                        if (chosen != null)
                        {
                            double suppressSec = chosen.ViaShard ? IdleBackdropModel.ShardLaunchSuppressSeconds : IdleBackdropModel.LaunchSuppressSeconds;
                            bool useIdleCurtain = _idleModel != null && UsesIdleLaunchCurtain(chosen);
                            if (useIdleCurtain)
                            {
                                _idleModel.OnLaunchApp(now, suppressSec, chosen.AppId ?? "");
                                _launchBackClaimSuppressUntil = now + 1.5;
                                if (_wmStack != null)
                                {
                                    _wmStack.InvalidateObservation();
                                    bool shownNow = _idleWin != null && _idleWin.IsShown;
                                    _wmStack.IdleShown = shownNow;
                                    _wmStack.BeginAppLaunch(
                                        chosen.AppId ?? "",
                                        chosen.Label ?? "",
                                        _lastPausedAppId,
                                        chosen.ViaShard || WmStackLogic.IsYoutubeTargetApp(chosen.AppId ?? ""),
                                        (int)Math.Round((suppressSec + 0.5) * 1000.0),
                                        shownNow,
                                        100,
                                        _lastForceClosedAppId);
                                }
                            }
                            else if (_wmStack != null && _idleModel != null && _idleModel.Visible && (!string.IsNullOrEmpty(chosen.Key) || WmStackLogic.IsSystemOverlayAppId(chosen.AppId)))
                            {
                                _wmStack.PartialActive = true;
                                _wmStack.EnsureStack(false);
                            }
                            Launch(chosen);
                            if (useIdleCurtain)
                            {
                                double afterNow = Efl.ecore_time_get();
                                _idleModel.OnLaunchApp(afterNow, suppressSec, chosen.AppId ?? "");
                                _launchBackClaimSuppressUntil = afterNow + 1.5;
                            }
                        }
                        if (_hideFor123) _hideFor123 = false;
                        else if (StaysOnLiveTv(chosen)) ResumeTuner(chosen == null ? "control center closed" : "opened " + chosen.AppId);
                        ReloadWhenHidden();
                        HomePictureOff();
                        if (_idleWin != null) _idleWin.SetDockOverlay(false);
                        PollIdleBackdrop();
                        if (_wmStack != null && _idleModel != null && _idleModel.Visible && !_idleModel.IsLaunchSuppressed(Efl.ecore_time_get())) _wmStack.EnsureStack(450);
                        if (_idleWin != null && chosen != null && !StaysOnLiveTv(chosen)) UpdateIdleWatchTimer(0.25);
                    }
                    if (_perf) PerfSample(dt, (Stopwatch.GetTimestamp() - t0) * 1000.0 / Stopwatch.Frequency, !more);
                    ProbeTick(now, !more);
                    if (more) return 1;
                    _anim = IntPtr.Zero;
                    return 0;
                }
                more = _ctl.Tick(dt);
                _dock.Apply(_ctl);
                if (_ctl.Phase == Phase.Hidden && _dockMapped)
                {
                    Efl.evas_object_hide(_win);
                    MarkDock(false);
                    // The fade has already rendered on earlier frames; a slow platform launch cannot freeze it.
                    AppEntry pending = _pendingLaunch;
                    _pendingLaunch = null;
                    if (pending != null)
                    {
                        double suppressSec = pending.ViaShard ? IdleBackdropModel.ShardLaunchSuppressSeconds : IdleBackdropModel.LaunchSuppressSeconds;
                        bool useIdleCurtain = _idleModel != null && UsesIdleLaunchCurtain(pending);
                        if (useIdleCurtain)
                        {
                            _idleModel.OnLaunchApp(now, suppressSec, pending.AppId ?? "");
                            _launchBackClaimSuppressUntil = now + 1.5;
                            if (_wmStack != null)
                            {
                                _wmStack.InvalidateObservation();
                                bool shownNow = _idleWin != null && _idleWin.IsShown;
                                _wmStack.IdleShown = shownNow;
                                _wmStack.BeginAppLaunch(
                                    pending.AppId ?? "",
                                    pending.Label ?? "",
                                    _lastPausedAppId,
                                    pending.ViaShard || WmStackLogic.IsYoutubeTargetApp(pending.AppId ?? ""),
                                    (int)Math.Round((suppressSec + 0.5) * 1000.0),
                                    shownNow,
                                    100,
                                    _lastForceClosedAppId);
                            }
                        }
                        else if (_wmStack != null && _idleModel != null && _idleModel.Visible && (!string.IsNullOrEmpty(pending.Key) || WmStackLogic.IsSystemOverlayAppId(pending.AppId)))
                        {
                            _wmStack.PartialActive = true;
                            _wmStack.EnsureStack(false);
                        }
                        if (pending.SourceType == 0) { _pendingTvSourceUntil = now + 3.0; _tvPlusActive = false; }
                        else if (pending.Slug == "tvplus" || pending.RowKey == "live:TVPLUS") { _tvPlusActive = true; _pendingTvSourceUntil = 0; }
                        if (pending.SourceType >= 0) SwitchSource(pending); else Launch(pending);
                        if (useIdleCurtain)
                        {
                            double afterNow = Efl.ecore_time_get();
                            _idleModel.OnLaunchApp(afterNow, suppressSec, pending.AppId ?? "");
                            _launchBackClaimSuppressUntil = afterNow + 1.5;
                        }
                        if (pending.SourceType == 0 && _wmStack != null) _wmStack.EnsureStack(true);
                    }
                    if (_hideFor123) _hideFor123 = false;
                    else if (StaysOnLiveTv(pending)) ResumeTuner(pending == null ? "dock closed" : pending.SourceType == 0 ? "TV input chosen" : "opened " + pending.AppId, pending != null && pending.SourceType == 0);
                    ReloadWhenHidden();
                    HomePictureOff();
                    if (_idleWin != null) _idleWin.SetDockOverlay(false);
                    PollIdleBackdrop();
                    if (_wmStack != null && _idleModel != null && _idleModel.Visible && !_idleModel.IsLaunchSuppressed(Efl.ecore_time_get())) _wmStack.EnsureStack(450);
                    if (_idleWin != null && pending != null)
                    {
                        if (pending.SourceType == 0) UpdateIdleWatchTimer(0.10);
                        else if (!StaysOnLiveTv(pending)) UpdateIdleWatchTimer(0.25);
                    }
                }
                else if (_ctl.Phase == Phase.Hidden) Efl.evas_object_hide(_win);
                if (_perf) PerfSample(dt, (Stopwatch.GetTimestamp() - t0) * 1000.0 / Stopwatch.Frequency, !more);
                ProbeTick(now, !more);
                if (more) return 1;
            }
            catch (Exception ex) { Log("frame: " + ex); }
            _anim = IntPtr.Zero;   // returning 0 makes ecore free the animator
            ReloadWhenHidden();
            return 0;
        }

        // ------------------------------------------------------------------ --perf: frame-time probe (off by default)

        // Per animation: how far apart the frames really are (vsync is 16.7 ms) and how long our own callback took.
        // Preallocated, so measuring does not allocate; one log line when the animation ends.
        private static bool _perf;
        private static string _perfWhy = "?";
        private static int _perfN;
        private static readonly double[] PerfDt = new double[2048], PerfWork = new double[2048];

        // The openings: the key to the first frame and to the end of the entrance, one line each (OpenProbe). Always on for the launcher's
        // own openings (Home, the Control center, All apps...), so a tester's diagnostics say how slow "slow" is on that TV (a Q70C with 2 GB
        // reported the launcher slower, 2026-11-19); it costs a few numbers per frame and one log line per opening. The Volume bar and the osd
        // 123 have their own animators and keep their probe behind --perf.
        private static OpenProbe _probe, _pillProbe, _padProbe;

        private static void ProbeBegin(string what) { if (_probe != null) _probe.Begin(what, Efl.ecore_time_get()); }
        private static void ProbeHandlerDone() { if (_probe != null) _probe.HandlerDone(Efl.ecore_time_get()); }
        private static void ProbeTick(double now, bool last)
        {
            if (_probe == null || !_probe.Active) return;
            string line = _probe.Tick(now, last);
            if (line != null) Log(line);
        }

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
                if (_dock != null && _ctl.Phase == Phase.Hidden && !_tasksOn)
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
                if (_pad != null && _pad.IsOnScreen) return;
                // Evas_Event_Key_Down starts with `const char *keyname`.
                string key = Marshal.PtrToStringAnsi(Marshal.ReadIntPtr(eventInfo));
                if (key == "XF86Home" && _homeClaimed && !DockActive) { WindowHome(); return; }
                if (Navigation.IsEcho(key, Efl.ecore_time_get())) return;
                HandleKey(key);
            }
            catch (Exception ex) { Log("key: " + ex); }
        }

        private static void OnKeyUp(IntPtr data, IntPtr evas, IntPtr obj, IntPtr eventInfo)
        {
            try
            {
                if (_pad != null && _pad.IsOnScreen) return;
                // Evas_Event_Key_Up starts with `const char *keyname` too.
                string key = Marshal.PtrToStringAnsi(Marshal.ReadIntPtr(eventInfo));
                if (IsOkKey(key)) { TaskOkUp(); RowOkUp(); }
                if (BackUp.WindowRelease(key)) { StopBackWait(); HideDock(); }
            }
            catch (Exception ex) { Log("key up: " + ex); }
        }

        /// <summary>A navigation key read straight from the input device, acted on only while the dock is up.</summary>
        private static void NavFromInput(int code)
        {
            string key = Navigation.Press(code, DockActive, Efl.ecore_time_get());
            if (key != null) HandleKey(key);
        }

        private static void HandleKey(string key)
        {
            try
            {
                if ((key == "XF86Back" || key == "XF86Exit" || key == "Escape") && Efl.ecore_time_get() < _arrivalBackShieldUntil) return;
                if (_tasksOn)
                {
                    // OK on the Task manager is a tap (open) or a hold (close): HoldKey decides on the key's release.
                    if (IsOkKey(key) && FocusedCard == CardKind.Tasks) TaskOkDown(); else OnTaskKey(key);
                    return;
                }
                if (_moveIndex >= 0)
                {
                    // The OK that started the move is still held: its auto-repeat must not be read as the OK that ends it
                    // (the move ended by itself a moment after it began, and the tile could not be carried).
                    if (IsOkKey(key) && RowOk.IsDown) return;
                    MoveKey(key);
                    return;
                }
                // OK on the apps row, All apps and Sources acts when it comes up: holding it moves a tile or adds it to the row instead.
                if (IsOkKey(key) && HoldsOk(_ctl) && _ctl.IsActive) { RowOkDown(); return; }
                int index;
                switch (_ctl.Key(key, out index))
                {
                    case KeyAction.Moved:
                        _perfWhy = "move";
                        StartAnimator();
                        ResetIdle();
                        break;
                    case KeyAction.Launch:
                        Activate(PageEntries(_ctl)[index]);
                        break;
                    case KeyAction.OpenPanel:
                        OpenInputs();
                        break;
                    case KeyAction.OpenTasks:
                        OpenTasks();
                        break;
                    case KeyAction.Back:
                        SelectPage(_appsCtl, _appsDock);
                        break;
                    case KeyAction.Hide:
                        if (key == "XF86Home")
                        {
                            double now = Efl.ecore_time_get();
                            if (now - _lastRawHome < HomeEchoSeconds) { Log("home echo ignored " + ((now - _lastRawHome) * 1000).ToString("0") + " ms after the press"); break; }
                            _lastHome = now;
                            NoteAppHomePress(now);
                            HideDock();
                            // Home reached the dock through evas and not through evdev: the evdev path, which arms the guard,
                            // will count this press as already handled (_lastHome), so it is armed here.
                            ArmGuard();
                            break;
                        }
                        // Back and Exit close on their release (BackRelease, #284): the app under the launcher must not get them.
                        if (BackUp.Press(key, Efl.ecore_time_get())) { StartBackWait(); break; }
                        HideDock();
                        break;
                }
            }
            catch (Exception ex) { Log("key: " + ex); }
        }

        private static readonly BackRelease BackUp = new BackRelease();
        private static IntPtr _backTimer;
        private static readonly Efl.TaskCb BackTickCb = OnBackTick;

        private static void StartBackWait()
        {
            ResetIdle();
            if (_backTimer == IntPtr.Zero) _backTimer = Efl.ecore_timer_add(0.05, BackTickCb, IntPtr.Zero);
        }

        private static void StopBackWait()
        {
            BackUp.Cancel();
            if (_backTimer != IntPtr.Zero) { Efl.ecore_timer_del(_backTimer); _backTimer = IntPtr.Zero; }
        }

        private static byte OnBackTick(IntPtr data)
        {
            try
            {
                if (!BackUp.Pending) { _backTimer = IntPtr.Zero; return 0; }
                if (!BackUp.Due(Efl.ecore_time_get())) return 1;
                _backTimer = IntPtr.Zero;   // returning 0 makes ecore free the timer
                BackUp.Cancel();
                Log("back: closed on the remote's release (no window key up)");
                HideDock();
            }
            catch (Exception ex) { _backTimer = IntPtr.Zero; Log("back: " + ex); }
            return 0;
        }

        private static VolumePill _pill;
        private static VolumeEdge _volumeEdge = VolumeEdge.Left;
        private static int _pillScreenW = DefaultScreenW, _pillScreenH = DefaultScreenH;

        private const string MuteKey = "memory/org.tizen.tv-viewer/mute_status";

        /// <summary>Samsung's own mute state (tv-viewer keeps it in a vconf bool; the sound manager does not know it).</summary>
        private static bool SamsungMuted()
        {
            int m;
            try { return Efl.vconf_get_bool(MuteKey, out m) == 0 && m != 0; } catch (Exception) { return false; }
        }

        // A volume key the Vetro service swallowed (the remote never reaches Samsung's own bar): change the level here and show the pill.
        // Mute is soft: the level goes to 0 and comes back to what it was, so Samsung's own mute banner never draws.
        // (Samsung's real mute is only used when the TV was already muted that way: a volume key first undoes it.)
        private static NumberPad _pad;
        private static bool _padFirstOpen = true;

        private static void EnsurePad()
        {
            if (_pad != null) return;
            _pad = new NumberPad(Path.Combine(AppContext.BaseDirectory, "res"), Log, _pillScreenW, _pillScreenH,
                delegate (PadResult kind, string what)
                {
                    string cmd = kind == PadResult.Send ? NumberPadModel.SendCommand(what, KeyTool) : NumberPadModel.SendKeyCommand(what, KeyTool);
                    Log("pad: sending " + what + " rc=" + Libc.system(cmd));
                },
                delegate (bool sent)
                {
                    // Opened over the Dock, closed with nothing sent after the Dock had gone too: the launcher left without opening
                    // anything, as when the Dock closes by itself. Opened over anything else (teletext, an app), the pad never brings the tuner.
                    bool fromDock = _padFromDock;
                    _padFromDock = false;
                    ScheduleSyncBackClaim(0.02);
                    if (fromDock && !sent) ResumeTuner("osd 123 closed after the dock");
                });
            _pad.OnActivity = () =>
            {
                if (!IsDisplayOff()) TriggerScreensaverActivityReset(Efl.ecore_time_get(), 10.0);
            };
        }

        private static void PrewarmPad()
        {
            if (_homeLaunch != null) return;
            try
            {
                EnsurePad();
                var flags = System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic;
                Type t = typeof(NumberPad);
                var build = t.GetMethod("Build", flags);
                var layoutPage = t.GetMethod("LayoutPage", flags);
                var refresh = t.GetMethod("Refresh", flags);
                var apply = t.GetMethod("Apply", flags);
                if (build != null) build.Invoke(_pad, null);
                if (layoutPage != null) layoutPage.Invoke(_pad, new object[] { true });
                if (refresh != null) refresh.Invoke(_pad, null);
                if (apply != null) apply.Invoke(_pad, null);
            }
            catch (Exception ex) { Log("pad prewarm: " + ex.Message); }
        }

        private static void TogglePad()
        {
            double keyAt = _perf ? Efl.ecore_time_get() : 0;
            bool first = _padFirstOpen;
            EnsurePad();
            bool opening = !_pad.IsShown;
            if (opening)
            {
                WakeOrResetScreensaverForUserAction(true);
                _padFirstOpen = false;
                _padFromDock = _dockMapped;
            }
            if (_perf && opening)
            {
                if (_padProbe == null) _padProbe = new OpenProbe();
                _padProbe.Begin(first ? "osd 123 (first, window built)" : "osd 123", keyAt);
                _pad.Probe = _padProbe;
            }
            _pad.Toggle();
            if (opening && _wmStack != null)
            {
                bool idleUp = _idleWin != null && (_idleWin.IsShown || _idleWin.IsParkedForScreensaver);
                _wmStack.EnsureStack(idleUp ? 500 : 0);
            }
            ScheduleSyncBackClaim(0.02);
            if (_perf && opening) _padProbe.HandlerDone(Efl.ecore_time_get());
        }

        // The Audio output card: the TV speakers and the paired Bluetooth audio devices, read when the Control center opens and again after a choice.
        private static void ReadOutputs(bool keepSelection)
        {
            // Read on the main loop when the Control center opens: how long these calls take on a TV is not known yet, so it is logged.
            long t0 = Stopwatch.GetTimestamp();
            List<BondedDevice> paired;
            bool listed = AudioOutputs.TryList(out paired);
            if (!listed) Log("outputs: no Bluetooth list (" + AudioOutputs.LastError + ")");
            int selection;
            if (!Sound.TryGetSpeakerSelection(out selection)) selection = -1;
            bool optical = Sound.HasOpticalOutput();
            List<OutputEntry> entries = OutputPickerModel.Build(paired, selection, true, LastExternal(selection), optical);
            string note = !listed ? "Bluetooth is off" : !OutputPickerModel.HasDevices(entries) ? "No paired speakers" : "";
            _lastAudioEntries = entries;
            _lastAudioNote = note;
            _audioCard.SetEntries(entries, note);
            _audioCtl.SetCount(entries.Count);
            if (!keepSelection) _audioCtl.Select(_audioCard.ActiveRow);
            Log("outputs: speaker selection " + selection + (optical ? ", optical port" : "") + ", " + entries.Count + " rows, read in "
                + ((Stopwatch.GetTimestamp() - t0) * 1000.0 / Stopwatch.Frequency).ToString("0", System.Globalization.CultureInfo.InvariantCulture) + " ms");
        }

        // The external output (optical, a receiver...) last seen playing, kept in a file beside the service's lists (vetro-dock-output, which
        // Restore the TV erases with the other vetro-* files) so that after a choice of the TV speakers (or a restart of the launcher) the
        // card still offers it. Written only when it changes.
        private static int _lastExternal = -2;
        private static int LastExternal(int selection)
        {
            string lists = string.IsNullOrEmpty(_appsPath) ? null : Path.GetDirectoryName(_appsPath);
            string file = Path.Combine(string.IsNullOrEmpty(lists) ? (_dir ?? "/home/owner") : lists, "vetro-dock-output");
            if (_lastExternal == -2)
            {
                _lastExternal = -1;
                try { int saved; if (int.TryParse(File.ReadAllText(file).Trim(), out saved) && OutputPickerModel.CanChooseAgain(saved)) _lastExternal = saved; } catch (Exception) { }
            }
            if (OutputPickerModel.CanChooseAgain(selection) && selection != _lastExternal)
            {
                _lastExternal = selection;
                try { File.WriteAllText(file, selection.ToString(System.Globalization.CultureInfo.InvariantCulture)); } catch (Exception) { }
            }
            return _lastExternal;
        }

        /// <summary>OK on the Audio output card: the sound goes to the selected row; the row says so until the list is read again.</summary>
        private static void ChooseOutput()
        {
            ResetIdle();
            if (_audioCard.Busy) return;
            OutputEntry e = _audioCard.EntryAt(_audioCtl.Selected);
            OutputAction what = OutputPickerModel.ActionFor(e);
            if (what == OutputAction.None) return;
            if (what == OutputAction.ScreenOff) { TurnScreenOff(); return; }
            bool ok = false;
            try { ok = OutputAction_(what, e); } catch (Exception ex) { Log("outputs: " + ex.Message); }
            _audioCard.SetBusy(_audioCtl.Selected, ok ? (what == OutputAction.Connect ? "Connecting…" : "Switching…") : "Not available");
            ApplyCards();
            CancelAudioReread();
            // A switch shows at once; a connection takes a few seconds more (the device is selected 2.5 s after it, see OnSelectBluetooth).
            _audioReread = Efl.ecore_timer_add(what == OutputAction.Connect ? 4.5 : 1.2, AudioRereadCb, IntPtr.Zero);
        }

        // "Turn off screen" on the Audio output card: Samsung's Picture Off, a deviced display state (lcdoff), the same one its Settings item
        // uses. The sound keeps playing; the first key that is not a volume or power key brings the picture back (Samsung's tvctx-manager does
        // it, or Vetro's input helper when it holds the remote: a key it passes on through uinput would leave the panel dark). The Control center
        // closes first, and the screen goes off once it has gone, off the main loop. Tried on a Q80A (fw 2310.0) on 2026-11-19.
        private const string ScreenOffCommand = "busctl --timeout=3 call org.tizen.system.deviced /Org/Tizen/System/DeviceD/Display "
            + "org.tizen.system.deviced.display ChangeState s lcdoff";
        private static readonly Efl.TaskCb ScreenOffCb = OnScreenOff;
        private static IntPtr _screenOffTimer;

        private static void CancelPendingScreenOff()
        {
            if (_screenOffTimer != IntPtr.Zero) { Efl.ecore_timer_del(_screenOffTimer); _screenOffTimer = IntPtr.Zero; }
            if (_idleLcdVerifyTimer != IntPtr.Zero) { Efl.ecore_timer_del(_idleLcdVerifyTimer); _idleLcdVerifyTimer = IntPtr.Zero; }
        }

        private static void TurnScreenOff()
        {
            if (_idleModel != null) _idleModel.OnPictureOff();
            HideDock();
            if (_screenOffTimer != IntPtr.Zero) Efl.ecore_timer_del(_screenOffTimer);
            _screenOffTimer = Efl.ecore_timer_add(0.5, ScreenOffCb, IntPtr.Zero);
        }

        private static byte OnScreenOff(IntPtr data)
        {
            _screenOffTimer = IntPtr.Zero;
            System.Threading.Tasks.Task.Run(() =>
            {
                string reply = Shell.Read(ScreenOffCommand).Trim();
                Log("screen: off " + (reply == "i 0" ? "ok" : "refused (" + (reply.Length == 0 ? "no answer" : reply) + ")"));
            });
            return 0;
        }

        // The Picture mode, Sleep timer and Shard cards: read off the main loop when the Control center opens, set the same way. While a read
        // or a choice is under way a timer looks for the answer.
        private static readonly bool[] _choiceFresh = new bool[TaskLayout.MaxCards];   // by position: the next answer puts the selection on the ticked row
        private static IntPtr _choicePoll;
        private static readonly Efl.TaskCb ChoicePollCb = OnChoicePoll;

        private static void StartChoicePoll()
        {
            if (_choicePoll == IntPtr.Zero && Array.Exists(_choiceSrcs, src => src != null)) _choicePoll = Efl.ecore_timer_add(0.1, ChoicePollCb, IntPtr.Zero);
        }

        private static byte OnChoicePoll(IntPtr data)
        {
            try
            {
                bool busy = false;
                for (int i = 0; i < _cards.Length; i++)
                {
                    ChoiceSource src = _choiceSrcs[i];
                    if (src == null) continue;
                    bool was = src.Busy;               // read before the take: an answer that lands between the two is taken at the next tick, not lost
                    ChoiceState st = src.TryTake();
                    if (st != null && _tasksOn)
                    {
                        if (_lastChoiceStates != null && i < _lastChoiceStates.Length) _lastChoiceStates[i] = st;
                        ChoiceCard card = _choiceCards[i];
                        TaskController ctl = _cardCtl[i];
                        card.SetState(st);
                        ctl.SetCount(card.Count);
                        if (_choiceFresh[i]) { ctl.Select(card.ActiveRow); _choiceFresh[i] = false; }
                        ApplyCards();
                        StartAnimator();
                    }
                    busy |= was;
                }
                if (busy) return 1;
            }
            catch (Exception ex) { Log("choice poll: " + ex); }
            _choicePoll = IntPtr.Zero;
            return 0;
        }

        /// <summary>
        /// OK on a Picture mode, Sleep timer or Shard card row (the card at position <paramref name="i"/>): the TV, or the Shard through Vetro,
        /// is asked to switch (off the main loop), and the card shows the state that comes back.
        /// </summary>
        private static void Choose(int i)
        {
            ResetIdle();
            ChoiceCard card = _choiceCards[i];
            TaskController ctl = _cardCtl[i];
            if (card == null) return;
            ChoiceRow row = card.RowAt(ctl.Selected);
            if (row == null || !card.Choosable || row.Active) return;
            if (!_choiceSrcs[i].Request(row)) return;
            Log(_choiceSrcs[i].Name + ": " + row.Label + " (" + (row.Id ?? row.Value.ToString(System.Globalization.CultureInfo.InvariantCulture)) + ")");
            card.SetBusy(ctl.Selected, "Switching…");
            ApplyCards();
            StartChoicePoll();
        }

        /// <summary>
        /// What reads (and sets) the choice card <paramref name="card"/>; null for the Task manager and the Audio output. A Shard's card asks
        /// the Vetro service with curl (never the Shard itself): the read, and a choice that answers the card's new state, so one call each.
        /// </summary>
        private static ChoiceSource ChoiceSourceFor(CardSpec card)
        {
            switch (card.Kind)
            {
                case CardKind.Picture:
                    return new ChoiceSource("picture mode", () =>
                    {
                        string raw = Shell.Read(PictureModes.GetAndCheckGroupCommand());
                        int split = raw.IndexOf("__GROUP__", StringComparison.Ordinal);
                        string get = split >= 0 ? raw.Substring(0, split) : raw;
                        string groupRaw = split >= 0 ? raw.Substring(split + 9) : "";
                        string checks = PictureModes.ParseGroupReply(groupRaw) ?? Shell.Read(PictureModes.CheckCommand());
                        return PictureModes.Build(get, checks);
                    }, PictureModes.SetCommand, Log);
                case CardKind.Sleep:
                    return new ChoiceSource("sleep timer", () => SleepTimer.Build(Shell.Read(SleepTimer.ReadCommand())), SleepTimer.SetCommand, Log);
                case CardKind.Shard:
                    string id = card.ShardId, name = "shard card " + id;
                    // The port is read when the command is made: --service-port is taken after the cards.
                    return new ChoiceSource(name,
                        () => ShardCard.Parse(ShardAnswer(ShardCard.ReadCommand(id, ShardLaunch.ServicePort))),
                        row =>
                        {
                            string result;
                            ChoiceState st = ShardCard.Parse(ShardAnswer(ShardCard.SelectCommand(id, row.Id, ShardLaunch.ServicePort)), out result);
                            Log(name + ": " + row.Id + " result " + (result ?? "none"));
                            return st;
                        }, Log);
                default:
                    return null;
            }
        }

        /// <summary>The service's answer to a Shard card command; empty (the card is then not available) for a command that could not be made.</summary>
        private static string ShardAnswer(string command) { return command == null ? "" : Shell.Read(command); }

        private static readonly Efl.TaskCb AudioRereadCb = OnAudioReread;
        private static IntPtr _audioReread;
        private static bool _audioSelectActive;        // the next read puts the selection on the output in use (the Control center has just opened)
        private const double AudioOpenDelay = 0.35;    // after the cards' entrance

        private static byte OnAudioReread(IntPtr data)
        {
            _audioReread = IntPtr.Zero;
            try { if (_tasksOn && HasCard(CardKind.Audio)) { bool select = _audioSelectActive; _audioSelectActive = false; ReadOutputs(!select); ApplyCards(); StartAnimator(); } }
            catch (Exception ex) { Log("outputs: " + ex.Message); }
            return 0;
        }

        private static void CancelAudioReread()
        {
            if (_audioReread != IntPtr.Zero) { Efl.ecore_timer_del(_audioReread); _audioReread = IntPtr.Zero; }
        }

        // A device that was just connected is selected as the sound output a moment later: the connection takes a second or two.
        private static readonly Efl.TaskCb SelectBtCb = OnSelectBluetooth;
        private static IntPtr _selectBtTimer;
        private static int _selectBtTries;
        private const double SelectBtDelay = 2.5;

        private static byte OnSelectBluetooth(IntPtr data)
        {
            _selectBtTimer = IntPtr.Zero;
            try
            {
                bool ok = Sound.TrySetSpeakerSelection(Sound.SpeakerBluetooth);
                Log("outputs: select Bluetooth after the connection " + (ok ? "ok" : "refused"));
                if (!ok && ++_selectBtTries < 2) _selectBtTimer = Efl.ecore_timer_add(SelectBtDelay, SelectBtCb, IntPtr.Zero);
            }
            catch (Exception ex) { Log("outputs: select Bluetooth: " + ex.Message); }
            return 0;
        }

        /// <summary>
        /// A choice in the Audio output. TV speakers and a device that is already connected: the sound output is switched with the call Samsung's own
        /// list makes (sound_manager_set_speaker_selection, 0 TV speaker, 5 Bluetooth). A paired device that is not connected is connected first
        /// (bt_audio_connect) and selected 2.5 s later.
        /// </summary>
        private static bool OutputAction_(OutputAction what, OutputEntry e)
        {
            bool ok;
            // Another choice made while a device chosen before is still connecting: that one must not take the sound a moment later.
            if (what != OutputAction.Connect && _selectBtTimer != IntPtr.Zero) { Efl.ecore_timer_del(_selectBtTimer); _selectBtTimer = IntPtr.Zero; }
            if (what == OutputAction.UseTv) ok = Sound.TrySetSpeakerSelection(Sound.SpeakerTv);
            else if (what == OutputAction.UseBluetooth) ok = Sound.TrySetSpeakerSelection(Sound.SpeakerBluetooth);
            // Back to optical or a receiver: the value Samsung's own list selects for it (set_speaker_selection with that output's number; static
            // reading of the 2021 list, the switch back to the TV speakers was seen working on a Tizen 9 S95C).
            else if (what == OutputAction.UseExternal) ok = Sound.TrySetSpeakerSelection(e.Selection);
            else
            {
                ok = AudioOutputs.TryConnect(e.Address);
                if (ok)
                {
                    if (_selectBtTimer != IntPtr.Zero) Efl.ecore_timer_del(_selectBtTimer);
                    _selectBtTries = 0;
                    _selectBtTimer = Efl.ecore_timer_add(SelectBtDelay, SelectBtCb, IntPtr.Zero);
                }
            }
            Log("outputs: " + what + " " + (e.Address ?? e.Label) + (ok ? " ok" : " refused (" + AudioOutputs.LastError + ")"));
            return ok;
        }

        private static int _levelBeforeMute;
        // Vol passed on to a receiver: waited for until input_keyevent has worked once, then started in the background (see KeyToolRun).
        private static readonly KeyToolRun VolumePassOn = new KeyToolRun();
        private static void VolumeKey(Command key)
        {
            double keyAt = _perf ? Efl.ecore_time_get() : 0;
            if (!IsDisplayOff()) WakeOrResetScreensaverForUserAction(false);
            // On a receiver on HDMI the level that counts is the receiver's: the key goes back to Samsung, which passes it on over HDMI-CEC
            // (the TV's own level would change and nothing would be heard). The same for an optical soundbar, which follows Samsung's universal
            // remote or Q-Symphony and not the TV's level (OutputPickerModel.VetroSetsLevel).
            int output;
            bool known = Sound.TryGetSpeakerSelection(out output);
            // The Audio card offers the external output again only once it has been seen playing; the card read it only when it opened, so
            // a TV switched to the TV speakers from Samsung's menu lost its Optical row (S95C, 2026-11-20). Vol reads it at every press.
            if (known) LastExternal(output);
            if (known && !OutputPickerModel.VetroSetsLevel(output))
            {
                string native = key == Command.VolUp ? "XF86AudioRaiseVolume" : key == Command.VolDown ? "XF86AudioLowerVolume" : "XF86AudioMute";
                bool detached = VolumePassOn.Works;
                int rc = Libc.system(VolumePassOn.Command(KeyTool + native));
                Log("volume: sound on output " + output + ", key passed to Samsung" + (detached ? " in the background" : "") + " rc=" + rc);
                // input_keyevent is only known on 2021 firmware: if it is missing or refuses, Vetro changes the TV's level itself, as before,
                // rather than leaving Vol dead.
                if (VolumePassOn.Passed(rc, detached)) return;
            }
            int volume;
            if (!Sound.TryGetVolume(out volume)) { Log("volume: the level cannot be read"); return; }
            bool muted = SamsungMuted();
            // Waited for on purpose: it runs once per mute (the key ends Samsung's mute, so a held Vol does not repeat it), and it must reach
            // Samsung before the level is set below.
            if (muted) { Log("unmute key rc=" + Libc.system(KeyTool + "XF86AudioMute")); muted = false; }
            int target = volume;
            if (key == Command.VolMute)
            {
                if (volume > 0) { _levelBeforeMute = volume; target = 0; }
                else target = _levelBeforeMute > 0 ? _levelBeforeMute : 10;
            }
            else
            {
                int from = volume == 0 && _levelBeforeMute > 0 ? _levelBeforeMute : volume;   // a step from silence continues from where mute began
                target = VolumeModel.Next(from, key == Command.VolUp ? 1 : -1, 1);
                _levelBeforeMute = 0;
            }
            if (target != volume) { if (Sound.TrySetVolume(target)) volume = target; else Log("volume: level change refused"); }
            if (_volumeEdge == VolumeEdge.Hidden) return;      // the level changes, no bar is drawn
            bool first = _pill == null;
            if (_pill == null) _pill = new VolumePill(Path.Combine(AppContext.BaseDirectory, "res"), Log, _pillScreenW, _pillScreenH, _volumeEdge);
            bool wasOnScreen = _pill.IsOnScreen;
            bool probe = _perf && !wasOnScreen;
            if (probe)
            {
                if (_pillProbe == null) _pillProbe = new OpenProbe();
                _pillProbe.Begin(first ? "volume bar (first, window built)" : "volume bar", keyAt);
                _pill.Probe = _pillProbe;
            }
            _pill.Show(volume, volume == 0 && _levelBeforeMute > 0);
            if (!wasOnScreen && _wmStack != null)
            {
                bool idleUp = _idleWin != null && (_idleWin.IsShown || _idleWin.IsParkedForScreensaver);
                _wmStack.EnsureStack(idleUp ? 500 : 0);
            }
            if (probe) _pillProbe.HandlerDone(Efl.ecore_time_get());
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
                            // As with the remote's Home (RawHome): an open osd 123 closes, or it stayed drawn under the Dock until its idle time.
                            case Command.Show: CancelPendingScreenOff(); CompleteScreensaverTakeoverWake(false); ClosePad(); _perfWhy = "fifo-show"; if (!DockActive) ProbeBegin("fifo show"); ShowDock(false); ProbeHandlerDone(); break;
                            case Command.Hide: _perfWhy = "fifo-hide"; HideDock(); break;
                            case Command.Toggle: CancelPendingScreenOff(); CompleteScreensaverTakeoverWake(false); ClosePad(); _perfWhy = "fifo-toggle"; if (DockActive) HideDock(); else { ProbeBegin("fifo toggle"); ShowDock(); ProbeHandlerDone(); } break;
                            case Command.VolUp: case Command.VolDown: case Command.VolMute: CancelPendingScreenOff(); CompleteScreensaverTakeoverWake(true); VolumeKey(c); break;
                            case Command.Pad: CancelPendingScreenOff(); CompleteScreensaverTakeoverWake(false); TogglePad(); break;
                            case Command.Rescan: if (_inputFds.Count > 0 || _homeCode > 0 || _learn) WatchNewNodes(); break;
                            case Command.Reload: ReloadLists(); break;
                            case Command.Idle: ApplyLiveIdleConfig(Commands.TakeIdleArgs()); break;
                            case Command.Launch: CompleteScreensaverTakeoverWake(false); HandleExternalLaunch(Commands.TakeLaunchArgs()); break;
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
                    InputReleases.Clear();
                    _inputReaders[index].Feed(InputBuf, (int)n, InputPresses, InputReleases);
                    if (InputPresses.Count > 0)
                    {
                        if (!_rawHomeSeen) _rawHomeSeen = true;
                        MarkClaimInputVerified();
                        if (_claimHome && !_claimTried) ClaimHome();
                    }
                    for (int k = 0; k < InputPresses.Count; k++)
                    {
                        int code = InputPresses[k];
                        if (_learn) Log("key code " + code);
                        if (_idleModel != null)
                        {
                            CancelPendingScreenOff();
                            bool hideBg;
                            bool wasDimmed = _idleModel.Dimmed;
                            bool wasTakeover = _idleModel.ScreensaverTakeoverActive || _wasScreensaverTakeoverActive;
                            double keyNow = Efl.ecore_time_get();
                            bool displayOff = IsDisplayOff();
                            bool consumed = _idleModel.OnRawKey(code, _homeCode, keyNow, displayOff, DockActive, out hideBg);
                            if (consumed && displayOff && code == _homeCode) _lastRawHome = keyNow;
                            if (wasDimmed && !_idleModel.Dimmed && _idleWin != null) _idleWin.SetDimmed(false);
                            if (hideBg || consumed) Log("idle: key=" + code + " hideBg=" + hideBg + " consumed=" + consumed);
                            if (hideBg && _idleWin != null)
                            {
                                if (wasTakeover || _screensaverWakePendingRelease)
                                {
                                    CompleteScreensaverTakeoverWake(true);
                                    continue;
                                }
                                _idleWin.Hide();
                            }
                            if (!displayOff && (_idleModel.ScreensaverTakeoverActive || _screensaverWakePendingRelease))
                            {
                                if (code == _homeCode)
                                {
                                    CompleteScreensaverTakeoverWake(false);
                                }
                                else if (code == 174)
                                {
                                    HandleExitKey(keyNow);
                                    continue;
                                }
                                else
                                {
                                    ArmScreensaverTakeoverWakeRelease(keyNow);
                                    continue;
                                }
                            }
                            if ((code == 116 || code == 112 || code == 142) && _idleWin != null)
                            {
                                _idleModel.OnWake(keyNow, displayOff);
                                if (_wmStack != null && (_idleModel.Visible || _idleModel.HoldOcclusionForScreensaver)) _wmStack.EnsureStack(2500);
                                _fastIdleWatchUntil = Math.Max(_fastIdleWatchUntil, keyNow + 2.5);
                                PollIdleBackdrop();
                                UpdateIdleWatchTimer(0.10);
                            }
                            else if (_idleWin != null && code == 174 && (_pad == null || !_pad.IsOnScreen))
                            {
                                HandleExitKey(keyNow);
                                continue;
                            }
                            else if (_idleWin != null && (code == 1 || code == 158))
                            {
                                if (_idleModel.HoldOcclusionForScreensaver)
                                {
                                    _fastIdleWatchUntil = Math.Max(_fastIdleWatchUntil, keyNow + 2.5);
                                    PollIdleBackdrop();
                                    UpdateIdleWatchTimer(0.10);
                                }
                                else if (!_idleModel.Visible && !DockActive && (_pad == null || !_pad.IsOnScreen))
                                {
                                    CancelBackHoldTimer();
                                    _backHoldCode = code;
                                    _backPrewarmTimer = Efl.ecore_timer_add(0.01, BackPrewarmCb, IntPtr.Zero);
                                    _backHoldTimer = Efl.ecore_timer_add(0.45, BackHoldCb, IntPtr.Zero);
                                    _backForceCloseTimer = Efl.ecore_timer_add(0.55, BackForceCloseCb, IntPtr.Zero);
                                    _fastIdleWatchUntil = Math.Max(_fastIdleWatchUntil, keyNow + 2.5);
                                    PollIdleBackdrop();
                                    UpdateIdleWatchTimer(0.10);
                                }
                            }
                            else if (_idleWin != null && !_idleModel.Visible && (code == 28 || code == 353 || code == _homeCode))
                            {
                                if (_idleModel.HoldOcclusionForScreensaver || code == _homeCode)
                                    _fastIdleWatchUntil = Math.Max(_fastIdleWatchUntil, keyNow + 2.5);
                                PollIdleBackdrop();
                                UpdateIdleWatchTimer(0.10);
                            }
                            else if (_idleWin != null && (_idleModel.Visible || _idleModel.HoldOcclusionForScreensaver) && !DockActive
                                && code != _homeCode)
                            {
                                if (code != 66 && code != 67 && code != 68 && IdleBackdropModel.IsOverlayLaunchKey(code))
                                {
                                    bool padAlreadyOpen = _pad != null && _pad.IsOnScreen;
                                    if (!(code == Raw123Code && padAlreadyOpen))
                                    {
                                        _backReleaseUntil = keyNow + 1.0;
                                        SyncBackClaim();
                                        if (_wmStack != null) _wmStack.PartialActive = true;
                                    }
                                }
                                if (_idleModel.HoldOcclusionForScreensaver || (code != 66 && code != 67 && code != 68))
                                {
                                    _fastIdleWatchUntil = Math.Max(_fastIdleWatchUntil, keyNow + 2.0);
                                    UpdateIdleWatchTimer(0.10);
                                }
                            }
                            if (consumed) continue;
                        }
                        if (code != _homeCode)
                        {
                            // While osd 123 is on screen, route raw evdev navigation/Back/Exit to it (matching Dock's NavFromInput)
                            // and skip Dock/Task manager navigation underneath.
                            if (_pad != null && _pad.IsOnScreen) { _pad.HandleRawInput(code); continue; }
                            if (code == Raw123Code && DockActive)
                            {
                                // Samsung's own 123 pad opens and takes the keys: two panels answering the arrows is worse than one.
                                Log("123 reached the TV (Samsung's own pad opens): the dock steps aside");
                                _hideFor123 = true;
                                HideDock();
                                continue;
                            }
                            NavFromInput(code);
                            continue;
                        }
                        RawHome();
                    }
                    // The kernel always reports the release: it ends a held OK even when the window's key up is late.
                    for (int k = 0; k < InputReleases.Count; k++)
                    {
                        int rel = InputReleases[k];
                        if (_pad != null && _pad.IsOnScreen)
                        {
                            _pad.HandleRawRelease(rel);
                            continue;
                        }
                        if (rel == RawOkCode) { TaskOkUp(); RowOkUp(); }
                        else if (rel == RawBackCode) BackUp.KernelRelease(Efl.ecore_time_get());
                        if (_idleWin != null && _idleModel != null && (_screensaverWakePendingRelease || _idleModel.ScreensaverTakeoverActive))
                        {
                            CompleteScreensaverTakeoverWake(rel != _homeCode);
                            continue;
                        }
                        if (_idleWin != null && _idleModel != null && (rel == 1 || rel == 158 || rel == 174))
                        {
                            if (rel == 1 || rel == 158) CancelBackHoldTimer();
                            double relNow = Efl.ecore_time_get();
                            if (_arrivalBackShieldUntil > relNow + 0.12) _arrivalBackShieldUntil = relNow + 0.12;
                            if (!_idleModel.Visible)
                            {
                                _fastIdleWatchUntil = Math.Max(_fastIdleWatchUntil, relNow + 2.5);
                                PollIdleBackdrop();
                                UpdateIdleWatchTimer(0.05);
                            }
                        }
                    }
                }
            }
            catch (Exception ex) { Log("input: " + ex); }
            return 1;
        }

        // The kill chain is one shell that puts itself in the background, but starting it still waits for a shell to start (system()). That
        // wait used to sit between the Home key and the dock's first frame; now the generation is written at once (so CancelGuard works as
        // before) and the shell is started by a zero-delay timer added after the next frame has been laid out, or at once when nothing is
        // being drawn. A second press before it ran replaces it: the older chain would have stopped at its first check anyway.
        private static readonly PendingCommand GuardSpawn = new PendingCommand();
        private static IntPtr _guardTimer;
        private static readonly Efl.TaskCb GuardSpawnCb = OnGuardSpawn;

        /// <summary>The osd 123 fades out if it is open (Home and the fifo's show and toggle: the Dock must not open over it).</summary>
        private static void ClosePad() { if (_pad != null && _pad.IsShown) _pad.Close(); }

        /// <summary>The Home key read from the input device: the dock opens or closes (or the custom launcher's app opens), and the guard is armed.</summary>
        private static void RawHome() { HomePress(true); }

        /// <summary>
        /// XF86Home on the window while the dock is hidden, which only the claim brings there. Within <see cref="HomeEchoSeconds"/> of a
        /// press the input reader answered it is that press again; otherwise it is a press the reader did not see (a Home sent by name,
        /// input_keyevent, or a remote the reader does not hold) and the dock opens.
        /// </summary>
        private static void WindowHome()
        {
            double now = Efl.ecore_time_get();
            // The echo of a press the reader answered, or the same press the window's evas already answered.
            if (now - _lastRawHome < HomeEchoSeconds || now - _lastHome < HomeDebounceSeconds) return;
            Log("home: claimed press from the window");
            HomePress(false);
        }

        /// <summary>One Home press. raw: read from the input device, so the window's copy that follows is its echo.</summary>
        private static void HomePress(bool raw)
        {
            if (_idleModel != null && (_idleModel.ScreensaverTakeoverActive || _screensaverWakePendingRelease))
                CompleteScreensaverTakeoverWake(false);
            ClosePad();
            double now = Efl.ecore_time_get();
            // The focused dock also gets XF86Home through evas and hides itself: count it once.
            if (now - _lastHome < HomeDebounceSeconds) return;
            _lastHome = now;
            if (raw) { _lastRawHome = now; _rawHomeSeen = true; MarkClaimInputVerified(); }
            if (_rawHomeSeen && _claimHome && !_claimTried) ClaimHome();
            NoteAppHomePress(now);
            _perfWhy = "home";
            if (_homeLaunch != null)
            {
                // The Home app is started without Samsung's loader (#334); the guard below still keeps Samsung's own Home away.
                try { Log("home-launch " + _homeLaunch.AppId + " rc=" + Libc.system(HomeLaunch.Command(_homeLaunch.AppId))); }
                catch (Exception ex) { Log("home-launch failed: " + ex.Message); LaunchApp(_homeLaunch); }
                ArmGuard();
                return;
            }
            if (DockActive) HideDock(); else { ProbeBegin("home"); ShowDock(); }
            ArmGuard();
            ProbeHandlerDone();
        }

        /// <summary>
        /// The remote's nodes are opened before the pages are built, so what is pressed while the launcher starts waits in their buffers. Just
        /// before the main loop starts they are read once: a Home press among them is answered now (until this change it was lost: nothing read
        /// the remote yet), and every other key of that time is dropped, as it always was.
        /// </summary>
        private static void DrainStartupInput()
        {
            bool home = false;
            for (int index = 0; index < _inputFds.Count; index++)
            {
                if (_inputFds[index] < 0) continue;
                for (int round = 0; round < 64; round++)
                {
                    long n = (long)Libc.read(_inputFds[index], InputBuf, (UIntPtr)InputBuf.Length);
                    if (n <= 0) break;
                    InputPresses.Clear();
                    InputReleases.Clear();
                    _inputReaders[index].Feed(InputBuf, (int)n, InputPresses, InputReleases);
                    if (InputPresses.Contains(_homeCode)) home = true;
                }
            }
            if (!home) return;
            Log("home pressed while the launcher was starting: answered now");
            RawHome();
        }

        private static void MarkClaimInputVerified()
        {
            if (string.IsNullOrEmpty(_claimVerifiedPath)) return;
            try
            {
                if (!File.Exists(_claimVerifiedPath)) File.WriteAllText(_claimVerifiedPath, "1");
            }
            catch (Exception) { }
        }

        /// <summary>Claims XF86Home once (--claim-home, never in custom launcher mode), after the input reader has heard a real press, and says how it went in the log.</summary>
        private static void ClaimHome()
        {
            if (!_claimHome || _claimTried || !_rawHomeSeen || _homeLaunch != null) return;
            _claimTried = true;
            try
            {
                _homeClaimed = Efl.elm_win_keygrab_set(_win, "XF86Home", 0, 0, 0, KeygrabExclusive);
                Log("home: claim " + (_homeClaimed ? "granted" : "refused"));
            }
            catch (Exception ex) { Log("home: claim unavailable"); Log("home claim: " + ex.GetType().Name + " " + ex.Message); }
            if (_homeClaimed) WatchEcoreKeys();
            try
            {
                if (_homeClaimed) File.WriteAllText(_claimPath, Libc.getpid().ToString(System.Globalization.CultureInfo.InvariantCulture));
                else Libc.unlink(_claimPath);
            }
            catch (Exception ex) { Log("home claim file: " + ex.Message); }
        }

        // The key events of ecore_input, for the claimed Home while the window is hidden (evas drops a key for a window that is not shown).
        private static readonly Efl.EventCb EcoreKeyCb = OnEcoreKey;
        private static int _ecoreKeyDown = -1;

        private static void PreloadEcoreKeyEvent()
        {
            if (_ecoreKeyDown >= 0) return;
            try
            {
                IntPtr lib = System.Runtime.InteropServices.NativeLibrary.Load("libecore_input.so.1");
                _ecoreKeyDown = Marshal.ReadInt32(System.Runtime.InteropServices.NativeLibrary.GetExport(lib, "ECORE_EVENT_KEY_DOWN"));
            }
            catch (Exception ex) { Log("home: preload key event: " + ex.Message); }
        }

        private static void WatchEcoreKeys()
        {
            if (_ecoreKeysWatched) return;
            try
            {
                PreloadEcoreKeyEvent();
                bool ok = _ecoreKeyDown >= 0 && Efl.ecore_event_handler_add(_ecoreKeyDown, EcoreKeyCb, IntPtr.Zero) != IntPtr.Zero;
                if (ok) _ecoreKeysWatched = true;
                Log("home: window keys " + (ok ? "on" : "refused"));
            }
            catch (Exception ex) { Log("home: window keys unavailable"); Log("home claim: " + ex.GetType().Name + " " + ex.Message); }
        }

        private static byte OnEcoreKey(IntPtr data, int type, IntPtr ev)
        {
            try
            {
                // Ecore_Event_Key starts with `const char *keyname`.
                string key = ev == IntPtr.Zero ? null : Marshal.PtrToStringAnsi(Marshal.ReadIntPtr(ev));
                if (key == "XF86Home" && !DockActive) WindowHome();
                else if (key == "XF86Exit" && _exitClaimed)
                {
                    HandleExitKey(Efl.ecore_time_get());
                }
                else if (key == "XF86Back" && _backClaimed && !DockActive)
                {
                    string partial = Efl.VconfGetString("memory/appfw/current_partial_appid");
                    string full = Efl.VconfGetString("memory/appfw/current_fullscreen_appid");
                    if (IdleBackdropModel.ShouldForwardGrabbedBack(partial, full, IsAnyRealScreensaverActive))
                    {
                        _backReleaseUntil = Efl.ecore_time_get() + 1.0;
                        SyncBackClaim();
                        PollIdleBackdrop();
                        System.Threading.Tasks.Task.Run(() =>
                        {
                            try { Libc.system("/usr/bin/input_keyevent XF86Back >/dev/null 2>&1"); } catch (Exception) { }
                        });
                    }
                }
            }
            catch (Exception ex) { Log("ecore key: " + ex.Message); }
            return 1;   // ECORE_CALLBACK_PASS_ON
        }

        private static void ArmGuard()
        {
            _samsungHomeRequested = false;
            _samsungHomeObserved = false;
            if (_wmStack != null) _wmStack.AllowSamsungHome = false;
            if (_idleModel != null && !_idleModel.Visible && _idleWin != null) PollIdleBackdrop();
            if (_guardApps == null) return;
            try
            {
                NewGuardGeneration();
                GuardSpawn.Set(HomeGuard.Command(_guardApps, _guardFile, _guardGen, PreserveWarmCsfs()));
                if (_anim == IntPtr.Zero) ScheduleGuard();
            }
            catch (Exception ex) { Log("guard: " + ex.Message); }
        }

        private static void ScheduleGuard()
        {
            if (GuardSpawn.Pending && _guardTimer == IntPtr.Zero) _guardTimer = Efl.ecore_timer_add(0.0, GuardSpawnCb, IntPtr.Zero);
        }

        private static byte OnGuardSpawn(IntPtr data)
        {
            _guardTimer = IntPtr.Zero;   // returning 0 makes ecore free the timer
            try
            {
                string cmd = GuardSpawn.Take();
                if (cmd == null) return 0;
                long t0 = _perf ? Stopwatch.GetTimestamp() : 0;
                System.Threading.Tasks.Task.Run(() =>
                {
                    try
                    {
                        Libc.system(cmd);
                        if (_perf) Log("perf guard: shell started in " + ((Stopwatch.GetTimestamp() - t0) * 1000.0 / Stopwatch.Frequency).ToString("0.0", System.Globalization.CultureInfo.InvariantCulture) + " ms");
                    }
                    catch (Exception ex) { Log("guard: " + ex.Message); }
                });
            }
            catch (Exception ex) { Log("guard: " + ex.Message); }
            return 0;
        }

        /// <summary>Retires every kill that is still waiting: the guarded app was asked for on purpose.</summary>
        private static void CancelGuard()
        {
            _samsungHomeRequested = true;
            _samsungHomeObserved = false;
            _samsungHomeRequestedUntil = Efl.ecore_time_get() + 5.0;
            BumpDismissRestoreGen();
            if (_wmStack != null) _wmStack.AllowSamsungHome = true;
            SyncBackClaim();
            if (_guardApps == null) return;
            try { NewGuardGeneration(); Log("guard: cancelled, " + string.Join(",", _guardApps) + " was asked for"); }
            catch (Exception ex) { Log("guard cancel: " + ex.Message); }
        }

        private static void NewGuardGeneration()
        {
            _guardGen++;
            if (!string.IsNullOrEmpty(_guardFile))
                File.WriteAllText(_guardFile, _guardGen.ToString(System.Globalization.CultureInfo.InvariantCulture));
        }

        private static void EnsureGuardFile()
        {
            if (string.IsNullOrEmpty(_guardFile) || File.Exists(_guardFile)) return;
            File.WriteAllText(_guardFile, _guardGen.ToString(System.Globalization.CultureInfo.InvariantCulture));
        }

        private static void EnsureDismissRestoreFile(int gen)
        {
            if (string.IsNullOrEmpty(_dismissRestoreFile) || File.Exists(_dismissRestoreFile)) return;
            File.WriteAllText(_dismissRestoreFile, gen.ToString(System.Globalization.CultureInfo.InvariantCulture));
        }

        private static void BumpDismissRestoreGen()
        {
            int next = System.Threading.Interlocked.Increment(ref _dismissRestoreGen);
            _closeTracker.Reset();
            if (string.IsNullOrEmpty(_dismissRestoreFile)) return;
            try { File.WriteAllText(_dismissRestoreFile, next.ToString(System.Globalization.CultureInfo.InvariantCulture)); }
            catch (Exception ex) { Log("idle: restore gen: " + ex.Message); }
        }

        private static void NoteAppHomePress(double now)
        {
            if (_idleModel != null && !_idleModel.Visible && !_idleModel.HoldOcclusionForScreensaver)
            {
                _lastAppHomePress = now;
                string fg = Efl.VconfGetString(FullscreenAppIdKey);
                if (!string.IsNullOrEmpty(fg)
                    && fg != IdleBackdropModel.TvViewerAppId
                    && !IdleBackdropModel.IsGuardedSamsungHome(fg)
                    && !IdleBackdropModel.IsScreensaverApp(fg)
                    && Catalog.ValidAppId(fg))
                {
                    _lastPausedAppId = fg;
                }
                BumpDismissRestoreGen();
            }
        }

        // ------------------------------------------------------------------ launching

        // #200: an app that is only an HbbTV link (SVT Play) is opened through the HbbTV app: started by its id, the widget
        // only shows its loading wheel. Samsung's Home sends the link with tizenid, deeplink and caller_process as well;
        // tizenid starts a deep-link session, and when it ends the HbbTV library opens Samsung's Home (m_HandleDeeplinkExit),
        // so the operation and the link go alone (app/service/hbbtv-link.js has the details and the TV checks). The link
        // was checked by Catalog.ValidHbbtvLink and goes to app_control as data, never through a shell.
        private const string HbbtvApp = "org.tizen.hbbtv";
        private const string OperationDefault = "http://tizen.org/appcontrol/operation/default";

        private static bool SendHbbtvLaunch(string link)
        {
            IntPtr ac;
            if (Efl.app_control_create(out ac) != 0) return false;
            try
            {
                if (Efl.app_control_set_operation(ac, OperationDefault) != 0) return false;
                if (Efl.app_control_set_app_id(ac, HbbtvApp) != 0) return false;
                if (Efl.app_control_add_extra_data(ac, "hbbtv", link) != 0) return false;
                return Efl.app_control_send_launch_request(ac, IntPtr.Zero, IntPtr.Zero) == 0;
            }
            finally { Efl.app_control_destroy(ac); }
        }

        private static bool SendLaunch(string appId)
        {
            IntPtr ac;
            if (Efl.app_control_create(out ac) != 0) return false;
            try
            {
                Efl.app_control_set_app_id(ac, appId);
                Efl.app_control_add_extra_data(ac, "__K_SPLASH_SCREEN", "LA_UI_DEFAULT");
                Efl.app_control_add_extra_data(ac, "__K_EX_LAUNCH_REQUESTOR", "user");
                return Efl.app_control_send_launch_request(ac, IntPtr.Zero, IntPtr.Zero) == 0;
            }
            finally { Efl.app_control_destroy(ac); }
        }

        /// <summary>OK on an entry: open a page, switch input, or launch; everything but a page closes the dock.</summary>
        private static void Activate(AppEntry e)
        {
            if (e.Panel != null)
            {
                if (e.Panel == "inputs") OpenInputs(); else if (e.Panel == "allapps") OpenAllApps(); else Log("unknown panel " + e.Panel);
                return;
            }
            if (HomeGuard.ShouldCancel(_guardApps, e.AppId)) CancelGuard();
            HideDock();
            _pendingLaunch = e;
        }

        /// <summary>
        /// Switches input the way Samsung's own Source tile does (CompSource, SourceChangeViaTVViewer):
        /// a launch request to tv-viewer carrying the input number. tv-viewer refuses a missing icon,
        /// so the firmware's own device icon is passed along.
        /// </summary>
        private sealed class SourceControl : ISourceControl
        {
            public int Create(out IntPtr handle) { return Efl.app_control_create(out handle); }
            public int SetAppId(IntPtr handle, string appId) { return Efl.app_control_set_app_id(handle, appId); }
            public int AddData(IntPtr handle, string key, string value) { return Efl.app_control_add_extra_data(handle, key, value); }
            public int Send(IntPtr handle) { return Efl.app_control_send_launch_request(handle, IntPtr.Zero, IntPtr.Zero); }
            public void Destroy(IntPtr handle) { Efl.app_control_destroy(handle); }
        }

        private static void SwitchSource(AppEntry e)
        {
            try
            {
                string icon = Launcher.Core.SourceSwitch.ResolveIcon(e, File.Exists);
                if (icon == null)
                {
                    // No icon file on this firmware: do what the dashboard's Inputs page does and press the input's key instead.
                    string key = Launcher.Core.SourceSwitch.FallbackKey(e);
                    if (key == null) { Log("source " + e.SourceType + ": no icon, request not sent"); return; }
                    int krc = Libc.system(KeyTool + key);
                    Log("source " + e.SourceType + ": no icon, key " + key + " rc=" + krc);
                    return;
                }
                int rc = Launcher.Core.SourceSwitch.Send(e.SourceType, e.Label, icon, File.Exists, new SourceControl());
                Log("source " + e.SourceType + ": request with icon rc=" + rc);
            }
            catch (Exception ex) { Log("source error: " + ex.Message); }
        }

        private const string KeyTool = "/usr/bin/input_keyevent ";
        private static readonly Efl.TaskCb KeyTimerCb = OnKeyTimer;
        private static AppEntry _pendingKey;
        private static IntPtr _keyTimer;

        private static void CancelPendingKey()
        {
            _pendingKey = null;
            if (_keyTimer != IntPtr.Zero) { Efl.ecore_timer_del(_keyTimer); _keyTimer = IntPtr.Zero; }
        }

        // A remote key is sent only once our window is gone: while it is still mapped it would
        // take the key itself. One-shot timer, so nothing runs while the dock is idle.
        private static byte OnKeyTimer(IntPtr data)
        {
            AppEntry e = _pendingKey;
            _pendingKey = null;
            _keyTimer = IntPtr.Zero;   // returning 0 makes ecore free the timer
            try
            {
                if (e == null) return 0;
                int rc = SystemWithErrno(KeyTool + e.Key);   // Key is letters and digits only (Catalog.IsKeyName)
                int err;
                bool ok = SystemSucceeded(rc, out err);
                Log("key " + e.Key + " rc=" + rc + (ok && rc != 0 ? " (reaped)" : ""));
                if (!ok && e.AppId != null) LaunchApp(e);
            }
            catch (Exception ex) { Log("key timer: " + ex.Message); }
            return 0;
        }

        private static void Launch(AppEntry e)
        {
            if (e.Key != null)
            {
                CancelPendingKey();   // two quick activations: the first timer must not fire with the second entry
                _pendingKey = e;
                _keyTimer = Efl.ecore_timer_add(0.30, KeyTimerCb, IntPtr.Zero);
                return;
            }
            LaunchApp(e);
        }

        private static void LaunchApp(AppEntry e)
        {
            try
            {
                if (_homeLaunch == null && !StaysOnLiveTv(e))
                {
                    NoteLaunchEpoch(e.AppId);
                    CancelDeferredForceClose();
                    BumpDismissRestoreGen();
                    _lastAppHomePress = -100;
                }
                if (e.ViaShard)
                {
                    string viaService = ShardLaunch.Command(e, ShardLaunch.ServicePort, true);
                    if (viaService != null)
                    {
                        Log("launch " + e.AppId + " through its plugin rc=" + Libc.system(viaService));
                        return;
                    }
                }
                if (e.KillFirst != null && e.AppId != null)
                {
                    // Close the other app first, then start this one: one detached shell, so the dock does not wait.
                    // Both ids are plain Tizen ids (Catalog.ValidAppId), safe on a command line.
                    int rc = Libc.system("( /usr/bin/app_launcher -k " + e.KillFirst + "; sleep 0.4; /usr/bin/app_launcher -s " + e.AppId + " ) >/dev/null 2>&1 &");
                    Log("launch " + e.AppId + " after closing " + e.KillFirst + " rc=" + rc);
                    return;
                }
                if (HomeGuard.ShouldCancel(_guardApps, e.AppId)) CancelGuard();
                if (e.SystemApp || e.AppId == "com.samsung.tv.csfs")
                {
                    // Samsung's Home ignores a plain app-control request from here (logged as launched, never shown);
                    // the platform's own launcher starts it. The same goes for the other system controls (sys: rows).
                    Log("launch " + e.AppId + " rc=" + Libc.system(SystemLaunch.Command(e.AppId, e.FallbackAppId)));
                    return;
                }
                if (e.HbbtvLink != null)
                {
                    long h0 = Stopwatch.GetTimestamp();
                    bool opened = SendHbbtvLaunch(e.HbbtvLink);
                    long hms = (Stopwatch.GetTimestamp() - h0) * 1000 / Stopwatch.Frequency;
                    if (opened) { Log("launch " + e.AppId + " via HbbTV request " + hms + " ms"); return; }
                    Log("launch via HbbTV failed: " + e.AppId);   // then by its id, as before
                }
                long t0 = Stopwatch.GetTimestamp();
                bool sent = SendLaunch(e.AppId);
                long ms = (Stopwatch.GetTimestamp() - t0) * 1000 / Stopwatch.Frequency;
                if (sent) { Log("launch " + e.AppId + " request " + ms + " ms"); return; }
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
            Controller[] ctls = { _appsCtl, _inputsCtl, _allCtl };
            Dock[] docks = { _appsDock, _inputsDock, _allDock };
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
            // The Control center's cards too, with empty lists (they are drawn hidden: the clippers are off), then the unmapped
            // window is released so baseline RAM/VRAM stays minimal until the user presses Down.
            if (_cards.Length > 0)
            {
                if (_taskWin == IntPtr.Zero) BuildTaskWindow();
                if (_taskWin != IntPtr.Zero)
                {
                    OpenCards(0f);
                    for (int i = 0; i < 20; i++) { TickCards(1.0 / 60.0); ApplyCards(); }
                    DropCards();
                    DestroyTaskWindow();
                }
            }
            // Warm up NumberPad model, motion and frame step so the first 123 open does not pay for JIT.
            var warmPadModel = new NumberPadModel();
            var warmPadMotion = new PadMotion();
            var warmPadStep = new FrameStep(0.05);
            warmPadModel.Reset();
            warmPadModel.Key("Right");
            warmPadModel.Key("Return");
            warmPadModel.Key("Left");
            warmPadModel.Key("Up");
            warmPadModel.Key("Down");
            warmPadModel.Key("BackSpace");
            warmPadModel.Key("XF86Back");
            NumberPadModel.BodyWidth(NumberPadModel.Digits);
            NumberPadModel.BodyWidth(NumberPadModel.Colors);
            warmPadMotion.Fade = 0;
            warmPadMotion.FocusX = 64;
            warmPadStep.Begin(0.0);
            bool padGone;
            for (int i = 0; i < 20; i++)
            {
                warmPadMotion.Step(warmPadStep.Next((i + 1) * (1.0 / 60.0)), false, false, 136, out padGone);
            }
            warmPadStep.Resume();
            for (int i = 0; i < 12; i++)
            {
                warmPadMotion.Step(1.0 / 60.0, true, false, 136, out padGone);
            }
            // Warm up ambient idle backdrop math/UV paths so TieredCompilation promotes them before elm_run.
            var warmClock = new AnimClock(1.0 / 60.0, 0.05);
            for (int i = 0; i < 80; i++)
            {
                double dt, rawDt;
                bool hasRealDt;
                warmClock.TryStep(i * (1.0 / 60.0), out dt, out rawDt, out hasRealDt);
                double tMs = 9000.0 + i * 16.67;
                AmbientLakeEngine.LakeRenderFrame lf;
                AmbientLakeEngine.ComputeFrame(tMs, _screenW, _screenH, false, out lf);
                IdleBackdropModel.AuroraRibbonMotion rm;
                AmbientLakeEngine.ComputeAuroraRibbonMotion(i % AmbientLakeEngine.AuroraRibbonCount, tMs, _screenW, _screenH, false, out rm);
                IdleBackdropModel.MoteMotion mm;
                AmbientLakeEngine.ComputeAuroraMoteMotion(i % AmbientLakeEngine.AuroraActiveMoteCount, tMs, _screenW, _screenH, false, out mm);
                IdleBackdropModel.SubpixelQuad q;
                IdleBackdropModel.ComputeSpriteSubpixelQuad(mm.X, mm.Y, mm.Size, mm.Size, 24, 24, 3, 30, 30, out q);
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
            if (args.Length > 0 && args[0] == "--switch-source")
            {
                try { return Launcher.Core.SourceSwitch.RunCommand(args, File.Exists, new SourceControl(), Console.Out); }
                catch (Exception ex) { Console.Error.WriteLine("Source switch failed: " + ex.Message); return 1; }
            }
            if (Flag(args, "--get-home")) return GetHome();
            // Not dumpable (#335): on an unexpected signal Samsung's coredump handler froze every thread of this process for ~20 s while its
            // Wayland windows and the Home key grab stayed held, locking the remote. Children started later are dumpable again (execve).
            try { Libc.prctl(Libc.PR_SET_DUMPABLE, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero); } catch (Exception) { }
            _perf = Flag(args, "--perf");
            _probe = new OpenProbe();
            _volumeEdge = VolumePlacement.ParseEdge(Arg(args, "--volume-edge"));
            _idleConfig = IdleConfig.Parse(Arg(args, "--idle-mode"), Flag(args, "--idle-autodock"), Arg(args, "--idle-potoff"), Arg(args, "--idle-level"), Flag(args, "--idle-no-screensaver"));
            ShardLaunch.ServicePort = ShardLaunch.ParsePort(Arg(args, "--service-port"));
            // --no-motion (Reduce motion): show, hide, page changes and navigation are immediate; no icon zoom or lift.
            if (Flag(args, "--no-motion")) { Controller.Instant = true; DockLayout.Grow = false; DockLayout.GlowFromIcon = false; PadMotion.Instant = true; VolumeFade.Instant = true; }
            _dir = ResolveDir(args);
            _logPath = Path.Combine(_dir, "tvlauncher.log");
            _pidPath = Path.Combine(_dir, "tvlauncher.pid");
            _fifoPath = Path.Combine(_dir, "tvlauncher.fifo");
            _fifoReadyPath = _fifoPath + ".ready";
            _claimPath = Path.Combine(_dir, "tvlauncher.homeclaim");
            _claimVerifiedPath = _claimPath + ".verified";
            _longpressPath = Path.Combine(_dir, "tvlauncher.longpress");
            TrimLog();

            string priorLongpress = ReadTextFn(_longpressPath);
            string priorPid = ReadTextFn(_pidPath);
            if (!AcquireInstance()) return 0;
            ClearStaleLongpressClaims(priorLongpress, priorPid);
            Libc.unlink(_fifoPath);
            Libc.unlink(_fifoReadyPath);
            AppDomain.CurrentDomain.ProcessExit += (s, e) => CleanupFiles();

            try
            {
                string engine = SetupEnvironment();
                string sched = PromoteRealtimeScheduler();
                Log("start pid=" + Libc.getpid() + " uid=" + Libc.getuid() + " engine=" + engine + " sched=" + sched);

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
                _pillScreenW = screenW; _pillScreenH = screenH;
                _screenW = screenW; _screenH = screenH;
                _res = Path.Combine(AppContext.BaseDirectory, "res");

                Efl.elm_win_title_set(_win, "tvlauncher");
                Efl.elm_win_alpha_set(_win, true);
                Efl.elm_win_borderless_set(_win, true);
                Efl.elm_win_prop_focus_skip_set(_win, false);
                int level = Efl.efl_util_set_notification_window_level(_win, NotificationLevelTop);
                Efl.elm_win_layer_set(_win, WindowLayer);
                // Without this hint the compositor may ignore our geometry for a notification window.
                Efl.elm_win_aux_hint_add(_win, "wm.policy.win.user.geometry", "1");
                Efl.elm_win_aux_hint_add(_win, "wm.comp.win.effect.enable", "0");
                Efl.HideCursor(_win, false);

                _dismissRestoreFile = Path.Combine(_dir, "tvlauncher.restore");
                try { File.WriteAllText(_dismissRestoreFile, _dismissRestoreGen.ToString(System.Globalization.CultureInfo.InvariantCulture)); }
                catch (Exception ex) { Log("restore gen init: " + ex.Message); }
                string guard = Arg(args, "--kill-on-home");
                if (guard != null)
                {
                    _guardApps = HomeGuard.Parse(guard);
                    if (_guardApps != null)
                    {
                        _guardFile = Path.Combine(_dir, "tvlauncher.guard");
                        try { File.WriteAllText(_guardFile, _guardGen.ToString(System.Globalization.CultureInfo.InvariantCulture)); }
                        catch (Exception ex) { Log("guard init: " + ex.Message); }
                        Log("guard: " + guard + " is closed after each Home press (until it is asked for): " + HomeGuard.Command(_guardApps, _guardFile, 0));
                    }
                    else Log("guard: bad app id ignored");
                }
                string homeLaunch = Arg(args, "--home-launch");
                if (homeLaunch != null)
                {
                    _homeLaunch = HomeLaunch.Parse(homeLaunch);
                    Log(_homeLaunch != null ? "home key launches " + homeLaunch + "; the dock is not shown" : "home-launch: bad app id ignored");
                }
                _claimHome = Flag(args, "--claim-home") && _homeLaunch == null;
                Libc.unlink(_claimPath);   // one left by a launcher that was killed
                // Show the Empty TV backdrop at the earliest possible point during process startup, before catalog parsing,
                // icon decoding, page construction and JIT warm-up, so org.tizen.tv-viewer is covered as soon as EFL starts.
                if (_homeLaunch == null && _idleConfig.Mode != IdleMode.Off)
                {
                    InitIdleBackdrop();
                    PollIdleBackdrop();
                }

                _appsPath = Arg(args, "--apps") ?? Path.Combine(AppContext.BaseDirectory, "res", "apps.tsv");
                _inputsPath = Arg(args, "--inputs") ?? Path.Combine(AppContext.BaseDirectory, "res", "inputs.tsv");
                _allAppsWatch = Arg(args, "--all-apps");
                _allAppsPath = _allAppsWatch ?? Path.Combine(AppContext.BaseDirectory, "res", "allapps.tsv");
                _apps = LoadApps(_appsPath);
                _inputs = LoadList(_inputsPath, Catalog.BuiltInInputs);
                // One window for both pages: as wide as the wider of the two, the other is centred in it.
                // With the task manager on, the apps page also shows a "Task manager" hint under the bar: both pages
                // get the extra band so the shared window keeps one height, and the task panel ends where the bar does.
                // --cards tasks,audio: the Control center's cards, in that order (Vetro writes it from the dashboard); without it the older
                // switch: the Task manager alone unless --no-tasks. No cards: Down does nothing and there is no hint under the bar.
                _cards = ControlCenter.Parse(Arg(args, "--cards"), Flag(args, "--no-tasks"));
                bool tasks = _cards.Length > 0;
                _allApps = LoadList(_allAppsPath, Catalog.BuiltInAllApps);
                DockLayout layout = PageLayouts();
                int band = tasks ? DockLayout.HintH : 0;
                _taskLayout = new TaskLayout(screenW, screenH, 0, band, Math.Max(1, _cards.Length), 0);
                _tasksCtl = new TaskController();
                _audioCtl = new TaskController();
                _cardCtl = new TaskController[_cards.Length];
                _choiceSrcs = new ChoiceSource[_cards.Length];
                _lastChoiceStates = new ChoiceState[_cards.Length];
                for (int i = 0; i < _cards.Length; i++)
                {
                    CardKind kind = _cards[i].Kind;
                    _cardCtl[i] = kind == CardKind.Tasks ? _tasksCtl : kind == CardKind.Audio ? _audioCtl : new TaskController();
                    _choiceSrcs[i] = ChoiceSourceFor(_cards[i]);
                }
                _taskSource = new TaskSource(_apps, Log);

                Efl.evas_object_move(_win, layout.WinX, layout.WinY);
                Efl.evas_object_resize(_win, layout.WinW, layout.WinH);
                Log("window " + layout.WinW + "x" + layout.WinH + " at " + layout.WinX + "," + layout.WinY + " notification-level=" + level);

                // The remote is opened now, before the pages and the warm-up: a Home pressed meanwhile waits in the node's buffer and is answered
                // when the loop starts (DrainStartupInput). The fifo is still made after the warm-up: until it has a reader the service sends the
                // volume and 123 keys to the TV itself, and they must not wait for the start-up instead.
                SetupInput(args);

                string dumpIcons = Arg(args, "--dump-icons");
                if (dumpIcons != null && Directory.Exists(dumpIcons)) Dock.DumpIconsTo = dumpIcons;
                // Only what this run can show is built: in custom launcher mode the dock is never drawn (no pages, no cards), and of the
                // Control center only the cards --cards names. Every use of a card is behind HasCard or the list of cards.
                if (_homeLaunch == null)
                {
                    BuildPages();
                }
                _dock = _appsDock;
                // The flags the tuner reads are cleared now (one left by a launcher that was killed), which also runs their first
                // use here and not inside the first show.
                OverlayFlag.Pid = Libc.getpid().ToString(System.Globalization.CultureInfo.InvariantCulture);
                OverlayFlag.Mark(OverlayFlag.DockPath, false, Log);
                OverlayFlag.Mark(OverlayFlag.PadPath, false, Log);
                if (_appsDock != null)
                {
                    if (!Flag(args, "--no-warmup"))
                    {
                        WarmUp();
                        PrewarmPad();
                    }
                    _appsDock.Apply(_appsCtl);
                    _inputsDock.Apply(_inputsCtl);
                    _allDock.Apply(_allCtl);
                    Log("engine in use: " + (Efl.EngineName(_dock.Evas) ?? "unknown") + ", " + _apps.Length + " apps, " + _inputs.Length + " inputs, " + _allApps.Length + " on All apps, "
                        + (_appsDock.MissingIcons + _inputsDock.MissingIcons + _allDock.MissingIcons) + " icons missing" + (RowEdit.CanEdit(_apps) ? "" : "; the row cannot be edited (no row keys)"));
                }
                else Log("engine in use: " + (Efl.EngineName(Efl.evas_object_evas_get(_win)) ?? "unknown") + "; custom launcher mode: the dock's pages are not built");

                Efl.evas_object_event_callback_add(_win, Efl.EvasCallbackKeyDown, KeyCb, IntPtr.Zero);
                Efl.evas_object_event_callback_add(_win, Efl.EvasCallbackKeyUp, KeyUpCb, IntPtr.Zero);
                SetupFifo();

                string fpsArg = Arg(args, "--vblank-fps");
                int fps;
                if (fpsArg != null && int.TryParse(fpsArg, out fps) && (fps == 0 || (fps >= 30 && fps <= 120))) _vblankFps = fps;
                if (_vblankFps > 0 && File.Exists("/usr/bin/tdm-monitor")) Efl.ecore_animator_add(FpsCb, IntPtr.Zero);
                Log("animator frame time " + (Efl.ecore_animator_frametime_get() * 1000.0).ToString("0.0", System.Globalization.CultureInfo.InvariantCulture) + " ms");
                if (!Flag(args, "--hidden")) ShowDock(false);
                else if (!Flag(args, "--no-premap") && _appsDock != null && !_pendingArrivalDock)
                {
                    _appsCtl.HoldFaint(0.012f);   // about 1% opacity: invisible, but drawn, so the shaders get compiled now
                    _appsDock.Apply(_appsCtl);
                    Efl.evas_object_show(_win);
                    Efl.HideCursor(_win, false);
                    if (Flag(args, "--premap-activate")) Efl.elm_win_activate(_win);
                    _premapTimer = Efl.ecore_timer_add(0.5, PremapCb, IntPtr.Zero);
                }

                GC.Collect();
                GC.WaitForPendingFinalizers();
                System.Runtime.GCSettings.LatencyMode = System.Runtime.GCLatencyMode.SustainedLowLatency;
                if (_claimHome)
                {
                    PreloadEcoreKeyEvent();
                    if (_homeLaunch == null && _inputFds.Count > 0 && !string.IsNullOrEmpty(_claimVerifiedPath) && File.Exists(_claimVerifiedPath))
                    {
                        _rawHomeSeen = true;
                        ClaimHome();
                    }
                }
                DrainStartupInput();   // after the collection: a Home answered here goes straight to its first frame
                if (_idleWin != null) PollIdleBackdrop();
                _elmRunStartTimer = Efl.ecore_timer_add(0.0, ElmRunStartCb, IntPtr.Zero);
                PromoteRenderThreads();
                Log("elm_run");
                Efl.elm_run();
                _inElmRun = false;
                Log("elm_run returned");
                CancelIdleTimers();
                UnsubscribeFullscreenNotify();
                ReleaseBackClaimOnExit();
                DbusBus.Close();
                if (_taskWin != IntPtr.Zero) { Efl.evas_object_del(_taskWin); _taskWin = IntPtr.Zero; }
                if (_idleWin != null) _idleWin.Hide(true);
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
