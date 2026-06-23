# API Service — Tokowaka Deploy & Rollback

Covers the two HTTP endpoints in `spacecat-api-service` that write `edgeDeployed` and `coveredByDomainWide` to Suggestion.data. The audit worker never calls these directly but reads their downstream effects.

Source file: `spacecat-api-service/src/controllers/suggestions.js`  
Routes file: `spacecat-api-service/src/routes/index.js:272-273`

---

## Endpoints

| Method | URL | Controller function |
|--------|-----|---------------------|
| `POST` | `/sites/:siteId/opportunities/:opportunityId/suggestions/edge-deploy` | `deploySuggestionToEdge` |
| `POST` | `/sites/:siteId/opportunities/:opportunityId/suggestions/edge-rollback` | `rollbackSuggestionFromEdge` |

Both return **HTTP 207 Multi-Status** — per-suggestion success/failure, even for partial results.

---

## Access Control (Both Endpoints — All Three Required)

```
1. accessControlUtil.hasAccess(site)         → 403 if user not in org
2. accessControlUtil.isLLMOAdministrator()   → 403 if not LLMO admin
3. accessControlUtil.isOwnerOfSite(site)     → 403 if not site owner
```

All three checks must pass. Any failure returns 403 with specific message.

---

## Deploy: `deploySuggestionToEdge` (lines 1608–2034)

### Input
- `suggestionIds[]` from request body (deduplicated)
- Optional header `Prefer: respond-async` → triggers geo-experiment mode (see below)

### Validation Guards
| Condition | Error |
|-----------|-------|
| Suggestion not found | 404 |
| Domain-wide suggestion missing `allowedRegexPatterns` | 400 |
| Status not `NEW` or `PENDING_VALIDATION` | 400 |

### Call to TokowakaClient
```js
const deployResult = await tokowakaClient.deployToEdge({
  site,
  opportunity,
  targetSuggestions: allTargetSuggestions,  // regular + domain-wide
  allSuggestions,
  updatedBy: profile?.email || 'tokowaka-deployment',
});
```

Returns: `{ succeededSuggestions[], failedSuggestions[], coveredSuggestions[] }`

### Fields Written to Suggestion.data on Success
| Field | Value | Who writes it |
|-------|-------|---------------|
| `edgeDeployed` | `Date.now()` (ms epoch) | `TokowakaClient.deployToEdge()` |
| `coveredByDomainWide` | UUID of domain-wide suggestion | `TokowakaClient.deployToEdge()` for covered suggestions |
| `coveredByDomainWide` | `'same-batch-deployment'` string literal | `TokowakaClient.deployToEdge()` for same-batch URL suggestions |

### Status Is NOT Changed
Deploy **does not change** `Suggestion.status`. It stays `NEW` or `PENDING_VALIDATION` after deploy. Only `data.edgeDeployed` is what makes the UI classify a suggestion as "Fixed".

### Geo-Experiment Mode (Prefer: respond-async)
When the header `Prefer: respond-async` is present:
- Creates `GeoExperiment` record with status `GENERATING_BASELINE`, phase `PRE_ANALYSIS_STARTED`
- Uploads prompts to S3
- Submits pre-analysis schedule to DRS
- Sets `edgeOptimizeStatus: 'EXPERIMENT_IN_PROGRESS'` on suggestions
- Returns 207 immediately with experiment metadata (does NOT call `deployToEdge`)

This is a separate code path — the suggestion is NOT deployed in this mode.

### Error on TokowakaClient failure
All targeted suggestions move to `failedSuggestions[]` with status 500. No partial deploy.

---

## Rollback: `rollbackSuggestionFromEdge` (lines 2207–2467)

### Input
- `suggestionIds[]` from request body (must be non-empty)

### Validation Guards
| Condition | Error |
|-----------|-------|
| Suggestion not found | 404 |
| `data.edgeDeployed` is falsy (not deployed) | 400 "Suggestion has not been deployed, cannot rollback" |

### Two Code Paths: Domain-Wide vs Regular

#### Domain-Wide Rollback (handled directly in controller)
```
tokowakaClient.fetchMetaconfig(baseURL)
→ remove prerender from metaconfig
→ tokowakaClient.uploadMetaconfig(baseURL, updatedMetaconfig)
→ clear edgeDeployed + tokowakaDeployed from domain-wide suggestion
→ find all suggestions where coveredByDomainWide === domainSuggestionId
→ clear edgeDeployed + tokowakaDeployed + coveredByDomainWide from each covered suggestion
→ set updatedBy = 'domain-wide-rollback'
```

#### Regular URL Rollback (via TokowakaClient)
```js
const result = await tokowakaClient.rollbackSuggestions(site, opportunity, regularSuggestions);
```
On success: clear `edgeDeployed` + `tokowakaDeployed` from each suggestion.

### Fields Cleared from Suggestion.data on Rollback
| Field | Cleared for |
|-------|------------|
| `edgeDeployed` | All rolled-back suggestions (regular + domain-wide) |
| `tokowakaDeployed` | All rolled-back suggestions (**legacy field**, kept for backward compat) |
| `coveredByDomainWide` | Only for suggestions that were covered by the rolled-back domain-wide |

### Status Is NOT Changed
Rollback **does not change** `Suggestion.status`. Status remains whatever it was before.

### `updatedBy` field
Always written: `profile?.email || 'tokowaka-rollback'` (or `'domain-wide-rollback'` for covered suggestions).

---

## What the Audit Worker Sees After These Operations

| After deploy | Audit worker reads |
|-------------|-------------------|
| `edgeDeployed` set on URL suggestion | Suggestion preserved (not marked OUTDATED); excluded from active count |
| `coveredByDomainWide` set | Suggestion hidden from UI Current tab; not marked OUTDATED |
| `edgeOptimizeStatus: 'EXPERIMENT_IN_PROGRESS'` | Suggestion in geo-experiment — do not touch |

| After rollback | Audit worker reads |
|---------------|-------------------|
| `edgeDeployed` cleared | Suggestion eligible for re-scraping and OUTDATED marking again |
| `coveredByDomainWide` cleared | Suggestion re-appears in UI Current tab |

### Legacy `tokowakaDeployed` Field
Rollback always clears `tokowakaDeployed` (legacy). If the audit worker ever encounters a suggestion with `tokowakaDeployed` but no `edgeDeployed`, it's a suggestion from before the field rename — treat it the same as `edgeDeployed` for preservation purposes.

---

## `edgeOptimizeStatus` Field Lifecycle

This field is set/cleared by the API service, not the audit worker:

| Value | Meaning | Set when |
|-------|---------|----------|
| `'STALE'` | Content changed after deploy | Checked by Tokowaka CDN on subsequent requests |
| `'EXPERIMENT_IN_PROGRESS'` | Geo-experiment running | Deploy called with `Prefer: respond-async` |
| cleared | Normal deployed state | After re-deploy (removes STALE) |

The audit worker should **not write** `edgeOptimizeStatus`. It reads it for the UI (fixed tab "Content Changed" indicator comes from this field).
