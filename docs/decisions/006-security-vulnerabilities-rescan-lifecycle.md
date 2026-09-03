# 006 — Security-Vulnerabilities Suggestion Lifecycle: FixEntity-Aware Reconcile

- **Status:** Accepted
- **Date:** 2026-09-01 (revised 2026-09-02)
- **Spec:** [2026-09-02 fixed-lifecycle reconcile](../specs/2026-09-02-security-vulnerabilities-fixed-lifecycle-reconcile.md)

> **Revision note (2026-09-02):** this ADR was rewritten to the implemented model.
> The original decisions (PR-open lands `IN_PROGRESS`; a disappeared `NEW` finding
> ages to `OUTDATED`; a regression reopens the record in place) were superseded
> during implementation — see the sections below and the spec.

## Context

ASO records each vuln finding as a `Suggestion` and (once an autofix PR is
produced) a `FixEntity`. The two have **separate** status lifecycles. Opening the
autofix PR is **intended to set the Suggestion `FIXED`** while the shared
`addFixEntities` stamps the `FixEntity` `PENDING`. So `PENDING` vs `DEPLOYED` on
the FixEntity **encodes the verification level** of a `FIXED` suggestion —
`FIXED + PENDING` = *asserted*, `FIXED + DEPLOYED` = *scan-verified*. That is a
legitimate intermediate state, not drift.

The vuln report is a scan of the **deployed AEM CS environment**
(TrustCenter/Starfish), so a component **disappearing** from a later scan is a
production-grade "the fix shipped" signal — no separate merge/publish detector is
needed. What was missing: nothing reconciled the pair against later scans (an
asserted fix was never confirmed, a regression stayed masked, an abandoned
assertion masked a live vuln forever), and a customer self-fix (a finding that
disappears with no FixEntity because the customer bumped the dependency
themselves) was lost as `OUTDATED` instead of recorded as fixed.

## Decision

The audit worker (`src/vulnerabilities/handler.js`) is the reconciler. A single
pass, `reconcileVulnSuggestions`, owns **every** vuln Suggestion status
transition against each scan, joining each suggestion to its `FixEntity`. It runs
**before** the base `syncSuggestions` (which then only creates brand-new findings
and refreshes present ones, with a status-neutral merge). The decision table:

1. **Customer self-fix.** An open finding (`NEW`/`PENDING_VALIDATION`) that
   disappears with **no** FixEntity → Suggestion `FIXED` **and create** a
   `DEPLOYED` FixEntity stamped `origin = customer-self-fix` (a new shared
   `FixEntity.ORIGINS` value), so a self-fix is distinguishable from the automated
   pipeline (`spacecat`).
2. **Rescan confirms an asserted fix.** `FIXED + PENDING`, vuln **gone** → promote
   `PENDING → DEPLOYED` (+ stamp `deployedAt`); the suggestion stays `FIXED`.
3. **Regression.** `FIXED + DEPLOYED`, vuln **back** → **archive** the old
   suggestion to `OUTDATED` and **open a fresh** `NEW` (or `PENDING_VALIDATION`)
   finding for the live vuln; roll the fix `DEPLOYED → ROLLED_BACK`. The `FIXED`
   record is never mutated in place — history stays clean.
4. **Fresh assertion, vuln still present** → wait (no change).
5. **Stale assertion.** `FIXED + PENDING`, vuln still present past **30 days**
   (from `executedAt`, `deployedAt` empty) → archive old to `OUTDATED`, open a
   fresh finding, fail the fix `PENDING → FAILED`.

Supporting invariants:

- **The base sync makes no status decisions for vulns** (`mergeStatusFunction`
  returns `null`). The default merge flips an existing `OUTDATED` whose vuln
  reappears back to `NEW`, which would resurrect the record a regression just
  archived; reconcile owns regression instead, FixEntity-aware.
- **Move the pair together, safely:** a self-fix FixEntity is created **before**
  its suggestion is flipped `FIXED` (never `FIXED` without a backing fix);
  suggestion writes are persisted **before** the fix-entity transitions, so a
  trailing fix-save failure can't strand a reopen. Any error fetching the fix
  entities skips the whole pass for that run rather than acting on incomplete data.
- **`DEPLOYED` is terminal** for vulns — the deployed-env scan already captures
  merge + deploy, so the publish step is skipped.

`FIXED→OUTDATED`, `NEW→FIXED`, `PENDING→DEPLOYED`, `DEPLOYED→ROLLED_BACK`, and
`PENDING→FAILED` are all legal transitions, and `STATUS_TRANSITION_ENFORCEMENT`
defaults to `warn`. The one shared change is additive: the new
`FixEntity.ORIGINS.CUSTOMER_SELF_FIX` value (`@adobe/spacecat-shared-data-access`
≥ 4.28.0).

## Consequences

- `FIXED` means the vuln is actually gone from the deployed environment — verified
  by a scan (`DEPLOYED`) or asserted by an operator (`PENDING`), the two
  distinguished by the FixEntity status.
- Regressions reopen automatically as a fresh finding (the old one archived to
  `OUTDATED`); an unverified assertion cannot mask a live vuln beyond 30 days.
- A customer self-fix is recorded as `FIXED` with an attributable FixEntity, not
  silently aged out.
- The audit issues one extra bulk `getSuggestions` per audit (reconcile + base
  sync), by design, so the base sync sees post-reconcile statuses.
- Rows written under the old semantics are handled forward by the reconcile; no
  backfill is required.

## Alternatives Considered

- **Reopen the regressed record in place (`FIXED → NEW`).** Rejected — a returned
  vuln is a new finding; archive the old to `OUTDATED` and open a fresh one so the
  history reads cleanly.
- **Age a disappeared open finding to `OUTDATED` (original D2).** Rejected — it
  loses the "resolved" signal and the attribution; a self-fix is a real fix.
- **Keep an `IN_PROGRESS`-confirmation pass (original D1).** Removed — PR-open
  lands `FIXED`, so no vuln suggestion is `IN_PROGRESS`; the pass was dead code.
- **Let the base sync's default `OUTDATED → NEW` handle regression.** Rejected —
  not FixEntity-aware (can't tell a regression from a not-yet-deployed assertion).
- **A separate merge/publish detector (SITES-47076).** Not needed — the
  deployed-env scan captures merge + deploy in one authoritative signal.
- **Mark the self-fix via `changeDetails` instead of a new `origin` value.**
  Rejected — `origin` is the first-class provenance field; `reporting` set the
  precedent of adding a producer value, so `customer-self-fix` follows it.

## References

- Spec: `docs/specs/2026-09-02-security-vulnerabilities-fixed-lifecycle-reconcile.md`.
- `ASO/PHASES.md` (sidecar spec) — §5 D1–D4, §10 (reconcile model).
- Jira: SITES-49306 (CWV parity), SITES-47076 (merge/publish detector), SITES-47091
  (status-transition enforcement).
- `@adobe/spacecat-shared-data-access` #1911 — `FixEntity.ORIGINS.CUSTOMER_SELF_FIX`.
- mysticat-architecture ADR #174 (Suggestion/Fix status lifecycle), #200
  (`changeDetails` provenance).
- Reference implementation: `src/backlinks/handler.js` (the other
  publish-detection consumer); related ADR
  `003-reclaim-stale-inprogress-cwv-suggestions.md` (CWV staleness precedent).
