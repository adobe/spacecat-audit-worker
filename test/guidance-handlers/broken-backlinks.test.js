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
import nock from 'nock';
import brokenBacklinksGuidanceHandler from '../../src/backlinks/guidance-handler.js';
import { MockContextBuilder } from '../shared.js';
import auditDataMock from '../fixtures/broken-backlinks/audit.json' with { type: 'json' };

use(sinonChai);
describe('guidance-broken-backlinks-remediation handler', () => {
  let sandbox;
  let mockContext;
  const mockMessage = {
    id: 'test-opportunity-id',
    siteId: 'test-site-id',
    type: 'guidance:broken-backlinks',
    data: {
      suggestionId: 'test-suggestion-id-1',
      opportunityId: 'test-opportunity-id',
      brokenUrl: 'https://foo.com/redirects-throws-error',
      suggestedUrls: ['https://foo.com/redirects-throws-error-1', 'https://foo.com/redirects-throws-error-2'],
      aiRationale: 'The suggested URLs are similar to the original URL and are likely to be the correct destination.',
    },
  };

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
    mockContext.dataAccess.Site.findById = sandbox.stub().resolves({
      getId: () => mockMessage.siteId,
      getBaseURL: () => 'https://foo.com',
    });
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
    nock('https://foo.com')
      .head('/redirects-throws-error-1')
      .reply(200);
    nock('https://foo.com')
      .head('/redirects-throws-error-2')
      .reply(200);
    const response = await brokenBacklinksGuidanceHandler(mockMessage, mockContext);
    expect(response.status).to.equal(200);

    expect(mockSave).to.have.been.calledOnce;
    expect(mockSetData).to.have.been.calledWith({
      url_to: mockMessage.data.broken_url,
      url_from: 'https://foo.com/redirects-throws-error',
      suggestedUrls: mockMessage.data.suggestedUrls,
      aiRationale: mockMessage.data.aiRationale,
    });
  });

  it('should return 404 if Site is not found', async () => {
    mockContext.dataAccess.Site.findById = sandbox.stub().resolves(null);
    mockContext.dataAccess.Audit.findById = sandbox.stub().resolves({});
    mockContext.dataAccess.Opportunity.findById = sandbox.stub().resolves({});
    mockContext.dataAccess.Suggestion.findById = sandbox.stub().resolves({});

    const response = await brokenBacklinksGuidanceHandler(mockMessage, mockContext);
    expect(response.status).to.equal(404);
    expect(mockContext.dataAccess.Site.findById).to.have.been.calledWith(mockMessage.siteId);
    expect(mockContext.dataAccess.Opportunity.findById).to.not.have.been.called;
  });

  it('should return 404 if Audit is not found', async () => {
    mockContext.dataAccess.Site.findById = sandbox.stub().resolves({});
    mockContext.dataAccess.Audit.findById = sandbox.stub().resolves(null);
    mockContext.dataAccess.Opportunity.findById = sandbox.stub().resolves({});
    mockContext.dataAccess.Suggestion.findById = sandbox.stub().resolves({});

    const response = await brokenBacklinksGuidanceHandler(mockMessage, mockContext);
    expect(response.status).to.equal(404);
    expect(mockContext.dataAccess.Audit.findById).to.have.been.calledWith(mockMessage.auditId);
    expect(mockContext.dataAccess.Opportunity.findById).to.not.have.been.called;
  });

  it('should return 404 if Opportunity is not found', async () => {
    mockContext.dataAccess.Site.findById = sandbox.stub().resolves({});
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
    mockContext.dataAccess.Site.findById = sandbox.stub()
      .resolves({ getId: () => mockMessage.siteId });
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
    mockContext.dataAccess.Site.findById = sandbox.stub().resolves(
      { getId: () => mockMessage.siteId },
    );
    mockContext.dataAccess.Audit.findById = sandbox.stub().resolves({});
    mockContext.dataAccess.Opportunity.findById = sandbox.stub().resolves(
      { getSiteId: () => mockMessage.siteId },
    );
    mockContext.dataAccess.Suggestion.findById = sandbox.stub().resolves(null);

    const response = await brokenBacklinksGuidanceHandler(mockMessage, mockContext);
    expect(response.status).to.equal(404);
  });
});
