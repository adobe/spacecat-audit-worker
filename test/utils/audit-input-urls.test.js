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
} from '../../src/utils/audit-input-urls.js';

describe('audit-input-urls', () => {
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
        'https://example.com/agentic',
        'https://example.com/included',
      ]);
    });

    it('should handle null Ahrefs results when topOrganicLimit is provided', async () => {
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

    it('should handle null Ahrefs results when topOrganicLimit is not provided', async () => {
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
  });
});
