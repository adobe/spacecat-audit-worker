# Spec: Preflight Per-Audit Structured Logging

**PR:** [#2862](https://github.com/adobe/spacecat-audit-worker/pull/2862)
**Jira:** SITES-49492 (blocks SITES-49489 — Preflight status Splunk dashboard)
**Status:** Implemented
**Last updated:** 2026-08-07

---

## Problem Statement

Preflight runs a batch of per-page checks (`canonical`, `links`, `metatags`, `headings`,
`body-size`, `lorem-ipsum`, plus the Mystique-side `form-accessibility`). Each
check logs a free-text completion line with no machine-parseable audit-name or status field,
so answering "which audit is failing, how often, and with what error" requires regex-parsing
prose. Two checks (`canonical`, `links`) had no local `try/catch` at all, so their failures
surfaced only via the handler's single generic job-level catch — with no per-check attribution.
Additionally, the completion lines were emitted at `log.debug`, which prod suppresses
(`LOG_LEVEL=info`), so they never reached Splunk.

This blocks a reliable "overall Preflight status" dashboard (SITES-49489), whose per-audit
breakdown and top-error panels need dependable, queryable fields.

## Goals

1. Emit one machine-parseable completion line per check with stable fields:
   `pfauditmetric audit=<name> status=<ok|fail> duration_ms=<n> [error="<message>"]`.
2. Make the fields cheaply queryable. **Correction (see note below): the sourcetype is
   `KV_MODE=json`, so these `key=value` tokens live inside the JSON `message` string and are NOT
   auto-extracted — the dashboard `rex`-extracts them.** The logfmt shape keeps that `rex` trivial.
3. Lead the suffix with a rare, breaker-free marker token (`pfauditmetric`) so the dashboard can
   anchor on a tiny postings list — without it, a wide-window search is unusably slow (see
   "Query performance" below).
4. Attribute failures to the specific check for `canonical`/`links` (add local `try/catch` that
   logs the structured line and rethrows — preserving today's fail-hard behavior).
5. Ensure the lines are prod-visible (emit at `log.info`, not `debug`).

## Non-Goals

- Restructuring the existing `[preflight-audit] site:/job:/step:` message prefix (append-only, so
  existing log consumers are unaffected).
- Changing control flow / error semantics of any check (every new `catch` rethrows).
- Structured logging for the Mystique-side `form-accessibility` path (different service/repo;
  the dashboard queries its free-text lines separately, per SITES-49489).
- A `PreflightError`-style stable `code` for the `error=` value — it is free text for humans,
  deliberately not a parsed contract.

---

## Technical Design

### The contract

A shared helper `formatStructuredAuditLog({ audit, status, durationMs, error })` in
`src/preflight/utils.js` returns a leading-space-prefixed suffix appended to each check's
existing completion message:

```
[preflight-audit] site: <id>, job: <id>, step: <step>. Canonical audit completed in 0.12 seconds. pfauditmetric audit=canonical status=ok duration_ms=120
```

### Query performance — why the `pfauditmetric` marker exists

The dashboard groups by `audit`/`status`/`duration_ms`, which are `rex`-extracted from `message`
at search time, so Splunk's index cannot help with them — to *find* the lines it must use the
search terms. Every otherwise-natural anchor (`audit`, `preflight`, `duration_ms`) is a **common**
term in the `dx_aem_sites_spacecat_backend_*` sourcetype (it carries every SpaceCat Lambda/worker
log; `api-service` alone emits `duration_ms` on nearly every request), so a wide-window search has
to intersect enormous postings lists across a busy shared index — a 14-day search hangs, even a
bare `count`. `pfauditmetric` is a made-up token that appears on **only** these completion lines,
so it is a single rare indexed term (all lowercase, no Splunk breakers) with a tiny postings list.
Anchoring the dashboard base search on it (`... "pfauditmetric" | rex ...`) makes the search cost
proportional to preflight volume alone — fast at any window. For very high preflight volume or
multi-month views, report acceleration / a summary index is the further step (needs Splunk perms).

| Field | Meaning |
|-------|---------|
| `audit` | check name — one of the `AUDIT_*` constants in `handler.js` |
| `status` | `ok` or `fail` |
| `duration_ms` | integer wall-clock duration of the check |
| `error` | (fail only) quoted, escaped, single-line, ≤500 chars |

### Escaping (why it matters)

The `error` value is quoted and sanitized in this order: backslash → double-quote → collapse
`[\r\n]+` to a single space → truncate to 500 chars. Newline collapsing is essential: a raw
newline inside the quoted value would split the log entry into two lines and corrupt Splunk's
per-line field extraction (stack traces and multi-line assertion messages routinely contain
newlines).

### Log level

All completion lines are emitted at `log.info`. Prod runs at `LOG_LEVEL=info`
(`helix-universal-logger` default and set explicitly in CI's prod deploy), so a `debug` line
would never reach Splunk and the dashboard would have no data for that check. This also makes
the level consistent across all checks (previously the DOM-based block was `info` while the
rest were `debug`).

### DOM-based checks emit one line per check (by design)

`body-size` and `lorem-ipsum` share a single pass over the scraped HTML, so they
share one duration/status. They still emit **one structured line each** (same duration/status)
rather than a single collapsed `audit=dom-checks` line, because the dashboard's per-audit
breakdown needs each of the two as a distinct row. The shared duration is an accepted, minor
imprecision documented here.

> Note: this section originally covered three DOM-based checks (`body-size`, `lorem-ipsum`,
> `h1-count`). `h1-count` was removed as a standalone preflight check (superseded by the
> `headings` handler's `missing-h1`/`multiple-h1` checks); the structured-logging pattern
> described here is unchanged for the remaining two.

### Files touched

| File | Change |
|------|--------|
| `src/preflight/utils.js` | new `formatStructuredAuditLog` helper |
| `src/preflight/canonical.js` | add `try/catch/finally`, structured line at info, rethrow on error |
| `src/preflight/links.js` | add `try/catch/finally`, structured line at info, rethrow on error |
| `src/preflight/metatags.js` | append structured suffix to existing catch + completion (info) |
| `src/preflight/headings.js` | append structured suffix to existing catch + completion (info) |
| `src/preflight/handler.js` | DOM-based block: `try/catch/finally`, one structured line per enabled check |

## Success Criteria

- Every check above emits `pfauditmetric audit=<name> status=<ok|fail> duration_ms=<n>` on
  completion, plus `error="<message>"` on failure, at `log.info`.
- `canonical`/`links` failures are attributable to the specific check, not just the job-level catch.
- The `error=` value never contains a raw newline.
- The dashboard anchors on `pfauditmetric` and `rex`-extracts `audit`/`status`/`duration_ms`/`error`
  from `message` (the sourcetype is `KV_MODE=json` — no auto-extraction), and a wide-window
  (e.g. 14-day) query returns without hanging.
- 100% unit-test coverage on all touched files, including a dedicated
  `formatStructuredAuditLog` suite (marker prefix, happy path, newline/quote/backslash escaping,
  truncation, fail-without-error).

## Downstream

SITES-49489 builds the Splunk classic dashboard (`aso_preflight_status`) on these fields. Base
search anchors on the marker and `rex`-extracts the fields from `message`:
```
index=dx_aem_engineering sourcetype=dx_aem_sites_spacecat_backend_prod "pfauditmetric"
| rex field=message "audit=(?<audit>\S+)\s+status=(?<status>\S+)\s+duration_ms=(?<duration_ms>\d+)"
| rex field=message "error=\"(?<error>.*)\""
| stats count by audit status
```
plus a top-error panel keyed on `audit` + `error`.
