using System;
using Tuner.Core;
using System.IO;
using Tuner.Native;

namespace Tuner.Ui
{
    /// <summary>
    /// The look of the tuner. It borrows the dock's (dock/designer/chosen.json, dock/src/Core/Design.cs): a dark slate sheet
    /// (Fumé #243448, opaque) with a thin white border, soft drop shadow, 16 px corners, white text, an ice-white ring for the selection
    /// and a light blue (#A5D8FF) only for progress and indicators.
    /// The two sheet pictures are the dock's own (dock_bg.png, shadow.png); solid.png and ring.png are plain white rounded
    /// rectangles (64 px, radius 12) that are tinted and stretched as 9-slice; bar.png is the 6 px progress bar (tools/make-bar.py).
    /// That sheet (<see cref="Surface.Card"/>) is no longer drawn by any view. The Banner, Info and the guide stand on the veil (veil_corner.png),
    /// the Banner and Info with a halo under every text, the guide's cells are pill.png; the Channel pad, Channel list and Audio toast use the
    /// osd 123's material (pill_rim.png, pill_bg.png, pill_cap.png, the dock's own pictures).
    /// </summary>
    internal static class Theme
    {
        public const string Font = TextMetrics.Font500;
        public const int BarSlice = 3;       // bar.png is drawn at its real size (16 x 6, radius 3): the ends are never scaled

        /// <summary>Text colours are premultiplied white: alpha 255 for the main text, ~70% for the secondary one.</summary>
        public const int TextMain = 255, TextMuted = 178;

        /// <summary>The focus capsule (ice).</summary>
        public const int Ice = 0xE4F2FF;

        // ---- the veil and the refined material (design/challenge/opus6) ----

        /// <summary>The three weights the TV has (never a bold or synthetic weight): 200 for the big numbers and the clock, 500 for text, 600 for names and titles.</summary>
        // One family name per font, never a fallback list (see Core/TextMetrics.cs).
        public const string Font200 = TextMetrics.Font200, Font500 = TextMetrics.Font500, Font600 = TextMetrics.Font600;

        /// <summary>White text on the veil: secondary (.76), the programme title on the Banner (.92), "nothing" (.64).</summary>
        public const int VeilMuted = 194, VeilTitle = 235, VeilFaint = 163;

        /// <summary>The halo under every text of the Banner and Info: the EVAS soft shadow in black at this opacity (it fades with the text).</summary>
        public const int HaloAlpha = 140;

        /// <summary>The slate of the sheets (Fumé #243448): the body of the panels at 90%, and the ink of a text on the ice focus capsule.</summary>
        public const int Slate = 0x243448, SheetAlpha = 229, RimAlpha = 56, KeyAlpha = 36, FocusAlpha = 245;

        /// <summary>Text placement with the metrics Evas really uses on the TV: see Core/TextMetrics.cs.</summary>
        public const int HaloPad = TextMetrics.HaloPad;
        public static double Baseline(int top, int size) { return TextMetrics.Baseline(top, size); }
        public static int TopFor(double baseline, int size, int padTop = 0) { return TextMetrics.TopFor(baseline, size, padTop); }
        public static int TopOf(int top, int size, int padTop = 0) { return TextMetrics.TopOf(top, size, padTop); }
        public static int TopForCentre(int boxTop, int boxH, int size, int padTop = 0) { return TextMetrics.TopForCentre(boxTop, boxH, size, padTop); }

        /// <summary>Moves a halo text so that its letters (not its padded object) start at x.</summary>
        public static void MoveHalo(IntPtr text, int x, int y) { Efl.evas_object_move(text, x - HaloPad, y); }

        /// <summary>White text at the given opacity (premultiplied), with its halo fading along: a hidden text must not leave its shadow behind.</summary>
        public static void TintHalo(IntPtr text, int a)
        {
            Efl.evas_object_color_set(text, a, a, a, a);
            Efl.evas_object_text_shadow_color_set(text, 0, 0, 0, HaloAlpha * a / 255);
        }

        /// <summary>A text colour (0xRRGGBB) at the given opacity, premultiplied.</summary>
        public static void TintText(IntPtr text, int rgb, int a)
        {
            Efl.evas_object_color_set(text, ((rgb >> 16) & 255) * a / 255, ((rgb >> 8) & 255) * a / 255, (rgb & 255) * a / 255, a);
        }
    }

