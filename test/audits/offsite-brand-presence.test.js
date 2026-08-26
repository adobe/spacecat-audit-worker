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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';
import * as handlerConstants from '../../src/offsite-brand-presence/constants.js';
import { SCRAPE_DATASET_IDS } from '@adobe/spacecat-shared-drs-client';
import {
  SEMRUSH_NOT_ENTITLED_REASON,
  SEMRUSH_ENTITLEMENT_CHECK_FAILED_REASON,
  SEMRUSH_ENTITLEMENT_REASONS,
} from '../../src/utils/semrush-entitlement.js';

const {
  DRS_URLS_LIMIT,
} = handlerConstants;

use(sinonChai);

const DEFAULT_WEEK = 7;
const DEFAULT_WEEK_2 = 6;
const DEFAULT_YEAR = 2026;

describe('Offsite Brand Presence Handler', function () {
  this.timeout(10000);

  let sandbox;
  let mockLoadBrandPresenceData;
  let mockLoadCitedUrlsFromSemrush;
  let mockGetPreviousWeeks;
  let mockSubmitScrapeJob;
  let mockDrsIsConfigured;
  let mockPostMessageOptional;
  let offsiteBrandPresenceRunner;
  let handlerDefault;

  let site;
  let context;
  let env;
  let log;
  let dataAccess;
  let sharedMocks;

  const FINAL_URL = 'https://example.com';
  const SITE_ID = 'site-123';
  const BASE_URL = 'https://example.com';

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    mockLoadBrandPresenceData = sandbox.stub();
    mockLoadCitedUrlsFromSemrush = sandbox.stub().resolves(null);
    mockGetPreviousWeeks = sandbox.stub().returns([
      { week: DEFAULT_WEEK, year: DEFAULT_YEAR },
      { week: DEFAULT_WEEK_2, year: DEFAULT_YEAR },
    ]);
    mockSubmitScrapeJob = sandbox.stub().resolves({ job_id: 'mock-job' });
    mockDrsIsConfigured = sandbox.stub().returns(true);
    mockPostMessageOptional = sandbox.stub().resolves({ success: true, result: {} });

    sharedMocks = {
      '../../src/utils/offsite-brand-presence-enrichment.js': {
        getPreviousWeeks: mockGetPreviousWeeks,
        loadBrandPresenceData: mockLoadBrandPresenceData,
      },
      '../../src/utils/offsite-brand-presence-semrush.js': {
        loadCitedUrlsFromSemrush: mockLoadCitedUrlsFromSemrush,
      },
      '@adobe/spacecat-shared-drs-client': {
        default: {
          createFrom: () => ({
            isConfigured: mockDrsIsConfigured,
            submitScrapeJob: mockSubmitScrapeJob,
          }),
        },
        SCRAPE_DATASET_IDS: {
          ...SCRAPE_DATASET_IDS,
        },
      },
      '../../src/utils/slack-utils.js': {
        postMessageOptional: mockPostMessageOptional,
      },
    };

    const mod = await esmock('../../src/offsite-brand-presence/handler.js', sharedMocks);

    offsiteBrandPresenceRunner = mod.offsiteBrandPresenceRunner;
    handlerDefault = mod.default;

    mockLoadBrandPresenceData.resolves(null);

    log = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    env = {
      DRS_API_URL: 'https://drs.api.example.com',
      DRS_API_KEY: 'test-drs-key',
    };

    dataAccess = {
      AuditUrl: {
        create: sandbox.stub().resolves({}),
        batchGetByKeys: sandbox.stub().resolves({ data: [] }),
      },
      SentimentTopic: {
        allBySiteId: sandbox.stub().resolves({ data: [] }),
        create: sandbox.stub().resolves({}),
      },
    };

    site = {
      getId: sandbox.stub().returns(SITE_ID),
      getBaseURL: sandbox.stub().returns(BASE_URL),
      getOrganization: sandbox.stub().resolves({
        getImsOrgId: () => '1234567890ABCDEF12345678@AdobeOrg',
      }),
    };

    context = { dataAccess, env, log };
    context.sqs = context.sqs || { sendMessage: sandbox.stub().resolves() };
    context.dataAccess.Configuration = context.dataAccess.Configuration || {
      findLatest: sandbox.stub().resolves({ getQueues: () => ({ audits: 'audits-queue-url' }) }),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  // ----- Helpers -----

  function drsError(status, text) {
    const err = new Error(`DRS POST /jobs failed: ${status} - ${text}`);
    err.status = status;
    return err;
  }

  function makeBrandPresenceData(sources) {
    return {
      data: sources.map((s) => {
        if (typeof s === 'string') {
          return {
            Sources: s, Region: 'US', Mentions: 'true', Citations: 'true',
          };
        }
        return {
          Sources: s.Sources, Region: s.Region || 'US', Mentions: 'true', Citations: 'true', Topic: s.Topic, Category: s.Category, Prompt: s.Prompt,
        };
      }),
    };
  }

  function stubBrandPresenceData(sources) {
    const data = makeBrandPresenceData(sources);
    mockLoadBrandPresenceData.resolves(data);
    return data;
  }

  // ----- Tests -----

  describe('Default Export', () => {
    it('should export a valid audit handler with runner and urlResolver', () => {
      expect(handlerDefault).to.be.an('object');
      expect(handlerDefault.runner).to.be.a('function');
      expect(handlerDefault.urlResolver).to.be.a('function');
    });
  });

  describe('PostgREST Fallback', () => {
    it('uses PostgREST data before query-index/file fetches', async () => {
      mockLoadBrandPresenceData.resolves({
        data: [{
          Sources: 'https://www.youtube.com/watch?v=abc123',
          Region: 'US',
          Topics: 'Topic A',
          Category: 'Category A',
          Prompt: 'Prompt A',
        }],
      });

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);
      expect(mockLoadBrandPresenceData).to.have.been.calledOnce;
      expect(mockLoadBrandPresenceData.firstCall.args[0].siteId).to.equal(SITE_ID);
      expect(mockLoadBrandPresenceData.firstCall.args[0].site).to.equal(site);
    });

    it('returns empty result when loadBrandPresenceData returns null', async () => {
      mockLoadBrandPresenceData.resolves(null);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(0);
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(0);
    });
  });

  describe('Semrush source (OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED)', () => {
    it('does not invoke the Semrush loader when the flag is off (regression)', async () => {
      // flag unset in env
      stubBrandPresenceData(['https://www.youtube.com/watch?v=x']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.dataSource).to.equal('legacy');
      expect(result.auditResult).to.not.have.property('fallbackReason');
      expect(mockLoadCitedUrlsFromSemrush).to.not.have.been.called;
      expect(mockLoadBrandPresenceData).to.have.been.calledOnce;
    });

    it('treats a non-"true" flag value as off (strict === true)', async () => {
      context.env.OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED = 'TRUE';
      stubBrandPresenceData(['https://www.youtube.com/watch?v=x']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.dataSource).to.equal('legacy');
      expect(mockLoadCitedUrlsFromSemrush).to.not.have.been.called;
    });

    it('treats "1" as off, not a truthy flag value (strict === true)', async () => {
      context.env.OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED = '1';
      stubBrandPresenceData(['https://www.youtube.com/watch?v=x']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.dataSource).to.equal('legacy');
      expect(mockLoadCitedUrlsFromSemrush).to.not.have.been.called;
    });

    it('uses the Semrush loader (with the expected args) and skips the legacy source when it yields URLs', async () => {
      context.env.OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED = 'true';
      mockLoadCitedUrlsFromSemrush.resolves(new Map([
        ['https://youtu.be/abc', { count: 5, domain: 'youtube.com' }],
        ['https://www.reddit.com/r/test/comments/1/p', { count: 3, domain: 'reddit.com' }],
      ]));

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.dataSource).to.equal('semrush');
      expect(result.auditResult).to.not.have.property('fallbackReason');
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(1);
      expect(mockLoadCitedUrlsFromSemrush).to.have.been.calledOnce;
      // Assert the integration seam wires the right args through (site + the
      // www-stripped siteHostname that owned-URL filtering depends on).
      const args = mockLoadCitedUrlsFromSemrush.firstCall.args[0];
      expect(args.site).to.equal(site);
      expect(args.siteHostname).to.equal('example.com');
      expect(args.context).to.equal(context);
      expect(args.previousWeeks).to.deep.equal([
        { week: DEFAULT_WEEK, year: DEFAULT_YEAR },
        { week: DEFAULT_WEEK_2, year: DEFAULT_YEAR },
      ]);
      expect(mockLoadBrandPresenceData).to.not.have.been.called;
    });

    it('emits a structured success with the loaded URL count on a clean Semrush run', async () => {
      context.env.OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED = 'true';
      mockLoadCitedUrlsFromSemrush.resolves(new Map([
        ['https://youtu.be/abc', { count: 5, domain: 'youtube.com' }],
      ]));

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      // The happy-path load emits a structured success with the loaded URL count.
      expect(log.info).to.have.been.calledWith(
        sinon.match(/Loaded 1 cited URL\(s\) from Semrush/)
          .and(sinon.match(/event=data_acquisition_bp_data_semrush_read/))
          .and(sinon.match(/outcome=success/))
          .and(sinon.match(/peer=semrush/))
          .and(sinon.match(/count=1/)),
      );
    });

    it('wires onProgress to post Semrush progress updates into the Slack thread', async () => {
      context.env.OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED = 'true';
      mockLoadCitedUrlsFromSemrush.resolves(new Map([
        ['https://youtu.be/abc', { count: 5, domain: 'youtube.com' }],
      ]));
      const slackContext = { channelId: 'C-semrush', threadTs: '111.222' };

      await offsiteBrandPresenceRunner(FINAL_URL, context, site, { slackContext });

      const args = mockLoadCitedUrlsFromSemrush.firstCall.args[0];
      expect(args.onProgress).to.be.a('function');

      await args.onProgress(':mag: test update');

      expect(mockPostMessageOptional).to.have.been.calledWithMatch(
        context,
        'C-semrush',
        `*offsite-brand-presence* for *${BASE_URL}* — :mag: test update`,
        { threadTs: '111.222' },
      );
    });

    it('hard-stops (success:false, no legacy) when an enableSemrush:true run fails', async () => {
      // Forced on via the Slack override — a failure must be visible, not masked.
      mockLoadCitedUrlsFromSemrush.resolves(null); // null = Semrush FAILED
      stubBrandPresenceData(['https://www.youtube.com/watch?v=legacy']); // must NOT be used

      const result = await offsiteBrandPresenceRunner(
        FINAL_URL, context, site, { messageData: { enableSemrush: true } },
      );

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.dataSource).to.equal('semrush');
      expect(result.auditResult.fallbackReason).to.equal('semrush_failed');
      expect(result.auditResult.error).to.match(/hard stop/);
      expect(mockLoadCitedUrlsFromSemrush).to.have.been.calledOnce;
      expect(mockLoadBrandPresenceData).to.not.have.been.called; // no legacy fallback
      expect(log.error).to.have.been.calledWith(
        sinon.match(/Semrush source failed/)
          .and(sinon.match(/event=data_acquisition_bp_data_semrush_read/))
          .and(sinon.match(/outcome=failure/))
          .and(sinon.match(/peer=semrush/))
          .and(sinon.match(/reason=semrush_failed/)),
      );
    });

    it('falls back to legacy when an ENV-enabled Semrush run fails (no hard stop)', async () => {
      context.env.OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED = 'true'; // env, not the override
      mockLoadCitedUrlsFromSemrush.resolves(null);
      stubBrandPresenceData(['https://www.youtube.com/watch?v=legacy']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.dataSource).to.equal('legacy');
      expect(result.auditResult.fallbackReason).to.equal('semrush_failed');
      expect(mockLoadBrandPresenceData).to.have.been.calledOnce;
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);
      expect(log.warn).to.have.been.calledWith(
        sinon.match(/falling back to PostgREST\/SharePoint/)
          .and(sinon.match(/event=data_acquisition_bp_data_semrush_read/))
          .and(sinon.match(/outcome=degraded/))
          .and(sinon.match(/peer=semrush/))
          .and(sinon.match(/reason=semrush_failed/)),
      );
    });

    it('treats a genuinely-empty Semrush result as a zero-URL semrush run (no legacy)', async () => {
      context.env.OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED = 'true';
      mockLoadCitedUrlsFromSemrush.resolves(new Map()); // success, 0 URLs (not a failure)
      stubBrandPresenceData(['https://www.reddit.com/r/test/comments/1/thread']); // must NOT be used

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.dataSource).to.equal('semrush');
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(0);
      expect(result.auditResult).to.not.have.property('fallbackReason');
      expect(mockLoadBrandPresenceData).to.not.have.been.called; // no legacy fallback
    });

    it('a Slack-requested enableSemrush:true override invokes the Semrush loader even when the env var is off', async () => {
      // flag unset in env
      mockLoadCitedUrlsFromSemrush.resolves(new Map([
        ['https://youtu.be/abc', { count: 5, domain: 'youtube.com' }],
      ]));

      const result = await offsiteBrandPresenceRunner(
        FINAL_URL,
        context,
        site,
        { messageData: { enableSemrush: true } },
      );

      expect(result.auditResult.success).to.be.true;
      expect(mockLoadCitedUrlsFromSemrush).to.have.been.calledOnce;
      expect(mockLoadBrandPresenceData).to.not.have.been.called;
    });

    it('a Slack-requested enableSemrush:false override skips the Semrush loader even when the env var is on', async () => {
      context.env.OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED = 'true';
      stubBrandPresenceData(['https://www.youtube.com/watch?v=legacy']);

      const result = await offsiteBrandPresenceRunner(
        FINAL_URL,
        context,
        site,
        { messageData: { enableSemrush: false } },
      );

      expect(result.auditResult.success).to.be.true;
      expect(mockLoadCitedUrlsFromSemrush).to.not.have.been.called;
      expect(mockLoadBrandPresenceData).to.have.been.calledOnce;
    });

    it('an invalid enableSemrush override is ignored and the env var value applies, with a warning logged', async () => {
      context.env.OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED = 'true';
      mockLoadCitedUrlsFromSemrush.resolves(new Map([
        ['https://youtu.be/abc', { count: 5, domain: 'youtube.com' }],
      ]));

      const result = await offsiteBrandPresenceRunner(
        FINAL_URL,
        context,
        site,
        { messageData: { enableSemrush: 'maybe' } },
      );

      expect(result.auditResult.success).to.be.true;
      expect(mockLoadCitedUrlsFromSemrush).to.have.been.calledOnce;
      expect(log.warn).to.have.been.calledWithMatch(/Invalid override value in auditContext/);
    });

    it('env-enabled fallback surfaces dataSource+fallbackReason even when legacy also yields nothing', async () => {
      context.env.OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED = 'true';
      mockLoadCitedUrlsFromSemrush.resolves(null);
      mockLoadBrandPresenceData.resolves(null); // legacy empty too

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.dataSource).to.equal('legacy');
      expect(result.auditResult.fallbackReason).to.equal('semrush_failed');
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(0);
    });

    it('surfaces entitlementReason on the no-URLs-found path too, when legacy also yields nothing', async () => {
      context.env.OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED = 'true';
      mockLoadCitedUrlsFromSemrush.callsFake(async ({ diagnostics }) => {
        if (diagnostics) {
          diagnostics.fallbackReason = SEMRUSH_NOT_ENTITLED_REASON;
          diagnostics.entitlementReason = SEMRUSH_ENTITLEMENT_REASONS.FLAG_DISABLED;
        }
        return null;
      });
      mockLoadBrandPresenceData.resolves(null); // legacy empty too

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.dataSource).to.equal('legacy');
      expect(result.auditResult.fallbackReason).to.equal(SEMRUSH_NOT_ENTITLED_REASON);
      expect(result.auditResult.entitlementReason).to.equal(SEMRUSH_ENTITLEMENT_REASONS.FLAG_DISABLED);
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(0);
    });

    it('surfaces the loader diagnostics fallbackReason code on hard stop', async () => {
      mockLoadCitedUrlsFromSemrush.callsFake(async ({ diagnostics }) => {
        if (diagnostics) {
          diagnostics.fallbackReason = 'ims_token_failed';
        }
        return null;
      });

      const result = await offsiteBrandPresenceRunner(
        FINAL_URL, context, site, { messageData: { enableSemrush: true } },
      );

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.dataSource).to.equal('semrush');
      expect(result.auditResult.fallbackReason).to.equal('ims_token_failed');
      expect(mockLoadBrandPresenceData).to.not.have.been.called;
    });

    it('falls back to legacy (never hard-stops) on a not-entitled brand, even with enableSemrush:true', async () => {
      mockLoadCitedUrlsFromSemrush.callsFake(async ({ diagnostics }) => {
        if (diagnostics) {
          diagnostics.fallbackReason = SEMRUSH_NOT_ENTITLED_REASON;
          diagnostics.entitlementReason = SEMRUSH_ENTITLEMENT_REASONS.NO_WORKSPACE;
        }
        return null;
      });
      stubBrandPresenceData(['https://www.youtube.com/watch?v=legacy']);

      const result = await offsiteBrandPresenceRunner(
        FINAL_URL, context, site, { messageData: { enableSemrush: true } },
      );

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.dataSource).to.equal('legacy');
      expect(result.auditResult.fallbackReason).to.equal(SEMRUSH_NOT_ENTITLED_REASON);
      expect(result.auditResult.entitlementReason).to.equal(SEMRUSH_ENTITLEMENT_REASONS.NO_WORKSPACE);
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);
      expect(mockLoadBrandPresenceData).to.have.been.calledOnce;
      expect(log.error).to.not.have.been.called;
      // A deliberate entitlement skip logs at warn with outcome=skip — distinct from a
      // genuine technical failure, which logs at warn with outcome=degraded (checked
      // below via the differing message text). A regression that swaps these branches
      // must fail this test.
      expect(log.warn).to.have.been.calledWithMatch(
        /Semrush skipped \(not_entitled\); falling back to PostgREST\/SharePoint/,
      );
      expect(log.warn).to.have.been.calledWithMatch(/outcome=skip/);
      expect(log.warn).to.not.have.been.calledWithMatch(/Semrush source failed/);
    });

    it('falls back to legacy (never hard-stops) when the entitlement check itself fails, even with enableSemrush:true', async () => {
      mockLoadCitedUrlsFromSemrush.callsFake(async ({ diagnostics }) => {
        if (diagnostics) {
          diagnostics.fallbackReason = SEMRUSH_ENTITLEMENT_CHECK_FAILED_REASON;
          diagnostics.entitlementReason = SEMRUSH_ENTITLEMENT_REASONS.NO_CLIENT;
        }
        return null;
      });
      stubBrandPresenceData(['https://www.youtube.com/watch?v=legacy']);

      const result = await offsiteBrandPresenceRunner(
        FINAL_URL, context, site, { messageData: { enableSemrush: true } },
      );

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.dataSource).to.equal('legacy');
      expect(result.auditResult.fallbackReason).to.equal(SEMRUSH_ENTITLEMENT_CHECK_FAILED_REASON);
      expect(result.auditResult.entitlementReason).to.equal(SEMRUSH_ENTITLEMENT_REASONS.NO_CLIENT);
      expect(mockLoadBrandPresenceData).to.have.been.calledOnce;
      expect(log.error).to.not.have.been.called;
      expect(log.warn).to.have.been.calledWithMatch(
        /Semrush skipped \(entitlement_check_failed\); falling back to PostgREST\/SharePoint/,
      );
      expect(log.warn).to.have.been.calledWithMatch(/outcome=skip/);
      expect(log.warn).to.not.have.been.calledWithMatch(/Semrush source failed/);
    });

    it('does not surface entitlementReason on a non-entitlement Semrush failure', async () => {
      context.env.OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED = 'true';
      mockLoadCitedUrlsFromSemrush.resolves(null); // fallbackReason defaults to 'semrush_failed'
      stubBrandPresenceData(['https://www.youtube.com/watch?v=legacy']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.fallbackReason).to.equal('semrush_failed');
      expect(result.auditResult).to.not.have.property('entitlementReason');
      expect(log.warn).to.have.been.calledWithMatch(/Semrush source failed \(semrush_failed\); falling back to PostgREST\/SharePoint/);
    });
  });

  describe('URL Extraction', () => {
    it('should extract youtube.com and reddit.com URLs including subdomains', async () => {
      const urls = 'https://www.youtube.com/watch?v=x;https://www.reddit.com/r/test/';
      stubBrandPresenceData([urls]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(1);
    });

    it('should handle semicolon, newline, and mixed separators in Sources field', async () => {
      const sources = 'https://youtube.com/shorts/a;https://youtube.com/shorts/b\nhttps://reddit.com/r/test/';
      stubBrandPresenceData([sources]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['youtube.com']).to.equal(2);
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(1);
    });

    it('should ignore invalid, malformed, and unrecognized URLs without crashing', async () => {
      const sources = 'not-a-url;https://youtube.com/v1;;  ;ftp://weird;https:///path;://nohost;plain-text';
      stubBrandPresenceData([sources]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);
    });

    it('should count URL occurrences across rows and providers', async () => {
      const sharedUrl = 'https://www.youtube.com/watch?v=shared';
      stubBrandPresenceData([sharedUrl, sharedUrl, sharedUrl]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);
    });

    it('should handle rows without Sources field', async () => {
      mockLoadBrandPresenceData.resolves({
        data: [
          {
            Prompt: 'test prompt', Region: 'US', Mentions: 'true', Citations: 'true',
          },
          {
            Sources: 'https://youtube.com/v1', Region: 'US', Mentions: 'true', Citations: 'true',
          },
        ],
      });

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);
    });

    it('extracts rows from every region without any region filtering', async () => {
      mockLoadBrandPresenceData.resolves({
        data: [
          { Sources: 'https://youtube.com/v1', Region: 'EU' },
          { Sources: 'https://youtube.com/v2', Region: 'US' },
          { Sources: 'https://youtube.com/ok', Region: 'GB' },
          { Sources: 'https://reddit.com/r/ok/', Region: 'IN' },
        ],
      });

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      // All regions counted; nothing is excluded on region.
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(3);
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(1);
    });

    it('merges the same URL cited from two different regions into one URL-store entry', async () => {
      // Region never enters the allUrls map key (it's keyed by normalized URL only), so this
      // is a regression-lock guarantee test that guards against a future change that starts
      // keying by region.
      mockLoadBrandPresenceData.resolves({
        data: [
          { Sources: 'https://www.youtube.com/watch?v=shared', Region: 'US' },
          { Sources: 'https://www.youtube.com/watch?v=shared', Region: 'GB' },
        ],
      });

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);
      const createCalls = dataAccess.AuditUrl.create.getCalls()
        .filter((c) => c.args[0].url === 'https://youtu.be/shared');
      expect(createCalls).to.have.lengthOf(1);
    });

    it('should ignore non-offsite and substring-matching domains', async () => {
      const sources = 'https://google.com/search;https://notyoutube.com/watch;https://fakereddit.com/r/test;https://twitter.com/post';
      stubBrandPresenceData([sources]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(0);
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(0);
    });

    it('should discard YouTube URLs with non-standard subdomains', async () => {
      const sources = 'https://music.youtube.com/watch?v=abc;https://studio.youtube.com/channel/123;https://www.youtube.com/watch?v=valid';
      stubBrandPresenceData([sources]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);
    });

    it('should discard Reddit URLs with non-standard subdomains', async () => {
      const sources = 'https://m.reddit.com/r/test/;https://old.reddit.com/r/test/;https://www.reddit.com/r/valid/';
      stubBrandPresenceData([sources]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['reddit.com']).to.equal(1);
    });

    it('should discard Reddit URLs without a path after subreddit name', async () => {
      const sources = 'https://reddit.com/r/test;https://reddit.com/r/valid/comments/abc/title';
      stubBrandPresenceData([sources]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['reddit.com']).to.equal(1);
    });

    it('should accept Reddit URLs with /t/ topic and /user/ paths', async () => {
      const sources = 'https://reddit.com/t/gaming/;https://reddit.com/user/someone/comments/abc/post';
      stubBrandPresenceData([sources]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['reddit.com']).to.equal(2);
    });

    it('should accept Reddit URLs with percent-encoded characters in path', async () => {
      const sources = 'https://reddit.com/r/sub/some%20path/';
      stubBrandPresenceData([sources]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['reddit.com']).to.equal(1);
    });
  });

  describe('Site URL Filtering', () => {
    it('should filter out URLs matching the site baseURL', async () => {
      stubBrandPresenceData(['https://example.com/page1;https://other.com/page2']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const createCalls = dataAccess.AuditUrl.create.getCalls();
      expect(createCalls).to.have.lengthOf(1);
      expect(createCalls[0].args[0].url).to.equal('https://other.com/page2');
    });

    it('should filter out URLs with www prefix matching the site baseURL', async () => {
      stubBrandPresenceData(['https://www.example.com/page;https://other.com/ok']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const createCalls = dataAccess.AuditUrl.create.getCalls();
      expect(createCalls).to.have.lengthOf(1);
      expect(createCalls[0].args[0].url).to.equal('https://other.com/ok');
    });

    it('should filter out subdomain URLs matching the site baseURL', async () => {
      stubBrandPresenceData(['https://blog.example.com/post;https://other.com/ok']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const createCalls = dataAccess.AuditUrl.create.getCalls();
      expect(createCalls).to.have.lengthOf(1);
      expect(createCalls[0].args[0].url).to.equal('https://other.com/ok');
    });

    it('drops brand-owned lookalike domains containing the brand token, keeps neutral hosts', async () => {
      // Site is example.com ⇒ brand token "example". A host containing the token
      // (notexample.com) is treated as a branded lookalike and dropped; a neutral
      // third-party host is kept.
      stubBrandPresenceData(['https://notexample.com/page;https://other.com/ok']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const createCalls = dataAccess.AuditUrl.create.getCalls();
      expect(createCalls).to.have.lengthOf(1);
      expect(createCalls[0].args[0].url).to.equal('https://other.com/ok');
    });

    it('drops social/search/deal-aggregator domains before storing', async () => {
      stubBrandPresenceData([
        'https://www.google.com/search;https://www.facebook.com/groups/x/posts/1;'
        + 'https://www.instagram.com/p/abc;https://www.groupon.com/coupons/foo;https://other.com/ok',
      ]);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const createCalls = dataAccess.AuditUrl.create.getCalls();
      expect(createCalls).to.have.lengthOf(1);
      expect(createCalls[0].args[0].url).to.equal('https://other.com/ok');
    });

    it('should skip filtering and log a warning when baseURL is malformed', async () => {
      site.getBaseURL.returns('not-a-url');
      stubBrandPresenceData(['https://other.com/page']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(log.warn).to.have.been.calledWith(
        sinon.match(/Could not parse baseURL/),
      );
      const createCalls = dataAccess.AuditUrl.create.getCalls();
      expect(createCalls).to.have.lengthOf(1);
    });

    it('should handle www baseURL by filtering both www and bare hostname', async () => {
      site.getBaseURL.returns('https://www.example.com');
      stubBrandPresenceData(['https://example.com/page;https://www.example.com/page2;https://other.com/ok']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const createCalls = dataAccess.AuditUrl.create.getCalls();
      expect(createCalls).to.have.lengthOf(1);
      expect(createCalls[0].args[0].url).to.equal('https://other.com/ok');
    });

    it('should drop lookalike domains matched by a configured brand keyword', async () => {
      // A configured brand keyword (not derivable from the apex label) catches a
      // brand-owned lookalike domain before it is stored.
      site.getConfig = sandbox.stub().returns({
        getBrandKeywords: sandbox.stub().returns(['Acme Loyalty']),
      });
      stubBrandPresenceData(['https://acmeloyalty.com/rewards;https://other.com/ok']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const createCalls = dataAccess.AuditUrl.create.getCalls();
      expect(createCalls).to.have.lengthOf(1);
      expect(createCalls[0].args[0].url).to.equal('https://other.com/ok');
    });
  });

  describe('URL Normalization', () => {
    it('should normalize youtube.com/watch URLs to youtu.be short form', async () => {
      stubBrandPresenceData(['https://www.youtube.com/watch?v=abc123']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const videosCall = mockSubmitScrapeJob.getCalls().find(
        (c) => c.args[0].datasetId === 'youtube_videos',
      );
      expect(videosCall.args[0].urls).to.deep.equal(['https://youtu.be/abc123']);
    });

    it('should keep youtube.com/shorts URLs as-is (strip query params only)', async () => {
      stubBrandPresenceData(['https://www.youtube.com/shorts/xyz?feature=share']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const videosCall = mockSubmitScrapeJob.getCalls().find(
        (c) => c.args[0].datasetId === 'youtube_videos',
      );
      expect(videosCall.args[0].urls).to.deep.equal(['https://www.youtube.com/shorts/xyz']);
    });

    it('should normalize youtu.be short URLs via domain alias', async () => {
      stubBrandPresenceData(['https://youtu.be/shortId']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);
      expect(mockSubmitScrapeJob).to.have.been.called;
    });

    it('should preserve trailing slash for domain-root URLs', async () => {
      stubBrandPresenceData(['https://thirdparty.com/']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const createCalls = dataAccess.AuditUrl.create.getCalls();
      expect(createCalls[0].args[0].url).to.equal('https://thirdparty.com/');
    });

    it('should strip trailing slash and query parameters from reddit URLs', async () => {
      stubBrandPresenceData(['https://reddit.com/r/test/post/?utm_source=share']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const postsCall = mockSubmitScrapeJob.getCalls().find(
        (c) => c.args[0].datasetId === 'reddit_posts',
      );
      expect(postsCall.args[0].urls[0]).to.equal('https://reddit.com/r/test/post');
    });
  });

  describe('No URLs Found', () => {
    it('should return success with zero counts and skip URL store and DRS', async () => {
      mockLoadBrandPresenceData.resolves(null);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(0);
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(0);
      // wikipedia is no longer a scraped offsite domain, so it is not counted.
      expect(result.auditResult.urlCounts).to.not.have.property('wikipedia.org');
      expect(result.fullAuditRef).to.equal(FINAL_URL);
      // A clean "nothing to report this week" finding still deviates from the full happy
      // path, so it is logged at warn while keeping outcome=skip (deliberate no-op).
      expect(log.warn).to.have.been.calledWith(
        sinon.match(/No offsite URLs found/)
          .and(sinon.match(/outcome=skip/)),
      );
      expect(dataAccess.AuditUrl.create).to.not.have.been.called;
    });
  });

  describe('URL Store Integration', () => {
    it('should add URLs to URL store via dataAccess', async () => {
      stubBrandPresenceData(['https://youtube.com/watch?v=test']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(dataAccess.AuditUrl.create).to.have.been.calledOnce;
      const createArg = dataAccess.AuditUrl.create.firstCall.args[0];
      expect(createArg.siteId).to.equal(SITE_ID);
      expect(createArg.url).to.equal('https://youtu.be/test');
      expect(createArg.byCustomer).to.equal(false);
      expect(createArg.audits).to.deep.equal(['youtube-analysis']);
    });

    it('should still send URL to DRS when it already exists in the URL store', async () => {
      dataAccess.AuditUrl.batchGetByKeys.resolves({
        data: [{ getUrl: () => 'https://youtu.be/test' }],
      });

      stubBrandPresenceData(['https://youtube.com/watch?v=test']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(dataAccess.AuditUrl.create).to.not.have.been.called;
      expect(result.auditResult.success).to.be.true;
      expect(log.info).to.have.been.calledWith(
        sinon.match(/created=0 existing=1 failed=0/),
      );

      const videosCall = mockSubmitScrapeJob.getCalls().find(
        (c) => c.args[0].datasetId === 'youtube_videos',
      );
      expect(videosCall.args[0].urls).to.include('https://youtu.be/test');
    });

    it('should return empty storedByDomain when batchGetByKeys fails', async () => {
      dataAccess.AuditUrl.batchGetByKeys.rejects(new Error('DB connection lost'));

      stubBrandPresenceData(['https://youtube.com/watch?v=test']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(dataAccess.AuditUrl.create).to.not.have.been.called;
      expect(mockSubmitScrapeJob).to.not.have.been.called;
      expect(log.error).to.have.been.calledWith(
        sinon.match(/Failed to check existing URLs/),
      );
    });

    it('should handle URL store create failure gracefully and skip DRS for failed URLs', async () => {
      dataAccess.AuditUrl.create.rejects(new Error('DynamoDB error'));

      stubBrandPresenceData(['https://youtube.com/watch?v=test']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.drsJobs).to.deep.equal([]);
      expect(mockSubmitScrapeJob).to.not.have.been.called;
      expect(log.warn).to.have.been.calledWith(
        sinon.match(/Failed to add URL to store/),
      );
      expect(log.info).to.have.been.calledWith(
        sinon.match(/created=0 existing=0 failed=1/),
      );
    });

    it('should only send successfully stored URLs to DRS when some fail', async () => {
      const sources = 'https://youtube.com/shorts/a;https://youtube.com/shorts/b;https://reddit.com/r/test/';
      stubBrandPresenceData([sources]);

      dataAccess.AuditUrl.create.onCall(1).rejects(new Error('write failed'));

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(log.info).to.have.been.calledWith(
        sinon.match(/created=2 existing=0 failed=1/),
      );

      const videosCall = mockSubmitScrapeJob.getCalls().find(
        (c) => c.args[0].datasetId === 'youtube_videos',
      );
      expect(videosCall.args[0].urls).to.have.lengthOf(1);

      const postsCall = mockSubmitScrapeJob.getCalls().find(
        (c) => c.args[0].datasetId === 'reddit_posts',
      );
      expect(postsCall.args[0].urls).to.have.lengthOf(1);
    });

    it('should skip DRS for a domain when all its URLs fail to store', async () => {
      const sources = 'https://youtube.com/shorts/a;https://reddit.com/r/test/';
      stubBrandPresenceData([sources]);

      dataAccess.AuditUrl.create.onCall(0).rejects(new Error('youtube store failed'));

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;

      const ytCalls = mockSubmitScrapeJob.getCalls().filter(
        (c) => c.args[0].datasetId.startsWith('youtube_'),
      );
      expect(ytCalls).to.have.lengthOf(0);

      const redditCalls = mockSubmitScrapeJob.getCalls().filter(
        (c) => c.args[0].datasetId.startsWith('reddit_'),
      );
      expect(redditCalls).to.have.lengthOf(2);
    });

    it('should add URLs for multiple domains to URL store', async () => {
      stubBrandPresenceData(['https://youtube.com/shorts/a;https://reddit.com/r/test/']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(dataAccess.AuditUrl.create).to.have.been.calledTwice;

      const createCalls = dataAccess.AuditUrl.create.getCalls();
      const auditTypes = createCalls.map((c) => c.args[0].audits[0]);
      expect(auditTypes).to.include('youtube-analysis');
      expect(auditTypes).to.include('reddit-analysis');
    });

    it('does not store or scrape wikipedia URLs (analyzed independently by Mystique)', async () => {
      stubBrandPresenceData(['https://en.wikipedia.org/wiki/Adobe']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      // Recognized for exclusion only: not bucketed, persisted, or scraped.
      expect(dataAccess.AuditUrl.create).to.not.have.been.called;
      expect(mockSubmitScrapeJob).to.not.have.been.called;
    });

    it('excludes a bare wikipedia.org host (exact match, no subdomain)', async () => {
      stubBrandPresenceData(['https://wikipedia.org/wiki/Adobe']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(dataAccess.AuditUrl.create).to.not.have.been.called;
      expect(mockSubmitScrapeJob).to.not.have.been.called;
    });
  });

  describe('Top URLs Per Domain', () => {
    it('should limit both DRS and URL store to top-N URLs per domain', async () => {
      const urls = [];
      const urlCount = DRS_URLS_LIMIT + 10;
      for (let i = 0; i < urlCount; i += 1) {
        urls.push(`https://youtube.com/shorts/vid${i}`);
      }
      const sources = urls.join(';');
      stubBrandPresenceData([sources]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['youtube.com']).to.equal(urlCount);

      const videosCall = mockSubmitScrapeJob.getCalls().find(
        (c) => c.args[0].datasetId === 'youtube_videos',
      );
      expect(videosCall.args[0].urls).to.have.lengthOf(DRS_URLS_LIMIT);
      expect(dataAccess.AuditUrl.create.callCount).to.equal(DRS_URLS_LIMIT);
    });

    it('should select most frequent URLs for DRS when counts differ', async () => {
      mockLoadBrandPresenceData.resolves({
        data: [
          {
            Sources: 'https://youtube.com/shorts/popular',
            Region: 'US',
            Mentions: 'true',
            Citations: 'true',
          },
          {
            Sources: 'https://youtube.com/shorts/popular',
            Region: 'US',
            Mentions: 'true',
            Citations: 'true',
          },
          {
            Sources: 'https://youtube.com/shorts/rare',
            Region: 'US',
            Mentions: 'true',
            Citations: 'true',
          },
        ],
      });

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['youtube.com']).to.equal(2);
    });
  });

  describe('Top Cited URLs', () => {
    it('should add non-offsite URLs to URL store with cited-analysis audit type', async () => {
      stubBrandPresenceData(['https://thirdparty.com/page1;https://other.com/page2']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const createCalls = dataAccess.AuditUrl.create.getCalls();
      expect(createCalls).to.have.lengthOf(2);
      for (const call of createCalls) {
        expect(call.args[0].audits).to.deep.equal(['cited-analysis']);
      }
    });

    it('should exclude offsite domain URLs from top-cited bucket', async () => {
      const sources = 'https://youtube.com/watch?v=abc;https://reddit.com/r/test/;https://en.wikipedia.org/wiki/Adobe;https://thirdparty.com/page';
      stubBrandPresenceData([sources]);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const createCalls = dataAccess.AuditUrl.create.getCalls();
      const topCitedCalls = createCalls.filter((c) => c.args[0].audits[0] === 'cited-analysis');
      expect(topCitedCalls).to.have.lengthOf(1);
      expect(topCitedCalls[0].args[0].url).to.equal('https://thirdparty.com/page');
    });

    it('should trigger DRS scraping for top-cited URLs', async () => {
      stubBrandPresenceData(['https://thirdparty.com/page1;https://other.com/page2']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const topCitedJob = result.auditResult.drsJobs.find(
        (j) => j.datasetId === SCRAPE_DATASET_IDS.TOP_CITED,
      );
      expect(topCitedJob).to.deep.include({
        domain: 'top-cited',
        datasetId: SCRAPE_DATASET_IDS.TOP_CITED,
        status: 'success',
      });
      expect(mockSubmitScrapeJob).to.have.been.calledWith(sinon.match({
        datasetId: SCRAPE_DATASET_IDS.TOP_CITED,
        siteId: SITE_ID,
        urls: [{ url: 'https://thirdparty.com/page1' }, { url: 'https://other.com/page2' }],
      }));
    });

    it('should respect DRS_URLS_LIMIT for top-cited URLs', async () => {
      const urls = [];
      const totalUrls = DRS_URLS_LIMIT + 10;
      for (let i = 0; i < totalUrls; i += 1) {
        // Neutral third-party hosts (no "example" brand token, not social/search).
        urls.push(`https://thirdparty${i}.com/page`);
      }
      stubBrandPresenceData([urls.join(';')]);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const createCalls = dataAccess.AuditUrl.create.getCalls();
      const topCitedCalls = createCalls.filter((c) => c.args[0].audits[0] === 'cited-analysis');
      expect(topCitedCalls).to.have.lengthOf(DRS_URLS_LIMIT);
    });
  });

  describe('DRS Scraping', () => {
    it('should trigger DRS jobs for youtube (2 datasets) and reddit (2 datasets)', async () => {
      const urls = 'https://youtube.com/shorts/v1;https://reddit.com/r/test/';
      stubBrandPresenceData([urls]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.drsJobs).to.have.lengthOf(4);
      expect(result.auditResult.drsJobs[0]).to.deep.include({
        domain: 'youtube.com',
        datasetId: SCRAPE_DATASET_IDS.YOUTUBE_VIDEOS,
        status: 'success',
      });
      expect(result.auditResult.drsJobs[1]).to.deep.include({
        domain: 'youtube.com',
        datasetId: SCRAPE_DATASET_IDS.YOUTUBE_COMMENTS,
        status: 'success',
      });
      expect(result.auditResult.drsJobs[2]).to.deep.include({
        domain: 'reddit.com',
        datasetId: SCRAPE_DATASET_IDS.REDDIT_POSTS,
        status: 'success',
      });
      expect(result.auditResult.drsJobs[3]).to.deep.include({
        domain: 'reddit.com',
        datasetId: SCRAPE_DATASET_IDS.REDDIT_COMMENTS,
        status: 'success',
      });
    });

    it('should call submitScrapeJob with correct params', async () => {
      stubBrandPresenceData(['https://youtube.com/watch?v=x']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const videosCall = mockSubmitScrapeJob.getCalls().find(
        (c) => c.args[0].datasetId === SCRAPE_DATASET_IDS.YOUTUBE_VIDEOS,
      );
      expect(videosCall).to.exist;
      expect(videosCall.args[0]).to.deep.include({
        datasetId: SCRAPE_DATASET_IDS.YOUTUBE_VIDEOS,
        siteId: SITE_ID,
      });
      expect(videosCall.args[0].urls).to.deep.equal(['https://youtu.be/x']);
      expect(videosCall.args[0]).to.not.have.property('daysBack');
    });

    it('forwards the resolved imsOrgId to submitScrapeJob for every dataset', async () => {
      stubBrandPresenceData(['https://youtube.com/watch?v=x', 'https://reddit.com/r/adobe/']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const calls = mockSubmitScrapeJob.getCalls();
      expect(calls).to.not.be.empty;
      calls.forEach((c) => {
        expect(c.args[0].imsOrgId).to.equal('1234567890ABCDEF12345678@AdobeOrg');
      });
    });

    it('should not attach reddit_comments params by default (DRS client applies defaults)', async () => {
      stubBrandPresenceData(['https://reddit.com/r/adobe/']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const commentsCall = mockSubmitScrapeJob.getCalls().find(
        (c) => c.args[0].datasetId === SCRAPE_DATASET_IDS.REDDIT_COMMENTS,
      );
      expect(commentsCall).to.exist;
      expect(commentsCall.args[0]).to.not.have.property('daysBack');
      expect(commentsCall.args[0]).to.not.have.property('commentLimit');
      expect(commentsCall.args[0]).to.not.have.property('sortBy');
      expect(commentsCall.args[0]).to.not.have.property('loadAllReplies');

      const postsCall = mockSubmitScrapeJob.getCalls().find(
        (c) => c.args[0].datasetId === SCRAPE_DATASET_IDS.REDDIT_POSTS,
      );
      expect(postsCall).to.exist;
      expect(postsCall.args[0]).to.not.have.property('daysBack');
      expect(postsCall.args[0]).to.not.have.property('commentLimit');
      expect(postsCall.args[0]).to.not.have.property('sortBy');
      expect(postsCall.args[0]).to.not.have.property('loadAllReplies');
    });

    it('forwards messageData reddit params to submitScrapeJob for reddit_comments only', async () => {
      stubBrandPresenceData(['https://reddit.com/r/adobe/']);

      const auditContext = {
        messageData: {
          redditCommentLimit: '300',
          redditSortBy: 'Top',
          redditDaysBack: '7',
          redditLoadAllReplies: 'true',
        },
      };

      await offsiteBrandPresenceRunner(FINAL_URL, context, site, auditContext);

      const commentsCall = mockSubmitScrapeJob.getCalls().find(
        (c) => c.args[0].datasetId === SCRAPE_DATASET_IDS.REDDIT_COMMENTS,
      );
      expect(commentsCall).to.exist;
      expect(commentsCall.args[0]).to.include({
        commentLimit: 300,
        sortBy: 'Top',
        daysBack: 7,
        loadAllReplies: true,
      });

      const postsCall = mockSubmitScrapeJob.getCalls().find(
        (c) => c.args[0].datasetId === SCRAPE_DATASET_IDS.REDDIT_POSTS,
      );
      expect(postsCall).to.exist;
      expect(postsCall.args[0]).to.not.have.property('commentLimit');
      expect(postsCall.args[0]).to.not.have.property('sortBy');
      expect(postsCall.args[0]).to.not.have.property('daysBack');
      expect(postsCall.args[0]).to.not.have.property('loadAllReplies');
    });

    it('normalizes redditSortBy "QA" to "Q&A" before forwarding', async () => {
      stubBrandPresenceData(['https://reddit.com/r/adobe/']);

      const auditContext = { messageData: { redditSortBy: 'QA' } };
      await offsiteBrandPresenceRunner(FINAL_URL, context, site, auditContext);

      const commentsCall = mockSubmitScrapeJob.getCalls().find(
        (c) => c.args[0].datasetId === SCRAPE_DATASET_IDS.REDDIT_COMMENTS,
      );
      expect(commentsCall.args[0].sortBy).to.equal('Q&A');
    });

    it('forwards redditLoadAllReplies=false explicitly when provided as string "false"', async () => {
      stubBrandPresenceData(['https://reddit.com/r/adobe/']);

      const auditContext = { messageData: { redditLoadAllReplies: 'false' } };
      await offsiteBrandPresenceRunner(FINAL_URL, context, site, auditContext);

      const commentsCall = mockSubmitScrapeJob.getCalls().find(
        (c) => c.args[0].datasetId === SCRAPE_DATASET_IDS.REDDIT_COMMENTS,
      );
      expect(commentsCall.args[0]).to.have.property('loadAllReplies', false);
    });

    it('forwards reddit params delivered as native types (numbers and booleans)', async () => {
      stubBrandPresenceData(['https://reddit.com/r/adobe/']);

      const auditContext = {
        messageData: {
          redditCommentLimit: 250,
          redditDaysBack: 14,
          redditLoadAllReplies: true,
        },
      };

      await offsiteBrandPresenceRunner(FINAL_URL, context, site, auditContext);

      const commentsCall = mockSubmitScrapeJob.getCalls().find(
        (c) => c.args[0].datasetId === SCRAPE_DATASET_IDS.REDDIT_COMMENTS,
      );
      expect(commentsCall.args[0]).to.include({
        commentLimit: 250,
        daysBack: 14,
        loadAllReplies: true,
      });
    });

    it('drops invalid reddit param values (non-numeric, blank, unknown booleans)', async () => {
      stubBrandPresenceData(['https://reddit.com/r/adobe/']);

      const auditContext = {
        messageData: {
          redditCommentLimit: 'lots',
          redditDaysBack: '',
          redditSortBy: '',
          redditLoadAllReplies: 'maybe',
        },
      };

      await offsiteBrandPresenceRunner(FINAL_URL, context, site, auditContext);

      const commentsCall = mockSubmitScrapeJob.getCalls().find(
        (c) => c.args[0].datasetId === SCRAPE_DATASET_IDS.REDDIT_COMMENTS,
      );
      expect(commentsCall.args[0]).to.not.have.property('commentLimit');
      expect(commentsCall.args[0]).to.not.have.property('daysBack');
      expect(commentsCall.args[0]).to.not.have.property('sortBy');
      expect(commentsCall.args[0]).to.not.have.property('loadAllReplies');
    });

    it('drops non-empty redditSortBy values that are not in the allowlist', async () => {
      stubBrandPresenceData(['https://reddit.com/r/adobe/']);

      const auditContext = { messageData: { redditSortBy: 'Hot' } };
      await offsiteBrandPresenceRunner(FINAL_URL, context, site, auditContext);

      const commentsCall = mockSubmitScrapeJob.getCalls().find(
        (c) => c.args[0].datasetId === SCRAPE_DATASET_IDS.REDDIT_COMMENTS,
      );
      expect(commentsCall.args[0]).to.not.have.property('sortBy');
    });

    it('does not submit a DRS scrape job for wikipedia URLs', async () => {
      stubBrandPresenceData(['https://en.wikipedia.org/wiki/Adobe']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      // Not scraped and excluded from top-cited, so no job for a wikipedia-only run.
      expect(mockSubmitScrapeJob).to.not.have.been.called;
    });

    it('should handle DRS API returning error response', async () => {
      mockSubmitScrapeJob.rejects(drsError(503, 'Service Unavailable'));

      stubBrandPresenceData(['https://youtube.com/shorts/v1']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.drsJobs).to.have.lengthOf(2);
      expect(result.auditResult.drsJobs[0].status).to.equal('error');
      expect(result.auditResult.drsJobs[0].error).to.include('503');
      expect(log.error).to.have.been.calledWith(
        sinon.match(/DRS job submission failed/),
      );
    });

    it('should retry once and succeed when first attempt fails with retriable error', async () => {
      mockSubmitScrapeJob
        .onCall(0).rejects(new TypeError('fetch failed'))
        .onCall(1).resolves({ job_id: 'retry-ok' })
        .onCall(2).resolves({ job_id: 'first-try-ok' })
        .onCall(3).resolves({ job_id: 'first-try-ok' });

      stubBrandPresenceData(['https://youtube.com/shorts/v1']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.drsJobs).to.have.lengthOf(2);
      expect(result.auditResult.drsJobs[0].status).to.equal('success');
      expect(result.auditResult.drsJobs[0].response.job_id).to.equal('retry-ok');
      expect(log.warn).to.have.been.calledWith(
        sinon.match(/DRS job submission failed; retrying/).and(sinon.match(/delayMs=500/)),
      );
    });

    it('should skip DRS when not configured', async () => {
      mockDrsIsConfigured.returns(false);

      stubBrandPresenceData(['https://youtube.com/shorts/v1']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.drsJobs).to.deep.equal([]);
      expect(mockSubmitScrapeJob).to.not.have.been.called;
      // Missing DRS credentials is a system/infra gap that only we can fix — nothing
      // self-heals — so it is emitted at error level with outcome=failure.
      expect(log.error).to.have.been.calledWith(
        sinon.match(/DRS scraping unavailable this run/)
          .and(sinon.match(/event=data_acquisition_drs_scrape_job_request_dispatched/))
          .and(sinon.match(/outcome=failure/))
          .and(sinon.match(/reason=drs_not_configured/)),
      );
    });

  });

  describe('DRS Scraping with spacecatOrgId', () => {
    it('should pass spacecatOrgId through to submitScrapeJob when present in messageData', async () => {
      stubBrandPresenceData(['https://youtube.com/shorts/v1']);

      const auditContext = { messageData: { spacecatOrgId: 'org-abc-123' } };
      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site, auditContext);

      expect(result.auditResult.drsJobs).to.have.lengthOf(2);
      for (const call of mockSubmitScrapeJob.getCalls()) {
        expect(call.args[0].spacecatOrgId).to.equal('org-abc-123');
      }
    });

    it('should not include spacecatOrgId in submitScrapeJob params when absent', async () => {
      stubBrandPresenceData(['https://youtube.com/shorts/v1']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      for (const call of mockSubmitScrapeJob.getCalls()) {
        expect(call.args[0]).to.not.have.property('spacecatOrgId');
      }
    });

    it('should pass spacecatOrgId for all domain types', async () => {
      const sources = 'https://youtube.com/shorts/v1;https://reddit.com/r/adobe/;https://en.wikipedia.org/wiki/Adobe;https://thirdparty.com/page';
      stubBrandPresenceData([sources]);

      const auditContext = { messageData: { spacecatOrgId: 'org-multi' } };
      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site, auditContext);

      // youtube (2) + reddit (2) + top-cited (1); wikipedia is excluded, not scraped.
      expect(result.auditResult.drsJobs).to.have.lengthOf(5);
      for (const call of mockSubmitScrapeJob.getCalls()) {
        expect(call.args[0].spacecatOrgId).to.equal('org-multi');
      }
    });
  });

  describe('DRS Scraping imsOrgId resolution', () => {
    it('skips DRS scraping and logs an error/failure when the organization has no imsOrgId', async () => {
      site.getOrganization = sandbox.stub().resolves({ getImsOrgId: () => null });
      stubBrandPresenceData(['https://youtube.com/shorts/v1']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.drsJobs).to.deep.equal([]);
      expect(mockSubmitScrapeJob).to.not.have.been.called;
      // A missing imsOrgId blocks scraping/deliverable entirely for this org this cycle —
      // the same class as other zero-deliverable setup gaps — so it is logged at error
      // level with outcome=failure, not a legitimate "nothing to report" finding.
      expect(log.error).to.have.been.calledWith(
        sinon.match(/imsOrgId/)
          .and(sinon.match(/produces no scraped content for this org/))
          .and(sinon.match(/event=data_acquisition_drs_scrape_job_request_dispatched/))
          .and(sinon.match(/outcome=failure/))
          .and(sinon.match(/reason=no_ims_org/)),
      );
    });

    it('skips DRS scraping when the site has no organization', async () => {
      site.getOrganization = sandbox.stub().resolves(null);
      stubBrandPresenceData(['https://youtube.com/shorts/v1']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.drsJobs).to.deep.equal([]);
      expect(mockSubmitScrapeJob).to.not.have.been.called;
    });
  });

  describe('Selective Retry', () => {
    it('should retry on 502 and succeed on second attempt', async () => {
      mockSubmitScrapeJob
        .onCall(0).rejects(drsError(502, 'Bad Gateway'))
        .onCall(1).resolves({ job_id: 'retry-ok' })
        .onCall(2).resolves({ job_id: 'ok' })
        .onCall(3).resolves({ job_id: 'ok' });

      stubBrandPresenceData(['https://youtube.com/shorts/v1']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.drsJobs[0].status).to.equal('success');
      expect(result.auditResult.drsJobs[0].response.job_id).to.equal('retry-ok');
      expect(log.warn).to.have.been.calledWith(sinon.match(/DRS job submission failed; retrying/).and(sinon.match(/delayMs=500/)));
    });

    it('should not retry on 400 and fail immediately', async () => {
      mockSubmitScrapeJob
        .onCall(0).rejects(drsError(400, 'Bad Request'))
        .onCall(1).resolves({ job_id: 'ok' })
        .onCall(2).resolves({ job_id: 'ok' });

      stubBrandPresenceData(['https://youtube.com/shorts/v1']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.drsJobs[0].status).to.equal('error');
      expect(result.auditResult.drsJobs[0].error).to.include('400');
      expect(result.auditResult.drsJobs[1].status).to.equal('success');
      expect(log.warn).to.not.have.been.calledWith(sinon.match(/retrying/));
    });

    it('should retry on network error (TypeError) and succeed', async () => {
      mockSubmitScrapeJob
        .onCall(0).rejects(new TypeError('fetch failed'))
        .onCall(1).resolves({ job_id: 'net-retry-ok' })
        .onCall(2).resolves({ job_id: 'ok' })
        .onCall(3).resolves({ job_id: 'ok' });

      stubBrandPresenceData(['https://youtube.com/shorts/v1']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.drsJobs[0].status).to.equal('success');
      expect(result.auditResult.drsJobs[0].response.job_id).to.equal('net-retry-ok');
      expect(log.warn).to.have.been.calledWith(sinon.match(/DRS job submission failed; retrying/).and(sinon.match(/delayMs=500/)));
    });

    it('should record error when both attempts fail with 503', async () => {
      mockSubmitScrapeJob.rejects(drsError(503, 'Service Unavailable'));

      stubBrandPresenceData(['https://youtube.com/shorts/v1']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      for (const job of result.auditResult.drsJobs) {
        expect(job.status).to.equal('error');
        expect(job.error).to.include('503');
      }
      expect(log.error).to.have.been.calledWith(sinon.match(/DRS job submission failed after retry/));
    });

    it('should not retry on 422 and fail immediately', async () => {
      mockSubmitScrapeJob
        .onCall(0).rejects(drsError(422, 'Unprocessable Entity'))
        .onCall(1).resolves({ job_id: 'ok' })
        .onCall(2).resolves({ job_id: 'ok' });

      stubBrandPresenceData(['https://youtube.com/shorts/v1']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.drsJobs[0].status).to.equal('error');
      expect(result.auditResult.drsJobs[0].error).to.include('422');
      expect(log.warn).to.not.have.been.calledWith(sinon.match(/retrying/));
    });
  });

  describe('Slack Notifications', () => {
    const SLACK_CHANNEL_ID = 'C-test-channel';
    const SLACK_THREAD_TS = '1700000000.123456';
    const AUDIT_CONTEXT_WITH_SLACK = {
      slackContext: { channelId: SLACK_CHANNEL_ID, threadTs: SLACK_THREAD_TS },
    };

    it('should send a Slack thread reply with DRS job IDs when slackContext is provided', async () => {
      stubBrandPresenceData(['https://youtube.com/shorts/v1']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site, AUDIT_CONTEXT_WITH_SLACK);

      // Two thread replies: the URL-Store step summary, then the DRS scraping-started message.
      expect(mockPostMessageOptional).to.have.been.calledTwice;
      const [storeCtx, storeChannelId, storeText, storeOptions] = mockPostMessageOptional
        .firstCall.args;
      expect(storeCtx).to.equal(context);
      expect(storeChannelId).to.equal(SLACK_CHANNEL_ID);
      expect(storeOptions).to.deep.equal({ threadTs: SLACK_THREAD_TS });
      expect(storeText).to.include('selected');
      expect(storeText).to.include('to scrape this run');
      expect(storeText).to.include(BASE_URL);

      const callText = mockPostMessageOptional.secondCall.args[2];
      expect(callText).to.include('DRS scraping started');
      expect(callText).to.include(BASE_URL);
      expect(callText).to.include('youtube.com');
      expect(callText).to.include('mock-job');
      expect(callText).to.not.include(':x:');
    });

    it('should include each triggered domain in the Slack thread message', async () => {
      stubBrandPresenceData(['https://reddit.com/r/adobe/comments/xyz123/a-reddit-post']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site, AUDIT_CONTEXT_WITH_SLACK);

      expect(mockPostMessageOptional).to.have.been.calledTwice;
      const callText = mockPostMessageOptional.secondCall.args[2];
      expect(callText).to.include('reddit.com');
      expect(callText).to.include('mock-job');
      expect(callText).to.not.include(':x:');
    });

    it('should include a failed jobs section in the Slack message when some DRS jobs fail', async () => {
      mockSubmitScrapeJob
        .onCall(0).rejects(drsError(400, 'Bad Request'))
        .onCall(1).resolves({ job_id: 'mock-job' });

      stubBrandPresenceData(['https://youtube.com/shorts/v1']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site, AUDIT_CONTEXT_WITH_SLACK);

      expect(mockPostMessageOptional).to.have.been.calledTwice;
      const callText = mockPostMessageOptional.secondCall.args[2];
      expect(callText).to.include(':x:');
      expect(callText).to.include('Failed to submit (1)');
      expect(callText).to.include('400');
      expect(callText).to.include('youtube.com');
      expect(callText).to.include('mock-job');
    });

    it('should send a Slack skip notification when DRS is not configured', async () => {
      mockDrsIsConfigured.returns(false);
      stubBrandPresenceData(['https://youtube.com/shorts/v1']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site, AUDIT_CONTEXT_WITH_SLACK);

      // Store summary posts first, then the skip notification.
      expect(mockPostMessageOptional).to.have.been.calledTwice;
      const [callCtx, callChannelId, callText, callOptions] = mockPostMessageOptional
        .secondCall.args;
      expect(callCtx).to.equal(context);
      expect(callChannelId).to.equal(SLACK_CHANNEL_ID);
      expect(callOptions).to.deep.equal({ threadTs: SLACK_THREAD_TS });
      expect(callText).to.match(/skipped/i);
      expect(callText).to.match(/not configured/i);
      expect(callText).to.include(BASE_URL);
    });

    it('should send a Slack skip notification when the organization has no imsOrgId', async () => {
      site.getOrganization = sandbox.stub().resolves({ getImsOrgId: () => null });
      stubBrandPresenceData(['https://youtube.com/shorts/v1']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site, AUDIT_CONTEXT_WITH_SLACK);

      expect(mockPostMessageOptional).to.have.been.calledTwice;
      const callText = mockPostMessageOptional.secondCall.args[2];
      expect(callText).to.match(/skipped/i);
      expect(callText).to.include('imsOrgId');
      expect(callText).to.include(BASE_URL);
    });
  });

  describe('DRS status poll scheduling', () => {
    it('enqueues a poll message when a Slack thread and a successful job exist', async () => {
      stubBrandPresenceData(['https://youtube.com/shorts/v1']);
      const auditContext = { slackContext: { channelId: 'C123', threadTs: '111.222' } };

      await offsiteBrandPresenceRunner(FINAL_URL, context, site, auditContext);

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      const [queueUrl, msg, groupId, delaySeconds] = context.sqs.sendMessage.firstCall.args;
      expect(queueUrl).to.equal('audits-queue-url');
      expect(msg.type).to.equal('offsite-brand-presence-drs-status');
      expect(msg.siteId).to.equal(SITE_ID);
      expect(msg.auditContext.slackContext).to.deep.equal({ channelId: 'C123', threadTs: '111.222' });
      expect(msg.auditContext.jobs[0]).to.include({ jobId: 'mock-job' });
      expect(msg.auditContext.deadline).to.be.a('number');
      expect(groupId).to.equal(null);
      expect(delaySeconds).to.equal(300);
    });

    it('enqueues a poll message without a Slack thread, at the unattended interval', async () => {
      // Unattended run still schedules the poll (no slackContext carried) at the 900s cadence.
      stubBrandPresenceData(['https://youtube.com/shorts/v1']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site, {});

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      const [, msg, , delaySeconds] = context.sqs.sendMessage.firstCall.args;
      expect(msg.type).to.equal('offsite-brand-presence-drs-status');
      expect(msg.auditContext).to.not.have.property('slackContext');
      expect(delaySeconds).to.equal(900);
    });

    it('does not enqueue a poll message when all DRS jobs failed (no successful job_id)', async () => {
      mockSubmitScrapeJob.rejects(new Error('DRS error'));
      stubBrandPresenceData(['https://youtube.com/shorts/v1']);
      const auditContext = { slackContext: { channelId: 'C123', threadTs: '111.222' } };

      await offsiteBrandPresenceRunner(FINAL_URL, context, site, auditContext);

      expect(context.sqs.sendMessage).to.not.have.been.called;
      // P1-4: the previously-silent empty-jobs early return now logs a structured
      // warn-level skip (deviation from the happy path deserves its own visibility).
      expect(log.warn).to.have.been.calledWith(
        sinon.match(/event=data_acquisition_drs_scrape_job_poll_request_dispatched/)
          .and(sinon.match(/outcome=skip/))
          .and(sinon.match(/reason=no_jobs/))
          .and(sinon.match(/firstSchedule=true/)),
      );
    });

    it('does not fail the run when scheduling the poll throws', async () => {
      context.sqs.sendMessage.rejects(new Error('SQS unavailable'));
      stubBrandPresenceData(['https://youtube.com/shorts/v1']);
      const auditContext = { slackContext: { channelId: 'C123', threadTs: '111.222' } };

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site, auditContext);

      expect(result.auditResult.success).to.be.true;
      // Best-effort follow-up: the schedule-poll failure is structured and counted
      // (outcome=failure, error level) even though the run itself already succeeded —
      // DRS job submission is non-idempotent, so the catch here does not rethrow and
      // must not trigger the whole runner to re-execute and submit duplicate DRS jobs.
      expect(log.error).to.have.been.calledWith(
        sinon.match(/Failed to schedule DRS status poll/)
          .and(sinon.match(/event=data_acquisition_drs_scrape_job_poll_request_dispatched/))
          .and(sinon.match(/outcome=failure/))
          .and(sinon.match(/reason=schedule_failed/))
          .and(sinon.match(/firstSchedule=true/)),
      );
    });

    it('forwards enableBrandProfile to the poll message auditContext when set on Slack', async () => {
      stubBrandPresenceData(['https://youtube.com/shorts/v1']);
      const auditContext = {
        slackContext: { channelId: 'C123', threadTs: '111.222' },
        messageData: { enableBrandProfile: 'true' },
      };

      await offsiteBrandPresenceRunner(FINAL_URL, context, site, auditContext);

      const msg = context.sqs.sendMessage.firstCall.args[1];
      expect(msg.auditContext.enableBrandProfile).to.equal(true);
    });

    it('omits enableBrandProfile from the poll message auditContext when absent on Slack', async () => {
      stubBrandPresenceData(['https://youtube.com/shorts/v1']);
      const auditContext = { slackContext: { channelId: 'C123', threadTs: '111.222' } };

      await offsiteBrandPresenceRunner(FINAL_URL, context, site, auditContext);

      const msg = context.sqs.sendMessage.firstCall.args[1];
      expect(msg.auditContext.enableBrandProfile).to.be.undefined;
    });

    it('forwards urlLimit to the poll message auditContext when set on Slack', async () => {
      stubBrandPresenceData(['https://youtube.com/shorts/v1']);
      const auditContext = {
        slackContext: { channelId: 'C123', threadTs: '111.222' },
        messageData: { urlLimit: '20' },
      };

      await offsiteBrandPresenceRunner(FINAL_URL, context, site, auditContext);

      const msg = context.sqs.sendMessage.firstCall.args[1];
      expect(msg.auditContext.urlLimit).to.equal(20);
    });

    it('omits urlLimit from the poll message auditContext when absent on Slack', async () => {
      stubBrandPresenceData(['https://youtube.com/shorts/v1']);
      const auditContext = { slackContext: { channelId: 'C123', threadTs: '111.222' } };

      await offsiteBrandPresenceRunner(FINAL_URL, context, site, auditContext);

      const msg = context.sqs.sendMessage.firstCall.args[1];
      expect(msg.auditContext.urlLimit).to.be.undefined;
    });

    it('forwards the Semrush override to the poll message auditContext when set on Slack', async () => {
      // enableSemrush:true hard-stops on failure, so give Semrush a usable result
      // to let the run proceed to DRS poll scheduling.
      mockLoadCitedUrlsFromSemrush.resolves(new Map([
        ['https://youtu.be/v1', { count: 5, domain: 'youtube.com' }],
      ]));
      const auditContext = {
        slackContext: { channelId: 'C123', threadTs: '111.222' },
        messageData: { enableSemrush: true },
      };

      await offsiteBrandPresenceRunner(FINAL_URL, context, site, auditContext);

      const msg = context.sqs.sendMessage.firstCall.args[1];
      expect(msg.auditContext.enableSemrush).to.equal(true);
    });

    it('omits enableSemrush from the poll message auditContext when absent on Slack', async () => {
      stubBrandPresenceData(['https://youtube.com/shorts/v1']);
      const auditContext = { slackContext: { channelId: 'C123', threadTs: '111.222' } };

      await offsiteBrandPresenceRunner(FINAL_URL, context, site, auditContext);

      const msg = context.sqs.sendMessage.firstCall.args[1];
      expect(msg.auditContext.enableSemrush).to.be.undefined;
    });
  });

  describe('Domain-scoped runs (granular single-audit triggers)', () => {
    const MULTI = 'https://youtube.com/shorts/v1;https://reddit.com/r/adobe/;https://thirdparty.com/page';

    it('scrapes only the scoped offsite domain', async () => {
      stubBrandPresenceData([MULTI]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site, {
        messageData: { domainScope: 'reddit.com' },
      });

      const datasets = mockSubmitScrapeJob.getCalls().map((c) => c.args[0].datasetId);
      expect(datasets).to.have.members([
        SCRAPE_DATASET_IDS.REDDIT_POSTS,
        SCRAPE_DATASET_IDS.REDDIT_COMMENTS,
      ]);
      expect(result.auditResult.drsJobs).to.have.lengthOf(2);
    });

    it('scrapes only top-cited when scoped to top-cited', async () => {
      stubBrandPresenceData([MULTI]);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site, {
        messageData: { domainScope: 'top-cited' },
      });

      const datasets = mockSubmitScrapeJob.getCalls().map((c) => c.args[0].datasetId);
      expect(datasets).to.deep.equal([SCRAPE_DATASET_IDS.TOP_CITED]);
    });

    it('aborts with an explicit error for an unrecognized domainScope', async () => {
      stubBrandPresenceData([MULTI]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site, {
        messageData: { domainScope: 'bogus.com' },
      });

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.match(/Unknown domainScope: bogus\.com/);
      expect(mockSubmitScrapeJob).to.not.have.been.called;
    });
  });

  describe('Full Integration Flow', () => {
    it('should complete full audit with URLs from multiple domains', async () => {
      const sources = [
        'https://www.youtube.com/watch?v=abc;https://reddit.com/r/adobe/post1',
        'https://youtube.com/watch?v=def;https://thirdparty.com/unrelated;https://en.wikipedia.org/wiki/Adobe',
      ];
      stubBrandPresenceData(sources);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(2);
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(1);
      // wikipedia is not scraped/counted and stays out of top-cited (cited-analysis).
      expect(result.auditResult.urlCounts).to.not.have.property('wikipedia.org');
      // youtube (2) + reddit (2) + top-cited (1) = 5 jobs, no wikipedia.
      expect(result.auditResult.drsJobs).to.have.lengthOf(5);
      expect(result.fullAuditRef).to.equal(FINAL_URL);

      const createCalls = dataAccess.AuditUrl.create.getCalls();
      const topCitedCalls = createCalls.filter((c) => c.args[0].audits[0] === 'cited-analysis');
      expect(topCitedCalls).to.have.lengthOf(1);
      expect(topCitedCalls[0].args[0].url).to.equal('https://thirdparty.com/unrelated');

      const topCitedJob = result.auditResult.drsJobs.find((j) => j.datasetId === SCRAPE_DATASET_IDS.TOP_CITED);
      expect(topCitedJob).to.deep.include({
        domain: 'top-cited',
        datasetId: SCRAPE_DATASET_IDS.TOP_CITED,
        status: 'success',
      });
    });

    it('should include both previous weeks in the audit result', async () => {
      mockGetPreviousWeeks.returns([
        { week: 5, year: DEFAULT_YEAR },
        { week: 4, year: DEFAULT_YEAR },
      ]);
      mockLoadBrandPresenceData.resolves(null);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.weeks).to.deep.equal([
        { week: 5, year: DEFAULT_YEAR },
        { week: 4, year: DEFAULT_YEAR },
      ]);
    });

    it('should handle year boundary when previous weeks span two years', async () => {
      mockGetPreviousWeeks.returns([
        { week: 1, year: 2026 },
        { week: 52, year: 2025 },
      ]);
      stubBrandPresenceData(['https://youtube.com/shorts/x']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.weeks).to.deep.equal([
        { week: 1, year: 2026 },
        { week: 52, year: 2025 },
      ]);
    });
  });
});
