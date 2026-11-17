using System;
using System.Collections.Generic;
using Launcher.Core;
using Launcher.Native;

namespace Launcher.Ui
{
    /// <summary>
    /// A Control center card of plain choices (Picture mode, Sleep timer): one row per choice, the current one ticked, a line in the header
    /// ("The TV switches off in 42 min", "Change it in Samsung's menu"). OK chooses; while the TV switches, the row says so until the card is
    /// read again. The panel, header, hint and capsule are <see cref="CardChrome"/>'s.
    /// </summary>
    internal sealed class ChoiceCard : CardChrome
    {
        private const int Glyph = 40;

        private sealed class Row { public IntPtr Text, Check; public int Key = -1, TextH; }

        private readonly List<Row> _rows = new List<Row>();
        private ChoiceState _state = new ChoiceState { Choosable = false };
        private readonly string _heading, _reading;
        private int _busyRow = -1;
        private PlaceKey _rowsAt;   // what the rows were last placed for

        public ChoiceCard(IntPtr win, TaskLayout layout, string assets, Action<string> log, string tag, string title, string reading)
            : base(win, layout, assets, log, tag) { _heading = title; _reading = reading; }

        public int Count { get { return _rows.Count; } }
        public bool Choosable { get { return _state.Choosable && _busyRow < 0; } }
        public ChoiceRow RowAt(int i) { return i >= 0 && i < _state.Rows.Count ? _state.Rows[i] : null; }
        public int ActiveRow { get { int i = _state.Rows.FindIndex(r => r.Active); return i < 0 ? 0 : i; } }

        public void Build()
        {
            BuildChrome(_heading);
            Foot("key_ok", true, FootInner); Foot("choose", false, FootGroup);
            Foot("key_up", true, 2); Foot("key_back", true, FootInner); Foot("return", false, 0);
            SetEmpty(_reading);
            SetVisible(false);
        }

        /// <summary>Back to "reading" (the Control center opens): no rows until the read arrives.</summary>
        public void Clear()
        {
            SetState(new ChoiceState { Choosable = false });
            SetEmpty(_reading);
        }

        public void SetState(ChoiceState st)
        {
            _state = st ?? new ChoiceState { Choosable = false };
            _busyRow = -1;
            while (_rows.Count > _state.Rows.Count)
            {
                Row r = _rows[_rows.Count - 1];
                Efl.evas_object_del(r.Text); Efl.evas_object_del(r.Check);
                _rows.RemoveAt(_rows.Count - 1);
            }
            for (int i = 0; i < _state.Rows.Count; i++)
            {
                if (i >= _rows.Count) _rows.Add(new Row { Text = RowText(FontBold, 27), Check = RowIcon("out_check", Glyph) });
                Efl.evas_object_text_ellipsis_set(_rows[i].Text, 1.0);
                Efl.evas_object_text_text_set(_rows[i].Text, _state.Rows[i].Label);
                _rows[i].TextH = Efl.evas_object_text_vert_advance_get(_rows[i].Text);
                _rows[i].Key = -1;
            }
            SetSub(_state.Note ?? "");
            if (_state.Rows.Count == 0) SetEmpty(_state.Note.Length > 0 ? _state.Note : _reading);
            Changed();
            Retint();
        }

        /// <summary>A row left saying "Switching…" (the Control center was closed before the answer) gets its own words back.</summary>
        public void ClearBusy() { if (_busyRow >= 0) SetState(_state); }

        public void SetBusy(int row, string text)
        {
            if (row < 0 || row >= _rows.Count) return;
            _busyRow = row;
            Efl.evas_object_text_text_set(_rows[row].Text, text);
            _rows[row].TextH = Efl.evas_object_text_vert_advance_get(_rows[row].Text);
            Changed();
            _rows[row].Key = -1;
        }

        public void Apply(TaskController c, bool focused)
        {
            int n = _rows.Count, slide = c.Slide;
            bool retint;
            int a = ApplyChrome(c, n, focused, out retint, _state.Choosable);
            if (retint) foreach (Row r in _rows) r.Key = -1;
            int sel = (int)Math.Round(c.SelPos);
            int checkX = _layout.MemRight - Glyph, textX = _layout.ContentLeft + 10, textW = checkX - 20 - textX;
            bool place = !_rowsAt.Same(slide, n, _layout.Rows(n), Version, c.Scroll, 0f);
            for (int i = 0; i < n; i++)
            {
                Row r = _rows[i];
                if (place)
                {
                    int mid = _layout.RowTop(i, c.Scroll, n, slide) + TaskLayout.RowH / 2;
                    Efl.evas_object_resize(r.Text, textW, r.TextH);
                    Efl.evas_object_move(r.Text, textX, RowTextTop(r.TextH, mid));
                    Efl.evas_object_move(r.Check, checkX, mid - Glyph / 2);
                }
                bool focus = focused && i == sel && _state.Choosable;
                bool tick = _state.Rows[i].Active && i != _busyRow;
                int ra = focus ? a : (_state.Choosable ? a * 85 / 100 : a * 60 / 100);
                int key = ra * 4 + (focus ? 1 : 0) + (tick ? 2 : 0);
                if (key == r.Key) continue;
                r.Key = key;
                int ink = focus ? Design.ShellColor : 0xFFFFFF;
                if (focus) InkText(r.Text, ra, ink); else TintText(r.Text, ra);
                TintRgb(r.Check, tick ? ra : 0, ink);
            }
        }
    }
}
