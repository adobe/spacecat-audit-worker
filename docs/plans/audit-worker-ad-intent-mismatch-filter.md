# Ad Intent Mismatch — Enhanced Prefiltering Analysis

## Context

The `paid-keyword-optimizer` audit (type: `ad-intent-mismatch`) sends pages to Mystique for LLM-based gap analysis at ~$0.05-0.15/page, 30-60s each. The current prefiltering uses a single signal — bounce rate ≥ 30% — which produces a high false-positive rate (~40-60% of pages analyzed return "low"/"none" severity). This analysis proposes multi-signal prefiltering to reduce wasted LLM spend and improve signal-to-noise.

**Scope:** Audit-worker changes only (with optional Mystique optimization).

---

## Current Filter Pipeline

```
1. Athena: trf_channel = 'search'            → Only search traffic
2. Athena: HAVING SUM(pageviews) >= 1000      → Minimum traffic volume
3. Post-query: paid/total >= 80%              → Predominantly paid pages
4. Post-query: bounceRate >= 0.3              → High bounce rate (30%)
5. Response-side: severity != low/none         → Skip non-actionable guidance
```

### Available but Unused Data

The Athena query already computes these fields but `transformResultItem()` in `handler.js` **drops them**:

| Field | In Athena results | Extracted | Used | Signal value |
|-------|-------------------|-----------|------|-------------|
| `engagedScrollRate` | Yes | No | No | **High** — distinguishes alignment vs CTA problems |
| `clickRate` | Yes | No | No | Medium — engagement signal |
| `p70_lcp` | Yes | No | No | **High** — explains performance-caused bounces |
| `p70_cls` | Yes | No | No | **High** — explains frustration-caused bounces |
| `p70_inp` | Yes | No | No | Medium — interactivity signal |
| `p70_scroll` | Yes | No | No | Medium — content consumption depth |

Additionally, **Ahrefs paid pages data** (CPC, sumTraffic, topKeyword) is imported in Step 1 and stored in S3 at `metrics/{siteId}/ahrefs/paid-pages.json` — but Step 7 never reads it. The `paid-cookie-consent` audit already has a pattern for this (`ahrefs-cpc.js`).

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
    log.info(`Excluding ${page.url}: LCP ${page.p70Lcp}ms > 4000ms (performance issue, not alignment)`);
    return false;
  }
  if (page.p70Cls > 0.25) {
    log.info(`Excluding ${page.url}: CLS ${page.p70Cls} > 0.25 (layout shift issue, not alignment)`);
    return false;
  }
  return true;
});
```

**Rationale:**
- LCP > 4000ms = "Poor" by Google standards. Users abandon before content renders. LLM analysis wasted.
- CLS > 0.25 = "Poor" CLS. Bounces from frustration, not misalignment.
- **Not routing to separate opportunity** — CWV issues are handled by the existing `guidance:cwv` audit.

**Estimated pages excluded:** ~10-15% of predominantly-paid pages.

### 3. URL Pattern Exclusion

**Change:** Skip page types where high bounce rate is expected and NOT an alignment issue.

```javascript
const EXCLUDE_URL_PATTERNS = [
  /\/(blog|articles|news|press-releases)\//i,     // Informational — bounce is normal
  /\/(help|support|faq|docs|documentation)\//i,    // Support — users get answer and leave
  /\/(cart|checkout|order|payment)\//i,             // Checkout — wrong funnel stage for this audit
  /\/(legal|privacy|terms|cookie-policy)\//i,       // Legal — not a landing page
];

function isExcludedPageType(url) {
  return EXCLUDE_URL_PATTERNS.some(pattern => pattern.test(url));
}
```

**Estimated pages excluded:** ~10-20% of qualifying pages.

### 4. Ahrefs Data Enrichment

**Change:** Read Ahrefs paid-pages data from S3 (already imported in Step 1) to get CPC/keyword per page.

```javascript
// NEW function following ahrefs-cpc.js pattern from paid-cookie-consent
async function fetchPaidPagesFromS3(context, siteId) {
  const { s3Client, env, log } = context;
  const bucketName = env.S3_IMPORTER_BUCKET_NAME;
  const key = `metrics/${siteId}/ahrefs/paid-pages.json`;

  try {
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
    return map;
  } catch (error) {
    log.warn(`Failed to fetch paid pages data: ${error.message}. Proceeding without enrichment.`);
    return new Map();
  }
}
```

**Cost:** One S3 GET per audit run (not per page). Negligible.

**Benefit:** Enables CPC-based priority scoring and filtering out pages with no Ahrefs data.

### 5. Composite Priority Score (WSIS)

**Change:** Replace binary pass/fail with a **Wasted Spend Impact Score**.

```javascript
function computePriorityScore(page, ahrefsData) {
  const cpc = ahrefsData?.cpc || 0;

  // Business impact: estimated monthly wasted spend ($)
  const wastedSpend = cpc * page.pageViews * page.bounceRate;

  // Alignment signal: high bounce + low scroll = likely alignment issue
  // High scroll + high bounce = CTA problem, not alignment
  const alignmentProbability = page.bounceRate * (1 - (page.engagedScrollRate || 0));

  // CWV penalty: reduce priority if borderline CWV contributes to bounces
  let cwvAdjustment = 1.0;
  if (page.p70Lcp > 4000) cwvAdjustment *= 0.5;
  else if (page.p70Lcp > 2500) cwvAdjustment *= 0.75;
  if (page.p70Cls > 0.25) cwvAdjustment *= 0.7;
  if (page.p70Inp > 500) cwvAdjustment *= 0.8;

  return (wastedSpend / 1000) * alignmentProbability * cwvAdjustment;
}
```

**Interpretation:**
- A page with CPC=$2, 5000 PVs, 50% bounce, 10% scroll engagement, good CWV:
  `(2×5000×0.5/1000) × (0.5×0.9) × 1.0 = 5.0 × 0.45 × 1.0 = 2.25`
- Same page but 70% scroll engagement:
  `5.0 × (0.5×0.3) × 1.0 = 5.0 × 0.15 × 1.0 = 0.75` (much lower — alignment is less likely)
- Same page but CPC=$0.10:
  `(0.1×5000×0.5/1000) × 0.45 × 1.0 = 0.25 × 0.45 = 0.11` (low business impact)

### 6. Page Cap

**Change:** Send only top N pages by priority score, configurable via env var.

```javascript
const MAX_PAGES_PER_AUDIT = parseInt(env.MAX_AD_INTENT_PAGES || '10', 10);

