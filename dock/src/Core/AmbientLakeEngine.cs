using System;

namespace Launcher.Core
{
    /// <summary>
    /// Synthesizes static OLED-safe Midnight Lake and Aurora Silk textures once on mode activation and computes
    /// non-repeating 50 Hz sub-pixel perspective wave/ribbon motion inside a unified wandering envelope.
    /// Every lit pixel continuously drifts across the 1920x1080 pure-#000000 canvas along an
    /// incommensurate Lissajous orbit for 100% QD-OLED burn-in prevention across all 3 scale presets
    /// (`compact` 50%x32%, `balanced` 62%x39%, `expansive` 72%x45%). Zero EFL or native P/Invoke dependencies.
    /// </summary>
    internal static class AmbientLakeEngine
    {
        public const int ScaleCompact = 0;
        public const int ScaleBalanced = 1;
        public const int ScaleExpansive = 2;
        public const int DefaultScalePreset = ScaleBalanced;

        private static readonly int[] EnvelopeWPct = { 50, 62, 72 };
        private static readonly int[] EnvelopeHPct = { 32, 39, 45 };
        private const double SweepMarginXPct = 0.03;
        private const double SweepMarginYPct = 0.03;

        public const int MaskTexW = 288;
        public const int MaskTexH = 160;
        public const int MaskPad = 2;

        public const int SwellTileW = 256;
        public const int SwellTileH = 128;
        public const int SwellRepeatX = 3;
        public const int SwellRepeatY = 3;

        public const int RippleTileW = 192;
        public const int RippleTileH = 96;
        public const int RippleRepeatX = 4;
        public const int RippleRepeatY = 4;

        private const double SwellTilesAcrossX = 1.44;
        private const double SwellTilesDownY = 1.56;
        private const double RippleTilesAcrossX = 2.24;
        private const double RippleTilesDownY = 2.42;

        private static readonly int[] Bayer4x4 =
        {
            0,  8,  2, 10,
            12, 4, 14,  6,
            3, 11,  1,  9,
            15, 7, 13,  5
        };

        internal struct LakeRenderFrame
        {
            public double PortalFx, PortalFy;
            public int PortalX, PortalY, PortalW, PortalH;
            public int MaskTint;

            public double SwellU0, SwellV0, SwellU1, SwellV1;
            public int SwellTopTint, SwellBotTint;
            public double SwellQuadFx, SwellQuadFy, SwellQuadFw, SwellQuadFh;
            public int SwellTint;

            public double RippleU0, RippleV0, RippleU1, RippleV1;
            public int RippleTopAlpha, RippleBotAlpha;
            public double RippleQuadFx, RippleQuadFy, RippleQuadFw, RippleQuadFh;
            public int RippleAlpha;
        }

        public static int ParseScalePreset(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return DefaultScalePreset;
            string v = value.Trim();
            if (string.Equals(v, "compact", StringComparison.OrdinalIgnoreCase) || v == "0") return ScaleCompact;
            if (string.Equals(v, "expansive", StringComparison.OrdinalIgnoreCase) || v == "2") return ScaleExpansive;
            return ScaleBalanced;
        }

        public static int ClampScalePreset(int scalePreset)
        {
            return (scalePreset >= ScaleCompact && scalePreset <= ScaleExpansive) ? scalePreset : DefaultScalePreset;
        }

        public static string ScalePresetName(int scalePreset)
        {
            int p = ClampScalePreset(scalePreset);
            return p == ScaleCompact ? "compact" : (p == ScaleExpansive ? "expansive" : "balanced");
        }

        public static void ComputeUnifiedEnvelopeSize(int screenW, int screenH, int scalePreset, out int envW, out int envH)
        {
            int p = ClampScalePreset(scalePreset);
            envW = Math.Max(128, (int)Math.Round(screenW * (EnvelopeWPct[p] / 100.0)));
            envH = Math.Max(80, (int)Math.Round(screenH * (EnvelopeHPct[p] / 100.0)));
        }

        public static void ComputePortalSize(int screenW, int screenH, out int portalW, out int portalH)
        {
            ComputeUnifiedEnvelopeSize(screenW, screenH, DefaultScalePreset, out portalW, out portalH);
        }

        public static void ComputePortalSize(int screenW, int screenH, int scalePreset, out int portalW, out int portalH)
        {
            ComputeUnifiedEnvelopeSize(screenW, screenH, scalePreset, out portalW, out portalH);
        }

