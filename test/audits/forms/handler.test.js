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
import esmock from 'esmock';
import sinonChai from 'sinon-chai';
import nock from 'nock';
import {
  codeImportStep,
  formsAuditRunner,
  processOpportunityStep,
  runAuditAndSendUrlsForScrapingStep,
  sendA11yUrlsForScrapingStep,
} from '../../../src/forms-opportunities/handler.js';
import { FORM_OPPORTUNITY_TYPES } from '../../../src/forms-opportunities/constants.js';
import { MockContextBuilder } from '../../shared.js';
import formVitalsData from '../../fixtures/forms/formvitalsdata.json' with { type: 'json' };
import expectedFormVitalsData from '../../fixtures/forms/expectedformvitalsdata.json' with { type: 'json' };
import expectedFormSendToScraperData from '../../fixtures/forms/expectedformsendtoscraperdata.json' with { type: 'json' };
import expectedFormA11yScraperData from '../../fixtures/forms/expectedforma11ysendtoscraperdata.json' with { type: 'json' };
import trimmedHeavyFormVitals from '../../fixtures/forms/trimmedheavyformvitals.json' with { type: 'json' };

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
        query: sinon.stub().resolves(formVitalsData),
      },
    })
    .build();

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('form vitals audit runs rum api client formVitals query', async () => {
    const result = await formsAuditRunner(
      'www.example.com',
      context,
      site,
    );
    expect(context.rumApiClient.query).calledWith('form-vitals', {
      domain: 'www.example.com',
      interval: 15,
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
        query: sinon.stub().resolves(formVitalsData),
      },
      site: {
        getId: sinon.stub().returns(siteId),
      },
      dataAccessStub: {
        Opportunity: {
          allBySiteId: sinon.stub().resolves([]),
          create: sinon.stub(),
        },
      },
      dataAccess: {
        SiteTopForm: {
          allBySiteId: sinon.stub().resolves([]),
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

  it('run audit and send urls for scraping step', async () => {
    const result = await runAuditAndSendUrlsForScrapingStep(context);
    expect(context.rumApiClient.query).calledWith('form-vitals', {
      domain: 'www.example.com',
      interval: 15,
      granularity: 'hourly',
    });
    expect(result).to.deep.equal(expectedFormSendToScraperData);
  });

  it('send alteast 10 urls for scraping step if possible', async () => {
    const formVitals = [
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
      ];
    context.rumApiClient.query = sinon.stub().resolves(formVitals);
    const result = await runAuditAndSendUrlsForScrapingStep(context);
    expect(result.urls.length).to.equal(10);
  });

  it('should trim audit data when not safe for dynamo', async () => {
    const formVitals = [
        {
          url: 'https://example.com/form1',
          formsource: 'form.contact',
          formsubmit: {},
          formview: { 'desktop:windows': 7898 },
          formengagement: { 'desktop:windows': 100 },
          pageview: { desktop: 26002, mobile: 23101 },
        },
        {
          url: 'https://example.com/form2',
          formsource: 'form.contact',
          formsubmit: {},
          formview: {},
          formengagement: {},
          pageview: { desktop: 18000, mobile: 21000 },
        },
        {
          url: 'https://example.com/form3',
          formsource: 'form.contact',
          formsubmit: {},
          formview: {},
          formengagement: {},
          pageview: { desktop: 15000, mobile: 19000 },
        },
        {
          url: 'https://example.com/form4',
          formsource: 'form.feedback',
          formsubmit: {},
          formview: {},
          formengagement: {},
          pageview: { desktop: 22000, mobile: 20000 },
        },
        {
          url: 'https://example.com/form5',
          formsource: 'form.survey',
          formsubmit: {},
          formview: {},
          formengagement: {},
          pageview: { desktop: 12000, mobile: 14000 },
        },
        {
          url: 'https://example.com/form6',
          formsource: 'form.contact',
          formsubmit: {},
          formview: {},
          formengagement: {},
          pageview: { desktop: 30000, mobile: 25000 },
        },
        {
          url: 'https://example.com/form7',
          formsource: 'form.newsletter',
          formsubmit: {},
          formview: {},
          formengagement: {},
          pageview: { desktop: 17000, mobile: 16000 },
        },
        {
          url: 'https://example.com/form8',
          formsource: 'form.signup',
          formsubmit: {},
          formview: {},
          formengagement: {},
          pageview: { desktop: 26000, mobile: 21000 },
        },
        {
          url: 'https://example.com/form9',
          formsource: 'form.feedback',
          formsubmit: {},
          formview: {},
          formengagement: {},
          pageview: { desktop: 19000, mobile: 20000 },
        },
        {
          url: 'https://example.com/form10',
          formsource: 'form.survey',
          formsubmit: {},
          formview: {},
          formengagement: {},
          pageview: { desktop: 14000, mobile: 12000 },
        },
        {
          url: 'https://example.com/form11',
          formsource: 'form.contact',
          formsubmit: {},
          formview: {},
          formengagement: {},
          pageview: { desktop: 25000, mobile: 23000 },
        },
        {
          url: 'https://example.com/form12',
          formsource: 'form.newsletter',
          formsubmit: {},
          formview: {},
          formengagement: {},
          pageview: { desktop: 16000, mobile: 18000 },
        },
        {
          url: 'https://example.com/form13',
          formsubmit: {},
          formview: {},
          formengagement: {},
          pageview: { desktop: 21000, mobile: 20000 },
        },
        {
          url: 'https://example.com/form14',
          formsource: 'form.feedback',
          formsubmit: {},
          formview: {},
          formengagement: {},
          pageview: { desktop: 23000, mobile: 22000 },
        },
      ];

    context.rumApiClient.query = sinon.stub().resolves(formVitals);
    context.dataAccess.SiteTopForm.allBySiteId = sinon.stub().resolves([]);

    // Mock the checkDynamoItem call
    const checkDynamoItemStub = sinon.stub().returns({ safe: false, sizeKB: 150 });

    // eslint-disable-next-line no-shadow
    const { runAuditAndSendUrlsForScrapingStep } = await esmock('../../../src/forms-opportunities/handler.js', {
      '../../../src/forms-opportunities/utils.js': {
        checkDynamoItem: checkDynamoItemStub,
      },
    });

    const result = await runAuditAndSendUrlsForScrapingStep(context);
    // Verify that formVitals are trimmed
    expect(result.auditResult.formVitals).to.deep.equal(trimmedHeavyFormVitals);
  });

  it('should include top forms without form source and sort by pageviews when less than 10 urls', async () => {
    const formVitals = [
        {
          url: 'https://example.com/form1',
          formsource: 'form.contact',
          formsubmit: {},
          formview: {},
          formengagement: {},
          pageview: { 'desktop:windows': 1000 },
        },
        {
          url: 'https://example.com/form2',
          formsource: 'form.newsletter',
          formsubmit: {},
          formview: {},
          formengagement: {},
          pageview: { 'desktop:windows': 2000 },
        },
        {
          url: 'https://example.com/form3',
          formsubmit: {},
          formview: {},
          formengagement: {},
          pageview: { 'desktop:windows': 500 },
        },
      ];

    // Create mock top forms - some with and without form sources
    const mockTopForms = [
      {
        getUrl: () => 'https://example.com/top-form1',
        getFormSource: () => null, // No form source - should be included
      },
      {
        getUrl: () => 'https://example.com/top-form2',
        getFormSource: () => 'form.signup', // Has form source - should not be included
      },
      {
        getUrl: () => 'https://example.com/form1', // Existing URL
        getFormSource: () => null,
      },
    ];

    context.rumApiClient.query = sinon.stub().resolves(formVitals);
    context.dataAccess.SiteTopForm.allBySiteId = sinon.stub().resolves(mockTopForms);

    const result = await runAuditAndSendUrlsForScrapingStep(context);

    expect(context.dataAccess.SiteTopForm.allBySiteId).to.have.been.calledWith(siteId);

    // Should have URLs from opportunities + top forms without form source + sorted form vitals
    expect(result.urls.length).to.be.greaterThan(3);

    // Check that top form without form source was included
    const topFormUrl = result.urls.find((url) => url.url === 'https://example.com/top-form1');
    expect(topFormUrl).to.exist;

    // Check that form sources are properly filtered and included
    const form1 = result.urls.find((url) => url.url === 'https://example.com/form1');
    expect(form1).to.exist;
    expect(form1.formSources).to.deep.equal(['form.contact']);

    const form2 = result.urls.find((url) => url.url === 'https://example.com/form2');
    expect(form2).to.exist;
    expect(form2.formSources).to.deep.equal(['form.newsletter']);

    // Form3 should not have formSources property since it has no formsource
    const form3 = result.urls.find((url) => url.url === 'https://example.com/form3');
    expect(form3).to.exist;
    expect(form3.formSources).to.be.undefined;
  });

  it('should handle empty form vitals and only use top forms without form source', async () => {
    const formVitals = [];

    const mockTopForms = [
      {
        getUrl: () => 'https://example.com/top-form1',
        getFormSource: () => null, // No form source - should be included
      },
      {
        getUrl: () => 'https://example.com/top-form2',
        getFormSource: () => 'form.signup', // Has form source - should be included
      },
    ];

    context.rumApiClient.query = sinon.stub().resolves(formVitals);
    context.dataAccess.SiteTopForm.allBySiteId = sinon.stub().resolves(mockTopForms);

    const result = await runAuditAndSendUrlsForScrapingStep(context);

    expect(result.urls.length).to.equal(2);
    
    // Check first URL (without form source)
    const topForm1 = result.urls.find((url) => url.url === 'https://example.com/top-form1');
    expect(topForm1).to.exist;
    expect(topForm1.formSources).to.be.undefined;
    
    // Check second URL (with form source)
    const topForm2 = result.urls.find((url) => url.url === 'https://example.com/top-form2');
    expect(topForm2).to.exist;
    expect(topForm2.formSources).to.deep.equal(['form.signup']);
  });

  it('should properly handle form sources filtering from formVitals', async () => {
    const formVitals = [
        {
          url: 'https://example.com/form1',
          formsource: 'form.contact',
          formsubmit: {},
          formview: {},
          formengagement: {},
          pageview: { 'desktop:windows': 1000 },
        },
        {
          url: 'https://example.com/form1', // Same URL, different formsource
          formsource: 'form.newsletter',
          formsubmit: {},
          formview: {},
          formengagement: {},
          pageview: { 'desktop:windows': 1000 },
        },
        {
          url: 'https://example.com/form2',
          // No formsource property
          formsubmit: {},
          formview: {},
          formengagement: {},
          pageview: { 'desktop:windows': 500 },
        },
        {
          url: 'https://example.com/form3',
          // No formsource property
          formsubmit: {},
          formview: {},
          formengagement: {},
          pageview: { 'desktop:windows': 300 },
        },
      ];

    context.rumApiClient.query = sinon.stub().resolves(formVitals);
    context.dataAccess.SiteTopForm.allBySiteId = sinon.stub().resolves([]);

    const result = await runAuditAndSendUrlsForScrapingStep(context);

    // Check form1 has both form sources
    const form1 = result.urls.find((url) => url.url === 'https://example.com/form1');
    expect(form1).to.exist;
    expect(form1.formSources).to.include('form.contact');
    expect(form1.formSources).to.include('form.newsletter');
    expect(form1.formSources.length).to.equal(2);

    // Check form2 and form3 don't have formSources property
    const form2 = result.urls.find((url) => url.url === 'https://example.com/form2');
    expect(form2).to.exist;
    expect(form2.formSources).to.be.undefined;

    const form3 = result.urls.find((url) => url.url === 'https://example.com/form3');
    expect(form3).to.exist;
    expect(form3.formSources).to.be.undefined;
  });

  it('should add formSources array when existingItem has no formSources ', async () => {
    const formVitals = {
      'form-vitals': [
        {
          url: 'https://example.com/form1',
          // No formsource - this creates URL without formSources property
          formsubmit: {},
          formview: {},
          formengagement: {},
          pageview: { 'desktop:windows': 1000 },
        },
      ],
    };

    const mockTopForms = [
      {
        getUrl: () => 'https://example.com/form1', // Same URL as above
        getFormSource: () => 'form.imported-contact', // Has form source
      },
    ];

    context.rumApiClient.queryMulti = sinon.stub().resolves(formVitals);
    context.dataAccess.SiteTopForm.allBySiteId = sinon.stub().resolves(mockTopForms);

    const result = await runAuditAndSendUrlsForScrapingStep(context);

    const form1 = result.urls.find((url) => url.url === 'https://example.com/form1');
    expect(form1).to.exist;
    expect(form1.formSources).to.deep.equal(['form.imported-contact']);
  });

  it('should push formSource when existingItem has formSources but not the new one ', async () => {
    const formVitals = {
      'form-vitals': [
        {
          url: 'https://example.com/form1',
          formsource: 'form.existing-source',
          formsubmit: {},
          formview: {},
          formengagement: {},
          pageview: { 'desktop:windows': 1000 },
        },
      ],
    };

    const mockTopForms = [
      {
        getUrl: () => 'https://example.com/form1', // Same URL as above
        getFormSource: () => 'form.new-source', // Different form source
      },
    ];

    context.rumApiClient.queryMulti = sinon.stub().resolves(formVitals);
    context.dataAccess.SiteTopForm.allBySiteId = sinon.stub().resolves(mockTopForms);

    const result = await runAuditAndSendUrlsForScrapingStep(context);

    const form1 = result.urls.find((url) => url.url === 'https://example.com/form1');
    expect(form1).to.exist;
    expect(form1.formSources).to.include('form.existing-source');
    expect(form1.formSources).to.include('form.new-source');
    expect(form1.formSources.length).to.equal(2);
  });

  it('should include auditContext with data when data is provided ', async () => {
    const formVitals = {
      'form-vitals': [
        {
          url: 'https://example.com/form1',
          formsubmit: {},
          formview: {},
          formengagement: {},
          pageview: { 'desktop:windows': 1000 },
        },
      ],
    };

    const testData = { opportunityId: 'test-oppty-123', metadata: 'test-metadata' };
    const contextWithData = {
      ...context,
      data: testData,
    };

    contextWithData.rumApiClient.queryMulti = sinon.stub().resolves(formVitals);
    contextWithData.dataAccess.SiteTopForm.allBySiteId = sinon.stub().resolves([]);

    const result = await runAuditAndSendUrlsForScrapingStep(contextWithData);

    // Should include auditContext with data
    expect(result).to.have.property('auditContext');
    expect(result.auditContext).to.deep.equal({ data: testData });
    expect(contextWithData.log.info).to.have.been.calledWith(
      sinon.match(/starting audit with option:.*test-oppty-123/),
    );
  });

  it('should exclude auditContext when data is not provided ', async () => {
    const formVitals = {
      'form-vitals': [
        {
          url: 'https://example.com/form1',
          formsubmit: {},
          formview: {},
          formengagement: {},
          pageview: { 'desktop:windows': 1000 },
        },
      ],
    };

    const contextWithoutData = {
      ...context,
      data: undefined,
    };

    contextWithoutData.rumApiClient.queryMulti = sinon.stub().resolves(formVitals);
    contextWithoutData.dataAccess.SiteTopForm.allBySiteId = sinon.stub().resolves([]);

    const result = await runAuditAndSendUrlsForScrapingStep(contextWithoutData);

    // Should NOT include auditContext property at all
    expect(result).to.not.have.property('auditContext');
    expect(contextWithoutData.log.info).to.have.been.calledWith(
      sinon.match(/starting audit$/),
    );
  });

  it('should exclude auditContext when data is null ', async () => {
    const formVitals = {
      'form-vitals': [
        {
          url: 'https://example.com/form1',
          formsubmit: {},
          formview: {},
          formengagement: {},
          pageview: { 'desktop:windows': 1000 },
        },
      ],
    };

    const contextWithNullData = {
      ...context,
      data: null,
    };

    contextWithNullData.rumApiClient.queryMulti = sinon.stub().resolves(formVitals);
    contextWithNullData.dataAccess.SiteTopForm.allBySiteId = sinon.stub().resolves([]);

    const result = await runAuditAndSendUrlsForScrapingStep(contextWithNullData);

    // Should NOT include auditContext property at all
    expect(result).to.not.have.property('auditContext');
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
            formVitals: formVitalsData,
            auditContext: {
              interval: 15,
            },
          },
          fullAuditRef: 'www.example.com',
          siteId: 'test-site-id',
          getAuditResult: sinon.stub().returns({
            formVitals: formVitalsData,
          }),
        }),
      },
      dataAccess: {
        SiteTopForm: {
          allBySiteId: sinon.stub().resolves([]),
        },
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
    // Only reset the SiteTopForm mock, keep other mocks intact
    if (context.dataAccess.SiteTopForm.allBySiteId.reset) {
      context.dataAccess.SiteTopForm.allBySiteId.reset();
    }
    context.dataAccess.SiteTopForm.allBySiteId.resolves([]);

    // Setup s3Client mock for scraped data - don't reset completely
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

    context.s3Client.send.onCall(1).resolves(mockFormResponseData);
    context.s3Client.send.resolves(mockFormResponseData);
  });

  afterEach(() => {
    nock.cleanAll();
    // Don't call sinon.restore() here as it interferes with our test setup
    // sandbox.restore() is called in the main afterEach block
  });

  it('send a11y urls for scraping step', async () => {
    const result = await sendA11yUrlsForScrapingStep(context);
    expect(context.site.getLatestAuditByAuditType).calledWith('forms-opportunities');
    // Verify that the s3Client was called to get the scraped data
    expect(context.s3Client.send).to.have.been.called;
    expect(result).to.deep.equal(expectedFormA11yScraperData);
  });

  it('should merge top form URLs with existing scraped URLs', async () => {
    // Reset and setup fresh mocks for this test
    context.s3Client.send.reset();
    context.dataAccess.SiteTopForm.allBySiteId.reset();

    // Mock the scraped data response
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

    context.s3Client.send.onCall(1).resolves(mockFormResponseData);
    context.s3Client.send.resolves(mockFormResponseData);

    // Create mock top forms
    const mockTopForms = [
      {
        getUrl: () => 'https://example.com/contact-form',
        getFormSource: () => 'form.contact',
      },
      {
        getUrl: () => 'https://www.business.adobe.com/newsletter', // Existing URL
        getFormSource: () => 'form.newsletter-signup',
      },
      {
        getUrl: () => 'https://example.com/subscribe',
        getFormSource: () => null, // No form source
      },
    ];

    // Mock the SiteTopForm.allBySiteId to return the mock data
    context.dataAccess.SiteTopForm.allBySiteId.resolves(mockTopForms);

    const result = await sendA11yUrlsForScrapingStep(context);

    expect(context.dataAccess.SiteTopForm.allBySiteId).to.have.been.calledWith(siteId);
    expect(result.urls).to.have.length(2); // Original 1 + 1 new URL (only forms with form sources)

    // Check that new URLs are added
    const contactFormUrl = result.urls.find((url) => url.url === 'https://example.com/contact-form');
    expect(contactFormUrl).to.exist;
    expect(contactFormUrl.formSources).to.deep.equal(['form.contact']);

    // Check that existing URL has merged form sources
    const newsletterUrl = result.urls.find((url) => url.url === 'https://www.business.adobe.com/newsletter');
    expect(newsletterUrl).to.exist;
    expect(newsletterUrl.formSources).to.include('#container-1 form.newsletter'); // Original
    expect(newsletterUrl.formSources).to.include('form.newsletter-signup'); // Merged

    // Check URL without form source should not be included
    const subscribeUrl = result.urls.find((url) => url.url === 'https://example.com/subscribe');
    expect(subscribeUrl).to.not.exist;
  });

  it('should work correctly when no top forms are found', async () => {
    // Reset and setup fresh mocks for this test
    context.s3Client.send.reset();
    context.dataAccess.SiteTopForm.allBySiteId.reset();

    // Mock the scraped data response
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

    context.s3Client.send.onCall(1).resolves(mockFormResponseData);
    context.s3Client.send.resolves(mockFormResponseData);

    // Mock empty top forms result
    context.dataAccess.SiteTopForm.allBySiteId.resolves([]);

    const result = await sendA11yUrlsForScrapingStep(context);

    expect(context.dataAccess.SiteTopForm.allBySiteId).to.have.been.calledWith(siteId);
    // Should only contain the original scraped URL
    expect(result.urls).to.have.length(1);
    expect(result.urls[0].url).to.equal('https://www.business.adobe.com/newsletter');
    expect(result.urls[0].formSources).to.deep.equal(['#container-1 form.newsletter']);
  });

  it('should replace generic form selector with specific form source from top forms', async () => {
    // Reset and setup fresh mocks for this test
    context.s3Client.send.reset();
    context.dataAccess.SiteTopForm.allBySiteId.reset();

    // Mock scraped data that will result in a generic 'form' selector
    // This happens when forms have no formSource, no id, and no classList
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
          finalUrl: 'https://example.com/contact',
          scrapeResult: [
            {
              // Form with no formSource, no id, no classList - will fallback to 'form'
              formType: 'contact',
              visibleATF: true,
              fieldCount: 5,
            },
          ],
        })),
      },
    };

    context.s3Client.send.onCall(1).resolves(mockFormResponseData);
    context.s3Client.send.resolves(mockFormResponseData);

    // Create mock top forms with the same URL but with a specific form source
    const mockTopForms = [
      {
        getUrl: () => 'https://example.com/contact', // Same URL as scraped data
        getFormSource: () => '#contact-form', // Specific form source
      },
    ];

    // Mock the SiteTopForm.allBySiteId to return the mock data
    context.dataAccess.SiteTopForm.allBySiteId.resolves(mockTopForms);

    const result = await sendA11yUrlsForScrapingStep(context);

    expect(context.dataAccess.SiteTopForm.allBySiteId).to.have.been.calledWith(siteId);
    expect(result.urls).to.have.length(1);

    // Check that the generic 'form' was replaced with the specific form source
    const contactUrl = result.urls.find((url) => url.url === 'https://example.com/contact');
    expect(contactUrl).to.exist;
    expect(contactUrl.formSources).to.deep.equal(['#contact-form']); // Should be replaced, not pushed
  });

  it('should append form source to existing non-generic form sources from top forms', async () => {
    // Reset and setup fresh mocks for this test
    context.s3Client.send.reset();
    context.dataAccess.SiteTopForm.allBySiteId.reset();

    // Mock scraped data that has a specific form source (not generic 'form')
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
          finalUrl: 'https://example.com/signup',
          scrapeResult: [
            {
              formSource: '.signup-form', // Specific form source (not generic 'form')
              formType: 'signup',
              visibleATF: true,
              fieldCount: 3,
            },
          ],
        })),
      },
    };

    context.s3Client.send.onCall(1).resolves(mockFormResponseData);
    context.s3Client.send.resolves(mockFormResponseData);

    // Create mock top forms with the same URL but with a different specific form source
    const mockTopForms = [
      {
        getUrl: () => 'https://example.com/signup', // Same URL as scraped data
        getFormSource: () => '#signup-modal', // Different specific form source
      },
    ];

    // Mock the SiteTopForm.allBySiteId to return the mock data
    context.dataAccess.SiteTopForm.allBySiteId.resolves(mockTopForms);

    const result = await sendA11yUrlsForScrapingStep(context);

    expect(context.dataAccess.SiteTopForm.allBySiteId).to.have.been.calledWith(siteId);
    expect(result.urls).to.have.length(1);

    const signupUrl = result.urls.find((url) => url.url === 'https://example.com/signup');
    expect(signupUrl).to.exist;
    expect(signupUrl.formSources).to.include('.signup-form'); // Original form source
    expect(signupUrl.formSources).to.include('#signup-modal'); // Added form source
    expect(signupUrl.formSources).to.have.length(2); // Should have both
  });

  it('should only add top forms that have form sources', async () => {
    // Reset and setup fresh mocks for this test
    context.s3Client.send.reset();
    context.dataAccess.SiteTopForm.allBySiteId.reset();

    // Mock empty scraped data
    context.s3Client.send.onCall(0).resolves({
      Contents: [],
      IsTruncated: false,
    });

    // Create mock top forms - mix of forms with and without form sources
    const mockTopForms = [
      {
        getUrl: () => 'https://example.com/form-with-source',
        getFormSource: () => 'form.contact', // Has form source - should be included
      },
      {
        getUrl: () => 'https://example.com/form-without-source',
        getFormSource: () => null, // No form source - should NOT be included
      },
      {
        getUrl: () => 'https://example.com/another-form-with-source',
        getFormSource: () => 'form.newsletter', // Has form source - should be included
      },
      {
        getUrl: () => 'https://example.com/empty-form-source',
        getFormSource: () => '', // Empty form source - should NOT be included
      },
    ];

    // Mock the SiteTopForm.allBySiteId to return the mock data
    context.dataAccess.SiteTopForm.allBySiteId.resolves(mockTopForms);

    const result = await sendA11yUrlsForScrapingStep(context);

    expect(context.dataAccess.SiteTopForm.allBySiteId).to.have.been.calledWith(siteId);
    expect(result.urls).to.have.length(2); // Only forms with form sources

    // Check that only forms with form sources are included
    const formWithSource = result.urls.find((url) => url.url === 'https://example.com/form-with-source');
    expect(formWithSource).to.exist;
    expect(formWithSource.formSources).to.deep.equal(['form.contact']);

    const anotherFormWithSource = result.urls.find((url) => url.url === 'https://example.com/another-form-with-source');
    expect(anotherFormWithSource).to.exist;
    expect(anotherFormWithSource.formSources).to.deep.equal(['form.newsletter']);

    // Check that forms without form sources are NOT included
    const formWithoutSource = result.urls.find((url) => url.url === 'https://example.com/form-without-source');
    expect(formWithoutSource).to.not.exist;

    const emptyFormSource = result.urls.find((url) => url.url === 'https://example.com/empty-form-source');
    expect(emptyFormSource).to.not.exist;
  });

  it('should include auditContext when auditContext.data is provided ', async () => {
    // Reset and setup fresh mocks for this test
    context.s3Client.send.reset();
    context.dataAccess.SiteTopForm.allBySiteId.reset();

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

    context.s3Client.send.onCall(1).resolves(mockFormResponseData);
    context.s3Client.send.resolves(mockFormResponseData);
    context.dataAccess.SiteTopForm.allBySiteId.resolves([]);

    const testData = { opportunityId: 'test-oppty-456', type: 'a11y' };
    const contextWithAuditData = {
      ...context,
      auditContext: { data: testData },
      s3Client: context.s3Client,
      dataAccess: context.dataAccess,
      site: context.site,
      log: context.log,
      env: context.env,
    };

    const result = await sendA11yUrlsForScrapingStep(contextWithAuditData);

    // Should include auditContext with data
    expect(result).to.have.property('auditContext');
    expect(result.auditContext).to.deep.equal({ data: testData });
  });

  it('should exclude auditContext when auditContext.data is undefined ', async () => {
    // Reset and setup fresh mocks for this test
    context.s3Client.send.reset();
    context.dataAccess.SiteTopForm.allBySiteId.reset();

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

    context.s3Client.send.onCall(1).resolves(mockFormResponseData);
    context.s3Client.send.resolves(mockFormResponseData);
    context.dataAccess.SiteTopForm.allBySiteId.resolves([]);

    const contextWithoutAuditData = {
      ...context,
      auditContext: {},
      s3Client: context.s3Client,
      dataAccess: context.dataAccess,
      site: context.site,
      log: context.log,
      env: context.env,
    };

    const result = await sendA11yUrlsForScrapingStep(contextWithoutAuditData);

    // Should NOT include auditContext property at all
    expect(result).to.not.have.property('auditContext');
  });

  it('should exclude auditContext when auditContext is null ', async () => {
    // Reset and setup fresh mocks for this test
    context.s3Client.send.reset();
    context.dataAccess.SiteTopForm.allBySiteId.reset();

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

    context.s3Client.send.onCall(1).resolves(mockFormResponseData);
    context.s3Client.send.resolves(mockFormResponseData);
    context.dataAccess.SiteTopForm.allBySiteId.resolves([]);

    const contextWithNullAuditContext = {
      ...context,
      auditContext: null,
      s3Client: context.s3Client,
      dataAccess: context.dataAccess,
      site: context.site,
      log: context.log,
      env: context.env,
    };

    const result = await sendA11yUrlsForScrapingStep(contextWithNullAuditContext);

    // Should NOT include auditContext property at all
    expect(result).to.not.have.property('auditContext');
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
      allBySiteId: sinon.stub().resolves([]),
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
        allBySiteId: sinon.stub().resolves([]),
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
          getSiteId: () => siteId,
          getAuditId: () => 'test-audit-id',
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

describe('codeImportStep', () => {
  let sandbox;
  let context;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        runtime: { name: 'aws-lambda', region: 'us-east-1' },
        func: { package: 'spacecat-services', version: 'ci', name: 'test' },
        site: {
          getId: sandbox.stub().returns('test-site-id'),
        },
        log: {
          info: sandbox.spy(),
          debug: sandbox.spy(),
          warn: sandbox.spy(),
          error: sandbox.spy(),
        },
      })
      .build();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return correct code import step structure', async () => {
    const result = await codeImportStep(context);

    expect(result).to.be.an('object');
    expect(result).to.have.property('type', 'code');
    expect(result).to.have.property('siteId', 'test-site-id');
    expect(result).to.have.property('allowCache', false);
  });

  it('should log info message with site ID', async () => {
    await codeImportStep(context);

    expect(context.log.info).to.have.been.calledOnce;
    expect(context.log.info).to.have.been.calledWith(
      '[Form Opportunity] [Site Id: test-site-id] starting code import step',
    );
  });

  it('should call site.getId() to get siteId', async () => {
    await codeImportStep(context);

    expect(context.site.getId).to.have.been.called;
  });

  it('should handle different site IDs correctly', async () => {
    context.site.getId.returns('different-site-id');

    const result = await codeImportStep(context);

    expect(result.siteId).to.equal('different-site-id');
    expect(context.log.info).to.have.been.calledWith(
      '[Form Opportunity] [Site Id: different-site-id] starting code import step',
    );
  });

  it('should return type as code', async () => {
    const result = await codeImportStep(context);

    expect(result.type).to.equal('code');
  });

  it('should handle numeric site ID', async () => {
    context.site.getId.returns(12345);

    const result = await codeImportStep(context);

    expect(result.siteId).to.equal(12345);
    expect(context.log.info).to.have.been.calledWith(
      '[Form Opportunity] [Site Id: 12345] starting code import step',
    );
  });

  it('should handle empty string site ID', async () => {
    context.site.getId.returns('');

    const result = await codeImportStep(context);

    expect(result.siteId).to.equal('');
    expect(result.type).to.equal('code');
  });

  it('should handle null site ID', async () => {
    context.site.getId.returns(null);

    const result = await codeImportStep(context);

    expect(result.siteId).to.be.null;
    expect(result.type).to.equal('code');
  });

  it('should call site.getId twice (for logging and return value)', async () => {
    await codeImportStep(context);

    expect(context.site.getId).to.have.been.calledTwice;
  });

  it('should return only type and siteId properties when no auditContext data', async () => {
    const result = await codeImportStep(context);

    const keys = Object.keys(result);
    expect(keys).to.have.lengthOf(3);
    expect(keys).to.include('type');
    expect(keys).to.include('siteId');
    expect(keys).to.include('allowCache');
  });

  it('should include auditContext when auditContext.data is provided ', async () => {
    const testData = { opportunityId: 'test-oppty-789', source: 'code-import' };
    const contextWithAuditData = {
      ...context,
      auditContext: { data: testData },
    };

    const result = await codeImportStep(contextWithAuditData);

    expect(result).to.have.property('auditContext');
    expect(result.auditContext).to.deep.equal({ data: testData });
    expect(result.type).to.equal('code');
    expect(result.siteId).to.equal('test-site-id');
  });

  it('should exclude auditContext when auditContext.data is undefined ', async () => {
    const contextWithoutAuditData = {
      ...context,
      auditContext: {},
    };

    const result = await codeImportStep(contextWithoutAuditData);

    expect(result).to.not.have.property('auditContext');
    expect(result.type).to.equal('code');
    expect(result.siteId).to.equal('test-site-id');
  });

  it('should exclude auditContext when auditContext is null ', async () => {
    const contextWithNullAuditContext = {
      ...context,
      auditContext: null,
    };

    const result = await codeImportStep(contextWithNullAuditContext);

    expect(result).to.not.have.property('auditContext');
    expect(result.type).to.equal('code');
    expect(result.siteId).to.equal('test-site-id');
  });

  it('should exclude auditContext when auditContext is undefined ', async () => {
    const contextWithUndefinedAuditContext = {
      ...context,
      auditContext: undefined,
    };

    const result = await codeImportStep(contextWithUndefinedAuditContext);

    expect(result).to.not.have.property('auditContext');
    expect(result.type).to.equal('code');
    expect(result.siteId).to.equal('test-site-id');
  });

  it('should have correct number of properties when auditContext.data is provided', async () => {
    const testData = { key: 'value' };
    const contextWithAuditData = {
      ...context,
      auditContext: { data: testData },
    };

    const result = await codeImportStep(contextWithAuditData);

    const keys = Object.keys(result);
    expect(keys).to.have.lengthOf(4); // type, siteId, allowCache, and auditContext
    expect(keys).to.include('type');
    expect(keys).to.include('siteId');
    expect(keys).to.include('allowCache');
    expect(keys).to.include('auditContext');
  });
});
