using System;
using System.Runtime.InteropServices;

namespace Launcher.Native
{
    /// <summary>
    /// P/Invoke surface of the Tizen EFL stack that ships on the TV (EFL 1.25). Every symbol
    /// here was checked against the libraries of the firmware dump. Signatures follow the C
    /// headers: Eina_Bool is an unsigned char, so callbacks return byte and boolean
    /// arguments are marshalled as U1.
    /// </summary>
    internal static class Efl
    {
        private const string Elm = "libelementary.so.1";
        private const string Evas = "libevas.so.1";
        private const string Ecore = "libecore.so.1";
        private const string EcoreEvas = "libecore_evas.so.1";
        private const string EcoreWl2 = "libecore_wl2.so.1";
        private const string EflUtil = "libcapi-ui-efl-util.so.0";
        private const string AppControl = "libcapi-appfw-app-control.so.0";

        public const int ElmWinNotification = 12;
        public const int ElmWinKeygrabTopmost = 512;
        public const int EvasCallbackKeyDown = 10;
        public const int EvasCallbackKeyUp = 11;
        public const int EcoreFdRead = 1;
        public const int EvasLoadErrorNone = 0;
        public const int EvasImageScaleHintDynamic = 1;
        public const int EvasImageScaleHintStatic = 2;
        public const int EvasBorderFillNone = 0;
        public const int EvasBorderFillDefault = 1;

        // --- delegates (kept alive by their owners; the GC must not collect a callback in use) ---
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate byte TaskCb(IntPtr data);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate byte FdCb(IntPtr data, IntPtr handler);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate void EvasCb(IntPtr data, IntPtr evas, IntPtr obj, IntPtr eventInfo);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate byte EventCb(IntPtr data, int type, IntPtr ev);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate void VconfCb(IntPtr keynode, IntPtr userData);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate void MainLoopCb(IntPtr data);

        // --- elementary ---
        [DllImport(Elm)] public static extern int elm_init(int argc, IntPtr argv);
        [DllImport(Elm)] public static extern void elm_run();
        [DllImport(Elm)] public static extern void elm_shutdown();
        [DllImport(Elm)] public static extern IntPtr elm_win_add(IntPtr parent, string name, int type);
        [DllImport(Elm)] public static extern void elm_win_title_set(IntPtr win, string title);
        [DllImport(Elm)] public static extern void elm_win_alpha_set(IntPtr win, [MarshalAs(UnmanagedType.U1)] bool alpha);
        [DllImport(Elm)] public static extern void elm_win_borderless_set(IntPtr win, [MarshalAs(UnmanagedType.U1)] bool borderless);
        [DllImport(Elm)] public static extern void elm_win_prop_focus_skip_set(IntPtr win, [MarshalAs(UnmanagedType.U1)] bool skip);
        [DllImport(Elm)] public static extern void elm_win_layer_set(IntPtr win, int layer);
        [DllImport(Elm)] public static extern int elm_win_aux_hint_add(IntPtr win, string hint, string val);
        [DllImport(Elm)] public static extern void elm_win_activate(IntPtr win);
        [DllImport(Elm)] public static extern void elm_win_raise(IntPtr win);
        // The Home claim (--claim-home). Exported by libelementary on the Q80A (Tizen 6.0) and in the 6.5 (PTMD 1720) and 9 (NKLD 0090)
        // dumps. Evas_Modifier_Mask is an unsigned long long; the mode is an Elm_Win_Keygrab_Mode bit (EXCLUSIVE = 1 << 10).
        [DllImport(Elm)] [return: MarshalAs(UnmanagedType.U1)] public static extern bool elm_win_keygrab_set(IntPtr win, string key, ulong modifiers, ulong notModifiers, int priority, int grabMode);
        [DllImport(Elm)] [return: MarshalAs(UnmanagedType.U1)] public static extern bool elm_win_keygrab_unset(IntPtr win, string key, ulong modifiers, ulong notModifiers);
        [DllImport(Elm)] public static extern void elm_win_screen_size_get(IntPtr win, out int x, out int y, out int w, out int h);

