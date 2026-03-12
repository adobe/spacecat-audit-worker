# Ad Intent Mismatch — Enhanced Prefiltering Plan (v2 — post-review)

## Relationship to the Mystique Ad Intent Gap Plan

This plan is a **companion document** to the main Ad Intent Gap Crew plan (the "Mystique plan"), which covers LLM analysis quality, scraping validation, screenshot generation, and eviction-based opportunity capping. The Mystique plan's Phase 4 addresses two audit-worker changes: raising the bounce rate threshold (4A) and eviction-based capping in the guidance handler (4B).

This plan extends Phase 4 with additional **prefiltering logic** — deciding which pages should be sent to Mystique at all, before the expensive LLM call happens.

### Separation of Concerns

| Responsibility | Where | Why |
|----------------|-------|-----|
| **Whether to send a page** for analysis | Audit-worker (this plan) | Cheap heuristics using RUM + CWV + Ahrefs data to avoid wasting $0.05-0.15 per page on pages where bounce rate has a non-alignment explanation |
| **What the issue is** on a page | Mystique (main plan) | Semantic LLM analysis: gap classification, severity scoring, H1 recommendations, screenshot generation |
| **How many opportunities to keep** per site | Audit-worker guidance handler (Mystique plan Phase 4B) | Eviction-based capping on the response side |

### Data Flow — Ahrefs Data

Ahrefs paid-pages data (CPC, sumTraffic, topKeyword, serpTitle) exists in two places:

1. **S3**: `metrics/{siteId}/ahrefs/paid-pages.json` — written by the import worker in Step 1 of this audit
2. **SpaceCat API**: Returns the same S3 data via a cached endpoint

Mystique's `_get_paid_pages_data()` already fetches this data from the SpaceCat API (via `PaidPagesTool`) for use as **LLM analysis context** — it feeds into the CrewAI gap analysis prompt alongside scraped content and visual headlines. The crew uses topKeyword, serpTitle, sumTraffic, and CPC to assess keyword-to-page alignment and estimate business impact.

This plan proposes that the audit-worker **also** reads the same data from S3, for a different purpose: **CPC-based priority scoring (WSIS)**, which estimates wasted ad spend to rank pages before the LLM call. This is NOT a duplication of Mystique's work — the audit-worker uses CPC/traffic for cost-based triage, while Mystique uses it for semantic analysis context. Both reads are necessary because they serve different stages of the pipeline.

**Ahrefs data is mandatory for this audit.** If Ahrefs data is unavailable, the audit terminates with an error (see Section 4).

---

## Context

The `paid-keyword-optimizer` audit (type: `ad-intent-mismatch`) sends pages to Mystique for LLM-based gap analysis at ~$0.05-0.15/page, 30-60s each. The current prefiltering uses a single signal — bounce rate >= 30% — which produces a high false-positive rate (~40-60% of pages analyzed return "low"/"none" severity). This plan proposes multi-signal prefiltering to reduce wasted LLM spend and improve signal-to-noise.

**Scope:** Audit-worker changes only. Cross-plan integration points with Mystique are noted at the end.

---

## Current Filter Pipeline

```
1. Athena: trf_channel = 'search'            -> Only search traffic
2. Athena: HAVING SUM(pageviews) >= 1000      -> Minimum traffic volume
3. Post-query: paid/total >= 80%              -> Predominantly paid pages
4. Post-query: bounceRate >= 0.3              -> High bounce rate (30%)
5. Response-side: severity != low/none         -> Skip non-actionable guidance
```

### Available but Unused Data

The Athena query already computes these fields but `transformResultItem()` in `handler.js` **drops them**:

| Field | In Athena results | Extracted | Used | Signal value |
|-------|-------------------|-----------|------|-------------|
| `engagedScrollRate` | Yes | Yes (extracted) | No | **High** — distinguishes alignment vs CTA problems |
| `clickRate` | Yes | Yes (extracted) | No | Medium — engagement signal |
| `p70_lcp` | Yes | No | No | **High** — explains performance-caused bounces |
| `p70_cls` | Yes | No | No | **High** — explains frustration-caused bounces |
| `p70_inp` | Yes | No | No | Medium — interactivity signal |
| `p70_scroll` | Yes | No | No | Medium — content consumption depth |

