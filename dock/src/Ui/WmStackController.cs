using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Launcher.Core;
using Launcher.Native;

namespace Launcher.Ui
{
    /// <summary>
    /// Enforces C1 Enlightenment window layering on Tizen 9 via <c>org.enlightenment.wm.Test</c> (uid=0):
    /// promotes <c>tvlauncher</c>/<c>vetro-numpad</c>/<c>vetro-volume</c> to Layer 500 (<c>E_LAYER_CLIENT_TOP</c>),
    /// keeps steady-state <c>vetro-idle</c> on Layer 200 above <c>tv-viewer</c>/<c>tv-viewer-graphics</c>/<c>tvvideosink-area</c>,
    /// elevates <c>vetro-idle</c> to Layer 250 only during active shield or guarded-home teardown, tracks app launches
    /// with pre-launch snapshots and 250 ms <c>vconf</c> resync, and publishes live <c>GetWinsInfo</c> ground truth.
    /// </summary>
    internal sealed class WmStackController
    {
        private sealed class DbusEnlightenmentWmBackend : IEnlightenmentWmBackend
        {
            private readonly ShellEnlightenmentWmBackend _shellFallback = new ShellEnlightenmentWmBackend(Shell.Read);

            public bool TryGetWinsInfo(out List<WmStackLogic.WinInfo> wins)
            {
                return DbusBus.TryGetWinsInfo(out wins);
            }

            public bool TryGetWindowNotiLevel(uint winId, out int level)
            {
                return DbusBus.TryGetWindowNotiLevel(winId, out level);
            }

            public bool TrySetWindowNotiLevel(uint winId, int level)
            {
                return DbusBus.TrySetWindowNotiLevel(winId, level);
            }

            public bool TrySetWindowStack(uint winId, uint baseWinId, int mode)
            {
                return DbusBus.TrySetWindowStack(winId, baseWinId, mode);
            }

            public bool TrySetWindowNotiLevelAndStack(uint winId, int level, uint baseWinId, int mode)
            {
                bool ok = DbusBus.TrySetWindowNotiLevel(winId, level);
                if (ok) ok = DbusBus.TrySetWindowStack(winId, baseWinId, mode);
                return ok || _shellFallback.TrySetWindowNotiLevelAndStack(winId, level, baseWinId, mode);
            }

            public bool TryPromoteOverlays(IReadOnlyList<uint> overlayWinIds, int layer)
            {
                if (overlayWinIds == null || overlayWinIds.Count == 0) return true;
                for (int i = 0; i < overlayWinIds.Count; i++)
                {
                    if (!DbusBus.TrySetWindowNotiLevel(overlayWinIds[i], layer))
                        return _shellFallback.TryPromoteOverlays(overlayWinIds, layer);
                }
                return true;
            }

            public bool TrySyncFullscreenAppId(string appId)
            {
                return _shellFallback.TrySyncFullscreenAppId(appId);
            }
        }

        private static readonly IEnlightenmentWmBackend NativeBackend = new DbusEnlightenmentWmBackend();

        private readonly Action<string> _log;
        private readonly Action _onObserved;
        private readonly object _gate = new object();
        private readonly object _stepGate = new object();
        private bool _busy, _pending, _probed, _active;
        private volatile bool _allowSamsungHome;
        private volatile bool _guardedHomeActive;
        private volatile bool _partialActive;
        private volatile bool _screensaverActive;
        private volatile bool _screensaverTakeover;
        private volatile bool _launchingApp;
        private volatile bool _idleShown;
        private volatile bool _minimizedActive;
        private uint _idleWinId;
        private long _burstUntilMs;
        private long _fastBurstUntilMs;
        private long _shieldUntilMs;
        private long _launchUntilMs;
        private WmLaunchState _launchState;
        private bool _homeOccluded;
        private bool _hasObservedWindows;
        private bool _guardedHomeWinPresent;
        private bool _activeAppWinPresent;
        private bool _launchscreenWinPresent;
        private bool _screensaverWinPresent;
        private bool _launchTargetReady;
        private long _completedSeq;

