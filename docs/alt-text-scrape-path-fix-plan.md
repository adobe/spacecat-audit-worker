# Fix: Alt-Text Audit S3 Path Mismatch Between Audit-Worker and Mystique

## Context

The alt-text audit for umgc.edu fails because audit-worker and mystique use **different mechanisms** to locate scrapes in S3:

- **Audit-worker** checks scrapes via direct S3 `HeadObjectCommand` using keys like `scrapes/{siteId}/{pathname}/scrape.json` (constructed by `getScrapeJsonPath()`). It finds 19/20 scrapes exist and only sends 1 URL to the scrape client.
- **Mystique** queries scrape jobs via SpaceCat API (`get_scrape_jobs_by_base_url` → job results), which returns S3 paths keyed by `scrapeJobId` (not `siteId`). It can't find the 19 "existing" scrapes because they're under different paths.

The fix: **send ALL URLs to the scrape client** instead of pre-filtering. The scrape client already handles caching via `maxScrapeAge` — it reuses recent scrapes and registers all URLs in DynamoDB, making them discoverable by mystique.

## Approach: Send All URLs to SCRAPE_CLIENT

This is the cleanest option because:
1. **Removes code** rather than adding complexity
2. The scrape client already handles caching (`maxScrapeAge` defaults to 24h in `scrape-client.js:189`)
3. Creates a **single source of truth** — both systems go through scrape jobs API/DynamoDB
4. **No changes needed in mystique** — it already queries scrape jobs correctly

## Changes

### File 1: `spacecat-audit-worker/src/image-alt-text/handler.js`

**Remove imports (lines 13, 18):**
- `import { HeadObjectCommand } from '@aws-sdk/client-s3'`
- `import { getScrapeJsonPath } from '../headings/utils.js'`

**Simplify context destructuring (line 95):**
- Remove `s3Client` and `env` — no longer needed for direct S3 access
- Keep: `log`, `site`, `dataAccess`

**Replace lines 171-228** (the S3 check block + return statements) with:
```javascript
log.info(`[${AUDIT_TYPE}]: Sending ${topPages.length} URLs to scrape client (maxScrapeAge: 24h)`);

return {
  urls: topPages.map((url) => ({ url })),
  siteId,
  type: 'default',
  maxScrapeAge: 24,
  options: {
    pageLoadTimeout: 45000,
  },
};
```

The `options.pageLoadTimeout: 45000` (45s) gives slower sites more time to load before the scrape times out. This is passed through via `formatPayload` in `audit.model.js:193` (`options: stepResult.options || {}`) to `ScrapeClient.createScrapeJob()`.

**What stays untouched:**
- All offset/pagination logic (lines 97-170) — summit-plg windowing, offset advancement, opportunity save-back
- `processImportStep` function
- The AuditBuilder chain at the bottom

### File 1b: `processAltTextWithMystique` scrape pre-check (same file)

**Add a scrape availability check** at the beginning of `processAltTextWithMystique` (after computing `pageUrls`, ~line 262), before any Mystique interaction. This validates that scrapes actually exist for all URLs about to be sent, using the same data source mystique will use.

**How it works:**

After the SCRAPE_CLIENT step completes, `step-audit.js:172-177` injects `context.scrapeResultPaths` — a `Map<url, s3Path>` from `scrapeClient.getScrapeResultPaths(scrapeJobId)`. This map is keyed by **exact URL string**, which is the same matching mystique uses (`result.get("url") in target_urls` in `spacecat_content_tool.py:253`).

