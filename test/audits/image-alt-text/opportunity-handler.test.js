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
import { Audit, Suggestion as SuggestionModel } from '@adobe/spacecat-shared-data-access';
import GoogleClient from '@adobe/spacecat-shared-google-client';
import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import suggestionsEngine from '../../../src/image-alt-text/suggestionsEngine.js';
import { DATA_SOURCES } from '../../../src/common/constants.js';

// Shared mock class factory to avoid max-classes-per-file ESLint error
const createMockRUMAPIClient = (stub) => class MockRUMAPIClient {
  static createFrom() {
    return stub;
  }
};

describe('Image Alt Text Opportunity Handler', () => {
  let logStub;
  let dataAccessStub;
  let auditData;
  let auditUrl;
  let altTextOppty;
  let context;
  let rumClientStub;

  beforeEach(() => {
    sinon.restore();
    auditUrl = 'https://example.com';
    altTextOppty = {
      getId: () => 'opportunity-id',
      setAuditId: sinon.stub(),
      setData: sinon.stub(),
      save: sinon.stub(),
      getSuggestions: sinon.stub().returns([{
        id: 'suggestion-1',
        getStatus: () => 'NEW',
        status: 'NEW',
        getData: () => ({ recommendations: [{ id: 'suggestion-1' }] }),
        remove: sinon.stub().resolves(),
      }]),
      addSuggestions: sinon
        .stub()
        .returns({ errorItems: [], createdItems: [1] }),
      getType: () => Audit.AUDIT_TYPES.ALT_TEXT,
      getSiteId: () => 'site-id',
      setUpdatedBy: sinon.stub(),
    };

    logStub = {
      info: sinon.stub(),
      debug: sinon.stub(),
      error: sinon.stub(),
      warn: sinon.stub(),
    };

    dataAccessStub = {
      Opportunity: {
        allBySiteIdAndStatus: sinon.stub().resolves([]),
        create: sinon.stub(),
      },
    };

    rumClientStub = {
      query: sinon.stub().resolves([
        { url: 'https://example.com/page1', earned: 100000 },
        { url: 'https://example.com/page2', earned: 287100 },
      ]),
    };

    sinon.stub(RUMAPIClient, 'createFrom').returns(rumClientStub);

    context = {
      log: logStub,
      dataAccess: dataAccessStub,
      env: {
        RUM_ADMIN_KEY: 'test-key',
      },
    };

    auditData = {
      siteId: 'site-id',
      auditId: 'audit-id',
      detectedImages: {
        imagesWithoutAltText: [
          { pageUrl: '/page1', src: 'image1.jpg' },
          { pageUrl: '/page2', src: 'image2.jpg' },
          { pageUrl: '/page3', src: 'image1.svg', blob: 'blob' },
        ],
        decorativeImagesCount: 0,
        unreachableImages: [],
      },
    };

    sinon.stub(suggestionsEngine, 'getImageSuggestions').resolves({
      'https://example.com/image1.jpg': { image_url: '/page1', suggestion: 'Image 1 description' },
      'https://example.com/image2.jpg': { image_url: '/page2', suggestion: 'Image 2 description' },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should create new opportunity when none exists', async function createNewOpportunity() {
    this.timeout(5000);

    // Mock utility functions to ensure predictable behavior
    const convertToOpportunityWithMocks = await esmock('../../../src/image-alt-text/opportunityHandler.js', {
      '../../../src/support/utils.js': {
        getRUMUrl: sinon.stub().resolves('example.com'),
        toggleWWW: sinon.stub().callsFake((url) => {
          if (url.includes('www.')) {
            return url.replace('www.', '');
          }
          return url.replace('://', '://www.');
        }),
      },
      '@adobe/spacecat-shared-rum-api-client': {
        default: createMockRUMAPIClient(rumClientStub),
      },
      '../../../src/image-alt-text/constants.js': {
        CPC: 1,
        PENALTY_PER_IMAGE: 0.01,
        RUM_INTERVAL: 30,
      },
      '../../../src/common/opportunity-utils.js': {
        checkGoogleConnection: sinon.stub().resolves(true),
      },
    });

    dataAccessStub.Opportunity.create.resolves(altTextOppty);

    await convertToOpportunityWithMocks.default(auditUrl, auditData, context);

    expect(dataAccessStub.Opportunity.create).to.have.been.calledWith(sinon.match({
      siteId: 'site-id',
      auditId: 'audit-id',
      runbook:
        'https://adobe.sharepoint.com/:w:/s/aemsites-engineering/EeEUbjd8QcFOqCiwY0w9JL8BLMnpWypZ2iIYLd0lDGtMUw?e=XSmEjh',
      type: Audit.AUDIT_TYPES.ALT_TEXT,
      origin: 'AUTOMATION',
      title:
        'Missing alt text for images decreases accessibility and discoverability of content',
      description:
        'Missing alt text on images leads to poor seo scores, low accessibility scores and search engine failing to surface such images with keyword search',
      guidance: {
        recommendations: [
          {
            insight: 'Alt text for images decreases accessibility and limits discoverability',
            recommendation: 'Add meaningful alt text on images that clearly articulate the subject matter of the image',
            type: null,
            rationale: 'Alt text for images is vital to ensure your content is discoverable and usable for many people as possible',
          },
        ],
      },
      tags: ['seo', 'accessibility'],
      data: sinon.match({
        projectedTrafficLost: sinon.match.number,
        projectedTrafficValue: sinon.match.number,
        decorativeImagesCount: 0,
        dataSources: [DATA_SOURCES.RUM, DATA_SOURCES.SITE, DATA_SOURCES.AHREFS, DATA_SOURCES.GSC],
      }),
    }));
    expect(logStub.debug).to.have.been.calledWith(
      '[alt-text]: Opportunity created',
    );
  });

  it('should update existing opportunity when one exists', async () => {
    // Mock utility functions to ensure predictable behavior
    const convertToOpportunityWithMocks = await esmock('../../../src/image-alt-text/opportunityHandler.js', {
      '../../../src/support/utils.js': {
        getRUMUrl: sinon.stub().resolves('example.com'),
        toggleWWW: sinon.stub().callsFake((url) => {
          if (url.includes('www.')) {
            return url.replace('www.', '');
          }
          return url.replace('://', '://www.');
        }),
      },
      '@adobe/spacecat-shared-rum-api-client': {
        default: createMockRUMAPIClient(rumClientStub),
      },
      '../../../src/image-alt-text/constants.js': {
        CPC: 1,
        PENALTY_PER_IMAGE: 0.01,
        RUM_INTERVAL: 30,
      },
      '../../../src/common/opportunity-utils.js': {
        checkGoogleConnection: sinon.stub().resolves(true),
      },
    });

    dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([altTextOppty]);

    await convertToOpportunityWithMocks.default(auditUrl, auditData, context);

    expect(altTextOppty.setAuditId).to.have.been.calledWith('audit-id');
    expect(altTextOppty.setUpdatedBy).to.have.been.calledWith('system');
    expect(altTextOppty.save).to.have.been.called;
    expect(dataAccessStub.Opportunity.create).to.not.have.been.called;
  });

  it('should update existing opportunity with empty suggestion if none are found', async () => {
    // Mock utility functions to ensure predictable behavior
    const convertToOpportunityWithMocks = await esmock('../../../src/image-alt-text/opportunityHandler.js', {
      '../../../src/support/utils.js': {
        getRUMUrl: sinon.stub().resolves('example.com'),
        toggleWWW: sinon.stub().callsFake((url) => {
          if (url.includes('www.')) {
            return url.replace('www.', '');
          }
          return url.replace('://', '://www.');
        }),
      },
      '@adobe/spacecat-shared-rum-api-client': {
        default: createMockRUMAPIClient(rumClientStub),
      },
      '../../../src/image-alt-text/constants.js': {
        CPC: 1,
        PENALTY_PER_IMAGE: 0.01,
        RUM_INTERVAL: 30,
      },
      '../../../src/common/opportunity-utils.js': {
        checkGoogleConnection: sinon.stub().resolves(true),
      },
    });

    dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([altTextOppty]);
    suggestionsEngine.getImageSuggestions.resolves({});

    await convertToOpportunityWithMocks.default(auditUrl, auditData, context);

    expect(altTextOppty.setAuditId).to.have.been.calledWith('audit-id');
    expect(altTextOppty.setUpdatedBy).to.have.been.calledWith('system');
    expect(altTextOppty.save).to.have.been.called;

    expect(dataAccessStub.Opportunity.create).to.not.have.been.called;
  });

  it('should handle error when fetching opportunities fails', async () => {
    // Mock utility functions to ensure predictable behavior
    const convertToOpportunityWithMocks = await esmock('../../../src/image-alt-text/opportunityHandler.js', {
      '../../../src/support/utils.js': {
        getRUMUrl: sinon.stub().resolves('example.com'),
        toggleWWW: sinon.stub().callsFake((url) => {
          if (url.includes('www.')) {
            return url.replace('www.', '');
          }
          return url.replace('://', '://www.');
        }),
      },
      '@adobe/spacecat-shared-rum-api-client': {
        default: createMockRUMAPIClient(rumClientStub),
      },
      '../../../src/image-alt-text/constants.js': {
        CPC: 1,
        PENALTY_PER_IMAGE: 0.01,
        RUM_INTERVAL: 30,
      },
      '../../../src/common/opportunity-utils.js': {
        checkGoogleConnection: sinon.stub().resolves(true),
      },
    });

    const error = new Error('Fetch failed');
    dataAccessStub.Opportunity.allBySiteIdAndStatus.rejects(error);

    try {
      await convertToOpportunityWithMocks.default(auditUrl, auditData, context);
      expect.fail('Should have thrown an error');
    } catch (e) {
      expect(e.message).to.equal(
        '[alt-text]: Failed to fetch opportunities for siteId site-id: Fetch failed',
      );
      expect(logStub.error).to.have.been.calledWith(
        '[alt-text]: Fetching opportunities for siteId site-id failed with error: Fetch failed',
      );
    }
  });

  it('should handle error when creating opportunity fails', async () => {
    // Mock utility functions to ensure predictable behavior
    const convertToOpportunityWithMocks = await esmock('../../../src/image-alt-text/opportunityHandler.js', {
      '../../../src/support/utils.js': {
        getRUMUrl: sinon.stub().resolves('example.com'),
        toggleWWW: sinon.stub().callsFake((url) => {
          if (url.includes('www.')) {
            return url.replace('www.', '');
          }
          return url.replace('://', '://www.');
        }),
      },
      '@adobe/spacecat-shared-rum-api-client': {
        default: createMockRUMAPIClient(rumClientStub),
      },
      '../../../src/image-alt-text/constants.js': {
        CPC: 1,
        PENALTY_PER_IMAGE: 0.01,
        RUM_INTERVAL: 30,
      },
      '../../../src/common/opportunity-utils.js': {
        checkGoogleConnection: sinon.stub().resolves(true),
      },
    });

    const error = new Error('Creation failed');
    dataAccessStub.Opportunity.create.rejects(error);

    try {
      await convertToOpportunityWithMocks.default(auditUrl, auditData, context);
      expect.fail('Should have thrown an error');
    } catch (e) {
      expect(e.message).to.equal(
        '[alt-text]: Failed to create alt-text opportunity for siteId site-id: Creation failed',
      );
      expect(logStub.error).to.have.been.calledWith(
        '[alt-text]: Creating alt-text opportunity for siteId site-id failed with error: Creation failed',
        error,
      );
    }
  });

  it('should handle errors when adding suggestions', async () => {
    // Mock utility functions to ensure predictable behavior
    const convertToOpportunityWithMocks = await esmock('../../../src/image-alt-text/opportunityHandler.js', {
      '../../../src/support/utils.js': {
        getRUMUrl: sinon.stub().resolves('example.com'),
        toggleWWW: sinon.stub().callsFake((url) => {
          if (url.includes('www.')) {
            return url.replace('www.', '');
          }
          return url.replace('://', '://www.');
        }),
      },
      '@adobe/spacecat-shared-rum-api-client': {
        default: createMockRUMAPIClient(rumClientStub),
      },
      '../../../src/image-alt-text/constants.js': {
        CPC: 1,
        PENALTY_PER_IMAGE: 0.01,
        RUM_INTERVAL: 30,
      },
      '../../../src/common/opportunity-utils.js': {
        checkGoogleConnection: sinon.stub().resolves(true),
      },
    });

    dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([altTextOppty]);

    altTextOppty.getSuggestions.returns([{
      id: 'suggestion-1',
      getStatus: () => 'NEW',
      status: 'NEW',
      getData: () => ({ recommendations: [{ id: 'suggestion-1' }] }),
      remove: sinon.stub().resolves(),
    }]);

    altTextOppty.addSuggestions.returns({
      errorItems: [
        {
          item: { url: '/page1', src: 'image1.jpg' },
          error: 'Invalid suggestion data',
        },
      ],
      createdItems: [1], // At least one successful creation to avoid throwing
    });

    await convertToOpportunityWithMocks.default(auditUrl, auditData, context);

    expect(logStub.error).to.have.been.calledWith(
      '[alt-text]: Suggestions for siteId site-id contains 1 items with errors',
    );
    expect(logStub.error).to.have.been.calledWith(
      '[alt-text]: Item {"url":"/page1","src":"image1.jpg"} failed with error: Invalid suggestion data',
    );
  });

  it('should throw error when all suggestions fail to create', async () => {
    // Mock utility functions to ensure predictable behavior
    const convertToOpportunityWithMocks = await esmock('../../../src/image-alt-text/opportunityHandler.js', {
      '../../../src/support/utils.js': {
        getRUMUrl: sinon.stub().resolves('example.com'),
        toggleWWW: sinon.stub().callsFake((url) => {
          if (url.includes('www.')) {
            return url.replace('www.', '');
          }
          return url.replace('://', '://www.');
        }),
      },
      '@adobe/spacecat-shared-rum-api-client': {
        default: createMockRUMAPIClient(rumClientStub),
      },
      '../../../src/image-alt-text/constants.js': {
        CPC: 1,
        PENALTY_PER_IMAGE: 0.01,
        RUM_INTERVAL: 30,
      },
      '../../../src/common/opportunity-utils.js': {
        checkGoogleConnection: sinon.stub().resolves(true),
      },
    });

    dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([altTextOppty]);

    altTextOppty.getSuggestions.returns([{
      id: 'suggestion-1',
      getStatus: () => 'NEW',
      status: 'NEW',
      getData: () => ({ recommendations: [{ id: 'suggestion-1' }] }),
      remove: sinon.stub().resolves(),
    }]);

    altTextOppty.addSuggestions.returns({
      errorItems: [
        {
          item: { url: '/page1', src: 'image1.jpg' },
          error: 'Invalid suggestion data',
        },
      ],
      createdItems: [], // No successful creations
    });

    try {
      await convertToOpportunityWithMocks.default(auditUrl, auditData, context);
      expect.fail('Should have thrown an error');
    } catch (e) {
      expect(e.message).to.equal('[alt-text]: Failed to create suggestions for siteId site-id');
      expect(logStub.error).to.have.been.calledWith(
        '[alt-text]: Suggestions for siteId site-id contains 1 items with errors',
      );
      expect(logStub.error).to.have.been.calledWith(
        '[alt-text]: Item {"url":"/page1","src":"image1.jpg"} failed with error: Invalid suggestion data',
      );
    }
  });

  it('should preserve ignored suggestions when syncing', async () => {
    // Mock utility functions to ensure predictable behavior
    const convertToOpportunityWithMocks = await esmock('../../../src/image-alt-text/opportunityHandler.js', {
      '../../../src/support/utils.js': {
        getRUMUrl: sinon.stub().resolves('example.com'),
        toggleWWW: sinon.stub().callsFake((url) => {
          if (url.includes('www.')) {
            return url.replace('www.', '');
          }
          return url.replace('://', '://www.');
        }),
      },
      '@adobe/spacecat-shared-rum-api-client': {
        default: createMockRUMAPIClient(rumClientStub),
      },
      '../../../src/image-alt-text/constants.js': {
        CPC: 1,
        PENALTY_PER_IMAGE: 0.01,
        RUM_INTERVAL: 30,
      },
      '../../../src/common/opportunity-utils.js': {
        checkGoogleConnection: sinon.stub().resolves(true),
      },
    });

    dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([altTextOppty]);

    // Mock existing suggestions with one ignored
    const mockSuggestions = [
      {
        id: 'suggestion-1',
        getStatus: () => SuggestionModel.STATUSES.SKIPPED,
        status: SuggestionModel.STATUSES.SKIPPED,
        getData: () => ({ recommendations: [{ id: 'suggestion-1' }] }),
        remove: sinon.stub().resolves(),
      },
      {
        id: 'suggestion-2',
        getStatus: () => 'NEW',
        status: 'NEW',
        getData: () => ({ recommendations: [{ id: 'suggestion-2' }] }),
        remove: sinon.stub().resolves(),
      },
    ];

    altTextOppty.getSuggestions.returns(mockSuggestions);

    await convertToOpportunityWithMocks.default(auditUrl, auditData, context);

    // Verify that only non-ignored suggestion was removed
    expect(mockSuggestions[0].remove).to.not.have.been.called;
    expect(mockSuggestions[1].remove).to.have.been.called;
  });

  it('should log error when page URL is not found in RUM API results', async () => {
    dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([altTextOppty]);

    // Mock utility functions to ensure predictable URL handling
    const convertToOpportunityWithMocks = await esmock('../../../src/image-alt-text/opportunityHandler.js', {
      '../../../src/support/utils.js': {
        getRUMUrl: sinon.stub().resolves('example.com'),
        toggleWWW: sinon.stub().callsFake((url) => {
          if (url.includes('www.')) {
            return url.replace('www.', '');
          }
          return url.replace('://', '://www.');
        }),
      },
      '@adobe/spacecat-shared-rum-api-client': {
        default: createMockRUMAPIClient(rumClientStub),
      },
    });

    // Set up RUM API to return results that don't match our image URLs
    rumClientStub.query.resolves([
      { url: 'https://example.com/different-page', earned: 100000 },
      { url: 'https://example.com/another-page', earned: 287100 },
    ]);

    // Our test data has images on /page1 and /page2, which won't be found in the RUM results
    await convertToOpportunityWithMocks.default(auditUrl, auditData, context);

    // Verify the error was logged for missing pages with correct www/non-www format
    const debugCalls = logStub.debug.getCalls().map((call) => call.args[0]);

    expect(debugCalls).to.include(
      '[alt-text]: Page URL https://example.com/page1 or https://www.example.com/page1 not found in RUM API results',
    );
    expect(debugCalls).to.include(
      '[alt-text]: Page URL https://example.com/page2 or https://www.example.com/page2 not found in RUM API results',
    );
    expect(debugCalls).to.include(
      '[alt-text]: Page URL https://example.com/page3 or https://www.example.com/page3 not found in RUM API results',
    );

    // The opportunity should still be created/updated despite the missing pages
    expect(altTextOppty.setData).to.have.been.called;
    expect(altTextOppty.save).to.have.been.called;
  });

  it('should calculate projected metrics correctly', async () => {
    // Mock utility functions to ensure predictable URL handling
    const convertToOpportunityWithMocks = await esmock('../../../src/image-alt-text/opportunityHandler.js', {
      '../../../src/support/utils.js': {
        getRUMUrl: sinon.stub().resolves('example.com'),
        toggleWWW: sinon.stub().callsFake((url) => {
          if (url.includes('www.')) {
            return url.replace('www.', '');
          }
          return url.replace('://', '://www.');
        }),
      },
      '@adobe/spacecat-shared-rum-api-client': {
        default: createMockRUMAPIClient(rumClientStub),
      },
      '../../../src/image-alt-text/constants.js': {
        CPC: 1,
        PENALTY_PER_IMAGE: 0.01,
        RUM_INTERVAL: 30,
      },
      '../../../src/common/opportunity-utils.js': {
        checkGoogleConnection: sinon.stub().resolves(true),
      },
    });

    dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([altTextOppty]);

    // Set up RUM API to return results in the correct format
    rumClientStub.query.resolves([
      { url: 'https://example.com/page1', earned: 100000 },
      { url: 'https://example.com/page2', earned: 200000 },
    ]);

    // Make sure our test data has the correct format for pageUrl
    auditData.detectedImages.imagesWithoutAltText = [
      { pageUrl: '/page1', src: 'image1.jpg' },
      { pageUrl: '/page2', src: 'image2.jpg' },
    ];

    await convertToOpportunityWithMocks.default(auditUrl, auditData, context);

    // Check that the metrics were calculated and passed to setData
    const setDataCall = altTextOppty.setData.getCall(0);
    expect(setDataCall).to.exist;

    // Calculate expected values based on the formula in the handler:
    // PENALTY_PER_IMAGE = 0.01 (1%)
    // CPC = 1 ($1)
    // Page1: 100000 * 0.01 * 1 = 1000
    // Page2: 200000 * 0.01 * 1 = 2000
    // Total projected traffic lost: 3000
    // Total projected traffic value: 3000 * 1 = $3000
    const expectedTrafficLost = 3000;
    const expectedTrafficValue = 3000;

    // Verify the calculated values match our expectations
    expect(setDataCall.args[0].projectedTrafficLost).to.equal(expectedTrafficLost);
    expect(setDataCall.args[0].projectedTrafficValue).to.equal(expectedTrafficValue);

    // Verify that the opportunity was updated with the metrics
    expect(altTextOppty.save).to.have.been.called;
  });

  it('should handle www and non-www URLs correctly when calculating metrics', async () => {
    // Mock utility functions to ensure predictable URL handling
    const convertToOpportunityWithMocks = await esmock('../../../src/image-alt-text/opportunityHandler.js', {
      '../../../src/support/utils.js': {
        getRUMUrl: sinon.stub().resolves('example.com'),
        toggleWWW: sinon.stub().callsFake((url) => {
          if (url.includes('www.')) {
            return url.replace('www.', '');
          }
          return url.replace('://', '://www.');
        }),
      },
      '@adobe/spacecat-shared-rum-api-client': {
        default: createMockRUMAPIClient(rumClientStub),
      },
      '../../../src/image-alt-text/constants.js': {
        CPC: 1,
        PENALTY_PER_IMAGE: 0.01,
        RUM_INTERVAL: 30,
      },
      '../../../src/common/opportunity-utils.js': {
        checkGoogleConnection: sinon.stub().resolves(true),
      },
    });

    dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([altTextOppty]);

    // Set up RUM API to return results with www prefix
    rumClientStub.query.resolves([
      { url: 'https://www.example.com/page1', earned: 100000 },
      { url: 'https://www.example.com/page2', earned: 200000 },
    ]);

    // Our test data has non-www URLs
    auditData.detectedImages.imagesWithoutAltText = [
      { pageUrl: '/page1', src: 'image1.jpg' },
      { pageUrl: '/page2', src: 'image2.jpg' },
    ];

    await convertToOpportunityWithMocks.default(auditUrl, auditData, context);

    // Check that the metrics were calculated correctly despite the www/non-www difference
    const setDataCall = altTextOppty.setData.getCall(0);
    expect(setDataCall).to.exist;

    // The calculation should still work by toggling www/non-www
    const expectedTrafficLost = 3000;
    const expectedTrafficValue = 3000;

    expect(setDataCall.args[0].projectedTrafficLost).to.equal(expectedTrafficLost);
    expect(setDataCall.args[0].projectedTrafficValue).to.equal(expectedTrafficValue);

    // Verify that no errors were logged about missing URLs
    expect(logStub.debug).to.not.have.been.calledWith(
      sinon.match(/Page URL .* not found in RUM API results/),
    );
  });

  it('should handle errors when fetching RUM API results', async () => {
    // Mock utility functions to ensure predictable behavior
    const convertToOpportunityWithMocks = await esmock('../../../src/image-alt-text/opportunityHandler.js', {
      '../../../src/support/utils.js': {
        getRUMUrl: sinon.stub().resolves('example.com'),
        toggleWWW: sinon.stub().callsFake((url) => {
          if (url.includes('www.')) {
            return url.replace('www.', '');
          }
          return url.replace('://', '://www.');
        }),
      },
      '@adobe/spacecat-shared-rum-api-client': {
        default: createMockRUMAPIClient(rumClientStub),
      },
      '../../../src/common/opportunity-utils.js': {
        checkGoogleConnection: sinon.stub().resolves(true),
      },
    });

    dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([altTextOppty]);

    // Mock RUM API to throw an error
    rumClientStub.query.rejects(new Error('RUM API error'));

    await convertToOpportunityWithMocks.default(auditUrl, auditData, context);

    expect(logStub.error).to.have.been.calledWith(
      '[alt-text]: Failed to get RUM results for https://example.com with error: RUM API error',
    );

    // Verify that the opportunity was created with zero metrics
    expect(altTextOppty.setData).to.have.been.calledWith({
      projectedTrafficLost: 0,
      projectedTrafficValue: 0,
      decorativeImagesCount: 0,
      unreachableImagesCount: 0,
      dataSources: [DATA_SOURCES.RUM, DATA_SOURCES.SITE, DATA_SOURCES.AHREFS],
    });
  });

  it('should convert audit data to opportunity with RUM data', async () => {
    dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([altTextOppty]);

    // Set up RUM API to return results
    rumClientStub.query.resolves([
      { url: 'https://example.com/page1', earned: 100000 },
      { url: 'https://example.com/page2', earned: 200000 },
    ]);

    // Update test data to include unreachableImages
    auditData.detectedImages = {
      ...auditData.detectedImages,
      unreachableImages: [],
    };

    await convertToOpportunity(auditUrl, auditData, context);

    // Verify that the opportunity was created with the correct data
    expect(altTextOppty.setData).to.have.been.calledWith({
      projectedTrafficLost: 3000,
      projectedTrafficValue: 3000,
      decorativeImagesCount: 0,
      unreachableImagesCount: 0,
      dataSources: [DATA_SOURCES.RUM, DATA_SOURCES.SITE, DATA_SOURCES.AHREFS],
    });
  });

  it('should handle case when page URL is not found in RUM API results', async () => {
    dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([altTextOppty]);

    // Set up RUM API to return empty results
    rumClientStub.query.resolves([]);

    // Our test data has images on pages
    auditData.detectedImages.imagesWithoutAltText = [
      { pageUrl: '/page1', src: 'image1.jpg' },
      { pageUrl: '/page2', src: 'image2.jpg' },
    ];

    await convertToOpportunity(auditUrl, auditData, context);

    // Verify that the debug log was called for each missing page URL
    expect(logStub.debug).to.have.been.calledWith(
      '[alt-text]: Page URL https://example.com/page1 or https://www.example.com/page1 not found in RUM API results',
    );
    expect(logStub.debug).to.have.been.calledWith(
      '[alt-text]: Page URL https://example.com/page2 or https://www.example.com/page2 not found in RUM API results',
    );

    // Verify that the opportunity was still created/updated with zero metrics
    const setDataCall = altTextOppty.setData.getCall(0);
    expect(setDataCall).to.exist;
    expect(setDataCall.args[0].projectedTrafficLost).to.equal(0);
    expect(setDataCall.args[0].projectedTrafficValue).to.equal(0);
  });
});

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
