using System;
using System.IO;
using Launcher.Core;
using Launcher.Native;

namespace Launcher.Ui
{
    /// <summary>
    /// The evas objects of the dock and the code that maps controller state onto them.
    /// Object count is items + 8 (shadow, pill, clippers, two glows, two focus rings; two labels and the clock only when the design shows names), plus the divider
    /// when the strip has a system group and two for the navigation hint (word, chevron);
    /// icons are pre-sized PNGs, and <see cref="Apply"/> only calls into EFL for values that changed
    /// since the previous frame, so an animation frame costs a handful of native calls.
    /// </summary>
    internal sealed class Dock
    {
        private const string Font = "SamsungOneUI 500,Sans";

        private readonly IntPtr _win, _evas;
        private readonly DockLayout _layout;
        private readonly AppEntry[] _items;
        private readonly string _assets;
        private readonly Action<string> _log;

        private IntPtr _shadow, _pill, _clip, _appsClip, _highlight, _highlight2, _ring, _ring2, _clock, _divider;
        // Two name labels cross-fade (see LabelFader): the name under the icon being left and the one being reached.
        private readonly IntPtr[] _label = new IntPtr[2];
        private readonly LabelFader _fader = new LabelFader();
        private readonly int[] _labelX = { int.MinValue, int.MinValue }, _labelW = new int[2], _labelAlpha = { -1, -1 };
        private int _labelY = int.MinValue;
        private IntPtr _hintChev, _hintText;
        private readonly string _hint;
        private readonly bool _hintUp;
        private int _hintW, _hintX, _hintAlpha = -1, _hintY = int.MinValue;
        private Box _dividerBox;
        private int _dividerAlpha = -1;
        private readonly IntPtr[] _icon;
        private readonly IntPtr[] _initials;       // placeholder letters for icons that failed to load

        private readonly Box[] _iconBox;
        private readonly int[] _iconAlpha;
        private Box _shadowBox, _pillBox, _hlBox, _hlBox2, _ringBox, _ringBox2;
        private int _chromeAlpha = -1, _hlAlpha = -1, _hlAlpha2 = -1, _clockAlpha = -1, _ringAlpha = -1, _ringAlpha2 = -1;
        private int _hlRgb = -1, _hlRgb2 = -1;
        // Colour of each item's glow: the icon's dominant hue, or the design's own colour.
        private readonly int[] _glowRgb;
        private bool _hlRound, _hlRound2;      // which outline each glow object currently shows
        private int _clockW, _clockX = int.MinValue, _clockY = int.MinValue;
        private int _current = -1;
        private bool _clipSet;

        public int MissingIcons { get; private set; }

        public Dock(IntPtr win, DockLayout layout, AppEntry[] items, string assetsDir, Action<string> log)
            : this(win, layout, items, assetsDir, log, null, false) { }

        /// <param name="hint">Word of the navigation hint ("Input", "Back"), or null for none.</param>
        /// <param name="hintUp">True: chevron up, capsule above the pill; false: chevron down, below it.</param>
        public Dock(IntPtr win, DockLayout layout, AppEntry[] items, string assetsDir, Action<string> log, string hint, bool hintUp)
        {
            _win = win; _layout = layout; _items = items; _assets = assetsDir; _log = log;
            _hint = hint; _hintUp = hintUp;
            _evas = Efl.evas_object_evas_get(win);
            _icon = new IntPtr[items.Length];
            _initials = new IntPtr[items.Length];
            _iconBox = new Box[items.Length];
            _iconAlpha = new int[items.Length];
            _glowRgb = new int[items.Length];
            for (int i = 0; i < items.Length; i++) { _iconBox[i].W = -1; _iconAlpha[i] = -1; _glowRgb[i] = Design.GlowColor; }
            _shadowBox.W = _pillBox.W = _hlBox.W = _hlBox2.W = _ringBox.W = _ringBox2.W = -1;
        }

        public IntPtr Evas { get { return _evas; } }

        public void Build()
        {
            // z-order is creation order: shadow < pill < highlight < icons < ring < label.
            // The shadow image holds the window margin plus the bar's corner curve; the bar's own slice is a little wider than its corner.
            _shadow = NineSlice("shadow", DockLayout.Margin + Design.ShellRadius);
            _pill = NineSlice("dock_bg", Design.ShellSlice);
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

            if (_hint != null) BuildHint();
        }

        private const int HintChev = 24, HintGap = 4;

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

        /// <summary>The word, then its chevron: created last so they sit above the pill, never inside the clipper.</summary>
        private void BuildHint()
        {
            _hintChev = Efl.evas_object_image_add(_evas);
            Efl.evas_object_image_file_set(_hintChev, Path.Combine(_assets, _hintUp ? "chev_up.png" : "chev_down.png"), null);
            if (Efl.evas_object_image_load_error_get(_hintChev) != Efl.EvasLoadErrorNone) _log("asset missing: chevron");
            Efl.evas_object_image_filled_set(_hintChev, true);
            Efl.evas_object_image_smooth_scale_set(_hintChev, true);
            Efl.evas_object_resize(_hintChev, HintChev, HintChev);
            Efl.evas_object_show(_hintChev);
            _hintText = Efl.evas_object_text_add(_evas);
            Efl.evas_object_text_font_set(_hintText, Font, 22);
            Efl.evas_object_text_text_set(_hintText, _hint);
            // No backing shape: a soft dark shadow keeps the word readable over bright video.
            SoftShadow(_hintText);
            Efl.evas_object_show(_hintText);
            _hintTextW = Efl.evas_object_text_horiz_advance_get(_hintText);
            int textH = Efl.evas_object_text_vert_advance_get(_hintText);
            _hintW = _hintTextW + HintGap + HintChev;
            _hintX = _layout.HintLeft(_hintW);
            _hintTextDy = (DockLayout.CapsuleH - textH) / 2 - 1;
        }

