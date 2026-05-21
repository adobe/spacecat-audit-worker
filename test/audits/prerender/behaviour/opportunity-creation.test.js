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
 * Behavioural contracts: opportunity and suggestion creation
 *
 * Branch A (urlsNeedingPrerender > 0): correct suggestion data shape written to DB,
 * including domain-wide aggregate suggestion.
 *
 * Branch B (scrapeForbidden, no prerender URLs): createScrapeForbiddenOpportunity
 * runs convertToOpportunity without creating per-URL suggestions.
 *
 * Tests call the exported processOpportunityAndSuggestions and
 * createScrapeForbiddenOpportunity directly — these will become the
 * opportunity-syncer.js module after refactoring.
 */

/* eslint-env mocha */
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { processContentAndGenerateOpportunities } from '../../../../src/prerender/handler.js';
import {
  processOpportunityAndSuggestions,
  createScrapeForbiddenOpportunity,
} from '../../../../src/prerender/opportunity-syncer.js';
import {
  buildContext,
  buildSite,
  buildS3Client,
  buildDataAccess,
  buildUrlS3Content,
  statusKey,
  buildStatus,
  scrapeKeys,
} from './helpers.js';

use(sinonChai);

describe('Prerender behaviour — opportunity creation (Branch A + B)', () => {
  let sandbox;

  beforeEach(() => { sandbox = sinon.createSandbox(); });
  afterEach(() => { sandbox.restore(); });

  // ─── Branch A helpers ─────────────────────────────────────────────────────────

  function buildBranchAContext(siteId, scrapeJobId, url) {
    return buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox),
      // No existing opportunities → Opportunity.create will be called
      dataAccess: buildDataAccess(sandbox, { opportunities: [] }),
    });
  }

  function buildBranchAAuditData(siteId, scrapeJobId, url, overrides = {}) {
    const result = {
      url,
      needsPrerender: true,
      contentGainRatio: 8.4,
      wordCountBefore: 10,
      wordCountAfter: 84,
      citabilityScore: 1,
      isDeployedAtEdge: false,
      ...overrides,
    };
    return {
      siteId,
      id: 'audit-id',
      auditId: 'audit-id',
      auditResult: {
        urlsNeedingPrerender: 1,
        results: [result],
      },
      scrapeJobId,
      scrapedUrlsSet: new Set([url]),
    };
  }

  // ─── Branch A: correct suggestion data shape ──────────────────────────────────

  it('Branch A: suggestion data contains url, word counts, contentGainRatio, and S3 HTML keys', async () => {
    const siteId = 'site-branch-a';
    const scrapeJobId = 'job-branch-a';
    const url = 'https://example.com/page-1';
    const keys = scrapeKeys(scrapeJobId, url);

    const ctx = buildBranchAContext(siteId, scrapeJobId, url);
    const auditData = buildBranchAAuditData(siteId, scrapeJobId, url);

    await processOpportunityAndSuggestions('https://example.com', auditData, ctx, false);

    // syncSuggestions calls opportunity.addSuggestions with new suggestions
    const opp = ctx.dataAccess.Opportunity.create.firstCall?.returnValue
      ?? await ctx.dataAccess.Opportunity.create.firstCall?.returnValue;
    // Retrieve the resolved opportunity from the create stub
    const createdOpp = await ctx.dataAccess.Opportunity.create.firstCall.returnValue;
    expect(createdOpp.addSuggestions).to.have.been.called;

    const [newSuggestions] = createdOpp.addSuggestions.firstCall.args;
    const urlSuggestion = newSuggestions.find((s) => s.data?.url === url);
    expect(urlSuggestion, `suggestion for ${url} must exist`).to.not.be.undefined;

    const { data } = urlSuggestion;
    expect(data).to.have.property('wordCountBefore', 10);
    expect(data).to.have.property('wordCountAfter', 84);
    expect(data).to.have.property('contentGainRatio', 8.4);
    expect(data).to.have.property('scrapeJobId', scrapeJobId);
    // HTML keys must point to the canonical S3 paths
    expect(data).to.have.property('originalHtmlKey', keys.serverHtml);
    expect(data).to.have.property('prerenderedHtmlKey', keys.clientHtml);
  });

  it('Branch A: domain-wide aggregate suggestion is included alongside per-URL suggestions', async () => {
    const siteId = 'site-domain-wide';
    const scrapeJobId = 'job-domain-wide';
    const url = 'https://example.com/page-1';

    const ctx = buildBranchAContext(siteId, scrapeJobId, url);
    const auditData = buildBranchAAuditData(siteId, scrapeJobId, url);

    await processOpportunityAndSuggestions('https://example.com', auditData, ctx, false);

    const createdOpp = await ctx.dataAccess.Opportunity.create.firstCall.returnValue;
    const [newSuggestions] = createdOpp.addSuggestions.firstCall.args;

    // Domain-wide suggestion has isDomainWide=true in its data
    const domainWideSuggestion = newSuggestions.find((s) => s.data?.isDomainWide === true);
    expect(domainWideSuggestion, 'domain-wide suggestion must be included').to.not.be.undefined;
    expect(domainWideSuggestion.data).to.have.property('url').that.includes('All Domain URLs');
  });

  // ─── Branch B: scrapeForbidden opportunity data ───────────────────────────────

  it('Branch B: opportunity created with scrapeForbidden=true and scrapeForbiddenCount in data', async () => {
    // createOpportunityData maps auditResult.scrapeForbidden → opportunity.data.scrapeForbidden.
    // This field drives the UI's "scraping blocked" banner and must be written correctly.
    const siteId = 'site-branch-b-data';
    const scrapeJobId = 'job-branch-b-data';

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox),
      dataAccess: buildDataAccess(sandbox, { opportunities: [] }),
    });

    await createScrapeForbiddenOpportunity(
      'https://example.com',
      {
        siteId,
        id: 'audit-id',
        auditId: 'audit-id',
        auditResult: { scrapeForbidden: true, scrapeForbiddenCount: 2 },
        scrapeJobId,
      },
      ctx,
      false,
    );

    expect(ctx.dataAccess.Opportunity.create).to.have.been.called;
    const [opportunityData] = ctx.dataAccess.Opportunity.create.firstCall.args;
    expect(opportunityData.data).to.have.property('scrapeForbidden', true);
    expect(opportunityData.data).to.have.property('scrapeForbiddenCount', 2);
  });

  it('Branch C with no existing opportunity: no OUTDATED marking attempted', async () => {
    // When no prerender URLs are found AND no opportunity exists in the DB,
    // syncSuggestions must not be called — there are no suggestions to OUTDATED.
    // allBySiteIdAndStatus is still called (the lookup must happen) but returns nothing.
    const siteId = 'site-branch-c-noopp';
    const scrapeJobId = 'job-branch-c-noopp';
    const url = 'https://example.com/page-1';

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox, {
        [statusKey(siteId)]: buildStatus(),
        // identical HTML → contentGainRatio ≈ 1.0 → needsPrerender=false → Branch C
        ...buildUrlS3Content(scrapeJobId, url),
      }),
      dataAccess: buildDataAccess(sandbox, {
        opportunities: [], // no existing opportunity
        scrapeUrls: [url],
      }),
      scrapeResultPaths: new Map([[url, {}]]),
      auditContext: { scrapeJobId },
    });

    await processContentAndGenerateOpportunities(ctx);

    // The DB was consulted to look for an existing opportunity
    expect(ctx.dataAccess.Opportunity.allBySiteIdAndStatus).to.have.been.called;
    // No existing opportunity → nothing to OUTDATED → bulkUpdateStatus never called
    expect(ctx.dataAccess.Suggestion.bulkUpdateStatus).to.not.have.been.called;
  });

  // ─── Branch B: scrapeForbidden opportunity (structural) ───────────────────────

  it('Branch B: createScrapeForbiddenOpportunity runs convertToOpportunity without per-URL suggestions', async () => {
    const siteId = 'site-branch-b';
    const scrapeJobId = 'job-branch-b';

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox),
      dataAccess: buildDataAccess(sandbox, { opportunities: [] }),
    });

    await createScrapeForbiddenOpportunity(
      'https://example.com',
      {
        siteId,
        id: 'audit-id',
        auditId: 'audit-id',
        auditResult: { scrapeForbidden: true, scrapeForbiddenCount: 2 },
        scrapeJobId,
      },
      ctx,
      false,
    );

    // convertToOpportunity must look for existing + potentially create one
    expect(ctx.dataAccess.Opportunity.allBySiteIdAndStatus).to.have.been.called;
    // No per-URL suggestions — addSuggestions must NOT have been called
    const createdOpp = await ctx.dataAccess.Opportunity.create.firstCall?.returnValue;
    if (createdOpp) {
      expect(createdOpp.addSuggestions).to.not.have.been.called;
    }
  });
});
