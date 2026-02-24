/*
 * Copyright 2026 Adobe. All rights reserved.
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
import { Suggestion as SuggestionModel } from '@adobe/spacecat-shared-data-access';
import { MockContextBuilder } from '../shared.js';
import guidanceHandler from '../../src/on-page-seo/guidance-handler.js';

use(sinonChai);

describe('On-Page SEO Guidance Handler Tests', () => {
  const opportunityId = 'oppty-123';
  const siteId = 'site-123';

  let context;
  let sandbox;
  let opportunity;
  let findByIdStub;
  let createSuggestionStub;

  before('setup', () => {
    sandbox = sinon.createSandbox();
  });

  beforeEach(() => {
    opportunity = {
      getId: () => opportunityId,
      setGuidance: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
      getSuggestions: sandbox.stub().resolves([]),
    };

    findByIdStub = sandbox.stub().resolves(opportunity);
    createSuggestionStub = sandbox.stub().resolves();

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        dataAccess: {
          Opportunity: {
            findById: findByIdStub,
          },
          Suggestion: {
            create: createSuggestionStub,
          },
        },
      })
      .build();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return 404 if opportunity not found', async () => {
    findByIdStub.resolves(null);

    const message = {
      opportunityId,
      data: {
        guidance: [],
        contentRecommendations: [],
      },
    };

    const result = await guidanceHandler(message, context);

    expect(result.status).to.equal(404);
  });

  it('should skip updates if suggestions were manually modified', async () => {
    const manualSuggestion = {
      getUpdatedBy: () => 'user@example.com',
      getData: () => ({}),
    };
    opportunity.getSuggestions.resolves([manualSuggestion]);

    const message = {
      opportunityId,
      data: {
        guidance: [{ insight: 'test', rationale: 'test', recommendation: 'test' }],
        contentRecommendations: [],
      },
    };

    const result = await guidanceHandler(message, context);

    expect(result.status).to.equal(200);
    expect(opportunity.setGuidance).to.not.have.been.called;
    expect(createSuggestionStub).to.not.have.been.called;
  });

  it('should update opportunity guidance from Mystique', async () => {
    const guidance = [
      {
        insight: 'Target keywords are missing from title tags',
        rationale: 'Pages ranking 4-10 can improve with optimized titles',
        recommendation: 'Include primary keywords in H1 and title tags naturally',
        type: 'guidance',
      },
    ];

    const message = {
      opportunityId,
      data: {
        guidance,
        contentRecommendations: [],
      },
    };

    await guidanceHandler(message, context);

    expect(opportunity.setGuidance).to.have.been.calledWith({
      recommendations: guidance,
    });
    expect(opportunity.setUpdatedBy).to.have.been.calledWith('system');
    expect(opportunity.save).to.have.been.called;
  });

  it('should create suggestions with variations from Mystique', async () => {
    const contentRecommendations = [
      {
        url: 'https://example.com/page1',
        quickWinScore: 300,
        variations: [
          {
            name: 'Original',
            id: 'original',
            variationPageUrl: 'https://example.com/page1',
            previewImage: 'https://s3.../original.jpg',
            projectedImpact: 0.0,
          },
          {
            name: 'Variation 1',
            id: 'var-1',
            variationPageUrl: 'https://mystique.../var-1',
            previewImage: 'https://s3.../var-1.jpg',
            changes: [
              { element: 'title', from: 'Old Title', to: 'Optimized Title' },
            ],
            projectedImpact: 0.15,
          },
        ],
      },
    ];

    const message = {
      opportunityId,
      data: {
        guidance: [],
        contentRecommendations,
      },
    };

    await guidanceHandler(message, context);

    expect(createSuggestionStub).to.have.been.calledOnce;
    const suggestionData = createSuggestionStub.getCall(0).args[0];
    expect(suggestionData.opportunityId).to.equal(opportunityId);
    expect(suggestionData.type).to.equal('CONTENT_UPDATE');
    expect(suggestionData.rank).to.equal(300);
    expect(suggestionData.status).to.equal(SuggestionModel.STATUSES.NEW);
    expect(suggestionData.data.variations).to.deep.equal(contentRecommendations[0].variations);
    expect(suggestionData.kpiDeltas.estimatedKPILift).to.equal(0.15);
  });

  it('should calculate estimatedKPILift from maximum projectedImpact', async () => {
    const contentRecommendations = [
      {
        url: 'https://example.com/page1',
        quickWinScore: 300,
        variations: [
          { name: 'Original', projectedImpact: 0.0 },
          { name: 'Variation 1', projectedImpact: 0.12 },
          { name: 'Variation 2', projectedImpact: 0.18 }, // Highest
          { name: 'Variation 3', projectedImpact: 0.15 },
        ],
      },
    ];

    const message = {
      opportunityId,
      data: {
        contentRecommendations,
      },
    };

    await guidanceHandler(message, context);

    const suggestionData = createSuggestionStub.getCall(0).args[0];
    expect(suggestionData.kpiDeltas.estimatedKPILift).to.equal(0.18);
  });

  it('should delete previous content suggestions but keep technical ones', async () => {
    const contentSuggestion = {
      getData: () => ({ requiresTechnicalFix: false }),
      getUpdatedBy: () => 'system',
      remove: sandbox.stub().resolves(),
    };
    const technicalSuggestion = {
      getData: () => ({ requiresTechnicalFix: true }),
      getUpdatedBy: () => 'system',
      remove: sandbox.stub().resolves(),
    };

    opportunity.getSuggestions.resolves([contentSuggestion, technicalSuggestion]);

    const message = {
      opportunityId,
      data: {
        contentRecommendations: [],
      },
    };

    await guidanceHandler(message, context);

    expect(contentSuggestion.remove).to.have.been.called;
    expect(technicalSuggestion.remove).to.not.have.been.called;
  });

  it('should respect requiresValidation flag for suggestion status', async () => {
    context.site = { requiresValidation: true };

    const contentRecommendations = [
      {
        url: 'https://example.com/page1',
        quickWinScore: 300,
        variations: [
          { name: 'Original', projectedImpact: 0.0 },
        ],
      },
    ];

    const message = {
      opportunityId,
      data: {
        contentRecommendations,
      },
    };

    await guidanceHandler(message, context);

    const suggestionData = createSuggestionStub.getCall(0).args[0];
    expect(suggestionData.status).to.equal(SuggestionModel.STATUSES.PENDING_VALIDATION);
  });

  it('should handle multiple content recommendations', async () => {
    const contentRecommendations = [
      {
        url: 'https://example.com/page1',
        quickWinScore: 300,
        variations: [{ name: 'Original', projectedImpact: 0.0 }],
      },
      {
        url: 'https://example.com/page2',
        quickWinScore: 250,
        variations: [{ name: 'Original', projectedImpact: 0.0 }],
      },
      {
        url: 'https://example.com/page3',
        quickWinScore: 200,
        variations: [{ name: 'Original', projectedImpact: 0.0 }],
      },
    ];

    const message = {
      opportunityId,
      data: {
        contentRecommendations,
      },
    };

    await guidanceHandler(message, context);

    expect(createSuggestionStub).to.have.been.calledThrice;
  });

  it('should handle empty variations array gracefully', async () => {
    const contentRecommendations = [
      {
        url: 'https://example.com/page1',
        quickWinScore: 300,
        variations: [],
      },
    ];

    const message = {
      opportunityId,
      data: {
        contentRecommendations,
      },
    };

    await guidanceHandler(message, context);

    const suggestionData = createSuggestionStub.getCall(0).args[0];
    expect(suggestionData.data.variations).to.deep.equal([]);
    expect(suggestionData.kpiDeltas.estimatedKPILift).to.equal(0);
  });
});