const rankedPages = enrichedPages
  .map(page => ({ ...page, priorityScore: computePriorityScore(page, ahrefsMap.get(page.url)) }))
  .filter(page => page.priorityScore > 0.01)
  .sort((a, b) => b.priorityScore - a.priorityScore)
  .slice(0, MAX_PAGES_PER_AUDIT);
```

### 7. Enriched SQS Message

**Change:** Send all available data to Mystique (backward-compatible — unknown fields ignored).

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

**Downstream benefit:** Mystique can skip the SpaceCat API call for Ahrefs data (~1-2s saved per page).

---

## Proposed Filter Pipeline (Complete)

```
1. Athena: trf_channel = 'search'                     (unchanged)
2. Athena: HAVING SUM(pageviews) >= 1000               (unchanged)
3. Post-query: paid/total >= 80%                       (unchanged)
4. CWV hard exclusion: LCP > 4000ms OR CLS > 0.25     (NEW)
5. URL pattern exclusion: blog, support, checkout, legal (NEW)
6. bounceRate >= 0.50                                  (CHANGED from 0.30)
7. Ahrefs enrichment: fetch CPC/keyword from S3        (NEW)
8. Priority score + cap: compute WSIS, send top N      (NEW)
9. Response-side: severity != low/none                 (unchanged)
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

### Phase 1: Extract + Filter (audit-worker only)

1. Modify `transformResultItem()` to extract CWV fields
2. Add CWV hard exclusion filter
3. Add URL pattern exclusion filter
4. Change `CUT_OFF_BOUNCE_RATE` to 0.5
5. Write tests (100% coverage required)

### Phase 2: Ahrefs Enrichment + Scoring (audit-worker only)

1. Add `fetchPaidPagesFromS3()` (follow `ahrefs-cpc.js` pattern)
2. Add `computePriorityScore()` function
3. Add page cap with `MAX_AD_INTENT_PAGES` env var
4. Enrich `buildMystiqueMessage()` with all available data
5. Write tests

### Phase 3: Mystique Optimization (optional)

1. Add new fields to `AdIntentGapRequestMessageData`
2. Short-circuit `_get_paid_pages_data()` when SQS carries Ahrefs data
3. Write tests

### Feature Flags

| Flag | Default | Purpose |
|------|---------|---------|
| `AD_INTENT_ENABLE_CWV_FILTER` | `false` | Enable CWV hard exclusion |
| `AD_INTENT_ENABLE_AHREFS_ENRICHMENT` | `false` | Enable Ahrefs S3 fetch |
| `AD_INTENT_ENABLE_PRIORITY_SCORING` | `false` | Enable WSIS scoring + ranking |
| `AD_INTENT_MAX_PAGES` | `0` (unlimited) | Cap on pages sent per audit |

---

## Critical Files

| File | Changes |
|------|---------|
| `src/paid-keyword-optimizer/handler.js` | `transformResultItem` (extract CWV), new filters, new `fetchPaidPagesFromS3()`, new `computePriorityScore()`, enriched `buildMystiqueMessage`, page cap |
| `src/paid-keyword-optimizer/queries.js` | Optional: add `cwv_health` computed column |
| `src/paid-cookie-consent/ahrefs-cpc.js` | Reference pattern for S3 data fetching |

## Verification

- **Package manager:** npm (Node 24 per `.nvmrc`)
- **Test command:** `npm test` (c8 + mocha)
- **Coverage:** 100% lines, branches, statements
- **Key test cases:**
  - `transformResultItem` extracts p70_lcp, p70_cls, p70_inp, p70_scroll
  - CWV exclusion: LCP 3999 passes, LCP 4001 excluded; CLS 0.24 passes, CLS 0.26 excluded
  - URL pattern exclusion: `/blog/post-1` excluded, `/products/widget` passes
  - `fetchPaidPagesFromS3` returns Map when S3 file exists
  - `fetchPaidPagesFromS3` returns empty Map when S3 file missing (graceful degradation)
  - `computePriorityScore` with good CWV, poor CWV, zero CPC, high/low engagement
  - Page cap: MAX_AD_INTENT_PAGES=5 with 10 qualifying pages → only 5 sent
  - Priority sorting: highest WSIS sent first
  - Feature flags: each filter skipped when flag is `false`
  - `buildMystiqueMessage` includes enriched fields when available, omits when not
  - Backward compat: message format valid for current Mystique even without enriched fields
