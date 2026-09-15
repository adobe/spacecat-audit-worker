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
import { createOffsiteLogger } from '../../src/utils/offsite-logging.js';

use(sinonChai);

const WIKI_URL = 'https://en.wikipedia.org/wiki/Adobe_Inc.';

describe('offsite-lookup-index (offsite integration with the shared foundation)', () => {
  const sandbox = sinon.createSandbox();
  const context = { dataAccess: { services: { postgrestClient: { id: 'pg-client' } } } };
  const opportunity = { getId: () => 'oppty-1' };
  const getOpportunityUrls = () => [];
  const getSuggestionUrls = () => [];
  let indexOpportunityByUrlStub;
  let indexOpportunitySuggestionsByUrlStub;
  let indexOffsiteOpportunityByUrl;
  let logStub;
  let olog;

  const load = async () => {
    ({ indexOffsiteOpportunityByUrl } = await esmock('../../src/common/offsite-lookup-index.js', {
      '../../src/common/lookup-index.js': {
        indexOpportunityByUrl: indexOpportunityByUrlStub,
        indexOpportunitySuggestionsByUrl: indexOpportunitySuggestionsByUrlStub,
      },
    }));
  };

  const run = () => indexOffsiteOpportunityByUrl({
    context, opportunity, auditType: 'wikipedia-analysis', getOpportunityUrls, getSuggestionUrls, olog,
  });

  beforeEach(() => {
    indexOpportunityByUrlStub = sandbox.stub().resolves({
      opportunityId: 'oppty-1',
      submittedEntry: { entityId: 'oppty-1', urls: [WIKI_URL] },
      syncedIndexResult: 1,
    });
    indexOpportunitySuggestionsByUrlStub = sandbox.stub().resolves({
      opportunityId: 'oppty-1',
      submittedEntries: [{ entityId: 'sugg-1', urls: [WIKI_URL] }],
      // Map value is `syncUrlIndexMany`'s own per-entity URL count (batched equivalent of
      // `syncUrlIndex`'s return value), not an opaque placeholder.
      syncedIndexResult: new Map([['sugg-1', 1]]),
    });
    logStub = {
      debug: sandbox.stub(), warn: sandbox.stub(), info: sandbox.stub(), error: sandbox.stub(),
    };
    olog = createOffsiteLogger(logStub, {
      audit: 'wikipedia', siteId: 'site-1', auditId: 'audit-1', opportunityId: 'oppty-1',
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('delegates to both shared-foundation functions with entityType and the given extractors', async () => {
    await load();
    await run();

    expect(indexOpportunityByUrlStub).to.have.been.calledOnceWith({
      context, opportunity, entityType: 'wikipedia-analysis', getUrls: getOpportunityUrls,
    });
    expect(indexOpportunitySuggestionsByUrlStub).to.have.been.calledOnce;
    const suggestionsArg = indexOpportunitySuggestionsByUrlStub.firstCall.args[0];
    expect(suggestionsArg.context).to.equal(context);
    expect(suggestionsArg.opportunity).to.equal(opportunity);
    expect(suggestionsArg.entityType).to.equal('wikipedia-analysis');
    // getUrls is a wrapper (so a handler's extractor can still reach the opportunity), not the
    // caller-supplied getSuggestionUrls itself.
    expect(suggestionsArg.getUrls).to.be.a('function');
    expect(suggestionsArg.getUrls).to.not.equal(getSuggestionUrls);
  });

  it('curries the opportunity into getSuggestionUrls, so a two-argument extractor still works', async () => {
    const twoArgGetSuggestionUrls = sandbox.stub().returns(['https://example.com/a']);
    await load();

    await indexOffsiteOpportunityByUrl({
      context,
      opportunity,
      auditType: 'wikipedia-analysis',
      getOpportunityUrls,
      getSuggestionUrls: twoArgGetSuggestionUrls,
      olog,
    });

    const suggestionsArg = indexOpportunitySuggestionsByUrlStub.firstCall.args[0];
    const suggestion = { getId: () => 'sugg-1' };
    suggestionsArg.getUrls(suggestion);
    expect(twoArgGetSuggestionUrls).to.have.been.calledOnceWith(suggestion, opportunity);
  });

  it('always logs a start and end line bracketing the sync', async () => {
    await load();
    await run();

    const startLine = logStub.info.args.map((a) => a[0]).find((l) => l.includes('event=audit_funneling_start'));
    expect(startLine).to.exist;
    expect(startLine).to.include('outcome=start');
    expect(startLine).to.include('[offsite:wikipedia]');

    const endLine = logStub.info.args.map((a) => a[0]).find((l) => l.includes('event=audit_funneling_end'));
    expect(endLine).to.exist;
    expect(endLine).to.include('outcome=success');
  });

  it('derives the opportunity-level counts from the raw submitted entry and the raw writer result', async () => {
    await load();
    await run();

    expect(logStub.warn).to.not.have.been.called;
    const lines = logStub.info.args.map((a) => a[0]);
    const opportunityLine = lines.find((l) => l.includes('event=audit_funneling_index_url_synced')
      && !l.includes('submittedSuggestionCount'));
    expect(opportunityLine).to.include('outcome=success');
    expect(opportunityLine).to.include('auditType=wikipedia-analysis');
    expect(opportunityLine).to.include('submittedUrlCount=1');
    expect(opportunityLine).to.include('syncedUrlCount=1');
  });

  it('derives the suggestions-level counts from the raw submitted entries and the raw writer result', async () => {
    await load();
    await run();

    const lines = logStub.info.args.map((a) => a[0]);
    const suggestionsLine = lines.find((l) => l.includes('submittedSuggestionCount'));
    expect(suggestionsLine).to.include('outcome=success');
    expect(suggestionsLine).to.include('submittedSuggestionCount=1');
    expect(suggestionsLine).to.include('submittedUrlCount=1');
    expect(suggestionsLine).to.include('syncedUrlCount=1');
    // `syncedSuggestionCount` is deliberately not emitted: `syncUrlIndexMany` sets a Map entry
    // for every submitted entry before any write happens, so it can never differ from
    // `submittedSuggestionCount` and would carry no signal.
    expect(suggestionsLine).to.not.include('syncedSuggestionCount');
  });

  it('counts a suggestion with no urls as unmatched, without dropping it from the submitted count', async () => {
    indexOpportunitySuggestionsByUrlStub.resolves({
      opportunityId: 'oppty-1',
      submittedEntries: [
        { entityId: 'sugg-1', urls: [WIKI_URL] },
        { entityId: 'sugg-2', urls: [] },
      ],
      syncedIndexResult: new Map([['sugg-1', 1], ['sugg-2', 0]]),
    });
    await load();
    await run();

    const suggestionsLine = logStub.info.args.map((a) => a[0])
      .find((l) => l.includes('submittedSuggestionCount'));
    expect(suggestionsLine).to.include('submittedSuggestionCount=2');
    expect(suggestionsLine).to.include('submittedUrlCount=1');
    expect(suggestionsLine).to.include('syncedUrlCount=1');
  });

  it('reports zero synced (not a false match) when there is nothing to submit at the suggestions level', async () => {
    indexOpportunitySuggestionsByUrlStub.resolves({
      opportunityId: 'oppty-1',
      submittedEntries: [],
      syncedIndexResult: undefined,
    });
    await load();
    await run();

    expect(logStub.warn).to.not.have.been.called;
    const suggestionsLine = logStub.info.args.map((a) => a[0])
      .find((l) => l.includes('submittedSuggestionCount'));
    expect(suggestionsLine).to.include('outcome=success');
    expect(suggestionsLine).to.include('submittedSuggestionCount=0');
    expect(suggestionsLine).to.include('syncedUrlCount=0');
  });

  it('does not report a false match when something was submitted at the opportunity level but the writer result is unrecognized', async () => {
    indexOpportunityByUrlStub.resolves({
      opportunityId: 'oppty-1',
      submittedEntry: { entityId: 'oppty-1', urls: [WIKI_URL] },
      syncedIndexResult: undefined,
    });
    await load();
    await run();

    const lines = logStub.warn.args.map((a) => a[0]);
    const opportunityLine = lines.find((l) => l.includes('event=audit_funneling_index_url_synced'));
    expect(opportunityLine).to.exist;
    expect(opportunityLine).to.include('outcome=degraded');
    expect(opportunityLine).to.include('submittedUrlCount=1');
    // Not `syncedUrlCount=1` — that would misreport an unknown outcome as a clean match.
    expect(opportunityLine).to.not.include('syncedUrlCount=');
  });

  it('does not report a false match when something was submitted at the suggestions level but the writer result is unrecognized', async () => {
    indexOpportunitySuggestionsByUrlStub.resolves({
      opportunityId: 'oppty-1',
      submittedEntries: [{ entityId: 'sugg-1', urls: [WIKI_URL] }],
      syncedIndexResult: undefined,
    });
    await load();
    await run();

    const lines = logStub.warn.args.map((a) => a[0]);
    const suggestionsLine = lines.find((l) => l.includes('submittedSuggestionCount'));
    expect(suggestionsLine).to.exist;
    expect(suggestionsLine).to.include('outcome=degraded');
    expect(suggestionsLine).to.include('submittedSuggestionCount=1');
    expect(suggestionsLine).to.not.include('syncedSuggestionCount=');
    expect(suggestionsLine).to.not.include('syncedUrlCount=');
  });

  it('logs a degraded warn with the fixed reason and the underlying cause when a level fails', async () => {
    indexOpportunityByUrlStub.resolves({
      error: new Error('Failed to sync the URL index', { cause: new Error('batch boom') }),
    });
    await load();
    await run();

    const lines = logStub.warn.args.map((a) => a[0]);
    expect(lines).to.have.lengthOf(1);
    expect(lines[0]).to.include('event=audit_funneling_index_url_synced');
    expect(lines[0]).to.include('outcome=degraded');
    expect(lines[0]).to.include('peer=postgres');
    expect(lines[0]).to.include('errorName=Error');
    expect(lines[0]).to.include('errorMessage="Failed to sync the URL index"');
    expect(lines[0]).to.include('errorCauseName=Error');
    expect(lines[0]).to.include('errorCauseMessage="batch boom"');
    // A failed level never has counts to report.
    expect(lines[0]).to.not.include('submittedUrlCount');
  });

  it('still logs a success end even when a sync-outcome level failed (end is unconditional, not aggregated)', async () => {
    indexOpportunitySuggestionsByUrlStub.resolves({ error: new Error('boom') });
    await load();
    await run();

    const endLine = logStub.info.args.map((a) => a[0])
      .find((l) => l.includes('event=audit_funneling_end'));
    expect(endLine).to.exist;
    expect(endLine).to.include('outcome=success');
  });

  it('still logs a success end when a level is unrecognized, even though nothing threw (end is unconditional, not aggregated)', async () => {
    indexOpportunityByUrlStub.resolves({
      opportunityId: 'oppty-1',
      submittedEntry: { entityId: 'oppty-1', urls: [WIKI_URL] },
      syncedIndexResult: undefined,
    });
    await load();
    await run();

    const endLine = logStub.info.args.map((a) => a[0])
      .find((l) => l.includes('event=audit_funneling_end'));
    expect(endLine).to.exist;
    expect(endLine).to.include('outcome=success');
  });
});
