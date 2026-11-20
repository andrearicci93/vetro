using System;
using System.Threading;
using Launcher.Core;
using Launcher.Native;

namespace Launcher.Ui
{
    /// <summary>
    /// Reads (and sets) one Control center choice card off the main loop: a busctl, vconftool or curl call can take a moment, and the dock
    /// must keep drawing. One job at a time; the host polls <see cref="TryTake"/> from a timer, like the Task manager's worker.
    /// </summary>
    internal sealed class ChoiceSource
    {
        private readonly object _gate = new object();
        private readonly string _name;
        private readonly Func<ChoiceState> _read;
        private readonly Func<int, string> _setCommand;
        private readonly Func<ChoiceRow, ChoiceState> _choose;
        private readonly Action<string> _log;
        private bool _busy;
        private ChoiceState _ready;

        /// <param name="read">The read, on the worker thread.</param>
        /// <param name="setCommand">The command that sets a row's value (null for a value that cannot be set).</param>
        public ChoiceSource(string name, Func<ChoiceState> read, Func<int, string> setCommand, Action<string> log)
        {
            _name = name; _read = read; _setCommand = setCommand; _log = log;
        }

        /// <param name="choose">A choice that answers the card's new state itself (a Shard card: the service reads the Shard again), on the worker thread.</param>
        public ChoiceSource(string name, Func<ChoiceState> read, Func<ChoiceRow, ChoiceState> choose, Action<string> log)
        {
            _name = name; _read = read; _choose = choose; _log = log;
        }

        public string Name { get { return _name; } }

        public bool Busy { get { lock (_gate) return _busy; } }

        /// <summary>Reads in the background (after choosing <paramref name="row"/> first, when it is given) unless a job is already running.</summary>
        public bool Request(ChoiceRow row = null)
        {
            lock (_gate) { if (_busy) return false; _busy = true; }
            ThreadPool.QueueUserWorkItem(_ =>
            {
                ChoiceState st = null;
                try
                {
                    long r0 = DateTime.UtcNow.Ticks;
                    if (row != null && _choose != null)
                    {
                        st = _choose(row);
                        _log(_name + ": chose " + (row.Id ?? row.Value.ToString()) + ", " + (st == null ? "no answer" : st.Rows.Count + " rows" + (st.Note.Length > 0 ? " (" + st.Note + ")" : "")) + " in " + (DateTime.UtcNow.Ticks - r0) / 10000 + " ms");
                    }
                    else
                    {
                        if (row != null && _setCommand != null)
                        {
                            string cmd = _setCommand(row.Value);
                            if (cmd != null) { long t0 = DateTime.UtcNow.Ticks; string answer = Shell.Read(cmd); _log(_name + ": set " + row.Value + " answered \"" + answer.Trim() + "\" in " + (DateTime.UtcNow.Ticks - t0) / 10000 + " ms"); }
                        }
                        r0 = DateTime.UtcNow.Ticks;
                        st = _read();
                        _log(_name + ": read " + st.Rows.Count + " rows" + (st.Note.Length > 0 ? " (" + st.Note + ")" : "") + " in " + (DateTime.UtcNow.Ticks - r0) / 10000 + " ms");
                    }
                }
                catch (Exception ex) { _log(_name + ": " + ex.Message); }
                finally { lock (_gate) { _ready = st ?? new ChoiceState { Note = "Not available", Choosable = false }; _busy = false; } }
            });
            return true;
        }

        public ChoiceState TryTake() { lock (_gate) { ChoiceState s = _ready; _ready = null; return s; } }
    }
}
