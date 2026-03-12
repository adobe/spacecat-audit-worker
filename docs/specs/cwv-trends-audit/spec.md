# CWV Trends Audit — Specification

## Overview

A weekly audit (`cwv-trends-audit`) that reads pre-imported CWV and engagement data from S3, classifies URLs as Good / Needs Improvement / Poor over a 28-day rolling window, and creates device-specific **Web Performance Trends Report** opportunities in SpaceCat.

The audit runs once per site. The device type (mobile or desktop) is determined from the site's handler configuration, defaulting to `mobile`.

### Acceptance Criteria

- [ ] Scheduled as `every-sunday`
- [ ] Reads 28 days of pre-imported CWV data from S3
- [ ] CWV metrics categorized using standard thresholds (LCP ≤ 2500/4000, CLS ≤ 0.1/0.25, INP ≤ 200/500)
- [ ] Device type read from `site.getConfig().getHandlers()['cwv-trends-audit'].deviceType`
- [ ] Creates/updates "Mobile Web Performance Trends Report" or "Desktop Web Performance Trends Report" opportunity by title match
- [ ] Audit result payload matches schema: `metadata`, `trendData`, `summary`, `urlDetails`
- [ ] URLs filtered by minimum 1000 pageviews, sorted descending
- [ ] 100% unit test coverage

---

## Architecture

### Impacted Repositories

| Repository | Changes |
|---|---|
| `spacecat-shared` | Add `CWV_TRENDS_AUDIT` to `Audit.AUDIT_TYPES` |
| `spacecat-audit-worker` | New `src/cwv-trends-audit/` module with runner, opportunity handler, tests |
| `spacecat-api-service` | Register audit type (dependency bump) |

### Data Flow

```
S3 Bucket (pre-imported by cwv-trends-daily import)
  │
  ▼
cwv-trends-audit runner
  ├─ Read 28 days from: metrics/cwv-trends/cwv-trends-daily-{date}.json
  ├─ Filter URLs by device type + MIN_PAGEVIEWS (1000)
  ├─ Categorize URLs (Good/NI/Poor) per day → trendData
  ├─ Build summary (current week avg vs previous week avg)
  ├─ Build urlDetails (sorted by pageviews, sequential id, change values)
  │
  └─ Post-processor: opportunityHandler
     ├─ Find existing opportunity by title (comparisonFn)
     ├─ Create opportunity if not found, update if found
     └─ syncSuggestions (one per URL, keyed by url)
```

---

## S3 Data Source

- **Bucket:** `S3_IMPORTER_BUCKET_NAME` (from environment)
- **Key pattern:** `metrics/cwv-trends/cwv-trends-daily-{YYYY-MM-DD}.json`
- **Content:** JSON array of URL entries, each with a `metrics` array containing device-specific CWV data
- The audit reads from S3 only — no direct RUM API calls

### S3 Payload Structure (per date file)

```json
[
  {
    "url": "https://www.example.com/page",
    "metrics": [
      {
        "deviceType": "mobile",
        "pageviews": 5000,
        "lcp": 2000,
        "cls": 0.08,
        "inp": 180,
        "bounceRate": 0.25,
        "engagement": 0.75,
        "clickRate": 0.60
      }
    ]
  }
]
```

---

## Data Processing

### URL Filtering

- Filter by configured device type (match `metrics[].deviceType`)
- Minimum `MIN_PAGEVIEWS = 1000` pageviews
- Skip URLs with `deviceType === 'undefined'` (log warning)
- Sort by pageviews descending

### CWV Categorization Thresholds

| Metric | Good | Poor |
|--------|------|------|
| LCP | ≤ 2500ms | > 4000ms |
| CLS | ≤ 0.1 | > 0.25 |
| INP | ≤ 200ms | > 500ms |

- **Good:** All available metrics within good thresholds
- **Poor:** Any metric exceeds poor threshold (OR logic)
- **Needs Improvement:** Everything else
- **Null metrics:** Skip in categorization (use available metrics only)

### Summary Calculation

- **Current week:** Last 7 days of the 28-day window
- **Previous week:** Days 15–21 of the 28-day window
- Each stat: `{ current, previous, change, percentageChange, status }`
- Change = current - previous
- Percentage change = ((current - previous) / previous) × 100

### URL Details

- Sequential `id` (string "1", "2", ...) sorted by pageviews descending
- Percentage fields (`bounceRate`, `engagement`, `clickRate`) multiplied by 100
- Raw fields (`pageviews`, `lcp`, `cls`, `inp`) kept as-is
- Change values: current week average - previous week average

