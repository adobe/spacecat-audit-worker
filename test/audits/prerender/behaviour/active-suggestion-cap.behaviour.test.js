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
 * Behavioural contract: active-suggestion cap invariant (LLMO-6533/LLMO-6638)
 *
 * A domain's PRERENDER opportunity must never carry more than MAX_ACTIVE_SUGGESTIONS
 * "active" (non-OUTDATED, non-FIXED, not edgeDeployed/coveredByDomainWide) per-URL
 * suggestions at once. submitForScraping (Step 2) never blocks new URLs to enforce this —
 * instead, evictOldestSuggestionsOverCap (Step 3, run at the end of
 * processContentAndGenerateOpportunities, after status.json is written) evicts the
 * least-recently-scraped active suggestions whenever the count would exceed the cap.
 *
 * This file asserts the invariant end-to-end, independent of the eviction mechanism's
 * internals (covered in handler.test.js): however many eligible suggestions exist after a
 * run — old ones carried over plus any new ones just added — the active count afterward is
 * never more than the cap, and it's always the most-recently-scraped ones that survive.
 *
 * MAX_ACTIVE_SUGGESTIONS is overridden to a small number here so the scenarios stay cheap
 * and readable; the mechanism itself is agnostic to the cap's actual value.
 */

import esmock from 'esmock';
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { Suggestion } from '@adobe/spacecat-shared-data-access';

use(sinonChai);

const BASE_URL = 'https://example.com';
const CAP = 5;

