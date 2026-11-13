using System;
using System.IO;
using Launcher.Core;
using Launcher.Native;

namespace Launcher.Ui
{
    // A compact list replaces the dock inside its existing small window. The
    // focused option is always visible; long service lists scroll three rows.
    internal sealed class AppOptions
    {
        private readonly IntPtr _background, _title, _footer, _selection;
        private readonly IntPtr[] _rows = new IntPtr[3];
        private readonly int _left, _top, _width;
        public bool Visible { get; private set; }
        public bool Busy { get; private set; }
        public int Selected { get; private set; }
        private RunningComponent[] _components = Array.Empty<RunningComponent>();
        public RunningComponent SelectedComponent { get { return Selected < _components.Length ? _components[Selected] : null; } }
        public AppOptions(IntPtr window, DockLayout layout, string assets)
        {
            IntPtr canvas = Efl.evas_object_evas_get(window);
            _width = Math.Min(760, layout.WinW - 64); _left = (layout.WinW - _width) / 2; _top = (layout.WinH - 240) / 2;
            _background = Efl.evas_object_image_add(canvas);
            Efl.evas_object_image_file_set(_background, Path.Combine(assets, "dock_bg.png"), null);
            Efl.evas_object_image_filled_set(_background, true);
            Efl.evas_object_image_border_set(_background, Design.ShellSlice, Design.ShellSlice, Design.ShellSlice, Design.ShellSlice);
            Efl.evas_object_move(_background, _left, _top); Efl.evas_object_resize(_background, _width, 240);
            _title = Text(canvas, 27, _top + 18);
            _selection = Efl.evas_object_rectangle_add(canvas);
            Efl.evas_object_color_set(_selection, 41, 70, 110, 245);
            for (int i = 0; i < _rows.Length; i++) _rows[i] = Text(canvas, 23, _top + 65 + i * 43);
            _footer = Text(canvas, 18, _top + 205);
        }
        private IntPtr Text(IntPtr canvas, int size, int y)
        {
            IntPtr text = Efl.evas_object_text_add(canvas);
            Efl.evas_object_text_font_set(text, "SamsungOneUI 500,Sans", size);
            Efl.evas_object_color_set(text, 240, 243, 250, 255);
            Efl.evas_object_move(text, _left + 26, y); return text;
        }
        private void SetText(IntPtr obj, string text)
        {
            text = text ?? "";
            Efl.evas_object_text_text_set(obj, text);
            while (text.Length > 1 && Efl.evas_object_text_horiz_advance_get(obj) > _width - 52)
            { text = text.Substring(0, text.Length - 2); Efl.evas_object_text_text_set(obj, text + "…"); }
        }
        public void Show(string title, RunningComponent[] components, string message = null)
        {
            Visible = true; Busy = false; _components = components ?? Array.Empty<RunningComponent>();
            Selected = _components.Length; // Cancel is selected, never a stop by default.
            SetText(_title, title); Efl.evas_object_show(_background); Efl.evas_object_show(_title);
            Render(message);
        }
        public void Move(int direction)
        {
            if (Busy) return;
            Selected = Math.Clamp(Selected + direction, 0, _components.Length); Render();
        }
        public void Status(string message, bool busy)
        {
            Busy = busy; Render(message);
        }
        private void Render(string message = null)
        {
            int start = Math.Max(0, Math.Min(Selected - 1, _components.Length - 2));
            for (int i = 0; i < _rows.Length; i++)
            {
                int index = start + i;
                if (index > _components.Length) { Efl.evas_object_hide(_rows[i]); continue; }
                var component = index < _components.Length ? _components[index] : null;
                string label = component == null ? "Cancel" : (component.CanStop ? "Stop " : "Running · ") +
                    (component.Service ? "service: " + component.Name : "app");
                SetText(_rows[i], label); Efl.evas_object_show(_rows[i]);
                if (index == Selected)
                {
                    Efl.evas_object_move(_selection, _left + 14, _top + 59 + i * 43);
                    Efl.evas_object_resize(_selection, _width - 28, 40); Efl.evas_object_show(_selection);
                }
            }
            var current = SelectedComponent;
            SetText(_footer, message ?? (current != null && !current.CanStop ? current.Reason : current != null && current.Autorestart ?
                "This component may restart automatically" : _components.Length == 0 ? "Not running" : "↑ ↓ Choose    OK Select    Back Cancel"));
            Efl.evas_object_show(_footer);
        }
        public void Hide()
        {
            Visible = false; Busy = false;
            foreach (var obj in new[] { _background, _title, _footer, _selection }) Efl.evas_object_hide(obj);
            foreach (var row in _rows) Efl.evas_object_hide(row);
        }
    }
}
