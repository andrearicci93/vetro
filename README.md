# Vetro guides site

Source of https://andrearicci93.github.io/vetro/ . A small static generator (no framework): Markdown articles in `content/<section>/<slug>.md`, planned pages in `data/manifest.json`, tested TVs in `data/tvs.json`, templates and SEO metadata in `build.mjs`, styles in `src/site.css`.

```sh
npm install
npm run build        # writes dist/, sitemap.xml, robots.txt, llms.txt, rss.xml
```

Environment: `SITE_ORIGIN` (default `https://andrearicci93.github.io`) and `SITE_BASE` (default `/vetro`, use an empty string for a root domain). The build turns links to pages that do not exist into plain text and reports them.

Deployment: the contents of `dist/` are published from the `gh-pages` branch.
