// Static site generator for the Vetro guides. No framework: markdown -> HTML, SEO metadata, sitemap, feeds, link check.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';
import YAML from 'yaml';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = process.env.SITE_ORIGIN || 'https://andrearicci93.github.io';
const BASE = (process.env.SITE_BASE ?? '/vetro').replace(/\/$/, ''); // '' for a root domain
const OUT = path.join(ROOT, 'dist');
const SITE = 'Vetro';
const REPO = 'https://github.com/andrearicci93/vetro';
const TODAY = process.env.SITE_DATE || '2026-11-10';

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/manifest.json'), 'utf8'));
const tvs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tvs.json'), 'utf8'));
const sections = manifest.sections;
const sectionOrder = Object.keys(sections);

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const url = (p) => `${BASE}${p}`; // site-relative path -> served path
const abs = (p) => `${ORIGIN}${BASE}${p}`;
const slugify = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fmtDate = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// ---------- load articles ----------
const warnings = [];
const articles = [];
for (const m of manifest.articles) {
  const file = path.join(ROOT, 'content', m.section, `${m.slug}.md`);
  if (!fs.existsSync(file)) { warnings.push(`missing content: ${m.section}/${m.slug}`); continue; }
  const raw = fs.readFileSync(file, 'utf8');
  const mm = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!mm) { warnings.push(`no front matter: ${m.slug}`); continue; }
  let fm;
  try { fm = YAML.parse(mm[1]); } catch (e) { warnings.push(`bad YAML in ${m.slug}: ${e.message}`); continue; }
  articles.push({
    ...m,
    path: `/${m.section}/${m.slug}/`,
    title: fm.title || m.title,
    description: fm.description || '',
    keywords: fm.keywords || [m.kw],
    date: String(fm.date || TODAY).slice(0, 10),
    updated: String(fm.updated || fm.date || TODAY).slice(0, 10),
    verified: fm.verified || '',
    related: fm.related || [],
    faq: fm.faq || [],
    body: mm[2].trim(),
  });
}
const bySlug = Object.fromEntries(articles.map((a) => [a.slug, a]));