        private int _hintTextW;
        private int _hintTextDy;

        /// <summary>
        /// Shows or hides the whole page. Hiding the clipper hides every icon and the highlight
        /// with it, so four calls cover the page; the objects keep their state for the way back.
        /// </summary>
        public void SetVisible(bool visible)
        {
            IntPtr[] top = { _shadow, _pill, _clip, _label[0], _label[1], _clock, _hintChev, _hintText };
            foreach (IntPtr o in top)
            {
                if (o == IntPtr.Zero) continue;
                if (visible) Efl.evas_object_show(o); else Efl.evas_object_hide(o);
            }
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

        private IntPtr NineSlice(string name, int border) { return NineSlice(name, border, border, border, border); }

        private IntPtr NineSlice(string name, int l, int r, int t, int b)
        {
            IntPtr img = Efl.evas_object_image_add(_evas);
            Efl.evas_object_image_file_set(img, Path.Combine(_assets, name + ".png"), null);
            if (Efl.evas_object_image_load_error_get(img) != Efl.EvasLoadErrorNone) _log("asset missing: " + name);
            Efl.evas_object_image_filled_set(img, true);
            Efl.evas_object_image_border_set(img, l, r, t, b);
            Efl.evas_object_image_border_center_fill_set(img, 1);
            Efl.evas_object_image_smooth_scale_set(img, true);
            Efl.evas_object_show(img);
            return img;
        }

        private IntPtr LoadIcon(int idx)
        {
            AppEntry e = _items[idx];
            IntPtr img = Efl.evas_object_image_add(_evas);
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
            }
            Efl.evas_object_image_filled_set(img, true);
            Efl.evas_object_image_smooth_scale_set(img, true);
            Efl.evas_object_image_scale_hint_set(img, Efl.EvasImageScaleHintDynamic);
            Efl.evas_object_show(img);
            return img;
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
                Efl.evas_object_image_file_set(img, e.IconPath, null);
                if (Efl.evas_object_image_load_error_get(img) != Efl.EvasLoadErrorNone) { _log("registry icon not loadable: " + e.Slug); return false; }
                int w, h;
                Efl.evas_object_image_size_get(img, out w, out h);
                if (w <= 0 || h <= 0 || w > 2048 || h > 2048) { _log("registry icon has odd size " + w + "x" + h + ": " + e.Slug); return false; }
                IntPtr data = Efl.evas_object_image_data_get(img, false);
                if (data == IntPtr.Zero) { _log("registry icon has no pixels: " + e.Slug); return false; }
                uint[] src = ReadPixels(data, Efl.evas_object_image_stride_get(img), w, h);
                int hue = IconPrep.DominantColor(src, w, h);
                if (hue >= 0) _glowRgb[idx] = hue;
                uint[] done = IconPrep.Prepare(src, w, h);
                int side = IconPrep.SideFor(w, h);
                Efl.evas_object_image_alpha_set(img, true);
                Efl.evas_object_image_size_set(img, side, side);
                IntPtr dst = Efl.evas_object_image_data_get(img, true);
                if (dst == IntPtr.Zero) { _log("registry icon: no write buffer: " + e.Slug); return false; }
                WritePixels(dst, Efl.evas_object_image_stride_get(img), done, side);
                Efl.evas_object_image_data_set(img, dst);
                Efl.evas_object_image_data_update_add(img, 0, 0, side, side);
                if (DumpIconsTo != null) _log("dump " + e.Slug + ": " + (Efl.evas_object_image_save(img, Path.Combine(DumpIconsTo, e.Slug + ".png"), null, "compress=5") ? "ok" : "failed"));
                return true;
            }
            catch (Exception ex) { _log("registry icon error (" + e.Slug + "): " + ex.Message); return false; }
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
            return i < 0 || _layout.IsPinned(i) || !Design.GlowFromIcon ? Design.GlowColor : _glowRgb[i];
        }

        private static uint[] ReadPixels(IntPtr data, int stride, int w, int h)
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

        private static void WritePixels(IntPtr data, int stride, uint[] px, int side)
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
            Place(_shadow, ref _shadowBox, _layout.ShadowBox(slide));
            Place(_pill, ref _pillBox, _layout.PillBox(slide));
            if (presence != _chromeAlpha)
            {
                _chromeAlpha = presence;
                Tint(_shadow, presence);
                Tint(_pill, presence);
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
                if (_initials[i] != IntPtr.Zero)
                {
                    int w = Efl.evas_object_text_horiz_advance_get(_initials[i]);
                    int h = Efl.evas_object_text_vert_advance_get(_initials[i]);
                    Efl.evas_object_move(_initials[i], b.X + (b.W - w) / 2, b.Y + (b.H - h) / 2);
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
            if (_hintText != IntPtr.Zero) ApplyHint(slide, presence);
        }

        private void ApplyHint(int slide, int presence)
        {
            int y = _layout.HintTop(slide);
            if (y != _hintY)
            {
                _hintY = y;
                Efl.evas_object_move(_hintText, _hintX, y + _hintTextDy);
                Efl.evas_object_move(_hintChev, _hintX + _hintTextW + HintGap, y + (DockLayout.CapsuleH - HintChev) / 2);
            }
            // Quieter than the label, like the clock: a signpost, not a headline.
            if (presence != _hintAlpha)
            {
                _hintAlpha = presence;
                int a = presence * 9 / 10;
                Tint(_hintChev, a);
                TintText(_hintText, a);
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
                    string text = _layout.IsPinned(idx) ? "" : idx == _current ? _items[idx].Label + "  \u00b7  current" : _items[idx].Label;
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
