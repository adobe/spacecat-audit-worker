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
import { createReportOpportunity } from '../../../../src/accessibility/utils/data-processing.js';

describe('Accessibility Data Processing - createReportOpportunity', () => {
  let sandbox;
  let mockContext;
  let mockOpportunity;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    mockOpportunity = {
      getId: sandbox.stub().returns('test-opportunity-id'),
    };
    mockContext = {
      log: {
        error: sandbox.stub(),
        debug: sandbox.stub(),
      },
      dataAccess: {
        Opportunity: {
          create: sandbox.stub().resolves(mockOpportunity),
        },
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should create opportunity with merged tags', async () => {
    const opportunityInstance = {
      type: 'a11y-color-contrast',
      runbook: 'https://example.com/runbook',
      origin: 'AUTOMATION',
      title: 'Test Title',
      description: 'Test Description',
      tags: ['Accessibility'],
    };
    const auditData = {
      siteId: 'test-site-id',
      auditId: 'test-audit-id',
    };

    const result = await createReportOpportunity(opportunityInstance, auditData, mockContext);

    expect(result).to.have.property('opportunity');
    expect(mockContext.dataAccess.Opportunity.create).to.have.been.calledOnce;
    const createdOpportunityData = mockContext.dataAccess.Opportunity.create.getCall(0).args[0];
    expect(createdOpportunityData).to.have.property('tags').that.is.an('array');
    expect(createdOpportunityData.tags).to.include('Accessibility');
    expect(createdOpportunityData.tags.length).to.be.above(1); // Should have hardcoded tags plus 'Accessibility'
    expect(createdOpportunityData.siteId).to.equal('test-site-id');
    expect(createdOpportunityData.auditId).to.equal('test-audit-id');
    expect(createdOpportunityData.type).to.equal('a11y-color-contrast');
  });

  it('should merge hardcoded tags based on opportunity type', async () => {
    const opportunityInstance = {
      type: 'a11y-assistive',
      runbook: 'https://example.com/runbook',
      origin: 'AUTOMATION',
      title: 'Test Title',
      description: 'Test Description',
      tags: [],
    };
    const auditData = {
      siteId: 'test-site-id',
      auditId: 'test-audit-id',
    };

    await createReportOpportunity(opportunityInstance, auditData, mockContext);

    const createdOpportunityData = mockContext.dataAccess.Opportunity.create.getCall(0).args[0];
    expect(createdOpportunityData.tags).to.be.an('array');
    expect(createdOpportunityData.tags.length).to.be.above(0);
  });

  it('should handle errors gracefully', async () => {
    const opportunityInstance = {
      type: 'a11y-color-contrast',
      runbook: 'https://example.com/runbook',
      origin: 'AUTOMATION',
      title: 'Test Title',
      description: 'Test Description',
      tags: [],
    };
    const auditData = {
      siteId: 'test-site-id',
      auditId: 'test-audit-id',
    };

    mockContext.dataAccess.Opportunity.create.rejects(new Error('Database error'));

    await expect(createReportOpportunity(opportunityInstance, auditData, mockContext))
      .to.be.rejectedWith('Database error');
    expect(mockContext.log.error).to.have.been.called;
  });
});

