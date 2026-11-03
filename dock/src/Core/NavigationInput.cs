using System;

namespace Launcher.Core
{
    // Each raw press is handled immediately; only its later compositor copy is discarded.
    internal sealed class NavigationInput
    {
        private static readonly int[] Codes = { 105, 106, 103, 108, 28, 1 };
        private static readonly string[] Keys = { "Left", "Right", "Up", "Down", "Return", "XF86Back" };
        private readonly int[] _pending = new int[6];
        private readonly double[] _at = new double[6];
        private const double EchoSeconds = 1.0;

        private static int Bucket(string key)
        {
            switch (key)
            {
                case "Left": return 0;
                case "Right": return 1;
                case "Up": return 2;
                case "Down": return 3;
                case "Return": case "KP_Enter": case "Select": return 4;
                case "XF86Back": case "Escape": return 5;
                default: return -1;
            }
        }

        public string Press(int code, bool active, double now)
        {
            int i = Array.IndexOf(Codes, code);
            if (i < 0 || !active) return null;
            if (now - _at[i] >= EchoSeconds) _pending[i] = 0;
            _pending[i]++;
            _at[i] = now;
            return Keys[i];
        }

        public bool IsEcho(string key, double now)
        {
            int i = Bucket(key);
            if (i < 0 || _pending[i] == 0) return false;
            if (now - _at[i] >= EchoSeconds) { _pending[i] = 0; return false; }
            _pending[i]--;
            return true;
        }
    }
}
