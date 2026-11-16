using System;
using System.Collections.Generic;

namespace Launcher.Core
{
    /// <summary>The cards the Control center can hold. Each is switched on in Vetro's dashboard; the order there is the order on screen.</summary>
    internal enum CardKind { Tasks, Audio }

    /// <summary>
    /// Which cards the Control center shows (Down on the apps row), from the dock's command line: <c>--cards tasks,audio</c>. At most
    /// <see cref="TaskLayout.MaxCards"/>, each once, unknown names skipped (a newer Vetro may know more cards than this dock). Without
    /// <c>--cards</c> the older switch still works: the Task manager alone, unless <c>--no-tasks</c>. Pure, so it is tested without a TV.
    /// </summary>
    internal static class ControlCenter
    {
        public static CardKind[] Parse(string cards, bool noTasks)
        {
            if (cards == null) return noTasks ? new CardKind[0] : new[] { CardKind.Tasks };
            var list = new List<CardKind>();
            foreach (string raw in cards.Split(','))
            {
                CardKind kind;
                if (!TryName(raw.Trim(), out kind) || list.Contains(kind)) continue;
                list.Add(kind);
                if (list.Count == TaskLayout.MaxCards) break;
            }
            return list.ToArray();
        }

        private static bool TryName(string name, out CardKind kind)
        {
            switch (name)
            {
                case "tasks": kind = CardKind.Tasks; return true;
                case "audio": kind = CardKind.Audio; return true;
            }
            kind = CardKind.Tasks;
            return false;
        }

        /// <summary>The hint under the apps row: the card's own name when there is one card, "Control center" for more.</summary>
        public static string HintText(CardKind[] cards)
        {
            if (cards == null || cards.Length == 0) return null;
            if (cards.Length > 1) return "Control center";
            return cards[0] == CardKind.Tasks ? Design.TasksHintText : "Audio output";
        }

        /// <summary>Left or Right from card <paramref name="focus"/> of <paramref name="count"/>: the card beside it, or the same one at the ends.</summary>
        public static int Move(int focus, int count, int step)
        {
            int next = focus + step;
            return next < 0 || next >= count ? focus : next;
        }
    }
}
