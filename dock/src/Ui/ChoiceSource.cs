using System;
using System.Threading;
using Launcher.Core;
using Launcher.Native;

namespace Launcher.Ui
{
    /// <summary>
    /// Reads (and sets) one Control center choice card off the main loop: a busctl or vconftool call can take a moment, and the dock must keep
    /// drawing. One job at a time; the host polls <see cref="TryTake"/> from a timer, like the Task manager's worker.
    /// </summary>
    internal sealed class ChoiceSource
    {
        private readonly object _gate = new object();
        private readonly string _name;
        private readonly Func<ChoiceState> _read;
        private readonly Func<int, string> _setCommand;
        private readonly Action<string> _log;
        private bool _busy;
        private ChoiceState _ready;

        /// <param name="read">The read, on the worker thread.</param>
        /// <param name="setCommand">The command that sets a row's value (null for a value that cannot be set).</param>
        public ChoiceSource(string name, Func<ChoiceState> read, Func<int, string> setCommand, Action<string> log)
        {
            _name = name; _read = read; _setCommand = setCommand; _log = log;
        }

        public bool Busy { get { lock (_gate) return _busy; } }

        /// <summary>Reads in the background (after setting <paramref name="value"/> first, when it is given) unless a job is already running.</summary>
        public bool Request(int? value = null)
        {
            lock (_gate) { if (_busy) return false; _busy = true; }
            var t = new Thread(() =>
            {
                ChoiceState st = null;
                try
                {
                    if (value.HasValue)
                    {
                        string cmd = _setCommand(value.Value);
                        if (cmd != null) { long t0 = DateTime.UtcNow.Ticks; string answer = Shell.Read(cmd); _log(_name + ": set " + value.Value + " answered \"" + answer.Trim() + "\" in " + (DateTime.UtcNow.Ticks - t0) / 10000 + " ms"); }
                    }
                    long r0 = DateTime.UtcNow.Ticks;
                    st = _read();
                    _log(_name + ": read " + st.Rows.Count + " rows" + (st.Note.Length > 0 ? " (" + st.Note + ")" : "") + " in " + (DateTime.UtcNow.Ticks - r0) / 10000 + " ms");
                }
                catch (Exception ex) { _log(_name + ": " + ex.Message); }
                lock (_gate) { _ready = st ?? new ChoiceState { Note = "Not available", Choosable = false }; _busy = false; }
            });
            t.IsBackground = true;
            t.Name = _name;
            t.Start();
            return true;
        }

        public ChoiceState TryTake() { lock (_gate) { ChoiceState s = _ready; _ready = null; return s; } }
    }
}
