# 006 — Lookup Service Write-Side Foundation

- **Status:** Accepted
- **Date:** 2026-09-15
- **Related:** spec `docs/specs/2026-08-18-lookup-service-offsite-integration.md` ·
  `src/common/lookup-index.js` · `src/common/lookup-index-utils.js` ·
  `src/common/offsite-lookup-index.js` · the Lookup Service
  architecture doc ("Offsite Intelligence - Funneling"), the source of truth this ADR aligns to

## Context

The Lookup Service architecture defines **funneling**: the capability that lets a customer already
looking at a URL, a topic, or a claim discover the Opportunity/Suggestion that already covers it.
Its write side (Option 2, "write-time shared index") is a **shared writer**
(`syncUrlIndex`/`syncUrlIndexMany`, shipped in `@adobe/spacecat-shared-data-access` — out of scope
here) that each opportunity-type producer calls from its own persist path, supplying match keys per
lookup dimension. URL is the first dimension; Topic and Claim are specified but not yet built.

`spacecat-audit-worker` is one such producer — today the only one, since it routes ~100 audit
types, onsite and offsite alike. This ADR records the shape of *this repo's* integration with that
shared writer: a small, dimension-oriented contract any opportunity type in this repo can call, with
offsite as the first real consumer.

## Decision

### Two integration layers, plus a shared leaf helper — no adapter or formatter module