        /// <summary>
        /// Builds a seamless toroidal opaque (A=255) water-swell tile where troughs are deep abyssal midnight
        /// navy (#020816) and crests rise to noble midnight sapphire (#245EB0 -> #4488D8), with 4x4 Bayer dithering.
        /// </summary>
        public static uint[] BuildOpaqueSwellTilePixels()
        {
            var px = new uint[SwellTileW * SwellTileH];
            for (int y = 0; y < SwellTileH; y++)
            {
                double v = (double)y / SwellTileH;
                int row = y * SwellTileW;
                for (int x = 0; x < SwellTileW; x++)
                {
                    double u = (double)x / SwellTileW;
                    double nLow = TileNoise(u, v, 2, 3, 19);
                    double nMid = TileNoise(u, v, 3, 6, 37);
                    double nCross = TileNoise(u, v, 4, 8, 59);

                    // Gently bowed horizontal water swells (anisotropic width >> height)
                    double arch = 0.22 * Math.Sin(u * Math.PI * 2.0 + 0.5);
                    double phase = v * 3.0 + arch + (nLow - 0.5) * 1.18 + (nMid - 0.5) * 0.38 + (nCross - 0.5) * 0.15;
                    double crest = 0.5 + 0.5 * Math.Sin(phase * Math.PI * 2.0);
                    double swell = Math.Pow(crest, 2.15);

                    // Natural wind-fetch wave packets
                    double pocket = 0.32 + 0.68 * TileNoise(u, v, 2, 3, 83);
                    double val = swell * pocket;
                    if (val < 0.0) val = 0.0;
                    else if (val > 1.0) val = 1.0;

                    double tip = val * val * val;
                    double rF = 2.0 + 28.0 * val + 24.0 * tip;
                    double gF = 8.0 + 74.0 * val + 46.0 * tip;
                    double bF = 22.0 + 138.0 * val + 52.0 * tip;

                    int dither = Bayer4x4[((y & 3) << 2) | (x & 3)];
                    int r = QuantizeDithered(rF, dither);
                    int g = QuantizeDithered(gF, dither);
                    int b = QuantizeDithered(bF, dither);
                    px[row + x] = 0xFF000000u | ((uint)r << 16) | ((uint)g << 8) | (uint)b;
                }
            }
            return px;
        }

        /// <summary>
        /// Builds a seamless toroidal translucent water-ripple tile in premultiplied ARGB with finer
        /// horizontal capillary wavelets and silvery-moonlight crest highlights (#7CC0F4 -> #D6EEFF).
        /// </summary>
        public static uint[] BuildRippleTilePixels()
        {
            var px = new uint[RippleTileW * RippleTileH];
            for (int y = 0; y < RippleTileH; y++)
            {
                double v = (double)y / RippleTileH;
                int row = y * RippleTileW;
                for (int x = 0; x < RippleTileW; x++)
                {
                    double u = (double)x / RippleTileW;
                    double nLow = TileNoise(u, v, 2, 4, 137);
                    double nMid = TileNoise(u, v, 4, 8, 163);
                    double nFine = TileNoise(u, v, 6, 12, 191);

                    double phase = v * 7.0 + (nLow - 0.5) * 1.30 + (nMid - 0.5) * 0.44 + (nFine - 0.5) * 0.18;
                    double crest = 0.5 + 0.5 * Math.Sin(phase * Math.PI * 2.0);
                    double wave = Math.Pow(crest, 3.25);

                    // Shimmering horizontal wavelet clusters
                    double cluster = Math.Pow(0.24 + 0.76 * TileNoise(u, v, 3, 4, 223), 1.25);
                    double val = wave * cluster;
                    if (val < 0.0) val = 0.0;
                    else if (val > 1.0) val = 1.0;

                    int dither = Bayer4x4[((y & 3) << 2) | (x & 3)];
                    int a = ((int)(val * 4080.0) + dither) >> 4;
                    if (a > 255) a = 255;

                    double glint = val * val;
                    int rCol = (int)Math.Round(108.0 + 106.0 * glint);
                    int gCol = (int)Math.Round(186.0 + 52.0 * glint);
                    int bCol = (int)Math.Round(240.0 + 15.0 * glint);
                    px[row + x] = PremultiplyArgb(a, rCol, gCol, bCol);
                }
            }
            return px;
        }

