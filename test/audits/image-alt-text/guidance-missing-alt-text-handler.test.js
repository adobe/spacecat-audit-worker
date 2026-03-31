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
import { Audit as AuditModel } from '@adobe/spacecat-shared-data-access';
import esmock from 'esmock';

describe('Missing Alt Text Guidance Handler', () => {
  let sandbox;
  let context;
  let mockOpportunity;
  let mockSite;
  let mockMessage;
  let guidanceHandler;
  let addAltTextSuggestionsStub;
  let getProjectedMetricsStub;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    mockOpportunity = {
      getId: () => 'opportunity-id',
      setAuditId: sandbox.stub(),
      setData: sandbox.stub(),
      getData: sandbox.stub().returns({}),
      save: sandbox.stub(),
      getSuggestions: sandbox.stub().returns([]),
      addSuggestions: sandbox.stub().returns({ errorItems: [], createdItems: [1] }),
      getType: () => AuditModel.AUDIT_TYPES.ALT_TEXT,
      getSiteId: () => 'site-id',
      setUpdatedBy: sandbox.stub(),
    };

    mockSite = {
      getId: () => 'test-site-id',
      getBaseURL: () => 'https://example.com',
    };

    context = {
      log: {
        info: sandbox.stub(),
        debug: sandbox.stub(),
        error: sandbox.stub(),
        warn: sandbox.stub(),
      },
      dataAccess: {
        Opportunity: {
          allBySiteIdAndStatus: sandbox.stub().resolves([mockOpportunity]),
          create: sandbox.stub().resolves(mockOpportunity),
        },
        Site: {
          findById: sandbox.stub().resolves(mockSite),
        },
        Audit: (() => {
          let auditResult = {
            status: 'processing',
            statusHistory: [
              { status: 'preparing', startedAt: '2026-03-30T10:00:00Z', completedAt: '2026-03-30T10:00:00Z', stepDurationMs: 0, queueDurationMs: null },
              { status: 'scraping', startedAt: '2026-03-30T10:00:05Z', completedAt: '2026-03-30T10:00:06Z', stepDurationMs: 1000, queueDurationMs: 5000 },
              { status: 'processing', startedAt: '2026-03-30T10:01:00Z', completedAt: '2026-03-30T10:01:03Z', stepDurationMs: 3000, queueDurationMs: 54000 },
            ],
          };
          let isError = false;
          const mockAuditRecord = {
            getId: () => 'test-audit-id',
            getAuditResult: sandbox.stub().callsFake(() => auditResult),
            setAuditResult: sandbox.stub().callsFake((val) => { auditResult = val; }),
            getIsError: sandbox.stub().callsFake(() => isError),
            setIsError: sandbox.stub().callsFake((val) => { isError = val; }),
            save: sandbox.stub().resolves(),
          };
          return {
            findById: sandbox.stub().resolves(mockAuditRecord),
            _mockRecord: mockAuditRecord,
          };
        })(),
        Suggestion: {
          bulkUpdateStatus: sandbox.stub().resolves(),
          STATUSES: {
            OUTDATED: 'OUTDATED',
          },
        },
      },
      env: {
        RUM_ADMIN_KEY: 'test-key',
      },
    };

    mockMessage = {
      type: 'guidance:missing-alt-text',
      siteId: 'test-site-id',
      auditId: 'test-audit-id',
      url: 'https://example.com',
      data: {
        suggestions: [
          {
            pageUrl: 'https://example.com/page1',
            imageId: 'image1.jpg',
            altText: 'Test alt text',
            imageUrl: 'https://example.com/image1.jpg',
            isAppropriate: true,
            isDecorative: false,
            language: 'en',
            hasAltAttribute: false,
          },
        ],
        pageUrls: ['https://example.com/page1'],
      },
    };

    // Create stubs for the imported functions
    addAltTextSuggestionsStub = sandbox.stub().resolves();
    getProjectedMetricsStub = sandbox.stub().resolves({
      projectedTrafficLost: 100,
      projectedTrafficValue: 100,
    });

    // Mock the guidance handler with all dependencies
    guidanceHandler = await esmock('../../../src/image-alt-text/guidance-missing-alt-text-handler.js', {
      '../../../src/image-alt-text/opportunityHandler.js': {
        addAltTextSuggestions: addAltTextSuggestionsStub,
        getProjectedMetrics: getProjectedMetricsStub,
      },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should process Mystique suggestions successfully', async () => {
    const result = await guidanceHandler(mockMessage, context);

    expect(result.status).to.equal(200);
    expect(context.dataAccess.Site.findById).to.have.been.calledWith('test-site-id');
    expect(mockOpportunity.setAuditId).to.have.been.calledWith('test-audit-id');
    expect(mockOpportunity.save).to.have.been.called;
    expect(addAltTextSuggestionsStub).to.have.been.called;
  });

  it('should preserve factId from Mystique enrichment', async () => {
    const messageWithFactId = {
      ...mockMessage,
      data: {
        ...mockMessage.data,
        suggestions: [
          {
            pageUrl: 'https://example.com/page1',
            imageId: 'image1.jpg',
            altText: 'Test alt text',
            imageUrl: 'https://example.com/image1.jpg',
            isAppropriate: true,
            isDecorative: false,
            language: 'en',
            hasAltAttribute: false,
            factId: 'legacy:opp-123:sugg-456',
          },
        ],
      },
    };

    const result = await guidanceHandler(messageWithFactId, context);

    expect(result.status).to.equal(200);
    expect(addAltTextSuggestionsStub).to.have.been.called;

    // Verify factId was included in the DTO
    const callArgs = addAltTextSuggestionsStub.getCall(0).args[0];
    const newSuggestions = callArgs.newSuggestionDTOs;
    expect(newSuggestions[0].data.recommendations[0].factId).to.equal('legacy:opp-123:sugg-456');
  });

  it('should handle case when opportunity does not exist', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);

    await expect(guidanceHandler(mockMessage, context))
      .to.be.rejectedWith('[alt-text]: No existing opportunity found for siteId test-site-id. Opportunity should be created by main handler before processing suggestions.');

    expect(context.log.error).to.have.been.calledWith(
      '[alt-text][AltTextProcessingError] No existing opportunity found for siteId test-site-id. Opportunity should be created by main handler before processing suggestions.',
    );
  });

  it('should handle empty suggestions', async () => {
    mockMessage.data.suggestions = [];

    const result = await guidanceHandler(mockMessage, context);

    expect(result.status).to.equal(200);
  });

  it('should handle invalid message format and track empty success status', async () => {
    const invalidMessage = {
      type: 'guidance:missing-alt-text',
      siteId: 'test-site-id',
      auditId: 'test-audit-id',
      url: 'https://example.com',
      // Missing data property
    };

    const result = await guidanceHandler(invalidMessage, context);

    expect(result.status).to.equal(200);
    expect(context.log.info).to.have.been.called;

    // Verify success status with empty: true was tracked
    const auditResult = context.dataAccess.Audit._mockRecord.getAuditResult();
    expect(auditResult.status).to.equal('success');
    const lastEntry = auditResult.statusHistory[auditResult.statusHistory.length - 1];
    expect(lastEntry.status).to.equal('success');
    expect(lastEntry.empty).to.equal(true);
  });

  it('should not fail when audit status save throws on empty response path', async () => {
    context.dataAccess.Audit._mockRecord.save = sandbox.stub().rejects(new Error('Save failed'));

    const invalidMessage = {
      type: 'guidance:missing-alt-text',
      siteId: 'test-site-id',
      auditId: 'test-audit-id',
      url: 'https://example.com',
    };

    const result = await guidanceHandler(invalidMessage, context);

    expect(result.status).to.equal(200);
    expect(context.log.warn).to.have.been.calledWith(
      sinon.match(/Failed to update audit status: Save failed/),
    );
  });

  it('should handle errors when fetching opportunities fails', async () => {
    const error = new Error('Fetch failed');
    context.dataAccess.Opportunity.allBySiteIdAndStatus.rejects(error);

    await expect(guidanceHandler(mockMessage, context))
      .to.be.rejectedWith('[alt-text]: Failed to fetch opportunities for siteId test-site-id: Fetch failed');

    expect(context.log.error).to.have.been.calledWith(
      '[alt-text][AltTextProcessingError] Fetching opportunities for siteId test-site-id failed with error: Fetch failed',
    );
  });

  it('should handle errors when updating existing opportunity fails', async () => {
    const error = new Error('Save failed');
    mockOpportunity.save.rejects(error);

    await expect(guidanceHandler(mockMessage, context))
      .to.be.rejected;
  });

  it('should handle missing url in message', async () => {
    const messageWithoutUrl = {
      ...mockMessage,
      url: undefined,
    };

    const result = await guidanceHandler(messageWithoutUrl, context);

    expect(result.status).to.equal(200);
    expect(getProjectedMetricsStub).to.have.been.called;
  });

  it('should calculate decorative images count correctly', async () => {
    const messageWithDecorative = {
      ...mockMessage,
      data: {
        suggestions: [
          {
            pageUrl: 'https://example.com/page1',
            imageId: 'image1.jpg',
            altText: 'Test alt text',
            imageUrl: 'https://example.com/image1.jpg',
            isAppropriate: true,
            isDecorative: true,
            language: 'en',
            hasAltAttribute: true,
          },
          {
            pageUrl: 'https://example.com/page2',
            imageId: 'image2.jpg',
            altText: 'Another alt text',
            imageUrl: 'https://example.com/image2.jpg',
            isAppropriate: true,
            isDecorative: false,
            language: 'en',
            hasAltAttribute: false,
          },
        ],
        pageUrls: ['https://example.com/page1', 'https://example.com/page2'],
      },
    };

    await guidanceHandler(messageWithDecorative, context);

    expect(mockOpportunity.setData).to.have.been.called;
    const setDataCall = mockOpportunity.setData.firstCall.args[0];
    expect(setDataCall.decorativeImagesCount).to.equal(1);
  });

  it('should accumulate metrics when opportunity already has existing data', async () => {
    // Set up mockOpportunity to return existing data
    const existingData = {
      projectedTrafficLost: 50,
      projectedTrafficValue: 50,
      decorativeImagesCount: 2,
      dataSources: ['RUM', 'SITE'],
      mystiqueResponsesReceived: 1,
    };
    mockOpportunity.getData.returns(existingData);

    mockOpportunity.getSuggestions.returns([]);

    getProjectedMetricsStub.resetBehavior();
    getProjectedMetricsStub.resetHistory();
    getProjectedMetricsStub.resolves({ projectedTrafficLost: 30, projectedTrafficValue: 30 });

    const messageWithNewSuggestions = {
      ...mockMessage,
      data: {
        suggestions: [
          {
            pageUrl: 'https://example.com/page2',
            imageId: 'image2.jpg',
            altText: 'Another alt text',
            imageUrl: 'https://example.com/image2.jpg',
            isAppropriate: true,
            isDecorative: true,
            language: 'en',
            hasAltAttribute: true,
          },
        ],
        pageUrls: ['https://example.com/page2'],
      },
    };

    const result = await guidanceHandler(messageWithNewSuggestions, context);

    expect(result.status).to.equal(200);

    // Verify that setData was called with accumulated values: 50 - 0 + 30 = 80
    expect(mockOpportunity.setData).to.have.been.calledWith(
      sinon.match({
        projectedTrafficLost: 80,
        projectedTrafficValue: 80,
        decorativeImagesCount: 3, // 2 existing + 1 new
        dataSources: ['RUM', 'SITE'],
      }),
    );
  });

  it('should handle when opportunity getData returns null', async () => {
    mockOpportunity.getData.returns(null);
    mockOpportunity.getSuggestions.returns([]);

    getProjectedMetricsStub.resetBehavior();
    getProjectedMetricsStub.resetHistory();
    getProjectedMetricsStub.resolves({ projectedTrafficLost: 25, projectedTrafficValue: 25 });

    const messageWithSuggestions = {
      ...mockMessage,
      data: {
        suggestions: [
          {
            pageUrl: 'https://example.com/page3',
            imageId: 'image3.jpg',
            altText: 'Third alt text',
            imageUrl: 'https://example.com/image3.jpg',
            isAppropriate: true,
            isDecorative: false,
            language: 'en',
            hasAltAttribute: false,
          },
        ],
        pageUrls: ['https://example.com/page3'],
      },
    };

    const result = await guidanceHandler(messageWithSuggestions, context);

    expect(result.status).to.equal(200);
    expect(mockOpportunity.setData).to.have.been.calledWith(
      sinon.match({
        projectedTrafficLost: 25,
        projectedTrafficValue: 25,
        decorativeImagesCount: 0,
        dataSources: undefined,
      }),
    );
  });

  it('should return notFound when audit does not exist', async () => {
    context.dataAccess.Audit.findById.resolves(null);

    const result = await guidanceHandler(mockMessage, context);

    expect(result.status).to.equal(404);
    expect(context.log.warn).to.have.been.calledWith(
      '[alt-text]: No audit found for auditId: test-audit-id',
    );
    expect(context.dataAccess.Audit.findById).to.have.been.calledWith('test-audit-id');
  });

  it('should proceed when audit exists', async () => {
    const mockAudit = { getId: () => 'test-audit-id' };
    context.dataAccess.Audit.findById.resolves(mockAudit);

    const result = await guidanceHandler(mockMessage, context);

    expect(result.status).to.equal(200);
    expect(context.dataAccess.Audit.findById).to.have.been.calledWith('test-audit-id');
  });

  it('should skip processing when message ID already exists in processedSuggestionIds', async () => {
    // Set up existing data with the message ID already processed
    const existingData = {
      projectedTrafficLost: 100,
      projectedTrafficValue: 100,
      decorativeImagesCount: 2,
      dataSources: ['RUM', 'SITE'],
      mystiqueResponsesReceived: 1,
      mystiqueResponsesExpected: 2,
      processedSuggestionIds: ['test-message-id'],
    };
    mockOpportunity.getData.returns(existingData);

    const messageWithProcessedId = {
      ...mockMessage,
      id: 'test-message-id',
    };

    const result = await guidanceHandler(messageWithProcessedId, context);

    expect(result.status).to.equal(200);
    expect(context.log.info).to.have.been.calledWith(
      '[alt-text]: Suggestions with id test-message-id already processed. Skipping processing.',
    );

    // Should not call any of the processing functions
    expect(getProjectedMetricsStub).to.not.have.been.called;
    expect(addAltTextSuggestionsStub).to.not.have.been.called;
    expect(mockOpportunity.setData).to.not.have.been.called;
    expect(mockOpportunity.save).to.not.have.been.called;
  });

  it('should handle clearing existing suggestions and calculating their metrics', async () => {
    // Set up existing suggestions that need to be removed
    const existingSuggestions = [
      {
        getData: () => ({
          recommendations: [{
            id: 'suggestion-1',
            pageUrl: 'https://example.com/page1',
            imageUrl: 'https://example.com/image1.jpg',
          }],
        }),
        getStatus: () => 'NEW',
      },
      {
        getData: () => ({
          recommendations: [{
            id: 'suggestion-2',
            pageUrl: 'https://example.com/page2',
            imageUrl: 'https://example.com/image2.jpg',
          }],
        }),
        getStatus: () => 'SKIPPED',
      },
      {
        getData: () => ({
          recommendations: [{
            id: 'suggestion-3',
            pageUrl: 'https://example.com/page1',
            imageUrl: 'https://example.com/image3.jpg',
          }],
        }),
        getStatus: () => 'FIXED',
      },
    ];

    mockOpportunity.getSuggestions.returns(existingSuggestions);

    // Set up getProjectedMetrics to return metrics for removed suggestions
    getProjectedMetricsStub.resetBehavior();
    getProjectedMetricsStub.onFirstCall().resolves({
      projectedTrafficLost: 50,
      projectedTrafficValue: 75,
    });
    getProjectedMetricsStub.onSecondCall().resolves({
      projectedTrafficLost: 100,
      projectedTrafficValue: 150,
    });

    const result = await guidanceHandler(mockMessage, context);

    expect(result.status).to.equal(200);
    expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.have.been.calledWith(
      [existingSuggestions[0]],
      'OUTDATED',
    );
    expect(getProjectedMetricsStub).to.have.been.calledTwice;

    const firstCall = getProjectedMetricsStub.getCall(0);
    expect(firstCall.args[0].images).to.deep.include({
      pageUrl: 'https://example.com/page1',
      src: 'https://example.com/image1.jpg',
    });

    expect(context.log.debug).to.have.been.calledWith(
      '[alt-text]: Marked 1 suggestions as OUTDATED for 1 pages',
    );
  });

  it('should handle case when no existing suggestions need to be removed', async () => {
    // Set up existing suggestions that are all SKIPPED or FIXED
    const existingSuggestions = [
      {
        getData: () => ({
          recommendations: [{
            id: 'suggestion-1',
            pageUrl: 'https://example.com/page1',
            imageUrl: 'https://example.com/image1.jpg',
          }],
        }),
        getStatus: () => 'SKIPPED',
      },
      {
        getData: () => ({
          recommendations: [{
            id: 'suggestion-2',
            pageUrl: 'https://example.com/page2',
            imageUrl: 'https://example.com/image2.jpg',
          }],
        }),
        getStatus: () => 'FIXED',
      },
    ];

    mockOpportunity.getSuggestions.returns(existingSuggestions);

    const result = await guidanceHandler(mockMessage, context);

    expect(result.status).to.equal(200);

    expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.not.have.been.called;
    expect(getProjectedMetricsStub).to.have.been.called;
  });

  it('should set success status on audit after processing Mystique response', async () => {
    const result = await guidanceHandler(mockMessage, context);

    expect(result.status).to.equal(200);

    // Verify Audit.findById was called to load audit for status update
    expect(context.dataAccess.Audit.findById).to.have.been.calledWith('test-audit-id');
  });

  it('should append success to existing statusHistory', async () => {
    await guidanceHandler(mockMessage, context);

    const auditResult = context.dataAccess.Audit._mockRecord.getAuditResult();
    expect(auditResult.status).to.equal('success');
    expect(auditResult.statusHistory).to.be.an('array');
    const lastEntry = auditResult.statusHistory[auditResult.statusHistory.length - 1];
    expect(lastEntry.status).to.equal('success');
    expect(lastEntry.startedAt).to.be.a('string');
    expect(lastEntry.completedAt).to.be.a('string');
    expect(lastEntry.stepDurationMs).to.be.a('number');
    expect(lastEntry.queueDurationMs).to.be.a('number');
  });

  it('should not fail if audit status save throws', async () => {
    // Make the audit save fail
    context.dataAccess.Audit.findById = sandbox.stub().callsFake(() => Promise.resolve({
      getId: () => 'test-audit-id',
      getAuditResult: sandbox.stub().returns({ status: 'processing', statusHistory: [] }),
      setAuditResult: sandbox.stub(),
      save: sandbox.stub().rejects(new Error('Save failed')),
    }));

    // Re-mock the handler to pick up the new Audit mock
    guidanceHandler = await esmock('../../../src/image-alt-text/guidance-missing-alt-text-handler.js', {
      '../../../src/image-alt-text/opportunityHandler.js': {
        addAltTextSuggestions: addAltTextSuggestionsStub,
        getProjectedMetrics: getProjectedMetricsStub,
      },
    });

    const result = await guidanceHandler(mockMessage, context);
    expect(result.status).to.equal(200);
    expect(context.log.warn).to.have.been.calledWith(
      sinon.match(/Failed to update audit status to success/),
    );
  });

  it('should not fail if audit record not found for status update', async () => {
    // Audit.findById returns null on second call (used for status update)
    context.dataAccess.Audit.findById = sandbox.stub()
      .onFirstCall().resolves({ getId: () => 'test-audit-id' })
      .onSecondCall().resolves(null);

    guidanceHandler = await esmock('../../../src/image-alt-text/guidance-missing-alt-text-handler.js', {
      '../../../src/image-alt-text/opportunityHandler.js': {
        addAltTextSuggestions: addAltTextSuggestionsStub,
        getProjectedMetrics: getProjectedMetricsStub,
      },
    });

    const result = await guidanceHandler(mockMessage, context);
    expect(result.status).to.equal(200);
  });

  it('should set guidance_failed status when opportunity fetch fails', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.rejects(new Error('DB Error'));

    await expect(guidanceHandler(mockMessage, context))
      .to.be.rejectedWith('[alt-text]: Failed to fetch opportunities');

    const auditResult = context.dataAccess.Audit._mockRecord.getAuditResult();
    expect(auditResult.status).to.equal('guidance_failed');
    const lastEntry = auditResult.statusHistory[auditResult.statusHistory.length - 1];
    expect(lastEntry.status).to.equal('guidance_failed');
    expect(lastEntry.startedAt).to.be.a('string');
    expect(lastEntry.completedAt).to.be.a('string');
    expect(lastEntry.stepDurationMs).to.be.a('number');
    expect(lastEntry.queueDurationMs).to.be.a('number');
    expect(lastEntry.error).to.include('Failed to fetch opportunities');
    expect(context.dataAccess.Audit._mockRecord.getIsError()).to.be.true;
  });

  it('should set guidance_failed status when no opportunity found', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);

    await expect(guidanceHandler(mockMessage, context))
      .to.be.rejectedWith('[alt-text]: No existing opportunity found');

    const auditResult = context.dataAccess.Audit._mockRecord.getAuditResult();
    expect(auditResult.status).to.equal('guidance_failed');
    const lastEntry = auditResult.statusHistory[auditResult.statusHistory.length - 1];
    expect(lastEntry.status).to.equal('guidance_failed');
    expect(lastEntry.startedAt).to.be.a('string');
    expect(lastEntry.completedAt).to.be.a('string');
    expect(lastEntry.stepDurationMs).to.be.a('number');
    expect(lastEntry.queueDurationMs).to.be.a('number');
    expect(lastEntry.error).to.include('No existing opportunity found');
    expect(context.dataAccess.Audit._mockRecord.getIsError()).to.be.true;
  });

  it('should not fail when audit status save throws during guidance_failed (opportunity fetch)', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.rejects(new Error('DB Error'));
    // Make audit save fail
    context.dataAccess.Audit._mockRecord.save = sandbox.stub().rejects(new Error('Save failed'));

    await expect(guidanceHandler(mockMessage, context))
      .to.be.rejectedWith('[alt-text]: Failed to fetch opportunities');

    expect(context.log.warn).to.have.been.calledWith(
      sinon.match(/Failed to save error status: Save failed/),
    );
  });

  it('should not fail when audit status save throws during guidance_failed (no opportunity)', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    // Make audit save fail
    context.dataAccess.Audit._mockRecord.save = sandbox.stub().rejects(new Error('Save failed'));

    await expect(guidanceHandler(mockMessage, context))
      .to.be.rejectedWith('[alt-text]: No existing opportunity found');

    expect(context.log.warn).to.have.been.calledWith(
      sinon.match(/Failed to save error status: Save failed/),
    );
  });

  it('should not delete manually edited suggestions even when in pageUrlSet', async () => {
    // Set up existing suggestions - one manually edited, one not
    const existingSuggestions = [
      {
        getData: () => ({
          recommendations: [{
            id: 'manually-edited-suggestion',
            pageUrl: 'https://example.com/page1', // In pageUrlSet
            imageUrl: 'https://example.com/image1.jpg',
            isManuallyEdited: true, // Should NOT be deleted
          }],
        }),
        getStatus: () => 'NEW',
      },
      {
        getData: () => ({
          recommendations: [{
            id: 'regular-suggestion',
            pageUrl: 'https://example.com/page1', // In pageUrlSet
            imageUrl: 'https://example.com/image2.jpg',
            isManuallyEdited: false,
          }],
        }),
        getStatus: () => 'NEW',
      },
    ];

    mockOpportunity.getSuggestions.returns(existingSuggestions);

    const result = await guidanceHandler(mockMessage, context);

    expect(result.status).to.equal(200);
    // Only the non-manually-edited suggestion should be marked as OUTDATED
    expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.have.been.calledWith(
      [existingSuggestions[1]],
      'OUTDATED',
    );
  });
});
