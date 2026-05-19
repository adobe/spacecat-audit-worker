# Batch Mechanics — Prerender Audit (Step 2 & Step 3 Processing)

Read this file when working on: URL selection logic, PageCitability dedup, DAILY_BATCH_SIZE tuning, the three submitForScraping paths, or step 3 metrics/citability writes.

---

## URL Sources & Limits

| Constant | Value | Source |
|----------|-------|--------|
| `TOP_ORGANIC_URLS_LIMIT` | 200 | GSC via SiteTopPage (highest priority) — was accidentally left at 5 in a debug state; if this looks wrong again, check the constant |
| `TOP_AGENTIC_URLS_LIMIT` | 2,000 | Athena CDN logs, HTTP 200 only |
| `DAILY_BATCH_SIZE` | 320 | Hard cap for scraper submission per audit run |

---

## Three Paths in submitForScraping

The function has three distinct code paths. They share **no** URL-filtering logic.

### CSV path (`auditContext.urls` present)

```
1. Rebase auditContext.urls to preferredBase
2. mergeAndGetUniqueHtmlUrls()  → dedup + HTML-only filter
3. Return immediately           → does NOT read status.json
```

### Slack path (`auditContext.slackContext.channelId` set)

```
1. Read siteStatus (status.json from S3)       ← bot-block sticky check is SKIPPED for Slack
2. getTopOrganicUrlsFromSeo()  → organic URLs
3. site.getConfig().getIncludedURLs()           → included URLs
4. Rebase both to preferredBase
5. mergeAndGetUniqueHtmlUrls([organic, included])
   → NO PageCitability dedup
   → NO edgeDeployed filter
   → NO DAILY_BATCH_SIZE cap
6. Return
```

Slack bypasses batching so operators get a full on-demand result (D-16).

### Normal scheduled path

```
1. Read siteStatus (status.json from S3)
2. Sticky bot-block check (isStickyBotBlocked)
   → If blocked within 3-day window: return { urls: [], domainBlocked: true }
3. getTopOrganicUrlsFromSeo()  → organic (up to 200)
4. getTopAgenticUrls()         → agentic (up to 2,000)
5. site.getConfig().getIncludedURLs()  → included
6. Rebase all three to preferredBase
7. getRecentlyProcessedPathnames() → Set<pathname> from PageCitability (7-day window)
8. getEdgeDeployedPathnames(siteStatus) → Set<pathname> from status.json pages[].isDeployedAtEdge
9. Filter each source independently:
   filteredOrganic   = organic.filter(notRecent).filter(notEdgeDeployed)
   filteredIncluded  = included.filter(notRecent).filter(notEdgeDeployed)
   filteredAgentic   = agentic.filter(notRecent).filter(notEdgeDeployed)
10. Concatenate in priority order (NOT sorted — concat order IS the priority):
    candidates = [...filteredOrganic, ...filteredIncluded, ...filteredAgentic]
11. Slice to DAILY_BATCH_SIZE=320
12. mergeAndGetUniqueHtmlUrls(batchedUrls)  → final dedup + HTML-only filter
13. Return
```

### edgeDeployedPathnames Source

`edgeDeployedPathnames` in step 2 is populated from `getEdgeDeployedPathnames(siteStatus)`, which reads `status.json pages[].isDeployedAtEdge` — the **previous scrape run's** results.

This is **not** the same as querying `Suggestion.data.edgeDeployed` from the DB. The scraper writes `isDeployedAtEdge` per URL based on Tokowaka/CDN response headers it detects. The step 2 filter reads that previous scraper verdict from S3 status.json rather than hitting the DB.

---

## isFirstRunOfCycle

```js
const hasRecentOrganic = filteredOrganicUrls.length !== topPagesUrls.length;
isFirstRunOfCycle = !hasRecentOrganic;
```

`isFirstRunOfCycle = true` means none of the organic URLs were excluded by the 7-day PageCitability dedup — i.e., the site's organic URLs haven't been processed recently and this is the start of a fresh rotation cycle. Logged in `prerender_submit_scraping_metrics`.