        /// <summary>
        /// Builds the organic raised-cosine/Gaussian atmospheric lake mask (MaskTexW x MaskTexH).
        /// Dissolves the perspective water waves through a soft nocturnal horizon mist and moon-reflection
        /// sheen into 100% opaque pure #000000 around the perimeter so no rectangular or oval edge ever exists.
        /// </summary>
        public static uint[] BuildPureBlackPortalMaskPixels()
        {
            var px = new uint[MaskTexW * MaskTexH];
            double halfW = MaskTexW * 0.5;
            double innerHalfW = halfW - 3.5;

            for (int y = 0; y < MaskTexH; y++)
            {
                int row = y * MaskTexW;
                bool borderY = y <= 2 || y >= MaskTexH - 3;
                double vy = (y - 2.5) / (MaskTexH - 6.0);
                if (vy < 0.0) vy = 0.0;
                else if (vy > 1.0) vy = 1.0;

                double ny = (vy - 0.52) / 0.48;
                // Wide panoramic water expanse, gently narrower near the distant upper horizon
                double horizSpan = 0.84 + 0.15 * Math.Sin(Math.Min(1.0, vy * 1.10) * Math.PI);

                for (int x = 0; x < MaskTexW; x++)
                {
                    if (borderY || x <= 2 || x >= MaskTexW - 3)
                    {
                        px[row + x] = 0xFF000000u;
                        continue;
                    }

                    double nx = (x + 0.5 - halfW) / innerHalfW;
                    // Subtle organic shoreline contour modulation prevents a geometric oval silhouette
                    double contour = 0.045 * Math.Sin(nx * Math.PI * 1.4 + 0.35)
                                   + 0.025 * Math.Cos(nx * Math.PI * 2.6 - 0.55);
                    double nyMod = ny - contour * Math.Max(0.0, 1.0 - ny * ny);
                    double nxMod = nx / horizSpan;

                    double r2 = nxMod * nxMod + nyMod * nyMod;
                    if (r2 >= 1.0)
                    {
                        px[row + x] = 0xFF000000u;
                        continue;
                    }

                    double r = Math.Sqrt(r2);
                    // Wide raised-cosine bell (C2-smooth at center and r=1 perimeter, zero hard rim)
                    double cosBell = 0.5 * (1.0 + Math.Cos(r * Math.PI));
                    double waveBell = Math.Pow(cosBell, 1.25);

                    // Perspective moonlit reflection fan + wide nocturnal water aperture filling (envW, envH)
                    // Fold smooth vertical perspective into mask opacity so Swell/Ripple use uniform frame tint/alpha (zero wrap seams).
                    double fanW = 0.42 + 0.42 * vy;
                    double moonFan = Math.Exp(-(nx * nx) / (fanW * fanW));
                    double persp = 0.76 + 0.24 * vy;
                    double open = waveBell * persp * (0.68 + 0.28 * moonFan);
                    if (open < 0.0) open = 0.0;
                    else if (open > 0.96) open = 0.96;

                    double maskAlphaF = (1.0 - open) * 255.0;

                    // Soft nocturnal horizon mist & silver-blue moon glow baked into the mask's premultiplied RGB
                    double mistBell = Math.Pow(cosBell, 1.65);
                    double dhx = nx / 0.36;
                    double dhy = (vy - 0.24) / 0.17;
                    double horizonMoon = Math.Exp(-(dhx * dhx + dhy * dhy));

                    double dwy = (vy - 0.48) / 0.36;
                    double waterMoon = Math.Exp(-(nx * nx) / (0.28 * 0.28) - dwy * dwy) * 0.65;

                    double atm = mistBell * (1.0 - open * 0.68);
                    double rGlowF = (2.5 + 14.0 * horizonMoon + 8.0 * waterMoon) * atm;
                    double gGlowF = (8.5 + 32.0 * horizonMoon + 21.0 * waterMoon) * atm;
                    double bGlowF = (21.0 + 60.0 * horizonMoon + 42.0 * waterMoon) * atm;

                    int dither = Bayer4x4[((y & 3) << 2) | (x & 3)];
                    int a = QuantizeDithered(maskAlphaF, dither);
                    int rCol = QuantizeDithered(rGlowF, dither);
                    int gCol = QuantizeDithered(gGlowF, dither);
                    int bCol = QuantizeDithered(bGlowF, dither);
                    if (rCol > a) rCol = a;
                    if (gCol > a) gCol = a;
                    if (bCol > a) bCol = a;
                    px[row + x] = ((uint)a << 24) | ((uint)rCol << 16) | ((uint)gCol << 8) | (uint)bCol;
                }
            }
            return px;
        }

