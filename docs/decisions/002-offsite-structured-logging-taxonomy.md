# 002 — Offsite Audits: Structured Logging Taxonomy

- **Status:** Accepted
- **Date:** 2026-07-31

## Context

The offsite audits (`offsite-brand-presence` and the `cited-analysis` /
`reddit-analysis` / `youtube-analysis` family, plus their `guidance-handler`s)
logged through ~10 ad-hoc bracket prefixes (`[OffsiteBrandPresence]`, `[Cited]`,
`[offsite-brand-presence][drs-status]`, `[OffsiteRefresh]`, …), several
hardcoded literal prefixes, and a handful of fully un-prefixed lines.
Identifiers were interpolated into free-text messages, so Splunk dashboards had
to fall back to `stats count by message` (brittle — interpolated IDs make each
message near-unique). Several load-bearing events were **silent**: the `Audit`
persist, the `Opportunity` persist (the terminal success), and every failure
mode the ops docs describe as "fails silently / no explicit failure logged"
(DRS poll dropping a source at the 3-hour budget, the re-poll send dying, the
DB write that is acked without retry, etc.).

We wanted one consistent, machine-parseable taxonomy that serves human
debugging, Splunk queries/dashboards/alerts, and agents — and to close the
silent-event gaps.

## Decision

1. **A single taxonomy, emitted as `key=value` tokens in the message string.**
   Every offsite log line carries `domain=offsite`, `audit=<cited|reddit|youtube|wikipedia|brand-presence>`,
   `event=<snake_case>`, `outcome=<start|success|failure|skip>`; boundary lines add
   `direction=<inbound|outbound>` and `peer=<drs|mystique|url_store|s3|postgres|sharepoint|semrush|slack|sqs|spacecat>`,
   plus ids (`siteId`, `auditId`, `opportunityId`, `drsJobId`) when available. A thin
   human prefix `[offsite:<audit>]` is kept for eyeball scanning.

2. **Fields go in the message string, NOT a second-arg object.** The production
   log sink renders a second-arg object via `util.inspect` (JS-literal,
   single-quoted), which Splunk's `key=value` auto-extractor cannot read. Plain
   `key=value` text in the message is Splunk-extractable and logger-agnostic. This
   mirrors the existing `common/context-logger.js` precedent and the platform's
   own `[jobId=…] [traceId=…]` tokens.

3. **A shared helper — `src/utils/offsite-logging.js`.** Exposes the enums, an
   `appendFields(message, fields)` serializer (canonical field order, drops
   null/empty, quotes values containing whitespace/`=`/`"`), a
   `createOffsiteLogger(log, ids)` bound logger, and a `withAuditPersistLog(audit)`
   post-processor. The field NAMES match the Mystique side so Splunk
   `stats ... by domain, audit, event, outcome` works across both sourcetypes.

4. **`audit_persistence_run_recorded` is logged via an offsite-only post-processor**,
   prepended/appended to the offsite builders' `.withPostProcessors([...])`, rather than
   editing the generic `common/base-audit.js`. Zero impact on the other ~100 audits.

5. **Silent failure modes are made loud, but behavior is unchanged.** e.g. the
   guidance-handler DB-write failure now emits `audit_persistence_opportunity_persisted outcome=failure`
   at error level, but the existing ack-without-retry control flow is left as-is
   (that is a separate correctness question, out of scope for this logging change).

## Alternatives Considered

- **Positional bracket triple `[domain][audit][src_dst]`.** Rejected: not
  auto-extracted by Splunk, and the combined `source_destination` token is
  unparseable because component names contain underscores.
- **Structured second-arg object (`log.info(msg, {…})`).** Rejected: not
  Splunk-extractable with the current sink (see Decision #2).
- **Add the persist log inside `common/base-audit.js`.** Rejected: it is generic
  to all audits; an offsite-tagged line there would mis-tag ~96 unrelated audits
  and force test churn across unrelated suites.
- **Also thread a cross-service correlation id (`runId`).** Deferred: valuable
  but separable; this change is naming + gap-fill only.

## Conventions

- **`skip` vs `warn` for benign conditions.** Use `.skip()` (info, `outcome=skip`) for an expected,
  no-op skip (e.g. "no jobs to poll", "URL store empty — scheduling a scrape"). Use `.warn()` only
  when the skip reflects a misconfiguration or an unexpected-but-tolerated condition (e.g. missing
  `imsOrgId`). This keeps an `outcome=skip` Splunk query at a single level.
- **Errors go through `errorField(err)`**, never interpolated into the free-text message, so the
  message stays injection-safe and `errorName`/`errorMessage` are queryable fields. The unclassified
  catch-all `audit_persistence_completed` failure additionally passes the raw Error to `failure(...)` for stack
  capture in CloudWatch.

## Consequences

- Splunk can `stats by audit, event, outcome, peer`, alert on
  `event=audit_persistence_opportunity_persisted outcome=failure` and
  `event=data_acquisition_scrape_job_status_polled outcome=failure reason=budget_exceeded`, and follow a run by
  `siteId`/`auditId` as extracted fields.
- Shared/generic utils (`analysis-fetch.js`, `brand-resolver.js`,
  `base-audit.js`, `data-access.js`) are intentionally left untouched; offsite
  boundaries through them are logged from the offsite caller.
- The Mystique side (suggestion count, its own boundaries) is a separate change
  in that repo; only the field vocabulary is shared.
