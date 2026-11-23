using System;
using System.Collections.Generic;
using System.IO;
using Launcher.Core;
using Launcher.Native;

namespace Launcher.Ui
{
    /// <summary>
    /// The evas objects of the dock and the code that maps controller state onto them.
    /// Object count is items + 8 (rim, pill, clippers, two glows, two focus rings; two labels and the clock only when the design shows names), plus the divider
    /// when the strip has a system group and the parts of each navigation hint (a word and its chevron, or the remote's keys and their words);
    /// icons are pre-sized PNGs, and <see cref="Apply"/> only calls into EFL for values that changed
    /// since the previous frame, so an animation frame costs a handful of native calls.
    /// </summary>
    internal sealed class Dock
    {
        // One family per font, no ",Sans" fallback list: Evas 1.25 gives the whole string to fontconfig as one family name, so with the
        // list every weight fell back to SamsungOneUI 400 on the TV (Q80A, 2026-11-11). fontconfig falls back by itself.
        private const string Font = "SamsungOneUI 500";

        private readonly IntPtr _win, _evas;
        private readonly DockLayout _layout;
        private readonly AppEntry[] _items;
        private readonly string _assets;
        private readonly Action<string> _log;

        private IntPtr _rim, _pill, _clip, _appsClip, _highlight, _highlight2, _ring, _ring2, _clock, _divider;
        // Two name labels cross-fade (see LabelFader): the name under the icon being left and the one being reached.
        private readonly IntPtr[] _label = new IntPtr[2];
        private readonly LabelFader _fader = new LabelFader();
        private readonly int[] _labelX = { int.MinValue, int.MinValue }, _labelW = new int[2], _labelAlpha = { -1, -1 };
        private int _labelY = int.MinValue;
        // The navigation hints: the main one (up above the apps pill, or down below the raised panel pill), and
        // an optional second one below the apps pill.
        private NavHint _hint;
        private readonly NavHint _hintBelow;
        private Box _dividerBox;
        private int _dividerAlpha = -1;
        private readonly IntPtr[] _icon;
        private readonly IntPtr[] _initials;       // placeholder letters for icons that failed to load
        private readonly int[] _initialsW, _initialsH;   // their size, measured once (the letters never change)
        private readonly string[] _iconKey;        // each registry icon's key in Icons (null: a pre-made icon or none)
        private int _moving = -1;                  // the tile being moved (hold OK): its name reads "‹  Name  ›"

        private readonly Box[] _iconBox;
        private readonly int[] _iconAlpha;
        private Box _rimBox, _pillBox, _hlBox, _hlBox2, _ringBox, _ringBox2;
        private int _chromeAlpha = -1, _hlAlpha = -1, _hlAlpha2 = -1, _clockAlpha = -1, _ringAlpha = -1, _ringAlpha2 = -1;
        private int _hlRgb = -1, _hlRgb2 = -1;
        // Colour of each item's glow: the icon's dominant hue, or the design's own colour.
        private readonly int[] _glowRgb;
        private bool _hlRound, _hlRound2;      // which outline each glow object currently shows
        private int _clockW, _clockX = int.MinValue, _clockY = int.MinValue;
        private int _current = -1;
        private bool _clipSet;

        public int MissingIcons { get; private set; }

        /// <param name="hint">Word of the navigation hint ("Input", "Back"), or null for none.</param>
        /// <param name="hintUp">True: chevron up, capsule above the pill; false: chevron down, below it.</param>
        public Dock(IntPtr win, DockLayout layout, AppEntry[] items, string assetsDir, Action<string> log, string hint, bool hintUp)
            : this(win, layout, items, assetsDir, log, hint, hintUp, null) { }

        /// <param name="keyHint">A key hint, like the Control center cards' footer: the remote's keys as pictures ("key_ok": res/key_ok.png)
        /// and words, "|" between two groups (<see cref="KeyHint"/>). It has no chevron: the key it shows says where it leads.</param>
        /// <param name="hintUp">True: the hint above the pill; false: below it.</param>
        public Dock(IntPtr win, DockLayout layout, AppEntry[] items, string assetsDir, Action<string> log, string[] keyHint, bool hintUp)
            : this(win, layout, items, assetsDir, log, (string)null, hintUp, null)
        {
            if (keyHint != null) _hint = new NavHint(keyHint, hintUp);
        }

        /// <param name="hintBelow">Word of a second hint under the pill, with a down chevron ("Task manager"), or null.
        /// Only used with an up hint, and the layout needs <see cref="DockLayout.BelowBand"/> to have room for it.</param>
        public Dock(IntPtr win, DockLayout layout, AppEntry[] items, string assetsDir, Action<string> log, string hint, bool hintUp, string hintBelow)
        {
            _win = win; _layout = layout; _items = items; _assets = assetsDir; _log = log;
            if (hint != null) _hint = new NavHint(new[] { hint }, hintUp);
            if (hintBelow != null && hintUp && layout.BelowBand) _hintBelow = new NavHint(new[] { hintBelow }, false);
            _evas = Efl.evas_object_evas_get(win);
            _icon = new IntPtr[items.Length];
            _initials = new IntPtr[items.Length];
            _initialsW = new int[items.Length];
            _initialsH = new int[items.Length];
            _iconKey = new string[items.Length];
            _iconBox = new Box[items.Length];
            _iconAlpha = new int[items.Length];
            _glowRgb = new int[items.Length];
            for (int i = 0; i < items.Length; i++) { _iconBox[i].W = -1; _iconAlpha[i] = -1; _glowRgb[i] = Design.GlowColor; }
            _rimBox.W = _pillBox.W = _hlBox.W = _hlBox2.W = _ringBox.W = _ringBox2.W = -1;
        }

        public IntPtr Evas { get { return _evas; } }

