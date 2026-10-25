using System;
using System.Collections.Generic;
using System.Text;

namespace Launcher.Core
{
    internal enum Command { Show, Hide, Toggle }

    /// <summary>
    /// Newline-delimited command stream read from the control FIFO ("show", "hide", "toggle").
    /// Unknown words are dropped, a line without a terminator waits for more bytes, and a
    /// writer that never sends a newline cannot grow the buffer past <see cref="MaxLine"/>.
    /// </summary>
    internal sealed class CommandBuffer
    {
        public const int MaxLine = 64;
        private readonly StringBuilder _line = new StringBuilder();
        private bool _overflow;

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
            switch (_line.ToString().Trim().ToLowerInvariant())
            {
                case "show": into.Add(Command.Show); break;
                case "hide": into.Add(Command.Hide); break;
                case "toggle": into.Add(Command.Toggle); break;
            }
        }
    }
}