// ---------- markdown ----------
function render(md) {
  const toc = [];
  const used = new Set();
  const marked = new Marked({ gfm: true, mangle: false, headerIds: false });
  marked.use({
    renderer: {
      heading(text, level) {
        let id = slugify(text) || 'section';
        while (used.has(id)) id += '-2';
        used.add(id);
        if (level === 2 || level === 3) toc.push({ level, id, text: text.replace(/<[^>]+>/g, '') });
        return `<h${level} id="${id}">${text}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${level}>\n`;
      },
      link(href, title, text) {
        let h = href;
        const external = /^https?:\/\//.test(h);
        if (h.startsWith('/') && !h.startsWith('//')) h = url(h);
        return `<a href="${esc(h)}"${title ? ` title="${esc(title)}"` : ''}${external ? ' rel="noopener" target="_blank"' : ''}>${text}</a>`;
      },
      image(href, title, text) {
        const h = href.startsWith('/') ? url(href) : href;
        return `<figure><img src="${esc(h)}" alt="${esc(text)}" loading="lazy" decoding="async" width="1000" height="auto"><figcaption>${esc(title || text)}</figcaption></figure>`;
      },
      table(header, body) {
        return `<div class="table-wrap"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
      },
    },
  });
  return { html: marked.parse(md), toc };
}

// ---------- layout ----------
const CSS_HASH = Date.now().toString(36);
function layout({ title, description, path: p, body, type = 'website', jsonld = [], noindex = false, image = '/assets/og.png', navActive = '' }) {
  const canonical = abs(p);
  const fullTitle = p === '/' ? title : `${title} | ${SITE}`;
  const nav = sectionOrder.map((s) => `<a href="${url(`/${s}/`)}"${navActive === s ? ' aria-current="page"' : ''}>${esc(sections[s].title)}</a>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
${noindex ? '<meta name="robots" content="noindex">' : '<meta name="robots" content="index, follow, max-image-preview:large">'}
<meta name="theme-color" content="#0b1118" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#f4f7fa" media="(prefers-color-scheme: light)">
<meta property="og:site_name" content="${SITE}">
<meta property="og:type" content="${type}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${ORIGIN}${BASE}${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${ORIGIN}${BASE}${image}">
<link rel="icon" type="image/png" href="${url('/assets/icon.png')}">
<link rel="apple-touch-icon" href="${url('/assets/icon.png')}">
<link rel="alternate" type="application/rss+xml" title="${SITE} guides" href="${url('/rss.xml')}">
<link rel="stylesheet" href="${url('/assets/site.css')}?v=${CSS_HASH}">
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`).join('\n')}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap bar">
    <a class="brand" href="${url('/')}"><img src="${url('/assets/icon.png')}" alt="" width="28" height="28"><span>Vetro</span></a>
    <nav class="nav" aria-label="Main">${nav}<a href="${url('/tested-tvs/')}"${navActive === 'tested-tvs' ? ' aria-current="page"' : ''}>Tested TVs</a></nav>
    <a class="gh" href="${REPO}" rel="noopener">GitHub</a>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer">
  <div class="wrap">
    <div class="cols">
      <div><strong>Vetro</strong><p>Launcher, debloater and remapper for rooted Samsung Tizen TVs. Open source, MIT licensed.</p><p><a href="${REPO}" rel="noopener">Source on GitHub</a> · <a href="${REPO}/issues/new?template=log_report.yml" rel="noopener">Report your TV</a></p></div>
      <div><strong>Guides</strong><ul>${sectionOrder.map((s) => `<li><a href="${url(`/${s}/`)}">${esc(sections[s].title)}</a></li>`).join('')}</ul></div>
      <div><strong>Site</strong><ul><li><a href="${url('/tested-tvs/')}">Tested TVs</a></li><li><a href="${url('/about/')}">About this site</a></li><li><a href="${url('/rss.xml')}">RSS</a></li><li><a href="${url('/sitemap.xml')}">Sitemap</a></li></ul></div>
    </div>
    <p class="legal">Independent project. Not affiliated with, endorsed by or sponsored by Samsung. Samsung, Tizen, Bixby and SmartThings are trademarks of their owners. Rooting and modifying a TV can affect its warranty and can disrupt features: read each guide's limits before you act, and check Samsung's current terms.</p>
  </div>
</footer>
</body>
</html>`;
}

const crumbsHtml = (items) =>
  `<nav class="crumbs" aria-label="Breadcrumb"><ol>${items.map((c, i) => `<li>${c.path && i < items.length - 1 ? `<a href="${url(c.path)}">${esc(c.name)}</a>` : `<span aria-current="page">${esc(c.name)}</span>`}</li>`).join('')}</ol></nav>`;
const crumbsLd = (items) => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: abs(c.path || '/') })),
});
const card = (a) => `<a class="card" href="${url(a.path)}"><span class="eyebrow">${esc(sections[a.section].title)}</span><strong>${esc(a.title)}</strong><span>${esc(a.description)}</span></a>`;
const orgLd = { '@type': 'Organization', name: 'Vetro', url: abs('/'), logo: abs('/assets/icon.png'), sameAs: [REPO] };

// ---------- pages ----------
const pages = []; // {path, html, lastmod, priority}
const emit = (p, html, extra = {}) => pages.push({ path: p, html, ...extra });

