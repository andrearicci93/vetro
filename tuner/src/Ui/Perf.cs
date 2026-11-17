using System;
using System.Diagnostics;
using System.Globalization;
using Tuner.Native;

namespace Tuner.Ui
{
    /// <summary>
    /// --perf: what the tuner's frames and keys cost on the TV, one log line each, off by default (with it off every probe is one test of a
    /// static bool, and nothing is allocated or added to the main loop). The lines start with "perf ":
    /// <list type="bullet">
    /// <item>"perf anim LABEL: frames=N interval ms min/avg/max=… over30ms=… (worst at frame K) work ms avg/max=…" for every transition, from
    /// the animator's first tick to its last (the dock's format): how far apart the frames really were and how long the tuner's own work in
    /// each took. LABEL is what started it (the key's action, "banner out", "cmd info"…); "+cut" when a key finished it early.</item>
    /// <item>"perf key LABEL: handler X ms, next frame Y ms": from the moment the key was read to the end of its handling, and to the next tick of
    /// the frame clock (the frame with the change has been drawn by then).</item>
    /// <item>"perf guide draw: X ms, texts set N, cuts measured M, cuts kept K" for every redraw of the guide.</item>
    /// <item>"perf start: …" once, when the main loop starts; "perf show: …" when the resident tuner is shown.</item>
    /// </list>
    /// The frame probe of a key uses an animator of its own, not <see cref="Anim"/>, so turning --perf on changes nothing that is drawn.
    /// </summary>
    internal static class Perf
    {
        public static bool On;
        public static Action<string> Log;

        private static double Ms(long from, long to) { return (to - from) * 1000.0 / Stopwatch.Frequency; }
        public static long Now() { return Stopwatch.GetTimestamp(); }

        // ---- transitions (fed by Anim) ----

        private static readonly double[] Dt = new double[2048], Work = new double[2048];
        private static int _n;
        private static double _lastTick;
        private static string _label;
        private static bool _running;

        /// <summary>Names the transition the caller has just started (called after the action): a transition already named keeps its name.</summary>
        public static void Label(string label)
        {
            if (On && _running && _label == null) _label = label;
        }

        /// <summary>Anim made its animator.</summary>
        public static void AnimStart(double now)
        {
            if (!On) return;
            _running = true; _n = 0; _lastTick = now; _label = null;
        }

        /// <summary>One animator tick: its time and how long the tuner's work in it took.</summary>
        public static void AnimFrame(double now, double workMs)
        {
            if (!On || !_running) return;
            if (_n < Dt.Length) { Dt[_n] = (now - _lastTick) * 1000.0; Work[_n] = workMs; _n++; }
            _lastTick = now;
        }

        /// <summary>The animator ended (<paramref name="cut"/>: a key or a hide finished every run at once).</summary>
        public static void AnimEnd(bool cut)
        {
            if (!On || !_running) return;
            _running = false;
            // the first interval runs from the start of the transition to the first tick, not between two frames: left out of the intervals
            double min = double.MaxValue, max = 0, sum = 0, wmax = 0, wsum = 0; int over = 0, n = 0, worst = 0;
            for (int i = 0; i < _n; i++)
            {
                if (Work[i] > wmax) wmax = Work[i];
                wsum += Work[i];
                if (i == 0) continue;
                double d = Dt[i];
                if (d < min) min = d;
                if (d > max) { max = d; worst = i; }
                if (d > 30.0) over++;
                sum += d; n++;
            }
            Write(string.Format(CultureInfo.InvariantCulture,
                "perf anim {0}{1}: frames={2} interval ms min/avg/max={3:0.0}/{4:0.0}/{5:0.0} over30ms={6} (worst at frame {7}) work ms avg/max={8:0.00}/{9:0.00}",
                _label ?? "?", cut ? "+cut" : "", _n, n > 0 ? min : 0, n > 0 ? sum / n : 0, max, over, worst, _n > 0 ? wsum / _n : 0, wmax));
            _label = null;
        }

        // ---- a key, to the next frame ----

        private static long _keyAt, _handledAt;
        private static string _keyLabel;
        private static IntPtr _frameProbe;
        private static readonly Efl.TaskCb OnFrameProbe = d =>
        {
            _frameProbe = IntPtr.Zero;
            try { Write(string.Format(CultureInfo.InvariantCulture, "perf {0}: handler {1:0.0} ms, next frame {2:0.0} ms", _keyLabel, Ms(_keyAt, _handledAt), Ms(_keyAt, Now()))); }
            catch (Exception) { }
            return 0;
        };

        /// <summary>A key (or a show) that started at <paramref name="startedAt"/> has been handled: the next frame tick closes its line.</summary>
        public static void Handled(string label, long startedAt)
        {
            if (!On) return;
            _keyAt = startedAt; _handledAt = Now(); _keyLabel = label;
            Label(label.StartsWith("key ", StringComparison.Ordinal) ? label.Substring(4) : label);
            if (_frameProbe == IntPtr.Zero) _frameProbe = Efl.ecore_animator_add(OnFrameProbe, IntPtr.Zero);
        }

        public static void Write(string line) { if (Log != null) Log(line); }
    }
}
