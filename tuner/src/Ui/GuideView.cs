using System;
using System.Collections.Generic;
using Tuner.Core;
using Tuner.Native;

namespace Tuner.Ui
{
    /// <summary>
    /// The TV guide on screen, on the full veil (the Banner's veil grown past the screen's edges, alpha .94: no sheet). It draws the list of
    /// primitives <see cref="GuideScene"/> builds onto a fixed set of objects made once: <see cref="GuideScene.MaxLines"/> rectangles, the cells
    /// (pill.png, <see cref="GuideScene.MaxFills"/>), the hatches, the ice focus, the logos, the texts and the footer's key pictures. The texts with
    /// a key (the focused row's number and name, the header's title) have an object each, so a transition can hold them while the rest is redrawn.
    /// Not made at start-up (the guide has about 440 objects, about 115 on screen): a few seconds after the channel list has arrived, while the tuner
    /// is idle (Program.MakeGuideWhenIdle, Core/IdleWork.cs), or by the first opening if that comes first. The objects then stay for the life of the
    /// process, also in a resident tuner that never opens the guide.
    /// </summary>
    internal sealed class GuideView : IStage
    {
        private readonly Surface _s;
        private readonly Veil _veil;
        private readonly IntPtr[] _lines = new IntPtr[GuideScene.MaxLines];
        private readonly Chip[] _fills = new Chip[GuideScene.MaxFills];
        private readonly IntPtr[] _hatches = new IntPtr[GuideScene.MaxHatches];
        private readonly IntPtr[] _hatchEnds = new IntPtr[GuideScene.MaxHatchEnds];
        private readonly Chip _focus;
        private readonly Logo[] _logos = new Logo[GuideScene.MaxLogos];
        private readonly Slot[] _texts = new Slot[GuideScene.MaxTexts - 3];
        private readonly Dictionary<string, Slot> _keyed = new Dictionary<string, Slot>();
        private readonly Dictionary<string, IntPtr> _keys = new Dictionary<string, IntPtr>();   // the footer's remote key pictures, one object each
        private readonly HashSet<string> _keysShown = new HashSet<string>(), _keyedShown = new HashSet<string>();
        private readonly Dictionary<string, Part> _parts = new Dictionary<string, Part>();
        private readonly IntPtr _probe;
        private int _linesUsed, _fillsUsed, _hatchesUsed, _hatchEndsUsed, _textsUsed;

        /// <summary>A pooled text object and what was last put on it (font and text are only set again when they change).</summary>
        private sealed class Slot { public IntPtr T; public string Text, Font; public int Size = -1, MaxW = -1; }

        public GuideView(Surface s, Veil veil)
        {
            _s = s; _veil = veil;
            _measureNative = MeasureNative;
            for (int i = 0; i < _lines.Length; i++) _lines[i] = s.Rect();
            for (int i = 0; i < _fills.Length; i++) _fills[i] = s.Pill();
            for (int i = 0; i < _hatches.Length; i++) _hatches[i] = s.Tile("hatch", GuideScene.HatchTile);
            for (int i = 0; i < _hatchEnds.Length; i++) _hatchEnds[i] = s.Tile("hatch_ends", HatchEndsSlots * GuideScene.HatchEndW, GuideLayout.CellH);
            _focus = s.Pill();
            for (int i = 0; i < _logos.Length; i++) _logos[i] = s.Logo();
            for (int i = 0; i < _texts.Length; i++) _texts[i] = NewSlot();
            foreach (string k in GuideScene.TextKeys) _keyed[k] = NewSlot();
            foreach (string k in GuideScene.KeyNames) _keys[k] = s.Picture(k);
            _probe = s.Text(24, 0, Theme.Font500);
            Efl.evas_object_hide(_probe);
            _parts["num"] = new Part(_keyed["num"].T, 24, false);
            _parts["name"] = new Part(_keyed["name"].T, 26, false);
            _parts["title"] = new Part(_keyed["title"].T, 64, false);
        }

