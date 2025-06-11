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
import rumData from '../fixtures/paid/mock-segments-data.json' with { type: 'json' };
import expectedSubmitted from '../fixtures/paid/expected-submitted-audit.json' with {type: 'json'};
import {
  paidAuditRunner, auditAndScrapeBannerOn, scrapeBannerOff, submitForMystiqueEvaluation,
} from '../../src/paid/handler.js';

use(sinonChai);
use(chaiAsPromised);
const sandbox = sinon.createSandbox();
const auditUrl = 'www.spacecat.com';

const runDataMissingType = [
  {
    key: 'pageType',
    value: [
      {
        totalSessions: 2620,
      },
    ],
  },
];

const runDataUrlMissingType = [
  {
    key: 'url',
    value: [
      {
        totalSessions: 2620,
        url: 'some-url',
      },
      {
        totalSessions: 2620,
      },
    ],
  },
  {
    key: 'pageType',
    value: [
      {
        totalSessions: 2620,
        type: 'new-type',
      },
      {
        totalSessions: 2620,
      },
      {
        totalSessions: 2620,
        pageType: 'uncategorized',
      },
    ],
  },
];

const pageTypes = {
  Homepage: /https?:\/\/[^/]+\/(home\/?|$)/i,
  Developer: /https?:\/\/[^/]+\/developer(\/|$)/i,
  Documentation: /https?:\/\/[^/]+\/docs(\/|$)/i,
  Tools: /https?:\/\/[^/]+\/tools\/rum\/explorer\.html$/i,
  'other | Other Pages': /.*/, // fallback
};

function getSite(overrides = {}) {
  const config = Object.entries(pageTypes).map(([name, patternReg]) => {
    const safeRegex = {
      pattern: patternReg.source,
      flags: patternReg.flags,
    };

    return ({
      name,
      pattern: JSON.stringify(safeRegex),
    });
  });

  const siteConfig = {
    getGroupedURLs: sandbox.stub().returns(config),
  };

  return {
    getConfig: () => siteConfig,
    getId: () => 'test-site-id',
    getDeliveryType: () => 'aem-edge',
    ...overrides,
  };
}

