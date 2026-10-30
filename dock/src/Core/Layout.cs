using System;

namespace Launcher.Core
{
    internal struct Box
    {
        public int X, Y, W, H;
        public bool Equals(Box o) { return X == o.X && Y == o.Y && W == o.W && H == o.H; }
    }

    /// <summary>
    /// Geometry of the dock. Pure arithmetic, no EFL: the window is only as large as the
    /// glass pill plus a shadow margin, centred at the bottom of the screen, so the
    /// compositor blends a few hundred thousand pixels instead of a full 1080p plane.
    ///
    /// Coordinates are window-relative unless noted. "Content space" is the unscrolled
    /// strip of icons, with item i centred at <c>Icon/2 + i*Pitch</c>.
    /// </summary>
    internal sealed class DockLayout
    {
        public const int Icon = 92;
        public const int FocusIcon = 112;
        public const int Gap = 18;
        public const int PadX = 26;
        public const int PadTop = 16;
        /// <summary>Room under the icons; the marker of the input in use sits in its middle, clear of the focus ring.</summary>
        public const int PadBottom = 24;
        /// <summary>Height of the clock row under the icons; none when the design shows no clock.</summary>
        public static readonly int ClockRow = Design.ShowClock ? ClockGap + ClockH : 0;
        public const int ClockGap = 10;
        public const int ClockH = 34;
        public const int Margin = 40;          // room for the bar's shadow on every side (also: pill bottom to screen bottom)
        public const int BottomGap = 0;        // window bottom to screen bottom
        public const int ScreenSideGap = 12;   // pill never closer than this to the screen edge
        public const int MaxPillW = 1808;      // the bar is never wider than this
        public const int HighlightPad = 32;      // reach of the soft glow around the focused icon (spread * 1.95, rounded up)
        public const int SlideDistance = 48;
        // The apps clipper is wider than the app viewport by this much on both sides, so the enlarged focused
        // icon and its ring are never cut at the first and last app. (The glow is not clipped: it always fits in the padding.)
        public const int ClipPad = (FocusIcon - Icon) / 2 + Design.RingW;
        /// <summary>Space between the scrolling apps and the pinned system entries; the divider sits in its middle.</summary>
        public const int GroupGap = 56;
        public const int Pitch = Icon + Gap;
        /// <summary>The pinned system entries are oval pills (icon and name drawn into one image) of this fixed size.</summary>
        public const int PillItemW = 232;
        public const int PillItemH = 48;
        public const int PillItemGap = 8;
        /// <summary>Reach of the capsule glow around a focused pill (same spread as the icons' glow).</summary>
        public const int PillGlowPad = 32;
        // The focused item's name sits in a capsule CaptionH tall, CaptionGap above the bar; that band (HintH) also holds the hints.
        public const int CaptionH = 40;
        public const int CaptionGap = 10;
        public const int CaptionPadX = 18;
        public const int HintH = CaptionGap + CaptionH;
        /// <summary>Smallest space kept between the name and the hint; with less, the hint steps aside.</summary>
        public const int HintClearance = 16;
        /// <summary>The input in use: a short white bar under its tile, in the middle of the bottom padding.</summary>
        public const int CurrentMarkW = 32;
        public const int CurrentMarkH = 6;
        public const int DividerW = 2;
        public const int DividerH = 72;

        public readonly int Count, ScreenW, ScreenH;
        /// <summary>Natural width of the whole strip: the apps, then (when grouped) the gap and the pinned entries.</summary>
        public readonly int ContentW;
        /// <summary>Width of the area the apps scroll in; with pinned entries it excludes them and the gap.</summary>
        public readonly int ViewportW;
        public readonly int PillW, PillH, WinW, WinH, WinX, WinY;
        /// <summary>Number of items that scroll (all of them without a group) and of pinned system entries.</summary>
        public readonly int AppCount, PinnedCount;
        /// <summary>Width of the app strip alone, and of the pinned entries alone.</summary>
        public readonly int AppsW, PinnedW;
        /// <summary>Shift of this page's pill inside a window made for a wider page (0 for the widest).</summary>
        public readonly int OffsetX;
        /// <summary>
        /// True for the panel page: its pill sits <see cref="HintH"/> higher than the apps pill, and the
        /// freed band underneath holds the back hint. The window is the same height for both pages.
        /// </summary>
        public readonly bool Raised;
        /// <summary>Index of the first pinned system entry when the strip ends with a run of them, else -1.</summary>
        public readonly int GroupStart;