// Article pages
for (const a of articles) {
  const { html, toc } = render(a.body);
  const secs = articles.filter((x) => x.section === a.section);
  const idx = secs.findIndex((x) => x.slug === a.slug);
  const prev = secs[idx - 1], next = secs[idx + 1];
  let related = a.related.map((s) => bySlug[s]).filter((x) => x && x.slug !== a.slug);
  for (const x of secs) if (related.length < 6 && x.slug !== a.slug && !related.includes(x)) related.push(x);
  related = related.slice(0, 6);
  const pillar = secs.find((x) => x.pillar || x.pillarOf);
  const crumbs = [{ name: 'Vetro', path: '/' }, { name: sections[a.section].title, path: `/${a.section}/` }, { name: a.title, path: a.path }];
  const faqHtml = a.faq.length
    ? `<section class="faq" aria-labelledby="faq-h"><h2 id="faq-h">Frequently asked questions</h2>${a.faq.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('')}</section>`
    : '';
  const tocHtml = toc.length > 2
    ? `<aside class="toc" aria-label="On this page"><strong>On this page</strong><ol>${toc.map((t) => `<li class="l${t.level}"><a href="#${t.id}">${esc(t.text)}</a></li>`).join('')}</ol></aside>`
    : '';
  const body = `<div class="wrap article-layout">
<article>
${crumbsHtml(crumbs)}
<header class="article-head">
<p class="eyebrow">${esc(sections[a.section].title)}</p>
<h1>${esc(a.title)}</h1>
<p class="meta"><time datetime="${a.updated}">Updated ${fmtDate(a.updated)}</time>${a.verified ? ` · <span class="verified">${esc(a.verified)}</span>` : ''}</p>
</header>
<div class="prose">
${html}
${faqHtml}
</div>
<section class="related" aria-labelledby="rel-h"><h2 id="rel-h">Related guides</h2><div class="cards">${related.map(card).join('')}</div></section>
<nav class="pager" aria-label="More in this section">${prev ? `<a href="${url(prev.path)}"><span>Previous</span>${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="next" href="${url(next.path)}"><span>Next</span>${esc(next.title)}</a>` : '<span></span>'}</nav>
<aside class="cta"><strong>Vetro is open source.</strong> It needs a rooted Samsung Tizen TV and is experimental software. <a href="${url('/root/install-vetro-apps2samsung/')}">Install guide</a> · <a href="${url('/tested-tvs/')}">Tested TVs</a> · <a href="${REPO}" rel="noopener">GitHub</a></aside>
</article>
${tocHtml}
</div>`;
  const ld = [
    {
      '@context': 'https://schema.org', '@type': 'Article', headline: a.title, description: a.description,
      datePublished: a.date, dateModified: a.updated, inLanguage: 'en',
      keywords: a.keywords.join(', '), articleSection: sections[a.section].title,
      mainEntityOfPage: abs(a.path), image: abs('/assets/og.png'),
      author: orgLd, publisher: orgLd,
    },
    crumbsLd(crumbs),
  ];
  if (a.faq.length) ld.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: a.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) });
  emit(a.path, layout({ title: a.title, description: a.description, path: a.path, body, type: 'article', jsonld: ld, navActive: a.section }), { lastmod: a.updated, priority: a.pillar || a.pillarOf ? '0.9' : '0.7' });
}

// Section hubs
for (const s of sectionOrder) {
  const list = articles.filter((a) => a.section === s).sort((a, b) => (b.pillar || b.pillarOf ? 1 : 0) - (a.pillar || a.pillarOf ? 1 : 0));
  if (!list.length) continue;
  const p = `/${s}/`;
  const crumbs = [{ name: 'Vetro', path: '/' }, { name: sections[s].title, path: p }];
  const body = `<div class="wrap hub">${crumbsHtml(crumbs)}<h1>${esc(sections[s].title)}</h1><p class="lede">${esc(sections[s].desc)}</p>
<div class="cards">${list.map(card).join('')}</div></div>`;
  const ld = [crumbsLd(crumbs), { '@context': 'https://schema.org', '@type': 'CollectionPage', name: sections[s].title, description: sections[s].desc, url: abs(p), hasPart: list.map((a) => ({ '@type': 'Article', headline: a.title, url: abs(a.path) })) }];
  emit(p, layout({ title: `${sections[s].title}: Samsung TV guides`, description: sections[s].desc, path: p, body, jsonld: ld, navActive: s }), { lastmod: TODAY, priority: '0.8' });
}

