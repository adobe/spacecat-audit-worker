/*
 * Copyright 2026 Adobe. All rights reserved.
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
 * SEO / GEO / AEO gap computation.
 *
 * The engine is intentionally data-driven: every comparable page signal is described by a
 * FACTOR descriptor, and {@link computeSeoGap} simply runs each descriptor over the target
 * snapshot and the competitor snapshots. Adding a new comparison dimension means adding one
 * FACTOR entry — the diffing, scoring and output shape stay untouched. This keeps the public
 * API generic and extensible for the downstream content-optimization service.
 */

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const median = (values) => {
  const sorted = values.map(num).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return 0;
  }
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const prevalence = (values) => (values.length
  ? Number((values.filter(Boolean).length / values.length).toFixed(3))
  : 0);

/**
 * A factor descriptor.
 * @typedef {Object} Factor
 * @property {string} key       - Stable identifier surfaced in the API.
 * @property {string} dimension - 'seo' | 'geo' | 'aeo'.
 * @property {string} label     - Human-readable description.
 * @property {'count'|'presence'} kind - Whether the value is a magnitude or a boolean signal.
 * @property {(s: object) => number|boolean} extract - Pull the value from a page snapshot.
 */

/** @type {Factor[]} */
export const FACTORS = [
  {
    key: 'wordCount',
    dimension: 'seo',
    label: 'Body word count (content depth)',
    kind: 'count',
    extract: (s) => num(s?.content?.wordCount),
  },
  {
    key: 'h2Count',
    dimension: 'seo',
    label: 'Number of H2 sub-headings (structure)',
    kind: 'count',
    extract: (s) => num(s?.headings?.counts?.h2),
  },
  {
    key: 'internalLinks',
    dimension: 'seo',
    label: 'Internal links (site depth signal)',
    kind: 'count',
    extract: (s) => num(s?.links?.internal),
  },
  {
    key: 'imageAltCoverage',
    dimension: 'seo',
    label: 'Fraction of images with alt text',
    kind: 'count',
    extract: (s) => num(s?.images?.altCoverage),
  },
  {
    key: 'hasStructuredData',
    dimension: 'geo',
    label: 'Presence of schema.org structured data (JSON-LD)',
    kind: 'presence',
    extract: (s) => Array.isArray(s?.structuredData) && s.structuredData.length > 0,
  },
  {
    key: 'schemaTypeCount',
    dimension: 'geo',
    label: 'Distinct schema.org @types declared',
    kind: 'count',
    extract: (s) => (Array.isArray(s?.schemaTypes) ? s.schemaTypes.length : 0),
  },
  {
    key: 'hasOpenGraph',
    dimension: 'geo',
    label: 'Open Graph tags for rich/LLM previews',
    kind: 'presence',
    extract: (s) => !!s?.openGraph && Object.keys(s.openGraph).length > 0,
  },
  {
    key: 'hasFaqSchema',
    dimension: 'aeo',
    label: 'FAQ/Q&A structured data (answer-engine signal)',
    kind: 'presence',
    extract: (s) => !!s?.content?.hasFaqSchema,
  },
  {
    key: 'hasMetaDescription',
    dimension: 'seo',
    label: 'Meta description present',
    kind: 'presence',
    extract: (s) => !!(s?.meta?.description),
  },
];

/**
 * Compares a single factor across the target and competitors.
 *
 * @param {Factor} factor
 * @param {object} target - Target page snapshot.
 * @param {object[]} competitors - Competitor page snapshots.
 * @returns {object} Per-factor gap record.
 */
function compareFactor(factor, target, competitors) {
  const targetValue = factor.extract(target);
  const competitorValues = competitors.map((c) => factor.extract(c));

  if (factor.kind === 'presence') {
    const competitorPrevalence = prevalence(competitorValues);
    // A gap exists when the target lacks a signal the majority of competitors have.
    const gap = !targetValue && competitorPrevalence >= 0.5;
    return {
      factor: factor.key,
      dimension: factor.dimension,
      label: factor.label,
      kind: factor.kind,
      target: !!targetValue,
      competitorPrevalence,
      gap,
      recommendation: gap
        ? `Add ${factor.label.toLowerCase()} — present on ${Math.round(competitorPrevalence * 100)}% of ranking competitors but missing on the target.`
        : null,
    };
  }

  const competitorMedian = median(competitorValues);
  // A gap exists when the target is materially below the competitor median.
  const gap = targetValue < competitorMedian;
  const deficit = gap ? Number((competitorMedian - targetValue).toFixed(3)) : 0;
  return {
    factor: factor.key,
    dimension: factor.dimension,
    label: factor.label,
    kind: factor.kind,
    target: targetValue,
    competitorMedian,
    competitorMax: competitorValues.length ? Math.max(...competitorValues.map(num)) : 0,
    gap,
    deficit,
    recommendation: gap
      ? `Increase ${factor.label.toLowerCase()}: target=${targetValue} vs competitor median=${competitorMedian}.`
      : null,
  };
}

/**
 * Computes the full gap report of the target page against its competitors.
 *
 * @param {object} target - Target page snapshot (from the seo-comparison scrape).
 * @param {object[]} competitors - Competitor page snapshots.
 * @param {Factor[]} [factors] - Factor registry (defaults to {@link FACTORS}); injectable for
 *   extension/testing.
 * @returns {object} Structured, extensible comparison report.
 */
export function computeSeoGap(target, competitors, factors = FACTORS) {
  const safeTarget = target || {};
  const safeCompetitors = Array.isArray(competitors) ? competitors.filter(Boolean) : [];

  const factorResults = factors.map((f) => compareFactor(f, safeTarget, safeCompetitors));
  const gaps = factorResults.filter((r) => r.gap);

  const byDimension = factorResults.reduce((acc, r) => {
    acc[r.dimension] = acc[r.dimension] || { total: 0, gaps: 0 };
    acc[r.dimension].total += 1;
    if (r.gap) {
      acc[r.dimension].gaps += 1;
    }
    return acc;
  }, {});

  return {
    schemaVersion: 1,
    target: { url: safeTarget.url ?? null },
    competitorCount: safeCompetitors.length,
    summary: {
      totalFactors: factorResults.length,
      gapsFound: gaps.length,
      byDimension,
    },
    factors: factorResults,
    // Prioritized, ready-to-action list for the downstream optimizer service.
    recommendations: gaps.map((g) => ({
      factor: g.factor,
      dimension: g.dimension,
      recommendation: g.recommendation,
    })),
  };
}