        public WmStackController(Action<string> log, Action onObserved = null)
        {
            _log = log;
            _onObserved = onObserved;
        }

        public bool IsActive { get { return Volatile.Read(ref _active); } }
        public bool IsHomeOccluded { get { return Volatile.Read(ref _homeOccluded); } }
        public bool HasObservedWindows { get { return Volatile.Read(ref _hasObservedWindows); } }
        public bool GuardedHomeWinPresent { get { return Volatile.Read(ref _guardedHomeWinPresent); } }
        public bool ActiveAppWinPresent { get { return Volatile.Read(ref _activeAppWinPresent); } }
        public bool LaunchscreenWinPresent { get { return Volatile.Read(ref _launchscreenWinPresent); } }
        public bool ScreensaverWinPresent { get { return Volatile.Read(ref _screensaverWinPresent); } }
        public bool LaunchTargetReady { get { return Volatile.Read(ref _launchTargetReady); } }
        public long CompletedSeq { get { lock (_gate) { return _completedSeq; } } }

        public void InvalidateObservation()
        {
            Volatile.Write(ref _hasObservedWindows, false);
            Volatile.Write(ref _launchTargetReady, false);
        }

        public bool AllowSamsungHome
        {
            get { return _allowSamsungHome; }
            set
            {
                bool changed = _allowSamsungHome != value;
                _allowSamsungHome = value;
                if (value)
                {
                    lock (_gate) { _shieldUntilMs = 0; Monitor.PulseAll(_gate); }
                    if (changed) EnsureStack(false);
                }
            }
        }

        public bool GuardedHomeActive
        {
            get { return _guardedHomeActive; }
            set { _guardedHomeActive = value; }
        }

