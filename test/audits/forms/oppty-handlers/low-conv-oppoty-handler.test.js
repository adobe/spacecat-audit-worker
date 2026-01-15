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
import testData from '../../../fixtures/forms/high-form-views-low-conversions.js';
import createLowConversionOpportunities from '../../../../src/forms-opportunities/oppty-handlers/low-conversion-handler.js';
import { FORM_OPPORTUNITY_TYPES, ORIGINS } from '../../../../src/forms-opportunities/constants.js';
import formScrapeData from '../../../fixtures/forms/formscrapedata.js';

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
      getOrigin: sinon.stub().returns('AUTOMATION'),
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
      setUpdatedBy: sinon.stub(),
    };
    logStub = {
      info: sinon.stub(),
      debug: sinon.stub(),
      error: sinon.stub(),
    };
    dataAccessStub = {
      Opportunity: {
        allBySiteId: sinon.stub().resolves([]),
        create: sinon.stub(),
      },
    };
    context = {
      log: logStub,
      dataAccess: dataAccessStub,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
        QUEUE_SPACECAT_TO_MYSTIQUE: 'spacecat-to-mystique',
      },
      site: {
        getBaseURL: sinon.stub().returns('test-base-url'),
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
    // After applyOpportunityFilters, only top 2 opportunities by pageviews are created
    expect(dataAccessStub.Opportunity.create).to.be.callCount(2);
    // Verify tags are merged correctly for all created opportunities
    for (let i = 0; i < 2; i++) {
      const createdOpportunity = dataAccessStub.Opportunity.create.getCall(i).args[0];
      expect(createdOpportunity.tags).to.be.an('array');
      expect(createdOpportunity.tags).to.include('Form Conversion');
      expect(createdOpportunity.tags.length).to.be.above(1); // Should have hardcoded tags plus 'Form Conversion'
    }
    // Verify first opportunity matches expected data (excluding tags which are now merged)
    const createdOpportunity = dataAccessStub.Opportunity.create.getCall(0).args[0];
    const expectedData = { ...testData.opportunityData };
    delete expectedData.tags;
    const actualData = { ...createdOpportunity };
    delete actualData.tags;
    // Check if this is the right opportunity by comparing form URL
    if (actualData.data.form === expectedData.data.form) {
      expect(actualData).to.deep.equal(expectedData);
    } else {
      // If first call doesn't match, check second call
      const secondOpportunity = dataAccessStub.Opportunity.create.getCall(1).args[0];
      const secondActualData = { ...secondOpportunity };
      delete secondActualData.tags;
      expect(secondActualData).to.deep.equal(expectedData);
    }
    // with empty guidance due to no scraping
    expect(logStub.info).to.be.calledWith('[Form Opportunity] [Site Id: site-id] Successfully synced opportunity for high-form-views-low-conversions audit type.');
    // asserting spacecat to mystique message for the last created opportunity
    const [queueArg, messageArg] = context.sqs.sendMessage.getCall(1).args;
    expect(queueArg).to.equal('spacecat-to-mystique');
    expect(messageArg.data).to.deep.equal(testData.mystiqueMessageForFormDetails);
  });

  it('should create new forms opportunity with scraped data available', async () => {
    formsOppty.getType = () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION;
    dataAccessStub.Opportunity.create = sinon.stub().returns(formsOppty);
    const { scrapeData1: scrapeData } = formScrapeData;
    await createLowConversionOpportunities(auditUrl, auditData, scrapeData, context);
    // with BTF guidance
    // expect(dataAccessStub.Opportunity.create).to.not.have.been.called;
    expect(logStub.info).to.be.calledWith('[Form Opportunity] [Site Id: site-id] Successfully synced opportunity for high-form-views-low-conversions audit type.');
  });

  it('should create new forms opportunity with scraped data available not matched', async () => {
    const { auditData2 } = testData;
    formsOppty.getType = () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION;
    dataAccessStub.Opportunity.create = sinon.stub().returns(formsOppty);
    const { scrapeData2: scrapeData } = formScrapeData;
    await createLowConversionOpportunities(auditUrl, auditData2, scrapeData, context);
    // Verify tags are merged correctly
    const createdOpportunity = dataAccessStub.Opportunity.create.getCall(0).args[0];
    expect(createdOpportunity.tags).to.be.an('array');
    expect(createdOpportunity.tags).to.include('Form Conversion');
    expect(createdOpportunity.tags.length).to.be.above(1); // Should have hardcoded tags plus 'Form Conversion'
    // Verify other fields match expected data (excluding tags which are now merged)
    const expectedData = { ...testData.opportunityData2 };
    delete expectedData.tags;
    const actualData = { ...createdOpportunity };
    delete actualData.tags;
    expect(actualData).to.deep.equal(expectedData);
    // with empty guidance due to scrapedStatus = false
    expect(logStub.info).to.be.calledWith('[Form Opportunity] [Site Id: site-id] Successfully synced opportunity for high-form-views-low-conversions audit type.');
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
    // Verify tags are merged correctly
    const createdOpportunity = dataAccessStub.Opportunity.create.getCall(0).args[0];
    expect(createdOpportunity.tags).to.be.an('array');
    expect(createdOpportunity.tags).to.include('Form Conversion');
    expect(createdOpportunity.tags.length).to.be.above(1); // Should have hardcoded tags plus 'Form Conversion'
    // Verify other fields match expected data (excluding tags which are now merged)
    const expectedOpportunityData = { ...testData.opportunityData3 };
    expectedOpportunityData.data.scrapedStatus = true;
    delete expectedOpportunityData.tags;
    const actualData = { ...createdOpportunity };
    delete actualData.tags;
    expect(actualData).to.deep.equal(expectedOpportunityData);
    expect(logStub.info).to.be.calledWith('[Form Opportunity] [Site Id: site-id] Successfully synced opportunity for high-form-views-low-conversions audit type.');
  });

  it('should create new forms opportunity with scraped data available and matched with Generic guidance', async () => {
    const { auditData2 } = testData;
    formsOppty.getType = () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION;
    dataAccessStub.Opportunity.create = sinon.stub().returns(formsOppty);
    const { scrapeData4: scrapeData } = formScrapeData;
    await createLowConversionOpportunities(auditUrl, auditData2, scrapeData, context);
    // Verify tags are merged correctly
    const createdOpportunity = dataAccessStub.Opportunity.create.getCall(0).args[0];
    expect(createdOpportunity.tags).to.be.an('array');
    expect(createdOpportunity.tags).to.include('Form Conversion');
    expect(createdOpportunity.tags.length).to.be.above(1); // Should have hardcoded tags plus 'Form Conversion'
    // Verify other fields match expected data (excluding tags which are now merged)
    const expectedData = { ...testData.opportunityData4 };
    delete expectedData.tags;
    const actualData = { ...createdOpportunity };
    delete actualData.tags;
    expect(actualData).to.deep.equal(expectedData);

    // with Generic guidance
    expect(logStub.info).to.be.calledWith('[Form Opportunity] [Site Id: site-id] Successfully synced opportunity for high-form-views-low-conversions audit type.');
  });

  it('should use existing opportunity', async () => {
    dataAccessStub.Opportunity.allBySiteId.resolves([formsOppty]);
    const { auditDataWithExistingOppty } = testData;
    await createLowConversionOpportunities(
      auditUrl,
      auditDataWithExistingOppty,
      undefined,
      context,
    );
    expect(formsOppty.setUpdatedBy).to.be.calledWith('system');
    expect(formsOppty.save).to.be.callCount(1);
    expect(logStub.info).to.be.calledWith('[Form Opportunity] [Site Id: site-id] Successfully synced opportunity for high-form-views-low-conversions audit type.');
  });

  it('should use existing opportunity with form details', async () => {
    dataAccessStub.Opportunity.allBySiteId.resolves([formsOppty]);
    const { auditDataWithExistingOppty } = testData;
    formsOppty.getData = sinon.stub().returns({
      form: 'https://www.surest.com/info/win-1',
      screenshot: '',
      trackedFormKPIName: 'Conversion Rate',
      trackedFormKPIValue: 0.5,
      formViews: 1000,
      pageViews: 5000,
      samples: 5000,
      formDetails: {
        is_lead_gen: true,
        industry: 'Insurance',
        form_type: 'Quote Request Form',
        form_category: 'B2C',
        cpl: 230.6,
      },
    });
    await createLowConversionOpportunities(
      auditUrl,
      auditDataWithExistingOppty,
      undefined,
      context,
    );
    expect(formsOppty.setUpdatedBy).to.be.calledWith('system');
    expect(formsOppty.save).to.be.callCount(1);
    expect(logStub.info).to.be.calledWith('[Form Opportunity] [Site Id: site-id] Successfully synced opportunity for high-form-views-low-conversions audit type.');
  });

  it('should throw error if fetching opportunity fails', async () => {
    dataAccessStub.Opportunity.allBySiteId.rejects(new Error('some-error'));
    try {
      await createLowConversionOpportunities(auditUrl, auditData, undefined, context);
    } catch (err) {
      expect(err.message).to.equal('Failed to fetch opportunities for siteId site-id: some-error');
    }
    expect(logStub.error).to.be.calledWith('[Form Opportunity] [Site Id: site-id] fetching opportunities failed with error: some-error');
  });

  it('should throw error if creating opportunity fails', async () => {
    dataAccessStub.Opportunity.allBySiteId.returns([]);
    dataAccessStub.Opportunity.create = sinon.stub().rejects(new Error('some-error'));

    await createLowConversionOpportunities(auditUrl, auditData, undefined, context);

    expect(logStub.error).to.be.calledWith('[Form Opportunity] [Site Id: site-id] Creating low conversion forms opportunity failed with error: some-error', sinon.match.instanceOf(Error));
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
    // Verify tags are merged correctly
    const createdOpportunity = dataAccessStub.Opportunity.create.getCall(0).args[0];
    expect(createdOpportunity.tags).to.be.an('array');
    expect(createdOpportunity.tags).to.include('Form Conversion');
    expect(createdOpportunity.tags.length).to.be.above(1); // Should have hardcoded tags plus 'Form Conversion'
    // Verify other fields match expected data (excluding tags which are now merged)
    const expectedData = { ...testData.opportunityData5 };
    delete expectedData.tags;
    const actualData = { ...createdOpportunity };
    delete actualData.tags;
    expect(actualData).to.deep.equal(expectedData);
    expect(logStub.info).to.be.calledWith('[Form Opportunity] [Site Id: site-id] Successfully synced opportunity for high-form-views-low-conversions audit type.');
  });

  it('should not create low conversion opportunity if another opportunity already exists', async () => {
    const excludeUrls = new Set();
    excludeUrls.add('https://www.surest.com/newsletter');
    excludeUrls.add('https://www.surest.com/info/win-1.form');
    await createLowConversionOpportunities(auditUrl, auditData, undefined, context, excludeUrls);
    // After applyOpportunityFilters, only top 2 opportunities by pageviews are created
    expect(dataAccessStub.Opportunity.create).to.be.callCount(2);
    expect(excludeUrls.has('https://www.surest.com/contact-us.mycontact')).to.be.true;
    expect(excludeUrls.has('https://www.surest.com/info/win-2')).to.be.true;
    expect(excludeUrls.has('https://www.surest.com/info/win')).to.be.false;
  });

  it('should not process opportunities with origin ESS_OPS', async () => {
    formsOppty.getOrigin = sinon.stub().returns(ORIGINS.ESS_OPS);
    dataAccessStub.Opportunity.allBySiteId.resolves([formsOppty]);
    const { auditDataWithExistingOppty } = testData;
    // eslint-disable-next-line max-len
    await createLowConversionOpportunities(auditUrl, auditDataWithExistingOppty, undefined, context);
    expect(dataAccessStub.Opportunity.create).to.be.callCount(2);
    formsOppty.getOrigin = sinon.stub().returns('');
  });

  it('should handle when auditContext has data', async () => {
    const contextWithAuditData = {
      ...context,
      auditContext: { data: 'test-123' },
    };
    formsOppty.getType = () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION;
    dataAccessStub.Opportunity.create = sinon.stub().returns(formsOppty);
    await createLowConversionOpportunities(auditUrl, auditData, undefined, contextWithAuditData);
    // Should work normally with auditContext.data defined
    expect(dataAccessStub.Opportunity.create).to.be.callCount(2);
    expect(logStub.info).to.be.calledWith('[Form Opportunity] [Site Id: site-id] Successfully synced opportunity for high-form-views-low-conversions audit type.');
  });
});
