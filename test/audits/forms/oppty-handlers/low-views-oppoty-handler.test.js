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
import createLowViewsOpportunities from '../../../../src/forms-opportunities/oppty-handlers/low-views-handler.js';
import { FORM_OPPORTUNITY_TYPES } from '../../../../src/forms-opportunities/constants.js';
import testData from '../../../fixtures/forms/high-form-views-low-conversions.js';
import { DATA_SOURCES } from '../../../../src/common/constants.js';

use(sinonChai);
describe('createLowFormViewsOpportunities handler method', () => {
  let logStub;
  let dataAccessStub;
  let auditData;
  let auditUrl;
  let highPageViewsLowFormViewsOptty;
  let context;

  beforeEach(() => {
    sinon.restore();
    auditUrl = 'https://example.com';
    highPageViewsLowFormViewsOptty = {
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
        allBySiteIdAndStatus: sinon.stub().resolves([]),
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
    dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([highPageViewsLowFormViewsOptty]);
    await createLowViewsOpportunities(auditUrl, auditData, undefined, context);
    const expectedMessage = {
      type: 'guidance:high-page-views-low-form-views',
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
        && actual.siteId === expectedMessage.siteId
        && actual.auditId === expectedMessage.auditId
        && actual.data.url === expectedMessage.data.url
        && actual.deliveryType === expectedMessage.deliveryType
        && actual.data.form_source === expectedMessage.data.form_source
        && actual.data.cta_text === expectedMessage.data.cta_text
        && actual.data.cta_source === expectedMessage.data.cta_source
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
      title: 'Form has low views',
      description: 'The form has low views but the page containing the form has higher traffic',
      tags: [
        'Form Placement',
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
    expect(logStub.info).to.be.calledWith('Successfully synced Opportunity for site: site-id and high page views low form views audit type.');
  });

  it('should not create low views opportunity if another opportunity already exists', async () => {
    const excludeUrls = new Set();
    excludeUrls.add('https://www.surest.com/existing-opportunity');
    await createLowViewsOpportunities(auditUrl, auditData, undefined, context, excludeUrls);
    expect(dataAccessStub.Opportunity.create).to.be.callCount(1);
    expect(excludeUrls.has('https://www.surest.com/high-page-low-form-view')).to.be.true;
  });

  it('should use existing high page views low form view opportunity', async () => {
    dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([highPageViewsLowFormViewsOptty]);
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
    expect(logStub.info).to.be.calledWith('Successfully synced Opportunity for site: site-id and high page views low form views audit type.');
  });

  it('should throw error if fetching high page views low form navigation opportunity fails', async () => {
    dataAccessStub.Opportunity.allBySiteIdAndStatus.rejects(new Error('some-error'));

    try {
      await createLowViewsOpportunities(auditUrl, auditData, undefined, context);
    } catch (err) {
      expect(err.message).to.equal('Failed to fetch opportunities for siteId site-id: some-error');
    }

    expect(logStub.error).to.be.calledWith('Fetching opportunities for siteId site-id failed with error: some-error');
  });

  it('should throw error if creating high page views low form navigation opportunity fails', async () => {
    dataAccessStub.Opportunity.allBySiteIdAndStatus.returns([]);
    dataAccessStub.Opportunity.create = sinon.stub().rejects(new Error('some-error'));

    try {
      await createLowViewsOpportunities(auditUrl, auditData, undefined, context);
    } catch (err) {
      expect(err.message).to.equal('Failed to create Forms opportunity for high page views low form views for siteId site-id: some-error');
    }

    expect(logStub.error).to.be.calledWith('Creating Forms opportunity for high page views low form views for siteId site-id failed with error: some-error');
  });

  it('should handle empty form vitals data', async () => {
    auditData.auditResult.formVitals = [];

    await createLowViewsOpportunities(auditUrl, auditData, undefined, context);

    expect(dataAccessStub.Opportunity.create).to.not.be.called;
    expect(logStub.info).to.be.calledWith('Successfully synced Opportunity for site: site-id and high page views low form views audit type.');
  });
});