        /// <summary>
        /// Computes 50 Hz wandering Lissajous portal coordinates across the entire screen, perspective
        /// top-vs-bottom vertex shading, and sub-pixel phase-compensated wave UVs.
        /// </summary>
        public static void ComputeFrame(double timeMs, int screenW, int screenH, bool dimmed, out LakeRenderFrame frame)
        {
            ComputeFrame(timeMs, screenW, screenH, dimmed, DefaultScalePreset, out frame);
        }

        public static void ComputeFrame(double timeMs, int screenW, int screenH, bool dimmed, int scalePreset, out LakeRenderFrame frame)
        {
            frame = default(LakeRenderFrame);
            int portalW, portalH;
            ComputeUnifiedEnvelopeSize(screenW, screenH, scalePreset, out portalW, out portalH);
            frame.PortalW = portalW;
            frame.PortalH = portalH;

            double sec = timeMs * 0.001;
            double dimScale = dimmed ? (98.0 / 256.0) : 1.0;
            frame.MaskTint = dimmed ? 98 : 255;

            double scaleX = screenW / 1920.0;
            double scaleY = screenH / 1080.0;

            // Non-repeating 2D Lissajous orbit sweeping the panoramic lake vista across the entire screen
            double marginX = screenW * SweepMarginXPct;
            double marginY = screenH * SweepMarginYPct;
            double ampX = Math.Max(1.0, (screenW - portalW) * 0.5 - marginX);
            double ampY = Math.Max(1.0, (screenH - portalH) * 0.5 - marginY);

            double fx = (screenW - portalW) * 0.5
                      + ampX * (0.74 * Math.Sin(PhaseRad(sec, 113.0, 0)) + 0.26 * Math.Cos(PhaseRad(sec, 197.0, 18200)));
            double fy = (screenH - portalH) * 0.5
                      + ampY * (0.72 * Math.Sin(PhaseRad(sec, 157.0, 11400)) + 0.28 * Math.Cos(PhaseRad(sec, 241.0, 39100)));

            int ix = (int)Math.Floor(fx);
            int iy = (int)Math.Floor(fy);
            double fracX = fx - ix;
            double fracY = fy - iy;
            frame.PortalFx = fx;
            frame.PortalFy = fy;
            frame.PortalX = ix;
            frame.PortalY = iy;

            // Swell layer: shoreward wave flow (+V) + lateral breeze sway + pure portal-relative float quad
            double swellTilePxW = portalW / SwellTilesAcrossX;
            double swellTilePxH = portalH / SwellTilesDownY;
            double swellLocalOx = 38.0 * scaleX * Math.Sin(PhaseRad(sec, 79.0, 0))
                                + 20.0 * scaleX * Math.Cos(PhaseRad(sec, 131.0, 14800));
            double swellLocalOy = sec * (15.5 * scaleY)
                                + 11.0 * scaleY * Math.Sin(PhaseRad(sec, 61.0, 8100));
            double swellPhaseX = ((swellLocalOx % swellTilePxW) + swellTilePxW) % swellTilePxW;
            double swellPhaseY = ((swellLocalOy % swellTilePxH) + swellTilePxH) % swellTilePxH;
            frame.SwellQuadFx = fx - swellTilePxW + swellPhaseX;
            frame.SwellQuadFy = fy - swellTilePxH + swellPhaseY;
            frame.SwellQuadFw = swellTilePxW * SwellRepeatX;
            frame.SwellQuadFh = swellTilePxH * SwellRepeatY;

            double swellOx = swellLocalOx + fracX;
            double swellOy = swellLocalOy + fracY;
            ComputePeriodicUv(swellOx, swellOy, swellTilePxW, swellTilePxH,
                SwellTilesAcrossX, SwellTilesDownY, SwellTileW, SwellTileH,
                out frame.SwellU0, out frame.SwellV0, out frame.SwellU1, out frame.SwellV1);

            // Perspective shading: broad swells are subtler near the distant upper horizon and fuller in the foreground
            double swellBreath = 0.90 + 0.10 * Math.Sin(PhaseRad(sec, 53.0, 11200));
            frame.SwellTopTint = ClampAlpha(142.0 * swellBreath * dimScale);
            frame.SwellBotTint = ClampAlpha(248.0 * swellBreath * dimScale);
            frame.SwellTint = ClampAlpha(214.0 * swellBreath * dimScale);

            // Ripple layer: finer moonlit wavelets at incommensurate speed & counter-sway + pure portal-relative float quad
            double rippleTilePxW = portalW / RippleTilesAcrossX;
            double rippleTilePxH = portalH / RippleTilesDownY;
            double rippleLocalOx = -32.0 * scaleX * Math.Sin(PhaseRad(sec, 97.0, 19300))
                                 + 17.0 * scaleX * Math.Cos(PhaseRad(sec, 149.0, 5400));
            double rippleLocalOy = sec * (10.2 * scaleY)
                                 + 8.5 * scaleY * Math.Cos(PhaseRad(sec, 73.0, 27500));
            double ripplePhaseX = ((rippleLocalOx % rippleTilePxW) + rippleTilePxW) % rippleTilePxW;
            double ripplePhaseY = ((rippleLocalOy % rippleTilePxH) + rippleTilePxH) % rippleTilePxH;
            frame.RippleQuadFx = fx - rippleTilePxW + ripplePhaseX;
            frame.RippleQuadFy = fy - rippleTilePxH + ripplePhaseY;
            frame.RippleQuadFw = rippleTilePxW * RippleRepeatX;
            frame.RippleQuadFh = rippleTilePxH * RippleRepeatY;

            double rippleOx = rippleLocalOx + fracX;
            double rippleOy = rippleLocalOy + fracY;
            ComputePeriodicUv(rippleOx, rippleOy, rippleTilePxW, rippleTilePxH,
                RippleTilesAcrossX, RippleTilesDownY, RippleTileW, RippleTileH,
                out frame.RippleU0, out frame.RippleV0, out frame.RippleU1, out frame.RippleV1);

            // Perspective shading: fine silvery ripples shimmer strongly near the upper moonlit horizon and soften below
            double rippleBreath = 1.0 + 0.14 * Math.Sin(PhaseRad(sec, 43.0, 31000)) + 0.06 * Math.Cos(PhaseRad(sec, 89.0, 7700));
            frame.RippleTopAlpha = ClampAlpha(98.0 * rippleBreath * dimScale);
            frame.RippleBotAlpha = ClampAlpha(46.0 * rippleBreath * dimScale);
            frame.RippleAlpha = ClampAlpha(76.0 * rippleBreath * dimScale);
        }

