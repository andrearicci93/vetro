using System;

namespace Launcher.Core
{
    internal enum TaskAction { None, Moved, Open, Left, Right, Back, Hide }

    /// <summary>
    /// Geometry of one card of the Control center (the Task manager, the Audio output...): a glass panel with a header, a list of rows and a key
    /// hint, standing on the same bottom line as the dock's bar. Up to <see cref="MaxCards"/> cards stand side by side, centred in one window;
    /// a single card is <see cref="WideW"/> wide (the Task manager as it always was), two or three are <see cref="NarrowW"/> each. A card is as
    /// tall as its rows (up to <see cref="MaxRows"/>; a longer list scrolls, with a thin bar on the card's right), or as <see cref="ShowRows"/>
    /// when the host evens the cards out; the window is sized once for the tallest panel, so closing an app never resizes the window.
    /// </summary>
    internal sealed class TaskLayout
    {
        public const int WideW = 880;
        public const int NarrowW = 520;
        public const int CardGap = 32;
        public const int MaxCards = 3;
        public const int PadX = 24;
        public const int PadTop = 18;
        public const int HeaderH = 70;
        public const int RowH = 76;
        /// <summary>
        /// Rows a card shows at most; more scroll. Five, the Picture mode and Sleep timer lists: cards side by side all stand this tall, so
        /// nothing changes size while the Control center is open (a sixth running app used to grow every card by a row).
        /// </summary>
        public const int MaxRows = 5;
        public const int MinRows = 2;          // the empty state still reads as a panel
        public const int FooterH = 54;
        public const int PadBottom = 10;
        public const int IconSize = 52;
        /// <summary>Space between the panel's sides and the selection plate.</summary>
        public const int PlateInset = PadX - 8;
        public static readonly int Margin = DockLayout.Margin;

        public readonly int WinW, WinH, WinX, WinY, ScreenW, ScreenH;
        /// <summary>Empty space under the panel's margin: the dock's hint band below the bar, so both end on one line.</summary>
        public readonly int BottomBand;
        /// <summary>This card's width and its left edge in the window.</summary>
        public readonly int PanelW, PanelX;
        /// <summary>The card is narrow (two or three cards): the Task manager packs its CPU and memory columns closer and the names get less room.</summary>
        public bool Narrow { get { return PanelW < WideW; } }
        /// <summary>At least this many rows of room (0: as many as the card's own list needs). The host sets it so cards side by side are as tall as each other.</summary>
        public int ShowRows;

        public TaskLayout(int screenW, int screenH, int sharedWinW) : this(screenW, screenH, sharedWinW, 0) { }

        public TaskLayout(int screenW, int screenH, int sharedWinW, int bottomBand) : this(screenW, screenH, sharedWinW, bottomBand, 1, 0) { }

        /// <param name="cards">How many cards stand side by side (1 to <see cref="MaxCards"/>).</param>
        /// <param name="index">Which of them this one is, from the left.</param>
        public TaskLayout(int screenW, int screenH, int sharedWinW, int bottomBand, int cards, int index)
        {
            ScreenW = screenW; ScreenH = screenH;
            BottomBand = bottomBand < 0 ? 0 : bottomBand;
            cards = cards < 1 ? 1 : (cards > MaxCards ? MaxCards : cards);
            index = index < 0 ? 0 : (index >= cards ? cards - 1 : index);
            PanelW = cards == 1 ? WideW : NarrowW;
            int total = TotalW(cards);
            WinW = Math.Max(sharedWinW, total + 2 * Margin);
            WinH = PanelH(MaxRows) + 2 * Margin + BottomBand;
            WinX = (screenW - WinW) / 2;
            WinY = screenH - WinH - DockLayout.BottomGap;
            PanelX = (WinW - total) / 2 + index * (PanelW + CardGap);
        }

        /// <summary>Width of <paramref name="cards"/> cards side by side, gaps included.</summary>
        public static int TotalW(int cards) { return cards <= 1 ? WideW : cards * NarrowW + (cards - 1) * CardGap; }

        public static int VisibleRows(int count) { return count < MinRows ? MinRows : (count > MaxRows ? MaxRows : count); }

        /// <summary>Rows of room for a list of <paramref name="count"/>: its own, or <see cref="ShowRows"/> when that is more.</summary>
        public int Rows(int count) { int r = VisibleRows(count); return ShowRows > r ? Math.Min(MaxRows, ShowRows) : r; }

        public static int PanelH(int rows) { return PadTop + HeaderH + rows * RowH + FooterH + PadBottom; }

        /// <summary>The panel's bottom stays on the line where the dock's bar ends (window bottom minus the margin and the hint band).</summary>
        public Box Panel(int count, int slide)
        {
            int h = PanelH(Rows(count));
            Box b; b.X = PanelX; b.W = PanelW; b.H = h; b.Y = WinH - Margin - BottomBand - h + slide;
            return b;
        }

