using System;
using System.Collections.Generic;
using Launcher.Core;
using Launcher.Native;

namespace Launcher.Ui
{
    /// <summary>
    /// The Audio output card of the Control center: the TV speakers and the paired Bluetooth devices that can play sound
    /// (<see cref="OutputPickerModel.Build"/>), the one playing now ticked. OK sends the sound there; while the system switches, the row
    /// says so ("Switching…", "Connecting…", "Not available") until the host reads the list again. The panel, header, hint and capsule
    /// are <see cref="CardChrome"/>'s.
    /// </summary>
    internal sealed class AudioCard : CardChrome
    {
        private const int Glyph = 40;

        private sealed class Row { public IntPtr Icon, Text, Check; public int Key = -1; public bool Inked; }

        private readonly List<Row> _rows = new List<Row>();
        private List<OutputEntry> _entries = new List<OutputEntry>();
        private int _busyRow = -1;
        private string _busyText;

        public AudioCard(IntPtr win, TaskLayout layout, string assets, Action<string> log) : base(win, layout, assets, log, "audio") { }

        public int Count { get { return _entries.Count; } }

        public OutputEntry EntryAt(int i) { return i >= 0 && i < _entries.Count ? _entries[i] : null; }

        /// <summary>The row that is playing now (where the selection starts), 0 when none is.</summary>
        public int ActiveRow { get { int i = _entries.FindIndex(e => e.Active); return i < 0 ? 0 : i; } }

        public bool Busy { get { return _busyRow >= 0; } }

        public void Build()
        {
            BuildChrome("Audio output");
            // OK play here · Up Back return
            Foot("key_ok", true, FootInner); Foot("play here", false, FootGroup);
            Foot("key_up", true, 2); Foot("key_back", true, FootInner); Foot("return", false, 0);
            Efl.evas_object_text_text_set(_empty, "Reading the sound outputs…");
            SetVisible(false);
        }

        /// <summary>A fresh list (opening the Control center, or after a switch); <paramref name="note"/> goes in the header ("Bluetooth is not available").</summary>
        public void SetEntries(List<OutputEntry> entries, string note)
        {
            _entries = entries ?? new List<OutputEntry>();
            _busyRow = -1; _busyText = null;
            while (_rows.Count > _entries.Count)
            {
                Row r = _rows[_rows.Count - 1];
                Efl.evas_object_del(r.Icon); Efl.evas_object_del(r.Text); Efl.evas_object_del(r.Check);
                _rows.RemoveAt(_rows.Count - 1);
            }
            for (int i = 0; i < _entries.Count; i++)
            {
                string glyph = _entries[i].Kind == OutputKind.TvSpeaker ? "out_tv" : "out_bt";
                if (i >= _rows.Count) _rows.Add(new Row { Icon = RowIcon(glyph, Glyph), Text = RowText(FontBold, 27), Check = RowIcon("out_check", Glyph) });
                else Efl.evas_object_image_file_set(_rows[i].Icon, System.IO.Path.Combine(_assets, glyph + ".png"), null);
                Efl.evas_object_text_ellipsis_set(_rows[i].Text, 1.0);
                Efl.evas_object_text_text_set(_rows[i].Text, _entries[i].Label);
                _rows[i].Key = -1;
            }
            Efl.evas_object_text_text_set(_sub, note ?? "");
            Retint();
        }

        /// <summary>Row <paramref name="row"/> says what is happening instead of its name, until the next <see cref="SetEntries"/>.</summary>
        public void SetBusy(int row, string text)
        {
            if (row < 0 || row >= _rows.Count) return;
            _busyRow = row; _busyText = text;
            Efl.evas_object_text_text_set(_rows[row].Text, text);
            _rows[row].Key = -1;
        }

        public void Apply(TaskController c, bool focused)
        {
            int n = _rows.Count, slide = c.Slide;
            bool retint;
            int a = ApplyChrome(c, n, focused, out retint);
            if (retint) foreach (Row r in _rows) r.Key = -1;
            float scroll = c.Scroll;
            int sel = (int)Math.Round(c.SelPos);
            int iconX = _layout.IconX + (TaskLayout.IconSize - Glyph) / 2;
            int checkX = _layout.MemRight - Glyph;
            int textX = _layout.NameX, textW = checkX - 20 - textX;
            for (int i = 0; i < n; i++)
            {
                Row r = _rows[i];
                int mid = _layout.RowTop(i, scroll, n, slide) + TaskLayout.RowH / 2;
                int th = Efl.evas_object_text_vert_advance_get(r.Text);
                Efl.evas_object_move(r.Icon, iconX, mid - Glyph / 2);
                Efl.evas_object_resize(r.Text, textW, th);
                Efl.evas_object_move(r.Text, textX, mid - th / 2);
                Efl.evas_object_move(r.Check, checkX, mid - Glyph / 2);

                bool focus = focused && i == sel;
                bool tick = _entries[i].Active && i != _busyRow;
                int ra = focus ? a : a * 85 / 100;
                int key = ra * 4 + (focus ? 1 : 0) + (tick ? 2 : 0);
                if (key == r.Key) continue;
                r.Key = key;
                if (focus != r.Inked)
                {
                    r.Inked = focus;
                    // On the ice capsule the text is slate and plain: the soft shadow that lifts white text off the glass would smudge it.
                    Efl.evas_object_text_style_set(r.Text, focus ? Efl.EvasTextStylePlain : Efl.EvasTextStyleSoftShadow);
                }
                int ink = focus ? Design.ShellColor : 0xFFFFFF;
                TintRgb(r.Icon, ra, ink);
                if (focus) TintRgb(r.Text, ra, ink); else TintText(r.Text, ra);
                TintRgb(r.Check, tick ? ra : 0, ink);
            }
        }
    }
}
