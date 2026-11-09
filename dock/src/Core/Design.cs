namespace Launcher.Core
{
    /// <summary>
    /// The look of the launcher, ported from the designer page's JSON (dock/designer/chosen.json).
    /// This file is the single source for everything visual that is not geometry (geometry lives in
    /// <see cref="DockLayout"/>): the image generators in dock/tools read both files, so a picture can never
    /// disagree with the code that draws it. One rule ties the shapes together: the corner radius of an icon
    /// is <see cref="IconRadiusPct"/> percent of its side, and the focus ring and the glow are built from
    /// that same radius, so they follow the icon's outline at every size.
    /// </summary>
    internal static class Design
    {
        // ---- The bar (designer style "solid": opaque tint, thin light border, soft drop shadow) ----
        public const int ShellRadius = 16;
        public const int ShellColor = 0x243448;
        public const float ShellAlpha = 1.0f;
        public const int ShellBorderW = 2;
        public const int ShellBorderColor = 0xFFFFFF;
        public const float ShellBorderAlpha = 0.22f;
        /// <summary>Nine-slice border of the bar image: more than its corner radius, so the curve is never stretched.</summary>
        public const int ShellSlice = 32;
        public const int ShadowBlur = 50;      // CSS blur radius: a Gaussian of sigma = blur / 2
        public const int ShadowDy = 18;
        public const float ShadowAlpha = 0.45f;

        // ---- Icons ----
        /// <summary>Corner radius as a percentage of the icon side (so 18 px at 112, 15 px at 92).</summary>
        public const int IconRadiusPct = 16;
        /// <summary>Opacity of the thin light line inside every icon's edge; 0 for none.</summary>
        public const float IconRimAlpha = 0.20f;
        /// <summary>Opacity of an icon that is not selected (it rises to 1 with the selection).</summary>
        public const float IconDim = 0.94f;

        // ---- Selection: glow, ring, lift ----
        /// <summary>True: the glow takes the colour of the selected app's icon; false: <see cref="GlowColor"/>.</summary>
        public static readonly bool GlowFromIcon = true;
        public const int GlowColor = 0xE2EDFF;
        public const float GlowStrength = 0.44f;
        public const int GlowSpread = 16;
        public const int RingW = 2;
        /// <summary>The focus mark: an ice-white ring, clearly apart from the sheet and from the icons' own rim.</summary>
        public const int RingColor = 0xE4F2FF;
        /// <summary>The selected icon rises by this many pixels.</summary>
        public const int Lift = 4;

        // ---- Chips and light (the Fumé material: dark smoked sheet, ice focus, blue light only for progress and indicators) ----
        public const int ChipRadius = 12;
        /// <summary>Light blue used only for progress and indicators (the level of the volume pill, a switch that is on).</summary>
        public const int LightColor = 0xA5D8FF;
        /// <summary>Opacity of the volume pill's body: a little of the picture shows through.</summary>
        public const float VolumeAlpha = 0.90f;
        /// <summary>A resting chip, key or programme: white at this opacity over the sheet.</summary>
        public const float FillRest = 0.20f;

        // ---- Text ----
        public static readonly bool ShowLabels = false;
        public static readonly bool ShowClock = false;
        public const string HintText = "Source";

        // ---- The two pills ----
        public const float PillBorderAlpha = 0.75f;
        public const int PillTextSize = 22;
        public const float PillDim = 0.88f;

        // ---- Divider ----
        public const float DividerAlpha = 0.3f;

        // ---- Motion ----
        /// <summary>Fade-in time of the bar; each icon then takes the same time, starting a little after the previous one.</summary>
        public const double EnterSeconds = 0.30;
        public const double StaggerSeconds = 0.024;
        /// <summary>Time the selection takes to reach the next item.</summary>
        public const double FocusSeconds = 0.30;
        /// <summary>True: constant speed, like the designer's "linear"; false: the damped spring.</summary>
        public static readonly bool LinearMotion = true;
    }
}
