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
import esmock from 'esmock';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('LLMO Referral Traffic Handler', () => {
  let sandbox;
  let context;
  let site;
  let audit;
  let mockAthenaClient;
  let mockSharepointClient;
  let getStaticContentStub;
  let createLLMOSharepointClientStub;
  let saveExcelReportStub;
  let handlerModule;

  before('setup', () => {
    sandbox = sinon.createSandbox();
  });

  beforeEach(async () => {
    mockAthenaClient = {
      query: sandbox.stub(),
    };

    mockSharepointClient = {
      uploadFile: sandbox.stub().resolves(),
    };

    getStaticContentStub = sandbox.stub().resolves('SELECT * FROM table');
    createLLMOSharepointClientStub = sandbox.stub().resolves(mockSharepointClient);
    saveExcelReportStub = sandbox.stub().resolves();

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

    // Mock the handler module with esmock
    handlerModule = await esmock('../../src/llmo-referral-traffic/handler.js', {
      '@adobe/spacecat-shared-utils': {
        getStaticContent: getStaticContentStub,
        getWeekInfo: () => ({ temporalCondition: 'year = 2025 AND week = 10' }),
        isoCalendarWeek: () => ({ week: 10, year: 2025 }),
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
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('referralTrafficRunner', () => {
    it('should skip spreadsheet creation when no OpTel data is available', async () => {
      // Mock the OpTel check query to return no data
      mockAthenaClient.query.onFirstCall().resolves([{ row_count: 0 }]);

      const result = await handlerModule.referralTrafficRunner(context);

      expect(result.auditResult.rowCount).to.equal(0);
      expect(result.auditResult.hasOptelData).to.equal(false);
      expect(result.fullAuditRef).to.include('No OpTel Data Available');
      expect(mockAthenaClient.query).to.have.been.calledOnce;
      expect(saveExcelReportStub).to.not.have.been.called;
    });

    it('should create empty spreadsheet when OpTel data exists but no LLM traffic', async () => {
      // Mock the OpTel check query to return data
      mockAthenaClient.query.onFirstCall().resolves([{ row_count: 100 }]);
      // Mock the LLM traffic query to return no data
      mockAthenaClient.query.onSecondCall().resolves([]);

      const result = await handlerModule.referralTrafficRunner(context);

      expect(result.auditResult.rowCount).to.equal(0);
      expect(result.auditResult.hasOptelData).to.equal(true);
      expect(result.auditResult.hasLlmTraffic).to.equal(false);
      expect(result.auditResult.filename).to.equal('referral-traffic-w10-2025.xlsx');
      expect(result.fullAuditRef).to.include('test-folder/referral-traffic');
      expect(mockAthenaClient.query).to.have.been.calledTwice;
      expect(saveExcelReportStub).to.have.been.calledOnce;
    });

    it('should create populated spreadsheet when LLM traffic data exists', async () => {
      const mockLlmData = [
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

      // Mock the OpTel check query to return data
      mockAthenaClient.query.onFirstCall().resolves([{ row_count: 100 }]);
      // Mock the LLM traffic query to return data
      mockAthenaClient.query.onSecondCall().resolves(mockLlmData);

      const result = await handlerModule.referralTrafficRunner(context);

      expect(result.auditResult.rowCount).to.equal(1);
      expect(result.auditResult.hasOptelData).to.equal(true);
      expect(result.auditResult.hasLlmTraffic).to.equal(true);
      expect(result.auditResult.filename).to.equal('referral-traffic-w10-2025.xlsx');
      expect(saveExcelReportStub).to.have.been.calledOnce;
    });
  });
});

