using System;

namespace Launcher.Core
{
    /// <summary>
    /// Makes an icon read from Samsung's own app registry look like the rest of the dock: rounded
    /// corners, and a dark glass tile behind logos that ship on a transparent background. Works on
    /// EFL's pixel layout (premultiplied ARGB, one uint per pixel) so it runs on a desktop in the tests.
    /// </summary>
    internal static class IconPrep
    {
        public const int MaxSide = 256;
        public const int MinSide = 32;

        /// <summary>Below this share of opaque pixels an icon is a loose logo, not a filled tile.</summary>
        public const float LooseCoverage = 0.8f;
        /// <summary>How much of the tile a loose logo may fill.</summary>
        public const float LooseScale = 0.72f;

        public static float Coverage(uint[] px)
        {
            if (px.Length == 0) return 0f;
            int opaque = 0;
            for (int i = 0; i < px.Length; i++) if ((px[i] >> 24) > 200) opaque++;
            return opaque / (float)px.Length;
        }

        /// <summary>Corner radius in pixels: <see cref="Design.IconRadiusPct"/> percent of the side, the same rule every other icon, ring and glow follows.</summary>
        public static int Corner(int side) { return (int)Math.Round(Design.IconRadiusPct * side / 100.0); }

        /// <summary>Width of the light line inside the edge, in pixels of the finished icon: one pixel at the size the selected icon is drawn.</summary>
        public static float RimWidth(int side) { return Math.Max(1f, side / (float)DockLayout.FocusIcon); }

        /// <summary>The square the finished icon will have for a w x h source.</summary>
        public static int SideFor(int w, int h)
        {
            return Math.Max(MinSide, Math.Min(MaxSide, Math.Max(w, h)));
        }

        /// <summary>Returns the finished icon: <see cref="SideFor"/> x <see cref="SideFor"/> pixels.</summary>
        public static uint[] Prepare(uint[] src, int w, int h)
        {
            if (w <= 0 || h <= 0 || src == null || src.Length < w * h) throw new ArgumentException("bad icon size");
            // Big pictures (some apps ship a full-screen banner as their icon) are first brought down by whole halvings.
            int side = SideFor(w, h);
            while (Math.Max(w, h) >= 2 * side && w > 1 && h > 1) { src = Halve(src, w, h); w = (w + 1) / 2; h = (h + 1) / 2; }
            bool square = w == h;
            bool filled = Coverage(src) >= LooseCoverage;
            uint[] outPx;
            if (square && filled)
                outPx = w == side ? (uint[])src.Clone() : Scale(src, w, h, side, side);
            else if (filled)
            {
                // Not square but opaque (a wide banner): never cropped. A blurred stretch of the picture fills
                // the square and the whole picture sits in the middle of it.
                outPx = Scale(src, w, h, side, side);
                Blur(outPx, side, Math.Max(2, side / 10));
                int fw = w >= h ? side : Math.Max(1, (int)Math.Round(side * (double)w / h));
                int fh = h >= w ? side : Math.Max(1, (int)Math.Round(side * (double)h / w));
                Over(outPx, side, Scale(src, w, h, fw, fh), fw, fh, (side - fw) / 2, (side - fh) / 2);
            }
            else
            {
                // A loose logo on transparency: a dark glass tile behind it, a little smaller, whole.
                outPx = Tile(side);
                int box = (int)(side * LooseScale);
                int gw = w >= h ? box : Math.Max(1, (int)Math.Round(box * (double)w / h));
                int gh = h >= w ? box : Math.Max(1, (int)Math.Round(box * (double)h / w));
                Over(outPx, side, Scale(src, w, h, gw, gh), gw, gh, (side - gw) / 2, (side - gh) / 2);
            }
            RoundCorners(outPx, side, Corner(side));
            if (Design.IconRimAlpha > 0f) Rim(outPx, side, Corner(side), RimWidth(side), Design.IconRimAlpha);
            return outPx;
        }

        /// <summary>
        /// Colour for the selection glow: the icon's dominant hue (0xRRGGBB), or -1 when it has none (a blank picture).
        /// Same recipe as the designer page: a 48 x 48 sample, each pixel weighted by its opacity, its saturation
        /// and whether it is bright enough to count.
        /// </summary>
        public static int DominantColor(uint[] src, int w, int h)
        {
            if (w <= 0 || h <= 0 || src == null || src.Length < w * h) return -1;
            const int n = 48;
            uint[] s = Scale(src, w, h, n, n);
            double r = 0, g = 0, b = 0, wt = 0;
            for (int i = 0; i < s.Length; i++)
            {
                uint p = s[i];
                int a = (int)(p >> 24);
                if (a == 0) continue;
                // EFL keeps colours premultiplied; the recipe works on the straight ones.
                int pr = Math.Min(255, (int)(((p >> 16) & 0xFF) * 255 / a)), pg = Math.Min(255, (int)(((p >> 8) & 0xFF) * 255 / a)), pb = Math.Min(255, (int)((p & 0xFF) * 255 / a));
                int mx = Math.Max(pr, Math.Max(pg, pb)), mn = Math.Min(pr, Math.Min(pg, pb));
                double sat = mx > 0 ? (mx - mn) / (double)mx : 0.0;
                double q = (a / 255.0) * (0.15 + sat) * (mx > 40 ? 1.0 : 0.2);
                r += pr * q; g += pg * q; b += pb * q; wt += q;
            }
            if (wt <= 0) return -1;
            return ((int)Math.Round(r / wt) << 16) | ((int)Math.Round(g / wt) << 8) | (int)Math.Round(b / wt);
        }

