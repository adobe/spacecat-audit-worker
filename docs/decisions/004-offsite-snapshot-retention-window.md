# 004 — 30-Day Retention Window for Offsite Snapshot Opportunities

- **Status:** Accepted
- **Date:** 2026-07-20

## Context

The offsite snapshot-preservation feature (LLMO-6152) writes an IGNORED+tagged `Opportunity`
record (a "snapshot") before every surfaced refresh overwrites the evergreen, and for every
suppressed run. Because a snapshot is created on **every** refresh — weekly per site per audit
type (cited/reddit/youtube) — the working set grows without bound if nothing ever removes old
ones. LLMO-6154 adds automatic deletion of snapshots past a retention window.

This is a permanent, irreversible deletion policy (the snapshot `Opportunity` and its
cascade-linked `Suggestion` records are hard-deleted, not soft-deleted), so the window itself is
the kind of non-obvious, long-term trade-off CLAUDE.md requires an ADR for.

## Decision

Snapshots older than **30 days** (`SNAPSHOT_RETENTION_DAYS` in `offsite-retention.js`) are
permanently deleted. The cutoff is evaluated as `getCreatedAt() < now - 30d` (strict
less-than: a snapshot exactly 30 days old is retained one more cycle).

Deletion runs as a side effect of a successful refresh in each of the three guidance handlers
(cited/reddit/youtube), scoped to `(siteId, auditType)`, immediately after the refresh commits.
It is wrapped in try/catch at the call site so a retention failure never fails the refresh
itself (see `docs/specs/2026-07-20-offsite-snapshot-retention.md`).

### Why 30 days

- Snapshots exist to support debugging, QA retrospectives, and the not-yet-built snapshot
  restore feature (LLMO-6153). 30 days covers a full weekly-refresh cycle with margin (four
  refreshes) for someone to notice and act on a regression before its "before" state is gone.
- It bounds storage growth to roughly one snapshot per site per audit type per week within the
  window, rather than an unbounded history — the problem this ADR's parent feature exists to
  solve.
- No SLA, compliance, or contractual retention requirement drove the number; it is a product
  judgment call, not a constraint. There is no per-customer override; all sites share the same
  window.

### Interaction with snapshot restore (LLMO-6153)

Restore is not yet built. Once it exists, a restore request against a snapshot this window has
already deleted will simply fail (the record is gone) — this ADR does not attempt to reserve
extra buffer for that case. If restore ships with its own retention expectations (e.g. "restore
must be possible for N days"), reconcile `SNAPSHOT_RETENTION_DAYS` against that requirement at
that time rather than guessing now.

## Alternatives Considered

- **Shorter window (e.g. 14 days):** tighter storage bound, but only covers two refresh cycles —
  too little margin for someone to notice and act on a regression.
- **Longer window (e.g. 90 days):** more restore-friendly, but multiplies the steady-state
  storage growth this feature is meant to bound, with no concrete requirement driving the need.
- **No fixed window; keep everything:** rejected — this is exactly the unbounded-growth problem
  LLMO-6154 exists to close.
- **Per-customer configurable window:** deferred. Adds configuration surface with no current
  demand; can be added later without changing the deletion mechanism.

## Consequences

- Any as-yet-unbuilt tooling that reads snapshots (e.g. restore, LLMO-6153) must treat "snapshot
  no longer exists" as an expected, handled case once older than 30 days.
- Changing `SNAPSHOT_RETENTION_DAYS` changes deletion behavior for all sites uniformly and takes
  effect on each site's next refresh (no backfill/immediate sweep).
- This ADR governs only the *window*. It does not cover sites that stop refreshing entirely
  (disabled or offboarded audits) — see the "Known limitation" section in
  `docs/specs/2026-07-20-offsite-snapshot-retention.md` for that gap.
