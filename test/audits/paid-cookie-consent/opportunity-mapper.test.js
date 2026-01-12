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

import { expect } from 'chai';
import sinon from 'sinon';
import { describe } from 'mocha';
import { ScrapeClient } from '@adobe/spacecat-shared-scrape-client';
import { Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';
import { CopyObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { mapToPaidSuggestion, mapToPaidOpportunity, isLowSeverityGuidanceBody } from '../../../src/paid-cookie-consent/guidance-opportunity-mapper.js';

const TEST_SITE_ID = 'some-id';
const TEST_SITE = 'https://sample-page';

describe('Paid Cookie Consent opportunity mapper', () => {
  let sandbox;
  let mockLog;
  let mockS3Client;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Mock logger
    mockLog = {
      debug: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    };

    // Mock S3 client
    mockS3Client = {
      send: sandbox.stub().resolves(),
    };

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
  });

  it('handles null and undefined values in description formatting', () => {
    const audit = {
      getAuditId: () => 'aid',
      getAuditResult: () => ({
        totalPageViews: 5000,
        totalAverageBounceRate: 0.3,
        projectedTrafficLost: 1500,
        projectedTrafficValue: 1200,
        top3Pages: [],
        averagePageViewsTop3: null,
        averageTrafficLostTop3: undefined,
        averageBounceRateMobileTop3: 0.35,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      }),
    };
    const guidance = { insight: 'insight', rationale: 'rationale', recommendation: 'rec' };
    const result = mapToPaidOpportunity('site', 'https://example.com/page', audit, guidance);
    // Should handle null/undefined gracefully and show '0'
    expect(result.description).to.include('0');
  });
  it('handles plain markdown string with requiresValidation=true', async () => {
    const context = {
      env: {},
      log: mockLog,
      s3Client: mockS3Client,
      dataAccess: {
        Suggestion: {
          STATUSES: SuggestionDataAccess.STATUSES,
          TYPES: SuggestionDataAccess.TYPES,
        }
      },
      site: { requiresValidation: true }
    };
    const guidance = { body: { data: {
        mobile: 'mobile markdown',
        desktop: 'desktop markdown',
        impact: {
          business: 'business markdown',
          user: 'user markdown',
        },
    }, }, metadata: { scrape_job_id: 'test-job' } };
    const result = await mapToPaidSuggestion(context, TEST_SITE_ID, 'oppId', TEST_SITE, guidance);
    expect(result.data.mobile).to.include('mobile markdown');
    expect(result.data.desktop).to.include('desktop markdown');
    expect(result.data.impact.business).to.include('business markdown');
    expect(result.data.impact.user).to.include('user markdown');
    expect(result.status).to.equal('PENDING_VALIDATION');
  });

  it('handles plain markdown string with requiresValidation=false', async () => {
    const context = {
      env: {},
      log: mockLog,
      s3Client: mockS3Client,
      dataAccess: {
        Suggestion: {
          STATUSES: SuggestionDataAccess.STATUSES,
          TYPES: SuggestionDataAccess.TYPES,
        }
      },
      site: { requiresValidation: false }
    };
    const guidance = { body: { data: {
        mobile: 'mobile markdown',
        desktop: 'desktop markdown',
        impact: {
          business: 'business markdown',
          user: 'user markdown',
        },
    }, }, metadata: { scrape_job_id: 'test-job' } };
    const result = await mapToPaidSuggestion(context, TEST_SITE_ID, 'oppId', TEST_SITE, guidance);
    expect(result.data.mobile).to.include('mobile markdown');
    expect(result.data.desktop).to.include('desktop markdown');
    expect(result.data.impact.business).to.include('business markdown');
    expect(result.data.impact.user).to.include('user markdown');
    expect(result.status).to.equal('NEW');
  });

  it('handles plain markdown string with double-escaped newlines', async () => {
    const context = {
      env: {},
      log: mockLog,
      s3Client: mockS3Client,
      dataAccess: {
        Suggestion: {
          STATUSES: SuggestionDataAccess.STATUSES,
          TYPES: SuggestionDataAccess.TYPES,
        }
      },
      site: { requiresValidation: true }
    };
    const guidance = { body: { data: {
      mobile: 'mobile markdown',
      desktop: 'desktop markdown',
      impact: {
        business: 'business markdown',
        user: 'user markdown',
      },
    }, }, metadata: { scrape_job_id: 'test-job' } };
    const result = await mapToPaidSuggestion(context, TEST_SITE_ID, 'oppId', TEST_SITE, guidance);
    expect(result.data.mobile).to.include('mobile markdown');
    expect(result.data.desktop).to.include('desktop markdown');
    expect(result.data.impact.business).to.include('business markdown');
    expect(result.data.impact.user).to.include('user markdown');
    expect(result.status).to.equal('PENDING_VALIDATION');
  });

  it('handles serialized JSON body with markdown', async () => {
    const markdown = 'Markup with\nnewlines';
    const context = {
      env: {},
      log: mockLog,
      s3Client: mockS3Client,
      dataAccess: {
        Suggestion: {
          STATUSES: SuggestionDataAccess.STATUSES,
          TYPES: SuggestionDataAccess.TYPES,
        }
      },
      site: { requiresValidation: true }
    };
    const guidance = { body: { data: {
      mobile: markdown,
      desktop: 'desktop markdown',
      impact: {
        business: 'business markdown',
        user: 'user markdown',
      },
    }, }, metadata: { scrape_job_id: 'test-job' } };
    const result = await mapToPaidSuggestion(context, TEST_SITE_ID, 'oppId', TEST_SITE, guidance);
    expect(result.data.mobile).to.include('Markup with\nnewlines');
    expect(result.status).to.equal('PENDING_VALIDATION');
  });

  it('handles serialized JSON body with double-escaped newlines in markdown', async () => {
    const markdown = 'Markup with\\nnewlines';
    const context = {
      env: {},
      log: mockLog,
      s3Client: mockS3Client,
      dataAccess: {
        Suggestion: {
          STATUSES: SuggestionDataAccess.STATUSES,
          TYPES: SuggestionDataAccess.TYPES,
        }
      },
      site: { requiresValidation: false }
    };
    const guidance = { body: { data: {
      mobile: markdown,
      desktop: 'desktop markdown',
      impact: {
        business: 'business markdown',
        user: 'user markdown',
      },
    }, }, metadata: { scrape_job_id: 'test-job' } };
    const result = await mapToPaidSuggestion(context, TEST_SITE_ID, 'oppId', TEST_SITE, guidance);
    expect(result.data.mobile).to.include('Markup with\nnewlines');
    expect(result.status).to.equal('NEW');
  });

  it('handles JSON object body directly', async () => {
    const context = {
      env: {},
      log: mockLog,
      s3Client: mockS3Client,
      dataAccess: {
        Suggestion: {
          STATUSES: SuggestionDataAccess.STATUSES,
          TYPES: SuggestionDataAccess.TYPES,
        }
      },
      site: { requiresValidation: true }
    };
    const guidance = {
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
      metadata: { scrape_job_id: 'test-job' },
    };
    const result = await mapToPaidSuggestion(context, TEST_SITE_ID, 'oppId', TEST_SITE, guidance);
    expect(result.data.mobile).to.include('mobile markdown');
    expect(result.data.desktop).to.include('desktop markdown');
    expect(result.data.impact.business).to.include('business markdown');
    expect(result.data.impact.user).to.include('user markdown');
    expect(result.status).to.equal('PENDING_VALIDATION');
  });

  // Additional tests for mapToPaidOpportunity edge cases
  describe('Paid Opportunity Mapper edge cases', () => {
    const siteId = 'site';
    const url = 'https://example.com/page';
    const guidance = { insight: 'insight', rationale: 'rationale', recommendation: 'rec' };

    it('formats large numbers with K suffix in description', () => {
      const audit = {
        getAuditId: () => 'aid',
        getAuditResult: () => ({
          totalPageViews: 100000,
          totalAverageBounceRate: 0.8,
          projectedTrafficLost: 80000,
          projectedTrafficValue: 64000,
          top3Pages: [
            { url: 'https://example.com/page1', trafficLoss: 40000, pageViews: 50000, bounceRate: 0.8 },
            { url: 'https://example.com/page2', trafficLoss: 30000, pageViews: 37500, bounceRate: 0.8 },
            { url: 'https://example.com/page3', trafficLoss: 10000, pageViews: 12500, bounceRate: 0.8 },
          ],
          averagePageViewsTop3: 33333.33,
          averageTrafficLostTop3: 26666.67,
          averageBounceRateMobileTop3: 0.85,
          temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
        }),
      };
      const result = mapToPaidOpportunity(siteId, url, audit, guidance);
      // Aggregate averagePageViewsTop3 should be formatted as 33.3K
      expect(result.description).to.include('33.3K');
      // Aggregate averageTrafficLostTop3 should be formatted as 26.7K
      expect(result.description).to.include('26.7K');
    });

    it('keeps small numbers unformatted in description', () => {
      const audit = {
        getAuditId: () => 'aid',
        getAuditResult: () => ({
          totalPageViews: 1500,
          totalAverageBounceRate: 0.6,
          projectedTrafficLost: 900,
          projectedTrafficValue: 720,
          top3Pages: [
            { url: 'https://example.com/page1', trafficLoss: 500, pageViews: 833, bounceRate: 0.6 },
          ],
          averagePageViewsTop3: 500,
          averageTrafficLostTop3: 300,
          averageBounceRateMobileTop3: 0.65,
          temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
        }),
      };
      const result = mapToPaidOpportunity(siteId, url, audit, guidance);
      // Small numbers should stay unformatted
      expect(result.description).to.include('500');
      expect(result.description).to.include('300');
    });

    it('uses data from audit result correctly', () => {
      const audit = {
        getAuditId: () => 'aid',
        getAuditResult: () => ({
          totalPageViews: 5000,
          totalAverageBounceRate: 0.3,
          projectedTrafficLost: 1500,
          projectedTrafficValue: 1200,
          top3Pages: [
            { url, trafficLoss: 1000, pageViews: 3333, bounceRate: 0.3 },
          ],
          averagePageViewsTop3: 3333,
          averageTrafficLostTop3: 1000,
          averageBounceRateMobileTop3: 0.35,
          temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
        }),
      };
      const result = mapToPaidOpportunity(siteId, url, audit, guidance);
      expect(result.data.pageViews).to.equal(5000);
      expect(result.data.ctr).to.equal(0);
      expect(result.data.bounceRate).to.equal(0.3);
      expect(result.data.projectedTrafficLost).to.equal(1500);
      expect(result.data.projectedTrafficValue).to.equal(1200);
      expect(result.data.temporalCondition).to.equal('(year=2025 AND week IN (1,2,3,4))');
    });

    it('sets correct opportunity type and title', () => {
      const audit = {
        getAuditId: () => 'aid',
        getAuditResult: () => ({
          totalPageViews: 5000,
          totalAverageBounceRate: 0.3,
          projectedTrafficLost: 1500,
          projectedTrafficValue: 1200,
          top3Pages: [],
          averagePageViewsTop3: 3333,
          averageTrafficLostTop3: 1000,
          averageBounceRateMobileTop3: 0.35,
          temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
        }),
      };
      const result = mapToPaidOpportunity(siteId, url, audit, guidance);
      expect(result.type).to.equal('consent-banner');
      expect(result.data.opportunityType).to.equal('paid-cookie-consent');
      expect(result.title).to.equal('Consent Banner covers essential page content');
      expect(result.origin).to.equal('AUTOMATION');
      expect(result.status).to.equal('NEW');
    });

    it('includes guidance recommendations in the opportunity', () => {
      const audit = {
        getAuditId: () => 'aid',
        getAuditResult: () => ({
          totalPageViews: 5000,
          totalAverageBounceRate: 0.3,
          projectedTrafficLost: 1500,
          projectedTrafficValue: 1200,
          top3Pages: [],
          averagePageViewsTop3: 3333,
          averageTrafficLostTop3: 1000,
          averageBounceRateMobileTop3: 0.35,
          temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
        }),
      };
      const testGuidance = {
        insight: 'test insight',
        rationale: 'test rationale',
        recommendation: 'test recommendation',
      };
      const result = mapToPaidOpportunity(siteId, url, audit, testGuidance);
      expect(result.guidance.recommendations[0].insight).to.equal('test insight');
      expect(result.guidance.recommendations[0].rationale).to.equal('test rationale');
      expect(result.guidance.recommendations[0].recommendation).to.equal('test recommendation');
      expect(result.guidance.recommendations[0].type).to.equal('guidance');
    });

    it('includes correct data sources in opportunity', () => {
      const audit = {
        getAuditId: () => 'aid',
        getAuditResult: () => ({
          totalPageViews: 5000,
          totalAverageBounceRate: 0.3,
          projectedTrafficLost: 1500,
          projectedTrafficValue: 1200,
          top3Pages: [],
          averagePageViewsTop3: 3333,
          averageTrafficLostTop3: 1000,
          averageBounceRateMobileTop3: 0.35,
          temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
        }),
      };
      const result = mapToPaidOpportunity(siteId, url, audit, guidance);
      expect(result.data.dataSources).to.include('Site');
      expect(result.data.dataSources).to.include('RUM');
      expect(result.data.dataSources).to.include('Page');
    });
  });

  describe('isLowSeverityGuidanceBody', () => {
    it('should return true for "none" severity', () => {
      const body = { issueSeverity: 'none' };
      expect(isLowSeverityGuidanceBody(body)).to.be.true;
    });

    it('should return true for "low" severity', () => {
      const body = { issueSeverity: 'low' };
      expect(isLowSeverityGuidanceBody(body)).to.be.true;
    });

    it('should return true for "LOW" severity (case insensitive)', () => {
      const body = { issueSeverity: 'LOW' };
      expect(isLowSeverityGuidanceBody(body)).to.be.true;
    });

    it('should return true for "None" severity (case insensitive)', () => {
      const body = { issueSeverity: 'None' };
      expect(isLowSeverityGuidanceBody(body)).to.be.true;
    });

    it('should return false for "high" severity', () => {
      const body = { issueSeverity: 'high' };
      expect(isLowSeverityGuidanceBody(body)).to.be.false;
    });

    it('should return false for "medium" severity', () => {
      const body = { issueSeverity: 'medium' };
      expect(isLowSeverityGuidanceBody(body)).to.be.false;
    });

    it('should return false when issueSeverity is missing', () => {
      const body = {};
      expect(isLowSeverityGuidanceBody(body)).to.be.false;
    });

    it('should return false when body is null', () => {
      expect(isLowSeverityGuidanceBody(null)).to.be.false;
    });

    it('should return false when body is undefined', () => {
      expect(isLowSeverityGuidanceBody(undefined)).to.be.false;
    });
  });

  describe('copySuggestedScreenshots', () => {
    it('should copy screenshots when buckets are configured', async () => {
      const context = {
        env: {
          S3_MYSTIQUE_BUCKET_NAME: 'mystique-bucket',
          S3_SCRAPER_BUCKET_NAME: 'scraper-bucket',
        },
        log: mockLog,
        s3Client: mockS3Client,
      };

      const guidance = {
        body: { data: { mobile: 'mobile', desktop: 'desktop' } },
        metadata: { scrape_job_id: 'test-job' },
      };

      await mapToPaidSuggestion(context, TEST_SITE_ID, 'oppId', TEST_SITE, guidance);

      expect(mockS3Client.send).to.have.been.calledWith(sinon.match.instanceOf(HeadObjectCommand));
      expect(mockS3Client.send).to.have.been.calledWith(sinon.match.instanceOf(CopyObjectCommand));
      expect(mockLog.debug).to.have.been.calledWithMatch(/Starting screenshot copy/);
      expect(mockLog.debug).to.have.been.calledWithMatch(/Successfully copied/);
    });

    it('should skip copying when mystique bucket is missing', async () => {
      const context = {
        env: {
          S3_SCRAPER_BUCKET_NAME: 'scraper-bucket',
        },
        log: mockLog,
        s3Client: mockS3Client,
      };

      const guidance = {
        body: { data: { mobile: 'mobile', desktop: 'desktop' } },
        metadata: { scrape_job_id: 'test-job' },
      };

      await mapToPaidSuggestion(context, TEST_SITE_ID, 'oppId', TEST_SITE, guidance);

      expect(mockLog.warn).to.have.been.calledWithMatch(/S3 bucket configuration missing/);
      expect(mockS3Client.send).not.to.have.been.called;
    });

    it('should skip copying when scraper bucket is missing', async () => {
      const context = {
        env: {
          S3_MYSTIQUE_BUCKET_NAME: 'mystique-bucket',
        },
        log: mockLog,
        s3Client: mockS3Client,
      };

      const guidance = {
        body: { data: { mobile: 'mobile', desktop: 'desktop' } },
        metadata: { scrape_job_id: 'test-job' },
      };

      await mapToPaidSuggestion(context, TEST_SITE_ID, 'oppId', TEST_SITE, guidance);

      expect(mockLog.warn).to.have.been.calledWithMatch(/S3 bucket configuration missing/);
      expect(mockS3Client.send).not.to.have.been.called;
    });

    it('should handle file not found error gracefully', async () => {
      const notFoundError = new Error('Not Found');
      notFoundError.name = 'NotFound';
      mockS3Client.send.onFirstCall().rejects(notFoundError);

      const context = {
        env: {
          S3_MYSTIQUE_BUCKET_NAME: 'mystique-bucket',
          S3_SCRAPER_BUCKET_NAME: 'scraper-bucket',
        },
        log: mockLog,
        s3Client: mockS3Client,
      };

      const guidance = {
        body: { data: { mobile: 'mobile', desktop: 'desktop' } },
        metadata: { scrape_job_id: 'test-job' },
      };

      await mapToPaidSuggestion(context, TEST_SITE_ID, 'oppId', TEST_SITE, guidance);

      expect(mockLog.warn).to.have.been.calledWithMatch(/Suggested screenshot.*not found/);
    });

    it('should handle NoSuchKey error gracefully', async () => {
      const noSuchKeyError = new Error('No Such Key');
      noSuchKeyError.name = 'NoSuchKey';
      mockS3Client.send.onFirstCall().rejects(noSuchKeyError);

      const context = {
        env: {
          S3_MYSTIQUE_BUCKET_NAME: 'mystique-bucket',
          S3_SCRAPER_BUCKET_NAME: 'scraper-bucket',
        },
        log: mockLog,
        s3Client: mockS3Client,
      };

      const guidance = {
        body: { data: { mobile: 'mobile', desktop: 'desktop' } },
        metadata: { scrape_job_id: 'test-job' },
      };

      await mapToPaidSuggestion(context, TEST_SITE_ID, 'oppId', TEST_SITE, guidance);

      expect(mockLog.warn).to.have.been.calledWithMatch(/Suggested screenshot.*not found/);
    });

    it('should handle other S3 errors gracefully', async () => {
      const s3Error = new Error('S3 Service Error');
      s3Error.name = 'ServiceError';
      mockS3Client.send.onFirstCall().rejects(s3Error);

      const context = {
        env: {
          S3_MYSTIQUE_BUCKET_NAME: 'mystique-bucket',
          S3_SCRAPER_BUCKET_NAME: 'scraper-bucket',
        },
        log: mockLog,
        s3Client: mockS3Client,
      };

      const guidance = {
        body: { data: { mobile: 'mobile', desktop: 'desktop' } },
        metadata: { scrape_job_id: 'test-job' },
      };

      await mapToPaidSuggestion(context, TEST_SITE_ID, 'oppId', TEST_SITE, guidance);

      expect(mockLog.error).to.have.been.calledWithMatch(/Error copying suggested screenshot/);
    });

    it('should copy both mobile and desktop screenshots', async () => {
      const context = {
        env: {
          S3_MYSTIQUE_BUCKET_NAME: 'mystique-bucket',
          S3_SCRAPER_BUCKET_NAME: 'scraper-bucket',
        },
        log: mockLog,
        s3Client: mockS3Client,
      };

      const guidance = {
        body: { data: { mobile: 'mobile', desktop: 'desktop' } },
        metadata: { scrape_job_id: 'test-job' },
      };

      await mapToPaidSuggestion(context, TEST_SITE_ID, 'oppId', TEST_SITE, guidance);

      // Should check existence for both files
      const headObjectCalls = mockS3Client.send.getCalls().filter(
        (call) => call.args[0] instanceof HeadObjectCommand,
      );
      expect(headObjectCalls.length).to.be.at.least(2);

      // Should copy both files
      const copyObjectCalls = mockS3Client.send.getCalls().filter(
        (call) => call.args[0] instanceof CopyObjectCommand,
      );
      expect(copyObjectCalls.length).to.be.at.least(2);
    });

    it('should use correct paths for screenshot copying', async () => {
      const context = {
        env: {
          S3_MYSTIQUE_BUCKET_NAME: 'mystique-bucket',
          S3_SCRAPER_BUCKET_NAME: 'scraper-bucket',
        },
        log: mockLog,
        s3Client: mockS3Client,
      };

      const guidance = {
        body: { data: { mobile: 'mobile', desktop: 'desktop' } },
        metadata: { scrape_job_id: 'test-job-123' },
      };

      await mapToPaidSuggestion(context, TEST_SITE_ID, 'oppId', TEST_SITE, guidance);

      // Check that correct source paths are used
      const copyCalls = mockS3Client.send.getCalls().filter(
        (call) => call.args[0] instanceof CopyObjectCommand,
      );
      const mobileCopy = copyCalls.find((call) => call.args[0].input.CopySource.includes('mobile-suggested.png'));
      const desktopCopy = copyCalls.find((call) => call.args[0].input.CopySource.includes('desktop-suggested.png'));

      expect(mobileCopy).to.exist;
      expect(desktopCopy).to.exist;
      expect(mobileCopy.args[0].input.CopySource).to.include('temp/consent-banner/test-job-123/mobile-suggested.png');
      expect(desktopCopy.args[0].input.CopySource).to.include('temp/consent-banner/test-job-123/desktop-suggested.png');
    });
  });
});