**Add after line 264** (after `pageUrls` is computed, before the urlBatches line):
```javascript
// Verify scrapes exist for all page URLs before sending to Mystique.
// Uses scrapeResultPaths (Map<url, s3Path>) from the SCRAPE_CLIENT step,
// which is the same data source mystique queries via scrape jobs API.
const { scrapeResultPaths } = context;
if (scrapeResultPaths) {
  const missingScrapesUrls = pageUrls.filter((url) => !scrapeResultPaths.has(url));
  if (missingScrapesUrls.length > 0) {
    log.error(`[${AUDIT_TYPE}]: Missing scrapes for ${missingScrapesUrls.length}/${pageUrls.length} URLs: ${missingScrapesUrls.join(', ')}`);
    throw new Error(
      `Cannot proceed: ${missingScrapesUrls.length} of ${pageUrls.length} URLs have no scrape results. `
      + 'Mystique will not be able to find content for these pages.',
    );
  }
  log.info(`[${AUDIT_TYPE}]: Verified scrapes exist for all ${pageUrls.length} page URLs`);
} else {
  log.warn(`[${AUDIT_TYPE}]: No scrapeResultPaths in context, skipping scrape verification`);
}
```

**Why this matches mystique's check:**
- Both use exact URL string matching (no normalization)
- `scrapeResultPaths` comes from `ScrapeClient.getScrapeResultPaths(jobId)` which queries `ScrapeUrl.allByScrapeJobId()` in DynamoDB — the same records mystique finds via `get_scrape_job_results(jobId)` API
- If a URL is missing from `scrapeResultPaths`, mystique's `_get_batch_existing_content` won't find it either

### File 2: `spacecat-audit-worker/test/audits/image-alt-text/handler.test.js`

**Remove:**
- `HeadObjectCommand` import (line 19)
- `s3ClientMock` setup and all `HeadObjectCommand`-based assertions

**Rewrite `processScraping` test block (~line 708):**
- Remove the `s3Client` mock from context
- Remove `env` from context (no longer needed for `S3_SCRAPER_BUCKET_NAME`)
- Tests should verify that ALL topPages URLs are returned with `maxScrapeAge: 24`
- Remove "all scrapes exist → send first URL" special case test
- Remove "scrape not found" vs "scrape exists" filtering tests

**Rewrite `processScraping with page offset` test block (~line 1197):**
- Same s3Client/env removal
- Keep offset logic assertions — just verify returned URLs match the expected window
- Verify `maxScrapeAge: 24` in return payload

**Add new tests for `processAltTextWithMystique` scrape pre-check:**
- Test that it throws when `scrapeResultPaths` exists but is missing URLs
- Test that it proceeds normally when all URLs are present in `scrapeResultPaths`
- Test that it logs a warning and continues when `scrapeResultPaths` is not in context (backward compat)

**Update existing `processScraping` tests:**
- Verify `options: { pageLoadTimeout: 45000 }` is included in the return payload

**Keep unchanged:**
- All offset/pagination test cases (they test the windowing logic, not S3)
- All existing `processAltTextWithMystique` tests (opportunity/suggestion logic)
- All `processImportStep` tests

### No changes needed in:
- **mystique** — already queries scrape jobs correctly via `_get_batch_existing_content`
- **spacecat-shared** — `maxScrapeAge` caching already works; default is 24h
- **headings/utils.js** — `getScrapeJsonPath` still used by headings and faqs audits (different flow)

## Why maxScrapeAge: 24 (not 0)

The current code uses `maxScrapeAge: 0` which means "force rescrape." But the code's own behavior contradicts this — it only sends *missing* URLs and reuses existing ones. Setting `maxScrapeAge: 24` achieves the same intent (reuse recent scrapes) through the proper mechanism. The scrape client will:
- Reuse scrapes < 24h old (cache hit, registered in DynamoDB)
- Re-scrape anything older or missing

## Verification

1. **Run tests:** `cd spacecat-audit-worker && npm test` — after updating tests
2. **Verify no regressions in other audits:** `getScrapeJsonPath` usage in headings/faqs is unaffected
3. **End-to-end:** Run alt-text audit for a site, then verify:
   - `[alt-text]: Sending N URLs to scrape client (maxScrapeAge: 24h)` appears in logs
   - `[alt-text]: Verified scrapes exist for all N page URLs` appears before Mystique step
   - Mystique no longer logs "No content available" for URLs that should have scrapes
4. **Scrape pre-check:** Intentionally test with a site that has no scrapes to verify the error is thrown cleanly before reaching Mystique
5. **pageLoadTimeout:** Verify in scrape worker logs that the 45s timeout is being applied (visible in scrape job options)
