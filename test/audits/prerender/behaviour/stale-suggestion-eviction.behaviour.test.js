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
 * Behavioural contract: stale-suggestion eviction invariant (LLMO-7038)
 *
 * A PRERENDER per-URL suggestion whose most recent confirmed scrape (status.json scrapedAt)
 * is more than SUGGESTION_STALENESS_DAYS old must be marked OUTDATED — consistent with the
 * customer promise that ABV runs weekly audits. submitForScraping (Step 2) never blocks new
 * URLs; evictStaleSuggestions (Step 3, run at the end of processContentAndGenerateOpportunities,
 * after status.json is written) evicts eligible suggestions past the staleness threshold.
 *
 * This file asserts the invariant end-to-end, independent of the eviction mechanism's
 * internals (covered in handler.test.js): eviction is decided per-suggestion by its own age,
 * not by rank against a count.
 *
 * Uses the real SUGGESTION_STALENESS_DAYS value (not a mocked-down one): the constant is
 * imported from evict-stale-suggestions.js's *own* module graph rather than overridden via
 * esmock's constants.js import — evictStaleSuggestions lives in its own module
 * (evict-stale-suggestions.js), a grandchild import of handler.js, so overriding the constant
 * there would require esmock's costly whole-import-tree (3rd-arg) mocking.
 */

import esmock from 'esmock';
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { Suggestion } from '@adobe/spacecat-shared-data-access';
import { SUGGESTION_STALENESS_DAYS } from '../../../../src/prerender/utils/constants.js';

use(sinonChai);

const BASE_URL = 'https://example.com';
const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO scrapedAt N days before now, relative to real Date.now() at test-run time. */
function daysAgo(n) {
  return new Date(Date.now() - (n * DAY_MS)).toISOString();
}

/** A per-URL suggestion stub whose status is mutated in place by bulkUpdateStatus. */
function makeSuggestion(url, extraData = {}) {
  let currentStatus = Suggestion.STATUSES.NEW;
  return {
    getStatus: () => currentStatus,
    setStatus: (s) => { currentStatus = s; },
    getData: () => ({ url, ...extraData }),
  };
}

/**
 * Runs processContentAndGenerateOpportunities with a fixed set of "already active" per-URL
 * suggestions (as if syncSuggestions had already run this cycle) and a given status.json
 * scrapedAt per URL, then returns those same suggestion objects so the test can inspect their
 * post-run status.
 *
 * @param {Object} sandbox
 * @param {{suggestions: Object[], scrapedAtByUrl: Record<string,string>}} args
 * @returns {Promise<void>}
 */
async function runAudit(sandbox, { suggestions, scrapedAtByUrl }) {
  const mockOpportunity = {
    getId: () => 'opp-1',
    getSuggestions: sandbox.stub().resolves(suggestions),
  };

  const handler = await esmock('../../../../src/prerender/handler.js', {
    '../../../../src/common/opportunity.js': {
      convertToOpportunity: sandbox.stub().resolves(mockOpportunity),
    },
    '../../../../src/utils/data-access.js': {
      syncSuggestions: sandbox.stub().resolves(),
    },
    '../../../../src/prerender/utils/utils.js': {
      isPaidLLMOCustomer: sandbox.stub().resolves(false),
      mergeAndGetUniqueHtmlUrls: sandbox.stub().returns([]),
    },
  });

  // HTML pair that pushes contentGainRatio above CONTENT_GAIN_THRESHOLD, so this run's one
  // scraped URL (page1) is detected as needing prerender — the only way to reach the
  // opportunity-processing branch that runs eviction at the end.
  const serverHtml = '<html><body><p>Short</p></body></html>';
  const clientHtml = '<html><body><p>Short</p><p>Much more dynamic content loaded by JavaScript making the page significantly longer than the server-side render and pushing the content gain ratio well above the threshold</p></body></html>';

  const existingStatusPages = Object.entries(scrapedAtByUrl)
    .filter(([url]) => url !== `${BASE_URL}/page1`)
    .map(([url, scrapedAt]) => ({ url, scrapedAt }));

  const context = {
    site: { getId: () => 'site-1', getBaseURL: () => BASE_URL },
    audit: { getId: () => 'audit-1' },
    log: {
      info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub(),
    },
    env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
    auditContext: {},
    scrapeResultPaths: new Map([[`${BASE_URL}/page1`, '/tmp/p1']]),
    dataAccess: {
      Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
      Suggestion: {
        bulkUpdateStatus: sandbox.stub().callsFake((toEvict, status) => {
          toEvict.forEach((s) => s.setStatus(status));
          return Promise.resolve(toEvict);
        }),
      },
    },
    s3Client: {
      send: sandbox.stub().callsFake((command) => {
        if (command.constructor.name === 'PutObjectCommand') return Promise.resolve({});
        const key = command.input?.Key || '';
        if (key.endsWith('server-side.html')) return Promise.resolve({ ContentType: 'text/html', Body: { transformToString: () => Promise.resolve(serverHtml) } });
        if (key.endsWith('client-side.html')) return Promise.resolve({ ContentType: 'text/html', Body: { transformToString: () => Promise.resolve(clientHtml) } });
        if (key.endsWith('scrape.json')) return Promise.resolve({ ContentType: 'application/json', Body: { transformToString: () => Promise.resolve(JSON.stringify({})) } });
        if (key.endsWith('status.json')) return Promise.resolve({ ContentType: 'application/json', Body: { transformToString: () => Promise.resolve(JSON.stringify({ pages: existingStatusPages })) } });
        return Promise.reject(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }));
      }),
    },
  };

  await handler.processContentAndGenerateOpportunities(context);
}

