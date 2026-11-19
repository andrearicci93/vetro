using System;
using System.Collections.Generic;

namespace Launcher.Core
{
    /// <summary>An icon finished by <see cref="IconPrep"/>: <see cref="Side"/> x <see cref="Side"/> premultiplied ARGB pixels, never changed once made.</summary>
    internal sealed class PreparedIcon
    {
        public readonly uint[] Pixels;
        public readonly int Side;
        /// <summary>The glow colour taken from the icon (0xRRGGBB), or -1: none, or not asked for (the Task manager has no glow).</summary>
        public readonly int Hue;

        public PreparedIcon(uint[] pixels, int side, int hue) { Pixels = pixels; Side = side; Hue = hue; }
    }

    /// <summary>
    /// The registry icons already finished, so a page made again (a list reload, a tile taken out of the row) only copies their pixels into
    /// its new image objects: decoding the PNG and running IconPrep again for every icon took 510-680 ms of the main loop on a TV for about
    /// 28 icons. An icon is known by its file, the file's date and length (an app update that writes a new icon at the same path is read
    /// again) and the side it is finished at (the Task manager asks for a smaller one than the dock).
    /// What is kept: whatever was asked for, stored or kept (<see cref="Keep"/>) since the last <see cref="Sweep"/>. The launcher sweeps after
    /// each build of the pages, once the pages and rows still on screen have kept theirs, so an app gone from every page goes from here too.
    /// <see cref="MaxEntries"/> bounds it between two sweeps (the Task manager adds a row's icon whenever an app starts).
    /// </summary>
    internal sealed class IconCache
    {
        /// <summary>About 6 MB at most of dock icons (112 x 112 x 4 bytes each): more than the three pages and the Task manager show on a TV.</summary>
        public const int DefaultMax = 128;

        private sealed class Entry
        {
            public PreparedIcon Icon;
            public int Used;   // the sweep round it was last used in
        }

        private readonly Dictionary<string, Entry> _map = new Dictionary<string, Entry>(StringComparer.Ordinal);
        private int _round;

        public IconCache(int maxEntries)
        {
            if (maxEntries < 1) throw new ArgumentOutOfRangeException("maxEntries");
            MaxEntries = maxEntries;
        }

        public int MaxEntries { get; private set; }
        public int Count { get { return _map.Count; } }

        /// <summary>The key of a file finished at <paramref name="maxSide"/>; null without a path.</summary>
        public static string Key(string path, long mtimeTicks, long length, int maxSide)
        {
            if (string.IsNullOrEmpty(path)) return null;
            return path + "|" + mtimeTicks.ToString(System.Globalization.CultureInfo.InvariantCulture) + "|" + length.ToString(System.Globalization.CultureInfo.InvariantCulture)
                + "|" + maxSide.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }

        public bool TryGet(string key, out PreparedIcon icon)
        {
            Entry e;
            if (key != null && _map.TryGetValue(key, out e)) { e.Used = _round; icon = e.Icon; return true; }
            icon = null;
            return false;
        }

        public void Put(string key, PreparedIcon icon)
        {
            if (key == null || icon == null) return;
            Entry e;
            if (_map.TryGetValue(key, out e)) { e.Icon = icon; e.Used = _round; return; }
            if (_map.Count >= MaxEntries) DropOldest();
            _map[key] = new Entry { Icon = icon, Used = _round };
        }

        /// <summary>An icon still shown by a page or a row that was not made again: it stays through the next <see cref="Sweep"/>.</summary>
        public void Keep(string key)
        {
            Entry e;
            if (key != null && _map.TryGetValue(key, out e)) e.Used = _round;
        }

        /// <summary>Drops every icon not asked for, stored or kept since the previous sweep. Returns how many went.</summary>
        public int Sweep()
        {
            var gone = new List<string>();
            foreach (KeyValuePair<string, Entry> kv in _map) if (kv.Value.Used != _round) gone.Add(kv.Key);
            foreach (string k in gone) _map.Remove(k);
            _round++;
            return gone.Count;
        }

        /// <summary>Full: the icon used longest ago makes room (any of them when they were all used in the same round).</summary>
        private void DropOldest()
        {
            string oldest = null;
            int at = int.MaxValue;
            foreach (KeyValuePair<string, Entry> kv in _map)
                if (oldest == null || kv.Value.Used < at) { oldest = kv.Key; at = kv.Value.Used; }
            if (oldest != null) _map.Remove(oldest);
        }
    }
}
