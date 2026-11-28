using System;
using System.Collections.Generic;
using System.IO;
using Launcher.Core;
using Launcher.Native;

namespace Launcher.Ui
{
    /// <summary>
    /// What every Control center card shares, in the material of the dock's bar (and of the 123 pad): a light rim and the slate sheet for
    /// the panel, no drop shadow, a header (title, then a quieter line beside it), a divider, the key hint at the foot and one ice capsule
    /// (pill_cap) under the selected row. Only the card that has the focus shows its capsule and a bright hint; the others keep their
    /// rows as they are, so Left and Right read as moving between cards. A list longer than the card scrolls and shows a thin capsule bar
    /// (track and thumb) in the gutter right of the rows. The rows themselves belong to the card (<see cref="TaskPanel"/>, <see cref="AudioCard"/>).
    /// </summary>
    internal abstract class CardChrome
    {
        protected const string Font = "SamsungOneUI 500";
        protected const string FontBold = "SamsungOneUI 600";

        protected readonly IntPtr _win, _evas;
        protected readonly TaskLayout _layout;
        protected readonly string _assets;
        protected readonly Action<string> _log;
        private readonly string _tag;

        protected IntPtr _clip, _listClip, _rim, _bg, _plate, _track, _thumb;
        protected IntPtr _title, _sub, _empty;
        // The footer: pictures of the remote's keys (res/key_*.png, the dashboard's set) and short words, in one centred line.
        protected const int FootKey = 34, FootInner = 8, FootGroup = 40;
        private const int HeaderBase = 35;            // the header's baseline, from the header's top
        private readonly List<IntPtr> _foot = new List<IntPtr>();
        private readonly List<bool> _footKey = new List<bool>();
        private readonly List<int> _footGap = new List<int>();   // space after each part
        private readonly List<int> _footW = new List<int>(), _footH = new List<int>();   // each part's size, measured when it is made
        private int _chromeKey = -1, _plateAlpha = -1, _barKey = -1;
        // Every text is measured when it is set (a text's width, and its line height, which is not the same for an empty text), never per
        // frame. _version moves on with every change of a text or of the rows, so a placement made for the old ones is not kept.
        private int _version, _titleW, _titleAsc, _subH, _subAsc, _emptyW, _emptyH, _footTotal;
        private bool _clipPlaced;
        // What the panel, the capsule and the rows were last placed for: a frame with the same values (the card at rest, or another card's
        // selection moving) moves and resizes nothing.
        private PlaceKey _chromeAt, _plateAt, _barAt;

        protected CardChrome(IntPtr win, TaskLayout layout, string assets, Action<string> log, string tag)
        {
            _win = win; _layout = layout; _assets = assets; _log = log; _tag = tag;
            _evas = Efl.evas_object_evas_get(win);
        }

        public TaskLayout Layout { get { return _layout; } }

        /// <summary>
        /// How far under its top a text's baseline is. This binding has no ascent getter, so it is taken from the line height: ascent is 0.775 of
        /// ascent + descent in the TV's font (1047 / 1351); for another font the header texts would still share a baseline within half a pixel.
        /// </summary>
        protected static int Ascent(IntPtr text) { return AscentOf(Efl.evas_object_text_vert_advance_get(text)); }

        /// <summary>The same from a line height already measured.</summary>
        protected static int AscentOf(int lineHeight) { return (int)Math.Round(lineHeight * 0.775); }

        /// <summary>Moves on every time a text or the rows change: placements made before are made again on the next frame.</summary>
        protected int Version { get { return _version; } }
        protected void Changed() { _version++; }

        /// <summary>The quieter line of the header.</summary>
        protected void SetSub(string text)
        {
            Efl.evas_object_text_text_set(_sub, text);
            MeasureSub();
        }

        private void MeasureSub()
        {
            _subH = Efl.evas_object_text_vert_advance_get(_sub);
            _subAsc = AscentOf(_subH);
            Changed();
        }

        /// <summary>What the list says while it has no rows.</summary>
        protected void SetEmpty(string text)
        {
            Efl.evas_object_text_text_set(_empty, text);
            MeasureEmpty();
        }

        private void MeasureEmpty()
        {
            _emptyW = Efl.evas_object_text_horiz_advance_get(_empty);
            _emptyH = Efl.evas_object_text_vert_advance_get(_empty);
            Changed();
        }

