/* ==========================================================================
   Burren — shared site configuration.

   Read by build.js (Node, via require) AND by the map and every
   Scriptorium page (browser, via <script src>). One file, one set of
   values, so there is no second copy to drift.

   ---- WHAT YOU MAY WANT TO EDIT ----

   siteUrl is the ONLY thing here that needs to know about your actual
   deployment, and it's only used for things that genuinely require an
   absolute URL: <link rel="canonical">, sitemap.xml, and Open Graph
   tags. Leave it as an empty string and build.js simply omits those
   three rather than emitting wrong ones — a missing canonical is
   harmless, a canonical pointing at the wrong origin actively hurts.

   Every internal link on the site is RELATIVE and computed per page (see
   entry-render.js's %%R%% token), so nothing else here depends on where
   the site is served from. That is deliberate: the old hardcoded
   BASE_URL is what broke every cross-link the last time this moved to a
   new GitHub project, and a root-relative "/scriptorium/..." would break
   exactly the same way on a project subpath like /burren/.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BurrenConfig = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  return {
    siteName: 'The Burren Scriptorium',

    // e.g. 'https://yourname.github.io/burren' — no trailing slash.
    // Empty = skip canonical/sitemap/OG rather than guess.
    siteUrl: '',

    // Display titles and reading order for the category hubs and nav.
    // A category present in data/ but missing here still works — it just
    // falls in alphabetically after these, with a capitalised name.
    categories: {
      flora:   { title: 'Flora',           accentVar: '--flora',       singular: 'plant'   },
      fauna:   { title: 'Fauna',           accentVar: '--fauna',       singular: 'animal'  },
      story:   { title: 'Stories & Sites', accentVar: '--story',       singular: 'story'   },
      poetry:  { title: 'Poetry',          accentVar: '--poetry',      singular: 'poem'    }
    },
    categoryOrder: ['flora', 'fauna', 'story', 'poetry'],

    // Crossing copy. Written once and used on BOTH sides, because
    // inconsistent microcopy is itself a way the seam shows. Category
    // keys override the default where the phrasing can be more specific.
    crossing: {
      toMap:        'Find it on the map',
      toMapBy: {
        flora:  'Find where it grows',
        fauna:  'Find where it walks',
        story:  'Stand where it stood',
        poetry: 'Find where it was written'
      },
      toPage:       'Read the full leaf',
      backToMap:    'Return to the ground',
      scriptorium:  'The Scriptorium'
    }
  };
}));