    /// <summary>
    /// A group of drawn objects that is shown or hidden as one: every object is clipped by one rectangle and the rectangle is
    /// what gets shown or hidden (the dock does the same). Objects are created visible; the clipper decides.
    /// The clipper's alpha is the group's: <see cref="Show"/> fades the group in (200 ms, after 60 ms) and <see cref="Hide"/> fades it out
    /// (200 ms, slow start) before hiding it, one object animated for the whole view. <see cref="Visible"/> changes at once: a view on its way
    /// out is already "not visible" to the program.
    /// </summary>
    internal sealed class Surface
    {
        private readonly IntPtr _evas, _clip;
        private readonly string _assets;
        private bool _drawn;      // the clipper is shown (true also while fading out)
        private int _alpha;       // the clipper's alpha now

        public Surface(IntPtr evas, string assets, int screenW, int screenH)
        {
            _evas = evas; _assets = assets;
            _clip = Efl.evas_object_rectangle_add(evas);
            Efl.evas_object_move(_clip, 0, 0);
            Efl.evas_object_resize(_clip, screenW, screenH);
            SetAlpha(255);
            Efl.evas_object_hide(_clip);
        }

        public bool Visible { get; private set; }

        /// <summary>On screen: fades in when it was not (from where a fade-out had got to), at once with motion off.</summary>
        public void Show()
        {
            if (Visible) return;
            Visible = true;
            int from = _drawn ? _alpha : 0;
            Draw();
            Anim.Run(this, Tuner.Core.Motion.FadeSeconds, from == 0 ? Tuner.Core.Motion.EnterDelay : 0, Tuner.Core.Motion.Linear, p => SetAlpha(Tuner.Core.Motion.Lerp(from, 255, p)));
        }

        /// <summary>Off screen after a 200 ms fade (slow start).</summary>
        public void Hide()
        {
            if (!Visible) return;
            Leave(Tuner.Core.Motion.FadeSeconds, Tuner.Core.Motion.In);
        }

        /// <summary>Off screen after a fade of the given length and curve (the guide leaves in 140 ms, linear).</summary>
        public void Leave(double seconds, double[][] curve)
        {
            Visible = false;
            if (!_drawn) return;
            int from = _alpha;
            Anim.Run(this, seconds, 0, curve, p => SetAlpha(Tuner.Core.Motion.Lerp(from, 0, p)), () => { if (!Visible) Undraw(); });
        }

        /// <summary>On screen now, fully opaque, no fade.</summary>
        public void ShowNow() { Anim.Cancel(this); Visible = true; Draw(); SetAlpha(255); }

        /// <summary>Off screen now, no fade.</summary>
        public void HideNow() { Anim.Cancel(this); Visible = false; Undraw(); }

        /// <summary>For a transition: keeps the group drawn and opaque although it is logically hidden (its parts are flying or fading on their own).</summary>
        public void KeepDrawn() { Anim.Cancel(this); Draw(); SetAlpha(255); }

        /// <summary>For a transition: stops this group's own fade and sets its alpha, or fades it from <paramref name="alpha"/> to 255.</summary>
        public void Settle(int alpha, double seconds = 0, double delay = 0)
        {
            Anim.Cancel(this);
            Draw();
            if (seconds <= 0) { SetAlpha(alpha); return; }
            Anim.Run(this, seconds, delay, Tuner.Core.Motion.Linear, p => SetAlpha(Tuner.Core.Motion.Lerp(alpha, 255, p)));
        }

        private void Draw() { if (!_drawn) { _drawn = true; Efl.evas_object_show(_clip); } }
        private void Undraw() { _drawn = false; Efl.evas_object_hide(_clip); SetAlpha(0); }
        private void SetAlpha(int a) { _alpha = a; Efl.evas_object_color_set(_clip, a, a, a, a); }

        private IntPtr Clipped(IntPtr obj) { Efl.evas_object_clip_set(obj, _clip); Efl.evas_object_show(obj); return obj; }

        public IntPtr Text(int size, int alpha) { return Text(size, alpha, Theme.Font); }

        public IntPtr Text(int size, int alpha, string font)
        {
            IntPtr t = Efl.evas_object_text_add(_evas);
            Texts.Created(t, font, size);
            Efl.evas_object_color_set(t, alpha, alpha, alpha, alpha);
            return Clipped(t);
        }

        /// <summary>A text on the veil (Banner, Info): the EVAS soft shadow in black under the letters, the dock's halo, which makes it legible on any picture.</summary>
        public IntPtr HaloText(int size, int alpha, string font)
        {
            IntPtr t = Text(size, alpha, font);
            Texts.Style(t, Efl.EvasTextStyleSoftShadow);
            Theme.TintHalo(t, alpha);
            return t;
        }

        private IntPtr Slice(string name, int border) { return Slice(name, border, border, border, border); }