// Tested TVs
const rootForYear = (y) => (y === 2021 ? 'root-tizen-6-samsung-tv' : y === 2022 ? 'root-samsung-tizen-6-5-2022' : y === 2023 ? 'root-samsung-tizen-7-2023' : y && y >= 2024 ? 'root-samsung-tizen-8-9-2024' : y && y <= 2020 ? 'root-samsung-2019-2020-tizen-5' : 'how-to-root-samsung-tv');
const issueLink = (t) => (t.issue ? `<a href="${REPO}/issues/${t.issue}" rel="noopener">#${t.issue}</a>` : 'no issue number');
{
  const p = '/tested-tvs/';
  const crumbs = [{ name: 'Vetro', path: '/' }, { name: 'Tested TVs', path: p }];
  const rows = tvs.map((t) => `<tr><td><a href="${url(`/tested-tvs/${t.slug}/`)}">${esc(t.name)}</a><br><span class="muted">${esc(t.code)}</span></td><td>${t.year ?? 'n/a'}</td><td>${esc(t.tizen)}</td><td><code>${esc(t.firmware)}</code></td><td>${esc(t.status)}</td><td>${issueLink(t)}</td></tr>`).join('');
  const body = `<div class="wrap hub">${crumbsHtml(crumbs)}<h1>Samsung TVs tested with Vetro</h1>
<p class="lede">Vetro is developed on a Samsung Q80A. Every other TV below is there because an owner reported it, usually with a diagnostic export. Reported working means the app, the service and the root agent were running and the owner said what worked. It does not mean every feature was tried.</p>
<div class="table-wrap"><table><thead><tr><th>TV</th><th>Year</th><th>Tizen</th><th>Firmware</th><th>Status</th><th>Report</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="note">Where the project's README does not state a Tizen version, the table shows the version Samsung launched that model year with, marked "by model year". Samsung's update policy can move a TV to a newer Tizen, as the GU75CU7179 shows. Read <a href="${url('/root/samsung-tv-tizen-version-by-year/')}">Samsung TV Tizen version by year</a> and <a href="${url('/reference/samsung-model-code-decoder/')}">how to read a model code and firmware string</a> before you compare your TV with this list.</p>
<h2>Not on the list?</h2>
<p>Open a <a href="${REPO}/issues/new?template=log_report.yml" rel="noopener">diagnostic report issue</a> with your exact model, firmware and what worked or failed. Failed attempts help too. The report excludes credentials, IP and MAC addresses, serial numbers and viewing history; read it before you upload it. Start with <a href="${url('/root/how-to-root-samsung-tv/')}">how rooting a Samsung TV works</a> and <a href="${url('/root/is-it-safe-to-root-samsung-tv/')}">the risks</a>.</p></div>`;
  emit(p, layout({ title: 'Samsung TVs tested with Vetro: models, Tizen, firmware', description: 'Every Samsung TV reported with Vetro: Q80A, Q70A, Q60A, QN85A, S90C, S90D and more, with Tizen version, firmware string and the issue behind each report.', path: p, body, jsonld: [crumbsLd(crumbs)], navActive: 'tested-tvs' }), { lastmod: TODAY, priority: '0.9' });
  for (const t of tvs) {
    const tp = `/tested-tvs/${t.slug}/`;
    const c2 = [...crumbs, { name: t.name, path: tp }];
    const art = bySlug[rootForYear(t.year)];
    const others = tvs.filter((x) => x.slug !== t.slug && x.year === t.year).slice(0, 5);
    const title = `${t.name} (${t.code}) with Vetro: ${t.status.toLowerCase()}`;
    const desc = `${t.name}${t.year ? `, ${t.year}` : ''}: ${t.status.toLowerCase()} with Vetro. Firmware ${t.firmware}, ${t.tizen}. What was reported and what to check before you try it.`.slice(0, 158);
    const b = `<div class="wrap article-layout"><article>${crumbsHtml(c2)}<header class="article-head"><p class="eyebrow">Tested TVs</p><h1>${esc(t.name)} with Vetro</h1><p class="meta">${esc(t.status)} · Model code <code>${esc(t.code)}</code></p></header>
<div class="prose"><p>${esc(t.summary)}</p>
<h2>Report details</h2>
<table><tbody><tr><th>Model code</th><td><code>${esc(t.code)}</code></td></tr><tr><th>Model year</th><td>${t.year ?? 'not stated'}</td></tr><tr><th>Tizen</th><td>${esc(t.tizen)}</td></tr><tr><th>Firmware</th><td><code>${esc(t.firmware)}</code></td></tr><tr><th>Status</th><td>${esc(t.status)}</td></tr><tr><th>Report</th><td>${issueLink(t)}</td></tr></tbody></table>
<h2>Before you try it on this TV</h2>
<p>A firmware update can change the result, even within one model family, so compare your firmware string with the one above. Vetro needs root, which comes from a package you build and sign yourself; the <a href="${url('/root/install-vetro-apps2samsung/')}">install guide</a> covers the route, and <a href="${url('/root/samsung-tv-developer-mode/')}">Developer Mode</a> comes first.${art ? ` The closest rooting guide for this model year is <a href="${url(art.path)}">${esc(art.title)}</a>.` : ''} Read <a href="${url('/root/is-it-safe-to-root-samsung-tv/')}">the risks</a> too. Vetro is experimental and not affiliated with Samsung.</p>
${others.length ? `<h2>Other ${t.year} TVs</h2><ul>${others.map((o) => `<li><a href="${url(`/tested-tvs/${o.slug}/`)}">${esc(o.name)}</a>: ${esc(o.status.toLowerCase())}</li>`).join('')}</ul>` : ''}
<p><a href="${url('/tested-tvs/')}">Back to all tested TVs</a> · <a href="${REPO}/issues/new?template=log_report.yml" rel="noopener">Report your own TV</a></p></div></article></div>`;
    emit(tp, layout({ title, description: desc, path: tp, body: b, type: 'article', jsonld: [crumbsLd(c2)], navActive: 'tested-tvs' }), { lastmod: TODAY, priority: '0.6' });
  }
}

