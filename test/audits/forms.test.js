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
import highFormViewsLowConversionsOpportunity from '../../src/forms-opportunities/highFormViewsLowConversionsOpportunity.js';
import highPageViewsLowFormCTAOpportunity from '../../src/forms-opportunities/highPageViewsLowFormCTAOpportunity.js';
import expectedFormVitalsData from '../fixtures/expectedformvitalsdata.json' with { type: 'json' };
import sendUrlsForScraping from '../../src/forms-opportunities/sendOpportunityUrlsToSQSForScraping.js';

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
    await highFormViewsLowConversionsOpportunity(auditUrl, auditData, context);
    expect(dataAccessStub.Opportunity.create).to.be.calledWith(testData.opportunityData);
    expect(logStub.info).to.be.calledWith('Successfully synced Opportunity for site: site-id and high-form-views-low-conversions audit type.');
  });

  it('should use existing opportunity', async () => {
    dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([formsOppty]);
    await highFormViewsLowConversionsOpportunity(auditUrl, auditData, context);
    expect(formsOppty.save).to.be.calledOnce;
    expect(logStub.info).to.be.calledWith('Successfully synced Opportunity for site: site-id and high-form-views-low-conversions audit type.');
  });

  it('should throw error if fetching opportunity fails', async () => {
    dataAccessStub.Opportunity.allBySiteIdAndStatus.rejects(new Error('some-error'));
    try {
      await highFormViewsLowConversionsOpportunity(auditUrl, auditData, context);
    } catch (err) {
      expect(err.message).to.equal('Failed to fetch opportunities for siteId site-id: some-error');
    }
    expect(logStub.error).to.be.calledWith('Fetching opportunities for siteId site-id failed with error: some-error');
  });

  it('should throw error if creating opportunity fails', async () => {
    dataAccessStub.Opportunity.allBySiteIdAndStatus.returns([]);
    dataAccessStub.Opportunity.create = sinon.stub().rejects(new Error('some-error'));
    try {
      await highFormViewsLowConversionsOpportunity(auditUrl, auditData, context);
    } catch (err) {
      expect(err.message).to.equal('Failed to create Forms opportunity for siteId site-id: some-error');
    }
    expect(logStub.error).to.be.calledWith('Creating Forms opportunity for siteId site-id failed with error: some-error');
  });
});

describe('highPageViewsLowFormCTAOpportunity handler method', () => {
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
      getType: () => 'high-page-views-low-form-ctr',
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

  it('should create new high page views low form CTA opportunity', async () => {
    const expectedOpportunityData = {
      siteId: 'site-id',
      auditId: 'audit-id',
      runbook: 'https://adobe.sharepoint.com/:w:/r/sites/AEM_Forms/_layouts/15/doc.aspx?sourcedoc=%7Bc64ab030-cd49-4812-b8fa-a70bf8d91618%7D',
      type: 'high-page-views-low-form-ctr',
      origin: 'AUTOMATION',
      title: 'Form has low views but conversion element has low CTR',
      description: 'The page containing the form CTA has high views but low CTR for the form CTA',
      tags: [
        'Forms Conversion',
      ],
      data: {
        form: 'https://www.surest.com/newsletter',
        screenshot: '',
        trackedFormKPIName: 'Conversion Rate',
        trackedFormKPIValue: null,
        formViews: 300,
        pageViews: 8670,
        samples: 8670,
        metrics: [
          {
            type: 'conversionRate',
            vendor: '*',
            value: {
              page: null,
            },
          },
        ],
        cta: {
          source: '#teaser-related02 .cmp-teaser__action-link',
          url: 'https://www.surest.com/about-us',
        },
      },
    };

    formsCTAOppty.getType = () => 'high-page-views-low-form-cta';
    dataAccessStub.Opportunity.create = sinon.stub().returns(formsCTAOppty);

    await highPageViewsLowFormCTAOpportunity(auditUrl, auditData, context);

    const actualCall = dataAccessStub.Opportunity.create.getCall(0).args[0];
    expect(actualCall).to.deep.equal(expectedOpportunityData);
    expect(logStub.info).to.be.calledWith('Successfully synced Opportunity for site: site-id and high page views low form cta audit type.');
  });

  it('should use existing high page views low form CTA opportunity', async () => {
    dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([formsCTAOppty]);

    await highPageViewsLowFormCTAOpportunity(auditUrl, auditData, context);

    expect(formsCTAOppty.save).to.be.calledOnce;
    expect(logStub.info).to.be.calledWith('Successfully synced Opportunity for site: site-id and high page views low form cta audit type.');
  });

  it('should throw error if fetching high page views low form CTA opportunity fails', async () => {
    dataAccessStub.Opportunity.allBySiteIdAndStatus.rejects(new Error('some-error'));

    try {
      await highPageViewsLowFormCTAOpportunity(auditUrl, auditData, context);
    } catch (err) {
      expect(err.message).to.equal('Failed to fetch opportunities for siteId site-id: some-error');
    }

    expect(logStub.error).to.be.calledWith('Fetching opportunities for siteId site-id failed with error: some-error');
  });

  it('should throw error if creating high page views low form CTA opportunity fails', async () => {
    dataAccessStub.Opportunity.allBySiteIdAndStatus.returns([]);
    dataAccessStub.Opportunity.create = sinon.stub().rejects(new Error('some-error'));

    try {
      await highPageViewsLowFormCTAOpportunity(auditUrl, auditData, context);
    } catch (err) {
      expect(err.message).to.equal('Failed to create Forms opportunity for high page views low form cta for siteId site-id: some-error');
    }

    expect(logStub.error).to.be.calledWith('Creating Forms opportunity for high page views low form cta for siteId site-id failed with error: some-error');
  });

  it('should handle empty form vitals data', async () => {
    auditData.auditResult.formVitals = [];

    await highPageViewsLowFormCTAOpportunity(auditUrl, auditData, context);

    expect(dataAccessStub.Opportunity.create).to.not.be.called;
    expect(logStub.info).to.be.calledWith('Successfully synced Opportunity for site: site-id and high page views low form cta audit type.');
  });
});

