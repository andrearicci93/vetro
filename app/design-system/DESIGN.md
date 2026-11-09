# Vetro design system

The single record of how Vetro looks. Open `index.html` in a browser to see it; `tokens.css` holds the values.

| File | What it is |
| --- | --- |
| `tokens.css` | Every colour, size, radius and duration, as `--vetro-*` custom properties. Dark by default; `data-vetro-theme="light"` on a container switches to light. Reduced motion sets both durations to 0. |
| `index.html` | A reference page that renders the palette, gradients, both themes and the rhythm from `tokens.css`. |
| `icon-reference.png` | The app icon the palette was sampled from (the same picture as `app/icon.png`). |

## Where it is used

- **Dashboard** (`app/service/dashboard.js`): the token block is copied into the page's `:root`, then short names (`--bg`, `--surface`, `--border`, `--accent`…) point at it. `app/tests/dashboard-v2.test.cjs` fails if the page and `tokens.css` drift apart, so change `tokens.css` first and then the page.
- **Icon**: `app/icon.png` is the app icon. The service serves it at `/icon.png`; the dashboard shows it in the sidebar and as the page icon.
- **Launcher** (`dock/`): it has its own look, chosen in `dock/designer` and recorded in `dock/designer/chosen.json`. `dock/src/Core/Design.cs` is the single source for the native code. Its colours follow the icons it shows, not these tokens.

## Rules

- About 80% of the interface stays neutral (`--vetro-bg`, `--vetro-surface`, `--vetro-border`). Blue marks actions and selections.
- Form fields and ordinary controls use `--vetro-control-border` for a boundary with at least 3:1 contrast against the adjacent surfaces; `--vetro-border` stays quiet on decorative separators.
- Warning confirmations pair `--vetro-warning` with `--vetro-on-warning`, including on hover.
- Actions use Cobalto (`--vetro-action`) with light text; Luce (`--vetro-blue-400`) is for details and the progress bar. Links and focus use `--vetro-link`.
- Dashboard type uses the system sans at 16 px for body/form input, 14 px for secondary explanations and dense navigation/tables, 18 px for section headings and 24 px for page titles, all through rem-based tokens. Prose uses a 56ch maximum (tuned to about 65–80 rendered characters in the system face) and 1.6 line height; code and package identifiers keep the system monospace.
- Controls are at least 44 px high with an 8 px radius; surfaces have a 16 px radius. Focus is a 2 px ring, 3 px away.
- Glass and gradients are for small overlays and brand moments only. Everyday surfaces are solid.
- **Never a coloured top border on a rounded card**: a thicker line on top makes coloured "ears" at the corners. Give a card a theme colour with a faint background, a uniform border and a coloured label or icon.
- A switch is a **win**: its title says what you get ("Disable HbbTV", "Disable automatic firmware update"), and *on* means the win is applied. A chip under the title says *Done* or *Partly done*, in plain words.
- Copy is English, short, and says what changes on the TV. A feature that is not finished carries a **Beta** chip.
- The mobile navigation sheet and details drawer isolate background controls while open, contain keyboard focus and return it on dismissal. Sidebar navigation exposes the current page; segmented views expose their pressed state.
- Under 620 px the sidebar becomes a sheet: a top bar with the brand and a **Menu** button opens it, so every page, the service state and Sign out stay reachable. Tab rows and filter chips scroll sideways and run to the screen edge, which shows there is more.

## Character and feedback

Vetro should feel like a precise glass remote: light catches at the point of control, and feedback follows confirmed device state. The sidebar footer shows the version only; the app count and the connection line are gone. Purpose icons help scan Quick settings. A captured remote key gains a keycap treatment; completed actions use a quiet checkmark, while uncertain results retain the warning treatment and history. Reduced motion keeps all state cues without movement. No sounds, invented progress, or new runtime assets are introduced.

## Layout

General settings pair Software update and Storage only when the content area can fit two columns of at least `--vetro-column-min` (26rem). Firmware, Restore and Remove stay full width, in DOM and keyboard order. Columns return to a linear flow as the container narrows or text grows; cards have no fixed heights or masonry reordering. Quick settings section headings and content use 12px internal spacing, with 24px between the main General groups. The lengthy removal procedure is a native disclosure; its open state and focus survive view refreshes, and restoration/deletion controls remain outside it. The Launcher preview follows the same content-width column rule. Live sampling controls wrap without widening the page.

## Device adaptation

Compact navigation applies below 620px and on coarse-pointer views up to 1000px wide with at most 500px height (landscape phones). Wider tablets and pointer-driven desktop windows retain the sidebar, whose width scales within bounds with the text; landscape phones keep the wider form/table layout rather than inheriting every narrow-screen rule. Navigation CSS and focus-return logic use the same condition. Fixed navigation and detail panels follow the dynamic viewport, leave room for safe-area insets, and retain a reachable close control. Coarse-pointer disclosure summaries have 44px minimum targets. Resource metrics collapse to one column when the dashboard container is narrower than 17rem, including enlarged text. Browser/keyboard and physical-device coverage must be reported separately.

## TV material (Fumé)

The TV screens (dock, volume pill, number pad, tuner banner/list/guide/toast, the Vetro page on the TV) share one material, with its values in the second `:root` block of `tokens.css` (`--vetro-tv-*`, not used by the dashboard): a **smoked sheet** `#243448`, fully opaque, 2 px white border at 22%, radius **16** (chips, keys, rings **12**; capsules only for the volume pill, the pad, switches and tracks). **Focus** is a 2 px ice ring `#E4F2FF`. **Light** `#A5D8FF` is for progress and indicators only (the volume level, the tuner's progress bars, a switch that is on, the guide's "now" mark). Text is white at 100 / 70 / 55%; a resting chip is white at 20% over the sheet (on air and focus 26%, selected row 30%). Safe margin 96 px on every side (the guide's sheet keeps 64). The volume pill is one component with a Position setting (left, right, top, bottom; default left). Native values live in `dock/src/Core/Design.cs` and `dock/designer/chosen.json`, the tuner's in `tuner/src/Ui/Surface.cs` and `tuner/src/Core/GuideScene.cs`; the mock-ups are in `graphic-testing/design-system/tv-system.html`.
