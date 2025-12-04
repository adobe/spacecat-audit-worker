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
import brokenLinksGuidanceHandler from '../../src/broken-links-guidance/guidance-handler.js';
import { MockContextBuilder } from '../shared.js';
import auditDataMock from '../fixtures/broken-backlinks/audit.json' with { type: 'json' };

use(sinonChai);
describe('guidance-broken-links-remediation handler', () => {
  let sandbox;
  let mockContext;
  const mockMessage = {
    id: 'test-opportunity-id',
    siteId: 'test-site-id',
    type: 'guidance:broken-backlinks',
    data: {
      opportunityId: 'test-opportunity-id',
      brokenLinks: [{
        suggestionId: 'test-suggestion-id-1',
        brokenUrl: 'https://foo.com/redirects-throws-error',
        suggestedUrls: ['https://foo.com/redirects-throws-error-1', 'https://foo.com/redirects-throws-error-2'],
        aiRationale: 'The suggested URLs are similar to the original URL and are likely to be the correct destination.',
      }],
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
      getConfig: () => ({
        getFetchConfig: () => ({}),
      }),
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
      .get('/redirects-throws-error-1')
      .reply(200);
    nock('https://foo.com')
      .get('/redirects-throws-error-2')
      .reply(200);
    const response = await brokenLinksGuidanceHandler(mockMessage, mockContext);
    expect(response.status).to.equal(200);

    expect(mockSave).to.have.been.calledOnce;
    expect(mockSetData).to.have.been.calledWith({
      url_to: mockMessage.data.brokenLinks[0].broken_url,
      url_from: 'https://foo.com/redirects-throws-error',
      urlsSuggested: mockMessage.data.brokenLinks[0].suggestedUrls,
      aiRationale: mockMessage.data.brokenLinks[0].aiRationale,
    });
  });

  it('should return 404 if Site is not found', async () => {
    mockContext.dataAccess.Site.findById = sandbox.stub().resolves(null);
    mockContext.dataAccess.Audit.findById = sandbox.stub().resolves({});
    mockContext.dataAccess.Opportunity.findById = sandbox.stub().resolves({});
    mockContext.dataAccess.Suggestion.findById = sandbox.stub().resolves({});

    const response = await brokenLinksGuidanceHandler(mockMessage, mockContext);
    expect(response.status).to.equal(404);
    expect(mockContext.dataAccess.Site.findById).to.have.been.calledWith(mockMessage.siteId);
    expect(mockContext.dataAccess.Opportunity.findById).to.not.have.been.called;
  });

  it('should return 404 if Audit is not found', async () => {
    mockContext.dataAccess.Site.findById = sandbox.stub().resolves({});
    mockContext.dataAccess.Audit.findById = sandbox.stub().resolves(null);
    mockContext.dataAccess.Opportunity.findById = sandbox.stub().resolves({});
    mockContext.dataAccess.Suggestion.findById = sandbox.stub().resolves({});

    const response = await brokenLinksGuidanceHandler(mockMessage, mockContext);
    expect(response.status).to.equal(404);
    expect(mockContext.dataAccess.Audit.findById).to.have.been.calledWith(mockMessage.auditId);
    expect(mockContext.dataAccess.Opportunity.findById).to.not.have.been.called;
  });

  it('should return 404 if Opportunity is not found', async () => {
    mockContext.dataAccess.Site.findById = sandbox.stub().resolves({});
    mockContext.dataAccess.Audit.findById = sandbox.stub().resolves({});
    mockContext.dataAccess.Opportunity.findById = sandbox.stub().resolves(null);
    mockContext.dataAccess.Suggestion.findById = sandbox.stub().resolves({});

    const response = await brokenLinksGuidanceHandler(mockMessage, mockContext);
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
      getType: () => 'broken-backlinks',
    });
    mockContext.dataAccess.Suggestion.findById = sandbox.stub().resolves({});
    const response = await brokenLinksGuidanceHandler(mockMessage, mockContext);
    expect(response.status).to.equal(400);
    expect(mockContext.dataAccess.Audit.findById).to.have.been.calledWith(mockMessage.auditId);
    expect(mockContext.dataAccess.Opportunity.findById).to.have.been
      .calledWith(mockMessage.data.opportunityId);
    expect(mockContext.dataAccess.Suggestion.findById).to.not.have.been.called;
  });

  it('should return 404 if Suggestion is not found', async () => {
    mockContext.dataAccess.Site.findById = sandbox.stub().resolves(
      { getId: () => mockMessage.siteId, getConfig: () => ({}) },
    );
    mockContext.dataAccess.Audit.findById = sandbox.stub().resolves({});
    mockContext.dataAccess.Opportunity.findById = sandbox.stub().resolves(
      {
        getSiteId: () => mockMessage.siteId,
        getType: () => 'broken-backlinks',
      },
    );
    mockContext.dataAccess.Suggestion.findById = sandbox.stub().resolves(null);

    await brokenLinksGuidanceHandler(mockMessage, mockContext);
    expect(mockContext.log.error).to.have.been.calledWith('[broken-backlinks] Suggestion not found for ID: test-suggestion-id-1');
  });

  it('should clear AI rationale when all URLs are filtered out', async () => {
    const messageWithFilteredUrls = {
      ...mockMessage,
      data: {
        ...mockMessage.data,
        brokenLinks: [{
          suggestionId: 'test-suggestion-id-1',
          brokenUrl: 'https://foo.com/redirects-throws-error',
          suggestedUrls: ['https://external.com/invalid-url'],
          aiRationale: 'This rationale should be cleared',
        }],
      },
    };
    mockContext.dataAccess.Site.findById = sandbox.stub().resolves({
      getId: () => mockMessage.siteId,
      getBaseURL: () => 'https://foo.com',
      getConfig: () => ({
        getFetchConfig: () => ({}),
      }),
    });
    mockContext.dataAccess.Audit.findById = sandbox.stub().resolves({
      getId: () => auditDataMock.id,
      getAuditType: () => 'broken-backlinks',
    });
    mockContext.dataAccess.Opportunity.findById = sandbox.stub().resolves({
      getSiteId: () => mockMessage.siteId,
      getId: () => mockMessage.data.opportunityId,
      getType: () => 'broken-backlinks',
    });
    const mockSetData = sandbox.stub();
    const mockSave = sandbox.stub().resolves();
    mockContext.dataAccess.Suggestion.findById = sandbox.stub().resolves({
      setData: mockSetData,
      getData: sandbox.stub().returns({
        url_to: 'https://foo.com/redirects-throws-error',
        url_from: 'https://foo.com/redirects-throws-error',
      }),
      save: mockSave,
    });
    // URL will be filtered out because it's external domain
    nock('https://external.com')
      .get('/invalid-url')
      .reply(200);

    const response = await brokenLinksGuidanceHandler(messageWithFilteredUrls, mockContext);
    expect(response.status).to.equal(200);
    expect(mockSetData).to.have.been.calledWith({
      url_to: 'https://foo.com/redirects-throws-error',
      url_from: 'https://foo.com/redirects-throws-error',
      urlsSuggested: [],
      aiRationale: '', // Should be cleared
    });
    expect(mockContext.log.info).to.have.been.calledWith(
      sinon.match(/All .* suggested URLs were filtered out/),
    );
  });

  it('should clear AI rationale when no URLs are provided', async () => {
    const messageWithNoUrls = {
      ...mockMessage,
      data: {
        ...mockMessage.data,
        brokenLinks: [{
          suggestionId: 'test-suggestion-id-1',
          brokenUrl: 'https://foo.com/redirects-throws-error',
          suggestedUrls: [],
          aiRationale: 'This rationale should be cleared',
        }],
      },
    };
    mockContext.dataAccess.Site.findById = sandbox.stub().resolves({
      getId: () => mockMessage.siteId,
      getBaseURL: () => 'https://foo.com',
      getConfig: () => ({
        getFetchConfig: () => ({}),
      }),
    });
    mockContext.dataAccess.Audit.findById = sandbox.stub().resolves({
      getId: () => auditDataMock.id,
      getAuditType: () => 'broken-backlinks',
    });
    mockContext.dataAccess.Opportunity.findById = sandbox.stub().resolves({
      getSiteId: () => mockMessage.siteId,
      getId: () => mockMessage.data.opportunityId,
      getType: () => 'broken-backlinks',
    });
    const mockSetData = sandbox.stub();
    const mockSave = sandbox.stub().resolves();
    mockContext.dataAccess.Suggestion.findById = sandbox.stub().resolves({
      setData: mockSetData,
      getData: sandbox.stub().returns({
        url_to: 'https://foo.com/redirects-throws-error',
        url_from: 'https://foo.com/redirects-throws-error',
      }),
      save: mockSave,
    });

    const response = await brokenLinksGuidanceHandler(messageWithNoUrls, mockContext);
    expect(response.status).to.equal(200);
    expect(mockSetData).to.have.been.calledWith({
      url_to: 'https://foo.com/redirects-throws-error',
      url_from: 'https://foo.com/redirects-throws-error',
      urlsSuggested: [],
      aiRationale: '', // Should be cleared
    });
    expect(mockContext.log.info).to.have.been.calledWith(
      sinon.match(/No suggested URLs provided by Mystique/),
    );
  });

  it('should return 400 if brokenLinks is not an array', async () => {
    const messageWithInvalidBrokenLinks = {
      ...mockMessage,
      data: {
        ...mockMessage.data,
        brokenLinks: 'not-an-array',
      },
    };
    mockContext.dataAccess.Site.findById = sandbox.stub().resolves({
      getId: () => mockMessage.siteId,
    });
    mockContext.dataAccess.Audit.findById = sandbox.stub().resolves({});
    mockContext.dataAccess.Opportunity.findById = sandbox.stub().resolves({
      getSiteId: () => mockMessage.siteId,
      getType: () => 'broken-backlinks',
    });

    const response = await brokenLinksGuidanceHandler(messageWithInvalidBrokenLinks, mockContext);
    expect(response.status).to.equal(400);
    expect(mockContext.log.error).to.have.been.calledWith(
      sinon.match(/Invalid brokenLinks format/),
    );
  });

  it('should return 400 if brokenLinks is missing', async () => {
    const messageWithMissingBrokenLinks = {
      ...mockMessage,
      data: {
        ...mockMessage.data,
        brokenLinks: null,
      },
    };
    mockContext.dataAccess.Site.findById = sandbox.stub().resolves({
      getId: () => mockMessage.siteId,
    });
    mockContext.dataAccess.Audit.findById = sandbox.stub().resolves({});
    mockContext.dataAccess.Opportunity.findById = sandbox.stub().resolves({
      getSiteId: () => mockMessage.siteId,
      getType: () => 'broken-backlinks',
    });

    const response = await brokenLinksGuidanceHandler(messageWithMissingBrokenLinks, mockContext);
    expect(response.status).to.equal(400);
    expect(mockContext.log.error).to.have.been.calledWith(
      sinon.match(/Invalid brokenLinks format/),
    );
  });

  it('should return 200 if brokenLinks is empty array', async () => {
    const messageWithEmptyBrokenLinks = {
      ...mockMessage,
      data: {
        ...mockMessage.data,
        brokenLinks: [],
      },
    };
    mockContext.dataAccess.Site.findById = sandbox.stub().resolves({
      getId: () => mockMessage.siteId,
    });
    mockContext.dataAccess.Audit.findById = sandbox.stub().resolves({});
    mockContext.dataAccess.Opportunity.findById = sandbox.stub().resolves({
      getSiteId: () => mockMessage.siteId,
      getType: () => 'broken-backlinks',
    });
    mockContext.dataAccess.Suggestion.findById = sandbox.stub();

    const response = await brokenLinksGuidanceHandler(messageWithEmptyBrokenLinks, mockContext);
    expect(response.status).to.equal(200);
    expect(mockContext.log.info).to.have.been.calledWith(
      sinon.match(/No broken links provided in Mystique response/),
    );
    expect(mockContext.dataAccess.Suggestion.findById).to.not.have.been.called;
  });

  it('should handle invalid suggestedUrls format (not an array)', async () => {
    const messageWithInvalidSuggestedUrls = {
      ...mockMessage,
      data: {
        ...mockMessage.data,
        brokenLinks: [{
          suggestionId: 'test-suggestion-id-1',
          brokenUrl: 'https://foo.com/redirects-throws-error',
          suggestedUrls: 'not-an-array',
          aiRationale: 'Test rationale',
        }],
      },
    };
    mockContext.dataAccess.Site.findById = sandbox.stub().resolves({
      getId: () => mockMessage.siteId,
      getBaseURL: () => 'https://foo.com',
      getConfig: () => ({
        getFetchConfig: () => ({}),
      }),
    });
    mockContext.dataAccess.Audit.findById = sandbox.stub().resolves({
      getId: () => auditDataMock.id,
      getAuditType: () => 'broken-backlinks',
    });
    mockContext.dataAccess.Opportunity.findById = sandbox.stub().resolves({
      getSiteId: () => mockMessage.siteId,
      getId: () => mockMessage.data.opportunityId,
      getType: () => 'broken-backlinks',
    });
    const mockSetData = sandbox.stub();
    const mockSave = sandbox.stub().resolves();
    mockContext.dataAccess.Suggestion.findById = sandbox.stub().resolves({
      setData: mockSetData,
      getData: sandbox.stub().returns({
        url_to: 'https://foo.com/redirects-throws-error',
        url_from: 'https://foo.com/redirects-throws-error',
      }),
      save: mockSave,
    });

    const response = await brokenLinksGuidanceHandler(messageWithInvalidSuggestedUrls, mockContext);
    expect(response.status).to.equal(200);
    expect(mockContext.log.info).to.have.been.calledWith(
      sinon.match(/Invalid suggestedUrls format/),
    );
    expect(mockSetData).to.have.been.calledWith({
      url_to: 'https://foo.com/redirects-throws-error',
      url_from: 'https://foo.com/redirects-throws-error',
      urlsSuggested: [],
      aiRationale: '', // Rationale cleared because no valid URLs provided
    });
  });

  it('should handle missing suggestedUrls field', async () => {
    const messageWithNoSuggestedUrls = {
      ...mockMessage,
      data: {
        ...mockMessage.data,
        brokenLinks: [{
          suggestionId: 'test-suggestion-id-1',
          brokenUrl: 'https://foo.com/redirects-throws-error',
          // No suggestedUrls field - Mystique consistently returns suggestedUrls (camelCase)
          aiRationale: 'Test rationale',
        }],
      },
    };
    mockContext.dataAccess.Site.findById = sandbox.stub().resolves({
      getId: () => mockMessage.siteId,
      getBaseURL: () => 'https://foo.com',
      getConfig: () => ({
        getFetchConfig: () => ({}),
      }),
    });
    mockContext.dataAccess.Audit.findById = sandbox.stub().resolves({
      getId: () => auditDataMock.id,
      getAuditType: () => 'broken-backlinks',
    });
    mockContext.dataAccess.Opportunity.findById = sandbox.stub().resolves({
      getSiteId: () => mockMessage.siteId,
      getId: () => mockMessage.data.opportunityId,
      getType: () => 'broken-backlinks',
    });
    const mockSetData = sandbox.stub();
    const mockSave = sandbox.stub().resolves();
    mockContext.dataAccess.Suggestion.findById = sandbox.stub().resolves({
      setData: mockSetData,
      getData: sandbox.stub().returns({
        url_to: 'https://foo.com/redirects-throws-error',
        url_from: 'https://foo.com/redirects-throws-error',
      }),
      save: mockSave,
    });

    const response = await brokenLinksGuidanceHandler(messageWithNoSuggestedUrls, mockContext);
    expect(response.status).to.equal(200);
    expect(mockSetData).to.have.been.calledWith({
      url_to: 'https://foo.com/redirects-throws-error',
      url_from: 'https://foo.com/redirects-throws-error',
      urlsSuggested: [],
      aiRationale: '', // Rationale cleared because no URLs provided
    });
  });

  it('should handle missing aiRationale field', async () => {
    const messageWithNoRationale = {
      ...mockMessage,
      data: {
        ...mockMessage.data,
        brokenLinks: [{
          suggestionId: 'test-suggestion-id-1',
          brokenUrl: 'https://foo.com/redirects-throws-error',
          suggestedUrls: ['https://foo.com/redirects-throws-error-1'],
          // No aiRationale field - Mystique consistently returns aiRationale (camelCase)
        }],
      },
    };
    mockContext.dataAccess.Site.findById = sandbox.stub().resolves({
      getId: () => mockMessage.siteId,
      getBaseURL: () => 'https://foo.com',
      getConfig: () => ({
        getFetchConfig: () => ({}),
      }),
    });
    mockContext.dataAccess.Audit.findById = sandbox.stub().resolves({
      getId: () => auditDataMock.id,
      getAuditType: () => 'broken-backlinks',
    });
    mockContext.dataAccess.Opportunity.findById = sandbox.stub().resolves({
      getSiteId: () => mockMessage.siteId,
      getId: () => mockMessage.data.opportunityId,
      getType: () => 'broken-backlinks',
    });
    const mockSetData = sandbox.stub();
    const mockSave = sandbox.stub().resolves();
    mockContext.dataAccess.Suggestion.findById = sandbox.stub().resolves({
      setData: mockSetData,
      getData: sandbox.stub().returns({
        url_to: 'https://foo.com/redirects-throws-error',
        url_from: 'https://foo.com/redirects-throws-error',
      }),
      save: mockSave,
    });
    nock('https://foo.com')
      .get('/redirects-throws-error-1')
      .reply(200);

    const response = await brokenLinksGuidanceHandler(messageWithNoRationale, mockContext);
    expect(response.status).to.equal(200);
    expect(mockSetData).to.have.been.calledWith({
      url_to: 'https://foo.com/redirects-throws-error',
      url_from: 'https://foo.com/redirects-throws-error',
      urlsSuggested: ['https://foo.com/redirects-throws-error-1'],
      aiRationale: '', // Empty string when neither field exists
    });
  });
});
