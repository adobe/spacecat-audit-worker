# Offsite Audits — Structured Logging

- **Status:** Implemented
- **Date:** 2026-07-31
- **Related:** ADR [002](../decisions/002-offsite-structured-logging-taxonomy.md)

## Problem statement

Offsite audit logs were inconsistent (~10 ad-hoc prefixes, hardcoded literals,
un-prefixed lines), not machine-queryable (identifiers baked into free-text
messages), and silent on the events that matter most (audit persist, opportunity
persist, and the failure modes the ops runbooks call "silent"). This makes
production debugging, Splunk dashboards/alerts, and agent-driven triage hard.

## Goals

1. One consistent, Splunk-extractable, agent-friendly logging taxonomy across the
   offsite audit code in `spacecat-audit-worker`.
2. Close the missing/incomplete-log gaps identified from the workflow and
   failure-mode analysis (P1–P4).

Non-goals: cross-service correlation id threading; any behavior/control-flow
change; changes to shared/generic utils used by non-offsite audits.

## Technical design

### Taxonomy
`domain=offsite audit=<cited|reddit|youtube|brand-presence> event=<snake_case>
outcome=<start|success|failure|skip>`, plus `direction`/`peer` on boundary lines
and `siteId`/`auditId`/`opportunityId`/`jobId` when known. Human prefix
`[offsite:<audit>]`. Emitted as `key=value` tokens in the message string (the log
sink does not surface a second-arg object to Splunk — see ADR 002).

### Helper — `src/utils/offsite-logging.js`
- `OFFSITE_DOMAIN`, `AUDIT`, `OUTCOME`, `PEER` enums.
- `appendFields(message, fields)` — canonical order, drops null/empty, quotes
  values with whitespace/`=`/`"`.
- `createOffsiteLogger(log, { audit, siteId, auditId, opportunityId, jobId })` →
  `start/success/skip/failure/warn/debug(event, message, extra)` (each emits one
  string arg) and `.with(moreIds)`.
- `withAuditPersistLog(audit)` — an offsite-only AuditBuilder post-processor that
  logs `audit_persist` using the framework-set `context.audit` / `auditData.id`.

### Events (by component)
- Collector `offsite-brand-presence/handler.js`: `audit_start`, `brand_data_load`,
  `url_extract`, `url_store_write`, `drs_submit`, `drs_poll_schedule`,
  `audit_complete`, `audit_persist`.
- Poll `drs-status-handler.js`: `drs_poll`, `analysis_dispatch`,
  `drs_poll_reschedule`, `poll_summary`, `cooldown_check`.
- Analysis runners: `audit_start`, `config_resolve`, `url_store_read`,
  `drs_availability`, `store_fetch_complete` (carries `status=`), `scrape_request`,
  `url_limit_resolve`, `mystique_dispatch`, `audit_persist`.
- Guidance handlers + `common/offsite-refresh.js`: `guidance_receive`,
  `analysis_fetch`, `opportunity_persist`, `suggestion_sync`, `opportunity_retire`,
  `opportunity_resolve`, `guidance_complete`.

### Gaps closed (P1–P4)
- P1: `drs_submit` skip/failure reasons (no_ims_org, not_configured, submit_rejected);
  loud `drs_poll_schedule` failure + `no_jobs` skip; `drs_poll_reschedule` failure
  (re-throw preserved); per-source `drs_poll outcome=failure reason=budget_exceeded|scrape_failed`
  at deadline; per-iteration `drs_poll outcome=start` snapshot.
- P2: `brand_data_load` success/failure/skip with `source`/`rows`; `url_store_read`
  failure; self-heal `scrape_request` (un-prefixed lines fixed); `store_fetch_complete`
  status token; `analysis_dispatch` failure + `cooldown` skip.
- P3: `mystique_dispatch` success/failure.
- P4: `audit_persist` (via post-processor); `opportunity_persist` success **and** the
  previously-silent DB-write failure made loud; `analysis_fetch` success/failure;
  `suggestion_sync`; `opportunity_retire`.

### Scope boundaries
Offsite-only files were converted (collector, poll, analysis + guidance handlers,
`offsite-refresh.js`, `store-client.js`, `offsite-audit-utils.js`,
`offsite-brand-presence-enrichment.js`, `offsite-brand-presence-postgrest.js`).
Shared/generic files (`analysis-fetch.js`, `brand-resolver.js`, `base-audit.js`,
`data-access.js`) were left untouched; their offsite boundaries are logged from the
offsite caller.

## Alternatives

See ADR 002 (positional bracket triple; second-arg object; editing base-audit;
runId threading).

## Success criteria

- `npm test` green with the 100% coverage gate.
- In Splunk (`service=audit-worker domain=offsite`): `stats count by audit, event,
  outcome, peer` returns rows; `event=opportunity_persist outcome=failure` and
  `event=drs_poll outcome=failure reason=budget_exceeded` are alertable;
  `siteId`/`auditId`/`opportunityId`/`jobId` appear as extracted fields.