        public void Build()
        {
            // z-order is creation order: rim < pill < highlight < icons < ring < label.
            // The material of the 123 pad and the volume pill: a light rim 2 px outside the sheet, then the slate sheet, both
            // nine-sliced to the panel radius (border_scale = radius / border), and no drop shadow.
            _rim = NineSlice("pill_rim", Design.RimSlice, (Design.PanelRadius + Design.ShellBorderW) / (double)Design.RimSlice);
            _pill = NineSlice("pill_bg", Design.SheetSlice, Design.PanelRadius / (double)Design.SheetSlice);
            // The focused icon grows and a soft glow, drawn at its final size, sits behind it; a thin ring is drawn around it.
            _highlight = NineSlice("dock_glow", 0);
            _highlight2 = NineSlice("dock_glow", 0);

            _clip = Efl.evas_object_rectangle_add(_evas);
            Efl.evas_object_color_set(_clip, 255, 255, 255, 255);
            Efl.evas_object_show(_clip);
            // The apps scroll under their own clipper, itself clipped by the page clipper: hiding the page
            // still takes everything with it, while the pinned entries, the glow and the divider stay uncut.
            _appsClip = Efl.evas_object_rectangle_add(_evas);
            Efl.evas_object_color_set(_appsClip, 255, 255, 255, 255);
            Efl.evas_object_clip_set(_appsClip, _clip);
            Efl.evas_object_show(_appsClip);

            for (int i = 0; i < _items.Length; i++)
            {
                _icon[i] = LoadIcon(i);
                IntPtr clip = i < _layout.AppCount ? _appsClip : _clip;
                Efl.evas_object_clip_set(_icon[i], clip);
                if (_initials[i] != IntPtr.Zero) Efl.evas_object_clip_set(_initials[i], clip);
            }
            Efl.evas_object_clip_set(_highlight, _clip);
            Efl.evas_object_clip_set(_highlight2, _clip);
            // The ring follows the icon's box, grown by its width: one object per icon being left and reached, like the glow.
            _ring = RingImage();
            _ring2 = RingImage();

            if (_layout.GroupStart >= 0)
            {
                // Hairline before the pinned system entries; it stays put while the apps scroll.
                _divider = Efl.evas_object_rectangle_add(_evas);
                Efl.evas_object_clip_set(_divider, _clip);
                Efl.evas_object_show(_divider);
                _dividerBox.W = -1;
            }

            if (Design.ShowLabels)
                for (int k = 0; k < 2; k++)
                {
                    _label[k] = Efl.evas_object_text_add(_evas);
                    Efl.evas_object_text_font_set(_label[k], Font, 26);
                    SoftShadow(_label[k]);
                    TintText(_label[k], 0);
                    Efl.evas_object_show(_label[k]);
                }

            if (Design.ShowClock)
            {
                _clock = Efl.evas_object_text_add(_evas);
                Efl.evas_object_text_font_set(_clock, Font, 22);
                Efl.evas_object_text_text_set(_clock, "--:--");
                _clockW = Efl.evas_object_text_horiz_advance_get(_clock);
                SoftShadow(_clock);
                Efl.evas_object_show(_clock);
            }

            if (_hint != null) BuildHint(_hint);
            if (_hintBelow != null) BuildHint(_hintBelow);
        }

        private const int HintChev = 24, HintGap = 4;
        // A key hint's parts, as in the Control center cards' footer (CardChrome): keys 34 px, 2 px between two keys, 8 between a key and its
        // word, 40 between two groups. Keys at 85% and words at 90%, the dock's other hints' strength.
        private const int HintKey = 34, HintKeyGap = 2, HintInner = 8, HintGroup = 40;

        /// <summary>
        /// The parts of a key hint for Sources and All apps: hold OK adds the entry to the row or takes it out, Down or Back go back to the row.
        /// <paramref name="canAdd"/> false (a Sources list without row keys, written by an older Vetro): only the way back.
        /// </summary>
        public static string[] KeyHint(bool canAdd)
        {
            return canAdd
                ? new[] { "Hold", "key_ok", "add or take out", "|", "key_down", "key_back", "return" }
                : new[] { "key_down", "key_back", "return" };
        }

        /// <summary>One part of a hint: a word, or a key's picture, and the space after it.</summary>
        private sealed class HintPart
        {
            public IntPtr Obj;
            public bool Key;
            public string Word;
            public int W, Dy, Gap;
        }

        /// <summary>
        /// One navigation hint, with what was last sent to EFL: a word and its chevron, or keys and words (no chevron). A word said for a
        /// while (<see cref="SetHints"/>) goes into the first word, and the other parts are hidden meanwhile.
        /// </summary>
        private sealed class NavHint
        {
            public readonly string[] Spec;
            public readonly bool Up, HasKeys;
            public IntPtr Chev;
            public readonly List<HintPart> Parts = new List<HintPart>();
            public HintPart Lead;            // the first word: it carries a word said for a while
            public int W, X, Alpha = -1, Y = int.MinValue;
            public bool ShowChev, Override;
            public NavHint(string[] spec, bool up)
            {
                Spec = spec; Up = up;
                foreach (string s in spec) if (s.StartsWith("key_", StringComparison.Ordinal)) HasKeys = true;
                ShowChev = !HasKeys;
            }

            public bool Shown(HintPart p) { return !Override || p == Lead; }

            public IEnumerable<IntPtr> Objects()
            {
                if (Chev != IntPtr.Zero) yield return Chev;
                foreach (HintPart p in Parts) if (p.Obj != IntPtr.Zero) yield return p.Obj;
            }

            /// <summary>The width of what is shown now, and where it starts: centred under (or over) the pill.</summary>
            public void Measure(DockLayout layout)
            {
                int w = 0, last = -1;
                for (int i = 0; i < Parts.Count; i++) if (Shown(Parts[i])) last = i;
                for (int i = 0; i <= last; i++) if (Shown(Parts[i])) w += Parts[i].W + (i < last && !Override ? Parts[i].Gap : 0);
                if (ShowChev) w += HintGap + HintChev;
                W = w;
                X = layout.HintLeft(w);
            }
        }

