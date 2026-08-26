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
`domain=offsite audit=<cited|reddit|youtube|wikipedia|brand-presence> event=<snake_case>
outcome=<start|success|failure|skip>`, plus `direction`/`peer` on boundary lines
and `siteId`/`auditId`/`opportunityId`/`drsJobId` when known. Human prefix
`[offsite:<audit>]`. Emitted as `key=value` tokens in the message string (the log
sink does not surface a second-arg object to Splunk — see ADR 002).

### Helper — `src/utils/offsite-logging.js`
- `OFFSITE_DOMAIN`, `AUDIT`, `OUTCOME`, `PEER` enums.
- `appendFields(message, fields)` — canonical order, drops null/empty, quotes
  values with whitespace/`=`/`"`.
- `createOffsiteLogger(log, { audit, siteId, auditId, opportunityId })` →
  `start/success/skip/failure/warn/debug(event, message, extra)` (each emits one
  string arg) and `.with(moreIds)`.
- `withAuditPersistLog(audit)` — an offsite-only AuditBuilder post-processor that
  logs `audit_analysis_run_write` using the framework-set `context.audit` / `auditData.id`.

### Events (by component)
- Collector `offsite-brand-presence/handler.js`: `audit_orchestration_start`,
  `data_acquisition_start`, `data_acquisition_bp_data_source_selected`,
  `data_acquisition_bp_data_semrush_read`, `data_acquisition_bp_data_urls_resolved`,
  `data_acquisition_url_store_write`, `data_acquisition_drs_scrape_job_request_dispatched`,
  `data_acquisition_drs_scrape_job_poll_request_dispatched`,
  `audit_orchestration_guideline_store_write`, `audit_orchestration_end`,
  `audit_persistence_start`, `audit_analysis_run_write`.
- Poll `drs-status-handler.js`: `data_acquisition_drs_scrape_job_poll_checked`,
  `data_acquisition_analysis_request_dispatched`,
  `data_acquisition_drs_scrape_job_poll_request_dispatched`,
  `data_acquisition_drs_scrape_job_poll_end`.
- Analysis runners: `audit_orchestration_start`, `audit_orchestration_brand_profile_resolved`,
  `data_acquisition_start`, `data_acquisition_url_store_read`,
  `data_acquisition_drs_scrape_job_poll_checked`, `data_acquisition_end` (carries `status=`),
  `data_acquisition_drs_scrape_job_request_dispatched`,
  `audit_analysis_scope_resolved`, `audit_analysis_start`,
  `audit_persistence_start`, `audit_analysis_run_write`.
- Guidance handlers + `common/offsite-refresh.js`: `audit_analysis_end`,
  `audit_persistence_start`, `audit_persistence_mystique_payload_s3_read`,
  `audit_persistence_evergreen_opportunity_write`, `audit_persistence_opportunity_retired`,
  `audit_persistence_evergreen_opportunity_read`, `audit_persistence_end`,
  `audit_housekeeping_start`, `audit_housekeeping_outdated_opportunities_read`,
  `audit_housekeeping_outdated_opportunities_deleted`,
  `audit_housekeeping_outdated_suggestions_read`,
  `audit_housekeeping_outdated_suggestions_deleted`, `audit_housekeeping_end`.

### Gaps closed (P1–P4)
- P1: `data_acquisition_drs_scrape_job_request_dispatched` skip/failure reasons (no_ims_org,
  not_configured, submit_rejected); loud `data_acquisition_drs_scrape_job_poll_request_dispatched`
  failure + `no_jobs` skip; reschedule failure on the same event
  (re-throw preserved); per-source `data_acquisition_drs_scrape_job_poll_checked
  outcome=failure reason=budget_exceeded|scrape_failed` at deadline; per-iteration
  `data_acquisition_drs_scrape_job_poll_checked outcome=start` snapshot.
- P2: `data_acquisition_bp_data_*` success/failure/skip with `source`/`rows`;
  `data_acquisition_url_store_read` failure; self-heal `data_acquisition_drs_scrape_job_request_dispatched`
  (un-prefixed lines fixed); `data_acquisition_end` status token;
  `data_acquisition_analysis_request_dispatched` failure + cooldown skip on the same event.
- P3: `audit_analysis_start` success/failure.
- P4: `audit_analysis_run_write` (via post-processor);
  `audit_persistence_evergreen_opportunity_write` success **and** the previously-silent
  DB-write failure made loud; `audit_persistence_mystique_payload_s3_read` success/failure;
  `audit_persistence_evergreen_opportunity_write` (suggestions half); `audit_persistence_opportunity_retired`.

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
  outcome, peer` returns rows; `event=audit_persistence_evergreen_opportunity_write outcome=failure`
  and `event=data_acquisition_drs_scrape_job_poll_checked outcome=failure reason=budget_exceeded`
  are alertable; `siteId`/`auditId`/`opportunityId`/`drsJobId` appear as extracted fields.
