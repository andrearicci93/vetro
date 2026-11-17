using System;
using System.Collections.Generic;
using Tuner.Core;
using Tuner.Native;

namespace Tuner.Ui
{
    /// <summary>
    /// The tuner's animator: runs, each a value from 0 to 1 over a time on a <see cref="Motion"/> curve, applied once a frame by one ecore
    /// animator that exists only while something moves. A run with a key replaces the run with the same key (cancelled: no last frame, no end
    /// action). With motion off (--no-motion, or "motion=0" in the features file) every run jumps to its end. UI thread only.
    /// A guard timer finishes everything shortly after the last run should have ended, so a lost animator tick can never leave the screen half
    /// way or keep <see cref="WhenIdle"/> waiting.
    /// </summary>
    internal static class Anim
    {
        /// <summary>False with --no-motion: nothing moves, every change is immediate.</summary>
        public static bool Enabled = true;
        /// <summary>A live switch read at every run (the features file); null: on.</summary>
        public static Func<bool> Switch;

        private sealed class Track { public object Key; public double Start, Delay, Seconds; public double[][] Curve; public Action<double> Apply; public Action Done; public bool Gone; }
        private static readonly List<Track> Tracks = new List<Track>();
        // The runs of the frame being drawn, copied into this one list (a frame allocates nothing). A run that leaves Tracks is marked Gone.
        private static readonly List<Track> Frame = new List<Track>();
        private static readonly List<Action> Idle = new List<Action>();
        private static IntPtr _animator, _guard;
        private static double _guardDue;
        private static bool _ticking;
        private static readonly Efl.TaskCb OnTick = d => Tick();
        private static readonly Efl.TaskCb OnGuard = d => { _guard = IntPtr.Zero; FinishAll(); return 0; };

        public static bool On { get { return Enabled && (Switch == null || Switch()); } }
        public static bool Busy { get { return Tracks.Count > 0; } }

        /// <summary>
        /// Runs <paramref name="apply"/> from 0 to 1 in <paramref name="seconds"/> after <paramref name="delay"/> (0 is applied at once, so the
        /// start state shows during the delay), then <paramref name="done"/>.
        /// </summary>
        public static void Run(object key, double seconds, double delay, double[][] curve, Action<double> apply, Action done = null)
        {
            if (key != null) Cancel(key);
            if (!On || seconds + delay <= 0) { apply(1); if (done != null) done(); return; }
            apply(0);
            double now = Efl.ecore_time_get();
            Tracks.Add(new Track { Key = key, Start = now, Delay = delay, Seconds = Math.Max(seconds, 0.001), Curve = curve, Apply = apply, Done = done });
            if (_animator == IntPtr.Zero) { _animator = Efl.ecore_animator_add(OnTick, IntPtr.Zero); Perf.AnimStart(now); }
            double due = now + delay + seconds + 0.3;
            if (_guard == IntPtr.Zero || due > _guardDue)
            {
                if (_guard != IntPtr.Zero) Efl.ecore_timer_del(_guard);
                _guardDue = due;
                _guard = Efl.ecore_timer_add(due - now, OnGuard, IntPtr.Zero);
            }
        }

        /// <summary>Drops the run with this key where it is (no last frame, no end action).</summary>
        public static void Cancel(object key)
        {
            if (key == null) return;
            for (int i = Tracks.Count - 1; i >= 0; i--) if (Equals(Tracks[i].Key, key)) { Tracks[i].Gone = true; Tracks.RemoveAt(i); }
        }

        /// <summary>Puts every run at its end at once (a key arrived, the tuner hides): last frames, end actions, then what waited for the end.</summary>
        public static void FinishAll()
        {
            int guard = 0;
            while (Tracks.Count > 0 && guard++ < 1000)
            {
                Track t = Tracks[0];
                Tracks.RemoveAt(0);
                t.Gone = true;
                t.Apply(1);
                if (t.Done != null) t.Done();
            }
            Stop();
            RunIdle();
        }

        /// <summary>Runs <paramref name="a"/> now, or when nothing moves any more.</summary>
        public static void WhenIdle(Action a)
        {
            if (!Busy) a(); else Idle.Add(a);
        }

