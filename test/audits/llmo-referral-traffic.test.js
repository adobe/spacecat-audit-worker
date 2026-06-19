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
import chaiAsPromised from 'chai-as-promised';
import esmock from 'esmock';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('LLMO Referral Traffic Handler', function () {
  this.timeout(10000);

  let sandbox;
  let context;
  let site;
  let audit;
  let mockAthenaClient;
  let mockSharepointClient;
  let getStaticContentStub;
  let createLLMOSharepointClientStub;
  let saveExcelReportStub;
  let fetchRulesStub;
  let createClassifierStub;
  let isoCalendarWeekStub;
  let savedWorkbook;
  let handlerModule;

  before('setup', () => {
    sandbox = sinon.createSandbox();
  });

  // Builds a classifier stub matching the frozen contract:
  // createClassifier(rules, { log }) → { classify(path) } | null
  const classifierFor = (fn) => ({ classify: (path) => fn(path) });

  // Reads the row objects written into the workbook captured by saveExcelReport.
  const capturedRows = () => {
    const ws = savedWorkbook.getWorksheet('Sheet1');
    const headers = ws.columns.map((c) => c.key);
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // header row
      const obj = {};
      headers.forEach((key, idx) => {
        obj[key] = row.getCell(idx + 1).value;
      });
      rows.push(obj);
    });
    return { headers, rows };
  };

  beforeEach(async () => {
    mockAthenaClient = {
      query: sandbox.stub(),
    };

    mockSharepointClient = {
      uploadFile: sandbox.stub().resolves(),
    };

    getStaticContentStub = sandbox.stub().resolves('SELECT * FROM table');
    createLLMOSharepointClientStub = sandbox.stub().resolves(mockSharepointClient);
    savedWorkbook = undefined;
    saveExcelReportStub = sandbox.stub().callsFake(({ workbook }) => {
      savedWorkbook = workbook;
      return Promise.resolve();
    });
    // default: no rules → fetch returns empty patterns, classifier null
    fetchRulesStub = sandbox.stub().resolves({ topicPatterns: [], pagePatterns: [] });
    createClassifierStub = sandbox.stub().returns(null);
    isoCalendarWeekStub = sandbox.stub().returns({ week: 10, year: 2025 });

    site = {
      getId: sandbox.stub().returns('site-123'),
      getSiteId: sandbox.stub().returns('site-123'),
      getBaseURL: sandbox.stub().returns('https://example.com'),
      getPageIntents: sandbox.stub().resolves([]),
      getConfig: sandbox.stub().returns({
        getLlmoDataFolder: () => 'test-folder',
      }),
    };

    audit = {
      getAuditResult: sandbox.stub().returns({
        week: 10,
        year: 2025,
      }),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        site,
        audit,
        env: {
          S3_IMPORTER_BUCKET_NAME: 'test-bucket',
        },
      })
      .build();

    // Mock the handler module with esmock. The classifier module is stubbed to
    // the frozen contract (createClassifier) so these tests do not depend on the
    // module's on-disk shape.
    handlerModule = await esmock('../../src/llmo-referral-traffic/handler.js', {
      '@adobe/spacecat-shared-utils': {
        getStaticContent: getStaticContentStub,
        getWeekInfo: (week = 10, year = 2025) => ({
          week, year, temporalCondition: 'year = 2025 AND week = 10',
        }),
        isoCalendarWeek: isoCalendarWeekStub,
      },
      '@adobe/spacecat-shared-athena-client': {
        AWSAthenaClient: {
          fromContext: sandbox.stub().returns(mockAthenaClient),
        },
      },
      '../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: createLLMOSharepointClientStub,
        saveExcelReport: saveExcelReportStub,
      },
      '../../src/common/agentic-url-classification-rules.js': {
        fetchAgenticUrlClassificationRules: fetchRulesStub,
      },
      '../../src/common/agentic-url-classification.js': {
        createClassifier: createClassifierStub,
      },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('referralTrafficRunner', () => {
    it('should skip spreadsheet creation when no data is available', async () => {
      // Mock the query to return no data
      mockAthenaClient.query.resolves([]);

      const result = await handlerModule.referralTrafficRunner(context);

      expect(result.auditResult.rowCount).to.equal(0);
      expect(result.fullAuditRef).to.include('No OpTel Data Found');
      expect(mockAthenaClient.query).to.have.been.calledOnce;
      expect(saveExcelReportStub).to.not.have.been.called;
    });

    it('should create populated spreadsheet when traffic data exists', async () => {
      const mockTrafficData = [
        {
          path: '/page1',
          trf_type: 'earned',
          trf_channel: 'llm',
          trf_platform: 'chatgpt',
          device: 'desktop',
          date: '2025-03-10',
          pageviews: 100,
          consent: 1,
          bounced: 0,
        },
      ];

      // Mock the query to return data
      mockAthenaClient.query.resolves(mockTrafficData);

      const result = await handlerModule.referralTrafficRunner(context);

      expect(result.auditResult.rowCount).to.equal(1);
      expect(result.auditResult.filename).to.equal('referral-traffic-w10-2025.xlsx');
      expect(result.auditResult.outputLocation).to.equal('test-folder/referral-traffic');
      expect(result.fullAuditRef).to.equal('test-folder/referral-traffic/referral-traffic-w10-2025.xlsx');
      expect(mockAthenaClient.query).to.have.been.calledOnce;
      expect(saveExcelReportStub).to.have.been.calledOnce;
    });

    it('should enrich data with page intents and region', async () => {
      const mockTrafficData = [
        { path: '/us/page1', trf_type: 'earned' },
        { path: '/de/page2', trf_type: 'earned' },
      ];

      const mockPageIntents = [
        { getUrl: () => 'https://example.com/us/page1', getPageIntent: () => 'purchase' },
      ];

      site.getPageIntents.resolves(mockPageIntents);
      mockAthenaClient.query.resolves(mockTrafficData);

      const result = await handlerModule.referralTrafficRunner(context);

      expect(result.auditResult.rowCount).to.equal(2);
      expect(saveExcelReportStub).to.have.been.calledOnce;
    });

    it('should extract the country from bare country/language paths', async () => {
      const mockTrafficData = [
        { path: 'cz/cs/page1', trf_type: 'earned' },
      ];

      mockAthenaClient.query.resolves(mockTrafficData);

      await handlerModule.referralTrafficRunner(context);

      expect(mockTrafficData[0].region).to.equal('CZ');
    });

    // ───────────── classification enrichment (C1) ─────────────

    it('should add topic/category when classification rules are present', async () => {
      createClassifierStub.returns(classifierFor(() => ({ topic: 'Acrobat', category: 'Product' })));
      mockAthenaClient.query.resolves([{ path: '/us/acrobat', trf_type: 'earned' }]);

      await handlerModule.referralTrafficRunner(context);

      expect(createClassifierStub).to.have.been.calledOnce;
      const { rows } = capturedRows();
      expect(rows[0].topic).to.equal('Acrobat');
      expect(rows[0].category).to.equal('Product');
      expect(context.log.info).to.have.been.calledWithMatch(
        /Agentic classification rules found/,
      );
    });

    it('should classify the full path even when it confounds region detection (I9)', async () => {
      // /us/acrobat → region US; the classifier must still receive the FULL path,
      // not a region-stripped one. A path-aware stub returns a hit only for the
      // exact full path, so a stripped arg would fall through to Other/Other.
      // Mirrors the daily-export region-confound test.
      createClassifierStub.returns(
        classifierFor((path) => (path === '/us/acrobat'
          ? { topic: 'Acrobat', category: 'Product' }
          : { topic: 'Other', category: 'Other' })),
      );
      mockAthenaClient.query.resolves([{ path: '/us/acrobat', trf_type: 'earned' }]);

      await handlerModule.referralTrafficRunner(context);

      const { rows } = capturedRows();
      expect(rows[0].region).to.equal('US');
      expect(rows[0].topic).to.equal('Acrobat');
      expect(rows[0].category).to.equal('Product');
    });

    it('should leave topic/category empty when no classification rules exist', async () => {
      createClassifierStub.returns(null);
      mockAthenaClient.query.resolves([{ path: '/us/acrobat', trf_type: 'earned' }]);

      await handlerModule.referralTrafficRunner(context);

      const { headers, rows } = capturedRows();
      expect(headers).to.include('topic');
      expect(headers).to.include('category');
      expect(rows[0].topic).to.equal('');
      expect(rows[0].category).to.equal('');
      expect(context.log.info).to.have.been.calledWithMatch(
        /No agentic classification rules/,
      );
    });

    it('should leave topic/category empty and warn when rule fetch errored (M5)', async () => {
      fetchRulesStub.resolves({ error: true, source: 'postgres' });
      createClassifierStub.returns(null);
      mockAthenaClient.query.resolves([{ path: '/us/acrobat', trf_type: 'earned' }]);

      await handlerModule.referralTrafficRunner(context);

      const { rows } = capturedRows();
      expect(rows[0].topic).to.equal('');
      expect(rows[0].category).to.equal('');
      expect(context.log.warn).to.have.been.calledWithMatch(
        /Failed to fetch agentic classification rules/,
      );
    });

    // ───────────── explicit schema (I6) ─────────────

    it('should emit explicit stable columns regardless of data keys', async () => {
      createClassifierStub.returns(null);
      mockAthenaClient.query.resolves([{
        path: '/p', trf_type: 'earned', trf_channel: 'llm', trf_platform: 'chatgpt',
        device: 'desktop', date: '2025-03-10', pageviews: 100, consent: 1, bounced: 0,
      }]);

      await handlerModule.referralTrafficRunner(context);

      const { headers } = capturedRows();
      expect(headers).to.deep.equal([
        'path', 'trf_type', 'trf_channel', 'trf_platform', 'device', 'date',
        'pageviews', 'consent', 'bounced', 'page_intent', 'region', 'topic', 'category',
      ]);
    });

    // ───────────── formula injection (I4) ─────────────

    it('should neutralize formula-injection topic/category in Excel cells', async () => {
      createClassifierStub.returns(
        classifierFor(() => ({ topic: '=cmd|calc', category: '@evil' })),
      );
      mockAthenaClient.query.resolves([{ path: '/x', trf_type: 'earned' }]);

      await handlerModule.referralTrafficRunner(context);

      const { rows } = capturedRows();
      expect(rows[0].topic).to.equal("'=cmd|calc");
      expect(rows[0].category).to.equal("'@evil");
    });

    it('should neutralize formula-injection in visitor-influenced path cell', async () => {
      createClassifierStub.returns(null);
      mockAthenaClient.query.resolves([{ path: '+1+1', trf_type: 'earned' }]);

      await handlerModule.referralTrafficRunner(context);

      const { rows } = capturedRows();
      expect(rows[0].path).to.equal("'+1+1");
    });
  });

  describe('triggerTrafficAnalysisImport', () => {
    it('should derive week/year from auditContext when provided', async () => {
      context.auditContext = { week: 12, year: 2024 };
      context.finalUrl = 'https://example.com';

      const result = await handlerModule.triggerTrafficAnalysisImport(context);

      expect(result.type).to.equal('traffic-analysis');
      expect(result.siteId).to.equal('site-123');
      expect(result.auditResult.week).to.equal(12);
      expect(result.auditResult.year).to.equal(2024);
      expect(result.allowCache).to.equal(false);
      expect(result.fullAuditRef).to.equal('https://example.com');
    });

    it('should default to yesterday when auditContext is absent', async () => {
      delete context.auditContext;
      context.finalUrl = 'https://example.com';

      const result = await handlerModule.triggerTrafficAnalysisImport(context);

      expect(result.auditResult.week).to.equal(10);
      expect(result.auditResult.year).to.equal(2025);
      // Pin the actual yesterday = (now − 1 day, UTC) math handed to isoCalendarWeek,
      // not merely the stubbed week/year return.
      expect(isoCalendarWeekStub).to.have.been.calledOnce;
      const passedDate = isoCalendarWeekStub.firstCall.args[0];
      expect(passedDate).to.be.an.instanceof(Date);
      const expectedYesterday = new Date();
      expectedYesterday.setUTCDate(expectedYesterday.getUTCDate() - 1);
      expect(Math.abs(passedDate.getTime() - expectedYesterday.getTime())).to.be.lessThan(5000);
    });
  });
});
