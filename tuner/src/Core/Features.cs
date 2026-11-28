using System;
using System.Collections.Generic;
using System.IO;

namespace Tuner.Core
{
    /// <summary>
    /// Switches for the parts of the tuner, for testing them one at a time. The dashboard writes a small text file ("name=0" turns a part off,
    /// anything not listed is on); it is read again about every half second, so a switch takes effect without restarting the tuner.
    /// A missing or unreadable file means everything is on.
    /// </summary>
    internal sealed class Features
    {
        public static readonly string[] Names = { "banner", "list", "guide", "pad", "info", "audio", "hold", "logos", "motion", "focus" };

        private readonly string _path;
        private readonly Func<long> _clock;
        private HashSet<string> _off = new HashSet<string>();
        private bool? _hdrDimOverride;
        private int? _hdrBrightnessOverride;
        private int? _uiBrightnessOverride;
        private long _readAt = long.MinValue;

        public Features(string path, Func<long> clock = null) { _path = path; _clock = clock ?? (() => Environment.TickCount64); }

        public bool HdrDimEnabled { get { Refresh(); return _hdrDimOverride ?? false; } }
        public int HdrBrightness { get { Refresh(); return _hdrBrightnessOverride ?? HdrDim.DefaultBrightness; } }
        public int UiBrightness { get { Refresh(); return _uiBrightnessOverride ?? HdrDim.DefaultBaseBrightness; } }
        public bool? HdrDimOverride { get { Refresh(); return _hdrDimOverride; } }
        public int? HdrBrightnessOverride { get { Refresh(); return _hdrBrightnessOverride; } }
        public int? UiBrightnessOverride { get { Refresh(); return _uiBrightnessOverride; } }

        public static HashSet<string> Parse(string text)
        {
            var off = new HashSet<string>();
            if (text == null) return off;
            foreach (string raw in text.Split('\n'))
            {
                string line = raw.Trim();
                int eq = line.IndexOf('=');
                if (eq <= 0) continue;
                string name = line.Substring(0, eq).Trim();
                if (line.Substring(eq + 1).Trim() == "0" && Array.IndexOf(Names, name) >= 0) off.Add(name);
            }
            return off;
        }

        public static void ParseHdrConfig(string text, out bool enabled, out int brightness)
        {
            bool? ovEnabled;
            int? ovBrightness;
            int? ovUiBrightness;
            ParseHdrConfig(text, out ovEnabled, out ovBrightness, out ovUiBrightness);
            enabled = ovEnabled ?? false;
            brightness = ovBrightness ?? HdrDim.DefaultBrightness;
        }

        public static void ParseHdrConfig(string text, out bool? enabled, out int? brightness)
        {
            int? ovUiBrightness;
            ParseHdrConfig(text, out enabled, out brightness, out ovUiBrightness);
        }

        public static void ParseHdrConfig(string text, out bool? enabled, out int? brightness, out int? uiBrightness)
        {
            enabled = null;
            brightness = null;
            uiBrightness = null;
            if (text == null) return;
            foreach (string raw in text.Split('\n'))
            {
                string line = raw.Trim();
                int eq = line.IndexOf('=');
                if (eq <= 0) continue;
                string name = line.Substring(0, eq).Trim();
                string val = line.Substring(eq + 1).Trim();
                if (name == "hdr_dim") enabled = val == "1";
                else if (name == "hdr_brightness") brightness = HdrDim.ParseBrightness(val);
                else if (name == "ui_brightness") uiBrightness = HdrDim.ParseBaseBrightness(val);
            }
        }

        private void Refresh()
        {
            if (_path == null) return;
            long now = _clock();
            if (_readAt == long.MinValue || now - _readAt >= 500 || now < _readAt)
            {
                _readAt = now;
                try
                {
                    string text = File.Exists(_path) ? File.ReadAllText(_path) : null;
                    _off = Parse(text);
                    ParseHdrConfig(text, out _hdrDimOverride, out _hdrBrightnessOverride, out _uiBrightnessOverride);
                }
                catch (Exception)
                {
                    _off = new HashSet<string>();
                    _hdrDimOverride = null;
                    _hdrBrightnessOverride = null;
                    _uiBrightnessOverride = null;
                }
            }
        }

        public bool On(string name)
        {
            if (_path == null) return true;
            Refresh();
            return !_off.Contains(name);
        }
    }
}
