using System;

namespace Tuner.Core
{
    /// <summary>
    /// The tuner's motion (design/challenge/opus6, "coreografia del tuner"): only position, size, alpha and a uniform evas_map zoom move, and
    /// every curve is a few straight stretches (no per-frame easing function): <see cref="Ease"/> is fast then slow, <see cref="In"/> slow then
    /// fast (things going away). The numbers are the mock-up's (D in body.html). Pure: the animator in Ui/Anim.cs runs it.
    /// </summary>
    internal static class Motion
    {
        /// <summary>(time, progress) points, linear between them.</summary>
        public static readonly double[][] Ease = { new[] { 0.0, 0.0 }, new[] { 1 / 3.0, 0.6 }, new[] { 2 / 3.0, 0.9 }, new[] { 1.0, 1.0 } };
        public static readonly double[][] In = { new[] { 0.0, 0.0 }, new[] { 0.5, 0.25 }, new[] { 1.0, 1.0 } };
        public static readonly double[][] Linear = { new[] { 0.0, 0.0 }, new[] { 1.0, 1.0 } };

        /// <summary>The veil and the shared elements (320 ms); entering and leaving (200 ms, after a 60 ms wait, plus 40 ms for a second group);
        /// what leaves when the guide comes or goes (140 ms); the cross-fade at the end of a flight between two fonts (80 ms).</summary>
        public const double VeilSeconds = 0.32, MorphSeconds = 0.32, FadeSeconds = 0.20, EnterDelay = 0.06, Stagger = 0.04, GuideOutSeconds = 0.14, SwapSeconds = 0.08;

        /// <summary>The progress (0..1) of a curve at time <paramref name="t"/> (0..1, clamped).</summary>
        public static double At(double[][] curve, double t)
        {
            if (t <= 0) return 0;
            if (t >= 1) return 1;
            for (int i = 1; i < curve.Length; i++)
            {
                double t0 = curve[i - 1][0], t1 = curve[i][0];
                if (t <= t1) return curve[i - 1][1] + (curve[i][1] - curve[i - 1][1]) * (t1 > t0 ? (t - t0) / (t1 - t0) : 1);
            }
            return 1;
        }

        /// <summary>The progress of a run that started at <paramref name="start"/> (seconds) after <paramref name="delay"/>, at time <paramref name="now"/>; 1 when the duration is 0.</summary>
        public static double Progress(double[][] curve, double start, double delay, double seconds, double now)
        {
            if (seconds <= 0) return 1;
            return At(curve, (now - start - delay) / seconds);
        }

        public static int Lerp(int a, int b, double p) { return (int)Math.Round(a + (b - a) * p); }
        public static double Lerp(double a, double b, double p) { return a + (b - a) * p; }

        /// <summary>
        /// The rectangle a text of size <paramref name="fromSize"/> is mapped onto, at progress <paramref name="p"/> of a flight from its own place
        /// (<paramref name="ax"/>, <paramref name="ay"/>, its own <paramref name="w"/> x <paramref name="h"/>) to the place of the text it becomes
        /// (<paramref name="bx"/>, <paramref name="by"/>, size <paramref name="toSize"/>): a uniform zoom about the top-left corner, so it lands on
        /// the other's top-left at the other's size. Returns x, y, w, h.
        /// </summary>
        public static double[] FlyFrom(int ax, int ay, int w, int h, int fromSize, int bx, int by, int toSize, double p)
        {
            double x, y, rw, rh;
            FlyFrom(ax, ay, w, h, fromSize, bx, by, toSize, p, out x, out y, out rw, out rh);
            return new[] { x, y, rw, rh };
        }

        /// <summary><see cref="FlyFrom(int, int, int, int, int, int, int, int, double)"/> without an array: the animator calls it every frame.</summary>
        public static void FlyFrom(int ax, int ay, int w, int h, int fromSize, int bx, int by, int toSize, double p, out double x, out double y, out double rw, out double rh)
        {
            double s = Lerp(1.0, (double)toSize / fromSize, p);
            x = Lerp(ax, bx, p); y = Lerp(ay, by, p); rw = w * s; rh = h * s;
        }

        /// <summary>
        /// The other way round: the text that arrives (its own place <paramref name="bx"/>, <paramref name="by"/>, size <paramref name="w"/> x
        /// <paramref name="h"/>, font size <paramref name="toSize"/>) starts where the one it replaces was (<paramref name="ax"/>, <paramref name="ay"/>,
        /// font size <paramref name="fromSize"/>) at that one's size, and grows into its own place. Returns x, y, w, h.
        /// </summary>
        public static double[] FlyTo(int ax, int ay, int fromSize, int bx, int by, int w, int h, int toSize, double p)
        {
            double x, y, rw, rh;
            FlyTo(ax, ay, fromSize, bx, by, w, h, toSize, p, out x, out y, out rw, out rh);
            return new[] { x, y, rw, rh };
        }

        /// <summary><see cref="FlyTo(int, int, int, int, int, int, int, int, double)"/> without an array: the animator calls it every frame.</summary>
        public static void FlyTo(int ax, int ay, int fromSize, int bx, int by, int w, int h, int toSize, double p, out double x, out double y, out double rw, out double rh)
        {
            double s = Lerp((double)fromSize / toSize, 1.0, p);
            x = Lerp(ax, bx, p); y = Lerp(ay, by, p); rw = w * s; rh = h * s;
        }
    }
}
