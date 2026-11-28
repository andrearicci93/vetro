using System;
using System.Collections.Generic;
using System.Globalization;

namespace Tuner.Core
{
    /// <summary>
    /// Pure logic for native overlay brightness and automatic HDR dimming (OLED burn-in protection):
    /// direct RGB luminance multiplier (20%-100% -> 0.20-1.00) for base (SDR) and HDR overlays,
    /// premultiplied RGBA channel scaling, and avocd D-Bus GetHdrStatus / HdrModeChanged parsing.
    /// </summary>
    internal static class HdrDim
    {
        public const int MinBrightness = 20;
        public const int MaxBrightness = 100;
        public const int DefaultBaseBrightness = 100;
        public const int DefaultBrightness = 60;
        public const int BrightnessStep = 10;

        public static int NormalizeBrightness(int value)
        {
            if (value < MinBrightness) return MinBrightness;
            if (value > MaxBrightness) return MaxBrightness;
            return value;
        }

        public static int ParseBrightness(string raw, int fallback = DefaultBrightness)
        {
            if (string.IsNullOrWhiteSpace(raw)) return fallback;
            int value;
            if (!int.TryParse(raw.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out value))
                return fallback;
            return NormalizeBrightness(value);
        }

        public static int ParseBaseBrightness(string raw)
        {
            return ParseBrightness(raw, DefaultBaseBrightness);
        }

        /// <summary>
        /// Direct RGB luminance multiplier in [0.20, 1.00].
        /// Uses <paramref name="baseBrightness"/> outside HDR (or when HDR dimming is off),
        /// and <c>min(baseBrightness, brightness)</c> during HDR so HDR overlays never brighten past SDR.
        /// </summary>
        public static double Factor(bool enabled, bool isHdr, int brightness, int baseBrightness = MaxBrightness)
        {
            int basePct = NormalizeBrightness(baseBrightness);
            int effective = (enabled && isHdr) ? Math.Min(basePct, NormalizeBrightness(brightness)) : basePct;
            return effective >= MaxBrightness ? 1.0 : effective / 100.0;
        }

        /// <summary>Scales a premultiplied RGB channel by <paramref name="factor"/> while keeping alpha unchanged.</summary>
        public static int Channel(int alpha, double factor)
        {
            int a = Math.Max(0, Math.Min(255, alpha));
            if (double.IsNaN(factor) || double.IsInfinity(factor)) return a;
            double f = Math.Max(0.0, Math.Min(1.0, factor));
            int scaled = (int)Math.Round(a * f);
            return Math.Max(0, Math.Min(a, scaled));
        }

        /// <summary>
        /// Parses <c>busctl ... GetHdrStatus</c> ("ii 1 0" / "ii 0 0") or
        /// <c>dbus-send --print-reply=literal ... GetHdrStatus</c> ("int32 1\n int32 0").
        /// Returns null when the reply is missing, malformed, or has non-zero status code.
        /// </summary>
        public static bool? ParseStatus(string output)
        {
            if (string.IsNullOrWhiteSpace(output)) return null;
            var ints = new List<int>();
            string[] tokens = output.Split((char[])null, StringSplitOptions.RemoveEmptyEntries);
            for (int i = 0; i < tokens.Length; i++)
            {
                string tok = tokens[i];
                if (tok == "int32" || tok == "uint32")
                {
                    if (i + 1 < tokens.Length)
                    {
                        int v;
                        if (int.TryParse(tokens[i + 1], NumberStyles.Integer, CultureInfo.InvariantCulture, out v))
                        {
                            ints.Add(v);
                            i++;
                        }
                    }
                    continue;
                }
                int n;
                if (int.TryParse(tok, NumberStyles.Integer, CultureInfo.InvariantCulture, out n))
                    ints.Add(n);
            }
            if (ints.Count < 2) return null;
            int status = ints[ints.Count - 2];
            int rc = ints[ints.Count - 1];
            if (rc != 0) return null;
            return status != 0;
        }

        /// <summary>True when a dbus-monitor stdout line reports avocd's HdrModeChanged signal.</summary>
        public static bool IsHdrSignalLine(string line)
        {
            return !string.IsNullOrEmpty(line) && line.IndexOf("member=HdrModeChanged", StringComparison.Ordinal) >= 0;
        }
    }
}
