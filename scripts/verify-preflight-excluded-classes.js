#!/usr/bin/env node
/**
 * Verification script for the excludedElementClasses feature (SITES-44776).
 *
 * Usage:
 *   node scripts/verify-preflight-excluded-classes.js <html-file> [--class <className>]
 *
 * Examples:
 *   # Discovery mode — find which classes contain the known corp-only Walmart domains
 *   node scripts/verify-preflight-excluded-classes.js /path/to/uswire-homepage.html
 *
 *   # Filter mode — confirm a specific class prunes the right links
 *   node scripts/verify-preflight-excluded-classes.js /path/to/uswire-homepage.html --class cmp-feature-apps
 */

import { readFileSync } from 'fs';
import { load as cheerioLoad } from 'cheerio';
import { fileURLToPath } from 'url';
import path from 'path';
import { filterExcludedElements } from '../src/preflight/links-checks.js';

// Known corp-only Walmart domains that should be unreachable from AWS Lambda
// (sourced from the SITES-44776 Jira analysis comment)
const CORP_ONLY_DOMAINS = [
  'baletracker-wrcloud.wal-mart.com',
  'gta-associateinformationlineweb.prod.walmart.net',
  'internal.walmart.com',
  'lossprevention-prod.wal-mart.com',
  'mygnfr.walmart.com',
  'nabpm.cloud.wal-mart.com',
  'outlook.wal-mart.com',
  'productremovalwr-prod.wal-mart.com',
  'radapps3.wal-mart.com',
  'stores.tableau.wal-mart.com',
  'timesheet.cloud.wal-mart.com',
  'timesheet.wal-mart.com',
  'workforce-planning-portal.us-walmart.prod.polaris.walmart.com',
  'workvivo.walmart.com',
];

function isCorpOnly(href) {
  try {
    const { hostname } = new URL(href);
    return CORP_ONLY_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

function extractExternalHrefs($, pageOrigin) {
  const hrefs = new Set();
  $('a[href]').each((_, a) => {
    try {
      const href = $(a).attr('href');
      const abs = new URL(href, pageOrigin).toString();
      if (new URL(abs).origin !== pageOrigin) {
        hrefs.add(abs);
      }
    } catch { /* skip invalid */ }
  });
  return hrefs;
}

function findAncestorClasses($, el) {
  const classes = new Set();
  $(el).parents('[class]').each((_, p) => {
    $(p).attr('class').split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
  });
  // Also include classes on the element itself
  const ownClass = $(el).closest('[class]').attr('class');
  if (ownClass) {
    ownClass.split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
  }
  return classes;
}

// --- parse args ---
const args = process.argv.slice(2);
const htmlFile = args[0];
const classArgIdx = args.indexOf('--class');
const filterClass = classArgIdx !== -1 ? args[classArgIdx + 1] : null;

if (!htmlFile) {
  console.error('Usage: node scripts/verify-preflight-excluded-classes.js <html-file> [--class <className>]');
  process.exit(1);
}

const html = readFileSync(htmlFile, 'utf8');
const PAGE_URL = 'https://uswire.wal-mart.com/';
const pageOrigin = new URL(PAGE_URL).origin;

// --- Phase 1: Discovery ---
console.log('\n═══════════════════════════════════════════════════════');
console.log('PHASE 1 — Corp-only links found in unfiltered HTML');
console.log('═══════════════════════════════════════════════════════\n');

const $raw = cheerioLoad(html);
const allExternal = extractExternalHrefs($raw, pageOrigin);
const corpLinks = [...allExternal].filter(isCorpOnly);

console.log(`Total external links:   ${allExternal.size}`);
console.log(`Corp-only links found:  ${corpLinks.length}`);
console.log('\nCorp-only links:');
corpLinks.forEach((l) => console.log(`  ${l}`));

// Find ancestor classes for each corp-only link
const classFrequency = new Map();
const $disc = cheerioLoad(html);
$disc('a[href]').each((_, a) => {
  try {
    const href = $disc(a).attr('href');
    const abs = new URL(href, pageOrigin).toString();
    if (!isCorpOnly(abs)) return;
    const classes = findAncestorClasses($disc, a);
    classes.forEach((c) => {
      classFrequency.set(c, (classFrequency.get(c) || 0) + 1);
    });
  } catch { /* skip */ }
});

// Sort by frequency desc, show only classes that appear on multiple corp-only links
const candidates = [...classFrequency.entries()]
  .filter(([, count]) => count >= 2)
  .sort(([, a], [, b]) => b - a)
  .slice(0, 20);

console.log('\nTop ancestor classes shared by corp-only links (candidates for excludedElementClasses):');
candidates.forEach(([cls, count]) => console.log(`  ${count.toString().padStart(2)}/${corpLinks.length}  .${cls}`));

// --- Phase 2: Filter verification ---
if (filterClass) {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`PHASE 2 — Effect of excludedElementClasses: ["${filterClass}"]`);
  console.log('═══════════════════════════════════════════════════════\n');

  const $filtered = cheerioLoad(html);
  filterExcludedElements($filtered, [filterClass]);
  const afterExternal = extractExternalHrefs($filtered, pageOrigin);
  const afterCorp = [...afterExternal].filter(isCorpOnly);

  const pruned = corpLinks.filter((l) => !afterExternal.has(l));
  const missed = corpLinks.filter((l) => afterExternal.has(l));
  const falsePruned = [...allExternal].filter((l) => !isCorpOnly(l) && !afterExternal.has(l));

  console.log(`External links before: ${allExternal.size}`);
  console.log(`External links after:  ${afterExternal.size}  (${allExternal.size - afterExternal.size} removed)`);
  console.log(`Corp-only before:      ${corpLinks.length}`);
  console.log(`Corp-only after:       ${afterCorp.length}`);

  if (pruned.length > 0) {
    console.log('\n✓ Corp-only links PRUNED (good):');
    pruned.forEach((l) => console.log(`    ${l}`));
  }
  if (missed.length > 0) {
    console.log('\n✗ Corp-only links STILL PRESENT (missed):');
    missed.forEach((l) => console.log(`    ${l}`));
  }
  if (falsePruned.length > 0) {
    console.log(`\n⚠ Non-corp links also removed (collateral): ${falsePruned.length}`);
    falsePruned.slice(0, 10).forEach((l) => console.log(`    ${l}`));
    if (falsePruned.length > 10) console.log(`    ... and ${falsePruned.length - 10} more`);
  } else {
    console.log('\n✓ No non-corp links collaterally removed');
  }

  const allCorpPruned = missed.length === 0;
  const noFalsePositives = falsePruned.length === 0;
  console.log(`\n${'═'.repeat(55)}`);
  console.log(`Result: ${allCorpPruned && noFalsePositives ? '✓ PASS' : '✗ FAIL'}`);
  if (!allCorpPruned) console.log(`  → ${missed.length} corp-only link(s) not pruned`);
  if (!noFalsePositives) console.log(`  → ${falsePruned.length} non-corp link(s) collaterally removed`);
  console.log('═'.repeat(55));
}
