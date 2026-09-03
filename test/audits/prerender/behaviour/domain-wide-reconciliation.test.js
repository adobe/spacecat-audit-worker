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

/**
 * Behavioural contracts: LLMO-7052 — coveredByDomainWide reconciliation.
 *
 * Written against the current (handler.js-resident) implementation of
 * getDomainWideReconciliationCandidates / reconcileCoveredByDomainWide, using only the
 * public step entry points (submitForScraping, processContentAndGenerateOpportunities)
 * and external-dependency mocks (S3, dataAccess entities) — no internal functions are
 * stubbed. These must keep passing unchanged once that logic is moved/merged elsewhere,
 * since they assert on observable outcomes, not on which internal function ran them.
 *
 * BATCH SELECTION (submitForScraping):
 *   - coveredByDomainWide suggestion with no post-deploy scrape confirmation → appended
 *     to the returned scrape batch, additively.
 *   - coveredByDomainWide suggestion already confirmed deployed after the deploy date →
 *     not appended.
 *   - No NEW prerender opportunity yet → no error, nothing extra appended.
 *
 * WRITE-BACK (processContentAndGenerateOpportunities):
 *   - This run confirms isDeployedAtEdge: false for a coveredByDomainWide suggestion's
 *     URL → the flag is cleared and the suggestion is saved.
 *   - This run confirms isDeployedAtEdge: true → left unchanged.
 *   - This run's scrape for that URL errors → left unchanged (no false-negative clear).
 */

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import {
  submitForScraping,
  processContentAndGenerateOpportunities,
} from '../../../../src/prerender/handler.js';
import {
  buildContext,
  buildSite,
  buildS3Client,
  buildDataAccess,
  buildOpportunity,
  buildSuggestion,
  buildUrlS3Content,
  statusKey,
  buildStatus,
} from './helpers.js';

use(sinonChai);

const SITE_ID = 'test-site-id';
const BASE_URL = 'https://example.com';

