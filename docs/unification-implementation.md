# Unification — implementation notes

Companion to `unified-architecture.md`, which is the design argument. This
is the record of what actually got built, what deliberately didn't, and
the handful of things that need a decision or a check from you.

Phases 0–3 of that document are done, plus most of Phase 4's SEO work.
Phase 4's data migration (moving `siteData`/`townData`/`legendData` out of
`index.html`) is **not** done — see "Deliberately deferred" below.

---

## New files

Everything shared lives in `scriptorium/assets/` and is copied to
`scriptorium/dist/assets/` by `build.js`. That location was chosen over a
top-level `/assets/` on purpose: it rides the build-and-deploy path that
already exists for `styles.css`, so **no workflow change is needed.**

| File | What it owns |
|---|---|
| `tokens.css` | The palette, type scale, radius scale, and the cross-document view-transition rules. Linked by the map *and* every page. |
| `site-config.js` | Category titles, reading order, crossing copy, `siteUrl`. Read by `build.js` (Node) and both surfaces (browser). |
| `entry-render.js` | **One** entry renderer, used by `build.js` and the map's drawer. Auto-linking, wiki-links, meta rows, verse. |
| `state.js` | Field Notes, soundscape prefs, read history, map-view handoff. Same localStorage keys the map already used. |
| `soundscape.js` | The ambient engine, extracted from `index.html`. |
| `seam.js` | Smart back, speculation rules, bfcache hazard check, soundscape resume. |
| `chrome.js` / `chrome.css` | `<burren-chrome>` — the burger menu, ⌘K search and bookmark star on Scriptorium pages. |

---

## What changed, by seam

### Seam 1 — two identity keys

The slug is canonical now. `resolveScriptorium()` in the map accepts a
slug, a display title, **or** any former title listed in a record's new
optional `aliases: []`. `?entry=flora:Spring%20Gentian` links that were
already published keep working; new links use `?entry=flora:spring-gentian`.

Renaming a title can no longer orphan a link.

### Seam 2 — two content renderers

`build.js` and `openScriptoriumDrawer()` both call
`BurrenRender.renderParts()` now. The drawer gained, for free, everything
the static page already had: auto-linked cross-references, the
subCategory · scientificName meta row, the verse treatment for poetry, and
the ogham line (which was in the flora data and rendered nowhere).

The link-base problem that forced `manifest.json` to ship *unlinked*
content is solved with a `%%R%%` token rather than a base path. The
manifest now carries fully linked content and each host substitutes its
own route to the Scriptorium root. Nothing is root-relative, nothing
hardcodes an origin — so a move to a GitHub Pages project subpath won't
repeat the old `BASE_URL` breakage.

Cross-reference links inside the drawer are intercepted by
`wireScriptoriumLinks()` and open the next entry *in the drawer*. The
`href` stays real for crawlers and screen readers; the interception is
pure enhancement.

### Seam 3 — two chrome systems

Every Scriptorium page now has the burger menu, ⌘K search (`/` works too),
and the bookmark star. Three things make it one product rather than two
lookalikes:

- **The search index is `manifest.json`** — the same static file, the same
  ranking. This was always possible and simply wasn't wired up.
- **The star is the same star.** `state.js` writes `burrenFieldNotesV1`
  with the same `kind::name` id format `index.html` has always used, so
  existing saves survive untouched and a flower starred from a Google
  result is in your Field Notes when you open the map.
- **The soundscape is the same engine**, with volume/mode/playing carried
  across in shared state.

`index.html` keeps its own (older, already-debugged) burger menu. Adopting
`<burren-chrome>` there is now a small mechanical change rather than a
design question, and was left out so this could ship without touching the
map's working UI.

### Seam 4 — two data owners

Partly addressed. `publish: false` is supported on any record: it stays in
the manifest and the map, but gets no URL. That's the thin-content gate for
one-line pubs and wells when their data moves over.

---

## Crossing behaviour

- **`target="_blank"` is gone** from every map→Scriptorium link.
- **The address bar reads the entry's canonical URL** while its drawer is
  open. Copy it out of the map, paste it anywhere, and it lands on the
  real page. Reload and you get the page rather than the default map view.
  `document.title` and `og:title` follow, so an iOS share sheet offers the
  entry's name instead of "The Burren — Field Map".
- **"Return to the ground"** uses `history.back()` when you arrived from
  the map, so the back/forward cache restores the live map instantly —
  camera, filters and drawer stack intact, no MapLibre re-init.
  `seam.js` warns in the console if anything ever registers an
  `unload`/`beforeunload` listener, since that silently disqualifies the
  page from bfcache and nothing else would tell you.
- **View transitions** are declared in `tokens.css` for both documents,
  with the entry title morphing across. This replaced the `body.leaving`
  fade, which charged a flat 160ms to every single click.
- **Speculation rules** prerender entry pages on hover but only *prefetch*
  the map — prerendering the map would boot MapLibre and pull tiles for a
  visit that may never happen.
- **`?identify=1` and `?q=`** let a static page hand off to the map's
  species-ID overlay and search.

---

## URLs

Entries moved from `/scriptorium/flora/eyebright.html` to
`/scriptorium/flora/eyebright/`. The old path is still written as a
redirect stub carrying a canonical tag, a meta refresh and a real visible
link — so it works for crawlers, browsers, and anyone with both JS and
redirects disabled. **Nothing that was ever shared or bookmarked breaks.**

Service worker cache bumped `v1` → `v2` so returning visitors aren't served
the old pages out of cache.

---

## Verification done