        /// <summary>The clippers, the panel, the capsule and the header. Rows made after this sit above the capsule.</summary>
        protected void BuildChrome(string title)
        {
            _clip = Efl.evas_object_rectangle_add(_evas);
            Efl.evas_object_color_set(_clip, 255, 255, 255, 255);
            _listClip = Efl.evas_object_rectangle_add(_evas);
            Efl.evas_object_color_set(_listClip, 255, 255, 255, 255);
            Efl.evas_object_clip_set(_listClip, _clip);
            Efl.evas_object_show(_listClip);   // a clipper only lets through what it covers while it is visible itself

            // The dock bar's material: rim 2 px outside, then the sheet, nine-sliced to the panel radius.
            _rim = Slice("pill_rim", Design.RimSlice, (Design.PanelRadius + Design.ShellBorderW) / (double)Design.RimSlice);
            _bg = Slice("pill_bg", Design.SheetSlice, Design.PanelRadius / (double)Design.SheetSlice);
            // The selection: the 123 pad's ice capsule, its ends fully round (border_scale = half the plate's height / border).
            _plate = Slice("pill_cap", Design.CapSlice, (TaskLayout.RowH - 8) / 2.0 / Design.CapSlice);
            // The scroll bar: the same capsule picture, its ends as round as the bar is wide. Transparent until a list is longer than the card.
            _track = Slice("pill_cap", Design.CapSlice, TaskLayout.ScrollW / 2.0 / Design.CapSlice);
            _thumb = Slice("pill_cap", Design.CapSlice, TaskLayout.ScrollW / 2.0 / Design.CapSlice);

            _title = Text(FontBold, 30);
            Efl.evas_object_text_text_set(_title, title);
            _titleW = Efl.evas_object_text_horiz_advance_get(_title);
            _titleAsc = Ascent(_title);
            _sub = Text(Font, 22);
            Efl.evas_object_text_ellipsis_set(_sub, 1.0);   // without it the width set below does not cut the line (see ApplyChrome)
            _empty = Text(Font, 26);
            Efl.evas_object_text_ellipsis_set(_empty, 1.0);   // a long reason (a Shard card's note, up to 80 characters) ends in "…" inside the card
            Efl.evas_object_clip_set(_empty, _listClip);
            MeasureSub();     // no text yet: an empty line's height
            MeasureEmpty();
        }

        /// <summary>One part of the key hint: a key's picture (res/<paramref name="what"/>.png) or a word, then <paramref name="gap"/> px.</summary>
        protected void Foot(string what, bool key, int gap)
        {
            IntPtr part = key ? FootIcon(what) : FootText(what);
            int w = key ? FootKey : Efl.evas_object_text_horiz_advance_get(part), h = key ? FootKey : Efl.evas_object_text_vert_advance_get(part);
            _foot.Add(part); _footKey.Add(key); _footGap.Add(gap); _footW.Add(w); _footH.Add(h);
            _footTotal += w + gap;
            Changed();
        }

        private IntPtr FootText(string word)
        {
            IntPtr t = Text(Font, 22);
            Efl.evas_object_text_text_set(t, word);
            return t;
        }

        private IntPtr FootIcon(string name)
        {
            IntPtr img = Efl.evas_object_image_add(_evas);
            Efl.evas_object_image_file_set(img, Path.Combine(_assets, name + ".png"), null);
            if (Efl.evas_object_image_load_error_get(img) != Efl.EvasLoadErrorNone) _log(_tag + ": asset missing: " + name);
            Efl.evas_object_image_filled_set(img, true);
            Efl.evas_object_image_smooth_scale_set(img, true);
            Efl.evas_object_resize(img, FootKey, FootKey);
            Efl.evas_object_clip_set(img, _clip);
            Efl.evas_object_color_set(img, 0, 0, 0, 0);
            Efl.evas_object_show(img);
            return img;
        }

        protected IntPtr Slice(string name, int border, double scale)
        {
            IntPtr img = Efl.evas_object_image_add(_evas);
            Efl.evas_object_image_file_set(img, Path.Combine(_assets, name + ".png"), null);
            if (Efl.evas_object_image_load_error_get(img) != Efl.EvasLoadErrorNone) _log(_tag + ": asset missing: " + name);
            Efl.evas_object_image_filled_set(img, true);
            Efl.evas_object_image_border_set(img, border, border, border, border);
            if (scale != 1.0) Efl.evas_object_image_border_scale_set(img, scale);
            Efl.evas_object_image_border_center_fill_set(img, 1);
            Efl.evas_object_image_smooth_scale_set(img, true);
            Efl.evas_object_clip_set(img, _clip);
            Efl.evas_object_color_set(img, 0, 0, 0, 0);
            Efl.evas_object_show(img);
            return img;
        }

