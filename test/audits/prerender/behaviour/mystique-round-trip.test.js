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

/**
 * Behavioural contracts: Mystique round-trip
 *
 * OUTBOUND (audit worker → Mystique via SQS):
 *   - Branch A fires → SQS message sent to QUEUE_SPACECAT_TO_MYSTIQUE
 *   - Message structure: type=guidance:prerender, data.opportunityId, data.suggestions[].url
 *   - Branch C (no prerender URLs) → no SQS message sent
 *
 * INBOUND (Mystique → guidance-handler.js):
 *   - Valid aiSummary → aiSummary + valuable both updated
 *   - aiSummary absent/invalid → existing aiSummary + valuable BOTH preserved
 *   - OUTDATED suggestion excluded from update
 *   - URL in Mystique response not in DB → warning logged, skipped
 *   - Missing presignedUrl or opportunityId → badRequest
 *   - Opportunity not found → notFound
 */

/* eslint-env mocha */
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';
import {
  processContentAndGenerateOpportunities,
  handleAiOnlyMode,
} from '../../../../src/prerender/handler.js';
import {
  buildContext,
  buildSite,
  buildS3Client,
  buildDataAccess,
  buildOpportunity,
  buildSuggestion,
  buildUrlS3Content,
  statusKey,
  buildStatus,
  HTML_SERVER_SPARSE,
  HTML_CLIENT_NEEDS_PRERENDER,
} from './helpers.js';

use(sinonChai);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a context that will trigger Branch A (prerender URLs found) in step 3.
 * Server HTML is sparse; client HTML is rich → contentGainRatio > 1.1.
 */
function buildBranchAStep3Ctx(sandbox, siteId, scrapeJobId, url) {
  return buildContext(sandbox, {
    site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
    s3Client: buildS3Client(sandbox, {
      [statusKey(siteId)]: buildStatus(),
      ...buildUrlS3Content(scrapeJobId, url, {
        serverHtml: HTML_SERVER_SPARSE,
        clientHtml: HTML_CLIENT_NEEDS_PRERENDER,
      }),
    }),
    dataAccess: buildDataAccess(sandbox, {
      scrapeUrls: [url],
      opportunities: [],
    }),
    scrapeResultPaths: new Map([[url, {}]]),
    auditContext: { scrapeJobId },
  });
}

// ─── OUTBOUND ─────────────────────────────────────────────────────────────────

describe('Prerender behaviour — Mystique round-trip (outbound)', () => {
  let sandbox;

  beforeEach(() => { sandbox = sinon.createSandbox(); });
  afterEach(() => { sandbox.restore(); });

  it('Branch A: SQS message sent to Mystique queue with type=guidance:prerender and data.suggestions', async () => {
    const siteId = 'site-outbound-a';
    const scrapeJobId = 'job-outbound-a';
    const url = 'https://example.com/page-1';

    const ctx = buildBranchAStep3Ctx(sandbox, siteId, scrapeJobId, url);

    await processContentAndGenerateOpportunities(ctx);

    expect(ctx.sqs.sendMessage).to.have.been.called;
    const [queue, message] = ctx.sqs.sendMessage.firstCall.args;

    // Sent to the correct Mystique queue
    expect(queue).to.equal(ctx.env.QUEUE_SPACECAT_TO_MYSTIQUE);

    // Message structure
    expect(message).to.have.property('type', 'guidance:prerender');
    expect(message).to.have.property('siteId', siteId);
    expect(message.data).to.have.property('opportunityId').that.is.a('string');
    expect(message.data).to.have.property('suggestions').that.is.an('array').with.length.greaterThan(0);

    // Each suggestion carries the URL so Mystique can match it on response
    const [firstSuggestion] = message.data.suggestions;
    expect(firstSuggestion).to.have.property('url', url);
  });

  it('Branch B (isDomainBlocked=true / scrapeForbidden) → Mystique SQS message NOT sent', async () => {
    const siteId = 'site-outbound-b';

    // isDomainBlocked=true → scrapeForbidden=true → Branch B fires (createScrapeForbiddenOpportunity).
    // Branch B never reaches sendPrerenderGuidanceRequestToMystique, so no SQS message is sent.
    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox, {
        [statusKey(siteId)]: buildStatus(),
      }),
      dataAccess: buildDataAccess(sandbox, {
        opportunities: [],
      }),
      scrapeResultPaths: new Map(),
      auditContext: { domainBlocked: true },
    });

    await processContentAndGenerateOpportunities(ctx);

    expect(ctx.sqs.sendMessage).to.not.have.been.called;
  });

  it('Branch C (no prerender URLs): SQS message NOT sent to Mystique', async () => {
    const siteId = 'site-outbound-c';
    const scrapeJobId = 'job-outbound-c';
    const url = 'https://example.com/no-prerender';

    // Identical HTML → ratio = 1.0 < 1.1 → needsPrerender=false → Branch C
    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox, {
        [statusKey(siteId)]: buildStatus(),
        // HTML_SAME (default) → no prerender needed
        ...buildUrlS3Content(scrapeJobId, url),
      }),
      dataAccess: buildDataAccess(sandbox, {
        scrapeUrls: [url],
        opportunities: [],
      }),
      scrapeResultPaths: new Map([[url, {}]]),
      auditContext: { scrapeJobId },
    });

    await processContentAndGenerateOpportunities(ctx);

    // No SQS send — Branch C does not dispatch to Mystique
    expect(ctx.sqs.sendMessage).to.not.have.been.called;
  });
});

