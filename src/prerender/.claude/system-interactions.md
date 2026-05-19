# System Interactions Reference — Prerender Audit

Indexed Q&A answers for the 7 cross-system interaction questions. Each section can be
read independently. Companion to CLAUDE.md (which covers internal mechanics).

---

## 1 · Import Worker Interaction

**How step 1 triggers the import worker and how step 2 consumes its output**

### Trigger mechanism

Step 1 (`importTopPages`) returns a plain object:
```js
{
  type: 'top-pages',
  siteId: site.getId(),
  auditResult: { status: 'preparing', finalUrl },
  fullAuditRef: `scrapes/${site.getId()}/`,
  // auditContext.urls is forwarded if CSV mode
}
```

The AuditBuilder (via `AUDIT_STEP_DESTINATIONS.IMPORT_WORKER`) enqueues this to
`IMPORT_WORKER_QUEUE_URL` (from `context.env`) formatted as:
```js
{
  type: 'top-pages',
  siteId,
  auditContext: {
    next: 'submitForScraping',   // step 2 step name
    auditId, auditType, fullAuditRef,
    urls: [...],                  // only present in CSV mode
  },
}
```

### Import worker's job

The import worker receives `type: 'top-pages'`, fetches GSC organic keyword data for
the site, and writes rows into the `SiteTopPage` DB table. When done it enqueues
a message to resume the audit at step 2 (`submit-for-scraping`).

### Step 2 consumption

`getTopOrganicUrlsFromSeo()` reads the freshly populated table:
```js
SiteTopPage.allBySiteIdAndSourceAndGeo(siteId, 'seo', 'global')
```
Returns up to `TOP_ORGANIC_URLS_LIMIT=200` pages sorted by organic traffic.

**Why step 1 cannot fetch URLs itself**: `SiteTopPage` is stale before the import worker
completes. Reading it in step 1 returns data from the previous import run.

---

## 2 · Content-Scraper (spacecat-content-scraper) Interaction

**How scraper jobs are submitted, what they produce, and how step 3 consumes them**

### Job submission (step 2)

```js
ScrapeClient.createScrapeJob({
  urls: filteredUrls.map((url) => ({ url })),
  siteId,
  processingType: 'prerender',   // exact string — scraper routes on this
  maxScrapeAge: 0,
  options: { pageLoadTimeout: 20000, storagePrefix: 'prerender' },
})
```

`processingType: 'prerender'` is checked by `PrerenderHandler.accepts()` in the scraper.
Changing this string breaks routing.

### S3 output (written by scraper per URL)

```
prerender/scrapes/{scrapeJobId}/{sanitizedPath}/server-side.html
prerender/scrapes/{scrapeJobId}/{sanitizedPath}/client-side.html
prerender/scrapes/{scrapeJobId}/{sanitizedPath}/server-side-html.md
prerender/scrapes/{scrapeJobId}/{sanitizedPath}/markdown-diff.md
prerender/scrapes/{scrapeJobId}/{sanitizedPath}/scrape.json
```

`sanitizedPath` uses the canonical regex in `PrerenderHandler.sanitizeImportPath()` —
see CLAUDE.md for the exact regex. The audit worker must replicate it to rebuild S3 paths.

### Step 3 input (AuditBuilder pre-population)

`step-audit.js:177` calls `scrapeClient.getScrapeResultPaths(scrapeJobId)` before
step 3 fires and stores the result as `context.scrapeResultPaths: Map<url, pathInfo>`.

Step 3's `compareHtmlContent()` iterates this map to download and compare HTML files.

### scrape.json schema (key fields)

```json
{
  "status": "COMPLETE | FAILED",
  "isDeployedAtEdge": true,
  "usedEarlyClientSideHtml": false,
  "error": { "message": "...", "type": "HttpError", "statusCode": 403 }
}
```

`isDeployedAtEdge` = scraper detected Tokowaka/edge-optimize response headers.
NOT the same as `Suggestion.data.edgeDeployed` (set by user deploy action in UI).

---

## 3 · URL Fetching and Daily Batch Preparation

**How step 2 selects URLs from three sources and caps the batch**

### Three modes

| Mode | Trigger | URL sources | Filters |
|------|---------|-------------|---------|
| `csv` | `auditContext.urls` present | `auditContext.urls` rebased to preferredBase | dedup + HTML-only |
| `slack` | `slackContext.channelId` set | organic + includedURLs | dedup + HTML-only; no PageCitability, no edge filter |
| `normal` | scheduled run | organic + agentic + includedURLs | PageCitability dedup + edge-deployed filter + DAILY_BATCH_SIZE cap |

