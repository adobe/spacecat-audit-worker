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
 * Behavioural contracts: suggestion lifecycle in Step 3
 *
 * Covers Branch C (no prerender URLs → OUTDATED), edge-deployed URL exclusion from
 * scrapedUrlsSet (prevents false-positive OUTDATED), domain-wide suggestion preservation,
 * and detectWrongEdgeDeployedStatus unconditional execution.
 *
 * All tests use a scrapeResultPaths map + S3 HTML stubs so compareHtmlContent runs
 * without esmock.  detectBotBlocker is never reached (ratio < 0.5 in all setups).
 */

/* eslint-env mocha */
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { processContentAndGenerateOpportunities } from '../../../../src/prerender/handler.js';
import {
  processOpportunityAndSuggestions,
} from '../../../../src/prerender/opportunity-syncer.js';
import {
  buildContext,
  buildSite,
  buildS3Client,
  buildDataAccess,
  buildSuggestion,
  buildOpportunity,
  buildUrlS3Content,
  statusKey,
  buildStatus,
  HTML_SERVER_SPARSE,
  HTML_CLIENT_NEEDS_PRERENDER,
} from './helpers.js';

use(sinonChai);

describe('Prerender behaviour — suggestion lifecycle (Step 3)', () => {
  let sandbox;

  beforeEach(() => { sandbox = sinon.createSandbox(); });
  afterEach(() => { sandbox.restore(); });

  /**
   * Builds a minimal step-3 context for a single URL that produces no prerender result.
   * Server and client HTML are identical → contentGainRatio ≈ 1.0 < 1.1 threshold.
   * scrape.json has isDeployedAtEdge: false → URL lands in scrapedUrlsSet.
   */
  function buildNoPreRenderCtx(siteId, scrapeJobId, url, overrides = {}) {
    return buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox, {
        [statusKey(siteId)]: buildStatus(),
        ...buildUrlS3Content(scrapeJobId, url),
        ...overrides.extraS3,
      }),
      dataAccess: buildDataAccess(sandbox, {
        scrapeUrls: [url],
        ...overrides.dataAccess,
      }),
      scrapeResultPaths: new Map([[url, {}]]),
      auditContext: { scrapeJobId },
      ...overrides.ctx,
    });
  }

  it('Branch C: no prerender URLs + existing opportunity → suggestions marked OUTDATED', async () => {
    const siteId = 'site-outdated';
    const scrapeJobId = 'job-outdated';
    const url = 'https://example.com/page-1';

    const suggestion = buildSuggestion(sandbox, {
      id: 'sug-1',
      status: 'NEW',
      data: { url },
    });
    const opportunity = buildOpportunity(sandbox, {
      suggestions: [suggestion],
    });

    const ctx = buildNoPreRenderCtx(siteId, scrapeJobId, url, {
      dataAccess: {
        opportunities: [opportunity],
        scrapeUrls: [url],
      },
    });

    await processContentAndGenerateOpportunities(ctx);

    // syncSuggestions calls bulkUpdateStatus to mark outdated suggestions
    expect(ctx.dataAccess.Suggestion.bulkUpdateStatus).to.have.been.calledOnce;
    const [outdatedSuggestions] = ctx.dataAccess.Suggestion.bulkUpdateStatus.firstCall.args;
    expect(outdatedSuggestions).to.deep.include(suggestion);
  });

  it('user-action status (SKIPPED) suggestion is NOT marked OUTDATED even when its URL was scraped', async () => {
    // The audit worker must never overwrite user-set statuses (SKIPPED, APPROVED, FIXED,
    // REJECTED, IN_PROGRESS). This is Branch C: URL scraped, no prerender needed,
    // existing opportunity found — but the suggestion was dismissed by the user.
    const siteId = 'site-skipped-protected';
    const scrapeJobId = 'job-skipped';
    const url = 'https://example.com/user-skipped-page';

    const skippedSuggestion = buildSuggestion(sandbox, {
      id: 'sug-skipped',
      status: 'SKIPPED',
      data: { url },
    });
    const opportunity = buildOpportunity(sandbox, {
      suggestions: [skippedSuggestion],
    });

    // URL is scraped this run (in scrapeResultPaths), HTML identical → no prerender → Branch C
    const ctx = buildNoPreRenderCtx(siteId, scrapeJobId, url, {
      dataAccess: {
        opportunities: [opportunity],
        scrapeUrls: [url],
      },
    });

    await processContentAndGenerateOpportunities(ctx);

    // bulkUpdateStatus must NOT be called with the SKIPPED suggestion
    const bulkCalls = ctx.dataAccess.Suggestion.bulkUpdateStatus.getCalls();
    const markedOutdated = bulkCalls.flatMap((c) => c.args[0]);
    expect(markedOutdated).to.not.deep.include(skippedSuggestion);
  });

  it('edge-deployed URL excluded from scrapedUrlsSet → its suggestion NOT marked OUTDATED', async () => {
    const siteId = 'site-edge-not-outdated';
    const scrapeJobId = 'job-edge';
    const deployedUrl = 'https://example.com/deployed-page';

    const suggestion = buildSuggestion(sandbox, {
      id: 'sug-deployed',
      status: 'NEW',
      data: { url: deployedUrl },
    });
    const opportunity = buildOpportunity(sandbox, { suggestions: [suggestion] });

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox, {
        [statusKey(siteId)]: buildStatus(),
        // scrape.json reports isDeployedAtEdge: true → excluded from scrapedUrlsSet
        ...buildUrlS3Content(scrapeJobId, deployedUrl, {
          scrapeJson: { isDeployedAtEdge: true },
        }),
      }),
      dataAccess: buildDataAccess(sandbox, {
        opportunities: [opportunity],
        scrapeUrls: [deployedUrl],
      }),
      scrapeResultPaths: new Map([[deployedUrl, {}]]),
      auditContext: { scrapeJobId },
    });

    await processContentAndGenerateOpportunities(ctx);

    // bulkUpdateStatus must NOT be called with the edge-deployed suggestion
    const bulkCalls = ctx.dataAccess.Suggestion.bulkUpdateStatus.getCalls();
    const markedOutdated = bulkCalls.flatMap((c) => c.args[0]);
    expect(markedOutdated).to.not.deep.include(suggestion);
  });

  it('domain-wide suggestion with status=NEW is preserved across audit runs (Branch C)', async () => {
    const siteId = 'site-dw-preserved';
    const scrapeJobId = 'job-dw-preserve';
    const url = 'https://example.com/page-1';

    const domainWideSuggestion = buildSuggestion(sandbox, {
      id: 'sug-dw',
      status: 'NEW',
      // isDomainWide=true → handleOutdatedSuggestions skips this suggestion
      data: {
        url: 'https://example.com/* (All Domain URLs)',
        isDomainWide: true,
      },
    });
    const regularSuggestion = buildSuggestion(sandbox, {
      id: 'sug-regular',
      status: 'NEW',
      data: { url },
    });
    const opportunity = buildOpportunity(sandbox, {
      suggestions: [domainWideSuggestion, regularSuggestion],
    });

    const ctx = buildNoPreRenderCtx(siteId, scrapeJobId, url, {
      dataAccess: {
        opportunities: [opportunity],
        scrapeUrls: [url],
      },
    });

    await processContentAndGenerateOpportunities(ctx);

    // Domain-wide suggestion must NOT appear in the outdated list
    const bulkCalls = ctx.dataAccess.Suggestion.bulkUpdateStatus.getCalls();
    const markedOutdated = bulkCalls.flatMap((c) => c.args[0]);
    expect(markedOutdated).to.not.deep.include(domainWideSuggestion);
    // Regular suggestion (URL in scrapedUrlsSet) IS marked outdated
    expect(markedOutdated).to.deep.include(regularSuggestion);
  });

  // ─── Suggestion update vs create ────────────────────────────────────────────

  // ─── Suggestion merge contracts ───────────────────────────────────────────────

  it('Branch A merge: Mystique fields (aiSummary, valuable) survive a re-scrape audit', async () => {
    // mergeDataFunction for individual suggestions = { ...existingData, ...mapSuggestionData(new) }
    // mapSuggestionData only maps word-count + S3-key fields — aiSummary and valuable
    // are NOT in it, so they must be preserved from existingData on every re-scrape.
    // (This path is marked /* c8 ignore next 5 */ in handler.js — zero prior coverage.)
    const siteId = 'site-merge-ai';
    const scrapeJobId = 'job-merge-ai';
    const url = 'https://example.com/page-merge';

    const existingSuggestion = buildSuggestion(sandbox, {
      id: 'sug-with-ai',
      status: 'NEW',
      data: {
        url,
        wordCountBefore: 5,
        wordCountAfter: 50,
        contentGainRatio: 2.0,
        aiSummary: 'Previously set by Mystique',
        valuable: true,
        scrapeJobId: 'old-job-id',
      },
    });

    const opportunity = buildOpportunity(sandbox, {
      siteId,
      suggestions: [existingSuggestion],
    });

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox),
      dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
    });

    // Re-scrape produces updated word counts but no aiSummary
    await processOpportunityAndSuggestions('https://example.com', {
      siteId,
      id: 'audit-id',
      auditId: 'audit-id',
      auditResult: {
        urlsNeedingPrerender: 1,
        results: [{
          url, needsPrerender: true, contentGainRatio: 10.0,
          wordCountBefore: 8, wordCountAfter: 90, citabilityScore: 1, isDeployedAtEdge: false,
        }],
      },
      scrapeJobId,
      scrapedUrlsSet: new Set([url]),
    }, ctx, false);

    expect(existingSuggestion.setData).to.have.been.called;
    const [mergedData] = existingSuggestion.setData.firstCall.args;

    // New scrape data overwrites metric fields
    expect(mergedData).to.have.property('wordCountBefore', 8);
    expect(mergedData).to.have.property('wordCountAfter', 90);
    expect(mergedData).to.have.property('contentGainRatio', 10.0);

    // Mystique-set fields MUST be preserved — not wiped by re-scrape
    expect(mergedData).to.have.property('aiSummary', 'Previously set by Mystique');
    expect(mergedData).to.have.property('valuable', true);
  });

  it('Branch A merge: domain-wide suggestion data is fully replaced (not merged) on update', async () => {
    // mergeDataFunction for domain-wide = { ...newDataItem.data } — complete replacement.
    // Any field that only existed in the old domain-wide data must NOT survive the merge.
    const siteId = 'site-merge-dw';
    const scrapeJobId = 'job-merge-dw';
    const url = 'https://example.com/page-dw-merge';

    const existingDomainWideSuggestion = buildSuggestion(sandbox, {
      id: 'sug-dw-old',
      // Must be OUTDATED (not NEW/FIXED/PENDING_VALIDATION/SKIPPED) so that
      // shouldPreserveDomainWideSuggestion returns false and a fresh domain-wide
      // item is created — triggering the merge path.
      status: 'OUTDATED',
      data: {
        key: 'domain-wide-aggregate|prerender',
        url: 'https://example.com/* (All Domain URLs)',
        isDomainWide: true,
        wordCountBefore: 100,
        wordCountAfter: 200,
        signalField: 'must-not-survive', // canary — proves replacement, not merge
      },
    });

    const opportunity = buildOpportunity(sandbox, {
      siteId,
      suggestions: [existingDomainWideSuggestion],
    });

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox),
      dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
    });

    await processOpportunityAndSuggestions('https://example.com', {
      siteId,
      id: 'audit-id',
      auditId: 'audit-id',
      auditResult: {
        urlsNeedingPrerender: 1,
        results: [{
          url, needsPrerender: true, contentGainRatio: 8.0,
          wordCountBefore: 10, wordCountAfter: 80, citabilityScore: 1, isDeployedAtEdge: false,
        }],
      },
      scrapeJobId,
      scrapedUrlsSet: new Set([url]),
    }, ctx, false);

    expect(existingDomainWideSuggestion.setData).to.have.been.called;
    const [mergedData] = existingDomainWideSuggestion.setData.firstCall.args;

    // canary field must be gone — domain-wide merge is a full replacement
    expect(mergedData).to.not.have.property('signalField');
    // new data is present
    expect(mergedData).to.have.property('isDomainWide', true);
  });

  it('Branch A: existing suggestion matched by URL key is updated in-place, not duplicated', async () => {
    // syncSuggestions uses buildKey = url|prerender for per-URL suggestions.
    // When an existing suggestion has the same URL, it must be updated via saveMany,
    // not re-created via addSuggestions — otherwise each audit run duplicates rows.
    const siteId = 'site-update-key';
    const scrapeJobId = 'job-update';
    const url = 'https://example.com/page-1';

    const existingSuggestion = buildSuggestion(sandbox, {
      id: 'sug-existing',
      status: 'NEW',
      data: { url, wordCountBefore: 5, wordCountAfter: 50, scrapeJobId },
    });

    const opportunity = buildOpportunity(sandbox, {
      siteId,
      suggestions: [existingSuggestion],
    });

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox),
      dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
    });

    await processOpportunityAndSuggestions('https://example.com', {
      siteId,
      id: 'audit-id',
      auditId: 'audit-id',
      auditResult: {
        urlsNeedingPrerender: 1,
        results: [{
          url, needsPrerender: true, contentGainRatio: 8.4,
          wordCountBefore: 10, wordCountAfter: 84, citabilityScore: 1, isDeployedAtEdge: false,
        }],
      },
      scrapeJobId,
      scrapedUrlsSet: new Set([url]),
    }, ctx, false);

    // saveMany was called → existing suggestion was updated
    expect(ctx.dataAccess.Suggestion.saveMany).to.have.been.called;

    // addSuggestions was NOT called with a new suggestion for the same URL
    // (it may be called once for the domain-wide aggregate, never for page-1)
    const newlyAdded = opportunity.addSuggestions.called
      ? opportunity.addSuggestions.firstCall.args[0]
      : [];
    const duplicateForUrl = newlyAdded.find((s) => s.data?.url === url);
    expect(duplicateForUrl, 'existing URL must not produce a duplicate suggestion').to.be.undefined;
  });

  it('audit worker does not change suggestion status during a normal Branch A update', async () => {
    // defaultMergeStatusFunction returns null for APPROVED/NEW/FIXED (all non-OUTDATED,
    // non-REJECTED statuses) → setStatus is never called on those suggestions.
    // Only the system-initiated OUTDATED transition and regression recovery change status.
    const siteId = 'site-status-invariant';
    const scrapeJobId = 'job-status';
    const url = 'https://example.com/page-approved';

    const approvedSuggestion = buildSuggestion(sandbox, {
      id: 'sug-approved',
      status: 'APPROVED',
      data: { url, wordCountBefore: 5, wordCountAfter: 80, scrapeJobId },
    });

    const opportunity = buildOpportunity(sandbox, {
      siteId,
      suggestions: [approvedSuggestion],
    });

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox),
      dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
    });

    await processOpportunityAndSuggestions('https://example.com', {
      siteId,
      id: 'audit-id',
      auditId: 'audit-id',
      auditResult: {
        urlsNeedingPrerender: 1,
        results: [{
          url, needsPrerender: true, contentGainRatio: 9.0,
          wordCountBefore: 5, wordCountAfter: 80, citabilityScore: 1, isDeployedAtEdge: false,
        }],
      },
      scrapeJobId,
      scrapedUrlsSet: new Set([url]),
    }, ctx, false);

    // setStatus must NOT have been called — audit worker only updates data, not status
    expect(approvedSuggestion.setStatus).to.not.have.been.called;
  });

  it('needsPrerender=false for a scraped URL — its existing suggestion is marked OUTDATED', async () => {
    // Branch A fires (prerenderUrl needs prerender).
    // noPreRenderUrl was scraped (in scrapedUrlsSet) but its ratio < 1.1 → needsPrerender=false.
    // Its existing suggestion is NOT in urlsNeedingPrerender → syncSuggestions marks it OUTDATED.
    const siteId = 'site-mixed-prerender';
    const scrapeJobId = 'job-mixed';
    const prerenderUrl = 'https://example.com/needs-prerender';
    const noPreRenderUrl = 'https://example.com/no-prerender';

    const noPreRenderSuggestion = buildSuggestion(sandbox, {
      id: 'sug-no-prerender',
      status: 'NEW',
      data: { url: noPreRenderUrl },
    });

    const opportunity = buildOpportunity(sandbox, {
      siteId,
      suggestions: [noPreRenderSuggestion],
    });

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox, {
        [statusKey(siteId)]: buildStatus(),
        // prerenderUrl: sparse server + rich client → needsPrerender=true
        ...buildUrlS3Content(scrapeJobId, prerenderUrl, {
          serverHtml: HTML_SERVER_SPARSE,
          clientHtml: HTML_CLIENT_NEEDS_PRERENDER,
        }),
        // noPreRenderUrl: identical HTML → contentGainRatio ≈ 1.0 → needsPrerender=false
        ...buildUrlS3Content(scrapeJobId, noPreRenderUrl),
      }),
      dataAccess: buildDataAccess(sandbox, {
        scrapeUrls: [prerenderUrl, noPreRenderUrl],
        opportunities: [opportunity],
      }),
      scrapeResultPaths: new Map([[prerenderUrl, {}], [noPreRenderUrl, {}]]),
      auditContext: { scrapeJobId },
    });

    await processContentAndGenerateOpportunities(ctx);

    // noPreRenderUrl is in scrapedUrlsSet but not in urlsNeedingPrerender → OUTDATED
    const bulkCalls = ctx.dataAccess.Suggestion.bulkUpdateStatus.getCalls();
    const markedOutdated = bulkCalls.flatMap((c) => c.args[0]);
    expect(markedOutdated).to.deep.include(noPreRenderSuggestion);
  });

  it('detectWrongEdgeDeployedStatus runs unconditionally even when isDomainBlocked=true', async () => {
    // This diagnostic function fires before the domainBlocked short-circuit so
    // invariant violations are always surfaced regardless of scrape state.
    const siteId = 'site-invariant';

    const violatingSuggestion = buildSuggestion(sandbox, {
      id: 'sug-bad',
      status: 'APPROVED', // non-NEW
      data: {
        url: 'https://example.com/page-1',
        edgeDeployed: new Date().toISOString(), // non-NEW + edgeDeployed = invariant violation
      },
    });
    const opportunity = buildOpportunity(sandbox, { suggestions: [violatingSuggestion] });

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox),
      dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      auditContext: { domainBlocked: true },
    });

    await processContentAndGenerateOpportunities(ctx);

    // detectWrongEdgeDeployedStatus emits this specific warning
    expect(ctx.log.warn).to.have.been.calledWithMatch(/nonNewEdgeDeployedCount=1/);
  });
});