// ─── OUTBOUND: ai-only filtering ─────────────────────────────────────────────

describe('Prerender behaviour — Mystique outbound (ai-only filtering)', () => {
  let sandbox;

  beforeEach(() => { sandbox = sinon.createSandbox(); });
  afterEach(() => { sandbox.restore(); });

  it('ai-only: FIXED suggestion excluded from Mystique SQS message', async () => {
    // In ai-only mode, sendPrerenderGuidanceRequestToMystique derives candidates from DB
    // suggestions and skips any with status=FIXED (D-07). The NEW suggestion must still appear.
    const siteId = 'site-ai-fixed';
    const oppId = 'opp-ai-fixed';
    const scrapeJobId = 'job-ai-fixed';
    const fixedUrl = 'https://example.com/fixed-page';
    const newUrl = 'https://example.com/new-page';

    const fixedSuggestion = buildSuggestion(sandbox, {
      id: 'sug-fixed',
      status: 'FIXED',
      data: { url: fixedUrl, scrapeJobId },
    });
    const newSuggestion = buildSuggestion(sandbox, {
      id: 'sug-new',
      status: 'NEW',
      data: { url: newUrl, scrapeJobId },
    });

    const opportunity = buildOpportunity(sandbox, {
      id: oppId,
      siteId,
      suggestions: [fixedSuggestion, newSuggestion],
    });

    const dataAccess = buildDataAccess(sandbox, { opportunities: [opportunity] });
    // handleAiOnlyMode uses findById when opportunityId is provided in data
    dataAccess.Opportunity.findById = sandbox.stub().resolves(opportunity);

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId }),
      dataAccess,
      data: { opportunityId: oppId, scrapeJobId },
    });

    await handleAiOnlyMode(ctx);

    expect(ctx.sqs.sendMessage).to.have.been.called;
    const [, message] = ctx.sqs.sendMessage.firstCall.args;
    const suggestionUrls = message.data.suggestions.map((s) => s.url);
    expect(suggestionUrls).to.not.include(fixedUrl);
    expect(suggestionUrls).to.include(newUrl);
  });

  it('ai-only: edgeDeployed suggestion excluded from Mystique SQS message', async () => {
    // In ai-only mode, suggestions with data.edgeDeployed set are skipped (D-07).
    // The plain NEW suggestion without edgeDeployed must still be sent.
    const siteId = 'site-ai-edge';
    const oppId = 'opp-ai-edge';
    const scrapeJobId = 'job-ai-edge';
    const edgeUrl = 'https://example.com/edge-page';
    const newUrl = 'https://example.com/new-page';

    const edgeSuggestion = buildSuggestion(sandbox, {
      id: 'sug-edge',
      status: 'NEW',
      data: { url: edgeUrl, scrapeJobId, edgeDeployed: new Date().toISOString() },
    });
    const newSuggestion = buildSuggestion(sandbox, {
      id: 'sug-new',
      status: 'NEW',
      data: { url: newUrl, scrapeJobId },
    });

    const opportunity = buildOpportunity(sandbox, {
      id: oppId,
      siteId,
      suggestions: [edgeSuggestion, newSuggestion],
    });

    const dataAccess = buildDataAccess(sandbox, { opportunities: [opportunity] });
    dataAccess.Opportunity.findById = sandbox.stub().resolves(opportunity);

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId }),
      dataAccess,
      data: { opportunityId: oppId, scrapeJobId },
    });

    await handleAiOnlyMode(ctx);

    expect(ctx.sqs.sendMessage).to.have.been.called;
    const [, message] = ctx.sqs.sendMessage.firstCall.args;
    const suggestionUrls = message.data.suggestions.map((s) => s.url);
    expect(suggestionUrls).to.not.include(edgeUrl);
    expect(suggestionUrls).to.include(newUrl);
  });
});

// ─── INBOUND ──────────────────────────────────────────────────────────────────

