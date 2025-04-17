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
import createLowFormViewsOpportunities from '../../../src/forms-opportunities/oppty-handlers/low-form-views-handler.js';
import { FORM_OPPORTUNITY_TYPES } from '../../../src/forms-opportunities/constants.js';
import testData from '../../fixtures/forms/high-form-views-low-conversions.js';

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
      getType: () => FORM_OPPORTUNITY_TYPES.LOW_FORM_VIEWS,
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
    auditData = testData.lowFormviewsAuditData;
  });

  it('should create new high page views low form views opportunity', async () => {
    const expectedOpportunityData = {
      siteId: 'site-id',
      auditId: 'audit-id',
      runbook: 'https://adobe.sharepoint.com/:w:/s/AEM_Forms/EeYKNa4HQkRAleWXjC5YZbMBMhveB08F1yTTUQSrP97Eow?e=cZdsnA',
      type: FORM_OPPORTUNITY_TYPES.LOW_FORM_VIEWS,
      origin: 'AUTOMATION',
      title: 'Form Page has high views but the Form has low views',
      description: 'The Form Page has a lot of views but the Form has low Views due to Form being below the fold',
      tags: [
        'Forms Conversion',
      ],
      data: {
        form: 'https://www.surest.com/high-page-low-form-view',
        screenshot: '',
        trackedFormKPIName: 'Form Views',
        trackedFormKPIValue: 200,
        formViews: 200,
        pageViews: 6690,
        samples: 6690,
        scrapedStatus: false,
        metrics: [
          {
            type: 'formViews',
            device: '*',
            value: {
              page: 200,
            },
          },
          {
            type: 'formViews',
            device: 'mobile',
            value: {
              page: 0,
            },
          },
          {
            type: 'formViews',
            device: 'desktop',
            value: {
              page: 200,
            },
          },
          {
            type: 'pageViews',
            device: '*',
            value: {
              page: 6690,
            },
          },
          {
            type: 'pageViews',
            device: 'mobile',
            value: {
              page: 1000,
            },
          },
          {
            type: 'pageViews',
            device: 'desktop',
            value: {
              page: 5690,
            },
          },
          {
            type: 'traffic',
            device: '*',
            value: {
              paid: 2690,
              total: 6690,
              earned: 2000,
              owned: 2000,
            },
          },
        ],
      },
      guidance: {
        recommendations: [
          {
            insight: 'The Form in the page: https://www.surest.com/high-page-low-form-view is either placed below the fold or is shown as a pop-up/modal',
            recommendation: 'Position the form or a teaser of the form higher up on the page so users see it without scrolling. If the form is in a pop-up/modal, embed it directly on the page instead.',
            type: 'guidance',
            rationale: 'Forms that are visible above the fold are more likely to be seen and interacted with by users. People often close modals automatically without reading.',
          },
        ],
      },
    };
    await createLowFormViewsOpportunities(auditUrl, auditData, undefined, context);

    const actualCall = dataAccessStub.Opportunity.create.getCall(0).args[0];
    expect(actualCall).to.deep.equal(expectedOpportunityData);
    expect(logStub.info).to.be.calledWith('Successfully synced Opportunity for site: site-id and high page views low form views audit type.');
  });

  it('should use existing high page views low form view opportunity', async () => {
    dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([highPageViewsLowFormViewsOptty]);
    await createLowFormViewsOpportunities(auditUrl, auditData, undefined, context);
    expect(highPageViewsLowFormViewsOptty.save).to.be.calledOnce;
    expect(highPageViewsLowFormViewsOptty.setGuidance).to.be.calledWith(
      {
        recommendations: [
          {
            insight: 'The Form in the page: https://www.surest.com/existing-opportunity is either placed below the fold or is shown as a pop-up/modal',
            recommendation: 'Position the form or a teaser of the form higher up on the page so users see it without scrolling. If the form is in a pop-up/modal, embed it directly on the page instead.',
            type: 'guidance',
            rationale: 'Forms that are visible above the fold are more likely to be seen and interacted with by users. People often close modals automatically without reading.',
          },
        ],
      },
    );
    expect(logStub.info).to.be.calledWith('Successfully synced Opportunity for site: site-id and high page views low form views audit type.');
  });

  it('should throw error if fetching high page views low form navigation opportunity fails', async () => {
    dataAccessStub.Opportunity.allBySiteIdAndStatus.rejects(new Error('some-error'));

    try {
      await createLowFormViewsOpportunities(auditUrl, auditData, undefined, context);
    } catch (err) {
      expect(err.message).to.equal('Failed to fetch opportunities for siteId site-id: some-error');
    }

    expect(logStub.error).to.be.calledWith('Fetching opportunities for siteId site-id failed with error: some-error');
  });

  it('should throw error if creating high page views low form navigation opportunity fails', async () => {
    dataAccessStub.Opportunity.allBySiteIdAndStatus.returns([]);
    dataAccessStub.Opportunity.create = sinon.stub().rejects(new Error('some-error'));

    try {
      await createLowFormViewsOpportunities(auditUrl, auditData, undefined, context);
    } catch (err) {
      expect(err.message).to.equal('Failed to create Forms opportunity for high page views low form views for siteId site-id: some-error');
    }

    expect(logStub.error).to.be.calledWith('Creating Forms opportunity for high page views low form views for siteId site-id failed with error: some-error');
  });

  it('should handle empty form vitals data', async () => {
    auditData.auditResult.formVitals = [];

    await createLowFormViewsOpportunities(auditUrl, auditData, undefined, context);

    expect(dataAccessStub.Opportunity.create).to.not.be.called;
    expect(logStub.info).to.be.calledWith('Successfully synced Opportunity for site: site-id and high page views low form views audit type.');
  });
});