---

## PageCitability Dedup Window

- **Time-based**: 7 days from `PageCitability.updatedAt` (not `createdAt` — if a URL is reprocessed, `updatedAt` resets, extending its exclusion window by another 7 days)
- **Purpose**: Avoid re-scraping same URL within a week; spreads the full URL inventory across ~7 daily runs
- **isFirstRunOfCycle flag**: When all organic URLs pass the dedup (none excluded), it signals the previous cycle completed and a new one is starting

---

## prerender_submit_scraping_metrics Log

Emitted once per step 2 run (for all three paths). Monitored by ops.

```
submittedUrls       — final URL count after all filtering
agenticUrls         — raw agentic count before filtering (0 for CSV)
topPagesUrls        — raw organic count before filtering (0 for CSV)
includedURLs        — raw includedURLs count before filtering (0 for CSV)
filteredOutUrls     — URLs removed by mergeAndGetUniqueHtmlUrls
currentOrganic      — organic URLs in the final batch
currentIncludedUrls — included URLs in the final batch
currentAgentic      — agentic URLs in the final batch
isFirstRunOfCycle   — true if no organic URLs were deduped (fresh cycle)
agenticNewThisCycle — agentic URLs that passed the 7-day dedup filter
edgeDeployedUrls    — count of URLs excluded by edge-deployed filter
baseUrl, siteId
```

---

## prerender_ai_summary_metrics Log

Emitted once per `guidance-handler.js` invocation after `Suggestion.saveMany()` succeeds. Monitored for Mystique quality tracking per paid customer.

```
siteId
baseUrl             — site.getBaseURL()
opportunityId
isPaidLLMOCustomer  — boolean, from site config (affects dashboard visibility)
totalSuggestions    — count of suggestions updated in this batch (suggestionsToSave.length)
valuableSuggestions — count where valid aiSummary AND valuable=true
validAiSummaryCount — count where aiSummary is non-null and !== 'not available'
```

---

## AI-Only Mode Override (`handleAiOnlyMode`)

**Trigger**: `getModeFromData(data).mode === 'ai-only'` — detected in step 1, which immediately calls `handleAiOnlyMode` and returns its result. Steps 2 and 3 both detect the flag and return `{ status: 'skipped' }`.

**`handleAiOnlyMode` flow** (`handler.js:727`):
```
1. Parse optional params from data: { opportunityId, scrapeJobId }
2. scrapeJobId resolution:
   - If provided in data → use it
   - If absent → readSiteStatusJson() → use status.json scrapeJobId
   - If still absent → return error
3. Opportunity resolution:
   - If opportunityId provided → Opportunity.findById(opportunityId)
   - If absent → Opportunity.allBySiteIdAndStatus(siteId, 'NEW').find(type==='prerender')
   - Validate opportunity.getSiteId() === siteId (security check)
4. sendPrerenderGuidanceRequestToMystique(baseUrl, auditData, opportunity, context, null)
   → null preBuiltCandidates → derives candidates from all DB suggestions (ai-only path)
   → builds suggestionId from actual DB UUID (not URL)
5. Return { status: 'complete', mode: 'ai-only', opportunityId, suggestionCount }
```

**Batch size**: Respects `MYSTIQUE_BATCH_SIZE` only — no DAILY_BATCH_SIZE involved.

**Use case**: Re-process AI summaries without new scraping (quota exhaustion, prompt updates, model changes).

---

## writeToCitabilityRecords — Fields Written to PageCitability

Writes the following fields (all from `compareHtmlContent` result), in batches of 10:

```
citabilityScore   ← from stats.citationReadability
contentRatio      ← from contentGainRatio
wordDifference    ← from stats.wordDiff
botWords          ← from wordCountBefore
normalWords       ← from wordCountAfter
isDeployedAtEdge  ← from scrape.json
```

Only URLs where `result.error !== true` are written. Uses per-record `save()` (not `saveMany`) but batched 10 at a time to limit concurrent S3/DB pressure.
