using System.Globalization;

namespace Launcher.Core
{
    /// <summary>
    /// --perf: how long an opening takes on the TV, from the key (or fifo word) to the frames on screen. <see cref="Begin"/> on the key,
    /// <see cref="HandlerDone"/> when the key's own handler returns, <see cref="Tick"/> on every animator tick of the opening; the last tick
    /// returns one log line. The first tick is when the first frame is laid out; the second starts once that frame has gone to the screen,
    /// so "to first frame" is the key to the second tick. Nothing is allocated before that last line.
    /// </summary>
    internal sealed class OpenProbe
    {
        private string _what;
        private double _key, _handler, _first, _second, _prev, _maxGap;
        private int _frames;

        public bool Active { get; private set; }

        public void Begin(string what, double now)
        {
            _what = what; _key = now; _handler = -1; _first = -1; _second = -1; _prev = 0; _maxGap = 0; _frames = 0;
            Active = true;
        }

        public void HandlerDone(double now) { if (Active && _handler < 0) _handler = now - _key; }

        /// <summary>One animator tick that started at <paramref name="now"/>; <paramref name="last"/>: the opening has ended with it.</summary>
        public string Tick(double now, bool last)
        {
            if (!Active) return null;
            if (_frames == 0) _first = now - _key;
            else
            {
                if (_frames == 1) _second = now - _key;
                if (now - _prev > _maxGap) _maxGap = now - _prev;
            }
            _prev = now;
            _frames++;
            if (!last) return null;
            Active = false;
            return string.Format(CultureInfo.InvariantCulture,
                "perf open {0}: frames={1} key to first tick ms={2:0.0} to first frame ms={3:0.0} to last frame ms={4:0.0} handler ms={5:0.0} interval ms max={6:0.0}",
                _what, _frames, _first * 1000, (_second < 0 ? _first : _second) * 1000, (now - _key) * 1000, (_handler < 0 ? 0 : _handler) * 1000, _maxGap * 1000);
        }

        /// <summary>Forgets an opening that was cut short (the window went away first) without a line.</summary>
        public void Cancel() { Active = false; }
    }
}
