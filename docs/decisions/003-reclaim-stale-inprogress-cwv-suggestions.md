# 003 — CWV Re-audit Reclaims Stale Stuck `IN_PROGRESS` Suggestions

- **Status:** Accepted
- **Date:** 2026-08-07

## Context

Mystique flips a CWV `CODE_CHANGE` suggestion to `IN_PROGRESS` the moment it
finishes generating a code-fix patch and hands it off for deploy — that status
is the deploy hand-off signal, and it is the sole trigger consumed by the
autofix-worker. On the large majority of sites `cwv-auto-fix` is **off**, so
nothing ever consumes the hand-off: the suggestion sits `IN_PROGRESS` forever.

The CWV re-audit (`syncOpportunitiesAndSuggestions`) preserves `IN_PROGRESS` on
every run (it is in the merge skip-set), so these never self-heal. They
**accumulate every weekly audit** and pile up in the customer-facing "Deployed"
tab, even though the patch is ready and no deploy is or ever will be in flight.
A transient upstream outage (e.g. the Aug 2026 clientlib-builder outage that
stranded ~2,048 suggestions across ~203 sites) produces the same end state at
scale.

The durable fix (blackboard V2) is far off. We need a near-term, self-healing
mechanism that does **not** disturb sites that legitimately do auto-deploy.

## Decision

Add a CWV-specific `mergeStatusFunction` (`createMergeCwvStatus`) to the
`syncSuggestions` call in `syncOpportunitiesAndSuggestions`. On re-audit it
reclaims a matched suggestion `IN_PROGRESS → NEW` **only when all** of the
following hold:

1. the suggestion is `IN_PROGRESS`;
2. it has **no active fix entity** — no `FixEntity` with status
   `PENDING`/`DEPLOYED`/`PUBLISHED` references it (keyed by
   `changeDetails.suggestionId`); and
3. it is **stale** — more than `STALE_IN_PROGRESS_MS` (24h) since `updatedAt`.

Every other case delegates to the existing `defaultMergeStatusFunction`,
preserving its `OUTDATED`-regression and `ERROR → NEW` behaviour unchanged.

Fetching the opportunity's fix entities is wrapped in try/catch. On **any**
failure we set `fixFetchFailed` and skip reclaim entirely for that run
(fail-safe) rather than risk reclaiming a suggestion whose deploy is genuinely
in flight.

## Why this is safe

- **No data loss.** The generated patch lives in `suggestion.data`; only the
  status flips. A reclaimed suggestion is a `NEW` suggestion with its patch
  intact (`isCodeChangeAvailable === true`), so it re-surfaces as actionable and
  is **not** re-dispatched for regeneration.
- **Never touches a live deploy.** The active-fix guard skips anything with a
  `PENDING`/`DEPLOYED`/`PUBLISHED` fix; the 24h staleness window is far longer
  than a normal deploy hand-off, so a freshly-set `IN_PROGRESS` is never
  reclaimed mid-flight.
- **Reversible.** The flip is a plain status change via the same API.
- **Fail-safe.** A fix-entity fetch error disables reclaim for that run.

## Alternatives Considered

- **Fix at the source in the autofix-worker** (revert `IN_PROGRESS → NEW` when
  the deploy hand-off is never consumed). This is the correct long-term home and
  is partly addressed by autofix-worker #686 for the no-PR/`CM_STANDARD`
  structural strand, but it does **not** cover the transient-outage strand (the
  worker never receives a result to act on) and does not clean up the backlog
  already stuck. The re-audit reclaim is the one place that runs periodically on
  every site regardless of deploy channel.
- **A scheduled cleanup job** that sweeps stale `IN_PROGRESS`. Rejected as the
  primary mechanism: another moving part to operate and monitor, when the
  re-audit already visits every site on a cadence and holds the fix-entity
  context needed for the active-deploy guard.
- **Reclaim regardless of age (no staleness window).** Rejected: would race a
  legitimate, freshly-set `IN_PROGRESS` on an auto-deploy site before its fix
  entity exists.
- **Reclaim regardless of fix entities.** Rejected: would disturb real in-flight
  and live deploys.

## Consequences

- On the first re-audit after this ships, each site's accumulated stale
  `IN_PROGRESS` suggestions flip to `NEW` in one pass (a one-time cleanup,
  bounded per site). This is customer-visible: stuck "Deployed" items reappear
  as actionable "Current" items — the intended outcome.
- Suggestions whose fix entity is a **stuck `PENDING`** (e.g. a deploy PR that
  was opened but never merged) are deliberately **not** reclaimed by this path;
  they are handled separately (`delete-cwv-fixes`).
- The 24h threshold is the one tuning knob. If a deploy pipeline can legitimately
  hold a suggestion `IN_PROGRESS` with no fix entity for longer than 24h, raise
  `STALE_IN_PROGRESS_MS`.
