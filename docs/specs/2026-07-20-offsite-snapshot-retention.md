# Offsite Opportunities — Automatic Snapshot Retention

- **Status:** Implemented
- **Date:** 2026-07-20
- **Jira:** LLMO-6154
- **Related:** [offsite-snapshot-preservation spec](2026-07-15-offsite-snapshot-preservation.md),
  [ADR 004 — 30-day retention window](../decisions/004-offsite-snapshot-retention-window.md)

## Problem statement

The offsite snapshot-preservation feature (LLMO-6152) creates an IGNORED+tagged `Opportunity`
snapshot record on every refresh, for every audit type, for every site. Nothing removes old
snapshots, so the working set grows without bound — this is a stated non-goal of LLMO-6152,
tracked here as its follow-up.

## Goals

1. Permanently delete managed offsite snapshots (and their cascade-linked suggestions) once they
   pass a retention window (30 days — see ADR 004).
2. Run deletion as a side effect of a successful refresh, scoped to `(siteId, auditType)`, so no
   separate scheduled infrastructure is needed for the common case.
3. Never let a retention failure fail the refresh that triggered it.
4. Avoid the N+1 concurrent-write pattern CLAUDE.md documents as a connection-pool risk.

Non-goals: a scheduled/infrastructure-level sweep for sites that stop refreshing entirely (see
"Known limitation" below), snapshot restore (LLMO-6153), configurable per-customer retention
windows.

## Technical design

### Lookup

`findExpiredSnapshots({ dataAccess, siteId, auditType, log })` fetches all IGNORED opportunities
for the site (same in-memory-scan approach as `findSnapshotByTriggerAuditId` in
`offsite-snapshot.js` — see that spec's "Known limitation" section, which applies here too),
filters to managed snapshots of the given `auditType` (`isOffsiteSnapshot`) whose
`getCreatedAt()` is strictly older than `now - SNAPSHOT_RETENTION_DAYS`, and returns them sorted
oldest-first. A lookup failure is logged (`retention_lookup outcome=failure`) and swallowed —
`findExpiredSnapshots` returns `[]` rather than throwing, so a transient read failure degrades to
"nothing to delete this cycle" instead of blocking the refresh.

### Deletion — bulk, not per-record

`deleteExpiredSnapshots` takes at most `MAX_DELETIONS_PER_RUN` (50) of the oldest expired
snapshots (bounding the blast radius when a dormant site resumes refreshing after months of
backlog) and deletes them in two bulk calls:

1. Sequentially read each snapshot's suggestions (`snapshot.getSuggestions()`) and collect their
   IDs. This is sequential, not concurrent, to avoid a read-side fan-out against the shared
   connection pool.
2. `Suggestion.removeByIds(suggestionIds)` — one chunked bulk delete for all collected suggestion
   IDs (skipped if none exist).
3. `Opportunity.removeByIds(snapshotIds)` — one chunked bulk delete for the snapshot
   opportunities themselves.

This mirrors the existing `removeOpportunityWithSuggestions` pattern in
`src/experimentation-opportunities/guidance-high-organic-low-ctr-handler.js`, batched across the
whole expired set instead of one opportunity at a time. It deliberately avoids the pattern
CLAUDE.md's "Database Query Patterns — Avoiding N+1" section lists as `BAD`: a concurrent
`Promise.all` over individual `.remove()` calls, which — because each snapshot's cascade delete
also removes its own suggestions — would fan out to roughly
`expired * (1 + suggestionsPerSnapshot)` concurrent requests against the 200-connection pool.
That fan-out is worst exactly when a dormant or newly re-enabled site's backlog makes `expired`
large, which is the scenario this feature exists to bound.

**Trade-off:** the earlier per-record implementation isolated failures — one bad record didn't
block the rest, and each success/failure was logged individually. The bulk implementation does
not preserve that: a single `removeByIds` failure throws for the whole batch. This is an
accepted trade-off, not an oversight — bulk delete is the only way to avoid the N+1 write
fan-out, and the call site still guarantees a failure here never fails the refresh (see below).

### Call site

Each guidance handler (`cited-analysis`, `reddit-analysis`, `youtube-analysis`) calls
`deleteExpiredSnapshots` once, after a successful refresh commits, wrapped in try/catch:

```js
try {
  await deleteExpiredSnapshots({ dataAccess, siteId, auditType, log });
} catch (error) {
  ologOpp.failure('retention_delete', ..., { ...errorField(error) }, error);
}
```

A retention failure is logged (`retention_delete outcome=failure`) and does not affect the
handler's response.

### Structured logging

`findExpiredSnapshots` and `deleteExpiredSnapshots` emit via `createOffsiteLogger`
(`offsite-logging.js`), using events `retention_lookup` and `retention_delete`. The success
summary (`retention_delete outcome=success`, fields `eligible`/`deleted`) is only emitted when at
least one snapshot was actually deleted, to avoid an INFO line on every refresh across three
audit types × N sites × every scheduled run when there is nothing to report.

### Known limitation — dormant vs. disabled/offboarded sites

Deletion only runs as a side effect of a refresh. A **dormant** site (audits still enabled, just
not recently triggered) self-heals: its next refresh, whenever it happens, runs retention scoped
to that site. A site whose audit has been **disabled** or that has been **offboarded** never
refreshes again, so its snapshots (and their cascade-linked suggestions) are never revisited and
accumulate indefinitely. Bounding that case requires a scheduled or infrastructure-level sweep,
which is explicitly out of scope for this change; track it as a separate follow-up rather than
relying on this mechanism to cover it.

## Alternatives

- **Scheduled sweep job** as the primary mechanism: covers the disabled/offboarded gap above,
  but is another moving part to operate and monitor, and doesn't fit this PR's scope (piggybacking
  on the refresh that's already touching that site/audit type). Tracked as a future follow-up
  instead of blocking this change.
- **Soft-delete / archive instead of hard-delete:** avoids permanent data loss and would simplify
  a future restore feature (LLMO-6153), but requires a data-access schema change; deferred.

## Success criteria

- `npm test` green with 100% coverage gate.
- A snapshot older than 30 days is deleted (with its suggestions) on the next refresh for its
  `(siteId, auditType)`.
- A snapshot at or under 30 days old is never deleted.
- Deletion never fails the refresh that triggered it.
- `retention_delete outcome=success` and `outcome=failure` are queryable in Splunk via
  `domain=offsite event=retention_delete`.
