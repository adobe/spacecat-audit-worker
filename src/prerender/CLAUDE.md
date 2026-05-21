# CLAUDE.md — SpaceCat Prerender Audit Handler

This file provides guidance to Claude Code when working with the prerender audit system (`spacecat-audit-worker/src/prerender/`).

## Repository Context

The prerender audit is a **3-step StepAudit** that analyzes whether Edge Delivery Services sites need prerendering for search engine visibility. It compares server-rendered HTML with client-rendered HTML and generates opportunities/suggestions when content gaps exceed thresholds.

**Naming**: The internal code name is `prerender`. The user-facing opportunity name shown in the UI is **"Recover content visibility"** (abbreviated **RCV**). The three terms — `prerender`, `Recover content visibility`, and `RCV` — are used interchangeably across code, docs, Jira tickets, and team conversations.

**Handler Location**: `src/prerender/handler.js` (1,875 lines, 8 exported functions)  
**Folder**: `src/prerender/` (7 files, 2,415 lines total)

---

## Navigation Guide — Which File to Read

**This file** covers the core audit mechanics: 3-step flow, bot-block detection, AI-only mode, key invariants, testing strategy, and development constraints.

**Sub-files** — read only when the task specifically involves:

| Sub-file | Read when working on... |
|----------|------------------------|
| [batch-mechanics.md](.claude/batch-mechanics.md) | The three `submitForScraping` URL paths (CSV/Slack/Normal), PageCitability dedup, DAILY_BATCH_SIZE, `isFirstRunOfCycle`, `prerender_submit/ai_summary_metrics` logs, `handleAiOnlyMode` flow, `writeToCitabilityRecords` |
| [suggestion-lifecycle.md](.claude/suggestion-lifecycle.md) | Per-URL and domain-wide Suggestion.data field schemas, Golden Rules, all suggestion statuses, audit worker writes table, OUTDATED protection, domain-wide preservation logic, `prepareDomainWideAggregateSuggestion` SUM logic |
| [system-interactions.md](.claude/system-interactions.md) | Cross-system Q&A: import worker trigger, Athena CDN-log query, content-scraper job lifecycle, URL batch pipeline, PageCitability dedup query, Mystique payload/response, content gain calculation, **S3 schemas** (scrape.json, status.json), sanitizeImportPath regex, scrapeJobId fallback chain |
| [scraper-internals.md](.claude/scraper-internals.md) | Scraper output format, bot-protection detection, edge deployment detection, markdown file generation, shadow DOM handling |
| [shared-packages.md](.claude/shared-packages.md) | `html-analyzer` word counting, `ScrapeClient` job submission, `PageCitability`/`ScrapeJob`/`ScrapeUrl` DB entities, `TokowakaClient.deployToEdge()` and S3 config structure |
| [ui-data-map.md](.claude/ui-data-map.md) | `status.json` consumption in UI, `Suggestion.data` field display, tab filter logic, `avgLlmVisibilityScore` formula, `PrerenderOpportunitySection` UX flows |
| [api-service-deploy-rollback.md](.claude/api-service-deploy-rollback.md) | `POST /suggestions/edge-deploy` and `POST /suggestions/edge-rollback` routes, what fields they write/clear on Suggestion.data, access control, geo-experiment mode |
| [decision-log.md](.claude/decision-log.md) | WHY non-obvious invariants exist; full evolution of design decisions with commit refs; supersession history |
| [coding-guidelines.md](.claude/coding-guidelines.md) | PR checklist: invariant rules, KISS/DRY/YAGNI/SOLID, TDD for refactoring, N+1 prevention, locked-contract checklist, log levels, coverage, doc update rules |
| [refactoring-proposal.md](.claude/refactoring-proposal.md) | Proposed restructuring of handler.js: step 2 three-path cleanup, step 3 fallback replacement with getScrapeJobStats, module extraction plan, TDD entry points |
| [handler-reference.md](.claude/handler-reference.md) | **Test writing reference** — S3 key format + examples, all constants, step execution order, error handling table (caught vs propagated), stubs needed per step, helpers quick-reference. Read this before writing behavioural tests instead of re-reading handler.js. |

