namespace Launcher.Core
{
    // Launch only on release; repeats never reset the hold deadline. A hold's
    // release is consumed so it cannot also launch or activate a stop action.
    internal sealed class CenterPress
    {
        public const double HoldSeconds = 0.75;
        private int _target = -1;
        private double _down;
        private bool _held;
        public bool Down(int target, double now)
        {
            if (_target >= 0) return false;
            _target = target; _down = now; _held = false; return true;
        }
        public int Hold(double now)
        {
            if (_target < 0 || _held || now - _down < HoldSeconds) return -1;
            _held = true; return _target;
        }
        public int Up(double now, out bool held)
        {
            held = false;
            if (_target < 0) return -1;
            int target = _held ? -1 : _target;
            held = !_held && now - _down >= HoldSeconds;
            Cancel(); return target;
        }
        public void Cancel() { _target = -1; _held = false; }
        public static bool IsCenter(string key) { return key == "Return" || key == "KP_Enter" || key == "Select"; }
    }
}