/** A per-URL suggestion stub whose status is mutated in place by bulkUpdateStatus. */
function makeCapSuggestion(url, extraData = {}) {
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
    '../../../../src/prerender/utils/constants.js': {
      CONTENT_GAIN_THRESHOLD: 1.1,
      DOMAIN_WIDE_SUGGESTION_KEY: 'domain-wide-aggregate|prerender',
      MAX_ACTIVE_SUGGESTIONS: CAP,
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

/** Count of suggestions still active (not OUTDATED) after a run. */
function activeCount(suggestions) {
  return suggestions.filter((s) => s.getStatus() !== Suggestion.STATUSES.OUTDATED).length;
}

describe('Prerender active-suggestion cap invariant (behaviour)', () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => sandbox.restore());

  it('never exceeds the cap when new suggestions push the count over it', async () => {
    // 3 pre-existing active suggestions (well under the cap of 5) + this run's own URL
    // (page1) = 4 eligible before the invariant check — still at or under cap, so nothing
    // should be evicted yet.
    const existing = [
      makeCapSuggestion(`${BASE_URL}/old-1`),
      makeCapSuggestion(`${BASE_URL}/old-2`),
      makeCapSuggestion(`${BASE_URL}/old-3`),
    ];
    const page1 = makeCapSuggestion(`${BASE_URL}/page1`);
    const suggestions = [...existing, page1];

    await runAudit(sandbox, {
      suggestions,
      scrapedAtByUrl: {
        [`${BASE_URL}/old-1`]: '2020-01-01T00:00:00.000Z',
        [`${BASE_URL}/old-2`]: '2020-02-01T00:00:00.000Z',
        [`${BASE_URL}/old-3`]: '2020-03-01T00:00:00.000Z',
      },
    });

    expect(activeCount(suggestions)).to.be.at.most(CAP);
    expect(activeCount(suggestions)).to.equal(4);
  });

  it('evicts exactly enough of the oldest suggestions to bring the count back down to the cap, regardless of how many are over', async () => {
    // 7 pre-existing active suggestions + page1 = 8 eligible, 3 over the cap of 5.
    const existing = Array.from(
      { length: 7 },
      (_, i) => makeCapSuggestion(`${BASE_URL}/old-${i}`),
    );
    const page1 = makeCapSuggestion(`${BASE_URL}/page1`);
    const suggestions = [...existing, page1];

    const scrapedAtByUrl = {};
    existing.forEach((_, i) => {
      // old-0 is the oldest, old-6 the newest of the "existing" batch.
      scrapedAtByUrl[`${BASE_URL}/old-${i}`] = `2020-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`;
    });

    await runAudit(sandbox, { suggestions, scrapedAtByUrl });

    // Invariant: never more than the cap, no matter how many were eligible going in.
    expect(activeCount(suggestions)).to.equal(CAP);

    // The 3 oldest (old-0, old-1, old-2) must be the ones evicted; page1 (this run's fresh
    // URL) and the 4 newest existing ones must survive.
    expect(existing[0].getStatus()).to.equal(Suggestion.STATUSES.OUTDATED);
    expect(existing[1].getStatus()).to.equal(Suggestion.STATUSES.OUTDATED);
    expect(existing[2].getStatus()).to.equal(Suggestion.STATUSES.OUTDATED);
    [3, 4, 5, 6].forEach((i) => {
      expect(existing[i].getStatus()).to.equal(Suggestion.STATUSES.NEW);
    });
    expect(page1.getStatus()).to.equal(Suggestion.STATUSES.NEW);
  });

  it('models "10 new URLs in, 10 oldest out": adding N new suggestions evicts exactly N of the oldest, keeping the total pinned at the cap', async () => {
    // Start exactly at the cap (5 pre-existing, all older than this run).
    const existing = Array.from(
      { length: CAP },
      (_, i) => makeCapSuggestion(`${BASE_URL}/existing-${i}`),
    );
    // This run's "new" URLs are already reflected in getSuggestions (as if syncSuggestions
    // had just added them) — 2 new URLs simulate a smaller version of "10 new URLs".
    const page1 = makeCapSuggestion(`${BASE_URL}/page1`);
    const newUrl2 = makeCapSuggestion(`${BASE_URL}/new-2`);
    const suggestions = [...existing, page1, newUrl2];

    const scrapedAtByUrl = { [`${BASE_URL}/new-2`]: new Date().toISOString() };
    existing.forEach((_, i) => {
      scrapedAtByUrl[`${BASE_URL}/existing-${i}`] = `2019-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`;
    });

    await runAudit(sandbox, { suggestions, scrapedAtByUrl });

    // 7 eligible total, cap 5 → 2 evicted, count back to the cap.
    expect(activeCount(suggestions)).to.equal(CAP);
    // The 2 oldest pre-existing ones are evicted; the freshest ones (including both new URLs)
    // survive.
    expect(existing[0].getStatus()).to.equal(Suggestion.STATUSES.OUTDATED);
    expect(existing[1].getStatus()).to.equal(Suggestion.STATUSES.OUTDATED);
    [2, 3, 4].forEach((i) => {
      expect(existing[i].getStatus()).to.equal(Suggestion.STATUSES.NEW);
    });
    expect(page1.getStatus()).to.equal(Suggestion.STATUSES.NEW);
    expect(newUrl2.getStatus()).to.equal(Suggestion.STATUSES.NEW);
  });

  it('FIXED, edgeDeployed, and coveredByDomainWide suggestions are excluded from the cap and never evicted, even when the eligible set is over the cap', async () => {
    const protectedFixed = makeCapSuggestion(`${BASE_URL}/fixed`);
    protectedFixed.setStatus(Suggestion.STATUSES.FIXED);
    const protectedEdgeDeployed = makeCapSuggestion(`${BASE_URL}/edge-deployed`, { edgeDeployed: 123 });
    const protectedCovered = makeCapSuggestion(`${BASE_URL}/covered`, { coveredByDomainWide: 'dw-1' });

    // 6 plain eligible suggestions + page1 = 7 eligible, 2 over the cap of 5.
    const eligible = Array.from(
      { length: 6 },
      (_, i) => makeCapSuggestion(`${BASE_URL}/eligible-${i}`),
    );
    const page1 = makeCapSuggestion(`${BASE_URL}/page1`);

    const suggestions = [
      protectedFixed, protectedEdgeDeployed, protectedCovered, ...eligible, page1,
    ];

    const scrapedAtByUrl = {
      // Protected suggestions are the oldest of all by scrapedAt — if they counted or were
      // evictable, they'd be picked first. They must survive untouched regardless.
      [`${BASE_URL}/fixed`]: '2000-01-01T00:00:00.000Z',
      [`${BASE_URL}/edge-deployed`]: '2000-01-01T00:00:00.000Z',
      [`${BASE_URL}/covered`]: '2000-01-01T00:00:00.000Z',
    };
    eligible.forEach((_, i) => {
      scrapedAtByUrl[`${BASE_URL}/eligible-${i}`] = `2021-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`;
    });

    await runAudit(sandbox, { suggestions, scrapedAtByUrl });

    // Protected suggestions never touched.
    expect(protectedFixed.getStatus()).to.equal(Suggestion.STATUSES.FIXED);
    expect(protectedEdgeDeployed.getStatus()).to.equal(Suggestion.STATUSES.NEW);
    expect(protectedCovered.getStatus()).to.equal(Suggestion.STATUSES.NEW);

    // Only the eligible pool is capped — 7 eligible, cap 5, 2 oldest evicted.
    const eligiblePool = [...eligible, page1];
    expect(activeCount(eligiblePool)).to.equal(CAP);
    expect(eligible[0].getStatus()).to.equal(Suggestion.STATUSES.OUTDATED);
    expect(eligible[1].getStatus()).to.equal(Suggestion.STATUSES.OUTDATED);
  });
});
