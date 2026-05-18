#!/usr/bin/env node
/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

/* eslint-disable no-console */

/*
 * Local exploration runner for the sitemap-clustering pattern pipeline.
 *
 * Usage:
 *   node scripts/explore-cdn-categories.js \
 *     https://business.adobe.com https://www.t-mobile.com https://www2.hm.com
 *
 * Prints, per site:
 *   - signal acquisition stats (s3 vs direct fetch — s3 will always be 0 here
 *     since we run without scraper-bucket access)
 *   - category rules (tier source: breadcrumb | path | llm) with regex + samples
 *   - page-type rules with stats (schema vs path-keyword)
 *   - coverage % over the sample
 *
 * No DB writes. No LLM call unless AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_KEY
 * are set in your shell. With those env vars unset, the LLM tier silently
 * returns []; you still see tiers 1+2 in action.
 */

import { fetchSitemapSample, collectUrlSignals } from '../src/cdn-logs-report/patterns/url-signals.js';
import { deriveCategories } from '../src/cdn-logs-report/patterns/category-deriver.js';
import { analyzePageTypes } from '../src/cdn-logs-report/patterns/page-type-analysis.js';

const log = {
  info: (...a) => console.log('•', ...a),
  warn: (...a) => console.warn('!', ...a),
  debug: () => {},
  error: (...a) => console.error('✗', ...a),
};

// Stub a Site object — only getId / getBaseURL are used by the pipeline,
// and a missing siteId just means S3 lookups all miss (we fall back to fetch).
function fakeSite(baseUrl) {
  return {
    getId: () => 'explore-local',
    getBaseURL: () => baseUrl,
  };
}

function context() {
  return {
    log,
    s3Client: null, // forces all signal acquisition through direct fetch
    env: {
      AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT,
      AZURE_OPENAI_KEY: process.env.AZURE_OPENAI_KEY,
      AZURE_API_VERSION: process.env.AZURE_API_VERSION,
      AZURE_COMPLETION_DEPLOYMENT: process.env.AZURE_COMPLETION_DEPLOYMENT || 'gpt-4o-mini',
    },
  };
}

const SAMPLE_SIZE = Number(process.env.SAMPLE_SIZE || 200);
const JSON_OUT = process.env.JSON_OUT; // optional path to write structured summary
const summary = [];

async function exploreSite(baseUrl) {
  console.log(`\n══════════════════════════════════════════════════════════════`);
  console.log(`▶ ${baseUrl}`);
  console.log(`══════════════════════════════════════════════════════════════`);

  const ctx = context();
  const sample = await fetchSitemapSample(baseUrl, log, SAMPLE_SIZE);
  if (!sample) {
    console.log('No sitemap found.');
    summary.push({ site: baseUrl, error: 'no-sitemap' });
    return;
  }

  const { records, stats } = await collectUrlSignals(sample.urls, { site: fakeSite(baseUrl), context: ctx });
  console.log(`signals: s3=${stats.s3Hits}, fetch=${stats.fetchHits}, miss=${stats.misses}`);

  const withBreadcrumb = records.filter((r) => r.signal?.breadcrumb?.length).length;
  const withSchema = records.filter((r) => r.signal?.schemaTypes?.length).length;
  console.log(`breadcrumb-coverage=${withBreadcrumb}/${records.length}, schema-coverage=${withSchema}/${records.length}`);

  const domain = new URL(baseUrl).hostname;
  const cat = await deriveCategories(records, domain, ctx);
  // analyzePageTypes is LLM-driven and discovers site-specific page types
  // (e.g. "Recipe", "Sweepstakes", "Gallery"). Without Azure creds it falls
  // back to the static keyword/default set.
  const sitemapPaths = records.map((r) => r.path);
  const pageTypeRegexes = await analyzePageTypes(domain, sitemapPaths, ctx);

  console.log(`\n──── CATEGORIES (${cat.tiers.total}; breadcrumb=${cat.tiers.breadcrumb} path=${cat.tiers.path} llm=${cat.tiers.llm}) — coverage ${cat.coverage.percent}% ────`);
  for (const r of cat.rules) {
    console.log(`  [${r.sourceTier}] ${r.name} (n=${r.observedCount})`);
    console.log(`    regex: ${r.regex}`);
    if (r.sample?.length) {
      console.log(`    sample: ${r.sample.slice(0, 3).join(', ')}`);
    }
  }

  console.log(`\n──── PAGE TYPES (${Object.keys(pageTypeRegexes || {}).length}) ────`);
  for (const [name, regex] of Object.entries(pageTypeRegexes || {})) {
    console.log(`  ${name}`);
    console.log(`    regex: ${regex}`);
  }

  summary.push({
    site: baseUrl,
    sitemapUrls: sample.totalDiscovered,
    sampled: records.length,
    signals: {
      s3: stats.s3Hits, fetch: stats.fetchHits, miss: stats.misses,
    },
    coverage: {
      breadcrumb: withBreadcrumb, schema: withSchema, total: records.length,
    },
    categories: {
      tiers: cat.tiers,
      coverage: cat.coverage.percent,
      rules: cat.rules.map((r) => ({
        name: r.name, regex: r.regex, tier: r.sourceTier, count: r.observedCount,
      })),
    },
    pageTypes: {
      rules: Object.entries(pageTypeRegexes || {}).map(([name, regex]) => ({ name, regex })),
    },
  });
}

async function main() {
  const urls = process.argv.slice(2);
  if (!urls.length) {
    console.error('usage: node scripts/explore-cdn-categories.js <baseUrl> [<baseUrl> ...]');
    process.exit(1);
  }
  for (const u of urls) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await exploreSite(u);
    } catch (err) {
      console.error(`✗ ${u}: ${err.message}`);
      summary.push({ site: u, error: err.message });
    }
  }
  if (JSON_OUT) {
    const fs = await import('node:fs');
    fs.writeFileSync(JSON_OUT, JSON.stringify(summary, null, 2));
    console.log(`\nWrote summary to ${JSON_OUT}`);
  }
}

main();
