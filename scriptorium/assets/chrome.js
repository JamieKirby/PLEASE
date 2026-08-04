/* ==========================================================================
   Burren — shared chrome.

   This is the answer to "the burger menu should stay visible on
   Scriptorium pages." It is deliberately NOT a copy of the map's menu
   markup: it is one declarative menu config plus one renderer, driven by
   a `context` of 'map' or 'page', so the two surfaces can never drift
   into offering different things.

   Used today by every Scriptorium page. index.html still runs its own
   (older, already-debugged) menu — adopting this there is now a small
   mechanical change rather than a design question, and is deliberately
   left as a separate step so this one can ship without touching the
   map's working UI.

   ---- WHAT ACTUALLY MAKES THIS FEEL LIKE ONE PRODUCT ----

   Not the matching markup. Three things underneath it:

     * The search index IS manifest.json — a static file any page can
       fetch. So Cmd+K on a static entry page returns the same results,
       ranked the same way, as Cmd+K inside the map. This was already
       possible and simply wasn't wired up.

     * Bookmarks go through state.js, which reads and writes the exact
       localStorage key the map has always used. The star on this page is
       the same star as the one in the drawer.

     * The soundscape is the same engine file, with its preference
       carried across in shared state.

   ---- USAGE ----

       <burren-chrome root="../../" category="flora"
                      entry="spring-gentian" entry-title="Spring Gentian">
       </burren-chrome>

   `root` is the path from this page to the Scriptorium root (the folder
   holding manifest.json). Everything else is derived from it, so there
   is one path to get wrong instead of five.
   ========================================================================== */
