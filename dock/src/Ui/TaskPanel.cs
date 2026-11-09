using System;
using System.Collections.Generic;
using System.IO;
using Launcher.Core;
using Launcher.Native;

namespace Launcher.Ui
{
    /// <summary>
    /// The evas objects of the task manager page, in the dock's own materials: the bar's glass and shadow for
    /// the panel, the glass tile and focus ring for the selected row, and a glow in the colour of the selected
    /// app's icon, as the dock does for its icons. One set of objects per running app, made when it appears
    /// and deleted when it is gone.
    /// </summary>
    internal sealed class TaskPanel
    {
        private const string Font = "SamsungOneUI 500,Sans";
        private const string FontBold = "SamsungOneUI 600,Sans";

        private sealed class Row
        {
            public RunningApp App;
            public IntPtr Icon, Initials, Name, Cpu, Mem;
            public int Glow = Design.GlowColor;
            public string CpuText, MemText;
            public bool ShownClosing;
            public int Alpha = -1;
            public int NameW, ValueH, NameH;
        }

        private readonly IntPtr _win, _evas;
        private readonly TaskLayout _layout;
        private readonly string _assets;
        private readonly Action<string> _log;
        private readonly List<Row> _rows = new List<Row>();
        private readonly Dictionary<string, Row> _byId = new Dictionary<string, Row>(StringComparer.Ordinal);

        private IntPtr _clip, _listClip, _shadow, _bg, _divider, _glow, _plate, _ring;
        private IntPtr _title, _sub, _sort, _footer, _empty;
        private int _alpha = -1, _glowAlpha = -1, _glowRgb = -1;
        private string _subText = "", _sortText = "";
        private bool _visible, _loaded;

        public TaskPanel(IntPtr win, TaskLayout layout, string assets, Action<string> log)
        {
            _win = win; _layout = layout; _assets = assets; _log = log;
            _evas = Efl.evas_object_evas_get(win);
        }

        public int Count { get { return _rows.Count; } }

        public RunningApp AppAt(int i) { return i >= 0 && i < _rows.Count ? _rows[i].App : null; }

        public void Build()
        {
            _clip = Efl.evas_object_rectangle_add(_evas);
            Efl.evas_object_color_set(_clip, 255, 255, 255, 255);
            _listClip = Efl.evas_object_rectangle_add(_evas);
            Efl.evas_object_color_set(_listClip, 255, 255, 255, 255);
            Efl.evas_object_clip_set(_listClip, _clip);
            Efl.evas_object_show(_listClip);   // a clipper only lets through what it covers while it is visible itself

            _shadow = Slice("shadow", DockLayout.Margin + Design.ShellRadius, 1.0);
            _bg = Slice("dock_bg", Design.ShellSlice, 1.0);
            _divider = Efl.evas_object_rectangle_add(_evas);
            Efl.evas_object_clip_set(_divider, _clip);
            _glow = Slice("dock_glow_pill", 56, 1.0);
            _plate = Slice("glass_tile", 48, 0.5);
            _ring = Slice("dock_ring", 44, 0.5);

            _title = Text(FontBold, 30);
            Efl.evas_object_text_text_set(_title, "Running apps");
            _sub = Text(Font, 22);
            _sort = Text(Font, 24);
            _footer = Text(Font, 21);
            Efl.evas_object_text_text_set(_footer, "OK  open        Hold OK  close        ‹ ›  sort        Up / Back  return");
            _empty = Text(Font, 26);
            Efl.evas_object_text_text_set(_empty, "Looking for running apps…");
            Efl.evas_object_clip_set(_empty, _listClip);
            SetVisible(false);
        }

