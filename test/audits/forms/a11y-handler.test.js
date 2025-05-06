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
import createA11yOpportunities from '../../../src/forms-opportunities/oppty-handlers/a11y-handler.js';
import { MockContextBuilder } from '../../shared.js';
import { FORM_OPPORTUNITY_TYPES } from '../../../src/forms-opportunities/constants.js';

use(sinonChai);

describe('a11y-handler', () => {
  const sandbox = sinon.createSandbox();
  const auditUrl = 'https://example.com';
  const siteId = 'test-site-id';

  let context;
  let opportunityStub;
  let auditDataObject;

  beforeEach(() => {
    opportunityStub = {
      getId: () => 'opportunity-id',
      setAuditId: sinon.stub(),
      getData: sinon.stub().returns({ form: 'https://example.com/form1' }),
      setData: sinon.stub(),
      getType: sinon.stub().returns(FORM_OPPORTUNITY_TYPES.FORM_A11Y),
      save: sinon.stub().resolves(),
    };

    auditDataObject = {
      siteId,
      auditId: 'audit-id',
      fullAuditRef: 'www.example.com',
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        dataAccess: {
          Opportunity: {
            allBySiteIdAndStatus: sinon.stub().resolves([]),
            create: sinon.stub().resolves(opportunityStub),
          },
        },
      })
      .build();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return early if no a11y data is provided', async () => {
    const scrapedData = {
      formA11yData: [],
    };
    await createA11yOpportunities(auditUrl, auditDataObject, scrapedData, context);

    expect(context.dataAccess.Opportunity.create).not.to.have.been.called;
    expect(context.log.info).to.have.been.calledWith(`[Form Opportunity] [Site Id: ${siteId}] No a11y data found`);
  });

  it('should return early if no accessibility issues are found', async () => {
    const scrapedData = {
      formA11yData: [
        {
          finalUrl: 'https://example.com/form1',
          scrapedData: {
            a11yIssues: [],
          },
        },
      ],
    };

    await createA11yOpportunities(auditUrl, auditDataObject, scrapedData, context);

    expect(context.dataAccess.Opportunity.create).not.to.have.been.called;
    expect(context.log.info).to.have.been.calledWith(`[Form Opportunity] [Site Id: ${siteId}] No accessibility issues found`);
  });

  it('should create a new opportunity for each form with accessibility issues', async () => {
    const scrapedData = {
      formA11yData: [
        {
          finalUrl: 'https://example.com/form1',
          scrapedData: {
            a11yIssues: [
              {
                issue: 'color-contrast',
                successCriteriaTags: ['wcag112'],
                level: 'A',
                recommendation: 'color contrast should be 4:1',
                solution: ['<label></label>'],
              },
            ],
          },
        },
        {
          finalUrl: 'https://example.com/form2',
          scrapedData: {
            a11yIssues: [
              {
                issue: 'label',
                successCriteriaTags: ['wcag131'],
                level: 'A',
                recommendation: 'Form elements must have labels',
                solution: ['input[type="text"]'],
              },
            ],
          },
        },
      ],
    };

    await createA11yOpportunities(auditUrl, auditDataObject, scrapedData, context);

    expect(context.dataAccess.Opportunity.allBySiteIdAndStatus).to.have.been.calledWith(siteId, 'NEW');
    expect(context.dataAccess.Opportunity.create).to.have.been.calledTwice;

    // Verify first opportunity creation
    expect(context.dataAccess.Opportunity.create.firstCall.args[0]).to.deep.include({
      siteId,
      auditId: 'audit-id',
      type: FORM_OPPORTUNITY_TYPES.FORM_A11Y,
      origin: 'AUTOMATION',
      title: 'Accessibility Issues',
      description: 'Accessibility Issues',
    });

    expect(context.dataAccess.Opportunity.create.firstCall.args[0].data).to.deep.equal({
      form: 'https://example.com/form1',
      a11yIssues: [
        {
          issue: 'color-contrast',
          successCriteriaTags: ['wcag112'],
          level: 'A',
          recommendation: 'color contrast should be 4:1',
          solution: ['<label></label>'],
        },
      ],
    });

    // Verify second opportunity creation
    expect(context.dataAccess.Opportunity.create.secondCall.args[0]).to.deep.include({
      siteId,
      auditId: 'audit-id',
      type: FORM_OPPORTUNITY_TYPES.FORM_A11Y,
    });

    expect(context.dataAccess.Opportunity.create.secondCall.args[0].data).to.deep.equal({
      form: 'https://example.com/form2',
      a11yIssues: [
        {
          issue: 'label',
          successCriteriaTags: ['wcag131'],
          level: 'A',
          recommendation: 'Form elements must have labels',
          solution: ['input[type="text"]'],
        },
      ],
    });
  });

  it('should update existing opportunity if one exists for the form', async () => {
    const existingOpportunities = [opportunityStub];
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves(existingOpportunities);

    const scrapedData = {
      formA11yData: [
        {
          finalUrl: 'https://example.com/form1',
          scrapedData: {
            a11yIssues: [
              {
                issue: 'color-contrast',
                successCriteriaTags: ['wcag112'],
                level: 'A',
                recommendation: 'color contrast should be 4:1',
                solution: ['<label></label>'],
              },
            ],
          },
        },
      ],
    };

    await createA11yOpportunities(auditUrl, auditDataObject, scrapedData, context);

    expect(context.dataAccess.Opportunity.create).not.to.have.been.called;
    expect(opportunityStub.setAuditId).to.have.been.calledWith('audit-id');
    expect(opportunityStub.setData).to.have.been.called;
    expect(opportunityStub.save).to.have.been.called;
  });

  it('should handle errors when fetching opportunities', async () => {
    const error = new Error('Database error');
    context.dataAccess.Opportunity.allBySiteIdAndStatus.rejects(error);

    const scrapedData = {
      formA11yData: [
        {
          finalUrl: 'https://example.com/form1',
          scrapedData: {
            a11yIssues: [
              {
                issue: 'color-contrast',
                successCriteriaTags: ['wcag112'],
                level: 'A',
                recommendation: 'color contrast should be 4:1',
                solution: ['<label></label>'],
              },
            ],
          },
        },
      ],
    };

    try {
      await createA11yOpportunities(auditUrl, auditDataObject, scrapedData, context);
      expect.fail('Should have thrown an error');
    } catch (e) {
      expect(e.message).to.include(`Failed to fetch opportunities for siteId ${siteId}`);
      expect(context.log.error).to.have.been.called;
    }
  });

  it('should handle errors when creating opportunities', async () => {
    const error = new Error('Creation error');
    context.dataAccess.Opportunity.create.rejects(error);

    const scrapedData = {
      formA11yData: [
        {
          finalUrl: 'https://example.com/form1',
          scrapedData: {
            a11yIssues: [
              {
                code: 'color-contrast',
                message: 'Elements must have sufficient color contrast',
                severity: 'critical',
                selector: '#form-field-1',
              },
            ],
          },
        },
      ],
    };

    try {
      await createA11yOpportunities(auditUrl, auditDataObject, scrapedData, context);
      expect.fail('Should have thrown an error');
    } catch (e) {
      expect(e.message).to.include(`Failed to create a11y opportunities for siteId ${siteId}`);
      expect(context.log.error).to.have.been.called;
    }
  });
});
