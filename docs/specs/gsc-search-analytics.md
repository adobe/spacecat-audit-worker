# Spec: `gsc-search-analytics` audit

## Goal

For each URL that ASO fixed, record that URL's Google Search Console (GSC) performance for the 84 days **before** and 84 days **after** its own fix date. This is the "Measured" layer of the outcome-proof framework: it **records raw figures only**. It makes **no causal claim, no attribution, and no dollar value** — any touched-vs-untouched or causal analysis is a separate workstream, out of scope here.

## Why an audit

The customer's GSC OAuth token lives only in the SpaceCat prod account's Secrets Manager. A laptop or a different service cannot read it; an audit runs in-account where `GoogleClient.createFrom` can. This audit reuses the existing `@adobe/spacecat-shared-google-client`.

## Input contract

The runner reads `auditContext.fixedUrls` (fallback `auditContext.messageData?.fixedUrls`): an array of `{ url, fixType, fixDate }`, `fixDate` as `YYYY-MM-DD`. Supplied manually for the pilot; may later be sourced from ASO's own FIXED-suggestion records.

Guards (fail closed, recorded as a status, never a crash):
- `missing_fixed_urls` — empty/absent list.
- `too_many_fixed_urls` — more than 500 URLs.
- `too_many_date_groups` — more than 30 distinct fix dates (each date = one sequential pair of window pulls; bounded to stay within the Lambda timeout).

## Processing

1. `GoogleClient.createFrom(context, finalUrl)`. Any failure is recorded as `status:'not_connected'` with a bounded `reason` (repo convention; never throws).
2. Split invalid dates out as `status:'invalid_date'`. Group the rest by `fixDate` so URLs sharing a date share one pull pair.
3. Per date-group: compute the two 84-day windows (`computeWindows`), assess completeness (`assessCompleteness` vs GSC's ~3-day freshness lag and ~16-month retention), fetch each window's page rows (`fetchWindow`, paginated, 50-page cap → `truncated` flag), and match each fixed URL client-side (`match.js`, normalized: lowercased host, no fragment, sorted query, trailing slash stripped).

## Output (`audit_result`)

`{ schemaVersion, interpretation, connected, status, fixCount, measuredCount, fixes[] }`. Each fix: `{ url, fixType, fixDate, status, windows, before, after, delta, found, dataQuality }`.

Per-fix `status`:
- `measured` — both windows found and fully elapsed/in-retention; `delta` = after minus before (for `position`, negative = moved up = better).
- `not_found` — a window returned no row for the URL.
- `incomplete` — a window is not fully elapsed or predates retention (`delta:null`; completeness is checked before presence).
- `invalid_date` / `failed` — recorded with an error, never fetched / fetch failed.

`delta` is populated **only** for `measured`, so a partial window can never masquerade as a complete change.

## Consumption

Read the latest row via the `query-audits` skill (PostgREST, `audits`/`latest_audits`) filtered to the site and `audit_type = gsc-search-analytics`; the per-URL table is `audit_result.fixes`.

## Non-goals

Causal attribution, touched-vs-untouched comparison, dollarization, cross-URL aggregation, automated apply, and sourcing the fixed-URL list from SpaceCat (pilot supplies it manually).

## Related

Implementation plan (private): `basecamp/projects/00_ASO-outcome-proof/docs/plans/2026-08-03-plan-gsc-search-analytics-audit.md`.
