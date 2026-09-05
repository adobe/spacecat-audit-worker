# URL Index Producer (write-time)

**Goal:** At persist time, record which source URL(s) an opportunity (and its suggestions) are
backed by, so `spacecat-api-service` can resolve "which opportunity/suggestion is backed by this
URL?" with one indexed lookup instead of fanning out to producers.

**Design:** Producer half of Option 2 (write-time shared index) from `lookup-service-api-design.md`.
Two pointer tables (`opportunity_urls`, `suggestion_urls`, in `mysticat-data-service`) map a canonical
source URL to the row it backs. The shared writer/reader lives in `@adobe/spacecat-shared-data-access`
(`syncUrlIndex` / `lookupEntityIdsByUrl`); producers own only URL extraction.

The **forward-only** and **best-effort** trade-offs are recorded in ADR
`docs/decisions/006-url-index-forward-only-best-effort.md`.

**Tech:** Node.js 24, ESM, Mocha + Chai + Sinon + esmock, 100% coverage.

## Scope

- `src/common/url-index.js` (generic core): `syncOpportunityUrlIndex({ context, opportunity,
  auditType })` runs the per-type extractor + `syncUrlIndex`/`syncUrlIndexMany`, swallows errors, and
  returns `{ status, phase?, error?, urlCount, suggestionCount }`. Emits nothing and imports only
  `spacecat-shared-data-access`, so any producer can reuse it; unknown type → `status: 'skipped'`.
- `src/common/offsite-url-index.js` (offsite adapter): `syncOffsiteUrlIndex({ ..., olog })` calls the
  core and renders its result into the offsite log taxonomy — keeping offsite-logging out of the core.
- Wired into the four offsite guidance-handlers (`{wikipedia,cited,reddit,youtube}-analysis`, which
  call `syncOffsiteUrlIndex`) after `opportunity.save()` + `syncSuggestions`. Only wikipedia has an
  extractor (`fullAnalysis.wikipediaUrl`) today; the rest are no-ops until theirs land.
- Forward-only: no backfill. Evergreen opportunities repopulate the index on their next run.

## Cross-repo dependency

`syncUrlIndex` ships in `@adobe/spacecat-shared-data-access`. Bump the dependency in `package.json`
to the first published version containing it.

## Alternatives

- **Read-time fan-out (no index).** Ask each producer "do you back this URL?" at query time.
  Rejected: O(producers) per lookup, couples the reader to producer internals — what this index removes.
- **Backfill on ship / fail-audit-on-error / silent swallow.** See ADR 006.

## Success criteria

- Core writes `opportunity_urls` + `suggestion_urls` for a persisted wikipedia opportunity
  (`status: 'ok'`); `status: 'skipped'` for types with no extractor.
- A failure at any stage never fails the audit: core returns `status: 'error'` + `phase`, adapter
  logs it as `event=url_index_sync outcome=degraded`. The core has no offsite dependency.
- Suggestions indexed via one batched `syncUrlIndexMany` call, skipped when there are none.
- 100% line/branch/statement coverage on `url-index.js` + `offsite-url-index.js`.

## Out of scope / follow-up

- Extractors for cited/reddit/youtube. Each suggestion cites a *distinct* source, so they need a
  per-suggestion extractor seam (a `(suggestion) => string[]` entry), not wikipedia's shared-URL one;
  deferred until the first lands.
- URL validation/normalization at the extractor boundary for less-trusted (scraped) sources — not
  actionable while only the trusted Wikipedia URL flows; canonicalization is owned by `syncUrlIndex`.
- A reconciliation sweep for index↔source divergence (ADR 006) — detection exists, correction does not.
- Semantic (claim/topic) matching: later phase, needs pgvector.
