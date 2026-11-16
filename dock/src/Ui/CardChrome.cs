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
    /// rows as they are, so Left and Right read as moving between cards. The rows themselves belong to the card (<see cref="TaskPanel"/>,
    /// <see cref="AudioCard"/>).
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

        protected IntPtr _clip, _listClip, _rim, _bg, _divider, _plate;
        protected IntPtr _title, _sub, _empty;
        // The footer: pictures of the remote's keys (res/key_*.png, the dashboard's set) and short words, in one centred line.
        protected const int FootKey = 34, FootInner = 8, FootGroup = 40;
        private const int HeaderBase = 35;            // the header's baseline, from the header's top
        private readonly List<IntPtr> _foot = new List<IntPtr>();
        private readonly List<bool> _footKey = new List<bool>();
        private readonly List<int> _footGap = new List<int>();   // space after each part
        private int _chromeKey = -1, _plateAlpha = -1;
        private bool _visible;

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
        protected static int Ascent(IntPtr text) { return (int)Math.Round(Efl.evas_object_text_vert_advance_get(text) * 0.775); }

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
            _divider = Efl.evas_object_rectangle_add(_evas);
            Efl.evas_object_clip_set(_divider, _clip);
            // The selection: the 123 pad's ice capsule, its ends fully round (border_scale = half the plate's height / border).
            _plate = Slice("pill_cap", Design.CapSlice, (TaskLayout.RowH - 8) / 2.0 / Design.CapSlice);

            _title = Text(FontBold, 30);
            Efl.evas_object_text_text_set(_title, title);
            _sub = Text(Font, 22);
            _empty = Text(Font, 26);
            Efl.evas_object_clip_set(_empty, _listClip);
        }

        /// <summary>One part of the key hint: a key's picture (res/<paramref name="what"/>.png) or a word, then <paramref name="gap"/> px.</summary>
        protected void Foot(string what, bool key, int gap)
        {
            _foot.Add(key ? FootIcon(what) : FootText(what)); _footKey.Add(key); _footGap.Add(gap);
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

        /// <summary>Width of the footer line: keys, words and the spaces between them.</summary>
        private int FooterWidth()
        {
            int w = 0;
            for (int i = 0; i < _foot.Count; i++) w += (_footKey[i] ? FootKey : Efl.evas_object_text_horiz_advance_get(_foot[i])) + _footGap[i];
            return w;
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

        public bool Visible { get { return _visible; } }

        public void SetVisible(bool visible)
        {
            _visible = visible;
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

        protected static void TintRgb(IntPtr o, int a, int rgb)
        {
            Efl.evas_object_color_set(o, ((rgb >> 16) & 0xFF) * a / 255, ((rgb >> 8) & 0xFF) * a / 255, (rgb & 0xFF) * a / 255, a);
        }

        protected static void Place(IntPtr o, Box b) { Efl.evas_object_move(o, b.X, b.Y); Efl.evas_object_resize(o, b.W, b.H); }

        /// <summary>
        /// Draws the panel, the header, the divider, the footer and the capsule for a list of <paramref name="n"/> rows, and returns the
        /// opacity (0-255) the rows are drawn at. <paramref name="retint"/> comes back true when the rows have to be tinted again.
        /// </summary>
        protected int ApplyChrome(TaskController c, int n, bool focused, out bool retint, bool capsule = true)
        {
            int slide = c.Slide;
            int a = (int)Math.Round(255f * c.Presence);

            Efl.evas_object_move(_clip, 0, 0);
            Efl.evas_object_resize(_clip, _layout.WinW, _layout.WinH);
            Place(_listClip, _layout.ListClip(n, slide));
            Place(_rim, _layout.Rim(n, slide));
            Place(_bg, _layout.Panel(n, slide));

            // The header's texts stand on one baseline, HeaderBase under the header's top.
            int headTop = _layout.HeaderTop(n, slide), headBase = headTop + HeaderBase;
            Efl.evas_object_move(_title, _layout.ContentLeft, headBase - Ascent(_title));
            Efl.evas_object_move(_sub, _layout.ContentLeft + Efl.evas_object_text_horiz_advance_get(_title) + 18, headBase - Ascent(_sub));
            Box div; div.X = _layout.PanelX + TaskLayout.PadX; div.W = _layout.PanelW - 2 * TaskLayout.PadX; div.H = 1;
            div.Y = _layout.ListTop(n, slide) - 6;
            Place(_divider, div);
            int fx = _layout.PanelX + (_layout.PanelW - FooterWidth()) / 2, fmid = _layout.FooterTop(n, slide) + FootKey / 2 - 4;
            for (int i = 0; i < _foot.Count; i++)
            {
                int w = _footKey[i] ? FootKey : Efl.evas_object_text_horiz_advance_get(_foot[i]);
                int h = _footKey[i] ? FootKey : Efl.evas_object_text_vert_advance_get(_foot[i]);
                Efl.evas_object_move(_foot[i], fx, fmid - h / 2);
                fx += w + _footGap[i];
            }

            int key = a * 4 + (focused ? 1 : 0) + (n == 0 ? 2 : 0);
            retint = key != _chromeKey;
            if (retint)
            {
                _chromeKey = key;
                TintRgb(_rim, (int)Math.Round(a * Design.ShellBorderAlpha), Design.ShellBorderColor);
                TintRgb(_bg, (int)Math.Round(a * Design.VolumeAlpha), Design.ShellColor);
                Tint(_divider, (int)(a * Design.DividerAlpha));
                TintText(_title, a);
                TintText(_sub, a * 6 / 10);
                // The hint is the focused card's: on the others it steps back.
                int fk = focused ? a * 85 / 100 : a * 40 / 100, fw = focused ? a * 55 / 100 : a * 30 / 100;
                for (int i = 0; i < _foot.Count; i++) { if (_footKey[i]) Tint(_foot[i], fk); else TintText(_foot[i], fw); }
                TintText(_empty, n == 0 ? a * 6 / 10 : 0);
            }

            if (n == 0)
            {
                Box lc = _layout.ListClip(0, slide);
                int ew = Efl.evas_object_text_horiz_advance_get(_empty), eh = Efl.evas_object_text_vert_advance_get(_empty);
                Efl.evas_object_move(_empty, lc.X + (lc.W - ew) / 2, lc.Y + (lc.H - eh) / 2);
            }

            // Selection: one ice capsule on the selected row of the focused card (it slides between rows with the selection).
            Place(_plate, _layout.Plate(c.SelPos, c.Scroll, n, slide));
            int pa = n > 0 && focused && capsule ? (int)Math.Round(a * Design.FocusFillAlpha) : 0;
            if (pa != _plateAlpha) { _plateAlpha = pa; TintRgb(_plate, pa, Design.RingColor); }
            return a;
        }
    }
}
