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
} from '../../src/forms-opportunities/handler.js';
import { MockContextBuilder } from '../shared.js';
import formVitalsData from '../fixtures/formvitalsdata.json' with { type: 'json' };
import testData from '../fixtures/high-form-views-low-conversions.js';
import createLowConversionOpportunities from '../../src/forms-opportunities/oppty-handlers/low-conversion-handler.js';
import { shouldExcludeForm } from '../../src/forms-opportunities/utils.js';
import expectedFormVitalsData from '../fixtures/expectedformvitalsdata.json' with { type: 'json' };
import expectedFormSendToScraperData from '../fixtures/expectedformsendtoscraperdata.json' with { type: 'json' };
import formScrapeData from '../fixtures/formscrapedata.js';
import createLowNavigationOpportunities from '../../src/forms-opportunities/oppty-handlers/low-navigation-handler.js';
import { FORM_OPPORTUNITY_TYPES } from '../../src/forms-opportunities/constants.js';

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
      interval: 15,
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
      getType: () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION,
      setData: sinon.stub(),
      setGuidance: sinon.stub(),
      getData: sinon.stub().returns({
        form: 'https://www.surest.com/info/win-1',
        screenshot: '',
        trackedFormKPIName: 'Conversion Rate',
        trackedFormKPIValue: 0.5,
        formViews: 1000,
        pageViews: 5000,
        samples: 5000,
      }),
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
      site: {
        getId: sinon.stub().returns('test-site-id'),
        getDeliveryType: sinon.stub().returns('eds'),
      },
      sqs: {
        sendMessage: sinon.stub().resolves({}),
      },
    };
    auditData = testData.auditData3;
  });

  it('should create new forms opportunity', async () => {
    formsOppty.getType = () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION;
    dataAccessStub.Opportunity.create = sinon.stub().returns(formsOppty);
    await createLowConversionOpportunities(auditUrl, auditData, undefined, context);
    expect(dataAccessStub.Opportunity.create).to.be.callCount(5);
    expect(dataAccessStub.Opportunity.create).to.be.calledWith(testData.opportunityData);
    // with empty guidance due to no scraping
    expect(logStub.info).to.be.calledWith('Successfully synced Opportunity for site: site-id and high-form-views-low-conversions audit type.');
  });

  it('should create new forms opportunity with scraped data available', async () => {
    formsOppty.getType = () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION;
    dataAccessStub.Opportunity.create = sinon.stub().returns(formsOppty);
    const { scrapeData1: scrapeData } = formScrapeData;
    await createLowConversionOpportunities(auditUrl, auditData, scrapeData, context);
    // with BTF guidance
    // expect(dataAccessStub.Opportunity.create).to.not.have.been.called;
    expect(logStub.info).to.be.calledWith('Successfully synced Opportunity for site: site-id and high-form-views-low-conversions audit type.');
  });

  it('should create new forms opportunity with scraped data available not matched', async () => {
    const { auditData2 } = testData;
    formsOppty.getType = () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION;
    dataAccessStub.Opportunity.create = sinon.stub().returns(formsOppty);
    const { scrapeData2: scrapeData } = formScrapeData;
    await createLowConversionOpportunities(auditUrl, auditData2, scrapeData, context);
    expect(dataAccessStub.Opportunity.create).to.be.calledWith(testData.opportunityData2);
    // with empty guidance due to scrapedStatus = false
    expect(logStub.info).to.be.calledWith('Successfully synced Opportunity for site: site-id and high-form-views-low-conversions audit type.');
  });

  it('should create new forms opportunity with scraped data available with all field labels containing search', async () => {
    formsOppty.getType = () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION;
    dataAccessStub.Opportunity.create = sinon.stub().returns(formsOppty);
    const { scrapeData3: scrapeData } = formScrapeData;
    await createLowConversionOpportunities(auditUrl, auditData, scrapeData, context);
    const expectedOpportunityData = { ...testData.opportunityData3 };
    // with large form guidance
    expectedOpportunityData.data.scrapedStatus = true;
    expect(dataAccessStub.Opportunity.create).to.be.calledWith(expectedOpportunityData);
    expect(logStub.info).to.be.calledWith('Successfully synced Opportunity for site: site-id and high-form-views-low-conversions audit type.');
  });

  it('should create new forms opportunity with scraped data available and matched with Generic guidance', async () => {
    const { auditData2 } = testData;
    formsOppty.getType = () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION;
    dataAccessStub.Opportunity.create = sinon.stub().returns(formsOppty);
    const { scrapeData4: scrapeData } = formScrapeData;
    await createLowConversionOpportunities(auditUrl, auditData2, scrapeData, context);
    expect(dataAccessStub.Opportunity.create).to.be.calledWith(testData.opportunityData4);
    // with Generic guidance
    expect(logStub.info).to.be.calledWith('Successfully synced Opportunity for site: site-id and high-form-views-low-conversions audit type.');
  });

  it('should use existing opportunity', async () => {
    dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([formsOppty]);
    await createLowConversionOpportunities(auditUrl, auditData, undefined, context);
    expect(formsOppty.save).to.be.callCount(1);
    expect(logStub.info).to.be.calledWith('Successfully synced Opportunity for site: site-id and high-form-views-low-conversions audit type.');
  });

  it('should throw error if fetching opportunity fails', async () => {
    dataAccessStub.Opportunity.allBySiteIdAndStatus.rejects(new Error('some-error'));
    try {
      await createLowConversionOpportunities(auditUrl, auditData, undefined, context);
    } catch (err) {
      expect(err.message).to.equal('Failed to fetch opportunities for siteId site-id: some-error');
    }
    expect(logStub.error).to.be.calledWith('Fetching opportunities for siteId site-id failed with error: some-error');
  });

  it('should throw error if creating opportunity fails', async () => {
    dataAccessStub.Opportunity.allBySiteIdAndStatus.returns([]);
    dataAccessStub.Opportunity.create = sinon.stub().rejects(new Error('some-error'));
    try {
      await createLowConversionOpportunities(auditUrl, auditData, undefined, context);
    } catch (err) {
      expect(err.message).to.equal('Failed to create Forms opportunity for siteId site-id: some-error');
    }
    expect(logStub.error).to.be.calledWith('Creating Forms opportunity for siteId site-id failed with error: some-error');
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

  it('run audit and send urls for scraping step', async () => {
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

describe('createLowNavigationOpportunities handler method', () => {
  let logStub;
  let dataAccessStub;
  let auditData;
  let auditUrl;
  let formsCTAOppty;
  let context;

  beforeEach(() => {
    sinon.restore();
    auditUrl = 'https://example.com';
    formsCTAOppty = {
      getId: () => 'opportunity-id',
      setAuditId: sinon.stub(),
      save: sinon.stub(),
      getType: () => FORM_OPPORTUNITY_TYPES.LOW_NAVIGATION,
      setData: sinon.stub(),
      setGuidance: sinon.stub(),
      getData: sinon.stub().returns({
        form: 'https://www.surest.com/newsletter',
        screenshot: '',
        trackedFormKPIName: 'Conversion Rate',
        trackedFormKPIValue: 0.5,
        formViews: 1000,
        pageViews: 5000,
        samples: 5000,
      }),
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
      site: {
        getId: sinon.stub().returns('test-site-id'),
      },
    };
    auditData = testData.oppty2AuditData;
  });

  it('should create new high page views low form navigation opportunity', async () => {
    const expectedOpportunityData = {
      siteId: 'site-id',
      auditId: 'audit-id',
      runbook: 'https://adobe.sharepoint.com/:w:/s/AEM_Forms/ETCwSsZJzRJIuPqnC_jZFhgBsW29GijIgk9C6-GpkQ16xg?e=dNYZhD',
      type: FORM_OPPORTUNITY_TYPES.LOW_NAVIGATION,
      origin: 'AUTOMATION',
      title: 'Form has low views',
      description: 'The form has low views due to low navigations in the page containing its CTA',
      tags: [
        'Forms Conversion',
      ],
      data: {
        form: 'https://www.surest.com/newsletter',
        screenshot: '',
        trackedFormKPIName: 'Form Views',
        trackedFormKPIValue: 300,
        formViews: 300,
        pageViews: 8670,
        samples: 8670,
        scrapedStatus: false,
        metrics: [
          {
            type: 'formViews',
            device: '*',
            value: {
              page: 300,
            },
          },
        ],
        formNavigation: {
          source: '#teaser-related02 .cmp-teaser__action-link',
          url: 'https://www.surest.com/about-us',
        },
      },
      guidance: {
        recommendations: [
          {
            insight: 'The CTA element in the page: https://www.surest.com/about-us is not placed in the most optimal positions for visibility and engagement',
            recommendation: 'Reposition the CTA to be more centrally located and ensure they are above the fold.',
            type: 'guidance',
            rationale: 'CTAs placed above the fold and in central positions are more likely to be seen and clicked by users, leading to higher engagement rates.',
          },
        ],
      },
    };

    formsCTAOppty.getType = () => FORM_OPPORTUNITY_TYPES.LOW_NAVIGATION;
    dataAccessStub.Opportunity.create = sinon.stub().returns(formsCTAOppty);

    await createLowNavigationOpportunities(auditUrl, auditData, undefined, context);

    const actualCall = dataAccessStub.Opportunity.create.getCall(0).args[0];
    expect(actualCall).to.deep.equal(expectedOpportunityData);
    expect(logStub.info).to.be.calledWith('Successfully synced Opportunity for site: site-id and high page views low form nav audit type.');
  });

  it('should use existing high page views low form navigation opportunity', async () => {
    dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([formsCTAOppty]);

    await createLowNavigationOpportunities(auditUrl, auditData, undefined, context);

    expect(formsCTAOppty.save).to.be.calledOnce;
    expect(logStub.info).to.be.calledWith('Successfully synced Opportunity for site: site-id and high page views low form nav audit type.');
  });

  it('should throw error if fetching high page views low form navigation opportunity fails', async () => {
    dataAccessStub.Opportunity.allBySiteIdAndStatus.rejects(new Error('some-error'));

    try {
      await createLowNavigationOpportunities(auditUrl, auditData, undefined, context);
    } catch (err) {
      expect(err.message).to.equal('Failed to fetch opportunities for siteId site-id: some-error');
    }

    expect(logStub.error).to.be.calledWith('Fetching opportunities for siteId site-id failed with error: some-error');
  });

  it('should throw error if creating high page views low form navigation opportunity fails', async () => {
    dataAccessStub.Opportunity.allBySiteIdAndStatus.returns([]);
    dataAccessStub.Opportunity.create = sinon.stub().rejects(new Error('some-error'));

    try {
      await createLowNavigationOpportunities(auditUrl, auditData, undefined, context);
    } catch (err) {
      expect(err.message).to.equal('Failed to create Forms opportunity for high page views low form nav for siteId site-id: some-error');
    }

    expect(logStub.error).to.be.calledWith('Creating Forms opportunity for high page views low form nav for siteId site-id failed with error: some-error');
  });

  it('should handle empty form vitals data', async () => {
    auditData.auditResult.formVitals = [];

    await createLowNavigationOpportunities(auditUrl, auditData, undefined, context);

    expect(dataAccessStub.Opportunity.create).to.not.be.called;
    expect(logStub.info).to.be.calledWith('Successfully synced Opportunity for site: site-id and high page views low form nav audit type.');
  });
});

describe('isSearchForm', () => {
  it('should return true for search form type', () => {
    const scrapedFormData = { formType: 'search' };
    expect(shouldExcludeForm(scrapedFormData)).to.be.true;
  });

  it('should return true for login form type', () => {
    const scrapedFormData = { formType: 'login' };
    expect(shouldExcludeForm(scrapedFormData)).to.be.true;
  });

  it('should return true for form with unsubscribe class', () => {
    const scrapedFormData = { classList: ['unsubscribe'] };
    expect(shouldExcludeForm(scrapedFormData)).to.be.true;
  });

  it('should return false for non-search form', () => {
    const scrapedFormData = {
      formType: 'contact', classList: ['subscribe'], action: 'https://example.com/contact.html', fieldsLabels: ['Name', 'Email'],
    };
    expect(shouldExcludeForm(scrapedFormData)).to.be.false;
  });
});