describe('Prerender behaviour — LLMO-7052 coveredByDomainWide reconciliation', () => {
  let sandbox;

  beforeEach(() => { sandbox = sinon.createSandbox(); });
  afterEach(() => { sandbox.restore(); });

  describe('batch selection (submitForScraping)', () => {
    function buildBatchSelectionContext(overrides) {
      return buildContext(sandbox, {
        site: buildSite({ id: SITE_ID, baseUrl: BASE_URL }),
        s3Client: buildS3Client(sandbox, { [statusKey(SITE_ID)]: buildStatus() }),
        ...overrides,
      });
    }

    it('appends a coveredByDomainWide URL with no post-deploy scrape confirmation, additively', async () => {
      const deployedAt = Date.now() - (60 * 60 * 1000);
      const url = `${BASE_URL}/covered-page`;
      const domainWide = buildSuggestion(sandbox, {
        id: 'dw-1',
        data: { isDomainWide: true, edgeDeployed: deployedAt },
      });
      const covered = buildSuggestion(sandbox, {
        id: 'covered-1',
        data: { url, coveredByDomainWide: 'dw-1' },
      });
      const opportunity = buildOpportunity(sandbox, { suggestions: [domainWide, covered] });

      const ctx = buildBatchSelectionContext({
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      });

      const result = await submitForScraping(ctx);

      expect(result.urls).to.deep.include({ url });
    });

    it('excludes a coveredByDomainWide URL already confirmed deployed after the deploy date', async () => {
      const deployedAt = Date.now() - (60 * 60 * 1000);
      const url = `${BASE_URL}/confirmed-page`;
      const domainWide = buildSuggestion(sandbox, {
        id: 'dw-1',
        data: { isDomainWide: true, edgeDeployed: deployedAt },
      });
      const covered = buildSuggestion(sandbox, {
        id: 'covered-1',
        data: { url, coveredByDomainWide: 'dw-1' },
      });
      const opportunity = buildOpportunity(sandbox, { suggestions: [domainWide, covered] });

      const ctx = buildBatchSelectionContext({
        s3Client: buildS3Client(sandbox, {
          [statusKey(SITE_ID)]: buildStatus({
            pages: [{
              url,
              scrapingStatus: 'success',
              scrapedAt: new Date(deployedAt + 1000).toISOString(),
            }],
          }),
        }),
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      });

      const result = await submitForScraping(ctx);

      expect(result.urls).to.deep.equal([]);
    });

    it('does not error and appends nothing when there is no NEW prerender opportunity yet', async () => {
      const ctx = buildBatchSelectionContext({
        dataAccess: buildDataAccess(sandbox, { opportunities: [] }),
      });

      const result = await submitForScraping(ctx);

      expect(result.urls).to.deep.equal([]);
    });
  });

  describe('write-back (processContentAndGenerateOpportunities)', () => {
    const scrapeJobId = 'job-1';

    function buildWriteBackContext(url, opportunity, { isDeployedAtEdge, s3Error } = {}) {
      const dataAccess = buildDataAccess(sandbox, {
        opportunities: [opportunity],
        scrapeUrls: [url],
      });
      const s3Client = s3Error
        ? { send: sandbox.stub().rejects(s3Error) }
        : buildS3Client(sandbox, {
          [statusKey(SITE_ID)]: buildStatus(),
          ...buildUrlS3Content(scrapeJobId, url, { scrapeJson: { isDeployedAtEdge } }),
        });
      return buildContext(sandbox, {
        site: buildSite({ id: SITE_ID, baseUrl: BASE_URL }),
        s3Client,
        dataAccess,
        scrapeResultPaths: new Map([[url, {}]]),
        auditContext: { scrapeJobId },
      });
    }

    it('clears coveredByDomainWide when this run confirms isDeployedAtEdge: false', async () => {
      const url = `${BASE_URL}/covered-page`;
      const covered = buildSuggestion(sandbox, {
        id: 'covered-1',
        data: { url, coveredByDomainWide: 'dw-1' },
      });
      const opportunity = buildOpportunity(sandbox, { suggestions: [covered] });
      const ctx = buildWriteBackContext(url, opportunity, { isDeployedAtEdge: false });

      await processContentAndGenerateOpportunities(ctx);

      expect(covered.setData).to.have.been.calledWith(sinon.match((d) => !('coveredByDomainWide' in d)));
      expect(ctx.dataAccess.Suggestion.saveMany).to.have.been.calledWith([covered]);
    });

    it('leaves coveredByDomainWide unchanged when this run confirms isDeployedAtEdge: true', async () => {
      const url = `${BASE_URL}/covered-page`;
      const covered = buildSuggestion(sandbox, {
        id: 'covered-1',
        data: { url, coveredByDomainWide: 'dw-1' },
      });
      const opportunity = buildOpportunity(sandbox, { suggestions: [covered] });
      const ctx = buildWriteBackContext(url, opportunity, { isDeployedAtEdge: true });

      await processContentAndGenerateOpportunities(ctx);

      expect(covered.setData).to.not.have.been.called;
      expect(ctx.dataAccess.Suggestion.saveMany).to.not.have.been.called;
    });

    it("leaves coveredByDomainWide unchanged when this run's scrape for that URL errors", async () => {
      const url = `${BASE_URL}/covered-page`;
      const covered = buildSuggestion(sandbox, {
        id: 'covered-1',
        data: { url, coveredByDomainWide: 'dw-1' },
      });
      const opportunity = buildOpportunity(sandbox, { suggestions: [covered] });
      const ctx = buildWriteBackContext(url, opportunity, {
        s3Error: Object.assign(new Error('S3 unavailable'), { name: 'S3Error' }),
      });

      await processContentAndGenerateOpportunities(ctx);

      expect(covered.setData).to.not.have.been.called;
      expect(ctx.dataAccess.Suggestion.saveMany).to.not.have.been.called;
    });
  });
});
