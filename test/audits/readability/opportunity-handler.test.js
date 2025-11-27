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
import sinonChai from 'sinon-chai';
import sinon from 'sinon';
import esmock from 'esmock';

use(sinonChai);

describe('Opportunity Handler Tests', () => {
  let addReadabilitySuggestions;
  let clearReadabilitySuggestions;
  let mockSuggestionModel;
  let mockIsNonEmptyArray;
  let log;

  beforeEach(async () => {
    // Setup mocks
    log = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
      debug: sinon.stub(),
    };

    // Mock SuggestionModel
    mockSuggestionModel = {
      STATUSES: {
        SKIPPED: 'skipped',
        FIXED: 'fixed',
        PENDING: 'pending',
      },
    };

    // Mock isNonEmptyArray utility
    mockIsNonEmptyArray = sinon.stub();

    // Mock the module
    const opportunityHandler = await esmock(
      '../../../src/readability/preflight/opportunity-handler.js',
      {},
      {
        '@adobe/spacecat-shared-data-access': {
          Suggestion: mockSuggestionModel,
        },
        '@adobe/spacecat-shared-utils': {
          isNonEmptyArray: mockIsNonEmptyArray,
        },
      },
    );

    addReadabilitySuggestions = opportunityHandler.addReadabilitySuggestions;
    clearReadabilitySuggestions = opportunityHandler.clearReadabilitySuggestions;
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('addReadabilitySuggestions', () => {
    let mockOpportunity;
    let mockSuggestionDTOs;

    beforeEach(() => {
      mockOpportunity = {
        addSuggestions: sinon.stub(),
        getSiteId: () => 'test-site-id',
      };

      mockSuggestionDTOs = [
        {
          opportunityId: 'test-opportunity-id',
          type: 'CONTENT_UPDATE',
          data: { recommendations: [{ originalText: 'test', improvedText: 'improved' }] },
          rank: 1,
        },
      ];
    });

    it('should add suggestions successfully', async () => {
      // Mock successful addition
      mockIsNonEmptyArray
        .onFirstCall().returns(true) // newSuggestionDTOs is non-empty
        .onSecondCall().returns(false) // errorItems is empty
        .onThirdCall()
        .returns(true); // createdItems is non-empty

      const updateResult = {
        createdItems: [{ id: 'suggestion-1' }],
        errorItems: [],
      };
      mockOpportunity.addSuggestions.resolves(updateResult);

      await addReadabilitySuggestions({
        opportunity: mockOpportunity,
        newSuggestionDTOs: mockSuggestionDTOs,
        log,
      });

      expect(mockOpportunity.addSuggestions).to.have.been.calledWith(mockSuggestionDTOs);
      expect(log.info).to.have.been.calledWith('[READABILITY]: Added 1 new readability suggestions');
      expect(log.error).not.to.have.been.called;
    });

    it('should skip when newSuggestionDTOs is empty', async () => {
      // Mock empty array check
      mockIsNonEmptyArray.returns(false);

      await addReadabilitySuggestions({
        opportunity: mockOpportunity,
        newSuggestionDTOs: [],
        log,
      });

      expect(mockOpportunity.addSuggestions).not.to.have.been.called;
      expect(log.debug).to.have.been.calledWith('[READABILITY]: No new suggestions to add');
    });

    it('should skip when newSuggestionDTOs is null', async () => {
      // Mock null check
      mockIsNonEmptyArray.returns(false);

      await addReadabilitySuggestions({
        opportunity: mockOpportunity,
        newSuggestionDTOs: null,
        log,
      });

      expect(mockOpportunity.addSuggestions).not.to.have.been.called;
      expect(log.debug).to.have.been.calledWith('[READABILITY]: No new suggestions to add');
    });

    it('should handle partial errors but continue when some items succeed', async () => {
      // Mock array check
      mockIsNonEmptyArray
        .onFirstCall().returns(true) // newSuggestionDTOs is non-empty
        .onSecondCall().returns(true) // errorItems is non-empty
        .onThirdCall()
        .returns(true); // createdItems is non-empty

      const updateResult = {
        createdItems: [{ id: 'suggestion-1' }],
        errorItems: [
          { item: { id: 'failed-suggestion' }, error: 'Validation failed' },
        ],
      };
      mockOpportunity.addSuggestions.resolves(updateResult);

      await addReadabilitySuggestions({
        opportunity: mockOpportunity,
        newSuggestionDTOs: mockSuggestionDTOs,
        log,
      });

      expect(log.error).to.have.been.calledWith('[READABILITY]: Suggestions for siteId test-site-id contains 1 items with errors');
      expect(log.error).to.have.been.calledWith('[READABILITY]: Item {"id":"failed-suggestion"} failed with error: Validation failed');
      expect(log.info).to.have.been.calledWith('[READABILITY]: Added 1 new readability suggestions');
    });

    it('should throw error when all suggestions fail to create', async () => {
      // Mock array checks
      mockIsNonEmptyArray
        .onFirstCall().returns(true) // newSuggestionDTOs is non-empty
        .onSecondCall().returns(true) // errorItems is non-empty
        .onThirdCall()
        .returns(false); // createdItems is empty

      const updateResult = {
        createdItems: [],
        errorItems: [
          { item: { id: 'failed-suggestion-1' }, error: 'Validation failed' },
          { item: { id: 'failed-suggestion-2' }, error: 'Database error' },
        ],
      };
      mockOpportunity.addSuggestions.resolves(updateResult);

      await expect(
        addReadabilitySuggestions({
          opportunity: mockOpportunity,
          newSuggestionDTOs: mockSuggestionDTOs,
          log,
        }),
      ).to.be.rejectedWith('[READABILITY]: Failed to create suggestions for siteId test-site-id');

      expect(log.error).to.have.been.calledWith('[READABILITY]: Suggestions for siteId test-site-id contains 2 items with errors');
    });

    it('should handle multiple error items and log each one', async () => {
      // Mock array checks
      mockIsNonEmptyArray
        .onFirstCall().returns(true) // newSuggestionDTOs is non-empty
        .onSecondCall().returns(true) // errorItems is non-empty
        .onThirdCall()
        .returns(true); // createdItems is non-empty

      const updateResult = {
        createdItems: [{ id: 'suggestion-1' }],
        errorItems: [
          { item: { id: 'failed-1', data: 'test1' }, error: 'Error 1' },
          { item: { id: 'failed-2', data: 'test2' }, error: 'Error 2' },
          { item: { id: 'failed-3', data: 'test3' }, error: 'Error 3' },
        ],
      };
      mockOpportunity.addSuggestions.resolves(updateResult);

      await addReadabilitySuggestions({
        opportunity: mockOpportunity,
        newSuggestionDTOs: mockSuggestionDTOs,
        log,
      });

      expect(log.error).to.have.been.calledWith('[READABILITY]: Suggestions for siteId test-site-id contains 3 items with errors');
      expect(log.error).to.have.been.calledWith('[READABILITY]: Item {"id":"failed-1","data":"test1"} failed with error: Error 1');
      expect(log.error).to.have.been.calledWith('[READABILITY]: Item {"id":"failed-2","data":"test2"} failed with error: Error 2');
      expect(log.error).to.have.been.calledWith('[READABILITY]: Item {"id":"failed-3","data":"test3"} failed with error: Error 3');
    });

    it('should handle when updateResult has no errorItems (successful case)', async () => {
      // Mock array checks
      mockIsNonEmptyArray
        .onFirstCall().returns(true) // newSuggestionDTOs is non-empty
        .onSecondCall().returns(false); // errorItems is empty/null

      const updateResult = {
        createdItems: [{ id: 'suggestion-1' }, { id: 'suggestion-2' }],
        errorItems: [],
      };
      mockOpportunity.addSuggestions.resolves(updateResult);

      await addReadabilitySuggestions({
        opportunity: mockOpportunity,
        newSuggestionDTOs: mockSuggestionDTOs,
        log,
      });

      expect(log.error).not.to.have.been.called;
      expect(log.info).to.have.been.calledWith('[READABILITY]: Added 1 new readability suggestions');
    });
  });

  describe('clearReadabilitySuggestions', () => {
    let mockOpportunity;
    let mockSuggestions;

    beforeEach(() => {
      mockOpportunity = {
        getSuggestions: sinon.stub(),
      };

      mockSuggestions = [
        {
          getId: () => 'suggestion-1',
          getStatus: () => 'pending',
          remove: sinon.stub().resolves(),
        },
        {
          getId: () => 'suggestion-2',
          getStatus: () => 'skipped',
          remove: sinon.stub().resolves(),
        },
        {
          getId: () => 'suggestion-3',
          getStatus: () => 'fixed',
          remove: sinon.stub().resolves(),
        },
        {
          getId: () => 'suggestion-4',
          getStatus: () => 'pending',
          remove: sinon.stub().resolves(),
        },
      ];
    });

    it('should skip when no opportunity is provided', async () => {
      await clearReadabilitySuggestions({
        opportunity: null,
        log,
      });

      expect(log.debug).to.have.been.calledWith('[READABILITY]: No opportunity found, skipping suggestion cleanup');
    });

    it('should skip when opportunity is undefined', async () => {
      await clearReadabilitySuggestions({
        opportunity: undefined,
        log,
      });

      expect(log.debug).to.have.been.calledWith('[READABILITY]: No opportunity found, skipping suggestion cleanup');
    });

    it('should skip when no existing suggestions found', async () => {
      mockOpportunity.getSuggestions.resolves([]);

      await clearReadabilitySuggestions({
        opportunity: mockOpportunity,
        log,
      });

      expect(log.debug).to.have.been.calledWith('[READABILITY]: No existing suggestions to clear');
    });

    it('should skip when existing suggestions is null', async () => {
      mockOpportunity.getSuggestions.resolves(null);

      await clearReadabilitySuggestions({
        opportunity: mockOpportunity,
        log,
      });

      expect(log.debug).to.have.been.calledWith('[READABILITY]: No existing suggestions to clear');
    });

    it('should clear non-ignored suggestions and preserve ignored ones', async () => {
      mockOpportunity.getSuggestions.resolves(mockSuggestions);

      await clearReadabilitySuggestions({
        opportunity: mockOpportunity,
        log,
      });

      // Should remove pending suggestions (suggestion-1 and suggestion-4)
      expect(mockSuggestions[0].remove).to.have.been.called;
      expect(mockSuggestions[3].remove).to.have.been.called;

      // Should NOT remove skipped/fixed suggestions (suggestion-2 and suggestion-3)
      expect(mockSuggestions[1].remove).not.to.have.been.called;
      expect(mockSuggestions[2].remove).not.to.have.been.called;

      expect(log.info).to.have.been.calledWith('[READABILITY]: Cleared 2 existing suggestions (preserved 2 ignored suggestions)');
    });

    it('should handle when all suggestions are ignored', async () => {
      const ignoredSuggestions = [
        {
          getId: () => 'suggestion-1',
          getStatus: () => 'skipped',
          remove: sinon.stub().resolves(),
        },
        {
          getId: () => 'suggestion-2',
          getStatus: () => 'fixed',
          remove: sinon.stub().resolves(),
        },
      ];

      mockOpportunity.getSuggestions.resolves(ignoredSuggestions);

      await clearReadabilitySuggestions({
        opportunity: mockOpportunity,
        log,
      });

      // Should not remove any suggestions
      expect(ignoredSuggestions[0].remove).not.to.have.been.called;
      expect(ignoredSuggestions[1].remove).not.to.have.been.called;

      expect(log.debug).to.have.been.calledWith('[READABILITY]: No suggestions to clear (all 2 suggestions are ignored)');
    });

    it('should handle when all suggestions need to be removed', async () => {
      const removableSuggestions = [
        {
          getId: () => 'suggestion-1',
          getStatus: () => 'pending',
          remove: sinon.stub().resolves(),
        },
        {
          getId: () => 'suggestion-2',
          getStatus: () => 'active',
          remove: sinon.stub().resolves(),
        },
        {
          getId: () => 'suggestion-3',
          getStatus: () => 'draft',
          remove: sinon.stub().resolves(),
        },
      ];

      mockOpportunity.getSuggestions.resolves(removableSuggestions);

      await clearReadabilitySuggestions({
        opportunity: mockOpportunity,
        log,
      });

      // Should remove all suggestions
      expect(removableSuggestions[0].remove).to.have.been.called;
      expect(removableSuggestions[1].remove).to.have.been.called;
      expect(removableSuggestions[2].remove).to.have.been.called;

      expect(log.info).to.have.been.calledWith('[READABILITY]: Cleared 3 existing suggestions (preserved 0 ignored suggestions)');
    });

    it('should handle mixed statuses correctly', async () => {
      const mixedSuggestions = [
        {
          getId: () => 'suggestion-1',
          getStatus: () => 'skipped', // Should be preserved
          remove: sinon.stub().resolves(),
        },
        {
          getId: () => 'suggestion-2',
          getStatus: () => 'pending', // Should be removed
          remove: sinon.stub().resolves(),
        },
        {
          getId: () => 'suggestion-3',
          getStatus: () => 'fixed', // Should be preserved
          remove: sinon.stub().resolves(),
        },
        {
          getId: () => 'suggestion-4',
          getStatus: () => 'active', // Should be removed
          remove: sinon.stub().resolves(),
        },
        {
          getId: () => 'suggestion-5',
          getStatus: () => 'skipped', // Should be preserved
          remove: sinon.stub().resolves(),
        },
      ];

      mockOpportunity.getSuggestions.resolves(mixedSuggestions);

      await clearReadabilitySuggestions({
        opportunity: mockOpportunity,
        log,
      });

      // Should preserve skipped/fixed (suggestions 1, 3, 5)
      expect(mixedSuggestions[0].remove).not.to.have.been.called;
      expect(mixedSuggestions[2].remove).not.to.have.been.called;
      expect(mixedSuggestions[4].remove).not.to.have.been.called;

      // Should remove others (suggestions 2, 4)
      expect(mixedSuggestions[1].remove).to.have.been.called;
      expect(mixedSuggestions[3].remove).to.have.been.called;

      expect(log.info).to.have.been.calledWith('[READABILITY]: Cleared 2 existing suggestions (preserved 3 ignored suggestions)');
    });

    it('should handle Promise.all for multiple removals', async () => {
      const largeSuggestionSet = Array.from({ length: 10 }, (_, i) => ({
        getId: () => `suggestion-${i}`,
        getStatus: () => 'pending', // All should be removed
        remove: sinon.stub().resolves(),
      }));

      mockOpportunity.getSuggestions.resolves(largeSuggestionSet);

      await clearReadabilitySuggestions({
        opportunity: mockOpportunity,
        log,
      });

      // All should be removed
      largeSuggestionSet.forEach((suggestion) => {
        expect(suggestion.remove).to.have.been.called;
      });

      expect(log.info).to.have.been.calledWith('[READABILITY]: Cleared 10 existing suggestions (preserved 0 ignored suggestions)');
    });
  });
});
