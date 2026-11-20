using System;
using System.Collections.Generic;
using System.Text;

namespace Launcher.Core
{
    internal enum Command { Show, Hide, Toggle, VolUp, VolDown, VolMute, Pad, Rescan, Reload }

    /// <summary>
    /// Newline-delimited command stream read from the control FIFO ("show", "hide", "toggle", and the volume keys
    /// "volup", "voldown", "volmute" and "pad" that the Vetro service forwards when it swallows the remote's volume and 123 keys, and
    /// "rescan", which the service sends when its remote bridge has just made a new forwarding node, so it is watched at once, and "reload",
    /// which it sends when it has written the app lists again after an app was installed or removed).
    /// Unknown words are dropped, a line without a terminator waits for more bytes, and a
    /// writer that never sends a newline cannot grow the buffer past <see cref="MaxLine"/>.
    /// </summary>
    internal sealed class CommandBuffer
    {
        public const int MaxLine = 64;
        private readonly char[] _line = new char[MaxLine];
        private readonly List<Command> _result = new List<Command>(4);
        private int _len;
        private bool _overflow;

        public List<Command> Feed(byte[] data, int count)
        {
            _result.Clear();
            for (int i = 0; i < count; i++)
            {
                byte b = data[i];
                if (b == (byte)'\n')
                {
                    if (!_overflow) Emit(_result);
                    _len = 0;
                    _overflow = false;
                }
                else if (_len >= MaxLine) _overflow = true;
                else _line[_len++] = (char)b;
            }
            return _result;
        }

        private void Emit(List<Command> into)
        {
            int start = 0, end = _len;
            while (start < end && _line[start] <= ' ') start++;
            while (end > start && _line[end - 1] <= ' ') end--;
            int n = end - start;
            if (n < 3 || n > 7) return;
            if (Match(start, n, "show")) into.Add(Command.Show);
            else if (Match(start, n, "hide")) into.Add(Command.Hide);
            else if (Match(start, n, "toggle")) into.Add(Command.Toggle);
            else if (Match(start, n, "volup")) into.Add(Command.VolUp);
            else if (Match(start, n, "voldown")) into.Add(Command.VolDown);
            else if (Match(start, n, "volmute")) into.Add(Command.VolMute);
            else if (Match(start, n, "pad")) into.Add(Command.Pad);
            else if (Match(start, n, "rescan")) into.Add(Command.Rescan);
            else if (Match(start, n, "reload")) into.Add(Command.Reload);
        }

        private bool Match(int start, int len, string word)
        {
            if (len != word.Length) return false;
            for (int i = 0; i < len; i++)
            {
                char c = _line[start + i];
                if (c >= 'A' && c <= 'Z') c = (char)(c + 32);
                if (c != word[i]) return false;
            }
            return true;
        }
    }
}
