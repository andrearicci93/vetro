using System;
using System.Collections.Generic;

namespace Tuner.Core
{
    /// <summary>What is known of one channel's schedule: the programmes, when they were read and how far the request reached.</summary>
    internal sealed class ChannelSchedule
    {
        public List<GuideEvent> Events = new List<GuideEvent>();   // by start; replaced as a whole, never edited once stored
        public long ReadAt;                                         // Unix seconds
        public long AskedUntil;                                     // the window the daemon was asked for ended here
    }

    /// <summary>
    /// The schedules read so far, per service id. Written by the worker thread, read by the UI thread (the lists are replaced whole,
    /// so a list taken out of the store is safe to read afterwards). The banner and the guide both read from here, so a channel read
    /// for one is known to the other.
    /// </summary>
    internal sealed class GuideStore
    {
        private readonly Dictionary<ulong, ChannelSchedule> _items = new Dictionary<ulong, ChannelSchedule>();

        /// <summary>A schedule that is read again after this many seconds even if it still looks good: the broadcaster may have changed it.</summary>
        public const long MaxAgeSeconds = 15 * 60;
        /// <summary>When no programme covers "now" (the list ran out, or the channel has no data) it is read again after this long.</summary>
        public const long RetrySeconds = 20;

        /// <summary>Past this many channels, the ones not read for <see cref="MaxAgeSeconds"/> are dropped when a new one comes in (they would be read again anyway).</summary>
        public const int KeepChannels = 100;

        public void Put(ulong id, List<GuideEvent> events, long readAt, long askedUntil)
        {
            lock (_items)
            {
                _items[id] = new ChannelSchedule { Events = events, ReadAt = readAt, AskedUntil = askedUntil };
                if (_items.Count <= KeepChannels) return;
                // A resident tuner lives for weeks: without this, paging through the guide keeps 72 h of every channel ever seen.
                var old = new List<ulong>();
                foreach (var kv in _items) if (kv.Key != id && readAt - kv.Value.ReadAt >= MaxAgeSeconds) old.Add(kv.Key);
                foreach (ulong k in old) _items.Remove(k);
            }
        }

        /// <summary>
        /// The read of this channel failed: if nothing is known about it, it is recorded as having no programmes (the guide says "No information"
        /// instead of "Loading…" for ever) and is read again after <see cref="RetrySeconds"/>. A schedule already known is kept. True when it was recorded.
        /// </summary>
        public bool PutFailed(ulong id, long readAt, long askedUntil)
        {
            lock (_items)
            {
                if (_items.ContainsKey(id)) return false;
                _items[id] = new ChannelSchedule { Events = new List<GuideEvent>(), ReadAt = readAt, AskedUntil = askedUntil };
                return true;
            }
        }

        public ChannelSchedule Get(ulong id) { lock (_items) { ChannelSchedule c; return _items.TryGetValue(id, out c) ? c : null; } }

        /// <summary>The programme on air at <paramref name="now"/>, or null (unknown channel, no data, or the list does not reach now).</summary>
        public GuideEvent Current(ulong id, long now)
        {
            ChannelSchedule c = Get(id);
            if (c == null) return null;
            foreach (GuideEvent e in c.Events) if (e.Start <= now && now < e.End) return e;
            return null;
        }

        /// <summary>
        /// The programme after the one on air at <paramref name="now"/>: the first one that starts when it ends or later (one that starts inside
        /// it is skipped). With nothing on air, the first one that starts after <paramref name="now"/>. Null when the channel is not known, has no
        /// data, or the list ends there. The events are sorted by start, so the first match is the next.
        /// </summary>
        public GuideEvent Next(ulong id, long now)
        {
            ChannelSchedule c = Get(id);
            if (c == null) return null;
            GuideEvent cur = null;
            foreach (GuideEvent e in c.Events) if (e.Start <= now && now < e.End) { cur = e; break; }
            foreach (GuideEvent e in c.Events) if (cur != null ? e.Start >= cur.End : e.Start > now) return e;
            return null;
        }

        /// <summary>True when the channel is worth reading again for a window that ends at <paramref name="until"/>.</summary>
        public bool NeedsRead(ulong id, long now, long until)
        {
            ChannelSchedule c = Get(id);
            if (c == null) return true;
            long age = now - c.ReadAt;
            if (age >= MaxAgeSeconds) return true;
            // Read for a clearly shorter window than wanted now. Every caller asks for "now + horizon", which moves with the clock: a
            // plain "AskedUntil < until" was true one second after any read, so every schedule went stale after RetrySeconds (20 s)
            // instead of MaxAgeSeconds, and each zap read 25 channels again. The slack is the age a reading may have anyway.
            if (c.AskedUntil + MaxAgeSeconds < until && age >= RetrySeconds) return true;
            bool coversNow = false;
            foreach (GuideEvent e in c.Events) if (e.Start <= now && now < e.End) { coversNow = true; break; }
            return !coversNow && age >= RetrySeconds;
        }

        /// <summary>
        /// Indexes of a list of <paramref name="count"/> channels in the order worth reading them: the ones next to the channel on screen first
        /// (+1, -1, +2, -2, ...), because that is where CH+/- goes next. The channel on screen itself is left out. Wraps around.
        /// With <paramref name="limit"/>, only the first that many of that order: a zap and every step of a held CH+ need two dozen, not the
        /// whole list (the order of the ones returned is the same).
        /// </summary>
        public static List<int> Nearest(int count, int center, int limit = int.MaxValue)
        {
            var order = new List<int>(Math.Max(0, Math.Min(limit, count - 1)));
            if (count <= 1 || center < 0 || center >= count || limit <= 0) return order;
            int want = Math.Min(count - 1, limit);
            // +k and -k are the same index only when 2k is a multiple of count; any other repeat would need k >= count, which "want" never reaches.
            for (int k = 1; order.Count < want; k++)
            {
                int up = ((center + k) % count + count) % count, down = ((center - k) % count + count) % count;
                if (up != center) order.Add(up);
                if (order.Count < want && down != center && down != up) order.Add(down);
            }
            return order;
        }
    }
}