        public DockLayout(int count, int screenW, int screenH) : this(count, screenW, screenH, 0) { }

        public DockLayout(int count, int screenW, int screenH, int windowW) : this(count, screenW, screenH, windowW, false, -1) { }

        /// <summary>
        /// <paramref name="windowW"/> is the width of the shared window when it was sized for a
        /// wider page: this page's pill is then centred inside it instead of making its own window.
        /// <paramref name="groupStart"/> marks where the system entries begin (a divider is drawn
        /// before them); anything outside 1..count-1 means no group.
        /// </summary>
        public DockLayout(int count, int screenW, int screenH, int windowW, bool raised, int groupStart)
        {
            if (count < 1) throw new ArgumentOutOfRangeException("count");
            if (screenW < 640 || screenH < 360) throw new ArgumentOutOfRangeException("screen");
            Count = count; ScreenW = screenW; ScreenH = screenH;
            GroupStart = groupStart > 0 && groupStart < count ? groupStart : -1;
            AppCount = GroupStart < 0 ? count : GroupStart;
            PinnedCount = count - AppCount;
            AppsW = AppCount * Icon + (AppCount - 1) * Gap;
            PinnedW = PinnedCount == 0 ? 0 : PillItemW;      // the pills are stacked in one column
            int fixedW = PinnedCount == 0 ? 0 : GroupGap + PinnedW;
            ContentW = AppsW + fixedW;
            int maxPill = Math.Min(MaxPillW, screenW - 2 * Margin - 2 * ScreenSideGap);
            PillW = Math.Min(ContentW + 2 * PadX, maxPill);
            ViewportW = PillW - 2 * PadX - fixedW;
            PillH = PadTop + FocusIcon + ClockRow + PadBottom;
            WinW = PillW + 2 * Margin;
            if (windowW > WinW) { OffsetX = (windowW - WinW) / 2; WinW = windowW; }
            WinH = PillH + 2 * Margin + 2 * HintH;
            Raised = raised;
            WinX = (screenW - WinW) / 2;
            WinY = screenH - WinH - BottomGap;
        }

        /// <summary>True when the apps do not fit their viewport; the pinned entries never move.</summary>
        public bool Scrolls { get { return AppsW > ViewportW; } }

        /// <summary>Window-relative x of the pill's left edge.</summary>
        public int Left { get { return Margin + OffsetX; } }

        /// <summary>Content-space centre of an app slot at fractional position <paramref name="pos"/> (before scrolling).</summary>
        public float CenterOf(float pos) { return Icon / 2f + pos * Pitch; }

        /// <summary>
        /// X of item <paramref name="i"/>'s centre relative to the start of the icon area: apps move with
        /// <paramref name="scroll"/>, pinned entries stand still after the apps' viewport and the group gap.
        /// </summary>
        public float ItemCenter(int i, float scroll)
        {
            if (GroupStart >= 0 && i >= GroupStart) return ViewportW + GroupGap + PillItemW / 2f;
            return CenterOf(i) - scroll;
        }

        /// <summary>
        /// Scroll offset that keeps <paramref name="focusPos"/> centred in the apps' viewport, clamped to the
        /// strip. Once the focus is on the pinned entries the apps rest where the last app left them.
        /// </summary>
        public float ScrollFor(float focusPos)
        {
            if (!Scrolls) return 0f;
            float f = focusPos > AppCount - 1 ? AppCount - 1 : focusPos;
            float s = CenterOf(f) - ViewportW / 2f;
            float max = AppsW - ViewportW;
            return s < 0f ? 0f : (s > max ? max : s);
        }

