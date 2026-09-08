# Ad Intent Mismatch UI v4 — Audit-Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three new fields to the `ad-intent-mismatch` opportunity (`whatsLikelyHappening` pass-through, a derived `recommendedAction` exclude-list, and a `landingPageMetrics` block), and persist `paidTrafficShare` per page so the metrics can be threaded.

**Architecture:** Part B of the cross-repo spec `mysticat-architecture/products/aso/ad-intent-mismatch-ui-v4.md`. All changes are inside `src/paid-keyword-optimizer/`. `recommendedAction` and `landingPageMetrics` are derived entirely in the audit-worker (no Mystique dependency); `whatsLikelyHappening` is a verbatim pass-through of a new Mystique SQS-body key. `normalizeUrl` is extracted to a shared `utils.js` so the mapper can match URLs without importing `handler.js`.

**Tech Stack:** Node.js 24.16.0 (ESM), Mocha + Chai + Sinon, `c8` coverage **strict 100% lines/branches/statements**, ESLint (Husky `lint-staged`).

**Spec:** `mysticat-architecture/products/aso/ad-intent-mismatch-ui-v4.md` (Parts B + the M9 observability log).

---

## File Structure

- **Create** `src/paid-keyword-optimizer/utils.js` — owns `normalizeUrl` (moved from `handler.js`). Single responsibility: URL normalization shared by the runner and the mapper.
- **Modify** `src/paid-keyword-optimizer/handler.js` — import `normalizeUrl` from `utils.js` (re-export retained for back-compat); attach `paidTrafficShare` to each `predominantlyPaidPages` entry.
- **Modify** `src/paid-keyword-optimizer/guidance-opportunity-mapper.js` — add `whatsLikelyHappening`, `recommendedAction`, `landingPageMetrics` to `opportunity.data`; gain a 4th `auditResult` parameter.
- **Modify** `src/paid-keyword-optimizer/guidance-handler.js` — pass the already-fetched `auditResult` as the mapper's 4th arg; emit a structured field-population log after opportunity creation.
- **Create** `test/audits/paid-keyword-optimizer/utils.test.js` — `normalizeUrl` unit tests.
- **Modify** `test/audits/paid-keyword-optimizer/handler.test.js` — `paidTrafficShare` assertion.
- **Modify** `test/audits/paid-keyword-optimizer/opportunity-mapper.test.js` — new-field tests + update **all** existing `mapToKeywordOptimizerOpportunity` calls to the 4-arg signature.
- **Modify** `test/audits/paid-keyword-optimizer/guidance.test.js` — `auditResult.predominantlyPaidPages` on the audit mock for the populated path + field-population log assertion.

**Conventions to match (from the existing tests):** the mapper test uses helpers `makeCluster({...})`, `createClusterMessage({...})`, and `createMockAudit()` (returns `{ getAuditId, getAuditResult }`). `makeCluster` defaults to `overallAlignmentScore: 'fair'` with `keywords: [{ keyword: 'test', cpc: 2.0, traffic: 500 }]`, so default clusters are **not** `poor` (→ `recommendedAction: null` unless a test sets `overallAlignmentScore: 'poor'`).

---

## Task 1: Extract `normalizeUrl` into a shared `utils.js`

**Files:**
- Create: `src/paid-keyword-optimizer/utils.js`
- Modify: `src/paid-keyword-optimizer/handler.js` (lines 60-68 define `normalizeUrl`; line ~682 re-exports it)
- Test: `test/audits/paid-keyword-optimizer/utils.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/audits/paid-keyword-optimizer/utils.test.js`:

```js
/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { expect } from 'chai';
import { normalizeUrl } from '../../../src/paid-keyword-optimizer/utils.js';

describe('paid-keyword-optimizer utils — normalizeUrl', () => {
  it('strips the www. prefix from the hostname', () => {
    expect(normalizeUrl('https://www.example.com/page')).to.equal('https://example.com/page');
  });

  it('is idempotent on an already-normalized URL', () => {
    expect(normalizeUrl('https://example.com/page')).to.equal('https://example.com/page');
  });

  it('returns the input unchanged when it is not a parseable URL', () => {
    expect(normalizeUrl('not a url')).to.equal('not a url');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:spec -- test/audits/paid-keyword-optimizer/utils.test.js`