---

## 3-Step Audit Flow

### Step 1: importTopPages (Immediate)
- **Entry point**: AuditBuilder step 1
- **What it actually does**: Returns a trigger config object `{ type: 'top-pages', siteId, fullAuditRef }` — fetches **no URLs itself**
- **Import worker boundary**: The `type: 'top-pages'` return value signals the framework to run the `spacecat-import-worker` before step 2 fires. The import worker fetches top pages from GSC and writes them to the `SiteTopPage` DB table. Step 2 then reads this freshly populated table via `getTopOrganicUrlsFromSeo`.
- **Why URLs cannot be fetched in step 1**: `SiteTopPage` is only fresh after the import worker completes. Reading it in step 1 would return stale data from the previous import run.
- **CSV + AI-only exception**: If `auditContext.urls` is set (CSV mode), those URLs are passed forward in `auditContext`. If `mode === MODE_AI_ONLY`, step 1 handles it entirely and exits early (no import needed).

### Step 2: submitForScraping (Deferred via SQS, fires after import worker completes)
- **Entry point**: AuditBuilder step 2 (if auditContext.next === "submitForScraping")
- **Three code paths** (each handles URL sourcing and filtering differently):
  1. **CSV path**: `auditContext.urls` present → rebase to preferredBase → mergeAndGetUniqueHtmlUrls → return. Does NOT read status.json.
  2. **Slack path**: `auditContext.slackContext.channelId` set → organic + includedURLs only → mergeAndGetUniqueHtmlUrls. No PageCitability dedup, no edge-deployed filter, no DAILY_BATCH_SIZE cap, no bot-block check.
  3. **Normal scheduled path**: bot-block sticky check first → organic + agentic + includedURLs → filter each source independently by PageCitability 7-day dedup AND edgeDeployedPathnames → concat in priority order (organic → included → agentic) → slice to DAILY_BATCH_SIZE=320 → mergeAndGetUniqueHtmlUrls
- **Bot-block sticky check**: Normal path only, happens BEFORE any URL fetching. Slack bypasses so operators can force re-scrape.
- **edgeDeployedPathnames**: Read from `status.json pages[].isDeployedAtEdge` (previous scrape result on S3) — not from DB
- **Priority ordering**: URL sources are concatenated in order `[organic, includedURLs, agentic]` — not sorted. Slice to 320 preserves this ordering.
- **Scrape job creation**: Uses `ScrapeClient.createScrapeJob()` (spacecat-content-scraper)
- **S3 results**: Stored as `prerender/scrapes/{scrapeJobId}/{sanitizedPath}/scrape.json` + HTML files

