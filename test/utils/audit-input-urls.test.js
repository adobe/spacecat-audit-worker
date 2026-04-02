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
  });
});
