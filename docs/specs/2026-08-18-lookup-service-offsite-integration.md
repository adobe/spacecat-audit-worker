# Lookup Service — Offsite Integration (URL dimension)

**Goal:** At persist time, record which source URL(s) an opportunity (and its suggestions) are
backed by, so the Lookup Service can resolve "which opportunity/suggestion is backed by this
URL?" with one indexed lookup instead of fanning out to producers.

**Architectural source of truth:** the Lookup Service architecture doc ("Offsite Intelligence -
Funneling") and its companion scenarios doc. That doc defines the Lookup Service as a read-only
capability over shared index tables, written to by each opportunity type's own producer (Option 2,
"write-time shared index"); URL is its first lookup dimension, with Topic and Claim specified as
future dimensions of the same service. The **forward-only** / **best-effort** write trade-offs and
the two-module, dimension-oriented shape of this repo's integration are recorded in ADR
`docs/decisions/006-lookup-service-write-foundation.md`.

**Tech:** Node.js 24, ESM, Mocha + Chai + Sinon + esmock, 100% coverage.

## Scope

- `src/common/lookup-index.js` — **the shared foundation.** Entity-generic (any opportunity type in
  this repo can call it, not only offsite); dimension-oriented (URL today, shaped so Topic/Claim are
  additive later, not a rewrite). Two functions, best-effort and never throwing — a failure is
  returned as `{ error }`, not raised, so a lookup-index write can never fail the caller's own
  persist; a result with no `error` key succeeded. Neither function summarizes what it did: each
  reports exactly what was submitted and exactly what the underlying writer returned, and leaves any
  derived count, rate, or filtered id list to the caller (see ADR 006 for why):
  - `indexOpportunityByUrl({ context, opportunity, entityType, getUrls })` → syncs the opportunity's
    own URLs. Success: `{ opportunityId, submittedEntry, syncedIndexResult }` — `submittedEntry` is
    `{ entityId, urls }`, exactly what was handed to `syncUrlIndex`; `syncedIndexResult` is
    `syncUrlIndex`'s own return value, passed through unchanged.
  - `indexOpportunitySuggestionsByUrl({ context, opportunity, entityType, getUrls })` → syncs the
    opportunity's current suggestions' URLs in one batched write. A suggestion with zero URLs is
    still included, as an explicit clear rather than omitted (so a binding set that later goes
    empty self-heals); a suggestion whose candidates are non-empty but hygiene reduces them to
    nothing is left out of the batch entirely, so one drifted suggestion cannot freeze every
    sibling suggestion's index (see ADR 006, Decision 9). `getUrls` takes only the suggestion, not
    the opportunity — a caller whose extraction also needs the opportunity closes over it before
    passing `getUrls` in (see below). Success: `{ opportunityId, submittedEntries,
    syncedIndexResult }` — `submittedEntries` is the batch exactly as submitted to
    `syncUrlIndexMany` (`{ entityId, urls }[]`); `syncedIndexResult` is `syncUrlIndexMany`'s own
    return value, passed through unchanged (`undefined` when there were no suggestions to submit).
  - `dataAccess.services.postgrestClient` is validated (a callable `.from`) before either function
    writes. Every failure path returns `{ error }` only (no submitted or synced data): `error.message`
    is exactly one of a small set of internal reason strings (exported as `REASON`) naming the stage
    (`Failed to resolve postgrest client`, `Failed to extract URLs`, `Extraction returned candidates
    but none were indexable`, `Failed to fetch suggestions`, `Failed to sync the URL index`), and
    the original underlying error, when there was one, is attached as `error.cause`.
  - `indexOpportunitySuggestionsByUrl` reads the current suggestion set via
    `context.dataAccess.Suggestion.allByOpportunityId`, not `opportunity.getSuggestions()` — the
    latter is a per-instance memoized accessor that a persist path (`syncSuggestions` calls it
    earlier in the same run) typically already warmed with the pre-sync set, which would otherwise
    miss suggestions the same run just created or deleted (see ADR 006, Decision 6).
  - Whatever `getUrls` returns is filtered through `sanitizeUrls` (`src/common/lookup-index-utils.js`)
    before it becomes part of a submission: non-string, non-http(s), oversized, or
    credential-bearing candidates are dropped, known sensitive query parameters are stripped from
    the ones that survive, the result is de-duplicated on the post-strip string (defense-in-depth
    for count fidelity, not a write-safety fix - the writer already canonicalizes and de-duplicates
    per entity before any upsert), and it is capped at `MAX_URLS_PER_ENTITY` (500, well above any
    legitimate source count) to bound how many writer round-trips and rows one entity's submission
    can produce. A non-empty candidate list that hygiene reduces to nothing is never submitted as an
    empty (clearing) array - a payload-shape drift upstream must not be able to masquerade as
    "this entity has no sources" and delete current rows. At the opportunity level that means the
    whole call fails as `NO_INDEXABLE_URLS`; at the suggestions level it means that one suggestion
    is left out of the batch while the rest still syncs, so one drifted suggestion cannot freeze
    every sibling suggestion's index (see ADR 006, Decision 9). Extractors themselves supply raw
    candidates - the hygiene gate lives here once so every caller of the shared foundation gets it
    automatically.
  - Imports only `@adobe/spacecat-shared-data-access` (`syncUrlIndex`/`syncUrlIndexMany`), so any
    opportunity type in this repo can depend on it with no offsite dependency.
