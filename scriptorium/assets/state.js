/* ==========================================================================
   Burren — shared client state.

   The map and the Scriptorium are two documents on one origin, which
   means they already share localStorage — they just weren't using it as
   a shared thing. This file is the contract.

   The practical payoff: the ★ on a static entry page is LITERALLY the
   same star as the one in the map's drawer. Star a flower from a Google
   result, open the map an hour later, and it's in your Field Notes. That
   single behaviour does more to make these feel like one product than
   any amount of matching CSS.

   ---- KEY FORMAT ----

   FIELD_NOTES_KEY and the 'kind::name' id format are byte-identical to
   what index.html has always written, so existing saved entries survive
   this change untouched. `kind` is the map's marker kind for map
   subjects ('site' | 'town' | 'legend') and the CATEGORY for Scriptorium
   subjects ('flora' | 'fauna' | 'story' | 'poetry') — which is exactly
   what openScriptoriumDrawer already passed. Don't "tidy" this into
   slugs without a migration; it would silently orphan everyone's saves.

   Every write is wrapped: private browsing and full-quota conditions
   throw on localStorage.setItem, and a saved bookmark failing is never
   worth taking the page down for.
   ========================================================================== */
(function (root) {
  'use strict';

  var FIELD_NOTES_KEY = 'burrenFieldNotesV1';
  var SOUNDSCAPE_KEY  = 'burrenSoundscapeV1';
  var READ_KEY        = 'burrenReadV1';
  var MAPVIEW_KEY     = 'burren.mapview.v1';   // sessionStorage, not local

  function readJSON(store, key, fallback) {
    try {
      var raw = store.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn('Burren state: could not read ' + key, e);
      return fallback;
    }
  }
  function writeJSON(store, key, value) {
    try { store.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { console.warn('Burren state: could not write ' + key + ' (private browsing?)', e); return false; }
  }

  // ---- Field Notes (bookmarks) ---------------------------------------

  function fnList() { return readJSON(localStorage, FIELD_NOTES_KEY, []) || []; }
  function fnSave(list) { return writeJSON(localStorage, FIELD_NOTES_KEY, list); }
  function fnId(kind, name) { return kind + '::' + name; }
  function fnHas(kind, name) {
    var id = fnId(kind, name);
    return fnList().some(function (n) { return n.id === id; });
  }
  // Returns true if the entry is now saved, false if it was just removed —
  // callers use this to flip the star without a second lookup.
  function fnToggle(kind, name, extra) {
    var list = fnList();
    var id = fnId(kind, name);
    var at = -1;
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { at = i; break; } }
    if (at !== -1) { list.splice(at, 1); fnSave(list); broadcast(); return false; }
    var entry = { id: id, kind: kind, name: name, savedAt: new Date().toISOString() };
    if (extra) { for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) entry[k] = extra[k]; } }
    list.push(entry);
    fnSave(list);
    broadcast();
    return true;
  }

  var BOOKMARK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/></svg>';

  // Byte-compatible with what index.html has always emitted (same class
  // names, same data-attributes, same title strings) so the map's own CSS
  // and its "Saved only" search facet keep working against buttons
  // rendered by either surface.
  function bookmarkBtnHtml(kind, name, extraClass) {
    var saved = fnHas(kind, name);
    return '<button class="bookmark-btn' + (extraClass ? ' ' + extraClass : '') + (saved ? ' saved' : '') + '" ' +
      'data-bookmark-kind="' + String(kind).replace(/"/g, '&quot;') + '" ' +
      'data-bookmark-name="' + String(name).replace(/"/g, '&quot;') + '" ' +
      'title="' + (saved ? 'Remove from Field Notes' : 'Save to Field Notes') + '" ' +
      'aria-label="Save to Field Notes">' + BOOKMARK_SVG + '</button>';
  }

  // Wires a bookmark button already in the DOM. `onToggle` is optional —
  // callers that need to refresh something else (e.g. re-render a result
  // list so a "Saved only" facet updates immediately) pass one in.
  function wireBookmarkBtn(btn, onToggle) {
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      ev.preventDefault();
      var kind = btn.getAttribute('data-bookmark-kind');
      var name = btn.getAttribute('data-bookmark-name');
      var extra = null;
      try { extra = btn.dataset.bookmarkExtra ? JSON.parse(btn.dataset.bookmarkExtra) : null; }
      catch (e) { extra = null; }
      var nowSaved = fnToggle(kind, name, extra);
      btn.classList.toggle('saved', nowSaved);
      btn.title = nowSaved ? 'Remove from Field Notes' : 'Save to Field Notes';
      if (onToggle) onToggle(nowSaved);
    });
  }

  // ---- Soundscape preference -----------------------------------------
  // A page navigation destroys the AudioContext, so audio genuinely stops
  // at the seam between map and page. What's stored here is enough for
  // the other side to pick it back up on its own first user gesture and
  // fade in, which reads as continuous even though it technically isn't.

  function soundscapePrefs() {
    return readJSON(localStorage, SOUNDSCAPE_KEY, { playing: false, volume: 0.15, mode: null }) ||
      { playing: false, volume: 0.15, mode: null };
  }
  function setSoundscapePrefs(patch) {
    var cur = soundscapePrefs();
    for (var k in patch) { if (Object.prototype.hasOwnProperty.call(patch, k)) cur[k] = patch[k]; }
    writeJSON(localStorage, SOUNDSCAPE_KEY, cur);
    return cur;
  }

  // ---- Read history ---------------------------------------------------
  // Capped at 60 and stored newest-first. Used for "recently read" and
  // for the small ✓ the hub pages put beside an entry you've opened.

  function readList() { return readJSON(localStorage, READ_KEY, []) || []; }
  function markRead(category, id, title) {
    var list = readList().filter(function (r) { return r.id !== id; });
    list.unshift({ id: id, category: category, title: title, at: Date.now() });
    writeJSON(localStorage, READ_KEY, list.slice(0, 60));
  }
  function hasRead(id) { return readList().some(function (r) { return r.id === id; }); }

  // ---- Map view handoff ------------------------------------------------
  // sessionStorage, not localStorage: this is "where I was a moment ago",
  // not a preference, and it should not survive closing the tab.
  //
  // This is the belt to bfcache's braces. When the back/forward cache
  // works (see seam.js's smartBack), the live map is restored wholesale
  // and none of this is needed. When it doesn't — a cold navigation, a
  // shared link, some iOS conditions — this is what stops the map from
  // dumping you back at the default Galway-to-Limerick framing.

  function saveMapView(view) { return writeJSON(sessionStorage, MAPVIEW_KEY, view); }
  function takeMapView() {
    var v = readJSON(sessionStorage, MAPVIEW_KEY, null);
    try { sessionStorage.removeItem(MAPVIEW_KEY); } catch (e) { /* non-fatal */ }
    return v;
  }
  function peekMapView() { return readJSON(sessionStorage, MAPVIEW_KEY, null); }

  // ---- Change notification ---------------------------------------------
  // Within one document, so a bookmark toggled in the drawer updates the
  // star in a search result card without either knowing about the other.
  // Across documents the browser's own 'storage' event already fires, and
  // is re-broadcast here so listeners only need one subscription.

  var listeners = [];
  function broadcast() { listeners.forEach(function (fn) { try { fn(); } catch (e) { console.warn(e); } }); }
  function onChange(fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; }
  if (root.addEventListener) {
    root.addEventListener('storage', function (e) {
      if (e.key === FIELD_NOTES_KEY || e.key === READ_KEY) broadcast();
    });
  }

  root.BurrenState = {
    FIELD_NOTES_KEY: FIELD_NOTES_KEY,
    fieldNotes: {
      list: fnList, save: fnSave, id: fnId, has: fnHas, toggle: fnToggle
    },
    bookmarkSvg: BOOKMARK_SVG,
    bookmarkBtnHtml: bookmarkBtnHtml,
    wireBookmarkBtn: wireBookmarkBtn,
    soundscape: { get: soundscapePrefs, set: setSoundscapePrefs },
    read: { list: readList, mark: markRead, has: hasRead },
    mapView: { save: saveMapView, take: takeMapView, peek: peekMapView },
    onChange: onChange,
    notify: broadcast
  };
}(typeof self !== 'undefined' ? self : this));