        private const int ShadowAlpha = 150;

        /// <summary>Text opacity (0..255). The shadow has its own colour and must fade with the text, or a faded or
        /// vanished name would leave its shadow behind as a halo.</summary>
        private static void TintText(IntPtr text, int a)
        {
            Tint(text, a);
            Efl.evas_object_text_shadow_color_set(text, 0, 0, 0, ShadowAlpha * a / 255);
        }

        private static void SoftShadow(IntPtr text)
        {
            Efl.evas_object_text_style_set(text, Efl.EvasTextStyleSoftShadow);
            Efl.evas_object_text_shadow_color_set(text, 0, 0, 0, ShadowAlpha);
        }

        /// <summary>The words and keys, then the chevron of a word hint: created last so they sit above the pill, never inside the clipper.</summary>
        private void BuildHint(NavHint h)
        {
            for (int i = 0; i < h.Spec.Length; i++)
            {
                string s = h.Spec[i];
                if (s == "|") continue;
                var p = new HintPart { Key = s.StartsWith("key_", StringComparison.Ordinal), Word = s };
                if (p.Key)
                {
                    p.Obj = Efl.evas_object_image_add(_evas);
                    Efl.evas_object_image_file_set(p.Obj, Path.Combine(_assets, s + ".png"), null);
                    if (Efl.evas_object_image_load_error_get(p.Obj) != Efl.EvasLoadErrorNone) _log("asset missing: " + s);
                    Efl.evas_object_image_filled_set(p.Obj, true);
                    Efl.evas_object_image_smooth_scale_set(p.Obj, true);
                    Efl.evas_object_resize(p.Obj, HintKey, HintKey);
                    Efl.evas_object_color_set(p.Obj, 0, 0, 0, 0);
                    p.W = HintKey;
                    p.Dy = (DockLayout.CapsuleH - HintKey) / 2;
                }
                else
                {
                    p.Obj = Efl.evas_object_text_add(_evas);
                    Efl.evas_object_text_font_set(p.Obj, Font, 22);
                    Efl.evas_object_text_text_set(p.Obj, s);
                    // No backing shape: a soft dark shadow keeps the word readable over bright video.
                    SoftShadow(p.Obj);
                    p.W = Efl.evas_object_text_horiz_advance_get(p.Obj);
                    p.Dy = (DockLayout.CapsuleH - Efl.evas_object_text_vert_advance_get(p.Obj)) / 2 - 1;
                    if (h.Lead == null) h.Lead = p;
                }
                Efl.evas_object_show(p.Obj);
                // The space after it: a group break, two keys side by side, or a key and its word.
                bool next = i + 1 < h.Spec.Length, brk = next && h.Spec[i + 1] == "|";
                bool nextKey = next && h.Spec[i + 1].StartsWith("key_", StringComparison.Ordinal);
                p.Gap = !next ? 0 : brk ? HintGroup : p.Key && nextKey ? HintKeyGap : HintInner;
                h.Parts.Add(p);
            }
            if (!h.HasKeys)
            {
                h.Chev = Efl.evas_object_image_add(_evas);
                Efl.evas_object_image_file_set(h.Chev, Path.Combine(_assets, h.Up ? "chev_up.png" : "chev_down.png"), null);
                if (Efl.evas_object_image_load_error_get(h.Chev) != Efl.EvasLoadErrorNone) _log("asset missing: chevron");
                Efl.evas_object_image_filled_set(h.Chev, true);
                Efl.evas_object_image_smooth_scale_set(h.Chev, true);
                Efl.evas_object_resize(h.Chev, HintChev, HintChev);
                Efl.evas_object_show(h.Chev);
            }
            h.Measure(_layout);
        }

        /// <summary>
        /// Shows or hides the whole page. Hiding the clipper hides every icon and the highlight
        /// with it, so four calls cover the page; the objects keep their state for the way back.
        /// </summary>
        public void SetVisible(bool visible)
        {
            var top = new List<IntPtr> { _rim, _pill, _clip, _label[0], _label[1], _clock };
            foreach (NavHint h in new[] { _hint, _hintBelow }) if (h != null) top.AddRange(h.Objects());
            foreach (IntPtr o in top)
            {
                if (o == IntPtr.Zero) continue;
                if (visible) Efl.evas_object_show(o); else Efl.evas_object_hide(o);
            }
        }

        /// <summary>
        /// Says something else in the hints for a while (moving a tile: "Left / Right move · OK done" above the bar, "Remove from row" under it):
        /// a null word puts the page's own word back. <paramref name="chevron"/> false hides the main hint's chevron (it points to no page then).
        /// </summary>
        public void SetHints(string main, string below, bool chevron)
        {
            SetHint(_hint, main, chevron);
            SetHint(_hintBelow, below, true);
        }

        private void SetHint(NavHint h, string word, bool chevron)
        {
            if (h == null || h.Lead == null) return;
            Efl.evas_object_text_text_set(h.Lead.Obj, word ?? h.Lead.Word);
            h.Lead.W = Efl.evas_object_text_horiz_advance_get(h.Lead.Obj);
            // A key hint says the other words alone: its keys and its other words step aside until its own words come back.
            h.Override = word != null && (h.HasKeys || h.Parts.Count > 1);
            h.ShowChev = !h.HasKeys && (word == null || chevron);
            h.Measure(_layout);
            h.Y = int.MinValue; h.Alpha = -1;   // placed and tinted again on the next frame
        }

        private HashSet<int> _marked;
        // A tick on the icon's top right corner for the marked tiles (a slate disc and the white check): the dock draws no names, so this is how
        // All apps shows which apps the row holds. Made the first time something is marked.
        private IntPtr[] _badgeBg, _badge;
        private int[] _badgeAlpha, _badgeX, _badgeY;
        public const int BadgeSize = 32, BadgeInset = 8;