        private IntPtr Slice(string name, int l, int r, int t, int b)
        {
            IntPtr img = Efl.evas_object_image_add(_evas);
            Efl.evas_object_image_file_set(img, Path.Combine(_assets, name + ".png"), null);
            Efl.evas_object_image_filled_set(img, true);
            Efl.evas_object_image_border_set(img, l, r, t, b);
            Efl.evas_object_image_border_center_fill_set(img, 1);
            Efl.evas_object_image_smooth_scale_set(img, true);
            return Clipped(img);
        }

        /// <summary>A picture drawn as it is (a remote key, res/key_*.png), hidden until it is placed. Colours are premultiplied like the rest.</summary>
        public IntPtr Picture(string name)
        {
            IntPtr img = Efl.evas_object_image_add(_evas);
            Efl.evas_object_image_file_set(img, Path.Combine(_assets, name + ".png"), null);
            Efl.evas_object_image_filled_set(img, true);
            Efl.evas_object_image_smooth_scale_set(img, true);
            Efl.evas_object_color_set(img, 0, 0, 0, 0);
            Clipped(img);
            Efl.evas_object_hide(img);
            return img;
        }

        /// <summary>A channel logo: one picture object whose file changes (the TV's own saved logo, 87 px, round). Hidden until <see cref="Logo.Show"/>.</summary>
        public Logo Logo()
        {
            IntPtr img = Efl.evas_object_image_add(_evas);
            Efl.evas_object_image_filled_set(img, true);
            Efl.evas_object_image_smooth_scale_set(img, true);
            Efl.evas_object_color_set(img, 255, 255, 255, 255);
            Clipped(img);
            Efl.evas_object_hide(img);
            return new Logo(img);
        }

        /// <summary>
        /// Empty when the pictures load; otherwise which ones did not, with the EFL error number. One probe object reads each file's header in
        /// turn and is deleted at the end (it used to be one object a picture, kept for the life of the process).
        /// </summary>
        public string AssetProblems()
        {
            string problems = "";
            var names = new System.Collections.Generic.List<string>(new[] { "bar", "veil_corner", "progress", "pill_bg", "pill_rim", "pill_cap", "pill", "hatch" });
            names.AddRange(Tuner.Core.GuideScene.KeyNames);
            IntPtr img = Efl.evas_object_image_add(_evas);
            Efl.evas_object_hide(img);
            foreach (string n in names)
            {
                Efl.evas_object_image_file_set(img, Path.Combine(_assets, n + ".png"), null);
                int err = Efl.evas_object_image_load_error_get(img);
                if (err != Efl.EvasLoadErrorNone) problems += " " + n + "=" + err;
            }
            Efl.evas_object_del(img);
            return problems;
        }

        /// <summary>
        /// A 6 px progress bar (track or fill) with round ends. It must be drawn exactly 6 px tall: its picture is a capsule of that size cut with a
        /// border of 3, whereas the chip's border (20) is taller than the bar and would squeeze the ends into points.
        /// </summary>
        public Chip Bar() { return new Chip(Slice("bar", Theme.BarSlice)); }

        /// <summary>
        /// The progress with its head (progress.png, 40 x 32, already Luce blue: not tinted). The head is the right part of the picture: its border
        /// keeps 4 px on the left and 32 on the right, and only the middle stretches. Always drawn 32 px tall.
        /// </summary>
        public IntPtr Progress()
        {
            IntPtr img = Slice("progress", 4, 32, 0, 0);
            Efl.evas_object_color_set(img, 255, 255, 255, 255);
            Efl.evas_object_hide(img);
            return img;
        }

        /// <summary>A capsule (pill_cap.png, 72 px, radius 36): a key of the Channel pad, the focus of the pad and of the Channel list. <see cref="Chip.SetRadius"/> sets its radius.</summary>
        public Chip Cap() { return new Chip(Slice("pill_cap", 36), 36); }

        /// <summary>The material of the osd 123, for every panel of the old OSD: a white rim 2 px outside and the slate body. No shadow.</summary>
        public Panel Panel() { return new Panel(Slice("pill_rim", 50), Slice("pill_bg", 48)); }

        /// <summary>A plain rectangle (a line of the guide), hidden until it is placed. Colours are premultiplied.</summary>
        public IntPtr Rect()
        {
            IntPtr r = Clipped(Efl.evas_object_rectangle_add(_evas));
            Efl.evas_object_hide(r);
            return r;
        }

        /// <summary>A cell of the guide (pill.png: 64 px, radius 20, cut with a border of 24 drawn at its size): white at an alpha, or tinted (the ice focus).</summary>
        public Chip Pill() { return new Chip(Slice("pill", 24)); }

