# CWV Trends Audit

A weekly audit that analyzes Core Web Vitals trends over a 28-day rolling window, producing **Web Performance Trends Report** opportunities for both mobile and desktop.

## What It Does

1. Reads 28 days of pre-imported CWV data from S3 (`metrics/{siteId}/rum/cwv-trends/cwv-trends-daily-{date}.json`)
2. For each device type (mobile, desktop):
   - Filters URLs by minimum 1000 pageviews
   - Categorizes URLs as Good / Needs Improvement / Poor using standard CWV thresholds
   - Builds daily trend data, summary (point-to-point: current day vs 7 days prior), and URL details
3. Creates/updates two `generic-opportunity` records (one per device type) with status `NEW`
4. Syncs one suggestion per opportunity containing the full report as JSON in `suggestionValue`

## Data Flow

```
S3 (cwv-trends-daily import)
  → cwv-trends-audit runner (reads 28 days, processes mobile + desktop)
    → opportunityHandler (creates/updates generic-opportunity per device)
      → syncSuggestions (one suggestion per device, keyed by deviceType-report)
        → UI (WebPerformanceTrendsReportPage parses suggestionValue)
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **`generic-opportunity` type** | UI identifies these reports by title prefix match, not by opportunity type. Using generic-opportunity aligns with the UI's `isWebPerformanceTrendsReport()` detection logic |
| **Status `NEW` on create** | The UI's `useOpportunitiesCollection` hook filters `currentOpportunities` to only include opportunities with status `NEW`. Without this, opportunities wouldn't appear in the header or reports |
| **Suggestion status forced to `NEW`** | Sites with `requiresValidation: true` would otherwise get `PENDING_VALIDATION`, which the UI filters out. Report-style opportunities don't need human validation |
| **Custom `mergeDataFunction`** | The default shallow merge in `syncSuggestions` wouldn't update `suggestionValue` on re-runs since the raw device result doesn't contain that key. The custom function JSON-stringifies the new result into `suggestionValue` |
| **Null values default to `0`** | The UI calls `.toFixed()` on numeric fields without null guards. All numeric fields (`lcp`, `cls`, `inp`, `*Change`, etc.) default to `0`, and status defaults to `good` when no CWV metrics are available |
| **No Google Search Console check** | Data source is RUM only. The handler bypasses `convertToOpportunity` (which includes `checkGoogleConnection`) and directly manages opportunity lifecycle via a custom `findOrCreateOpportunity` function. The shared `convertToOpportunity` utility bundles Google connection checks and uses a single opportunity per audit type, whereas this audit needs per-device-type opportunities matched by title |
| **`siteEnrollment` check in `audit-utils.js`** | The `checkProductCodeEntitlements` function uses `tierResult.siteEnrollment` (site-level enrollment) rather than `tierResult.entitlement` (org-level). This only affects audits with `productCodes` configured — audits without product codes are unaffected. The default fallback behavior (deny when no enrollment) matches the previous behavior |
| **28-day minimum required** | Audit throws an error if fewer than 28 days of S3 data exist (including zero days), ensuring trend calculations have sufficient data |

## CWV Thresholds

| Metric | Good | Poor |
|--------|------|------|
| LCP | ≤ 2500ms | > 4000ms |
| CLS | ≤ 0.1 | > 0.25 |
| INP | ≤ 200ms | > 500ms |

## Running the Audit

**Scheduled:** Runs `every-sunday` via Jobs Dispatcher.

**Manual (bot command):**
```
@spacecat run audit www.example.com cwv-trends-audit
@spacecat run audit www.example.com cwv-trends-audit 2026-03-23
```

The optional date parameter sets the end date of the 28-day window (format: `YYYY-MM-DD`, defaults to today).

## File Structure

```
src/cwv-trends-audit/
├── constants.js              # AUDIT_TYPE, thresholds, titles, device types
├── cwv-categorizer.js        # categorizeUrl(lcp, cls, inp) → good|NI|poor
├── data-reader.js            # readTrendData() — S3 data fetching
├── handler.js                # AuditBuilder entry point
├── opportunity-data-mapper.js# createOpportunityData({ deviceType })
├── opportunity-handler.js    # Post-processor: opportunity + suggestion management
└── utils.js                  # Main runner logic (cwvTrendsRunner)
```

## Related

- [Full Specification](spec.md)
- UI component: `experience-success-studio-ui/.../WebPerformanceTrendsReportPage`
- Data source: `spacecat-import-worker` (`cwv-trends-daily` / `cwv-trends-onboard` handlers)
