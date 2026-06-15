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
import { buildSuggestionKey as buildKey, toPathname } from '../../../src/prerender/utils/utils.js';
import { DOMAIN_WIDE_SUGGESTION_KEY as DOMAIN_WIDE_KEY } from '../../../src/prerender/utils/constants.js';

use(sinonChai);

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

  it('Case 6 — existing domain-wide suggestion (isDomainWide:true, no .key) is matched and updated, not duplicated', async () => {
    // Simulates the stale DB record: stored data has isDomainWide but no .key field.
    // Before the fix, buildKey returned a pathname-based key for the stored record and
    // DOMAIN_WIDE_KEY for the incoming item, so they never matched and a duplicate was created.
    const existingDomainWide = makeSuggestion({
      isDomainWide: true,
      url: 'https://example.com/* (All Domain URLs)',
      pathPattern: '/*',
      allowedRegexPatterns: ['/*'],
      wordCountBefore: 10,
      wordCountAfter: 20,
      contentGainRatio: 0.5,
    }, 'OUTDATED');

    // Incoming domain-wide from a new audit run — has .key field
    const incomingDomainWide = {
      key: DOMAIN_WIDE_KEY,
      data: {
        isDomainWide: true,
        url: 'https://example.com/* (All Domain URLs)',
        pathPattern: '/*',
        allowedRegexPatterns: ['/*'],
        wordCountBefore: 15,
        wordCountAfter: 35,
        contentGainRatio: 1.2,
      },
    };

    await syncSuggestions({
      context,
      opportunity,
      newData: [incomingDomainWide],
      buildKey,
      mergeDataFunction,
      mapNewSuggestion: (d) => ({ data: d.data ?? d }),
      existingSuggestions: [existingDomainWide],
    });

    // Existing was updated in place — no duplicate created
    expect(saveMany).to.have.been.calledOnce;
    expect(addSuggestions).to.not.have.been.called;
    // Fresh aggregated data was applied
    expect(existingDomainWide.getData().contentGainRatio).to.equal(1.2);
    expect(existingDomainWide.getData().wordCountBefore).to.equal(15);
  });

  it('Case 6b — multiple OUTDATED domain-wide duplicates are all updated via buildKey match, no new one created', async () => {
    // Tests the buildKey fix path: when existing domain-wide suggestions are not
    // preservable (OUTDATED, no edgeDeployed), the new domain-wide IS in newData
    // and buildSuggestionKey matches all existing OUTDATED entries for update.
    const dup1 = makeSuggestion({
      isDomainWide: true,
      url: 'https://example.com/* (All Domain URLs)',
      contentGainRatio: 0.5,
    }, 'OUTDATED');
    const dup2 = makeSuggestion({
      isDomainWide: true,
      url: 'https://example.com/* (All Domain URLs)',
      contentGainRatio: 0.6,
    }, 'OUTDATED');
    const dup3 = makeSuggestion({
      isDomainWide: true,
      url: 'https://example.com/* (All Domain URLs)',
      contentGainRatio: 0.7,
    }, 'OUTDATED');

    const incomingDomainWide = {
      key: DOMAIN_WIDE_KEY,
      data: {
        isDomainWide: true,
        url: 'https://example.com/* (All Domain URLs)',
        contentGainRatio: 2.0,
      },
    };

    await syncSuggestions({
      context,
      opportunity,
      newData: [incomingDomainWide],
      buildKey,
      mergeDataFunction,
      mapNewSuggestion: (d) => ({ data: d.data ?? d }),
      existingSuggestions: [dup1, dup2, dup3],
    });

    // All three share the same buildKey, so all are matched and data-refreshed
    expect(saveMany).to.have.been.calledOnce;
    const savedSuggestions = saveMany.firstCall.args[0];
    expect(savedSuggestions).to.have.lengthOf(3);
    savedSuggestions.forEach((s) => {
      expect(s.getData().contentGainRatio).to.equal(2.0);
    });

    // No new suggestion created — the key is already present among existing
    expect(addSuggestions).to.not.have.been.called;

    // Domain-wide suggestions are protected by the isDomainWide guard in
    // handleOutdatedSuggestions, so bulkUpdateStatus must not be called for them
    const outdatedCall = bulkUpdateStatus.getCalls().find((c) => c.args[1] === 'OUTDATED');
    expect(outdatedCall).to.be.undefined;
  });

  it('Case 6c — multiple NEW domain-wide duplicates from a race are not outdated or duplicated further', async () => {
    // Reproduces the exact production incident: concurrent Lambdas created multiple
    // NEW domain-wide suggestions. On the next single-threaded audit run,
    // findPreservableDomainWideSuggestion finds one of them (NEW is preservable)
    // and excludes domain-wide from newData entirely. The isDomainWide guard in
    // handleOutdatedSuggestions must protect all NEW entries from being marked OUTDATED.
    const dup1 = makeSuggestion({ isDomainWide: true, url: 'https://example.com/* (All Domain URLs)' }, 'NEW');
    const dup2 = makeSuggestion({ isDomainWide: true, url: 'https://example.com/* (All Domain URLs)' }, 'NEW');
    const dup3 = makeSuggestion({ isDomainWide: true, url: 'https://example.com/* (All Domain URLs)' }, 'NEW');

    await syncSuggestions({
      context,
      opportunity,
      newData: [], // domain-wide excluded because findPreservableDomainWideSuggestion found a NEW one
      buildKey,
      mergeDataFunction,
      mapNewSuggestion: (d) => ({ data: d }),
      existingSuggestions: [dup1, dup2, dup3],
    });

    // isDomainWide guard in handleOutdatedSuggestions must protect all three NEW entries
    const outdatedCall = bulkUpdateStatus.getCalls().find((c) => c.args[1] === 'OUTDATED');
    expect(outdatedCall).to.be.undefined;
    // No new domain-wide created
    expect(addSuggestions).to.not.have.been.called;
    // No spurious data updates (nothing to match against in newData)
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
