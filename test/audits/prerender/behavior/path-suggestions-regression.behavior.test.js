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

/**
 * Pre-change regression behavioral tests for path-suggestions in the prerender handler.
 *
 * These tests document invariants that existed BEFORE the path-level-suggestions PR
 * and must continue to hold after it. They exercise processOpportunityAndSuggestions
 * and buildMergeDataFunction through the full handler flow (via esmock), ensuring:
 *
 * - Per-URL suggestion sync, data shape, and keying are unchanged
 * - Domain-wide suggestion preservation and keying are unchanged
 * - buildMergeDataFunction handles individual and domain-wide merges correctly
 * - Edge-deployed and SKIPPED domain-wide suggestions are preserved
 * - Multiple per-URL suggestions are all synced
 * - Return shape (opportunity + auditRunCandidates) is stable
 */

import esmock from 'esmock';
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { Suggestion } from '@adobe/spacecat-shared-data-access';
import { buildMergeDataFunction } from '../../../../src/prerender/handler.js';

use(sinonChai);

const BASE_URL = 'https://example.com';

function makeSuggestion(id, url, status = 'NEW', extraData = {}) {
  let currentStatus = status;
  let currentData = { url, ...extraData };
  return {
    getId: () => id,
    getStatus: () => currentStatus,
    setStatus: sinon.stub().callsFake((s) => { currentStatus = s; }),
    setUpdatedBy: sinon.stub(),
    getData: () => currentData,
    setData: sinon.stub().callsFake((d) => { currentData = d; }),
  };
}

/**
 * Builds a mock opportunity and runs processOpportunityAndSuggestions.
 */
async function runAudit(sandbox, existingSuggestions, opts = {}) {
  const {
    siteConfig = null,
    scrapeJobId = 'job-123',
    auditResults = [{
      url: `${BASE_URL}/page1`,
      needsPrerender: true,
      contentGainRatio: 2.0,
      wordCountBefore: 100,
      wordCountAfter: 200,
    }],
  } = opts;

  const addSuggestionsStub = sandbox.stub().resolves({ errorItems: [], createdItems: [] });

  const mockOpportunity = {
    getId: () => 'test-opp-id',
    getSiteId: () => 'test-site-id',
    getType: () => 'prerender',
    getSuggestions: sandbox.stub().resolves(existingSuggestions),
    addSuggestions: addSuggestionsStub,
  };

  const handler = await esmock('../../../../src/prerender/handler.js', {
    '../../../../src/common/opportunity.js': {
      convertToOpportunity: sandbox.stub().resolves(mockOpportunity),
    },
  });

  const auditData = {
    siteId: 'test-site',
    auditId: 'audit-123',
    scrapeJobId,
    auditResult: {
      urlsNeedingPrerender: auditResults.length,
      results: auditResults,
    },
  };

  const saveManyStub = sandbox.stub().resolves();
  const bulkUpdateStatusStub = sandbox.stub().resolves();

  const context = {
    log: {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    },
    dataAccess: {
      Suggestion: {
        saveMany: saveManyStub,
        bulkUpdateStatus: bulkUpdateStatusStub,
        STATUSES: Suggestion.STATUSES,
      },
      SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
    },
    site: {
      getId: () => 'test-site-id',
      getBaseURL: () => BASE_URL,
      getConfig: () => ({
        getHandlerConfig: () => siteConfig,
        getLlmoCdnlogsFilter: () => null,
      }),
      requiresValidation: false,
    },
  };

  const result = await handler.processOpportunityAndSuggestions(
    BASE_URL, auditData, context, true,
  );

  return {
    addSuggestionsStub,
    saveManyStub,
    bulkUpdateStatusStub,
    result,
    mockOpportunity,
  };
}

// ─── Per-URL suggestion sync ────────────────────────────────────────────────

