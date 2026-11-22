using System;

namespace Launcher.Core
{
    /// <summary>
    /// The time step of an animation whose animator stops while nothing moves (the osd 123 at rest) and starts again on a key. A running
    /// animator advances by the time since its previous tick; after a restart there is no previous tick, and the time since the last tick
    /// of the earlier run (seconds, clamped) would carry the movement most of the way in one frame. The first tick after a restart advances
    /// by the interval the earlier run saw between two ticks instead: what a running animator would have done.
    /// </summary>
    internal sealed class FrameStep
    {
        private readonly double _max;
        private double _last, _interval = 1.0 / 60.0;
        private bool _first = true, _resume;

        /// <param name="max">The longest step (a stalled frame must not teleport the animation).</param>
        public FrameStep(double max) { _max = max; }

        /// <summary>The interval last seen between two ticks of one run (1/60 s before any).</summary>
        public double Interval { get { return _interval; } }

        /// <summary>A new run starts now (the window opens): its first tick advances by the time since <paramref name="now"/>.</summary>
        public void Begin(double now) { _last = now; _first = true; _resume = false; }

        /// <summary>The animator is added again after it stopped at rest: its first tick advances by <see cref="Interval"/>.</summary>
        public void Resume() { _first = true; _resume = true; }

        /// <summary>The step for a tick at <paramref name="now"/>.</summary>
        public double Next(double now)
        {
            double dt;
            if (_first && _resume) dt = _interval;
            else
            {
                dt = Math.Min(_max, Math.Max(0, now - _last));
                if (!_first) _interval = dt;   // only a gap between two ticks of one run is a frame interval
            }
            _first = false; _resume = false;
            _last = now;
            return dt;
        }
    }

    /// <summary>
    /// The osd 123's movement: the fade in and out and the focus capsule sliding to its cell (an exponential approach that snaps when
    /// it is within half a pixel). <see cref="Step"/> says whether anything is still moving, so the pad's animator can stop at rest.
    /// </summary>
    internal sealed class PadMotion
    {
        public const double FadeSeconds = 0.12, SlideRate = 18;

        /// <summary>Reduce motion (--no-motion): the pad appears, goes and moves its capsule at once.</summary>
        public static bool Instant;

        public double Fade, FocusX;

        /// <summary>Advances by <paramref name="dt"/>. Returns false once the pad has faded out (closing) or is at rest (open, opaque, capsule on its cell).</summary>
        /// <param name="target">The x the capsule goes to; ignored while the focus is on Done (the capsule stays where it is).</param>
        public bool Step(double dt, bool closing, bool onDone, double target, out bool gone)
        {
            if (Instant)
            {
                gone = closing;
                Fade = closing ? 0 : 1;
                if (!onDone) FocusX = target;
                return false;
            }
            Fade = closing ? Fade - dt / FadeSeconds : Math.Min(1, Fade + dt / FadeSeconds);
            gone = closing && Fade <= 0;
            if (gone) { Fade = 0; return false; }
            if (!onDone)
            {
                FocusX += (target - FocusX) * Math.Min(1, dt * SlideRate);
                if (Math.Abs(target - FocusX) < 0.5) FocusX = target;
            }
            return closing || Fade < 1 || (!onDone && FocusX != target);
        }
    }

    /// <summary>
    /// The Volume bar's opacity over time: a fade-in from when it was shown, full for the hold, a fade-out after <c>until</c>. While it is
    /// full and holding nothing moves: the animator stops and a one-shot timer starts it again when the fade-out is due.
    /// </summary>
    internal static class VolumeFade
    {
        public const double HoldSeconds = 1.6, FadeInSeconds = 0.12, FadeOutSeconds = 0.22;

        /// <summary>Reduce motion (--no-motion): the bar is full while it holds and gone after, with no fade.</summary>
        public static bool Instant;

        public static double Alpha(double now, double shownAt, double until)
        {
            if (Instant) return now > until ? 0 : 1;
            double a = Math.Min(1.0, (now - shownAt) / FadeInSeconds);
            if (now > until) a = Math.Min(a, 1.0 - (now - until) / FadeOutSeconds);
            return a;
        }

        /// <summary>True when the bar is full and the hold has not ended: no frame changes anything until <c>until</c>.</summary>
        public static bool Holding(double alpha, double now, double until) { return alpha >= 1.0 && now <= until; }
    }

    /// <summary>
    /// The values a piece of the screen was last placed for. <see cref="Same"/> is true when the new ones equal them, and the moves and
    /// resizes can be skipped: they would set every object where it already is. <see cref="Invalidate"/> forces the next placement.
    /// </summary>
    internal struct PlaceKey
    {
        private bool _valid;
        private int _a, _b, _c, _d;
        private float _e, _f;

        public bool Same(int a, int b, int c, int d, float e, float f)
        {
            if (_valid && a == _a && b == _b && c == _c && d == _d && e.Equals(_e) && f.Equals(_f)) return true;
            _valid = true; _a = a; _b = b; _c = c; _d = d; _e = e; _f = f;
            return false;
        }

        public void Invalidate() { _valid = false; }
    }

    /// <summary>
    /// When the periodic look at the input devices may skip reading /proc/bus/input/devices: the /dev/input directory has not changed
    /// since the last full read, that change is old enough not to hide another one in the same clock tick, nothing failed to open, no node
    /// was dropped, and the last full read is fewer than <see cref="FullEvery"/> looks ago. A node appears or goes away in /dev/input
    /// (devtmpfs) in the same kernel step that adds it to or removes it from that list, so an unchanged directory means an unchanged list.
    /// </summary>
    internal sealed class InputScanGate
    {
        /// <summary>A full read at least every this many looks, whatever the directory says.</summary>
        public const int FullEvery = 10;
        /// <summary>A directory changed this recently is read again on the next look too (a second change in the same tick of the file system's clock would keep its time).</summary>
        public static readonly long SettleTicks = TimeSpan.FromSeconds(2).Ticks;

        private long _seen = long.MinValue;
        private int _skipped;
        private bool _force = true;

        /// <summary>The next look reads the list whatever the directory says (a node was dropped, the list or a node could not be read).</summary>
        public void Force() { _force = true; }

        /// <param name="dirTicks">The directory's last change (UTC ticks), or 0 / negative when it cannot be read.</param>
        /// <param name="nowTicks">Now, on the same clock.</param>
        /// <returns>True: read the list now (and call <see cref="Read"/>). False: nothing can have changed.</returns>
        public bool ShouldRead(long dirTicks, long nowTicks)
        {
            if (_force || dirTicks <= 0 || dirTicks != _seen || _skipped + 1 >= FullEvery) return true;
            _skipped++;
            return false;
        }

        /// <summary>A full read was made, the directory having said <paramref name="dirTicks"/> just before it; <paramref name="clean"/>: every remote node opened.</summary>
        public void Read(long dirTicks, long nowTicks, bool clean)
        {
            _skipped = 0;
            bool settled = dirTicks > 0 && nowTicks - dirTicks >= SettleTicks;
            _seen = settled ? dirTicks : long.MinValue;
            _force = !clean;
        }
    }

    /// <summary>
    /// A shell command that waits for the next frame to be drawn (the Home guard): set on the key, taken once by the timer that runs it.
    /// A second press before it ran replaces it (the older chain would have stopped at its first check: the generation moved on).
    /// </summary>
    internal sealed class PendingCommand
    {
        private string _cmd;
        public bool Pending { get { return _cmd != null; } }
        public void Set(string cmd) { _cmd = cmd; }
        public string Take() { string c = _cmd; _cmd = null; return c; }
    }
}
