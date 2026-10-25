using System;

namespace Launcher.Core
{
    internal enum Phase { Hidden, Showing, Shown, Hiding }

    internal enum KeyAction { None, Moved, Launch, Hide, OpenPanel, Back }

    /// <summary>The apps row is the home page; a Panel page (the inputs) sits one step beside it.</summary>
    internal enum PageKind { Apps, Panel }

    /// <summary>
    /// Dock state machine: visibility phases, focus and its smoothing. No EFL types, so the
    /// whole behaviour is unit-testable on a desktop. <see cref="Tick"/> reports whether
    /// another frame is needed; when it returns false the host must stop its animator so the
    /// process sleeps (no 60 Hz wake-ups while idle or hidden).
    /// </summary>
    internal sealed class Controller
    {
        /// <summary>The bar fades in over this long; each item then takes the same time, starting <see cref="StaggerSeconds"/> after the one before (a cascade).</summary>
        public const double ShowSeconds = Design.EnterSeconds;
        public const double StaggerSeconds = Design.StaggerSeconds;
        public const double HideSeconds = 0.16;
        public const double IdleHideSeconds = 20.0;
        // The focus follows its target like a critically damped spring: it starts gently, never overshoots
        // a rest start, and settles without a tail. The solution is exact, so it does not depend on the frame rate.
        private const float Omega = 22f;        // 1/s; about 0.3 s to settle
        private const float Epsilon = 0.002f;   // focus units (a quarter of a pixel at most)
        private const float RestSpeed = 0.05f;  // focus units per second
        private float _vel;
        // Linear motion: like a CSS transition, every new target restarts a fixed-time run from where the focus is.
        private float _from;
        private double _runT;
        // Seconds since the cascade started, and whether the cascade applies (it does not when a page opens inside a visible dock).
        private double _enter;
        private bool _cascade;

        /// <summary>True: the selection moves at constant speed over <see cref="Design.FocusSeconds"/>; false: the damped spring.</summary>
        public bool Linear { get; set; }

        private readonly DockLayout _layout;

        public PageKind Kind { get; private set; }
        /// <summary>When true, Up on the apps page asks the host to open the panel page.</summary>
        public bool PanelEnabled { get; set; }
        public Phase Phase { get; private set; }

        /// <summary>
        /// Draws a hidden page at a barely visible opacity (about 1%) so a window that is mapped early still makes
        /// the GPU compile and cache its shaders; <see cref="Reset"/> puts it fully away again.
        /// </summary>
        public void HoldFaint(float presence)
        {
            Presence = presence < 0f ? 0f : (presence > 0.05f ? 0.05f : presence);
            _cascade = false; _enter = CascadeSeconds;   // every item at the bar's own opacity, or the warm-up would draw nothing
        }

        /// <summary>Back to the hidden, focus-on-first state (used after the start-up warm-up pass).</summary>
        public void Reset()
        {
            Phase = Phase.Hidden;
            Presence = 0f;
            FocusTarget = 0;
            FocusPos = 0f;
            _vel = 0f;
            _from = 0f; _runT = 0;
            _cascade = false; _enter = 0;
            Scroll = _layout.ScrollFor(0f);
        }
        public int FocusTarget { get; private set; }
        public float FocusPos { get; private set; }
        public float Scroll { get; private set; }
        /// <summary>0 = fully tucked away, 1 = fully shown.</summary>
        public float Presence { get; private set; }

        public Controller(DockLayout layout) : this(layout, PageKind.Apps) { }

        public Controller(DockLayout layout, PageKind kind)
        {
            _layout = layout;
            Kind = kind;
            Phase = Phase.Hidden;
            Linear = Design.LinearMotion;
            Scroll = layout.ScrollFor(0f);
        }

        public int Count { get { return _layout.Count; } }

        public bool IsActive { get { return Phase == Phase.Shown || Phase == Phase.Showing; } }

        /// <summary>Seconds the whole entrance lasts: the bar's fade plus the delay of the last item.</summary>
        private double CascadeSeconds { get { return ShowSeconds + (_layout.Count - 1) * StaggerSeconds; } }

        /// <summary>
        /// Vertical offset of the bar, shadow and divider, in pixels (0 when fully shown). While the cascade runs they
        /// only fade; the items rise one after the other (<see cref="ItemSlide"/>).
        /// </summary>
        public int Slide { get { return _cascade && Phase == Phase.Showing ? 0 : (int)Math.Round((1f - Ease(Presence)) * DockLayout.SlideDistance); } }

        /// <summary>0..1: how far item <paramref name="i"/> has come in. It follows the bar's own presence once the cascade is over (and when hiding).</summary>
        public float ItemPresence(int i)
        {
            double t = (_enter - i * StaggerSeconds) / ShowSeconds;
            float c = t <= 0 ? 0f : (t >= 1 ? 1f : (float)t);
            return Math.Min(Presence, c);
        }

        public int ItemSlide(int i) { return (int)Math.Round((1f - Ease(ItemPresence(i))) * DockLayout.SlideDistance); }

        public static float Ease(float t)
        {
            float u = 1f - (t < 0f ? 0f : (t > 1f ? 1f : t));
            return Design.LinearMotion ? 1f - u : 1f - u * u * u;
        }

