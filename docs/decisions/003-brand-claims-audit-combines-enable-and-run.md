# 003 — Brand Claims Audit: Combine Enable + Run in the Audit Worker

- **Status:** Proposed
- **Date:** 2026-08-10
- **Related:** mirrors the api-service Slack commands `enable-brand-claims` / `run-brand-claims` (LLMO-5741 gate, LLMO-6143 run signal)

## Context

Operators previously had to run two api-service Slack commands to kick off Brand
Claims for a site: `enable-brand-claims {brandId}` to flip the brand-scoped
`brand_claims_enabled` gate, then `run-brand-claims {site}` to re-publish the DRS
`BRAND_PRESENCE_SHEET_WRITTEN` ready-signal for the brand's latest Brand Presence
sheet. We want a single, siteId-scoped, message-triggerable operation that does
both, so it can be driven from the audit pipeline rather than by hand.

This introduces a new `brand-claims` SQS audit type in the audit worker that
(1) enables the gate and (2) publishes the ready-signal, mirroring the two
commands. Two of the choices below are deliberate trade-offs flagged in review.

## Decision

1. **The logic lives in the audit worker and is a faithful mirror of the two
   api-service commands, not a delegating call back to api-service.** The handler
   writes `brand_claims_enabled` directly to the `brands` table via the PostgREST
   client and lists S3 directly, rather than calling the api-service `enable`/`run`
   surfaces over S2S. Rationale: the worker already holds a PostgREST client and S3
   client and already reads the `brands` table (`utils/brand-resolver.js`); a
   combined audit that does the work in-process is simpler and avoids an extra
   service hop for a pipeline-triggered operation. Cost: the audit worker becomes a
   second writer of the api-service-owned `brands` table. The write reuses the same
   `.eq('id', brandId).neq('status','deleted')` guard as api-service's
   `setBrandClaimsEnabled`; if the `brands` write invariants grow richer (new CHECK
   constraints, status mapping), this writer must be revisited or migrated to the
   S2S surface.

2. **`sanitizePathComponent` and the latest-sheet discovery are duplicated
   byte-for-byte from the api-service command (which itself mirrors the DRS Python
   producer).** This is now a third copy of a cross-service serialization invariant.
   Rationale: extracting a shared `spacecat-shared` module is the right long-term
   fix but is out of scope for this change. Mitigation: a golden-vector unit test
   pins `sanitizePathComponent`'s known input/output pairs so drift is caught here.
   Revisit trigger: any change to the DRS slug or sheet-naming rule — at that point
   promote the sanitizer + regexes + event envelope into a shared package consumed
   by both JS services with a golden-vector test shared with the DRS team.

3. **Failure policy: infra/config faults throw; business no-ops ack.** Missing
   `SQS_BP_SHEET_READY_QUEUE_URL` / `DRS_BP_BUCKET` / PostgREST client throw so the
   message is retried and surfaces via the DLQ and error metrics (aligning with
   `geo-brand-presence` and avoiding the silent-drop failure mode). Genuine terminal
   outcomes (no active brand, empty brand slug, no sheet yet, enable matched no row)
   log a warning and return `ok()` — retrying would not help.

4. **Enable is idempotent** — the gate is only written when currently off, and if
   the write matches no row (brand soft-deleted mid-flight) the run is skipped.

## Consequences

- One siteId-scoped trigger now performs both steps; the two Slack commands remain
  for manual/brand-scoped use.
- Two known coupling points (Decisions 1 and 2) are tracked here; the shared-package
  extraction is the accepted future direction if the DRS contract changes.