        // --- evas: generic objects ---
        [DllImport(Evas)] public static extern IntPtr evas_object_evas_get(IntPtr obj);
        [DllImport(Evas)] public static extern void evas_object_move(IntPtr obj, int x, int y);
        [DllImport(Evas)] public static extern void evas_object_resize(IntPtr obj, int w, int h);
        [DllImport(Evas)] public static extern void evas_object_show(IntPtr obj);
        [DllImport(Evas)] public static extern void evas_object_hide(IntPtr obj);
        [DllImport(Evas)] public static extern void evas_object_color_set(IntPtr obj, int r, int g, int b, int a);
        [DllImport(Evas)] public static extern void evas_object_clip_set(IntPtr obj, IntPtr clip);
        [DllImport(Evas)] public static extern void evas_object_event_callback_add(IntPtr obj, int type, EvasCb cb, IntPtr data);
        [DllImport(Evas)] public static extern IntPtr evas_object_rectangle_add(IntPtr evas);
        [DllImport(Evas)] public static extern void evas_object_pass_events_set(IntPtr obj, [MarshalAs(UnmanagedType.U1)] bool pass);
        [DllImport(Evas)] public static extern void evas_object_focus_set(IntPtr obj, [MarshalAs(UnmanagedType.U1)] bool focus);
        [DllImport(Evas)] [return: MarshalAs(UnmanagedType.U1)] public static extern bool evas_object_key_grab(IntPtr obj, string keyname, ulong modifiers, ulong notModifiers, [MarshalAs(UnmanagedType.U1)] bool exclusive);
        [DllImport(Evas)] public static extern void evas_object_key_ungrab(IntPtr obj, string keyname, ulong modifiers, ulong notModifiers);
        [DllImport(Evas)] public static extern void evas_object_del(IntPtr obj);

        // --- evas: images ---
        [DllImport(Evas)] public static extern IntPtr evas_object_image_add(IntPtr evas);
        // Returns void in C: success is read back with evas_object_image_load_error_get.
        [DllImport(Evas)] public static extern void evas_object_image_file_set(IntPtr img, string file, string key);
        [DllImport(Evas)] public static extern int evas_object_image_load_error_get(IntPtr img);
        [DllImport(Evas)] public static extern void evas_object_image_filled_set(IntPtr img, [MarshalAs(UnmanagedType.U1)] bool filled);
        [DllImport(Evas)] public static extern void evas_object_image_fill_set(IntPtr img, int x, int y, int w, int h);
        [DllImport(Evas)] public static extern void evas_object_image_border_set(IntPtr img, int l, int r, int t, int b);
        [DllImport(Evas)] public static extern void evas_object_image_border_center_fill_set(IntPtr img, int mode);
        /// <summary>Draws the nine-slice borders at this scale, so a corner made for a large tile fits a short row.</summary>
        [DllImport(Evas)] public static extern void evas_object_image_border_scale_set(IntPtr img, double scale);
        [DllImport(Evas)] public static extern void evas_object_image_smooth_scale_set(IntPtr img, [MarshalAs(UnmanagedType.U1)] bool smooth);
        [DllImport(Evas)] public static extern void evas_object_image_scale_hint_set(IntPtr img, int hint);
        // --- evas: raw pixels (EFL keeps them as premultiplied ARGB, one 32-bit word per pixel) ---
        [DllImport(Evas)] public static extern void evas_object_image_size_get(IntPtr img, out int w, out int h);
        [DllImport(Evas)] public static extern void evas_object_image_size_set(IntPtr img, int w, int h);
        [DllImport(Evas)] public static extern int evas_object_image_stride_get(IntPtr img);
        [DllImport(Evas)] public static extern IntPtr evas_object_image_data_get(IntPtr img, [MarshalAs(UnmanagedType.U1)] bool forWriting);
        [DllImport(Evas)] public static extern void evas_object_image_data_set(IntPtr img, IntPtr data);
        [DllImport(Evas)] public static extern void evas_object_image_data_update_add(IntPtr img, int x, int y, int w, int h);
        [DllImport(Evas)] public static extern void evas_object_image_alpha_set(IntPtr img, [MarshalAs(UnmanagedType.U1)] bool alpha);
        [DllImport(Evas)] [return: MarshalAs(UnmanagedType.U1)] public static extern bool evas_object_image_save(IntPtr img, string file, string key, string flags);

