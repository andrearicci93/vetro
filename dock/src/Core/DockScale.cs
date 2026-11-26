using System;
using System.Globalization;

namespace Launcher.Core
{
    /// <summary>
    /// Size of the bar, from <c>--dock-scale &lt;percent&gt;</c> (100 to 150, default 100). Read from the process's own command line,
    /// not from Main's arguments, because the layout constants are static and may be touched before Main has parsed anything.
    /// </summary>
    internal static class DockScale
    {
        public const int Min = 100, Max = 150;
        public static readonly int Percent = Read(Environment.GetCommandLineArgs());

        internal static int Read(string[] args)
        {
            if (args == null) return Min;
            for (int i = 0; i + 1 < args.Length; i++)
            {
                if (args[i] != "--dock-scale") continue;
                int p;
                if (!int.TryParse(args[i + 1], NumberStyles.None, CultureInfo.InvariantCulture, out p)) return Min;
                return Math.Max(Min, Math.Min(Max, p));
            }
            return Min;
        }

        /// <summary>A length of the 100% design at the chosen size, rounded to the nearest pixel.</summary>
        public static int Px(int value) { return (value * Percent + 50) / 100; }
    }
}