describe('Paid Audit', () => {
  const logStub = {
    info: sinon.stub(),
    debug: sinon.stub(),
    error: sinon.stub(),
    warn: sinon.stub(),
  };

  let site;
  let audit;
  let context;

  beforeEach(() => {
    site = getSite();
    audit = {
      getAuditResult: sinon.stub().returns({
        urls: [
          { url: 'https://example.com/page1' },
          { url: 'https://example.com/page2' },
        ],
      }),
      getAuditId: () => 'test-audit-id',
    };

    context = {
      runtime: { name: 'aws-lambda', region: 'us-east-1' },
      func: { package: 'spacecat-services', version: 'ci', name: 'test' },
      rumApiClient: {
        query: sandbox.stub().resolves(rumData),
      },
      dataAccess: {},
      env: {
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      site,
      audit,
      log: logStub,
      s3Client: {},
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
    };
  });

  afterEach(() => {
    nock.cleanAll();
    sandbox.restore();
  });

  const expectedSegments = ['url', 'pageType'];
  it('should submit expected rum query data', async () => {
    const result = await paidAuditRunner(auditUrl, context, site);
    const submittedSegments = (result.auditResult.map((entry) => (entry.key)));
    submittedSegments.forEach((key) => {
      expect(expectedSegments).to.include(key);
    });
    result.auditResult.forEach((resultItem) => expect(resultItem.value?.length).to.eqls(3));
    const pageTypesValues = result.auditResult.find((segment) => segment.key === 'pageType').value;
    pageTypesValues.forEach((type) => expect(type.urls.length).to.be.lessThanOrEqual(3));
    expect(result).to.deep.equal(expectedSubmitted);
  });

  it('should submit expected urls for scrapping', async () => {
    const submited = await auditAndScrapeBannerOn(context);
    expect(submited.type).to.eql('paid-top-segment-scrape-banner-on');
    expect(submited.siteId).to.eql('test-site-id');
    expect(submited.auditResult.length).to.eql(2);
    expect(submited.urls.length).to.eql(6);
    submited.urls.forEach((url) => expect(url.url).to.not.be.empty);
  });

  it('should submit values ordered by total sessions', async () => {
    const result = await paidAuditRunner(auditUrl, context, site);
    result.auditResult.forEach((segment) => {
      const values = segment.value;
      if (values.length > 1) {
        expect(values[0].totalSessions).to.be.greaterThanOrEqual(values[1].totalSessions);
      }
    });
  });

  it('should enrich urls with pageType info', async () => {
    const result = await paidAuditRunner(auditUrl, context, site);
    const urlSegment = result.auditResult.find((segment) => segment.key === 'url');
    urlSegment.value.forEach((valueItem) => {
      expect(valueItem).to.have.property('pageType');
    });
  });

  it('should handle missing page data', async () => {
    context = {
      ...context,
      rumApiClient: { query: sandbox.stub().resolves(runDataMissingType) },
    };

    const result = await paidAuditRunner(auditUrl, context, site);
    expect(result.auditResult.length).to.eql(1);
    expect(result.auditResult[0].value).to.not.have.property('pageType');
  });

  it('should handle empty query respone', async () => {
    context = {
      ...context,
      rumApiClient: { query: sandbox.stub().resolves([]) },
    };

    const result = await paidAuditRunner(auditUrl, context, site);
    expect(result.auditResult.length).to.eql(0);
  });

  it('should handle url and page type mismatch', async () => {
    context = {
      ...context,
      rumApiClient: { query: sandbox.stub().resolves(runDataUrlMissingType) },
    };

    const result = await paidAuditRunner(auditUrl, context, site);
    expect(result.auditResult.length).to.eql(2);

    const missingUrl = result.auditResult
      .find((item) => item.key === 'url')
      .value
      .find((valueItem) => !valueItem.url);

    const pageSegemnt = result.auditResult
      .find((item) => item.key === 'pageType')
      .value;
    pageSegemnt.forEach((item) => {
      expect(item).to.have.haveOwnProperty('urls');
    });
    expect(missingUrl.pageType).to.eq('other | Other Pages');
  });

  it('should handle regex settings', async () => {
    context = {
      ...context,
      rumApiClient: { query: sandbox.stub().resolves(runDataUrlMissingType) },
    };

    site = getSite(false);

    const result = await paidAuditRunner(auditUrl, context, site);
    expect(result.auditResult.length).to.eql(2);

    const missingUrl = result.auditResult
      .find((item) => item.key === 'url')
      .value
      .find((valueItem) => !valueItem.url);

    expect(missingUrl.pageType).to.eq('other | Other Pages');
  });

  it('should handle missing config', async () => {
    context = {
      ...context,
      rumApiClient: { query: sandbox.stub().resolves(runDataUrlMissingType) },
    };

    const siteWithMissingConfig = getSite({
      getConfig: () => ({
        getGroupedURLs: sandbox.stub().return(null),
      }),
    });

    const result = await paidAuditRunner(auditUrl, context, siteWithMissingConfig);
    expect(result.auditResult.length).to.eql(2);
  });

  it('should return correct scrape configuration with banner off', async () => {
    const result = await scrapeBannerOff(context);

    expect(result).to.deep.equal({
      type: 'paid-top-segment-scrape-banner-off',
      siteId: 'test-site-id',
      urls: [
        { url: 'https://example.com/page1' },
        { url: 'https://example.com/page2' },
      ],
      allowCache: false,
      options: {
        storagePrefix: 'consent-banner-off',
        screenshotTypes: ['viewport'],
        hideConsentBanners: true,
      },
    });
  });

  it('should throw error when no URLs in audit result', async () => {
    audit.getAuditResult.returns({});

    await expect(scrapeBannerOff(context))
      .to.be.rejectedWith('No URLs found in previous step audit result');
  });

  it('should throw error when URLs is not an array', async () => {
    audit.getAuditResult.returns({ urls: 'not-an-array' });

    await expect(scrapeBannerOff(context))
      .to.be.rejectedWith('No URLs found in previous step audit result');
  });

  describe('submitForMystiqueEvaluation error handling', () => {
    it('should handle empty URLs array from audit result', async () => {
      context.audit.getAuditResult = sinon.stub().returns({
        urls: [],
      });

      await expect(submitForMystiqueEvaluation(context))
        .to.be.rejectedWith('No URLs found in previous step audit result');

      expect(context.sqs.sendMessage.called).to.be.false;
    });

    it('should handle missing URLs in audit result', async () => {
      context.audit.getAuditResult = sinon.stub().returns({});

      await expect(submitForMystiqueEvaluation(context))
        .to.be.rejectedWith('No URLs found in previous step audit result');

      expect(context.sqs.sendMessage.called).to.be.false;
    });

    it('should submit expected result to mistique', async () => {
      context.audit.getAuditResult = sinon.stub().returns({
        urls: [
          { url: 'https://example.com/page1' },
          { url: 'https://example.com/page2' },
        ],
      });

      context.s3Presigner = { getSignedUrl: sinon.stub().resolves('expected-signed-url') };

      await submitForMystiqueEvaluation(context);

      expect(context.sqs.sendMessage.called).to.be.true;
      expect(logStub.info.callCount).to.be.above(1);
    });

    it('should fail on fetchUrl errors', async () => {
      context.audit.getAuditResult = sinon.stub().returns({
        urls: [
          { url: 'https://example.com/page1' },
          { url: 'https://example.com/page2' },
        ],
      });
      const expectedError = new Error('Failed to generate signed URL');
      context.s3Presigner = {
        getSignedUrl: () => {
          throw expectedError;
        },
      };

      await expect(submitForMystiqueEvaluation(context))
        .to.be.rejectedWith(expectedError);
      expect(logStub.error.callCount).to.be.above(0);
    });
  });
});
