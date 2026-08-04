#!/usr/bin/env node
/**
 * ==========================================================================
 * Checks every internal href/src in dist/ actually resolves to a real
 * file, that no %%R%% rebasing token was left un-substituted anywhere,
 * and that nothing links to a "publish": false record (which has no
 * page — see build.js's entryHref()).
 *
 * This turns "2,144 internal links checked, none broken" from a one-off
 * manual pass into something the build itself enforces. build.js calls
 * this automatically as its last step; run it standalone with:
 *
 *   node tools/check-generated-links.js [path-to-dist] [path-to-repo-root]
 *
 * Exits non-zero on any failure, so it's safe to chain in CI.
 * ==========================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

function walk(dir, exts) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

// Deliberately a plain regex scan, not an HTML parser — this repo has no
// dependencies today (zero-framework, by design) and a link-integrity
// check isn't worth becoming the first one. Good enough for well-formed
// generated HTML; not intended for arbitrary hand-authored markup.
const REF_RE = /\b(?:href|src)="([^"]*)"/g;

// dist/ is not what gets deployed at the site root — at deploy time its
// CONTENTS become the scriptorium/ folder sitting next to index.html,
// sw.js and the favicons (see build.js's own DEPTHS comment: an entry
// page's "../../../favicon.svg" climbs out of <cat>/<slug>/, out of
// scriptorium/, to the repo root). A checker that only knows about
// dist/ in isolation sees every one of those root-relative climbs as
// a missing file — they aren't, they're just outside what this
// function is standalone-checking. This maps a ref resolved from
// inside dist/ onto where it will ACTUALLY sit once scriptorium/dist/
// becomes <repoRoot>/scriptorium/, so root-level assets are checked
// against the real repo root rather than reported as false positives.
function resolveAgainstDeployment(fileInDist, target, distDir, repoRoot) {
  const scriptoriumRoot = path.join(repoRoot, 'scriptorium');
  const virtualFile = path.join(scriptoriumRoot, path.relative(distDir, fileInDist));
  const virtualResolved = path.normalize(path.join(path.dirname(virtualFile), target));

  const withinScriptorium = !path.relative(scriptoriumRoot, virtualResolved).startsWith('..');
  if (withinScriptorium) {
    // Maps back onto the real, pre-deploy dist/ path so existence checks
    // (and the publish:false lookup, which is keyed by dist-relative path)
    // keep working exactly as before for anything genuinely inside dist/.
    return { real: path.join(distDir, path.relative(scriptoriumRoot, virtualResolved)), distRelative: true };
  }
  // Outside scriptorium/ entirely — a real file at the repo root
  // (favicon.svg, apple-touch-icon.png, index.html, sw.js).
  return { real: virtualResolved, distRelative: false };
}

function checkDist(distDir, repoRoot) {
  // Defaults to distDir's grandparent — for this repo that's
  // scriptorium/dist/ -> scriptorium/ -> repo root, matching how
  // build.js actually calls this (repoRoot = path.join(ROOT, '..')).
  repoRoot = repoRoot || path.join(distDir, '..', '..');

  const errors = [];
  let checked = 0;

  // ---- every generated record's publish status, for the "no links to
  // unpublished records" check ----
  const manifestPath = path.join(distDir, 'manifest.json');
  const unpublished = new Set();
  if (fs.existsSync(manifestPath)) {
    JSON.parse(fs.readFileSync(manifestPath, 'utf8')).forEach((e) => {
      if (e.published === false) unpublished.add(e.category + '/' + e.id + '/');
    });
  }

  const htmlFiles = walk(distDir, ['.html']);

  htmlFiles.forEach((file) => {
    const html = fs.readFileSync(file, 'utf8');

    if (html.indexOf('%%R%%') !== -1) {
      errors.push(`${rel(file)}: an un-substituted %%R%% token made it into generated output`);
    }

    let m;
    REF_RE.lastIndex = 0;
    while ((m = REF_RE.exec(html))) {
      const ref = m[1];
      if (/^(https?:|\/\/|#|mailto:|data:|\{\{)/.test(ref)) continue; // external/absolute/template leftover
      const target = ref.split('?')[0].split('#')[0];
      if (!target) continue;
      checked++;

      const { real: resolved, distRelative } = resolveAgainstDeployment(file, target, distDir, repoRoot);

      if (distRelative) {
        const relFromDist = path.relative(distDir, resolved).split(path.sep).join('/');
        if (unpublished.has(relFromDist + (relFromDist.endsWith('/') ? '' : '/'))) {
          errors.push(`${rel(file)}: links to "${ref}", which is publish:false and has no page`);
          continue;
        }
      }

      const isDir = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
      if (isDir) {
        if (!fs.existsSync(path.join(resolved, 'index.html'))) {
          errors.push(`${rel(file)}: "${ref}" resolves to a directory with no index.html`);
        }
      } else if (!fs.existsSync(resolved)) {
        const where = distRelative ? 'dist/' : `the repo root (${path.relative(repoRoot, resolved) || '.'})`;
        errors.push(`${rel(file)}: "${ref}" does not resolve to any file in ${where}`);
      }
    }
  });

  function rel(f) { return path.relative(distDir, f); }

  return { checked, errors, files: htmlFiles.length };
}

function main() {
  const distDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'scriptorium', 'dist'));
  const repoRoot = process.argv[3] ? path.resolve(process.argv[3]) : undefined;
  if (!fs.existsSync(distDir)) {
    console.error(`No dist/ found at ${distDir} — run scriptorium/build.js first.`);
    process.exit(1);
  }
  const { checked, errors, files } = checkDist(distDir, repoRoot);
  console.log(`Checked ${checked} internal reference(s) across ${files} generated page(s).`);
  if (errors.length) {
    console.error(`\n${errors.length} broken reference(s):\n`);
    errors.forEach((e) => console.error('  ! ' + e));
    process.exitCode = 1;
  } else {
    console.log('All internal references resolve. No %%R%% leaks. No links to unpublished records.');
  }
}

if (require.main === module) main();
module.exports = { checkDist };