        public static void ComputePeriodicUv(
            double offsetPx, double offsetPy,
            double tilePxW, double tilePxH,
            double tilesAcrossX, double tilesDownY,
            int texTileW, int texTileH,
            out double u0, out double v0, out double u1, out double v1)
        {
            double phaseX = ((offsetPx % tilePxW) + tilePxW) % tilePxW;
            double phaseY = ((offsetPy % tilePxH) + tilePxH) % tilePxH;
            u0 = 1.0 + (1.0 - phaseX / tilePxW) * texTileW;
            v0 = 1.0 + (1.0 - phaseY / tilePxH) * texTileH;
            u1 = u0 + tilesAcrossX * texTileW;
            v1 = v0 + tilesDownY * texTileH;
        }

        // --- Phase 2: Cohesive Low-Dirty-Rect Aurora Silk Constellation (50 Hz, 100% burn-in-safe) ---

        public const int AuroraRibbonCount = 3;
        public const int AuroraActiveMoteCount = 6;

        // Ribbon footprints, local sway, and Y-offsets expressed as percentages of the unified envelope (envW, envH)
        // so all 3 ribbons + sway stay strictly inside [-envW/2, +envW/2] x [-envH/2, +envH/2] around groupCenter.
        private static readonly double[] AuroraEnvWPct = { 84.0, 78.0, 81.0 };
        private static readonly double[] AuroraEnvHPct = { 66.0, 60.0, 63.0 };
        private static readonly double[] AuroraLocalSwayXPct = { 7.5, 9.0, 7.0 };
        private static readonly double[] AuroraLocalSwayYPct = { 12.0, 12.5, 10.0 };
        private static readonly double[] AuroraLocalOffYPct = { -4.0, 4.0, 0.0 };
        private static readonly int[] AuroraPerX = { 43, 59, 71 };
        private static readonly int[] AuroraPerY = { 53, 67, 83 };
        private static readonly int[] AuroraPhaseX = { 0, 21902, 43461 };
        private static readonly int[] AuroraPhaseY = { 8344, 38720, 17645 };
        private static readonly int[] AuroraBreathPer = { 47, 61, 79 };
        private static readonly int[] AuroraBreathOff = { 0, 16602, 34246 };
        private static readonly int[] AuroraBaseAlpha = { 86, 72, 66 };