        /// <summary>
        /// Blends a thin white line (<paramref name="alpha"/>) over the inside of the rounded edge. It follows the
        /// same rounded rectangle the corners were cut with, so it bends with the corners instead of ending at them.
        /// </summary>
        public static void Rim(uint[] px, int side, int radius, float width, float alpha)
        {
            double half = side / 2.0, inner = half - radius;
            int band = (int)Math.Ceiling(width) + radius + 1;
            for (int y = 0; y < side; y++)
                for (int x = 0; x < side; x++)
                {
                    if (x >= band && x < side - band && y >= band && y < side - band) continue;   // deep inside
                    double qx = Math.Abs(x + 0.5 - half) - inner, qy = Math.Abs(y + 0.5 - half) - inner;
                    double outside = Math.Sqrt(Math.Max(qx, 0) * Math.Max(qx, 0) + Math.Max(qy, 0) * Math.Max(qy, 0)) + Math.Min(Math.Max(qx, qy), 0) - radius;
                    double depth = -outside;                                  // > 0 inside the rounded edge
                    double cov = Math.Max(0.0, Math.Min(1.0, width - depth + 0.5));
                    if (depth < -0.5 || cov <= 0.0) continue;
                    uint p = px[y * side + x];
                    uint a = p >> 24;
                    if (a == 0) continue;
                    double wgt = cov * alpha;
                    uint r = (uint)Math.Round(((p >> 16) & 0xFF) * (1 - wgt) + a * wgt);
                    uint g = (uint)Math.Round(((p >> 8) & 0xFF) * (1 - wgt) + a * wgt);
                    uint b = (uint)Math.Round((p & 0xFF) * (1 - wgt) + a * wgt);
                    px[y * side + x] = (a << 24) | (Math.Min(r, a) << 16) | (Math.Min(g, a) << 8) | Math.Min(b, a);
                }
        }

        /// <summary>2 x 2 box average of premultiplied ARGB; an odd last row or column is averaged on its own.</summary>
        public static uint[] Halve(uint[] src, int w, int h)
        {
            int dw = (w + 1) / 2, dh = (h + 1) / 2;
            var dst = new uint[dw * dh];
            for (int y = 0; y < dh; y++)
                for (int x = 0; x < dw; x++)
                {
                    int x1 = Math.Min(w - 1, 2 * x + 1), y1 = Math.Min(h - 1, 2 * y + 1);
                    uint a = src[2 * y * w + 2 * x], b = src[2 * y * w + x1], c = src[y1 * w + 2 * x], d = src[y1 * w + x1];
                    uint res = 0;
                    for (int shift = 0; shift <= 24; shift += 8)
                        res |= ((((a >> shift) & 0xFF) + ((b >> shift) & 0xFF) + ((c >> shift) & 0xFF) + ((d >> shift) & 0xFF) + 2) / 4) << shift;
                    dst[y * dw + x] = res;
                }
            return dst;
        }

        /// <summary>Three passes of a box blur in each direction (close to a Gaussian), on a square picture.</summary>
        public static void Blur(uint[] px, int side, int radius)
        {
            var tmp = new uint[px.Length];
            for (int pass = 0; pass < 3; pass++)
            {
                BoxPass(px, tmp, side, radius, true);
                BoxPass(tmp, px, side, radius, false);
            }
        }

        private static void BoxPass(uint[] src, uint[] dst, int side, int radius, bool horizontal)
        {
            int n = 2 * radius + 1;
            for (int line = 0; line < side; line++)
                for (int shift = 0; shift <= 24; shift += 8)
                {
                    long sum = 0;
                    for (int k = -radius; k <= radius; k++)
                        sum += (src[Index(line, Math.Max(0, Math.Min(side - 1, k)), side, horizontal)] >> shift) & 0xFF;
                    for (int i = 0; i < side; i++)
                    {
                        dst[Index(line, i, side, horizontal)] = (dst[Index(line, i, side, horizontal)] & ~(0xFFu << shift)) | ((uint)(sum / n) << shift);
                        int add = Math.Min(side - 1, i + radius + 1), sub = Math.Max(0, i - radius);
                        sum += ((src[Index(line, add, side, horizontal)] >> shift) & 0xFF) - ((src[Index(line, sub, side, horizontal)] >> shift) & 0xFF);
                    }
                }
        }

