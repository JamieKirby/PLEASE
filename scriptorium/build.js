#!/usr/bin/env node
/**
 * Zero-framework static site build.
 *
 * Reads every JSON file in data/ (one file per category — data/flora.json,
 * data/story.json, etc. — rather than one giant database.json, so each
 * file stays small enough to read/edit/review in full even as the total
 * entry count grows into the thousands) plus template.html, replaces the
 * four placeholders for each entry, and writes one HTML file per entry
 * into dist/<category>/<id>.html.
 *
 * Run with:  node build.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const TEMPLATE_FILE = path.join(ROOT, 'template.html');
const HUB_TEMPLATE_FILE = path.join(ROOT, 'hub-template.html');
const OUTPUT_DIR = path.join(ROOT, 'dist');

// Known categories get a proper heading ("story" reads oddly as a page
// title); anything not listed here (a category added later without
// updating this map) still gets a reasonable one via capitalizeWord
// rather than silently reading as a lowercase, unbuilt-looking gap.
const CATEGORY_TITLES = {
  flora: 'Flora',
  fauna: 'Fauna',
  story: 'Stories & Sites'
};
function capitalizeWord(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function categoryTitle(cat) { return CATEGORY_TITLES[cat] || capitalizeWord(cat); }

// A fixed reading order for the categories the site nav already knows
// about; anything added later that isn't in this list falls in
// afterwards, alphabetically, rather than being silently dropped from
// the nav the way a purely hardcoded link list would have done. This is
// the actual fix for "the nav only ever mentions Flora and Stories" —
// a third data/fauna.json file now produces its own Fauna link
// everywhere the nav appears, with no template edited by hand.
const PREFERRED_CATEGORY_ORDER = ['flora', 'fauna', 'story'];
function sortCategories(cats) {
  return cats.slice().sort((a, b) => {
    const ai = PREFERRED_CATEGORY_ORDER.indexOf(a);
    const bi = PREFERRED_CATEGORY_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
}
// prefix is '' from the Scriptorium home page itself (dist/index.html,
// category dirs are direct children) and '../' from anywhere one folder
// deeper (an entry page or a hub page) — same relative-path reasoning
// as MAP_RELATIVE_PATH below, just one level shallower.
function navLinksHtml(categories, prefix) {
  return categories
    .map((cat) => `<a href="${prefix}${cat}/">${escapeHtml(categoryTitle(cat))}</a>`)
    .join('\n    ');
}

// ---- The one thing you need to check/edit for your actual deployment ----
// Every entry page needs a way back into the interactive map's own
// "discovery" experience (not just the map's homepage — landing there
// with zero context after reading about Spring Gentian specifically
// would be a weak handoff). This is a RELATIVE path from an entry page
// (dist/<category>/<id>.html) to wherever index.html actually lives, so
// it never hardcodes a domain the way the old BASE_URL did — that
// mismatch after moving to a new GitHub project is exactly what caused
// the last broken-link bug. If dist/'s contents get deployed as e.g.
// scriptorium/<category>/<id>.html sitting next to a top-level
// index.html, '../../index.html' is correct as-is (up out of
// <category>/, up out of scriptorium/, to the repo root). Adjust this
// one constant if your actual folder layout differs.
const MAP_RELATIVE_PATH = '../../index.html';

// Strips HTML tags and collapses whitespace — used as a fallback
// plain-text summary when an entry doesn't supply its own `summary`
// field, for the search result card's snippet and the page's meta
// description. A real authored summary (see the sample data) will
// almost always read better than an auto-truncated one, but this means
// a missing summary never breaks anything, just reads a bit blunter.
function deriveSummary(entry) {
  if (entry.summary) return entry.summary;
  const plain = entry.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.length > 160 ? plain.slice(0, 157).trim() + '…' : plain;
}

// Escapes plain-text fields (title, irishTitle, category) so a stray
// "&", "<", or ">" typed into the data can't accidentally break the
// page's markup. `content` is deliberately NOT run through this — it's
// meant to already contain real HTML (paragraphs, emphasis, etc.), so
// escaping it would turn your own tags into visible text on the page
// instead of rendering them. That's fine as long as `content` stays
// hand-authored by you; if this ever accepted outside input, that field
// would need its own sanitising step before being inserted raw.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Wraps any OTHER entry's title, found as a substring of this entry's
// content, in a real <a href> to that entry's own page — same idea as
// the map's own auto-linking of town descriptions, just done once here
// at build time instead of live in a browser. Matches longest title
// first (so a title that's itself a substring of a longer one, e.g.
// "Doolin" inside "Doolin Cave", doesn't steal the shorter match) and
// only on a word boundary, so it can't clip the middle of an unrelated
// longer word. Every link is a real <a href="..."> — per your rule,
// that's what lets a crawler follow it and a screen reader announce a
// real destination, regardless of any JS on top of it.
function autoLinkContent(content, entries, selfId) {
  const candidates = entries
    .filter((e) => e.id !== selfId)
    .sort((a, b) => b.title.length - a.title.length);

  function isWordChar(ch) {
    return !!ch && /[A-Za-z]/.test(ch);
  }

  let result = '';
  let i = 0;
  outer:
  while (i < content.length) {
    for (const other of candidates) {
      const title = other.title;
      if (content.substr(i, title.length) === title &&
          !isWordChar(content[i - 1]) && !isWordChar(content[i + title.length])) {
        const href = `../${other.category}/${other.id}.html`;
        result += `<a href="${href}">${title}</a>`;
        i += title.length;
        continue outer;
      }
    }
    result += content[i];
    i++;
  }
  return result;
}

// String.split(literal).join(replacement) replaces every occurrence,
// not just the first — same effect as a global regex replace, but with
// no need to escape regex special characters in the placeholder text.
function fillTemplate(template, entry, allEntries, categories) {
  const linkedContent = autoLinkContent(entry.content, allEntries, entry.id);
  // The map's own drawer system (siteData/townData/legendData, and now
  // scriptoriumEntries) looks everything up by its display title, not a
  // slug — so the deep-link back to the map uses the title too, kept
  // consistent with that rather than introducing a second, id-based
  // lookup path the map would need special-casing to support.
  const mapLink = `${MAP_RELATIVE_PATH}?entry=${entry.category}:${encodeURIComponent(entry.title)}`;
  // A flat placeholder can't conditionally omit a whole element the way
  // a real template engine could — so the *decision* of whether to show
  // an Irish-name line at all happens here, in JS, rather than leaving
  // template.html to render an empty <p class="entry-irish"></p> for
  // every entry that doesn't have one (most of the flora set, it turns
  // out — real species data rarely comes with an Irish common name
  // pre-filled, unlike the placenames used for towns/sites).
  const irishBlock = entry.irishTitle
    ? `<p class="entry-irish">${escapeHtml(entry.irishTitle)}</p>`
    : '';
  // Same reasoning as irishBlock above — most entries don't have both of
  // these (story entries have neither at all), so the dot-separator only
  // appears between two values that both actually exist, not baked into
  // the template as a fixed "X · Y" shape that would leave a dangling
  // separator when one side is empty.
  const metaParts = [];
  if (entry.subCategory) metaParts.push(`<span class="entry-subcategory">${escapeHtml(entry.subCategory)}</span>`);
  if (entry.scientificName) metaParts.push(`<span class="entry-scientific-name">${escapeHtml(entry.scientificName)}</span>`);
  const metaRow = metaParts.length
    ? `<p class="entry-meta-row">${metaParts.join('<span class="entry-meta-dot">&middot;</span>')}</p>`
    : '';
  return template
    .split('{{TITLE}}').join(escapeHtml(entry.title))
    .split('{{IRISH_BLOCK}}').join(irishBlock)
    .split('{{IRISH}}').join(escapeHtml(entry.irishTitle))
    .split('{{META_ROW}}').join(metaRow)
    .split('{{CATEGORY}}').join(escapeHtml(entry.category))
    .split('{{SUMMARY}}').join(escapeHtml(deriveSummary(entry)))
    .split('{{CONTENT}}').join(linkedContent)
    .split('{{MAP_LINK}}').join(mapLink)
    .split('{{NAV_LINKS}}').join(navLinksHtml(categories, '../'));
}

// Reads every *.json file in data/ and concatenates their arrays into
// one list. Splitting by category instead of one database.json keeps
// each individual file small and independently reviewable no matter how
// large the *total* dataset grows — a git diff after editing one flora
// entry only ever touches data/flora.json, not a single multi-megabyte
// file shared by everything on the site.
function loadAllEntries() {
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'));
  let entries = [];
  files.forEach((file) => {
    const parsed = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
    entries = entries.concat(parsed);
  });
  return entries;
}

// One browsable index page per category (dist/<category>/index.html) —
// until now the ONLY ways into any entry were Cmd+K search inside the
// map, an auto-linked mention inside some other entry's prose, or
// knowing the exact URL. Nothing let a person just look at what's here.
// Sorted alphabetically by title for now — a location-grouped view is
// the eventual goal but most entries don't have real location data yet
// (see the flora "Known Areas" research), so alphabetical is the
// honest interim default rather than a location grouping that would be
// mostly empty. Real <a href> list items throughout, same rule as the
// entry pages themselves — a crawler or screen reader needs a real
// destination, not a JS-driven click handler.
// Shared by both the Featured section and the full alphabetical list
// below it — same markup either way, so a featured entry never drifts
// out of sync with how its own category's full listing renders it.
function hubListItem(entry) {
  const irish = entry.irishTitle ? `<span class="hub-entry-irish">${escapeHtml(entry.irishTitle)}</span>` : '';
  return `      <li><a href="./${entry.id}.html"><span class="hub-entry-title">${escapeHtml(entry.title)}</span>${irish}</a></li>`;
}

function buildHubPages(entries, hubTemplate, categories) {
  const byCategory = {};
  entries.forEach((entry) => {
    (byCategory[entry.category] = byCategory[entry.category] || []).push(entry);
  });
  Object.keys(byCategory).forEach((cat) => {
    const list = byCategory[cat].slice().sort((a, b) => a.title.localeCompare(b.title));
    const items = list.map(hubListItem).join('\n');
    // Featured is opt-in per entry (`"featured": true` in that entry's
    // data/*.json record) rather than a fixed count or a separate file
    // to maintain — a category with nothing marked featured just gets
    // no Featured section at all, same "honest interim default" as the
    // alphabetical-only sort above until real location data exists.
    const featured = list.filter((entry) => entry.featured);
    const featuredSection = featured.length
      ? `<h2 class="hub-featured-heading">Featured</h2>\n    <ul class="hub-list hub-list-featured">\n${featured.map(hubListItem).join('\n')}\n    </ul>`
      : '';
    const html = hubTemplate
      .split('{{CATEGORY}}').join(escapeHtml(cat))
      .split('{{CATEGORY_TITLE}}').join(escapeHtml(categoryTitle(cat)))
      .split('{{ENTRY_COUNT}}').join(String(list.length))
      .split('{{ENTRY_LIST}}').join(items)
      .split('{{FEATURED_SECTION}}').join(featuredSection)
      .split('{{NAV_LINKS}}').join(navLinksHtml(categories, '../'));
    const outDir = path.join(OUTPUT_DIR, cat);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
  });
  return Object.keys(byCategory).length;
}

function build() {
  const entries = loadAllEntries();
  const template = fs.readFileSync(TEMPLATE_FILE, 'utf8');
  const hubTemplate = fs.readFileSync(HUB_TEMPLATE_FILE, 'utf8');
  // Computed once from whatever data/*.json files actually exist, not
  // hardcoded — this is what makes adding data/fauna.json alone (no
  // template edits) enough to put a Fauna link in the nav everywhere.
  const categories = sortCategories(Array.from(new Set(entries.map((e) => e.category))));

  const seenIds = new Set();
  const perCategoryCount = {};

  entries.forEach((entry) => {
    if (seenIds.has(entry.id)) {
      console.warn(`  ! duplicate id "${entry.id}" — this entry will overwrite an earlier one`);
    }
    seenIds.add(entry.id);

    // Nested by category (dist/flora/eyebright.html, not one flat
    // dist/ folder) — tens of thousands of files in a single directory
    // gets slow for git, for most file browsers, and for GitHub's own
    // file viewer, well before hitting any hard size limit. Nesting
    // also matches clean category-based URLs (/flora/eyebright/).
    const outDir = path.join(OUTPUT_DIR, entry.category);
    fs.mkdirSync(outDir, { recursive: true });

    const html = fillTemplate(template, entry, entries, categories);
    fs.writeFileSync(path.join(outDir, `${entry.id}.html`), html, 'utf8');
    perCategoryCount[entry.category] = (perCategoryCount[entry.category] || 0) + 1;
  });

  // The one file the map fetches at runtime (see loadScriptoriumManifest
  // in index.html) — for both its search index and the on-demand drawer
  // content when someone opens a Scriptorium entry from inside the map.
  // Deliberately the RAW content, not the auto-linked version written
  // into the static pages above: those links are relative to a page
  // living at dist/<category>/<id>.html, and would resolve to the wrong
  // place if that same HTML got embedded inside the map's own page
  // instead. Fine at today's scale (a few KB per entry); once this
  // dataset is genuinely in the thousands, the natural next step is
  // fetching each entry's content on demand instead of bundling
  // everything into one manifest up front — worth revisiting then, not
  // before.
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const manifest = entries.map((entry) => {
    const item = {
      id: entry.id,
      category: entry.category,
      title: entry.title,
      irishTitle: entry.irishTitle,
      summary: deriveSummary(entry),
      content: entry.content
    };
    // Optional fields — present only for entries that actually have
    // them (currently just a couple of flora entries), so most entries'
    // manifest objects stay lean rather than carrying empty keys around.
    if (entry.oghamName) item.oghamName = entry.oghamName;
    if (entry.oghamGloss) item.oghamGloss = entry.oghamGloss;
    if (entry.subCategory) item.subCategory = entry.subCategory;
    if (entry.scientificName) item.scientificName = entry.scientificName;
    return item;
  });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), JSON.stringify(manifest), 'utf8');

  // styles.css and home.html both live in scriptorium/ (source), not
  // scriptorium/dist/ (build output) — same reason template.html and
  // hub-template.html do: they're inputs to the build, not per-entry
  // generated pages. The actual root cause of "no CSS on any static
  // page": every template has linked ../styles.css since the very first
  // build, but nothing ever copied that file into dist/, so it 404'd
  // silently on every single page regardless of what was ever written
  // in it. Same gap would apply to home.html — a bespoke, hand-written
  // page rather than a data-driven templated one, so a straight copy
  // rather than fillTemplate().
  fs.copyFileSync(path.join(ROOT, 'styles.css'), path.join(OUTPUT_DIR, 'styles.css'));
  // home.html is still hand-written (its hero cards carry per-category
  // icons/descriptions a generic loop can't derive from data alone) —
  // but its top nav bar is the same data-driven list as every other
  // page's, via {{NAV_LINKS}}, so it no longer needs a manual edit just
  // to keep pace with which category links exist elsewhere.
  const homeHtml = fs.readFileSync(path.join(ROOT, 'home.html'), 'utf8')
    .split('{{NAV_LINKS}}').join(navLinksHtml(categories, ''));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), homeHtml, 'utf8');

  const total = entries.length;
  const hubCount = buildHubPages(entries, hubTemplate, categories);
  console.log(`Built ${total} page(s) into ${path.relative(ROOT, OUTPUT_DIR)}/, by category:`);
  Object.keys(perCategoryCount).sort().forEach((cat) => {
    console.log(`  ${cat}/  — ${perCategoryCount[cat]} page(s)`);
  });
  console.log(`Built ${hubCount} hub/index page(s) (dist/<category>/index.html).`);
  console.log(`Wrote manifest.json (${total} entries) for the map's runtime search + drawer content.`);
  console.log(`Copied styles.css and home.html (as dist/index.html) into the build output.`);
}

build();
