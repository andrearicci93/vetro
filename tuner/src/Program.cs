using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Tuner.Core;
using Tuner.Input;
using Tuner.Native;
using Tuner.Tvs;
using Tuner.Ui;

namespace Tuner
{
    /// <summary>
    /// Vetro Tuner: a full-screen transparent window over the TV's video plane, a channel banner, a channel list, a number pad and
    /// the keys to move between channels. Tuning itself is done by tvs-daemon; this process only asks and draws.
    /// With --resident the process stays alive with its window hidden and is shown by a line written to a control pipe
    /// (see <see cref="OnControl"/>), which makes opening it almost instant.
    /// </summary>
    internal static class Program
    {
        // Linux input codes (what the remote sends through evdev).
        // Seen on the Q80A with the Smart Control (2026-11-07): Back = 1 (ESC), CH+ = 88 and CH- = 87, OK = 28, arrows 103/105/106/108,
        // Home = 63 (the dock's --home-code). The remote has no digit keys: "123" (140) opens the system's own pad (and that cannot be stopped), so our pad is on Left.
        // 158/174/402/403 stay for other remotes.
        private const int KeyBack = 158, KeyEsc = 1, KeyExit = 174, KeyChannelUp = 88, KeyChannelDown = 87, KeyChannelUp2 = 402, KeyChannelDown2 = 403;
        private const int KeyUp = 103, KeyDown = 108, KeyLeft = 105, KeyRight = 106, KeyEnter = 28;
        // The guide opens on Up (nothing else uses it) and on the Guide / EPG keys of remotes that have one (KEY_EPG 365, KEY_GUIDE 362: not seen on the Smart Control).
        private const int KeyEpg = 365, KeyGuide = 362;
        // The info panel opens on the Info key of remotes that have one (KEY_INFO 358) and on `info` from the control pipe: the dock's 123 pad sends that.
        private const int KeyInfo = 358;
        // Keys that belong to the system: the tuner steps aside (hides, or exits) and the system handles the key as usual.
        private static readonly HashSet<int> SystemKeys = new HashSet<int> { 63, 172, 139, 116 };
        private const int ScreenW = 1920, ScreenH = 1080;
        private const double DigitSeconds = 2.0, ToastSeconds = 2.2, PadSeconds = 20.0, ListSeconds = 8.0, ProgramDelaySeconds = 1.8, InfoSeconds = 10.0;
        private static double BannerSeconds = 4.0;

        private static readonly TvsClient Tvs = new TvsClient();
        private static ChannelList _list;            // null until the worker has read it
        private static Channel _shown;                // the channel the screen (and, soon, the daemon) is on
        private static int _startMajor;
        private static bool _resident, _active;
        private static string _controlPath;
        // Takeover (--takeover APPID): the resident tuner shows itself when that app (Samsung's live TV, org.tizen.tv-viewer) is on screen.
        private static string _takeoverApp, _pidFile;
        private static bool _takeoverBroken;
        private static readonly Takeover TakeoverState = new Takeover();
        private static IntPtr _takeoverTimer;
        private static int _controlFd = -1;
        private static IntPtr _controlHandler;
        private static readonly StringBuilder ControlBuf = new StringBuilder();

        // The thread that talks to tvs-daemon, and the way its results come back to the UI thread: a queue plus a pipe
        // the EFL main loop watches (the UI is single-threaded; nothing but the main thread touches EFL objects).
        private static readonly BlockingCollection<Action> Work = new BlockingCollection<Action>();
        private static readonly ConcurrentQueue<Action> UiQueue = new ConcurrentQueue<Action>();
        private static readonly int[] Wake = new int[2];
        private static IntPtr _wakeHandler;
        private static long _wantId;                  // latest tune request; the worker takes it (0 = nothing pending)
        private static readonly GuideStore Store = new GuideStore();   // the schedules read so far: the banner and the guide both read from it
        private static int _prefetchGen;              // bumped on every zap: a prefetch pass from an earlier gen stops
        private static GuideView _guideView;          // made the first time the guide opens
        private static GuideGrid _grid;
        private static string _assets;
        private static int _guideGen;                 // bumped when the rows on screen change: a reading pass from an earlier gen stops
        private static IntPtr _guideTimer, _detailTimer;
        private static readonly Dictionary<string, string> Details = new Dictionary<string, string>();   // long texts of programmes, read on demand (UI thread only)

        private static IntPtr _win;
        private static BannerView _banner;
        private static InfoView _infoView;
        private static InfoData _info;
        private static int _infoGen;                  // a reading for an info panel that was closed or replaced is dropped
        private static ListView _listView;
        private static PadView _padView;
        private static ToastView _toast;
        private static readonly NumberEntry Entry = new NumberEntry();
        private static int _sel;                      // selected row of the channel list
        private static TimeSpan _utcOffset = TimeSpan.Zero;
        private static int _programAttempt, _repeats;   // programme lookups so far for this channel; auto-repeat events of the key held down

        private static IntPtr _bannerTimer, _listTimer, _padTimer, _toastTimer, _digitTimer, _programTimer, _quitTimer, _rescanTimer, _infoTimer;
        private static StreamWriter _log;
        // Log times are milliseconds since launch (see ProcessAgeMs), so the log also shows what the runtime spent before Main.
        private static readonly System.Diagnostics.Stopwatch _clock = System.Diagnostics.Stopwatch.StartNew();
        private static long _ageAtMain;

