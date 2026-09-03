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

- `src/common/url-index.js`: `syncOpportunityUrlIndex({ context, opportunity, auditType })`. Runs a
  per-type extractor, then `syncUrlIndex` for the opportunity and each persisted suggestion.
  Best-effort (logs and swallows errors, never fails the audit). An audit type with no registered
  extractor is a no-op.
- Wired into the four offsite guidance-handlers (`{wikipedia,cited,reddit,youtube}-analysis`) after
  `opportunity.save()` + `syncSuggestions`. Wikipedia's extractor is implemented
  (`fullAnalysis.wikipediaUrl`); the others have no extractor yet, so the call is a no-op for them.
- Forward-only: no backfill. Evergreen opportunities repopulate the index on their next run.

## Cross-repo dependency

`syncUrlIndex` ships in `@adobe/spacecat-shared-data-access`. Bump the dependency in `package.json`
to the first published version containing it.

## Alternatives

- **Read-time fan-out (no index).** Ask each producer "do you back this URL?" at query time.
  Rejected: O(producers) per lookup, couples the reader to producer internals — what this index removes.
- **Backfill on ship / fail-audit-on-error / silent swallow.** See ADR 006.

## Success criteria

- `syncOpportunityUrlIndex` writes `opportunity_urls` + `suggestion_urls` rows for a persisted
  wikipedia opportunity; no-op for types with no extractor.
- A failure at any stage never fails the audit and is logged with its `phase` under a stable
  `event=url_index_sync outcome=failure` token.
- Suggestions indexed via one batched `syncUrlIndexMany` call, skipped when there are none.
- 100% line/branch/statement coverage on `src/common/url-index.js`.

## Out of scope / follow-up

- Extractors for cited/reddit/youtube. Each suggestion cites a *distinct* source, so they need a
  per-suggestion extractor seam (a `(suggestion) => string[]` entry), not wikipedia's shared-URL one;
  deferred until the first lands.
- URL validation/normalization at the extractor boundary for less-trusted (scraped) sources — not
  actionable while only the trusted Wikipedia URL flows; canonicalization is owned by `syncUrlIndex`.
- A reconciliation sweep for index↔source divergence (ADR 006) — detection exists, correction does not.
- Semantic (claim/topic) matching: later phase, needs pgvector.
