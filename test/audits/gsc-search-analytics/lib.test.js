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
import GoogleClient from '@adobe/spacecat-shared-google-client';
import { runGscSearchAnalytics } from '../../../src/gsc-search-analytics/lib.js';
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
  const site = { getBaseURL: () => finalUrl };
  const context = { log: { info() {}, warn() {}, error() {} } };
  const url = 'https://krisshop.com/products/x';

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
});