        /// <summary>Tiles that carry a tick and whose name says "in the row" (All apps: the apps the user's row holds).</summary>
        public HashSet<int> Marked
        {
            set
            {
                _marked = value;
                _fader.Invalidate();
                if (_badge != null || value == null || value.Count == 0) { if (_badgeAlpha != null) for (int i = 0; i < _badgeAlpha.Length; i++) _badgeAlpha[i] = -1; return; }
                _badgeBg = new IntPtr[_items.Length]; _badge = new IntPtr[_items.Length]; _badgeAlpha = new int[_items.Length];
                _badgeX = new int[_items.Length]; _badgeY = new int[_items.Length];
                for (int i = 0; i < _items.Length; i++)
                {
                    IntPtr clip = i < _layout.AppCount ? _appsClip : _clip;
                    _badgeBg[i] = NineSlice("pill_bg", Design.SheetSlice, BadgeSize / 2.0 / Design.SheetSlice);
                    Efl.evas_object_resize(_badgeBg[i], BadgeSize, BadgeSize);
                    Efl.evas_object_clip_set(_badgeBg[i], clip);
                    _badge[i] = Efl.evas_object_image_add(_evas);
                    Efl.evas_object_image_file_set(_badge[i], Path.Combine(_assets, "out_check.png"), null);
                    Efl.evas_object_image_filled_set(_badge[i], true);
                    Efl.evas_object_image_smooth_scale_set(_badge[i], true);
                    Efl.evas_object_resize(_badge[i], BadgeSize - 10, BadgeSize - 10);
                    Efl.evas_object_clip_set(_badge[i], clip);
                    Efl.evas_object_show(_badge[i]);
                    _badgeAlpha[i] = -1; _badgeX[i] = int.MinValue; _badgeY[i] = int.MinValue;
                }
            }
        }

        /// <summary>The tile being moved (its name is drawn between arrows), or -1.</summary>
        public int MovingIndex
        {
            get { return _moving; }
            set { if (value != _moving) { _moving = value; _fader.Invalidate(); } }
        }

        /// <summary>Two tiles change places (moving a tile in the row): the item list itself and everything drawn for each item.</summary>
        public void Swap(int i, int j)
        {
            if (i == j || i < 0 || j < 0 || i >= _items.Length || j >= _items.Length) return;
            AppEntry e = _items[i]; _items[i] = _items[j]; _items[j] = e;
            IntPtr o = _icon[i]; _icon[i] = _icon[j]; _icon[j] = o;
            o = _initials[i]; _initials[i] = _initials[j]; _initials[j] = o;
            int m = _initialsW[i]; _initialsW[i] = _initialsW[j]; _initialsW[j] = m;
            m = _initialsH[i]; _initialsH[i] = _initialsH[j]; _initialsH[j] = m;
            int g = _glowRgb[i]; _glowRgb[i] = _glowRgb[j]; _glowRgb[j] = g;
            string k = _iconKey[i]; _iconKey[i] = _iconKey[j]; _iconKey[j] = k;
            // Both tiles' places are forgotten in full: Place moves an object only when X or Y differ from the last box, and the
            // slot keeps its X and Y, so forgetting only the width left each icon drawn where it was (the row looked unchanged
            // after a move, while the order underneath had changed: LS03B, 2026-11-20).
            _iconBox[i] = _iconBox[j] = new Box { X = int.MinValue, Y = int.MinValue, W = -1, H = -1 };
            _iconAlpha[i] = _iconAlpha[j] = -1;
            _hlRgb = _hlRgb2 = -1;
            _fader.Invalidate();
        }

        /// <summary>Deletes every object of the page (the row was rebuilt with other tiles); the page is not used again.</summary>
        public void Destroy()
        {
            var all = new List<IntPtr> { _rim, _pill, _highlight, _highlight2, _ring, _ring2, _divider, _label[0], _label[1], _clock, _appsClip, _clip };
            all.AddRange(_icon); all.AddRange(_initials);
            if (_badge != null) { all.AddRange(_badge); all.AddRange(_badgeBg); }
            foreach (NavHint h in new[] { _hint, _hintBelow }) if (h != null) all.AddRange(h.Objects());
            foreach (IntPtr x in all) if (x != IntPtr.Zero) Efl.evas_object_del(x);
        }

        /// <summary>Item that is in use right now (the active input): its label says so. -1 for none.</summary>
        public int CurrentIndex
        {
            get { return _current; }
            set { if (value != _current) { _current = value; _fader.Invalidate(); } }
        }

        public void SetClock(string text)
        {
            if (_clock == IntPtr.Zero) return;   // this design shows no clock
            Efl.evas_object_text_text_set(_clock, text);
            _clockW = Efl.evas_object_text_horiz_advance_get(_clock);
            _clockX = int.MinValue;   // re-place on the next frame: the width may have changed
        }

        private void GlowShape(IntPtr img, ref bool round, bool wantRound)
        {
            if (round == wantRound) return;
            round = wantRound;
            Efl.evas_object_image_file_set(img, Path.Combine(_assets, (round ? "dock_glow_pill" : "dock_glow") + ".png"), null);
        }

        /// <summary>The focus ring image: a white outline that is scaled to the icon's box, so its corners keep the icon's proportions.</summary>
        private IntPtr RingImage()
        {
            IntPtr img = Efl.evas_object_image_add(_evas);
            Efl.evas_object_image_file_set(img, Path.Combine(_assets, "dock_ring.png"), null);
            if (Efl.evas_object_image_load_error_get(img) != Efl.EvasLoadErrorNone) _log("asset missing: dock_ring");
            Efl.evas_object_image_filled_set(img, true);
            Efl.evas_object_image_smooth_scale_set(img, true);
            Efl.evas_object_color_set(img, 0, 0, 0, 0);
            Efl.evas_object_clip_set(img, _clip);
            Efl.evas_object_show(img);
            return img;
        }