        /// <summary>Milliseconds from the moment the launcher script stamped VTUNER_T0 (epoch ms) to now: what the runtime spent before Main. 0 when not stamped.</summary>
        private static long ProcessAgeMs()
        {
            long t0;
            if (!long.TryParse(Environment.GetEnvironmentVariable("VTUNER_T0"), out t0)) return 0;
            return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - t0;
        }
        private static readonly List<int> _fds = new List<int>();
        private static readonly List<string> _paths = new List<string>();
        private static readonly List<EvdevReader> _readers = new List<EvdevReader>();
        private static readonly List<IntPtr> _handlers = new List<IntPtr>();
        private static readonly byte[] _buf = new byte[512];
        private static readonly List<int> _presses = new List<int>(), _held = new List<int>(), _released = new List<int>();
        // Delegates are kept in fields: the GC must not collect a callback the native side still holds.
        private static readonly Efl.TaskCb OnBannerTimeout = d => { _bannerTimer = IntPtr.Zero; _banner.Hide(); return 0; };
        private static readonly Efl.TaskCb OnListTimeout = d => { _listTimer = IntPtr.Zero; CloseList(); return 0; };
        private static readonly Efl.TaskCb OnPadTimeout = d => { _padTimer = IntPtr.Zero; ClosePad(); return 0; };
        private static readonly Efl.TaskCb OnToastTimeout = d => { _toastTimer = IntPtr.Zero; _toast.Hide(); return 0; };
        private static readonly Efl.TaskCb OnDigitTimeout = d => { _digitTimer = IntPtr.Zero; CommitPad(); return 0; };
        private static readonly Efl.TaskCb OnInfoTimeout = d => { _infoTimer = IntPtr.Zero; CloseInfo(); return 0; };
        private static readonly Efl.TaskCb OnGuideTimeout = d => { _guideTimer = IntPtr.Zero; CloseGuide(); return 0; };
        private static readonly Efl.TaskCb OnDetailTimer = d => { _detailTimer = IntPtr.Zero; LoadDetail(); return 0; };
        private static readonly Efl.TaskCb OnProgramTimer = d => { _programTimer = IntPtr.Zero; RequestProgram(); return 0; };
        private static readonly Efl.TaskCb OnTakeoverPoll = d => { try { PollTakeover(); } catch (Exception ex) { Log("takeover: " + ex.Message); } return (byte)(_takeoverBroken ? 0 : 1); };
        private static readonly Efl.TaskCb OnQuit = d => { Log("auto exit"); Efl.elm_exit(); return 0; };
        private static readonly Efl.TaskCb OnRescan = d => { try { WatchNodes(); } catch (Exception ex) { Log("rescan: " + ex.Message); } return 1; };
        private static readonly Efl.FdCb OnInput = (d, h) => { try { ReadInput((int)d); } catch (Exception ex) { Log("input: " + ex.Message); } return 1; };
        private static readonly Efl.FdCb OnControlFd = (d, h) => { try { OnControl(); } catch (Exception ex) { Log("control: " + ex.Message); } return 1; };

