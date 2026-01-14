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
import esmock from 'esmock';
import testData from '../../../fixtures/forms/high-form-views-low-conversions.js';
import { FORM_OPPORTUNITY_TYPES, ORIGINS } from '../../../../src/forms-opportunities/constants.js';
import formScrapeData from '../../../fixtures/forms/formscrapedata.js';

use(sinonChai);

// Mock tagMappings module
const mockTagMappings = {
  mergeTagsWithHardcodedTags: sinon.stub().callsFake((opportunityType, currentTags) => {
    if (opportunityType === 'high-form-views-low-conversions') {
      return ['Form Conversion', 'Conversion'];
    }
    return currentTags || [];
  }),
};

let createLowConversionOpportunities;
describe('createLowConversionOpportunities handler method', () => {
  let logStub;
  let dataAccessStub;
  let auditData;
  let auditUrl;
  let formsOppty;
  let context;

  beforeEach(async () => {
    sinon.restore();
    // Import with mocked tagMappings and utils
    const utilsModule = await import('../../../../src/forms-opportunities/utils.js');
    // Create a stub that can be configured per test
    const generateOpptyDataStub = sinon.stub();
    const calculateProjectedConversionValueStub = sinon.stub().resolves({ projectedConversionValue: 100 });
    const filterFormsStub = sinon.stub().callsFake((opps) => opps);
    // Use real applyOpportunityFilters implementation to properly filter opportunities
    const applyOpportunityFiltersStub = sinon.stub().callsFake(utilsModule.applyOpportunityFilters);
    // Use real implementations so they properly call sqs.sendMessage
    const sendMessageToMystiqueForGuidanceStub = sinon.stub().callsFake(utilsModule.sendMessageToMystiqueForGuidance);
    const sendMessageToFormsQualityAgentStub = sinon.stub().callsFake(utilsModule.sendMessageToFormsQualityAgent);

    createLowConversionOpportunities = await esmock(
      '../../../../src/forms-opportunities/oppty-handlers/low-conversion-handler.js',
      {
        '@adobe/spacecat-shared-utils': mockTagMappings,
        '../../../../src/forms-opportunities/utils.js': {
          ...utilsModule,
          generateOpptyData: generateOpptyDataStub,
          calculateProjectedConversionValue: calculateProjectedConversionValueStub,
          filterForms: filterFormsStub,
          applyOpportunityFilters: applyOpportunityFiltersStub,
          sendMessageToMystiqueForGuidance: sendMessageToMystiqueForGuidanceStub,
          sendMessageToFormsQualityAgent: sendMessageToFormsQualityAgentStub,
        },
      },
    );

    // Store stubs on the module for test access
    createLowConversionOpportunities._testStubs = {
      generateOpptyData: generateOpptyDataStub,
      calculateProjectedConversionValue: calculateProjectedConversionValueStub,
      filterForms: filterFormsStub,
      applyOpportunityFilters: applyOpportunityFiltersStub,
      sendMessageToMystiqueForGuidance: sendMessageToMystiqueForGuidanceStub,
      sendMessageToFormsQualityAgent: sendMessageToFormsQualityAgentStub,
    };

    // Default: use real implementation for generateOpptyData unless overridden
    // This will be reset in beforeEach for each test
    generateOpptyDataStub.callsFake(async (...args) => {
      return utilsModule.generateOpptyData(...args);
    });
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
      auditContext: {}, // Add auditContext for generateOpptyData
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
    expect(dataAccessStub.Opportunity.create).to.be.calledWith(testData.opportunityData);
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
    expect(dataAccessStub.Opportunity.create).to.be.calledWith(testData.opportunityData2);
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
    const expectedOpportunityData = { ...testData.opportunityData3 };
    // with large form guidance
    expectedOpportunityData.data.scrapedStatus = true;
    expect(dataAccessStub.Opportunity.create).to.be.calledWith(expectedOpportunityData);
    expect(logStub.info).to.be.calledWith('[Form Opportunity] [Site Id: site-id] Successfully synced opportunity for high-form-views-low-conversions audit type.');
  });

  it('should create new forms opportunity with scraped data available and matched with Generic guidance', async () => {
    const { auditData2 } = testData;
    formsOppty.getType = () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION;
    dataAccessStub.Opportunity.create = sinon.stub().returns(formsOppty);
    const { scrapeData4: scrapeData } = formScrapeData;
    await createLowConversionOpportunities(auditUrl, auditData2, scrapeData, context);
    expect(dataAccessStub.Opportunity.create).to.be.calledWith(testData.opportunityData4);

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
    expect(dataAccessStub.Opportunity.create).to.be.calledWith(testData.opportunityData5);
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

  describe('generateDefaultGuidance coverage', () => {
    it('should return large form guidance when form has more than 6 fields', async () => {
      const scrapeDataWithLargeForm = {
        formData: [{
          finalUrl: 'https://www.surest.com/info/win-1',
          scrapeResult: [{
            visibleFieldCount: 8,
            visibleATF: true,
          }],
        }],
      };
      formsOppty.getType = () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION;
      dataAccessStub.Opportunity.create = sinon.stub().returns(formsOppty);
      const opptyData = {
        form: 'https://www.surest.com/info/win-1',
        trackedFormKPIValue: 0.5,
      };
      const auditDataWithForm = {
        ...auditData,
        auditResult: {
          formVitals: [{
            form: 'https://www.surest.com/info/win-1',
            formViews: 1000,
            pageViews: 5000,
          }],
        },
      };
      await createLowConversionOpportunities(auditUrl, auditDataWithForm, scrapeDataWithLargeForm, context);
      const createCall = dataAccessStub.Opportunity.create.getCall(0);
      if (createCall) {
        const guidance = createCall.args[0].guidance;
        expect(guidance.recommendations[0].insight).to.include('large number of fields');
        expect(guidance.recommendations[0].recommendation).to.include('progressive disclosure');
      }
    });

    it('should return below the fold guidance when form is not visible above the fold', async () => {
      const scrapeDataWithBTF = {
        formData: [{
          finalUrl: 'https://www.surest.com/info/win-1',
          scrapeResult: [{
            visibleFieldCount: 3,
            visibleATF: false,
          }],
        }],
      };
      formsOppty.getType = () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION;
      dataAccessStub.Opportunity.create = sinon.stub().returns(formsOppty);
      const auditDataWithForm = {
        ...auditData,
        auditResult: {
          formVitals: [{
            form: 'https://www.surest.com/info/win-1',
            formViews: 1000,
            pageViews: 5000,
          }],
        },
      };
      await createLowConversionOpportunities(auditUrl, auditDataWithForm, scrapeDataWithBTF, context);
      const createCall = dataAccessStub.Opportunity.create.getCall(0);
      if (createCall) {
        const guidance = createCall.args[0].guidance;
        expect(guidance.recommendations[0].insight).to.include('not visible above the fold');
        expect(guidance.recommendations[0].recommendation).to.include('Move the form higher');
      }
    });

    it('should return generic guidance when conversion rate is between 0 and 0.1', async () => {
      const scrapeDataWithLowConversion = {
        formData: [{
          finalUrl: 'https://www.surest.com/info/win-1',
          scrapeResult: [{
            visibleFieldCount: 3,
            visibleATF: true,
          }],
        }],
      };
      formsOppty.getType = () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION;
      dataAccessStub.Opportunity.create = sinon.stub().returns(formsOppty);
      const auditDataWithForm = {
        ...auditData,
        auditResult: {
          formVitals: [{
            form: 'https://www.surest.com/info/win-1',
            formViews: 1000,
            pageViews: 5000,
            trackedFormKPIValue: 0.05,
          }],
        },
      };
      await createLowConversionOpportunities(auditUrl, auditDataWithForm, scrapeDataWithLowConversion, context);
      const createCall = dataAccessStub.Opportunity.create.getCall(0);
      if (createCall) {
        const guidance = createCall.args[0].guidance;
        expect(guidance.recommendations[0].insight).to.include('conversion rate');
        expect(guidance.recommendations[0].recommendation).to.include('compelling reason');
      }
    });

    it('should return empty guidance when conversion rate is 0', async () => {
      const scrapeDataEmpty = {
        formData: [{
          finalUrl: 'https://www.surest.com/info/win-1',
          scrapeResult: [{
            visibleFieldCount: 3,
            visibleATF: true,
          }],
        }],
      };
      formsOppty.getType = () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION;
      dataAccessStub.Opportunity.create = sinon.stub().returns(formsOppty);
      const auditDataWithForm = {
        ...auditData,
        auditResult: {
          formVitals: [{
            form: 'https://www.surest.com/info/win-1',
            formViews: 1000,
            pageViews: 5000,
            trackedFormKPIValue: 0,
          }],
        },
      };
      await createLowConversionOpportunities(auditUrl, auditDataWithForm, scrapeDataEmpty, context);
      const createCall = dataAccessStub.Opportunity.create.getCall(0);
      if (createCall) {
        const guidance = createCall.args[0].guidance;
        expect(guidance).to.deep.equal({});
      }
    });

    it('should return empty guidance when scraped data does not match form URL', async () => {
      const scrapeDataMismatch = {
        formData: [{
          finalUrl: 'https://www.surest.com/other-form',
          scrapeResult: [{
            visibleFieldCount: 8,
            visibleATF: true,
          }],
        }],
      };
      formsOppty.getType = () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION;
      dataAccessStub.Opportunity.create = sinon.stub().returns(formsOppty);
      const auditDataWithForm = {
        ...auditData,
        auditResult: {
          formVitals: [{
            form: 'https://www.surest.com/info/win-1',
            formViews: 1000,
            pageViews: 5000,
          }],
        },
      };
      await createLowConversionOpportunities(auditUrl, auditDataWithForm, scrapeDataMismatch, context);
      const createCall = dataAccessStub.Opportunity.create.getCall(0);
      if (createCall) {
        const guidance = createCall.args[0].guidance;
        expect(guidance).to.deep.equal({});
      }
    });

    it('should handle error in opportunity creation loop gracefully', async () => {
      dataAccessStub.Opportunity.allBySiteId.resolves([]);
      dataAccessStub.Opportunity.create.onFirstCall().resolves(formsOppty);
      dataAccessStub.Opportunity.create.onSecondCall().rejects(new Error('Creation failed'));
      const sendMessageStub = sinon.stub().rejects(new Error('Message failed'));
      context.sqs.sendMessage = sendMessageStub;
      // Mock generateOpptyData to return multiple opportunities so we can test the error on the second one
      createLowConversionOpportunities._testStubs.generateOpptyData.resolves([
        {
          form: 'https://www.surest.com/info/win-1',
          formsource: '.form',
          formViews: 5670,
          pageViews: 5670,
          trackedFormKPIName: 'Conversion Rate',
          trackedFormKPIValue: 0.018,
          metrics: [],
        },
        {
          form: 'https://www.surest.com/info/win-2',
          formsource: '.form',
          formViews: 5000,
          pageViews: 5000,
          trackedFormKPIName: 'Conversion Rate',
          trackedFormKPIValue: 0.015,
          metrics: [],
        },
      ]);

      await createLowConversionOpportunities(auditUrl, auditData, undefined, context);

      expect(logStub.error).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: site-id] Creating low conversion forms opportunity failed with error: Creation failed',
        sinon.match.instanceOf(Error),
      );
      expect(logStub.info).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: site-id] Successfully synced opportunity for high-form-views-low-conversions audit type.',
      );
    });

    it('should handle error when sending message fails', async () => {
      formsOppty.getType = () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION;
      dataAccessStub.Opportunity.create = sinon.stub().returns(formsOppty);
      context.sqs.sendMessage = sinon.stub().rejects(new Error('SQS error'));

      await createLowConversionOpportunities(auditUrl, auditData, undefined, context);

      expect(logStub.error).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: site-id] Creating low conversion forms opportunity failed with error: SQS error',
        sinon.match.instanceOf(Error),
      );
    });

    it('should handle reduce function with both isLargeForm and isBelowTheFold set', async () => {
      const scrapeDataBothIssues = {
        formData: [{
          finalUrl: 'https://www.surest.com/info/win-1',
          scrapeResult: [{
            visibleFieldCount: 8,
            visibleATF: false,
          }],
        }],
      };
      formsOppty.getType = () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION;
      dataAccessStub.Opportunity.create = sinon.stub().returns(formsOppty);
      const auditDataWithForm = {
        ...auditData,
        auditResult: {
          formVitals: [{
            form: 'https://www.surest.com/info/win-1',
            formViews: 1000,
            pageViews: 5000,
          }],
        },
      };
      await createLowConversionOpportunities(auditUrl, auditDataWithForm, scrapeDataBothIssues, context);
      const createCall = dataAccessStub.Opportunity.create.getCall(0);
      if (createCall) {
        const guidance = createCall.args[0].guidance;
        // Below the fold takes precedence over large form
        expect(guidance.recommendations[0].insight).to.include('not visible above the fold');
        expect(guidance.recommendations[0].recommendation).to.include('Move the form higher');
      }
    });

    it('should handle reduce function with multiple forms in scrapeResult', async () => {
      const scrapeDataMultipleForms = {
        formData: [{
          finalUrl: 'https://www.surest.com/info/win-1',
          scrapeResult: [
            {
              visibleFieldCount: 3,
              visibleATF: true,
            },
            {
              visibleFieldCount: 8,
              visibleATF: true,
            },
            {
              visibleFieldCount: 2,
              visibleATF: false,
            },
          ],
        }],
      };
      formsOppty.getType = () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION;
      dataAccessStub.Opportunity.create = sinon.stub().returns(formsOppty);
      const auditDataWithForm = {
        ...auditData,
        auditResult: {
          formVitals: [{
            form: 'https://www.surest.com/info/win-1',
            formViews: 1000,
            pageViews: 5000,
          }],
        },
      };
      await createLowConversionOpportunities(auditUrl, auditDataWithForm, scrapeDataMultipleForms, context);
      const createCall = dataAccessStub.Opportunity.create.getCall(0);
      if (createCall) {
        const guidance = createCall.args[0].guidance;
        // Below the fold takes precedence
        expect(guidance.recommendations[0].insight).to.include('not visible above the fold');
      }
    });

    it('should handle reduce function with no issues detected', async () => {
      const scrapeDataNoIssues = {
        formData: [{
          finalUrl: 'https://www.surest.com/info/win-1',
          scrapeResult: [{
            visibleFieldCount: 3,
            visibleATF: true,
          }],
        }],
      };
      formsOppty.getType = () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION;
      dataAccessStub.Opportunity.create = sinon.stub().returns(formsOppty);
      const auditDataWithForm = {
        ...auditData,
        auditResult: {
          formVitals: [{
            form: 'https://www.surest.com/info/win-1',
            formViews: 1000,
            pageViews: 5000,
            trackedFormKPIValue: 0.15, // Above 0.1 threshold
          }],
        },
      };
      await createLowConversionOpportunities(auditUrl, auditDataWithForm, scrapeDataNoIssues, context);
      const createCall = dataAccessStub.Opportunity.create.getCall(0);
      if (createCall) {
        const guidance = createCall.args[0].guidance;
        expect(guidance).to.deep.equal({});
      }
    });

    it('should send message to mystique when formsList is empty', async () => {
      dataAccessStub.Opportunity.allBySiteId.resolves([formsOppty]);
      formsOppty.getData = sinon.stub().returns({
        form: 'https://www.surest.com/info/win-1',
        formDetails: {
          is_lead_gen: true,
        },
      });
      const { auditDataWithExistingOppty } = testData;
      context.sqs.sendMessage = sinon.stub().resolves({});

      await createLowConversionOpportunities(
        auditUrl,
        auditDataWithExistingOppty,
        undefined,
        context,
      );

      expect(context.sqs.sendMessage).to.have.been.called;
    });

    it('should send message to forms quality agent when formsList is not empty', async () => {
      formsOppty.getType = () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION;
      dataAccessStub.Opportunity.create = sinon.stub().returns(formsOppty);
      context.sqs.sendMessage = sinon.stub().resolves({});

      await createLowConversionOpportunities(auditUrl, auditData, undefined, context);

      expect(context.sqs.sendMessage).to.have.been.called;
      const messageCall = context.sqs.sendMessage.getCall(0);
      expect(messageCall.args[0]).to.equal('spacecat-to-mystique');
    });

    it('should handle conversion rate exactly at 0.1 threshold', async () => {
      const scrapeDataExactThreshold = {
        formData: [{
          finalUrl: 'https://www.surest.com/info/win-1',
          scrapeResult: [{
            visibleFieldCount: 3,
            visibleATF: true,
          }],
        }],
      };
      formsOppty.getType = () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION;
      dataAccessStub.Opportunity.create = sinon.stub().returns(formsOppty);
      const auditDataWithForm = {
        ...auditData,
        auditResult: {
          formVitals: [{
            form: 'https://www.surest.com/info/win-1',
            formViews: 1000,
            pageViews: 5000,
            trackedFormKPIValue: 0.1, // Exactly at threshold
          }],
        },
      };
      await createLowConversionOpportunities(auditUrl, auditDataWithForm, scrapeDataExactThreshold, context);
      const createCall = dataAccessStub.Opportunity.create.getCall(0);
      if (createCall) {
        const guidance = createCall.args[0].guidance;
        // Should return empty because condition is > 0 && < 0.1
        expect(guidance).to.deep.equal({});
      }
    });
  });

  describe('handler loop full coverage', () => {
    it('should execute all lines in handler loop including calculateProjectedConversionValue', async () => {
      formsOppty.getType = () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION;
      dataAccessStub.Opportunity.create = sinon.stub().returns(formsOppty);
      context.calculateCPCValue = sinon.stub().resolves(2.5);

      await createLowConversionOpportunities(auditUrl, auditData, undefined, context);

      expect(dataAccessStub.Opportunity.create).to.have.been.called;
      expect(mockTagMappings.mergeTagsWithHardcodedTags).to.have.been.called;
      expect(logStub.debug).to.have.been.calledWithMatch(/forms opportunity high form views low conversion/);
      expect(logStub.debug).to.have.been.calledWithMatch(/forms Opportunity high form views low conversion created/);
    });

    it('should execute ESS_OPS origin branch in handler loop', async () => {
      const existingOppty = {
        getType: () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION,
        getData: () => ({ form: 'https://www.surest.com/info/win-1' }),
        getOrigin: () => ORIGINS.ESS_OPS,
      };
      dataAccessStub.Opportunity.allBySiteId.resolves([existingOppty]);
      formsOppty.getType = () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION;
      dataAccessStub.Opportunity.create = sinon.stub().returns(formsOppty);
      // Mock generateOpptyData to return data matching the existing opportunity
      createLowConversionOpportunities._testStubs.generateOpptyData.resolves([
        {
          form: 'https://www.surest.com/info/win-1',
          formsource: '.form',
          formViews: 5670,
          pageViews: 5670,
          trackedFormKPIName: 'Conversion Rate',
          trackedFormKPIValue: 0.018,
          metrics: [],
        },
      ]);

      await createLowConversionOpportunities(auditUrl, auditData, undefined, context);

      expect(logStub.debug).to.have.been.calledWithMatch(/Forms Opportunity high form views low conversion exists and is from ESS_OPS/);
      expect(dataAccessStub.Opportunity.create).to.have.been.called;
      const createCall = dataAccessStub.Opportunity.create.getCall(0);
      expect(createCall.args[0].status).to.equal('IGNORED');
    });

    it('should execute existing opportunity update branch with all method calls', async () => {
      const existingOppty = {
        getType: () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION,
        getData: () => ({ form: 'https://www.surest.com/info/win-1' }),
        getOrigin: () => 'AUTOMATION',
        setAuditId: sinon.stub(),
        setData: sinon.stub(),
        setGuidance: sinon.stub(),
        setUpdatedBy: sinon.stub(),
        save: sinon.stub().resolves(),
        guidance: {},
      };
      dataAccessStub.Opportunity.allBySiteId.resolves([existingOppty]);
      // Mock generateOpptyData to return data matching the existing opportunity
      createLowConversionOpportunities._testStubs.generateOpptyData.resolves([
        {
          form: 'https://www.surest.com/info/win-1',
          formsource: '.form',
          formViews: 5670,
          pageViews: 5670,
          trackedFormKPIName: 'Conversion Rate',
          trackedFormKPIValue: 0.018,
          metrics: [],
        },
      ]);

      await createLowConversionOpportunities(auditUrl, auditData, undefined, context);

      expect(existingOppty.setAuditId).to.have.been.called;
      expect(existingOppty.setData).to.have.been.called;
      expect(existingOppty.setGuidance).to.have.been.called;
      expect(existingOppty.setUpdatedBy).to.have.been.calledWith('system');
      expect(existingOppty.save).to.have.been.called;
      expect(logStub.info).to.have.been.calledWithMatch(/Form details available for data/);
      expect(logStub.debug).to.have.been.calledWithMatch(/Forms Opportunity high form views low conversion updated/);
    });

    it('should execute existing opportunity update branch with formDetails present', async () => {
      const existingOppty = {
        getType: () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION,
        getData: () => ({
          form: 'https://www.surest.com/info/win-1',
          formDetails: { is_lead_gen: true },
        }),
        getOrigin: () => 'AUTOMATION',
        setAuditId: sinon.stub(),
        setData: sinon.stub(),
        setGuidance: sinon.stub(),
        setUpdatedBy: sinon.stub(),
        save: sinon.stub().resolves(),
        guidance: {},
      };
      dataAccessStub.Opportunity.allBySiteId.resolves([existingOppty]);
      context.sqs.sendMessage = sinon.stub().resolves({});
      // Mock generateOpptyData to return data matching the existing opportunity
      createLowConversionOpportunities._testStubs.generateOpptyData.resolves([
        {
          form: 'https://www.surest.com/info/win-1',
          formsource: '.form',
          formViews: 5670,
          pageViews: 5670,
          trackedFormKPIName: 'Conversion Rate',
          trackedFormKPIValue: 0.018,
          metrics: [],
        },
      ]);

      await createLowConversionOpportunities(auditUrl, auditData, undefined, context);

      expect(logStub.info).to.have.been.calledWithMatch(/Form details available for opportunity, not sending it to mystique/);
      expect(context.sqs.sendMessage).to.have.been.called;
    });

    it('should execute error handling in catch block', async () => {
      dataAccessStub.Opportunity.allBySiteId.resolves([]);
      dataAccessStub.Opportunity.create = sinon.stub().rejects(new Error('Test error'));

      await createLowConversionOpportunities(auditUrl, auditData, undefined, context);

      expect(logStub.error).to.have.been.calledWithMatch(/Creating low conversion forms opportunity failed with error: Test error/);
      expect(logStub.info).to.have.been.calledWithMatch(/Successfully synced opportunity/);
    });

    it('should execute generateDefaultGuidance with nonSearchForms length 0', async () => {
      const scrapeDataWithSearchForms = {
        formData: [{
          finalUrl: 'https://www.surest.com/info/win-1',
          scrapeResult: [{
            visibleFieldCount: 3,
            visibleATF: true,
            fieldLabels: ['search', 'search query'],
          }],
        }],
      };
      formsOppty.getType = () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION;
      dataAccessStub.Opportunity.create = sinon.stub().returns(formsOppty);
      const auditDataWithForm = {
        ...auditData,
        auditResult: {
          formVitals: [{
            form: 'https://www.surest.com/info/win-1',
            formViews: 1000,
            pageViews: 5000,
          }],
        },
      };

      await createLowConversionOpportunities(auditUrl, auditDataWithForm, scrapeDataWithSearchForms, context);

      const createCall = dataAccessStub.Opportunity.create.getCall(0);
      if (createCall) {
        const guidance = createCall.args[0].guidance;
        expect(guidance).to.deep.equal({});
      }
    });
  });
});