        private IntPtr NineSlice(string name, int border) { return NineSlice(name, border, 1.0); }

        /// <param name="scale">border_scale: the corners are drawn <paramref name="border"/> x scale pixels wide.</param>
        private IntPtr NineSlice(string name, int border, double scale)
        {
            IntPtr img = Efl.evas_object_image_add(_evas);
            Efl.evas_object_image_file_set(img, Path.Combine(_assets, name + ".png"), null);
            if (Efl.evas_object_image_load_error_get(img) != Efl.EvasLoadErrorNone) _log("asset missing: " + name);
            Efl.evas_object_image_filled_set(img, true);
            Efl.evas_object_image_border_set(img, border, border, border, border);
            if (scale != 1.0) Efl.evas_object_image_border_scale_set(img, scale);
            Efl.evas_object_image_border_center_fill_set(img, 1);
            Efl.evas_object_image_smooth_scale_set(img, true);
            Efl.evas_object_show(img);
            return img;
        }

        private IntPtr LoadIcon(int idx)
        {
            AppEntry e = _items[idx];
            IntPtr img = Efl.evas_object_image_add(_evas);
            if (e.Slug == "customhome" && e.SystemApp)
            {
                DrawShortcutPill(img);
                IntPtr text = Efl.evas_object_text_add(_evas);
                // Fit the short configurable label to the same fixed-size system pill.
                string label = e.Label.Length > 12 ? e.Label.Substring(0, 12) : e.Label;
                if (label.Length > 0 && char.IsHighSurrogate(label[label.Length - 1])) label = label.Substring(0, label.Length - 1);
                Efl.evas_object_text_text_set(text, label);
                int size = Design.PillTextSize;
                do { Efl.evas_object_text_font_set(text, Font, size--); }
                while (size >= 12 && Efl.evas_object_text_horiz_advance_get(text) > DockLayout.PillItemW - 32);
                _initialsW[idx] = Efl.evas_object_text_horiz_advance_get(text);
                _initialsH[idx] = Efl.evas_object_text_vert_advance_get(text);
                Efl.evas_object_show(text); _initials[idx] = text;
                Efl.evas_object_image_filled_set(img, true); Efl.evas_object_show(img);
                return img;
            }
            bool fromRegistry = e.IconPath != null && LoadRegistryIcon(img, e, idx);
            if (!fromRegistry) Efl.evas_object_image_file_set(img, Path.Combine(_assets, "icons", e.Slug + ".png"), null);
            if (!fromRegistry && Efl.evas_object_image_load_error_get(img) == Efl.EvasLoadErrorNone) SampleGlowColor(img, idx);
            if (!fromRegistry && Efl.evas_object_image_load_error_get(img) != Efl.EvasLoadErrorNone)
            {
                // No icon on disk: a plain glass tile with the app's initials keeps the entry usable.
                MissingIcons++;
                _log("icon missing: " + e.Slug);
                Efl.evas_object_image_file_set(img, Path.Combine(_assets, "glass_tile.png"), null);
                IntPtr t = Efl.evas_object_text_add(_evas);
                Efl.evas_object_text_font_set(t, Font, 40);
                Efl.evas_object_text_text_set(t, Initials(e.Label));
                Efl.evas_object_show(t);
                _initials[idx] = t;
                _initialsW[idx] = Efl.evas_object_text_horiz_advance_get(t);
                _initialsH[idx] = Efl.evas_object_text_vert_advance_get(t);
            }
            Efl.evas_object_image_filled_set(img, true);
            Efl.evas_object_image_smooth_scale_set(img, true);
            Efl.evas_object_image_scale_hint_set(img, Efl.EvasImageScaleHintDynamic);
            Efl.evas_object_show(img);
            return img;
        }

        // A transparent capsule outline, generated once; the label remains native text.
        private static void DrawShortcutPill(IntPtr image)
        {
            int width = DockLayout.PillItemW, height = DockLayout.PillItemH;
            Efl.evas_object_image_alpha_set(image, true);
            Efl.evas_object_image_size_set(image, width, height);
            IntPtr data = Efl.evas_object_image_data_get(image, true);
            if (data == IntPtr.Zero) return;
            int stride = Efl.evas_object_image_stride_get(image);
            var row = new int[width]; double radius = height / 2.0;
            for (int y = 0; y < height; y++)
            {
                for (int x = 0; x < width; x++)
                {
                    double dx = x + 0.5 - Math.Max(radius, Math.Min(width - radius, x + 0.5));
                    double dy = y + 0.5 - radius, distance = Math.Sqrt(dx * dx + dy * dy);
                    double coverage = Math.Min(1, Math.Max(0, radius + 0.5 - distance)) *
                        Math.Min(1, Math.Max(0, distance - radius + 2.5));
                    int alpha = (int)Math.Round(255 * Design.PillBorderAlpha * coverage);
                    row[x] = (alpha << 24) | (alpha << 16) | (alpha << 8) | alpha;
                }
                System.Runtime.InteropServices.Marshal.Copy(row, 0, IntPtr.Add(data, y * stride), width);
            }
            Efl.evas_object_image_data_set(image, data);
            Efl.evas_object_image_data_update_add(image, 0, 0, width, height);
        }