        // 6 bokeh motes clustered inside the wandering aurora curtain (0=Ice crisp, 1=Sapphire orb, 2=Gold orb, 3=Aqua crisp)
        private static readonly int[] AuroraMoteKind = { 0, 1, 3, 2, 0, 1 };
        private static readonly int[] AuroraMoteBaseX = { -290, -120, 45, 195, -210, 275 };
        private static readonly int[] AuroraMoteBaseY = { 48, -32, 62, -18, -54, 42 };
        private static readonly int[] AuroraMoteVx = { 12, -9, 10, -8, 11, -11 };
        private static readonly int[] AuroraMoteVy = { -16, -13, -15, -12, -17, -14 };
        private static readonly int[] AuroraMoteSize360 = { 12, 18, 10, 22, 9, 16 };
        private static readonly int[] AuroraMotePeriodSec = { 29, 37, 43, 53, 31, 41 };
        private static readonly int[] AuroraMotePhaseSec = { 0, 11, 23, 7, 17, 29 };
        private static readonly int[] AuroraMoteMaxAlpha = { 132, 112, 136, 104, 128, 116 };
        private static readonly int[] AuroraMoteColR = { 228, 110, 255, 120 };
        private static readonly int[] AuroraMoteColG = { 242, 178, 224, 240 };
        private static readonly int[] AuroraMoteColB = { 255, 255, 176, 225 };

        public static bool IsAuroraMoteCrisp(int index)
        {
            int k = AuroraMoteKind[index % AuroraActiveMoteCount];
            return k == 0 || k == 3;
        }

        /// <summary>
        /// Builds a tightly fitted S-curve silk aurora ribbon (w x h) with high internal fill efficiency,
        /// caustic ridge, 4x4 Bayer dithering, and 0 alpha on all 4 borders.
        /// </summary>
        public static uint[] BuildAuroraSilkRibbonPixels(int w, int h, int rCol, int gCol, int bCol, double freq, double amp, double phase, double skew)
        {
            var px = new uint[w * h];
            for (int x = 0; x < w; x++)
            {
                double u = w > 1 ? (double)x / (w - 1) : 0.5;
                double taper = Math.Pow(Math.Max(0.0, Math.Sin(Math.PI * u)), 1.35);
                double ridgeY = 0.45 + amp * Math.Sin(u * Math.PI * freq + phase) + skew * (u - 0.5);
                double widthUp = 0.125 + 0.035 * Math.Cos(u * Math.PI * 2.0 + phase);
                double widthDown = 0.31 + 0.065 * Math.Sin(u * Math.PI * 1.5 - phase);
                for (int y = 0; y < h; y++)
                {
                    double v = h > 1 ? (double)y / (h - 1) : 0.5;
                    double dy = v - ridgeY;
                    double core;
                    if (dy < 0.0)
                    {
                        double k = -dy / widthUp;
                        core = Math.Exp(-k * k * 2.2);
                    }
                    else
                    {
                        double k = dy / widthDown;
                        core = 0.74 * Math.Exp(-k * k * 1.45) + 0.26 * Math.Exp(-k * 2.5);
                    }
                    double ca = dy / 0.038;
                    double caustic = Math.Exp(-ca * ca) * (0.48 + 0.52 * Math.Sin(u * Math.PI * 4.5 + phase));
                    double vFade = Math.Max(0.0, Math.Sin(Math.PI * v));
                    double alpha = taper * vFade * (core * 0.80 + caustic * 0.30);
                    if (alpha < 0.0) alpha = 0.0;
                    else if (alpha > 1.0) alpha = 1.0;

                    int dither = Bayer4x4[((y & 3) << 2) | (x & 3)];
                    int a = ((int)(alpha * 4080.0) + dither) >> 4;
                    if (x == 0 || x == w - 1 || y == 0 || y == h - 1) a = 0;
                    px[y * w + x] = PremultiplyArgb(a, rCol, gCol, bCol);
                }
            }
            return px;
        }

