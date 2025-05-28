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
import { paidAuditRunner } from '../../src/paid/handler.js';

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
  'homepage | Homepage': /^\/(home\/?)?$/,
  'homepage | Homepage (Customer Variant)': /^\/homepage(-customer)?(\/|$)/i,
  'productpage | Product/Feature Pages': /^\/(products?|features?|services?)(\/|$)/i,
  'other | Other Pages': /.*/,
};

function getSite() {
  const config = Object.entries(pageTypes).map(([name, patternReg]) => {
    const safeRegex = {
      pattern: patternReg.source,
      flags: patternReg.flags,
    };

    return (
      {
        name,
        pattern: JSON.stringify(safeRegex),
      });
  });

  const siteConfig = {
    getGroupedURLs: sandbox.stub().returns(config),
  };

  return {
    getConfig: () => siteConfig,
    getSiteId: () => 'some-id',
  };
}

describe('Paid audit incorporates optel data as input', () => {
  const logStub = {
    info: sinon.stub(),
    debug: sinon.stub(),
    error: sinon.stub(),
    warn: sinon.stub(),
  };

  let site = getSite();

  let context = {
    runtime: { name: 'aws-lambda', region: 'us-east-1' },
    func: { package: 'spacecat-services', version: 'ci', name: 'test' },
    rumApiClient: {
      query: sandbox.stub().resolves(rumData),
    },
    dataAccess: {},
    env: {},
    log: logStub,
  };

  afterEach(() => {
    nock.cleanAll();
    sandbox.restore();
  });

  const expectedSegments = ['url', 'pageType'];
  it('Paid should submit expected rum query data', async () => {
    const result = await paidAuditRunner(auditUrl, context, site);
    expect(result).to.deep.equal(expectedSubmitted);
    const submittedSegments = (result.auditResult.map((entry) => (entry.key)));
    submittedSegments.forEach((key) => expect(expectedSegments).to.include(key));
    result.auditResult.forEach((resultItem) => expect(resultItem.value?.length).to.eqls(3));
  });

  it('Paid should submit values ordered by total sessions', async () => {
    const result = await paidAuditRunner(auditUrl, context, site);
    result.auditResult.forEach((segment) => {
      const values = segment.value;
      if (values.length > 1) {
        expect(values[0].totalSessions).to.be.greaterThanOrEqual(values[1].totalSessions);
      }
    });
  });

  it('Paid should enrich urls with pageType info', async () => {
    const result = await paidAuditRunner(auditUrl, context, site);
    const urlSegment = result.auditResult.find((segment) => segment.key === 'url');
    urlSegment.value.forEach((valueItem) => {
      expect(valueItem).to.have.property('pageType');
    });
  });

  it('Paid should handle missing page data', async () => {
    context = {
      ...context,
      rumApiClient: { query: sandbox.stub().resolves(runDataMissingType) },
    };

    const result = await paidAuditRunner(auditUrl, context, site);
    expect(result.auditResult.length).to.eql(1);
    expect(result.auditResult[0].value).to.not.have.property('pageType');
  });

  it('Paid should handle empty query respone', async () => {
    context = {
      ...context,
      rumApiClient: { query: sandbox.stub().resolves([]) },
    };

    const result = await paidAuditRunner(auditUrl, context, site);
    expect(result.auditResult.length).to.eql(0);
  });

  it('Paid should handle url and page type mismatch', async () => {
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

  it('Paid should handle regex settings', async () => {
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

  it('Paid should handle missing config', async () => {
    context = {
      ...context,
      rumApiClient: { query: sandbox.stub().resolves(runDataUrlMissingType) },
    };

    const siteConfig = {
      getGroupedURLs: sandbox.stub().returns(null),
    };

    const siteWithMissingConfig = {
      getConfig: () => siteConfig,
      getSiteId: () => 'someId',
    };

    const result = await paidAuditRunner(auditUrl, context, siteWithMissingConfig);
    expect(result.auditResult.length).to.eql(2);
  });
});
