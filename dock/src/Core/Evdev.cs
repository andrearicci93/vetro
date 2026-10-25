using System;
using System.Collections.Generic;

namespace Launcher.Core
{
    /// <summary>
    /// Decodes Linux <c>struct input_event</c> records read from /dev/input/eventN and reports
    /// key presses. The record is a timeval (two longs), then type (u16), code (u16) and value
    /// (s32): 16 bytes on the 32-bit ARM TV, 24 on a 64-bit desktop. A read may end in the
    /// middle of a record, so leftovers are kept for the next call. Presses only: releases
    /// (value 0) and auto-repeat (value 2) are ignored.
    /// </summary>
    internal sealed class EvdevReader
    {
        public const int EvKey = 1;
        private readonly int _record;
        private readonly int _typeOffset;
        private readonly byte[] _carry;
        private int _carried;

        public EvdevReader() : this(IntPtr.Size == 4 ? 16 : 24) { }

        public EvdevReader(int recordSize)
        {
            if (recordSize != 16 && recordSize != 24) throw new ArgumentOutOfRangeException("recordSize");
            _record = recordSize;
            _typeOffset = recordSize - 8;
            _carry = new byte[recordSize];
        }

        public int RecordSize { get { return _record; } }

        public List<int> Feed(byte[] data, int count)
        {
            var presses = new List<int>();
            Feed(data, count, presses);
            return presses;
        }

        /// <summary>Allocation-free variant: appends the presses to a list the caller reuses.</summary>
        public void Feed(byte[] data, int count, List<int> presses)
        {
            int i = 0;
            while (i < count)
            {
                // complete a record left over from the previous read first
                int need = _record - _carried;
                int take = Math.Min(need, count - i);
                Buffer.BlockCopy(data, i, _carry, _carried, take);
                _carried += take;
                i += take;
                if (_carried < _record) break;
                _carried = 0;
                Decode(_carry, presses);
            }
        }

        private void Decode(byte[] rec, List<int> into)
        {
            int type = rec[_typeOffset] | (rec[_typeOffset + 1] << 8);
            int code = rec[_typeOffset + 2] | (rec[_typeOffset + 3] << 8);
            int value = rec[_typeOffset + 4] | (rec[_typeOffset + 5] << 8) | (rec[_typeOffset + 6] << 16) | (rec[_typeOffset + 7] << 24);
            if (type == EvKey && value == 1) into.Add(code);
        }
    }

    /// <summary>Finds the remote-control input nodes in the text of /proc/bus/input/devices.</summary>
    internal static class InputDevices
    {
        // "vetro-forwarded-remote" is where Vetro's filter re-emits the keys it lets through after it has
        // taken the real remote exclusively (EVIOCGRAB): with the filter on, the physical nodes go silent.
        private static readonly string[] Remote = { "smart control", "rc device", "mcirb", "vetro-forwarded-remote" };
        private static readonly string[] Excluded = { "keyboard", "mouse", "panel" };

        private static bool Any(string lower, string[] words)
        {
            foreach (string w in words) if (lower.IndexOf(w, StringComparison.Ordinal) >= 0) return true;
            return false;
        }

        // "event" followed by digits only, as a whole word of the Handlers line.
        private static string EventNode(string handlers)
        {
            foreach (string t in handlers.Split(' '))
            {
                if (t.Length <= 5 || !t.StartsWith("event", StringComparison.Ordinal)) continue;
                bool digits = true;
                for (int i = 5; i < t.Length; i++) if (t[i] < '0' || t[i] > '9') { digits = false; break; }
                if (digits) return "/dev/input/" + t;
            }
            return null;
        }

        /// <summary>Vetro's remote selection, plus the node Vetro forwards the remote to (see <c>Remote</c>).</summary>
        public static List<string> RemoteNodes(string procBusInputDevices)
        {
            var nodes = new List<string>();
            string name = null, node = null;
            foreach (string raw in (procBusInputDevices ?? "").Replace("\r", "").Split('\n'))
            {
                string line = raw.TrimEnd();
                if (line.Length == 0) { Flush(nodes, name, node); name = null; node = null; continue; }
                if (line.StartsWith("N: Name=\"", StringComparison.Ordinal) && line.EndsWith("\"", StringComparison.Ordinal) && line.Length >= 10)
                    name = line.Substring(9, line.Length - 10);
                else if (line.StartsWith("H: Handlers=", StringComparison.Ordinal))
                    node = EventNode(line.Substring(12));
            }
            Flush(nodes, name, node);
            return nodes;
        }

        private static void Flush(List<string> into, string name, string node)
        {
            if (name == null || node == null) return;
            string lower = name.ToLowerInvariant();
            if (Any(lower, Remote) && !Any(lower, Excluded)) into.Add(node);
        }
    }
}
