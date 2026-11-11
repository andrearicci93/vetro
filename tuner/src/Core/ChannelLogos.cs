using System;
using System.Collections.Generic;
using System.Globalization;

namespace Tuner.Core
{
    /// <summary>One channel of Samsung's channel gallery (the TV's own table, filled from Samsung's servers): which picture it has and the DVB services it is broadcast as.</summary>
    internal sealed class LogoRow
    {
        public string SourceId = "";                          // the gallery's id for the channel (also the key of the tunable table)
        public string Name = "";
        public string IconUrl = "";                           // the address the TV downloads the picture from (the file name on disk comes from it)
        public int[] Onid = new int[0], Tsid = new int[0], Sid = new int[0];   // parallel lists: the channel is broadcast as (Onid[i], Tsid[i], Sid[i]) in several places
    }

    /// <summary>
    /// Which picture belongs to a channel. The TV keeps two tables: the gallery (id, name, picture address, DVB triplets) and a table of the
    /// channels this TV can tune, which joins the gallery's id to the tvs service id. A channel is found by that service id first; when the
    /// table has no row for it, by its DVB triplet (original network, transport stream, service) if the channel carries one. No match is no
    /// logo: nothing is ever guessed from the name, a wrong logo is worse than none.
    /// </summary>
    internal sealed class LogoIndex
    {
        private readonly Dictionary<ulong, string> _byService = new Dictionary<ulong, string>();
        private readonly Dictionary<long, string> _byTriplet = new Dictionary<long, string>();

        public int Rows { get; private set; }

        /// <param name="gallery">The gallery rows.</param>
        /// <param name="tunable">tvs service id → gallery id, from the tunable-channel table (may be empty).</param>
        public LogoIndex(IEnumerable<LogoRow> gallery, IEnumerable<KeyValuePair<ulong, string>> tunable)
        {
            var bySource = new Dictionary<string, string>();
            foreach (LogoRow r in gallery)
            {
                if (r == null || r.IconUrl.Length == 0) continue;
                Rows++;
                if (r.SourceId.Length > 0 && !bySource.ContainsKey(r.SourceId)) bySource[r.SourceId] = r.IconUrl;
                int n = Math.Min(r.Onid.Length, Math.Min(r.Tsid.Length, r.Sid.Length));
                for (int i = 0; i < n; i++)
                {
                    if (r.Onid[i] < 0 || r.Tsid[i] < 0 || r.Sid[i] < 0) continue;
                    long key = Triplet(r.Onid[i], r.Tsid[i], r.Sid[i]);
                    if (!_byTriplet.ContainsKey(key)) _byTriplet[key] = r.IconUrl;       // the first row keeps a triplet: the same answer on every run
                }
            }
            if (tunable != null)
                foreach (var t in tunable)
                {
                    string url;
                    if (bySource.TryGetValue(t.Value ?? "", out url) && !_byService.ContainsKey(t.Key)) _byService[t.Key] = url;
                }
        }

        private static long Triplet(int onid, int tsid, int sid) { return ((long)(onid & 0xFFFF) << 32) | ((long)(tsid & 0xFFFF) << 16) | (long)(sid & 0xFFFF); }

        /// <summary>The picture address of a channel, or null when the gallery has none for it.</summary>
        public string UrlFor(Channel c)
        {
            if (c == null) return null;
            string url;
            if (_byService.TryGetValue(c.Id, out url)) return url;
            if (c.Onid >= 0 && c.Tsid >= 0 && c.Sid >= 0 && _byTriplet.TryGetValue(Triplet(c.Onid, c.Tsid, c.Sid), out url)) return url;
            return null;
        }

        /// <summary>True when there is anything to look up: the views reserve room for a logo only then, so without the TV's data they draw as they always did.</summary>
        public bool Any { get { return _byService.Count > 0 || _byTriplet.Count > 0; } }
    }

    internal static class LogoNames
    {
        /// <summary>
        /// The name the TV gives the downloaded file: the last three parts of the picture's own address (the address inside the "url=" of the
        /// resizer's link when there is one), joined with "_". "…/assets/assets/s84638_ll_h8_ab.png" is "assets_assets_s84638_ll_h8_ab.png".
        /// Null when the address has nothing to build a name from.
        /// </summary>
        public static string CacheFile(string iconUrl)
        {
            if (string.IsNullOrEmpty(iconUrl)) return null;
            string inner = iconUrl;
            int u = iconUrl.IndexOf("url=", StringComparison.Ordinal);
            if (u >= 0) inner = iconUrl.Substring(u + 4);
            int amp = inner.IndexOf('&');
            if (amp >= 0) inner = inner.Substring(0, amp);
            int q = inner.IndexOf('?');
            if (q >= 0) inner = inner.Substring(0, q);
            int scheme = inner.IndexOf("://", StringComparison.Ordinal);
            if (scheme >= 0) inner = inner.Substring(scheme + 3);
            string[] parts = inner.Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 2) return null;                       // a host and a file at least
            int from = Math.Max(1, parts.Length - 3);                // never the host
            string name = string.Join("_", parts, from, parts.Length - from);
            foreach (char ch in name) if (ch == '\\' || ch == ':' || ch < 32) return null;
            return name.Length > 0 && name.Length < 200 ? name : null;
        }

        /// <summary>The numbers of a list like "0x217C,0x2" (hex with or without the prefix). A part that is not a number becomes -1, so the lists stay parallel.</summary>
        public static int[] HexList(string text)
        {
            if (string.IsNullOrEmpty(text)) return new int[0];
            string[] parts = text.Split(',');
            var l = new int[parts.Length];
            for (int i = 0; i < parts.Length; i++)
            {
                string p = parts[i].Trim();
                if (p.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) p = p.Substring(2);
                int v;
                l[i] = int.TryParse(p, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out v) ? v : -1;
            }
            return l;
        }
    }
}
