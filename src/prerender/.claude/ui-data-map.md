# UI Data Map — project-elmo-ui

Understanding how the UI consumes `status.json` and `Suggestion.data` is critical — any audit worker change that modifies these fields affects the UI.

---

## Source Files

| File | Role |
|------|------|
| `src/hooks/usePrerenderGains.ts` | Data fetching, thresholds, score calculations |
| `src/components/dashboards/opportunities/PrerenderOpportunitySection.tsx` | Main opportunity card and deploy UX |
| `src/utils/techGeoOpportunityUtils.ts` | Card creation, `allOptimized` detection |
| `src/components/ui/ExpandableURLSuggestionsTable.tsx` | Tab filter logic, status column rendering |

---

## Data Flow Overview

```
status.json (S3)
  └─► usePrerenderGains.ts
        ├─ Pages[] processing → rcvScoreByUrl (Map<url, score>), deployedAtEdgeUrls (Set<url>)
        ├─ Score aggregation → avgLlmVisibilityScore
        ├─ Error detection → scrapingErrorRateHigh, scrapeForbidden
        └─ Returns computed values ─────────────────────────────────────────┐
                                                                            ▼
Opportunity API (REST)                                      PrerenderOpportunitySection.tsx
  └─► Suggestions[] with Suggestion.data fields             ├─ Renders opportunity card header
        ├─ edgeDeployed, coveredByDomainWide               ├─ affectedPagesCount, estimatedContentGain
        ├─ wordCountBefore, wordCountAfter                 ├─ Deploy / Rollback buttons
        └─► ExpandableURLSuggestionsTable.tsx              └─► techGeoOpportunityUtils.ts (card setup)
               ├─ Current tab (active work)
               ├─ Fixed tab (deployed/optimized)
               └─ Ignored tab (skipped)
```

---

## `usePrerenderGains.ts` — Full Data Map

**S3 key consumed:** `prerender/scrapes/${siteId}/status.json`

### Constants
```ts
PRERENDER_STATUS_JSON_KEY        = 'prerender'
SCRAPING_ERROR_RATE_THRESHOLD    = 30   // % (matches status.json scrapingErrorRate field)
MIN_SCRAPED_PAGES_THRESHOLD      = 50   // absolute count of urlsScrapedSuccessfully
```

### Per-URL Score Function
```ts
getLlmVisibilityScore(wordCountBefore, wordCountAfter):
  Returns 100 if isDeployed OR !!coveredByDomainWide    // already handled
  Returns min(100, round(wordCountBefore / wordCountAfter * 100))  // raw visibility
```
This function is **exported** — consumed by ExpandableURLSuggestionsTable for per-row score display.

### status.json → Derived URL Sets

| Derived set | Definition from `status.json pages[]` |
|-------------|--------------------------------------|
| `pagesNotNeedingPrerender` | `needsPrerender === false && scrapingStatus === 'success'` |
| `pagesDeployedAtEdge` | `isDeployedAtEdge === true && needsPrerender === true` |
| `deployedAtEdgeSet` | `isDeployedAtEdge === true && needsPrerender === true` (used for `deployedAtEdgeUrls` Set) |

**Note:** `pagesDeployedAtEdge` intentionally excludes pages where `needsPrerender === false` — these are already good without edge deployment and count in `pagesNotNeedingPrerender` instead.

### `avgLlmVisibilityScore` — Full Calculation

This is the primary "LLM Visibility" score shown in the card header.

```
Step 1: score each non-domain-wide suggestion:
  if (edgeDeployed || coveredByDomainWide || isDeployed) → 100
  else → min(100, round(wordCountBefore / wordCountAfter * 100))

Step 2: add pagesNotNeedingPrerender × 100
  (these pages already have full visibility)

Step 3: divide by (scoredSuggestions + pagesNotNeedingPrerender)
  = weighted average across all URL types

Special case:
  if (isDomainWideDeployed && noOfUrlsNotNeedingPrerender === 0) → return 100
  (entire domain deployed and everything needs prerender → 100%)
```