        public bool MinimizedActive
        {
            get { return _minimizedActive; }
            set { _minimizedActive = value; }
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

        public bool ScreensaverActive
        {
            get { return _screensaverActive; }
            set
            {
                bool changed = _screensaverActive != value;
                _screensaverActive = value;
                if (value)
                {
                    lock (_gate) { _shieldUntilMs = 0; Monitor.PulseAll(_gate); }
                }
                if (changed) EnsureStack(value ? 2500 : 450);
            }
        }

        public bool ScreensaverTakeover
        {
            get { return _screensaverTakeover; }
            set
            {
                bool changed = _screensaverTakeover != value;
                _screensaverTakeover = value;
                if (changed) EnsureStack(1500);
            }
        }

        public bool IdleShown
        {
            get { return _idleShown; }
            set
            {
                bool changed = _idleShown != value;
                _idleShown = value;
                if (changed)
                {
                    lock (_gate)
                    {
                        if (value && _launchingApp && Environment.TickCount64 < _launchUntilMs)
                        {
                            if (_busy) { _pending = true; Monitor.PulseAll(_gate); return; }
                            _busy = true;
                        }
                        else
                        {
                            Monitor.PulseAll(_gate);
                            return;
                        }
                    }
                    Task.Run(() => Worker());
                }
            }
        }

        public bool LaunchingApp
        {
            get { return _launchingApp; }
            set
            {
                bool changed = _launchingApp != value;
                _launchingApp = value;
                if (value)
                {
                    lock (_gate)
                    {
                        _shieldUntilMs = 0;
                        _burstUntilMs = 0;
                        if (_launchState == null)
                        {
                            _launchState = new WmLaunchState { StartedAtMs = Environment.TickCount64 };
                            _launchUntilMs = Environment.TickCount64 + 6500;
                        }
                        Monitor.PulseAll(_gate);
                    }
                }
                else
                {
                    lock (_gate)
                    {
                        _launchUntilMs = 0;
                        _launchState = null;
                        Monitor.PulseAll(_gate);
                    }
                    Volatile.Write(ref _launchTargetReady, false);
                }
                if (changed) EnsureStack(0);
            }
        }

        /// <summary>
        /// Starts an app-launch window-stack tracking episode: snapshots pre-existing Layer-200 windows so paused apps
        /// (such as old <c>cobalt-app</c>) stay covered below <c>vetro-idle</c>, drops <c>vetro-idle</c> to Layer 200,
        /// and polls at 120 ms while <c>vetro-idle</c> is shown so newly mapped/raised Layer-200 apps (e.g. WRT web apps
        /// <c>Nuvio TV</c> / <c>Player.pl</c>) are immediately stacked above <c>vetro-idle</c>.
        /// </summary>
        public void BeginAppLaunch(string targetAppId, string targetLabel, string lastPausedAppId, bool viaShard, int durationMs, bool syncDrop, int timeoutMs = 100, string lastForceClosedAppId = "")
        {
            long now = Environment.TickCount64;
            int dur = durationMs > 0 ? durationMs : (viaShard ? 8500 : 6500);
            bool startWorker = false;
            lock (_gate)
            {
                string cleanTarget = targetAppId ?? "";
                string cleanLabel = targetLabel ?? "";
                bool reuseExisting = _launchingApp
                    && _launchState != null
                    && now < _launchUntilMs
                    && (now - _launchState.StartedAtMs) < 500
                    && (string.IsNullOrEmpty(cleanTarget)
                        || string.IsNullOrEmpty(_launchState.TargetAppId)
                        || IdleBackdropModel.SameLaunchAppOrYouTubeAlias(cleanTarget, _launchState.TargetAppId));
                if (reuseExisting)
                {
                    if (string.IsNullOrEmpty(_launchState.TargetAppId) && !string.IsNullOrEmpty(cleanTarget))
                    {
                        _launchState.TargetAppId = cleanTarget;
                        _launchState.IsYoutubeTarget = WmStackLogic.IsYoutubeTargetApp(cleanTarget);
                    }
                    if (string.IsNullOrEmpty(_launchState.TargetLabel) && !string.IsNullOrEmpty(cleanLabel))
                        _launchState.TargetLabel = cleanLabel;
                    if (string.IsNullOrEmpty(_launchState.LastPausedAppId) && !string.IsNullOrEmpty(lastPausedAppId))
                        _launchState.LastPausedAppId = lastPausedAppId;
                    if (string.IsNullOrEmpty(_launchState.LastForceClosedAppId) && !string.IsNullOrEmpty(lastForceClosedAppId))
                        _launchState.LastForceClosedAppId = lastForceClosedAppId;
                }
                else
                {
                    Volatile.Write(ref _launchTargetReady, false);
                    _launchState = new WmLaunchState
                    {
                        TargetAppId = cleanTarget,
                        TargetLabel = cleanLabel,
                        LastPausedAppId = lastPausedAppId ?? "",
                        LastForceClosedAppId = lastForceClosedAppId ?? "",
                        IsYoutubeTarget = WmStackLogic.IsYoutubeTargetApp(cleanTarget),
                        StartedAtMs = now
                    };
                }
                _launchingApp = true;
                _shieldUntilMs = 0;
                _burstUntilMs = 0;
                long until = now + dur;
                if (until > _launchUntilMs) _launchUntilMs = until;
            }
            if (syncDrop)
            {
                try
                {
                    Task t = Task.Run(() => Step());
                    if (timeoutMs > 0) t.Wait(timeoutMs);
                }
                catch (Exception ex)
                {
                    if (_log != null) _log("wm stack launch: " + ex.Message);
                }
            }
            lock (_gate)
            {
                if (_busy) { _pending = true; Monitor.PulseAll(_gate); }
                else { _busy = true; startWorker = true; }
            }
            if (startWorker) Task.Run(() => Worker());
        }

        /// <summary>
        /// Drops <c>vetro-idle</c> from LayerShield (250) to LayerNormal (200) bounded to <paramref name="timeoutMs"/> ms,
        /// preserving any active <see cref="WmLaunchState"/> pre-launch snapshot and waking the 120 ms launch stack watcher.
        /// </summary>
        public void DropForLaunchSync(int timeoutMs = 100)
        {
            long now = Environment.TickCount64;
            bool startWorker = false;
            lock (_gate)
            {
                _launchingApp = true;
                _shieldUntilMs = 0;
                _burstUntilMs = 0;
                if (_launchState == null) _launchState = new WmLaunchState { StartedAtMs = now };
                if (_launchUntilMs <= now) _launchUntilMs = now + 6500;
            }
            try
            {
                Task t = Task.Run(() => Step());
                if (timeoutMs > 0) t.Wait(timeoutMs);
            }
            catch (Exception ex)
            {
                if (_log != null) _log("wm stack drop: " + ex.Message);
            }
            lock (_gate)
            {
                if (_busy) { _pending = true; Monitor.PulseAll(_gate); }
                else if (_idleShown) { _busy = true; startWorker = true; }
            }
            if (startWorker) Task.Run(() => Worker());
        }

        /// <summary>
        /// Immediately elevates <c>vetro-idle</c> to LayerShield (250) synchronously (bounded so the EFL main loop
        /// never stalls) when covering an unrequested Samsung Home (<c>csfs</c>) flash, then arms the normal shield burst.
        /// </summary>
        public void EnsureShieldSync(int durationMs = 3000, int timeoutMs = 120)
        {
            _launchingApp = false;
            if (_allowSamsungHome || _screensaverActive) return;
            long now = Environment.TickCount64;
            long until = now + (durationMs > 0 ? durationMs : 3000);
            lock (_gate)
            {
                if (until > _shieldUntilMs) _shieldUntilMs = until;
                long burst = now + 450;
                if (burst > _burstUntilMs) _burstUntilMs = burst;
            }
            try
            {
                Task t = Task.Run(() => Step());
                if (timeoutMs > 0) t.Wait(timeoutMs);
            }
            catch (Exception ex)
            {
                if (_log != null) _log("wm stack shield: " + ex.Message);
            }
            EnsureStack(1500);
        }

        /// <summary>
        /// Temporarily elevates <c>vetro-idle</c> to layer 250 (strictly below <c>tvlauncher</c>/<c>vetro-numpad</c>/
        /// <c>vetro-volume</c>) so an unrequested layer-200 Samsung Smart Hub (<c>csfs.dll</c>) cannot flash above it,
        /// then restores layer 200 once the shield expires.
        /// </summary>
        public void ActivateShield(int durationMs)
        {
            if (durationMs <= 0 || _allowSamsungHome || _launchingApp || _screensaverActive) return;
            long now = Environment.TickCount64;
            long until = now + durationMs;
            lock (_gate)
            {
                if (until > _shieldUntilMs) _shieldUntilMs = until;
                long burst = now + 450;
                if (burst > _burstUntilMs) _burstUntilMs = burst;
                long fast = now + 300;
                if (fast > _fastBurstUntilMs) _fastBurstUntilMs = fast;
                if (_busy) { _pending = true; Monitor.PulseAll(_gate); return; }
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
                    long fast = now + Math.Min(burstMs, 300);
                    if (fast > _fastBurstUntilMs) _fastBurstUntilMs = fast;
                }
                if (_busy) { _pending = true; Monitor.PulseAll(_gate); return; }
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
                    bool lastStepShielded = false;
                    try
                    {
                        lastStepShielded = Step();
                    }
                    finally
                    {
                        lock (_gate)
                        {
                            _completedSeq++;
                            Monitor.PulseAll(_gate);
                        }
                    }
                    long now = Environment.TickCount64;
                    lock (_gate)
                    {
                        long remBurst = _burstUntilMs - now;
                        long remShield = (_allowSamsungHome || _launchingApp || _screensaverActive) ? 0 : (_shieldUntilMs - now);
                        long remLaunch = (_launchingApp && _idleShown) ? (_launchUntilMs - now) : 0;
                        bool fastRetry = remBurst > 0 && now < _fastBurstUntilMs && (_idleWinId == 0 || remShield > 0);
                        int sleepMs;
                        if (!WmStackLogic.ShouldContinueWorker(_pending, remBurst, remShield, remLaunch, lastStepShielded, fastRetry, out sleepMs))
                        {
                            _busy = false;
                            return;
                        }
                        _pending = false;
                        if (sleepMs > 0) Monitor.Wait(_gate, sleepMs);
                    }
                }
            }
            catch (Exception ex)
            {
                if (_log != null) _log("wm stack: " + ex.Message);
                Volatile.Write(ref _homeOccluded, false);
                lock (_gate) { _busy = false; _pending = false; Monitor.PulseAll(_gate); }
            }
        }