        private static int Main(string[] args)
        {
            int autoExit = IntArg(args, "--seconds", 0);
            _startMajor = IntArg(args, "--major", 0);
            _resident = Flag(args, "--resident");
            _controlPath = StrArg(args, "--control", "/tmp/vetro-tuner.ctl");
            _logPath = StrArg(args, "--log", "/tmp/vetro-tuner.log");
            _pidFile = StrArg(args, "--pid-file", null);
            string takeover = StrArg(args, "--takeover", null);
            if (takeover != null && AppIdPattern.IsMatch(takeover)) _takeoverApp = takeover;
            _ageAtMain = ProcessAgeMs();
            if (Flag(args, "--hold")) BannerSeconds = 3600;   // for screenshots
            OpenLog();
            if (takeover != null && _takeoverApp == null) Log("takeover: bad app id ignored");
            WritePid();
            Log("start pid=" + Libc.getpid() + (_resident ? " resident" : ""));

            // The channel service starts now, on its own thread, while this thread builds the window: the two do not depend on each other.
            if (Libc.pipe(Wake) != 0) { Log("pipe failed"); return 5; }
            Libc.fcntl(Wake[0], Libc.F_SETFL, Libc.O_NONBLOCK);
            var worker = new Thread(WorkerMain) { IsBackground = true, Name = "tvs" };
            worker.Start();

            SetupEnvironment(Flag(args, "--shm"));
            Efl.elm_init(0, IntPtr.Zero);
            Log("elm_init done");
            _win = Efl.elm_win_add(IntPtr.Zero, "vetro-tuner", Flag(args, "--notif") ? Efl.ElmWinNotification : 0);   // 0 = ELM_WIN_BASIC
            if (_win == IntPtr.Zero) { Log("elm_win_add failed"); return 2; }
            Efl.elm_win_title_set(_win, "vetro-tuner");
            Efl.elm_win_alpha_set(_win, true);                         // transparent: the video plane shows through
            Efl.elm_win_borderless_set(_win, true);
            if (Flag(args, "--notif"))
            {
                // Above every app, as the dock does. The compositor otherwise keeps an unregistered window behind the foreground app.
                Efl.efl_util_set_notification_window_level(_win, 40);
                Efl.elm_win_layer_set(_win, 900);
            }
            Efl.elm_win_aux_hint_add(_win, "wm.policy.win.user.geometry", "1");
            Efl.elm_win_aux_hint_add(_win, "wm.comp.win.effect.enable", "0");
            Efl.evas_object_move(_win, 0, 0);
            Efl.evas_object_resize(_win, ScreenW, ScreenH);
            if (Flag(args, "--backdrop"))
            {
                // For screenshots only: the compositor shows the video plane as white, so give the views a dark ground to be seen on.
                IntPtr back = Efl.evas_object_rectangle_add(Efl.evas_object_evas_get(_win));
                Efl.evas_object_color_set(back, 40, 44, 52, 255);
                Efl.evas_object_resize(back, ScreenW, ScreenH);
                Efl.evas_object_show(back);
            }
            BuildViews(Path.Combine(AppContext.BaseDirectory, "res"));
            try { _utcOffset = TimeZoneInfo.Local.GetUtcOffset(DateTimeOffset.UtcNow); } catch (Exception) { }
            Log("utc offset " + _utcOffset);
            if (_resident) Log("resident: window stays hidden until 'show' arrives on " + _controlPath);
            else Activate();
            Log("window up engine=" + Efl.EngineName(Efl.evas_object_evas_get(_win)));

            // From here on results of the worker may be applied.
            _wakeHandler = Efl.ecore_main_fd_handler_add(Wake[0], Efl.EcoreFdRead, OnWake, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
            if (_resident) OpenControl();
            if (_resident && _takeoverApp != null)
            {
                _takeoverTimer = Efl.ecore_timer_add(0.5, OnTakeoverPoll, IntPtr.Zero);
                Log("takeover: shows itself when " + _takeoverApp + " is on screen");
            }

            WatchNodes();
            _rescanTimer = Efl.ecore_timer_add(3.0, OnRescan, IntPtr.Zero);
            if (autoExit > 0) _quitTimer = Efl.ecore_timer_add(autoExit, OnQuit, IntPtr.Zero);

            Efl.elm_run();
            Log("elm_run returned");
            if (_controlFd >= 0) { Libc.close(_controlFd); Libc.unlink(_controlPath); }
            RemovePid();
            Efl.elm_shutdown();
            return 0;
        }

        // ---- showing and hiding the whole tuner ----

        /// <summary>Puts the window on screen (the first time, or again after <see cref="Deactivate"/>) with the banner of the channel we are on.</summary>
        private static void Activate()
        {
            if (_active) return;
            _active = true;
            Efl.evas_object_show(_win);
            Efl.elm_win_activate(_win);
            Efl.elm_win_raise(_win);
            if (_shown != null) ShowBanner(_shown);
            Log("shown");
        }

        /// <summary>Closes everything and takes the window off the screen. A resident tuner stays alive; otherwise the process ends.</summary>
        private static void Deactivate()
        {
            CloseList(); ClosePad(); CloseGuide(); CloseInfo();
            _banner.Hide(); _toast.Hide();
            TakeoverState.Dismissed();
            if (!_resident) { Efl.elm_exit(); return; }
            _active = false;
            Efl.evas_object_hide(_win);
            Log("hidden");
        }

        // ---- the worker (everything that talks to tvs-daemon) ----

        private static void WorkerMain()
        {
            try
            {
                TvsClient.InstallResolver();
                string status;
                Channel cur = Tvs.ReadCurrent(out status);
                Log("tvs: " + status + (cur != null ? " -> " + cur.Major + " " + cur.Name : ""));
                if (cur != null) Ui(() => { _shown = cur; if (_active) ShowBanner(cur); RequestProgram(); });
                List<Channel> all = Tvs.ReadChannels(out status);
                Log("tvs: " + status);
                Ui(() =>
                {
                    _list = new ChannelList(all);
                    if (cur != null) _list.SetCurrent(cur.Id);
                    if (_startMajor > 0)
                    {
                        Channel want = _list.ByNumber(_startMajor);
                        if (want != null && (cur == null || want.Id != cur.Id)) GoTo(want);   // never re-tune the channel that is already on
                    }
                });
                foreach (Action a in Work.GetConsumingEnumerable()) a();
            }
            catch (Exception ex) { Log("tvs worker: " + ex); Ui(() => Efl.elm_exit()); }
        }

        /// <summary>Runs this on the UI thread, soon: queue it and poke the pipe the main loop watches.</summary>
        private static void Ui(Action a)
        {
            UiQueue.Enqueue(a);
            Libc.write(Wake[1], new byte[] { 1 }, (UIntPtr)1);
        }

        private static readonly Efl.FdCb OnWake = (d, h) =>
        {
            var drain = new byte[64];
            while ((long)Libc.read(Wake[0], drain, (UIntPtr)drain.Length) > 0) { }
            Action a;
            while (UiQueue.TryDequeue(out a)) { try { a(); } catch (Exception ex) { Log("ui: " + ex); } }
            return 1;
        };

        // ---- tuning ----

        /// <summary>
        /// Asks for a channel. The banner and the list position change at once (so repeated CH+ presses chain), the daemon is told
        /// on the worker thread, and a burst of requests collapses into the last one.
        /// </summary>
        private static void GoTo(Channel c)
        {
            if (c == null) return;
            if (_list != null) _list.Select(c);
            _shown = c;
            Interlocked.Increment(ref _prefetchGen);                    // a pass reading other channels gives way to the tune
            if (_active) { ShowBanner(c, false); ShowKnown(c); }        // the programme is asked for below, once the tune has gone out
            Interlocked.Exchange(ref _wantId, (long)c.Id);
            Work.Add(() =>
            {
                ulong id = (ulong)Interlocked.Exchange(ref _wantId, 0);
                if (id == 0) return;                                  // a later request already took it
                // The schedule does not depend on the tune (the daemon answers for any channel in ~40 ms): when the banner has nothing yet, it is read first.
                Channel shown = _shown;
                long t0 = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                if (shown != null && shown.Id == id && Store.Current(id, t0) == null && ReadIntoStore(id, t0))
                {
                    GuideEvent e = Store.Current(id, t0);
                    if (e != null) Ui(() => ApplyProgram(shown, true, e.Start, e.Duration, e.Title, 0));
                }
                var sw = System.Diagnostics.Stopwatch.StartNew();
                int r = -1;
                try { r = Tvs.Tune(id); } catch (Exception ex) { Log("tune: " + ex.Message); }
                Log("tune " + id + " r=" + r + " ms=" + sw.ElapsedMilliseconds);
            });
            _programAttempt = 0;
            StartPrefetch();                                            // after the tune in the queue: the channels around, so the next zap already has them
        }

        /// <summary>
        /// Reads the programme on air for the channel on screen (worker) and puts it on the banner (UI). The daemon has it only once the
        /// channel's tables have arrived (after a zap, 2-6 s on a new multiplex), so a lookup that finds nothing, or no title yet, is
        /// repeated a few times; if there is still nothing the banner says so.
        /// </summary>
        private static void RequestProgram()
        {
            Channel c = _shown;
            if (c == null) return;
            int attempt = _programAttempt;
            Work.Add(() => ProgramLookup(c, attempt));
        }

        /// <summary>Worker: what is on air on this channel, from its schedule; when the schedule has nothing for now, from the present-programme call.</summary>
        private static void ProgramLookup(Channel c, int attempt)
        {
            long start = 0, duration = 0, now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            bool ok = false;
            string title = "";
            if (ReadIntoStore(c.Id, now))
            {
                GuideEvent e = Store.Current(c.Id, now);
                if (e != null) { ok = true; start = e.Start; duration = e.Duration; title = e.Title; }
            }
            if (!ok)
            {
                try { ok = Tvs.ReadPresent(c.Id, out start, out duration); } catch (Exception ex) { Log("present: " + ex.Message); start = duration = 0; }
                if (ok) try { title = GuideText.Title(Tvs.ReadPresentTexts(c.Id)); } catch (Exception ex) { Log("present text: " + ex.Message); }
            }
            Ui(() => ApplyProgram(c, ok, start, duration, title, attempt));
        }

        /// <summary>Worker: reads a channel's schedule for the whole horizon into the store. False when the call failed (nothing stored).</summary>
        private static bool ReadIntoStore(ulong id, long now)
        {
            try
            {
                List<GuideEvent> events;
                if (!Tvs.ReadSchedule(id, now, GuideGrid.HorizonSeconds, false, out events)) return false;
                Store.Put(id, events, now, now + GuideGrid.HorizonSeconds);
                return true;
            }
            catch (Exception ex) { Log("schedule: " + ex.Message); return false; }
        }

        private const int ProgramAttempts = 6;

        private static void ApplyProgram(Channel c, bool ok, long start, long duration, string title, int attempt)
        {
            if (_shown == null || _shown.Id != c.Id) return;           // the owner zapped on meanwhile
            long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            double? f = ok ? ProgramClock.Fraction(start, duration, now) : null;
            bool complete = f != null && title.Length > 0;
            Log("programme try " + attempt + ": " + (f != null ? ProgramClock.Range(start, duration, _utcOffset) + " \"" + title + "\" " + (int)(f.Value * 100) + "%" : "none"));
            if (!complete && attempt + 1 < ProgramAttempts)
            {
                _programAttempt = attempt + 1;
                Restart(ref _programTimer, 1.2, OnProgramTimer);
                if (_active && _banner.Visible) Restart(ref _bannerTimer, BannerSeconds, OnBannerTimeout);   // stay up while the programme is still being looked for
                if (f == null) return;                                  // nothing to show yet; with times but no title we show what we have
            }
            if (!_active || !_banner.Visible) return;
            if (f == null) { _banner.SetNoProgram(); return; }
            _banner.SetProgram(title, ProgramClock.Range(start, duration, _utcOffset), ProgramClock.Remaining(start, duration, now), f.Value);
            Restart(ref _bannerTimer, BannerSeconds, OnBannerTimeout);  // the owner gets the full time to read it, from when it appeared
        }

        /// <summary>Puts the programme on the banner at once when it is already known (read earlier, or prefetched). False when it is not.</summary>
        private static bool ShowKnown(Channel c)
        {
            long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            GuideEvent a = Store.Current(c.Id, now);
            if (a == null || !_banner.Visible) return false;
            double? f = ProgramClock.Fraction(a.Start, a.Duration, now);
            if (f == null) return false;
            _banner.SetProgram(a.Title, ProgramClock.Range(a.Start, a.Duration, _utcOffset), ProgramClock.Remaining(a.Start, a.Duration, now), f.Value);
            return true;
        }

        // ---- prefetch: what is on the channels around ----

        private const int PrefetchChannels = 24;

        /// <summary>
        /// After a zap, the schedules of the channels next to this one are read in the background, so the next CH+/- (or the guide) already has
        /// them. The daemon answers for any channel in 30-50 ms. Runs on the worker in short slices and gives way as soon as the owner zaps.
        /// </summary>
        private static void StartPrefetch()
        {
            if (_list == null || _shown == null) return;
            var ids = new List<ulong>();
            foreach (int i in GuideStore.Nearest(_list.Count, _list.CurrentIndex)) { ids.Add(_list[i].Id); if (ids.Count >= PrefetchChannels) break; }
            int gen = Volatile.Read(ref _prefetchGen);
            Work.Add(() => PrefetchSlice(gen, ids, 0));
        }

        private static void PrefetchSlice(int gen, List<ulong> ids, int pos)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            while (pos < ids.Count && sw.ElapsedMilliseconds < 100)
            {
                if (gen != Volatile.Read(ref _prefetchGen)) return;
                ulong id = ids[pos++];
                long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                if (Store.NeedsRead(id, now, now + GuideGrid.HorizonSeconds)) ReadIntoStore(id, now);
            }
            if (pos < ids.Count) Work.Add(() => PrefetchSlice(gen, ids, pos));
        }