        // --- evas: sub-pixel texture mapping (EFL 1.25 libevas.so.1) ---
        [DllImport(Evas)] public static extern IntPtr evas_map_new(int count);
        [DllImport(Evas)] public static extern void evas_map_free(IntPtr map);
        [DllImport(Evas)] public static extern void evas_map_smooth_set(IntPtr map, [MarshalAs(UnmanagedType.U1)] bool enabled);
        [DllImport(Evas)] public static extern void evas_map_alpha_set(IntPtr map, [MarshalAs(UnmanagedType.U1)] bool enabled);
        [DllImport(Evas)] public static extern void evas_map_point_coord_set(IntPtr map, int idx, int x, int y, int z);
        [DllImport(Evas)] public static extern void evas_map_point_image_uv_set(IntPtr map, int idx, double u, double v);
        [DllImport(Evas)] public static extern void evas_map_point_color_set(IntPtr map, int idx, int r, int g, int b, int a);
        [DllImport(Evas)] public static extern void evas_map_util_zoom(IntPtr map, double zoomx, double zoomy, int cx, int cy);
        [DllImport(Evas)] public static extern void evas_object_map_set(IntPtr obj, IntPtr map);
        [DllImport(Evas)] public static extern void evas_object_map_enable_set(IntPtr obj, [MarshalAs(UnmanagedType.U1)] bool enabled);

        // --- evas: text ---
        [DllImport(Evas)] public static extern IntPtr evas_object_text_add(IntPtr evas);
        [DllImport(Evas)] public static extern void evas_object_text_font_set(IntPtr txt, string font, int size);
        [DllImport(Evas)] public static extern void evas_object_text_text_set(IntPtr txt, string text);
        [DllImport(Evas)] public static extern int evas_object_text_horiz_advance_get(IntPtr txt);
        [DllImport(Evas)] public static extern int evas_object_text_vert_advance_get(IntPtr txt);
        [DllImport(Evas)] public static extern void evas_object_text_style_set(IntPtr txt, int style);
        [DllImport(Evas)] public static extern void evas_object_text_shadow_color_set(IntPtr txt, int r, int g, int b, int a);
        /// <summary>0..1: where a text cut by its width gets the "..." (1 = at the end); -1 turns it off.</summary>
        [DllImport(Evas)] public static extern void evas_object_text_ellipsis_set(IntPtr txt, double ellipsis);
        /// <summary>EVAS_TEXT_STYLE_SOFT_SHADOW: the ninth value of the enum (PLAIN, SHADOW, OUTLINE, SOFT_OUTLINE, GLOW, OUTLINE_SHADOW, FAR_SHADOW, OUTLINE_SOFT_SHADOW, SOFT_SHADOW).</summary>
        public const int EvasTextStyleSoftShadow = 8;
        /// <summary>EVAS_TEXT_STYLE_PLAIN: no shadow (the first value of the same enum).</summary>

        // --- ecore ---
        [DllImport(Ecore)] public static extern double ecore_time_get();
        [DllImport(Ecore)] public static extern IntPtr ecore_animator_add(TaskCb func, IntPtr data);
        [DllImport(Ecore)] public static extern IntPtr ecore_animator_del(IntPtr animator);
        [DllImport(Ecore)] public static extern double ecore_animator_frametime_get();
        [DllImport(Ecore)] public static extern IntPtr ecore_timer_add(double inSeconds, TaskCb func, IntPtr data);
        [DllImport(Ecore)] public static extern void ecore_timer_reset(IntPtr timer);
        [DllImport(Ecore)] public static extern IntPtr ecore_timer_del(IntPtr timer);
        [DllImport(Ecore)] public static extern IntPtr ecore_main_fd_handler_add(int fd, int flags, FdCb func, IntPtr data, IntPtr bufFunc, IntPtr bufData);
        [DllImport(Ecore)] public static extern IntPtr ecore_main_fd_handler_del(IntPtr handler);
        // A key as ecore_input hands it out (type ECORE_EVENT_KEY_DOWN, read from libecore_input), before evas: the claimed Home reaches
        // the process here even when the window is not shown, if the compositor sends it at all.
        [DllImport(Ecore)] public static extern IntPtr ecore_event_handler_add(int type, EventCb func, IntPtr data);
        [DllImport(Ecore)] public static extern void ecore_main_loop_thread_safe_call_async(MainLoopCb callback, IntPtr data);

