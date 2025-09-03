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

import { paidAuditRunner, paidConsentBannerCheck } from '../../../src/paid-cookie-consent/handler.js';

use(sinonChai);
use(chaiAsPromised);
const auditUrl = 'www.spacecat.com';

function getSite(sandbox, overrides = {}) {
  return {
    getId: () => 'test-site-id',
    getSiteId: () => 'test-site-id',
    getDeliveryType: () => 'aem-edge',
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
            key: 'url',
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

    // Mock AWSAthenaClient
    const mockAthenaClient = {
      query: sandbox.stub().resolves([
        {
          path: '/page1', utm_source: 'google', pageviews: 1000, bounce_rate: 0.8, consent: 'show', referrer: 'google.com',
        },
        {
          path: '/page2', utm_source: 'facebook', pageviews: 500, bounce_rate: 0.7, consent: 'show', referrer: 'facebook.com',
        },
      ]),
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

  const expectedSegments = ['url', 'urlTrafficSource', 'urlConsent'];

  it('should submit expected segments from Athena query', async () => {
    const result = await paidAuditRunner(auditUrl, context, site);
    const submittedSegments = (result.auditResult.map((entry) => (entry.key)));
    submittedSegments.forEach((key) => {
      expect(expectedSegments).to.include(key);
    });
    result.auditResult.forEach((resultItem) => expect(resultItem.value?.length)
      .to.be.greaterThanOrEqual(1));
    expect(result.auditResult.length).to.be.greaterThan(0);
  });

  it('should submit expected result to mistique with bounce rate >= 0.7 filtering', async () => {
    const auditData = {
      fullAuditRef: 'https://example.com',
      id: 'test-audit-id',
      auditResult:
        [
          {
            key: 'urlConsent',
            value: [
              {
                url: 'https://example.com/page1',
                pageViews: 100,
                bounceRate: 0.2, // Below 0.7 threshold - should be filtered out
                consent: 'show',
                projectedTrafficLost: 20,
              },
              {
                url: 'https://example.com/page2',
                pageViews: 50,
                bounceRate: 0.9, // Above 0.7 threshold - projected 45 (highest)
                consent: 'show',
                projectedTrafficLost: 45,
              },
              {
                url: 'https://example.com/page3',
                pageViews: 30,
                bounceRate: 0.8, // Above 0.7 threshold - projected 24
                consent: 'show',
                projectedTrafficLost: 24,
              },
            ],
          },
        ]
      ,
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

  it('should throw exception if no urlConsent segment found', async () => {
    const auditData = {
      fullAuditRef: 'https://example.com',
      id: 'test-audit-id',
      auditResult: [
        { key: 'url', value: [] },
        // No urlConsent segment
      ],
    };

    await expect(paidConsentBannerCheck(auditUrl, auditData, context, site))
      .to.be.rejectedWith(Error, `Failed to find urlConsent segment for consent banner audit for AuditUrl ${auditUrl}`);

    expect(context.sqs.sendMessage.called).to.be.false;
  });

  it('should warn and not send when no eligible pages found (no consent=show or bounce rate < 0.7)', async () => {
    const auditData = {
      fullAuditRef: 'https://example.com',
      id: 'test-audit-id',
      auditResult: [
        {
          key: 'urlConsent',
          value: [
            { url: 'https://example.com/page1', bounceRate: 0.6, consent: 'show' }, // bounce rate too low
            { url: 'https://example.com/page2', bounceRate: 0.8, consent: 'hide' }, // wrong consent
          ],
        },
      ],
    };

    await paidConsentBannerCheck(auditUrl, auditData, context, site);

    expect(context.sqs.sendMessage.called).to.be.false;
    expect(context.log.warn).to.have.been.calledWithMatch(/No pages with consent='show' found/);
  });

  it('should select highest projected loss from filtered pages', async () => {
    const auditData = {
      fullAuditRef: 'https://example.com',
      id: 'test-audit-id',
      auditResult: [
        {
          key: 'urlConsent',
          value: [
            {
              url: 'https://example.com/p100', pageViews: 100, bounceRate: 0.8, consent: 'show', projectedTrafficLost: 80,
            },
            {
              url: 'https://example.com/p90', pageViews: 90, bounceRate: 0.9, consent: 'show', projectedTrafficLost: 81,
            },
            {
              url: 'https://example.com/p110', pageViews: 110, bounceRate: 0.7, consent: 'show', projectedTrafficLost: 77,
            },
            // This should be selected due to highest projectedTrafficLost
            {
              url: 'https://example.com/winner', pageViews: 50, bounceRate: 1.0, consent: 'show', projectedTrafficLost: 100,
            },
          ],
        },
      ],
    };

    await paidConsentBannerCheck(auditUrl, auditData, context, site);

    expect(context.sqs.sendMessage.called).to.be.true;
    const sentMessage = context.sqs.sendMessage.getCall(0).args[1];
    expect(sentMessage.url).to.equal('https://example.com/winner');
  });

  it('should handle fewer than 3 eligible pages without error', async () => {
    const auditData = {
      fullAuditRef: 'https://example.com',
      id: 'test-audit-id',
      auditResult: [
        {
          key: 'urlConsent',
          value: [
            {
              url: 'https://example.com/high', pageViews: 50, bounceRate: 0.9, consent: 'show', projectedTrafficLost: 45,
            },
            {
              url: 'https://example.com/low', pageViews: 10, bounceRate: 0.1, consent: 'show',
            }, // Below 0.7 threshold - filtered out
          ],
        },
      ],
    };

    await paidConsentBannerCheck(auditUrl, auditData, context, site);

    expect(context.sqs.sendMessage.called).to.be.true;
    const sentMessage = context.sqs.sendMessage.getCall(0).args[1];
    expect(sentMessage.url).to.equal('https://example.com/high');
  });

  it('should filter out pages with low bounce rate', async () => {
    const auditData = {
      fullAuditRef: 'https://example.com',
      id: 'test-audit-id',
      auditResult: [
        {
          key: 'urlConsent',
          value: [
            {
              url: 'https://example.com/low-bounce', pageViews: 1000, bounceRate: 0.6, consent: 'show',
            }, // Below 0.7 - filtered
            {
              url: 'https://example.com/zero-bounce', pageViews: 500, bounceRate: 0, consent: 'show',
            }, // Below 0.7 - filtered
            {
              url: 'https://example.com/winner', pageViews: 40, bounceRate: 0.8, consent: 'show', projectedTrafficLost: 32,
            }, // Above 0.7 - selected
          ],
        },
      ],
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
    expect(result.auditResult).to.have.length(3);
    expect(context.athenaClient.query).to.have.been.calledThrice;
  });

  it('should handle query results with missing fields', async () => {
    const incompleteData = [
      {
        path: '/test-page',
        // Missing most fields to test fallback values
        utm_source: 'google',
        pageviews: '100',
      },
      {
        // Missing path to test url fallback
        url: 'https://example.com/direct-url',
        bounce_rate: '0.5',
        consent: 'show',
      },
    ];

    const contextWithIncompleteData = {
      ...context,
      athenaClient: {
        query: sandbox.stub().resolves(incompleteData),
      },
    };

    const result = await paidAuditRunner(auditUrl, contextWithIncompleteData, site);

    expect(result.auditResult).to.have.length(3);
    const urlSegment = result.auditResult.find((s) => s.key === 'url');

    // First item should have constructed URL from path
    expect(urlSegment.value[0].url).to.equal('https://example.com/test-page');
    expect(urlSegment.value[0].ctr).to.equal(0); // Default fallback
    expect(urlSegment.value[0].consent).to.equal(''); // Default fallback

    // Second item should use provided URL directly
    expect(urlSegment.value[1].url).to.equal('https://example.com/direct-url');
    expect(urlSegment.value[1].bounceRate).to.equal(0.5);
    expect(urlSegment.value[1].consent).to.equal('show');
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

  it('should throw error when audit result is invalid for consent banner check', async () => {
    const invalidAuditData = {
      id: 'test-audit-id',
      auditResult: null, // Invalid audit result
    };

    await expect(paidConsentBannerCheck(auditUrl, invalidAuditData, context, site))
      .to.be.rejectedWith(/Failed to find valid page for consent banner audit/);
  });

  it('should throw error when audit result is empty array for consent banner check', async () => {
    const emptyAuditData = {
      id: 'test-audit-id',
      auditResult: [], // Empty audit result
    };

    await expect(paidConsentBannerCheck(auditUrl, emptyAuditData, context, site))
      .to.be.rejectedWith(/Failed to find urlConsent segment/);
  });
});
