using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Launcher.Core
{
    internal enum Command { Show, Hide, Toggle, VolUp, VolDown, VolMute, Pad, Rescan, Reload, Idle, Launch }

    /// <summary>
    /// Newline-delimited command stream read from the control FIFO ("show", "hide", "toggle", and the volume keys
    /// "volup", "voldown", "volmute" and "pad" that the Vetro service forwards when it swallows the remote's volume and 123 keys, and
    /// "rescan", which the service sends when its remote bridge has just made a new forwarding node, so it is watched at once, and "reload",
    /// which it sends when it has written the app lists again after an app was installed or removed, plus "idle &lt;mode&gt; &lt;0|1&gt; &lt;potoff&gt; [0|1]"
    /// for live reconfiguration of the Empty TV screen without restarting and "launch [seconds]" when an app is started externally).
    /// Unknown words are dropped, a line without a terminator waits for more bytes, and a
    /// writer that never sends a newline cannot grow the buffer past <see cref="MaxLine"/>.
    /// </summary>
    internal sealed class CommandBuffer
    {
        public const int MaxLine = 192;
        public const double MinLaunchSuppressSeconds = 1.0;
        public const double MaxLaunchSuppressSeconds = 15.0;
        private readonly StringBuilder _line = new StringBuilder();
        private readonly Queue<string> _idleArgs = new Queue<string>();
        private readonly Queue<string> _launchArgs = new Queue<string>();
        private bool _overflow;

        public string TakeIdleArgs() { return _idleArgs.Count > 0 ? _idleArgs.Dequeue() : null; }
        public string TakeLaunchArgs() { return _launchArgs.Count > 0 ? _launchArgs.Dequeue() : null; }

        public static double ParseLaunchArgs(string argsLine, double fallback, out string targetAppId, out string targetLabel)
        {
            targetAppId = "";
            targetLabel = "";
            if (string.IsNullOrWhiteSpace(argsLine)) return fallback;
            string[] parts = argsLine.Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0) return fallback;
            double secs = fallback;
            double parsed;
            if (double.TryParse(parts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out parsed)
                && !double.IsNaN(parsed) && !double.IsInfinity(parsed))
            {
                if (parsed < MinLaunchSuppressSeconds) secs = MinLaunchSuppressSeconds;
                else if (parsed > MaxLaunchSuppressSeconds) secs = MaxLaunchSuppressSeconds;
                else secs = parsed;
            }
            if (parts.Length >= 2 && Catalog.ValidAppId(parts[1])) targetAppId = parts[1];
            if (parts.Length >= 3) targetLabel = string.Join(" ", parts, 2, parts.Length - 2);
            return secs;
        }

        public static double ParseLaunchSuppressSeconds(string argsLine, double fallback)
        {
            string appId, label;
            return ParseLaunchArgs(argsLine, fallback, out appId, out label);
        }

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
            string rawLine = _line.ToString().Trim();
            string line = rawLine.ToLowerInvariant();
            if (line.StartsWith("idle ", StringComparison.Ordinal))
            {
                _idleArgs.Enqueue(line.Substring(5).Trim());
                into.Add(Command.Idle);
                return;
            }
            if (line == "launch" || line.StartsWith("launch ", StringComparison.Ordinal))
            {
                _launchArgs.Enqueue(rawLine.Length > 6 ? rawLine.Substring(7).Trim() : "");
                into.Add(Command.Launch);
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
