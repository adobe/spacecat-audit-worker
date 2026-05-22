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
import {
  logSubmitMetrics,
  logStep3Metrics,
  logSuggestionsSyncMetrics,
  logStatusUpload,
} from '../../../src/prerender/log-metrics.js';

use(sinonChai);

describe('log-metrics', () => {
  let sandbox;
  let log;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    log = { info: sandbox.stub() };
  });

  afterEach(() => {
    sandbox.restore();
  });

  // ---------------------------------------------------------------------------
  // logSubmitMetrics
  // ---------------------------------------------------------------------------
  describe('logSubmitMetrics', () => {
    const baseRawUrls = {
      csvUrls: [],
      topPagesUrls: ['https://example.com/a', 'https://example.com/b'],
      agenticUrls: ['https://example.com/c'],
      includedURLs: ['https://example.com/d'],
    };

    const baseFilterResult = {
      urls: ['https://example.com/a', 'https://example.com/b'],
      filteredCount: 1,
      metrics: {
        currentAgentic: 1,
        currentOrganic: 2,
        currentIncludedUrls: 1,
        isFirstRunOfCycle: true,
        agenticNewThisCycle: 1,
        edgeDeployedCount: 3,
      },
    };

    function makeContext() {
      return {
        site: { getBaseURL: () => 'https://example.com', getId: () => 'site-1' },
        log,
      };
    }

    it('includes currentAgentic, currentOrganic, and other metrics in non-CSV mode', () => {
      logSubmitMetrics(
        makeContext(),
        { isCsv: false },
        baseRawUrls,
        baseFilterResult,
      );

      expect(log.info).to.have.been.calledOnce;
      const msg = log.info.firstCall.args[0];
      expect(msg).to.match(/submittedUrls=2/);
      expect(msg).to.match(/csvUrls=0/);
      expect(msg).to.match(/agenticUrls=1/);
      expect(msg).to.match(/topPagesUrls=2/);
      expect(msg).to.match(/includedURLs=1/);
      expect(msg).to.match(/filteredOutUrls=1/);
      expect(msg).to.match(/currentAgentic=1/);
      expect(msg).to.match(/currentOrganic=2/);
      expect(msg).to.match(/currentIncludedUrls=1/);
      expect(msg).to.match(/isFirstRunOfCycle=true/);
      expect(msg).to.match(/agenticNewThisCycle=1/);
      expect(msg).to.match(/edgeDeployedUrls=3/);
      expect(msg).to.match(/baseUrl=https:\/\/example\.com/);
      expect(msg).to.match(/siteId=site-1/);
    });

    it('omits currentAgentic and related metrics in CSV mode', () => {
      logSubmitMetrics(
        makeContext(),
        { isCsv: true },
        { ...baseRawUrls, csvUrls: ['https://example.com/x'] },
        { ...baseFilterResult, urls: ['https://example.com/x'] },
      );

      expect(log.info).to.have.been.calledOnce;
      const msg = log.info.firstCall.args[0];
      expect(msg).to.match(/submittedUrls=1/);
      expect(msg).to.match(/csvUrls=1/);
      expect(msg).to.not.match(/currentAgentic/);
      expect(msg).to.not.match(/currentOrganic/);
      expect(msg).to.not.match(/isFirstRunOfCycle/);
      expect(msg).to.not.match(/edgeDeployedUrls/);
      expect(msg).to.match(/baseUrl=https:\/\/example\.com/);
      expect(msg).to.match(/siteId=site-1/);
    });
  });

  // ---------------------------------------------------------------------------
  // logStep3Metrics
  // ---------------------------------------------------------------------------
  describe('logStep3Metrics', () => {
    function makeContext() {
      return {
        site: { getBaseURL: () => 'https://example.com', getId: () => 'site-42' },
        log,
      };
    }

    function makeParams(overrides = {}) {
      return {
        scrapeStats: { scrapeForbiddenCount: 5, urlsSubmittedForScraping: 100, urlsScrapedSuccessfully: 90 },
        comparisonResults: new Array(100),
        auditResult: { scrapingErrorRate: 5 },
        urlsNeedingPrerender: new Array(10),
        successfulComparisons: new Array(90),
        isPaid: true,
        ...overrides,
      };
    }

    it('emits scrape analysis, prerender findings, and scraping metrics log lines', () => {
      logStep3Metrics(makeContext(), makeParams());

      expect(log.info).to.have.been.calledThrice;
      const [analysis, findings, metrics] = log.info.args.map((a) => a[0]);

      expect(analysis).to.match(/scrapeForbiddenCount=5/);
      expect(analysis).to.match(/totalUrlsChecked=100/);
      expect(analysis).to.match(/isPaidLLMOCustomer=true/);
      expect(analysis).to.match(/siteId=site-42/);

      expect(findings).to.match(/Found 10\/90/);
      expect(findings).to.match(/total 100 URLs scraped/);
      expect(findings).to.match(/isPaidLLMOCustomer=true/);

      expect(metrics).to.match(/urlsSubmittedForScraping=100/);
      expect(metrics).to.match(/urlsScrapedSuccessfully=90/);
      expect(metrics).to.match(/scrapingErrorRate=5%/);
    });

    it('reflects isPaid=false in all three log lines', () => {
      logStep3Metrics(makeContext(), makeParams({ isPaid: false }));

      const [analysis, findings, metrics] = log.info.args.map((a) => a[0]);
      expect(analysis).to.match(/isPaidLLMOCustomer=false/);
      expect(findings).to.match(/isPaidLLMOCustomer=false/);
      expect(metrics).to.match(/baseUrl=https:\/\/example\.com/);
    });
  });

  // ---------------------------------------------------------------------------
  // logSuggestionsSyncMetrics
  // ---------------------------------------------------------------------------
  describe('logSuggestionsSyncMetrics', () => {
    it('logs sync metrics with all fields', () => {
      logSuggestionsSyncMetrics(log, {
        siteId: 'site-99',
        baseUrl: 'https://example.com',
        isPaid: true,
        suggestionsCount: 15,
        totalCount: 20,
      });

      expect(log.info).to.have.been.calledOnce;
      const msg = log.info.firstCall.args[0];
      expect(msg).to.match(/prerender_suggestions_sync_metrics/);
      expect(msg).to.match(/siteId=site-99/);
      expect(msg).to.match(/baseUrl=https:\/\/example\.com/);
      expect(msg).to.match(/isPaidLLMOCustomer=true/);
      expect(msg).to.match(/suggestions=15/);
      expect(msg).to.match(/totalSuggestions=20/);
    });

    it('logs isPaidLLMOCustomer=false when not paid', () => {
      logSuggestionsSyncMetrics(log, {
        siteId: 'site-1',
        baseUrl: 'https://example.com',
        isPaid: false,
        suggestionsCount: 0,
        totalCount: 0,
      });

      expect(log.info.firstCall.args[0]).to.match(/isPaidLLMOCustomer=false/);
    });
  });

  // ---------------------------------------------------------------------------
  // logStatusUpload
  // ---------------------------------------------------------------------------
  describe('logStatusUpload', () => {
    it('logs all non-pages fields and correct pagesCount', () => {
      const statusSummary = {
        baseUrl: 'https://example.com',
        siteId: 'site-5',
        auditType: 'prerender',
        scrapeJobId: 'job-1',
        lastUpdated: '2025-01-01T00:00:00.000Z',
        urlsNeedingPrerender: 3,
        urlsSubmittedForScraping: 10,
        urlsScrapedSuccessfully: 9,
        scrapingErrorRate: 10,
        scrapeForbidden: false,
        scrapeForbiddenCount: 0,
        scrapeForbiddenSince: null,
        lastAuditSuccess: true,
        pages: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }],
      };

      logStatusUpload(log, { statusKey: 'prerender/scrapes/site-5/status.json', statusSummary });

      expect(log.info).to.have.been.calledOnce;
      const msg = log.info.firstCall.args[0];
      expect(msg).to.match(/prerender_status_upload/);
      expect(msg).to.match(/statusKey=prerender\/scrapes\/site-5\/status\.json/);
      expect(msg).to.match(/pagesCount=2/);
      expect(msg).to.match(/baseUrl=https:\/\/example\.com/);
      expect(msg).to.match(/siteId=site-5/);
      expect(msg).to.match(/urlsNeedingPrerender=3/);
      expect(msg).to.match(/urlsScrapedSuccessfully=9/);
      expect(msg).to.match(/lastAuditSuccess=true/);
      // pages array must NOT appear in the log fields string
      expect(msg).to.not.match(/pages=\[/);
    });

    it('correctly reports pagesCount=0 when pages array is empty', () => {
      const statusSummary = {
        baseUrl: 'https://example.com',
        siteId: 'site-6',
        auditType: 'prerender',
        scrapeJobId: null,
        lastUpdated: '2025-01-01T00:00:00.000Z',
        urlsNeedingPrerender: 0,
        urlsSubmittedForScraping: 0,
        urlsScrapedSuccessfully: 0,
        scrapingErrorRate: null,
        scrapeForbidden: false,
        scrapeForbiddenCount: 0,
        scrapeForbiddenSince: undefined,
        lastAuditSuccess: true,
        pages: [],
      };

      logStatusUpload(log, { statusKey: 'prerender/scrapes/site-6/status.json', statusSummary });

      expect(log.info.firstCall.args[0]).to.match(/pagesCount=0/);
    });
  });
});