Additionally, **Ahrefs paid pages data** (CPC, sumTraffic, topKeyword) is imported in Step 1 and stored in S3 at `metrics/{siteId}/ahrefs/paid-pages.json` — but the analysis step (Step 7) never reads it. The `paid-cookie-consent` audit already has a pattern for reading Ahrefs data from S3 (`ahrefs-cpc.js`).

---

## Problem: Bounce Rate Is a Mediocre Signal

High bounce rate conflates multiple unrelated causes:

| Cause | Related to alignment? | Better fix |
|-------|-----------------------|-----------|
| Slow page (LCP > 4s) | No — users leave before content loads | Performance optimization |
| Layout shift (CLS > 0.25) | No — accidental navigation | UX/CSS fix |
| Poor interactivity (INP > 500ms) | No — buttons feel broken | JS performance |
| Single-answer informational page | No — user got their answer | None (working as intended) |
| Mobile UX issues | No — rendering problem | Responsive design |
| Content engagement without CTA | No — users read but don't click | CTA placement |
| **Keyword-to-page misalignment** | **Yes** — content doesn't match intent | **LLM analysis** |

Only the last row benefits from LLM gap analysis. The rest waste ~$0.10 per page.

---

## Proposed Enhancements

### 1. Extract CWV + Engagement Fields

**Change:** Modify `transformResultItem()` to extract fields already returned by Athena.

```javascript
// ADD to transformResultItem (handler.js)
p70Lcp: parseFloat(item.p70_lcp || 0),
p70Cls: parseFloat(item.p70_cls || 0),
p70Inp: parseFloat(item.p70_inp || 0),
p70Scroll: parseFloat(item.p70_scroll || 0),
// engagedScrollRate and clickRate are already extracted but unused
```

**Cost:** Zero. Data is already returned by the SQL query.

### 2. CWV Hard Exclusion

**Change:** Filter out pages where poor Core Web Vitals explain the bounce rate.

```javascript
// ADD filter in runPaidKeywordAnalysisStep (handler.js)
const cwvQualifyingPages = qualifyingPages.filter(page => {
  if (page.p70Lcp > 4000) {
    log.debug(`Excluding ${page.url}: LCP ${page.p70Lcp}ms > 4000ms (performance issue, not alignment)`);
    return false;
  }
  if (page.p70Cls > 0.25) {
    log.debug(`Excluding ${page.url}: CLS ${page.p70Cls} > 0.25 (layout shift issue, not alignment)`);
    return false;
  }
  return true;
});
```

**Rationale:**
- LCP > 4000ms = "Poor" by Google standards. Users abandon before content renders. LLM analysis wasted.
- CLS > 0.25 = "Poor" CLS. Bounces from frustration, not misalignment.
- **Not routing to separate opportunity** — CWV issues are handled by the existing `guidance:cwv` audit.

**Known limitation:** Pages with co-existing CWV and alignment issues will not receive alignment analysis until their CWV metrics improve below the threshold. Once the CWV issue is resolved (e.g., by the `guidance:cwv` audit), the page will naturally re-enter the alignment pipeline in the next audit run.

**Estimated pages excluded:** ~10-15% of predominantly-paid pages.

### 3. URL Pattern Exclusion

**Change:** Skip page types where high bounce rate is expected and NOT an alignment issue.

```javascript
// Patterns match path SEGMENTS (bounded by /), not substrings.
// e.g., /account/ is excluded but /account-management-software/ is NOT.
const EXCLUDE_URL_PATTERNS = [
  /\/(help|support|faq|docs|documentation)\//i,               // Support — users get answer and leave
  /\/(cart|checkout|order|payment)\//i,                        // Checkout — wrong funnel stage
  /\/(legal|privacy|terms|cookie-policy)\//i,                  // Legal — not a landing page
  /\/(login|signin|register|signup|account)\//i,               // Auth — bounce is expected
  /\/(search|search-results|results)\//i,                      // Internal search — wrong page type
  /\/(download|thank-you|confirmation)\//i,                    // Post-conversion — user completed action
  /\/(404|error|not-found)\//i,                                // Error pages
  /\/(unsubscribe|preferences|manage-subscription)\//i,        // Email preference pages
];

function isExcludedPageType(url) {
  return EXCLUDE_URL_PATTERNS.some(pattern => pattern.test(url));
}
```

**Note:** Blog/articles/news pages are intentionally NOT excluded. Some companies run paid traffic to content pages as a top-of-funnel strategy. The WSIS scoring (Section 5) naturally deprioritizes low-CPC blog pages while retaining high-CPC ones.