### Normal-mode pipeline (actual execution order)

```
1. Read siteStatus from S3 (status.json)
2. isStickyBotBlocked(siteStatus)             → if blocked within 3 days → return { urls: [], domainBlocked: true }
3. getTopOrganicUrlsFromSeo()                 → up to TOP_ORGANIC_URLS_LIMIT=200
4. getTopAgenticUrls()                        → up to TOP_AGENTIC_URLS_LIMIT=2000
5. site.getConfig().getIncludedURLs()         → manually configured URLs
6. Rebase all three to preferredBase
7. getRecentlyProcessedPathnames(siteId)      → Set<pathname> from PageCitability (7-day window, uses updatedAt)
8. getEdgeDeployedPathnames(siteStatus)       → Set<pathname> from status.json pages[].isDeployedAtEdge
9. Filter each source independently:
   filteredOrganic  = organic.filter(notRecent AND notEdgeDeployed)
   filteredIncluded = included.filter(notRecent AND notEdgeDeployed)
   filteredAgentic  = agentic.filter(notRecent AND notEdgeDeployed)
10. Concatenate in priority order (NOT sorted — concat IS the priority):
    candidates = [...filteredOrganic, ...filteredIncluded, ...filteredAgentic]
11. Slice to DAILY_BATCH_SIZE=320
12. mergeAndGetUniqueHtmlUrls(batchedUrls)    → final www/non-www dedup + HTML-only filter
```

**Critical**: bot-block check (step 2) fires before any URL fetching. The current Selection
Algorithm in CLAUDE.md previously had this in the wrong position.

### Athena query details (`getTopAgenticLiveUrlsFromAthena`)

- Queries last 1 week of CDN log data (via `weeklyBreakdownQueries.createTopUrlsQueryWithLimit`)
- Filters to HTTP 200 responses only (excludes 404s, 410s, 429s, etc.)
- Excludes URL suffixes: `.pdf`, `.xml`, `/sitemap.xml`, `/robots.txt`, `.ico`, `.xls`, etc.
- Requires `cdn-logs-analysis` handler to be enabled for the site in Configuration
- Falls back to `[]` if Athena unavailable or query fails (warn logged)
- Results are rebased to the site's `preferredBaseUrl`

### PageCitability dedup query

```js
PageCitability.allByIndexKeys(
  { siteId },
  { where: (attrs, op) => op.gte(attrs.updatedAt, recentWindowStart.toISOString()) }
)
// recentWindowStart = subDays(new Date(), 7)
```

Returns a `Set<pathname>`. Any URL whose pathname appears in this set is skipped for
the current batch.

---

## 4 · Error Handling

**How the audit handles partial and complete failures at each stage**

### URL source failures

| Source | Failure | Behavior |
|--------|---------|---------|
| Athena (agentic) | Any error | `getTopAgenticUrls()` returns `[]`; warn logged; audit continues with organic only |
| PageCitability query | Any error | Returns `new Set()`; all URLs submitted (no dedup); warn logged |
| SiteTopPage unavailable | No rows | Returns `[]`; warn logged |
| `cdn-logs-analysis` disabled | Config check | Returns `[]`; info logged |

### Scrape failures (step 3)

- **Zero successful scrapes** (`scrapeResultPaths.size === 0`): Fallback path fires — re-fetches
  organic + agentic + included URLs and calls `compareHtmlContent` using HTML from a **previous**
  scrape run on S3. This silently processes stale data. A known observability gap: the fallback
  is not covered by tests (`/* c8 ignore */`) but IS reachable in production.
- **Per-URL scrape failure**: URL absent from `scrapeResultPaths`; counted as missing in
  `getScrapeJobStats()`; appears in `status.json pages[]` with `scrapingStatus: 'failed'`
