/* ==========================================================================
   Burren — the shared render layer.

   ONE implementation of "what an entry looks like", used by build.js
   (Node, at build time, to write static pages) and by the map's drawer
   (browser, at runtime). Before this file there were two: fillTemplate()
   in build.js and openScriptoriumDrawer() in index.html, which produced
   materially different HTML from the same record — the drawer was
   missing auto-linked cross-references, the meta row (subCategory ·
   scientificName), the verse treatment for poetry, and the ogham fields.
   Content parity was a thing a human had to remember, in two files,
   forever.

   ---- THE LINK-BASE PROBLEM, AND THE %%R%% TOKEN ----

   The reason build.js used to ship RAW content in manifest.json (see its
   old comment) is that auto-linked hrefs were baked relative to
   dist/<category>/<id>.html, and would resolve to the wrong place once
   that same HTML was dropped into the map's drawer, which lives one
   whole directory up.

   So auto-linking now emits a placeholder instead of a path:

       <a href="%%R%%fauna/otter/">Otter</a>

   %%R%% means "from here, the path to the Scriptorium root". Each host
   substitutes its own:

       static entry page  /scriptorium/flora/spring-gentian/  →  '../../'
       category hub page  /scriptorium/flora/                 →  '../'
       Scriptorium home   /scriptorium/                       →  ''
       the map's drawer   /index.html                         →  'scriptorium/'

   Nothing is ever root-relative and no absolute origin is hardcoded, so
   this survives being moved to a GitHub Pages project subpath — the
   failure mode that broke every cross-link last time.

   ---- WHAT THIS FILE DOES *NOT* DO ----

   It does not unify the two surfaces' outer shells. renderParts() builds
   the shared pieces; pageHtml() and drawerHtml() assemble them into the
   markup each surface's own (already-working, already-debugged) CSS
   expects. That keeps the drawer looking like the drawer and the page
   looking like the page, while making the CONTENT of both provably the
   same thing.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BurrenRender = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ROOT_TOKEN = '%%R%%';

  // --------------------------------------------------------------------
  // Small shared utilities
  // --------------------------------------------------------------------

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
  }

  // Slug generation for records that don't carry an explicit `id`. Every
  // record in data/ currently does, and SHOULD — the slug is the entry's
  // canonical identity and must never change once published (see
  // redirects.json). This exists so a newly-pasted record without one
  // still builds rather than writing a file called "undefined.html".
  function slugify(title) {
    return String(title || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // fadas → plain letters
      .toLowerCase()
      .replace(/['\u2019]/g, '')                          // apostrophes vanish, not become dashes
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function entryId(entry) { return entry.id || slugify(entry.title); }

  // The TRUE canonical identity. entryId alone (a bare slug) is only
  // unique within a category — "ash" the tree and a hypothetical
  // "ash" the townland can coexist at flora/ash/ and story/ash/ without
  // conflict on disk, but a lookup table keyed on the bare slug would
  // silently let the second one overwrite the first. Every internal
  // index below is keyed on this, not on entryId() alone.
  function entryKey(entry) { return entry.category + ':' + entryId(entry); }

  // The entry's canonical path, relative to the Scriptorium root, with a
  // trailing slash — the clean-URL form. Prefixed with %%R%% (or a real
  // base, if one is passed) so it's usable from anywhere.
  function entryPath(entry, base) {
    return (base == null ? ROOT_TOKEN : base) + entry.category + '/' + entryId(entry) + '/';
  }

  // Strips HTML and collapses whitespace — the fallback plain-text
  // summary for meta descriptions and search snippets when an entry
  // doesn't supply its own. A real authored summary almost always reads
  // better; this just means a missing one never breaks anything.
  function deriveSummary(entry) {
    if (entry.summary) return entry.summary;
    var plain = String(entry.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return plain.length > 160 ? plain.slice(0, 157).trim() + '\u2026' : plain;
  }

  // --------------------------------------------------------------------
  // The entry index — one lookup table, three ways in
  // --------------------------------------------------------------------

  // Builds { byKey, byId, byTitle, byAlias, all } from a flat entry list.
  //
  // byKey is keyed on entryKey() (category:slug) and is the only table
  // guaranteed unambiguous — a bare slug, title or alias is only unique
  // WITHIN a category, and at the scale this data is heading toward
  // (towns, graves, wells, people, alongside flora/fauna/story/poetry),
  // two records legitimately sharing a bare name across categories
  // ("Ballyvaughan" the town and "Ballyvaughan" the story) is a real
  // scenario, not a hypothetical one. byId/byTitle/byAlias below are
  // therefore arrays, not single entries, and resolveRef() only trusts
  // them when exactly one candidate exists.
  function buildIndex(entries) {
    var byKey = {}, byId = {}, byTitle = {}, byAlias = {};
    function push(map, k, e) { (map[k] = map[k] || []).push(e); }
    entries.forEach(function (e) {
      var key = entryKey(e);
      // First one seen wins in byKey; build.js is what turns a genuine
      // collision into a hard failure with a file-level error message —
      // this file stays a pure lookup and never throws.
      if (!byKey[key]) byKey[key] = e;
      push(byId, entryId(e), e);
      push(byTitle, e.title, e);
      (e.aliases || []).forEach(function (a) { push(byAlias, a, e); });
    });
    return { byKey: byKey, byId: byId, byTitle: byTitle, byAlias: byAlias, all: entries };
  }

  // Accepts a canonical "category:slug" key (always unambiguous), a bare
  // slug, a display title, or a known alias (all three trusted only when
  // exactly one record matches). Returns the record or null.
  //
  // `ambiguous`, if passed, collects refs that matched MORE than one
  // record so a caller (build.js) can turn that into a warning rather
  // than silently picking one and hiding the conflict.
  function resolveRef(index, ref, ambiguous) {
    if (!index || ref == null) return null;
    if (index.byKey[ref]) return index.byKey[ref];
    var lists = [index.byId[ref], index.byTitle[ref], index.byAlias[ref]];
    for (var i = 0; i < lists.length; i++) {
      var list = lists[i];
      if (!list || !list.length) continue;
      if (list.length === 1) return list[0];
      if (ambiguous) ambiguous.push(ref);
      return null;
    }
    return null;
  }

  // The href for an entry, or null if it shouldn't be linked at all.
  // A record with "publish": false has no static page — linking to one
  // anyway is a dead link the moment the site is deployed. If the record
  // names an externalUrl (a source it genuinely lives at) that's used
  // instead; otherwise callers fall back to plain, unlinked text.
  function entryHref(entry, linkBase) {
    if (entry.publish === false) return entry.externalUrl || null;
    return entryPath(entry, linkBase);
  }

  // --------------------------------------------------------------------
  // Auto-linking
  // --------------------------------------------------------------------

  // Explicit wiki-links, resolved first: [[slug]] or [[slug|display text]].
  // These are the preferred form — the title-substring pass below is a
  // convenience that gets less reliable the larger the corpus grows (an
  // entry titled "Ash" will eventually start eating unrelated prose), so
  // anywhere a link genuinely matters, write it explicitly. An
  // unresolvable [[ref]] is left as plain display text rather than a
  // broken link, and reported to the caller so build.js can warn.
  function expandWikiLinks(content, index, unresolved, ambiguous) {
    return String(content).replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, function (m, ref, label) {
      var target = resolveRef(index, ref.trim(), ambiguous);
      var text = (label != null ? label : (target ? target.title : ref)).trim();
      if (!target) { if (unresolved) unresolved.push(ref.trim()); return escapeHtml(text); }
      var href = entryHref(target);
      // Resolved but not linkable (an unpublished record with nowhere of
      // its own to send a reader) — the text still improves, it just
      // isn't wrapped in an <a>, so no dead link ships.
      if (!href) return escapeHtml(text);
      return '<a href="' + href + '" data-entry-ref="' + escapeAttr(entryKey(target)) + '">' + text + '</a>';
    });
  }

  // Wraps any OTHER entry's title, found as a substring of this entry's
  // content, in a real <a href>. Matches longest title first (so a title
  // that's itself a substring of a longer one, e.g. "Doolin" inside
  // "Doolin Cave", doesn't steal the shorter match) and only on a word
  // boundary. Skips anything already inside a tag or an existing <a>, so
  // it can't nest a link inside a link or mangle an attribute value.
  function autoLinkTitles(content, index, selfKey) {
    // Unpublished records with no externalUrl are dropped from the
    // candidate list entirely, rather than matched-then-discarded — a
    // record with "publish": false has no page to send a reader to, so
    // it should never have generated a link in the first place. Filtering
    // here (once, up front) rather than after a match is what keeps this
    // in sync with expandWikiLinks' identical rule for [[wiki links]].
    var candidates = index.all
      .filter(function (e) { return entryKey(e) !== selfKey; })
      .map(function (e) { return { entry: e, href: entryHref(e) }; })
      .filter(function (c) { return !!c.href; })
      .sort(function (a, b) { return b.entry.title.length - a.entry.title.length; });

    function isWordChar(ch) { return !!ch && /[A-Za-z]/.test(ch); }

    var result = '';
    var i = 0;
    var inTag = false;
    var inAnchorDepth = 0;

    outer:
    while (i < content.length) {
      var ch = content[i];

      // Track whether we're inside a tag, and inside an <a>…</a> pair,
      // so neither an attribute value nor an existing link gets rewritten.
      if (ch === '<') {
        inTag = true;
        if (content.substr(i, 2).toLowerCase() === '<a' && !isWordChar(content[i + 2])) inAnchorDepth++;
        else if (content.substr(i, 4).toLowerCase() === '</a>') inAnchorDepth = Math.max(0, inAnchorDepth - 1);
        result += ch; i++; continue;
      }
      if (inTag) { if (ch === '>') inTag = false; result += ch; i++; continue; }
      if (inAnchorDepth > 0) { result += ch; i++; continue; }

      for (var c = 0; c < candidates.length; c++) {
        var other = candidates[c].entry;
        var title = other.title;
        if (content.substr(i, title.length) === title &&
            !isWordChar(content[i - 1]) && !isWordChar(content[i + title.length])) {
          result += '<a href="' + candidates[c].href + '" data-entry-ref="' + escapeAttr(entryKey(other)) + '">' + title + '</a>';
          i += title.length;
          continue outer;
        }
      }
      result += ch;
      i++;
    }
    return result;
  }

  // The full pipeline. Poems opt out of the title-substring pass via
  // `noAutoLink` (see data/poetry.json) — matching titles inside a poem's
  // own line breaks isn't assumed to be wanted without saying so per
  // entry — but explicit [[wiki links]] still resolve, since those were
  // typed on purpose.
  function linkContent(entry, index, unresolved, ambiguous) {
    var out = expandWikiLinks(entry.content || '', index, unresolved, ambiguous);
    if (!entry.noAutoLink) out = autoLinkTitles(out, index, entryKey(entry));
    return out;
  }

  // Swap %%R%% for whatever "the Scriptorium root, from here" actually is
  // in the calling context. Safe to run on any string; a no-op if there
  // are no tokens in it.
  function rebase(html, linkBase) {
    return String(html == null ? '' : html).split(ROOT_TOKEN).join(linkBase == null ? '' : linkBase);
  }

  // --------------------------------------------------------------------
  // The shared parts
  // --------------------------------------------------------------------

  // Everything both surfaces need, built once. `entry.content` is
  // expected to be already link-expanded (build.js does this once and
  // stores the result in manifest.json, so the browser never repeats the
  // work); pass `index` to have it done here instead.
  //
  // ctx: { linkBase, index }
  function renderParts(entry, ctx) {
    ctx = ctx || {};
    var linkBase = ctx.linkBase == null ? '' : ctx.linkBase;
    var content = ctx.index ? linkContent(entry, ctx.index) : (entry.content || '');

    var metaParts = [];
    if (entry.subCategory) metaParts.push('<span class="entry-subcategory">' + escapeHtml(entry.subCategory) + '</span>');
    if (entry.scientificName) metaParts.push('<span class="entry-scientific-name">' + escapeHtml(entry.scientificName) + '</span>');
    // Ogham was carried in the data and rendered nowhere — the flora
    // records that have it are the oldest and most carefully written
    // entries on the site, so it's worth showing.
    if (entry.oghamName) {
      metaParts.push('<span class="entry-ogham">' + escapeHtml(entry.oghamName) +
        (entry.oghamGloss ? ' <em>' + escapeHtml(entry.oghamGloss) + '</em>' : '') + '</span>');
    }

    return {
      id: entryId(entry),
      category: entry.category,
      title: entry.title,
      summary: deriveSummary(entry),
      path: entryPath(entry, linkBase),
      // The two elements that exist on BOTH sides of a map↔page crossing,
      // and so are the two that morph rather than cross-fade. Names have
      // to match exactly across the two documents for the browser to pair
      // them up, which is why they're generated here and not typed twice.
      titleTransitionName: 'entry-title',
      irishHtml: entry.irishTitle
        ? '<p class="entry-irish" lang="ga">' + escapeHtml(entry.irishTitle) + '</p>'
        : '',
      // Same value, drawer's own markup shape (a div, not a p) so the
      // existing .site-entry CSS keeps applying unchanged.
      irishDrawerHtml: entry.irishTitle
        ? '<div class="irish-name" lang="ga">' + escapeHtml(entry.irishTitle) + '</div>'
        : '',
      metaRowHtml: metaParts.length
        ? '<p class="entry-meta-row">' + metaParts.join('<span class="entry-meta-dot">&middot;</span>') + '</p>'
        : '',
      // Verse gets its own light CSS treatment (styles.css's
      // .entry-content.is-verse). Driven off category rather than a
      // separate flag, since "is this a poem" and "is this category
      // poetry" are the same question today.
      verseClass: entry.category === 'poetry' ? ' is-verse' : '',
      contentHtml: rebase(content, linkBase)
    };
  }

  // --------------------------------------------------------------------
  // The two assemblies
  // --------------------------------------------------------------------

  // Static page <main> body. ctx also accepts { mapHref, mapLabel,
  // bookmarkHtml }.
  function pageHtml(entry, ctx) {
    ctx = ctx || {};
    var p = renderParts(entry, ctx);
    return '' +
      '<header class="entry-header">' +
        '<p class="entry-category">' + escapeHtml(p.category) + '</p>' +
        '<div class="entry-title-row">' +
          '<h1 class="entry-title" style="view-transition-name:' + p.titleTransitionName + '">' + escapeHtml(p.title) + '</h1>' +
          (ctx.bookmarkHtml || '') +
        '</div>' +
        p.metaRowHtml +
        p.irishHtml +
      '</header>' +
      '<article class="entry-content' + p.verseClass + '">' + p.contentHtml + '</article>' +
      (ctx.mapHref
        ? '<p class="explore-on-map"><a href="' + escapeAttr(ctx.mapHref) + '" class="explore-on-map-btn">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 21 C12 21 5 15 5 9 C5 5 8 3 12 3 C16 3 19 5 19 9 C19 15 12 21 12 21 Z"/><circle cx="12" cy="9.5" r="2.6"/></svg>' +
          escapeHtml(ctx.mapLabel || 'Find it on the map') + '</a></p>'
        : '');
  }

  // Map drawer body — deliberately the drawer's own existing markup
  // shape (.entry-header-row / .irish-name / .tag / .scriptorium-content)
  // so no drawer CSS has to change, but assembled from the SAME parts as
  // the page above. The meta row, the ogham line and the verse class are
  // what the drawer gains from this; the auto-linked cross-references are
  // the big one.
  //
  // ctx also accepts { bookmarkHtml, afterContentHtml, pageHref, pageLabel }.
  function drawerHtml(entry, ctx) {
    ctx = ctx || {};
    var p = renderParts(entry, ctx);
    return '' +
      '<div class="entry-header-row">' +
        '<h2 style="view-transition-name:' + p.titleTransitionName + '">' + escapeHtml(p.title) + '</h2>' +
        (ctx.bookmarkHtml || '') +
      '</div>' +
      p.irishDrawerHtml +
      '<span class="tag">' + escapeHtml(p.category) + '</span>' +
      p.metaRowHtml +
      '<div class="scriptorium-content entry-content' + p.verseClass + '">' + p.contentHtml + '</div>' +
      (ctx.afterContentHtml || '') +
      (ctx.pageHref
        ? '<p class="site-maplinks"><a class="maplink-btn" href="' + escapeAttr(ctx.pageHref) + '">' +
          escapeHtml(ctx.pageLabel || 'Read the full leaf') + '</a></p>'
        : '');
  }

  return {
    ROOT_TOKEN: ROOT_TOKEN,
    escapeHtml: escapeHtml,
    escapeAttr: escapeAttr,
    slugify: slugify,
    entryId: entryId,
    entryKey: entryKey,
    entryPath: entryPath,
    entryHref: entryHref,
    deriveSummary: deriveSummary,
    buildIndex: buildIndex,
    resolveRef: resolveRef,
    linkContent: linkContent,
    rebase: rebase,
    renderParts: renderParts,
    pageHtml: pageHtml,
    drawerHtml: drawerHtml
  };
}));