**Where `avgLlmVisibilityScore` is consumed:**
- `PrerenderOpportunitySection.tsx` — renders as the headline "LLM Visibility" metric in the card
- `techGeoOpportunityUtils.ts` — `allOptimized = avgLlmVisibilityScore === 100` controls `totalUrls` display
- `usePrerenderGains.ts` itself — returned as part of hook result object

### `scrapingErrorRateHigh` Logic

```
hasEnoughScrapedPages = urlsScrapedSuccessfully >= MIN_SCRAPED_PAGES_THRESHOLD (50)

scrapingErrorRateHigh =
  !hasEnoughScrapedPages
  AND (lastAuditSuccess === false OR scrapingErrorRate >= SCRAPING_ERROR_RATE_THRESHOLD (30))

EXCEPTION: if isDomainWideDeployed === true → scrapingErrorRateHigh forced to false
  (don't show error banner when domain is already deployed)
```

**Maps to status.json fields:** `urlsScrapedSuccessfully`, `lastAuditSuccess`, `scrapingErrorRate`

### `scrapeForbidden` Source

Comes from **two sources** (OR logic):
1. `prerenderStatus?.scrapeForbidden` — from `status.json` (scraper detected bot-block)
2. `query.data.scrapeForbidden` — from opportunity REST API response (`Opportunity.data.scrapeForbidden`)

If either is true, `isScrapeForbidden` is set and the UI shows a "scrape forbidden" warning.

### Hook Return Values

```ts
{
  data,                           // raw opportunity data from API
  loading,
  error,
  refetch,
  rcvScoreByUrl: Map<string, number>,  // per-URL LLM score (consumed by table for per-row display)
  deployedAtEdgeUrls: Set<string>,     // URLs from status.json where isDeployedAtEdge=true && needsPrerender=true
  computeFilteredScore,               // function: recomputes avgLlmVisibilityScore for a filtered URL subset
  // also: avgLlmVisibilityScore, scrapingErrorRateHigh, scrapeForbidden, isDomainWideDeployed, ...
}
```

---

## `PrerenderOpportunitySection.tsx` — Card Metrics & UX

Consumes `usePrerenderGains(true)` hook (the `true` parameter enables full data loading).

### Computed Metrics

| Metric | Calculation | Notes |
|--------|-------------|-------|
| `affectedPagesCount` | Count of suggestions where `!isDeployed && !coveredByDomainWide && !isDomainWide` | Set to 0 when `avgReadability === 100` |
| `estimatedContentGain` | Average `contentGainRatio` across non-deployed URLs | Shown as "X× content gain" |
| `showScoreUnavailable` | `isScrapeForbidden \|\| isScrapingErrorRateHigh \|\| (avgReadability === 0 && suggestionsCount === 0)` | Replaces score with unavailable state |

### UX Flows by Tab

**Current tab:**
- Each row has a **Preview** button — opens HTML diff modal comparing `originalHtmlKey` (server-side) vs `prerenderedHtmlKey` (client-side) from `Suggestion.data`
- Both S3 keys are used for the diff view; if either is missing, Preview is disabled

**Fixed tab:**
- Each deployed row has a **Live Preview** button — makes a live request to the Tokowaka edge URL to show optimized content
- Status column displays deployment date from `edgeDeployed` ms timestamp
- `edgeOptimizeStatus === 'STALE'` shows "Content Changed" warning (content has changed since deploy)

**Rollback button:**
- Only rendered when `siteHasEdgeOptimizeConfig === true` (site has an active edge optimize config)
- Calls `rollbackSuggestions()` in the API → sets `prerender: false` in Tokowaka S3 config

### Free-Tier Domain-Wide Row

```
shouldDisableDomainWideRow = isFreeTier && !enableUnlimitedUrlDeploys (feature flag)
```

Free-tier sites without the `enableUnlimitedUrlDeploys` LaunchDarkly flag cannot deploy domain-wide. The domain-wide row renders as disabled with an upgrade prompt.

