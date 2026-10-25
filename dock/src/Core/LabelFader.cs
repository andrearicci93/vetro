using System;

namespace Launcher.Core
{
    /// <summary>
    /// Decides what the two label objects show. The label does not travel with the focus: the name under the
    /// icon being left fades out quickly where it is, and the name of the icon being reached fades in at its own
    /// place a moment later.
    /// Slots are kept by item, so a name is never re-typed while it is still visible; when the target goes back
    /// to the item that is still fading out, that very slot is reused. No EFL types: unit-testable.
    /// </summary>
    internal sealed class LabelFader
    {
        /// <summary>Item shown by each slot (-1 for none) and how visible it is (0..1, before the page's own presence).</summary>
        public readonly int[] Index = { -1, -1 };
        public readonly float[] Weight = new float[2];
        /// <summary>Bit k is set when slot k was given a new item since <see cref="ClearDirty"/>: its text must be set.</summary>
        public int Dirty { get; private set; }
        public int TargetSlot { get; private set; }

        /// <summary>
        /// The old name is gone after the focus has covered the first <c>OutEnd</c> of the way to the next icon, and the
        /// new one only starts to appear after <c>InStart</c> of it: the two never overlap, so no name trails behind.
        /// </summary>
        public const float OutEnd = 0.3f, InStart = 0.5f;

        private int _target = -1, _leaveSlot = -1, _leaveIndex = -1;

        private static float Smooth(float t)
        {
            if (t <= 0f) return 0f;
            if (t >= 1f) return 1f;
            return t * t * (3f - 2f * t);
        }

        public void ClearDirty() { Dirty = 0; }

        /// <summary>The names changed from outside (an item became or stopped being the current one): start over.</summary>
        public void Invalidate()
        {
            _target = -1; _leaveSlot = -1; _leaveIndex = -1;
            Index[0] = Index[1] = -1;
            Weight[0] = Weight[1] = 0f;
        }

        public void Update(int target, float focusPos)
        {
            if (target != _target)
            {
                if (_target < 0)
                {
                    TargetSlot = 0; Index[0] = target; Dirty |= 1;
                    _leaveSlot = -1; _leaveIndex = -1;
                }
                else
                {
                    int s = Index[0] == target ? 0 : (Index[1] == target ? 1 : -1);
                    int oldSlot = TargetSlot, oldIndex = _target;
                    if (s < 0) { s = 1 - oldSlot; Index[s] = target; Dirty |= 1 << s; }
                    _leaveSlot = oldSlot; _leaveIndex = oldIndex;
                    TargetSlot = s;
                }
                _target = target;
            }
            int other = 1 - TargetSlot;
            Weight[TargetSlot] = Smooth((DockLayout.Amount(focusPos, _target) - InStart) / (1f - InStart));
            Weight[other] = _leaveSlot == other ? Smooth((DockLayout.Amount(focusPos, _leaveIndex) - (1f - OutEnd)) / OutEnd) : 0f;
        }
    }
}