        private static byte Tick()
        {
            _ticking = true;
            long t0 = Perf.On ? Perf.Now() : 0;
            double now = 0;
            try
            {
                now = Efl.ecore_time_get();
                Frame.Clear();
                Frame.AddRange(Tracks);
                for (int i = 0; i < Frame.Count; i++)
                {
                    Track t = Frame[i];
                    if (t.Gone) continue;                                         // cancelled by the end of another run
                    double p = (now - t.Start - t.Delay) / t.Seconds;
                    if (p >= 1) { Tracks.Remove(t); t.Gone = true; t.Apply(1); if (t.Done != null) t.Done(); }
                    else if (p > 0) t.Apply(Motion.At(t.Curve, p));
                }
            }
            finally { _ticking = false; Frame.Clear(); }
            if (Perf.On) Perf.AnimFrame(now, (Perf.Now() - t0) * 1000.0 / System.Diagnostics.Stopwatch.Frequency);
            if (Tracks.Count > 0) return 1;
            _animator = IntPtr.Zero;                                              // returning 0 deletes it
            Perf.AnimEnd(false);
            if (_guard != IntPtr.Zero) { Efl.ecore_timer_del(_guard); _guard = IntPtr.Zero; }
            RunIdle();
            return 0;
        }

        private static void Stop()
        {
            if (_animator != IntPtr.Zero && !_ticking) { Efl.ecore_animator_del(_animator); _animator = IntPtr.Zero; Perf.AnimEnd(true); }
            if (_guard != IntPtr.Zero) { Efl.ecore_timer_del(_guard); _guard = IntPtr.Zero; }
        }

        private static void RunIdle()
        {
            if (Idle.Count == 0) return;
            var list = Idle.ToArray();
            Idle.Clear();
            foreach (Action a in list) a();
        }
    }

    /// <summary>How a part shared by two views goes from one to the other (the mock-up's SHARE table).</summary>
    internal enum Fly
    {
        /// <summary>Same font, size and look: the arriving object moves from the leaving one's place (the leaving one hides).</summary>
        Move,
        /// <summary>A picture: moves and resizes.</summary>
        Box,
        /// <summary>Same font, another size: a uniform zoom (evas_map) of the larger of the two, so a text is never drawn enlarged.</summary>
        Map,
        /// <summary>Another font (the Banner's 200 number into the guide's 500): the larger flies zoomed; the two swap by a short cross-fade.</summary>
        MapX
    }

    /// <summary>A text or picture of a view that a transition can fly or fade: the object, its font size (0 for a picture), whether it has the halo.</summary>
    internal struct Part
    {
        public IntPtr Obj; public int Size; public bool Halo;
        public Part(IntPtr obj, int size, bool halo) { Obj = obj; Size = size; Halo = halo; }
    }

    /// <summary>A view the transitions know: its surface and its parts by name (the mock-up's data-key).</summary>
    internal interface IStage
    {
        Surface Surface { get; }
        IEnumerable<KeyValuePair<string, Part>> Parts { get; }
        /// <summary>True for a view of many objects (the guide): it fades in and out as one (its surface's alpha), not part by part.</summary>
        bool GroupFade { get; }
    }

    /// <summary>
    /// The transitions between the tuner's views (design/challenge/opus6, goTuner): the veil resizes on its own (<see cref="Veil"/>); the parts
    /// two views share fly from one place to the other; what only the leaving view has fades out, what only the arriving view has fades in.
    /// Use: <see cref="Capture"/> the leaving view before anything changes, hide it and draw the arriving one as usual, then <see cref="Morph"/>.
    /// Nothing is created: the leaving view's own objects fly, and get their colour, visibility and map back at the end.
    /// </summary>
    internal static class Choreo
    {
        public static readonly KeyValuePair<string, Fly>[] BannerInfo =
        {
            P("num", Fly.Map), P("name", Fly.Map), P("title", Fly.Map), P("logo", Fly.Box), P("track", Fly.Box), P("prog", Fly.Box),
            P("tstart", Fly.Move), P("tend", Fly.Move), P("tleft", Fly.Move)
        };
        public static readonly KeyValuePair<string, Fly>[] BannerGuide = { P("num", Fly.MapX), P("name", Fly.Map) };
        public static readonly KeyValuePair<string, Fly>[] GuideBanner = BannerGuide;

        private static KeyValuePair<string, Fly> P(string k, Fly f) { return new KeyValuePair<string, Fly>(k, f); }

