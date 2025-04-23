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
import testData from '../../fixtures/forms/high-form-views-low-conversions.js';
import createLowConversionOpportunities from '../../../src/forms-opportunities/oppty-handlers/low-conversion-handler.js';
import { FORM_OPPORTUNITY_TYPES } from '../../../src/forms-opportunities/constants.js';
import formScrapeData from '../../fixtures/forms/formscrapedata.js';

use(sinonChai);
describe('createLowConversionOpportunities handler method', () => {
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
    const { auditDataOpportunitiesWithSearchFields } = testData;
    await createLowConversionOpportunities(
      auditUrl,
      auditDataOpportunitiesWithSearchFields,
      scrapeData,
      context,
    );
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
    const { auditDataWithExistingOppty } = testData;
    await createLowConversionOpportunities(
      auditUrl,
      auditDataWithExistingOppty,
      undefined,
      context,
    );
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

  it('should create new forms opportunity with device wise metrics and traffic ', async () => {
    formsOppty.getType = () => 'high-form-views-low-conversions';
    dataAccessStub.Opportunity.create = sinon.stub().returns(formsOppty);
    const { auditDataWithTrafficMetrics } = testData;
    await createLowConversionOpportunities(
      auditUrl,
      auditDataWithTrafficMetrics,
      undefined,
      context,
    );
    expect(dataAccessStub.Opportunity.create).to.be.callCount(1);
    expect(dataAccessStub.Opportunity.create).to.be.calledWith(testData.opportunityData5);
    expect(logStub.info).to.be.calledWith('Successfully synced Opportunity for site: site-id and high-form-views-low-conversions audit type.');
  });
});
