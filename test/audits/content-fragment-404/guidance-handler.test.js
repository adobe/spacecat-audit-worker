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
import esmock from 'esmock';

use(sinonChai);

describe('Content Fragment 404 guidance handler', () => {
  let handler;
  let context;
  let Site;
  let Audit;
  let Opportunity;
  let Suggestion;
  let log;
  let okStub;
  let notFoundStub;
  let badRequestStub;

  const siteId = 'site-123';
  const auditId = 'audit-456';
  const opportunityId = 'oppty-789';

  const buildMessage = (overrides = {}) => ({
    auditId,
    siteId,
    data: {
      opportunityId,
      contentFragment404s: [
        {
          suggestionId: 'suggestion-1',
          aiReason: 'Primary reason',
        },
      ],
      ...overrides.data,
    },
    ...overrides,
  });

  beforeEach(async () => {
    okStub = sinon.stub().callsFake((body) => ({ status: 200, body }));
    notFoundStub = sinon.stub().callsFake((body) => ({ status: 404, body }));
    badRequestStub = sinon.stub().callsFake((body) => ({ status: 400, body }));

    Site = {
      findById: sinon.stub().resolves({ getId: () => siteId }),
    };
    Audit = {
      findById: sinon.stub().resolves({ getId: () => auditId }),
    };
    Opportunity = {
      findById: sinon.stub().resolves({ getSiteId: () => siteId }),
    };
    Suggestion = {
      findById: sinon.stub(),
    };

    log = {
      debug: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };

    context = {
      log,
      dataAccess: {
        Site,
        Audit,
        Opportunity,
        Suggestion,
      },
    };

    const module = await esmock('../../../src/content-fragment-404/guidance-handler.js', {
      '@adobe/spacecat-shared-http-utils': {
        ok: okStub,
        notFound: notFoundStub,
        badRequest: badRequestStub,
      },
    });

    handler = module.default;
  });

  afterEach(() => {
    sinon.restore();
  });

  it('returns notFound when site is missing', async () => {
    Site.findById.resolves(null);

    const result = await handler(buildMessage(), context);

    expect(result.status).to.equal(404);
    expect(notFoundStub).to.have.been.calledWith('Site not found');
    expect(log.error).to.have.been.calledWith('[Content Fragment 404 Guidance] Site not found for siteId: site-123');
  });

  it('returns notFound when audit is missing', async () => {
    Audit.findById.resolves(null);

    const result = await handler(buildMessage(), context);

    expect(result.status).to.equal(404);
    expect(notFoundStub).to.have.been.calledWith('Audit not found');
    expect(log.warn).to.have.been.calledWith('[Content Fragment 404 Guidance] No audit found for auditId: audit-456');
  });

  it('returns notFound when opportunity is missing', async () => {
    Opportunity.findById.resolves(null);

    const result = await handler(buildMessage(), context);

    expect(result.status).to.equal(404);
    expect(notFoundStub).to.have.been.calledWith('Opportunity not found');
    expect(log.error).to.have.been.calledWith('[Content Fragment 404 Guidance] Opportunity not found for ID: oppty-789');
  });

  it('returns badRequest when site id mismatches opportunity', async () => {
    Opportunity.findById.resolves({
      getSiteId: () => 'different-site',
    });

    const result = await handler(buildMessage(), context);

    expect(result.status).to.equal(400);
    expect(badRequestStub).to.have.been.calledWith('Site ID mismatch');
    expect(log.error).to.have.been.calledWith('[Content Fragment 404 Guidance] Mismatch in Site ID. Expected: site-123, but found: different-site');
  });

  it('returns ok when contentFragment404s array is missing or empty', async () => {
    const message = buildMessage({
      data: {
        contentFragment404s: [],
      },
    });

    const result = await handler(message, context);

    expect(result.status).to.equal(200);
    expect(okStub).to.have.been.calledOnce;
    expect(Suggestion.findById).not.to.have.been.called;
  });

  it('continues processing when a suggestion is not found', async () => {
    Suggestion.findById.resolves(null);

    const result = await handler(buildMessage(), context);

    expect(result.status).to.equal(200);
    expect(okStub).to.have.been.calledOnce;
  });

  it('initializes suggestion data when getData returns null', async () => {
    const suggestionMock = {
      getData: sinon.stub().returns(null),
      setData: sinon.stub(),
      save: sinon.stub().resolves(),
    };

    Suggestion.findById.resolves(suggestionMock);

    const result = await handler(buildMessage(), context);

    expect(result.status).to.equal(200);
    expect(suggestionMock.setData).to.have.been.calledWith({
      aiReason: 'Primary reason',
    });
    expect(suggestionMock.save).to.have.been.calledOnce;
  });

  it('updates suggestions with aiReason and ai_reason fields', async () => {
    const firstSuggestion = {
      getData: sinon.stub().returns({ current: 'data' }),
      setData: sinon.stub(),
      save: sinon.stub().resolves(),
    };
    const secondSuggestion = {
      getData: sinon.stub().returns({ other: 'value' }),
      setData: sinon.stub(),
      save: sinon.stub().resolves(),
    };

    Suggestion.findById.onFirstCall().resolves(firstSuggestion);
    Suggestion.findById.onSecondCall().resolves(secondSuggestion);

    const message = buildMessage({
      data: {
        contentFragment404s: [
          {
            suggestionId: 'suggestion-1',
            aiReason: 'Primary reason',
          },
          {
            suggestionId: 'suggestion-2',
            ai_reason: 'Fallback reason',
          },
        ],
      },
    });

    const result = await handler(message, context);

    expect(result.status).to.equal(200);
    expect(Suggestion.findById).to.have.been.calledTwice;
    expect(Suggestion.findById.firstCall).to.have.been.calledWith('suggestion-1');
    expect(Suggestion.findById.secondCall).to.have.been.calledWith('suggestion-2');

    expect(firstSuggestion.setData).to.have.been.calledWith({
      current: 'data',
      aiReason: 'Primary reason',
    });
    expect(secondSuggestion.setData).to.have.been.calledWith({
      other: 'value',
      aiReason: 'Fallback reason',
    });

    expect(firstSuggestion.save).to.have.been.calledOnce;
    expect(secondSuggestion.save).to.have.been.calledOnce;
  });
});

