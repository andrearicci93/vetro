using System;
using Tuner.Core;

internal static partial class Tests
{
    /// <summary>The progress row of the Banner and Info: the head, the progress picture, and "N min left" with the time that gives way to it.</summary>
    private static void ProgressRowTests()
    {
        const int x0 = 96, x1 = 936, startW = 60, endW = 64, leftW = 124;
        ProgressRow r = ProgressRow.Of(x0, x1, 0.5, startW, endW, leftW);
        Check(r.HeadX == 516 && r.ProgressW == 516 - x0 + 16, "progress: the head sits on the point reached, the picture ends 16 px past it");
        Check(r.LeftX == 516 - 62 && !r.HideStart && !r.HideEnd, "progress: in the middle the label is centred on the head and both times stay");

        r = ProgressRow.Of(x0, x1, 0.98, startW, endW, leftW);
        Check(r.HideEnd && !r.HideStart, "progress: near the end the end time gives way to the label");
        Check(r.LeftX == x1 - leftW, "progress: near the end the label stops at the end of the line");

        r = ProgressRow.Of(x0, x1, 0.02, startW, endW, leftW);
        Check(r.HideStart && !r.HideEnd, "progress: near the start the start time gives way to the label");
        Check(r.LeftX == x0, "progress: near the start the label stops at the start of the line");

        r = ProgressRow.Of(x0, x1, 0, startW, endW, leftW);
        Check(r.HeadX == x0 && r.ProgressW == ProgressRow.MinWidth, "progress: at 0% the picture keeps its own width (the head whole)");
        r = ProgressRow.Of(x0, x1, 1.7, startW, endW, leftW);
        Check(r.HeadX == x1, "progress: a fraction past 1 is held at the end");
        r = ProgressRow.Of(x0, x1, double.NaN, startW, endW, leftW);
        Check(r.HeadX == x0, "progress: an unusable fraction counts as 0");

        r = ProgressRow.Of(x0, x1, 0.99, startW, endW, 0);
        Check(!r.HideStart && !r.HideEnd, "progress: with no label nothing gives way");

        // Every point of the line: the label never overlaps a time on screen and never comes closer than the gap; it never leaves the line.
        bool ok = true;
        for (int i = 0; i <= 1000; i++)
        {
            r = ProgressRow.Of(x0, x1, i / 1000.0, startW, endW, leftW);
            if (r.HideStart && r.HideEnd) ok = false;
            if (!r.HideStart && r.LeftX < x0 + startW + ProgressRow.Gap) ok = false;
            if (!r.HideEnd && r.LeftX + leftW > x1 - endW - ProgressRow.Gap) ok = false;
            if (r.LeftX < x0 || r.LeftX + leftW > x1) ok = false;
        }
        Check(ok, "progress: at every point the label keeps the gap from the times it leaves on screen and stays on the line");
    }
}
