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
import esmock from 'esmock';

describe('clearAltTextSuggestions', () => {
  let logStub;
  let clearAltTextSuggestions;

  beforeEach(async () => {
    sinon.restore();

    logStub = {
      info: sinon.stub(),
      debug: sinon.stub(),
      error: sinon.stub(),
    };
    const module = await import('../../../src/image-alt-text/opportunityHandler.js');
    clearAltTextSuggestions = module.clearAltTextSuggestions;
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should clear existing suggestions except ignored ones', async () => {
    const mockSuggestions = [
      {
        getStatus: () => 'NEW',
        getData: () => ({ recommendations: [{ id: 'suggestion-1' }] }),
        remove: sinon.stub().resolves(),
      },
      {
        getStatus: () => 'SKIPPED',
        getData: () => ({ recommendations: [{ id: 'suggestion-2' }] }),
        remove: sinon.stub().resolves(),
      },
      {
        getStatus: () => 'NEW',
        getData: () => ({ recommendations: [{ id: 'suggestion-3' }] }),
        remove: sinon.stub().resolves(),
      },
    ];

    const mockOpportunity = {
      getSuggestions: sinon.stub().resolves(mockSuggestions),
    };

    await clearAltTextSuggestions({ opportunity: mockOpportunity, log: logStub });

    // Should remove non-ignored suggestions (suggestion-1 and suggestion-3)
    expect(mockSuggestions[0].remove).to.have.been.called;
    expect(mockSuggestions[1].remove).to.not.have.been.called; // SKIPPED should not be removed
    expect(mockSuggestions[2].remove).to.have.been.called;

    expect(logStub.info).to.have.been.calledWith(
      '[alt-text]: Cleared 2 existing suggestions (preserved 1 ignored suggestions)',
    );
  });

  it('should handle case when no opportunity is provided', async () => {
    await clearAltTextSuggestions({ opportunity: null, log: logStub });

    expect(logStub.debug).to.have.been.calledWith(
      '[alt-text]: No opportunity found, skipping suggestion cleanup',
    );
  });

  it('should handle case when no existing suggestions are found', async () => {
    const mockOpportunity = {
      getSuggestions: sinon.stub().resolves([]),
    };

    await clearAltTextSuggestions({ opportunity: mockOpportunity, log: logStub });

    expect(logStub.debug).to.have.been.calledWith(
      '[alt-text]: No existing suggestions to clear',
    );
  });

  it('should handle case when all suggestions are ignored', async () => {
    const mockSuggestions = [
      {
        getStatus: () => 'SKIPPED',
        getData: () => ({ recommendations: [{ id: 'suggestion-1' }] }),
        remove: sinon.stub().resolves(),
      },
      {
        getStatus: () => 'SKIPPED',
        getData: () => ({ recommendations: [{ id: 'suggestion-2' }] }),
        remove: sinon.stub().resolves(),
      },
    ];

    const mockOpportunity = {
      getSuggestions: sinon.stub().resolves(mockSuggestions),
    };

    await clearAltTextSuggestions({ opportunity: mockOpportunity, log: logStub });

    expect(mockSuggestions[0].remove).to.not.have.been.called;
    expect(mockSuggestions[1].remove).to.not.have.been.called;

    expect(logStub.debug).to.have.been.calledWith(
      '[alt-text]: No suggestions to clear (all 2 suggestions are ignored)',
    );
  });
});

