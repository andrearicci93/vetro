using System;
using System.Collections.Generic;

namespace Tuner.Core
{
    /// <summary>
    /// Cutting a text with an ellipsis until it fits a width, and remembering the result. Pure: the measure is given (on the TV it sets the text on
    /// the object and reads its advance, which lays the text out again each time). The views cut the same strings over and over (a guide key
    /// moves most titles to another text object; the programme arrives a second time with the same title), so the result of a cut is kept per
    /// font, size, style, text and width: the same five always give the same cut.
    /// </summary>
    internal static class TextFit
    {
        /// <summary>The longest beginning of <paramref name="s"/> that fits <paramref name="maxW"/> with "…", found by halving; <paramref name="s"/> itself when it fits.</summary>
        public static string Fit(string s, int maxW, Func<string, int> measure)
        {
            s = s ?? "";
            if (s.Length <= 1 || measure(s) <= maxW) return s;
            int lo = 1, hi = s.Length - 1;
            while (lo < hi)
            {
                int mid = (lo + hi + 1) / 2;
                if (measure(s.Substring(0, mid).TrimEnd() + "…") <= maxW) lo = mid; else hi = mid - 1;
            }
            return s.Substring(0, lo).TrimEnd() + "…";
        }
    }

    /// <summary>What a cut gave: the text to show and its width.</summary>
    internal struct Fitted
    {
        public string Text;
        public int Advance;
        public Fitted(string text, int advance) { Text = text; Advance = advance; }
    }

    /// <summary>The cuts made so far, by (font, size, style, text, width). Bounded: past <see cref="Max"/> entries it starts again. UI thread only.</summary>
    internal sealed class FitCache
    {
        public const int Max = 1024;
        private readonly Dictionary<(string, int, int, string, int), Fitted> _items = new Dictionary<(string, int, int, string, int), Fitted>();

        public int Count { get { return _items.Count; } }

        public bool TryGet(string font, int size, int style, string text, int maxW, out Fitted f)
        {
            return _items.TryGetValue((font, size, style, text ?? "", maxW), out f);
        }

        public void Put(string font, int size, int style, string text, int maxW, Fitted f)
        {
            if (_items.Count >= Max) _items.Clear();
            _items[(font, size, style, text ?? "", maxW)] = f;
        }
    }

    /// <summary>Widths of texts by (text, size, weight), for the words a view measures again on every draw (the guide's footer, the focused programme's paragraph). Bounded: past <see cref="Max"/> entries it starts again.</summary>
    internal sealed class WidthCache
    {
        public readonly int Max;
        private readonly Dictionary<(string, int, int), int> _items = new Dictionary<(string, int, int), int>();

        public WidthCache(int max = 512) { Max = max; }

        public int Count { get { return _items.Count; } }

        public int Get(string text, int size, int weight, Func<string, int, int, int> measure)
        {
            text = text ?? "";
            int w;
            if (_items.TryGetValue((text, size, weight), out w)) return w;
            w = measure(text, size, weight);
            if (_items.Count >= Max) _items.Clear();
            _items[(text, size, weight)] = w;
            return w;
        }
    }
}
