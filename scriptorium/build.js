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
const OUTPUT_DIR = path.join(ROOT, 'dist');

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
  return template
    .split('{{TITLE}}').join(escapeHtml(entry.title))
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

function build() {
  const entries = loadAllEntries();
  const template = fs.readFileSync(TEMPLATE_FILE, 'utf8');

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
  const manifest = entries.map((entry) => ({
    id: entry.id,
    category: entry.category,
    title: entry.title,
    irishTitle: entry.irishTitle,
    summary: deriveSummary(entry),
    content: entry.content
  }));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), JSON.stringify(manifest), 'utf8');

  const total = entries.length;
  console.log(`Built ${total} page(s) into ${path.relative(ROOT, OUTPUT_DIR)}/, by category:`);
  Object.keys(perCategoryCount).sort().forEach((cat) => {
    console.log(`  ${cat}/  — ${perCategoryCount[cat]} page(s)`);
  });
  console.log(`Wrote manifest.json (${total} entries) for the map's runtime search + drawer content.`);
}

build();
