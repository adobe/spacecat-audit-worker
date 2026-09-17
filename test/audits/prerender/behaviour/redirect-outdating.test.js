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
 * Behavior tests for LLMO-6423: URLs that redirect should have their existing
 * prerender suggestion marked OUTDATED, since the audit can no longer verify the
 * content diff against a URL that no longer resolves with a 200.
 *
 * handleOutdatedSuggestions (src/utils/data-access.js) only outdates a suggestion
 * if its URL is present in scrapedUrlsSet (the "was this URL actually examined this
 * run" coverage guard). These tests confirm: (a) a redirected URL absent from
 * scrapedUrlsSet is NOT outdated (the pre-fix gap), (b) once unioned into
 * scrapedUrlsSet it IS outdated, and (c) processContentAndGenerateOpportunities
 * performs that union end-to-end via getScrapeJobStats' redirectedUrls.
 */

import esmock from 'esmock';
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { Suggestion } from '@adobe/spacecat-shared-data-access';

use(sinonChai);

const BASE_URL = 'https://example.com';

function makeUrlSuggestion(id, url, initialStatus, extraData = {}) {
  let currentStatus = initialStatus;
  return {
    getId: () => id,
    getStatus: () => currentStatus,
    setStatus: sinon.stub().callsFake((s) => { currentStatus = s; }),
    setUpdatedBy: sinon.stub(),
    getData: sinon.stub().returns({ url, isDomainWide: false, ...extraData }),
    setData: sinon.stub(),
  };
}

/**
 * Runs processOpportunityAndSuggestions directly. auditResult hits /page1 only;
 * scrapedUrlsSet is caller-controlled so each test can isolate the coverage guard.
 */
async function runAudit(sandbox, existingSuggestions, scrapedUrlsSet) {
  const bulkUpdateStatusStub = sandbox.stub().resolves();

  const mockOpportunity = {
    getId: () => 'test-opp-id',
    getSiteId: () => 'test-site-id',
    getType: () => 'prerender',
    getSuggestions: sandbox.stub().resolves(existingSuggestions),
    addSuggestions: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
  };

  const handler = await esmock('../../../../src/prerender/handler.js', {
    '../../../../src/common/opportunity.js': {
      convertToOpportunity: sandbox.stub().resolves(mockOpportunity),
    },
  });

  const auditData = {
    siteId: 'test-site',
    auditId: 'audit-123',
    scrapeJobId: 'job-123',
    auditResult: {
      urlsNeedingPrerender: 1,
      results: [{
        url: `${BASE_URL}/page1`,
        needsPrerender: true,
        contentGainRatio: 2.0,
        wordCountBefore: 100,
        wordCountAfter: 200,
      }],
    },
    scrapedUrlsSet,
  };

  const context = {
    log: {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    },
    dataAccess: {
      Suggestion: {
        saveMany: sandbox.stub().resolves(),
        bulkUpdateStatus: bulkUpdateStatusStub,
        STATUSES: Suggestion.STATUSES,
      },
      SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
    },
    site: {
      getId: () => 'test-site-id',
      getBaseURL: () => BASE_URL,
      requiresValidation: false,
    },
  };

  await handler.processOpportunityAndSuggestions(BASE_URL, auditData, context, true);

  return { bulkUpdateStatusStub };
}

describe('Prerender redirect-outdating behaviour (LLMO-6423)', () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => sandbox.restore());

  it('redirected URL absent from scrapedUrlsSet is NOT outdated (pre-fix gap, coverage guard blocks it)', async function test() {
    this.timeout(10000);
    const redirected = makeUrlSuggestion(
      'sug-redirected',
      `${BASE_URL}/redirected-page`,
      Suggestion.STATUSES.NEW,
    );

    // scrapedUrlsSet only contains page1 — redirected-page was never unioned in.
    const { bulkUpdateStatusStub } = await runAudit(
      sandbox,
      [redirected],
      new Set([`${BASE_URL}/page1`]),
    );

    if (bulkUpdateStatusStub.called) {
      const outdatedCandidates = bulkUpdateStatusStub.args.flat(2);
      expect(outdatedCandidates).not.to.include(redirected);
    }
  });

  it('redirected URL unioned into scrapedUrlsSet IS marked OUTDATED', async function test() {
    this.timeout(10000);
    const redirected = makeUrlSuggestion(
      'sug-redirected',
      `${BASE_URL}/redirected-page`,
      Suggestion.STATUSES.NEW,
    );

    // scrapedUrlsSet includes redirected-page, simulating the getScrapeJobStats union (§3).
    const { bulkUpdateStatusStub } = await runAudit(
      sandbox,
      [redirected],
      new Set([`${BASE_URL}/page1`, `${BASE_URL}/redirected-page`]),
    );

    expect(bulkUpdateStatusStub).to.have.been.called;
    const outdatedCandidates = bulkUpdateStatusStub.firstCall.args[0];
    expect(outdatedCandidates).to.include(redirected);
    expect(bulkUpdateStatusStub.firstCall.args[1]).to.equal(Suggestion.STATUSES.OUTDATED);
  });

  it('edgeDeployed suggestion for a redirected URL is still protected even when unioned into scrapedUrlsSet', async function test() {
    this.timeout(10000);
    const deployedRedirected = makeUrlSuggestion(
      'sug-deployed-redirected',
      `${BASE_URL}/redirected-page`,
      Suggestion.STATUSES.NEW,
      { edgeDeployed: Date.now() },
    );

    const { bulkUpdateStatusStub } = await runAudit(
      sandbox,
      [deployedRedirected],
      new Set([`${BASE_URL}/page1`, `${BASE_URL}/redirected-page`]),
    );

    const outdatedCandidates = bulkUpdateStatusStub.args.flat(2);
    expect(outdatedCandidates).not.to.include(deployedRedirected);
  });

  describe('processContentAndGenerateOpportunities integration', () => {
    // HTML pair that produces contentGainRatio > threshold so page1 registers needsPrerender.
    const serverHtml = '<html><body><p>Short</p></body></html>';
    const clientHtml = '<html><body><p>Short</p><p>Much more dynamic content loaded by JavaScript making the page significantly longer than the server-side render and pushing the content gain ratio well above the threshold</p></body></html>';

    it('outdates the existing suggestion for a URL whose ScrapeUrl status is REDIRECT', async function test() {
      this.timeout(10000);
      const knownUrl = `${BASE_URL}/page1`;
      const redirectedUrl = `${BASE_URL}/redirected-page`;

      const allScrapeUrls = [
        { getUrl: () => knownUrl, getStatus: () => 'COMPLETE' },
        { getUrl: () => redirectedUrl, getStatus: () => 'REDIRECT' },
      ];

      const redirectedSuggestion = makeUrlSuggestion(
        'sug-redirected',
        redirectedUrl,
        Suggestion.STATUSES.NEW,
      );

      const bulkUpdateStatusStub = sandbox.stub().resolves();
      const mockOpportunity = {
        getId: () => 'opp-1',
        getSiteId: () => 'test-site-id',
        getType: () => 'prerender',
        getSuggestions: sandbox.stub().resolves([redirectedSuggestion]),
        addSuggestions: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
      };

      const mockHandler = await esmock('../../../../src/prerender/handler.js', {
        '../../../../src/common/opportunity.js': {
          convertToOpportunity: sandbox.stub().resolves(mockOpportunity),
        },
      });

      const context = {
        site: { getId: () => 'test-site-id', getBaseURL: () => BASE_URL },
        audit: {
          getId: () => 'audit-1',
          getFullAuditRef: () => 'ref',
          getAuditedAt: () => '2026-01-01T00:00:00Z',
          getInvocationId: () => 'inv-1',
        },
        log: {
          info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub(),
        },
        env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        auditContext: { scrapeJobId: 'job-1' },
        scrapeResultPaths: new Map([[knownUrl, '/tmp/p1']]),
        s3Client: {
          send: sandbox.stub().callsFake((command) => {
            if (command.constructor.name === 'PutObjectCommand') return Promise.resolve({});
            const key = command.input?.Key || '';
            if (key.endsWith('server-side.html')) return Promise.resolve({ ContentType: 'text/html', Body: { transformToString: () => Promise.resolve(serverHtml) } });
            if (key.endsWith('client-side.html')) return Promise.resolve({ ContentType: 'text/html', Body: { transformToString: () => Promise.resolve(clientHtml) } });
            // No scrape.json for the redirected URL — RedirectError never uploads one.
            return Promise.reject(new Error('Not found'));
          }),
        },
        dataAccess: {
          ScrapeUrl: { allByScrapeJobId: sandbox.stub().resolves(allScrapeUrls) },
          Suggestion: {
            saveMany: sandbox.stub().resolves(),
            bulkUpdateStatus: bulkUpdateStatusStub,
            STATUSES: Suggestion.STATUSES,
          },
          SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
          LatestAudit: { updateByKeys: sandbox.stub().resolves() },
        },
      };

      const result = await mockHandler.processContentAndGenerateOpportunities(context);

      expect(result.status).to.equal('complete');
      expect(result.auditResult.urlsRedirected).to.equal(1);
      expect(bulkUpdateStatusStub).to.have.been.called;
      const outdatedCandidates = bulkUpdateStatusStub.firstCall.args[0];
      expect(outdatedCandidates).to.include(redirectedSuggestion);
      expect(bulkUpdateStatusStub.firstCall.args[1]).to.equal(Suggestion.STATUSES.OUTDATED);
    });
  });
});
