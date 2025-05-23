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
import createA11yOpportunities from '../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js';
import { MockContextBuilder } from '../../shared.js';
import { FORM_OPPORTUNITY_TYPES } from '../../../src/forms-opportunities/constants.js';

use(sinonChai);

describe('a11y-handler', () => {
  let sandbox;
  let mockContext;

  const a11yAuditData = {
    siteId: 'test-site-id',
    auditId: 'test-audit-id',
    data: {
      a11yData: [
        {
          form: '/test-form',
          formSource: '#test-form',
          a11yIssues: [
            {
              successCriterias: [
                '1.1.1 Non-text Content',
              ],
              issue: 'Test issue',
              level: 'AA',
              recommendation: 'Test recommendation',
              solution: [
                '<span>Solution 1</span>',
                '<span>Solution 2</span>',
              ],
            },
          ],
        },
      ],
    },
  };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    mockContext = new MockContextBuilder()
      .withSandbox(sandbox)
      .build();

    mockContext.dataAccess.Opportunity.allBySiteIdAndStatus = sandbox.stub().resolves([]);
    mockContext.dataAccess.Opportunity.create = sandbox.stub().resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should not create opportunity if a11yData is empty', async () => {
    // Setup
    const message = {
      siteId: 'test-site-id',
      auditId: 'test-audit-id',
      data: {
        a11yData: [],
      },
    };

    // Execute
    await createA11yOpportunities(message, mockContext);

    // Verify
    expect(mockContext.dataAccess.Opportunity.create).to.not.have.been.called;
    expect(mockContext.log.info).to.have.been.calledWith(
      `[Form Opportunity] [Site Id: ${message.siteId}] No a11y data found`,
    );
  });

  it('should not create opportunity if no a11y issues are found', async () => {
    // Setup
    const message = {
      siteId: 'test-site-id',
      auditId: 'test-audit-id',
      data: {
        a11yData: [
          {
            form: '/test-form',
            a11yIssues: [],
          },
        ],
      },
    };

    // Execute
    await createA11yOpportunities(message, mockContext);

    // Verify
    expect(mockContext.dataAccess.Opportunity.create).to.not.have.been.called;
    expect(mockContext.log.info).to.have.been.calledWith(
      `[Form Opportunity] [Site Id: ${message.siteId}] No accessibility issues found`,
    );
  });

  it('should handle errors when fetching opportunities', async () => {
    // Setup
    const error = new Error('Database error');
    mockContext.dataAccess.Opportunity.allBySiteIdAndStatus = sandbox.stub().rejects(error);

    const message = {
      siteId: 'test-site-id',
      auditId: 'test-audit-id',
      data: {
        a11yData: [
          {
            form: '/test-form',
            formSource: '#test-form',
            a11yIssues: [
              {
                successCriterias: ['1.1.1 Non-text Content'],
                issue: 'Test issue',
                level: 'AA',
                recommendation: 'Test recommendation',
                solution: ['<span>Solution</span>'],
              },
            ],
          },
        ],
      },
    };

    // Execute and Verify
    try {
      await createA11yOpportunities(message, mockContext);
      // Should not reach here
      expect.fail('Expected an error to be thrown');
    } catch (e) {
      expect(e.message).to.include(`Failed to fetch opportunities for siteId ${message.siteId}`);
      expect(mockContext.log.error).to.have.been.calledWith(
        `Fetching opportunities for siteId ${message.siteId} failed with error: ${error.message}`,
      );
    }
  });

  it('should create a new opportunity when none exists', async () => {
    // Setup
    const message = a11yAuditData;

    // Execute
    await createA11yOpportunities(message, mockContext);

    // Verify
    expect(mockContext.dataAccess.Opportunity.create).to.have.been.calledOnce;
    const createArgs = mockContext.dataAccess.Opportunity.create.getCall(0).args[0];
    expect(createArgs.siteId).to.equal(message.siteId);
    expect(createArgs.auditId).to.equal(message.auditId);
    expect(createArgs.type).to.equal(FORM_OPPORTUNITY_TYPES.FORM_A11Y);
    expect(createArgs.origin).to.equal('AUTOMATION');
    expect(createArgs.data.accessibility).to.have.lengthOf(1);
    expect(createArgs.data.accessibility[0].form).to.equal('/test-form');
    expect(createArgs.data.accessibility[0].formSource).to.equal('#test-form');
    expect(createArgs.data.accessibility[0].a11yIssues).to.have.lengthOf(1);

    // Check that success criteria are processed
    const successCriteria = createArgs.data.accessibility[0].a11yIssues[0].successCriterias[0];
    expect(successCriteria.criteriaNumber).to.equal('1.1.1');
    expect(successCriteria.name).to.equal('Non-text Content');
    expect(successCriteria).to.have.property('understandingUrl');
  });

  it('should update existing opportunity when one exists', async () => {
    // Setup
    const mockOpportunity = {
      setAuditId: sandbox.stub(),
      setData: sandbox.stub(),
      save: sandbox.stub().resolves(),
      getData: sandbox.stub().returns({}),
      getType: sandbox.stub().returns(FORM_OPPORTUNITY_TYPES.FORM_A11Y),
    };

    mockContext.dataAccess.Opportunity.allBySiteIdAndStatus = sandbox.stub()
      .resolves([mockOpportunity]);

    const message = {
      siteId: 'test-site-id',
      auditId: 'test-audit-id',
      data: {
        a11yData: [
          {
            form: '/test-form',
            formSource: '#test-form',
            a11yIssues: [
              {
                successCriterias: [
                  '1.4.3 Contrast (Minimum)',
                ],
                issue: 'Contrast issue',
                level: 'AA',
                recommendation: 'Fix contrast',
                solution: [
                  '<span>Solution</span>',
                ],
              },
            ],
          },
        ],
      },
    };

    // Execute
    await createA11yOpportunities(message, mockContext);

    // Verify
    expect(mockOpportunity.setAuditId).to.have.been.calledWith(message.auditId);
    expect(mockOpportunity.setData).to.have.been.calledOnce;
    expect(mockOpportunity.save).to.have.been.calledOnce;
    expect(mockContext.log.info).to.have.been.calledWith(
      `[Form Opportunity] [Site Id: ${message.siteId}] Updated a11y opportunity`,
    );
  });

  it('should fail while creating a new opportunity', async () => {
    const message = a11yAuditData;
    mockContext.dataAccess.Opportunity.create = sandbox.stub().rejects(new Error('Network error'));
    try {
      await createA11yOpportunities(message, mockContext);
      expect.fail('Expected an error to be thrown');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      expect(mockContext.log.error).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: test-site-id] Failed to create a11y opportunity with error: Network error',
      );
    }
  });
});
