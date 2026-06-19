# 001 — LLM Error Pages: Consumer-Side URL Validation & DB Consistency

- **Status:** Accepted
- **Date:** 2026-06-11

## Context

The `llm-error-pages` audit consumes `alternative_urls` from Mystique's
`BrokenLinksFlow`. Mystique builds that list from a `locale_filtered_urls`
candidate pool, but the survivors are not HEAD-verified against the live
site end-to-end. As a result, the audit-worker was persisting suggestions
that returned `404` on click, which damaged trust in the surfaced report.

Separately, the audit's Excel writer and DB persistence layer diverged on
empty-suggestion rows: a long-standing "skip empty-suggestion" gate
dropped those rows from Excel while DB rows for the same opportunity
were still written, making operator triage unreliable.

## Decision

1. Add a **consumer-side HEAD-reachability filter** at the audit-worker
   boundary (defence-in-depth). Confident `4xx`/`5xx` → drop;
   inconclusive (timeout, network error, `405`) → keep. SSRF guard,
   per-host concurrency cap of `3`, global cap of `10`,
   Adobe-identifying User-Agent, `redirect: 'manual'`.
2. **Reverse the "skip empty-suggestion rows" gate** — persist empty
   rows in both Excel and the DB for parity. After the HEAD-check
   pass, clear `aiRationale` on rows whose suggestions were emptied,
   so the surfaced report remains internally consistent.

## Alternatives Considered

- **Tighten Mystique upstream** by HEAD-verifying `locale_filtered_urls`
  before emitting. Rejected for now: Mystique release cycle is longer
  than the customer impact horizon. This defensive layer ships sooner
  and will retire once the Mystique-side fix lands.
- **Reuse `checkLinkWithHead` from `src/internal-links/helpers.js`**.
  Deferred: cross-cutting consolidation needs its own PR and the
  helper's semantics (e.g. error categorization, retry policy) don't
  fully match what `llm-error-pages` needs at the boundary.
- **Drop empty-suggestion rows entirely** from both Excel and DB.
  Rejected: that would hide Mystique regressions from operators and
  remove the only signal that the audit ran on an opportunity at all.

## Consequences

- +1 HTTP HEAD per suggested URL per audit invocation, throttled at
  `3`/host and `10` global.
- New shared `src/support/url-safety.js` SSRF guard, which partially
  duplicates the helpers in `src/site-detection/handler.js` until that
  audit migrates to the new module.
- Excel and DB now both contain empty-suggestion rows. Downstream
  consumers of either store must handle the case where a row has an
  `aiRationale` cleared and zero `suggested_urls`.

## Follow-ups

- Mystique: verify `locale_filtered_urls` against live HEAD before
  emitting `alternative_urls`.
- Site-detection: migrate to `src/support/url-safety.js` import.
- Pin the resolved IP via undici `lookup` option to close the
  DNS-rebinding TOCTOU window documented in `url-safety.js`.