**Estimated pages excluded:** ~10-20% of qualifying pages.

### 4. Ahrefs Data Enrichment (Mandatory)

**Change:** Read Ahrefs paid-pages data from S3 (already imported in Step 1) to get CPC/keyword per page.

**Ahrefs data is required for this audit.** Without CPC data, the audit-worker cannot compute the WSIS priority score and cannot distinguish between a page wasting $500/month in ad spend (high priority) and one wasting $5/month (low priority). If Ahrefs data is unavailable, the audit terminates.

```javascript
// NEW function following ahrefs-cpc.js pattern from paid-cookie-consent
async function fetchPaidPagesFromS3(context, siteId) {
  const { s3Client, env, log } = context;
  const bucketName = env.S3_IMPORTER_BUCKET_NAME;
  const key = `metrics/${siteId}/ahrefs/paid-pages.json`;

  const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
  const response = await s3Client.send(command);
  const bodyString = await response.Body.transformToString();
  const pages = JSON.parse(bodyString);

  // Build URL -> Ahrefs data map for O(1) lookups
  const map = new Map();
  for (const page of pages) {
    map.set(page.url, {
      topKeyword: page.topKeyword,
      cpc: page.cpc || 0,
      sumTraffic: page.sum_traffic || 0,
      serpTitle: page.topKeywordBestPositionTitle,
    });
  }

  if (map.size === 0) {
    throw new Error(`Ahrefs paid-pages data is empty for site ${siteId} (key: ${key})`);
  }

  return map;
}
```

**Error handling:** If `fetchPaidPagesFromS3` throws (S3 error, parse error, empty data), the audit logs an error and terminates — no pages are sent to Mystique.

```javascript
let ahrefsMap;
try {
  ahrefsMap = await fetchPaidPagesFromS3(context, siteId);
} catch (error) {
  log.error(`Ad-intent-mismatch audit terminated: Ahrefs data unavailable for site ${siteId}. Reason: ${error.message}`);
  return; // Terminate audit — no Mystique execution
}
```

Similarly, if Athena returns empty or invalid traffic-analysis data, the audit terminates with an error log.

**Cost:** One S3 GET per audit run (not per page). Negligible.

### 5. Composite Priority Score (WSIS)

**Change:** Replace binary pass/fail with a **Wasted Spend Impact Score**.

```javascript
function computePriorityScore(page, ahrefsData) {
  const cpc = ahrefsData?.cpc || 0;

  // Business impact: estimated monthly wasted spend ($)
  const wastedSpend = cpc * page.pageViews * page.bounceRate;

  // Alignment signal: low scroll engagement = likely alignment issue
  // High scroll + high bounce = CTA problem, not alignment — deprioritize
  const alignmentSignal = 1 - (page.engagedScrollRate || 0);

  // CWV penalty: reduce priority if borderline CWV contributes to bounces
  let cwvAdjustment = 1.0;
  if (page.p70Lcp > 4000) cwvAdjustment *= 0.5;
  else if (page.p70Lcp > 2500) cwvAdjustment *= 0.75;
  if (page.p70Cls > 0.25) cwvAdjustment *= 0.7;
  if (page.p70Inp > 500) cwvAdjustment *= 0.8;

  return (wastedSpend / 1000) * alignmentSignal * cwvAdjustment;
}
```

**Interpretation:**
- A page with CPC=$2, 5000 PVs, 50% bounce, 10% scroll engagement, good CWV:
  `(2*5000*0.5/1000) * 0.9 * 1.0 = 5.0 * 0.9 = 4.50`