Expected: FAIL — `Cannot find module '.../src/paid-keyword-optimizer/utils.js'`.

- [ ] **Step 3: Create `utils.js` (move the function verbatim)**

Create `src/paid-keyword-optimizer/utils.js`:

```js
/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/**
 * Normalizes a URL by stripping the www. prefix from the hostname.
 * Ensures consistent URL matching between data sources (e.g. RUM uses casio.com
 * while the SEO provider uses www.casio.com).
 * @param {string} url - URL to normalize
 * @returns {string} URL with www. stripped from hostname, or the input on parse failure
 */
export function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hostname = parsed.hostname.replace(/^www\./, '');
    return parsed.toString();
  } catch {
    return url;
  }
}
```

- [ ] **Step 4: Update `handler.js` to import from `utils.js`**

In `src/paid-keyword-optimizer/handler.js`: add the import near the top (after the existing imports):

```js
import { normalizeUrl } from './utils.js';
```

Delete the local `normalizeUrl` function definition (the `function normalizeUrl(url) { … }` block, lines ~60-68). **Keep** `normalizeUrl` in the named `export { … }` block (~line 682) — it re-exports the imported binding, so existing importers (`handler.test.js`'s `describe('normalizeUrl')`) keep working unchanged.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:spec -- test/audits/paid-keyword-optimizer/utils.test.js test/audits/paid-keyword-optimizer/handler.test.js`
Expected: PASS (the new utils tests + the existing `handler.test.js` `normalizeUrl` describe still green via the re-export).

- [ ] **Step 6: Commit**

```bash
git add src/paid-keyword-optimizer/utils.js src/paid-keyword-optimizer/handler.js test/audits/paid-keyword-optimizer/utils.test.js
git commit -m "refactor(ad-intent): extract normalizeUrl to shared utils.js"
```

---

## Task 2: Persist `paidTrafficShare` on each predominantly-paid page

**Files:**
- Modify: `src/paid-keyword-optimizer/handler.js` (`paidKeywordOptimizerRunner`, the `predominantlyPaidPages` construction ~lines 479-481)
- Test: `test/audits/paid-keyword-optimizer/handler.test.js` (`describe('paidKeywordOptimizerRunner')`, ~line 1418)

- [ ] **Step 1: Write the failing test**

In `test/audits/paid-keyword-optimizer/handler.test.js`, inside `describe('paidKeywordOptimizerRunner', …)`, add:

```js
it('attaches paidTrafficShare = paid / total to each predominantly-paid page', async () => {
  const result = await paidKeywordOptimizerRunner(auditUrl, context, site);
  const byPath = new Map(
    result.auditResult.predominantlyPaidPages.map((p) => [p.path, p]),
  );
  // Default Athena mock: /page1 paid=1000 earned=100 (total 1100); /page2 paid=800 earned=50 (total 850).
  expect(byPath.get('/page1').paidTrafficShare).to.be.closeTo(1000 / 1100, 1e-9);
  expect(byPath.get('/page2').paidTrafficShare).to.be.closeTo(800 / 850, 1e-9);
});
```

> If `auditUrl` is not already in scope in this describe block, mirror the sibling tests (they call `paidKeywordOptimizerRunner(auditUrl, context, site)` — `auditUrl` is defined at the top of the file's describe). Use the exact identifier the neighboring tests use.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:spec -- test/audits/paid-keyword-optimizer/handler.test.js --grep "paidTrafficShare"`
Expected: FAIL — `paidTrafficShare` is `undefined`.

- [ ] **Step 3: Implement — attach the share in a post-filter map (no new branch)**

In `paidKeywordOptimizerRunner`, replace the `predominantlyPaidPages` construction:

```js
// before:
//   const predominantlyPaidPages = predominantlyPaidPaths
//     .map((path) => getPaidTrafficRow(pathTrafficMap, path))
//     .filter((row) => row !== null);

const predominantlyPaidPages = predominantlyPaidPaths
  .map((path) => getPaidTrafficRow(pathTrafficMap, path))
  .filter((row) => row !== null)
  .map((row) => {
    const td = pathTrafficMap.get(row.path);
    // total > 0 is guaranteed here: only predominantly-paid paths reach this point
    // (isPredominantlyPaid filters out total === 0). No ternary -> no dead branch.
    return { ...row, paidTrafficShare: td.paid / td.total };
  });
```

The trailing `.filter((row) => row !== null)` is the **pre-existing** filter, retained; a bare `!== null` comparison is not a `c8` branch, and the `getPaidTrafficRow` null-guards remain validly `c8`-ignored (unreachable from this call site).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:spec -- test/audits/paid-keyword-optimizer/handler.test.js --grep "paidTrafficShare"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/paid-keyword-optimizer/handler.js test/audits/paid-keyword-optimizer/handler.test.js
git commit -m "feat(ad-intent): persist paidTrafficShare per predominantly-paid page"
```

---

## Task 3: Pass `whatsLikelyHappening` through to `opportunity.data`

**Files:**
- Modify: `src/paid-keyword-optimizer/guidance-opportunity-mapper.js` (`mapToKeywordOptimizerOpportunity`)
- Test: `test/audits/paid-keyword-optimizer/opportunity-mapper.test.js`

- [ ] **Step 1: Write the failing tests**

In `opportunity-mapper.test.js`, inside `describe('mapToKeywordOptimizerOpportunity', …)`, add:

```js
it('passes whatsLikelyHappening through to data when present', () => {
  const audit = createMockAudit();
  const message = createClusterMessage({ extraBody: { whatsLikelyHappening: 'spend leaks here' } });

  const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message);

  expect(result.data.whatsLikelyHappening).to.equal('spend leaks here');
});

it('sets whatsLikelyHappening to null when absent', () => {
  const audit = createMockAudit();
  const message = createClusterMessage();

  const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message);

  expect(result.data.whatsLikelyHappening).to.equal(null);
});

