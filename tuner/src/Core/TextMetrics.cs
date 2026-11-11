using System;

namespace Tuner.Core
{
    /// <summary>
    /// Where Evas really puts a SamsungOneUI text, so that views can place texts by their baseline without a getter. Pure, tested.
    ///
    /// Measured on the Q80A (firmware 2310.0, Evas 1.25.1, 2026-11-11) from screen dumps of the Banner and Info:
    /// - Evas draws a text with its baseline at y + max ascent, and takes max ascent and descent from the font's bounding box
    ///   (head.yMax 1047, head.yMin -304 per 1024), not from hhea (952 / -276): a 128 px number sat 12 px lower than hhea predicts;
    /// - a text with the EVAS soft shadow (shadow 1 px to the bottom right, blur 2) is padded by 1 px on the left and the top
    ///   (3 on the right and the bottom), so its letters start at (x + 1, y + 1 + max ascent);
    /// - a font name with a fallback list ("SamsungOneUI 200,Sans") is handed to fontconfig as ONE family name, which does not exist,
    ///   so every weight came out as the default SamsungOneUI 400. A single family name ("SamsungOneUI 200") resolves to its own file.
    /// The HTML mock-ups are drawn by a browser, which centres hhea's line (952 / 276) in a line box as tall as the font size: a mock-up's
    /// y is turned into a baseline with those.
    /// </summary>
    internal static class TextMetrics
    {
        public const string Font200 = "SamsungOneUI 200", Font500 = "SamsungOneUI 500", Font600 = "SamsungOneUI 600";
        public const int Em = 1024, Ascender = 1047, Descender = 304, MockAscender = 952, MockDescender = 276;
        /// <summary>Height of the capitals and the digits (OS/2 sCapHeight): what "vertically centred" centres.</summary>
        public const int CapHeight = 724;
        /// <summary>The soft shadow's padding on the left and the top of a text object.</summary>
        public const int HaloPad = 1;

        /// <summary>Evas's max ascent of a text of this size: its baseline, below the object's top, without style padding.</summary>
        public static int Ascent(int size) { return (int)Math.Round((double)Ascender * size / Em); }
        /// <summary>Evas's vertical advance (max ascent + max descent), what evas_object_text_vert_advance_get gives on the TV.</summary>
        public static int LineHeight(int size) { return Ascent(size) + (int)Math.Round((double)Descender * size / Em); }
        /// <summary>The baseline of a text whose mock-up line box (line height = font size) starts at <paramref name="top"/>.</summary>
        public static double Baseline(int top, int size) { return top + size * (double)(Em + MockAscender - MockDescender) / (2 * Em); }
        /// <summary>The y that puts a text of this size on <paramref name="baseline"/>; padTop = HaloPad for a text with the soft shadow.</summary>
        public static int TopFor(double baseline, int size, int padTop = 0) { return (int)Math.Floor(baseline - Ascent(size) - padTop + 0.5); }
        /// <summary>The y of a text the mock-up puts at line-box top <paramref name="top"/> (same baseline).</summary>
        public static int TopOf(int top, int size, int padTop = 0) { return TopFor(Baseline(top, size), size, padTop); }
        /// <summary>The y that centres the capitals and digits of a text of this size in a box (a key, a row, a capsule).</summary>
        public static int TopForCentre(int boxTop, int boxH, int size, int padTop = 0) { return TopFor(boxTop + boxH / 2.0 + CapHeight * (double)size / (2 * Em), size, padTop); }
        /// <summary>Where the baseline of a text ends up on the screen when its object is at <paramref name="y"/>.</summary>
        public static int DrawnBaseline(int y, int size, int padTop = 0) { return y + padTop + Ascent(size); }
    }
}
