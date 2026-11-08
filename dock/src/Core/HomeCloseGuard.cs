using System;

namespace Launcher.Core
{
    /// <summary>
    /// Schedules the short burst that closes the Home screen opened by the TV.
    /// An explicit request to open that screen cancels the remaining closes and
    /// waits for a close already in progress. All methods run on the UI loop.
    /// </summary>
    internal sealed class HomeCloseGuard
    {
        private static readonly double[] CloseTimes = { 0.15, 0.45, 0.9, 1.6, 2.8 };
        private double _armedAt;
        private int _next;
        private readonly int _targets;
        public int TargetIndex { get; private set; }
        public HomeCloseGuard(int targets = 1) {
            if (targets < 1) throw new ArgumentOutOfRangeException(nameof(targets));
            _targets = targets; _next = CloseTimes.Length * targets;
        }
        private bool _closing;
        private Action _afterClose;

        public void Arm(double now)
        {
            _armedAt = now;
            _next = 0;
            // A new physical Home press supersedes an earlier launch request.
            _afterClose = null;
        }

        public double? NextDelay(double now)
        {
            if (_closing) return 0.025;
            if (_next == CloseTimes.Length * _targets) return null;
            return Math.Max(0.001, _armedAt + CloseTimes[_next / _targets] - now);
        }

        public bool TryBeginClose(double now)
        {
            if (_closing || _next == CloseTimes.Length * _targets || now < _armedAt + CloseTimes[_next / _targets]) return false;
            TargetIndex = _next % _targets;
            _next++;
            _closing = true;
            return true;
        }

        public void CloseFinished()
        {
            _closing = false;
            Action ready = _afterClose;
            _afterClose = null;
            if (ready != null) ready();
        }

        public void Release(Action ready)
        {
            _next = CloseTimes.Length * _targets;
            _afterClose = ready;
            if (!_closing) CloseFinished();
        }
    }
}
