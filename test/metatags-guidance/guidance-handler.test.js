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
      },
    };

    context = {
      log: logStub,
      dataAccess: dataAccessStub,
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

    expect(result.statusCode).to.equal(200);
    expect(dataAccessStub.Site.findById).to.have.been.calledWith('site-123');
    expect(dataAccessStub.Audit.findById).to.have.been.calledWith('audit-123');
    expect(dataAccessStub.Opportunity.findById).to.have.been.calledWith('opp-123');
    expect(dataAccessStub.Suggestion.findById).to.have.been.calledTwice;
    expect(suggestionStub.save).to.have.been.calledTwice;
    expect(logStub.info).to.have.been.calledWith(sinon.match(/Successfully updated 2 suggestions/));
  });

  it('should return notFound when site is not found', async () => {
    dataAccessStub.Site.findById.resolves(null);

    const result = await handler(message, context);

    expect(result.statusCode).to.equal(404);
    expect(logStub.error).to.have.been.calledWith(sinon.match(/Site not found for siteId: site-123/));
  });

  it('should return notFound when audit is not found', async () => {
    dataAccessStub.Audit.findById.resolves(null);

    const result = await handler(message, context);

    expect(result.statusCode).to.equal(404);
    expect(logStub.warn).to.have.been.calledWith(sinon.match(/No audit found for auditId: audit-123/));
  });

  it('should return notFound when opportunity is not found', async () => {
    dataAccessStub.Opportunity.findById.resolves(null);

    const result = await handler(message, context);

    expect(result.statusCode).to.equal(404);
    expect(logStub.error).to.have.been.calledWith(sinon.match(/Opportunity not found for ID: opp-123/));
  });

  it('should return badRequest when site ID does not match opportunity', async () => {
    opportunityStub.getSiteId.returns('different-site-id');

    const result = await handler(message, context);

    expect(result.statusCode).to.equal(400);
    expect(logStub.error).to.have.been.calledWith(sinon.match(/Site ID mismatch/));
  });

  it('should return badRequest when suggestions is not an array', async () => {
    message.data.suggestions = 'not an array';

    const result = await handler(message, context);

    expect(result.statusCode).to.equal(400);
    expect(logStub.error).to.have.been.calledWith(sinon.match(/Invalid suggestions format/));
  });

  it('should return badRequest when suggestions is null', async () => {
    message.data.suggestions = null;

    const result = await handler(message, context);

    expect(result.statusCode).to.equal(400);
    expect(logStub.error).to.have.been.calledWith(sinon.match(/Invalid suggestions format/));
  });

  it('should return ok when suggestions array is empty', async () => {
    message.data.suggestions = [];

    const result = await handler(message, context);

    expect(result.statusCode).to.equal(200);
    expect(logStub.info).to.have.been.calledWith(sinon.match(/No suggestions provided/));
    expect(suggestionStub.save).to.not.have.been.called;
  });

  it('should handle when a suggestion is not found in database', async () => {
    dataAccessStub.Suggestion.findById.onFirstCall().resolves(suggestionStub);
    dataAccessStub.Suggestion.findById.onSecondCall().resolves(null);

    const result = await handler(message, context);

    expect(result.statusCode).to.equal(200);
    expect(logStub.error).to.have.been.calledWith(sinon.match(/Suggestion not found for ID: sugg-002/));
    expect(suggestionStub.save).to.have.been.calledOnce; // Only first suggestion saved
  });

  it('should warn when aiSuggestion is missing', async () => {
    message.data.suggestions[0].aiSuggestion = '';

    const result = await handler(message, context);

    expect(result.statusCode).to.equal(200);
    expect(logStub.warn).to.have.been.calledWith(sinon.match(/Incomplete data for suggestion sugg-001/));
    expect(suggestionStub.setData).to.have.been.calledWith(sinon.match({
      aiSuggestion: '',
    }));
  });

  it('should warn when aiRationale is missing', async () => {
    message.data.suggestions[0].aiRationale = '';

    const result = await handler(message, context);

    expect(result.statusCode).to.equal(200);
    expect(logStub.warn).to.have.been.calledWith(sinon.match(/Incomplete data for suggestion sugg-001/));
    expect(suggestionStub.setData).to.have.been.calledWith(sinon.match({
      aiRationale: '',
    }));
  });

  it('should handle when both aiSuggestion and aiRationale are missing', async () => {
    message.data.suggestions[0].aiSuggestion = null;
    message.data.suggestions[0].aiRationale = null;

    const result = await handler(message, context);

    expect(result.statusCode).to.equal(200);
    expect(logStub.warn).to.have.been.calledWith(sinon.match(/Incomplete data/));
    expect(suggestionStub.setData).to.have.been.calledWith(sinon.match({
      aiSuggestion: '',
      aiRationale: '',
    }));
    expect(suggestionStub.save).to.have.been.called;
  });

  it('should preserve existing suggestion data when updating', async () => {
    suggestionStub.getData.returns({
      url: 'https://example.com/page',
      tagName: 'title',
      existingField: 'preserved',
    });

    const result = await handler(message, context);

    expect(result.statusCode).to.equal(200);
    expect(suggestionStub.setData).to.have.been.calledWith(sinon.match({
      url: 'https://example.com/page',
      tagName: 'title',
      existingField: 'preserved',
      aiSuggestion: 'Optimized Title | Brand Name',
      aiRationale: 'Improved for SEO and brand consistency',
    }));
  });
});
