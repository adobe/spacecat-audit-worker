# CLAUDE.md — Prerender Audit Tests

This file explains the test structure for the prerender audit.
Read it before adding a test so you know which file to add it to and why.

**For business logic context** (what the audit does, golden rules, suggestion data contracts, S3 schemas):
→ Read [`src/prerender/CLAUDE.md`](../../../src/prerender/CLAUDE.md) first.

---

## Two-Layer Test Structure

Tests are split into two layers with different purposes. Understanding the difference prevents adding tests to the wrong place.

### Layer 1 — Unit tests (white-box)

Files: `handler.test.js`, `ai-only-mode.test.js`, `sync-suggestions.test.js`, `utils.test.js`, `guidance-handler.test.js`

- Test individual functions by calling them directly
- Mock **internal** dependencies via esmock (e.g., stub `syncSuggestions` inside `handler.js`)
- Tightly coupled to implementation — when a function moves to a new module, esmock paths must be updated
- Good for: exhaustive branch coverage, edge cases deep inside a function that can't be triggered from outside

### Layer 2 — Behaviour tests (black-box)

Directory: `behaviour/`

- Call only the three exported step functions (`importTopPages`, `submitForScraping`, `processContentAndGenerateOpportunities`)
- Mock only **external** system boundaries: S3 (`s3Client.send`), DB entities (`Opportunity`, `Suggestion`, `PageCitability`, `ScrapeUrl`), SQS
- Never stub internal handler functions — tests survive any internal refactoring or module extraction
- Good for: verifying observable outcomes; the 21 behavioural contract tests live here

**Rule of thumb:** If you can express the test as *"when S3/DB returns X, the step should write Y to S3/DB or return Z"*, it belongs in `behaviour/`. If you need to isolate a specific internal function that can't be reached by controlling external inputs alone, it belongs in the unit test layer.

---

## Behaviour Test Files — What Each Covers

| File | Covers |
|------|--------|
| `bot-block.test.js` | Stage 1 sticky check (pre-scrape), Stage 2 reactive detection (post-scrape), detectBotBlocker throws |
| `data-integrity.test.js` | status.json merge, scrapeForbidden persistence, scrapeJobId written to status, PageCitability writes, S3 path contract |
| `early-exits.test.js` | isDomainBlocked short-circuit, all-HTML-error scrapes, FAILED-status 403 counting |
| `error-resilience.test.js` | Partial S3 failures, ScrapeUrl throws, Opportunity.create rejects |
| `mode-routing.test.js` | CSV / Slack / Normal path routing in step 1 and step 2 |
| `mystique-round-trip.test.js` | Mystique SQS message sent (Branch A) / not sent (B/C), aiSummary+valuable update, OUTDATED skip |
| `opportunity-creation.test.js` | Branch A/B/C opportunity and suggestion creation |
| `scrape-error-safety.test.js` | 100% error → no OUTDATED, partial error → correct OUTDATED targeting |
| `suggestion-lifecycle.test.js` | Branch C OUTDATED marking, edgeDeployed protection, coveredByDomainWide, domain-wide preservation, detectWrongEdgeDeployedStatus |
| `ai-only-mode.test.js` | ai-only step skip (steps 2 and 3), ai-only step 1 full flow |
| `url-selection.test.js` | PageCitability 7-day dedup, isDeployedAtEdge filter, DAILY_BATCH_SIZE=320 cap, includedURLs, non-HTML filter, pathname dedup |

---

## Behaviour Test Helpers (`behaviour/helpers.js`)

All behaviour tests use shared factories from `helpers.js`. **Never stub internal functions here** — only external boundaries.