- All 129 entries build; 4 hubs, 1 home, 129 redirect stubs.
- **2,144 internal links checked against a simulated deployment — all resolve.**
- Every JS file and the inline script in `index.html` pass `node --check`.
- Auto-linker unit-tested: longest-title-first (`Doolin Cave` beats
  `Doolin`), never nests inside an existing `<a>`, never rewrites an
  attribute value, resolves `[[slug|label]]` and aliases, reports
  unresolved refs as build warnings.
- Bookmark round-trip verified to write the exact pre-existing key format.

**Not verified:** anything needing a real browser — view transitions,
bfcache restore, the custom element rendering, audio. No network in the
build environment, so those want a look on a real device.

---

## Two things that need you

**1. Set `siteUrl`.** In `scriptorium/assets/site-config.js`, currently
blank. Until it's set, `build.js` deliberately skips `sitemap.xml`,
`robots.txt`, canonical tags and Open Graph rather than emitting ones
pointing at a guessed origin. Set it to your real deployed URL (no
trailing slash) and rerun — that's the whole SEO switch.

**2. Confirm `scriptorium/dist/assets/` is deployed.** It should be, since
it's inside `dist/` alongside `styles.css` and `manifest.json` — but if
your workflow copies a hand-listed set of files rather than the whole
folder, add it. If the assets 404, the map degrades gracefully (bookmarks
go in-memory, the drawer falls back to plain markup, no soundscape) and
logs a warning rather than breaking, but the pages will lose their chrome.

---

## Response to the code review

A second-pass review approved the architecture and flagged two required
changes plus one recommended one. Both required changes were real bugs;
all three are now fixed and verified.

**1. Identity was global, not category-scoped.** `buildIndex()` keyed
records on a bare slug, so `flora:ash` and `story:ash` could collide in
the lookup tables even though they'd produce distinct URLs — the second
would silently overwrite the first in memory (nothing on disk was lost,
but resolution broke). Fixed: every internal index is now keyed on
`category:slug` (`entryKey()`), which is the only genuinely unique
identity. Bare slug/title/alias lookups (`resolveRef()`) are only trusted
when exactly one record matches; an ambiguous bare reference is now
reported as a build warning instead of silently picking one. `build.js`'s
duplicate check was upgraded from a `console.warn` to a hard failure
(`validateEntries()`, run before anything is written) — a genuine
`category:slug` collision now stops the build with a clear message
listing both conflicting records, rather than shipping broken.

**2. The auto-linker could generate dead links to unpublished records.**
A `publish: false` record has no page, but the old auto-linker indexed it
like anything else, so mentioning its title elsewhere generated a link to
a URL that was never written. Fixed with `entryHref()`: an unpublished
record with no `externalUrl` is excluded from the link candidate pool
entirely — both the title auto-linker and `[[wiki links]]` — and renders
as plain text instead.

**3. (Recommended) `smartBack()`'s same-origin referrer check was too
broad.** Any Scriptorium page counted as "arrived from the map," so
"Return to the ground" could `history.back()` to the previous *article*
instead. Fixed with a one-shot `sessionStorage` flag, armed only on an
actual map→page navigation (a delegated click listener in `index.html`)
and consumed exactly once, at page-*load* time — not click time — so a
Scriptorium→Scriptorium hop can't inherit a stale "yes" from a page
further back.

**4. Link validation is now a standing part of the build, not a manual
pass.** `tools/check-generated-links.js` walks every generated page,
checks every `href`/`src` resolves to a real file (accounting for the
fact that `dist/`'s contents become `scriptorium/` at deploy time, so a
path like `../../../favicon.svg` correctly resolves against the repo
root, not inside `dist/`), confirms no `%%R%%` token was left
un-substituted, and confirms nothing links to a `publish: false` record.
`build.js` runs it as its final step and throws if anything fails —
"2,144 links checked, none broken" is now something the build itself
guarantees, not something that has to be remembered.

### Verification of the fixes

- Cross-category same-slug (`flora:holywell` + `story:holywell`): builds clean, 0 errors.
- Same-category same-slug: build fails immediately with
  `duplicate canonical entry "story:holywell" — "Holywell (first)" and "Holywell (dup)" both produce this URL`.
- An unpublished record mentioned via both a title match and a
  `[[wiki link]]`: both render as plain text, zero `<a>` tags generated,
  confirmed by inspecting the built page directly.
- The link checker itself was tested against a deliberately broken
  reference (confirmed it's caught) and against the real, unmodified
  dataset (confirmed 2,134 references check clean end-to-end through the
  full build, including the new validation step) — checked from a fresh
  unzip of the delivered zip, not the working copy.

Not addressed, and not required for this pass: the reviewer's suggestion
to also union-find ambiguous-alias detection across the *whole* dataset
rather than per-category, and their note that browser-dependent behaviour
(view transitions, bfcache, the custom element, audio, iOS sharing) still
needs a device pass — both stand as before.

## Deliberately deferred

**The Phase 4 data migration.** `siteData`, `townData` and `legendData` are
still JS object literals inside `index.html`, so sites, towns, legends,
pubs and holy wells still have no static pages and no SEO. This is real
surgery on a 6,700-line file and it deserves its own pass with its own
verification, rather than being bundled into a change that already touches
this much. Everything it needs is now in place: the render layer, the
`publish` gate, the slug discipline and the build's page-writing loop all
work on any category.

**`<burren-chrome>` on the map.** See Seam 3 above.

**OG images from `specimenSvg()`.** Needs a rasteriser (`resvg` or `sharp`)
in the build, which means a dependency — the first one this project would
have. Worth it, but worth asking first.
