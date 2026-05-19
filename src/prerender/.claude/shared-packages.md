# Shared Packages — Prerender Audit

Detailed API reference for the packages the prerender audit directly depends on.

---

## `@adobe/spacecat-shared-html-analyzer`

Used in step 3 to compare server-rendered vs. client-rendered HTML.

**Key functions used by prerender:**

| Function | Returns | Notes |
|----------|---------|-------|
| `calculateStats(originalHTML, currentHTML)` | `{ wordCountBefore, wordCountAfter, wordDiff, contentIncreaseRatio, citationReadability }` | Primary function for per-URL comparison |
| `analyzeTextComparison(initHtml, finHtml)` | Full diff object + hashes | Used for detailed comparison reports |
| `filterHtmlContent` / `stripTagsToText` | Plain text | Strips nav/footer/cookie banners before counting |

**Critical name mapping** — the same concept has different names in different layers:

| Layer | Field name |
|-------|------------|
| `html-analyzer` output | `contentIncreaseRatio` |
| `PageCitability` DB field | `contentRatio` |
| `Suggestion.data` field | `contentGainRatio` |
| `status.json` pages[] | `contentGainRatio` |
| `CONTENT_GAIN_THRESHOLD` constant | 1.1 (ratio threshold = "10% more content client-side") |

**Behavior notes:**
- Server-side HTML **always** includes `<noscript>` content (what bots see)
- Client-side HTML **excludes** `<noscript>` by default (what users see after JS runs)
- `ignoreNavFooter=true` by default — strips `nav`, `header`, `footer`, ARIA banners before word counting
- `citationReadability` = what % of original words survive into the rendered page (100% = no loss)

---

## `@adobe/spacecat-shared-scrape-client`

Used in step 2 to submit URLs to `spacecat-content-scraper`.

**Factory:** `ScrapeClient.createFrom(context)` — requires `context.dataAccess`, `context.sqs`, `context.log`, `context.env`

**Config env var:** `SCRAPE_JOB_CONFIGURATION` (JSON string) must have:
- `scrapeWorkerQueue` — SQS URL for the scraper
- `s3Bucket` — S3 bucket for scrape results
- `maxUrlsPerJob` — hard cap on URLs per job (default 1; prerender passes batches up to DAILY_BATCH_SIZE)
- `maxUrlsPerMessage` — SQS message splitting threshold (default 1000)
- `options` — `{ enableJavascript, hideConsentBanners }`

**Key methods:**

```js
// Submit a batch of URLs for scraping
const job = await scrapeClient.createScrapeJob({
  urls,                         // string[] — the batch
  processingType: 'prerender',  // MUST be 'prerender' — routes to PrerenderHandler
  maxScrapeAge: 24,             // hours before forcing re-scrape
  metaData: {},                 // passed to scraper, not used by prerender
});
// Returns: ScrapeJobDto { id, baseURL, processingType, options, startedAt, status, urlCount, ... }

// Get result paths (step 3 uses this to find S3 HTML files)
const pathMap = await scrapeClient.getScrapeResultPaths(jobId);
// Returns: Map<url, s3Path> — only COMPLETE status URLs

// Get all URL results with status
const results = await scrapeClient.getScrapeJobUrlResults(jobId);
// Returns: [{ url, status, reason, path }]
```

**ScrapeJob statuses:** `RUNNING | COMPLETE | FAILED | STOPPED` — expires after **120 days**

**ScrapeUrl statuses:** `PENDING | REDIRECT | RUNNING | COMPLETE | FAILED | STOPPED`

**abortInfo on ScrapeJob** — set when bot-blocking detected during scraping:
```js
abortInfo: {
  reason: string,
  details: {
    blockedUrlsCount: number,
    totalUrlsCount: number,
    blockedUrls: [{ url, blockerType, httpStatus, confidence }],
    blockedUrlsSampled: boolean,  // true if > 400KB truncated
    byBlockerType: object,        // dynamic keys
    byHttpStatus: object,         // dynamic keys
    auditType: string,
    siteId: string,
    siteUrl: string,
  }
}
```
This is what prerender's `getScrapeJobStats()` reads to count 403s for bot-block detection.

---

## `@adobe/spacecat-shared-data-access` — Entities Used by Prerender

### `PageCitability` — 7-day dedup window

```
DB table: page_citabilities
Expires: not TTL-based (no withRecordExpiry), manual cleanup
```