1. **A shared foundation** (`src/common/lookup-index.js`), entity-generic (Opportunity /
   Suggestion) and dimension-oriented. Any opportunity type in this repo can call it directly; it
   knows nothing about offsite, or about any specific opportunity type. Its URL hygiene gate
   (Decision 9) lives in a leaf helper, `src/common/lookup-index-utils.js` — pure, dependency-free
   functions (`sanitizeUrls`, the `{ error }` failure shape and its `REASON` strings, resolving the
   caller's postgrest client) that `lookup-index.js` calls into. This is not a third *layer*: it
   carries no orchestration and is never called directly by an offsite handler.
2. **An offsite integration module** (`src/common/offsite-lookup-index.js`), which calls the shared
   foundation and owns everything offsite-specific: the `audit_funneling_*` event taxonomy (see
   `docs/specs/2026-07-31-offsite-structured-logging.md`, explicitly offsite-scoped) and offsite's
   own judgment about which derived counts are worth a log line.
3. **No adapter or formatter module.** A shared "adapter" helper factoring out start/sync/end
   logging for reuse by a future non-offsite integration is rejected as premature: there is exactly
   one integration today, and extracting a pattern from a single example is the same anti-pattern
   Decision 4 rejects for extractors. A shared "result-summary" formatting helper is rejected for a
   sharper reason: the shared foundation's result contract (Decision 5) is deliberately raw — there
   is no summary left to factor out, because summarizing is the caller's job, not something a
   fourth module would do on the caller's behalf.

### Shared foundation's public API

4. **Two entity-scoped functions, not one combined function:**

   ```js
   indexOpportunityByUrl({ context, opportunity, entityType, getUrls })
   indexOpportunitySuggestionsByUrl({ context, opportunity, entityType, getUrls })
   ```

   The `ByUrl` suffix mirrors the architecture doc's own read-side naming convention
   (`getOpportunitiesByTopic`, `getSuggestionsByTopic`, section 4.3) — the same suffix carries
   `ByTopic`/`ByClaim` later with no rename of the existing functions. The verb is `index`, matching
   the noun the architecture doc already uses for the tables themselves ("URL index",
   "Semantic index") — a reader who has never seen `syncUrlIndex` (the underlying primitive, one
   layer down, out of scope here) still reads `indexOpportunityByUrl` as "put this opportunity into
   the URL index." `entityType` (not `auditType`) matches the architecture doc's own column name
   (`opportunity_urls.entity_type`, section 3.2) — nothing offsite-specific leaks into a module every
   opportunity owner is meant to call. `getUrls` (not `getOpportunityUrls`/`getSuggestionUrls`)
   because the function name already says which entity it targets; for the suggestions function it
   takes only the suggestion, not the parent opportunity — a caller whose extraction also needs the
   opportunity (offsite's wikipedia type, whose suggestions share the opportunity's own URL) closes
   over it before passing `getUrls` in, rather than the shared foundation carrying a second argument
   only one caller needs.

   Splitting by entity level (rather than one function doing both) is what makes the relationship
   between opportunity-level and suggestion-level sync obvious from the API alone, and lets a future
   caller use only the half it needs. Each function independently guards a missing/unusable
   `postgrestClient` — neither can assume the other already checked, since they're independently
   callable.

### Result contract: raw, not summarized

5. **The contract reports exactly what was submitted and exactly what the writer returned; it never
   decides which derived counts, rates, or identifiers are worth surfacing.** Different opportunity
   owners may reasonably want different things out of the same sync — a count for a dashboard, a
   rate for an alert threshold, the raw URLs for a debug log — and there is no single "useful
   summary" that serves all of them. Deciding that is the caller's job, every time, not the shared
   foundation's job once.

   - `indexOpportunityByUrl` success → `{ opportunityId, submittedEntry, syncedIndexResult }`.
     `submittedEntry` is `{ entityId, urls }`, exactly what was handed to `syncUrlIndex` — `entityId`
     here is always equal to `opportunityId`; the two are named separately for structural symmetry
     with `indexOpportunitySuggestionsByUrl`'s `submittedEntries`, not because they can differ.
     `syncedIndexResult` is `syncUrlIndex`'s own return value, passed through verbatim.
   - `indexOpportunitySuggestionsByUrl` success → `{ opportunityId, submittedEntries,
     syncedIndexResult }`. `submittedEntries` is the batch exactly as submitted to
     `syncUrlIndexMany` (`{ entityId, urls }[]`) - one entry per suggestion the opportunity
     currently has, except a suggestion whose own candidates are non-empty but hygiene reduces
     them to nothing (`NO_INDEXABLE_URLS`, Decision 9), which is left out of the batch entirely so
     its existing rows are neither cleared nor blocked behind a sibling's bad data.
     `syncedIndexResult` is `syncUrlIndexMany`'s own return value, passed through verbatim;
     `undefined` when there were no suggestions to submit, since the writer is never called in
     that case.
   - Neither function normalizes, counts, or filters the raw data it hands back, and neither
     function returns a `status` field: whether the call succeeded is exactly whether `error` is
     present, so there is nothing a separate status field would say that `error`'s presence doesn't
     already say.
   - Either function's failure → `{ error }` only — no submitted or synced data, since none of the
     sync ran. `error.message` is exactly one of a small, fixed set of reason strings (exported as
     `REASON`) naming the stage that failed (resolving the postgrest client, extracting URLs, URLs
     extracted but none indexable (Decision 9), fetching suggestions, or the write itself) — never
     interpolated with anything else, so a caller
     can match on it directly rather than parsing a combined string. When there was one, the
     original underlying error (a rejected write, a throwing extractor) is attached as that
     `Error`'s standard `cause`. A caller who wants the stage reads `error.message` (or compares
     against `REASON`); a caller who wants the original failure reads `error.cause`; there is no
     separate `phase` property carrying information `error` already carries.
   - There is no field naming how many suggestions had nothing to sync, nor how many were left
     out of the batch for `NO_INDEXABLE_URLS` (Decision 9). "Nothing submitted this run" is a fact
     a caller can see for itself in `submittedEntry.urls` (empty) or in the length of
     `submittedEntries`; whether that fact is routine or worth a warning is the caller's judgment,
     not the shared foundation's - and deliberately so, this contract stays raw rather than adding
     a summary field for it.

### Reading the current suggestion set

6. **`indexOpportunitySuggestionsByUrl` queries the `Suggestion` collection directly
   (`context.dataAccess.Suggestion.allByOpportunityId`) rather than calling
   `opportunity.getSuggestions()`.** The latter is a per-instance memoized accessor in the shared
   data-access layer: once resolved on an `Opportunity` instance it stays cached until that same
   instance's own `save()`/`remove()`, and creating or deleting suggestions through the collection
   does not invalidate it. Every offsite persist path calls `syncSuggestions` — which itself calls
   `opportunity.getSuggestions()` — before this function runs, so the cache is reliably warm with
   the *pre-sync* suggestion set by the time indexing happens. Reading the collection directly
   guarantees this function always sees the current set, including suggestions the same persist
   path just created or deleted, at the cost of one extra read the memoized accessor would have
   skipped.

### Audit event schema

