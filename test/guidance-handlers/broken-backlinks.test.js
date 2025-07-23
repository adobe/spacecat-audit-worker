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
import brokenBacklinksGuidanceHandler from '../../src/backlinks/guidance-handler.js';
import { guidance } from '../fixtures/broken-backlinks/mystique-guidance.js';
import { MockContextBuilder } from '../shared.js';
import auditDataMock from '../fixtures/broken-backlinks/audit.json' with { type: 'json' };

use(sinonChai);
describe('guidance-broken-backlinks-remediation handler', () => {
  let sandbox;
  let mockContext;
  const mockMessage = guidance[0];

  before(async () => {
    sandbox = sinon.createSandbox();
    mockContext = new MockContextBuilder()
      .withSandbox(sandbox)
      .build(mockMessage);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should successfully process broken-backlinks remediation guidance', async () => {
    mockContext.dataAccess.Audit.findById = sandbox.stub().resolves({
      getId: () => auditDataMock.id,
      getAuditType: () => 'broken-backlinks',
    });
    mockContext.dataAccess.Opportunity.findById = sandbox.stub().resolves({
      getSiteId: () => mockMessage.siteId,
      getId: () => mockMessage.data.opportunityId,
    });
    const mockSetData = sandbox.stub();
    const mockSave = sandbox.stub().resolves();
    mockContext.dataAccess.Suggestion.findById = sandbox.stub().resolves({
      setData: mockSetData,
      getData: sandbox.stub().returns({
        url_to: mockMessage.data.broken_url,
        url_from: 'https://foo.com/redirects-throws-error',
      }),
      save: mockSave,
    });

    const response = await brokenBacklinksGuidanceHandler(mockMessage, mockContext);
    expect(response.status).to.equal(200);

    expect(mockSave).to.have.been.calledOnce;
    expect(mockSetData).to.have.been.calledWith({
      url_to: mockMessage.data.broken_url,
      url_from: 'https://foo.com/redirects-throws-error',
      suggestedUrls: mockMessage.data.suggested_urls,
      aiRationale: mockMessage.data.ai_rationale,
    });
  });

  it('should return 404 if Audit is not found', async () => {
    mockContext.dataAccess.Audit.findById = sandbox.stub().resolves(null);
    mockContext.dataAccess.Opportunity.findById = sandbox.stub().resolves({});
    mockContext.dataAccess.Suggestion.findById = sandbox.stub().resolves({});

    const response = await brokenBacklinksGuidanceHandler(mockMessage, mockContext);
    expect(response.status).to.equal(404);
    expect(mockContext.dataAccess.Audit.findById).to.have.been.calledWith(mockMessage.auditId);
    expect(mockContext.dataAccess.Opportunity.findById).to.not.have.been.called;
  });

  it('should return 404 if Opportunity is not found', async () => {
    mockContext.dataAccess.Audit.findById = sandbox.stub().resolves({});
    mockContext.dataAccess.Opportunity.findById = sandbox.stub().resolves(null);
    mockContext.dataAccess.Suggestion.findById = sandbox.stub().resolves({});

    const response = await brokenBacklinksGuidanceHandler(mockMessage, mockContext);
    expect(response.status).to.equal(404);
    expect(mockContext.dataAccess.Audit.findById).to.have.been.calledWith(mockMessage.auditId);
    expect(mockContext.dataAccess.Opportunity.findById).to.have.been
      .calledWith(mockMessage.data.opportunityId);
    expect(mockContext.dataAccess.Suggestion.findById).to.not.have.been.called;
  });

  it('should return error if Opportunity siteId does not match message siteId', async () => {
    mockContext.dataAccess.Audit.findById = sandbox.stub().resolves({});
    mockContext.dataAccess.Opportunity.findById = sandbox.stub().resolves({
      getSiteId: () => 'site-actual',
    });
    mockContext.dataAccess.Suggestion.findById = sandbox.stub().resolves({});
    const response = await brokenBacklinksGuidanceHandler(mockMessage, mockContext);
    expect(response.status).to.equal(400);
    expect(mockContext.dataAccess.Audit.findById).to.have.been.calledWith(mockMessage.auditId);
    expect(mockContext.dataAccess.Opportunity.findById).to.have.been
      .calledWith(mockMessage.data.opportunityId);
    expect(mockContext.dataAccess.Suggestion.findById).to.not.have.been.called;
  });

  it('should return 404 if Suggestion is not found', async () => {
    mockContext.dataAccess.Audit.findById = sandbox.stub().resolves({});
    mockContext.dataAccess.Opportunity.findById = sandbox.stub().resolves(
      { getSiteId: () => mockMessage.siteId },
    );
    mockContext.dataAccess.Suggestion.findById = sandbox.stub().resolves(null);

    const response = await brokenBacklinksGuidanceHandler(mockMessage, mockContext);
    expect(response.status).to.equal(404);
  });
});
