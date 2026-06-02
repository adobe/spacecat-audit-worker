# Decision Log — Prerender Audit

Historical decisions with their reasons, what was tried before, and commit references.
Read this when you need to understand WHY the code looks a specific way, or before changing a non-obvious invariant.

---

## D-01 · coveredByDomainWide instead of SKIPPED for domain-wide coverage

**Decision**: When a domain-wide suggestion is deployed, individual URL suggestions get `coveredByDomainWide` set (status stays `NEW`), not moved to `SKIPPED`.

**Why**: Rollback via `spacecat-api-service` only clears `coveredByDomainWide` — it does not touch suggestion status. With `SKIPPED`, the UI had to explicitly call `bulkUpdateSuggestionsStatus(NEW)` after every rollback. With `coveredByDomainWide`, clearing the field on rollback auto-returns suggestions to the Current tab with no UI changes needed.

**Evolution**:
1. `d429a739` — First attempt: move to SKIPPED on domain-wide deploy
2. `8d9aec57` — Reverted (implementation issues)
3. `ae12fbf3` — Re-applied SKIPPED approach with refinements
4. `831dda76` (#2223) — Refined: only move to SKIPPED if URL is confirmed deployed at edge in current run (not all NEW suggestions)
5. `93a12733` (#2326) — **Current approach**: replaced SKIPPED with `coveredByDomainWide` field entirely

**Superseded**: All SKIPPED-based approaches (D-01 steps 1–4) are superseded by step 5.

---

## D-02 · scrapeJobId stored per-suggestion, not per-audit-run

**Decision**: `Suggestion.data.scrapeJobId` stores the ID from when the suggestion was first created. It is never overwritten by subsequent audit runs.

**Why**: Mystique constructs S3 paths for markdown files using `{scrapeJobId}/{path}/markdown-diff.md`. The actual artifacts on S3 were written under the scrapeJobId active when the suggestion was created. Using the current run's scrapeJobId caused `NoSuchKey` errors in Mystique for every site where the suggestion predated the current run.

**Additional failure mode** (#2320): In the old step-3 fallback (re-fetching top-page URLs when `scrapeResultPaths` was empty), the code was stamping the current run's scrapeJobId on ALL suggestions including ones from previous batches, overwriting their correct IDs and breaking their S3 lookups with `scrapingStatus: error`. That fallback was subsequently removed in D-21.

**Commits**: `93435341` (#2300) — persist scrapeJobId per suggestion; `872baa49` (#2320) — fix fallback mode overwriting previous IDs; `505391dc` (#2538, D-21) — fallback removed entirely

---

## D-03 · Two-path bot-block detection (COMPLETE + FAILED status)

**Decision**: `getScrapeJobStats()` has two separate paths for 403 counting: one for COMPLETE-status URLs (via in-memory comparisonResults) and one for FAILED-status URLs (via DB + S3 scrape.json).

**Why**: `getScrapeResultPaths` only returns URLs with `ScrapeUrl.status = COMPLETE`. When the scraper marks a 403 URL as `FAILED` directly, that URL never enters `scrapeResultPaths` and was invisible to the original bot-block detection. Sites where the scraper returned FAILED for every 403 URL showed `scrapeForbiddenCount: 0` and `scrapeForbidden: false` even when completely blocked.

**Note**: COMPLETE-status 403 URLs (where `scrape.json` has `error.statusCode: 403`) were already counted correctly via `compareHtmlContent`'s `Promise.allSettled` path. The FAILED path was additive coverage.

**Commit**: `a9fc3478` (#2245)

---

## D-04 · getDomainWideSuggestionDeployedAtEdge must only match NEW suggestions

**Decision**: When checking if a domain-wide suggestion is actively deployed at edge, the lookup must restrict to `status === NEW` suggestions only.

**Why**: Production data for wkkellogg.com had 14 OUTDATED domain-wide suggestions (from prior audit runs) before the 1 active NEW suggestion with `edgeDeployed` set. `Array.find()` returned the first match — an OUTDATED suggestion — whose `edgeDeployed` was undefined, causing the function to return `null`. NEW suggestions were never moved to covered state despite the domain being deployed.

**Rule**: Only `status === NEW` domain-wide suggestions are authoritative for edge deployment state. The function is `getDomainWideSuggestionDeployedAtEdge` (previously named `isAllDomainDeployedAtEdge` — the old name is preserved only as a log label at line 253).

**Commit**: `12fdd13f` (#2196)

---

## D-05 · Bot-block thresholds: 403 ratio ≥ 0.5 AND confidence ≥ 0.99

**Decision**: Both conditions must be true; neither threshold is negotiable.

**Why**: Root cause analysis of 311,086 scrape failures showed 10.4% (32,333) were HTTP 403 bot-blocks with no per-domain detection before submitting. Thresholds were calibrated to minimize false positives (suppressing legitimate sites) while catching genuine bot-blocking.

**Breakdown from analysis**:
- HTTP 404: 37.8% (117,462) — agentic URL source includes CDN-served 404s
- HTTP 403: 10.4% (32,333) — domains actively blocking the scraper
- HTTP 429: ~1.1% — rate limiting
- HTTP 410: <1% — permanently removed pages

**Commit**: `721a9c99` (#2510)

---

## D-06 · isDeployedAtEdge URLs excluded from scrapedUrlsSet

**Decision**: URLs where `isDeployedAtEdge=true` are filtered out before submission to the scraper and excluded from OUTDATED marking.

**Why**: Same 311K failure analysis (#2510) — scraping already-deployed URLs was wasteful. If a URL is serving optimized content via Tokowaka CDN, it doesn't need to be analyzed for prerender gaps.

**Commit**: `721a9c99` (#2510), first introduced in `08c53058` (#2183)

---

## D-07 · Don't send FIXED or edgeDeployed suggestions to Mystique

**Decision**: `sendPrerenderGuidanceRequestToMystique` skips suggestions where `status === 'FIXED'` or `data.edgeDeployed` is set.

**Why**: The UI never displays AI summaries for deployed or fixed suggestions. Previously only OUTDATED suggestions were filtered — FIXED and deployed suggestions were still sent, generating summaries that were never surfaced and wasting Mystique quota.

**Commit**: `0d4f7046` (#2201)

---

## D-08 · suggestionId in Mystique SQS payload (superseded)

**Status**: Superseded — Mystique no longer validates `suggestion_id` as a required field.

**Original decision**: Every `guidance:prerender` SQS message must include `suggestionId`. Mystique's `PrerenderSuggestionMessageData` Pydantic model required `suggestion_id: str`; if absent, the message was dropped silently. Production data for micron.com showed 8 of 13 suggestions dropped due to URL mismatch building the `urlToSuggestionId` map.

**Current state**: The field is still sent (normal runs: `suggestionId = s.url`; ai-only runs: `suggestionId = s.getId()`), but Mystique no longer fails validation if it is absent. Guidance-handler.js matches Mystique responses back to suggestions by pathname via `suggestionsByPathname` (D-22), not by `suggestionId`.

**Commit**: `001b563a` (#2373) — original fix; D-22 (`f0281666`) — supersedes with pathname keying

---

## D-09 · Daily batching replaced weekly full-site scan

**Decision**: Audit runs daily with `DAILY_BATCH_SIZE=320`, deduplicated against PageCitability records (7-day window), rather than weekly full-site scans.

**Why**: Weekly scan was scraping up to 2,200 URLs at once (overlapping with page-citability audit). Daily batching: (1) spreads load, (2) avoids re-scraping the same URL within 7 days, (3) eliminated duplicate scraping between prerender and page-citability audits by sharing the PageCitability dedup table.

**Commit**: `ce68df2b` (#2146)

---

## D-10 · TOP_ORGANIC_URLS_LIMIT is 200, not 5

**Decision**: `TOP_ORGANIC_URLS_LIMIT = 200`

**Why**: Was accidentally left at `5` (a debug value) and shipped to production. If this constant ever looks suspiciously small again, check `src/prerender/utils/constants.js` before investigating deeper.

**Commit**: `b10ec480` (#2532)

---

## D-11 · S3 path uses `scrapeJobId` UUID, not `siteId`

**Decision**: S3 paths for scrape artifacts are `prerender/scrapes/{scrapeJobId}/{sanitizedPath}/...` where `scrapeJobId` is a random UUID generated by `ScrapeClient`.

**Why**: Before PR #1772, the audit used `CONTENT_SCRAPER` which assigned `siteId` as the job ID, so paths were `prerender/scrapes/{siteId}/...`. PR #1772 migrated to `SCRAPE_CLIENT` (which generates random UUIDs), but the audit worker still tried to download files using `siteId`. Result: no files found, no analysis performed, no suggestions created for every site.

**Additional**: The migration also required switching from `type` → `processingType` in the `createScrapeJob()` call, and `allowCache: false` → `maxScrapeAge: 0`. These are the correct field names for `ScrapeClient`.

**Commits**: `db44bc2b` (#1772) — SCRAPE_CLIENT migration; `5d377936` (#1786) — fix S3 path to use `scrapeJobId`

---

## D-12 · status.json is primary UI data source (LatestAudit removed)

**Decision**: The UI reads `prerender/scrapes/{siteId}/status.json` from S3 as the sole source of audit results. `LatestAudit` is not used for prerender.

**Why**: `LatestAudit.updateByKeys()` was failing in production (lilly.com) because `LatestAudit.create()` was disabled in data-access v3. Rather than fixing the LatestAudit pathway, the decision was to make `status.json` the authoritative source. This also allows uploading error state when the audit fails mid-run — so the UI always shows accurate status even for partial failures.

**Key implication**: `status.json` must be uploaded even when `syncSuggestions` throws, so the UI doesn't show stale successful state. There's an explicit error-path upload in step 3.

**Commit**: `11d59f11` (#2065)

---

## D-13 · Dummy opportunity for scrape-forbidden sites

**Decision**: When all scraped URLs return 403 (`scrapeForbidden=true`), a dummy opportunity is created with no suggestions rather than returning nothing.

**Why**: The UI expects an opportunity record to display the "bot-blocked" state. Without it, the UI shows no opportunity and the user sees nothing. The dummy opportunity communicates that the site was visited but blocked.

**Commit**: `e0d31dc9` (#1462)

---

## D-14 · SQS 256 KB limit → MYSTIQUE_BATCH_SIZE = DAILY_BATCH_SIZE = 320

**Decision**: Mystique guidance messages are capped at `MYSTIQUE_BATCH_SIZE = DAILY_BATCH_SIZE = 320` suggestions per SQS message (`constants.js` line 22: `export const MYSTIQUE_BATCH_SIZE = DAILY_BATCH_SIZE`). Only the first batch is sent; a TODO exists to send all batches once Mystique multi-batch handling is deployed.

**Why**: Production incident at lenscrafters.com: the site had 1,700+ historical suggestions; sending all active suggestions in one SQS message exceeded AWS's hard 262,144-byte limit. The entire Mystique batch was silently dropped. The batch size was initially set to 100 at ~600 bytes per entry (≈ 60 KB), then raised to match `DAILY_BATCH_SIZE = 320` since that is the maximum number of URLs submitted per run — under normal steady-state conditions the `.slice(0, MYSTIQUE_BATCH_SIZE)` is a no-op.

**Note**: Truncation only bites in edge cases where accumulated DB suggestions exceed 320 (e.g. CSV runs + historical carryover). The TODO comment at `handler.js:689` tracks multi-batch delivery.

**Secondary fix in same PR**: `effectiveScrapeJobId` must now be resolved per suggestion (see D-02). If neither `data.scrapeJobId` nor `data.originalHtmlKey` can yield a job ID, the suggestion is **skipped** with a warn log (previously fell back to the audit-level job ID, producing wrong S3 keys silently).

**Commit**: `7751f0bd` (#2338)

---

## D-15 · `valuable` flag must stay in sync with `aiSummary`

**Decision**: The `valuable` boolean is only updated when the Mystique response includes a valid (non-null, non-"Not available") `aiSummary`. When `aiSummary` is invalid, both `aiSummary` and `valuable` are preserved from the previous value.

**Why**: Before this fix, `aiSummary` was conditionally updated but `valuable` was always overwritten. If a suggestion had `valuable: false` and a valid `aiSummary` from a prior run, a subsequent Mystique response with no valid summary would reset `valuable` to `true` (the default) while preserving the old `aiSummary`. The two fields fell out of sync, showing incorrect business value assessments.

**Rule**: `valuable` and `aiSummary` are a pair — update both or neither.

**Commit**: `45b640db` (#2369)

---

## D-16 · Slack-triggered audit bypasses daily batching and agentic URLs

**Decision**: When a prerender audit is triggered via Slack command (`run {site} prerender`), the audit uses organic + included URLs only, with no agentic URL sources and no PageCitability recency filter.

**Why**: Slack-triggered runs are explicit manual requests — the operator wants to see results now, not a batch-limited subset. Daily batching and agentic URL sourcing are load-management features for scheduled runs; they create unexpected sparseness for on-demand debugging. Detection via `auditContext.slackContext.channelId`.

**Commit**: `dcd3b8aa` (#2307)

---

## D-17 · `overrideBaseURL` from site config has highest URL normalization priority

**Decision**: If `site.config.overrideBaseURL` is set and includes a valid protocol, all URL sources (organic, includedURLs, csvUrls, agentic) are rebased to that domain — it takes priority over `getPreferredBaseUrl`'s site-level detection.

**Why**: Some sites have a canonical production domain that differs from the `baseURL` stored in SpaceCat. Without `overrideBaseURL`, rebased URLs used the SpaceCat `baseURL`, causing suggestions to be created under the wrong domain and preventing correct S3 key construction.

**Commit**: `889559fd` (#2328)

---

## D-18 · `mergeAndGetUniqueHtmlUrls` deduplicates www/non-www and HTML-only

**Decision**: Before submitting URLs to the scraper, all URL lists are merged through `mergeAndGetUniqueHtmlUrls`, which (1) removes duplicate paths regardless of www prefix, and (2) filters out non-HTML URLs (images, PDFs, etc.).

**Why**: Paid LLMO customers with large sites had both www and non-www variants of the same path in GSC data — scraping both was redundant. Additionally, agentic URL sources sometimes included CDN-served assets (images, PDFs) which produced 404s and inflated the error rate. Both problems were identified through logging improvements for paid customers.

**Commit**: `d3b84e52` (#1879)

---

## D-19 · `usedEarlyClientSideHtml` flag propagated to status.json

**Decision**: The `usedEarlyClientSideHtml` boolean from `scrape.json` is passed through to the corresponding `pages[]` entry in `status.json` (sparse write — omitted when not set).

**Why**: When the scraper falls back to early client-side HTML (before full JS execution completes), the content comparison is less reliable. The UI needs to know which pages used this fallback to potentially caveat the content gain ratio displayed. Without this flag, the UI had no way to distinguish reliable from fallback-quality analysis.

**Commit**: `5305142f` (#2330)

---

## D-20 · `html-comparator-util.js` wrapper kept despite shared html-analyzer package

**Decision**: After extracting HTML analysis to `@adobe/spacecat-shared-html-analyzer`, a thin wrapper `html-comparator-util.js` was kept in the prerender module rather than calling the shared package directly.

**Why**: The wrapper maintains separation of concerns between (1) the shared package's generic analysis API and (2) the prerender-specific transformation of results (field name mapping, threshold application). It also keeps the shared package mockable in isolation during testing without coupling test setup to the shared package's internals.

**Commit**: `66d0cf41` (#1501)

---

## D-21 · Step 3 top-page fallback removed — `getScrapeJobStats` supersedes it

**Decision**: When `scrapeResultPaths` is empty (all submitted URLs had `FAILED` scraper status), the old fallback that re-fetched ~153 top-page URLs and ran `compareHtmlContent` on them was removed. A warning is logged and comparison is skipped entirely.

**Why**: `getScrapeResultPaths` only returns `COMPLETE`-status URLs. When every submitted URL fails, `scrapeResultPaths.size === 0` triggered the fallback, which then called `compareHtmlContent` against S3 paths keyed by the **current** `scrapeJobId`. Since the scraper never wrote those files, every URL resolved as an error and was written to `status.json` — creating phantom error entries for URLs that were never part of this scrape job. `getScrapeJobStats` already reads `FAILED`-status URLs from the `ScrapeUrl` DB and populates `missingPages`, so the fallback was both redundant and harmful.

**Additional problem the fallback caused**: The `isSlackTriggered` guard (D-16) was the only thing preventing the fallback from running during Slack-triggered audits — a silent coupling with no invariant protection.

**Commit**: `505391dc` (#2538)

---

## D-22 · Suggestions keyed on pathname to prevent duplicates after domain shift

**Decision**: `buildKey` in `processOpportunityAndSuggestions` produces `pathname|prerender` (e.g. `/products|prerender`) instead of the full URL. `scrapedUrlsSet` is a pathname-normalizing wrapper (`{ has: url => pathnames.has(toPathname(url)) }`) rather than a plain `Set<string>`. `deployedAtEdgePathnames` stores pathnames. `guidance-handler.js` indexes `suggestionsByPathname` instead of `suggestionsByUrl`.

**Why**: After the page-citability migration, `getPreferredBaseUrl()` began resolving to a different domain for some sites (e.g. `www.adobe.com` → `adobe.com`). The same page path then produced two distinct full-URL keys:
- existing suggestion key: `https://www.adobe.com/test|prerender`
- new audit run key: `https://adobe.com/test|prerender`

`syncSuggestions` treated these as distinct entries and created a new suggestion rather than updating the existing one. Observed impact: **10,657 duplicate pairs across 100 paying customers**. Additionally, trailing-slash variants (`/products/` vs `/products`) caused the same problem — stripped as part of `toPathname`.

**`toPathname` rules**: extracts `URL.pathname`, strips trailing slash on non-root paths (`/products/` → `/products`), preserves `/` for root, falls back to raw string on parse failure.

**Existing duplicates**: This fix prevents new duplicates only. The 10,657 pre-existing pairs require a one-time cleanup script (per the PR description; script not yet applied as of commit `f0281666`).

**Guidance handler**: `suggestionsByPathname` ensures Mystique AI summaries attach to the correct suggestion even when Mystique's response URL uses the new domain but the stored suggestion still carries the old domain.

**Commit**: `f0281666` (#2397)