describe('addAltTextSuggestions', () => {
  let logStub;
  let addAltTextSuggestions;

  beforeEach(async () => {
    sinon.restore();

    logStub = {
      info: sinon.stub(),
      debug: sinon.stub(),
      error: sinon.stub(),
    };

    const module = await import('../../../src/image-alt-text/opportunityHandler.js');
    addAltTextSuggestions = module.addAltTextSuggestions;
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should add new suggestions successfully', async () => {
    const mockOpportunity = {
      getSiteId: () => 'site-id',
      addSuggestions: sinon.stub().resolves({
        errorItems: [],
        createdItems: [1, 2],
      }),
    };

    const newSuggestionDTOs = [
      {
        opportunityId: 'opportunity-id',
        type: 'CONTENT_UPDATE',
        data: { recommendations: [{ id: 'suggestion-1' }] },
        rank: 1,
      },
      {
        opportunityId: 'opportunity-id',
        type: 'CONTENT_UPDATE',
        data: { recommendations: [{ id: 'suggestion-2' }] },
        rank: 1,
      },
    ];

    await addAltTextSuggestions({
      opportunity: mockOpportunity,
      newSuggestionDTOs,
      log: logStub,
    });

    expect(mockOpportunity.addSuggestions).to.have.been.calledWith(newSuggestionDTOs);
    expect(logStub.info).to.have.been.calledWith(
      '[alt-text]: Added 2 new suggestions',
    );
  });

  it('should handle case when no suggestions are provided', async () => {
    const mockOpportunity = {
      addSuggestions: sinon.stub(),
    };

    await addAltTextSuggestions({
      opportunity: mockOpportunity,
      newSuggestionDTOs: [],
      log: logStub,
    });

    expect(mockOpportunity.addSuggestions).to.not.have.been.called;
    expect(logStub.debug).to.have.been.calledWith(
      '[alt-text]: No new suggestions to add',
    );
  });

  it('should handle case when newSuggestionDTOs is null/undefined', async () => {
    const mockOpportunity = {
      addSuggestions: sinon.stub(),
    };

    await addAltTextSuggestions({
      opportunity: mockOpportunity,
      newSuggestionDTOs: null,
      log: logStub,
    });

    expect(mockOpportunity.addSuggestions).to.not.have.been.called;
    expect(logStub.debug).to.have.been.calledWith(
      '[alt-text]: No new suggestions to add',
    );
  });

  it('should handle errors when adding suggestions partially fails', async () => {
    const mockOpportunity = {
      getSiteId: () => 'site-id',
      addSuggestions: sinon.stub().resolves({
        errorItems: [
          {
            item: { id: 'suggestion-1' },
            error: 'Invalid suggestion data',
          },
        ],
        createdItems: [1], // At least one successful creation
      }),
    };

    const newSuggestionDTOs = [
      {
        opportunityId: 'opportunity-id',
        type: 'CONTENT_UPDATE',
        data: { recommendations: [{ id: 'suggestion-1' }] },
        rank: 1,
      },
    ];

    await addAltTextSuggestions({
      opportunity: mockOpportunity,
      newSuggestionDTOs,
      log: logStub,
    });

    expect(logStub.error).to.have.been.calledWith(
      '[alt-text]: Suggestions for siteId site-id contains 1 items with errors',
    );
    expect(logStub.error).to.have.been.calledWith(
      '[alt-text]: Item {"id":"suggestion-1"} failed with error: Invalid suggestion data',
    );
    expect(logStub.info).to.have.been.calledWith(
      '[alt-text]: Added 1 new suggestions',
    );
  });

  it('should throw error when all suggestions fail to create', async () => {
    const mockOpportunity = {
      getSiteId: () => 'site-id',
      addSuggestions: sinon.stub().resolves({
        errorItems: [
          {
            item: { id: 'suggestion-1' },
            error: 'Invalid suggestion data',
          },
        ],
        createdItems: [], // No successful creations
      }),
    };

    const newSuggestionDTOs = [
      {
        opportunityId: 'opportunity-id',
        type: 'CONTENT_UPDATE',
        data: { recommendations: [{ id: 'suggestion-1' }] },
        rank: 1,
      },
    ];

    await expect(addAltTextSuggestions({
      opportunity: mockOpportunity,
      newSuggestionDTOs,
      log: logStub,
    })).to.be.rejectedWith('[alt-text]: Failed to create suggestions for siteId site-id');

    expect(logStub.error).to.have.been.calledWith(
      '[alt-text]: Suggestions for siteId site-id contains 1 items with errors',
    );
    expect(logStub.error).to.have.been.calledWith(
      '[alt-text]: Item {"id":"suggestion-1"} failed with error: Invalid suggestion data',
    );
  });
});

