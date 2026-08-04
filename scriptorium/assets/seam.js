/* ==========================================================================
   Burren — the seam.

   Everything to do with crossing between the map and a Scriptorium page.
   Loaded by both surfaces, so the crossing behaves the same in both
   directions rather than being implemented once per side.

   The mechanisms, cheapest first:

   1. smartBack()  — if you arrived here from the map, go BACK to it
                     rather than loading a fresh copy. When the browser's
                     back/forward cache is doing its job this restores the
                     live map instantly, with camera, filters and drawer
                     stack exactly as you left them, and MapLibre never
                     re-initialises. This is by far the biggest single win
                     available and it costs almost nothing.

   2. speculation rules — prerender Scriptorium pages on hover (they're
                     tiny), but only PREFETCH the map. Prerendering the
                     map would boot MapLibre and start pulling tiles for a
                     visit that may never happen.

   3. mapView handoff — the fallback for when bfcache doesn't apply (cold
                     navigation, a shared link, some iOS conditions).

   4. soundscape resume — an AudioContext cannot survive a document
                     change and cannot start without a user gesture, so
                     the preference crosses instead and picks back up on
                     the first click or key press.

   ---- bfcache is fragile; treat it as a standing constraint ----

   The back/forward cache is disqualified by an `unload` or
   `beforeunload` listener anywhere on the page, by an open IndexedDB
   transaction at navigation time, and by a `Cache-Control: no-store`
   response header. None of those are present today. If one gets added,
   nothing throws and nothing warns — the crossing just quietly gets slow
   again. checkBfcacheHazards() below logs a warning in that case so it
   fails loudly instead of silently.
   ========================================================================== */
