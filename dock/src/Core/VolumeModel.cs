using System;

namespace Launcher.Core
{
    /// <summary>What a volume key does and how the pill shows it. Pure, so it is tested without a TV.</summary>
    internal static class VolumeModel
    {
        public const int Max = 100;

        /// <summary>The level after one key press (dir +1 or -1), kept inside 0..100.</summary>
        public static int Next(int current, int dir, int step)
        {
            int next = current + (dir < 0 ? -step : step);
            return Math.Max(0, Math.Min(Max, next));
        }

        /// <summary>Which speaker picture: 0 muted or silent, 1 low, 2 loud.</summary>
        public static int IconLevel(int volume, bool muted)
        {
            if (muted || volume <= 0) return 0;
            return volume < 40 ? 1 : 2;
        }

        /// <summary>Height of the level inside a track of <paramref name="track"/> px: proportional, so a low level is a low fill (3 px at 1 of 100 on a 280 px track).</summary>
        public static int FillHeight(int volume, bool muted, int track)
        {
            if (muted || volume <= 0) return 0;
            return Math.Max(1, Math.Min(track, (int)Math.Round(track * (double)Math.Min(volume, Max) / Max)));
        }
    }
}
