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
import { ok, notFound, badRequest } from '@adobe/spacecat-shared-http-utils';
import { Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';
import handler from '../../../src/toc/guidance-handler.js';

use(sinonChai);

describe('TOC Guidance Handler', () => {
  let context;
  let message;
  let logStub;
  let dataAccessStub;
  let siteStub;
  let auditStub;
  let opportunityStub;

  const makeSuggestion = (data, status = SuggestionDataAccess.STATUSES.NEW) => ({
    getData: sinon.stub().returns(data),
    setData: sinon.stub(),
    getStatus: sinon.stub().returns(status),
  });

  beforeEach(() => {
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
      // Real dataAccess.Suggestion is the request-scoped collection — it does not carry
      // the static STATUSES map (LLMO-6167), unlike this mock's previous shape. Kept
      // deliberately minimal so a regression reintroducing a STATUSES read on this
      // object fails loudly instead of being silently tolerated by an inaccurate mock.
      Suggestion: {
        saveMany: sinon.stub().resolves(),
      },
    };

    context = { log: logStub, dataAccess: dataAccessStub };

    message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        opportunityId: 'opp-123',
        suggestions: [
          {
            url: 'https://example.com/page1',
            title: 'Page 1',
            headings: ['Intro', 'Details'],
            // Realistic shape of a raw Mystique PromptItem: richer fields
            // (type/topic/category/reasoning/supporting_evidence) plus its own
            // origin/source values — none of which TOC persists (LLMO-6167).
            prompts: [{
              id: 'p1',
              prompt: 'What is X?',
              type: 'Non-Branded',
              topic: 'some topic',
              category: 'Informational',
              reasoning: 'because reasons',
              supporting_evidence: 'quoted heading text',
              origin: 'TOC-grounded',
              source: 'TABLE OF CONTENTS',
              regions: ['US'],
            }],
            hasPrompts: true,
          },
        ],
      },
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should persist prompts onto the matching suggestion by URL, normalized to the legacy minimal shape', async () => {
    const result = await handler(message, context);

    expect(result.status).to.equal(ok().status);
    expect(dataAccessStub.Site.findById).to.have.been.calledWith('site-123');
    expect(dataAccessStub.Audit.findById).to.have.been.calledWith('audit-123');
    expect(dataAccessStub.Opportunity.findById).to.have.been.calledWith('opp-123');
    expect(dataAccessStub.Suggestion.saveMany).to.have.been.calledOnce;
    const [saved] = dataAccessStub.Suggestion.saveMany.getCall(0).args[0];
    expect(saved.setData).to.have.been.calledWith(sinon.match({
      url: 'https://example.com/page1',
      checkType: 'missing-toc',
      prompts: [{
        id: 'p1', origin: 'ai', prompt: 'What is X?', source: 'config', regions: ['US'],
      }],
      hasPrompts: true,
    }));
    expect(logStub.info).to.have.been.calledWith(sinon.match(/Successfully updated 1 suggestion/));
  });

  it('strips Mystique\'s richer PromptItem fields and normalizes origin/source (LLMO-6167)', async () => {
    const result = await handler(message, context);

    expect(result.status).to.equal(ok().status);
    const [saved] = dataAccessStub.Suggestion.saveMany.getCall(0).args[0];
    const [savedCall] = saved.setData.getCall(0).args;
    const [savedPrompt] = savedCall.prompts;
    expect(savedPrompt).to.deep.equal({
      id: 'p1', origin: 'ai', prompt: 'What is X?', source: 'config', regions: ['US'],
    });
    expect(savedPrompt).to.not.have.property('type');
    expect(savedPrompt).to.not.have.property('topic');
    expect(savedPrompt).to.not.have.property('category');
    expect(savedPrompt).to.not.have.property('reasoning');
    expect(savedPrompt).to.not.have.property('supporting_evidence');
  });

  it('should apply the same prompts to every non-terminal suggestion sharing a URL', async () => {
    const shared = 'https://example.com/shared';
    opportunityStub.getSuggestions.resolves([
      makeSuggestion({ url: shared, checkType: 'missing-toc' }),
      makeSuggestion({ url: shared, checkType: 'single-heading' }),
    ]);
    message.data.suggestions = [
      { url: shared, prompts: [{ id: 'p1' }], hasPrompts: true },
    ];

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
    message.data.suggestions = [{ url: 'https://example.com/page1' }];

    const result = await handler(message, context);

    expect(result.status).to.equal(ok().status);
    const [saved] = dataAccessStub.Suggestion.saveMany.getCall(0).args[0];
    expect(saved.setData).to.have.been.calledWith(sinon.match({
      prompts: [],
      hasPrompts: false,
    }));
  });

  it('resolves opportunityId and hasPrompts from Mystique\'s actual snake_case reply shape (LLMO-6167)', async () => {
    message.data = {
      opportunity_id: 'opp-123',
      suggestions: [
        {
          url: 'https://example.com/page1',
          title: 'Page 1',
          headings: ['Intro', 'Details'],
          prompts: [{
            id: 'p1', prompt: 'What is X?', type: 'Non-Branded', origin: 'TOC-grounded', source: 'TABLE OF CONTENTS',
          }],
          has_prompts: true,
        },
      ],
    };

    const result = await handler(message, context);

    expect(result.status).to.equal(ok().status);
    expect(dataAccessStub.Opportunity.findById).to.have.been.calledWith('opp-123');
    expect(dataAccessStub.Suggestion.saveMany).to.have.been.calledOnce;
    const [saved] = dataAccessStub.Suggestion.saveMany.getCall(0).args[0];
    expect(saved.setData).to.have.been.calledWith(sinon.match({
      prompts: [{
        id: 'p1', origin: 'ai', prompt: 'What is X?', source: 'config', regions: [],
      }],
      hasPrompts: true,
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

  it('should return badRequest when suggestions is not an array', async () => {
    message.data.suggestions = 'not an array';

    const result = await handler(message, context);

    expect(result.status).to.equal(badRequest().status);
    expect(logStub.error).to.have.been.calledWith(sinon.match(/Invalid suggestions format/));
  });

  it('should return badRequest when suggestions is null', async () => {
    message.data.suggestions = null;

    const result = await handler(message, context);

    expect(result.status).to.equal(badRequest().status);
    expect(logStub.error).to.have.been.calledWith(sinon.match(/Invalid suggestions format/));
  });

  it('should return ok when suggestions array is empty', async () => {
    message.data.suggestions = [];

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

  it('should return badRequest when message.data is missing entirely', async () => {
    delete message.data;

    const result = await handler(message, context);

    expect(result.status).to.equal(badRequest().status);
    expect(logStub.error).to.have.been.calledWith(sinon.match(/Invalid suggestions format/));
  });

  it('should treat a falsy getSuggestions() resolution as no existing suggestions', async () => {
    opportunityStub.getSuggestions.resolves(null);

    const result = await handler(message, context);

    expect(result.status).to.equal(ok().status);
    expect(dataAccessStub.Suggestion.saveMany).to.not.have.been.called;
    expect(logStub.warn).to.have.been.calledWith(sinon.match(/No matching suggestion found for URL/));
  });
});
