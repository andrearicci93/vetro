using System;
using Tuner.Core;

internal static partial class Tests
{
    /// <summary>Text placement with the metrics Evas uses on the TV (Core/TextMetrics.cs), checked against screen dumps of the Q80A.</summary>
    private static void TextMetricsTests()
    {
        foreach (string f in new[] { TextMetrics.Font200, TextMetrics.Font500, TextMetrics.Font600 })
            Check(f.IndexOf(',') < 0 && f.IndexOf(':') < 0, "text: a font is one family name, no fallback list (Evas gives the whole string to fontconfig): " + f);

        Check(TextMetrics.Ascent(128) == 131 && TextMetrics.Ascent(32) == 33 && TextMetrics.Ascent(26) == 27, "text: Evas's max ascent comes from head.yMax 1047, not hhea 952");
        Check(TextMetrics.LineHeight(26) == 27 + 8, "text: the vertical advance is max ascent + max descent (head.yMin 304)");

        // Q80A, 2026-11-11, the first opus6 build (objects placed with hhea 952): object y, size, baseline seen in the screen dump (bottom of the
        // capitals and digits). Evas drew them at y + 1 (soft shadow) + max ascent, within one pixel of the dump.
        int[,] seen = { { 798, 128, 930 }, { 816, 56, 874 }, { 887, 32, 920 }, { 944, 26, 972 }, { 576, 64, 642 }, { 603, 36, 641 }, { 665, 72, 741 }, { 767, 88, 858 }, { 863, 30, 895 } };
        for (int i = 0; i < seen.GetLength(0); i++)
        {
            int drawn = TextMetrics.DrawnBaseline(seen[i, 0], seen[i, 1], TextMetrics.HaloPad);
            Check(Math.Abs(drawn - seen[i, 2]) <= 2, "text: the model matches the Q80A's dump within 2 px at " + seen[i, 1] + " px (model " + drawn + ", dump " + seen[i, 2] + ")");
        }

        // The Banner's number (128, weight 200) stands on the programme title's baseline (32), both with the halo.
        double title = TextMetrics.Baseline(890, 32);
        int numY = TextMetrics.TopFor(title, 128, TextMetrics.HaloPad), titleY = TextMetrics.TopOf(890, 32, TextMetrics.HaloPad);
        Check(Math.Abs(TextMetrics.DrawnBaseline(numY, 128, 1) - TextMetrics.DrawnBaseline(titleY, 32, 1)) <= 1, "text: the Banner's number and title share a baseline on the TV");
        Check(Math.Abs(TextMetrics.DrawnBaseline(titleY, 32, 1) - title) <= 0.5, "text: the title lands on the mock-up's baseline");

        // Capitals centred in a box: the cap height's middle is the box's middle.
        int y = TextMetrics.TopForCentre(100, 76, 40);
        double capMid = TextMetrics.DrawnBaseline(y, 40) - TextMetrics.CapHeight * 40.0 / TextMetrics.Em / 2;
        Check(Math.Abs(capMid - 138) <= 0.5, "text: capitals centred in a key");
    }
}
