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
import createLowNavigationOpportunities from '../../../src/forms-opportunities/oppty-handlers/low-navigation-handler.js';
import { FORM_OPPORTUNITY_TYPES } from '../../../src/forms-opportunities/constants.js';
import testData from '../../fixtures/forms/high-form-views-low-conversions.js';

use(sinonChai);
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
          {
            type: 'formViews',
            device: 'mobile',
            value: {
              page: 300,
            },
          },
          {
            type: 'formViews',
            device: 'desktop',
            value: {
              page: 0,
            },
          },
          {
            type: 'traffic',
            device: '*',
            value: {
              paid: 4670,
              total: 8670,
              earned: 2000,
              owned: 2000,
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

  it('should not create low nav opportunity if another opportunity already exists', async () => {
    const excludeUrls = new Set();
    excludeUrls.add('https://www.surest.com/newsletter');
    await createLowNavigationOpportunities(auditUrl, auditData, undefined, context, excludeUrls);
    expect(dataAccessStub.Opportunity.create).to.not.be.called;
  });
});