        // --- diagnostics & cursor ---
        [DllImport(EcoreEvas)] public static extern IntPtr ecore_evas_ecore_evas_get(IntPtr evas);
        [DllImport(EcoreEvas)] public static extern IntPtr ecore_evas_engine_name_get(IntPtr ee);
        [DllImport(EcoreEvas)] public static extern void ecore_evas_ignore_events_set(IntPtr ee, [MarshalAs(UnmanagedType.U1)] bool ignore);
        [DllImport(EcoreEvas)] public static extern void ecore_evas_default_cursor_hide(IntPtr ee);
        [DllImport(EcoreEvas)] public static extern IntPtr ecore_evas_wayland2_window_get(IntPtr ee);
        [DllImport(EcoreWl2)] public static extern void ecore_wl2_window_cursor_visible_set(IntPtr win, [MarshalAs(UnmanagedType.U1)] bool visible);

        /// <summary>
        /// Prevents Enlightenment/Wayland from attaching a persistent default pointer cursor surface to this window
        /// after an app that enables pointer mode (such as Samsung Internet Browser) exits.
        /// </summary>
        public static void HideCursor(IntPtr win, bool ignoreEvents)
        {
            if (win == IntPtr.Zero) return;
            try
            {
                IntPtr evas = evas_object_evas_get(win);
                if (evas == IntPtr.Zero) return;
                IntPtr ee = ecore_evas_ecore_evas_get(evas);
                if (ee == IntPtr.Zero) return;
                if (ignoreEvents)
                {
                    try { ecore_evas_ignore_events_set(ee, true); } catch (Exception) { }
                }
                try { ecore_evas_default_cursor_hide(ee); } catch (Exception) { }
                try
                {
                    IntPtr wlWin = ecore_evas_wayland2_window_get(ee);
                    if (wlWin != IntPtr.Zero) ecore_wl2_window_cursor_visible_set(wlWin, false);
                }
                catch (Exception) { }
            }
            catch (Exception) { }
        }

        // --- platform ---
        [DllImport(EflUtil)] public static extern int efl_util_set_notification_window_level(IntPtr win, int level);
        [DllImport(AppControl)] public static extern int app_control_create(out IntPtr ac);
        [DllImport(AppControl)] public static extern int app_control_set_app_id(IntPtr ac, string appId);
        [DllImport(AppControl)] public static extern int app_control_set_operation(IntPtr ac, string operation);
        [DllImport(AppControl)] public static extern int app_control_send_launch_request(IntPtr ac, IntPtr replyCb, IntPtr userData);
        [DllImport(AppControl)] public static extern int app_control_destroy(IntPtr ac);
        [DllImport(AppControl)] public static extern int app_control_add_extra_data(IntPtr ac, string key, string value);
        [DllImport("libvconf.so.0")] public static extern int vconf_get_int(string key, out int value);
        [DllImport("libvconf.so.0")] public static extern int vconf_get_bool(string key, out int value);
        [DllImport("libvconf.so.0")] public static extern IntPtr vconf_get_str(string key);
        [DllImport("libvconf.so.0")] public static extern int vconf_notify_key_changed(string key, VconfCb cb, IntPtr userData);
        [DllImport("libvconf.so.0")] public static extern int vconf_ignore_key_changed(string key, VconfCb cb);
        /// <summary>Read-only: the app the TV treats as Home for the "main" operation (what the Home key launches).</summary>
        [DllImport("libcapi-appfw-app-operation-tv.so.0")] public static extern int app_operation_get_current_app(string operation, out IntPtr appId);

        /// <summary>Reads a string vconf key and frees the native buffer, returning empty string when unset or unavailable.</summary>
        public static string VconfGetString(string key)
        {
            IntPtr ptr = IntPtr.Zero;
            try
            {
                ptr = vconf_get_str(key);
                if (ptr == IntPtr.Zero) return "";
                return Marshal.PtrToStringUTF8(ptr) ?? "";
            }
            catch (Exception) { return ""; }
            finally { if (ptr != IntPtr.Zero) Libc.free(ptr); }
        }

        /// <summary>Name of the evas engine in use, or null when it cannot be read.</summary>
        public static string EngineName(IntPtr evas)
        {
            try
            {
                IntPtr ee = ecore_evas_ecore_evas_get(evas);
                if (ee == IntPtr.Zero) return null;
                return Marshal.PtrToStringAnsi(ecore_evas_engine_name_get(ee));
            }
            catch (Exception) { return null; }
        }
    }
}