### Step 3: processContentAndGenerateOpportunities (Deferred via SQS)
- **Entry point**: AuditBuilder step 3 (if auditContext.next === "processContentAndGenerateOpportunities")
- **Primary input**: `context.scrapeResultPaths` — a `Map<url, pathInfo>` populated automatically by AuditBuilder via `scrapeClient.getScrapeResultPaths(scrapeJobId)` before this step fires.
- **When scrapeResultPaths is empty**: All submitted URLs had `FAILED` status in the scraper. A warning (`"No COMPLETE scrape results"`) is logged and URL comparison is skipped (`urlsToCheck` stays empty). `getScrapeJobStats` handles these FAILED URLs via the `ScrapeUrl` DB and populates `missingPages`, so `status.json` records the correct failed URLs without phantom error entries. See [D-21](.claude/decision-log.md).
- **Operations** (actual execution order):
  1. **`detectWrongEdgeDeployedStatus`** (diagnostic): Warns if any non-NEW suggestions have `edgeDeployed` set — runs unconditionally at step entry, even when no prerender URLs are found
  2. **`isPaidLLMOCustomer`** check: read once, used in all subsequent logs
  3. **isDomainBlocked short-circuit**: If `auditContext.domainBlocked=true`, skip HTML comparison and set `comparisonResults = []`
  4. **HTML comparison** (`compareHtmlContent` per URL in parallel): downloads server-side.html + client-side.html + scrape.json from S3; computes contentGainRatio; content gain ≥ 1.1 → needsPrerender
  5. **`writeToCitabilityRecords`**: Writes ALL comparison fields to PageCitability (citabilityScore, contentRatio, wordDifference, botWords, normalWords, isDeployedAtEdge) in batches of 10. Only non-error results written.
  6. **`getScrapeJobStats`**: Computes urlsSubmittedForScraping + scrapeForbiddenCount + missingPages + submittedUrlSet. Returns `submittedUrlSet` (Set of URLs from ScrapeUrl DB) used later by uploadStatusSummaryToS3 to assign scrapeJobId per page.
  7. **Bot-block reactive check**: `ratio403 = scrapeForbiddenCount / urlsSubmittedForScraping`. If `ratio403 ≥ 0.5` → call `detectBotBlocker()` → check `isKnownBotBlockerResult()` (confidence ≥ 0.99 AND type in `KNOWN_BOT_BLOCKER_TYPES`). If confirmed → `scrapeForbidden=true`, `scrapeForbiddenSince=now`.
  8. **`scrapedUrlsSet` construction**: Built from pathnames of successful comparisons that are NOT edge-deployed. Implemented as a wrapper object `{ has: (url) => pathnames.has(toPathname(url)) }` (not a plain `Set`) so domain-shifted suggestions (`www.example.com/page` vs `example.com/page`) are still matched and marked OUTDATED correctly.
  9. **Three-way opportunity branch**:
     - **Branch A** (`urlsNeedingPrerender.length > 0`): Call `processOpportunityAndSuggestions` (find/create opportunity, domain-wide aggregate, syncSuggestions), then send to Mystique
     - **Branch B** (`scrapeForbidden=true`, no URLs needing prerender): Call `createScrapeForbiddenOpportunity` — dummy opportunity with no suggestions so UI can display blocked state
     - **Branch C** (no URLs, not blocked): Look for existing NEW opportunity. If found, call `syncSuggestions` with `newData=[]` and `scrapedUrlsSet` augmented with the domain-wide pathname — this marks all currently-found suggestions OUTDATED
  10. **`markNewSuggestionsAsCovered`**: Find domain-wide suggestion with `edgeDeployed` set → mark NEW suggestions for edge-deployed URLs as `coveredByDomainWide`. Matching uses `deployedAtEdgePathnames` (a `Set` of pathnames) so domain-shifted suggestions are covered correctly.
  11. **`uploadStatusSummaryToS3`**: Reads existing status.json, merges current pages with prior pages (URLs not in current run are preserved), computes aggregate metrics from merged page set, writes to S3
  12. **Error path**: On any uncaught exception → uploads `lastAuditSuccess=false` status.json before returning error result (D-12)

---

## Cross-Repo Interactions

### spacecat-content-scraper (ScrapeClient → PrerenderHandler)
- **Used in**: step 2 (submitForScraping)
- **Method**: `ScrapeClient.createScrapeJob({ urls, processingType: 'prerender', maxScrapeAge, metaData })`
- **processingType MUST be `'prerender'`** — the scraper's `PrerenderHandler.accepts()` checks for this exact string
- **S3 outcomes**: scraper writes per-URL at `prerender/scrapes/{scrapeJobId}/{sanitizedPath}/{file}`
- **Risk**: scrapeJobId derivation — fallback chain (data.scrapeJobId → extract from originalHtmlKey path[2] → null) must be preserved exactly
- **Integration point**: step 2 → step 3 via scrapeJobId stored in status.json

