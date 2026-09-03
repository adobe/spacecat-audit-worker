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

describe('url-index', () => {
  const sandbox = sinon.createSandbox();
  let syncUrlIndexStub;
  let syncUrlIndexManyStub;
  let syncOpportunityUrlIndex;

  const makeSuggestion = (id) => ({ getId: () => id });

  const makeOpportunity = ({ data, suggestions = [] }) => ({
    getId: () => 'oppty-1',
    getSiteId: () => 'site-1',
    getData: () => data,
    getSuggestions: sandbox.stub().resolves(suggestions),
  });

  const makeContext = () => ({
    dataAccess: { services: { postgrestClient: { id: 'pg-client' } } },
    log: { debug: sandbox.stub(), warn: sandbox.stub() },
  });

  beforeEach(async () => {
    syncUrlIndexStub = sandbox.stub().resolves(1);
    syncUrlIndexManyStub = sandbox.stub().resolves(new Map());
    ({ syncOpportunityUrlIndex } = await esmock('../../src/common/url-index.js', {
      '@adobe/spacecat-shared-data-access': {
        syncUrlIndex: syncUrlIndexStub,
        syncUrlIndexMany: syncUrlIndexManyStub,
      },
    }));
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('indexes the opportunity singly and its suggestions in one batched call', async () => {
    const context = makeContext();
    const opportunity = makeOpportunity({
      data: { fullAnalysis: { wikipediaUrl: WIKI_URL } },
      suggestions: [makeSuggestion('sugg-1'), makeSuggestion('sugg-2')],
    });

    await syncOpportunityUrlIndex({ context, opportunity, auditType: 'wikipedia-analysis' });

    expect(syncUrlIndexStub).to.have.been.calledOnceWith(
      context.dataAccess.services.postgrestClient,
      {
        table: 'opportunity_urls',
        siteId: 'site-1',
        entityId: 'oppty-1',
        entityType: 'wikipedia-analysis',
        urls: [WIKI_URL],
      },
    );
    expect(syncUrlIndexManyStub).to.have.been.calledOnceWith(
      context.dataAccess.services.postgrestClient,
      {
        table: 'suggestion_urls',
        siteId: 'site-1',
        entityType: 'wikipedia-analysis',
        entries: [
          { entityId: 'sugg-1', urls: [WIKI_URL] },
          { entityId: 'sugg-2', urls: [WIKI_URL] },
        ],
      },
    );
    expect(context.log.debug).to.have.been.calledOnce;
    expect(context.log.warn).to.not.have.been.called;
  });

  it('clears (empty urls) for the opportunity and suggestions when no source url is extracted', async () => {
    const context = makeContext();
    const opportunity = makeOpportunity({
      data: {}, // no fullAnalysis at all
      suggestions: [makeSuggestion('sugg-1')],
    });

    await syncOpportunityUrlIndex({ context, opportunity, auditType: 'wikipedia-analysis' });

    expect(syncUrlIndexStub.getCall(0).args[1].urls).to.deep.equal([]);
    expect(syncUrlIndexManyStub).to.have.been.calledOnceWith(
      context.dataAccess.services.postgrestClient,
      {
        table: 'suggestion_urls',
        siteId: 'site-1',
        entityType: 'wikipedia-analysis',
        entries: [{ entityId: 'sugg-1', urls: [] }],
      },
    );
  });

  it('skips the batched suggestion call when there are no suggestions', async () => {
    const context = makeContext();
    const opportunity = makeOpportunity({
      data: { fullAnalysis: { wikipediaUrl: WIKI_URL } },
      suggestions: [],
    });

    await syncOpportunityUrlIndex({ context, opportunity, auditType: 'wikipedia-analysis' });

    expect(syncUrlIndexStub).to.have.been.calledOnce;
    expect(syncUrlIndexManyStub).to.not.have.been.called;
    expect(context.log.debug).to.have.been.calledOnce;
    expect(context.log.warn).to.not.have.been.called;
  });

  it('is a no-op for audit types without a registered extractor', async () => {
    const context = makeContext();
    const opportunity = makeOpportunity({ data: { fullAnalysis: { wikipediaUrl: WIKI_URL } } });

    await syncOpportunityUrlIndex({ context, opportunity, auditType: 'cited-analysis' });

    expect(syncUrlIndexStub).to.not.have.been.called;
    expect(syncUrlIndexManyStub).to.not.have.been.called;
    expect(opportunity.getSuggestions).to.not.have.been.called;
  });

  it('swallows an opportunity-index failure and labels the phase', async () => {
    const context = makeContext();
    syncUrlIndexStub.rejects(new Error('postgrest boom'));
    const opportunity = makeOpportunity({
      data: { fullAnalysis: { wikipediaUrl: WIKI_URL } },
      suggestions: [makeSuggestion('sugg-1')],
    });

    // Must resolve (not reject) despite the underlying failure.
    await syncOpportunityUrlIndex({ context, opportunity, auditType: 'wikipedia-analysis' });

    expect(context.log.warn).to.have.been.calledOnce;
    const line = context.log.warn.firstCall.args[0];
    expect(line).to.include('event=url_index_sync');
    expect(line).to.include('outcome=failure');
    expect(line).to.include('phase=opportunity-index');
    expect(line).to.include('postgrest boom');
    expect(line).to.include('oppty-1');
    // Opportunity sync threw, so suggestions are never fetched or indexed.
    expect(opportunity.getSuggestions).to.not.have.been.called;
    expect(syncUrlIndexManyStub).to.not.have.been.called;
    expect(context.log.debug).to.not.have.been.called;
  });

  it('swallows a suggestion-fetch failure and labels the phase', async () => {
    const context = makeContext();
    const opportunity = makeOpportunity({ data: { fullAnalysis: { wikipediaUrl: WIKI_URL } } });
    opportunity.getSuggestions.rejects(new Error('getSuggestions boom'));

    await syncOpportunityUrlIndex({ context, opportunity, auditType: 'wikipedia-analysis' });

    expect(syncUrlIndexStub).to.have.been.calledOnce; // opportunity indexed before the failure
    expect(syncUrlIndexManyStub).to.not.have.been.called;
    expect(context.log.warn).to.have.been.calledOnce;
    const line = context.log.warn.firstCall.args[0];
    expect(line).to.include('phase=suggestion-fetch');
    expect(line).to.include('getSuggestions boom');
    expect(context.log.debug).to.not.have.been.called;
  });

  it('swallows a suggestion-index failure and labels the phase', async () => {
    const context = makeContext();
    syncUrlIndexManyStub.rejects(new Error('batch boom'));
    const opportunity = makeOpportunity({
      data: { fullAnalysis: { wikipediaUrl: WIKI_URL } },
      suggestions: [makeSuggestion('sugg-1')],
    });

    await syncOpportunityUrlIndex({ context, opportunity, auditType: 'wikipedia-analysis' });

    expect(context.log.warn).to.have.been.calledOnce;
    const line = context.log.warn.firstCall.args[0];
    expect(line).to.include('phase=suggestion-index');
    expect(line).to.include('batch boom');
    expect(context.log.debug).to.not.have.been.called;
  });
});