(function (root, doc) {
  'use strict';

  var Seam = {};

  // --------------------------------------------------------------------
  // 1. Smart back
  // --------------------------------------------------------------------

  // A same-origin referrer only tells you "somewhere on this site" — it
  // doesn't tell you the map is what's actually sitting immediately
  // behind THIS page in history. Category hub -> entry -> another entry
  // via a cross-reference is also same-origin, and history.back() from
  // there lands on the previous ARTICLE, not the map, while the button
  // still says "Return to the ground."
  //
  // MAP_ARRIVAL_KEY is a one-shot sessionStorage flag, set immediately
  // before the map hands off to a Scriptorium page (armMapArrival,
  // called from index.html) and consumed ONCE, at page-LOAD time, by
  // consumeMapArrival below — not at click time. That distinction is
  // what keeps a Scriptorium->Scriptorium hop from inheriting a stale
  // "yes" from two pages back: the flag is read-and-cleared the moment
  // the FIRST page after the map loads, so by the time a second article
  // loads from a cross-reference, there's nothing left to inherit.
  var MAP_ARRIVAL_KEY = 'burren.cameFromMap.v1';

  // Called from index.html right before a same-tab navigation to any
  // scriptorium/ URL (burger menu links, the "explore on map" round-trip,
  // etc.) so the very next page load can tell it genuinely followed the
  // map, not just landed somewhere on the same origin at some point.
  Seam.armMapArrival = function () {
    try { sessionStorage.setItem(MAP_ARRIVAL_KEY, '1'); } catch (e) { /* private browsing */ }
  };

  // Read-and-clear, meant to be called exactly once per page load
  // (chrome.js does this in connectedCallback). The boolean it returns
  // is what smartBack trusts — never a fresh sessionStorage read at
  // click time, which is what let the old referrer check drift.
  Seam.consumeMapArrival = function () {
    var flag;
    try { flag = sessionStorage.getItem(MAP_ARRIVAL_KEY) === '1'; sessionStorage.removeItem(MAP_ARRIVAL_KEY); }
    catch (e) { flag = false; }
    return flag;
  };

  // `trusted` is this page's own consumeMapArrival() result, captured
  // once at load and threaded through — see wireBackLinks. `fallbackHref`
  // is used whenever it's false: a search-engine landing, a shared link,
  // or a Scriptorium->Scriptorium hop, none of which have the map
  // sitting immediately behind them in history.
  Seam.smartBack = function (trusted, fallbackHref) {
    if (trusted && root.history.length > 1) { root.history.back(); return true; }
    if (fallbackHref) root.location.href = fallbackHref;
    return false;
  };

  // Wires any element carrying data-seam-back="<fallback href>". Consumes
  // the map-arrival flag exactly ONCE here, at wiring time (which chrome.js
  // calls from connectedCallback, i.e. page load) — not inside the click
  // handler, so a click ten minutes and three cross-reference clicks later
  // still reflects whether THIS page load followed the map, not whatever
  // the flag happens to say at the moment of the click.
  Seam.wireBackLinks = function (scope) {
    var trusted = Seam.consumeMapArrival();
    (scope || doc).querySelectorAll('[data-seam-back]').forEach(function (el) {
      el.addEventListener('click', function (ev) {
        // Let modified clicks (new tab, new window, download) behave normally.
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
        ev.preventDefault();
        Seam.smartBack(trusted, el.getAttribute('data-seam-back') || el.getAttribute('href'));
      });
    });
  };

  // --------------------------------------------------------------------
  // 2. Speculation rules
  // --------------------------------------------------------------------

  // Injected rather than written into every template, so the prerender/
  // prefetch asymmetry lives in one place. Browsers without support
  // ignore the script tag entirely.
  //
  // `eagerness: moderate` fires on hover / pointerdown rather than
  // immediately, which is the right trade for a site where most links on
  // a hub page will never be clicked.
  Seam.installSpeculationRules = function (opts) {
    opts = opts || {};
    if (!HTMLScriptElement.supports || !HTMLScriptElement.supports('speculationrules')) return false;
    if (doc.querySelector('script[type="speculationrules"][data-burren]')) return false;

    var rules = { prerender: [], prefetch: [] };
    if (opts.prerenderPattern) {
      rules.prerender.push({ where: { href_matches: opts.prerenderPattern }, eagerness: 'moderate' });
    }
    // Note the asymmetry: the map is PREFETCHED, never prerendered.
    if (opts.mapHref) {
      rules.prefetch.push({ urls: [opts.mapHref], eagerness: 'moderate' });
    }
    if (!rules.prerender.length) delete rules.prerender;
    if (!rules.prefetch.length) delete rules.prefetch;
    if (!rules.prerender && !rules.prefetch) return false;

    var s = doc.createElement('script');
    s.type = 'speculationrules';
    s.setAttribute('data-burren', '');
    s.textContent = JSON.stringify(rules);
    doc.head.appendChild(s);
    return true;
  };

  // --------------------------------------------------------------------
  // 3. bfcache hazard check
  // --------------------------------------------------------------------

  // Can't detect listeners added by other scripts directly, so this
  // hooks addEventListener once and complains if anything ever registers
  // the two that matter. Development aid; harmless in production.
  Seam.checkBfcacheHazards = function () {
    var origAdd = root.addEventListener;
    root.addEventListener = function (type) {
      if (type === 'unload' || type === 'beforeunload') {
        console.warn(
          'Burren: a "' + type + '" listener was just registered on window. ' +
          'This disqualifies the page from the back/forward cache, which is what makes ' +
          'returning to the map instant. Use "pagehide" instead — it fires in the same ' +
          'situations and does not block bfcache.'
        );
      }
      return origAdd.apply(root, arguments);
    };
  };

  // --------------------------------------------------------------------
  // 4. Map view handoff
  // --------------------------------------------------------------------

  // Called from the map before it hands off to a page. Uses 'pagehide'
  // rather than 'beforeunload' precisely because of the constraint above.
  Seam.armMapViewSaver = function (getView) {
    root.addEventListener('pagehide', function () {
      try { if (root.BurrenState) root.BurrenState.mapView.save(getView()); }
      catch (e) { /* never worth taking a navigation down for */ }
    });
  };

  // --------------------------------------------------------------------
  // 5. Soundscape continuity
  // --------------------------------------------------------------------

  // An AudioContext can't be created without a user gesture, so if the
  // stored preference says the soundscape was playing, arm a one-shot
  // listener that resumes it the first time the person interacts. Silent
  // and invisible if they never do.
  Seam.resumeSoundscapeOnFirstGesture = function () {
    if (!root.BurrenSoundscape || !root.BurrenState) return;
    var prefs = root.BurrenSoundscape.restorePrefs();
    if (!prefs || !prefs.playing) return;

    function go() {
      try { root.BurrenSoundscape.play(); } catch (e) { /* autoplay policy; nothing to do */ }
      doc.removeEventListener('pointerdown', go, true);
      doc.removeEventListener('keydown', go, true);
    }
    doc.addEventListener('pointerdown', go, true);
    doc.addEventListener('keydown', go, true);

    // Keep the stored preference current as the person changes it.
    root.addEventListener('pagehide', function () { root.BurrenSoundscape.persistPrefs(); });
  };

  // --------------------------------------------------------------------
  // 6. Reading history
  // --------------------------------------------------------------------

  Seam.markRead = function (category, id, title) {
    if (root.BurrenState) root.BurrenState.read.mark(category, id, title);
  };

  root.BurrenSeam = Seam;
}(typeof self !== 'undefined' ? self : this, document));
