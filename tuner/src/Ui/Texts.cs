using System;
using System.Collections.Generic;
using Tuner.Core;
using Tuner.Native;

namespace Tuner.Ui
{
    /// <summary>
    /// Every text, font and style the views put on a text object goes through here, so the tuner knows what each object holds: a text that is
    /// already on its object is not set again (setting a text lays it out again, and with the halo that is the soft shadow too), its width is read
    /// once, and a cut with an ellipsis (<see cref="TextFit"/>) is measured only the first time that text meets that width in that font
    /// (<see cref="FitCache"/>). Nothing else may call evas_object_text_text_set or evas_object_text_font_set. UI thread only.
    /// </summary>
    internal static class Texts
    {
        private sealed class State { public string Font; public int Size; public int Style; public string Shown; public int Advance = -1; }
        private static readonly Dictionary<IntPtr, State> States = new Dictionary<IntPtr, State>(new PtrComparer());

        /// <summary>Compares the pointers themselves: a lookup never boxes, whatever the runtime's default comparer for IntPtr does.</summary>
        private sealed class PtrComparer : IEqualityComparer<IntPtr>
        {
            public bool Equals(IntPtr a, IntPtr b) { return a == b; }
            public int GetHashCode(IntPtr p) { return p.GetHashCode(); }
        }
        private static readonly FitCache Fits = new FitCache();

        /// <summary>Counters for --perf: texts really set on an object, cuts measured (each several layouts), cuts found in the cache.</summary>
        public static long NativeSets, FitsMeasured, FitsKept;

        private static State Of(IntPtr t)
        {
            State s;
            if (!States.TryGetValue(t, out s)) { s = new State(); States[t] = s; }
            return s;
        }

        /// <summary>A new text object in this font and size (Surface.Text).</summary>
        public static void Created(IntPtr t, string font, int size)
        {
            Efl.evas_object_text_font_set(t, font, size);
            State s = Of(t);
            s.Font = font; s.Size = size; s.Advance = -1;
        }

        public static void Style(IntPtr t, int style)
        {
            Efl.evas_object_text_style_set(t, style);
            State s = Of(t);
            s.Style = style; s.Advance = -1;
        }

        public static void Font(IntPtr t, string font, int size)
        {
            State s = Of(t);
            if (s.Font == font && s.Size == size) return;
            Efl.evas_object_text_font_set(t, font, size);
            s.Font = font; s.Size = size; s.Advance = -1;
        }

        public static void Set(IntPtr t, string text)
        {
            text = text ?? "";
            State s = Of(t);
            if (s.Shown == text) return;
            Raw(t, s, text);
        }

        private static void Raw(IntPtr t, State s, string text)
        {
            Efl.evas_object_text_text_set(t, text);
            NativeSets++;
            s.Shown = text; s.Advance = -1;
        }

        /// <summary>The width of what the object holds (evas_object_text_horiz_advance_get, read once per text).</summary>
        public static int Advance(IntPtr t)
        {
            State s = Of(t);
            if (s.Advance < 0) s.Advance = Efl.evas_object_text_horiz_advance_get(t);
            return s.Advance;
        }

        /// <summary>Puts <paramref name="text"/> on the object, cut with an ellipsis until it fits <paramref name="maxW"/> pixels.</summary>
        public static void Fit(IntPtr t, string text, int maxW)
        {
            text = text ?? "";
            if (text.Length <= 1) { Set(t, text); return; }                // nothing to cut, nothing to measure
            State s = Of(t);
            Fitted f;
            if (Fits.TryGet(s.Font, s.Size, s.Style, text, maxW, out f))
            {
                FitsKept++;
                Set(t, f.Text);
                if (s.Advance < 0) s.Advance = f.Advance;
                return;
            }
            FitsMeasured++;
            string cut = TextFit.Fit(text, maxW, c => { if (s.Shown != c) Raw(t, s, c); return Advance(t); });
            Set(t, cut);
            Fits.Put(s.Font, s.Size, s.Style, text, maxW, new Fitted(cut, Advance(t)));
        }
    }
}
