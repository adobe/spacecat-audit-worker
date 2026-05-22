# Prerender Behaviour Tests — Index

87 tests across 13 files. No esmock except `mystique-round-trip.test.js` (guidance-handler inbound).
All tests use helpers from `helpers.js`; read that file before adding new tests.

Run the full suite:
```
npm run test:spec -- test/audits/prerender/behaviour/
```

---

## File Map

| File | Step(s) | What it owns |
|------|---------|--------------|
| [ai-only-mode.test.js](#ai-only-modetestjs) | 1 2 3 | MODE_AI_ONLY skip + happy/failure paths |
| [bot-block.test.js](#bot-blocktestjs) | 2 3 | Stage 1 sticky check + Stage 2 reactive detection |
| [data-integrity.test.js](#data-integritytestjs) | 3 | status.json shape, PageCitability create/update |
| [early-exits.test.js](#early-exitstestjs) | 3 | isDomainBlocked, all-error, FAILED-URL 403 counting |
| [error-resilience.test.js](#error-resiliencetestjs) | 3 | partial S3 failure, DB throws, D-12 outer catch |
| [mode-routing.test.js](#mode-routingtestjs) | 1 2 | CSV / Slack / normal mode dispatch |
| [mystique-round-trip.test.js](#mystique-round-triptestjs) | 3 | SQS outbound (Branch A/B/C) + ai-only filtering + inbound guidance-handler |
| [opportunity-creation.test.js](#opportunity-creationtestjs) | 3 | Branch A/B/C opportunity + suggestion data shape |
| [realistic-scenarios.test.js](#realistic-scenariostestjs) | 3 | **High-importance** compound scenarios: multiple invariants in a single run |
| [scrape-error-safety.test.js](#scrape-error-safetytestjs) | 3 | errored URLs excluded from scrapedUrlsSet / OUTDATED |
| [suggestion-lifecycle.test.js](#suggestion-lifecycletestjs) | 3 | OUTDATED, merge, preservation, coveredByDomainWide, D-04 |
| [url-selection.test.js](#url-selectiontestjs) | 2 | PageCitability dedup, edge-deployed exclusion, CSV filtering |

---

## ai-only-mode.test.js

**Describe**: `Prerender behaviour — AI-only mode`

| Test | Contract |
|------|----------|
| Step 2: data.mode=ai-only → returns skipped immediately, S3 never read | Step 2 exits before any I/O in ai-only mode |
| Step 3: data.mode=ai-only → returns skipped immediately, no opportunity lookup | Step 3 exits before any I/O in ai-only mode |
| Step 1: scrapeJobId in data + NEW opportunity found → status=complete, mode=ai-only | Happy path: step 1 sends to Mystique, returns complete |
| Step 1: no scrapeJobId in data or status.json → status=failed | Failure: no job ID available |
| Step 1: scrapeJobId found but no NEW prerender opportunity exists → status=failed | Failure: no opportunity to re-process |

---

## bot-block.test.js

**Describe**: `Prerender behaviour — bot-block`

### Stage 1: sticky pre-scrape check (Step 2)

| Test | Contract |
|------|----------|
| scrapeForbiddenSince within 3-day window → returns empty urls and domainBlocked flag | Sticky block active → skip scrape |
| scrapeForbiddenSince older than 3 days → sticky block expires, proceeds to scrape | 3-day window expiry |
| scrapeForbidden=false → no sticky block regardless of scrapeForbiddenSince | scrapeForbidden=false disables sticky check |
| scrapeForbidden=true but scrapeForbiddenSince absent → treated as no block | Missing timestamp = no block |

### Stage 2: reactive post-scrape detection (Step 3)

| Test | Contract |
|------|----------|
| ratio≥0.5 + confidence≥0.99 + known CDN → writes scrapeForbidden=true to status.json | Both conditions met → block written |
| ratio≥0.5 + known CDN but confidence<0.99 → no block | Confidence gate (0.99) |
| ratio<0.5 → detectBotBlocker never called, no block written | Rate gate (0.5) |
| detectBotBlocker throws → warning logged, no block, audit completes | Error resilience |
| ratio=0.5 exactly (2 of 4 URLs are 403) → rate gate passes, detectBotBlocker called, block written | Boundary: ratio=0.5 is inclusive |
| ratio≥0.5 + confidence≥0.99 but CDN type unknown → isKnownBotBlockerResult=false, block NOT written | Unknown CDN type does not trigger block |

---

## data-integrity.test.js

**Describe**: `Prerender behaviour — data integrity (Step 3)`

| Test | Contract |
|------|----------|
| status.json merges current pages with prior pages not in the current scrape run | Merge strategy: prior pages preserved |
| scrapeForbidden=true persists in status.json when set by reactive detection (isDomainBlocked) | scrapeForbidden written via isDomainBlocked path |
| scrapeJobId from auditContext is written to status.json | Top-level scrapeJobId field |
| failed URL scrape is recorded with scrapingStatus=error in status.json page entry | Per-page error status |
| getScrapeJobStats falls back to urlsToCheck count when ScrapeUrl is unavailable | ScrapeUrl entity absent → fallback count |
| scrape.json absent from S3 → comparison still runs, isDeployedAtEdge defaults to false | Missing scrape.json → graceful default |
| scrapeForbiddenSince from prior status.json is preserved when the current audit has no bot-block | Sticky window survives clean audits (invariant #6) |
| S3 path contract: handler reads HTML from canonical scrapeJobId + sanitized-pathname keys | Key construction via sanitizeImportPath |

**Describe**: `Prerender behaviour — PageCitability writes (Step 3)`

| Test | Contract |
|------|----------|
| successful comparison URLs are written to PageCitability as 7-day dedup records | Create path: non-error URLs → create() |
| writeToCitabilityRecords: 11 successful URLs are all written (WRITE_BATCH_SIZE=10 → two batches) | Batching: 11 URLs → two Promise.all batches |
| errored URLs are NOT written to PageCitability | Error results excluded from writes |
| URL already in PageCitability → existing record updated via save(), not create() | Update path: existing record → setters + save() |

---

## early-exits.test.js

**Describe**: `Prerender behaviour — early exits (Step 3)`

| Test | Contract |
|------|----------|
| isDomainBlocked=true → S3 HTML never read, scrapeForbidden=true written to status.json | isDomainBlocked skips HTML comparison entirely |
| all HTML comparisons error (S3 returns null) → audit completes with zero successful scrapes | All-error path completes without crash |
| getScrapeJobStats counts 403s from FAILED-status URLs via S3 scrape.json | FAILED-status 403s included in scrapeForbiddenCount via ScrapeUrl DB |

---

## error-resilience.test.js

**Describe**: `Prerender behaviour — error resilience (Step 3)`

| Test | Contract |
|------|----------|
| partial S3 HTML failure — one URL missing, one present → urlsScrapedSuccessfully=1 | Per-URL errors don't fail the whole audit |
| ScrapeUrl.allByScrapeJobId throws → getScrapeJobStats falls back, audit completes | DB exception in getScrapeJobStats → fallback count |
| S3 PutObject failure on status.json upload → log.error called, audit still returns complete | uploadStatusSummaryToS3 catches internally, does not rethrow |
| uncaught exception in step 3 outer try → D-12 catch writes lastAuditSuccess=false to status.json | D-12: outer catch logs + writes error status |
| Opportunity.create rejects (Branch A) → handler catches error, logs it, does not crash Lambda | convertToOpportunity failure is caught internally |

---

## mode-routing.test.js

**Describe**: `Prerender behaviour — mode routing`

### Step 1: importTopPages

| Test | Contract |
|------|----------|
| normal mode returns a top-pages trigger object | Normal step 1 output shape |
| CSV mode forwards urls in the trigger so the import worker preserves them | auditContext.urls forwarded |
| empty auditContext.urls is treated the same as no urls (no auditContext forwarded) | Empty array not forwarded |

### Step 2: submitForScraping

| Test | Contract |
|------|----------|
| CSV mode returns rebased URLs immediately and never reads status.json | CSV bypasses status.json read |
| CSV mode does not set domainBlocked even when status.json would show scrapeForbidden | CSV bypasses sticky bot-block |
| Slack mode bypasses the sticky bot-block check so operators can force a re-scrape | Slack bypasses sticky check |
| Slack mode does not apply PageCitability dedup or DAILY_BATCH_SIZE cap | Slack: no dedup, no cap |
| normal mode reads status.json before deciding whether to scrape | Normal reads status.json |

---

## mystique-round-trip.test.js

**Describe**: `Prerender behaviour — Mystique round-trip (outbound)`

| Test | Contract |
|------|----------|
| Branch A: SQS message sent to Mystique queue with type=guidance:prerender and data.suggestions | Branch A → SQS payload shape |
| Branch B (isDomainBlocked=true / scrapeForbidden) → Mystique SQS message NOT sent | Branch B → no SQS |
| Branch C (no prerender URLs): SQS message NOT sent to Mystique | Branch C → no SQS |

**Describe**: `Prerender behaviour — Mystique outbound (ai-only filtering)`

| Test | Contract |
|------|----------|
| ai-only: FIXED suggestion excluded from Mystique SQS message | D-07: FIXED filtered in ai-only mode |
| ai-only: suggestion with originalHtmlKey but no scrapeJobId → scrapeJobId derived from S3 path (fallback path 2) | Invariant #2 fallback: extract job from originalHtmlKey |
| ai-only: suggestion with neither scrapeJobId nor originalHtmlKey → skipped with warn (fallback path 3) | Invariant #2 fallback: no ID → skip + warn |
| ai-only: edgeDeployed suggestion excluded from Mystique SQS message | D-07: edgeDeployed filtered in ai-only mode |

**Describe**: `Prerender behaviour — Mystique round-trip (inbound: guidance-handler)`

| Test | Contract |
|------|----------|
| valid aiSummary → aiSummary AND valuable both updated in DB | Successful inbound: both fields written |
| valid aiSummary with valuable=false → both updated, valuable=false persisted | valuable=false is persisted (not treated as falsy/absent) |
| aiSummary absent in response → existing aiSummary AND valuable both preserved | "Not Available" response → preserve prior values |
| OUTDATED suggestion is excluded from update even when URL matches | OUTDATED suggestions skipped on inbound |
| URL in Mystique response not in DB → warning logged, other suggestions still processed | Unknown URL: warn + continue |
| missing presignedUrl in message → badRequest response | Validation: 400 on missing presignedUrl |
| missing opportunityId in message → badRequest response | Validation: 400 on missing opportunityId |
| opportunity not found in DB → notFound response | Validation: 404 on unknown opportunityId |

---

## opportunity-creation.test.js

**Describe**: `Prerender behaviour — opportunity creation (Branch A + B)`

| Test | Contract |
|------|----------|
| Branch A: suggestion data contains url, word counts, contentGainRatio, and S3 HTML keys | Per-URL suggestion data shape including S3 key contract |
| Branch A: domain-wide aggregate suggestion is included alongside per-URL suggestions | Domain-wide added to allSuggestions in Branch A |
| Branch B: opportunity created with scrapeForbidden=true and scrapeForbiddenCount in data | Branch B opportunity.data shape |
| Branch C with no existing opportunity: no OUTDATED marking attempted | Branch C + no opportunity → no bulkUpdateStatus |
| Branch B: createScrapeForbiddenOpportunity runs convertToOpportunity without per-URL suggestions | Branch B: addSuggestions never called |

---

## scrape-error-safety.test.js

**Describe**: `Prerender behaviour — scrape error safety`

| Test | Contract |
|------|----------|
| 100% scraping error → no suggestions marked OUTDATED | Error results excluded from scrapedUrlsSet → no OUTDATED |
| Partial error — errored URL suggestion NOT OUTDATED, successfully scraped URL IS OUTDATED | Error URLs excluded; successful URLs eligible for OUTDATED |

---

## suggestion-lifecycle.test.js

**Describe**: `Prerender behaviour — suggestion lifecycle (Step 3)`

| Test | Contract |
|------|----------|
| Branch C: no prerender URLs + existing opportunity → suggestions marked OUTDATED | Branch C marks non-domain-wide suggestions OUTDATED |
| edge-deployed URL excluded from scrapedUrlsSet → its suggestion NOT marked OUTDATED | isDeployedAtEdge=true → excluded from OUTDATED eligibility (invariant #1) |
| domain-wide suggestion with status=NEW is preserved across audit runs (Branch C) | Domain-wide skipped by handleOutdatedSuggestions in Branch C |
| Branch A merge: Mystique fields (aiSummary, valuable) survive a re-scrape audit | Individual merge: existingData spread before new fields → AI fields preserved |
| Branch A merge: domain-wide suggestion data is fully replaced (not merged) on update | Domain-wide merge: full replacement, no canary field survives |
| Branch A: existing suggestion matched by URL key is updated in-place, not duplicated | buildKey dedup: saveMany called, no addSuggestions duplicate |
| audit worker does not change suggestion status during a normal Branch A update | defaultMergeStatusFunction returns null for non-OUTDATED → setStatus never called |
| needsPrerender=false for a scraped URL — its existing suggestion is marked OUTDATED | In scrapedUrlsSet but not in urlsNeedingPrerender → OUTDATED |
| scrapedUrlsSet pathname normalization: www-subdomain suggestion marked OUTDATED when apex-domain URL scraped | Domain-shift invariant: toPathname normalization matches across subdomains |
| OUTDATED domain-wide suggestion with edgeDeployed set → preserved in-place (shouldPreserveDomainWideSuggestion returns true) | ACTIVE_STATUSES excludes OUTDATED but edgeDeployed=true satisfies second condition |
| detectWrongEdgeDeployedStatus runs unconditionally even when isDomainBlocked=true | Diagnostic guard fires before isDomainBlocked short-circuit |

**Describe**: `Prerender behaviour — coveredByDomainWide marking (Step 3)`

| Test | Contract |
|------|----------|
| NEW suggestion for edge-deployed URL is marked coveredByDomainWide when domain-wide suggestion has edgeDeployed set | markDeployedUrlSuggestionsAsCovered: setData(coveredByDomainWide) + saveMany |
| D-04: OUTDATED domain-wide with edgeDeployed → getDomainWideSuggestionDeployedAtEdge returns null, allByOpportunityIdAndStatus NOT called | D-04 fix: OUTDATED filtered from getDomainWideSuggestionDeployedAtEdge (wkkellogg.com bug) |

---

## url-selection.test.js

**Describe**: `Prerender behaviour — URL selection (Step 2, normal mode)`

| Test | Contract |
|------|----------|
| URL processed within 7-day window (PageCitability) is excluded from the batch | 7-day dedup window active |
| URL absent from PageCitability (outside dedup window) is included in the batch | Expired records not returned by DB → URL included |
| URL marked isDeployedAtEdge in status.json pages is excluded from the batch | Edge-deployed URLs excluded from daily batch |
| includedURLs from site config are added to the batch alongside organic URLs | includedURLs source active |
| normal mode caps submitted URL count at DAILY_BATCH_SIZE=320 | 200 organic + 150 included → sliced to exactly 320 |

**Describe**: `Prerender behaviour — URL filtering (Step 2, CSV mode)`

| Test | Contract |
|------|----------|
| non-HTML URLs (jpg, pdf, mp3) are filtered out before submission | mergeAndGetUniqueHtmlUrls non-HTML filter |
| URLs with the same pathname (one with trailing slash) are deduplicated | Trailing-slash dedup |
| CSV mode rebases URLs to overrideBaseURL when set in site fetch config | overrideBaseURL rebasing |

---

## realistic-scenarios.test.js

**Describe**: `Prerender behaviour — realistic compound scenarios`

**Purpose**: High-importance tests that exercise multiple invariants simultaneously in a single audit run. Individual invariants are tested in isolation in the other files; these tests verify the invariants still hold when they occur together — which is the only way to catch bugs where two correct-in-isolation pieces compose incorrectly.

**When to add here**: When a scenario involves ≥ 2 interacting invariants (e.g. error-exclusion AND suggestion-split happening in the same call). Do not add single-invariant tests here.

| Test | Contract |
|------|----------|
| 20 submitted / 2 failed / 18 processed: all 20 in status.json, 10 need prerender → 5 existing suggestions updated + 5 new suggestions created | error exclusion + status.json accounting + saveMany/addSuggestions split all hold simultaneously |

---

## Adding a new test

1. Identify which file owns the contract area (table above).
2. Read `helpers.js` — use `buildContext`, `buildS3Client`, `buildDataAccess`, `captureStatusWrite`, `scrapeKeys`.
3. Read `src/prerender/.claude/handler-reference.md` for S3 key format, step execution order, and stub requirements.
4. Place the new `it()` inside the existing `describe` block that matches; create a new file only if the contract area is genuinely new.
5. Run `npm run test:spec -- test/audits/prerender/behaviour/` to verify.