describe('Prerender stale-suggestion eviction invariant (behaviour)', () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => sandbox.restore());

  it('evicts a suggestion untouched for more than SUGGESTION_STALENESS_DAYS', async () => {
    const stale = makeSuggestion(`${BASE_URL}/stale`);
    const page1 = makeSuggestion(`${BASE_URL}/page1`);
    const suggestions = [stale, page1];
    const scrapedAtByUrl = {
      [`${BASE_URL}/stale`]: daysAgo(SUGGESTION_STALENESS_DAYS + 1),
    };

    await runAudit(sandbox, { suggestions, scrapedAtByUrl });

    expect(stale.getStatus()).to.equal(Suggestion.STATUSES.OUTDATED);
    expect(page1.getStatus()).to.equal(Suggestion.STATUSES.NEW);
  });

  it('does not evict a suggestion scraped within the last SUGGESTION_STALENESS_DAYS', async () => {
    const fresh = makeSuggestion(`${BASE_URL}/fresh`);
    const page1 = makeSuggestion(`${BASE_URL}/page1`);
    const suggestions = [fresh, page1];
    const scrapedAtByUrl = {
      [`${BASE_URL}/fresh`]: daysAgo(SUGGESTION_STALENESS_DAYS - 1),
    };

    await runAudit(sandbox, { suggestions, scrapedAtByUrl });

    expect(fresh.getStatus()).to.equal(Suggestion.STATUSES.NEW);
  });

  it('evicts every eligible stale suggestion in one run, with no cap on how many', async () => {
    const staleOnes = Array.from(
      { length: 5 },
      (_, i) => makeSuggestion(`${BASE_URL}/stale-${i}`),
    );
    const page1 = makeSuggestion(`${BASE_URL}/page1`);
    const suggestions = [...staleOnes, page1];
    const scrapedAtByUrl = {};
    staleOnes.forEach((s) => {
      scrapedAtByUrl[s.getData().url] = daysAgo(SUGGESTION_STALENESS_DAYS + 30);
    });

    await runAudit(sandbox, { suggestions, scrapedAtByUrl });

    staleOnes.forEach((s) => {
      expect(s.getStatus()).to.equal(Suggestion.STATUSES.OUTDATED);
    });
    expect(page1.getStatus()).to.equal(Suggestion.STATUSES.NEW);
  });

  it('FIXED, edgeDeployed, and coveredByDomainWide suggestions are never evicted even when stale', async () => {
    const protectedFixed = makeSuggestion(`${BASE_URL}/fixed`);
    protectedFixed.setStatus(Suggestion.STATUSES.FIXED);
    const protectedEdgeDeployed = makeSuggestion(`${BASE_URL}/edge-deployed`, { edgeDeployed: 123 });
    const protectedCovered = makeSuggestion(`${BASE_URL}/covered`, { coveredByDomainWide: 'dw-1' });
    const page1 = makeSuggestion(`${BASE_URL}/page1`);

    const suggestions = [protectedFixed, protectedEdgeDeployed, protectedCovered, page1];
    const veryStale = daysAgo(SUGGESTION_STALENESS_DAYS + 365);
    const scrapedAtByUrl = {
      [`${BASE_URL}/fixed`]: veryStale,
      [`${BASE_URL}/edge-deployed`]: veryStale,
      [`${BASE_URL}/covered`]: veryStale,
    };

    await runAudit(sandbox, { suggestions, scrapedAtByUrl });

    expect(protectedFixed.getStatus()).to.equal(Suggestion.STATUSES.FIXED);
    expect(protectedEdgeDeployed.getStatus()).to.equal(Suggestion.STATUSES.NEW);
    expect(protectedCovered.getStatus()).to.equal(Suggestion.STATUSES.NEW);
  });
});
