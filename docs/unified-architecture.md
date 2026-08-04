# Unifying the Map and the Scriptorium

*One canonical URL per subject, two ways of rendering it.*

Design document. Nothing here is implemented yet — this is the argument, the
options, and the order of operations.

---

## 0. Restating the question

The ticket says "burger menu staying visible on Scriptorium pages —
architectural question." That is true but it is a symptom, not the question.
The real question is two questions:

1. **Which surface is the shell?** Is the map an app that happens to contain
   reading material, or is the Scriptorium a site that happens to contain a
   map? Right now the answer is "both, separately," which is why nothing is
   shared.
2. **What is the canonical identity of a subject?** A flower currently has two
   identities: `spring-gentian` (the static page) and `"Spring Gentian"` (the
   map's lookup key). Every crossing between the two worlds is a translation,
   and translations leak.

Answer those two and the burger menu falls out for free — along with shared
bookmarks, shared search, shared audio, and a back button that behaves.

---

## 1. Diagnosis — the four seams

Read from the current code, not assumed.

### Seam 1 — Two identity keys

The map keys everything by **display title**:

```js
scriptoriumEntries[entry.title] = entry;   // loadScriptoriumManifest
siteData[name], townData[name], legendData[name]
```

The static site keys everything by **slug id**: `dist/flora/spring-gentian.html`.

The bridge is `{{MAP_LINK}}`, which build.js constructs as
`?entry=<category>:<encodeURIComponent(title)>` — and build.js's own comment
admits why: *"The map's own drawer system looks everything up by its display
title, not a slug."*

Consequences: rename a title in `flora.json` and every published deep link
breaks silently. Two entries in different categories with the same title
collide. `encodeURIComponent` of a title with an apostrophe or a fada is fragile
in a way a slug never is.

### Seam 2 — Two content renderers

`fillTemplate()` in `build.js` and `openScriptoriumDrawer()` in `index.html`
build *different HTML from the same record*:

| | Static page | Map drawer |
|---|---|---|
| Auto-linked cross-references | yes | **no** |
| Meta row (subCategory · scientificName) | yes | no |
| Irish name | `<p class="entry-irish">` | `<div class="irish-name">` |
| Verse styling for poetry | yes | no |
| Ogham fields | available | not rendered |

build.js explains why the manifest ships *raw* content: the auto-linked hrefs
are relative to `dist/<category>/<id>.html` and would resolve wrongly inside the
map. That reasoning is correct given the current design — and it is exactly the
constraint we should remove, because "content parity" is currently a thing a
human has to remember, forever, in two files.

### Seam 3 — Two chrome systems

`index.html` has: burger menu, ⌘K search overlay, bookmarks, ambient soundscape,
Identify a Species, Routes, drawer history sync, scroll restoration.

`template.html` has: a flat `<nav>` and a "Back to the Map" link.

Nothing is shared. Not the markup, not the CSS, not the state.

### Seam 4 — Two data owners (and the SEO hole)

`siteData` / `townData` / `legendData` — plus pubs, holy wells, graves, notable
figures — live as **JS object literals inside `index.html`**. Flora, fauna,
story and poetry live in `scriptorium/data/*.json`.

So the crawlable corpus today is **129 entries** (60 flora, 62 fauna, 5 poetry,
2 story). Every archaeological site, every village, every holy well, every
legend is invisible to search engines. Those are precisely the high-intent
queries: *"Poulnabrone Dolmen"*, *"St Brigid's Well Liscannor"*, *"pubs in
Doolin"*, *"Kilfenora cathedral"*. The half of the corpus with the best SEO
prospects is the half with no pages.

### Plus three smaller ones

- **Duplicated design tokens.** `scriptorium/styles.css` says it plainly:
  *"the two documents can't share CSS custom properties across files, so these
  are a deliberate, exact-value copy… Keep them in sync."* They can share, via
  a third file both link.
- **`target="_blank"`.** The drawer's "View full citation & sources ↗" spawns a
  tab. This is the single most "these are two different websites" moment in the
  whole product.
- **A missing file.** `index.html` references
  `scriptorium/assets/scriptorium-soundscape.js` as the canonical copy of the
  soundscape engine, inlined into the map "to keep this map file
  self-contained." That file is **not in the current package.** Either it was
  never committed or it was dropped — worth checking git history before
  building on the assumption it exists.

---

## 2. The unifying principle

> **Every subject in the Burren — a flower, a fox, a wedge tomb, a village, a
> poem — has exactly one canonical URL. That URL is served as a static,
> crawlable HTML page. The map can *also* render that same URL, in place, as a
> drawer, without a page load. Which renderer you get depends on how you
> arrived, not on which "site" you are on.**

Concretely, `/scriptorium/flora/spring-gentian/`:

- Typed, crawled, or shared from a message → the **static page**.
- Opened from inside the map → the **drawer**, with `history.pushState()`
  setting the address bar to exactly that string.

This one move converts "moving between two areas" from a *navigation* problem
into a *rendering* problem, and it pays out immediately:

- Copy the URL out of the map, paste it anywhere — it works, and it looks like
  a real page, because it is one.
- Reload while a deeper dive is open — you land on the page, not the default
  map view.
- Share to iOS Messages from the map — the share sheet picks up the entry's own
  title and OG image, not "The Burren".
- Google indexes the same URL your users actually pass around.
- The existing History API drawer stack already does most of the work; it just
  needs to push a real path instead of an opaque state object.

This is how Google Maps, Airbnb and Zillow handle the identical problem. It is
not exotic.

---

## 3. The layer cake

Five layers, each with exactly one owner. Right now layers 1, 3, 4 and 5 each
have two owners, which is the whole problem.

```
┌───────────────────────────────────────────────────────────┐
│ 5. RENDER      assets/entry-render.js                     │
│                one renderEntry(entry, ctx) → HTML         │
│                used by build.js (Node) AND the drawer     │
├───────────────────────────────────────────────────────────┤
│ 4. STATE       assets/state.js                            │
│                namespaced, versioned localStorage         │
│                bookmarks · soundscape · read history      │
├───────────────────────────────────────────────────────────┤
│ 3. CHROME      assets/chrome.js + chrome.css              │
│                <burren-chrome context="map|page">         │
│                burger · ⌘K · bookmarks · audio · footer   │
├───────────────────────────────────────────────────────────┤
│ 2. BUILD       scriptorium/build.js  (grows into          │
│                the site generator for everything)         │
├───────────────────────────────────────────────────────────┤
│ 1. CONTENT     data/*.json — ALL categories               │
│                flora fauna story poetry sites towns       │
│                legends pubs wells graves figures          │
└───────────────────────────────────────────────────────────┘
```

Layer 5 is the highest-leverage single change in this document, so it gets its
own section below.

---

## 4. Fixing identity (Seam 1)

**Rules:**

1. `id` (slug) is canonical. `title` is display-only and may change freely.
2. Every record gains `aliases: []` — old titles, alternative spellings, Irish
   forms. build.js emits `aliases.json` mapping every alias → slug.
3. The map gets one resolver, and all lookups go through it:

```js
// Accepts a slug, a display title, or a known alias. Returns the record
// or null. Every call site that currently does siteData[name] goes
// through this instead, so a title rename can never orphan a link again.
function resolveRef(ref) {
  return byId[ref] || byId[aliasMap[ref]] || null;
}
```

4. `?entry=flora:Spring%20Gentian` keeps working forever, but is legacy: on
   boot, if it resolves, `history.replaceState()` rewrites the address bar to
   the canonical path before anything else happens.
5. **Slug stability rule.** Once a slug is published it never changes. If a
   title change makes the old slug wrong, add the old slug to
   `redirects.json`; build.js emits a stub page carrying
   `<link rel="canonical">` plus a meta refresh. Ugly, cheap, correct.

**Bonus fix while we're here — the auto-linker.** `autoLinkContent()` matches
*any* other entry's title as a substring on word boundaries. It already
special-cases longest-first so "Doolin" doesn't steal "Doolin Cave," but the
approach is inherently a false-positive machine as the corpus grows (an entry
titled "Ash" will start eating prose). Suggested upgrade: explicit wiki-links in
the content field —

```
"The pavement here is threaded with [[spring-gentian|gentian]] in May."
```

— resolved at build time against the slug index, with the existing
title-substring pass kept as a fallback for un-annotated prose. Editorial
control, no false positives, and unresolved links become build warnings instead
of silent nothing.

---

## 5. Fixing render parity (Seam 2) — one renderer, two hosts

Write `assets/entry-render.js` as a plain script that works in both Node and the
browser:

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BurrenRender = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  // ctx: { base, headingLevel, context: 'page' | 'drawer' }
  function renderEntry(entry, ctx) { /* … single implementation … */ }

  return { renderEntry: renderEntry };
}));
```

`build.js` does `require('../assets/entry-render.js')`. `index.html` adds one
`<script src>`. The drawer stops hand-assembling markup.

**The link-base problem, solved once.** Rather than passing a different relative
prefix to each host (which is what forced the raw-content compromise), add
`site.config.json`:

```json
{ "basePath": "/", "siteName": "The Burren Scriptorium" }
```

build.js reads it, emits every internal href as **root-relative including the
base path** (`/scriptorium/flora/spring-gentian/`), and injects
`window.BURREN_BASE` into `index.html`. Now the *identical* content string is
correct on a static page, in a drawer, and in the manifest. The manifest can
carry linked content again, and build.js's caveat comment can be deleted.

> ⚠️ This is the same class of bug as the old hardcoded `BASE_URL`. Everything
> reads `basePath` from one file; nothing hardcodes `/`. If you later move to a
> GitHub Pages *project* subpath (`/burren/`), you change one line.

**Then intercept links in the drawer.** A delegated click handler on the drawer
body checks whether a clicked href resolves to a known slug; if so,
`preventDefault()` and open it as a drawer navigation instead of a page load.
Every cross-reference in every article becomes in-app navigation on the map side
and a real `<a href>` on the static side. Same markup. No duplication.

---

## 6. Fixing chrome (Seam 3) — the actual burger-menu answer

One declarative config, one implementation, two hosts:

```js
const MENU = [
  { id:'search',      label:'Search',             contexts:['map','page'] },
  { id:'bookmarks',   label:'Bookmarked Items',   contexts:['map','page'] },
  { id:'soundscape',  label:'Soundscape',         contexts:['map','page'], widget:true },
  { id:'identify',    label:'Identify a Species', contexts:['map','page'] },
  { id:'routes',      label:'Routes',             contexts:['map']  },
  { id:'openmap',     label:'Open the map here',  contexts:['page'] },
  { id:'scriptorium', label:'The Scriptorium',    contexts:['map']  },
];
```

Ship it as a custom element so both hosts drop in one tag:

```html
<burren-chrome context="page" subject="flora/spring-gentian"></burren-chrome>
```

What each item does off the map:

- **⌘K search on static pages.** It already works — the search index *is*
  `manifest.json`, which is a static file any page can fetch. Selecting a
  Scriptorium result navigates to that page directly (no map involved).
  Selecting a place result navigates to the map with the entry intent. This is
  the single biggest "one product" signal available, and it is close to free.
- **Bookmarks on static pages.** localStorage is same-origin, so the ★ on an
  entry page is *literally the same star* as in the drawer. Star a flower from a
  Google result, open the map an hour later, it's saved.
- **Soundscape.** Unify to one file loaded by both (and resolve the missing
  `scriptorium-soundscape.js` first). Persist on/off + volume in shared state.
  Caveat: a page navigation destroys the `AudioContext`, so audio *will* stop at
  the seam. Mitigation is a stored-state restart with a 400ms fade-in, which
  reads as continuous. Only Option C in §9 makes it genuinely uninterrupted.
- **Identify a Species.** On a static page this is a link into the map's
  overlay. (Still blocked on hosting — `SPECIES_ID_API_BASE_URL` is empty by
  design and needs a backend beyond GitHub Pages.)
- **Context awareness.** On an entry page the menu can offer *"Show Spring
  Gentian on the map"* rather than a generic map link — the `subject` attribute
  carries the slug.

Also extract `tokens.css` in the same pass and have both documents link it,
deleting the two duplicated `:root` blocks and the "keep them in sync" note.

---

## 7. Fixing the data split (Seam 4) and SEO

**Move map data out of `index.html` into `/data/`.** Same one-file-per-category
convention already established. build.js then emits:

| Output | Purpose |
|---|---|
| `/scriptorium/<cat>/<slug>/index.html` | canonical page, clean URL |
| `/scriptorium/<cat>/index.html` | category hub |
| `/scriptorium/index.html` | Scriptorium home |
| `pins.json` | lean marker payload: `{id,title,lat,lng,category,subCategory}` |
| `manifest.json` | full content for search + drawer |
| `sitemap.xml`, `robots.txt` | crawl surface |
| `aliases.json`, `redirects.json` | identity resolution |

**Keep the map's cold start fast.** Don't make the map fetch `pins.json` before
it can paint. Instead have build.js *inject* pins inline into `index.html` at a
`{{PINS}}` placeholder — markers appear with zero network latency, exactly as
today, while the prose (the heavy half) stays lazy. This also naturally shrinks
`index.html` and keeps the "one file you can open and read" property, because
the injected block is generated, not hand-maintained.

That does mean `index.html` becomes `index.template.html` plus a build step.
Worth it, but it's a real decision — see §11.

### SEO specifics worth doing

- `<link rel="canonical">` on every page. Non-negotiable once the map can also
  address these URLs.
- **JSON-LD structured data**, per category:
  - flora / fauna → the **Bioschemas `Taxon`** profile (a real, adopted
    extension for biodiversity data — `scientificName` maps directly onto it,
    and you already have the field populated for both datasets).
  - sites / towns / wells → `Place` or `TouristAttraction` with a real
    `geo: { latitude, longitude }`.
  - story / poetry → `Article` / `CreativeWork`.
  - every page → `BreadcrumbList`; every hub → `ItemList`.
- **OG images, generated at build time.** `specimenSvg()` already exists in
  `index.html` and draws per-entry illustrations. Move it into the shared render
  layer and have build.js rasterise one 1200×630 PNG per entry (resvg or sharp).
  Near-zero design effort for a genuinely distinctive share card, and it makes
  every link posted anywhere look intentional.
- **`lang="ga"`** on Irish titles and Irish-language content. Correct, cheap,
  and helps the Irish-language queries nobody else is serving.
- **A map image on place pages.** Even a build-time SVG of the region with a
  single dot is a locality signal and a visual bridge between the two worlds.
  No tiles, no JS, no cost.
- **Thin-content gate.** A pub with one line of description should *not* be its
  own indexed page — that's the classic doorway-page pattern and it drags down
  the whole domain. Add `"publish": true` to the schema; unpublished records
  render as a section inside their parent town's page and as a map pin, but get
  no URL of their own. Promote them when they earn real prose.

---

## 8. Fixing the *feel* — the seam-crossing toolkit

Six mechanisms, cheapest first. The first three cost almost nothing and account
for most of the perceived seamlessness.

**1. Delete `target="_blank"`.** One-line change, biggest single perceived win.
Same-tab navigation means the back button is a real affordance instead of a tab
graveyard.

**2. Make the map bfcache-eligible, then use `history.back()`.** If `index.html`
qualifies for the back/forward cache, returning to the map from a static page is
*instantaneous* and restores camera, zoom, pitch, filters and drawer stack for
free — no MapLibre re-init at all. Requirements: no `unload` or `beforeunload`
listeners anywhere, no open IndexedDB transaction at navigation time, no
`Cache-Control: no-store`. Then the static page's "Back to the Map" becomes:

```js
// If we actually came from the map, go back to the live instance rather
// than booting a fresh one — bfcache restores it with all state intact.
if (document.referrer && new URL(document.referrer).origin === location.origin
    && history.length > 1) { history.back(); }
