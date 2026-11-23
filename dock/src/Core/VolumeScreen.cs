using System;
using System.Globalization;
using System.Text.RegularExpressions;

namespace Launcher.Core
{
    /// <summary>Samsung can centre a 1920-wide UI on a wider output without reporting that output to EFL.</summary>
    internal static class VolumeScreen
    {
        public static int HorizontalOffset(VolumeEdge edge, int screenW, string windowInfo)
        {
            if (edge != VolumeEdge.Left && edge != VolumeEdge.Right) return 0;
            // Only compensate the verified pair of transforms: horizontal output scaling followed by
            // inverse scaling and centring. Unknown firmware, multiple transforms and ordinary TVs fall back.
            if (!Regex.IsMatch(windowInfo ?? "", @"Transform\s*:\s*transform count:\s*2\b")) return 0;
            var scale = Transform(windowInfo, "base_output_resolution");
            var align = Transform(windowInfo, "alignment_for_base_outp");
            if (!scale.Success || !align.Success) return 0;
            double sx = Number(scale, 3), inverse = Number(align, 3);
            int offset = (int)Number(align, 1);
            if (screenW <= 0 || sx <= 1 || sx > 4 || offset <= 0 ||
                Number(scale, 1) != 0 || Number(scale, 2) != 0 || Number(align, 2) != 0 ||
                Number(scale, 4) != 1 || Number(align, 4) != 1 ||
                Math.Abs(sx * inverse - 1) > 0.005 ||
                Math.Abs(offset - screenW * (sx - 1) / 2) > 1) return 0;
            return edge == VolumeEdge.Left ? -offset : offset;
        }

        private static Match Transform(string text, string role)
        {
            return Regex.Match(text, @"\[\s*" + role + @"\s*\]\s*\[\s*(-?\d+),\s*(-?\d+)\]\s*\[\s*([\d.]+),\s*([\d.]+)\]\s*\[\s*0\s*\]");
        }

        private static double Number(Match m, int group)
        {
            double n;
            return double.TryParse(m.Groups[group].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out n) ? n : double.NaN;
        }
    }
}
