# 003 — Offsite Event Taxonomy: Phase Boundaries

- **Status:** Accepted
- **Date:** 2026-08-25
- **Supersedes:** the event-naming section of ADR [002](002-offsite-structured-logging-taxonomy.md)

## Context

ADR 002 established the `key=value` taxonomy (`domain`/`audit`/`event`/`outcome`/`peer`/`direction`
plus ids) and closed the original silent-event gaps. In practice the event names it introduced
grew organically, one gap at a time, rather than from a single map of the pipeline's phases. That
produced three recurring problems:

1. **Inconsistent or missing phase boundaries.** Some phases had a clear `_started`/`_completed`
   pair (`audit_orchestration_started` / `audit_orchestration_completed`); others had none
   (`data_acquisition`, `audit_persistence`, `audit_housekeeping` had no unconditional start
   marker at all), so "did this phase even begin?" wasn't always answerable from the logs alone.
2. **One event, several unrelated questions.** Names like `data_acquisition_analysis_dispatched`
   and `data_acquisition_cooldown_checked` described two different, tightly-coupled steps of the
   same control-plane decision (dispatch a content type's analysis once its scrape is ready) as if
   they were separate events, while genuinely distinct outcomes of a single step (e.g. every way a
   scrape submission can succeed, retry, or fail) were sometimes split across several names.
3. **Control-plane decisions attributed to the wrong phase.** Some events that decide *whether and
   when* to move an audit forward (brand scope resolution, the URL-limit override, the
   analysis-request dispatch) were named as if they belonged to data acquisition or analysis,
   purely because of where in the code they happened to fire, rather than what kind of decision
   they represent.

None of this was a correctness bug — the events fired, and outcome/reason fields were present —
but it made the taxonomy harder to teach, harder to alert on consistently, and harder for an
on-call engineer or an agent to reconstruct "which of the five phases got how far" for a given run
without already knowing the code.

## Decision

We re-partitioned the offsite event taxonomy into five phases — `audit_orchestration`,
`data_acquisition`, `audit_analysis`, `audit_persistence`, `audit_housekeeping` — each with a real,
unconditional `_start`/`_end` boundary pair, and reassigned/merged events along phase and
question boundaries rather than code-location boundaries.

1. **Every phase gets an unconditional `_start` and `_end`, with no exceptions.** Even phases that
   previously had no explicit start marker (`data_acquisition`, `audit_persistence`,
   `audit_housekeeping`) now emit one unconditionally, as the first line of that phase's work. This
   makes "how far did this run get" a single grep across five event names, independent of audit
   type or outcome, instead of inferring phase boundaries from whichever event happened to fire
   next.

2. **Control-plane decisions live in `audit_orchestration`, regardless of when they fire at
   runtime.** Brand scope resolution (`audit_orchestration_brand_scope_resolved`), the
   analysis-request URL-limit resolution (`audit_orchestration_analysis_url_limit_resolved`), and
   the analysis-request dispatch (`audit_orchestration_analysis_request_dispatched`) are all
   orchestration decisions — they decide *whether/how* an analysis proceeds — even though the
   dispatch physically fires from the DRS status poll once a scrape reaches a terminal state, well
   after the phase's own `_start` line. Naming by decision-kind rather than call-site keeps every
   "should this run happen, and with what scope/limit" question in one place, instead of splitting
   it between orchestration and data-acquisition depending on which function happened to contain
   the check.

3. **`audit_analysis` stays deliberately thin.** It carries only `audit_analysis_start` (assemble
   and send the Mystique request) and `audit_analysis_end` (the completed result comes back).
   Mystique owns everything in between — validation, its own content lookup, the LLM call, the
   quality gate — and audit-worker has no visibility into any of it. Adding intermediate events
   here would either be fabricated (audit-worker doesn't know what's happening on the Mystique
   side) or would require cross-service correlation we explicitly deferred in ADR 002. The phase's
   job is to bracket the hand-off, not narrate it.

4. **Events that answered overlapping questions were merged under one event name**, distinguished
   by `reason` and, where a single lifecycle has multiple checkpoint-like states, `snapshotAction`
   — instead of minting a new event name per checkpoint. For example:
   - `data_acquisition_scrape_job_poll_scheduled` and `data_acquisition_scrape_job_poll_rescheduled`
     answered the same underlying question ("was the next status check successfully queued?") for
     the initial schedule and every subsequent reschedule; they merged into
     `data_acquisition_scrape_job_poll_request_dispatched`, with a `firstSchedule` boolean telling
     the two cases apart instead of two event names.
   - `audit_persistence_snapshot_prepared`, `audit_persistence_snapshot_suggestions_copied`, and
     `audit_persistence_snapshot_cleaned_up` were three names for one lifecycle (decide
     reuse-vs-create a preserved copy, copy its recommendations, clean up if that copy failed
     outright); they merged into `audit_persistence_snapshot_opportunity_write`, with
     `snapshotAction` (`reused`|`creating`|`created`|`skipped`) tracking the prepare/reuse/create
     decision and `reason` (`suggestions_copy_failed`|`orphan_cleanup_failed`) distinguishing the
     two ways the recommendation-copy step can fail.
   - `audit_persistence_opportunity_persisted` and `audit_persistence_suggestions_persisted`
     covered the two halves of the same save (the opportunity record, its recommendations) that
     always happen back to back for the same result; they merged into
     `audit_persistence_evergreen_opportunity_write`, with `reason=opportunity_write_failed` vs.
     `reason=suggestions_write_failed` keeping the two failure modes unmistakable despite sharing
     an event name.

   This keeps the event-name count proportional to the number of distinct *questions* an operator
   or dashboard asks ("did the poll get rescheduled", "did the save land"), not to the number of
   code paths that can produce an answer.

5. **`reasonCategory` classifies every `reason`.** Every `reason` code now carries a
   `reasonCategory` of `config` (a customer/site/org misconfiguration or eligibility gap, e.g.
   `no_ims_org`, `no_company_name`), `infra` (a technical/system failure, transient or not, e.g.
   `opportunity_write_failed`, `brand_resolution_failed`), or `expected` (a deliberate, working-as-
   designed no-op, e.g. `cooldown`, `no_suggestions`). This is additive to ADR 002's existing
   `reason` field, not a replacement for it, and lets a single Splunk query or alert separate "an
   operator needs to fix a customer's setup" from "on-call needs to look at infrastructure" from
   "nothing is actually wrong here" — the three questions that previously required knowing, per
   `reason` code, which bucket it fell into.

6. **New events with no prior form** were added where a phase genuinely had no unconditional start
   before: `data_acquisition_start`, `audit_persistence_start`, `audit_housekeeping_start`.

This decision supersedes ADR 002's event-naming section (the specific event names it introduced
for orchestration, data acquisition, analysis, persistence, and housekeeping). ADR 002's other
decisions — the `key=value`-in-message-string taxonomy shape, the shared `offsite-logging.js`
helper, the offsite-only post-processor pattern for the audit-persist log, and the
`skip`-vs-`warn` / `errorField()` conventions — are unaffected and remain in force.

