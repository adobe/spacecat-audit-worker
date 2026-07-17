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
 * Behavioural contracts: site-scope protection
 *
 * SCRAPING SCOPE:
 *   - CSV urls (auditContext.urls), organic top pages, included URLs, and agentic
 *     URLs are all merged and passed through a single filterBySiteScope() call
 *     keyed on site.getBaseURL() before being handed to the scraper — regardless
 *     of source, a URL outside that scope never reaches submitForScraping's output.
 *   - This holds even when a subpath tenant (e.g. bulk.com/uk) shares its
 *     analytics data source with a sibling tenant on the same domain
 *     (e.g. bulk.com/fr): each tenant's audit only ever submits its own subpath.
 *
 * DOMAIN-WIDE SUGGESTION SCOPE:
 *   - The synthetic "domain-wide" suggestion's pathPattern/allowedRegexPatterns are
 *     derived from site.getBaseURL(), so a subpath tenant gets a subpath-scoped
 *     pattern (e.g. /uk/*) instead of the unscoped /* pattern that would also
 *     cover sibling tenants on the same domain.
 */

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';
import { submitForScraping } from '../../../../src/prerender/handler.js';
import { DOMAIN_WIDE_SUGGESTION_KEY } from '../../../../src/prerender/utils/constants.js';
import {
  buildContext,
  buildSite,
  buildDataAccess,
} from './helpers.js';

use(sinonChai);

/**
 * Minimal matcher for the "/segment/*" / "/*" glob patterns handler.js produces —
 * just enough to prove a subpath tenant's pattern can't also match a sibling
 * tenant's path on the same domain.
 */
function patternMatchesPath(pattern, path) {
  if (pattern === '/*') {
    return true;
  }
  const prefix = pattern.slice(0, -1); // strip trailing '*', keep trailing '/'
  return path.startsWith(prefix);
}

/** Runs processOpportunityAndSuggestions and returns the domain-wide suggestion's data. */
async function getDomainWideSuggestionData(sandbox, { siteBaseUrl, prerenderUrl }) {
  const mockOpportunity = {
    getId: () => 'test-opp-id',
    getSuggestions: sandbox.stub().resolves([]),
  };
  const syncSuggestionsStub = sandbox.stub().resolves();

  const mockHandler = await esmock('../../../../src/prerender/handler.js', {
    '../../../../src/common/opportunity.js': {
      convertToOpportunity: sandbox.stub().resolves(mockOpportunity),
    },
    '../../../../src/utils/data-access.js': {
      syncSuggestions: syncSuggestionsStub,
    },
  });

  const auditData = {
    siteId: 'test-site',
    auditId: 'audit-123',
    scrapeJobId: 'job-123',
    auditResult: {
      urlsNeedingPrerender: 1,
      results: [{
        url: prerenderUrl,
        needsPrerender: true,
        contentGainRatio: 2.0,
        wordCountBefore: 100,
        wordCountAfter: 200,
      }],
    },
  };

  const context = {
    log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
    dataAccess: {
      Suggestion: {
        STATUSES: {
          NEW: 'NEW', FIXED: 'FIXED', PENDING_VALIDATION: 'PENDING_VALIDATION', SKIPPED: 'SKIPPED',
        },
      },
    },
    site: { getId: () => 'test-site-id', getBaseURL: () => siteBaseUrl },
  };

  await mockHandler.processOpportunityAndSuggestions(siteBaseUrl, auditData, context);

  expect(syncSuggestionsStub).to.have.been.calledOnce;
  const { newData } = syncSuggestionsStub.firstCall.args[0];
  const domainWideSuggestion = newData.find((s) => s.key === DOMAIN_WIDE_SUGGESTION_KEY);
  expect(domainWideSuggestion, 'expected a domain-wide aggregate suggestion').to.exist;
  return domainWideSuggestion.data;
}

describe('Prerender behaviour — site-scope protection', () => {
  let sandbox;

  beforeEach(() => { sandbox = sinon.createSandbox(); });
  afterEach(() => { sandbox.restore(); });

  describe('scraping stays within site scope', () => {
    it('merges organic, included, and agentic candidates and drops every source\'s out-of-scope URLs', async () => {
      const mockHandler = await esmock('../../../../src/prerender/handler.js', {
        '../../../../src/utils/agentic-urls.js': {
          getTopAgenticLiveUrlsFromAthena: async () => [
            'https://bulk.com/uk/agentic-in',
            'https://bulk.com/fr/agentic-out',
          ],
          getPreferredBaseUrl: () => 'https://bulk.com/uk',
        },
      });

      const site = buildSite({ id: 'site-uk', baseUrl: 'https://bulk.com/uk' });
      site.getConfig = () => ({
        getIncludedURLs: () => Promise.resolve([
          'https://bulk.com/uk/included-in',
          'https://bulk.com/de/included-out',
        ]),
      });

      const context = buildContext(sandbox, {
        site,
        dataAccess: buildDataAccess(sandbox, {
          topPages: ['https://bulk.com/uk/organic-in', 'https://bulk.com/fr/organic-out'],
        }),
      });

      const result = await mockHandler.submitForScraping(context);
      const urls = result.urls.map((u) => u.url);

      expect(urls).to.include.members([
        'https://bulk.com/uk/organic-in',
        'https://bulk.com/uk/included-in',
        'https://bulk.com/uk/agentic-in',
      ]);
      expect(urls).to.not.include.members([
        'https://bulk.com/fr/organic-out',
        'https://bulk.com/de/included-out',
        'https://bulk.com/fr/agentic-out',
      ]);
    });

    it('filters explicit CSV URLs (auditContext.urls) to the site subpath', async () => {
      const context = buildContext(sandbox, {
        site: buildSite({ id: 'site-uk', baseUrl: 'https://bulk.com/uk' }),
        auditContext: {
          urls: [
            'https://bulk.com/uk/page-1',
            'https://bulk.com/fr/page-2',
            'https://bulk.com/uk/page-3',
          ],
        },
      });

      const result = await submitForScraping(context);
      const urls = result.urls.map((u) => u.url);

      expect(urls).to.have.members([
        'https://bulk.com/uk/page-1',
        'https://bulk.com/uk/page-3',
      ]);
    });

    it('same-domain tenants each only ever submit their own subpath, even off a shared top-pages data source', async () => {
      // Simulates two sites on the same domain (bulk.com/uk and bulk.com/fr) whose
      // analytics-derived top-pages data source returns URLs for both subpaths.
      const sharedTopPages = [
        'https://bulk.com/uk/organic-1',
        'https://bulk.com/fr/organic-2',
      ];

      const ukContext = buildContext(sandbox, {
        site: buildSite({ id: 'site-uk', baseUrl: 'https://bulk.com/uk' }),
        dataAccess: buildDataAccess(sandbox, { topPages: sharedTopPages }),
      });
      const frContext = buildContext(sandbox, {
        site: buildSite({ id: 'site-fr', baseUrl: 'https://bulk.com/fr' }),
        dataAccess: buildDataAccess(sandbox, { topPages: sharedTopPages }),
      });

      const ukResult = await submitForScraping(ukContext);
      const frResult = await submitForScraping(frContext);

      expect(ukResult.urls.map((u) => u.url)).to.deep.equal(['https://bulk.com/uk/organic-1']);
      expect(frResult.urls.map((u) => u.url)).to.deep.equal(['https://bulk.com/fr/organic-2']);
    });
  });

  describe('domain-wide suggestion honors site.baseUrl scope', () => {
    it('scopes the domain-wide suggestion to the tenant subpath, not the whole domain', async () => {
      const data = await getDomainWideSuggestionData(sandbox, {
        siteBaseUrl: 'https://bulk.com/uk',
        prerenderUrl: 'https://bulk.com/uk/page-1',
      });

      expect(data.isDomainWide).to.be.true;
      expect(data.pathPattern).to.equal('/uk/*');
      expect(data.allowedRegexPatterns).to.deep.equal(['/uk/*']);
      expect(data.url).to.equal('https://bulk.com/uk/* (All Subpath URLs)');
    });

    it('two same-domain tenants get patterns that never match each other\'s paths', async () => {
      const ukData = await getDomainWideSuggestionData(sandbox, {
        siteBaseUrl: 'https://bulk.com/uk',
        prerenderUrl: 'https://bulk.com/uk/page-1',
      });
      const frData = await getDomainWideSuggestionData(sandbox, {
        siteBaseUrl: 'https://bulk.com/fr',
        prerenderUrl: 'https://bulk.com/fr/page-1',
      });

      // Each tenant's pattern matches its own subpath...
      expect(patternMatchesPath(ukData.pathPattern, '/uk/page-2')).to.be.true;
      expect(patternMatchesPath(frData.pathPattern, '/fr/page-2')).to.be.true;

      // ...but never the sibling tenant's subpath on the same domain.
      expect(patternMatchesPath(ukData.pathPattern, '/fr/page-2')).to.be.false;
      expect(patternMatchesPath(frData.pathPattern, '/uk/page-2')).to.be.false;
    });
  });
});