---

## Site Configuration

```json
{
  "handlers": {
    "cwv-trends-audit": {
      "deviceType": "mobile"
    }
  }
}
```

- Device type read from: `site.getConfig().getHandlers()['cwv-trends-audit'].deviceType`
- Defaults to `'mobile'` if not configured or if config is absent

---

## Opportunities & Suggestions

### Opportunity Matching

The opportunity handler uses `convertToOpportunity` with a `comparisonFn` that matches by **title**:

- If an existing opportunity with the matching title is found (status `NEW`), it is updated
- If no match, a new opportunity is created
- Titles: "Mobile Web Performance Trends Report" / "Desktop Web Performance Trends Report"

### Opportunity Data

```javascript
{
  runbook: '',
  origin: 'AUTOMATION',
  title: OPPORTUNITY_TITLES[deviceType],
  description: 'Web Performance Trends Report tracking CWV metrics over time.',
  guidance: { steps: [...] },
  tags: ['Web Performance', 'CWV'],
  data: { deviceType, dataSources: ['rum', 'site'] }
}
```

### Suggestions

One suggestion per URL in `urlDetails`, synced via `syncSuggestions`:

```javascript
{
  opportunityId: opportunity.getId(),
  type: 'CONTENT_UPDATE',
  rank: entry.pageviews,
  data: { ...entry }
}
```

> **Note:** Suggestion type `CONTENT_UPDATE` matches the ESO API pattern in `experience-system-outages/src/services/spaceCatForwarder.cjs`. ESO doesn't set tags; we add `['Web Performance', 'CWV']` for UI filtering.

---

## Audit Result Schema

```json
{
  "auditResult": {
    "metadata": {
      "domain": "www.example.com",
      "deviceType": "mobile",
      "startDate": "2025-11-01",
      "endDate": "2025-11-28"
    },
    "trendData": [
      { "date": "2025-11-01", "good": 2, "needsImprovement": 1, "poor": 3 }
    ],
    "summary": {
      "good": { "current": 4, "previous": 2, "change": 2, "percentageChange": 100, "status": "good" },
      "needsImprovement": { "current": 2, "previous": 1, "change": 1, "percentageChange": 100, "status": "needsImprovement" },
      "poor": { "current": 1, "previous": 3, "change": -2, "percentageChange": -66.67, "status": "poor" },
      "totalUrls": 7
    },
    "urlDetails": [
      {
        "id": "1",
        "url": "https://www.example.com/products",
        "status": "needsImprovement",
        "pageviews": 4400,
        "pageviewsChange": 1200,
        "lcp": 2756,
        "lcpChange": 856,
        "cls": 0.011,
        "clsChange": -0.005,
        "inp": 56,
        "inpChange": -24,
        "bounceRate": 45.5,
        "bounceRateChange": -5.2,
        "engagement": 65.3,
        "engagementChange": 8.1,
        "clickRate": 28.7,
        "clickRateChange": 3.4
      }
    ]
  },
  "fullAuditRef": "metrics/cwv-trends/"
}
```

---

## File Structure

```
src/cwv-trends-audit/
├── constants.js              # AUDIT_TYPE, thresholds, titles, config defaults
├── cwv-categorizer.js        # categorizeUrl(lcp, cls, inp) → good|NI|poor|null
├── data-reader.js            # readTrendData(), formatDate(), subtractDays()
├── handler.js                # AuditBuilder entry point (runner + post-processor)
├── opportunity-data-mapper.js # createOpportunityData({ deviceType })
├── opportunity-handler.js    # Post-processor: convertToOpportunity + syncSuggestions
└── utils.js                  # Main runner logic (cwvTrendsRunner)

test/audits/cwv-trends-audit/
├── constants.test.js
├── cwv-categorizer.test.js
├── data-reader.test.js
├── handler.test.js
├── opportunity-data-mapper.test.js
├── opportunity-handler.test.js
└── utils.test.js
```

---

## Deployment Checklist

1. Merge and publish `spacecat-shared` (adds `CWV_TRENDS_AUDIT` type)
2. Bump `@adobe/spacecat-shared-data-access` in `spacecat-audit-worker` and `spacecat-api-service`
3. Register audit: `registerAudit('cwv-trends-audit', false, 'every-sunday', [productCodes])`
4. Enable per-site via configuration