        private static int Index(int line, int i, int side, bool horizontal) { return horizontal ? line * side + i : i * side + line; }

        /// <summary>Dark tile (a vertical gradient), the colour of the dock's own system tiles. The light edge line is added later, along the rounded edge.</summary>
        public static uint[] Tile(int side)
        {
            var px = new uint[side * side];
            for (int y = 0; y < side; y++)
            {
                float t = y / (float)(side - 1);
                int r = (int)(44 - 24 * t), g = (int)(54 - 28 * t), b = (int)(82 - 38 * t);
                for (int x = 0; x < side; x++)
                {
                    px[y * side + x] = 0xFF000000u | ((uint)r << 16) | ((uint)g << 8) | (uint)b;
                }
            }
            return px;
        }

        /// <summary>Multiplies every pixel by an anti-aliased rounded-square mask.</summary>
        public static void RoundCorners(uint[] px, int side, int radius)
        {
            if (radius <= 0) return;
            for (int y = 0; y < radius; y++)
                for (int x = 0; x < radius; x++)
                {
                    // Distance of the pixel centre from the corner circle's centre, in pixels.
                    double dx = radius - (x + 0.5), dy = radius - (y + 0.5);
                    double d = Math.Sqrt(dx * dx + dy * dy);
                    double cov = Math.Max(0.0, Math.Min(1.0, radius - d + 0.5));
                    if (cov >= 1.0) continue;
                    int m = (int)Math.Round(cov * 256);
                    Mask(px, y * side + x, m);
                    Mask(px, y * side + (side - 1 - x), m);
                    Mask(px, (side - 1 - y) * side + x, m);
                    Mask(px, (side - 1 - y) * side + (side - 1 - x), m);
                }
        }

        private static void Mask(uint[] px, int i, int m256)
        {
            uint p = px[i];
            uint a = ((p >> 24) * (uint)m256) >> 8, r = (((p >> 16) & 0xFF) * (uint)m256) >> 8,
                 g = (((p >> 8) & 0xFF) * (uint)m256) >> 8, b = ((p & 0xFF) * (uint)m256) >> 8;
            px[i] = (a << 24) | (r << 16) | (g << 8) | b;
        }

        /// <summary>Composites a premultiplied glyph over a premultiplied base.</summary>
        public static void Over(uint[] dst, int dw, uint[] glyph, int gw, int gh, int ox, int oy)
        {
            for (int y = 0; y < gh; y++)
                for (int x = 0; x < gw; x++)
                {
                    uint s = glyph[y * gw + x];
                    uint sa = s >> 24;
                    if (sa == 0) continue;
                    int di = (y + oy) * dw + (x + ox);
                    uint d = dst[di];
                    uint inv = 255 - sa;
                    uint a = sa + ((d >> 24) * inv + 127) / 255;
                    uint r = ((s >> 16) & 0xFF) + (((d >> 16) & 0xFF) * inv + 127) / 255;
                    uint g = ((s >> 8) & 0xFF) + (((d >> 8) & 0xFF) * inv + 127) / 255;
                    uint b = (s & 0xFF) + ((d & 0xFF) * inv + 127) / 255;
                    dst[di] = (Math.Min(a, 255u) << 24) | (Math.Min(r, 255u) << 16) | (Math.Min(g, 255u) << 8) | Math.Min(b, 255u);
                }
        }

        /// <summary>Bilinear resize of premultiplied ARGB, with edge clamping.</summary>
        public static uint[] Scale(uint[] src, int w, int h, int dw, int dh)
        {
            var dst = new uint[dw * dh];
            double sx = w / (double)dw, sy = h / (double)dh;
            for (int y = 0; y < dh; y++)
            {
                double fy = (y + 0.5) * sy - 0.5;
                int y0 = (int)Math.Floor(fy);
                double wy = fy - y0;
                int ya = Math.Max(0, Math.Min(h - 1, y0)), yb = Math.Max(0, Math.Min(h - 1, y0 + 1));
                for (int x = 0; x < dw; x++)
                {
                    double fx = (x + 0.5) * sx - 0.5;
                    int x0 = (int)Math.Floor(fx);
                    double wx = fx - x0;
                    int xa = Math.Max(0, Math.Min(w - 1, x0)), xb = Math.Max(0, Math.Min(w - 1, x0 + 1));
                    uint p00 = src[ya * w + xa], p10 = src[ya * w + xb], p01 = src[yb * w + xa], p11 = src[yb * w + xb];
                    uint res = 0;
                    for (int shift = 0; shift <= 24; shift += 8)
                    {
                        double top = ((p00 >> shift) & 0xFF) * (1 - wx) + ((p10 >> shift) & 0xFF) * wx;
                        double bot = ((p01 >> shift) & 0xFF) * (1 - wx) + ((p11 >> shift) & 0xFF) * wx;
                        res |= (uint)Math.Round(top * (1 - wy) + bot * wy) << shift;
                    }
                    dst[y * dw + x] = res;
                }
            }
            return dst;
        }
    }
}
