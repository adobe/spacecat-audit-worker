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

import { expect } from 'chai';
import sinon from 'sinon';
import esmock from 'esmock';
import GoogleClient from '@adobe/spacecat-shared-google-client';
import { stripWWW } from '@adobe/spacecat-shared-utils';
import { computeWindows } from '../../../src/gsc-search-analytics/windows.js';

const iso = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().split('T')[0];
const rowFor = (url) => ({
  data: {
    rows: [{
      keys: [url], clicks: 5, impressions: 50, ctr: 0.1, position: 4,
    }],
  },
});
const emptyRows = () => ({ data: { rows: [] } });
const fullPage = () => ({
  data: {
    rows: Array.from({ length: 1000 }, (_, i) => ({
      keys: [`https://krisshop.com/other${i}`], clicks: 1, impressions: 10, ctr: 0.1, position: 5,
    })),
  },
});
const afterStartMs = (fixDate) => new Date(`${computeWindows(fixDate).after.start}T00:00:00Z`).getTime();

describe('runGscSearchAnalytics', () => {
  const finalUrl = 'https://krisshop.com';
  // getId feeds the self-source path (deriveFixedUrls(site.getId(), ...)); the explicit
  // fixedUrls tests never call it. dataAccess lets the real derive.js return an empty list
  // (no opportunities) when a test exercises the self-source path without stubbing derive.
  const site = { getBaseURL: () => finalUrl, getId: () => 'site-id-123' };
  const context = {
    log: { info() {}, warn() {}, error() {} },
    dataAccess: {
      Opportunity: { allBySiteId: async () => [] },
      FixEntity: { STATUSES: { DEPLOYED: 'DEPLOYED', PUBLISHED: 'PUBLISHED' } },
    },
  };
  const url = 'https://krisshop.com/products/x';

  // Task 3 added `const scope = await composeAuditURL(finalUrl)` to lib.js, which performs
  // a LIVE HTTP GET. Load lib.js through esmock with composeAuditURL stubbed so no test
  // ever hits the network. `scopeReturn` is mutable so a test can pick the resolved scope;
  // GoogleClient stays REAL (each test still uses sinon.stub(GoogleClient, 'createFrom')),
  // and stripWWW is passed through real so the scope math is genuine.
  let runGscSearchAnalytics;
  let scopeReturn = 'krisshop.com';
  // Opt-in flag: only the scope-resolution-failure test flips this true so the shared
  // composeAuditURL stub rejects; every other test keeps the default resolve behavior.
  let scopeThrows = false;

  before(async () => {
    ({ runGscSearchAnalytics } = await esmock('../../../src/gsc-search-analytics/lib.js', {
      '@adobe/spacecat-shared-utils': {
        composeAuditURL: async () => {
          if (scopeThrows) throw new Error('dns fail');
          return scopeReturn;
        },
        stripWWW,
      },
    }));
  });

  // Default scope = bare host -> scopePath '/', so every same-host fixed URL in the
  // existing tests stays IN scope and keeps its measured/not_found/incomplete verdict.
  beforeEach(() => { scopeReturn = 'krisshop.com'; scopeThrows = false; });

  afterEach(() => sinon.restore());

  it('measures a URL when both windows are present and fully elapsed', async () => {
    const google = { getOrganicSearchData: sinon.stub().resolves(rowFor(url)) };
    sinon.stub(GoogleClient, 'createFrom').resolves(google);
    const fixedUrls = [{ url, fixType: 'meta-tags', fixDate: '2026-03-01' }];

    const { auditResult, fullAuditRef } = await runGscSearchAnalytics(finalUrl, context, site, { fixedUrls });
    expect(fullAuditRef).to.equal(finalUrl);
    expect(auditResult).to.include({ schemaVersion: 1, connected: true, status: 'ok' });
    expect(auditResult.interpretation).to.match(/not a causal or attributed/);
    expect(auditResult.fixCount).to.equal(1);
    expect(auditResult.measuredCount).to.equal(1);
    const fix = auditResult.fixes[0];
    expect(fix.status).to.equal('measured');
    expect(fix.found).to.deep.equal({ before: true, after: true });
    expect(fix).to.have.nested.property('delta.clicks');
    expect(fix.dataQuality).to.include({ beforeComplete: true, afterComplete: true, truncated: false });
  });

  it('marks not_found when the URL is absent in a window (partial)', async () => {
    const google = { getOrganicSearchData: sinon.stub() };
    google.getOrganicSearchData.onCall(0).resolves(rowFor(url)); // before pull
    google.getOrganicSearchData.onCall(1).resolves(emptyRows()); // after pull
    sinon.stub(GoogleClient, 'createFrom').resolves(google);
    const fixedUrls = [{ url, fixType: 'meta-tags', fixDate: '2026-03-01' }];

    const { auditResult } = await runGscSearchAnalytics(finalUrl, context, site, { fixedUrls });
    const fix = auditResult.fixes[0];
    expect(fix.status).to.equal('not_found');
    expect(fix.found).to.deep.equal({ before: true, after: false });
    expect(fix.delta).to.equal(null);
    expect(auditResult.measuredCount).to.equal(0);
  });

  it('marks incomplete (not not_found) when the after window has not elapsed, even with no rows', async () => {
    // Precedence check: a not-yet-elapsed window legitimately returns no rows; it must
    // read as 'incomplete', never 'not_found'.
    const google = { getOrganicSearchData: sinon.stub().resolves(emptyRows()) };
    sinon.stub(GoogleClient, 'createFrom').resolves(google);
    const fixedUrls = [{ url, fixType: 'meta-tags', fixDate: iso(-5) }]; // fixed 5 days ago

    const { auditResult } = await runGscSearchAnalytics(finalUrl, context, site, { fixedUrls });
    const fix = auditResult.fixes[0];
    expect(fix.status).to.equal('incomplete');
    expect(fix.dataQuality.afterComplete).to.equal(false);
    expect(fix.delta).to.equal(null);
  });

  it('marks incomplete when the before window predates retention', async () => {
    const google = { getOrganicSearchData: sinon.stub().resolves(rowFor(url)) };
    sinon.stub(GoogleClient, 'createFrom').resolves(google);
    const fixedUrls = [{ url, fixType: 'meta-tags', fixDate: iso(-520) }]; // ~17 months ago

    const { auditResult } = await runGscSearchAnalytics(finalUrl, context, site, { fixedUrls });
    const fix = auditResult.fixes[0];
    expect(fix.status).to.equal('incomplete');
    expect(fix.dataQuality).to.include({ beforeComplete: false, afterComplete: true });
  });

  it('groups URLs sharing a fix date into one pair of pulls', async () => {
    const google = { getOrganicSearchData: sinon.stub().resolves(emptyRows()) };
    sinon.stub(GoogleClient, 'createFrom').resolves(google);
    const fixedUrls = [
      { url: 'https://krisshop.com/a', fixType: 'meta-tags', fixDate: '2026-03-01' },
      { url: 'https://krisshop.com/b', fixType: 'alt-text', fixDate: '2026-03-01' },
    ];
    const { auditResult } = await runGscSearchAnalytics(finalUrl, context, site, { fixedUrls });
    expect(auditResult.fixCount).to.equal(2);
    expect(google.getOrganicSearchData.callCount).to.equal(2);
    expect(auditResult.fixes[0].status).to.equal('not_found');
  });

  it('issues separate pulls for distinct fix dates', async () => {
    const google = { getOrganicSearchData: sinon.stub().resolves(emptyRows()) };
    sinon.stub(GoogleClient, 'createFrom').resolves(google);
    const fixedUrls = [
      { url: 'https://krisshop.com/a', fixType: 'meta-tags', fixDate: '2026-03-01' },
      { url: 'https://krisshop.com/b', fixType: 'meta-tags', fixDate: '2026-04-01' },
    ];
    const { auditResult } = await runGscSearchAnalytics(finalUrl, context, site, { fixedUrls });
    expect(auditResult.fixCount).to.equal(2);
    expect(google.getOrganicSearchData.callCount).to.equal(4);
  });

  it('records invalid_date without fetching', async () => {
    const google = { getOrganicSearchData: sinon.stub().resolves(emptyRows()) };
    sinon.stub(GoogleClient, 'createFrom').resolves(google);
    const fixedUrls = [{ url, fixType: 'meta-tags', fixDate: 'nope' }];
    const { auditResult } = await runGscSearchAnalytics(finalUrl, context, site, { fixedUrls });
    expect(auditResult.connected).to.equal(true);
    expect(auditResult.fixes[0].status).to.equal('invalid_date');
    expect(auditResult.fixes[0].error).to.match(/Invalid fix date/);
    expect(google.getOrganicSearchData.callCount).to.equal(0);
  });

  it('isolates a per-group failure: the failing date fails, other dates still measure', async () => {
    const okUrl = 'https://krisshop.com/ok';
    const failDateAfterMs = afterStartMs('2026-04-01');
    const failBeforeMs = new Date(`${computeWindows('2026-04-01').before.start}T00:00:00Z`).getTime();
    const google = {
      getOrganicSearchData: sinon.stub().callsFake((start) => {
        const t = start.getTime();
        if (t === failDateAfterMs || t === failBeforeMs) {
          return Promise.reject(new Error('GSC 500'));
        }
        return Promise.resolve(rowFor(okUrl));
      }),
    };
    sinon.stub(GoogleClient, 'createFrom').resolves(google);
    const fixedUrls = [
      { url: okUrl, fixType: 'meta-tags', fixDate: '2026-03-01' },
      { url: 'https://krisshop.com/fail', fixType: 'meta-tags', fixDate: '2026-04-01' },
    ];
    const { auditResult } = await runGscSearchAnalytics(finalUrl, context, site, { fixedUrls });
    expect(auditResult.connected).to.equal(true);
    expect(auditResult.measuredCount).to.equal(1);
    const okFix = auditResult.fixes.find((f) => f.url === okUrl);
    const failFix = auditResult.fixes.find((f) => f.url === 'https://krisshop.com/fail');
    expect(okFix.status).to.equal('measured');
    expect(failFix.status).to.equal('failed');
    expect(failFix.error).to.equal('GSC 500');
    expect(failFix.found).to.deep.equal({ before: false, after: false });
  });

  it('warns when rows returned but no in-scope fixed URL matched (host mismatch)', async () => {
    const warn = sinon.spy();
    const ctx = { log: { info() {}, warn, error() {} } };
    // GSC rows are on a different host than the supplied fixed URL -> nothing matches.
    const google = {
      getOrganicSearchData: sinon.stub().resolves({
        data: { rows: [{ keys: ['https://othersite.com/x'], clicks: 5, impressions: 50, ctr: 0.1, position: 4 }] },
      }),
    };
    sinon.stub(GoogleClient, 'createFrom').resolves(google);
    const fixedUrls = [{ url, fixType: 'meta-tags', fixDate: '2026-03-01' }];
    const { auditResult } = await runGscSearchAnalytics(finalUrl, ctx, site, { fixedUrls });
    expect(auditResult.fixes[0].status).to.equal('not_found');
    expect(warn.calledOnce).to.equal(true);
    expect(warn.firstCall.args[0]).to.match(/no in-scope fixed URL matched/);
  });

  it('flags truncation and reads not_found when the URL is past the page cap', async () => {
    const targetAfterMs = afterStartMs('2026-03-01');
    const google = {
      getOrganicSearchData: sinon.stub().callsFake((start) => (
        start.getTime() === targetAfterMs ? Promise.resolve(fullPage()) : Promise.resolve(emptyRows())
      )),
    };
    sinon.stub(GoogleClient, 'createFrom').resolves(google);
    const fixedUrls = [{ url, fixType: 'meta-tags', fixDate: '2026-03-01' }];
    const { auditResult } = await runGscSearchAnalytics(finalUrl, context, site, { fixedUrls });
    const fix = auditResult.fixes[0];
    expect(fix.dataQuality.truncated).to.equal(true);
    expect(fix.status).to.equal('not_found');
  });

  it('records not_connected (and does not throw) when createFrom fails', async () => {
    sinon.stub(GoogleClient, 'createFrom').rejects(new Error('ResourceNotFoundException: no secret'));
    const fixedUrls = [{ url, fixType: 'meta-tags', fixDate: '2026-03-01' }];
    const { auditResult } = await runGscSearchAnalytics(finalUrl, context, site, { fixedUrls });
    expect(auditResult.connected).to.equal(false);
    expect(auditResult.status).to.equal('not_connected');
    expect(auditResult.reason).to.match(/ResourceNotFound/);
  });

  it('reads fixedUrls from messageData as a fallback', async () => {
    const google = { getOrganicSearchData: sinon.stub().resolves(emptyRows()) };
    sinon.stub(GoogleClient, 'createFrom').resolves(google);
    const fixedUrls = [{ url, fixType: 'meta-tags', fixDate: '2026-03-01' }];
    const { auditResult } = await runGscSearchAnalytics(finalUrl, context, site, { messageData: { fixedUrls } });
    expect(auditResult.connected).to.equal(true);
    expect(auditResult.fixCount).to.equal(1);
  });

  it('returns missing_fixed_urls when none are supplied (default auditContext)', async () => {
    const { auditResult } = await runGscSearchAnalytics(finalUrl, context, site);
    expect(auditResult.status).to.equal('missing_fixed_urls');
    expect(auditResult.connected).to.equal(null);
  });

  it('self-sources fixed URLs from a since watermark, and surfaces sourcing in the result', async () => {
    const derived = {
      fixedUrls: [{ url: 'https://krisshop.com/en/x.html', fixType: 'meta-tags', fixDate: '2026-05-04' }],
      sourcing: {
        mode: 'incremental', sourcedDateGroups: 1, keptDateGroups: 1, truncated: false,
      },
    };
    const googleStub = { getOrganicSearchData: sinon.stub().resolves(emptyRows()) };
    const seen = {};
    const { runGscSearchAnalytics: run } = await esmock('../../../src/gsc-search-analytics/lib.js', {
      '../../../src/gsc-search-analytics/derive.js': {
        deriveFixedUrls: async (_siteId, opts) => { seen.opts = opts; return derived; },
      },
      '@adobe/spacecat-shared-google-client': { default: { createFrom: async () => googleStub } },
      '@adobe/spacecat-shared-utils': { composeAuditURL: async () => 'krisshop.com', stripWWW },
    });
    const res = await run(finalUrl, context, site, { messageData: { since: '2026-05-01' } });
    expect(seen.opts.since).to.equal('2026-05-01'); // watermark forwarded to derive
    expect(res.auditResult.fixCount).to.be.greaterThan(0);
    expect(res.auditResult.sourcing).to.include({ mode: 'incremental', truncated: false });
  });

  it('records missing_fixed_urls when derive yields nothing and no range given', async () => {
    const { runGscSearchAnalytics: run } = await esmock('../../../src/gsc-search-analytics/lib.js', {
      '../../../src/gsc-search-analytics/derive.js': {
        deriveFixedUrls: async () => ({
          fixedUrls: [],
          sourcing: {
            mode: 'backfill', sourcedDateGroups: 0, keptDateGroups: 0, truncated: false,
          },
        }),
      },
      '@adobe/spacecat-shared-utils': { composeAuditURL: async () => 'krisshop.com', stripWWW },
    });
    const res = await run(finalUrl, context, site, {});
    expect(res.auditResult.status).to.equal('missing_fixed_urls');
    // Fix 2: a self-sourced "found 0 fixes in band" run stays diagnosable.
    expect(res.auditResult.sourcing).to.include({ mode: 'backfill', truncated: false });
  });

  it('records sourcing_failed (and does not throw) when derive rejects', async () => {
    const { runGscSearchAnalytics: run } = await esmock('../../../src/gsc-search-analytics/lib.js', {
      '../../../src/gsc-search-analytics/derive.js': {
        deriveFixedUrls: async () => { throw new Error('db down'); },
      },
      '@adobe/spacecat-shared-utils': { composeAuditURL: async () => 'krisshop.com', stripWWW },
    });
    const res = await run(finalUrl, context, site, { messageData: { since: '2026-05-01' } });
    expect(res.auditResult.status).to.equal('sourcing_failed');
    expect(res.auditResult.connected).to.equal(null);
    expect(res.auditResult.reason).to.match(/db down/);
  });

  it('returns too_many_fixed_urls above the cap', async () => {
    const fixedUrls = Array.from({ length: 501 }, (_, i) => ({
      url: `https://krisshop.com/p${i}`, fixType: 'meta-tags', fixDate: '2026-03-01',
    }));
    const { auditResult } = await runGscSearchAnalytics(finalUrl, context, site, { fixedUrls });
    expect(auditResult.status).to.equal('too_many_fixed_urls');
  });

  it('returns too_many_date_groups above the distinct-date cap', async () => {
    // 31 distinct fix dates (> MAX_DATE_GROUPS of 30); stays under the 500-URL cap.
    const fixedUrls = Array.from({ length: 31 }, (_, i) => ({
      url: `https://krisshop.com/p${i}`,
      fixType: 'meta-tags',
      fixDate: `2026-03-${String(i + 1).padStart(2, '0')}`,
    }));
    const { auditResult } = await runGscSearchAnalytics(finalUrl, context, site, { fixedUrls });
    expect(auditResult.status).to.equal('too_many_date_groups');
  });

  it('marks a URL outside the resolved fetch scope as out_of_scope, not not_found', async () => {
    // finalUrl resolves (composeAuditURL) to www.krisshop.com/en; the bare root is out of scope.
    scopeReturn = 'www.krisshop.com/en';
    const google = { getOrganicSearchData: sinon.stub().resolves(emptyRows()) };
    sinon.stub(GoogleClient, 'createFrom').resolves(google);
    const res = await runGscSearchAnalytics(finalUrl, context, site, {
      fixedUrls: [{ url: 'https://www.krisshop.com/', fixType: 'smoke', fixDate: '2026-01-15' }],
    });
    expect(res.auditResult.fixes[0].status).to.equal('out_of_scope');
  });

  it('measures in-scope URLs at and below the resolved locale path (exact + subpath)', async () => {
    scopeReturn = 'www.krisshop.com/en';
    const exactUrl = 'https://www.krisshop.com/en'; // pathname === scopePath
    const subUrl = 'https://www.krisshop.com/en/products/x'; // pathname startsWith `${scopePath}/`
    const google = {
      getOrganicSearchData: sinon.stub().resolves({
        data: {
          rows: [
            {
              keys: [exactUrl], clicks: 5, impressions: 50, ctr: 0.1, position: 4,
            },
            {
              keys: [subUrl], clicks: 5, impressions: 50, ctr: 0.1, position: 4,
            },
          ],
        },
      }),
    };
    sinon.stub(GoogleClient, 'createFrom').resolves(google);
    const res = await runGscSearchAnalytics(finalUrl, context, site, {
      fixedUrls: [
        { url: exactUrl, fixType: 'meta-tags', fixDate: '2026-03-01' },
        { url: subUrl, fixType: 'meta-tags', fixDate: '2026-03-01' },
      ],
    });
    const byUrl = Object.fromEntries(res.auditResult.fixes.map((f) => [f.url, f.status]));
    expect(byUrl[exactUrl]).to.equal('measured');
    expect(byUrl[subUrl]).to.equal('measured');
  });

  it('marks a same-path but different-host URL as out_of_scope', async () => {
    scopeReturn = 'www.krisshop.com/en';
    const google = { getOrganicSearchData: sinon.stub().resolves(emptyRows()) };
    sinon.stub(GoogleClient, 'createFrom').resolves(google);
    const res = await runGscSearchAnalytics(finalUrl, context, site, {
      fixedUrls: [{ url: 'https://elsewhere.com/en/x', fixType: 'meta-tags', fixDate: '2026-03-01' }],
    });
    expect(res.auditResult.fixes[0].status).to.equal('out_of_scope');
  });

  it('treats every same-host URL as in scope when the base resolves to bare root', async () => {
    scopeReturn = 'www.krisshop.com'; // no path segment -> scopePath '/'
    const deepUrl = 'https://krisshop.com/de-de/deep/page';
    const google = { getOrganicSearchData: sinon.stub().resolves(rowFor(deepUrl)) };
    sinon.stub(GoogleClient, 'createFrom').resolves(google);
    const res = await runGscSearchAnalytics(finalUrl, context, site, {
      fixedUrls: [{ url: deepUrl, fixType: 'meta-tags', fixDate: '2026-03-01' }],
    });
    expect(res.auditResult.fixes[0].status).to.equal('measured');
  });

  it('marks an unparseable URL as out_of_scope via the scope guard (try/catch)', async () => {
    scopeReturn = 'www.krisshop.com/en';
    const google = { getOrganicSearchData: sinon.stub().resolves(emptyRows()) };
    sinon.stub(GoogleClient, 'createFrom').resolves(google);
    const res = await runGscSearchAnalytics(finalUrl, context, site, {
      fixedUrls: [{ url: 'not a url', fixType: 'meta-tags', fixDate: '2026-03-01' }],
    });
    expect(res.auditResult.fixes[0].status).to.equal('out_of_scope');
  });

  it('normalizes a trailing-slash scope so in-scope URLs are measured, not out_of_scope', async () => {
    // composeAuditURL leaves the trailing slash on a multi-segment path ("/en/"); the fixed
    // URLs are normalized ("/en", "/en/products/x"), so without the scopePath trim they would
    // all falsely read out_of_scope.
    scopeReturn = 'www.krisshop.com/en/';
    const exactUrl = 'https://www.krisshop.com/en';
    const subUrl = 'https://www.krisshop.com/en/products/x';
    const google = {
      getOrganicSearchData: sinon.stub().resolves({
        data: {
          rows: [
            {
              keys: [exactUrl], clicks: 5, impressions: 50, ctr: 0.1, position: 4,
            },
            {
              keys: [subUrl], clicks: 5, impressions: 50, ctr: 0.1, position: 4,
            },
          ],
        },
      }),
    };
    sinon.stub(GoogleClient, 'createFrom').resolves(google);
    const res = await runGscSearchAnalytics(finalUrl, context, site, {
      fixedUrls: [
        { url: exactUrl, fixType: 'meta-tags', fixDate: '2026-03-01' },
        { url: subUrl, fixType: 'meta-tags', fixDate: '2026-03-01' },
      ],
    });
    const byUrl = Object.fromEntries(res.auditResult.fixes.map((f) => [f.url, f.status]));
    expect(byUrl[exactUrl]).to.equal('measured');
    expect(byUrl[subUrl]).to.equal('measured');
  });

  it('degrades to all-in-scope (still measures) when scope resolution throws', async () => {
    // composeAuditURL does a live HTTP GET; a DNS/transport error must not reject the whole
    // audit after GSC is connected — the runner treats every fixed URL as in scope.
    scopeThrows = true;
    const google = { getOrganicSearchData: sinon.stub().resolves(rowFor(url)) };
    sinon.stub(GoogleClient, 'createFrom').resolves(google);
    const fixedUrls = [{ url, fixType: 'meta-tags', fixDate: '2026-03-01' }];
    const { auditResult } = await runGscSearchAnalytics(finalUrl, context, site, { fixedUrls });
    expect(auditResult.connected).to.equal(true);
    expect(auditResult.status).to.equal('ok');
    expect(auditResult.fixes[0].status).to.equal('measured');
  });
});
