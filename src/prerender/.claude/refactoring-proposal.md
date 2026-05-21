# Refactoring Proposal — Prerender Audit Handler

**Current state**: `handler.js` is 1,875 lines, 34 functions, three entangled code paths.
**Target state**: `handler.js` is ~60 lines. Every step reads like a specification. The logic is in named modules.

**Goal**: reading handler.js tells you WHAT the audit does. The modules tell you HOW.
**Constraint**: all 10 behavioral contract tests in `CLAUDE.md` must stay green throughout.

---

## North Star — Target handler.js

This is the complete target for the handler file. Every function it calls will live in a named module.

```js
// ─── Step 1 ──────────────────────────────────────────────────────────────────
export async function importTopPages(context) {
  const mode = resolveMode(context);
  if (mode.isAiOnly) return handleAiOnlyMode(context);
  return buildImportTrigger(context);
}

// ─── Step 2 ──────────────────────────────────────────────────────────────────
export async function submitForScraping(context) {
  const mode = resolveMode(context);
  if (mode.isAiOnly) return { status: 'skipped' };

  const status = await readSiteStatus(context);
  if (isStickyBotBlocked(context, status)) return buildBotBlockedResult(context, status);

  const rawUrls = await fetchUrls(context, mode);
  const batchUrls = await filterUrls(context, mode, rawUrls, status);

  logSubmitMetrics(context, mode, rawUrls, batchUrls);

  return submitScrapeJob(context, batchUrls);
}

// ─── Step 3 ──────────────────────────────────────────────────────────────────
export async function processContentAndGenerateOpportunities(context) {
  const mode = resolveMode(context);
  if (mode.isAiOnly) return { status: 'skipped' };

  await detectInvariantViolations(context);

  const guard = await earlyExitGuard(context);
  if (guard.exit) return guard.result;

  const comparisons = await compareAllUrls(context);
  const stats = await collectScrapeStats(context, comparisons);

  if (stats.zeroResults) return uploadStatus(context, zeroResultsPayload(context, stats));

  const botBlock = detectBotBlock(stats);
  const opportunity = await syncOpportunity(context, comparisons);
  const { suggestions, covered } = await syncSuggestions(context, comparisons, botBlock);
  await markCovered(context, covered);
  await writeCitability(context, comparisons);
  await queueMystique(context, suggestions);
  return uploadStatus(context, buildStatusPayload(context, stats, botBlock, comparisons));
}
```

**Why this works**: every `if` is a guard clause that exits early. There is no nesting. The happy path is the bottom of each step. The functions read left-to-right: what is computed, what is written, what is sent.

**Convention**: `context` is always the first argument. Return objects carry boolean flags (`mode.isAiOnly`, `guard.exit`, `stats.zeroResults`) instead of inline conditions.

---

## Module Map

Each module owns one concern. `handler.js` imports from all of them and owns nothing else.

| Module | Exports | Responsibility |
|--------|---------|----------------|
| `mode-resolver.js` | `resolveMode(context)` | Returns `{ isAiOnly, isCsv, isSlack, isNormal }`. Called at entry of all 3 steps — currently checked in 4 scattered places. |
| `ai-only.js` | `handleAiOnlyMode(context)` | Full ai-only flow: scrapeJobId resolution, opportunity lookup, security check, Mystique dispatch. Currently 50+ lines embedded in step 1. |
| `import-trigger.js` | `buildImportTrigger(context)` | Builds the `{ type: 'top-pages', siteId, ... }` trigger object. |
| `url-fetcher.js` | `fetchUrls(context, mode)` | Dispatches to mode-specific sources: CSV from `auditContext.urls`, Slack from organic+includedURLs, Normal from organic+agentic+includedURLs. |
| `url-filter.js` | `filterUrls(context, mode, rawUrls, status)` | Per-mode filtering: CSV/Slack → dedup+HTML-only; Normal → PageCitability dedup + edge-deployed filter + DAILY_BATCH_SIZE cap. |
| `bot-block.js` | `isStickyBotBlocked(context, status)` `buildBotBlockedResult(context, status)` `detectBotBlock(stats)` | Stage 1 (sticky pre-scrape check) and Stage 2 (reactive post-scrape ratio + confidence check). Returns clean result objects — no throws. |
| `status-reader.js` | `readSiteStatus(context)` | Reads status.json from S3. Returns the full status object. |
| `exit-guard.js` | `earlyExitGuard(context)` | Reads isDomainBlocked from auditContext; if blocked, creates domain-blocked opportunity and uploads status. Returns `{ exit: true, result }` or `{ exit: false }`. Combines two checks that currently live inline in step 3. |
| `html-comparator.js` | `compareAllUrls(context)` | Parallel S3 download of server-side.html + client-side.html + scrape.json per URL, runs `analyzeHtmlForPrerender`, returns `comparisons[]`. |
| `scrape-stats.js` | `collectScrapeStats(context, comparisons)` | Wraps `getScrapeJobStats`: queries ScrapeUrl DB + S3 scrape.json for FAILED-status URLs, returns `{ zeroResults, urlsSubmitted, missingPages, scrapeForbiddenCount, submittedUrlSet }`. |
| `opportunity-syncer.js` | `syncOpportunity(context, comparisons)` `syncSuggestions(context, comparisons, botBlock)` → `{ suggestions, covered }` `markCovered(context, covered)` `detectInvariantViolations(context)` | All suggestion/opportunity DB mutations. `syncSuggestions` returns `{ suggestions, covered }` — the handler never builds these sets itself. `detectInvariantViolations` is diagnostic-only (logs, never throws). |
| `status-writer.js` | `uploadStatus(context, payload)` `zeroResultsPayload(context, stats)` `buildStatusPayload(context, stats, botBlock, comparisons)` `buildBotBlockedResult(context, status)` | All status.json writes. Builder functions are pure (no S3 calls). `uploadStatus` is the only S3 writer. |
| `citability-writer.js` | `writeCitability(context, comparisons)` | Writes PageCitability records in batches of 10. |
| `mystique.js` | `queueMystique(context, suggestions)` | Sends guidance request to Mystique via SQS. Handles batch chunking, skip conditions (OUTDATED, FIXED, edgeDeployed). |
| `metrics.js` | `logSubmitMetrics(context, mode, rawUrls, batchUrls)` | Emits `prerender_submit_scraping_metrics`. Single call site, always after filtering. |