        /// <summary>
        /// A picture repeated at its own size over the object (hatch.png, 16 px: the stripes of "no information"): not filled, the fill is one tile.
        /// Hidden until it is placed.
        /// </summary>
        public IntPtr Tile(string name, int tile)
        {
            IntPtr img = Efl.evas_object_image_add(_evas);
            Efl.evas_object_image_file_set(img, Path.Combine(_assets, name + ".png"), null);
            Efl.evas_object_image_filled_set(img, false);
            Efl.evas_object_image_fill_set(img, 0, 0, tile, tile);
            Efl.evas_object_image_smooth_scale_set(img, false);
            Clipped(img);
            Efl.evas_object_hide(img);
            return img;
        }

        /// <summary>
        /// Cuts the text with an ellipsis until it fits <paramref name="maxW"/> pixels: the longest beginning that fits, found by halving (a long
        /// description, the guide's last line, used to be cut one letter per measurement and given up after 80, so it ran off the screen).
        /// A cut already made for that font, text and width is not measured again, and a text already on the object is not set again (<see cref="Texts"/>).
        /// </summary>
        public static void SetFitted(IntPtr text, string s, int maxW) { Texts.Fit(text, s, maxW); }
    }

    /// <summary>A channel logo drawn as a square of the given size. The file is only set again when the path changes; a file that does not load leaves it hidden.</summary>
    internal sealed class Logo
    {
        private readonly IntPtr _img;
        private string _path;
        internal Logo(IntPtr img) { _img = img; }

        /// <summary>The picture object (for the transitions).</summary>
        public IntPtr Obj { get { return _img; } }

        public void Show(string path, int x, int y, int size)
        {
            if (string.IsNullOrEmpty(path)) { Hide(); return; }
            if (path != _path)
            {
                Efl.evas_object_image_file_set(_img, path, null);
                if (Efl.evas_object_image_load_error_get(_img) != Efl.EvasLoadErrorNone) { _path = null; Efl.evas_object_hide(_img); return; }
                _path = path;
            }
            Efl.evas_object_move(_img, x, y);
            Efl.evas_object_resize(_img, size, size);
            Efl.evas_object_show(_img);
        }

        public void Hide() { Efl.evas_object_hide(_img); }
    }

    /// <summary>
    /// A panel of the old OSD in the osd 123's material: pill_rim (white .22) 2 px outside, then pill_bg (slate .90). One pair of pictures gives every
    /// radius through the border scale (radius / 48 for the body, (radius + 2) / 50 for the rim). Colours are premultiplied.
    /// </summary>
    internal sealed class Panel
    {
        private readonly IntPtr _rim, _body;

        internal Panel(IntPtr rim, IntPtr body)
        {
            _rim = rim; _body = body;
            Efl.evas_object_color_set(_rim, Theme.RimAlpha, Theme.RimAlpha, Theme.RimAlpha, Theme.RimAlpha);
            int a = Theme.SheetAlpha, rgb = Theme.Slate;
            Efl.evas_object_color_set(_body, ((rgb >> 16) & 255) * a / 255, ((rgb >> 8) & 255) * a / 255, (rgb & 255) * a / 255, a);
        }

        public void SetRect(int x, int y, int w, int h, int radius)
        {
            Efl.evas_object_move(_rim, x - 2, y - 2);
            Efl.evas_object_resize(_rim, w + 4, h + 4);
            Efl.evas_object_image_border_scale_set(_rim, (radius + 2) / 50.0);
            Efl.evas_object_move(_body, x, y);
            Efl.evas_object_resize(_body, w, h);
            Efl.evas_object_image_border_scale_set(_body, radius / 48.0);
        }
    }

    /// <summary>The veil's picture and where it stands: one picture, stretched, from the bottom-left corner of the screen.</summary>
    internal struct VeilShape
    {
        public int X, Y, W, H, Alpha;
        public VeilShape(int x, int y, int w, int h, int alpha) { X = x; Y = y; W = w; H = h; Alpha = alpha; }

        /// <summary>
        /// The Banner's (alpha .58), the Info's, the same corner grown up and to the right (alpha .66), and the guide's, grown past every edge of the
        /// screen (alpha .94): one object, so a change between them is a resize. None is the Banner's shape at alpha 0 (where it grows from).
        /// </summary>
        public static readonly VeilShape Banner = new VeilShape(0, 480, 1700, 600, 148), Info = new VeilShape(0, 80, 2500, 1000, 168),
            Guide = new VeilShape(0, 1080 - 3400, 6400, 3400, 240), None = new VeilShape(0, 480, 1700, 600, 0);
    }

