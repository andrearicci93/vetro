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
- Actions use Cobalto (`--vetro-action`) with light text; Luce (`--vetro-blue-400`) is for details and the progress bar. Links and focus use `--vetro-link`.
- Controls are 44 px high with an 8 px radius; surfaces have a 16 px radius. Focus is a 2 px ring, 3 px away.
- Glass and gradients are for small overlays and brand moments only. Everyday surfaces are solid.
- **Never a coloured top border on a rounded card**: a thicker line on top makes coloured "ears" at the corners. Give a card a theme colour with a faint background, a uniform border and a coloured label or icon.
- A switch is a **win**: its title says what you get ("Disable HbbTV", "Disable automatic firmware update"), and *on* means the win is applied. A chip under the title says *Done* or *Partly done*, in plain words.
- Copy is English, short, and says what changes on the TV. A feature that is not finished carries a **Beta** chip.