describe('Prerender behaviour — Mystique round-trip (inbound: guidance-handler)', () => {
  let sandbox;
  let guidanceHandler;
  let fetchAnalysisStub;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    fetchAnalysisStub = sandbox.stub();
    ({ default: guidanceHandler } = await esmock(
      '../../../../src/prerender/guidance-handler.js',
      {
        '../../../../src/utils/analysis-fetch.js': {
          fetchAnalysisFromPresignedUrl: fetchAnalysisStub,
        },
      },
    ));
  });
  afterEach(() => { sandbox.restore(); });

  // ─── Context builder for guidance-handler ──────────────────────────────────

  function buildGuidanceCtx(overrides = {}) {
    const site = buildSite({ id: overrides.siteId ?? 'site-guidance', baseUrl: 'https://example.com' });
    return {
      log: {
        info: sandbox.stub(),
        warn: sandbox.stub(),
        error: sandbox.stub(),
        debug: sandbox.stub(),
      },
      dataAccess: {
        Site: {
          findById: sandbox.stub().resolves(site),
        },
        Opportunity: {
          findById: sandbox.stub().resolves(overrides.opportunity ?? null),
        },
        Suggestion: {
          saveMany: sandbox.stub().resolves([]),
        },
      },
      env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'https://sqs.us-east-1.amazonaws.com/test' },
      ...overrides.ctxOverrides,
    };
  }

  function buildMessage(siteId, opportunityId, overrides = {}) {
    return {
      siteId,
      data: {
        presignedUrl: 'https://s3.amazonaws.com/bucket/results.json?X-Amz-Signature=abc',
        opportunityId,
        ...overrides,
      },
    };
  }

  // ─── aiSummary / valuable coupling ────────────────────────────────────────

  it('valid aiSummary → aiSummary AND valuable both updated in DB', async () => {
    const siteId = 'site-inbound-summary';
    const oppId = 'opp-summary-1';
    const url = 'https://example.com/page-1';

    const suggestion = buildSuggestion(sandbox, {
      id: 'sug-1',
      status: 'NEW',
      data: { url, wordCountBefore: 10, wordCountAfter: 100 },
    });
    suggestion.setData = sandbox.stub();

    const opportunity = buildOpportunity(sandbox, {
      id: oppId,
      siteId,
      suggestions: [suggestion],
    });

    fetchAnalysisStub.resolves({
      suggestions: [{ url, aiSummary: 'Great page with rich content.', valuable: true }],
    });

    const ctx = buildGuidanceCtx({ siteId, opportunity });
    await guidanceHandler(buildMessage(siteId, oppId), ctx);

    expect(suggestion.setData).to.have.been.called;
    const [updatedData] = suggestion.setData.firstCall.args;
    expect(updatedData).to.have.property('aiSummary', 'Great page with rich content.');
    expect(updatedData).to.have.property('valuable', true);
    expect(ctx.dataAccess.Suggestion.saveMany).to.have.been.called;
  });

  it('valid aiSummary with valuable=false → both updated, valuable=false persisted', async () => {
    const siteId = 'site-inbound-not-valuable';
    const oppId = 'opp-nv-1';
    const url = 'https://example.com/page-2';

    const suggestion = buildSuggestion(sandbox, {
      id: 'sug-nv',
      status: 'NEW',
      data: { url, aiSummary: 'old', valuable: true },
    });
    suggestion.setData = sandbox.stub();

    const opportunity = buildOpportunity(sandbox, {
      id: oppId,
      siteId,
      suggestions: [suggestion],
    });

    fetchAnalysisStub.resolves({
      suggestions: [{ url, aiSummary: 'Thin page, little value.', valuable: false }],
    });

    const ctx = buildGuidanceCtx({ siteId, opportunity });
    await guidanceHandler(buildMessage(siteId, oppId), ctx);

    const [updatedData] = suggestion.setData.firstCall.args;
    expect(updatedData).to.have.property('aiSummary', 'Thin page, little value.');
    expect(updatedData).to.have.property('valuable', false);
  });

  it('aiSummary absent in response → existing aiSummary AND valuable both preserved', async () => {
    // When Mystique sends "Not Available", the handler preserves the previously stored
    // aiSummary and valuable — it still calls setData/saveMany but with the old values intact.
    const siteId = 'site-inbound-preserve';
    const oppId = 'opp-preserve-1';
    const url = 'https://example.com/page-3';

    const suggestion = buildSuggestion(sandbox, {
      id: 'sug-preserve',
      status: 'NEW',
      data: { url, aiSummary: 'Previously computed summary', valuable: true },
    });
    suggestion.setData = sandbox.stub();

    const opportunity = buildOpportunity(sandbox, {
      id: oppId,
      siteId,
      suggestions: [suggestion],
    });

    // Mystique returns "Not Available" — treated as no summary
    fetchAnalysisStub.resolves({
      suggestions: [{ url, aiSummary: 'Not Available', valuable: false }],
    });

    const ctx = buildGuidanceCtx({ siteId, opportunity });
    await guidanceHandler(buildMessage(siteId, oppId), ctx);

    // setData IS called but with the preserved (old) values — not the "Not Available" response
    expect(suggestion.setData).to.have.been.called;
    const [updatedData] = suggestion.setData.firstCall.args;
    expect(updatedData).to.have.property('aiSummary', 'Previously computed summary');
    expect(updatedData).to.have.property('valuable', true);
  });

  // ─── Filtering ────────────────────────────────────────────────────────────

  it('OUTDATED suggestion is excluded from update even when URL matches', async () => {
    const siteId = 'site-inbound-outdated';
    const oppId = 'opp-outdated-1';
    const url = 'https://example.com/page-outdated';

    const outdatedSuggestion = buildSuggestion(sandbox, {
      id: 'sug-outdated',
      status: 'OUTDATED',
      data: { url },
    });
    outdatedSuggestion.setData = sandbox.stub();

    const activeSuggestion = buildSuggestion(sandbox, {
      id: 'sug-active',
      status: 'NEW',
      data: { url: 'https://example.com/page-active' },
    });
    activeSuggestion.setData = sandbox.stub();

    const opportunity = buildOpportunity(sandbox, {
      id: oppId,
      siteId,
      suggestions: [outdatedSuggestion, activeSuggestion],
    });

    fetchAnalysisStub.resolves({
      suggestions: [
        { url, aiSummary: 'Summary for outdated page', valuable: true },
        { url: 'https://example.com/page-active', aiSummary: 'Active summary', valuable: true },
      ],
    });

    const ctx = buildGuidanceCtx({ siteId, opportunity });
    await guidanceHandler(buildMessage(siteId, oppId), ctx);

    // OUTDATED suggestion must not have been updated
    expect(outdatedSuggestion.setData).to.not.have.been.called;
    // Active suggestion was updated
    expect(activeSuggestion.setData).to.have.been.called;
  });

  it('URL in Mystique response not in DB → warning logged, other suggestions still processed', async () => {
    const siteId = 'site-inbound-unknown-url';
    const oppId = 'opp-unknown-1';
    const knownUrl = 'https://example.com/known';
    const unknownUrl = 'https://example.com/ghost-page';

    const knownSuggestion = buildSuggestion(sandbox, {
      id: 'sug-known',
      status: 'NEW',
      data: { url: knownUrl },
    });
    knownSuggestion.setData = sandbox.stub();

    const opportunity = buildOpportunity(sandbox, {
      id: oppId,
      siteId,
      suggestions: [knownSuggestion],
    });

    fetchAnalysisStub.resolves({
      suggestions: [
        { url: unknownUrl, aiSummary: 'Stale response for deleted page', valuable: true },
        { url: knownUrl, aiSummary: 'Good summary', valuable: true },
      ],
    });

    const ctx = buildGuidanceCtx({ siteId, opportunity });
    await guidanceHandler(buildMessage(siteId, oppId), ctx);

    // Unknown URL is skipped with a warning
    expect(ctx.log.warn).to.have.been.calledWithMatch(new RegExp(unknownUrl));
    // Known URL is still processed
    expect(knownSuggestion.setData).to.have.been.called;
  });

  // ─── Early exits ──────────────────────────────────────────────────────────

  it('missing presignedUrl in message → badRequest response', async () => {
    const ctx = buildGuidanceCtx({ siteId: 'site-bad-req' });
    const message = buildMessage('site-bad-req', 'opp-1', { presignedUrl: undefined });

    const result = await guidanceHandler(message, ctx);

    expect(result.status).to.equal(400);
  });

  it('missing opportunityId in message → badRequest response', async () => {
    const ctx = buildGuidanceCtx({ siteId: 'site-bad-opp' });
    const message = { siteId: 'site-bad-opp', data: { presignedUrl: 'https://s3.amazonaws.com/x.json' } };

    const result = await guidanceHandler(message, ctx);

    expect(result.status).to.equal(400);
  });

  it('opportunity not found in DB → notFound response', async () => {
    const siteId = 'site-no-opp';
    fetchAnalysisStub.resolves({ suggestions: [] });

    const ctx = buildGuidanceCtx({
      siteId,
      opportunity: null, // Opportunity.findById returns null
    });
    ctx.dataAccess.Opportunity.findById = sandbox.stub().resolves(null);

    const result = await guidanceHandler(buildMessage(siteId, 'opp-missing'), ctx);

    expect(result.status).to.equal(404);
  });
});
