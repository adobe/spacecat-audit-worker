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
import { FORM_OPPORTUNITY_TYPES, ORIGINS } from '../../../../src/forms-opportunities/constants.js';
import testData from '../../../fixtures/forms/high-form-views-low-conversions.js';
import { DATA_SOURCES } from '../../../../src/common/constants.js';

use(sinonChai);

// Mock tagMappings module
const mockTagMappings = {
  mergeTagsWithHardcodedTags: sinon.stub().callsFake((opportunityType, currentTags) => {
    if (opportunityType === 'high-page-views-low-form-views') {
      return ['Form Visibility', 'Engagement'];
    }
    return currentTags || [];
  }),
};

let createLowViewsOpportunities;
describe('createLowFormViewsOpportunities handler method', () => {
  let logStub;
  let dataAccessStub;
  let auditData;
  let auditUrl;
  let highPageViewsLowFormViewsOptty;
  let context;

  beforeEach(async () => {
    sinon.restore();
    // Import with mocked tagMappings
    createLowViewsOpportunities = await esmock(
      '../../../../src/forms-opportunities/oppty-handlers/low-views-handler.js',
      {
        '../../../../src/common/tagMappings.js': mockTagMappings,
      },
    );
    auditUrl = 'https://example.com';
    highPageViewsLowFormViewsOptty = {
      getOrigin: sinon.stub().returns('AUTOMATION'),
      getId: () => 'opportunity-id',
      setAuditId: sinon.stub(),
      save: sinon.stub(),
      getType: () => FORM_OPPORTUNITY_TYPES.LOW_VIEWS,
      setData: sinon.stub(),
      setGuidance: sinon.stub(),
      getData: sinon.stub().returns({
        form: 'https://www.surest.com/existing-opportunity',
        screenshot: '',
        trackedFormKPIName: 'Form Views',
        trackedFormKPIValue: 100,
        formViews: 100,
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
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
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
    auditData = testData.lowFormviewsAuditData;
  });

  it('should send message to mystique', async () => {
    dataAccessStub.Opportunity.allBySiteId.resolves([highPageViewsLowFormViewsOptty]);
    await createLowViewsOpportunities(auditUrl, auditData, undefined, context);
    const expectedMessage = {
      type: 'detect:form-details',
      siteId: 'site-id',
      auditId: 'audit-id',
      deliveryType: 'eds',
      data: {
        url: 'https://www.surest.com/existing-opportunity',
        form_source: '',
        cta_text: '',
        cta_source: '',
      },
    };
    expect(context.sqs.sendMessage).to.be.calledWith(
      'test-queue',
      sinon.match((actual) => (
        actual.type === expectedMessage.type
      ), 'matches expected message excluding timestamp'),
    );
  });

  it('should create new high page views low form views opportunity', async () => {
    const expectedOpportunityData = {
      siteId: 'site-id',
      auditId: 'audit-id',
      runbook: 'https://adobe.sharepoint.com/:w:/s/AEM_Forms/EeYKNa4HQkRAleWXjC5YZbMBMhveB08F1yTTUQSrP97Eow?e=cZdsnA',
      type: FORM_OPPORTUNITY_TYPES.LOW_VIEWS,
      origin: 'AUTOMATION',
      title: 'Your form isn\'t getting enough views — optimizations to drive visibility prepared',
      description: 'Poorly placed or hidden forms reduce leads — increasing visibility improves submission rates.',
      tags: [
        'Form Visibility',
        'Engagement',
      ],
      data: {
        form: 'https://www.surest.com/high-page-low-form-view',
        screenshot: '',
        trackedFormKPIName: 'Form View Rate',
        trackedFormKPIValue: 0.035,
        formViews: 200,
        pageViews: 5690,
        formsource: '',
        samples: 5690,
        scrapedStatus: false,
        projectedConversionValue: null,
        dataSources: [DATA_SOURCES.RUM, DATA_SOURCES.PAGE],
        metrics: [
          {
            type: 'formViewRate',
            device: '*',
            value: {
              page: 0.035,
            },
          },
          {
            type: 'formViewRate',
            device: 'mobile',
            value: {
              page: null,
            },
          },
          {
            type: 'formViewRate',
            device: 'desktop',
            value: {
              page: 0.035,
            },
          },
          {
            device: 'desktop',
            type: 'traffic',
            value: {
              page: 5690,
            },
          },
          {
            device: 'mobile',
            type: 'traffic',
            value: {
              page: 0,
            },
          },
        ],
      },
      guidance: {
        recommendations: [
          {
            insight: 'The form in the page: https://www.surest.com/high-page-low-form-view has low discoverability and only 3.51% visitors landing on the page are viewing the form.',
            recommendation: 'Position the form higher up on the page so users see it without scrolling. Consider using clear and compelling CTAs, minimizing distractions, and ensuring strong visibility across devices.',
            type: 'guidance',
            rationale: 'Forms that are visible above the fold are more likely to be seen and interacted with by users.',
          },
        ],
      },
    };
    await createLowViewsOpportunities(auditUrl, auditData, undefined, context);

    const actualCall = dataAccessStub.Opportunity.create.getCall(0).args[0];
    expect(actualCall).to.deep.equal(expectedOpportunityData);
    expect(logStub.info).to.be.calledWith('[Form Opportunity] [Site Id: site-id] successfully synced opportunity for site: site-id and high page views low form views audit type.');
  });

  it('should not create low views opportunity if another opportunity already exists', async () => {
    const excludeUrls = new Set();
    excludeUrls.add('https://www.surest.com/existing-opportunity');
    await createLowViewsOpportunities(auditUrl, auditData, undefined, context, excludeUrls);
    expect(dataAccessStub.Opportunity.create).to.be.callCount(1);
    expect(excludeUrls.has('https://www.surest.com/high-page-low-form-view')).to.be.true;
  });

  it('should use existing high page views low form view opportunity', async () => {
    dataAccessStub.Opportunity.allBySiteId.resolves([highPageViewsLowFormViewsOptty]);
    await createLowViewsOpportunities(auditUrl, auditData, undefined, context);
    expect(highPageViewsLowFormViewsOptty.setUpdatedBy).to.be.calledWith('system');
    expect(highPageViewsLowFormViewsOptty.save).to.be.calledOnce;
    expect(highPageViewsLowFormViewsOptty.setGuidance).to.be.calledWith(
      {
        recommendations: [
          {
            insight: 'The form in the page: https://www.surest.com/existing-opportunity has low discoverability and only 2.99% visitors landing on the page are viewing the form.',
            recommendation: 'Position the form higher up on the page so users see it without scrolling. Consider using clear and compelling CTAs, minimizing distractions, and ensuring strong visibility across devices.',
            type: 'guidance',
            rationale: 'Forms that are visible above the fold are more likely to be seen and interacted with by users.',
          },
        ],
      },
    );
    expect(logStub.info).to.be.calledWith('[Form Opportunity] [Site Id: site-id] successfully synced opportunity for site: site-id and high page views low form views audit type.');
  });

  it('should use existing high page views low form view opportunity with existing forms details', async () => {
    dataAccessStub.Opportunity.allBySiteId.resolves([highPageViewsLowFormViewsOptty]);
    highPageViewsLowFormViewsOptty.getData = sinon.stub().returns({
      form: 'https://www.surest.com/existing-opportunity',
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
    await createLowViewsOpportunities(auditUrl, auditData, undefined, context);
    expect(highPageViewsLowFormViewsOptty.setUpdatedBy).to.be.calledWith('system');
    expect(highPageViewsLowFormViewsOptty.save).to.be.calledOnce;
    expect(highPageViewsLowFormViewsOptty.setGuidance).to.be.calledWith(
      {
        recommendations: [
          {
            insight: 'The form in the page: https://www.surest.com/existing-opportunity has low discoverability and only 2.99% visitors landing on the page are viewing the form.',
            recommendation: 'Position the form higher up on the page so users see it without scrolling. Consider using clear and compelling CTAs, minimizing distractions, and ensuring strong visibility across devices.',
            type: 'guidance',
            rationale: 'Forms that are visible above the fold are more likely to be seen and interacted with by users.',
          },
        ],
      },
    );
    expect(logStub.info).to.be.calledWith('[Form Opportunity] [Site Id: site-id] successfully synced opportunity for site: site-id and high page views low form views audit type.');
  });

  it('should not process opportunities with origin ESS_OPS', async () => {
    highPageViewsLowFormViewsOptty.getOrigin = sinon.stub().returns(ORIGINS.ESS_OPS);
    dataAccessStub.Opportunity.allBySiteId.resolves([highPageViewsLowFormViewsOptty]);
    await createLowViewsOpportunities(auditUrl, auditData, undefined, context);
    expect(dataAccessStub.Opportunity.create).to.be.calledTwice;
  });

  it('should throw error if fetching high page views low form navigation opportunity fails', async () => {
    dataAccessStub.Opportunity.allBySiteId.rejects(new Error('some-error'));

    try {
      await createLowViewsOpportunities(auditUrl, auditData, undefined, context);
    } catch (err) {
      expect(err.message).to.equal('Failed to fetch opportunities for siteId site-id: some-error');
    }

    expect(logStub.error).to.be.calledWith('[Form Opportunity] [Site Id: site-id] fetching opportunities failed with error: some-error');
  });

  it('should throw error if creating high page views low form navigation opportunity fails', async () => {
    dataAccessStub.Opportunity.allBySiteId.returns([]);
    dataAccessStub.Opportunity.create = sinon.stub().rejects(new Error('some-error'));

    await createLowViewsOpportunities(auditUrl, auditData, undefined, context);

    expect(logStub.error).to.be.calledWith('[Form Opportunity] [Site Id: site-id] creating forms opportunity for high page views low form views failed with error: some-error', sinon.match.instanceOf(Error));
  });

  it('should handle empty form vitals data', async () => {
    auditData.auditResult.formVitals = [];
    await createLowViewsOpportunities(auditUrl, auditData, undefined, context);

    expect(dataAccessStub.Opportunity.create).to.not.be.called;
    expect(logStub.info).to.be.calledWith('[Form Opportunity] [Site Id: site-id] successfully synced opportunity for site: site-id and high page views low form views audit type.');
  });

  it('should handle when auditContext has data', async () => {
    const contextWithAuditData = {
      ...context,
      auditContext: { data: 'test-123' },
    };
    await createLowViewsOpportunities(auditUrl, auditData, undefined, contextWithAuditData);
    // Should work normally with auditContext.data defined
    expect(logStub.info).to.be.calledWith('[Form Opportunity] [Site Id: site-id] successfully synced opportunity for site: site-id and high page views low form views audit type.');
  });

  describe('handler loop coverage', () => {
    it('should find existing opportunity and update it', async () => {
      const existingOppty = {
        getType: () => FORM_OPPORTUNITY_TYPES.LOW_VIEWS,
        getData: () => ({ form: 'https://www.surest.com/high-page-low-form-view' }),
        getOrigin: () => 'AUTOMATION',
        setAuditId: sinon.stub(),
        setData: sinon.stub(),
        setGuidance: sinon.stub(),
        setUpdatedBy: sinon.stub(),
        save: sinon.stub().resolves(),
        guidance: {},
      };
      dataAccessStub.Opportunity.allBySiteId.resolves([existingOppty]);

      await createLowViewsOpportunities(auditUrl, auditData, undefined, context);

      expect(existingOppty.setAuditId).to.have.been.called;
      expect(existingOppty.setData).to.have.been.called;
      expect(existingOppty.setGuidance).to.have.been.called;
      expect(existingOppty.setUpdatedBy).to.have.been.calledWith('system');
      expect(existingOppty.save).to.have.been.called;
    });

    it('should not set guidance if existing opportunity already has guidance', async () => {
      const existingOppty = {
        getType: () => FORM_OPPORTUNITY_TYPES.LOW_VIEWS,
        getData: () => ({ form: 'https://www.surest.com/high-page-low-form-view' }),
        getOrigin: () => 'AUTOMATION',
        setAuditId: sinon.stub(),
        setData: sinon.stub(),
        setGuidance: sinon.stub(),
        setUpdatedBy: sinon.stub(),
        save: sinon.stub().resolves(),
        guidance: { recommendations: [{ insight: 'existing' }] },
      };
      dataAccessStub.Opportunity.allBySiteId.resolves([existingOppty]);

      await createLowViewsOpportunities(auditUrl, auditData, undefined, context);

      expect(existingOppty.setGuidance).to.not.have.been.called;
    });

    it('should send message to mystique when formsList is empty', async () => {
      const existingOppty = {
        getType: () => FORM_OPPORTUNITY_TYPES.LOW_VIEWS,
        getData: () => ({
          form: 'https://www.surest.com/high-page-low-form-view',
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

      await createLowViewsOpportunities(auditUrl, auditData, undefined, context);

      expect(context.sqs.sendMessage).to.have.been.called;
    });

    it('should handle error in opportunity creation loop gracefully', async () => {
      dataAccessStub.Opportunity.allBySiteId.resolves([]);
      dataAccessStub.Opportunity.create = sinon.stub().rejects(new Error('Creation failed'));

      await createLowViewsOpportunities(auditUrl, auditData, undefined, context);

      expect(logStub.error).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: site-id] creating forms opportunity for high page views low form views failed with error: Creation failed',
        sinon.match.instanceOf(Error),
      );
      expect(logStub.info).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: site-id] successfully synced opportunity for site: site-id and high page views low form views audit type.',
      );
    });

    it('should handle error when sending message fails', async () => {
      highPageViewsLowFormViewsOptty.getType = () => FORM_OPPORTUNITY_TYPES.LOW_VIEWS;
      dataAccessStub.Opportunity.create = sinon.stub().returns(highPageViewsLowFormViewsOptty);
      context.sqs.sendMessage = sinon.stub().rejects(new Error('SQS error'));

      await createLowViewsOpportunities(auditUrl, auditData, undefined, context);

      expect(logStub.error).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: site-id] creating forms opportunity for high page views low form views failed with error: SQS error',
        sinon.match.instanceOf(Error),
      );
    });

    it('should execute all lines in handler loop including calculateProjectedConversionValue', async () => {
      highPageViewsLowFormViewsOptty.getType = () => FORM_OPPORTUNITY_TYPES.LOW_VIEWS;
      dataAccessStub.Opportunity.create = sinon.stub().returns(highPageViewsLowFormViewsOptty);
      context.calculateCPCValue = sinon.stub().resolves(2.5);

      await createLowViewsOpportunities(auditUrl, auditData, undefined, context);

      expect(dataAccessStub.Opportunity.create).to.have.been.called;
      expect(mockTagMappings.mergeTagsWithHardcodedTags).to.have.been.called;
      expect(logStub.debug).to.have.been.calledWithMatch(/forms opportunity created high page views low form views/);
    });

    it('should execute ESS_OPS origin branch in handler loop', async () => {
      const existingOppty = {
        getType: () => FORM_OPPORTUNITY_TYPES.LOW_VIEWS,
        getData: () => ({ form: 'https://www.surest.com/high-page-low-form-view' }),
        getOrigin: () => ORIGINS.ESS_OPS,
      };
      dataAccessStub.Opportunity.allBySiteId.resolves([existingOppty]);
      highPageViewsLowFormViewsOptty.getType = () => FORM_OPPORTUNITY_TYPES.LOW_VIEWS;
      dataAccessStub.Opportunity.create = sinon.stub().returns(highPageViewsLowFormViewsOptty);

      await createLowViewsOpportunities(auditUrl, auditData, undefined, context);

      expect(dataAccessStub.Opportunity.create).to.have.been.called;
      const createCall = dataAccessStub.Opportunity.create.getCall(0);
      expect(createCall.args[0].status).to.equal('IGNORED');
    });

    it('should execute existing opportunity update branch with all method calls', async () => {
      const existingOppty = {
        getType: () => FORM_OPPORTUNITY_TYPES.LOW_VIEWS,
        getData: () => ({ form: 'https://www.surest.com/high-page-low-form-view' }),
        getOrigin: () => 'AUTOMATION',
        setAuditId: sinon.stub(),
        setData: sinon.stub(),
        setGuidance: sinon.stub(),
        setUpdatedBy: sinon.stub(),
        save: sinon.stub().resolves(),
        guidance: {},
      };
      dataAccessStub.Opportunity.allBySiteId.resolves([existingOppty]);

      await createLowViewsOpportunities(auditUrl, auditData, undefined, context);

      expect(existingOppty.setAuditId).to.have.been.called;
      expect(existingOppty.setData).to.have.been.called;
      expect(existingOppty.setGuidance).to.have.been.called;
      expect(existingOppty.setUpdatedBy).to.have.been.calledWith('system');
      expect(existingOppty.save).to.have.been.called;
      expect(logStub.debug).to.have.been.calledWithMatch(/form details available for data/);
    });

    it('should execute existing opportunity update branch with formDetails present', async () => {
      const existingOppty = {
        getType: () => FORM_OPPORTUNITY_TYPES.LOW_VIEWS,
        getData: () => ({
          form: 'https://www.surest.com/high-page-low-form-view',
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

      await createLowViewsOpportunities(auditUrl, auditData, undefined, context);

      expect(logStub.debug).to.have.been.calledWithMatch(/Form details available for opportunity, not sending it to mystique/);
      expect(context.sqs.sendMessage).to.have.been.called;
    });

    it('should execute error handling in catch block', async () => {
      dataAccessStub.Opportunity.allBySiteId.resolves([]);
      dataAccessStub.Opportunity.create = sinon.stub().rejects(new Error('Test error'));

      await createLowViewsOpportunities(auditUrl, auditData, undefined, context);

      expect(logStub.error).to.have.been.calledWithMatch(/creating forms opportunity for high page views low form views failed with error: Test error/);
      expect(logStub.info).to.have.been.calledWithMatch(/successfully synced opportunity/);
    });
  });
});