        /// <summary>
        /// Loads the app's own icon from Samsung's registry and finishes it (<see cref="IconPrep"/>):
        /// rounded corners, a dark tile behind loose logos. Returns false, with the image object left
        /// unspecified, when anything fails, and the caller falls back to the pre-made icon.
        /// </summary>
        private bool LoadRegistryIcon(IntPtr img, AppEntry e, int idx)
        {
            try
            {
                string why;
                PreparedIcon p = PutRegistryIcon(img, e.IconPath, IconPrep.MaxSide, true, out _iconKey[idx], out why);
                if (p == null) { _log("registry icon " + why + ": " + e.Slug); return false; }
                if (p.Hue >= 0) _glowRgb[idx] = p.Hue;
                if (DumpIconsTo != null) _log("dump " + e.Slug + ": " + (Efl.evas_object_image_save(img, Path.Combine(DumpIconsTo, e.Slug + ".png"), null, "compress=5") ? "ok" : "failed"));
                return true;
            }
            catch (Exception ex) { _iconKey[idx] = null; _log("registry icon error (" + e.Slug + "): " + ex.Message); return false; }
        }

        /// <summary>
        /// The registry icons already finished, shared by the three pages and the Task manager's rows (which ask for a smaller side). A page made
        /// again takes its icons from here; the launcher sweeps it after each build of the pages (see <see cref="KeepIcons"/>).
        /// </summary>
        internal static readonly IconCache Icons = new IconCache(IconCache.DefaultMax);

        /// <summary>The key of <paramref name="path"/> in <see cref="Icons"/>, or null when the file cannot be looked at from here (it is then never cached:
        /// EFL still decides whether it loads, as before).</summary>
        private static string IconKey(string path, int maxSide)
        {
            try
            {
                var file = new FileInfo(path);
                return file.Exists ? IconCache.Key(path, file.LastWriteTimeUtc.Ticks, file.Length, maxSide) : null;
            }
            catch (Exception) { return null; }
        }

        /// <summary>
        /// Puts the registry icon at <paramref name="path"/>, finished at <paramref name="maxSide"/>, into <paramref name="img"/>. The same file
        /// finished at the same side before comes from <see cref="Icons"/>: only its pixels are copied into the new image object, with no PNG
        /// decoded and no IconPrep run. <paramref name="glow"/>: take the glow colour too (the dock; the Task manager has no glow).
        /// Returns null, with the reason in <paramref name="why"/> and <paramref name="key"/> null, when the icon cannot be used: the image
        /// object is then left unspecified and the caller draws its fallback.
        /// </summary>
        internal static PreparedIcon PutRegistryIcon(IntPtr img, string path, int maxSide, bool glow, out string key, out string why)
        {
            key = null; why = null;
            string k = IconKey(path, maxSide);
            PreparedIcon p;
            if (!Icons.TryGet(k, out p))
            {
                Efl.evas_object_image_file_set(img, path, null);
                if (Efl.evas_object_image_load_error_get(img) != Efl.EvasLoadErrorNone) { why = "not loadable"; return null; }
                int w, h;
                Efl.evas_object_image_size_get(img, out w, out h);
                if (w <= 0 || h <= 0 || w > 2048 || h > 2048) { why = "has odd size " + w + "x" + h; return null; }
                IntPtr data = Efl.evas_object_image_data_get(img, false);
                if (data == IntPtr.Zero) { why = "has no pixels"; return null; }
                uint[] src = ReadPixels(data, Efl.evas_object_image_stride_get(img), w, h);
                int hue = glow ? IconPrep.DominantColor(src, w, h) : -1;
                p = new PreparedIcon(IconPrep.Prepare(src, w, h, maxSide), IconPrep.SideFor(w, h, maxSide), hue);
                Icons.Put(k, p);
            }
            // Written into the object's own buffer: the cached pixels are only read, so every page that shows the icon can copy them again.
            Efl.evas_object_image_alpha_set(img, true);
            Efl.evas_object_image_size_set(img, p.Side, p.Side);
            IntPtr dst = Efl.evas_object_image_data_get(img, true);
            if (dst == IntPtr.Zero) { why = "has no write buffer"; return null; }
            WritePixels(dst, Efl.evas_object_image_stride_get(img), p.Pixels, p.Side);
            Efl.evas_object_image_data_set(img, dst);
            Efl.evas_object_image_data_update_add(img, 0, 0, p.Side, p.Side);
            key = k;
            return p;
        }

        /// <summary>This page still shows its registry icons: they stay in <see cref="Icons"/> through the next sweep (a page that was not made again).</summary>
        public void KeepIcons()
        {
            foreach (string k in _iconKey) Icons.Keep(k);
        }

        /// <summary>Takes the glow colour from an icon that was loaded from a file (the dock's own icons).</summary>
        private void SampleGlowColor(IntPtr img, int idx)
        {
            try
            {
                int w, h;
                Efl.evas_object_image_size_get(img, out w, out h);
                if (w <= 0 || h <= 0 || w > 2048 || h > 2048) return;
                IntPtr data = Efl.evas_object_image_data_get(img, false);
                if (data == IntPtr.Zero) return;
                int hue = IconPrep.DominantColor(ReadPixels(data, Efl.evas_object_image_stride_get(img), w, h), w, h);
                if (hue >= 0) _glowRgb[idx] = hue;
            }
            catch (Exception ex) { _log("glow colour unavailable (" + _items[idx].Slug + "): " + ex.Message); }
        }

        private int GlowRgb(int i)
        {
            return i < 0 || _layout.IsPinned(i) || !DockLayout.GlowFromIcon ? Design.GlowColor : _glowRgb[i];
        }

        internal static uint[] ReadPixels(IntPtr data, int stride, int w, int h)
        {
            var px = new uint[w * h];
            var row = new int[w];
            if (stride < w * 4) stride = w * 4;
            for (int y = 0; y < h; y++)
            {
                System.Runtime.InteropServices.Marshal.Copy(IntPtr.Add(data, y * stride), row, 0, w);
                Buffer.BlockCopy(row, 0, px, y * w * 4, w * 4);
            }
            return px;
        }