- Same page but 70% scroll engagement:
  `5.0 * 0.3 * 1.0 = 1.50` (much lower — alignment is less likely, user reads but doesn't convert)
- Same page but CPC=$0.10:
  `(0.1*5000*0.5/1000) * 0.9 * 1.0 = 0.25 * 0.9 = 0.225` (low business impact)

**Note on formula design:** `bounceRate` drives the dollar estimate (wastedSpend) while `engagedScrollRate` drives the alignment probability. These are independent signals — bounceRate measures overall disengagement, while engagedScrollRate specifically measures whether users scrolled deep into the page (≥10,000px). High bounce + low scroll = likely alignment issue. High bounce + high scroll = CTA/conversion problem.

**Post-deployment:** Log WSIS scores alongside LLM severity outcomes to validate correlation. The formula may be recalibrated based on data. The `/1000` divisor is normalization — only relative ordering matters, not absolute score values.

### 6. Page Cap

**Change:** Send only top N pages by priority score, configurable via env var.

```javascript
const MAX_PAGES_PER_AUDIT = parseInt(env.AD_INTENT_MAX_PAGES || '10', 10);

const rankedPages = enrichedPages
  .map(page => ({ ...page, priorityScore: computePriorityScore(page, ahrefsMap.get(page.url)) }))
  .filter(page => page.priorityScore > 0.01)
  .sort((a, b) => b.priorityScore - a.priorityScore)
  .slice(0, MAX_PAGES_PER_AUDIT);
```

`AD_INTENT_MAX_PAGES` is the only configurable value (default 10). Set to 0 for unlimited (not recommended).

### 7. Pipeline Summary Log

**Change:** Add an info-level summary log per audit run showing the funnel at each filter stage.

```javascript
log.info(`Ad-intent-mismatch filter pipeline for site ${siteId}: `
  + `${searchPages} search pages → ${paidPages} paid-dominant → ${cwvPages} CWV-pass `
  + `→ ${urlPages} URL-pass → ${bouncePages} bounce-pass → ${rankedPages.length} after scoring+cap`);
```

Additionally, debug-level logs at each filter stage show which specific pages were excluded and why (already shown in Sections 2 and 3 code examples).

### 8. Enriched SQS Message

**Change:** Include additional data fields in the SQS message to Mystique.

```json
{
  "type": "guidance:paid-ad-intent-gap",
  "data": {
    "bounceRate": 0.45,
    "pageViews": 3200,
    "trafficLoss": 1440,
    "priorityScore": 2.34,
    "cpc": 1.85,
    "sumTraffic": 2800,
    "topKeyword": "cloud storage pricing",
    "serpTitle": "Compare Cloud Storage Plans",
    "p70Lcp": 2100,
    "p70Cls": 0.08,
    "p70Inp": 150,
    "engagedScrollRate": 0.22,
    "paidTrafficPct": 92
  }
}
```

**Backward compatibility:** Mystique's Pydantic models use `extra='ignore'` (Pydantic v2 default, verified). Unknown fields are silently dropped. Mystique will be updated (coordinated change) to integrate these fields into `AdIntentGapRequestMessageData` and `AdIntentGapOpportunityData` so they are available for analysis context.

The `priorityScore` field is included for downstream consumers (e.g., the backoffice UI could display estimated wasted spend impact).

---

## Proposed Filter Pipeline (Complete)

```
1. Athena: trf_channel = 'search'                                 (unchanged)
2. Athena: HAVING SUM(pageviews) >= 1000                           (unchanged)
3. Post-query: paid/total >= 80%                                   (unchanged)
4. Ahrefs enrichment: fetch CPC/keyword from S3 (mandatory)       (NEW — audit terminates on failure)
5. CWV hard exclusion: LCP > 4000ms OR CLS > 0.25                 (NEW)
6. URL pattern exclusion: support, checkout, legal, auth,          (NEW)
   search, post-conversion, error, email-prefs
7. bounceRate >= 0.50                                              (CHANGED from 0.30)
8. Priority score + cap: compute WSIS, send top N                  (NEW)
9. Pipeline summary log                                            (NEW)
10. Response-side: severity != low/none                            (unchanged)
```

---

## Expected Impact

| Metric | Current | Proposed | Change |
|--------|---------|----------|--------|
| Pages sent to Mystique per audit | 30-60 | 10-20 | -50-67% |
| LLM cost per audit | $1.50-9.00 | $0.50-3.00 | -60% |
| False positive rate (LLM returns low/none) | ~40-60% | ~15-25% (est.) | Significant reduction |
| Signal-to-noise in opportunities | Low | High | Higher business impact per opp |

---

## Implementation Approach

All changes ship as a single implementation — no feature flags, no phased rollout. The only configurable value is `AD_INTENT_MAX_PAGES` (env var, default 10).

1. Modify `transformResultItem()` to extract CWV fields
2. Add `fetchPaidPagesFromS3()` (mandatory — follows `ahrefs-cpc.js` pattern)
3. Add CWV hard exclusion filter
4. Add URL pattern exclusion filter
5. Change `CUT_OFF_BOUNCE_RATE` to 0.5
6. Add `computePriorityScore()` function
7. Add page cap with `AD_INTENT_MAX_PAGES` env var
8. Add pipeline summary log
9. Enrich `buildMystiqueMessage()` with all available data
10. Write tests (100% coverage required)

---

## Cross-Plan Integration Points

The following items affect the Mystique plan and should be considered when implementing its phases. They are documented here for traceability but owned by the Mystique plan.

### 1. Priority Score in Opportunity Metadata

The `priorityScore` (WSIS) sent in the SQS message could be:
- Stored in the opportunity's `data` field by the guidance handler
- Displayed in the backoffice UI as "Estimated Wasted Spend Impact"
- Used by Mystique for severity calibration (a page with high WSIS and medium alignment gap might warrant higher severity than one with low WSIS)

### 2. CWV Data for Content Validation Context

The CWV fields (`p70Lcp`, `p70Cls`) in the SQS message could give Mystique additional context for content validation (Phase 2 of the Mystique plan). A page with borderline LCP (2500-4000ms) that also triggers bot-protection detection might indicate a slow-loading legitimate page rather than an actual CAPTCHA wall.

### 3. Bounce Rate Threshold Coordination

Both plans change `CUT_OFF_BOUNCE_RATE` from 0.3 to 0.5. The Mystique plan's Phase 4A specifies this same change. These are the same change in the same file — implementation should happen once, not twice.

---

## Critical Files

| File | Changes |
|------|---------|
| `src/paid-keyword-optimizer/handler.js` | `transformResultItem` (extract CWV), `CUT_OFF_BOUNCE_RATE = 0.5`, new filters (CWV, URL pattern), new `fetchPaidPagesFromS3()`, new `computePriorityScore()`, pipeline summary log, enriched `buildMystiqueMessage`, page cap |
| `src/paid-keyword-optimizer/queries.js` | No changes needed (CWV fields already returned by Athena query) |
| `src/paid-keyword-optimizer/guidance-handler.js` | Eviction-based capping (from Mystique plan Phase 4B) |
| `src/paid-cookie-consent/ahrefs-cpc.js` | Reference pattern for S3 data fetching (read-only) |

## Verification

- **Package manager:** npm (Node 24 per `.nvmrc`)
- **Test command:** `npm test` (c8 + mocha)
- **Lint command:** `npm run lint`
- **Coverage thresholds:** 100% lines, branches, statements
- **Pre-commit hooks:** yes (husky — runs lint)
- **Test cases for new/changed branches:**
  - `transformResultItem` extracts p70_lcp, p70_cls, p70_inp, p70_scroll
  - CWV exclusion: LCP 3999 passes, LCP 4001 excluded; CLS 0.24 passes, CLS 0.26 excluded
  - URL pattern exclusion: `/support/article-1` excluded, `/products/widget` passes
  - URL pattern exclusion: case-insensitive (`/Support/Article-1` also excluded)
  - URL pattern exclusion: path segment matching — `/account/settings` excluded, `/account-management-software/` NOT excluded
  - URL pattern exclusion: all groups tested (auth, search, post-conversion, error, email-prefs, support, checkout, legal)
  - `fetchPaidPagesFromS3` returns Map when S3 file exists with valid data
  - `fetchPaidPagesFromS3` throws when S3 file missing → audit terminates with error log
  - `fetchPaidPagesFromS3` throws when JSON parse fails → audit terminates with error log
  - `fetchPaidPagesFromS3` throws when data is empty → audit terminates with error log
  - Empty Athena traffic data → audit terminates with error log
  - `computePriorityScore` with good CWV, poor CWV, zero CPC, high/low engagement
  - `computePriorityScore` alignment signal uses `(1 - engagedScrollRate)`, NOT `bounceRate * (1 - engagedScrollRate)`
  - Page cap: AD_INTENT_MAX_PAGES=5 with 10 qualifying pages → only 5 sent
  - Page cap: AD_INTENT_MAX_PAGES=0 (unlimited) → all qualifying pages sent
  - Priority sorting: highest WSIS sent first
  - `buildMystiqueMessage` includes enriched fields (cpc, sumTraffic, topKeyword, serpTitle, CWV, engagedScrollRate, priorityScore)
  - Bounce rate threshold: 0.49 filtered, 0.50 passes, 0.51 passes
  - Pipeline summary log emitted with correct counts at each stage
  - Full pipeline integration: pages pass through Ahrefs fetch → CWV → URL pattern → bounce rate → scoring → cap in correct order
