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
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import { describe } from 'mocha';
import { AWSAthenaClient } from '@adobe/spacecat-shared-athena-client';

import {
  importWeekStep0,
  importWeekStep1,
  importWeekStep2,
  importWeekStep3,
  runPtrSelectorAnalysisStep,
} from '../../../src/ptr-selector/handler.js';

use(sinonChai);
use(chaiAsPromised);

const auditUrl = 'www.spacecat.com';

function createMockConfig(sandbox, overrides = {}) {
  return {
    getImports: () => [],
    enableImport: sandbox.stub(),
    disableImport: sandbox.stub(),
    getSlackConfig: sandbox.stub(),
    getHandlers: sandbox.stub(),
    getContentAiConfig: sandbox.stub(),
    getFetchConfig: sandbox.stub(),
    getBrandConfig: sandbox.stub(),
    getCdnLogsConfig: sandbox.stub(),
    getLlmoConfig: sandbox.stub(),
    getTokowakaConfig: sandbox.stub(),
    getEdgeOptimizeConfig: sandbox.stub(),
    getBrandProfile: sandbox.stub().returns(null),
    ...overrides,
  };
}

function getSite(sandbox, overrides = {}) {
  const mockConfig = createMockConfig(sandbox);

  return {
    getId: () => 'test-site-id',
    getSiteId: () => 'test-site-id',
    getDeliveryType: () => 'aem-edge',
    getBaseURL: () => 'https://example.com',
    getConfig: () => mockConfig,
    setConfig: sandbox.stub(),
    save: sandbox.stub().resolves(),
    ...overrides,
  };
}