        internal static void WritePixels(IntPtr data, int stride, uint[] px, int side)
        {
            var row = new int[side];
            if (stride < side * 4) stride = side * 4;
            for (int y = 0; y < side; y++)
            {
                Buffer.BlockCopy(px, y * side * 4, row, 0, side * 4);
                System.Runtime.InteropServices.Marshal.Copy(row, 0, IntPtr.Add(data, y * stride), side);
            }
        }

        /// <summary>Debug: a directory to save every finished registry icon into, to look at them on a desktop.</summary>
        public static string DumpIconsTo;

        public static string Initials(string name)
        {
            string[] p = name.Trim().Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            if (p.Length >= 2) return char.ToUpperInvariant(p[0][0]).ToString() + char.ToUpperInvariant(p[1][0]);
            return name.Length > 0 ? char.ToUpperInvariant(name[0]).ToString() : "?";
        }

        private static void Place(IntPtr o, ref Box last, Box b)
        {
            if (b.X != last.X || b.Y != last.Y) Efl.evas_object_move(o, b.X, b.Y);
            if (b.W != last.W || b.H != last.H) Efl.evas_object_resize(o, b.W, b.H);
            last = b;
        }

        /// <summary>Premultiplied white at the given opacity (0..255).</summary>
        private static void Tint(IntPtr o, int a) { Efl.evas_object_color_set(o, a, a, a, a); }

        /// <summary>Premultiplied colour (0xRRGGBB) at the given opacity: tints a white image.</summary>
        private static void TintRgb(IntPtr o, int a, int rgb)
        {
            Efl.evas_object_color_set(o, ((rgb >> 16) & 0xFF) * a / 255, ((rgb >> 8) & 0xFF) * a / 255, (rgb & 0xFF) * a / 255, a);
        }

        public void Apply(Controller c)
        {
            int slide = c.Slide;
            int presence = (int)Math.Round(255f * c.Presence);
            float fp = c.FocusPos, scroll = c.Scroll;

            // Backdrop: moves only while the dock slides in or out.
            Place(_rim, ref _rimBox, _layout.RimBox(slide));
            Place(_pill, ref _pillBox, _layout.PillBox(slide));
            if (presence != _chromeAlpha)
            {
                _chromeAlpha = presence;
                TintRgb(_rim, (int)Math.Round(presence * Design.ShellBorderAlpha), Design.ShellBorderColor);
                TintRgb(_pill, (int)Math.Round(presence * Design.VolumeAlpha), Design.ShellColor);
            }

            if (!_clipSet)
            {
                _clipSet = true;
                Efl.evas_object_move(_clip, 0, 0);
                Efl.evas_object_resize(_clip, _layout.WinW, _layout.WinH);
                Efl.evas_object_move(_appsClip, _layout.ViewLeft - DockLayout.ClipPad, 0);
                Efl.evas_object_resize(_appsClip, _layout.ViewportW + 2 * DockLayout.ClipPad, _layout.WinH);
            }

            // The glow stays with its item: it dies out on the icon being left while it lights up on the one being
            // reached (two objects, one per icon), following the same focus as the icon growth. It comes in with its item.
            int g1, g2; float w2;
            _layout.GlowAt(fp, out g1, out g2, out w2);
            // The pinned system entries are oval pills: their glow follows a capsule, not the apps' rounded square.
            bool pin1 = g1 >= 0 && _layout.IsPinned(g1), pin2 = g2 >= 0 && _layout.IsPinned(g2);
            GlowShape(_highlight, ref _hlRound, pin1);
            GlowShape(_highlight2, ref _hlRound2, pin2);
            Place(_highlight, ref _hlBox, _layout.GlowBox(g1, scroll, c.ItemSlide(g1)));
            Place(_highlight2, ref _hlBox2, _layout.GlowBox(g2, scroll, c.ItemSlide(g2)));
            int ga1 = (int)Math.Round(255f * c.ItemPresence(g1) * (1f - w2)), ga2 = (int)Math.Round(255f * c.ItemPresence(g2) * w2);
            int gc1 = GlowRgb(g1), gc2 = GlowRgb(g2);
            if (ga1 != _hlAlpha || gc1 != _hlRgb) { _hlAlpha = ga1; _hlRgb = gc1; TintRgb(_highlight, ga1, gc1); }
            if (ga2 != _hlAlpha2 || gc2 != _hlRgb2) { _hlAlpha2 = ga2; _hlRgb2 = gc2; TintRgb(_highlight2, ga2, gc2); }

            // The focus ring hugs the selected icon (never a pill) and grows with it, so it keeps the icon's own corner radius.
            Place(_ring, ref _ringBox, _layout.RingBox(g1, fp, scroll, c.ItemSlide(g1)));
            Place(_ring2, ref _ringBox2, _layout.RingBox(g2, fp, scroll, c.ItemSlide(g2)));
            int ra1 = pin1 ? 0 : ga1, ra2 = pin2 ? 0 : ga2;
            if (ra1 != _ringAlpha) { _ringAlpha = ra1; TintRgb(_ring, ra1, Design.RingColor); }
            if (ra2 != _ringAlpha2) { _ringAlpha2 = ra2; TintRgb(_ring2, ra2, Design.RingColor); }

            for (int i = 0; i < _icon.Length; i++)
            {
                // Every item comes in on its own turn (the cascade); a pill stays a little dimmer than an icon until selected.
                Box b = _layout.IconBox(i, fp, scroll, c.ItemSlide(i));
                bool moved = !b.Equals(_iconBox[i]);
                Place(_icon[i], ref _iconBox[i], b);

                float amount = DockLayout.Amount(fp, i);
                float dim = _layout.IsPinned(i) ? Design.PillDim : Design.IconDim;
                int a = (int)Math.Round(255f * c.ItemPresence(i) * (dim + (1f - dim) * amount));
                if (a != _iconAlpha[i])
                {
                    _iconAlpha[i] = a;
                    Tint(_icon[i], a);
                    if (_initials[i] != IntPtr.Zero) Efl.evas_object_color_set(_initials[i], a, a, a, a);
                }
                // The letters follow their tile: moved only when the tile moved (Swap forgets the tile's box, so a swapped tile moves them too).
                if (_initials[i] != IntPtr.Zero && moved)
                    Efl.evas_object_move(_initials[i], b.X + (b.W - _initialsW[i]) / 2, b.Y + (b.H - _initialsH[i]) / 2);
                if (_badge != null)
                {
                    // The tick hangs BadgeInset over the tile's corner; on the focused tile, which is bigger, half of that, or it
                    // reaches the next tile. Moved only when the tile has moved.
                    int inset = BadgeInset - (b.W - DockLayout.Icon) * (BadgeInset / 2) / (DockLayout.FocusIcon - DockLayout.Icon);
                    int bx = b.X + b.W - BadgeSize + inset, by = b.Y - inset;
                    if (bx != _badgeX[i] || by != _badgeY[i])
                    {
                        _badgeX[i] = bx; _badgeY[i] = by;
                        Efl.evas_object_move(_badgeBg[i], bx, by);
                        Efl.evas_object_move(_badge[i], bx + 5, by + 5);
                    }
                    int ba = _marked != null && _marked.Contains(i) ? (int)Math.Round(255f * c.ItemPresence(i)) : 0;
                    if (ba != _badgeAlpha[i])
                    {
                        _badgeAlpha[i] = ba;
                        TintRgb(_badgeBg[i], ba, Design.ShellColor);
                        Tint(_badge[i], ba);
                    }
                }
            }

            if (_divider != IntPtr.Zero)
            {
                Place(_divider, ref _dividerBox, _layout.DividerBox(scroll, slide));
                int da = (int)Math.Round(presence * Design.DividerAlpha);     // a hairline: felt more than seen
                if (da != _dividerAlpha) { _dividerAlpha = da; Tint(_divider, da); }
            }

            if (Design.ShowLabels) ApplyLabels(c, slide, presence, scroll);
            if (Design.ShowClock) ApplyClock(slide, presence);
            if (_hint != null && _hint.Parts.Count > 0) ApplyHint(_hint, _layout.HintTop(slide), presence);
            if (_hintBelow != null && _hintBelow.Parts.Count > 0) ApplyHint(_hintBelow, _layout.HintBelowTop(slide), presence);
        }

