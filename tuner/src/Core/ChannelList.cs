using System;
using System.Collections.Generic;

namespace Tuner.Core
{
    /// <summary>One channel of the TV's list. Plain data: no dependency on the TV service, so the logic below runs on any machine.</summary>
    internal sealed class Channel
    {
        public ulong Id;        // tvs service id, what SetSource wants
        public int Major;       // the number the viewer types
        public string Name;
        public bool Hidden;     // not shown in the list and skipped by CH+/-
    }

    /// <summary>The channels in the order of the list, the one on screen, and the moves between them (CH+/-, number keys).</summary>
    internal sealed class ChannelList
    {
        private readonly List<Channel> _items = new List<Channel>();
        private int _current = -1;

        public ChannelList(IEnumerable<Channel> channels)
        {
            foreach (Channel c in channels) if (c != null && !c.Hidden) _items.Add(c);
            _items.Sort((a, b) => a.Major != b.Major ? a.Major.CompareTo(b.Major) : string.CompareOrdinal(a.Name, b.Name));
        }

        public int Count { get { return _items.Count; } }
        public int CurrentIndex { get { return _current; } }
        public Channel Current { get { return _current < 0 ? null : _items[_current]; } }
        public Channel this[int i] { get { return _items[i]; } }

        /// <summary>Makes the channel with this service id the current one. False when it is not in the list.</summary>
        public bool SetCurrent(ulong id)
        {
            for (int i = 0; i < _items.Count; i++) if (_items[i].Id == id) { _current = i; return true; }
            return false;
        }

        /// <summary>The channel after (+1) or before (-1) the current one, wrapping around. Null when the list is empty.</summary>
        public Channel Step(int direction)
        {
            if (_items.Count == 0) return null;
            int from = _current < 0 ? (direction > 0 ? -1 : 0) : _current;
            int next = ((from + (direction > 0 ? 1 : -1)) % _items.Count + _items.Count) % _items.Count;
            return _items[next];
        }

        /// <summary>The channel a typed number selects: an exact match on the number, else null (the viewer typed a number that does not exist).</summary>
        public Channel ByNumber(int major)
        {
            foreach (Channel c in _items) if (c.Major == major) return c;
            return null;
        }

        public Channel Select(Channel c)
        {
            if (c != null) _current = _items.IndexOf(c);
            return c;
        }
    }
}
