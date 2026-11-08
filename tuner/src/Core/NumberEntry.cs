using System;

namespace Tuner.Core
{
    /// <summary>What a press on the on-screen number pad does.</summary>
    internal enum PadAction { None, Digit, Delete, Go }

    /// <summary>
    /// The on-screen number pad (the remote has no digit keys): a 4x3 grid, 1-9 then Delete, 0, Go, moved with the arrows.
    /// Pure logic, no drawing. The number being typed is <see cref="Text"/>, at most <see cref="MaxDigits"/> digits.
    /// </summary>
    internal sealed class NumberEntry
    {
        public const int Rows = 4, Cols = 3, MaxDigits = 4;
        private static readonly string[] Labels = { "1", "2", "3", "4", "5", "6", "7", "8", "9", "Delete", "0", "Go" };

        public string Text { get; private set; }
        public int Row { get; private set; }
        public int Col { get; private set; }

        /// <summary>True while the number was typed on a real digit key and the on-screen selection has not been touched since:
        /// OK then means "go", not "press the selected on-screen key".</summary>
        public bool Typed { get; private set; }

        public NumberEntry() { Reset(); }

        /// <summary>Back to an empty number with the selection on the 5, the middle of the grid.</summary>
        public void Reset() { Text = ""; Row = 1; Col = 1; Typed = false; }

        public static string Label(int row, int col) { return Labels[row * Cols + col]; }
        public string SelectedLabel { get { return Label(Row, Col); } }

        /// <summary>Moves the selection; it wraps at the edges.</summary>
        public void Move(int dRow, int dCol)
        {
            Typed = false;
            Row = ((Row + dRow) % Rows + Rows) % Rows;
            Col = ((Col + dCol) % Cols + Cols) % Cols;
        }

        /// <summary>Adds a digit typed on a real remote (or pressed on the pad). Ignored when the number is full.</summary>
        public void AddDigit(int digit)
        {
            if (digit < 0 || digit > 9 || Text.Length >= MaxDigits) return;
            Text += (char)('0' + digit);
        }

        /// <summary>A digit typed on a real remote's number keys.</summary>
        public void TypeDigit(int digit) { AddDigit(digit); Typed = Text.Length > 0; }

        public void Delete() { if (Text.Length > 0) Text = Text.Substring(0, Text.Length - 1); }

        /// <summary>OK on the selected key. A digit is added, Delete removes one, Go leaves the number to the caller.</summary>
        public PadAction Press()
        {
            Typed = false;
            string label = SelectedLabel;
            if (label == "Delete") { Delete(); return PadAction.Delete; }
            if (label == "Go") return PadAction.Go;
            AddDigit(label[0] - '0');
            return PadAction.Digit;
        }

        /// <summary>The typed number, or 0 when nothing (or only zeros) was typed.</summary>
        public int Value
        {
            get { int v; return int.TryParse(Text, out v) ? v : 0; }
        }
    }
}