| Field | Type | Purpose |
|-------|------|---------|
| `siteId` | FK | belongs_to Site |
| `url` | string (required) | page URL, must be valid URL |
| `citabilityScore` | number | priority rank — lower = higher priority |
| `contentRatio` | number | = html-analyzer's `contentIncreaseRatio` = Suggestion.data `contentGainRatio` |
| `wordDifference` | number | absolute word count delta |
| `botWords` | number | word count before JS (server-side) |
| `normalWords` | number | word count after JS (client-side) |
| `isDeployedAtEdge` | boolean | edge delivery detected |
| `updatedBy` | string | who last updated |

**Indexed by:** `url` + `updatedAt` — prerender queries recent records via `updatedAt` to find URLs processed within 7-day window.

**How prerender uses it:**
- Step 2: queries PageCitability for this site, filters URLs with `updatedAt` within last 7 days (PRERENDER_RECENT_PROCESSING_TIME_DAYS=7) → skips those from daily batch
- Step 3: writes citabilityScore + contentRatio + other fields after HTML comparison

### `ScrapeJob` — scrape job tracking

```
DB table: scrape_jobs
Expires: 120 days (withRecordExpiry)
```

| Field | Type | Purpose |
|-------|------|---------|
| `baseURL` | string | site being scraped |
| `processingType` | string | `'prerender'` for prerender scrape jobs |
| `status` | enum | RUNNING / COMPLETE / FAILED / STOPPED |
| `urlCount` | number | total URLs in job |
| `successCount` | number | COMPLETE URLs |
| `failedCount` | number | FAILED URLs |
| `options` | object | scrape options (enableJavascript, etc.) |
| `abortInfo` | map | bot-block details — read by `getScrapeJobStats()` |
| `startedAt` | ISO date | job start |
| `endedAt` | ISO date | job end |

### `ScrapeUrl` — per-URL scrape result

```
DB table: scrape_urls
Expires: set on ScrapeUrl model (separate from ScrapeJob TTL)
```

| Field | Type | Purpose |
|-------|------|---------|
| `scrapeJobId` | FK | belongs_to ScrapeJob |
| `url` | string | the URL scraped |
| `status` | enum | PENDING/REDIRECT/RUNNING/COMPLETE/FAILED/STOPPED |
| `path` | string | S3 path to scrape result |
| `reason` | string | failure reason if FAILED |
| `processingType` | string | matches parent ScrapeJob |
| `isOriginal` | boolean | true if original URL (not redirect target) |

**How prerender uses it:** `getScrapeJobStats()` calls `ScrapeUrl.allByScrapeJobId(jobId)` to count FAILED 403 URLs for bot-block ratio calculation.

### `Suggestion` — prerender suggestions

**Type:** `CONFIG_UPDATE` (from `Suggestion.TYPES.CONFIG_UPDATE`)

**All statuses:**
```
NEW → APPROVED → IN_PROGRESS → FIXED
              ↘ SKIPPED
              ↘ REJECTED
              ↘ OUTDATED
              ↘ ERROR
              ↘ PENDING_VALIDATION
```

**Prerender-active statuses** (ACTIVE_STATUSES, preserved across audits):
`['NEW', 'APPROVED', 'APPROVED_AS_DRAFT']` — note `APPROVED_AS_DRAFT` is NOT in `Suggestion.STATUSES` enum, it's a prerender-specific extension.

---

## `@adobe/spacecat-shared-tokowaka-client`

Tokowaka is the **edge optimization service** that enables server-side prerendering at the CDN layer. The client manages two types of S3 configs and is invoked by `spacecat-api-service` (never the audit worker) when a user deploys suggestions from the UI.

### S3 Config Structure

**Per-URL config** — written for each deployed URL:
```
S3 key: opportunities/{hostname-no-www}/{base64url(pathname)}
e.g.:  opportunities/mazdausa.com/L3Zlb2ljbGVz  (= /vehicles)

Contents:
{
  url: "https://www.mazdausa.com/vehicles",
  version: "1.0",
  forceFail: false,
  prerender: true,   // ← set to true by PrerenderMapper.requiresPrerender()
  patches: []        // ← always empty for prerender (no DOM modifications)
}
```

**Domain metaconfig** — one per domain, controls site-level settings and domain-wide prerender:
```
S3 key: opportunities/{hostname-no-www}/config
e.g.:  opportunities/mazdausa.com/config

Contents:
{
  siteId: "...",
  apiKeys: ["sha256-base64url..."],
  tokowakaEnabled: true,
  enhancements: true,
  patches: { "/vehicles": true, ... },  // tracks which paths have been deployed
  prerender: { allowList: ["/*"] }       // only present for domain-wide or stage domains
}
```

