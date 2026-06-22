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
} from '../../../../src/prerender/handler.js';
import { handleAiOnlyMode } from '../../../../src/prerender/ai-only-handler.js';
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
 * Reads the candidate suggestion payload sent to Mystique.
 *
 * Since the presigned-URL change, the candidate array is uploaded to S3 (the
 * PutObjectCommand body keyed `prerender/mystique-suggestions/{opportunityId}.json`)
 * and the SQS message carries only `data.suggestionsS3Key` — not the inline array.
 * This extracts and parses that uploaded payload.
 */
function uploadedSuggestions(ctx) {
  const putCall = ctx.s3Client.send.getCalls()
    .find((c) => c.args[0]?.input?.Key?.includes('mystique-suggestions'));
  expect(putCall, 'expected a PutObject upload to mystique-suggestions').to.not.be.undefined;
  return JSON.parse(putCall.args[0].input.Body);
}

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
    // Payload is uploaded to S3; the SQS message references it by key.
    expect(message.data).to.have.property('suggestionsS3Key').that.is.a('string');

    // Each uploaded suggestion carries the URL so Mystique can match it on response
    const suggestions = uploadedSuggestions(ctx);
    expect(suggestions).to.be.an('array').with.length.greaterThan(0);
    expect(suggestions[0]).to.have.property('url', url);
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
    const suggestionUrls = uploadedSuggestions(ctx).map((s) => s.url);
    expect(suggestionUrls).to.not.include(fixedUrl);
    expect(suggestionUrls).to.include(newUrl);
  });

  it('ai-only: suggestion with originalHtmlKey but no scrapeJobId → scrapeJobId derived from S3 path (fallback path 2)', async () => {
    // D-02 fallback chain: data.scrapeJobId → extract from data.originalHtmlKey path[2] → null
    // Path 2: scrapeJobId absent on data, but originalHtmlKey = 'prerender/scrapes/{jobId}/...'
    // → effectiveScrapeJobId derived as parts[2], log.debug emitted, suggestion included in SQS.
    const siteId = 'site-ai-fallback-path2';
    const oppId = 'opp-ai-fallback-path2';
    const derivedJobId = 'derived-job-from-html-key';
    const url = 'https://example.com/needs-ai';

    const suggestion = buildSuggestion(sandbox, {
      id: 'sug-fallback',
      status: 'NEW',
      data: {
        url,
        // no scrapeJobId — forces fallback to originalHtmlKey extraction
        originalHtmlKey: `prerender/scrapes/${derivedJobId}/needs-ai/server-side.html`,
      },
    });

    const opportunity = buildOpportunity(sandbox, { id: oppId, siteId, suggestions: [suggestion] });
    const dataAccess = buildDataAccess(sandbox, { opportunities: [opportunity] });
    dataAccess.Opportunity.findById = sandbox.stub().resolves(opportunity);

    // Provide an audit-level scrapeJobId so handleAiOnlyMode doesn't fail on the status.json check
    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId }),
      dataAccess,
      data: { opportunityId: oppId, scrapeJobId: 'audit-level-job' },
    });

    await handleAiOnlyMode(ctx);

    // Suggestion must be included in SQS despite missing data.scrapeJobId
    expect(ctx.sqs.sendMessage).to.have.been.called;
    const suggestionUrls = uploadedSuggestions(ctx).map((s) => s.url);
    expect(suggestionUrls).to.include(url);

    // The derivation must be logged at debug level
    expect(ctx.log.debug).to.have.been.calledWithMatch(/derived from originalHtmlKey/);
  });

  it('ai-only: suggestion with neither scrapeJobId nor originalHtmlKey → skipped with warn (fallback path 3)', async () => {
    // D-02 fallback chain: when both data.scrapeJobId and data.originalHtmlKey are absent,
    // the suggestion is skipped and log.warn emitted. Other valid suggestions still go to Mystique.
    const siteId = 'site-ai-fallback-path3';
    const oppId = 'opp-ai-fallback-path3';
    const scrapeJobId = 'job-path3';
    const skippedUrl = 'https://example.com/no-job-id';
    const validUrl = 'https://example.com/valid';

    const skippedSuggestion = buildSuggestion(sandbox, {
      id: 'sug-no-job',
      status: 'NEW',
      data: { url: skippedUrl /* no scrapeJobId, no originalHtmlKey */ },
    });
    const validSuggestion = buildSuggestion(sandbox, {
      id: 'sug-valid',
      status: 'NEW',
      data: { url: validUrl, scrapeJobId },
    });

    const opportunity = buildOpportunity(sandbox, {
      id: oppId, siteId, suggestions: [skippedSuggestion, validSuggestion],
    });
    const dataAccess = buildDataAccess(sandbox, { opportunities: [opportunity] });
    dataAccess.Opportunity.findById = sandbox.stub().resolves(opportunity);

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId }),
      dataAccess,
      data: { opportunityId: oppId, scrapeJobId },
    });

    await handleAiOnlyMode(ctx);

    // Valid suggestion still sent; skipped suggestion absent
    expect(ctx.sqs.sendMessage).to.have.been.called;
    const suggestionUrls = uploadedSuggestions(ctx).map((s) => s.url);
    expect(suggestionUrls).to.include(validUrl);
    expect(suggestionUrls).to.not.include(skippedUrl);

    // The skip must be observable via warn log
    expect(ctx.log.warn).to.have.been.calledWithMatch(/no scrapeJobId and no originalHtmlKey/);
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
    const suggestionUrls = uploadedSuggestions(ctx).map((s) => s.url);
    expect(suggestionUrls).to.not.include(edgeUrl);
    expect(suggestionUrls).to.include(newUrl);
  });

  it('ai-only: uploaded candidate carries the S3 markdown keys and hasPrompts flag', async () => {
    // The Mystique payload contract: each candidate must carry the originalHtmlMarkdownKey
    // and markdownDiffKey (so Mystique can fetch the diff) plus a hasPrompts hint.
    const siteId = 'site-ai-shape';
    const oppId = 'opp-ai-shape';
    const scrapeJobId = 'job-ai-shape';
    const url = 'https://example.com/needs-summary';

    const suggestion = buildSuggestion(sandbox, {
      id: 'sug-shape',
      status: 'NEW',
      data: { url, scrapeJobId, prompts: [{ q: 'existing' }] },
    });
    const opportunity = buildOpportunity(sandbox, { id: oppId, siteId, suggestions: [suggestion] });
    const dataAccess = buildDataAccess(sandbox, { opportunities: [opportunity] });
    dataAccess.Opportunity.findById = sandbox.stub().resolves(opportunity);

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId }),
      dataAccess,
      data: { opportunityId: oppId, scrapeJobId },
    });

    await handleAiOnlyMode(ctx);

    const [candidate] = uploadedSuggestions(ctx);
    expect(candidate).to.have.property('url', url);
    expect(candidate).to.have.property('originalHtmlMarkdownKey').that.is.a('string')
      .and.includes('server-side-html.md');
    expect(candidate).to.have.property('markdownDiffKey').that.is.a('string')
      .and.includes('markdown-diff.md');
    // prompts present on the suggestion → hasPrompts true
    expect(candidate).to.have.property('hasPrompts', true);
  });

  it('ai-only: SKIPPED suggestion excluded from Mystique payload', async () => {
    const siteId = 'site-ai-skipped';
    const oppId = 'opp-ai-skipped';
    const scrapeJobId = 'job-ai-skipped';
    const skippedUrl = 'https://example.com/skipped-page';
    const newUrl = 'https://example.com/new-page';

    const skipped = buildSuggestion(sandbox, {
      id: 'sug-skipped',
      status: 'SKIPPED',
      data: { url: skippedUrl, scrapeJobId },
    });
    const fresh = buildSuggestion(sandbox, {
      id: 'sug-new',
      status: 'NEW',
      data: { url: newUrl, scrapeJobId },
    });
    const opportunity = buildOpportunity(sandbox, {
      id: oppId, siteId, suggestions: [skipped, fresh],
    });
    const dataAccess = buildDataAccess(sandbox, { opportunities: [opportunity] });
    dataAccess.Opportunity.findById = sandbox.stub().resolves(opportunity);

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId }),
      dataAccess,
      data: { opportunityId: oppId, scrapeJobId },
    });

    await handleAiOnlyMode(ctx);

    const suggestionUrls = uploadedSuggestions(ctx).map((s) => s.url);
    expect(suggestionUrls).to.not.include(skippedUrl);
    expect(suggestionUrls).to.include(newUrl);
  });

  it('ai-only: domain-wide aggregate suggestion excluded from Mystique payload', async () => {
    const siteId = 'site-ai-dw';
    const oppId = 'opp-ai-dw';
    const scrapeJobId = 'job-ai-dw';
    const domainWideUrl = 'https://example.com/* (All Domain URLs)';
    const newUrl = 'https://example.com/real-page';

    const domainWide = buildSuggestion(sandbox, {
      id: 'sug-dw',
      status: 'NEW',
      data: { url: domainWideUrl, isDomainWide: true, scrapeJobId },
    });
    const fresh = buildSuggestion(sandbox, {
      id: 'sug-new',
      status: 'NEW',
      data: { url: newUrl, scrapeJobId },
    });
    const opportunity = buildOpportunity(sandbox, {
      id: oppId, siteId, suggestions: [domainWide, fresh],
    });
    const dataAccess = buildDataAccess(sandbox, { opportunities: [opportunity] });
    dataAccess.Opportunity.findById = sandbox.stub().resolves(opportunity);

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId }),
      dataAccess,
      data: { opportunityId: oppId, scrapeJobId },
    });

    await handleAiOnlyMode(ctx);

    const suggestionUrls = uploadedSuggestions(ctx).map((s) => s.url);
    expect(suggestionUrls).to.not.include(domainWideUrl);
    expect(suggestionUrls).to.include(newUrl);
  });

  it('ai-only: wildcard-URL suggestion excluded from Mystique payload', async () => {
    const siteId = 'site-ai-wild';
    const oppId = 'opp-ai-wild';
    const scrapeJobId = 'job-ai-wild';
    const wildcardUrl = 'https://example.com/section/*';
    const newUrl = 'https://example.com/concrete-page';

    const wildcard = buildSuggestion(sandbox, {
      id: 'sug-wild',
      status: 'NEW',
      data: { url: wildcardUrl, scrapeJobId },
    });
    const fresh = buildSuggestion(sandbox, {
      id: 'sug-new',
      status: 'NEW',
      data: { url: newUrl, scrapeJobId },
    });
    const opportunity = buildOpportunity(sandbox, {
      id: oppId, siteId, suggestions: [wildcard, fresh],
    });
    const dataAccess = buildDataAccess(sandbox, { opportunities: [opportunity] });
    dataAccess.Opportunity.findById = sandbox.stub().resolves(opportunity);

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId }),
      dataAccess,
      data: { opportunityId: oppId, scrapeJobId },
    });

    await handleAiOnlyMode(ctx);

    const suggestionUrls = uploadedSuggestions(ctx).map((s) => s.url);
    expect(suggestionUrls).to.not.include(wildcardUrl);
    expect(suggestionUrls).to.include(newUrl);
  });

  it('ai-only-missing: FIXED suggestion without aiSummary IS included in the payload', async () => {
    // Per-mode eligibility lives in buildUrlScopeForMode: ai-only-missing intentionally includes
    // NEW *and* FIXED suggestions that lack an aiSummary. The candidate builder must not re-exclude
    // FIXED (it trusts urlScope) — otherwise FIXED-without-summary pages would never get a summary.
    const siteId = 'site-ai-missing-fixed';
    const oppId = 'opp-ai-missing-fixed';
    const scrapeJobId = 'job-ai-missing-fixed';
    const fixedNoSummary = 'https://example.com/fixed-no-summary';
    const newWithSummary = 'https://example.com/new-with-summary';

    const fixed = buildSuggestion(sandbox, {
      id: 'sug-fixed-missing',
      status: 'FIXED',
      data: { url: fixedNoSummary, scrapeJobId }, // no aiSummary → eligible for ai-only-missing
    });
    const hasSummary = buildSuggestion(sandbox, {
      id: 'sug-has-summary',
      status: 'NEW',
      data: { url: newWithSummary, scrapeJobId, aiSummary: 'already summarised' },
    });
    const opportunity = buildOpportunity(sandbox, {
      id: oppId, siteId, suggestions: [fixed, hasSummary],
    });
    const dataAccess = buildDataAccess(sandbox, { opportunities: [opportunity] });
    dataAccess.Opportunity.findById = sandbox.stub().resolves(opportunity);

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId }),
      dataAccess,
      data: { mode: 'ai-only-missing', opportunityId: oppId, scrapeJobId },
    });

    await handleAiOnlyMode(ctx);

    const suggestionUrls = uploadedSuggestions(ctx).map((s) => s.url);
    expect(suggestionUrls).to.include(fixedNoSummary); // FIXED-without-summary IS sent
    expect(suggestionUrls).to.not.include(newWithSummary); // already summarised → excluded
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