it('coerces an explicit null whatsLikelyHappening to null', () => {
  const audit = createMockAudit();
  const message = createClusterMessage({ extraBody: { whatsLikelyHappening: null } });

  const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message);

  expect(result.data.whatsLikelyHappening).to.equal(null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:spec -- test/audits/paid-keyword-optimizer/opportunity-mapper.test.js --grep "whatsLikelyHappening"`
Expected: FAIL — `result.data.whatsLikelyHappening` is `undefined`.

- [ ] **Step 3: Implement**

In `mapToKeywordOptimizerOpportunity`, after the existing `const pageTopics = …` line, add:

```js
const whatsLikelyHappening = guidanceBody.whatsLikelyHappening ?? null;
```

…and add `whatsLikelyHappening` to the returned `data` object (next to `resolvedPageHeading`, `pageTopics`):

```js
      resolvedPageHeading,
      pageTopics,
      whatsLikelyHappening,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:spec -- test/audits/paid-keyword-optimizer/opportunity-mapper.test.js --grep "whatsLikelyHappening"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/paid-keyword-optimizer/guidance-opportunity-mapper.js test/audits/paid-keyword-optimizer/opportunity-mapper.test.js
git commit -m "feat(ad-intent): pass whatsLikelyHappening through to opportunity.data"
```

---

## Task 4: Derive `recommendedAction` from poorly-aligned clusters

**Files:**
- Modify: `src/paid-keyword-optimizer/guidance-opportunity-mapper.js`
- Test: `test/audits/paid-keyword-optimizer/opportunity-mapper.test.js`

- [ ] **Step 1: Write the failing tests**

Add a new describe block in `opportunity-mapper.test.js`:

```js
describe('mapToKeywordOptimizerOpportunity — recommendedAction', () => {
  const poorCluster = (over = {}) => makeCluster({
    clusterId: 'c-poor',
    overallAlignmentScore: 'poor',
    representativeKeyword: 'okta verify app',
    keywords: [{ keyword: 'okta verify app', traffic: 565, cpc: 1.2 }],
    gapAnalysis: { keywordToPageGap: { explanation: 'wrong product intent', gapDescription: '' } },
    ...over,
  });

  it('builds an exclude action listing poor clusters and their keywords', () => {
    const message = createClusterMessage({ clusterResults: [poorCluster()] });
    const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, createMockAudit(), message);

    expect(result.data.recommendedAction).to.deep.equal({
      actionType: 'exclude',
      totalClusters: 1,
      totalKeywords: 1,
      totalSearchVolume: 565,
      clusters: [{
        clusterId: 'c-poor',
        representativeKeyword: 'okta verify app',
        alignmentScore: 'poor',
        reason: 'wrong product intent',
        keywords: [{ keyword: 'okta verify app', searchVolume: 565 }],
      }],
    });
  });

  it('returns null when there are no poor clusters', () => {
    const message = createClusterMessage({ clusterResults: [makeCluster({ overallAlignmentScore: 'good' })] });
    const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, createMockAudit(), message);
    expect(result.data.recommendedAction).to.equal(null);
  });

  it('excludes a poor cluster whose analysisStatus is failed', () => {
    const message = createClusterMessage({
      clusterResults: [poorCluster({ analysisStatus: 'failed' })],
    });
    const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, createMockAudit(), message);
    expect(result.data.recommendedAction).to.equal(null);
  });

  it('dedupes a keyword shared across two poor clusters in the totals', () => {
    const a = poorCluster({ clusterId: 'a', keywords: [{ keyword: 'dup', traffic: 100 }, { keyword: 'x', traffic: 50 }] });
    const b = poorCluster({ clusterId: 'b', keywords: [{ keyword: 'dup', traffic: 100 }] });
    const message = createClusterMessage({ clusterResults: [a, b] });
    const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, createMockAudit(), message);

    expect(result.data.recommendedAction.totalClusters).to.equal(2);
    expect(result.data.recommendedAction.totalKeywords).to.equal(2); // dup + x, distinct
    expect(result.data.recommendedAction.totalSearchVolume).to.equal(150); // 100 + 50, dup counted once
  });

  it('handles a poor cluster with empty keywords (contributes 0)', () => {
    const message = createClusterMessage({ clusterResults: [poorCluster({ keywords: [] })] });
    const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, createMockAudit(), message);
    expect(result.data.recommendedAction.clusters[0].keywords).to.deep.equal([]);
    expect(result.data.recommendedAction.totalKeywords).to.equal(0);
    expect(result.data.recommendedAction.totalSearchVolume).to.equal(0);
  });

  it('maps keyword traffic null/undefined to searchVolume 0', () => {
    const message = createClusterMessage({
      clusterResults: [poorCluster({ keywords: [{ keyword: 'novol' }] })],
    });
    const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, createMockAudit(), message);
    expect(result.data.recommendedAction.clusters[0].keywords[0].searchVolume).to.equal(0);
  });

  describe('reason resolution chain', () => {
    const reasonOf = (gapAnalysis) => {
      const message = createClusterMessage({ clusterResults: [poorCluster({ gapAnalysis })] });
      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, createMockAudit(), message);
      return result.data.recommendedAction.clusters[0].reason;
    };

    it('uses keywordToPageGap.explanation when set', () => {
      expect(reasonOf({ keywordToPageGap: { explanation: 'why', gapDescription: 'desc' } })).to.equal('why');
    });
    it('falls back to gapDescription when explanation is empty', () => {
      expect(reasonOf({ keywordToPageGap: { explanation: '  ', gapDescription: 'desc' } })).to.equal('desc');
    });
    it('returns null when both are empty', () => {
      expect(reasonOf({ keywordToPageGap: { explanation: '', gapDescription: '' } })).to.equal(null);
    });
    it('returns null when gapAnalysis has no keywordToPageGap', () => {
      expect(reasonOf({})).to.equal(null);
    });
    it('returns null when the cluster has no gapAnalysis', () => {
      const message = createClusterMessage({
        clusterResults: [makeCluster({ overallAlignmentScore: 'poor', gapAnalysis: undefined, keywords: [{ keyword: 'k', traffic: 1 }] })],
      });
      const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, createMockAudit(), message);
      expect(result.data.recommendedAction.clusters[0].reason).to.equal(null);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:spec -- test/audits/paid-keyword-optimizer/opportunity-mapper.test.js --grep "recommendedAction"`
Expected: FAIL — `result.data.recommendedAction` is `undefined`.

- [ ] **Step 3: Implement**

In `guidance-opportunity-mapper.js`, add module-level helpers near the top (after `MISALIGNED_SCORES`):

```js
// Stricter than MISALIGNED_SCORES ({poor, fair}) on purpose: only the worst-aligned clusters
// are proposed for keyword exclusion. Product decision, v4. Widen this set to extend the policy.
const EXCLUDE_ALIGNMENT_SCORES = new Set(['poor']);

/**
 * Resolves the "why excluded" text for a poor cluster. Only keyword->page signals justify
 * excluding a keyword; cluster.summary / keywordToAdGap are intentionally NOT in the chain.
 * @param {Object} cluster - cluster result
 * @returns {string|null} reason text, or null when no source text exists
 */
function resolveExclusionReason(cluster) {
  const kpg = cluster.gapAnalysis?.keywordToPageGap;
  const candidates = [kpg?.explanation, kpg?.gapDescription];
  const reason = candidates.find((s) => typeof s === 'string' && s.trim().length > 0);
  return reason ? reason.trim() : null;
}

/**
 * Builds the "exclude keywords" recommended action from poorly-aligned clusters.
 * Totals are computed over the DISTINCT keyword set across listed clusters.
 * @param {Array} clusterResults - cluster results from the guidance body
 * @returns {Object|null} recommendedAction, or null when no poor clusters
 */
function buildRecommendedAction(clusterResults) {
  const poor = clusterResults.filter(
    (c) => c.analysisStatus !== 'failed' && EXCLUDE_ALIGNMENT_SCORES.has(c.overallAlignmentScore),
  );
  if (poor.length === 0) {
    return null;
  }

  const clusters = poor.map((c) => ({
    clusterId: c.clusterId,
    representativeKeyword: c.representativeKeyword,
    alignmentScore: c.overallAlignmentScore,
    reason: resolveExclusionReason(c),
    keywords: (c.keywords || []).map((k) => ({ keyword: k.keyword, searchVolume: k.traffic ?? 0 })),
  }));

  const distinct = new Map(); // keyword -> searchVolume (Semrush volume is market-wide, identical per keyword)
  for (const c of clusters) {
    for (const k of c.keywords) {
      if (!distinct.has(k.keyword)) {
        distinct.set(k.keyword, k.searchVolume);
      }
    }
  }

  return {
    actionType: 'exclude',
    totalClusters: clusters.length,
    totalKeywords: distinct.size,
    totalSearchVolume: [...distinct.values()].reduce((sum, v) => sum + v, 0),
    clusters,
  };
}
```

In `mapToKeywordOptimizerOpportunity`, after the `totalMisalignedSpend` computation, add:

```js
const recommendedAction = buildRecommendedAction(clusterResults);
```

…and add `recommendedAction` to the returned `data` object (after `whatsLikelyHappening`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:spec -- test/audits/paid-keyword-optimizer/opportunity-mapper.test.js --grep "recommendedAction"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/paid-keyword-optimizer/guidance-opportunity-mapper.js test/audits/paid-keyword-optimizer/opportunity-mapper.test.js
git commit -m "feat(ad-intent): derive recommendedAction exclude-list from poor clusters"
```

---

## Task 5: Thread `landingPageMetrics` (4th mapper arg + call site + existing-test updates)

**Files:**
- Modify: `src/paid-keyword-optimizer/guidance-opportunity-mapper.js` (signature + `landingPageMetrics`)
- Modify: `src/paid-keyword-optimizer/guidance-handler.js` (call site, line ~126)
- Test: `test/audits/paid-keyword-optimizer/opportunity-mapper.test.js` (new tests + update **all** existing calls)
- Test: `test/audits/paid-keyword-optimizer/guidance.test.js` (audit mock `getAuditResult`)

> **This is one atomic diff:** the new 4th param is required, so the mapper, the handler call site, and every existing test call must change together. A 3-arg call leaves `auditResult` undefined and `auditResult.predominantlyPaidPages` throws.
>
> This **intentionally satisfies** the spec's B.2 "one atomic diff" requirement (it is split across Tasks 3/4/5 only for TDD sequencing — the signature flips to 4-arg solely within *this* task: Step 1 updates all calls, Step 4 the signature, Step 5 the call site, committed together in Step 8). No intermediate commit from Tasks 3-4 ever leaves a throwing 3-arg call, because the signature is still 3-arg until Step 4.

- [ ] **Step 1: Update every existing mapper test call to pass a 4th arg**

In `opportunity-mapper.test.js`, change **every** call of the form
`mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message)` to pass a 4th arg.
Use `createMockAudit().getAuditResult()` (the existing helper returns a non-`predominantlyPaidPages` object → `landingPageMetrics` resolves to `null`, which is fine for those tests). Concretely, define a tiny local helper at the top of the outer `describe` and use it everywhere:

```js
// auditResult passed by the guidance handler; default mock has no predominantlyPaidPages
const AR = () => createMockAudit().getAuditResult();
// e.g.:  mapToKeywordOptimizerOpportunity(TEST_SITE_ID, audit, message, AR());
```

Update the Task 3 / Task 4 tests added above the same way (append `, AR()` — or `, createMockAudit().getAuditResult()`).

> Search to confirm none are missed: `grep -n "mapToKeywordOptimizerOpportunity(" test/audits/paid-keyword-optimizer/opportunity-mapper.test.js` — every hit must have 4 args.

- [ ] **Step 2: Write the failing `landingPageMetrics` tests**

Add to `opportunity-mapper.test.js`:

```js
describe('mapToKeywordOptimizerOpportunity — landingPageMetrics', () => {
  const auditResultWithPage = (over = {}) => ({
    predominantlyPaidPages: [{
      url: TEST_URL, bounceRate: 0.62, engagedScrollRate: 0.18, paidTrafficShare: 0.91, ...over,
    }],
  });

  it('builds landingPageMetrics from the matching predominantlyPaidPages row', () => {
    const result = mapToKeywordOptimizerOpportunity(
      TEST_SITE_ID, createMockAudit(), createClusterMessage(), auditResultWithPage(),
    );
    expect(result.data.landingPageMetrics).to.deep.equal({
      bounceRate: 0.62, engagedScrollRate: 0.18, paidTrafficShare: 0.91,
    });
  });

  it('returns null when auditResult has no predominantlyPaidPages', () => {
    const result = mapToKeywordOptimizerOpportunity(
      TEST_SITE_ID, createMockAudit(), createClusterMessage(), {},
    );
    expect(result.data.landingPageMetrics).to.equal(null);
  });

  it('returns null when the opportunity URL is not in predominantlyPaidPages', () => {
    const ar = { predominantlyPaidPages: [{ url: 'https://other/page', bounceRate: 0.5, engagedScrollRate: 0.1, paidTrafficShare: 0.8 }] };
    const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, createMockAudit(), createClusterMessage(), ar);
    expect(result.data.landingPageMetrics).to.equal(null);
  });

  it('sets paidTrafficShare to null when the matched row predates the field', () => {
    const ar = { predominantlyPaidPages: [{ url: TEST_URL, bounceRate: 0.62, engagedScrollRate: 0.18 }] };
    const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, createMockAudit(), createClusterMessage(), ar);
    expect(result.data.landingPageMetrics.paidTrafficShare).to.equal(null);
  });

  it('matches the URL ignoring a www. difference', () => {
    // message URL is TEST_URL ('https://sample-page/page1'); persisted row uses www.
    const ar = { predominantlyPaidPages: [{ url: 'https://www.sample-page/page1', bounceRate: 0.4, engagedScrollRate: 0.2, paidTrafficShare: 0.75 }] };
    const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, createMockAudit(), createClusterMessage(), ar);
    expect(result.data.landingPageMetrics).to.deep.equal({ bounceRate: 0.4, engagedScrollRate: 0.2, paidTrafficShare: 0.75 });
  });

  // Spec B.3 final bullet: existing keys + top-level title/guidance survive WHEN the new keys are present.
  it('preserves existing opportunity fields when the new keys are present', () => {
    const message = createClusterMessage({ extraBody: { whatsLikelyHappening: 'narr' } });
    const result = mapToKeywordOptimizerOpportunity(TEST_SITE_ID, createMockAudit(), message, auditResultWithPage());

    expect(result.title).to.equal('Ad intent mismatch detected across keyword clusters');
    expect(result.guidance).to.equal(null);
    expect(result.data.url).to.equal(TEST_URL);
    expect(result.data.page).to.equal(TEST_URL);
    expect(result.data.portfolioMetrics).to.exist;
    expect(result.data.totalClusters).to.be.a('number');
    expect(result.data.langfuseTraceId).to.equal('trace-123');
    // ...and the new keys coexist:
    expect(result.data.whatsLikelyHappening).to.equal('narr');
    expect(result.data.landingPageMetrics).to.not.equal(null);
  });
});
```

- [ ] **Step 3: Run to verify the new tests fail (and the suite no longer throws)**

Run: `npm run test:spec -- test/audits/paid-keyword-optimizer/opportunity-mapper.test.js`
Expected: the `landingPageMetrics` tests FAIL (field `undefined`); all other tests PASS (4-arg updates done in Step 1).

- [ ] **Step 4: Implement the mapper change**

In `guidance-opportunity-mapper.js`:

Add the import at the top:

```js
import { normalizeUrl } from './utils.js';
```

Change the signature and add the derivation:

```js
export function mapToKeywordOptimizerOpportunity(siteId, audit, message, auditResult) {
  // …existing destructuring + derivations…

  // auditResult is provided (and truthy) by the guidance handler, which returns early if absent.
  const paidPages = auditResult.predominantlyPaidPages || [];
  const matchedPage = paidPages.find((p) => normalizeUrl(p.url) === normalizeUrl(url));
  const landingPageMetrics = matchedPage
    ? {
      bounceRate: matchedPage.bounceRate,
      engagedScrollRate: matchedPage.engagedScrollRate,
      paidTrafficShare: matchedPage.paidTrafficShare ?? null,
    }
    : null;

  return {
    // …existing fields…
    data: {
      // …existing data fields incl. whatsLikelyHappening, recommendedAction…
      landingPageMetrics,
    },
    // …
  };
}
```

- [ ] **Step 5: Update the guidance-handler call site**

In `guidance-handler.js` (~line 126), pass the already-fetched `auditResult`:

```js
const entity = mapToKeywordOptimizerOpportunity(siteId, audit, message, auditResult);
```

- [ ] **Step 6: Update the guidance test audit mock for the populated path**

In `guidance.test.js`, ensure the audit returned by `Audit.findById` has `getAuditResult()` returning an object with `predominantlyPaidPages` that includes the message URL (so at least one guidance test exercises a populated `landingPageMetrics`). Add an assertion on the created opportunity's `data.landingPageMetrics` in that test. (Other guidance tests can keep returning an `auditResult` without `predominantlyPaidPages` → `landingPageMetrics: null`.)

- [ ] **Step 7: Run to verify all pass**

Run: `npm run test:spec -- test/audits/paid-keyword-optimizer/opportunity-mapper.test.js test/audits/paid-keyword-optimizer/guidance.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/paid-keyword-optimizer/guidance-opportunity-mapper.js src/paid-keyword-optimizer/guidance-handler.js test/audits/paid-keyword-optimizer/opportunity-mapper.test.js test/audits/paid-keyword-optimizer/guidance.test.js
git commit -m "feat(ad-intent): thread landingPageMetrics into opportunity.data via 4th mapper arg"
```

---

## Task 6: Field-population observability log (spec M9)

**Files:**
- Modify: `src/paid-keyword-optimizer/guidance-handler.js` (after `Opportunity.create`)
- Test: `test/audits/paid-keyword-optimizer/guidance.test.js`

- [ ] **Step 1: Write the failing test**

In `guidance.test.js`, add a test asserting that after creating an opportunity, the handler logs a structured field-population line with the three booleans. Use the existing `log.info` stub:

```js
it('logs structured field-population booleans after creating the opportunity', async () => {
  // arrange a message whose guidance body has a poor cluster + whatsLikelyHappening,
  // and an audit whose auditResult.predominantlyPaidPages includes the URL (reuse this file's helpers/fixtures)
  await handler(message, context);

  const logged = context.log.info.getCalls().map((c) => c.args[0]).find((a) => a && 'has_recommended_action' in a);
  expect(logged).to.include({
    has_whats_likely_happening: true,
    has_recommended_action: true,
    has_landing_page_metrics: true,
  });
});
```

> Adapt `message`/`context`/`handler` to the identifiers already used in `guidance.test.js`. If the existing happy-path test already builds a suitable message+audit, extend it instead of adding a new one.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:spec -- test/audits/paid-keyword-optimizer/guidance.test.js --grep "field-population"`
Expected: FAIL — no such log call.

- [ ] **Step 3: Implement**

In `guidance-handler.js`, immediately after `const opportunity = await Opportunity.create(entity);` and its existing log line, add:

```js
log.info({
  site_id: siteId,
  url,
  audit_id: auditId,
  has_whats_likely_happening: entity.data.whatsLikelyHappening != null,
  has_recommended_action: entity.data.recommendedAction != null,
  has_landing_page_metrics: entity.data.landingPageMetrics != null,
  recommended_action_clusters: entity.data.recommendedAction?.totalClusters ?? 0,
}, '[ad-intent-mismatch] opportunity field population');
```

> **Coverage (required — this is the only new c8 branch in Task 6).** The three `!= null` booleans are expressions, not branches, but `entity.data.recommendedAction?.totalClusters ?? 0` is a real `?.`/`??` branch. Under the strict 100% gate it needs **both** arms reached at the log line. Add/confirm exactly these two `guidance.test.js` cases (name them explicitly, do not leave implicit):
> 1. **`recommendedAction` present** — a guidance message with at least one `overallAlignmentScore: 'poor'` cluster ⇒ `recommended_action_clusters` logged as a positive integer (exercises the `?.` truthy + the left arm of `??`).
> 2. **`recommendedAction` null** — a guidance message with only non-poor clusters ⇒ `recommended_action_clusters` logged as `0` (exercises `?.` short-circuit + the right arm of `??`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:spec -- test/audits/paid-keyword-optimizer/guidance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/paid-keyword-optimizer/guidance-handler.js test/audits/paid-keyword-optimizer/guidance.test.js
git commit -m "feat(ad-intent): log opportunity field-population booleans for post-deploy verification"
```

---

## Task 7: Full suite, coverage gate, and lint

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite with coverage**

Targeted (spec B.4 glob form, for a fast pre-check of just this audit): `npm run test:spec -- 'test/audits/paid-keyword-optimizer/*.test.js'`
Then the full gate — Run: `npm test`
Expected: PASS with **100% lines / branches / statements**. If `c8` reports any uncovered line/branch in the four touched source files, add the missing test (common culprits: a `?? null` / `?? 0` arm, the `|| []` arm, the `recommended_action_clusters` `??` arm). Re-run until green.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean. Fix any findings (e.g., import ordering for the new `utils.js` import).

- [ ] **Step 3: Commit any coverage/lint fixups**

```bash
git add -A
git commit -m "test(ad-intent): close coverage + lint for v4 audit-worker fields"
```

- [ ] **Step 4: Push + open PR (when ready)**

Create a feature branch (if not already on one), push, and open a PR against `main`. Reference the spec PR (`adobe/mysticat-architecture#149`) and `SITES`/ASO-74. Offer to monitor CI rather than auto-watching.

---

## Self-Review

**Spec coverage (Part B):**
- B.0 normalizeUrl extraction → Task 1. ✓
- B.1 paidTrafficShare persist (no new branch) → Task 2. ✓
- B.2.a whatsLikelyHappening pass-through → Task 3. ✓
- B.2.b recommendedAction (EXCLUDE set, reason chain, dedup totals, searchVolume) → Task 4. ✓
- B.2.c landingPageMetrics + 4th-arg signature + call site → Task 5. ✓
- M-A (update all existing test calls) → Task 5, Step 1. ✓
- M-B (gapAnalysis-present-but-keywordToPageGap-absent; traffic null → 0) → Task 4 reason-chain + searchVolume tests. ✓
- M9 observability log → Task 6. ✓
- 100% coverage + lint gate → Task 7. ✓

**Placeholder scan:** test bodies and implementations are complete; the only "adapt to existing identifiers" notes are in `guidance.test.js`/`handler.test.js` where the established fixtures/mocks must be reused verbatim (their exact shapes are quoted from the real files).

**Type/name consistency:** field names match the spec wire schema exactly — `whatsLikelyHappening`, `recommendedAction` (`actionType`, `totalClusters`, `totalKeywords`, `totalSearchVolume`, `clusters[].{clusterId,representativeKeyword,alignmentScore,reason,keywords[].{keyword,searchVolume}}`), `landingPageMetrics` (`bounceRate`, `engagedScrollRate`, `paidTrafficShare`). Helper names (`buildRecommendedAction`, `resolveExclusionReason`, `EXCLUDE_ALIGNMENT_SCORES`, `normalizeUrl`) are used consistently across tasks.
