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

import { expect } from 'chai';
import {
  getMergedAuditInputUrls,
  mergeAndGetUniqueHtmlUrls,
  sortTopPagesByTraffic,
} from '../../src/utils/audit-input-urls.js';

describe('audit-input-urls', () => {
  describe('sortTopPagesByTraffic', () => {
    it('should normalize top pages and sort them by traffic descending', () => {
      const result = sortTopPagesByTraffic([
        { getUrl: () => 'https://example.com/low', getTraffic: () => 10 },
        { getUrl: () => 'https://example.com/high', getTraffic: () => 100 },
        { getUrl: () => 'https://example.com/missing' },
      ]);

      expect(result).to.deep.equal([
        { url: 'https://example.com/high', traffic: 100 },
        { url: 'https://example.com/low', traffic: 10 },
        { url: 'https://example.com/missing', traffic: 0 },
      ]);
    });

    it('should include extra mapped fields when requested', () => {
      const result = sortTopPagesByTraffic(
        [
          {
            getUrl: () => 'https://example.com/page',
            getTraffic: () => 50,
            getId: () => 'page-1',
          },
        ],
        (page) => ({
          urlId: page.getId(),
        }),
      );

      expect(result).to.deep.equal([
        {
          url: 'https://example.com/page',
          traffic: 50,
          urlId: 'page-1',
        },
      ]);
    });
  });

  describe('mergeAndGetUniqueHtmlUrls', () => {
    it('should merge unique HTML URLs and filter non-HTML URLs', () => {
      const result = mergeAndGetUniqueHtmlUrls(
        ['https://example.com/page', 'https://example.com/file.pdf'],
        ['https://www.example.com/page/', 'https://example.com/other'],
      );

      expect(result).to.deep.equal({
        urls: [
          'https://example.com/page',
          'https://example.com/other',
        ],
        filteredCount: 1,
      });
    });

    it('should not treat dots in directory names as file extensions', () => {
      const result = mergeAndGetUniqueHtmlUrls([
        'https://example.com/path.to/file',
        'https://example.com/assets/document.pdf',
      ]);

      expect(result).to.deep.equal({
        urls: ['https://example.com/path.to/file'],
        filteredCount: 1,
      });
    });

    it('should keep invalid URLs as-is', () => {
      const result = mergeAndGetUniqueHtmlUrls([
        'not-a-valid-url',
        'https://example.com/page',
      ]);

      expect(result).to.deep.equal({
        urls: [
          'not-a-valid-url',
          'https://example.com/page',
        ],
        filteredCount: 0,
      });
    });
  });

  describe('getMergedAuditInputUrls', () => {
    it('should handle missing dataAccess and still merge agentic and included URLs', async () => {
      const site = {
        getId: () => 'site-123',
        getConfig: () => ({
          getIncludedURLs: () => ['https://example.com/included'],
        }),
      };

      const result = await getMergedAuditInputUrls({
        site,
        auditType: 'summarization',
        getAgenticUrls: async () => ['https://example.com/agentic'],
      });

      expect(result.topPages).to.deep.equal([]);
      expect(result.topPagesUrls).to.deep.equal([]);
      expect(result.agenticUrls).to.deep.equal(['https://example.com/agentic']);
      expect(result.includedURLs).to.deep.equal(['https://example.com/included']);
      expect(result.urls).to.deep.equal([
        'https://example.com/included',
        'https://example.com/agentic',
      ]);
    });

    it('should handle null SEO results when topOrganicLimit is provided', async () => {
      const site = {
        getId: () => 'site-123',
        getConfig: async () => null,
      };
      const dataAccess = {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: async () => null,
        },
      };

      const result = await getMergedAuditInputUrls({
        site,
        dataAccess,
        auditType: 'readability',
        getAgenticUrls: async () => [],
        topOrganicLimit: 10,
      });

      expect(result.topPages).to.deep.equal([]);
      expect(result.topPagesUrls).to.deep.equal([]);
      expect(result.includedURLs).to.deep.equal([]);
      expect(result.urls).to.deep.equal([]);
      expect(result.filteredCount).to.equal(0);
    });

    it('should handle null SEO results when topOrganicLimit is not provided', async () => {
      const site = {
        getId: () => 'site-123',
        getConfig: async () => null,
      };
      const dataAccess = {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: async () => null,
        },
      };

      const result = await getMergedAuditInputUrls({
        site,
        dataAccess,
        auditType: 'readability',
        getAgenticUrls: async () => [],
      });

      expect(result.topPages).to.deep.equal([]);
      expect(result.topPagesUrls).to.deep.equal([]);
      expect(result.includedURLs).to.deep.equal([]);
      expect(result.urls).to.deep.equal([]);
      expect(result.filteredCount).to.equal(0);
    });

    it('should use provided topPages promise without calling dataAccess', async () => {
      const site = {
        getId: () => 'site-123',
        getConfig: async () => null,
      };
      const dataAccess = {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: () => {
            throw new Error('should not be called');
          },
        },
      };
      const topPages = Promise.resolve([
        { url: 'https://example.com/page2', traffic: 50, urlId: 'p2' },
        { url: 'https://example.com/page1', traffic: 100, urlId: 'p1' },
      ]);

      const result = await getMergedAuditInputUrls({
        site,
        dataAccess,
        auditType: 'readability',
        getAgenticUrls: async () => [],
        topPages,
      });

      expect(result.topPages).to.deep.equal([
        { url: 'https://example.com/page2', traffic: 50, urlId: 'p2' },
        { url: 'https://example.com/page1', traffic: 100, urlId: 'p1' },
      ]);
      expect(result.topPagesUrls).to.deep.equal([
        'https://example.com/page2',
        'https://example.com/page1',
      ]);
    });

    it('scopes top pages to the site sub-path while keeping included/agentic URLs', async () => {
      const site = {
        getId: () => 'site-123',
        getBaseURL: () => 'https://example.com/foo',
        getConfig: () => ({
          getIncludedURLs: () => ['https://example.com/bar/included'],
        }),
      };

      const result = await getMergedAuditInputUrls({
        site,
        auditType: 'readability',
        getAgenticUrls: async () => ['https://example.com/bar/agentic'],
        scopeTopPagesToBasePath: true,
        topPages: [
          { url: 'https://example.com/foo/in-scope', traffic: 100, urlId: 't1' },
          { url: 'https://example.com/bar/out-of-scope', traffic: 90, urlId: 't2' },
        ],
      });

      // Domain-keyed top pages are scoped to /foo; out-of-scope pages are dropped.
      expect(result.topPagesUrls).to.deep.equal(['https://example.com/foo/in-scope']);
      // Explicit included/agentic URLs are preserved even outside the sub-path.
      expect(result.urls).to.include.members([
        'https://example.com/foo/in-scope',
        'https://example.com/bar/included',
        'https://example.com/bar/agentic',
      ]);
      expect(result.urls).to.not.include('https://example.com/bar/out-of-scope');
    });

    it('scopes to the sub-path before applying topOrganicLimit', async () => {
      const site = {
        getId: () => 'site-123',
        getBaseURL: () => 'https://example.com/foo',
        getConfig: () => ({ getIncludedURLs: () => [] }),
      };

      // Two higher-traffic out-of-scope pages rank above the in-scope one; with a
      // limit of 2 a slice-then-scope order would drop the /foo page entirely.
      const result = await getMergedAuditInputUrls({
        site,
        auditType: 'readability',
        getAgenticUrls: async () => [],
        scopeTopPagesToBasePath: true,
        topOrganicLimit: 2,
        topPages: [
          { url: 'https://example.com/bar/a', traffic: 100, urlId: 't1' },
          { url: 'https://example.com/bar/b', traffic: 90, urlId: 't2' },
          { url: 'https://example.com/foo/c', traffic: 10, urlId: 't3' },
        ],
      });

      expect(result.topPagesUrls).to.deep.equal(['https://example.com/foo/c']);
    });

    it('does not scope top pages when scopeTopPagesToBasePath is off (default), even on a sub-path site', async () => {
      const site = {
        getId: () => 'site-123',
        getBaseURL: () => 'https://example.com/foo',
        getConfig: () => ({ getIncludedURLs: () => [] }),
      };

      // Flag omitted → defaults to false → out-of-scope top pages are retained.
      const result = await getMergedAuditInputUrls({
        site,
        auditType: 'readability',
        getAgenticUrls: async () => [],
        topPages: [
          { url: 'https://example.com/foo/in', traffic: 100, urlId: 't1' },
          { url: 'https://example.com/bar/out', traffic: 90, urlId: 't2' },
        ],
      });

      expect(result.topPagesUrls).to.include('https://example.com/foo/in');
      expect(result.topPagesUrls).to.include('https://example.com/bar/out');
    });

    it('should use provided getTopPages callback without calling dataAccess', async () => {
      const site = {
        getId: () => 'site-123',
        getConfig: async () => null,
      };
      const dataAccess = {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: () => {
            throw new Error('should not be called');
          },
        },
      };

      const result = await getMergedAuditInputUrls({
        site,
        dataAccess,
        auditType: 'readability',
        getAgenticUrls: async () => [],
        getTopPages: async () => [
          { url: 'https://example.com/callback-page', traffic: 200, urlId: 'cb1' },
        ],
      });

      expect(result.topPages).to.deep.equal([
        { url: 'https://example.com/callback-page', traffic: 200, urlId: 'cb1' },
      ]);
      expect(result.topPagesUrls).to.deep.equal([
        'https://example.com/callback-page',
      ]);
    });

    it('should map top page models with getUrl by default', async () => {
      const site = {
        getId: () => 'site-123',
        getConfig: async () => null,
      };

      const result = await getMergedAuditInputUrls({
        site,
        auditType: 'summarization',
        getAgenticUrls: async () => [],
        topPages: [
          { getUrl: () => 'https://example.com/model-page' },
        ],
      });

      expect(result.topPagesUrls).to.deep.equal([
        'https://example.com/model-page',
      ]);
      expect(result.urls).to.deep.equal([
        'https://example.com/model-page',
      ]);
    });

    it('should merge auditTargetURLs with highest priority', async () => {
      const site = {
        getId: () => 'site-123',
        getConfig: () => ({
          getIncludedURLs: () => ['https://example.com/included'],
          getAuditTargetURLs: () => [
            { url: 'https://example.com/custom1' },
            { url: 'https://example.com/custom2' },
          ],
        }),
      };

      const result = await getMergedAuditInputUrls({
        site,
        auditType: 'summarization',
        getAgenticUrls: async () => ['https://example.com/agentic'],
      });

      expect(result.auditTargetUrls).to.deep.equal([
        'https://example.com/custom1',
        'https://example.com/custom2',
      ]);
      expect(result.urls[0]).to.equal('https://example.com/custom1');
      expect(result.urls[1]).to.equal('https://example.com/custom2');
      expect(result.urls).to.include('https://example.com/included');
      expect(result.urls).to.include('https://example.com/agentic');
    });

    it('should deduplicate auditTargetURLs against other sources', async () => {
      const site = {
        getId: () => 'site-123',
        getConfig: () => ({
          getIncludedURLs: () => ['https://example.com/overlap'],
          getAuditTargetURLs: () => [
            { url: 'https://example.com/overlap' },
            { url: 'https://example.com/unique-custom' },
          ],
        }),
      };

      const result = await getMergedAuditInputUrls({
        site,
        auditType: 'summarization',
        getAgenticUrls: async () => [],
      });

      const overlapCount = result.urls.filter((u) => u === 'https://example.com/overlap').length;
      expect(overlapCount).to.equal(1);
      expect(result.urls[0]).to.equal('https://example.com/overlap');
      expect(result.urls).to.include('https://example.com/unique-custom');
    });

    it('should return empty auditTargetUrls when config has none', async () => {
      const site = {
        getId: () => 'site-123',
        getConfig: () => ({
          getIncludedURLs: () => [],
        }),
      };

      const result = await getMergedAuditInputUrls({
        site,
        auditType: 'summarization',
        getAgenticUrls: async () => [],
      });

      expect(result.auditTargetUrls).to.deep.equal([]);
    });

    it('should handle getAuditTargetURLs returning entries without url field', async () => {
      const site = {
        getId: () => 'site-123',
        getConfig: () => ({
          getIncludedURLs: () => [],
          getAuditTargetURLs: () => [
            { url: 'https://example.com/valid' },
            { source: 'manual' },
            { url: '' },
          ],
        }),
      };

      const result = await getMergedAuditInputUrls({
        site,
        auditType: 'summarization',
        getAgenticUrls: async () => [],
      });

      expect(result.auditTargetUrls).to.deep.equal(['https://example.com/valid']);
    });
  });
});
