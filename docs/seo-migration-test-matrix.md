# SEO Provider Migration — Test Matrix

**Purpose**: Validate that data from the new SEO provider (via `mysticat-shared-seo-client`) matches
or is reasonably equivalent to the previous Ahrefs data for production sites.

**Workflow**:
1. Fetch current data from SpaceCat API (Ahrefs-sourced baseline)
2. Trigger new import via import-worker (SEO provider)
3. Fetch updated data from SpaceCat API
4. Compare results

**Environment Variables**: Ensure SpaceCat API keys and SEO client credentials are configured per the deployment runbook.

---

## Test Sites

| # | Site | Base URL | Site ID | Notes |
|---|------|----------|---------|-------|
| 1 | TBD  | TBD      | TBD     | User will specify |
| 2 | TBD  | TBD      | TBD     | User will specify |
| 3 | TBD  | TBD      | TBD     | User will specify |

---

## API Endpoints to Validate

### 1. Top Pages (SEO)

| Item | Details |
|------|---------|
| **What changed** | SiteTopPage source: `'ahrefs'` → `'seo'` |
| **SpaceCat endpoint** | `GET /sites/{siteId}/top-pages` |
| **Baseline call** | `curl -H "x-api-key: $SPACECAT_PROD_API_KEY" "$SPACECAT_PROD_API/sites/{siteId}/top-pages"` |
| **Key fields to compare** | URL list, traffic values, source field |
| **Expected differences** | Source changes from `ahrefs` to `seo`; traffic values may differ slightly between providers |
| **Pass criteria** | >80% URL overlap; traffic values within same order of magnitude |

### 2. Broken Backlinks

| Item | Details |
|------|---------|
| **What changed** | `traffic_domain` → `traffic_domain` (0–100); source `'ahrefs'` → `'seo'` |
| **SpaceCat endpoint** | `GET /sites/{siteId}/audits/broken-backlinks` (latest audit result) |
| **Baseline call** | `curl -H "x-api-key: $SPACECAT_PROD_API_KEY" "$SPACECAT_PROD_API/sites/{siteId}/audits/broken-backlinks"` |
| **Key fields to compare** | `url_from`, `url_to`, `title`, `traffic_domain` (was `traffic_domain`) |
| **Expected differences** | Field rename; traffic_domain is 0–100 (was traffic volume in thousands); different broken link detection |
| **Pass criteria** | Backlinks returned with valid traffic_domain (0–100); reasonable overlap in detected broken links |

### 3. Broken Backlinks Opportunities & Suggestions

| Item | Details |
|------|---------|
| **What changed** | Suggestion rank uses `traffic_domain`; KPI bands recalibrated for 0–100 |
| **SpaceCat endpoint** | `GET /sites/{siteId}/opportunities` (filter type=broken-backlinks) |
| **Suggestions endpoint** | `GET /opportunities/{opportunityId}/suggestions` |
| **Key fields to compare** | `rank`, `data.traffic_domain`, opportunity guidance (projectedTrafficLost, projectedTrafficValue) |
| **Expected differences** | Rank values 0–100 (was 10K–25M); KPI projections will differ due to band recalibration |
| **Pass criteria** | Suggestions have traffic_domain in data; KPI values are non-zero and reasonable |

### 4. Organic Traffic (S3 metrics)

| Item | Details |
|------|---------|
| **What changed** | S3 path: `metrics/{siteId}/ahrefs/organic-traffic.json` → `metrics/{siteId}/seo/organic-traffic.json` |
| **SpaceCat endpoint** | `GET /sites/{siteId}/metrics-by-source` |
| **Key fields to compare** | Organic traffic values, date range |
| **Expected differences** | Values may differ between providers; structure should be identical |
| **Pass criteria** | Data present at new S3 path; values within same order of magnitude |

### 5. Aggregate Metrics / CPC

| Item | Details |
|------|---------|
| **What changed** | S3 path: `metrics/{siteId}/ahrefs/agg-metrics.json` → `metrics/{siteId}/seo/agg-metrics.json`; field names `ahrefsOrganicCPC` → `seoOrganicCPC` |
| **How to validate** | Check S3 directly or trigger paid-cookie-consent audit |
| **Key fields to compare** | `organicCost`, `organicTraffic`, `paidCost`, `paidTraffic`, computed CPC |
| **Expected differences** | Values may differ; CPC formula unchanged (cost/traffic) |
| **Pass criteria** | CPC values are non-zero and reasonable; source field is `'seo'` |

### 6. Paid Pages

| Item | Details |
|------|---------|
| **What changed** | S3 path: `metrics/{siteId}/ahrefs/paid-pages.json` → `metrics/{siteId}/seo/paid-pages.json` |
| **How to validate** | Trigger paid-keyword-optimizer audit or check S3 |
| **Key fields to compare** | Page URLs, keyword data, positions |
| **Expected differences** | Different page/keyword coverage between providers |
| **Pass criteria** | Data present at new path; reasonable page/keyword count |

### 7. Health Check (SEO Top Pages Freshness)

| Item | Details |
|------|---------|
| **What changed** | Function renamed; checks source `'seo'` instead of `'ahrefs'` |
| **SpaceCat endpoint** | `GET /sites/{siteId}/audits/lhs-mobile` or health-check audit |
| **Key fields to compare** | `seoTopPagesImport` status and freshness |
| **Pass criteria** | Health check passes with `'seo'` source data |

---

## Validation Checklist (per site)

| # | Check | Baseline Saved | Post-Migration Saved | Compared | Status |
|---|-------|:-:|:-:|:-:|--------|
| 1 | Top pages data fetched | [ ] | [ ] | [ ] | |
| 2 | Broken backlinks audit result | [ ] | [ ] | [ ] | |
| 3 | Broken backlinks opportunities | [ ] | [ ] | [ ] | |
| 4 | Broken backlinks suggestions (rank, traffic_domain) | [ ] | [ ] | [ ] | |
| 5 | Organic traffic metrics | [ ] | [ ] | [ ] | |
| 6 | Aggregate metrics / CPC | [ ] | [ ] | [ ] | |
| 7 | Paid pages data | [ ] | [ ] | [ ] | |
| 8 | Health check passes | [ ] | [ ] | [ ] | |

---

## Data Storage

Baseline and post-migration responses will be saved to:

```
docs/migration-validation/
  {siteId}/
    baseline/
      top-pages.json
      broken-backlinks.json
      opportunities.json
      suggestions.json
      organic-traffic.json
      agg-metrics.json
      paid-pages.json
    post-migration/
      top-pages.json
      broken-backlinks.json
      opportunities.json
      suggestions.json
      organic-traffic.json
      agg-metrics.json
      paid-pages.json
    comparison-summary.md
```

---

## Comparison Script

Once we have both datasets, comparison will check:
- **URL overlap**: % of URLs present in both baseline and post-migration
- **Field presence**: All expected fields exist (especially `traffic_domain` replacing `traffic_domain`)
- **Value reasonableness**: Numeric values are non-zero, within expected ranges
- **Source field**: Changed from `'ahrefs'` to `'seo'` where applicable
- **Structure**: JSON shape matches expected schema