- `src/common/offsite-lookup-index.js` — **the offsite integration**, demonstrating how an opportunity
  owner uses the shared foundation. `indexOffsiteOpportunityByUrl({ context, opportunity, auditType,
  getOpportunityUrls, getSuggestionUrls, olog })` calls both functions above — currying
  `getSuggestionUrls` with `opportunity` before handing it to `indexOpportunitySuggestionsByUrl`, so
  a two-argument handler extractor (wikipedia's, which needs the opportunity) still works against
  the shared foundation's one-argument `getUrls` contract — derives its own logged counts from the
  raw `submittedEntry`/`submittedEntries` and `syncedIndexResult` (a plain number from
  `indexOpportunityByUrl`, a `Map<entityId, urlCount>` from `indexOpportunitySuggestionsByUrl` —
  this module is the one place that knows either shape). At the suggestions level it logs
  `submittedSuggestionCount` alongside a `syncedUrlCount` derived by summing the Map's values (the
  same quantity `syncUrlIndex` returns directly at the opportunity level); it does not log a
  `syncedSuggestionCount`, since the Map carries an entry for every submitted suggestion before any
  write happens and that count could never differ from what was submitted. It renders the outcome
  into the offsite log taxonomy's `audit_funneling_*` phase (`audit_funneling_start` /
  `audit_funneling_index_url_synced` / `audit_funneling_end` — see
  `docs/specs/2026-07-31-offsite-structured-logging.md` and ADR
  `docs/decisions/003-offsite-event-taxonomy-phase-boundaries.md`). A sync-outcome line logs
  `outcome=degraded` when `result.error` is present or the writer's return value can't be
  interpreted, else `outcome=success`; `start`/`end` are unconditional and always `outcome=success`
  - they bracket the phase (it started, it ran to completion), they do not aggregate the two
  sync-outcome lines' results. A caller who wants the phase's health greps the interior
  `audit_funneling_index_url_synced` lines directly, the same lines every alert on this phase
  already has to key on to distinguish an opportunity-level failure from a suggestions-level one.
- Wired into the four offsite guidance-handlers (`{wikipedia,cited,reddit,youtube}-analysis`, which
  call `indexOffsiteOpportunityByUrl`) after `opportunity.save()` + `syncSuggestions`, and after
  housekeeping for the three that have it (cited/reddit/youtube), so the sync never picks up a
  suggestion housekeeping is about to delete. Each handler defines and passes its own
  `getOpportunityUrls`/`getSuggestionUrls`, returning raw URL candidates straight from the payload -
  the hygiene gate that decides what's indexable lives in `lookup-index.js` (see above), not here.
  Opportunity level: `fullAnalysis.wikipediaUrl` for wikipedia; the per-type analysis-wide source
  list for cited/youtube (`dashboard.analytics.performance.insights.content.sources`) and reddit
  (`...insights.combined.sources`). Suggestion level: `data.bindings.sources[].url` for
  cited/reddit/youtube; wikipedia's suggestions return the opportunity's own URL (see ADR 006 for
  why these are three independent extractor pairs rather than one shared helper, despite an
  identical shape today).
