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
  });
});