(function (root, doc) {
  'use strict';

  var CFG = root.BurrenConfig || { siteName: 'The Burren Scriptorium', categories: {}, categoryOrder: [], crossing: {} };
  var State = root.BurrenState;

  var ICON = {
    search:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 L21 21"/></svg>',
    star:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/></svg>',
    sound:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 9v6h4l5 4V5L8 9Z"/><path d="M17 8.5a5 5 0 0 1 0 7"/></svg>',
    leaf:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20c0-9 6-15 16-16 1 10-5 16-13 16H4Z"/><path d="M4 20 14 10"/></svg>',
    map:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21 C12 21 5 15 5 9 C5 5 8 3 12 3 C16 3 19 5 19 9 C19 15 12 21 12 21 Z"/><circle cx="12" cy="9.5" r="2.6"/></svg>',
    camera:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 8 A2 2 0 0 1 6 6 H8 L9.5 4 H14.5 L16 6 H18 A2 2 0 0 1 20 8 V18 A2 2 0 0 1 18 20 H6 A2 2 0 0 1 4 18 Z"/><circle cx="12" cy="13" r="3.6"/></svg>',
    back:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 6 L9 12 L15 18"/></svg>'
  };

  // ------------------------------------------------------------------
  // The menu config — one list, filtered by context
  // ------------------------------------------------------------------
  // Adding a row here is the whole job of adding it to both surfaces.
  // `contexts` is what keeps map-only items (Routes, the 3D toggle) off
  // a static page and page-only items (Return to the ground) off the map.
  var MENU = [
    { id: 'search',      label: 'Search',             icon: ICON.search, contexts: ['map', 'page'] },
    { id: 'bookmarks',   label: 'Bookmarked Items',   icon: ICON.star,   contexts: ['map', 'page'] },
    { id: 'soundscape',  label: 'Soundscape',         icon: ICON.sound,  contexts: ['map', 'page'], widget: true },
    { id: 'identify',    label: 'Identify a Species', icon: ICON.camera, contexts: ['map', 'page'] },
    { divider: true,     contexts: ['map', 'page'] },
    { id: 'scriptorium', label: 'The Scriptorium',    icon: ICON.leaf,   contexts: ['map'] },
    { id: 'categories',  categories: true,            contexts: ['page'] },
    { divider: true,     contexts: ['page'] },
    { id: 'tomap',       label: null /* set per page */, icon: ICON.map, contexts: ['page'] }
  ];

  function categoryTitle(cat) {
    return (CFG.categories[cat] && CFG.categories[cat].title) || (cat.charAt(0).toUpperCase() + cat.slice(1));
  }
  function sortCategories(cats) {
    var order = CFG.categoryOrder || [];
    return cats.slice().sort(function (a, b) {
      var ai = order.indexOf(a), bi = order.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ------------------------------------------------------------------
  // Search — same index, same shape of result as the map
  // ------------------------------------------------------------------

  function normalize(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  // Mirrors the map's own tolerance: exact, then prefix, then a crude
  // singularisation so "ferns" finds "Fern" and "wells" finds "Well".
  function singularize(w) {
    if (w.length > 3 && /ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (w.length > 3 && /(ses|xes|zes|ches|shes)$/.test(w)) return w.slice(0, -2);
    if (w.length > 2 && /s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
    return w;
  }

  function scoreEntry(entry, terms) {
    var hay = normalize([
      entry.title, entry.irishTitle, entry.summary,
      entry.subCategory, entry.scientificName, entry.category
    ].filter(Boolean).join(' \u00b7 '));
    var titleN = normalize(entry.title);
    var score = 0;
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      var s = singularize(t);
      if (titleN === t) score += 100;
      else if (titleN.indexOf(t) === 0) score += 40;
      else if (titleN.indexOf(t) !== -1) score += 24;
      else if (hay.indexOf(t) !== -1) score += 10;
      else if (s !== t && hay.indexOf(s) !== -1) score += 7;
      else if (t.length >= 4 && hay.indexOf(t.slice(0, -1)) !== -1) score += 4;
      else return 0; // every term must land somewhere
    }
    return score;
  }

  // ------------------------------------------------------------------
  // The element
  // ------------------------------------------------------------------

  var Chrome = {
    entries: null,
    entriesPromise: null
  };

  Chrome.loadEntries = function (rootPath) {
    if (Chrome.entriesPromise) return Chrome.entriesPromise;
    Chrome.entriesPromise = fetch(rootPath + 'manifest.json')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (list) { Chrome.entries = list; return list; })
      .catch(function (err) {
        // Same posture as the map: the page is entirely readable without
        // search, so this warns and moves on rather than surfacing an error.
        console.warn('Burren chrome: manifest unavailable, search disabled —', err);
        Chrome.entries = [];
        return [];
      });
    return Chrome.entriesPromise;
  };

  function define() {
    if (root.customElements && root.customElements.get('burren-chrome')) return;

    var BurrenChrome = function () {
      return Reflect.construct(HTMLElement, [], BurrenChrome);
    };
    BurrenChrome.prototype = Object.create(HTMLElement.prototype);
    BurrenChrome.prototype.constructor = BurrenChrome;
    Object.setPrototypeOf(BurrenChrome, HTMLElement);

    BurrenChrome.prototype.connectedCallback = function () {
      var el = this;
      var rootPath = el.getAttribute('root') || '';
      var mapHref = rootPath + '../index.html';
      var category = el.getAttribute('category') || '';
      var entryId = el.getAttribute('entry') || '';
      var entryTitle = el.getAttribute('entry-title') || '';

      el.innerHTML = buildShell(rootPath, mapHref, category, entryTitle);
      wire(el, rootPath, mapHref, category, entryId, entryTitle);

      Chrome.loadEntries(rootPath);

      // The star can't be baked into the static HTML — whether it's
      // filled depends on this person's localStorage, which the build
      // knows nothing about. So the page ships the row and the chrome
      // fills it, which also means the page still renders correctly with
      // JS off, just without a star to press.
      if (category && entryTitle && State) {
        var titleRow = doc.querySelector('.entry-title-row');
        if (titleRow && !titleRow.querySelector('.bookmark-btn')) {
          titleRow.insertAdjacentHTML('beforeend', State.bookmarkBtnHtml(category, entryTitle));
          State.wireBookmarkBtn(titleRow.querySelector('.bookmark-btn'));
        }
      }

      if (root.BurrenSeam) {
        root.BurrenSeam.wireBackLinks(el);
        root.BurrenSeam.installSpeculationRules({
          prerenderPattern: rootPath === '' ? '/*' : null,
          mapHref: mapHref
        });
        root.BurrenSeam.resumeSoundscapeOnFirstGesture();
        if (category && entryId) root.BurrenSeam.markRead(category, entryId, entryTitle);
      }
    };

    root.customElements.define('burren-chrome', BurrenChrome);
  }

  function buildShell(rootPath, mapHref, category, entryTitle) {
    var backLabel = (CFG.crossing && CFG.crossing.backToMap) || 'Return to the ground';
    return '' +
      '<div class="bc-bar">' +
        '<a class="bc-home" href="' + esc(rootPath) + 'index.html">' + esc(CFG.siteName) + '</a>' +
        '<nav class="bc-nav" aria-label="Categories"></nav>' +
        '<div class="bc-actions">' +
          '<button type="button" class="bc-search-trigger" aria-label="Search">' + ICON.search +
            '<span class="bc-kbd">\u2318K</span></button>' +
          '<a class="bc-back" href="' + esc(mapHref) + '" data-seam-back="' + esc(mapHref) + '">' +
            ICON.back + '<span>' + esc(backLabel) + '</span></a>' +
          '<div class="bc-menu-wrap">' +
            '<button type="button" class="bc-burger" aria-expanded="false" aria-haspopup="true" aria-label="Menu">' +
              '<span></span><span></span><span></span></button>' +
            '<div class="bc-panel" role="menu"></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="bc-overlay" aria-hidden="true">' +
        '<div class="bc-overlay-inner" role="dialog" aria-label="Search the Scriptorium">' +
          '<div class="bc-input-row">' + ICON.search +
            '<input type="search" class="bc-input" placeholder="Search the Burren\u2026" autocomplete="off" spellcheck="false">' +
            '<button type="button" class="bc-close" aria-label="Close search">\u00d7</button>' +
          '</div>' +
          '<div class="bc-facets"></div>' +
          '<div class="bc-results" aria-live="polite"></div>' +
        '</div>' +
      '</div>';
  }

  function wire(el, rootPath, mapHref, category, entryId, entryTitle) {
    var burger  = el.querySelector('.bc-burger');
    var panel   = el.querySelector('.bc-panel');
    var overlay = el.querySelector('.bc-overlay');
    var input   = el.querySelector('.bc-input');
    var results = el.querySelector('.bc-results');
    var facets  = el.querySelector('.bc-facets');
    var navEl   = el.querySelector('.bc-nav');
    var savedOnly = false;

    // ---- category nav (data-driven, same source as the build) --------
    Chrome.loadEntries(rootPath).then(function (list) {
      var cats = sortCategories(Object.keys(list.reduce(function (acc, e) { acc[e.category] = 1; return acc; }, {})));
      navEl.innerHTML = cats.map(function (c) {
        return '<a href="' + esc(rootPath + c + '/') + '"' + (c === category ? ' aria-current="page"' : '') + '>' +
          esc(categoryTitle(c)) + '</a>';
      }).join('');
      renderPanel(cats);
    });

    // ---- burger menu -------------------------------------------------
    function renderPanel(cats) {
      var html = '';
      MENU.forEach(function (item) {
        if (item.contexts.indexOf('page') === -1) return;
        if (item.divider) { html += '<div class="bc-divider"></div>'; return; }
        if (item.categories) {
          html += (cats || []).map(function (c) {
            return '<a class="bc-item" href="' + esc(rootPath + c + '/') + '">' + ICON.leaf +
              '<span>' + esc(categoryTitle(c)) + '</span></a>';
          }).join('');
          return;
        }
        if (item.id === 'tomap') {
          var label = (CFG.crossing.toMapBy && CFG.crossing.toMapBy[category]) ||
                      CFG.crossing.toMap || 'Find it on the map';
          var href = entryId
            ? mapHref + '?entry=' + encodeURIComponent(category) + ':' + encodeURIComponent(entryId)
            : mapHref;
          html += '<a class="bc-item" href="' + esc(href) + '">' + item.icon +
            '<span>' + esc(entryTitle ? label : 'Open the map') + '</span></a>';
          return;
        }
        if (item.widget) {
          html += '<div class="bc-item bc-item-widget" data-widget="' + esc(item.id) + '">' + item.icon +
            '<span>' + esc(item.label) + '</span><span class="bc-widget-slot"></span></div>';
          return;
        }
        html += '<button type="button" class="bc-item" data-action="' + esc(item.id) + '">' + item.icon +
          '<span>' + esc(item.label) + '</span>' +
          (item.id === 'bookmarks' ? '<span class="bc-count"></span>' : '') + '</button>';
      });
      panel.innerHTML = html;

      // Re-attach the live soundscape widget node (listeners intact)
      // rather than rebuilding it, exactly as the map's own menu does.
      var slot = panel.querySelector('[data-widget="soundscape"] .bc-widget-slot');
      if (slot && root.BurrenSoundscape) {
        root.BurrenSoundscape.mount();
        if (root.BurrenSoundscape.widgetEl) slot.appendChild(root.BurrenSoundscape.widgetEl);
      }

      var count = panel.querySelector('.bc-count');
      if (count && State) {
        var n = State.fieldNotes.list().length;
        count.textContent = n ? String(n) : '';
      }

      panel.querySelectorAll('[data-action]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var action = btn.getAttribute('data-action');
          closeMenu();
          if (action === 'search') openSearch(false);
          else if (action === 'bookmarks') openSearch(true);
          else if (action === 'identify') root.location.href = mapHref + '?identify=1';
        });
      });
    }

    function openMenu() { panel.classList.add('open'); burger.setAttribute('aria-expanded', 'true'); }
    function closeMenu() { panel.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); }
    burger.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (panel.classList.contains('open')) closeMenu(); else openMenu();
    });
    doc.addEventListener('click', function (ev) { if (!el.contains(ev.target)) closeMenu(); });

    // ---- search ------------------------------------------------------
    function openSearch(saved) {
      savedOnly = !!saved;
      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');
      doc.body.classList.add('bc-locked');
      renderFacets();
      render(input.value);
      // A saved-items view opens straight to the list; a search opens to
      // the field. Focusing an input on iOS also raises the keyboard, so
      // it's deliberately not done for the bookmarks entry point.
      if (!savedOnly) setTimeout(function () { input.focus(); }, 30);
    }
    function closeSearch() {
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
      doc.body.classList.remove('bc-locked');
    }
    el.querySelector('.bc-search-trigger').addEventListener('click', function () { openSearch(false); });
    el.querySelector('.bc-close').addEventListener('click', closeSearch);
    overlay.addEventListener('click', function (ev) { if (ev.target === overlay) closeSearch(); });

    doc.addEventListener('keydown', function (ev) {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); openSearch(false); }
      else if (ev.key === 'Escape') {
        if (overlay.classList.contains('open')) closeSearch();
        else closeMenu();
      } else if (ev.key === '/' && doc.activeElement === doc.body) {
        ev.preventDefault(); openSearch(false);
      }
    });

    function renderFacets() {
      facets.innerHTML = '<button type="button" class="bc-facet" data-facet="saved" data-active="' + savedOnly + '">' +
        ICON.star + ' Saved</button>';
      facets.querySelector('[data-facet="saved"]').addEventListener('click', function () {
        savedOnly = !savedOnly;
        renderFacets();
        render(input.value);
      });
    }

    var debounce;
    input.addEventListener('input', function () {
      clearTimeout(debounce);
      debounce = setTimeout(function () { render(input.value); }, 90);
    });

    function render(query) {
      Chrome.loadEntries(rootPath).then(function (list) {
        var terms = normalize(query).split(/\s+/).filter(Boolean);
        var rows = list;

        if (savedOnly && State) {
          rows = rows.filter(function (e) { return State.fieldNotes.has(e.category, e.title); });
        }
        if (terms.length) {
          rows = rows.map(function (e) { return { e: e, s: scoreEntry(e, terms) }; })
                     .filter(function (r) { return r.s > 0; })
                     .sort(function (a, b) { return b.s - a.s; })
                     .map(function (r) { return r.e; });
        } else if (!savedOnly) {
          rows = rows.slice().sort(function (a, b) { return a.title.localeCompare(b.title); }).slice(0, 40);
        }

        if (!rows.length) {
          results.innerHTML = '<p class="bc-empty">' +
            (savedOnly ? 'Nothing saved yet \u2014 the \u2605 on any entry keeps it here.'
                       : 'Nothing in the Scriptorium matches that.') +
            (terms.length ? ' <a href="' + esc(mapHref) + '?q=' + encodeURIComponent(query) + '">Try the map instead \u2192</a>' : '') +
            '</p>';
          return;
        }

        results.innerHTML = rows.slice(0, 60).map(function (e) {
          var readTick = (State && State.read.has(e.id)) ? '<span class="bc-read" title="Read">\u2713</span>' : '';
          return '<a class="bc-result" href="' + esc(rootPath + e.category + '/' + e.id + '/') + '">' +
            '<span class="bc-result-main">' +
              '<span class="bc-result-title">' + esc(e.title) + readTick + '</span>' +
              (e.irishTitle ? '<span class="bc-result-irish" lang="ga">' + esc(e.irishTitle) + '</span>' : '') +
              '<span class="bc-result-summary">' + esc(e.summary || '') + '</span>' +
            '</span>' +
            '<span class="bc-result-side">' +
              '<span class="bc-result-cat" data-cat="' + esc(e.category) + '">' + esc(categoryTitle(e.category)) + '</span>' +
              (State ? State.bookmarkBtnHtml(e.category, e.title) : '') +
            '</span></a>';
        }).join('');

        if (State) {
          results.querySelectorAll('.bookmark-btn').forEach(function (btn) {
            State.wireBookmarkBtn(btn, function () { if (savedOnly) render(input.value); });
          });
        }
      });
    }

    if (State) State.onChange(function () {
      var count = panel.querySelector('.bc-count');
      if (count) { var n = State.fieldNotes.list().length; count.textContent = n ? String(n) : ''; }
    });
  }

  // Custom elements need the class syntax path in modern browsers; the
  // Reflect.construct form above keeps this file ES5-parseable so it can
  // sit in the same script pipeline as everything else here. If custom
  // elements aren't available at all, the page keeps its server-rendered
  // nav and simply has no burger menu — degraded, never broken.
  if (root.customElements && root.Reflect && root.Reflect.construct) define();

  root.BurrenChrome = Chrome;
}(typeof self !== 'undefined' ? self : this, document));
