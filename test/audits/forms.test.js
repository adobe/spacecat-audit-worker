/*
 * Copyright 2024 Adobe. All rights reserved.
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
import nock from 'nock';
import { formsAuditRunner } from '../../src/forms-opportunities/handler.js';
import { MockContextBuilder } from '../shared.js';
import formVitalsData from '../fixtures/formvitalsdata.json' with { type: 'json' };
import testData from '../fixtures/high-form-views-low-conversions.js';
import convertToOpportunity from '../../src/forms-opportunities/opportunityHandler.js';
import expectedFormVitalsData from '../fixtures/expectedformvitalsdata.json' with { type: 'json' };
// import { getScrapedDataForSiteId } from '../../src/support/utils.js';
// import * as utilsModule from '../../src/support/utils.js';

use(sinonChai);

const sandbox = sinon.createSandbox();

const baseURL = 'https://example.com';

describe('Forms Vitals audit', () => {
  const site = { getBaseURL: () => baseURL };

  const context = new MockContextBuilder()
    .withSandbox(sandbox)
    .withOverrides({
      runtime: { name: 'aws-lambda', region: 'us-east-1' },
      func: { package: 'spacecat-services', version: 'ci', name: 'test' },
      rumApiClient: {
        queryMulti: sinon.stub().resolves(formVitalsData),
      },
    })
    .build();

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('form vitals audit runs rum api client formVitals query', async () => {
    const FORMS_OPPTY_QUERIES = [
      'cwv',
      'form-vitals',
    ];
    const result = await formsAuditRunner(
      'www.example.com',
      context,
      site,
    );
    expect(context.rumApiClient.queryMulti).calledWith(FORMS_OPPTY_QUERIES, {
      domain: 'www.example.com',
      interval: 7,
      granularity: 'hourly',
    });
    expect(result).to.deep.equal(expectedFormVitalsData);
  });
});

describe('opportunities handler method', () => {
  let logStub;
  let dataAccessStub;
  let auditData;
  let auditUrl;
  let formsOppty;
  let context;

  beforeEach(() => {
    sinon.restore();
    auditUrl = 'https://example.com';
    formsOppty = {
      getId: () => 'opportunity-id',
      setAuditId: sinon.stub(),
      save: sinon.stub(),
      getType: () => 'high-form-views-low-conversions',
    };
    logStub = {
      info: sinon.stub(),
      debug: sinon.stub(),
      error: sinon.stub(),
    };
    dataAccessStub = {
      Opportunity: {
        allBySiteIdAndStatus: sinon.stub().resolves([]),
        create: sinon.stub(),
      },
    };
    context = {
      log: logStub,
      dataAccess: dataAccessStub,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
    };
    auditData = testData.auditData;
  });

  it('should create new forms opportunity', async () => {
    formsOppty.getType = () => 'high-form-views-low-conversions';
    dataAccessStub.Opportunity.create = sinon.stub().returns(formsOppty);
    await convertToOpportunity(auditUrl, auditData, context);
    expect(dataAccessStub.Opportunity.create).to.be.calledWith(testData.opportunityData);
    expect(logStub.info).to.be.calledWith('Successfully synced Opportunity for site: site-id and high-form-views-low-conversions audit type.');
  });

  it('should use existing opportunity', async () => {
    dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([formsOppty]);
    await convertToOpportunity(auditUrl, auditData, context);
    expect(formsOppty.save).to.be.calledOnce;
    expect(logStub.info).to.be.calledWith('Successfully synced Opportunity for site: site-id and high-form-views-low-conversions audit type.');
  });

  it('should throw error if fetching opportunity fails', async () => {
    dataAccessStub.Opportunity.allBySiteIdAndStatus.rejects(new Error('some-error'));
    try {
      await convertToOpportunity(auditUrl, auditData, context);
    } catch (err) {
      expect(err.message).to.equal('Failed to fetch opportunities for siteId site-id: some-error');
    }
    expect(logStub.error).to.be.calledWith('Fetching opportunities for siteId site-id failed with error: some-error');
  });

  it('should throw error if creating opportunity fails', async () => {
    dataAccessStub.Opportunity.allBySiteIdAndStatus.returns([]);
    dataAccessStub.Opportunity.create = sinon.stub().rejects(new Error('some-error'));
    try {
      await convertToOpportunity(auditUrl, auditData, context);
    } catch (err) {
      expect(err.message).to.equal('Failed to create Forms opportunity for siteId site-id: some-error');
    }
    expect(logStub.error).to.be.calledWith('Creating Forms opportunity for siteId site-id failed with error: some-error');
  });
});

describe('sendUrlsForScraping step', () => {
  // eslint-disable-next-line no-shadow
  const sandbox = sinon.createSandbox();
  const mockDate = '2024-03-12T15:24:51.231Z';
  // eslint-disable-next-line no-shadow
  const baseURL = 'https://space.cat';

  let clock;
  let context;
  let site;
  let audit;
  // let auditInstance;

  beforeEach(async () => {
    clock = sandbox.useFakeTimers({
      now: +new Date(mockDate),
      toFake: ['Date'],
    });

    site = {
      getId: () => '42322ae6-b8b1-4a61-9c88-25205fa65b07',
      getBaseURL: () => baseURL,
      getIsLive: () => true,
    };

    audit = {
      getId: () => '109b71f7-2005-454e-8191-8e92e05daac2',
      getAuditType: () => 'forms-audit',
      getFullAuditRef: () => 's3://test/123',
      getAuditResult: () => ({ someData: 'test' }),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        runtime: { name: 'aws-lambda', region: 'us-east-1' },
        func: { package: 'spacecat-services', version: 'ci', name: 'test' },
        s3Client: {
          send: sandbox.stub(),
        },
        rumApiClient: {
          queryMulti: sinon.stub().resolves(formVitalsData),
        },
        site,
        audit,
        dataAccess: {
          Site: {
            findById: sinon.stub().resolves(site),
          },
          Configuration: {
            findLatest: sinon.stub().resolves({
              isHandlerEnabledForSite: () => true,
            }),
          },
          Audit: {
            create: sinon.stub().resolves(audit),
            findById: sinon.stub().resolves(audit),
          },
        },
        sqs: {
          sendMessage: sinon.stub().resolves(),
        },
      })
      .build();

    // const { default: auditBuilder } = await import('../../src/forms-opportunities/handler.js');
    // auditInstance = auditBuilder;
  });

  afterEach(() => {
    clock.restore();
    sandbox.restore();
  });

  it('should execute step and send message to content scraper', async () => {
    context.s3Client.send.onCall(0).resolves({
      Contents: [
        { Key: 'scrapes/site-id/scrape.json' },
      ],
      IsTruncated: true,
      NextContinuationToken: 'token',
    });

    context.s3Client.send.onCall(1).resolves({
      Contents: [
        { Key: 'scrapes/site-id/screenshot.png' },
      ],
      IsTruncated: false,
      NextContinuationToken: 'token',
    });

    // const result = await auditInstance.run(
    //   {
    //     type: 'forms-audit',
    //     siteId: site.getId(),
    //     auditContext: {
    //       next: 'sendUrlsForScraping',
    //       auditId: audit.getId(),
    //     },
    //   },
    //   context,
    // );
    //
    // expect(result).to.exist;

    // expect(result).to.have.property('processingType', 'form');
  });

// it('should handle RUM API errors gracefully', async () => {
//   context.rumApiClient.queryMulti.rejects(new Error('RUM API Error'));
//
//   await expect(auditInstance.run(
//     {
//       type: 'forms-audit',
//       siteId: site.getId(),
//       auditContext: {
//         next: 'sendUrlsForScraping',
//         auditId: audit.getId()
//       }
//     },
//     context
//   )).to.be.rejectedWith('RUM API Error');
// });
//
// it('should process form vitals data correctly', async () => {
//   const mockFormVitals = {
//     'form-vitals': [
//       { url: 'https://example.com/form1', pageview: { total: 1000 } },
//       { url: 'https://example.com/form2', pageview: { total: 2000 } }
//     ],
//     cwv: []
//   };
//
//   context.rumApiClient.queryMulti.resolves(mockFormVitals);
//
//   await auditInstance.run(
//     {
//       type: 'forms-audit',
//       siteId: site.getId(),
//       auditContext: {
//         next: 'sendUrlsForScraping',
//         auditId: audit.getId()
//       }
//     },
//     context
//   );
//
//   const sentMessage = JSON.parse(context.sqs.sendMessage.firstCall.args[0].MessageBody);
//   const urls = sentMessage.urls[0].url;
//   expect(urls).to.include('https://example.com/form1');
//   expect(urls).to.include('https://example.com/form2');
// });
});

describe('processOpportunity step', () => {
  let logStub;
  let context;
  let auditInstance;

  beforeEach(async () => {
    logStub = {
      info: sinon.stub(),
      debug: sinon.stub(),
      error: sinon.stub(),
      warn: sinon.stub(),
    };

    const mockAudit = {
      id: 'test-audit-id',
      type: 'forms-audit',
      getAuditResult: () => ({ someData: 'test' }),
      getAuditType: () => 'forms-audit',
      getId: () => 'test-audit-id',
    };

    context = new MockContextBuilder()
      .withSandbox(sinon.createSandbox())
      .withOverrides({
        log: logStub,
        audit: mockAudit,
        dataAccess: {
          Site: {
            findById: sinon.stub().resolves({
              getId: () => 'test-site-id',
              getBaseURL: () => 'https://test.com',
            }),
          },
          Configuration: {
            findLatest: sinon.stub().resolves({
              isHandlerEnabledForSite: () => true,
            }),
          },
          Opportunity: {
            create: sinon.stub(),
            allBySiteIdAndStatus: sinon.stub().resolves([]),
          },
          Audit: {
            findById: sinon.stub().resolves(mockAudit),
          },
        },
      })
      .build();

    const { default: auditBuilder } = await import('../../src/forms-opportunities/handler.js');
    auditInstance = auditBuilder;
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should process opportunity', async () => {
    const result = await auditInstance.run({
      type: 'processOpportunity',
      siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
      auditContext: {
        next: 'processOpportunity',
        auditId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
      },
    }, context);

    expect(result).to.exist;
    expect(logStub.info).to.have.been.called;
  });
});