| Helper | Returns | Use when |
|--------|---------|----------|
| `buildContext(sandbox, overrides)` | Full handler context with safe defaults | Every behaviour test — pass only the overrides your test cares about |
| `buildS3Client(sandbox, keyMap)` | S3 stub dispatching by key | Control what S3 returns per key; absent keys → NoSuchKey automatically |
| `buildDataAccess(sandbox, opts)` | All DB entity stubs | Pass `opportunities`, `topPages`, `citabilityRecords`, `scrapeUrls` to seed data |
| `buildSite(opts)` | Site stub | Set `baseUrl`, `includedUrls`, `overrideBaseURL` |
| `buildOpportunity(sandbox, opts)` | Opportunity stub | Pre-wire suggestions, status, type |
| `buildSuggestion(sandbox, opts)` | Suggestion stub | Set status, data fields |
| `buildSqs(sandbox)` | SQS stub | Inspect `sendMessage` calls |
| `buildStatus(opts)` | Valid `status.json` object | Seed S3 with prior status — use with `buildS3Client` |
| `statusKey(siteId)` | `prerender/scrapes/{siteId}/status.json` | Key for the site's status.json in S3 |
| `scrapeKeys(scrapeJobId, url)` | `{ serverHtml, clientHtml, scrapeJson }` | Compute canonical S3 keys for a URL |
| `buildUrlS3Content(scrapeJobId, url, opts)` | Partial keyMap for one URL | Spread into a keyMap to add one URL's HTML + scrape.json |
| `captureStatusWrite(s3Client)` | Parsed body of first `PutObjectCommand` | Assert what was written to status.json |
| `daysAgo(n)` | ISO timestamp N days in the past | Seed `scrapeForbiddenSince` |
| `HTML_SAME` | Identical server+client HTML | No prerender needed (ratio = 1.0) |
| `HTML_SERVER_SPARSE` | Sparse server HTML | Pair with `HTML_CLIENT_NEEDS_PRERENDER` for ratio >> 1.1 |
| `HTML_CLIENT_NEEDS_PRERENDER` | Rich client HTML | Pair with `HTML_SERVER_SPARSE` — triggers `needsPrerender=true` |

**Minimal test example:**
```js
import sinon from 'sinon';
import { submitForScraping } from '../../../../src/prerender/handler.js';
import {
  buildContext, buildS3Client, buildSite, buildStatus, statusKey, daysAgo,
} from './helpers.js';

it('sticky bot-block skips scraping', async () => {
  const sandbox = sinon.createSandbox();
  const site = buildSite({ id: 'site-1' });
  const ctx = buildContext(sandbox, {
    site,
    s3Client: buildS3Client(sandbox, {
      [statusKey('site-1')]: buildStatus({
        scrapeForbidden: true,
        scrapeForbiddenSince: daysAgo(1),
      }),
    }),
  });

  const result = await submitForScraping(ctx);

  expect(result.urls).to.be.empty;
  expect(result.auditContext.domainBlocked).to.be.true;
  sandbox.restore();
});
```

---

## The 21 Behavioural Contract Tests

These must stay green through any refactoring. They are distributed across the `behaviour/` files above.
The full list is in [`src/prerender/CLAUDE.md`](../../../src/prerender/CLAUDE.md) § "Behavioral Contract Tests".

---

## Where to Add a New Test

| Scenario | Add to |
|----------|--------|
| New observable outcome — what the step writes to S3/DB or returns | `behaviour/<closest-concern>.test.js` |
| New behaviour concern with no existing file | New `behaviour/<concern>.test.js` |
| Edge case in a specific internal branch that can't be triggered by controlling only external inputs | `handler.test.js` (unit layer) |
| New extracted module with its own file | New `<module>.test.js` alongside handler.test.js |
| New ai-only mode flow | `ai-only-mode.test.js` |
| `syncSuggestions` edge case (OUTDATED conditions, status protection, key matching) | `sync-suggestions.test.js` |
| guidance-handler (Mystique inbound response) | `guidance-handler.test.js` |

---

## Deleting Unit Tests When Modules Are Extracted

When a function is extracted from `handler.js` into its own module:

1. Write a `<module>.test.js` unit test file for the new module
2. Delete the overlapping tests from `handler.test.js` — the module's unit tests + behaviour tests together give complete coverage
3. The behaviour tests do **not** change — they never referenced the internal function

The ~35 known handler.test.js tests that duplicate behaviour/ tests are candidates for deletion when their corresponding module is extracted. See the refactoring proposal at [`src/prerender/.claude/refactoring-proposal.md`](../../../src/prerender/.claude/refactoring-proposal.md).
