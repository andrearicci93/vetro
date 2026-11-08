using System;
using System.IO;
using Tuner.Native;

namespace Tuner.Ui
{
    /// <summary>
    /// The look of the tuner. It borrows the dock's (dock/designer/chosen.json, dock/src/Core/Design.cs): a dark slate sheet
    /// (#2A3346) with a thin white border, soft drop shadow, 24 px corners, white text, a white ring for the selection.
    /// The two sheet pictures are the dock's own (dock_bg.png, shadow.png); solid.png and ring.png are plain white rounded
    /// rectangles (64 px, radius 16) that are tinted and stretched as 9-slice.
    /// </summary>
    internal static class Theme
    {
        public const string Font = "SamsungOneUI 500,Sans";
        public const int Margin = 40;        // the shadow picture holds this much around the sheet
        public const int Radius = 24;
        public const int ShellSlice = 32;
        public const int ChipSlice = 20;

        /// <summary>Text colours are premultiplied white: alpha 255 for the main text, ~70% for the secondary one.</summary>
        public const int TextMain = 255, TextMuted = 178, TextFaint = 120;
    }

    /// <summary>
    /// A group of drawn objects that is shown or hidden as one: every object is clipped by one rectangle and the rectangle is
    /// what gets shown or hidden (the dock does the same). Objects are created visible; the clipper decides.
    /// </summary>
    internal sealed class Surface
    {
        private readonly IntPtr _evas, _clip;
        private readonly string _assets;

        public Surface(IntPtr evas, string assets, int screenW, int screenH)
        {
            _evas = evas; _assets = assets;
            _clip = Efl.evas_object_rectangle_add(evas);
            Efl.evas_object_color_set(_clip, 255, 255, 255, 255);
            Efl.evas_object_move(_clip, 0, 0);
            Efl.evas_object_resize(_clip, screenW, screenH);
            Efl.evas_object_hide(_clip);
        }

        public bool Visible { get; private set; }
        public void Show() { Visible = true; Efl.evas_object_show(_clip); }
        public void Hide() { Visible = false; Efl.evas_object_hide(_clip); }

        private IntPtr Clipped(IntPtr obj) { Efl.evas_object_clip_set(obj, _clip); Efl.evas_object_show(obj); return obj; }

        public IntPtr Text(int size, int alpha)
        {
            IntPtr t = Efl.evas_object_text_add(_evas);
            Efl.evas_object_text_font_set(t, Theme.Font, size);
            Efl.evas_object_color_set(t, alpha, alpha, alpha, alpha);
            return Clipped(t);
        }

        private IntPtr Slice(string name, int border)
        {
            IntPtr img = Efl.evas_object_image_add(_evas);
            Efl.evas_object_image_file_set(img, Path.Combine(_assets, name + ".png"), null);
            Efl.evas_object_image_filled_set(img, true);
            Efl.evas_object_image_border_set(img, border, border, border, border);
            Efl.evas_object_image_border_center_fill_set(img, 1);
            Efl.evas_object_image_smooth_scale_set(img, true);
            return Clipped(img);
        }

        /// <summary>Empty when the four pictures load; otherwise which ones did not, with the EFL error number.</summary>
        public string AssetProblems()
        {
            string problems = "";
            foreach (string n in new[] { "dock_bg", "shadow", "solid", "ring" })
            {
                IntPtr img = Efl.evas_object_image_add(_evas);
                Efl.evas_object_image_file_set(img, Path.Combine(_assets, n + ".png"), null);
                int err = Efl.evas_object_image_load_error_get(img);
                if (err != Efl.EvasLoadErrorNone) problems += " " + n + "=" + err;
                Efl.evas_object_hide(img);
            }
            return problems;
        }

        /// <summary>The dock's sheet (shadow underneath), at the given rectangle. Create cards first so they sit behind their contents.</summary>
        public Card Card() { return new Card(Slice("shadow", Theme.Margin + Theme.Radius), Slice("dock_bg", Theme.ShellSlice)); }

        /// <summary>A tinted rounded rectangle: the selection fill (white at ~16%), a track, a progress bar.</summary>
        public Chip Chip() { return new Chip(Slice("solid", Theme.ChipSlice)); }

        /// <summary>The 2 px white outline of the selection (the dock's focus ring).</summary>
        public Chip Ring() { return new Chip(Slice("ring", Theme.ChipSlice)); }

        /// <summary>Cuts the text with an ellipsis until it fits <paramref name="maxW"/> pixels.</summary>
        public static void SetFitted(IntPtr text, string s, int maxW)
        {
            Efl.evas_object_text_text_set(text, s);
            int guard = 80;
            while (s.Length > 1 && Efl.evas_object_text_horiz_advance_get(text) > maxW && guard-- > 0)
            {
                s = s.Substring(0, s.Length - 1);
                Efl.evas_object_text_text_set(text, s.TrimEnd() + "…");
            }
        }
    }

    internal sealed class Card
    {
        private readonly IntPtr _shadow, _sheet;
        internal Card(IntPtr shadow, IntPtr sheet) { _shadow = shadow; _sheet = sheet; }

        public void SetRect(int x, int y, int w, int h)
        {
            Efl.evas_object_move(_shadow, x - Theme.Margin, y - Theme.Margin);
            Efl.evas_object_resize(_shadow, w + 2 * Theme.Margin, h + 2 * Theme.Margin);
            Efl.evas_object_move(_sheet, x, y);
            Efl.evas_object_resize(_sheet, w, h);
        }
    }

    internal sealed class Chip
    {
        private readonly IntPtr _img;
        internal Chip(IntPtr img) { _img = img; Efl.evas_object_hide(img); }

        public void SetRect(int x, int y, int w, int h) { Efl.evas_object_move(_img, x, y); Efl.evas_object_resize(_img, w, h); }

        /// <summary>White at the given opacity (0..255); 0 hides it. Evas colours are premultiplied.</summary>
        public void SetWhite(int alpha)
        {
            Efl.evas_object_color_set(_img, alpha, alpha, alpha, alpha);
            if (alpha <= 0) Efl.evas_object_hide(_img); else Efl.evas_object_show(_img);
        }
    }
}
