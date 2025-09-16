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
import chaiAsPromised from 'chai-as-promised';
import nock from 'nock';
import { describe } from 'mocha';
import { ok, notFound } from '@adobe/spacecat-shared-http-utils';
import { ScrapeClient } from '@adobe/spacecat-shared-scrape-client';
import handler from '../../../src/paid-cookie-consent/guidance-handler.js';

use(sinonChai);
use(chaiAsPromised);

// Helper to create a fresh stubbed opportunity instance
function makeOppty({
  page, opportunityType, status = 'NEW', updatedBy = 'system', updatedAt = new Date().toISOString(),
}) {
  return {
    getId: () => `opptyId-${page}-${opportunityType}`,
    getSuggestions: async () => [],
    setAuditId: sinon.stub(),
    setData: sinon.stub(),
    setGuidance: sinon.stub(),
    setTitle: sinon.stub(),
    setDescription: sinon.stub(),
    setStatus: sinon.stub(),
    save: sinon.stub().resolvesThis(),
    getType: () => 'generic-opportunity',
    getData: () => ({ page, opportunityType }),
    getStatus: () => status,
    getUpdatedBy: () => updatedBy,
    getUpdatedAt: () => updatedAt,
  };
}

const TEST_PAGE = 'https://example-page/to-check';

