using System;
using System.Collections.Generic;
using System.Diagnostics;
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
        private const double ClosingTimeoutSeconds = 6.0;

        private sealed class Row
        {
            public RunningApp App;
            public IntPtr Icon, Initials, Name, Cpu, Mem;
            public string CpuText, MemText;
            public string IconKey;   // its icon's key in Dock.Icons, null without one
            public bool ShownClosing;
            public long ClosingAt;
            public int Alpha = -1;
            public int NameW, ValueH, NameH;
            // Measured when the texts are set (never per frame): the right-aligned figures' widths and every line height.
            public int CpuW, CpuH, MemW, InitialsW, InitialsH;
        }

        internal static bool KeepClosing(bool wasClosing, int oldPid, int newPid, long closingAt, long now, long timeoutTicks)
        {
            return wasClosing && oldPid == newPid && (closingAt == 0 || now - closingAt < timeoutTicks);
        }

        private readonly List<Row> _rows = new List<Row>();
        private readonly Dictionary<string, Row> _byId = new Dictionary<string, Row>(StringComparer.Ordinal);
        private string _subText = "";
        private bool _loaded;
        private PlaceKey _rowsAt;   // what the rows were last placed for

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
            SetEmpty("Looking for running apps…");
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
            long now = Stopwatch.GetTimestamp();
            long closingLimit = (long)(ClosingTimeoutSeconds * Stopwatch.Frequency);
            foreach (RunningApp a in apps)
            {
                Row r;
                if (_byId.TryGetValue(a.AppId, out r))
                {
                    a.Closing = a.Closing || KeepClosing(r.App.Closing, r.App.Pid, a.Pid, r.ClosingAt, now, closingLimit);
                    if (!a.Closing) r.ClosingAt = 0;
                    r.App = a;
                }
                else { r = NewRow(a); _byId[a.AppId] = r; }
                _rows.Add(r);
                UpdateRowText(r);
            }
            if (availableKb >= 0) _subText = Tasks.FormatMemory(availableKb) + " of memory free";
            SetSub(_subText);
            if (!_loaded) { _loaded = true; SetEmpty("No apps are running"); }
            Changed();  // the rows may have changed order, come or gone: placed again on the next frame
            Retint();   // re-tint everything on the next frame
        }

        public void MarkClosing(RunningApp app)
        {
            Row r;
            if (app == null || !_byId.TryGetValue(app.AppId, out r)) return;
            r.App.Closing = true;
            r.ClosingAt = Stopwatch.GetTimestamp();
            UpdateRowText(r);
            Changed();
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
                r.InitialsW = Efl.evas_object_text_horiz_advance_get(r.Initials);
                r.InitialsH = Efl.evas_object_text_vert_advance_get(r.Initials);
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
            r.CpuW = Efl.evas_object_text_horiz_advance_get(r.Cpu);
            r.CpuH = Efl.evas_object_text_vert_advance_get(r.Cpu);
            r.MemW = Efl.evas_object_text_horiz_advance_get(r.Mem);
        }

        /// <summary>
        /// The app's own icon from the registry, rounded like the dock's (IconPrep). False when it cannot be used. It comes from the dock's
        /// <see cref="Dock.Icons"/> when it was finished before at this side: an app that closes and starts again, or the rows made while the
        /// cards come in, then only copy pixels.
        /// </summary>
        private bool LoadIcon(Row r)
        {
            string path = r.App.IconPath;
            if (string.IsNullOrEmpty(path) || !File.Exists(path)) return false;
            try
            {
                string why;
                // Drawn at IconSize (52): twice that is all the picture needs, a quarter of the work of the dock's 256.
                return Dock.PutRegistryIcon(r.Icon, path, 2 * TaskLayout.IconSize, false, out r.IconKey, out why) != null;
            }
            catch (Exception ex) { r.IconKey = null; _log("tasks: icon " + r.App.AppId + ": " + ex.Message); return false; }
        }

        /// <summary>The rows still show their icons: they stay in <see cref="Dock.Icons"/> through the next sweep.</summary>
        public void KeepIcons()
        {
            foreach (Row r in _rows) Dock.Icons.Keep(r.IconKey);
        }

        private static void DeleteRow(Row r)
        {
            foreach (IntPtr o in new[] { r.Icon, r.Initials, r.Name, r.Cpu, r.Mem })
                if (o != IntPtr.Zero) Efl.evas_object_del(o);
        }

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
            // The rows stand still unless the card slides, scrolls, or its rows or texts changed.
            bool place = !_rowsAt.Same(slide, n, _layout.Rows(n), Version, scroll, 0f);

            for (int i = 0; i < n; i++)
            {
                Row r = _rows[i];
                if (place)
                {
                    int top = _layout.RowTop(i, scroll, n, slide);
                    int mid = top + TaskLayout.RowH / 2;
                    Efl.evas_object_move(r.Icon, _layout.IconX, mid - TaskLayout.IconSize / 2);
                    if (r.Initials != IntPtr.Zero) Efl.evas_object_move(r.Initials, _layout.IconX + (TaskLayout.IconSize - r.InitialsW) / 2, mid - r.InitialsH / 2);
                    int nameMax = _layout.NameRight - _layout.NameX;
                    Efl.evas_object_resize(r.Name, nameMax, r.NameH);
                    Efl.evas_object_move(r.Name, _layout.NameX, RowTextTop(r.NameH, mid));
                    Efl.evas_object_move(r.Cpu, _layout.CpuRight - r.CpuW, RowTextTop(r.CpuH, mid));
                    Efl.evas_object_move(r.Mem, _layout.MemRight - r.MemW, RowTextTop(r.ValueH, mid));
                }

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
                    if (focus)
                    {
                        InkText(r.Name, ra, Design.ShellColor);
                        InkText(r.Cpu, ra, Design.ShellColor);
                        InkText(r.Mem, ra, Design.ShellColor);
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