**S3 path helpers** (from `s3-utils.js`):
- `getHostName()`: strips `www.` prefix from hostname
- `normalizePath()`: removes trailing slash (except root `/`)
- `base64UrlEncode()`: RFC 4648 URL-safe base64, no padding

**Preview configs** use `preview/` prefix: `preview/opportunities/{hostname}/...`

### PrerenderMapper — What It Does

The `PrerenderMapper` is the glue between prerender suggestions and Tokowaka configs:

| Method | Returns | Why |
|--------|---------|-----|
| `requiresPrerender()` | `true` | Sets `prerender: true` in the URL config |
| `allowConfigsWithoutPatch()` | `true` | Allows uploading a config with `patches: []` |
| `suggestionsToPatches()` | `[]` | Prerender has no DOM patches — just enables prerendering |
| `canDeploy(suggestion)` | `{ eligible: true }` if `data.url` is set | Any suggestion with a URL is deployable |

### `deployToEdge()` — The Full Deploy Flow

This is the method called by `spacecat-api-service` when the user deploys from the UI. **This is where `edgeDeployed` and `coveredByDomainWide` are written.**

```
Input: { site, opportunity, targetSuggestions, allSuggestions }

Split targetSuggestions into:
  ├── domainWideSuggestions  (data.isDomainWide === true)
  └── validSuggestions       (status === NEW or PENDING_VALIDATION)

If both present: filter validSuggestions that match domain-wide patterns → skippedInBatch

For validSuggestions (regular URL deploy):
  deploySuggestions() → per-URL S3 config upload → CDN invalidate
  → suggestion.data.edgeDeployed = Date.now()   ← SET HERE (not in audit worker)
  → s.save()

For domainWideSuggestions (domain-wide deploy):
  metaconfig.prerender = { allowList: allowedRegexPatterns }
  uploadMetaconfig() → CDN invalidate metaconfig
  → domainWideSuggestion.data.edgeDeployed = Date.now()  ← only on THIS suggestion
  → allSuggestions matching patterns → coveredByDomainWide = suggestion.getId()  ← other suggestions get UUID

For skippedInBatch (URL suggestions covered by domain-wide in same deploy batch):
  → suggestion.data.coveredByDomainWide = 'same-batch-deployment'  ← string literal, not UUID
  → suggestion.data.skippedInDeployment = true
```

**Critical: `edgeDeployed` and `coveredByDomainWide` are NEVER written by the audit worker.** They are written exclusively by `deployToEdge()` in the api-service call path.

### Eligible Suggestion Statuses for Edge Deploy

Only `NEW` and `PENDING_VALIDATION` suggestions can be edge-deployed. `APPROVED`, `IN_PROGRESS`, `FIXED`, `SKIPPED` are ineligible — they get returned in `failedSuggestions` with statusCode 400.

### Rollback for Prerender

`rollbackSuggestions()` for opportunity type `'prerender'` sets `prerender: false` in the URL config (rather than removing patches, since prerender configs have no patches).

### Env Vars Required

| Variable | Purpose |
|----------|---------|
| `TOKOWAKA_SITE_CONFIG_BUCKET` | S3 bucket for deployed per-URL configs and metaconfigs |
| `TOKOWAKA_PREVIEW_BUCKET` | S3 bucket for preview configs |
| `TOKOWAKA_CDN_PROVIDER` | Comma-separated CDN providers: `cloudfront`, `fastly` |
| `TOKOWAKA_EDGE_URL` | Edge proxy URL — required only for `previewSuggestions()` |

### What the Audit Worker Sees from Tokowaka

The audit worker does NOT call TokowakaClient directly. But it reads the downstream effects:

| What audit worker reads | Where it comes from |
|------------------------|---------------------|
| `Suggestion.data.edgeDeployed` | Written by `deployToEdge()` — timestamps a user deploy |
| `Suggestion.data.coveredByDomainWide` | Written by `deployToEdge()` or audit worker itself (for isDeployedAtEdge=true URLs) |
| `isDeployedAtEdge: true` in scrape.json | Written by content-scraper detecting `x-tokowaka-request-id` / `x-edgeoptimize-request-id` response headers |

The scraper's `detectEdgeDeployment()` uses exactly those two headers to detect active Tokowaka prerendering — the same headers that `checkEdgeOptimizeStatus()` in TokowakaClient checks.
