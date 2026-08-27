# 005 — Offsite Event Taxonomy: Remove `reasonCategory`

- **Status:** Accepted
- **Date:** 2026-08-25
- **Supersedes (in part):** ADR [003](003-offsite-event-taxonomy-phase-boundaries.md)'s
  `reasonCategory` field (point 5 of its Decision section, its "A `severity` field instead of
  `reasonCategory`" alternative, and its Consequences bullet on `reasonCategory` as "the primary
  alerting split going forward"). ADR 003's five-phase boundary structure and event mergers are
  unaffected.

## Context

ADR 003 introduced `reasonCategory` (`config`/`infra`/`expected`) as a second axis alongside
`reason`, meant to let a single Splunk query or alert separate "an operator needs to fix a
customer's setup" from "on-call needs to look at infrastructure" from "nothing is actually wrong
here" — a question ADR 003 argued log level and `outcome` couldn't answer on their own.

A full pass over every `outcome`/level assignment in the pipeline (covering all ~40 events across
orchestration, data acquisition, analysis, persistence, and housekeeping) surfaced two problems
with that design in practice:

1. **`reasonCategory` never carried information `reason` didn't already determine.** Every `reason`
   code was assigned exactly one `reasonCategory` value, fixed at the call site, every time it
   appeared — a deterministic 1:1 mapping, not an independent signal. It was never read or branched
   on anywhere in the code; a repo-wide check confirmed all 168 occurrences were plain object-literal
   assignments alongside their `reason`.
2. **The category it tried to express is answerable without a field at all.** The same review
   settled a sharper definition for `outcome` and `level`: `outcome` asks "compared to a fully
   successful run, what did this step actually deliver" (`skip` = nothing was owed, `success` =
   delivered in full, `degraded` = fell short but something still comes out the other end, `failure`
   = fell short and nothing recovers it); `level` then asks a genuinely separate question — `error`
   is reserved exclusively for `outcome=failure`, `warn` covers `degraded` and any `skip` that still
   represents a real deviation from the full happy path, `info`/`debug` are the nominal path. Once
   `level` reliably means "does this deserve attention" on its own, a second field for "whose fault"
   is answerable from `reason` and this document's own prose — it doesn't need to be logged and
   indexed on every line.

## Decision

Remove the `reasonCategory` field from every structured log call in the offsite pipeline (19
source files, ~40 events). Alerting and triage now operate on `level` + `outcome` alone:

- `error` (always paired with `outcome=failure`) is the page-worthy signal — an owed
  customer-facing Opportunity genuinely failed to arrive this cycle, and nothing recovers it.
- `warn` (`degraded`, or a `skip` representing a real deviation) is visible for trend-watching and
  dashboards but does not page by default.
- `info`/`debug` are pure telemetry.

The customer-config-vs-infra-vs-expected distinction `reasonCategory` used to encode is still
meaningful and still documented — just as prose, per `reason` code, in
[05-logging.md](../../01-knowledge-base/04-operational/05-logging.md) and
[04-failure-modes.md](../../01-knowledge-base/04-operational/04-failure-modes.md) (an internal
knowledge-base repo, not part of this codebase), rather than as a logged, indexed field.

## Alternatives Considered

- **Keep `reasonCategory` as a static `reason`→category reference table, documented but not
  logged.** This would have preserved the categorical framing for anyone building a new alert while
  still removing the redundant per-line field. Rejected in favor of dropping the categorical
  framing entirely: once `level` reliably means "does this need attention," maintaining a second,
  parallel classification scheme for "whose fault" added a document to keep in sync for a
  distinction that direct prose already covers per event.
- **Leave `reasonCategory` in place and just stop asserting it in new code going forward.** Rejected:
  a field that's sometimes present and sometimes not is worse than either fully present or fully
  absent — it invites exactly the kind of drift (a field documented as essential while quietly
  disappearing from new call sites) this ADR is fixing.

## Consequences

- Any Splunk search, dashboard, or alert rule that filtered on `reasonCategory` (e.g. "page on
  `error` AND `reasonCategory != config`") must be rewritten to key off `level`/`outcome`/`reason`
  directly — there is no dual-emission period; the field is gone everywhere at once.
- Every log line's field count drops by one; no other field's meaning or shape changes.
- ADR 003's five-phase boundary structure, its event mergers (`snapshotAction`, the
  `firstSchedule` boolean, etc.), and its `_start`/`_end` invariants are unaffected and remain in
  force — only the `reasonCategory` field itself is removed.
