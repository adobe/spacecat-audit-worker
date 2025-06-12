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

import { expect } from 'chai';
import sinon from 'sinon';
import handler from '../../../../src/forms-opportunities/guidance-handlers/guidance-accessibility.js';

describe('Guidance Accessibility Handler', () => {
  let mockLog;
  let mockOpportunity;
  let mockDataAccess;
  let mockContext;

  beforeEach(() => {
    mockLog = {
      info: sinon.spy(),
      error: sinon.spy(),
    };

    let mockOpportunityData = {
      accessibility: [
        {
          form: 'form1',
          formSource: 'source1',
          a11yIssues: [
            { issue: 'issue1' },
            { issue: 'issue2' },
          ],
        },
      ],
    };

    mockOpportunity = {
      getId: () => 'opp123',
      getData: () => mockOpportunityData,
      setData: (data) => {
        mockOpportunityData = data;
      },
      setUpdatedBy: sinon.spy(),
      setAuditId: sinon.spy(),
      save: sinon.stub().resolves(),
    };

    mockDataAccess = {
      Opportunity: {
        findById: sinon.stub(),
      },
    };

    mockContext = {
      log: mockLog,
      dataAccess: mockDataAccess,
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should handle message and update opportunity with guidance', async () => {
    const message = {
      auditId: 'audit123',
      siteId: 'site123',
      data: {
        opportunityId: 'opp123',
        a11y: [
          {
            form: 'form1',
            formSource: 'source1',
            a11yIssues: [
              { guidance: 'guidance1' },
              { guidance: 'guidance2' },
            ],
          },
        ],
      },
    };

    mockDataAccess.Opportunity.findById.resolves(mockOpportunity);

    const result = await handler(message, mockContext);

    expect(result.status).to.deep.equal(200);
    expect(mockDataAccess.Opportunity.findById.calledWith('opp123')).to.be.true;
    expect(mockOpportunity.setUpdatedBy.calledWith('system')).to.be.true;
    expect(mockOpportunity.setAuditId.calledWith('audit123')).to.be.true;
    expect(mockOpportunity.save.called).to.be.true;
    expect(mockLog.info.called).to.be.true;

    // Verify the guidance was merged correctly
    expect(mockOpportunity.getData().accessibility[0].a11yIssues).to.deep.equal([
      { issue: 'issue1', guidance: 'guidance1' },
      { issue: 'issue2', guidance: 'guidance2' },
    ]);
  });

  it('should handle case when opportunity is not found', async () => {
    const message = {
      auditId: 'audit123',
      siteId: 'site123',
      data: {
        opportunityId: 'opp123',
        a11y: [],
      },
    };

    mockDataAccess.Opportunity.findById.resolves(null);

    const result = await handler(message, mockContext);

    expect(result.status).to.deep.equal(200);
    expect(mockLog.error.calledWith('[Form Opportunity] [Site Id: site123] A11y opportunity not found')).to.be.true;
    expect(mockOpportunity.save.called).to.be.false;
  });

  it('should handle multiple forms in accessibility data', async () => {
    const message = {
      auditId: 'audit123',
      siteId: 'site123',
      data: {
        opportunityId: 'opp123',
        a11y: [
          {
            form: 'form1',
            formSource: 'source1',
            a11yIssues: [
              { guidance: 'guidance1' },
            ],
          },
          {
            form: 'form2',
            formSource: 'source2',
            a11yIssues: [
              { guidance: 'guidance3' },
            ],
          },
        ],
      },
    };

    mockOpportunity.getData().accessibility.push({
      form: 'form2',
      formSource: 'source2',
      a11yIssues: [
        { issue: 'issue3' },
      ],
    });

    mockDataAccess.Opportunity.findById.resolves(mockOpportunity);

    const result = await handler(message, mockContext);

    expect(result.status).to.deep.equal(200);
    expect(mockOpportunity.save.called).to.be.true;
    expect(mockOpportunity.getData().accessibility).to.have.lengthOf(2);
    expect(mockOpportunity.getData().accessibility[1].a11yIssues[0]).to.deep.equal({
      issue: 'issue3',
      guidance: 'guidance3',
    });
  });
});
