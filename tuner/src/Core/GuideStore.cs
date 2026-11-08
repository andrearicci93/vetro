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

        public void Put(ulong id, List<GuideEvent> events, long readAt, long askedUntil)
        {
            lock (_items) _items[id] = new ChannelSchedule { Events = events, ReadAt = readAt, AskedUntil = askedUntil };
        }

        public ChannelSchedule Get(ulong id) { lock (_items) { ChannelSchedule c; return _items.TryGetValue(id, out c) ? c : null; } }
        public int Count { get { lock (_items) return _items.Count; } }

        /// <summary>The programme on air at <paramref name="now"/>, or null (unknown channel, no data, or the list does not reach now).</summary>
        public GuideEvent Current(ulong id, long now)
        {
            ChannelSchedule c = Get(id);
            if (c == null) return null;
            foreach (GuideEvent e in c.Events) if (e.Start <= now && now < e.End) return e;
            return null;
        }

        /// <summary>True when the channel is worth reading again for a window that ends at <paramref name="until"/>.</summary>
        public bool NeedsRead(ulong id, long now, long until)
        {
            ChannelSchedule c = Get(id);
            if (c == null) return true;
            long age = now - c.ReadAt;
            if (age >= MaxAgeSeconds) return true;
            if (c.AskedUntil < until && age >= RetrySeconds) return true;          // read for a shorter window than wanted now
            bool coversNow = false;
            foreach (GuideEvent e in c.Events) if (e.Start <= now && now < e.End) { coversNow = true; break; }
            return !coversNow && age >= RetrySeconds;
        }

        /// <summary>
        /// Indexes of a list of <paramref name="count"/> channels in the order worth reading them: the ones next to the channel on screen first
        /// (+1, -1, +2, -2, ...), because that is where CH+/- goes next. The channel on screen itself is left out. Wraps around.
        /// </summary>
        public static List<int> Nearest(int count, int center)
        {
            var order = new List<int>();
            if (count <= 1 || center < 0 || center >= count) return order;
            var seen = new HashSet<int> { center };
            for (int k = 1; order.Count < count - 1; k++)
            {
                int up = ((center + k) % count + count) % count, down = ((center - k) % count + count) % count;
                if (seen.Add(up)) order.Add(up);
                if (seen.Add(down)) order.Add(down);
            }
            return order;
        }
    }
}
