namespace Launcher.Core
{
    /// <summary>Which screen edge the volume pill sits on. Left and Right make it vertical, Top and Bottom horizontal.</summary>
    internal enum VolumeEdge { Left, Right, Top, Bottom }

    /// <summary>
    /// Where every part of the volume pill goes, for one edge and one screen size. Pure geometry (no EFL), so it is tested without a TV.
    /// One component in four places: a capsule body, a capsule track that fills (from the foot when vertical, from the left when
    /// horizontal), a speaker icon and the level as a number. The body keeps the 96 px safe margin from the edge it sits on
    /// and is centred on the other axis. The window is the body plus <see cref="Pad"/> px on every side, so the thin light edge
    /// (drawn 2 px outside the body) is never cut.
    /// </summary>
    internal sealed class VolumePlacement
    {
        public const int Margin = 96;
        public const int Pad = 4;
        public const int Thickness = 88, LongVertical = 480, LongHorizontal = 640;
        public const int Inset = 12, IconSize = 40, NumberSize = 32;
        public const int NumberBand = 56, IconBand = 64;      // vertical: room above the track for the number and below it for the icon
        public const int HIconX = 24, HTrackX = 80, HNumberRoom = 100, HNumberRight = 28;

        public bool Vertical;
        /// <summary>Window and parts, all in screen pixels.</summary>
        public int WinX, WinY, WinW, WinH;
        public int BodyX, BodyY, BodyW, BodyH;
        public int TrackX, TrackY, TrackW, TrackH;
        public int IconX, IconY;
        /// <summary>The number sits centred on this point (vertical) or ends at <see cref="NumberRight"/> (horizontal).</summary>
        public int NumberCenterX, NumberCenterY, NumberRight;

        public static VolumeEdge ParseEdge(string text)
        {
            switch ((text ?? "").Trim().ToLowerInvariant())
            {
                case "right": return VolumeEdge.Right;
                case "top": return VolumeEdge.Top;
                case "bottom": return VolumeEdge.Bottom;
                default: return VolumeEdge.Left;
            }
        }

        public static VolumePlacement For(VolumeEdge edge, int screenW, int screenH)
        {
            var p = new VolumePlacement();
            p.Vertical = edge == VolumeEdge.Left || edge == VolumeEdge.Right;
            p.BodyW = p.Vertical ? Thickness : LongHorizontal;
            p.BodyH = p.Vertical ? LongVertical : Thickness;
            p.BodyX = edge == VolumeEdge.Left ? Margin : edge == VolumeEdge.Right ? screenW - Margin - p.BodyW : (screenW - p.BodyW) / 2;
            p.BodyY = edge == VolumeEdge.Top ? Margin : edge == VolumeEdge.Bottom ? screenH - Margin - p.BodyH : (screenH - p.BodyH) / 2;
            p.WinX = p.BodyX - Pad; p.WinY = p.BodyY - Pad; p.WinW = p.BodyW + 2 * Pad; p.WinH = p.BodyH + 2 * Pad;
            if (p.Vertical)
            {
                p.TrackX = p.BodyX + Inset; p.TrackW = p.BodyW - 2 * Inset;
                p.TrackY = p.BodyY + NumberBand; p.TrackH = p.BodyH - NumberBand - IconBand - Inset;
                p.IconX = p.BodyX + (p.BodyW - IconSize) / 2; p.IconY = p.BodyY + p.BodyH - Inset - IconSize - 6;
                p.NumberCenterX = p.BodyX + p.BodyW / 2; p.NumberCenterY = p.BodyY + NumberBand / 2 + 4;
            }
            else
            {
                p.IconX = p.BodyX + HIconX; p.IconY = p.BodyY + (p.BodyH - IconSize) / 2;
                p.TrackX = p.BodyX + HTrackX; p.TrackY = p.BodyY + Inset;
                p.TrackW = p.BodyW - HTrackX - HNumberRoom; p.TrackH = p.BodyH - 2 * Inset;
                p.NumberRight = p.BodyX + p.BodyW - HNumberRight; p.NumberCenterY = p.BodyY + p.BodyH / 2;
            }
            return p;
        }
    }
}
