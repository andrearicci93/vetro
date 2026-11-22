using System;
using System.Threading;
using System.Threading.Tasks;
using Launcher.Core;
using Launcher.Native;

namespace Launcher.Ui
{
    /// <summary>
    /// Enforces C1 Enlightenment window layering on Tizen 9 via <c>org.enlightenment.wm.Test</c> (uid=0):
    /// keeps <c>vetro-idle</c> at layer 250 (strictly below <c>tvlauncher</c>/<c>vetro-numpad</c>/<c>vetro-volume</c>)
    /// while unobstructed, and drops to layer 200 above <c>tv-viewer</c>/<c>tv-viewer-graphics</c>/<c>tvvideosink-area</c>
    /// when translucent partial overlays (<c>com.samsung.tv.shortcut</c>, <c>org.tizen.menu</c>) are active.
    /// </summary>
    internal sealed class WmStackController
    {
        private readonly Action<string> _log;
        private readonly object _gate = new object();
        private bool _busy, _pending, _probed, _active;
        private volatile bool _allowSamsungHome;
        private volatile bool _guardedHomeActive;
        private volatile bool _partialActive;
        private uint _idleWinId;
        private long _burstUntilMs;
        private long _shieldUntilMs;

        public WmStackController(Action<string> log)
        {
            _log = log;
        }

        public bool IsActive { get { return _active; } }

        public bool AllowSamsungHome
        {
            get { return _allowSamsungHome; }
            set
            {
                bool changed = _allowSamsungHome != value;
                _allowSamsungHome = value;
                if (value)
                {
                    lock (_gate) { _shieldUntilMs = 0; }
                    if (changed) EnsureStack(false);
                }
            }
        }

        public bool GuardedHomeActive
        {
            get { return _guardedHomeActive; }
            set { _guardedHomeActive = value; }
        }

        public bool PartialActive
        {
            get { return _partialActive; }
            set
            {
                bool changed = _partialActive != value;
                _partialActive = value;
                if (changed) EnsureStack(value ? 450 : 0);
            }
        }

        /// <summary>
        /// Temporarily elevates <c>vetro-idle</c> to layer 250 (strictly below <c>tvlauncher</c>/<c>vetro-numpad</c>/
        /// <c>vetro-volume</c>) so an unrequested layer-200 Samsung Smart Hub (<c>csfs.dll</c>) cannot flash above it,
        /// then restores layer 200 once the shield expires.
        /// </summary>
        public void ActivateShield(int durationMs)
        {
            if (durationMs <= 0 || _allowSamsungHome) return;
            long now = Environment.TickCount64;
            long until = now + durationMs;
            lock (_gate)
            {
                if (until > _shieldUntilMs) _shieldUntilMs = until;
                long burst = now + 450;
                if (burst > _burstUntilMs) _burstUntilMs = burst;
                if (_busy) { _pending = true; return; }
                _busy = true;
            }
            Task.Run(() => Worker());
        }

        /// <summary>Requests an immediate stack check and a short follow-up burst (~450 ms) for async overlay mapping.</summary>
        public void EnsureStack(bool burst = true)
        {
            EnsureStack(burst ? 450 : 0);
        }

        /// <summary>Requests an immediate stack check and a follow-up burst of <paramref name="burstMs"/> ms.</summary>
        public void EnsureStack(int burstMs)
        {
            long now = Environment.TickCount64;
            lock (_gate)
            {
                if (burstMs > 0)
                {
                    long until = now + burstMs;
                    if (until > _burstUntilMs) _burstUntilMs = until;
                }
                if (_busy) { _pending = true; return; }
                _busy = true;
            }
            Task.Run(() => Worker());
        }

        private void Worker()
        {
            try
            {
                while (true)
                {
                    Step();
                    long now = Environment.TickCount64;
                    long remBurst, remShield;
                    bool again;
                    lock (_gate)
                    {
                        remBurst = _burstUntilMs - now;
                        remShield = _allowSamsungHome ? 0 : (_shieldUntilMs - now);
                        again = _pending || remBurst > 0 || remShield > 0;
                        _pending = false;
                        if (!again) { _busy = false; return; }
                    }
                    if (remBurst > 0) Thread.Sleep(150);
                    else if (remShield > 0) Thread.Sleep((int)Math.Min(400, remShield + 20));
                }
            }
            catch (Exception ex)
            {
                if (_log != null) _log("wm stack: " + ex.Message);
                lock (_gate) { _busy = false; _pending = false; }
            }
        }

        private void Step()
        {
            bool shieldTime;
            lock (_gate) { shieldTime = Environment.TickCount64 < _shieldUntilMs; }
            WmStackLogic.Step(Shell.Read, _allowSamsungHome, _guardedHomeActive, _partialActive, shieldTime, ref _active, ref _probed, ref _idleWinId, _log);
        }
    }
}
