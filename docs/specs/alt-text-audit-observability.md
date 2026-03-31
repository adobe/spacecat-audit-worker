# Spec: Alt-Text Audit Observability & Status Tracking

**PR:** [#2227](https://github.com/adobe/spacecat-audit-worker/pull/2227)
**Status:** Implemented
**Last updated:** 2026-03-30

---

## Problem Statement

The alt-text audit (`image-alt-text`) is a 3-step multi-step audit that only set status in Step 1 (`'preparing'`). Steps 2 and 3 had no status tracking, and all error paths threw exceptions without persisting a status to the audit record. This made it impossible to determine where an audit failed, what state it was in, or how long each step took.

## Goals

1. Track audit status at every step of the lifecycle with a persistent `statusHistory` array
2. Record per-step timing (`stepDurationMs`) and queue wait time (`queueDurationMs`) for performance observability
3. Persist meaningful error statuses (step-specific, not generic) so failures are diagnosable
4. Add Coralogix-alertable error log tags (`[AltTextProcessingError]`) for monitoring

## Non-Goals

- Timeout/expiry mechanism for audits stuck in `processing` (no Mystique response)
- Modifying the StepAudit framework itself
- Tracking status for other audit types (alt-text only)

---

## Technical Design

### auditResult Structure

Each step appends to a `statusHistory` array inside `auditResult`. The top-level `status` always reflects the latest state for quick checks. All helpers use spread (`{ ...existing, ... }`) to preserve any existing top-level fields.

```js
{
  status: 'success',
  statusHistory: [
    { status: 'preparing',  startedAt: 'T0', completedAt: 'T0', stepDurationMs: 0,    queueDurationMs: null,  finalUrl: '...' },
    { status: 'scraping',   startedAt: 'T1', completedAt: 'T2', stepDurationMs: 1200, queueDurationMs: 4500,  urlCount: 20 },
    { status: 'processing', startedAt: 'T3', completedAt: 'T4', stepDurationMs: 3400, queueDurationMs: 62000, urlCount: 18, batchCount: 2 },
    { status: 'success',    startedAt: 'T5', completedAt: 'T6', stepDurationMs: 800,  queueDurationMs: 33000 }
  ]
}
```

On error, the history shows exactly where it stopped:
```js
{
  status: 'scraping_failed',
  statusHistory: [
    { status: 'preparing',       startedAt: 'T0', completedAt: 'T0', stepDurationMs: 0,   queueDurationMs: null },
    { status: 'scraping_failed', startedAt: 'T1', completedAt: 'T2', stepDurationMs: 200, queueDurationMs: 4500, error: 'No top pages found' }
  ]
}
```

**Derived timings:**
- `stepDurationMs` = `completedAt - startedAt` -- how long the step handler executed
- `queueDurationMs` = `startedAt - previousEntry.completedAt` -- queue wait + external service time (null for first entry)

### Status Lifecycle

```
Step 1 (processImport)      -> 'preparing'          [framework persists, initializes statusHistory]
Step 2 (processScraping)    -> 'scraping'            [appends to statusHistory, explicit audit.save()]
Step 3 (processAltText)     -> 'processing'          [appends to statusHistory, explicit audit.save()]
Guidance handler (each msg) -> 'success'             [appends to statusHistory, explicit audit.save()]

Error in Step 2             -> 'scraping_failed'     [appends to statusHistory]
Error in Step 3             -> 'processing_failed'   [appends to statusHistory]
Error in Guidance handler   -> 'guidance_failed'     [appends to statusHistory]
No top pages (Step 2/3)     -> 'no_top_pages'        [appends to statusHistory]
No scrape results (Step 3)  -> 'no_scrape_results'   [appends to statusHistory]
```

### Helper Functions

Three exported helpers in `handler.js` manage status tracking:

- **`startStatus(audit, status, metadata)`** -- Appends a new entry to `statusHistory` with `startedAt` and computed `queueDurationMs`. Preserves existing auditResult fields via spread.
- **`completeStatus(audit, metadata)`** -- Completes the last entry with `completedAt`, `stepDurationMs`, and optional metadata. Preserves existing fields via spread.
- **`failCurrentStatus(audit, failedStatus, metadata)`** -- If a step is in-progress (no `completedAt`), mutates the last entry to the failed status. If no in-progress step, delegates to `startStatus` + `completeStatus`.

### Key Framework Insight

Only Step 1's return value is persisted by the framework (via `processAuditResult()` when `!hasNext`). Steps 2 and 3 must explicitly call `audit.setAuditResult()` + `audit.save()` to update the audit record. This follows the pattern established by `page-type/guidance-handler.js` and `internal-links/result-utils.js`.

### Coralogix Alert Tag

All `log.error()` calls include `[AltTextProcessingError]` for Coralogix alerting, following the `[A11yProcessingError]` pattern from the accessibility audit. Defined as `ALT_TEXT_PROCESSING_ERROR_TAG` in `constants.js`.

All "cannot proceed" conditions (no top pages, no scrape results) use `log.error` consistently.

---

## Files Changed

| File | Changes |
|------|---------|
| `src/image-alt-text/constants.js` | Added `ALT_TEXT_PROCESSING_ERROR_TAG` |
| `src/image-alt-text/handler.js` | Status helpers, status tracking in all 3 steps, Coralogix tags |
| `src/image-alt-text/guidance-missing-alt-text-handler.js` | `success` on each Mystique response, `guidance_failed` on errors |
| `src/image-alt-text/opportunityHandler.js` | Coralogix tag on error logs |
| `test/audits/image-alt-text/handler.test.js` | Updated + new tests for status tracking |
| `test/audits/image-alt-text/guidance-missing-alt-text-handler.test.js` | Updated + new tests for status tracking |
| `test/audits/image-alt-text/opportunity-handler.test.js` | Updated error log assertions |

---

## Metadata Per Status Entry

| Status | Extra Fields |
|--------|-------------|
| `preparing` | `finalUrl` |
| `scraping` | `urlCount` |
| `processing` | `urlCount`, `batchCount` |
| `success` | `empty: true` if Mystique response had no suggestions |
| `no_top_pages` | `error` |
| `no_scrape_results` | `error` |
| `scraping_failed` | `error` |
| `processing_failed` | `error` |
| `guidance_failed` | `error` |

**All entries include:** `startedAt`, `completedAt`, `stepDurationMs`, `queueDurationMs`

---

## Design Decisions

1. **statusHistory array vs single status** -- Chose array to preserve full audit trail with per-step timing. Each `setAuditResult` overwrites, so the array is the only way to keep history.

2. **Step-specific error statuses** -- Used `scraping_failed`, `processing_failed`, `guidance_failed` instead of generic `PROCESSING_FAILED` so errors are immediately diagnosable without reading logs.

3. **`success` on every Mystique response** -- The guidance handler sets `success` each time a Mystique batch arrives. No completion detection (waiting for all batches) -- simpler and avoids needing a timeout mechanism. If no response arrives, status stays `processing`.

4. **Silent return vs throw on data errors** -- Error paths like "no top pages" return status objects instead of throwing. This persists the error status to the audit record. The StepAudit framework still chains to the next step (matching canonical audit pattern), but the downstream step handles missing data gracefully.

5. **Helpers use spread to preserve fields** -- All three helpers use `{ ...existing, ... }` when calling `setAuditResult` to avoid silently dropping top-level fields. This was identified and fixed during code review.

6. **Consistent error log severity** -- All "cannot proceed" conditions use `log.error` with the Coralogix tag for consistent alerting. Fixed during code review (was inconsistently using `log.info` for some).

---

## Verification

1. All tests pass: `npm run test:spec -- test/audits/image-alt-text/handler.test.js test/audits/image-alt-text/guidance-missing-alt-text-handler.test.js test/audits/image-alt-text/opportunity-handler.test.js`
2. 100% line/branch/function coverage on all modified source files
3. No `throw new Error` in `image-alt-text/` without a status persisted first
4. All `audit.save()` calls for error status wrapped in try-catch to avoid masking original errors
