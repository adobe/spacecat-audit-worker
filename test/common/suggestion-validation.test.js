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

import { expect } from 'chai';
import sinon from 'sinon';
import { Suggestion } from '@adobe/spacecat-shared-data-access';
import { syncSuggestions } from '../../src/utils/data-access.js';

describe('Suggestion Validation Tests', () => {
  let context;
  let opportunity;
  let buildKey;
  let mapNewSuggestion;
  let newData;

  beforeEach(() => {
    // Mock opportunity
    opportunity = {
      getId: sinon.stub().returns('opportunity-id'),
      getSiteId: sinon.stub().returns('site-id'),
      getSuggestions: sinon.stub().resolves([]),
      addSuggestions: sinon.stub().resolves({
        createdItems: [{ id: 'suggestion-id' }],
        errorItems: [],
      }),
    };

    // Mock context
    context = {
      log: {
        debug: sinon.spy(),
        info: sinon.spy(),
        warn: sinon.spy(),
        error: sinon.spy(),
      },
      site: {
        getId: sinon.stub().returns('site-id'),
        requiresValidation: false,
      },
      dataAccess: {
        Suggestion: {
          bulkUpdateStatus: sinon.stub().resolves(),
        },
      },
    };

    // Mock functions
    buildKey = (data) => data.id;
    mapNewSuggestion = (data) => ({
      opportunityId: opportunity.getId(),
      type: 'TEST_TYPE',
      rank: data.rank || 0,
      data: { ...data },
    });

    // Mock data
    newData = [
      { id: 'item1', value: 'test1', rank: 1 },
      { id: 'item2', value: 'test2', rank: 2 },
    ];
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should set status to NEW for sites without requiresValidation flag', async () => {
    // Site without requiresValidation flag
    context.site.requiresValidation = false;

    await syncSuggestions({
      context,
      opportunity,
      newData,
      buildKey,
      mapNewSuggestion,
    });

    // Check if addSuggestions was called with correct status
    const addSuggestionsCall = opportunity.addSuggestions.getCall(0);
    expect(addSuggestionsCall).to.exist;

    const suggestions = addSuggestionsCall.args[0];
    expect(suggestions).to.be.an('array').with.lengthOf(2);
    expect(suggestions[0].status).to.equal(Suggestion.STATUSES.NEW);
    expect(suggestions[1].status).to.equal(Suggestion.STATUSES.NEW);
  });

  it('should set status to PENDING_VALIDATION for sites with requiresValidation flag', async () => {
    // Site with requiresValidation flag
    context.site.requiresValidation = true;

    await syncSuggestions({
      context,
      opportunity,
      newData,
      buildKey,
      mapNewSuggestion,
    });

    // Check if addSuggestions was called with correct status
    const addSuggestionsCall = opportunity.addSuggestions.getCall(0);
    expect(addSuggestionsCall).to.exist;

    const suggestions = addSuggestionsCall.args[0];
    expect(suggestions).to.be.an('array').with.lengthOf(2);
    expect(suggestions[0].status).to.equal(Suggestion.STATUSES.PENDING_VALIDATION);
    expect(suggestions[1].status).to.equal(Suggestion.STATUSES.PENDING_VALIDATION);
  });

  // Removed legacy list test; relies on entitlement-driven requiresValidation only
});