describe('Prerender path-suggestions regression (behavior)', function () {
  this.timeout(10000);
  const sandbox = sinon.createSandbox();

  afterEach(() => sandbox.restore());

  it('per-URL suggestions are synced when path suggestions are disabled', async () => {
    const { addSuggestionsStub } = await runAudit(sandbox, [], { siteConfig: null });

    expect(addSuggestionsStub).to.have.been.called;
    const allAdded = addSuggestionsStub.args.flat(2);
    const urlSuggestions = allAdded.filter((s) => s?.data?.url === `${BASE_URL}/page1`);
    expect(urlSuggestions).to.have.length.above(0);
  });

  it('scrapeJobId is persisted in per-URL suggestion data', async () => {
    const jobId = 'scrape-job-xyz';
    const { addSuggestionsStub } = await runAudit(sandbox, [], { scrapeJobId: jobId });

    const allAdded = addSuggestionsStub.args.flat(2);
    const urlSuggestion = allAdded.find((s) => s?.data?.url === `${BASE_URL}/page1`);
    expect(urlSuggestion.data.scrapeJobId).to.equal(jobId);
  });

  it('per-URL suggestion data includes originalHtmlKey and prerenderedHtmlKey', async () => {
    const { addSuggestionsStub } = await runAudit(sandbox, [], { scrapeJobId: 'j-s3' });

    const allAdded = addSuggestionsStub.args.flat(2);
    const urlSuggestion = allAdded.find((s) => s?.data?.url === `${BASE_URL}/page1`);
    expect(urlSuggestion.data).to.have.property('originalHtmlKey')
      .that.includes('server-side.html');
    expect(urlSuggestion.data).to.have.property('prerenderedHtmlKey')
      .that.includes('client-side.html');
  });

  it('per-URL suggestion data includes citabilityScore', async () => {
    const { addSuggestionsStub } = await runAudit(sandbox, []);

    const allAdded = addSuggestionsStub.args.flat(2);
    const urlSuggestion = allAdded.find((s) => s?.data?.url === `${BASE_URL}/page1`);
    expect(urlSuggestion.data).to.have.property('citabilityScore');
  });

  it('multiple per-URL suggestions are all synced', async () => {
    const auditResults = [
      {
        url: `${BASE_URL}/page-a`, needsPrerender: true, contentGainRatio: 2.0, wordCountBefore: 50, wordCountAfter: 100,
      },
      {
        url: `${BASE_URL}/page-b`, needsPrerender: true, contentGainRatio: 3.0, wordCountBefore: 80, wordCountAfter: 240,
      },
      {
        url: `${BASE_URL}/page-c`, needsPrerender: true, contentGainRatio: 1.5, wordCountBefore: 60, wordCountAfter: 90,
      },
    ];

    const { addSuggestionsStub } = await runAudit(sandbox, [], { auditResults });

    const allAdded = addSuggestionsStub.args.flat(2);
    const urls = allAdded.map((s) => s?.data?.url).filter(Boolean);
    expect(urls).to.include(`${BASE_URL}/page-a`);
    expect(urls).to.include(`${BASE_URL}/page-b`);
    expect(urls).to.include(`${BASE_URL}/page-c`);
  });

  // ─── Return shape ──────────────────────────────────────────────────────────

  it('returns opportunity and auditRunCandidates array', async () => {
    const { result } = await runAudit(sandbox, []);

    expect(result).to.have.property('opportunity');
    expect(result).to.have.property('auditRunCandidates').that.is.an('array');
    expect(result.auditRunCandidates.length).to.be.greaterThan(0);
  });

  it('auditRunCandidates carry url, originalHtmlMarkdownKey, and markdownDiffKey', async () => {
    const { result } = await runAudit(sandbox, [], { scrapeJobId: 'job-md' });

    const [candidate] = result.auditRunCandidates;
    expect(candidate).to.have.property('url', `${BASE_URL}/page1`);
    expect(candidate).to.have.property('originalHtmlMarkdownKey')
      .that.includes('server-side-html.md');
    expect(candidate).to.have.property('markdownDiffKey')
      .that.includes('markdown-diff.md');
  });

  // ─── Domain-wide suggestion preservation ───────────────────────────────────

  it('domain-wide suggestion key does not conflict with per-URL key', async () => {
    const domainWide = makeSuggestion(
      'dw-1',
      `${BASE_URL}/* (All Domain URLs)`,
      'NEW',
      { isDomainWide: true, allowedRegexPatterns: ['/*'] },
    );

    const { addSuggestionsStub } = await runAudit(sandbox, [domainWide]);
    const allAdded = addSuggestionsStub.args.flat(2);

    // Preservable domain-wide exists → no new domain-wide created
    const newDomainWide = allAdded.filter((s) => s?.data?.isDomainWide === true);
    expect(newDomainWide).to.have.lengthOf(0);

    // Per-URL suggestion still created alongside
    const page1 = allAdded.filter((s) => s?.data?.url === `${BASE_URL}/page1`);
    expect(page1).to.have.length.above(0);
  });

  it('SKIPPED domain-wide suggestion is preserved (not replaced)', async () => {
    const skippedDw = makeSuggestion(
      'dw-skipped',
      `${BASE_URL}/* (All Domain URLs)`,
      'SKIPPED',
      { isDomainWide: true },
    );

    const { addSuggestionsStub } = await runAudit(sandbox, [skippedDw]);
    const allAdded = addSuggestionsStub.args.flat(2);

    // SKIPPED is in the preserve list — no new domain-wide created
    const newDomainWide = allAdded.filter((s) => s?.data?.isDomainWide === true);
    expect(newDomainWide).to.have.lengthOf(0);
  });

  it('edgeDeployed domain-wide suggestion is preserved (not replaced)', async () => {
    const deployedDw = makeSuggestion(
      'dw-deployed',
      `${BASE_URL}/* (All Domain URLs)`,
      'NEW',
      { isDomainWide: true, edgeDeployed: Date.now() },
    );

    const { addSuggestionsStub } = await runAudit(sandbox, [deployedDw]);
    const allAdded = addSuggestionsStub.args.flat(2);

    const newDomainWide = allAdded.filter((s) => s?.data?.isDomainWide === true);
    expect(newDomainWide).to.have.lengthOf(0);
  });

  it('OUTDATED domain-wide is NOT preserved — fresh domain-wide data is prepared and synced', async () => {
    const outdatedDw = makeSuggestion(
      'dw-outdated',
      `${BASE_URL}/* (All Domain URLs)`,
      'OUTDATED',
      { isDomainWide: true, contentGainRatio: 0 },
    );

    await runAudit(sandbox, [outdatedDw]);

    // OUTDATED is NOT in the preserve list → prepareDomainWideAggregateSuggestion runs
    // syncSuggestions matches by key and updates the existing OUTDATED one in place
    // (setData is called with the fresh aggregate data including the new contentGainRatio)
    expect(outdatedDw.setData).to.have.been.called;
    const updatedData = outdatedDw.setData.lastCall.args[0];
    expect(updatedData).to.have.property('isDomainWide', true);
    expect(updatedData.contentGainRatio).to.be.greaterThan(0);
  });

  // ─── coveredByPattern NOT applied when disabled ────────────────────────────

  it('Suggestion.saveMany not called to set coveredByPattern when path suggestions disabled', async () => {
    const { saveManyStub } = await runAudit(sandbox, [], { siteConfig: null });

    const allSaved = saveManyStub.args.flat(2);
    const coveredByPatternItems = allSaved.filter(
      (s) => typeof s?.getData === 'function' && s.getData()?.coveredByPattern,
    );
    expect(coveredByPatternItems).to.have.lengthOf(0);
  });

  it('existing path suggestion in DB is untouched when path suggestions disabled', async () => {
    const existingPath = makeSuggestion(
      'path-1',
      `${BASE_URL}/blog/*`,
      'NEW',
      { allowedRegexPatterns: ['/blog/*'] },
    );

    const { saveManyStub } = await runAudit(sandbox, [existingPath], { siteConfig: null });

    const allSaved = saveManyStub.args.flat(2);
    expect(allSaved).not.to.include(existingPath);
  });

  // ─── Edge-deployed per-URL protection ──────────────────────────────────────

  it('edge-deployed per-URL suggestion not passed to bulkUpdateStatus', async () => {
    const deployed = makeSuggestion(
      'sug-edge',
      `${BASE_URL}/deployed-page`,
      'NEW',
      { edgeDeployed: Date.now() },
    );

    const { bulkUpdateStatusStub } = await runAudit(sandbox, [deployed]);

    const allCandidates = bulkUpdateStatusStub.args.flat(2);
    expect(allCandidates).not.to.include(deployed);
  });

  it('non-deployed NEW suggestion absent from audit is passed to bulkUpdateStatus', async () => {
    const stale = makeSuggestion(
      'sug-stale',
      `${BASE_URL}/old-page`,
      'NEW',
    );

    const { bulkUpdateStatusStub } = await runAudit(sandbox, [stale]);

    expect(bulkUpdateStatusStub).to.have.been.called;
    const firstCallCandidates = bulkUpdateStatusStub.firstCall.args[0];
    expect(firstCallCandidates).to.include(stale);
  });
});

