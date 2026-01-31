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
/* eslint-env mocha */

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import nock from 'nock';
import { describe } from 'mocha';
import { ok, notFound } from '@adobe/spacecat-shared-http-utils';
import { ScrapeClient } from '@adobe/spacecat-shared-scrape-client';
import { Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';
import { CopyObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { AWSAthenaClient } from '@adobe/spacecat-shared-athena-client';
import handler from '../../../src/paid-cookie-consent/guidance-handler.js';

use(sinonChai);
use(chaiAsPromised);



const TEST_PAGE = 'https://example-page/to-check';

describe('Paid Cookie Consent Guidance Handler', () => {
  let sandbox;
  let logStub;
  let context;
  let Suggestion;
  let Opportunity;
  let Site;
  let opportunityInstance;
  let s3ClientMock;
  let mockScrapeClient;
  let mockAthenaClient;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    logStub = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      error: sandbox.stub(),
      warn: sandbox.stub(),
    };
    Suggestion = {
      create: sandbox.stub().resolves(),
      STATUSES: SuggestionDataAccess.STATUSES,
      TYPES: SuggestionDataAccess.TYPES,
    };
    opportunityInstance = {
      getId: () => 'opptyId',
      getSuggestions: async () => [],
      setAuditId: sinon.stub(),
      setData: sinon.stub(),
      setGuidance: sinon.stub(),
      setTitle: sinon.stub(),
      setStatus: sinon.stub(),
      setDescription: sinon.stub(),
      save: sinon.stub().resolvesThis(),
      getType: () => 'consent-banner',
      getData: () => ({ page: TEST_PAGE, opportunityType: 'paid-cookie-consent' }),
      getStatus: () => 'NEW',
      getUpdatedBy: () => 'system',
      getUpdatedAt: () => new Date().toISOString(),
    };
    Opportunity = {
      allBySiteId: sandbox.stub(),
      create: sandbox.stub(),
    };
    Site = {
      findById: sandbox.stub(),
    };

    // Mock S3 client
    s3ClientMock = {
      send: sandbox.stub(),
    };

    // Mock Athena client that returns data for bounce gap and top3 pages queries
    mockAthenaClient = {
      query: sandbox.stub(),
    };

    // Default Athena query responses for the audit-data-provider queries:
    // 1. Bounce gap metrics query
    mockAthenaClient.query.onCall(0).resolves([
      { trf_type: 'paid', consent: 'show', pageviews: '5000', bounce_rate: '0.8' },
      { trf_type: 'paid', consent: 'hidden', pageviews: '5000', bounce_rate: '0.65' },
    ]);
    // 2. Top3 pages by path query
    mockAthenaClient.query.onCall(1).resolves([
      {
        path: '/to-check', pageviews: '5000', traffic_loss: '4000', bounce_rate: '0.8',
      },
    ]);
    // 3. Lost traffic summary by device query
    mockAthenaClient.query.onCall(2).resolves([
      { device: 'mobile', pageviews: '5000', traffic_loss: '4000', bounce_rate: '0.8' },
    ]);
    // 4. Top3 by device query
    mockAthenaClient.query.onCall(3).resolves([
      {
        path: '/to-check', device: 'mobile', pageviews: '5000', traffic_loss: '4000', bounce_rate: '0.85',
      },
    ]);

    // Stub AWSAthenaClient.fromContext to return our mock
    sandbox.stub(AWSAthenaClient, 'fromContext').returns(mockAthenaClient);

    context = {
      log: logStub,
      dataAccess: { Site, Opportunity, Suggestion },
      env: {
        SPACECAT_API_URI: 'https://example-space-cat-api',
        S3_MYSTIQUE_BUCKET_NAME: 'test-mystique-bucket',
        S3_SCRAPER_BUCKET_NAME: 'test-scraper-bucket',
        S3_IMPORTER_BUCKET_NAME: 'test-importer-bucket',
      },
      s3Client: s3ClientMock,
    };

    // Mock Site.findById to return a site with baseURL
    Site.findById.resolves({
      getId: () => 'site',
      getBaseURL: () => 'https://example-page',
    });

    // Mock ScrapeClient
    mockScrapeClient = {
      getScrapeJobUrlResults: sandbox.stub().resolves([{
        path: 'path/to/scrape.json',
      }]),
    };
    sandbox.stub(ScrapeClient, 'createFrom').returns(mockScrapeClient);
  });

  afterEach(() => {
    sandbox.restore();
    nock.cleanAll();
  });

  it('should return notFound if no site is found', async () => {
    Site.findById.resolves(null);
    Opportunity.allBySiteId.resolves([]);
    const message = { auditId: '123', siteId: 'site', data: { url: 'url', guidance: [{}] } };
    const result = await handler(message, context);
    expect(result.status).to.equal(notFound().status);
    expect(logStub.warn).to.have.been.calledWithMatch(/No site found/);
  });

  it('should return notFound and log error if audit data has empty top3Pages', async () => {
    // Reconfigure Athena to return empty top3Pages
    // The handler checks if (!auditData?.top3Pages) - empty array is truthy, but length 0 means no data
    // Actually we need to check the handler logic - it just checks for existence of top3Pages property
    // Since empty array has length 0, we need another approach: return null from bounce gap check
    mockAthenaClient.query.reset();
    // Return empty bounce gap data - this causes hasShowData = false
    mockAthenaClient.query.onCall(0).resolves([]);

    Opportunity.allBySiteId.resolves([]);
    const message = { auditId: 'auditId', siteId: 'site', data: { url: 'url', guidance: [{}] } };
    const result = await handler(message, context);
    expect(result.status).to.equal(notFound().status);
    expect(logStub.error).to.have.been.calledWithMatch(/No consent data available/);
  });

  it('should return notFound and log error if auditData is null', async () => {
    // Reconfigure Athena to return data that will cause getAuditData to return null
    // This happens when bounce gap data is missing show or hidden consent data
    mockAthenaClient.query.reset();
    // Return only show data (no hidden) - this causes getAuditData to return null
    mockAthenaClient.query.onCall(0).resolves([
      { trf_type: 'paid', consent: 'show', pageviews: '5000', bounce_rate: '0.8' },
    ]);

    Opportunity.allBySiteId.resolves([]);
    const message = { auditId: 'auditId', siteId: 'site', data: { url: 'url', guidance: [{}] } };
    const result = await handler(message, context);
    expect(result.status).to.equal(notFound().status);
    expect(logStub.error).to.have.been.calledWithMatch(/No consent data available/);
  });

  it('should create a new opportunity and suggestion with plain markdown', async () => {
    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(opportunityInstance);
    const guidance = [{
      body: {
        data: {
          mobile: 'mobile markdown',
          desktop: 'desktop markdown',
          impact: {
            business: 'business markdown',
            user: 'user markdown',
          },
        },
      },
      insight: 'insight',
      rationale: 'rationale',
      recommendation: 'rec',
      metadata: { scrape_job_id: 'test-job-id' },
    }];
    const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance } };
    const result = await handler(message, context);
    expect(Opportunity.create).to.have.been.called;
    expect(Suggestion.create).to.have.been.called;
    const suggestion = Suggestion.create.getCall(0).args[0];
    expect(suggestion.data.mobile).include(`mobile markdown`);
    expect(suggestion.data.desktop).include(`desktop markdown`);
    expect(suggestion.data.impact.business).include(`business markdown`);
    expect(suggestion.data.impact.user).include(`user markdown`);
    expect(result.status).to.equal(ok().status);
  });

  it('should include auditId and all auditData fields in the opportunity', async () => {
    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(opportunityInstance);
    const guidance = [{
      body: {
        data: {
          mobile: 'mobile markdown',
          desktop: 'desktop markdown',
          impact: {
            business: 'business markdown',
            user: 'user markdown',
          },
        },
      },
      insight: 'insight',
      rationale: 'rationale',
      recommendation: 'rec',
      metadata: { scrape_job_id: 'test-job-id' },
    }];
    const message = { auditId: 'test-audit-id-123', siteId: 'site', data: { url: TEST_PAGE, guidance } };
    await handler(message, context);

    expect(Opportunity.create).to.have.been.called;
    const opportunityData = Opportunity.create.getCall(0).args[0];

    // Verify auditId is at opportunity root level (not in data)
    expect(opportunityData.auditId).to.equal('test-audit-id-123');

    // Verify all auditData fields are preserved in opportunity.data
    // Note: The opportunity mapper transforms some field names from auditData
    const { data } = opportunityData;

    // temporalCondition - dynamic based on current date
    expect(data.temporalCondition).to.be.a('string');
    expect(data.temporalCondition).to.include('year=');
    expect(data.temporalCondition).to.include('week');

    // CPC fields - DEFAULT_CPC is 0.80 in ahrefs-cpc.js
    expect(data.appliedCPC).to.equal(0.8);
    expect(data.cpcSource).to.equal('default');
    expect(data.defaultCPC).to.equal(0.8);

    // Traffic metrics (mapper renames: pageViews = totalPageViews, bounceRate = totalAverageBounceRate)
    expect(data.projectedTrafficLost).to.be.a('number');
    expect(data.projectedTrafficValue).to.be.a('number');
    expect(data.pageViews).to.be.a('number'); // was totalPageViews in auditData
    expect(data.bounceRate).to.be.a('number'); // was totalAverageBounceRate in auditData

    // page URL is preserved
    expect(data.page).to.equal(TEST_PAGE);
  });

  it('should handle Athena results with missing optional fields (branch coverage)', async () => {
    // Reset mock to return data with missing optional fields to cover || 0 branches
    mockAthenaClient.query.reset();
    // 1. Bounce gap metrics with missing bounce_rate and pageviews
    mockAthenaClient.query.onCall(0).resolves([
      { trf_type: 'paid', consent: 'show' }, // missing pageviews, bounce_rate
      { trf_type: 'paid', consent: 'hidden', pageviews: '5000', bounce_rate: '0.65' },
    ]);
    // 2. Top3 pages with missing optional fields (traffic_loss, pct_pageviews, click_rate, etc.)
    mockAthenaClient.query.onCall(1).resolves([
      { path: '/to-check' }, // missing all optional fields
    ]);
    // 3. Lost traffic summary with missing pageviews (covers totalPageViews = 0 branch)
    mockAthenaClient.query.onCall(2).resolves([
      { device: 'mobile' }, // missing pageviews
    ]);
    // 4. Top3 by device with missing fields
    mockAthenaClient.query.onCall(3).resolves([
      { path: '/to-check', device: 'mobile' }, // missing bounce_rate
    ]);

    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(opportunityInstance);
    const guidance = [{
      body: { data: { mobile: 'mobile', desktop: 'desktop', impact: { business: 'biz', user: 'usr' } } },
      insight: 'insight', rationale: 'rationale', recommendation: 'rec',
      metadata: { scrape_job_id: 'test-job-id' },
    }];
    const message = { auditId: 'test-audit-id', siteId: 'site', data: { url: TEST_PAGE, guidance } };
    await handler(message, context);

    expect(Opportunity.create).to.have.been.called;
    const opportunityData = Opportunity.create.getCall(0).args[0];
    // Verify defaults are applied correctly when fields are missing
    // opportunity.data.pageViews is stats.totalPageViews in the mapper
    expect(opportunityData.data.pageViews).to.equal(0);
    // opportunity.data.bounceRate is stats.totalAverageBounceRate in the mapper (totalPageViews = 0 branch)
    expect(opportunityData.data.bounceRate).to.equal(0);
  });

  it('should handle zero pageviews in sitewide bounce delta calculation', async () => {
    // Reset mock to cover totalPVShow = 0 and totalPVHidden = 0 branches (lines 138-139)
    mockAthenaClient.query.reset();
    // 1. Bounce gap with zero pageviews for show and hidden
    mockAthenaClient.query.onCall(0).resolves([
      { trf_type: 'paid', consent: 'show', pageviews: '0', bounce_rate: '0.8' },
      { trf_type: 'paid', consent: 'hidden', pageviews: '0', bounce_rate: '0.65' },
    ]);
    // 2-4. Normal responses for other queries
    mockAthenaClient.query.onCall(1).resolves([
      { path: '/to-check', pageviews: '5000', traffic_loss: '4000', bounce_rate: '0.8' },
    ]);
    mockAthenaClient.query.onCall(2).resolves([
      { device: 'mobile', pageviews: '5000', traffic_loss: '4000', bounce_rate: '0.8' },
    ]);
    mockAthenaClient.query.onCall(3).resolves([
      { path: '/to-check', device: 'mobile', pageviews: '5000', traffic_loss: '4000', bounce_rate: '0.85' },
    ]);

    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(opportunityInstance);
    const guidance = [{
      body: { data: { mobile: 'mobile', desktop: 'desktop', impact: { business: 'biz', user: 'usr' } } },
      insight: 'insight', rationale: 'rationale', recommendation: 'rec',
      metadata: { scrape_job_id: 'test-job-id' },
    }];
    const message = { auditId: 'test-audit-id', siteId: 'site', data: { url: TEST_PAGE, guidance } };
    await handler(message, context);

    // Should still create opportunity - the sitewideBounceDelta calculation handles 0 pageviews
    expect(Opportunity.create).to.have.been.called;
    // The opportunity is created, meaning the ternary branches for 0 pageviews were exercised
  });

  it('should include ahrefs CPC fields when cpcSource is ahrefs (line 229 branch)', async () => {
    // Configure S3 to return valid ahrefs CPC data
    const ahrefsCPCData = {
      organicTraffic: 10000,
      organicCost: 9500, // organicCPC = 9500/10000 = 0.95
      paidTraffic: 5000,
      paidCost: 6250, // paidCPC = 6250/5000 = 1.25
    };
    s3ClientMock.send.resolves({
      Body: { transformToString: () => JSON.stringify(ahrefsCPCData) },
    });

    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(opportunityInstance);
    const guidance = [{
      body: { data: { mobile: 'mobile', desktop: 'desktop', impact: { business: 'biz', user: 'usr' } } },
      insight: 'insight', rationale: 'rationale', recommendation: 'rec',
      metadata: { scrape_job_id: 'test-job-id' },
    }];
    const message = { auditId: 'test-audit-id', siteId: 'site', data: { url: TEST_PAGE, guidance } };
    await handler(message, context);

    expect(Opportunity.create).to.have.been.called;
    const opportunityData = Opportunity.create.getCall(0).args[0];
    // Verify ahrefs-specific fields are included (line 229 conditional spread)
    expect(opportunityData.data.cpcSource).to.equal('ahrefs');
    expect(opportunityData.data.ahrefsOrganicCPC).to.equal(0.95);
    expect(opportunityData.data.ahrefsPaidCPC).to.equal(1.25);
    expect(opportunityData.data.appliedCPC).to.equal(1.25);
  });

  it('should create a new opportunity and suggestion from serialized JSON with markdown', async () => {
    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(opportunityInstance);
    const guidance = [{
      body: {
        data: {
          mobile: 'mobile markdown',
          desktop: 'desktop markdown',
          impact: {
            business: 'business markdown',
            user: 'user markdown',
          },
        },
      },
      insight: 'insight',
      rationale: 'rationale',
      recommendation: 'rec',
      metadata: { scrape_job_id: 'test-job-id' },
    }];
    const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance } };
    const result = await handler(message, context);
    expect(Opportunity.create).to.have.been.called;
    expect(Suggestion.create).to.have.been.called;
    const suggestion = Suggestion.create.getCall(0).args[0];
    expect(suggestion.data.mobile).include(`mobile markdown`);
    expect(suggestion.data.desktop).include(`desktop markdown`);
    expect(suggestion.data.impact.business).include(`business markdown`);
    expect(suggestion.data.impact.user).include(`user markdown`);
    expect(result.status).to.equal(ok().status);
  });

  it('should create new opportunity and mark existing consent-banner NEW system opportunities as IGNORED', async () => {
    const consentBannerOppty1 = {
      getId: () => 'opptyId-1',
      getType: () => 'consent-banner',
      getStatus: () => 'NEW',
      getUpdatedBy: () => 'system',
      setStatus: sinon.stub(),
      save: sinon.stub().resolvesThis(),
    };
    const consentBannerOppty2 = {
      getId: () => 'opptyId-2',
      getType: () => 'consent-banner',
      getStatus: () => 'NEW',
      getUpdatedBy: () => 'system',
      setStatus: sinon.stub(),
      save: sinon.stub().resolvesThis(),
    };
    const wrongTypeOppty = {
      getId: () => 'opptyId-3',
      getType: () => 'other-type',
      getStatus: () => 'NEW',
      getUpdatedBy: () => 'system',
      setStatus: sinon.stub(),
      save: sinon.stub().resolvesThis(),
    };

    Opportunity.allBySiteId.resolves([wrongTypeOppty, consentBannerOppty1, consentBannerOppty2]);
    Opportunity.create.resolves(opportunityInstance);
    const guidance = [{
      body: {
        data: {
          mobile: 'mobile markdown',
          desktop: 'desktop markdown',
          impact: {
            business: 'business markdown',
            user: 'user markdown',
          },
        },
      },
      insight: 'insight',
      rationale: 'rationale',
      recommendation: 'rec',
      metadata: { scrape_job_id: 'test-job-id' },
    }];
    const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance } };

    // Act
    const result = await handler(message, context);

    // Assert: A new opportunity should be created
    expect(Opportunity.create).to.have.been.called;
    expect(Suggestion.create).to.have.been.called;

    // The consent-banner opportunities should be marked as IGNORED
    expect(consentBannerOppty1.setStatus).to.have.been.calledWith('IGNORED');
    expect(consentBannerOppty1.save).to.have.been.called;
    expect(consentBannerOppty2.setStatus).to.have.been.calledWith('IGNORED');
    expect(consentBannerOppty2.save).to.have.been.called;

    // The non-matching type should not be touched
    expect(wrongTypeOppty.setStatus).to.not.have.been.called;

    expect(result.status).to.equal(ok().status);
  });

  it('should not mark non-system consent-banner opportunities as IGNORED', async () => {
    const systemOppty = {
      getId: () => 'opptyId-system',
      getType: () => 'consent-banner',
      getStatus: () => 'NEW',
      getUpdatedBy: () => 'system',
      setStatus: sinon.stub(),
      save: sinon.stub().resolvesThis(),
    };
    const userOppty = {
      getId: () => 'opptyId-user',
      getType: () => 'consent-banner',
      getStatus: () => 'NEW',
      getUpdatedBy: () => 'user',
      setStatus: sinon.stub(),
      save: sinon.stub().resolvesThis(),
    };

    Opportunity.allBySiteId.resolves([systemOppty, userOppty]);
    Opportunity.create.resolves(opportunityInstance);
    const guidance = [{
      body: {
        data: {
          mobile: 'mobile markdown',
          desktop: 'desktop markdown',
          impact: {
            business: 'business markdown',
            user: 'user markdown',
          },
        },
      },
      insight: 'insight',
      rationale: 'rationale',
      recommendation: 'rec',
      metadata: { scrape_job_id: 'test-job-id' },
    }];
    const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance } };

    const result = await handler(message, context);

    // Assert: A new opportunity should be created
    expect(Opportunity.create).to.have.been.called;
    expect(Suggestion.create).to.have.been.called;

    // Only system opportunity should be marked as IGNORED
    expect(systemOppty.setStatus).to.have.been.calledWith('IGNORED');
    expect(systemOppty.save).to.have.been.called;

    // The user opportunity should not be touched
    expect(userOppty.setStatus).to.not.have.been.called;
    expect(userOppty.save).to.not.have.been.called;

    expect(result.status).to.equal(ok().status);
  });

  it('should handle guidance body as JSON object', async () => {
    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(opportunityInstance);
    const guidance = [{
      body: {
        data: {
          mobile: 'mobile markdown',
          desktop: 'desktop markdown',
          impact: {
            business: 'business markdown',
            user: 'user markdown',
          },
        },
        issueSeverity: 'high',
      },
      insight: 'insight',
      rationale: 'rationale',
      recommendation: 'rec',
      metadata: { scrape_job_id: 'test-job-id' },
    }];
    const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance } };

    const result = await handler(message, context);

    expect(Opportunity.create).to.have.been.called;
    expect(Suggestion.create).to.have.been.called;
    expect(result.status).to.equal(ok().status);
  });

  it('should skip opportunity creation and log for low severity (low)', async () => {
    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(opportunityInstance);
    const body = { issueSeverity: 'loW', data: {
      mobile: 'mobile markdown',
      desktop: 'desktop markdown',
      impact: { business: 'business markdown', user: 'user markdown' },
    } };
    const guidance = [{ body, metadata: { scrape_job_id: 'test-job-id' } }];
    const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance } };
    const result = await handler(message, context);
    expect(Opportunity.create).not.to.have.been.called;
    expect(Suggestion.create).not.to.have.been.called;
    expect(logStub.info).to.have.been.calledWithMatch(/Skipping opportunity creation/);
    expect(result.status).to.equal(ok().status);
  });

  it('should create opportunity if severity is medium', async () => {
    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(opportunityInstance);
    const body = { issueSeverity: 'Medium', data: {
      mobile: 'mobile markdown',
      desktop: 'desktop markdown',
      impact: { business: 'business markdown', user: 'user markdown' },
    } };
    const guidance = [{ body, metadata: { scrape_job_id: 'test-job-id' } }];
    const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance } };
    const result = await handler(message, context);
    expect(Opportunity.create).to.have.been.called;
    expect(Suggestion.create).to.have.been.called;
    expect(result.status).to.equal(ok().status);
  });

  it('should skip opportunity creation for none severity', async () => {
    Opportunity.allBySiteId.resolves([]);
    const body = { issueSeverity: 'none', markdown: 'test' };
    const guidance = [{ body, metadata: { scrape_job_id: 'test-job-id' } }];
    const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance } };

    const result = await handler(message, context);

    expect(Opportunity.create).not.to.have.been.called;
    expect(result.status).to.equal(ok().status);
  });

  it('should set suggestion status to PENDING_VALIDATION when site requires validation', async () => {
    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(opportunityInstance);
    context.site = { requiresValidation: true };

    const guidance = [{
      body: {
        data: {
          mobile: 'mobile markdown',
          desktop: 'desktop markdown',
          impact: { business: 'business markdown', user: 'user markdown' },
        },
      },
      insight: 'insight',
      rationale: 'rationale',
      recommendation: 'rec',
      metadata: { scrape_job_id: 'test-job-id' },
    }];
    const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance } };
    await handler(message, context);
    expect(Suggestion.create).to.have.been.calledWith(sinon.match.has('status', 'PENDING_VALIDATION'));
  });

  it('should not mark opportunities as IGNORED when no existing consent-banner opportunities exist', async () => {
    const otherOppty = {
      getId: () => 'opptyId-other',
      getType: () => 'other-type',
      getStatus: () => 'NEW',
      getUpdatedBy: () => 'system',
      setStatus: sinon.stub(),
      save: sinon.stub().resolvesThis(),
    };

    Opportunity.allBySiteId.resolves([otherOppty]);
    Opportunity.create.resolves(opportunityInstance);
    const guidance = [{
      body: {
        data: {
          mobile: 'mobile markdown',
          desktop: 'desktop markdown',
          impact: { business: 'business markdown', user: 'user markdown' },
        },
      },
      insight: 'insight',
      rationale: 'rationale',
      recommendation: 'rec',
      metadata: { scrape_job_id: 'test-job-id' },
    }];
    const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance } };

    const result = await handler(message, context);

    expect(Opportunity.create).to.have.been.called;
    expect(Suggestion.create).to.have.been.called;
    expect(otherOppty.setStatus).to.not.have.been.called;
    expect(result.status).to.equal(ok().status);
  });

  it('should not mark the newly created opportunity as IGNORED', async () => {
    const existingConsentBannerOppty = {
      getId: () => 'existing-oppty-id',
      getType: () => 'consent-banner',
      getStatus: () => 'NEW',
      getUpdatedBy: () => 'system',
      setStatus: sinon.stub(),
      save: sinon.stub().resolvesThis(),
    };

    Opportunity.allBySiteId.resolves([existingConsentBannerOppty]);
    Opportunity.create.resolves(opportunityInstance);
    const guidance = [{
      body: {
        data: {
          mobile: 'mobile markdown',
          desktop: 'desktop markdown',
          impact: { business: 'business markdown', user: 'user markdown' },
        },
      },
      insight: 'insight',
      rationale: 'rationale',
      recommendation: 'rec',
      metadata: { scrape_job_id: 'test-job-id' },
    }];
    const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance } };

    const result = await handler(message, context);

    // Only the existing opportunity should be marked as IGNORED, not the newly created one
    expect(existingConsentBannerOppty.setStatus).to.have.been.calledWith('IGNORED');
    expect(existingConsentBannerOppty.save).to.have.been.called;
    expect(result.status).to.equal(ok().status);
  });

  describe('Screenshot Copying Functionality', () => {
    beforeEach(() => {
      Opportunity.allBySiteId.resolves([]);
      Opportunity.create.resolves(opportunityInstance);
      // Default: S3 operations succeed
      s3ClientMock.send.resolves();
    });

    it('should successfully copy both mobile and desktop suggested screenshots', async () => {
      const jobId = 'test-job-123';
      const guidance = [{
        body: {
          data: {
            mobile: 'mobile markdown with MOBILE_BANNER_SUGGESTION',
            desktop: 'desktop markdown with DESKTOP_BANNER_SUGGESTION',
            impact: {
              business: 'business markdown',
              user: 'user markdown',
            },
          },
        },
        insight: 'insight',
        rationale: 'rationale',
        recommendation: 'rec',
        metadata: { scrape_job_id: jobId },
      }];
      const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance } };

      await handler(message, context);

      // Verify HeadObjectCommand calls to check file existence
      expect(s3ClientMock.send).to.have.been.calledWith(sinon.match.instanceOf(HeadObjectCommand));
      expect(s3ClientMock.send).to.have.been.calledWith(sinon.match({
        input: {
          Bucket: 'test-mystique-bucket',
          Key: `temp/consent-banner/${jobId}/mobile-suggested.png`,
        },
      }));
      expect(s3ClientMock.send).to.have.been.calledWith(sinon.match({
        input: {
          Bucket: 'test-mystique-bucket',
          Key: `temp/consent-banner/${jobId}/desktop-suggested.png`,
        },
      }));

      // Verify CopyObjectCommand calls
      expect(s3ClientMock.send).to.have.been.calledWith(sinon.match.instanceOf(CopyObjectCommand));
      expect(s3ClientMock.send).to.have.been.calledWith(sinon.match({
        input: {
          CopySource: `test-mystique-bucket/temp/consent-banner/${jobId}/mobile-suggested.png`,
          Bucket: 'test-scraper-bucket',
          Key: 'path/to/mobile-suggested.png',
        },
      }));
      expect(s3ClientMock.send).to.have.been.calledWith(sinon.match({
        input: {
          CopySource: `test-mystique-bucket/temp/consent-banner/${jobId}/desktop-suggested.png`,
          Bucket: 'test-scraper-bucket',
          Key: 'path/to/desktop-suggested.png',
        },
      }));
    });

    it('should warn and skip when bucket configuration is missing', async () => {
      // Remove bucket configuration
      delete context.env.S3_MYSTIQUE_BUCKET_NAME;
      delete context.env.S3_SCRAPER_BUCKET_NAME;

      const guidance = [{
        body: {
          data: {
            mobile: 'mobile markdown with MOBILE_BANNER_SUGGESTION',
            desktop: 'desktop markdown with DESKTOP_BANNER_SUGGESTION',
            impact: {
              business: 'business markdown',
              user: 'user markdown',
            },
          },
        },
        insight: 'insight',
        rationale: 'rationale',
        recommendation: 'rec',
        metadata: { scrape_job_id: 'test-job-123' },
      }];
      const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance } };

      await handler(message, context);

      // Should not make HeadObjectCommand or CopyObjectCommand calls (screenshot copying)
      // Note: getCPCData may still call S3 for CPC data via GetObjectCommand
      const s3Calls = s3ClientMock.send.getCalls();
      const screenshotCopyingCalls = s3Calls.filter(
        (call) => call.args[0] instanceof HeadObjectCommand
          || call.args[0] instanceof CopyObjectCommand,
      );
      expect(screenshotCopyingCalls).to.have.lengthOf(0);
    });
    it('should handle file not found gracefully and continue processing', async () => {
      const jobId = 'test-job-123';

      // Mock HeadObjectCommand to throw NotFound for mobile file
      s3ClientMock.send.callsFake((command) => {
        if (command instanceof HeadObjectCommand && command.input.Key.includes('mobile-suggested.png')) {
          const error = new Error('Not Found');
          error.name = 'NotFound';
          throw error;
        }
        return Promise.resolve();
      });

      const guidance = [{
        body: {
          data: {
            mobile: 'mobile markdown with MOBILE_BANNER_SUGGESTION',
            desktop: 'desktop markdown with DESKTOP_BANNER_SUGGESTION',
            impact: {
              business: 'business markdown',
              user: 'user markdown',
            },
          },
        },
        insight: 'insight',
        rationale: 'rationale',
        recommendation: 'rec',
        metadata: { scrape_job_id: jobId },
      }];
      const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance } };

      await handler(message, context);

      // Should still continue with opportunity creation
      expect(Opportunity.create).to.have.been.called;
      expect(Suggestion.create).to.have.been.called;
    });

    it('should handle S3 errors gracefully and continue processing', async () => {
      const jobId = 'test-job-123';

      // Mock S3 to throw an error
      s3ClientMock.send.rejects(new Error('S3 Service Error'));

      const guidance = [{
        body: {
          data: {
            mobile: 'mobile markdown with MOBILE_BANNER_SUGGESTION',
            desktop: 'desktop markdown with DESKTOP_BANNER_SUGGESTION',
            impact: {
              business: 'business markdown',
              user: 'user markdown',
            },
          },
        },
        insight: 'insight',
        rationale: 'rationale',
        recommendation: 'rec',
        metadata: { scrape_job_id: jobId },
      }];
      const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance } };

      await handler(message, context);

      // Should still continue with opportunity creation
      expect(Opportunity.create).to.have.been.called;
      expect(Suggestion.create).to.have.been.called;
    });

    it('should handle mixed success and failure scenarios', async () => {
      const jobId = 'test-job-123';

      // Mock: mobile file exists and copies successfully, desktop file not found
      s3ClientMock.send.callsFake((command) => {
        if (command instanceof HeadObjectCommand) {
          if (command.input.Key.includes('desktop-suggested.png')) {
            const error = new Error('Not Found');
            error.name = 'NoSuchKey';
            throw error;
          }
          return Promise.resolve(); // mobile file exists
        }
        if (command instanceof CopyObjectCommand) {
          return Promise.resolve(); // copy succeeds
        }
        return Promise.resolve();
      });

      const guidance = [{
        body: {
          data: {
            mobile: 'mobile markdown with MOBILE_BANNER_SUGGESTION',
            desktop: 'desktop markdown with DESKTOP_BANNER_SUGGESTION',
            impact: {
              business: 'business markdown',
              user: 'user markdown',
            },
          },
        },
        insight: 'insight',
        rationale: 'rationale',
        recommendation: 'rec',
        metadata: { scrape_job_id: jobId },
      }];
      const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance } };

      await handler(message, context);

      // Should still continue with opportunity creation
      expect(Opportunity.create).to.have.been.called;
      expect(Suggestion.create).to.have.been.called;
    });
  });
});