        protected IntPtr Text(string font, int size)
        {
            IntPtr t = Efl.evas_object_text_add(_evas);
            Efl.evas_object_text_font_set(t, font, size);
            Efl.evas_object_text_style_set(t, Efl.EvasTextStyleSoftShadow);
            Efl.evas_object_clip_set(t, _clip);
            Efl.evas_object_color_set(t, 0, 0, 0, 0);
            Efl.evas_object_show(t);
            return t;
        }

        /// <summary>A text inside the list (clipped to it while the list scrolls).</summary>
        protected IntPtr RowText(string font, int size)
        {
            IntPtr t = Efl.evas_object_text_add(_evas);
            Efl.evas_object_text_font_set(t, font, size);
            Efl.evas_object_text_style_set(t, Efl.EvasTextStyleSoftShadow);
            Efl.evas_object_clip_set(t, _listClip);
            Efl.evas_object_show(t);
            return t;
        }

        /// <summary>A picture inside the list, <paramref name="size"/> px square, from res/<paramref name="name"/>.png.</summary>
        protected IntPtr RowIcon(string name, int size)
        {
            IntPtr img = Efl.evas_object_image_add(_evas);
            Efl.evas_object_image_file_set(img, Path.Combine(_assets, name + ".png"), null);
            if (Efl.evas_object_image_load_error_get(img) != Efl.EvasLoadErrorNone) _log(_tag + ": asset missing: " + name);
            Efl.evas_object_image_filled_set(img, true);
            Efl.evas_object_image_smooth_scale_set(img, true);
            Efl.evas_object_resize(img, size, size);
            Efl.evas_object_clip_set(img, _listClip);
            Efl.evas_object_show(img);
            return img;
        }

        /// <summary>A 1 px horizontal divider inside the list (clipped to it while the list scrolls).</summary>
        protected IntPtr RowRule()
        {
            IntPtr r = Efl.evas_object_rectangle_add(_evas);
            Efl.evas_object_clip_set(r, _listClip);
            Efl.evas_object_color_set(r, 0, 0, 0, 0);
            Efl.evas_object_show(r);
            return r;
        }

        public void SetVisible(bool visible)
        {
            if (visible) Efl.evas_object_show(_clip); else Efl.evas_object_hide(_clip);
        }

        /// <summary>The rows will be re-tinted on the next frame (their text or state changed).</summary>
        protected void Retint() { _chromeKey = -1; }

        protected static void Tint(IntPtr o, int a) { Efl.evas_object_color_set(o, a, a, a, a); }

        protected static void TintText(IntPtr t, int a)
        {
            Tint(t, a);
            Efl.evas_object_text_shadow_color_set(t, 0, 0, 0, 150 * a / 255);
        }

        /// <summary>
        /// The row's one baseline: every text of a row stands on it, whatever its size (the name at 27 px and the value at 24 px
        /// were each centred by their own box and ended up on two baselines, both low). <see cref="RowBase"/> px under the row's
        /// middle, as drawn in design/dock.html; the 1 is the soft shadow's padding above the letters.
        /// </summary>
        protected const int RowBase = 9;
        protected static int RowTextTop(IntPtr text, int rowMiddle) { return rowMiddle + RowBase - Ascent(text) - 1; }

        /// <summary>
        /// Slate ink for a text on the focus capsule. The style stays the soft shadow, with the shadow made invisible: switching to
        /// the plain style dropped the shadow's padding, and the text jumped 1 px up and left when its row took the focus.
        /// </summary>
        protected static void InkText(IntPtr t, int a, int rgb)
        {
            TintRgb(t, a, rgb);
            Efl.evas_object_text_shadow_color_set(t, 0, 0, 0, 0);
        }

        protected static void TintRgb(IntPtr o, int a, int rgb)
        {
            Efl.evas_object_color_set(o, ((rgb >> 16) & 0xFF) * a / 255, ((rgb >> 8) & 0xFF) * a / 255, (rgb & 0xFF) * a / 255, a);
        }

        protected static void Place(IntPtr o, Box b) { Efl.evas_object_move(o, b.X, b.Y); Efl.evas_object_resize(o, b.W, b.H); }

        /// <summary>Top of a text whose line height is known, standing on the row's baseline (as <see cref="RowTextTop(IntPtr, int)"/>).</summary>
        protected static int RowTextTop(int lineHeight, int rowMiddle) { return rowMiddle + RowBase - AscentOf(lineHeight) - 1; }