        /// <summary>0..1: how strongly item <paramref name="i"/> is focused while the focus is at <paramref name="focusPos"/>.</summary>
        public static float Amount(float focusPos, int i)
        {
            float a = 1f - Math.Abs(focusPos - i);
            return a < 0f ? 0f : (a > 1f ? 1f : a);
        }

        /// <summary>Window-relative y of the pill's top edge (without the slide), under the name band and, on the apps page, the panel's band.</summary>
        public int Top { get { return Margin + (Raised ? HintH : 2 * HintH); } }

        public int RowCenterY { get { return Top + PadTop + FocusIcon / 2; } }

        public Box IconBox(int i, float focusPos, float scroll, int slide)
        {
            if (IsPinned(i))
            {
                // A pill does not grow; the glow behind it says it is focused.
                Box p;
                p.W = PillItemW; p.H = PillItemH;
                p.X = (int)Math.Round(Left + PadX + ItemCenter(i, scroll)) - PillItemW / 2;
                p.Y = PillTop(i) + slide;
                return p;
            }
            float amount = Amount(focusPos, i);
            // Even sizes only: an odd size would put the centre half a pixel off and the icon would wobble
            // sideways while it grows. FocusIcon - Icon is even (checked by the tests).
            int size = Icon + 2 * (int)Math.Round((FocusIcon - Icon) / 2f * amount);
            int cx = (int)Math.Round(Left + PadX + ItemCenter(i, scroll));
            Box b;
            b.W = size; b.H = size;
            b.X = cx - size / 2;
            b.Y = RowCenterY - size / 2 - (int)Math.Round(Design.Lift * amount) + slide;   // the selected icon rises
            return b;
        }

        /// <summary>
        /// The focus ring: the icon's box grown by the ring width on every side. The ring image is scaled with the
        /// box, so its corner radius stays the same percentage of the icon as the icon's own.
        /// </summary>
        public Box RingBox(int i, float focusPos, float scroll, int slide)
        {
            Box b = IconBox(i, focusPos, scroll, slide);
            b.X -= Design.RingW; b.Y -= Design.RingW; b.W += 2 * Design.RingW; b.H += 2 * Design.RingW;
            return b;
        }

        /// <summary>
        /// The glow does not travel: it is lit on the icon being left and on the icon being reached, and
        /// cross-fades between them. Returns the two items and the weight (0..1) of the second; the first
        /// has 1 minus that. At rest, or at either end of the strip, the second weight is 0.
        /// </summary>
        public void GlowAt(float focusPos, out int first, out int second, out float weightSecond)
        {
            float p = focusPos < 0f ? 0f : (focusPos > Count - 1 ? Count - 1 : focusPos);
            first = (int)p;
            second = first < Count - 1 ? first + 1 : first;
            weightSecond = second == first ? 0f : p - first;
        }

        /// <summary>Window-relative y of the top of pinned item <paramref name="i"/>: the pills are stacked and the stack is centred on the icon row.</summary>
        public int PillTop(int i)
        {
            int stackH = PinnedCount * PillItemH + (PinnedCount - 1) * PillItemGap;
            return RowCenterY - stackH / 2 + (i - GroupStart) * (PillItemH + PillItemGap);
        }

        /// <summary>True for the pinned system entries after the divider (the oval pills).</summary>
        public bool IsPinned(int i) { return GroupStart >= 0 && i >= GroupStart; }

        /// <summary>Box of the glow around item <paramref name="i"/> (its final size; only its opacity changes).</summary>
        public Box GlowBox(int i, float scroll, int slide)
        {
            bool pill = IsPinned(i);
            int pad = pill ? PillGlowPad : HighlightPad;
            int w = (pill ? PillItemW : FocusIcon) + 2 * pad;
            int h = (pill ? PillItemH : FocusIcon) + 2 * pad;
            int cx = (int)Math.Round(Left + PadX + ItemCenter(i, scroll));
            Box b;
            b.W = w; b.H = h;
            b.X = cx - w / 2;
            b.Y = (pill ? PillTop(i) - pad : RowCenterY - h / 2 - Design.Lift) + slide;   // the glow rises with the selected icon
            return b;
        }