// ─── buildMergeDataFunction unit tests ───────────────────────────────────────
//
// These test the merge logic directly — the function existed inline in the old
// handler and was extracted + exported as buildMergeDataFunction in this PR.
// The behaviors below are pre-existing invariants.

describe('buildMergeDataFunction — regression invariants', () => {
  const mapSuggestionData = (s) => ({
    url: s.url,
    contentGainRatio: s.contentGainRatio,
    wordCountBefore: s.wordCountBefore,
    wordCountAfter: s.wordCountAfter,
  });
  const mergeData = buildMergeDataFunction(mapSuggestionData);

  it('individual suggestion: overlays existing data with mapped new fields', () => {
    const existing = { url: `${BASE_URL}/page1`, aiSummary: 'old summary', valuable: true };
    const newItem = {
      url: `${BASE_URL}/page1`, contentGainRatio: 3.0, wordCountBefore: 50, wordCountAfter: 150,
    };

    const result = mergeData(existing, newItem);

    // Existing fields preserved
    expect(result.aiSummary).to.equal('old summary');
    expect(result.valuable).to.equal(true);
    // New mapped fields applied
    expect(result.contentGainRatio).to.equal(3.0);
    expect(result.wordCountBefore).to.equal(50);
    expect(result.wordCountAfter).to.equal(150);
  });

  it('individual suggestion: new mapped data overwrites conflicting existing fields', () => {
    const existing = {
      url: `${BASE_URL}/page1`, contentGainRatio: 1.5, wordCountBefore: 30,
    };
    const newItem = {
      url: `${BASE_URL}/page1`, contentGainRatio: 4.0, wordCountBefore: 80, wordCountAfter: 320,
    };

    const result = mergeData(existing, newItem);

    expect(result.contentGainRatio).to.equal(4.0);
    expect(result.wordCountBefore).to.equal(80);
  });

  it('domain-wide suggestion: replaces data entirely', () => {
    const existing = {
      isDomainWide: true, contentGainRatio: 1.0, wordCountBefore: 100, pathPattern: '/*',
    };
    const newItem = {
      key: 'domain-wide-aggregate|prerender',
      data: {
        isDomainWide: true, contentGainRatio: 5.0, wordCountAfter: 1000, pathPattern: '/*',
      },
    };

    const result = mergeData(existing, newItem);

    // New data wins entirely
    expect(result.contentGainRatio).to.equal(5.0);
    expect(result.wordCountAfter).to.equal(1000);
    // Old field not in new data → absent (replaced, not merged)
    expect(result).to.not.have.property('wordCountBefore');
  });

  it('domain-wide suggestion: preserves edgeDeployed from existing', () => {
    const existing = {
      isDomainWide: true, edgeDeployed: '2025-06-15T00:00:00Z', contentGainRatio: 1.0,
    };
    const newItem = {
      key: 'domain-wide-aggregate|prerender',
      data: { isDomainWide: true, contentGainRatio: 5.0 },
    };

    const result = mergeData(existing, newItem);

    expect(result.edgeDeployed).to.equal('2025-06-15T00:00:00Z');
    expect(result.contentGainRatio).to.equal(5.0);
  });

  it('domain-wide suggestion: does not inject edgeDeployed when absent from existing', () => {
    const existing = { isDomainWide: true, contentGainRatio: 1.0 };
    const newItem = {
      key: 'domain-wide-aggregate|prerender',
      data: { isDomainWide: true, contentGainRatio: 5.0 },
    };

    const result = mergeData(existing, newItem);

    expect(result).to.not.have.property('edgeDeployed');
  });
});