// About
{
  const p = '/about/';
  const crumbs = [{ name: 'Vetro', path: '/' }, { name: 'About this site', path: p }];
  const body = `<div class="wrap article-layout"><article>${crumbsHtml(crumbs)}<header class="article-head"><h1>About this site</h1></header><div class="prose">
<p>This site collects guides about Samsung Tizen TVs: rooting, privacy, speed, firmware updates and smart home control. It is written by the people who build <a href="${REPO}" rel="noopener">Vetro</a>, an open source launcher, debloater and remapper for rooted Samsung TVs.</p>
<h2>How the guides are written</h2>
<p>Statements about Vetro come from its repository: the README, changelog and test records. Statements about Samsung and other projects come from the pages we link. Each guide says what was checked in its "Updated" line. When something is a single report or a single test run, the guide says so. When we could not confirm a claim, the guide leaves it out or says it is unconfirmed.</p>
<p>We do not publish exploit steps. The root used by Vetro comes from <a href="https://github.com/chris-ritsen/samsung-tv-root" rel="noopener">Chris Ritsen's samsung-tv-root research</a>; the guides explain what it is and link to it.</p>
<h2>Corrections</h2>
<p>Found something wrong or out of date? <a href="${REPO}/issues/new" rel="noopener">Open an issue</a> with the page and the correction. Menu names and firmware behavior change, and we would rather fix a page than leave it wrong.</p>
<h2>Independence</h2>
<p>Vetro is not affiliated with Samsung. Samsung, Tizen, Bixby and SmartThings are trademarks of their owners. Generative AI and coding agents assisted the development of Vetro and the drafting of these guides; the tests, device observations and cited sources define what has been verified.</p>
<p>Start with <a href="${url('/root/how-to-root-samsung-tv/')}">how to root a Samsung TV</a> or browse <a href="${url('/tested-tvs/')}">the tested TVs</a>.</p>
</div></article></div>`;
  emit(p, layout({ title: 'About this site', description: 'Who writes the Vetro guides, how claims are checked, and how to report a correction.', path: p, body, jsonld: [crumbsLd(crumbs)] }), { lastmod: TODAY, priority: '0.3' });
}