describe('Paid Cookie Consent Guidance Handler', () => {
  let sandbox;
  let logStub;
  let context;
  let Suggestion;
  let Opportunity;
  let Audit;
  let opportunityInstance;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    logStub = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      error: sandbox.stub(),
      warn: sandbox.stub(),
    };
    Suggestion = { create: sandbox.stub().resolves() };
    opportunityInstance = {
      getId: () => 'opptyId',
      getSuggestions: async () => [],
      setAuditId: sinon.stub(),
      setData: sinon.stub(),
      setGuidance: sinon.stub(),
      setTitle: sinon.stub(),
      setStatus: sinon.stub(),
      setDescription: sinon.stub(),
      save: sinon.stub().resolvesThis(),
      getType: () => 'generic-opportunity',
      getData: () => ({ page: TEST_PAGE, opportunityType: 'paid-cookie-consent' }),
      getStatus: () => 'NEW',
      getUpdatedBy: () => 'system',
      getUpdatedAt: () => new Date().toISOString(),
    };
    Opportunity = {
      allBySiteId: sandbox.stub(),
      create: sandbox.stub(),
    };
    Audit = { findById: sandbox.stub() };
    context = {
      log: logStub,
      dataAccess: { Audit, Opportunity, Suggestion },
      env: { SPACECAT_API_URI: 'https://example-space-cat-api' },
    };

    Audit.findById.resolves({
      getAuditId: () => 'auditId',
      getAuditResult: () => [
        {
          key: 'urlConsent',
          value: [{
            url: 'https://example-page/to-check', pageViews: 10, bounceRate: 0.8, projectedTrafficLost: 8, consent: 'show',
          }],
        },
      ],
    });

    // Mock ScrapeClient
    const mockScrapeClient = {
      getScrapeJobUrlResults: sandbox.stub().resolves([{
        path: 'path/to/scrape.json',
      }]),
    };
    sandbox.stub(ScrapeClient, 'createFrom').returns(mockScrapeClient);
  });

  afterEach(() => {
    sandbox.restore();
    nock.cleanAll();
  });

  it('should return notFound if no audit is found', async () => {
    Audit.findById.resolves(null);
    Opportunity.allBySiteId.resolves([]);
    const message = { auditId: '123', siteId: 'site', data: { url: 'url', guidance: [{}] } };
    const result = await handler(message, context);
    expect(result.status).to.equal(notFound().status);
  });

  it('should create a new opportunity and suggestion with plain markdown', async () => {
    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(opportunityInstance);
    const guidance = [{
      body: { markdown: 'plain\nmarkdown' },
      insight: 'insight',
      rationale: 'rationale',
      recommendation: 'rec',
      metadata: { scrape_job_id: 'test-job-id' },
    }];
    const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance } };
    const result = await handler(message, context);
    expect(Opportunity.create).to.have.been.called;
    expect(Suggestion.create).to.have.been.called;
    const suggestion = Suggestion.create.getCall(0).args[0];
    expect(suggestion.data.suggestionValue).include(`plain
markdown`);
    expect(result.status).to.equal(ok().status);
  });

  it('should create a new opportunity and suggestion from serialized JSON with markdown', async () => {
    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(opportunityInstance);
    const markdown = 'json\nmarkdown';
    const guidance = [{
      body: { markdown },
      insight: 'insight',
      rationale: 'rationale',
      recommendation: 'rec',
      metadata: { scrape_job_id: 'test-job-id' },
    }];
    const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance } };
    const result = await handler(message, context);
    expect(Opportunity.create).to.have.been.called;
    expect(Suggestion.create).to.have.been.called;
    const suggestion = Suggestion.create.getCall(0).args[0];
    expect(suggestion.data.suggestionValue).include(`json
markdown`);
    expect(result.status).to.equal(ok().status);
  });

  it('should create new opportunity and mark existing matching NEW system opportunities as IGNORED', async () => {
    const correctOppty = makeOppty({ page: TEST_PAGE, opportunityType: 'paid-cookie-consent' });
    const wrongPageOppty = makeOppty({ page: 'wrong-url', opportunityType: 'paid-cookie-consent' });
    const wrongTypeOppty = makeOppty({ page: 'url', opportunityType: 'other-type' });

    Opportunity.allBySiteId.resolves([wrongPageOppty, wrongTypeOppty, correctOppty]);
    Opportunity.create.resolves(opportunityInstance);
    Audit.findById.resolves({
      getAuditId: () => 'auditId',
      getAuditResult: () => [
        {
          key: 'urlConsent',
          value: [{
            url: TEST_PAGE, pageViews: 10, bounceRate: 0.8, projectedTrafficLost: 8, consent: 'show',
          }],
        },
      ],
    });
    const guidance = [{
      body: { markdown: 'plain\nmarkdown' },
      insight: 'insight',
      rationale: 'rationale',
      recommendation: 'rec',
      metadata: { scrape_job_id: 'test-job-id' },
    }];
    const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance } };

    // Act
    const result = await handler(message, context);

    // Assert: A new opportunity should be created
    expect(Opportunity.create).to.have.been.called;
    expect(Suggestion.create).to.have.been.called;

    // The matching existing opportunity should be marked as IGNORED
    expect(correctOppty.setStatus).to.have.been.calledWith('IGNORED');
    expect(correctOppty.save).to.have.been.called;

    // The non-matching ones should not be touched
    expect(wrongPageOppty.setStatus).to.not.have.been.called;
    expect(wrongTypeOppty.setStatus).to.not.have.been.called;

    expect(result.status).to.equal(ok().status);
  });

  it('should create new opportunity and mark all existing NEW system opportunities as IGNORED', async () => {
    const olderOppty = makeOppty({
      page: TEST_PAGE,
      opportunityType: 'paid-cookie-consent',
      updatedAt: '2024-01-01T00:00:00Z',
    });
    const newerOppty = makeOppty({
      page: TEST_PAGE,
      opportunityType: 'paid-cookie-consent',
      updatedAt: '2024-01-02T00:00:00Z',
    });
    const nonSystemOppty = makeOppty({
      page: TEST_PAGE,
      opportunityType: 'paid-cookie-consent',
      updatedBy: 'user',
    });

    Opportunity.allBySiteId.resolves([olderOppty, newerOppty, nonSystemOppty]);
    Opportunity.create.resolves(opportunityInstance);
    Audit.findById.resolves({
      getAuditId: () => 'auditId',
      getAuditResult: () => [
        {
          key: 'urlConsent',
          value: [{
            url: TEST_PAGE, pageViews: 10, bounceRate: 0.8, projectedTrafficLost: 8, consent: 'show',
          }],
        },
      ],
    });
    const guidance = [{
      body: { markdown: 'plain\nmarkdown' },
      insight: 'insight',
      rationale: 'rationale',
      recommendation: 'rec',
      metadata: { scrape_job_id: 'test-job-id' },
    }];
    const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance } };

    const result = await handler(message, context);

    // Assert: A new opportunity should be created
    expect(Opportunity.create).to.have.been.called;
    expect(Suggestion.create).to.have.been.called;

    // Both system opportunities should be marked as IGNORED
    expect(newerOppty.setStatus).to.have.been.calledWith('IGNORED');
    expect(newerOppty.save).to.have.been.called;
    expect(olderOppty.setStatus).to.have.been.calledWith('IGNORED');
    expect(olderOppty.save).to.have.been.called;

    // The non-system opportunity should not be touched
    expect(nonSystemOppty.setStatus).to.not.have.been.called;

    expect(result.status).to.equal(ok().status);
  });

  it('should handle guidance body as JSON object', async () => {
    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(opportunityInstance);
    const guidance = [{
      body: {
        markdown: 'Direct JSON object markdown',
        issueSeverity: 'high',
      },
      insight: 'insight',
      rationale: 'rationale',
      recommendation: 'rec',
      metadata: { scrape_job_id: 'test-job-id' },
    }];
    const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance } };

    const result = await handler(message, context);

    expect(Opportunity.create).to.have.been.called;
    expect(Suggestion.create).to.have.been.called;
    expect(result.status).to.equal(ok().status);
  });

  it('should skip opportunity creation and log for low severity (low)', async () => {
    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(opportunityInstance);
    const body = { issueSeverity: 'loW', markdown: 'irrelevant' };
    const guidance = [{ body, metadata: { scrape_job_id: 'test-job-id' } }];
    const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance } };
    const result = await handler(message, context);
    expect(Opportunity.create).not.to.have.been.called;
    expect(Suggestion.create).not.to.have.been.called;
    expect(logStub.info).to.have.been.calledWithMatch(/Skipping opportunity creation/);
    expect(result.status).to.equal(ok().status);
  });

  it('should create opportunity if severity is medium', async () => {
    Opportunity.allBySiteId.resolves([]);
    Opportunity.create.resolves(opportunityInstance);
    const body = { issueSeverity: 'Medium', markdown: 'irrelevant' };
    const guidance = [{ body, metadata: { scrape_job_id: 'test-job-id' } }];
    const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance } };
    const result = await handler(message, context);
    expect(Opportunity.create).to.have.been.called;
    expect(Suggestion.create).to.have.been.called;
    expect(result.status).to.equal(ok().status);
  });

  it('should skip opportunity creation for none severity', async () => {
    Opportunity.allBySiteId.resolves([]);
    const body = { issueSeverity: 'none', markdown: 'test' };
    const guidance = [{ body, metadata: { scrape_job_id: 'test-job-id' } }];
    const message = { auditId: 'auditId', siteId: 'site', data: { url: TEST_PAGE, guidance } };

    const result = await handler(message, context);

    expect(Opportunity.create).not.to.have.been.called;
    expect(result.status).to.equal(ok().status);
  });
});