        // ---- the guide ----

        private const double GuideSeconds = 60.0, DetailDelay = 0.25;

        private static bool GuideOpen { get { return _guideView != null && _guideView.Visible; } }

        private static void OpenGuide()
        {
            if (_list == null || _list.Count == 0) { ShowToast("Channels not loaded yet"); return; }
            if (_guideView == null)
            {
                _guideView = new GuideView(new Surface(Efl.evas_object_evas_get(_win), _assets, ScreenW, ScreenH));
                _grid = new GuideGrid(_list, Store);
            }
            CloseList(); ClosePad(); _banner.Hide();
            _grid.Open(Math.Max(0, _list.CurrentIndex), DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            GuideChanged(true);
        }

        private static void CloseGuide()
        {
            if (_guideView == null) return;
            if (_guideTimer != IntPtr.Zero) { Efl.ecore_timer_del(_guideTimer); _guideTimer = IntPtr.Zero; }
            if (_detailTimer != IntPtr.Zero) { Efl.ecore_timer_del(_detailTimer); _detailTimer = IntPtr.Zero; }
            Interlocked.Increment(ref _guideGen);                       // a reading pass in progress stops
            _guideView.Hide();
        }

        /// <summary>After any move: redraw, read what is newly on screen, and (a moment later) the long text of the focused programme.</summary>
        private static void GuideChanged(bool rowsMayHaveChanged)
        {
            DrawGuide();
            if (rowsMayHaveChanged) LoadGuideRows();
            Restart(ref _detailTimer, DetailDelay, OnDetailTimer);
            Restart(ref _guideTimer, GuideSeconds, OnGuideTimeout);
        }

        private static string DetailKey(Channel c, GuideEvent e) { return c.Id + ":" + e.EventId + ":" + e.Start; }

        private static void DrawGuide()
        {
            GuideEvent fe = _grid.FocusEvent;
            string desc = "";
            if (fe != null) Details.TryGetValue(DetailKey(_grid.FocusChannel, fe), out desc);
            _guideView.Draw(GuideScene.Build(_grid, DateTimeOffset.UtcNow.ToUnixTimeSeconds(), _utcOffset, desc ?? ""));
        }

        /// <summary>Starts a worker pass over the channels on screen and the pages around: each one not read yet (or stale) is read and the guide redrawn.</summary>
        private static void LoadGuideRows()
        {
            int gen = Interlocked.Increment(ref _guideGen);
            var ids = new List<ulong>();
            foreach (int i in _grid.RowsToRead()) ids.Add(_list[i].Id);
            Work.Add(() => GuideSlice(gen, ids, 0));
        }

        private static void GuideSlice(int gen, List<ulong> ids, int pos)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            while (pos < ids.Count && sw.ElapsedMilliseconds < 100)
            {
                if (gen != Volatile.Read(ref _guideGen)) return;
                ulong id = ids[pos++];
                long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                if (!Store.NeedsRead(id, now, now + GuideGrid.HorizonSeconds)) continue;
                if (ReadIntoStore(id, now)) Ui(() => { if (gen == Volatile.Read(ref _guideGen) && GuideOpen) DrawGuide(); });
            }
            if (pos < ids.Count) Work.Add(() => GuideSlice(gen, ids, pos));
        }