### mystique (AI Summarizer)
- **Used in**: step 3 (processContentAndGenerateOpportunities)
- **Outbound queue**: SQS `guidance:prerender` — audit sends candidates list; non-blocking
- **Batch interface**: `MYSTIQUE_BATCH_SIZE` (config value, constraint-based, not DAILY_BATCH_SIZE)
- **Payload**: URLs + context for `ai-summary` generation; **must include `suggestionId`** — Mystique parses it via Pydantic and fails validation if absent
- **Response delivery (inbound)**: Mystique writes AI summaries to S3, then sends an SQS message back to the audit worker with `{ siteId, data: { presignedUrl, opportunityId } }`. The handler (`guidance-handler.js`) downloads the payload from the presigned URL — the AI summaries are NOT in the SQS body.
- **Presigned URL safety**: `fetchAnalysisFromPresignedUrl` enforces: SSRF guard (S3 allowlist, HTTPS only), 10 MB DoS cap on response body, and query-string scrub before any CloudWatch logging so `X-Amz-Signature` never leaks
- **S3 key construction**: Mystique uses `scrapeJobId` from when the suggestion was first created to build markdown S3 paths — always pass per-suggestion scrapeJobId, never the current run's ID
- **Limitation**: Known TODO — batch size constraints affect throughput for sites with 200+ opportunities
- **AI-only mode**: `MODE_AI_ONLY=true` skips scraping, uses existing HTML, respects `MYSTIQUE_BATCH_SIZE` only

### spacecat-api-service (Domain-Wide Suggestion Rollback)
- **Used in**: step 3 (syncSuggestions)
- **Scenario**: User marks a domain-wide suggestion APPROVED via UI → API calls PUT /sites/:id/suggestions/:id
- **Handler receives**: `data.isDomainWide=true` in rollback check
- **Logic**: If domain-wide suggestion has status NEW/FIXED/PENDING_VALIDATION/SKIPPED or `edgeDeployed` set, subsequent audit runs preserve it (see `shouldPreserveDomainWideSuggestion`)
- **Locked contract**: Cannot change domain-wide suggestion data.url, data.isDomainWide, data.coveredByDomainWide fields

### project-elmo-ui (Status & Suggestion Display)
- **Reads**: status.json from S3 (prerender/scrapes/{siteId}/status.json)
- **Fields consumed**: `urlsNeedingPrerender[]`, `scrapingErrorRate`, `pages[]` (per-URL status/metadata)
- **Also reads**: Suggestion.data fields from Spacecat DB (15 fields, listed below)
- **Locked contract**: Cannot change any of these fields without coordinating UI update

---

## Database Entities

### PageCitability (Core)
- **Purpose**: 7-day dedup window for URLs submitted to scraper
- **Fields**: siteId, url, timestamp (created)
- **TTL**: 7 days (hardcoded in step 2 filter logic)
- **Cleanup**: Handled externally (not in prerender handler)
- **Usage**: Step 2 queries recent PageCitability records to exclude URLs from daily batch

### Opportunity
- **Link**: Created/updated during step 3 (processContentAndGenerateOpportunities)
- **Statuses**: NEW, APPROVED, FIXED, OUTDATED
- **Lifecycle**: One per site (domain-wide aggregate for prerender audit)
- **Protection**: OUTDATED only if suggestion's pathname is in scrapedUrlsSet AND not edgeDeployed AND not coveredByDomainWide AND not isDomainWide

### Suggestion (Domain-Wide Aggregate)
- **Type**: `prerender`
- **Pattern**: Special case — single site-wide suggestion with url=baseUrl+`/*` and pathPattern=`/*`
- **Key**: DOMAIN_WIDE_SUGGESTION_KEY (internal constant)
- **Lifecycle states**: NEW → FIXED/PENDING_VALIDATION (after deploy) → preserved in future audits; OUTDATED if replaced
- **Locked fields** (15 total, cannot change without multi-repo coordination):
  - `url` — baseUrl (cannot be modified)
  - `contentGainRatio` — word count ratio metric
  - `wordCountBefore` — server-rendered word count
  - `wordCountAfter` — client-rendered word count
  - `edgeDeployed` — site uses edge deployment
  - `isDomainWide` — always true for this suggestion
  - `coveredByDomainWide` — set if another domain-wide suggestion applies
  - `scrapeJobId` — ID for audit run that generated this
  - `originalHtmlKey` — S3 path to server-rendered baseline
  - `prerenderedHtmlKey` — S3 path to client-rendered result
  - `aiSummary` — AI-generated summary from Mystique
  - `valuable` — boolean indicating business value
  - Plus 3 internal fields: `pathPattern`, `isDomainWide`, `edgeDeployed` (metadata)