### Per-Batch Deploy Cap

`PAID_TIER_MAX_DEPLOY_BATCH` — hard cap on suggestions per deploy call. Enforced in the component to prevent API timeouts on large sites. Selecting more than this limit shows a warning and clips the selection.

---

## `techGeoOpportunityUtils.ts` — Card Creation

### `createPrerenderGainsOpportunity()` Behavior

| Condition | Effect |
|-----------|--------|
| `scrapeForbidden === true` | Card is **still shown** — no suggestions needed; shows scrape-forbidden message |
| `avgLlmVisibilityScore === 100` | `allOptimized = true` → `totalUrls = 0` (card shows "all optimized" state) |
| `prerenderOpportunity.id` available | Uses actual DB opportunity ID for the card |
| No DB opportunity ID | Falls back to static ID `'techgeo-prerender'` |

### `nonDeployedUrls` Filter

```ts
nonDeployedUrls = suggestions.filter(s =>
  !s.data.isDeployed &&
  !s.data.coveredByDomainWide &&
  !s.data.isDomainWide
)
```

Used to calculate the "X pages need prerender" count displayed on the card.

### `allOptimized` → `totalUrls = 0`

When `avgLlmVisibilityScore === 100`, `totalUrls` is set to 0. This makes the card show a "fully optimized" state rather than a count of affected pages. This is different from having 0 suggestions — the score being 100 is the signal.

---

## `ExpandableURLSuggestionsTable.tsx` — Tab Logic & Status Column

This is a **generic** reusable table component. The prerender-specific logic is injected via props (filter functions, status helpers).

### Three-Tab Filter Helpers (Prerender-Specific)

```ts
isSuggestionFixed(suggestion):
  status === 'FIXED'
  OR data.edgeDeployed is truthy      // user deployed via UI
  OR data.isDeployed is truthy        // alternative deploy flag

isSuggestionIgnored(suggestion):
  status === 'SKIPPED'

isCoveredByDomainWideDeployment(suggestion):
  !!data.coveredByDomainWide && !data.edgeDeployed
  // covered by domain-wide BUT not individually deployed
```

### Tab Membership Rules

| Tab | Inclusion condition | Notes |
|-----|---------------------|-------|
| **Current** | NOT `isCoveredByDomainWideDeployment` AND NOT `isSuggestionFixed` AND NOT `isSuggestionIgnored` | Unless `currentTabStatusFilter` overrides |
| **Fixed** | `isSuggestionFixed === true` | `edgeDeployed` or `isDeployed` truthy qualifies |
| **Ignored** | `isSuggestionIgnored === true` | Only `SKIPPED` status |
| **Hidden** (no tab) | `isCoveredByDomainWideDeployment === true` AND not fixed | Covered by domain-wide, not individually deployed — disappears from all tabs |

**Hidden suggestion audit worker implication:** When the audit writes `coveredByDomainWide` to a suggestion (after detecting `isDeployedAtEdge=true` for a URL under an active domain-wide pattern), that suggestion immediately disappears from the Current tab. Only set this field when the URL genuinely falls under an active domain-wide pattern.

### Fixed Tab: Status Column Sort & Display

When the "Status" column sort is active in the Fixed tab:
```
Sort order (highest priority first):
  1. edgeOptimizeStatus === 'STALE'   → "Content Changed" warning
  2. edgeDeployed is truthy           → "Optimized on [date]"
  3. fallback                         → "Marked as Fixed"
```

Status cell rendering:
- `edgeDeployed` (number, ms epoch) → formatted deployment date, tooltip "Optimized"
- `edgeOptimizeStatus === 'STALE'` → warning icon + "Content Changed" (content changed after deploy)
- No `edgeDeployed` → plain "Fixed" label

### `rcvScoreByUrl` Consumption

The `rcvScoreByUrl` Map (returned by `usePrerenderGains`) is passed to the table as a prop. Each row uses its URL key to display the per-URL LLM visibility score in the score column.
