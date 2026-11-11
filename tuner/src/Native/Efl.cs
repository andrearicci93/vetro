using System;
using System.Runtime.InteropServices;

namespace Tuner.Native
{
    /// <summary>
    /// The part of the Tizen EFL stack (EFL 1.25, shipped on the TV) that the tuner calls. Signatures follow the C headers:
    /// Eina_Bool is an unsigned char, so callbacks return byte and boolean arguments are marshalled as U1.
    /// Only what is used is declared; the dock keeps the larger set (images, raw pixels, app launching).
    /// </summary>
    internal static class Efl
    {
        private const string Elm = "libelementary.so.1";
        private const string Evas = "libevas.so.1";
        private const string Ecore = "libecore.so.1";
        private const string EcoreEvas = "libecore_evas.so.1";
        private const string EflUtil = "libcapi-ui-efl-util.so.0";

        public const int ElmWinNotification = 12;
        public const int EcoreFdRead = 1;

        // The GC must not collect a callback the native side still holds: owners keep the delegates in static fields.
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate byte TaskCb(IntPtr data);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate byte FdCb(IntPtr data, IntPtr handler);

        // --- elementary: main loop and window ---
        [DllImport(Elm)] public static extern int elm_init(int argc, IntPtr argv);
        [DllImport(Elm)] public static extern void elm_run();
        [DllImport(Elm)] public static extern void elm_exit();
        [DllImport(Elm)] public static extern void elm_shutdown();
        [DllImport(Elm)] public static extern IntPtr elm_win_add(IntPtr parent, string name, int type);
        [DllImport(Elm)] public static extern void elm_win_title_set(IntPtr win, string title);
        [DllImport(Elm)] public static extern void elm_win_alpha_set(IntPtr win, [MarshalAs(UnmanagedType.U1)] bool alpha);
        [DllImport(Elm)] public static extern void elm_win_borderless_set(IntPtr win, [MarshalAs(UnmanagedType.U1)] bool borderless);
        [DllImport(Elm)] public static extern void elm_win_layer_set(IntPtr win, int layer);
        [DllImport(Elm)] public static extern int elm_win_aux_hint_add(IntPtr win, string hint, string val);
        [DllImport(Elm)] public static extern void elm_win_activate(IntPtr win);
        [DllImport(Elm)] public static extern void elm_win_raise(IntPtr win);

        // --- evas: objects and text ---
        [DllImport(Evas)] public static extern IntPtr evas_object_evas_get(IntPtr obj);
        [DllImport(Evas)] public static extern void evas_object_move(IntPtr obj, int x, int y);
        [DllImport(Evas)] public static extern void evas_object_resize(IntPtr obj, int w, int h);
        [DllImport(Evas)] public static extern void evas_object_show(IntPtr obj);
        [DllImport(Evas)] public static extern void evas_object_hide(IntPtr obj);
        [DllImport(Evas)] public static extern void evas_object_color_set(IntPtr obj, int r, int g, int b, int a);
        [DllImport(Evas)] public static extern IntPtr evas_object_rectangle_add(IntPtr evas);
        [DllImport(Evas)] public static extern IntPtr evas_object_text_add(IntPtr evas);
        [DllImport(Evas)] public static extern void evas_object_text_font_set(IntPtr txt, string font, int size);
        [DllImport(Evas)] public static extern void evas_object_text_text_set(IntPtr txt, string text);
        [DllImport(Evas)] public static extern int evas_object_text_horiz_advance_get(IntPtr txt);
        [DllImport(Evas)] public static extern void evas_object_clip_set(IntPtr obj, IntPtr clip);
        // Read back by the transitions (Ui/Anim.cs): where an object is, its colour (premultiplied) and whether it is shown (Eina_Bool).
        [DllImport(Evas)] public static extern void evas_object_geometry_get(IntPtr obj, out int x, out int y, out int w, out int h);
        [DllImport(Evas)] public static extern void evas_object_color_get(IntPtr obj, out int r, out int g, out int b, out int a);
        [DllImport(Evas)] public static extern byte evas_object_visible_get(IntPtr obj);
        // The halo under the text of the Banner and Info (the dock's soft shadow): style, then the shadow's colour (premultiplied).
        public const int EvasTextStyleSoftShadow = 8;
        [DllImport(Evas)] public static extern void evas_object_text_style_set(IntPtr txt, int style);
        [DllImport(Evas)] public static extern void evas_object_text_shadow_color_set(IntPtr txt, int r, int g, int b, int a);