### Audit
- **Logs**: Audit start/end times, result summary
- **Referenced by**: Domain-wide suggestion createdBy/updatedBy (audit ID)

---

## Daily Batch Mechanics

→ See [batch-mechanics.md](.claude/batch-mechanics.md)  
Read when: the three `submitForScraping` paths (CSV/Slack/Normal), PageCitability dedup window, DAILY_BATCH_SIZE, `isFirstRunOfCycle`, metrics logs, or `handleAiOnlyMode` internals.

---

## Bot-Block Detection

Two-stage protection against scraped domains blocking requests. Root cause analysis of 311,086 scrape failures showed 10.4% (32,333) were HTTP 403 bot-blocks with no per-domain detection — this drove the two-stage approach.

### Stage 1: Sticky Check (Pre-Scrape)
- **Trigger**: Step 2 (submitForScraping) reads status.json from previous audit
- **Condition**: If `scrapeForbidden=true` AND `scrapeForbiddenSince` within 3 days, skip scraping
- **Rationale**: Domain remains hostile; don't waste quota
- **Reset**: After 3 days, bot-block flag expires and site re-evaluated

### Stage 2: Reactive Detection (Post-Scrape)
- **Trigger**: Step 3 (processContentAndGenerateOpportunities)
- **Two-step check** (both conditions must be satisfied):
  1. `scrapeForbiddenCount / urlsSubmittedForScraping >= 0.5` (rate gate — fast, no network call)
  2. Only if rate gate passes: call `detectBotBlocker({ baseUrl })` from `@adobe/spacecat-shared-utils`, then check `isKnownBotBlockerResult()`:
     - `crawlable === false`
     - `confidence >= 0.99`
     - `type` is in `KNOWN_BOT_BLOCKER_TYPES = ['cloudflare', 'imperva', 'akamai', 'fastly', 'cloudfront']`
- **Action**: If both conditions pass → `scrapeForbidden=true`, `scrapeForbiddenSince=new Date().toISOString()`
- **Storage**: Persisted in status.json; sticky check reads these in next step 2

### getScrapeJobStats() Internals
- **COMPLETE status, 403 errors**: Counted from in-memory scrape job metadata
- **FAILED status, 403 errors**: Loaded from DB + S3 scrape.json (slower path) — added in #2245 because `getScrapeResultPaths` only returns COMPLETE URLs; FAILED-status 403s were invisible to bot-block detection until this path was added
- **Known limitation**: Mystique batch size may cause timeouts for sites with 200+ opportunities (TODO documented in code)

### isDomainBlocked Flag
- **Set by**: Previous audit, if domain-wide bot-block detected
- **Effect**: Step 3 receives flag and **skips all syncSuggestions** (hard stop)
- **Rationale**: If domain is completely blocked, generating suggestions is noise
- **Recovery**: isDomainBlocked persists until manually cleared or 3-day window expires

---

## S3 Schemas & Locked Path Contracts

→ See [system-interactions.md](.claude/system-interactions.md) § 9  
Read when: `sanitizeImportPath` regex, `scrape.json` or `status.json` full schemas, `scrapeJobId` fallback chain, `uploadStatusSummaryToS3` merge behaviour, URL normalization for suggestion lookup.

---

## Suggestion Data Fields & Lifecycle

→ See [suggestion-lifecycle.md](.claude/suggestion-lifecycle.md)  
Read when: per-URL or domain-wide Suggestion.data field schemas, Golden Rules, all suggestion statuses, audit worker writes, OUTDATED marking, domain-wide preservation logic, or domain-wide aggregate SUM computation.

---

## AI-Only Mode (MODE_AI_ONLY)

