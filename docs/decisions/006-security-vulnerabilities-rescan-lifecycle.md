# 006 — Security-Vulnerabilities Suggestion Lifecycle: Rescan-Confirmed `FIXED` and FixEntity-Aware Reconcile

- **Status:** Accepted
- **Date:** 2026-09-01

## Context

ASO records each vuln finding as a `Suggestion` and (once an autofix PR is
produced) a `FixEntity`. The two have **separate** status lifecycles. Previously
the autofix worker marked the suggestion `FIXED` the moment it opened the PR,
while the shared `addFixEntities` stamped the `FixEntity` `PENDING` — so a
customer saw "Fixed" before the PR merged, and the two records disagreed.

The vuln report is a scan of the **deployed AEM CS environment**
(TrustCenter/Starfish), so a component **disappearing** from a later scan is a
production-grade "the fix shipped" signal — no separate merge/publish detector is
needed.

Beyond the initial "confirm on rescan" fix, the (Suggestion, FixEntity) pair has
**three valid states** that a periodic reconcile must keep consistent against
each scan:

- **In flight** — `IN_PROGRESS + PENDING` (PR open, customer's court).
- **Verified fixed** — `FIXED + DEPLOYED` (a scan confirmed the vuln is gone).
- **Asserted fixed** — `FIXED + PENDING` (an operator marked it fixed in the
  backoffice; not yet scan-verified). `PENDING` vs `DEPLOYED` now encodes the
  **verification level**, so this is a legitimate intermediate state, not drift.

## Decision

The audit worker (`src/vulnerabilities/handler.js`) is the reconciler. Per the
locked plan (`ASO/PHASES.md` §5 D1–D4, §10):

1. **PR-open lands `IN_PROGRESS`, not `FIXED`** (autofix worker; D1). Two — and
   only two — paths reach `FIXED`: rescan-confirmation and manual override.
2. **Rescan → `FIXED` only for autofixed suggestions** (D2). A disappeared
   `IN_PROGRESS` (autofixed) suggestion → `FIXED`; a disappeared `NEW` (customer
   bumped the dep themselves) → `OUTDATED`, never `FIXED`.
3. **The scan is the prod signal** (D3/D4). Skip the publish step; `DEPLOYED` is
   terminal for vulns.
4. **FixEntity-aware reconcile of already-`FIXED` suggestions** (§10), in
   `reconcileFixedVulnSuggestions`, joining each `FIXED` suggestion to its active
   (`PENDING`/`DEPLOYED`) fix:
   - `FIXED + PENDING`, vuln **gone** → asserted fix confirmed: promote
     `PENDING → DEPLOYED` (+ stamp `deployedAt`); the suggestion stays `FIXED`.
   - `FIXED + DEPLOYED`, vuln **back** → regression: reopen the suggestion
     (`NEW`, or `PENDING_VALIDATION` on validation-required sites) and roll the
     fix `DEPLOYED → ROLLED_BACK`.
   - `FIXED + PENDING`, vuln **present, fix fresh** → wait (expected pre-deploy).
   - `FIXED + PENDING`, vuln **present, fix stale** (unconfirmed for more than
     **30 days** from the fix's `executedAt`, with `deployedAt` still empty) →
     reopen the suggestion and fail the abandoned fix `PENDING → FAILED`.
5. **Stamp `deployedAt` on every `PENDING → DEPLOYED` promotion** — a durable
   "verified" marker driving the verified-vs-asserted UX.

Supporting invariants:

- **The reopen decision is FixEntity-aware:** a re-detected `FIXED` whose fix is
  `DEPLOYED` is a regression; whose fix is `PENDING` is not-yet-deployed. A
  suggestion-only rule is wrong here.
- **Move the pair together:** every reconciliation writes both sides. Reopened
  suggestions are persisted **before** the fix-entity transition, so a trailing
  fix-save failure cannot strand a reopened suggestion in a stuck `FIXED` state
  on the next audit.
- **Fail-safe:** any error fetching the fix entities skips the whole
  FIXED-reconcile pass for that run rather than acting on incomplete data.

All of this lands in `spacecat-audit-worker`. `FIXED→NEW`, `PENDING→DEPLOYED`,
`DEPLOYED→ROLLED_BACK`, and `PENDING→FAILED` are already legal transitions, and
`STATUS_TRANSITION_ENFORCEMENT` defaults to `warn`, so no shared-package change is
required.

## Consequences

- Customers see `IN_PROGRESS` between PR-open and the confirming scan (the honest
  state); `FIXED` means the vuln is actually gone from the deployed environment,
  or an operator explicitly asserted it.
- Regressions reopen automatically and re-enter autofix; an unverified manual
  assertion cannot mask a live vuln beyond the 30-day window.
- The audit worker issues one extra bulk `getSuggestions` per audit (base sync +
  FIXED reconcile), by design, so the reconcile sees post-sync statuses.
- Rows written under the old semantics (`FIXED` + `PENDING`) are handled forward
  by the reconcile (confirmed → promoted, or reopened once stale); a separate
  backfill is optional, not required for the forward fix.

## Alternatives Considered

- **Promote the existing `PENDING` fix vs. create a new `DEPLOYED` one.** Promote
  in place — preserves PR-url provenance and avoids two FixEntities per fix. A
  fresh `DEPLOYED` entity is created only as a fallback when no `PENDING` exists.
- **Suggestion-only reopen rule.** Rejected: it cannot distinguish a regression
  (`DEPLOYED`) from a not-yet-deployed assertion (`PENDING`).
- **A separate merge/publish detector (SITES-47076).** Not needed for vulns — the
  deployed-env scan already captures merge + deploy in one authoritative signal.
- **Reopen regardless of staleness / fix state.** Rejected: it would race
  legitimate pre-deploy assertions and re-open freshly-fixed items.

## References

- `ASO/PHASES.md` (sidecar spec) — §5 D1–D4 (locked), §10 (reconcile model).
- Jira: SITES-49306 (CWV parity), SITES-47076 (merge/publish detector +
  migration), SITES-47091 (status-transition enforcement).
- mysticat-architecture ADR #174 (Suggestion/Fix status lifecycle), #200
  (`changeDetails` provenance).
- Reference implementation: `src/backlinks/handler.js` (the other
  publish-detection consumer); related ADR
  `003-reclaim-stale-inprogress-cwv-suggestions.md` (CWV staleness precedent).
