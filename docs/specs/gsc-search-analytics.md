# Spec: `gsc-search-analytics` audit

## Goal

For each URL that ASO fixed, record that URL's Google Search Console (GSC) performance for the 84 days **before** and 84 days **after** its own fix date. This is the "Measured" layer of the outcome-proof framework: it **records raw figures only**. It makes **no causal claim, no attribution, and no dollar value** — any touched-vs-untouched or causal analysis is a separate workstream, out of scope here.

## Why an audit

The customer's GSC OAuth token lives only in the SpaceCat prod account's Secrets Manager. A laptop or a different service cannot read it; an audit runs in-account where `GoogleClient.createFrom` can. This audit reuses the existing `@adobe/spacecat-shared-google-client`.

## Input contract

The runner has two modes.

**Self-sourced (default).** With no explicit URL list, the runner sources the site's own DEPLOYED/PUBLISHED fixes from the data-service (`fix_entities` via `spacecat-shared-data-access`, read off `context.dataAccess`) and builds the `{ url, fixType, fixDate }` list itself (`deriveFixedUrls` in `derive.js`). Inputs arrive as Slack/API keyword args on `auditContext.messageData` (or `auditContext` directly):
- `since` — a single `YYYY-MM-DD` watermark. Present → **incremental** mode: only fixes that matured since then. Absent → **backfill** of the full measurable band (`now-396d` → `now-87d`).
- `fixStatuses` — optional, default `[DEPLOYED, PUBLISHED]`.
- `fixTypes` — optional; an explicit list overrides the default SEO allow-list (see below).
- `from` / `to` — undocumented low-level date overrides that exist for deterministic tests; they win over `since`/backfill. Not for normal use.

**Explicit override.** `auditContext.fixedUrls` (fallback `auditContext.messageData?.fixedUrls`) — an array of `{ url, fixType, fixDate }` (`fixDate` as `YYYY-MM-DD`). When supplied and non-empty it wins and self-sourcing is skipped; used for tests and reruns.

**SEO allow-list.** Self-sourcing sources only SEO opportunity types by default (`SEO_FIX_TYPES` in `derive.js`): `meta-tags`, `broken-internal-links`, `broken-backlinks`, `sitemap`, `canonical`, `structured-data`, `hreflang`, `cwv`, `readability`, `redirect-chains`. **`alt-text` is excluded by default** — its signal is image-search, not the web-search clicks/impressions/position this audit records, and it is the largest volume driver (caps pressure). It is still reachable with `fixTypes:['alt-text']` (an explicit `fixTypes` overrides the default set).

**Backfill is bounded.** A wide backfill is capped to the **newest `MAX_DATE_GROUPS` (30)** distinct deploy-dates and `MAX_FIXED_URLS` (500) URLs, so it can never trip the run's hard abort-caps (below); it measures the most-recent batch instead of returning zero. Older history is reached with an explicit narrower window (`since:` or `from`/`to`). Self-sourced runs carry a top-level `sourcing` object — `{ mode, sourcedDateGroups, keptDateGroups, truncated }` — where `truncated: true` means older fixes were left out of this run.

Guards (fail closed, recorded as a status, never a crash):
- `missing_fixed_urls` — empty/absent list (nothing supplied and nothing sourced).
- `too_many_fixed_urls` — more than 500 URLs.
- `too_many_date_groups` — more than 30 distinct fix dates (each date = one sequential pair of window pulls; bounded to stay within the Lambda timeout).
- `sourcing_failed` — the self-source data lookup threw (e.g. a data-service error); recorded instead of crashing the run.

## Running the audit (Slack)

Self-serve via `@spacecat`; the site is the only required input.

```
# backfill — everything currently measurable (run once)
@spacecat run audit https://krisshop.com audit:gsc-search-analytics
# incremental — only fixes matured since your last run (monthly)
@spacecat run audit https://krisshop.com audit:gsc-search-analytics since:2026-05-01
# optional type filter (single type)
@spacecat run audit https://krisshop.com audit:gsc-search-analytics since:2026-05-01 fixTypes:meta-tags
```

`fixTypes` from Slack is a single type value; the worker also accepts an array via `messageData` when multiple types are needed.