7. **The lookup dimension is encoded in the sync-outcome event's name, not a schema field, and the
   event schema carries no `level` field either.** `audit_funneling_start`/`audit_funneling_end` are
   the phase's fixed boundary pair (ADR [003](003-offsite-event-taxonomy-phase-boundaries.md)) —
   generic across whatever the funneling phase does internally, the same as every other phase's
   pair — while the interior sync-outcome event, `audit_funneling_index_url_synced`, names the URL
   dimension directly, the same way `data_acquisition_url_store_read` and other existing offsite
   events name what they act on rather than carrying a field for it. A `dimension` field would be
   redundant with what the event name already says; if Topic or Claim land, each gets its own
   `audit_funneling_index_topic_synced`/`audit_funneling_index_claim_synced` event rather than a
   shared name distinguished by a field, so every dimension's sync-outcome events stay independently
   queryable (`stats count by event where event like 'audit_funneling_index_url_%'`) without a
   `dimension` filter, while still sharing the phase's one `_start`/`_end` pair. A `level` field
   marking which entity a sync-outcome line describes would also be redundant: the two sync-outcome
   lines are already distinguishable by which fields they carry
   (`submittedUrlCount`/`syncedUrlCount` for the opportunity level vs.
   `submittedSuggestionCount`/`submittedUrlCount`/`syncedUrlCount` for the suggestions level —
   `syncedUrlCount` at the suggestions level sums `syncUrlIndexMany`'s per-entity Map values, the
   same quantity `syncUrlIndex` returns directly at the opportunity level. A `syncedSuggestionCount`
   companion to `submittedSuggestionCount` is deliberately not emitted: `syncUrlIndexMany` sets a
   Map entry for every submitted entry before any write happens, so that count could never differ
   from what was submitted and would carry no signal).

### The sync runs unconditionally, including for a suppressed run's snapshot

8. **The four guidance handlers call the funneling sync the same way regardless of whether the
   incoming run is suppressed — there is no `isSuppressedRun` branch anywhere near the sync
   call, and no status pin on the suggestions it submits.** The index carries no status of its
   own (Consequences), so lifecycle visibility is entirely the read side's job, the same as it
   already is for the primary tables. For an *opportunity*, that job is already done: the
   Lookup Service's read API (`spacecat-api-service`, `lookup-by-url.js`) excludes `IGNORED`
   opportunities by default and re-checks each match's *current* status at read time, not a
   status frozen into the index — so a suppressed-run snapshot's opportunity row can be synced
   immediately, stay correctly hidden while `IGNORED`, and become resolvable the moment an
   operator promotes it, with no re-sync needed. For its *suggestions*, that read-side job is
   not yet done: the suggestions `/by-url` endpoint filters on the suggestion's own status only
   and never checks the parent opportunity's — a tracked gap on that endpoint (still under
   development at the time of this decision), not a reason to compensate for it here by mutating
   suggestion status at creation. See Alternatives for why a status pin was rejected instead.

### URL hygiene is the foundation's job, not each caller's

9. **Whatever `getUrls` (Decision 4) returns is filtered through `sanitizeUrls`
   (`src/common/lookup-index-utils.js`) inside `indexOpportunityByUrl`/`indexOpportunitySuggestionsByUrl`
   themselves, before it becomes part of a submission — rejecting non-string, oversized, or
   credential-bearing candidates, stripping known sensitive query parameters and fragments,
   de-duplicating the result, and capping it at `MAX_URLS_PER_ENTITY` (500).** `getUrls`'s
   candidates ultimately originate from scraped or LLM-derived content the caller does not
   control, and every candidate that survives ends up in a shared, cross-tenant, customer-facing
   lookup table. Putting the gate here, once, means every current and future caller of the shared
   foundation gets it automatically rather than needing to remember to apply it before calling in —
   the alternative, each extractor filtering its own candidates, leaves the gate as something a
   caller can simply forget.

   De-duplication runs on the post-strip string, since stripping the fragment or a sensitive query
   parameter can turn two distinct candidates into the same URL. This is defense-in-depth, not a
   fix for a write failure: the underlying writer already canonicalizes and de-duplicates per
   entity before any upsert, so a raw duplicate was never going to fail the batch on its own. The
   real reason to dedup here is count fidelity — without it, `submittedUrlCount` would count the
   same URL twice — and it is cheap. One consequence worth knowing: canonicalization collapses
   further than this repo's pre-canonical dedup can (scheme, `www`, trailing slash, case), so
   `submittedUrlCount` and `syncedUrlCount` can legitimately differ on a fully healthy write. That
   is expected, not a signal of loss.

   The cap exists because there is otherwise no bound on request count: the writer's own
   `URL_CHUNK_SIZE` bounds the size of each HTTP request, not how many requests one entity's
   submission produces, so an unbounded candidate list from an untrusted analysis payload could
   drive an unbounded number of serial round-trips and rows in a shared table. 500 is chosen to sit
   well above any legitimate source count while still being a real bound; truncation past that
   point is not logged separately.

   `submittedEntry`/`submittedEntries` (Decision 5) reflect the post-hygiene URLs, which is still
   "exactly what was submitted to the writer."

   A genuinely empty `getUrls` result still clears the entity's rows (Decision 8's self-healing
   design depends on this). A **non-empty** candidate list that hygiene reduces to nothing is
   treated differently: both functions compare the raw candidate list to the sanitized one, and
   when the raw list was non-empty but nothing survived, the entity is never submitted as an empty
   array. Without this distinction, a payload-shape drift in `getUrls` (a renamed field, a changed
   nesting) would produce the same `[]` the writer treats as "this entity has no sources anymore,"
   and would delete rows that are still current. The underlying writer already has a guard for
   exactly this shape (`assertClearable`, which throws when a *non-empty* input reduces to
   nothing) — but this module hands it the already-sanitized array, so that guard alone cannot see
   the raw input's shape. The check here restores the distinction the writer's guard would
   otherwise be blind to.

   The two functions differ in what "never submitted as empty" means, because they differ in
   blast radius. `indexOpportunityByUrl` has exactly one entity to sync, so `NO_INDEXABLE_URLS`
   fails the whole call (`{ error }`, Decision 5) — there is nothing else to protect by continuing.
   `indexOpportunitySuggestionsByUrl` syncs a batch, so failing the whole call on one suggestion's
   bad data would leave every sibling suggestion's index stale until the same drifted suggestion
   resolves — the batch equivalent of the exact "no self-heal on promotion" failure Decision 8
   already rejects a different shape of. Instead, that one suggestion is left out of
   `submittedEntries` (Decision 5) and the rest of the batch is submitted normally; any other
   failure (the extractor itself throwing, the suggestion fetch failing) still fails the whole
   call, since that is more likely a systemic problem than one entity's bad data.

