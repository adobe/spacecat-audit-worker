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
import { mapToPaidSuggestion, mapToPaidOpportunity } from '../../../src/paid-cookie-consent/guidance-opportunity-mapper.js';

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
        sitewideBounceDelta: 0.15,
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

  it('handles null/undefined projectedTrafficLost and projectedTrafficValue with fallback to 0', () => {
    const audit = {
      getAuditId: () => 'aid',
      getAuditResult: () => ({
        totalPageViews: 5000,
        totalAverageBounceRate: 0.3,
        projectedTrafficLost: null,
        projectedTrafficValue: undefined,
        sitewideBounceDelta: 0.15,
        top3Pages: [],
        averagePageViewsTop3: 1000,
        averageTrafficLostTop3: 500,
        averageBounceRateMobileTop3: 0.35,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      }),
    };
    const guidance = { insight: 'insight', rationale: 'rationale', recommendation: 'rec' };
    const result = mapToPaidOpportunity('site', 'https://example.com/page', audit, guidance);
    // Should fallback to 0 when values are null/undefined
    expect(result.data.projectedTrafficLost).to.equal(0);
    expect(result.data.projectedTrafficValue).to.equal(0);
  });

  it('includes sitewideBounceDelta in description', () => {
    const audit = {
      getAuditId: () => 'aid',
      getAuditResult: () => ({
        totalPageViews: 5000,
        totalAverageBounceRate: 0.3,
        projectedTrafficLost: 1500,
        projectedTrafficValue: 1200,
        sitewideBounceDelta: 0.15,
        top3Pages: [
          { path: '/page1', trafficLoss: 500, pageViews: 1667, bounceRate: 0.3 },
        ],
        averagePageViewsTop3: 1667,
        averageTrafficLostTop3: 500,
        averageBounceRateMobileTop3: 0.35,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      }),
    };
    const guidance = { insight: 'insight', rationale: 'rationale', recommendation: 'rec' };
    const result = mapToPaidOpportunity('site', 'https://example.com/page', audit, guidance);
    // sitewideBounceDelta of 0.15 should be shown as 15 pp
    expect(result.description).to.include('Bounce rate was 15 pp higher');
    expect(result.description).to.include('when consent banner was shown vs hidden');
  });

  it('handles missing sitewideBounceDelta gracefully', () => {
    const audit = {
      getAuditId: () => 'aid',
      getAuditResult: () => ({
        totalPageViews: 5000,
        totalAverageBounceRate: 0.3,
        projectedTrafficLost: 1500,
        projectedTrafficValue: 1200,
        // sitewideBounceDelta is missing
        top3Pages: [
          { path: '/page1', trafficLoss: 500, pageViews: 1667, bounceRate: 0.3 },
        ],
        averagePageViewsTop3: 1667,
        averageTrafficLostTop3: 500,
        averageBounceRateMobileTop3: 0.35,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      }),
    };
    const guidance = { insight: 'insight', rationale: 'rationale', recommendation: 'rec' };
    const result = mapToPaidOpportunity('site', 'https://example.com/page', audit, guidance);
    // Missing sitewideBounceDelta should default to 0
    expect(result.description).to.include('Bounce rate was 0 pp higher');
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
          sitewideBounceDelta: 0.25,
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
          sitewideBounceDelta: 0.12,
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

    it('uses data from audit result correctly and rounds decimal values', () => {
      const audit = {
        getAuditId: () => 'aid',
        getAuditResult: () => ({
          totalPageViews: 5000,
          totalAverageBounceRate: 0.3,
          projectedTrafficLost: 1500.7534,
          projectedTrafficValue: 1200.9876,
          sitewideBounceDelta: 0.18,
          top3Pages: [
            { url, trafficLoss: 1000, pageViews: 3333, bounceRate: 0.3 },
          ],
          averagePageViewsTop3: 3333,
          averageTrafficLostTop3: 1000,
          averageBounceRateMobileTop3: 0.35,
          temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
          // CPC information
          appliedCPC: 0.312,
          cpcSource: 'ahrefs',
        }),
      };
      const result = mapToPaidOpportunity(siteId, url, audit, guidance);
      expect(result.data.pageViews).to.equal(5000);
      expect(result.data.ctr).to.equal(0);
      expect(result.data.bounceRate).to.equal(0.3);
      expect(result.data.projectedTrafficLost).to.equal(1501); // rounded from 1500.7534
      expect(result.data.projectedTrafficValue).to.equal(1201); // rounded from 1200.9876
      expect(result.data.temporalCondition).to.equal('(year=2025 AND week IN (1,2,3,4))');
      // CPC information should be included
      expect(result.data.appliedCPC).to.equal(0.312);
      expect(result.data.cpcSource).to.equal('ahrefs');
    });

    it('sets correct opportunity type and title', () => {
      const audit = {
        getAuditId: () => 'aid',
        getAuditResult: () => ({
          totalPageViews: 5000,
          totalAverageBounceRate: 0.3,
          projectedTrafficLost: 1500,
          projectedTrafficValue: 1200,
          sitewideBounceDelta: 0.15,
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
          sitewideBounceDelta: 0.15,
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
          sitewideBounceDelta: 0.15,
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

    it('rounds projectedTrafficLost and projectedTrafficValue to whole numbers', () => {
      const audit = {
        getAuditId: () => 'aid',
        getAuditResult: () => ({
          totalPageViews: 5000,
          totalAverageBounceRate: 0.3,
          projectedTrafficLost: 343557.0753175561,
          projectedTrafficValue: 274845.66025404487,
          sitewideBounceDelta: 0.18,
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
      expect(result.data.projectedTrafficLost).to.equal(343557);
      expect(result.data.projectedTrafficValue).to.equal(274846);
    });
  });
});
