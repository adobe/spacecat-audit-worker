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
import esmock from 'esmock';
import { Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';

use(sinonChai);

describe('summarization guidance handler', () => {
  let context;
  let Site;
  let Audit;
  let Opportunity;
  let Suggestion;
  let log;
  let dummySite;
  let dummyAudit;
  let dummyOpportunity;
  let syncSuggestionsStub;
  let fetchStub;
  let handler;

  const mockSummarizationData = {
    guidance: [
      {
        insight: 'Content analysis reveals opportunities',
        rationale: 'Content summarization elements improve discoverability',
        recommendation: 'Focus on creating clear, engaging summaries',
        type: 'guidance',
      },
    ],
    suggestions: [
      {
        pageUrl: 'https://adobe.com/page1',
        pageSummary: {
          title: 'Page Title 1',
          formatted_summary: 'This is a formatted page summary',
          heading_selector: 'h1',
          insertion_method: 'insertAfter',
        },
        keyPoints: {
          formatted_items: ['Key point 1', 'Key point 2', 'Key point 3'],
        },
        sectionSummaries: [
          {
            title: 'Section 1',
            formatted_summary: 'Section summary 1',
            heading_selector: 'h2.section-heading',
            insertion_method: 'insertAfter',
          },
        ],
      },
    ],
  };

  beforeEach(async function () {
    this.timeout(10000);
    syncSuggestionsStub = sinon.stub().resolves();
    fetchStub = sinon.stub().resolves({
      ok: true,
      status: 200,
      json: sinon.stub().resolves(mockSummarizationData),
    });

    // Mock the handler with stubbed dependencies
    const mockedHandler = await esmock('../../../src/summarization/guidance-handler.js', {
      '../../../src/utils/data-access.js': {
        syncSuggestions: syncSuggestionsStub,
      },
      '@adobe/spacecat-shared-utils': {
        tracingFetch: fetchStub,
      },
    });

    handler = mockedHandler.default;
    Site = {
      findById: sinon.stub(),
    };
    dummySite = {
      getBaseURL: () => 'https://adobe.com',
      getId: () => 'site-id-123',
      getDeliveryType: () => 'aem',
    };
    Site.findById.resolves(dummySite);

    Audit = {
      findById: sinon.stub(),
    };
    dummyAudit = { auditId: 'audit-id' };
    Audit.findById.resolves(dummyAudit);

    dummyOpportunity = {
      getId: sinon.stub().returns('existing-oppty-id'),
      getType: sinon.stub().returns('summarization'),
      getSuggestions: sinon.stub().resolves([]),
      getData: sinon.stub().returns({ subType: 'summarization' }),
      setAuditId: sinon.stub(),
      setData: sinon.stub(),
      setGuidance: sinon.stub(),
      setUpdatedBy: sinon.stub(),
      save: sinon.stub().resolvesThis(),
    };
    Opportunity = {
      create: sinon.stub().resolves(dummyOpportunity),
      allBySiteId: sinon.stub().resolves([]),
      allBySiteIdAndStatus: sinon.stub().resolves([]),
    };
    Suggestion = {
      create: sinon.stub().resolves(),
      STATUSES: SuggestionDataAccess.STATUSES,
      TYPES: SuggestionDataAccess.TYPES,
    };
    log = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };
    context = {
      log,
      dataAccess: {
        Site,
        Audit,
        Opportunity,
        Suggestion,
      },
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should return badRequest when no presigned URL is provided', async () => {
    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      data: {},
    };

    const result = await handler(message, context);

    expect(result.status).to.equal(400);
    expect(log.error).to.have.been.calledWith('[Summarization] No presigned URL provided in message data');
    expect(fetchStub).not.to.have.been.called;
  });

  it('should log a warning and return if no site found', async () => {
    Site.findById.resolves(null);
    const message = {
      auditId: 'audit-id',
      siteId: 'unknown-site-id',
      data: {
        presignedUrl: 'https://s3.aws.com/summaries.json',
      },
    };
    await handler(message, context);
    expect(log.error).to.have.been.calledWith(sinon.match(/Site not found for siteId: unknown-site-id/));
    expect(fetchStub).not.to.have.been.called;
    expect(Opportunity.create).not.to.have.been.called;
  });

  it('should log a warning and return if no audit found', async () => {
    Audit.findById.resolves(null);
    const message = {
      auditId: 'unknown-audit-id',
      siteId: 'site-id',
      data: {
        presignedUrl: 'https://s3.aws.com/summaries.json',
      },
    };
    await handler(message, context);
    expect(log.warn).to.have.been.calledWith(sinon.match(/No audit found for auditId: unknown-audit-id/));
    expect(fetchStub).not.to.have.been.called;
    expect(Opportunity.create).not.to.have.been.called;
  });

  it('should return badRequest when fetch fails', async () => {
    fetchStub.resolves({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      data: {
        presignedUrl: 'https://s3.aws.com/summaries.json',
      },
    };

    const result = await handler(message, context);

    expect(result.status).to.equal(400);
    expect(log.error).to.have.been.calledWith(sinon.match(/\[Summarization\] Failed to fetch summarization data: 404 Not Found/));
  });

  it('should return badRequest when JSON parsing fails', async () => {
    fetchStub.resolves({
      ok: true,
      json: sinon.stub().rejects(new Error('Invalid JSON')),
    });

    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      data: {
        presignedUrl: 'https://s3.aws.com/summaries.json',
      },
    };

    const result = await handler(message, context);

    expect(result.status).to.equal(400);
    expect(log.error).to.have.been.calledWith(sinon.match(/\[Summarization\] Error processing summarization guidance: Invalid JSON/));
  });

  it('should return noContent when no suggestions are found', async () => {
    fetchStub.resolves({
      ok: true,
      json: sinon.stub().resolves({
        guidance: [
          {
            insight: 'Content analysis reveals opportunities',
            rationale: 'Content summarization elements improve discoverability',
            recommendation: 'Focus on creating clear, engaging summaries',
            type: 'guidance',
          },
        ],
        suggestions: [],
      }),
    });

    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      data: {
        presignedUrl: 'https://s3.aws.com/summaries.json',
      },
    };

    const result = await handler(message, context);

    expect(log.info).to.have.been.calledWith('[Summarization] No suggestions found in the response');
    expect(result.status).to.equal(204);
    expect(syncSuggestionsStub).not.to.have.been.called;
  });

  it('should create a new summarization opportunity if no existing opportunity is found', async () => {
    // Mock for opportunity creation
    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(dummyOpportunity);
    
    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      data: {
        presignedUrl: 'https://s3.aws.com/summaries.json',
      },
    };
    await handler(message, context);
    
    // Verify opportunity was created
    expect(Opportunity.create).to.have.been.calledOnce;
    const opptyArg = Opportunity.create.getCall(0).args[0];
    expect(opptyArg.type).to.equal('summarization');
    
    // Verify suggestions were synced once
    expect(syncSuggestionsStub).to.have.been.calledOnce;
  });

  it('should update existing summarization opportunity if found', async () => {
    // Mock existing opportunity
    Opportunity.allBySiteIdAndStatus.resolves([dummyOpportunity]);
    
    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      data: {
        presignedUrl: 'https://s3.aws.com/summaries.json',
      },
    };
    await handler(message, context);
    
    // Verify no new opportunities were created (convertToOpportunity handles existing)
    expect(Opportunity.create).not.to.have.been.called;
    
    // Verify opportunity was updated
    expect(dummyOpportunity.setAuditId).to.have.been.called;
    expect(dummyOpportunity.save).to.have.been.called;
    
    // Verify suggestions were synced once
    expect(syncSuggestionsStub).to.have.been.calledOnce;
  });

  it('removes previous suggestions if any', async () => {
    const oldSuggestion = { remove: sinon.stub().resolves() };
    dummyOpportunity.getSuggestions.resolves([oldSuggestion, oldSuggestion]);
    Opportunity.allBySiteId.resolves([dummyOpportunity]);
    
    fetchStub.resolves({
      ok: true,
      json: sinon.stub().resolves({
        guidance: [],
        suggestions: [
          {
            pageUrl: 'https://adobe.com/page1',
            pageSummary: {
              title: 'Page Title 1',
              formatted_summary: 'This is a page summary',
              heading_selector: 'h1',
              insertion_method: 'insertAfter',
            },
            keyPoints: {
              formatted_items: ['Key point A', 'Key point B'],
            },
            sectionSummaries: [],
          },
        ],
      }),
    });

    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      data: {
        presignedUrl: 'https://s3.aws.com/summaries.json',
      },
    };
    await handler(message, context);
    // syncSuggestions is called once and handles outdated suggestions internally
    expect(syncSuggestionsStub).to.have.been.calledOnce;
  });

  it('should create suggestion with correct data structure', async () => {
    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(dummyOpportunity);
    
    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      data: {
        presignedUrl: 'https://s3.aws.com/summaries.json',
      },
    };
    await handler(message, context);
    expect(syncSuggestionsStub).to.have.been.calledOnce;

    // Get the arguments passed to syncSuggestions
    const syncCall = syncSuggestionsStub.getCall(0);
    const syncArgs = syncCall.args[0];

    // Verify newData structure contains page and key points suggestions (no section summaries)
    expect(syncArgs.newData).to.be.an('array');
    expect(syncArgs.newData).to.have.length(2); // page + key points

    // Test the mapNewSuggestion function
    const testData = {
      summarizationText: 'Test summary',
      fullPage: true,
      url: 'https://adobe.com/test',
      title: 'Test Title',
      transformRules: {
        selector: 'h1',
        action: 'insertAfter',
      },
    };

    const mappedSuggestion = syncArgs.mapNewSuggestion(testData);
    expect(mappedSuggestion.opportunityId).to.equal('existing-oppty-id');
    expect(mappedSuggestion.type).to.equal('CODE_CHANGE');
    expect(mappedSuggestion.rank).to.equal(10);
    expect(mappedSuggestion.data).to.deep.equal(testData);
  });

  it('should create suggestion with NEW status when site does not require validation', async () => {
    // Set requiresValidation to false in context
    context.site = { requiresValidation: false };
    
    fetchStub.resolves({
      ok: true,
      json: sinon.stub().resolves({
        guidance: [
          {
            insight: 'Test insight',
            rationale: 'Test rationale',
            recommendation: 'Test recommendation',
          },
        ],
        suggestions: [
          {
            pageUrl: 'https://example.com/page1',
            pageSummary: {
              title: 'Page Title 1',
              formatted_summary: 'This is a page summary',
              heading_selector: 'h1',
              insertion_method: 'insertAfter',
            },
            keyPoints: {
              formatted_items: ['Key point 1', 'Key point 2'],
            },
            sectionSummaries: [
              {
                title: 'Section 1',
                formatted_summary: 'Section summary 1',
                heading_selector: 'h2',
                insertion_method: 'insertAfter',
              },
            ],
          },
        ],
      }),
    });

    const message = {
      siteId: dummySite.getId(),
      auditId: dummyAudit.auditId,
      data: {
        presignedUrl: 'https://s3.aws.com/summaries.json',
      },
    };
    
    await handler(message, context);
    expect(syncSuggestionsStub).to.have.been.calledOnce;
    
    // Get the arguments passed to syncSuggestions
    const syncCall = syncSuggestionsStub.getCall(0);
    const syncArgs = syncCall.args[0];
    
    // Test the mapNewSuggestion function
    const testData = {
      summarizationText: 'Test summary',
      fullPage: true,
      keyPoints: false,
      url: 'https://example.com/page1',
      title: 'Page Title 1',
      transformRules: {
        selector: 'h1',
        action: 'insertAfter',
      },
    };
    
    const mappedSuggestion = syncArgs.mapNewSuggestion(testData);
    expect(mappedSuggestion).to.have.property('opportunityId');
    expect(mappedSuggestion).to.have.property('type');
    expect(mappedSuggestion).to.have.property('rank');
  });

  it('should handle error when saving opportunity fails', async () => {
    const message = {
      siteId: dummySite.getId(),
      auditId: dummyAudit.auditId,
      data: {
        presignedUrl: 'https://s3.aws.com/summaries.json',
      },
    };

    // Mock existing opportunity
    const existingOpportunity = {
      getId: () => 'existing-opportunity-id',
      getData: () => ({ subType: 'summarization' }),
      getSuggestions: () => Promise.resolve([]),
      setAuditId: sinon.stub(),
      setData: sinon.stub(),
      setGuidance: sinon.stub(),
      setUpdatedBy: sinon.stub(),
      save: sinon.stub().resolvesThis(),
    };

    Opportunity.allBySiteId.resolves([existingOpportunity]);
    Opportunity.create.resolves(existingOpportunity);

    // Mock syncSuggestions to throw an error
    const error = new Error('Database connection failed');
    syncSuggestionsStub.rejects(error);

    const result = await handler(message, context);

    expect(result.status).to.equal(400);
    // The body is a Readable stream, so we need to read it
    const bodyText = await result.text();
    expect(bodyText).to.equal('{"message":"Failed to persist summarization opportunity"}');
    expect(log.error).to.have.been.calledWith(sinon.match(/\[Summarization\] Failed to save summarization opportunity on Mystique callback: Database connection failed/));
  });

  it('should call buildKey function for suggestions', async () => {
    const message = {
      siteId: dummySite.getId(),
      auditId: dummyAudit.auditId,
      data: {
        presignedUrl: 'https://s3.aws.com/summaries.json',
      },
    };

    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(dummyOpportunity);

    const result = await handler(message, context);

    expect(result.status).to.equal(200);
    expect(syncSuggestionsStub).to.have.been.calledOnce;

    // Test buildKey function
    const syncCall = syncSuggestionsStub.getCall(0);
    const syncArgs = syncCall.args[0];
    const testData = {
      summarizationText: 'test summary',
      fullPage: true,
      keyPoints: false,
      url: 'https://example.com/page1',
      title: 'Page Title 1',
      transformRules: {
        selector: 'h1',
        action: 'insertAfter',
      },
    };
    const buildKeyResult = syncArgs.buildKey(testData);
    expect(buildKeyResult).to.equal('https://example.com/page1-h1-text');
  });

  it('should correctly map new suggestion with CODE_CHANGE type', async () => {
    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(dummyOpportunity);
    
    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      data: {
        presignedUrl: 'https://s3.aws.com/summaries.json',
      },
    };
    
    await handler(message, context);
    
    // Get the arguments passed to syncSuggestions
    expect(syncSuggestionsStub).to.have.been.calledOnce;
    const syncCall = syncSuggestionsStub.getCall(0);
    const syncArgs = syncCall.args[0];
    
    // Verify the newData structure (from getJsonSummarySuggestion) - page + key points only
    expect(syncArgs.newData).to.be.an('array');
    expect(syncArgs.newData).to.have.length(2); // page summary + key points
    
    // Test the first suggestion (page-level)
    const pageLevelSuggestion = syncArgs.newData[0];
    expect(pageLevelSuggestion).to.have.property('summarizationText', 'This is a formatted page summary');
    expect(pageLevelSuggestion).to.have.property('fullPage', true);
    expect(pageLevelSuggestion).to.have.property('keyPoints', false);
    expect(pageLevelSuggestion).to.have.property('url', 'https://adobe.com/page1');
    expect(pageLevelSuggestion).to.have.nested.property('transformRules.selector', 'h1');
    expect(pageLevelSuggestion).to.have.nested.property('transformRules.action', 'insertAfter');
    
    // Test the second suggestion (key points)
    const keyPointsSuggestion = syncArgs.newData[1];
    expect(keyPointsSuggestion).to.have.property('summarizationText', '  * Key point 1\n  * Key point 2\n  * Key point 3');
    expect(keyPointsSuggestion).to.have.property('fullPage', true);
    expect(keyPointsSuggestion).to.have.property('keyPoints', true);
    expect(keyPointsSuggestion).to.have.property('url', 'https://adobe.com/page1');
    expect(keyPointsSuggestion).to.have.nested.property('transformRules.selector', 'h1');
    expect(keyPointsSuggestion).to.have.nested.property('transformRules.action', 'insertAfter');
    
    // Test the mapNewSuggestion function
    const testSuggestionData = {
      summarizationText: 'Test summary text',
      fullPage: true,
      keyPoints: false,
      url: 'https://adobe.com/test',
      transformRules: {
        selector: 'h1',
        action: 'insertAfter',
      },
    };
    
    const mappedSuggestion = syncArgs.mapNewSuggestion(testSuggestionData);
    expect(mappedSuggestion.opportunityId).to.equal('existing-oppty-id');
    expect(mappedSuggestion.type).to.equal('CODE_CHANGE');
    expect(mappedSuggestion.rank).to.equal(10);
    expect(mappedSuggestion.data).to.deep.equal(testSuggestionData);
    
    // Test the buildKey function for text
    const buildKeyResult = syncArgs.buildKey(testSuggestionData);
    expect(buildKeyResult).to.equal('https://adobe.com/test-h1-text');
    
    // Test the buildKey function for key points
    const keyPointsData = {
      summarizationText: '  * Key point 1\n  * Key point 2',
      fullPage: true,
      keyPoints: true,
      url: 'https://adobe.com/test',
      transformRules: {
        selector: 'h1',
        action: 'insertAfter',
      },
    };
    const keyPointsBuildKeyResult = syncArgs.buildKey(keyPointsData);
    expect(keyPointsBuildKeyResult).to.equal('https://adobe.com/test-h1-key-points');
  });

});