        private IntPtr Slice(string name, int border, double scale)
        {
            IntPtr img = Efl.evas_object_image_add(_evas);
            Efl.evas_object_image_file_set(img, Path.Combine(_assets, name + ".png"), null);
            if (Efl.evas_object_image_load_error_get(img) != Efl.EvasLoadErrorNone) _log("tasks: asset missing: " + name);
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

        private IntPtr Text(string font, int size)
        {
            IntPtr t = Efl.evas_object_text_add(_evas);
            Efl.evas_object_text_font_set(t, font, size);
            Efl.evas_object_text_style_set(t, Efl.EvasTextStyleSoftShadow);
            Efl.evas_object_clip_set(t, _clip);
            Efl.evas_object_color_set(t, 0, 0, 0, 0);
            Efl.evas_object_show(t);
            return t;
        }

        public void SetVisible(bool visible)
        {
            _visible = visible;
            if (visible) Efl.evas_object_show(_clip); else Efl.evas_object_hide(_clip);
        }

        /// <summary>New list from the worker, in display order. Rows of apps that are still running are kept.</summary>
        public void SetApps(List<RunningApp> apps, long availableKb)
        {
            var keep = new HashSet<string>(StringComparer.Ordinal);
            foreach (RunningApp a in apps) keep.Add(a.AppId);
            for (int i = _rows.Count - 1; i >= 0; i--)
            {
                if (keep.Contains(_rows[i].App.AppId)) continue;
                DeleteRow(_rows[i]);
                _byId.Remove(_rows[i].App.AppId);
                _rows.RemoveAt(i);
            }
            _rows.Clear();
            foreach (RunningApp a in apps)
            {
                Row r;
                if (_byId.TryGetValue(a.AppId, out r))
                {
                    a.Closing = a.Closing || (r.App.Closing && r.App.Pid == a.Pid);   // still closing until it is gone
                    r.App = a;
                }
                else { r = NewRow(a); _byId[a.AppId] = r; }
                _rows.Add(r);
                UpdateRowText(r);
            }
            if (availableKb >= 0) _subText = Tasks.FormatMemory(availableKb) + " of memory free";
            Efl.evas_object_text_text_set(_sub, _subText);
            if (!_loaded) { _loaded = true; Efl.evas_object_text_text_set(_empty, "No apps are running"); }
            _alpha = -1;   // re-tint everything on the next frame
        }

        /// <summary>The same rows in a new order (after a sort), without touching their objects.</summary>
        public void Reorder(List<RunningApp> apps)
        {
            _rows.Clear();
            foreach (RunningApp a in apps) { Row r; if (_byId.TryGetValue(a.AppId, out r)) _rows.Add(r); }
        }

        public void SetSort(TaskSort sort)
        {
            _sortText = "‹  " + Tasks.SortName(sort) + "  ›";
            Efl.evas_object_text_text_set(_sort, "Sort by   " + _sortText);
        }

        public void MarkClosing(RunningApp app)
        {
            Row r;
            if (app == null || !_byId.TryGetValue(app.AppId, out r)) return;
            r.App.Closing = true;
            UpdateRowText(r);
            r.Alpha = -1;
        }

        private Row NewRow(RunningApp a)
        {
            var r = new Row { App = a };
            r.Icon = Efl.evas_object_image_add(_evas);
            if (!LoadIcon(r))
            {
                Efl.evas_object_image_file_set(r.Icon, Path.Combine(_assets, "glass_tile.png"), null);
                r.Initials = Efl.evas_object_text_add(_evas);
                Efl.evas_object_text_font_set(r.Initials, Font, 22);
                Efl.evas_object_text_text_set(r.Initials, Dock.Initials(a.Label));
                Efl.evas_object_clip_set(r.Initials, _listClip);
                Efl.evas_object_show(r.Initials);
            }
            Efl.evas_object_image_filled_set(r.Icon, true);
            Efl.evas_object_image_smooth_scale_set(r.Icon, true);
            Efl.evas_object_resize(r.Icon, TaskLayout.IconSize, TaskLayout.IconSize);
            Efl.evas_object_clip_set(r.Icon, _listClip);
            Efl.evas_object_show(r.Icon);

            r.Name = RowText(FontBold, 27);
            Efl.evas_object_text_text_set(r.Name, a.Label);
            Efl.evas_object_text_ellipsis_set(r.Name, 1.0);   // a long name ends in "..." before the CPU column
            r.Cpu = RowText(Font, 24);
            r.Mem = RowText(Font, 24);
            return r;
        }

        private IntPtr RowText(string font, int size)
        {
            IntPtr t = Efl.evas_object_text_add(_evas);
            Efl.evas_object_text_font_set(t, font, size);
            Efl.evas_object_text_style_set(t, Efl.EvasTextStyleSoftShadow);
            Efl.evas_object_clip_set(t, _listClip);
            Efl.evas_object_show(t);
            return t;
        }

        private void UpdateRowText(Row r)
        {
            string cpu = r.App.Closing ? "" : Tasks.FormatCpu(r.App.CpuPercent);
            string mem = r.App.Closing ? "closing…" : Tasks.FormatMemory(r.App.MemoryKb);
            if (cpu != r.CpuText) { r.CpuText = cpu; Efl.evas_object_text_text_set(r.Cpu, cpu); }
            if (mem != r.MemText) { r.MemText = mem; Efl.evas_object_text_text_set(r.Mem, mem); }
            if (r.ShownClosing != r.App.Closing) { r.ShownClosing = r.App.Closing; r.Alpha = -1; }
            r.ValueH = Efl.evas_object_text_vert_advance_get(r.Mem);
            r.NameH = Efl.evas_object_text_vert_advance_get(r.Name);
        }

        /// <summary>The app's own icon from the registry, rounded like the dock's (IconPrep). False when it cannot be used.</summary>
        private bool LoadIcon(Row r)
        {
            string path = r.App.IconPath;
            if (string.IsNullOrEmpty(path) || !File.Exists(path)) return false;
            try
            {
                Efl.evas_object_image_file_set(r.Icon, path, null);
                if (Efl.evas_object_image_load_error_get(r.Icon) != Efl.EvasLoadErrorNone) return false;
                int w, h;
                Efl.evas_object_image_size_get(r.Icon, out w, out h);
                if (w <= 0 || h <= 0 || w > 2048 || h > 2048) return false;
                IntPtr data = Efl.evas_object_image_data_get(r.Icon, false);
                if (data == IntPtr.Zero) return false;
                uint[] src = Dock.ReadPixels(data, Efl.evas_object_image_stride_get(r.Icon), w, h);
                int hue = IconPrep.DominantColor(src, w, h);
                if (hue >= 0) r.Glow = hue;
                uint[] done = IconPrep.Prepare(src, w, h);
                int side = IconPrep.SideFor(w, h);
                Efl.evas_object_image_alpha_set(r.Icon, true);
                Efl.evas_object_image_size_set(r.Icon, side, side);
                IntPtr dst = Efl.evas_object_image_data_get(r.Icon, true);
                if (dst == IntPtr.Zero) return false;
                Dock.WritePixels(dst, Efl.evas_object_image_stride_get(r.Icon), done, side);
                Efl.evas_object_image_data_set(r.Icon, dst);
                Efl.evas_object_image_data_update_add(r.Icon, 0, 0, side, side);
                return true;
            }
            catch (Exception ex) { _log("tasks: icon " + r.App.AppId + ": " + ex.Message); return false; }
        }

        private static void DeleteRow(Row r)
        {
            foreach (IntPtr o in new[] { r.Icon, r.Initials, r.Name, r.Cpu, r.Mem })
                if (o != IntPtr.Zero) Efl.evas_object_del(o);
        }

        private static void Tint(IntPtr o, int a) { Efl.evas_object_color_set(o, a, a, a, a); }

        private static void TintText(IntPtr t, int a)
        {
            Tint(t, a);
            Efl.evas_object_text_shadow_color_set(t, 0, 0, 0, 150 * a / 255);
        }

        private static void TintRgb(IntPtr o, int a, int rgb)
        {
            Efl.evas_object_color_set(o, ((rgb >> 16) & 0xFF) * a / 255, ((rgb >> 8) & 0xFF) * a / 255, (rgb & 0xFF) * a / 255, a);
        }

        private static void Place(IntPtr o, Box b) { Efl.evas_object_move(o, b.X, b.Y); Efl.evas_object_resize(o, b.W, b.H); }

        public void Apply(TaskController c)
        {
            int n = _rows.Count, slide = c.Slide;
            int a = (int)Math.Round(255f * c.Presence);

            Efl.evas_object_move(_clip, 0, 0);
            Efl.evas_object_resize(_clip, _layout.WinW, _layout.WinH);
            Place(_listClip, _layout.ListClip(n, slide));
            Place(_shadow, _layout.Shadow(n, slide));
            Place(_bg, _layout.Panel(n, slide));

            int headTop = _layout.HeaderTop(n, slide);
            int titleH = Efl.evas_object_text_vert_advance_get(_title);
            Efl.evas_object_move(_title, _layout.ContentLeft, headTop + 8);
            Efl.evas_object_move(_sub, _layout.ContentLeft + Efl.evas_object_text_horiz_advance_get(_title) + 18,
                headTop + 8 + titleH - Efl.evas_object_text_vert_advance_get(_sub) - 3);
            Efl.evas_object_move(_sort, _layout.ContentRight - Efl.evas_object_text_horiz_advance_get(_sort),
                headTop + 8 + (titleH - Efl.evas_object_text_vert_advance_get(_sort)) / 2);
            Box div; div.X = _layout.PanelX + TaskLayout.PadX; div.W = TaskLayout.PanelW - 2 * TaskLayout.PadX; div.H = 1;
            div.Y = _layout.ListTop(n, slide) - 6;
            Place(_divider, div);
            int footW = Efl.evas_object_text_horiz_advance_get(_footer);
            Efl.evas_object_move(_footer, _layout.PanelX + (TaskLayout.PanelW - footW) / 2, _layout.FooterTop(n, slide));

            if (a != _alpha)
            {
                _alpha = a;
                Tint(_shadow, a);
                Tint(_bg, a);
                Tint(_divider, (int)(a * Design.DividerAlpha));
                TintText(_title, a);
                TintText(_sub, a * 6 / 10);
                TintText(_sort, a * 9 / 10);
                TintText(_footer, a * 55 / 100);
                TintText(_empty, n == 0 ? a * 6 / 10 : 0);
                foreach (Row r in _rows) r.Alpha = -1;
            }

            if (n == 0)
            {
                Box lc = _layout.ListClip(0, slide);
                int ew = Efl.evas_object_text_horiz_advance_get(_empty), eh = Efl.evas_object_text_vert_advance_get(_empty);
                Efl.evas_object_move(_empty, lc.X + (lc.W - ew) / 2, lc.Y + (lc.H - eh) / 2);
            }

            // Selection: glow in the app's colour, the glass plate, then the ring, all on the selected row.
            float pos = c.SelPos, scroll = c.Scroll;
            Box plate = _layout.Plate(pos, scroll, n, slide);
            Box glow = plate; glow.X -= DockLayout.PillGlowPad; glow.Y -= DockLayout.PillGlowPad; glow.W += 2 * DockLayout.PillGlowPad; glow.H += 2 * DockLayout.PillGlowPad;
            Box ring = plate; ring.X -= Design.RingW; ring.Y -= Design.RingW; ring.W += 2 * Design.RingW; ring.H += 2 * Design.RingW;
            Place(_glow, glow);
            Place(_plate, plate);
            Place(_ring, ring);
            int sel = c.Selected;
            int rgb = n > 0 && Design.GlowFromIcon ? _rows[Math.Min(sel, n - 1)].Glow : Design.GlowColor;
            int ga = n > 0 ? a * 8 / 10 : 0;
            if (ga != _glowAlpha || rgb != _glowRgb)
            {
                _glowAlpha = ga; _glowRgb = rgb;
                TintRgb(_glow, ga, rgb);
                Tint(_plate, n > 0 ? a * 55 / 100 : 0);
                TintRgb(_ring, n > 0 ? a : 0, Design.RingColor);
            }

            for (int i = 0; i < n; i++)
            {
                Row r = _rows[i];
                int top = _layout.RowTop(i, scroll, n, slide);
                int mid = top + TaskLayout.RowH / 2;
                Efl.evas_object_move(r.Icon, _layout.IconX, mid - TaskLayout.IconSize / 2);
                if (r.Initials != IntPtr.Zero)
                {
                    int iw = Efl.evas_object_text_horiz_advance_get(r.Initials), ih = Efl.evas_object_text_vert_advance_get(r.Initials);
                    Efl.evas_object_move(r.Initials, _layout.IconX + (TaskLayout.IconSize - iw) / 2, mid - ih / 2);
                }
                int nameMax = _layout.CpuRight - 120 - _layout.NameX;
                Efl.evas_object_resize(r.Name, nameMax, r.NameH);
                Efl.evas_object_move(r.Name, _layout.NameX, mid - r.NameH / 2);
                Efl.evas_object_move(r.Cpu, _layout.CpuRight - Efl.evas_object_text_horiz_advance_get(r.Cpu), mid - r.ValueH / 2);
                Efl.evas_object_move(r.Mem, _layout.MemRight - Efl.evas_object_text_horiz_advance_get(r.Mem), mid - r.ValueH / 2);

                // The column the list is sorted by is the brighter one; a closing app fades.
                bool focus = i == sel;
                int ra = r.App.Closing ? a * 45 / 100 : (focus ? a : a * 85 / 100);
                int key = ra * 4 + (focus ? 1 : 0) + (c.Sort == TaskSort.Cpu ? 2 : 0);
                if (key != r.Alpha)
                {
                    r.Alpha = key;
                    Tint(r.Icon, ra);
                    if (r.Initials != IntPtr.Zero) Tint(r.Initials, ra);
                    TintText(r.Name, ra);
                    TintText(r.Mem, c.Sort == TaskSort.Cpu ? ra * 7 / 10 : ra);
                    TintText(r.Cpu, c.Sort == TaskSort.Cpu ? ra : ra * 7 / 10);
                }
            }
        }
    }
}
