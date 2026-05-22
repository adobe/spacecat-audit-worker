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
 * Realistic compound scenarios — high-importance tests that verify multiple invariants
 * together in a single audit run, confirming the parts compose correctly.
 *
 * Individual invariants are exercised in isolation in the other behaviour files.
 * These tests exist because a change that keeps all isolation tests green can still
 * break composition (e.g. the error-exclusion and the update/create split interact
 * in non-obvious ways when both happen simultaneously).
 */

/* eslint-env mocha */
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { processContentAndGenerateOpportunities } from '../../../../src/prerender/handler.js';
import {
  buildContext,
  buildSite,
  buildS3Client,
  buildDataAccess,
  buildOpportunity,
  buildSuggestion,
  buildUrlS3Content,
  buildStatus,
  statusKey,
  captureStatusWrite,
  HTML_SERVER_SPARSE,
  HTML_CLIENT_NEEDS_PRERENDER,
} from './helpers.js';

use(sinonChai);

describe('Prerender behaviour — realistic compound scenarios', () => {
  let sandbox;

  beforeEach(() => { sandbox = sinon.createSandbox(); });
  afterEach(() => { sandbox.restore(); });

  it('20 submitted / 2 failed / 18 processed: all 20 in status.json, 10 need prerender → 5 existing suggestions updated + 5 new suggestions created', async () => {
    // This scenario exercises four invariants simultaneously:
    //   1. Errored URLs appear in status.json with scrapingStatus=error (not silently dropped)
    //   2. 18 successful comparisons appear with scrapingStatus=success
    //   3. 5 URLs that already have suggestions are updated in-place via saveMany (not duplicated)
    //   4. 5 genuinely new URLs produce new suggestions via addSuggestions
    //
    // It is not sufficient to verify these in isolation: a change to the comparison-result
    // pipeline could filter error results too early and simultaneously break the status.json
    // accounting and the suggestion split — isolation tests would still pass but this fails.

    const siteId = 'site-compound-1';
    const scrapeJobId = 'job-compound-1';

    // ── URL sets ──────────────────────────────────────────────────────────────────
    // 5 URLs that already have NEW suggestions AND still need prerender in this run
    const existingPrerenderUrls = Array.from(
      { length: 5 },
      (_, i) => `https://example.com/existing-${i + 1}`,
    );
    // 5 URLs that need prerender but have no existing suggestion
    const newPrerenderUrls = Array.from(
      { length: 5 },
      (_, i) => `https://example.com/new-prerender-${i + 1}`,
    );
    // 8 URLs that scrape successfully but have no content gap (needsPrerender=false)
    const noPrerendUrls = Array.from(
      { length: 8 },
      (_, i) => `https://example.com/ok-${i + 1}`,
    );
    // 2 URLs with no S3 content → compareHtmlContent returns { error: true }
    const errorUrls = [
      'https://example.com/error-1',
      'https://example.com/error-2',
    ];

    const allUrls = [
      ...existingPrerenderUrls,
      ...newPrerenderUrls,
      ...noPrerendUrls,
      ...errorUrls,
    ];

    // ── Existing suggestions (5) ──────────────────────────────────────────────────
    const existingSuggestions = existingPrerenderUrls.map((url, i) => buildSuggestion(sandbox, {
      id: `sug-existing-${i}`,
      status: 'NEW',
      data: {
        url,
        wordCountBefore: 5,
        wordCountAfter: 50,
        contentGainRatio: 3.0,
        scrapeJobId: 'old-job',
      },
    }));

    const opportunity = buildOpportunity(sandbox, {
      id: 'opp-compound',
      siteId,
      suggestions: existingSuggestions,
    });

    // ── S3 content ────────────────────────────────────────────────────────────────
    const s3KeyMap = { [statusKey(siteId)]: buildStatus() };

    // existingPrerenderUrls → sparse server-side, rich client-side → needs prerender
    existingPrerenderUrls.forEach((url) => {
      Object.assign(s3KeyMap, buildUrlS3Content(scrapeJobId, url, {
        serverHtml: HTML_SERVER_SPARSE,
        clientHtml: HTML_CLIENT_NEEDS_PRERENDER,
      }));
    });
    // newPrerenderUrls → same sparse/rich pair → needs prerender
    newPrerenderUrls.forEach((url) => {
      Object.assign(s3KeyMap, buildUrlS3Content(scrapeJobId, url, {
        serverHtml: HTML_SERVER_SPARSE,
        clientHtml: HTML_CLIENT_NEEDS_PRERENDER,
      }));
    });
    // noPrerendUrls → identical HTML both sides → needsPrerender=false (HTML_SAME default)
    noPrerendUrls.forEach((url) => {
      Object.assign(s3KeyMap, buildUrlS3Content(scrapeJobId, url));
    });
    // errorUrls intentionally absent → NoSuchKey → error result

    // ── Context ───────────────────────────────────────────────────────────────────
    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox, s3KeyMap),
      dataAccess: buildDataAccess(sandbox, {
        opportunities: [opportunity],
        scrapeUrls: allUrls, // all 20 appear in ScrapeUrl DB for getScrapeJobStats
      }),
      scrapeResultPaths: new Map(allUrls.map((url) => [url, {}])),
      auditContext: { scrapeJobId },
    });

    await processContentAndGenerateOpportunities(ctx);

    // ── Assertion 1: status.json has all 20 pages ─────────────────────────────────
    const written = captureStatusWrite(ctx.s3Client);
    expect(written.pages, 'all 20 submitted URLs must appear in status.json').to.have.length(20);

    const errorPages = written.pages.filter((p) => p.scrapingStatus === 'error');
    const successPages = written.pages.filter((p) => p.scrapingStatus === 'success');
    expect(errorPages, '2 errored URLs must be recorded as scrapingStatus=error').to.have.length(2);
    expect(successPages, '18 successful URLs must be recorded as scrapingStatus=success').to.have.length(18);

    errorUrls.forEach((url) => {
      const page = written.pages.find((p) => p.url === url);
      expect(page, `${url} must be present in status.json pages`).to.not.be.undefined;
      expect(page.scrapingStatus, `${url} must have scrapingStatus=error`).to.equal('error');
    });

    // ── Assertion 2: 5 existing suggestions updated via saveMany ──────────────────
    expect(ctx.dataAccess.Suggestion.saveMany, 'saveMany must be called for the 5 updated suggestions').to.have.been.called;

    const savedSuggestions = ctx.dataAccess.Suggestion.saveMany.args
      .flatMap(([suggestions]) => suggestions);

    // Every existing suggestion must have had setData called (data merged with new metrics)
    existingSuggestions.forEach((s) => {
      expect(s.setData, `existing suggestion ${s.getId()} must have setData called`).to.have.been.called;
    });

    // All 5 existing suggestions must be in the saveMany set
    existingSuggestions.forEach((s) => {
      expect(savedSuggestions, `existing suggestion ${s.getId()} must be in saveMany`).to.include(s);
    });

    // ── Assertion 3: 5 new suggestions created via addSuggestions ─────────────────
    expect(opportunity.addSuggestions, 'addSuggestions must be called for the 5 new URLs').to.have.been.called;

    const addedItems = opportunity.addSuggestions.args.flatMap(([items]) => items);
    const addedUrls = addedItems.map((item) => item.data?.url).filter(Boolean);

    newPrerenderUrls.forEach((url) => {
      expect(addedUrls, `new prerender URL ${url} must be in addSuggestions`).to.include(url);
    });

    // Domain-wide aggregate must also be included in addSuggestions
    const domainWide = addedItems.find((item) => item.data?.isDomainWide === true);
    expect(domainWide, 'domain-wide aggregate suggestion must be included').to.not.be.undefined;

    // ── Assertion 4: errored URLs never become suggestions ────────────────────────
    errorUrls.forEach((url) => {
      expect(addedUrls, `errored URL ${url} must not become a suggestion`).to.not.include(url);
    });

    // existingPrerenderUrls must not appear in addSuggestions (update path, not create)
    existingPrerenderUrls.forEach((url) => {
      expect(addedUrls, `existing URL ${url} must not be duplicated via addSuggestions`).to.not.include(url);
    });
  });
});
