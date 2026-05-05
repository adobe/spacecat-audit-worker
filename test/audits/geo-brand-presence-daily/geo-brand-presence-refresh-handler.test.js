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
import ExcelJS from 'exceljs';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import esmock from 'esmock';

use(sinonChai);
use(chaiAsPromised);

describe('Geo Brand Presence Daily Refresh Handler', () => {
  let context;
  let sandbox;
  let site;
  let log;
  let s3Client;
  let dataAccess;
  let sharepointClient;
  let getLastNumberOfWeeksStub;
  let refreshGeoBrandPresenceDailyHandler;
  let createLLMOSharepointClientStub;
  let readFromSharePointStub;
  let uploadExcelToDrsStub;
  let publishBrandPresenceAnalyzeStub;
  let drsClientStub;
  let drsCreateFromStub;

  // 3 past full weeks; the handler computes current week (47) as lastFull+1
  const LAST_4_WEEKS = [
    { week: 44, year: 2025 },
    { week: 45, year: 2025 },
    { week: 46, year: 2025 },
  ];

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    getLastNumberOfWeeksStub = sandbox.stub().returns(LAST_4_WEEKS);
    createLLMOSharepointClientStub = sandbox.stub();
    readFromSharePointStub = sandbox.stub();

    uploadExcelToDrsStub = sandbox.stub().resolves('s3://drs-bucket/external/spacecat/test-site-123/job-id/source.xlsx');
    publishBrandPresenceAnalyzeStub = sandbox.stub().resolves('spacecat-job-daily-123');

    drsClientStub = {
      isS3Configured: sandbox.stub().returns(true),
      uploadExcelToDrs: uploadExcelToDrsStub,
      publishBrandPresenceAnalyze: publishBrandPresenceAnalyzeStub,
    };

    drsCreateFromStub = sandbox.stub().returns(drsClientStub);

    log = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    };

    s3Client = { send: sandbox.stub().resolves({}) };

    site = {
      getId: () => 'test-site-123',
      getBaseURL: () => 'https://example.com',
      getDeliveryType: () => 'aem_edge',
      getOrganizationId: () => 'test-org-id',
      getConfig: () => ({
        getLlmoDataFolder: () => '/data/llmo',
        getBrandPresenceCadence: () => 'daily',
        getLlmoBrand: () => 'test-brand',
      }),
    };

    dataAccess = {
      Site: { findById: sandbox.stub().resolves(site) },
      Organization: { findById: sandbox.stub().resolves({ getImsOrgId: () => 'test-ims-org-id' }) },
    };
    sharepointClient = { getFile: sandbox.stub() };

    context = {
      log,
      s3Client,
      dataAccess,
      env: {
        S3_IMPORTER_BUCKET_NAME: 'test-bucket',
        DRS_API_URL: 'https://drs.example.com',
        DRS_API_KEY: 'test-key',
      },
    };

    createLLMOSharepointClientStub.resolves(sharepointClient);
    readFromSharePointStub.callsFake(async (filename) => {
      if (filename === 'query-index.xlsx') {
        return createMockQueryIndexExcel([]);
      }
      return Buffer.from('mock-sheet-data');
    });

    const handlerModule = await esmock('../../../src/geo-brand-presence-daily/geo-brand-presence-refresh-handler.js', {
      '@adobe/spacecat-shared-utils': {
        getLastNumberOfWeeks: getLastNumberOfWeeksStub,
      },
      '@adobe/spacecat-shared-drs-client': {
        default: { createFrom: drsCreateFromStub },
      },
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: createLLMOSharepointClientStub,
        readFromSharePoint: readFromSharePointStub,
      },
    });

    refreshGeoBrandPresenceDailyHandler = handlerModule.refreshGeoBrandPresenceDailyHandler;
  });

  afterEach(() => {
    sandbox.restore();
  });

  async function createMockQueryIndexExcel(paths = []) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Query Index');
    worksheet.addRow(['Path', 'Status']);
    paths.forEach((path) => worksheet.addRow([path, 'active']));
    return workbook.xlsx.writeBuffer();
  }

  function withSheets(paths) {
    readFromSharePointStub.callsFake(async (filename) => {
      if (filename === 'query-index.xlsx') return createMockQueryIndexExcel(paths);
      return Buffer.from('mock-sheet-data');
    });
  }

  const SHEET_W45 = '/data/llmo/brand-presence/latest/brandpresence-chatgpt-w45-2025-120125.json';
  const SHEET_W46 = '/data/llmo/brand-presence/latest/brandpresence-gemini-w46-2025-130125.json';
  const SHEET_OLD = '/data/llmo/brand-presence/latest/brandpresence-chatgpt-w40-2025-010125.json';
  const SHEET_AI_MODE = '/data/llmo/brand-presence/latest/brandpresence-ai-mode-w45-2025-120125.json';
  const SHEET_GOOGLE_AI = '/data/llmo/brand-presence/latest/brandpresence-google-ai-overviews-w45-2025-120125.json';

  const MESSAGE = {
    siteId: 'test-site-123',
    auditContext: { configVersion: 'abc123', triggerSource: 'manual' },
  };

  // ─── DRS routing ─────────────────────────────────────────────────────────────

  describe('DRS routing', () => {
    it('calls uploadExcelToDrs with correct siteId and a spacecat-prefixed jobId', async () => {
      withSheets([SHEET_W45]);

      await refreshGeoBrandPresenceDailyHandler(MESSAGE, context);

      expect(uploadExcelToDrsStub).to.have.been.calledOnce;
      expect(uploadExcelToDrsStub).to.have.been.calledWith(
        'test-site-123',
        sinon.match(/^spacecat-/),
        sinon.match.instanceOf(Buffer),
      );
    });

    it('calls publishBrandPresenceAnalyze with runFrequency daily, jobId, brand, imsOrgId', async () => {
      withSheets([SHEET_W45]);

      await refreshGeoBrandPresenceDailyHandler(MESSAGE, context);

      const uploadJobId = uploadExcelToDrsStub.firstCall.args[1];
      expect(publishBrandPresenceAnalyzeStub).to.have.been.calledOnce;
      expect(publishBrandPresenceAnalyzeStub).to.have.been.calledWith('test-site-123', sinon.match({
        jobId: uploadJobId,
        webSearchProvider: 'chatgpt',
        configVersion: 'abc123',
        week: 45,
        year: 2025,
        runFrequency: 'daily',
        brand: 'test-brand',
        imsOrgId: 'test-ims-org-id',
      }));
    });

    it('normalizes hyphenated providers to underscores before publishing to DRS', async () => {
      withSheets([SHEET_AI_MODE, SHEET_GOOGLE_AI]);

      await refreshGeoBrandPresenceDailyHandler(MESSAGE, context);

      expect(publishBrandPresenceAnalyzeStub).to.have.been.calledTwice;
      expect(publishBrandPresenceAnalyzeStub.firstCall.args[1]).to.include({ webSearchProvider: 'ai_mode' });
      expect(publishBrandPresenceAnalyzeStub.secondCall.args[1]).to.include({ webSearchProvider: 'google_ai_overviews' });
    });

    it('sends one DRS call per sheet when multiple sheets exist', async () => {
      withSheets([SHEET_W45, SHEET_W46]);

      await refreshGeoBrandPresenceDailyHandler(MESSAGE, context);

      expect(uploadExcelToDrsStub).to.have.been.calledTwice;
      expect(publishBrandPresenceAnalyzeStub).to.have.been.calledTwice;
    });

    it('logs the DRS jobId on success', async () => {
      withSheets([SHEET_W45]);

      await refreshGeoBrandPresenceDailyHandler(MESSAGE, context);

      expect(log.info).to.have.been.calledWith(
        sinon.match(/DRS analyze triggered.*spacecat-job-daily-123/),
        sinon.match.any,
      );
    });

    it('marks sheet failed in S3 and continues when DRS throws', async () => {
      withSheets([SHEET_W45, SHEET_W46]);
      uploadExcelToDrsStub
        .onFirstCall().rejects(new Error('DRS S3 upload error'))
        .onSecondCall().resolves('s3://drs-bucket/external/spacecat/test-site-123/job-id/source.xlsx');

      await refreshGeoBrandPresenceDailyHandler(MESSAGE, context);

      expect(log.error).to.have.been.calledWith(sinon.match(/DRS triggerBrandPresenceAnalyze failed/), sinon.match.any);
      expect(uploadExcelToDrsStub).to.have.been.calledTwice;
    });

    it('returns internalServerError when DRS S3 is not configured', async () => {
      drsClientStub.isS3Configured.returns(false);
      withSheets([SHEET_W45]);

      const result = await refreshGeoBrandPresenceDailyHandler(MESSAGE, context);

      expect(result.status).to.equal(500);
      expect(uploadExcelToDrsStub).to.not.have.been.called;
      expect(publishBrandPresenceAnalyzeStub).to.not.have.been.called;
    });
  });

  // ─── 4-week filtering ─────────────────────────────────────────────────────────

  describe('4-week filtering', () => {
    it('filters out sheets outside the last 4 weeks', async () => {
      withSheets([SHEET_W45, SHEET_OLD]);

      await refreshGeoBrandPresenceDailyHandler(MESSAGE, context);

      expect(uploadExcelToDrsStub).to.have.been.calledOnce;
    });

    it('throws when no sheets match the last 4 weeks', async () => {
      withSheets([SHEET_OLD]);

      await expect(refreshGeoBrandPresenceDailyHandler(MESSAGE, context))
        .to.be.rejectedWith(/No paths found in query-index file for the last 4 weeks/);
    });

    it('skips sheets with invalid name format', async () => {
      withSheets([
        SHEET_W45,
        '/data/llmo/brand-presence/latest/invalid-name.json',
      ]);

      await refreshGeoBrandPresenceDailyHandler(MESSAGE, context);

      expect(uploadExcelToDrsStub).to.have.been.calledOnce;
    });

    it('handles year boundaries correctly', async () => {
      // 3 past full weeks; current week = w2/2025 (lastFull w1/2025 + 1)
      getLastNumberOfWeeksStub.returns([
        { week: 51, year: 2024 },
        { week: 52, year: 2024 },
        { week: 1, year: 2025 },
      ]);

      withSheets([
        '/data/llmo/brand-presence/latest/brandpresence-chatgpt-w51-2024.json',
        '/data/llmo/brand-presence/latest/brandpresence-chatgpt-w52-2024.json',
        '/data/llmo/brand-presence/latest/brandpresence-chatgpt-w01-2025.json',
        '/data/llmo/brand-presence/latest/brandpresence-chatgpt-w02-2025.json',
        '/data/llmo/brand-presence/latest/brandpresence-chatgpt-w50-2024.json',
      ]);

      await refreshGeoBrandPresenceDailyHandler(MESSAGE, context);

      expect(uploadExcelToDrsStub).to.have.callCount(4);
    });

    it('uses regular brand-presence folder when no latest paths exist', async () => {
      withSheets([
        '/data/llmo/brand-presence/brandpresence-chatgpt-w45-2025.json',
      ]);

      await refreshGeoBrandPresenceDailyHandler(MESSAGE, context);

      expect(uploadExcelToDrsStub).to.have.been.calledOnce;
    });
  });

  // ─── Error handling ───────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('throws when site is not found', async () => {
      dataAccess.Site.findById.resolves(null);

      await expect(refreshGeoBrandPresenceDailyHandler(MESSAGE, context))
        .to.be.rejectedWith(/Site not found/);
    });

    it('throws when S3 client is not available', async () => {
      withSheets([SHEET_W45]);
      context.s3Client = null;

      await expect(refreshGeoBrandPresenceDailyHandler(MESSAGE, context))
        .to.be.rejectedWith(/S3 bucket name or client not available/);
    });

    it('throws when SharePoint query-index fetch fails', async () => {
      readFromSharePointStub.rejects(new Error('SharePoint unavailable'));

      await expect(refreshGeoBrandPresenceDailyHandler(MESSAGE, context))
        .to.be.rejectedWith(/Failed to read query-index from SharePoint/);
    });

    it('throws when site has no LLMO data folder configured', async () => {
      site.getConfig = () => ({ getLlmoDataFolder: () => null, getBrandPresenceCadence: () => 'daily' });

      await expect(refreshGeoBrandPresenceDailyHandler(MESSAGE, context))
        .to.be.rejectedWith(/No LLMO data folder/);
    });

    it('writes S3 metadata before processing sheets', async () => {
      withSheets([SHEET_W45]);

      await refreshGeoBrandPresenceDailyHandler(MESSAGE, context);

      expect(s3Client.send).to.have.been.calledWith(
        sinon.match.instanceOf(PutObjectCommand),
      );
    });
  });
});