// Home
{
  const hubs = sectionOrder.map((s) => {
    const list = articles.filter((a) => a.section === s).sort((a, b) => (b.pillar || b.pillarOf ? 1 : 0) - (a.pillar || a.pillarOf ? 1 : 0));
    if (!list.length) return '';
    return `<section class="hub-card"><h3><a href="${url(`/${s}/`)}">${esc(sections[s].title)}</a></h3><p>${esc(sections[s].desc)}</p><ul>${list.slice(0, 4).map((a) => `<li><a href="${url(a.path)}">${esc(a.title)}</a></li>`).join('')}</ul><a class="more" href="${url(`/${s}/`)}">All ${list.length} guides</a></section>`;
  }).join('');
  const start = ['how-to-root-samsung-tv', 'turn-off-acr-samsung-tv', 'remove-ads-samsung-tv-home-screen', 'samsung-tv-slow-fix', 'stop-samsung-tv-auto-update', 'remap-samsung-remote-buttons'].map((s) => bySlug[s]).filter(Boolean);
  const body = `<section class="hero"><div class="wrap">
<p class="eyebrow">Open source · Samsung Tizen TVs</p>
<h1>Take your Samsung TV back</h1>
<p class="lede">Guides for rooting, privacy, speed and control on Samsung Tizen TVs, and the open source project behind them. Vetro replaces Samsung's Home with a light launcher, switches off what tracks you, and makes the remote do what you want.</p>
<p class="actions"><a class="btn primary" href="${url(bySlug['how-to-root-samsung-tv'] ? '/root/how-to-root-samsung-tv/' : '/root/')}">Rooting guides</a><a class="btn" href="${url('/tested-tvs/')}">See tested TVs</a><a class="btn" href="${REPO}" rel="noopener">Vetro on GitHub</a></p>
</div></section>
<div class="wrap">
<section class="shots"><figure><img src="${url('/assets/img/dashboard-quick-settings.jpg')}" alt="Vetro dashboard, Quick settings: HbbTV, advertising and tracking, domain blocking and voice assistant switches" width="1000" height="auto" decoding="async"><figcaption>The Vetro dashboard on a Samsung Q80A.</figcaption></figure>
<figure><img src="${url('/assets/img/launcher-on-tv.jpg')}" alt="The Vetro launcher at the bottom of the TV screen with the apps from Samsung's Home" width="1000" height="auto" loading="lazy" decoding="async"><figcaption>The launcher as the TV draws it, over a plain backdrop.</figcaption></figure></section>
<h2>Start here</h2><div class="cards">${start.map(card).join('')}</div>
<h2>Browse by topic</h2><div class="hubs">${hubs}</div>
<h2>What Vetro does</h2>
<div class="three"><div><h3>Launcher</h3><p>A native, glass-style bar on the Home key with the same apps in the same order. On the Q80A, available RAM went from 533 MB to 662 MB while it ran (one measurement, memory only). In beta. <a href="${url('/speed/custom-launcher-samsung-tv/')}">More</a></p></div><div><h3>Debloater</h3><p>Switches for advertising, viewing data, HbbTV, voice assistants and automatic firmware updates, plus a task manager that lists every app and service. <a href="${url('/reference/what-each-vetro-switch-changes/')}">What each switch changes</a></p></div><div><h3>Remapper</h3><p>Press a remote key, pick an app, save. Shortcuts survive restarts, and a key can send an MQTT message to Home Assistant. <a href="${url('/control/remap-samsung-remote-buttons/')}">How it works</a></p></div></div>
<p class="note">Vetro needs root on the TV, which comes from a package you build and sign yourself. It is experimental software, independent from Samsung. Read <a href="${url('/root/is-it-safe-to-root-samsung-tv/')}">the risks</a> before you start.</p>
</div>`;
  const ld = [
    { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Vetro', url: abs('/'), inLanguage: 'en', publisher: orgLd },
    { '@context': 'https://schema.org', ...orgLd, description: 'Open source launcher, debloater and remapper for rooted Samsung Tizen TVs.' },
  ];
  emit('/', layout({ title: 'Vetro: Samsung TV rooting, privacy and speed guides', description: 'Guides for Samsung Tizen TVs: how rooting works, how to turn off ACR and ads, speed up a slow TV, and the open source Vetro launcher, debloater and remapper.', path: '/', body, jsonld: ld }), { lastmod: TODAY, priority: '1.0' });
}

// 404
{
  const body = `<div class="wrap hub"><h1>Page not found</h1><p class="lede">That page does not exist. Try the <a href="${url('/')}">home page</a>, the <a href="${url('/root/how-to-root-samsung-tv/')}">rooting guide</a> or the <a href="${url('/tested-tvs/')}">tested TVs</a>.</p></div>`;
  fs.mkdirSync(OUT, { recursive: true });
  pages.push({ path: '/404.html', html: layout({ title: 'Page not found', description: 'Page not found.', path: '/404.html', body, noindex: true }), file: '404.html', skipSitemap: true });
}

// ---------- link check ----------
const known = new Set(pages.map((p) => p.path));
const broken = [];
const unlinked = new Set();
// Links to pages that do not exist (yet) are rendered as plain text instead of dead links.
const stripRe = new RegExp(`<a ([^>]*?)href="${BASE}(/[^"#?]*)([^"]*)"([^>]*)>([\\s\\S]*?)</a>`, 'g');
for (const pg of pages) {
  pg.html = pg.html.replace(stripRe, (all, pre, target, rest, attrs, text) => {
    if (target.startsWith('/assets/') || target === '/rss.xml' || target === '/sitemap.xml' || known.has(target)) return all;
    unlinked.add(target);
    return text;
  });
}
const baseRe = new RegExp(`href="${BASE}(/[^"#?]*)`, 'g');
for (const pg of pages) {
  let m;
  while ((m = baseRe.exec(pg.html))) {
    const target = m[1];
    if (target.startsWith('/assets/') || target === '/rss.xml' || target === '/sitemap.xml') continue;
    if (!known.has(target)) broken.push(`${pg.path} -> ${target}`);
  }
}
// inbound link count (orphan check)
const inbound = Object.fromEntries(articles.map((a) => [a.path, 0]));
for (const pg of pages) {
  for (const a of articles) if (a.path !== pg.path && pg.html.includes(`href="${url(a.path)}"`)) inbound[a.path]++;
}
const orphans = Object.entries(inbound).filter(([, n]) => n < 3).map(([p, n]) => `${p} (${n})`);

// ---------- write ----------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const pg of pages) {
  const f = pg.file ? path.join(OUT, pg.file) : path.join(OUT, pg.path, 'index.html');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, pg.html);
}
fs.cpSync(path.join(ROOT, 'assets'), path.join(OUT, 'assets'), { recursive: true });
fs.cpSync(path.join(ROOT, 'src/site.css'), path.join(OUT, 'assets/site.css'));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

