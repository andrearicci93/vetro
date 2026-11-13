using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using Launcher.Native;

// A notification-plane window with no input region and no activation request.
// It must never take focus away from the app's keyboard.
sealed class Feedback
{
    [DllImport("libc.so.6")] static extern int setenv(string name, string value, int overwrite);
    [DllImport("libelementary.so.1")] static extern void elm_win_input_rect_set(IntPtr window, int x, int y, int w, int h);
    [DllImport("libevas.so.1")] static extern void evas_object_pass_events_set(IntPtr obj, [MarshalAs(UnmanagedType.U1)] bool pass);
    [DllImport("libecore.so.1")] static extern int ecore_main_loop_iterate_may_block(int mayBlock);
    readonly IntPtr window, canvas, title, detail;
    readonly IntPtr[] bars = new IntPtr[15];
    readonly Stopwatch clock = Stopwatch.StartNew();
    string state;
    long lastFrame;
    double displayedLevel;
    const int Width = 740, Height = 140;

    public Feedback()
    {
        setenv("ELM_ENGINE", "gl", 1);
        setenv("ECORE_EVAS_ENGINE", "wayland_egl", 1);
        setenv("XDG_RUNTIME_DIR", "/run", 1);
        setenv("WAYLAND_DISPLAY", "wayland-0", 1);
        setenv("ELM_PROFILE", "tv", 1);
        setenv("ELM_DISPLAY", "wl", 1);
        setenv("EVAS_FONT_DPI", "72", 1);
        setenv("ELM_ACCEL", "gl", 1);
        setenv("EVAS_GL_NO_BLACKLIST", "1", 1);
        setenv("ECORE_EVAS_COMP_NOSYNC", "1", 1);
        setenv("EVAS_GL_PARTIAL_DISABLE", "1", 1);
        setenv("EINA_LOG_LEVELS", "*:0", 1);
        Efl.elm_init(0, IntPtr.Zero);
        window = Efl.elm_win_add(IntPtr.Zero, "vetro-voice", Efl.ElmWinNotification);
        if (window == IntPtr.Zero) throw new Exception("Could not create microphone indicator.");
        Efl.elm_win_title_set(window, "Vetro Voice");
        Efl.elm_win_alpha_set(window, true);
        Efl.elm_win_borderless_set(window, true);
        Efl.elm_win_prop_focus_skip_set(window, true);
        Efl.efl_util_set_notification_window_level(window, 40);
        Efl.elm_win_layer_set(window, 900);
        Efl.elm_win_aux_hint_add(window, "wm.policy.win.user.geometry", "1");
        Efl.elm_win_aux_hint_add(window, "wm.comp.win.effect.enable", "0");
        elm_win_input_rect_set(window, 0, 0, 0, 0);
        evas_object_pass_events_set(window, true);
        Efl.evas_object_move(window, (1920 - Width) / 2, 48);
        Efl.evas_object_resize(window, Width, Height);
        canvas = Efl.evas_object_evas_get(window);
        Image(Width, Height, 0, 0, (x, y) =>
        {
            double dx = Math.Max(Math.Abs(x - (Width - 1) / 2.0) - (Width / 2.0 - 28), 0);
            double dy = Math.Max(Math.Abs(y - (Height - 1) / 2.0) - (Height / 2.0 - 28), 0);
            double distance = Math.Sqrt(dx * dx + dy * dy);
            int alpha = (int)(246 * Math.Clamp(28.5 - distance, 0, 1));
            return Pixel(22, 24, 34, alpha);
        });
        // Microphone glyph: capsule, U-shaped cradle and short stand.
        Image(58, 64, 34, 35, (x, y) =>
        {
            bool capsule = Math.Abs(x - 29) <= 8 && y >= 6 && y <= 31;
            capsule |= (x - 29) * (x - 29) + (y - 6) * (y - 6) <= 64 && y <= 6;
            capsule |= (x - 29) * (x - 29) + (y - 31) * (y - 31) <= 64 && y >= 31;
            double r = Math.Sqrt((x - 29) * (x - 29) + (y - 29) * (y - 29));
            bool cradle = y >= 29 && r >= 16 && r <= 20;
            bool sides = y >= 21 && y <= 29 && (Math.Abs(x - 11) <= 2 || Math.Abs(x - 47) <= 2);
            bool stand = Math.Abs(x - 29) <= 2 && y >= 49 && y <= 57;
            stand |= x >= 19 && x <= 39 && y >= 56 && y <= 59;
            return capsule || cradle || sides || stand ? Pixel(245, 111, 159, 255) : 0;
        });
        title = Text(114, 28, 31, 250, 250, 253);
        detail = Text(114, 78, 20, 181, 186, 204);
        for (int i = 0; i < bars.Length; i++)
        {
            bars[i] = Efl.evas_object_rectangle_add(canvas);
            Efl.evas_object_color_set(bars[i], 245, 111, 159, 255);
            Efl.evas_object_show(bars[i]);
        }
        Set("ready");
        Console.WriteLine("Feedback overlay ready; focus skip enabled.");
    }