describe('Prerender behaviour — coveredByDomainWide marking (Step 3)', () => {
  let sandbox;

  beforeEach(() => { sandbox = sinon.createSandbox(); });
  afterEach(() => { sandbox.restore(); });

  it('NEW suggestion for edge-deployed URL is marked coveredByDomainWide when domain-wide suggestion has edgeDeployed set', async () => {
    const siteId = 'site-covered-dw';
    const scrapeJobId = 'job-covered-dw';
    const prerenderUrl = 'https://example.com/needs-prerender';
    const deployedUrl = 'https://example.com/deployed-page';
    const domainWideSugId = 'dw-sug-edge-deployed';

    // Domain-wide suggestion: NEW + isDomainWide=true + edgeDeployed → triggers the marking
    const domainWideSuggestion = buildSuggestion(sandbox, {
      id: domainWideSugId,
      status: 'NEW',
      data: {
        url: 'https://example.com/* (All Domain URLs)',
        isDomainWide: true,
        edgeDeployed: new Date().toISOString(),
      },
    });

    // Regular suggestion for the edge-deployed URL — to be marked coveredByDomainWide
    const deployedPageSuggestion = buildSuggestion(sandbox, {
      id: 'page-sug-deployed',
      status: 'NEW',
      data: { url: deployedUrl },
    });

    const opportunity = buildOpportunity(sandbox, {
      siteId,
      suggestions: [domainWideSuggestion],
    });

    const dataAccess = buildDataAccess(sandbox, {
      opportunities: [opportunity],
      scrapeUrls: [prerenderUrl, deployedUrl],
    });

    // allByOpportunityIdAndStatus(NEW) is called by markDeployedUrlSuggestionsAsCovered
    dataAccess.Suggestion.allByOpportunityIdAndStatus = sandbox.stub().resolves([deployedPageSuggestion]);

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox, {
        [statusKey(siteId)]: buildStatus(),
        // prerenderUrl: sparse server + rich client → needsPrerender=true → Branch A fires
        ...buildUrlS3Content(scrapeJobId, prerenderUrl, {
          serverHtml: HTML_SERVER_SPARSE,
          clientHtml: HTML_CLIENT_NEEDS_PRERENDER,
        }),
        // deployedUrl: any HTML but scrape.json reports isDeployedAtEdge=true
        ...buildUrlS3Content(scrapeJobId, deployedUrl, {
          scrapeJson: { isDeployedAtEdge: true },
        }),
      }),
      dataAccess,
      scrapeResultPaths: new Map([[prerenderUrl, {}], [deployedUrl, {}]]),
      auditContext: { scrapeJobId },
    });

    await processContentAndGenerateOpportunities(ctx);

    // deployedPageSuggestion.setData should have been called with coveredByDomainWide
    expect(deployedPageSuggestion.setData).to.have.been.called;
    const [updatedData] = deployedPageSuggestion.setData.firstCall.args;
    expect(updatedData).to.have.property('coveredByDomainWide', domainWideSugId);

    // saveMany must be called with the covered suggestion
    const allSaveManyCalls = dataAccess.Suggestion.saveMany.getCalls();
    const coveredSaveCall = allSaveManyCalls.find(
      (c) => c.args[0]?.some?.((s) => s === deployedPageSuggestion),
    );
    expect(coveredSaveCall, 'saveMany must be called with the covered suggestion').to.not.be.undefined;
  });
});
