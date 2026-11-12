namespace Launcher.Core
{
    internal enum HomeGestureAction { None, Press, Double }

    // Uses kernel event times, not the time buffered reads happen to reach the UI.
    // A pair requires down/up/down from the same input node. Repeats and duplicates
    // cannot complete it; a third quick tap is consumed until the burst ends.
    internal sealed class HomeGesture
    {
        private bool _down, _armed, _consumed;
        private double _first, _last;
        private int _node = -1;
        public void Reset() { _down = _armed = _consumed = false; _node = -1; }
        public HomeGestureAction Feed(int node, int value, double time)
        {
            if (node != _node || time < _last) { Reset(); _node = node; }
            _last = time;
            if (value == 0) { _down = false; return HomeGestureAction.None; }
            if (value == 2) { _armed = false; return HomeGestureAction.None; }
            if (value != 1 || _down) return HomeGestureAction.None;
            _down = true;
            if (time <= 0) { _armed = false; return HomeGestureAction.Press; }
            if (_consumed && time - _first <= 0.35) return HomeGestureAction.None;
            if (_armed && time - _first > 0 && time - _first <= 0.35)
            {
                _armed = false; _consumed = true; _first = time;
                return HomeGestureAction.Double;
            }
            _first = time; _armed = true; _consumed = false;
            return HomeGestureAction.Press;
        }
    }
}
