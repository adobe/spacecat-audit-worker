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
import esmock from 'esmock';

use(sinonChai);
use(chaiAsPromised);

// Mock tagMappings module
const mockTagMappings = {
  mergeTagsWithHardcodedTags: sinon.stub().callsFake((opportunityType, currentTags) => {
    if (opportunityType === 'consent-banner') {
      return ['Consent Banner', 'Engagement'];
    }
    return currentTags || [];
  }),
};

let handler;

// Helper to create a fresh stubbed opportunity instance
function makeOppty({
  page, opportunityType, status = 'NEW', updatedBy = 'system', updatedAt = new Date().toISOString(),
}) {
  return {
    getId: () => `opptyId-${page}-${opportunityType}`,
    getSuggestions: async () => [],
    setAuditId: sinon.stub(),
    setData: sinon.stub(),
    setGuidance: sinon.stub(),
    setTitle: sinon.stub(),
    setDescription: sinon.stub(),
    setStatus: sinon.stub(),
    save: sinon.stub().resolvesThis(),
    getType: () => 'generic-opportunity',
    getData: () => ({ page, opportunityType }),
    getStatus: () => status,
    getUpdatedBy: () => updatedBy,
    getUpdatedAt: () => updatedAt,
  };
}

const TEST_PAGE = 'https://example-page/to-check';