        /// <summary>Returns true when the phase changed.</summary>
        public bool Show()
        {
            if (Phase == Phase.Shown || Phase == Phase.Showing) return false;
            // From hidden the items cascade in; turning back from a half-finished hide there is nothing left to stagger.
            _cascade = Phase == Phase.Hidden;
            _enter = _cascade ? 0 : CascadeSeconds;
            Phase = Phase.Showing;
            return true;
        }

        public bool Hide()
        {
            if (Phase == Phase.Hidden || Phase == Phase.Hiding) return false;
            Phase = Phase.Hiding;
            return true;
        }

        public bool Toggle() { return IsActive ? Hide() : Show(); }

        /// <summary>
        /// Takes over the visibility of the page the user is leaving, so switching pages inside a
        /// visible dock does not replay a hide and show. The new page starts a little tucked in
        /// (<paramref name="pop"/>, 0..1) and rises, which reads as the panel opening.
        /// </summary>
        public void AdoptVisibility(Controller from, float pop)
        {
            Phase = from.Phase;
            Presence = from.Presence;
            _cascade = false; _enter = CascadeSeconds;
            if (Phase == Phase.Shown || Phase == Phase.Showing)
            {
                if (Presence > pop) Presence = pop;
                Phase = Phase.Showing;
            }
            from.Phase = Phase.Hidden;
            from.Presence = 0f;
        }

        /// <summary>Moves the focus without animating (used when a page opens on a known item).</summary>
        public void SetFocus(int index)
        {
            if (index < 0) index = 0;
            if (index >= _layout.Count) index = _layout.Count - 1;
            FocusTarget = index;
            FocusPos = index;
            _vel = 0f;
            _from = index; _runT = 0;
            Scroll = _layout.ScrollFor(FocusPos);
        }

        public KeyAction Key(string key, out int launchIndex)
        {
            launchIndex = -1;
            if (key == null || !IsActive) return KeyAction.None;
            switch (key)
            {
                case "Left":
                    // The pills are one column: Left leaves it for the last app.
                    return MoveTo(_layout.IsPinned(FocusTarget) ? _layout.GroupStart - 1 : FocusTarget - 1);
                case "Right":
                    return _layout.IsPinned(FocusTarget) ? KeyAction.None : MoveTo(FocusTarget + 1);
                case "Home":
                    return MoveTo(0);
                case "End":
                    return MoveTo(_layout.Count - 1);
                case "Return":
                case "KP_Enter":
                case "Select":
                    launchIndex = FocusTarget;
                    return KeyAction.Launch;
                case "Up":
                    // Inside the column of pills Up climbs it; from the top one (or an app) it opens the inputs page.
                    if (_layout.IsPinned(FocusTarget) && FocusTarget > _layout.GroupStart) return MoveTo(FocusTarget - 1);
                    return Kind == PageKind.Apps && PanelEnabled ? KeyAction.OpenPanel : KeyAction.None;
                case "Down":
                    if (_layout.IsPinned(FocusTarget)) return MoveTo(FocusTarget + 1);
                    return Kind == PageKind.Panel ? KeyAction.Back : KeyAction.None;
                case "Escape":
                case "XF86Back":
                    return Kind == PageKind.Panel ? KeyAction.Back : KeyAction.Hide;
                case "XF86Home":
                case "XF86Exit":
                    return KeyAction.Hide;
                default:
                    return KeyAction.None;
            }
        }

        private KeyAction MoveTo(int index)
        {
            if (index < 0) index = 0;
            if (index >= _layout.Count) index = _layout.Count - 1;
            if (index == FocusTarget) return KeyAction.None;
            FocusTarget = index;
            _from = FocusPos; _runT = 0;   // a new run for the linear motion, starting wherever the focus is now
            return KeyAction.Moved;
        }

        /// <summary>Advance animations by <paramref name="dt"/> seconds. True while another frame is needed.</summary>
        public bool Tick(double dt)
        {
            if (dt < 0) dt = 0;
            if (dt > 0.1) dt = 0.1;   // a stalled frame must not teleport the animation

            switch (Phase)
            {
                case Phase.Showing:
                    Presence += (float)(dt / ShowSeconds);
                    if (Presence > 1f) Presence = 1f;
                    if (_enter < CascadeSeconds) { _enter += dt; if (_enter > CascadeSeconds) _enter = CascadeSeconds; }
                    if (Presence >= 1f && _enter >= CascadeSeconds) Phase = Phase.Shown;
                    break;
                case Phase.Hiding:
                    Presence -= (float)(dt / HideSeconds);
                    if (Presence <= 0f) { Presence = 0f; Phase = Phase.Hidden; }
                    break;
            }

            float x = FocusPos - FocusTarget;
            if (Linear)
            {
                if (x != 0f)
                {
                    _runT += dt;
                    float u = (float)(_runT / Design.FocusSeconds);
                    FocusPos = u >= 1f ? FocusTarget : _from + (FocusTarget - _from) * u;
                }
            }
            else if (x != 0f || _vel != 0f)
            {
                float e = (float)Math.Exp(-Omega * dt);
                float t = _vel + Omega * x;
                x = (x + t * (float)dt) * e;
                _vel = (_vel - Omega * t * (float)dt) * e;
                if (Math.Abs(x) < Epsilon && Math.Abs(_vel) < RestSpeed) { x = 0f; _vel = 0f; }
                FocusPos = FocusTarget + x;
            }

            Scroll = _layout.ScrollFor(FocusPos);

            return Phase == Phase.Showing || Phase == Phase.Hiding || FocusPos != FocusTarget;
        }
    }
}
