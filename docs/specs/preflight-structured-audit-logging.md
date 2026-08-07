# Spec: Preflight Per-Audit Structured Logging

**PR:** [#2862](https://github.com/adobe/spacecat-audit-worker/pull/2862)
**Jira:** SITES-49492 (blocks SITES-49489 — Preflight status Splunk dashboard)
**Status:** Implemented
**Last updated:** 2026-08-07

---

## Problem Statement

Preflight runs a batch of per-page checks (`canonical`, `links`, `metatags`, `headings`,
`body-size`, `lorem-ipsum`, `h1-count`, plus the Mystique-side `form-accessibility`). Each
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
   `audit=<name> status=<ok|fail> duration_ms=<n> [error="<message>"]`.
2. Make the fields Splunk-auto-extractable (logfmt `key=value`) — no SPL-side `rex` needed.
3. Attribute failures to the specific check for `canonical`/`links` (add local `try/catch` that
   logs the structured line and rethrows — preserving today's fail-hard behavior).
4. Ensure the lines are prod-visible (emit at `log.info`, not `debug`).

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
[preflight-audit] site: <id>, job: <id>, step: <step>. Canonical audit completed in 0.12 seconds. audit=canonical status=ok duration_ms=120
```

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

`body-size`, `lorem-ipsum`, and `h1-count` share a single pass over the scraped HTML, so they
share one duration/status. They still emit **one structured line each** (same duration/status)
rather than a single collapsed `audit=dom-checks` line, because the dashboard's per-audit
breakdown needs each of the three as a distinct row. The shared duration is an accepted, minor
imprecision documented here.

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

- Every check above emits `audit=<name> status=<ok|fail> duration_ms=<n>` on completion, plus
  `error="<message>"` on failure, at `log.info`.
- `canonical`/`links` failures are attributable to the specific check, not just the job-level catch.
- The `error=` value never contains a raw newline.
- Splunk auto-extracts `audit`, `status`, `duration_ms`, `error` with no query-side regex.
- 100% unit-test coverage on all touched files, including a dedicated
  `formatStructuredAuditLog` suite (happy path, newline/quote/backslash escaping, truncation,
  fail-without-error).

## Downstream

SITES-49489 builds the Splunk Dashboard Studio board on these fields:
`index=dx_aem_engineering sourcetype=dx_aem_sites_spacecat_backend_prod "[preflight-audit]" audit=* | stats count by audit status`
and a top-error panel keyed on `audit` + `error`.
