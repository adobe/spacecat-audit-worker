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
  logs `audit_persistence_run_recorded` using the framework-set `context.audit` / `auditData.id`.

### Events (by component)
- Collector `offsite-brand-presence/handler.js`: `audit_orchestration_started`,
  `data_acquisition_bp_data_source_selected`, `data_acquisition_bp_data_semrush_read`,
  `data_acquisition_bp_data_urls_extracted_enriched`, `data_acquisition_store_urls_written`,
  `data_acquisition_scrape_job_submitted`, `data_acquisition_scrape_job_poll_scheduled`,
  `audit_orchestration_guideline_store_written`, `audit_orchestration_completed`,
  `audit_persistence_run_recorded`.
- Poll `drs-status-handler.js`: `data_acquisition_scrape_job_status_polled`,
  `data_acquisition_analysis_request_handoff`, `data_acquisition_scrape_job_poll_rescheduled`,
  `data_acquisition_scrape_job_poll_summary_notified`, `data_acquisition_cooldown_checked`.
- Analysis runners: `audit_orchestration_started`, `audit_orchestration_brand_profile_resolved`,
  `data_acquisition_store_urls_read`, `data_acquisition_scrape_job_status_polled`,
  `data_acquisition_completed` (carries `status=`), `data_acquisition_scrape_job_submitted`,
  `audit_analysis_url_limit_resolved`, `audit_analysis_mystique_request_handoff`,
  `audit_persistence_run_recorded`.
- Guidance handlers + `common/offsite-refresh.js`: `audit_analysis_completed`,
  `audit_persistence_payload_fetched`, `audit_persistence_opportunity_persisted`,
  `audit_persistence_suggestions_synced`, `audit_persistence_opportunity_retired`,
  `audit_persistence_opportunity_resolved`, `audit_persistence_completed`.

### Gaps closed (P1–P4)
- P1: `data_acquisition_scrape_job_submitted` skip/failure reasons (no_ims_org,
  not_configured, submit_rejected); loud `data_acquisition_scrape_job_poll_scheduled`
  failure + `no_jobs` skip; `data_acquisition_scrape_job_poll_rescheduled` failure
  (re-throw preserved); per-source `data_acquisition_scrape_job_status_polled
  outcome=failure reason=budget_exceeded|scrape_failed` at deadline; per-iteration
  `data_acquisition_scrape_job_status_polled outcome=start` snapshot.
- P2: `data_acquisition_bp_data_*` success/failure/skip with `source`/`rows`;
  `data_acquisition_store_urls_read` failure; self-heal `data_acquisition_scrape_job_submitted`
  (un-prefixed lines fixed); `data_acquisition_completed` status token;
  `data_acquisition_analysis_request_handoff` failure + `data_acquisition_cooldown_checked` skip.
- P3: `audit_analysis_mystique_request_handoff` success/failure.
- P4: `audit_persistence_run_recorded` (via post-processor);
  `audit_persistence_opportunity_persisted` success **and** the previously-silent
  DB-write failure made loud; `audit_persistence_payload_fetched` success/failure;
  `audit_persistence_suggestions_synced`; `audit_persistence_opportunity_retired`.

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
  outcome, peer` returns rows; `event=audit_persistence_opportunity_persisted outcome=failure`
  and `event=data_acquisition_scrape_job_status_polled outcome=failure reason=budget_exceeded`
  are alertable; `siteId`/`auditId`/`opportunityId`/`drsJobId` appear as extracted fields.