describe('sendOpportunityUrlsToSQSForScraping handler method', () => {
  let logStub;
  let sqsStub;
  let context;
  let site;
  let auditData;
  let auditUrl;

  beforeEach(() => {
    sinon.restore();
    auditUrl = 'https://example.com';

    logStub = {
      info: sinon.stub(),
      debug: sinon.stub(),
      error: sinon.stub(),
      warn: sinon.stub(),
    };

    sqsStub = {
      sendMessage: sinon.stub().resolves(),
    };

    site = {
      getId: () => 'site-123',
    };

    context = {
      log: logStub,
      sqs: sqsStub,
    };

    // Setup test data
    auditData = {
      formOpportunities: [
        {
          type: 'high-form-views-low-conversions',
          data: {
            form: 'https://example.com/form1',
          },
        },
        {
          type: 'high-page-views-low-form-ctr',
          data: {
            form: 'https://example.com/form2',
            cta: {
              url: 'https://www.xyz.com/about-us',
              source: '#teaser-related02 .cmp-teaser__action-link',
            },
          },
        },
      ],
    };

    process.env.SCRAPING_JOBS_QUEUE_URL = 'https://sqs.queue.url';
  });

  afterEach(() => {
    delete process.env.SCRAPING_JOBS_QUEUE_URL;
  });

  it('should send unique URLs to SQS for scraping', async () => {
    await sendUrlsForScraping(auditUrl, auditData, context, site);

    expect(sqsStub.sendMessage).to.be.calledWith(
      'https://sqs.queue.url',
      {
        processingType: 'form',
        jobId: 'site-123',
        urls: new Set([
          'https://example.com/form1',
          'https://www.xyz.com/about-us',
        ]),
      },
    );

    expect(logStub.info).to.be.calledWith(sinon.match(/Triggering scrape for/));
  });

  it('should handle empty form opportunities array', async () => {
    auditData.formOpportunities = [];

    await sendUrlsForScraping(auditUrl, auditData, context, site);

    expect(sqsStub.sendMessage).to.not.be.called;
    expect(logStub.info).to.be.calledWith('No form opportunities to process for scraping');
  });

  it('should handle undefined form opportunities', async () => {
    delete auditData.formOpportunities;

    await sendUrlsForScraping(auditUrl, auditData, context, site);

    expect(sqsStub.sendMessage).to.not.be.called;
    expect(logStub.info).to.be.calledWith('No form opportunities to process for scraping');
  });

  it('should handle URLs with different cases as unique', async () => {
    auditData.formOpportunities = [
      {
        type: 'high-form-views-low-conversions',
        data: {
          form: 'https://example.com/Form1',
        },
      },
      {
        type: 'high-page-views-low-form-ctr',
        data: {
          form: 'https://example.com/form1',
          cta: {
            url: 'https://www.xyz.com/about-us',
            source: '#teaser-related02 .cmp-teaser__action-link',
          },
        },
      },
    ];

    await sendUrlsForScraping(auditUrl, auditData, context, site);

    const sentMessage = sqsStub.sendMessage.getCall(0).args[1];
    expect(sentMessage.urls.size).to.equal(2); // Should treat different cases as unique URLs
  });

  it('should not send a message if there are no unique URLs', async () => {
    // eslint-disable-next-line no-shadow
    const auditData = { formOpportunities: [] };
    await sendUrlsForScraping('https://audit.url', auditData, context, site);

    expect(sqsStub.sendMessage).to.not.have.been.called;
    expect(logStub.info).to.have.been.calledWith('No form opportunities to process for scraping');
  });
});