        /// <summary>hatch_ends.png: the left end, then the right end for each of the 16 places it can start in the stripes' tile (tools/make-hatch-ends.py).</summary>
        private const int HatchEndsSlots = 1 + GuideScene.HatchTile;

        private Slot NewSlot() { var sl = new Slot { T = _s.Text(24, Theme.TextMain) }; Efl.evas_object_hide(sl.T); return sl; }

        public Surface Surface { get { return _s; } }
        public IEnumerable<KeyValuePair<string, Part>> Parts { get { return _parts; } }
        public bool GroupFade { get { return true; } }

        public bool Visible { get { return _s.Visible; } }
        public void Hide() { _s.Hide(); _veil.SetGuide(false); }

        /// <summary>The width of a text in the guide's font (the footer's words, a paragraph's lines): measured once on the hidden probe, then remembered.</summary>
        public int Measure(string text, int size, int weight) { return _widths.Get(text, size, weight, _measureNative); }

        private readonly WidthCache _widths = new WidthCache();
        private readonly Func<string, int, int, int> _measureNative;
        private int MeasureNative(string text, int size, int weight)
        {
            Texts.Font(_probe, Font(weight), size);
            Texts.Set(_probe, text);
            return Texts.Advance(_probe);
        }

        private static string Font(int weight) { return weight >= 600 ? Theme.Font600 : weight > 0 && weight <= 200 ? Theme.Font200 : Theme.Font500; }