    static uint Pixel(int r, int g, int b, int a)
    {
        return (uint)((a << 24) | ((r * a / 255) << 16) | ((g * a / 255) << 8) | b * a / 255);
    }

    void Image(int w, int h, int x, int y, Func<int, int, uint> paint)
    {
        IntPtr image = Efl.evas_object_image_add(canvas);
        Efl.evas_object_image_size_set(image, w, h);
        Efl.evas_object_image_alpha_set(image, true);
        int[] pixels = new int[w * h];
        for (int yy = 0; yy < h; yy++) for (int xx = 0; xx < w; xx++) pixels[yy * w + xx] = unchecked((int)paint(xx, yy));
        IntPtr data = Efl.evas_object_image_data_get(image, true);
        Marshal.Copy(pixels, 0, data, pixels.Length);
        Efl.evas_object_image_data_set(image, data);
        Efl.evas_object_image_data_update_add(image, 0, 0, w, h);
        Efl.evas_object_image_filled_set(image, true);
        Efl.evas_object_move(image, x, y);
        Efl.evas_object_resize(image, w, h);
        Efl.evas_object_show(image);
    }

    IntPtr Text(int x, int y, int size, int r, int g, int b)
    {
        IntPtr text = Efl.evas_object_text_add(canvas);
        Efl.evas_object_text_font_set(text, "SamsungOneUI 500,Sans", size);
        Efl.evas_object_color_set(text, r, g, b, 255);
        Efl.evas_object_move(text, x, y);
        Efl.evas_object_show(text);
        return text;
    }

    public void Set(string next)
    {
        if (state == next) return;
        state = next;
        string heading = next == "starting" ? "Starting microphone…" : next == "listening" ? "Listening…" : next == "transcribing" ? "Transcribing…" :
            next == "typing" ? "Typing…" : next == "done" ? "Dictation sent" : next == "error" ? "Dictation stopped" : "Voice ready";
        string hint = next == "starting" ? "Keep holding — speak after the sound" : next == "listening" ? "Release the mic button to finish" : next == "transcribing" ? "Turning your voice into text" :
            next == "typing" ? "Adding text to your search" : next == "done" ? "Your text is ready to edit" :
            next == "error" ? "Open a text field and try again" : "Open a text field, then hold the mic";
        Efl.evas_object_text_text_set(title, heading);
        Efl.evas_object_text_text_set(detail, hint);
        Efl.evas_object_show(window);
        Tick(0);
    }

    public void Tick(double level)
    {
        long now = clock.ElapsedMilliseconds;
        if (now - lastFrame >= 50)
        {
            lastFrame = now;
            displayedLevel = Math.Max(level, displayedLevel * 0.8);
            for (int i = 0; i < bars.Length; i++)
            {
                double shape = 0.25 + 0.75 * Math.Abs(Math.Sin(i * 1.73 + now / 190.0));
                double amount = state == "listening" ? Math.Min(1, displayedLevel * 5) :
                    state == "transcribing" || state == "typing" ? 0.32 : 0.04;
                int h = 5 + (int)(50 * amount * shape);
                Efl.evas_object_move(bars[i], 548 + i * 9, 54 - h / 2);
                Efl.evas_object_resize(bars[i], 5, h);
            }
        }
        ecore_main_loop_iterate_may_block(0);
    }

    public void AwaitResult(string statusPath)
    {
        var wait = Stopwatch.StartNew();
        long finishedAt = -1;
        while (wait.Elapsed.TotalSeconds < 60)
        {
            if (File.Exists(statusPath))
            {
                string next = File.ReadAllText(statusPath).Trim();
                if (next == "typing" || next == "done" || next == "error") Set(next);
                if ((next == "done" || next == "error") && finishedAt < 0) finishedAt = wait.ElapsedMilliseconds;
            }
            if (finishedAt >= 0 && wait.ElapsedMilliseconds - finishedAt > 2500) break;
            Tick(0);
            Thread.Sleep(20);
        }
        Hide();
    }

    public void Hide() { Efl.evas_object_hide(window); Tick(0); }

}
