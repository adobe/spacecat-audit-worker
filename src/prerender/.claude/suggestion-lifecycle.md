# Suggestion Lifecycle — Prerender Audit

Read this file when working on: suggestion creation/update logic, OUTDATED marking, domain-wide suggestion preservation, `syncSuggestions`, `coveredByDomainWide`, or `edgeDeployed` handling.

---

## Suggestion Data Fields (Locked Contracts)

Suggestions have **type `CONFIG_UPDATE`** (not `prerender`). Changing field names or semantics requires coordinated PRs across spacecat-api-service and project-elmo-ui.

### Per-URL Suggestion data fields

```json
{
  "url": "string (page URL)",
  "scrapeJobId": "string (optional — may be absent for older suggestions)",
  "wordCountBefore": 70,
  "wordCountAfter": 5881,
  "contentGainRatio": 84.01,
  "citabilityScore": 1,
  "originalHtmlKey": "prerender/scrapes/{scrapeJobId}/{sanitizedPath}/server-side.html",
  "prerenderedHtmlKey": "prerender/scrapes/{scrapeJobId}/{sanitizedPath}/client-side.html",
  "valuable": true,
  "aiSummary": "string (optional — absent until Mystique processes it)",
  "edgeDeployed": 1777489106583,
  "coveredByDomainWide": "uuid-of-domain-wide-suggestion | null"
}
```

- **`edgeDeployed`**: **Timestamp (number, ms since epoch)** — when edge deployment was detected, NOT a boolean. Check truthiness (`if (data.edgeDeployed)`) to test presence.
- **`coveredByDomainWide`**: **UUID string** (the suggestion ID of the covering domain-wide suggestion), NOT a boolean. Null when not covered.
- **`citabilityScore`**: Integer ranking for URL prioritization; lower is higher priority.
- **`valuable`**: Optional boolean; set by Mystique AI after analysis.
- **`aiSummary`**: Optional string; set by Mystique AI; absent until processed.

### Domain-Wide Suggestion data fields

```json
{
  "url": "https://example.com/* (All Domain URLs)",
  "pathPattern": "/*",
  "isDomainWide": true,
  "wordCountBefore": 43493,
  "wordCountAfter": 331864,
  "contentGainRatio": 4053.34,
  "aiReadablePercent": 1079,
  "allowedRegexPatterns": ["/*"]
}
```

Does NOT have `originalHtmlKey`, `prerenderedHtmlKey`, `scrapeJobId`, `citabilityScore`, `valuable`, `aiSummary`.

---

## Golden Rules (Never Violate)

These six invariants define correctness for the prerender opportunity system. Any code path — audit worker, api-service, guidance-handler — that would violate one of these is a bug.

| Rule ID | Invariant | Exception / Detail |
|---------|-----------|-------------------|
| `multi-dw-NEW` | Exactly **one** domain-wide suggestion with `status=NEW` must exist per site at any time | A domain-wide can transition to OUTDATED — that is the only other allowed status (see `dw-wrong-status`) |
| `dw-wrong-status` | Domain-wide suggestion status must be **NEW or OUTDATED only** — never FIXED, SKIPPED, APPROVED, etc. | System creates it as NEW; only audit worker may set it OUTDATED |
| `edgeDep-wrong-status` | If `data.edgeDeployed` is set on a suggestion, its status must be **NEW** | OUTDATED is allowed **only** when another non-OUTDATED suggestion exists at the same normalized path (covers www/non-www and trailing-slash variants — duplicate cleanup scenario) |
| `edgeDep-covByDW-mutex` | `data.edgeDeployed` and `data.coveredByDomainWide` are **mutually exclusive** — a suggestion must never have both set | A suggestion is either directly deployed (`edgeDeployed`) OR covered by the domain-wide deploy (`coveredByDomainWide`), never both |
| `dw-deployed-no-covByDomWide` | If the domain-wide suggestion has `edgeDeployed` set AND a URL's `isDeployedAtEdge=true` in status.json AND the URL suggestion does **not** have `edgeDeployed`, then `data.coveredByDomainWide` **must** be set to the domain-wide suggestion's UUID | This is the only data mutation the audit worker performs on an existing suggestion that is not newly created |
| `sys-SKIPPED-FIXED` | The **system must never set** `status=SKIPPED` or `status=FIXED` on a suggestion | SKIPPED and FIXED are user-action statuses only: SKIPPED set by UI, FIXED set by spacecat-api-service after deploy validation. Audit worker writes only NEW and OUTDATED. |