        private volatile string _cachedFullscreenAppId = "";
        public string CachedFullscreenAppId
        {
            get { return _cachedFullscreenAppId; }
            set { _cachedFullscreenAppId = value ?? ""; }
        }

        private bool Step()
        {
            bool shieldTime;
            bool launching;
            bool saverActive;
            WmLaunchState ls;
            long nowMs = Environment.TickCount64;
            lock (_gate)
            {
                bool takeEarlySnapshot = _launchingApp && _launchState != null && !_launchState.SnapshotTaken && nowMs < _launchUntilMs;
                launching = (_launchingApp && _idleShown) || takeEarlySnapshot;
                saverActive = _screensaverActive;
                shieldTime = !launching && !saverActive && nowMs < _shieldUntilMs;
                ls = launching ? _launchState : null;
            }
            bool effectiveShield = _screensaverTakeover || (shieldTime && !_allowSamsungHome && !launching && !saverActive);
            WmStackObservation obs;
            bool active = Volatile.Read(ref _active);
            lock (_stepGate)
            {
                WmStackLogic.Step(NativeBackend, _allowSamsungHome, _guardedHomeActive, _partialActive, effectiveShield, saverActive, ref active, ref _probed, ref _idleWinId, out obs, _log, launching, ls, nowMs, () => _cachedFullscreenAppId, _screensaverTakeover, _minimizedActive);
            }
            bool prevObserved = Volatile.Read(ref _hasObservedWindows);
            bool prevHome = Volatile.Read(ref _guardedHomeWinPresent);
            bool prevApp = Volatile.Read(ref _activeAppWinPresent);
            bool prevLaunchscreen = Volatile.Read(ref _launchscreenWinPresent);
            bool prevScreensaver = Volatile.Read(ref _screensaverWinPresent);
            bool prevLaunchTargetReady = Volatile.Read(ref _launchTargetReady);
            Volatile.Write(ref _active, active);
            Volatile.Write(ref _homeOccluded, obs.HomeOccluded);
            if (obs.Observed)
            {
                Volatile.Write(ref _guardedHomeWinPresent, obs.GuardedHomeWinPresent);
                Volatile.Write(ref _activeAppWinPresent, obs.ActiveAppWinPresent);
                Volatile.Write(ref _launchscreenWinPresent, obs.LaunchscreenWinPresent);
                Volatile.Write(ref _screensaverWinPresent, obs.ScreensaverWinPresent);
                Volatile.Write(ref _launchTargetReady, obs.LaunchTargetReady);
                Volatile.Write(ref _hasObservedWindows, true);
                bool changed = !prevObserved
                    || prevHome != obs.GuardedHomeWinPresent
                    || prevApp != obs.ActiveAppWinPresent
                    || prevLaunchscreen != obs.LaunchscreenWinPresent
                    || prevScreensaver != obs.ScreensaverWinPresent
                    || prevLaunchTargetReady != obs.LaunchTargetReady;
                if (changed && _onObserved != null)
                {
                    try { _onObserved(); } catch (Exception) { }
                }
            }
            return effectiveShield;
        }
    }
}