        /// <summary>The light rim: the panel grown by <see cref="Design.ShellBorderW"/> on every side, drawn under it (no drop shadow).</summary>
        public Box Rim(int count, int slide)
        {
            const int w = Design.ShellBorderW;
            Box p = Panel(count, slide);
            Box b; b.X = p.X - w; b.Y = p.Y - w; b.W = p.W + 2 * w; b.H = p.H + 2 * w;
            return b;
        }

        public int HeaderTop(int count, int slide) { return Panel(count, slide).Y + PadTop; }

        public int ListTop(int count, int slide) { return HeaderTop(count, slide) + HeaderH; }

        /// <summary>Top of row <paramref name="index"/> while the list is scrolled by <paramref name="scroll"/> rows.</summary>
        public int RowTop(int index, float scroll, int count, int slide)
        {
            return ListTop(count, slide) + (int)Math.Round((index - scroll) * RowH);
        }

        public Box ListClip(int count, int slide)
        {
            Box b; b.X = PanelX; b.W = PanelW; b.Y = ListTop(count, slide); b.H = Rows(count) * RowH;
            return b;
        }

        /// <summary>
        /// The selection plate behind a row: one ice capsule (pill_cap), inset <see cref="PlateInset"/> from the panel's
        /// sides and 4 px from the row's top and bottom, so neighbouring plates never touch.
        /// </summary>
        public Box Plate(float pos, float scroll, int count, int slide)
        {
            Box b;
            b.X = PanelX + PlateInset; b.W = PanelW - 2 * PlateInset;
            b.Y = ListTop(count, slide) + (int)Math.Round((pos - scroll) * RowH) + 4;
            b.H = RowH - 8;
            return b;
        }

        /// <summary>The scroll bar: a capsule this wide in the gutter between the selection plate and the card's right side, never shorter than ScrollMinThumb.</summary>
        public const int ScrollW = 4, ScrollMinThumb = 28;

        /// <summary>A list longer than the card: it scrolls and shows the bar.</summary>
        public bool Scrolls(int count) { return count > Rows(count); }

        /// <summary>The bar's track: centred in the gutter right of the plates, from the first plate's top to the last one's bottom.</summary>
        public Box ScrollTrack(int count, int slide)
        {
            Box b;
            b.W = ScrollW;
            b.X = PanelX + PanelW - PlateInset / 2 - ScrollW / 2;
            b.Y = ListTop(count, slide) + 4;
            b.H = Rows(count) * RowH - 8;
            return b;
        }

        /// <summary>The bar's thumb: as tall as the share of the list on screen, as far down as the list is scrolled.</summary>
        public Box ScrollThumb(float scroll, int count, int slide)
        {
            Box t = ScrollTrack(count, slide);
            int rows = Rows(count), hidden = Math.Max(0, count - rows);
            int h = count > 0 ? Math.Max(ScrollMinThumb, Math.Min(t.H, t.H * rows / count)) : t.H;
            float f = hidden == 0 ? 0f : Math.Max(0f, Math.Min(1f, scroll / hidden));
            t.Y += (int)Math.Round((t.H - h) * f);
            t.H = h;
            return t;
        }

        public int IconX { get { return PanelX + PadX + 10; } }
        public int NameX { get { return IconX + IconSize + 22; } }
        public int MemRight { get { return PanelX + PanelW - PadX - 10; } }   // the same inset as IconX on the left: the focus capsule holds its content evenly
        /// <summary>The CPU column's right edge. Every card has the column (an app that eats the processor must show whatever other cards are open);
        /// a narrow card packs it closer to the memory figure (up to "1234 MB") than the wide one does.</summary>
        public int CpuRight { get { return MemRight - (Narrow ? 115 : 150); } }
        /// <summary>Where a row's name must end: before the CPU column (up to "800%"). A narrow card leaves the name about 190 px.</summary>
        public int NameRight { get { return CpuRight - (Narrow ? 75 : 120); } }
        public int ContentLeft { get { return PanelX + PadX + 10; } }
        public int ContentRight { get { return MemRight; } }
        public int FooterTop(int count, int slide) { return ListTop(count, slide) + Rows(count) * RowH + 14; }

        /// <summary>Scroll (in rows) that keeps the selection on screen, clamped to the list.</summary>
        public static float ScrollFor(float pos, float scroll, int count)
        {
            int rows = VisibleRows(count);
            float max = Math.Max(0, count - rows);
            if (pos < scroll) scroll = pos;
            if (pos > scroll + rows - 1) scroll = pos - rows + 1;
            return scroll < 0 ? 0 : (scroll > max ? max : scroll);
        }
    }

    /// <summary>State of one Control center card (the Task manager's list, the Audio output's rows): visibility, selection and scroll. No EFL types.</summary>
    internal sealed class TaskController
    {
        public const double MoveSeconds = 0.14;