## Processing

1. `GoogleClient.createFrom(context, finalUrl)`. Any failure is recorded as `status:'not_connected'` with a bounded `reason` (repo convention; never throws).
2. Resolve the GSC query scope once via `composeAuditURL(finalUrl)` — the host+path the client's page-filter is scoped to (e.g. `www.krisshop.com/en`). A fixed URL outside that resolved host+path is never queried and is classified `out_of_scope`. `composeAuditURL` does a live HTTP GET; if it fails, the run degrades to treating all fixed URLs as in-scope (logs a warning) rather than failing, since GSC is already connected.
3. Split invalid dates out as `status:'invalid_date'`. Group the rest by `fixDate` so URLs sharing a date share one pull pair.
4. Per date-group: compute the two 84-day windows (`computeWindows`), assess completeness (`assessCompleteness` vs GSC's ~3-day freshness lag and ~16-month retention), fetch each window's page rows (`fetchWindow`, paginated, 50-page cap → `truncated` flag), and match each fixed URL client-side (`match.js`, normalized: lowercased host, no fragment, sorted query, trailing slash stripped).

## Output (`audit_result`)

`{ schemaVersion, interpretation, connected, status, fixCount, measuredCount, fixes[] }`, plus an optional top-level `sourcing` object on self-sourced runs (see below). Each fix: `{ url, fixType, fixDate, status, windows, before, after, delta, found, dataQuality }`.

Envelope-level `status` is one of: `ok | not_connected | missing_fixed_urls | too_many_fixed_urls | too_many_date_groups | sourcing_failed`. `sourcing_failed` = the self-source data lookup threw (e.g. a data-service error); recorded instead of crashing the run.

The top-level `sourcing` object (`{ mode, sourcedDateGroups, keptDateGroups, truncated }`) is present on self-sourced runs — on **both** the `ok` and the `missing_fixed_urls` results, so a "found 0 deployed fixes in band" run is still diagnosable. It is absent on explicit-`fixedUrls` runs.

Per-fix `status` is one of `measured | not_found | incomplete | invalid_date | failed | out_of_scope`:
- `measured` — both windows found and fully elapsed/in-retention; `delta` = after minus before (for `position`, negative = moved up = better).
- `not_found` — a window was queried and returned no row for the URL.
- `incomplete` — a window is not fully elapsed or predates retention (`delta:null`; completeness is checked before presence).
- `out_of_scope` — the URL is outside the GSC page-filter's resolved host+path scope, so it was never queried — distinct from `not_found` (queried, no data).
- `invalid_date` / `failed` — recorded with an error, never fetched / fetch failed.

`delta` is populated **only** for `measured`, so a partial window can never masquerade as a complete change.

## Timing

A fix yields a `measured` delta only once its after-window has elapsed past GSC's ~3-day lag (roughly fix date + 87 days) **and** its before-window is still within the ~13-month retention horizon. So only fixes aged roughly **3-13 months** produce a delta; more recent fixes come back `incomplete` and need a later re-run once their after-window closes.

## Consumption

Read the latest row via the `query-audits` skill (PostgREST, `audits`/`latest_audits`) filtered to the site and `audit_type = gsc-search-analytics`; the per-URL table is `audit_result.fixes`.

Note: `latest_audits` holds a **snapshot, not a cumulative history** — each run replaces the prior `fixedUrls` set for the site. Consumers should treat one row as "the result of the most recent run for this exact URL list," not an accumulation across runs.

URL matching assumes `www.` and apex are equivalent (see `match.js`). If a window returns rows but none of the fixed URLs match, the runner logs a host-mismatch warning rather than silently reporting `not_found`.

## Non-goals

Causal attribution, touched-vs-untouched comparison, dollarization, cross-URL aggregation, and automated apply.

Self-sourcing the fixed-URL list from SpaceCat — formerly a non-goal — is now **implemented**: the source of truth is `fix_entities` via `spacecat-shared-data-access` (see Input contract). A manually-supplied `fixedUrls` list still works as an explicit override.

## Related

Implementation plan (private): `basecamp/projects/00_ASO-outcome-proof/docs/plans/2026-08-03-plan-gsc-search-analytics-audit.md`.
