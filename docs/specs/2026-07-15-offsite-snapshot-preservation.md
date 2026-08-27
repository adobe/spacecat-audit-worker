# Offsite Opportunities — Snapshot Preservation on Every Refresh

- **Status:** Implemented
- **Date:** 2026-07-15
- **Jira:** LLMO-6152
- **Related:** [offsite-structured-logging spec](2026-07-31-offsite-structured-logging.md)

## Problem statement

The offsite audits (cited, reddit, youtube) maintain a single "evergreen" opportunity per site.
Each refresh from Mystique currently overwrites that record in place — the previous state
(suggestions, review statuses, QA decisions) is lost with no audit trail. Suppressed runs
(IGNORED status from the QA gate) are discarded entirely and cannot be inspected later.
This makes debugging, QA retrospectives, and future restore operations impossible.

## Goals

1. Preserve the previous evergreen state before every surfaced refresh overwrites it.
2. Persist every suppressed audit run as a separate, inert snapshot.
3. Enable idempotent redelivery: replaying the same Mystique message must not create duplicate
   snapshots.
4. Link suppressed snapshots to the evergreen opportunity when one exists.

Non-goals: snapshot restore (LLMO-6153), automatic snapshot deletion (LLMO-6154), Backoffice
UI for snapshots, retroactive tagging of existing IGNORED records, Wikipedia analysis.

## Technical design

### Snapshot record shape

Snapshots are stored as regular `Opportunity` records with:
- `status: IGNORED`
- `tags: [...existingTags, 'offsite-snapshot']` — the tag distinguishes snapshots from
  organically retired duplicates
- `data.snapshot` metadata:
  - `kind`: `'superseded-refresh'` or `'suppressed-refresh'`
  - `evergreenOpportunityId`: the live evergreen this snapshot is derived from (when known)
  - `triggerAuditId`: the incoming audit that triggered the snapshot (when available)

### Two workflows

**Superseded-refresh snapshot (surfaced run):**
1. Before the evergreen opportunity is mutated, copy its current state — data, title, description,
   guidance, scope, suggestions (type/rank/data/status/kpiDeltas/skipReason/skipDetail) — into a
   new IGNORED+tagged record.
2. Link it to the evergreen via `evergreenOpportunityId`.
3. Return the original evergreen as the persistence target; the normal refresh path then updates it.
4. First-ever run (no evergreen exists): no snapshot is created.

**Suppressed-refresh snapshot (suppressed run):**
1. The incoming suppressed run itself becomes the snapshot — its data is tagged and annotated with
   snapshot metadata before being written.
2. The evergreen record is not touched.

### Idempotency

When `triggerAuditId` is available, `findSnapshotByTriggerAuditId` looks up an existing snapshot
for (siteId, auditType, triggerAuditId) before creating a new one. Redelivery reuses the existing
record. A suppressed snapshot created before an evergreen existed can receive its
`evergreenOpportunityId` link on redelivery.

Without `triggerAuditId`, no idempotency check is performed; the snapshot is still created and
tagged but redelivery will produce a duplicate.

### Orphan protection

If `addSuggestions` throws entirely (not a partial error), the snapshot record already exists
in the DB but has no suggestions. The catch block deletes the orphan and rethrows so the next
delivery recreates the snapshot cleanly. If the delete itself fails, the error is logged
(`snapshot_cleanup outcome=failure`) and the original error is still rethrown.

### No shared orchestrator

Each guidance handler calls `resolveEvergreenOffsiteOpportunity` (from `offsite-refresh.js`)
followed by `prepareSuppressedRunSnapshot` or `prepareSupersededRunSnapshot` (from
`offsite-snapshot.js`) inline, rather than through a single combining function. A shared
orchestrator was tried and reverted: it required one of the two modules to import the other,
and esmock deadlocks when two modules that both partially mock each other are loaded in the
same test. `offsite-refresh.js` and `offsite-snapshot.js` have no cross-imports as a result.

### Known limitation — in-memory scan

`findSnapshotByTriggerAuditId` fetches all IGNORED opportunities for a site and filters
in-memory (type, tag, triggerAuditId). Since every refresh creates a snapshot, this working set
grows over time. For active sites across three audit types this can reach hundreds of records
within months. Pushing the filter to the PostgREST layer is tracked in a follow-up.

### Structured logging

All snapshot operations emit structured `key=value` logs via `createOffsiteLogger` from
`offsite-logging.js`, using events `snapshot_lookup`, `snapshot_prepare`,
`snapshot_copy_suggestions`, and `snapshot_cleanup`.

## Alternatives

- **Soft-delete via a separate snapshot table:** cleaner schema, but requires a data-access
  migration; deferred to a future iteration.
- **Store snapshots in S3:** avoids DB growth, but makes them harder to query and link to
  opportunity records.

## Success criteria

- `npm test` green with 100% coverage gate.
- Every surfaced refresh that has an existing evergreen creates a `superseded-refresh` snapshot
  before overwriting it.
- Every suppressed run is persisted as a `suppressed-refresh` snapshot.
- Replaying the same Mystique message (same `auditId`) does not create a second snapshot.
- `snapshot_prepare outcome=success` and `snapshot_copy_suggestions outcome=failure` are
  queryable in Splunk via `domain=offsite event=snapshot_prepare`.
