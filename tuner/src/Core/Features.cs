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
        public static readonly string[] Names = { "banner", "list", "guide", "pad", "info", "audio", "hold" };

        private readonly string _path;
        private readonly Func<long> _clock;
        private HashSet<string> _off = new HashSet<string>();
        private long _readAt = long.MinValue;

        public Features(string path, Func<long> clock = null) { _path = path; _clock = clock ?? (() => Environment.TickCount64); }

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

        public bool On(string name)
        {
            if (_path == null) return true;
            long now = _clock();
            if (now - _readAt >= 500 || now < _readAt)
            {
                _readAt = now;
                try { _off = Parse(File.Exists(_path) ? File.ReadAllText(_path) : null); } catch (Exception) { _off = new HashSet<string>(); }
            }
            return !_off.Contains(name);
        }
    }
}
