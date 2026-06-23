# Prerender Behavioural Contracts — Reference Index

> This file is the **single source of truth** for the prerender audit's observable behaviour.
> Read this instead of `handler.js` when writing or debugging tests.
> Update it when handler behaviour changes.

---

## S3 Key Format

```
prerender/scrapes/{siteId}/status.json           ← site-level state
prerender/scrapes/{scrapeJobId}/{segment}/server-side.html
prerender/scrapes/{scrapeJobId}/{segment}/client-side.html
prerender/scrapes/{scrapeJobId}/{segment}/scrape.json
```

**`segment`** = `sanitizeImportPath(pathname)`:
1. Strip leading/trailing slashes
2. Replace `/`, `.`, `_` with `-`
3. Collapse consecutive `-` to one `-`
4. Strip leading/trailing `-`
5. Root path (`/`) → empty segment → no slash before file name

**Examples:**
| URL | segment | server key |
|-----|---------|------------|
| `https://example.com/` | _(empty)_ | `prerender/scrapes/{job}/server-side.html` |
| `https://example.com/page-1` | `page-1` | `prerender/scrapes/{job}/page-1/server-side.html` |
| `https://example.com/a/b.html` | `a-b-html` | `prerender/scrapes/{job}/a-b-html/server-side.html` |

**`helpers.js` exports `scrapeKeys(scrapeJobId, url)`** — mirrors this logic exactly.

---

## S3 Object Types

| Object | Value stored | `ContentType` header | How handler reads it |
|--------|-------------|---------------------|----------------------|
| `*.html` | raw HTML string | absent / `text/html` | `getObjectFromKey` returns raw string |
| `scrape.json` | JSON object | `application/json` | `getObjectFromKey` returns parsed object |
| `status.json` | JSON object | `application/json` | `getObjectFromKey` returns parsed object |

**`buildS3Client` rule:** pass a `string` value for HTML files; pass a plain `object` for JSON files.

---

## Handler Constants

| Constant | Value | Meaning |
|----------|-------|---------|
| `CONTENT_GAIN_THRESHOLD` | `1.1` | client/server word ratio ≥ 1.1 → `needsPrerender=true` |
| `TOP_ORGANIC_URLS_LIMIT` | `200` | `getTopOrganicUrlsFromSeo` slices organics to this |
| `DAILY_BATCH_SIZE` | `320` | normal-mode cap (organic + included + agentic) |
| `BOT_BLOCK_WINDOW_DAYS` | `3` | sticky scrapeForbidden expires after this many days |
| `BOT_BLOCK_CONFIDENCE_THRESHOLD` | `0.99` | reactive block requires confidence ≥ this |
| `BOT_BLOCK_403_RATIO` | `0.5` | reactive block fires only when 403 ratio ≥ this |
| `PAGE_CITABILITY_DEDUP_WINDOW_DAYS` | `7` | URLs processed within this window are excluded |

---

## Audit Steps

```
Step 1: importTopPages          → returns { trigger, urls?, auditContext }
Step 2: submitForScraping       → returns { urls, auditContext }
Step 3: processContentAndGenerateOpportunities  → returns { status, auditResult }
```

`auditContext.next` determines which step runs.

---

## Step 2 — Modes

| Mode | Trigger | Dedup | Status.json read | Batch cap |
|------|---------|-------|-----------------|-----------|
| normal | no `urls` in auditContext | PageCitability 7-day | yes | DAILY_BATCH_SIZE=320 |
| CSV | `auditContext.urls` present | none | no | no cap |
| Slack | `auditContext.slack=true` | none | skips sticky bot-block | no cap |

**`domainBlocked` flag** is set in `auditContext` when sticky bot-block fires; forwarded to step 3.

---

## Step 2 — URL Selection (normal mode)

1. `getTopOrganicUrlsFromSeo` → slices to `TOP_ORGANIC_URLS_LIMIT=200`
2. `getTopAgenticUrls` → catches all errors (Athena unavailable) → returns `[]`
3. Append `includedURLs` from site config
4. Subtract edge-deployed URLs from `status.json.pages[].isDeployedAtEdge=true`
5. Subtract URLs in `PageCitability` within 7-day window
6. Slice to `DAILY_BATCH_SIZE=320`

---

## Step 3 — Execution Order

1. **`detectWrongEdgeDeployedStatus`** — unconditional, runs even when `isDomainBlocked=true`
2. **`isDomainBlocked` check** — if true → set `scrapeForbidden=true`, skip HTML comparison, jump to status write
3. **HTML comparison loop** — for each URL in `scrapeResultPaths`:
   - Read `server-side.html` + `client-side.html` from S3
   - Missing HTML → error result for that URL (not a crash)
   - Ratio ≥ 1.1 → `needsPrerender=true`; `scrape.json.isDeployedAtEdge=true` → excluded from `scrapedUrlsSet`
