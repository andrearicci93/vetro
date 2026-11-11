using System;
using System.Collections.Generic;
using Tuner.Core;
using Tuner.Native;

namespace Tuner.Ui
{
    /// <summary>
    /// The TV guide on screen. It draws the list of primitives <see cref="GuideScene"/> builds (so what the offline preview shows is what this
    /// shows) onto a fixed set of objects made once: the sheet, <see cref="GuideScene.MaxFills"/> tinted rectangles, one ring, and text objects.
    /// Created the first time the guide is opened, not at start-up: the guide has about 400 objects and most runs never open it.
    /// </summary>
    internal sealed class GuideView
    {
        private readonly Surface _s;
        private readonly Card _card;
        private readonly Chip[] _fills = new Chip[GuideScene.MaxFills];
        private readonly Chip _ring;
        private readonly Logo[] _logos = new Logo[GuideScene.MaxLogos];
        private readonly IntPtr[] _texts = new IntPtr[GuideScene.MaxTexts];
        private readonly string[] _lastText = new string[GuideScene.MaxTexts];
        private readonly int[] _lastSize = new int[GuideScene.MaxTexts], _lastW = new int[GuideScene.MaxTexts];
        private readonly Dictionary<string, IntPtr> _keys = new Dictionary<string, IntPtr>();   // the footer's remote key pictures, one object each
        private readonly HashSet<string> _keysShown = new HashSet<string>();
        private int _fillsUsed, _textsUsed;

        public GuideView(Surface s)
        {
            _s = s;
            _card = s.Card();
            _card.SetOpacity(242);          // the guide's sheet is at 95%: a little of the picture shows through
            for (int i = 0; i < _fills.Length; i++) _fills[i] = s.Chip();
            _ring = s.Ring();
            for (int i = 0; i < _logos.Length; i++) _logos[i] = s.Logo();
            for (int i = 0; i < _texts.Length; i++) { _texts[i] = s.Text(24, Theme.TextMain); Efl.evas_object_hide(_texts[i]); }
            foreach (string k in GuideScene.KeyNames) _keys[k] = s.Picture(k);
        }

        public bool Visible { get { return _s.Visible; } }
        public void Hide() { _s.Hide(); }

        public void Draw(List<Prim> scene)
        {
            int fills = 0, texts = 0, logos = 0;
            bool ring = false;
            _keysShown.Clear();
            foreach (Prim p in scene)
            {
                switch (p.Kind)
                {
                    case PrimKind.Sheet: _card.SetRect(p.X, p.Y, p.W, p.H); break;
                    case PrimKind.Fill:
                        if (fills < _fills.Length) { _fills[fills].SetRect(p.X, p.Y, p.W, p.H); if (p.Tint != 0) _fills[fills].SetTint(p.Tint, p.Alpha); else _fills[fills].SetWhite(p.Alpha); fills++; }
                        break;
                    case PrimKind.Ring: _ring.SetRect(p.X, p.Y, p.W, p.H); _ring.SetWhite(p.Alpha); ring = true; break;
                    case PrimKind.Text: texts = Text(p, texts); break;
                    case PrimKind.Logo: if (logos < _logos.Length) _logos[logos++].Show(p.Text, p.X, p.Y, p.W); break;
                    case PrimKind.Key:
                        IntPtr k;
                        if (_keys.TryGetValue(p.Text, out k) && _keysShown.Add(p.Text))
                        {
                            Efl.evas_object_move(k, p.X, p.Y); Efl.evas_object_resize(k, p.W, p.H);
                            Efl.evas_object_color_set(k, p.Alpha, p.Alpha, p.Alpha, p.Alpha); Efl.evas_object_show(k);
                        }
                        break;
                }
            }
            if (!ring) _ring.SetWhite(0);
            foreach (var kv in _keys) if (!_keysShown.Contains(kv.Key)) Efl.evas_object_hide(kv.Value);
            for (int i = logos; i < _logos.Length; i++) _logos[i].Hide();
            for (int i = fills; i < _fillsUsed; i++) _fills[i].SetWhite(0);
            for (int i = texts; i < _textsUsed; i++) Efl.evas_object_hide(_texts[i]);
            _fillsUsed = fills; _textsUsed = texts;
            _s.Show();
        }

        /// <summary>Puts a text primitive on the next free text object (a paragraph takes one object a line). Returns the next free index.</summary>
        private int Text(Prim p, int at)
        {
            if (at >= _texts.Length) return at;
            if (p.Lines <= 1) { Place(at, p.Text, p.Size, p.Alpha, p.X, p.Y, p.MaxW, p.Right); return at + 1; }
            // paragraph: fill the lines greedily with words, measuring on the object that will show the line
            string[] words = p.Text.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            int w = 0;
            for (int line = 0; line < p.Lines && at < _texts.Length; line++)
            {
                string cur = "";
                IntPtr t = _texts[at];
                Efl.evas_object_text_font_set(t, Theme.Font, p.Size);
                while (w < words.Length)
                {
                    string next = cur.Length == 0 ? words[w] : cur + " " + words[w];
                    Efl.evas_object_text_text_set(t, next);
                    if (Efl.evas_object_text_horiz_advance_get(t) > p.MaxW && cur.Length > 0) break;
                    cur = next; w++;
                }
                bool last = line == p.Lines - 1 && w < words.Length;           // more words than lines: the last line ends with an ellipsis
                if (last) cur += " " + string.Join(" ", words, w, words.Length - w);
                Place(at, cur, p.Size, p.Alpha, p.X, p.Y + line * (int)(p.Size * 1.35), p.MaxW, false);
                at++;
                if (w >= words.Length) break;
            }
            return at;
        }

        private void Place(int i, string text, int size, int alpha, int x, int y, int maxW, bool right)
        {
            IntPtr t = _texts[i];
            if (_lastSize[i] != size) { Efl.evas_object_text_font_set(t, Theme.Font, size); _lastSize[i] = size; _lastText[i] = null; }
            Efl.evas_object_color_set(t, alpha, alpha, alpha, alpha);
            if (_lastText[i] != text || _lastW[i] != maxW) { Surface.SetFitted(t, text, maxW); _lastText[i] = text; _lastW[i] = maxW; }
            int left = right ? x - Efl.evas_object_text_horiz_advance_get(t) : x;
            Efl.evas_object_move(t, left, y);
            Efl.evas_object_show(t);
        }
    }
}
