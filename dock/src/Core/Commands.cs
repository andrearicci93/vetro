using System;
using System.Collections.Generic;
using System.Text;

namespace Launcher.Core
{
    internal enum Command { Show, Hide, Toggle, VolUp, VolDown, VolMute, Pad, Rescan, Reload, Idle }

    /// <summary>
    /// Newline-delimited command stream read from the control FIFO ("show", "hide", "toggle", and the volume keys
    /// "volup", "voldown", "volmute" and "pad" that the Vetro service forwards when it swallows the remote's volume and 123 keys, and
    /// "rescan", which the service sends when its remote bridge has just made a new forwarding node, so it is watched at once, and "reload",
    /// which it sends when it has written the app lists again after an app was installed or removed, plus "idle &lt;mode&gt; &lt;0|1&gt; &lt;potoff&gt;"
    /// for live reconfiguration of the Empty TV screen without restarting).
    /// Unknown words are dropped, a line without a terminator waits for more bytes, and a
    /// writer that never sends a newline cannot grow the buffer past <see cref="MaxLine"/>.
    /// </summary>
    internal sealed class CommandBuffer
    {
        public const int MaxLine = 64;
        private readonly StringBuilder _line = new StringBuilder();
        private readonly Queue<string> _idleArgs = new Queue<string>();
        private bool _overflow;

        public string TakeIdleArgs() { return _idleArgs.Count > 0 ? _idleArgs.Dequeue() : null; }

        public List<Command> Feed(byte[] data, int count)
        {
            var result = new List<Command>();
            for (int i = 0; i < count; i++)
            {
                byte b = data[i];
                if (b == (byte)'\n')
                {
                    if (!_overflow) Emit(result);
                    _line.Length = 0;
                    _overflow = false;
                }
                else if (_line.Length >= MaxLine) _overflow = true;
                else _line.Append((char)b);
            }
            return result;
        }

        private void Emit(List<Command> into)
        {
            string line = _line.ToString().Trim().ToLowerInvariant();
            if (line.StartsWith("idle ", StringComparison.Ordinal))
            {
                _idleArgs.Enqueue(line.Substring(5).Trim());
                into.Add(Command.Idle);
                return;
            }
            switch (line)
            {
                case "show": into.Add(Command.Show); break;
                case "hide": into.Add(Command.Hide); break;
                case "toggle": into.Add(Command.Toggle); break;
                case "volup": into.Add(Command.VolUp); break;
                case "voldown": into.Add(Command.VolDown); break;
                case "volmute": into.Add(Command.VolMute); break;
                case "pad": into.Add(Command.Pad); break;
                case "rescan": into.Add(Command.Rescan); break;
                case "reload": into.Add(Command.Reload); break;
            }
        }
    }
}
