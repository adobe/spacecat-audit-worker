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
import { ok, notFound, badRequest } from '@adobe/spacecat-shared-http-utils';
import { Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';

use(sinonChai);

describe('TOC Guidance Handler', () => {
  let context;
  let message;
  let logStub;
  let dataAccessStub;
  let siteStub;
  let auditStub;
  let opportunityStub;
  let fetchStub;
  let handler;

  const makeSuggestion = (data, status = SuggestionDataAccess.STATUSES.NEW) => ({
    getData: sinon.stub().returns(data),
    setData: sinon.stub(),
    getStatus: sinon.stub().returns(status),
  });

  beforeEach(async () => {
    logStub = {
      debug: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };

    opportunityStub = {
      getSiteId: sinon.stub().returns('site-123'),
      getSuggestions: sinon.stub().resolves([
        makeSuggestion({ url: 'https://example.com/page1', checkType: 'missing-toc' }),
        makeSuggestion({ url: 'https://example.com/page2', checkType: 'single-heading' }),
      ]),
    };

    siteStub = { getId: sinon.stub().returns('site-123') };
    auditStub = { getId: sinon.stub().returns('audit-123') };

    dataAccessStub = {
      Site: { findById: sinon.stub().resolves(siteStub) },
      Audit: { findById: sinon.stub().resolves(auditStub) },
      Opportunity: { findById: sinon.stub().resolves(opportunityStub) },
      Suggestion: {
        STATUSES: SuggestionDataAccess.STATUSES,
        saveMany: sinon.stub().resolves(),
      },
    };

    context = { log: logStub, dataAccess: dataAccessStub };

    message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        opportunityId: 'opp-123',
        presignedUrl: 'https://s3.example.com/toc-suggestions.json?X-Amz-Signature=abc',
      },
    };

    // Stub the shared analysis-fetch helper directly (no need to fake a Response).
    fetchStub = sinon.stub().resolves({
      suggestions: [
        {
          url: 'https://example.com/page1',
          title: 'Page 1',
          headings: ['Intro', 'Details'],
          prompts: [{ id: 'p1', prompt: 'What is X?', type: 'Non-Branded' }],
          hasPrompts: true,
        },
      ],
    });

    handler = await esmock('../../../src/toc/guidance-handler.js', {
      '../../../src/utils/analysis-fetch.js': {
        fetchAnalysisFromPresignedUrl: fetchStub,
      },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should persist prompts onto the matching suggestion by URL', async () => {
    const result = await handler(message, context);

    expect(result.status).to.equal(ok().status);
    expect(dataAccessStub.Site.findById).to.have.been.calledWith('site-123');
    expect(dataAccessStub.Audit.findById).to.have.been.calledWith('audit-123');
    expect(dataAccessStub.Opportunity.findById).to.have.been.calledWith('opp-123');
    expect(fetchStub).to.have.been.calledWith(message.data.presignedUrl, sinon.match.object);
    expect(dataAccessStub.Suggestion.saveMany).to.have.been.calledOnce;
    const [saved] = dataAccessStub.Suggestion.saveMany.getCall(0).args[0];
    expect(saved.setData).to.have.been.calledWith(sinon.match({
      url: 'https://example.com/page1',
      checkType: 'missing-toc',
      prompts: [{ id: 'p1', prompt: 'What is X?', type: 'Non-Branded' }],
      hasPrompts: true,
    }));
    expect(logStub.info).to.have.been.calledWith(sinon.match(/Successfully updated 1 suggestion/));
  });

  it('should apply the same prompts to every non-terminal suggestion sharing a URL', async () => {
    const shared = 'https://example.com/shared';
    opportunityStub.getSuggestions.resolves([
      makeSuggestion({ url: shared, checkType: 'missing-toc' }),
      makeSuggestion({ url: shared, checkType: 'single-heading' }),
    ]);
    fetchStub.resolves({
      suggestions: [{ url: shared, prompts: [{ id: 'p1' }], hasPrompts: true }],
    });

    const result = await handler(message, context);

    expect(result.status).to.equal(ok().status);
    expect(dataAccessStub.Suggestion.saveMany).to.have.been.calledOnce;
    expect(dataAccessStub.Suggestion.saveMany.getCall(0).args[0]).to.have.length(2);
  });

  it('should skip FIXED, OUTDATED and SKIPPED suggestions when matching by URL', async () => {
    const url = 'https://example.com/page1';
    opportunityStub.getSuggestions.resolves([
      makeSuggestion({ url }, SuggestionDataAccess.STATUSES.FIXED),
      makeSuggestion({ url }, SuggestionDataAccess.STATUSES.OUTDATED),
      makeSuggestion({ url }, SuggestionDataAccess.STATUSES.SKIPPED),
    ]);

    const result = await handler(message, context);

    expect(result.status).to.equal(ok().status);
    expect(dataAccessStub.Suggestion.saveMany).to.not.have.been.called;
    expect(logStub.warn).to.have.been.calledWith(sinon.match(/No matching suggestion found for URL/));
  });

  it('should default prompts to an empty array and hasPrompts to false when Mystique omits them', async () => {
    fetchStub.resolves({ suggestions: [{ url: 'https://example.com/page1' }] });

    const result = await handler(message, context);

    expect(result.status).to.equal(ok().status);
    const [saved] = dataAccessStub.Suggestion.saveMany.getCall(0).args[0];
    expect(saved.setData).to.have.been.calledWith(sinon.match({
      prompts: [],
      hasPrompts: false,
    }));
  });

  it('should return notFound when site is not found', async () => {
    dataAccessStub.Site.findById.resolves(null);

    const result = await handler(message, context);

    expect(result.status).to.equal(notFound().status);
    expect(logStub.error).to.have.been.calledWith(sinon.match(/Site not found for siteId: site-123/));
  });

  it('should return notFound when audit is not found', async () => {
    dataAccessStub.Audit.findById.resolves(null);

    const result = await handler(message, context);

    expect(result.status).to.equal(notFound().status);
    expect(logStub.warn).to.have.been.calledWith(sinon.match(/No audit found for auditId: audit-123/));
  });

  it('should return notFound when opportunity is not found', async () => {
    dataAccessStub.Opportunity.findById.resolves(null);

    const result = await handler(message, context);

    expect(result.status).to.equal(notFound().status);
    expect(logStub.error).to.have.been.calledWith(sinon.match(/Opportunity not found for ID: opp-123/));
  });

  it('should return badRequest when site ID does not match opportunity', async () => {
    opportunityStub.getSiteId.returns('different-site-id');

    const result = await handler(message, context);

    expect(result.status).to.equal(badRequest().status);
    expect(logStub.error).to.have.been.calledWith(sinon.match(/Site ID mismatch/));
  });

  it('should return badRequest when presignedUrl is missing', async () => {
    delete message.data.presignedUrl;

    const result = await handler(message, context);

    expect(result.status).to.equal(badRequest().status);
    expect(logStub.error).to.have.been.calledWith(sinon.match(/Missing presignedUrl/));
    expect(fetchStub).to.not.have.been.called;
  });

  it('should return badRequest when message.data is missing entirely', async () => {
    delete message.data;

    const result = await handler(message, context);

    expect(result.status).to.equal(badRequest().status);
    expect(logStub.error).to.have.been.calledWith(sinon.match(/Missing presignedUrl/));
  });

  it('should return badRequest when the presigned-URL download fails', async () => {
    fetchStub.rejects(new Error('analysis fetch failed: 500 Internal Server Error'));

    const result = await handler(message, context);

    expect(result.status).to.equal(badRequest().status);
    expect(logStub.error).to.have.been.calledWith(sinon.match(/Error downloading suggestions from presigned URL/));
  });

  it('should return badRequest when the downloaded payload is missing a suggestions array', async () => {
    fetchStub.resolves({ notSuggestions: [] });

    const result = await handler(message, context);

    expect(result.status).to.equal(badRequest().status);
    expect(logStub.error).to.have.been.calledWith(sinon.match(/Downloaded data is missing required suggestions array/));
  });

  it('should return ok when suggestions array is empty', async () => {
    fetchStub.resolves({ suggestions: [] });

    const result = await handler(message, context);

    expect(result.status).to.equal(ok().status);
    expect(logStub.info).to.have.been.calledWith(sinon.match(/No suggestions provided/));
    expect(dataAccessStub.Suggestion.saveMany).to.not.have.been.called;
  });

  it('should ignore existing suggestions with no url in their data', async () => {
    opportunityStub.getSuggestions.resolves([
      makeSuggestion({ checkType: 'missing-toc' }),
    ]);

    const result = await handler(message, context);

    expect(result.status).to.equal(ok().status);
    expect(dataAccessStub.Suggestion.saveMany).to.not.have.been.called;
    expect(logStub.warn).to.have.been.calledWith(sinon.match(/No matching suggestion found for URL/));
  });

  it('should treat a falsy getData() return value from an existing suggestion as no data', async () => {
    opportunityStub.getSuggestions.resolves([
      makeSuggestion(undefined),
    ]);

    const result = await handler(message, context);

    expect(result.status).to.equal(ok().status);
    expect(dataAccessStub.Suggestion.saveMany).to.not.have.been.called;
    expect(logStub.warn).to.have.been.calledWith(sinon.match(/No matching suggestion found for URL/));
  });

  it('should treat a falsy getSuggestions() resolution as no existing suggestions', async () => {
    opportunityStub.getSuggestions.resolves(null);

    const result = await handler(message, context);

    expect(result.status).to.equal(ok().status);
    expect(dataAccessStub.Suggestion.saveMany).to.not.have.been.called;
    expect(logStub.warn).to.have.been.calledWith(sinon.match(/No matching suggestion found for URL/));
  });
});