describe('sendAltTextOpportunityToMystique', () => {
  let context;
  let logStub;
  let sqsStub;
  let dataAccessStub;
  let sendAltTextOpportunityToMystique;

  beforeEach(async () => {
    sinon.restore();

    logStub = {
      info: sinon.stub(),
      debug: sinon.stub(),
      error: sinon.stub(),
    };

    sqsStub = {
      sendMessage: sinon.stub().resolves(),
    };

    dataAccessStub = {
      Site: {
        findById: sinon.stub().resolves({
          getDeliveryType: () => 'aem_edge',
        }),
      },
      Opportunity: {
        allBySiteIdAndStatus: sinon.stub().resolves([{
          getType: () => 'alt-text',
          getData: () => ({ existingData: 'test' }),
          setData: sinon.stub(),
          save: sinon.stub().resolves(),
        }]),
      },
    };

    context = {
      log: logStub,
      sqs: sqsStub,
      dataAccess: dataAccessStub,
      env: {
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
      },
    };

    // Import the function
    const module = await import('../../../src/image-alt-text/opportunityHandler.js');
    sendAltTextOpportunityToMystique = module.sendAltTextOpportunityToMystique;
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should send alt-text opportunity to Mystique successfully', async () => {
    const auditUrl = 'https://example.com';
    const pageUrls = ['https://example.com/page1', 'https://example.com/page2'];
    const siteId = 'site-id';
    const auditId = 'audit-id';

    await sendAltTextOpportunityToMystique(auditUrl, pageUrls, siteId, auditId, context);

    expect(sqsStub.sendMessage).to.have.been.calledOnce;
    expect(sqsStub.sendMessage).to.have.been.calledWith(
      'test-queue',
      sinon.match({
        type: 'guidance:missing-alt-text',
        siteId: 'site-id',
        auditId: 'audit-id',
        deliveryType: 'aem_edge',
        url: 'https://example.com',
        observation: 'Missing alt text on images',
        data: {
          pageUrls: ['https://example.com/page1', 'https://example.com/page2'],
        },
      }),
    );

    expect(logStub.info).to.have.been.calledWith(
      '[alt-text]: Sending 2 URLs to Mystique in 1 batch(es)',
    );
    expect(logStub.info).to.have.been.calledWith(
      '[alt-text]: All 1 batches sent to Mystique successfully',
    );
  });

  it('should batch URLs when there are more than the batch size', async () => {
    const auditUrl = 'https://example.com';
    // Create 25 URLs to test batching (batch size is 20)
    const pageUrls = Array.from({ length: 15 }, (_, i) => `https://example.com/page${i + 1}`);
    const siteId = 'site-id';
    const auditId = 'audit-id';

    await sendAltTextOpportunityToMystique(auditUrl, pageUrls, siteId, auditId, context);

    // Should send 2 batches (10 + 5)
    expect(sqsStub.sendMessage).to.have.been.calledTwice;

    // First batch should have 10 URLs
    const firstCall = sqsStub.sendMessage.getCall(0);
    expect(firstCall.args[1].data.pageUrls).to.have.lengthOf(10);

    // Second batch should have 5 URLs
    const secondCall = sqsStub.sendMessage.getCall(1);
    expect(secondCall.args[1].data.pageUrls).to.have.lengthOf(5);

    expect(logStub.info).to.have.been.calledWith(
      '[alt-text]: Sending 15 URLs to Mystique in 2 batch(es)',
    );
    expect(logStub.info).to.have.been.calledWith(
      '[alt-text]: All 2 batches sent to Mystique successfully',
    );
  });

  it('should handle errors when sending to Mystique fails', async () => {
    const auditUrl = 'https://example.com';
    const pageUrls = ['https://example.com/page1'];
    const siteId = 'site-id';
    const auditId = 'audit-id';

    const error = new Error('SQS send failed');
    sqsStub.sendMessage.rejects(error);

    await expect(sendAltTextOpportunityToMystique(auditUrl, pageUrls, siteId, auditId, context))
      .to.be.rejectedWith('SQS send failed');

    expect(logStub.error).to.have.been.calledWith(
      '[alt-text]: Failed to send alt-text opportunity to Mystique: SQS send failed',
    );
  });

  it('should handle errors when fetching site fails', async () => {
    const auditUrl = 'https://example.com';
    const pageUrls = ['https://example.com/page1'];
    const siteId = 'site-id';
    const auditId = 'audit-id';

    const error = new Error('Site not found');
    dataAccessStub.Site.findById.rejects(error);

    await expect(sendAltTextOpportunityToMystique(auditUrl, pageUrls, siteId, auditId, context))
      .to.be.rejectedWith('Site not found');

    expect(logStub.error).to.have.been.calledWith(
      '[alt-text]: Failed to send alt-text opportunity to Mystique: Site not found',
    );
  });
});

