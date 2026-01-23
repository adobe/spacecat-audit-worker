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

import {
  paidAuditRunner,
  paidConsentBannerCheck,
  calculateSitewideBounceDelta,
} from '../../../src/paid-cookie-consent/handler.js';

use(sinonChai);
use(chaiAsPromised);
const auditUrl = 'www.spacecat.com';

function getSite(sandbox, overrides = {}) {
  return {
    getId: () => 'test-site-id',
    getSiteId: () => 'test-site-id',
    getDeliveryType: () => 'aem-edge',
    getBaseURL: () => 'https://example.com',
    ...overrides,
  };
}

describe('Paid Cookie Consent Audit', () => {
  let sandbox;

  let logStub;
  let site;
  let audit;
  let context;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    logStub = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      error: sandbox.stub(),
      warn: sandbox.stub(),
    };
    site = getSite(sandbox, {
      getBaseURL: () => 'https://example.com',
    });
    audit = {
      getAuditResult: sandbox.stub().returns(
        [
          {
            key: 'urlTrafficSource',
            value:
              [
                { pageViews: 71000, url: 'https://example.com/page1', topURLs: ['https://example.com/page1'] },
                { pageViews: 71000, url: 'https://example.com/page2', topURLs: ['https://example.com/page2'] },
              ],
          },
        ],
      ),
      getAuditId: () => 'test-audit-id',
    };

    // Mock AWSAthenaClient - returns different data based on query type
    const mockAthenaClient = {
      query: sandbox.stub().callsFake((query) => {
        // Bounce gap metrics query (sitewide, consent show + hidden)
        if (query.includes("consent IN ('show', 'hidden')")) {
          return Promise.resolve([
            { trf_type: 'paid', consent: 'show', pageviews: 5000, bounce_rate: 0.8 },
            { trf_type: 'paid', consent: 'hidden', pageviews: 4000, bounce_rate: 0.6 },
            { trf_type: 'earned', consent: 'show', pageviews: 3000, bounce_rate: 0.7 },
            { trf_type: 'earned', consent: 'hidden', pageviews: 2500, bounce_rate: 0.5 },
          ]);
        }
        // Page-level queries (existing mock data)
        return Promise.resolve([
          {
            path: '/page1', device: 'mobile', pageviews: 1000, bounce_rate: 0.8, traffic_loss: 800, utm_source: 'google', click_rate: 0.1, engagement_rate: 0.2, engaged_scroll_rate: 0.15, referrer: 'google.com',
          },
          {
            path: '/page2', device: 'desktop', pageviews: 500, bounce_rate: 0.7, traffic_loss: 350, utm_source: 'facebook', click_rate: 0.15, engagement_rate: 0.3, engaged_scroll_rate: 0.25, referrer: 'facebook.com',
          },
        ]);
      }),
    };

    context = {
      runtime: { name: 'aws-lambda', region: 'us-east-1' },
      func: { package: 'spacecat-services', version: 'ci', name: 'test' },
      athenaClient: mockAthenaClient,
      env: {
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
        S3_IMPORTER_BUCKET_NAME: 'test-bucket',
        ATHENA_S3_BUCKET: 'test-athena-bucket',
        RUM_METRICS_DATABASE: 'rum_metrics',
        RUM_METRICS_COMPACT_TABLE: 'compact_metrics',
      },
      site,
      audit,
      log: logStub,
      s3Client: {},
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
      dataAccess: {
        Audit: {
          findById: sandbox.stub().resolves({
            setAuditResult: sandbox.stub(),
            save: sandbox.stub().resolves(),
          }),
        },
      },
    };
  });

  afterEach(() => {
    nock.cleanAll();
    sandbox.restore();
  });

  it('should return audit result with expected structure', async () => {
    const result = await paidAuditRunner(auditUrl, context, site);
    expect(result.auditResult).to.be.an('object');
    expect(result.auditResult).to.have.property('totalPageViews');
    expect(result.auditResult).to.have.property('totalAverageBounceRate');
    expect(result.auditResult).to.have.property('projectedTrafficLost');
    expect(result.auditResult).to.have.property('projectedTrafficValue');
    expect(result.auditResult).to.have.property('sitewideBounceDelta');
    expect(result.auditResult).to.have.property('top3Pages');
    expect(result.auditResult).to.have.property('averagePageViewsTop3');
    expect(result.auditResult).to.have.property('averageTrafficLostTop3');
    expect(result.auditResult).to.have.property('averageBounceRateMobileTop3');
    expect(result.auditResult).to.have.property('temporalCondition');
    expect(result.auditResult.top3Pages).to.be.an('array');
    expect(result.auditResult.sitewideBounceDelta).to.be.a('number');
    expect(result.auditResult.sitewideBounceDelta).to.be.at.least(0);
  });

  it('should submit expected result to mistique with bounce rate >= 0.3 filtering', async () => {
    const auditData = {
      fullAuditRef: 'https://example.com',
      id: 'test-audit-id',
      auditResult: {
        totalPageViews: 10000,
        totalAverageBounceRate: 0.8,
        projectedTrafficLost: 8000,
        projectedTrafficValue: 6400,
        top3Pages: [
          {
            path: '/page2',
            url: 'https://example.com/page2',
            pageViews: 5000,
            bounceRate: 0.9, // Above 0.3 threshold - highest traffic loss
            trafficLoss: 4500,
          },
          {
            path: '/page3',
            url: 'https://example.com/page3',
            pageViews: 3000,
            bounceRate: 0.8, // Above 0.3 threshold
            trafficLoss: 2400,
          },
          {
            path: '/page1',
            url: 'https://example.com/page1',
            pageViews: 2000,
            bounceRate: 0.2, // Below 0.3 threshold - would be skipped if first
            trafficLoss: 400,
          },
        ],
        averagePageViewsTop3: 3333,
        averageTrafficLostTop3: 2433,
        averageBounceRateMobileTop3: 0.85,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      },
    };

    const expectedSubmitedMsg = {
      type: 'guidance:paid-cookie-consent',
      observation: 'High bounce rate detected on paid traffic page',
      siteId: 'test-site-id',
      url: 'https://example.com/page2',
      auditId: 'test-audit-id',
      deliveryType: 'aem-edge',
      data: {
        url: 'https://example.com/page2',
      },
    };

    await paidConsentBannerCheck(auditUrl, auditData, context, site);

    expect(context.sqs.sendMessage.called).to.be.true;
    const sentMessage = context.sqs.sendMessage.getCall(0).args[1];
    expect(sentMessage).to.deep.include(expectedSubmitedMsg);
  });

  it('should warn and not send when no top3Pages found', async () => {
    const auditData = {
      fullAuditRef: 'https://example.com',
      id: 'test-audit-id',
      auditResult: {
        totalPageViews: 0,
        totalAverageBounceRate: 0,
        projectedTrafficLost: 0,
        projectedTrafficValue: 0,
        top3Pages: [], // No pages
        averagePageViewsTop3: 0,
        averageTrafficLostTop3: 0,
        averageBounceRateMobileTop3: 0,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      },
    };

    await paidConsentBannerCheck(auditUrl, auditData, context, site);

    expect(context.sqs.sendMessage.called).to.be.false;
    expect(context.log.warn).to.have.been.calledWithMatch(/No pages with consent='show' found/);
  });

  it('should warn and not send when first page has bounce rate < 0.3', async () => {
    const auditData = {
      fullAuditRef: 'https://example.com',
      id: 'test-audit-id',
      auditResult: {
        totalPageViews: 5000,
        totalAverageBounceRate: 0.2,
        projectedTrafficLost: 1000,
        projectedTrafficValue: 800,
        top3Pages: [
          {
            url: '/page1',
            pageViews: 5000,
            bounceRate: 0.2, // Below 0.3 threshold
            trafficLoss: 1000,
          },
        ],
        averagePageViewsTop3: 5000,
        averageTrafficLostTop3: 1000,
        averageBounceRateMobileTop3: 0.25,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      },
    };

    await paidConsentBannerCheck(auditUrl, auditData, context, site);

    expect(context.sqs.sendMessage.called).to.be.false;
    expect(context.log.debug).to.have.been.calledWithMatch(/Skipping mystique evaluation step for page/);
  });

  it('should select first page from top3Pages (highest traffic loss)', async () => {
    const auditData = {
      fullAuditRef: 'https://example.com',
      id: 'test-audit-id',
      auditResult: {
        totalPageViews: 10000,
        totalAverageBounceRate: 0.8,
        projectedTrafficLost: 8000,
        projectedTrafficValue: 6400,
        top3Pages: [
          {
            path: '/winner',
            url: 'https://example.com/winner',
            pageViews: 5000,
            bounceRate: 1.0, // Highest traffic loss - should be first
            trafficLoss: 5000,
          },
          {
            path: '/p90',
            url: 'https://example.com/p90',
            pageViews: 3000,
            bounceRate: 0.9,
            trafficLoss: 2700,
          },
          {
            path: '/p80',
            url: 'https://example.com/p80',
            pageViews: 2000,
            bounceRate: 0.8,
            trafficLoss: 1600,
          },
        ],
        averagePageViewsTop3: 3333,
        averageTrafficLostTop3: 3100,
        averageBounceRateMobileTop3: 0.9,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      },
    };

    await paidConsentBannerCheck(auditUrl, auditData, context, site);

    expect(context.sqs.sendMessage.called).to.be.true;
    const sentMessage = context.sqs.sendMessage.getCall(0).args[1];
    expect(sentMessage.url).to.equal('https://example.com/winner');
  });

  it('should handle fewer than 3 pages without error', async () => {
    const auditData = {
      fullAuditRef: 'https://example.com',
      id: 'test-audit-id',
      auditResult: {
        totalPageViews: 1000,
        totalAverageBounceRate: 0.9,
        projectedTrafficLost: 900,
        projectedTrafficValue: 720,
        top3Pages: [
          {
            path: '/high',
            url: 'https://example.com/high',
            pageViews: 1000,
            bounceRate: 0.9, // Above 0.3 threshold
            trafficLoss: 900,
          },
        ],
        averagePageViewsTop3: 1000,
        averageTrafficLostTop3: 900,
        averageBounceRateMobileTop3: 0.95,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      },
    };

    await paidConsentBannerCheck(auditUrl, auditData, context, site);

    expect(context.sqs.sendMessage.called).to.be.true;
    const sentMessage = context.sqs.sendMessage.getCall(0).args[1];
    expect(sentMessage.url).to.equal('https://example.com/high');
  });

  it('should send message when first page has bounce rate >= 0.3', async () => {
    const auditData = {
      fullAuditRef: 'https://example.com',
      id: 'test-audit-id',
      auditResult: {
        totalPageViews: 5000,
        totalAverageBounceRate: 0.8,
        projectedTrafficLost: 4000,
        projectedTrafficValue: 3200,
        top3Pages: [
          {
            path: '/winner',
            url: 'https://example.com/winner',
            pageViews: 3000,
            bounceRate: 0.8, // Above 0.3 - should send
            trafficLoss: 2400,
          },
          {
            path: '/low-bounce',
            url: 'https://example.com/low-bounce',
            pageViews: 2000,
            bounceRate: 0.2, // Below 0.3 but not first
            trafficLoss: 400,
          },
        ],
        averagePageViewsTop3: 2500,
        averageTrafficLostTop3: 1400,
        averageBounceRateMobileTop3: 0.5,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      },
    };

    await paidConsentBannerCheck(auditUrl, auditData, context, site);

    expect(context.sqs.sendMessage.called).to.be.true;
    const sentMessage = context.sqs.sendMessage.getCall(0).args[1];
    expect(sentMessage.url).to.equal('https://example.com/winner');
  });

  it('should throw error when S3_IMPORTER_BUCKET_NAME is missing', async () => {
    const contextWithoutBucket = {
      ...context,
      env: {
        RUM_METRICS_DATABASE: 'rum_metrics',
        RUM_METRICS_COMPACT_TABLE: 'compact_metrics',
      },
    };

    await expect(paidAuditRunner(auditUrl, contextWithoutBucket, site))
      .to.be.rejectedWith('S3_IMPORTER_BUCKET_NAME must be provided for paid audit');
  });

  it('should use default values for missing database and table env vars', async () => {
    const contextWithDefaults = {
      ...context,
      env: {
        S3_IMPORTER_BUCKET_NAME: 'test-bucket',
        // Missing RUM_METRICS_DATABASE and RUM_METRICS_COMPACT_TABLE to test defaults
      },
    };

    const result = await paidAuditRunner(auditUrl, contextWithDefaults, site);

    // Should still work with default values
    expect(result.auditResult).to.be.an('object');
    expect(result.auditResult).to.have.property('top3Pages');
    // Should call athena query 4 times (bounceGapMetrics, lostTrafficSummary, top3PagesTrafficLost, top3PagesTrafficLostByDevice)
    expect(context.athenaClient.query.callCount).to.equal(4);
  });

  it('should handle query results with missing fields', async () => {
    const incompleteData = [
      {
        path: '/test-page',
        device: 'mobile',
        // Missing most fields to test fallback values
        utm_source: 'google',
        pageviews: '100',
      },
      {
        path: '/direct-url',
        device: 'desktop',
        bounce_rate: '0.5',
      },
    ];

    const contextWithIncompleteData = {
      ...context,
      athenaClient: {
        query: sandbox.stub().callsFake((query) => {
          // Bounce gap metrics query needs consent data
          if (query.includes("consent IN ('show', 'hidden')")) {
            return Promise.resolve([
              { trf_type: 'paid', consent: 'show', pageviews: 1000, bounce_rate: 0.8 },
              { trf_type: 'paid', consent: 'hidden', pageviews: 800, bounce_rate: 0.6 },
            ]);
          }
          return Promise.resolve(incompleteData);
        }),
      },
    };

    const result = await paidAuditRunner(auditUrl, contextWithIncompleteData, site);

    expect(result.auditResult).to.be.an('object');
    expect(result.auditResult.top3Pages).to.be.an('array');
    // The transformation should handle missing fields with defaults
    expect(result.auditResult.projectedTrafficLost).to.be.a('number');
    expect(result.auditResult.projectedTrafficValue).to.be.a('number');
  });

  it('should handle athena query failures and log error', async () => {
    const failingContext = {
      ...context,
      athenaClient: {
        query: sandbox.stub().rejects(new Error('Athena connection failed')),
      },
    };

    await expect(paidAuditRunner(auditUrl, failingContext, site))
      .to.be.rejectedWith('Athena connection failed');

    expect(logStub.error).to.have.been.calledWith(sinon.match(/Paid traffic Athena query failed: Athena connection failed/));
  });

  it('should not send message when audit result has no top3Pages', async () => {
    const invalidAuditData = {
      id: 'test-audit-id',
      auditResult: {
        totalPageViews: 0,
        totalAverageBounceRate: 0,
        projectedTrafficLost: 0,
        projectedTrafficValue: 0,
        top3Pages: null, // Invalid top3Pages
        averagePageViewsTop3: 0,
        averageTrafficLostTop3: 0,
        averageBounceRateMobileTop3: 0,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      },
    };

    await paidConsentBannerCheck(auditUrl, invalidAuditData, context, site);
    expect(context.sqs.sendMessage.called).to.be.false;
  });

  it('should not send message when top3Pages is undefined', async () => {
    const emptyAuditData = {
      id: 'test-audit-id',
      auditResult: {
        totalPageViews: 0,
        totalAverageBounceRate: 0,
        projectedTrafficLost: 0,
        projectedTrafficValue: 0,
        // top3Pages is undefined
        averagePageViewsTop3: 0,
        averageTrafficLostTop3: 0,
        averageBounceRateMobileTop3: 0,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      },
    };

    await paidConsentBannerCheck(auditUrl, emptyAuditData, context, site);
    expect(context.sqs.sendMessage.called).to.be.false;
  });

  it('should calculate projectedTrafficValue as 80% of projectedTrafficLost', async () => {
    const result = await paidAuditRunner(auditUrl, context, site);
    expect(result.auditResult.projectedTrafficValue).to.equal(result.auditResult.projectedTrafficLost * 0.8);
  });

  it('should calculate averages correctly for top3Pages', async () => {
    const mockData = [
      { path: '/page1', device: 'mobile', pageviews: 1000, bounce_rate: 0.8, traffic_loss: 800, utm_source: 'google', click_rate: 0.1, engagement_rate: 0.2, engaged_scroll_rate: 0.15, referrer: 'google.com' },
      { path: '/page2', device: 'mobile', pageviews: 2000, bounce_rate: 0.9, traffic_loss: 1800, utm_source: 'facebook', click_rate: 0.15, engagement_rate: 0.1, engaged_scroll_rate: 0.25, referrer: 'facebook.com' },
      { path: '/page3', device: 'mobile', pageviews: 3000, bounce_rate: 0.7, traffic_loss: 2100, utm_source: 'twitter', click_rate: 0.2, engagement_rate: 0.3, engaged_scroll_rate: 0.35, referrer: 'twitter.com' },
    ];

    const customContext = {
      ...context,
      athenaClient: {
        query: sandbox.stub().callsFake((query) => {
          // Bounce gap metrics query needs consent data
          if (query.includes("consent IN ('show', 'hidden')")) {
            return Promise.resolve([
              { trf_type: 'paid', consent: 'show', pageviews: 5000, bounce_rate: 0.8 },
              { trf_type: 'paid', consent: 'hidden', pageviews: 4000, bounce_rate: 0.6 },
            ]);
          }
          return Promise.resolve(mockData);
        }),
      },
    };

    const result = await paidAuditRunner(auditUrl, customContext, site);

    expect(result.auditResult.averagePageViewsTop3).to.equal(2000); // (1000 + 2000 + 3000) / 3
    expect(result.auditResult.averageTrafficLostTop3).to.be.closeTo(1566.67, 0.01); // (800 + 1800 + 2100) / 3
    expect(result.auditResult.averageBounceRateMobileTop3).to.be.closeTo(0.8, 0.01); // (0.8 + 0.9 + 0.7) / 3
  });

  it('should include time field in mystique message', async () => {
    const auditData = {
      fullAuditRef: 'https://example.com',
      id: 'test-audit-id',
      auditResult: {
        totalPageViews: 10000,
        totalAverageBounceRate: 0.8,
        projectedTrafficLost: 8000,
        projectedTrafficValue: 6400,
        top3Pages: [
          {
            path: '/page1',
            url: 'https://example.com/page1',
            pageViews: 5000,
            bounceRate: 0.9,
            trafficLoss: 4500,
          },
        ],
        averagePageViewsTop3: 5000,
        averageTrafficLostTop3: 4500,
        averageBounceRateMobileTop3: 0.95,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      },
    };

    await paidConsentBannerCheck(auditUrl, auditData, context, site);

    expect(context.sqs.sendMessage.called).to.be.true;
    const sentMessage = context.sqs.sendMessage.getCall(0).args[1];
    expect(sentMessage).to.have.property('time');
    expect(sentMessage.time).to.be.a('string');
  });

  it('should log debug message with projected traffic loss', async () => {
    const auditData = {
      fullAuditRef: 'https://example.com',
      id: 'test-audit-id',
      auditResult: {
        totalPageViews: 10000,
        totalAverageBounceRate: 0.8,
        projectedTrafficLost: 8000,
        projectedTrafficValue: 6400,
        top3Pages: [
          {
            url: 'https://example.com/page1',
            pageViews: 5000,
            bounceRate: 0.9,
            trafficLoss: 4500,
          },
        ],
        averagePageViewsTop3: 5000,
        averageTrafficLostTop3: 4500,
        averageBounceRateMobileTop3: 0.95,
        temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
      },
    };

    await paidConsentBannerCheck(auditUrl, auditData, context, site);

    expect(context.log.debug).to.have.been.calledWithMatch(/projectedTrafficLoss: 4500/);
    expect(context.log.debug).to.have.been.calledWithMatch(/Completed mystique evaluation step/);
  });

  it('should handle zero totalPageViews and calculate totalAverageBounceRate as 0', async () => {
    const mockData = [
      { path: '/page1', device: 'mobile', pageviews: 0, bounce_rate: 0, traffic_loss: 0, utm_source: 'google', click_rate: 0, engagement_rate: 0, engaged_scroll_rate: 0, referrer: '' },
    ];

    const customContext = {
      ...context,
      athenaClient: {
        query: sandbox.stub().callsFake((query) => {
          // Bounce gap metrics query needs consent data with zero bounce rate delta
          if (query.includes("consent IN ('show', 'hidden')")) {
            return Promise.resolve([
              { trf_type: 'paid', consent: 'show', pageviews: 100, bounce_rate: 0.5 },
              { trf_type: 'paid', consent: 'hidden', pageviews: 100, bounce_rate: 0.5 },
            ]);
          }
          return Promise.resolve(mockData);
        }),
      },
    };

    const result = await paidAuditRunner(auditUrl, customContext, site);

    // When totalPageViews is 0, totalAverageBounceRate should default to 0
    expect(result.auditResult.totalPageViews).to.equal(0);
    expect(result.auditResult.totalAverageBounceRate).to.equal(0);
    expect(result.auditResult.projectedTrafficLost).to.equal(0);
  });

  it('should handle items with null or undefined path', async () => {
    const mockData = [
      { path: null, device: 'mobile', pageviews: 1000, bounce_rate: 0.8, traffic_loss: 800, utm_source: 'google', click_rate: 0.1, engagement_rate: 0.2, engaged_scroll_rate: 0.15, referrer: 'google.com' },
      { device: 'desktop', pageviews: 500, bounce_rate: 0.7, traffic_loss: 350, utm_source: 'facebook', click_rate: 0.15, engagement_rate: 0.3, engaged_scroll_rate: 0.25, referrer: 'facebook.com' }, // path is undefined
    ];

    const customContext = {
      ...context,
      athenaClient: {
        query: sandbox.stub().callsFake((query) => {
          // Bounce gap metrics query needs consent data
          if (query.includes("consent IN ('show', 'hidden')")) {
            return Promise.resolve([
              { trf_type: 'paid', consent: 'show', pageviews: 1000, bounce_rate: 0.8 },
              { trf_type: 'paid', consent: 'hidden', pageviews: 800, bounce_rate: 0.6 },
            ]);
          }
          return Promise.resolve(mockData);
        }),
      },
    };

    const result = await paidAuditRunner(auditUrl, customContext, site);

    expect(result.auditResult).to.be.an('object');
    expect(result.auditResult.top3Pages).to.be.an('array');
    expect(result.auditResult.top3Pages.length).to.equal(2);

    // Check that items with null/undefined path have undefined url
    const itemWithNullPath = result.auditResult.top3Pages.find(item => item.path === null);
    const itemWithUndefinedPath = result.auditResult.top3Pages.find(item => item.path === undefined);

    expect(itemWithNullPath.url).to.be.undefined;
    expect(itemWithUndefinedPath.url).to.be.undefined;
  });

  describe('calculateSitewideBounceDelta', () => {
    it('should calculate weighted bounce rate difference', () => {
      const data = [
        { consent: 'show', pageViews: 1000, bounceRate: 0.8 },
        { consent: 'hidden', pageViews: 1000, bounceRate: 0.6 },
      ];
      const delta = calculateSitewideBounceDelta(data);
      expect(delta).to.be.closeTo(0.2, 0.001);
    });

    it('should floor negative deltas at 0', () => {
      const data = [
        { consent: 'show', pageViews: 1000, bounceRate: 0.5 },
        { consent: 'hidden', pageViews: 1000, bounceRate: 0.7 },
      ];
      const delta = calculateSitewideBounceDelta(data);
      expect(delta).to.equal(0);
    });

    it('should handle empty data', () => {
      const delta = calculateSitewideBounceDelta([]);
      expect(delta).to.equal(0);
    });

    it('should weight by pageviews', () => {
      const data = [
        { consent: 'show', pageViews: 900, bounceRate: 0.8 },
        { consent: 'show', pageViews: 100, bounceRate: 0.2 },
        { consent: 'hidden', pageViews: 1000, bounceRate: 0.5 },
      ];
      // Weighted show BR = (900*0.8 + 100*0.2) / 1000 = 0.74
      // Hidden BR = 0.5
      // Delta = 0.74 - 0.5 = 0.24
      const delta = calculateSitewideBounceDelta(data);
      expect(delta).to.be.closeTo(0.24, 0.001);
    });
  });
});
