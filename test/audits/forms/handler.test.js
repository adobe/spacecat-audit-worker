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
import {
  formsAuditRunner,
  processOpportunityStep,
  runAuditAndSendUrlsForScrapingStep,
  createAccessibilityOpportunity,
  sendA11yUrlsForScrapingStep,
} from '../../../src/forms-opportunities/handler.js';
import { MockContextBuilder } from '../../shared.js';
import formVitalsData from '../../fixtures/forms/formvitalsdata.json' with { type: 'json' };
import expectedFormVitalsData from '../../fixtures/forms/expectedformvitalsdata.json' with { type: 'json' };
import expectedFormSendToScraperData from '../../fixtures/forms/expectedformsendtoscraperdata.json' with { type: 'json' };
import expectedFormA11yScraperData from '../../fixtures/forms/expectedforma11ysendtoscraperdata.json' with { type: 'json' };
import { FORM_OPPORTUNITY_TYPES } from '../../../src/forms-opportunities/constants.js';

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

  it.skip('form vitals audit runs rum api client formVitals query', async () => {
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

describe('audit and send scraping step', () => {
  let context;
  const siteId = 'test-site-id';

  // eslint-disable-next-line prefer-const
  context = new MockContextBuilder()
    .withSandbox(sandbox)
    .withOverrides({
      runtime: { name: 'aws-lambda', region: 'us-east-1' },
      func: { package: 'spacecat-services', version: 'ci', name: 'test' },
      rumApiClient: {
        queryMulti: sinon.stub().resolves(formVitalsData),
      },
      site: {
        getId: sinon.stub().returns(siteId),
      },
      dataAccessStub: {
        Opportunity: {
          allBySiteIdAndStatus: sinon.stub().resolves([]),
          create: sinon.stub(),
        },
      },
      auditUrl: 'https://example.com',
      formsOppty: {
        getId: () => 'opportunity-id',
        setAuditId: sinon.stub(),
        save: sinon.stub(),
        getType: () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION,
      },
      finalUrl: 'www.example.com',
    })
    .build();

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it.skip('run audit and send urls for scraping step', async () => {
    const FORMS_OPPTY_QUERIES = [
      'cwv',
      'form-vitals',
    ];
    const result = await runAuditAndSendUrlsForScrapingStep(context);
    expect(context.rumApiClient.queryMulti).calledWith(FORMS_OPPTY_QUERIES, {
      domain: 'www.example.com',
      interval: 15,
      granularity: 'hourly',
    });
    expect(result).to.deep.equal(expectedFormSendToScraperData);
  });

  it('send alteast 10 urls for scraping step if possible', async () => {
    const formVitals = {
      'form-vitals': [
        {
          url: 'https://example.com/form1',
          formsubmit: {},
          formview: { 'desktop:windows': 7898 },
          formengagement: { 'desktop:windows': 100 },
          pageview: { 'desktop:windows': 7898 },
        },
        {
          url: 'https://example.com/form2', formsubmit: {}, formview: {}, formengagement: {}, pageview: {},
        },
        {
          url: 'https://example.com/form3', formsubmit: {}, formview: {}, formengagement: {}, pageview: {},
        },
        {
          url: 'https://example.com/form4', formsubmit: {}, formview: {}, formengagement: {}, pageview: {},
        },
        {
          url: 'https://example.com/form5', formsubmit: {}, formview: {}, formengagement: {}, pageview: {},
        },
        {
          url: 'https://example.com/form6', formsubmit: {}, formview: {}, formengagement: {}, pageview: {},
        },
        {
          url: 'https://example.com/form7', formsubmit: {}, formview: {}, formengagement: {}, pageview: {},
        },
        {
          url: 'https://example.com/form8', formsubmit: {}, formview: {}, formengagement: {}, pageview: {},
        },
        {
          url: 'https://example.com/form9', formsubmit: {}, formview: {}, formengagement: {}, pageview: {},
        },
        {
          url: 'https://example.com/form10', formsubmit: {}, formview: {}, formengagement: {}, pageview: {},
        },
        {
          url: 'https://example.com/form11', formsubmit: {}, formview: {}, formengagement: {}, pageview: {},
        },
        {
          url: 'https://example.com/form12', formsubmit: {}, formview: {}, formengagement: {}, pageview: {},
        },
        {
          url: 'https://example.com/form13', formsubmit: {}, formview: {}, formengagement: {}, pageview: {},
        },
        {
          url: 'https://example.com/form14', formsubmit: {}, formview: {}, formengagement: {}, pageview: {},
        },
      ],
    };
    context.rumApiClient.queryMulti = sinon.stub().resolves(formVitals);
    const result = await runAuditAndSendUrlsForScrapingStep(context);
    expect(result.urls.length).to.equal(10);
  });
});

describe('send a11y urls for scraping step', () => {
  let context;
  const siteId = 'test-site-id';

  // eslint-disable-next-line prefer-const
  context = new MockContextBuilder()
    .withSandbox(sandbox)
    .withOverrides({
      runtime: { name: 'aws-lambda', region: 'us-east-1' },
      func: { package: 'spacecat-services', version: 'ci', name: 'test' },
      site: {
        getId: sinon.stub().returns(siteId),
        getBaseURL: sinon.stub().returns('https://example.com'),
        getLatestAuditByAuditType: sinon.stub().resolves({
          auditResult: {
            formVitals: formVitalsData['form-vitals'],
            auditContext: {
              interval: 15,
            },
          },
          fullAuditRef: 'www.example.com',
          siteId: 'test-site-id',
        }),
      },
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      s3Client: {
        send: sandbox.stub(),
      },
    })
    .build();

  beforeEach(() => {
    // Mock the getScrapedDataForSiteId function response
    context.s3Client.send.onCall(0).resolves({
      Contents: [
        { Key: 'scrapes/site-id/forms/scrape.json' },
      ],
      IsTruncated: false,
    });

    const mockFormResponseData = {
      ContentType: 'application/json',
      Body: {
        transformToString: sandbox.stub().resolves(JSON.stringify({
          finalUrl: 'https://www.business.adobe.com/newsletter',
          scrapeResult: [
            {
              id: 'form1',
              formType: 'newsletter',
              visibleATF: true,
              fieldCount: 3,
              formSource: '#container-1 form.newsletter',
            },
          ],
        })),
      },
    };

    context.s3Client.send.resolves(mockFormResponseData);
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('send a11y urls for scraping step', async () => {
    const result = await sendA11yUrlsForScrapingStep(context);
    expect(context.site.getLatestAuditByAuditType).calledWith('forms-opportunities');
    // Verify that the s3Client was called to get the scraped data
    expect(context.s3Client.send).to.have.been.called;
    expect(result).to.deep.equal(expectedFormA11yScraperData);
  });
});

describe('process opportunity step', () => {
  let context;
  const siteId = 'test-site-id';

  let formsOppty = {
    getId: () => 'opportunity-id',
    setAuditId: sinon.stub(),
    save: sinon.stub(),
    getType: () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION,
  };

  let dataAccessStub = {
    Opportunity: {
      allBySiteIdAndStatus: sinon.stub().resolves([]),
      create: sinon.stub().returns(formsOppty),
    },
  };

  beforeEach(() => {
    formsOppty = {
      getId: () => 'opportunity-id',
      setAuditId: sinon.stub(),
      save: sinon.stub(),
      getType: () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION,
    };

    dataAccessStub = {
      Opportunity: {
        allBySiteIdAndStatus: sinon.stub().resolves([]),
        create: sinon.stub().returns(formsOppty),
      },
    };
  });

  // eslint-disable-next-line prefer-const
  context = new MockContextBuilder()
    .withSandbox(sandbox)
    .withOverrides({
      runtime: { name: 'aws-lambda', region: 'us-east-1' },
      func: { package: 'spacecat-services', version: 'ci', name: 'test' },
      rumApiClient: {
        queryMulti: sinon.stub().resolves(formVitalsData),
      },
      site: {
        getId: sinon.stub().returns(siteId),
        getBaseURL: sinon.stub().returns('https://example.com'),
        getLatestAuditByAuditType: sinon.stub().resolves({
          auditResult: {
            formVitals: [
              {
                url: 'https://example.com/form1',
                pageview: { '2024-01-01': 1500 },
                cwv: { lcp: 2.5, fid: 0.1 },
              },
            ],
            auditContext: {
              interval: 7,
            },
          },
          fullAuditRef: 'www.example.com',
          siteId: 'test-site-id',
        }),
        auditUrl: 'https://example.com',
        formsOppty: {
          getId: 'opportunity-id',
          setAuditId: sinon.stub(),
          save: sinon.stub(),
          getType: FORM_OPPORTUNITY_TYPES.LOW_CONVERSION,
        },
      },
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      dataAccess: dataAccessStub,
      s3Client: {
        send: sandbox.stub(),
      },
      finalUrl: 'www.example.com',
    })
    .build();

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('process opportunity step', async () => {
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

    const mockFileResponse = {
      ContentType: 'application/json',
      Body: {
        transformToString: sandbox.stub().resolves(JSON.stringify({
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: '<html lang="en"><body><header><a href="/home">Home</a><a href="/about">About</a></header></body></html>',
            tags: {
              title: 'Page 1 Title',
              description: 'Page 1 Description',
              h1: ['Page 1 H1'],
            },
          },
        })),
      },
    };

    context.s3Client.send.resolves(mockFileResponse);
    formsOppty.getType = () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION;
    dataAccessStub.Opportunity.create = sinon.stub().returns(formsOppty);

    const result = await processOpportunityStep(context);
    expect(result).to.deep.equal({
      status: 'complete',
    });
  });
});

describe('send a11y issues to mystique', () => {
  let context;
  const siteId = 'test-site-id';

  beforeEach(() => {
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        runtime: { name: 'aws-lambda', region: 'us-east-1' },
        func: { package: 'spacecat-services', version: 'ci', name: 'test' },
        site: {
          getId: sinon.stub().returns(siteId),
        },
        log: {
          info: sinon.stub(),
        },
      })
      .build();

    context.dataAccess.Opportunity.allBySiteIdAndStatus = sandbox.stub().resolves([]);
    context.dataAccess.Opportunity.create = sandbox.stub().resolves();
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('should not create opportunities when no a11y data is present', async () => {
    const latestAudit = {
      siteId: 'test-site-id',
      auditId: 'test-audit-id',
      getSiteId: () => 'test-site-id',
      getAuditId: () => 'test-audit-id',
    };

    const scrapedData = {
      formA11yData: [],
    };

    await createAccessibilityOpportunity(latestAudit, scrapedData, context);
    expect(context.log.info).to.have.been.calledWith('[Form Opportunity] [Site Id: test-site-id] No a11y data found');
  });

  it('should create opportunities when a11y issues are present', async () => {
    const latestAudit = {
      siteId: 'test-site-id',
      auditId: 'test-audit-id',
      getSiteId: () => 'test-site-id',
      getAuditId: () => 'test-audit-id',
    };

    const scrapedData = {
      formA11yData: [{
        a11yResult: [{
          finalUrl: 'https://example.com/form1',
          formSource: '#form1',
          a11yIssues: [{
            issue: 'Missing alt text',
            level: 'error',
            successCriterias: ['1.1.1'],
            htmlWithIssues: '<img src="test.jpg">',
            recommendation: 'Add alt text to image',
          }],
        }],
      }],
    };

    await createAccessibilityOpportunity(latestAudit, scrapedData, context);

    expect(context.dataAccess.Opportunity.create).to.have.been.called;
    expect(context.log.info).to.have.been.calledWith('[Form Opportunity] [Site Id: test-site-id] a11y issues created');
  });
});
