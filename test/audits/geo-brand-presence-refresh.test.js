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
import ExcelJS from 'exceljs';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import esmock from 'esmock';

use(sinonChai);

describe('Geo Brand Presence Refresh Handler - 4 Week Filter', () => {
  let context;
  let sandbox;
  let site;
  let log;
  let s3Client;
  let sqs;
  let dataAccess;
  let sharepointClient;
  let getLastNumberOfWeeksStub;
  let refreshGeoBrandPresenceSheetsHandler;
  let createLLMOSharepointClientStub;
  let readFromSharePointStub;
  let getSignedUrlStub;
  let createMystiqueMessageStub;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    // Create stubs before esmock
    getLastNumberOfWeeksStub = sandbox.stub();
    createLLMOSharepointClientStub = sandbox.stub();
    readFromSharePointStub = sandbox.stub();
    getSignedUrlStub = sandbox.stub();
    createMystiqueMessageStub = sandbox.stub();

    log = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    };

    s3Client = {
      send: sandbox.stub(),
    };

    sqs = {
      sendMessage: sandbox.stub().resolves({}),
    };

    site = {
      getId: () => 'test-site-123',
      getBaseURL: () => 'https://example.com',
      getDeliveryType: () => 'aem_edge',
      getConfig: () => ({
        getLlmoDataFolder: () => '/data/llmo',
        getBrandPresenceCadence: () => 'weekly',
      }),
    };

    dataAccess = {
      Site: {
        findById: sandbox.stub().resolves(site),
      },
    };

    sharepointClient = {
      getFile: sandbox.stub(),
    };

    context = {
      log,
      s3Client,
      sqs,
      dataAccess,
      env: {
        S3_IMPORTER_BUCKET_NAME: 'test-bucket',
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
      },
    };

    // Set up SharePoint stubs
    createLLMOSharepointClientStub.resolves(sharepointClient);
    readFromSharePointStub.callsFake(async (filename) => {
      if (filename === 'query-index.xlsx') {
        return createMockQueryIndexExcel();
      }
      // Mock sheet files
      return Buffer.from('mock-sheet-data');
    });

    // Set up other stubs
    getSignedUrlStub.resolves('https://s3.amazonaws.com/presigned-url');
    createMystiqueMessageStub.callsFake((params) => ({
      type: params.type,
      auditId: params.auditId,
      baseURL: params.baseURL,
      siteId: params.siteId,
      calendarWeek: params.calendarWeek,
      webSearchProvider: params.webSearchProvider,
    }));

    // Mock the handler with esmock
    const handlerModule = await esmock('../../src/geo-brand-presence/geo-brand-presence-refresh-handler.js', {
      '@adobe/spacecat-shared-utils': {
        getLastNumberOfWeeks: getLastNumberOfWeeksStub,
      },
      '../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: createLLMOSharepointClientStub,
        readFromSharePoint: readFromSharePointStub,
      },
      '../../src/utils/getPresignedUrl.js': {
        getSignedUrl: getSignedUrlStub,
      },
      '../../src/geo-brand-presence/handler.js': {
        createMystiqueMessage: createMystiqueMessageStub,
      },
    });

    refreshGeoBrandPresenceSheetsHandler = handlerModule.refreshGeoBrandPresenceSheetsHandler;
  });

  afterEach(() => {
    sandbox.restore();
  });

  /**
   * Helper function to create a mock Excel file with brand presence paths
   */
  async function createMockQueryIndexExcel(paths = []) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Query Index');

    // Add header
    worksheet.addRow(['Path', 'Status']);

    // Add data rows
    paths.forEach((path) => {
      worksheet.addRow([path, 'active']);
    });

    return workbook.xlsx.writeBuffer();
  }

  /**
   * Helper to stub S3 responses
   */
  function stubS3Operations() {
    // Stub metadata file write
    s3Client.send.withArgs(sinon.match.instanceOf(PutObjectCommand)).resolves({});

    // Stub presigned URL generation
    s3Client.send.withArgs(sinon.match.instanceOf(GetObjectCommand)).resolves({});
  }

  describe('4-week filtering logic', () => {
    it('should only process sheets from the last 4 weeks', async () => {
      // Mock current date to be a specific week for predictable testing
      const last4Weeks = [
        { week: 44, year: 2025 },
        { week: 45, year: 2025 },
        { week: 46, year: 2025 },
        { week: 47, year: 2025 },
      ];
      getLastNumberOfWeeksStub.returns(last4Weeks);

      // Create paths with some inside and some outside the 4-week window
      const allPaths = [
        '/data/llmo/brand-presence/latest/brandpresence-google-w44-2025.json',
        '/data/llmo/brand-presence/latest/brandpresence-google-w45-2025.json',
        '/data/llmo/brand-presence/latest/brandpresence-google-w46-2025.json',
        '/data/llmo/brand-presence/latest/brandpresence-google-w47-2025.json',
        '/data/llmo/brand-presence/latest/brandpresence-google-w43-2025.json', // Outside 4 weeks
        '/data/llmo/brand-presence/latest/brandpresence-bing-w40-2025.json', // Outside 4 weeks
      ];

      readFromSharePointStub.callsFake(async (filename) => {
        if (filename === 'query-index.xlsx') {
          return createMockQueryIndexExcel(allPaths);
        }
        return Buffer.from('mock-sheet-data');
      });

      stubS3Operations();

      const message = {
        siteId: 'test-site-123',
        auditContext: {
          configVersion: 'v1',
          triggerSource: 'manual',
        },
      };

      await refreshGeoBrandPresenceSheetsHandler(message, context);

      // Verify that only 4 messages were sent (for the 4 valid weeks)
      expect(sqs.sendMessage).to.have.callCount(4);

      // Verify that only sheets from the last 4 weeks were processed
      const sentMessages = sqs.sendMessage.getCalls().map((call) => call.args[1]);
      const processedWeeks = sentMessages.map((msg) => msg.calendarWeek);

      expect(processedWeeks).to.deep.equal([
        { week: 44, year: 2025 },
        { week: 45, year: 2025 },
        { week: 46, year: 2025 },
        { week: 47, year: 2025 },
      ]);

      // Verify logging
      expect(log.info).to.have.been.calledWith(
        sinon.match(/Filtered \d+ paths to 4 paths from last 4 weeks/),
      );
    });

    it('should handle sheets across year boundaries', async () => {
      // Test case where the last 4 weeks span two years
      const last4Weeks = [
        { week: 51, year: 2024 },
        { week: 52, year: 2024 },
        { week: 1, year: 2025 },
        { week: 2, year: 2025 },
      ];
      getLastNumberOfWeeksStub.returns(last4Weeks);

      const allPaths = [
        '/data/llmo/brand-presence/latest/brandpresence-google-w51-2024.json',
        '/data/llmo/brand-presence/latest/brandpresence-google-w52-2024.json',
        '/data/llmo/brand-presence/latest/brandpresence-google-w01-2025.json',
        '/data/llmo/brand-presence/latest/brandpresence-google-w02-2025.json',
        '/data/llmo/brand-presence/latest/brandpresence-google-w50-2024.json', // Outside
        '/data/llmo/brand-presence/latest/brandpresence-google-w03-2025.json', // Outside
      ];

      readFromSharePointStub.callsFake(async (filename) => {
        if (filename === 'query-index.xlsx') {
          return createMockQueryIndexExcel(allPaths);
        }
        return Buffer.from('mock-sheet-data');
      });

      stubS3Operations();

      const message = {
        siteId: 'test-site-123',
        auditContext: { configVersion: 'v1' },
      };

      await refreshGeoBrandPresenceSheetsHandler(message, context);

      expect(sqs.sendMessage).to.have.callCount(4);

      const processedWeeks = sqs.sendMessage.getCalls()
        .map((call) => call.args[1].calendarWeek);

      expect(processedWeeks).to.deep.include({ week: 51, year: 2024 });
      expect(processedWeeks).to.deep.include({ week: 52, year: 2024 });
      expect(processedWeeks).to.deep.include({ week: 1, year: 2025 });
      expect(processedWeeks).to.deep.include({ week: 2, year: 2025 });
    });

    it('should handle sheets with multiple providers', async () => {
      const last4Weeks = [
        { week: 44, year: 2025 },
        { week: 45, year: 2025 },
        { week: 46, year: 2025 },
        { week: 47, year: 2025 },
      ];
      getLastNumberOfWeeksStub.returns(last4Weeks);

      const allPaths = [
        '/data/llmo/brand-presence/latest/brandpresence-google-w45-2025.json',
        '/data/llmo/brand-presence/latest/brandpresence-bing-w45-2025.json',
        '/data/llmo/brand-presence/latest/brandpresence-duckduckgo-w45-2025.json',
        '/data/llmo/brand-presence/latest/brandpresence-google-w40-2025.json', // Outside
      ];

      readFromSharePointStub.callsFake(async (filename) => {
        if (filename === 'query-index.xlsx') {
          return createMockQueryIndexExcel(allPaths);
        }
        return Buffer.from('mock-sheet-data');
      });

      stubS3Operations();

      const message = {
        siteId: 'test-site-123',
        auditContext: { configVersion: 'v1' },
      };

      await refreshGeoBrandPresenceSheetsHandler(message, context);

      // Should process 3 sheets (all from week 45, different providers)
      expect(sqs.sendMessage).to.have.callCount(3);
    });

    it('should skip sheets with invalid name format', async () => {
      const last4Weeks = [
        { week: 44, year: 2025 },
        { week: 45, year: 2025 },
        { week: 46, year: 2025 },
        { week: 47, year: 2025 },
      ];
      getLastNumberOfWeeksStub.returns(last4Weeks);

      const allPaths = [
        '/data/llmo/brand-presence/latest/brandpresence-google-w45-2025.json',
        '/data/llmo/brand-presence/latest/invalid-format.json', // Invalid format
        '/data/llmo/brand-presence/latest/brandpresence-google-2025.json', // Missing week
      ];

      readFromSharePointStub.callsFake(async (filename) => {
        if (filename === 'query-index.xlsx') {
          return createMockQueryIndexExcel(allPaths);
        }
        return Buffer.from('mock-sheet-data');
      });

      stubS3Operations();

      const message = {
        siteId: 'test-site-123',
        auditContext: { configVersion: 'v1' },
      };

      await refreshGeoBrandPresenceSheetsHandler(message, context);

      // Only 1 valid sheet should be processed
      expect(sqs.sendMessage).to.have.callCount(1);

      // Verify debug logging for skipped sheets
      expect(log.debug).to.have.been.calledWith(
        sinon.match(/Skipping invalid path format/),
      );
    });

    it('should throw error when no sheets match the last 4 weeks', async () => {
      const last4Weeks = [
        { week: 44, year: 2025 },
        { week: 45, year: 2025 },
        { week: 46, year: 2025 },
        { week: 47, year: 2025 },
      ];
      getLastNumberOfWeeksStub.returns(last4Weeks);

      // All paths are outside the 4-week window
      const allPaths = [
        '/data/llmo/brand-presence/latest/brandpresence-google-w40-2025.json',
        '/data/llmo/brand-presence/latest/brandpresence-bing-w41-2025.json',
        '/data/llmo/brand-presence/latest/brandpresence-duckduckgo-w42-2025.json',
      ];

      readFromSharePointStub.callsFake(async (filename) => {
        if (filename === 'query-index.xlsx') {
          return createMockQueryIndexExcel(allPaths);
        }
        return Buffer.from('mock-sheet-data');
      });

      const message = {
        siteId: 'test-site-123',
        auditContext: { configVersion: 'v1' },
      };

      try {
        await refreshGeoBrandPresenceSheetsHandler(message, context);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('No paths found in query-index file for the last 4 weeks');
      }
    });

    it('should handle regular brand-presence folder (fallback)', async () => {
      const last4Weeks = [
        { week: 44, year: 2025 },
        { week: 45, year: 2025 },
        { week: 46, year: 2025 },
        { week: 47, year: 2025 },
      ];
      getLastNumberOfWeeksStub.returns(last4Weeks);

      // Paths in regular folder (not latest)
      const allPaths = [
        '/data/llmo/brand-presence/brandpresence-google-w45-2025.json',
        '/data/llmo/brand-presence/brandpresence-bing-w45-2025.json',
      ];

      readFromSharePointStub.callsFake(async (filename) => {
        if (filename === 'query-index.xlsx') {
          return createMockQueryIndexExcel(allPaths);
        }
        return Buffer.from('mock-sheet-data');
      });

      stubS3Operations();

      const message = {
        siteId: 'test-site-123',
        auditContext: { configVersion: 'v1' },
      };

      await refreshGeoBrandPresenceSheetsHandler(message, context);

      expect(sqs.sendMessage).to.have.callCount(2);
    });

    it('should log excluded paths for debugging', async () => {
      const last4Weeks = [
        { week: 45, year: 2025 },
        { week: 46, year: 2025 },
        { week: 47, year: 2025 },
        { week: 48, year: 2025 },
      ];
      getLastNumberOfWeeksStub.returns(last4Weeks);

      const allPaths = [
        '/data/llmo/brand-presence/latest/brandpresence-google-w45-2025.json',
        '/data/llmo/brand-presence/latest/brandpresence-google-w40-2025.json', // Old
        '/data/llmo/brand-presence/latest/brandpresence-google-w35-2025.json', // Very old
      ];

      readFromSharePointStub.callsFake(async (filename) => {
        if (filename === 'query-index.xlsx') {
          return createMockQueryIndexExcel(allPaths);
        }
        return Buffer.from('mock-sheet-data');
      });

      stubS3Operations();

      const message = {
        siteId: 'test-site-123',
        auditContext: { configVersion: 'v1' },
      };

      await refreshGeoBrandPresenceSheetsHandler(message, context);

      // Verify debug logging for excluded paths
      expect(log.debug).to.have.been.calledWith(
        sinon.match(/Excluding path.*w40-2025.*outside last 4 weeks/),
      );
      expect(log.debug).to.have.been.calledWith(
        sinon.match(/Excluding path.*w35-2025.*outside last 4 weeks/),
      );
    });
  });

  describe('daily cadence support', () => {
    it('should apply 4-week filter for daily cadence', async () => {
      const last4Weeks = [
        { week: 44, year: 2025 },
        { week: 45, year: 2025 },
        { week: 46, year: 2025 },
        { week: 47, year: 2025 },
      ];
      getLastNumberOfWeeksStub.returns(last4Weeks);

      // Override site config to return daily cadence
      site.getConfig = () => ({
        getLlmoDataFolder: () => '/data/llmo',
        getBrandPresenceCadence: () => 'daily',
      });

      const allPaths = [
        '/data/llmo/brand-presence/latest/brandpresence-google-w45-2025.json',
        '/data/llmo/brand-presence/latest/brandpresence-google-w40-2025.json', // Outside
      ];

      readFromSharePointStub.callsFake(async (filename) => {
        if (filename === 'query-index.xlsx') {
          return createMockQueryIndexExcel(allPaths);
        }
        return Buffer.from('mock-sheet-data');
      });

      stubS3Operations();

      const message = {
        siteId: 'test-site-123',
        auditContext: { configVersion: 'v1' },
      };

      await refreshGeoBrandPresenceSheetsHandler(message, context);

      // Only 1 sheet from last 4 weeks should be processed
      expect(sqs.sendMessage).to.have.callCount(1);

      // Verify message type is daily
      const sentMessage = sqs.sendMessage.getCall(0).args[1];
      expect(sentMessage.type).to.equal('refresh:geo-brand-presence-daily');
    });
  });
});