        /// <summary>One part as it was: where, its colour, whether it was shown and had something to show.</summary>
        internal sealed class Snap
        {
            public Part P; public int X, Y, W, H, R, G, B, A; public bool Shown, Live;
        }

        /// <summary>A view as it was, part by part.</summary>
        internal sealed class Shot
        {
            public IStage Stage; public readonly Dictionary<string, Snap> Parts = new Dictionary<string, Snap>();
        }

        public static Shot Capture(IStage stage)
        {
            var shot = new Shot { Stage = stage };
            foreach (var kv in stage.Parts)
            {
                var s = new Snap { P = kv.Value };
                Efl.evas_object_geometry_get(kv.Value.Obj, out s.X, out s.Y, out s.W, out s.H);
                Efl.evas_object_color_get(kv.Value.Obj, out s.R, out s.G, out s.B, out s.A);
                s.Shown = Efl.evas_object_visible_get(kv.Value.Obj) != 0;
                s.Live = s.Shown && s.A > 0 && (kv.Value.Size == 0 || Efl.evas_object_text_horiz_advance_get(kv.Value.Obj) > 0);
                shot.Parts[kv.Key] = s;
            }
            return shot;
        }

        /// <param name="outSeconds">How long the leaving view's own parts take to fade (200 ms; 140 ms when the guide comes or goes).</param>
        public static void Morph(Shot from, IStage to, KeyValuePair<string, Fly>[] pairs, double outSeconds, double[][] outCurve)
        {
            IStage src = from.Stage;
            if (!Anim.On || src == to) return;
            Shot dst = Capture(to);
            double T = Motion.MorphSeconds, swap = Motion.SwapSeconds, enter = Motion.EnterDelay + Motion.Stagger;
            src.Surface.KeepDrawn();                       // logically hidden already; its parts still fly and fade
            to.Surface.Settle(to.GroupFade ? 0 : 255);
            var flownSrc = new HashSet<string>(); var flownDst = new HashSet<string>();

            foreach (var pair in pairs)
            {
                Snap a, b;
                if (!from.Parts.TryGetValue(pair.Key, out a) || !a.Live || !dst.Parts.TryGetValue(pair.Key, out b) || !b.Live) continue;
                flownSrc.Add(pair.Key); flownDst.Add(pair.Key);
                bool grow = b.P.Size > a.P.Size;
                switch (pair.Value)
                {
                    case Fly.Move:
                    case Fly.Box:
                        Efl.evas_object_hide(a.P.Obj);
                        bool box = pair.Value == Fly.Box;
                        Anim.Run(null, T, 0, Motion.Ease, p =>
                        {
                            Efl.evas_object_move(b.P.Obj, Motion.Lerp(a.X, b.X, p), Motion.Lerp(a.Y, b.Y, p));
                            if (box) Efl.evas_object_resize(b.P.Obj, Motion.Lerp(a.W, b.W, p), Motion.Lerp(a.H, b.H, p));
                            Colour(b, a, b, p);
                        });
                        break;
                    case Fly.Map:
                    case Fly.MapX:
                        bool cross = pair.Value == Fly.MapX;
                        if (grow)
                        {
                            // the arriving (larger) text starts at the leaving one's place and size and grows into its own
                            if (!cross) Efl.evas_object_hide(a.P.Obj);
                            Anim.Run(null, T, 0, Motion.Ease, p =>
                            {
                                { double x, y, w, h; Motion.FlyTo(a.X, a.Y, a.P.Size, b.X, b.Y, b.W, b.H, b.P.Size, p, out x, out y, out w, out h); MapTo(b, x, y, w, h); }
                                if (cross) Fade(b, b, p); else Colour(b, a, b, p);
                            }, () => Unmap(b.P.Obj));
                            if (cross) Anim.Run(null, outSeconds, 0, Motion.Linear, p => Fade(a, a, 1 - p));
                        }
                        else
                        {
                            // the leaving (larger) text flies, shrinking onto the arriving one, which shows at the end
                            Fade(b, b, 0);
                            Anim.Run(null, T, 0, Motion.Ease, p =>
                            {
                                { double x, y, w, h; Motion.FlyFrom(a.X, a.Y, a.W, a.H, a.P.Size, b.X, b.Y, b.P.Size, p, out x, out y, out w, out h); MapTo(a, x, y, w, h); }
                                if (!cross) Colour(a, a, b, p);
                            });
                            if (cross)
                            {
                                Anim.Run(null, swap, T - swap, Motion.Linear, p => Fade(a, a, 1 - p));
                                Anim.Run(null, swap, T - swap, Motion.Linear, p => Fade(b, b, p));
                            }
                            else Anim.Run(null, 0.001, T, Motion.Linear, p => { if (p >= 1) Fade(b, b, 1); });
                        }
                        break;
                }
            }

            // what only the leaving view has goes; what only the arriving view has comes
            if (src.GroupFade) src.Surface.Leave(outSeconds, outCurve);
            else foreach (var kv in from.Parts) if (kv.Value.Live && !flownSrc.Contains(kv.Key)) { Snap a = kv.Value; Anim.Run(null, outSeconds, 0, outCurve, p => Fade(a, a, 1 - p)); }
            if (to.GroupFade) to.Surface.Settle(0, Motion.FadeSeconds, enter);
            else foreach (var kv in dst.Parts) if (kv.Value.Live && !flownDst.Contains(kv.Key)) { Snap b = kv.Value; Anim.Run(null, Motion.FadeSeconds, enter, Motion.Linear, p => Fade(b, b, p)); }

            // the end: the leaving view's objects get back what they had; its surface goes unless it was shown again meanwhile
            Anim.Run(null, Math.Max(T, Math.Max(outSeconds, Motion.FadeSeconds + enter)), 0, Motion.Linear, p => { }, () =>
            {
                foreach (var kv in from.Parts)
                {
                    Snap a = kv.Value;
                    Unmap(a.P.Obj);
                    SetColour(a, a.R, a.G, a.B, a.A);
                    if (a.Shown) Efl.evas_object_show(a.P.Obj); else Efl.evas_object_hide(a.P.Obj);
                }
                if (!src.Surface.Visible) src.Surface.HideNow();
            });
        }