        /// <summary>The long text is not kept in the store (the schedules are parsed without it, to save memory): read the focused programme's window again with the texts on. Same call as the bulk read, only a shorter window.</summary>
        private static void LoadDetail()
        {
            if (!GuideOpen) return;
            GuideEvent e = _grid.FocusEvent; Channel c = _grid.FocusChannel;
            if (e == null || c == null) return;
            string key = DetailKey(c, e);
            if (Details.ContainsKey(key)) return;
            Work.Add(() =>
            {
                string text = "";
                try
                {
                    List<GuideEvent> ev;
                    if (Tvs.ReadSchedule(c.Id, e.Start, 6 * 3600, true, out ev))
                        foreach (GuideEvent x in ev) if (x.EventId == e.EventId && x.Start == e.Start) { text = x.Description; break; }
                }
                catch (Exception ex) { Log("detail: " + ex.Message); }
                Ui(() =>
                {
                    if (Details.Count > 200) Details.Clear();
                    Details[key] = text;
                    if (GuideOpen) DrawGuide();
                });
            });
        }

        private static int _streakCode, _streak, _repeatLog;

        // ---- a key held down ----
        // This remote sends ONE press when an arrow is held and nothing more (no auto-repeat events; owner test 2026-11-07, "key 103" once per hold), then a release.
        // So the repeat is made here: 0.4 s after an Up/Down press with no release yet, a timer steps every 0.1 s (faster the longer it lasts) until the release.
        // It only starts on a device that has been seen sending releases, and never runs for more than 12 s, so a lost release cannot leave it running.
        private const double HoldFirst = 0.40, HoldEvery = 0.12, HoldMaxSeconds = 12.0;
        private static int _holdCode;
        private static long _holdStarted;
        private static IntPtr _holdTimer;
        private static bool _releasesSeen;
        private static readonly Efl.TaskCb OnHoldFirst = d => { _holdTimer = IntPtr.Zero; StartHoldRepeat(); return 0; };
        private static readonly Efl.TaskCb OnHoldTick = d =>
        {
            if (_holdCode == 0 || Environment.TickCount64 - _holdStarted > HoldMaxSeconds * 1000 || !_active) { _holdTimer = IntPtr.Zero; _holdCode = 0; return 0; }
            HoldStep();
            return 1;
        };

        private static void BeginHold(int code)
        {
            StopHold();
            if (!_active || (code != KeyUp && code != KeyDown && !(GuideOpen && (code == KeyLeft || code == KeyRight)))) return;
            if (!GuideOpen && !_listView.Visible) return;
            _holdCode = code; _holdStarted = Environment.TickCount64;
            if (_releasesSeen) _holdTimer = Efl.ecore_timer_add(HoldFirst, OnHoldFirst, IntPtr.Zero);
        }

        private static void StartHoldRepeat()
        {
            if (_holdCode == 0) return;
            _holdTimer = Efl.ecore_timer_add(HoldEvery, OnHoldTick, IntPtr.Zero);
            HoldStep();
        }

        private static void HoldStep()
        {
            if (GuideOpen) GuideMove(_holdCode);
            else if (_listView.Visible) OnRepeat(_holdCode);
            else StopHold();
        }

        private static void StopHold()
        {
            if (_holdTimer != IntPtr.Zero) { Efl.ecore_timer_del(_holdTimer); _holdTimer = IntPtr.Zero; }
            _holdCode = 0;
        }

        private static void EndHold(int code)
        {
            if (!_releasesSeen) { _releasesSeen = true; Log("release seen " + code); }
            if (code == _holdCode) StopHold();
        }
        private static long _streakAt;

        /// <summary>
        /// How many steps a held arrow takes. This remote does not send auto-repeat events while a key is held: it sends a new press about every
        /// 180 ms, so "held" means the same key again within 450 ms. The longer the streak the bigger the step (1, then 2, then 3: owner found 3 then 7 too fast).
        /// </summary>
        private static int GuideStep(int code)
        {
            long now = Environment.TickCount64;
            if (code == _streakCode && now - _streakAt < 450) _streak++; else _streak = 0;
            _streakCode = code; _streakAt = now;
            return _streak < 5 ? 1 : _streak < 14 ? 2 : 3;
        }

        private static void GuideMove(int code)
        {
            int step = GuideStep(code);
            if (code == KeyUp) _grid.MoveRow(-step);
            else if (code == KeyDown) _grid.MoveRow(+step);
            else for (int i = 0; i < step; i++) _grid.MoveTime(code == KeyLeft ? -1 : +1);
            GuideChanged(code == KeyUp || code == KeyDown);
        }

        private static void OnGuideKey(int code, bool back)
        {
            if (back || code == KeyEpg || code == KeyGuide) { CloseGuide(); return; }
            if (code == KeyUp || code == KeyDown || code == KeyLeft || code == KeyRight) { GuideMove(code); return; }
            if (code == KeyChannelUp || code == KeyChannelUp2) { _grid.MovePage(+1); GuideChanged(true); return; }
            if (code == KeyChannelDown || code == KeyChannelDown2) { _grid.MovePage(-1); GuideChanged(true); return; }
            if (code == KeyEnter)
            {
                Channel c = _grid.FocusChannel;
                CloseGuide();
                if (c != null && (_shown == null || _shown.Id != c.Id)) GoTo(c); else if (c != null) ShowBanner(c);
            }
        }

        // ---- the info panel (Info key) ----

        private static bool InfoOpen { get { return _infoView != null && _infoView.Visible; } }

        /// <summary>Opens the panel with what is known now (channel, programme from the store, clock), then reads the rest on the worker: description, audio track, tuner.</summary>
        private static void OpenInfo()
        {
            Channel c = _shown;
            if (c == null) { ShowToast("Channel not known yet"); return; }
            CloseList(); ClosePad(); CloseGuide(); _banner.Hide(); _toast.Hide();
            long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            _info = new InfoData { Number = c.Major.ToString(), Name = c.Name, Clock = ProgramClock.Clock(now, _utcOffset), Date = InfoText.Date(now, _utcOffset) };
            ApplyInfoProgram(c, Store.Current(c.Id, now), now);
            _infoView.Draw(_info);
            Restart(ref _infoTimer, InfoSeconds, OnInfoTimeout);
            int gen = Interlocked.Increment(ref _infoGen);
            Work.Add(() => InfoLookup(c, gen));
        }

        private static void CloseInfo()
        {
            if (_infoView == null) return;
            if (_infoTimer != IntPtr.Zero) { Efl.ecore_timer_del(_infoTimer); _infoTimer = IntPtr.Zero; }
            Interlocked.Increment(ref _infoGen);
            _infoView.Hide();
        }

