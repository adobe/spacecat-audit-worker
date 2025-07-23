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
  let checkGoogleConnectionStub;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    mockOpportunity = {
      getId: () => 'opportunity-id',
      setAuditId: sandbox.stub(),
      setData: sandbox.stub(),
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
      },
      dataAccess: {
        Opportunity: {
          allBySiteIdAndStatus: sandbox.stub().resolves([mockOpportunity]),
          create: sandbox.stub().resolves(mockOpportunity),
        },
        Site: {
          findById: sandbox.stub().resolves(mockSite),
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
          },
        ],
      },
    };

    // Create stubs for the imported functions
    addAltTextSuggestionsStub = sandbox.stub().resolves();
    getProjectedMetricsStub = sandbox.stub().resolves({
      projectedTrafficLost: 100,
      projectedTrafficValue: 100,
    });
    checkGoogleConnectionStub = sandbox.stub().resolves(true);

    // Mock the guidance handler with all dependencies
    guidanceHandler = await esmock('../../../src/image-alt-text/guidance-missing-alt-text-handler.js', {
      '../../../src/image-alt-text/opportunityHandler.js': {
        addAltTextSuggestions: addAltTextSuggestionsStub,
        getProjectedMetrics: getProjectedMetricsStub,
      },
      '../../../src/common/opportunity-utils.js': {
        checkGoogleConnection: checkGoogleConnectionStub,
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
    expect(context.log.info).to.have.been.called;
  });

  it('should handle case when opportunity does not exist', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);

    const result = await guidanceHandler(mockMessage, context);

    expect(result.status).to.equal(200);
    expect(context.dataAccess.Opportunity.create).to.have.been.called;
    expect(context.log.debug).to.have.been.calledWith('[alt-text]: Opportunity created');
  });

  it('should handle empty suggestions', async () => {
    mockMessage.data.suggestions = [];

    const result = await guidanceHandler(mockMessage, context);

    expect(result.status).to.equal(200);
    expect(context.log.info).to.have.been.calledWith(
      '[alt-text]: Successfully processed Mystique guidance for siteId: test-site-id',
    );
  });

  it('should handle invalid message format', async () => {
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
  });

  it('should handle errors when fetching opportunities fails', async () => {
    const error = new Error('Fetch failed');
    context.dataAccess.Opportunity.allBySiteIdAndStatus.rejects(error);

    await expect(guidanceHandler(mockMessage, context))
      .to.be.rejectedWith('[alt-text]: Failed to fetch opportunities for siteId test-site-id: Fetch failed');

    expect(context.log.error).to.have.been.calledWith(
      '[alt-text]: Fetching opportunities for siteId test-site-id failed with error: Fetch failed',
    );
  });

  it('should handle errors when creating opportunity fails', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    const error = new Error('Create failed');
    context.dataAccess.Opportunity.create.rejects(error);

    await expect(guidanceHandler(mockMessage, context))
      .to.be.rejectedWith('[alt-text]: Failed to create alt-text opportunity for siteId test-site-id: Create failed');

    expect(context.log.error).to.have.been.calledWith(
      sinon.match(/Creating alt-text opportunity for siteId test-site-id failed with error: Create failed/),
    );
  });

  it('should handle errors when updating existing opportunity fails', async () => {
    const error = new Error('Save failed');
    mockOpportunity.save.rejects(error);

    await expect(guidanceHandler(mockMessage, context))
      .to.be.rejectedWith('[alt-text]: Failed to create alt-text opportunity for siteId test-site-id: Save failed');

    expect(context.log.error).to.have.been.calledWith(
      '[alt-text]: Creating alt-text opportunity for siteId test-site-id failed with error: Save failed',
      error,
    );
  });

  it('should filter out GSC data source when Google is not connected', async () => {
    checkGoogleConnectionStub.resolves(false);

    const result = await guidanceHandler(mockMessage, context);

    expect(result.status).to.equal(200);
    expect(mockOpportunity.setData).to.have.been.called;

    // Verify that GSC was filtered out from data sources
    const setDataCall = mockOpportunity.setData.firstCall.args[0];
    expect(setDataCall.dataSources).to.not.include('GSC');
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
          },
          {
            pageUrl: 'https://example.com/page2',
            imageId: 'image2.jpg',
            altText: 'Another alt text',
            imageUrl: 'https://example.com/image2.jpg',
            isAppropriate: true,
            isDecorative: false,
            language: 'en',
          },
        ],
      },
    };

    await guidanceHandler(messageWithDecorative, context);

    expect(mockOpportunity.setData).to.have.been.called;
    const setDataCall = mockOpportunity.setData.firstCall.args[0];
    expect(setDataCall.decorativeImagesCount).to.equal(1);
  });
});
