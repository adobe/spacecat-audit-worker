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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';

use(sinonChai);

const WIKI_URL = 'https://en.wikipedia.org/wiki/Adobe_Inc.';

describe('lookup-index (shared foundation)', () => {
  const sandbox = sinon.createSandbox();
  let postgrestClient;
  let allByOpportunityIdStub;
  let context;
  let syncUrlIndexStub;
  let syncUrlIndexManyStub;
  let syncOpportunitySemanticStub;
  let indexOpportunityByUrl;
  let indexOpportunitySuggestionsByUrl;
  let indexOpportunityByTopic;

  const makeSuggestion = (id, urls = []) => ({ getId: () => id, urls });

  const makeOpportunity = () => ({
    getId: () => 'oppty-1',
    getSiteId: () => 'site-1',
  });

  const getUrls = sandbox.stub();
  const getSuggestionUrls = (suggestion) => suggestion.urls;

  beforeEach(async () => {
    postgrestClient = { from: sandbox.stub(), id: 'pg-client' };
    allByOpportunityIdStub = sandbox.stub().resolves([]);
    context = {
      dataAccess: {
        services: { postgrestClient },
        Suggestion: { allByOpportunityId: allByOpportunityIdStub },
      },
    };
    // Resolve counts derived from the submitted payload by default, so tests are not coupled to a
    // hardcoded return value that happens to match.
    syncUrlIndexStub = sandbox.stub().callsFake(async (_client, { urls }) => urls.length);
    syncUrlIndexManyStub = sandbox.stub()
      .callsFake(async (_client, { entries }) => new Map(entries.map((e) => [e.entityId, e])));
    syncOpportunitySemanticStub = sandbox.stub()
      .callsFake(async (_client, { sources }) => sources.length);
    getUrls.reset();
    ({
      indexOpportunityByUrl, indexOpportunitySuggestionsByUrl, indexOpportunityByTopic,
    } = await esmock(
      '../../src/common/lookup-index.js',
      {
        '@adobe/spacecat-shared-data-access': {
          syncUrlIndex: syncUrlIndexStub,
          syncUrlIndexMany: syncUrlIndexManyStub,
          syncOpportunitySemantic: syncOpportunitySemanticStub,
        },
      },
    ));
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('indexOpportunityByUrl', () => {
    it('syncs the opportunity and reports exactly what was submitted and what the writer returned', async () => {
      getUrls.returns([WIKI_URL]);
      const opportunity = makeOpportunity();

      const result = await indexOpportunityByUrl({
        context, opportunity, entityType: 'wikipedia-analysis', getUrls,
      });

      expect(result).to.deep.equal({
        opportunityId: 'oppty-1',
        submittedEntry: { entityId: 'oppty-1', urls: [WIKI_URL] },
        syncedIndexResult: 1,
      });
      expect(syncUrlIndexStub).to.have.been.calledOnceWith(postgrestClient, {
        table: 'opportunity_urls',
        siteId: 'site-1',
        entityId: 'oppty-1',
        entityType: 'wikipedia-analysis',
        urls: [WIKI_URL],
      });
    });

    it('still writes through with an empty array, as an explicit clear', async () => {
      getUrls.returns([]);
      const opportunity = makeOpportunity();

      const result = await indexOpportunityByUrl({
        context, opportunity, entityType: 'cited-analysis', getUrls,
      });

      expect(result.error).to.be.undefined;
      expect(result.submittedEntry.urls).to.deep.equal([]);
      expect(syncUrlIndexStub).to.have.been.calledOnce;
    });

    it('passes the writer\'s return value through verbatim, with no interpretation', async () => {
      getUrls.returns([WIKI_URL, 'https://example.com/two']);
      syncUrlIndexStub.resolves(1); // the writer only accepted one of the two submitted
      const opportunity = makeOpportunity();

      const result = await indexOpportunityByUrl({
        context, opportunity, entityType: 'wikipedia-analysis', getUrls,
      });

      expect(result.submittedEntry.urls).to.have.lengthOf(2);
      expect(result.syncedIndexResult).to.equal(1);
      expect(result).to.not.have.property('writeMismatch');
      expect(result).to.not.have.property('status');
    });

    it('fails with a client-unavailable error and never calls the writer when postgrestClient is missing', async () => {
      const opportunity = makeOpportunity();

      const result = await indexOpportunityByUrl({
        context: { dataAccess: { services: {} } }, opportunity, entityType: 'wikipedia-analysis', getUrls,
      });

      expect(result).to.have.all.keys('error');
      expect(result.error.message).to.equal('Failed to resolve postgrest client');
      expect(result.error.cause).to.be.undefined;
      expect(syncUrlIndexStub).to.not.have.been.called;
    });

    it('fails with a client-unavailable error when postgrestClient has no "from" method', async () => {
      const opportunity = makeOpportunity();

      const result = await indexOpportunityByUrl({
        context: { dataAccess: { services: { postgrestClient: {} } } },
        opportunity,
        entityType: 'wikipedia-analysis',
        getUrls,
      });

      expect(result.error.message).to.equal('Failed to resolve postgrest client');
    });

    it('wraps an extractor throw, naming the stage and preserving the original error as cause', async () => {
      const cause = new Error('extractor boom');
      const throwingGetUrls = sandbox.stub().throws(cause);
      const opportunity = makeOpportunity();

      const result = await indexOpportunityByUrl({
        context, opportunity, entityType: 'wikipedia-analysis', getUrls: throwingGetUrls,
      });

      expect(result).to.have.all.keys('error');
      expect(result.error.message).to.equal('Failed to extract URLs');
      expect(result.error.cause).to.equal(cause);
      expect(syncUrlIndexStub).to.not.have.been.called;
    });

    it('fails as NO_INDEXABLE_URLS, not as an empty clear, when candidates were non-empty but none survived hygiene', async () => {
      getUrls.returns(['not a url', 42, 'ftp://also-invalid.example.com']);
      const opportunity = makeOpportunity();

      const result = await indexOpportunityByUrl({
        context, opportunity, entityType: 'wikipedia-analysis', getUrls,
      });

      expect(result).to.have.all.keys('error');
      expect(result.error.message).to.equal('Extraction returned candidates but none were indexable');
      expect(syncUrlIndexStub).to.not.have.been.called;
    });

    it('fails as EXTRACT_URLS_FAILED when getUrls does not return an array', async () => {
      getUrls.returns('https://example.com/not-an-array');
      const opportunity = makeOpportunity();

      const result = await indexOpportunityByUrl({
        context, opportunity, entityType: 'wikipedia-analysis', getUrls,
      });

      expect(result).to.have.all.keys('error');
      expect(result.error.message).to.equal('Failed to extract URLs');
      expect(syncUrlIndexStub).to.not.have.been.called;
    });

    it('still writes through an explicit clear when getUrls itself returns nothing', async () => {
      getUrls.returns([]);
      const opportunity = makeOpportunity();

      const result = await indexOpportunityByUrl({
        context, opportunity, entityType: 'wikipedia-analysis', getUrls,
      });

      expect(result.error).to.be.undefined;
      expect(syncUrlIndexStub).to.have.been.calledOnce;
    });

    it('wraps a rejected write, naming the stage and preserving the original error as cause', async () => {
      getUrls.returns([WIKI_URL]);
      const cause = new Error('postgrest boom');
      syncUrlIndexStub.rejects(cause);
      const opportunity = makeOpportunity();

      const result = await indexOpportunityByUrl({
        context, opportunity, entityType: 'wikipedia-analysis', getUrls,
      });

      expect(result.error.message).to.equal('Failed to sync the URL index');
      expect(result.error.cause).to.equal(cause);
    });

    it('filters getUrls\' return value through the shared hygiene gate before submitting', async () => {
      getUrls.returns([WIKI_URL, 'https://user:pass@example.com/leak', 'not a url']);
      const opportunity = makeOpportunity();

      const result = await indexOpportunityByUrl({
        context, opportunity, entityType: 'wikipedia-analysis', getUrls,
      });

      expect(result.submittedEntry.urls).to.deep.equal([WIKI_URL]);
      expect(syncUrlIndexStub).to.have.been.calledOnceWith(postgrestClient, sinon.match({
        urls: [WIKI_URL],
      }));
    });

    it('wraps a throw from opportunity.getId(), naming the write stage', async () => {
      getUrls.returns([WIKI_URL]);
      const cause = new Error('getId boom');
      const opportunity = {
        getId: sandbox.stub().throws(cause),
        getSiteId: () => 'site-1',
      };

      const result = await indexOpportunityByUrl({
        context, opportunity, entityType: 'wikipedia-analysis', getUrls,
      });

      expect(result.error.message).to.equal('Failed to sync the URL index');
      expect(result.error.cause).to.equal(cause);
      expect(syncUrlIndexStub).to.not.have.been.called;
    });
  });

  describe('indexOpportunitySuggestionsByUrl', () => {
    it('syncs every suggestion in one batch and reports exactly what was submitted', async () => {
      const suggestions = [makeSuggestion('sugg-1', [WIKI_URL]), makeSuggestion('sugg-2', [WIKI_URL])];
      allByOpportunityIdStub.resolves(suggestions);
      const opportunity = makeOpportunity();

      const result = await indexOpportunitySuggestionsByUrl({
        context, opportunity, entityType: 'wikipedia-analysis', getUrls: getSuggestionUrls,
      });

      const submittedEntries = [
        { entityId: 'sugg-1', urls: [WIKI_URL] },
        { entityId: 'sugg-2', urls: [WIKI_URL] },
      ];
      expect(result.opportunityId).to.equal('oppty-1');
      expect(result.submittedEntries).to.deep.equal(submittedEntries);
      expect(result.syncedIndexResult).to.be.instanceOf(Map);
      expect(result.syncedIndexResult.size).to.equal(2);
      expect(allByOpportunityIdStub).to.have.been.calledOnceWith('oppty-1');
      expect(syncUrlIndexManyStub).to.have.been.calledOnceWith(postgrestClient, {
        table: 'suggestion_urls',
        siteId: 'site-1',
        entityType: 'wikipedia-analysis',
        entries: submittedEntries,
      });
    });

    it('reads suggestions directly from the collection rather than a memoized opportunity accessor', async () => {
      // Regression guard for the stale-cache bug: `opportunity.getSuggestions()` is memoized per
      // instance by the shared data-access layer and can already be warm (e.g. from an earlier
      // `syncSuggestions` call in the same persist path) with a snapshot that predates suggestions
      // this run just created or deleted. This opportunity's own `getSuggestions` (if it had one)
      // must never be consulted - only the collection query result matters.
      const staleSuggestions = [makeSuggestion('stale-sugg', [])];
      const freshSuggestions = [makeSuggestion('fresh-sugg', [WIKI_URL])];
      allByOpportunityIdStub.resolves(freshSuggestions);
      const opportunity = {
        ...makeOpportunity(),
        getSuggestions: sandbox.stub().resolves(staleSuggestions),
      };

      const result = await indexOpportunitySuggestionsByUrl({
        context, opportunity, entityType: 'wikipedia-analysis', getUrls: getSuggestionUrls,
      });

      expect(opportunity.getSuggestions).to.not.have.been.called;
      expect(result.submittedEntries).to.deep.equal([
        { entityId: 'fresh-sugg', urls: [WIKI_URL] },
      ]);
    });

    it('calls getUrls with only the suggestion, not the opportunity', async () => {
      const singleArgGetUrls = sandbox.stub().returns([]);
      const suggestion = makeSuggestion('sugg-1', []);
      allByOpportunityIdStub.resolves([suggestion]);
      const opportunity = makeOpportunity();

      await indexOpportunitySuggestionsByUrl({
        context, opportunity, entityType: 'wikipedia-analysis', getUrls: singleArgGetUrls,
      });

      // Identity, not shape - a shape matcher would also accept `opportunity` by mistake, since
      // both objects expose a `getId` method.
      expect(singleArgGetUrls).to.have.been.calledOnceWithExactly(suggestion);
    });

    it('includes a zero-url suggestion in the batch as an explicit clear, not omitted', async () => {
      allByOpportunityIdStub.resolves([makeSuggestion('sugg-1', [])]);
      const opportunity = makeOpportunity();

      const result = await indexOpportunitySuggestionsByUrl({
        context, opportunity, entityType: 'wikipedia-analysis', getUrls: getSuggestionUrls,
      });

      expect(result.submittedEntries).to.deep.equal([
        { entityId: 'sugg-1', urls: [] },
      ]);
      expect(syncUrlIndexManyStub).to.have.been.calledOnceWith(postgrestClient, {
        table: 'suggestion_urls',
        siteId: 'site-1',
        entityType: 'wikipedia-analysis',
        entries: [{ entityId: 'sugg-1', urls: [] }],
      });
    });

    it('skips the batched write when there are no suggestions, and syncedIndexResult is undefined', async () => {
      allByOpportunityIdStub.resolves([]);
      const opportunity = makeOpportunity();

      const result = await indexOpportunitySuggestionsByUrl({
        context, opportunity, entityType: 'wikipedia-analysis', getUrls: getSuggestionUrls,
      });

      expect(result).to.deep.equal({
        opportunityId: 'oppty-1',
        submittedEntries: [],
        syncedIndexResult: undefined,
      });
      expect(syncUrlIndexManyStub).to.not.have.been.called;
    });

    it('passes the writer\'s return value through verbatim, with no interpretation', async () => {
      const writtenMap = new Map();
      syncUrlIndexManyStub.resolves(writtenMap); // the writer only acknowledged zero of the two
      allByOpportunityIdStub.resolves(
        [makeSuggestion('sugg-1', [WIKI_URL]), makeSuggestion('sugg-2', [])],
      );
      const opportunity = makeOpportunity();

      const result = await indexOpportunitySuggestionsByUrl({
        context, opportunity, entityType: 'wikipedia-analysis', getUrls: getSuggestionUrls,
      });

      expect(result.submittedEntries).to.have.lengthOf(2);
      expect(result.syncedIndexResult).to.equal(writtenMap);
      expect(result).to.not.have.property('writeMismatch');
      expect(result).to.not.have.property('skippedSuggestionCount');
    });

    it('filters each suggestion\'s getUrls return value through the shared hygiene gate', async () => {
      allByOpportunityIdStub.resolves([
        makeSuggestion('sugg-1', [WIKI_URL, 'https://user:pass@example.com/leak']),
      ]);
      const opportunity = makeOpportunity();

      const result = await indexOpportunitySuggestionsByUrl({
        context, opportunity, entityType: 'wikipedia-analysis', getUrls: getSuggestionUrls,
      });

      expect(result.submittedEntries).to.deep.equal([
        { entityId: 'sugg-1', urls: [WIKI_URL] },
      ]);
    });

    it('skips a suggestion whose candidates were non-empty but none survived hygiene, rather than clearing its rows or aborting the batch', async () => {
      allByOpportunityIdStub.resolves([makeSuggestion('sugg-1', ['not a url', 42])]);
      const opportunity = makeOpportunity();

      const result = await indexOpportunitySuggestionsByUrl({
        context, opportunity, entityType: 'wikipedia-analysis', getUrls: getSuggestionUrls,
      });

      expect(result.error).to.be.undefined;
      expect(result.submittedEntries).to.deep.equal([]);
      // Nothing submitted for the one (skipped) suggestion, so the writer is never called and its
      // existing rows are left untouched - not cleared, as a `urls: []` submission would do.
      expect(syncUrlIndexManyStub).to.not.have.been.called;
    });

    it('skips only the unindexable suggestion and still submits its healthy siblings', async () => {
      allByOpportunityIdStub.resolves([
        makeSuggestion('sugg-bad', ['not a url', 42]),
        makeSuggestion('sugg-good', [WIKI_URL]),
      ]);
      const opportunity = makeOpportunity();

      const result = await indexOpportunitySuggestionsByUrl({
        context, opportunity, entityType: 'wikipedia-analysis', getUrls: getSuggestionUrls,
      });

      expect(result.error).to.be.undefined;
      expect(result.submittedEntries).to.deep.equal([{ entityId: 'sugg-good', urls: [WIKI_URL] }]);
      expect(syncUrlIndexManyStub).to.have.been.calledOnceWith(postgrestClient, sinon.match({
        entries: [{ entityId: 'sugg-good', urls: [WIKI_URL] }],
      }));
    });

    it('aborts the whole batch on a genuine extractor throw, unlike a hygiene-only rejection', async () => {
      const cause = new Error('extractor boom');
      const throwingGetUrls = sandbox.stub()
        .onFirstCall()
        .throws(cause)
        .onSecondCall()
        .returns([WIKI_URL]);
      allByOpportunityIdStub.resolves([
        makeSuggestion('sugg-1', []),
        makeSuggestion('sugg-2', []),
      ]);
      const opportunity = makeOpportunity();

      const result = await indexOpportunitySuggestionsByUrl({
        context, opportunity, entityType: 'wikipedia-analysis', getUrls: throwingGetUrls,
      });

      expect(result.error.message).to.equal('Failed to extract URLs');
      expect(result.error.cause).to.equal(cause);
      expect(syncUrlIndexManyStub).to.not.have.been.called;
    });

    it('fails as EXTRACT_URLS_FAILED when a suggestion\'s getUrls does not return an array', async () => {
      allByOpportunityIdStub.resolves([makeSuggestion('sugg-1', [])]);
      const nonArrayGetUrls = sandbox.stub().returns('https://example.com/not-an-array');
      const opportunity = makeOpportunity();

      const result = await indexOpportunitySuggestionsByUrl({
        context, opportunity, entityType: 'wikipedia-analysis', getUrls: nonArrayGetUrls,
      });

      expect(result).to.have.all.keys('error');
      expect(result.error.message).to.equal('Failed to extract URLs');
      expect(syncUrlIndexManyStub).to.not.have.been.called;
    });

    it('fails as FETCH_SUGGESTIONS_FAILED when allByOpportunityId resolves a non-array', async () => {
      allByOpportunityIdStub.resolves(undefined);
      const opportunity = makeOpportunity();

      const result = await indexOpportunitySuggestionsByUrl({
        context, opportunity, entityType: 'wikipedia-analysis', getUrls: getSuggestionUrls,
      });

      expect(result).to.have.all.keys('error');
      expect(result.error.message).to.equal('Failed to fetch suggestions');
      expect(syncUrlIndexManyStub).to.not.have.been.called;
    });

    it('wraps a throwing suggestion.getId(), naming the extraction stage', async () => {
      const cause = new Error('getId boom');
      allByOpportunityIdStub.resolves([{
        getId: sandbox.stub().throws(cause),
        urls: [WIKI_URL],
      }]);
      const opportunity = makeOpportunity();

      const result = await indexOpportunitySuggestionsByUrl({
        context, opportunity, entityType: 'wikipedia-analysis', getUrls: getSuggestionUrls,
      });

      expect(result.error.message).to.equal('Failed to extract URLs');
      expect(result.error.cause).to.equal(cause);
      expect(syncUrlIndexManyStub).to.not.have.been.called;
    });

    it('fails with a client-unavailable error and never fetches suggestions when postgrestClient is missing', async () => {
      const opportunity = makeOpportunity();

      const result = await indexOpportunitySuggestionsByUrl({
        context: {
          dataAccess: { services: {}, Suggestion: { allByOpportunityId: allByOpportunityIdStub } },
        },
        opportunity,
        entityType: 'wikipedia-analysis',
        getUrls: getSuggestionUrls,
      });

      expect(result).to.have.all.keys('error');
      expect(result.error.message).to.equal('Failed to resolve postgrest client');
      expect(allByOpportunityIdStub).to.not.have.been.called;
    });

    it('wraps a rejected suggestion fetch, naming the stage and preserving the cause', async () => {
      const cause = new Error('allByOpportunityId boom');
      allByOpportunityIdStub.rejects(cause);
      const opportunity = makeOpportunity();

      const result = await indexOpportunitySuggestionsByUrl({
        context, opportunity, entityType: 'wikipedia-analysis', getUrls: getSuggestionUrls,
      });

      expect(result.error.message).to.equal('Failed to fetch suggestions');
      expect(result.error.cause).to.equal(cause);
      expect(syncUrlIndexManyStub).to.not.have.been.called;
    });

    it('wraps a throwing suggestion extractor, naming the stage and preserving the cause', async () => {
      const cause = new Error('suggestion extractor boom');
      const throwingGetUrls = sandbox.stub().throws(cause);
      allByOpportunityIdStub.resolves([makeSuggestion('sugg-1', [WIKI_URL])]);
      const opportunity = makeOpportunity();

      const result = await indexOpportunitySuggestionsByUrl({
        context, opportunity, entityType: 'wikipedia-analysis', getUrls: throwingGetUrls,
      });

      expect(result.error.message).to.equal('Failed to extract URLs');
      expect(result.error.cause).to.equal(cause);
      expect(syncUrlIndexManyStub).to.not.have.been.called;
    });

    it('wraps a rejected batched write, naming the stage and preserving the cause', async () => {
      const cause = new Error('batch boom');
      syncUrlIndexManyStub.rejects(cause);
      allByOpportunityIdStub.resolves([makeSuggestion('sugg-1', [WIKI_URL])]);
      const opportunity = makeOpportunity();

      const result = await indexOpportunitySuggestionsByUrl({
        context, opportunity, entityType: 'wikipedia-analysis', getUrls: getSuggestionUrls,
      });

      expect(result.error.message).to.equal('Failed to sync the URL index');
      expect(result.error.cause).to.equal(cause);
    });
  });

  describe('indexOpportunityByTopic', () => {
    const getTitles = sandbox.stub();
    let embeddingClient;

    beforeEach(() => {
      getTitles.reset();
      embeddingClient = {
        createEmbeddings: sandbox.stub()
          .callsFake(async (inputs) => inputs.map((_t, i) => [i, i + 1])),
      };
    });

    it('embeds the topics and full-replaces the opportunity vectors, reporting what was submitted', async () => {
      getTitles.returns([{ id: 't1', title: 'Pricing' }, { id: 't2', title: 'Support' }]);
      const opportunity = makeOpportunity();

      const result = await indexOpportunityByTopic({
        context, opportunity, entityType: 'cited-analysis', getTitles, embeddingClient,
      });

      expect(result).to.deep.equal({
        opportunityId: 'oppty-1',
        submittedEntry: { entityId: 'oppty-1', sourceType: 'topic', topicCount: 2 },
        syncedIndexResult: 2,
      });
      expect(embeddingClient.createEmbeddings).to.have.been.calledOnceWith(['Pricing', 'Support']);
      // native dims: no dimensions arg
      expect(embeddingClient.createEmbeddings.firstCall.args[1]).to.equal(undefined);
      expect(syncOpportunitySemanticStub).to.have.been.calledOnceWith(postgrestClient, {
        siteId: 'site-1',
        entityId: 'oppty-1',
        entityType: 'cited-analysis',
        sourceType: 'topic',
        sources: [
          {
            text: 'Pricing', vector: [0, 1], model: 'azure/text-embedding-3-small', dims: 1536, sourceId: 't1',
          },
          {
            text: 'Support', vector: [1, 2], model: 'azure/text-embedding-3-small', dims: 1536, sourceId: 't2',
          },
        ],
      });
    });

    it('fails with EMBED_TOPICS_FAILED when the embedding count does not match the inputs', async () => {
      getTitles.returns([{ id: 't1', title: 'Pricing' }, { id: 't2', title: 'Support' }]);
      embeddingClient.createEmbeddings.resolves([[0, 1]]); // one vector for two inputs

      const result = await indexOpportunityByTopic({
        context, opportunity: makeOpportunity(), entityType: 'cited-analysis', getTitles, embeddingClient,
      });

      expect(result.error.message).to.equal('Failed to embed topics');
      expect(result.error.cause.message).to.equal('Vector count mismatch: expected 2, got 1');
      expect(syncOpportunitySemanticStub).to.not.have.been.called;
    });

    it('clears (empty sources, no embed) when the opportunity genuinely has no topics', async () => {
      getTitles.returns([]);
      const opportunity = makeOpportunity();

      const result = await indexOpportunityByTopic({
        context, opportunity, entityType: 'cited-analysis', getTitles, embeddingClient,
      });

      expect(result).to.deep.equal({
        opportunityId: 'oppty-1',
        submittedEntry: { entityId: 'oppty-1', sourceType: 'topic', topicCount: 0 },
        syncedIndexResult: 0,
      });
      expect(embeddingClient.createEmbeddings).to.not.have.been.called;
      expect(syncOpportunitySemanticStub.firstCall.args[1].sources).to.deep.equal([]);
    });

    it('fails with RESOLVE_POSTGREST_CLIENT_FAILED when the client is missing', async () => {
      const result = await indexOpportunityByTopic({
        context: { dataAccess: { services: {} } },
        opportunity: makeOpportunity(),
        entityType: 'cited-analysis',
        getTitles,
        embeddingClient,
      });
      expect(result.error.message).to.equal('Failed to resolve postgrest client');
      expect(getTitles).to.not.have.been.called;
    });

    it('fails with EXTRACT_TOPICS_FAILED when getTitles returns a non-array', async () => {
      getTitles.returns('nope');
      const result = await indexOpportunityByTopic({
        context, opportunity: makeOpportunity(), entityType: 'cited-analysis', getTitles, embeddingClient,
      });
      expect(result.error.message).to.equal('Failed to extract topics');
    });

    it('fails with EXTRACT_TOPICS_FAILED (with cause) when getTitles throws', async () => {
      const cause = new Error('boom');
      getTitles.throws(cause);
      const result = await indexOpportunityByTopic({
        context, opportunity: makeOpportunity(), entityType: 'cited-analysis', getTitles, embeddingClient,
      });
      expect(result.error.message).to.equal('Failed to extract topics');
      expect(result.error.cause).to.equal(cause);
    });

    it('fails with NO_INDEXABLE_TOPICS when candidates exist but none survive hygiene', async () => {
      getTitles.returns([{ id: 't1', title: '  ' }, { id: 't2' }]);
      const result = await indexOpportunityByTopic({
        context, opportunity: makeOpportunity(), entityType: 'cited-analysis', getTitles, embeddingClient,
      });
      expect(result.error.message).to.equal('Extraction returned topic candidates but none were indexable');
      expect(embeddingClient.createEmbeddings).to.not.have.been.called;
    });

    it('fails with EMBED_TOPICS_FAILED (with cause) when embedding throws', async () => {
      getTitles.returns([{ id: 't1', title: 'Pricing' }]);
      const cause = new Error('azure down');
      embeddingClient.createEmbeddings.rejects(cause);
      const result = await indexOpportunityByTopic({
        context, opportunity: makeOpportunity(), entityType: 'cited-analysis', getTitles, embeddingClient,
      });
      expect(result.error.message).to.equal('Failed to embed topics');
      expect(result.error.cause).to.equal(cause);
      expect(syncOpportunitySemanticStub).to.not.have.been.called;
    });

    it('fails with SYNC_SEMANTIC_INDEX_FAILED (with cause) when the writer throws', async () => {
      getTitles.returns([{ id: 't1', title: 'Pricing' }]);
      const cause = new Error('pg boom');
      syncOpportunitySemanticStub.rejects(cause);
      const result = await indexOpportunityByTopic({
        context, opportunity: makeOpportunity(), entityType: 'cited-analysis', getTitles, embeddingClient,
      });
      expect(result.error.message).to.equal('Failed to sync the semantic index');
      expect(result.error.cause).to.equal(cause);
    });
  });
});
