using System;
using Tuner.Core;

internal static partial class Tests
{
    private static bool Near(double a, double b) { return Math.Abs(a - b) < 1e-9; }

    private static void MotionChecks()
    {
        // the curves are straight stretches through the mock-up's points (EASE, IN)
        Check(Near(Motion.At(Motion.Ease, 0), 0) && Near(Motion.At(Motion.Ease, 1 / 3.0), 0.6) && Near(Motion.At(Motion.Ease, 2 / 3.0), 0.9) && Near(Motion.At(Motion.Ease, 1), 1), "ease: 0, .6 at a third, .9 at two thirds, 1");
        Check(Near(Motion.At(Motion.Ease, 1 / 6.0), 0.3) && Near(Motion.At(Motion.Ease, 0.5), 0.75) && Near(Motion.At(Motion.Ease, 5 / 6.0), 0.95), "ease: linear between the points");
        Check(Near(Motion.At(Motion.In, 0.5), 0.25) && Near(Motion.At(Motion.In, 0.25), 0.125) && Near(Motion.At(Motion.In, 0.75), 0.625), "in: slow start (.25 at half time), then linear to 1");
        Check(Near(Motion.At(Motion.Linear, 0.4), 0.4), "linear is the identity");
        Check(Motion.At(Motion.Ease, -1) == 0 && Motion.At(Motion.Ease, 2) == 1, "before the start 0, after the end 1");
        bool monotone = true; double last = -1;
        foreach (double[][] c in new[] { Motion.Ease, Motion.In, Motion.Linear })
        {
            last = -1;
            for (int i = 0; i <= 100; i++) { double v = Motion.At(c, i / 100.0); if (v < last - 1e-12) monotone = false; last = v; }
        }
        Check(monotone, "every curve only goes forward");

        // a run's progress in time: the delay holds it at 0, a zero duration is the end at once (reduced motion)
        Check(Motion.Progress(Motion.Linear, 10, 0.06, 0.2, 10.03) == 0 && Near(Motion.Progress(Motion.Linear, 10, 0.06, 0.2, 10.16), 0.5) && Motion.Progress(Motion.Linear, 10, 0.06, 0.2, 11) == 1, "progress: waits for the delay, then runs, then stays at 1");
        Check(Motion.Progress(Motion.Ease, 10, 0, 0, 10) == 1, "progress: no duration means the end at once");
        Check(Near(Motion.Progress(Motion.Ease, 0, 0, Motion.VeilSeconds, Motion.VeilSeconds / 2), 0.75), "the veil is three quarters there at half its 320 ms");

        // flights between text sizes: the larger text is the one drawn zoomed (down), and both ends land exactly
        double[] s0 = Motion.FlyFrom(96, 790, 80, 152, 128, 166, 520, 24, 0), s1 = Motion.FlyFrom(96, 790, 80, 152, 128, 166, 520, 24, 1);
        Check(Near(s0[0], 96) && Near(s0[1], 790) && Near(s0[2], 80) && Near(s0[3], 152), "fly from: starts on the leaving text, at its size");
        Check(Near(s1[0], 166) && Near(s1[1], 520) && Near(s1[2], 80 * 24 / 128.0) && Near(s1[3], 152 * 24 / 128.0), "fly from: lands on the other text's corner, zoomed to the other's size");
        double[] g0 = Motion.FlyTo(166, 520, 24, 96, 790, 80, 152, 128, 0), g1 = Motion.FlyTo(166, 520, 24, 96, 790, 80, 152, 128, 1);
        Check(Near(g0[0], 166) && Near(g0[1], 520) && Near(g0[2], 80 * 24 / 128.0), "fly to: the arriving text starts on the other's corner at the other's size");
        Check(Near(g1[0], 96) && Near(g1[1], 790) && Near(g1[2], 80) && Near(g1[3], 152), "fly to: and ends unzoomed in its own place");
        double[] mid = Motion.FlyFrom(0, 0, 100, 100, 64, 100, 100, 32, 0.5);
        Check(Near(mid[2], 75) && Near(mid[0], 50), "a flight halfway: half the way, half the zoom");
        Check(Motion.Lerp(148, 168, 0.5) == 158 && Motion.Lerp(0, 255, 1) == 255, "integer lerp (veil alpha .58 -> .66)");
    }
}
