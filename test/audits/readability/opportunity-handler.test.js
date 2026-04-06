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

    // Mock isNonEmptyArray utility
    mockIsNonEmptyArray = sinon.stub();

    // Mock the module
    const opportunityHandler = await esmock(
      '../../../src/readability/preflight/opportunity-handler.js',
      {},
      {
        '@adobe/spacecat-shared-utils': {
          isNonEmptyArray: mockIsNonEmptyArray,
        },
      },
    );

    addReadabilitySuggestions = opportunityHandler.addReadabilitySuggestions;
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
        getType: () => 'readability',
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
});