        /// <summary>
        /// Draws the panel, the header, the divider, the footer and the capsule for a list of <paramref name="n"/> rows, and returns the
        /// opacity (0-255) the rows are drawn at. <paramref name="retint"/> comes back true when the rows have to be tinted again.
        /// </summary>
        protected int ApplyChrome(TaskController c, int n, bool focused, out bool retint, bool capsule = true)
        {
            int slide = c.Slide;
            int a = (int)Math.Round(255f * c.Presence);
            int rows = _layout.Rows(n);

            if (!_clipPlaced)
            {
                // The card's clipper covers the whole window, always.
                _clipPlaced = true;
                Efl.evas_object_move(_clip, 0, 0);
                Efl.evas_object_resize(_clip, _layout.WinW, _layout.WinH);
            }
            if (!_chromeAt.Same(slide, n, rows, _version, 0f, 0f))
            {
                Place(_listClip, _layout.ListClip(n, slide));
                Place(_rim, _layout.Rim(n, slide));
                Place(_bg, _layout.Panel(n, slide));

                // The header's texts stand on one baseline, HeaderBase under the header's top.
                int headTop = _layout.HeaderTop(n, slide), headBase = headTop + HeaderBase;
                Efl.evas_object_move(_title, _layout.ContentLeft, headBase - _titleAsc);
                // The quieter line ends where the card's content ends: a long one ("The TV switches off in 120 min" on a 520 px card)
                // is cut with an ellipsis instead of running to the card's edge.
                int subX = _layout.ContentLeft + _titleW + 18;
                Efl.evas_object_resize(_sub, Math.Max(1, _layout.ContentRight - subX), _subH);
                Efl.evas_object_move(_sub, subX, headBase - _subAsc);
                // The footer's keys and words are centred in its band (they sat 4 px high: 10 px above, 20 below).
                int fx = _layout.PanelX + (_layout.PanelW - _footTotal) / 2, fmid = _layout.FooterTop(n, slide) + FootKey / 2;
                for (int i = 0; i < _foot.Count; i++)
                {
                    Efl.evas_object_move(_foot[i], fx, fmid - _footH[i] / 2);
                    fx += _footW[i] + _footGap[i];
                }

                if (n == 0)
                {
                    Box lc = _layout.ListClip(0, slide);
                    // Sized to the room there is (never to its own advance, which could cut a short text's last letter), centred by what it shows.
                    int room = Math.Max(1, lc.W - 48), ew = Math.Min(_emptyW, room);
                    Efl.evas_object_resize(_empty, room, _emptyH);
                    Efl.evas_object_move(_empty, lc.X + (lc.W - ew) / 2, lc.Y + (lc.H - _emptyH) / 2);
                }
            }

            int key = a * 4 + (focused ? 1 : 0) + (n == 0 ? 2 : 0);
            retint = key != _chromeKey;
            if (retint)
            {
                _chromeKey = key;
                TintRgb(_rim, (int)Math.Round(a * Design.ShellBorderAlpha), Design.ShellBorderColor);
                TintRgb(_bg, (int)Math.Round(a * Design.VolumeAlpha), Design.ShellColor);
                TintText(_title, a);
                TintText(_sub, a * 6 / 10);
                // The hint is the focused card's: on the others it steps back.
                int fk = focused ? a * 85 / 100 : a * 40 / 100, fw = focused ? a * 55 / 100 : a * 30 / 100;
                for (int i = 0; i < _foot.Count; i++) { if (_footKey[i]) Tint(_foot[i], fk); else TintText(_foot[i], fw); }
                TintText(_empty, n == 0 ? a * 6 / 10 : 0);
            }

            // Selection: one ice capsule on the selected row of the focused card (it slides between rows with the selection).
            if (!_plateAt.Same(slide, n, rows, _version, c.SelPos, c.Scroll)) Place(_plate, _layout.Plate(c.SelPos, c.Scroll, n, slide));
            int pa = n > 0 && focused && capsule ? (int)Math.Round(a * Design.FocusFillAlpha) : 0;
            if (pa != _plateAlpha) { _plateAlpha = pa; TintRgb(_plate, pa, Design.RingColor); }

            // Scroll bar, only while the list is longer than the card. Placed again only when the card slides, its rows change or it scrolls.
            bool bar = _layout.Scrolls(n);
            if (bar && !_barAt.Same(slide, n, rows, _version, 0f, c.Scroll))
            {
                Place(_track, _layout.ScrollTrack(n, slide));
                Place(_thumb, _layout.ScrollThumb(c.Scroll, n, slide));
            }
            int bk = bar ? a * 2 + (focused ? 1 : 0) : -2;
            if (bk != _barKey)
            {
                _barKey = bk;
                TintRgb(_track, bar ? (int)Math.Round(a * Design.ScrollTrackAlpha) : 0, Design.ShellBorderColor);
                TintRgb(_thumb, bar ? (int)Math.Round(a * (focused ? Design.ScrollThumbAlpha : Design.ScrollThumbAlpha / 2)) : 0, Design.RingColor);
            }
            return a;
        }
    }
}