**Config**: `MODE_AI_ONLY=true` environment variable  
**Effect**: Skips step 2 entirely, processes existing HTML through Mystique only.

### Flow
```
Step 1: importTopPages (normal)
Step 2: SKIPPED (no scraping)
Step 3: processContentAndGenerateOpportunities (uses cached HTML, queues all URLs to Mystique)
```

### Batch Size Switch
- **Normal mode**: `DAILY_BATCH_SIZE=320` (limits scraper submission)
- **AI-only mode**: `MYSTIQUE_BATCH_SIZE` only (AI throughput constraint)
- **Rationale**: Without scraping quota pressure, AI batch size is the limiting factor

### Use Cases
1. Testing AI summarizer without consuming scrape quota
2. Re-processing a site after Mystique updates (e.g., new prompt, model change)
3. Rapid iteration on suggestion text/criteria without scraping overhead
4. Quota exhaustion recovery (re-analyze with existing HTML)

---

## Key Invariants (Must Not Change)

These invariants ensure data consistency across the audit system:

1. **scrapedUrlsSet excludes edge-deployed URLs**: `isDeployedAtEdge=true` filtered before scraping; excluded from OUTDATED checks — root cause of 37.8% of all scrape failures was queuing URLs already 404/deployed
2. **scrapeJobId 3-level fallback**: Always check (data.scrapeJobId → extract from path → null) in this order — Mystique constructs S3 paths using the scrapeJobId from when the suggestion was *first created*, not the current run; using the wrong ID causes NoSuchKey
3. **scrapeJobId on Suggestion.data is write-once**: Never overwrite an existing scrapeJobId; fallback mode was stamping the current run's ID on all suggestions including ones from previous batches, breaking their S3 lookups
4. **Domain-wide suggestion preservation**: NEW, FIXED, PENDING_VALIDATION, SKIPPED, or edgeDeployed set → not overwritten by new audit (see `shouldPreserveDomainWideSuggestion`)
5. **isDomainBlocked skips syncSuggestions entirely**: Hard stop; no partial logic, no edge cases
6. **status.json sticky flags**: scrapeForbidden + scrapeForbiddenSince must persist across audits (read in next step 2)
7. **PageCitability dedup window**: 7 days, hardcoded (not configurable); changing requires data model migration
8. **Bot-block thresholds**: 403 ratio ≥ 0.5 AND confidence ≥ 0.99 (both required; neither is negotiable) — calibrated from 311K failure analysis
9. **isAllDomainDeployedAtEdge must skip OUTDATED suggestions**: Production had 14 OUTDATED domain-wide suggestions before the 1 active NEW one; `find()` without OUTDATED filter returned the wrong suggestion → `edgeDeployed` was undefined → function returned false incorrectly
10. **Don't send FIXED or edgeDeployed suggestions to Mystique**: UI never displays AI summaries for deployed/fixed suggestions; sending them generates summaries that are never surfaced
11. **Suggestion keys are pathname-based**: `buildKey` produces `pathname|prerender` (e.g. `/products|prerender`), not full URL. `scrapedUrlsSet.has()` and `deployedAtEdgePathnames` also normalize via `toPathname`. Never revert to full-URL keying — this was the root cause of 10,657 duplicate suggestions across 100 paying customers after the page-citability migration changed `getPreferredBaseUrl()` to return a different domain. See [D-22](.claude/decision-log.md).

---

---

## Testing Strategy & Entry Points

### Behavioral Contract Tests
These 21 test cases verify observable behavior. Any change to the system must keep all 21 green:

