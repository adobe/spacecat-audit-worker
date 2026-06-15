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
  normalizePath,
  getLlmVisibilityScore,
  buildPrerenderCitabilityMap,
} from '../../../src/cdn-logs-report/utils/prerender-citability.js';

const sug = (data, status = 'NEW') => ({ status, data });

describe('prerender-citability util', () => {
  describe('normalizePath', () => {
    it('returns falsy input unchanged', () => {
      expect(normalizePath('')).to.equal('');
      expect(normalizePath(undefined)).to.equal(undefined);
    });

    it('extracts the pathname from a full URL and strips trailing slashes', () => {
      expect(normalizePath('https://www.example.com/a/b/')).to.equal('/a/b');
      expect(normalizePath('https://www.example.com/')).to.equal('/');
    });

    it('treats a bare path as-is and strips trailing slash + null bytes', () => {
      expect(normalizePath('/a/b/')).to.equal('/a/b');
      expect(normalizePath('/a\0b')).to.equal('/ab');
      expect(normalizePath('/')).to.equal('/');
    });
  });

  describe('getLlmVisibilityScore', () => {
    it('returns 100 when deployed or covered', () => {
      expect(getLlmVisibilityScore({ isDeployed: true })).to.equal(100);
      expect(getLlmVisibilityScore({ coveredByDomainWide: true })).to.equal(100);
      expect(getLlmVisibilityScore({ coveredByPattern: true })).to.equal(100);
    });

    it('computes the capped, floored word-count ratio otherwise', () => {
      expect(getLlmVisibilityScore({ wordCountBefore: 30, wordCountAfter: 120 })).to.equal(25);
      expect(getLlmVisibilityScore({ wordCountBefore: 200, wordCountAfter: 100 })).to.equal(100);
      expect(getLlmVisibilityScore({ wordCountBefore: -5, wordCountAfter: 100 })).to.equal(0);
      expect(getLlmVisibilityScore({ wordCountBefore: 1, wordCountAfter: 0 })).to.equal(0);
      expect(getLlmVisibilityScore({})).to.equal(0);
    });
  });

  describe('buildPrerenderCitabilityMap', () => {
    it('returns an empty map with no inputs', () => {
      expect(buildPrerenderCitabilityMap().size).to.equal(0);
    });

    it('scores suggestions by word-count ratio and flags deployed/covered as 100', () => {
      const map = buildPrerenderCitabilityMap({
        suggestions: [
          sug({ url: 'https://e.com/ratio', wordCountBefore: 30, wordCountAfter: 120 }),
          sug({ url: 'https://e.com/edge', edgeDeployed: 'ts' }),
          sug({ url: 'https://e.com/pattern', coveredByPattern: 'p' }),
          sug({ url: 'https://e.com/fixed', wordCountBefore: 1, wordCountAfter: 9 }, 'FIXED'),
        ],
      });
      expect(map.get('/ratio')).to.deep.equal({ score: 25, deployedAtEdge: false });
      expect(map.get('/edge')).to.deep.equal({ score: 100, deployedAtEdge: true });
      expect(map.get('/pattern')).to.deep.equal({ score: 100, deployedAtEdge: true });
      expect(map.get('/fixed')).to.deep.equal({ score: 100, deployedAtEdge: true });
    });

    it('excludes non-active statuses and invalid suggestions', () => {
      const map = buildPrerenderCitabilityMap({
        suggestions: [
          sug({ url: 'https://e.com/outdated', wordCountBefore: 5, wordCountAfter: 10 }, 'OUTDATED'),
          sug({ url: 'https://e.com/dw', isDomainWide: true, edgeDeployed: 'x' }),
          sug({ wordCountBefore: 5, wordCountAfter: 10 }),
          sug({ url: 'https://e.com/nodata', wordCountAfter: 0 }),
        ],
      });
      expect(map.size).to.equal(0);
    });

    it('does not blanket-cover URLs just because a domain-wide suggestion exists', () => {
      const map = buildPrerenderCitabilityMap({
        suggestions: [
          sug({ isDomainWide: true, allowedRegexPatterns: ['/*'], edgeDeployed: 'x' }),
          // own coveredByDomainWide ⇒ 100; the other keeps its ratio.
          sug({ url: 'https://e.com/covered', coveredByDomainWide: 'true' }),
          sug({ url: 'https://e.com/uncovered', wordCountBefore: 10, wordCountAfter: 100 }),
        ],
      });
      expect(map.get('/covered')).to.deep.equal({ score: 100, deployedAtEdge: true });
      expect(map.get('/uncovered')).to.deep.equal({ score: 10, deployedAtEdge: false });
    });

    it('folds status.json edge-deployed pages into the suggestion score', () => {
      const map = buildPrerenderCitabilityMap({
        suggestions: [
          sug({ url: 'https://e.com/a', wordCountBefore: 10, wordCountAfter: 100 }),
        ],
        statusJson: {
          pages: [{ url: 'https://e.com/a', isDeployedAtEdge: true, needsPrerender: true }],
        },
      });
      expect(map.get('/a')).to.deep.equal({ score: 100, deployedAtEdge: true });
    });

    it('scores already-optimised status.json pages 100 and skips url-less pages', () => {
      const map = buildPrerenderCitabilityMap({
        statusJson: {
          pages: [
            { url: 'https://e.com/opt', needsPrerender: false, scrapingStatus: 'success' },
            { needsPrerender: false, scrapingStatus: 'success' },
            { url: 'https://e.com/failed', needsPrerender: false, scrapingStatus: 'error' },
          ],
        },
      });
      expect(map.get('/opt')).to.deep.equal({ score: 100, deployedAtEdge: false });
      expect(map.has('/failed')).to.equal(false);
      expect(map.size).to.equal(1);
    });

    it('preserves an existing deployed flag when a page is also already-optimised', () => {
      const map = buildPrerenderCitabilityMap({
        suggestions: [sug({ url: 'https://e.com/a', coveredByPattern: 'p' })],
        statusJson: {
          pages: [{ url: 'https://e.com/a', needsPrerender: false, scrapingStatus: 'success' }],
        },
      });
      expect(map.get('/a')).to.deep.equal({ score: 100, deployedAtEdge: true });
    });
  });
});
