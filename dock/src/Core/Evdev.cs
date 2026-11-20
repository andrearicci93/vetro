using System;
using System.Collections.Generic;

namespace Launcher.Core
{
    /// <summary>
    /// Decodes Linux <c>struct input_event</c> records read from /dev/input/eventN and reports
    /// key presses. The record is a timeval (two longs), then type (u16), code (u16) and value
    /// (s32): 16 bytes on the 32-bit ARM TV, 24 on a 64-bit desktop. A read may end in the
    /// middle of a record, so leftovers are kept for the next call. Presses (value 1), and releases
    /// (value 0) when the caller asks for them; auto-repeat (value 2) is ignored.
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

        public List<int> Feed(byte[] data, int count)
        {
            var presses = new List<int>();
            Feed(data, count, presses);
            return presses;
        }

        /// <summary>Allocation-free variant: appends the presses to a list the caller reuses.</summary>
        public void Feed(byte[] data, int count, List<int> presses) { Feed(data, count, presses, null); }

        /// <summary>Also appends the releases, in order, to <paramref name="releases"/> (null: not wanted).</summary>
        public void Feed(byte[] data, int count, List<int> presses, List<int> releases)
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
                Decode(_carry, presses, releases);
            }
        }

        private void Decode(byte[] rec, List<int> into, List<int> releases)
        {
            int type = rec[_typeOffset] | (rec[_typeOffset + 1] << 8);
            int code = rec[_typeOffset + 2] | (rec[_typeOffset + 3] << 8);
            int value = rec[_typeOffset + 4] | (rec[_typeOffset + 5] << 8) | (rec[_typeOffset + 6] << 16) | (rec[_typeOffset + 7] << 24);
            if (type != EvKey) return;
            if (value == 1) into.Add(code);
            else if (value == 0 && releases != null) releases.Add(code);
        }
    }

    /// <summary>Finds the remote-control input nodes in the text of /proc/bus/input/devices.</summary>
    internal static class InputDevices
    {
        // Vetro's filter takes the real remote exclusively (EVIOCGRAB) and re-emits the keys it lets through on its own
        // node under the real remote's name, so these keywords match that node too while the physical one goes silent.
        private static readonly string[] Remote = { "smart control", "rc device", "mcirb" };
        private static readonly string[] Excluded = { "keyboard", "mouse", "panel" };

        private static bool Any(string text, int start, int len, string[] words)
        {
            foreach (string w in words) if (text.IndexOf(w, start, len, StringComparison.OrdinalIgnoreCase) >= 0) return true;
            return false;
        }

        // "event" followed by digits only, as a whole word of the Handlers line.
        private static string EventNode(string text, int start, int end)
        {
            int i = start;
            while (i < end)
            {
                while (i < end && text[i] == ' ') i++;
                int tokStart = i;
                while (i < end && text[i] != ' ') i++;
                int tokLen = i - tokStart;
                if (tokLen <= 5 || string.CompareOrdinal(text, tokStart, "event", 0, 5) != 0) continue;
                bool digits = true;
                for (int k = tokStart + 5; k < i; k++) if (text[k] < '0' || text[k] > '9') { digits = false; break; }
                if (digits) return "/dev/input/" + text.Substring(tokStart, tokLen);
            }
            return null;
        }

        /// <summary>Vetro's remote selection, which also matches the node Vetro forwards the remote to (see <c>Remote</c>).</summary>
        public static List<string> RemoteNodes(string procBusInputDevices)
        {
            var nodes = new List<string>();
            if (string.IsNullOrEmpty(procBusInputDevices)) return nodes;
            int nameStart = -1, nameLen = 0;
            string node = null;
            int pos = 0, total = procBusInputDevices.Length;
            while (pos < total)
            {
                int nl = procBusInputDevices.IndexOf('\n', pos);
                int lineEnd = nl < 0 ? total : nl;
                while (lineEnd > pos && (procBusInputDevices[lineEnd - 1] == '\r' || procBusInputDevices[lineEnd - 1] == ' ' || procBusInputDevices[lineEnd - 1] == '\t'))
                    lineEnd--;
                int lineLen = lineEnd - pos;
                if (lineLen == 0)
                {
                    Flush(nodes, procBusInputDevices, nameStart, nameLen, node);
                    nameStart = -1; nameLen = 0; node = null;
                }
                else if (lineLen >= 10 && string.CompareOrdinal(procBusInputDevices, pos, "N: Name=\"", 0, 9) == 0 && procBusInputDevices[lineEnd - 1] == '"')
                {
                    nameStart = pos + 9;
                    nameLen = lineLen - 10;
                }
                else if (lineLen >= 12 && string.CompareOrdinal(procBusInputDevices, pos, "H: Handlers=", 0, 12) == 0)
                {
                    node = EventNode(procBusInputDevices, pos + 12, lineEnd);
                }
                if (nl < 0) break;
                pos = nl + 1;
            }
            Flush(nodes, procBusInputDevices, nameStart, nameLen, node);
            return nodes;
        }

        private static void Flush(List<string> into, string text, int nameStart, int nameLen, string node)
        {
            if (nameStart < 0 || node == null) return;
            if (Any(text, nameStart, nameLen, Remote) && !Any(text, nameStart, nameLen, Excluded)) into.Add(node);
        }

        /// <summary>Drops disconnected device paths from <paramref name="openFailed"/> so stale failures never defeat InputScanGate.</summary>
        public static void PruneFailed(HashSet<string> openFailed, IList<string> presentNodes)
        {
            if (openFailed == null || openFailed.Count == 0) return;
            if (presentNodes == null || presentNodes.Count == 0) { openFailed.Clear(); return; }
            var present = new HashSet<string>(presentNodes, StringComparer.Ordinal);
            openFailed.RemoveWhere(n => !present.Contains(n));
        }
    }
}