describe('PTR Selector Audit', () => {
  describe('importWeekStep0 (first import step)', () => {
    let sandbox;
    let logStub;
    let site;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      logStub = {
        info: sandbox.stub(),
        debug: sandbox.stub(),
        error: sandbox.stub(),
        warn: sandbox.stub(),
      };
      site = getSite(sandbox);
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should return correct structure for import worker', async () => {
      const stepContext = {
        site,
        log: logStub,
        finalUrl: auditUrl,
      };

      const result = await importWeekStep0(stepContext);

      expect(result).to.have.property('auditResult');
      expect(result.auditResult).to.have.property('status', 'pending');
      expect(result).to.have.property('fullAuditRef', auditUrl);
      expect(result).to.have.property('type', 'traffic-analysis');
      expect(result).to.have.property('siteId', 'test-site-id');
      expect(result).to.have.property('allowCache', true);
      expect(result).to.have.property('auditContext');
      expect(result.auditContext).to.have.property('week');
      expect(result.auditContext).to.have.property('year');
    });

    it('should enable import when not already enabled', async () => {
      const stepContext = {
        site,
        log: logStub,
        finalUrl: auditUrl,
      };

      await importWeekStep0(stepContext);

      expect(site.getConfig().enableImport).to.have.been.calledWith('traffic-analysis');
    });

    it('should not enable import when already enabled', async () => {
      const mockConfigWithImport = createMockConfig(sandbox, {
        getImports: () => [{ type: 'traffic-analysis', enabled: true }],
      });
      const siteWithImport = getSite(sandbox, {
        getConfig: () => mockConfigWithImport,
      });

      const stepContext = {
        site: siteWithImport,
        log: logStub,
        finalUrl: auditUrl,
      };

      await importWeekStep0(stepContext);

      expect(mockConfigWithImport.enableImport).to.not.have.been.called;
    });

    it('should throw error when site config is null', async () => {
      const siteWithNullConfig = getSite(sandbox, {
        getConfig: () => null,
      });

      const stepContext = {
        site: siteWithNullConfig,
        log: logStub,
        finalUrl: auditUrl,
      };

      await expect(importWeekStep0(stepContext))
        .to.be.rejectedWith(/site config is null/);
    });
  });

  describe('importWeekStep1/2/3 (subsequent import steps)', () => {
    let sandbox;
    let logStub;
    let site;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      logStub = {
        info: sandbox.stub(),
        debug: sandbox.stub(),
        error: sandbox.stub(),
        warn: sandbox.stub(),
      };
      site = getSite(sandbox);
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should not call enableImport (only step 0 does that)', async () => {
      const stepContext = {
        site,
        log: logStub,
        finalUrl: auditUrl,
      };

      await importWeekStep1(stepContext);
      await importWeekStep2({ ...stepContext });
      await importWeekStep3({ ...stepContext });

      expect(site.getConfig().enableImport).to.not.have.been.called;
    });

    it('should return correct structure with week/year', async () => {
      const stepContext = {
        site,
        log: logStub,
        finalUrl: auditUrl,
      };

      const result = await importWeekStep3(stepContext);

      expect(result).to.have.property('type', 'traffic-analysis');
      expect(result).to.have.property('siteId', 'test-site-id');
      expect(result).to.have.property('allowCache', true);
      expect(result.auditContext).to.have.property('week');
      expect(result.auditContext).to.have.property('year');
    });
  });

  describe('runPtrSelectorAnalysisStep', () => {
    let sandbox;
    let logStub;
    let site;
    let mockConfiguration;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      logStub = {
        info: sandbox.stub(),
        debug: sandbox.stub(),
        error: sandbox.stub(),
        warn: sandbox.stub(),
      };
      site = getSite(sandbox);

      mockConfiguration = {
        isHandlerEnabledForSite: sandbox.stub().returns(false),
        enableHandlerForSite: sandbox.stub(),
        disableHandlerForSite: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };
    });

    afterEach(() => {
      sandbox.restore();
    });

    function createContext(queryResult, overrides = {}) {
      const queryStub = sandbox.stub();
      queryStub.resolves(queryResult);

      const mockAthenaClientInstance = { query: queryStub };
      sandbox.stub(AWSAthenaClient, 'fromContext').returns(mockAthenaClientInstance);

      return {
        runtime: { name: 'aws-lambda', region: 'us-east-1' },
        func: { package: 'spacecat-services', version: 'ci', name: 'test' },
        env: {
          S3_IMPORTER_BUCKET_NAME: 'test-bucket',
          RUM_METRICS_DATABASE: 'rum_metrics',
          RUM_METRICS_COMPACT_TABLE: 'compact_metrics',
        },
        site,
        log: logStub,
        finalUrl: auditUrl,
        dataAccess: {
          Configuration: { findLatest: sandbox.stub().resolves(mockConfiguration) },
        },
        queryStub,
        ...overrides,
      };
    }

    it('should set reportDecision to "not enough data" and disable both audits when totalPageViewSum < 30K', async () => {
      mockConfiguration.isHandlerEnabledForSite.withArgs('paid-traffic-analysis-weekly', site).returns(true);
      mockConfiguration.isHandlerEnabledForSite.withArgs('paid-traffic-analysis-monthly', site).returns(true);
      const ctx = createContext([{ total_pageview_sum: '20000' }]);

      const result = await runPtrSelectorAnalysisStep(ctx);

      expect(result.auditResult.totalPageViewSum).to.equal(20000);
      expect(result.auditResult.reportDecision).to.equal('not enough data');
      expect(result.fullAuditRef).to.equal(auditUrl);
      expect(mockConfiguration.enableHandlerForSite).to.not.have.been.called;
      expect(mockConfiguration.disableHandlerForSite).to.have.been.calledWith('paid-traffic-analysis-weekly', site);
      expect(mockConfiguration.disableHandlerForSite).to.have.been.calledWith('paid-traffic-analysis-monthly', site);
      expect(mockConfiguration.save).to.have.been.called;
      expect(logStub.info).to.have.been.calledWithMatch(/below 30K threshold/);
    });

    it('should set reportDecision to "monthly report" and disable weekly when totalPageViewSum >= 30K and < 200K', async () => {
      mockConfiguration.isHandlerEnabledForSite.withArgs('paid-traffic-analysis-weekly', site).returns(true);
      const ctx = createContext([{ total_pageview_sum: '100000' }]);

      const result = await runPtrSelectorAnalysisStep(ctx);

      expect(result.auditResult.totalPageViewSum).to.equal(100000);
      expect(result.auditResult.reportDecision).to.equal('monthly report');
      expect(result.fullAuditRef).to.equal(auditUrl);
      expect(mockConfiguration.enableHandlerForSite).to.have.been.calledWith('paid-traffic-analysis-monthly', site);
      expect(mockConfiguration.disableHandlerForSite).to.have.been.calledWith('paid-traffic-analysis-weekly', site);
      expect(mockConfiguration.save).to.have.been.called;
      expect(logStub.info).to.have.been.calledWithMatch(/Enabled paid-traffic-analysis-monthly/);
    });

    it('should set reportDecision to "weekly report" and enable both weekly and monthly when totalPageViewSum >= 200K', async () => {
      const ctx = createContext([{ total_pageview_sum: '500000' }]);

      const result = await runPtrSelectorAnalysisStep(ctx);

      expect(result.auditResult.totalPageViewSum).to.equal(500000);
      expect(result.auditResult.reportDecision).to.equal('weekly report');
      expect(result.fullAuditRef).to.equal(auditUrl);
      expect(mockConfiguration.enableHandlerForSite).to.have.been.calledWith('paid-traffic-analysis-weekly', site);
      expect(mockConfiguration.enableHandlerForSite).to.have.been.calledWith('paid-traffic-analysis-monthly', site);
      expect(mockConfiguration.disableHandlerForSite).to.not.have.been.called;
      expect(mockConfiguration.save).to.have.been.called;
      expect(logStub.info).to.have.been.calledWithMatch(/Enabled paid-traffic-analysis-weekly and paid-traffic-analysis-monthly/);
    });

    it('should handle boundary value of exactly 30K as monthly report', async () => {
      const ctx = createContext([{ total_pageview_sum: '30000' }]);

      const result = await runPtrSelectorAnalysisStep(ctx);

      expect(result.auditResult.reportDecision).to.equal('monthly report');
    });

    it('should handle boundary value of exactly 200K as weekly report', async () => {
      const ctx = createContext([{ total_pageview_sum: '200000' }]);

      const result = await runPtrSelectorAnalysisStep(ctx);

      expect(result.auditResult.reportDecision).to.equal('weekly report');
    });

    it('should handle null/empty query result as 0 pageviews', async () => {
      const ctx = createContext([]);

      const result = await runPtrSelectorAnalysisStep(ctx);

      expect(result.auditResult.totalPageViewSum).to.equal(0);
      expect(result.auditResult.reportDecision).to.equal('not enough data');
    });

    it('should not re-enable audits when already enabled for weekly decision', async () => {
      mockConfiguration.isHandlerEnabledForSite.withArgs('paid-traffic-analysis-weekly', site).returns(true);
      mockConfiguration.isHandlerEnabledForSite.withArgs('paid-traffic-analysis-monthly', site).returns(true);
      const ctx = createContext([{ total_pageview_sum: '500000' }]);

      await runPtrSelectorAnalysisStep(ctx);

      expect(mockConfiguration.enableHandlerForSite).to.not.have.been.called;
      expect(mockConfiguration.disableHandlerForSite).to.not.have.been.called;
      expect(logStub.info).to.have.been.calledWithMatch(/already enabled/);
    });

    it('should throw error when S3_IMPORTER_BUCKET_NAME is missing', async () => {
      const ctx = createContext([{ total_pageview_sum: '100000' }]);
      ctx.env = { RUM_METRICS_DATABASE: 'rum_metrics', RUM_METRICS_COMPACT_TABLE: 'compact_metrics' };

      await expect(runPtrSelectorAnalysisStep(ctx))
        .to.be.rejectedWith('S3_IMPORTER_BUCKET_NAME must be provided for ptr-selector audit');
    });

    it('should throw error when Athena query fails', async () => {
      const ctx = createContext([]);
      ctx.queryStub.rejects(new Error('Athena connection failed'));

      await expect(runPtrSelectorAnalysisStep(ctx))
        .to.be.rejectedWith('Athena connection failed');

      expect(logStub.error).to.have.been.calledWithMatch(/Athena query failed/);
    });

    it('should return auditResult and fullAuditRef', async () => {
      const ctx = createContext([{ total_pageview_sum: '100000' }]);

      const result = await runPtrSelectorAnalysisStep(ctx);

      expect(result).to.have.property('auditResult');
      expect(result).to.have.property('fullAuditRef', auditUrl);
      expect(result.auditResult.totalPageViewSum).to.equal(100000);
      expect(result.auditResult.reportDecision).to.equal('monthly report');
    });

    it('should use default values for missing database and table env vars', async () => {
      const ctx = createContext([{ total_pageview_sum: '20000' }]);
      ctx.env = {
        S3_IMPORTER_BUCKET_NAME: 'test-bucket',
      };

      const result = await runPtrSelectorAnalysisStep(ctx);

      expect(result.auditResult.totalPageViewSum).to.equal(20000);
      expect(result.auditResult.reportDecision).to.equal('not enough data');
    });
  });
});
