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

const iso = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().split('T')[0];
const rowFor = (url) => ({
  data: {
    rows: [{
      keys: [url], clicks: 5, impressions: 50, ctr: 0.1, position: 4,
    }],
  },
});
const emptyRows = () => ({ data: { rows: [] } });

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

  it('marks incomplete when the after window has not fully elapsed', async () => {
    const google = { getOrganicSearchData: sinon.stub().resolves(rowFor(url)) };
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

  it('records a per-group failure without wiping other groups', async () => {
    const google = { getOrganicSearchData: sinon.stub().rejects(new Error('GSC 500')) };
    sinon.stub(GoogleClient, 'createFrom').resolves(google);
    const fixedUrls = [{ url, fixType: 'meta-tags', fixDate: '2026-03-01' }];
    const { auditResult } = await runGscSearchAnalytics(finalUrl, context, site, { fixedUrls });
    expect(auditResult.connected).to.equal(true);
    const fix = auditResult.fixes[0];
    expect(fix.status).to.equal('failed');
    expect(fix.error).to.equal('GSC 500');
    expect(fix.found).to.deep.equal({ before: false, after: false });
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
});
