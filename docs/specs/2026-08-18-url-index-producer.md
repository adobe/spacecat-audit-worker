# URL Index Producer (write-time)

**Goal:** At persist time, record which source URL(s) an opportunity (and its suggestions) are
backed by, so `spacecat-api-service` can resolve "which opportunity/suggestion is backed by this
URL?" with one indexed lookup instead of fanning out to producers.

**Design:** Producer half of Option 2 (write-time shared index) from `lookup-service-api-design.md`.
Two pointer tables (`opportunity_urls`, `suggestion_urls`, in `mysticat-data-service`) map a canonical
source URL to the row it backs. The shared writer/reader lives in `@adobe/spacecat-shared-data-access`
(`syncUrlIndex` / `lookupEntityIdsByUrl`); producers own only URL extraction.

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
to the first published version containing it (currently `4.22.0`, which predates it).

## Out of scope / follow-up

- Extractors for cited/reddit/youtube (their URLs live in Mystique's nested payload, and each
  suggestion cites a distinct source, so they introduce a per-suggestion extractor).
- Semantic (claim/topic) matching: separate later phase, needs pgvector.