    /// <summary>
    /// The veil behind the Banner, Info and the guide (veil_corner.png: a quarter ellipse centred on the bottom-left corner, stretched, not
    /// 9-slice): it replaces their cards. One object shared by the three, created before them so it sits underneath. The guide wins over Info, Info
    /// over the Banner; with none of them on screen it shrinks back to the Banner's corner at alpha 0 and is hidden. The views tell it when they
    /// show and hide; every change of shape is one resize and one alpha, animated (<see cref="Anim"/>): 320 ms, eased in three linear stretches,
    /// or the slower start of <see cref="Tuner.Core.Motion.In"/> when it goes away.
    /// </summary>
    internal sealed class Veil
    {
        public const string AnimKey = "veil";
        private readonly Surface _s;
        private readonly IntPtr _img;
        private bool _banner, _info, _guide;
        private VeilShape _now = VeilShape.None;      // what is on screen this frame

        public Veil(Surface s)
        {
            _s = s;
            _img = s.Picture("veil_corner");
            Efl.evas_object_show(_img);
        }

        public void SetBanner(bool on) { _banner = on; Update(); }
        public void SetInfo(bool on) { _info = on; Update(); }
        public void SetGuide(bool on) { _guide = on; Update(); }

        private VeilShape Target { get { return _guide ? VeilShape.Guide : _info ? VeilShape.Info : _banner ? VeilShape.Banner : VeilShape.None; } }

        private VeilShape _target = VeilShape.None;   // where it is going

        private static bool Same(VeilShape a, VeilShape b) { return a.X == b.X && a.Y == b.Y && a.W == b.W && a.H == b.H && a.Alpha == b.Alpha; }

        private void Update()
        {
            VeilShape to = Target;
            if (Same(to, _target)) return;                 // a view said again what is already so: the run in progress goes on
            _target = to;
            VeilShape from = _now;
            if (to.Alpha > 0) _s.ShowNow();
            Anim.Run(AnimKey, Tuner.Core.Motion.VeilSeconds, 0, to.Alpha == 0 ? Tuner.Core.Motion.In : Tuner.Core.Motion.Ease,
                p => Place(Lerp(from, to, p)),
                () => { if (_target.Alpha == 0) _s.HideNow(); });
        }

        private static VeilShape Lerp(VeilShape a, VeilShape b, double p)
        {
            return new VeilShape(Tuner.Core.Motion.Lerp(a.X, b.X, p), Tuner.Core.Motion.Lerp(a.Y, b.Y, p), Tuner.Core.Motion.Lerp(a.W, b.W, p), Tuner.Core.Motion.Lerp(a.H, b.H, p), Tuner.Core.Motion.Lerp(a.Alpha, b.Alpha, p));
        }

        private void Place(VeilShape v)
        {
            _now = v;
            Efl.evas_object_move(_img, v.X, v.Y);
            Efl.evas_object_resize(_img, v.W, v.H);
            Efl.evas_object_color_set(_img, v.Alpha, v.Alpha, v.Alpha, v.Alpha);
        }
    }

    internal sealed class Chip
    {
        private readonly IntPtr _img;
        private readonly int _border;
        internal Chip(IntPtr img, int border = 0) { _img = img; _border = border; Efl.evas_object_hide(img); }

        /// <summary>The picture object (for the transitions).</summary>
        public IntPtr Obj { get { return _img; } }

        public void SetRect(int x, int y, int w, int h) { Efl.evas_object_move(_img, x, y); Efl.evas_object_resize(_img, w, h); }

        /// <summary>The corner radius, for a picture made with a border (a capsule): the border is drawn at radius / border.</summary>
        public void SetRadius(int radius) { if (_border > 0) Efl.evas_object_image_border_scale_set(_img, (double)radius / _border); }

        /// <summary>White at the given opacity (0..255); 0 hides it. Evas colours are premultiplied.</summary>
        public void SetWhite(int alpha)
        {
            Efl.evas_object_color_set(_img, alpha, alpha, alpha, alpha);
            if (alpha <= 0) Efl.evas_object_hide(_img); else Efl.evas_object_show(_img);
        }

        /// <summary>A colour (0xRRGGBB) at the given opacity (0..255); 0 hides it.</summary>
        public void SetTint(int rgb, int alpha)
        {
            Efl.evas_object_color_set(_img, ((rgb >> 16) & 255) * alpha / 255, ((rgb >> 8) & 255) * alpha / 255, (rgb & 255) * alpha / 255, alpha);
            if (alpha <= 0) Efl.evas_object_hide(_img); else Efl.evas_object_show(_img);
        }
    }
}