## Alternatives Considered

- **Keep the original per-gap event names and only add the missing `_start` markers.** Rejected:
  it would have closed problem #1 above but left the overlapping-question and
  wrong-phase-attribution problems in place, so the taxonomy would still require reading code to
  know which events belong together.
- **One event per code path (status quo direction).** Rejected: this is how the taxonomy accreted
  its inconsistencies in the first place — every new gap or edge case got its own event name,
  which scales with the number of `if` branches in the code rather than with the number of
  questions an operator actually asks. `reason`/`snapshotAction` scale with questions instead.
- **Name events by call site instead of by decision-kind.** Rejected for the control-plane events
  (brand scope, URL limit, dispatch): naming `audit_orchestration_analysis_request_dispatched` as
  a `data_acquisition_*` event because it fires from the DRS poll handler would optimize for "easy
  to find in the code" over "easy to reason about as a decision" — and the code that emits an event
  changes far more often than the phase it conceptually belongs to.
- **Give `audit_analysis` intermediate events by inferring Mystique's internal steps from timing
  gaps.** Rejected: audit-worker has no ground truth for what Mystique is doing between the request
  and the result; fabricating intermediate checkpoints would be guesswork dressed up as
  observability. If Mystique's own internal steps need visibility, that belongs in Mystique's own
  logging, correlated by `auditId`/request id — not invented on the audit-worker side.
- **A `severity` field instead of `reasonCategory`.** Rejected: severity (info/warn/error) is
  already carried by the log level and by `outcome`. `reasonCategory` answers a different question
  — *whose problem is this* (customer config, our infra, or nobody's) — which doesn't map onto log
  level (a `config` gap is often logged at `warn`, an `expected` no-op sometimes at `error` for
  visibility, e.g. `data_acquisition_url_store_read`'s `store_empty_after_scrape`).

## Consequences

- Every offsite run now has exactly five `_start`/`_end` boundary pairs to check, regardless of
  audit type or how far the run got — `stats count by audit, event` where `event` ends in `_start`
  or `_end` gives a phase-completion funnel for free.
- Dashboards and alerts built against ADR 002's original event names (e.g.
  `audit_persistence_opportunity_persisted`, `data_acquisition_scrape_job_submitted`) must be
  updated to the current names; there is no dual-emission period — the rename happened in the same
  change as the phase re-partitioning to avoid a window where two names mean the same thing.
- `reasonCategory=config` vs `infra` vs `expected` becomes the primary alerting split going
  forward: infra-tagged failures should page, config-tagged ones should route to an operator
  worklist, expected-tagged ones should never alert regardless of log level.
- This ADR documents the *decision* (why the phases and mergers look the way they do), not a
  field-by-field spec of every event's exact fields and example log lines, to avoid drifting out
  of sync with the implementation's own detail over time.