        private static void ApplyInfoProgram(Channel c, GuideEvent e, long now)
        {
            double? f = e == null ? null : ProgramClock.Fraction(e.Start, e.Duration, now);
            if (e == null || f == null) { _info.NoProgram = true; _info.Fraction = null; _info.Title = ""; _info.Range = ""; _info.Left = ""; return; }
            _info.NoProgram = false; _info.Title = e.Title; _info.Fraction = f;
            _info.Range = ProgramClock.Range(e.Start, e.Duration, _utcOffset);
            _info.Left = ProgramClock.Remaining(e.Start, e.Duration, now);
        }

        /// <summary>Worker: the programme (when it was not in the store), its text, the audio track and the tuner, each read on its own so one failing leaves the others.</summary>
        private static void InfoLookup(Channel c, int gen)
        {
            long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            GuideEvent e = Store.Current(c.Id, now);
            if (e == null && ReadIntoStore(c.Id, now)) e = Store.Current(c.Id, now);
            string desc = "", audio = "", source = "";
            try { desc = GuideText.Description(Tvs.ReadPresentTexts(c.Id)); } catch (Exception ex) { Log("info text: " + ex.Message); }
            try { int idx; string code = Tvs.ReadAudio(out idx); audio = InfoText.Audio(code, idx); } catch (Exception ex) { Log("info audio: " + ex.Message); }
            try { source = Tvs.ReadSource(); } catch (Exception ex) { Log("info source: " + ex.Message); }
            Log("info: " + (e != null ? "\"" + e.Title + "\"" : "no programme") + ", text " + desc.Length + " chars, audio " + audio + ", source " + source);
            Ui(() =>
            {
                if (gen != Volatile.Read(ref _infoGen) || !InfoOpen || _shown == null || _shown.Id != c.Id) return;
                ApplyInfoProgram(c, e, now);
                _info.Description = desc; _info.Audio = audio; _info.Source = source;
                _infoView.Draw(_info);
            });
        }

        // ---- keys ----

        private static void OnKey(int code)
        {
            Log("key " + code);
            if (!_active) return;                                       // resident and hidden: keys are not ours
            if (SystemKeys.Contains(code)) { Deactivate(); return; }    // Home, Menu, Power...: step aside, the system does the rest
            bool back = code == KeyBack || code == KeyEsc || code == KeyExit;
            _repeats = 0;
            if (InfoOpen)
            {
                CloseInfo();                                            // any key closes the panel; Back and Info are all it does,
                if (back || code == KeyInfo) return;                    // the others (CH+/-, arrows...) then do their usual job
            }
            if (GuideOpen) { OnGuideKey(code, back); return; }
            if (_listView.Visible)
            {
                if (back) { CloseList(); return; }
                if (code == KeyUp) { MoveSelection(-1); return; }
                if (code == KeyDown) { MoveSelection(+1); return; }
                if (code == KeyLeft) { MoveSelection(-ListView.Rows); return; }     // a page at a time
                if (code == KeyRight) { MoveSelection(+ListView.Rows); return; }
                if (code == KeyEnter) { Channel c = _list[_sel]; CloseList(); GoTo(c); return; }
                return;
            }
            if (_padView.Visible)
            {
                if (back) { ClosePad(); return; }
                if (code == KeyUp) { Entry.Move(-1, 0); DrawPad(); ArmDigitCommit(); return; }
                if (code == KeyDown) { Entry.Move(+1, 0); DrawPad(); ArmDigitCommit(); return; }
                if (code == KeyLeft) { Entry.Move(0, -1); DrawPad(); ArmDigitCommit(); return; }
                if (code == KeyRight) { Entry.Move(0, +1); DrawPad(); ArmDigitCommit(); return; }
                if (code == KeyEnter)
                {
                    CancelDigitCommit();
                    if (Entry.Typed) { CommitPad(); return; }   // number typed on real digit keys: OK means go
                    if (Entry.Press() == PadAction.Go) CommitPad(); else { DrawPad(); ArmDigitCommit(); }
                    return;
                }
                int d = Digit(code);
                if (d >= 0) { Entry.TypeDigit(d); DrawPad(); ArmDigitCommit(); }
                return;
            }
            if (back) { Deactivate(); return; }
            if (code == KeyInfo) { OpenInfo(); return; }
            if (code == KeyUp || code == KeyEpg || code == KeyGuide) { OpenGuide(); return; }
            if (code == KeyChannelUp || code == KeyChannelUp2) { if (_list != null) GoTo(_list.Step(+1)); return; }
            if (code == KeyChannelDown || code == KeyChannelDown2) { if (_list != null) GoTo(_list.Step(-1)); return; }
            if (code == KeyLeft) { OpenPad(-1); return; }   // not "123" (140): Samsung opens its own pad on that key whatever we do
            if (code == KeyRight) { CycleAudio(); return; }
            if (code == KeyEnter) { OpenList(); return; }
            int digit = Digit(code);
            if (digit >= 0) OpenPad(digit);
        }

        /// <summary>KEY_1..KEY_9 are 2..10, KEY_0 is 11.</summary>
        private static int Digit(int code) { return code >= 2 && code <= 10 ? code - 1 : code == 11 ? 0 : -1; }

        // ---- channel list (OK) ----

        private static void OpenList()
        {
            if (_list == null || _list.Count == 0) return;
            _sel = Math.Max(0, _list.CurrentIndex);
            _banner.Hide();
            DrawList();
        }

        private static void CloseList()
        {
            if (_listTimer != IntPtr.Zero) { Efl.ecore_timer_del(_listTimer); _listTimer = IntPtr.Zero; }
            _listView.Hide();
        }

        private static void MoveSelection(int delta)
        {
            if (Math.Abs(delta) > 1) _sel = Math.Max(0, Math.Min(_list.Count - 1, _sel + delta));              // a page stops at the ends
            else _sel = ((_sel + delta) % _list.Count + _list.Count) % _list.Count;                            // a single step wraps round
            DrawList();
        }

        /// <summary>
        /// A key held down (the remote's auto-repeat): in the list it runs on, and the longer it is held the more rows each step moves
        /// (1, then 3, then 8), so a long list is crossed in a moment. Nothing else repeats.
        /// </summary>
        private static void OnRepeat(int code)
        {
            if (_active && GuideOpen) { _repeatLog++; if (_repeatLog <= 3 || _repeatLog % 10 == 0) Log("repeat " + code + " #" + _repeatLog); }
            if (_active && GuideOpen && (code == KeyUp || code == KeyDown || code == KeyLeft || code == KeyRight)) { GuideMove(code); return; }   // if the remote does send repeat events
            if (!_active || !_listView.Visible || _list == null) return;
            if (code != KeyUp && code != KeyDown) return;
            _repeats++;
            if (_repeats == 1) Log("key held " + code);   // tells whether this remote auto-repeats
            int step = _repeats < 8 ? 1 : _repeats < 24 ? 3 : 8;
            int next = _sel + (code == KeyUp ? -step : step);
            _sel = Math.Max(0, Math.Min(_list.Count - 1, next));                                               // held down it stops at the ends
            DrawList();
        }