describe('Paid Cookie Consent Guidance Handler', () => {
  let sandbox;
  let logStub;
  let context;
  let Suggestion;
  let Opportunity;
  let Audit;
  let opportunityInstance;
  let s3ClientMock;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    // Import handler with mocked tagMappings
    handler = await esmock(
      '../../../src/paid-cookie-consent/guidance-handler.js',
      {
        '@adobe/spacecat-shared-utils': mockTagMappings,
      },
    );
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
      getType: () => 'generic-opportunity',
      getData: () => ({ page: TEST_PAGE, opportunityType: 'paid-cookie-consent' }),
      getStatus: () => 'NEW',
      getUpdatedBy: () => 'system',
      getUpdatedAt: () => new Date().toISOString(),
    };
    Opportunity = {
      allBySiteId: sandbox.stub(),
      create: sandbox.stub(),
    };
    Audit = { findById: sandbox.stub() };

    // Mock S3 client
    s3ClientMock = {
      send: sandbox.stub(),
    };

    context = {
      log: logStub,
      dataAccess: { Audit, Opportunity, Suggestion },
      env: {
        SPACECAT_API_URI: 'https://example-space-cat-api',
        S3_MYSTIQUE_BUCKET_NAME: 'test-mystique-bucket',
        S3_SCRAPER_BUCKET_NAME: 'test-scraper-bucket',
      },
      s3Client: s3ClientMock,
    };

    Audit.findById.resolves({
      getAuditId: () => 'auditId',
      getAuditResult: () => ({
        totalPageViews: 10000,
        totalAverageBounceRate: 0.8,
        projectedTrafficLost: 8000,
        projectedTrafficValue: 6400,
        top3Pages: [
          { url: 'https://example-page/to-check', trafficLoss: 4000, pageViews: 5000, bounceRate: 0.8 },
        ],
        averagePageViewsTop3: 5000,
        averageTrafficLostTop3: 4000,
        averageBounceRateMobileTop3: 0.85,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      }),
    });

    // Mock ScrapeClient
    const mockScrapeClient = {
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

  it('should return notFound if no audit is found', async () => {
    Audit.findById.resolves(null);
    Opportunity.allBySiteId.resolves([]);
    const message = { auditId: '123', siteId: 'site', data: { url: 'url', guidance: [{}] } };
    const result = await handler(message, context);
    expect(result.status).to.equal(notFound().status);
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

  it('should create a new opportunity and suggestion from serialized JSON with markdown', async () => {
    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(opportunityInstance);
    const markdown = 'json\nmarkdown';
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

      // Should not make any S3 calls
      expect(s3ClientMock.send).to.not.have.been.called;

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

  describe('getGuidanceObj edge cases', () => {
    it('should handle empty guidance array', async () => {
      Opportunity.allBySiteId.resolves([]);
      const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance: [] } };
      const result = await handler(message, context);
      expect(result.status).to.equal(ok().status);
      expect(logStub.debug).to.have.been.called;
    });

    it('should handle guidance with null body', async () => {
      Opportunity.allBySiteId.resolves([]);
      const guidance = [{ body: null, insight: 'insight' }];
      const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance } };
      const result = await handler(message, context);
      expect(result.status).to.equal(ok().status);
      expect(logStub.debug).to.have.been.called;
    });

    it('should handle guidance without body property', async () => {
      Opportunity.allBySiteId.resolves([]);
      const guidance = [{ insight: 'insight', rationale: 'rationale' }];
      const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance } };
      const result = await handler(message, context);
      expect(result.status).to.equal(ok().status);
      expect(logStub.debug).to.have.been.called;
    });

    it('should handle guidance with body but no body.body', async () => {
      Opportunity.allBySiteId.resolves([]);
      const guidance = [{ body: { data: 'test' }, insight: 'insight' }];
      const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance } };
      const result = await handler(message, context);
      expect(result.status).to.equal(ok().status);
      expect(logStub.debug).to.have.been.called;
    });
  });

  describe('handler full flow coverage', () => {
    it('should log debug messages throughout the handler flow', async () => {
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
      expect(result.status).to.equal(ok().status);
      expect(logStub.debug).to.have.been.calledWithMatch(/Message received for guidance:paid-cookie-consent/);
      expect(logStub.debug).to.have.been.calledWithMatch(/Fetched Audit/);
      expect(logStub.debug).to.have.been.calledWithMatch(/Creating new paid-cookie-consent opportunity/);
      expect(logStub.debug).to.have.been.calledWithMatch(/Created suggestion for opportunity/);
      expect(logStub.debug).to.have.been.calledWithMatch(/paid-cookie-consent  opportunity succesfully added/);
    });

    it('should handle case when no existing opportunities to ignore', async () => {
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
      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).to.have.been.called;
      expect(Suggestion.create).to.have.been.called;
    });

    it('should handle getGuidanceObj with guidance[0] having body property', async () => {
      Opportunity.allBySiteId.resolves([]);
      Opportunity.create.resolves(opportunityInstance);
      const guidanceWithBody = [{
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
      const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance: guidanceWithBody } };
      const result = await handler(message, context);
      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).to.have.been.called;
    });

    it('should handle getGuidanceObj with guidance[0] but no body', async () => {
      Opportunity.allBySiteId.resolves([]);
      Opportunity.create.resolves(opportunityInstance);
      const guidanceNoBody = [{
        insight: 'insight',
        rationale: 'rationale',
        recommendation: 'rec',
        metadata: { scrape_job_id: 'test-job-id' },
      }];
      const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance: guidanceNoBody } };
      const result = await handler(message, context);
      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).to.have.been.called;
    });

    it('should handle getGuidanceObj with empty guidance array', async () => {
      Opportunity.allBySiteId.resolves([]);
      const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance: [] } };
      const result = await handler(message, context);
      expect(result.status).to.equal(ok().status);
      expect(logStub.debug).to.have.been.called;
    });

    it('should handle getGuidanceObj with null guidance', async () => {
      Opportunity.allBySiteId.resolves([]);
      const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance: null } };
      const result = await handler(message, context);
      expect(result.status).to.equal(ok().status);
      expect(logStub.debug).to.have.been.called;
    });

    it('should handle mapToPaidSuggestion returning suggestion data', async () => {
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
      expect(result.status).to.equal(ok().status);
      expect(Suggestion.create).to.have.been.calledOnce;
      expect(logStub.info).to.have.been.calledWithMatch(/Created suggestion for opportunity opptyId/);
      expect(logStub.debug).to.have.been.calledWithMatch(/Created suggestion for opportunity opptyId/);
    });

    it('should handle existing opportunities with different statuses', async () => {
      const approvedOppty = {
        getId: () => 'opptyId-approved',
        getType: () => 'consent-banner',
        getStatus: () => 'APPROVED',
        getUpdatedBy: () => 'system',
        setStatus: sinon.stub(),
        save: sinon.stub().resolvesThis(),
      };
      const inProgressOppty = {
        getId: () => 'opptyId-in-progress',
        getType: () => 'consent-banner',
        getStatus: () => 'IN_PROGRESS',
        getUpdatedBy: () => 'system',
        setStatus: sinon.stub(),
        save: sinon.stub().resolvesThis(),
      };
      Opportunity.allBySiteId.resolves([approvedOppty, inProgressOppty]);
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
      expect(result.status).to.equal(ok().status);
      // Only NEW opportunities should be marked as IGNORED
      expect(approvedOppty.setStatus).to.not.have.been.called;
      expect(inProgressOppty.setStatus).to.not.have.been.called;
    });

    it('should handle existing opportunities with different updatedBy values', async () => {
      const userOppty = {
        getId: () => 'opptyId-user',
        getType: () => 'consent-banner',
        getStatus: () => 'NEW',
        getUpdatedBy: () => 'user@example.com',
        setStatus: sinon.stub(),
        save: sinon.stub().resolvesThis(),
      };
      Opportunity.allBySiteId.resolves([userOppty]);
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
      expect(result.status).to.equal(ok().status);
      // Only system opportunities should be marked as IGNORED
      expect(userOppty.setStatus).to.not.have.been.called;
    });

    it('should handle existing opportunities matching newly created opportunity ID', async () => {
      const existingOppty = {
        getId: () => 'opptyId', // Same ID as newly created
        getType: () => 'consent-banner',
        getStatus: () => 'NEW',
        getUpdatedBy: () => 'system',
        setStatus: sinon.stub(),
        save: sinon.stub().resolvesThis(),
      };
      Opportunity.allBySiteId.resolves([existingOppty]);
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
      expect(result.status).to.equal(ok().status);
      // Should not mark the newly created opportunity as IGNORED
      expect(existingOppty.setStatus).to.not.have.been.called;
    });

    it('should handle multiple existing opportunities to ignore', async () => {
      const oppty1 = {
        getId: () => 'opptyId-1',
        getType: () => 'consent-banner',
        getStatus: () => 'NEW',
        getUpdatedBy: () => 'system',
        setStatus: sinon.stub(),
        save: sinon.stub().resolvesThis(),
      };
      const oppty2 = {
        getId: () => 'opptyId-2',
        getType: () => 'consent-banner',
        getStatus: () => 'NEW',
        getUpdatedBy: () => 'system',
        setStatus: sinon.stub(),
        save: sinon.stub().resolvesThis(),
      };
      const oppty3 = {
        getId: () => 'opptyId-3',
        getType: () => 'consent-banner',
        getStatus: () => 'NEW',
        getUpdatedBy: () => 'system',
        setStatus: sinon.stub(),
        save: sinon.stub().resolvesThis(),
      };
      Opportunity.allBySiteId.resolves([oppty1, oppty2, oppty3]);
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
      expect(result.status).to.equal(ok().status);
      expect(oppty1.setStatus).to.have.been.calledWith('IGNORED');
      expect(oppty2.setStatus).to.have.been.calledWith('IGNORED');
      expect(oppty3.setStatus).to.have.been.calledWith('IGNORED');
      expect(logStub.debug).to.have.been.calledWithMatch(/Found \d+ existing NEW system opportunities/);
    });

    it('should handle getGuidanceObj returning object with spread guidance[0] and body', async () => {
      Opportunity.allBySiteId.resolves([]);
      Opportunity.create.resolves(opportunityInstance);
      const guidanceWithBody = [{
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
        extraField: 'extra',
      }];
      const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance: guidanceWithBody } };
      const result = await handler(message, context);
      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).to.have.been.called;
    });

    it('should log opportunity JSON in success message', async () => {
      Opportunity.allBySiteId.resolves([]);
      const mockOpportunity = {
        getId: () => 'opptyId',
        toJSON: () => ({ id: 'opptyId', type: 'consent-banner' }),
      };
      Opportunity.create.resolves(mockOpportunity);
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
      expect(result.status).to.equal(ok().status);
      expect(logStub.debug).to.have.been.calledWithMatch(/paid-cookie-consent  opportunity succesfully added/);
    });

    it('should handle mapToPaidSuggestion being called with correct parameters', async () => {
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
      expect(result.status).to.equal(ok().status);
      expect(Suggestion.create).to.have.been.calledOnce;
      expect(logStub.info).to.have.been.calledWithMatch(/Created suggestion for opportunity opptyId:/);
      expect(logStub.debug).to.have.been.calledWithMatch(/Created suggestion for opportunity opptyId/);
    });

    it('should handle existingMatches filtering with different getType values', async () => {
      const consentBannerOppty = {
        getId: () => 'opptyId-1',
        getType: () => 'consent-banner',
        getStatus: () => 'NEW',
        getUpdatedBy: () => 'system',
        setStatus: sinon.stub(),
        save: sinon.stub().resolvesThis(),
      };
      const otherTypeOppty = {
        getId: () => 'opptyId-2',
        getType: () => 'other-type',
        getStatus: () => 'NEW',
        getUpdatedBy: () => 'system',
        setStatus: sinon.stub(),
        save: sinon.stub().resolvesThis(),
      };
      Opportunity.allBySiteId.resolves([consentBannerOppty, otherTypeOppty]);
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
      expect(result.status).to.equal(ok().status);
      // Only consent-banner opportunities should be marked as IGNORED
      expect(consentBannerOppty.setStatus).to.have.been.calledWith('IGNORED');
      expect(otherTypeOppty.setStatus).to.not.have.been.called;
    });

    it('should handle existingMatches filtering with different status values', async () => {
      const newOppty = {
        getId: () => 'opptyId-new',
        getType: () => 'consent-banner',
        getStatus: () => 'NEW',
        getUpdatedBy: () => 'system',
        setStatus: sinon.stub(),
        save: sinon.stub().resolvesThis(),
      };
      const approvedOppty = {
        getId: () => 'opptyId-approved',
        getType: () => 'consent-banner',
        getStatus: () => 'APPROVED',
        getUpdatedBy: () => 'system',
        setStatus: sinon.stub(),
        save: sinon.stub().resolvesThis(),
      };
      Opportunity.allBySiteId.resolves([newOppty, approvedOppty]);
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
      expect(result.status).to.equal(ok().status);
      // Only NEW opportunities should be marked as IGNORED
      expect(newOppty.setStatus).to.have.been.calledWith('IGNORED');
      expect(approvedOppty.setStatus).to.not.have.been.called;
    });

    it('should handle existingMatches filtering with different updatedBy values', async () => {
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
        getUpdatedBy: () => 'user@example.com',
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
      expect(result.status).to.equal(ok().status);
      // Only system opportunities should be marked as IGNORED
      expect(systemOppty.setStatus).to.have.been.calledWith('IGNORED');
      expect(userOppty.setStatus).to.not.have.been.called;
    });

    it('should handle existingMatches filtering excluding newly created opportunity', async () => {
      const existingOppty = {
        getId: () => 'opptyId', // Same ID as newly created
        getType: () => 'consent-banner',
        getStatus: () => 'NEW',
        getUpdatedBy: () => 'system',
        setStatus: sinon.stub(),
        save: sinon.stub().resolvesThis(),
      };
      Opportunity.allBySiteId.resolves([existingOppty]);
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
      expect(result.status).to.equal(ok().status);
      // Should not mark the newly created opportunity as IGNORED
      expect(existingOppty.setStatus).to.not.have.been.called;
    });

    it('should handle multiple existing opportunities being marked as IGNORED', async () => {
      const oppty1 = {
        getId: () => 'opptyId-1',
        getType: () => 'consent-banner',
        getStatus: () => 'NEW',
        getUpdatedBy: () => 'system',
        setStatus: sinon.stub(),
        save: sinon.stub().resolvesThis(),
      };
      const oppty2 = {
        getId: () => 'opptyId-2',
        getType: () => 'consent-banner',
        getStatus: () => 'NEW',
        getUpdatedBy: () => 'system',
        setStatus: sinon.stub(),
        save: sinon.stub().resolvesThis(),
      };
      const oppty3 = {
        getId: () => 'opptyId-3',
        getType: () => 'consent-banner',
        getStatus: () => 'NEW',
        getUpdatedBy: () => 'system',
        setStatus: sinon.stub(),
        save: sinon.stub().resolvesThis(),
      };
      Opportunity.allBySiteId.resolves([oppty1, oppty2, oppty3]);
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
      expect(result.status).to.equal(ok().status);
      expect(oppty1.setStatus).to.have.been.calledWith('IGNORED');
      expect(oppty2.setStatus).to.have.been.calledWith('IGNORED');
      expect(oppty3.setStatus).to.have.been.calledWith('IGNORED');
      expect(logStub.debug).to.have.been.calledWithMatch(/Found 3 existing NEW system opportunities/);
      expect(logStub.info).to.have.been.calledWithMatch(/Marked opportunity opptyId-1 as IGNORED/);
      expect(logStub.info).to.have.been.calledWithMatch(/Marked opportunity opptyId-2 as IGNORED/);
      expect(logStub.info).to.have.been.calledWithMatch(/Marked opportunity opptyId-3 as IGNORED/);
    });

    it('should execute getGuidanceObj function with guidance[0] present', async () => {
      Opportunity.allBySiteId.resolves([]);
      Opportunity.create.resolves(opportunityInstance);
      const guidanceWithFirstElement = [{
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
      const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance: guidanceWithFirstElement } };
      const result = await handler(message, context);
      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).to.have.been.called;
    });

    it('should execute getGuidanceObj function with guidance[0] having body property', async () => {
      Opportunity.allBySiteId.resolves([]);
      Opportunity.create.resolves(opportunityInstance);
      const guidanceWithBody = [{
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
      }];
      const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance: guidanceWithBody } };
      const result = await handler(message, context);
      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).to.have.been.called;
    });

    it('should execute mapToPaidOpportunity function call', async () => {
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
      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).to.have.been.calledOnce;
      // Verify mapToPaidOpportunity was called by checking the created entity
      const createCall = Opportunity.create.getCall(0).args[0];
      expect(createCall.type).to.equal('consent-banner');
      expect(createCall.origin).to.equal('AUTOMATION');
    });

    it('should execute mapToPaidSuggestion function call with all parameters', async () => {
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
      expect(result.status).to.equal(ok().status);
      expect(Suggestion.create).to.have.been.calledOnce;
      // Verify mapToPaidSuggestion was called with correct parameters
      const suggestionArg = Suggestion.create.getCall(0).args[0];
      expect(suggestionArg.opportunityId).to.equal('opptyId');
      expect(suggestionArg.type).to.equal('CONTENT_UPDATE');
    });

    it('should execute all handler lines including log statements', async () => {
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
      expect(result.status).to.equal(ok().status);
      expect(logStub.debug).to.have.been.calledWithMatch(/Message received for guidance:paid-cookie-consent handler/);
      expect(logStub.debug).to.have.been.calledWithMatch(/Fetched Audit/);
      expect(logStub.debug).to.have.been.calledWithMatch(/Creating new paid-cookie-consent opportunity/);
      expect(logStub.info).to.have.been.calledWithMatch(/Created suggestion for opportunity/);
      expect(logStub.debug).to.have.been.calledWithMatch(/paid-cookie-consent  opportunity succesfully added/);
    });

    it('should execute mergeTagsWithHardcodedTags call', async () => {
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
      expect(result.status).to.equal(ok().status);
      expect(mockTagMappings.mergeTagsWithHardcodedTags).to.have.been.calledWith('consent-banner', sinon.match.array);
    });
  });
});
