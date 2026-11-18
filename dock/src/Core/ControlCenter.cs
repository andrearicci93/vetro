using System;
using System.Collections.Generic;

namespace Launcher.Core
{
    /// <summary>The cards the Control center can hold. Each is switched on in Vetro's dashboard; the order there is the order on screen.
    /// <see cref="Shard"/>: a card a Shard (a third-party plugin) adds; there may be several, one per Shard.</summary>
    internal enum CardKind { Tasks, Audio, Picture, Sleep, Shard }

    /// <summary>One card of the Control center: its kind and, for a Shard card, the Shard's id and the card's title.</summary>
    internal sealed class CardSpec
    {
        public CardKind Kind;
        public string ShardId;
        public string Label;

        public CardSpec(CardKind kind) { Kind = kind; }

        public override string ToString() { return Kind == CardKind.Shard ? "Shard:" + ShardId : Kind.ToString(); }
    }

    /// <summary>
    /// Which cards the Control center shows (Down on the apps row), from the dock's command line: <c>--cards tasks,audio</c>. At most
    /// <see cref="TaskLayout.MaxCards"/>, each once, unknown names skipped (a newer Vetro may know more cards than this dock). A Shard's card is
    /// <c>shard:&lt;id&gt;</c> or <c>shard:&lt;id&gt;:&lt;label&gt;</c>, the label escaped as <see cref="ShardCard.DecodeLabel"/> reads it (a bad
    /// one gives the id); each Shard once. Without <c>--cards</c> the older switch still works: the Task manager alone, unless <c>--no-tasks</c>.
    /// Pure, so it is tested without a TV.
    /// </summary>
    internal static class ControlCenter
    {
        public static CardSpec[] Parse(string cards, bool noTasks)
        {
            if (cards == null) return noTasks ? new CardSpec[0] : new[] { new CardSpec(CardKind.Tasks) };
            var list = new List<CardSpec>();
            foreach (string raw in cards.Split(','))
            {
                CardSpec card = TryToken(raw.Trim());
                if (card == null || list.Exists(c => c.Kind == card.Kind && (card.Kind != CardKind.Shard || c.ShardId == card.ShardId))) continue;
                list.Add(card);
                if (list.Count == TaskLayout.MaxCards) break;
            }
            return list.ToArray();
        }

        private static CardSpec TryToken(string name)
        {
            switch (name)
            {
                case "tasks": return new CardSpec(CardKind.Tasks);
                case "audio": return new CardSpec(CardKind.Audio);
                case "picture": return new CardSpec(CardKind.Picture);
                case "sleep": return new CardSpec(CardKind.Sleep);
            }
            if (!name.StartsWith("shard:", StringComparison.Ordinal)) return null;
            string rest = name.Substring(6);
            int colon = rest.IndexOf(':');
            string id = colon < 0 ? rest : rest.Substring(0, colon);
            if (!ShardCard.ValidId(id)) return null;
            string label = colon < 0 ? null : ShardCard.DecodeLabel(rest.Substring(colon + 1));
            return new CardSpec(CardKind.Shard) { ShardId = id, Label = label ?? id };
        }

        /// <summary>The hint under the apps row: the card's own name when there is one card, "Control center" for more.</summary>
        public static string HintText(CardSpec[] cards)
        {
            if (cards == null || cards.Length == 0) return null;
            if (cards.Length > 1) return "Control center";
            return Title(cards[0]);
        }

        public static string HintText(CardKind[] cards)
        {
            return cards == null ? null : HintText(Array.ConvertAll(cards, k => new CardSpec(k)));
        }

        /// <summary>A card's title: a Shard card's is its label.</summary>
        public static string Title(CardSpec card)
        {
            return card.Kind == CardKind.Shard ? card.Label ?? card.ShardId : Title(card.Kind);
        }

        public static string Title(CardKind card)
        {
            switch (card)
            {
                case CardKind.Audio: return "Audio output";
                case CardKind.Picture: return "Picture mode";
                case CardKind.Sleep: return "Sleep timer";
                case CardKind.Shard: return "Shard";
                default: return Design.TasksHintText;
            }
        }

        /// <summary>Left or Right from card <paramref name="focus"/> of <paramref name="count"/>: the card beside it, or the same one at the ends.</summary>
        public static int Move(int focus, int count, int step)
        {
            int next = focus + step;
            return next < 0 || next >= count ? focus : next;
        }
    }
}