        public Box PillBox(int slide)
        {
            Box b; b.X = Left; b.Y = Top + slide; b.W = PillW; b.H = PillH; return b;
        }

        public Box ShadowBox(int slide)
        {
            const int extra = Margin;   // the shadow image holds exactly the window margin around the bar
            Box b; b.X = Left - extra; b.Y = Top - extra + Design.ShadowDy + slide; b.W = PillW + 2 * extra; b.H = PillH + 2 * extra; return b;
        }

        /// <summary>Window-relative x of the centre of item <paramref name="item"/> (its name and marker are centred on it).</summary>
        public int ItemCenterX(int item, float scroll)
        {
            return (int)Math.Round(Left + PadX + ItemCenter(item, scroll));
        }

        /// <summary>Window-relative left edge of the name capsule: centred over its item, kept within the pill's inner edges.</summary>
        public int CaptionLeft(int item, float scroll, int captionW)
        {
            int x = ItemCenterX(item, scroll) - captionW / 2;
            int min = Left + PadX, max = Left + PillW - PadX - captionW;
            if (max < min) return Left + (PillW - captionW) / 2;   // capsule wider than the pill interior: centre it
            return x < min ? min : (x > max ? max : x);
        }

        /// <summary>Window-relative y of the name capsule: CaptionGap above the pill.</summary>
        public int CaptionTop(int slide) { return Top - CaptionGap - CaptionH + slide; }

        /// <summary>Window-relative y of the hint: in the name's band above the apps pill, below the raised panel.</summary>
        public int HintTop(int slide)
        {
            return Raised ? Top + PillH + CaptionGap + slide : CaptionTop(slide);
        }

        /// <summary>Window-relative x of a hint: at the pill's inner right edge on the apps page, centred under the raised panel.</summary>
        public int HintLeft(int hintW)
        {
            return Raised ? Left + (PillW - hintW) / 2 : Left + PillW - PadX - hintW;
        }

        /// <summary>The name never moves for the hint: the hint is drawn only while the name ends <see cref="HintClearance"/> px before it.</summary>
        public static bool HintClear(int captionX, int captionW, int hintX)
        {
            return captionX + captionW + HintClearance <= hintX;
        }

        /// <summary>The marker of the input in use: centred under its item, in the middle of the bottom padding.</summary>
        public Box CurrentMarkBox(int item, float scroll, int slide)
        {
            Box b;
            b.W = CurrentMarkW; b.H = CurrentMarkH;
            b.X = ItemCenterX(item, scroll) - CurrentMarkW / 2;
            b.Y = Top + PillH - PadBottom / 2 - CurrentMarkH / 2 + slide;
            return b;
        }

        /// <summary>The hairline between the apps and the pinned system entries, centred in the group gap. It never scrolls.</summary>
        public Box DividerBox(float scroll, int slide)
        {
            Box b;
            b.W = DividerW; b.H = DividerH;
            b.X = Left + PadX + ViewportW + (GroupGap - DividerW) / 2;
            b.Y = RowCenterY - DividerH / 2 + slide;
            return b;
        }

        /// <summary>Window-relative y of the clock row, under the icons.</summary>
        public int ClockTop(int slide) { return Top + PadTop + FocusIcon + ClockGap + slide; }

        /// <summary>Window-relative right edge of the clock, on its row.</summary>
        public int ClockRight { get { return Left + PillW - PadX; } }

        /// <summary>Window-relative x range in which scrolled items are visible.</summary>
        public int ViewLeft { get { return Left + PadX; } }
        public int ViewRight { get { return Left + PadX + ViewportW; } }
    }
}