        private static void ComputeAuroraGroupCenter(double sec, int screenW, int screenH, int envW, int envH, out double groupCx, out double groupCy)
        {
            double marginX = screenW * SweepMarginXPct;
            double marginY = screenH * SweepMarginYPct;
            double ampX = Math.Max(1.0, (screenW - envW) * 0.5 - marginX);
            double ampY = Math.Max(1.0, (screenH - envH) * 0.5 - marginY);
            groupCx = screenW * 0.5
                    + ampX * (0.72 * Math.Sin(PhaseRad(sec, 127.0, 4100)) + 0.28 * Math.Cos(PhaseRad(sec, 211.0, 29300)));
            groupCy = screenH * 0.5
                    + ampY * (0.74 * Math.Sin(PhaseRad(sec, 163.0, 15800)) + 0.26 * Math.Cos(PhaseRad(sec, 257.0, 44200)));
        }

        public static void ComputeAuroraRibbonMotion(int index, double timeMs, int screenW, int screenH, bool dimmed, out IdleBackdropModel.AuroraRibbonMotion frame)
        {
            ComputeAuroraRibbonMotion(index, timeMs, screenW, screenH, dimmed, DefaultScalePreset, out frame);
        }

        public static void ComputeAuroraRibbonMotion(int index, double timeMs, int screenW, int screenH, bool dimmed, int scalePreset, out IdleBackdropModel.AuroraRibbonMotion frame)
        {
            frame = default(IdleBackdropModel.AuroraRibbonMotion);
            if (index < 0 || index >= AuroraRibbonCount) return;

            int envW, envH;
            ComputeUnifiedEnvelopeSize(screenW, screenH, scalePreset, out envW, out envH);

            double sec = timeMs * 0.001;
            double groupCx, groupCy;
            ComputeAuroraGroupCenter(sec, screenW, screenH, envW, envH, out groupCx, out groupCy);

            double rw = envW * (AuroraEnvWPct[index] / 100.0);
            double rh = envH * (AuroraEnvHPct[index] / 100.0);
            double swayX = envW * (AuroraLocalSwayXPct[index] / 100.0);
            double swayY = envH * (AuroraLocalSwayYPct[index] / 100.0);
            double offY = envH * (AuroraLocalOffYPct[index] / 100.0);

            double cx = groupCx + swayX * Math.Sin(PhaseRad(sec, AuroraPerX[index], AuroraPhaseX[index]));
            double cy = groupCy + offY + swayY * Math.Sin(PhaseRad(sec, AuroraPerY[index], AuroraPhaseY[index]));

            double breath = 1.0 + 0.18 * Math.Sin(PhaseRad(sec, AuroraBreathPer[index], AuroraBreathOff[index]));
            double dimScale = dimmed ? (98.0 / 256.0) : 1.0;
            int alpha = ClampAlpha(AuroraBaseAlpha[index] * breath * dimScale);

            frame.X = cx - rw * 0.5;
            frame.Y = cy - rh * 0.5;
            frame.W = rw;
            frame.H = rh;
            frame.Alpha = alpha;
        }

        public static void ComputeAuroraMoteMotion(int index, double timeMs, int screenW, int screenH, bool dimmed, out IdleBackdropModel.MoteMotion frame)
        {
            ComputeAuroraMoteMotion(index, timeMs, screenW, screenH, dimmed, DefaultScalePreset, out frame);
        }

