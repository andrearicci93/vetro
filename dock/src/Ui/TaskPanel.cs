using System;
using System.Collections.Generic;
using System.IO;
using Launcher.Core;
using Launcher.Native;

namespace Launcher.Ui
{
    /// <summary>
    /// The Task manager card of the Control center: one row per running app (its icon, name, CPU and memory; a narrow card, beside other
    /// cards, drops the CPU column), the free memory in the header. One set of objects per running app, made when it appears and deleted
    /// when it is gone. The panel, header, hint and capsule are <see cref="CardChrome"/>'s.
    /// </summary>
    internal sealed class TaskPanel : CardChrome
    {
        private sealed class Row
        {
            public RunningApp App;
            public IntPtr Icon, Initials, Name, Cpu, Mem;
            public string CpuText, MemText;
            public bool ShownClosing;
            public int Alpha = -1;
            public bool Inked;   // drawn in slate on the ice capsule, without the soft shadow
            public int NameW, ValueH, NameH;
        }

        private readonly List<Row> _rows = new List<Row>();
        private readonly Dictionary<string, Row> _byId = new Dictionary<string, Row>(StringComparer.Ordinal);
        private string _subText = "";
        private bool _loaded;

        public TaskPanel(IntPtr win, TaskLayout layout, string assets, Action<string> log) : base(win, layout, assets, log, "tasks") { }

        public int Count { get { return _rows.Count; } }

        public RunningApp AppAt(int i) { return i >= 0 && i < _rows.Count ? _rows[i].App : null; }

        public void Build()
        {
            BuildChrome("Running apps");
            // OK open · Hold OK close · Up Back return
            Foot("key_ok", true, FootInner); Foot("open", false, FootGroup);
            Foot("Hold", false, FootInner); Foot("key_ok", true, FootInner); Foot("close", false, FootGroup);
            Foot("key_up", true, 2); Foot("key_back", true, FootInner); Foot("return", false, 0);
            Efl.evas_object_text_text_set(_empty, "Looking for running apps…");
            SetVisible(false);
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
            Retint();   // re-tint everything on the next frame
        }

        /// <summary>The same rows in a new order (after a sort), without touching their objects.</summary>
        public void Reorder(List<RunningApp> apps)
        {
            _rows.Clear();
            foreach (RunningApp a in apps) { Row r; if (_byId.TryGetValue(a.AppId, out r)) _rows.Add(r); }
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

        public void Apply(TaskController c) { Apply(c, true); }

        /// <param name="focused">This card has the focus: its selected row is on the ice capsule.</param>
        public void Apply(TaskController c, bool focused)
        {
            int n = _rows.Count, slide = c.Slide;
            bool retint;
            int a = ApplyChrome(c, n, focused, out retint);
            if (retint) foreach (Row r in _rows) r.Alpha = -1;
            float pos = c.SelPos, scroll = c.Scroll;
            bool narrow = _layout.Narrow;
            // The row the capsule is over gets the slate ink. Taken from where the capsule is, not from where it is going:
            // switching at once would leave dark text on the dark sheet while the capsule is still on its way.
            int sel = (int)Math.Round(pos);

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
                int nameMax = _layout.NameRight - _layout.NameX;
                Efl.evas_object_resize(r.Name, nameMax, r.NameH);
                Efl.evas_object_move(r.Name, _layout.NameX, mid - r.NameH / 2);
                Efl.evas_object_move(r.Cpu, _layout.CpuRight - Efl.evas_object_text_horiz_advance_get(r.Cpu), mid - r.ValueH / 2);
                Efl.evas_object_move(r.Mem, _layout.MemRight - Efl.evas_object_text_horiz_advance_get(r.Mem), mid - r.ValueH / 2);

                // Memory, the column the list is sorted by, is the brighter one; a closing app fades. On the capsule every text
                // is slate and plain (a shadow would smudge dark ink on a light ground); the icon keeps its own colours.
                bool focus = focused && i == sel && n > 0;
                int ra = r.App.Closing ? a * 45 / 100 : (focus ? a : a * 85 / 100);
                int key = ra * 4 + (focus ? 1 : 0);
                if (key != r.Alpha)
                {
                    r.Alpha = key;
                    Tint(r.Icon, ra);
                    if (r.Initials != IntPtr.Zero) Tint(r.Initials, ra);
                    if (focus != r.Inked)
                    {
                        r.Inked = focus;
                        int style = focus ? Efl.EvasTextStylePlain : Efl.EvasTextStyleSoftShadow;
                        Efl.evas_object_text_style_set(r.Name, style);
                        Efl.evas_object_text_style_set(r.Cpu, style);
                        Efl.evas_object_text_style_set(r.Mem, style);
                    }
                    if (focus)
                    {
                        TintRgb(r.Name, ra, Design.ShellColor);
                        TintRgb(r.Cpu, ra, Design.ShellColor);
                        TintRgb(r.Mem, ra, Design.ShellColor);
                    }
                    else
                    {
                        TintText(r.Name, ra);
                        TintText(r.Mem, ra);
                        TintText(r.Cpu, ra * 7 / 10);
                    }
                    if (narrow) Tint(r.Cpu, 0);   // a narrow card has no CPU column
                }
            }
        }
    }
}