        public void Draw(List<Prim> scene)
        {
            int lines = 0, fills = 0, hatches = 0, hatchEnds = 0, texts = 0, logos = 0;
            bool focus = false;
            _keysShown.Clear(); _keyedShown.Clear();
            foreach (Prim p in scene)
            {
                switch (p.Kind)
                {
                    case PrimKind.Line:
                        if (lines < _lines.Length)
                        {
                            IntPtr r = _lines[lines++];
                            int rgb = p.Tint != 0 ? p.Tint : 0xFFFFFF, a = p.Alpha;
                            Efl.evas_object_color_set(r, ((rgb >> 16) & 255) * a / 255, ((rgb >> 8) & 255) * a / 255, (rgb & 255) * a / 255, a);
                            Efl.evas_object_move(r, p.X, p.Y); Efl.evas_object_resize(r, p.W, p.H); Efl.evas_object_show(r);
                        }
                        break;
                    case PrimKind.Fill:
                        if (fills < _fills.Length) { _fills[fills].SetRect(p.X, p.Y, p.W, p.H); _fills[fills].SetWhite(p.Alpha); fills++; }
                        break;
                    case PrimKind.Hatch:
                        if (hatches < _hatches.Length)
                        {
                            IntPtr h = _hatches[hatches++];
                            Efl.evas_object_move(h, p.X, p.Y); Efl.evas_object_resize(h, p.W, p.H);
                            Efl.evas_object_image_fill_set(h, -p.Phase, 0, GuideScene.HatchTile, GuideScene.HatchTile);
                            Efl.evas_object_color_set(h, p.Alpha, p.Alpha, p.Alpha, p.Alpha); Efl.evas_object_show(h);
                        }
                        break;
                    case PrimKind.HatchEnd:
                        if (hatchEnds < _hatchEnds.Length)
                        {
                            // One slot of hatch_ends.png shows through the end's 24 px: the picture's fill is moved left by the slot's offset.
                            IntPtr h = _hatchEnds[hatchEnds++];
                            Efl.evas_object_move(h, p.X, p.Y); Efl.evas_object_resize(h, p.W, p.H);
                            Efl.evas_object_image_fill_set(h, -p.Phase * GuideScene.HatchEndW, 0, HatchEndsSlots * GuideScene.HatchEndW, GuideLayout.CellH);
                            Efl.evas_object_color_set(h, p.Alpha, p.Alpha, p.Alpha, p.Alpha); Efl.evas_object_show(h);
                        }
                        break;
                    case PrimKind.Focus: _focus.SetRect(p.X, p.Y, p.W, p.H); _focus.SetTint(Theme.Ice, p.Alpha); focus = true; break;
                    case PrimKind.Text:
                        if (p.Key != null && _keyed.ContainsKey(p.Key)) { Place(_keyed[p.Key], p, p.Text, p.Y); _keyedShown.Add(p.Key); }
                        else texts = Text(p, texts);
                        break;
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
            if (!focus) _focus.SetWhite(0);
            foreach (var kv in _keys) if (!_keysShown.Contains(kv.Key)) Efl.evas_object_hide(kv.Value);
            foreach (var kv in _keyed) if (!_keyedShown.Contains(kv.Key)) Efl.evas_object_hide(kv.Value.T);
            for (int i = logos; i < _logos.Length; i++) _logos[i].Hide();
            for (int i = lines; i < _linesUsed; i++) Efl.evas_object_hide(_lines[i]);
            for (int i = fills; i < _fillsUsed; i++) _fills[i].SetWhite(0);
            for (int i = hatches; i < _hatchesUsed; i++) Efl.evas_object_hide(_hatches[i]);
            for (int i = hatchEnds; i < _hatchEndsUsed; i++) Efl.evas_object_hide(_hatchEnds[i]);
            for (int i = texts; i < _textsUsed; i++) Efl.evas_object_hide(_texts[i].T);
            _linesUsed = lines; _fillsUsed = fills; _hatchesUsed = hatches; _hatchEndsUsed = hatchEnds; _textsUsed = texts;
            _veil.SetGuide(true);
            _s.Show();
        }

        /// <summary>Puts a text primitive on the next free text object (a paragraph takes one object a line). Returns the next free index.</summary>
        private int Text(Prim p, int at)
        {
            if (at >= _texts.Length) return at;
            if (p.Lines <= 1) { Place(_texts[at], p, p.Text, p.Y); return at + 1; }
            // paragraph: fill the lines greedily with words, measured in the paragraph's font
            string[] words = p.Text.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            int w = 0;
            for (int line = 0; line < p.Lines && at < _texts.Length; line++)
            {
                string cur = "";
                while (w < words.Length)
                {
                    string next = cur.Length == 0 ? words[w] : cur + " " + words[w];
                    if (Measure(next, p.Size, p.Weight) > p.MaxW && cur.Length > 0) break;
                    cur = next; w++;
                }
                if (line == p.Lines - 1 && w < words.Length) cur += " " + string.Join(" ", words, w, words.Length - w);   // the last line ends with an ellipsis
                Place(_texts[at], p, cur, p.Y + line * p.LineH);
                at++;
                if (w >= words.Length) break;
            }
            return at;
        }

        /// <summary>One line of text, on the baseline of the mock-up's line-box top <paramref name="top"/>; white at the prim's alpha, or its ink opaque.</summary>
        private void Place(Slot sl, Prim p, string text, int top)
        {
            IntPtr t = sl.T;
            string font = Font(p.Weight);
            if (sl.Size != p.Size || sl.Font != font) { Texts.Font(t, font, p.Size); sl.Size = p.Size; sl.Font = font; sl.Text = null; }
            if (p.Tint != 0) Theme.TintText(t, p.Tint, 255); else Efl.evas_object_color_set(t, p.Alpha, p.Alpha, p.Alpha, p.Alpha);
            if (sl.Text != text || sl.MaxW != p.MaxW) { Surface.SetFitted(t, text, p.MaxW); sl.Text = text; sl.MaxW = p.MaxW; }
            int left = p.Right ? p.X - Texts.Advance(t) : p.X;
            Efl.evas_object_move(t, left, Theme.TopOf(top, p.Size));
            Efl.evas_object_show(t);
        }
    }
}