        /// <summary>The colour of <paramref name="s"/>'s object: from <paramref name="a"/>'s to <paramref name="b"/>'s at <paramref name="p"/>.</summary>
        private static void Colour(Snap s, Snap a, Snap b, double p)
        {
            SetColour(s, Motion.Lerp(a.R, b.R, p), Motion.Lerp(a.G, b.G, p), Motion.Lerp(a.B, b.B, p), Motion.Lerp(a.A, b.A, p));
        }

        /// <summary>The colour of <paramref name="s"/>'s object: <paramref name="c"/>'s colour at <paramref name="k"/> (0..1) of its strength.</summary>
        private static void Fade(Snap s, Snap c, double k)
        {
            SetColour(s, (int)Math.Round(c.R * k), (int)Math.Round(c.G * k), (int)Math.Round(c.B * k), (int)Math.Round(c.A * k));
        }

        private static void SetColour(Snap s, int r, int g, int b, int a)
        {
            Efl.evas_object_color_set(s.P.Obj, r, g, b, a);
            if (s.P.Halo) Efl.evas_object_text_shadow_color_set(s.P.Obj, 0, 0, 0, Theme.HaloAlpha * a / 255);
        }

        private static IntPtr _map;

        /// <summary>Draws <paramref name="s"/>'s object (its own geometry: the map's picture is all of it) into the rectangle (x, y, w, h).</summary>
        private static void MapTo(Snap s, double rx, double ry, double rw, double rh)
        {
            if (_map == IntPtr.Zero) _map = Efl.evas_map_new(4);
            Efl.evas_map_util_points_populate_from_geometry(_map, s.X, s.Y, s.W, s.H, 0);
            int x0 = (int)Math.Round(rx), y0 = (int)Math.Round(ry), x1 = (int)Math.Round(rx + rw), y1 = (int)Math.Round(ry + rh);
            Efl.evas_map_point_coord_set(_map, 0, x0, y0, 0);
            Efl.evas_map_point_coord_set(_map, 1, x1, y0, 0);
            Efl.evas_map_point_coord_set(_map, 2, x1, y1, 0);
            Efl.evas_map_point_coord_set(_map, 3, x0, y1, 0);
            Efl.evas_object_map_set(s.P.Obj, _map);
            Efl.evas_object_map_enable_set(s.P.Obj, true);
        }

        private static void Unmap(IntPtr obj)
        {
            Efl.evas_object_map_enable_set(obj, false);
            Efl.evas_object_map_set(obj, IntPtr.Zero);
        }
    }
}