- A suppressed run (`cited`/`reddit`/`youtube`, when the incoming run is `IGNORED`) is synced
  exactly like any other run - no `isSuppressedRun` branch near the funneling call, and no status
  pin on its suggestions. Its `IGNORED` opportunity is already correctly hidden by the Lookup
  Service read API's default status exclusion and becomes resolvable the moment it's promoted, with
  no re-sync needed; its suggestions are synced with their normal status too, pending a read-side
  fix (tracked against the suggestions `/by-url` endpoint, not this repo) to also exclude
  suggestions of an `IGNORED` parent opportunity (see ADR 006, Decision 8, and its Alternatives for
  why a status pin was rejected instead).
- Forward-only: no backfill. Evergreen opportunities repopulate the index on their next run.

## Cross-repo dependency

`syncUrlIndex`/`syncUrlIndexMany` ship in `@adobe/spacecat-shared-data-access`; this repo consumes
the published version containing them and adds nothing to that package.

## Alternatives

- **Read-time fan-out (no index).** Ask each producer "do you back this URL?" at query time.
  Rejected by the Lookup Service architecture itself: O(producers) per lookup, couples the reader to
  producer internals — what the shared index removes.
- **One combined function instead of two entity-scoped ones; precomputed counts/identifiers instead
  of raw submitted/synced data; a `status` field alongside `error`; a `phase` field; `dimension`/
  `level` fields on every log line; a third shared module.** All rejected — see ADR 006's
  Alternatives.

## Success criteria

- `indexOpportunityByUrl`/`indexOpportunitySuggestionsByUrl` each independently sync one entity
  level for any of the four offsite types, resolving to exactly what was submitted and exactly what
  the writer returned on success, or `{ error }` (with a reason in `error.message` and the original
  failure, if any, as `error.cause`) on failure. Neither ever throws, and neither interprets its own
  result beyond passing it through.
- `indexOffsiteOpportunityByUrl` logs one `audit_funneling_start`, two
  `audit_funneling_index_url_synced` lines, and one `audit_funneling_end` per call; a sync-outcome
  line is `degraded` when its underlying call returned `error` or its result can't be interpreted,
  `success` otherwise, with its counts derived by this module from the shared foundation's raw
  result; `audit_funneling_start`/`audit_funneling_end` are always `success` - they mark that the
  phase ran, not what happened inside it.
- 100% line/branch/statement coverage on `lookup-index.js` + `offsite-lookup-index.js` + each
  handler's extractors.

## Out of scope / follow-up

- The Topic and Claim lookup dimensions, and the semantic index they'd write to — specified in the
  architecture doc, not built here. This integration's shape (entity-scoped functions, a raw
  submitted/synced result, an `error`-only failure contract) is designed so adding them is additive;
  whether the audit-event schema needs a `dimension`/`level` field at that point is a decision for
  then, against a real second dimension to design against (see ADR 006, Decision 7).
- Whether "nothing submitted this run" should be surfaced as its own signal (distinct from a
  genuine sync failure) is an open question this integration does not resolve — see ADR 006's
  Consequences.
- URL *normalization/canonicalization* (scheme/www/trailing-slash) is owned by `syncUrlIndex`
  itself, not this integration. `lookup-index.js`'s own gate (`sanitizeUrls`) rejects on
  shape/scheme validity, credential and sensitive-parameter presence, and length, de-duplicates on
  the post-strip string, and caps the result - see Scope above. Because canonicalization collapses
  further than the pre-canonical dedup here can (scheme/`www`/trailing-slash/case), a healthy write
  can legitimately report `submittedUrlCount` slightly above `syncedUrlCount`; this is not a
  divergence signal. It deliberately does not strip or reorder other query parameters (e.g. YouTube's
  `watch?v=`, where the query string is the resource identity), so a broader normalization policy
  per source type remains open.
- A reconciliation sweep for index-vs-source divergence from a *write* failure — detection exists
  (a `'failed'` result surfaces as `outcome=degraded`), correction does not. Divergence from a
  *delete* is already handled: both pointer tables' `entity_id` FK is `ON DELETE CASCADE`.
- Status filtering on read. The index carries no lifecycle status, by design; an entity remains
  indexed regardless of its status, and it is the reader's job to filter, same as the primary
  tables.