## Consequences

- Any opportunity type in this repo can call `lookup-index.js` directly, with no offsite dependency
  and no logging side effect of its own.
- `lookup-index.js` decides what counts as an indexable URL (Decision 9), but has no opinion at all
  on which fields of an opportunity/suggestion payload are worth considering as candidates in the
  first place - that extraction logic is entirely the caller's, per entity type (Decision 4).
- Every caller of `lookup-index.js` — today only `offsite-lookup-index.js` — is responsible for its own
  interpretation of `syncedIndexResult`'s shape (`syncUrlIndex` resolves to a number today;
  `syncUrlIndexMany` resolves to a `Map`). This is a deliberate trade: the shared foundation stays
  free of any assumption about what a caller wants to count, at the cost of every caller needing to
  know what the underlying writer returns. If that shape becomes a real burden across multiple
  callers, revisit whether the shared foundation should normalize it — see Alternatives.
- A caller that cannot interpret `syncedIndexResult` treats the write as *unknown*, not as a match
  with what was submitted. Falling back to the submitted count when something was actually
  submitted would report a clean success for a write whose real outcome nobody checked — a matching
  pair of numbers reads as confirmed-fine to anyone scanning logs, when what actually happened is
  "we can no longer tell." The one case where a `syncedIndexResult` gap is legitimate is nothing
  having been submitted at all (the writer is never called), which offsite reports as a plain zero,
  not as an unknown.
- Adding the Topic or Claim dimension later is additive to `lookup-index.js`
  (`indexOpportunityByTopic`, ...) — the two-function-per-dimension shape and the `error`-only
  failure contract both carry over unchanged; only the event-schema question (Decision 7) is
  explicitly a decision for that point in time, not one made here.
- Until a site's next refresh, its rows are **not** resolvable via the index — a URL miss means
  "not indexed yet," not "absent" (forward-only; no backfill — see Alternatives).
- A persistent *write* failure diverges the index from its source tables. Detection exists (a
  failed sync surfaces as `outcome=degraded` in the offsite log) but correction does not; a
  reconciliation sweep belongs in the larger system before the lookup service is authoritative.
  This gap does not apply to deletes: both `opportunity_urls` and `suggestion_urls`' `entity_id` FK
  are `ON DELETE CASCADE`, so a deleted opportunity or suggestion — including one removed by this
  repo's own housekeeping — takes its index rows with it atomically, at the database level.
