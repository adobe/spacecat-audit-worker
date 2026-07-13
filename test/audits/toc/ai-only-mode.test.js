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

import { expect, use as chaiUse } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

import { handleAiOnlyModeForToc, importTopPages } from '../../../src/toc/handler.js';

chaiUse(sinonChai);

describe('TOC ai-only mode (handleAiOnlyModeForToc)', () => {
  let context;
  let logSpy;

  const makeSuggestion = (data, status = 'NEW') => ({
    getId: () => 'suggestion-1',
    getStatus: () => status,
    getData: () => data,
  });

  const makeOpportunity = (overrides = {}) => ({
    getId: () => 'opportunity-1',
    getSiteId: () => 'site-1',
    getAuditId: () => null,
    getSuggestions: sinon.stub().resolves([
      makeSuggestion({ url: 'https://example.com/page1', title: 'Page 1' }),
    ]),
    ...overrides,
  });

  beforeEach(() => {
    logSpy = {
      info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy(),
    };
    context = {
      log: logSpy,
      site: {
        getId: () => 'site-1',
        getBaseURL: () => 'https://example.com',
        getRegion: () => 'US',
      },
      sqs: { sendMessage: sinon.stub().resolves() },
      env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'test-mystique-queue' },
      dataAccess: {
        Opportunity: {
          findById: sinon.stub(),
          allBySiteIdAndStatus: sinon.stub(),
        },
      },
    };
  });

  it('resolves the opportunity by explicit opportunityId and queues prompts with generatePrompts forwarded', async () => {
    const opportunity = makeOpportunity();
    context.dataAccess.Opportunity.findById.resolves(opportunity);
    context.data = { opportunityId: 'opportunity-1', generatePrompts: true };

    const result = await handleAiOnlyModeForToc(context);

    expect(context.dataAccess.Opportunity.findById).to.have.been.calledWith('opportunity-1');
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    const [, message] = context.sqs.sendMessage.getCall(0).args;
    expect(message.data.generatePrompts).to.equal(true);
    expect(result).to.deep.equal({
      status: 'complete',
      mode: 'ai-only',
      opportunityId: 'opportunity-1',
      fullAuditRef: 'ai-only/opportunity-1',
      auditResult: {
        message: 'Prompt generation queued successfully for 1 suggestion(s)',
        suggestionCount: 1,
      },
    });
  });

  it('defaults generatePrompts to false when omitted from data', async () => {
    const opportunity = makeOpportunity();
    context.dataAccess.Opportunity.findById.resolves(opportunity);
    context.data = { opportunityId: 'opportunity-1' };

    await handleAiOnlyModeForToc(context);

    const [, message] = context.sqs.sendMessage.getCall(0).args;
    expect(message.data.generatePrompts).to.equal(false);
  });

  it('falls back to the latest NEW opportunity for the site when opportunityId is not provided', async () => {
    const opportunity = makeOpportunity({ getType: () => 'toc' });
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
    context.data = { generatePrompts: false };

    const result = await handleAiOnlyModeForToc(context);

    expect(context.dataAccess.Opportunity.allBySiteIdAndStatus).to.have.been.calledWith('site-1', 'NEW');
    expect(result.status).to.equal('complete');
    expect(result.opportunityId).to.equal('opportunity-1');
  });

  it('returns a failed result when the explicit opportunityId is not found', async () => {
    context.dataAccess.Opportunity.findById.resolves(undefined);
    context.data = { opportunityId: 'missing-opportunity' };

    const result = await handleAiOnlyModeForToc(context);

    expect(result.status).to.equal('failed');
    expect(result.error).to.include('Opportunity not found: missing-opportunity');
    expect(context.sqs.sendMessage).not.to.have.been.called;
  });

  it('returns a failed result when no NEW TOC opportunity exists for the site', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.data = {};

    const result = await handleAiOnlyModeForToc(context);

    expect(result.status).to.equal('failed');
    expect(result.error).to.include('No NEW TOC opportunity found for site: site-1');
  });

  it('returns a failed result when the resolved opportunity belongs to a different site', async () => {
    const opportunity = makeOpportunity({ getSiteId: () => 'other-site' });
    context.dataAccess.Opportunity.findById.resolves(opportunity);
    context.data = { opportunityId: 'opportunity-1' };

    const result = await handleAiOnlyModeForToc(context);

    expect(result.status).to.equal('failed');
    expect(result.error).to.include('does not belong to site site-1');
    expect(context.sqs.sendMessage).not.to.have.been.called;
  });

  it('gracefully defaults opportunityId/generatePrompts when context.data is malformed JSON', async () => {
    const opportunity = makeOpportunity({ getType: () => 'toc' });
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
    context.data = '{not valid json';

    const result = await handleAiOnlyModeForToc(context);

    expect(logSpy.warn).to.have.been.calledWith(
      sinon.match(/Failed to parse context\.data for opportunityId, generatePrompts/),
    );
    expect(result.status).to.equal('complete');
  });

  it('falls back to opportunity.getAuditId() then a synthetic id when context.audit is absent', async () => {
    const opportunity = makeOpportunity({ getAuditId: () => 'stored-audit-id' });
    context.dataAccess.Opportunity.findById.resolves(opportunity);
    context.data = { opportunityId: 'opportunity-1' };

    await handleAiOnlyModeForToc(context);

    const [, message] = context.sqs.sendMessage.getCall(0).args;
    expect(message.auditId).to.equal('stored-audit-id');
  });

  it('falls back to a synthetic auditId when neither context.audit nor opportunity.getAuditId() are available', async () => {
    const opportunity = makeOpportunity({ getAuditId: () => null });
    context.dataAccess.Opportunity.findById.resolves(opportunity);
    context.data = { opportunityId: 'opportunity-1' };

    await handleAiOnlyModeForToc(context);

    const [, message] = context.sqs.sendMessage.getCall(0).args;
    expect(message.auditId).to.equal('toc-ai-only-site-1');
  });

  describe('importTopPages routing', () => {
    it('delegates to handleAiOnlyModeForToc when mode:ai-only is present in context.data', async () => {
      const opportunity = makeOpportunity();
      context.dataAccess.Opportunity.findById.resolves(opportunity);
      context.site.getBaseURL = () => 'https://example.com';
      context.data = { mode: 'ai-only', opportunityId: 'opportunity-1', generatePrompts: true };

      const result = await importTopPages(context);

      expect(result.status).to.equal('complete');
      expect(result.mode).to.equal('ai-only');
      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      expect(logSpy.info).to.have.been.calledWith(
        '[TOC] Detected ai-only mode in step 1, skipping import/scraping/processing',
      );
    });
  });
});
