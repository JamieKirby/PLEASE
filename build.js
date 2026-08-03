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
  story: 'Stories & Sites'
};
function capitalizeWord(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function categoryTitle(cat) { return CATEGORY_TITLES[cat] || capitalizeWord(cat); }

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
function fillTemplate(template, entry, allEntries) {
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
  return template
    .split('{{TITLE}}').join(escapeHtml(entry.title))
    .split('{{IRISH_BLOCK}}').join(irishBlock)
    .split('{{IRISH}}').join(escapeHtml(entry.irishTitle))
    .split('{{CATEGORY}}').join(escapeHtml(entry.category))
    .split('{{SUMMARY}}').join(escapeHtml(deriveSummary(entry)))
    .split('{{CONTENT}}').join(linkedContent)
    .split('{{MAP_LINK}}').join(mapLink);
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
function buildHubPages(entries, hubTemplate) {
  const byCategory = {};
  entries.forEach((entry) => {
    (byCategory[entry.category] = byCategory[entry.category] || []).push(entry);
  });
  Object.keys(byCategory).forEach((cat) => {
    const list = byCategory[cat].slice().sort((a, b) => a.title.localeCompare(b.title));
    const items = list.map((entry) => {
      const irish = entry.irishTitle ? `<span class="hub-entry-irish">${escapeHtml(entry.irishTitle)}</span>` : '';
      return `      <li><a href="./${entry.id}.html"><span class="hub-entry-title">${escapeHtml(entry.title)}</span>${irish}</a></li>`;
    }).join('\n');
    const html = hubTemplate
      .split('{{CATEGORY}}').join(escapeHtml(cat))
      .split('{{CATEGORY_TITLE}}').join(escapeHtml(categoryTitle(cat)))
      .split('{{ENTRY_COUNT}}').join(String(list.length))
      .split('{{ENTRY_LIST}}').join(items);
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

    const html = fillTemplate(template, entry, entries);
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
    return item;
  });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), JSON.stringify(manifest), 'utf8');

  const total = entries.length;
  const hubCount = buildHubPages(entries, hubTemplate);
  console.log(`Built ${total} page(s) into ${path.relative(ROOT, OUTPUT_DIR)}/, by category:`);
  Object.keys(perCategoryCount).sort().forEach((cat) => {
    console.log(`  ${cat}/  — ${perCategoryCount[cat]} page(s)`);
  });
  console.log(`Built ${hubCount} hub/index page(s) (dist/<category>/index.html).`);
  console.log(`Wrote manifest.json (${total} entries) for the map's runtime search + drawer content.`);
}

build();
