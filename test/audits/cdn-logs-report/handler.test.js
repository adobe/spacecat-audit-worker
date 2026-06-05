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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);

const EXISTING_RULES = {
  pagePatterns: [{ name: 'Documentation', regex: '/docs', sort_order: 0 }],
  topicPatterns: [{ name: 'Products', regex: '/products', sort_order: 0 }],
};

describe('CDN Logs Report Handler', function test() {
  let sandbox;
  let context;
  let site;
  let handler;
  let athenaClient;
  // Shared mock holder. The esmock'd handler routes module imports through
  // these properties at call time, so each test can reassign without reloading
  // the (expensive) handler module graph.
  const mocks = {};

  this.timeout(10000);

  const createSiteConfig = (overrides = {}) => ({
    getLlmoDataFolder: () => 'test-folder',
    getLlmoCdnBucketConfig: () => ({ bucketName: 'cdn-logs-adobe-dev' }),
    getLlmoCdnlogsFilter: () => [{ value: ['www.example.com'], key: 'host' }],
    getLlmoCountryCodeIgnoreList: () => undefined,
    ...overrides,
  });

  const agenticConfig = {
    name: 'agentic',
    aggregatedLocation: 's3://bucket/aggregated/test-site/agentic/',
    tableName: 'aggregated_logs_example_com_consolidated',
  };
  const referralConfig = {
    name: 'referral',
    aggregatedLocation: 's3://bucket/aggregated/test-site/referral/',
    tableName: 'aggregated_referral_logs_example_com_consolidated',
  };

  const runAudit = (auditContext = {}) => handler.runner('https://example.com', context, site, auditContext);

  before(async () => {
    handler = await esmock('../../../src/cdn-logs-report/handler.js', {
      '../../../src/cdn-logs-report/utils/report-utils.js': {
        loadSql: (...a) => mocks.loadSql(...a),
        generateReportingPeriods: (...a) => mocks.generateReportingPeriods(...a),
        getConfigCategories: (...a) => mocks.getConfigCategories(...a),
      },
      '../../../src/common/agentic-url-classification-rules.js': {
        fetchAgenticUrlClassificationRules: (...a) => mocks.fetchAgenticUrlClassificationRules(...a),
      },
      '../../../src/utils/cdn-utils.js': {
        pathHasData: (...a) => mocks.pathHasData(...a),
        getS3Config: (...a) => mocks.getS3Config(...a),
        getCdnAwsRuntime: (...a) => mocks.getCdnAwsRuntime(...a),
      },
      '../../../src/cdn-logs-report/constants/report-configs.js': {
        getConfigs: (...a) => mocks.getConfigs(...a),
      },
      '../../../src/cdn-logs-report/patterns/patterns-uploader.js': {
        generatePatternsWorkbook: (...a) => mocks.generatePatternsWorkbook(...a),
      },
      '../../../src/cdn-logs-report/utils/agentic-db-export.js': {
        runAgenticDbExports: (...a) => mocks.runAgenticDbExports(...a),
      },
      '../../../src/cdn-logs-report/referral-daily-export.js': {
        runDailyReferralExport: (...a) => mocks.runDailyReferralExport(...a),
      },
    });
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    athenaClient = { execute: sandbox.stub().resolves() };

    // Defaults: agentic + referral data present, DB already has rules (so no
    // pattern regeneration), and both daily DB exports succeed with a batchId.
    mocks.loadSql = sandbox.stub().resolves('SELECT 1');
    mocks.generateReportingPeriods = sandbox.stub().returns({ weeks: [], periodIdentifier: 'w01-2026' });
    mocks.getConfigCategories = sandbox.stub().resolves(['Category A']);
    mocks.fetchAgenticUrlClassificationRules = sandbox.stub().resolves(EXISTING_RULES);
    mocks.generatePatternsWorkbook = sandbox.stub().resolves(true);
    mocks.pathHasData = sandbox.stub().resolves(true);
    mocks.getS3Config = sandbox.stub().returns({
      bucket: 'test-bucket',
      siteKey: 'example_com',
      siteName: 'example',
      databaseName: 'cdn_logs_example_com',
      getAthenaTempLocation: () => 's3://temp',
    });
    mocks.getCdnAwsRuntime = sandbox.stub().returns({
      s3Client: {},
      createAthenaClient: sandbox.stub().returns(athenaClient),
    });
    mocks.getConfigs = sandbox.stub().returns([agenticConfig, referralConfig]);
    mocks.runAgenticDbExports = sandbox.stub().resolves({
      dailyAgenticExport: { batchId: 'agentic-batch' },
      dailyAgenticExports: [],
    });
    mocks.runDailyReferralExport = sandbox.stub().resolves({
      enabled: true,
      success: true,
      batchId: 'referral-batch',
    });

    site = {
      getSiteId: () => 'test-site',
      getId: () => 'test-site',
      getBaseURL: () => 'https://example.com',
      getConfig: () => createSiteConfig(),
      getOrganizationId: sandbox.stub().returns('test-org-id'),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        env: { AWS_ENV: 'test', AWS_REGION: 'us-east-1' },
        log: {
          info: sandbox.spy(),
          debug: sandbox.spy(),
          warn: sandbox.spy(),
          error: sandbox.spy(),
        },
      })
      .build();
  });

  after(async () => {
    if (handler) {
      await esmock.purge(handler);
    }
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('happy path', () => {
    it('runs patterns + both daily exports and assembles the audit result', async () => {
      const result = await runAudit({});

      // Weekly patterns step ran: DB ensured, existing rules fetched, no regeneration.
      expect(mocks.loadSql).to.have.been.calledOnce;
      expect(athenaClient.execute).to.have.been.calledOnce;
      expect(mocks.fetchAgenticUrlClassificationRules).to.have.been.calledOnce;
      expect(mocks.generatePatternsWorkbook).to.not.have.been.called;

      // Both daily exports ran.
      expect(mocks.runAgenticDbExports).to.have.been.calledOnce;
      expect(mocks.runAgenticDbExports.firstCall.args[0].agenticReportHasData).to.equal(true);
      expect(mocks.runDailyReferralExport).to.have.been.calledOnce;

      expect(context.log.debug).to.have.been.calledWith('Starting CDN logs report audit for https://example.com');
      expect(result.fullAuditRef).to.equal('test-folder');
      expect(result.dailyAgenticExports).to.deep.equal([]);
      expect(result.auditResult).to.deep.equal([
        { name: 'agentic-db-export', batchId: 'agentic-batch' },
        { name: 'referral-db-export', batchId: 'referral-batch' },
      ]);
    });

    it('omits db-export entries from the audit result when no batchId is returned', async () => {
      mocks.runAgenticDbExports = sandbox.stub().resolves({ dailyAgenticExport: { enabled: true } });
      mocks.runDailyReferralExport = sandbox.stub().resolves({ enabled: true, success: true });

      const result = await runAudit({});

      expect(result.auditResult).to.deep.equal([]);
    });

    it('resolves fullAuditRef to "null" when no data folder is configured', async () => {
      site.getConfig = () => createSiteConfig({ getLlmoDataFolder: () => null });

      const result = await runAudit({});

      expect(result.fullAuditRef).to.equal('null');
    });
  });

  describe('patterns generation (weekly step)', () => {
    it('regenerates DB rules when none exist yet', async () => {
      mocks.fetchAgenticUrlClassificationRules = sandbox.stub().resolves({ pagePatterns: [], topicPatterns: [] });
      const clock = sinon.useFakeTimers({ now: new Date('2025-01-07'), toFake: ['Date'] }); // Tuesday

      try {
        await runAudit({});
      } finally {
        clock.restore();
      }

      expect(mocks.generatePatternsWorkbook).to.have.been.calledOnce;
      expect(mocks.getConfigCategories).to.have.been.calledOnce;
      // Non-Monday with no explicit weekOffset → current week (offset 0).
      expect(mocks.generateReportingPeriods).to.have.been.calledWithMatch(sinon.match.any, 0);
    });

    it('regenerates DB rules when only one rule table is populated', async () => {
      mocks.fetchAgenticUrlClassificationRules = sandbox.stub()
        .resolves({ pagePatterns: EXISTING_RULES.pagePatterns, topicPatterns: [] });

      await runAudit({ weekOffset: 0 });

      expect(mocks.generatePatternsWorkbook).to.have.been.calledOnce;
    });

    it('regenerates DB rules when categories were updated, even if rules exist', async () => {
      const clock = sinon.useFakeTimers({ now: new Date('2025-01-06'), toFake: ['Date'] }); // Monday

      try {
        await runAudit({ categoriesUpdated: true });
      } finally {
        clock.restore();
      }

      expect(mocks.generatePatternsWorkbook).to.have.been.calledOnce;
      // Monday with no explicit weekOffset → previous full week (offset -1).
      expect(mocks.generateReportingPeriods).to.have.been.calledWithMatch(sinon.match.any, -1);
    });

    it('uses the explicit weekOffset for pattern sampling when provided', async () => {
      mocks.fetchAgenticUrlClassificationRules = sandbox.stub().resolves({ pagePatterns: [], topicPatterns: [] });

      await runAudit({ weekOffset: -3 });

      expect(mocks.generateReportingPeriods).to.have.been.calledWithMatch(sinon.match.any, -3);
    });

    it('skips regeneration when the DB rule fetch fails', async () => {
      mocks.fetchAgenticUrlClassificationRules = sandbox.stub().resolves({ error: true, source: 'postgres' });

      await runAudit({ weekOffset: 0 });

      expect(mocks.generatePatternsWorkbook).to.not.have.been.called;
      expect(context.log.info).to.have.been.calledWith(
        'Skipping fresh patterns generation for test-site; DB rule fetch failed',
      );
    });

    it('skips the weekly step entirely when the agentic config is missing', async () => {
      mocks.getConfigs = sandbox.stub().returns([referralConfig]);

      await runAudit({});

      expect(mocks.pathHasData).to.not.have.been.called;
      expect(athenaClient.execute).to.not.have.been.called;
      expect(mocks.generatePatternsWorkbook).to.not.have.been.called;
      expect(context.log.info).to.have.been.calledWith('No agentic report data found - skipping patterns generation');
      expect(mocks.runAgenticDbExports.firstCall.args[0].agenticReportHasData).to.equal(false);
    });

    it('skips the weekly step when the agentic aggregate has no data', async () => {
      mocks.pathHasData = sandbox.stub().resolves(false);

      await runAudit({});

      expect(athenaClient.execute).to.not.have.been.called;
      expect(mocks.generatePatternsWorkbook).to.not.have.been.called;
      expect(context.log.info).to.have.been.calledWith('No agentic report data found - skipping patterns generation');
    });

    it('skips the weekly step on date-based (daily) runs', async () => {
      await runAudit({ date: '2026-04-01T10:00:00Z' });

      expect(mocks.fetchAgenticUrlClassificationRules).to.not.have.been.called;
      expect(mocks.generatePatternsWorkbook).to.not.have.been.called;
      expect(mocks.pathHasData).to.not.have.been.called;
      expect(mocks.runAgenticDbExports.firstCall.args[0].agenticReportHasData).to.equal(false);
    });
  });

  describe('daily referral export', () => {
    it('passes referenceDate through when auditContext.date is provided', async () => {
      await runAudit({ date: '2026-04-01T10:00:00Z' });

      expect(mocks.runDailyReferralExport.firstCall.args[0].referenceDate.toISOString())
        .to.equal('2026-04-01T10:00:00.000Z');
    });

    it('skips the referral export on weekly-only runs', async () => {
      const result = await runAudit({ weekOffset: -2 });

      expect(mocks.runDailyReferralExport).to.not.have.been.called;
      expect(result.dailyReferralExport).to.equal(undefined);
    });

    it('runs the referral export on categories-update runs (no longer gated)', async () => {
      const result = await runAudit({ date: '2026-04-01T00:00:00Z', categoriesUpdated: true });

      expect(mocks.runDailyReferralExport).to.have.been.calledOnce;
      expect(result.dailyReferralExport).to.deep.equal({
        enabled: true,
        success: true,
        batchId: 'referral-batch',
      });
    });

    it('skips the referral export when the referral config is missing', async () => {
      mocks.getConfigs = sandbox.stub().returns([agenticConfig]);

      const result = await runAudit({});

      expect(mocks.runDailyReferralExport).to.not.have.been.called;
      expect(result.dailyReferralExport).to.equal(undefined);
      expect(context.log.debug).to.have.been.calledWith(
        'Skipping daily referral export for test-site: referral report config not found',
      );
    });

    it('captures referral export failures without failing the handler', async () => {
      mocks.runDailyReferralExport = sandbox.stub().rejects(new Error('referral boom'));

      const result = await runAudit({});

      expect(context.log.error).to.have.been.calledWith(
        'Failed daily referral export for site test-site: referral boom',
        sinon.match.instanceOf(Error),
      );
      expect(result.dailyReferralExport).to.deep.equal({
        enabled: true,
        success: false,
        siteId: 'test-site',
        error: 'referral boom',
      });
    });
  });
});
