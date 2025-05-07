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
import { Audit, Suggestion as SuggestionModel } from '@adobe/spacecat-shared-data-access';
import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import convertToOpportunity from '../../../src/image-alt-text/opportunityHandler.js';
import suggestionsEngine from '../../../src/image-alt-text/suggestionsEngine.js';

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
    };

    logStub = {
      info: sinon.stub(),
      debug: sinon.stub(),
      error: sinon.stub(),
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
        presentationalImagesCount: 0,
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

  it('should create new opportunity when none exists', async () => {
    dataAccessStub.Opportunity.create.resolves(altTextOppty);

    await convertToOpportunity(auditUrl, auditData, context);

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
      data: sinon.match.object,
    }));
    expect(logStub.debug).to.have.been.calledWith(
      '[alt-text]: Opportunity created',
    );
  });

  it('should update existing opportunity when one exists', async () => {
    dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([altTextOppty]);

    await convertToOpportunity(auditUrl, auditData, context);

    expect(altTextOppty.setAuditId).to.have.been.calledWith('audit-id');
    expect(altTextOppty.save).to.have.been.called;
    expect(dataAccessStub.Opportunity.create).to.not.have.been.called;
  });

  it('should update existing opportunity with empty suggestion if none are found', async () => {
    dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([altTextOppty]);
    suggestionsEngine.getImageSuggestions.resolves({});

    await convertToOpportunity(auditUrl, auditData, context);

    expect(altTextOppty.setAuditId).to.have.been.calledWith('audit-id');
    expect(altTextOppty.save).to.have.been.called;

    expect(dataAccessStub.Opportunity.create).to.not.have.been.called;
  });

  it('should handle error when fetching opportunities fails', async () => {
    const error = new Error('Fetch failed');
    dataAccessStub.Opportunity.allBySiteIdAndStatus.rejects(error);

    try {
      await convertToOpportunity(auditUrl, auditData, context);
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
    const error = new Error('Creation failed');
    dataAccessStub.Opportunity.create.rejects(error);

    try {
      await convertToOpportunity(auditUrl, auditData, context);
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

    await convertToOpportunity(auditUrl, auditData, context);

    expect(logStub.error).to.have.been.calledWith(
      '[alt-text]: Suggestions for siteId site-id contains 1 items with errors',
    );
    expect(logStub.error).to.have.been.calledWith(
      '[alt-text]: Item {"url":"/page1","src":"image1.jpg"} failed with error: Invalid suggestion data',
    );
  });

  it('should throw error when all suggestions fail to create', async () => {
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
      await convertToOpportunity(auditUrl, auditData, context);
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

    await convertToOpportunity(auditUrl, auditData, context);

    // Verify that only non-ignored suggestion was removed
    expect(mockSuggestions[0].remove).to.not.have.been.called;
    expect(mockSuggestions[1].remove).to.have.been.called;
  });

  it('should log error when page URL is not found in RUM API results', async () => {
    dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([altTextOppty]);

    // Set up RUM API to return results that don't match our image URLs
    rumClientStub.query.resolves([
      { url: 'https://example.com/different-page', earned: 100000 },
      { url: 'https://example.com/another-page', earned: 287100 },
    ]);

    // Our test data has images on /page1 and /page2, which won't be found in the RUM results
    await convertToOpportunity(auditUrl, auditData, context);

    // Verify the error was logged for both missing pages with correct www/non-www format
    expect(logStub.debug).to.have.been.calledWith(
      '[alt-text]: Page URL https://example.com/page1 or https://www.example.com/page1 not found in RUM API results',
    );
    expect(logStub.debug).to.have.been.calledWith(
      '[alt-text]: Page URL https://example.com/page2 or https://www.example.com/page2 not found in RUM API results',
    );

    // The opportunity should still be created/updated despite the missing pages
    expect(altTextOppty.setData).to.have.been.called;
    expect(altTextOppty.save).to.have.been.called;
  });

  it('should calculate projected metrics correctly', async () => {
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

    await convertToOpportunity(auditUrl, auditData, context);

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

    await convertToOpportunity(auditUrl, auditData, context);

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
    dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([altTextOppty]);

    // Make RUM API client throw an error
    const rumError = new Error('RUM API connection failed');
    rumClientStub.query.rejects(rumError);

    await convertToOpportunity(auditUrl, auditData, context);

    // Verify error was logged
    expect(logStub.error).to.have.been.calledWith(
      '[alt-text]: Failed to get RUM results for https://example.com with error: RUM API connection failed',
    );

    // Verify opportunity was still created/updated with default metrics
    expect(altTextOppty.setData).to.have.been.calledWith({
      projectedTrafficLost: 0,
      projectedTrafficValue: 0,
      presentationalImagesCount: 0,
    });

    expect(altTextOppty.save).to.have.been.called;

    // Verify suggestions were still created despite RUM API failure
    expect(altTextOppty.addSuggestions).to.have.been.called;
    expect(logStub.info).to.have.been.calledWith(
      '[alt-text]: Successfully synced Opportunity And Suggestions for site: https://example.com siteId: site-id and alt-text audit type.',
    );
  });
});
