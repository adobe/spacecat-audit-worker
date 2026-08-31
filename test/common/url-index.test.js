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
    ({ syncOpportunityUrlIndex } = await esmock('../../src/common/url-index.js', {
      '@adobe/spacecat-shared-data-access': { syncUrlIndex: syncUrlIndexStub },
    }));
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('indexes the opportunity and each suggestion with the extracted source url', async () => {
    const context = makeContext();
    const opportunity = makeOpportunity({
      data: { fullAnalysis: { wikipediaUrl: WIKI_URL } },
      suggestions: [makeSuggestion('sugg-1'), makeSuggestion('sugg-2')],
    });

    await syncOpportunityUrlIndex({ context, opportunity, auditType: 'wikipedia-analysis' });

    expect(syncUrlIndexStub).to.have.callCount(3);
    expect(syncUrlIndexStub.getCall(0).args[0])
      .to.equal(context.dataAccess.services.postgrestClient);
    expect(syncUrlIndexStub.getCall(0).args[1]).to.deep.equal({
      table: 'opportunity_urls',
      siteId: 'site-1',
      entityId: 'oppty-1',
      entityType: 'wikipedia-analysis',
      urls: [WIKI_URL],
    });
    expect(syncUrlIndexStub.getCall(1).args[1]).to.deep.equal({
      table: 'suggestion_urls',
      siteId: 'site-1',
      entityId: 'sugg-1',
      entityType: 'wikipedia-analysis',
      urls: [WIKI_URL],
    });
    expect(syncUrlIndexStub.getCall(2).args[1]).to.include({
      table: 'suggestion_urls', entityId: 'sugg-2',
    });
    expect(context.log.debug).to.have.been.calledOnce;
    expect(context.log.warn).to.not.have.been.called;
  });

  it('clears the index (empty urls) when no source url is extracted', async () => {
    const context = makeContext();
    const opportunity = makeOpportunity({
      data: {}, // no fullAnalysis at all
      suggestions: [makeSuggestion('sugg-1')],
    });

    await syncOpportunityUrlIndex({ context, opportunity, auditType: 'wikipedia-analysis' });

    expect(syncUrlIndexStub).to.have.callCount(2);
    expect(syncUrlIndexStub.getCall(0).args[1].urls).to.deep.equal([]);
    expect(syncUrlIndexStub.getCall(1).args[1]).to.deep.equal({
      table: 'suggestion_urls',
      siteId: 'site-1',
      entityId: 'sugg-1',
      entityType: 'wikipedia-analysis',
      urls: [],
    });
  });

  it('is a no-op for audit types without a registered extractor', async () => {
    const context = makeContext();
    const opportunity = makeOpportunity({ data: { fullAnalysis: { wikipediaUrl: WIKI_URL } } });

    await syncOpportunityUrlIndex({ context, opportunity, auditType: 'cited-analysis' });

    expect(syncUrlIndexStub).to.not.have.been.called;
    expect(opportunity.getSuggestions).to.not.have.been.called;
  });

  it('swallows errors so a failed sync never fails the audit', async () => {
    const context = makeContext();
    syncUrlIndexStub.rejects(new Error('postgrest boom'));
    const opportunity = makeOpportunity({
      data: { fullAnalysis: { wikipediaUrl: WIKI_URL } },
      suggestions: [makeSuggestion('sugg-1')],
    });

    // Must resolve (not reject) despite the underlying failure.
    await syncOpportunityUrlIndex({ context, opportunity, auditType: 'wikipedia-analysis' });

    expect(context.log.warn).to.have.been.calledOnce;
    expect(context.log.warn.firstCall.args[0]).to.include('postgrest boom');
    expect(context.log.warn.firstCall.args[0]).to.include('oppty-1');
    expect(context.log.debug).to.not.have.been.called;
  });
});