1. **Bot-block detection**: ratio403 ≥ 0.5 + confidence ≥ 0.99 → sets scrapeForbidden
2. **Sticky bot-block**: scrapeForbiddenSince within 3-day window → skips scraping, S3 PUT with scrapeForbidden=true
3. **isDomainBlocked forwarding**: step 3 receives isDomainBlocked → skips syncSuggestions
4. **Domain-wide suggestion preserved**: ACTIVE_STATUSES → suggestion not overwritten
5. **Domain-wide suggestion preserved (edgeDeployed)**: edgeDeployed=true → suggestion preserved
6. **scrapedUrlsSet exclusion**: isDeployedAtEdge URLs excluded → prevents false-positive OUTDATED
7. **Daily batch dedup**: URLs processed in last 7 days skipped
8. **scrapeJobId 3-level fallback**: Order preserved (data → path extract → null)
9. **AI-only mode batch sizing**: MODE_AI_ONLY=true uses MYSTIQUE_BATCH_SIZE (= DAILY_BATCH_SIZE = 320)
10. **getScrapeJobStats() counting**: COMPLETE-status + FAILED-status + S3 scrape.json reads
11. **Empty scrapeResultPaths warning**: `scrapeResultPaths.size === 0` → logs `"No COMPLETE scrape results"` warning, skips comparison, returns `status: complete`
12. **Pathname-keyed suggestions (no domain-shift duplicates)**: `buildKey` on `www.adobe.com/test` and `adobe.com/test` produces the same key `/test|prerender` — `syncSuggestions` updates in place, no duplicate created
13. **Branch B (scrapeForbidden opportunity)**: `scrapeForbidden=true` + no prerender URLs → `createScrapeForbiddenOpportunity` called, `syncSuggestions` NOT called
14. **markDeployedUrlSuggestionsAsCovered**: domain-wide suggestion with `status === NEW` AND `edgeDeployed` set → per-URL NEW suggestions matching `deployedAtEdgePathnames` get `coveredByDomainWide` set; OUTDATED/FIXED domain-wide suggestions do NOT trigger coverage (D-04)
15. **D-12 error path**: uncaught exception in step 3 → `uploadStatusSummaryToS3` still called with `lastAuditSuccess=false` in `auditResult`
16. **User-action status protection (syncSuggestions)**: suggestions with SKIPPED, APPROVED, FIXED, REJECTED, or IN_PROGRESS status are NEVER marked OUTDATED by the audit worker — these are user-set statuses (Case 4 in sync-suggestions.test.js)
17. **data-flag OUTDATED protection**: suggestions with `data.edgeDeployed` or `data.coveredByDomainWide` set are NOT marked OUTDATED even when their URL was scraped (Case 4b/4c in sync-suggestions.test.js)
18. **Branch C with no existing opportunity**: when `urlsNeedingPrerender=0` and no NEW prerender opportunity exists, `syncSuggestions` is NOT called and audit completes normally
19. **Slack mode skips agentic fetch**: Slack-triggered runs call `getTopOrganicUrlsFromSeo` + `getIncludedURLs` only — `getTopAgenticUrls` is NEVER called
20. **Mystique SQS not sent for Branch B/C**: `scrapeForbidden=true` (Branch B) or no prerender URLs (Branch C) → `sendPrerenderGuidanceRequestToMystique` NOT called, SQS message NOT sent
21. **guidance-handler skips OUTDATED suggestions**: when Mystique response arrives, OUTDATED suggestions are excluded from the URL→suggestion map before any `aiSummary`/`valuable` updates

**Full test structure, helper reference, and rules for where to add new tests:**
→ [`test/audits/prerender/CLAUDE.md`](../../../test/audits/prerender/CLAUDE.md)

---

## Key Internal Function Behaviours

### Mystique candidateId in Normal Audit Runs

In `processOpportunityAndSuggestions`, `auditRunCandidates` is built as:
```js
{ suggestionId: s.url, url: s.url, originalHtmlMarkdownKey, markdownDiffKey }
```
`suggestionId` is set to the **URL string**, not a DB UUID. The guidance-handler matches Mystique responses back to suggestions by URL. Only in ai-only mode (`handleAiOnlyMode`) is `suggestionId` the actual DB suggestion UUID (because ai-only derives candidates from existing DB suggestions).

### detectWrongEdgeDeployedStatus — Diagnostic Guard