        private static void ApplyHint(NavHint h, int y, int presence)
        {
            if (y != h.Y)
            {
                h.Y = y;
                int x = h.X;
                for (int i = 0; i < h.Parts.Count; i++)
                {
                    HintPart p = h.Parts[i];
                    if (!h.Shown(p)) continue;
                    Efl.evas_object_move(p.Obj, x, y + p.Dy);
                    x += p.W + (h.Override ? 0 : p.Gap);
                }
                if (h.Chev != IntPtr.Zero) Efl.evas_object_move(h.Chev, x + HintGap, y + (DockLayout.CapsuleH - HintChev) / 2);
            }
            // Quieter than the label, like the clock: a signpost, not a headline. The keys a little under the words, as on the cards.
            if (presence != h.Alpha)
            {
                h.Alpha = presence;
                int a = presence * 9 / 10, ka = presence * 85 / 100;
                if (h.Chev != IntPtr.Zero) Tint(h.Chev, h.ShowChev ? a : 0);
                foreach (HintPart p in h.Parts)
                {
                    if (p.Key) Tint(p.Obj, h.Shown(p) ? ka : 0);
                    else TintText(p.Obj, h.Shown(p) ? a : 0);
                }
            }
        }

        private void ApplyClock(int slide, int presence)
        {
            int x = _layout.ClockRight - _clockW;
            int y = _layout.LabelTop(slide) + 3;
            if (x != _clockX || y != _clockY)
            {
                _clockX = x; _clockY = y;
                Efl.evas_object_move(_clock, x, y);
            }
            // Quieter than the label: it is there to be glanced at, not read. It gives way to the label.
            int ts = _fader.TargetSlot;
            int a = _layout.ClockClear(_labelX[ts], _labelW[ts], _clockW) ? presence * 7 / 10 : 0;
            if (a != _clockAlpha) { _clockAlpha = a; TintText(_clock, a); }
        }

        private void ApplyLabels(Controller c, int slide, int presence, float scroll)
        {
            _fader.Update(c.FocusTarget, c.FocusPos);
            int y = _layout.LabelTop(slide);
            bool moveY = y != _labelY;
            _labelY = y;
            for (int k = 0; k < 2; k++)
            {
                int idx = _fader.Index[k];
                if ((_fader.Dirty & (1 << k)) != 0 && idx >= 0)
                {
                    // A pill carries its own name; nothing is written under it.
                    string text = _layout.IsPinned(idx) ? "" : idx == _moving ? "\u2039  " + _items[idx].Label + "  \u203a" : idx == _current ? _items[idx].Label + "  \u00b7  current" : _marked != null && _marked.Contains(idx) ? _items[idx].Label + "  \u00b7  in the row" : _items[idx].Label;
                    Efl.evas_object_text_text_set(_label[k], text);
                    _labelW[k] = Efl.evas_object_text_horiz_advance_get(_label[k]);
                    _labelX[k] = int.MinValue;   // placed again below
                }
                int a = idx < 0 ? 0 : (int)Math.Round(presence * _fader.Weight[k]);
                if (idx >= 0)
                {
                    int x = _layout.LabelLeft(idx, scroll, _labelW[k]);
                    if (x != _labelX[k] || moveY) { _labelX[k] = x; Efl.evas_object_move(_label[k], x, y); }
                }
                if (a != _labelAlpha[k]) { _labelAlpha[k] = a; TintText(_label[k], a); }
            }
            _fader.ClearDirty();
        }
    }
}
