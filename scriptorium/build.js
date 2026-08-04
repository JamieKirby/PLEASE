#!/usr/bin/env node
/**
 * ==========================================================================
 * The Burren — static site build.
 *
 * Reads every JSON file in data/ (one file per category, rather than one
 * giant database.json, so each file stays small enough to read and review
 * in full as the entry count grows) and writes:
 *
 *   dist/index.html                        the Scriptorium home
 *   dist/<category>/index.html             a browsable hub per category
 *   dist/<category>/<slug>/index.html      the canonical entry page
 *   dist/<category>/<slug>.html            a redirect stub (see below)
 *   dist/manifest.json                     the map's runtime search + drawer data
 *   dist/sitemap.xml, dist/robots.txt      crawl surface (only if siteUrl is set)
 *   dist/styles.css, dist/assets/*         everything the pages actually link
 *
 * Run with:  node build.js
 *
 * ---- WHAT CHANGED, AND WHY ----
 *
 * 1. CLEAN URLS. Entries used to live at dist/<category>/<slug>.html.
 *    They now live at dist/<category>/<slug>/index.html, served as
 *    /scriptorium/flora/spring-gentian/ — a better share target, a
 *    better search result, and one less extension to explain. The OLD
 *    path is still written as a redirect stub, so every link ever
 *    published or bookmarked keeps working. Nothing breaks.
 *
 * 2. ONE RENDERER. The per-entry HTML now comes from
 *    assets/entry-render.js, the same file the map's drawer loads in the
 *    browser. This build no longer has its own opinion about what an
 *    entry looks like, which is what makes drawer/page content parity a
 *    property of the system rather than something a human maintains.
 *
 * 3. LINKED CONTENT IN THE MANIFEST. The manifest used to deliberately
 *    ship RAW content, because auto-linked hrefs were baked relative to
 *    the entry page's own folder and resolved wrongly inside the map.
 *    Auto-linking now emits a %%R%% token instead of a path, which each
 *    host substitutes for its own route to the Scriptorium root — so the
 *    same string is correct everywhere and the compromise is gone.
 *
 * 4. NO HARDCODED ORIGIN. Every internal link is relative and computed
 *    per page. siteUrl in assets/site-config.js is used ONLY for
 *    canonical tags, Open Graph and the sitemap, and if it's blank those
 *    three are simply omitted. A missing canonical is harmless; one
 *    pointing at the wrong origin is not.
 * ==========================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const ASSETS_DIR = path.join(ROOT, 'assets');
const OUTPUT_DIR = path.join(ROOT, 'dist');

const CFG = require('./assets/site-config.js');
const R = require('./assets/entry-render.js');
const { checkDist } = require('../tools/check-generated-links.js');

const TEMPLATE_FILE = path.join(ROOT, 'template.html');
const HUB_TEMPLATE_FILE = path.join(ROOT, 'hub-template.html');
const HOME_FILE = path.join(ROOT, 'home.html');

// --------------------------------------------------------------------------
// Category naming and ordering
// --------------------------------------------------------------------------

function capitalizeWord(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function categoryTitle(cat) {
  return (CFG.categories[cat] && CFG.categories[cat].title) || capitalizeWord(cat);
}
// A fixed reading order for the categories site-config knows about;
// anything added later that isn't listed falls in afterwards,
// alphabetically, rather than being silently dropped the way a purely
// hardcoded link list would have done. Dropping a data/<cat>.json file
// into data/ is still the entire job of adding a category.
function sortCategories(cats) {
  const order = CFG.categoryOrder || [];
  return cats.slice().sort((a, b) => {
    const ai = order.indexOf(a), bi = order.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
}

// --------------------------------------------------------------------------
// Loading
// --------------------------------------------------------------------------

function loadAllEntries() {
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json')).sort();
  let entries = [];
  files.forEach((file) => {
    const parsed = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
    if (!Array.isArray(parsed)) {
      console.warn(`  ! data/${file} is not an array — skipped`);
      return;
    }
    entries = entries.concat(parsed);
  });
  return entries;
}

// --------------------------------------------------------------------------
// Path helpers
//
// Every page computes its own way back to the Scriptorium root and to the
// repo root, rather than any of them assuming a fixed depth. This is what
// lets entry pages move one folder deeper (clean URLs) without a single
// hand-edited ../ anywhere.
// --------------------------------------------------------------------------

const DEPTHS = {
  home:  { root: '',       site: '../'       },  // dist/index.html
  hub:   { root: '../',    site: '../../'    },  // dist/<cat>/index.html
  entry: { root: '../../', site: '../../../' }   // dist/<cat>/<slug>/index.html
};

// --------------------------------------------------------------------------
// Head fragments — canonical, Open Graph, JSON-LD
// --------------------------------------------------------------------------

function absoluteUrl(relFromScriptoriumRoot) {
  if (!CFG.siteUrl) return null;
  return CFG.siteUrl.replace(/\/+$/, '') + '/scriptorium/' + relFromScriptoriumRoot;
}

function ogTags(opts) {
  if (!CFG.siteUrl) return '';
  const url = absoluteUrl(opts.rel);
  return [
    `<link rel="canonical" href="${R.escapeAttr(url)}">`,
    `<meta property="og:type" content="${opts.type || 'article'}">`,
    `<meta property="og:site_name" content="${R.escapeAttr(CFG.siteName)}">`,
    `<meta property="og:title" content="${R.escapeAttr(opts.title)}">`,
    `<meta property="og:description" content="${R.escapeAttr(opts.description)}">`,
    `<meta property="og:url" content="${R.escapeAttr(url)}">`,
    `<meta name="twitter:card" content="summary_large_image">`
  ].join('\n');
}

// Structured data, chosen per category rather than one generic Article for
// everything. Bioschemas' Taxon profile is a real, adopted extension for
// biodiversity records and maps directly onto the scientificName field
// that flora and fauna already carry — this is the single highest-value
// SEO addition available for this dataset, and it costs one function.
function jsonLd(entry, rel) {
  const url = absoluteUrl(rel);
  const summary = R.deriveSummary(entry);
  let node;

  if (entry.category === 'flora' || entry.category === 'fauna') {
    node = {
      '@context': ['https://schema.org', { 'bioschemas': 'https://bioschemas.org/' }],
      '@type': 'Taxon',
      'name': entry.title,
      'description': summary
    };
    if (entry.scientificName) node.scientificName = entry.scientificName;
    if (entry.subCategory) node.taxonRank = entry.subCategory;
    if (entry.irishTitle) node.alternateName = entry.irishTitle;
  } else if (entry.category === 'poetry') {
    node = { '@context': 'https://schema.org', '@type': 'Poem', 'name': entry.title, 'description': summary };
  } else {
    node = { '@context': 'https://schema.org', '@type': 'Article', 'headline': entry.title, 'description': summary };
  }
  if (url) { node.url = url; node.mainEntityOfPage = url; }
  if (entry.irishTitle && !node.alternateName) node.alternateName = entry.irishTitle;

  const blocks = [node];
  if (CFG.siteUrl) {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      'itemListElement': [
        { '@type': 'ListItem', position: 1, name: CFG.siteName, item: absoluteUrl('') },
        { '@type': 'ListItem', position: 2, name: categoryTitle(entry.category), item: absoluteUrl(entry.category + '/') },
        { '@type': 'ListItem', position: 3, name: entry.title, item: url }
      ]
    });
  }
  return blocks
    .map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`)
    .join('\n');
}

function hubJsonLd(cat, list, rel) {
  if (!CFG.siteUrl) return '';
  const node = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    'name': categoryTitle(cat),
    'url': absoluteUrl(rel),
    'mainEntity': {
      '@type': 'ItemList',
      'numberOfItems': list.length,
      'itemListElement': list.slice(0, 100).map((e, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: e.title,
        url: absoluteUrl(e.category + '/' + R.entryId(e) + '/')
      }))
    }
  };
  return `<script type="application/ld+json">${JSON.stringify(node)}</script>`;
}

// --------------------------------------------------------------------------
// Template filling
// --------------------------------------------------------------------------

// The shared chrome tag. `root` is the only path it needs — chrome.js
// derives the map link, the manifest URL and every category link from it,
// so there is one path here to get wrong instead of five.
function chromeTag(depth, entry, cat) {
  const attrs = [`root="${depth.root}"`];
  if (cat) attrs.push(`category="${R.escapeAttr(cat)}"`);
  if (entry) {
    attrs.push(`entry="${R.escapeAttr(R.entryId(entry))}"`);
    attrs.push(`entry-title="${R.escapeAttr(entry.title)}"`);
  }
  return `<burren-chrome ${attrs.join(' ')}></burren-chrome>`;
}

function applyCommon(template, depth, extra) {
  return template
    .split('{{ROOT}}').join(depth.root)
    .split('{{SITE_ROOT}}').join(depth.site)
    .split('{{ASSETS}}').join(depth.root + 'assets/')
    .split('{{HEAD_EXTRA}}').join(extra.headExtra || '')
    .split('{{CHROME}}').join(extra.chrome || '');
}

function fillEntry(template, entry, index) {
  const depth = DEPTHS.entry;
  const id = R.entryId(entry);
  const rel = entry.category + '/' + id + '/';
  const summary = R.deriveSummary(entry);
  const crossing = (CFG.crossing.toMapBy && CFG.crossing.toMapBy[entry.category]) ||
                   CFG.crossing.toMap || 'Find it on the map';

  // The map's deep-link bootstrap accepts a slug now (with title kept as a
  // back-compatible alias), so this passes the canonical id rather than an
  // encoded display title. A title edit can no longer orphan this link.
  const mapHref = depth.site + 'index.html?entry=' + encodeURIComponent(entry.category) + ':' + encodeURIComponent(id);

  const body = R.pageHtml(entry, {
    linkBase: depth.root,
    index: index,
    mapHref: mapHref,
    mapLabel: crossing
  });

  const headExtra = [
    ogTags({ rel: rel, title: entry.title, description: summary, type: 'article' }),
    jsonLd(entry, rel)
  ].filter(Boolean).join('\n');

  return applyCommon(template, depth, { headExtra: headExtra, chrome: chromeTag(depth, entry, entry.category) })
    .split('{{TITLE}}').join(R.escapeHtml(entry.title))
    .split('{{CATEGORY}}').join(R.escapeHtml(entry.category))
    .split('{{SUMMARY}}').join(R.escapeAttr(summary))
    .split('{{BODY}}').join(body);
}

// The old flat path, kept alive. A published URL is a promise; this is a
// cheap way to keep it. Real <link rel="canonical"> plus a meta refresh
// plus a visible link, so it works for crawlers, for browsers, and for
// anyone with JS and redirects both disabled.
function redirectStub(entry) {
  const target = './' + R.entryId(entry) + '/';
  const canonical = absoluteUrl(entry.category + '/' + R.entryId(entry) + '/') || target;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${R.escapeHtml(entry.title)} — ${R.escapeHtml(CFG.siteName)}</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="${R.escapeAttr(canonical)}">
<meta http-equiv="refresh" content="0; url=${R.escapeAttr(target)}">
</head>
<body>
<p>This entry has moved to <a href="${R.escapeAttr(target)}">${R.escapeHtml(entry.title)}</a>.</p>
<script>location.replace(${JSON.stringify(target)});</script>
</body>
</html>
`;
}

function hubListItem(entry) {
  const irish = entry.irishTitle
    ? `<span class="hub-entry-irish" lang="ga">${R.escapeHtml(entry.irishTitle)}</span>` : '';
  const sci = entry.scientificName
    ? `<span class="hub-entry-sci">${R.escapeHtml(entry.scientificName)}</span>` : '';
  return `      <li><a href="./${R.escapeAttr(R.entryId(entry))}/"><span class="hub-entry-title">${R.escapeHtml(entry.title)}</span>${irish}${sci}</a></li>`;
}

function buildHubPages(byCategory, hubTemplate) {
  const depth = DEPTHS.hub;
  Object.keys(byCategory).forEach((cat) => {
    const list = byCategory[cat].slice().sort((a, b) => a.title.localeCompare(b.title));
    const items = list.map(hubListItem).join('\n');
    // Featured is opt-in per entry ("featured": true in that entry's
    // data/*.json record) rather than a fixed count or a separate file to
    // maintain — a category with nothing marked featured just gets no
    // Featured section at all.
    const featured = list.filter((e) => e.featured);
    const featuredSection = featured.length
      ? `<h2 class="hub-featured-heading">Featured</h2>\n    <ul class="hub-list hub-list-featured">\n${featured.map(hubListItem).join('\n')}\n    </ul>`
      : '';

    const rel = cat + '/';
    const headExtra = [
      ogTags({ rel: rel, title: categoryTitle(cat), description: `Browse every ${categoryTitle(cat)} entry in ${CFG.siteName}.`, type: 'website' }),
      hubJsonLd(cat, list, rel)
    ].filter(Boolean).join('\n');

    const html = applyCommon(hubTemplate, depth, { headExtra: headExtra, chrome: chromeTag(depth, null, cat) })
      .split('{{CATEGORY}}').join(R.escapeHtml(cat))
      .split('{{CATEGORY_TITLE}}').join(R.escapeHtml(categoryTitle(cat)))
      .split('{{ENTRY_COUNT}}').join(String(list.length))
      .split('{{ENTRY_LIST}}').join(items)
      .split('{{FEATURED_SECTION}}').join(featuredSection);

    const outDir = path.join(OUTPUT_DIR, cat);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
  });
  return Object.keys(byCategory).length;
}

// --------------------------------------------------------------------------
// Crawl surface
// --------------------------------------------------------------------------

function writeSitemap(entries, categories) {
  if (!CFG.siteUrl) {
    console.log('  (siteUrl is blank in assets/site-config.js — skipping sitemap.xml, robots.txt,');
    console.log('   canonical tags and Open Graph. Set it to emit them.)');
    return false;
  }
  const urls = [absoluteUrl('')]
    .concat(categories.map((c) => absoluteUrl(c + '/')))
    .concat(entries.map((e) => absoluteUrl(e.category + '/' + R.entryId(e) + '/')));

  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${R.escapeHtml(u)}</loc></url>`).join('\n') +
    '\n</urlset>\n';
  fs.writeFileSync(path.join(OUTPUT_DIR, 'sitemap.xml'), xml, 'utf8');

  const origin = CFG.siteUrl.replace(/\/+$/, '');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'robots.txt'),
    `User-agent: *\nAllow: /\nSitemap: ${origin}/scriptorium/sitemap.xml\n`, 'utf8');
  return true;
}

// --------------------------------------------------------------------------
// Assets
// --------------------------------------------------------------------------

// styles.css, home.html and everything in assets/ live in scriptorium/
// (source), not scriptorium/dist/ (build output) — they're inputs to the
// build, not generated per-entry pages. The original cause of "no CSS on
// any static page" was that nothing ever copied styles.css into dist/, so
// it 404'd silently on every page. The same trap applies to every file in
// assets/, which is why this copies the whole directory rather than a
// hand-listed set that a new file would quietly fall out of.
function copyAssets() {
  const outAssets = path.join(OUTPUT_DIR, 'assets');
  fs.mkdirSync(outAssets, { recursive: true });
  const files = fs.readdirSync(ASSETS_DIR).filter((f) => !f.startsWith('.'));
  files.forEach((f) => fs.copyFileSync(path.join(ASSETS_DIR, f), path.join(outAssets, f)));
  fs.copyFileSync(path.join(ROOT, 'styles.css'), path.join(OUTPUT_DIR, 'styles.css'));
  return files.length;
}

// --------------------------------------------------------------------------
// Validation
// --------------------------------------------------------------------------

// Runs BEFORE anything is written, over every record including
// unpublished ones (an unpublished record can still collide with a
// published one's canonical key, and still gets linked to from other
// entries' prose). Anything found here is a data-integrity problem that
// will silently misroute a reader if it ships, so this throws — a build
// that "succeeds" by quietly overwriting one entry with another, or
// serving Fern's page when Otter was meant, is worse than a build that
// stops and says why.
function validateEntries(all) {
  const errors = [];
  const byKey = new Map();          // category:slug -> [source description]
  const aliasByCategory = new Map(); // category -> Map(alias -> [title])

  all.forEach((entry, i) => {
    const where = entry.title ? `"${entry.title}"` : `data/*.json entry #${i}`;
    if (!entry.category) errors.push(`${where}: missing "category"`);
    if (!entry.title) errors.push(`${where}: missing "title"`);
    if (!entry.category || !entry.title) return; // can't check the rest meaningfully

    const slug = R.entryId(entry);
    if (!slug) { errors.push(`${where}: generated an empty slug`); return; }

    const key = entry.category + ':' + slug;
    if (byKey.has(key)) {
      errors.push(`duplicate canonical entry "${key}" — ${byKey.get(key)} and ${where} both produce this URL`);
    } else {
      byKey.set(key, where);
    }

    // Duplicate aliases WITHIN a category are a real ambiguity (which
    // Otter does "the otter" refer to?) and fail the build. The same
    // alias reused across categories is fine — resolveRef only trusts a
    // bare name when exactly one candidate exists, and a category-scoped
    // "category:slug" reference is unaffected either way.
    if (!aliasByCategory.has(entry.category)) aliasByCategory.set(entry.category, new Map());
    const aliasMap = aliasByCategory.get(entry.category);
    (entry.aliases || []).forEach((a) => {
      if (aliasMap.has(a) && aliasMap.get(a) !== entry.title) {
        errors.push(`duplicate alias "${a}" in ${entry.category}/ — used by both "${aliasMap.get(a)}" and "${entry.title}"`);
      } else {
        aliasMap.set(a, entry.title);
      }
    });
  });

  if (errors.length) {
    console.error(`\nBuild stopped — ${errors.length} data problem(s) found before any file was written:\n`);
    errors.forEach((e) => console.error('  ! ' + e));
    console.error('');
    throw new Error(`${errors.length} data integrity error(s) — see above. Nothing was written.`);
  }
}

// --------------------------------------------------------------------------
// Build
// --------------------------------------------------------------------------

function build() {
  const all = loadAllEntries();

  // A record can opt out of having its own URL with "publish": false. It
  // still appears in the manifest (so it stays searchable and openable in
  // the map's drawer) but gets no page — which is the right answer for a
  // one-line pub or well entry. A hundred near-empty pages is the classic
  // doorway-page pattern and drags the whole domain's ranking down; the
  // fix is to earn the page with real prose, not to publish the stub.
  const entries = all.filter((e) => e.publish !== false);
  const unpublished = all.length - entries.length;

  const template = fs.readFileSync(TEMPLATE_FILE, 'utf8');
  const hubTemplate = fs.readFileSync(HUB_TEMPLATE_FILE, 'utf8');
  const categories = sortCategories(Array.from(new Set(entries.map((e) => e.category))));

  // Auto-linking resolves against EVERY record, published or not — an
  // unpublished entry's title can still be MENTIONED and, if it names an
  // externalUrl, still linked there. It is never given a page of its own
  // in dist/ (see the entries filter above), and R.entryHref() is what
  // stops the auto-linker from generating a link to a page that doesn't
  // exist for one that has neither publish nor externalUrl.
  const index = R.buildIndex(all);
  validateEntries(all);

  const perCategoryCount = {};
  const byCategory = {};
  const unresolvedLinks = [];
  const ambiguousLinks = [];

  entries.forEach((entry) => {
    const id = R.entryId(entry);

    // Nested by category and then by slug (dist/flora/eyebright/index.html)
    // rather than one flat folder — tens of thousands of files in a single
    // directory gets slow for git, for file browsers and for GitHub's own
    // viewer well before hitting any hard limit, and this shape is what
    // produces the clean /flora/eyebright/ URL.
    const entryDir = path.join(OUTPUT_DIR, entry.category, id);
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(path.join(entryDir, 'index.html'), fillEntry(template, entry, index), 'utf8');

    // The old flat URL, preserved.
    fs.writeFileSync(path.join(OUTPUT_DIR, entry.category, id + '.html'), redirectStub(entry), 'utf8');

    perCategoryCount[entry.category] = (perCategoryCount[entry.category] || 0) + 1;
    (byCategory[entry.category] = byCategory[entry.category] || []).push(entry);
  });

  // ---- manifest.json ----
  // The one file the map fetches at runtime, for both its search index and
  // the drawer's content. Content here is LINK-EXPANDED with %%R%% tokens
  // (see the note at the top of this file) so the drawer gets exactly the
  // same cross-references the static page does, rebased on the fly.
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const manifest = all.map((entry) => {
    const unresolved = [];
    const ambiguous = [];
    const item = {
      id: R.entryId(entry),
      category: entry.category,
      title: entry.title,
      irishTitle: entry.irishTitle,
      summary: R.deriveSummary(entry),
      content: R.linkContent(entry, index, unresolved, ambiguous)
    };
    unresolved.forEach((ref) => unresolvedLinks.push(`${entry.id} → [[${ref}]]`));
    ambiguous.forEach((ref) => ambiguousLinks.push(`${entry.id} → "${ref}" matches more than one entry`));
    // Optional fields, present only where they exist, so most entries'
    // manifest objects stay lean rather than carrying empty keys around.
    if (entry.oghamName) item.oghamName = entry.oghamName;
    if (entry.oghamGloss) item.oghamGloss = entry.oghamGloss;
    if (entry.subCategory) item.subCategory = entry.subCategory;
    if (entry.scientificName) item.scientificName = entry.scientificName;
    if (entry.linkedTo) item.linkedTo = entry.linkedTo;
    if (entry.aliases) item.aliases = entry.aliases;
    if (entry.noAutoLink) item.noAutoLink = true;
    if (entry.publish === false) item.published = false;
    return item;
  });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), JSON.stringify(manifest), 'utf8');

  // ---- home ----
  // Still hand-written (its hero cards carry per-category icons and
  // descriptions a generic loop can't derive from data alone), but its
  // chrome and head are the same generated ones as everywhere else.
  const homeDepth = DEPTHS.home;
  const homeHead = ogTags({
    rel: '', title: CFG.siteName, type: 'website',
    description: 'A digital field guide and research hub for the natural history, antiquities, and Gaelic lore of the Burren, North Clare.'
  });
  const homeHtml = applyCommon(fs.readFileSync(HOME_FILE, 'utf8'), homeDepth, {
    headExtra: homeHead,
    chrome: chromeTag(homeDepth, null, null)
  });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), homeHtml, 'utf8');

  const hubCount = buildHubPages(byCategory, hubTemplate);
  const assetCount = copyAssets();
  const wroteSitemap = writeSitemap(entries, categories);

  // ---- report ----
  console.log(`Built ${entries.length} entry page(s) into ${path.relative(ROOT, OUTPUT_DIR)}/, by category:`);
  Object.keys(perCategoryCount).sort().forEach((cat) => {
    console.log(`  ${cat}/  — ${perCategoryCount[cat]} page(s)`);
  });
  console.log(`Built ${hubCount} hub page(s) and 1 home page.`);
  console.log(`Wrote ${entries.length} redirect stub(s) at the old <category>/<slug>.html paths.`);
  console.log(`Wrote manifest.json (${manifest.length} entries, link-expanded).`);
  console.log(`Copied styles.css and ${assetCount} shared asset(s) into dist/assets/.`);
  if (wroteSitemap) console.log(`Wrote sitemap.xml and robots.txt.`);
  if (unpublished) console.log(`Skipped ${unpublished} record(s) marked "publish": false (still in the manifest).`);
  if (unresolvedLinks.length) {
    console.warn(`\n  ! ${unresolvedLinks.length} unresolved [[wiki link]](s) — rendered as plain text:`);
    unresolvedLinks.slice(0, 20).forEach((l) => console.warn('    ' + l));
    if (unresolvedLinks.length > 20) console.warn(`    …and ${unresolvedLinks.length - 20} more`);
  }
  if (ambiguousLinks.length) {
    console.warn(`\n  ! ${ambiguousLinks.length} ambiguous reference(s) — matched more than one entry, left unlinked:`);
    ambiguousLinks.slice(0, 20).forEach((l) => console.warn('    ' + l));
    if (ambiguousLinks.length > 20) console.warn(`    …and ${ambiguousLinks.length - 20} more`);
    console.warn('    Fix by writing these as "[[category:slug|label]]" instead of a bare name.');
  }

  // ---- link integrity, as a standing part of the build, not a one-off ----
  // Turns "N links checked, none broken" from a manual pass someone has
  // to remember to run into something that fails the build the moment
  // it stops being true. See tools/check-generated-links.js.
  const linkCheck = checkDist(OUTPUT_DIR, path.join(ROOT, '..'));
  console.log(`Verified ${linkCheck.checked} internal reference(s) across ${linkCheck.files} generated page(s).`);
  if (linkCheck.errors.length) {
    console.error(`\nBuild produced ${linkCheck.errors.length} broken internal reference(s):\n`);
    linkCheck.errors.forEach((e) => console.error('  ! ' + e));
    throw new Error(`${linkCheck.errors.length} broken internal reference(s) in generated output — see above.`);
  }
}

build();