        public static void ComputeAuroraMoteMotion(int index, double timeMs, int screenW, int screenH, bool dimmed, int scalePreset, out IdleBackdropModel.MoteMotion frame)
        {
            frame = default(IdleBackdropModel.MoteMotion);
            if (index < 0 || index >= AuroraActiveMoteCount) return;

            double sec = timeMs * 0.001;
            double periodSec = AuroraMotePeriodSec[index];
            double totalSec = sec + AuroraMotePhaseSec[index];
            double cycleD = Math.Floor(totalSec / periodSec);
            int cycle = (int)cycleD;
            double ageSec = totalSec - cycleD * periodSec;

            double fade = 0.5 * (1.0 - Math.Cos((Math.PI * 2.0 * ageSec) / periodSec));
            double dimScale = dimmed ? (98.0 / 256.0) : 1.0;
            int alpha = ClampAlpha(AuroraMoteMaxAlpha[index] * fade * dimScale);

            double sz = (AuroraMoteSize360[index] * (double)screenH) / 360.0;
            if (sz < 4.0) sz = 4.0;
            if (alpha <= 2)
            {
                frame.Alpha = 0;
                frame.Size = sz;
                return;
            }

            int envW, envH;
            ComputeUnifiedEnvelopeSize(screenW, screenH, scalePreset, out envW, out envH);

            double groupCx, groupCy;
            ComputeAuroraGroupCenter(sec, screenW, screenH, envW, envH, out groupCx, out groupCy);

            // Deterministic cycle jitter scaled proportionally to (envW, envH) and clamped strictly inside envelope
            int jx = ((cycle * 67 + index * 41) & 127) - 64;
            int jy = ((cycle * 43 + index * 29) & 63) - 32;
            double progress = ageSec - periodSec * 0.5;

            double moteScaleX = envW / 1060.0;
            double moteScaleY = envH / 410.0;
            double localX = (AuroraMoteBaseX[index] + jx + AuroraMoteVx[index] * progress * 0.35) * moteScaleX;
            double localY = (AuroraMoteBaseY[index] + jy + AuroraMoteVy[index] * progress * 0.25) * moteScaleY;

            double maxLocalX = Math.Max(0.0, (envW - sz) * 0.5);
            double maxLocalY = Math.Max(0.0, (envH - sz) * 0.5);
            if (localX < -maxLocalX) localX = -maxLocalX;
            else if (localX > maxLocalX) localX = maxLocalX;
            if (localY < -maxLocalY) localY = -maxLocalY;
            else if (localY > maxLocalY) localY = maxLocalY;

            int kind = AuroraMoteKind[index];
            frame.X = groupCx + localX - sz * 0.5;
            frame.Y = groupCy + localY - sz * 0.5;
            frame.Size = sz;
            frame.R = AuroraMoteColR[kind];
            frame.G = AuroraMoteColG[kind];
            frame.B = AuroraMoteColB[kind];
            frame.Alpha = alpha;
        }

        private static double PhaseRad(double sec, double periodSec, int offsetQ16)
        {
            double rem = sec % periodSec;
            if (rem < 0.0) rem += periodSec;
            return Math.PI * 2.0 * (rem / periodSec + offsetQ16 / 65536.0);
        }

        private static double Hash2(int ix, int iy, int seed)
        {
            unchecked
            {
                uint n = (uint)(ix * 374761393 + iy * 668265263 + seed * 1442695041);
                n ^= n >> 13;
                n *= 1274126177u;
                n ^= n >> 16;
                return n / 4294967296.0;
            }
        }

        private static double TileNoise(double u, double v, int freqX, int freqY, int seed)
        {
            double x = u * freqX;
            double y = v * freqY;
            int fx = (int)Math.Floor(x);
            int fy = (int)Math.Floor(y);
            int x0 = ((fx % freqX) + freqX) % freqX;
            int y0 = ((fy % freqY) + freqY) % freqY;
            int x1 = (x0 + 1) % freqX;
            int y1 = (y0 + 1) % freqY;
            double tx = x - fx;
            double ty = y - fy;
            double sx = tx * tx * tx * (tx * (tx * 6.0 - 15.0) + 10.0);
            double sy = ty * ty * ty * (ty * (ty * 6.0 - 15.0) + 10.0);
            double n00 = Hash2(x0, y0, seed);
            double n10 = Hash2(x1, y0, seed);
            double n01 = Hash2(x0, y1, seed);
            double n11 = Hash2(x1, y1, seed);
            double nx0 = n00 + sx * (n10 - n00);
            double nx1 = n01 + sx * (n11 - n01);
            return nx0 + sy * (nx1 - nx0);
        }

        private static int QuantizeDithered(double val0to255, int bayer0to15)
        {
            if (val0to255 <= 0.0) return 0;
            int q = ((int)(val0to255 * 16.0) + bayer0to15) >> 4;
            return q < 0 ? 0 : (q > 255 ? 255 : q);
        }

        private static int ClampAlpha(double val)
        {
            int a = (int)Math.Round(val);
            return a < 0 ? 0 : (a > 255 ? 255 : a);
        }

        private static uint PremultiplyArgb(int a, int rCol, int gCol, int bCol)
        {
            if (a <= 0) return 0u;
            if (a > 255) a = 255;
            int r = (rCol * a + 127) / 255;
            int g = (gCol * a + 127) / 255;
            int b = (bCol * a + 127) / 255;
            if (r > a) r = a;
            if (g > a) g = a;
            if (b > a) b = a;
            return ((uint)a << 24) | ((uint)r << 16) | ((uint)g << 8) | (uint)b;
        }
    }
}