describe('syncAltTextSuggestions', () => {
  let syncAltTextSuggestions;
  let logStub;

  beforeEach(async () => {
    sinon.restore();
    logStub = {
      info: sinon.stub(),
      debug: sinon.stub(),
      error: sinon.stub(),
    };
    const module = await import('../../../src/image-alt-text/opportunityHandler.js');
    syncAltTextSuggestions = module.syncAltTextSuggestions;
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should sync suggestions by removing non-ignored ones and adding new ones', async () => {
    const mockOpportunity = {
      getSiteId: () => 'test-site-id',
      getSuggestions: sinon.stub().resolves([
        {
          getStatus: () => 'NEW',
          getData: () => ({ recommendations: [{ id: 'suggestion-1' }] }),
          remove: sinon.stub().resolves(),
        },
        {
          getStatus: () => 'SKIPPED',
          getData: () => ({ recommendations: [{ id: 'suggestion-2' }] }),
          remove: sinon.stub().resolves(),
        },
      ]),
      addSuggestions: sinon.stub().resolves({ createdItems: [1], errorItems: [] }),
    };

    const newSuggestionDTOs = [
      {
        data: { recommendations: [{ id: 'suggestion-3' }] },
        type: 'CONTENT_UPDATE',
        rank: 1,
      },
    ];

    await syncAltTextSuggestions({ opportunity: mockOpportunity, newSuggestionDTOs, log: logStub });

    expect(mockOpportunity.getSuggestions).to.have.been.called;
    expect(mockOpportunity.addSuggestions).to.have.been.calledWith(newSuggestionDTOs);
  });

  it('should handle error items in addSuggestions result', async () => {
    const mockOpportunity = {
      getSiteId: () => 'test-site-id',
      getSuggestions: sinon.stub().resolves([]),
      addSuggestions: sinon.stub().resolves({
        createdItems: [1],
        errorItems: [{ item: { id: 'error-item' }, error: 'Test error' }],
      }),
    };

    const newSuggestionDTOs = [
      {
        data: { recommendations: [{ id: 'suggestion-1' }] },
        type: 'CONTENT_UPDATE',
        rank: 1,
      },
    ];

    await syncAltTextSuggestions({ opportunity: mockOpportunity, newSuggestionDTOs, log: logStub });

    expect(logStub.error).to.have.been.calledWith('[alt-text]: Suggestions for siteId test-site-id contains 1 items with errors');
    expect(logStub.error).to.have.been.calledWith('[alt-text]: Item {"id":"error-item"} failed with error: Test error');
  });

  it('should throw error when no suggestions are created and there are errors', async () => {
    const mockOpportunity = {
      getSiteId: () => 'test-site-id',
      getSuggestions: sinon.stub().resolves([]),
      addSuggestions: sinon.stub().resolves({
        createdItems: [],
        errorItems: [{ item: { id: 'error-item' }, error: 'Test error' }],
      }),
    };

    const newSuggestionDTOs = [
      {
        data: { recommendations: [{ id: 'suggestion-1' }] },
        type: 'CONTENT_UPDATE',
        rank: 1,
      },
    ];

    await expect(
      syncAltTextSuggestions({ opportunity: mockOpportunity, newSuggestionDTOs, log: logStub }),
    ).to.be.rejectedWith('[alt-text]: Failed to create suggestions for siteId test-site-id');
  });
});