- **403 bot-block**: Counted by `getScrapeJobStats()` via two paths:
  - COMPLETE-status 403s: from in-memory `comparisonResults` (scrape.json `error.statusCode=403`)
  - FAILED-status 403s: from `ScrapeUrl` DB + S3 `scrape.json` (slower path, added in #2245)

### Bot-block response

If 403 ratio ≥ 0.5 AND confidence ≥ 0.99:
```
→ Sets scrapeForbidden=true in status.json
→ Sets scrapeForbiddenSince=now
→ Next step 2 reads these flags; if within 3 days → skips scraping entirely
```

### Complete domain block (isDomainBlocked)

```
step 3 receives isDomainBlocked=true from status.json
→ Creates dummy opportunity (so UI shows blocked state)
→ Uploads error status.json
→ Skips syncSuggestions, markNewSuggestionsAsCovered, Mystique queueing
→ Exits cleanly
```

### status.json upload on error (D-12)

`status.json` is uploaded even when `syncSuggestions` throws. This ensures the UI
always shows accurate status (including partial-failure state) rather than stale success data.

---

## 5 · Audit Data Maintenance Across Multiple Runs

**How the audit preserves correct suggestion state across daily batch runs**

### Suggestion diff logic (syncSuggestions)

Each run compares current scrape results against existing DB suggestions:

```
Current scrape: URL A, B, C (all need prerender)
Existing suggestions: URL A (NEW), URL B (APPROVED), URL D (NEW)

→ URL A: matches existing → preserve as-is (no mutation)
→ URL B: matches existing → preserve as-is (user approved, respect that)
→ URL C: new URL → create suggestion with status NEW
→ URL D: was in previous batch, not in current → mark OUTDATED
         (only if: in scrapedUrlsSet AND not edgeDeployed AND not coveredByDomainWide)
```

### OUTDATED protection rules (all must be true to mark OUTDATED)

1. URL was in `scrapedUrlsSet` (was actually scraped this run)
2. `data.edgeDeployed` is falsy (user hasn't deployed it)
3. `data.coveredByDomainWide` is null/falsy (not covered by domain-wide deployment)
4. `data.isDomainWide` is not true (not the domain-wide suggestion itself)
5. URL not in failed scrapes

**Rationale**: If a URL was not scraped (missed by dedup, outside batch window), it must NOT
be marked OUTDATED — we simply have no data about it. Only mark OUTDATED when we have
evidence the URL no longer needs prerender.

### Domain-wide suggestion preservation

Preserved across runs if status is NEW, FIXED, PENDING_VALIDATION, SKIPPED, OR `data.edgeDeployed` is set.
NOT preserved for: APPROVED, OUTDATED, ERROR, REJECTED, IN_PROGRESS.

See `shouldPreserveDomainWideSuggestion()` in `handler.js:130`.

### PageCitability record maintenance

After each successful scrape, `writeCitabilityMetrics()` upserts a `PageCitability` record
per URL. This record's `updatedAt` timestamp is what the next run's 7-day dedup reads.
URLs processed today won't be in the next 7 days of batches.

---

## 6 · Database Interactions

**Which DB entities are read and written, in which step, and with what bulk semantics**

### Read operations

| Entity | Method | Step | Purpose |
|--------|--------|------|---------|
| `SiteTopPage` | `allBySiteIdAndSourceAndGeo(siteId, 'seo', 'global')` | Step 2 | Organic URL source |
| `PageCitability` | `allByIndexKeys({ siteId }, { where: gte(updatedAt, 7dAgo) })` | Step 2 | Dedup recently processed URLs |
| `Opportunity` | `allBySiteIdAndType(siteId, 'prerender')` | Step 3 | Find/create opportunity |
| `Suggestion` | `allByOpportunityId(opportunityId)` | Step 3 | Diff against existing suggestions |
| `ScrapeUrl` | `allByScrapeJobId(scrapeJobId)` | Step 3 | Failed-status URL 403 detection |
| `Configuration` | `findLatest()` | Step 2 | Check cdn-logs-analysis enabled |

### Write operations

| Entity | Method | Step | Trigger |
|--------|--------|------|---------|
| `Opportunity` | `create()` / `save()` | Step 3 | New opportunity or data update |
| `Suggestion` | `Suggestion.saveMany(newSuggestions)` | Step 3 | Batch create new suggestions (status=NEW) |
| `Suggestion` | `s.setStatus(OUTDATED); Suggestion.saveMany(stale)` | Step 3 | Batch mark stale suggestions OUTDATED |
| `Suggestion` | `s.setData({ coveredByDomainWide: id }); saveMany(covered)` | Step 3 | Only data field written on existing suggestions |
| `PageCitability` | `create()` / `save()` | Step 3 | Upsert per-URL citability record after scrape |
| `Suggestion.data.aiSummary` + `valuable` | atomic update | guidance-handler | Mystique AI response |

### Bulk operation discipline

N+1 is prohibited — connection pool is 200 connections (10 tasks × 20). Correct patterns:

```js
await Suggestion.saveMany(suggestionsToCreate);    // new suggestions
await Suggestion.saveMany(suggestionsToOutdate);   // OUTDATED marking
await Suggestion.removeByIds(ids);                 // removal
```

---

## 7 · Mystique (AI Summarizer) Interaction

**How step 3 queues AI work and how guidance-handler.js processes responses**

### Queuing (step 3)

`sendPrerenderGuidanceRequestToMystique()` is called after syncSuggestions.

**Skip conditions** (suggestions excluded from Mystique queue):
- Status `OUTDATED` (guidance-handler.js filters these first)
- Status `FIXED`
- `data.edgeDeployed` is truthy

**Payload shape** (one SQS message per batch):
```json
{
  "type": "guidance:prerender",
  "siteId": "...",
  "suggestions": [
    {
      "suggestionId": "uuid",          // REQUIRED — Pydantic validates this
      "url": "https://...",
      "scrapeJobId": "...",            // per-suggestion, not current run's ID
      "wordCountBefore": 181,
      "wordCountAfter": 5450,
      "contentGainRatio": 30.11
    }
  ]
}
```

**Batch limit**: `MYSTIQUE_BATCH_SIZE=100` suggestions per SQS message. D-14 explains why:
lenscrafters.com had 1,700+ suggestions — a single message exceeded AWS's 256 KB SQS limit.

**`suggestionId` requirement**: D-08 — Mystique's Pydantic model requires `suggestion_id: str`.
If absent, the entire message is dropped silently. Always build the `urlToSuggestionId` map
using `preferredBase`-normalized URLs to avoid www/non-www mismatch.

**`scrapeJobId` per suggestion**: Uses `data.scrapeJobId` from when the suggestion was first
created (not the current run's job ID). Mystique builds S3 paths using this ID — using the
wrong ID causes `NoSuchKey` errors.

### Response processing (guidance-handler.js)

Mystique calls back asynchronously. `guidance-handler.js` processes the response:

1. Filters out OUTDATED suggestions (no updates for stale records)
2. Builds `suggestionId → suggestion` map
3. For each Mystique result:
   - If `aiSummary` is valid (non-null, not "Not available") → update both `aiSummary` + `valuable`
   - If `aiSummary` is invalid → preserve existing `aiSummary` + `valuable` (D-15: they're a pair)
4. `Suggestion.saveMany(updated)` — bulk write

---

## 8 · Content Gain Calculation

**How server-side vs client-side HTML are compared to determine prerender need**

### Call chain

```
handler.js:compareHtmlContent()
  → For each URL in scrapeResultPaths:
    → Download server-side.html from S3  (directHtml)
    → Download client-side.html from S3  (scrapedHtml)
    → analyzeHtmlForPrerender(directHtml, scrapedHtml, CONTENT_GAIN_THRESHOLD=1.1)
      → @adobe/spacecat-shared-html-analyzer: calculateStats(directHtml, scrapedHtml, true)
        → returns: {
             contentIncreaseRatio,   ← mapped to contentGainRatio
             wordCountBefore,
             wordCountAfter,
             citationReadability,    ← mapped to citabilityScore
             wordDiff,
           }
      → needsPrerender = contentIncreaseRatio >= 1.1
```

### Threshold

`CONTENT_GAIN_THRESHOLD = 1.1` (from `src/prerender/utils/constants.js`).

Passed explicitly to `analyzeHtmlForPrerender()`. The wrapper's default is 1.2 but the
caller overrides it with the 1.1 constant — the constant is authoritative.

A ratio of 1.1 means client-rendered HTML has at least 10% more content than server-rendered.

### Field name mapping

| shared-html-analyzer | handler.js / status.json | Suggestion.data |
|---------------------|-------------------------|-----------------|
| `contentIncreaseRatio` | `contentGainRatio` | `contentGainRatio` |
| `wordCountBefore` | `wordCountBefore` | `wordCountBefore` |
| `wordCountAfter` | `wordCountAfter` | `wordCountAfter` |
| `citationReadability` | `citabilityScore` | `citabilityScore` |

### Wrapper purpose (D-20)

`html-comparator.js` is a thin wrapper (no additional logic beyond threshold application
and field renaming). It exists to:
1. Decouple prerender-specific threshold from the shared package's generic API
2. Keep the shared package independently mockable in tests

### Error handling

If `directHtml` or `scrapedHtml` is missing → `analyzeHtmlForPrerender` throws
`'Missing HTML content for comparison'`. `compareHtmlContent` catches per-URL and
sets `result.error = true` (URL counted as failed, not as needing prerender).

### `usedEarlyClientSideHtml` flag

When the scraper falls back to early JS execution HTML (before full page load),
`scrape.json.usedEarlyClientSideHtml = true`. This flag propagates to `status.json pages[]`.
The word count comparison is less reliable in this case — the UI can caveat display
(D-19 explains why this was added).

---

## 9 · S3 Schemas & Locked Path Contracts

**Full schemas for scraper-written files and status.json, plus path construction rules.**

### sanitizeImportPath Regex (Locked Contract)

The regex lives in **`spacecat-content-scraper/src/handlers/prerender-handler.js`** and is the canonical definition. The audit worker replicates it exactly to reconstruct S3 paths:

```js
// Canonical definition (PrerenderHandler.sanitizeImportPath)
importPath
  .replace(/^\/+|\/+$/g, '')  // Remove leading/trailing slashes
  .replace(/[/._]/g, '-')     // Replace /, ., _ with hyphens
  .replace(/-+/g, '-')        // Collapse multiple hyphens to one
  .replace(/^-|-$/g, '');     // Remove leading/trailing hyphens
// Example: "/static/manuals/2021/cx-5/contents/04091000.html"
//       → "static-manuals-2021-cx-5-contents-04091000-html"
```

All existing S3 keys depend on this exact regex. Modifying it invalidates all historical path lookups and requires a data migration.

### S3 Files Written by the Scraper (per URL)

```
prerender/scrapes/{scrapeJobId}/{sanitizedPath}/server-side.html      ← raw HTML before JS
prerender/scrapes/{scrapeJobId}/{sanitizedPath}/client-side.html      ← HTML after JS execution
prerender/scrapes/{scrapeJobId}/{sanitizedPath}/server-side-html.md   ← markdown of server-side (for Mystique)
prerender/scrapes/{scrapeJobId}/{sanitizedPath}/markdown-diff.md      ← added markdown blocks only (for Mystique)
prerender/scrapes/{scrapeJobId}/{sanitizedPath}/scrape.json           ← per-URL metadata
prerender/scrapes/{siteId}/status.json                                ← written by audit worker, not scraper
```

### Reading Scraper Outputs (Step 3)

Step 3 receives `context.scrapeResultPaths: Map<url, pathInfo>` pre-populated by AuditBuilder. `compareHtmlContent(url, pathInfo)` uses this to:

1. Download `server-side.html` → `directHtml` (baseline, before JS)
2. Download `client-side.html` → `scrapedHtml` (post-JS)
3. Download `scrape.json` → `isDeployedAtEdge`, `usedEarlyClientSideHtml`, `error`
4. Pass `directHtml` + `scrapedHtml` to `analyzeHtmlForPrerender()` → `contentGainRatio`

For **Mystique** processing, step 3 reads `originalHtmlMarkdownKey` and `markdownDiffKey` from Suggestion.data — these point to the `.md` files in the same scrapeJobId path.

**Bot-blocked URLs**: When `botProtection.blocked = true`, the scraper does NOT call `#store()` — no `scrape.json` is written. The audit worker detects this as a missing S3 key (counted as a failed scrape, may trigger bot-block reactive check).

### scrape.json — Full Schema

Written by `PrerenderHandler.#store()` in spacecat-content-scraper:

```json
{
  "url": "string (finalUrl after redirects)",
  "urlId": "string",
  "status": "COMPLETE | FAILED",
  "scrapedAt": 1747000000000,
  "scrapeTime": 1234,
  "userAgent": "string",
  "hasServerSideHtml": true,
  "hasClientSideHtml": true,
  "hasMarkdownDiffFile": true,
  "isDeployedAtEdge": true,
  "jobMetadata": {},
  "usedEarlyClientSideHtml": false,
  "edgeDeploymentDetectionFailed": { "error": "..." },
  "error": { "message": "...", "type": "HttpError", "statusCode": 403 },
  "markdownAnalysisError": { "message": "...", "type": "Error" }
}
```

**`isDeployedAtEdge`** is a boolean set when Tokowaka/edge-optimize response headers are detected. It is forwarded to `status.json pages[].isDeployedAtEdge`. It is **not** the same as `Suggestion.data.edgeDeployed` (a timestamp set by user deploy action).

### Edge Deployment Detection (in scraper)

The scraper makes a separate HTTP GET with:
```
User-Agent: Mozilla/5.0 ... Tokowaka-AI Tokowaka/1.0 AdobeEdgeOptimize-AI AdobeEdgeOptimize/1.0
```
If any of these response headers are present → `isDeployedAtEdge = true`:
- `x-edgeoptimize-cache`
- `x-edgeoptimize-proxy`
- `x-tokowaka-cache`
- `x-tokowaka-proxy`

### status.json — Full Schema (Locked Contract)

**Location**: `prerender/scrapes/{siteId}/status.json`
**Written by**: audit worker (`uploadStatusSummaryToS3`)
**Consumers**: project-elmo-ui, spacecat-api-service
**Cannot change field names or semantics without UI coordination**

```json
{
  "auditResult": { "status": "complete", "finalUrl": "string" },
  "auditType": "prerender",
  "auditedAt": "ISO timestamp",
  "fullAuditRef": "scrapes/{siteId}/",
  "isLive": false,
  "isError": false,
  "siteId": "string",
  "invocationId": "string (Lambda invocation ID)",
  "baseUrl": "string",
  "scrapeJobId": "string (fallback chain — see below)",
  "lastUpdated": "ISO timestamp",
  "urlsNeedingPrerender": 2920,
  "urlsScrapedSuccessfully": 3522,
  "urlsSubmittedForScraping": 3646,
  "scrapingErrorRate": 3.4,
  "scrapeForbidden": false,
  "scrapeForbiddenSince": "ISO timestamp (only present when scrapeForbidden=true)",
  "scrapeForbiddenCount": 0,
  "isDomainBlocked": false,
  "lastAuditSuccess": true,
  "pages": [
    {
      "url": "string",
      "scrapingStatus": "success | failed | forbidden",
      "needsPrerender": true,
      "isDeployedAtEdge": true,
      "usedEarlyClientSideHtml": false,
      "wordCountBefore": 181,
      "wordCountAfter": 5450,
      "contentGainRatio": 30.11,
      "scrapedAt": "ISO timestamp",
      "scrapeJobId": "string"
    }
  ]
}
```

**Key semantics:**
- `urlsNeedingPrerender`: **Count (number)**, not an array — grows cumulatively across daily batches (merge behavior, see below)
- `scrapingErrorRate`: **Percentage** (e.g., 3.4 = 3.4% error rate), not a 0.0–1.0 ratio
- `scrapeForbidden`: Sticky bot-block flag; read by next step 2 run; expires after 3-day window
- `isDomainBlocked`: Hard block — step 3 skips syncSuggestions entirely when true
- `pages[].contentGainRatio` threshold ≥ 1.1 → `needsPrerender = true`

### uploadStatusSummaryToS3 — Merge Behaviour

Does NOT simply overwrite. Each run:

1. Reads the existing status.json from S3
2. Builds `currentPages` from the current run's `comparisonResults` + `missingPages`
3. Merges: existing pages for URLs NOT in the current run are appended unchanged
4. Computes `urlsNeedingPrerender`, `urlsScrapedSuccessfully`, `scrapingErrorRate` from the **merged** page set
5. Per-page `scrapeJobId`: URLs in `submittedUrlSet` (from ScrapeUrl DB) get the current `scrapeJobId`; fallback URLs not in `submittedUrlSet` preserve their old `scrapeJobId`

This means `urlsNeedingPrerender` grows over time as batches process — it reflects the cumulative state across all batches since the last full-site reset.

### scrapeJobId Fallback Chain (3-Level, Order Is Locked)

```
1. data.scrapeJobId        — primary (set by ScrapeClient on creation)
2. path segment [2] from originalHtmlKey  — fallback (extract from S3 key)
3. null                    — final fallback
```

Never reorder. Mystique constructs S3 paths using the scrapeJobId from when the suggestion was *first created* — using the wrong ID causes `NoSuchKey`.

### URL Normalization for Suggestion Lookup

All URL comparisons against Suggestion.data must use the normalized `preferredBase` domain. Production data showed `https://www.micron.com/...` and `https://micron.com/...` variants coexisting from different audit runs — exact string match silently missed, causing 8/13 suggestions to be sent to Mystique without `suggestionId`. Always normalize to the site's preferred base before map lookups.

### normalizePathname Function

- **Location**: `src/utils/utils.js` (SHARED, referenced by 10+ audits — GSC, lighthouse, etc.)
- **Do not move** without coordinating updates across all importing audits