else { location.href = MAP_URL + '?entry=' + slug; }
```

Audit for bfcache blockers early; it is easy to disqualify the page by accident
and hard to notice you have.

**3. Cross-document View Transitions.** In both stylesheets:

```css
@view-transition { navigation: auto; }
```

plus matching `view-transition-name` on the entry title and the specimen
illustration in both renderers. The title physically morphs from drawer to page.
Unsupported browsers degrade to the current fade with no branching code.

This also lets you retire the `body.leaving` + `setTimeout(160)` hack in
`template.html`, which currently **delays every single navigation by 160ms** —
a real, paid-every-click cost for an effect the platform now does properly.

**4. Speculation Rules** replace the hand-rolled `prefetchUrl`:

```html
<script type="speculationrules">
{ "prerender": [{ "where": { "href_matches": "/scriptorium/*" },
                  "eagerness": "moderate" }],
  "prefetch":  [{ "urls": ["/index.html"], "eagerness": "moderate" }] }
</script>
```

Note the asymmetry: **prerender** entry pages (tiny, cheap), but only
**prefetch** the map — prerendering it would boot MapLibre and start pulling
tiles for a visit that may never happen.

**5. Explicit state handoff via sessionStorage**, for the cases bfcache misses
(cold navigation, some iOS conditions):

```js
sessionStorage.setItem('burren.mapview.v1', JSON.stringify({
  center, zoom, pitch, bearing, filters, drawerStack, scrollY
}));
```

**6. A "returning" affordance.** When you arrive at the map from an entry page,
don't just silently fly somewhere — show a single breadcrumb pill:
*"Returning from Spring Gentian — ← back to the entry."* Small, but it makes the
crossing read as deliberate rather than as the app losing its place.

**Also:** whenever the drawer pushes a canonical URL, update `document.title`
and the OG meta tags too, so the iOS share sheet reflects what's actually open.

---

## 9. The three end-states — pick one

This is the actual design decision the ticket was pointing at.

| | **A. Static-first + shared chrome** | **B. Map shell + static twins** | **C. One app, one router** |
|---|---|---|---|
| Effort | ~2 weeks | ~4 weeks | ~8 weeks+ |
| Documents | 2 | 2 | 1 |
| Crossing cost | fast navigation | none in-app | none, ever |
| Soundscape at seam | restarts (faded) | continuous in-app | continuous |
| Map re-init | on cold nav only | on cold nav only | never |
| SEO | full | full | full (via prerender) |
| Works with JS off | yes | yes | pages yes, map no |
| Keeps single-file `index.html` | yes | mostly | no |
| Capacitor | fine | fine | best |
| Risk | low | medium | high |

**Option A — Static-first with shared chrome.** Keep two documents. Share
tokens, chrome, state and renderer (§3–7). Cross-links stay real navigations,
made fast by bfcache + view transitions + speculation rules (§8). Everything in
this document up to §8 *is* Option A.

**Option B — Map shell with static twins. ← recommended.** Option A, plus the
map pushes canonical URLs and grows a full-width Scriptorium reading view with
real in-app routing: hubs, category listings and entries all navigable without
leaving the document. The static pages become the twin served to crawlers, cold
visitors and no-JS. A static page offers *"Continue in the map"* with state
handoff. Cost: the drawer needs genuine routing (not just entry drawers), and
you're maintaining two renderers — which is exactly why §5's shared
`renderEntry` is a prerequisite rather than a nicety.

**Option C — One app, one router.** A small hand-rolled router owns every URL;
the map becomes a lazily-instantiated island that persists across route changes;
build.js prerenders every route to static HTML and the shell hydrates over it.
Genuinely one product, nothing ever reloads. But the "index.html is one readable
file" property is gone, you inherit hydration-mismatch bugs, and offline gets
harder to reason about.

**Recommendation: ship A as milestone one, then B.** B's structure is C's
structure minus the router, so choosing B costs nothing if you later want C.

### The Capacitor wrinkle

In the native iOS wrapper there is no crawler and no SEO, and you never want to
leave the shell. Add a build/runtime flag:

```js
var IS_NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform());
```

When true, every entry link renders in-drawer only and never navigates. The
static pages then become either (a) dead weight you exclude from the bundle to
save app size, or (b) your offline reading fallback, which dovetails with the
existing offline-storage strategy. **This is a real fork worth deciding
explicitly** — it's the one place where "web" and "app" genuinely want different
behaviour, and pretending otherwise creates bugs in both.

---

## 10. Migration order

Sequenced so nothing breaks and each phase ships independently.

**Phase 0 — plumbing (no visible change)**
1. `site.config.json` with `basePath`; build injects `window.BURREN_BASE`.
2. Extract `tokens.css`; both documents link it; delete both `:root` copies.
3. Add slugs + `aliases.json` + `resolveRef()`. Title lookups keep working.

**Phase 1 — parity**
4. Extract `entry-render.js`; build.js and `openScriptoriumDrawer()` both use it.
5. Clean URLs `/<category>/<slug>/` + redirect stubs from old `.html` paths.
6. Manifest carries linked content; delete the caveat comment.

**Phase 2 — chrome** ← *the ticket you started with lands here*
7. Extract `chrome.js` / `chrome.css` / `state.js`; `<burren-chrome>` on both.
   Burger menu, ⌘K and bookmarks now exist on Scriptorium pages.
8. Unify the soundscape to one file (locate the missing one first).

> It matters that this is Phase 2 and not Phase 0. Building the burger menu for
> the Scriptorium *before* extracting the render and state layers means building
> it twice, against two different state models.

**Phase 3 — the seam**
9. Drop `target="_blank"`; drawer pushes canonical URLs.
10. bfcache audit + smart `history.back()`.
11. View transitions + speculation rules; retire `body.leaving`.

**Phase 4 — data unification + SEO**
12. Move sites/towns/legends/pubs/wells to `/data/`; emit `pins.json` (inlined)
    and static pages for all of them.
13. JSON-LD, canonicals, sitemap, OG images from `specimenSvg()`.
14. Static mini-map on place pages; `publish` gate on thin records.

**Phase 5 — optional**
15. In-map Scriptorium routing (Option B proper).
16. `sw.js` precaches from a build-generated list; ties into the offline strategy.

---

## 11. Decisions needed before any of this starts

1. **Does `index.html` become build-generated?** Recommended: yes, as
   `index.template.html` with `{{PINS}}`, `{{BASE}}` and `{{CHROME}}` injection
   points — it keeps the single-file feel while removing the hand-maintained
   data. But it changes your edit loop, so it's your call.
2. **Clean URLs?** `/flora/spring-gentian/` is better for SEO and sharing, but
   changes relative depth to `../../` throughout. Recommended: yes, with
   redirect stubs.
3. **Is `/` the map or the Scriptorium?** Affects canonical URLs, the sitemap,
   and what a cold visitor from Google sees when they click your domain.
   Recommended: map at `/`, Scriptorium at `/scriptorium/` — matches the current
   layout and the app's identity.
4. **Which place categories get their own pages?** All of them, or only those
   with real prose (the `publish` gate)? Recommended: gate it. Thin pages hurt.
5. **Native build: exclude static pages, or keep as offline fallback?**
6. **Where did `scriptorium/assets/scriptorium-soundscape.js` go?** Check git
   history before Phase 2.

---

## 12. A note on the seam and the voice

The moments where a person crosses between map and page are the moments the
scholar-poet voice has the most to do, and currently they're the flattest copy
in the product: *"Back to the Map"*, *"View full citation & sources"*,
*"Explore Spring Gentian on the interactive map"*.

These strings should live in one shared file alongside the chrome config, be
written once, and be *the same on both sides* — because inconsistent
microcopy is itself a way the seam shows. Some directions worth trying:

- "Back to the Map" → **"Return to the ground"**
- "View full citation & sources" → **"Read the full leaf"**
- "Explore on the interactive map" → **"Find where it grows"** (flora) /
  **"Find where it walks"** (fauna) / **"Stand where it stood"** (sites)

Category-aware crossing copy is a small amount of work in the render layer and
does more for the sense of one authored world than any amount of CSS.
