using System;

namespace Launcher.Core
{
    internal enum TaskAction { None, Moved, Open, Close, SortChanged, Back, Hide }

    /// <summary>
    /// Geometry of the task manager page: a glass panel with a header, a list of rows and a key hint,
    /// standing on the same bottom line as the dock's bar and centred in the same window width. The panel is
    /// as tall as its rows (up to <see cref="MaxRows"/>); the window is sized once for the tallest panel, so
    /// closing an app never resizes the window.
    /// </summary>
    internal sealed class TaskLayout
    {
        public const int PanelW = 880;
        public const int PadX = 24;
        public const int PadTop = 18;
        public const int HeaderH = 70;
        public const int RowH = 76;
        public const int MaxRows = 7;
        public const int MinRows = 2;          // the empty state still reads as a panel
        public const int FooterH = 54;
        public const int PadBottom = 10;
        public const int IconSize = 52;
        public const int CpuColW = 110;        // right edge of the CPU column sits this far left of the memory column's
        public const int Margin = DockLayout.Margin;

        public readonly int WinW, WinH, WinX, WinY, ScreenW, ScreenH;
        /// <summary>Empty space under the panel's shadow margin: the dock's hint band below the bar, so both end on one line.</summary>
        public readonly int BottomBand;

        public TaskLayout(int screenW, int screenH, int sharedWinW) : this(screenW, screenH, sharedWinW, 0) { }

        public TaskLayout(int screenW, int screenH, int sharedWinW, int bottomBand)
        {
            ScreenW = screenW; ScreenH = screenH;
            BottomBand = bottomBand < 0 ? 0 : bottomBand;
            WinW = Math.Max(sharedWinW, PanelW + 2 * Margin);
            WinH = PanelH(MaxRows) + 2 * Margin + BottomBand;
            WinX = (screenW - WinW) / 2;
            WinY = screenH - WinH - DockLayout.BottomGap;
        }

        public static int VisibleRows(int count) { return count < MinRows ? MinRows : (count > MaxRows ? MaxRows : count); }

        public static int PanelH(int rows) { return PadTop + HeaderH + rows * RowH + FooterH + PadBottom; }

        public int PanelX { get { return (WinW - PanelW) / 2; } }

        /// <summary>The panel's bottom stays on the line where the dock's bar ends (window bottom minus the margin and the hint band).</summary>
        public Box Panel(int count, int slide)
        {
            int h = PanelH(VisibleRows(count));
            Box b; b.X = PanelX; b.W = PanelW; b.H = h; b.Y = WinH - Margin - BottomBand - h + slide;
            return b;
        }

        public Box Shadow(int count, int slide)
        {
            Box p = Panel(count, slide);
            Box b; b.X = p.X - Margin; b.Y = p.Y - Margin + Design.ShadowDy; b.W = p.W + 2 * Margin; b.H = p.H + 2 * Margin;
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
            Box b; b.X = PanelX; b.W = PanelW; b.Y = ListTop(count, slide); b.H = VisibleRows(count) * RowH;
            return b;
        }

        /// <summary>The selection plate behind a row: a little inset, so neighbouring plates never touch.</summary>
        public Box Plate(float pos, float scroll, int count, int slide)
        {
            Box b;
            b.X = PanelX + PadX - 8; b.W = PanelW - 2 * PadX + 16;
            b.Y = ListTop(count, slide) + (int)Math.Round((pos - scroll) * RowH) + 4;
            b.H = RowH - 8;
            return b;
        }

        public int IconX { get { return PanelX + PadX + 10; } }
        public int NameX { get { return IconX + IconSize + 22; } }
        public int MemRight { get { return PanelX + PanelW - PadX - 14; } }
        public int CpuRight { get { return MemRight - 150; } }
        public int ContentLeft { get { return PanelX + PadX + 10; } }
        public int ContentRight { get { return MemRight; } }
        public int FooterTop(int count, int slide) { return ListTop(count, slide) + VisibleRows(count) * RowH + 14; }

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

    /// <summary>State of the task manager page: visibility, selection, scroll and sort. No EFL types.</summary>
    internal sealed class TaskController
    {
        public const double MoveSeconds = 0.14;

        public Phase Phase { get; private set; }
        public float Presence { get; private set; }
        public int Count { get; private set; }
        public int Selected { get; private set; }
        public float SelPos { get; private set; }
        public float Scroll { get; private set; }
        public TaskSort Sort { get; private set; }
        private float _from;
        private double _runT;

        public TaskController() { Phase = Phase.Hidden; Sort = TaskSort.Memory; }

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
                    Sort = Tasks.Next(Sort, -1);
                    return TaskAction.SortChanged;
                case "Right":
                    Sort = Tasks.Next(Sort, 1);
                    return TaskAction.SortChanged;
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
