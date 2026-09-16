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
import {
  hostOf, hostMatchesDomain, sharesBrand, bucketSerpResults,
} from '../../../src/seo-gap-analysis/serp.js';
import { BUCKET } from '../../../src/seo-gap-analysis/constants.js';

describe('seo-gap-analysis/serp', () => {
  describe('hostOf', () => {
    it('normalizes and strips www', () => {
      expect(hostOf('https://www.Nike.com/shoes')).to.equal('nike.com');
    });
    it('adds a protocol when missing', () => {
      expect(hostOf('nike.com/x')).to.equal('nike.com');
    });
    it('returns null for empty input', () => {
      expect(hostOf('')).to.equal(null);
      expect(hostOf(undefined)).to.equal(null);
    });
    it('returns null for unparseable input', () => {
      expect(hostOf('http://')).to.equal(null);
    });
  });

  describe('hostMatchesDomain', () => {
    it('matches exact host', () => {
      expect(hostMatchesDomain('brand.com', 'brand.com')).to.equal(true);
    });
    it('matches subdomain', () => {
      expect(hostMatchesDomain('shop.brand.com', 'www.brand.com')).to.equal(true);
    });
    it('does not match a different domain', () => {
      expect(hostMatchesDomain('other.com', 'brand.com')).to.equal(false);
    });
    it('returns false for empty inputs', () => {
      expect(hostMatchesDomain('', 'brand.com')).to.equal(false);
      expect(hostMatchesDomain('brand.com', '')).to.equal(false);
    });
  });

  describe('sharesBrand', () => {
    it('matches on the second-level label', () => {
      expect(sharesBrand('blog.nike.com', 'nike.com')).to.equal(true);
    });
    it('is false for different brands', () => {
      expect(sharesBrand('adidas.com', 'nike.com')).to.equal(false);
    });
    it('handles single-label hosts', () => {
      expect(sharesBrand('localhost', 'localhost')).to.equal(true);
    });
  });

  describe('bucketSerpResults', () => {
    const targetUrl = 'https://www.mybrand.com/page';
    const results = [
      { link: 'https://www.mybrand.com/page', rank: 1, title: 'Us' },
      { link: 'https://blog.mybrand.com/post', rank: 2 },
      { link: 'https://competitor-a.com/x', rank: 3, description: 'A' },
      { url: 'https://competitor-b.com/y', position: 4 },
      { link: 'https://partner.com/z', rank: 5 },
      { link: 'https://competitor-a.com/x', rank: 6 }, // duplicate
      { link: 'not a url', rank: 7 }, // unparseable
      { rank: 8 }, // no link at all
    ];

    it('buckets target, branded, competitors and filtered correctly', () => {
      const buckets = bucketSerpResults(results, {
        targetUrl,
        filterDomains: ['partner.com'],
      });
      expect(buckets.target.url).to.equal('https://www.mybrand.com/page');
      expect(buckets.target.bucket).to.equal(BUCKET.TARGET);
      expect(buckets.branded.map((b) => b.host)).to.deep.equal(['blog.mybrand.com']);
      expect(buckets.filtered.map((f) => f.host)).to.deep.equal(['partner.com']);
      expect(buckets.competitors.map((c) => c.host))
        .to.deep.equal(['competitor-a.com', 'competitor-b.com']);
    });

    it('keeps only the first target occurrence and ignores later same-host hits', () => {
      const dupTarget = [
        { link: 'https://www.mybrand.com/a', rank: 1 },
        { link: 'https://mybrand.com/b', rank: 2 }, // same host as target -> ignored
      ];
      const buckets = bucketSerpResults(dupTarget, { targetUrl });
      expect(buckets.target.url).to.equal('https://www.mybrand.com/a');
      expect(buckets.branded).to.have.length(0);
      expect(buckets.competitors).to.have.length(0);
    });

    it('caps competitors at maxCompetitors', () => {
      const many = Array.from({ length: 5 }, (_, i) => ({ link: `https://c${i}.com/`, rank: i }));
      const buckets = bucketSerpResults(many, { targetUrl, maxCompetitors: 2 });
      expect(buckets.competitors).to.have.length(2);
    });

    it('handles non-array input and missing target host', () => {
      const buckets = bucketSerpResults(null, { targetUrl: '' });
      expect(buckets.competitors).to.deep.equal([]);
      expect(buckets.target).to.equal(null);
    });

    it('treats every result as a competitor when target host is unparseable', () => {
      const buckets = bucketSerpResults(
        [{ link: 'https://c.com/' }],
        { targetUrl: 'http://' },
      );
      expect(buckets.competitors).to.have.length(1);
    });
  });
});
