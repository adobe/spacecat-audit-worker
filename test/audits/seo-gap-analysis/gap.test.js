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

/* eslint-env mocha */
import { expect } from 'chai';
import { computeSeoGap, FACTORS } from '../../../src/seo-gap-analysis/gap.js';

const snapshot = (over = {}) => ({
  url: 'https://x.com',
  content: { wordCount: 500, hasFaqSchema: false },
  headings: { counts: { h2: 5 } },
  links: { internal: 20 },
  images: { altCoverage: 0.9 },
  structuredData: [{ '@type': 'Article' }],
  schemaTypes: ['Article'],
  openGraph: { 'og:title': 'x' },
  meta: { description: 'a desc' },
  ...over,
});

describe('seo-gap-analysis/gap', () => {
  it('exposes a factor registry covering seo/geo/aeo', () => {
    const dims = new Set(FACTORS.map((f) => f.dimension));
    expect(dims).to.include.members(['seo', 'geo', 'aeo']);
  });

  it('reports no gaps when the target matches competitors', () => {
    const target = snapshot();
    const competitors = [snapshot(), snapshot()];
    const report = computeSeoGap(target, competitors);
    expect(report.summary.gapsFound).to.equal(0);
    expect(report.recommendations).to.deep.equal([]);
    expect(report.competitorCount).to.equal(2);
    expect(report.target.url).to.equal('https://x.com');
  });

  it('detects count gaps (word count below competitor median)', () => {
    const target = snapshot({ content: { wordCount: 100, hasFaqSchema: false } });
    const competitors = [
      snapshot({ content: { wordCount: 800, hasFaqSchema: false } }),
      snapshot({ content: { wordCount: 900, hasFaqSchema: false } }),
    ];
    const report = computeSeoGap(target, competitors);
    const wc = report.factors.find((f) => f.factor === 'wordCount');
    expect(wc.gap).to.equal(true);
    expect(wc.deficit).to.be.greaterThan(0);
    expect(wc.competitorMax).to.equal(900);
    expect(report.recommendations.some((r) => r.factor === 'wordCount')).to.equal(true);
  });

  it('detects presence gaps (missing structured data on target)', () => {
    const target = snapshot({ structuredData: [], schemaTypes: [] });
    const competitors = [snapshot(), snapshot()];
    const report = computeSeoGap(target, competitors);
    const sd = report.factors.find((f) => f.factor === 'hasStructuredData');
    expect(sd.gap).to.equal(true);
    expect(sd.competitorPrevalence).to.equal(1);
  });

  it('does not flag a presence gap when competitors also lack the signal', () => {
    const target = snapshot({ openGraph: {} });
    const competitors = [snapshot({ openGraph: {} }), snapshot({ openGraph: {} })];
    const report = computeSeoGap(target, competitors);
    const og = report.factors.find((f) => f.factor === 'hasOpenGraph');
    expect(og.gap).to.equal(false);
  });

  it('handles empty/undefined inputs defensively', () => {
    const report = computeSeoGap(undefined, undefined);
    expect(report.competitorCount).to.equal(0);
    expect(report.target.url).to.equal(null);
    expect(report.summary.totalFactors).to.equal(FACTORS.length);
    // With no competitor data, medians are 0 so counts never fall "below"; presence
    // factors have 0 prevalence so no gaps either.
    expect(report.summary.gapsFound).to.equal(0);
  });

  it('supports an injected custom factor registry', () => {
    const custom = [{
      key: 'custom', dimension: 'seo', label: 'Custom', kind: 'count', extract: () => 1,
    }];
    const report = computeSeoGap(snapshot(), [snapshot()], custom);
    expect(report.summary.totalFactors).to.equal(1);
  });

  it('computes even-length median correctly', () => {
    const target = snapshot({ links: { internal: 0 } });
    const competitors = [
      snapshot({ links: { internal: 10 } }),
      snapshot({ links: { internal: 20 } }),
    ];
    const report = computeSeoGap(target, competitors);
    const il = report.factors.find((f) => f.factor === 'internalLinks');
    expect(il.competitorMedian).to.equal(15);
  });
});
