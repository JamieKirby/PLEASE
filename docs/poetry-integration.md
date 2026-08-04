# Poetry Integration — Architecture Notes

*Where and how original verse fits into the Burren map + Scriptorium, and why.*

## Status

**Built** — Scriptorium category (`data/poetry.json`, 5 entries),
`linkedTo` + reciprocal drawer chips, the `.is-verse` CSS treatment,
and the ambient bank. Verified with a real `node build.js` run (129
pages, `poetry/` directory, Poetry nav link appears automatically on
every other category's pages with zero template edits — confirms the
Fauna precedent this doc predicted). Everything below in "What NOT to
build" is still out of scope, unchanged. See the end of this doc for
the one open edge case (manifest load timing) this pass didn't
resolve.

## The short version

Don't build a new system. The app already has one: the ambient
background (`AMBIENT_BANKS`, `AMBIENT_ROW_DEFS`, `renderAmbientRows` in
`index.html`) is a discipline-keyed bank of short atmospheric phrases,
rendered as faint, swaying text behind every drawer. It exists
specifically to give each kind of entry — flora, geology, archaeology,
lore, a town, a route — its own texture without hand-authoring anything
per-entry. That's exactly the shape a poetry feature needs. The
recommendation below is to extend that system and the Scriptorium's
existing category machinery, not to invent a third, parallel content
type.

## Two integration points, not one

### 1. Ambient layer — lines, not poems

**Built, but not as originally planned.** The plan below was to mix
poem lines into the *existing* discipline banks (`AMBIENT_BANKS.flora`,
etc.). Implementing it surfaced a problem this doc didn't catch in
advance: `renderAmbientRows` picks its bank by `entry.category`, and a
poem's own category is `poetry`, not `flora` or `lore` — so lines
mixed into the flora bank would only ever show up on flora drawers,
never on the poem's own drawer, regardless of the poem's subject. The
actual fix was a dedicated `AMBIENT_BANKS.poetry` bank, which is what
poem drawers actually read. It holds 8 short original fragments
(`'capstone tilted'`, `'a psalm unclosed'`, etc.) in the same 2–4 word
register as the rest, thematically tied to the 5 poems — not lines
lifted from them directly, since a real line also ran too long for
this mid-arc sway text once actual verse existed to test against
(exactly the risk flagged below, just resolved by writing fresh
fragments rather than trimming real ones).

The ambient system already accepts short strings, which is what made
this fix cheap despite not being the originally planned shape — no
change to `renderAmbientRows` itself, just one more bank key next to
`flora`/`geology`/`town`/etc. This is low-commitment: it's texture, not
a reading experience, and a broken or too-long line only ever costs a
slightly ugly sway animation, not a content bug. 8 fragments turned out
to be enough for 5 poems (`ambientRowText` cycles the bank by seed, so
a small bank repeats rather than running out); the original "6–10 per
bank" estimate held even though the destination bank changed.

**Constraint to respect:** `ambientRowText` picks bank entries by
`seed` (row index), not randomly per session — so the same entry always
shows the same ambient lines in the same rows. That determinism holds
for the dedicated `poetry` bank the same way it does for every other
bank — no extra work was needed to keep it stable.

### 2. Scriptorium — poems as their own category

**Built exactly as planned**, plus one thing this section didn't
anticipate: `linkedTo` needed to be added to the manifest builder in
`build.js` (it wasn't previously an optional field there, since no
existing category used it) so the map could actually read a poem's
site/town attribution at runtime. Confirmed with a real `node build.js`
run — 129 pages, 5 under `poetry/`, and the Poetry nav link appears on
every other category's pages automatically, with zero edits to
`template.html`/`hub-template.html`, same as the Fauna precedent.

For anything long enough to actually be *read* (a full poem, not a
line), the right home is a fourth `data/<category>.json` file —
`data/poetry.json` — following exactly the schema `fauna.json` and
`flora.json` already use: `id`, `category: "poetry"`, `title`,
`irishTitle`, `summary`, `content`, `subCategory`. This is deliberately
the same mechanism that just added Fauna: because `build.js`'s nav,
hub pages, and `NAV_LINKS` are now data-driven off whatever categories
exist in `data/`, adding `data/poetry.json` alone — no template
edits — puts a "Poetry" link in the Scriptorium nav, gives it its own
hub page, and folds it into the map's runtime search via
`manifest.json`, the same as Fauna did.

