using System;

namespace Tuner.Core
{
    /// <summary>
    /// Where the pieces of a programme's progress row go (the Banner and Info share it): the start time at the left end of the line, the end time
    /// at the right end, the progress picture whose round head sits on the point reached, and "N min left" above the head. When the label comes
    /// within <see cref="Gap"/> pixels of one of the times, that time gives way (it is hidden) and the label may slide up to the end of the line:
    /// the label and a time never overlap and never touch. Pure numbers, so it can be checked without the TV.
    /// </summary>
    internal struct ProgressRow
    {
        /// <summary>The smallest space between the label and a time that stays on screen.</summary>
        public const int Gap = 28;

        /// <summary>progress.png: the head is the right part of the picture (32 px wide), its centre 16 px from the right edge; 40 px is the picture itself.</summary>
        public const int HeadCentre = 16, MinWidth = 40;

        public int HeadX;          // the point reached on the line
        public int ProgressW;      // width of the progress picture, drawn from the start of the line
        public int LeftX;          // left edge of "N min left"
        public bool HideStart, HideEnd;

        /// <param name="x0">Left end of the line (and of the start time).</param>
        /// <param name="x1">Right end of the line (and of the end time, which is right-aligned to it).</param>
        /// <param name="fraction">How far the programme is, 0..1 (clamped).</param>
        /// <param name="startW">Width of the start time.</param>
        /// <param name="endW">Width of the end time.</param>
        /// <param name="leftW">Width of the "N min left" label; 0 when there is none, and then nothing gives way.</param>
        public static ProgressRow Of(int x0, int x1, double fraction, int startW, int endW, int leftW)
        {
            double f = double.IsNaN(fraction) ? 0 : Math.Max(0, Math.Min(1, fraction));
            var r = new ProgressRow();
            r.HeadX = Round(x0 + (x1 - x0) * f);
            r.ProgressW = Math.Max(MinWidth, r.HeadX - x0 + HeadCentre);
            if (leftW <= 0) { r.LeftX = r.HeadX; return r; }
            double ideal = r.HeadX - leftW / 2.0, x;
            if (ideal > x1 - endW - Gap - leftW) { r.HideEnd = true; x = Math.Min(ideal, x1 - leftW); }
            else if (ideal < x0 + startW + Gap) { r.HideStart = true; x = Math.Max(ideal, x0); }
            else x = ideal;
            r.LeftX = Round(x);
            return r;
        }

        private static int Round(double v) { return (int)Math.Floor(v + 0.5); }   // halves up, as the mock-up's Math.round
    }
}