Called unconditionally at step 3 entry before any comparison:
```js
Opportunity.allBySiteIdAndStatus(siteId, 'NEW')
  → find prerender opportunity
  → getSuggestions()
  → count suggestions where status !== NEW && data.edgeDeployed
  → if count > 0 → log.warn (invariant violation)
```
This is a diagnostic-only function — it logs but does not modify any data. It fires even when the domain is bot-blocked or when scrapeResultPaths is empty.

---

## Locked External Contracts Summary

**Do NOT change without coordinated multi-repo PRs:**

| Contract | Owner | Impact | Workaround |
|----------|-------|--------|-----------|
| status.json schema | project-elmo-ui | UI cannot parse updated fields | Deprecation period + dual-read |
| Suggestion.data (15 fields) | spacecat-api-service | Rollback logic breaks | Versioned data structures |
| S3 path format (sanitizeImportPath) | prerender-audit logic | Historical lookups fail | Data migration script |
| scrapeJobId fallback chain | prerender-audit persistence | Cannot re-link audits | Maintain fallback order forever |
| ACTIVE_STATUSES list | user approval workflows | Suggestions overwritten incorrectly | API coordination for new statuses |
| pagePatternCitability 7-day window | dedup logic | Breaks idempotency | Data model migration required |
| Bot-block thresholds (0.5 / 0.99) | domain protection | Too strict/permissive | Feature flag + gradual rollout |

---

## Key Decision Points for Future Development

### When Adding AI-Only Mode Feature
1. Check all 4 places where MODE_AI_ONLY is checked (centralize if possible)
2. Switch batch size logic from DAILY_BATCH_SIZE → MYSTIQUE_BATCH_SIZE
3. Ensure step 2 is completely skipped (no partial scraping)
4. Add test for mode override behavior

### When Changing Suggestion Lifecycle
1. Verify ACTIVE_STATUSES is not hardcoded elsewhere
2. Coordinate with spacecat-api-service team (they read .isDomainWide field)
3. Update project-elmo-ui if status display logic changes
4. Test domain-wide suggestion preservation across audit runs

---

## Codebase Organization

```
src/prerender/
├── handler.js (1,875 lines, 3-step StepAudit)
├── utils/
│   ├── utils.js (shared utilities, normalizePathname here)
│   ├── bot-block-detector.js
│   └── suggestion-filtering.js
├── test/
│   ├── handler.test.js (335 test cases)
│   ├── ... (audit-specific tests)
```

---

## spacecat-content-scraper Internals

→ See [scraper-internals.md](.claude/scraper-internals.md)  
Read when: debugging scraper output format, bot-protection detection, edge deployment detection, markdown file generation, shadow DOM handling.

---

## Shared Packages

→ See [shared-packages.md](.claude/shared-packages.md)  
Read when: `html-analyzer` word counting, `ScrapeClient` job submission API, `PageCitability`/`ScrapeJob`/`ScrapeUrl` DB entities, `TokowakaClient.deployToEdge()` and Tokowaka S3 config structure.

---

## UI Data Map

→ See [ui-data-map.md](.claude/ui-data-map.md)  
Read when: changing `status.json` schema, `Suggestion.data` field names, tab filter logic, `avgLlmVisibilityScore` formula, or `PrerenderOpportunitySection` UX flows.

---

## API Service — Deploy & Rollback

→ See [api-service-deploy-rollback.md](.claude/api-service-deploy-rollback.md)  
Read when: understanding what writes `edgeDeployed` / `coveredByDomainWide` / `tokowakaDeployed`, how rollback clears them, access control guards, or geo-experiment mode behavior.

---

## Contacts & Escalation

**Mystique Integration Issues**: Check mystique/CLAUDE.md for batch size constraints and SQS failure scenarios.  
**S3 Storage Issues**: Validate S3 path format matches sanitizeImportPath regex before storage.  
**Test Infrastructure Issues**: 115 esmock instantiations in `handler.test.js` — any path or export name change requires updating all affected stubs.  
**Database Model Changes**: Cannot modify Suggestion.data without spacecat-api-service and project-elmo-ui coordination.

---