Two schema notes specific to poems, worth deciding before the first
entry is written:
- **`content` as verse.** The existing `template.html` renders
  `{{CONTENT}}` raw — whatever HTML is in the JSON is what appears.
  A poem's line breaks need to survive that: wrap each stanza in
  `<p>` and use real `<br>` tags between lines rather than relying on
  whitespace, since HTML collapses it. `autoLinkContent`'s
  cross-linking (matching another entry's title inside the text) is
  presumably not desired for a poem in the same way it is for prose —
  worth an explicit `noAutoLink: true` flag on the entry if that
  matters here, rather than assuming the existing behavior is fine.
- **A CSS treatment for verse.** `styles.css`'s `.entry-content`
  is tuned for prose paragraphs. A `.entry-content.is-verse` variant
  (tighter line-height, no justified text, maybe a serif indent
  convention for stanza breaks) is worth adding in `template.html`'s
  `<article class="entry-content{{VERSE_CLASS}}">` — one more small,
  optional placeholder in the same style as `{{IRISH_BLOCK}}`.

### Where poems get *attributed* to a place

**Built**, with one structural difference from the other five linkable
kinds that's worth naming: legends/graves/persons/pubs/wells are all
baked directly into `index.html` as JS objects, so their
`linked*ChipsHtml` functions read synchronous, always-available data.
A poem lives in the Scriptorium instead, so `linkedPoemsChipsHtml`
reads `scriptoriumEntries` — populated asynchronously by
`loadScriptoriumManifest`'s `fetch('scriptorium/manifest.json')` — not
a baked-in dataset. In practice that fetch resolves well before anyone
reaches a site/town drawer, the same assumption `loadScriptoriumManifest`
already makes for itself. But it is a real, if narrow, gap: a site/town
drawer opened in the brief window before that fetch resolves won't show
its poem chip, and nothing currently re-renders an already-open drawer
when the manifest arrives late. Not fixed in this pass — flagged here
rather than silently accepted.

Both `siteData`/`townData` entries and Scriptorium entries already
support cross-linking (`linkedTo`, the `route-chip`/`link-chip`
pattern used throughout `index.html`). A poem about Corcomroe Abbey
should carry a `linkedTo: { kind: 'site', name: 'Corcomroe Abbey' }`
field the same way a legend or grave does, so it shows up as a chip on
that site's drawer — "A poem: [title]" — using the exact
`linkedLegendsChipsHtml`-style pattern already wired for legends,
graves, persons, pubs, and wells. This is the same one-line-of-code-
per-kind pattern each of those already follows; poetry becomes a sixth
linkable kind, not a special case.

## What NOT to build

**Still out of scope — confirmed, not just carried over.** None of
this was built in this pass, and each reason below still holds now
that poetry actually exists in the app rather than being hypothetical:

- ⏸ **No separate poetry reader/player UI.** The Scriptorium's existing
  entry page and in-app drawer are both already built for long-form
  reading (that's what "Deeper dive" is for). A poem is just an entry
  whose `content` happens to be verse. Confirmed: the 5 shipped poems
  read fine through the existing drawer/entry-page UI, no gap found
  that would justify a dedicated reader.
- ⏸ **No audio narration pipeline for this pass.** `speak()` (the
  existing pronunciation button) already does browser TTS for a
  title; extending it to read a full poem aloud is a real, separable
  feature with its own UX questions (pacing, line breaks, voice
  choice) that deserves its own decision, not a rider on this one.
- ⏸ **No poetry-specific search weighting.** `scoreEntry`'s existing
  per-field weights (name, category, note, subCategory, habitat tags)
  already generalize to a fifth category. Nothing here needs
  special-casing until real usage shows a specific gap.
- ⏸ **No fix for the manifest-load-timing gap** (see "Where poems get
  attributed," above). Narrow, real, and explicitly left open rather
  than papered over — the honest fix is re-rendering an already-open
  site/town drawer when `loadScriptoriumManifest` resolves late, which
  is more machinery than this pass's scope justified on its own.

## Suggested first slice — completed

1. ✅ `scriptorium/data/poetry.json` with 5 real entries, schema as
   above (3 site-linked, 1 town-linked, 1 unlinked landscape piece).
2. ✅ Confirmed `build.js` picks it up with zero template edits — ran
   `node build.js` for real: 129 pages, `poetry/` with 5 entries + its
   own hub page, Poetry nav link appears automatically on every other
   category's pages.
3. ✅ Added `linkedTo` on the 4 site/town-linked poems, wired the
   reciprocal chip via a new `linkedPoemsChipsHtml` (not a literal
   reuse of `linkedLegendsChipsHtml`, since it reads the async
   Scriptorium manifest rather than a baked-in dataset — see above).
4. ✅ Added the ambient bank — as a dedicated `AMBIENT_BANKS.poetry`
   bank rather than lines mixed into existing discipline banks (see
   "Ambient layer," above, for why the original plan didn't quite
   work).

All 4 steps are done. Steps 1–3 were pure data + the nav system already
built for Fauna, exactly as predicted. Step 4 needed the one real
adjustment described above (a dedicated bank, not lines mixed into
existing ones) — everything else in this doc held up against actual
implementation.
