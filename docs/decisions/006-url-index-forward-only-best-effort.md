# 006 — URL Index Producer: Forward-Only, Best-Effort Write

- **Status:** Accepted
- **Date:** 2026-09-03
- **Related:** spec `docs/specs/2026-08-18-url-index-producer.md` · producer `src/common/url-index.js`

## Context

The write-time shared URL index records which source URL(s) back each opportunity/suggestion so
`spacecat-api-service` can resolve "which entity is backed by this URL?" with one indexed lookup.
The pointer tables and the `syncUrlIndex`/`syncUrlIndexMany` writer live in
`@adobe/spacecat-shared-data-access`; this repo owns only URL extraction and the call site
(`syncOpportunityUrlIndex`, wired into the four offsite guidance handlers). Two of its behavior
choices are non-obvious, long-term trade-offs, so per CLAUDE.md they are recorded here.

## Decision

1. **Forward-only: no backfill.** Only opportunities/suggestions persisted after this ships are
   indexed. The offsite audits are evergreen and refresh weekly, so each site self-heals into the
   index within a week — not worth a one-off migration.

2. **Best-effort: the index write never fails the audit.** `syncOpportunityUrlIndex` swallows any
   error. The index is a derived read-optimization; a PostgREST hiccup must not roll back a
   successful opportunity/suggestion persist.

3. **The swallowed failure stays attributable and alertable.** A `phase` label
   (`opportunity-index` / `suggestion-fetch` / `suggestion-index`) and a stable
   `event=url_index_sync outcome=failure` token are logged via the offsite taxonomy
   (`src/utils/offsite-logging.js`), so index drift is countable in Splunk rather than silent.

## Consequences

- Until a site's next refresh, its rows are **not** resolvable via the index — a URL miss means
  "not indexed yet," not "absent."
- A persistent write failure diverges the index from its source tables. Detection exists
  (Decision 3) but correction does not: a reconciliation sweep belongs in the larger system before
  the lookup service is authoritative. Out of scope here.
- Adding a backfill later is additive and needs no producer change.

## Alternatives Considered

- **Backfill on ship.** Rejected: a migration for data that repopulates within a week.
- **Fail the audit on write error.** Rejected: makes a customer-visible persist hostage to a
  secondary store.
- **Swallow silently.** Rejected: index/source divergence must stay observable — hence Decision 3.
