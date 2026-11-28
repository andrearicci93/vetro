using System;
using System.Collections.Generic;
using System.Globalization;

namespace Launcher.Core
{
    /// <summary>
    /// Pure logic for automatic HDR overlay dimming (OLED burn-in protection):
    /// brightness curve (ported from NuvioTVSmart, 0-100% -> 30%-100% RGB luminance),
    /// premultiplied RGBA channel scaling, and avocd D-Bus GetHdrStatus / HdrModeChanged parsing.
    /// </summary>
    internal static class HdrDim
    {
        public const int MinBrightness = 0;
        public const int MaxBrightness = 100;
        public const int DefaultBrightness = 40;
        public const int BrightnessStep = 10;
        public const double FadeSeconds = 0.24;

        public static double EaseOutCubic(double t)
        {
            double clamped = Math.Max(0.0, Math.Min(1.0, t));
            double u = 1.0 - clamped;
            return 1.0 - u * u * u;
        }

        public static double Lerp(double from, double to, double t)
        {
            double clamped = Math.Max(0.0, Math.Min(1.0, t));
            return from + (to - from) * clamped;
        }

        public static bool TryParseCommandArgs(string args, out bool enabled, out int brightness)
        {
            enabled = false;
            brightness = DefaultBrightness;
            if (string.IsNullOrWhiteSpace(args)) return false;
            string[] parts = args.Trim().Split((char[])null, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length != 2) return false;
            if (parts[0] == "1") enabled = true;
            else if (parts[0] == "0") enabled = false;
            else return false;
            int value;
            if (!int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out value)) return false;
            if (value < MinBrightness || value > MaxBrightness) return false;
            brightness = value;
            return true;
        }

        public static int NormalizeBrightness(int value)
        {
            if (value < MinBrightness) return MinBrightness;
            if (value > MaxBrightness) return MaxBrightness;
            return value;
        }

        public static int ParseBrightness(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return DefaultBrightness;
            int value;
            if (!int.TryParse(raw.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out value))
                return DefaultBrightness;
            return NormalizeBrightness(value);
        }

        /// <summary>
        /// RGB luminance multiplier in [0.30, 1.00] when HDR dimming is active; 1.0 otherwise.
        /// Maps 0..100 onto 30%..100% so 0% still keeps overlays readable.
        /// </summary>
        public static double Factor(bool enabled, bool isHdr, int brightness)
        {
            if (!enabled || !isHdr) return 1.0;
            return (0.7 * NormalizeBrightness(brightness) + 30.0) / 100.0;
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