        private static void DrawList()
        {
            _listView.Draw(_list, _sel);
            Restart(ref _listTimer, ListSeconds, OnListTimeout);
        }

        // ---- number pad (Left or "123"; a real digit key opens it too) ----

        private static void OpenPad(int firstDigit)
        {
            if (_list == null) return;
            Entry.Reset();
            if (firstDigit >= 0) { Entry.TypeDigit(firstDigit); ArmDigitCommit(); }
            _banner.Hide();
            DrawPad();
        }

        private static void DrawPad()
        {
            Channel c = Entry.Text.Length > 0 && _list != null ? _list.ByNumber(Entry.Value) : null;
            _padView.Draw(Entry, c != null ? c.Name : (Entry.Text.Length > 0 ? "No such channel" : ""));
            Restart(ref _padTimer, PadSeconds, OnPadTimeout);
        }

        private static void ClosePad()
        {
            CancelDigitCommit();
            if (_padTimer != IntPtr.Zero) { Efl.ecore_timer_del(_padTimer); _padTimer = IntPtr.Zero; }
            _padView.Hide();
        }

        /// <summary>
        /// Once a number has been typed, two seconds without a key take it and go to that channel: no need to walk to Go.
        /// Every key press starts the two seconds again; with nothing typed there is nothing to wait for.
        /// </summary>
        private static void ArmDigitCommit()
        {
            if (Entry.Text.Length == 0) { CancelDigitCommit(); return; }
            Restart(ref _digitTimer, DigitSeconds, OnDigitTimeout);
        }

        private static void CancelDigitCommit()
        {
            if (_digitTimer != IntPtr.Zero) { Efl.ecore_timer_del(_digitTimer); _digitTimer = IntPtr.Zero; }
        }

        private static void CommitPad()
        {
            int n = Entry.Value;
            ClosePad();
            Channel c = n > 0 && _list != null ? _list.ByNumber(n) : null;
            if (c != null) GoTo(c);
            else { Log("no channel " + n); ShowToast(n > 0 ? "No channel " + n : "Type a channel number"); }
        }

        // ---- audio (Right) ----

        private static void CycleAudio()
        {
            Work.Add(() =>
            {
                int index = -1; string lang = "";
                try { lang = Tvs.NextAudio(out index); } catch (Exception ex) { Log("audio: " + ex.Message); }
                Log("audio " + lang + " index " + index);
                Ui(() => ShowToast(index < 0 ? "Audio not available" : "Audio: " + Languages.Name(lang) + (index > 0 ? " (" + (index + 1) + ")" : "")));
            });
        }

        private static void ShowToast(string text)
        {
            _toast.Show(text);
            Restart(ref _toastTimer, ToastSeconds, OnToastTimeout);
        }

        // ---- banner ----

        private static void ShowBanner(Channel c, bool readProgram = true)
        {
            if (c == null || _listView.Visible || _padView.Visible || GuideOpen || InfoOpen) return;
            _banner.ShowChannel(c.Major.ToString(), c.Name);
            Restart(ref _bannerTimer, BannerSeconds, OnBannerTimeout);
            if (readProgram) ShowKnown(c);
            if (readProgram) { _programAttempt = 0; RequestProgram(); }   // already on this channel: the programme is there to read
        }

        private static void BuildViews(string assets)
        {
            _assets = assets;
            IntPtr evas = Efl.evas_object_evas_get(_win);
            Surface s1 = new Surface(evas, assets, ScreenW, ScreenH), s2 = new Surface(evas, assets, ScreenW, ScreenH),
                    s3 = new Surface(evas, assets, ScreenW, ScreenH), s4 = new Surface(evas, assets, ScreenW, ScreenH);
            string bad = s1.AssetProblems();
            if (bad.Length > 0) Log("pictures not loaded from " + assets + ":" + bad);
            _banner = new BannerView(s1);
            _listView = new ListView(s2);
            _padView = new PadView(s3);
            _toast = new ToastView(s4);
            _infoView = new InfoView(new Surface(evas, assets, ScreenW, ScreenH));
        }

        // ---- control pipe (resident mode) ----

