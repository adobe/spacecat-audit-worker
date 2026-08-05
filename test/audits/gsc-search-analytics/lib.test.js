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

describe('runGscSearchAnalytics', () => {
  const finalUrl = 'https://krisshop.com';
  const site = { getBaseURL: () => finalUrl };
  const context = { log: { info() {}, error() {} } };
  const fixedUrls = [
    { url: 'https://krisshop.com/products/x', fixType: 'meta-tags', fixDate: '2026-03-01' },
  ];

  afterEach(() => sinon.restore());

  it('returns a per-url before/after result when GSC is connected', async () => {
    const google = {
      getOrganicSearchData: sinon.stub().resolves({
        data: {
          rows: [{
            keys: ['https://krisshop.com/products/x'], clicks: 5, impressions: 50, ctr: 0.1, position: 4,
          }],
        },
      }),
    };
    sinon.stub(GoogleClient, 'createFrom').resolves(google);

    const { auditResult, fullAuditRef } = await runGscSearchAnalytics(finalUrl, context, site, { fixedUrls });
    expect(fullAuditRef).to.equal(finalUrl);
    expect(auditResult.connected).to.equal(true);
    expect(auditResult.fixCount).to.equal(1);
    expect(auditResult.fixes[0]).to.include({ url: 'https://krisshop.com/products/x', fixType: 'meta-tags' });
    expect(auditResult.fixes[0].found).to.deep.equal({ before: true, after: true });
    expect(auditResult.fixes[0]).to.have.nested.property('delta.clicks');
  });

  it('groups URLs sharing a fix date into one pair of pulls', async () => {
    const google = { getOrganicSearchData: sinon.stub().resolves({ data: { rows: [] } }) };
    sinon.stub(GoogleClient, 'createFrom').resolves(google);
    const twoSameDate = [
      { url: 'https://krisshop.com/a', fixType: 'meta-tags', fixDate: '2026-03-01' },
      { url: 'https://krisshop.com/b', fixType: 'alt-text', fixDate: '2026-03-01' },
    ];
    const { auditResult } = await runGscSearchAnalytics(finalUrl, context, site, { fixedUrls: twoSameDate });
    expect(auditResult.fixCount).to.equal(2);
    // one before pull + one after pull for the shared date
    expect(google.getOrganicSearchData.callCount).to.equal(2);
    expect(auditResult.fixes[0].found).to.deep.equal({ before: false, after: false });
    expect(auditResult.fixes[0].delta).to.equal(null);
  });

  it('records connected:false when GSC is not onboarded', async () => {
    sinon.stub(GoogleClient, 'createFrom').rejects(new Error('No secrets found for site'));
    const { auditResult } = await runGscSearchAnalytics(finalUrl, context, site, { fixedUrls });
    expect(auditResult.connected).to.equal(false);
  });

  it('re-raises a real infra failure instead of masking it as not-connected', async () => {
    sinon.stub(GoogleClient, 'createFrom').rejects(new Error('AccessDenied: throttled'));
    let threw = false;
    try {
      await runGscSearchAnalytics(finalUrl, context, site, { fixedUrls });
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
  });

  it('re-raises an error that has no message (falsy message path)', async () => {
    sinon.stub(GoogleClient, 'createFrom').rejects(new Error());
    let threw = false;
    try {
      await runGscSearchAnalytics(finalUrl, context, site, { fixedUrls });
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
  });

  it('records a per-group failure without wiping other groups', async () => {
    const google = { getOrganicSearchData: sinon.stub().rejects(new Error('GSC 500')) };
    sinon.stub(GoogleClient, 'createFrom').resolves(google);
    const { auditResult } = await runGscSearchAnalytics(finalUrl, context, site, { fixedUrls });
    expect(auditResult.connected).to.equal(true);
    expect(auditResult.fixes[0]).to.include({ failed: true });
    expect(auditResult.fixes[0].error).to.equal('GSC 500');
  });

  it('reads fixedUrls from messageData as a fallback', async () => {
    const google = { getOrganicSearchData: sinon.stub().resolves({ data: { rows: [] } }) };
    sinon.stub(GoogleClient, 'createFrom').resolves(google);
    const { auditResult } = await runGscSearchAnalytics(finalUrl, context, site, { messageData: { fixedUrls } });
    expect(auditResult.connected).to.equal(true);
    expect(auditResult.fixCount).to.equal(1);
  });

  it('errors cleanly when no fixedUrls are supplied', async () => {
    const { auditResult } = await runGscSearchAnalytics(finalUrl, context, site, {});
    expect(auditResult.error).to.equal('missing fixedUrls');
  });
});
