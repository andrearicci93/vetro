using System;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Launcher.Core;
using Launcher.Native;
using Launcher.Ui;

namespace Launcher
{
    internal static partial class Program
    {
        private static readonly CenterPress Center = new CenterPress();
        private static readonly Efl.EvasCb KeyUpCb = OnKeyUp;
        private static readonly Efl.TaskCb HoldCb = OnHold;
        private static readonly Efl.TaskCb RunningCb = OnRunning;
        private static IntPtr _holdTimer, _runningTimer;
        private static bool _centerOptions, _optionsWaiting;
        private static RuntimeClient _runtime;
        private static RunningSnapshot _snapshot;
        private static double _snapshotAt, _nextRead;
        private static Task<RunningSnapshot> _readTask;
        private static Task<StopResult> _stopTask;
        private static AppOptions _options;
        private static AppEntry _optionsApp;
        private static int _optionsGeneration, _stopGeneration;
        private static int _readGeneration, _visibilityGeneration;

        private static void SetupRunning(string[] args, DockLayout layout, string assets)
        {
            _options = new AppOptions(_win, layout, assets);
            try { _runtime = new RuntimeClient(Arg(args, "--api") ?? "http://127.0.0.1:8099"); }
            catch (Exception error) { Log("running apps: " + error.Message); }
        }
        private static void CancelCenter()
        {
            Center.Cancel();
            if (_holdTimer != IntPtr.Zero) { Efl.ecore_timer_del(_holdTimer); _holdTimer = IntPtr.Zero; }
        }
        private static bool HandleOptionsKey(string key)
        {
            if (!_ctl.IsActive) return true;
            if (CenterPress.IsCenter(key))
            {
                bool options = _options.Visible;
                if (!options && (_ctl != _appsCtl || _apps[_ctl.FocusTarget].IsSystem)) return false;
                if (Center.Down(options ? _options.Selected : _ctl.FocusTarget, Efl.ecore_time_get()))
                {
                    _centerOptions = options;
                    if (!options) _holdTimer = Efl.ecore_timer_add(CenterPress.HoldSeconds, HoldCb, IntPtr.Zero);
                }
                ResetIdle(); return true;
            }
            CancelCenter();
            if (!_options.Visible) return false;
            if (key == "Up") _options.Move(-1);
            else if (key == "Down") _options.Move(1);
            else if (key == "Escape" || key == "XF86Back") CloseOptions();
            else if (key == "XF86Home" || key == "XF86Exit") return false;
            ResetIdle(); return true;
        }
        private static byte OnHold(IntPtr data)
        {
            _holdTimer = IntPtr.Zero;
            try
            {
                int index = Center.Hold(Efl.ecore_time_get() + 0.001);
                if (index >= 0 && _ctl == _appsCtl && _ctl.IsActive && index == _ctl.FocusTarget) OpenOptions(index);
            }
            catch (Exception error) { Log("hold: " + error.Message); }
            return 0;
        }
        private static void OnKeyUp(IntPtr data, IntPtr evas, IntPtr obj, IntPtr eventInfo)
        {
            try
            {
                string key = Marshal.PtrToStringAnsi(Marshal.ReadIntPtr(eventInfo));
                if (!CenterPress.IsCenter(key)) return;
                ReleaseCenter();
            }
            catch (Exception error) { Log("key up: " + error.Message); }
        }
        // Raw evdev releases also reach here: some TVs omit the compositor's key-up.
        // Center.Up consumes the press once, so a later Evas release is harmless.
        private static void ReleaseCenter()
        {
            try
            {
                bool held;
                int index = Center.Up(Efl.ecore_time_get(), out held);
                if (_holdTimer != IntPtr.Zero) { Efl.ecore_timer_del(_holdTimer); _holdTimer = IntPtr.Zero; }
                if (index < 0 || !_ctl.IsActive) return;
                if (_centerOptions) { if (_options.Visible && !held) SelectOption(); }
                else if (_ctl == _appsCtl && index == _ctl.FocusTarget)
                {
                    if (held) OpenOptions(index); else Activate(_apps[index]);
                }
            }
            catch (Exception error) { Log("key up: " + error.Message); }
        }
        private static void OpenOptions(int index)
        {
            _optionsApp = _apps[index]; _optionsGeneration++;
            _appsDock.SetVisible(false);
            bool fresh = _snapshot != null && Efl.ecore_time_get() - _snapshotAt < 5;
            _optionsWaiting = !fresh;
            _options.Show(_optionsApp.Label, fresh ? _snapshot.For(_optionsApp.AppId) : null,
                fresh ? null : "Checking running apps…");
            Log("app options: " + _optionsApp.AppId);
            RefreshRunning(); ResetIdle();
        }
        private static void CloseOptions()
        {
            if (_options == null || !_options.Visible) return;
            _optionsGeneration++; _optionsWaiting = false;
            _options.Hide(); _optionsApp = null;
            if (_ctl == _appsCtl) { _appsDock.SetVisible(true); _appsDock.Apply(_appsCtl); }
        }
        private static void SelectOption()
        {
            if (_options.Busy) return;
            var component = _options.SelectedComponent;
            if (component == null) { CloseOptions(); return; }
            if (!component.CanStop) { _options.Status(component.Reason ?? "This component is protected", false); return; }
            if (_runtime == null || _stopTask != null) { _options.Status("App control unavailable", false); return; }
            _options.Status("Stopping…", true); _stopGeneration = _optionsGeneration;
            _stopTask = _runtime.Stop(component); ArmRunningTimer(0.1);
        }
        private static void StopRunningTimer()
        {
            _visibilityGeneration++;
            if (_runningTimer != IntPtr.Zero) { Efl.ecore_timer_del(_runningTimer); _runningTimer = IntPtr.Zero; }
            _snapshot = null; _appsDock?.SetRunning(new bool[_apps.Length]);
        }
        private static void ArmRunningTimer(double seconds)
        {
            if (_runningTimer != IntPtr.Zero) Efl.ecore_timer_del(_runningTimer);
            _runningTimer = Efl.ecore_timer_add(seconds, RunningCb, IntPtr.Zero);
        }
        private static void RefreshRunning()
        {
            if (_runtime == null || _ctl != _appsCtl || !_ctl.IsActive) return;
            _nextRead = 0; ArmRunningTimer(0.01);
        }
        private static byte OnRunning(IntPtr data)
        {
            _runningTimer = IntPtr.Zero;
            if (_ctl != _appsCtl || !_ctl.IsActive) return 0;
            try
            {
                if (_stopTask != null && _stopTask.IsCompleted)
                {
                    string message;
                    try { var result = _stopTask.GetAwaiter().GetResult(); message = result.Error ?? result.Message ?? "Could not confirm stop"; }
                    catch { message = "Could not confirm stop; check running status"; }
                    _stopTask = null; _snapshot = null; _nextRead = 0; _visibilityGeneration++;
                    if (_options.Visible && _stopGeneration == _optionsGeneration)
                        _options.Show(_optionsApp.Label, null, message);
                }
                if (_readTask != null && _readTask.IsCompleted)
                {
                    if (_readGeneration != _visibilityGeneration)
                    {
                        // A response requested before the dock was hidden says
                        // nothing about which apps are running on reopening.
                        _readTask = null; _nextRead = 0;
                    }
                    else
                    {
                        try
                        {
                            _snapshot = _readTask.GetAwaiter().GetResult(); _snapshotAt = Efl.ecore_time_get();
                            _appsDock.SetRunning(_apps.Select(app => !app.IsSystem && _snapshot.For(app.AppId).Length > 0).ToArray());
                            if (_options.Visible && _optionsWaiting)
                            { _options.Show(_optionsApp.Label, _snapshot.For(_optionsApp.AppId)); _optionsWaiting = false; }
                        }
                        catch
                        {
                            _snapshot = null; _appsDock.SetRunning(new bool[_apps.Length]);
                            if (_options.Visible && _optionsWaiting)
                            { _options.Show(_optionsApp.Label, null, "Running status unavailable. Try again shortly."); _optionsWaiting = false; }
                        }
                        _readTask = null; _nextRead = Efl.ecore_time_get() + 2;
                        if (!_options.Visible) _appsDock.Apply(_appsCtl);
                    }
                }
                if (_readTask == null && _stopTask == null && Efl.ecore_time_get() >= _nextRead)
                { _readGeneration = _visibilityGeneration; _readTask = _runtime.Read(); }
                ArmRunningTimer(_readTask != null || _stopTask != null ? 0.1 : 2);
            }
            catch (Exception error) { Log("running apps: " + error.Message); ArmRunningTimer(2); }
            return 0;
        }
    }
}
