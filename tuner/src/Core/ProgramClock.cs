using System;

namespace Tuner.Core
{
    /// <summary>The running time of a broadcast programme: where it is now, and how it reads on the banner. Times are Unix seconds (UTC).</summary>
    internal static class ProgramClock
    {
        /// <summary>0..1 of the programme that has been on air at <paramref name="now"/>; null when the data cannot be right.</summary>
        public static double? Fraction(long start, long duration, long now)
        {
            if (start <= 0 || duration <= 0) return null;
            if (now < start || now > start + duration) return null;   // stale: the programme on the screen is not this one
            return (double)(now - start) / duration;
        }

        /// <summary>"21:20 - 01:03" in the given offset from UTC (the caller passes the TV's local offset).</summary>
        public static string Range(long start, long duration, TimeSpan offset)
        {
            return Clock(start, offset) + " - " + Clock(start + duration, offset);
        }

        public static string Clock(long unix, TimeSpan offset)
        {
            return DateTimeOffset.FromUnixTimeSeconds(unix).ToOffset(offset).ToString("HH:mm");
        }

        /// <summary>"1 h 12 min left" or "35 min left"; empty when nothing is left or the data is unusable.</summary>
        public static string Remaining(long start, long duration, long now)
        {
            if (Fraction(start, duration, now) == null) return "";
            long left = (start + duration - now + 30) / 60;   // minutes, rounded
            if (left <= 0) return "";
            return left >= 60 ? (left / 60) + " h " + (left % 60) + " min left" : left + " min left";
        }
    }
}
