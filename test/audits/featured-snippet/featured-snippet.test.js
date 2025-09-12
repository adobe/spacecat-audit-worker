/*
 * Copyright 2925 Adobe. All rights reserved.
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
import { expect, use } from 'chai';
import sinonChai from 'sinon-chai';
import sinon from 'sinon';
import esmock from 'esmock';

import { importTopPages, importFeaturedSnippets, opportunityAndSuggestions } from '../../../src/featured-snippet/handler.js';
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);

const sandbox = sinon.createSandbox();
const message = {
  type: 'featured-snippet',
  url: 'https://www.example.com',
};

const createPageStub = (url, topKeyword) => ({
  getUrl: () => url,
  getTopKeyword: () => topKeyword,
});

describe('Featured Snippet Audit', () => {
  let context;
  let siteStub;
  let getStoredMetricsStub;
  let handlerModule;
  let auditStub;
  const finalUrl = 'https://www.example.com';

  beforeEach(async () => {
    getStoredMetricsStub = sinon.stub();

    handlerModule = await esmock('../../../src/featured-snippet/handler.js', {
      '@adobe/spacecat-shared-utils': {
        getStoredMetrics: getStoredMetricsStub,
      },
    });

    siteStub = {
      getId: () => '123',
    };

    auditStub = {
      getId: () => 'audit-id',
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        log: {
          info: sinon.stub(),
          warn: sinon.stub(),
          error: sinon.stub(),
          debug: sinon.spy(),
        },
        site: siteStub,
        audit: auditStub,
        finalUrl,
      })
      .build(message);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('importTopPages', () => {
    it('sends import top pages event', async () => {
      const result = await importTopPages(context);
      expect(result).to.deep.equal({
        type: 'top-pages',
        siteId: '123',
        auditResult: {
          status: 'preparing',
          finalUrl,
        },
        fullAuditRef: 'scrapes/123/',
        finalUrl,
      });
    });
  });

  describe('importFeaturedSnippets', () => {
    it('sends import featured snippets event', async () => {
      const result = await importFeaturedSnippets(context);
      expect(result).to.deep.equal({
        type: 'organic-keywords-feature-snippets',
        siteId: '123',
        auditResult: { results: [] },
        fullAuditRef: finalUrl,
      });
    });
  });

  describe('runAuditAndGenerateSuggestions', () => {
    it('runs a full audit', async () => {
      getStoredMetricsStub.resolves([
        {
          url: 'https://example.com/page1',
          keyword: 'test keyword',
          cpc: 50,
          volume: 600,
          isInformational: true,
          traffic: 1000,
          position: 5,
        },
      ]);

      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sinon.stub().resolves([
        createPageStub('https://example.com/page1', 'test keyword'),
      ]);

      context.dataAccess.Opportunity.allBySiteIdAndStatus = sinon.stub().resolves([]);
      context.dataAccess.Opportunity.create = sinon.stub().resolves({
        getId: () => 'opportunity-id',
        getType: () => 'featured-snippet',
        getSuggestions: sinon.stub().resolves([]),
        addSuggestions: sinon.stub().resolves({
          createdItems: [
            {
              type: 'url',
              url: 'https://example.com/page1',
              errors: [],
            },
          ],
        }),
      });

      const result = await handlerModule.runAuditAndGenerateSuggestions(context);

      expect(result).to.deep.equal({
        fullAuditRef: finalUrl,
        auditResult: {
          results: [
            {
              url: 'https://example.com/page1',
              keyword: 'test keyword',
              cpc: 50,
              volume: 600,
              isInformational: true,
              traffic: 1000,
              position: 5,
              hasTopPage: true,
              topKeyword: 'test keyword',
              suggestion: 'Further optimize the content of this page for search requests related to "test keyword".',
            },
          ],
          success: true,
        },
      });
    });

    it('fails because of an exception', async () => {
      getStoredMetricsStub.rejects(new Error('test error'));

      const result = await handlerModule.runAuditAndGenerateSuggestions(context);

      expect(result).to.deep.equal({
        fullAuditRef: finalUrl,
        auditResult: {
          error: 'test error',
          success: false,
        },
      });
    });
  });

  describe('opportunityAndSuggestions', () => {
    it('adds suggestions to the audit data', async () => {
      const mockMetrics = [
        {
          url: 'https://example.com/page1',
          keyword: 'example keyword',
        },
        {
          url: 'https://example.com/page2',
          keyword: 'another keyword',
        },
      ];

      const result = await opportunityAndSuggestions(context, mockMetrics);

      expect(result).to.deep.equal([
        {
          url: 'https://example.com/page1',
          keyword: 'example keyword',
          suggestion: 'Further optimize the content of this page for search requests related to "example keyword".',
        },
        {
          url: 'https://example.com/page2',
          keyword: 'another keyword',
          suggestion: 'Further optimize the content of this page for search requests related to "another keyword".',
        },
      ]);
    });

    it('handles empty metrics array', async () => {
      const result = await opportunityAndSuggestions(context, []);
      expect(result).to.deep.equal([]);
    });
  });

  describe('detectFeaturedSnippet', () => {
    it('returns an empty array if no featured snippets data is found', async () => {
      getStoredMetricsStub.resolves([]);

      const result = await handlerModule.detectFeaturedSnippet(context);

      expect(result).to.deep.equal([]);
      expect(getStoredMetricsStub).to.have.been.calledOnce;
    });

    it('returns an empty array if no top pages are found', async () => {
      getStoredMetricsStub.resolves([
        {
          url: 'https://example.com/page1',
          keyword: 'test keyword',
        },
      ]);
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sinon.stub().resolves([]);

      const result = await handlerModule.detectFeaturedSnippet(context);

      expect(result).to.deep.equal([]);
      expect(getStoredMetricsStub).to.have.been.calledOnce;
      expect(context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo).to.have.been.calledOnce;
    });

    it('ignores metrics that do not have a top page', async () => {
      getStoredMetricsStub.resolves([
        {
          url: 'https://example.com/page1',
          keyword: 'test keyword 1',
          cpc: 50,
          volume: 600,
          isInformational: true,
        },
        {
          url: 'https://example.com/page2',
          keyword: 'test keyword 2',
          cpc: 50,
          volume: 600,
          isInformational: true,
        },
        {
          url: 'https://example.com/page3',
          keyword: 'test keyword 3',
          isInformational: true,
        },
      ]);

      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sinon.stub().resolves([
        createPageStub('https://example.com/page1', 'test keyword 1'),
        // page2 is missing from top pages
      ]);

      const result = await handlerModule.detectFeaturedSnippet(context);

      expect(result).to.deep.equal([
        {
          url: 'https://example.com/page1',
          keyword: 'test keyword 1',
          cpc: 50,
          volume: 600,
          isInformational: true,
          hasTopPage: true,
          traffic: 0,
          topKeyword: 'test keyword 1',
        },
      ]);
    });

    it('ignores metrics that do not meet informational volume condition', async () => {
      getStoredMetricsStub.resolves([
        {
          url: 'https://example.com/page1',
          keyword: 'test keyword',
          cpc: 50, // Low CPC
          volume: 300, // Low volume (below 500 threshold for informational)
          isInformational: true,
        },
      ]);

      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sinon.stub().resolves([
        createPageStub('https://example.com/page1', 'test keyword'),
      ]);

      const result = await handlerModule.detectFeaturedSnippet(context);

      expect(result).to.deep.equal([]);
    });

    it('ignores metrics that do not meet commercial/transactional volume condition', async () => {
      getStoredMetricsStub.resolves([
        {
          url: 'https://example.com/page1',
          keyword: 'test keyword',
          cpc: 150, // High CPC
          volume: 100, // Low volume (below 200 threshold for commercial/transactional)
          isCommercial: true,
        },
      ]);

      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sinon.stub().resolves([
        createPageStub('https://example.com/page1', 'test keyword'),
      ]);

      const result = await handlerModule.detectFeaturedSnippet(context);

      expect(result).to.deep.equal([]);
    });

    it('ignores metrics that are not the top keyword for a page', async () => {
      getStoredMetricsStub.resolves([
        {
          url: 'https://example.com/page1',
          keyword: 'different keyword', // Different from top keyword
          cpc: 50,
          volume: 600,
          isInformational: true,
        },
      ]);

      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sinon.stub().resolves([
        createPageStub('https://example.com/page1', 'top keyword'),
      ]);

      const result = await handlerModule.detectFeaturedSnippet(context);

      expect(result).to.deep.equal([]);
    });

    it('removes duplicate metrics', async () => {
      getStoredMetricsStub.resolves([
        {
          url: 'https://example.com/page1',
          keyword: 'keyword 1',
          cpc: 50,
          volume: 600,
          isInformational: true,
        },
        {
          url: 'https://example.com/page1',
          keyword: 'keyword 1',
          cpc: 75,
          volume: 800,
          isInformational: true,
        },
      ]);

      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sinon.stub().resolves([
        createPageStub('https://example.com/page1', 'keyword 1'),
      ]);

      const result = await handlerModule.detectFeaturedSnippet(context);

      expect(result).to.have.length(1);
      expect(result.map((r) => r.url)).to.deep.equal([
        'https://example.com/page1',
      ]);
    });
  });
});