**Scraping corollary (not a DB invariant but enforced in step 2):**
If `isDeployedAtEdge=true` for a URL in `status.json`, that URL is excluded from the scrape job submission. It will not appear in the next batch's comparison results.

---

## All Suggestion Statuses

Complete status set from `Suggestion.STATUSES` (`spacecat-shared-data-access`):

| Status | Set by | Prerender context |
|--------|--------|-------------------|
| `NEW` | Audit worker (`syncSuggestions`) | Default for newly created suggestions |
| `APPROVED` | UI user action | User approved suggestion for deployment |
| `IN_PROGRESS` | spacecat-api-service | Deployment in progress |
| `SKIPPED` | UI user action | User dismissed suggestion (not deployed) |
| `FIXED` | spacecat-api-service (post-deploy validation) | Suggestion deployed and validated |
| `ERROR` | spacecat-api-service | Deploy failed |
| `OUTDATED` | Audit worker (`syncSuggestions`) | URL was re-scraped and no longer needs prerender, OR conditions changed |
| `PENDING_VALIDATION` | spacecat-api-service | Deployed, awaiting edge validation |
| `REJECTED` | UI user action | User rejected suggestion |

---

## What the Audit Worker Writes

| Write | Field / Status | Handler | When |
|-------|---------------|---------|------|
| Status `NEW` | `Suggestion.status` | `handler.js` | Only on **new suggestion creation** via `syncSuggestions` |
| Status `OUTDATED` | `Suggestion.status` | `handler.js` | Only on **existing suggestions** that are re-scraped and no longer need prerender |
| `data.coveredByDomainWide` | `Suggestion.data` | `handler.js` | Only when `isDeployedAtEdge=true` for the URL AND a domain-wide suggestion with `edgeDeployed` is active |
| Core `data.*` fields | `Suggestion.data` | `handler.js` | On **new suggestion creation** via `mapSuggestionData`. Also updated via `mergeDataFunction` when the same URL is re-scraped: spreads existing data then overlays new — so `scrapeJobId`, word counts, S3 keys, `citabilityScore` ARE updated on re-discovery (the c8-ignored branch in the merge function) |
| `data.aiSummary` | `Suggestion.data` | `guidance-handler.js` | Updated only when `aiSummary` is truthy AND `!== 'not available'` (case-insensitive). Otherwise preserves existing value (`currentData.aiSummary ?? ''`) — note the fallback is empty string `''`, not `undefined`. OUTDATED suggestions are skipped entirely before the URL map is built. |
| `data.valuable` | `Suggestion.data` | `guidance-handler.js` | Updated atomically with `aiSummary` (same condition). If Mystique sends a non-boolean `valuable`, it defaults to `true`. If aiSummary is invalid (not updated), existing `valuable` is preserved (`currentData.valuable ?? true`). Never updated independently. |

**The audit worker NEVER writes**:
- `data.edgeDeployed` — set exclusively by user deploy action via UI (spacecat-api-service)
- `data.aiSummary`, `data.valuable` — written only by guidance-handler.js, never by main handler
- Any status other than `NEW` or `OUTDATED`

**guidance-handler.js also skips**: OUTDATED suggestions are excluded before the URL→suggestion map is built — Mystique responses never update stale suggestions.

### isDeployedAtEdge=true Behavior (3-Part Invariant)

1. **Step 2**: URL excluded from scraper submission — not re-audited
2. **Step 3**: URL's existing suggestion excluded from `OUTDATED` marking — never falsely staled
3. **Step 3**: If a domain-wide suggestion has `edgeDeployed` set → audit writes `coveredByDomainWide` on that URL's suggestion (the only data mutation the audit makes on existing suggestions)

Note: If no domain-wide suggestion with `edgeDeployed` exists, the URL's suggestion is simply left unchanged (not marked OUTDATED, not modified). It is the UI/api-service's responsibility to set `edgeDeployed` after a deploy action.

---

## Domain-Wide Suggestion Preservation Logic

The function `shouldPreserveDomainWideSuggestion()` (`handler.js:130`) decides whether to keep an existing domain-wide suggestion across audit runs:

```javascript
const ACTIVE_STATUSES = [
  Suggestion.STATUSES.NEW,
  Suggestion.STATUSES.FIXED,
  Suggestion.STATUSES.PENDING_VALIDATION,
  Suggestion.STATUSES.SKIPPED,
];

return ACTIVE_STATUSES.includes(status) || !!data?.edgeDeployed;
```

**Preserved when**:

| Condition | Reason |
|-----------|--------|
| Status = `NEW` | Suggestion is live and unacted on; preserve it for the user |
| Status = `FIXED` | Already deployed and validated; don't recreate |
| Status = `PENDING_VALIDATION` | Deployment in flight; don't recreate |
| Status = `SKIPPED` | User dismissed it; respect that decision |
| `data.edgeDeployed` is set | Was deployed at some point (regardless of status); deployment state must persist |

**NOT preserved** (audit creates fresh): `APPROVED`, `OUTDATED`, `ERROR`, `REJECTED`, `IN_PROGRESS`

**Note**: `APPROVED` is intentionally not preserved — if a user approved but hasn't deployed yet, the next audit run will recreate the domain-wide suggestion with updated metrics. The `edgeDeployed` check covers the post-deploy path regardless of what status was set.

**Locked**: Do not change this function's logic without confirming with the UI team — the tab display in project-elmo-ui depends on these states.

---

## OUTDATED Marking Protection

URLs are marked OUTDATED only if ALL conditions met:

```
- suggestion's pathname (toPathname(data.url)) is in scrapedUrlsSet (was actually scraped)
- data.edgeDeployed is falsy (no prerender needed for edge-deployed URLs)
- data.coveredByDomainWide is null/falsy (no domain-wide suggestion covers it)
- data.isDomainWide is not true (not the domain-wide suggestion itself)
- URL is NOT in failed scrapes (error during scraping)
```

**Note on `scrapedUrlsSet`**: This is a pathname-normalizing wrapper `{ has: url => pathnames.has(toPathname(url)) }`, not a plain `Set<string>`. This ensures a suggestion keyed on `www.example.com/page` is correctly marked OUTDATED even when the current run's URL is `example.com/page`. See [D-22](.claude/decision-log.md).

**Rationale**: Prevent false OUTDATED marking that causes user confusion.

---

## Domain-Wide Suggestion Edge Cases

1. **edgeDeployed** (timestamp ms): Set by **user action from the UI** when deploying a suggestion — NOT set by the audit worker. Two deploy paths:
   - **Individual URL deploy** → `edgeDeployed` timestamp written to that URL's suggestion only
   - **Domain-wide suggestion deploy** → `edgeDeployed` written to the domain-wide suggestion only; individual URL suggestions that fall under the pattern get `coveredByDomainWide` (UUID) set — done by `spacecat-api-service`
   - Audit worker reads `data.edgeDeployed` only to preserve suggestions (not mark OUTDATED); it never writes this field

2. **coveredByDomainWide** (UUID string of the domain-wide suggestion): Set in two ways:
   - By `spacecat-api-service` when user deploys the domain-wide suggestion
   - By **prerender audit** itself: when a new scrape detects `isDeployedAtEdge=true` for a URL and there is already an active domain-wide suggestion deployed — audit sets `coveredByDomainWide` on that URL's suggestion
   - **Why `coveredByDomainWide` instead of setting status=SKIPPED**: The SKIPPED approach was tried but abandoned because rollback only clears `coveredByDomainWide` — it doesn't touch status. With SKIPPED, the UI had to manually call `bulkUpdateSuggestionsStatus(NEW)` after rollback. With `coveredByDomainWide`, clearing the field on rollback auto-returns suggestions to the Current tab with no UI changes needed.

3. **isDomainWide=true**: This IS the domain-wide suggestion (url=baseUrl+`/* (All Domain URLs)`, pathPattern=`/*`)

**isDeployedAtEdge vs edgeDeployed — critical distinction:**

| Field | Source | Type | Set by | Meaning |
|-------|--------|------|--------|---------|
| `isDeployedAtEdge` | scrape.json → status.json pages[] | boolean | content-scraper | CDN/Tokowaka edge optimization detected in HTTP headers |
| `edgeDeployed` | Suggestion.data | number (ms epoch timestamp) | user action via UI | User has deployed a suggestion from the project-elmo-ui |

---

## Domain-Wide Aggregate — How Metrics Are Computed

`prepareDomainWideAggregateSuggestion()` builds one domain-wide suggestion from all per-URL suggestions that need prerender:

```
contentGainRatio    = SUM of all per-URL contentGainRatios
wordCountBefore     = SUM of all per-URL wordCountBefore
wordCountAfter      = SUM of all per-URL wordCountAfter
aiReadablePercent   = SUM of per-URL round((wordCountBefore / wordCountAfter) * 100)
```

`aiReadablePercent` is a sum of per-URL percentages, **not an average** — it can exceed 100. The UI interprets it accordingly. `agenticTraffic` is intentionally omitted from this object (computed by the UI from fresh CDN log data).
