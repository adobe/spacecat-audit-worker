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
  let sandbox;
  let context;
  let opportunity;
  let buildKey;
  let mapNewSuggestion;
  let newData;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    opportunity = {
      getId: sandbox.stub().returns('opportunity-id'),
      getSiteId: sandbox.stub().returns('site-id'),
      getSuggestions: sandbox.stub().resolves([]),
      addSuggestions: sandbox.stub().resolves({
        createdItems: [{ id: 'suggestion-id' }],
        errorItems: [],
      }),
    };

    context = {
      log: {
        debug: sandbox.stub(),
        info: sandbox.stub(),
        warn: sandbox.stub(),
        error: sandbox.stub(),
      },
      site: {
        getId: sandbox.stub().returns('site-id'),
        requiresValidation: false,
      },
      dataAccess: {
        Suggestion: {
          bulkUpdateStatus: sandbox.stub().resolves(),
          saveMany: sandbox.stub().resolves(),
        },
        Configuration: {
          findLatest: sinon.stub().resolves({
            isHandlerEnabledForSite: sinon.stub().returns(false),
          }),
        },
      },
    };

    buildKey = (data) => data.id;
    mapNewSuggestion = (data) => ({
      opportunityId: opportunity.getId(),
      type: 'TEST_TYPE',
      rank: data.rank || 0,
      data: { ...data },
    });

    newData = [
      { id: 'item1', value: 'test1', rank: 1 },
      { id: 'item2', value: 'test2', rank: 2 },
    ];
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should set status to NEW for sites without requiresValidation flag', async () => {
    context.site.requiresValidation = false;

    await syncSuggestions({
      context,
      opportunity,
      newData,
      buildKey,
      mapNewSuggestion,
    });

    const addSuggestionsCall = opportunity.addSuggestions.getCall(0);
    expect(addSuggestionsCall).to.exist;

    const suggestions = addSuggestionsCall.args[0];
    expect(suggestions).to.be.an('array').with.lengthOf(2);
    expect(suggestions[0].status).to.equal(Suggestion.STATUSES.NEW);
    expect(suggestions[1].status).to.equal(Suggestion.STATUSES.NEW);
  });

  it('should set status to PENDING_VALIDATION for sites with requiresValidation flag', async () => {
    context.site.requiresValidation = true;

    await syncSuggestions({
      context,
      opportunity,
      newData,
      buildKey,
      mapNewSuggestion,
    });

    const addSuggestionsCall = opportunity.addSuggestions.getCall(0);
    expect(addSuggestionsCall).to.exist;

    const suggestions = addSuggestionsCall.args[0];
    expect(suggestions).to.be.an('array').with.lengthOf(2);
    expect(suggestions[0].status).to.equal(Suggestion.STATUSES.PENDING_VALIDATION);
    expect(suggestions[1].status).to.equal(Suggestion.STATUSES.PENDING_VALIDATION);
  });

  it('should set OUTDATED suggestion to PENDING_VALIDATION when requiresValidation is true', async () => {
    context.site.requiresValidation = true;

    const existingSuggestion = {
      getId: sandbox.stub().returns('existing-suggestion-id'),
      getData: sandbox.stub().returns({ id: 'item1', value: 'existing' }),
      setData: sandbox.stub(),
      getStatus: sandbox.stub().returns(Suggestion.STATUSES.OUTDATED),
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
    };
    opportunity.getSuggestions.resolves([existingSuggestion]);

    await syncSuggestions({
      context,
      opportunity,
      newData: [{ id: 'item1', value: 'updated', rank: 1 }],
      buildKey,
      mapNewSuggestion,
    });

    sinon.assert.calledOnceWithExactly(
      existingSuggestion.setStatus,
      Suggestion.STATUSES.PENDING_VALIDATION,
    );
    sinon.assert.calledOnce(context.dataAccess.Suggestion.saveMany);
  });

  it('should set OUTDATED suggestion to NEW when requiresValidation is false', async () => {
    context.site.requiresValidation = false;

    const existingSuggestion = {
      getId: sandbox.stub().returns('existing-suggestion-id'),
      getData: sandbox.stub().returns({ id: 'item1', value: 'existing' }),
      setData: sandbox.stub(),
      getStatus: sandbox.stub().returns(Suggestion.STATUSES.OUTDATED),
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
    };
    opportunity.getSuggestions.resolves([existingSuggestion]);

    await syncSuggestions({
      context,
      opportunity,
      newData: [{ id: 'item1', value: 'updated', rank: 1 }],
      buildKey,
      mapNewSuggestion,
    });

    sinon.assert.calledOnceWithExactly(existingSuggestion.setStatus, Suggestion.STATUSES.NEW);
  });
});
