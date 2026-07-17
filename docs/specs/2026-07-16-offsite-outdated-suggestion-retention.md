# Offsite Opportunities — Outdated Suggestion Retention

- **Status:** Implemented
- **Date:** 2026-07-16
- **Jira:** LLMO-6124
- **Related:** [offsite-snapshot-retention spec](2026-07-20-offsite-snapshot-retention.md),
  [offsite-snapshot-preservation spec](2026-07-15-offsite-snapshot-preservation.md)

## Problem statement

`syncSuggestions` marks a suggestion `OUTDATED` on the evergreen opportunity when it no longer
appears in a fresh refresh. Unlike snapshots (LLMO-6154), the evergreen opportunity itself is
never IGNORED and never removed, so nothing in the snapshot-retention pass ever revisits its
suggestions. `OUTDATED` rows on the evergreen accumulate weekly, forever, across every site and
audit type — an unbounded growth path distinct from (and not covered by) snapshot retention.

## Goals

1. Permanently delete `OUTDATED` suggestions on the evergreen opportunity once they pass a
   retention window (30 days, independently tunable from the snapshot window).
2. Run deletion as a side effect of a successful refresh, immediately after suggestion sync and
   before snapshot deletion, so no separate scheduled infrastructure is needed for the common
   case.
3. Never delete a customer-visible decision: every status other than `OUTDATED` (`NEW`,
   `IN_PROGRESS`, `FIXED`, `APPROVED`, `SKIPPED`, `REJECTED`, `ERROR`, `PENDING_VALIDATION`) is
   protected regardless of age.
4. Never let a retention failure fail the refresh that triggered it.

Non-goals: a dedicated `outdatedAt` column or schema migration, customer-controlled keep/pin
markers, deleting any status other than `OUTDATED`, deterministic suggestion deduplication,
scheduled/infrastructure-level sweepers, soft deletion, per-customer retention configuration,
Wikipedia analysis, one-time migration/backfill.

## Technical design

### Eligibility

`isOutdatedSuggestionExpired(suggestion, retentionCutoff)` returns true only when:
- `suggestion.getStatus() === OUTDATED`, and
- `getUpdatedAt()` is present, parses to a valid date, and is strictly before the cutoff
  (`OUTDATED_SUGGESTION_RETENTION_DAYS`, 30 days).

A missing or unparseable `updatedAt` is retained — deletion cannot be proven safe without a
valid timestamp. A suggestion freshly marked `OUTDATED` by this refresh's own `syncSuggestions`
call has a fresh `updatedAt`, so it is never deleted in the same run it was demoted in.

### Bulk deletion, chunked

`deleteExpiredOutdatedSuggestions({ dataAccess, opportunity, siteId, auditType, log })` reads the
just-synchronized opportunity's suggestions, filters to expired `OUTDATED` rows, and deletes them
via `Suggestion.removeByIds`, chunked into batches of at most
`OUTDATED_SUGGESTION_DELETE_BATCH_SIZE` (100) to bound the PostgREST `DELETE ... IN (...)` URL
length. Batches run concurrently via `Promise.all`; each batch's success/failure is isolated —
one failed batch does not block or roll back the others. Dependent fix-entity rows cascade-delete
through the existing data model.

This mirrors `removeOpportunityWithSuggestions`
(`src/experimentation-opportunities/guidance-high-organic-low-ctr-handler.js`) and the snapshot
retention pattern (LLMO-6154): a bulk `removeByIds` per batch, not a `Promise.all` over individual
`.remove()` calls, per CLAUDE.md's N+1 rule.

### Structured logging

Emits via `createOffsiteLogger`, using events `outdated_suggestion_lookup` (read failure),
`outdated_suggestion_delete` (one structured line per batch — a single `Deleted N ... (s)` line
carrying that batch's `suggestionIds`, not one line per suggestion, to avoid a hot-loop logging
anti-pattern), and `outdated_suggestion_retention_summary` (one line per invocation, always
emitted). The summary's `outcome` reflects whether any batch failed
(`outcome=failure` when `failed > 0`, `outcome=success` otherwise) so an alerting query keyed on
`outcome=failure` cannot miss a partial-batch failure by only checking the per-batch events.

### Refresh integration

Each guidance handler (`cited-analysis`, `reddit-analysis`, `youtube-analysis`) calls
`deleteExpiredOutdatedSuggestions` once, immediately after `syncSuggestions` succeeds and before
`deleteExpiredSnapshots`, wrapped in try/catch so a retention failure never changes the handler's
response. It does not run when the refresh itself fails before that point (malformed payload,
sync failure, no-suggestions early return).

## Alternatives

- **A dedicated `outdatedAt` timestamp column:** would decouple eligibility from `updatedAt`
  (which any other status-changing write could also touch), but requires a data-access schema
  migration; deferred.
- **Delete unconditionally by count** (e.g. keep only the N most recent `OUTDATED` rows):
  rejected — age-based deletion is simpler to reason about and matches the snapshot window's
  semantics.
- **Sequential (non-concurrent) batch processing:** would further bound connection usage for a
  very large backlog, at the cost of a slower pass; not adopted here since each batch is already
  a single bulk call (not per-record), keeping worst-case concurrency at (backlog size / 100)
  requests rather than one per suggestion.

## Success criteria

- `npm test` green with 100% coverage gate.
- An `OUTDATED` suggestion older than 30 days with a valid `updatedAt` is deleted on the next
  refresh for its opportunity.
- Every other status, and any `OUTDATED` row with a missing/invalid `updatedAt`, is never deleted
  regardless of age.
- Retention never fails the refresh that triggered it.
- `outdated_suggestion_retention_summary outcome=failure` is queryable in Splunk via
  `domain=offsite event=outdated_suggestion_retention_summary outcome=failure` whenever any batch
  fails, independent of whether other batches in the same run succeeded.