        /// <summary>
        /// The pipe is how a launcher (the dock, Vetro) talks to a resident tuner: one command per line.
        /// show | hide | toggle | quit | tune N (channel number) | audio | key CODE (acts as that remote key, for testing).
        /// </summary>
        private static void OpenControl()
        {
            Libc.unlink(_controlPath);
            if (Libc.mkfifo(_controlPath, 438) != 0) { Log("mkfifo failed: " + Marshal.GetLastWin32Error()); return; }
            Libc.chmod(_controlPath, 438);                                   // 0666: the launcher may not be root
            _controlFd = Libc.open(_controlPath, Libc.O_RDWR | Libc.O_NONBLOCK);   // read-write so the pipe never reports end-of-file
            if (_controlFd < 0) { Log("open control failed"); return; }
            _controlHandler = Efl.ecore_main_fd_handler_add(_controlFd, Efl.EcoreFdRead, OnControlFd, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
        }

        private static void OnControl()
        {
            var buf = new byte[256];
            long got;
            while ((got = (long)Libc.read(_controlFd, buf, (UIntPtr)buf.Length)) > 0)
            {
                ControlBuf.Append(Encoding.ASCII.GetString(buf, 0, (int)got));
                if (ControlBuf.Length > 4096) ControlBuf.Clear();
            }
            string all = ControlBuf.ToString();
            int nl;
            while ((nl = all.IndexOf('\n')) >= 0)
            {
                string line = all.Substring(0, nl).Trim();
                all = all.Substring(nl + 1);
                if (line.Length > 0) Command(line);
            }
            ControlBuf.Clear(); ControlBuf.Append(all);
        }

        private static void Command(string line)
        {
            Log("command " + line);
            string[] p = line.Split(' ');
            switch (p[0])
            {
                case "show": Activate(); break;
                case "hide": if (_active) Deactivate(); break;
                case "toggle": if (_active) Deactivate(); else Activate(); break;
                case "quit": Efl.elm_exit(); break;
                case "audio": if (_active) CycleAudio(); break;
                case "info": Activate(); if (InfoOpen) CloseInfo(); else OpenInfo(); break;
                case "guide": Activate(); if (GuideOpen) CloseGuide(); else OpenGuide(); break;
                case "repeat": int rk; if (p.Length > 1 && int.TryParse(p[1], out rk)) OnRepeat(rk); break;
                case "key": int k; if (p.Length > 1 && int.TryParse(p[1], out k)) OnKey(k); break;   // as if the remote had sent it (testing)
                case "tune":
                    int n;
                    Channel c = p.Length > 1 && int.TryParse(p[1], out n) && _list != null ? _list.ByNumber(n) : null;
                    Activate();
                    if (c != null) GoTo(c);
                    break;
            }
        }

        // ---- input devices ----

        private static void ReadInput(int index)
        {
            int fd = _fds[index];
            if (fd < 0) return;
            IntPtr n = Libc.read(fd, _buf, (UIntPtr)_buf.Length);
            long got = (long)n;
            if (got < 0)
            {
                if (Marshal.GetLastWin32Error() != Libc.EAGAIN) DropNode(index);
                return;
            }
            if (got == 0) return;
            _presses.Clear(); _held.Clear(); _released.Clear();
            _readers[index].Feed(_buf, (int)got, _presses, _held, _released);
            foreach (int code in _presses.ToArray()) { OnKey(code); BeginHold(code); }
            foreach (int code in _held.ToArray()) OnRepeat(code);
            foreach (int code in _released.ToArray()) EndHold(code);
        }

        private static void WatchNodes()
        {
            foreach (string node in InputDevices.RemoteNodes(File.ReadAllText("/proc/bus/input/devices")))
            {
                if (_paths.Contains(node)) continue;
                int fd = Libc.open(node, Libc.O_RDONLY | Libc.O_NONBLOCK);
                if (fd < 0) continue;
                int index = _fds.IndexOf(-1);
                bool reuse = index >= 0;
                if (!reuse) index = _fds.Count;
                IntPtr h = Efl.ecore_main_fd_handler_add(fd, Efl.EcoreFdRead, OnInput, (IntPtr)index, IntPtr.Zero, IntPtr.Zero);
                if (h == IntPtr.Zero) { Libc.close(fd); continue; }
                if (reuse) { _fds[index] = fd; _paths[index] = node; _readers[index] = new EvdevReader(); _handlers[index] = h; }
                else { _fds.Add(fd); _paths.Add(node); _readers.Add(new EvdevReader()); _handlers.Add(h); }
                Log("watching " + node);
            }
        }

        private static void DropNode(int i)
        {
            if (_fds[i] < 0) return;
            Log("lost " + _paths[i]);
            if (_handlers[i] != IntPtr.Zero) Efl.ecore_main_fd_handler_del(_handlers[i]);
            Libc.close(_fds[i]);
            _fds[i] = -1; _paths[i] = null; _handlers[i] = IntPtr.Zero;
        }

        // ---- plumbing ----

        /// <summary>(Re)starts a one-shot timer held in <paramref name="timer"/>.</summary>
        private static void Restart(ref IntPtr timer, double seconds, Efl.TaskCb cb)
        {
            if (timer != IntPtr.Zero) Efl.ecore_timer_del(timer);
            timer = Efl.ecore_timer_add(seconds, cb, IntPtr.Zero);
        }

        /// <summary>Same environment as the dock: libc setenv (managed SetEnvironmentVariable never reaches native getenv).</summary>
        private static void SetupEnvironment(bool software)
        {
            bool egl = !software && Directory.Exists("/dev/dri");
            Libc.setenv("ELM_ENGINE", "gl", 1);
            Libc.setenv("ECORE_EVAS_ENGINE", egl ? "wayland_egl" : "wayland_shm", 1);
            string display = Environment.GetEnvironmentVariable("WAYLAND_DISPLAY") ?? "wayland-0";
            string runtime = "/run";
            foreach (string c in new[] { Environment.GetEnvironmentVariable("XDG_RUNTIME_DIR"), "/run/user/" + Libc.getuid(), "/run", "/run/user/5001" })
                if (!string.IsNullOrEmpty(c) && File.Exists(Path.Combine(c, display))) { runtime = c; break; }
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
        }

        private static bool Flag(string[] args, string name) { return Array.IndexOf(args, name) >= 0; }

        private static string StrArg(string[] args, string name, string fallback)
        {
            for (int i = 0; i + 1 < args.Length; i++) if (args[i] == name) return args[i + 1];
            return fallback;
        }

        private static int IntArg(string[] args, string name, int fallback)
        {
            for (int i = 0; i + 1 < args.Length; i++) if (args[i] == name) { int v; if (int.TryParse(args[i + 1], out v)) return v; }
            return fallback;
        }

        // ---- takeover: show over Samsung's live TV app ----

        private static readonly System.Text.RegularExpressions.Regex AppIdPattern = new System.Text.RegularExpressions.Regex("^[A-Za-z0-9_.-]{1,120}$");

        /// <summary>Asks the application manager about the TV app and shows the tuner when <see cref="Takeover"/> says so.</summary>
        private static void PollTakeover()
        {
            int status;
            try { status = Efl.aul_app_get_status(_takeoverApp); }
            catch (Exception ex) when (ex is DllNotFoundException || ex is EntryPointNotFoundException)
            {
                _takeoverBroken = true;      // the timer stops itself: this TV has no such call
                Log("takeover: the application manager cannot be asked (" + ex.GetType().Name + "), switched off");
                return;
            }
            if (!TakeoverState.Observe(status, _active)) return;
            Log("takeover: " + _takeoverApp + " status " + status + ", showing the tuner");
            Activate();
        }

        // ---- own pid (the service finds a running tuner by it) ----

        private static void WritePid()
        {
            if (_pidFile == null) return;
            try { File.WriteAllText(_pidFile, Libc.getpid().ToString()); }
            catch (Exception ex) { Log("pid file: " + ex.Message); }
        }

        private static void RemovePid()
        {
            if (_pidFile == null) return;
            try { File.Delete(_pidFile); } catch (Exception) { }
        }

        private static string _logPath = "/tmp/vetro-tuner.log";

        private static void OpenLog()
        {
            try { _log = new StreamWriter(new FileStream(_logPath, FileMode.Create, FileAccess.Write, FileShare.ReadWrite)) { AutoFlush = true }; }
            catch (Exception) { _log = null; }
        }

        private static void Log(string line)
        {
            lock (Work) { if (_log != null) _log.WriteLine("+" + (_ageAtMain + _clock.ElapsedMilliseconds) + "ms " + line); }
        }
    }
}
