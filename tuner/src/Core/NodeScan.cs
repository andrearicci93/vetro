namespace Tuner.Core
{
    /// <summary>
    /// Whether the 3 s rescan of the input devices needs to read /proc/bus/input/devices again (a few kilobytes read and parsed, for weeks, also
    /// while hidden). A new input device gets its node in /dev/input before it is listed there (the kernel makes the node while it registers the
    /// device), and making a node changes the directory's modification time; so while that time stays the same and the last scan opened every
    /// node it listed, nothing new can be listed. The list is read anyway when the time cannot be read, after a scan that could not open a node it
    /// listed or after a watched node was dropped, and every <see cref="FullEvery"/> ticks (two nodes made within one tick of a coarse clock share a time). The remote bridge's
    /// "rescan" and the scan at start always read. Pure: the caller gives the time and says how the scan went.
    /// </summary>
    internal sealed class NodeScan
    {
        public const int FullEvery = 20;   // 20 ticks of 3 s: once a minute
        private long _stamp;
        private bool _clean;
        private int _skipped;

        /// <param name="stamp">The modification time of /dev/input (any unit), or null when it cannot be read.</param>
        public bool ShouldRead(long? stamp)
        {
            if (stamp == null || !_clean || stamp.Value != _stamp || _skipped + 1 >= FullEvery) return true;
            _skipped++;
            return false;
        }

        /// <summary>
        /// The next tick must read: a watched node was dropped (a read error on it; the old scan opened it again on the next tick if it was still listed),
        /// or a scan is starting (a scan that throws half way leaves this, not a clean state).
        /// </summary>
        public void Dirty() { _clean = false; }

        /// <summary>A scan was made. <paramref name="stamp"/> is the time read before it; <paramref name="allOpened"/>: every listed node is watched.</summary>
        public void Scanned(long? stamp, bool allOpened)
        {
            _stamp = stamp ?? 0;
            _clean = stamp != null && allOpened;
            _skipped = 0;
        }
    }
}