const sm = pages.filter((p) => !p.skipSitemap).map((p) => `  <url><loc>${abs(p.path)}</loc><lastmod>${p.lastmod}</lastmod><priority>${p.priority}</priority></url>`).join('\n');
fs.writeFileSync(path.join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sm}\n</urlset>\n`);
fs.writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${abs('/sitemap.xml')}\n`);
const llms = [`# Vetro`, ``, `> Guides for Samsung Tizen TVs (rooting, privacy, speed, firmware updates, remote and smart home control) and the open source Vetro launcher, debloater and remapper. Independent project, not affiliated with Samsung.`, ``];
for (const s of sectionOrder) {
  const list = articles.filter((a) => a.section === s);
  if (!list.length) continue;
  llms.push(`## ${sections[s].title}`, ``);
  for (const a of list) llms.push(`- [${a.title}](${abs(a.path)}): ${a.description}`);
  llms.push(``);
}
llms.push(`## Data`, ``, `- [Samsung TVs tested with Vetro](${abs('/tested-tvs/')}): models, Tizen versions, firmware strings and issue links.`, `- [Source code](${REPO})`, ``);
fs.writeFileSync(path.join(OUT, 'llms.txt'), llms.join('\n'));
const rssItems = [...articles].sort((a, b) => b.updated.localeCompare(a.updated)).map((a) => `<item><title>${esc(a.title)}</title><link>${abs(a.path)}</link><guid>${abs(a.path)}</guid><pubDate>${new Date(a.updated + 'T00:00:00Z').toUTCString()}</pubDate><description>${esc(a.description)}</description></item>`).join('');
fs.writeFileSync(path.join(OUT, 'rss.xml'), `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Vetro guides</title><link>${abs('/')}</link><description>Samsung Tizen TV guides from the Vetro project.</description><language>en</language>${rssItems}</channel></rss>`);

// ---------- report ----------
const wc = (s) => s.split(/\s+/).filter(Boolean).length;
const lines = articles.map((a) => `${String(wc(a.body)).padStart(5)}  ${a.path}  title=${a.title.length} desc=${a.description.length} in=${inbound[a.path]}`);
fs.writeFileSync(path.join(ROOT, 'build-report.txt'), lines.join('\n') + '\n');
console.log(`pages: ${pages.length} (articles ${articles.length}/${manifest.articles.length})`);
if (warnings.length) console.log('WARNINGS:\n  ' + warnings.join('\n  '));
if (unlinked.size) console.log('UNLINKED (target page missing):\n  ' + [...unlinked].join('\n  '));
if (broken.length) console.log('BROKEN LINKS:\n  ' + [...new Set(broken)].join('\n  '));
if (orphans.length) console.log('LOW INBOUND (<3):\n  ' + orphans.join('\n  '));
const seoBad = articles.filter((a) => a.title.length > 62 || a.description.length < 120 || a.description.length > 165);
if (seoBad.length) console.log('SEO length issues:\n  ' + seoBad.map((a) => `${a.slug} title=${a.title.length} desc=${a.description.length}`).join('\n  '));
if (broken.length && process.argv.includes('--strict')) process.exit(1);