describe('getProjectedMetrics', () => {
  let logStub;
  let mockContext;

  beforeEach(async () => {
    sinon.restore();
    logStub = {
      info: sinon.stub(),
      debug: sinon.stub(),
      error: sinon.stub(),
    };

    mockContext = {
      env: {
        RUM_ADMIN_KEY: 'test-key',
      },
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should calculate projected metrics successfully', async () => {
    const mockRUMAPIClient = {
      query: sinon.stub().resolves([
        { url: 'https://example.com/page1', earned: 1000 },
        { url: 'https://example.com/page2', earned: 500 },
      ]),
    };

    const getProjectedMetricsWithMock = await esmock('../../../src/image-alt-text/opportunityHandler.js', {
      '@adobe/spacecat-shared-rum-api-client': {
        default: {
          createFrom: () => mockRUMAPIClient,
        },
      },
      '../../../src/support/utils.js': {
        getRUMUrl: sinon.stub().resolves('example.com'),
      },
    });

    const images = [
      { pageUrl: 'https://example.com/page1', src: 'image1.jpg' },
      { pageUrl: 'https://example.com/page2', src: 'image2.jpg' },
    ];

    const result = await getProjectedMetricsWithMock.getProjectedMetrics({
      images,
      auditUrl: 'https://example.com',
      context: mockContext,
      log: logStub,
    });

    expect(result).to.have.property('projectedTrafficLost');
    expect(result).to.have.property('projectedTrafficValue');
    expect(typeof result.projectedTrafficLost).to.equal('number');
    expect(typeof result.projectedTrafficValue).to.equal('number');
  });

  it('should return zero metrics when RUM API fails', async () => {
    const getProjectedMetricsWithMock = await esmock('../../../src/image-alt-text/opportunityHandler.js', {
      '../../../src/support/utils.js': {
        getRUMUrl: sinon.stub().rejects(new Error('RUM API Error')),
      },
    });

    const images = [
      { pageUrl: 'https://example.com/page1', src: 'image1.jpg' },
    ];

    const result = await getProjectedMetricsWithMock.getProjectedMetrics({
      images,
      auditUrl: 'https://example.com',
      context: mockContext,
      log: logStub,
    });

    expect(result).to.deep.equal({
      projectedTrafficLost: 0,
      projectedTrafficValue: 0,
    });
    expect(logStub.error).to.have.been.calledWith(
      sinon.match(/Failed to get RUM results for https:\/\/example\.com with error: RUM API Error/),
    );
  });

  it('should handle URLs with www toggle correctly', async () => {
    const mockRUMAPIClient = {
      query: sinon.stub().resolves([
        { url: 'https://www.example.com/page1', earned: 1000 },
      ]),
    };

    const getProjectedMetricsWithMock = await esmock('../../../src/image-alt-text/opportunityHandler.js', {
      '@adobe/spacecat-shared-rum-api-client': {
        default: {
          createFrom: () => mockRUMAPIClient,
        },
      },
      '../../../src/support/utils.js': {
        getRUMUrl: sinon.stub().resolves('example.com'),
        toggleWWW: sinon.stub().callsFake((url) => {
          if (url.includes('www.')) {
            return url.replace('www.', '');
          }
          return url.replace('://', '://www.');
        }),
      },
    });

    const images = [
      { pageUrl: 'https://example.com/page1', src: 'image1.jpg' }, // Non-www version
    ];

    const result = await getProjectedMetricsWithMock.getProjectedMetrics({
      images,
      auditUrl: 'https://example.com',
      context: mockContext,
      log: logStub,
    });

    expect(result).to.have.property('projectedTrafficLost');
    expect(result).to.have.property('projectedTrafficValue');
  });

  it('should log debug message when page URL not found in RUM results', async () => {
    const mockRUMAPIClient = {
      query: sinon.stub().resolves([
        { url: 'https://example.com/different-page', earned: 1000 },
      ]),
    };

    const getProjectedMetricsWithMock = await esmock('../../../src/image-alt-text/opportunityHandler.js', {
      '@adobe/spacecat-shared-rum-api-client': {
        default: {
          createFrom: () => mockRUMAPIClient,
        },
      },
      '../../../src/support/utils.js': {
        getRUMUrl: sinon.stub().resolves('example.com'),
        toggleWWW: sinon.stub().callsFake((url) => {
          if (url.includes('www.')) {
            return url.replace('www.', '');
          }
          return url.replace('://', '://www.');
        }),
      },
    });

    const images = [
      { pageUrl: 'https://example.com/page1', src: 'image1.jpg' },
    ];

    await getProjectedMetricsWithMock.getProjectedMetrics({
      images,
      auditUrl: 'https://example.com',
      context: mockContext,
      log: logStub,
    });

    expect(logStub.debug).to.have.been.calledWith(
      sinon.match(/Page URL .* not found in RUM API results/),
    );
  });
});
