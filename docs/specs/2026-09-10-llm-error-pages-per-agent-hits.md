# Spec: Per-agent hit breakdown in llm-error-pages suggestion history

**Status:** Proposed
**Author:** Yaashi Madan
**Date:** 2026-09-10
**Ticket:** _to be filed under LLMO before merge_
**Related:** ADR `docs/decisions/003-llm-error-pages-per-agent-hit-breakdown.md` · consumer PR adobe/project-elmo-ui#3132 (agent distribution + per-agent filter, which already ships a forward-compatible `weeklyBreakdown.perAgent` hook) · schema reference `reference_llm_error_pages_consolidated_schema`

---

## 1. Problem statement

Each `llm-error-pages-{403,404,5xx}` suggestion stores a weekly `history[]`, where every
entry carries a single aggregate `hitCount` plus **lists** of the agents seen that week
(`agentTypes[]`, `userAgents[]`). It does **not** record how many of those hits each agent
contributed.

The ELMO UI (project-elmo-ui#3132) now renders a per-agent hit distribution and lets users
filter the error table by agent. Because the payload lacks a per-agent split, the UI must
**approximate**: it attributes a week's whole `hitCount` to every agent listed that week.
This is near-exact today (weeks are almost always single-agent) but is an approximation the
UI documents and would rather not make.

The exact per-agent counts already exist upstream and are discarded: the Athena query returns
**one row per URL × user_agent** (each with its own `total_requests`), and
`groupErrorsByUrl` (`src/llm-error-pages/utils.js`) sums them into a single `hitCount` while
deduping the agents into Sets.

## 2. Goals / non-goals

**Goals**
- Preserve the per-user-agent hit split that already arrives from Athena, and surface it on
  each weekly `history[]` entry as `perAgent: { [userAgent]: hitCount }`.
- Keep the field **additive and backward-compatible**: existing consumers and existing
  stored suggestions (no `perAgent`) keep working unchanged; the UI reads `perAgent` when
  present and falls back to whole-week attribution when absent.
- Bound the field so history payloads stay within existing size limits.
- 100% line/branch/statement coverage on all changed `src/` code (repo standard).

**Non-goals**
- The `observationUrls` wire-format sent to Mystique (`llm-broken-urls`) — it is
  contract-locked to Mystique's Pydantic validator (mystique #2490) and is **out of scope**.
- Any agent-type-level split (`perAgentType`). The UI distribution is by **user agent**; if a
  type-level split is ever needed it is a separate change.
- The paired UI change to actually consume `perAgent` — that ships as a small follow-up in
  project-elmo-ui (see §7); this spec covers the audit-worker side only.

## 3. Technical design

Three touch points, all in `src/llm-error-pages/`:

### 3.1 `groupErrorsByUrl` (`utils.js`)
While collapsing the URL × user_agent rows into one entry per URL, additionally accumulate a
per-user-agent hit map:

```js
// alongside the existing hitCount / agentTypes / userAgents accumulation
entry.perAgent = entry.perAgent || {};
if (error.user_agent) {
  entry.perAgent[error.user_agent] =
    (entry.perAgent[error.user_agent] || 0) + (error.total_requests ?? 0);
}
```

On return, emit `perAgent` **bounded to the top `MAX_AGENT_ENTRIES` (10) user agents by
hitCount**, mirroring the existing cap on `agentTypes`/`userAgents`:

```js
perAgent: Object.fromEntries(
  Object.entries(entry.perAgent)
    .sort(([, a], [, b]) => b - a)
    .slice(0, MAX_AGENT_ENTRIES),
),
```

`MAX_AGENT_ENTRIES` currently lives in `handler.js`; export it from `utils.js` (or introduce a
shared constant module) so the cap is defined once and reused in both files — no duplicated
literal.

### 3.2 `buildWeekHistoryEntry` (`handler.js`)
Add `perAgent` to each week entry:

```js
function buildWeekHistoryEntry(item, periodIdentifier) {
  return {
    periodIdentifier,
    hitCount: item.hitCount,
    httpStatus: item.httpStatus,
    agentTypes: item.agentTypes.slice(0, MAX_AGENT_ENTRIES),
    userAgents: item.userAgents.slice(0, MAX_AGENT_ENTRIES),
    perAgent: item.perAgent ?? {},   // exact per-user-agent split (bounded upstream)
    avgTtfb: item.avgTtfb,
  };
}
```

### 3.3 Top-level snapshot (`mapNewSuggestion` / `mergeDataFunction`, `handler.js`)
The schema rule is "top-level fields = the latest week's snapshot." Carry `perAgent` on the
top-level `data` too, for consistency with `hitCount`/`agentTypes`/`userAgents`:
- `mapNewSuggestion`: add `perAgent: error.perAgent ?? {}` to `data`.
- `mergeDataFunction`: add `perAgent: newDataItem.perAgent ?? {}` (latest snapshot), history via
  the updated `buildWeekHistoryEntry`.

### 3.4 Schema shape
```
history[i].perAgent : { [userAgent: string]: number }   // hits that week, per user agent
data.perAgent        : { [userAgent: string]: number }   // latest week's snapshot
```
`perAgent` is always present on newly written entries (possibly `{}` when no user agent is
known). Sum of `perAgent` values equals the week's `hitCount` except where the top-N bound
drops a long tail of tiny agents — acceptable and consistent with the existing list caps.

## 4. Backward compatibility

- **Additive only** — no existing field changes type or meaning. Old stored suggestions
  without `perAgent` remain valid; consumers must treat it as optional.
- **UI (project-elmo-ui):** the recompute already prefers `weeklyBreakdown.perAgent` when
  present and falls back to whole-week attribution otherwise (shipped in #3132). Once this
  audit change deploys and the UI passthrough (§7) lands, numbers become exact with no
  further UI change.
- **Mystique observation path:** untouched (out of scope), so no cross-service contract move.

## 5. Testing (100% coverage required)

Extend the existing suites (`test/audits/llm-error-pages/utils.test.js`, `handler.test.js`):
- `groupErrorsByUrl`: multiple user_agents on one URL → correct `perAgent` sums; `total_requests`
  missing → treated as 0; a URL with >10 user agents → `perAgent` capped to top-10 by hits;
  row with no `user_agent` → not added to `perAgent`.
- `buildWeekHistoryEntry`: `perAgent` present passed through; `item.perAgent` undefined → `{}`.
- `mapNewSuggestion` / `mergeDataFunction`: `perAgent` on both top-level snapshot and history.
- Confirm no regression to existing `hitCount`/`agentTypes`/`userAgents` assertions.

## 6. Rollout

Additive schema + a pure derivation of already-fetched data → no flag needed; ships with the
next audit-worker release. `perAgent` starts appearing on suggestions the first time each
opportunity is re-audited after deploy (top-level immediately; history entries accrue per
week). No backfill.

## 7. Paired follow-up (project-elmo-ui)

Small, separate PR after this deploys: add optional `perAgent?: Record<string, number>` to the
UI's `WeekEntry` type and copy it through in `useErrorPageSuggestions` when building
`weeklyBreakdown`. The recompute + distribution already consume it. Keep it optional so the UI
stays backward-compatible with pre-deploy suggestions (falls back to whole-week attribution).