---

## Data Shapes Between Stages

These are the values that flow from one stage to the next. Keeping them explicit prevents hidden coupling.

### `mode` — output of `resolveMode`

```js
{
  isAiOnly: boolean,
  isCsv: boolean,
  isSlack: boolean,
  isNormal: boolean,
}
```

Replaces the current 4 scattered `MODE_AI_ONLY` / `auditContext.slackContext` / `auditContext.urls` checks.

### `guard` — output of `earlyExitGuard`

```js
// Blocked:
{ exit: true, result: { status: 'domain-blocked', ... } }

// Not blocked:
{ exit: false }
```

Internally, `earlyExitGuard` reads `isDomainBlocked` from auditContext, creates the domain-blocked opportunity if needed, and uploads status. The handler only checks the `exit` flag.

### `comparisons[]` — output of `compareAllUrls`

```js
{
  url,
  needsPrerender,        // contentGainRatio >= 1.1
  contentGainRatio,
  wordCountBefore,
  wordCountAfter,
  citabilityScore,
  isDeployedAtEdge,      // from scrape.json
  usedEarlyClientSideHtml,
  scrapeForbidden,       // error.statusCode === 403
  scrapeError,           // error object from scrape.json
  error,                 // boolean — HTML comparison itself failed
}
```

### `stats` — output of `collectScrapeStats`

```js
{
  zeroResults,           // boolean — comparisons.length === 0 or no successful scrapes
  urlsSubmitted,         // total URLs in the scrape job
  scrapeForbiddenCount,  // 403 count (COMPLETE + FAILED paths)
  missingPages,          // per-URL error details for status.json
  submittedUrlSet,       // Set<url> from ScrapeUrl DB (for scrapeJobId assignment)
}
```

`zeroResults` is computed inside `collectScrapeStats` so the handler never inspects `comparisons.length` directly.

### `{ suggestions, covered }` — output of `syncSuggestions`

```js
{
  suggestions: Suggestion[],   // the NEW suggestions to send to Mystique
  covered: Suggestion[],       // suggestions whose URLs are edge-deployed and covered by domain-wide
}
```

`markCovered(context, covered)` writes `coveredByDomainWide` on these. `queueMystique(context, suggestions)` sends the Mystique batch. The handler never builds either array.

---

## What Changes in Each Step

### Step 1 (2 meaningful changes)

1. `resolveMode` replaces the scattered `MODE_AI_ONLY` checks and returns a clean boolean-flag object
2. `handleAiOnlyMode` extracted from step 1 body into `ai-only.js`

### Step 2 (biggest change)

The three code paths (CSV / Slack / Normal) are collapsed into two pure functions:
- `fetchUrls(context, mode)` — dispatches to mode-specific sourcing, returns raw URL list
- `filterUrls(context, mode, rawUrls, status)` — applies mode-specific filters, returns final URL array

The bot-block check moves from an inline `if` to `isStickyBotBlocked(context, status)` — same logic, named and testable independently.

### Step 3 (fallback removed ✅, zero-results guard still proposed)

