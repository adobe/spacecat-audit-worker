# 003 — llm-error-pages: per-agent hit breakdown in suggestion history

- **Status:** Proposed
- **Date:** 2026-09-10
- **Related:** spec `docs/specs/2026-09-10-llm-error-pages-per-agent-hits.md` · consumer PR adobe/project-elmo-ui#3132 · ticket _to be filed under LLMO_

## Context

`llm-error-pages` suggestions store a weekly `history[]` where each entry has one aggregate
`hitCount` plus agent **lists** (`agentTypes[]`, `userAgents[]`) — not a per-agent hit split.
The ELMO UI (#3132) now shows a per-agent distribution and filters by agent, so it must
approximate by attributing a week's whole `hitCount` to every listed agent. The exact split
already exists upstream (Athena returns one row per URL × user_agent with `total_requests`)
but `groupErrorsByUrl` sums it away. This is a change to a **persisted suggestion schema
consumed by another service (the UI)**, so it warrants an ADR.

## Decision

1. **Emit `perAgent: { [userAgent]: hitCount }` on each `history[]` entry and on the
   top-level snapshot**, derived from the per-URL × user_agent Athena rows already received.
   Keyed by **user agent** (not agent type) to match the UI's distribution axis and the
   forward-compatible `weeklyBreakdown.perAgent` hook #3132 already ships.

2. **Additive and backward-compatible.** No existing field changes. Consumers treat
   `perAgent` as optional; old stored suggestions without it stay valid. The UI prefers
   `perAgent` when present and falls back to whole-week attribution otherwise.

3. **Bound to the top `MAX_AGENT_ENTRIES` (10) user agents by hitCount**, reusing the same
   cap already applied to `agentTypes`/`userAgents`, so history payloads stay within the
   existing size envelope. Consequence: `sum(perAgent) === hitCount` except when a long tail
   of tiny agents is dropped — an accepted, pre-existing trade-off consistent with the list
   caps. Define the cap once (shared/exported constant), not a duplicated literal.

4. **Scope excludes the Mystique observation wire-format** (`observationUrls`,
   `llm-broken-urls`). It is contract-locked to Mystique's Pydantic validator (mystique
   #2490); adding a field there would require a coordinated cross-service change and is out of
   scope. Only the suggestion `history[]`/snapshot path changes.

5. **No flag, no backfill.** It is a pure derivation of already-fetched data plus an additive
   field, so it ships with the next release; `perAgent` appears as opportunities are
   re-audited.

## Consequences

- The UI can move from approximate to exact per-agent numbers with a ~2-line follow-up
  (add optional `perAgent` to `WeekEntry` + pass it through in `useErrorPageSuggestions`); no
  rework of the distribution or filter logic.
- Suggestion payloads grow by at most one bounded map per week entry (≤10 entries).
- Because agent-type-level splits are deliberately not added, a future type-level breakdown
  would be a separate decision.

## Alternatives considered

- **`perAgent` keyed by agent type** — rejected; the UI distribution is per user agent, and a
  type map would still force the UI to approximate at the user-agent level.
- **Array of `{ userAgent, agentType, hitCount }`** — richer, but heavier and not needed by
  the consumer; a `Record<userAgent, number>` matches the shipped UI contract exactly.
- **Leave the approximation in the UI** — rejected; the exact data is already in hand and
  being discarded, and the whole-week attribution is a documented inaccuracy for multi-agent
  weeks.