        // --- evas: images (the glass pictures are 9-slice PNGs shared with the dock) ---
        public const int EvasLoadErrorNone = 0;
        [DllImport(Evas)] public static extern IntPtr evas_object_image_add(IntPtr evas);
        // Returns void in C: success is read back with evas_object_image_load_error_get.
        [DllImport(Evas)] public static extern void evas_object_image_file_set(IntPtr img, string file, string key);
        [DllImport(Evas)] public static extern int evas_object_image_load_error_get(IntPtr img);
        [DllImport(Evas)] public static extern void evas_object_image_filled_set(IntPtr img, [MarshalAs(UnmanagedType.U1)] bool filled);
        [DllImport(Evas)] public static extern void evas_object_image_border_set(IntPtr img, int l, int r, int t, int b);
        // Draws the border at scale x its size in the picture: one capsule PNG gives every radius (the dock's pill_* pictures).
        [DllImport(Evas)] public static extern void evas_object_image_border_scale_set(IntPtr img, double scale);
        [DllImport(Evas)] public static extern void evas_object_image_border_center_fill_set(IntPtr img, int mode);
        [DllImport(Evas)] public static extern void evas_object_image_smooth_scale_set(IntPtr img, [MarshalAs(UnmanagedType.U1)] bool smooth);
        // With filled off, the picture is repeated at this size over the object (the guide's "no information" stripes).
        [DllImport(Evas)] public static extern void evas_object_image_fill_set(IntPtr img, int x, int y, int w, int h);

        // --- evas: maps (a uniform zoom of a text while it flies to a text of another size; DESIGN.md: zoom maps cost nothing visible) ---
        // The map is populated from the object's own geometry (so its picture covers the whole object), then its four corners are moved.
        [DllImport(Evas)] public static extern IntPtr evas_map_new(int count);
        [DllImport(Evas)] public static extern void evas_map_free(IntPtr map);
        [DllImport(Evas)] public static extern void evas_map_util_points_populate_from_geometry(IntPtr map, int x, int y, int w, int h, int z);
        [DllImport(Evas)] public static extern void evas_map_point_coord_set(IntPtr map, int idx, int x, int y, int z);
        [DllImport(Evas)] public static extern void evas_object_map_set(IntPtr obj, IntPtr map);
        [DllImport(Evas)] public static extern void evas_object_map_enable_set(IntPtr obj, [MarshalAs(UnmanagedType.U1)] bool enabled);

        // --- ecore: timers, the animator (one tick a frame) and file descriptors ---
        [DllImport(Ecore)] public static extern double ecore_time_get();
        [DllImport(Ecore)] public static extern IntPtr ecore_animator_add(TaskCb func, IntPtr data);
        [DllImport(Ecore)] public static extern IntPtr ecore_animator_del(IntPtr animator);
        [DllImport(Ecore)] public static extern IntPtr ecore_timer_add(double inSeconds, TaskCb func, IntPtr data);
        [DllImport(Ecore)] public static extern IntPtr ecore_timer_del(IntPtr timer);
        [DllImport(Ecore)] public static extern IntPtr ecore_main_fd_handler_add(int fd, int flags, FdCb func, IntPtr data, IntPtr bufFunc, IntPtr bufData);
        [DllImport(Ecore)] public static extern IntPtr ecore_main_fd_handler_del(IntPtr handler);

        // --- platform ---
        [DllImport(EcoreEvas)] private static extern IntPtr ecore_evas_ecore_evas_get(IntPtr evas);
        [DllImport(EcoreEvas)] private static extern IntPtr ecore_evas_engine_name_get(IntPtr ee);
        [DllImport(EflUtil)] public static extern int efl_util_set_notification_window_level(IntPtr win, int level);

        // The application manager's state of one app (libaul): 2 focus, 3 visible, 4 background, negative = not answered. Used by the takeover.
        [DllImport("libaul.so.0")] public static extern int aul_app_get_status(string appId);

        /// <summary>Name of the evas engine in use, or null when it cannot be read.</summary>
        public static string EngineName(IntPtr evas)
        {
            try
            {
                IntPtr ee = ecore_evas_ecore_evas_get(evas);
                return ee == IntPtr.Zero ? null : Marshal.PtrToStringAnsi(ecore_evas_engine_name_get(ee));
            }
            catch (Exception) { return null; }
        }
    }
}