**Done** (`505391dc` #2538): The untested `/* c8 ignore */` fallback that silently processed stale HTML has been removed. `scrapeResultPaths.size === 0` now logs a warning and skips comparison entirely — `getScrapeJobStats` already handles FAILED URLs via `ScrapeUrl` DB.

**Still proposed**: A named `stats.zeroResults` guard that explicitly uploads an honest status with `scrapingErrorRate = 100%` and exits cleanly without touching suggestions:
- Current: zero scrapes → warn + skip comparison → continue to suggestion branches (Branch C marks suggestions OUTDATED)
- Proposed: zero scrapes → `stats.zeroResults = true` → upload honest status with `scrapingErrorRate = 100%` → exit cleanly without touching suggestions

The `isDomainBlocked` check moves out of inline `if` into `earlyExitGuard`, which also handles the domain-blocked opportunity creation and status upload internally — step 3 just reads `guard.exit`.

The three-way opportunity branch (`urlsNeedingPrerender > 0` / `scrapeForbidden` / neither) is absorbed into `syncSuggestions`, which returns `{ suggestions, covered }`. `botBlock` flows in as a parameter — `syncSuggestions` uses it to decide whether to create the scrapeForbidden opportunity instead of the normal prerender opportunity.

---

## Observability — Preserved Log Keys

Both monitored log keys must survive the refactoring unchanged.

| Log key | Emitted by | Trigger |
|---------|-----------|---------|
| `prerender_submit_scraping_metrics` | `metrics.js: logSubmitMetrics` | Once per step 2 run, after `filterUrls` |
| `prerender_ai_summary_metrics` | `guidance-handler.js` | After `Suggestion.saveMany` in guidance flow |

Field names are not changed. If the emit point moves, update dashboard queries.

---

## TDD Implementation Order

Work in this order. Each step is independently deliverable — the 10 contract tests stay green after each.

1. **`mode-resolver.js`** — pure function, zero dependencies, write tests first
2. **`bot-block.js`** — `isStickyBotBlocked` + `detectBotBlock` + `buildBotBlockedResult` — pure functions, test against known status.json shapes
3. **`url-filter.js`** — stub `PageCitability` + `getEdgeDeployedPathnames` — verify same URLs pass/fail as current handler
4. **`url-fetcher.js`** — stub `getTopOrganicUrlsFromSeo` + `getTopAgenticUrls` — verify per-mode URL sets
5. **Step 2 collapse** — wire `fetchUrls` + `filterUrls` + `isStickyBotBlocked` into handler; all three path contract tests pass
6. **`scrape-stats.js`** — stub `ScrapeUrl` DB + S3 `scrape.json` reads; verify `scrapeForbiddenCount` dual-path counting; `zeroResults` flag tested here
7. **`exit-guard.js`** — test: `isDomainBlocked=true` → `guard.exit=true`, `uploadStatus` called with blocked payload, `syncSuggestions` never called
8. **`status-writer.js`** — pure builder functions first (no S3); then `uploadStatus` with stubbed S3
9. **`opportunity-syncer.js`** — extract `syncSuggestions` + `markCovered`; verify `{ suggestions, covered }` shape; preserve all OUTDATED / coveredByDomainWide invariants; `botBlock` parameter drives scrapeForbidden opportunity path
10. **Step 3 full collapse** — wire all modules into the ~20-line target; all 10 contract tests pass

---

## Implementation Risks

### esmock Path Sensitivity (Critical Risk)

- **Current**: 115 esmock instantiations in `handler.test.js` mock specific function exports
- **Risk**: Moving functions to new files breaks all paths (e.g., `esmock('../src/prerender/handler.js', ...)` expects specific export names)
- **Mitigation**: When extracting functions:
  1. Identify all esmock stubs that reference the function
  2. Update stub paths to new module location
  3. Re-run tests; if any path fails, verify import/export is correct
  4. Consider creating adapter exports in handler.js during transition (minimize esmock churn)

### c8 Coverage Ignore Branches

- **Current**: 6 branches marked with `/* c8 ignore next N */`
- **Risk**: When extracted to new modules, these branches become mandatory test coverage
- **Action**: When extracting, review each ignore comment:
  - If condition is testable, add tests to cover the branch
  - If condition is environment-dependent, preserve ignore with explanation comment
  - Update c8 ignore block count if branches are refactored

### Test Architecture Impact

- **Handler exports**: 8 main entry points (steps 1-3, helper exports)
- **Esmock dependency**: All mocking depends on exact export names and file paths
- **Migration strategy**: Extract functions, then immediately update esmock stubs before running tests (batch the refactor + test updates together, don't separate them)

### Shared Function Hazards

- **normalizePathname**: Used by 10+ audits (GSC, lighthouse, etc.); if moved, must coordinate updates across repo
- **mergeAndGetUniqueHtmlUrls**: Duplication confirmed in prerender (`src/prerender/utils/utils.js`) vs canonical (`src/utils/audit-input-urls.js`); safe to remove prerender copy if consensus reached
- **Audit-specific utils**: URL sanitization, bot-block regex — stay in `src/prerender/` to avoid coupling with other audits

---

## Module Extraction Checklist (per extraction)

1. **Identify esmock impact**: Grep for function name in `handler.test.js`; list all mocking paths
2. **Check shared usage**: Does this function exist elsewhere? (`normalizePathname`, `mergeAndGetUniqueHtmlUrls`)
3. **Verify locked contracts**: Are any locked field names referenced? (status.json, Suggestion.data, S3 paths)
4. **Write behavioral tests**: Before extraction, write test that verifies observable output (not internal logic)
5. **Extract + update stubs**: Move function, update all esmock instantiations, run tests
6. **Review c8 ignores**: Any ignored branches now tested? Update ignore count
