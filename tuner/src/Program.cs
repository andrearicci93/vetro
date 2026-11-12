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
        // Home = 63 (the dock's --home-code). The remote has no digit keys: "123" (140) opens the system's own pad (and that cannot be stopped), so our pad is on Right.
        // 158/174/402/403 stay for other remotes.
        private const int KeyBack = 158, KeyEsc = 1, KeyExit = 174, KeyChannelUp = 88, KeyChannelDown = 87, KeyChannelUp2 = 402, KeyChannelDown2 = 403;
        private const int KeyUp = 103, KeyDown = 108, KeyLeft = 105, KeyRight = 106, KeyEnter = 28, KeyPower = 116;
        // The guide opens on Up (nothing else uses it) and on the Guide / EPG keys of remotes that have one (KEY_EPG 365, KEY_GUIDE 362: not seen on the Smart Control).
        private const int KeyEpg = 365, KeyGuide = 362;
        // The info panel opens on the Info key of remotes that have one (KEY_INFO 358) and on `info` from the control pipe: the dock's 123 pad sends that.
        private const int KeyInfo = 358;
        // Keys that belong to the system: the tuner steps aside (hides, or exits) and the system handles the key as usual.
        private static readonly HashSet<int> SystemKeys = new HashSet<int> { 63, 172, 139, 116 };
        // The remote's 123 key. Vetro's own osd 123 holds it back in the remote bridge, so when the tuner reads it the TV is opening Samsung's
        // own 123 pad (Vetro's is off, or the key came on a part of the remote the bridge does not hold): the tuner's panels make room for it.
        private const int Key123 = 140;
        private const int ScreenW = 1920, ScreenH = 1080;
        private const double DigitSeconds = 2.0, ToastSeconds = 2.2, PadSeconds = 20.0, ListSeconds = 8.0, ProgramDelaySeconds = 1.8, InfoSeconds = 10.0;
        private static double BannerSeconds = 4.0;

        private static readonly TvsClient Tvs = new TvsClient();
        private static readonly LogoSource Logos = new LogoSource();   // the TV's own channel logos; read once after the list, nothing is downloaded
        /// <summary>True when there are logos to show and the "logos" switch is on: the views then keep room for one in every row.</summary>
        private static bool LogosOn { get { return Logos.Available && _features.On("logos"); } }
        private static string LogoOf(Channel c) { return LogosOn ? Logos.PathFor(c) : null; }
        private static ChannelList _list;            // null until the worker has read it
        private static Channel _shown;                // the channel the screen (and, soon, the daemon) is on
        private static Channel _previous;             // the one watched before it: Back goes there, as on Samsung's own tuner (and back again on the next Back)

        /// <summary>The channel on screen changes: the one it was on becomes the one Back returns to.</summary>
        private static void SetShown(Channel c)
        {
            if (_shown != null && c != null && _shown.Id != c.Id) _previous = _shown;
            _shown = c;
        }
        private static int _startMajor;
        private static bool _resident, _active;
        private static string _controlPath;
        // Takeover (--takeover APPID): the resident tuner shows itself when that app (Samsung's live TV, org.tizen.tv-viewer) is on screen.
        private static string _takeoverApp, _pidFile;
        private static bool _takeoverBroken;
        private static readonly Takeover TakeoverState = new Takeover();
        private static IntPtr _takeoverTimer;
        // Whether a key read from the remote went to the tuner's window (see KeyGate); "focus=0" in the features file turns the check off.
        private static readonly KeyGate Gate = new KeyGate();
        private static int _ownPid;
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
        private static Veil _veil;                    // the one veil under the Banner, Info and the guide
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
            _features = new Features(StrArg(args, "--features", null));
            string takeover = StrArg(args, "--takeover", null);
            if (takeover != null && AppIdPattern.IsMatch(takeover)) _takeoverApp = takeover;
            _ageAtMain = ProcessAgeMs();
            if (Flag(args, "--hold")) BannerSeconds = 3600;   // for screenshots
            // --no-motion (Reduce motion, as the dock): every transition is immediate. "motion=0" in the features file does the same, live.
            if (Flag(args, "--no-motion")) Anim.Enabled = false;
            Anim.Switch = () => _features.On("motion");
            OpenLog();
            if (takeover != null && _takeoverApp == null) Log("takeover: bad app id ignored");
            WritePid();
            _ownPid = Libc.getpid();
            Log("start pid=" + _ownPid + (_resident ? " resident" : ""));

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
            if (_resident) { MarkShown(false); _tvUpMarked = true; MarkTvUp(false); OpenControl(); }          // a flag left by a tuner that was killed is stale
            if (_resident && _takeoverApp != null)
            {
                _takeoverTimer = Efl.ecore_timer_add(0.5, OnTakeoverPoll, IntPtr.Zero);
                Log("takeover: shows itself when " + _takeoverApp + " is on screen on the TV input");
                new Thread(FrontMain) { IsBackground = true, Name = "front" }.Start();
            }

            WatchNodes();
            _rescanTimer = Efl.ecore_timer_add(3.0, OnRescan, IntPtr.Zero);
            if (autoExit > 0) _quitTimer = Efl.ecore_timer_add(autoExit, OnQuit, IntPtr.Zero);

            Efl.elm_run();
            Log("elm_run returned");
            if (_controlFd >= 0) { Libc.close(_controlFd); Libc.unlink(_controlPath); }
            RemovePid();
            MarkShown(false);
            MarkTvUp(false);
            Efl.elm_shutdown();
            return 0;
        }

        // ---- showing and hiding the whole tuner ----

        /// <summary>Puts the window on screen (the first time, or again after <see cref="Deactivate"/>) with the banner of the channel we are on.</summary>
        private static void Activate()
        {
            if (_active) return;
            _active = true;
            MarkShown(true);
            Efl.evas_object_show(_win);
            Efl.elm_win_activate(_win);
            Efl.elm_win_raise(_win);
            Gate.Shown(Efl.ecore_time_get());
            if (_shown != null) ShowBanner(_shown);
            StartPrefetch();                                            // schedules may have gone stale while hidden (the store ages them), and a zap may have happened from the pipe
            if (_list != null) { _resyncLeft = 1; ResyncNow(); }        // Samsung's app may have changed the channel while we were hidden
            Log("shown");
        }

        /// <summary>Closes everything and takes the window off the screen. A resident tuner stays alive; otherwise the process ends.</summary>
        /// <param name="hold">Keep the tuner away while Samsung's app stays up (Back, Home). False for Power: the TV goes to standby and wakes on the same app, which must find the tuner on.</param>
        private static void Deactivate(bool hold = true)
        {
            CloseList(); ClosePad(); CloseGuide(); CloseInfo();
            _banner.Hide(); _toast.Hide();
            Anim.FinishAll();                                           // the window goes: nothing is left half way
            if (hold) TakeoverState.Dismissed();
            if (!_resident) { Efl.elm_exit(); return; }
            _active = false;
            MarkShown(false);
            Efl.evas_object_hide(_win);
            Gate.Hidden();
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
                string logoStatus;
                LogoIndex logoIndex = Logos.Read(all, out logoStatus);
                Log(logoStatus);
                Ui(() =>
                {
                    Logos.Install(logoIndex);
                    if (_active && _banner.Visible && _shown != null) _banner.SetLogo(LogoOf(_shown), LogosOn);   // the banner that came up before the logos were read
                    _list = new ChannelList(all);
                    if (cur != null) _list.SetCurrent(cur.Id);
                    if (_startMajor > 0)
                    {
                        Channel want = _list.ByNumber(_startMajor);
                        if (want != null && (cur == null || want.Id != cur.Id)) GoTo(want);   // never re-tune the channel that is already on
                    }
                    StartPrefetch();                                       // the neighbours of where we are, before the first key
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
            while ((long)Libc.read(Wake[0], drain, (UIntPtr)drain.Length) > 0) { }   // always: the handler is level-triggered
            // While a transition runs, the worker's results (a programme, a schedule, the info panel's texts) wait for its end: a redraw would
            // move the objects that are flying. At most a third of a second.
            if (Anim.Busy) { if (!_uiWaiting) { _uiWaiting = true; Anim.WhenIdle(DrainUi); } }
            else DrainUi();
            return 1;
        };
        private static bool _uiWaiting;

        private static void DrainUi()
        {
            _uiWaiting = false;
            Action a;
            while (UiQueue.TryDequeue(out a)) { try { a(); } catch (Exception ex) { Log("ui: " + ex); } }
        }

        // ---- tuning ----

        /// <summary>
        /// Asks for a channel. The banner and the list position change at once (so repeated CH+ presses chain), the daemon is told
        /// on the worker thread, and a burst of requests collapses into the last one.
        /// </summary>
        private static int _goGen;                    // bumped on every request of ours: a resync that was read before it is out of date
        private static void GoTo(Channel c)
        {
            if (c == null) return;
            Interlocked.Increment(ref _goGen);
            if (_list != null) _list.Select(c);
            SetShown(c);
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
            RequestProgram();                                           // after the tune: if the read before it found nothing yet, this one keeps asking (a few times) until the daemon has the tables
            StartPrefetch();                                            // after that: the channels around, so the next zap already has them
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
            Channel on = _shown;
            if (on == null || on.Id != c.Id) return;                   // the owner zapped on while this waited in the queue (CH+ held: one lookup per step): nobody needs it
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

        /// <summary>
        /// Worker: reads a channel's schedule for the whole horizon into the store. False when the call failed: a channel nothing was known about
        /// is then recorded as empty (<see cref="GuideStore.PutFailed"/>), so the guide stops saying "Loading…"; it is asked again after 20 s.
        /// </summary>
        private static bool ReadIntoStore(ulong id, long now)
        {
            bool ok = false;
            try
            {
                List<GuideEvent> events;
                ok = Tvs.ReadSchedule(id, now, GuideGrid.HorizonSeconds, false, out events);
                if (ok) Store.Put(id, events, now, now + GuideGrid.HorizonSeconds);
            }
            catch (Exception ex) { Log("schedule: " + ex.Message); }
            if (!ok) Store.PutFailed(id, now, now + GuideGrid.HorizonSeconds);
            return ok;
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
            _banner.SetProgram(title, ProgramClock.Clock(start, _utcOffset), ProgramClock.Clock(start + duration, _utcOffset), ProgramClock.Remaining(start, duration, now), f.Value);
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
            _banner.SetProgram(a.Title, ProgramClock.Clock(a.Start, _utcOffset), ProgramClock.Clock(a.Start + a.Duration, _utcOffset), ProgramClock.Remaining(a.Start, a.Duration, now), f.Value);
            return true;
        }

        // ---- prefetch: what is on the channels around ----

        private const int PrefetchChannels = 24;

        /// <summary>
        /// The schedules of the channels next to the one on screen are read in the background, so the next CH+/- (or the guide) already has
        /// them: the five above and the five below first (+1, -1, +2, -2, ...; where a zap goes next), then outward up to
        /// <see cref="PrefetchChannels"/>. It starts when the channel list is known and whenever the tuner is shown, not only after a zap, so the first
        /// CH+ already finds its neighbours; the channel on screen is read first. The daemon answers for any channel in 30-50 ms. Runs on the worker in
        /// short slices, behind the tune, and gives way as soon as the owner zaps (the next pass starts from the new channel; what was read stays).
        /// </summary>
        private static void StartPrefetch()
        {
            if (_list == null || _shown == null) return;
            var ids = new List<ulong>();
            ids.Add(_shown.Id);
            foreach (int i in GuideStore.Nearest(_list.Count, _list.CurrentIndex)) { ids.Add(_list[i].Id); if (ids.Count >= PrefetchChannels) break; }
            int gen = Interlocked.Increment(ref _prefetchGen);          // one pass at a time: an older one stops at its next slice
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
            if (!_features.On("guide")) return;
            if (_list == null || _list.Count == 0) { ShowToast("Channels not loaded yet"); return; }
            if (_guideView == null)
            {
                _guideView = new GuideView(new Surface(Efl.evas_object_evas_get(_win), _assets, ScreenW, ScreenH), _veil);
                _grid = new GuideGrid(_list, Store);
            }
            Choreo.Shot from = _banner.Visible ? Choreo.Capture(_banner) : null;   // Banner -> guide: the number and the name fly to their row
            CloseList(); ClosePad(); CloseInfo(); _banner.Hide();   // Info too: the "guide" command of the control pipe can arrive while it is open (a key closes it first)
            _grid.Open(Math.Max(0, _list.CurrentIndex), DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            GuideChanged(true);
            if (from != null) Choreo.Morph(from, _guideView, Choreo.BannerGuide, Motion.GuideOutSeconds, Motion.Linear);
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
            _guideView.Draw(GuideScene.Build(_grid, DateTimeOffset.UtcNow.ToUnixTimeSeconds(), _utcOffset, desc ?? "", LogosOn ? (Func<Channel, string>)LogoOf : null, _guideView.Measure));
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
                bool known = Store.Get(id) != null;
                if (ReadIntoStore(id, now) || !known) Ui(() => { if (gen == Volatile.Read(ref _guideGen) && GuideOpen) DrawGuide(); });   // also after a first failed read: the row stops saying "Loading…"
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
        private static Features _features = new Features(null);   // the test switches (--features FILE); all on without one

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
            if (!_features.On("hold")) return;
            bool channel = IsChannelKey(code);
            if (!_active || (code != KeyUp && code != KeyDown && !channel && !(GuideOpen && (code == KeyLeft || code == KeyRight)))) return;
            if (channel) { if (!GuideOpen && (_listView.Visible || _padView.Visible || InfoOpen)) return; }     // CH+/- repeat while watching and in the guide
            else if (!GuideOpen && !_listView.Visible) return;
            _holdCode = code; _holdStarted = Environment.TickCount64;
            if (_releasesSeen) _holdTimer = Efl.ecore_timer_add(HoldFirst, OnHoldFirst, IntPtr.Zero);
        }

        private static void StartHoldRepeat()
        {
            if (_holdCode == 0) return;
            _holdTimer = Efl.ecore_timer_add(HoldEvery, OnHoldTick, IntPtr.Zero);
            HoldStep();
        }

        private static bool IsChannelKey(int code) { return code == KeyChannelUp || code == KeyChannelUp2 || code == KeyChannelDown || code == KeyChannelDown2; }

        private static void HoldStep()
        {
            Anim.FinishAll();
            if (IsChannelKey(_holdCode))
            {
                bool up = _holdCode == KeyChannelUp || _holdCode == KeyChannelUp2;
                if (GuideOpen) { _grid.MovePage(up ? +1 : -1); GuideChanged(true); }
                else if (!_listView.Visible && !_padView.Visible && !InfoOpen && _list != null) GoTo(_list.Step(up ? +1 : -1));
                else StopHold();
            }
            else if (GuideOpen) GuideMove(_holdCode);
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
                Choreo.Shot from = Choreo.Capture(_guideView);                // guide -> Banner: the row's number and name fly back into the Banner
                CloseGuide();
                if (c != null && (_shown == null || _shown.Id != c.Id)) GoTo(c); else if (c != null) ShowBanner(c);
                if (_banner.Visible) Choreo.Morph(from, _banner, Choreo.GuideBanner, Motion.GuideOutSeconds, Motion.Linear);
            }
        }

        // ---- the info panel (Info key) ----

        private static bool InfoOpen { get { return _infoView != null && _infoView.Visible; } }

        /// <summary>Opens the panel with what is known now (channel, programme from the store, clock), then reads the rest on the worker: description, audio track, tuner.</summary>
        private static void OpenInfo()
        {
            if (!_features.On("info")) return;
            Channel c = _shown;
            if (c == null) { ShowToast("Channel not known yet"); return; }
            Choreo.Shot from = _banner.Visible ? Choreo.Capture(_banner) : null;   // Banner -> Info: the shared parts fly, the veil grows
            CloseList(); ClosePad(); CloseGuide(); _banner.Hide(); _toast.Hide();
            long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            _info = new InfoData { Number = c.Major.ToString(), Name = c.Name, Clock = ProgramClock.Clock(now, _utcOffset), Date = InfoText.Date(now, _utcOffset), Logo = LogoOf(c), LogoRoom = LogosOn };
            ApplyInfoProgram(c, Store.Current(c.Id, now), now, false);   // not read yet is not "none": the title row stays empty until InfoLookup answers
            _infoView.Draw(_info);
            if (from != null) Choreo.Morph(from, _infoView, Choreo.BannerInfo, Motion.FadeSeconds, Motion.In);
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

        /// <param name="asked">The daemon has answered: without a programme the title row says "No programme information". Before that it stays empty.</param>
        private static void ApplyInfoProgram(Channel c, GuideEvent e, long now, bool asked)
        {
            double? f = e == null ? null : ProgramClock.Fraction(e.Start, e.Duration, now);
            if (e == null || f == null) { _info.NoProgram = asked; _info.Fraction = null; _info.Title = ""; _info.Start = ""; _info.End = ""; _info.Left = ""; return; }
            _info.NoProgram = false; _info.Title = e.Title; _info.Fraction = f;
            _info.Start = ProgramClock.Clock(e.Start, _utcOffset);
            _info.End = ProgramClock.Clock(e.Start + e.Duration, _utcOffset);
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
                ApplyInfoProgram(c, e, now, true);
                _info.Description = desc; _info.Audio = audio; _info.Source = source;
                _infoView.Draw(_info);
            });
        }

        // ---- keys ----

        /// <param name="from">Where the key came from (the input node, or the control pipe), for the log: a key that comes on a part of the
        /// remote the remote bridge does not hold (its infrared side) shows up here with that node.</param>
        private static void OnKey(int code, string from = null)
        {
            Log("key " + code + (from != null ? " from " + from : ""));
            Anim.FinishAll();                                           // a transition still running ends now: the key acts on the final screen
            if (!_active)
            {
                if (!WakeOnKey(code)) return;                           // resident and hidden: keys are not ours, unless Samsung's app is up and this is a TV key
                if (IsChannelKey(code)) { ResyncSoon(); return; }       // Samsung's app has the same key and changes the channel itself: ours would be a second step from a stale channel
            }
            if (SystemKeys.Contains(code)) { Deactivate(code != KeyPower); return; }    // Home, Menu, Power...: step aside, the system does the rest
            if (code == Key123)
            {
                // Samsung's own 123 pad is opening and takes the keys (KeyGate then leaves them to it): nothing of ours stays open under it.
                CloseList(); ClosePad(); CloseGuide(); CloseInfo();
                _banner.Hide(); _toast.Hide();
                return;
            }
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
            // Back with nothing open: while the banner is up it only clears it; the next Back goes to the channel watched before, as Samsung's tuner does.
            // The tuner stays up and keeps the keyboard focus either way (the window is transparent, so the picture is full screen): hiding it would hand
            // the focus to Samsung's live TV app, which would answer the same Back with its own "previous channel" and banner.
            if (back)
            {
                if (_banner.Visible || _toast.Visible)
                {
                    if (_bannerTimer != IntPtr.Zero) { Efl.ecore_timer_del(_bannerTimer); _bannerTimer = IntPtr.Zero; }
                    _banner.Hide(); _toast.Hide();
                }
                else if (_previous != null) GoTo(_previous);
                return;
            }
            if (code == KeyInfo) { OpenInfo(); return; }
            if (code == KeyUp || code == KeyEpg || code == KeyGuide) { OpenGuide(); return; }
            if (code == KeyChannelUp || code == KeyChannelUp2) { if (_list != null) GoTo(_list.Step(+1)); return; }
            if (code == KeyChannelDown || code == KeyChannelDown2) { if (_list != null) GoTo(_list.Step(-1)); return; }
            if (code == KeyRight) { OpenPad(-1); return; }   // not "123" (140): Samsung opens its own pad on that key whatever we do
            if (code == KeyLeft) { CycleAudio(); return; }
            if (code == KeyEnter) { OpenList(); return; }
            int digit = Digit(code);
            if (digit >= 0) OpenPad(digit);
        }

        /// <summary>
        /// The keys that bring a hidden tuner back: CH+/-, Info and Guide/EPG. Samsung's app answers them with its own banner, list or panel, and
        /// nothing else on the TV uses them. The arrows and OK are NOT here: the launcher (a window, not an app the application manager knows)
        /// and Samsung's own overlays (Source, quick settings) leave the live TV app "in front" while they use those keys, and the tuner would
        /// pop up over them. Digits are left out too (the remotes that have them are rare, and Samsung's number entry would tune as well).
        /// </summary>
        private static bool IsTvKey(int code) { return IsChannelKey(code) || code == KeyEpg || code == KeyGuide || code == KeyInfo; }

        /// <summary>
        /// Enforcement of the takeover. The poll runs twice a second and, after Back, leaves the screen to Samsung's app on purpose; but
        /// the remote's keys reach Samsung's app as well, and it answers CH+, OK or Info with its own banner and lists. So a TV key that
        /// arrives while the tuner is hidden asks the application manager at once: if Samsung's live TV app is up, the tuner comes back
        /// and the key is its own. Only when takeover is on (--takeover) and the application manager can be asked.
        /// </summary>
        private static IntPtr _resyncTimer;
        private static int _resyncLeft;
        private static readonly Efl.TaskCb OnResync = d => { _resyncTimer = IntPtr.Zero; ResyncNow(); return 0; };

        /// <summary>The channel may have changed behind our back (Samsung's app answered a key, or Samsung's own list was used): ask the daemon what is on now, at 0.8 s and again at 2.5 s because a channel change takes a moment to show.</summary>
        private static void ResyncSoon()
        {
            _resyncLeft = 2;
            Restart(ref _resyncTimer, 0.8, OnResync);
        }

        private static void ResyncNow()
        {
            if (_resyncLeft-- > 1) Restart(ref _resyncTimer, 1.7, OnResync);
            int goGen = Volatile.Read(ref _goGen);
            Work.Add(() =>
            {
                string status;
                Channel cur = null;
                try { cur = Tvs.ReadCurrent(out status); } catch (Exception ex) { Log("resync: " + ex.Message); }
                if (cur == null) return;
                Ui(() =>
                {
                    if (goGen != Volatile.Read(ref _goGen)) return;      // we asked for a channel ourselves since this was read: that decides
                    if (_shown != null && _shown.Id == cur.Id) return;
                    Log("resync: the TV is on " + cur.Major + " " + cur.Name);
                    SetShown(cur);
                    if (_list != null) _list.SetCurrent(cur.Id);
                    if (_active) { ShowBanner(cur); StartPrefetch(); }
                });
            });
        }

        private static bool WakeOnKey(int code)
        {
            if (!_resident || _takeoverApp == null || _takeoverBroken || !IsTvKey(code)) return false;
            int status = ReadTargetStatus();
            FrontApp.Kind front = CurrentFront();
            if (!TakeoverState.KeyWake(status, TvInput(), front)) return false;
            Log("takeover: key " + code + " with " + _takeoverApp + " status " + status + " (front " + front + "), showing the tuner");
            Activate();
            return true;
        }

        /// <summary>
        /// The launcher closed without opening anything, or switched to the TV input (it writes "resume" on the control pipe): the tuner that
        /// stepped aside for it comes back when live TV is what is on screen. Without this, Home then Back left Samsung's own app answering
        /// the remote (OK opened Samsung's channel list) until a CH key.
        /// </summary>
        private static void Resume()
        {
            if (_active || !_resident || _takeoverApp == null || _takeoverBroken) return;
            if (LauncherOpen()) { Log("resume: a launcher window is still open"); return; }
            int status = ReadTargetStatus();
            FrontApp.Kind front = CurrentFront();
            bool tv = TvInput();
            if (!TakeoverState.Resume(status, tv, front))
            {
                Log(TakeoverState.Held ? "resume: not on live TV (status " + status + ", tv input " + tv + ")"
                                       : "resume: another app has the keys for now (front " + front + "); the tuner comes back with live TV");
                return;
            }
            Log("resume: back on live TV, showing the tuner");
            Activate();
        }

        /// <summary>KEY_1..KEY_9 are 2..10, KEY_0 is 11.</summary>
        private static int Digit(int code) { return code >= 2 && code <= 10 ? code - 1 : code == 11 ? 0 : -1; }

        // ---- channel list (OK) ----

        private static void OpenList()
        {
            if (!_features.On("list")) return;
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
            _listView.Draw(_list, _sel, LogoOf, LogosOn);
            Restart(ref _listTimer, ListSeconds, OnListTimeout);
        }

        // ---- number pad (Right; a real digit key opens it too) ----

        private static void OpenPad(int firstDigit)
        {
            if (!_features.On("pad")) return;
            if (_list == null) return;
            Entry.Reset();
            if (firstDigit >= 0) { Entry.TypeDigit(firstDigit); ArmDigitCommit(); }
            _banner.Hide();
            DrawPad();
        }

        private static void DrawPad()
        {
            Channel c = Entry.Text.Length > 0 && _list != null ? _list.ByNumber(Entry.Value) : null;
            _padView.Draw(Entry, c != null ? c.Name : (Entry.Text.Length > 0 ? "No such channel" : ""), c != null ? LogoOf(c) : null);
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

        // ---- audio (Left) ----

        private static void CycleAudio()
        {
            if (!_features.On("audio")) return;
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
            if (c == null || !_features.On("banner") || _listView.Visible || _padView.Visible || GuideOpen || InfoOpen) return;
            _banner.ShowChannel(c.Major.ToString(), c.Name, LogoOf(c), LogosOn);
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
            _veil = new Veil(new Surface(evas, assets, ScreenW, ScreenH));     // first: it sits under the Banner, Info and the guide, its users
            _banner = new BannerView(s1, _veil);
            _listView = new ListView(s2);
            _padView = new PadView(s3);
            _toast = new ToastView(s4);
            _infoView = new InfoView(new Surface(evas, assets, ScreenW, ScreenH), _veil);
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
            Anim.FinishAll();
            string[] p = line.Split(' ');
            switch (p[0])
            {
                case "show": Activate(); break;
                case "hide": if (_active) Deactivate(); break;
                case "toggle": if (_active) Deactivate(); else Activate(); break;
                case "quit": Efl.elm_exit(); break;
                case "audio": if (_active) CycleAudio(); break;
                case "banner": Activate(); ShowBanner(_list != null ? _list.Current : null); break;   // the channel banner, as after a channel change
                case "list": Activate(); OpenList(); break;
                case "pad": Activate(); OpenPad(-1); break;
                case "info": Activate(); if (InfoOpen) CloseInfo(); else OpenInfo(); break;
                case "guide": Activate(); if (GuideOpen) CloseGuide(); else OpenGuide(); break;
                case "repeat": int rk; if (p.Length > 1 && int.TryParse(p[1], out rk)) OnRepeat(rk); break;
                // As if the remote had sent it: for testing, and for a Remapper shortcut whose key would otherwise be injected into this window and lost.
                case "key": int k; if (p.Length > 1 && int.TryParse(p[1], out k) && k > 0 && k < 768) OnKey(k, "pipe"); break;
                case "resume": Resume(); break;                // the launcher closed without opening anything (see Resume)
                case "rescan": WatchNodes(); break;            // the remote bridge has just made a new forwarding node: watch it now, not at the next 3 s scan
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
            if (_presses.Count > 0 || _held.Count > 0)
            {
                string why = LauncherOpen() ? "a launcher window has them" : (_active && !KeysAreOurs()) ? "another window has the focus" : null;
                if (why != null)
                {
                    // The key went to another window, which answers it: the tuner leaves it alone (Home, Power... still make it step aside),
                    // does not wake up on it, and its Banner makes room for that window.
                    foreach (int c in _presses) if (!SystemKeys.Contains(c)) Log("key " + c + " from " + Path.GetFileName(_paths[index]) + " left alone: " + why);
                    _presses.RemoveAll(c => !SystemKeys.Contains(c));
                    _held.Clear();
                    if (_banner.Visible) _banner.Hide();
                }
            }
            foreach (int code in _presses.ToArray()) { OnKey(code, Path.GetFileName(_paths[index])); BeginHold(code); }
            foreach (int code in _held.ToArray()) OnRepeat(code);
            foreach (int code in _released.ToArray()) EndHold(code);
        }

        /// <summary>The Dock, its Task manager or the osd 123 is on screen (OverlayFlag): the remote's keys are the launcher's.</summary>
        private static bool LauncherOpen()
        {
            return OverlayFlag.Fresh(OverlayFlag.PadPath, OverlayFlag.PadSeconds) || OverlayFlag.Fresh(OverlayFlag.DockPath, OverlayFlag.DockSeconds);
        }

        /// <summary>With the tuner on screen: whether its window has the keyboard focus now, so that a key read from the remote is its own (KeyGate).</summary>
        private static bool _focusBroken;
        private static bool KeysAreOurs()
        {
            if (_focusBroken || !_features.On("focus")) return true;
            bool focused;
            try { focused = Efl.elm_win_focus_get(_win) != 0; }
            catch (Exception ex) when (ex is DllNotFoundException || ex is EntryPointNotFoundException)
            {
                _focusBroken = true;                                    // this TV has no such call: keys are not gated, as before
                Log("focus: cannot be read (" + ex.GetType().Name + "), keys not gated");
                return true;
            }
            if (Gate.Sample(focused)) Log(focused ? "focus: the tuner has the keys" : "focus: another window has the keys");
            return Gate.Accepts(Efl.ecore_time_get());
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
        private static int _lastStatus = int.MinValue;

        /// <summary>The application manager's status of the TV app; negative when it could not be read. Logs every change, so a TV run shows what the numbers really are (2 or 3 with the tuner in front, what Home and Source do).</summary>
        private static int ReadTargetStatus()
        {
            int status;
            try { status = Efl.aul_app_get_status(_takeoverApp); }
            catch (Exception ex) when (ex is DllNotFoundException || ex is EntryPointNotFoundException)
            {
                _takeoverBroken = true;      // the timer stops itself: this TV has no such call, and Samsung's app then always shows
                Log("takeover: the application manager cannot be asked (" + ex.GetType().Name + "), switched off");
                return -1;
            }
            if (status != _lastStatus) { Log("takeover: " + _takeoverApp + " status " + (_lastStatus == int.MinValue ? "first" : _lastStatus.ToString()) + " -> " + status + (_active ? " (tuner shown)" : " (tuner hidden)")); _lastStatus = status; }
            return status;
        }

        private static void PollTakeover()
        {
            int status = ReadTargetStatus();
            if (_takeoverBroken) return;
            bool tv = TvInput();
            FrontApp.Kind front = CurrentFront();
            bool launcher = LauncherOpen();
            if (launcher) front = FrontApp.Kind.Unknown;                 // the launcher has the keys: who else might is beside the point (Takeover)
            if (_active) KeysAreOurs();                                  // samples the focus, so the log shows when another window takes the keys
            bool up = status >= 0 && Takeover.IsUp(status) && tv;
            // Samsung's live TV is what is on screen: the osd 123 sends its digits to the tuner only then (over another app they are that app's keys).
            // Not touched while a launcher window is open: it has the keys then, and what counts is what was in front when it opened (the osd 123
            // opened over YouTube must not start sending its digits to the tuner).
            if (!launcher) MarkTvUp(up && front != FrontApp.Kind.Other);
            else if (!up) MarkTvUp(false);
            switch (TakeoverState.Poll(status, _active, tv, front))
            {
                case Takeover.Step.Show:
                    if (launcher) break;                                 // the launcher is open over live TV: the tuner waits for it to close (Resume)
                    Log("takeover: " + _takeoverApp + " status " + status + " (front " + front + "), showing the tuner");
                    Activate();
                    break;
                case Takeover.Step.Hide:
                    // Another app came in front (Netflix...) or the input is no longer the TV tuner (HDMI): the tuner reads the remote itself, so it
                    // must go, or OK there opens its channel list (and on HDMI the keys the TV passes to the device through HDMI-CEC would be lost).
                    Log("takeover: " + _takeoverApp + " status " + status + (tv ? "" : ", input is not the TV tuner") + (front == FrontApp.Kind.Other ? ", another app has the keys" : "") + ", hiding the tuner");
                    Deactivate(false);
                    break;
                case Takeover.Step.Reclaim:
                    // On screen, but the window manager gives the keys to Samsung's app (a window that closed handed the focus back to it):
                    // the tuner asks for them again, or Samsung's app would answer the remote under it while the tuner leaves the keys alone.
                    if (launcher) break;
                    Log("takeover: " + _takeoverApp + " has the keys while the tuner is on screen, asking for them back");
                    Efl.elm_win_activate(_win);
                    Efl.elm_win_raise(_win);
                    break;
            }
        }

        // ---- the TV's input: the tuner covers the TV tuner only, never HDMI ----

        private const string SourceKey = "memory/system/source_type";
        private static bool _sourceBroken;
        private static int _lastSource = int.MinValue;

        /// <summary>True when the TV shows its own tuner (source type 0), or when that cannot be read (the tuner then behaves as before).</summary>
        private static bool TvInput()
        {
            if (_sourceBroken) return true;
            int source;
            try
            {
                if (Efl.vconf_get_int(SourceKey, out source) != 0) return true;
            }
            catch (Exception ex) when (ex is DllNotFoundException || ex is EntryPointNotFoundException)
            {
                _sourceBroken = true;
                Log("input: " + SourceKey + " cannot be read (" + ex.GetType().Name + "), every input counts as the TV tuner");
                return true;
            }
            if (source != _lastSource) { Log("input: source type " + (_lastSource == int.MinValue ? "first" : _lastSource.ToString()) + " -> " + source + (source == 0 ? " (TV)" : " (not the TV tuner)")); _lastSource = source; }
            return source == 0;
        }

        // ---- who has the keys: read on a thread of its own, the call asks the window manager over D-Bus ----

        private static readonly object FrontLock = new object();
        private static bool _frontOk, _frontBroken;
        private static int _frontPid;
        private static string _frontAppId;
        private static long _frontAt;                   // Environment.TickCount64 of the last reading; 0 = none yet
        private static string _frontLogged;

        private static void FrontMain()
        {
            var buf = new byte[256];
            while (true)
            {
                Thread.Sleep(500);
                bool ok = false; int pid = 0; string app = null;
                try
                {
                    ok = Efl.aul_window_get_focused_pid(out pid) == 0 && pid > 0;
                    if (ok)
                    {
                        Array.Clear(buf, 0, buf.Length);
                        if (Efl.aul_app_get_appid_bypid(pid, buf, buf.Length) == 0)
                        {
                            int n = Array.IndexOf(buf, (byte)0);
                            app = Encoding.ASCII.GetString(buf, 0, n < 0 ? buf.Length : n);
                        }
                    }
                }
                catch (Exception ex) when (ex is DllNotFoundException || ex is EntryPointNotFoundException)
                {
                    _frontBroken = true;
                    Log("front: the window manager cannot be asked (" + ex.GetType().Name + "), the takeover goes by the app status only");
                    return;
                }
                catch (Exception ex) { ok = false; Log("front: " + ex.Message); }
                lock (FrontLock) { _frontOk = ok; _frontPid = pid; _frontAppId = app; _frontAt = Environment.TickCount64; }
            }
        }

        /// <summary>Who has the keys now (FrontApp), from the last reading of the thread above. Logs every change.</summary>
        private static FrontApp.Kind CurrentFront()
        {
            if (_frontBroken) return FrontApp.Kind.Unknown;
            bool ok; int pid; string app; long at;
            lock (FrontLock) { ok = _frontOk; pid = _frontPid; app = _frontAppId; at = _frontAt; }
            if (at == 0) return FrontApp.Kind.Unknown;
            FrontApp.Kind kind = FrontApp.Judge(ok, pid, app, (Environment.TickCount64 - at) / 1000.0, _ownPid, _takeoverApp);
            string seen = kind + (app != null ? " " + app : ok ? " pid " + pid : "");
            if (seen != _frontLogged) { Log("front: " + seen + (_active ? " (tuner shown)" : " (tuner hidden)")); _frontLogged = seen; }
            return kind;
        }

        // ---- a flag for the launcher: is Samsung's live TV on screen? ----

        private static bool _tvUpMarked;

        /// <summary>
        /// While Samsung's live TV app is in front the file "&lt;control pipe&gt;.tv" exists (kept by the takeover poll, only touched when it changes).
        /// The launcher's 123 pad sends typed digits to the tuner (`tune N`) only when it exists: over Netflix or any other app the digits go to
        /// that app as keys, and the pad still opens there (for the colour keys).
        /// </summary>
        private static void MarkTvUp(bool on)
        {
            if (!_resident || _controlPath == null || on == _tvUpMarked) return;
            _tvUpMarked = on;
            string flag = _controlPath + ".tv";
            try { if (on) File.WriteAllText(flag, "1"); else File.Delete(flag); }
            catch (Exception ex) { Log("tv flag: " + ex.Message); }
        }

        // ---- a flag for the launcher: is the tuner on screen? ----

        /// <summary>
        /// While the tuner is on screen the file "&lt;control pipe&gt;.shown" exists. The launcher's 123 pad looks for it to decide whether its Info
        /// key goes to the tuner (`echo info > pipe`) or, as before, to the app underneath. The pipe alone says only that a tuner is resident.
        /// </summary>
        private static void MarkShown(bool on)
        {
            if (!_resident || _controlPath == null) return;
            string flag = _controlPath + ".shown";
            try { if (on) File.WriteAllText(flag, "1"); else File.Delete(flag); }
            catch (Exception ex) { Log("shown flag: " + ex.Message); }
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
