# Offline Storage Strategy — Architecture Notes

*How regional download packs, the 2GB/500MB caps, and the Burren
exception should actually be built — not implemented here, because
getting this wrong is expensive to undo and there's no live device to
verify against.*

## Where things actually stand today

`sw.js` already does real, working offline caching — but only for the
app shell: same-origin HTML/JS/CSS/JSON (`index.html`, the Scriptorium
pages, `manifest.json`) via stale-while-revalidate. It explicitly, and
correctly, leaves third-party requests alone:

> *"leave CDN requests (MapLibre, OpenFreeMap tiles, OSRM) alone
> entirely"*

That line is the entire gap. The map's actual visual bulk — vector/
raster map tiles from OpenFreeMap, the AWS Terrarium elevation tiles
for 3D terrain, satellite imagery from Esri — is fetched live every
time and cached nowhere. A "download the Burren for offline use"
feature is fundamentally a **tile-caching problem**, not an app-shell
problem; the app-shell half of offline support is already done.

## The core design decision: don't build a second cache

`sw.js`'s `staleWhileRevalidate` uses the Cache API, which is the
right tool for request/response pairs (exactly what a tile fetch is)
but the wrong tool for the things a "download manager" UI needs:
querying total bytes used, listing what regions are downloaded,
deleting one region without walking the whole cache, and — the
specific requirement here — **deduplicating a tile that's shared by
two overlapping regional packs**. The Cache API has no query
interface beyond exact-URL lookup; you cannot ask it "how many bytes
does this cache hold" or "which regions is this specific tile part
of" without maintaining that index yourself somewhere else anyway.

So: **IndexedDB is the source of truth for the download manager**
(what's downloaded, region membership, byte counts, hash→tile
mapping); **the Cache API remains the actual place tile bytes live**,
because that's what `fetch()` transparently reads from and what the
service worker already knows how to serve offline. The download
manager writes into Cache Storage the same way the existing
`staleWhileRevalidate` does, and separately records bookkeeping in
IndexedDB. Two stores, one clearly in charge of "is this byte data"
and the other in charge of "what does it mean."

## Region structure: county-level blocks, province-level UI

The requirement (traditional provinces as the user-facing download
unit, county-level blocks underneath to avoid double-downloading a
shared border area like the Clare/Galway/Burren corridor) maps
directly onto a two-level manifest:

```
provinces/
  connacht.json   -> { counties: ['galway', 'mayo', ...] }
  munster.json    -> { counties: ['clare', 'limerick', ...] }
county-tiles/
  clare.json      -> { tileKeys: ['z/x/y', ...] hashed, byteSize, ... }
  galway.json     -> { tileKeys: [...], byteSize, ... }
```

"Download Munster" resolves to its county list, then downloads
whichever of those counties' tile sets aren't already present — a
county already pulled in because the person downloaded Connacht first
(and Galway's county block overlaps Munster's UI grouping in no real
sense here, but the general case — two provinces sharing a border
county — is exactly this) is skipped, not re-fetched. This is a
**resolve-then-diff** operation entirely in IndexedDB before any
network request happens; the province is a UI/marketing grouping, the
county is the actual unit of storage and dedup.

## Tile dedup: content hash, not tile coordinate

A tile coordinate (`z/x/y`) is not a safe dedup key on its own —
different style layers (satellite vs. the recolored vector style vs.
elevation) at the same coordinate are different bytes entirely, and a
naive per-coordinate key would either collide (wrong) or need a
compound key that's really just reinventing a hash. The actual
requirement — *"client-side asset deduplication using hash-based file
naming"* — is the right instinct: store each unique tile blob once,
keyed by a content hash (SHA-256 of the response bytes is fine at this
scale; `crypto.subtle.digest` is available in a service worker), and
have every county's manifest reference tiles by hash rather than by
coordinate. Two counties whose manifests both list the same hash
share the one cached blob automatically — there is nothing further to
"deduplicate," because the storage key already collapses to one entry.

This also solves the border-corridor case cleanly: the Clare/Galway/
Burren tiles at the province boundary get the *same* hash whichever
county's manifest lists them first downloaded, so it genuinely doesn't
matter which order a person downloads regions in.

## The Burren exception: a separate, lazy tier — not a bigger county block

The flora dataset's own scale (per the existing comment on
`data/flora.json`'s design: kept as one file per category specifically
so it stays reviewably small) is the tell here — the Burren's honest
share of Ireland's native flora is disproportionate to its geographic
footprint, and bundling that data weight into "the Clare county pack"
would make Clare's download size an outlier that misleads anyone
comparing it to Galway's or Limerick's. The fix is structural, not a
size warning in the UI:

- **County tile packs stay map-tiles only** (imagery + vector style +
  elevation) — genuinely comparable in size across all 32 counties.
- **The Burren botanical dataset (flora.json, and now fauna.json,
  plus their Scriptorium manifest content) is its own download tier**,
  offered separately — *"Also download: the Burren Field Guide
  (~Xmb)"* — not silently folded into the Clare county pack. Someone
  who wants offline tiles for a Clare road trip should not be forced
  to also pull down 60+ species entries' worth of Scriptorium content
  they may never open.
- This tier can be **lazy by entry**, not just lazy by category: since
  the Scriptorium's `manifest.json` already bundles every entry's full
  `content` into one JSON file for the *live* search/drawer
  experience (a deliberate choice documented in `build.js`, revisited
  "once this dataset is genuinely in the thousands"), the offline
  version doesn't have to inherit that same one-file-up-front shape.
  An offline-specific per-entry fetch (`scriptorium/flora/<id>.html`
  is already a real, individually-cacheable URL) lets "download the
  Burren Field Guide" mean "cache every entry page," without changing
  how the live site works at all.

## What actually needs building, roughly in order

1. **Tile URL interception in `sw.js`.** Currently tile requests are
   explicitly skipped. A dedicated cache-first (not
   stale-while-revalidate — tiles don't change) handler, scoped only
   to the known tile origins, is the real first step; everything else
   here depends on tiles being cacheable at all.
2. **IndexedDB schema** for region membership, hash→tile mapping, and
   running byte totals — the bookkeeping layer described above.
3. **Manifest generation** — a build-time (Node) step, not a runtime
   one, that walks the map's actual tile requirements per county at a
   fixed zoom range and emits the `county-tiles/*.json` files with
   content hashes. This is the same "compute once at build time, ship
   the result" philosophy `scriptorium/build.js` already uses for
   `manifest.json`.
4. **Download manager UI** — province-grouped, county-resolved,
   showing the running total against the 2GB Ireland-wide /
   500MB-per-region caps, with the Burren Field Guide offered as its
   own separate toggle rather than bundled.
5. **The 2GB/500MB enforcement itself** — a pre-flight check against
   IndexedDB's running total before starting a new region's download,
   with a clear "this would put you over your cap" message rather
   than a silent failure partway through.

None of this is implemented in the current `sw.js` or `index.html` —
this document is the design to build against, not a changelog of work
already done. The tile-caching piece (step 1) is a genuinely separate,
testable unit of work from the download-manager UI (step 4), and
should be built and verified on a real device before the UI is wired
on top of it — a cache-first strategy that silently fails to actually
cache anything is much harder to notice than a UI bug.
