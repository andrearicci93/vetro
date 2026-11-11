using System;
using System.Runtime.InteropServices;

namespace Tuner.Native
{
    /// <summary>
    /// The few calls of the firmware's SQLite (libsqlite3.so.0) the tuner uses to read the channel logos' table, read-only.
    /// The database belongs to another app; nothing here ever writes to it.
    /// </summary>
    internal static class Sqlite
    {
        private const string Lib = "libsqlite3.so.0";

        public const int Ok = 0, Row = 100, Done = 101, OpenReadOnly = 1;

        [DllImport(Lib)] public static extern int sqlite3_open_v2(string filename, out IntPtr db, int flags, IntPtr vfs);
        [DllImport(Lib)] public static extern int sqlite3_busy_timeout(IntPtr db, int ms);
        [DllImport(Lib)] public static extern int sqlite3_prepare_v2(IntPtr db, string sql, int nByte, out IntPtr stmt, IntPtr tail);
        [DllImport(Lib)] public static extern int sqlite3_step(IntPtr stmt);
        [DllImport(Lib)] private static extern IntPtr sqlite3_column_text(IntPtr stmt, int col);
        [DllImport(Lib)] public static extern int sqlite3_finalize(IntPtr stmt);
        [DllImport(Lib)] public static extern int sqlite3_close(IntPtr db);

        /// <summary>Column text as a string ("" for NULL).</summary>
        public static string Text(IntPtr stmt, int col)
        {
            IntPtr p = sqlite3_column_text(stmt, col);
            return p == IntPtr.Zero ? "" : Marshal.PtrToStringUTF8(p) ?? "";
        }
    }
}
