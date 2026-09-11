# Spec: SEO / GEO / AEO Competitor Gap Analysis

- Status: Proposed
- Date: 2026-09-11
- Author: (Ashutosh Shroti)

## Problem statement

Given a keyword, a target URL to optimize, and a set of domains to exclude, we want to
discover the competitor pages ranking for that keyword, analyze each page for SEO / GEO
(generative-engine) / AEO (answer-engine) signals, and return a structured gap report the
downstream content-optimization service can act on. The analysis must run behind a public
HTTP API with an async (submit → poll) contract, and must work for competitor URLs that are
**not** registered SpaceCat sites (they are discovered at request time).

## Goals

- Keyword → SERP (Bright Data, ~2 pages) → bucket results (target / branded / competitor /
  filtered) excluding the target and `filterDomains`.
- Scrape each competitor page + the target with full JS hydration (up to 45s) and extract a
  normalized SEO/GEO/AEO signal snapshot.
- Diff the target against competitors and return a generic, extensible comparison report.
- No dependency on a registered `site` record.

## Non-goals

- Third-party vs. competitor sub-classification (bucket enum reserves `third-party` for a
  later heuristic; today all non-branded, non-filtered results are `competitor`).
- Rendering / UI. This service produces the data another service consumes.

## Technical design

Three cooperating repos:

1. **spacecat-api-service** — public `POST /seo-gap-analysis` (IMS-authenticated + entitlement)
   creates an `AsyncJob`, emits a `seo-gap-analysis` SQS message, returns `202 { jobId, pollUrl }`.
   `GET /seo-gap-analysis/jobs/{jobId}` returns the `AsyncJob` status/result.
2. **spacecat-audit-worker** — two operational handlers (no AuditBuilder, non-site):
   - `seo-gap-analysis` (phase 1): SERP via `BrightDataClient.googleSearchByQuery` (keyword mode,
     no `site:` scope), `bucketSerpResults`, then `ScrapeClient.createScrapeJob` with
     `processingType: 'seo-comparison'` for `[targetUrl, ...competitors]`. Buckets + scrapeJobId
     recorded on the `AsyncJob` metadata.
   - `seo-comparison` (phase 2): triggered by the content-scraper completion, reads each snapshot
     from S3, separates target from competitors, `computeSeoGap`, writes the report onto the
     `AsyncJob` (COMPLETED).
3. **spacecat-content-scraper** — new `seo-comparison` handler + `seo-comparison.js` extraction
   script (45s hydration, `networkidle2`) capturing meta, canonical/hreflang, OpenGraph/Twitter,
   full heading hierarchy, schema.org JSON-LD + types, content-depth, link/image stats.

The gap engine (`gap.js`) is a **factor registry** — each comparable signal is one `FACTOR`
descriptor, so new SEO/GEO/AEO dimensions are added without touching the diff logic.

## Correlation / open integration point

Phase 2 is keyed on the content-scraper completion `type` (`seo-comparison`). The originating
`AsyncJob` id is echoed via the scrape `metaData` (`seoGapAnalysisJobId`) and resolved with
fallbacks (`auditContext` → `metaData` → per-result `jobMetadata`), plus the scrapeJobId stored
on the AsyncJob metadata as a backstop. **The exact echo path of `metaData` into the completion
message must be validated end-to-end** against the scrape-job-manager / content-scraper
completion behavior, since this handler runs outside the AuditBuilder step framework that
normally wires this automatically.

## Security

Caller-controlled `targetUrl` and SERP-discovered URLs are fetched server-side (SSRF surface).
The public endpoint is IMS + entitlement gated; an allow/deny + private-range guard on scraped
URLs should be added before GA.

## Success criteria

- End-to-end: keyword → report JSON with per-factor target-vs-competitor diffs and a prioritized
  recommendation list.
- 100% unit coverage on the new worker modules (met).
