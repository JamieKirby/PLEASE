# Poetry Integration — Architecture Notes

*Where and how original verse fits into the Burren map + Scriptorium, and why.*

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

The ambient system already accepts short strings. Nothing stops
`AMBIENT_BANKS.flora` (etc.) from including a handful of single lines
lifted from original verse alongside the existing phrases like
`'gentian blue'` or `'rootless in the grike'` — same rendering, same
cost, zero new code. This is low-commitment: it's texture, not a
reading experience, and a broken or too-long line only ever costs a
slightly ugly sway animation, not a content bug. A natural first step:
write 6–10 lines per discipline bank, short enough to read comfortably
mid-arc (the existing bank entries top out around 4–5 words for a
reason — check that against a real line's length before committing to
it).

**Constraint to respect:** `ambientRowText` picks bank entries by
`seed` (row index), not randomly per session — so the same entry always
shows the same ambient lines in the same rows. If poetry lines are
mixed into the existing banks, that determinism is inherited for free;
no extra work needed to keep it stable.

### 2. Scriptorium — poems as their own category

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

Both `siteData`/`townData` entries and Scriptorium entries already
support cross-linking (`linkedTo`, the `route-chip`/`link-chip`
pattern used throughout `index.html`). A poem about Corcomroe Abbey
should carry a `linkedTo: { kind: 'site', name: 'Corcomroe Abbey' }`
field the same way a legend or grave does, so it shows up as a chip on
that site's drawer — "A poem about this place" — using the exact
`linkedLegendsChipsHtml`-style pattern already wired for legends,
graves, persons, pubs, and wells. This is the same one-line-of-code-
per-kind pattern each of those already follows; poetry becomes a sixth
linkable kind, not a special case.

## What NOT to build

- **No separate poetry reader/player UI.** The Scriptorium's existing
  entry page and in-app drawer are both already built for long-form
  reading (that's what "Deeper dive" is for). A poem is just an entry
  whose `content` happens to be verse.
- **No audio narration pipeline for this pass.** `speak()` (the
  existing pronunciation button) already does browser TTS for a
  title; extending it to read a full poem aloud is a real, separable
  feature with its own UX questions (pacing, line breaks, voice
  choice) that deserves its own decision, not a rider on this one.
- **No poetry-specific search weighting.** `scoreEntry`'s existing
  per-field weights (name, category, note, subCategory, habitat tags)
  already generalize to a fifth category. Nothing here needs
  special-casing until real usage shows a specific gap.

## Suggested first slice

1. `scriptorium/data/poetry.json` with 3–5 real entries, schema as
   above.
2. Confirm `build.js` picks it up with zero template edits (it should,
   per the Fauna precedent — worth a real `node build.js` run to
   check the nav/hub output, not just an assumption).
3. Add `linkedTo` on any poem tied to a specific site/town, and wire
   the reciprocal chip on that site/town's own drawer (same pattern
   as legends).
4. Only then, if it still feels worth it: lift 1–2 short lines per
   poem into the relevant `AMBIENT_BANKS` entry as texture.

Steps 1–3 are pure data + the nav system already built for Fauna.
Step 4 is optional polish, cheap either way, and easy to skip without
blocking anything else.