        public Phase Phase { get; private set; }
        public float Presence { get; private set; }
        public int Count { get; private set; }
        public int Selected { get; private set; }
        public float SelPos { get; private set; }
        public float Scroll { get; private set; }
        /// <summary>The Task manager's order: the biggest app first (the sort keys are gone; Left and Right move between cards).</summary>
        public TaskSort Sort { get { return TaskSort.Memory; } }
        private float _from;
        private double _runT;

        public TaskController() { Phase = Phase.Hidden; }

        public bool IsActive { get { return Phase == Phase.Shown || Phase == Phase.Showing; } }

        public int Slide { get { return Controller.Instant ? 0 : (int)Math.Round((1f - Controller.Ease(Presence)) * DockLayout.SlideDistance); } }

        /// <summary>Opens the page; it starts a little tucked in (<paramref name="pop"/>, 0..1), as the inputs page does.</summary>
        public void Open(float pop)
        {
            Phase = Phase.Showing;
            Presence = pop < 0 ? 0 : (pop > 1 ? 1 : pop);
            Selected = 0; SelPos = 0; Scroll = 0; _from = 0; _runT = 0;
            // Reduce motion (--no-motion): no entrance, the page is there at once.
            if (Controller.Instant) { Phase = Phase.Shown; Presence = 1f; }
        }

        public bool Hide()
        {
            if (Phase == Phase.Hidden || Phase == Phase.Hiding) return false;
            if (Controller.Instant) { Phase = Phase.Hidden; Presence = 0f; return true; }
            Phase = Phase.Hiding;
            return true;
        }

        /// <summary>Gone at once (when the user leaves for the apps row, which takes over the visibility).</summary>
        public void Drop() { Phase = Phase.Hidden; Presence = 0f; }

        /// <summary>The list changed: keep the selection on the same row number, inside the new length.</summary>
        public void SetCount(int count)
        {
            Count = count < 0 ? 0 : count;
            int max = Math.Max(0, Count - 1);
            if (Selected > max) { Selected = max; _from = SelPos; _runT = 0; }
            if (SelPos > max) SelPos = max;
            Scroll = TaskLayout.ScrollFor(SelPos, Scroll, Count);
        }

        public TaskAction Key(string key)
        {
            if (key == null || !IsActive) return TaskAction.None;
            switch (key)
            {
                case "Up":
                    return Selected == 0 ? TaskAction.Back : MoveTo(Selected - 1);
                case "Down":
                    return MoveTo(Selected + 1);
                case "Left":
                    return TaskAction.Left;    // the host moves to the card on the left, if there is one
                case "Right":
                    return TaskAction.Right;
                case "Return":
                case "KP_Enter":
                case "Select":
                    // A tap opens the app; the host turns a held OK into Close (HoldKey).
                    return Count > 0 ? TaskAction.Open : TaskAction.None;
                case "Escape":
                case "XF86Back":
                    return TaskAction.Back;
                case "XF86Home":
                case "XF86Exit":
                    return TaskAction.Hide;
                default:
                    return TaskAction.None;
            }
        }

        /// <summary>After a re-sort the selection goes back to the top, where the biggest app now is.</summary>
        public void SelectFirst() { Selected = 0; SelPos = 0; Scroll = 0; _from = 0; _runT = 0; }

        /// <summary>Puts the selection on row <paramref name="index"/> at once (the same app moved after a refresh).</summary>
        public void Select(int index)
        {
            if (index < 0 || index >= Count || index == Selected) return;
            Selected = index; SelPos = index; _from = index; _runT = 0;
            Scroll = TaskLayout.ScrollFor(SelPos, Scroll, Count);
        }

        private TaskAction MoveTo(int index)
        {
            if (index < 0) index = 0;
            if (index > Count - 1) index = Count - 1;
            if (index < 0 || index == Selected) return TaskAction.None;
            Selected = index;
            _from = SelPos; _runT = 0;
            if (Controller.Instant) { SelPos = index; _from = index; Scroll = TaskLayout.ScrollFor(SelPos, Scroll, Count); }
            return TaskAction.Moved;
        }

        /// <summary>Advance by <paramref name="dt"/> seconds; true while another frame is needed.</summary>
        public bool Tick(double dt)
        {
            if (dt < 0) dt = 0;
            if (dt > 0.1) dt = 0.1;
            switch (Phase)
            {
                case Phase.Showing:
                    Presence += (float)(dt / Controller.ShowSeconds);
                    if (Presence >= 1f) { Presence = 1f; Phase = Phase.Shown; }
                    break;
                case Phase.Hiding:
                    Presence -= (float)(dt / Controller.HideSeconds);
                    if (Presence <= 0f) { Presence = 0f; Phase = Phase.Hidden; }
                    break;
            }
            if (SelPos != Selected)
            {
                _runT += dt;
                float u = (float)(_runT / MoveSeconds);
                SelPos = u >= 1f ? Selected : _from + (Selected - _from) * Controller.Ease(u);
            }
            Scroll = TaskLayout.ScrollFor(SelPos, Scroll, Count);
            return Phase == Phase.Showing || Phase == Phase.Hiding || SelPos != Selected;
        }
    }
}
