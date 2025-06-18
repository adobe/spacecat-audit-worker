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
import rumData from '../../fixtures/paid/mock-segments-data.json' with { type: 'json' };
import expectedSubmitted from '../../fixtures/paid/expected-submitted-audit.json' with {type: 'json'};
import { paidAuditRunner, paidConsentBannerCheck } from '../../../src/paid/handler.js';

use(sinonChai);
use(chaiAsPromised);
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

function getSite(sandbox, overrides = {}) {
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
    site = getSite(sandbox);
    audit = {
      getAuditResult: sandbox.stub().returns({
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

  it('should handle missing config', async () => {
    context = {
      ...context,
      rumApiClient: { query: sandbox.stub().resolves(runDataUrlMissingType) },
    };

    const siteWithMissingConfig = getSite(sandbox);
    siteWithMissingConfig.getConfig().getGroupedURLs.returns(null);
    context.getConfig = () => siteWithMissingConfig;
    const result = await paidAuditRunner(auditUrl, context, siteWithMissingConfig);
    expect(result.auditResult.segments.length).to.eql(2);
  });

  it('should submit expected rum query data', async () => {
    const result = await paidAuditRunner(auditUrl, context, site);
    const submittedSegments = (result.auditResult.segments.map((entry) => (entry.key)));
    submittedSegments.forEach((key) => {
      expect(expectedSegments).to.include(key);
    });
    result.auditResult
      .segments.forEach((resultItem) => expect(resultItem.value?.length).to.eqls(3));
    const pageTypesValues = result.auditResult.segments.find((segment) => segment.key === 'pageType').value;
    pageTypesValues.forEach((type) => expect(type.urls.length).to.be.lessThanOrEqual(3));
    expect(result).to.deep.equal(expectedSubmitted);
  });

  it('should submit values ordered by total sessions', async () => {
    const result = await paidAuditRunner(auditUrl, context, site);
    result.auditResult.segments.forEach((segment) => {
      const values = segment.value;
      if (values.length > 1) {
        expect(values[0].totalSessions).to.be.greaterThanOrEqual(values[1].totalSessions);
      }
    });
  });

  it('should enrich urls with pageType info', async () => {
    const result = await paidAuditRunner(auditUrl, context, site);
    const urlSegment = result.auditResult.segments.find((segment) => segment.key === 'url');
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
    expect(result.auditResult.segments.length).to.eql(1);
    expect(result.auditResult.segments[0].value).to.not.have.property('pageType');
  });

  it('should handle empty query respone', async () => {
    context = {
      ...context,
      rumApiClient: { query: sandbox.stub().resolves([]) },
    };

    const result = await paidAuditRunner(auditUrl, context, site);
    expect(result.auditResult.segments.length).to.eql(0);
  });

  it('should handle url and page type mismatch', async () => {
    context = {
      ...context,
      rumApiClient: { query: sandbox.stub().resolves(runDataUrlMissingType) },
    };

    const result = await paidAuditRunner(auditUrl, context, site);
    expect(result.auditResult.segments.length).to.eql(2);

    const missingUrl = result.auditResult.segments
      .find((item) => item.key === 'url')
      .value
      .find((valueItem) => !valueItem.url);

    const pageSegemnt = result.auditResult.segments
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

    const result = await paidAuditRunner(auditUrl, context, context.site);
    expect(result.auditResult.segments.length).to.eql(2);

    const missingUrl = result.auditResult.segments
      .find((item) => item.key === 'url')
      .value
      .find((valueItem) => !valueItem.url);

    expect(missingUrl.pageType).to.eq('other | Other Pages');
  });

  it('should submit expected result to mistique', async () => {
    const auditData = {
      fullAuditRef: 'https://example.com',
      auditResult: {
        auditId: 'test-audit-id',
        urls: [
          'https://example.com/page1',
          'https://example.com/page2',
          'https://example.com',
        ],
      },
    };

    const expectedSubmitedMsg = {
      type: 'guidance:paid-cookie-consent',
      observation: 'Landing page should not have a blocking cookie concent banner',
      siteId: 'test-site-id',
      url: 'https://example.com/page1',
      auditId: 'test-audit-id',
      deliveryType: 'aem-edge',
      data: {
        url: 'https://example.com/page1',
      },
    };

    await paidConsentBannerCheck(auditUrl, auditData, context, site);

    expect(context.sqs.sendMessage.called).to.be.true;
    const sentMessage = context.sqs.sendMessage.getCall(0).args[1];
    expect(sentMessage).to.deep.include(expectedSubmitedMsg);
  });

  it('should throw exception if no urls to analyse', async () => {
    const auditData = {
      fullAuditRef: 'https://example.com',
      auditResult: {
        auditId: 'test-audit-id',
        urls: [
        ],
      },
    };

    await expect(paidConsentBannerCheck(auditUrl, auditData, context, site))
      .to.be.rejectedWith(Error, `Failed to send page to mystique auditUrl ${auditUrl}`);

    expect(context.sqs.sendMessage.called).to.be.false;
  });
});
