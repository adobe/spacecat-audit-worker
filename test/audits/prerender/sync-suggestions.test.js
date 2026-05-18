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
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { syncSuggestions } from '../../../src/utils/data-access.js';
import { toPathname } from '../../../src/prerender/utils/utils.js';

use(sinonChai);

// Mirrors the buildKey in processOpportunityAndSuggestions
const buildKey = (data) => {
  if (data.key) return data.key;
  return toPathname(data.url);
};

// Mirrors the pathname-normalized scrapedUrlsSet created in processOpportunityAndSuggestions
const makeScrapedUrlsSet = (urls) => {
  const pathnames = new Set(urls.map(toPathname));
  return { has: (url) => pathnames.has(toPathname(url)) };
};

// Mirrors the mergeDataFunction used in processOpportunityAndSuggestions
const mergeDataFunction = (existingData, newDataItem) => {
  if (newDataItem.key) return { ...newDataItem.data };
  return { ...existingData, ...newDataItem };
};

// Minimal suggestion mock with mutable state
const makeSuggestion = (data, status = 'NEW') => {
  let _data = { ...data };
  let _status = status;
  return {
    getData: () => _data,
    setData: (d) => { _data = d; },
    getStatus: () => _status,
    setStatus: (s) => { _status = s; },
    setUpdatedBy: () => {},
  };
};

describe('Prerender syncSuggestions integration', () => {
  let sandbox;
  let saveMany;
  let bulkUpdateStatus;
  let addSuggestions;
  let opportunity;
  let context;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    saveMany = sandbox.stub().resolves();
    bulkUpdateStatus = sandbox.stub().resolves();
    addSuggestions = sandbox.stub().resolves([]);

    opportunity = {
      getId: () => 'opp-1',
      getSiteId: () => 'site-1',
      getType: () => 'prerender',
      getSuggestions: sandbox.stub(),
      addSuggestions,
    };

    context = {
      log: {
        info: sandbox.stub(),
        debug: sandbox.stub(),
        warn: sandbox.stub(),
        error: sandbox.stub(),
      },
      dataAccess: {
        Suggestion: {
          saveMany,
          bulkUpdateStatus,
        },
      },
    };
  });

  afterEach(() => sandbox.restore());

  it('Case 1 — existing suggestion is updated in place when pathname key matches new audit data', async () => {
    // Existing suggestion stored with old domain (www.)
    const existing = makeSuggestion({
      url: 'https://www.example.com/page1',
      contentGainRatio: 1.0,
      wordCountBefore: 100,
      wordCountAfter: 200,
    });
    opportunity.getSuggestions.resolves([existing]);

    // New audit data uses the canonical domain (no www)
    const newData = [{
      url: 'https://example.com/page1',
      contentGainRatio: 2.5,
      wordCountBefore: 120,
      wordCountAfter: 300,
    }];

    await syncSuggestions({
      context,
      opportunity,
      newData,
      buildKey,
      mergeDataFunction,
      mapNewSuggestion: (d) => ({ data: d }),
      existingSuggestions: [existing],
    });

    // Suggestion was updated in place — saveMany called with the updated suggestion
    expect(saveMany).to.have.been.calledOnce;
    expect(existing.getData().contentGainRatio).to.equal(2.5);
    expect(existing.getData().wordCountBefore).to.equal(120);
    // No new suggestions created and nothing outdated
    expect(addSuggestions).to.not.have.been.called;
    expect(bulkUpdateStatus).to.not.have.been.called;
  });

  it('Case 2 — existing NEW suggestion is marked OUTDATED when its URL was scraped but not in new data', async () => {
    const existing = makeSuggestion({
      url: 'https://example.com/page-gone',
      contentGainRatio: 1.5,
    });
    opportunity.getSuggestions.resolves([existing]);

    // The URL was scraped this run but the page no longer needs prerender
    const scrapedUrlsSet = makeScrapedUrlsSet(['https://example.com/page-gone']);

    await syncSuggestions({
      context,
      opportunity,
      newData: [],      // no new prerender URLs
      buildKey,
      mergeDataFunction,
      mapNewSuggestion: (d) => ({ data: d }),
      scrapedUrlsSet,
      existingSuggestions: [existing],
    });

    expect(bulkUpdateStatus).to.have.been.calledOnce;
    const [outdatedSuggestions, status] = bulkUpdateStatus.firstCall.args;
    expect(outdatedSuggestions).to.include(existing);
    expect(status).to.equal('OUTDATED');
    // No in-place update or new creation
    expect(saveMany).to.not.have.been.called;
    expect(addSuggestions).to.not.have.been.called;
  });

  it('Case 3 — existing suggestion is preserved when its URL was NOT scraped this run', async () => {
    const existing = makeSuggestion({
      url: 'https://example.com/unvisited-page',
      contentGainRatio: 1.2,
    });
    opportunity.getSuggestions.resolves([existing]);

    // scrapedUrlsSet does NOT include the unvisited page
    const scrapedUrlsSet = makeScrapedUrlsSet(['https://example.com/other-page']);

    await syncSuggestions({
      context,
      opportunity,
      newData: [],
      buildKey,
      mergeDataFunction,
      mapNewSuggestion: (d) => ({ data: d }),
      scrapedUrlsSet,
      existingSuggestions: [existing],
    });

    // Nothing should have been updated or outdated
    expect(bulkUpdateStatus).to.not.have.been.called;
    expect(saveMany).to.not.have.been.called;
    expect(addSuggestions).to.not.have.been.called;
  });

  it('Case 5 — new suggestion is created when no matching existing suggestion exists', async () => {
    opportunity.getSuggestions.resolves([]);

    const newData = [{
      url: 'https://example.com/brand-new-page',
      contentGainRatio: 3.0,
      wordCountBefore: 50,
      wordCountAfter: 150,
    }];

    await syncSuggestions({
      context,
      opportunity,
      newData,
      buildKey,
      mergeDataFunction,
      mapNewSuggestion: (d) => ({
        opportunityId: 'opp-1',
        type: 'CONFIG_UPDATE',
        rank: 0,
        data: d,
      }),
      existingSuggestions: [],
    });

    expect(addSuggestions).to.have.been.calledOnce;
    const [created] = addSuggestions.firstCall.args;
    expect(created).to.have.length(1);
    expect(created[0].data.url).to.equal('https://example.com/brand-new-page');
    expect(created[0].data.contentGainRatio).to.equal(3.0);
    // Nothing outdated or updated
    expect(bulkUpdateStatus).to.not.have.been.called;
    expect(saveMany).to.not.have.been.called;
  });

  it('pathname normalization — domain shift does not create a duplicate suggestion', async () => {
    // Suggestion stored under old base URL (www prefix)
    const existing = makeSuggestion({
      url: 'https://www.example.com/article',
      contentGainRatio: 1.0,
    });

    // New audit data uses canonical domain without www
    const newData = [{
      url: 'https://example.com/article',
      contentGainRatio: 2.0,
    }];

    // Both /article paths share the same buildKey — existing should be updated, not duplicated
    await syncSuggestions({
      context,
      opportunity,
      newData,
      buildKey,
      mergeDataFunction,
      mapNewSuggestion: (d) => ({ data: d }),
      existingSuggestions: [existing],
    });

    expect(saveMany).to.have.been.calledOnce;
    // No new suggestion created — was matched via pathname key
    expect(addSuggestions).to.not.have.been.called;
  });
});
