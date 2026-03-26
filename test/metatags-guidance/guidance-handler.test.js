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
import { ok, notFound, badRequest } from '@adobe/spacecat-shared-http-utils';
import handler from '../../src/metatags-guidance/guidance-handler.js';

use(sinonChai);

describe('Metatags Guidance Handler', () => {
  let context;
  let message;
  let logStub;
  let dataAccessStub;
  let siteStub;
  let auditStub;
  let opportunityStub;
  let suggestionStub;

  beforeEach(() => {
    logStub = {
      debug: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };

    suggestionStub = {
      getData: sinon.stub().returns({}),
      setData: sinon.stub(),
      save: sinon.stub().resolves(),
    };

    // Helper to create ID-aware suggestion stubs sharing the same getData/setData
    const makeSuggestionWithId = (id) => ({
      getId: sinon.stub().returns(id),
      getData: suggestionStub.getData,
      setData: suggestionStub.setData,
    });

    opportunityStub = {
      getSiteId: sinon.stub().returns('site-123'),
      getType: sinon.stub().returns('guidance:metatags'),
    };

    siteStub = {
      getId: sinon.stub().returns('site-123'),
    };

    auditStub = {
      getId: sinon.stub().returns('audit-123'),
    };

    dataAccessStub = {
      Site: {
        findById: sinon.stub().resolves(siteStub),
      },
      Audit: {
        findById: sinon.stub().resolves(auditStub),
      },
      Opportunity: {
        findById: sinon.stub().resolves(opportunityStub),
      },
      Suggestion: {
        findById: sinon.stub().resolves(suggestionStub),
        batchGetByKeys: sinon.stub().callsFake((keys) => Promise.resolve({
          data: keys.map((k) => makeSuggestionWithId(k.suggestionId)),
        })),
        saveMany: sinon.stub().resolves(),
      },
    };

    context = {
      log: logStub,
      dataAccess: dataAccessStub,
      site: siteStub,
    };

    message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        opportunityId: 'opp-123',
        suggestions: [
          {
            suggestionId: 'sugg-001',
            aiSuggestion: 'Optimized Title | Brand Name',
            aiRationale: 'Improved for SEO and brand consistency',
          },
          {
            suggestionId: 'sugg-002',
            aiSuggestion: 'Great meta description with keywords',
            aiRationale: 'Optimized length and includes target keywords',
          },
        ],
      },
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should successfully update suggestions with AI-generated content', async () => {
    const result = await handler(message, context);

    expect(result.status).to.equal(ok().status);
    expect(dataAccessStub.Site.findById).to.have.been.calledWith('site-123');
    expect(dataAccessStub.Audit.findById).to.have.been.calledWith('audit-123');
    expect(dataAccessStub.Opportunity.findById).to.have.been.calledWith('opp-123');
    expect(dataAccessStub.Suggestion.batchGetByKeys).to.have.been.calledOnce;
    expect(dataAccessStub.Suggestion.saveMany).to.have.been.calledOnce;
    expect(logStub.info).to.have.been.calledWith(sinon.match(/Successfully updated 2 suggestions/));
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

  it('should handle suggestions with no valid suggestionIds', async () => {
    message.data.suggestions = [
      { aiSuggestion: 'test', aiRationale: 'test' },
    ];

    const result = await handler(message, context);

    expect(result.status).to.equal(ok().status);
    expect(dataAccessStub.Suggestion.batchGetByKeys).to.not.have.been.called;
    expect(logStub.error).to.have.been.calledWith(sinon.match(/Suggestion not found/));
  });

  it('should handle when a suggestion is not found in database', async () => {
    // batchGetByKeys returns only sugg-001, not sugg-002
    dataAccessStub.Suggestion.batchGetByKeys.callsFake(() => Promise.resolve({
      data: [{ getId: () => 'sugg-001', getData: suggestionStub.getData, setData: suggestionStub.setData }],
    }));

    const result = await handler(message, context);

    expect(result.status).to.equal(ok().status);
    expect(logStub.error).to.have.been.calledWith(sinon.match(/Suggestion not found for ID: sugg-002/));
    // Only the first suggestion is saved
    expect(dataAccessStub.Suggestion.saveMany).to.have.been.calledOnce;
  });

  it('should warn when aiSuggestion is missing', async () => {
    message.data.suggestions[0].aiSuggestion = '';

    const result = await handler(message, context);

    expect(result.status).to.equal(ok().status);
    expect(logStub.warn).to.have.been.calledWith(sinon.match(/Incomplete data for suggestion sugg-001/));
    expect(suggestionStub.setData).to.have.been.calledWith(sinon.match({
      aiSuggestion: '',
    }));
  });

  it('should warn when aiRationale is missing', async () => {
    message.data.suggestions[0].aiRationale = '';

    const result = await handler(message, context);

    expect(result.status).to.equal(ok().status);
    expect(logStub.warn).to.have.been.calledWith(sinon.match(/Incomplete data for suggestion sugg-001/));
    expect(suggestionStub.setData).to.have.been.calledWith(sinon.match({
      aiRationale: '',
    }));
  });

  it('should handle when both aiSuggestion and aiRationale are missing', async () => {
    message.data.suggestions[0].aiSuggestion = null;
    message.data.suggestions[0].aiRationale = null;

    const result = await handler(message, context);

    expect(result.status).to.equal(ok().status);
    expect(logStub.warn).to.have.been.calledWith(sinon.match(/Incomplete data/));
    expect(suggestionStub.setData).to.have.been.calledWith(sinon.match({
      aiSuggestion: '',
      aiRationale: '',
    }));
    expect(dataAccessStub.Suggestion.saveMany).to.have.been.called;
  });

  it('should preserve existing suggestion data when updating', async () => {
    suggestionStub.getData.returns({
      url: 'https://example.com/page',
      tagName: 'title',
      existingField: 'preserved',
    });

    const result = await handler(message, context);

    expect(result.status).to.equal(ok().status);
    expect(suggestionStub.setData).to.have.been.calledWith(sinon.match({
      url: 'https://example.com/page',
      tagName: 'title',
      existingField: 'preserved',
      aiSuggestion: 'Optimized Title | Brand Name',
      aiRationale: 'Improved for SEO and brand consistency',
    }));
  });
});