- The index is deliberately lifecycle-agnostic: it carries no status, so a suggestion indexed while
  `NEW` is still indexed once it is `FIXED`/`SKIPPED`/etc. Status filtering is the reader's job,
  exactly as it already is for the primary opportunity/suggestion tables — including a
  suppressed-run snapshot's `IGNORED` opportunity, which the sync treats no differently from an
  evergreen one (Decision 8). A suppressed run's suggestions are the one part of this that is not
  yet fully closed: they are synced with their normal, unpinned status, and are correctly hidden
  once the read side's suggestions lookup also excludes suggestions of an `IGNORED` parent
  opportunity — a fix tracked against that endpoint, not this repo. Until that lands, a suppressed
  run's suggestions are indexed but not yet reliably hidden from a by-URL suggestion lookup; its
  opportunity, in contrast, already is (the opportunities `/by-url` endpoint's `IGNORED` exclusion
  is in place today). The snapshot's rows are bounded either way: retention deletes the snapshot
  opportunity, and both pointer tables' `ON DELETE CASCADE` take its index rows with it.
- **Open question, intentionally not resolved by this ADR:** `offsite-lookup-index.js` logs
  `outcome=success` for a level whenever its sync did not error, including when nothing was
  submitted. Whether "nothing submitted" deserves its own signal — distinct from both a genuine
  failure and routine success, on the reasoning that it can also be the shape a silently broken
  upstream extractor produces — is left to offsite's judgment to decide and revisit, not assumed
  here; the raw-result contract in Decision 5 is what makes that a decision offsite can make (and
  change) unilaterally, without touching the shared foundation.

## Alternatives Considered

- **One combined `indexOpportunityAndSuggestionsByUrl` function.** Rejected (Decision 4): a single
  function doing both entities' work makes the opportunity-vs-suggestion relationship non-obvious
  from the API, and can't be called for just one entity level.
- **A third "adapter helper" or "result formatter" module.** Rejected (Decision 3) — see above.
- **A result contract with precomputed counts, identifiers, or a `writeMismatch`/`status`/`phase`
  field.** Rejected (Decision 5): every one of these is a judgment about what's worth knowing,
  imposed once on every future caller. The raw submitted/synced data lets each caller make that
  judgment for itself, as many times and in as many different shapes as it needs.
- **`dimension`/`level` fields on every log line.** Rejected (Decision 7): the event name already
  names the dimension, so a `dimension` field would be redundant on every line; `level` restates
  what the existing field set already shows.
- **Backfill on ship.** Rejected: a migration for data that repopulates within a week.
- **Fail the audit on a write error.** Rejected: makes a customer-visible persist hostage to a
  secondary store.
- **Swallow a write failure silently.** Rejected: index/source divergence must stay observable —
  the `error`-only result contract exists specifically so a caller can always tell.
- **Skip the funneling sync outright for a suppressed run.** Rejected: the opportunity level does
  not need it — the read side already excludes `IGNORED` opportunities and re-checks status live,
  so syncing plainly is both simpler and self-resolving on promotion. Skipping would instead
  reproduce the exact gap this decision exists to avoid: a promoted snapshot with no later run to
  index it on, permanently unresolvable via the lookup.
- **Pin a suppressed-run snapshot's suggestions to `SKIPPED` or `REJECTED` at creation, so the
  reader's default status exclusion hides them from the by-URL lookup.** Rejected. It would work
  as an immediate hiding mechanism (the suggestions endpoint's `defaultExcludedStatuses` already
  covers both), but reproduces the same "no self-heal on promotion" failure this decision exists to
  avoid, just moved from the index to the suggestion's own status: nothing transitions a pinned
  suggestion back to `NEW` when its parent opportunity is promoted, so it would stay permanently
  hidden for a reason that no longer applies. It also changes what the primary `suggestions` table
  itself reports — every other consumer, not only the lookup index — to compensate for a secondary
  index's visibility gap; neither status is even a sanctioned create-time value (`SUGGESTION_CREATE`
  only allows `NEW`/`PENDING_VALIDATION`/`OUTDATED`), and `REJECTED` specifically is reserved for a
  paid reviewer's decline (`spacecat-shared-data-access`'s transition table calls this out as its
  "one hard rule") — reusing it here would misrepresent why the suggestion is hidden. The correct
  fix is on the read side (Decision 8): the suggestions lookup should check the parent opportunity's
  status the same way the opportunities lookup already does, not have this repo work around the read
  side's gap by mutating a status that outlives the reason for it.
- **Have each caller's extractor apply URL hygiene itself, rather than the shared foundation
  (Decision 9).** Rejected: every extractor's candidates end up in the same shared table, so the
  gate is the same regardless of which entity type is calling in - duplicating it per extractor
  multiplies the places a future caller could omit it, for no benefit specific to any one caller.