4. **`getScrapeJobStats`** — counts 403s from COMPLETE + FAILED-status URLs via `ScrapeUrl` DB + S3 scrape.json
   - `ScrapeUrl` missing from `dataAccess` → fallback: `urlsSubmittedForScraping = urlsToCheck.length`
   - `allByScrapeJobId` rejects → same fallback (error caught internally)
5. **`detectBotBlocker`** — only if 403 ratio ≥ 0.5; requires confidence ≥ 0.99 + known CDN for `scrapeForbidden=true`
   - Throws → warning logged, `scrapeForbidden=false`, audit continues
6. **Branch routing:**
   - **Branch A** (prerender URLs found + no domain block) → `convertToOpportunity` + `syncSuggestions`
   - **Branch B** (prerender URLs found + `scrapeForbidden=true`) → `convertToOpportunity` with domain-wide suggestion + `syncSuggestions`
   - **Branch C** (no prerender URLs) → mark existing NEW suggestions OUTDATED via `Suggestion.bulkUpdateStatus`
7. **Write `status.json`** — merges current pages with prior pages not in current run

---

## Step 3 — Error Handling

| Exception source | Caught? | Observable effect |
|-----------------|---------|-------------------|
| `Opportunity.allBySiteIdAndStatus` rejects | **No** — propagates | Lambda invocation fails; SQS retries |
| `Opportunity.create` rejects | **Yes** | `log.error` called; function returns `undefined` |
| `detectBotBlocker` throws | **Yes** | `log.warn` with "detectBotBlocker failed"; `scrapeForbidden=false` |
| `ScrapeUrl.allByScrapeJobId` throws | **Yes** | fallback count used; audit completes |
| S3 `GetObjectCommand` NoSuchKey (HTML) | **Yes** | per-URL error result; `urlsScrapedSuccessfully` not incremented |

---

## status.json Shape

```json
{
  "scrapeForbidden": false,
  "scrapeForbiddenSince": "2025-01-01T00:00:00.000Z",
  "scrapeJobId": "job-abc",
  "urlsSubmittedForScraping": 42,
  "pages": [
    {
      "url": "https://example.com/page-1",
      "needsPrerender": true,
      "isDeployedAtEdge": false,
      "scrapeError": { "statusCode": 403, "message": "Forbidden" }
    }
  ]
}
```

**Merge rule:** pages from prior `status.json` not in the current scrape run are preserved.

---

## Stubs Needed Per Step

### Step 2 (`submitForScraping`)

| Stub | Purpose |
|------|---------|
| `s3Client.send` (GetObjectCommand for statusKey) | reads `status.json` for bot-block check + edge-deployed URLs |
| `SiteTopPage.allBySiteIdAndSourceAndGeo` | organic URL source |
| `PageCitability.allByIndexKeys` | dedup window |
| `site.getConfig().getIncludedURLs()` | `includedURLs` |

### Step 3 (`processContentAndGenerateOpportunities`)

| Stub | Purpose |
|------|---------|
| `s3Client.send` (GetObjectCommand) | reads status.json + HTML + scrape.json |
| `s3Client.send` (PutObjectCommand) | writes status.json (inspect with `captureStatusWrite`) |
| `ScrapeUrl.allByScrapeJobId` | getScrapeJobStats stats counting |
| `Opportunity.allBySiteIdAndStatus` | find existing opportunity |
| `Opportunity.create` | create new opportunity (Branch A/B) |
| `Suggestion.bulkUpdateStatus` | mark outdated suggestions (Branch C) |
| `Suggestion.saveMany` | save new suggestions (Branch A/B) |

---

## Helpers Quick Reference (`helpers.js`)

| Export | Use |
|--------|-----|
| `scrapeKeys(scrapeJobId, url)` | compute canonical S3 key triplet |
| `buildUrlS3Content(scrapeJobId, url, opts)` | build partial S3 keyMap for one URL |
| `statusKey(siteId)` | `prerender/scrapes/{siteId}/status.json` |
| `buildStatus(opts)` | valid `status.json` object |
| `daysAgo(n)` | ISO timestamp N days in the past |
| `captureStatusWrite(s3Client)` | parse body of first PutObjectCommand |
| `buildContext(sandbox, overrides)` | full handler context with safe defaults |
| `buildS3Client(sandbox, keyMap)` | dispatch-by-key S3 stub |
| `buildDataAccess(sandbox, opts)` | all entity stubs the handler touches |
| `buildSite(opts)` | site object stub |
| `buildOpportunity(sandbox, opts)` | opportunity object stub |
| `buildSuggestion(sandbox, opts)` | suggestion object stub |
| `HTML_SAME` | identical server+client HTML (ratio=1.0, no prerender) |
| `HTML_SERVER_SPARSE` | sparse server HTML |
| `HTML_CLIENT_NEEDS_PRERENDER` | rich client HTML (pair with sparse server → ratio>1.1) |
